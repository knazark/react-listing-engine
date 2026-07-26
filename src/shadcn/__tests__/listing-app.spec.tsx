import { cleanup, render, screen, waitFor } from '@testing-library/react';
import type { ComponentType } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { MemoryHistoryPort, UrlSyncController } from '~/core';
import type { DatasetDefinition, LatLng } from '~/interfaces';
import type { IListingCardProps } from '~/react';
import { FakeMapProvider, InMemoryEntityAdapter } from '~/testing';

import { ListingApp } from '..';

afterEach(() => {
  cleanup();
});

// -----------------------------------------------------------------------------
// `~/maps/google` mock -- lets the `{ apiKey }` shorthand test exercise the
// real dynamic-import resolution path (see `listing-app.tsx`'s `useResolvedMap`
// doc comment) WITHOUT touching the real `@googlemaps/js-api-loader`, which
// would inject a live `<script>` tag and never resolve in this test's DOM
// environment. `mockGoogleProvider` (the `mock` prefix is required -- Vitest
// only allows hoisted `vi.mock` factories to close over identifiers named
// that way) stands in for the real factory.
// -----------------------------------------------------------------------------
const mockGoogleProvider = vi.fn((_config: { apiKey: string; mapId?: string }) => ({
  mount: () => ({ raw: {} }),
  renderLayer: () => () => {},
  onBoundsChange: () => () => {},
  fitBounds: () => {},
  destroy: () => {},
}));

vi.mock('~/maps/google', () => ({
  googleProvider: (config: { apiKey: string; mapId?: string }) => mockGoogleProvider(config),
}));

// -----------------------------------------------------------------------------
// Fixtures -- same shape/spirit as `shadcn.spec.tsx`'s `ListingLayout` suite.
// -----------------------------------------------------------------------------

interface Filters {
  q?: string;
}

interface ListingRow {
  id: string;
  title: string;
  price: number;
  lat: number;
  lng: number;
}

const rows: ListingRow[] = [
  { id: 'a', title: 'Sunny Loft', price: 1200, lat: 10, lng: 10 },
  { id: 'b', title: 'Cozy Studio', price: 950, lat: 20, lng: 20 },
];

const predicate = (row: ListingRow, filters: Filters): boolean =>
  filters.q == null || row.title.toLowerCase().includes(filters.q.toLowerCase());
const toLatLng = (row: ListingRow): LatLng => ({ lat: row.lat, lng: row.lng });

function makeDataset(): DatasetDefinition<ListingRow, Filters> {
  return {
    id: 'p',
    adapter: new InMemoryEntityAdapter<ListingRow, Filters>(rows, predicate, toLatLng),
    marker: { iconUrl: () => '' },
  };
}

const CustomCard: ComponentType<IListingCardProps> = ({ item }) => {
  const row = item as ListingRow;
  return <div data-testid="custom-card">CUSTOM: {row.title}</div>;
};

describe('ListingApp', () => {
  it('renders the full experience end to end with no map provided -- the styled map fallback shows', async () => {
    render(<ListingApp<ListingRow, Filters> datasets={[makeDataset()]} config={{ debounceMs: 0 }} />);

    await waitFor(() => expect(screen.getByText('Sunny Loft')).toBeInTheDocument());
    expect(screen.getByText('Cozy Studio')).toBeInTheDocument();
    expect(screen.getByText('2 results')).toBeInTheDocument();
    expect(screen.getByText('Map unavailable - provide a Google Maps API key')).toBeInTheDocument();
  });

  it('renders end to end against a FakeMapProvider passed as map.provider, mounting it', async () => {
    const map = new FakeMapProvider();

    render(
      <ListingApp<ListingRow, Filters>
        datasets={[makeDataset()]}
        config={{ debounceMs: 0 }}
        map={{ provider: map }}
      />,
    );

    await waitFor(() => expect(screen.getByText('Sunny Loft')).toBeInTheDocument());
    await waitFor(() => expect(map.mounts.length).toBeGreaterThan(0));
    expect(screen.queryByText('Map unavailable - provide a Google Maps API key')).not.toBeInTheDocument();
  });

  it('resolves a map.apiKey shorthand into a googleProvider via dynamic import, without blocking the render', async () => {
    render(
      <ListingApp<ListingRow, Filters>
        datasets={[makeDataset()]}
        config={{ debounceMs: 0 }}
        map={{ apiKey: 'test-key', mapId: 'test-map-id' }}
      />,
    );

    await waitFor(() => expect(screen.getByText('Sunny Loft')).toBeInTheDocument());
    expect(mockGoogleProvider).toHaveBeenCalledWith({ apiKey: 'test-key', mapId: 'test-map-id' });
    expect(screen.queryByText('Map unavailable - provide a Google Maps API key')).not.toBeInTheDocument();
  });

  it('a components.Card override renders OVER the shadcn styled defaults, proving the merge', async () => {
    render(
      <ListingApp<ListingRow, Filters>
        datasets={[makeDataset()]}
        config={{ debounceMs: 0 }}
        components={{ Card: CustomCard }}
      />,
    );

    await waitFor(() => expect(screen.getAllByTestId('custom-card')).toHaveLength(2));
    expect(screen.getByText('CUSTOM: Sunny Loft')).toBeInTheDocument();
    expect(screen.getByText('CUSTOM: Cozy Studio')).toBeInTheDocument();

    // Every OTHER slot still comes from the shadcn styled defaults, not the
    // package's bare/unstyled internal fallbacks -- DefaultResultHeader's "N
    // results" text, and the styled map-unavailable fallback message, are
    // both only ever rendered by the shadcn Default* components.
    expect(screen.getByText('2 results')).toBeInTheDocument();
    expect(screen.getByText('Map unavailable - provide a Google Maps API key')).toBeInTheDocument();
  });

  it('a UrlSyncController passed as urlSync is started against the mounted engine', async () => {
    const controller = new UrlSyncController<Filters>({
      history: new MemoryHistoryPort(),
      toQuery: () => ({}),
      toFilters: () => ({}),
    });
    const startSpy = vi.spyOn(controller, 'start');

    render(
      <ListingApp<ListingRow, Filters>
        datasets={[makeDataset()]}
        config={{ debounceMs: 0 }}
        urlSync={controller}
      />,
    );

    await waitFor(() => expect(startSpy).toHaveBeenCalledTimes(1));
  });

  it('urlSync={true} is a documented no-op -- renders normally, never throws', async () => {
    render(<ListingApp<ListingRow, Filters> datasets={[makeDataset()]} config={{ debounceMs: 0 }} urlSync />);

    await waitFor(() => expect(screen.getByText('Sunny Loft')).toBeInTheDocument());
  });
});
