/** Native IndexedDB; synchronous operations keep all reads/writes inside one transaction. */
export interface AtomicStore<T> {
  transact<R>(key: string, operation: (data: T) => R): Promise<R>;
}
export class MemoryAtomicStore<T> implements AtomicStore<T> {
  readonly values = new Map<string, T>();
  constructor(private readonly seed: (key: string) => T) {}
  async transact<R>(key: string, operation: (data: T) => R) {
    const data = structuredClone(this.values.get(key) ?? this.seed(key));
    const result = operation(data);
    this.values.set(key, data);
    return result;
  }
}
export class IndexedDbAtomicStore<T> implements AtomicStore<T> {
  private database: Promise<IDBDatabase> | null = null;
  constructor(
    private readonly name: string,
    private readonly seed: (key: string) => T,
    private readonly validate: (value: unknown) => T,
  ) {}
  private open() {
    if (!this.database)
      this.database = new Promise((resolve, reject) => {
        const request = indexedDB.open(this.name, 1);
        request.onupgradeneeded = () => request.result.createObjectStore('records');
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
          reject(new Error('Browser storage unavailable'));
        };
      });
    return this.database;
  }
  async transact<R>(key: string, operation: (data: T) => R): Promise<R> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction('records', 'readwrite');
      const store = transaction.objectStore('records');
      const request = store.get(key);
      let result: R;
      let failure: unknown;
      request.onsuccess = () => {
        try {
          const data =
            request.result === undefined ? this.seed(key) : this.validate(request.result);
          result = operation(data);
          store.put(data, key);
        } catch (error) {
          failure = error;
          transaction.abort();
        }
      };
      transaction.oncomplete = () => resolve(result);
      transaction.onabort = transaction.onerror = () =>
        reject(failure ?? new Error('Browser storage transaction failed'));
    });
  }
}
