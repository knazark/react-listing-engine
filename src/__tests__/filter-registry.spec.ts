import { describe, it, expect } from 'vitest';
import { FilterRegistry } from '~/core/registries/filter-registry';
import type { FilterDefinition } from '~/interfaces';

type TestFilters = { q?: string; price?: number; inStock?: boolean };

it('add, replace, remove, reorder produce ordered list', () => {
  const reg = new FilterRegistry<{ q?: string; price?: number }>();
  reg.add({ key: 'q', order: 10, render: 'text', toParams: v => ({ q: v as string }), fromParams: f => f.q ?? '' })
     .add({ key: 'price', order: 20, render: 'range', toParams: v => ({ price: v as number }), fromParams: f => f.price ?? 0 });
  expect(reg.list().map(f => f.key)).toEqual(['q', 'price']);
  reg.reorder(['price', 'q']);
  expect(reg.list().map(f => f.key)).toEqual(['price', 'q']);
  reg.remove('q');
  expect(reg.list().map(f => f.key)).toEqual(['price']);
});

describe('FilterRegistry', () => {
  const qDef: FilterDefinition<TestFilters, string> = {
    key: 'q',
    order: 0,
    render: 'text',
    toParams: v => ({ q: v }),
    fromParams: f => f.q ?? '',
    isActive: f => !!f.q,
  };
  const priceDef: FilterDefinition<TestFilters, number> = {
    key: 'price',
    order: 1,
    render: 'range',
    toParams: v => ({ price: v }),
    fromParams: f => f.price ?? 0,
    isActive: f => f.price != null && f.price > 0,
  };
  const inStockDef: FilterDefinition<TestFilters, boolean> = {
    key: 'inStock',
    order: 2,
    render: 'toggle',
    toParams: v => ({ inStock: v }),
    fromParams: f => f.inStock ?? false,
    // no isActive — should never appear in activeKeys()
  };

  it('remove is a no-op when the key is absent', () => {
    const reg = new FilterRegistry<TestFilters>();
    expect(() => reg.remove('nope')).not.toThrow();
    expect(reg.list()).toEqual([]);
  });

  it('has() reflects registration state', () => {
    const reg = new FilterRegistry<TestFilters>();
    expect(reg.has('q')).toBe(false);
    reg.add(qDef);
    expect(reg.has('q')).toBe(true);
    reg.remove('q');
    expect(reg.has('q')).toBe(false);
  });

  it('add throws when the key is already registered', () => {
    const reg = new FilterRegistry<TestFilters>();
    reg.add(qDef);
    expect(() => reg.add({ ...qDef, order: 99 })).toThrow(/already registered/i);
  });

  it('replace throws when the key is not registered', () => {
    const reg = new FilterRegistry<TestFilters>();
    expect(() => reg.replace('q', qDef)).toThrow(/not registered|unregistered/i);
  });

  it('replace swaps the definition in place, keeping list() position stable', () => {
    const reg = new FilterRegistry<TestFilters>();
    reg.add(qDef).add(priceDef);
    const replacement: FilterDefinition<TestFilters, string> = { ...qDef, render: 'autocomplete' };
    reg.replace('q', replacement);
    expect(reg.list().map(f => f.key)).toEqual(['q', 'price']);
    expect(reg.list()[0].render).toBe('autocomplete');
  });

  it('reorder appends unlisted keys after listed ones, preserving their relative order', () => {
    const reg = new FilterRegistry<TestFilters>();
    reg.add(qDef).add(priceDef).add(inStockDef);
    reg.reorder(['inStock']);
    expect(reg.list().map(f => f.key)).toEqual(['inStock', 'q', 'price']);
    expect(reg.list().map(f => f.order)).toEqual([0, 1, 2]);
  });

  it('toFilters folds each registered def\'s toParams, skipping keys absent from values', () => {
    const reg = new FilterRegistry<TestFilters>();
    reg.add(qDef).add(priceDef).add(inStockDef);
    const result = reg.toFilters({ q: 'lofts', price: 500 });
    expect(result).toEqual({ q: 'lofts', price: 500 });
  });

  it('toFilters returns an empty object when no values match registered keys', () => {
    const reg = new FilterRegistry<TestFilters>();
    reg.add(qDef);
    expect(reg.toFilters({})).toEqual({});
  });

  it('activeKeys returns only keys whose isActive() is true, in list() order', () => {
    const reg = new FilterRegistry<TestFilters>();
    reg.add(qDef).add(priceDef).add(inStockDef);
    expect(reg.activeKeys({ q: 'lofts', price: 0, inStock: true })).toEqual(['q']);
    expect(reg.activeKeys({ q: '', price: 500, inStock: true })).toEqual(['price']);
  });

  it('activeKeys treats a missing isActive as never-active', () => {
    const reg = new FilterRegistry<TestFilters>();
    reg.add(inStockDef);
    expect(reg.activeKeys({ inStock: true })).toEqual([]);
  });

  it('replace normalizes a mismatched def.key to the Map key, keeping has()/list()/remove() consistent', () => {
    const reg = new FilterRegistry<TestFilters>();
    reg.add(qDef).add(priceDef);
    reg.replace('q', { ...qDef, key: 'renamed' });
    expect(reg.has('q')).toBe(true);
    expect(reg.has('renamed')).toBe(false);
    expect(reg.list()[0].key).toBe('q');
    reg.remove('q');
    expect(reg.has('q')).toBe(false);
    expect(reg.list().map(f => f.key)).toEqual(['price']);
  });

  it('stores defs by value: reorder on one registry never mutates a def shared with another registry or the caller', () => {
    const shared: FilterDefinition<TestFilters, string> = {
      key: 'q',
      order: 0,
      render: 'text',
      toParams: v => ({ q: v }),
      fromParams: f => f.q ?? '',
    };
    const regA = new FilterRegistry<TestFilters>();
    const regB = new FilterRegistry<TestFilters>();
    regA.add(shared).add(priceDef);
    regB.add(shared);

    regA.reorder(['price', 'q']);

    expect(regA.list().map(f => f.key)).toEqual(['price', 'q']);
    expect(regB.list().map(f => f.key)).toEqual(['q']);
    expect(regB.list()[0].order).toBe(0);
    expect(shared.order).toBe(0);

    shared.order = 999;
    expect(regA.list().find(f => f.key === 'q')?.order).not.toBe(999);
    expect(regB.list()[0].order).not.toBe(999);
  });

  it('toFilters folds multiple defs with later-order wins on key collision', () => {
    const reg = new FilterRegistry<TestFilters>();
    const firstQ: FilterDefinition<TestFilters, string> = {
      key: 'q',
      order: 0,
      render: 'text',
      toParams: () => ({ q: 'first', price: 1 }),
      fromParams: f => f.q ?? '',
    };
    const secondPrice: FilterDefinition<TestFilters, number> = {
      key: 'price',
      order: 1,
      render: 'range',
      toParams: () => ({ price: 2 }),
      fromParams: f => f.price ?? 0,
    };
    reg.add(firstQ).add(secondPrice);
    const result = reg.toFilters({ q: 'anything', price: 500 });
    expect(result).toEqual({ q: 'first', price: 2 });
  });
});
