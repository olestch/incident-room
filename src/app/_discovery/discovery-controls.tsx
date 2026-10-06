'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { notificationKeys, unreadSchema } from '@/entities/notification/model';
import {
  searchKey,
  searchPageSchema,
  searchDestination,
  normalizeSearch,
} from '@/entities/search/model';
import { UnreadBadge } from '@/features/notifications/views';
import { CommandPalette } from '@/features/command-palette/views';
import { commandRegistry, paletteShortcut, type Command } from '@/features/command-palette/model';
import { useSessionRuntime } from '@/app/_providers/session-provider';
import { useListRealtime } from '@/app/_incidents/use-list-realtime';
import { cacheUnread } from './notification-cache';
import { useCommands } from './commands-context';
import { createDiagnostics } from '@/shared/diagnostics/diagnostics';
export function DiscoveryControls({
  userId,
  workspaceId,
}: {
  userId: string;
  workspaceId: string;
}) {
  const { coordinator, adapter } = useSessionRuntime();
  const cache = useQueryClient();
  const pathname = usePathname();
  const params = useSearchParams();
  const router = useRouter();
  const appCommands = useCommands();
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const [debounced, setDebounced] = useState('');
  useEffect(
    () =>
      appCommands?.registerPalette(() => {
        setInput('');
        setOpen(true);
      }),
    [appCommands],
  );
  useListRealtime(!/^\/app\/incidents\/[^/]+/.test(pathname), userId, workspaceId);
  const unread = useQuery({
    queryKey: notificationKeys.unread(userId, workspaceId),
    queryFn: async ({ signal }) =>
      cacheUnread(
        cache,
        userId,
        workspaceId,
        await coordinator.request(
          (s) => adapter.resource('/notifications/unread', unreadSchema, s),
          'safe-read',
          signal,
        ),
      ),
  });
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(normalizeSearch(input)), 200);
    return () => clearTimeout(timer);
  }, [input]);
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      if (
        paletteShortcut(
          event,
          Boolean(
            target?.closest(
              'input,textarea,select,[contenteditable]:not([contenteditable="false"])',
            ),
          ),
          Boolean(document.querySelector('dialog[open],[role="dialog"][aria-modal="true"]')),
        )
      ) {
        event.preventDefault();
        setInput('');
        setOpen(true);
      }
    };
    document.addEventListener('keydown', listener);
    return () => document.removeEventListener('keydown', listener);
  }, []);
  const lookup = useQuery({
    queryKey: searchKey(userId, workspaceId, debounced, 'incident', 5),
    enabled: open && debounced.length >= 2 && debounced === normalizeSearch(input),
    staleTime: 15_000,
    queryFn: ({ signal }) =>
      coordinator.request(
        (s) =>
          adapter.resource(
            `/search?${new URLSearchParams({ q: debounced, type: 'incident', limit: '5' })}`,
            searchPageSchema,
            s,
          ),
        'safe-read',
        signal,
      ),
  });
  const remote: Command[] =
    debounced === normalizeSearch(input)
      ? (lookup.data?.items ?? []).map((item) => ({
          id: `incident:${item.id}`,
          label: 'incidentNumber' in item ? `${item.incidentNumber} · ${item.title}` : 'Incident',
          category: 'Incidents',
          destination: searchDestination(item),
        }))
      : [];
  if (normalizeSearch(input).length >= 2)
    remote.push({
      id: 'search-query',
      label: `Search all content for “${normalizeSearch(input)}”`,
      category: 'Search',
      destination: `/app/search?${new URLSearchParams({ q: normalizeSearch(input) })}`,
    });
  return (
    <div className="flex flex-wrap items-center gap-3">
      {appCommands?.readNotice && (
        <div role="alert">
          Read state was not saved. Navigation is still available; retry from the inbox.{' '}
          <button className="underline" onClick={appCommands.dismissReadNotice}>
            Dismiss read notice
          </button>
        </div>
      )}
      <Link
        href="/app/notifications"
        aria-label={`Activity Inbox${unread.data ? `, ${unread.data.count} unread notifications` : ''}`}
        className="underline"
      >
        Inbox <UnreadBadge count={unread.data?.count} />
      </Link>
      <button
        className="rounded-lg border border-line px-3 py-2"
        onClick={() => {
          setInput('');
          setOpen(true);
        }}
      >
        Commands
      </button>
      {open && (
        <CommandPalette
          commands={commandRegistry(pathname, new URLSearchParams(params.toString()), true, userId)}
          remote={remote}
          input={input}
          change={setInput}
          close={() => setOpen(false)}
          loading={lookup.isFetching}
          error={lookup.isError}
          execute={(command) => {
            createDiagnostics().record({ event: 'command_executed' });
            setOpen(false);
            if (command.action === 'create') appCommands?.create();
            else if (command.action === 'close-thread') appCommands?.closeThread();
            else if (command.destination) router.push(command.destination);
          }}
        />
      )}
    </div>
  );
}
