import type { RealtimeTransport, TransportEvent } from './transport';
import { systemClock, type RealtimeClock } from './clock';
import { openSchema, streamSchema, ephemeralSchema, type PresenceMember } from './protocol';

export interface MockTransportPort {
  open(signal: AbortSignal): Promise<unknown>;
  stream(after: number, signal: AbortSignal): Promise<unknown>;
  presence(
    action: 'join' | 'pulse' | 'leave',
    typing: boolean,
    signal: AbortSignal,
  ): Promise<PresenceMember[]>;
}
/** Independent per-client simulator. Polling the fictional server is transport delivery, not
 * client-to-client coordination. Its cursor is deliberately separate from committed sync. */
export class MockRealtimeTransport implements RealtimeTransport {
  private listeners = new Set<(event: TransportEvent) => void>();
  private controller: AbortController | null = null;
  private cancel: (() => void) | null = null;
  private deliveries = new Set<() => void>();
  private cursor = 0;
  private typingUntil = 0;
  constructor(
    private readonly port: MockTransportPort,
    private readonly clock: RealtimeClock = systemClock,
  ) {}
  subscribe(listener: (event: TransportEvent) => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  private emit(event: TransportEvent) {
    if (this.controller && !this.controller.signal.aborted)
      for (const listener of this.listeners) listener(event);
  }
  async connect(signal: AbortSignal) {
    this.disconnect();
    const controller = new AbortController();
    this.controller = controller;
    const scoped = AbortSignal.any([signal, controller.signal]);
    const info = openSchema.parse(await this.port.open(scoped));
    scoped.throwIfAborted();
    this.cursor = info.highWater;
    // Validate transport availability before completing connect. This probe does not consume
    // delivery: events remain journaled and the first poll/resync still reads this cursor.
    const probe = streamSchema.parse(await this.port.stream(this.cursor, scoped));
    scoped.throwIfAborted();
    if (probe.controls.failure) throw new Error('Fictional transport failure');
    const members = await this.port.presence('join', false, scoped);
    scoped.throwIfAborted();
    this.emit({
      type: 'payload',
      payload: ephemeralSchema.parse({
        kind: 'ephemeral_snapshot',
        workspaceId: info.workspaceId,
        incidentId: info.incidentId,
        members,
      }),
    });
    const poll = async () => {
      try {
        const packet = streamSchema.parse(await this.port.stream(this.cursor, scoped));
        scoped.throwIfAborted();
        if (packet.controls.failure) throw new Error('Fictional transport failure');
        this.cursor = packet.expired ? packet.highWater : packet.through;
        let events: unknown[] = packet.controls.reverse
          ? [...packet.events].reverse()
          : packet.events;
        if (packet.controls.duplicate) events = events.flatMap((event) => [event, event]);
        if (packet.controls.malformed) events = [{ invalid: true }, ...events];
        if (!packet.controls.drop)
          for (const event of events) {
            if (packet.controls.delayMs) {
              const cancel = this.clock.schedule(() => {
                this.deliveries.delete(cancel);
                this.emit({ type: 'payload', payload: event });
              }, packet.controls.delayMs);
              this.deliveries.add(cancel);
            } else this.emit({ type: 'payload', payload: event });
          }
        const members = await this.port.presence(
          'pulse',
          this.typingUntil > this.clock.now(),
          scoped,
        );
        scoped.throwIfAborted();
        this.emit({
          type: 'payload',
          payload: {
            kind: 'ephemeral_snapshot',
            workspaceId: info.workspaceId,
            incidentId: info.incidentId,
            members,
          },
        });
        this.emit({ type: 'watermark', sequence: packet.highWater });
        this.cancel = this.clock.schedule(() => {
          void poll();
        }, 500);
      } catch {
        if (!scoped.aborted) {
          this.emit({ type: 'closed', code: 1006 });
          this.disconnect();
        }
      }
    };
    this.cancel = this.clock.schedule(() => {
      void poll();
    }, 0);
  }
  typing(active: boolean) {
    this.typingUntil = active ? this.clock.now() + 2500 : 0;
  }
  disconnect() {
    if (this.controller) {
      this.controller.abort();
      void this.port.presence('leave', false, AbortSignal.timeout(2000)).catch(() => {});
    }
    this.controller = null;
    this.cancel?.();
    this.cancel = null;
    for (const cancel of this.deliveries) cancel();
    this.deliveries.clear();
    this.typingUntil = 0;
  }
}
