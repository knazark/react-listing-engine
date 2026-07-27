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

  // Map-chrome actions delegate straight to the currently-configured `MapProvider` --
  // `engine.map` is `undefined` whenever no map was configured (see `ListingApp`'s `map` prop),
  // so `?.` makes each of these a safe no-op in that case, mirroring how the actions above never
  // crash on a not-yet-ready engine.
  const zoomIn = useCallback(() => engine.map?.zoomIn(), [engine]);
  const zoomOut = useCallback(() => engine.map?.zoomOut(), [engine]);
  const toggleFullscreen = useCallback(() => engine.map?.toggleFullscreen(), [engine]);

  return {
    bounds: state.bounds,
    points: state.points,
    hovered: state.hovered,
    loadPoints,
    selectPoint,
    setHovered,
    zoomIn,
    zoomOut,
    toggleFullscreen,
  };
}
