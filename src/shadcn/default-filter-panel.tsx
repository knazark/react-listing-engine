'use client';

import type { IListingFilterPanelProps } from '~/react';

/** Default styled `FilterPanel` slot: stacks one filter control per row inside `Sidebar`. */
export function DefaultFilterPanel({ children }: IListingFilterPanelProps) {
  return <div className="flex flex-col gap-3">{children}</div>;
}
