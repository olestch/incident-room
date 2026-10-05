import { z } from 'zod';
import { IndexedDbAtomicStore, type AtomicStore } from '@/shared/persistence/atomic-store';
import { persistentEventSchema, streamSchema, type PersistentEvent } from './protocol';

export const journalSchema = z.object({
  highWater: z.number().int().nonnegative(),
  events: z.array(persistentEventSchema),
  revisions: z.record(z.string(), z.number()),
  controls: z.record(z.string(), streamSchema.shape.controls).default({}),
  expireBefore: z.number().int().nonnegative().default(0),
});
export type JournalData = z.infer<typeof journalSchema>;
export const seedJournal = (): JournalData => ({
  highWater: 0,
  events: [],
  revisions: {},
  controls: {},
  expireBefore: 0,
});
export const makeJournalStore = () =>
  new IndexedDbAtomicStore('incident-room-fictional-journal-v1', seedJournal, (raw) =>
    journalSchema.parse(raw),
  );
/** Durable workspace sequence. Source authorities atomically retain changes with each mutation;
 * ingestion is idempotent and recoverable after interruption between the two databases. */
export class EventJournal {
  constructor(
    private readonly store: AtomicStore<JournalData>,
    private readonly retention = 2000,
  ) {}
  append(workspace: string, changes: readonly Omit<PersistentEvent, 'sequence'>[]) {
    return this.store.transact(workspace, (data) => {
      for (const change of changes) {
        const event = persistentEventSchema.parse({ ...change, sequence: data.highWater + 1 });
        if (event.workspaceId !== workspace) throw new Error('Journal workspace mismatch');
        const resource = JSON.stringify([event.resourceType, event.resourceId]);
        if ((data.revisions[resource] ?? 0) >= event.revision) continue;
        data.revisions[resource] = event.revision;
        data.highWater++;
        data.events.push(event);
      }
      if (data.events.length > this.retention)
        data.events.splice(0, data.events.length - this.retention);
      return data.highWater;
    });
  }
  read(workspace: string, after: number, boundary?: number) {
    return this.store.transact(workspace, (data) => {
      const highWater = boundary ?? data.highWater;
      if (after > highWater || highWater > data.highWater) throw new Error('Invalid checkpoint');
      const floor = Math.max(
        data.expireBefore,
        (data.events[0]?.sequence ?? data.highWater + 1) - 1,
      );
      const expired = after < floor;
      const events = expired
        ? []
        : data.events
            .filter((event) => event.sequence > after && event.sequence <= highWater)
            .slice(0, 100);
      return {
        events,
        highWater,
        through: events.at(-1)?.sequence ?? (expired ? after : highWater),
        expired,
      };
    });
  }
  controls(workspace: string, client: string) {
    return this.store.transact(workspace, (data) =>
      streamSchema.shape.controls.parse(data.controls[client] ?? {}),
    );
  }
}
