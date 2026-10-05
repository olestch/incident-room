import { Suspense } from 'react';
import type { Metadata } from 'next';
import { AuthPage } from '@/app/_auth/auth-page';
import { SessionProgress } from '@/app/_providers/session-provider';
export const metadata: Metadata = { title: 'Sign in | Incident Room' };
export default function Page() {
  return (
    <Suspense fallback={<SessionProgress />}>
      <AuthPage mode="login" />
    </Suspense>
  );
}
