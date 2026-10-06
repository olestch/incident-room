import { http, HttpResponse } from 'msw';
import { z } from 'zod';
import { AppError } from '@/shared/errors/app-error';
import type { MockNotificationAuthority, NotificationActor } from './authority';
export function notificationHandlers(
  authority: MockNotificationAuthority,
  authenticate: (client: string) => Promise<NotificationActor>,
  publish: (actor: NotificationActor) => Promise<void>,
) {
  const handle =
    (action: (request: Request, actor: NotificationActor) => Promise<unknown>) =>
    async ({ request }: { request: Request }) => {
      try {
        const actor = await authenticate(request.headers.get('x-fictional-client') ?? '');
        return new HttpResponse(JSON.stringify(await action(request, actor)), {
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
          { category: 'validation', message: 'Inbox request unavailable.' },
          { status: 400 },
        );
      }
    };
  return [
    http.get(
      '*/mock-api/notifications',
      handle((request, actor) =>
        authority.page(actor, new URL(request.url).searchParams.get('cursor')),
      ),
    ),
    http.get(
      '*/mock-api/notifications/unread',
      handle((_request, actor) => authority.unread(actor)),
    ),
    http.post(
      '*/mock-api/notifications/read',
      handle(async (request, actor) => {
        const input = z
          .object({ id: z.uuid().nullable(), read: z.boolean() })
          .parse(await request.json());
        if (!input.id && !input.read)
          throw new AppError('validation', 'Bulk unread is not supported.', 400);
        const result = await authority.mark(actor, input.id, input.read);
        await publish(actor);
        return result;
      }),
    ),
  ];
}
