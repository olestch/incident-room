'use client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { threadKeys, threadSchema, mergeThread, type Thread } from '@/entities/thread/model';
import type { CurrentUser, WorkspaceUser } from '@/entities/current-user/model';
import type { Incident } from '@/entities/incident/model';
import { useSessionRuntime } from '@/app/_providers/session-provider';
import { MessageSquare } from 'lucide-react';
import { Button } from '@/shared/ui/primitives';
export function ThreadSummary({
  root,
  incident,
  actor,
  users,
  open,
}: {
  root: string;
  incident: Incident;
  actor: CurrentUser;
  users: WorkspaceUser[];
  open(root: string, trigger: HTMLElement): void;
}) {
  const { coordinator, adapter } = useSessionRuntime();
  const cache = useQueryClient();
  const key = threadKeys.summary(actor.id, actor.workspaceId, incident.id, root);
  const query = useQuery({
    queryKey: key,
    queryFn: async ({ signal }) => {
      const summaries = await coordinator.request(
        (s) =>
          adapter.resource(
            `/incidents/${incident.number}/threads/summaries?root=${encodeURIComponent(root)}`,
            z
              .array(threadSchema)
              .max(1)
              .refine((items) =>
                items.every(
                  (item) =>
                    item.workspaceId === actor.workspaceId &&
                    item.incidentId === incident.id &&
                    item.rootTimelineEntryId === root,
                ),
              ),
            s,
          ),
        'safe-read',
        signal,
      );
      const result = summaries[0] ?? null;
      return result
        ? mergeThread(cache.getQueryData<Thread | null>(key), result)
        : (cache.getQueryData<Thread | null>(key) ?? null);
    },
    staleTime: 30_000,
  });
  const summary = query.data;
  return (
    <div className="thread-summary">
      <Button
        variant="quiet"
        className="stream-discuss"
        onClick={(event) => open(root, event.currentTarget)}
        aria-label={`Open Thread for ${root}`}
        aria-description={
          summary
            ? `${summary.confirmedMessageCount} confirmed replies, ${summary.participantCount} participants. Last activity ${new Date(summary.lastActivityAt).toUTCString()}.`
            : 'Discuss this Timeline entry.'
        }
        title={
          summary
            ? `${summary.participantCount} participants · ${summary.participantIds
                .slice(0, 3)
                .map((id) => users.find((u) => u.id === id)?.name ?? 'Workspace member')
                .join(', ')} · Last activity ${new Date(summary.lastActivityAt).toUTCString()}`
            : 'Discuss this entry'
        }
      >
        <MessageSquare size={14} aria-hidden="true" />
        {summary ? `${summary.confirmedMessageCount} replies` : 'Discuss'}
      </Button>
      {query.isError && (
        <button className="incident-button" onClick={() => void query.refetch()}>
          Retry Thread summary
        </button>
      )}
    </div>
  );
}
