import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ComponentType } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { composeListingProviders, withConfig, withDataset, withFilters, withMap } from '~/core';
import type { FilterControlProps, LatLng } from '~/interfaces';
import { ListingProvider } from '~/react';
import { FakeMapProvider, InMemoryEntityAdapter } from '~/testing';

import { StyledComponentsProviderWithDefaults, StyledListingLayout, type IBottomNavAction } from '..';

afterEach(() => {
	cleanup();
});

// -----------------------------------------------------------------------------
// Fixtures -- same shape/spirit as `listing-app.spec.tsx`.
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

const QueryControl: ComponentType<FilterControlProps<string>> = ({ value, onChange }) => (
	<input aria-label="Query" value={value} onChange={event => onChange(event.target.value)} />
);

function renderLayout(mobileAction?: IBottomNavAction) {
	const map = new FakeMapProvider();

	const composed = composeListingProviders<Filters>(
		withDataset<ListingRow, Filters>({
			id: 'p',
			adapter: new InMemoryEntityAdapter<ListingRow, Filters>(rows, predicate, toLatLng),
			marker: { iconUrl: () => '' },
		}),
		withFilters<Filters>(reg =>
			reg.add<string>({
				key: 'q',
				order: 0,
				render: QueryControl,
				toParams: value => ({ q: value || undefined }),
				fromParams: filters => filters.q ?? '',
			}),
		),
		withMap<Filters>(map),
		withConfig<Filters>({ debounceMs: 0 }),
	);

	const view = render(
		<ListingProvider<ListingRow, Filters> {...composed}>
			<StyledComponentsProviderWithDefaults>
				<StyledListingLayout mobileAction={mobileAction} />
			</StyledComponentsProviderWithDefaults>
		</ListingProvider>,
	);

	return { map, container: view.container };
}

describe('StyledListingLayout', () => {
	it('renders the desktop filter bar with the filter control and result header', async () => {
		const { container } = renderLayout();

		await waitFor(() => expect(screen.getByText('Sunny Loft')).toBeInTheDocument());

		const filterBar = container.querySelector('.rle-filter-bar');
		expect(filterBar).toBeInTheDocument();
		expect(filterBar).toContainElement(screen.getByLabelText('Query'));
		expect(filterBar).toContainElement(screen.getByText('2 results'));
	});

	it('drives its filterKey directly on the engine when a `search` box is given', async () => {
		// No registered filter -- the filter-bar search box is the only thing
		// touching `q`, proving the LIBRARY wires `search.filterKey` to the
		// engine (value read from filters, edits via applyFilters).
		const map = new FakeMapProvider();
		const composed = composeListingProviders<Filters>(
			withDataset<ListingRow, Filters>({
				id: 'p',
				adapter: new InMemoryEntityAdapter<ListingRow, Filters>(rows, predicate, toLatLng),
				marker: { iconUrl: () => '' },
			}),
			withMap<Filters>(map),
			withConfig<Filters>({ debounceMs: 0 }),
		);

		render(
			<ListingProvider<ListingRow, Filters> {...composed}>
				<StyledComponentsProviderWithDefaults>
					<StyledListingLayout search={{ filterKey: 'q' }} />
				</StyledComponentsProviderWithDefaults>
			</ListingProvider>,
		);

		await waitFor(() => expect(screen.getByText('Sunny Loft')).toBeInTheDocument());
		expect(screen.getByText('Cozy Studio')).toBeInTheDocument();

		// The single filter-bar search box drives the engine field.
		fireEvent.change(screen.getByLabelText('Search'), { target: { value: 'sunny' } });

		await waitFor(() => expect(screen.queryByText('Cozy Studio')).not.toBeInTheDocument());
		expect(screen.getByText('Sunny Loft')).toBeInTheDocument();
		// The controlled value round-trips back through the engine into the box.
		expect((screen.getByLabelText('Search') as HTMLInputElement).value).toBe('sunny');
	});

	it('renders the List|Map toggle and no "Filters" button (filters are inline, no sheet)', async () => {
		renderLayout();
		await waitFor(() => expect(screen.getByText('Sunny Loft')).toBeInTheDocument());

		expect(screen.getByRole('navigation', { name: 'Listing navigation' })).toBeInTheDocument();
		expect(screen.getByRole('button', { name: 'List' })).toHaveAttribute('aria-pressed', 'true');
		expect(screen.getByRole('button', { name: 'Map' })).toHaveAttribute('aria-pressed', 'false');
		// Filters live inline in the bar now -- there is no Filters button or sheet.
		expect(screen.queryByRole('button', { name: 'Filters' })).not.toBeInTheDocument();
		expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
	});

	it('the List|Map toggle flips data-mobile-view on the body region', async () => {
		const { container } = renderLayout();
		await waitFor(() => expect(screen.getByText('Sunny Loft')).toBeInTheDocument());

		const body = container.querySelector('.rle-body');
		expect(body).toHaveAttribute('data-mobile-view', 'list');

		fireEvent.click(screen.getByRole('button', { name: 'Map' }));
		expect(body).toHaveAttribute('data-mobile-view', 'map');
		expect(screen.getByRole('button', { name: 'Map' })).toHaveAttribute('aria-pressed', 'true');
		expect(screen.getByRole('button', { name: 'List' })).toHaveAttribute('aria-pressed', 'false');

		fireEvent.click(screen.getByRole('button', { name: 'List' }));
		expect(body).toHaveAttribute('data-mobile-view', 'list');
	});

	it('fires mobileAction.onClick when the filter-bar action button is clicked', async () => {
		const onClick = vi.fn();
		renderLayout({ label: 'Add', onClick });
		await waitFor(() => expect(screen.getByText('Sunny Loft')).toBeInTheDocument());

		fireEvent.click(screen.getByRole('button', { name: 'Add' }));
		expect(onClick).toHaveBeenCalledTimes(1);
	});

	it('omits the filter-bar action button when mobileAction is not given', async () => {
		renderLayout();
		await waitFor(() => expect(screen.getByText('Sunny Loft')).toBeInTheDocument());

		expect(screen.queryByRole('button', { name: 'Add' })).not.toBeInTheDocument();
	});
});
