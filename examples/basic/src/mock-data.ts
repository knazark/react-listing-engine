import type { Bounds, LatLng, Page, PageRequest } from 'react-listing-engine';
import type {
  BusinessEntity,
  BusinessesApiPort,
  BusinessFilters,
  PropertiesApiPort,
  PropertyEntity,
  PropertyType,
  RentalFilters,
} from 'react-listing-engine/presets/rental';

// ---------------------------------------------------------------------------
// Mock property rows -- San Francisco coordinates, spread across a handful of
// neighborhoods so map-bounds filtering (`search`) has something to bite on.
// ---------------------------------------------------------------------------

interface MockPropertySeed {
  title: string;
  address: string;
  coordinates: LatLng;
  price: number;
  bedrooms: number;
  bathrooms: number;
  propertyType: PropertyType;
}

const PROPERTY_SEEDS: MockPropertySeed[] = [
  { title: 'Sunset Garden Apartment', address: '1200 Irving St', coordinates: { lat: 37.7639, lng: -122.4708 }, price: 2800, bedrooms: 1, bathrooms: 1, propertyType: 'apartment' },
  { title: 'Mission District Loft', address: '2450 Mission St', coordinates: { lat: 37.7599, lng: -122.4193 }, price: 3400, bedrooms: 2, bathrooms: 1, propertyType: 'apartment' },
  { title: 'Noe Valley Family House', address: '350 Elizabeth St', coordinates: { lat: 37.7509, lng: -122.4326 }, price: 5800, bedrooms: 4, bathrooms: 3, propertyType: 'house' },
  { title: 'Pacific Heights Condo', address: '2100 Broadway', coordinates: { lat: 37.7925, lng: -122.4405 }, price: 6200, bedrooms: 3, bathrooms: 2, propertyType: 'condo' },
  { title: 'Hayes Valley Townhouse', address: '480 Hayes St', coordinates: { lat: 37.7764, lng: -122.4241 }, price: 4900, bedrooms: 3, bathrooms: 2, propertyType: 'townhouse' },
  { title: 'Bernal Heights Cottage', address: '90 Elsie St', coordinates: { lat: 37.7396, lng: -122.4157 }, price: 3600, bedrooms: 2, bathrooms: 1, propertyType: 'house' },
  { title: 'SoMa High-Rise Studio', address: '333 1st St', coordinates: { lat: 37.7862, lng: -122.3958 }, price: 2600, bedrooms: 0, bathrooms: 1, propertyType: 'apartment' },
  { title: 'Marina Bayview Condo', address: '2000 Chestnut St', coordinates: { lat: 37.8002, lng: -122.4373 }, price: 5400, bedrooms: 2, bathrooms: 2, propertyType: 'condo' },
  { title: 'Richmond District Duplex', address: '620 Clement St', coordinates: { lat: 37.7828, lng: -122.4652 }, price: 4200, bedrooms: 3, bathrooms: 2, propertyType: 'house' },
  { title: 'Castro Modern Apartment', address: '450 Castro St', coordinates: { lat: 37.7609, lng: -122.435 }, price: 3100, bedrooms: 1, bathrooms: 1, propertyType: 'apartment' },
  { title: 'Potrero Hill View Home', address: '1100 Wisconsin St', coordinates: { lat: 37.7576, lng: -122.4089 }, price: 7200, bedrooms: 4, bathrooms: 3, propertyType: 'house' },
  { title: 'Inner Sunset Vacant Lot', address: '900 9th Ave', coordinates: { lat: 37.7648, lng: -122.4661 }, price: 1200000, bedrooms: 0, bathrooms: 0, propertyType: 'land' },
  { title: 'Cole Valley Townhouse', address: '120 Carmel St', coordinates: { lat: 37.7657, lng: -122.4498 }, price: 5100, bedrooms: 3, bathrooms: 2, propertyType: 'townhouse' },
  { title: 'North Beach Studio', address: '500 Columbus Ave', coordinates: { lat: 37.7994, lng: -122.4108 }, price: 2400, bedrooms: 0, bathrooms: 1, propertyType: 'apartment' },
  { title: 'Excelsior Family House', address: '75 Persia Ave', coordinates: { lat: 37.7247, lng: -122.4325 }, price: 3900, bedrooms: 3, bathrooms: 2, propertyType: 'house' },
  { title: 'Dogpatch Live-Work Condo', address: '2200 3rd St', coordinates: { lat: 37.7599, lng: -122.3878 }, price: 4600, bedrooms: 2, bathrooms: 2, propertyType: 'condo' },
  { title: 'Glen Park Craftsman', address: '30 Chenery St', coordinates: { lat: 37.7337, lng: -122.4335 }, price: 6100, bedrooms: 4, bathrooms: 3, propertyType: 'house' },
  { title: 'Western Addition Flat', address: '1500 Fillmore St', coordinates: { lat: 37.7825, lng: -122.4326 }, price: 3300, bedrooms: 2, bathrooms: 1, propertyType: 'apartment' },
  { title: 'Diamond Heights Condo', address: '5300 Diamond Heights Blvd', coordinates: { lat: 37.7434, lng: -122.4429 }, price: 4400, bedrooms: 2, bathrooms: 2, propertyType: 'condo' },
  { title: 'Presidio Heights Estate', address: '3600 Jackson St', coordinates: { lat: 37.7879, lng: -122.4536 }, price: 9800, bedrooms: 5, bathrooms: 4, propertyType: 'house' },
];

