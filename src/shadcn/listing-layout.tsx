'use client';

import { useEffect, useState, type ReactNode } from 'react';

import type { LatLng } from '~/interfaces';
import {
  ListingFilters,
  ListingList,
  ListingMap,
  ListingPagination,
  ListingResultHeader,
  useListing,
  useListingComponents,
} from '~/react';

import { cn } from './utils/cn';

export interface IListingLayoutProps {
  /**
   * Optional search box, wired by the CONSUMER into their own `TFilters`
   * shape. `ListingLayout` is filters-shape-erased (same reasoning as the
   * engine itself -- see `ListingEngineOptions`'s docstring) so it cannot
   * derive a generic "search" filter on its own; when omitted, no search box
   * is rendered at all. Documented, deliberate scope: wiring a named
   * "search" filter convention end-to-end is a future enhancement.
   */
  search?: { value: string; onChange: (value: string) => void; placeholder?: string };
  className?: string;
  /** Extra content rendered at the end of the filter bar, alongside `ListingResultHeader` (e.g. a sort control). */
  toolbarEnd?: ReactNode;
  /**
   * Whether `ListingLayout` fetches the first page itself on mount
   * (`engine.applyFilters({})`). Defaults to `true` (batteries-included).
   * Pass `false` to defer the initial fetch to the caller -- e.g. a
   * search-before-results flow, or when `urlSync` hydrates filters from the
   * URL and should drive the first fetch instead of racing it.
   */
  autoFetch?: boolean;
  /**
   * Forwarded verbatim to `<ListingMap center={mapCenter} />`. Omit to get
   * `ListingMap`'s turnkey auto-fit default (frames the map to its own data
   * once it loads) -- passing `mapCenter` opts OUT of auto-fit entirely, on
   * the theory that an explicit initial view is a deliberate choice
   * (see `ListingMap`'s doc comment's "Auto-fit" section).
   */
  mapCenter?: LatLng;
  /** Forwarded verbatim to `<ListingMap zoom={mapZoom} />`. See `mapCenter`. */
  mapZoom?: number;
}

/** Centered, muted fallback shown in the map region when no `MapProvider` is configured. */
const MAP_FALLBACK = (
  <p className="px-4 text-center text-sm text-muted-foreground">Map unavailable - provide a Google Maps API key</p>
);

/**
 * Full, responsive default listing experience, matching the "top filter bar
 * + list-left/map-right split" pattern of a typical `/find` real-estate
 * search page: a sticky horizontal filter bar (search + filter groups +
 * result count), then below it a split -- a scrollable card grid on the left
 * and a full-height map on the right. Composed entirely from the
 * structure-only compound components in `~/react` plus the injected slot
 * components (via `useListingComponents()` for `Search`, and implicitly
 * through each compound component for `Card`/`Empty`/`Loading`/etc.) -- this
 * file adds layout/chrome only, no new business logic.
 *
 * Layout choices (documented, not the only valid ones):
 * - FILTER BAR (`data-slot="listing-layout-filter-bar"`): `sticky top-0`,
 *   `border-b`/`bg-background`, and a `flex flex-wrap items-end gap-3` row
 *   containing the injected `Search` (when `search` is passed),
 *   `<ListingFilters>` (given the same horizontal row className plus a
 *   `min-w-0` `groupClassName` so individual groups can shrink instead of
 *   forcing overflow), and a trailing `ml-auto` cluster with
 *   `<ListingResultHeader>` + `toolbarEnd`. `flex-wrap` is what makes this
 *   gracefully reflow on narrow widths -- groups drop to new lines instead
 *   of overflowing or requiring a separate mobile-only layout.
 * - SPLIT (`data-slot="listing-layout-split"`): a single CSS grid,
 *   `md:grid-cols-[minmax(340px,42%)_1fr]` from `md` up (list column floors
 *   at 340px, caps at 42% of the split's width; map takes the rest). Below
 *   `md` there is no grid -- just two full-width panels, and exactly one is
 *   visible at a time (see the mobile toggle below).
 * - LIST region (`data-slot="listing-layout-list"`): `overflow-y-auto`, its
 *   own scroll container so browsing the list never requires scrolling the
 *   map out of view. Holds `<ListingList>` (an auto-fill card grid) and
 *   `<ListingPagination>`.
 * - MAP region (`data-slot="listing-layout-map"`): fills the split's full
 *   height via the grid's default stretch alignment (no explicit height
 *   needed), plus `md:sticky md:top-0` so that if a consuming app ever lets
 *   `ListingLayout` sit inside a naturally document-scrolling page (rather
 *   than the fixed-height shell this component defaults to via
 *   `h-full min-h-0`), the map still pins in place while the list scrolls
 *   past -- inert (but harmless) in the default fixed-height composition,
 *   where there is nothing above the split to scroll past in the first
 *   place. Renders `<ListingMap>` with a default centered fallback message
 *   (`MAP_FALLBACK`) for when no `MapProvider` is configured, so the pane
 *   never looks broken/blank.
 * - MOBILE LIST/MAP TOGGLE (`data-slot="listing-layout-mobile-toggle"`,
 *   `md:hidden`): a small two-button segmented control, local `useState`
 *   (`mobileView`), defaulting to `'list'`. Both the list and map regions
 *   stay mounted at all times (never remounted on toggle -- that would
 *   re-trigger `ListingList`'s/`ListingMap`'s own mount effects for no
 *   reason); only their visibility flips via `hidden md:block` /
 *   `block md:block`, i.e. the toggle only ever matters below `md` -- at
 *   `md` and up both regions are always visible side by side and the toggle
 *   control itself is hidden.
 * - Fetches the first page itself on mount (`engine.applyFilters({})`) by
 *   default: none of the structure-only `~/react` compound components do
 *   this (they are deliberately side-effect-free), so as the
 *   batteries-included "full experience" entry point, `ListingLayout` is the
 *   natural, single owner of that one bootstrapping side effect. Pass
 *   `autoFetch={false}` to opt out and drive the first fetch yourself (e.g.
 *   search-before-results, or when `urlSync` hydrates filters from the URL).
 */
