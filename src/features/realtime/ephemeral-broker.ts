import { z } from 'zod';
import { memberSchema } from './protocol';

let broker: Promise<ServiceWorker> | null = null;
function worker() {
  if (!broker)
    broker = (async () => {
      const registration = await navigator.serviceWorker.register('/fictional-realtime-worker.js', {
        scope: '/mock-realtime/',
      });
      if (registration.active) return registration.active;
      const pending = registration.installing ?? registration.waiting;
      if (!pending) throw new Error('Ephemeral broker unavailable');
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          pending.removeEventListener('statechange', changed);
          reject(new Error('Broker timeout'));
        }, 10_000);
        const changed = () => {
          if (pending.state === 'activated') {
            clearTimeout(timeout);
            pending.removeEventListener('statechange', changed);
            resolve();
          } else if (pending.state === 'redundant') {
            clearTimeout(timeout);
            pending.removeEventListener('statechange', changed);
            reject(new Error('Broker unavailable'));
          }
        };
        pending.addEventListener('statechange', changed);
        changed();
      });
      return pending;
    })().catch((error) => {
      broker = null;
      throw error;
    });
  return broker;
}
export async function ephemeralRequest(
  input: {
    action: 'join' | 'pulse' | 'leave';
    clientId: string;
    userId: string;
    room: string;
    typing: boolean;
    typingScope?: string | undefined;
  },
  signal: AbortSignal,
) {
  const target = await worker();
  signal.throwIfAborted();
  return new Promise<z.infer<typeof memberSchema>[]>((resolve, reject) => {
    const channel = new MessageChannel();
    const done = () => {
      clearTimeout(timeout);
      signal.removeEventListener('abort', abort);
      channel.port1.close();
    };
    const abort = () => {
      done();
      reject(new DOMException('Cancelled', 'AbortError'));
    };
    const timeout = setTimeout(() => {
      done();
      reject(new Error('Ephemeral broker timeout'));
    }, 3000);
    signal.addEventListener('abort', abort, { once: true });
    channel.port1.onmessage = (event) => {
      done();
      const parsed = z.array(memberSchema).max(500).safeParse(event.data);
      if (parsed.success) resolve(parsed.data);
      else reject(new Error('Invalid ephemeral state'));
    };
    target.postMessage(input, [channel.port2]);
  });
}
