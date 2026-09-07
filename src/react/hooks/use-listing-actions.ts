'use client';

import { useCallback } from 'react';

import type { Bounds, EntityId, FitBoundsOptions } from '~/interfaces';

import { useListing } from './use-listing';

/**
 * The engine and map actions, with NO subscription to listing state.
 *
 * `useListingMap()` returns these alongside `bounds`, `points` and `hovered`,
 * and reading those means subscribing to the store -- so a component that only
 * ever DISPATCHES (a card that reports hover to the map, a button that zooms)
 * re-rendered on every unrelated write just by asking for the callback. In a
 * list of cards that is the whole page re-rendering on each hover.
 *
 * Every function here is stable for the life of the engine, so it is also safe
 * to depend on from an effect.
 */
export function useListingActions() {
  const engine = useListing();

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
  // Unlike the three actions above (whose provider methods are handle-free),
  // `MapProvider.fitBounds` takes the mounted `MapHandle` -- which lives on
  // the engine (registered by `ListingMap`'s mount effect via
  // `engine.setMapHandle`), so this delegates through `engine.fitBounds`
  // rather than `engine.map` directly. Same tolerance as the others: a safe
  // no-op when no `MapProvider` is configured OR no map is mounted yet. The
  // map SDK's resulting bounds-changed event then flows through the normal
  // pipeline (`loadPoints` -> `state.bounds`/`BoundsChanged`/point reload),
  // exactly like a user pan -- see `engine.fitBounds`'s doc comment and the
  // guard-interaction note in `ListingMap`'s mount effect.
  const fitBounds = useCallback(
    (bounds: Bounds, options?: FitBoundsOptions) => engine.fitBounds(bounds, options),
    [engine],
  );

  return { fitBounds, loadPoints, selectPoint, setHovered, toggleFullscreen, zoomIn, zoomOut };
}
