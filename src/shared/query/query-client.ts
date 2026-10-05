import { QueryClient } from '@tanstack/react-query';
import { AppError } from '@/shared/errors/app-error';

export function shouldRetryQuery(failureCount: number, error: Error): boolean {
  if (error instanceof AppError && error.category !== 'network' && error.category !== 'realtime') {
    return false;
  }
  return failureCount < 1;
}

export function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        gcTime: 300_000,
        retry: shouldRetryQuery,
        refetchOnWindowFocus: true,
        refetchOnReconnect: true,
      },
      mutations: { retry: false },
    },
  });
}
