'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';

import {
	composeListingProviders,
	withConfig,
	withDataset,
	withFilters,
	withInitialFilters,
	withMap,
	type FilterRegistry,
	type ListingProviderMod,
} from '~/core';
import { ListingEventType } from '~/enums';
import type { DatasetDefinition, IListingConfigOptions, LatLng, MapProvider } from '~/interfaces';
import { ListingComponentsProvider, ListingProvider, useListingEvent, type IListingComponents } from '~/react';

import type { IBottomNavAction } from './bottom-nav';
import { styledDefaultComponents } from './default-components';
import { StyledListingLayout, type IStyledListingLayoutProps, type MobileSheetFooterContext } from './listing-layout';

/**
 * Two-shape `map` prop: pass a ready `MapProvider`, or the `{ apiKey, mapId? }`
 * shorthand. The shorthand is resolved via a DYNAMIC `import()` of
 * `~/maps/google` (see `useResolvedMap` below) rather than a static one, so an
 * app that never sets `map` doesn't pull `@googlemaps/js-api-loader` into its
 * bundle.
 */
export type ListingAppMapProp =
	| { provider: MapProvider; center?: LatLng; zoom?: number }
	| {
			apiKey: string;
			mapId?: string;
			/** Extra `google.maps.MapOptions` forwarded to the internally-built `googleProvider` (zoom envelope, UI chrome, gesture handling, ...). */
			mapOptions?: Partial<google.maps.MapOptions>;
			/** Legacy JSON map styling forwarded to `googleProvider` -- switches it into no-`mapId` OverlayView marker mode (mutually exclusive with `mapId`); see `GoogleMapsProviderConfig.styles`. */
			styles?: google.maps.MapTypeStyle[];
			center?: LatLng;
			zoom?: number;
	  };

// TEntity intentionally omitted here: `datasets` is entity-erased
// (`DatasetDefinition<any, TFilters>[]`, see its own field doc below), so
// nothing in this interface's
// BODY would ever reference a `TEntity` type parameter, and `noUnusedLocals`
// rejects a declared-but-unreferenced one (verified: TS6133). `ListingApp`
// itself still declares `<TEntity, TFilters>` -- supplied at the call site,
// exactly like `<ListingProvider<TEntity, TFilters>>`.
export interface ListingAppProps<TFilters> {
	/**
	 * One or more marker-layer datasets; the FIRST entry is the primary
	 * dataset (drives the results list + pagination) -- same "insertion
	 * order" rule `composeListingProviders`/`withDataset` already follow.
	 * Entity-erased (`any`, not `TEntity`) for the same reason
	 * `DatasetRegistry<unknown, TFilters>` is: one array can legitimately hold
	 * heterogeneous layers (a properties dataset and a businesses dataset have
	 * different entity types) -- see `compose-listing-providers.ts`'s
	 * `withDataset` doc comment.
	 */
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	datasets: DatasetDefinition<any, TFilters>[];
	/** A `(reg) => { reg.add(...); }` callback that registers your filters -- forwarded verbatim to `withFilters`. */
	filters?: (reg: FilterRegistry<TFilters>) => void;
	/** A ready `MapProvider`, or `{ apiKey, mapId? }` to build a `googleProvider` internally. Omit for no map -- the layout drops the map region and renders the list full-width. */
	map?: ListingAppMapProp;
	/** Slot overrides, merged OVER the `/styled` defaults -- see this file's doc comment for how the merge works. */
	components?: Partial<IListingComponents>;
	/**
	 * Hydrates the engine's initial filters on mount -- typically parsed from
	 * the CONSUMER's own URL (your own query-string parser over `new
	 * URLSearchParams(window.location.search)`), but any source works. Half
	 * of the event-based URL API this component exposes: `ListingApp` never
	 * reads `window.location` itself, it only accepts filters as a prop.
	 */
	initialFilters?: TFilters;
	/**
	 * EVENT OUT: fires with the engine's current filters (`TFilters`, not the
	 * store's `DeepReadonly` wrapper) every time `ListingEventType.FiltersChanged`
	 * fires on the underlying engine -- i.e. on every `engine.applyFilters(...)`
	 * call, INCLUDING the one `StyledListingLayout` makes on mount when
	 * `autoFetch` is on (a `{}` patch that still round-trips through
	 * `currentFilters()` and re-emits the very `initialFilters` this component
	 * was given). That first call is intentionally NOT suppressed: a
	 * consumer's handler is expected to write filters back to a URL via
	 * `history.replaceState` (or a router's equivalent), and replacing the URL
	 * with the SAME query string it already hydrated from is a no-op, not a
	 * visible echo -- so "just always emit" is simpler than tracking a
	 * first-call flag for no behavioral gain. This is the OTHER half of the
	 * event-based URL API: `ListingApp` (and the engine underneath it) never
	 * touches `window.history` -- the CONSUMER owns routing, driven by this
	 * callback plus `initialFilters` above. `UrlSyncController`/`BrowserHistoryPort`
	 * (`~/core`, `~/react`) remain exported as optional, lower-level helpers
	 * for consumers who want the library to own `window.history` directly, but
	 * they are no longer the primary/recommended path for new integrations.
	 */
	onFiltersChange?: (filters: TFilters) => void;
	/** The mobile header action (e.g. "Save"/"Add") -- forwarded verbatim to `StyledListingLayout`/`MobileHeader`. */
	mobileAction?: IBottomNavAction;
	search?: IStyledListingLayoutProps['search'];
	/** Forwarded verbatim to `StyledListingLayout`'s `filterBarStart` -- extra content between the search box and the quick-filters row in the desktop filter bar (see that prop's doc comment). */
	filterBarStart?: IStyledListingLayoutProps['filterBarStart'];
	toolbarEnd?: IStyledListingLayoutProps['toolbarEnd'];
	/**
	 * Rendered as an absolutely-positioned overlay floating over the map (e.g. zoom/fullscreen
	 * buttons) -- forwarded verbatim through `StyledListingLayout` to `ListingMap`'s own
	 * `mapControls` prop; see that prop's doc comment for the exact positioning contract. Omit
	 * (the default) to render nothing extra. Has no effect when no map is configured (the layout
	 * drops the map region entirely in that case).
	 */
	mapControls?: ReactNode;
	/** Forwarded verbatim to `StyledListingLayout`'s `mobileSheetFooter` -- see that prop's doc comment. */
	mobileSheetFooter?: (ctx: MobileSheetFooterContext<TFilters>) => ReactNode;
	config?: Partial<IListingConfigOptions>;
	autoFetch?: boolean;
	className?: string;
}

