import { describe, expect, it, vi } from 'vitest';

import { DatasetRegistry } from '~/core';
import type { Bounds, Page, PageRequest } from '~/interfaces';

import type { BusinessEntity, BusinessesApiPort, BusinessFilters } from '../businesses-dataset';
import { KNOWN_BUSINESS_CATEGORIES, nearbyBusinessesDataset } from '../businesses-dataset';
import { formatRentalPrice } from '../property-card.component';
import type { PropertiesApiPort } from '../properties-dataset';
import { propertiesDataset } from '../properties-dataset';
import type { PropertyEntity, RentalFilters } from '../rental-entity.interface';

const BOUNDS: Bounds = { west: -1, south: -1, east: 1, north: 1 };

function makeProperty(overrides: Partial<PropertyEntity> = {}): PropertyEntity {
  return {
    id: 'p1',
    title: 'Loft',
    coordinates: { lat: 0, lng: 0 },
    price: 2000,
    bedrooms: 2,
    bathrooms: 1,
    propertyType: 'apartment',
    ...overrides,
  };
}

function makeBusiness(overrides: Partial<BusinessEntity> = {}): BusinessEntity {
  return {
    id: 'b1',
    name: 'Corner Store',
    category: 'grocery',
    coordinates: { lat: 0, lng: 0 },
    ...overrides,
  };
}

// -----------------------------------------------------------------------------
// propertiesDataset
// -----------------------------------------------------------------------------

describe('propertiesDataset', () => {
  it('has id "properties"', () => {
    const port: PropertiesApiPort = { list: vi.fn(), search: vi.fn() };
    expect(propertiesDataset(port).id).toBe('properties');
  });

  it('adapter.getPoints maps port.search rows to MapPoints (id/position/entity)', async () => {
    const rows = [
      makeProperty({ id: 'p1', coordinates: { lat: 10, lng: 20 } }),
      makeProperty({ id: 'p2', coordinates: { lat: 30, lng: 40 } }),
    ];
    const search = vi.fn(async () => rows);
    const port: PropertiesApiPort = { list: vi.fn(), search };
    const filters: RentalFilters = { minPrice: 100 };

    const points = await propertiesDataset(port).adapter.getPoints(filters, BOUNDS);

    expect(search).toHaveBeenCalledWith(filters, BOUNDS);
    expect(points).toEqual([
      { id: 'p1', position: { lat: 10, lng: 20 }, entity: rows[0] },
      { id: 'p2', position: { lat: 30, lng: 40 }, entity: rows[1] },
    ]);
  });

  it('adapter.list passes through to port.list', async () => {
    const page: Page<PropertyEntity> = { items: [makeProperty()], nextCursor: null };
    const list = vi.fn(async () => page);
    const port: PropertiesApiPort = { list, search: vi.fn() };
    const filters: RentalFilters = {};
    const pageRequest: PageRequest = { cursor: null, limit: 10 };

    const result = await propertiesDataset(port).adapter.list(filters, pageRequest);

    expect(list).toHaveBeenCalledWith(filters, pageRequest);
    expect(result).toBe(page);
  });

  it('adapter.getById passes through to port.getById when provided', async () => {
    const entity = makeProperty();
    const getById = vi.fn(async () => entity);
    const port: PropertiesApiPort = { list: vi.fn(), search: vi.fn(), getById };

    const result = await propertiesDataset(port).adapter.getById?.('p1');

    expect(getById).toHaveBeenCalledWith('p1');
    expect(result).toBe(entity);
  });

  it('adapter.getById is undefined when the port does not implement it', () => {
    const port: PropertiesApiPort = { list: vi.fn(), search: vi.fn() };
    expect(propertiesDataset(port).adapter.getById).toBeUndefined();
  });

  it('wires marker.iconUrl and marker.onClick from opts', () => {
    const port: PropertiesApiPort = { list: vi.fn(), search: vi.fn() };
    const iconUrl = vi.fn(() => 'icon.png');
    const onClick = vi.fn();
    const entity = makeProperty();

    const dataset = propertiesDataset(port, { iconUrl, onClick });

    expect(dataset.marker.iconUrl?.(entity)).toBe('icon.png');
    dataset.marker.onClick?.(entity);
    expect(onClick).toHaveBeenCalledWith(entity);
  });

  it('defaults marker.iconUrl/onClick to undefined when opts are omitted', () => {
    const port: PropertiesApiPort = { list: vi.fn(), search: vi.fn() };
    const dataset = propertiesDataset(port);
    expect(dataset.marker.iconUrl).toBeUndefined();
    expect(dataset.marker.onClick).toBeUndefined();
  });

  it('sets clustering maxZoom to 14', () => {
    const port: PropertiesApiPort = { list: vi.fn(), search: vi.fn() };
    expect(propertiesDataset(port).clustering).toEqual({ maxZoom: 14 });
  });

  it('defaults marker.element to a price-pin HTMLElement showing the formatted price', () => {
    const port: PropertiesApiPort = { list: vi.fn(), search: vi.fn() };
    const dataset = propertiesDataset(port);
    const entity = makeProperty({ price: 2500 });

    const element = dataset.marker.element?.(entity);

    expect(element).toBeInstanceOf(HTMLElement);
    expect(element?.textContent).toBe(formatRentalPrice(2500));
  });

  it('the default price-pin element includes a rotated-square pointer tail child (teardrop shape)', () => {
    const port: PropertiesApiPort = { list: vi.fn(), search: vi.fn() };
    const dataset = propertiesDataset(port);
    const entity = makeProperty({ price: 2500 });

    const element = dataset.marker.element?.(entity) as HTMLElement;

    expect(element.style.position).toBe('relative');
    expect(element.children).toHaveLength(1);
    const pointer = element.children[0] as HTMLElement;
    expect(pointer.style.position).toBe('absolute');
    expect(pointer.style.transform).toContain('rotate(45deg)');
    // Pointer shares the pill's background so it reads as one continuous teardrop shape.
    expect(pointer.style.backgroundColor).toBe(element.style.backgroundColor);
  });

  it('wires marker.element from opts when provided, overriding the default price pill', () => {
    const port: PropertiesApiPort = { list: vi.fn(), search: vi.fn() };
    const custom = document.createElement('span');
    const element = vi.fn(() => custom);
    const entity = makeProperty();

    const dataset = propertiesDataset(port, { element });

    expect(dataset.marker.element?.(entity)).toBe(custom);
    expect(element).toHaveBeenCalledWith(entity);
  });
});

