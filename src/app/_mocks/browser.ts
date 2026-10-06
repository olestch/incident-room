import { setupWorker } from 'msw/browser';
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
    const worker = setupWorker(
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
    startup = worker
      .start({
        quiet: true,
        serviceWorker: { url: '/mockServiceWorker.js' },
        onUnhandledRequest(request) {
          if (new URL(request.url).pathname.startsWith('/mock-api/'))
            throw new Error('Unhandled fictional API request');
        },
      })
      .then(() => {})
      .catch((error) => {
        startup = null;
        throw error;
      });
  }
  return startup;
}
