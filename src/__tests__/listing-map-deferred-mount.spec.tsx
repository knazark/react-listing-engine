import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { composeListingProviders, withConfig, withDataset, withMap } from '~/core';
import type { LatLng } from '~/interfaces';
import { ListingComponentsProvider, ListingProvider } from '~/react';
import { ListingMap } from '~/react/components';
import { FakeMapProvider, InMemoryEntityAdapter } from '~/testing';

interface Filters {
  max?: number;
}

interface Property {
  id: string;
  lat: number;
  lng: number;
  title: string;
}

const rows: Property[] = [{ id: 'a', lat: 10, lng: 10, title: 'Loft A' }];
const predicate = (): boolean => true;
const toLatLng = (row: Property): LatLng => ({ lat: row.lat, lng: row.lng });

// jsdom lays nothing out, so the size the component measures is dictated here.
let paneSize = { height: 600, width: 800 };

// Enough of ResizeObserver to hold a callback and let a test fire it, standing
// in for the layout pass that gives a hidden pane its size.
class FakeResizeObserver {
  static instances: FakeResizeObserver[] = [];

  disconnected = false;

  constructor(private readonly callback: () => void) {
    FakeResizeObserver.instances.push(this);
  }

  disconnect(): void {
    this.disconnected = true;
  }

  observe(): void {}

  /** The layout pass: the pane gains size, and the observer reports it. */
  resizeTo(size: { height: number; width: number }): void {
    paneSize = size;
    act(() => this.callback());
  }

  unobserve(): void {}
}

function renderMap(map: FakeMapProvider) {
  const props = composeListingProviders<Filters>(
    withConfig<Filters>({ debounceMs: 0 }),
    withDataset<Property, Filters>({
      adapter: new InMemoryEntityAdapter<Property, Filters>(rows, predicate, toLatLng),
      id: 'p',
      marker: { iconUrl: p => `icon-${p.id}` },
    }),
    withMap<Filters>(map),
  );
  return render(
    <ListingProvider {...props}>
      <ListingComponentsProvider Card={() => null}>
        <ListingMap />
      </ListingComponentsProvider>
    </ListingProvider>,
  );
}

beforeEach(() => {
  paneSize = { height: 600, width: 800 };
  FakeResizeObserver.instances = [];
  vi.stubGlobal('ResizeObserver', FakeResizeObserver);
  // The document keeps a real viewport throughout -- that is what tells a
  // browser (where a 0x0 pane means hidden) from a DOM that lays nothing out.
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    const size = this === document.documentElement ? { height: 900, width: 1440 } : paneSize;
    return { ...size, bottom: 0, left: 0, right: 0, toJSON: () => ({}), top: 0, x: 0, y: 0 } as DOMRect;
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('ListingMap deferred mount', () => {
  it('mounts straight away when the pane already has size', async () => {
    const map = new FakeMapProvider();

    renderMap(map);

    await waitFor(() => expect(map.mounts).toHaveLength(1));
  });

  it('does not mount into a pane with no size', async () => {
    // What a mobile layout does behind its List view: the map stays in the
    // tree, hidden, so its container measures 0x0.
    paneSize = { height: 0, width: 0 };
    const map = new FakeMapProvider();

    renderMap(map);

    await waitFor(() => expect(FakeResizeObserver.instances.length).toBeGreaterThan(0));
    expect(map.mounts).toHaveLength(0);
  });

  it('mounts once the pane is shown', async () => {
    paneSize = { height: 0, width: 0 };
    const map = new FakeMapProvider();
    renderMap(map);
    await waitFor(() => expect(FakeResizeObserver.instances.length).toBeGreaterThan(0));

    FakeResizeObserver.instances[0].resizeTo({ height: 600, width: 800 });

    await waitFor(() => expect(map.mounts).toHaveLength(1));
    expect(FakeResizeObserver.instances[0].disconnected).toBe(true);
  });

  it('mounts anyway where ResizeObserver does not exist', async () => {
    paneSize = { height: 0, width: 0 };
    vi.stubGlobal('ResizeObserver', undefined);
    const map = new FakeMapProvider();

    renderMap(map);

    await waitFor(() => expect(map.mounts).toHaveLength(1));
  });
});
