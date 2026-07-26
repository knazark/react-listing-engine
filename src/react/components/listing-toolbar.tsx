'use client';

import { useListingComponents, type IListingToolbarProps } from '../components-provider';

/**
 * Structure-only toolbar wrapper: forwards `children` into the injected
 * `Toolbar` slot. Reuses `IListingToolbarProps` from `components-provider`
 * (rather than declaring a duplicate local interface) since this component's
 * own props are identical in shape to the slot it wraps -- both are just
 * `{ children?: ReactNode }`.
 */
export function ListingToolbar({ children }: IListingToolbarProps) {
  const { Toolbar } = useListingComponents();

  return <Toolbar>{children}</Toolbar>;
}
