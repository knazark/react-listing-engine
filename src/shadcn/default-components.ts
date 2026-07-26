import type { IListingComponents } from '~/react';

import { DefaultCard } from './default-card';
import { DefaultEmpty } from './default-empty';
import { DefaultFilterPanel } from './default-filter-panel';
import { DefaultLoading } from './default-loading';
import { DefaultMarker } from './default-marker';
import { DefaultPopup } from './default-popup';
import { DefaultResultHeader } from './default-result-header';
import { DefaultSearch } from './default-search';
import { DefaultSidebar } from './default-sidebar';
import { DefaultToolbar } from './default-toolbar';

/**
 * Every `/shadcn` styled default, keyed by slot -- the single source of truth
 * both `ListingComponentsProviderWithDefaults` (spreads it verbatim) and
 * `ListingApp` (spreads a `components` override OVER it) build on.
 *
 * Kept as a plain object, not JSX, so a caller can merge it with
 * `{ ...shadcnDefaultComponents, ...overrides }` and hand the result to ONE
 * `ListingComponentsProvider`. This matters because `ListingComponentsProvider`
 * merges `provided ?? ITS OWN private, UNSTYLED fallbacks` per slot -- it does
 * not read the parent context (see `src/react/components-provider.tsx`).
 * Nesting a `ListingComponentsProvider` (with only the overrides) INSIDE a
 * `ListingComponentsProviderWithDefaults` would therefore silently reset
 * every un-overridden slot back to the bare fallback instead of the shadcn
 * default -- exactly the bug this object exists to avoid.
 */
export const shadcnDefaultComponents: IListingComponents = {
  Card: DefaultCard,
  Marker: DefaultMarker,
  Popup: DefaultPopup,
  Sidebar: DefaultSidebar,
  FilterPanel: DefaultFilterPanel,
  Search: DefaultSearch,
  Empty: DefaultEmpty,
  Loading: DefaultLoading,
  ResultHeader: DefaultResultHeader,
  Toolbar: DefaultToolbar,
};