function isMapProviderShape(map: ListingAppMapProp): map is { provider: MapProvider; center?: LatLng; zoom?: number } {
	return 'provider' in map;
}

interface MapResolution {
	ready: boolean;
	provider?: MapProvider;
}

/**
 * Resolves `ListingAppProps.map` into a concrete `MapProvider`: a static
 * `import { googleProvider } from '~/maps/google'`
 * at this module's top level would statically pull in `@googlemaps/js-api-loader`
 * (an OPTIONAL peer dep) for every `/styled` consumer, even ones who never
 * pass `apiKey`. The `{ apiKey }` shorthand is therefore resolved via a
 * dynamic `import()`, gated behind `ready` so `<ListingProvider>` (whose
 * `map` boot prop is captured ONCE at first render) never mounts with a
 * missing map it can't retroactively add.
 */
function useResolvedMap(map: ListingAppMapProp | undefined): MapResolution {
	const isApiKeyShape = map != null && !isMapProviderShape(map);
	const apiKey = isApiKeyShape ? (map as { apiKey: string }).apiKey : undefined;
	const mapId = isApiKeyShape ? (map as { mapId?: string }).mapId : undefined;
	const mapOptions = isApiKeyShape ? (map as { mapOptions?: Partial<google.maps.MapOptions> }).mapOptions : undefined;
	const styles = isApiKeyShape ? (map as { styles?: google.maps.MapTypeStyle[] }).styles : undefined;

	const [state, setState] = useState<MapResolution>(() =>
		!map || isMapProviderShape(map) ? { ready: true, provider: map?.provider } : { ready: false },
	);

	useEffect(() => {
		if (!apiKey) return;
		let cancelled = false;

		void import('~/maps/google').then(({ googleProvider }) => {
			if (cancelled) return;
			setState({ ready: true, provider: googleProvider({ apiKey, mapId, mapOptions, styles }) });
		});

		return () => {
			cancelled = true;
		};
		// `mapOptions`/`styles` are read ONCE here as initial map-construction options (like
		// `apiKey`/`mapId`), NOT reactive deps: they are objects/arrays whose inline identity changes
		// every render, so including them would remount the whole map on every render. Same read-once
		// treatment ListingMap's mount effect gives its `center`/`zoom`.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [apiKey, mapId]);

	return state;
}

interface FiltersChangeEmitterProps<TFilters> {
	onFiltersChange: (filters: TFilters) => void;
}

/**
 * Rendered INSIDE `<ListingProvider>` so it can subscribe via `useListingEvent`
 * (which throws when used outside one) -- renders nothing, its only job is
 * forwarding `FiltersChanged` events to `ListingApp.onFiltersChange`.
 * `onFiltersChange` is stashed in a ref and refreshed every render, so a new
 * inline closure identity from the consumer never tears down/resubscribes
 * the underlying `engine.on(...)` listener -- `useListingEvent` already does
 * the same ref trick for the `handler` IT'S given (see that hook's own doc
 * comment), this is the same guarantee one level up, for the prop this
 * component was handed.
 *
 * The event payload's `filters` is `unknown` at this layer (`useListingEvent`'s
 * `ListingEvent` is entity/filters-erased by default -- see its doc comment),
 * so the cast back to `TFilters` here is UNCHECKED, same pattern as
 * `useListing<TEntity, TFilters>()`'s own cast.
 */
function FiltersChangeEmitter<TFilters>({ onFiltersChange }: FiltersChangeEmitterProps<TFilters>) {
	const handlerRef = useRef(onFiltersChange);
	handlerRef.current = onFiltersChange;

	useListingEvent(ListingEventType.FiltersChanged, event => {
		if (event.type !== ListingEventType.FiltersChanged) return;
		handlerRef.current(event.filters as TFilters);
	});

	return null;
}

/**
 * Turnkey, batteries-included, Tailwind-free entry point -- and (per
 * `src/index.ts`) the package's MAIN-ENTRY default: `import { ListingApp } from
 * 'react-listing-engine'` gives you this component. Pass datasets + filters +
 * a map + component overrides, and `ListingApp` composes
 * `composeListingProviders(...)`, `<ListingProvider>`, the `/styled` defaults,
 * and `<StyledListingLayout>` for you.
 *
 * `TEntity` still can't be inferred from these props (`datasets` narrows it,
 * but a multi-dataset array widens back to the union/`unknown` in practice)
 * -- annotate the call site when entity-level typing matters, exactly like
 * `<ListingProvider<TEntity, TFilters>>` itself.
 *
 * COMPONENTS MERGE: `components` overrides are applied ON TOP of the
 * `/styled` defaults via ONE explicit `{ ...styledDefaultComponents,
 * ...components }` object, passed to a single `<ListingComponentsProvider>`
 * -- never as a nested `<ListingComponentsProvider>` inside
 * `StyledComponentsProviderWithDefaults`. `ListingComponentsProvider` merges
 * `provided ?? ITS OWN private, unstyled fallbacks` per slot (it does not
 * read the parent context -- see `src/react/components-provider.tsx`), so
 * nesting would silently discard every un-overridden `/styled` default
 * instead of keeping it.
 *
 * URL SYNC IS EVENT-BASED, NOT INTERNAL: this component takes no `urlSync`
 * prop and never constructs/starts a
 * `UrlSyncController` -- it never touches `window.history`. Instead it
 * accepts `initialFilters` (hydrate FROM the consumer's URL) and emits
 * `onFiltersChange` (write TO the consumer's URL/router) -- see both props'
 * doc comments for the full contract. This keeps the library's surface
 * router-agnostic (a plain `history.replaceState`, a Next.js `router.replace`,
 * a React Router `setSearchParams`, etc. all work identically from the
 * consumer's side) instead of assuming `window.history` is the right target.
 */
export function ListingApp<TEntity, TFilters>(props: ListingAppProps<TFilters>) {
	const {
		datasets,
		filters,
		map,
		components,
		initialFilters,
		onFiltersChange,
		mobileAction,
		search,
		filterBarStart,
		toolbarEnd,
		mapControls,
		mobileSheetFooter,
		config,
		autoFetch,
		className,
	} = props;

	const { ready, provider } = useResolvedMap(map);

	if (!ready) return null;

	const mods: ListingProviderMod<TFilters>[] = [];
	for (const dataset of datasets) {
		mods.push(withDataset(dataset));
	}
	if (filters) mods.push(withFilters(filters));
	if (provider) mods.push(withMap(provider));
	// Explicit <TFilters>: truthiness-narrowing a generic `TFilters | undefined`
	// param produces `NonNullable<TFilters>`, which `withInitialFilters`'s own
	// inference would then lock onto -- a `ListingProviderMod<NonNullable<TFilters>>`
	// that (for an unconstrained generic) TS can't prove assignable back into
	// `mods: ListingProviderMod<TFilters>[]`. Pinning the type argument sidesteps it.
	if (initialFilters) mods.push(withInitialFilters<TFilters>(initialFilters));
	if (config) mods.push(withConfig(config));

	const composed = composeListingProviders<TFilters>(...mods);
	const mergedComponents: IListingComponents = { ...styledDefaultComponents, ...components };

	return (
		<ListingProvider<TEntity, TFilters> {...composed}>
			{onFiltersChange && <FiltersChangeEmitter<TFilters> onFiltersChange={onFiltersChange} />}
			<ListingComponentsProvider {...mergedComponents}>
				<StyledListingLayout<TFilters>
					className={className}
					search={search}
					filterBarStart={filterBarStart}
					toolbarEnd={toolbarEnd}
					mobileAction={mobileAction}
					autoFetch={autoFetch}
					mapCenter={map?.center}
					mapZoom={map?.zoom}
					mapControls={mapControls}
					mobileSheetFooter={mobileSheetFooter}
				/>
			</ListingComponentsProvider>
		</ListingProvider>
	);
}
