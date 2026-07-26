'use client';

import { useListing } from '../hooks/use-listing';
import { useListingState } from '../hooks/use-listing-state';

/**
 * Structure-only "Load more" control. Disabled when there is no next page
 * (`results.nextCursor == null`) or a query is already in flight
 * (`pagination.loading`); otherwise calls `engine.loadPage()`.
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

  const disabled = results.nextCursor == null || pagination.loading;

  return (
    <button type="button" disabled={disabled} onClick={() => void engine.loadPage()}>
      Load more
    </button>
  );
}
