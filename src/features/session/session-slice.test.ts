import { expect, it } from 'vitest';
import { sessionChanged, sessionReducer } from './session-slice';
it('coordinates explicit serializable lifecycle states without contradictory flags or profile copies', () => {
  const identity = {
    userId: 'river',
    workspaceId: 'orbit',
    role: 'member' as const,
    expiresAt: 1000,
  };
  let state = sessionReducer(undefined, { type: 'init' });
  expect(state).toEqual({ status: 'restoring', generation: 0 });
  state = sessionReducer(
    state,
    sessionChanged({ status: 'authenticated', identity, generation: 0 }),
  );
  expect(state.status).toBe('authenticated');
  state = sessionReducer(state, sessionChanged({ status: 'refreshing', identity, generation: 0 }));
  expect(state.status).toBe('refreshing');
  state = sessionReducer(state, sessionChanged({ status: 'expired', generation: 1 }));
  expect(state).not.toHaveProperty('identity');
  state = sessionReducer(state, sessionChanged({ status: 'anonymous', generation: 2 }));
  expect(JSON.parse(JSON.stringify(state))).toEqual({ status: 'anonymous', generation: 2 });
});
