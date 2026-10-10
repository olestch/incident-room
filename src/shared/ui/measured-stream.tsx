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
    onUserScroll?: (() => void) | undefined;
  }
>(function MeasuredStream(
  {
    rows,
    renderRow,
    label,
    highlight,
    targetActive,
    targetId,
    newEntryIds = [],
    goLatest,
    onUserScroll,
  },
  ref,
) {
  'use no memo'; // Compatibility boundary for TanStack Virtual's mutable imperative instance.
  const container = useRef<HTMLDivElement>(null);
  const pendingReveal = useRef<{
    id: string;
    index: number | null;
    resolve(): void;
    reject(reason: unknown): void;
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
  // Virtual owns prepend anchoring, size compensation and near-end append following.
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
  // Keep late growth entirely above a reader anchored even during backward scrolling.
  // Virtual's default skips that remeasurement, which loses the anchor (browser regression).
  // First measurements also replace the estimated block of the partially visible row.
  virtual.shouldAdjustScrollPositionOnItemSizeChange = (item, _delta, instance) => {
    const offset = (instance.scrollOffset ?? 0) + instance.scrollAdjustments;
    return instance.itemSizeCache.has(item.key) ? item.end <= offset : item.start < offset;
  };
  const virtualItems = virtual.getVirtualItems();
  const cancelReveal = useCallback(
    (reason: unknown, stopScroll = true) => {
      const task = pendingReveal.current;
      pendingReveal.current = null;
      task?.cleanup();
      // Virtual has no separate cancellation API. Replace its pending target once.
      if (stopScroll && task && task.index !== null && container.current)
        virtual.scrollToOffset(container.current.scrollTop, { behavior: 'auto' });
      task?.reject(reason);
    },
    [virtual],
  );
  // Readiness observes the bounded mounted range; it never issues a scroll command.
  const resolveVisibleTarget = useCallback(() => {
    const task = pendingReveal.current;
    const scroller = container.current;
    if (!task || task.index === null || !scroller) return;
    const node = [...scroller.querySelectorAll<HTMLElement>('[data-entry-id]')].find(
      (row) => row.dataset.entryId === task.id,
    );
    if (!node) return;
    const box = node.getBoundingClientRect();
    const frame = scroller.getBoundingClientRect();
    if (box.height && box.bottom > frame.top && box.top < frame.bottom) {
      pendingReveal.current = null;
      task.cleanup();
      task.resolve();
    }
  }, []);
  const startTargetScroll = useCallback(() => {
    const task = pendingReveal.current;
    if (!task) return;
    const index = targetIndexes.get(task.id);
    if (index === undefined || task.index === index) return;
    task.index = index;
    widthAnchor.current = null;
    // Command once per acquired index (prepend may move it); Virtual reconciles row sizes.
    virtual.scrollToIndex(index, { align: 'center', behavior: 'auto' });
  }, [targetIndexes, virtual]);
  const latest = useCallback(() => {
    cancelReveal(new DOMException('Latest requested', 'AbortError'));
    widthAnchor.current = null;
    initialized.current = true;
    nearEnd.current = true;
    setUpdates([]);
    virtual.scrollToEnd({ behavior: 'auto' });
  }, [cancelReveal, virtual]);
  const interruptNavigation = () => {
    cancelReveal(new DOMException('User took scroll control', 'AbortError'));
    widthAnchor.current = null;
    initialized.current = true;
    onUserScroll?.(); // The route also owns acquisition, which may not have reached reveal yet.
  };
  useImperativeHandle(
    ref,
    () => ({
      latest,
      reveal: (id, signal) =>
        new Promise<void>((resolve, reject) => {
          cancelReveal(new DOMException('Target superseded', 'AbortError'));
          if (signal.aborted) {
            reject(signal.reason);
            return;
          }
          const task = {
            id,
            index: null as number | null,
            resolve,
            reject,
            cleanup: () => signal.removeEventListener('abort', abort),
          };
          const abort = () => {
            if (pendingReveal.current === task) cancelReveal(signal.reason);
          };
          signal.addEventListener('abort', abort, { once: true });
          pendingReveal.current = task;
          initialized.current = true;
          startTargetScroll();
          resolveVisibleTarget();
        }),
    }),
    [cancelReveal, latest, startTargetScroll, resolveVisibleTarget],
  );
  useLayoutEffect(() => {
    startTargetScroll();
    const anchor = widthAnchor.current;
    if (anchor && !pendingReveal.current) {
      widthAnchor.current = null;
      const index = indexes.get(anchor.key);
      const position = index === undefined ? undefined : virtual.getOffsetForIndex(index, 'start');
      if (position) virtual.scrollToOffset(position[0] + anchor.offset, { behavior: 'auto' });
    }
    if (focused && !indexes.has(focused)) container.current?.focus({ preventScroll: true });
    if (rows.length && !initialized.current && !targetActive) {
      initialized.current = true;
      virtual.scrollToEnd({ behavior: 'auto' });
    }
    resolveVisibleTarget();
  }, [
    virtualItems,
    indexes,
    focused,
    rows.length,
    targetActive,
    startTargetScroll,
    resolveVisibleTarget,
    virtual,
  ]);
  useEffect(() => {
    const element = container.current;
    if (!element) return;
    let width = element.clientWidth;
    const observer = new ResizeObserver(() => {
      if (width !== element.clientWidth) {
        width = element.clientWidth;
        const item = virtual.getVirtualItemForOffset(element.scrollTop);
        if (item && !pendingReveal.current)
          widthAnchor.current = { key: String(item.key), offset: element.scrollTop - item.start };
        // Replace any previous absolute navigation with this position before invalidation.
        // This also keeps Virtual's synchronous measurement path active during resize.
        if (!pendingReveal.current) virtual.scrollToOffset(element.scrollTop, { behavior: 'auto' });
        virtual.measure();
        // Width invalidation requires fresh mounted sizes before restoring its anchor.
        // Stable refs do not reattach on this render; measure this bounded range explicitly.
        virtual.getVirtualItems();
        for (const node of element.querySelectorAll<HTMLLIElement>('[data-index]'))
          virtual.measureElement(node);
      }
      resolveVisibleTarget();
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [virtual, resolveVisibleTarget]);
  useEffect(
    () => () => cancelReveal(new DOMException('Viewport disposed', 'AbortError'), false),
    [cancelReveal],
  );
  return (
    <>
      {updates.length > 0 && (
        <button
          className="incident-button stream-new-updates"
          onClick={() => {
            if (goLatest) goLatest();
            else latest();
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
        onWheel={interruptNavigation}
        onTouchMove={interruptNavigation}
        onPointerDown={(event) => {
          if (event.target === event.currentTarget) interruptNavigation();
        }}
        onKeyDown={(event) => {
          if (
            event.target !== event.currentTarget ||
            event.altKey ||
            event.metaKey ||
            event.ctrlKey
          )
            return;
          if (
            !['Home', 'End', 'ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', ' '].includes(event.key)
          )
            return;
          interruptNavigation();
          if (event.key !== 'Home' && event.key !== 'End') return;
          event.preventDefault();
          if (event.key === 'Home') virtual.scrollToIndex(0, { align: 'start', behavior: 'auto' });
          else latest();
        }}
        onScroll={() => {
          resolveVisibleTarget();
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
          {virtualItems.map((item) => {
            const row = rows[item.index]!;
            return (
              <li
                key={row.key}
                data-row-key={row.key}
                data-entry-id={row.entry?.id}
                data-index={item.index}
                aria-posinset={item.index + 1}
                aria-setsize={rows.length}
                ref={virtual.measureElement}
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
