import { cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { act, type ReactNode, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { composeListingProviders, ListingEngine, withConfig, withDataset, withMap } from '~/core';
import type { Bounds, LatLng } from '~/interfaces';
import { ListingEventType } from '~/enums';
import { ListingProvider } from '~/react';
import { ListingMap } from '~/react/components';
import {
  useListing,
  useListingEvent,
  useListingFilters,
  useListingLayer,
  useListingMap,
  useListingResults,
  useListingState,
} from '~/react/hooks';
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

function makeProviderProps() {
  const adapter = new InMemoryEntityAdapter<Property, Filters>(rows, predicate, toLatLng);
  return composeListingProviders<Filters>(
    // Zero debounce so applyFilters' query settles without fake timers.
    withConfig<Filters>({ debounceMs: 0 }),
    withDataset<Property, Filters>({ id: 'p', adapter, marker: { iconUrl: () => '' } }),
  );
}

function Wrapper({ children }: { children: ReactNode }) {
  const props = makeProviderProps();
  return <ListingProvider {...props}>{children}</ListingProvider>;
}

afterEach(() => {
  cleanup();
});

describe('InMemoryEntityAdapter', () => {
  it('list() filters by predicate and paginates by cursor (index of the last item served)', async () => {
    const adapter = new InMemoryEntityAdapter<Property, Filters>(rows, predicate, toLatLng);

    const page1 = await adapter.list({ max: 25 }, { cursor: null, limit: 2 });
    expect(page1.items.map(r => r.id)).toEqual(['a', 'b']);
    expect(page1.total).toBe(4);
    expect(page1.nextCursor).toBe('1');

    const page2 = await adapter.list({ max: 25 }, { cursor: page1.nextCursor, limit: 2 });
    expect(page2.items.map(r => r.id)).toEqual(['c', 'd']);
    expect(page2.nextCursor).toBeNull();
  });

  it('list() excludes rows the predicate rejects and reports nextCursor=null when nothing remains', async () => {
    const adapter = new InMemoryEntityAdapter<Property, Filters>(rows, predicate, toLatLng);
    const page = await adapter.list({ max: 9 }, { cursor: null, limit: 10 });
    expect(page.items.map(r => r.id)).toEqual(['a', 'b']);
    expect(page.nextCursor).toBeNull();
    expect(page.total).toBe(2);
  });

  it('getPoints() maps filtered rows to MapPoints via toLatLng and the default id-based idOf', async () => {
    const adapter = new InMemoryEntityAdapter<Property, Filters>(rows, predicate, toLatLng);
    const points = await adapter.getPoints({ max: 20 });
    expect(points).toEqual([
      { id: 'a', position: { lat: 10, lng: 10 }, entity: rows[0] },
      { id: 'b', position: { lat: 20, lng: 20 }, entity: rows[1] },
      { id: 'c', position: { lat: 30, lng: 30 }, entity: rows[2] },
    ]);
  });

  it('getPoints() further restricts to points inside bounds when bounds are given', async () => {
    const adapter = new InMemoryEntityAdapter<Property, Filters>(rows, predicate, toLatLng);
    const points = await adapter.getPoints({}, { west: 15, south: 15, east: 35, north: 35 });
    expect(points.map(p => p.id)).toEqual(['b', 'c']);
  });

  it('getById() resolves the matching row and rejects when no row matches', async () => {
    const adapter = new InMemoryEntityAdapter<Property, Filters>(rows, predicate, toLatLng);
    await expect(adapter.getById('b')).resolves.toBe(rows[1]);
    await expect(adapter.getById('nope')).rejects.toThrow();
  });

  it('uses a custom idOf instead of defaulting to row.id when provided', async () => {
    interface Widget {
      code: string;
      lat: number;
      lng: number;
    }
    const widgets: Widget[] = [{ code: 'w1', lat: 0, lng: 0 }];
    const adapter = new InMemoryEntityAdapter<Widget, Filters>(
      widgets,
      () => true,
      w => ({ lat: w.lat, lng: w.lng }),
      w => w.code,
    );
    const points = await adapter.getPoints({});
    expect(points[0].id).toBe('w1');
  });
});

describe('useListing', () => {
  it('throws outside a <ListingProvider>', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    function Consumer() {
      useListing();
      return null;
    }

    expect(() => render(<Consumer />)).toThrow('useListing must be used within a <ListingProvider>');

    errorSpy.mockRestore();
  });

  it('returns the live engine instance inside a <ListingProvider>', async () => {
    let captured: ListingEngine<Property, Filters> | null = null;

    function Consumer() {
      captured = useListing<Property, Filters>();
      return null;
    }

    render(
      <Wrapper>
        <Consumer />
      </Wrapper>,
    );

    await waitFor(() => expect(captured).not.toBeNull());
    expect(captured).toBeInstanceOf(ListingEngine);
  });
});

describe('useListingResults / useListingFilters (end-to-end reactivity)', () => {
  function ResultsList() {
    const results = useListingResults<Property>();
    return (
      <ul aria-label="results">
        {results.items.map(item => (
          <li key={item.id}>{item.id}</li>
        ))}
      </ul>
    );
  }

  function FilterControls() {
    const { setField } = useListingFilters<Filters>();
    return (
      <>
        <button onClick={() => setField('max', 9)}>filter-max-9</button>
        <button onClick={() => setField('max', 100)}>filter-max-100</button>
      </>
    );
  }

  it('re-renders the results list when useListingFilters().setField() narrows or widens the filter', async () => {
    render(
      <Wrapper>
        <FilterControls />
        <ResultsList />
      </Wrapper>,
    );

    // Nothing has been queried yet — ListingProvider never auto-fetches.
    expect(screen.queryAllByRole('listitem')).toHaveLength(0);

    fireEvent.click(screen.getByText('filter-max-9'));
    await waitFor(() => {
      expect(screen.getAllByRole('listitem').map(li => li.textContent)).toEqual(['a', 'b']);
    });

    fireEvent.click(screen.getByText('filter-max-100'));
    await waitFor(() => {
      expect(screen.getAllByRole('listitem').map(li => li.textContent)).toEqual(['a', 'b', 'c', 'd']);
    });
  });

  it('useListingFilters().set() applies a bulk patch the same way setField does', async () => {
    function BulkFilterControl() {
      const { set } = useListingFilters<Filters>();
      return <button onClick={() => set({ max: 9 })}>bulk-filter</button>;
    }

    render(
      <Wrapper>
        <BulkFilterControl />
        <ResultsList />
      </Wrapper>,
    );

    fireEvent.click(screen.getByText('bulk-filter'));
    await waitFor(() => {
      expect(screen.getAllByRole('listitem').map(li => li.textContent)).toEqual(['a', 'b']);
    });
  });

  it('does not warn about unstable useSyncExternalStore snapshots across repeated filter changes (no infinite-loop regression)', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    render(
      <Wrapper>
        <FilterControls />
        <ResultsList />
      </Wrapper>,
    );

    fireEvent.click(screen.getByText('filter-max-9'));
    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(2));
    fireEvent.click(screen.getByText('filter-max-100'));
    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(4));

    const offendingCalls = errorSpy.mock.calls.filter(args =>
      String(args[0]).match(/getSnapshot|Maximum update depth/i),
    );
    expect(offendingCalls).toEqual([]);

    errorSpy.mockRestore();
  });

  it('set/setField keep a stable identity across re-renders (memoized on [engine], not per-render)', async () => {
    // ListingProvider boots its engine inside an effect, but render() (which
    // renderHook wraps) flushes that effect synchronously before returning
    // — result.current already reflects the post-boot hook output here.
    const { result, rerender } = renderHook(() => useListingFilters<Filters>(), { wrapper: Wrapper });

    const firstSet = result.current.set;
    const firstSetField = result.current.setField;

    rerender();
    expect(result.current.set).toBe(firstSet);
    expect(result.current.setField).toBe(firstSetField);

    await act(async () => {
      await result.current.setField('max', 9);
    });

    expect(result.current.set).toBe(firstSet);
    expect(result.current.setField).toBe(firstSetField);
  });
});

