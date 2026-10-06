import { z } from 'zod';
export const messageBodySchema = z
  .string()
  .max(4000)
  .refine((body) => body.trim().length > 0, 'Write a message (1–4,000 characters).');
export interface OrderedEntry {
  id: string;
  occurredAt: string;
  serverTieOrder: number;
  revision: number;
  tombstone: { deletedAt: string; reason: string } | null;
  authorId?: string | undefined;
  originatingClientMutationId?: string | undefined;
}
export interface DeliveredMessage extends OrderedEntry {
  incidentId: string;
  workspaceId?: string | undefined;
  body?: string | undefined;
  rootTimelineEntryId?: string | undefined;
  replyToMessageId?: string | null | undefined;
}
export interface OrderedWindow<Entry> {
  items: Entry[];
  olderCursor: string | null;
  newerCursor: string | null;
  total: number;
}
export function compareEntries<Entry extends OrderedEntry>(a: Entry, b: Entry) {
  return (
    a.occurredAt.localeCompare(b.occurredAt) ||
    a.serverTieOrder - b.serverTieOrder ||
    a.id.localeCompare(b.id)
  );
}
export function mergeEntries<Entry extends OrderedEntry>(
  index: Map<string, Entry>,
  entries: readonly Entry[],
) {
  for (const entry of entries) {
    const previous = index.get(entry.id);
    if (
      !previous ||
      entry.revision > previous.revision ||
      (entry.revision === previous.revision && entry.tombstone && !previous.tombstone)
    )
      index.set(entry.id, entry);
  }
  return index;
}
