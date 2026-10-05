import { setupWorker } from 'msw/browser';
import { MockAuthAuthority, AuthorityError } from '@/features/session/mock/authority';
import { IndexedDbAuthorityStore } from '@/features/session/mock/indexeddb-authority';
import { authHandlers } from '@/features/session/mock/handlers';
import { MockIncidentAuthority } from '@/features/incident-management/authority';
import { IndexedDbIncidentStore } from '@/features/incident-management/indexeddb-store';
import { incidentHandlers } from '@/features/incident-management/handlers';

let startup: Promise<void> | null = null;
export function startMock() {
  if (!startup) {
    const auth = new MockAuthAuthority(new IndexedDbAuthorityStore());
    const incidents = new MockIncidentAuthority(new IndexedDbIncidentStore());
    const worker = setupWorker(
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
