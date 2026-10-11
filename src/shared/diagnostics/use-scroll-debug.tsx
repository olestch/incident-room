'use client';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';
import type { Virtualizer, VirtualItem } from '@tanstack/react-virtual';
import { ScrollRecorder, type ScrollSurface, type TechnicalData } from './scroll-recorder';

export interface ScrollDebugState {
  paginationLoading: boolean;
  paginationFetching: boolean;
  paginationComplete: boolean;
  historyPages: number;
  acquiredWindows: number;
  targetNavigationActive: boolean;
}
interface Session {
  recorder: ScrollRecorder;
  viewports: Set<HTMLDivElement>;
}
const controlStyle = { minHeight: 32, padding: '4px 6px' };
const subscribeMounted = () => () => {};
const Context = createContext<Session | null>(null);
export function ScrollDebugProvider({
  enabled,
  children,
}: {
  enabled: boolean;
  children: ReactNode;
}) {
  const session = useMemo<Session | null>(
    () => (enabled ? { recorder: new ScrollRecorder(), viewports: new Set() } : null),
    [enabled],
  );
  useEffect(() => () => session?.recorder.stop(), [session]);
  return (
    <Context.Provider value={session}>
      {children}
      {session && <Controls session={session} />}
    </Context.Provider>
  );
}
function Controls({ session }: { session: Session }) {
  const ready = useSyncExternalStore(
    subscribeMounted,
    () => true,
    () => false,
  );
  const [expanded, setExpanded] = useState(false);
  const [status, setStatus] = useState('');
  const [, refresh] = useState(0);
  const panel = useRef<HTMLElement>(null);
  useEffect(() => {
    const update = () => {
      refresh((value) => value + 1);
      const viewport = [...session.viewports]
        .reverse()
        .find((node) => !node.closest('[inert]') && node.getBoundingClientRect().height > 0);
      if (panel.current && viewport) {
        const box = viewport.getBoundingClientRect();
        panel.current.style.top = `${Math.max(0, box.top + viewport.clientTop + 4)}px`;
        panel.current.style.right = `${Math.max(4, innerWidth - box.right + 4)}px`;
        panel.current.style.maxHeight = `${Math.max(0, viewport.clientHeight - 8)}px`;
      }
    };
    const initialFrame = requestAnimationFrame(update);
    const timer = setInterval(update, 500);
    const unsubscribe = session.recorder.subscribe(update);
    return () => {
      cancelAnimationFrame(initialFrame);
      clearInterval(timer);
      unsubscribe();
    };
  }, [session]);
  const json = () =>
    session.recorder.export({
      commit: process.env.NEXT_PUBLIC_APP_COMMIT_SHA ?? null,
      userAgent: navigator.userAgent,
      width: innerWidth,
      height: innerHeight,
      devicePixelRatio,
    });
  const copy = async () => {
    const content = json();
    try {
      await navigator.clipboard.writeText(content);
      setStatus('Log copied');
    } catch {
      // Mobile/non-secure origins may lack Clipboard API. Keep selection outside the stream.
      const input = document.createElement('textarea');
      input.value = content;
      input.style.cssText = 'position:fixed;top:0;left:0;opacity:0';
      document.body.append(input);
      input.focus({ preventScroll: true });
      input.select();
      const copied = document.execCommand('copy');
      input.remove();
      setStatus(copied ? 'Log copied' : 'Copy unavailable; use Download JSON');
    }
  };
  if (!ready) return null;
  return createPortal(
    <aside
      ref={panel}
      aria-label="Scroll diagnostics"
      style={{
        position: 'fixed',
        top: '40%',
        right: 8,
        zIndex: 90,
        maxWidth: 'calc(100vw - 16px)',
        width: expanded ? 272 : 'auto',
        overflow: 'auto',
        border: '1px solid #667085',
        borderRadius: 8,
        background: '#101828',
        color: '#fff',
        padding: 4,
        fontSize: 12,
      }}
    >
      <button
        type="button"
        style={controlStyle}
        aria-expanded={expanded}
        onClick={() => setExpanded(!expanded)}
      >
        Scroll debug · {session.recorder.recording ? 'Recording' : 'Stopped'} ·{' '}
        {session.recorder.count}
      </button>
      {expanded && (
        <>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            <button
              type="button"
              style={controlStyle}
              disabled={session.recorder.recording}
              onClick={() => session.recorder.start()}
            >
              Start recording
            </button>
            <button
              type="button"
              style={controlStyle}
              disabled={!session.recorder.recording}
              onClick={() => session.recorder.stop()}
            >
              Stop recording
            </button>
            <button type="button" style={controlStyle} onClick={() => session.recorder.clear()}>
              Clear
            </button>
            <button type="button" style={controlStyle} onClick={() => void copy()}>
              Copy log
            </button>
            <button
              type="button"
              style={controlStyle}
              onClick={() => {
                const url = URL.createObjectURL(new Blob([json()], { type: 'application/json' }));
                const link = document.createElement('a');
                link.href = url;
                link.download = 'incident-room-scroll-debug.json';
                link.click();
                setTimeout(() => URL.revokeObjectURL(url), 1000);
              }}
            >
              Download JSON
            </button>
          </div>
          <span role="status">
            {status || `${session.recorder.droppedCount} older events discarded`}
          </span>
        </>
      )}
    </aside>,
    document.body,
  );
}
interface Snapshot {
  items: VirtualItem[];
  state: () => TechnicalData;
}
/** Development opt-in only. No virtualizer options, compensation or list DOM changes. */
export function useScrollDebug(
  virtual: Virtualizer<HTMLDivElement, HTMLLIElement>,
  container: RefObject<HTMLDivElement | null>,
  label: string,
  read: () => Snapshot,
) {
  const session = useContext(Context);
  const sessionRef = useRef(session);
  useLayoutEffect(() => {
    sessionRef.current = session;
  }, [session]);
  const snapshot = useRef<Snapshot>({ items: [], state: () => ({}) });
  const wake = useRef<(reason: string) => void>(() => {});
  const commandSource = useRef<string | null>(null);
  const surface: ScrollSurface = label === 'Thread' ? 'Thread' : 'Timeline';
  useLayoutEffect(() => {
    if (session) {
      snapshot.current = read();
      wake.current('commit');
    }
  });
  useLayoutEffect(() => {
    const element = container.current;
    if (!session || !element) return;
    return attachScrollDebug(session, virtual, element, surface, snapshot, wake, commandSource);
  }, [session, virtual, container, surface]);
  return useCallback(
    <T,>(type: string, reason: string, requested: number | null, operation: () => T): T => {
      return runScrollCommand(
        sessionRef,
        surface,
        container,
        commandSource,
        wake,
        type,
        reason,
        requested,
        operation,
      );
    },
    [surface, container],
  );
}

