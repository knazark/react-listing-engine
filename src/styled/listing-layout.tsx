'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';

import { PaginationMode } from '~/enums';
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
	useListingState,
} from '~/react';

import { type IBottomNavAction, type BottomNavView } from './bottom-nav';
import { BottomSheet } from './bottom-sheet';
import { MobileHeader } from './mobile-header';

/**
 * Handed to `IStyledListingLayoutProps.mobileSheetFooter` -- see that prop's
 * doc comment for why this render-prop override exists.
 */
export interface MobileSheetFooterContext<TFilters> {
	/** The sheet's current DRAFT filters -- buffered edits not yet applied to the engine (see the class doc's `BottomSheet` section). */
	draft: TFilters;
	/** Commits `draft` to the engine and closes the sheet once the resulting refetch settles -- identical to what the default "Show N results" button does (`handleApplyDraft`). */
	apply: () => void;
	/** Resets the DRAFT (not the applied filters) via `engine.filters.clearedParams()` -- identical to what the default "Clear all" button does (`handleClearAll`). */
	clear: () => void;
	/** The currently APPLIED result count -- NOT a live preview of `draft` (see `mobileSheetFooter`'s doc comment for why). */
	resultCount: number;
	/** `pagination.loading` -- true while a commit-triggered (or any other) refetch is in flight. */
	loading: boolean;
}

export interface IStyledListingLayoutProps<TFilters = unknown> {
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
	/** Extra content rendered in the desktop filter bar between the search box and the `<ListingFilters>` row (e.g. an "advanced filters" modal trigger). Scrolls with the bar. Desktop-only by construction -- the whole filter bar is CSS-hidden below the mobile breakpoint. */
	filterBarStart?: ReactNode;
	/** Extra content rendered in `.rle-list-header` (above the list), to the right of `ListingResultHeader` (e.g. a sort control + save-search). */
	toolbarEnd?: ReactNode;
	/**
	 * Replaces the ENTIRE results column -- header, grid and pagination -- with
	 * the given content, inside the same scrolling `.rle-list` container.
	 *
	 * For the states where a result list is the wrong thing to show at all, not
	 * merely a different-looking one: a viewport too wide for individual results
	 * to mean anything, an onboarding prompt, a saved-search upsell. `Empty` and
	 * `Loading` cannot express those, because both still sit inside the results
	 * column and leave its header, sort control and pager in place.
	 *
	 * Consumers previously had to hide `.rle-list-grid`,
	 * `.rle-list-header__toolbar` and `.rle-pagination` with their own CSS,
	 * which made three internal class names part of the public contract by
	 * accident.
	 *
	 * The map is unaffected -- give a dataset an empty `getPoints` at that scale
	 * if its pins should go too.
	 */
	resultsSlot?: ReactNode;
	/** Optional mobile-header action button (e.g. "Save"), forwarded verbatim to `<MobileHeader action={...} />`. Omit to render just the search + Filters button there. */
	mobileAction?: IBottomNavAction;
	/**
	 * Whether a map is configured. When `false`, the map region is dropped and
	 * the results list fills the full width as a multi-column grid, and the
	 * mobile List|Map toggle is omitted (nothing to toggle to). Defaults to
	 * `engine.map != null` -- the engine is the source of truth, so this only
	 * needs passing to override that (e.g. to hide a configured map).
	 */
	hasMap?: boolean;
	/** Whether the layout fetches the first page itself on mount (`engine.applyFilters({})`). Defaults to `true`. */
	autoFetch?: boolean;
	/**
	 * 0-based page to load on mount instead of page 1 -- for restoring a
	 * deep-linked page (`?page=N`) in one fetch (`engine.goToPage(initialPage)`)
	 * rather than page-1-then-jump. Only honored when `autoFetch` is on; `0`/unset
	 * loads page 1 as before. Needs an offset-capable adapter (`PageRequest.offset`).
	 */
	initialPage?: number;
	/** Forwarded verbatim to `<ListingMap center={mapCenter} />` -- see that component's "Auto-fit" doc comment. */
	mapCenter?: LatLng;
	/** Forwarded verbatim to `<ListingMap zoom={mapZoom} />`. */
	mapZoom?: number;
	/** Forwarded verbatim to `<ListingMap mapControls={mapControls} />` -- see that prop's doc comment. */
	mapControls?: ReactNode;
	/**
	 * A map WAS asked for but its provider has not resolved yet.
	 *
	 * Only `ListingApp` knows this: it resolves an API key into a provider
	 * through a dynamic import. Without it the map pane cannot tell "this app
	 * has no map" from "the map is still loading", and says the former.
	 */
	mapPending?: boolean;
	/** Forwarded verbatim to `<ListingMap onMapReady={onMapReady} />` -- the native-map escape hatch; see that prop's doc comment. */
	onMapReady?: (map: unknown) => void;
	/**
	 * Render-prop override for the mobile filters sheet's footer -- when
	 * given, replaces the default "Clear all" + "Show N results" buttons
	 * entirely, called with the sheet's current draft plus its
	 * commit/clear/count/loading state (see `MobileSheetFooterContext`'s own
	 * field docs). Exists because the default footer's result count is always
	 * the currently APPLIED count (see the class doc's `BottomSheet` section)
	 * -- it never previews what applying `draft` WOULD return, since that
	 * requires a query only the consumer's own data source can run (e.g. a
	 * live-count endpoint keyed off the draft). A consumer with such a source
	 * renders its own footer here, driving `apply`/`clear` exactly like the
	 * default buttons do. Omitted (the default), the built-in footer renders
	 * unchanged.
	 */
	mobileSheetFooter?: (ctx: MobileSheetFooterContext<TFilters>) => ReactNode;
	className?: string;
}

