import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { StrictMode, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { composeListingProviders, withConfig, withDataset, withFilters, withMap } from '~/core';
import { FilterRegistry } from '~/core/registries/filter-registry';
import type { Bounds, FilterControlProps, LatLng, MapHandle, RenderedLayer, Unsubscribe } from '~/interfaces';
import { ListingComponentsProvider, ListingProvider } from '~/react';
import type { IListingCardProps } from '~/react';
import {
  ListingFilters,
  ListingList,
  ListingMap,
  ListingPagination,
  ListingResultHeader,
  ListingToolbar,
} from '~/react/components';
import { useListing } from '~/react/hooks';
import { FakeMapProvider, InMemoryEntityAdapter } from '~/testing';

interface Filters {
  max?: number;
}

interface Property {
  id: string;
  title: string;
  price: number;
  lat: number;
  lng: number;
}

const rows: Property[] = [
  { id: 'a', title: 'Loft A', price: 5, lat: 10, lng: 10 },
  { id: 'b', title: 'Loft B', price: 9, lat: 20, lng: 20 },
  { id: 'c', title: 'Loft C', price: 20, lat: 30, lng: 30 },
  { id: 'd', title: 'Loft D', price: 25, lat: 40, lng: 40 },
];

const predicate = (row: Property, filters: Filters): boolean => filters.max == null || row.price <= filters.max;
const toLatLng = (row: Property): LatLng => ({ lat: row.lat, lng: row.lng });

const TestCard = ({ item, selected, onSelect }: IListingCardProps) => {
  const property = item as Property;
  return (
    <div role="listitem" aria-current={selected ? 'true' : undefined} onClick={onSelect}>
      {property.title}
    </div>
  );
};

function makeProviderProps(opts?: { map?: FakeMapProvider; withFilterReg?: boolean }) {
  const adapter = new InMemoryEntityAdapter<Property, Filters>(rows, predicate, toLatLng);
  const mods = [
    withConfig<Filters>({ debounceMs: 0 }),
    withDataset<Property, Filters>({ id: 'p', adapter, marker: { iconUrl: p => `icon-${p.id}` } }),
  ];
  if (opts?.map) mods.push(withMap<Filters>(opts.map));
  if (opts?.withFilterReg) {
    mods.push(
      withFilters<Filters>(reg =>
        reg.add<number>({
          key: 'max',
          order: 0,
          render: ({ value, onChange }: FilterControlProps<number>) => (
            <input
              aria-label="max price"
              type="number"
              value={value ?? ''}
              onChange={e => onChange(Number(e.target.value))}
            />
          ),
          toParams: v => ({ max: v }),
          fromParams: f => f.max ?? 0,
        }),
      ),
    );
  }
  return composeListingProviders<Filters>(...mods);
}

function Wrapper({ children }: { children: ReactNode }) {
  const props = makeProviderProps();
  return (
    <ListingProvider {...props}>
      <ListingComponentsProvider Card={TestCard}>{children}</ListingComponentsProvider>
    </ListingProvider>
  );
}

afterEach(() => {
  cleanup();
});

describe('ListingList', () => {
  it('renders <Empty/> when there are no results yet', async () => {
    render(
      <Wrapper>
        <ListingList />
      </Wrapper>,
    );

    await waitFor(() => expect(screen.getByText('No results')).toBeInTheDocument());
    expect(screen.queryAllByRole('listitem')).toHaveLength(0);
  });

  it('renders one injected Card per result item, and toggles selected via onSelect', async () => {
    function FilterControls() {
      const engine = useListing();
      return <button onClick={() => void engine.applyFilters({ max: 25 })}>load</button>;
    }

    render(
      <Wrapper>
        <FilterControls />
        <ListingList />
      </Wrapper>,
    );

    fireEvent.click(screen.getByText('load'));
    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(4));

    expect(screen.getAllByRole('listitem').map(el => el.textContent)).toEqual([
      'Loft A',
      'Loft B',
      'Loft C',
      'Loft D',
    ]);

    // None selected initially.
    expect(screen.queryByText('Loft A')?.getAttribute('aria-current')).toBeNull();

    fireEvent.click(screen.getByText('Loft B'));
    await waitFor(() => expect(screen.getByText('Loft B').getAttribute('aria-current')).toBe('true'));
    expect(screen.getByText('Loft A').getAttribute('aria-current')).toBeNull();
  });
});

