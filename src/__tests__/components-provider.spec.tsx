import '@testing-library/jest-dom/vitest';

import { cleanup, render, renderHook, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { ListingComponentsProvider, useListingComponents } from '~/react';
import type { IListingCardProps, IListingEmptyProps } from '~/react';

describe('ListingComponentsProvider / useListingComponents', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders a custom Empty component in place of the default when provided', () => {
    const CustomEmpty = () => <div>Nothing here, try another search</div>;

    function Consumer() {
      const { Empty } = useListingComponents();
      return <Empty />;
    }

    render(
      <ListingComponentsProvider Empty={CustomEmpty}>
        <Consumer />
      </ListingComponentsProvider>,
    );

    expect(screen.getByText('Nothing here, try another search')).toBeInTheDocument();
    // The default fallback text must NOT be present — proves the override actually took effect.
    expect(screen.queryByText('No results')).not.toBeInTheDocument();
  });

  it('falls back to the default for a slot that was not provided', () => {
    const CustomEmpty = () => <div>Nothing here, try another search</div>;

    function Consumer() {
      const { Loading } = useListingComponents();
      return <Loading />;
    }

    render(
      // Only Empty is overridden; Loading is intentionally left unset.
      <ListingComponentsProvider Empty={CustomEmpty}>
        <Consumer />
      </ListingComponentsProvider>,
    );

    expect(screen.getByRole('status', { busy: true })).toHaveTextContent('Loading…');
  });

  it('useListingComponents() outside any provider returns the context default value', () => {
    const { result } = renderHook(() => useListingComponents());

    expect(result.current.Empty).toBeDefined();
    expect(result.current.Loading).toBeDefined();
    expect(result.current.Card).toBeDefined();

    render(<result.current.Empty />);
    expect(screen.getByText('No results')).toBeInTheDocument();
  });

  it('passes the item prop through to a custom Card and renders derived content', () => {
    interface Property {
      id: string;
      title: string;
    }

    const CustomCard = ({ item }: IListingCardProps) => {
      const property = item as Property;
      return <div>Listing: {property.title}</div>;
    };

    function Consumer({ item }: { item: Property }) {
      const { Card } = useListingComponents();
      return <Card item={item} />;
    }

    render(
      <ListingComponentsProvider Card={CustomCard}>
        <Consumer item={{ id: '1', title: '221B Baker Street' }} />
      </ListingComponentsProvider>,
    );

    expect(screen.getByText('Listing: 221B Baker Street')).toBeInTheDocument();
  });

  it('the default Card fallback defensively derives a title from the item', () => {
    function Consumer({ item }: { item: unknown }) {
      const { Card } = useListingComponents();
      return <Card item={item} />;
    }

    render(
      <ListingComponentsProvider>
        <Consumer item={{ title: 'Fallback title' }} />
      </ListingComponentsProvider>,
    );

    expect(screen.getByText('Fallback title')).toBeInTheDocument();
  });

  it('default Empty and Loading fallbacks are accessible via role="status"', () => {
    function EmptyConsumer() {
      const { Empty } = useListingComponents();
      return <Empty />;
    }

    const { unmount } = render(
      <ListingComponentsProvider>
        <EmptyConsumer />
      </ListingComponentsProvider>,
    );
    expect(screen.getByRole('status')).toHaveTextContent('No results');
    unmount();
  });

  it('unused type-only import guard: IListingEmptyProps has no required members', () => {
    // Compile-time only assertion (no runtime behavior) — proves the empty
    // props interface can be satisfied with `{}`.
    const props: IListingEmptyProps = {};
    expect(props).toEqual({});
  });
});
