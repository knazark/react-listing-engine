import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ComponentType } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
	composeListingProviders,
	withConfig,
	withDataset,
	withFilters,
	withMap,
	type FilterRegistry,
	type ListingProviderMod,
} from '~/core';
import type { EntityAdapter, FilterControlProps, LatLng } from '~/interfaces';
import { ListingProvider, useListing } from '~/react';
import { FakeMapProvider, InMemoryEntityAdapter } from '~/testing';

import { StyledComponentsProviderWithDefaults, StyledListingLayout, type IStyledListingLayoutProps } from '..';

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

const registerQueryFilter = (reg: FilterRegistry<Filters>): void => {
	void reg.add<string>({
		key: 'q',
		order: 0,
		render: QueryControl,
		toParams: value => ({ q: value || undefined }),
		fromParams: filters => filters.q ?? '',
	});
};

/**
 * Wraps the plain `InMemoryEntityAdapter` so a test can hold a query's
 * `list()` call open (mid "in flight") until it explicitly releases it --
 * needed to assert on `pagination.loading`-driven UI (the mobile sheet's
 * apply-button spinner) without a real network delay. `getPoints` passes
 * straight through -- only `list()` (what `applyFilters`/`loadPage` await) is
 * gated.
 */
function createGatedAdapter(): { adapter: EntityAdapter<ListingRow, Filters>; lockNextQuery(): void; release(): void } {
	const base = new InMemoryEntityAdapter<ListingRow, Filters>(rows, predicate, toLatLng);
	let gate: Promise<void> | null = null;
	let releaseGate: (() => void) | null = null;

	const adapter: EntityAdapter<ListingRow, Filters> = {
		async list(filters, page) {
			if (gate) await gate;
			return base.list(filters, page);
		},
		async getPoints(filters, bounds) {
			return base.getPoints(filters, bounds);
		},
	};

	return {
		adapter,
		lockNextQuery() {
			gate = new Promise<void>(resolve => {
				releaseGate = resolve;
			});
		},
		release() {
			releaseGate?.();
			gate = null;
			releaseGate = null;
		},
	};
}

interface IRenderLayoutOptions {
	/** Custom filter registration; `false` registers none. Default: the `q` `QueryControl` filter. */
	filters?: ((reg: FilterRegistry<Filters>) => void) | false;
	layoutProps?: IStyledListingLayoutProps;
	/** Custom dataset adapter, e.g. `createGatedAdapter().adapter` to control when a query settles. Default: a plain `InMemoryEntityAdapter`. */
	adapter?: EntityAdapter<ListingRow, Filters>;
}

/**
 * Renders as a sibling of `<StyledListingLayout>` (same `<ListingProvider>`,
 * so the same context) purely to hand the engine instance back out of
 * `renderLayout` -- `StyledListingLayout` takes no children/render-prop slot
 * of its own, so a probe sibling is the only way a test gets a direct engine
 * reference (e.g. to `vi.spyOn(engine, 'applyFilters')`) without reaching
 * into React internals.
 */
function EngineProbe({ onEngine }: { onEngine: (engine: ReturnType<typeof useListing<ListingRow, Filters>>) => void }) {
	onEngine(useListing<ListingRow, Filters>());
	return null;
}

