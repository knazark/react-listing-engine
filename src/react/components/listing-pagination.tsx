'use client';

import { useListing } from '../hooks/use-listing';
import { useListingState } from '../hooks/use-listing-state';

/**
 * Structure-only "Load more" control. Renders NOTHING when there is no next
 * page (`results.nextCursor == null`) -- an empty result set or the last page
 * should not leave a dangling (disabled) button behind. When a next page
 * exists, the button is disabled only while a query is in flight
 * (`pagination.loading`); otherwise it calls `engine.loadPage()`.
 *
 * Renders a plain `<button>` rather than an injected component: `useListingComponents()`
 * (`IListingComponents`) has no `Button` slot yet, so there is nothing to
 * delegate to here. Wiring this up to a real Button slot (and to the shadcn
 * adapter's styled Button) is a documented future enhancement once that slot
 * exists.
 */
export function ListingPagination() {
  const engine = useListing();
  const { results, pagination } = useListingState();

  if (results.nextCursor == null) return null;

  return (
    <button type="button" disabled={pagination.loading} onClick={() => void engine.loadPage()}>
      Load more
    </button>
  );
}
