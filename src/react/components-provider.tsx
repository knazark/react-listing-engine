'use client';

import { type ComponentType, createContext, type ReactNode, useContext } from 'react';

import type { MapPoint } from '~/interfaces';

// -----------------------------------------------------------------------------
// Slot prop interfaces. The engine is entity-erased at this layer (`unknown`
// item/entity), same reasoning as `ListingEngineContext` — see its docstring.
// Concrete-typed consumer components are cast at the injection site, e.g.
// `Card={PropertyCard as ComponentType<IListingCardProps>}`, mirroring
// `react-wizard-engine`'s `Button={Button as ComponentType<IWizardButtonProps>}`.
// -----------------------------------------------------------------------------

export interface IListingCardProps {
  item: unknown;
  selected?: boolean;
  onSelect?: () => void;
}

export interface IListingMarkerProps {
  point: MapPoint<unknown>;
}

export interface IListingPopupProps {
  entity: unknown;
  onClose?: () => void;
}

export interface IListingSidebarProps {
  children?: ReactNode;
}

export interface IListingFilterPanelProps {
  children?: ReactNode;
}

export interface IListingSearchProps {
  value: string;
  onChange(value: string): void;
  placeholder?: string;
}

// Intentionally empty — marker interfaces so `Empty`/`Loading` slot signatures
// can gain props later without changing every fallback/consumer's call site.
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface IListingEmptyProps {}

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface IListingLoadingProps {}

export interface IListingResultHeaderProps {
  count: number;
  total?: number;
}

export interface IListingToolbarProps {
  children?: ReactNode;
}

/** Props for the mobile List|Map view switcher slot (`BottomNav`). */
export interface IListingBottomNavProps {
  view: 'list' | 'map';
  onViewChange(view: 'list' | 'map'): void;
}

export interface IListingComponents {
  BottomNav: ComponentType<IListingBottomNavProps>;
  Card: ComponentType<IListingCardProps>;
  Marker: ComponentType<IListingMarkerProps>;
  Popup: ComponentType<IListingPopupProps>;
  Sidebar: ComponentType<IListingSidebarProps>;
  FilterPanel: ComponentType<IListingFilterPanelProps>;
  Search: ComponentType<IListingSearchProps>;
  Empty: ComponentType<IListingEmptyProps>;
  Loading: ComponentType<IListingLoadingProps>;
  ResultHeader: ComponentType<IListingResultHeaderProps>;
  Toolbar: ComponentType<IListingToolbarProps>;
}

// -----------------------------------------------------------------------------
// Minimal, UNSTYLED fallbacks for every slot. The `/styled` adapter ships
// prettier drop-in replacements — these exist so the engine is usable
// (and accessible) with zero consumer setup.
// -----------------------------------------------------------------------------

function getItemTitle(item: unknown): string {
  return String((item as { title?: string } | null | undefined)?.title ?? '');
}

const FallbackCard: ComponentType<IListingCardProps> = ({ item }) => <div>{getItemTitle(item)}</div>;

const FallbackMarker: ComponentType<IListingMarkerProps> = () => <div />;

// Exported (not just internal) so on-map consumers -- specifically `ListingMap`'s
// popup overlay -- can detect whether a REAL `Popup` slot was injected vs. this
// inert default by reference identity (`Popup !== FallbackPopup`). The overlay
// must stay fully inert (mount nothing on selection) when no `Popup` was
// provided, and `useListingComponents().Popup` always resolves to SOME component
// (this fallback when unset), so a reference check is the way to tell them apart.
export const FallbackPopup: ComponentType<IListingPopupProps> = () => <div />;

const FallbackSidebar: ComponentType<IListingSidebarProps> = ({ children }) => <div>{children}</div>;

const FallbackFilterPanel: ComponentType<IListingFilterPanelProps> = ({ children }) => <div>{children}</div>;

const FallbackSearch: ComponentType<IListingSearchProps> = ({ value, onChange, placeholder }) => (
  <input
    type="search"
    value={value}
    placeholder={placeholder}
    onChange={event => onChange(event.target.value)}
    aria-label={placeholder ?? 'Search'}
  />
);

const FallbackEmpty: ComponentType<IListingEmptyProps> = () => <div role="status">No results</div>;

const FallbackLoading: ComponentType<IListingLoadingProps> = () => (
  <div role="status" aria-busy="true">
    Loading…
  </div>
);

const FallbackResultHeader: ComponentType<IListingResultHeaderProps> = ({ count }) => <div>{count} results</div>;

const FallbackToolbar: ComponentType<IListingToolbarProps> = ({ children }) => <div>{children}</div>;

const FallbackBottomNav: ComponentType<IListingBottomNavProps> = ({ view, onViewChange }) => (
  <nav aria-label="Listing navigation">
    <button type="button" aria-pressed={view === 'list'} onClick={() => onViewChange('list')}>
      List
    </button>
    <button type="button" aria-pressed={view === 'map'} onClick={() => onViewChange('map')}>
      Map
    </button>
  </nav>
);

const defaults: IListingComponents = {
  BottomNav: FallbackBottomNav,
  Card: FallbackCard,
  Marker: FallbackMarker,
  Popup: FallbackPopup,
  Sidebar: FallbackSidebar,
  FilterPanel: FallbackFilterPanel,
  Search: FallbackSearch,
  Empty: FallbackEmpty,
  Loading: FallbackLoading,
  ResultHeader: FallbackResultHeader,
  Toolbar: FallbackToolbar,
};

const ListingComponentsContext = createContext<IListingComponents>(defaults);

/**
 * Injection point for custom-component overrides. Every slot is optional —
 * anything not provided falls back to the (unstyled) default. Mirrors
 * `react-wizard-engine`'s `WizardComponentsProvider`: explicit per-slot
 * `provided ?? defaults.X` merge, not a generic/reflective loop.
 */
export function ListingComponentsProvider(props: Partial<IListingComponents> & { children: ReactNode }) {
  const { BottomNav, Card, Marker, Popup, Sidebar, FilterPanel, Search, Empty, Loading, ResultHeader, Toolbar, children } =
    props;

  const value: IListingComponents = {
    BottomNav: BottomNav ?? defaults.BottomNav,
    Card: Card ?? defaults.Card,
    Marker: Marker ?? defaults.Marker,
    Popup: Popup ?? defaults.Popup,
    Sidebar: Sidebar ?? defaults.Sidebar,
    FilterPanel: FilterPanel ?? defaults.FilterPanel,
    Search: Search ?? defaults.Search,
    Empty: Empty ?? defaults.Empty,
    Loading: Loading ?? defaults.Loading,
    ResultHeader: ResultHeader ?? defaults.ResultHeader,
    Toolbar: Toolbar ?? defaults.Toolbar,
  };

  return <ListingComponentsContext.Provider value={value}>{children}</ListingComponentsContext.Provider>;
}

export function useListingComponents(): IListingComponents {
  return useContext(ListingComponentsContext);
}
