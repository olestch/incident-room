'use client';
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { defaultRangeExtractor, useVirtualizer } from '@tanstack/react-virtual';
import type { TimelineViewport } from '@/shared/messaging/target-navigation';
export const MeasuredStream = forwardRef<
  TimelineViewport,
  {
    rows: { key: string; entry?: { id: string } }[];
    renderRow(index: number): ReactNode;
    label: string;
    highlight: string | null;
    targetActive: boolean;
    targetId?: string | null | undefined;
    newEntryIds?: string[] | undefined;
    goLatest?: (() => void) | undefined;
  }
>(function MeasuredStream(
  { rows, renderRow, label, highlight, targetActive, targetId, newEntryIds = [], goLatest },
  ref,
) {
  'use no memo'; // TanStack Virtual exposes mutable imperative methods; keep this measured boundary outside React Compiler.
  const container = useRef<HTMLDivElement>(null);
  const mounted = useRef(new Map<string, HTMLLIElement>());
  const pending = useRef<{
    id: string;
    resolve(): void;
    reject(reason: unknown): void;
    signal: AbortSignal;
    cleanup(): void;
  } | null>(null);
  const initialized = useRef(false);
  const widthAnchor = useRef<{ key: string; offset: number } | null>(null);
  const [focused, setFocused] = useState<string | null>(null);
  const counted = useRef(new Set<string>());
  const nearEnd = useRef(true);
  const [updates, setUpdates] = useState<string[]>([]);
  useEffect(() => {
    const fresh = newEntryIds.filter((id) => !counted.current.has(id));
    for (const id of fresh) counted.current.add(id);
    if (fresh.length && (!nearEnd.current || targetActive))
      setUpdates((previous) => [...previous, ...fresh]);
  }, [newEntryIds, targetActive]);
  const indexes = useMemo(() => new Map(rows.map((row, index) => [row.key, index])), [rows]);
  const targetIndexes = useMemo(
    () =>
      new Map(rows.flatMap((row, index) => (row.entry ? [[row.entry.id, index] as const] : []))),
    [rows],
  );
  const key = useCallback((index: number) => rows[index]!.key, [rows]);
  const range = useCallback(
    (value: Parameters<typeof defaultRangeExtractor>[0]) => {
      const indexesInRange = defaultRangeExtractor(value);
      const focusIndex = focused ? indexes.get(focused) : undefined;
      return focusIndex === undefined
        ? indexesInRange
        : [...new Set([...indexesInRange, focusIndex])].sort((a, b) => a - b);
    },
    [focused, indexes],
  );
  const virtual = useVirtualizer<HTMLDivElement, HTMLLIElement>({
    count: rows.length,
    getScrollElement: () => container.current,
    estimateSize: () => 130,
    getItemKey: key,
    overscan: 6,
    rangeExtractor: range,
    anchorTo: 'end',
    followOnAppend: targetActive ? false : 'auto',
    scrollEndThreshold: 96,
  });
  // Measured content above the reading anchor must compensate even after backward scrolling.
  virtual.shouldAdjustScrollPositionOnItemSizeChange = (item, _delta, instance) =>
    item.end <= (instance.scrollOffset ?? 0);
  const settle = useCallback(() => {
    const task = pending.current;
    if (!task || task.signal.aborted) return;
    const index = targetIndexes.get(task.id);
    if (index === undefined) return;
    virtual.scrollToIndex(index, { align: 'center', behavior: 'auto' });
    const node = mounted.current.get(task.id);
    const scroller = container.current;
    if (!node || !scroller || !node.getBoundingClientRect().height) return;
    const box = node.getBoundingClientRect();
    const frame = scroller.getBoundingClientRect();
    if (box.bottom > frame.top && box.top < frame.bottom) {
      task.cleanup();
      pending.current = null;
      task.resolve();
    }
  }, [targetIndexes, virtual]);
  useImperativeHandle(
    ref,
    () => ({
      latest: () => {
        initialized.current = true;
        virtual.scrollToEnd({ behavior: 'auto' });
      },
      reveal: (id, signal) =>
        new Promise<void>((resolve, reject) => {
          pending.current?.reject(new DOMException('Target superseded', 'AbortError'));
          pending.current?.cleanup();
          const abort = () => {
            if (pending.current?.id === id) pending.current = null;
            reject(signal.reason);
          };
          const cleanup = () => signal.removeEventListener('abort', abort);
          if (signal.aborted) {
            reject(signal.reason);
            return;
          }
          signal.addEventListener('abort', abort, { once: true });
          pending.current = { id, signal, resolve, reject, cleanup };
          const index = targetIndexes.get(id);
          initialized.current = true;
          if (index !== undefined)
            virtual.scrollToIndex(index, { align: 'center', behavior: 'auto' });
          settle();
        }),
    }),
    [settle, targetIndexes, virtual],
  );
  useLayoutEffect(() => {
    const anchor = widthAnchor.current;
    if (anchor) {
      const index = indexes.get(anchor.key);
      const position = index === undefined ? undefined : virtual.getOffsetForIndex(index, 'start');
      if (position) virtual.scrollToOffset(position[0] + anchor.offset, { behavior: 'auto' });
      widthAnchor.current = null;
    }
    if (focused && !indexes.has(focused)) container.current?.focus({ preventScroll: true });
    if (rows.length && !initialized.current && !targetActive) {
      initialized.current = true;
      virtual.scrollToEnd({ behavior: 'auto' });
    }
    settle();
  });
  useEffect(() => {
    const element = container.current;
    if (!element) return;
    let width = element.clientWidth;
    const observer = new ResizeObserver(() => {
      if (width !== element.clientWidth) {
        width = element.clientWidth;
        const item = virtual.getVirtualItemForOffset(element.scrollTop);
        if (item)
          widthAnchor.current = { key: String(item.key), offset: element.scrollTop - item.start };
        virtual.measure();
      }
      settle();
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [virtual, settle]);
  useEffect(
    () => () => {
      pending.current?.cleanup();
      pending.current?.reject(new DOMException('Viewport disposed', 'AbortError'));
      pending.current = null;
    },
    [],
  );
  return (
    <>
      {updates.length > 0 && (
        <button
          className="incident-button stream-new-updates"
          onClick={() => {
            goLatest?.();
            virtual.scrollToEnd({ behavior: 'auto' });
            nearEnd.current = true;
            setUpdates([]);
          }}
        >
          {label === 'Thread' ? 'New replies' : 'New updates'} ({updates.length})
        </button>
      )}
      <div
        ref={container}
        className="timeline-viewport"
        tabIndex={0}
        aria-label={`${label} viewport`}
        onKeyDown={(event) => {
          if (
            event.target !== event.currentTarget ||
            event.altKey ||
            event.metaKey ||
            event.ctrlKey
          )
            return;
          if (event.key !== 'Home' && event.key !== 'End') return;
          event.preventDefault();
          // Let the virtualizer reconcile variable heights after an explicit keyboard jump.
          widthAnchor.current = null;
          if (event.key === 'Home') virtual.scrollToIndex(0, { align: 'start', behavior: 'auto' });
          else virtual.scrollToEnd({ behavior: 'auto' });
        }}
        onScroll={() => {
          settle();
          const node = container.current;
          nearEnd.current = !!node && node.scrollHeight - node.clientHeight - node.scrollTop <= 96;
          if (nearEnd.current && !targetActive)
            setUpdates((previous) => (previous.length ? [] : previous));
        }}
        onFocusCapture={(event) => {
          const item = (event.target as HTMLElement).closest<HTMLElement>('[data-row-key]');
          if (item) setFocused(item.dataset.rowKey ?? null);
        }}
        onBlurCapture={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) setFocused(null);
        }}
      >
        <ol
          aria-label={`${label} entries`}
          style={{ height: virtual.getTotalSize(), position: 'relative', margin: 0, padding: 0 }}
        >
          {virtual.getVirtualItems().map((item) => {
            const row = rows[item.index]!;
            return (
              <li
                key={row.key}
                data-row-key={row.key}
                data-entry-id={row.entry?.id}
                data-index={item.index}
                aria-posinset={item.index + 1}
                aria-setsize={rows.length}
                ref={(node) => {
                  virtual.measureElement(node);
                  if (row.entry) {
                    if (node) mounted.current.set(row.entry.id, node);
                    else mounted.current.delete(row.entry.id);
                  }
                  if (node) queueMicrotask(settle);
                }}
                className={`timeline-row ${highlight && row.entry?.id === highlight ? 'timeline-target' : ''}`}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  transform: `translateY(${item.start}px)`,
                }}
              >
                {(targetActive ? (targetId ?? highlight) : highlight) === row.entry?.id &&
                  row.entry && <p className="stream-target-label">Navigation target</p>}
                {renderRow(item.index)}
              </li>
            );
          })}
        </ol>
      </div>
    </>
  );
});
