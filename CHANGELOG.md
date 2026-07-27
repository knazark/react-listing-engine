# react-listing-engine

## 0.6.9

### Patch Changes

- Support JSON `styles` map styling (no Map ID) with OverlayView HTML markers, and forward `mapOptions`/`styles` through `ListingApp`.

  - `googleProvider` gains a `styles?: google.maps.MapTypeStyle[]` config. When set, the map is created WITHOUT a `mapId` (so Google honors the JSON `styles`) and markers render as `OverlayView` HTML overlays instead of `AdvancedMarkerElement` (which requires a Map ID). The default `mapId` + `AdvancedMarkerElement` + clustering path is unchanged; clustering is unsupported in overlay mode (warns once).
  - The styled `ListingApp` now forwards `mapOptions` and `styles` from its `{ apiKey, ... }` map prop into the internally-built `googleProvider` (previously only `apiKey`/`mapId` were forwarded, silently dropping `mapOptions`).

## 0.6.8

### Patch Changes

- Add `mapOptions` to `googleProvider`'s config: a `Partial<google.maps.MapOptions>` merged into every map the provider creates, so consumers can set the zoom envelope (`minZoom`/`maxZoom`), UI chrome (`disableDefaultUI`, `zoomControl`), `clickableIcons`, gesture handling, etc. It is spread first, so the provider's own required keys always win: `mapId` comes from the `mapId` field and `center`/`zoom` from the per-mount init options. (The legacy `styles` array remains ignored by Google whenever a `mapId` is present — style a Map ID via the Cloud Console.)

## 0.6.1

### Patch Changes

- `/styled`: fix "Clear all" in the mobile filters sheet -- it cleared each filter by its registry `key`, which no-ops when a filter maps its control to different state fields via `to/fromParams` (e.g. `rent` -> `minRent`/`maxRent`). It now resets via each filter's own `toParams(fromParams({}))`. Also: the mobile Filters button now shows a count badge of how many filters are applied.

## 0.6.0

### Minor Changes

- `/styled`: revert the 0.5.0 unified filter bar. Restore the desktop filter bar + the mobile header (search + Filters button) + Filters bottom sheet, so a consumer can render distinct desktop vs. mobile filter controls (e.g. inline popover buttons on desktop, wheel-pickers in the mobile sheet). `MobileHeader` and the `BottomSheet`-backed Filters panel are back.

## 0.5.0

### Minor Changes

- `/styled`: one unified, sticky filter bar on all breakpoints instead of a separate mobile header + "Filters" bottom sheet. Search + filters render inline; on mobile the bar is a single horizontally-scrolling row (dashboard-style) so filters stay visible rather than hiding behind a button. Removes the `MobileHeader`; the `BottomSheet` primitive is still exported but no longer used by the layout. The `search` box and the optional action now live in the filter bar (`mobileAction` is rendered there on all breakpoints).

## 0.4.1

### Patch Changes

- Fix: an `iconUrl`-driven marker layer (e.g. nearby businesses) crashed the map. `resolveMarkerContent` passed the `google.maps.marker.PinElement` INSTANCE as an `AdvancedMarkerElement`'s `content`, but the instance is not a DOM node at runtime (the `@types` wrongly declare it `extends HTMLElement`) -- so Google's marker mount called `IntersectionObserver.observe()` on a non-Element and threw. It now passes the PinElement's `.element`.

## 0.4.0

### Minor Changes

- `/styled`: compact single-row filter bar. The search box is now bounded and sits inline with the filters (rather than taking a full row), and the desktop bar drops the per-filter labels via a new `ListingFilters` `hideLabels` prop -- the mobile filters sheet keeps its labels for a stacked form layout.

## 0.3.0

### Minor Changes

- `/styled`: make the results list the primary surface and improve the responsive grid.

  - When no map is configured, the layout now fills the full width as a multi-column card grid (and drops the mobile List|Map toggle) instead of reserving half the viewport for an empty map region. `ListingApp` detects this from its `map` prop; `StyledListingLayout` takes a new `hasMap` prop (defaults `true`).
  - When a map IS present, the split gives the list the majority share (~58%, floored at 400px) rather than the minority, and cards reach multiple columns sooner.
  - `ListingPagination` renders nothing when there is no next page, instead of a dangling disabled "Load more" button on empty/last pages.

## 0.2.1

### Patch Changes

- `/styled`: the mobile filters bottom sheet now uses a light, frosted (backdrop-blurred) scrim instead of a heavy dim, and its open slide/fade runs at 300ms with a strong ease-out -- a more modern bottom-sheet feel.

## 0.2.0

### Minor Changes

- `/styled`: add a mobile header (search + Filters + optional action) and move the List|Map toggle into the footer, so the compact mobile chrome mirrors the desktop filter bar. The `search` prop is now library-wired -- pass `{ filterKey }` (the `TFilters` field it drives) instead of the consumer-managed `{ value, onChange }`; the layout reads/writes that field on the engine directly.

## 0.1.1

### Patch Changes

- Packaging metadata update.

## 0.1.0

### Minor Changes

- Initial release: headless composable listing engine with Google Maps, filter/dataset registries, component injection, /shadcn adapter, and rental preset.
