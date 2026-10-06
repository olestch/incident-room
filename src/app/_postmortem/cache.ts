import type { QueryClient } from '@tanstack/react-query';
import {
  postmortemKeys,
  mergePostmortemDetail,
  type PostmortemDetail,
} from '@/entities/postmortem/model';
import type { PersistentEvent } from '@/features/realtime/protocol';
export async function applyPostmortemEvent(
  cache: QueryClient,
  user: string,
  workspace: string,
  event: PersistentEvent,
  signal?: AbortSignal,
) {
  if (event.resourceType === 'timeline') {
    void cache.invalidateQueries({
      queryKey: postmortemKeys.references(user, workspace, event.incidentId),
    });
    return false;
  }
  if (event.resourceType !== 'postmortem' && event.resourceType !== 'action_item') return false;
  const key = postmortemKeys.detail(user, workspace, event.incidentId);
  const query = cache.getQueryCache().find({ queryKey: key, exact: true });
  if (
    event.resourceType === 'action_item' &&
    query &&
    !cache.getQueryData<PostmortemDetail>(key)?.postmortem
  ) {
    // A child delta may race an initial/absent parent read whose older response is still pending.
    // Do not cache an orphan or advance recovery past an unacquired active resource.
    if (!query.getObserversCount()) {
      await cache.invalidateQueries({ queryKey: key, exact: true, refetchType: 'none' });
      return true;
    }
    await cache.cancelQueries({ queryKey: key, exact: true });
    await cache.refetchQueries(
      { queryKey: key, exact: true, type: 'active' },
      { throwOnError: true },
    );
    signal?.throwIfAborted();
    if (!cache.getQueryData<PostmortemDetail>(key)?.postmortem)
      throw new Error('Postmortem parent not acquired');
  }
  signal?.throwIfAborted();
  // Never allocate histories for inactive rooms. The next ordinary fetch is authoritative.
  if (cache.getQueryState(key))
    cache.setQueryData<PostmortemDetail>(key, (previous) =>
      previous
        ? mergePostmortemDetail(previous, {
            postmortem: event.resourceType === 'postmortem' ? event.payload : previous.postmortem,
            items: event.resourceType === 'action_item' ? [event.payload] : [],
          })
        : event.resourceType === 'postmortem'
          ? { postmortem: event.payload, items: [] }
          : previous,
    );
  return true;
}
