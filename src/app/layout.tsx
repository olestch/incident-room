import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { AppProviders } from '@/app/_providers/app-providers';
import './globals.css';

export const metadata: Metadata = {
  title: 'Incident Room',
  description:
    'Incident coordination for engineering and operations teams. Implementation in progress.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <a className="skip-link" href="#main-content">
          Skip to main content
        </a>
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}
