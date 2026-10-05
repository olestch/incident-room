import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { useSyncExternalStore } from 'react';
import { Provider } from 'react-redux';
import { makeStore } from '@/app/_providers/store';
import { LocalWorkService, emptyLocalData } from '@/features/timeline/local-work';
import { MockTimelineAuthority, seedTimeline } from '@/features/timeline/authority';
import { timelineHandlers } from '@/features/timeline/handlers';
import { MemoryAtomicStore } from '@/shared/persistence/atomic-store';
import { installVirtualLayout } from '@/shared/testing/virtual-layout';
import { timelineKeys, type TimelineWindow } from '@/entities/timeline/model';
import { currentUserKey } from '@/entities/current-user/model';
import { incidentKeys } from '@/entities/incident/model';
import { incidentPageSchema, incidentSchema } from '@/entities/incident/model';
import { isAssignedTo } from '@/entities/incident/filters';
import { HttpSessionAdapter } from '@/features/session/http-session-adapter';
import { SessionCoordinator } from '@/features/session/session-coordinator';
import {
  AuthorityError,
  MemoryAuthorityStore,
  MockAuthAuthority,
} from '@/features/session/mock/authority';
import { authHandlers } from '@/features/session/mock/handlers';
import {
  MemoryIncidentStore,
  MockIncidentAuthority,
} from '@/features/incident-management/authority';
import { incidentHandlers } from '@/features/incident-management/handlers';
import { useSessionRuntime, useLocalWork } from '@/app/_providers/session-provider';
import { IncidentPage } from './incident-page';
import { EventJournal, seedJournal } from '@/features/realtime/journal';
import { composeRealtimeAuthority } from '@/app/_mocks/realtime-authority';
vi.mock('@/features/realtime/ephemeral-broker', () => ({ ephemeralRequest: async () => [] }));

