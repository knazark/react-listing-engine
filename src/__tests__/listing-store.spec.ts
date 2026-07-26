import { describe, it, expect, vi } from 'vitest';
import { ListingStore } from '~/core/listing-store';
import { PaginationMode } from '~/enums';

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

describe('ListingStore', () => {
  it('seeds initial state per the spec (paged mode default, empty results)', () => {
    const store = new ListingStore<{ id: number }, { q?: string }>({ filters: { q: 'x' } });
    expect(store.getState()).toEqual({
      filters: { q: 'x' },
      results: { items: [], nextCursor: null },
      bounds: null,
      selection: null,
      pagination: { mode: PaginationMode.Paged, loading: false },
      layers: {},
      points: {},
    });
  });

  it('respects an explicit init mode', () => {
    const store = new ListingStore<{ id: number }, object>({ filters: {}, mode: PaginationMode.Infinite });
    expect(store.getState().pagination.mode).toBe(PaginationMode.Infinite);
  });

  it('setResults replaces the results page wholesale (paged mode)', () => {
    const store = new ListingStore<{ id: number }, object>({ filters: {} });
    store.setResults({ items: [{ id: 1 }, { id: 2 }], nextCursor: 'c1', total: 2 });
    expect(store.getState().results).toEqual({ items: [{ id: 1 }, { id: 2 }], nextCursor: 'c1', total: 2 });

    store.setResults({ items: [{ id: 3 }], nextCursor: null, total: 1 });
    expect(store.getState().results).toEqual({ items: [{ id: 3 }], nextCursor: null, total: 1 });
  });

  it('appendResults concatenates items and takes the newest cursor (infinite mode)', () => {
    const store = new ListingStore<{ id: number }, object>({ filters: {}, mode: PaginationMode.Infinite });
    store.appendResults({ items: [{ id: 1 }], nextCursor: 'c1' });
    store.appendResults({ items: [{ id: 2 }, { id: 3 }], nextCursor: 'c2' });
    expect(store.getState().results).toEqual({
      items: [{ id: 1 }, { id: 2 }, { id: 3 }],
      nextCursor: 'c2',
    });
  });

  it('setLayerVisible sets/updates a single layer flag without touching others', () => {
    const store = new ListingStore<{ id: number }, object>({ filters: {} });
    store.setLayerVisible('markers', true);
    store.setLayerVisible('clusters', false);
    expect(store.getState().layers).toEqual({ markers: true, clusters: false });

    store.setLayerVisible('markers', false);
    expect(store.getState().layers).toEqual({ markers: false, clusters: false });
  });

  it('setPoints replaces the points array for a single dataset without touching others, notifying once per call', () => {
    const store = new ListingStore<{ id: number }, object>({ filters: {} });
    const cb = vi.fn();
    store.subscribe(cb);

    const pointsA = [{ id: 1, position: { lat: 0, lng: 0 }, entity: { id: 1 } }];
    store.setPoints('a', pointsA);
    expect(cb).toHaveBeenCalledTimes(1);
    expect(store.getState().points).toEqual({ a: pointsA });

    const pointsB = [{ id: 2, position: { lat: 1, lng: 1 }, entity: { id: 2 } }];
    store.setPoints('b', pointsB);
    expect(cb).toHaveBeenCalledTimes(2);
    expect(store.getState().points).toEqual({ a: pointsA, b: pointsB });

    const pointsA2 = [{ id: 3, position: { lat: 2, lng: 2 }, entity: { id: 3 } }];
    store.setPoints('a', pointsA2);
    expect(store.getState().points).toEqual({ a: pointsA2, b: pointsB }); // 'b' untouched
  });

  it('setBounds, setSelection, and setLoading each notify once and update their slice', () => {
    const store = new ListingStore<{ id: number }, object>({ filters: {} });
    const cb = vi.fn();
    store.subscribe(cb);

    store.setBounds({ west: 1, south: 2, east: 3, north: 4 });
    store.setSelection(42);
    store.setLoading(true);

    expect(store.getState().bounds).toEqual({ west: 1, south: 2, east: 3, north: 4 });
    expect(store.getState().selection).toBe(42);
    expect(store.getState().pagination).toEqual({ mode: PaginationMode.Paged, loading: true });
    expect(cb).toHaveBeenCalledTimes(3);
  });

  it('getState returns an immutable snapshot: mutators produce a new object, old snapshots are frozen and unaffected', () => {
    const store = new ListingStore<{ id: number }, { q?: string }>({ filters: { q: 'a' } });
    const before = store.getState();
    expect(Object.isFrozen(before)).toBe(true);

    store.setFilters({ q: 'b' });
    const after = store.getState();

    expect(before).not.toBe(after);
    expect(before.filters).toEqual({ q: 'a' }); // old snapshot unaffected
    expect(after.filters).toEqual({ q: 'b' });
    expect(() => {
      // @ts-expect-error - verifying runtime immutability of a frozen snapshot
      after.selection = 999;
    }).toThrow();
  });
});

