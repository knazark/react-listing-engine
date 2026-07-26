import type { HistoryPort } from '~/core';
import { UrlSyncController } from '~/core';
import type { QueryParams } from '~/interfaces';
import { BrowserHistoryPort } from '~/react';

import type { PropertyType, RentalFilters } from './rental-entity.interface';

const PROPERTY_TYPES: readonly PropertyType[] = ['house', 'apartment', 'condo', 'townhouse', 'land'];

function isPropertyType(value: string): value is PropertyType {
  return (PROPERTY_TYPES as readonly string[]).includes(value);
}

function parseNumber(value: string | undefined): number | undefined {
  if (value === undefined || value === '') return undefined;
  const parsed = Number(value);
  return Number.isNaN(parsed) ? undefined : parsed;
}

/**
 * `RentalFilters` -> `QueryParams` for URL sync. Short, stable query keys
 * (`minPrice`, `maxPrice`, `minBeds`, `maxBeds`, `minBaths`, `maxBaths`,
 * `type`, `q`) -- `type` is a comma-joined `PropertyType[]`, `keyword` maps
 * to `q`. `bounds` is intentionally NOT serialized: it's map-driven,
 * high-frequency, transient viewport state, not a shareable filter.
 */
export function rentalFiltersToQuery(filters: RentalFilters): QueryParams {
  const query: QueryParams = {};

  if (filters.minPrice != null) query.minPrice = String(filters.minPrice);
  if (filters.maxPrice != null) query.maxPrice = String(filters.maxPrice);
  if (filters.minBeds != null) query.minBeds = String(filters.minBeds);
  if (filters.maxBeds != null) query.maxBeds = String(filters.maxBeds);
  if (filters.minBaths != null) query.minBaths = String(filters.minBaths);
  if (filters.maxBaths != null) query.maxBaths = String(filters.maxBaths);
  if (filters.propertyTypes?.length) query.type = filters.propertyTypes.join(',');
  if (filters.keyword) query.q = filters.keyword;

  return query;
}

/**
 * Inverse of `rentalFiltersToQuery`. Numbers are parsed NaN-safely (an
 * unparsable value is omitted, not coerced to `NaN`); `type` is split on
 * `,` and filtered down to known `PropertyType` values (an unrecognized
 * value in the URL -- hand-edited or stale -- is silently dropped rather
 * than propagated into `RentalFilters`). Missing/empty query keys produce
 * an omitted (not `undefined`-valued) filter field.
 */
export function rentalFiltersFromQuery(query: QueryParams): RentalFilters {
  const filters: RentalFilters = {};

  const minPrice = parseNumber(query.minPrice);
  if (minPrice !== undefined) filters.minPrice = minPrice;

  const maxPrice = parseNumber(query.maxPrice);
  if (maxPrice !== undefined) filters.maxPrice = maxPrice;

  const minBeds = parseNumber(query.minBeds);
  if (minBeds !== undefined) filters.minBeds = minBeds;

  const maxBeds = parseNumber(query.maxBeds);
  if (maxBeds !== undefined) filters.maxBeds = maxBeds;

  const minBaths = parseNumber(query.minBaths);
  if (minBaths !== undefined) filters.minBaths = minBaths;

  const maxBaths = parseNumber(query.maxBaths);
  if (maxBaths !== undefined) filters.maxBaths = maxBaths;

  const propertyTypes = query.type
    ?.split(',')
    .map(value => value.trim())
    .filter(isPropertyType);
  if (propertyTypes?.length) filters.propertyTypes = propertyTypes;

  if (query.q) filters.keyword = query.q;

  return filters;
}

export interface RentalUrlSyncOptions {
  // Defaults to `new BrowserHistoryPort({ mode })`. Pass a `MemoryHistoryPort`
  // (or any other `HistoryPort`) in tests/SSR to avoid touching real
  // `window.location`.
  history?: HistoryPort;
  mode?: 'replace' | 'push';
  hydrateOnStart?: boolean;
}

/**
 * Convenience factory wiring `rentalFiltersToQuery`/`rentalFiltersFromQuery`
 * onto a `UrlSyncController<RentalFilters>`, ready to pass as
 * `composeListingProviders`' `urlSync` option (or straight into
 * `UrlSyncController.start(engine)`).
 *
 * OPTIONAL helper, not the primary URL-sync path for the main-entry
 * `ListingApp` (`~/styled/listing-app`) — that component takes
 * `initialFilters`/`onFiltersChange` instead and never touches
 * `window.history` itself (see `UrlSyncController`'s doc comment). For that
 * event-based API, use `rentalFiltersToQuery`/`rentalFiltersFromQuery`
 * directly: `initialFilters={rentalFiltersFromQuery(query)}` and
 * `onFiltersChange={f => history.replaceState(null, '', '?' +
 * new URLSearchParams(rentalFiltersToQuery(f)))}`. `rentalUrlSync()` remains
 * the right choice when wiring `/shadcn`'s `ListingApp.urlSync` or a
 * hand-built engine where the library owning `window.history` is desired.
 */
export function rentalUrlSync(opts: RentalUrlSyncOptions = {}): UrlSyncController<RentalFilters> {
  const history = opts.history ?? new BrowserHistoryPort({ mode: opts.mode });

  return new UrlSyncController<RentalFilters>({
    history,
    toQuery: rentalFiltersToQuery,
    toFilters: rentalFiltersFromQuery,
    hydrateOnStart: opts.hydrateOnStart,
  });
}
