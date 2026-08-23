import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { composeListingProviders, withConfig, withDataset, withMap } from '~/core';
import type { LatLng } from '~/interfaces';
import { ListingComponentsProvider, ListingProvider } from '~/react';
import { StyledListingLayout, styledDefaultComponents } from '~/styled';
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
  { id: 'b', title: 'Loft B', price: 6, lat: 11, lng: 11 },
];
const predicate = (row: Property, filters: Filters): boolean => filters.max == null || row.price <= filters.max;
const toLatLng = (row: Property): LatLng => ({ lat: row.lat, lng: row.lng });

function renderLayout(resultsSlot?: React.ReactNode) {
  const props = composeListingProviders<Filters>(
    withConfig<Filters>({ debounceMs: 0 }),
    withDataset<Property, Filters>({
      id: 'p',
      adapter: new InMemoryEntityAdapter<Property, Filters>(rows, predicate, toLatLng),
      marker: { iconUrl: p => `icon-${p.id}` },
    }),
    withMap<Filters>(new FakeMapProvider()),
  );

  return render(
    <ListingProvider {...props}>
      <ListingComponentsProvider
        {...styledDefaultComponents}
        Card={({ item }) => <div>{(item as Property).title}</div>}
      >
        <StyledListingLayout<Filters> hasMap={false} resultsSlot={resultsSlot} toolbarEnd={<div>sort control</div>} />
      </ListingComponentsProvider>
    </ListingProvider>,
  );
}

afterEach(cleanup);

describe('StyledListingLayout resultsSlot', () => {
  it('renders the ordinary results column when no slot is given', async () => {
    const { container } = renderLayout();

    await waitFor(() => expect(screen.getByText('Loft A')).toBeInTheDocument());
    expect(container.querySelector('.rle-list-grid')).not.toBeNull();
    expect(screen.getByText('sort control')).toBeInTheDocument();
  });

  // The whole point: a consumer replacing this column previously had to hide
  // `.rle-list-grid`, `.rle-list-header__toolbar` and `.rle-pagination` with its
  // own CSS, which made three internal class names part of the contract by
  // accident. The slot must remove them, not merely cover them.
  it('replaces the header, grid and pagination when a slot is given', async () => {
    const { container } = renderLayout(<div>pick a city</div>);

    await waitFor(() => expect(screen.getByText('pick a city')).toBeInTheDocument());

    expect(container.querySelector('.rle-list-grid')).toBeNull();
    expect(container.querySelector('.rle-list-header')).toBeNull();
    expect(container.querySelector('.rle-list-header__toolbar')).toBeNull();
    expect(container.querySelector('.rle-pagination')).toBeNull();
    expect(screen.queryByText('Loft A')).not.toBeInTheDocument();
    expect(screen.queryByText('sort control')).not.toBeInTheDocument();
  });

  // It swaps the column's CONTENTS, not the column: the scroll container and
  // its class stay, so consumer styling of `.rle-list` keeps working.
  it('keeps the scrolling list container itself', async () => {
    const { container } = renderLayout(<div>pick a city</div>);

    await waitFor(() => expect(screen.getByText('pick a city')).toBeInTheDocument());
    expect(container.querySelector('.rle-list')).not.toBeNull();
  });
});
