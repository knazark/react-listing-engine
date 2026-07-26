'use client';

import type { IListingMarkerProps } from '~/react';

// Same defensive view-model reasoning as DefaultCard -- `point.entity` is the
// raw row (`unknown` at this layer), read defensively for a common `price`
// field and rendered as-is when present.
interface IListingMarkerViewModel {
  price?: string | number;
}

/** Default styled `Marker` slot: a small price pill for a map point. */
export function DefaultMarker({ point }: IListingMarkerProps) {
  const vm = (point.entity ?? {}) as Partial<IListingMarkerViewModel>;

  return (
    <span className="rounded-full border bg-background px-2 py-0.5 text-xs font-medium tabular-nums shadow-sm">
      {vm.price ?? ''}
    </span>
  );
}
