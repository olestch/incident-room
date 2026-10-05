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
import type { WorkspaceUser } from '@/entities/current-user/model';
import { messageBodySchema, type TimelineEntry } from '@/entities/timeline/model';
import type { OutboxRecord } from './local-work';
import type { TimelineRow } from './projection';
import type { TimelineViewport } from './target-navigation';

export function SafeText({ text }: { text: string }) {
  const pieces = text.split(/(https?:\/\/[^\s<>]+)/g);
  return (
    <>
      {pieces.map((piece, index) => {
        let url: URL | null = null;
        try {
          if (/^https?:\/\//.test(piece)) url = new URL(piece);
        } catch {}
        return url &&
          ['http:', 'https:'].includes(url.protocol) &&
          !url.username &&
          !url.password ? (
          <a
            key={index}
            href={url.href}
            target="_blank"
            rel="noopener noreferrer"
            className="underline"
          >
            {piece}
          </a>
        ) : (
          <span key={index}>{piece}</span>
        );
      })}
    </>
  );
}
export function EntryContent({ entry, users }: { entry: TimelineEntry; users: WorkspaceUser[] }) {
  const name = (id: string) => users.find((user) => user.id === id)?.name ?? 'Workspace member';
  if (entry.tombstone)
    return (
      <>
        <strong>Deleted entry</strong>
        <p>Source no longer available. {entry.tombstone.reason}</p>
      </>
    );
  let content: ReactNode;
  switch (entry.type) {
    case 'human_message':
      content = (
        <>
          <strong>{name(entry.authorId)}</strong>
          <p className="whitespace-pre-wrap">
            <SafeText text={entry.body} />
          </p>
        </>
      );
      break;
    case 'monitoring_event':
      content = (
        <>
          <strong>Monitoring · {entry.source}</strong>
          <p>{entry.summary}</p>
        </>
      );
      break;
    case 'deployment_event':
      content = (
        <>
          <strong>
            Deployment · {entry.service} · {entry.version}
          </strong>
          <p>{entry.summary}</p>
        </>
      );
      break;
    case 'status_change':
      content = (
        <p>
          {name(entry.actorId)} changed status: {entry.from} → {entry.to}
        </p>
      );
      break;
    case 'severity_change':
      content = (
        <p>
          {name(entry.actorId)} changed severity: {entry.from} → {entry.to}
        </p>
      );
      break;
    case 'participant_event':
      content = (
        <p>
          Participant · {name(entry.participantId)} · {entry.action.replaceAll('_', ' ')}
        </p>
      );
      break;
    case 'system_event':
      content = (
        <>
          <strong>System event</strong>
          <p>{entry.summary}</p>
        </>
      );
      break;
  }
  return (
    <>
      {entry.important && <p className="text-sm">Important entry</p>}
      {content}
      <time className="text-xs text-muted" dateTime={entry.occurredAt}>
        {new Date(entry.occurredAt).toLocaleString()}
      </time>
    </>
  );
}
export function LocalEntry({
  record,
  retry,
  check,
  remove,
  writable,
}: {
  record: OutboxRecord;
  retry(id: string): void;
  check(id: string): void;
  remove(id: string): void;
  writable: boolean;
}) {
  return (
    <>
      <strong>
        Your message ·{' '}
        {record.state === 'unknown'
          ? 'Checking delivery'
          : record.state === 'sending'
            ? 'Sending'
            : 'Failed'}
      </strong>
      <p className="whitespace-pre-wrap">
        <SafeText text={record.body} />
      </p>
      {record.issue && <p>{record.issue}</p>}
      {record.state === 'failed' && (
        <div className="flex gap-2">
          <button
            className="incident-button"
            disabled={!writable || !record.retryAllowed}
            onClick={() => retry(record.clientMutationId)}
          >
            Retry message
          </button>
          <button className="incident-button" onClick={() => remove(record.clientMutationId)}>
            Delete local message
          </button>
        </div>
      )}
      {record.state === 'unknown' && (
        <button className="incident-button" onClick={() => check(record.clientMutationId)}>
          Check delivery
        </button>
      )}
    </>
  );
}

export const TimelineList = forwardRef<
  TimelineViewport,
  {
    rows: TimelineRow[];
    users: WorkspaceUser[];
    highlight: string | null;
    targetActive: boolean;
    retry(id: string): void;
    check(id: string): void;
    remove(id: string): void;
    loadGap(cursor: string): void;
    writable: boolean;
    newEntryIds?: string[];
    goLatest?(): void;
  }
>(function TimelineList(
  {
    rows,
    users,
    highlight,
    targetActive,
    retry,
    check,
    remove,
    loadGap,
    writable,
    newEntryIds = [],
    goLatest,
  },
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
  // eslint-disable-next-line react-hooks/incompatible-library -- This explicitly non-compiled boundary owns the mutable virtualizer; no methods cross into compiled children.
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
          className="incident-button my-2"
          onClick={() => {
            goLatest?.();
            virtual.scrollToEnd({ behavior: 'auto' });
            nearEnd.current = true;
            setUpdates([]);
          }}
        >
          New updates ({updates.length})
        </button>
      )}
      <div
        ref={container}
        className="timeline-viewport"
        tabIndex={0}
        aria-label="Timeline viewport"
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
          aria-label="Timeline entries"
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
                {highlight && row.entry?.id === highlight && (
                  <p className="font-semibold">Navigation target</p>
                )}
                {row.entry ? (
                  <EntryContent entry={row.entry} users={users} />
                ) : row.local ? (
                  <LocalEntry
                    record={row.local}
                    retry={retry}
                    check={check}
                    remove={remove}
                    writable={writable}
                  />
                ) : (
                  'gap' in row && (
                    <div>
                      <p>Unloaded Timeline history between windows</p>
                      <button className="incident-button" onClick={() => loadGap(row.gap.cursor)}>
                        Load this history gap
                      </button>
                    </div>
                  )
                )}
              </li>
            );
          })}
        </ol>
      </div>
    </>
  );
});

