import { describe, expect, it, vi } from 'vitest';
import { mergeEntries, type TimelineEntry } from '@/entities/timeline/model';
import { MemoryAtomicStore } from '@/shared/persistence/atomic-store';
import { RealtimeCoordinator, type RealtimePort } from './coordinator';
import { backoff, type RealtimeClock } from './clock';
import { EventJournal, seedJournal } from './journal';
import { persistentEventSchema, type PersistentEvent } from './protocol';
import type { RealtimeTransport, TransportEvent } from './transport';
import { MockRealtimeTransport } from './mock-transport';

const entry: TimelineEntry = {
  id: 'entry-one',
  incidentId: 'room-one',
  type: 'system_event',
  summary: 'Fictional recovery signal',
  occurredAt: '2026-10-05T00:00:00.000Z',
  createdAt: '2026-10-05T00:00:00.000Z',
  serverTieOrder: 1,
  revision: 1,
  important: false,
  tombstone: null,
};
const event = (
  sequence = 1,
  revision = sequence,
): Extract<PersistentEvent, { resourceType: 'timeline' }> => ({
  eventId: `entry-one:${revision}`,
  workspaceId: 'orbit',
  sequence,
  resourceType: 'timeline',
  resourceId: entry.id,
  incidentId: entry.incidentId,
  revision,
  occurredAt: entry.createdAt,
  kind: 'timeline_updated',
  payload: { ...entry, revision },
});
const flush = async () => {
  for (let index = 0; index < 30; index++) await Promise.resolve();
};
class Clock implements RealtimeClock {
  time = 0;
  tasks = new Map<number, { at: number; call: () => void }>();
  next = 0;
  now = () => this.time;
  random = () => 0;
  schedule = (call: () => void, ms: number) => {
    const id = ++this.next;
    this.tasks.set(id, { at: this.time + ms, call });
    return () => {
      this.tasks.delete(id);
    };
  };
  async tick(ms: number) {
    this.time += ms;
    for (const [id, task] of [...this.tasks])
      if (task.at <= this.time) {
        this.tasks.delete(id);
        task.call();
      }
    await flush();
  }
}
class Transport implements RealtimeTransport {
  listeners = new Set<(event: TransportEvent) => void>();
  connect = vi.fn(async (signal: AbortSignal) => {
    signal.throwIfAborted();
  });
  disconnect = vi.fn();
  subscribe(listener: (event: TransportEvent) => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  emit(value: TransportEvent) {
    for (const listener of this.listeners) listener(value);
  }
}
function setup() {
  const clock = new Clock();
  const transport = new Transport();
  const source: PersistentEvent[] = [];
  const index = new Map<string, TimelineEntry>();
  const port: RealtimePort = {
    boundary: vi.fn(async () => source.at(-1)?.sequence ?? 0),
    sync: vi.fn(async (after, highWater) => {
      const events = source.filter(
        (value) => value.sequence > after && value.sequence <= highWater,
      );
      return { events, highWater, through: events.at(-1)?.sequence ?? highWater, expired: false };
    }),
    snapshot: vi.fn(async () => {}),
    apply: vi.fn(async (value) => {
      if (value.resourceType === 'timeline' && value.incidentId === entry.incidentId)
        mergeEntries(index, [value.payload]);
    }),
    changed: vi.fn(),
    ephemeral: vi.fn(),
  };
  const sink = vi.fn();
  const service = new RealtimeCoordinator('orbit', 'room-one', transport, port, clock, sink);
  return { clock, transport, source, index, port, service, sink };
}
describe('protocol and revision routing', () => {
  it('accepts a persistent envelope, rejects payload/envelope mismatch and missing scope', () => {
    expect(persistentEventSchema.safeParse(event()).success).toBe(true);
    expect(persistentEventSchema.safeParse({ ...event(), revision: 99 }).success).toBe(false);
    expect(persistentEventSchema.safeParse({ ...event(), workspaceId: '' }).success).toBe(false);
  });
  it('ignores malformed/foreign events without checkpoint advance and records content-free diagnostics', async () => {
    const s = setup();
    s.service.start();
    await flush();
    s.transport.emit({ type: 'payload', payload: { body: 'untrusted content' } });
    s.transport.emit({ type: 'payload', payload: { ...event(), workspaceId: 'other' } });
    expect(s.service.lastAppliedSequence()).toBe(0);
    expect(s.sink).toHaveBeenCalledWith({ event: 'invalid_event' });
    expect(JSON.stringify(s.sink.mock.calls)).not.toContain('untrusted content');
    s.service.dispose();
  });
  it('duplicates are harmless; sequence buffers gaps; stale revision cannot undo tombstone', async () => {
    const s = setup();
    s.service.start();
    await flush();
    s.source.push(event(1, 7), event(2, 6));
    const tombstone = {
      ...event(1, 7),
      kind: 'timeline_tombstoned' as const,
      payload: {
        ...entry,
        revision: 7,
        tombstone: { deletedAt: entry.createdAt, reason: 'Fictional removal' },
      },
    };
    s.source[0] = tombstone;
    s.transport.emit({ type: 'payload', payload: event(2, 6) });
    s.transport.emit({ type: 'payload', payload: tombstone });
    s.transport.emit({ type: 'payload', payload: tombstone });
    await flush();
    expect(s.index.get(entry.id)?.revision).toBe(7);
    expect(s.index.get(entry.id)?.tombstone).not.toBeNull();
    expect(s.service.lastAppliedSequence()).toBe(2);
    expect(s.port.apply).toHaveBeenCalledTimes(1);
    expect(s.sink).toHaveBeenCalledWith({ event: 'stale_revision' });
    s.service.dispose();
  });
  it('does not route an inaccessible/different incident into active Timeline but accounts for workspace sequence', async () => {
    const s = setup();
    s.service.start();
    await flush();
    const other = {
      ...event(),
      incidentId: 'other-room',
      payload: { ...entry, incidentId: 'other-room' },
    };
    s.transport.emit({ type: 'payload', payload: other });
    await flush();
    expect(s.index.size).toBe(0);
    expect(s.service.lastAppliedSequence()).toBe(1);
    s.service.dispose();
  });
});
describe('reconnect and checkpoint coordinator', () => {
  it('deadline bounds a signal-ignoring connect and disposal cancels every pending timer', async () => {
    const s = setup();
    s.transport.connect.mockImplementation(() => new Promise<void>(() => {}));
    s.service.start();
    await flush();
    await s.clock.tick(12_000);
    expect(s.port.changed).toHaveBeenLastCalledWith('reconnecting');
    s.service.dispose();
    expect(s.clock.tasks.size).toBe(0);
  });
  it('an interrupted signal-ignoring resync cannot advance or connect after logout', async () => {
    const s = setup();
    s.source.push(event());
    let release!: (value: unknown) => void;
    s.port.sync = () =>
      new Promise((resolve) => {
        release = resolve;
      });
    s.service.start();
    await flush();
    s.service.dispose();
    release({ events: [event()], highWater: 1, through: 1, expired: false });
    await flush();
    expect(s.service.lastAppliedSequence()).toBe(0);
    expect(s.port.apply).not.toHaveBeenCalled();
    expect(s.port.changed).not.toHaveBeenCalledWith('connected');
  });
  it('ephemeral presence is scoped, clears on disconnect and does not apply resources or checkpoints', async () => {
    const s = setup();
    s.service.start();
    await flush();
    const value = {
      kind: 'ephemeral_snapshot',
      workspaceId: 'orbit',
      incidentId: 'room-one',
      members: [{ clientId: 'session', userId: 'sage', expiresAt: 4000, typingUntil: 3000 }],
    };
    s.transport.emit({ type: 'payload', payload: value });
    expect(s.port.ephemeral).toHaveBeenLastCalledWith(value);
    expect(s.port.apply).not.toHaveBeenCalled();
    expect(s.service.lastAppliedSequence()).toBe(0);
    s.transport.emit({ type: 'closed', code: 1006 });
    expect(s.port.ephemeral).toHaveBeenLastCalledWith(null);
    s.service.dispose();
  });
  it('does not report Connected until sync completes; live delivery buffers through high water', async () => {
    const s = setup();
    s.source.push(event());
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const original = s.port.sync;
    s.port.sync = vi.fn(async (after, boundary, signal) => {
      await pending;
      return original(after, boundary, signal);
    });
    s.service.start();
    await flush();
    expect(s.port.changed).not.toHaveBeenCalledWith('connected');
    s.source.push(event(2));
    s.transport.emit({ type: 'payload', payload: event(2) });
    expect(s.service.lastAppliedSequence()).toBe(0);
    release();
    await flush();
    expect(s.service.lastAppliedSequence()).toBe(2);
    expect(s.port.changed).toHaveBeenLastCalledWith('connected');
    s.service.dispose();
  });
  it('uses bounded jitter backoff with a single loop, then restores missed journal events', async () => {
    const s = setup();
    s.service.start();
    await flush();
    s.transport.connect.mockRejectedValueOnce(new Error('Transport unavailable'));
    s.transport.emit({ type: 'closed', code: 1006 });
    s.transport.emit({ type: 'error' });
    expect(s.clock.tasks.size).toBe(1);
    await s.clock.tick(375);
    expect(s.transport.connect).toHaveBeenCalledTimes(2);
    s.source.push(event());
    await s.clock.tick(750);
    expect(s.service.lastAppliedSequence()).toBe(1);
    expect(s.port.changed).toHaveBeenLastCalledWith('connected');
    expect(backoff(100, 1)).toBe(30_000);
    s.service.dispose();
    expect(s.clock.tasks.size).toBe(0);
  });
  it('does not advance after failed application; recovery safely retries the same sequence', async () => {
    const s = setup();
    s.service.start();
    await flush();
    s.source.push(event());
    const apply = s.port.apply;
    s.port.apply = vi
      .fn()
      .mockRejectedValueOnce(new Error('Apply failed'))
      .mockImplementation(apply);
    s.transport.emit({ type: 'payload', payload: event() });
    await flush();
    expect(s.service.lastAppliedSequence()).toBe(0);
    await s.clock.tick(375);
    expect(s.service.lastAppliedSequence()).toBe(1);
    s.service.dispose();
  });
  it('expired checkpoint obtains snapshots before new safe boundary, preserving local ownership', async () => {
    const s = setup();
    s.source.push(event());
    s.service.start();
    await flush();
    s.transport.emit({ type: 'closed', code: 1006 });
    s.source.push(event(2), event(3));
    s.port.sync = vi.fn(async (_after, highWater) => ({
      events: [],
      highWater,
      through: 1,
      expired: true,
    }));
    let release!: () => void;
    s.port.snapshot = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    await s.clock.tick(375);
    expect(s.service.lastAppliedSequence()).toBe(1);
    expect(s.port.changed).not.toHaveBeenLastCalledWith('connected');
    release();
    await flush();
    expect(s.service.lastAppliedSequence()).toBe(3);
    expect(s.port.changed).toHaveBeenLastCalledWith('connected');
    s.service.dispose();
  });
  it('offline keeps state but stops attempts; online still performs authoritative resync', async () => {
    const s = setup();
    s.source.push(event());
    s.service.start();
    await flush();
    s.service.setOnline(false);
    expect(s.port.changed).toHaveBeenLastCalledWith('offline');
    s.source.push(event(2));
    await s.clock.tick(30_000);
    expect(s.transport.connect).toHaveBeenCalledTimes(1);
    expect(s.index.size).toBe(1);
    s.service.setOnline(true);
    await flush();
    expect(s.service.lastAppliedSequence()).toBe(2);
    s.service.dispose();
  });
  it('logout/identity disposal cancels backoff, clears ephemeral state/buffers/checkpoint and ignores late work', async () => {
    const s = setup();
    s.source.push(event());
    s.service.start();
    await flush();
    s.transport.emit({ type: 'closed', code: 1006 });
    s.service.dispose();
    s.transport.emit({ type: 'payload', payload: event(2) });
    await s.clock.tick(30_000);
    expect(s.transport.connect).toHaveBeenCalledTimes(1);
    expect(s.service.lastAppliedSequence()).toBe(0);
    expect(s.port.ephemeral).toHaveBeenLastCalledWith(null);
    const next = setup();
    next.service.start();
    await flush();
    expect(next.service.lastAppliedSequence()).toBe(0);
    next.service.dispose();
  });
  it('terminal session failure cancels recovery without a competing auth loop', async () => {
    const s = setup();
    s.port.boundary = async () => {
      s.service.dispose();
      throw new Error('Session expired');
    };
    s.service.start();
    await flush();
    await s.clock.tick(30_000);
    expect(s.transport.connect).toHaveBeenCalledTimes(1);
    expect(s.clock.tasks.size).toBe(0);
  });
  it('duplicate/lower events after committed resync do not apply or advance again', async () => {
    const s = setup();
    s.source.push(event());
    s.service.start();
    await flush();
    s.transport.emit({ type: 'payload', payload: event() });
    await flush();
    expect(s.port.apply).toHaveBeenCalledTimes(1);
    expect(s.sink).toHaveBeenCalledWith({ event: 'duplicate_event' });
    s.service.dispose();
  });
});
describe('durable journal and transport simulation', () => {
  it('assigns monotonic workspace sequences, ingests only once, survives authority recreation and expires retained cursor', async () => {
    const storage = new MemoryAtomicStore(seedJournal);
    const journal = new EventJournal(storage, 2);
    const changes = [event(1), event(2), event(3)];
    await journal.append('orbit', changes);
    await journal.append('orbit', changes);
    const restored = new EventJournal(storage, 2);
    expect(await restored.read('orbit', 0)).toMatchObject({ highWater: 3, expired: true });
    expect((await restored.read('orbit', 1)).events.map((value) => value.sequence)).toEqual([2, 3]);
    expect((await restored.read('another', 0)).highWater).toBe(0);
  });
  it('fixed resync high-water excludes later changes and stable event IDs protect delayed lower revision', async () => {
    const journal = new EventJournal(new MemoryAtomicStore(seedJournal));
    await journal.append('orbit', [event(1, 5)]);
    await journal.append('orbit', [event(2, 4)]);
    await journal.append('orbit', [
      { ...event(2, 6), resourceId: 'new', payload: { ...entry, id: 'new', revision: 6 } },
    ]);
    expect((await journal.read('orbit', 0, 1)).events).toHaveLength(1);
    expect((await journal.read('orbit', 0)).highWater).toBe(2);
  });
  it('mock delays, duplicates, reorders, malformed/drop/failure fixtures and disconnect cancellation are deterministic', async () => {
    const clock = new Clock();
    const controls = {
      duplicate: true,
      reverse: true,
      delayMs: 200,
      malformed: true,
      drop: false,
      failure: false,
    };
    const port = {
      open: vi.fn(async () => ({
        highWater: 0,
        userId: 'river',
        workspaceId: 'orbit',
        incidentId: 'room-one',
      })),
      stream: vi.fn(async () => ({
        events: [event(), event(2)],
        highWater: 2,
        through: 2,
        expired: false,
        controls,
      })),
      presence: vi.fn(async () => []),
    };
    const transport = new MockRealtimeTransport(port, clock);
    const listener = vi.fn();
    transport.subscribe(listener);
    await transport.connect(new AbortController().signal);
    await clock.tick(0);
    await clock.tick(200);
    const events = listener.mock.calls
      .map(([value]) => value)
      .filter((value) => value.type === 'payload' && 'sequence' in value.payload);
    expect(events.map((value) => value.payload.sequence)).toEqual([2, 2, 1, 1]);
    controls.drop = true;
    listener.mockClear();
    await clock.tick(500);
    await clock.tick(200);
    expect(
      listener.mock.calls.some(
        ([value]) => value.type === 'payload' && 'sequence' in value.payload,
      ),
    ).toBe(false);
    controls.failure = true;
    await clock.tick(500);
    expect(listener).toHaveBeenCalledWith({ type: 'closed', code: 1006 });
    const joins = port.presence.mock.calls.length;
    await expect(transport.connect(new AbortController().signal)).rejects.toThrow(
      'Fictional transport failure',
    );
    // A failed reconnect must not join presence or complete a false Connected handshake.
    expect(port.presence.mock.calls.length).toBe(joins);
    transport.disconnect();
    expect(clock.tasks.size).toBe(0);
  });
});
