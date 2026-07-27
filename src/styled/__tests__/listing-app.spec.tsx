import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ComponentType } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { FilterRegistry } from '~/core';
import type { DatasetDefinition, FilterControlProps, LatLng, MapHandle } from '~/interfaces';
import type { IListingCardProps } from '~/react';
import { FakeMapProvider, InMemoryEntityAdapter } from '~/testing';

import { ListingApp } from '..';

// `ListingApp`'s `{ apiKey }` shorthand resolves via a DYNAMIC `import('~/maps/google')` inside
// `useResolvedMap`, so we mock that module to capture the exact config forwarded to `googleProvider`
// (proving `styles`/`mapOptions` are passed through). The other tests in this file use `map.provider`
// or no map, so they never call `googleProvider` and are unaffected by this mock. A no-op
// `MapProvider` stub is returned so the app still mounts a "map" without a real Google loader.
const googleProviderConfigs: Array<Record<string, unknown>> = [];

vi.mock('~/maps/google', () => ({
	googleProvider: (config: Record<string, unknown>) => {
		googleProviderConfigs.push(config);
		const noopUnsub = () => {};
		return {
			mount: (): MapHandle => ({ raw: {} }),
			renderLayer: () => noopUnsub,
			onBoundsChange: () => noopUnsub,
			fitBounds: () => {},
			destroy: () => {},
		};
	},
}));

afterEach(() => {
	cleanup();
	googleProviderConfigs.length = 0;
});

// -----------------------------------------------------------------------------
// Fixtures -- same shape/spirit as `/styled`'s own `layout.spec.tsx`.
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
	it('renders the full experience end to end via the /styled defaults, going full-width with no map provided', async () => {
		const { container } = render(
			<ListingApp<ListingRow, Filters> datasets={[makeDataset()]} config={{ debounceMs: 0 }} />,
		);

		await waitFor(() => expect(screen.getByText('Sunny Loft')).toBeInTheDocument());
		expect(screen.getByText('Cozy Studio')).toBeInTheDocument();
		expect(screen.getByText('2 results')).toBeInTheDocument();
		// No map -> no map region + no "Map unavailable" fallback; the list body
		// goes full-width (list-only) instead of reserving half the viewport.
		expect(container.querySelector('.rle-map')).toBeNull();
		expect(container.querySelector('.rle-body--list-only')).toBeInTheDocument();
		expect(screen.queryByText('Map unavailable')).not.toBeInTheDocument();
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
		// results" text is only ever rendered by the Styled* components. (No map
		// was passed, so the layout is full-width with no map region to check.)
		expect(screen.getByText('2 results')).toBeInTheDocument();
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

	it('forwards styles + mapOptions (api-key shape) into the internally-built googleProvider', async () => {
		const styles = [{ elementType: 'geometry', stylers: [{ color: '#242f3e' }] }] as google.maps.MapTypeStyle[];
		const mapOptions: Partial<google.maps.MapOptions> = { disableDefaultUI: true, minZoom: 3 };

		render(
			<ListingApp<ListingRow, Filters>
				datasets={[makeDataset()]}
				config={{ debounceMs: 0 }}
				map={{ apiKey: 'test-key', mapId: 'ignored-with-styles', styles, mapOptions }}
			/>,
		);

		// The dynamic import + googleProvider() call happen in a resolve-map effect, so wait for it.
		await waitFor(() => expect(googleProviderConfigs.length).toBeGreaterThan(0));

		const config = googleProviderConfigs.at(-1)!;
		expect(config.apiKey).toBe('test-key');
		expect(config.mapId).toBe('ignored-with-styles');
		expect(config.styles).toBe(styles);
		expect(config.mapOptions).toBe(mapOptions);
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

	it('shows the mapControls node floating over the map, when a map is configured', async () => {
		const map = new FakeMapProvider();

		render(
			<ListingApp<ListingRow, Filters>
				datasets={[makeDataset()]}
				config={{ debounceMs: 0 }}
				map={{ provider: map }}
				mapControls={<button data-testid="zi">+</button>}
			/>,
		);

		await waitFor(() => expect(screen.getByText('Sunny Loft')).toBeInTheDocument());
		await waitFor(() => expect(map.mounts.length).toBeGreaterThan(0));
		expect(screen.getByTestId('zi')).toBeInTheDocument();
	});

	it('renders no mapControls overlay when the prop is omitted', async () => {
		const map = new FakeMapProvider();

		const { container } = render(
			<ListingApp<ListingRow, Filters> datasets={[makeDataset()]} config={{ debounceMs: 0 }} map={{ provider: map }} />,
		);

		await waitFor(() => expect(screen.getByText('Sunny Loft')).toBeInTheDocument());
		await waitFor(() => expect(map.mounts.length).toBeGreaterThan(0));
		expect(container.querySelector('.pointer-events-none')).toBeNull();
	});
});
