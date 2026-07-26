import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { composeListingProviders, ListingEngine, withConfig, withDataset, withMap } from '~/core';
import type { LatLng, MapPoint } from '~/interfaces';
import { ListingProvider } from '~/react';
import { FakeMapProvider, InMemoryEntityAdapter } from '~/testing';

import {
  cn,
  DefaultCard,
  DefaultEmpty,
  DefaultFilterPanel,
  DefaultLoading,
  DefaultMarker,
  DefaultPopup,
  DefaultResultHeader,
  DefaultSearch,
  DefaultSidebar,
  DefaultToolbar,
  ListingComponentsProviderWithDefaults,
  ListingLayout,
} from '..';

afterEach(() => {
  cleanup();
});

// -----------------------------------------------------------------------------
// cn
// -----------------------------------------------------------------------------

describe('cn', () => {
  it('merges classes and lets the later conflicting Tailwind utility win', () => {
    expect(cn('p-2', 'p-4')).toBe('p-4');
  });

  it('drops falsy values and joins the rest with a space', () => {
    expect(cn('a', false, undefined, null, 0, 'b')).toBe('a b');
  });
});

// -----------------------------------------------------------------------------
// Individual default components, rendered in isolation against the slot
// prop interfaces they implement.
// -----------------------------------------------------------------------------

