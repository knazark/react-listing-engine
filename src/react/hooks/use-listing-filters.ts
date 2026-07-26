'use client';

import { useCallback } from 'react';

import { useListing } from './use-listing';
import { useListingState } from './use-listing-state';

/**
 * Current filters plus two ways to mutate them, both proxying to
 * `engine.applyFilters`: `set` for a bulk `Partial<TFilters>` patch,
 * `setField` for a single key/value pair. Both are wrapped in `useCallback`
 * with `[engine]` as the only dependency, so their identity is stable across
 * re-renders (including ones triggered by filter/result changes) — a
 * consumer can safely pass `setField` into a memoized child or an effect
 * dependency array without it re-firing on every render.
 */
export function useListingFilters<TFilters = unknown>() {
  const engine = useListing<unknown, TFilters>();
  const state = useListingState<unknown, TFilters>();

  const set = useCallback((patch: Partial<TFilters>) => engine.applyFilters(patch), [engine]);

  const setField = useCallback(
    <K extends keyof TFilters>(key: K, value: TFilters[K]) =>
      // `{ [key]: value }` is built from a generic `K`, so TS only sees an
      // indexed `{ [x: string]: TFilters[K] }` — not obviously a `Partial<TFilters>`
      // for every possible TFilters shape. Sound at runtime: it is always a
      // single real `TFilters` key paired with a value of that key's own type.
      engine.applyFilters({ [key]: value } as unknown as Partial<TFilters>),
    [engine],
  );

  return { filters: state.filters, set, setField };
}
