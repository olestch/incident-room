import type { Metadata } from 'next';
import { IncidentPage } from '@/app/_incidents/incident-page';
export const metadata: Metadata = { title: 'Incidents | Incident Room' };
export default function Page() {
  return <IncidentPage />;
}
