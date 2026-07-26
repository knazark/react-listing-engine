# react-listing-engine

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
