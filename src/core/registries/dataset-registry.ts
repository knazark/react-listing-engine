import type { DatasetDefinition } from '~/interfaces';

/**
 * Framework-free registry of `DatasetDefinition`s — each a marker layer
 * (adapter + marker renderer + optional clustering/visibility). Analogous to
 * `FilterRegistry`: defs are stored by VALUE (shallow-cloned on `add`), never
 * by the caller's original reference, so mutating the caller's object after
 * `add()` can't reach into the registry. Unlike `FilterRegistry`, there is no
 * `remove`/`replace`/`reorder` — datasets are a fixed set of layers wired up
 * once at listing-config time; `list()` order is simply insertion order via
 * the backing `Map`.
 *
 * `TEntity`/`TFilters` default to `unknown` because one registry instance
 * holds heterogeneous layers (e.g. a properties layer and a businesses layer
 * have different entity types) — the engine holds a single
 * `DatasetRegistry<unknown, TFilters>` across all of them.
 */
export class DatasetRegistry<TEntity = unknown, TFilters = unknown> {
  private readonly defs = new Map<string, DatasetDefinition<TEntity, TFilters>>();

  add(def: DatasetDefinition<TEntity, TFilters>): this {
    if (this.defs.has(def.id)) {
      throw new Error(`DatasetRegistry: dataset "${def.id}" is already registered`);
    }
    this.defs.set(def.id, { ...def });
    return this;
  }

  get(id: string): DatasetDefinition<TEntity, TFilters> | undefined {
    return this.defs.get(id);
  }

  has(id: string): boolean {
    return this.defs.has(id);
  }

  list(): DatasetDefinition<TEntity, TFilters>[] {
    return [...this.defs.values()];
  }

  // Default-visible: a dataset is visible unless it declares `visible` and
  // that function returns exactly `false`.
  visibleIds(): string[] {
    return this.list()
      .filter(def => def.visible?.() !== false)
      .map(def => def.id);
  }
}
