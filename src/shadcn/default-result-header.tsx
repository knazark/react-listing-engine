'use client';

import type { IListingResultHeaderProps } from '~/react';

/** Default styled `ResultHeader` slot: `"{count} results"`, or `"{count} of {total} results"` when a distinct total is known. */
export function DefaultResultHeader({ count, total }: IListingResultHeaderProps) {
  const label = total != null && total !== count ? `${count} of ${total} results` : `${count} results`;

  return <div className="text-sm tabular-nums text-muted-foreground">{label}</div>;
}
