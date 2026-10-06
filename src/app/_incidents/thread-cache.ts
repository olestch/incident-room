import type { QueryClient, InfiniteData } from '@tanstack/react-query';
import { mergeMessages, type ThreadMessage, type ThreadWindow } from '@/entities/thread/model';
/** Acquisition resources only. A summary/root context is not a message collection. */
export function hasAcquiredThreadMessage(
  cache: QueryClient,
  prefix: readonly unknown[],
  id: string,
) {
  return cache
    .getQueriesData<ThreadWindow | InfiniteData<ThreadWindow> | ThreadMessage[]>({
      queryKey: prefix,
    })
    .some(([, data]) => {
      if (!data) return false;
      if (Array.isArray(data)) return data.some((message) => message.id === id);
      if ('pages' in data)
        return data.pages.some((window) => window.items.some((message) => message.id === id));
      return 'items' in data && data.items.some((message) => message.id === id);
    });
}
/** Snapshot windows enter Query as one acquisition, not N observable per-message updates. */
export function mergeThreadSnapshotWindow(
  cache: QueryClient,
  prefix: readonly unknown[],
  messages: ThreadMessage[],
) {
  const fresh = new Set(
    messages
      .filter((message) => !hasAcquiredThreadMessage(cache, prefix, message.id))
      .map((message) => message.id),
  );
  cache.setQueryData<ThreadMessage[]>([...prefix, 'acknowledgments'], (previous = []) => [
    ...mergeMessages(new Map(previous.map((message) => [message.id, message])), messages).values(),
  ]);
  return fresh;
}
