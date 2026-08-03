# react-listing-engine

## 0.10.0

### Minor Changes

- `onMapReady` now delivers the provider's NATIVE map object (the `google.maps.Map` for the Google provider) rather than the provider's internal raw handle. Previously it passed `MapHandle.raw`, which for the Google provider is internal state that merely _contains_ the map (`{ map, ... }`) -- so consumers had to reach into `.map`. `MapHandle` gains an optional `nativeMap` field that providers populate with the bare map; `onMapReady` prefers it and falls back to `raw`.

## 0.9.0

### Minor Changes

- Add an `initialPage` prop to `ListingApp` (0-based): when set, the mount autoFetch loads that page directly via `engine.goToPage(initialPage)` (an offset request) instead of page 1, so a deep-linked/refreshed `?page=N` restores in a single fetch rather than page-1-then-jump. Only honored with `autoFetch` on; unset/`0` loads page 1 as before. Needs an offset-capable adapter.

## 0.8.0

### Minor Changes

- Add an `onMapReady` prop to `ListingApp` (and the underlying `ListingMap`): it fires with the map SDK's native map object (`MapHandle.raw` -- the `google.maps.Map` for the Google provider) once the map mounts, and again with `null` when it is torn down. This is the escape hatch for provider-specific features the library doesn't wrap -- e.g. Google data-driven-styling `FeatureLayer`s, custom overlays. Typed `unknown`; cast to your SDK's map type. Fully backward-compatible: omit it and nothing changes.

## 0.7.10

### Patch Changes

- Overlay markers use `preventMapHitsFrom` instead of `preventMapHitsAndGesturesFrom`: click-through to the map stays blocked (the popup-dismiss guard still works), but map gestures now pass through markers -- most visibly, the scroll wheel zooms the map even when the cursor rests on a marker (the AndGestures variant turned every marker into a zoom dead zone). The popup overlay keeps AndGestures: it's a card floating over the map, and interacting inside it must never pan/zoom the map.

## 0.7.9

### Patch Changes

- Numbered offset pagination for Paged mode: `PageRequest.offset`, `engine.goToPage(index)`, `pagination.pageIndex` in the store, and `ListingPagination` now renders a classic "1 2 3 … N" pager (windowed past 7 pages, aria-complete) in Paged mode with a known total — "Load more" remains the Infinite-mode UI. The styled layout scrolls the list back to top on page jumps. The in-memory testing adapter honors `offset`.

## 0.7.8

### Patch Changes

- Reposition and rename the just-added filter-bar slot: `filterBarEnd` -> `filterBarStart`, rendered BETWEEN the search box and the quick-filters row (search, [slot] | filters...). The end position read as an afterthought; an advanced-filters trigger belongs next to the search box.

## 0.7.7

### Patch Changes

- Add a `filterBarEnd` slot to `ListingApp`/`StyledListingLayout`: extra content rendered at the end of the desktop filter bar, after the `<ListingFilters>` row (e.g. an "advanced filters" modal trigger). Scrolls with the bar; desktop-only by construction since the whole bar is CSS-hidden below the mobile breakpoint.

## 0.7.6

### Patch Changes

- Expose `fitBounds(bounds)` on `useListingMap()` so consumers can fly the map to a bounding box programmatically (e.g. a search-autocomplete "select a destination" flow). The resulting bounds-changed event flows through the normal pipeline (bounds store + point reload + consumer bounds-sync), and a consumer-initiated fly counts as a user move — the one-time initial auto-fit never yanks the view away afterwards. Safe no-op when no map is mounted.

## 0.7.5

### Patch Changes

- Add a `mobileSheetFooter` render-prop to `ListingApp` so consumers can own the mobile filters bottom-sheet footer. It receives `{ draft, apply, clear, resultCount, loading }` (exported as `MobileSheetFooterContext`), letting the consumer render a LIVE preview count for the deferred draft (e.g. via its own count endpoint) instead of the default applied count. When the prop is omitted, the default footer (Clear all + "Show N results") is unchanged.

## 0.7.4

### Patch Changes

- Mobile filters bottom-sheet improvements:

  - The sheet's "Show N results" apply button now shows a loading spinner (and is disabled) while a filter refetch is in flight.
  - The sheet now **defers** filter application: changing a control buffers into a draft instead of applying live, and only the "Show results" button commits the draft to the engine (the list + map update then, and the sheet closes once the refetch settles). `ListingFilters` gains optional `draft` / `onDraftChange` props to drive this deferred mode; the desktop filter bar is unchanged (still applies live).

## 0.7.3

### Patch Changes

- Freeze the on-map popup's viewport clamp after it opens. Previously the clamp re-ran on every map render frame, so panning kept the popup pinned to the viewport edge instead of letting it move with its marker. Now it clamps once on open and then translates naturally with the map (panning away carries it off-screen with its marker); it only re-clamps when re-anchored to a different marker.

## 0.7.2

### Patch Changes

- Keep the on-map popup within the map viewport: shift it horizontally so it no longer overflows off-screen when its marker is near the left/right edge, and flip it below the marker when it would overflow the top edge. Previously a popup for an edge marker was clipped off-canvas.

## 0.7.1

### Patch Changes

- Fix on-map marker/popup click handling: call `google.maps.OverlayView.preventMapHitsAndGesturesFrom()` on the marker and popup overlay containers. Previously a real pointer click on an HTML overlay marker also registered as a Google Maps _map click_, which fired the background-click dismissal and immediately deselected the just-clicked marker — so the on-map popup opened and instantly closed. This also stops dragging over a marker or popup from panning the map underneath.

## 0.7.0

### Minor Changes

- Add Airbnb-style map interactivity.

  - **Marker hover/selected repaint:** new `hovered` store state + `setHovered`, exposed on `useListingMap()`. `MapProvider.updateMarkerStates` toggles `rle-marker--selected` / `rle-marker--hovered` classes on marker containers (consumers style them). The highlight persists across marker recreation on pan/zoom.
  - **On-map Popup:** the previously-inert `Popup` component slot now renders as an anchored `OverlayView` when a marker is selected. It stays anchored while panning and dismisses on the popup's close, `Esc`, or a map-background click. Backed by new `MapProvider.mountOverlay` and `MapProvider.onMapClick`.
  - **Map controls slot:** `ListingApp` gains an optional `mapControls?: ReactNode` overlay slot, and `useListingMap()` gains `zoomIn()`, `zoomOut()`, `toggleFullscreen()`. Fullscreen targets the map wrapper so custom controls stay visible.

  Consumers who don't use the new props/slots see no behavior change.

  **Interface change (minor, pre-1.0):** the `MapProvider` interface gained required methods — `updateMarkerStates`, `mountOverlay`, `onMapClick`, `zoomIn`, `zoomOut`, `toggleFullscreen`. The built-in `googleProvider` and `FakeMapProvider` implement them; external custom `MapProvider` implementations must add them to compile against 0.7.0.

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
