import type { IListingComponents } from '~/react';

import {
	StyledCard,
	StyledEmpty,
	StyledFilterPanel,
	StyledLoading,
	StyledMarker,
	StyledPopup,
	StyledResultHeader,
	StyledSearch,
	StyledSidebar,
	StyledToolbar,
} from './components';

/**
 * Every `/styled` default, keyed by slot -- the single source of truth for
 * `StyledComponentsProviderWithDefaults`, mirroring `/shadcn`'s
 * `shadcnDefaultComponents`.
 *
 * Kept as a plain object, not JSX, so a caller can merge it with
 * `{ ...styledDefaultComponents, ...overrides }` and hand the result to ONE
 * `ListingComponentsProvider`. This matters because `ListingComponentsProvider`
 * merges `provided ?? ITS OWN private, UNSTYLED fallbacks` per slot -- it does
 * not read the parent context (see `~/react/components-provider.tsx`).
 * Nesting a bare `ListingComponentsProvider` (with only the overrides) INSIDE
 * a `StyledComponentsProviderWithDefaults` would therefore silently reset
 * every un-overridden slot back to the bare fallback instead of the styled
 * default -- exactly the bug this object exists to avoid.
 */
export const styledDefaultComponents: IListingComponents = {
	Card: StyledCard,
	Marker: StyledMarker,
	Popup: StyledPopup,
	Sidebar: StyledSidebar,
	FilterPanel: StyledFilterPanel,
	Search: StyledSearch,
	Empty: StyledEmpty,
	Loading: StyledLoading,
	ResultHeader: StyledResultHeader,
	Toolbar: StyledToolbar,
};
