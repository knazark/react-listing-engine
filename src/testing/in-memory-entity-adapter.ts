import type { Bounds, EntityAdapter, EntityId, LatLng, MapPoint, Page, PageRequest } from '~/interfaces';

/**
 * In-memory `EntityAdapter` test double. `list()` filters `rows` through
 * `predicate` and paginates by array index: `cursor` is the (stringified)
 * index of the last row already served (`null` means start from the
 * beginning), and the returned `nextCursor` is that same kind of value for
 * the next call — `null` once nothing is left. `getPoints()` runs the same
 * predicate filter and projects each surviving row through `toLatLng`
 * (further narrowed to `bounds` when one is given). `idOf` defaults to
 * reading `row.id`, mirroring most real adapters, but can be overridden for
 * rows keyed by something else.
 */
export class InMemoryEntityAdapter<TEntity, TFilters> implements EntityAdapter<TEntity, TFilters> {
  constructor(
    private readonly rows: TEntity[],
    private readonly predicate: (row: TEntity, filters: TFilters) => boolean,
    private readonly toLatLng: (row: TEntity) => LatLng,
    private readonly idOf: (row: TEntity) => EntityId = row => (row as { id: EntityId }).id,
  ) {}

  async list(filters: TFilters, page: PageRequest): Promise<Page<TEntity>> {
    const filtered = this.rows.filter(row => this.predicate(row, filters));
    const start = page.cursor == null ? 0 : Number(page.cursor) + 1;
    const items = filtered.slice(start, start + page.limit);
    const lastServedIndex = start + items.length - 1;
    const hasMore = lastServedIndex + 1 < filtered.length;
    return { items, nextCursor: hasMore ? String(lastServedIndex) : null, total: filtered.length };
  }

  async getPoints(filters: TFilters, bounds?: Bounds): Promise<MapPoint<TEntity>[]> {
    const filtered = this.rows.filter(row => this.predicate(row, filters));
    const points = filtered.map(row => ({ id: this.idOf(row), position: this.toLatLng(row), entity: row }));
    if (!bounds) return points;
    return points.filter(point => this.isInBounds(point.position, bounds));
  }

  async getById(id: EntityId): Promise<TEntity> {
    const found = this.rows.find(row => this.idOf(row) === id);
    if (!found) {
      throw new Error(`InMemoryEntityAdapter: no row with id "${String(id)}"`);
    }
    return found;
  }

  private isInBounds(position: LatLng, bounds: Bounds): boolean {
    return (
      position.lat <= bounds.north &&
      position.lat >= bounds.south &&
      position.lng >= bounds.west &&
      position.lng <= bounds.east
    );
  }
}
