'use client';

import type { ReactNode } from 'react';

export type BottomNavView = 'list' | 'map';

/**
 * An action button in the mobile chrome (e.g. "Add"/"Save"). Despite the
 * name (kept for API compatibility), it renders in `MobileHeader`, not here.
 */
export interface IBottomNavAction {
	label: string;
	icon?: ReactNode;
	onClick(): void;
}

export interface IBottomNavProps {
	view: BottomNavView;
	onViewChange(view: BottomNavView): void;
}

/**
 * Mobile-only bottom navigation (`.rle-bottom-nav`, CSS-hidden above the
 * mobile breakpoint -- see `styles.css`'s layout-shell section, the single
 * source of truth for it): a floating **List | Map** segmented toggle
 * (`.rle-viewtoggle`) that drives which of `StyledListingLayout`'s two
 * full-area panels is visible. The **Filters** button and the optional caller
 * action (e.g. "Save") live in the mobile header (`MobileHeader`) instead, so
 * the footer pill carries the view toggle alone. No lucide/icon library
 * dependency -- every icon here is a small inline SVG, matching the rest of
 * `/styled`'s zero-extra-dependency policy.
 */
export function BottomNav({ view, onViewChange }: IBottomNavProps) {
	return (
		<nav className="rle-bottom-nav" aria-label="Listing navigation">
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
