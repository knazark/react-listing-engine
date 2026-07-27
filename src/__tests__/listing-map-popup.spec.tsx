import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { composeListingProviders, withConfig, withDataset, withMap } from '~/core';
import type { LatLng } from '~/interfaces';
import { ListingComponentsProvider, ListingProvider } from '~/react';
import type { IListingPopupProps } from '~/react';
import { ListingMap } from '~/react/components';
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
];

const predicate = (row: Property, filters: Filters): boolean => filters.max == null || row.price <= filters.max;
const toLatLng = (row: Property): LatLng => ({ lat: row.lat, lng: row.lng });

// Injected Popup slot under test: renders the selected entity's title plus a
// close button wired to `onClose` (which the engine passes as
// `selectPoint(primary, null)`).
const TestPopup = ({ entity, onClose }: IListingPopupProps) => {
  const property = entity as Property;
  return (
    <div role="dialog">
      <span>Popup: {property.title}</span>
      <button onClick={onClose}>close</button>
    </div>
  );
};

// Grabs the live engine out of the tree so a test can drive it imperatively.
function makeProbe() {
  function Probe() {
    const engine = useListing<Property, Filters>();
    (Probe as unknown as { engine?: typeof engine }).engine = engine;
    return null;
  }
  const getEngine = () => (Probe as unknown as { engine: ReturnType<typeof useListing<Property, Filters>> }).engine;
  return { Probe, getEngine };
}

function renderMap(opts: { map: FakeMapProvider; withPopup: boolean; Probe: () => null }) {
  const adapter = new InMemoryEntityAdapter<Property, Filters>(rows, predicate, toLatLng);
  const props = composeListingProviders<Filters>(
    withConfig<Filters>({ debounceMs: 0 }),
    withDataset<Property, Filters>({ id: 'p', adapter, marker: { iconUrl: p => `icon-${p.id}` } }),
    withMap<Filters>(opts.map),
  );
  const { Probe } = opts;
  return render(
    <ListingProvider {...props}>
      <ListingComponentsProvider Card={() => null} {...(opts.withPopup ? { Popup: TestPopup } : {})}>
        <ListingMap />
        <Probe />
      </ListingComponentsProvider>
    </ListingProvider>,
  );
}

afterEach(() => {
  cleanup();
});

