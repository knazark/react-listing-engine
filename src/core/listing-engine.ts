import type { Bounds, EntityId, IListingConfigOptions, MapProvider, Page } from '~/interfaces';
import { ListingEventType, PaginationMode } from '~/enums';

import type { ListingEvent } from './events/listing-events';
import { TypedEmitter } from './events/typed-emitter';
import { ListingConfig } from './listing-config';
import { ListingStore } from './listing-store';
import { DatasetRegistry, FilterRegistry } from './registries';

// Parameterized by TFilters only, not TEntity: every field here is either
// TFilters-shaped or entity-erased (`DatasetRegistry<unknown, TFilters>` — see
// its docstring on why the registry itself never carries a concrete entity
// type). `ListingEngine<TEntity, TFilters>` still carries TEntity for its own
// state/event surface; callers who need it type-safe annotate the
// constructor explicitly: `new ListingEngine<TEntity, TFilters>(options)`.
export interface ListingEngineOptions<TFilters> {
  datasets: DatasetRegistry<unknown, TFilters>;
  filters?: FilterRegistry<TFilters>;
  config?: Partial<IListingConfigOptions>;
  map?: MapProvider;
  initialFilters?: TFilters;
  primaryDatasetId?: string;
}

/**
 * Pure-TS, React-free facade orchestrating `ListingStore` + `DatasetRegistry`
 * + `FilterRegistry` + `TypedEmitter` + `ListingConfig` (and, eventually, a
 * `MapProvider`). This is the object a React provider (Task 13) constructs
 * once and disposes on unmount; every mutation goes through here rather than
 * through the store directly, so store writes and event emissions never
 * drift apart.
 *
 * No `UrlSyncController` here on purpose — that's Task 9's strategy layer,
 * wired in on top of this engine, not inside it.
 *
 * `TEntity` cannot be inferred from the constructor — `ListingEngineOptions`
 * only carries an entity-erased `DatasetRegistry<unknown, TFilters>` (see
 * that interface's docstring) — so `TEntity` must be supplied explicitly
 * (`new ListingEngine<TEntity, TFilters>(options)`) whenever entity-level
 * typing is needed, e.g. reading `.state.results.items`.
 */
export class ListingEngine<TEntity, TFilters> {
  // Handed back out for consumers wired up alongside the engine (a filter
  // panel needs the FilterRegistry, a map component needs the MapProvider,
  // a map component ALSO needs the DatasetRegistry to look up each layer's
  // MarkerRenderer, and a results list needs to know which dataset its
  // items belong to in order to call `selectPoint(datasetId, id)`) — the
  // engine itself has no behavior that reads them beyond construction, so
  // they're plain public readonly properties rather than private fields
  // (which `noUnusedLocals` would flag as unused). `filters` defaults to an
  // empty `FilterRegistry` when the caller doesn't supply one, so consumers
  // (e.g. `ListingFilters`) can always call `engine.filters.list()` without
  // an undefined-check.
  public readonly filters: FilterRegistry<TFilters>;
  public readonly map?: MapProvider;
  public readonly datasets: DatasetRegistry<unknown, TFilters>;
  public readonly primaryDatasetId: string;

  private readonly store: ListingStore<TEntity, TFilters>;
  private readonly emitter = new TypedEmitter<ListingEvent<TEntity, TFilters>>();
  private readonly config: ListingConfig;

  // Debounce + last-wins cancellation state for applyFilters/loadPage. Every
  // query-triggering call takes the next token; a query only writes its
  // result to the store if its token is still current when it resolves, so a
  // slow, superseded request can never clobber a newer one. `debounceResolve`
  // settles a still-waiting applyFilters() promise when its timer gets
  // cleared before firing (a newer applyFilters(), or dispose()) — otherwise
  // that caller's `await applyFilters(...)` would hang forever, since the
  // query it was waiting on will now never run.
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private debounceResolve: (() => void) | null = null;
  private queryToken = 0;

  // Separate monotonic token for loadPoints — mirrors queryToken's last-wins
  // discipline but tracks bounds-driven point loads independently of
  // filter-driven list loads, since the two can race each other.
  private pointsToken = 0;

  constructor(options: ListingEngineOptions<TFilters>) {
    this.datasets = options.datasets;
    this.filters = options.filters ?? new FilterRegistry<TFilters>();
    this.map = options.map;
    this.config = new ListingConfig(options.config);

    const primaryDatasetId = options.primaryDatasetId ?? this.datasets.list()[0]?.id;
    if (primaryDatasetId == null || !this.datasets.has(primaryDatasetId)) {
      throw new Error(
        `ListingEngine: primary dataset "${primaryDatasetId ?? ''}" is not registered — pass a valid primaryDatasetId or register at least one dataset`,
      );
    }
    this.primaryDatasetId = primaryDatasetId;

    this.store = new ListingStore<TEntity, TFilters>({
      filters: options.initialFilters ?? ({} as TFilters),
      mode: this.config.options.pagination,
    });
  }

  get state() {
    return this.store.getState();
  }

  get options(): Readonly<IListingConfigOptions> {
    return this.config.options;
  }

  // Synchronously writes the filter patch and emits FiltersChanged, then
  // debounces the query (immediately when debounceMs is 0). The returned
  // promise resolves once that query settles.
  applyFilters(patch: Partial<TFilters>): Promise<void> {
    this.store.setFilters(patch);
    this.emitter.emit({ type: ListingEventType.FiltersChanged, filters: this.currentFilters() });

    this.clearDebounce();

    const token = ++this.queryToken;
    const debounceMs = this.config.options.debounceMs;

    if (debounceMs <= 0) {
      return this.runQuery(token);
    }

    return new Promise<void>(resolve => {
      this.debounceResolve = resolve;
      this.debounceTimer = setTimeout(() => {
        this.debounceTimer = null;
        this.debounceResolve = null;
        resolve(this.runQuery(token));
      }, debounceMs);
    });
  }

