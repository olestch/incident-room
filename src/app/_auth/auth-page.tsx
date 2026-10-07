'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { AuthForm, type AuthMode } from '@/features/session/auth-form';
import { safeReturnDestination } from '@/features/session/return-destination';
import { BrandMark, SignalChannels } from '@/shared/ui/brand';
import { Button, InlineAlert } from '@/shared/ui/primitives';
import { MessageSquare, RefreshCw } from 'lucide-react';
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
const descriptions = {
  login: 'Return to the shared response. Use the demo account below to explore.',
  register: 'Create a fictional identity to join the demo workspace.',
  'forgot-password': 'Request a simulated reset. This demo does not send real email.',
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
    <main id="main-content" tabIndex={-1} className="auth-experience">
      <div className="auth-layout">
        <aside className="auth-context" aria-label="About Incident Room">
          <Link href="/" className="public-brand">
            <BrandMark />
            <span>Incident Room</span>
          </Link>
          <SignalChannels />
          <div className="auth-context-copy">
            <p className="public-eyebrow">Signals become shared context</p>
            <p className="auth-context-title">
              Every update.
              <br />
              One response.
            </p>
            <p>
              A realtime Timeline for the full story. Threads for the details that move an
              investigation forward.
            </p>
            <ul>
              <li>
                <MessageSquare size={18} aria-hidden="true" />
                Keep investigation connected.
              </li>
              <li>
                <RefreshCw size={18} aria-hidden="true" />
                Recover work when delivery is interrupted.
              </li>
            </ul>
          </div>
          <p className="auth-context-footer">
            Incident Room <span aria-hidden="true">/</span> Portfolio demo
          </p>
        </aside>
        <div className="auth-form-side">
          <Link href="/" className="public-brand auth-mobile-brand">
            <BrandMark />
            <span>Incident Room</span>
          </Link>
          <section className="auth-card" aria-labelledby="auth-title">
            <p className="public-eyebrow">Incident Room workspace</p>
            <h1 id="auth-title">{titles[mode]}</h1>
            <p className="auth-description">{descriptions[mode]}</p>
            {mode === 'login' &&
              (state.status === 'expired' || params.get('reason') === 'expired') && (
                <p role="status" className="auth-session-expired">
                  Your session expired. Please sign in again.
                </p>
              )}
            {mode === 'login' && params.get('reason') === 'logout-failed' && (
              <InlineAlert className="auth-session-issue">
                <p>
                  Signed out locally, but session or local-data cleanup could not be confirmed.
                  Retry before switching accounts.
                </p>
                <Button
                  className="mt-2"
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
                </Button>
                {cleanupFailure && <p>Cleanup is still unavailable. Try again.</p>}
              </InlineAlert>
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
            <nav aria-label="Authentication" className="auth-navigation">
              {mode !== 'login' && <Link href={`/login${suffix}`}>Sign in</Link>}
              {mode !== 'register' && <Link href={`/register${suffix}`}>Create an account</Link>}
              {mode !== 'forgot-password' && (
                <Link href={`/forgot-password${suffix}`}>Forgot password?</Link>
              )}
            </nav>
          </section>
          <p className="auth-disclosure">
            Fictional portfolio workspace. Authentication is simulated, not a production security
            boundary. Never use a real password.
          </p>
        </div>
      </div>
    </main>
  );
}
