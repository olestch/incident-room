import { http, HttpResponse } from 'msw';
import { z } from 'zod';
import type { IncidentActor } from '@/entities/incident/policy';
import type { Incident } from '@/entities/incident/model';
import type { WorkspaceUser } from '@/entities/current-user/model';
import { AppError } from '@/shared/errors/app-error';
import type { MockPostmortemAuthority } from './authority';
import type { TimelineEntry } from '@/entities/timeline/model';
export function postmortemHandlers(
  authority: MockPostmortemAuthority,
  authenticate: (client: string) => Promise<IncidentActor>,
  incident: (actor: IncidentActor, number: string) => Promise<Incident>,
  users: () => Promise<WorkspaceUser[]>,
  publish: (actor: IncidentActor) => Promise<void>,
  references: (actor: IncidentActor, record: Incident, ids: string[]) => Promise<TimelineEntry[]>,
) {
  const handle =
    (action: (request: Request, actor: IncidentActor, record: Incident) => Promise<unknown>) =>
    async ({
      request,
      params,
    }: {
      request: Request;
      params: { number?: string | readonly string[] };
    }) => {
      try {
        const actor = await authenticate(request.headers.get('x-fictional-client') ?? '');
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
        if (error instanceof Error && 'code' in error)
          return HttpResponse.json({ code: error.code }, { status: 401 });
        return HttpResponse.json(
          {
            category: error instanceof z.ZodError ? 'validation' : 'network',
            message: 'Postmortem request unavailable. Your edits are retained.',
          },
          { status: error instanceof z.ZodError ? 400 : 503 },
        );
      }
    };
  const root = '*/mock-api/incidents/:number/postmortem';
  return [
    http.get(
      `${root}/references`,
      handle(async (request, actor, record) => {
        await authority.detail(actor, record);
        const ids = z
          .array(z.string().min(1).max(160))
          .max(100)
          .parse(new URL(request.url).searchParams.getAll('entry'));
        return references(actor, record, ids);
      }),
    ),
    http.get(
      root,
      handle((_request, actor, record) => authority.detail(actor, record)),
    ),
    http.post(
      `${root}/initiate`,
      handle(async (_request, actor, record) => {
        const result = await authority.initiate(actor, record);
        await publish(actor);
        return result;
      }),
    ),
    http.post(
      `${root}/save`,
      handle(async (request, actor, record) => {
        const result = await authority.save(actor, record, await request.json());
        await publish(actor);
        return result;
      }),
    ),
    http.post(
      `${root}/actions/create`,
      handle(async (request, actor, record) => {
        const result = await authority.createAction(
          actor,
          record,
          await request.json(),
          await users(),
        );
        await publish(actor);
        return result;
      }),
    ),
    http.post(
      `${root}/actions/save`,
      handle(async (request, actor, record) => {
        const result = await authority.saveAction(
          actor,
          record,
          await request.json(),
          await users(),
        );
        await publish(actor);
        return result;
      }),
    ),
  ];
}
