'use client';

import { useEffect, useState } from 'react';

import {
  composeListingProviders,
  UrlSyncController,
  withConfig,
  withDataset,
  withFilters,
  withInitialFilters,
  withMap,
  withUrlSync,
  type FilterRegistry,
  type ListingProviderMod,
} from '~/core';
import type { DatasetDefinition, IListingConfigOptions, LatLng, MapProvider } from '~/interfaces';
import { ListingComponentsProvider, ListingProvider, type IListingComponents } from '~/react';

import { shadcnDefaultComponents } from './default-components';
import { ListingLayout, type IListingLayoutProps } from './listing-layout';

/**
 * `ListingApp.map` accepts either a ready-made `MapProvider` (any
 * implementation -- Google, a fake, a future provider) or, as a convenience,
 * a bare Google Maps API key. See `useResolvedMap`'s doc comment for why the
 * key shorthand is resolved via a dynamic `import()` rather than a static one.
 *
 * Both shapes optionally carry `center`/`zoom` -- the initial view, forwarded
 * through `ListingLayout`'s `mapCenter`/`mapZoom` straight into
 * `ListingMap`'s own `center`/`zoom` props. Omit them to get `ListingMap`'s
 * turnkey auto-fit default instead (see that component's doc comment);
 * supplying `center` opts out of auto-fit entirely.
 */
export type ListingAppMapProp =
  | { provider: MapProvider; center?: LatLng; zoom?: number }
  | { apiKey: string; mapId?: string; center?: LatLng; zoom?: number };

// Parameterized by TFilters only, not TEntity -- same reasoning as
// `IListingProviderProps<TFilters>` (see `compose-listing-providers.ts`):
// `datasets` is entity-erased (heterogeneous layers, see below), so nothing
// in this interface's body would ever reference a `TEntity` type parameter,
// and `noUnusedLocals` rejects a declared-but-unreferenced one. `ListingApp`
// itself still declares `<TEntity, TFilters>` (see its own doc comment) --
// TEntity is supplied at the CALL site, exactly like `<ListingProvider<TEntity, TFilters>>`.
export interface ListingAppProps<TFilters> {
  /**
   * One or more marker-layer datasets; the FIRST entry is the primary
   * dataset (drives the results list + pagination) -- same "insertion order"
   * rule `composeListingProviders`/`withDataset` already follow. Entity-erased
   * (`any`, not `TEntity`) for the same reason `DatasetRegistry<unknown,
   * TFilters>` is: one array can legitimately hold heterogeneous layers (a
   * properties dataset and a businesses dataset have different entity types)
   * -- see `compose-listing-providers.ts`'s `withDataset` doc comment.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  datasets: DatasetDefinition<any, TFilters>[];
  /** e.g. `withRentalFilters()`, or any `(reg) => { reg.add(...); }` callback -- forwarded verbatim to `withFilters`. */
  filters?: (reg: FilterRegistry<TFilters>) => void;
  /** A ready `MapProvider`, or `{ apiKey, mapId? }` to build a `googleProvider` internally. Omit for no map (the styled layout shows a "Map unavailable" fallback). */
  map?: ListingAppMapProp;
  /** Slot overrides, merged OVER the shadcn styled defaults -- see this file's doc comment for how the merge works. */
  components?: Partial<IListingComponents>;
  /** A `UrlSyncController<TFilters>` (e.g. `rentalUrlSync()`), or `true`. `true` is a documented no-op: the library is filters-shape-erased and cannot generically derive a `TFilters <-> QueryParams` mapping, which is exactly why domain presets (like `rentalUrlSync`) exist to build a real controller. */
  urlSync?: UrlSyncController<TFilters> | boolean;
  initialFilters?: TFilters;
  config?: Partial<IListingConfigOptions>;
  className?: string;
  search?: IListingLayoutProps['search'];
  autoFetch?: boolean;
}

function isMapProviderShape(map: ListingAppMapProp): map is { provider: MapProvider } {
  return 'provider' in map;
}

interface MapResolution {
  ready: boolean;
  provider?: MapProvider;
}