export const mockProperties: PropertyEntity[] = PROPERTY_SEEDS.map((seed, index) => ({
  id: `property-${index + 1}`,
  title: seed.title,
  address: seed.address,
  coordinates: seed.coordinates,
  price: seed.price,
  bedrooms: seed.bedrooms,
  bathrooms: seed.bathrooms,
  propertyType: seed.propertyType,
  imageUrl: `https://picsum.photos/seed/rle-property-${index + 1}/480/270`,
}));

// ---------------------------------------------------------------------------
// Mock nearby-business rows -- a handful per category, spread near the
// property cluster so `nearbyBusinessesDataset`'s `search` (bounds-scoped)
// has overlap with the properties layer.
// ---------------------------------------------------------------------------

interface MockBusinessSeed {
  name: string;
  category: string;
  coordinates: LatLng;
  address: string;
}

const BUSINESS_SEEDS: MockBusinessSeed[] = [
  { name: 'Golden Gate Grocers', category: 'grocery', coordinates: { lat: 37.7645, lng: -122.4695 }, address: '1180 Irving St' },
  { name: 'Mission Fresh Market', category: 'grocery', coordinates: { lat: 37.7605, lng: -122.4201 }, address: '2400 Mission St' },
  { name: 'Union Square Shopping Center', category: 'shopping', coordinates: { lat: 37.7879, lng: -122.4074 }, address: '333 Post St' },
  { name: 'Hayes Valley Boutiques', category: 'shopping', coordinates: { lat: 37.7759, lng: -122.4249 }, address: '460 Hayes St' },
  { name: 'Bernal Bistro', category: 'restaurants', coordinates: { lat: 37.7401, lng: -122.4163 }, address: '95 Cortland Ave' },
  { name: 'Noe Valley Trattoria', category: 'restaurants', coordinates: { lat: 37.7513, lng: -122.4332 }, address: '360 24th St' },
  { name: 'SoMa Ramen House', category: 'restaurants', coordinates: { lat: 37.7855, lng: -122.3965 }, address: '340 1st St' },
  { name: 'Sunset Elementary', category: 'schools', coordinates: { lat: 37.7621, lng: -122.4735 }, address: '1150 27th Ave' },
  { name: 'Mission Community School', category: 'schools', coordinates: { lat: 37.7583, lng: -122.4222 }, address: '2500 Folsom St' },
  { name: 'St. Francis Memorial Hospital', category: 'hospitals', coordinates: { lat: 37.7876, lng: -122.4176 }, address: '900 Hyde St' },
  { name: 'CPMC Van Ness Campus', category: 'hospitals', coordinates: { lat: 37.785, lng: -122.4213 }, address: '1101 Van Ness Ave' },
  { name: 'Dolores Park', category: 'parks', coordinates: { lat: 37.7596, lng: -122.4269 }, address: 'Dolores St & 19th St' },
  { name: 'Golden Gate Park East', category: 'parks', coordinates: { lat: 37.7694, lng: -122.4676 }, address: '501 Stanyan St' },
  { name: 'Castro Fitness Club', category: 'gyms', coordinates: { lat: 37.7615, lng: -122.4344 }, address: '2275 Market St' },
  { name: 'Rise Coffee Roasters', category: 'cafes', coordinates: { lat: 37.7648, lng: -122.4501 }, address: '110 Carmel St' },
];

