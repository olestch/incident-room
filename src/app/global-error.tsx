'use client';

import { ErrorFallback } from '@/shared/ui/error-fallback';
import './globals.css';

export default function GlobalError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body>
        <ErrorFallback onRetry={reset} />
      </body>
    </html>
  );
}