describe('ListingResultHeader', () => {
  it('shows the current item count and total from useListingResults()', async () => {
    function FilterControls() {
      const engine = useListing();
      return <button onClick={() => void engine.applyFilters({ max: 9 })}>load</button>;
    }

    render(
      <Wrapper>
        <FilterControls />
        <ListingResultHeader />
      </Wrapper>,
    );

    expect(screen.getByText('0 results')).toBeInTheDocument();

    fireEvent.click(screen.getByText('load'));
    await waitFor(() => expect(screen.getByText('2 results')).toBeInTheDocument());
  });
});

describe('ListingToolbar', () => {
  it('renders children inside the injected Toolbar', () => {
    render(
      <Wrapper>
        <ListingToolbar>
          <span>toolbar-content</span>
        </ListingToolbar>
      </Wrapper>,
    );

    expect(screen.getByText('toolbar-content')).toBeInTheDocument();
  });
});

describe('ListingPagination', () => {
  it('renders nothing when there is no nextCursor', async () => {
    function FilterControls() {
      const engine = useListing();
      return <button onClick={() => void engine.applyFilters({})}>load</button>;
    }

    render(
      <Wrapper>
        <FilterControls />
        <ListingPagination />
      </Wrapper>,
    );

    // No results loaded yet -> nextCursor is null -> no dangling button.
    expect(screen.queryByRole('button', { name: /load more/i })).not.toBeInTheDocument();

    // pageSize (20) > total rows (4), so nextCursor stays null after the load
    // too -> still nothing rendered.
    fireEvent.click(screen.getByText('load'));
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /load more/i })).not.toBeInTheDocument(),
    );
  });

  it('enables the button and calls engine.loadPage() when a nextCursor is present', async () => {
    let capturedEngine: ReturnType<typeof useListing> | null = null;

    function FilterControls() {
      const engine = useListing();
      capturedEngine = engine;
      return <button onClick={() => void engine.applyFilters({})}>load</button>;
    }

    const adapter = new InMemoryEntityAdapter<Property, Filters>(rows, predicate, toLatLng);
    const props = composeListingProviders<Filters>(
      withConfig<Filters>({ debounceMs: 0, pageSize: 1 }),
      withDataset<Property, Filters>({ id: 'p', adapter, marker: { iconUrl: () => '' } }),
    );

    render(
      <ListingProvider {...props}>
        <ListingComponentsProvider Card={TestCard}>
          <FilterControls />
          <ListingPagination />
        </ListingComponentsProvider>
      </ListingProvider>,
    );

    fireEvent.click(screen.getByText('load'));
    await waitFor(() => expect(screen.getByRole('button', { name: /load more/i })).toBeEnabled());

    const loadPageSpy = vi.spyOn(capturedEngine!, 'loadPage');

    fireEvent.click(screen.getByRole('button', { name: /load more/i }));
    await waitFor(() => expect(loadPageSpy).toHaveBeenCalledTimes(1));
  });
});

describe('ListingFilters', () => {
  it('renders one control per registered filter def, and its onChange applies the filter', async () => {
    const props = makeProviderProps({ withFilterReg: true });

    function LocalWrapper({ children }: { children: ReactNode }) {
      return (
        <ListingProvider {...props}>
          <ListingComponentsProvider Card={TestCard}>{children}</ListingComponentsProvider>
        </ListingProvider>
      );
    }

    render(
      <LocalWrapper>
        <ListingFilters />
        <ListingList />
      </LocalWrapper>,
    );

    const input = await screen.findByLabelText('max price');
    fireEvent.change(input, { target: { value: '9' } });

    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(2));
  });

  it('renders a placeholder for a named (string) filter control', async () => {
    const adapter = new InMemoryEntityAdapter<Property, Filters>(rows, predicate, toLatLng);
    const filters = new FilterRegistry<Filters>();
    filters.add({
      key: 'max',
      order: 0,
      render: 'range',
      toParams: v => ({ max: v as number }),
      fromParams: f => f.max ?? 0,
    });
    const props = composeListingProviders<Filters>(
      withConfig<Filters>({ debounceMs: 0 }),
      withDataset<Property, Filters>({ id: 'p', adapter, marker: { iconUrl: () => '' } }),
      withFilters<Filters>(reg => {
        for (const def of filters.list()) reg.add(def);
      }),
    );

    const { container } = render(
      <ListingProvider {...props}>
        <ListingFilters />
      </ListingProvider>,
    );

    await waitFor(() => expect(container.querySelector('[data-filter="max"]')).toBeInTheDocument());
  });
});

