import { http, HttpResponse } from 'msw';
import { z } from 'zod';
import type { IncidentActor } from '@/entities/incident/policy';
import type { Incident } from '@/entities/incident/model';
import { AppError } from '@/shared/errors/app-error';
import type { MockThreadAuthority } from './authority';

export function threadHandlers(
  authority: MockThreadAuthority,
  authenticate: (client: string) => Promise<IncidentActor>,
  incident: (actor: IncidentActor, number: string) => Promise<Incident>,
  activity: (actor: IncidentActor, number: string, time: string) => Promise<void>,
) {
  const handle =
    (
      action: (
        request: Request,
        actor: IncidentActor,
        record: Incident,
        root: string,
      ) => Promise<unknown>,
    ) =>
    async ({
      request,
      params,
    }: {
      request: Request;
      params: Record<string, string | readonly string[] | undefined>;
    }) => {
      try {
        const client = request.headers.get('x-fictional-client');
        if (!client) return HttpResponse.json({ code: 'UNAUTHENTICATED' }, { status: 401 });
        const actor = await authenticate(client);
        const record = await incident(actor, String(params.number));
        return new HttpResponse(
          JSON.stringify(await action(request, actor, record, String(params.root ?? ''))),
          { headers: { 'Content-Type': 'application/json' } },
        );
      } catch (error) {
        if (error instanceof AppError)
          return HttpResponse.json(
            { category: error.category, message: error.message },
            { status: error.status ?? 503 },
          );
        if (error instanceof z.ZodError || error instanceof SyntaxError)
          return HttpResponse.json(
            { category: 'validation', message: 'Invalid Thread request.' },
            { status: 400 },
          );
        if (error instanceof Error && 'code' in error)
          return HttpResponse.json({ code: error.code }, { status: 401 });
        return HttpResponse.json(
          { category: 'network', message: 'Thread service unavailable.' },
          { status: 503 },
        );
      }
    };
  const base = '*/mock-api/incidents/:number/threads';
  return [
    http.get(
      `${base}/summaries`,
      handle(async (request, actor, record) =>
        authority.summaries(actor, record, new URL(request.url).searchParams.getAll('root')),
      ),
    ),
    http.get(
      `${base}/:root`,
      handle(async (_request, actor, record, root) => authority.detail(actor, record, root)),
    ),
    http.get(
      `${base}/:root/messages`,
      handle(async (request, actor, record, root) =>
        authority.window(actor, record, root, new URL(request.url).searchParams.get('cursor')),
      ),
    ),
    http.get(
      `${base}/:root/locate`,
      handle(async (request, actor, record, root) =>
        authority.locate(
          actor,
          record,
          root,
          new URL(request.url).searchParams.get('message') ?? '',
        ),
      ),
    ),
    http.get(
      `${base}/:root/outcome`,
      handle(async (request, actor, record, root) =>
        authority.outcome(
          actor,
          record,
          root,
          new URL(request.url).searchParams.get('mutation') ?? '',
        ),
      ),
    ),
    http.post(
      `${base}/:root/messages`,
      handle(async (request, actor, record, root) => {
        const entry = await authority.create(actor, record, root, await request.json());
        await activity(actor, record.number, entry.createdAt);
        return entry;
      }),
    ),
  ];
}
