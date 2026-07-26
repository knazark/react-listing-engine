import type { QueryParams } from '~/interfaces';

/**
 * DOM-agnostic abstraction over "the URL's query string" — or, in tests/SSR,
 * an in-memory stand-in (`MemoryHistoryPort`). `UrlSyncController` talks to
 * this interface only, never to `window.location`/`history` directly, so it
 * stays framework- and environment-free like the rest of `src/core`.
 */
export interface HistoryPort {
  getQuery(): QueryParams;
  setQuery(params: QueryParams): void;
  // Notifies on URL changes this port didn't initiate itself (e.g. browser
  // back/forward -> popstate). Returns an unsubscribe function.
  subscribe(cb: () => void): () => void;
}
