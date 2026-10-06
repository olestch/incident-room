/* Fictional server's IN-MEMORY ephemeral broker. No IndexedDB, client storage,
 * BroadcastChannel, SharedWorker, event history, or production security claim. */
const leases = new Map();
globalThis.addEventListener('install', () => globalThis.skipWaiting());
globalThis.addEventListener('activate', (event) => event.waitUntil(globalThis.clients.claim()));
globalThis.addEventListener('message', (event) => {
  const port = event.ports[0];
  const input = event.data;
  if (
    !port ||
    !input ||
    !['join', 'pulse', 'leave'].includes(input.action) ||
    typeof input.clientId !== 'string' ||
    typeof input.room !== 'string' ||
    typeof input.userId !== 'string'
  )
    return;
  const now = Date.now();
  for (const [id, lease] of leases) if (lease.expiresAt <= now) leases.delete(id);
  const previous = leases.get(input.clientId);
  if (input.action === 'leave') leases.delete(input.clientId);
  else if (leases.size < 500 || previous)
    leases.set(input.clientId, {
      room: input.room,
      clientId: input.clientId,
      userId: input.userId,
      expiresAt: now + 4000,
      typingUntil: input.typing === true ? now + 3000 : 0,
      typingScope:
        input.typing === true && typeof input.typingScope === 'string' ? input.typingScope : null,
    });
  port.postMessage(
    [...leases.values()]
      .filter((lease) => lease.room === input.room)
      .map(({ clientId, userId, expiresAt, typingUntil, typingScope }) => ({
        clientId,
        userId,
        expiresAt,
        typingUntil,
        typingScope,
      })),
  );
});
