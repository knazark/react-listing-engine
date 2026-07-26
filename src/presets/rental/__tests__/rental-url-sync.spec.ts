import { describe, expect, it } from 'vitest';

import { MemoryHistoryPort, UrlSyncController } from '~/core';
import type { UrlSyncEngine } from '~/core';
import type { QueryParams } from '~/interfaces';

import type { RentalFilters } from '../rental-entity.interface';
import { rentalFiltersFromQuery, rentalFiltersToQuery, rentalUrlSync } from '../rental-url-sync';

// Minimal local fake standing in for `ListingEngine` -- same shape used by
// `src/__tests__/url-sync.spec.ts`'s `FakeEngine`, kept local here since
// that one isn't exported (it's a private test fixture, not part of the
// public API).
class FakeEngine implements UrlSyncEngine<RentalFilters> {
  private filters: RentalFilters;
  private readonly listeners = new Set<() => void>();

  constructor(initial: RentalFilters = {}) {
    this.filters = { ...initial };
  }

  get state(): { filters: RentalFilters } {
    return { filters: this.filters };
  }

  applyFilters(patch: Partial<RentalFilters>): void {
    this.filters = { ...this.filters, ...patch };
    this.notify();
  }

  subscribe(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }

  private notify(): void {
    for (const listener of [...this.listeners]) listener();
  }
}

describe('rentalFiltersToQuery', () => {
  it('serializes numeric range filters under their short keys', () => {
    const query = rentalFiltersToQuery({ minPrice: 1000, maxPrice: 3000, minBeds: 2, maxBeds: 4, minBaths: 1, maxBaths: 2 });

    expect(query).toEqual({
      minPrice: '1000',
      maxPrice: '3000',
      minBeds: '2',
      maxBeds: '4',
      minBaths: '1',
      maxBaths: '2',
    });
  });

  it('comma-joins propertyTypes under the "type" key', () => {
    expect(rentalFiltersToQuery({ propertyTypes: ['house', 'condo'] })).toEqual({ type: 'house,condo' });
  });

  it('maps keyword to "q"', () => {
    expect(rentalFiltersToQuery({ keyword: 'downtown loft' })).toEqual({ q: 'downtown loft' });
  });

  it('omits undefined/empty fields entirely rather than emitting undefined-valued keys', () => {
    const query = rentalFiltersToQuery({});

    expect(query).toEqual({});
    expect(Object.keys(query)).toHaveLength(0);
  });

  it('omits propertyTypes and keyword when empty', () => {
    expect(rentalFiltersToQuery({ propertyTypes: [], keyword: '' })).toEqual({});
  });

  it('never serializes bounds (map-driven, transient viewport state)', () => {
    const query = rentalFiltersToQuery({ bounds: { north: 1, south: 0, east: 1, west: 0 } });

    expect(query).toEqual({});
  });
});

describe('rentalFiltersFromQuery', () => {
  it('parses numeric range filters from their short keys', () => {
    const filters = rentalFiltersFromQuery({
      minPrice: '1000',
      maxPrice: '3000',
      minBeds: '2',
      maxBeds: '4',
      minBaths: '1',
      maxBaths: '2',
    });

    expect(filters).toEqual({ minPrice: 1000, maxPrice: 3000, minBeds: 2, maxBeds: 4, minBaths: 1, maxBaths: 2 });
  });

  it('splits "type" into a PropertyType[]', () => {
    expect(rentalFiltersFromQuery({ type: 'house,condo' })).toEqual({ propertyTypes: ['house', 'condo'] });
  });

  it('drops unrecognized property type values instead of propagating them', () => {
    expect(rentalFiltersFromQuery({ type: 'house,not-a-type,condo' })).toEqual({ propertyTypes: ['house', 'condo'] });
  });

  it('omits propertyTypes when every value in "type" is invalid', () => {
    expect(rentalFiltersFromQuery({ type: 'not-a-type' })).toEqual({});
  });

  it('maps "q" to keyword', () => {
    expect(rentalFiltersFromQuery({ q: 'downtown loft' })).toEqual({ keyword: 'downtown loft' });
  });

  it('is NaN-safe: an unparsable numeric value is omitted, not coerced to NaN', () => {
    expect(rentalFiltersFromQuery({ minPrice: 'not-a-number' })).toEqual({});
  });

  it('omits fields entirely for missing query keys', () => {
    const filters = rentalFiltersFromQuery({});

    expect(filters).toEqual({});
    expect(Object.keys(filters)).toHaveLength(0);
  });

  it('round-trips through rentalFiltersToQuery', () => {
    const original: RentalFilters = {
      minPrice: 1000,
      maxPrice: 3000,
      minBeds: 2,
      maxBeds: 4,
      minBaths: 1,
      maxBaths: 2,
      propertyTypes: ['house', 'townhouse'],
      keyword: 'pool',
    };

    const query: QueryParams = rentalFiltersToQuery(original);
    expect(rentalFiltersFromQuery(query)).toEqual(original);
  });
});

describe('rentalUrlSync', () => {
  it('returns a UrlSyncController wired to a MemoryHistoryPort, syncing engine -> history', () => {
    const history = new MemoryHistoryPort();
    const controller = rentalUrlSync({ history, hydrateOnStart: false });
    expect(controller).toBeInstanceOf(UrlSyncController);

    const engine = new FakeEngine();
    controller.start(engine);

    engine.applyFilters({ minPrice: 1000, propertyTypes: ['condo'] });

    expect(history.getQuery()).toEqual({ minPrice: '1000', type: 'condo' });

    controller.stop();
  });

  it('syncs history -> engine on external changes', () => {
    const history = new MemoryHistoryPort();
    const controller = rentalUrlSync({ history, hydrateOnStart: false });
    const engine = new FakeEngine();
    controller.start(engine);

    history.setQuery({ q: 'loft', minBeds: '2' });

    expect(engine.state.filters).toEqual({ keyword: 'loft', minBeds: 2 });

    controller.stop();
  });

  it('hydrates the engine from the initial history query on start by default', () => {
    const history = new MemoryHistoryPort({ q: 'garden' });
    const controller = rentalUrlSync({ history });
    const engine = new FakeEngine();

    controller.start(engine);

    expect(engine.state.filters).toEqual({ keyword: 'garden' });

    controller.stop();
  });

  it('stop() detaches both directions', () => {
    const history = new MemoryHistoryPort();
    const controller = rentalUrlSync({ history, hydrateOnStart: false });
    const engine = new FakeEngine();
    controller.start(engine);

    controller.stop();
    engine.applyFilters({ keyword: 'after-stop' });

    expect(history.getQuery()).toEqual({});
  });

  it('defaults to a BrowserHistoryPort when no history is supplied', () => {
    // Constructing without an explicit `history` exercises the
    // `new BrowserHistoryPort({ mode })` default path; happy-dom's `window`
    // makes this safe to construct (see browser-history-port.spec.ts).
    const controller = rentalUrlSync({ hydrateOnStart: false });

    expect(controller).toBeInstanceOf(UrlSyncController);
  });
});
