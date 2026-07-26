import type { FilterDefinition } from '~/interfaces';

/**
 * Framework-free registry for `FilterDefinition`s: programmatic add / remove /
 * reorder / replace, plus folding raw control values into `TFilters`
 * (`toFilters`) and reporting which registered filters currently affect an
 * applied `TFilters` (`activeKeys`).
 *
 * Defs are stored by VALUE (shallow-cloned on `add`/`replace`), never by the
 * caller's original reference — `reorder()` rewrites `order` in place on the
 * registry's own copy. This is deliberate: the same `FilterDefinition` object
 * can legitimately be registered in more than one `FilterRegistry` instance
 * (e.g. two listing pages sharing a base filter set), and without cloning,
 * one registry's `reorder()` would silently mutate `.order` on the shared
 * object and bleed into every other registry (and the caller) holding it.
 */
export class FilterRegistry<TFilters> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private readonly defs = new Map<string, FilterDefinition<TFilters, any>>();

  add<TValue = unknown>(def: FilterDefinition<TFilters, TValue>): this {
    if (this.defs.has(def.key)) {
      throw new Error(`FilterRegistry: filter "${def.key}" is already registered`);
    }
    this.defs.set(def.key, { ...def });
    return this;
  }

  remove(key: string): this {
    this.defs.delete(key);
    return this;
  }

  // Stores under `key` regardless of `def.key`, correcting the clone's `.key`
  // to match — so the Map key and the stored def's `key` field can never
  // diverge (which would otherwise make `has(key)` true while `list()` /
  // `toFilters()` / `activeKeys()` / `remove()` read a different `def.key`).
  replace<TValue = unknown>(key: string, def: FilterDefinition<TFilters, TValue>): this {
    if (!this.defs.has(key)) {
      throw new Error(`FilterRegistry: cannot replace unregistered filter "${key}"`);
    }
    this.defs.set(key, { ...def, key });
    return this;
  }

  // Keys named in `keys` (that are actually registered) get order 0..k-1, in
  // the order given. Registered keys omitted from `keys` keep their prior
  // relative order and are appended after, starting at order k.
  reorder(keys: string[]): this {
    const previous = this.list();
    const listedKeys = keys.filter(key => this.defs.has(key));
    listedKeys.forEach((key, index) => {
      this.defs.get(key)!.order = index;
    });

    const listed = new Set(listedKeys);
    previous
      .filter(def => !listed.has(def.key))
      .forEach((def, index) => {
        def.order = listedKeys.length + index;
      });
    return this;
  }

  list(): FilterDefinition<TFilters>[] {
    return [...this.defs.values()].sort((a, b) => a.order - b.order);
  }

  has(key: string): boolean {
    return this.defs.has(key);
  }

  // Folds toParams(values[def.key]) for every registered def whose key is
  // present in `values` (in list()/order sequence, so a later-order filter
  // wins a key collision) into a single TFilters.
  toFilters(values: Record<string, unknown>): TFilters {
    const parts = this.list()
      .filter(def => Object.hasOwn(values, def.key))
      .map(def => def.toParams(values[def.key]));
    return parts.reduce<Partial<TFilters>>((acc, p) => ({ ...acc, ...p }), {}) as TFilters;
  }

  activeKeys(filters: TFilters): string[] {
    return this.list()
      .filter(def => def.isActive?.(filters))
      .map(def => def.key);
  }
}
