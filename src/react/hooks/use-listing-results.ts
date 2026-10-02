'use client';

import { useListingSelector } from './use-listing-selector';
import type { useListingState } from './use-listing-state';

/** Convenience slice of `useListingState()` — just the paginated results. */
export function useListingResults<TEntity = unknown, TFilters = unknown>() {
  // The results slice only -- see `useListingFilters`.
  type Results = ReturnType<typeof useListingState<TEntity, TFilters>>['results'];
  return useListingSelector<Results, TEntity, TFilters>(state => state.results);
}