export function ListingLayout({
  search,
  className,
  toolbarEnd,
  autoFetch = true,
  mapCenter,
  mapZoom,
}: IListingLayoutProps) {
  const engine = useListing();
  const { Search } = useListingComponents();
  const [mobileView, setMobileView] = useState<'list' | 'map'>('list');

  useEffect(() => {
    if (autoFetch === false) return;
    void engine.applyFilters({});
    // Fires once per mounted engine instance when autoFetch is enabled --
    // `engine` is otherwise the effect's only reactive input (see
    // `useListing`'s docstring: it's stable across re-renders of the same
    // `<ListingProvider>`, only changing on remount). `autoFetch` is treated
    // as fixed-at-mount configuration in practice, but is listed here so the
    // effect re-evaluates correctly if a caller does flip it after mount.
  }, [engine, autoFetch]);

  const listVisibleClassName = mobileView === 'map' ? 'hidden md:block' : 'block';
  const mapVisibleClassName = mobileView === 'list' ? 'hidden md:block' : 'block';

  return (
    <div
      className={cn('flex h-full min-h-0 w-full flex-col bg-background text-foreground', className)}
      data-slot="listing-layout"
    >
      <div
        className="sticky top-0 z-10 flex flex-wrap items-end gap-3 border-b border-border bg-background p-3"
        data-slot="listing-layout-filter-bar"
      >
        {search && (
          <div className="w-full min-w-0 sm:w-auto sm:max-w-xs sm:flex-1">
            <Search value={search.value} onChange={search.onChange} placeholder={search.placeholder} />
          </div>
        )}

        <ListingFilters className="flex flex-wrap items-end gap-3" groupClassName="min-w-0" />

        <div className="ml-auto flex items-center gap-3">
          <ListingResultHeader />
          {toolbarEnd}
        </div>
      </div>

      <div
        className="flex items-center justify-center gap-1 border-b border-border bg-background p-2 md:hidden"
        data-slot="listing-layout-mobile-toggle"
      >
        <div role="group" aria-label="View" className="inline-flex rounded-md border border-border p-0.5">
          {(
            [
              { view: 'list', label: 'List' },
              { view: 'map', label: 'Map' },
            ] as const
          ).map(({ view, label }) => (
            <button
              key={view}
              type="button"
              aria-pressed={mobileView === view}
              onClick={() => setMobileView(view)}
              className={cn(
                'rounded-[5px] px-3 py-1 text-sm font-medium motion-safe:transition-colors',
                mobileView === view
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground',
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid min-h-0 flex-1 md:grid-cols-[minmax(340px,42%)_1fr]" data-slot="listing-layout-split">
        <div className={cn('min-h-0 overflow-y-auto p-3', listVisibleClassName)} data-slot="listing-layout-list">
          <ListingList className="grid content-start gap-3 [grid-template-columns:repeat(auto-fill,minmax(200px,1fr))]" />
          <div className="mt-4 flex justify-center">
            <ListingPagination />
          </div>
        </div>
        <div className={cn('min-h-0 md:sticky md:top-0', mapVisibleClassName)} data-slot="listing-layout-map">
          <ListingMap center={mapCenter} zoom={mapZoom} fallback={MAP_FALLBACK} />
        </div>
      </div>
    </div>
  );
}
