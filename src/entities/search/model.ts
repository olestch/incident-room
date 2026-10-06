import { z } from 'zod';
import { queryScope } from '@/shared/query/query-scope';

export const searchTypes = ['incident', 'timeline_message', 'thread_message', 'user'] as const;
export const searchTypeSchema = z.enum(searchTypes);
export const normalizeSearch = (value: string) => value.trim().replace(/\s+/g, ' ');
export const searchRequestSchema = z.object({
  query: z.string().max(200).transform(normalizeSearch).pipe(z.string().min(2)),
  type: searchTypeSchema.nullable().default(null),
  cursor: z.string().max(4000).nullable().default(null),
  limit: z.number().int().min(1).max(10).default(10),
});
const base = {
  id: z.string().min(1).max(400),
  snippet: z.string().max(240),
  score: z.number().int().nonnegative(),
  time: z.iso.datetime(),
};
const context = {
  incidentNumber: z.string().regex(/^INC-\d+$/),
  title: z.string().max(160),
};
export const searchResultSchema = z.discriminatedUnion('type', [
  z.object({
    ...base,
    ...context,
    type: z.literal('incident'),
    severity: z.enum(['P1', 'P2', 'P3', 'P4']),
    status: z.string().max(30),
    serviceIds: z.array(z.string()).max(20),
  }),
  z.object({
    ...base,
    ...context,
    type: z.literal('timeline_message'),
    entryId: z.string().max(160),
    authorId: z.string().max(160),
    authorName: z.string().max(160).optional(),
  }),
  z.object({
    ...base,
    ...context,
    type: z.literal('thread_message'),
    rootId: z.string().max(160),
    messageId: z.string().max(400),
    authorId: z.string().max(160),
    authorName: z.string().max(160).optional(),
  }),
  z.object({
    ...base,
    type: z.literal('user'),
    userId: z.string().max(160),
    name: z.string().max(160),
    role: z.enum(['member', 'admin']),
    status: z.enum(['active', 'deactivated']),
  }),
]);
export type SearchResult = z.infer<typeof searchResultSchema>;
export type SearchRequest = z.infer<typeof searchRequestSchema>;
export const searchPageSchema = z.object({
  items: z.array(searchResultSchema).max(40),
  nextCursor: z.string().nullable(),
});
export type SearchPage = z.infer<typeof searchPageSchema>;
export const searchKey = (
  user: string,
  workspace: string,
  query: string,
  type: SearchRequest['type'],
  limit = 10,
) =>
  [
    ...queryScope(user, workspace),
    'search',
    normalizeSearch(query),
    type,
    limit === 10 ? 'pages' : 'quick',
    limit,
  ] as const;
export function searchDestination(result: SearchResult) {
  if (result.type === 'user') return `/app/profile/${encodeURIComponent(result.userId)}`;
  const path = `/app/incidents/${result.incidentNumber}`;
  if (result.type === 'incident') return path;
  const params = new URLSearchParams(
    result.type === 'timeline_message'
      ? { event: result.entryId }
      : { thread: result.rootId, message: result.messageId },
  );
  return `${path}?${params}`;
}
export function searchScore(text: string, query: string) {
  const value = text.toLocaleLowerCase('en-US');
  const normalized = query.toLocaleLowerCase('en-US');
  if (value === normalized) return 1000;
  if (value.includes(normalized)) return 100;
  return normalized.split(' ').every((token) => value.includes(token)) ? 20 : 0;
}
export const compareSearch = (
  a: Pick<SearchResult, 'score' | 'time' | 'id'>,
  b: Pick<SearchResult, 'score' | 'time' | 'id'>,
) => b.score - a.score || b.time.localeCompare(a.time) || a.id.localeCompare(b.id);
export function searchSnippet(text: string, query: string) {
  const index = text
    .toLocaleLowerCase('en-US')
    .indexOf(query.toLocaleLowerCase('en-US').split(' ')[0]!);
  const start = Math.max(0, index - 60);
  return `${start ? '…' : ''}${text.slice(start, start + 236)}${text.length > start + 236 ? '…' : ''}`;
}
export function highlightSegments(text: string, query: string) {
  const tokens = normalizeSearch(query).toLocaleLowerCase('en-US').split(' ').filter(Boolean);
  const lower = text.toLocaleLowerCase('en-US');
  const ranges: { text: string; match: boolean }[] = [];
  let start = 0;
  while (start < text.length) {
    const hits = tokens
      .map((token) => ({ index: lower.indexOf(token, start), length: token.length }))
      .filter((hit) => hit.index >= 0)
      .sort((a, b) => a.index - b.index || b.length - a.length);
    const hit = hits[0];
    if (!hit) {
      ranges.push({ text: text.slice(start), match: false });
      break;
    }
    if (hit.index > start) ranges.push({ text: text.slice(start, hit.index), match: false });
    ranges.push({ text: text.slice(hit.index, hit.index + hit.length), match: true });
    start = hit.index + hit.length;
  }
  return ranges;
}
