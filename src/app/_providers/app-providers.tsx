'use client';

import type { ReactNode } from 'react';
import { QueryProvider } from './query-provider';
import { StoreProvider } from './store-provider';

export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <StoreProvider>
      <QueryProvider>{children}</QueryProvider>
    </StoreProvider>
  );
}
