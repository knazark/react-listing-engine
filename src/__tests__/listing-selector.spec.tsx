import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { composeListingProviders, withConfig, withDataset } from '~/core';
import type { LatLng } from '~/interfaces';
import { type IListingCardProps, ListingComponentsProvider, ListingProvider } from '~/react';
import { ListingList } from '~/react/components';
import { useListing, useListingActions, useListingMap, useListingSelector } from '~/react/hooks';
import { InMemoryEntityAdapter } from '~/testing';

interface Filters {
  max?: number;
}

interface Property {
  id: string;
  lat: number;
  lng: number;
  price: number;
  title: string;
}

const rows: Property[] = [
  { id: 'a', lat: 10, lng: 10, price: 5, title: 'Loft A' },
  { id: 'b', lat: 20, lng: 20, price: 9, title: 'Loft B' },
  { id: 'c', lat: 30, lng: 30, price: 20, title: 'Loft C' },
];

const predicate = (row: Property, filters: Filters): boolean => filters.max == null || row.price <= filters.max;
const toLatLng = (row: Property): LatLng => ({ lat: row.lat, lng: row.lng });

function Wrapper({ children }: { children: ReactNode }) {
  const props = composeListingProviders<Filters>(
    withConfig<Filters>({ debounceMs: 0 }),
    withDataset<Property, Filters>({
      adapter: new InMemoryEntityAdapter<Property, Filters>(rows, predicate, toLatLng),
      id: 'p',
      marker: { iconUrl: () => '' },
    }),
  );
  return <ListingProvider {...props}>{children}</ListingProvider>;
}

afterEach(() => {
  cleanup();
});

describe('useListingSelector', () => {
  it('re-renders only when the selected value changes', async () => {
    const renders = vi.fn();

    function HoverBadge({ id }: { id: string }) {
      const hovered = useListingSelector<boolean>(state => state.hovered === id);
      renders(id);
      return <span data-testid={`badge-${id}`}>{hovered ? 'hovered' : 'idle'}</span>;
    }

    let engine: ReturnType<typeof useListing> | null = null;
    function Capture() {
      engine = useListing();
      return null;
    }

    render(
      <Wrapper>
        <Capture />
        <HoverBadge id="a" />
        <HoverBadge id="b" />
      </Wrapper>,
    );
    await waitFor(() => expect(engine).not.toBeNull());
    renders.mockClear();

    act(() => engine!.setHovered('p', 'a'));

    // Only the card whose answer changed re-rendered; 'b' still reads false.
    expect(renders.mock.calls.map(call => call[0])).toEqual(['a']);
    expect(screen.getByTestId('badge-a')).toHaveTextContent('hovered');
    expect(screen.getByTestId('badge-b')).toHaveTextContent('idle');
  });

  it('leaves a subscriber alone when an unrelated part of the state changes', async () => {
    const renders = vi.fn();

    function SelectionBadge() {
      const selected = useListingSelector<boolean>(state => state.selection === 'a');
      renders();
      return <span>{selected ? 'yes' : 'no'}</span>;
    }

    let engine: ReturnType<typeof useListing> | null = null;
    function Capture() {
      engine = useListing();
      return null;
    }

    render(
      <Wrapper>
        <Capture />
        <SelectionBadge />
      </Wrapper>,
    );
    await waitFor(() => expect(engine).not.toBeNull());
    renders.mockClear();

    act(() => engine!.setHovered('p', 'c'));

    expect(renders).not.toHaveBeenCalled();
  });
});

describe('ListingList card re-renders', () => {
  it('re-renders only the cards whose own props changed', async () => {
    const renders = vi.fn();

    function Card({ item, selected }: IListingCardProps) {
      const property = item as Property;
      renders(property.id);
      return (
        <button data-testid={`card-${property.id}`} type="button">
          {property.title}
          {selected ? ' *' : ''}
        </button>
      );
    }

    let engine: ReturnType<typeof useListing> | null = null;
    function Capture() {
      engine = useListing();
      return null;
    }

    render(
      <Wrapper>
        <Capture />
        <ListingComponentsProvider Card={Card}>
          <ListingList />
        </ListingComponentsProvider>
      </Wrapper>,
    );
    await waitFor(() => expect(engine).not.toBeNull());
    // Bare `ListingList` has no auto-fetch of its own; the layout normally
    // issues this on mount.
    await act(() => engine!.applyFilters({}));
    await waitFor(() => expect(screen.getByTestId('card-a')).toBeInTheDocument());
    renders.mockClear();

    // Selecting one card changes `selected` for that card alone. The list
    // itself re-renders on the write; the other cards must not.
    act(() => engine!.selectPoint('p', 'a'));

    expect(renders.mock.calls.map(call => call[0])).toEqual(['a']);
    expect(screen.getByTestId('card-a')).toHaveTextContent('*');
  });

  it('does not re-render any card for a write no card reads', async () => {
    const renders = vi.fn();

    function Card({ item }: IListingCardProps) {
      renders((item as Property).id);
      return <span>{(item as Property).title}</span>;
    }

    let engine: ReturnType<typeof useListing> | null = null;
    function Capture() {
      engine = useListing();
      return null;
    }

    render(
      <Wrapper>
        <Capture />
        <ListingComponentsProvider Card={Card}>
          <ListingList />
        </ListingComponentsProvider>
      </Wrapper>,
    );
    await waitFor(() => expect(engine).not.toBeNull());
    await act(() => engine!.applyFilters({}));
    await waitFor(() => expect(screen.getByText('Loft A')).toBeInTheDocument());
    renders.mockClear();

    act(() => engine!.setHovered('p', 'b'));

    expect(renders).not.toHaveBeenCalled();
  });
});

describe('useListingActions', () => {
  it('does not re-render its component when the store is written', async () => {
    const renders = vi.fn();

    function Dispatcher() {
      const { setHovered } = useListingActions();
      renders();
      return (
        <button onClick={() => setHovered('a')} type="button">
          hover a
        </button>
      );
    }

    let engine: ReturnType<typeof useListing> | null = null;
    function Capture() {
      engine = useListing();
      return null;
    }

    render(
      <Wrapper>
        <Capture />
        <Dispatcher />
      </Wrapper>,
    );
    await waitFor(() => expect(engine).not.toBeNull());
    renders.mockClear();

    act(() => engine!.setHovered('p', 'b'));

    expect(renders).not.toHaveBeenCalled();
  });

  it('still re-renders a component that reads map state through useListingMap', async () => {
    const renders = vi.fn();

    function MapReader() {
      const { hovered } = useListingMap();
      renders();
      return <span>{String(hovered)}</span>;
    }

    let engine: ReturnType<typeof useListing> | null = null;
    function Capture() {
      engine = useListing();
      return null;
    }

    render(
      <Wrapper>
        <Capture />
        <MapReader />
      </Wrapper>,
    );
    await waitFor(() => expect(engine).not.toBeNull());
    renders.mockClear();

    act(() => engine!.setHovered('p', 'b'));

    expect(renders).toHaveBeenCalled();
    expect(screen.getByText('b')).toBeInTheDocument();
  });
});
