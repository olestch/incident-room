// @vitest-environment node
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { makeQueryClient } from '@/shared/query/query-client';
import { currentUserKey } from '@/entities/current-user/model';
import { HttpSessionAdapter, AUTH_NAMESPACE, AuthHttpError } from './http-session-adapter';
import { SessionCoordinator } from './session-coordinator';
import { sessionReducer, sessionChanged } from './session-slice';
import { MockAuthAuthority, MemoryAuthorityStore, DEMO_PASSWORD } from './mock/authority';
import { authHandlers } from './mock/handlers';

const origin = 'http://incident-room.example.test';
const client = 'unit-client';
const server = setupServer();
let clock = 100_000;
let authority: MockAuthAuthority;
const signal = () => new AbortController().signal;
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function runtime() {
  const adapter = new HttpSessionAdapter(() => client, origin);
  const query = makeQueryClient();
  let state = sessionReducer(undefined, { type: 'init' });
  const coordinator = new SessionCoordinator(
    adapter,
    {
      changed: (value) => {
        state = sessionReducer(state, sessionChanged(value));
      },
      activated: ({ user }) => query.setQueryData(currentUserKey(user.id, user.workspaceId), user),
      cleared: () => {
        void query.cancelQueries({ queryKey: ['identity'] });
        query.removeQueries({ queryKey: ['identity'] });
      },
    },
    () => clock,
  );
  return { adapter, coordinator, query, state: () => state };
}
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
beforeEach(() => {
  clock = 100_000;
  authority = new MockAuthAuthority(new MemoryAuthorityStore(), () => clock);
  server.use(...authHandlers(authority));
});
const login = (coordinator: SessionCoordinator, email = 'river.vale@example.test') =>
  coordinator.login({ email, password: DEMO_PASSWORD });