/**
 * Extends `FakeMapProvider` so `renderLayer()`'s returned `Unsubscribe`
 * throws if it is ever invoked AFTER `destroy()` already ran on this same
 * instance -- simulating a real map SDK adapter that throws when a
 * layer/listener is removed from a map handle that has already been torn
 * down. Used only by the cross-effect cleanup-ordering regression test
 * below: it stays silent under the correct (layers-unsub-before-destroy)
 * order and throws under the buggy (destroy-before-layers-unsub) order.
 */
class ThrowsOnUnsubAfterDestroy extends FakeMapProvider {
  private torndown = false;

  override destroy(handle: MapHandle): void {
    super.destroy(handle);
    this.torndown = true;
  }

  override renderLayer(handle: MapHandle, layer: RenderedLayer): Unsubscribe {
    const unsub = super.renderLayer(handle, layer);
    return () => {
      if (this.torndown) {
        throw new Error('renderLayer() unsubscribe called after provider.destroy() -- handle already torn down');
      }
      unsub();
    };
  }
}

describe('ListingMap', () => {
  function MapWrapper({ children, map }: { children: ReactNode; map: FakeMapProvider }) {
    const props = makeProviderProps({ map });
    return (
      <ListingProvider {...props}>
        <ListingComponentsProvider Card={TestCard}>{children}</ListingComponentsProvider>
      </ListingProvider>
    );
  }

  it('renders just the container when engine.map is undefined (no crash)', () => {
    const { container } = render(
      <Wrapper>
        <ListingMap />
      </Wrapper>,
    );

    expect(container.querySelector('div')).toBeInTheDocument();
  });

  it('renders the fallback, centered in the container, when engine.map is undefined', () => {
    render(
      <Wrapper>
        <ListingMap fallback={<span>No map configured</span>} />
      </Wrapper>,
    );

    expect(screen.getByText('No map configured')).toBeInTheDocument();
  });

  it('does NOT render the fallback once a MapProvider is configured', async () => {
    const map = new FakeMapProvider();

    render(
      <MapWrapper map={map}>
        <ListingMap fallback={<span>No map configured</span>} />
      </MapWrapper>,
    );

    await waitFor(() => expect(map.mounts.length).toBeGreaterThan(0));
    expect(screen.queryByText('No map configured')).not.toBeInTheDocument();
  });

  it('mounts the configured MapProvider on mount', async () => {
    const map = new FakeMapProvider();

    render(
      <MapWrapper map={map}>
        <ListingMap />
      </MapWrapper>,
    );

    await waitFor(() => expect(map.mounts.length).toBeGreaterThan(0));
  });

  it('unmount calls provider.destroy() on the mounted handle', async () => {
    const map = new FakeMapProvider();

    const { unmount } = render(
      <MapWrapper map={map}>
        <ListingMap />
      </MapWrapper>,
    );

    await waitFor(() => expect(map.mounts.length).toBeGreaterThan(0));
    const destroyedBefore = map.destroyCount;

    unmount();

    await waitFor(() => expect(map.destroyCount).toBeGreaterThan(destroyedBefore));
  });

  it('wires bounds changes: emitBounds() -> engine.loadPoints() -> adapter.getPoints() populates state.points', async () => {
    const map = new FakeMapProvider();

    function Probe() {
      const engine = useListing<Property, Filters>();
      (Probe as unknown as { engine?: typeof engine }).engine = engine;
      return null;
    }

    render(
      <MapWrapper map={map}>
        <ListingMap />
        <Probe />
      </MapWrapper>,
    );

    await waitFor(() => expect(map.mounts.length).toBeGreaterThan(0));

    const bounds: Bounds = { west: 0, south: 0, east: 50, north: 50 };
    act(() => {
      map.emitBounds(bounds);
    });

    await waitFor(() => {
      const engine = (Probe as unknown as { engine?: ReturnType<typeof useListing<Property, Filters>> }).engine;
      expect(engine?.state.points.p?.length).toBe(4);
    });
  });

  it('renders a layer with markers for each visible dataset once points are loaded, and re-renders when points change', async () => {
    const map = new FakeMapProvider();

    function Probe() {
      const engine = useListing<Property, Filters>();
      (Probe as unknown as { engine?: typeof engine }).engine = engine;
      return null;
    }

    render(
      <MapWrapper map={map}>
        <ListingMap />
        <Probe />
      </MapWrapper>,
    );

    await waitFor(() => expect(map.mounts.length).toBeGreaterThan(0));

    const engine = (Probe as unknown as { engine: ReturnType<typeof useListing<Property, Filters>> }).engine;

    await act(async () => {
      await engine.loadPoints({ west: 0, south: 0, east: 15, north: 15 });
    });

    await waitFor(() => {
      expect(map.renderedLayers.length).toBeGreaterThan(0);
    });
    const firstLayer = map.renderedLayers[map.renderedLayers.length - 1];
    expect(firstLayer.id).toBe('p');
    expect(firstLayer.markers).toEqual([{ id: 'a', position: { lat: 10, lng: 10 }, iconUrl: 'icon-a' }]);

    const renderCountBefore = map.renderedLayers.length;

    await act(async () => {
      await engine.loadPoints({ west: 0, south: 0, east: 25, north: 25 });
    });

    await waitFor(() => {
      const latest = map.renderedLayers[map.renderedLayers.length - 1];
      expect(latest.markers.length).toBe(2);
    });
    // Old layer subscription for the previous point set was torn down (unsub called on re-render).
    expect(map.removedLayers.length).toBeGreaterThan(0);
    expect(map.renderedLayers.length).toBeGreaterThanOrEqual(renderCountBefore);
  });

  it('includes dataset.marker.element in rendered layer markers when the dataset provides one', async () => {
    const map = new FakeMapProvider();
    const pillFor = (property: Property) => {
      const pill = document.createElement('div');
      pill.textContent = `$${property.price}`;
      return pill;
    };

    const adapter = new InMemoryEntityAdapter<Property, Filters>(rows, predicate, toLatLng);
    const props = composeListingProviders<Filters>(
      withConfig<Filters>({ debounceMs: 0 }),
      withDataset<Property, Filters>({ id: 'p', adapter, marker: { iconUrl: p => `icon-${p.id}`, element: pillFor } }),
      withMap<Filters>(map),
    );

    function Probe() {
      const engine = useListing<Property, Filters>();
      (Probe as unknown as { engine?: typeof engine }).engine = engine;
      return null;
    }

    render(
      <ListingProvider {...props}>
        <ListingComponentsProvider Card={TestCard}>
          <ListingMap />
          <Probe />
        </ListingComponentsProvider>
      </ListingProvider>,
    );

    await waitFor(() => expect(map.mounts.length).toBeGreaterThan(0));
    const engine = (Probe as unknown as { engine: ReturnType<typeof useListing<Property, Filters>> }).engine;

    await act(async () => {
      await engine.loadPoints({ west: 0, south: 0, east: 15, north: 15 });
    });

    await waitFor(() => expect(map.renderedLayers.length).toBeGreaterThan(0));
    const layer = map.renderedLayers[map.renderedLayers.length - 1];
    expect(layer.markers).toHaveLength(1);
    expect(layer.markers[0].element).toBeInstanceOf(HTMLElement);
    expect(layer.markers[0].element?.textContent).toBe('$5');
  });

  it('a dataset toggled invisible via toggleLayer is excluded from rendered layers', async () => {
    const map = new FakeMapProvider();

    function Probe() {
      const engine = useListing<Property, Filters>();
      (Probe as unknown as { engine?: typeof engine }).engine = engine;
      return null;
    }

    render(
      <MapWrapper map={map}>
        <ListingMap />
        <Probe />
      </MapWrapper>,
    );

    await waitFor(() => expect(map.mounts.length).toBeGreaterThan(0));
    const engine = (Probe as unknown as { engine: ReturnType<typeof useListing<Property, Filters>> }).engine;

    act(() => {
      engine.toggleLayer('p');
    });
    await act(async () => {
      await engine.loadPoints({ west: 0, south: 0, east: 50, north: 50 });
    });

    await waitFor(() => {
      expect(map.renderedLayers.find(layer => layer.id === 'p')).toBeUndefined();
    });
  });

  it('survives React Strict Mode mount/unmount/remount without leaking a live handle (async mount cancel-flag safety)', async () => {
    const map = new FakeMapProvider();
    const destroySpy = vi.spyOn(map, 'destroy');

    const { unmount } = render(
      <StrictMode>
        <MapWrapper map={map}>
          <ListingMap />
        </MapWrapper>
      </StrictMode>,
    );

    await waitFor(() => expect(map.mounts.length).toBeGreaterThanOrEqual(1));

    unmount();

    // Every handle that was ever mounted (including any StrictMode-discarded
    // one) must eventually be destroyed -- none leaks.
    await waitFor(() => expect(destroySpy.mock.calls.length).toBe(map.mounts.length));
  });

  it('unmount cleanup order: layer unsubscribes run BEFORE provider.destroy() (regression)', async () => {
    const map = new ThrowsOnUnsubAfterDestroy();

    function Probe() {
      const engine = useListing<Property, Filters>();
      (Probe as unknown as { engine?: typeof engine }).engine = engine;
      return null;
    }

    const { unmount } = render(
      <MapWrapper map={map}>
        <ListingMap />
        <Probe />
      </MapWrapper>,
    );

    await waitFor(() => expect(map.mounts.length).toBeGreaterThan(0));
    const engine = (Probe as unknown as { engine: ReturnType<typeof useListing<Property, Filters>> }).engine;

    // Load points so the layer effect actually renders a layer (and
    // registers an unsub) before we unmount.
    await act(async () => {
      await engine.loadPoints({ west: 0, south: 0, east: 50, north: 50 });
    });
    await waitFor(() => expect(map.renderedLayers.length).toBeGreaterThan(0));

    // If the layer effect's cleanup ran AFTER the mount effect's cleanup
    // (i.e. provider.destroy() already ran), ThrowsOnUnsubAfterDestroy's
    // renderLayer() unsub throws, and that exception propagates out of
    // React's commit phase through this unmount() call.
    expect(() => unmount()).not.toThrow();

    // Layer unsubs did run (not skipped), and destroy() did run too --
    // confirming both cleanups executed, just in the correct order.
    expect(map.removedLayers.length).toBeGreaterThan(0);
    expect(map.destroyCount).toBeGreaterThan(0);
  });

  // ---------------------------------------------------------------------
  // Auto-fit: the map frames its own data once, the first time there is
  // data to frame -- see `listing-map.tsx`'s "Auto-fit" doc comment
  // section. No explicit `engine.loadPoints()` call is needed in these
  // tests -- the mount effect's own one-time `WORLD_BOUNDS` load (`rows`
  // span lat/lng 10..40, well inside world bounds) is what feeds it.
  // ---------------------------------------------------------------------

  describe('auto-fit', () => {
    it('calls provider.fitBounds() once, with a bbox containing every point, once the initial points load resolves', async () => {
      const map = new FakeMapProvider();

      render(
        <MapWrapper map={map}>
          <ListingMap />
        </MapWrapper>,
      );

      await waitFor(() => expect(map.fitBoundsCalls.length).toBe(1));

      const bbox = map.fitBoundsCalls[0];
      for (const row of rows) {
        expect(row.lat).toBeGreaterThanOrEqual(bbox.south);
        expect(row.lat).toBeLessThanOrEqual(bbox.north);
        expect(row.lng).toBeGreaterThanOrEqual(bbox.west);
        expect(row.lng).toBeLessThanOrEqual(bbox.east);
      }
      // Regression guard: a tight box around the data (rows span 30
      // degrees), not the WORLD_BOUNDS box used for the initial load
      // itself (which spans ~170 degrees).
      expect(bbox.north - bbox.south).toBeLessThan(50);
      expect(bbox.east - bbox.west).toBeLessThan(50);
    });

    it('does not call provider.fitBounds() again on a subsequent (user) bounds change', async () => {
      const map = new FakeMapProvider();

      render(
        <MapWrapper map={map}>
          <ListingMap />
        </MapWrapper>,
      );

      await waitFor(() => expect(map.fitBoundsCalls.length).toBe(1));

      act(() => {
        map.emitBounds({ west: 0, south: 0, east: 15, north: 15 });
      });

      // Let the resulting engine.loadPoints() (fired by the simulated user
      // pan) settle and re-render the layer, proving the bounds change was
      // actually processed, before asserting fitBounds was not re-invoked.
      await waitFor(() => expect(map.renderedLayers.length).toBeGreaterThan(0));

      expect(map.fitBoundsCalls.length).toBe(1);
    });

    it('is skipped entirely when the caller supplies an explicit center', async () => {
      const map = new FakeMapProvider();

      render(
        <MapWrapper map={map}>
          <ListingMap center={{ lat: 37.76, lng: -122.44 }} />
        </MapWrapper>,
      );

      // Wait for proof the initial points load actually resolved (a
      // rendered layer) -- otherwise an empty `fitBoundsCalls` could just
      // mean auto-fit hasn't had a chance to run yet, not that it was
      // skipped.
      await waitFor(() => expect(map.renderedLayers.length).toBeGreaterThan(0));

      expect(map.fitBoundsCalls.length).toBe(0);
    });
  });
});
