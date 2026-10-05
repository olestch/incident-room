'use client';
import { useEffect, useRef, useState } from 'react';
import { useQueryClient, type InfiniteData } from '@tanstack/react-query';
import type { CurrentUser } from '@/entities/current-user/model';
import { incidentKeys, type Incident } from '@/entities/incident/model';
import {
  timelineKeys,
  mergeEntries,
  type TimelineEntry,
  type TimelineWindow,
} from '@/entities/timeline/model';
import { RealtimeCoordinator } from '@/features/realtime/coordinator';
import { MockRealtimeTransport } from '@/features/realtime/mock-transport';
import { ephemeralRequest } from '@/features/realtime/ephemeral-broker';
import {
  openSchema,
  streamSchema,
  syncSchema,
  snapshotSchema,
  type PresenceMember,
} from '@/features/realtime/protocol';
import { connectionChanged, type ConnectionStatus } from '@/features/realtime/connection-slice';
import type { DeliveryCoordinator } from '@/features/timeline/delivery';
import { useSessionRuntime } from '@/app/_providers/session-provider';
import { useAppDispatch } from '@/app/_providers/hooks';

export function useRoomRealtime(
  incident: Incident,
  actor: CurrentUser,
  delivery: DeliveryCoordinator,
) {
  const { coordinator: session, adapter } = useSessionRuntime();
  const cache = useQueryClient();
  const dispatch = useAppDispatch();
  const runtime = useRef<RealtimeCoordinator | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>('connecting');
  const [members, setMembers] = useState<PresenceMember[]>([]);
  const [arrivals, setArrivals] = useState<string[]>([]);
  useEffect(() => {
    let active = true;
    const generation = session.snapshot().generation;
    const valid = () => {
      const state = session.snapshot();
      return (
        active &&
        state.generation === generation &&
        'identity' in state &&
        state.identity.userId === actor.id &&
        state.identity.workspaceId === actor.workspaceId
      );
    };
    let connectedOnce = false;
    const counted = new Set<string>();
    const clientId = crypto.randomUUID();
    // Public test correlation only; no credentials or domain content.
    sessionStorage.setItem('ir_realtime_client', clientId);
    const root = `/incidents/${encodeURIComponent(incident.number)}/realtime`;
    const ackKey = timelineKeys.acknowledgments(actor.id, actor.workspaceId, incident.id);
    const prefix = ['identity', actor.id, actor.workspaceId, 'timeline', incident.id];
    const windows = () =>
      cache
        .getQueriesData<TimelineWindow | InfiniteData<TimelineWindow> | TimelineEntry[]>({
          queryKey: prefix,
        })
        .flatMap(([, data]) => {
          if (!data || Array.isArray(data)) return [];
          return 'pages' in data ? data.pages : [data];
        });
    const known = (id: string) =>
      windows().some((window) => window.items.some((entry) => entry.id === id)) ||
      (cache.getQueryData<TimelineEntry[]>(ackKey) ?? []).some((entry) => entry.id === id);
    const merge = (entry: TimelineEntry) =>
      cache.setQueryData<TimelineEntry[]>(ackKey, (previous = []) => [
        ...mergeEntries(new Map(previous.map((value) => [value.id, value])), [entry]).values(),
      ]);
    const read = <T>(path: string, schema: import('zod').z.ZodType<T>, signal: AbortSignal) =>
      session.request((s) => adapter.resource(`${root}${path}`, schema, s), 'safe-read', signal);
    const transport = new MockRealtimeTransport({
      open: (signal) => read('/open', openSchema, signal),
      stream: (after, signal) =>
        read(`/stream?after=${after}&client=${clientId}`, streamSchema, signal),
      presence: (action, typing, signal) =>
        ephemeralRequest(
          {
            action,
            typing,
            clientId,
            userId: actor.id,
            room: JSON.stringify([actor.workspaceId, incident.id]),
          },
          signal,
        ),
    });
    const service = new RealtimeCoordinator(actor.workspaceId, incident.id, transport, {
      changed: (value) => {
        if (valid()) {
          if (value === 'connected') connectedOnce = true;
          setStatus(value);
          dispatch(connectionChanged(value));
        }
      },
      ephemeral: (value) => {
        if (valid())
          setMembers(
            (value?.members ?? [])
              .filter((member) => member.expiresAt > Date.now())
              .map((member) => ({
                ...member,
                typingUntil: member.typingUntil > Date.now() ? member.typingUntil : 0,
              })),
          );
      },
      boundary: async (signal) => (await read('/open', openSchema, signal)).highWater,
      sync: (after, boundary, signal) =>
        read(`/sync?after=${after}&boundary=${boundary}`, syncSchema, signal),
      apply: async (event, signal) => {
        signal.throwIfAborted();
        if (!valid()) throw new DOMException('Room disposed', 'AbortError');
        if (event.resourceType === 'incident') {
          const key = incidentKeys.detail(actor.id, actor.workspaceId, event.payload.number);
          cache.setQueryData<Incident>(key, (previous) =>
            !previous || previous.revision < event.revision ? event.payload : previous,
          );
          // Lists own filters/order/cursors: refetch the authoritative collection rather than splice a sorted page.
          void cache.invalidateQueries({
            queryKey: incidentKeys.lists(actor.id, actor.workspaceId),
          });
          return;
        }
        if (event.incidentId !== incident.id) return;
        const existed = known(event.resourceId);
        merge(event.payload);
        await delivery.acknowledge(event.payload);
        signal.throwIfAborted();
        if (
          valid() &&
          connectedOnce &&
          !existed &&
          event.kind === 'timeline_created' &&
          !counted.has(event.resourceId)
        ) {
          counted.add(event.resourceId);
          setArrivals((previous) => [...previous, event.resourceId]);
        }
      },
      snapshot: async (signal) => {
        const ids = [
          ...new Set(
            windows()
              .flatMap((window) => window.items.map((entry) => entry.id))
              .concat((cache.getQueryData<TimelineEntry[]>(ackKey) ?? []).map((entry) => entry.id)),
          ),
        ];
        const batches = Math.max(1, Math.ceil(ids.length / 60));
        for (let index = 0; index < batches; index++) {
          const query = new URLSearchParams();
          for (const id of ids.slice(index * 60, (index + 1) * 60)) query.append('entry', id);
          const snapshot = await read(`/snapshot?${query}`, snapshotSchema, signal);
          signal.throwIfAborted();
          if (
            !valid() ||
            snapshot.incident.id !== incident.id ||
            snapshot.incident.workspaceId !== actor.workspaceId
          )
            throw new Error('Invalid snapshot scope');
          cache.setQueryData<Incident>(
            incidentKeys.detail(actor.id, actor.workspaceId, incident.number),
            (previous) =>
              !previous || previous.revision <= snapshot.incident.revision
                ? snapshot.incident
                : previous,
          );
          for (const window of snapshot.windows)
            for (const entry of window.items) {
              if (entry.incidentId !== incident.id) throw new Error('Invalid snapshot room');
              merge(entry);
              await delivery.acknowledge(entry);
            }
        }
        void cache.invalidateQueries({ queryKey: incidentKeys.all(actor.id, actor.workspaceId) });
      },
    });
    runtime.current = service;
    const removeLifecycle = session.registerLifecycle({
      stop: () => {
        active = false;
        service.dispose();
      },
      clearDurableOnLogout: async () => {},
    });
    const offline = () => service.setOnline(false);
    const online = () => service.setOnline(true);
    window.addEventListener('offline', offline);
    window.addEventListener('online', online);
    service.start();
    if (!navigator.onLine) service.setOnline(false);
    return () => {
      active = false;
      service.dispose();
      removeLifecycle();
      window.removeEventListener('offline', offline);
      window.removeEventListener('online', online);
      if (runtime.current === service) runtime.current = null;
    };
  }, [
    incident.id,
    incident.number,
    actor.id,
    actor.workspaceId,
    delivery,
    cache,
    dispatch,
    session,
    adapter,
  ]);
  return {
    status,
    members,
    arrivals,
    retry: () => runtime.current?.retry(),
    typing: (value: boolean) => runtime.current?.typing(value),
  };
}