/**
 * Resolves `ListingAppProps.map` into a concrete `MapProvider`, WITHOUT ever
 * statically importing `~/maps/google` (and therefore `@googlemaps/js-api-loader`,
 * an OPTIONAL peer dep -- see `package.json`'s `peerDependenciesMeta`) from
 * this `/shadcn` entry point. A static `import { googleProvider } from
 * '~/maps/google'` at the top of this file would defeat that optionality for
 * EVERY `ListingApp` consumer -- including ones who never pass `apiKey` (a
 * custom `MapProvider`, or no map at all) -- because `google-maps.provider.ts`
 * itself statically imports `@googlemaps/js-api-loader`, and a static import
 * chain must resolve at module-load time even if the code path that uses it
 * never runs.
 *
 * The `{ apiKey }` shorthand is therefore resolved via a dynamic `import()`,
 * gated behind `ready`: `ListingApp` withholds mounting `<ListingProvider>`
 * (whose `map` boot prop is captured ONCE at first render -- see that
 * component's own docstring -- and never re-read on prop changes) until the
 * real provider is in hand, rather than mounting early with `map: undefined`
 * and having no way to retroactively add it. `{ provider }` and "no map"
 * resolve synchronously (`ready: true` on the very first render), so this
 * gate only ever delays the `apiKey` shorthand -- and only briefly, since the
 * dynamic import resolves as soon as the (already co-located) module chunk
 * loads, well before Google's own script/API load that follows.
 */
function useResolvedMap(map: ListingAppMapProp | undefined): MapResolution {
  const isApiKeyShape = map != null && !isMapProviderShape(map);
  const apiKey = isApiKeyShape ? (map as { apiKey: string }).apiKey : undefined;
  const mapId = isApiKeyShape ? (map as { mapId?: string }).mapId : undefined;

  const [state, setState] = useState<MapResolution>(() =>
    !map || isMapProviderShape(map) ? { ready: true, provider: map?.provider } : { ready: false },
  );

  useEffect(() => {
    if (!apiKey) return;
    let cancelled = false;

    void import('~/maps/google').then(({ googleProvider }) => {
      if (cancelled) return;
      setState({ ready: true, provider: googleProvider({ apiKey, mapId }) });
    });

    return () => {
      cancelled = true;
    };
  }, [apiKey, mapId]);

  return state;
}

/**
 * Turnkey, batteries-included entry point: pass datasets + filters + a map +
 * component overrides + URL sync, and `ListingApp` composes
 * `composeListingProviders(...)`, `<ListingProvider>`, the styled `/shadcn`
 * defaults, and `<ListingLayout>` for you. Equivalent to (and internally
 * built from) the lower-level primitives every other `/shadcn` example wires
 * by hand -- reach for those directly when you need something `ListingApp`
 * doesn't expose (e.g. multiple `<ListingLayout>`s sharing one engine).
 *
 * `TEntity` still can't be inferred from these props (`datasets` narrows it,
 * but a multi-dataset array widens back to the union/`unknown` in practice)
 * -- annotate the call site when entity-level typing matters, exactly like
 * `<ListingProvider<TEntity, TFilters>>` itself.
 *
 * COMPONENTS MERGE: `components` overrides are applied ON TOP of the shadcn
 * styled defaults via ONE explicit `{ ...shadcnDefaultComponents, ...components }`
 * object, passed to a single `<ListingComponentsProvider>` -- never as a
 * nested `<ListingComponentsProvider>` inside `<ListingComponentsProviderWithDefaults>`.
 * `ListingComponentsProvider` merges `provided ?? ITS OWN private, unstyled
 * fallbacks` per slot (it does not read the parent context -- see
 * `src/react/components-provider.tsx`), so nesting would silently discard
 * every un-overridden shadcn default instead of keeping it.
 */
export function ListingApp<TEntity, TFilters>(props: ListingAppProps<TFilters>) {
  const { datasets, filters, map, components, urlSync, initialFilters, config, className, search, autoFetch } =
    props;

  const { ready, provider } = useResolvedMap(map);

  if (!ready) return null;

  const mods: ListingProviderMod<TFilters>[] = [];
  for (const dataset of datasets) {
    mods.push(withDataset(dataset));
  }
  if (filters) mods.push(withFilters(filters));
  if (provider) mods.push(withMap(provider));
  if (urlSync instanceof UrlSyncController) mods.push(withUrlSync(urlSync));
  // Explicit <TFilters>: truthiness-narrowing a generic `TFilters | undefined`
  // param produces `NonNullable<TFilters>`, which `withInitialFilters`'s own
  // inference would then lock onto -- a `ListingProviderMod<NonNullable<TFilters>>`
  // that (for an unconstrained generic) TS can't prove assignable back into
  // `mods: ListingProviderMod<TFilters>[]`. Pinning the type argument sidesteps it.
  if (initialFilters) mods.push(withInitialFilters<TFilters>(initialFilters));
  if (config) mods.push(withConfig(config));

  const composed = composeListingProviders<TFilters>(...mods);
  const mergedComponents: IListingComponents = { ...shadcnDefaultComponents, ...components };

  return (
    <ListingProvider<TEntity, TFilters> {...composed}>
      <ListingComponentsProvider {...mergedComponents}>
        <ListingLayout
          className={className}
          search={search}
          autoFetch={autoFetch}
          mapCenter={map?.center}
          mapZoom={map?.zoom}
        />
      </ListingComponentsProvider>
    </ListingProvider>
  );
}