export const mockBusinesses: BusinessEntity[] = BUSINESS_SEEDS.map((seed, index) => ({
  id: `business-${index + 1}`,
  name: seed.name,
  category: seed.category,
  coordinates: seed.coordinates,
  address: seed.address,
}));

// ---------------------------------------------------------------------------
// `PropertiesApiPort` -- filters `mockProperties` by `RentalFilters`, paginates
// `list()` with a stringified-offset cursor, and returns every row whose
// coordinates fall within `bounds` for `search()`.
// ---------------------------------------------------------------------------

function inBounds(point: LatLng, bounds: Bounds): boolean {
  return (
    point.lat >= bounds.south && point.lat <= bounds.north && point.lng >= bounds.west && point.lng <= bounds.east
  );
}

function applyRentalFilters(rows: PropertyEntity[], filters: RentalFilters): PropertyEntity[] {
  return rows.filter(row => {
    if (filters.minPrice != null && row.price < filters.minPrice) return false;
    if (filters.maxPrice != null && row.price > filters.maxPrice) return false;
    if (filters.minBeds != null && row.bedrooms < filters.minBeds) return false;
    if (filters.maxBeds != null && row.bedrooms > filters.maxBeds) return false;
    if (filters.minBaths != null && row.bathrooms < filters.minBaths) return false;
    if (filters.maxBaths != null && row.bathrooms > filters.maxBaths) return false;
    if (filters.propertyTypes?.length && !filters.propertyTypes.includes(row.propertyType)) return false;
    if (filters.keyword) {
      const needle = filters.keyword.toLowerCase();
      const haystack = `${row.title} ${row.address ?? ''}`.toLowerCase();
      if (!haystack.includes(needle)) return false;
    }
    return true;
  });
}

function decodeCursor(cursor: string | null | undefined): number {
  if (!cursor) return 0;
  const parsed = Number(cursor);
  return Number.isFinite(parsed) ? parsed : 0;
}

// Simulates real network latency so the shipped `Loading` slot is visible.
function delay<T>(value: T, ms = 250): Promise<T> {
  return new Promise(resolve => setTimeout(() => resolve(value), ms));
}

export const mockPropertiesApi: PropertiesApiPort = {
  async list(filters: RentalFilters, page: PageRequest): Promise<Page<PropertyEntity>> {
    const matches = applyRentalFilters(mockProperties, filters);
    const offset = decodeCursor(page.cursor);
    const items = matches.slice(offset, offset + page.limit);
    const nextOffset = offset + items.length;
    const nextCursor = nextOffset < matches.length ? String(nextOffset) : null;
    return delay({ items, nextCursor, total: matches.length });
  },

  async search(filters: RentalFilters, bounds: Bounds): Promise<PropertyEntity[]> {
    return delay(applyRentalFilters(mockProperties, filters).filter(row => inBounds(row.coordinates, bounds)), 150);
  },

  async getById(id): Promise<PropertyEntity> {
    const found = mockProperties.find(row => row.id === id);
    if (!found) throw new Error(`mockPropertiesApi: no property with id "${String(id)}"`);
    return delay(found, 100);
  },
};

// ---------------------------------------------------------------------------
// `BusinessesApiPort` -- category + bounds filtering only (no pagination UI
// consumes `list`, but it's implemented for completeness/port-fidelity).
// ---------------------------------------------------------------------------

function applyBusinessFilters(rows: BusinessEntity[], filters: BusinessFilters): BusinessEntity[] {
  if (!filters.categories?.length) return rows;
  return rows.filter(row => filters.categories!.includes(row.category));
}

export const mockBusinessesApi: BusinessesApiPort = {
  async search(filters: BusinessFilters, bounds: Bounds): Promise<BusinessEntity[]> {
    return delay(applyBusinessFilters(mockBusinesses, filters).filter(row => inBounds(row.coordinates, bounds)), 150);
  },

  async list(filters: BusinessFilters, page: PageRequest): Promise<Page<BusinessEntity>> {
    const matches = applyBusinessFilters(mockBusinesses, filters);
    const offset = decodeCursor(page.cursor);
    const items = matches.slice(offset, offset + page.limit);
    const nextOffset = offset + items.length;
    const nextCursor = nextOffset < matches.length ? String(nextOffset) : null;
    return delay({ items, nextCursor, total: matches.length });
  },
};