export function TimelineCompose({
  body,
  edit,
  send,
  discard,
  users,
  ready,
  busy,
  writable,
  resolved,
  issue,
}: {
  body: string;
  edit(body: string): void;
  send(): void;
  discard(): void;
  users: WorkspaceUser[];
  ready: boolean;
  busy: boolean;
  writable: boolean;
  resolved: boolean;
  issue: string | null;
}) {
  const [validation, setValidation] = useState<string | null>(null);
  const submit = () => {
    const result = messageBodySchema.safeParse(body);
    if (!result.success) {
      setValidation('Write a message (1–4,000 characters).');
      return;
    }
    setValidation(null);
    send();
  };
  if (!writable)
    return (
      <p className="p-4" role="note">
        {resolved
          ? 'Resolved incident: Timeline is read-only.'
          : 'Read-only Timeline: participants, commander and admins may send messages.'}
      </p>
    );
  return (
    <form
      className="timeline-compose"
      aria-label="Timeline compose"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <label htmlFor="timeline-body" className="font-semibold">
        Message
      </label>
      <textarea
        id="timeline-body"
        className="incident-input mt-2"
        rows={3}
        maxLength={4000}
        value={body}
        disabled={!ready || busy}
        aria-describedby="timeline-compose-help timeline-compose-error"
        aria-invalid={!!validation}
        onChange={(event) => {
          setValidation(null);
          edit(event.target.value);
        }}
        onKeyDown={(event) => {
          if (
            event.key === 'Enter' &&
            (event.ctrlKey || event.metaKey) &&
            !event.nativeEvent.isComposing
          ) {
            event.preventDefault();
            if (!busy && ready) submit();
          }
        }}
      />
      <p id="timeline-compose-help" className="text-sm text-muted">
        Plain text · {body.length}/4,000 · Enter: newline · Ctrl/Cmd+Enter: Send
      </p>
      <p id="timeline-compose-error" role={validation || issue ? 'alert' : undefined}>
        {validation ?? issue}
      </p>
      <div className="flex flex-wrap items-center gap-2 mt-2">
        <button
          className="incident-button incident-primary"
          type="submit"
          disabled={!ready || busy}
        >
          Send
        </button>
        <button
          className="incident-button"
          type="button"
          disabled={!ready || busy || !body}
          onClick={discard}
        >
          Discard draft
        </button>
        <label className="text-sm">
          Mention{' '}
          <select
            className="incident-input"
            aria-label="Mention workspace user"
            value=""
            disabled={!ready || busy}
            onChange={(event) => {
              const user = users.find((candidate) => candidate.id === event.target.value);
              if (user)
                edit(
                  `${body}${body && !body.endsWith(' ') ? ' ' : ''}@${user.name} [${user.id}] `.slice(
                    0,
                    4000,
                  ),
                );
            }}
          >
            <option value="">Choose a person</option>
            {users
              .filter((user) => user.status === 'active')
              .slice(0, 200)
              .map((user) => (
                <option key={user.id} value={user.id}>
                  {user.name}
                </option>
              ))}
          </select>
        </label>
      </div>
    </form>
  );
}
