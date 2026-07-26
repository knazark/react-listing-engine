import { describe, it, expect } from 'vitest';
import { DatasetRegistry } from '~/core/registries/dataset-registry';
import type { DatasetDefinition, EntityAdapter, MarkerRenderer } from '~/interfaces';

type TestEntity = { id: string };
type TestFilters = { q?: string };

const adapter: EntityAdapter<TestEntity, TestFilters> = {
  list: async () => ({ items: [], nextCursor: null }),
  getPoints: async () => [],
};

const marker: MarkerRenderer<TestEntity> = {
  iconUrl: () => 'icon.svg',
};

function makeDef(id: string, overrides: Partial<DatasetDefinition<TestEntity, TestFilters>> = {}): DatasetDefinition<TestEntity, TestFilters> {
  return { id, adapter, marker, ...overrides };
}

it('add then list returns ids in insertion order', () => {
  const reg = new DatasetRegistry<TestEntity, TestFilters>();
  reg.add(makeDef('properties')).add(makeDef('businesses'));
  expect(reg.list().map(d => d.id)).toEqual(['properties', 'businesses']);
});

describe('DatasetRegistry', () => {
  it('add throws when the id is already registered', () => {
    const reg = new DatasetRegistry<TestEntity, TestFilters>();
    reg.add(makeDef('properties'));
    expect(() => reg.add(makeDef('properties'))).toThrow(/already registered/i);
  });

  it('get returns the registered def, or undefined when absent', () => {
    const reg = new DatasetRegistry<TestEntity, TestFilters>();
    const def = makeDef('properties');
    reg.add(def);
    expect(reg.get('properties')).toEqual(def);
    expect(reg.get('nope')).toBeUndefined();
  });

  it('has reflects registration state', () => {
    const reg = new DatasetRegistry<TestEntity, TestFilters>();
    expect(reg.has('properties')).toBe(false);
    reg.add(makeDef('properties'));
    expect(reg.has('properties')).toBe(true);
  });

  it('visibleIds excludes a dataset whose visible() returns false, includes one with no visible fn and one whose visible() returns true, preserving insertion order', () => {
    const reg = new DatasetRegistry<TestEntity, TestFilters>();
    reg
      .add(makeDef('hidden', { visible: () => false }))
      .add(makeDef('defaultVisible'))
      .add(makeDef('explicitlyVisible', { visible: () => true }));
    expect(reg.visibleIds()).toEqual(['defaultVisible', 'explicitlyVisible']);
  });

  it('stores a clone: mutating the caller\'s def object after add does not change the registry', () => {
    const reg = new DatasetRegistry<TestEntity, TestFilters>();
    const def = makeDef('properties');
    reg.add(def);
    def.id = 'mutated';
    (def as { clustering?: unknown }).clustering = { radius: 999 };
    expect(reg.get('properties')?.id).toBe('properties');
    expect(reg.get('properties')?.clustering).toBeUndefined();
    expect(reg.has('mutated')).toBe(false);
  });
});