describe('useListingMap', () => {
  it('loadPoints() populates bounds/points and selectPoint() updates the shared selection', async () => {
    const { result } = renderHook(
      () => ({ map: useListingMap(), state: useListingState<Property, Filters>() }),
      { wrapper: Wrapper },
    );

    const bounds: Bounds = { west: 0, south: 0, east: 35, north: 35 };

    await act(async () => {
      await result.current.map.loadPoints(bounds);
    });

    expect(result.current.state.bounds).toEqual(bounds);
    expect(result.current.map.points['p']?.map(p => p.id)).toEqual(['a', 'b', 'c']);

    act(() => {
      result.current.map.selectPoint('p', 'a');
    });

    expect(result.current.state.selection).toBe('a');
  });

  it('hovered starts null; setHovered() updates it without touching selection', async () => {
    const { result } = renderHook(
      () => ({ map: useListingMap(), state: useListingState<Property, Filters>() }),
      { wrapper: Wrapper },
    );

    expect(result.current.map.hovered).toBeNull();

    act(() => {
      result.current.map.setHovered('a');
    });

    expect(result.current.state.hovered).toBe('a');
    expect(result.current.state.selection).toBeNull();

    act(() => {
      result.current.map.setHovered(null);
    });

    expect(result.current.state.hovered).toBeNull();
  });
});

