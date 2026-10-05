import { setupWorker } from 'msw/browser';
import { AUTH_NAMESPACE } from '@/features/session/http-session-adapter';
import { MockAuthAuthority } from './authority';
import { IndexedDbAuthorityStore } from './indexeddb-authority';
import { authHandlers } from './handlers';

let startup: Promise<void> | null = null;
export function startAuthMock() {
  if (!startup) {
    const worker = setupWorker(
      ...authHandlers(new MockAuthAuthority(new IndexedDbAuthorityStore())),
    );
    startup = worker
      .start({
        quiet: true,
        serviceWorker: { url: '/mockServiceWorker.js' },
        onUnhandledRequest(request) {
          if (new URL(request.url).pathname.startsWith(AUTH_NAMESPACE))
            throw new Error('Unhandled mock authentication request'); // No credentials/body/URL logging.
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
const cookieName = 'ir_fictional_client';
/** Public correlation handle, NOT a bearer credential. Browser mock auth is not security. */
export function fictionalClientId() {
  const value = document.cookie
    .split('; ')
    .find((value) => value.startsWith(`${cookieName}=`))
    ?.slice(cookieName.length + 1);
  if (value && /^[a-zA-Z0-9-]{1,100}$/.test(value)) return value;
  const client = crypto.randomUUID();
  document.cookie = `${cookieName}=${client}; Path=/; SameSite=Strict; Max-Age=86400`;
  return client;
}
export function forgetFictionalClient(expectedClient: string) {
  const current = document.cookie
    .split('; ')
    .find((value) => value.startsWith(`${cookieName}=`))
    ?.slice(cookieName.length + 1);
  // A stale tab must not clear a newer identity's correlation cookie.
  if (current === expectedClient)
    document.cookie = `${cookieName}=; Path=/; SameSite=Strict; Max-Age=0`;
}
