'use client';

import { useListingState } from './use-listing-state';

/** Convenience slice of `useListingState()` — just the paginated results. */
export function useListingResults<TEntity = unknown, TFilters = unknown>() {
  return useListingState<TEntity, TFilters>().results;
}
