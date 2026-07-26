'use client';

import { type ReactNode } from 'react';

import { ListingComponentsProvider } from '~/react';

import { shadcnDefaultComponents } from './default-components';

/**
 * Convenience wrapper around `ListingComponentsProvider` that wires in every
 * package-shipped `Default*` component (via `shadcnDefaultComponents`, the
 * shared source of truth also used by `ListingApp`'s merge). Use this if you
 * want the styled adapter out of the box; use `ListingComponentsProvider`
 * directly (with your own components for some or all slots) otherwise -- the
 * two compose fine since `ListingComponentsProvider` falls back per-slot.
 * Mirrors `react-wizard-engine`'s `WizardComponentsProviderWithDefaults`.
 */
export function ListingComponentsProviderWithDefaults({ children }: { children: ReactNode }) {
  return <ListingComponentsProvider {...shadcnDefaultComponents}>{children}</ListingComponentsProvider>;
}
