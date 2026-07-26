import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
	it('renders the desktop filter bar with the filter control, and the result header above the list', async () => {
		const { container } = renderLayout();

		await waitFor(() => expect(screen.getByText('Sunny Loft')).toBeInTheDocument());

		const filterBar = container.querySelector('.rle-filter-bar');
		expect(filterBar).toBeInTheDocument();
		expect(filterBar).toContainElement(screen.getByLabelText('Query'));
		// The result header moved out of the filter bar into `.rle-list-header`.
		const listHeader = container.querySelector('.rle-list-header');
		expect(listHeader).toBeInTheDocument();
		expect(listHeader).toContainElement(screen.getByText('2 results'));
	});

	it('drives its filterKey directly on the engine when a `search` box is given', async () => {
		// No registered filter -- the header/desktop-bar search box is the only
		// thing touching `q`, proving the LIBRARY wires `search.filterKey` to the
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

		// The box renders in BOTH the desktop bar and the mobile header -- both
		// are wired to the same engine field, so editing either drives `q`.
		const boxes = screen.getAllByLabelText('Search');
		expect(boxes.length).toBeGreaterThanOrEqual(2);
		fireEvent.change(boxes[0], { target: { value: 'sunny' } });

		await waitFor(() => expect(screen.queryByText('Cozy Studio')).not.toBeInTheDocument());
		expect(screen.getByText('Sunny Loft')).toBeInTheDocument();
		// The controlled value round-trips back through the engine into every box.
		expect((screen.getAllByLabelText('Search')[1] as HTMLInputElement).value).toBe('sunny');
	});

	it('renders the Filters button (mobile header) and the List|Map toggle (footer nav)', async () => {
		renderLayout();
		await waitFor(() => expect(screen.getByText('Sunny Loft')).toBeInTheDocument());

		expect(screen.getByRole('navigation', { name: 'Listing navigation' })).toBeInTheDocument();
		expect(screen.getByRole('button', { name: 'Filters' })).toBeInTheDocument();
		expect(screen.getByRole('button', { name: 'List' })).toHaveAttribute('aria-pressed', 'true');
		expect(screen.getByRole('button', { name: 'Map' })).toHaveAttribute('aria-pressed', 'false');
	});

	it('opens the filters bottom sheet when Filters is clicked, and closes it via its own close button', async () => {
		renderLayout();
		await waitFor(() => expect(screen.getByText('Sunny Loft')).toBeInTheDocument());

		expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

		fireEvent.click(screen.getByRole('button', { name: 'Filters' }));

		const dialog = screen.getByRole('dialog', { name: 'Filters' });
		expect(dialog).toBeInTheDocument();
		// The sheet stacks the SAME ListingFilters control the desktop bar uses --
		// there are now two "Query" inputs on the page (bar + sheet).
		expect(screen.getAllByLabelText('Query')).toHaveLength(2);
		expect(within(dialog).getByText(/Show 2 results/)).toBeInTheDocument();

		fireEvent.click(screen.getByRole('button', { name: 'Close' }));
		expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
	});

	it('closes the sheet via "Show N results" in its footer', async () => {
		renderLayout();
		await waitFor(() => expect(screen.getByText('Sunny Loft')).toBeInTheDocument());

		fireEvent.click(screen.getByRole('button', { name: 'Filters' }));
		expect(screen.getByRole('dialog')).toBeInTheDocument();

		fireEvent.click(screen.getByRole('button', { name: /Show 2 results/ }));
		expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
	});

	it('"Clear all" resets a filter whose registry key differs from its state field (via toParams)', async () => {
		const map = new FakeMapProvider();
		const composed = composeListingProviders<Filters>(
			withDataset<ListingRow, Filters>({
				id: 'p',
				adapter: new InMemoryEntityAdapter<ListingRow, Filters>(rows, predicate, toLatLng),
				marker: { iconUrl: () => '' },
			}),
			withFilters<Filters>(reg =>
				reg.add<string>({
					// Registry key deliberately != the 'q' STATE field it maps to --
					// the old clear-by-`def.key` logic would no-op on this.
					key: 'bedrooms',
					order: 0,
					render: QueryControl,
					toParams: value => ({ q: value || undefined }),
					fromParams: filters => filters.q ?? '',
				}),
			),
			withMap<Filters>(map),
			withConfig<Filters>({ debounceMs: 0 }),
		);

		render(
			<ListingProvider<ListingRow, Filters> {...composed}>
				<StyledComponentsProviderWithDefaults>
					<StyledListingLayout />
				</StyledComponentsProviderWithDefaults>
			</ListingProvider>,
		);

		await waitFor(() => expect(screen.getByText('Sunny Loft')).toBeInTheDocument());
		// Apply the filter -> only Sunny Loft remains.
		fireEvent.change(screen.getAllByLabelText('Query')[0], { target: { value: 'sunny' } });
		await waitFor(() => expect(screen.queryByText('Cozy Studio')).not.toBeInTheDocument());

		fireEvent.click(screen.getByRole('button', { name: 'Filters' }));
		fireEvent.click(screen.getByRole('button', { name: /Clear all/i }));

		// Fix: cleared via `toParams(fromParams({}))` -> `q` is undefined -> both rows return.
		await waitFor(() => expect(screen.getByText('Cozy Studio')).toBeInTheDocument());
		expect(screen.getByText('Sunny Loft')).toBeInTheDocument();
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

	it('fires mobileAction.onClick when the header action button is clicked', async () => {
		const onClick = vi.fn();
		renderLayout({ label: 'Add', onClick });
		await waitFor(() => expect(screen.getByText('Sunny Loft')).toBeInTheDocument());

		fireEvent.click(screen.getByRole('button', { name: 'Add' }));
		expect(onClick).toHaveBeenCalledTimes(1);
	});

	it('omits the header action button when mobileAction is not given', async () => {
		renderLayout();
		await waitFor(() => expect(screen.getByText('Sunny Loft')).toBeInTheDocument());

		expect(screen.queryByRole('button', { name: 'Add' })).not.toBeInTheDocument();
	});
});
