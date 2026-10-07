'use client';
import { Search, SearchX } from 'lucide-react';
import { EmptyState, RowSkeletons } from '@/shared/ui/secondary-feedback';
import { Button, InlineAlert } from '@/shared/ui/primitives';
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
    <section className="secondary-page discovery-page">
      <header className="secondary-page-header">
        <p className="secondary-eyebrow">Workspace discovery</p>
        <h1>Search</h1>
        <p>Find an Incident, a conversation or a person in your workspace.</p>
      </header>
      <div className="search-controls">
        <label className="search-query-label">
          Search accessible content
          <input
            aria-label="Search accessible content"
            value={input}
            maxLength={200}
            onChange={(event) => setInput(event.target.value)}
            className="search-query"
            type="search"
          />
        </label>
        <label className="search-type-label">
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
            className="secondary-control"
          >
            <option value="">All types</option>
            {searchTypes.map((value) => (
              <option key={value} value={value}>
                {
                  {
                    incident: 'Incidents',
                    timeline_message: 'Timeline',
                    thread_message: 'Threads',
                    user: 'People',
                  }[value]
                }
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="secondary-surface search-results-surface">
        {!committed && !pendingInput ? (
          <EmptyState icon={Search} title="Find the context you need">
            <p>Search incidents, messages and workspace users.</p>
          </EmptyState>
        ) : committed.length < 2 && !pendingInput ? (
          <EmptyState icon={Search} title="Keep typing">
            <p>Enter at least two characters.</p>
          </EmptyState>
        ) : committed.length > 200 && !pendingInput ? (
          <p role="alert">Search queries must be at most 200 characters.</p>
        ) : pendingInput || query.isLoading ? (
          <RowSkeletons label="Searching…" />
        ) : (
          <>
            {query.isError && (
              <InlineAlert>
                <p>Search unavailable. Your query is preserved.</p>
                <Button onClick={() => void query.refetch()} variant="quiet">
                  Retry Search
                </Button>
              </InlineAlert>
            )}
            {query.data && (
              <>
                <p role="status" className="search-results-count">
                  {items.length} results shown
                  {!items.length ? ` for “${committed}”. Try different words.` : '.'}
                </p>
                {!items.length && (
                  <EmptyState icon={SearchX} title="No matches">
                    <p>Try different words or another result type.</p>
                  </EmptyState>
                )}
                <SearchResults items={items} query={committed} />
                <Button
                  onClick={() => void query.refetch()}
                  variant="quiet"
                  className="search-refresh"
                >
                  Refresh Search
                </Button>
              </>
            )}
            {query.hasNextPage && (
              <Button
                className="secondary-more"
                disabled={query.isFetchingNextPage}
                onClick={() => void query.fetchNextPage({ cancelRefetch: false })}
              >
                {query.isFetchingNextPage ? 'Loading more…' : 'Load more results'}
              </Button>
            )}
          </>
        )}
      </div>
    </section>
  );
}