describe('ListingStore nested immutability (getState() must not expose a mutable reference)', () => {
  it('freezes layers: direct property mutation throws', () => {
    const store = new ListingStore<{ id: number }, object>({ filters: {} });
    store.setLayerVisible('markers', true);
    const state = store.getState();

    expect(Object.isFrozen(state.layers)).toBe(true);
    expect(() => {
      // @ts-expect-error - verifying runtime immutability of a frozen nested container
      state.layers.foo = true;
    }).toThrow();
  });

  it('freezes results and results.items: push throws', () => {
    const store = new ListingStore<{ id: number }, object>({ filters: {} });
    store.setResults({ items: [{ id: 1 }], nextCursor: null });
    const state = store.getState();

    expect(Object.isFrozen(state.results)).toBe(true);
    expect(Object.isFrozen(state.results.items)).toBe(true);
    expect(() => {
      // @ts-expect-error - getState()'s DeepReadonly type makes items a ReadonlyArray (no push); also verifies runtime immutability
      state.results.items.push({ id: 2 });
    }).toThrow();
  });

  it('freezes bounds: direct property mutation throws, and setBounds defensively copies the caller-supplied object', () => {
    const store = new ListingStore<{ id: number }, object>({ filters: {} });
    const original = { west: 1, south: 2, east: 3, north: 4 };
    store.setBounds(original);
    const state = store.getState();

    expect(Object.isFrozen(state.bounds)).toBe(true);
    expect(state.bounds).not.toBe(original); // defensive copy, not the caller's reference
    expect(() => {
      // @ts-expect-error - verifying runtime immutability of a frozen nested container
      state.bounds!.west = 999;
    }).toThrow();

    original.west = 42; // mutate the caller's own object after passing it in
    expect(state.bounds?.west).toBe(1); // store's copy is unaffected
    expect(Object.isFrozen(original)).toBe(false); // and the caller's object was never frozen as a side effect
  });

  it('constructor defensively copies the init filters object rather than aliasing it', () => {
    const original = { q: 'x' };
    const store = new ListingStore<{ id: number }, { q?: string }>({ filters: original });

    expect(store.getState().filters).not.toBe(original); // not the same reference
    expect(Object.isFrozen(original)).toBe(false); // caller's object was never frozen as a side effect

    original.q = 'mutated';
    expect(store.getState().filters.q).toBe('x'); // store's copy is unaffected by later mutation of the caller's object
  });

  it('freezes pagination: direct property mutation throws', () => {
    const store = new ListingStore<{ id: number }, object>({ filters: {} });
    const state = store.getState();

    expect(Object.isFrozen(state.pagination)).toBe(true);
    expect(() => {
      // @ts-expect-error - verifying runtime immutability of a frozen nested container
      state.pagination.loading = true;
    }).toThrow();
  });

  it('freezes filters: direct property mutation throws', () => {
    const store = new ListingStore<{ id: number }, { q?: string }>({ filters: { q: 'a' } });
    const state = store.getState();

    expect(Object.isFrozen(state.filters)).toBe(true);
    expect(() => {
      // @ts-expect-error - verifying runtime immutability of a frozen nested container
      state.filters.q = 'z';
    }).toThrow();
  });

  it('freezes points: the container and each per-dataset array are frozen; setPoints defensively copies the caller-supplied array', () => {
    const store = new ListingStore<{ id: number }, object>({ filters: {} });
    const original = [{ id: 1, position: { lat: 0, lng: 0 }, entity: { id: 1 } }];
    store.setPoints('a', original);
    const state = store.getState();

    expect(Object.isFrozen(state.points)).toBe(true);
    expect(Object.isFrozen(state.points.a)).toBe(true);
    expect(state.points.a).not.toBe(original); // defensive copy, not the caller's reference
    expect(() => {
      // @ts-expect-error - verifying runtime immutability of a frozen nested container
      state.points.a.push({ id: 2, position: { lat: 9, lng: 9 }, entity: { id: 2 } });
    }).toThrow();

    original.push({ id: 3, position: { lat: 9, lng: 9 }, entity: { id: 3 } });
    expect(state.points.a).toHaveLength(1); // store's copy is unaffected by later mutation of the caller's array
  });

  it('a previously-returned snapshot is unaffected by later mutators: each mutator produces fresh nested references', () => {
    const store = new ListingStore<{ id: number }, { q?: string }>({ filters: { q: 'a' } });
    store.setLayerVisible('markers', true);
    const before = store.getState();

    store.setFilters({ q: 'b' });
    store.setLayerVisible('markers', false);
    store.setResults({ items: [{ id: 9 }], nextCursor: null });
    store.setLoading(true);
    const after = store.getState();

    // New nested object references after each mutator that touched them.
    expect(after.filters).not.toBe(before.filters);
    expect(after.layers).not.toBe(before.layers);
    expect(after.results).not.toBe(before.results);
    expect(after.results.items).not.toBe(before.results.items);
    expect(after.pagination).not.toBe(before.pagination);

    // The old snapshot's nested containers are untouched by later mutator calls.
    expect(before.filters).toEqual({ q: 'a' });
    expect(before.layers).toEqual({ markers: true });
    expect(before.pagination).toEqual({ mode: PaginationMode.Paged, loading: false });
  });

  it('appendResults produces a fresh, independently-frozen items array rather than mutating the previous one', () => {
    const store = new ListingStore<{ id: number }, object>({ filters: {}, mode: PaginationMode.Infinite });
    store.appendResults({ items: [{ id: 1 }], nextCursor: 'c1' });
    const before = store.getState();

    store.appendResults({ items: [{ id: 2 }], nextCursor: 'c2' });
    const after = store.getState();

    expect(after.results.items).not.toBe(before.results.items);
    expect(Object.isFrozen(after.results.items)).toBe(true);
    expect(before.results.items).toEqual([{ id: 1 }]);
    expect(after.results.items).toEqual([{ id: 1 }, { id: 2 }]);
  });
});
