import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { composeListingProviders, withConfig, withDataset } from '~/core';
import type { LatLng } from '~/interfaces';
import { ListingComponentsProvider, ListingMap, ListingProvider } from '~/react';
import { styledDefaultComponents } from '~/styled';
import { FakeMapProvider, InMemoryEntityAdapter } from '~/testing';

interface Filters { max?: number }
interface Property { id: string; title: string; price: number; lat: number; lng: number }

const rows: Property[] = [{ id: 'a', title: 'Loft A', price: 5, lat: 10, lng: 10 }];
const predicate = (r: Property, f: Filters): boolean => f.max == null || r.price <= f.max;
const toLatLng = (r: Property): LatLng => ({ lat: r.lat, lng: r.lng });

function base() {
  return composeListingProviders<Filters>(
    withConfig<Filters>({ debounceMs: 0 }),
    withDataset<Property, Filters>({
      id: 'p',
      adapter: new InMemoryEntityAdapter<Property, Filters>(rows, predicate, toLatLng),
      marker: { iconUrl: (p: Property) => `icon-${p.id}` },
    }),
  );
}

describe('a map provider that arrives after the engine is built', () => {
  // ListingApp resolves an API key into a provider through a dynamic import and
  // renders before it lands, so the engine is built without one. It has to
  // adopt the provider when it appears -- otherwise the pane says the map is
  // unavailable for the life of the page.
  it('is adopted, and the fallback gives way to the map', async () => {
    const props = base();

    const { rerender } = render(
      <ListingProvider {...props}>
        <ListingComponentsProvider {...styledDefaultComponents}>
          <ListingMap fallback={<div>Map unavailable</div>} />
        </ListingComponentsProvider>
      </ListingProvider>,
    );

    expect(screen.getByText('Map unavailable')).toBeInTheDocument();

    rerender(
      <ListingProvider {...props} map={new FakeMapProvider()}>
        <ListingComponentsProvider {...styledDefaultComponents}>
          <ListingMap fallback={<div>Map unavailable</div>} />
        </ListingComponentsProvider>
      </ListingProvider>,
    );

    await waitFor(() => expect(screen.queryByText('Map unavailable')).not.toBeInTheDocument());
  });
});
