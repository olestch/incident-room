import { setupWorker } from 'msw/browser';
import { http, HttpResponse } from 'msw';
import { z } from 'zod';
import { demoPolicy } from '@/app/_demo/runtime';
import {
  acquireDemoLease,
  exclusiveDemoMaintenance,
  clearReplacementStores,
} from '@/app/_demo/reset';
import { fictionalClientId } from '@/features/session/mock/browser';
import { timelineEntrySchema } from '@/entities/timeline/model';
import { canChangeStatus } from '@/entities/incident/policy';
import { canTransition } from '@/entities/incident/model';
import { MockAuthAuthority, AuthorityError } from '@/features/session/mock/authority';
import { IndexedDbAuthorityStore } from '@/features/session/mock/indexeddb-authority';
import { authHandlers } from '@/features/session/mock/handlers';
import { MockIncidentAuthority } from '@/features/incident-management/authority';
import { IndexedDbIncidentStore } from '@/features/incident-management/indexeddb-store';
import { incidentHandlers } from '@/features/incident-management/handlers';
import { MockTimelineAuthority, makeTimelineAuthorityStore } from '@/features/timeline/authority';
import { timelineHandlers } from '@/features/timeline/handlers';
import { MockThreadAuthority, makeThreadAuthorityStore } from '@/features/threads/authority';
import { threadHandlers } from '@/features/threads/handlers';
import { EventJournal, makeJournalStore } from '@/features/realtime/journal';
import { composeRealtimeAuthority, ingestRoomChanges } from './realtime-authority';
import {
  MockNotificationAuthority,
  makeNotificationStore,
} from '@/features/notifications/authority';
import { notificationHandlers } from '@/features/notifications/handlers';
import { composeNotificationIngestion } from './notification-ingestion';
import { composeSearchAuthority } from './search-authority';
import { searchHandlers } from '@/features/search/handlers';
import { MockPostmortemAuthority, makePostmortemStore } from '@/features/postmortem/authority';
import { postmortemHandlers } from '@/features/postmortem/handlers';
import { composePostmortemIngestion } from './postmortem-ingestion';
import { compareEntries } from '@/entities/timeline/model';
import { AppError } from '@/shared/errors/app-error';

