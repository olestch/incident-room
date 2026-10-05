import { createDiagnostics, type DiagnosticSink } from '@/shared/diagnostics/diagnostics';
import type { ConnectionStatus } from './connection-slice';
import { backoff, systemClock, type RealtimeClock } from './clock';
import {
  ephemeralSchema,
  persistentEventSchema,
  syncSchema,
  type PersistentEvent,
  type EphemeralSnapshot,
} from './protocol';
import type { RealtimeTransport, TransportEvent } from './transport';

export interface RealtimePort {
  boundary(signal: AbortSignal): Promise<number>;
  sync(after: number, boundary: number, signal: AbortSignal): Promise<unknown>;
  snapshot(signal: AbortSignal): Promise<void>;
  apply(event: PersistentEvent, signal: AbortSignal): Promise<void>;
  changed(status: ConnectionStatus): void;
  ephemeral(value: EphemeralSnapshot | null): void;
}
/** One identity/authorized-room runtime. Receipt is never a checkpoint commit. */
export class RealtimeCoordinator {
  private checkpoint = 0;
  private buffer = new Map<number, PersistentEvent>();
  private seen = new Set<string>();
  private revisions = new Map<string, number>();
  private controller: AbortController | null = null;
  private cancelRetry: (() => void) | null = null;
  private cancelStable: (() => void) | null = null;
  private removeListener: (() => void) | null = null;
  private running = false;
  private disposed = false;
  private online = true;
  private synchronized = false;
  private connectedOnce = false;
  private attempt = 0;
  private generation = 0;
  private queue = Promise.resolve();
  private diagnostic;
  constructor(
    private readonly workspaceId: string,
    private readonly incidentId: string,
    private readonly transport: RealtimeTransport,
    private readonly port: RealtimePort,
    private readonly clock: RealtimeClock = systemClock,
    sink?: DiagnosticSink,
  ) {
    this.diagnostic = createDiagnostics(sink);
  }
  lastAppliedSequence() {
    return this.checkpoint;
  }
  start() {
    if (this.disposed || this.removeListener) return;
    this.removeListener = this.transport.subscribe((event) => this.receive(event));
    void this.recover();
  }
  private live(signal: AbortSignal) {
    signal.throwIfAborted();
    if (this.disposed) throw new DOMException('Disposed', 'AbortError');
  }
  /** Bound signal-ignoring adapters too; their late continuations cannot commit checkpoints. */
  private wait<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
    if (signal.aborted || this.disposed) {
      void operation.catch(() => {});
      return Promise.reject(new DOMException('Realtime work cancelled', 'AbortError'));
    }
    return new Promise<T>((resolve, reject) => {
      const cleanup = () => {
        cancel();
        signal.removeEventListener('abort', abort);
      };
      const abort = () => {
        cleanup();
        reject(new DOMException('Realtime work cancelled', 'AbortError'));
      };
      const cancel = this.clock.schedule(() => {
        cleanup();
        reject(new Error('Realtime operation deadline'));
      }, 12_000);
      signal.addEventListener('abort', abort, { once: true });
      void operation.then(
        (value) => {
          cleanup();
          resolve(value);
        },
        (error) => {
          cleanup();
          reject(error);
        },
      );
    });
  }
  private receive(message: TransportEvent) {
    if (this.disposed) return;
    if (message.type === 'closed' || message.type === 'error') {
      this.lost();
      return;
    }
    if (!this.controller || this.controller.signal.aborted) return;
    if (message.type === 'watermark') {
      if (this.synchronized && message.sequence > this.checkpoint)
        this.enqueue(async (signal) => {
          if (message.sequence > this.checkpoint) await this.synchronize(signal);
        });
      return;
    }
    const ephemeral = ephemeralSchema.safeParse(message.payload);
    if (ephemeral.success) {
      if (
        ephemeral.data.workspaceId === this.workspaceId &&
        ephemeral.data.incidentId === this.incidentId
      )
        this.port.ephemeral(ephemeral.data);
      return;
    }
    const parsed = persistentEventSchema.safeParse(message.payload);
    if (!parsed.success || parsed.data.workspaceId !== this.workspaceId) {
      this.diagnostic.record({ event: 'invalid_event' });
      return;
    }
    const event = parsed.data;
    if (this.seen.has(event.eventId) || event.sequence <= this.checkpoint) {
      this.diagnostic.record({ event: 'duplicate_event' });
      return;
    }
    this.buffer.set(event.sequence, event);
    if (this.buffer.size > 1000) {
      this.lost();
      return;
    }
    if (this.synchronized)
      this.enqueue(async (signal) => {
        await this.drain(signal);
        if (this.buffer.size) await this.synchronize(signal);
      });
  }
  private enqueue(operation: (signal: AbortSignal) => Promise<void>) {
    const controller = this.controller;
    if (!controller) return;
    this.queue = this.queue
      .then(async () => {
        this.live(controller.signal);
        await operation(controller.signal);
      })
      .catch(() => {
        if (!controller.signal.aborted) this.lost();
      });
  }
  private async commit(event: PersistentEvent, signal: AbortSignal) {
    this.live(signal);
    if (event.sequence !== this.checkpoint + 1) throw new Error('Noncontiguous synchronization');
    const resource = JSON.stringify([event.resourceType, event.resourceId]);
    if ((this.revisions.get(resource) ?? 0) > event.revision)
      this.diagnostic.record({ event: 'stale_revision' });
    else if (!this.seen.has(event.eventId)) {
      await this.wait(this.port.apply(event, signal), signal);
      this.live(signal);
      this.revisions.set(resource, event.revision);
    }
    this.live(signal);
    this.seen.add(event.eventId);
    if (this.seen.size > 2000) this.seen.delete(this.seen.values().next().value!);
    this.checkpoint = event.sequence;
    this.buffer.delete(event.sequence);
    this.diagnostic.record({ event: 'checkpoint_advanced', count: this.checkpoint });
  }
  private async drain(signal: AbortSignal) {
    for (const sequence of this.buffer.keys())
      if (sequence <= this.checkpoint) this.buffer.delete(sequence);
    while (this.buffer.has(this.checkpoint + 1))
      await this.commit(this.buffer.get(this.checkpoint + 1)!, signal);
  }
  private async synchronize(signal: AbortSignal) {
    this.synchronized = false;
    this.port.changed(this.connectedOnce || this.attempt ? 'reconnecting' : 'connecting');
    this.diagnostic.record({ event: 'resync_started' });
    const boundary = await this.wait(this.port.boundary(signal), signal);
    this.live(signal);
    if (!Number.isSafeInteger(boundary) || boundary < this.checkpoint)
      throw new Error('Invalid high water');
    while (this.checkpoint < boundary) {
      const result = syncSchema.parse(
        await this.wait(this.port.sync(this.checkpoint, boundary, signal), signal),
      );
      this.live(signal);
      if (result.highWater !== boundary) throw new Error('Changed synchronization boundary');
      if (result.expired) {
        await this.wait(this.port.snapshot(signal), signal);
        this.live(signal);
        this.checkpoint = boundary;
        this.seen.clear();
        break;
      }
      if (!result.events.length) throw new Error('Missing synchronization interval');
      for (const event of result.events) {
        if (event.workspaceId !== this.workspaceId || event.sequence > boundary)
          throw new Error('Invalid synchronization scope');
        await this.commit(event, signal);
      }
      if (result.through !== this.checkpoint) throw new Error('Unsafe synchronization checkpoint');
    }
    await this.drain(signal);
    // A buffered gap cannot be certified Connected: recover it from an authoritative boundary.
    if (this.buffer.size) {
      const updatedBoundary = await this.wait(this.port.boundary(signal), signal);
      this.live(signal);
      if (updatedBoundary <= boundary) throw new Error('Unrecoverable live sequence gap');
      await this.synchronize(signal);
      return;
    }
    this.live(signal);
    this.synchronized = true;
    this.connectedOnce = true;
    this.port.changed('connected');
    this.diagnostic.record({ event: 'resync_completed', count: this.checkpoint });
  }
  private async recover() {
    if (this.running || this.disposed || !this.online) return;
    this.running = true;
    const generation = ++this.generation;
    const controller = new AbortController();
    this.controller = controller;
    this.port.changed(this.connectedOnce || this.attempt ? 'reconnecting' : 'connecting');
    this.diagnostic.record({ event: 'reconnect_attempt', attempt: this.attempt });
    try {
      await this.wait(this.transport.connect(controller.signal), controller.signal);
      this.live(controller.signal);
      this.diagnostic.record({ event: 'transport_connected' });
      await this.synchronize(controller.signal);
      this.cancelStable = this.clock.schedule(() => {
        this.attempt = 0;
      }, 5000);
    } catch {
      if (generation === this.generation && !this.disposed) this.lost();
    } finally {
      this.running = false;
      if (!this.disposed && this.online && !this.synchronized) this.scheduleRetry();
    }
  }
  private scheduleRetry() {
    if (this.cancelRetry || this.running || this.disposed || !this.online) return;
    this.cancelRetry = this.clock.schedule(
      () => {
        this.cancelRetry = null;
        void this.recover();
      },
      backoff(this.attempt++, this.clock.random()),
    );
  }
  private lost() {
    if (this.disposed) return;
    this.generation++;
    this.controller?.abort();
    this.cancelStable?.();
    this.cancelStable = null;
    this.transport.disconnect();
    this.synchronized = false;
    this.buffer.clear();
    this.port.ephemeral(null);
    this.port.changed(this.online ? 'reconnecting' : 'offline');
    this.diagnostic.record({ event: 'transport_disconnected' });
    this.scheduleRetry();
  }
  setOnline(online: boolean) {
    this.online = online;
    if (!online) {
      this.cancelRetry?.();
      this.cancelRetry = null;
      this.lost();
    } else this.retry();
  }
  retry() {
    if (this.disposed || !this.online || this.running) return;
    this.cancelRetry?.();
    this.cancelRetry = null;
    void this.recover();
  }
  typing(active: boolean) {
    if (this.synchronized) this.transport.typing?.(active);
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.generation++;
    this.controller?.abort();
    this.cancelRetry?.();
    this.cancelStable?.();
    this.removeListener?.();
    this.transport.disconnect();
    this.buffer.clear();
    this.seen.clear();
    this.revisions.clear();
    this.checkpoint = 0;
    this.port.ephemeral(null);
    this.port.changed('offline');
  }
}
