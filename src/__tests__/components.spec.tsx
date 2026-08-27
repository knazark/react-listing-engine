import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { StrictMode, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { composeListingProviders, withConfig, withDataset, withFilters, withMap } from '~/core';
import { FilterRegistry } from '~/core/registries/filter-registry';
import { PaginationMode } from '~/enums';
import type { Bounds, FilterControlProps, LatLng, MapHandle, Page, PageRequest, RenderedLayer, Unsubscribe } from '~/interfaces';
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
  it('renders <Loading/> before any query has committed -- an unasked list is not empty', async () => {
    render(
      <Wrapper>
        <ListingList />
      </Wrapper>,
    );

    // Nothing has queried yet (no filters applied, no bounds): the list must
    // NOT claim "no results" -- server-rendered, that claim reaches crawlers.
    await waitFor(() => expect(screen.getByText('Loading…')).toBeInTheDocument());
    expect(screen.queryByText('No results')).toBeNull();
    expect(screen.queryAllByRole('listitem')).toHaveLength(0);
  });

  it('renders <Empty/> only after a COMPLETED query with nothing in it', async () => {
    function FilterControls() {
      const engine = useListing();
      return <button onClick={() => void engine.applyFilters({ max: 1 })}>load</button>;
    }

    render(
      <Wrapper>
        <FilterControls />
        <ListingList />
      </Wrapper>,
    );

    // max=1 matches no fixture row (cheapest is 5): the query completes with
    // zero items, and only THEN is the empty state a verified answer.
    fireEvent.click(screen.getByText('load'));
    await waitFor(() => expect(screen.getByText('No results')).toBeInTheDocument());
    expect(screen.queryByText('Loading…')).toBeNull();
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
  /**
   * Renders `<ListingPagination>` (plus a "load" trigger for the initial
   * `applyFilters({})` query) against its own provider so each test controls
   * `pageSize` / `pagination` mode / row count, and hands the engine back
   * out for spying/driving.
   */
  function renderPagination(options?: {
    pageSize?: number;
    pagination?: PaginationMode;
    rows?: Property[];
    adapter?: InMemoryEntityAdapter<Property, Filters>;
  }) {
    let capturedEngine: ReturnType<typeof useListing> | null = null;

    function FilterControls() {
      const engine = useListing();
      capturedEngine = engine;
      return <button onClick={() => void engine.applyFilters({})}>load</button>;
    }

    const adapter =
      options?.adapter ?? new InMemoryEntityAdapter<Property, Filters>(options?.rows ?? rows, predicate, toLatLng);
    const props = composeListingProviders<Filters>(
      withConfig<Filters>({ debounceMs: 0, pageSize: options?.pageSize ?? 1, pagination: options?.pagination }),
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

    return { engine: () => capturedEngine! };
  }

  /** `rows` clones enumerated out to `count` entries — for multi-page fixtures. */
  function manyRows(count: number): Property[] {
    return Array.from({ length: count }, (_, i) => ({
      id: `row-${i + 1}`,
      title: `Loft ${i + 1}`,
      price: i + 1,
      lat: i,
      lng: i,
    }));
  }

  it('renders nothing in Paged mode when there is at most one page', async () => {
    renderPagination({ pageSize: 20 }); // 4 rows / pageSize 20 -> totalPages 1

    // No results loaded yet -> nothing to page through -> no dangling chrome.
    expect(screen.queryByRole('navigation', { name: 'Pagination' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByText('load'));
    await waitFor(() => expect(screen.queryByRole('navigation', { name: 'Pagination' })).not.toBeInTheDocument());
  });

  it('Paged mode with a known total renders prev/next plus one numbered button per page, the active page marked aria-current', async () => {
    renderPagination(); // 4 rows / pageSize 1 -> 4 pages

    fireEvent.click(screen.getByText('load'));
    await waitFor(() => expect(screen.getByRole('navigation', { name: 'Pagination' })).toBeInTheDocument());

    expect(screen.getAllByRole('button', { name: /^Page \d+$/ })).toHaveLength(4);
    const pageOne = screen.getByRole('button', { name: 'Page 1' });
    expect(pageOne).toHaveAttribute('aria-current', 'page');
    expect(pageOne).toHaveClass('rle-page-btn--active');
    expect(screen.getByRole('button', { name: 'Page 2' })).not.toHaveAttribute('aria-current');

    expect(screen.getByRole('button', { name: 'Previous page' })).toBeDisabled(); // on the first page
    expect(screen.getByRole('button', { name: 'Next page' })).toBeEnabled();
  });

  it('clicking a page button calls engine.goToPage with the 0-based index, and the active page follows', async () => {
    const { engine } = renderPagination();

    fireEvent.click(screen.getByText('load'));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Page 3' })).toBeEnabled());

    const goToPageSpy = vi.spyOn(engine(), 'goToPage');
    fireEvent.click(screen.getByRole('button', { name: 'Page 3' }));

    expect(goToPageSpy).toHaveBeenCalledWith(2);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Page 3' })).toHaveAttribute('aria-current', 'page'));
    // Landing mid-run enables prev; next stays enabled (page 3 of 4).
    expect(screen.getByRole('button', { name: 'Previous page' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Next page' })).toBeEnabled();
  });

  it('windows past 7 pages: first + last + a window around the current page, ellipses for the gaps', async () => {
    const { engine } = renderPagination({ rows: manyRows(15) }); // pageSize 1 -> 15 pages

    fireEvent.click(screen.getByText('load'));
    await waitFor(() => expect(screen.getByRole('navigation', { name: 'Pagination' })).toBeInTheDocument());

    // On page 1: [1] 2 … 15 — one trailing gap.
    expect(screen.getAllByRole('button', { name: /^Page \d+$/ })).toHaveLength(3);
    expect(screen.getByRole('button', { name: 'Page 1' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('button', { name: 'Page 2' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Page 15' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Page 8' })).not.toBeInTheDocument();
    expect(screen.getAllByText('…')).toHaveLength(1);

    // Jump mid-run: 1 … 7 [8] 9 … 15 — window around current, two gaps.
    await act(async () => {
      await engine().goToPage(7);
    });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Page 8' })).toHaveAttribute('aria-current', 'page'));
    expect(screen.getAllByRole('button', { name: /^Page \d+$/ })).toHaveLength(5); // 1, 7, 8, 9, 15
    expect(screen.getByRole('button', { name: 'Page 7' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Page 9' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Page 4' })).not.toBeInTheDocument();
    expect(screen.getAllByText('…')).toHaveLength(2);
  });

  it('Paged mode with an unknown total renders just prev/next, next disabled once a short page marks the end', async () => {
    // The in-memory adapter minus `total` (offset+cursor behavior intact) —
    // the "offset-capable API that doesn't report a count" shape the
    // unknown-total branch exists for.
    class NoTotalAdapter extends InMemoryEntityAdapter<Property, Filters> {
      override async list(filters: Filters, page: PageRequest): Promise<Page<Property>> {
        const { items, nextCursor } = await super.list(filters, page);
        return { items, nextCursor };
      }
    }
    const adapter = new NoTotalAdapter(rows, predicate, toLatLng);

    const { engine } = renderPagination({ pageSize: 3, adapter }); // 4 rows -> full page, then a short page

    fireEvent.click(screen.getByText('load'));
    await waitFor(() => expect(screen.getByRole('navigation', { name: 'Pagination' })).toBeInTheDocument());

    expect(screen.queryByRole('button', { name: /^Page \d+$/ })).not.toBeInTheDocument(); // no numbers without a total
    expect(screen.getByRole('button', { name: 'Previous page' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Next page' })).toBeEnabled(); // full page (3 of 3) -> may be more

    const goToPageSpy = vi.spyOn(engine(), 'goToPage');
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    expect(goToPageSpy).toHaveBeenCalledWith(1);

    // Page 2 returned 1 of 3 rows (short, no cursor) -> the end: next disabled, prev back enabled.
    await waitFor(() => expect(screen.getByRole('button', { name: 'Next page' })).toBeDisabled());
    expect(screen.getByRole('button', { name: 'Previous page' })).toBeEnabled();
  });

  it('Infinite mode still renders the "Load more" button, which calls engine.loadPage()', async () => {
    const { engine } = renderPagination({ pagination: PaginationMode.Infinite });

    // No results loaded yet -> nextCursor is null -> no dangling button.
    expect(screen.queryByRole('button', { name: /load more/i })).not.toBeInTheDocument();

    fireEvent.click(screen.getByText('load'));
    await waitFor(() => expect(screen.getByRole('button', { name: /load more/i })).toBeEnabled());
    expect(screen.queryByRole('navigation', { name: 'Pagination' })).not.toBeInTheDocument(); // no pager chrome

    const loadPageSpy = vi.spyOn(engine(), 'loadPage');
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

  it('in deferred mode (draft + onDraftChange given), a control reads its value from the draft and onChange buffers into onDraftChange instead of applying to the engine', async () => {
    const props = makeProviderProps({ withFilterReg: true });
    let capturedEngine: ReturnType<typeof useListing> | null = null;
    const onDraftChange = vi.fn();

    function Probe() {
      capturedEngine = useListing();
      return null;
    }

    render(
      <ListingProvider {...props}>
        <ListingComponentsProvider Card={TestCard}>
          <ListingFilters draft={{ max: 7 }} onDraftChange={onDraftChange} />
          <Probe />
        </ListingComponentsProvider>
      </ListingProvider>,
    );

    const input = (await screen.findByLabelText('max price')) as HTMLInputElement;
    // Reads from the DRAFT (7) -- the engine's own applied filters are still
    // unset (fromParams would read back `0`), so this proves the control is
    // NOT sourcing its value from `engine.filters`/live state.
    expect(input.value).toBe('7');

    const applySpy = vi.spyOn(capturedEngine!, 'applyFilters');
    fireEvent.change(input, { target: { value: '9' } });

    expect(onDraftChange).toHaveBeenCalledWith({ max: 9 });
    expect(applySpy).not.toHaveBeenCalled();
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

  it('repaints marker container classes via provider.updateMarkerStates on selection/hover, without re-rendering the marker layer', async () => {
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
      await engine.loadPoints({ west: 0, south: 0, east: 50, north: 50 });
    });
    await waitFor(() => expect(map.renderedLayers.length).toBeGreaterThan(0));
    const renderCountBefore = map.renderedLayers.length;

    act(() => {
      engine.selectPoint('p', 'b');
    });
    await waitFor(() => expect(map.markerStates).toEqual({ selected: 'b', hovered: null }));

    act(() => {
      engine.setHovered('p', 'a');
    });
    await waitFor(() => expect(map.markerStates).toEqual({ selected: 'b', hovered: 'a' }));

    // Selection/hover repaint must NEVER retrigger the layer-render effect (no marker DOM
    // recreation) -- the layer effect's deps deliberately exclude state.selection/state.hovered.
    expect(map.renderedLayers.length).toBe(renderCountBefore);
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
