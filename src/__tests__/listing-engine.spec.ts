import { describe, it, expect, vi } from 'vitest';
import { ListingEngine } from '~/core/listing-engine';
import { DatasetRegistry } from '~/core/registries/dataset-registry';
import { ListingEventType, PaginationMode } from '~/enums';
import type { Bounds, EntityAdapter, LatLng, Page, PageRequest } from '~/interfaces';

// Minimal local fake standing in for Task 15's `InMemoryEntityAdapter`. Filters
// a fixed row array with a predicate and maps rows to map points via a
// caller-supplied `toLatLng`. No pagination support needed by these tests
// beyond a fixed nextCursor (see the dedicated adapters below for cursor
// behavior in the loadPage tests).
class InMemoryEntityAdapter<TEntity extends { id: number }, TFilters> implements EntityAdapter<TEntity, TFilters> {
  constructor(
    private readonly rows: TEntity[],
    private readonly predicate: (row: TEntity, filters: TFilters) => boolean,
    private readonly toLatLng: (row: TEntity) => LatLng,
  ) {}

  async list(filters: TFilters, _page: PageRequest): Promise<Page<TEntity>> {
    return { items: this.rows.filter(row => this.predicate(row, filters)), nextCursor: null };
  }

  async getPoints(filters: TFilters, _bounds: Bounds) {
    return this.rows
      .filter(row => this.predicate(row, filters))
      .map(row => ({ id: row.id, position: this.toLatLng(row), entity: row }));
  }
}

