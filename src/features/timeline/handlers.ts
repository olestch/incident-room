import { http, HttpResponse } from 'msw';
import { z } from 'zod';
import type { IncidentActor } from '@/entities/incident/policy';
import type { Incident } from '@/entities/incident/model';
import { AppError } from '@/shared/errors/app-error';
import type { MockTimelineAuthority } from './authority';

export function timelineHandlers(
  authority: MockTimelineAuthority,
  authenticate: (client: string) => Promise<IncidentActor>,
  incident: (actor: IncidentActor, number: string) => Promise<Incident>,
  activity: (actor: IncidentActor, number: string, time: string) => Promise<void>,
) {
  const handle =
    (action: (request: Request, actor: IncidentActor, incident: Incident) => Promise<unknown>) =>
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
        return new HttpResponse(JSON.stringify(await action(request, actor, record)), {
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
            { category: 'validation', message: 'Invalid Timeline request.' },
            { status: 400 },
          );
        if (error instanceof Error && 'code' in error)
          return HttpResponse.json({ code: error.code }, { status: 401 });
        return HttpResponse.json(
          { category: 'network', message: 'Timeline service unavailable.' },
          { status: 503 },
        );
      }
    };
  const root = '*/mock-api/incidents/:number/timeline';
  return [
    http.get(
      root,
      handle(async (request, actor, record) =>
        authority.window(actor, record, new URL(request.url).searchParams.get('cursor')),
      ),
    ),
    http.get(
      `${root}/locate`,
      handle(async (request, actor, record) =>
        authority.locate(actor, record, new URL(request.url).searchParams.get('entry') ?? ''),
      ),
    ),
    http.get(
      `${root}/outcome`,
      handle(async (request, actor, record) =>
        authority.outcome(actor, record, new URL(request.url).searchParams.get('mutation') ?? ''),
      ),
    ),
    http.post(
      root,
      handle(async (request, actor, record) => {
        const entry = await authority.create(actor, record, await request.json(), (entry) =>
          activity(actor, record.number, entry.createdAt),
        );
        return entry;
      }),
    ),
  ];
}
