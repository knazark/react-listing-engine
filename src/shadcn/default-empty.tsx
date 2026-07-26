'use client';

import type { IListingEmptyProps } from '~/react';

/** Default styled `Empty` slot: a centered empty state with an icon, heading and hint. */
export function DefaultEmpty(_props: IListingEmptyProps) {
  return (
    <div
      role="status"
      className="flex flex-col items-center justify-center gap-2 px-4 py-12 text-center text-muted-foreground"
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        className="h-8 w-8"
        aria-hidden="true"
      >
        <circle cx="11" cy="11" r="7" />
        <path d="m21 21-4.3-4.3" />
      </svg>
      <p className="text-sm font-medium text-foreground">No results</p>
      <p className="text-xs text-muted-foreground">Try adjusting your filters or search terms.</p>
    </div>
  );
}
