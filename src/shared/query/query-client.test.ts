import { describe, expect, it } from 'vitest';
import { AppError } from '@/shared/errors/app-error';
import { makeQueryClient, shouldRetryQuery } from './query-client';
import { queryScope } from './query-scope';

describe('Query foundation', () => {
  it('retries a transient read once but does not retry permanent failures', () => {
    const network = new AppError('network', 'Request unavailable');
    expect(shouldRetryQuery(0, network)).toBe(true);
    expect(shouldRetryQuery(1, network)).toBe(false);
    for (const category of [
      'authentication',
      'authorization',
      'validation',
      'conflict',
      'not-found',
    ] as const) {
      expect(shouldRetryQuery(0, new AppError(category, 'Request rejected'))).toBe(false);
    }
  });

  it('does not share cache data between separately mounted clients or identities', () => {
    const first = makeQueryClient();
    const second = makeQueryClient();
    const key = [...queryScope('fictional-user-a', 'fictional-workspace'), 'resource'];
    first.setQueryData(key, { count: 1 });
    expect(second.getQueryData(key)).toBeUndefined();
    expect(
      first.getQueryData([...queryScope('fictional-user-b', 'fictional-workspace'), 'resource']),
    ).toBeUndefined();
    expect(first.getDefaultOptions().mutations?.retry).toBe(false);
    first.clear();
    second.clear();
  });
});
