import { describe, expect, it } from 'vitest';
import {
  composeListingProviders,
  withConfig,
  withDataset,
  withFilters,
  withInitialFilters,
  withMap,
  withPrimaryDataset,
  withUrlSync,
} from '~/core/compose-listing-providers';
import { DatasetRegistry, FilterRegistry } from '~/core/registries';
import { UrlSyncController, MemoryHistoryPort } from '~/core/strategies';
import type { EntityAdapter, MapProvider } from '~/interfaces';

type TestFilters = { q?: string; max?: number };

interface Property {
  id: string;
  kind: 'property';
}

interface Business {
  id: string;
  kind: 'business';
}

const fakeAdapter: EntityAdapter<Property, TestFilters> = {
  list: async () => ({ items: [], nextCursor: null }),
  getPoints: async () => [],
};

const businessAdapter: EntityAdapter<Business, TestFilters> = {
  list: async () => ({ items: [], nextCursor: null }),
  getPoints: async () => [],
};

// Brief's exact failing test (Step 1, RED), adapted to the single-TFilters
// contract this task actually implements (IListingProviderProps<TFilters>).
it('composes datasets and filters via mutators', () => {
  const props = composeListingProviders<TestFilters>(
    withConfig<TestFilters>({ pageSize: 24 }),
    withDataset<Property, TestFilters>({ id: 'p', adapter: fakeAdapter, marker: { iconUrl: () => '' } }),
    withFilters<TestFilters>(reg =>
      reg.add({ key: 'q', order: 1, render: 'text', toParams: v => ({ q: v as string }), fromParams: f => f.q }),
    ),
  );
  expect(props.config.pageSize).toBe(24);
  expect(props.datasets.list().map(d => d.id)).toEqual(['p']);
  expect(props.filters.list().map(f => f.key)).toEqual(['q']);
});

describe('composeListingProviders', () => {
  it('seeds empty defaults (config: {}, a fresh FilterRegistry, a fresh DatasetRegistry) when no mods are passed', () => {
    const props = composeListingProviders<TestFilters>();
    expect(props.config).toEqual({});
    expect(props.filters).toBeInstanceOf(FilterRegistry);
    expect(props.datasets).toBeInstanceOf(DatasetRegistry);
    expect(props.filters.list()).toEqual([]);
    expect(props.datasets.list()).toEqual([]);
    expect(props.map).toBeUndefined();
    expect(props.urlSync).toBeUndefined();
    expect(props.initialFilters).toBeUndefined();
    expect(props.primaryDatasetId).toBeUndefined();
  });

  it('withConfig merges options into props.config across multiple calls', () => {
    const props = composeListingProviders<TestFilters>(
      withConfig<TestFilters>({ pageSize: 24 }),
      withConfig<TestFilters>({ debounceMs: 0 }),
    );
    expect(props.config).toEqual({ pageSize: 24, debounceMs: 0 });
  });

  it('withDataset adds a dataset definition to props.datasets', () => {
    const props = composeListingProviders<TestFilters>(
      withDataset<Property, TestFilters>({ id: 'p', adapter: fakeAdapter, marker: { iconUrl: () => '' } }),
    );
    expect(props.datasets.list().map(d => d.id)).toEqual(['p']);
    expect(props.datasets.get('p')?.adapter).toBe(fakeAdapter);
  });

  it('composes two datasets of DIFFERENT entity types via withDataset — both land in datasets.list() (variance-critical)', () => {
    const props = composeListingProviders<TestFilters>(
      withDataset<Property, TestFilters>({ id: 'properties', adapter: fakeAdapter, marker: { iconUrl: p => p.kind } }),
      withDataset<Business, TestFilters>({ id: 'businesses', adapter: businessAdapter, marker: { iconUrl: b => b.kind } }),
    );
    expect(props.datasets.list().map(d => d.id)).toEqual(['properties', 'businesses']);
  });

  it('withFilters invokes the callback with props.filters, letting it mutate the registry', () => {
    const props = composeListingProviders<TestFilters>(
      withFilters<TestFilters>(reg =>
        reg.add({ key: 'q', order: 1, render: 'text', toParams: v => ({ q: v as string }), fromParams: f => f.q }),
      ),
      withFilters<TestFilters>(reg =>
        reg.add({ key: 'max', order: 2, render: 'range', toParams: v => ({ max: v as number }), fromParams: f => f.max }),
      ),
    );
    expect(props.filters.list().map(f => f.key)).toEqual(['q', 'max']);
  });

  it('withMap sets props.map', () => {
    const map: MapProvider = {
      mount: () => ({ raw: null }),
      renderLayer: () => () => {},
      onBoundsChange: () => () => {},
      onMapClick: () => () => {},
      fitBounds: () => {},
      destroy: () => {},
      updateMarkerStates: () => {},
      mountOverlay: () => ({ container: document.createElement('div'), setPosition: () => {}, unmount: () => {} }),
      zoomIn: () => {},
      zoomOut: () => {},
      toggleFullscreen: () => {},
    };
    const props = composeListingProviders<TestFilters>(withMap<TestFilters>(map));
    expect(props.map).toBe(map);
  });

  it('withUrlSync sets props.urlSync', () => {
    const controller = new UrlSyncController<TestFilters>({
      history: new MemoryHistoryPort(),
      toQuery: filters => ({ q: filters.q }),
      toFilters: query => ({ q: query.q }),
    });
    const props = composeListingProviders<TestFilters>(withUrlSync<TestFilters>(controller));
    expect(props.urlSync).toBe(controller);
  });

  it('withInitialFilters sets props.initialFilters', () => {
    const props = composeListingProviders<TestFilters>(withInitialFilters<TestFilters>({ q: 'lofts' }));
    expect(props.initialFilters).toEqual({ q: 'lofts' });
  });

  it('withPrimaryDataset sets props.primaryDatasetId', () => {
    const props = composeListingProviders<TestFilters>(withPrimaryDataset<TestFilters>('properties'));
    expect(props.primaryDatasetId).toBe('properties');
  });

  it('mod order is preserved: later withConfig/withDataset/withPrimaryDataset calls win', () => {
    const props = composeListingProviders<TestFilters>(
      withPrimaryDataset<TestFilters>('a'),
      withPrimaryDataset<TestFilters>('b'),
    );
    expect(props.primaryDatasetId).toBe('b');
  });
});
