'use client';

import { useListingActions } from './use-listing-actions';
import { useListingState } from './use-listing-state';

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
  const state = useListingState();

  return {
    bounds: state.bounds,
    hovered: state.hovered,
    points: state.points,
    ...useListingActions(),
  };
}
