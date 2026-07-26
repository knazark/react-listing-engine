'use client';

import type { IListingSidebarProps } from '~/react';

/**
 * Default styled `Sidebar` slot: the outer chrome for the filters column in
 * `ListingLayout`. Full width and unbordered on mobile (stacks above the
 * results in normal document flow); becomes a fixed-width bordered rail from
 * `md` up.
 */
export function DefaultSidebar({ children }: IListingSidebarProps) {
  return <aside className="flex w-full flex-col gap-4 p-4 md:border-r md:border-border">{children}</aside>;
}
