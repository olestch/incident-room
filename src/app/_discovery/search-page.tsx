'use client';
import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useInfiniteQuery } from '@tanstack/react-query';
import {
  normalizeSearch,
  searchKey,
  searchPageSchema,
  searchTypes,
  searchTypeSchema,
  type SearchRequest,
} from '@/entities/search/model';
import { SearchResults } from '@/features/search/views';
import { useSessionRuntime } from '@/app/_providers/session-provider';

export function SearchPage() {
  const { state } = useSessionRuntime();
  if (!('identity' in state)) return null;
  return (
    <IdentitySearch
      key={`${state.generation}:${state.identity.userId}`}
      userId={state.identity.userId}
      workspaceId={state.identity.workspaceId}
    />
  );
}
function IdentitySearch({ userId, workspaceId }: { userId: string; workspaceId: string }) {
  const { coordinator, adapter } = useSessionRuntime();
  const params = useSearchParams();
  const router = useRouter();
  const committed = normalizeSearch(params.get('q') ?? '');
  const type: SearchRequest['type'] = searchTypeSchema.safeParse(params.get('type')).data ?? null;
  const [input, setInput] = useState(committed);
  const [seenURL, setSeenURL] = useState(committed);
  if (seenURL !== committed) {
    setSeenURL(committed);
    setInput(committed);
  }
  useEffect(() => {
    if (normalizeSearch(input) === committed) return;
    const timer = setTimeout(() => {
      const next = new URLSearchParams(params.toString());
      const query = normalizeSearch(input);
      if (query) next.set('q', query);
      else next.delete('q');
      router.replace(`/app/search?${next}`, { scroll: false });
    }, 200);
    return () => clearTimeout(timer);
  }, [input, committed, params, router]);
  const query = useInfiniteQuery({
    queryKey: searchKey(userId, workspaceId, committed, type),
    enabled:
      committed.length >= 2 && committed.length <= 200 && normalizeSearch(input) === committed,
    initialPageParam: null as string | null,
    staleTime: 15_000,
    queryFn: ({ signal, pageParam }) => {
      const request = new URLSearchParams({ q: committed, limit: '10' });
      if (type) request.set('type', type);
      if (pageParam) request.set('cursor', pageParam);
      return coordinator.request(
        (s) => adapter.resource(`/search?${request}`, searchPageSchema, s),
        'safe-read',
        signal,
      );
    },
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });
  const items = query.data?.pages.flatMap((page) => page.items) ?? [];
  const pendingInput = normalizeSearch(input) !== committed;
  return (
    <section>
      <h1 className="text-3xl font-semibold">Search</h1>
      <label className="mt-4 block">
        Search accessible content
        <input
          aria-label="Search accessible content"
          value={input}
          maxLength={200}
          onChange={(event) => setInput(event.target.value)}
          className="block w-full rounded-lg border border-line p-3"
          type="search"
        />
      </label>
      <label className="my-4 block">
        Result type
        <select
          aria-label="Result type"
          value={type ?? ''}
          onChange={(event) => {
            const next = new URLSearchParams(params.toString());
            if (event.target.value) next.set('type', event.target.value);
            else next.delete('type');
            router.push(`/app/search?${next}`);
          }}
          className="ml-3 rounded border border-line p-2"
        >
          <option value="">All types</option>
          {searchTypes.map((value) => (
            <option key={value} value={value}>
              {value.replaceAll('_', ' ')}
            </option>
          ))}
        </select>
      </label>
      {!committed && !pendingInput ? (
        <p>Search incidents, messages and workspace users.</p>
      ) : committed.length < 2 && !pendingInput ? (
        <p>Enter at least two characters.</p>
      ) : committed.length > 200 && !pendingInput ? (
        <p role="alert">Search queries must be at most 200 characters.</p>
      ) : pendingInput || query.isLoading ? (
        <p role="status">Searching…</p>
      ) : (
        <>
          {query.isError && (
            <div role="alert">
              <p>Search unavailable. Your query is preserved.</p>
              <button onClick={() => void query.refetch()} className="underline">
                Retry Search
              </button>
            </div>
          )}
          {query.data && (
            <>
              <p role="status">
                {items.length} results shown
                {!items.length ? ` for “${committed}”. Try different words.` : '.'}
              </p>
              <SearchResults items={items} query={committed} />
              <button onClick={() => void query.refetch()} className="my-3 underline">
                Refresh Search
              </button>
            </>
          )}
          {query.hasNextPage && (
            <button
              className="block rounded-lg border border-line p-3"
              disabled={query.isFetchingNextPage}
              onClick={() => void query.fetchNextPage({ cancelRefetch: false })}
            >
              {query.isFetchingNextPage ? 'Loading more…' : 'Load more results'}
            </button>
          )}
        </>
      )}
    </section>
  );
}
