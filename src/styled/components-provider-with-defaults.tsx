'use client';

import { type ReactNode } from 'react';

import { ListingComponentsProvider } from '~/react';

import { styledDefaultComponents } from './default-components';

/**
 * Convenience wrapper around `ListingComponentsProvider` that wires in every
 * package-shipped `Styled*` component (via `styledDefaultComponents`, the
 * shared source of truth). Use this for a fully styled, Tailwind-free UI out
 * of the box -- pair it with `import 'react-listing-engine/styles.css'`; use
 * `ListingComponentsProvider` directly (with your own components for some or
 * all slots) otherwise -- the two compose fine since `ListingComponentsProvider`
 * falls back per-slot. Mirrors `/shadcn`'s `ListingComponentsProviderWithDefaults`.
 */
export function StyledComponentsProviderWithDefaults({ children }: { children: ReactNode }) {
	return <ListingComponentsProvider {...styledDefaultComponents}>{children}</ListingComponentsProvider>;
}
