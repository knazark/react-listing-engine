# react-listing-engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a standalone, publishable React library — a generic, composable listing engine (list + filters + Google-Maps multi-layer map) with a headless core, React bindings, an opt-in styled adapter, and a rental preset — modeled 1:1 on `react-wizard-engine`.

**Architecture:** Pure-TS headless `core/` (engine, store, registries, strategies, map-provider contract) with zero React imports; a thin `react/` binding layer (Provider + compound components + hooks + a component-injection provider); an opt-in `shadcn/` styled adapter; a `maps/google/` provider behind a `MapProvider` seam; a `presets/rental/` package that re-expresses today's `/find` as configuration. Dependencies point downward only.

**Tech Stack:** React 18/19 (peer), TypeScript 5.7, tsup (ESM+CJS, dts), Vitest + @testing-library/react + happy-dom, changesets, `@googlemaps/js-api-loader` (peer/optional), `@radix-ui/react-slot` (peer). Reference implementation to clone conventions from: `react-wizard-engine` (source at `/Users/knazark/work/extract-tmp/perks-extract`).

## Global Constraints

- **`core/` imports zero React** and zero framework/UI code. Enforced by an ESLint boundary rule (Task 2).
- **Google Maps API key is never hardcoded or imported at module scope** — always passed through `MapInitOptions.apiKey` at wiring time.
- **`@googlemaps/js-api-loader` is a peer/optional dependency, marked `external`** in tsup; `core/` never imports it (only `maps/google/` does).
- **All public entries carry the `'use client'` banner** via tsup `esbuildOptions.banner` (preserve, do not treeshake away) — required for Next.js App Router consumers.
- **`type: module`, `sideEffects: false`**, dual ESM+CJS, `dts: { resolve: true }`.
- **Generics `<TEntity, TFilters>`** are threaded through engine, store, adapter, registries, components — never `any` in public signatures.
- **Commits use conventional-commit style** (`feat:`, `test:`, `chore:`) with plain ASCII messages — matching `react-wizard-engine`. This is a NEW repo without the `_apps`/perks commit hooks. Actual committing happens only when the user asks.
- **Package name:** `react-listing-engine` (assumed; confirm at publish time). Author/scope per `react-wizard-engine`.

---

## File Structure (decomposition — locked before tasks)

```
react-listing-engine/
  package.json, tsconfig.json, tsconfig.build.json, tsup.config.ts,
  vitest.config.ts, eslint.config.mjs, .changeset/, README.md
  src/
    index.ts                         # public barrel: core + react
    interfaces/                      # generic public interfaces (no rental types)
      entity-adapter.interface.ts    # EntityAdapter<TEntity,TFilters>, Page, PageRequest, MapPoint, Bounds
      filter-definition.interface.ts # FilterDefinition, FilterControlProps
      dataset-definition.interface.ts# DatasetDefinition, MarkerRenderer, ClusterOptions
      map-provider.interface.ts      # MapProvider, MapHandle, MapInitOptions, RenderedLayer
      listing-config-options.interface.ts # IListingConfigOptions
      index.ts
    enums/
      listing-event-type.enum.ts     # ListingEventType
      pagination-mode.enum.ts        # PaginationMode
      index.ts
    core/                            # PURE TS — no React
      listing-store.ts               # ListingStore (reactive state + subscribe)
      listing-engine.ts              # ListingEngine facade
      listing-config.ts              # ListingConfig (merges defaults)
      listing-default.config.ts      # listingDefaultConfig
      compose-listing-providers.ts   # composeListingProviders + withMap/withDataset/withFilters/withUrlSync/withConfig
      registries/
        filter-registry.ts           # FilterRegistry
        dataset-registry.ts          # DatasetRegistry
        index.ts
        map-provider.registry.ts is NOT needed (single provider)  # (intentionally omitted)
      strategies/
        pagination/                  # PaginationStrategy: paged | infinite
        sort/                        # SortStrategy
        url-sync/                    # UrlSyncController
        clustering/                  # ClusterStrategy contract (impl delegated to provider)
        index.ts
      events/
        typed-emitter.ts             # TypedEmitter (copy from wizard)
        listing-events.ts            # ListingEvent union
        index.ts
      errors/
        listing.error.ts
        index.ts
      utils/                         # last, toArray, geo helpers
      index.ts
    react/                           # headless React bindings
      context.ts                     # ListingEngineContext
      provider.tsx                   # ListingProvider
      components-provider.tsx        # ListingComponentsProvider + useListingComponents
      components/
        listing-list.tsx
        listing-map.tsx
        listing-filters.tsx
        listing-result-header.tsx
        listing-toolbar.tsx
        listing-pagination.tsx
        index.ts
      hooks/
        use-listing.ts
        use-listing-results.ts
        use-listing-map.ts
        use-listing-filters.ts
        use-listing-layer.ts
        use-listing-event.ts
        index.ts
      index.ts
    maps/google/
      google-maps.provider.ts        # GoogleMapsProvider implements MapProvider
      index.ts
    shadcn/
      components-provider-with-defaults.tsx
      default-card.tsx, default-marker.tsx, default-popup.tsx,
      default-filter-controls.tsx, listing-layout.tsx
      index.ts
      utils/cn.ts
    presets/rental/
      rental-filters.ts              # rentalFilters: FilterDefinition[]
      rental-entity.interface.ts     # PropertyEntity, RentalFilters
      properties-dataset.ts          # propertiesDataset factory
      businesses-dataset.ts          # nearbyBusinessesDataset factory (+ category taxonomy as data)
      index.ts
    testing/
      in-memory-entity-adapter.ts    # InMemoryEntityAdapter
      fake-map-provider.ts           # FakeMapProvider (records renderLayer calls)
      index.ts
    __tests__/                       # contract + hook tests colocated per skill precedent (wizard uses src/__tests__)
  examples/basic/                    # Vite demo (first consumer)
```

