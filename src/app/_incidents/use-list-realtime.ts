'use client';
import { useEffect } from 'react';
import { bindDemoConnection, demoOnline } from '@/app/_demo/runtime';
import { useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { incidentKeys, type Incident } from '@/entities/incident/model';
import { useSessionRuntime } from '@/app/_providers/session-provider';
import { RealtimeCoordinator } from '@/features/realtime/coordinator';
import { MockRealtimeTransport } from '@/features/realtime/mock-transport';
import { openSchema, streamSchema, syncSchema } from '@/features/realtime/protocol';
import { notificationKeys } from '@/entities/notification/model';
import { applyNotification } from '@/app/_discovery/notification-cache';
import { applyPostmortemEvent } from '@/app/_postmortem/cache';
import { postmortemKeys } from '@/entities/postmortem/model';

/** The authorized list watches workspace metadata only, with no incident presence subscription. */
export function useListRealtime(enabled: boolean, userId: string, workspaceId: string) {
  const { coordinator: session, adapter } = useSessionRuntime();
  const cache = useQueryClient();
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    const generation = session.snapshot().generation;
    const valid = () => {
      const state = session.snapshot();
      return (
        active &&
        state.generation === generation &&
        'identity' in state &&
        state.identity.userId === userId &&
        state.identity.workspaceId === workspaceId
      );
    };
    const client = crypto.randomUUID();
    const read = <T>(path: string, schema: z.ZodType<T>, signal: AbortSignal) =>
      session.request((s) => adapter.resource(`/realtime${path}`, schema, s), 'safe-read', signal);
    const transport = new MockRealtimeTransport({
      open: (signal) => read('/open', openSchema, signal),
      stream: (after, signal) =>
        read(`/stream?after=${after}&client=${client}`, streamSchema, signal),
      presence: async () => [],
    });
    const service = new RealtimeCoordinator(workspaceId, '__workspace__', transport, {
      boundary: async (signal) => (await read('/open', openSchema, signal)).highWater,
      sync: (after, boundary, signal) =>
        read(`/sync?after=${after}&boundary=${boundary}`, syncSchema, signal),
      snapshot: async (signal) => {
        await cache.invalidateQueries({ queryKey: notificationKeys.all(userId, workspaceId) });
        await cache.invalidateQueries({ queryKey: postmortemKeys.all(userId, workspaceId) });
        await cache.invalidateQueries({ queryKey: incidentKeys.all(userId, workspaceId) });
        signal.throwIfAborted();
        if (!valid()) throw new DOMException('Superseded identity', 'AbortError');
      },
      changed: () => {},
      ephemeral: () => {},
      apply: async (event, signal) => {
        signal.throwIfAborted();
        if (!valid()) throw new DOMException('Superseded identity', 'AbortError');
        if (await applyPostmortemEvent(cache, userId, workspaceId, event, signal)) return;
        if (event.resourceType === 'notification') {
          if (event.payload.notification.recipientUserId === userId)
            applyNotification(
              cache,
              userId,
              workspaceId,
              event.payload.notification,
              event.payload.unread,
            );
          return;
        }
        if (event.resourceType !== 'incident') return;
        cache.setQueryData<Incident>(
          incidentKeys.detail(userId, workspaceId, event.payload.number),
          (previous) =>
            !previous || previous.revision < event.revision ? event.payload : previous,
        );
        await cache.invalidateQueries({ queryKey: incidentKeys.lists(userId, workspaceId) });
        signal.throwIfAborted();
      },
    });
    const remove = session.registerLifecycle({
      stop: () => {
        active = false;
        service.dispose();
      },
      clearDurableOnLogout: async () => {},
    });
    const offline = () => service.setOnline(false);
    const online = () => service.setOnline(demoOnline());
    window.addEventListener('offline', offline);
    window.addEventListener('online', online);
    service.start();
    const unbindDemo = bindDemoConnection((online) => service.setOnline(online));
    if (!navigator.onLine) service.setOnline(false);
    return () => {
      active = false;
      service.dispose();
      unbindDemo();
      remove();
      window.removeEventListener('offline', offline);
      window.removeEventListener('online', online);
    };
  }, [enabled, userId, workspaceId, session, adapter, cache]);
}
