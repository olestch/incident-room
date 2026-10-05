import type { TimelineEntry } from '@/entities/timeline/model';
import { AppError } from '@/shared/errors/app-error';
import type { LocalLease, LocalWorkService, OutboxRecord } from './local-work';

export interface DeliveryPort {
  create(record: OutboxRecord, signal: AbortSignal): Promise<TimelineEntry>;
  lookup(
    id: string,
    signal: AbortSignal,
  ): Promise<{ status: 'found'; entry: TimelineEntry } | { status: 'missing' }>;
  confirmed(entry: TimelineEntry): void;
  changed(records: OutboxRecord[]): void;
  rejected?(error: AppError): void;
}
/** One coordinator per mounted room; restore never replays a mutation automatically. */
export class DeliveryCoordinator {
  private records = new Map<string, OutboxRecord>();
  private controller = new AbortController();
  private inFlight = new Map<string, Promise<void>>();
  constructor(
    private readonly storage: LocalWorkService,
    private readonly lease: LocalLease,
    private readonly port: DeliveryPort,
  ) {}
  private active() {
    return !this.controller.signal.aborted && this.lease.valid();
  }
  private emit() {
    if (this.active()) this.port.changed([...this.records.values()]);
  }
  async restore() {
    const data = await this.storage.read(this.lease);
    if (!this.active()) throw new DOMException('Room superseded', 'AbortError');
    for (const record of data.records) this.records.set(record.clientMutationId, record);
    this.emit();
    // All previously sending records are ambiguous, including a crash before dispatch.
    for (const record of data.records) await this.check(record.clientMutationId);
    return data.draft;
  }
  async prepare(body: string) {
    const record = await this.storage.handoff(this.lease, body);
    if (!this.active()) throw new DOMException('Room superseded', 'AbortError');
    this.records.set(record.clientMutationId, record);
    return record;
  }
  /** Called only after the editor has cleared following durable preparation. */
  exposeAndSend(record: OutboxRecord) {
    this.emit();
    return this.send(record.clientMutationId);
  }
  private coalesce(id: string, operation: () => Promise<void>) {
    const existing = this.inFlight.get(id);
    if (existing) return existing;
    const task = operation()
      .catch((error: unknown) => {
        const record = this.records.get(id);
        if (record && this.active()) {
          this.records.set(id, {
            ...record,
            state: 'unknown',
            retryAllowed: false,
            issue:
              'Local delivery state could not be saved. Check storage and delivery before retrying.',
          });
          this.emit();
        }
        throw error;
      })
      .finally(() => {
        this.inFlight.delete(id);
      });
    this.inFlight.set(id, task);
    return task;
  }
  private async save(record: OutboxRecord) {
    if (!this.active()) return;
    await this.storage.update(this.lease, record);
    if (!this.active()) return;
    this.records.set(record.clientMutationId, record);
    this.emit();
  }
  private async associate(id: string, entry: TimelineEntry) {
    if (!this.active()) return;
    if (
      entry.incidentId !== this.lease.scope.incidentId ||
      entry.type !== 'human_message' ||
      entry.authorId !== this.lease.scope.userId ||
      entry.originatingClientMutationId !== id
    )
      throw new AppError('validation', 'Invalid mutation confirmation.');
    const record = this.records.get(id);
    if (record && !entry.tombstone && entry.body !== record.body)
      throw new AppError('validation', 'Confirmation content does not match this mutation.');
    this.port.confirmed(entry); // Query association happens synchronously BEFORE durable/local removal.
    await this.storage.remove(this.lease, id);
    if (!this.active()) return;
    this.records.delete(id);
    this.emit();
  }
  async acknowledge(entry: TimelineEntry) {
    if (
      entry.type === 'human_message' &&
      entry.originatingClientMutationId &&
      this.records.has(entry.originatingClientMutationId)
    )
      await this.associate(entry.originatingClientMutationId, entry);
  }
  check(id: string) {
    return this.coalesce(id, () => this.lookup(id));
  }
  private async lookup(id: string) {
    const record = this.records.get(id);
    if (!record || !this.active()) return;
    await this.save({
      ...record,
      state: 'unknown',
      retryAllowed: false,
      issue: 'Checking delivery…',
    });
    try {
      const result = await this.port.lookup(id, this.controller.signal);
      if (!this.active()) return;
      if (result.status === 'found') await this.associate(id, result.entry);
      else
        await this.save({
          ...record,
          state: 'failed',
          retryAllowed: true,
          issue: 'Authority confirms no message was saved. Retry uses the same identity.',
        });
    } catch {
      if (this.active())
        await this.save({
          ...record,
          state: 'unknown',
          retryAllowed: false,
          issue: 'Delivery could not be checked. Check again before retrying.',
        });
    }
  }
  retry(id: string) {
    return this.coalesce(id, async () => {
      await this.lookup(id);
      const record = this.records.get(id);
      if (record?.state === 'failed' && record.retryAllowed && this.active())
        await this.dispatch(id);
    });
  }
  send(id: string) {
    return this.coalesce(id, () => this.dispatch(id));
  }
  private async dispatch(id: string) {
    const record = this.records.get(id);
    if (!record || !this.active()) return;
    const sending: OutboxRecord = {
      ...record,
      state: 'sending',
      retryAllowed: false,
      issue: null,
      attempts: record.attempts + 1,
      lastAttemptAt: new Date().toISOString(),
    };
    await this.save(sending);
    try {
      const entry = await this.port.create(sending, this.controller.signal);
      await this.associate(id, entry);
    } catch (error) {
      if (!this.active()) return;
      if (
        error instanceof AppError &&
        ['validation', 'authorization', 'conflict'].includes(error.category) &&
        error.status !== undefined &&
        error.status >= 400 &&
        error.status < 500
      ) {
        this.port.rejected?.(error);
        await this.save({
          ...sending,
          state: 'failed',
          retryAllowed: error.category === 'validation',
          issue: error.message,
        });
      } else {
        await this.save({
          ...sending,
          state: 'unknown',
          retryAllowed: false,
          issue: 'Checking delivery…',
        });
        await this.lookup(id);
      }
    }
  }
  async remove(id: string) {
    const record = this.records.get(id);
    if (!record || record.state !== 'failed' || this.inFlight.has(id)) return;
    await this.storage.remove(this.lease, id);
    if (!this.active()) return;
    this.records.delete(id);
    this.emit();
  }
  dispose() {
    this.controller.abort();
  }
}
