import { z } from 'zod';
import {
  compareSearch,
  searchRequestSchema,
  searchResultSchema,
  searchTypes,
  type SearchRequest,
  type SearchResult,
} from '@/entities/search/model';
import { AppError } from '@/shared/errors/app-error';
import { createDiagnostics } from '@/shared/diagnostics/diagnostics';

export type SearchActor = {
  id: string;
  workspaceId: string;
  status: 'active' | 'deactivated';
  role: 'admin' | 'member';
};
export type SearchSource = (
  actor: SearchActor,
  request: SearchRequest,
  emit: (result: SearchResult) => void,
) => Promise<void>;
const cursorSchema = z.object({
  signature: z.string(),
  after: z.record(
    z.string(),
    z.object({ score: z.number(), time: z.iso.datetime(), id: z.string() }),
  ),
});
/** Server-only bounded top-k collection. Neither histories nor an index enter Query/React. */
export class MockSearchAuthority {
  private readonly diagnostic = createDiagnostics();
  constructor(
    private readonly sources: readonly SearchSource[],
    private readonly policy: (
      actor: SearchActor,
    ) => Promise<{ delayMs: number; fail: boolean }> = async () => ({ delayMs: 0, fail: false }),
    private readonly completed: (actor: SearchActor) => Promise<void> = async () => {},
  ) {}
  async search(actor: SearchActor, raw: unknown) {
    if (actor.status !== 'active') throw new AppError('authorization', 'Search unavailable.', 403);
    const request = searchRequestSchema.parse(raw);
    this.diagnostic.record({ event: 'search_requested' });
    const policy = await this.policy(actor);
    const signature = JSON.stringify([
      actor.id,
      actor.workspaceId,
      request.query,
      request.type,
      request.limit,
    ]);
    let after: Record<string, Pick<SearchResult, 'score' | 'time' | 'id'>> = {};
    if (request.cursor) {
      try {
        const cursor = cursorSchema.parse(
          JSON.parse(
            new TextDecoder().decode(
              Uint8Array.from(atob(request.cursor), (char) => char.charCodeAt(0)),
            ),
          ),
        );
        if (cursor.signature !== signature) throw new Error();
        after = cursor.after;
      } catch {
        throw new AppError('validation', 'Invalid Search cursor.', 400);
      }
    }
    const groups = new Map<string, SearchResult[]>();
    const emit = (rawResult: SearchResult) => {
      const result = searchResultSchema.parse(rawResult);
      if (request.type && request.type !== result.type) return;
      const boundary = after[result.type];
      if (boundary && compareSearch(result, boundary) <= 0) return;
      const group = groups.get(result.type) ?? [];
      if (group.some((item) => item.id === result.id)) return;
      group.push(result);
      group.sort(compareSearch);
      group.splice(request.limit + 1);
      groups.set(result.type, group);
    };
    // Sequential authority access keeps mock IndexedDB work bounded under concurrent clients.
    for (const source of this.sources) await source(actor, request, emit);
    const items: SearchResult[] = [];
    const boundaries = { ...after };
    let more = false;
    for (const type of searchTypes) {
      const group = groups.get(type) ?? [];
      const page = group.slice(0, request.limit);
      items.push(...page);
      if (page.length) {
        const last = page.at(-1)!;
        boundaries[type] = { id: last.id, score: last.score, time: last.time };
      }
      more ||= group.length > request.limit;
    }
    if (policy.delayMs) await new Promise((resolve) => setTimeout(resolve, policy.delayMs));
    await this.completed(actor);
    if (policy.fail) {
      this.diagnostic.record({ event: 'search_failed' });
      throw new AppError('network', 'Search temporarily unavailable.', 503);
    }
    return {
      items,
      nextCursor: more
        ? btoa(
            Array.from(
              new TextEncoder().encode(JSON.stringify({ signature, after: boundaries })),
              (byte) => String.fromCharCode(byte),
            ).join(''),
          )
        : null,
    };
  }
}
