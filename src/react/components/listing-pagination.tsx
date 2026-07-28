'use client';

import { PaginationMode } from '~/enums';

import { useListing } from '../hooks/use-listing';
import { useListingState } from '../hooks/use-listing-state';

/** Windowing gap placeholder rendered as an ellipsis between page numbers. */
const GAP = 'gap';

/**
 * The 1-based page numbers to render, with `GAP` placeholders where the
 * classic first/last + window-around-current pattern elides a run of pages.
 * Up to 7 pages everything fits without elision; beyond that: always page 1
 * and page `totalPages`, plus `currentPage` and its immediate neighbors,
 * with a gap for each elided run.
 */
function buildPageItems(totalPages: number, currentPage: number): (number | typeof GAP)[] {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, i) => i + 1);
  }
  const windowStart = Math.max(2, currentPage - 1);
  const windowEnd = Math.min(totalPages - 1, currentPage + 1);
  const items: (number | typeof GAP)[] = [1];
  if (windowStart > 2) items.push(GAP);
  for (let page = windowStart; page <= windowEnd; page += 1) items.push(page);
  if (windowEnd < totalPages - 1) items.push(GAP);
  items.push(totalPages);
  return items;
}

/**
 * Structure-only pagination control, dispatching on `pagination.mode`:
 *
 * - `Infinite`: the original "Load more" button, unchanged — renders NOTHING
 *   when there is no next page (`results.nextCursor == null`), and while a
 *   query is in flight the button is disabled; clicking calls
 *   `engine.loadPage()`.
 * - `Paged` with a KNOWN `results.total`: a numbered "1 2 3 … N" pager
 *   (`totalPages = ceil(total / pageSize)`), rendered as a
 *   `<nav class="rle-pagination">` with prev/next buttons plus one button
 *   per page (windowed past 7 pages — see `buildPageItems`). Clicking page
 *   `n` calls `engine.goToPage(n - 1)` (0-based). Renders nothing when
 *   there is at most one page — no dangling chrome under a short list.
 * - `Paged` with UNKNOWN total: just prev/next. With no `total` there is no
 *   page count to draw, so "has a next page" is derived instead: a full
 *   page (`items.length >= pageSize`) may have more behind it, and a
 *   non-null `nextCursor` (the legacy cursor-driven path) definitely does.
 *   A short/empty page with no cursor is the end. Kept deliberately simple —
 *   offset-capable adapters that want the numbered pager should return
 *   `total`.
 *
 * All buttons are disabled while `pagination.loading`. Renders plain
 * `<button>`s rather than an injected component: `useListingComponents()`
 * has no `Button` slot yet (same rationale as before this component grew
 * Paged support).
 */
export function ListingPagination() {
  const engine = useListing();
  const { results, pagination } = useListingState();

  if (pagination.mode === PaginationMode.Infinite) {
    if (results.nextCursor == null) return null;
    return (
      <button type="button" disabled={pagination.loading} onClick={() => void engine.loadPage()}>
        Load more
      </button>
    );
  }

  const pageSize = engine.options.pageSize;
  const { pageIndex } = pagination;
  const currentPage = pageIndex + 1;
  const totalPages = results.total != null ? Math.ceil(results.total / pageSize) : null;

  const hasNext =
    totalPages != null ? currentPage < totalPages : results.nextCursor != null || results.items.length >= pageSize;

  // At most one (known or knowable) page -> no pager chrome at all.
  if (totalPages != null ? totalPages <= 1 : pageIndex === 0 && !hasNext) return null;

  const goTo = (index: number) => () => void engine.goToPage(index);

  return (
    <nav className="rle-pagination" aria-label="Pagination">
      <button
        type="button"
        className="rle-page-btn rle-page-btn--nav"
        aria-label="Previous page"
        disabled={pagination.loading || pageIndex === 0}
        onClick={goTo(pageIndex - 1)}
      >
        &lsaquo;
      </button>
      {totalPages != null &&
        buildPageItems(totalPages, currentPage).map((item, i) =>
          item === GAP ? (
            <span key={`gap-${i}`} className="rle-page-ellipsis">
              &hellip;
            </span>
          ) : (
            <button
              key={item}
              type="button"
              className={item === currentPage ? 'rle-page-btn rle-page-btn--active' : 'rle-page-btn'}
              aria-label={`Page ${item}`}
              aria-current={item === currentPage ? 'page' : undefined}
              disabled={pagination.loading}
              onClick={goTo(item - 1)}
            >
              {item}
            </button>
          ),
        )}
      <button
        type="button"
        className="rle-page-btn rle-page-btn--nav"
        aria-label="Next page"
        disabled={pagination.loading || !hasNext}
        onClick={goTo(pageIndex + 1)}
      >
        &rsaquo;
      </button>
    </nav>
  );
}
