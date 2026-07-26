'use client';

import { useCallback } from 'react';

import type { Bounds, EntityId } from '~/interfaces';

import { useListing } from './use-listing';
import { useListingState } from './use-listing-state';

/** Map-facing slice of listing state (bounds, per-dataset points) plus the two engine actions that drive them. */
export function useListingMap() {
  const engine = useListing();
  const state = useListingState();

  const loadPoints = useCallback((bounds: Bounds) => engine.loadPoints(bounds), [engine]);
  const selectPoint = useCallback((datasetId: string, id: EntityId) => engine.selectPoint(datasetId, id), [engine]);

  return { bounds: state.bounds, points: state.points, loadPoints, selectPoint };
}
