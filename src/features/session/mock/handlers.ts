import { http, HttpResponse } from 'msw';
import { z } from 'zod';
import { loginSchema, resetSchema } from '@/features/session/auth-schemas';
import { AUTH_NAMESPACE } from '@/features/session/http-session-adapter';
import { AuthorityError, type MockAuthAuthority } from './authority';

const registerSchema = z.object({
  name: z.string().trim().min(1).max(80),
  email: z.email().transform((value) => value.toLowerCase()),
  password: z.string().min(10).max(128),
});
export function authHandlers(authority: MockAuthAuthority) {
  const handle =
    (action: (request: Request, client: string) => Promise<unknown>) =>
    async ({ request }: { request: Request }) => {
      const client = request.headers.get('x-fictional-client');
      if (!client || !/^[a-zA-Z0-9-]{1,100}$/.test(client))
        return HttpResponse.json({ code: 'INVALID_INPUT' }, { status: 400 });
      try {
        return new HttpResponse(JSON.stringify(await action(request, client)), {
          headers: { 'Content-Type': 'application/json' },
        });
      } catch (error) {
        if (error instanceof AuthorityError)
          return HttpResponse.json({ code: error.code }, { status: error.status });
        if (error instanceof z.ZodError || error instanceof SyntaxError)
          return HttpResponse.json({ code: 'INVALID_INPUT' }, { status: 400 });
        return HttpResponse.json({ code: 'UNAVAILABLE' }, { status: 503 });
      }
    };
  return [
    http.get(
      `*${AUTH_NAMESPACE}/session`,
      handle((_request, client) => authority.current(client)),
    ),
    http.get(
      `*${AUTH_NAMESPACE}/me`,
      handle(async (_request, client) => {
        const session = await authority.current(client);
        if (!session) throw new AuthorityError('UNAUTHENTICATED', 401);
        return session.user;
      }),
    ),
    http.post(
      `*${AUTH_NAMESPACE}/login`,
      handle(async (request, client) => {
        const input = loginSchema.parse(await request.json());
        return authority.login(client, input.email, input.password);
      }),
    ),
    http.post(
      `*${AUTH_NAMESPACE}/register`,
      handle(async (request, client) =>
        authority.register(client, registerSchema.parse(await request.json())),
      ),
    ),
    http.post(
      `*${AUTH_NAMESPACE}/refresh`,
      handle((_request, client) => authority.refresh(client)),
    ),
    http.post(
      `*${AUTH_NAMESPACE}/logout`,
      handle(async (_request, client) => {
        await authority.logout(client);
        return { ok: true };
      }),
    ),
    http.post(
      `*${AUTH_NAMESPACE}/forgot-password`,
      handle(async (request) => {
        resetSchema.parse(await request.json());
        return { ok: true };
      }),
    ),
  ];
}