describe('useListingMap map actions (zoomIn / zoomOut / toggleFullscreen / fitBounds)', () => {
  function makeWrapperWithMap(map: FakeMapProvider) {
    return function WrapperWithMap({ children }: { children: ReactNode }) {
      const props = composeListingProviders<Filters>(
        withConfig<Filters>({ debounceMs: 0 }),
        withDataset<Property, Filters>({ id: 'p', adapter: new InMemoryEntityAdapter(rows, predicate, toLatLng), marker: { iconUrl: () => '' } }),
        withMap<Filters>(map),
      );
      return <ListingProvider {...props}>{children}</ListingProvider>;
    };
  }

  // Like `makeWrapperWithMap`, but ALSO renders a `<ListingMap>` so the mount
  // effect registers a real `MapHandle` on the engine -- `fitBounds` (unlike
  // the handle-free zoom/fullscreen actions) needs one. The explicit `center`
  // opts out of auto-fit (see `IListingMapProps.center`), so the ONLY
  // `provider.fitBounds` calls observed in these tests are the hook's own.
  function makeWrapperWithMountedMap(map: FakeMapProvider) {
    const WrapperWithMap = makeWrapperWithMap(map);
    return function WrapperWithMountedMap({ children }: { children: ReactNode }) {
      return (
        <WrapperWithMap>
          <ListingMap center={{ lat: 0, lng: 0 }} />
          {children}
        </WrapperWithMap>
      );
    };
  }

  it('zoomIn()/zoomOut() delegate to the configured MapProvider, in call order', () => {
    const map = new FakeMapProvider();
    const { result } = renderHook(() => useListingMap(), { wrapper: makeWrapperWithMap(map) });

    act(() => {
      result.current.zoomIn();
    });
    act(() => {
      result.current.zoomIn();
    });
    act(() => {
      result.current.zoomOut();
    });

    expect(map.zoomCalls).toEqual(['in', 'in', 'out']);
  });

  it('toggleFullscreen() delegates to the configured MapProvider', () => {
    const map = new FakeMapProvider();
    const { result } = renderHook(() => useListingMap(), { wrapper: makeWrapperWithMap(map) });

    act(() => {
      result.current.toggleFullscreen();
    });
    act(() => {
      result.current.toggleFullscreen();
    });

    expect(map.fullscreenToggles).toBe(2);
  });

  it('zoomIn/zoomOut/toggleFullscreen/fitBounds keep a stable identity across re-renders (memoized on [engine])', () => {
    const map = new FakeMapProvider();
    const { result, rerender } = renderHook(() => useListingMap(), { wrapper: makeWrapperWithMap(map) });

    const firstZoomIn = result.current.zoomIn;
    const firstZoomOut = result.current.zoomOut;
    const firstToggleFullscreen = result.current.toggleFullscreen;
    const firstFitBounds = result.current.fitBounds;

    rerender();

    expect(result.current.zoomIn).toBe(firstZoomIn);
    expect(result.current.zoomOut).toBe(firstZoomOut);
    expect(result.current.toggleFullscreen).toBe(firstToggleFullscreen);
    expect(result.current.fitBounds).toBe(firstFitBounds);
  });

  it('zoomIn()/zoomOut()/toggleFullscreen()/fitBounds() are safe no-ops when no MapProvider is configured (engine.map is undefined)', () => {
    const { result } = renderHook(() => useListingMap(), { wrapper: Wrapper });

    expect(() => {
      act(() => {
        result.current.zoomIn();
        result.current.zoomOut();
        result.current.toggleFullscreen();
        result.current.fitBounds({ west: 0, south: 0, east: 10, north: 10 });
      });
    }).not.toThrow();
  });

  it('fitBounds() delegates to provider.fitBounds with the mounted MapHandle + bounds', async () => {
    const map = new FakeMapProvider();
    const fitSpy = vi.spyOn(map, 'fitBounds');
    const { result } = renderHook(() => useListingMap(), { wrapper: makeWrapperWithMountedMap(map) });

    // `ListingMap`'s mount effect registers the handle in an async
    // continuation (`await provider.mount(...)`) -- wait for downstream proof
    // it completed (the initial world-bounds load rendered a layer) rather
    // than for `mounts.length` alone, which is pushed synchronously inside
    // `mount()` before the registration ever runs.
    await waitFor(() => expect(map.renderedLayers.length).toBeGreaterThan(0));

    const destination: Bounds = { west: 2, south: 46, east: 24, north: 52 };
    act(() => {
      result.current.fitBounds(destination);
    });

    expect(fitSpy).toHaveBeenCalledTimes(1);
    expect(fitSpy).toHaveBeenCalledWith(map.mounts[0], destination);
  });

  it('fitBounds() is a safe no-op when a MapProvider is configured but no map is mounted (no ListingMap rendered)', () => {
    const map = new FakeMapProvider();
    const { result } = renderHook(() => useListingMap(), { wrapper: makeWrapperWithMap(map) });

    expect(() => {
      act(() => {
        result.current.fitBounds({ west: 0, south: 0, east: 10, north: 10 });
      });
    }).not.toThrow();

    expect(map.fitBoundsCalls).toEqual([]);
  });

  it('the bounds-changed event following a public fitBounds() still flows through the normal pipeline (state.bounds + point reload)', async () => {
    const map = new FakeMapProvider();
    const { result } = renderHook(
      () => ({ map: useListingMap(), state: useListingState<Property, Filters>() }),
      { wrapper: makeWrapperWithMountedMap(map) },
    );

    await waitFor(() => expect(map.renderedLayers.length).toBeGreaterThan(0));

    const destination: Bounds = { west: 15, south: 15, east: 35, north: 35 };
    act(() => {
      result.current.map.fitBounds(destination);
    });
    expect(map.fitBoundsCalls).toEqual([destination]);

    // The fake provider doesn't move a real viewport, so simulate what a real
    // map SDK fires once `fitBounds` settles: a bounds-changed event. The
    // auto-fit guard in `ListingMap` only CLASSIFIES the event's origin
    // (consumer fitBounds counts as a user move) -- it must never swallow it,
    // so the normal `loadPoints` pipeline (state.bounds + per-layer point
    // reload, i.e. a consumer's bounds->filters refetch) still runs.
    await act(async () => {
      map.emitBounds(destination);
    });

    expect(result.current.state.bounds).toEqual(destination);
    await waitFor(() => expect(result.current.state.points['p']?.map(p => p.id)).toEqual(['b', 'c']));
  });
});

