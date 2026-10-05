import { Suspense, type ReactNode } from 'react';
import { ProtectedShell } from '@/app/_auth/protected-shell';
import { SessionProgress } from '@/app/_providers/session-provider';
export default function Layout({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={<SessionProgress />}>
      <ProtectedShell>{children}</ProtectedShell>
    </Suspense>
  );
}