/** Instance-scoped imperative instrumentation; kept outside React's render analysis. */
export function attachScrollDebug(
  session: Session,
  virtual: Virtualizer<HTMLDivElement, HTMLLIElement>,
  element: HTMLDivElement,
  surface: ScrollSurface,
  snapshot: { current: Snapshot },
  wake: { current: (reason: string) => void },
  commandSource: { current: string | null },
) {
  session.viewports.add(element);
  const recorder = session.recorder;
  let dispose = () => {};
  const toggle = () => {
    dispose();
    dispose = () => {};
    if (!recorder.recording) return;
    let frame = 0,
      deadline = 0,
      anchorKey: string | null = null;
    let lastState = '',
      lastRows = -1,
      lastTotal = -1;
    let touchY: number | null = null,
      touchDirection = 0;
    const sample = (reason: string) => {
      const bounds = element.getBoundingClientRect();
      const offset = element.scrollTop;
      const items = snapshot.current.items;
      const visible = items.filter(
        (item) => item.end > offset && item.start < offset + element.clientHeight,
      );
      const itemData = (item: VirtualItem | undefined) =>
        item
          ? {
              key: recorder.key(item.key),
              index: item.index,
              start: item.start,
              end: item.end,
              size: item.size,
            }
          : null;
      const mounted = [
        ...element.querySelectorAll<HTMLLIElement>(':scope > ol > li[data-row-key]'),
      ];
      let anchor = mounted.find((node) => node.dataset.rowKey === anchorKey);
      let box = anchor?.getBoundingClientRect();
      if (
        !box ||
        box.bottom <= bounds.top + element.clientTop ||
        box.top >= bounds.top + element.clientTop + element.clientHeight
      ) {
        anchor = mounted.find((node) => {
          const rect = node.getBoundingClientRect();
          return (
            rect.bottom > bounds.top + element.clientTop &&
            rect.top < bounds.top + element.clientTop + element.clientHeight
          );
        });
        box = anchor?.getBoundingClientRect();
        anchorKey = anchor?.dataset.rowKey ?? null;
      }
      const anchorItem = anchor
        ? items.find((item) => item.index === Number(anchor.dataset.index))
        : undefined;
      const technicalAnchor = itemData(anchorItem);
      const totalSize = Number.parseFloat(
        element.firstElementChild instanceof HTMLElement
          ? element.firstElementChild.style.height
          : '0',
      );
      const currentState = snapshot.current.state();
      const state = JSON.stringify(currentState);
      if (state !== lastState) {
        recorder.record(surface, 'application-state', currentState);
        lastState = state;
      }
      const rowCount = virtual.options.count;
      if (rowCount !== lastRows) {
        recorder.record(surface, 'rows-changed', {
          oldCount: lastRows < 0 ? null : lastRows,
          rowCount,
          firstMountedKey: items[0] ? recorder.key(items[0].key) : null,
        });
        lastRows = rowCount;
      }
      if (totalSize !== lastTotal) {
        recorder.record(surface, 'total-size-changed', {
          oldSize: lastTotal < 0 ? null : lastTotal,
          totalSize,
        });
        lastTotal = totalSize;
      }
      recorder.sample(
        surface,
        {
          scrollTop: offset,
          scrollHeight: element.scrollHeight,
          clientHeight: element.clientHeight,
          clientWidth: element.clientWidth,
          distanceFromBottom: element.scrollHeight - element.clientHeight - offset,
          top: bounds.top,
          bottom: bounds.bottom,
          offset: virtual.scrollOffset,
          adjustments: virtual.scrollAdjustments,
          totalSize,
          rowCount,
          isScrolling: virtual.isScrolling,
          direction: virtual.scrollDirection,
          first: itemData(visible[0]),
          last: itemData(visible.at(-1)),
          anchor:
            box && technicalAnchor && anchor
              ? {
                  ...technicalAnchor,
                  top: box.top - bounds.top,
                  bottom: box.bottom - bounds.top,
                  height: box.height,
                  transform: anchor.style.transform,
                }
              : null,
        },
        reason,
      );
    };
    const tick = () => {
      frame = 0;
      sample('animation-frame');
      if (virtual.isScrolling || touchY !== null) deadline = performance.now() + 1500;
      if (performance.now() < deadline) frame = requestAnimationFrame(tick);
    };
    const activate = (reason: string) => {
      deadline = performance.now() + 1500;
      if (reason !== 'commit') recorder.record(surface, 'observation-trigger', { reason });
      if (!frame) frame = requestAnimationFrame(tick);
    };
    wake.current = activate;
    const cleanups: (() => void)[] = [];
    const listen = <K extends keyof HTMLElementEventMap>(
      type: K,
      callback: (event: HTMLElementEventMap[K]) => void,
    ) => {
      element.addEventListener(type, callback, { passive: true });
      cleanups.push(() => element.removeEventListener(type, callback));
    };
    listen('scroll', () => {
      recorder.record(surface, 'scroll', { scrollTop: element.scrollTop });
      activate('scroll');
    });
    listen('scrollend', () => {
      recorder.record(surface, 'scrollend', {});
      activate('scrollend');
    });
    listen('touchstart', (event) => {
      touchY = event.touches[0]?.clientY ?? null;
      touchDirection = 0;
      recorder.userInput(surface, 'touchstart', 0, true);
      activate('touchstart');
    });
    listen('touchmove', (event) => {
      const y = event.touches[0]?.clientY ?? null;
      const delta = y !== null && touchY !== null ? touchY - y : 0;
      if (delta) touchDirection = Math.sign(delta);
      touchY = y;
      recorder.userInput(surface, 'touchmove', touchDirection, true, Math.round(delta));
      activate('touchmove');
    });
    for (const type of ['touchend', 'touchcancel'] as const)
      listen(type, () => {
        touchY = null;
        recorder.userInput(surface, type, touchDirection, false);
        activate(type);
      });
    listen('wheel', (event) => {
      recorder.userInput(
        surface,
        'wheel',
        Math.sign(event.deltaY),
        false,
        Math.round(event.deltaY),
      );
      activate('wheel');
    });
    listen('pointerdown', (event) => {
      recorder.userInput(surface, 'pointerdown', 0, false);
      recorder.record(surface, 'pointer-kind', { pointerType: event.pointerType });
      activate('pointerdown');
    });
    listen('keydown', (event) => {
      if (event.target !== element || event.altKey || event.ctrlKey || event.metaKey) return;
      if (!['Home', 'End', 'ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', ' '].includes(event.key))
        return;
      recorder.userInput(
        surface,
        'scroll-key',
        ['Home', 'ArrowUp', 'PageUp'].includes(event.key) || (event.key === ' ' && event.shiftKey)
          ? -1
          : 1,
        false,
      );
      activate('scroll-key');
    });
    const resize = new ResizeObserver(() => {
      recorder.record(surface, 'container-resize-observer', {
        width: element.clientWidth,
        height: element.clientHeight,
      });
      activate('container-resize');
    });
    resize.observe(element);
    // Instance-local native write probe: exact receiver/arguments, single delegate, restored on stop.
    // This catches Virtual's compensation/reconciliation without altering its options or globals.
    const ownScroll = Object.getOwnPropertyDescriptor(element, 'scrollTo');
    const originalScroll = element.scrollTo;
    const wrappedScroll: typeof element.scrollTo = function (
      this: HTMLDivElement,
      ...args: [options?: ScrollToOptions | undefined] | [x: number, y: number]
    ) {
      const value = args[0];
      const requested = typeof value === 'object' ? (value.top ?? null) : (args[1] ?? null);
      recorder.record(surface, 'native-scroll-write', {
        source: commandSource.current ?? 'internal-unknown',
        requestedOffset: requested,
        before: element.scrollTop,
        adjustments: virtual.scrollAdjustments,
      });
      Reflect.apply(originalScroll, this, args);
      recorder.record(surface, 'native-scroll-result', { scrollTop: element.scrollTop });
      activate('native-scroll-write');
    };
    try {
      Object.defineProperty(element, 'scrollTo', {
        value: wrappedScroll,
        configurable: true,
        writable: true,
      });
    } catch {
      recorder.record(surface, 'probe-unavailable', {
        probe: 'native-scroll-write',
        source: 'unknown',
      });
    }
    const originalResize = virtual.resizeItem;
    const wrappedResize: typeof originalResize = (index, size) => {
      const key = virtual.options.getItemKey(index);
      const oldSize = virtual.itemSizeCache.get(key) ?? null;
      if (oldSize !== size) {
        recorder.record(surface, 'row-measurement', {
          key: recorder.key(key),
          index,
          oldSize,
          size,
          firstMeasurement: oldSize === null,
        });
        activate('row-measurement');
      }
      originalResize(index, size);
    };
    virtual.resizeItem = wrappedResize;
    const idle = setInterval(() => {
      if (!frame) sample('idle-poll');
    }, 250);
    sample('recording-start');
    activate('recording-start');
    dispose = () => {
      cancelAnimationFrame(frame);
      clearInterval(idle);
      resize.disconnect();
      cleanups.forEach((cleanup) => cleanup());
      if (element.scrollTo === wrappedScroll) {
        if (ownScroll) Object.defineProperty(element, 'scrollTo', ownScroll);
        else delete (element as Partial<HTMLDivElement>).scrollTo;
      }
      if (virtual.resizeItem === wrappedResize) virtual.resizeItem = originalResize;
      wake.current = () => {};
    };
  };
  toggle();
  const unsubscribe = recorder.subscribe(toggle);
  return () => {
    unsubscribe();
    dispose();
    session.viewports.delete(element);
  };
}

function runScrollCommand<T>(
  owner: { current: Session | null },
  surface: ScrollSurface,
  container: RefObject<HTMLDivElement | null>,
  commandSource: { current: string | null },
  wake: { current: (reason: string) => void },
  type: string,
  reason: string,
  requested: number | null,
  operation: () => T,
): T {
  const session = owner.current;
  if (!session?.recorder.recording) return operation();
  const previous = commandSource.current;
  commandSource.current = reason;
  session.recorder.record(surface, 'command', {
    type,
    reason,
    requested,
    before: container.current?.scrollTop ?? null,
  });
  try {
    return operation();
  } finally {
    session.recorder.record(surface, 'command-result', {
      type,
      reason,
      after: container.current?.scrollTop ?? null,
    });
    commandSource.current = previous;
    wake.current('command');
  }
}
