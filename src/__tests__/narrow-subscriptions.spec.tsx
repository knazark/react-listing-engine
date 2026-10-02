import { act, cleanup, render, waitFor } from '@testing-library/react';
import { type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { composeListingProviders, withConfig, withDataset, withFilters } from '~/core';
import type { LatLng } from '~/interfaces';
import { ListingComponentsProvider, ListingFilters, ListingList, ListingProvider } from '~/react';
import { useListing, useListingFilters, useListingMap, useListingResults } from '~/react/hooks';
import { InMemoryEntityAdapter } from '~/testing';

interface Filters {
  max?: number;
}

interface Property {
  id: string;
  lat: number;
  lng: number;
  price: number;
}

const rows: Property[] = [
  { id: 'a', lat: 10, lng: 10, price: 5 },
  { id: 'b', lat: 20, lng: 20, price: 9 },
];

const predicate = (row: Property, filters: Filters): boolean => filters.max == null || row.price <= filters.max;
const toLatLng = (row: Property): LatLng => ({ lat: row.lat, lng: row.lng });

function Wrapper({ children }: { children: ReactNode }) {
  const props = composeListingProviders<Filters>(
    withConfig<Filters>({ debounceMs: 0 }),
    withDataset<Property, Filters>({
      adapter: new InMemoryEntityAdapter<Property, Filters>(rows, predicate, toLatLng),
      id: 'p',
      marker: { iconUrl: () => '' },
    }),
  );
  return <ListingProvider {...props}>{children}</ListingProvider>;
}

afterEach(() => {
  cleanup();
});

/**
 * The convenience hooks hand out one slice of the store each, so a component
 * that reads filters must not re-render because the map moved, and so on. A
 * map settle is a burst of unrelated writes (bounds, points per layer, loading
 * flags, results); a hook that re-rendered on all of them re-rendered the whole
 * page several times per settle.
 */
describe('convenience hooks subscribe to their own slice only', () => {
  async function mount() {
    const renders = { filters: vi.fn(), map: vi.fn(), results: vi.fn() };
    let engine: ReturnType<typeof useListing> | null = null;

    function Capture() {
      engine = useListing();
      return null;
    }
    function FiltersReader() {
      useListingFilters<Filters>();
      renders.filters();
      return null;
    }
    function ResultsReader() {
      useListingResults();
      renders.results();
      return null;
    }
    function MapReader() {
      useListingMap();
      renders.map();
      return null;
    }

    render(
      <Wrapper>
        <Capture />
        <FiltersReader />
        <ResultsReader />
        <MapReader />
      </Wrapper>,
    );
    await waitFor(() => expect(engine).not.toBeNull());
    // Let the mount-time list load settle before counting.
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 20));
    });
    for (const fn of Object.values(renders)) fn.mockClear();
    return { engine: engine!, renders };
  }

  it('a hover re-renders the map reader only', async () => {
    const { engine, renders } = await mount();

    act(() => engine.setHovered('p', 'a'));

    expect(renders.map).toHaveBeenCalledTimes(1);
    expect(renders.filters).not.toHaveBeenCalled();
    expect(renders.results).not.toHaveBeenCalled();
  });

  it('a selection re-renders none of them', async () => {
    const { engine, renders } = await mount();

    act(() => engine.selectPoint('p', 'a'));

    expect(renders.map).not.toHaveBeenCalled();
    expect(renders.filters).not.toHaveBeenCalled();
    expect(renders.results).not.toHaveBeenCalled();
  });

  it('a points load does not re-render the filters or results readers', async () => {
    const { engine, renders } = await mount();

    await act(async () => {
      await engine.loadPoints({ east: 50, north: 50, south: 0, west: 0 });
    });

    expect(renders.map).toHaveBeenCalled();
    expect(renders.filters).not.toHaveBeenCalled();
    expect(renders.results).not.toHaveBeenCalled();
  });
});

describe('a filters write re-renders only the controls it is about', () => {
  it('leaves a control alone when another key changes', async () => {
    interface Wide {
      max?: number;
      west?: number;
    }
    const controlRenders = vi.fn();
    let engine: ReturnType<typeof useListing<unknown, Wide>> | null = null;

    function Capture() {
      engine = useListing<unknown, Wide>();
      return null;
    }
    const props = composeListingProviders<Wide>(
      withConfig<Wide>({ debounceMs: 0 }),
      withDataset<Property, Wide>({
        adapter: new InMemoryEntityAdapter<Property, Wide>(rows, () => true, toLatLng),
        id: 'p',
        marker: { iconUrl: () => '' },
      }),
      withFilters<Wide>(reg =>
        reg.add<{ max: number | null }>({
          // A fresh object per call: equal by value, never by identity.
          fromParams: filters => ({ max: filters.max ?? null }),
          key: 'max',
          order: 0,
          render: ({ value }) => {
            controlRenders();
            return <span>{value.max ?? 'any'}</span>;
          },
          toParams: value => ({ max: value.max ?? undefined }),
        }),
      ),
    );

    const view = render(
      <ListingProvider {...props}>
        <Capture />
        <ListingFilters<Wide> />
      </ListingProvider>,
    );
    await waitFor(() => expect(engine).not.toBeNull());
    controlRenders.mockClear();

    await act(async () => {
      await engine!.applyFilters({ west: -97 });
    });
    expect(controlRenders).not.toHaveBeenCalled();

    await act(async () => {
      await engine!.applyFilters({ max: 7 });
    });
    expect(controlRenders).toHaveBeenCalled();
    expect(view.getByText('7')).toBeTruthy();
  });
});

describe('the results list exposes its loading state to CSS', () => {
  it('sets data-loading on the list while a refetch is in flight', async () => {
    let engine: ReturnType<typeof useListing> | null = null;
    function Capture() {
      engine = useListing();
      return null;
    }
    const view = render(
      <Wrapper>
        <Capture />
        <ListingList />
      </Wrapper>,
    );
    await act(async () => {
      await engine!.applyFilters({});
    });
    const list = view.getByRole('list');
    expect(list.hasAttribute('data-loading')).toBe(false);

    let pending: Promise<unknown> | null = null;
    act(() => {
      pending = engine!.applyFilters({});
    });
    expect(list.hasAttribute('data-loading')).toBe(true);

    await act(async () => {
      await pending;
    });
    expect(list.hasAttribute('data-loading')).toBe(false);
  });
});

describe('a refetch that returns the same items re-renders no card', () => {
  it('keeps every card untouched across an identical query', async () => {
    const cardRenders = vi.fn();
    let engine: ReturnType<typeof useListing> | null = null;
    function Capture() {
      engine = useListing();
      return null;
    }
    function Card({ item }: { item: unknown }) {
      cardRenders();
      return <div role="listitem">{(item as Property).id}</div>;
    }
    const view = render(
      <Wrapper>
        <ListingComponentsProvider Card={Card}>
          <Capture />
          <ListingList />
        </ListingComponentsProvider>
      </Wrapper>,
    );
    await act(async () => {
      await engine!.applyFilters({});
    });
    expect(view.getAllByRole('listitem')).toHaveLength(rows.length);
    cardRenders.mockClear();

    await act(async () => {
      await engine!.applyFilters({});
    });
    expect(cardRenders).not.toHaveBeenCalled();
  });
});

