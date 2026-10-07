import { Suspense } from 'react';
import type { Metadata } from 'next';
import { AuthPage } from '@/app/_auth/auth-page';
import { SessionProgress } from '@/app/_providers/session-provider';
export const metadata: Metadata = {
  title: 'Create account | Incident Room',
  description: 'Create a fictional account to explore the Incident Room portfolio demo.',
};
export default function Page() {
  return (
    <Suspense fallback={<SessionProgress />}>
      <AuthPage mode="register" />
    </Suspense>
  );
}
