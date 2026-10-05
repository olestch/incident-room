import Link from 'next/link';
export default function HomePage() {
  return (
    <main id="main-content" tabIndex={-1} className="mx-auto max-w-3xl px-6 py-16 sm:py-24">
      <p className="mb-4 text-sm font-semibold tracking-wide text-muted">
        Engineering &amp; operations
      </p>
      <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">Incident Room</h1>
      <p className="mt-6 max-w-xl text-lg leading-relaxed text-muted">
        A shared place to coordinate technical incidents and document the investigation.
      </p>
      <section
        aria-labelledby="progress-heading"
        className="mt-10 rounded-xl border border-line bg-surface p-6"
      >
        <h2 id="progress-heading" className="text-xl font-semibold">
          Implementation in progress
        </h2>
        <p className="mt-3 leading-relaxed text-muted">
          Authentication and session lifecycle are available. Incident workflows will arrive in
          subsequent phases.
        </p>
      </section>
      <Link href="/login" className="mt-6 inline-block rounded-lg bg-ink px-5 py-3 text-white">
        Sign in to the fictional workspace
      </Link>
    </main>
  );
}
