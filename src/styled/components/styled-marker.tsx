'use client';

import type { IListingMarkerProps } from '~/react';

import { formatStyledPrice } from '../utils/format-price';

// Same defensive view-model reasoning as StyledCard -- `point.entity` is the
// raw row (`unknown` at this layer), read defensively for a common `price`
// field and currency-formatted when present.
interface IStyledMarkerViewModel {
	price?: string | number;
}

/** Default `/styled` `Marker` slot: a teardrop price pin (`.rle-pin`, Rentler-style, pointer via CSS `::after`) for a map point. */
export function StyledMarker({ point }: IListingMarkerProps) {
	const vm = (point.entity ?? {}) as Partial<IStyledMarkerViewModel>;

	return <span className="rle-pin">{vm.price != null ? formatStyledPrice(vm.price) : ''}</span>;
}
