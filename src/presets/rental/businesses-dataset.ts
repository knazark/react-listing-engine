import type { Bounds, DatasetDefinition, EntityId, LatLng, Page, PageRequest } from '~/interfaces';

/**
 * Deliberately an open string type, not a union -- new business categories
 * (a new row of DATA, e.g. `'pharmacy'`) need zero library/core change to
 * flow through `nearbyBusinessesDataset`. `KNOWN_BUSINESS_CATEGORIES` below
 * is a seeded starter list for consumers building category pickers, not an
 * exhaustive/closed taxonomy.
 */
export type BusinessCategory = string;

export const KNOWN_BUSINESS_CATEGORIES = [
  'grocery',
  'shopping',
  'restaurants',
  'schools',
  'hospitals',
  'parks',
  'gyms',
  'cafes',
] as const;

export interface BusinessEntity {
  id: EntityId;
  name: string;
  category: BusinessCategory;
  coordinates: LatLng;
  address?: string;
}

export interface BusinessFilters {
  categories?: BusinessCategory[];
  bounds?: Bounds;
}

/**
 * The "port" the CONSUMER implements against their real API -- same shape of
 * seam as `PropertiesApiPort`. `list` is optional: many consumers only ever
 * render businesses as a map layer (`search`) and never page through them in
 * a results list.
 */
export interface BusinessesApiPort {
  search(filters: BusinessFilters, bounds: Bounds): Promise<BusinessEntity[]>;
  list?(filters: BusinessFilters, page: PageRequest): Promise<Page<BusinessEntity>>;
}

export interface NearbyBusinessesOptions {
  /** Restrict which categories render; default (omitted) shows everything `search` returns. */
  categories?: BusinessCategory[];
  /** Per-category icon URL -- DATA, not code. New category = new map entry. */
  icons?: Record<string, string>;
  onClick?(business: BusinessEntity): void;
}

/**
 * Wraps a `BusinessesApiPort` into a `DatasetDefinition` -- the nearby
 * businesses marker layer, proving req #6: this is just a SECOND
 * dataset/marker layer sitting next to `propertiesDataset`, and the category
 * taxonomy is DATA (`opts.categories` / `opts.icons`), not core code.
 */
export function nearbyBusinessesDataset(
  api: BusinessesApiPort,
  opts?: NearbyBusinessesOptions,
): DatasetDefinition<BusinessEntity, BusinessFilters> {
  const list = api.list;
  return {
    id: 'businesses',
    adapter: {
      list: list ? (filters, page) => list(filters, page) : async () => ({ items: [], nextCursor: null }),
      getPoints: (filters, bounds) =>
        api
          .search(filters, bounds)
          .then(rows => rows.filter(row => !opts?.categories || opts.categories.includes(row.category)))
          .then(rows => rows.map(row => ({ id: row.id, position: row.coordinates, entity: row }))),
    },
    marker: {
      // `MarkerRenderer.iconUrl` is typed to always return `string`, but an
      // unconfigured category has no icon -- `''` is the falsy "no custom
      // icon" sentinel consumers already treat the same as absent (see
      // `google-maps.provider.ts`'s `if (marker.iconUrl)` and
      // `map-provider.interface.ts`'s optional `iconUrl?: string`).
      iconUrl: business => opts?.icons?.[business.category] ?? '',
      onClick: opts?.onClick,
    },
    clustering: { maxZoom: 15 },
    visible: () => true,
  };
}
