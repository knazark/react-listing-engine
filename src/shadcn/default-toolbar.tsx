'use client';

import type { IListingToolbarProps } from '~/react';

/** Default styled `Toolbar` slot: a bordered bar wrapping arbitrary children. */
export function DefaultToolbar({ children }: IListingToolbarProps) {
  return <div className="flex items-center gap-2 border-b p-2">{children}</div>;
}
