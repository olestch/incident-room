import { beforeEach, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { z } from 'zod';
import { seedIncidents } from '@/features/incident-management/authority';
import { emptyPostmortemFields, postmortemSchema } from '@/entities/postmortem/model';
import { AppError } from '@/shared/errors/app-error';
import { PostmortemPage } from './page';
const fake = vi.hoisted(() => ({
  document: null as unknown,
  participant: true,
  initiated: [] as unknown[],
  denied: false,
}));
vi.mock('@/app/_providers/session-provider', () => ({
  useSessionRuntime: () => ({
    state: { generation: 1, identity: { userId: 'demo-sage', workspaceId: 'demo-orbit' } },
    coordinator: {
      snapshot: () => ({
        generation: 1,
        identity: { userId: 'demo-sage', workspaceId: 'demo-orbit' },
      }),
      request: <T,>(task: (s: AbortSignal) => Promise<T>) => task(new AbortController().signal),
    },
    adapter: {
      currentUser: async () => ({
        id: 'demo-sage',
        workspaceId: 'demo-orbit',
        role: 'member',
        status: 'active',
        name: 'Sage',
        email: 'sage@example.test',
      }),
      resource: async <T,>(
        path: string,
        schema: z.ZodType<T>,
        _signal: AbortSignal,
        body?: unknown,
      ) => {
        if (fake.denied) throw new AppError('authorization', 'Denied', 403);
        if (path === '/workspace-users')
          return schema.parse([
            {
              id: 'demo-sage',
              workspaceId: 'demo-orbit',
              role: 'member',
              status: 'active',
              name: 'Sage',
              email: 'sage@example.test',
            },
          ]);
        if (path.includes('/references')) return schema.parse([]);
        if (path.endsWith('/initiate')) {
          fake.initiated.push(body);
          fake.document = {
            ...emptyPostmortemFields(),
            id: crypto.randomUUID(),
            incidentId: 'fictional-incident-2850',
            workspaceId: 'demo-orbit',
            revision: 1,
            status: 'draft',
            createdAt: '2026-10-06T00:00:00.000Z',
            updatedAt: '2026-10-06T00:00:00.000Z',
            createdBy: 'demo-sage',
            updatedBy: 'demo-sage',
          };
          return schema.parse(fake.document);
        }
        if (path.endsWith('/postmortem'))
          return schema.parse({ postmortem: fake.document, items: [] });
        const incident = seedIncidents().incidents[9]!;
        return schema.parse(
          fake.participant
            ? incident
            : { ...incident, commanderId: 'demo-river', participantIds: ['demo-river'] },
        );
      },
    },
  }),
}));
beforeEach(() => {
  fake.document = null;
  fake.participant = true;
  fake.initiated = [];
  fake.denied = false;
});
function mount() {
  const cache = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const view = render(
    <QueryClientProvider client={cache}>
      <PostmortemPage number="INC-2850" />
    </QueryClientProvider>,
  );
  return () => {
    view.unmount();
    cache.clear();
  };
}
it('shows absent draft and initiates with a domain body, then opens editor', async () => {
  const cleanup = mount();
  expect(screen.getByText('Loading Postmortem…')).toBeVisible();
  fireEvent.click(await screen.findByRole('button', { name: 'Initiate Postmortem' }));
  await screen.findByRole('form', { name: 'Postmortem editor' });
  expect(fake.initiated).toEqual([{}]);
  cleanup();
});
it('shows absent read-only member state without initiation', async () => {
  fake.participant = false;
  const cleanup = mount();
  await screen.findByText(/commander or admin must initiate/);
  expect(screen.queryByRole('button', { name: 'Initiate Postmortem' })).not.toBeInTheDocument();
  cleanup();
});
it('shows read-only existing draft without text controls', async () => {
  fake.participant = false;
  fake.document = postmortemSchema.parse({
    ...emptyPostmortemFields(),
    summary: 'Confirmed read-only text',
    id: crypto.randomUUID(),
    workspaceId: 'demo-orbit',
    incidentId: 'fictional-incident-2850',
    revision: 1,
    status: 'draft',
    createdAt: '2026-10-06T00:00:00.000Z',
    updatedAt: '2026-10-06T00:00:00.000Z',
    createdBy: 'demo-river',
    updatedBy: 'demo-river',
  });
  const cleanup = mount();
  await screen.findByText('Confirmed read-only text');
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  expect(screen.queryByText('Add Action Item')).not.toBeInTheDocument();
  cleanup();
});
it('fails closed on authorization with no context/editor leakage', async () => {
  fake.denied = true;
  const cleanup = mount();
  await screen.findByText('Postmortem not found or access denied.');
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  cleanup();
});
it('warns before editor-level link navigation and keeps unsaved fields when declined', async () => {
  const cleanup = mount();
  fireEvent.click(await screen.findByRole('button', { name: 'Initiate Postmortem' }));
  const input = await screen.findByLabelText('Summary');
  fireEvent.change(input, { target: { value: 'Unsaved' } });
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
  await waitFor(() => expect(input).toHaveValue('Unsaved'));
  fireEvent.click(screen.getByRole('link', { name: 'Back to Incident Room' }));
  expect(confirm).toHaveBeenCalledWith('Leave this Postmortem and discard unsaved fields?');
  expect(input).toHaveValue('Unsaved');
  cleanup();
});
it('does not block a same-document skip/focus link when editor is dirty', async () => {
  const cleanup = mount();
  fireEvent.click(await screen.findByRole('button', { name: 'Initiate Postmortem' }));
  const input = await screen.findByLabelText('Summary');
  fireEvent.change(input, { target: { value: 'Unsaved' } });
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
  const skip = document.createElement('a');
  skip.href = '#main-content';
  skip.textContent = 'Skip locally';
  document.body.append(skip);
  const event = new MouseEvent('click', { bubbles: true, cancelable: true });
  skip.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(false);
  expect(confirm).not.toHaveBeenCalled();
  expect(input).toHaveValue('Unsaved');
  skip.remove();
  cleanup();
});
