import { notFound } from 'next/navigation';
export default async function Page({ params }: { params: Promise<{ segments: string[] }> }) {
  const { segments } = await params;
  const path = segments.join('/');
  const known =
    /^(incidents\/[^/]+(\/postmortem)?|notifications|search|team|settings|profile\/[^/]+)$/.test(
      path,
    );
  if (!known) notFound();
  return (
    <>
      <h1 className="text-3xl font-semibold">Protected route placeholder</h1>
      <p className="mt-4 text-muted">
        This destination is preserved for routing checks. Its product functionality is not
        implemented yet.
      </p>
    </>
  );
}