/** Centered, muted fallback shown in the map region when no `MapProvider` is configured. */
const MAP_FALLBACK = <div className="rle-empty">Map unavailable</div>;

/** Shown in the map's place while a REQUESTED provider is still resolving --
 *  distinct from `MAP_FALLBACK`, which states the map is unavailable. Since
 *  the app renders before the provider's dynamic import lands (so it can
 *  server-render), "unavailable" would be shown for a second on every load of
 *  a perfectly working map. */
const MAP_PENDING = <div className="rle-map-pending" />;

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
		// MutationObserver callbacks run at microtask timing -- BEFORE the
		// browser's scheduled layout -- so reading scroll metrics there would
		// force a synchronous reflow on every React commit inside the bar.
		// Coalescing through rAF defers the read to frame timing (after layout),
		// at most once per frame. Scroll events and ResizeObserver already
		// deliver with clean layout, so those call `update` directly.
		let frame = 0;
		const scheduleUpdate = (): void => {
			if (frame) return;
			frame = requestAnimationFrame(() => {
				frame = 0;
				update();
			});
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
			mo = new MutationObserver(scheduleUpdate);
			mo.observe(el, { characterData: true, childList: true, subtree: true });
		}
		return () => {
			el.removeEventListener('scroll', update);
			ro?.disconnect();
			mo?.disconnect();
			if (frame) cancelAnimationFrame(frame);
		};
	}, []);

	return { atEnd, atStart, ref };
}

/**
 * Shallow key/value comparison used by the mobile sheet's "Show N results"
 * commit to decide whether applying the draft would actually change
 * anything -- if not, it closes immediately instead of round-tripping a
 * no-op refetch through `engine.applyFilters` (see `handleApplyDraft`).
 * `TFilters` is a plain object of primitive-ish values in every dataset this
 * layout has been used with, so a one-level comparison is enough -- it is
 * not a deep-equal.
 */
