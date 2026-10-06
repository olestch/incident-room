import { http, HttpResponse } from 'msw';
import { AppError } from '@/shared/errors/app-error';
import type { MockSearchAuthority, SearchActor } from './authority';
export function searchHandlers(
  authority: MockSearchAuthority,
  authenticate: (client: string) => Promise<SearchActor>,
) {
  return [
    http.get('*/mock-api/search', async ({ request }) => {
      try {
        const actor = await authenticate(request.headers.get('x-fictional-client') ?? '');
        const params = new URL(request.url).searchParams;
        const result = await authority.search(actor, {
          query: params.get('q') ?? '',
          cursor: params.get('cursor'),
          type: params.get('type'),
          limit: Number(params.get('limit') ?? 10),
        });
        return HttpResponse.json(result);
      } catch (error) {
        if (error instanceof AppError)
          return HttpResponse.json(
            { category: error.category, message: error.message },
            { status: error.status ?? 503 },
          );
        if (error instanceof Error && 'code' in error)
          return HttpResponse.json({ code: error.code }, { status: 401 });
        return HttpResponse.json(
          { category: 'validation', message: 'Search request unavailable.' },
          { status: 400 },
        );
      }
    }),
  ];
}
