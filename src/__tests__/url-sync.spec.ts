import { describe, it, expect, vi } from 'vitest';
import { DatasetRegistry, ListingEngine } from '~/core';
import { MemoryHistoryPort } from '~/core/strategies/url-sync/memory-history-port';
import { UrlSyncController, type UrlSyncEngine } from '~/core/strategies/url-sync/url-sync.controller';
import type { EntityAdapter, QueryParams } from '~/interfaces';

interface Filters {
  q?: string;
}

// Minimal local fake standing in for `ListingEngine` — a filters object plus
// subscribe/applyFilters, exactly the surface `UrlSyncEngine` requires.
// Notifies synchronously (mirrors ListingEngine.applyFilters, whose
// store.setFilters()/notify() happen before any debounce timer fires), which
// is what lets the echo-guard tests assert bounded, synchronous call counts.
class FakeEngine<TFilters extends object> implements UrlSyncEngine<TFilters> {
  applyFiltersCallCount = 0;

  private filters: TFilters;
  private readonly listeners = new Set<() => void>();

  constructor(initial: TFilters) {
    this.filters = { ...initial };
  }

  get state(): { filters: TFilters } {
    return { filters: this.filters };
  }

  applyFilters(patch: Partial<TFilters>): void {
    this.applyFiltersCallCount++;
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

// Regression fixture for Fix 1 (see url-sync.controller.ts's class doc
// comment): mirrors the REAL `ListingEngine.applyFilters()`, which notifies
// twice — once synchronously (`store.setFilters()` -> `notify()`, same as
// `FakeEngine` above), and then AGAIN asynchronously after `await
// adapter.list(...)` resolves, once for `store.setResults()` and once for
// `store.setLoading(false)`. Neither async notify changes `filters` — they
// just mirror data/loading-state writes that happen to also go through the
// same store `notify()` fan-out `ListingEngine.subscribe()` exposes.
class AsyncNotifyFakeEngine<TFilters extends object> implements UrlSyncEngine<TFilters> {
  applyFiltersCallCount = 0;

  private filters: TFilters;
  private readonly listeners = new Set<() => void>();

  constructor(initial: TFilters) {
    this.filters = { ...initial };
  }

  get state(): { filters: TFilters } {
    return { filters: this.filters };
  }

  applyFilters(patch: Partial<TFilters>): Promise<void> {
    this.applyFiltersCallCount++;
    this.filters = { ...this.filters, ...patch };
    this.notify(); // synchronous notify, same as FakeEngine / ListingStore.setFilters()

    // Mirrors ListingEngine.runQuery(): after the awaited adapter call,
    // store.setResults() and store.setLoading(false) each notify again,
    // asynchronously — well after isSyncing has already been reset to
    // false by the withSyncGuard that kicked this call off.
    return Promise.resolve().then(() => {
      this.notify(); // store.setResults() notify tail
      this.notify(); // store.setLoading(false) notify tail
    });
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

function makeController(history: MemoryHistoryPort, opts: { hydrateOnStart?: boolean } = {}): UrlSyncController<Filters> {
  return new UrlSyncController<Filters>({
    history,
    toQuery: filters => ({ q: filters.q }),
    toFilters: (query: QueryParams) => ({ q: query.q }),
    hydrateOnStart: opts.hydrateOnStart,
  });
}

describe('MemoryHistoryPort', () => {
  it('getQuery returns a defensive copy, not the live internal object', () => {
    const history = new MemoryHistoryPort({ q: 'a' });
    const snapshot = history.getQuery();
    snapshot.q = 'mutated';
    expect(history.getQuery()).toEqual({ q: 'a' });
  });

  it('setQuery replaces the query and notifies subscribers', () => {
    const history = new MemoryHistoryPort();
    const cb = vi.fn();
    history.subscribe(cb);

    history.setQuery({ q: 'x' });

    expect(history.getQuery()).toEqual({ q: 'x' });
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('subscribe returns an unsubscribe that stops further notifications', () => {
    const history = new MemoryHistoryPort();
    const cb = vi.fn();
    const unsubscribe = history.subscribe(cb);
    unsubscribe();

    history.setQuery({ q: 'y' });

    expect(cb).not.toHaveBeenCalled();
  });
});

describe('UrlSyncController', () => {
  it('propagates an engine filter change to the history port via toQuery', () => {
    const history = new MemoryHistoryPort();
    const engine = new FakeEngine<Filters>({});
    const controller = makeController(history, { hydrateOnStart: false });

    controller.start(engine);
    engine.applyFilters({ q: 'from-engine' });

    expect(history.getQuery()).toEqual({ q: 'from-engine' });
    controller.stop();
  });

  it('propagates an external history change to the engine via toFilters', () => {
    const history = new MemoryHistoryPort();
    const engine = new FakeEngine<Filters>({});
    const controller = makeController(history, { hydrateOnStart: false });

    controller.start(engine);
    history.setQuery({ q: 'from-history' });

    expect(engine.state.filters).toEqual({ q: 'from-history' });
    controller.stop();
  });

  it('hydrates the engine from the current URL on start by default', () => {
    const history = new MemoryHistoryPort({ q: 'initial' });
    const engine = new FakeEngine<Filters>({});
    const controller = makeController(history);

    controller.start(engine);

    expect(engine.state.filters).toEqual({ q: 'initial' });
    controller.stop();
  });

  it('does not hydrate when hydrateOnStart is false', () => {
    const history = new MemoryHistoryPort({ q: 'initial' });
    const engine = new FakeEngine<Filters>({ q: 'default' });
    const controller = makeController(history, { hydrateOnStart: false });

    controller.start(engine);

    expect(engine.state.filters).toEqual({ q: 'default' });
    controller.stop();
  });

  it('does not bounce between engine and history — bounded call counts prove the echo guard', () => {
    const history = new MemoryHistoryPort();
    const engine = new FakeEngine<Filters>({});
    const setQuerySpy = vi.spyOn(history, 'setQuery');
    const controller = makeController(history, { hydrateOnStart: false });
    controller.start(engine);

    engine.applyFilters({ q: 'from-engine' });
    expect(setQuerySpy).toHaveBeenCalledTimes(1); // engine -> history, no bounce back into engine
    expect(engine.applyFiltersCallCount).toBe(1); // only the direct call above

    history.setQuery({ q: 'from-history' });
    expect(engine.applyFiltersCallCount).toBe(2); // +1 for history -> engine, no bounce back into history
    expect(setQuerySpy).toHaveBeenCalledTimes(2); // only the direct call above, no extra echo

    controller.stop();
  });

  it('hydrateOnStart applies the URL without bouncing it back to history', () => {
    const history = new MemoryHistoryPort({ q: 'initial' });
    const engine = new FakeEngine<Filters>({});
    const setQuerySpy = vi.spyOn(history, 'setQuery');
    const controller = makeController(history);

    controller.start(engine);

    expect(engine.state.filters).toEqual({ q: 'initial' });
    expect(setQuerySpy).not.toHaveBeenCalled();
    controller.stop();
  });

  it('stop() detaches both directions so further changes do not propagate', () => {
    const history = new MemoryHistoryPort();
    const engine = new FakeEngine<Filters>({});
    const controller = makeController(history, { hydrateOnStart: false });
    controller.start(engine);

    controller.stop();

    engine.applyFilters({ q: 'after-stop' });
    expect(history.getQuery()).toEqual({}); // engine -> history no longer wired

    history.setQuery({ q: 'external-after-stop' });
    expect(engine.state.filters).toEqual({ q: 'after-stop' }); // history -> engine no longer wired
  });

  it('stop() is idempotent — safe before start() and safe to call twice', () => {
    const history = new MemoryHistoryPort();
    const controller = makeController(history, { hydrateOnStart: false });

    expect(() => controller.stop()).not.toThrow(); // before start()

    const engine = new FakeEngine<Filters>({});
    controller.start(engine);
    controller.stop();

    expect(() => controller.stop()).not.toThrow(); // second stop()
  });

  // Regression for Fix 1: a real ListingEngine notifies again, ASYNCHRONOUSLY,
  // after runQuery's post-await setResults()/setLoading(false) — well after
  // isSyncing is back to false. Unguarded, that async tail would re-run
  // engine -> history sync and echo an identical (but spurious) setQuery on
  // every completed query, polluting a real BrowserHistoryPort with no-op
  // pushState calls. This test MUST fail without Fix 1 (the value-equality
  // guard in syncEngineToHistory) and pass with it — verified by temporarily
  // reverting syncEngineToHistory to the old unconditional write.
  it('does not echo a redundant history.setQuery from the engine\'s async notify tail (regression for Fix 1)', async () => {
    const history = new MemoryHistoryPort();
    const engine = new AsyncNotifyFakeEngine<Filters>({});
    const setQuerySpy = vi.spyOn(history, 'setQuery');
    const controller = makeController(history, { hydrateOnStart: false });
    controller.start(engine);

    // External history change -> applyFilters (synchronous half): guarded by
    // isSyncing exactly like the existing "does not bounce" test.
    history.setQuery({ q: 'from-history' });

    expect(engine.state.filters).toEqual({ q: 'from-history' });
    expect(engine.applyFiltersCallCount).toBe(1);
    expect(setQuerySpy).toHaveBeenCalledTimes(1); // only the direct call above

    // Let the engine's async notify tail run (mirrors runQuery's post-await
    // setResults()/setLoading(false) notifies) — filters are unchanged, so
    // the resulting query is identical to what history already holds.
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(setQuerySpy).toHaveBeenCalledTimes(1); // still 1 — async tail must not echo a redundant write
    controller.stop();
  });

  // Compile-time-only assertion (structural contract), also exercised at
  // runtime: a real ListingEngine instance is assignable to UrlSyncEngine<F>
  // without url-sync.controller.ts importing ListingEngine itself (that
  // import would cycle: engine -> ... -> strategies -> engine — see the
  // "Structural, not ListingEngine itself" comment on UrlSyncEngine). If
  // ListingEngine's public surface (subscribe/state/applyFilters) ever
  // drifts from UrlSyncEngine's structural contract, the assignment below
  // fails to compile.
  it('ListingEngine satisfies the UrlSyncEngine structural contract', () => {
    const adapter: EntityAdapter<{ id: number }, Filters> = {
      list: async () => ({ items: [], nextCursor: null }),
      getPoints: async () => [],
    };
    const datasets = new DatasetRegistry<unknown, Filters>();
    datasets.add({ id: 'x', adapter, marker: {} });
    const engine = new ListingEngine<{ id: number }, Filters>({ datasets, config: { debounceMs: 0 } });

    const asUrlSyncEngine: UrlSyncEngine<Filters> = engine;

    expect(typeof asUrlSyncEngine.subscribe).toBe('function');
    expect(typeof asUrlSyncEngine.applyFilters).toBe('function');
    expect(asUrlSyncEngine.state.filters).toEqual({});

    engine.dispose();
  });
});
