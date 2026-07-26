import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { MapPoint } from '~/interfaces';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
	StyledCard,
	StyledEmpty,
	StyledFilterPanel,
	StyledLoading,
	StyledMarker,
	StyledPopup,
	StyledResultHeader,
	StyledSearch,
	StyledSidebar,
	styledDefaultComponents,
	StyledToolbar,
} from '..';

afterEach(() => {
	cleanup();
});

// -----------------------------------------------------------------------------
// Individual styled components, rendered in isolation against the slot prop
// interfaces they implement -- every assertion below anchors on an `.rle-*`
// class name from styles.css, never a Tailwind utility.
// -----------------------------------------------------------------------------

describe('StyledCard', () => {
	it('derives title, subtitle, badge and price from a plain view-model item, using rle-* classes', () => {
		render(
			<StyledCard item={{ title: 'Sunny Loft', subtitle: 'Downtown', price: 1200, badge: 'New' }} onSelect={() => {}} />,
		);

		const title = screen.getByText('Sunny Loft');
		expect(title).toHaveClass('rle-card-title');
		const subtitle = screen.getByText('Downtown');
		expect(subtitle).toHaveClass('rle-card-address');
		expect(screen.getByText('New')).toHaveClass('rle-card-info-item');

		// currency-formatted, USD, 0 decimals
		const price = screen.getByText('$1,200');
		expect(price).toHaveClass('rle-card-price');
	});

	it('passes a string price through unformatted', () => {
		render(<StyledCard item={{ title: 'X', price: 'Call for price' }} />);
		expect(screen.getByText('Call for price')).toBeInTheDocument();
	});

	it('renders as a non-interactive article (no button role, base rle-card class) when onSelect is omitted', () => {
		render(<StyledCard item={{}} />);
		expect(screen.queryByRole('button')).not.toBeInTheDocument();
		const article = document.querySelector('article');
		expect(article).toHaveClass('rle-card');
	});

	it('calls onSelect when clicked, and reflects `selected` via aria-pressed + rle-card--selected', () => {
		const onSelect = vi.fn();
		const { rerender } = render(<StyledCard item={{ title: 'X' }} selected={false} onSelect={onSelect} />);

		const button = screen.getByRole('button');
		expect(button).toHaveClass('rle-card');
		expect(button).not.toHaveClass('rle-card--selected');
		expect(button).toHaveAttribute('aria-pressed', 'false');

		fireEvent.click(button);
		expect(onSelect).toHaveBeenCalledTimes(1);

		rerender(<StyledCard item={{ title: 'X' }} selected onSelect={onSelect} />);
		expect(screen.getByRole('button')).toHaveClass('rle-card--selected');
		expect(screen.getByRole('button')).toHaveAttribute('aria-pressed', 'true');
	});

	it('renders an image when imageUrl is given, and a placeholder block otherwise', () => {
		const { rerender } = render(<StyledCard item={{ imageUrl: 'https://example.com/a.jpg', title: 'X' }} />);
		const img = screen.getByRole('img') as HTMLImageElement;
		expect(img).toHaveClass('rle-card-media');
		expect(img.src).toBe('https://example.com/a.jpg');

		rerender(<StyledCard item={{ title: 'X' }} />);
		expect(screen.queryByRole('img')).not.toBeInTheDocument();
		const placeholder = document.querySelector('.rle-card-media--placeholder');
		expect(placeholder).toBeInTheDocument();
		expect(placeholder).toHaveClass('rle-card-media');
	});
});

describe('StyledMarker', () => {
	it('renders a currency-formatted price pin via .rle-pin', () => {
		const point: MapPoint<{ price: number }> = { id: 'a', position: { lat: 0, lng: 0 }, entity: { price: 1200 } };
		render(<StyledMarker point={point} />);
		const marker = screen.getByText('$1,200');
		expect(marker).toHaveClass('rle-pin');
	});

	it('renders an empty pin when entity has no price', () => {
		const point: MapPoint<Record<string, never>> = { id: 'a', position: { lat: 0, lng: 0 }, entity: {} };
		const { container } = render(<StyledMarker point={point} />);
		expect(container.querySelector('.rle-pin')).toHaveTextContent('');
	});
});

