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
	useListingResults,
} from '~/react';

import { BottomNav, type IBottomNavAction, type BottomNavView } from './bottom-nav';
import { BottomSheet } from './bottom-sheet';

export interface IStyledListingLayoutProps {
	/** Optional search box -- same shape/reasoning as `/shadcn`'s `ListingLayout.search`; omitted entirely when not passed. */
	search?: { value: string; onChange: (value: string) => void; placeholder?: string };
	/** Extra content rendered at the end of the desktop filter bar, alongside `ListingResultHeader` (e.g. a sort control). */
	toolbarEnd?: ReactNode;
	/** Optional bottom-nav action button (e.g. "Add"), forwarded verbatim to `<BottomNav action={...} />`. Omit to render just Filters + the List|Map toggle. */
	mobileAction?: IBottomNavAction;
	/** Whether the layout fetches the first page itself on mount (`engine.applyFilters({})`). Defaults to `true`. */
	autoFetch?: boolean;
	/** Forwarded verbatim to `<ListingMap center={mapCenter} />` -- see that component's "Auto-fit" doc comment. */
	mapCenter?: LatLng;
	/** Forwarded verbatim to `<ListingMap zoom={mapZoom} />`. */
	mapZoom?: number;
	className?: string;
}

/** Centered, muted fallback shown in the map region when no `MapProvider` is configured. */
const MAP_FALLBACK = <div className="rle-empty">Map unavailable</div>;

/**
 * Full, responsive, Tailwind-free listing experience -- the `/styled`
 * counterpart to `/shadcn`'s `ListingLayout`, built from the same
 * structure-only compound components (`~/react`) plus the injected
 * `Styled*` slot components, but with a richer mobile experience: a bottom
 * nav (`BottomNav`) and a bottom sheet (`BottomSheet`) for filters, instead
 * of `/shadcn`'s inline mobile toggle bar. Every class used here is one of
 * the `.rle-*` layout classes added to `styles.css` alongside this file --
 * no Tailwind, no inline styles, no other stylesheet required.
 *
 * STRUCTURE (`.rle-app`):
 * - `.rle-filter-bar` (desktop only, hidden below 768px by CSS): the
 *   optional `Search` slot, `<ListingFilters>` laid out as a wrapping row
 *   (`className="rle-filters-row"`, `groupClassName="rle-filter-group"`),
 *   and a trailing `.rle-filter-bar__end` cluster with `<ListingResultHeader>`
 *   + `toolbarEnd`.
 * - `.rle-body.rle-split`: a CSS grid from 768px up (list column floors at
 *   340px, caps at 42%; map takes the rest); below that, a single full-area
 *   panel with exactly one of `.rle-list`/`.rle-map` visible at a time via
 *   `data-mobile-view` (see `styles.css`'s mobile media query). Both regions
 *   stay mounted at ALL times regardless of viewport/toggle state -- only
 *   their visibility flips -- so neither `ListingList` nor `ListingMap`
 *   remounts (and re-triggers its own mount effects) on toggle or resize.
 * - `<BottomNav>`: mobile-only (CSS-hidden at 768px+). Wired to the same
 *   `mobileView` state as the CSS toggle, `mobileAction`, and opens the
 *   filters `<BottomSheet>`.
 * - `<BottomSheet title="Filters">`: the SAME `<ListingFilters>` component,
 *   stacked vertically (`className="rle-filter-stack"`) for the sheet's
 *   narrower body, plus a footer with "Clear all" (resets every registered
 *   filter to `undefined` via `engine.filters.list()`'s keys, routed through
 *   `engine.applyFilters` -- the one bulk mutator, same as `ListingFilters`
 *   itself uses) and "Show N results" (just closes the sheet -- every filter
 *   control already applies live via its own `onChange`, so there is nothing
 *   left to commit).
 * - Fetches the first page itself on mount (`engine.applyFilters({})`) by
 *   default, exactly like `/shadcn`'s `ListingLayout` -- pass `autoFetch={false}`
 *   to opt out and drive the first fetch yourself.
 */
export function StyledListingLayout({
	search,
	toolbarEnd,
	mobileAction,
	autoFetch = true,
	mapCenter,
	mapZoom,
	className,
}: IStyledListingLayoutProps) {
	const engine = useListing();
	const { Search } = useListingComponents();
	const results = useListingResults();

	const [mobileView, setMobileView] = useState<BottomNavView>('list');
	const [sheetOpen, setSheetOpen] = useState(false);

	useEffect(() => {
		if (autoFetch === false) return;
		void engine.applyFilters({});
		// Same reasoning as `/shadcn`'s `ListingLayout`: `engine` is stable
		// across re-renders of the same `<ListingProvider>` (only changes on
		// remount), so this fires once per mounted engine when autoFetch is on.
	}, [engine, autoFetch]);

	const handleClearAll = (): void => {
		const patch = Object.fromEntries(engine.filters.list().map(def => [def.key, undefined]));
		void engine.applyFilters(patch);
	};

	const resultCount = results.total ?? results.items.length;

	return (
		<div className={className ? `rle-app ${className}` : 'rle-app'}>
			<div className="rle-filter-bar">
				{search && <Search value={search.value} onChange={search.onChange} placeholder={search.placeholder} />}

				<ListingFilters className="rle-filters-row" groupClassName="rle-filter-group" />

				<div className="rle-filter-bar__end">
					<ListingResultHeader />
					{toolbarEnd}
				</div>
			</div>

			<div className="rle-body rle-split" data-mobile-view={mobileView}>
				<div className="rle-list">
					<ListingList className="rle-list-grid" />
					<ListingPagination />
				</div>
				<div className="rle-map">
					<ListingMap center={mapCenter} zoom={mapZoom} fallback={MAP_FALLBACK} />
				</div>
			</div>

			<BottomNav
				view={mobileView}
				onViewChange={setMobileView}
				onFiltersClick={() => setSheetOpen(true)}
				action={mobileAction}
			/>

			<BottomSheet
				title="Filters"
				open={sheetOpen}
				onOpenChange={setSheetOpen}
				footer={
					<>
						<button type="button" className="rle-btn rle-btn--ghost" onClick={handleClearAll}>
							Clear all
						</button>
						<button type="button" className="rle-btn rle-btn--primary" onClick={() => setSheetOpen(false)}>
							Show {resultCount} results
						</button>
					</>
				}
			>
				<ListingFilters className="rle-filter-stack" groupClassName="rle-filter-group" />
			</BottomSheet>
		</div>
	);
}
