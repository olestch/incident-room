import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { AppProviders } from '@/app/_providers/app-providers';
import { SessionProvider } from '@/app/_providers/session-provider';
import './globals.css';

export const metadata: Metadata = {
  title: 'Incident Room',
  description:
    'A fictional realtime incident-coordination portfolio: virtual Timeline, Threads, reconnect/resync and conflict-safe Postmortems built with React and Next.js.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <a className="skip-link" href="#main-content">
          Skip to main content
        </a>
        <AppProviders>
          <SessionProvider>{children}</SessionProvider>
        </AppProviders>
      </body>
    </html>
  );
}
