import { PostmortemPage } from '@/app/_postmortem/page';
export default async function Page({ params }: { params: Promise<{ incidentNumber: string }> }) {
  const { incidentNumber } = await params;
  return <PostmortemPage number={incidentNumber} />;
}