describe('session infrastructure via actual MSW HTTP boundary', () => {
  it('logout in a stale independent tab targets its captured client, not another newly authenticated client', async () => {
    let cookie = 'client-A';
    const forget = vi.fn();
    const a = new HttpSessionAdapter(() => cookie, origin, undefined, forget);
    await a.login({ email: 'river.vale@example.test', password: DEMO_PASSWORD }, signal());
    cookie = 'client-B';
    const b = new HttpSessionAdapter(() => cookie, origin);
    await b.login({ email: 'sage.linden@example.test', password: DEMO_PASSWORD }, signal());
    await a.logout(signal());
    await a.logout(signal());
    expect(forget).toHaveBeenCalledWith('client-A');
    expect(forget).toHaveBeenCalledTimes(2);
    expect((await b.restore(signal()))?.user.id).toBe('demo-sage');
  });
  it('restores anonymously, logs in, then restores current identity without storing credentials in state/cache', async () => {
    const first = runtime();
    await first.coordinator.restore();
    expect(first.state().status).toBe('anonymous');
    await login(first.coordinator);
    expect(first.state().status).toBe('authenticated');
    const second = runtime();
    await second.coordinator.restore();
    expect(second.state().status).toBe('authenticated');
    const serialized = JSON.stringify({
      state: second.state(),
      cache: second.query
        .getQueryCache()
        .getAll()
        .map((q) => q.state.data),
    });
    expect(serialized).not.toMatch(/password|verifier|token|Fictional-pass/);
    first.query.clear();
    second.query.clear();
  });
  it('coalesces three expired reads into ONE refresh and retries all safe reads', async () => {
    const r = runtime();
    await login(r.coordinator);
    await authority.expire(client);
    const refresh = vi.spyOn(r.adapter, 'refresh');
    const gate = deferred<void>();
    server.use(
      http.post(`${origin}${AUTH_NAMESPACE}/refresh`, async () => {
        await gate.promise;
        return HttpResponse.json(await authority.refresh(client));
      }),
    );
    const results = [1, 2, 3].map(() =>
      r.coordinator.request((scoped) => r.adapter.currentUser(scoped), 'safe-read'),
    );
    await vi.waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    expect(r.state().status).toBe('refreshing');
    gate.resolve();
    expect((await Promise.all(results)).map((user) => user.id)).toEqual([
      'demo-river',
      'demo-river',
      'demo-river',
    ]);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(r.state().status).toBe('authenticated');
    r.query.clear();
  });
  it('does not start another refresh for a late 401 from the pre-refresh generation of reads', async () => {
    const r = runtime();
    await login(r.coordinator);
    await authority.expire(client);
    const refresh = vi.spyOn(r.adapter, 'refresh');
    const late = deferred<void>();
    let calls = 0;
    const delayed = r.coordinator.request(async (scoped) => {
      calls++;
      if (calls === 1) {
        await late.promise;
        throw new AuthHttpError('SESSION_EXPIRED', 401);
      }
      return r.adapter.currentUser(scoped);
    }, 'safe-read');
    await r.coordinator.request((scoped) => r.adapter.currentUser(scoped), 'safe-read');
    late.resolve();
    expect((await delayed).id).toBe('demo-river');
    expect(refresh).toHaveBeenCalledTimes(1);
    r.query.clear();
  });
  it('refreshes a near-expiry session proactively without waiting for wall-clock expiration', async () => {
    const r = runtime();
    await login(r.coordinator);
    clock += 280_000;
    const refresh = vi.spyOn(r.adapter, 'refresh');
    await r.coordinator.request((scoped) => r.adapter.currentUser(scoped), 'safe-read');
    expect(refresh).toHaveBeenCalledTimes(1);
    r.query.clear();
  });
  it('does not replay arbitrary mutations after successful refresh', async () => {
    const r = runtime();
    await login(r.coordinator);
    await authority.expire(client);
    const send = vi.fn(async () => {
      throw new AuthHttpError('SESSION_EXPIRED', 401);
    });
    await expect(r.coordinator.request(send, 'mutation')).rejects.toMatchObject({
      code: 'SESSION_EXPIRED',
    });
    expect(send).toHaveBeenCalledTimes(1);
    expect(r.state().status).toBe('authenticated');
    r.query.clear();
  });
  it('failed refresh removes visible identity, cancels work and quarantines rather than deletes durable work', async () => {
    const r = runtime();
    await login(r.coordinator);
    const stop = vi.fn();
    const clearDurableOnLogout = vi.fn(async () => {});
    r.coordinator.registerLifecycle({ stop, clearDurableOnLogout });
    await authority.expire(client, false);
    await expect(
      r.coordinator.request((scoped) => r.adapter.currentUser(scoped), 'safe-read'),
    ).rejects.toMatchObject({ category: 'authentication' });
    expect(r.state()).toMatchObject({ status: 'expired', generation: 1 });
    expect(r.query.getQueryCache().getAll()).toHaveLength(0);
    expect(stop).toHaveBeenCalledWith(expect.objectContaining({ userId: 'demo-river' }), 'expired');
    expect(clearDurableOnLogout).not.toHaveBeenCalled();
  });
  it('A → logout → B rejects late signal-ignoring work and never restores A cache or Redux identity', async () => {
    const r = runtime();
    await login(r.coordinator);
    const old = deferred<string>();
    const oldSignal = deferred<AbortSignal>();
    const late = r.coordinator.request((scoped) => {
      oldSignal.resolve(scoped);
      return old.promise;
    }, 'safe-read');
    const assertion = expect(late).rejects.toMatchObject({ name: 'AbortError' });
    const cleanup = vi.fn(async () => {});
    r.coordinator.registerLifecycle({ stop: vi.fn(), clearDurableOnLogout: cleanup });
    await r.coordinator.logout();
    expect((await oldSignal.promise).aborted).toBe(true);
    await login(r.coordinator, 'sage.linden@example.test');
    old.resolve('A private response');
    await assertion;
    expect(r.state()).toMatchObject({ identity: { userId: 'demo-sage' } });
    expect(r.query.getQueryData(currentUserKey('demo-river', 'demo-orbit'))).toBeUndefined();
    expect(r.query.getQueryData(currentUserKey('demo-sage', 'demo-orbit'))).toMatchObject({
      name: 'Sage Linden',
    });
    expect(cleanup).toHaveBeenCalledWith(expect.objectContaining({ userId: 'demo-river' }));
    r.query.clear();
  });
  it('logout cleanup failure is surfaced, blocks account activation and supports explicit retry', async () => {
    const r = runtime();
    await login(r.coordinator);
    const cleanup = vi
      .fn()
      .mockRejectedValueOnce(new Error('Storage unavailable'))
      .mockResolvedValue(undefined);
    r.coordinator.registerLifecycle({ stop: vi.fn(), clearDurableOnLogout: cleanup });
    await expect(r.coordinator.logout()).rejects.toThrow('Storage unavailable');
    await expect(login(r.coordinator, 'sage.linden@example.test')).rejects.toThrow(
      'Storage unavailable',
    );
    await r.coordinator.logout();
    await login(r.coordinator, 'sage.linden@example.test');
    expect(cleanup).toHaveBeenCalledTimes(2);
    expect(r.state()).toMatchObject({ identity: { userId: 'demo-sage' } });
    r.query.clear();
  });
  it('rejects invalid or identity-mismatched auth responses without leaking raw payload into errors', async () => {
    server.use(
      http.post(`${origin}${AUTH_NAMESPACE}/login`, () =>
        HttpResponse.json({ user: { password: 'DO_NOT_EXPOSE' } }),
      ),
    );
    const r = runtime();
    await expect(login(r.coordinator)).rejects.toMatchObject({
      category: 'validation',
      message: 'Invalid authentication response.',
    });
    expect(r.query.getQueryCache().getAll()).toHaveLength(0);
  });
  it('a current-user response for a changed authority identity cannot populate the old identity cache', async () => {
    const r = runtime();
    await login(r.coordinator);
    const state = r.state();
    if (!('identity' in state)) throw new Error('Expected authenticated test fixture');
    await authority.login(client, 'sage.linden@example.test', DEMO_PASSWORD);
    await expect(
      r.coordinator.request((scoped) => r.adapter.currentUser(scoped, state.identity), 'safe-read'),
    ).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    expect(r.state().status).toBe('expired');
    expect(r.query.getQueryCache().getAll()).toHaveLength(0);
  });
  it('registers a fictional user and returns generic recovery success for known and unknown emails', async () => {
    const r = runtime();
    await r.coordinator.register({
      name: '  Nova Reed  ',
      email: 'nova.reed@example.test',
      password: 'Another-fictional-42',
    });
    expect(r.state().status).toBe('authenticated');
    await expect(r.coordinator.resetPassword('nova.reed@example.test')).resolves.toBeUndefined();
    await expect(r.coordinator.resetPassword('unknown@example.test')).resolves.toBeUndefined();
    const restored = await r.adapter.restore(signal());
    expect(restored?.user.name).toBe('Nova Reed');
    r.query.clear();
  });
});
