// src/__tests__/listing-layout-results-footer.spec.tsx
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

// Two rows + pageSize 1 so the numbered pager renders (it is omitted for a single page).
const rows: Property[] = [
  { id: 'a', title: 'Loft A', price: 5, lat: 10, lng: 10 },
  { id: 'b', title: 'Loft B', price: 6, lat: 11, lng: 11 },
];
const predicate = (row: Property, filters: Filters): boolean => filters.max == null || row.price <= filters.max;
const toLatLng = (row: Property): LatLng => ({ lat: row.lat, lng: row.lng });

function renderLayout(props: { resultsFooter?: React.ReactNode; resultsSlot?: React.ReactNode }) {
  const providerProps = composeListingProviders<Filters>(
    withConfig<Filters>({ debounceMs: 0, pageSize: 1 }),
    withDataset<Property, Filters>({
      id: 'p',
      adapter: new InMemoryEntityAdapter<Property, Filters>(rows, predicate, toLatLng),
      marker: { iconUrl: p => `icon-${p.id}` },
    }),
    withMap<Filters>(new FakeMapProvider()),
  );

  return render(
    <ListingProvider {...providerProps}>
      <ListingComponentsProvider
        {...styledDefaultComponents}
        Card={({ item }) => <div>{(item as Property).title}</div>}
      >
        <StyledListingLayout<Filters> hasMap={false} {...props} />
      </ListingComponentsProvider>
    </ListingProvider>,
  );
}

afterEach(cleanup);

describe('StyledListingLayout resultsFooter', () => {
  it('renders the footer inside the list column, after the pagination', async () => {
    const { container } = renderLayout({ resultsFooter: <div>seo tail</div> });

    await waitFor(() => expect(screen.getByText('Loft A')).toBeInTheDocument());
    const list = container.querySelector('.rle-list');
    const footer = screen.getByText('seo tail');
    expect(list).toContainElement(footer);

    const pagination = container.querySelector('.rle-pagination');
    expect(pagination).not.toBeNull();
    // DOCUMENT_POSITION_FOLLOWING: the footer comes after the pager in DOM order.
    expect(pagination!.compareDocumentPosition(footer) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('is not rendered when a resultsSlot replaces the column', async () => {
    renderLayout({ resultsFooter: <div>seo tail</div>, resultsSlot: <div>pick a city</div> });

    await waitFor(() => expect(screen.getByText('pick a city')).toBeInTheDocument());
    expect(screen.queryByText('seo tail')).not.toBeInTheDocument();
  });

  it('renders nothing extra when omitted', async () => {
    const { container } = renderLayout({});

    await waitFor(() => expect(screen.getByText('Loft A')).toBeInTheDocument());
    expect(container.querySelector('.rle-list-footer')).toBeNull();
  });
});
