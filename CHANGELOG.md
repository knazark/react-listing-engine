# react-listing-engine

## 0.2.0

### Minor Changes

- `/styled`: add a mobile header (search + Filters + optional action) and move the List|Map toggle into the footer, so the compact mobile chrome mirrors the desktop filter bar. The `search` prop is now library-wired -- pass `{ filterKey }` (the `TFilters` field it drives) instead of the consumer-managed `{ value, onChange }`; the layout reads/writes that field on the engine directly.

## 0.1.1

### Patch Changes

- Packaging metadata update.

## 0.1.0

### Minor Changes

- Initial release: headless composable listing engine with Google Maps, filter/dataset registries, component injection, /shadcn adapter, and rental preset.