const navigation = vi.hoisted(() => ({
  search: '',
  listeners: new Set<() => void>(),
  push: vi.fn(),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: navigation.push }),
  useSearchParams: () =>
    new URLSearchParams(
      useSyncExternalStore(
        (listener) => {
          navigation.listeners.add(listener);
          return () => {
            navigation.listeners.delete(listener);
          };
        },
        () => navigation.search,
      ),
    ),
}));
vi.mock('@/app/_providers/session-provider', () => ({
  useSessionRuntime: vi.fn(),
  useLocalWork: vi.fn(),
}));
const server = setupServer();
let cache: QueryClient;
let coordinator: SessionCoordinator;
let auth: MockAuthAuthority;
let authority: MockIncidentAuthority;
const client = 'react-test-client';
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterAll(() => server.close());
beforeEach(async () => {
  installVirtualLayout();
  vi.mocked(useLocalWork).mockReturnValue(
    new LocalWorkService(new MemoryAtomicStore(emptyLocalData)),
  );
  navigation.search = '';
  navigation.listeners.clear();
  navigation.push.mockImplementation((url: string) => {
    navigation.search = new URL(url, 'http://localhost').search;
    for (const listener of navigation.listeners) listener();
  });
  auth = new MockAuthAuthority(new MemoryAuthorityStore());
  authority = new MockIncidentAuthority(new MemoryIncidentStore());
  const timeline = new MockTimelineAuthority(new MemoryAtomicStore(seedTimeline));
  server.use(
    ...composeRealtimeAuthority(
      new EventJournal(new MemoryAtomicStore(seedJournal)),
      authority,
      timeline,
      async (id) => {
        const session = await auth.current(id);
        if (!session) throw new AuthorityError('UNAUTHENTICATED', 401);
        return session.user;
      },
    ),
    ...timelineHandlers(
      timeline,
      async (id) => {
        const session = await auth.current(id);
        if (!session) throw new AuthorityError('UNAUTHENTICATED', 401);
        return session.user;
      },
      (actor, number) => authority.detail(actor, number),
      (actor, number, time) => authority.recordActivity(actor, number, time),
    ),
    ...authHandlers(auth),
    ...incidentHandlers(
      authority,
      async (id) => {
        const session = await auth.current(id);
        if (!session) throw new AuthorityError('UNAUTHENTICATED', 401);
        return session.user;
      },
      () => auth.users(),
    ),
  );
  cache = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 30000 }, mutations: { retry: false } },
  });
  const adapter = new HttpSessionAdapter(() => client, 'http://localhost');
  coordinator = new SessionCoordinator(adapter, {
    changed: () => {},
    activated: ({ user }) => cache.setQueryData(currentUserKey(user.id, user.workspaceId), user),
    cleared: () => {
      cache.removeQueries({ queryKey: ['identity'] });
    },
  });
  await coordinator.login({ email: 'sage.linden@example.test', password: 'Fictional-pass-42' });
  vi.mocked(useSessionRuntime).mockImplementation(() => ({
    coordinator,
    adapter,
    state: coordinator.snapshot(),
    issue: null,
    retry: () => {},
  }));
  if (!HTMLDialogElement.prototype.showModal)
    Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
      configurable: true,
      value() {},
    });
  if (!HTMLDialogElement.prototype.close)
    Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value() {} });
  vi.spyOn(HTMLDialogElement.prototype, 'showModal').mockImplementation(function (
    this: HTMLDialogElement,
  ) {
    this.setAttribute('open', '');
  });
  vi.spyOn(HTMLDialogElement.prototype, 'close').mockImplementation(function (
    this: HTMLDialogElement,
  ) {
    this.removeAttribute('open');
  });
});
afterEach(async () => {
  await coordinator.dispose();
  cache.clear();
  server.resetHandlers();
});
function mount(number?: string) {
  return render(
    <QueryClientProvider client={cache}>
      <Provider store={makeStore()}>
        <IncidentPage {...(number ? { number } : {})} />
      </Provider>
    </QueryClientProvider>,
  );
}
it('loads server data, applies URL filters and My Incidents, clears and resets pagination', async () => {
  const user = userEvent.setup();
  mount();
  expect(screen.getByRole('status')).toHaveTextContent('Loading incidents');
  const list = await screen.findByRole('list', { name: 'Incidents' });
  expect(within(list).getAllByRole('listitem')).toHaveLength(12);
  await user.click(screen.getByRole('button', { name: 'Load more' }));
  await waitFor(() => expect(within(list).getAllByRole('listitem')).toHaveLength(24));
  await user.click(screen.getByLabelText('P1 · Critical'));
  await waitFor(() =>
    expect(within(screen.getByRole('list')).getAllByRole('listitem')).toHaveLength(8),
  );
  await user.click(screen.getByLabelText('Assigned to me'));
  await waitFor(() => expect(screen.getByRole('status')).not.toHaveTextContent('Loading'));
  const actor = (await auth.current(client))!.user;
  const result = await authority.list(
    actor,
    new URLSearchParams(navigation.search),
    await auth.users(),
  );
  expect(result.items.every((i) => isAssignedTo(i, actor.id))).toBe(true);
  expect(within(screen.getByRole('list')).getAllByRole('listitem')).toHaveLength(result.total);
  await user.click(screen.getByRole('button', { name: 'Clear filters' }));
  await waitFor(() =>
    expect(within(screen.getByRole('list')).getAllByRole('listitem')).toHaveLength(12),
  );
});
it('distinguishes filtered empty, genuinely empty and error; retry preserves URL', async () => {
  navigation.search = '?from=2026-10-05';
  mount();
  expect(
    await screen.findByRole('heading', { name: 'No incidents match your filters' }),
  ).toBeVisible();
  expect(screen.getAllByRole('button', { name: 'Clear filters' })).toHaveLength(2);
});
it('represents an empty authority, not a network failure', async () => {
  server.use(
    http.get('*/mock-api/incidents', () =>
      HttpResponse.json({ items: [], total: 0, workspaceTotal: 0, nextCursor: null }),
    ),
  );
  mount();
  expect(await screen.findByRole('heading', { name: 'No incidents yet' })).toBeVisible();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});
