'use client';

import type { IListingEmptyProps } from '~/react';

/** Default `/styled` `Empty` slot: a centered empty state with an icon, heading and hint. */
export function StyledEmpty(_props: IListingEmptyProps) {
	return (
		<div role="status" className="rle-empty">
			<svg
				xmlns="http://www.w3.org/2000/svg"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				strokeWidth={1.5}
				strokeLinecap="round"
				strokeLinejoin="round"
				className="rle-empty-icon"
				aria-hidden="true"
			>
				<circle cx="11" cy="11" r="7" />
				<path d="m21 21-4.3-4.3" />
			</svg>
			<p className="rle-empty-title">No results</p>
			<p className="rle-empty-hint">Try adjusting your filters or search terms.</p>
		</div>
	);
}
