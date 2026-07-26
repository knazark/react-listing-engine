'use client';

import type { IListingSidebarProps } from '~/react';

/** Default `/styled` `Sidebar` slot (`.rle-sidebar`): the outer chrome for the filters column. */
export function StyledSidebar({ children }: IListingSidebarProps) {
	return <aside className="rle-sidebar">{children}</aside>;
}