it('retries initial network failure without erasing the effective URL', async () => {
  navigation.search = '?severity=P2';
  let failing = true;
  server.use(
    http.get('*/mock-api/incidents', async ({ request }) =>
      failing
        ? HttpResponse.json({ category: 'network', message: 'Unavailable.' }, { status: 503 })
        : HttpResponse.json(
            await authority.list(
              (await auth.current(client))!.user,
              new URL(request.url).searchParams,
              await auth.users(),
            ),
          ),
    ),
  );
  mount();
  expect(await screen.findByRole('alert')).toHaveTextContent('Unable to load incident data.');
  expect(screen.queryByText('No incidents yet')).not.toBeInTheDocument();
  failing = false;
  await userEvent.setup().click(screen.getByRole('button', { name: 'Retry' }));
  await screen.findByRole('list');
  expect(navigation.search).toBe('?severity=P2');
  expect(screen.getByLabelText('P2 · High')).toBeChecked();
});
it('keeps confirmed pages on pagination failure and retries the same cursor', async () => {
  let failing = true;
  server.use(
    http.get('*/mock-api/incidents', async ({ request }) => {
      const params = new URL(request.url).searchParams;
      return params.has('cursor') && failing
        ? HttpResponse.json({ category: 'network', message: 'Unavailable.' }, { status: 503 })
        : HttpResponse.json(
            await authority.list((await auth.current(client))!.user, params, await auth.users()),
          );
    }),
  );
  const user = userEvent.setup();
  mount();
  await screen.findByRole('list');
  await user.click(screen.getByRole('button', { name: 'Load more' }));
  await screen.findByRole('alert');
  expect(within(screen.getByRole('list')).getAllByRole('listitem')).toHaveLength(12);
  failing = false;
  await user.click(screen.getByRole('button', { name: 'Retry' }));
  await waitFor(() =>
    expect(within(screen.getByRole('list')).getAllByRole('listitem')).toHaveLength(24),
  );
});
it('seeds confirmed detail, invalidates lists and navigates on create', async () => {
  const user = userEvent.setup();
  mount();
  await screen.findByRole('list');
  await user.click(screen.getByRole('button', { name: 'Create Incident' }));
  await user.type(screen.getByLabelText('Title (required)'), 'A fictional integration incident');
  await user.selectOptions(screen.getByLabelText('Severity (required)'), 'P1');
  await user.click(
    within(screen.getByRole('dialog')).getByRole('button', { name: 'Create Incident' }),
  );
  await waitFor(() => expect(navigation.push).toHaveBeenLastCalledWith('/app/incidents/INC-2873'));
  expect(
    cache.getQueryData(incidentKeys.detail('demo-sage', 'demo-orbit', 'INC-2873')),
  ).toMatchObject({ commanderId: 'demo-sage', status: 'triggered' });
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});
it.each([
  ['INC-9999', 'Incident not found.'],
  ['INC-2841', 'Access denied.'],
])('shows distinct detail boundary for %s', async (number, message) => {
  if (message === 'Access denied.')
    server.use(
      http.get('*/mock-api/incidents/:number', () =>
        HttpResponse.json(
          { category: 'authorization', message: 'Access denied.' },
          { status: 403 },
        ),
      ),
    );
  mount(number);
  expect(screen.getByRole('status')).toHaveTextContent('Loading incident');
  expect(await screen.findByRole('alert')).toHaveTextContent(message);
  expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
});
it('reads detail context and retries a network boundary', async () => {
  server.use(
    http.get('*/mock-api/incidents/:number', () =>
      HttpResponse.json({ category: 'network', message: 'Unavailable.' }, { status: 503 }),
    ),
  );
  mount('INC-2841');
  await screen.findByRole('alert');
  server.resetHandlers();
  server.use(
    ...authHandlers(auth),
    ...incidentHandlers(
      authority,
      async (id) => (await auth.current(id))!.user,
      () => auth.users(),
    ),
  );
  await userEvent.setup().click(screen.getByRole('button', { name: 'Retry' }));
  expect(await screen.findByRole('heading', { name: /INC-2841/ })).toHaveFocus();
  expect(screen.getByRole('heading', { name: 'Timeline' })).toBeVisible();
});
it('cancels superseded filter work so late results cannot replace current URL results', async () => {
  let release!: () => void;
  let cancelled = false;
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  server.use(
    http.get('*/mock-api/incidents', async ({ request }) => {
      const params = new URL(request.url).searchParams;
      if (params.get('severity') === 'P1') {
        request.signal.addEventListener('abort', () => {
          cancelled = true;
        });
        await blocked;
      }
      return HttpResponse.json(
        await authority.list((await auth.current(client))!.user, params, await auth.users()),
      );
    }),
  );
  const user = userEvent.setup();
  mount();
  await screen.findByRole('list');
  await user.click(screen.getByLabelText('P1 · Critical'));
  await waitFor(() => expect(navigation.search).toBe('?severity=P1'));
  await user.click(screen.getByLabelText('P2 · High'));
  await user.click(screen.getByLabelText('P1 · Critical'));
  await screen.findByRole('list');
  await act(async () => {
    release();
  });
  await waitFor(() => expect(cancelled).toBe(true));
  expect(navigation.search).toBe('?severity=P2');
  expect(screen.getByRole('list')).not.toHaveTextContent('P1 · Critical');
});

