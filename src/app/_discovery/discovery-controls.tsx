'use client';
import Link from 'next/link';
import { Bell, Command as CommandIcon, Search } from 'lucide-react';
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
import { Button } from '@/shared/ui/primitives';
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
  unreadCount,
}: {
  userId: string;
  workspaceId: string;
  unreadCount: number | undefined;
}) {
  const { coordinator, adapter } = useSessionRuntime();
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
  useListRealtime(!/^\/app\/incidents\/INC-\d+\/?$/.test(pathname), userId, workspaceId);
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
    <>
      <Link
        href="/app/search"
        aria-label="Search workspace"
        title="Search workspace"
        className="shell-action"
        onNavigate={(event) => {
          if (!(appCommands?.canLeave() ?? true)) event.preventDefault();
        }}
      >
        <Search size={18} aria-hidden="true" />
        <span className="shell-action-label">Search</span>
      </Link>
      <Link
        href="/app/notifications"
        aria-label={`Activity Inbox, ${unreadCount === undefined ? 'unread count unavailable' : `${unreadCount} unread notifications`}`}
        title="Notifications"
        className="shell-action"
        onNavigate={(event) => {
          if (!(appCommands?.canLeave() ?? true)) event.preventDefault();
        }}
      >
        <Bell size={18} aria-hidden="true" />
        {unreadCount !== undefined && unreadCount > 0 && (
          <span className="shell-unread" aria-hidden="true">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </Link>
      <Button
        variant="quiet"
        aria-label="Commands"
        title="Commands (Ctrl/Cmd+K)"
        className="shell-action"
        onClick={() => {
          setInput('');
          setOpen(true);
        }}
      >
        <CommandIcon size={18} aria-hidden="true" />
        <span className="shell-action-label">Commands</span>
        <kbd className="shell-command-key" aria-hidden="true">
          Ctrl/⌘ K
        </kbd>
      </Button>
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
            else if (command.destination && (appCommands?.canLeave() ?? true))
              router.push(command.destination);
          }}
        />
      )}
    </>
  );
}

/** One authoritative Query subscription shared by the two navigation affordances. */
export function useShellUnread(userId: string, workspaceId: string) {
  const { coordinator, adapter } = useSessionRuntime();
  const cache = useQueryClient();
  return useQuery({
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
}