describe('useListingLayer', () => {
  it('defaults to visible=true and toggle() flips visibility', async () => {
    const { result } = renderHook(() => useListingLayer('p'), { wrapper: Wrapper });

    expect(result.current.visible).toBe(true);

    act(() => {
      result.current.toggle();
    });
    expect(result.current.visible).toBe(false);

    act(() => {
      result.current.toggle();
    });
    expect(result.current.visible).toBe(true);
  });

  it('exposes the dataset points from state.points, keyed by the given layer id', async () => {
    const { result } = renderHook(
      () => ({ map: useListingMap(), layer: useListingLayer('p') }),
      { wrapper: Wrapper },
    );

    await act(async () => {
      await result.current.map.loadPoints({ west: -180, south: -90, east: 180, north: 90 });
    });

    expect(result.current.layer.points.map(p => p.id)).toEqual(['a', 'b', 'c', 'd']);
  });
});

describe('useListingEvent', () => {
  it('invokes the latest handler on emitted events and subscribes to engine.on exactly once despite handler identity changing every render', async () => {
    const onSpy = vi.spyOn(ListingEngine.prototype, 'on');
    const received: string[] = [];

    function EventProbe() {
      const [n, setN] = useState(0);
      // Deliberately a fresh closure every render — proves useListingEvent
      // does not need a stable handler reference to avoid re-subscribing.
      useListingEvent(ListingEventType.FiltersChanged, () => {
        received.push(`handler-${n}`);
      });
      return <button onClick={() => setN(v => v + 1)}>bump</button>;
    }

    function EmitButton() {
      const engine = useListing<Property, Filters>();
      return <button onClick={() => void engine.applyFilters({})}>emit</button>;
    }

    render(
      <Wrapper>
        <EventProbe />
        <EmitButton />
      </Wrapper>,
    );

    fireEvent.click(screen.getByText('bump')); // n=1, new handler closure
    fireEvent.click(screen.getByText('bump')); // n=2, new handler closure

    expect(onSpy).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByText('emit'));

    await waitFor(() => expect(received).toEqual(['handler-2']));
    expect(onSpy).toHaveBeenCalledTimes(1);

    onSpy.mockRestore();
  });
});
