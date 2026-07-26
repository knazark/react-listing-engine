'use client';

import { useCallback, useSyncExternalStore } from 'react';

import { useListing } from './use-listing';

/**
 * Subscribes to the engine's store via `useSyncExternalStore`.
 *
 * Snapshot stability: `engine.state` (→ `ListingStore.getState()`) returns
 * the exact SAME frozen object reference until the next mutation (see
 * `freezeState`/`setState` in `listing-store.ts`) — it is never rebuilt on
 * read. That is what makes this snapshot-stable: `useSyncExternalStore`
 * compares successive `getSnapshot()` results with `Object.is`, and an
 * implementation that wrapped `engine.state` in a fresh object here would
 * fail that check on every render and either warn ("The result of
 * getSnapshot should be cached") or tear/loop. Do NOT wrap the return value.
 *
 * `this` binding: `ListingEngine#subscribe` and the `state` getter are
 * ordinary prototype members, not arrow-bound class fields, so handing
 * `engine.subscribe` to `useSyncExternalStore` bare would detach it from
 * `engine` — React calls it as a plain function, not as `engine.subscribe(...)`,
 * so `this` would be `undefined` inside and it throws on the very first
 * subscribe. Wrapping both `subscribe` and `getSnapshot` in `useCallback`
 * closures re-binds `this` to `engine` via the closure AND keeps the function
 * references stable across re-renders (they only change if `engine` itself
 * changes, i.e. on provider remount) — avoiding needless resubscribes.
 */
export function useListingState<TEntity = unknown, TFilters = unknown>() {
  const engine = useListing<TEntity, TFilters>();

  const subscribe = useCallback((onStoreChange: () => void) => engine.subscribe(onStoreChange), [engine]);
  const getSnapshot = useCallback(() => engine.state, [engine]);

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
