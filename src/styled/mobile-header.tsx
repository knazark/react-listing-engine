'use client';

import { useListingComponents } from '~/react';

import type { IBottomNavAction } from './bottom-nav';

export interface IMobileHeaderProps {
	/**
	 * Resolved search box props (value/onChange already wired to the engine by
	 * `StyledListingLayout` -- see its `search` handling). Omitted entirely
	 * when the layout was given no `search`.
	 */
	search?: { value: string; onChange: (value: string) => void; placeholder?: string };
	onFiltersClick(): void;
	/** Number of filters currently applied; renders as a count badge on the Filters button when > 0. */
	filterCount?: number;
	/** Optional caller action (e.g. "Save"), rendered as an icon button on the right. */
	action?: IBottomNavAction;
}

/**
 * Mobile-only sticky header (`.rle-mobile-header`, CSS-hidden above the mobile
 * breakpoint -- see `styles.css`'s layout-shell section, the single source of
 * truth for it): the search input (left, flex-grows), a **Filters** button
 * that opens the mobile `BottomSheet`, and the optional caller `action` (e.g.
 * "Save") as a trailing icon button. This is the compact mobile counterpart to
 * the desktop `.rle-filter-bar`: the desktop bar shows the same search plus the
 * full inline filter row, whereas here the remaining filters move behind the
 * Filters button. The `List | Map` view toggle lives in the footer (`BottomNav`).
 */
export function MobileHeader({ search, onFiltersClick, filterCount = 0, action }: IMobileHeaderProps) {
	const { Search } = useListingComponents();

	return (
		<header className="rle-mobile-header">
			{search && (
				<div className="rle-mobile-header__search">
					<Search value={search.value} onChange={search.onChange} placeholder={search.placeholder} />
				</div>
			)}

			<button type="button" className="rle-btn rle-mobile-header__btn" onClick={onFiltersClick}>
				<FiltersIcon />
				<span>Filters</span>
				{filterCount > 0 && <span className="rle-mobile-header__count">{filterCount}</span>}
			</button>

			{action && (
				<button
					type="button"
					className="rle-btn rle-mobile-header__btn rle-mobile-header__btn--icon"
					onClick={action.onClick}
					aria-label={action.label}
				>
					{action.icon ?? <AddIcon />}
				</button>
			)}
		</header>
	);
}

function FiltersIcon() {
	return (
		<svg
			xmlns="http://www.w3.org/2000/svg"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth={2}
			strokeLinecap="round"
			strokeLinejoin="round"
			aria-hidden="true"
		>
			<line x1="4" y1="6" x2="20" y2="6" />
			<circle cx="9" cy="6" r="2" fill="currentColor" stroke="none" />
			<line x1="4" y1="12" x2="20" y2="12" />
			<circle cx="15" cy="12" r="2" fill="currentColor" stroke="none" />
			<line x1="4" y1="18" x2="20" y2="18" />
			<circle cx="11" cy="18" r="2" fill="currentColor" stroke="none" />
		</svg>
	);
}

function AddIcon() {
	return (
		<svg
			xmlns="http://www.w3.org/2000/svg"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth={2}
			strokeLinecap="round"
			strokeLinejoin="round"
			aria-hidden="true"
		>
			<line x1="12" y1="5" x2="12" y2="19" />
			<line x1="5" y1="12" x2="19" y2="12" />
		</svg>
	);
}
