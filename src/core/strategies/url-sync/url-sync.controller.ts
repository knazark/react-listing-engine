import type { QueryParams } from '~/interfaces';

import type { HistoryPort } from './history-port.interface';

// Structural, not `ListingEngine` itself — `src/core/strategies` must not
// import `ListingEngine` (would cycle: engine -> ... -> strategies ->
// engine). `ListingEngine<TEntity, TFilters>` satisfies this shape as-is;
// callers wire `UrlSyncController` on top of an already-constructed engine
// (see the "No UrlSyncController here on purpose" note on ListingEngine).
export interface UrlSyncEngine<TFilters> {
  subscribe(cb: () => void): () => void;
  readonly state: { readonly filters: TFilters };
  applyFilters(patch: Partial<TFilters>): Promise<void> | void;
}

export interface UrlSyncOptions<TFilters> {
  history: HistoryPort;
  toQuery(filters: TFilters): QueryParams;
  toFilters(query: QueryParams): Partial<TFilters>;
  // Apply the current URL query to the engine as soon as start() runs.
  // Default true.
  hydrateOnStart?: boolean;
}

// Shallow equality over the union of both objects' keys. `QueryParams` is a
// flat `Record<string, string | undefined>`, so a missing key and a key
// explicitly set to `undefined` already read back as the same `undefined`
// via plain property access — no extra normalization needed beyond that.
function queryParamsEqual(a: QueryParams, b: QueryParams): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) {
    if (a[key] !== b[key]) return false;
  }
  return true;
}

/**
 * Bidirectional, DOM-agnostic sync between an engine's `filters` and a
 * `HistoryPort`'s query params. Framework-free: talks to `UrlSyncEngine`
 * (a structural subset `ListingEngine` satisfies) and `HistoryPort`, nothing
 * else — no `window`, no React.
 *
 * OPTIONAL, not the primary path: `styled/listing-app.tsx`'s turnkey
 * `ListingApp` (the package's main-entry default) does NOT wire this up —
 * it uses an event-based URL API instead (`initialFilters` in,
 * `onFiltersChange` out; see that file's doc comment), so the library never
 * touches `window.history` by default. This class remains exported for
 * consumers who explicitly want the library to own history writes/reads
 * itself (e.g. via `/shadcn`'s `ListingApp.urlSync`, or wiring it directly
 * against a hand-built engine).
 *
 * Echo-loop guard: both subscriptions below are driven by the SAME
 * `isSyncing` flag. `ListingEngine.applyFilters()` and `MemoryHistoryPort`
 * (and any real browser HistoryPort) both notify their subscribers
 * SYNCHRONOUSLY as part of the write (`store.setFilters()` -> `notify()`
 * happens before any debounce timer, and `MemoryHistoryPort.setQuery()`
 * notifies before returning) — so when this controller initiates a write on
 * one side, the reciprocal subscription on the other side fires within the
 * very same call stack, before `isSyncing` is reset. Wrapping each
 * controller-initiated write in `isSyncing = true; ...; isSyncing = false`
 * (via try/finally, so a throwing `toQuery`/`toFilters`/notify can't leave it
 * stuck) means that reciprocal callback observes `isSyncing === true` and
 * short-circuits instead of writing back — one hop each direction, never a
 * cascade. `hydrateOnStart`'s initial engine write is wrapped the same way,
 * since it must not immediately echo the just-hydrated filters back out to
 * history as a redundant `setQuery`.
 *
 * `isSyncing` only covers that SYNCHRONOUS window, though — the real
 * `ListingEngine.applyFilters()` notifies AGAIN, asynchronously: after
 * `await adapter.list(...)` resolves, `store.setResults()` and
 * `store.setLoading(false)` each call `notify()`, well after `isSyncing` has
 * already been reset to `false` by the `withSyncGuard` that kicked the query
 * off. Left unguarded, that async tail would fire the engine subscription
 * below and echo an identical (but spurious) `history.setQuery(...)` on
 * every completed query. Rather than widening `isSyncing` to cover the whole
 * async query (which would also swallow legitimate concurrent history
 * changes that land mid-query), `syncEngineToHistory` is idempotent BY
 * VALUE instead: it computes the target query and skips the write entirely
 * when it already matches `history.getQuery()` — timing-independent, so it
 * suppresses the async-tail echo without touching `isSyncing` at all.
 */
export class UrlSyncController<TFilters> {
  private readonly history: HistoryPort;
  private readonly toQueryFn: (filters: TFilters) => QueryParams;
  private readonly toFiltersFn: (query: QueryParams) => Partial<TFilters>;
  private readonly hydrateOnStart: boolean;

  private isSyncing = false;
  private unsubscribeEngine: (() => void) | null = null;
  private unsubscribeHistory: (() => void) | null = null;

  constructor(opts: UrlSyncOptions<TFilters>) {
    this.history = opts.history;
    this.toQueryFn = opts.toQuery;
    this.toFiltersFn = opts.toFilters;
    this.hydrateOnStart = opts.hydrateOnStart ?? true;
  }

  start(engine: UrlSyncEngine<TFilters>): void {
    this.stop(); // idempotent: detach any previous wiring before rewiring

    this.unsubscribeEngine = engine.subscribe(() => {
      if (this.isSyncing) return; // this change originated from history -> engine; don't echo it back
      this.syncEngineToHistory(engine);
    });

    this.unsubscribeHistory = this.history.subscribe(() => {
      if (this.isSyncing) return; // this change originated from engine -> history; don't echo it back
      this.withSyncGuard(() => {
        this.applyFiltersSafely(engine, this.toFiltersFn(this.history.getQuery()));
      });
    });

    if (this.hydrateOnStart) {
      this.withSyncGuard(() => {
        this.applyFiltersSafely(engine, this.toFiltersFn(this.history.getQuery()));
      });
    }
  }

  stop(): void {
    this.unsubscribeEngine?.();
    this.unsubscribeEngine = null;
    this.unsubscribeHistory?.();
    this.unsubscribeHistory = null;
  }

  // Writes the engine's current filters out to history — but only when they
  // actually differ from what history already holds. This is what makes the
  // write safe to call from the engine's ASYNC notify tail (see the class
  // doc comment): by the time that tail fires, `isSyncing` is long since
  // back to `false`, so only a by-VALUE check can tell "real external engine
  // change" apart from "this engine's own query finishing."
  private syncEngineToHistory(engine: UrlSyncEngine<TFilters>): void {
    const next = this.toQueryFn(engine.state.filters);
    if (queryParamsEqual(next, this.history.getQuery())) return; // no-op: skip the echo
    this.withSyncGuard(() => this.history.setQuery(next));
  }

  // `applyFilters` can reject (adapter error) and these call sites are
  // fire-and-forget (`start()` never awaits, matching UrlSyncEngine's
  // `Promise<void> | void` return type) — an uncaught rejection there would
  // otherwise surface as an unhandled promise rejection. Swallowing it here
  // is a stopgap: graceful error handling (surfacing the failure to the
  // caller/UI) is deferred to Task 13's error-boundary work.
  private applyFiltersSafely(engine: UrlSyncEngine<TFilters>, patch: Partial<TFilters>): void {
    void Promise.resolve(engine.applyFilters(patch)).catch(() => {
      /* TODO(Task 13): surface via error boundary */
    });
  }

  private withSyncGuard(fn: () => void): void {
    this.isSyncing = true;
    try {
      fn();
    } finally {
      this.isSyncing = false;
    }
  }
}
