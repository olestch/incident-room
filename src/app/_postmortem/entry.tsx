'use client';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { Incident } from '@/entities/incident/model';
import type { CurrentUser } from '@/entities/current-user/model';
import { canInitiatePostmortem, canEditPostmortem } from '@/entities/incident/policy';
import {
  postmortemKeys,
  postmortemDetailSchema,
  mergePostmortemDetail,
  type PostmortemDetail,
} from '@/entities/postmortem/model';
import { useSessionRuntime } from '@/app/_providers/session-provider';
export function PostmortemEntry({ incident, actor }: { incident: Incident; actor: CurrentUser }) {
  const { coordinator, adapter } = useSessionRuntime();
  const cache = useQueryClient();
  const query = useQuery({
    queryKey: postmortemKeys.detail(actor.id, actor.workspaceId, incident.id),
    enabled: incident.status === 'resolved',
    queryFn: ({ signal }) =>
      coordinator
        .request(
          (s) =>
            adapter.resource(
              `/incidents/${incident.number}/postmortem`,
              postmortemDetailSchema.refine(
                (value) =>
                  !value.postmortem ||
                  (value.postmortem.incidentId === incident.id &&
                    value.postmortem.workspaceId === actor.workspaceId),
              ),
              s,
            ),
          'safe-read',
          signal,
        )
        .then((value) =>
          mergePostmortemDetail(
            cache.getQueryData<PostmortemDetail>(
              postmortemKeys.detail(actor.id, actor.workspaceId, incident.id),
            ),
            value,
          ),
        ),
  });
  if (incident.status !== 'resolved') return null;
  return (
    <Link
      className="incident-button inline-block mt-3"
      href={`/app/incidents/${incident.number}/postmortem`}
    >
      {query.data?.postmortem
        ? canEditPostmortem(actor, incident, true)
          ? 'Edit Postmortem'
          : 'View Postmortem'
        : query.data && canInitiatePostmortem(actor, incident)
          ? 'Create Postmortem'
          : 'Open Postmortem'}
    </Link>
  );
}
