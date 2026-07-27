import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
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

function renderMap(opts: { map: FakeMapProvider; mapControls?: ReactNode }) {
  const adapter = new InMemoryEntityAdapter<Property, Filters>(rows, predicate, toLatLng);
  const props = composeListingProviders<Filters>(
    withConfig<Filters>({ debounceMs: 0 }),
    withDataset<Property, Filters>({ id: 'p', adapter, marker: { iconUrl: p => `icon-${p.id}` } }),
    withMap<Filters>(opts.map),
  );
  return render(
    <ListingProvider {...props}>
      <ListingComponentsProvider Card={() => null}>
        <ListingMap mapControls={opts.mapControls} />
      </ListingComponentsProvider>
    </ListingProvider>,
  );
}

afterEach(() => {
  cleanup();
});

describe('ListingMap mapControls overlay', () => {
  it('renders the given mapControls node over the map when a MapProvider is configured', async () => {
    const map = new FakeMapProvider();

    renderMap({ map, mapControls: <button data-testid="zoom-in">+</button> });

    await waitFor(() => expect(map.mounts.length).toBeGreaterThan(0));
    expect(screen.getByTestId('zoom-in')).toBeInTheDocument();
  });

  it('renders NO overlay wrapper at all when mapControls is omitted (backward compatible, no stray DOM)', async () => {
    const map = new FakeMapProvider();

    const { container } = renderMap({ map });

    await waitFor(() => expect(map.mounts.length).toBeGreaterThan(0));
    expect(container.querySelector('.pointer-events-none')).toBeNull();
  });

  it('the overlay wrapper is pointer-events-none and the mapControls child is pointer-events-auto, so it floats without blocking map drag', async () => {
    const map = new FakeMapProvider();

    const { container } = renderMap({ map, mapControls: <button data-testid="zoom-in">+</button> });

    await waitFor(() => expect(map.mounts.length).toBeGreaterThan(0));

    const button = screen.getByTestId('zoom-in');
    const innerWrapper = button.parentElement as HTMLElement;
    const outerWrapper = innerWrapper.parentElement as HTMLElement;

    expect(outerWrapper.className).toContain('pointer-events-none');
    expect(outerWrapper.className).toContain('absolute');
    expect(outerWrapper.className).toContain('inset-0');
    expect(innerWrapper.className).toContain('pointer-events-auto');

    // The overlay wrapper sits INSIDE the outer relative map wrapper, as a sibling of the
    // ref'd map-mount container (never a child of it -- a real map SDK owns that node's
    // children exclusively).
    expect(container.querySelector('.relative.h-full.min-h-0.w-full')).toBe(outerWrapper.parentElement);
  });

  it('mapControls content stays interactive (its own onClick fires) despite the pointer-events-none wrapper', async () => {
    const map = new FakeMapProvider();
    const onClick = vi.fn();

    renderMap({ map, mapControls: <button onClick={onClick}>zoom in</button> });

    await waitFor(() => expect(map.mounts.length).toBeGreaterThan(0));

    fireEvent.click(screen.getByText('zoom in'));

    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('re-renders with a new mapControls node when the prop changes (not frozen from first mount)', async () => {
    const map = new FakeMapProvider();
    const adapter = new InMemoryEntityAdapter<Property, Filters>(rows, predicate, toLatLng);
    const props = composeListingProviders<Filters>(
      withConfig<Filters>({ debounceMs: 0 }),
      withDataset<Property, Filters>({ id: 'p', adapter, marker: { iconUrl: p => `icon-${p.id}` } }),
      withMap<Filters>(map),
    );

    const { rerender } = render(
      <ListingProvider {...props}>
        <ListingComponentsProvider Card={() => null}>
          <ListingMap mapControls={<span>v1</span>} />
        </ListingComponentsProvider>
      </ListingProvider>,
    );

    await waitFor(() => expect(map.mounts.length).toBeGreaterThan(0));
    expect(screen.getByText('v1')).toBeInTheDocument();

    rerender(
      <ListingProvider {...props}>
        <ListingComponentsProvider Card={() => null}>
          <ListingMap mapControls={<span>v2</span>} />
        </ListingComponentsProvider>
      </ListingProvider>,
    );

    expect(screen.queryByText('v1')).not.toBeInTheDocument();
    expect(screen.getByText('v2')).toBeInTheDocument();
  });
});