let startup: Promise<void> | null = null;
let paused = false;
const requests = new Set<string>();
const idleListeners = new Set<() => void>();
export async function quiesceDemo(stop: () => Promise<void>) {
  paused = true;
  await stop();
  if (requests.size)
    await new Promise<void>((resolve, reject) => {
      const finish = () => {
        clearTimeout(timeout);
        idleListeners.delete(finish);
        resolve();
      };
      const timeout = setTimeout(() => {
        idleListeners.delete(finish);
        reject(new Error('Requests still running; reload before reset.'));
      }, 12000);
      idleListeners.add(finish);
    });
}
export async function replaceDemoDataset(count: number, stop: () => Promise<void>) {
  await exclusiveDemoMaintenance(async () => {
    // Capture authority identity before stopping the client session. No client role input.
    const replace = await prepareReplacement(count);
    await quiesceDemo(stop);
    await replace();
  });
}
let prepareReplacement: (count: number) => Promise<() => Promise<void>> = async () => {
  throw new Error('Demo runtime unavailable');
};
export function startMock() {
  if (!startup) {
    const auth = new MockAuthAuthority(new IndexedDbAuthorityStore());
    const incidents = new MockIncidentAuthority(new IndexedDbIncidentStore());
    const timeline = new MockTimelineAuthority(makeTimelineAuthorityStore());
    const journal = new EventJournal(makeJournalStore());
    const authenticate = async (client: string) => {
      const session = await auth.current(client);
      if (!session) throw new AuthorityError('UNAUTHENTICATED', 401);
      return session.user;
    };
    const threads = new MockThreadAuthority(
      makeThreadAuthorityStore(),
      async (actor, incident, root) => {
        await timeline.locate(actor, incident, root);
      },
    );
    const notifications = new MockNotificationAuthority(makeNotificationStore());
    const notificationIngestion = composeNotificationIngestion(
      notifications,
      journal,
      () => auth.users(),
      threads,
      timeline,
    );
    const persistRoom = async (
      actor: Parameters<typeof ingestRoomChanges>[4],
      record: Parameters<typeof ingestRoomChanges>[5],
    ) =>
      ingestRoomChanges(
        journal,
        incidents,
        timeline,
        threads,
        actor,
        record,
        notificationIngestion,
      );
    const postmortems = new MockPostmortemAuthority(makePostmortemStore(), (actor, record, ids) =>
      timeline.inspectSearchable(actor, record, (entries) => {
        const selected = entries.filter((entry) => ids.includes(entry.id));
        if (selected.length !== ids.length)
          throw new AppError('validation', 'A selected Timeline entry is unavailable.', 400);
        return selected.sort(compareEntries).map((entry) => entry.id);
      }),
    );
    const publishPostmortems = composePostmortemIngestion(
      postmortems,
      journal,
      notificationIngestion,
    );
    prepareReplacement = async (count) => {
      const actor = await authenticate(fictionalClientId());
      const record = await incidents.detail(actor, 'INC-2841');
      return async () => {
        await timeline.replaceDataset(actor, record, count);
        // Old root contexts/checkpoints/local submissions must not attach to replaced evidence.
        await clearReplacementStores(record.workspaceId, record.id);
      };
    };
    const worker = setupWorker(
      http.all('*/mock-api/*', async ({ request }) => {
        if (paused)
          return HttpResponse.json(
            { category: 'network', message: 'Demo maintenance in progress. Reload to resume.' },
            { status: 503 },
          );
        const policy = demoPolicy.decision(request.method, new URL(request.url).pathname);
        if (policy.latency)
          await new Promise<void>((resolve) => {
            const done = () => {
              clearTimeout(timer);
              request.signal.removeEventListener('abort', done);
              resolve();
            };
            const timer = setTimeout(done, policy.latency);
            request.signal.addEventListener('abort', done, { once: true });
          });
        if (request.signal.aborted || policy.fail)
          return HttpResponse.json(
            {
              category: 'network',
              message:
                'Simulated request failure before persistence. Retry or clear Demo simulations.',
            },
            { status: 503 },
          );
        return undefined;
      }),
      http.post('*/mock-api/demo/event', async ({ request }) => {
        try {
          const actor = await authenticate(request.headers.get('x-fictional-client') ?? '');
          const input = z
            .object({
              number: z.string().regex(/^INC-\d+$/),
              kind: z.enum(['monitoring', 'deployment', 'human', 'status']),
            })
            .strict()
            .parse(await request.json());
          let record = await incidents.detail(actor, input.number);
          if (input.kind === 'status') {
            const next = {
              triggered: 'investigating',
              investigating: 'identified',
              identified: 'monitoring',
              monitoring: 'resolved',
              resolved: null,
            } as const;
            const to = next[record.status];
            if (!to || !canChangeStatus(actor, record) || !canTransition(record.status, to))
              throw new AppError(
                'authorization',
                'No authorized forward transition is available.',
                403,
              );
            const from = record.status;
            record = await incidents.simulate(
              actor,
              record.number,
              { status: to },
              record.revision,
            );
            await timeline.simulate(
              actor,
              record,
              timelineEntrySchema.parse({
                id: `${record.id}:demo-status-${record.revision}`,
                incidentId: record.id,
                occurredAt: record.updatedAt,
                createdAt: record.updatedAt,
                serverTieOrder: record.revision,
                revision: 1,
                important: false,
                tombstone: null,
                type: 'status_change',
                actorId: actor.id,
                from,
                to,
              }),
            );
          } else {
            const author =
              (await auth.users()).find(
                (user) =>
                  user.id !== actor.id &&
                  user.status === 'active' &&
                  user.workspaceId === record.workspaceId &&
                  record.participantIds.includes(user.id),
              ) ?? actor;
            const entry = await timeline.generate(actor, record, input.kind, author.id);
            await incidents.recordActivity(actor, record.number, entry.occurredAt);
          }
          await persistRoom(actor, record);
          return HttpResponse.json({ ok: true });
        } catch (error) {
          return HttpResponse.json(
            {
              category: error instanceof AppError ? error.category : 'validation',
              message:
                error instanceof AppError
                  ? error.message
                  : 'Fictional activity unavailable. Sign in and use an active accessible Incident.',
            },
            { status: error instanceof AppError ? (error.status ?? 503) : 400 },
          );
        }
      }),
      ...postmortemHandlers(
        postmortems,
        authenticate,
        (actor, number) => incidents.detail(actor, number),
        () => auth.users(),
        publishPostmortems,
        (actor, record, ids) =>
          timeline.inspectSearchable(actor, record, (entries) =>
            entries.filter((entry) => ids.includes(entry.id)).sort(compareEntries),
          ),
      ),
      ...notificationHandlers(notifications, authenticate, notificationIngestion.publish),
      ...searchHandlers(
        composeSearchAuthority(incidents, timeline, threads, () => auth.users()),
        authenticate,
      ),
      ...authHandlers(auth),
      ...incidentHandlers(
        incidents,
        async (client) => {
          const session = await auth.current(client);
          if (!session) throw new AuthorityError('UNAUTHENTICATED', 401);
          return session.user;
        },
        () => auth.users(),
      ),
      ...timelineHandlers(
        timeline,
        async (client) => {
          const session = await auth.current(client);
          if (!session) throw new AuthorityError('UNAUTHENTICATED', 401);
          return session.user;
        },
        (actor, number) => incidents.detail(actor, number),
        async (actor, number, time) => {
          await incidents.recordActivity(actor, number, time);
          await persistRoom(actor, await incidents.detail(actor, number));
        },
      ),
      ...threadHandlers(
        threads,
        authenticate,
        (actor, number) => incidents.detail(actor, number),
        (actor, number, time) => incidents.recordActivity(actor, number, time),
        persistRoom,
      ),
      ...composeRealtimeAuthority(
        journal,
        incidents,
        timeline,
        async (client) => {
          const session = await auth.current(client);
          if (!session) throw new AuthorityError('UNAUTHENTICATED', 401);
          return session.user;
        },
        threads,
        notificationIngestion,
        publishPostmortems,
      ),
    );
    worker.events.on('request:start', ({ request, requestId }) => {
      if (new URL(request.url).pathname.startsWith('/mock-api/')) requests.add(requestId);
    });
    worker.events.on('request:end', ({ requestId }) => {
      requests.delete(requestId);
      if (!requests.size) for (const listener of idleListeners) listener();
    });
    startup = worker
      .start({
        quiet: true,
        serviceWorker: { url: '/mockServiceWorker.js' },
        onUnhandledRequest(request) {
          if (new URL(request.url).pathname.startsWith('/mock-api/'))
            throw new Error('Unhandled fictional API request');
        },
      })
      .then(() => acquireDemoLease())
      .catch((error) => {
        startup = null;
        throw error;
      });
  }
  return startup;
}
