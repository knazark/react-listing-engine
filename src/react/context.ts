'use client';

import { createContext } from 'react';

import type { ListingEngine } from '~/core';

/**
 * React context exposing the active `ListingEngine` instance to descendants.
 * `null` outside a `<ListingProvider>` (and during its pre-boot render tick).
 * Parameterized `<unknown, unknown>` because the context is entity/filters
 * -erased at this layer — a future `useListingEngine<TEntity, TFilters>()`
 * hook casts back to the caller-supplied types, same shape as
 * `react-wizard-engine`'s `WizardEngineContext`.
 */
export const ListingEngineContext = createContext<ListingEngine<unknown, unknown> | null>(null);
