import { http, HttpResponse } from 'msw';
import { z } from 'zod';
import { AppError } from '@/shared/errors/app-error';
import type { WorkspaceUser } from '@/entities/current-user/model';
import { canCreateIncident } from '@/entities/incident/policy';
import type { MockIncidentAuthority } from './authority';

export function incidentHandlers(
  authority: MockIncidentAuthority,
  authenticate: (client: string) => Promise<WorkspaceUser>,
  users: () => Promise<WorkspaceUser[]>,
) {
  const handle =
    (action: (request: Request, actor: WorkspaceUser) => Promise<unknown>) =>
    async ({ request }: { request: Request }) => {
      try {
        const client = request.headers.get('x-fictional-client');
        if (!client) return HttpResponse.json({ code: 'UNAUTHENTICATED' }, { status: 401 });
        const actor = await authenticate(client);
        if (!canCreateIncident(actor, actor.workspaceId))
          throw new AppError('authorization', 'Access denied.', 403);
        return new HttpResponse(JSON.stringify(await action(request, actor)), {
          headers: { 'Content-Type': 'application/json' },
        });
      } catch (error) {
        if (error instanceof AppError)
          return HttpResponse.json(
            { category: error.category, message: error.message },
            { status: error.status ?? 503 },
          );
        if (error instanceof z.ZodError || error instanceof SyntaxError)
          return HttpResponse.json(
            { category: 'validation', message: 'Check incident fields and references.' },
            { status: 400 },
          );
        // Authentication is injected by app composition; no sibling-feature dependency.
        if (
          error instanceof Error &&
          'code' in error &&
          (error.code === 'SESSION_EXPIRED' || error.code === 'UNAUTHENTICATED')
        )
          return HttpResponse.json({ code: error.code }, { status: 401 });
        return HttpResponse.json(
          { category: 'network', message: 'Incident service unavailable. Try again.' },
          { status: 503 },
        );
      }
    };
  return [
    http.get(
      '*/mock-api/workspace-users',
      handle(async (_request, actor) =>
        (await users()).filter((u) => u.workspaceId === actor.workspaceId),
      ),
    ),
    http.get(
      '*/mock-api/incidents',
      handle(async (request, actor) =>
        authority.list(actor, new URL(request.url).searchParams, await users()),
      ),
    ),
    http.get(
      '*/mock-api/incidents/:number',
      handle(async (request, actor) =>
        authority.detail(
          actor,
          decodeURIComponent(new URL(request.url).pathname.split('/').at(-1)!),
        ),
      ),
    ),
    http.post(
      '*/mock-api/incidents',
      handle(async (request, actor) => {
        const input = z
          .object({ input: z.unknown(), requestId: z.uuid() })
          .strict()
          .parse(await request.json());
        return authority.create(actor, input.input, await users(), input.requestId);
      }),
    ),
  ];
}
