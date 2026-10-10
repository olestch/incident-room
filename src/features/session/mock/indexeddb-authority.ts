import {
  authoritySchema,
  seedAuthority,
  type AuthorityData,
  type AuthorityStore,
} from './authority';
import { IndexedDbAtomicStore } from '@/shared/persistence/atomic-store';

/** Fictional SERVER authority only; preserve its database/store/singleton contract. */
export class IndexedDbAuthorityStore implements AuthorityStore {
  private store: Promise<IndexedDbAtomicStore<AuthorityData>> | null = null;
  private ready() {
    if (!this.store)
      this.store = seedAuthority()
        .then(
          (seed) =>
            new IndexedDbAtomicStore(
              'incident-room-fictional-authority-v1',
              () => structuredClone(seed),
              (raw) => authoritySchema.parse(raw),
              'auth-authority',
            ),
        )
        .catch((error) => {
          this.store = null;
          throw error;
        });
    return this.store;
  }
  async transact<T>(operation: (data: AuthorityData) => T): Promise<T> {
    // Resolve the independently authored async seed BEFORE the native transaction opens.
    return (await this.ready()).transact('singleton', operation);
  }
}
