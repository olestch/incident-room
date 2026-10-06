import { Suspense } from 'react';
import { SearchPage } from '@/app/_discovery/search-page';
export default function Page() {
  return (
    <Suspense fallback={<p>Loading Search…</p>}>
      <SearchPage />
    </Suspense>
  );
}
