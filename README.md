# react-listing-engine

Headless, composable listing engine for React: filterable list + Google-Maps multi-layer map, with pluggable data adapters, a filter/dataset registry, injectable components, and a Tailwind-free styled adapter. Drop into property search, business directories, store locators, or any map+list browse experience.

## Features

- **Headless core + React bindings.** `~/core` is framework-agnostic TypeScript (no React import); `react-listing-engine` adds hooks and compound components on top. The Tailwind-free styled adapter (the turnkey `ListingApp` + `react-listing-engine/styles.css`) is opt-in.
- **Generic over any entity.** Implement `EntityAdapter<TEntity, TFilters>` (`list`, `getPoints`, optional `getById`) against your own API — the engine never assumes a shape. URL serialization is a separate concern, handled by `UrlSyncController` (see `withUrlSync`), not the adapter.
- **Fully customizable filters.** `FilterRegistry` supports `add` / `remove` / `reorder` / `replace` at runtime, not just at setup.
- **Multiple marker layers.** `DatasetRegistry` composes any number of layers (properties, businesses, …) onto one map; each is its own `DatasetDefinition` with its own adapter and marker renderer.
- **Google Maps behind a provider seam.** `MapProvider` is an interface — `googleProvider({ apiKey })` is the shipped implementation. The API key always comes from your own config; there is no hardcoded fallback.
- **Component injection.** `ListingComponentsProvider` overrides any UI slot (`Card`, `Marker`, `Popup`, `Sidebar`, `FilterPanel`, `Search`, `Empty`, `Loading`, `ResultHeader`, `Toolbar`) — anything not provided falls back to an unstyled (or, with the `/styled` adapter, styled) default. `Marker` and `Popup` are defined on `IListingComponents` but **not yet wired into the map's render output** — `ListingMap` currently renders markers via each dataset's `marker.iconUrl`/`marker.element` only; injecting `Marker`/`Popup` today has no visible effect.
- **URL sync.** `UrlSyncController` (via `withUrlSync`) keeps filters in sync with your router/history without the engine depending on a specific router.
- **Dual ESM + CJS, full TypeScript types.** `sideEffects: false`, tree-shakeable subpaths, `'use client'` banners for Next.js App Router.

## Install

```sh
pnpm add react-listing-engine
```

`react >=18` is a required peer dependency. Three more peers are declared but **optional**:

- `@googlemaps/js-api-loader` — only needed if you use `react-listing-engine/maps/google`.
- `@googlemaps/markerclusterer` — only needed for `DatasetDefinition.clustering` support on `googleProvider`; without it, clustered layers fall back to plain (unclustered) markers with a one-time console warning, no crash.
- `@radix-ui/react-slot` — reserved for future compound-component support; no shipped component currently imports it.

## Quickstart

Minimal setup — one dataset, one filter, and Google Maps, rendered by the turnkey `ListingApp` (it wires the provider, the styled defaults, and the layout together). Define your own entity + filter shapes and back them with an `EntityAdapter`:

```tsx
import {
  ListingApp,
  type EntityAdapter,
  type FilterControlProps,
} from 'react-listing-engine';
import 'react-listing-engine/styles.css';

interface Property { id: string; title: string; price: number; lat: number; lng: number }
interface Filters { q?: string }

// Your API-backed adapter: `list(filters, page)` for the results, `getPoints(filters, bounds)`
// for the map pins. The engine never makes an HTTP call itself.
declare const adapter: EntityAdapter<Property, Filters>;

const SearchControl = ({ onChange, value }: FilterControlProps<string>) => (
  <input onChange={e => onChange(e.target.value)} placeholder="Search" value={value} />
);

export function PropertySearch() {
  return (
    <ListingApp<Property, Filters>
      datasets={[{ id: 'properties', adapter, marker: {} }]}
      filters={reg =>
        reg.add<string>({
          key: 'q',
          order: 0,
          render: SearchControl,
          toParams: v => ({ q: v || undefined }),
          fromParams: f => f.q ?? '',
        })
      }
      map={{ apiKey: process.env.NEXT_PUBLIC_GOOGLE_MAPS_KEY! }}
    />
  );
}
```

## Customization tiers

The engine is layered so you can go as deep as you need and stop:

1. **Data** — implement `EntityAdapter<TEntity, TFilters>` against your own API. Nothing in the engine assumes a specific backend or entity shape.
2. **Structure** — compose the provider with `composeListingProviders(withMap(...), withDataset(...), withFilters(...), withUrlSync(...), withInitialFilters(...), withPrimaryDataset(...), withConfig(...))`. Mutate filters via `FilterRegistry` (`add`/`remove`/`reorder`/`replace`) and layers via `DatasetRegistry` (`add`/`get`/`has`/`list`/`visibleIds`).
3. **Presentation** — swap any slot via `ListingComponentsProvider` (or start from `react-listing-engine/styled`'s `StyledComponentsProviderWithDefaults` for the styled look and override only what you need). Injectable slots: `Card`, `Marker`, `Popup`, `Sidebar`, `FilterPanel`, `Search`, `Empty`, `Loading`, `ResultHeader`, `Toolbar`. `Marker`/`Popup` are defined but not yet wired into the map's render output (see the Features note above) — every other slot renders as described.
4. **Layout** — skip `StyledListingLayout` entirely and arrange the structure-only compound components yourself: `ListingList`, `ListingMap`, `ListingFilters`, `ListingResultHeader`, `ListingToolbar`, `ListingPagination`.

## Google Maps setup

```ts
import { googleProvider } from 'react-listing-engine/maps/google';

const map = googleProvider({
  apiKey: process.env.NEXT_PUBLIC_GOOGLE_MAPS_KEY!, // required — no hardcoded fallback
  mapId: 'YOUR_MAP_ID', // optional — defaults to Google's zero-config dev 'DEMO_MAP_ID'
});
```

- `apiKey` always comes from **your** env/config; `googleProvider` throws immediately if it's falsy.
- `mapId` is what Google requires to render `AdvancedMarkerElement` markers. It defaults to Google's documented zero-config dev Map ID (`'DEMO_MAP_ID'`), so markers work out of the box — supply your own Cloud Console Map ID for production traffic or Cloud-based map styling.
- `mapOptions` (optional) forwards extra `google.maps.MapOptions` to every map the provider creates — zoom envelope (`minZoom`/`maxZoom`), UI chrome (`disableDefaultUI`, `zoomControl`), gesture handling, etc. The provider's own `mapId`/`center`/`zoom` always win over it.
- `styles` (optional) applies legacy JSON map styling (`google.maps.MapTypeStyle[]`). Mutually exclusive with `mapId` — Google ignores JSON styles whenever a Map ID is present — so setting it switches the provider into a no-Map-ID mode that renders markers as `OverlayView` HTML overlays instead of `AdvancedMarkerElement`s. Marker clustering isn't supported in this mode (it falls back to plain markers with a one-time console warning).
- `loaderOptions` (optional) forwards extra `@googlemaps/js-api-loader` config (language, region, preloaded libraries); `key` is always taken from `apiKey` and can't be overridden there.
- `DatasetDefinition.clustering` (`{ maxZoom }` or `false`) is implemented by the shipped `googleProvider`: when set, that layer's markers are wrapped in a `MarkerClusterer` (from the OPTIONAL peer dependency `@googlemaps/markerclusterer` — install it to enable clustering; without it, `googleProvider` warns once and falls back to plain, unclustered markers, no crash) with a custom renderer that draws a solid red circle showing the cluster's count. No Mapbox provider ships either; `MapProvider` is the seam if you want to add one.

## Multiple marker layers

A second marker layer (nearby businesses, schools, transit, …) composes onto the same map with one more `withDataset` call — its own `EntityAdapter` and marker:

```ts
withDataset({
  id: 'businesses',
  adapter: businessesAdapter, // your EntityAdapter for the second layer
  marker: { iconUrl: b => categoryIcons[b.category] },
})
```

Additional datasets are **map-only** layers: only the primary dataset (the first one added, or whichever id you pass as `primaryDatasetId` via `withPrimaryDataset`) drives the results list and pagination — implementing `list` on a secondary dataset's adapter has no effect on the list/pagination unless that dataset is made primary.

**Filter-shape caveat.** `ListingEngine.loadPoints` calls every visible layer's `getPoints` with the *primary* dataset's `TFilters` — there's a single filter state per engine, not one per layer. A secondary dataset whose filters have a genuinely different shape is **not** driven by the engine's filter state at all; the engine's filter object simply isn't in that shape by the time it reaches the layer's adapter. Filter such a layer at construction instead — close over the restriction in the adapter you hand to `withDataset` — rather than reading it from `useListingFilters()`.

## Styled adapter

The default UI is the **Tailwind-free** `/styled` adapter: the turnkey `ListingApp` (above), or the lower-level `StyledListingLayout` + `StyledComponentsProviderWithDefaults` from `react-listing-engine/styled`. It ships **self-contained CSS** — no Tailwind, no build step, no token setup. Import the stylesheet once:

```tsx
import { ListingApp } from 'react-listing-engine';
import 'react-listing-engine/styles.css';
```

Every visual value is a `--rle-*` CSS variable declared on `:root`, so you retheme the whole UI by overriding a subset in your own CSS loaded *after* the stylesheet:

```css
@import 'react-listing-engine/styles.css';

:root {
  --rle-primary: #0ea5e9;
  --rle-radius: 4px;
}
```

## Hooks

- `useListing()` — the active `ListingEngine` from context; throws outside a `<ListingProvider>`.
- `useListingState()` — the full store snapshot, subscribed via `useSyncExternalStore`.
- `useListingResults()` — just the paginated results slice.
- `useListingFilters()` — current filters plus `set(patch)` / `setField(key, value)`.
- `useListingMap()` — bounds + per-dataset points, plus `loadPoints(bounds)` / `selectPoint(datasetId, id)`.
- `useListingLayer(id)` — one dataset's visibility, points, and a `toggle()`.
- `useListingEvent(type | '*', handler)` — subscribe to engine events for the component's lifetime.

## Support

If `react-listing-engine` saves you time, consider sponsoring continued maintenance:

[![GitHub Sponsors](https://img.shields.io/github/sponsors/knazark?label=GitHub%20Sponsors&logo=githubsponsors&logoColor=white&color=ea4aaa)](https://github.com/sponsors/knazark)
[![monobank Jar](https://img.shields.io/badge/monobank-jar-black?labelColor=000000&color=FF0A0A)](https://send.monobank.ua/jar/2jfphHthfY)

## License

MIT (c) knazark