it('guards navigation after a confirmed create if identity clears while list invalidation waits', async () => {
  const user = userEvent.setup();
  const view = mount();
  await screen.findByRole('list');
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  const invalidate = vi.spyOn(cache, 'invalidateQueries').mockReturnValueOnce(blocked);
  await user.click(screen.getByRole('button', { name: 'Create Incident' }));
  await user.type(screen.getByLabelText('Title (required)'), 'Identity lifecycle test');
  await user.selectOptions(screen.getByLabelText('Severity (required)'), 'P1');
  await user.click(
    within(screen.getByRole('dialog')).getByRole('button', { name: 'Create Incident' }),
  );
  await waitFor(() => expect(invalidate).toHaveBeenCalledOnce());
  await act(async () => {
    await coordinator.logout();
    view.rerender(
      <QueryClientProvider client={cache}>
        <IncidentPage />
      </QueryClientProvider>,
    );
    release();
    await blocked;
  });
  expect(navigation.push).not.toHaveBeenCalled();
  expect(
    cache.getQueryData(incidentKeys.detail('demo-sage', 'demo-orbit', 'INC-2873')),
  ).toBeUndefined();
});
it('independently rejects unauthenticated HTTP and unknown references; schema-invalid responses never enter Query', async () => {
  const anonymous = await fetch('http://localhost/mock-api/incidents');
  expect(anonymous.status).toBe(401);
  const bad = await fetch('http://localhost/mock-api/incidents', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-fictional-client': client },
    body: JSON.stringify({
      input: {
        title: 'Bad references',
        description: '',
        severity: 'P1',
        serviceIds: ['unknown'],
        participantIds: [],
      },
      requestId: crypto.randomUUID(),
    }),
  });
  expect(bad.status).toBe(400);
  server.use(
    http.get('*/mock-api/incidents', () =>
      HttpResponse.json({
        items: [{ number: 'INC-2841' }],
        nextCursor: null,
        total: 1,
        workspaceTotal: 1,
      }),
    ),
  );
  mount();
  await screen.findByRole('alert');
  expect(screen.queryByRole('list')).not.toBeInTheDocument();
});
it('incident reads refresh expired access once; create is not automatically replayed after expiry', async () => {
  const { adapter } = vi.mocked(useSessionRuntime)();
  await auth.expire(client, true);
  const result = await coordinator.request(
    (signal) => adapter.resource('/incidents', incidentPageSchema, signal),
    'safe-read',
  );
  expect(result.total).toBe(32);
  await auth.expire(client, true);
  const input = {
    title: 'Expiry test',
    description: '',
    severity: 'P1',
    serviceIds: [],
    participantIds: [],
  };
  const requestId = crypto.randomUUID();
  await expect(
    coordinator.request(
      (signal) => adapter.resource('/incidents', incidentSchema, signal, { input, requestId }),
      'mutation',
    ),
  ).rejects.toMatchObject({ category: 'authentication' });
  expect(
    (
      await authority.list(
        (await auth.current(client))!.user,
        new URLSearchParams(),
        await auth.users(),
      )
    ).total,
  ).toBe(32);
  await coordinator.request(
    (signal) => adapter.resource('/incidents', incidentSchema, signal, { input, requestId }),
    'mutation',
  );
  expect(
    (
      await authority.list(
        (await auth.current(client))!.user,
        new URLSearchParams(),
        await auth.users(),
      )
    ).total,
  ).toBe(33);
});