// -----------------------------------------------------------------------------
// nearbyBusinessesDataset
// -----------------------------------------------------------------------------

describe('nearbyBusinessesDataset', () => {
  it('has id "businesses"', () => {
    const port: BusinessesApiPort = { search: vi.fn() };
    expect(nearbyBusinessesDataset(port).id).toBe('businesses');
  });

  it('adapter.getPoints maps port.search rows to MapPoints', async () => {
    const rows = [makeBusiness({ id: 'b1', coordinates: { lat: 1, lng: 2 } })];
    const search = vi.fn(async () => rows);
    const port: BusinessesApiPort = { search };
    const filters: BusinessFilters = {};

    const points = await nearbyBusinessesDataset(port).adapter.getPoints(filters, BOUNDS);

    expect(search).toHaveBeenCalledWith(filters, BOUNDS);
    expect(points).toEqual([{ id: 'b1', position: { lat: 1, lng: 2 }, entity: rows[0] }]);
  });

  it('opts.categories filters out non-matching categories', async () => {
    const rows = [
      makeBusiness({ id: 'b1', category: 'grocery' }),
      makeBusiness({ id: 'b2', category: 'restaurants' }),
      makeBusiness({ id: 'b3', category: 'gyms' }),
    ];
    const port: BusinessesApiPort = { search: vi.fn(async () => rows) };

    const points = await nearbyBusinessesDataset(port, { categories: ['grocery', 'gyms'] }).adapter.getPoints({}, BOUNDS);

    expect(points.map(p => p.id)).toEqual(['b1', 'b3']);
  });

  it('without opts.categories, all returned rows pass through unfiltered', async () => {
    const rows = [makeBusiness({ id: 'b1', category: 'grocery' }), makeBusiness({ id: 'b2', category: 'pharmacy' })];
    const port: BusinessesApiPort = { search: vi.fn(async () => rows) };

    const points = await nearbyBusinessesDataset(port).adapter.getPoints({}, BOUNDS);

    expect(points.map(p => p.id)).toEqual(['b1', 'b2']);
  });

  it('marker.iconUrl returns the per-category icon from opts.icons', () => {
    const port: BusinessesApiPort = { search: vi.fn() };
    const dataset = nearbyBusinessesDataset(port, { icons: { grocery: 'grocery.svg', gyms: 'gym.svg' } });

    expect(dataset.marker.iconUrl?.(makeBusiness({ category: 'grocery' }))).toBe('grocery.svg');
    expect(dataset.marker.iconUrl?.(makeBusiness({ category: 'gyms' }))).toBe('gym.svg');
  });

  it('marker.iconUrl falls back to "" (falsy, no custom icon) for a category with no configured icon', () => {
    const port: BusinessesApiPort = { search: vi.fn() };
    const dataset = nearbyBusinessesDataset(port, { icons: { grocery: 'grocery.svg' } });
    expect(dataset.marker.iconUrl?.(makeBusiness({ category: 'restaurants' }))).toBe('');
  });

  it('marker.onClick is wired from opts', () => {
    const port: BusinessesApiPort = { search: vi.fn() };
    const onClick = vi.fn();
    const entity = makeBusiness();

    nearbyBusinessesDataset(port, { onClick }).marker.onClick?.(entity);

    expect(onClick).toHaveBeenCalledWith(entity);
  });

  it('a business category NOT in KNOWN_BUSINESS_CATEGORIES flows through end-to-end (open taxonomy)', async () => {
    expect(KNOWN_BUSINESS_CATEGORIES).not.toContain('pharmacy');
    const pharmacy = makeBusiness({ id: 'b9', category: 'pharmacy' });
    const port: BusinessesApiPort = { search: vi.fn(async () => [pharmacy]) };

    const dataset = nearbyBusinessesDataset(port, { icons: { pharmacy: 'pharmacy.svg' } });
    const points = await dataset.adapter.getPoints({}, BOUNDS);

    expect(points).toEqual([{ id: 'b9', position: pharmacy.coordinates, entity: pharmacy }]);
    expect(dataset.marker.iconUrl?.(pharmacy)).toBe('pharmacy.svg');
  });

  it('adapter.list resolves to an empty page when the port does not implement list', async () => {
    const port: BusinessesApiPort = { search: vi.fn() };
    const result = await nearbyBusinessesDataset(port).adapter.list({}, { cursor: null, limit: 10 });
    expect(result).toEqual({ items: [], nextCursor: null });
  });

  it('adapter.list passes through to port.list when provided', async () => {
    const page: Page<BusinessEntity> = { items: [makeBusiness()], nextCursor: null };
    const list = vi.fn(async () => page);
    const port: BusinessesApiPort = { search: vi.fn(), list };
    const filters: BusinessFilters = {};
    const pageRequest: PageRequest = { cursor: null, limit: 10 };

    const result = await nearbyBusinessesDataset(port).adapter.list(filters, pageRequest);

    expect(list).toHaveBeenCalledWith(filters, pageRequest);
    expect(result).toBe(page);
  });

  it('sets clustering maxZoom to 15 and visible() true', () => {
    const port: BusinessesApiPort = { search: vi.fn() };
    const dataset = nearbyBusinessesDataset(port);
    expect(dataset.clustering).toEqual({ maxZoom: 15 });
    expect(dataset.visible?.()).toBe(true);
  });
});

// -----------------------------------------------------------------------------
// Heterogeneous coexistence in one DatasetRegistry (proves req #6: businesses
// is just a second dataset/marker layer, not special-cased core code)
// -----------------------------------------------------------------------------

describe('heterogeneous datasets in one DatasetRegistry', () => {
  it('propertiesDataset and nearbyBusinessesDataset coexist and both appear in list()', () => {
    const propertiesPort: PropertiesApiPort = { list: vi.fn(), search: vi.fn() };
    const businessesPort: BusinessesApiPort = { search: vi.fn() };

    const registry = new DatasetRegistry();
    registry.add(propertiesDataset(propertiesPort));
    registry.add(nearbyBusinessesDataset(businessesPort));

    expect(registry.list().map(d => d.id)).toEqual(['properties', 'businesses']);
  });
});
