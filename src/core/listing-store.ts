import type { Bounds, EntityId, MapPoint, Page, Unsubscribe } from '~/interfaces';
import { PaginationMode } from '~/enums';

export interface ListingState<TEntity, TFilters> {
  filters: TFilters;
  results: Page<TEntity>;
  bounds: Bounds | null;
  selection: EntityId | null;
  // Hovered marker id, kept separate from `selection` on purpose: hovering a
  // map marker/list row is a transient, non-committing interaction (e.g. a
  // highlight-on-hover affordance), while `selection` reflects an explicit
  // click via `selectPoint`. Additive, inert-by-default (`null` until
  // `setHovered` is called) — existing consumers that never call it see no
  // behavior change.
  hovered: EntityId | null;
  // `pageIndex` is the 0-based index of the currently-displayed page for
  // numbered (Paged-mode) pagination — written by `ListingEngine#goToPage`
  // and reset to 0 whenever a fresh filter query lands, so a filter change
  // always reads as "back on page 1". Inert in Infinite mode (never leaves 0).
  //
  // `loaded` is whether the results list has EVER been committed to — by a
  // completed query (setResults/appendResults) or by seeding the store with
  // server-rendered results. It is what lets a renderer tell "settled with
  // nothing" apart from "nothing has been asked yet": before it flips true,
  // an empty `results.items` is NOT a verified absence and must never render
  // as one (an unseeded boot otherwise claims "no results" before the first
  // query is even issued). Never reset — one commit means the emptiness of
  // any later state is a real answer.
  pagination: { mode: PaginationMode; loading: boolean; loaded: boolean; pageIndex: number };
  layers: Record<string, boolean>;
  // Per-dataset map points, populated by ListingEngine#loadPoints. Keyed by
  // DatasetDefinition.id, same key space as `layers`.
  points: Readonly<Record<string, ReadonlyArray<MapPoint<unknown>>>>;
}

export interface ListingStoreInit<TEntity, TFilters> {
  filters: TFilters;
  mode?: PaginationMode;
  /**
   * First page to start from, instead of the empty list a fetch would replace.
   *
   * Exists so a consumer that already has page one -- typically because it
   * rendered on a server -- can hand it over and have the FIRST render carry
   * real results. Without it the only way to fill the list is the adapter, and
   * an adapter call cannot happen during a server render.
   */
  results?: Page<TEntity>;
}

type Listener = () => void;

// Recursively maps every property (including array elements) to readonly, so
// a getState() consumer gets compile-time errors on nested writes too, not
// just top-level ones. Arrays become ReadonlyArray (no push/pop/splice/etc.),
// everything else that's an object gets its own properties marked readonly
// and recursed into; primitives/null pass through unchanged. Distributes over
// unions (e.g. `Bounds | null`) because T is a naked type parameter.
type DeepReadonly<T> = T extends (infer U)[]
  ? ReadonlyArray<DeepReadonly<U>>
  : T extends object
    ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
    : T;

export class ListingStore<TEntity, TFilters> {
  private state: ListingState<TEntity, TFilters>;
  private readonly listeners = new Set<Listener>();

  constructor(init: ListingStoreInit<TEntity, TFilters>) {
    this.state = this.freezeState({
      filters: { ...init.filters },
      results: init.results
        ? { items: [...init.results.items], nextCursor: init.results.nextCursor, total: init.results.total }
        : { items: [], nextCursor: null },
      bounds: null,
      selection: null,
      hovered: null,
      // Seeded results ARE a committed first page (a server already ran the
      // query), so a seeded store boots `loaded`.
      pagination: { mode: init.mode ?? PaginationMode.Paged, loading: false, loaded: init.results != null, pageIndex: 0 },
      layers: {},
      points: {},
    });
  }

  getState(): DeepReadonly<ListingState<TEntity, TFilters>> {
    // Runtime immutability comes from freezeState(); this cast just aligns
    // the compile-time type with that runtime guarantee (this.state itself
    // stays typed as the mutable ListingState for internal use).
    return this.state as DeepReadonly<ListingState<TEntity, TFilters>>;
  }

  setFilters(patch: Partial<TFilters>): void {
    this.setState({ filters: { ...this.state.filters, ...patch } });
  }

  setResults(page: Page<TEntity>): void {
    this.setState({
      results: { items: [...page.items], nextCursor: page.nextCursor, total: page.total },
      // Every commit path flips `loaded` here, at the chokepoint, rather than
      // in each engine query method — a commit IS the definition of loaded.
      pagination: { ...this.state.pagination, loaded: true },
    });
  }

  appendResults(page: Page<TEntity>): void {
    this.setState({
      results: {
        items: [...this.state.results.items, ...page.items],
        nextCursor: page.nextCursor,
        total: page.total,
      },
      pagination: { ...this.state.pagination, loaded: true },
    });
  }

  setBounds(bounds: Bounds | null): void {
    this.setState({ bounds: bounds ? { ...bounds } : null });
  }

  setSelection(id: EntityId | null): void {
    this.setState({ selection: id });
  }

  setHovered(id: EntityId | null): void {
    this.setState({ hovered: id });
  }

  setLayerVisible(id: string, visible: boolean): void {
    this.setState({ layers: { ...this.state.layers, [id]: visible } });
  }

  setLoading(loading: boolean): void {
    this.setState({ pagination: { ...this.state.pagination, loading } });
  }

  setPageIndex(index: number): void {
    this.setState({ pagination: { ...this.state.pagination, pageIndex: index } });
  }

  // Replaces the points array for a single dataset, leaving every other
  // dataset's points untouched. Defensively copies the given array (mirrors
  // setBounds's defensive copy of the caller-supplied object).
  setPoints(datasetId: string, points: MapPoint<unknown>[]): void {
    this.setState({ points: { ...this.state.points, [datasetId]: [...points] } });
  }

  subscribe(cb: Listener): Unsubscribe {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }

  private setState(patch: Partial<ListingState<TEntity, TFilters>>): void {
    this.state = this.freezeState({ ...this.state, ...patch });
    this.notify();
  }

  private notify(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }

  // Object.freeze() is shallow — freezing the top-level ListingState leaves
  // the nested containers (filters, results/results.items, bounds,
  // pagination, layers) mutable, so a caller holding a getState() snapshot
  // could mutate internal state without going through a mutator/notify().
  // Freeze each known nested container explicitly (shape is fixed, no need
  // for a generic/recursive deep-freeze). Callers must build fresh nested
  // objects before calling this — freezing does not clone.
  private freezeState(state: ListingState<TEntity, TFilters>): ListingState<TEntity, TFilters> {
    Object.freeze(state.filters);
    Object.freeze(state.results.items);
    Object.freeze(state.results);
    if (state.bounds) Object.freeze(state.bounds);
    Object.freeze(state.pagination);
    Object.freeze(state.layers);
    for (const points of Object.values(state.points)) Object.freeze(points);
    Object.freeze(state.points);
    return Object.freeze(state);
  }
}
