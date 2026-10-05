import Link from 'next/link';

export default function NotFound() {
  return (
    <main id="main-content" tabIndex={-1} className="mx-auto max-w-3xl px-6 py-16">
      <h1 className="text-3xl font-semibold">Page not found</h1>
      <p className="mt-4 text-muted">This page is not available.</p>
      <Link href="/" className="mt-6 inline-block underline">
        Return to Incident Room
      </Link>
    </main>
  );
}
