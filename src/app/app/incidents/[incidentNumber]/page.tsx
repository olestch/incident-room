import { IncidentPage } from '@/app/_incidents/incident-page';
export const metadata = { title: 'Incident Room · Timeline and discussion' };
export default async function Page({ params }: { params: Promise<{ incidentNumber: string }> }) {
  const { incidentNumber } = await params;
  return <IncidentPage number={incidentNumber} />;
}
