'use client';

import { useContext } from 'react';

import type { ListingEngine } from '~/core';

import { ListingEngineContext } from '../context';

/**
 * Returns the active `ListingEngine` from `ListingEngineContext`. Throws
 * (rather than returning `null`) when rendered outside a `<ListingProvider>`
 * so every other hook in this folder can build on it without a null-check on
 * every call.
 *
 * The context itself is entity/filters-erased (`ListingEngine<unknown,
 * unknown>` — see `context.ts`'s docstring); the generics here are an
 * UNCHECKED cast back to the caller-supplied shape, not a runtime guarantee.
 */
export function useListing<TEntity = unknown, TFilters = unknown>(): ListingEngine<TEntity, TFilters> {
  const engine = useContext(ListingEngineContext);
  if (engine === null) {
    throw new Error('useListing must be used within a <ListingProvider>');
  }
  return engine as unknown as ListingEngine<TEntity, TFilters>;
}
