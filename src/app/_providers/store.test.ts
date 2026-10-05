import { expect, it } from 'vitest';
import { connectionChanged } from '@/features/realtime/connection-slice';
import { makeStore } from './store';

it('isolates connection lifecycle state between independent application runtimes', () => {
  const first = makeStore();
  const second = makeStore();
  first.dispatch(connectionChanged('reconnecting'));
  expect(first.getState().connection.status).toBe('reconnecting');
  expect(second.getState().connection.status).toBe('offline');
});
