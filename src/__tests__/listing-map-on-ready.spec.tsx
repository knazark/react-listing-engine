import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

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
  title: string;
  price: number;
  lat: number;
  lng: number;
}

const rows: Property[] = [{ id: 'a', title: 'Loft A', price: 5, lat: 10, lng: 10 }];
const predicate = (row: Property, filters: Filters): boolean => filters.max == null || row.price <= filters.max;
const toLatLng = (row: Property): LatLng => ({ lat: row.lat, lng: row.lng });

function renderMap(map: FakeMapProvider, onMapReady?: (m: unknown) => void) {
  const props = composeListingProviders<Filters>(
    withConfig<Filters>({ debounceMs: 0 }),
    withDataset<Property, Filters>({
      id: 'p',
      adapter: new InMemoryEntityAdapter<Property, Filters>(rows, predicate, toLatLng),
      marker: { iconUrl: p => `icon-${p.id}` },
    }),
    withMap<Filters>(map),
  );
  return render(
    <ListingProvider {...props}>
      <ListingComponentsProvider Card={() => null}>
        <ListingMap onMapReady={onMapReady} />
      </ListingComponentsProvider>
    </ListingProvider>,
  );
}

afterEach(() => {
  cleanup();
});

describe('ListingMap onMapReady', () => {
  it('fires with the native map (MapHandle.raw) once the map has mounted', async () => {
    const map = new FakeMapProvider();
    const onMapReady = vi.fn();

    renderMap(map, onMapReady);

    await waitFor(() => expect(map.mounts.length).toBeGreaterThan(0));
    await waitFor(() => expect(onMapReady).toHaveBeenCalledWith(map.mounts[0].raw));
  });

  it('fires with null when the map is torn down', async () => {
    const map = new FakeMapProvider();
    const onMapReady = vi.fn();

    const { unmount } = renderMap(map, onMapReady);

    await waitFor(() => expect(onMapReady).toHaveBeenCalledWith(map.mounts[0].raw));
    unmount();

    expect(onMapReady).toHaveBeenLastCalledWith(null);
  });

  it('is a no-op when omitted -- the map still mounts (backward compatible)', async () => {
    const map = new FakeMapProvider();

    expect(() => renderMap(map)).not.toThrow();
    await waitFor(() => expect(map.mounts.length).toBeGreaterThan(0));
  });
});
