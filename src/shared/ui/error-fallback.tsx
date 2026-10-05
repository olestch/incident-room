'use client';

import Link from 'next/link';

export function ErrorFallback({ onRetry }: { onRetry: () => void }) {
  return (
    <main id="main-content" tabIndex={-1} className="mx-auto max-w-3xl px-6 py-16">
      <h1 className="text-3xl font-semibold">Something went wrong</h1>
      <p className="mt-4 text-muted">The page could not be displayed. You can try again.</p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-6 rounded-md bg-ink px-4 py-3 font-medium text-surface"
      >
        Try again
      </button>
      <Link href="/" className="ml-4 underline">
        Return home
      </Link>
    </main>
  );
}