  async loadPage(): Promise<void> {
    const nextCursor = this.state.results.nextCursor;
    if (nextCursor === null) return;

    const token = ++this.queryToken;
    const primary = this.primaryDataset();
    this.store.setLoading(true);
    try {
      const page = await primary.adapter.list(this.currentFilters(), {
        cursor: nextCursor,
        limit: this.config.options.pageSize,
      });
      if (token !== this.queryToken) return; // superseded — last-wins

      if (this.config.options.pagination === PaginationMode.Infinite) {
        this.store.appendResults(page as Page<TEntity>);
      } else {
        this.store.setResults(page as Page<TEntity>);
      }
      this.emitter.emit({
        type: ListingEventType.ResultsLoaded,
        datasetId: this.primaryDatasetId,
        count: page.items.length,
      });
    } finally {
      if (token === this.queryToken) this.store.setLoading(false);
    }
  }

  async loadPoints(bounds: Bounds): Promise<void> {
    this.store.setBounds(bounds);
    this.emitter.emit({ type: ListingEventType.BoundsChanged, bounds });

    const filters = this.currentFilters();
    const token = ++this.pointsToken;

    // Promise.allSettled (not Promise.all): one layer's getPoints rejecting
    // must not abort the others' point loads, and must not produce an
    // unhandled rejection. A rejected layer simply doesn't update its
    // points — surfacing that error to the caller is a future enhancement,
    // consistent with the rest of the engine's current error handling.
    await Promise.allSettled(
      this.datasets.visibleIds().map(async id => {
        const def = this.datasets.get(id);
        if (!def) return;
        const points = await def.adapter.getPoints(filters, bounds);
        if (token !== this.pointsToken) return; // superseded — last-wins
        this.store.setPoints(id, points);
      }),
    );
  }

  // `id: EntityId | null` — passing `null` clears the selection (no match is
  // ever found for `null`, so PointClicked simply never emits in that case;
  // no separate early-return branch needed).
  selectPoint(datasetId: string, id: EntityId | null): void {
    this.store.setSelection(id);
    const match = this.state.points[datasetId]?.find(point => point.id === id);
    if (match) {
      this.emitter.emit({
        type: ListingEventType.PointClicked,
        datasetId,
        id: match.id, // narrows to EntityId (non-null) -- `id` itself stays `EntityId | null` for the null-clears-selection case
        entity: match.entity as TEntity,
      });
    }
  }

  // Sets the hovered marker id, mirroring `selectPoint`'s dataset-scoped
  // signature for API symmetry (later tasks may key hover state per dataset)
  // -- but hover is a transient highlight, not a commit, so unlike
  // `selectPoint` it never emits an event and never inspects the dataset's
  // loaded points, leaving `datasetId` unused for now (`_`-prefixed per this
  // repo's convention for intentionally-unused parameters).
  setHovered(_datasetId: string, id: EntityId | null): void {
    this.store.setHovered(id);
  }

  toggleLayer(id: string): void {
    const currentlyVisible = this.state.layers[id] ?? true;
    const next = !currentlyVisible;
    this.store.setLayerVisible(id, next);
    this.emitter.emit({ type: ListingEventType.LayerToggled, datasetId: id, visible: next });
  }

  subscribe(cb: () => void): () => void {
    return this.store.subscribe(cb);
  }

  on(type: ListingEvent<TEntity, TFilters>['type'] | '*', cb: (e: ListingEvent<TEntity, TFilters>) => void): () => void {
    return this.emitter.on(type, cb);
  }

  dispose(): void {
    this.clearDebounce();
    this.emitter.dispose();
  }

  private async runQuery(token: number): Promise<void> {
    // Freshness guard BEFORE touching loading or the network: a debounced
    // call can still be in flight (waiting on setTimeout) when a newer
    // query (another applyFilters or a loadPage) already bumped queryToken
    // and settled with loading=false. Without this early bail, a stale
    // runQuery would unconditionally flip loading=true here, then skip its
    // own setLoading(false) in the finally block below (guarded by the same
    // token check) once it discovers it's stale — leaving loading stuck
    // true with nothing actually in flight.
    if (token !== this.queryToken) return;

    const primary = this.primaryDataset();
    this.store.setLoading(true);
    try {
      const page = await primary.adapter.list(this.currentFilters(), {
        cursor: null,
        limit: this.config.options.pageSize,
      });
      if (token !== this.queryToken) return; // superseded — last-wins

      this.store.setResults(page as Page<TEntity>);
      this.emitter.emit({
        type: ListingEventType.ResultsLoaded,
        datasetId: this.primaryDatasetId,
        count: page.items.length,
      });
    } finally {
      if (token === this.queryToken) this.store.setLoading(false);
    }
  }

  private primaryDataset() {
    // Non-null: validated in the constructor, and DatasetRegistry has no
    // remove/replace, so the entry can't disappear afterward.
    return this.datasets.get(this.primaryDatasetId)!;
  }

  private currentFilters(): TFilters {
    return this.store.getState().filters as TFilters;
  }

  // Cancels a pending debounce timer, if any, and settles the promise that
  // was waiting on it (see the field comment on `debounceResolve`) so a
  // superseded applyFilters() call never hangs forever.
  private clearDebounce(): void {
    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    if (this.debounceResolve !== null) {
      this.debounceResolve();
      this.debounceResolve = null;
    }
  }
}
