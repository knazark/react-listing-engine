'use client';

import type { IListingToolbarProps } from '~/react';

/** Default `/styled` `Toolbar` slot: a bordered bar (`.rle-toolbar`) wrapping arbitrary children. */
export function StyledToolbar({ children }: IListingToolbarProps) {
	return <div className="rle-toolbar">{children}</div>;
}
