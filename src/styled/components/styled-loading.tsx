'use client';

import type { IListingLoadingProps } from '~/react';

const SKELETON_ROWS = 3;

/** Default `/styled` `Loading` slot: a shimmering `.rle-skeleton` grid, announced via `role="status"`. */
export function StyledLoading(_props: IListingLoadingProps) {
	return (
		<div className="rle-loading" role="status" aria-busy="true" aria-label="Loading results">
			{Array.from({ length: SKELETON_ROWS }).map((_, index) => (
				<div key={index} className="rle-loading-item">
					<div className="rle-skeleton" style={{ aspectRatio: '4 / 3', width: '100%' }} />
					<div className="rle-skeleton" style={{ height: 16, width: '65%' }} />
					<div className="rle-skeleton" style={{ height: 12, width: '35%' }} />
				</div>
			))}
		</div>
	);
}
