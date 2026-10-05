'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { AuthForm, type AuthMode } from '@/features/session/auth-form';
import { safeReturnDestination } from '@/features/session/return-destination';
import {
  SessionIssue,
  SessionProgress,
  useSessionRuntime,
} from '@/app/_providers/session-provider';

const titles = {
  login: 'Sign in',
  register: 'Create an account',
  'forgot-password': 'Forgot password',
};
export function AuthPage({ mode }: { mode: AuthMode }) {
  const { state, coordinator, issue } = useSessionRuntime();
  const router = useRouter();
  const params = useSearchParams();
  const destination = safeReturnDestination(params.get('returnTo'));
  const [cleanupFailure, setCleanupFailure] = useState(false);
  const authenticated = 'identity' in state;
  useEffect(() => {
    // Cross the identity boundary with a fresh runtime and the exact validated URL/hash.
    // Ordinary authenticated navigation still uses Next Link/router.
    if (authenticated && mode !== 'forgot-password') window.location.replace(destination);
  }, [authenticated, mode, destination]);
  if (issue) return <SessionIssue />;
  if (state.status === 'restoring' || (authenticated && mode !== 'forgot-password'))
    return <SessionProgress />;
  const suffix = params.has('returnTo') ? `?returnTo=${encodeURIComponent(destination)}` : '';
  return (
    <main id="main-content" tabIndex={-1} className="mx-auto w-full max-w-lg px-5 py-10 sm:py-16">
      <Link href="/" className="text-sm font-semibold underline">
        Incident Room
      </Link>
      <section className="mt-6 rounded-xl border border-line bg-surface p-5 sm:p-8">
        <h1 className="mb-3 text-3xl font-semibold">{titles[mode]}</h1>
        <p className="mb-6 text-sm text-muted">
          Fictional portfolio workspace. This is simulated authentication, not a production security
          boundary.
        </p>
        {mode === 'login' && (state.status === 'expired' || params.get('reason') === 'expired') && (
          <p role="status" className="mb-4 text-critical">
            Your session expired. Please sign in again.
          </p>
        )}
        {mode === 'login' && params.get('reason') === 'logout-failed' && (
          <div role="alert" className="mb-4 text-critical">
            <p>
              Signed out locally, but session or local-data cleanup could not be confirmed. Retry
              before switching accounts.
            </p>
            <button
              className="mt-2 underline"
              onClick={async () => {
                try {
                  await coordinator.logout();
                  router.replace('/login');
                } catch {
                  setCleanupFailure(true);
                }
              }}
            >
              Retry logout cleanup
            </button>
            {cleanupFailure && <p>Cleanup is still unavailable. Try again.</p>}
          </div>
        )}
        <AuthForm
          mode={mode}
          submit={async (values) => {
            if (mode === 'login')
              await coordinator.login({ email: values.email, password: values.password });
            else if (mode === 'register')
              await coordinator.register({
                name: values.name,
                email: values.email,
                password: values.password,
              });
            else await coordinator.resetPassword(values.email);
          }}
        />
        <nav aria-label="Authentication" className="mt-6 flex flex-wrap gap-4 text-sm underline">
          {mode !== 'login' && <Link href={`/login${suffix}`}>Sign in</Link>}
          {mode !== 'register' && <Link href={`/register${suffix}`}>Create an account</Link>}
          {mode !== 'forgot-password' && (
            <Link href={`/forgot-password${suffix}`}>Forgot password?</Link>
          )}
        </nav>
      </section>
    </main>
  );
}
