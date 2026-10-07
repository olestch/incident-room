'use client';
import { useEffect, useMemo, useRef } from 'react';
import type { DeliveredMessage } from './model';
import type { MessageDelivery } from './delivery';

/** Effect owns each runtime; the stable port survives Strict Mode's setup/cleanup replay. */
export function useMessageDelivery<Message extends DeliveredMessage>(
  create: () => MessageDelivery<Message>,
) {
  const runtime = useRef<MessageDelivery<Message> | null>(null);
  useEffect(() => {
    const current = create();
    runtime.current = current;
    return () => {
      current.dispose();
      if (runtime.current === current) runtime.current = null;
    };
  }, [create]);
  return useMemo(() => {
    const current = () => {
      if (!runtime.current) throw new DOMException('Delivery runtime unavailable', 'AbortError');
      return runtime.current;
    };
    return {
      restore: () => current().restore(),
      prepare: (body: string, replyToMessageId?: string | null) =>
        current().prepare(body, replyToMessageId),
      exposeAndSend: (record: Parameters<MessageDelivery<Message>['exposeAndSend']>[0]) =>
        current().exposeAndSend(record),
      acknowledge: (entry: Message) => current().acknowledge(entry),
      retry: (id: string) => current().retry(id),
      check: (id: string) => current().check(id),
      remove: (id: string) => current().remove(id),
    };
  }, []);
}
