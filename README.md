# react-listing-engine

Headless, composable listing engine for React: filterable list + Google-Maps multi-layer map, with pluggable data adapters, a filter/dataset registry, injectable components, and a shadcn-compatible styled adapter. Drop into property search, business directories, store locators, or any map+list browse experience.

## Features

- **Headless core + React bindings.** `~/core` is framework-agnostic TypeScript (no React import); `react-listing-engine` adds hooks and compound components on top. The styled `/shadcn` adapter is opt-in.
- **Generic over any entity.** Implement `EntityAdapter<TEntity, TFilters>` (`list`, `getPoints`, optional `getById`) against your own API — the engine never assumes a shape. URL serialization is a separate concern, handled by `UrlSyncController` (see `withUrlSync`), not the adapter.
- **Fully customizable filters.** `FilterRegistry` supports `add` / `remove` / `reorder` / `replace` at runtime, not just at setup.
- **Multiple marker layers.** `DatasetRegistry` composes any number of layers (properties, businesses, …) onto one map; each is its own `DatasetDefinition` with its own adapter and marker renderer.
- **Google Maps behind a provider seam.** `MapProvider` is an interface — `googleProvider({ apiKey })` is the shipped implementation. The API key always comes from your own config; there is no hardcoded fallback.
- **Component injection.** `ListingComponentsProvider` overrides any UI slot (`Card`, `Marker`, `Popup`, `Sidebar`, `FilterPanel`, `Search`, `Empty`, `Loading`, `ResultHeader`, `Toolbar`) — anything not provided falls back to an unstyled (or, with `/shadcn`, styled) default. `Marker` and `Popup` are defined on `IListingComponents` but **not yet wired into the map's render output** — `ListingMap` currently renders markers via each dataset's `marker.iconUrl`/`marker.element` only; injecting `Marker`/`Popup` today has no visible effect.
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

Minimal setup using the shipped rental preset — one dataset, the shipped filters, Google Maps, and the styled `/shadcn` layout:

```tsx
import {
  composeListingProviders,
  ListingProvider,
  withDataset,
  withFilters,
  withMap,
} from 'react-listing-engine';
import { ListingComponentsProviderWithDefaults, ListingLayout } from 'react-listing-engine/shadcn';
import { googleProvider } from 'react-listing-engine/maps/google';
import {
  propertiesDataset,
  withRentalFilters,
  type PropertiesApiPort,
  type PropertyEntity,
  type RentalFilters,
} from 'react-listing-engine/presets/rental';

declare const propertiesApi: PropertiesApiPort; // your implementation, calling your real API

export function PropertySearch() {
  return (
    <ListingProvider<PropertyEntity, RentalFilters>
      {...composeListingProviders<RentalFilters>(
        withMap<RentalFilters>(googleProvider({ apiKey: process.env.NEXT_PUBLIC_GOOGLE_MAPS_KEY! })),
        withDataset(propertiesDataset(propertiesApi)),
        withFilters(withRentalFilters()),
      )}
    >
      <ListingComponentsProviderWithDefaults>
        <ListingLayout />
      </ListingComponentsProviderWithDefaults>
    </ListingProvider>
  );
}
```

`propertiesApi` only needs to implement `PropertiesApiPort` (`list`, `search`, optional `getById`) against your own backend — the preset never makes an HTTP call itself.

## Customization tiers

The engine is layered so you can go as deep as you need and stop:

1. **Data** — implement `EntityAdapter<TEntity, TFilters>` (or a preset's narrower port, e.g. `PropertiesApiPort`) against your own API. Nothing in the engine assumes a specific backend or entity shape.
2. **Structure** — compose the provider with `composeListingProviders(withMap(...), withDataset(...), withFilters(...), withUrlSync(...), withInitialFilters(...), withPrimaryDataset(...), withConfig(...))`. Mutate filters via `FilterRegistry` (`add`/`remove`/`reorder`/`replace`) and layers via `DatasetRegistry` (`add`/`get`/`has`/`list`/`visibleIds`).
3. **Presentation** — swap any slot via `ListingComponentsProvider` (or start from `ListingComponentsProviderWithDefaults` for the `/shadcn` look and override only what you need). Injectable slots: `Card`, `Marker`, `Popup`, `Sidebar`, `FilterPanel`, `Search`, `Empty`, `Loading`, `ResultHeader`, `Toolbar`. `Marker`/`Popup` are defined but not yet wired into the map's render output (see the Features note above) — every other slot renders as described.
4. **Layout** — skip `ListingLayout` entirely and arrange the structure-only compound components yourself: `ListingList`, `ListingMap`, `ListingFilters`, `ListingResultHeader`, `ListingToolbar`, `ListingPagination`.

## Google Maps setup

```ts
import { googleProvider } from 'react-listing-engine/maps/google';

const map = googleProvider({
  apiKey: process.env.NEXT_PUBLIC_GOOGLE_MAPS_KEY!, // required — no hardcoded fallback
  mapId: 'YOUR_MAP_ID', // required by Google for AdvancedMarkerElement
});
```

- `apiKey` always comes from **your** env/config; `googleProvider` throws immediately if it's falsy.
- `mapId` is required by Google to render `AdvancedMarkerElement` markers.
- `loaderOptions` (optional) forwards extra `@googlemaps/js-api-loader` config (language, region, preloaded libraries); `key` is always taken from `apiKey` and can't be overridden there.
- `DatasetDefinition.clustering` (`{ maxZoom }` or `false`) is implemented by the shipped `googleProvider`: when set, that layer's markers are wrapped in a `MarkerClusterer` (from the OPTIONAL peer dependency `@googlemaps/markerclusterer` — install it to enable clustering; without it, `googleProvider` warns once and falls back to plain, unclustered markers, no crash) with a custom renderer that draws a solid red circle showing the cluster's count. No Mapbox provider ships either; `MapProvider` is the seam if you want to add one.

## Nearby businesses / multiple layers

A second marker layer composes onto the same map with one more `withDataset` call:

```ts
import { nearbyBusinessesDataset } from 'react-listing-engine/presets/rental';

withDataset(
  nearbyBusinessesDataset(businessesApi, {
    icons: { grocery: '/icons/grocery.png', schools: '/icons/schools.png' },
  }),
)
```

`BusinessCategory` is an open `string` type, not a closed union — new categories are just new entries in your `icons`/`categories` data, no library change required. `KNOWN_BUSINESS_CATEGORIES` ships as a seeded starter list for building category pickers. Additional datasets are map-only layers; only the primary dataset (the first one added, or whichever id you pass as `primaryDatasetId` via `withPrimaryDataset`) drives the results list and pagination — implementing `list` on a secondary dataset's adapter has no effect on the list/pagination unless that dataset is made primary.

**Filter shape caveat.** `ListingEngine.loadPoints` calls every visible layer's `getPoints` with the *primary* dataset's `TFilters` — there's a single filter state per engine, not one per layer. A secondary dataset whose filters have a genuinely different shape (e.g. `nearbyBusinessesDataset`'s `BusinessFilters` vs. the primary `RentalFilters`) is **not** driven by the engine's filter state at all; the engine's filter object simply isn't in `BusinessFilters`' shape by the time it reaches that layer's adapter. Filter such a layer through the dataset factory's own `opts` instead — e.g. `nearbyBusinessesDataset(api, { categories })` — which closes over the restriction at construction time rather than reading it from `useListingFilters()`.

## Styled adapter

`react-listing-engine/shadcn` ships a full default UI (`ListingLayout` plus every `Default*` slot component) built on Tailwind utility classes matching shadcn's token conventions:

```tsx
import { ListingComponentsProviderWithDefaults, ListingLayout } from 'react-listing-engine/shadcn';
```

It needs Tailwind to see its class names and the shadcn-style CSS variables to be defined. Either:

- point Tailwind's `@source` at the package's compiled output so its classes aren't purged:
  ```css
  @import "tailwindcss";
  @source "../node_modules/react-listing-engine/dist/**/*.{js,cjs}";
  ```
- or define the semantic tokens it reads yourself (`--color-background`, `--color-foreground`, `--color-card`, `--color-popover`, `--color-border`, `--color-primary`, `--color-secondary`, `--color-muted`, `--color-accent`, `--color-destructive`, plus `-foreground` variants), the same set any shadcn-based project already ships. [`examples/basic/src/index.css`](./examples/basic/src/index.css) is the source of truth for the full list.

## Hooks

- `useListing()` — the active `ListingEngine` from context; throws outside a `<ListingProvider>`.
- `useListingState()` — the full store snapshot, subscribed via `useSyncExternalStore`.
- `useListingResults()` — just the paginated results slice.
- `useListingFilters()` — current filters plus `set(patch)` / `setField(key, value)`.
- `useListingMap()` — bounds + per-dataset points, plus `loadPoints(bounds)` / `selectPoint(datasetId, id)`.
- `useListingLayer(id)` — one dataset's visibility, points, and a `toggle()`.
- `useListingEvent(type | '*', handler)` — subscribe to engine events for the component's lifetime.

## Examples

[`examples/basic`](./examples/basic) is a Vite app with four scenarios, run locally (`pnpm install && pnpm dev` inside that folder):

- **Properties only** — one dataset, the shipped rental filters, and the styled `/shadcn` defaults.
- **Properties + businesses** — a second nearby-businesses marker layer composed alongside the properties dataset.
- **Custom components** — `ListingComponentsProvider` with an app-authored `Card` and `Empty` slot.
- **Custom filters** — `withFilters(reg => reg.add/remove/reorder)` mutating the shipped rental filter set.

Each scenario works without a Google Maps key (the map is simply not rendered; a notice explains why) — set `VITE_GOOGLE_MAPS_KEY` in `examples/basic/.env` to see the map layer too.

## Support

If `react-listing-engine` saves you time, consider sponsoring continued maintenance:

[![GitHub Sponsors](https://img.shields.io/github/sponsors/knazark?label=GitHub%20Sponsors&logo=githubsponsors&logoColor=white&color=ea4aaa)](https://github.com/sponsors/knazark)
[![monobank Jar](https://img.shields.io/badge/monobank-jar-black?labelColor=000000&color=FF0A0A)](https://send.monobank.ua/jar/2jfphHthfY)

## License

MIT (c) knazark