function renderLayout({ filters, layoutProps, adapter }: IRenderLayoutOptions = {}) {
	const map = new FakeMapProvider();

	const mods: ListingProviderMod<Filters>[] = [
		withDataset<ListingRow, Filters>({
			id: 'p',
			adapter: adapter ?? new InMemoryEntityAdapter<ListingRow, Filters>(rows, predicate, toLatLng),
			marker: { iconUrl: () => '' },
		}),
		withMap<Filters>(map),
		withConfig<Filters>({ debounceMs: 0 }),
	];
	if (filters !== false) mods.push(withFilters<Filters>(filters ?? registerQueryFilter));

	const composed = composeListingProviders<Filters>(...mods);

	let engine!: ReturnType<typeof useListing<ListingRow, Filters>>;

	const view = render(
		<ListingProvider<ListingRow, Filters> {...composed}>
			<StyledComponentsProviderWithDefaults>
				<StyledListingLayout {...layoutProps} />
			</StyledComponentsProviderWithDefaults>
			<EngineProbe
				onEngine={e => {
					engine = e;
				}}
			/>
		</ListingProvider>,
	);

	return { map, container: view.container, engine };
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
		renderLayout({ filters: false, layoutProps: { search: { filterKey: 'q' } } });

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

	it('"Clear all" resets the DRAFT (via toParams) but stays deferred until "Show results" commits it', async () => {
		renderLayout({
			filters: reg =>
				reg.add<string>({
					// Registry key deliberately != the 'q' STATE field it maps to --
					// the old clear-by-`def.key` logic would no-op on this.
					key: 'bedrooms',
					order: 0,
					render: QueryControl,
					toParams: value => ({ q: value || undefined }),
					fromParams: filters => filters.q ?? '',
				}),
		});

		await waitFor(() => expect(screen.getByText('Sunny Loft')).toBeInTheDocument());
		// Apply the filter (desktop bar, still LIVE) -> only Sunny Loft remains.
		fireEvent.change(screen.getAllByLabelText('Query')[0], { target: { value: 'sunny' } });
		await waitFor(() => expect(screen.queryByText('Cozy Studio')).not.toBeInTheDocument());

		fireEvent.click(screen.getByRole('button', { name: 'Filters' }));
		fireEvent.click(screen.getByRole('button', { name: /Clear all/i }));

		// "Clear all" only resets the DRAFT -- the applied results (and thus the
		// count) stay filtered until "Show results" commits it.
		expect(screen.queryByText('Cozy Studio')).not.toBeInTheDocument();

		fireEvent.click(screen.getByRole('button', { name: /Show \d+ results/ }));

		// Fix: cleared via `toParams(fromParams({}))` -> `q` is undefined -> both rows return.
		await waitFor(() => expect(screen.getByText('Cozy Studio')).toBeInTheDocument());
		expect(screen.getByText('Sunny Loft')).toBeInTheDocument();
		await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
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
		renderLayout({ layoutProps: { mobileAction: { label: 'Add', onClick } } });
		await waitFor(() => expect(screen.getByText('Sunny Loft')).toBeInTheDocument());

		fireEvent.click(screen.getByRole('button', { name: 'Add' }));
		expect(onClick).toHaveBeenCalledTimes(1);
	});

	it('omits the header action button when mobileAction is not given', async () => {
		renderLayout();
		await waitFor(() => expect(screen.getByText('Sunny Loft')).toBeInTheDocument());

		expect(screen.queryByRole('button', { name: 'Add' })).not.toBeInTheDocument();
	});

	it('forwards mapControls through to ListingMap, rendered inside the .rle-map region', async () => {
		const { container } = renderLayout({ layoutProps: { mapControls: <button data-testid="zi">+</button> } });
		await waitFor(() => expect(screen.getByText('Sunny Loft')).toBeInTheDocument());

		const mapRegion = container.querySelector('.rle-map');
		expect(mapRegion).toBeInTheDocument();
		expect(mapRegion).toContainElement(screen.getByTestId('zi'));
	});

	it('omits any mapControls overlay when the prop is not given', async () => {
		const { container } = renderLayout();
		await waitFor(() => expect(screen.getByText('Sunny Loft')).toBeInTheDocument());

		expect(container.querySelector('.pointer-events-none')).toBeNull();
	});

	describe('mobile filters sheet apply button', () => {
		it('shows the "Show N results" label, enabled, while not loading', async () => {
			renderLayout();
			await waitFor(() => expect(screen.getByText('Sunny Loft')).toBeInTheDocument());

			fireEvent.click(screen.getByRole('button', { name: 'Filters' }));

			const applyButton = screen.getByRole('button', { name: /Show 2 results/ });
			expect(applyButton).not.toBeDisabled();
			expect(within(applyButton).queryByLabelText('Updating results')).not.toBeInTheDocument();
		});

		it('disables the button and swaps the label for a spinner while a filter-triggered refetch is in flight, then restores it once settled', async () => {
			const gated = createGatedAdapter();
			renderLayout({ adapter: gated.adapter });
			await waitFor(() => expect(screen.getByText('Sunny Loft')).toBeInTheDocument());

			fireEvent.click(screen.getByRole('button', { name: 'Filters' }));
			const applyButton = screen.getByRole('button', { name: /Show 2 results/ });

			// Gate the NEXT query, then trigger one by editing the (only) filter
			// control -- debounceMs is 0, so `applyFilters` flips `pagination.loading`
			// true synchronously, before awaiting the gated `list()` call.
			gated.lockNextQuery();
			fireEvent.change(screen.getAllByLabelText('Query')[0], { target: { value: 'sunny' } });

			expect(applyButton).toBeDisabled();
			expect(within(applyButton).getByLabelText('Updating results')).toHaveClass('rle-spinner');
			expect(within(applyButton).queryByText(/Show \d+ results/)).not.toBeInTheDocument();
			// The sheet itself must stay open/interactive while loading -- only the
			// apply button reflects the in-flight refetch.
			expect(screen.getByRole('dialog')).toBeInTheDocument();

			gated.release();

			await waitFor(() => expect(applyButton).not.toBeDisabled());
			expect(within(applyButton).getByText(/Show 1 results/)).toBeInTheDocument();
			expect(within(applyButton).queryByLabelText('Updating results')).not.toBeInTheDocument();
		});

		it('still closes the sheet when clicked (unchanged click behavior)', async () => {
			renderLayout();
			await waitFor(() => expect(screen.getByText('Sunny Loft')).toBeInTheDocument());

			fireEvent.click(screen.getByRole('button', { name: 'Filters' }));
			expect(screen.getByRole('dialog')).toBeInTheDocument();

			fireEvent.click(screen.getByRole('button', { name: /Show 2 results/ }));
			expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
		});
	});

	describe('mobile filters sheet deferred draft', () => {
		it('buffers a sheet filter edit into the draft, without applying it to the engine, until "Show N results" is clicked', async () => {
			const { engine } = renderLayout();
			await waitFor(() => expect(screen.getByText('Sunny Loft')).toBeInTheDocument());

			fireEvent.click(screen.getByRole('button', { name: 'Filters' }));
			const dialog = screen.getByRole('dialog');

			const applySpy = vi.spyOn(engine, 'applyFilters');
			fireEvent.change(within(dialog).getByLabelText('Query'), { target: { value: 'cozy' } });

			// The draft control itself reflects the edit...
			expect((within(dialog).getByLabelText('Query') as HTMLInputElement).value).toBe('cozy');
			// ...but nothing reached the engine -- applied results are untouched.
			expect(applySpy).not.toHaveBeenCalled();
			expect(screen.getByText('Sunny Loft')).toBeInTheDocument();
			expect(screen.getByText('Cozy Studio')).toBeInTheDocument();
		});

		it('commits the draft to the engine and closes the sheet once the resulting refetch settles', async () => {
			const gated = createGatedAdapter();
			renderLayout({ adapter: gated.adapter });
			await waitFor(() => expect(screen.getByText('Sunny Loft')).toBeInTheDocument());

			fireEvent.click(screen.getByRole('button', { name: 'Filters' }));
			const dialog = screen.getByRole('dialog');
			const applyButton = within(dialog).getByRole('button', { name: /Show \d+ results/ });

			fireEvent.change(within(dialog).getByLabelText('Query'), { target: { value: 'cozy' } });
			// Still buffered -- both rows still shown, nothing applied yet.
			expect(screen.getByText('Sunny Loft')).toBeInTheDocument();

			gated.lockNextQuery();
			fireEvent.click(applyButton);

			// The commit kicked off a real refetch -- sheet stays open while it's
			// in flight, with the existing loader visible on the apply button.
			expect(screen.getByRole('dialog')).toBeInTheDocument();
			expect(applyButton).toBeDisabled();
			expect(within(applyButton).getByLabelText('Updating results')).toHaveClass('rle-spinner');

			gated.release();

			await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
			// The buffered draft actually reached the engine.
			await waitFor(() => expect(screen.queryByText('Sunny Loft')).not.toBeInTheDocument());
			expect(screen.getByText('Cozy Studio')).toBeInTheDocument();
		});

		it('closes immediately (no refetch) when "Show results" is clicked without any draft change', async () => {
			const { engine } = renderLayout();
			await waitFor(() => expect(screen.getByText('Sunny Loft')).toBeInTheDocument());

			fireEvent.click(screen.getByRole('button', { name: 'Filters' }));
			const applySpy = vi.spyOn(engine, 'applyFilters');

			fireEvent.click(screen.getByRole('button', { name: /Show \d+ results/ }));

			expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
			expect(applySpy).not.toHaveBeenCalled();
		});

		it('the desktop ListingFilters keeps applying live even while the mobile sheet has an uncommitted draft', async () => {
			const { container } = renderLayout();
			await waitFor(() => expect(screen.getByText('Sunny Loft')).toBeInTheDocument());

			fireEvent.click(screen.getByRole('button', { name: 'Filters' }));
			const dialog = screen.getByRole('dialog');
			// Buffer a sheet edit that would hide "Sunny Loft" if it were live.
			fireEvent.change(within(dialog).getByLabelText('Query'), { target: { value: 'cozy' } });
			expect(screen.getByText('Sunny Loft')).toBeInTheDocument();

			// The desktop bar's OWN Query control is unaffected by the sheet's
			// draft and still applies straight to the engine.
			const filterBar = container.querySelector('.rle-filter-bar');
			fireEvent.change(within(filterBar as HTMLElement).getByLabelText('Query'), { target: { value: 'sunny' } });

			await waitFor(() => expect(screen.queryByText('Cozy Studio')).not.toBeInTheDocument());
			expect(screen.getByText('Sunny Loft')).toBeInTheDocument();
		});
	});
});
