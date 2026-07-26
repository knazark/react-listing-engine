'use client';

import type { IListingResultHeaderProps } from '~/react';

/** Default `/styled` `ResultHeader` slot: `"{count} results"`, or `"{count} of {total} results"` when a distinct total is known. */
export function StyledResultHeader({ count, total }: IListingResultHeaderProps) {
	const label = total != null && total !== count ? `${count} of ${total} results` : `${count} results`;

	return <div className="rle-result-header">{label}</div>;
}
