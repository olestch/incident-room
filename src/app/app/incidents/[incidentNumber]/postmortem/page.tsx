import { PostmortemPage } from '@/app/_postmortem/page';
export const metadata = { title: 'Postmortem · Incident Room' };
export default async function Page({ params }: { params: Promise<{ incidentNumber: string }> }) {
  const { incidentNumber } = await params;
  return <PostmortemPage number={incidentNumber} />;
}
