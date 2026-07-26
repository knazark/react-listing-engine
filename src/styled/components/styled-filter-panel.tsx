'use client';

import type { IListingFilterPanelProps } from '~/react';

/** Default `/styled` `FilterPanel` slot (`.rle-filter-panel`): stacks one filter control per row inside `Sidebar`. */
export function StyledFilterPanel({ children }: IListingFilterPanelProps) {
	return <div className="rle-filter-panel">{children}</div>;
}
