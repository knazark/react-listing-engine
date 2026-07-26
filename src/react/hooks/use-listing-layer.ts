'use client';

import { useCallback } from 'react';

import { useListing } from './use-listing';
import { useListingState } from './use-listing-state';

/**
 * Per-dataset layer slice: visibility (default-visible, mirroring
 * `DatasetRegistry.visibleIds()`'s `!== false` rule), that layer's current
 * points, and a `toggle()` bound to the given `id`.
 */
export function useListingLayer(id: string) {
  const engine = useListing();
  const state = useListingState();

  const toggle = useCallback(() => engine.toggleLayer(id), [engine, id]);

  return {
    visible: state.layers[id] ?? true,
    points: state.points[id] ?? [],
    toggle,
  };
}