**Responsibility boundaries:** `interfaces/` and `enums/` are the only things `core/` and `react/` share as public types. `core/` never imports `react/`. `react/` imports `core/` + `interfaces/`. `maps/google/` imports only `interfaces/` (the `MapProvider` contract). `presets/rental/` imports `interfaces/` + `react/` + is the only place rental shapes exist. `shadcn/` imports `react/` only.

---

# Milestone 0 — Repo scaffold

### Task 1: Scaffold repo, build, and test tooling

**Files:**
- Create: `package.json`, `tsconfig.json`, `tsconfig.build.json`, `tsup.config.ts`, `vitest.config.ts`, `.changeset/config.json`, `src/index.ts` (temporary stub)
- Reference: clone shapes from `/Users/knazark/work/extract-tmp/perks-extract/{package.json,tsup.config.ts}`

**Interfaces:**
- Produces: a buildable/publishable skeleton; `pnpm build` emits `dist/index.{js,cjs,d.ts}`.

- [ ] **Step 1: Create `package.json`** (adapt from the wizard's, §4.1 of the design doc):

```jsonc
{
  "name": "react-listing-engine",
  "version": "0.0.0",
  "license": "MIT",
  "type": "module",
  "sideEffects": false,
  "main": "./dist/index.cjs",
  "module": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".":               { "types": "./dist/index.d.ts",              "import": "./dist/index.js",              "require": "./dist/index.cjs" },
    "./shadcn":        { "types": "./dist/shadcn/index.d.ts",       "import": "./dist/shadcn/index.js",       "require": "./dist/shadcn/index.cjs" },
    "./maps/google":   { "types": "./dist/maps/google/index.d.ts",  "import": "./dist/maps/google/index.js",  "require": "./dist/maps/google/index.cjs" },
    "./presets/rental":{ "types": "./dist/presets/rental/index.d.ts","import": "./dist/presets/rental/index.js","require": "./dist/presets/rental/index.cjs" },
    "./testing":       { "types": "./dist/testing/index.d.ts",      "import": "./dist/testing/index.js",      "require": "./dist/testing/index.cjs" },
    "./package.json": "./package.json"
  },
  "files": ["dist", "README.md", "LICENSE", "CHANGELOG.md"],
  "peerDependencies": {
    "react": ">=18",
    "@googlemaps/js-api-loader": ">=1",
    "@radix-ui/react-slot": ">=1"
  },
  "peerDependenciesMeta": {
    "@googlemaps/js-api-loader": { "optional": true },
    "@radix-ui/react-slot": { "optional": true }
  },
  "scripts": {
    "build": "tsup",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc -p tsconfig.build.json --noEmit",
    "lint": "eslint .",
    "release": "changeset publish"
  }
}
```

- [ ] **Step 2: Create `tsup.config.ts`** (multi-entry; preserve `'use client'`; `external` the peers):

```ts
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'shadcn/index': 'src/shadcn/index.ts',
    'maps/google/index': 'src/maps/google/index.ts',
    'presets/rental/index': 'src/presets/rental/index.ts',
    'testing/index': 'src/testing/index.ts',
  },
  tsconfig: 'tsconfig.build.json',
  format: ['esm', 'cjs'],
  dts: { resolve: true },
  sourcemap: false,
  minify: true,
  clean: true,
  splitting: true,
  treeshake: false, // preserve 'use client' banner (same reason as wizard)
  external: ['react', 'react-dom', '@googlemaps/js-api-loader', '@radix-ui/react-slot'],
  esbuildOptions(options) {
    options.banner = { js: '"use client";' };
    options.alias = { '~': fileURLToPath(new URL('./src', import.meta.url)) };
  },
});
```

- [ ] **Step 3: Create `vitest.config.ts`** with `environment: 'happy-dom'`, `globals: true`, include `src/**/*.spec.{ts,tsx}`. Create `tsconfig.json` (`strict`, `moduleResolution: bundler`, `~/* -> src/*` path) and `tsconfig.build.json` (extends, excludes tests). Install devDeps: `tsup typescript vitest @testing-library/react @testing-library/jest-dom happy-dom @types/react @types/react-dom @changesets/cli eslint typescript-eslint @googlemaps/js-api-loader lucide-react`.
- [ ] **Step 4: Temporary `src/index.ts`** = `export const VERSION = '0.0.0';`. Run `pnpm build`. Expected: `dist/index.js`, `dist/index.cjs`, `dist/index.d.ts` emitted, first line `"use client";`.
- [ ] **Step 5: Commit** — `git init && git add -A && git commit -m "chore: scaffold react-listing-engine build tooling"`

### Task 2: `core/` boundary lint rule + generic interfaces

**Files:**
- Create: `eslint.config.mjs`, `src/interfaces/*.ts`, `src/enums/*.ts`, `src/interfaces/index.ts`, `src/enums/index.ts`
- Test: `src/__tests__/core-boundary.spec.ts`

**Interfaces:**
- Produces: `EntityAdapter<TEntity,TFilters>`, `Page<T>`, `PageRequest`, `MapPoint<TEntity>`, `Bounds`, `EntityId`, `QueryParams`, `FilterDefinition<TFilters,TValue>`, `FilterControlProps<TValue>`, `DatasetDefinition<TEntity,TFilters>`, `MarkerRenderer<TEntity>`, `ClusterOptions`, `MapProvider`, `MapHandle`, `MapInitOptions`, `RenderedLayer`, `IListingConfigOptions`, `ListingEventType`, `PaginationMode`.

- [ ] **Step 1: Write the failing test** (`core` must not import React):

```ts
// src/__tests__/core-boundary.spec.ts
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(d =>
    d.isDirectory() ? walk(join(dir, d.name)) : [join(dir, d.name)]);
}

describe('core boundary', () => {
  it('no file under src/core imports react', () => {
    const offenders = walk('src/core')
      .filter(f => f.endsWith('.ts'))
      .filter(f => /from ['"]react['"]|from ['"]react-dom['"]/.test(readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test** — `pnpm test core-boundary`. Expected: FAIL (`src/core` does not exist yet) or PASS vacuously; create `src/core/index.ts` stub first so the directory exists, then it PASSES. (This test guards future tasks.)
- [ ] **Step 3: Write `src/interfaces/entity-adapter.interface.ts`** (the load-bearing contract):

```ts
export type EntityId = string | number;

export interface Bounds { west: number; south: number; east: number; north: number; }

export interface LatLng { lat: number; lng: number; }

export interface PageRequest { cursor?: string | null; limit: number; }

export interface Page<T> { items: T[]; nextCursor: string | null; total?: number; }

export interface MapPoint<TEntity = unknown> {
  id: EntityId;
  position: LatLng;
  entity: TEntity;             // the raw row, so custom markers/popups can read anything
}

export type QueryParams = Record<string, string | undefined>;

export interface EntityAdapter<TEntity, TFilters> {
  list(filters: TFilters, page: PageRequest): Promise<Page<TEntity>>;
  getPoints(filters: TFilters, bounds: Bounds): Promise<MapPoint<TEntity>[]>;
  getById?(id: EntityId): Promise<TEntity>;
  toFilters?(query: QueryParams): TFilters;
  toQuery?(filters: TFilters): QueryParams;
}
```

- [ ] **Step 4: Write the remaining interface files** exactly as specified in the design doc §5.1 (`filter-definition.interface.ts`, `dataset-definition.interface.ts`, `map-provider.interface.ts`, `listing-config-options.interface.ts`) and the two enums. Full signatures:

```ts
// map-provider.interface.ts
import type { Bounds, LatLng } from './entity-adapter.interface';
export interface MapInitOptions { apiKey: string; center?: LatLng; zoom?: number; }
export interface MapHandle { readonly raw: unknown; }
export interface RenderedLayer {
  id: string;
  markers: Array<{ id: string | number; position: LatLng; iconUrl?: string; element?: HTMLElement }>;
  clustering?: { maxZoom?: number } | false;
  onMarkerClick?(id: string | number): void;
}
export type Unsubscribe = () => void;
export interface MapProvider {
  mount(el: HTMLElement, opts: MapInitOptions): Promise<MapHandle> | MapHandle;
  renderLayer(handle: MapHandle, layer: RenderedLayer): Unsubscribe;
  onBoundsChange(handle: MapHandle, cb: (b: Bounds) => void): Unsubscribe;
  fitBounds(handle: MapHandle, b: Bounds): void;
  destroy(handle: MapHandle): void;
}
```

```ts
// filter-definition.interface.ts
import type { ComponentType } from 'react'; // TYPE-ONLY import is allowed in interfaces/ (erased at build)
export interface FilterControlProps<TValue> { value: TValue; onChange(next: TValue): void; }
export interface FilterDefinition<TFilters, TValue = unknown> {
  key: string;
  order: number;
  render: string | ComponentType<FilterControlProps<TValue>>;
  toParams(value: TValue): Partial<TFilters>;
  fromParams(filters: TFilters): TValue;
  isActive?(filters: TFilters): boolean;
}
```

> Note: `interfaces/` may use `import type { ComponentType } from 'react'` (type-only, fully erased). The `core-boundary` test targets `src/core` only, not `src/interfaces`, precisely because interfaces carry erasable React *types* but no runtime React.

- [ ] **Step 5: Write `eslint.config.mjs`** with a `no-restricted-imports` rule forbidding `react`/`react-dom` value-imports inside `src/core/**`. Run `pnpm lint` and `pnpm typecheck`. Expected: PASS.
- [ ] **Step 6: Commit** — `git commit -am "feat: generic listing interfaces + core boundary guard"`

---

# Milestone 1 — Core engine (pure TS)

### Task 3: `ListingStore` (reactive state)

**Files:**
- Create: `src/core/listing-store.ts`
- Test: `src/__tests__/listing-store.spec.ts`

**Interfaces:**
- Produces: `class ListingStore<TEntity, TFilters>` with `getState()`, `setFilters(patch: Partial<TFilters>)`, `setResults(page: Page<TEntity>)`, `appendResults(page)`, `setBounds(b)`, `setSelection(id|null)`, `setLayerVisible(id, boolean)`, `subscribe(cb): Unsubscribe`. State shape `ListingState<TEntity,TFilters> = { filters, results, bounds, selection, pagination, layers }`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi } from 'vitest';
import { ListingStore } from '~/core/listing-store';

it('notifies subscribers on filter change and merges patches', () => {
  const store = new ListingStore<{ id: number }, { min?: number; max?: number }>({ filters: { min: 1 } });
  const cb = vi.fn();
  const unsub = store.subscribe(cb);
  store.setFilters({ max: 9 });
  expect(store.getState().filters).toEqual({ min: 1, max: 9 });
  expect(cb).toHaveBeenCalledTimes(1);
  unsub();
  store.setFilters({ min: 2 });
  expect(cb).toHaveBeenCalledTimes(1); // no notify after unsubscribe
});
```

- [ ] **Step 2: Run test** — `pnpm test listing-store`. Expected: FAIL (`ListingStore` not found).
- [ ] **Step 3: Implement `ListingStore`** — an immutable-state holder with a `Set<listener>`; `setX` methods produce a new state object and call listeners. No React. (≈60 lines; getState returns a frozen snapshot.)
- [ ] **Step 4: Run test** — Expected: PASS.
- [ ] **Step 5: Add tests + impl** for `setResults`/`appendResults` (infinite mode concatenation), `setLayerVisible`. Commit — `git commit -am "feat: ListingStore reactive state"`

### Task 4: `FilterRegistry` (add/remove/reorder/replace)

**Files:**
- Create: `src/core/registries/filter-registry.ts`, `src/core/registries/index.ts`
- Test: `src/__tests__/filter-registry.spec.ts`

**Interfaces:**
- Produces: `class FilterRegistry<TFilters>` with `add(def)`, `remove(key)`, `replace(key, def)`, `reorder(keys: string[])`, `list(): FilterDefinition<TFilters>[]` (sorted by `order`), `toFilters(values): TFilters`, `activeKeys(filters): string[]`. Fluent (`add` returns `this`).

- [ ] **Step 1: Write the failing test**

```ts
it('add, replace, remove, reorder produce ordered list', () => {
  const reg = new FilterRegistry<{ q?: string; price?: number }>();
  reg.add({ key: 'q', order: 10, render: 'text', toParams: v => ({ q: v as string }), fromParams: f => f.q ?? '' })
     .add({ key: 'price', order: 20, render: 'range', toParams: v => ({ price: v as number }), fromParams: f => f.price ?? 0 });
  expect(reg.list().map(f => f.key)).toEqual(['q', 'price']);
  reg.reorder(['price', 'q']);
  expect(reg.list().map(f => f.key)).toEqual(['price', 'q']);
  reg.remove('q');
  expect(reg.list().map(f => f.key)).toEqual(['price']);
});
```

- [ ] **Step 2: Run** — Expected FAIL. **Step 3: Implement** (Map keyed by `key`; `reorder` rewrites `order` by index; `list` sorts). **Step 4: Run** — PASS.
- [ ] **Step 5:** Add test for `replace` (throws if key missing) + `toFilters` (folds each def's `toParams`). Commit — `git commit -am "feat: FilterRegistry"`

### Task 5: `DatasetRegistry`

**Files:** Create `src/core/registries/dataset-registry.ts`; Test `src/__tests__/dataset-registry.spec.ts`.
**Interfaces:** Produces `class DatasetRegistry<TEntity,TFilters>` with `add(def)`, `get(id)`, `list()`, `visibleIds()`. Same TDD cycle as Task 4 (add → list → visibility toggle honored). Commit.

### Task 6: `TypedEmitter` + `ListingEvent` union

**Files:** Create `src/core/events/typed-emitter.ts` (copy from wizard `src/core/navigation/typed-emitter.ts`), `src/core/events/listing-events.ts`, `enums/listing-event-type.enum.ts`.
**Interfaces:** Produces `TypedEmitter<TEventMap>` (`on/off/emit`) and `ListingEvent` union (`FiltersChanged`, `ResultsLoaded`, `PointClicked`, `BoundsChanged`, `LayerToggled`, `FavoriteToggled`). Port wizard's emitter tests. Commit.

### Task 7: `ListingConfig` + defaults

**Files:** Create `src/core/listing-config.ts`, `src/core/listing-default.config.ts`, `interfaces/listing-config-options.interface.ts`.
**Interfaces:** Produces `IListingConfigOptions` (`pagination: PaginationMode`, `pageSize: number`, `enableTracing: 'none'|'events'|'state'`, `debounceMs: number`, resolver hooks `resolveFilterChange?`), `listingDefaultConfig`, `class ListingConfig` (merges partial over defaults). Mirror wizard `wizard-config.ts`. Test merge + defaults. Commit.

### Task 8: `ListingEngine` facade

**Files:** Create `src/core/listing-engine.ts`, `src/core/index.ts`; Test `src/__tests__/listing-engine.spec.ts`.

**Interfaces:**
- Consumes: `ListingStore`, `FilterRegistry`, `DatasetRegistry`, `TypedEmitter`, `ListingConfig`, `EntityAdapter`, `MapProvider` (via options).
- Produces: `class ListingEngine<TEntity,TFilters>` with constructor `ListingEngineOptions<TEntity,TFilters>` = `{ config?, filters?: FilterRegistry, datasets: DatasetRegistry, map?: MapProvider, urlSync?: UrlSyncController }`; methods `applyFilters(patch)`, `loadPage()`, `loadPoints(bounds)`, `selectPoint(id)`, `toggleLayer(id)`, `subscribe(cb)`, `on(type, cb)`, `dispose()`, getter `state`.

- [ ] **Step 1: Write the failing test** using the `InMemoryEntityAdapter` fake (defined in Task 15 — write a minimal inline fake here, then swap):

```ts
it('applyFilters debounces, queries the dataset adapter, and emits ResultsLoaded', async () => {
  const adapter = new InMemoryEntityAdapter<{ id: number; price: number }, { max?: number }>(
    [ { id: 1, price: 5 }, { id: 2, price: 50 } ],
    (row, f) => (f.max == null ? true : row.price <= f.max),
    row => ({ lat: 0, lng: row.id }),
  );
  const datasets = new DatasetRegistry(); datasets.add({ id: 'x', adapter, marker: { iconUrl: () => '' } });
  const engine = new ListingEngine({ datasets, config: { debounceMs: 0, pageSize: 10 } });
  const loaded = vi.fn(); engine.on('ResultsLoaded', loaded);
  await engine.applyFilters({ max: 9 });
  expect(engine.state.results.items.map(r => r.id)).toEqual([1]);
  expect(loaded).toHaveBeenCalledOnce();
  engine.dispose();
});
```

- [ ] **Step 2: Run** — FAIL. **Step 3: Implement** the facade: hold store+registries+emitter; `applyFilters` writes store, debounces, calls each visible dataset adapter's `list`/`getPoints`, updates store, emits events. `dispose` clears timers + emitter + urlSync. **Step 4: Run** — PASS.
- [ ] **Step 5:** Add tests: `loadPoints(bounds)` per visible layer; `toggleLayer` hides a layer's points; `on('PointClicked')`. Commit — `git commit -am "feat: ListingEngine facade"`

### Task 9: Strategies — pagination, sort, url-sync

**Files:** Create `src/core/strategies/{pagination,sort,url-sync}/*.ts`, `src/core/strategies/index.ts`; Tests colocated.
**Interfaces:** Produces `PaginationStrategy` (`paged`/`infinite` deciding `setResults` vs `appendResults`), `SortStrategy` (comparator applied client-side when adapter doesn't sort), `UrlSyncController` (`start(engine)`, `stop()`, round-trips `filters <-> QueryParams` via adapter `toQuery`/`toFilters` + a pluggable history port so it stays DOM-agnostic/testable). TDD each: url-sync round-trip test with a fake history port. Commit.

### Task 10: `composeListingProviders` + `withX`

**Files:** Create `src/core/compose-listing-providers.ts`; update `src/index.ts` barrel; Test `src/__tests__/compose-listing-providers.spec.ts`.

**Interfaces:**
- Produces (mirrors wizard's mutator pattern exactly):
  - `interface IListingProviderProps<TEntity,TFilters> { config: Partial<IListingConfigOptions>; filters: FilterRegistry<TFilters>; datasets: DatasetRegistry<TEntity,TFilters>; map?: MapProvider; urlSync?: UrlSyncController; }`
  - `type ListingProviderMod<TEntity,TFilters> = (props: IListingProviderProps) => void`
  - `composeListingProviders(...mods): IListingProviderProps`
  - `withConfig(opts)`, `withMap(provider)`, `withDataset(def)`, `withFilters(fn: (reg: FilterRegistry) => void)`, `withUrlSync(opts)`.

- [ ] **Step 1: Write the failing test**

```ts
it('composes datasets and filters via mutators', () => {
  const props = composeListingProviders(
    withConfig({ pageSize: 24 }),
    withDataset({ id: 'p', adapter: fakeAdapter, marker: { iconUrl: () => '' } }),
    withFilters(reg => reg.add({ key: 'q', order: 1, render: 'text', toParams: v => ({ q: v }), fromParams: f => f.q })),
  );
  expect(props.config.pageSize).toBe(24);
  expect(props.datasets.list().map(d => d.id)).toEqual(['p']);
  expect(props.filters.list().map(f => f.key)).toEqual(['q']);
});
```

- [ ] **Step 2-4:** Run (FAIL) → implement (each `withX` returns a `props => void`; `compose` seeds `{ config:{}, filters:new FilterRegistry(), datasets:new DatasetRegistry() }` and runs mods) → Run (PASS).
- [ ] **Step 5: Commit** — `git commit -am "feat: composeListingProviders + withX helpers"`

---

# Milestone 2 — Map abstraction + Google provider

### Task 11: `FakeMapProvider` + provider contract tests

**Files:** Create `src/testing/fake-map-provider.ts`; Test `src/__tests__/map-provider.contract.spec.ts`.
**Interfaces:** Produces `class FakeMapProvider implements MapProvider` recording `renderLayer` calls in `.calls`, driving `onBoundsChange` via `.emitBounds(b)`. This is the headless test double for all map logic.
- [ ] TDD: write a contract spec asserting `mount → renderLayer → onBoundsChange callback fires → destroy` sequence against the fake. Implement the fake. Commit — `git commit -am "test: FakeMapProvider + map contract"`

### Task 12: `GoogleMapsProvider`

**Files:** Create `src/maps/google/google-maps.provider.ts`, `src/maps/google/index.ts`; Test `src/maps/google/__tests__/google-maps.provider.spec.ts`.

**Interfaces:**
- Consumes: `MapProvider` contract, `MapInitOptions.apiKey`.
- Produces: `function googleProvider(opts?: { loaderOptions?: LoaderOptions }): MapProvider`. `mount` lazy-loads via `new Loader({ apiKey })` from `@googlemaps/js-api-loader`, creates `google.maps.Map`, returns a `MapHandle` wrapping it. `renderLayer` diffs markers (uses `AdvancedMarkerElement` when `element` present, else classic marker + `iconUrl`). `onBoundsChange` binds the `idle` event → `Bounds`. Clustering hook left as an injection point (documented; not implemented this cycle).

- [ ] **Step 1: Write the failing test** — mock `@googlemaps/js-api-loader` with `vi.mock` returning a fake `google.maps` (`Map`, `event.addListener`, marker constructors as spies). Assert `mount` calls `Loader` with the passed `apiKey` and **never a hardcoded one**, and `renderLayer` constructs one marker per point.
- [ ] **Step 2-4:** Run (FAIL) → implement provider (guard: `mount` throws a clear error if `apiKey` is falsy) → Run (PASS).
- [ ] **Step 5:** Add test: `onBoundsChange` maps a Google `LatLngBounds` to our `Bounds`; `destroy` removes listeners. Commit — `git commit -am "feat: GoogleMapsProvider behind MapProvider seam"`

---

# Milestone 3 — React bindings

### Task 13: `ListingEngineContext` + `ListingProvider`

**Files:** Create `src/react/context.ts`, `src/react/provider.tsx`, `src/react/index.ts`; Test `src/__tests__/listing-provider.spec.tsx`.

**Interfaces:**
- Consumes: `IListingProviderProps`, `ListingEngine`.
- Produces: `ListingProvider` (constructs `new ListingEngine(props)` in an effect, disposes on unmount — copy the Strict-Mode-safe boot pattern from wizard `provider.tsx` verbatim), `ListingEngineContext`.

- [ ] **Step 1: Write the failing test** — render `<ListingProvider {...composeListingProviders(withDataset(...))}><Probe/></ListingProvider>`; `Probe` calls `useContext(ListingEngineContext)` and asserts a non-null engine after mount (use `findBy*`/`waitFor` for the async engine boot).
- [ ] **Step 2-4:** Run (FAIL) → implement provider mirroring wizard's lazy-`useState(bootOptions)` + effect-constructed engine + dispose → Run (PASS).
- [ ] **Step 5: Commit** — `git commit -am "feat: ListingProvider + engine context"`

### Task 14: `ListingComponentsProvider` + `useListingComponents`

**Files:** Create `src/react/components-provider.tsx`; Test `src/react/__tests__/components-provider.spec.tsx`.

**Interfaces:**
- Produces (direct parallel to `WizardComponentsProvider`): `IListingComponents` = `{ Card, Marker, Popup, Sidebar, FilterPanel, Search, Empty, Loading, ResultHeader, Toolbar }` (each `ComponentType<...Props>` with a documented props interface), fallbacks for every slot, `ListingComponentsProvider` (all optional), `useListingComponents()`.

- [ ] **Step 1: Write the failing test** — provide a custom `Empty`, render a consumer that calls `useListingComponents().Empty`, assert the custom one renders; assert an un-provided slot falls back to the default.
- [ ] **Step 2-4:** Run (FAIL) → implement (createContext with `defaults`, merge provided over defaults — copy wizard's shape) → Run (PASS).
- [ ] **Step 5: Commit** — `git commit -am "feat: ListingComponentsProvider (custom component injection)"`

### Task 15: Hooks

**Files:** Create `src/react/hooks/*.ts`, `src/react/hooks/index.ts`, `src/testing/in-memory-entity-adapter.ts`, `src/testing/index.ts`; Tests colocated in `src/react/__tests__/`.

**Interfaces:**
- Produces: `useListing()` (engine + `useSyncExternalStore` over `engine.subscribe`), `useListingResults()`, `useListingMap()`, `useListingFilters()` (values + `set(key, value)`), `useListingLayer(id)`, `useListingEvent(type, cb)`; `InMemoryEntityAdapter<TEntity,TFilters>(rows, predicate, toLatLng)`.

- [ ] **Step 1: Write the failing test** — with `InMemoryEntityAdapter`, render a component using `useListingResults()`; call `useListingFilters().set('max', 9)`; assert the rendered list updates (via `useSyncExternalStore` re-render). 
- [ ] **Step 2-4:** Run (FAIL) → implement hooks over `useSyncExternalStore(engine.subscribe, () => engine.state)` + the in-memory adapter → Run (PASS).
- [ ] **Step 5: Commit** — `git commit -am "feat: listing hooks + InMemoryEntityAdapter"`

### Task 16: Compound components

**Files:** Create `src/react/components/*.tsx`, `src/react/components/index.ts`; Tests colocated.

**Interfaces:**
- Produces: `ListingList`, `ListingMap`, `ListingFilters`, `ListingResultHeader`, `ListingToolbar`, `ListingPagination`. Each consumes hooks + `useListingComponents()` and renders **structure only** (no styling), delegating visuals to injected/fallback components. `ListingMap` mounts the configured `MapProvider` into a ref'd div (browser-guarded), pushes `RenderedLayer[]` from visible datasets, wires `onBoundsChange → engine.loadPoints`.

- [ ] TDD per component against `FakeMapProvider`/`InMemoryEntityAdapter`: e.g. `ListingList` renders one injected `Card` per result; `ListingMap` calls `provider.renderLayer` once per visible layer and re-renders on filter change; `ListingFilters` renders each registry filter's control. One test + impl + commit per component (6 small tasks). Final commit — `git commit -am "feat: compound listing components"`

---

# Milestone 4 — shadcn styled adapter

### Task 17: Default styled components + layout + `components-provider-with-defaults`

**Files:** Create `src/shadcn/{default-card,default-marker,default-popup,default-filter-controls,listing-layout,components-provider-with-defaults}.tsx`, `src/shadcn/utils/cn.ts`, `src/shadcn/index.ts`; Tests colocated.
**Interfaces:** Consumes `IListingComponents` slot prop types + hooks. Produces `ListingComponentsProviderWithDefaults` (wires shipped defaults, mirrors wizard's `components-provider-with-defaults.tsx`), `ListingLayout` (toolbar/filters/split(list,map)/pagination), and default Tailwind/shadcn-compatible Card/Marker/Popup/filter controls.
- [ ] TDD: render `<ListingLayout>` inside provider-with-defaults against fakes; assert a results skeleton (`Loading`) shows before data and cards after. Build each default component (render test each). Commit — `git commit -am "feat: shadcn styled adapter"`

---

# Milestone 5 — Rental preset

### Task 18: Rental entity + filters

**Files:** Create `src/presets/rental/{rental-entity.interface,rental-filters}.ts`; Tests colocated.
**Interfaces:** Produces `PropertyEntity` (mapped from the app's `@libs/core-base` `Listing` shape — nested `property.coordinates`), `RentalFilters` (`{ minPrice?, maxPrice?, minBeds?, maxBeds?, minBaths?, maxBaths?, propertyTypes?, keyword?, bounds? }`), `rentalFilters: FilterDefinition<RentalFilters>[]` (price, beds/baths, property-type, keyword — porting today's filter semantics). TDD each filter's `toParams`/`fromParams`/`isActive`. Commit.

### Task 19: Properties + businesses datasets

**Files:** Create `src/presets/rental/{properties-dataset,businesses-dataset}.ts`, `src/presets/rental/index.ts`; Tests colocated.
**Interfaces:**
- Produces:
  - `propertiesDataset(api: PropertiesApiPort): DatasetDefinition<PropertyEntity, RentalFilters>` — `PropertiesApiPort` is a small interface (`getList`, `getPoints`, `getItem`) the consumer implements against their real `LocaListingApi`; the preset does NOT import any HTTP client.
  - `nearbyBusinessesDataset(api: BusinessesApiPort, opts?: { categories?: BusinessCategory[] }): DatasetDefinition<BusinessEntity, BusinessFilters>` — category taxonomy is **data** (a `BusinessCategory` string-union seeded list: grocery, shopping, restaurants, schools, hospitals, parks, gyms, cafes), extendable by passing more.
- [ ] TDD: with an in-memory `PropertiesApiPort`, assert `propertiesDataset(...).adapter.getPoints` returns mapped `MapPoint`s; assert businesses dataset carries independent marker + category icon. Commit — `git commit -am "feat: rental preset (properties + nearby businesses datasets)"`

---

# Milestone 6 — Examples app (first consumer)

### Task 20: Vite demo covering four scenarios

**Files:** Create `examples/basic/` (Vite + React app; `package.json` depends on the workspace package via `file:../..` or `workspace:*`).
**Interfaces:** Consumes the public API only (dogfoods the exports). Scenarios (routes): (1) properties only; (2) properties + nearby businesses (two layers); (3) custom components via `ListingComponentsProvider`; (4) custom filters via `withFilters(reg => reg.add/replace/reorder)`. Uses a mock adapter (static JSON) so no real API/key needed; Google map guarded behind an env `VITE_GOOGLE_MAPS_KEY` with a graceful "add a key" placeholder when absent.
- [ ] Build the four routes; `pnpm --filter examples-basic dev` renders each. No unit tests (manual smoke harness). Commit — `git commit -am "docs: examples/basic demo app"`

---

# Milestone 7 — Docs + publish

### Task 21: README + changeset + 0.1.0

**Files:** Create `README.md` (wizard-style: features, install, quickstart, customization tiers, Google Maps setup, examples), `LICENSE`, `.changeset/*.md`.
**Interfaces:** none.
- [ ] Write README mirroring `react-wizard-engine`'s structure. Run full gate: `pnpm lint && pnpm typecheck && pnpm test && pnpm build`. Add a changeset (`minor`, `0.1.0`). Commit — `git commit -am "docs: README + 0.1.0 changeset"`. **Publish (`changeset publish`) only on explicit user request.**

---

## Self-Review

**Spec coverage** (design doc §): #1 generic engine → Tasks 3-10, 18-19. #2 filters → Task 4, 18. #3 component injection → Task 14, 17. #4 Google Maps → Tasks 11-12. #5 multi-marker → Tasks 5, 16 (`ListingMap`), 19. #6 businesses → Task 19. #7 data-layer separation → boundary rule Task 2 + core/react split. #8 extensibility → Task 9 (strategies) + interfaces. Rental migration → Tasks 18-19. Packaging → Tasks 1, 21. Testing → fakes in Tasks 11, 15; contract tests throughout. Migration risks → fenced by D5 (standalone-first); no product integration task, by design.

**Placeholder scan:** No "TBD/TODO"; the only deferred item is Google clustering, explicitly called an "injection point (documented; not implemented this cycle)" in Task 12 — a scoped non-goal, not a plan gap.

**Type consistency:** `EntityAdapter`, `MapPoint`, `Bounds`, `FilterDefinition`, `DatasetDefinition`, `MapProvider`, `IListingProviderProps`, `composeListingProviders`/`withX`, `ListingEngine` options, `IListingComponents` slots — names used identically in producing and consuming tasks.

**Open items for the executor:** confirm final npm name/scope (Task 1) and whether `examples/basic` links via `workspace:*` or `file:` (Task 20) before first `pnpm install`.
