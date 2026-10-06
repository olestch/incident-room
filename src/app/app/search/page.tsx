import { Suspense } from 'react';
import { SearchPage } from '@/app/_discovery/search-page';
export const metadata = { title: 'Search · Incident Room' };
export default function Page() {
  return (
    <Suspense fallback={<p role="status">Loading Search…</p>}>
      <SearchPage />
    </Suspense>
  );
}
