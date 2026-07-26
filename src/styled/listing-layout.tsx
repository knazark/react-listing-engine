'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';

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
	useListingResults,
} from '~/react';

import { BottomNav, type IBottomNavAction, type BottomNavView } from './bottom-nav';
import { BottomSheet } from './bottom-sheet';
import { MobileHeader } from './mobile-header';

export interface IStyledListingLayoutProps {
	/**
	 * Optional header search box, LIBRARY-wired: name the `TFilters` field it
	 * drives via
	 * `filterKey`, and the layout reads the current value from the engine's
	 * filters and writes edits back with `applyFilters({ [filterKey]: value ||
	 * undefined })`. Rendered in BOTH the desktop filter bar and the mobile
	 * header. Do NOT also register `filterKey` as a `ListingFilters` control --
	 * it would then render twice. Omitted entirely when not passed.
	 */
	search?: { filterKey: string; placeholder?: string };
	/** Extra content rendered in `.rle-list-header` (above the list), to the right of `ListingResultHeader` (e.g. a sort control + save-search). */
	toolbarEnd?: ReactNode;
	/** Optional bottom-nav action button (e.g. "Add"), forwarded verbatim to `<BottomNav action={...} />`. Omit to render just Filters + the List|Map toggle. */
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
 * Tracks whether a horizontally-scrollable element is at its left/right edges,
 * so the filter bar can render a fade only on a side that still has content
 * off-screen (`!atStart` / `!atEnd`). jsdom-safe: `ResizeObserver` is
 * feature-detected so unit tests without it don't throw.
 */
function useScrollEdges<T extends HTMLElement = HTMLDivElement>() {
	const ref = useRef<null | T>(null);
	const [atStart, setAtStart] = useState(true);
	const [atEnd, setAtEnd] = useState(true);

	useEffect(() => {
		const el = ref.current;
		if (!el) return;
		const update = (): void => {
			const { clientWidth, scrollLeft, scrollWidth } = el;
			setAtStart(scrollLeft <= 0);
			setAtEnd(scrollLeft + clientWidth >= scrollWidth - 1);
		};
		update();
		el.addEventListener('scroll', update, { passive: true });
		// ResizeObserver catches viewport/element resizes but NOT content growing
		// past a fixed-width scroller (e.g. filter badges being added) -- that
		// changes scrollWidth without changing the scroller's own box, so it never
		// fires. A MutationObserver on the subtree covers those content changes.
		let ro: ResizeObserver | undefined;
		let mo: MutationObserver | undefined;
		if (typeof ResizeObserver !== 'undefined') {
			ro = new ResizeObserver(update);
			ro.observe(el);
		}
		if (typeof MutationObserver !== 'undefined') {
			mo = new MutationObserver(update);
			mo.observe(el, { characterData: true, childList: true, subtree: true });
		}
		return () => {
			el.removeEventListener('scroll', update);
			ro?.disconnect();
			mo?.disconnect();
		};
	}, []);

	return { atEnd, atStart, ref };
}

/**
 * Full, responsive, Tailwind-free listing experience -- built from the
 * structure-only compound components (`~/react`) plus the injected
 * `Styled*` slot components, with a rich mobile experience: a bottom
 * nav (`BottomNav`) and a bottom sheet (`BottomSheet`) for filters. Every
 * class used here is one of
 * the `.rle-*` layout classes added to `styles.css` alongside this file --
 * no Tailwind, no inline styles, no other stylesheet required.
 *
 * STRUCTURE (`.rle-app`):
 * - `.rle-filter-bar` (desktop only, hidden below 1024px by CSS): the
 *   optional `Search` slot and `<ListingFilters>` laid out as a single
 *   horizontally-scrolling row (`className="rle-filters-row"`,
 *   `groupClassName="rle-filter-group"`) with edge fades. The result header +
 *   `toolbarEnd` are NOT here -- they sit in `.rle-list-header` above the list.
 * - `.rle-list-header` (top of `.rle-list`): `<ListingResultHeader>` (title +
 *   count) at the left, `toolbarEnd` (sort control, save-search, ...) at the
 *   right -- a heading for the results, on every viewport.
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
 *   default -- pass `autoFetch={false}`
 *   to opt out and drive the first fetch yourself.
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
	const results = useListingResults();
	const { filters } = useListingFilters();

	const [mobileView, setMobileView] = useState<BottomNavView>('list');
	const [sheetOpen, setSheetOpen] = useState(false);
	const { atEnd, atStart, ref: barScrollRef } = useScrollEdges<HTMLDivElement>();

	// Library-wired search: read the current value straight off the engine's
	// filters and write edits back through `applyFilters`, so the SAME box in
	// the desktop bar and the mobile header both drive `search.filterKey`
	// without the consumer plumbing value/onChange (see `search` prop doc).
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
		// (only changes on remount), so this fires once per mounted engine when
		// autoFetch is on.
	}, [engine, autoFetch]);

	const handleClearAll = (): void => {
		// Reset each filter via its OWN toParams(fromParams(empty)) so the correct
		// TFilters STATE fields are cleared. `def.key` is the filter's identifier,
		// NOT necessarily a state field -- a filter can map its control to
		// different keys (e.g. `rent` -> `minRent`/`maxRent`, `bedrooms` ->
		// `minBedrooms`) via to/fromParams, so clearing `def.key` would no-op.
		const patch = engine.filters
			.list()
			.reduce<Record<string, unknown>>((acc, def) => Object.assign(acc, def.toParams(def.fromParams({}))), {});
		void engine.applyFilters(patch);
	};

	// Count of filters currently applied -- shown as a badge on the mobile
	// Filters button so a collapsed filter set still signals it's active.
	const activeFilterCount = engine.filters.list().filter(def => def.isActive?.(filters)).length;

	const resultCount = results.total ?? results.items.length;

	return (
		<div className={className ? `rle-app ${className}` : 'rle-app'}>
			<div className="rle-filter-bar">
				<div className="rle-filter-bar__scroll" ref={barScrollRef}>
					{searchBox && (
						<div className="rle-filter-bar__search">
							<Search value={searchBox.value} onChange={searchBox.onChange} placeholder={searchBox.placeholder} />
						</div>
					)}

					<ListingFilters className="rle-filters-row" groupClassName="rle-filter-group" hideLabels />
				</div>

				{/* Fade only on a side with more content off-screen (see `useScrollEdges`). */}
				{!atStart && <div className="rle-filter-bar__fade rle-filter-bar__fade--start" aria-hidden="true" />}
				{!atEnd && <div className="rle-filter-bar__fade rle-filter-bar__fade--end" aria-hidden="true" />}
			</div>

			<MobileHeader
				search={searchBox}
				onFiltersClick={() => setSheetOpen(true)}
				filterCount={activeFilterCount}
				action={mobileAction}
			/>

			<div
				className={`rle-body ${hasMap ? 'rle-split' : 'rle-body--list-only'}`}
				data-mobile-view={mobileView}
			>
				<div className="rle-list">
					<div className="rle-list-header">
						<ListingResultHeader />
						{toolbarEnd && <div className="rle-list-header__toolbar">{toolbarEnd}</div>}
					</div>
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
