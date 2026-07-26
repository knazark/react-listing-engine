'use client';

import { useListingComponents } from '~/react';

import { AddIcon, FiltersIcon, type IBottomNavAction } from './bottom-nav';

export interface IMobileHeaderProps {
	/**
	 * Resolved search box props (value/onChange already wired to the engine by
	 * `StyledListingLayout` -- see its `search` handling). Omitted entirely
	 * when the layout was given no `search`.
	 */
	search?: { value: string; onChange: (value: string) => void; placeholder?: string };
	onFiltersClick(): void;
	/** Optional caller action (e.g. "Save"), rendered as an icon button on the right. */
	action?: IBottomNavAction;
}

/**
 * Mobile-only sticky header (`.rle-mobile-header`, shown below 768px, hidden at
 * 768px+ by CSS): the search input (left, flex-grows), a **Filters** button
 * that opens the mobile `BottomSheet`, and the optional caller `action` (e.g.
 * "Save") as a trailing icon button. This is the compact mobile counterpart to
 * the desktop `.rle-filter-bar`: the desktop bar shows the same search plus the
 * full inline filter row, whereas here the remaining filters move behind the
 * Filters button. The `List | Map` view toggle lives in the footer (`BottomNav`).
 */
export function MobileHeader({ search, onFiltersClick, action }: IMobileHeaderProps) {
	const { Search } = useListingComponents();

	return (
		<header className="rle-mobile-header">
			{search && (
				<div className="rle-mobile-header__search">
					<Search value={search.value} onChange={search.onChange} placeholder={search.placeholder} />
				</div>
			)}

			<button type="button" className="rle-mobile-header__btn" onClick={onFiltersClick}>
				<FiltersIcon />
				<span>Filters</span>
			</button>

			{action && (
				<button
					type="button"
					className="rle-mobile-header__btn rle-mobile-header__btn--icon"
					onClick={action.onClick}
					aria-label={action.label}
				>
					{action.icon ?? <AddIcon />}
				</button>
			)}
		</header>
	);
}