it('hides cached incident context when authority revokes access, but retains retryable errors', async () => {
  mount('INC-2841');
  await screen.findByRole('heading', { name: /INC-2841/ });
  server.use(
    http.get('*/mock-api/incidents/:number', () =>
      HttpResponse.json({ category: 'authorization', message: 'Access denied.' }, { status: 403 }),
    ),
  );
  await act(async () => {
    await cache.invalidateQueries({
      queryKey: incidentKeys.detail('demo-sage', 'demo-orbit', 'INC-2841'),
    });
  });
  expect(await screen.findByRole('alert')).toHaveTextContent('Access denied.');
  expect(screen.queryByRole('heading', { name: /INC-2841/ })).not.toBeInTheDocument();
});
it('Timeline storage failure keeps actual editor text, draft ownership and never dispatches a mutation', async () => {
  const work = vi.mocked(useLocalWork)();
  vi.spyOn(work, 'handoff').mockRejectedValueOnce(new Error('Quota unavailable'));
  const posts = vi.fn();
  server.use(
    http.post('*/mock-api/incidents/:number/timeline', () => {
      posts();
      return HttpResponse.error();
    }),
  );
  mount('INC-2841');
  const input = await screen.findByLabelText('Message');
  await waitFor(() => expect(input).toBeEnabled());
  await userEvent.setup().type(input, 'Fictional retained editor text');
  await userEvent.setup().click(screen.getByRole('button', { name: 'Send' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Your text remains in the editor');
  expect(input).toHaveValue('Fictional retained editor text');
  expect(posts).not.toHaveBeenCalled();
});
it('Timeline pagination error preserves confirmed window and retries the same opaque boundary', async () => {
  mount('INC-2841');
  const historyKey = timelineKeys.history('demo-sage', 'demo-orbit', 'fictional-incident-2841');
  await waitFor(() =>
    expect(
      cache.getQueryData<{ pages: TimelineWindow[] }>(historyKey)?.pages[0]?.items,
    ).toHaveLength(60),
  );
  const previous = cache.getQueryData<{ pages: TimelineWindow[] }>(historyKey)!;
  const cursor = previous.pages[0]!.olderCursor;
  const requests: string[] = [];
  server.use(
    http.get('*/mock-api/incidents/:number/timeline', ({ request }) => {
      requests.push(new URL(request.url).searchParams.get('cursor') ?? '');
      return HttpResponse.json(
        { category: 'network', message: 'Fictional boundary unavailable.' },
        { status: 503 },
      );
    }),
  );
  await userEvent.setup().click(screen.getByRole('button', { name: 'Load older history' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Unable to load Timeline history');
  expect(cache.getQueryData<{ pages: TimelineWindow[] }>(historyKey)?.pages[0]?.items).toEqual(
    previous.pages[0]!.items,
  );
  await userEvent.setup().click(screen.getByRole('button', { name: 'Retry history' }));
  await waitFor(() => expect(requests).toEqual([cursor, cursor]));
});
it('a navigation flush cannot recreate a draft already moving atomically into the outbox', async () => {
  const work = vi.mocked(useLocalWork)();
  let release!: () => void;
  const original = work.handoff.bind(work);
  vi.spyOn(work, 'handoff').mockImplementation(async (lease, body) => {
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    return original(lease, body);
  });
  const mounted = mount('INC-2841');
  const input = await screen.findByLabelText('Message');
  await waitFor(() => expect(input).toBeEnabled());
  await userEvent.setup().type(input, 'Fictional atomic navigation handoff');
  await userEvent.setup().click(screen.getByRole('button', { name: 'Send' }));
  mounted.unmount();
  await act(async () => {
    release();
  });
  const restored = await work.read(
    work.lease({
      userId: 'demo-sage',
      workspaceId: 'demo-orbit',
      incidentId: 'fictional-incident-2841',
    }),
  );
  expect(restored.draft).toBe('');
  expect(restored.records).toHaveLength(1);
  expect(restored.records[0]?.body).toBe('Fictional atomic navigation handoff');
});
