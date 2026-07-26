'use client';

import type { EntityId } from '~/interfaces';

import { useListingComponents } from '../components-provider';
import { useListing } from '../hooks/use-listing';
import { useListingResults } from '../hooks/use-listing-results';
import { useListingState } from '../hooks/use-listing-state';

// Defensive id derivation, mirroring components-provider.tsx's
// getItemTitle() fallback for the default Card: an item is expected to carry
// a string/number `id`, but a caller-supplied entity shape is never
// guaranteed at this (structure-only) layer, so fall back to the item's
// index in the page rather than crashing or rendering an undefined key.
function deriveItemId(item: unknown, index: number): EntityId {
  if (item && typeof item === 'object' && 'id' in item) {
    const id = (item as { id?: unknown }).id;
    if (typeof id === 'string' || typeof id === 'number') return id;
  }
  return index;
}

/**
 * Structure-only results list. Renders the injected `Loading` while the
 * first page is still in flight, `Empty` once settled with nothing, and
 * otherwise one injected `Card` per result item.
 *
 * `onSelect` routes through `engine.selectPoint(engine.primaryDatasetId, id)`
 * -- the only mutator for `state.selection` -- rather than a list-only
 * selection concept, so selecting a list item and clicking the same entity's
 * map marker converge on one shared `state.selection`. Results always come
 * from the primary dataset (`ListingEngine#loadPage`/`applyFilters` query
 * `primaryDataset()` internally), which is why `engine.primaryDatasetId` is
 * the right id to pass here (see the Step 0 note on `ListingEngine` in the
 * task report for why that field was made public).
 */
export function ListingList({ className }: { className?: string } = {}) {
  const engine = useListing();
  const { items } = useListingResults();
  const { pagination, selection } = useListingState();
  const { Card, Empty, Loading } = useListingComponents();

  if (pagination.loading && items.length === 0) {
    return <Loading />;
  }

  if (items.length === 0) {
    return <Empty />;
  }

  return (
    <div role="list" className={className}>
      {items.map((item, index) => {
        const id = deriveItemId(item, index);
        return (
          <Card
            key={id}
            item={item}
            selected={selection === id}
            onSelect={() => engine.selectPoint(engine.primaryDatasetId, id)}
          />
        );
      })}
    </div>
  );
}
