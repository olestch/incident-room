import {
  authoritySchema,
  seedAuthority,
  type AuthorityData,
  type AuthorityStore,
} from './authority';

/** Fictional SERVER authority only; not Query persistence, outbox, or credential storage. */
export class IndexedDbAuthorityStore implements AuthorityStore {
  private database: Promise<IDBDatabase> | null = null;
  private open() {
    if (!this.database)
      this.database = new Promise((resolve, reject) => {
        const request = indexedDB.open('incident-room-fictional-authority-v1', 1);
        request.onupgradeneeded = () => {
          request.result.createObjectStore('auth-authority');
        };
        request.onsuccess = () => {
          const db = request.result;
          db.onversionchange = () => {
            db.close();
            this.database = null;
          };
          resolve(db);
        };
        request.onerror = () => {
          this.database = null;
          reject(new Error('Mock authority unavailable'));
        };
        request.onblocked = () => {
          this.database = null;
          reject(new Error('Mock authority blocked'));
        };
      });
    return this.database;
  }
  async transact<T>(operation: (data: AuthorityData) => T): Promise<T> {
    const [db, seed] = await Promise.all([this.open(), seedAuthority()]);
    return new Promise((resolve, reject) => {
      // One atomic read/write transaction serializes independent tabs without client messaging.
      const transaction = db.transaction('auth-authority', 'readwrite');
      const store = transaction.objectStore('auth-authority');
      const request = store.get('singleton');
      let result: T;
      let failure: unknown;
      request.onsuccess = () => {
        try {
          const data = request.result === undefined ? seed : authoritySchema.parse(request.result);
          result = operation(data);
          store.put(data, 'singleton');
        } catch (error) {
          failure = error;
          transaction.abort();
        }
      };
      transaction.oncomplete = () => resolve(result);
      transaction.onabort = transaction.onerror = () =>
        reject(failure ?? new Error('Mock authority unavailable'));
    });
  }
}
