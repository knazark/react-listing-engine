'use client';

import { useListingActions } from './use-listing-actions';
import { useListingSelector } from './use-listing-selector';
import type { useListingState } from './use-listing-state';

/**
 * Map-facing slice of listing state (bounds, per-dataset points, hovered
 * marker id) plus the engine actions that drive them. `hovered` is bound to
 * the primary dataset (`engine.primaryDatasetId`) -- a transient
 * highlight-on-hover affordance, independent of `selectPoint`'s `selection`.
 *
 * Reading the state here means subscribing to it: this re-renders on every
 * store write. A component that wants only the callbacks should reach for
 * `useListingActions()` instead, which subscribes to nothing.
 */
export function useListingMap() {
  // One subscription per value handed out, so this re-renders for the map's
  // own state and not for filters, results or a selection.
  type State = ReturnType<typeof useListingState>;
  const bounds = useListingSelector<State['bounds']>(state => state.bounds);
  const hovered = useListingSelector<State['hovered']>(state => state.hovered);
  const points = useListingSelector<State['points']>(state => state.points);

  return {
    bounds,
    hovered,
    points,
    ...useListingActions(),
  };
}
