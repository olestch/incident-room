import { z } from 'zod';
import { messageBodySchema } from '@/entities/timeline/model';
import { IndexedDbAtomicStore, type AtomicStore } from '@/shared/persistence/atomic-store';

export interface LocalScope {
  userId: string;
  workspaceId: string;
  incidentId: string;
}
export const outboxSchema = z.object({
  clientMutationId: z.uuid(),
  userId: z.string(),
  workspaceId: z.string(),
  incidentId: z.string(),
  body: messageBodySchema,
  provisionalAt: z.iso.datetime(),
  state: z.enum(['sending', 'unknown', 'failed']),
  attempts: z.number().int().nonnegative(),
  lastAttemptAt: z.iso.datetime().nullable(),
  issue: z.string().nullable(),
  retryAllowed: z.boolean(),
});
export type OutboxRecord = z.infer<typeof outboxSchema>;
export const localDataSchema = z.object({
  drafts: z.record(z.string(), z.string().max(4000)),
  outbox: z.array(outboxSchema),
});
export type LocalData = z.infer<typeof localDataSchema>;
export const emptyLocalData = (): LocalData => ({ drafts: {}, outbox: [] });
export const identityKey = (scope: Pick<LocalScope, 'userId' | 'workspaceId'>) =>
  JSON.stringify([scope.userId, scope.workspaceId]);
export const makeLocalStore = () =>
  new IndexedDbAtomicStore('incident-room-local-work-v1', emptyLocalData, (raw) =>
    localDataSchema.parse(raw),
  );
export interface LocalLease {
  scope: LocalScope;
  valid(): boolean;
}
/** Runtime queue/leases never enter Redux. stop drains all started storage transactions before logout deletion. */
export class LocalWorkService {
  private epochs = new Map<string, number>();
  private pending = new Map<string, Set<Promise<unknown>>>();
  constructor(private readonly store: AtomicStore<LocalData> = makeLocalStore()) {}
  lease(scope: LocalScope): LocalLease {
    const key = identityKey(scope);
    const epoch = this.epochs.get(key) ?? 0;
    return { scope, valid: () => (this.epochs.get(key) ?? 0) === epoch };
  }
  private operation<R>(lease: LocalLease, operation: (data: LocalData) => R): Promise<R> {
    if (!lease.valid())
      return Promise.reject(new DOMException('Local work quarantined', 'AbortError'));
    const key = identityKey(lease.scope);
    const task = this.store.transact(key, (data) => {
      if (!lease.valid()) throw new DOMException('Local work quarantined', 'AbortError');
      return operation(data);
    });
    const tasks = this.pending.get(key) ?? new Set();
    tasks.add(task);
    this.pending.set(key, tasks);
    void task
      .finally(() => {
        tasks.delete(task);
      })
      .catch(() => {});
    return task;
  }
  read(lease: LocalLease) {
    return this.operation(lease, (data) => ({
      draft: data.drafts[lease.scope.incidentId] ?? '',
      records: data.outbox
        .filter(
          (record) =>
            record.incidentId === lease.scope.incidentId &&
            record.userId === lease.scope.userId &&
            record.workspaceId === lease.scope.workspaceId,
        )
        .map((record) => ({ ...record })),
    }));
  }
  draft(lease: LocalLease, body: string) {
    return this.operation(lease, (data) => {
      if (body) data.drafts[lease.scope.incidentId] = z.string().max(4000).parse(body);
      else delete data.drafts[lease.scope.incidentId];
    });
  }
  async handoff(lease: LocalLease, body: string, now = Date.now(), id = crypto.randomUUID()) {
    const record = outboxSchema.parse({
      ...lease.scope,
      clientMutationId: id,
      body: messageBodySchema.parse(body),
      provisionalAt: new Date(now).toISOString(),
      state: 'sending',
      attempts: 0,
      lastAttemptAt: null,
      issue: null,
      retryAllowed: false,
    });
    return this.operation(lease, (data) => {
      data.outbox.push(record);
      delete data.drafts[lease.scope.incidentId];
      return record;
    });
  }
  update(lease: LocalLease, record: OutboxRecord) {
    if (
      record.userId !== lease.scope.userId ||
      record.workspaceId !== lease.scope.workspaceId ||
      record.incidentId !== lease.scope.incidentId
    )
      return Promise.reject(new Error('Local record scope mismatch'));
    return this.operation(lease, (data) => {
      const index = data.outbox.findIndex(
        (item) =>
          item.clientMutationId === record.clientMutationId &&
          item.incidentId === lease.scope.incidentId &&
          item.userId === lease.scope.userId &&
          item.workspaceId === lease.scope.workspaceId,
      );
      if (index >= 0) data.outbox[index] = outboxSchema.parse(record);
    });
  }
  remove(lease: LocalLease, id: string) {
    return this.operation(lease, (data) => {
      data.outbox = data.outbox.filter(
        (record) =>
          !(
            record.incidentId === lease.scope.incidentId &&
            record.userId === lease.scope.userId &&
            record.workspaceId === lease.scope.workspaceId &&
            record.clientMutationId === id
          ),
      );
    });
  }
  async stop(scope: Pick<LocalScope, 'userId' | 'workspaceId'>) {
    const key = identityKey(scope);
    this.epochs.set(key, (this.epochs.get(key) ?? 0) + 1);
    await Promise.allSettled([...(this.pending.get(key) ?? [])]);
  }
  async clearDurableOnLogout(scope: Pick<LocalScope, 'userId' | 'workspaceId'>) {
    await this.store.transact(identityKey(scope), (data) => {
      data.drafts = {};
      data.outbox = [];
    });
  }
}