describe('DefaultCard', () => {
  it('derives title, subtitle, price and badge from a plain view-model item', () => {
    render(
      <DefaultCard
        item={{ title: 'Sunny Loft', subtitle: 'Downtown', price: 1200, badge: 'New' }}
        onSelect={() => {}}
      />,
    );

    expect(screen.getByText('Sunny Loft')).toBeInTheDocument();
    expect(screen.getByText('Downtown')).toBeInTheDocument();
    expect(screen.getByText('$1,200')).toBeInTheDocument();
    expect(screen.getByText('New')).toBeInTheDocument();
  });

  it('renders as a non-interactive article (no button role) when onSelect is omitted, even with every optional field missing', () => {
    render(<DefaultCard item={{}} />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('calls onSelect when clicked, and reflects `selected` via aria-pressed', () => {
    const onSelect = vi.fn();
    const { rerender } = render(<DefaultCard item={{ title: 'X' }} selected={false} onSelect={onSelect} />);

    const button = screen.getByRole('button');
    expect(button).toHaveAttribute('aria-pressed', 'false');

    fireEvent.click(button);
    expect(onSelect).toHaveBeenCalledTimes(1);

    rerender(<DefaultCard item={{ title: 'X' }} selected onSelect={onSelect} />);
    expect(screen.getByRole('button')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button').className).toMatch(/ring-ring/);
  });
});

describe('DefaultMarker', () => {
  it('renders a price pill for a point', () => {
    const point: MapPoint<{ price: number }> = { id: 'a', position: { lat: 0, lng: 0 }, entity: { price: 42 } };
    render(<DefaultMarker point={point} />);
    expect(screen.getByText('42')).toBeInTheDocument();
  });
});

describe('DefaultPopup', () => {
  it('renders entity fields and an accessible close button that calls onClose', () => {
    const onClose = vi.fn();
    render(<DefaultPopup entity={{ title: 'Loft', price: 500 }} onClose={onClose} />);

    expect(screen.getByText('Loft')).toBeInTheDocument();
    const closeButton = screen.getByRole('button', { name: 'Close' });
    fireEvent.click(closeButton);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('exposes itself as a non-modal group with an accessible name, not a dialog', () => {
    render(<DefaultPopup entity={{ title: 'Loft' }} onClose={() => {}} />);

    expect(screen.getByRole('group', { name: 'Location details' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

describe('DefaultEmpty', () => {
  it('shows a "No results" heading', () => {
    render(<DefaultEmpty />);
    expect(screen.getByText('No results')).toBeInTheDocument();
  });
});

describe('DefaultLoading', () => {
  it('renders a busy status region', () => {
    render(<DefaultLoading />);
    const status = screen.getByRole('status');
    expect(status).toHaveAttribute('aria-busy', 'true');
  });
});

describe('DefaultResultHeader', () => {
  it('shows the count', () => {
    render(<DefaultResultHeader count={3} />);
    expect(screen.getByText('3 results')).toBeInTheDocument();
  });

  it('shows the total when given and different from count', () => {
    render(<DefaultResultHeader count={3} total={30} />);
    expect(screen.getByText('3 of 30 results')).toBeInTheDocument();
  });
});

describe('DefaultToolbar', () => {
  it('wraps children', () => {
    render(
      <DefaultToolbar>
        <span>toolbar-content</span>
      </DefaultToolbar>,
    );
    expect(screen.getByText('toolbar-content')).toBeInTheDocument();
  });
});

describe('DefaultSearch', () => {
  it('renders a labeled search input and forwards changes via onChange', () => {
    const onChange = vi.fn();
    render(<DefaultSearch value="" onChange={onChange} placeholder="Search listings" />);

    const input = screen.getByPlaceholderText('Search listings');
    fireEvent.change(input, { target: { value: 'loft' } });
    expect(onChange).toHaveBeenCalledWith('loft');
  });
});

describe('DefaultSidebar / DefaultFilterPanel', () => {
  it('both render their children', () => {
    render(
      <DefaultSidebar>
        <DefaultFilterPanel>
          <span>filter-control</span>
        </DefaultFilterPanel>
      </DefaultSidebar>,
    );
    expect(screen.getByText('filter-control')).toBeInTheDocument();
  });
});

// -----------------------------------------------------------------------------
// ListingLayout, wired through ListingComponentsProviderWithDefaults against
// fakes -- proves the whole thing composes end to end.
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

function Wrapper({ children, map, empty }: { children: ReactNode; map?: FakeMapProvider; empty?: boolean }) {
  const adapter = new InMemoryEntityAdapter<ListingRow, Filters>(empty ? [] : rows, predicate, toLatLng);
  const mods = [
    withConfig<Filters>({ debounceMs: 0 }),
    withDataset<ListingRow, Filters>({ id: 'p', adapter, marker: { iconUrl: () => '' } }),
  ];
  if (map) mods.push(withMap<Filters>(map));
  const props = composeListingProviders<Filters>(...mods);

  return (
    <ListingProvider {...props}>
      <ListingComponentsProviderWithDefaults>{children}</ListingComponentsProviderWithDefaults>
    </ListingProvider>
  );
}

describe('ListingLayout', () => {
  it('shows the DefaultLoading skeleton before data resolves, then DefaultCards after', async () => {
    render(
      <Wrapper>
        <ListingLayout />
      </Wrapper>,
    );

    // ListingLayout triggers the initial fetch on mount -- the loading
    // skeleton must already be visible synchronously, before the (async)
    // adapter's promise has had a chance to resolve.
    expect(screen.getByRole('status', { name: /loading/i })).toBeInTheDocument();
    expect(screen.queryByText('Sunny Loft')).not.toBeInTheDocument();

    await waitFor(() => expect(screen.getByText('Sunny Loft')).toBeInTheDocument());
    expect(screen.getByText('Cozy Studio')).toBeInTheDocument();
    expect(screen.queryByRole('status', { name: /loading/i })).not.toBeInTheDocument();
  });

  it('renders DefaultEmpty ("No results") when the adapter has nothing', async () => {
    render(
      <Wrapper empty>
        <ListingLayout />
      </Wrapper>,
    );

    await waitFor(() => expect(screen.getByText('No results')).toBeInTheDocument());
  });

  it('DefaultResultHeader shows the loaded result count', async () => {
    render(
      <Wrapper>
        <ListingLayout />
      </Wrapper>,
    );

    await waitFor(() => expect(screen.getByText('2 results')).toBeInTheDocument());
  });

  it('DefaultCard within the composed layout derives title/price straight from the row', async () => {
    render(
      <Wrapper>
        <ListingLayout />
      </Wrapper>,
    );

    await waitFor(() => expect(screen.getByText('Sunny Loft')).toBeInTheDocument());
    expect(screen.getByText('$1,200')).toBeInTheDocument();
    expect(screen.getByText('$950')).toBeInTheDocument();
  });

  it('does not crash when no MapProvider is configured', async () => {
    render(
      <Wrapper>
        <ListingLayout />
      </Wrapper>,
    );

    await waitFor(() => expect(screen.getByText('Sunny Loft')).toBeInTheDocument());
  });

  it('with default props, fetches the first page on mount (Loading -> Cards), calling engine.applyFilters once', async () => {
    const applyFiltersSpy = vi.spyOn(ListingEngine.prototype, 'applyFilters');

    render(
      <Wrapper>
        <ListingLayout />
      </Wrapper>,
    );

    expect(applyFiltersSpy).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('status', { name: /loading/i })).toBeInTheDocument();

    await waitFor(() => expect(screen.getByText('Sunny Loft')).toBeInTheDocument());
    expect(screen.getByText('Cozy Studio')).toBeInTheDocument();

    applyFiltersSpy.mockRestore();
  });

  it('with autoFetch={false}, does NOT call engine.applyFilters on mount and the list stays Empty', async () => {
    const applyFiltersSpy = vi.spyOn(ListingEngine.prototype, 'applyFilters');

    render(
      <Wrapper>
        <ListingLayout autoFetch={false} />
      </Wrapper>,
    );

    // No fetch was ever triggered, so the list settles straight into the
    // Empty state (never Loading) -- assert that instead of waitFor'ing on
    // it, since there is nothing async here to wait on.
    expect(screen.getByText('No results')).toBeInTheDocument();
    expect(screen.queryByRole('status', { name: /loading/i })).not.toBeInTheDocument();
    expect(applyFiltersSpy).not.toHaveBeenCalled();

    applyFiltersSpy.mockRestore();
  });

  // ---------------------------------------------------------------------
  // Redesigned structure: top filter bar + list-left/map-right split, with
  // a mobile List/Map toggle and a map fallback when no MapProvider is set.
  // ---------------------------------------------------------------------

  it('renders a filter bar and a list/map split with data-slot hooks', async () => {
    const { container } = render(
      <Wrapper>
        <ListingLayout />
      </Wrapper>,
    );

    expect(container.querySelector('[data-slot="listing-layout-filter-bar"]')).toBeInTheDocument();
    expect(container.querySelector('[data-slot="listing-layout-split"]')).toBeInTheDocument();
    expect(container.querySelector('[data-slot="listing-layout-list"]')).toBeInTheDocument();
    expect(container.querySelector('[data-slot="listing-layout-map"]')).toBeInTheDocument();

    await waitFor(() => expect(screen.getByText('Sunny Loft')).toBeInTheDocument());
  });

  it('the filter bar carries the ListingResultHeader', async () => {
    const { container } = render(
      <Wrapper>
        <ListingLayout />
      </Wrapper>,
    );

    await waitFor(() => expect(screen.getByText('2 results')).toBeInTheDocument());
    const filterBar = container.querySelector('[data-slot="listing-layout-filter-bar"]');
    expect(filterBar).toContainElement(screen.getByText('2 results'));
  });

  it('shows the map-unavailable fallback message when no MapProvider is configured', async () => {
    render(
      <Wrapper>
        <ListingLayout />
      </Wrapper>,
    );

    await waitFor(() => expect(screen.getByText('Sunny Loft')).toBeInTheDocument());
    expect(screen.getByText('Map unavailable - provide a Google Maps API key')).toBeInTheDocument();
  });

  it('mobile List/Map toggle defaults to List visible / Map hidden, and flips on click', async () => {
    const { container } = render(
      <Wrapper>
        <ListingLayout />
      </Wrapper>,
    );
    await waitFor(() => expect(screen.getByText('Sunny Loft')).toBeInTheDocument());

    const listRegion = container.querySelector('[data-slot="listing-layout-list"]');
    const mapRegion = container.querySelector('[data-slot="listing-layout-map"]');

    expect(listRegion?.className).not.toMatch(/\bhidden\b/);
    expect(mapRegion?.className).toMatch(/\bhidden\b/);
    expect(screen.getByRole('button', { name: 'List' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Map' })).toHaveAttribute('aria-pressed', 'false');

    fireEvent.click(screen.getByRole('button', { name: 'Map' }));

    expect(listRegion?.className).toMatch(/\bhidden\b/);
    expect(mapRegion?.className).not.toMatch(/\bhidden\b/);
    expect(screen.getByRole('button', { name: 'List' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: 'Map' })).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(screen.getByRole('button', { name: 'List' }));

    expect(listRegion?.className).not.toMatch(/\bhidden\b/);
    expect(mapRegion?.className).toMatch(/\bhidden\b/);
  });
});
