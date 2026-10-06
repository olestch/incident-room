import { AppError } from '@/shared/errors/app-error';

const lockName = 'incident-room-demo-maintenance';
let releaseLease: (() => void) | null = null;
let leaseTask: Promise<void> | null = null;
/** Maintenance-only lease, not draft ownership/refresh/transport tab coordination. */
export async function acquireDemoLease() {
  if (leaseTask || !navigator.locks) return;
  let acquired!: () => void;
  const ready = new Promise<void>((resolve) => {
    acquired = resolve;
  });
  leaseTask = navigator.locks
    .request(lockName, { mode: 'shared' }, async () => {
      await new Promise<void>((resolve) => {
        releaseLease = resolve;
        acquired();
      });
    })
    .then(() => {});
  await ready;
}
const stores = [
  ['incident-room-fictional-authority-v1', 'auth-authority'],
  ['incident-room-fictional-incidents-v1', 'incidents'],
  ...['timeline', 'threads', 'journal', 'notifications', 'postmortems'].map((domain) => [
    `incident-room-fictional-${domain}-v1`,
    'records',
  ]),
  ['incident-room-local-work-v1', 'records'],
] as const;
export function clearDemoStores() {
  return Promise.all(
    stores.map(
      ([name, storeName]) =>
        new Promise<void>((resolve, reject) => {
          const request = indexedDB.open(name!, 1);
          request.onupgradeneeded = () => request.result.createObjectStore(storeName!);
          request.onerror = request.onblocked = () => reject(new Error('Demo storage unavailable'));
          request.onsuccess = () => {
            const db = request.result;
            const tx = db.transaction(storeName!, 'readwrite');
            tx.objectStore(storeName!).clear();
            tx.oncomplete = () => {
              db.close();
              resolve();
            };
            tx.onerror = tx.onabort = () => {
              db.close();
              reject(new Error('Demo reset incomplete'));
            };
          };
        }),
    ),
  );
}
export function clearReplacementStores(workspaceId: string, incidentId: string) {
  const targets = [
    ['incident-room-fictional-threads-v1', JSON.stringify([workspaceId, incidentId])],
    ['incident-room-fictional-journal-v1', workspaceId],
    ['incident-room-local-work-v1', null],
  ] as const;
  return Promise.all(
    targets.map(
      ([name, key]) =>
        new Promise<void>((resolve, reject) => {
          const request = indexedDB.open(name, 1);
          request.onupgradeneeded = () => request.result.createObjectStore('records');
          request.onerror = request.onblocked = () =>
            reject(new Error('Dataset replacement unavailable'));
          request.onsuccess = () => {
            const db = request.result;
            const tx = db.transaction('records', 'readwrite');
            if (key === null) tx.objectStore('records').clear();
            else tx.objectStore('records').delete(key);
            tx.oncomplete = () => {
              db.close();
              resolve();
            };
            tx.onabort = tx.onerror = () => {
              db.close();
              reject(new Error('Dataset replacement incomplete'));
            };
          };
        }),
    ),
  );
}
export async function exclusiveDemoMaintenance(operation: () => Promise<void>) {
  if (!navigator.locks)
    throw new AppError('unexpected', 'Reset needs a browser with Web Locks support.');
  releaseLease?.();
  await leaseTask;
  leaseTask = null;
  releaseLease = null;
  try {
    await navigator.locks.request(lockName, { ifAvailable: true }, async (lock) => {
      if (!lock)
        throw new AppError(
          'conflict',
          'Close other Incident Room tabs before reset or dataset replacement.',
        );
      await operation();
    });
  } finally {
    await acquireDemoLease();
  }
}
