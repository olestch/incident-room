import {
  incidentAuthoritySchema,
  seedIncidents,
  type IncidentAuthorityData,
  type IncidentStore,
} from './authority';
import { IndexedDbAtomicStore } from '@/shared/persistence/atomic-store';

/** Keep the existing fictional authority database/store/key; share transaction mechanics. */
export class IndexedDbIncidentStore implements IncidentStore {
  private readonly store = new IndexedDbAtomicStore<IncidentAuthorityData>(
    'incident-room-fictional-incidents-v1',
    seedIncidents,
    (raw) => incidentAuthoritySchema.parse(raw),
    'incidents',
  );
  transact<T>(operation: (data: IncidentAuthorityData) => T): Promise<T> {
    return this.store.transact('singleton', operation);
  }
}