describe('ListingEngine', () => {
  it('applyFilters debounces, queries the dataset adapter, and emits ResultsLoaded', async () => {
    const adapter = new InMemoryEntityAdapter<{ id: number; price: number }, { max?: number }>(
      [
        { id: 1, price: 5 },
        { id: 2, price: 50 },
      ],
      (row, f) => (f.max == null ? true : row.price <= f.max),
      row => ({ lat: 0, lng: row.id }),
    );
    const datasets = new DatasetRegistry<unknown, { max?: number }>();
    datasets.add({ id: 'x', adapter, marker: { iconUrl: () => '' } });
    const engine = new ListingEngine<{ id: number; price: number }, { max?: number }>({
      datasets,
      config: { debounceMs: 0, pageSize: 10 },
    });
    const loaded = vi.fn();
    engine.on(ListingEventType.ResultsLoaded, loaded);

    await engine.applyFilters({ max: 9 });

    expect(engine.state.results.items.map(r => r.id)).toEqual([1]);
    expect(loaded).toHaveBeenCalledOnce();
    engine.dispose();
  });

  it('applyFilters waits the configured debounceMs before querying', async () => {
    vi.useFakeTimers();
    try {
      const adapter = new InMemoryEntityAdapter<{ id: number; price: number }, { max?: number }>(
        [{ id: 1, price: 5 }],
        () => true,
        row => ({ lat: 0, lng: row.id }),
      );
      const datasets = new DatasetRegistry<unknown, { max?: number }>();
      datasets.add({ id: 'x', adapter, marker: { iconUrl: () => '' } });
      const engine = new ListingEngine<{ id: number; price: number }, { max?: number }>({
        datasets,
        config: { debounceMs: 50, pageSize: 10 },
      });

      const applied = engine.applyFilters({ max: 9 });
      expect(engine.state.filters).toEqual({ max: 9 }); // synchronous write, before the debounce fires
      expect(engine.state.results.items).toEqual([]); // query has not run yet

      await vi.advanceTimersByTimeAsync(50);
      await applied;

      expect(engine.state.results.items.map(r => r.id)).toEqual([1]);
      engine.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it('a debounced applyFilters call superseded by a newer one settles (does not hang) without ever querying', async () => {
    vi.useFakeTimers();
    try {
      const list = vi.fn(async () => ({ items: [{ id: 1 }], nextCursor: null }));
      const adapter: EntityAdapter<{ id: number }, { tag?: string }> = { list, getPoints: async () => [] };
      const datasets = new DatasetRegistry();
      datasets.add({ id: 'x', adapter, marker: {} });
      const engine = new ListingEngine({ datasets, config: { debounceMs: 50 } });

      const superseded = engine.applyFilters({ tag: 'first' });
      const winner = engine.applyFilters({ tag: 'second' }); // clears the first timer before it fires

      await vi.advanceTimersByTimeAsync(50);
      await Promise.all([superseded, winner]); // neither hangs

      expect(list).toHaveBeenCalledTimes(1); // the superseded call's query never ran
      expect(list).toHaveBeenCalledWith({ tag: 'second' }, { cursor: null, limit: 20 });
      engine.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it('dispose() during a pending debounce settles the in-flight applyFilters promise instead of leaving it hanging', async () => {
    vi.useFakeTimers();
    try {
      const adapter: EntityAdapter<{ id: number }, object> = {
        list: async () => ({ items: [], nextCursor: null }),
        getPoints: async () => [],
      };
      const datasets = new DatasetRegistry();
      datasets.add({ id: 'x', adapter, marker: {} });
      const engine = new ListingEngine({ datasets, config: { debounceMs: 50 } });

      const applied = engine.applyFilters({});
      engine.dispose();

      await applied; // must settle even though the debounce timer never fires
    } finally {
      vi.useRealTimers();
    }
  });

  it('emits FiltersChanged synchronously with the merged filters', () => {
    const adapter = new InMemoryEntityAdapter<{ id: number }, { max?: number }>(
      [{ id: 1 }],
      () => true,
      row => ({ lat: 0, lng: row.id }),
    );
    const datasets = new DatasetRegistry();
    datasets.add({ id: 'x', adapter, marker: {} });
    const engine = new ListingEngine({ datasets, config: { debounceMs: 50 } });
    const changed = vi.fn();
    engine.on(ListingEventType.FiltersChanged, changed);

    void engine.applyFilters({ max: 9 });

    expect(changed).toHaveBeenCalledWith({ type: 'FiltersChanged', filters: { max: 9 } });
    engine.dispose();
  });

  it('last-wins cancellation: a slow, superseded query never overwrites the newer result', async () => {
    let resolveFirst!: (page: Page<{ id: number }>) => void;
    const firstPromise = new Promise<Page<{ id: number }>>(resolve => {
      resolveFirst = resolve;
    });

    const adapter: EntityAdapter<{ id: number }, { tag?: string }> = {
      list: async filters => {
        if (filters.tag === 'first') return firstPromise;
        return { items: [{ id: 2 }], nextCursor: null };
      },
      getPoints: async () => [],
    };
    const datasets = new DatasetRegistry();
    datasets.add({ id: 'x', adapter, marker: {} });
    const engine = new ListingEngine({ datasets, config: { debounceMs: 0 } });

    const firstApply = engine.applyFilters({ tag: 'first' }); // starts, stalls on firstPromise
    const secondApply = engine.applyFilters({ tag: 'second' }); // starts immediately too, resolves fast

    await secondApply;
    expect(engine.state.results.items).toEqual([{ id: 2 }]);

    resolveFirst({ items: [{ id: 1 }], nextCursor: null }); // stale query resolves late
    await firstApply;

    expect(engine.state.results.items).toEqual([{ id: 2 }]); // unchanged by the stale response
    engine.dispose();
  });

  it('a stale debounced applyFilters run does not leave loading stuck true after an intervening loadPage completes (regression for Fix 1)', async () => {
    vi.useFakeTimers();
    try {
      const pages: Record<string, Page<{ id: number }>> = {
        first: { items: [{ id: 1 }], nextCursor: 'c1' },
        c1: { items: [{ id: 2 }], nextCursor: null },
        stale: { items: [{ id: 999 }], nextCursor: null },
      };
      const adapter: EntityAdapter<{ id: number }, { tag?: string }> = {
        // loadPage always requests by cursor, regardless of the current
        // filters (applyFilters commits filters synchronously, so by the
        // time loadPage's fetch fires, `filters.tag` is already 'stale' too
        // — cursor is what actually distinguishes a page fetch from a fresh
        // filter query).
        list: async (filters, page) => {
          if (page.cursor === 'c1') return pages.c1!;
          if (filters.tag === 'stale') return pages.stale!;
          return pages.first!;
        },
        getPoints: async () => [],
      };
      const datasets = new DatasetRegistry();
      datasets.add({ id: 'x', adapter, marker: {} });
      const engine = new ListingEngine({ datasets, config: { debounceMs: 50, pageSize: 1 } });

      // Prime a nextCursor so loadPage() below has something to page through.
      const primed = engine.applyFilters({});
      await vi.advanceTimersByTimeAsync(50);
      await primed;
      expect(engine.state.results.nextCursor).toBe('c1');

      // Start the race: a debounced applyFilters (token N) sits pending, its
      // timer not yet fired...
      const stale = engine.applyFilters({ tag: 'stale' });

      // ...then an intervening loadPage() (token N+1) runs and completes
      // first, correctly leaving loading=false.
      await engine.loadPage();
      expect(engine.state.pagination.loading).toBe(false);
      expect(engine.state.results.items).toEqual([{ id: 2 }]); // loadPage's (newest) results

      // Now let the stale debounce fire; runQuery(N) must bail before ever
      // touching loading, since queryToken has already moved on.
      await vi.advanceTimersByTimeAsync(50);
      await stale;

      expect(engine.state.pagination.loading).toBe(false); // not stuck true
      expect(engine.state.results.items).toEqual([{ id: 2 }]); // unchanged by the stale run
      engine.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it("applyFilters rejects when the primary adapter's list rejects (documents current behavior; graceful error-boundary handling is deferred to Task 13)", async () => {
    const boom = new Error('adapter boom');
    const adapter: EntityAdapter<{ id: number }, object> = {
      list: async () => {
        throw boom;
      },
      getPoints: async () => [],
    };
    const datasets = new DatasetRegistry();
    datasets.add({ id: 'x', adapter, marker: {} });
    const engine = new ListingEngine({ datasets, config: { debounceMs: 0 } });

    await expect(engine.applyFilters({})).rejects.toThrow('adapter boom');
    engine.dispose();
  });

  it('loadPoints queries getPoints for every visible dataset, stores per-dataset points, and emits BoundsChanged', async () => {
    const pointsA = [{ id: 1, position: { lat: 1, lng: 1 }, entity: { id: 1 } }];
    const pointsB = [{ id: 2, position: { lat: 2, lng: 2 }, entity: { id: 2 } }];
    const adapterA: EntityAdapter<{ id: number }, object> = {
      list: async () => ({ items: [], nextCursor: null }),
      getPoints: async () => pointsA,
    };
    const adapterB: EntityAdapter<{ id: number }, object> = {
      list: async () => ({ items: [], nextCursor: null }),
      getPoints: async () => pointsB,
    };
    const datasets = new DatasetRegistry();
    datasets.add({ id: 'a', adapter: adapterA, marker: {} });
    datasets.add({ id: 'b', adapter: adapterB, marker: {}, visible: () => false });
    const engine = new ListingEngine({ datasets, config: { debounceMs: 0 } });

    const onBoundsChanged = vi.fn();
    engine.on(ListingEventType.BoundsChanged, onBoundsChanged);

    const bounds: Bounds = { west: 0, south: 0, east: 1, north: 1 };
    await engine.loadPoints(bounds);

    expect(engine.state.bounds).toEqual(bounds);
    expect(engine.state.points.a).toEqual(pointsA);
    expect(engine.state.points.b ?? undefined).toBeUndefined(); // hidden dataset never queried
    expect(onBoundsChanged).toHaveBeenCalledWith({ type: 'BoundsChanged', bounds });
    engine.dispose();
  });

  it('loadPoints last-wins: a slow, superseded points fetch never overwrites a newer bounds\' points (regression for Fix 4)', async () => {
    let resolveFirst!: (points: Array<{ id: number; position: { lat: number; lng: number }; entity: { id: number } }>) => void;
    const firstPromise = new Promise<Array<{ id: number; position: { lat: number; lng: number }; entity: { id: number } }>>(
      resolve => {
        resolveFirst = resolve;
      },
    );
    let callCount = 0;
    const adapter: EntityAdapter<{ id: number }, object> = {
      list: async () => ({ items: [], nextCursor: null }),
      getPoints: async () => {
        callCount += 1;
        if (callCount === 1) return firstPromise; // stalls — the first (stale) call
        return [{ id: 2, position: { lat: 2, lng: 2 }, entity: { id: 2 } }]; // second call resolves fast
      },
    };
    const datasets = new DatasetRegistry();
    datasets.add({ id: 'a', adapter, marker: {} });
    const engine = new ListingEngine({ datasets, config: { debounceMs: 0 } });

    const firstLoad = engine.loadPoints({ west: 0, south: 0, east: 1, north: 1 }); // starts, stalls on firstPromise
    const secondLoad = engine.loadPoints({ west: 1, south: 1, east: 2, north: 2 }); // starts immediately too, resolves fast

    await secondLoad;
    expect(engine.state.points.a).toEqual([{ id: 2, position: { lat: 2, lng: 2 }, entity: { id: 2 } }]);

    resolveFirst([{ id: 1, position: { lat: 1, lng: 1 }, entity: { id: 1 } }]); // stale response resolves late
    await firstLoad;

    expect(engine.state.points.a).toEqual([{ id: 2, position: { lat: 2, lng: 2 }, entity: { id: 2 } }]); // unchanged by the stale response
    engine.dispose();
  });

  it('loadPoints isolates per-layer getPoints failures: a rejecting layer does not abort the other layer\'s point load and produces no unhandled rejection (regression for Fix 4)', async () => {
    const pointsB = [{ id: 2, position: { lat: 2, lng: 2 }, entity: { id: 2 } }];
    const adapterA: EntityAdapter<{ id: number }, object> = {
      list: async () => ({ items: [], nextCursor: null }),
      getPoints: async () => {
        throw new Error('layer A boom');
      },
    };
    const adapterB: EntityAdapter<{ id: number }, object> = {
      list: async () => ({ items: [], nextCursor: null }),
      getPoints: async () => pointsB,
    };
    const datasets = new DatasetRegistry();
    datasets.add({ id: 'a', adapter: adapterA, marker: {} });
    datasets.add({ id: 'b', adapter: adapterB, marker: {} });
    const engine = new ListingEngine({ datasets, config: { debounceMs: 0 } });

    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    try {
      await expect(engine.loadPoints({ west: 0, south: 0, east: 1, north: 1 })).resolves.toBeUndefined();
      // Give any unhandled rejection a turn of the event loop to surface.
      await new Promise(resolve => setTimeout(resolve, 0));
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off('unhandledRejection', unhandled);
    }

    expect(engine.state.points.b).toEqual(pointsB); // sibling layer still loaded despite layer A's rejection
    expect(engine.state.points.a ?? undefined).toBeUndefined(); // failed layer never wrote points
    engine.dispose();
  });

  it('toggleLayer flips a layer\'s visibility (defaulting to visible), emits LayerToggled, and a dataset wired to read it updates visibleIds', () => {
    const adapter: EntityAdapter<{ id: number }, object> = {
      list: async () => ({ items: [], nextCursor: null }),
      getPoints: async () => [],
    };
    const datasets = new DatasetRegistry();
    datasets.add({ id: 'a', adapter, marker: {}, visible: () => engine.state.layers.a !== false });
    const engine = new ListingEngine({ datasets, config: { debounceMs: 0 } });

    expect(datasets.visibleIds()).toEqual(['a']); // no explicit layers entry yet -> default visible

    const toggled = vi.fn();
    engine.on(ListingEventType.LayerToggled, toggled);
    engine.toggleLayer('a');

    expect(engine.state.layers.a).toBe(false);
    expect(datasets.visibleIds()).toEqual([]);
    expect(toggled).toHaveBeenCalledWith({ type: 'LayerToggled', datasetId: 'a', visible: false });

    engine.toggleLayer('a');
    expect(engine.state.layers.a).toBe(true);
    expect(datasets.visibleIds()).toEqual(['a']);
    engine.dispose();
  });

  it('selectPoint sets the selection and emits PointClicked when the point exists in that dataset\'s loaded points', async () => {
    const point = { id: 1, position: { lat: 1, lng: 1 }, entity: { id: 1, name: 'A' } };
    const adapter: EntityAdapter<{ id: number; name: string }, object> = {
      list: async () => ({ items: [], nextCursor: null }),
      getPoints: async () => [point],
    };
    const datasets = new DatasetRegistry();
    datasets.add({ id: 'a', adapter, marker: {} });
    const engine = new ListingEngine({ datasets, config: { debounceMs: 0 } });
    await engine.loadPoints({ west: 0, south: 0, east: 1, north: 1 });

    const clicked = vi.fn();
    engine.on(ListingEventType.PointClicked, clicked);
    engine.selectPoint('a', 1);

    expect(engine.state.selection).toBe(1);
    expect(clicked).toHaveBeenCalledWith({ type: 'PointClicked', datasetId: 'a', id: 1, entity: point.entity });
    engine.dispose();
  });

  it('selectPoint still sets the selection but does not emit PointClicked when the point is not loaded', () => {
    const adapter: EntityAdapter<{ id: number }, object> = {
      list: async () => ({ items: [], nextCursor: null }),
      getPoints: async () => [],
    };
    const datasets = new DatasetRegistry();
    datasets.add({ id: 'a', adapter, marker: {} });
    const engine = new ListingEngine({ datasets, config: { debounceMs: 0 } });

    const clicked = vi.fn();
    engine.on(ListingEventType.PointClicked, clicked);
    engine.selectPoint('a', 999);

    expect(engine.state.selection).toBe(999);
    expect(clicked).not.toHaveBeenCalled();
    engine.dispose();
  });

  it('selectPoint(datasetId, null) clears the selection and emits no PointClicked', async () => {
    const point = { id: 1, position: { lat: 1, lng: 1 }, entity: { id: 1 } };
    const adapter: EntityAdapter<{ id: number }, object> = {
      list: async () => ({ items: [], nextCursor: null }),
      getPoints: async () => [point],
    };
    const datasets = new DatasetRegistry();
    datasets.add({ id: 'a', adapter, marker: {} });
    const engine = new ListingEngine({ datasets, config: { debounceMs: 0 } });
    await engine.loadPoints({ west: 0, south: 0, east: 1, north: 1 });

    engine.selectPoint('a', 1);
    expect(engine.state.selection).toBe(1);

    const clicked = vi.fn();
    engine.on(ListingEventType.PointClicked, clicked);
    engine.selectPoint('a', null);

    expect(engine.state.selection).toBeNull();
    expect(clicked).not.toHaveBeenCalled();
    engine.dispose();
  });

  it('setHovered writes datasetId\'s hovered id to state.hovered without touching selection or emitting any event', () => {
    const adapter: EntityAdapter<{ id: number }, object> = {
      list: async () => ({ items: [], nextCursor: null }),
      getPoints: async () => [],
    };
    const datasets = new DatasetRegistry();
    datasets.add({ id: 'a', adapter, marker: {} });
    const engine = new ListingEngine({ datasets, config: { debounceMs: 0 } });

    const handler = vi.fn();
    engine.on('*', handler);

    engine.setHovered('a', 'x');
    expect(engine.state.hovered).toBe('x');
    expect(engine.state.selection).toBeNull();
    expect(handler).not.toHaveBeenCalled();

    engine.setHovered('a', null);
    expect(engine.state.hovered).toBeNull();
    expect(handler).not.toHaveBeenCalled();
    engine.dispose();
  });

  it('loadPage no-ops when there is no nextCursor', async () => {
    const list = vi.fn(async () => ({ items: [], nextCursor: null }));
    const adapter: EntityAdapter<{ id: number }, object> = { list, getPoints: async () => [] };
    const datasets = new DatasetRegistry();
    datasets.add({ id: 'a', adapter, marker: {} });
    const engine = new ListingEngine({ datasets, config: { debounceMs: 0 } });

    await engine.loadPage();

    expect(list).not.toHaveBeenCalled();
    engine.dispose();
  });

  it('loadPage appends results in infinite pagination mode using the previous nextCursor', async () => {
    const pages: Record<string, Page<{ id: number }>> = {
      first: { items: [{ id: 1 }, { id: 2 }], nextCursor: 'c1' },
      c1: { items: [{ id: 3 }], nextCursor: null },
    };
    const calls: PageRequest[] = [];
    const adapter: EntityAdapter<{ id: number }, object> = {
      list: async (_filters, page) => {
        calls.push(page);
        return pages[page.cursor ?? 'first']!;
      },
      getPoints: async () => [],
    };
    const datasets = new DatasetRegistry();
    datasets.add({ id: 'a', adapter, marker: {} });
    const engine = new ListingEngine({
      datasets,
      config: { debounceMs: 0, pageSize: 2, pagination: PaginationMode.Infinite },
    });

    await engine.applyFilters({});
    expect(engine.state.results.items).toEqual([{ id: 1 }, { id: 2 }]);
    expect(engine.state.results.nextCursor).toBe('c1');

    await engine.loadPage();

    expect(engine.state.results.items).toEqual([{ id: 1 }, { id: 2 }, { id: 3 }]);
    expect(engine.state.results.nextCursor).toBeNull();
    expect(calls).toEqual([
      { cursor: null, limit: 2 },
      { cursor: 'c1', limit: 2 },
    ]);
    engine.dispose();
  });

  it('loadPage replaces results wholesale in paged mode (default)', async () => {
    const pages: Record<string, Page<{ id: number }>> = {
      first: { items: [{ id: 1 }], nextCursor: 'c1' },
      c1: { items: [{ id: 2 }], nextCursor: null },
    };
    const adapter: EntityAdapter<{ id: number }, object> = {
      list: async (_filters, page) => pages[page.cursor ?? 'first']!,
      getPoints: async () => [],
    };
    const datasets = new DatasetRegistry();
    datasets.add({ id: 'a', adapter, marker: {} });
    const engine = new ListingEngine({ datasets, config: { debounceMs: 0, pageSize: 1 } });

    await engine.applyFilters({});
    expect(engine.state.results.items).toEqual([{ id: 1 }]);

    await engine.loadPage();
    expect(engine.state.results.items).toEqual([{ id: 2 }]); // replaced, not appended
    engine.dispose();
  });

  it('subscribe delegates to the store and unsubscribe stops notifications', async () => {
    const adapter: EntityAdapter<{ id: number }, object> = {
      list: async () => ({ items: [{ id: 1 }], nextCursor: null }),
      getPoints: async () => [],
    };
    const datasets = new DatasetRegistry();
    datasets.add({ id: 'a', adapter, marker: {} });
    const engine = new ListingEngine({ datasets, config: { debounceMs: 0 } });

    const cb = vi.fn();
    const unsubscribe = engine.subscribe(cb);
    await engine.applyFilters({});
    expect(cb).toHaveBeenCalled();

    unsubscribe();
    cb.mockClear();
    await engine.applyFilters({});
    expect(cb).not.toHaveBeenCalled();
    engine.dispose();
  });

  it('dispose clears listeners so events raised after dispose are not delivered', async () => {
    const adapter: EntityAdapter<{ id: number }, object> = {
      list: async () => ({ items: [], nextCursor: null }),
      getPoints: async () => [],
    };
    const datasets = new DatasetRegistry();
    datasets.add({ id: 'a', adapter, marker: {} });
    const engine = new ListingEngine({ datasets, config: { debounceMs: 0 } });

    const handler = vi.fn();
    engine.on('*', handler);
    engine.dispose();
    engine.toggleLayer('a');

    expect(handler).not.toHaveBeenCalled();
  });

  it('resolves primaryDatasetId to the first registered dataset by default, and honors an explicit override', async () => {
    const adapterX: EntityAdapter<{ id: number }, object> = {
      list: async () => ({ items: [{ id: 100 }], nextCursor: null }),
      getPoints: async () => [],
    };
    const adapterY: EntityAdapter<{ id: number }, object> = {
      list: async () => ({ items: [{ id: 200 }], nextCursor: null }),
      getPoints: async () => [],
    };
    const datasets = new DatasetRegistry();
    datasets.add({ id: 'x', adapter: adapterX, marker: {} });
    datasets.add({ id: 'y', adapter: adapterY, marker: {} });

    const defaultEngine = new ListingEngine({ datasets, config: { debounceMs: 0 } });
    await defaultEngine.applyFilters({});
    expect(defaultEngine.state.results.items).toEqual([{ id: 100 }]);
    defaultEngine.dispose();

    const overriddenEngine = new ListingEngine({ datasets, config: { debounceMs: 0 }, primaryDatasetId: 'y' });
    await overriddenEngine.applyFilters({});
    expect(overriddenEngine.state.results.items).toEqual([{ id: 200 }]);
    overriddenEngine.dispose();
  });
});
