import { IncidentPage } from '@/app/_incidents/incident-page';
export default async function Page({ params }: { params: Promise<{ incidentNumber: string }> }) {
  const { incidentNumber } = await params;
  return <IncidentPage number={incidentNumber} />;
}
