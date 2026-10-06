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
          Realtime coordination, from investigation to Postmortem
        </h2>
        <p className="mt-3 leading-relaxed text-muted">
          Explore a virtual Timeline, contextual Threads, Search, Notifications and conflict-safe
          Postmortems. Demo Mode lets you reproduce latency, failures, reconnect and large datasets.
          This public portfolio uses a browser-simulated backend, not production infrastructure.
        </p>
      </section>
      <Link href="/login" className="mt-6 inline-block rounded-lg bg-ink px-5 py-3 text-white">
        Sign in to the fictional workspace
      </Link>
      <p className="mt-6 text-sm text-muted">
        Fictional credentials: river.vale@example.test · Fictional-pass-42. Never enter a real
        password. Start with INC-2841; use INC-2865 for Postmortem editing.
      </p>
    </main>
  );
}