function shallowEqualFilters(a: unknown, b: unknown): boolean {
	if (a === b) return true;
	if (typeof a !== 'object' || a === null || typeof b !== 'object' || b === null) return false;
	const left = a as Record<string, unknown>;
	const right = b as Record<string, unknown>;
	const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
	for (const key of keys) {
		if (left[key] !== right[key]) return false;
	}
	return true;
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
 * STRUCTURE (`.rle-app`) -- the mobile/desktop breakpoint and the grid's
 * column sizing live in ONE place, `styles.css`'s layout-shell section; the
 * bullets below say only which side of it each piece renders on:
 * - `.rle-filter-bar` (desktop only, CSS-hidden below the breakpoint): the
 *   optional `Search` slot and `<ListingFilters>` laid out as a single
 *   horizontally-scrolling row (`className="rle-filters-row"`,
 *   `groupClassName="rle-filter-group"`) with edge fades. The result header +
 *   `toolbarEnd` are NOT here -- they sit in `.rle-list-header` above the list.
 * - `.rle-list-header` (top of `.rle-list`): `<ListingResultHeader>` (title +
 *   count) at the left, `toolbarEnd` (sort control, save-search, ...) at the
 *   right -- a heading for the results, on every viewport.
 * - `.rle-body.rle-split`: a list-majority list|map CSS grid from the
 *   breakpoint up; below it, a single full-area panel with exactly one of
 *   `.rle-list`/`.rle-map` visible at a time via `data-mobile-view` (see
 *   `styles.css`'s mobile media query). Both regions stay mounted at ALL
 *   times regardless of viewport/toggle state -- only their visibility flips
 *   -- so neither `ListingList` nor `ListingMap` remounts (and re-triggers
 *   its own mount effects) on toggle or resize.
 * - `<MobileHeader>` (mobile only): the same search box, a **Filters** button
 *   (opens the `<BottomSheet>`, with an applied-filter count badge) and the
 *   optional `mobileAction`.
 * - `<BottomNav>` (mobile only): the floating List|Map view toggle, wired to
 *   the same `mobileView` state as the CSS toggle. Omitted when there is no
 *   map (nothing to toggle to).
 * - `<BottomSheet title="Filters">`: the SAME `<ListingFilters>` component,
 *   stacked vertically (`className="rle-filter-stack"`), but in DEFERRED mode
 *   (`draft`/`onDraftChange` -- see that component's doc): every control edit
 *   inside the sheet buffers into local `draft` state instead of applying to
 *   the engine, so the list/map behind the sheet never move while it's open.
 *   `draft` is re-synced from the currently applied filters each time the
 *   sheet transitions closed -> open (a render-phase adjustment, not an
 *   effect). The footer has "Clear all" (resets the DRAFT via
 *   `engine.filters.clearedParams()` -- see that method's doc for why a reset
 *   round-trips each def's to/fromParams -- NOT applied until committed) and
 *   "Show N results", which commits: `engine.applyFilters(draft)`, then
 *   closes the sheet once the resulting refetch settles (or immediately, with
 *   no refetch at all, if the draft is unchanged from what's already
 *   applied -- see `handleApplyDraft`). While a commit's refetch (or any
 *   OTHER live refetch, e.g. the desktop bar or search box, which still apply
 *   immediately) is in flight -- `pagination.loading` (`useListingState()`) is
 *   true -- the apply button is `disabled` and its label swaps for a
 *   `.rle-spinner`, so the sheet reads as "updating" instead of letting the
 *   user close onto a stale count. `.rle-sheet__apply` pins a `min-width` so
 *   that swap never changes the button's footprint. The result count itself
 *   (`Show N results`) always reflects the currently APPLIED results, not a
 *   live preview of the draft -- it only changes once a commit lands. A
 *   consumer needing a live preview (e.g. its own count endpoint keyed off
 *   the draft) can replace this whole footer via the `mobileSheetFooter`
 *   render prop -- see `IStyledListingLayoutProps.mobileSheetFooter`'s doc
 *   comment; omitted (the default), the footer above renders unchanged.
 * - Fetches the first page itself on mount (`engine.applyFilters({})`) by
 *   default -- pass `autoFetch={false}`
 *   to opt out and drive the first fetch yourself.
 */
export function StyledListingLayout<TFilters = unknown>({
	search,
	filterBarStart,
	resultsSlot,
	toolbarEnd,
	mobileAction,
	autoFetch = true,
	initialPage,
	hasMap: hasMapProp,
	mapCenter,
	mapZoom,
	mapControls,
	mapPending,
	onMapReady,
	mobileSheetFooter,
	className,
}: IStyledListingLayoutProps<TFilters>) {
	const engine = useListing();
	const { BottomNav: BottomNavSlot, Search } = useListingComponents();
	const results = useListingResults();
	const { filters, set } = useListingFilters();
	const { pagination } = useListingState();

	// `engine.map` is the single source of truth for "is a map configured";
	// the prop only overrides it (see its doc).
	const hasMap = hasMapProp ?? engine.map != null;

	const [mobileView, setMobileView] = useState<BottomNavView>('list');
	const [sheetOpen, setSheetOpen] = useState(false);
	const { atEnd, atStart, ref: barScrollRef } = useScrollEdges<HTMLDivElement>();

	// Paged-mode scroll reset: `.rle-list` is this layout's own scroll
	// container, so when `goToPage` lands on a new page (pageIndex changes) the
	// new page must start at the TOP of the list, not wherever page N-1 left
	// the scroll position. Infinite mode appends in place — resetting there
	// would yank the user away from the rows they just loaded, so it's skipped.
	const listScrollRef = useRef<HTMLDivElement | null>(null);
	useEffect(() => {
		if (pagination.mode !== PaginationMode.Paged) return;
		if (listScrollRef.current) listScrollRef.current.scrollTop = 0;
	}, [pagination.mode, pagination.pageIndex]);

	// Deferred mobile-sheet filters: `draft` buffers every control edit made
	// INSIDE the sheet -- nothing reaches the engine until "Show N results"
	// commits it (see `ListingFilters`'s `draft`/`onDraftChange` doc). Re-synced
	// from the currently APPLIED `filters` every time the sheet transitions
	// closed -> open, via the render-phase "adjusting state" pattern (React's
	// own recommended alternative to a `useEffect` + `setState` for state that
	// must be correct on the very first paint of the transition, not one
	// render late) rather than an effect.
	const [draft, setDraft] = useState<Record<string, unknown>>(filters as Record<string, unknown>);
	const [prevSheetOpen, setPrevSheetOpen] = useState(sheetOpen);
	if (sheetOpen !== prevSheetOpen) {
		setPrevSheetOpen(sheetOpen);
		if (sheetOpen) setDraft(filters as Record<string, unknown>);
	}

	const patchDraft = (partial: Partial<Record<string, unknown>>): void =>
		setDraft(current => ({ ...current, ...partial }));

	// Tracks a "Show N results" commit in progress so the sheet can stay open
	// through the resulting refetch (the existing loader stays visible on the
	// apply button) and close only once it settles -- see the apply button's
	// onClick below. `sawLoadingRef` records that `pagination.loading` was
	// actually observed `true` for THIS commit before treating a subsequent
	// `false` as "settled" -- otherwise a commit made while `debounceMs > 0`
	// (loading only flips true once the debounce timer fires, not
	// synchronously) would read the still-`false` value from BEFORE the timer
	// fires and close immediately, before the refetch ever ran.
	const [committing, setCommitting] = useState(false);
	const sawLoadingRef = useRef(false);

	useEffect(() => {
		if (!committing) return;
		if (pagination.loading) {
			sawLoadingRef.current = true;
			return;
		}
		if (sawLoadingRef.current) {
			sawLoadingRef.current = false;
			setCommitting(false);
			setSheetOpen(false);
		}
	}, [committing, pagination.loading]);

	// Library-wired search: read the current value straight off the engine's
	// filters and write edits back through `set` (`useListingFilters`'s
	// bulk-patch mutator), so the SAME box in the desktop bar and the mobile
	// header both drive `search.filterKey` without the consumer plumbing
	// value/onChange (see `search` prop doc).
	const searchBox = search
		? {
				value: String((filters as Record<string, unknown>)[search.filterKey] ?? ''),
				onChange: (value: string): void => {
					void set({ [search.filterKey]: value || undefined });
				},
				placeholder: search.placeholder,
			}
		: undefined;

	useEffect(() => {
		if (autoFetch === false) return;
		// Numbered-pagination restore: when the consumer hydrates a deep-linked
		// page (`initialPage > 0`, e.g. from a shared/refreshed `?page=N` URL),
		// fetch THAT page directly via an offset request rather than page 1 --
		// so it loads once instead of page-1-then-page-N. `initialPage` is a
		// mount-time value, read once here.
		if (initialPage && initialPage > 0) void engine.goToPage(initialPage);
		else void engine.applyFilters({});
		// `engine` is stable across re-renders of the same `<ListingProvider>`
		// (only changes on remount), so this fires once per mounted engine when
		// autoFetch is on.
		// eslint-disable-next-line react-hooks/exhaustive-deps -- initialPage read once at mount (see above)
	}, [engine, autoFetch]);

	const handleClearAll = (): void => {
		// Draft-only reset -- mirrors the PREVIOUS live `set(engine.filters.clearedParams())`,
		// but the result now stays in `draft` until "Show N results" commits it
		// (see `FilterRegistry.clearedParams` for why a reset round-trips each
		// def's to/fromParams instead of clearing by `def.key`).
		patchDraft(engine.filters.clearedParams() as Record<string, unknown>);
	};

	// "Show N results": commits the buffered `draft` to the engine. If the
	// draft is identical to what's already applied (no sheet edits were made,
	// or they round-tripped back to the same values), committing would still
	// kick off a no-op refetch -- so this closes immediately instead, matching
	// the sheet's pre-deferred "just close" behavior for that case.
	const handleApplyDraft = (): void => {
		if (shallowEqualFilters(draft, filters)) {
			setSheetOpen(false);
			return;
		}
		setCommitting(true);
		void engine.applyFilters(draft as Partial<unknown>);
	};

	// Count of filters currently applied -- shown as a badge on the mobile
	// Filters button so a collapsed filter set still signals it's active.
	const activeFilterCount = engine.filters.activeKeys(filters).length;

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

					{filterBarStart && <div className="rle-filter-bar__slot">{filterBarStart}</div>}

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
				<div className="rle-list" ref={listScrollRef}>
					{resultsSlot ?? (
						<>
							<div className="rle-list-header">
								<ListingResultHeader />
								{toolbarEnd && <div className="rle-list-header__toolbar">{toolbarEnd}</div>}
							</div>
							<ListingList className="rle-list-grid" />
							<ListingPagination />
						</>
					)}
				</div>
				{hasMap && (
					<div className="rle-map">
						<ListingMap
							center={mapCenter}
							zoom={mapZoom}
							fallback={mapPending ? MAP_PENDING : MAP_FALLBACK}
							mapControls={mapControls}
							onMapReady={onMapReady}
						/>
					</div>
				)}
			</div>

			{hasMap && <BottomNavSlot view={mobileView} onViewChange={setMobileView} />}

			<BottomSheet
				title="Filters"
				open={sheetOpen}
				onOpenChange={setSheetOpen}
				footer={
					mobileSheetFooter ? (
						mobileSheetFooter({
							// `draft` is buffered as a plain `Record<string, unknown>` internally
							// (see its declaration above) -- same unchecked cast-through-`unknown`
							// pattern as `FiltersChangeEmitter`'s own `TFilters` cast, since this
							// component never itself knows the concrete `TFilters` shape.
							draft: draft as unknown as TFilters,
							apply: handleApplyDraft,
							clear: handleClearAll,
							resultCount,
							loading: pagination.loading,
						})
					) : (
						<>
							<button type="button" className="rle-btn rle-btn--ghost" onClick={handleClearAll}>
								Clear all
							</button>
							<button
								type="button"
								className="rle-btn rle-btn--primary rle-sheet__apply"
								disabled={pagination.loading}
								onClick={handleApplyDraft}
							>
								{pagination.loading ? (
									<span className="rle-spinner" aria-label="Updating results" />
								) : (
									`Show ${resultCount} results`
								)}
							</button>
						</>
					)
				}
			>
				<ListingFilters
					className="rle-filter-stack"
					groupClassName="rle-filter-group"
					draft={draft}
					onDraftChange={patchDraft}
				/>
			</BottomSheet>
		</div>
	);
}