describe('ListingMap popup overlay', () => {
  it('renders the injected Popup as an anchored overlay on selection, and onClose clears it', async () => {
    const map = new FakeMapProvider();
    const { Probe, getEngine } = makeProbe();

    renderMap({ map, withPopup: true, Probe });

    await waitFor(() => expect(map.mounts.length).toBeGreaterThan(0));
    const engine = getEngine();

    // Points must be loaded before selecting so the selected point resolves.
    await act(async () => {
      await engine.loadPoints({ west: 0, south: 0, east: 30, north: 30 });
    });
    await waitFor(() => expect(engine.state.points.p?.length).toBe(2));

    // No popup before anything is selected.
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(map.overlays.length).toBe(0);

    act(() => {
      engine.selectPoint('p', 'a');
    });

    // Portal'd Popup content appears in the overlay container.
    await waitFor(() => expect(screen.getByText('Popup: Loft A')).toBeInTheDocument());
    expect(map.overlays.length).toBe(1);
    expect(map.overlays[0].position).toEqual({ lat: 10, lng: 10 });

    // Invoking the injected onClose clears the shared selection...
    fireEvent.click(screen.getByText('close'));

    // ...and the popup (and its overlay) go away.
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(engine.state.selection).toBeNull();
    expect(map.overlays.length).toBe(0);
  });

  it('re-anchors the overlay when the selection changes to a different point', async () => {
    const map = new FakeMapProvider();
    const { Probe, getEngine } = makeProbe();

    renderMap({ map, withPopup: true, Probe });

    await waitFor(() => expect(map.mounts.length).toBeGreaterThan(0));
    const engine = getEngine();

    await act(async () => {
      await engine.loadPoints({ west: 0, south: 0, east: 30, north: 30 });
    });
    await waitFor(() => expect(engine.state.points.p?.length).toBe(2));

    act(() => {
      engine.selectPoint('p', 'a');
    });
    await waitFor(() => expect(screen.getByText('Popup: Loft A')).toBeInTheDocument());

    act(() => {
      engine.selectPoint('p', 'b');
    });
    await waitFor(() => expect(screen.getByText('Popup: Loft B')).toBeInTheDocument());
    // Fresh overlay anchored at the newly-selected point; no stale overlay left behind.
    expect(map.overlays.length).toBe(1);
    expect(map.overlays[0].position).toEqual({ lat: 20, lng: 20 });
  });

  it('selecting a different marker re-anchors the popup and is NOT clobbered by background-click dismissal -- only emitMapClick() dismisses it', async () => {
    // Regression guard for a load-bearing assumption `ListingMap`'s popup-overlay
    // effect depends on (see its doc comment's "Popup overlay" section): a real
    // marker click is wired as `layer.onMarkerClick: markerId => engine.selectPoint(...)`
    // (`listing-map.tsx`), which is a completely separate code path from
    // `provider.onMapClick(dismiss)`. `FakeMapProvider.emitMapClick()` -- the only
    // thing that invokes the registered `onMapClick` callbacks -- is a test-only
    // method; nothing in `ListingMap` or the engine ever calls it internally, so
    // switching the selection to a different marker must never accidentally
    // dismiss the open popup the way a genuine map-background click does.
    const map = new FakeMapProvider();
    const { Probe, getEngine } = makeProbe();

    renderMap({ map, withPopup: true, Probe });

    await waitFor(() => expect(map.mounts.length).toBeGreaterThan(0));
    const engine = getEngine();

    await act(async () => {
      await engine.loadPoints({ west: 0, south: 0, east: 30, north: 30 });
    });
    await waitFor(() => expect(engine.state.points.p?.length).toBe(2));

    // Popup open on marker A (mirrors a real click on marker A's pin).
    act(() => {
      engine.selectPoint('p', 'a');
    });
    await waitFor(() => expect(screen.getByText('Popup: Loft A')).toBeInTheDocument());
    expect(map.overlays.length).toBe(1);

    // Select a DIFFERENT marker -- B -- mirroring a real click on marker B's
    // pin. This must simply re-anchor the popup to B, not tear it down via
    // background-click dismissal.
    act(() => {
      engine.selectPoint('p', 'b');
    });

    await waitFor(() => expect(screen.getByText('Popup: Loft B')).toBeInTheDocument());
    expect(engine.state.selection).toBe('b');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(map.overlays.length).toBe(1);
    expect(map.overlays[0].position).toEqual({ lat: 20, lng: 20 });

    // Only a genuine background click (`emitMapClick()`) dismisses the popup.
    act(() => {
      map.emitMapClick();
    });

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(engine.state.selection).toBeNull();
    expect(map.overlays.length).toBe(0);
  });

  it('pressing Escape dismisses the popup (clears selection)', async () => {
    const map = new FakeMapProvider();
    const { Probe, getEngine } = makeProbe();

    renderMap({ map, withPopup: true, Probe });

    await waitFor(() => expect(map.mounts.length).toBeGreaterThan(0));
    const engine = getEngine();

    await act(async () => {
      await engine.loadPoints({ west: 0, south: 0, east: 30, north: 30 });
    });
    await waitFor(() => expect(engine.state.points.p?.length).toBe(2));

    act(() => {
      engine.selectPoint('p', 'a');
    });
    await waitFor(() => expect(screen.getByText('Popup: Loft A')).toBeInTheDocument());

    act(() => {
      fireEvent.keyDown(document, { key: 'Escape' });
    });

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(engine.state.selection).toBeNull();
    expect(map.overlays.length).toBe(0);
  });

  it('renders NO overlay and NO popup on selection when no Popup slot is provided (backward compatible)', async () => {
    const map = new FakeMapProvider();
    const { Probe, getEngine } = makeProbe();

    renderMap({ map, withPopup: false, Probe });

    await waitFor(() => expect(map.mounts.length).toBeGreaterThan(0));
    const engine = getEngine();

    await act(async () => {
      await engine.loadPoints({ west: 0, south: 0, east: 30, north: 30 });
    });
    await waitFor(() => expect(engine.state.points.p?.length).toBe(2));

    act(() => {
      engine.selectPoint('p', 'a');
    });

    // Give the effects a chance to run, then assert nothing was mounted.
    await waitFor(() => expect(engine.state.selection).toBe('a'));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(map.overlays.length).toBe(0);
  });

  it('keeps the popup anchored with its content intact when the selected point leaves the loaded set (pan-out)', async () => {
    const map = new FakeMapProvider();
    const { Probe, getEngine } = makeProbe();

    renderMap({ map, withPopup: true, Probe });

    await waitFor(() => expect(map.mounts.length).toBeGreaterThan(0));
    const engine = getEngine();

    // Both points loaded, then select 'a' (lat 10, lng 10).
    await act(async () => {
      await engine.loadPoints({ west: 0, south: 0, east: 30, north: 30 });
    });
    await waitFor(() => expect(engine.state.points.p?.length).toBe(2));

    act(() => {
      engine.selectPoint('p', 'a');
    });
    await waitFor(() => expect(screen.getByText('Popup: Loft A')).toBeInTheDocument());
    expect(map.overlays.length).toBe(1);

    // Simulate a pan whose new viewport no longer contains 'a' -- only 'b'
    // (lat 20, lng 20) survives the bounds filter, so 'a' drops out of
    // `state.points`. The open popup must NOT tear down or empty out.
    await act(async () => {
      await engine.loadPoints({ west: 15, south: 15, east: 30, north: 30 });
    });
    await waitFor(() => expect(engine.state.points.p?.length).toBe(1));
    expect(engine.state.points.p?.[0].id).toBe('b');

    // Exactly ONE overlay, still anchored at 'a', with its captured content
    // intact -- no empty lingering overlay, selection unchanged.
    expect(screen.getByText('Popup: Loft A')).toBeInTheDocument();
    expect(map.overlays.length).toBe(1);
    expect(map.overlays[0].position).toEqual({ lat: 10, lng: 10 });
    expect(engine.state.selection).toBe('a');
  });

  it('dismisses the popup on a map-background click (clears selection, removes overlay)', async () => {
    const map = new FakeMapProvider();
    const { Probe, getEngine } = makeProbe();

    renderMap({ map, withPopup: true, Probe });

    await waitFor(() => expect(map.mounts.length).toBeGreaterThan(0));
    const engine = getEngine();

    await act(async () => {
      await engine.loadPoints({ west: 0, south: 0, east: 30, north: 30 });
    });
    await waitFor(() => expect(engine.state.points.p?.length).toBe(2));

    act(() => {
      engine.selectPoint('p', 'a');
    });
    await waitFor(() => expect(screen.getByText('Popup: Loft A')).toBeInTheDocument());
    expect(map.overlays.length).toBe(1);

    // A click on the map background (not on a marker -- HTML markers live in a
    // separate, mouse-target pane) dismisses the open popup.
    act(() => {
      map.emitMapClick();
    });

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(engine.state.selection).toBeNull();
    expect(map.overlays.length).toBe(0);
  });
});
