import type { Metadata } from 'next';
export const metadata: Metadata = { title: 'Incidents | Incident Room' };
export default function Page() {
  return (
    <>
      <h1 className="text-3xl font-semibold">Incidents</h1>
      <p className="mt-4 text-muted">
        Incident functionality is not implemented yet. This protected placeholder demonstrates
        authentication and session lifecycle only.
      </p>
    </>
  );
}
