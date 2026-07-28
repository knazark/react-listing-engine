export type EntityId = string | number;

export interface Bounds { west: number; south: number; east: number; north: number; }

export interface LatLng { lat: number; lng: number; }

export interface PageRequest {
  cursor?: string | null;
  limit: number;
  /**
   * 0-based row offset for numbered/paged pagination (`ListingEngine#goToPage`
   * sends `pageIndex * pageSize`). Adapters backed by offset-capable APIs
   * honor it; cursor-only adapters may ignore it. When both `cursor` and
   * `offset` appear, `cursor` wins.
   */
  offset?: number;
}

export interface Page<T> { items: T[]; nextCursor: string | null; total?: number; }

export interface MapPoint<TEntity = unknown> {
  id: EntityId;
  position: LatLng;
  entity: TEntity;             // the raw row, so custom markers/popups can read anything
}

export type QueryParams = Record<string, string | undefined>;

export interface EntityAdapter<TEntity, TFilters> {
  list(filters: TFilters, page: PageRequest): Promise<Page<TEntity>>;
  getPoints(filters: TFilters, bounds: Bounds): Promise<MapPoint<TEntity>[]>;
  getById?(id: EntityId): Promise<TEntity>;
}
