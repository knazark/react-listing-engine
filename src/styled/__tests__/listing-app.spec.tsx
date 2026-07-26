import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ComponentType } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { FilterRegistry } from '~/core';
import type { DatasetDefinition, FilterControlProps, LatLng } from '~/interfaces';
import type { IListingCardProps } from '~/react';
import { FakeMapProvider, InMemoryEntityAdapter } from '~/testing';

import { ListingApp } from '..';

afterEach(() => {
	cleanup();
});

// -----------------------------------------------------------------------------
// Fixtures -- same shape/spirit as `/shadcn`'s `listing-app.spec.tsx` and
// `/styled`'s own `layout.spec.tsx`.
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

const QueryControl: ComponentType<FilterControlProps<string>> = ({ value, onChange }) => (
	<input aria-label="Query" value={value} onChange={event => onChange(event.target.value)} />
);

function withQueryFilter(reg: FilterRegistry<Filters>): void {
	reg.add<string>({
		key: 'q',
		order: 0,
		render: QueryControl,
		toParams: value => ({ q: value || undefined }),
		fromParams: filters => filters.q ?? '',
	});
}

const CustomCard: ComponentType<IListingCardProps> = ({ item }) => {
	const row = item as ListingRow;
	return <div data-testid="custom-card">CUSTOM: {row.title}</div>;
};

describe('ListingApp (styled)', () => {
	it('renders the full experience end to end via the /styled defaults, with no map provided', async () => {
		render(<ListingApp<ListingRow, Filters> datasets={[makeDataset()]} config={{ debounceMs: 0 }} />);

		await waitFor(() => expect(screen.getByText('Sunny Loft')).toBeInTheDocument());
		expect(screen.getByText('Cozy Studio')).toBeInTheDocument();
		expect(screen.getByText('2 results')).toBeInTheDocument();
		expect(screen.getByText('Map unavailable')).toBeInTheDocument();
	});

	it('a components.Card override renders OVER the /styled defaults, proving the merge', async () => {
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

		// Every OTHER slot still comes from the /styled defaults, not the
		// package's bare/unstyled internal fallbacks -- StyledResultHeader's "N
		// results" text and the styled map-unavailable fallback are both only
		// ever rendered by the Styled* components.
		expect(screen.getByText('2 results')).toBeInTheDocument();
		expect(screen.getByText('Map unavailable')).toBeInTheDocument();
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
		expect(screen.queryByText('Map unavailable')).not.toBeInTheDocument();
	});

	it('initialFilters hydrate into the FIRST query -- only the matching row renders', async () => {
		render(
			<ListingApp<ListingRow, Filters>
				datasets={[makeDataset()]}
				config={{ debounceMs: 0 }}
				filters={withQueryFilter}
				initialFilters={{ q: 'cozy' }}
			/>,
		);

		await waitFor(() => expect(screen.getByText('Cozy Studio')).toBeInTheDocument());
		expect(screen.queryByText('Sunny Loft')).not.toBeInTheDocument();
		expect(screen.getByLabelText('Query')).toHaveValue('cozy');
	});

	it('fires onFiltersChange with the new filters when a filter changes, via the EVENT-based URL API', async () => {
		const onFiltersChange = vi.fn();

		render(
			<ListingApp<ListingRow, Filters>
				datasets={[makeDataset()]}
				config={{ debounceMs: 0 }}
				filters={withQueryFilter}
				initialFilters={{ q: 'cozy' }}
				onFiltersChange={onFiltersChange}
			/>,
		);

		// Documented choice (see `ListingAppProps.onFiltersChange`): the mount
		// autoFetch round-trips through applyFilters({}), so the FIRST call
		// re-emits the very initialFilters this component was given -- a
		// same-value echo, not suppressed.
		await waitFor(() => expect(onFiltersChange).toHaveBeenCalledWith({ q: 'cozy' }));

		onFiltersChange.mockClear();

		fireEvent.change(screen.getByLabelText('Query'), { target: { value: 'sunny' } });

		await waitFor(() => expect(onFiltersChange).toHaveBeenCalledWith({ q: 'sunny' }));
		// The library itself never touched window.history -- there is nothing
		// to assert there; onFiltersChange firing IS the whole contract.
	});

	it('forwards mobileAction through to the styled layout -- the bottom-nav "Add" button appears and fires onClick', async () => {
		const onClick = vi.fn();

		render(
			<ListingApp<ListingRow, Filters>
				datasets={[makeDataset()]}
				config={{ debounceMs: 0 }}
				mobileAction={{ label: 'Add', onClick }}
			/>,
		);

		await waitFor(() => expect(screen.getByText('Sunny Loft')).toBeInTheDocument());

		const addButton = screen.getByRole('button', { name: 'Add' });
		expect(addButton).toBeInTheDocument();

		fireEvent.click(addButton);
		expect(onClick).toHaveBeenCalledTimes(1);
	});

	it('omits the bottom-nav action button when mobileAction is not given', async () => {
		render(<ListingApp<ListingRow, Filters> datasets={[makeDataset()]} config={{ debounceMs: 0 }} />);

		await waitFor(() => expect(screen.getByText('Sunny Loft')).toBeInTheDocument());
		expect(screen.queryByRole('button', { name: 'Add' })).not.toBeInTheDocument();
	});
});
