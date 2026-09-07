'use client';

import { useCallback, useRef, useSyncExternalStore } from 'react';

import { useListing } from './use-listing';
import type { useListingState } from './use-listing-state';

/** The frozen state snapshot a selector reads, exactly as `useListingState()` hands it out. */
type ListingSnapshot<TEntity, TFilters> = ReturnType<typeof useListingState<TEntity, TFilters>>;

/**
 * Subscribes to ONE derived value instead of the whole store.
 *
 * `useListingState()` re-renders its component on every mutation, because the
 * snapshot it compares IS the state object and any write replaces it. That is
 * the right default for a component that reads several parts of the state, and
 * the wrong one for a long list: hovering a single card writes `hovered` and
 * re-renders every card that subscribed, along with everything else on the page
 * that touched the store.
 *
 * A selector narrows that to the value the component actually renders, so the
 * component only re-renders when THAT value changes:
 *
 * ```tsx
 * const isHovered = useListingSelector(state => state.hovered === item.id);
 * ```
 *
 * The selector must return a primitive or a stable reference. React compares
 * successive results with `Object.is`, so one that builds a fresh object or
 * array on every call (`state => ({ ...state.results })`) never compares equal
 * and re-renders forever. Reading a sub-object straight off the state is fine:
 * the store replaces those references only when their contents change. Derive
 * the comparison inside the selector rather than returning something to compare
 * outside it.
 *
 * A selector closure may change identity every render (an inline arrow usually
 * does) without re-subscribing: the latest one is reached through a ref, the
 * same latch `useListingEvent` uses for its handler.
 */
export function useListingSelector<TSelected, TEntity = unknown, TFilters = unknown>(
  selector: (state: ListingSnapshot<TEntity, TFilters>) => TSelected,
): TSelected {
  const engine = useListing<TEntity, TFilters>();

  const selectorRef = useRef(selector);
  selectorRef.current = selector;

  const subscribe = useCallback((onStoreChange: () => void) => engine.subscribe(onStoreChange), [engine]);
  const getSnapshot = useCallback(
    () => selectorRef.current(engine.state as ListingSnapshot<TEntity, TFilters>),
    [engine],
  );

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
