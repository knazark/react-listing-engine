'use client';

import { memo, useMemo, useRef } from 'react';

import type { EntityId } from '~/interfaces';

import { useListingComponents } from '../components-provider';
import { useListing } from '../hooks/use-listing';
import { useListingResults } from '../hooks/use-listing-results';
import { useListingSelector } from '../hooks/use-listing-selector';
import type { useListingState } from '../hooks/use-listing-state';

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
 * Structure-only results list. Renders the injected `Loading` until the list
 * has something to say -- both while a page is in flight AND before any
 * query has ever committed (`pagination.loaded`): an unseeded boot is "not
 * asked yet", and rendering `Empty` for it would claim a verified absence
 * that no query produced (server-rendered, that claim even reaches crawlers).
 * `Empty` is reserved for a COMPLETED query with nothing in it; otherwise
 * one injected `Card` renders per result item.
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
  type State = ReturnType<typeof useListingState>;
  // Two booleans, not the `pagination` object: a page-index write replaces
  // that object without changing what this component renders.
  const loading = useListingSelector<boolean>(state => state.pagination.loading);
  const loaded = useListingSelector<boolean>(state => state.pagination.loaded);
  const selection = useListingSelector<State['selection']>(state => state.selection);
  const { Card, Empty, Loading } = useListingComponents();

  // This component re-renders on EVERY store write -- a hover, a selection, a
  // map settle -- because it subscribes to the whole state. Without these two,
  // each of those re-rendered every card in the page: a fresh `onSelect`
  // closure per card made props unequal, and an unmemoized `Card` re-rendered
  // regardless. Memoizing narrows a page-wide re-render to the cards whose own
  // props actually changed.
  //
  // `memo` only stops re-renders that come from HERE. A card with its own
  // subscription still re-renders when what it subscribes to changes -- which
  // is the point, and why a card that reads one value should reach for
  // `useListingSelector` rather than the whole state.
  const MemoCard = useMemo(() => memo(Card), [Card]);

  // One handler per item id, kept for as long as that id stays on the page.
  // Rebuilding them whenever `items` was replaced handed every card a new
  // `onSelect` on each refetch, which defeated the memo above even for a card
  // whose item came back unchanged.
  const handlerCache = useRef({ engine, handlers: new Map<EntityId, () => void>() });
  const selectHandlers = useMemo(() => {
    // A handler closes over the engine, so none survives an engine swap.
    const reusable = handlerCache.current.engine === engine ? handlerCache.current.handlers : undefined;
    const handlers = new Map<EntityId, () => void>();
    items.forEach((item, index) => {
      const id = deriveItemId(item, index);
      handlers.set(id, reusable?.get(id) ?? (() => engine.selectPoint(engine.primaryDatasetId, id)));
    });
    handlerCache.current = { engine, handlers };
    return handlers;
  }, [engine, items]);

  if (items.length === 0 && (loading || !loaded)) {
    return <Loading />;
  }

  if (items.length === 0) {
    return <Empty />;
  }

  return (
    // `data-loading` marks a refetch over a page that is still on screen, so a
    // consumer can dim the stale cards from CSS instead of subscribing every
    // card to the loading flag and re-rendering all of them twice per query.
    <div role="list" className={className} data-loading={loading ? '' : undefined}>
      {items.map((item, index) => {
        const id = deriveItemId(item, index);
        return <MemoCard key={id} item={item} selected={selection === id} onSelect={selectHandlers.get(id)} />;
      })}
    </div>
  );
}