describe('StyledPopup', () => {
	it('renders entity fields (currency-formatted price) and an accessible close button that calls onClose', () => {
		const onClose = vi.fn();
		render(<StyledPopup entity={{ title: 'Loft', price: 500 }} onClose={onClose} />);

		expect(screen.getByText('Loft')).toHaveClass('rle-card-title');
		expect(screen.getByText('$500')).toHaveClass('rle-card-price');

		const closeButton = screen.getByRole('button', { name: 'Close' });
		expect(closeButton).toHaveClass('rle-popup-close');
		fireEvent.click(closeButton);
		expect(onClose).toHaveBeenCalledTimes(1);
	});

	it('exposes itself as a non-modal group with an accessible name, not a dialog, via .rle-popup', () => {
		render(<StyledPopup entity={{ title: 'Loft' }} onClose={() => {}} />);

		const popup = screen.getByRole('group', { name: 'Location details' });
		expect(popup).toHaveClass('rle-popup');
		expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
	});
});

describe('StyledEmpty', () => {
	it('shows a "No results" status region via .rle-empty', () => {
		render(<StyledEmpty />);
		const status = screen.getByRole('status');
		expect(status).toHaveClass('rle-empty');
		expect(screen.getByText('No results')).toBeInTheDocument();
	});
});

describe('StyledLoading', () => {
	it('renders a busy .rle-loading skeleton grid of .rle-skeleton blocks', () => {
		const { container } = render(<StyledLoading />);
		const status = screen.getByRole('status');
		expect(status).toHaveClass('rle-loading');
		expect(status).toHaveAttribute('aria-busy', 'true');
		expect(container.querySelectorAll('.rle-skeleton').length).toBeGreaterThan(0);
	});
});

describe('StyledResultHeader', () => {
	it('shows the count via .rle-result-header', () => {
		render(<StyledResultHeader count={3} />);
		const header = screen.getByText('3 results');
		expect(header).toHaveClass('rle-result-header');
	});

	it('shows the total when given and different from count', () => {
		render(<StyledResultHeader count={3} total={30} />);
		expect(screen.getByText('3 of 30 results')).toBeInTheDocument();
	});
});

describe('StyledToolbar', () => {
	it('wraps children in .rle-toolbar', () => {
		const { container } = render(
			<StyledToolbar>
				<span>toolbar-content</span>
			</StyledToolbar>,
		);
		expect(screen.getByText('toolbar-content')).toBeInTheDocument();
		expect(container.querySelector('.rle-toolbar')).toBeInTheDocument();
	});
});

describe('StyledSidebar / StyledFilterPanel', () => {
	it('both render their children with rle-sidebar / rle-filter-panel classes', () => {
		const { container } = render(
			<StyledSidebar>
				<StyledFilterPanel>
					<span>filter-control</span>
				</StyledFilterPanel>
			</StyledSidebar>,
		);
		expect(screen.getByText('filter-control')).toBeInTheDocument();
		expect(container.querySelector('.rle-sidebar')).toBeInTheDocument();
		expect(container.querySelector('.rle-filter-panel')).toBeInTheDocument();
	});
});

describe('StyledSearch', () => {
	it('renders a labeled .rle-input and forwards changes via onChange', () => {
		const onChange = vi.fn();
		render(<StyledSearch value="" onChange={onChange} placeholder="Search listings" />);

		const input = screen.getByPlaceholderText('Search listings');
		expect(input).toHaveClass('rle-input');
		fireEvent.change(input, { target: { value: 'loft' } });
		expect(onChange).toHaveBeenCalledWith('loft');
	});
});

// -----------------------------------------------------------------------------
// styledDefaultComponents -- the object every consumer/Phase-2 layout wires up.
// -----------------------------------------------------------------------------

describe('styledDefaultComponents', () => {
	it('provides a component for all 10 IListingComponents slots', () => {
		const slots = [
			'Card',
			'Marker',
			'Popup',
			'Sidebar',
			'FilterPanel',
			'Search',
			'Empty',
			'Loading',
			'ResultHeader',
			'Toolbar',
		] as const;

		expect(Object.keys(styledDefaultComponents)).toHaveLength(slots.length);
		for (const slot of slots) {
			expect(styledDefaultComponents[slot]).toBeTypeOf('function');
		}
	});

	it('maps each slot to its matching Styled* component', () => {
		expect(styledDefaultComponents.Card).toBe(StyledCard);
		expect(styledDefaultComponents.Marker).toBe(StyledMarker);
		expect(styledDefaultComponents.Popup).toBe(StyledPopup);
		expect(styledDefaultComponents.Sidebar).toBe(StyledSidebar);
		expect(styledDefaultComponents.FilterPanel).toBe(StyledFilterPanel);
		expect(styledDefaultComponents.Search).toBe(StyledSearch);
		expect(styledDefaultComponents.Empty).toBe(StyledEmpty);
		expect(styledDefaultComponents.Loading).toBe(StyledLoading);
		expect(styledDefaultComponents.ResultHeader).toBe(StyledResultHeader);
		expect(styledDefaultComponents.Toolbar).toBe(StyledToolbar);
	});
});
