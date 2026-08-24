import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { composeListingProviders, withConfig, withDataset, withInitialResults } from '~/core';
import type { LatLng } from '~/interfaces';
import { ListingComponentsProvider, ListingList, ListingProvider } from '~/react';
import { ListingApp, styledDefaultComponents } from '~/styled';
import { InMemoryEntityAdapter } from '~/testing';

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

function tree(seed: boolean) {
  const props = composeListingProviders<Filters>(
    withConfig<Filters>({ debounceMs: 0 }),
    withDataset<Property, Filters>({
      id: 'p',
      adapter: new InMemoryEntityAdapter<Property, Filters>(rows, predicate, toLatLng),
      marker: { iconUrl: (p: Property) => `icon-${p.id}` },
    }),
    ...(seed ? [withInitialResults<Filters>({ items: rows, nextCursor: null, total: 2 })] : []),
  );

  return (
    <ListingProvider {...props}>
      <ListingComponentsProvider {...styledDefaultComponents} Card={({ item }) => <div>{(item as Property).title}</div>}>
        <ListingList />
      </ListingComponentsProvider>
    </ListingProvider>
  );
}

describe('server rendering', () => {
  // The whole point of `initialResults`: HTML with real rows in it, from a
  // renderer that can never run an effect or call an adapter.
  it('renders seeded results to a string, with no browser and no fetch', () => {
    const html = renderToString(tree(true));
    expect(html).toContain('Loft A');
    expect(html).toContain('Loft B');
  });

  // The provider used to build its engine in an effect and return null until
  // it ran, so a server render produced nothing at all regardless of data.
  it('renders the provider tree at all on the server', () => {
    expect(renderToString(tree(false))).not.toBe('');
  });
});

describe('server rendering the styled app', () => {
  // The case perks actually has: the full ListingApp, configured with a Google
  // Maps API KEY. That key resolves to a provider through a dynamic import in
  // an effect, and the app used to render `null` until it landed -- so a server
  // render produced an empty page no matter what data it was given.
  it('renders seeded rows even though the map provider cannot resolve', () => {
    const html = renderToString(
      <ListingApp<Property, Filters>
        components={{ Card: ({ item }) => <div>{(item as Property).title}</div> }}
        config={{ debounceMs: 0 }}
        datasets={[
          {
            id: 'p',
            adapter: new InMemoryEntityAdapter<Property, Filters>(rows, predicate, toLatLng),
            marker: { iconUrl: (p: Property) => `icon-${p.id}` },
          },
        ]}
        initialResults={{ items: rows, nextCursor: null, total: 2 }}
        map={{ apiKey: 'test-key' }}
      />,
    );

    expect(html).toContain('Loft A');
    // The split layout is decided by the PROP, so the server and the client's
    // first render agree on it and hydration has nothing to reconcile.
    expect(html).toContain('rle-split');
  });
});
