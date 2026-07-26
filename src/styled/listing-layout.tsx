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
	useListingFilters,
} from '~/react';

import { BottomNav, type IBottomNavAction, type BottomNavView } from './bottom-nav';

export interface IStyledListingLayoutProps {
	/**
	 * Optional search box, LIBRARY-wired (unlike `/shadcn`'s consumer-managed
	 * `search`): name the `TFilters` field it drives via `filterKey`, and the
	 * layout reads the current value from the engine's filters and writes edits
	 * back with `applyFilters({ [filterKey]: value || undefined })`. Rendered as
	 * the first control in the filter bar. Do NOT also register `filterKey` as a
	 * `ListingFilters` control -- it would then render twice. Omitted entirely
	 * when not passed.
	 */
	search?: { filterKey: string; placeholder?: string };
	/** Extra content rendered at the end of the filter bar, alongside `ListingResultHeader` (e.g. a sort control). */
	toolbarEnd?: ReactNode;
	/** Optional action button (e.g. "Save") rendered at the end of the filter bar. */
	mobileAction?: IBottomNavAction;
	/**
	 * Whether a map is configured. When `false`, the map region is dropped and
	 * the results list fills the full width as a multi-column grid, and the
	 * mobile List|Map toggle is omitted (nothing to toggle to). Defaults to
	 * `true` (the split list/map view). `ListingApp` passes `map != null`.
	 */
	hasMap?: boolean;
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
 * structure-only compound components (`~/react`) plus the injected `Styled*`
 * slot components. Every class used here is one of the `.rle-*` layout classes
 * in `styles.css` -- no Tailwind, no inline styles, no other stylesheet.
 *
 * STRUCTURE (`.rle-app`):
 * - `.rle-filter-bar` (sticky, ALL breakpoints): a `.rle-filter-bar__controls`
 *   cluster with the optional search box + `<ListingFilters hideLabels>` (a
 *   wrapping row on desktop; a single horizontally-scrolling row on mobile,
 *   dashboard-style, so filters stay inline instead of hiding behind a
 *   button), and a pinned `.rle-filter-bar__end` cluster with
 *   `<ListingResultHeader>`, the optional action, and `toolbarEnd`.
 * - `.rle-body`: `.rle-split` (list-majority grid + map) when a map is present,
 *   else `.rle-body--list-only` (full-width multi-column card grid). On mobile,
 *   with a map, exactly one of `.rle-list`/`.rle-map` shows at a time via
 *   `data-mobile-view` + the `<BottomNav>` List|Map toggle. Both regions stay
 *   mounted regardless of toggle/viewport -- only visibility flips.
 * - `<BottomNav>`: the mobile-only List|Map toggle, rendered only when a map
 *   exists (nothing to toggle to otherwise).
 * - Fetches the first page itself on mount (`engine.applyFilters({})`) by
 *   default -- pass `autoFetch={false}` to drive the first fetch yourself.
 */
export function StyledListingLayout({
	search,
	toolbarEnd,
	mobileAction,
	autoFetch = true,
	hasMap = true,
	mapCenter,
	mapZoom,
	className,
}: IStyledListingLayoutProps) {
	const engine = useListing();
	const { Search } = useListingComponents();
	const { filters } = useListingFilters();

	const [mobileView, setMobileView] = useState<BottomNavView>('list');

	// Library-wired search: read the current value straight off the engine's
	// filters and write edits back through `applyFilters`, so the box drives
	// `search.filterKey` without the consumer plumbing value/onChange.
	const searchBox = search
		? {
				value: String((filters as Record<string, unknown>)[search.filterKey] ?? ''),
				onChange: (value: string): void => {
					void engine.applyFilters({ [search.filterKey]: value || undefined } as Partial<unknown>);
				},
				placeholder: search.placeholder,
			}
		: undefined;

	useEffect(() => {
		if (autoFetch === false) return;
		void engine.applyFilters({});
		// `engine` is stable across re-renders of the same `<ListingProvider>`
		// (only changes on remount), so this fires once per mounted engine.
	}, [engine, autoFetch]);

	return (
		<div className={className ? `rle-app ${className}` : 'rle-app'}>
			<div className="rle-filter-bar">
				<div className="rle-filter-bar__controls">
					{searchBox && (
						<div className="rle-filter-bar__search">
							<Search value={searchBox.value} onChange={searchBox.onChange} placeholder={searchBox.placeholder} />
						</div>
					)}

					<ListingFilters className="rle-filters-row" groupClassName="rle-filter-group" hideLabels />
				</div>

				<div className="rle-filter-bar__end">
					<span className="rle-filter-bar__count">
						<ListingResultHeader />
					</span>
					{mobileAction && (
						<button type="button" className="rle-filter-bar__action" onClick={mobileAction.onClick}>
							{mobileAction.icon}
							<span>{mobileAction.label}</span>
						</button>
					)}
					{toolbarEnd}
				</div>
			</div>

			<div className={`rle-body ${hasMap ? 'rle-split' : 'rle-body--list-only'}`} data-mobile-view={mobileView}>
				<div className="rle-list">
					<ListingList className="rle-list-grid" />
					<ListingPagination />
				</div>
				{hasMap && (
					<div className="rle-map">
						<ListingMap center={mapCenter} zoom={mapZoom} fallback={MAP_FALLBACK} />
					</div>
				)}
			</div>

			{hasMap && <BottomNav view={mobileView} onViewChange={setMobileView} />}
		</div>
	);
}
