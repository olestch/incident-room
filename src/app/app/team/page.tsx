import { Suspense } from 'react';
import { TeamPage } from '@/app/_discovery/team-page';
export const metadata = { title: 'Team · Incident Room' };
export default function Page() {
  return (
    <Suspense fallback={<p role="status">Loading team…</p>}>
      <TeamPage />
    </Suspense>
  );
}
