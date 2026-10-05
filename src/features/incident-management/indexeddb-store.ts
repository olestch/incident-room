import {
  incidentAuthoritySchema,
  seedIncidents,
  type IncidentAuthorityData,
  type IncidentStore,
} from './authority';

/** Fictional server-side persistence, NOT Query persistence or an optimistic outbox. */
export class IndexedDbIncidentStore implements IncidentStore {
  private database: Promise<IDBDatabase> | null = null;
  private open() {
    if (!this.database)
      this.database = new Promise((resolve, reject) => {
        const request = indexedDB.open('incident-room-fictional-incidents-v1', 1);
        request.onupgradeneeded = () => request.result.createObjectStore('incidents');
        request.onsuccess = () => {
          const db = request.result;
          db.onversionchange = () => {
            db.close();
            this.database = null;
          };
          resolve(db);
        };
        request.onerror = request.onblocked = () => {
          this.database = null;
          reject(new Error('Incident authority unavailable'));
        };
      });
    return this.database;
  }
  async transact<T>(operation: (data: IncidentAuthorityData) => T): Promise<T> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction('incidents', 'readwrite');
      const store = transaction.objectStore('incidents');
      const request = store.get('singleton');
      let result: T;
      let failure: unknown;
      request.onsuccess = () => {
        try {
          const data =
            request.result === undefined
              ? seedIncidents()
              : incidentAuthoritySchema.parse(request.result);
          result = operation(data);
          store.put(data, 'singleton');
        } catch (error) {
          failure = error;
          transaction.abort();
        }
      };
      transaction.oncomplete = () => resolve(result);
      transaction.onabort = transaction.onerror = () =>
        reject(failure ?? new Error('Incident authority unavailable'));
    });
  }
}
