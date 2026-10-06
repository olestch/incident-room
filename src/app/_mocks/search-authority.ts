import { MockSearchAuthority } from '@/features/search/authority';
import type { MockIncidentAuthority } from '@/features/incident-management/authority';
import type { MockTimelineAuthority } from '@/features/timeline/authority';
import type { MockThreadAuthority } from '@/features/threads/authority';
import type { WorkspaceUser } from '@/entities/current-user/model';
import { searchScore, searchSnippet } from '@/entities/search/model';

export function composeSearchAuthority(
  incidents: MockIncidentAuthority,
  timeline: MockTimelineAuthority,
  threads: MockThreadAuthority,
  users: () => Promise<WorkspaceUser[]>,
) {
  return new MockSearchAuthority(
    [
      async (actor, request, emit) => {
        const profiles = (await users()).filter((user) => user.workspaceId === actor.workspaceId);
        const names = new Map(profiles.map((user) => [user.id, user.name]));
        const records = await incidents.inspectAccessible(actor, (records) => [...records]);
        for (const record of records) {
          if (!request.type || request.type === 'incident') {
            const score = Math.max(
              searchScore(record.number, request.query) * 3,
              searchScore(record.title, request.query) * 2,
              searchScore(record.description, request.query),
            );
            if (score)
              emit({
                type: 'incident',
                id: record.id,
                incidentNumber: record.number,
                title: record.title,
                snippet: searchSnippet(record.description, request.query),
                score,
                time: record.updatedAt,
                severity: record.severity,
                status: record.status,
                serviceIds: record.serviceIds,
              });
          }
          if (!request.type || request.type === 'timeline_message')
            await timeline.inspectSearchable(actor, record, (entries) => {
              for (const entry of entries) {
                if (entry.type !== 'human_message' || entry.tombstone) continue;
                const score = searchScore(entry.body, request.query);
                if (score)
                  emit({
                    type: 'timeline_message',
                    id: entry.id,
                    entryId: entry.id,
                    incidentNumber: record.number,
                    title: record.title,
                    authorId: entry.authorId,
                    authorName: names.get(entry.authorId) ?? 'Unavailable author',
                    snippet: searchSnippet(entry.body, request.query),
                    score,
                    time: entry.occurredAt,
                  });
              }
            });
          if (!request.type || request.type === 'thread_message')
            await threads.inspectSearchable(actor, record, (message) => {
              if (message.tombstone) return;
              const score = searchScore(message.body, request.query);
              if (score)
                emit({
                  type: 'thread_message',
                  id: message.id,
                  messageId: message.id,
                  rootId: message.rootTimelineEntryId,
                  incidentNumber: record.number,
                  title: record.title,
                  authorId: message.authorId,
                  authorName: names.get(message.authorId) ?? 'Unavailable author',
                  snippet: searchSnippet(message.body, request.query),
                  score,
                  time: message.occurredAt,
                });
            });
        }
        if (!request.type || request.type === 'user')
          for (const user of profiles) {
            if (user.workspaceId !== actor.workspaceId) continue;
            const score = searchScore(user.name, request.query);
            if (score)
              emit({
                type: 'user',
                id: user.id,
                userId: user.id,
                name: user.name,
                role: user.role,
                status: user.status,
                snippet: user.name,
                score,
                time: '2026-09-01T00:00:00.000Z',
              });
          }
      },
    ],
    async (actor) => {
      const first = await incidents.inspectAccessible(actor, (records) => records[0]);
      return first ? timeline.searchPolicy(actor, first) : { delayMs: 0, fail: false };
    },
    async (actor) => {
      const first = await incidents.inspectAccessible(actor, (records) => records[0]);
      if (first) await timeline.completeSearch(actor, first);
    },
  );
}
