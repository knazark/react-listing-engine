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

export interface IListingComponents {
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

const FallbackPopup: ComponentType<IListingPopupProps> = () => <div />;

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

const defaults: IListingComponents = {
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
  const { Card, Marker, Popup, Sidebar, FilterPanel, Search, Empty, Loading, ResultHeader, Toolbar, children } =
    props;

  const value: IListingComponents = {
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
