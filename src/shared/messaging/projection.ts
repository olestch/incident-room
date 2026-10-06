import { compareEntries, mergeEntries, type OrderedEntry, type OrderedWindow } from './model';
import type { OutboxRecord } from './local-work';

export type StreamRow<Entry extends OrderedEntry> =
  | { key: string; entry: Entry; local?: never }
  | { key: string; local: OutboxRecord; entry?: never }
  | { key: string; gap: { cursor: string }; entry?: never; local?: never };
/** Memoize at the caller on changed Query pages/local records, not viewport renders. */
export class StreamProjection<Entry extends OrderedEntry> {
  private index = new Map<string, Entry>();
  private aliases = new Map<string, string>();
  private previousWindows: readonly OrderedWindow<Entry>[] | null = null;
  private previousAcknowledgments: readonly Entry[] | null = null;
  private cachedRows: StreamRow<Entry>[] = [];
  private confirmedMutationIds = new Set<string>();
  build(
    windows: readonly OrderedWindow<Entry>[],
    acknowledgments: readonly Entry[],
    local: readonly OutboxRecord[],
  ): StreamRow<Entry>[] {
    for (const record of local)
      this.aliases.set(
        JSON.stringify([record.userId, record.clientMutationId]),
        `local:${record.userId}:${record.clientMutationId}`,
      );
    if (windows !== this.previousWindows || acknowledgments !== this.previousAcknowledgments) {
      this.previousWindows = windows;
      this.previousAcknowledgments = acknowledgments;
      for (const window of windows) mergeEntries(this.index, window.items);
      mergeEntries(this.index, acknowledgments);
      const confirmed = [...this.index.values()].sort(compareEntries);
      const confirmedMutationIds = new Set<string>();
      const rows: StreamRow<Entry>[] = [];
      // Explicit gap rows: sparse target windows never claim uninterrupted history.
      const covered = new Map<string, string | null>();
      const boundaries = new Map(
        windows.flatMap((window) =>
          window.items[0] && window.olderCursor
            ? [[window.items[0].id, window.olderCursor] as const]
            : [],
        ),
      );
      for (const window of windows)
        for (let i = 1; i < window.items.length; i++)
          covered.set(window.items[i - 1]!.id, window.items[i]!.id);
      for (let index = 0; index < confirmed.length; index++) {
        const entry = confirmed[index]!;
        const mutationId =
          entry.authorId && entry.originatingClientMutationId
            ? JSON.stringify([entry.authorId, entry.originatingClientMutationId])
            : undefined;
        if (mutationId) confirmedMutationIds.add(mutationId);
        rows.push({
          key:
            mutationId && entry.authorId
              ? (this.aliases.get(mutationId) ??
                `local:${entry.authorId}:${entry.originatingClientMutationId}`)
              : entry.id,
          entry,
        });
        const next = confirmed[index + 1];
        if (
          next &&
          covered.get(entry.id) !== next.id &&
          entry.serverTieOrder + 1 < next.serverTieOrder
        ) {
          const cursor = boundaries.get(next.id);
          if (cursor) rows.push({ key: `gap:${entry.id}:${next.id}`, gap: { cursor } });
        }
      }
      this.cachedRows = rows;
      this.confirmedMutationIds = confirmedMutationIds;
    }
    const rows = [...this.cachedRows];
    const pending = local
      .filter(
        (record) =>
          !this.confirmedMutationIds.has(JSON.stringify([record.userId, record.clientMutationId])),
      )
      .sort(
        (a, b) =>
          a.provisionalAt.localeCompare(b.provisionalAt) ||
          a.clientMutationId.localeCompare(b.clientMutationId),
      );
    for (const record of pending)
      rows.push({ key: `local:${record.userId}:${record.clientMutationId}`, local: record });
    return rows;
  }
}
