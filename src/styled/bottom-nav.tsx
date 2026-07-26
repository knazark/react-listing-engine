'use client';

import type { ReactNode } from 'react';

export type BottomNavView = 'list' | 'map';

export interface IBottomNavAction {
	label: string;
	icon?: ReactNode;
	onClick(): void;
}

export interface IBottomNavProps {
	view: BottomNavView;
	onViewChange(view: BottomNavView): void;
	onFiltersClick(): void;
	action?: IBottomNavAction;
}

/**
 * Mobile-only bottom navigation bar (`.rle-bottom-nav`, hidden at 768px+ by
 * CSS -- see `styles.css`): a **Filters** button that opens the mobile
 * `BottomSheet`, an optional caller-supplied `action` button (e.g. "Add"),
 * and a **List | Map** segmented toggle (`.rle-viewtoggle`) that drives which
 * of `StyledListingLayout`'s two full-area panels is visible. No lucide/icon
 * library dependency -- every icon here is a small inline SVG, matching the
 * rest of `/styled`'s zero-extra-dependency policy.
 */
export function BottomNav({ view, onViewChange, onFiltersClick, action }: IBottomNavProps) {
	return (
		<nav className="rle-bottom-nav" aria-label="Listing navigation">
			<button type="button" className="rle-bottom-nav__btn" onClick={onFiltersClick}>
				<FiltersIcon />
				<span>Filters</span>
			</button>

			{action && (
				<button type="button" className="rle-bottom-nav__btn" onClick={action.onClick}>
					{action.icon ?? <AddIcon />}
					<span>{action.label}</span>
				</button>
			)}

			<div className="rle-viewtoggle" role="group" aria-label="View">
				<button
					type="button"
					className={`rle-viewtoggle__btn${view === 'list' ? ' rle-viewtoggle__btn--active' : ''}`}
					aria-pressed={view === 'list'}
					onClick={() => onViewChange('list')}
				>
					<ListIcon />
					List
				</button>
				<button
					type="button"
					className={`rle-viewtoggle__btn${view === 'map' ? ' rle-viewtoggle__btn--active' : ''}`}
					aria-pressed={view === 'map'}
					onClick={() => onViewChange('map')}
				>
					<MapIcon />
					Map
				</button>
			</div>
		</nav>
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

function ListIcon() {
	return (
		<svg
			xmlns="http://www.w3.org/2000/svg"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth={2}
			strokeLinecap="round"
			strokeLinejoin="round"
			width="16"
			height="16"
			aria-hidden="true"
		>
			<line x1="8" y1="6" x2="20" y2="6" />
			<line x1="8" y1="12" x2="20" y2="12" />
			<line x1="8" y1="18" x2="20" y2="18" />
			<line x1="4" y1="6" x2="4.01" y2="6" />
			<line x1="4" y1="12" x2="4.01" y2="12" />
			<line x1="4" y1="18" x2="4.01" y2="18" />
		</svg>
	);
}

function MapIcon() {
	return (
		<svg
			xmlns="http://www.w3.org/2000/svg"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth={2}
			strokeLinecap="round"
			strokeLinejoin="round"
			width="16"
			height="16"
			aria-hidden="true"
		>
			<polygon points="1 6 8 3 16 6 23 3 23 18 16 21 8 18 1 21 1 6" />
			<line x1="8" y1="3" x2="8" y2="18" />
			<line x1="16" y1="6" x2="16" y2="21" />
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
