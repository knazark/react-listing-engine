'use client';

import { useCallback } from 'react';

import type { Bounds, EntityId } from '~/interfaces';

import { useListing } from './use-listing';
import { useListingState } from './use-listing-state';

/**
 * Map-facing slice of listing state (bounds, per-dataset points, hovered
 * marker id) plus the engine actions that drive them. `hovered` is bound to
 * the primary dataset (`engine.primaryDatasetId`) -- a transient
 * highlight-on-hover affordance, independent of `selectPoint`'s `selection`.
 */
export function useListingMap() {
  const engine = useListing();
  const state = useListingState();

  const loadPoints = useCallback((bounds: Bounds) => engine.loadPoints(bounds), [engine]);
  // `id: EntityId | null` -- `null` clears the selection (the engine already
  // accepts it); lets consumers deselect through the hook, not just select.
  const selectPoint = useCallback(
    (datasetId: string, id: EntityId | null) => engine.selectPoint(datasetId, id),
    [engine],
  );
  const setHovered = useCallback((id: EntityId | null) => engine.setHovered(engine.primaryDatasetId, id), [engine]);

  return { bounds: state.bounds, points: state.points, hovered: state.hovered, loadPoints, selectPoint, setHovered };
}
