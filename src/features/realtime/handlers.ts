import { http, HttpResponse } from 'msw';
import { z } from 'zod';
import { canCreateIncident, type IncidentActor } from '@/entities/incident/policy';
import type { Incident } from '@/entities/incident/model';
import { AppError } from '@/shared/errors/app-error';
import type { EventJournal } from './journal';
import { recipientSync } from './protocol';

export function realtimeHandlers(
  journal: EventJournal,
  authenticate: (client: string) => Promise<IncidentActor>,
  detail: (actor: IncidentActor, number: string) => Promise<Incident>,
  ingest: (actor: IncidentActor, incident: Incident) => Promise<void>,
  snapshot: (
    actor: IncidentActor,
    incident: Incident,
    ids: string[],
    threadRoot: string | null,
    messageIds: string[],
  ) => Promise<unknown>,
) {
  const root = '*/mock-api/incidents/:number/realtime';
  const handle =
    (action: (url: URL, actor: IncidentActor, incident: Incident) => Promise<unknown>) =>
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
        const incident = await detail(actor, String(params.number));
        await ingest(actor, incident);
        return new HttpResponse(
          JSON.stringify(await action(new URL(request.url), actor, incident)),
          { headers: { 'Content-Type': 'application/json' } },
        );
      } catch (error) {
        if (error instanceof AppError)
          return HttpResponse.json(
            { category: error.category, message: error.message },
            { status: error.status ?? 503 },
          );
        if (error instanceof z.ZodError)
          return HttpResponse.json(
            { category: 'validation', message: 'Invalid synchronization request.' },
            { status: 400 },
          );
        if (error instanceof Error && 'code' in error)
          return HttpResponse.json({ code: error.code }, { status: 401 });
        return HttpResponse.json(
          { category: 'network', message: 'Synchronization unavailable.' },
          { status: 503 },
        );
      }
    };
  const sequence = (value: string | null) =>
    z.coerce
      .number()
      .int()
      .nonnegative()
      .parse(value ?? 0);
  return [
    http.get(
      `${root}/open`,
      handle(async (_url, actor, incident) => ({
        highWater: (await journal.read(actor.workspaceId, 0)).highWater,
        userId: actor.id,
        workspaceId: actor.workspaceId,
        incidentId: incident.id,
      })),
    ),
    http.get(
      `${root}/sync`,
      handle(async (url, actor) =>
        recipientSync(
          await journal.read(
            actor.workspaceId,
            sequence(url.searchParams.get('after')),
            sequence(url.searchParams.get('boundary')),
          ),
          actor.id,
        ),
      ),
    ),
    http.get(
      `${root}/stream`,
      handle(async (url, actor) => ({
        ...recipientSync(
          await journal.read(actor.workspaceId, sequence(url.searchParams.get('after'))),
          actor.id,
        ),
        controls: await journal.controls(actor.workspaceId, url.searchParams.get('client') ?? ''),
      })),
    ),
    http.get(
      `${root}/snapshot`,
      handle(async (url, actor, incident) =>
        snapshot(
          actor,
          incident,
          z.array(z.string().max(300)).max(60).parse(url.searchParams.getAll('entry')),
          z.string().max(160).nullable().parse(url.searchParams.get('thread')),
          z.array(z.string().max(400)).max(60).parse(url.searchParams.getAll('message')),
        ),
      ),
    ),
  ];
}
export function workspaceRealtimeHandlers(
  journal: EventJournal,
  authenticate: (client: string) => Promise<IncidentActor>,
  ingest: (actor: IncidentActor) => Promise<void>,
) {
  const handle =
    (action: (url: URL, actor: IncidentActor) => Promise<unknown>) =>
    async ({ request }: { request: Request }) => {
      try {
        const actor = await authenticate(request.headers.get('x-fictional-client') ?? '');
        if (!canCreateIncident(actor, actor.workspaceId))
          throw new AppError('authorization', 'Workspace unavailable.', 403);
        await ingest(actor);
        return new HttpResponse(JSON.stringify(await action(new URL(request.url), actor)), {
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
          { category: 'network', message: 'Workspace synchronization unavailable.' },
          { status: 503 },
        );
      }
    };
  const seq = (value: string | null) =>
    z.coerce
      .number()
      .int()
      .nonnegative()
      .parse(value ?? 0);
  const root = '*/mock-api/realtime';
  return [
    http.get(
      `${root}/open`,
      handle(async (_url, actor) => ({
        highWater: (await journal.read(actor.workspaceId, 0)).highWater,
        userId: actor.id,
        workspaceId: actor.workspaceId,
        incidentId: '__workspace__',
      })),
    ),
    http.get(
      `${root}/stream`,
      handle(async (url, actor) => ({
        ...recipientSync(
          await journal.read(actor.workspaceId, seq(url.searchParams.get('after'))),
          actor.id,
        ),
        controls: await journal.controls(actor.workspaceId, url.searchParams.get('client') ?? ''),
      })),
    ),
    http.get(
      `${root}/sync`,
      handle(async (url, actor) =>
        recipientSync(
          await journal.read(
            actor.workspaceId,
            seq(url.searchParams.get('after')),
            seq(url.searchParams.get('boundary')),
          ),
          actor.id,
        ),
      ),
    ),
  ];
}
