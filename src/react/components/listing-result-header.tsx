'use client';

import { useListingComponents } from '../components-provider';
import { useListingResults } from '../hooks/use-listing-results';

/** Structure-only result count header: `{ items, total }` from `useListingResults()` piped into the injected `ResultHeader`. */
export function ListingResultHeader() {
  const { items, total } = useListingResults();
  const { ResultHeader } = useListingComponents();

  return <ResultHeader count={items.length} total={total} />;
}
