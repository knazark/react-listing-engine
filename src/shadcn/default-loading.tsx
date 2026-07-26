'use client';

import type { IListingLoadingProps } from '~/react';

const SKELETON_ROWS = 3;

/** Default styled `Loading` slot: a shimmering skeleton list, announced via `role="status"`. */
export function DefaultLoading(_props: IListingLoadingProps) {
  return (
    <div className="flex flex-col gap-3 p-3" role="status" aria-busy="true" aria-label="Loading results">
      {Array.from({ length: SKELETON_ROWS }).map((_, index) => (
        <div key={index} className="flex flex-col gap-2 motion-safe:animate-pulse">
          <div className="aspect-video w-full rounded-md bg-muted" />
          <div className="h-4 w-2/3 rounded-md bg-muted" />
          <div className="h-3 w-1/3 rounded-md bg-muted" />
        </div>
      ))}
    </div>
  );
}
