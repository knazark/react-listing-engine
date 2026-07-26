'use client';

import type { HistoryPort } from '~/core';
import type { QueryParams } from '~/interfaces';

export interface BrowserHistoryPortOptions {
  // 'replace' (default) never grows the browser history stack -- every
  // filter change overwrites the current entry, matching how most listing
  // UIs treat filters as view state, not navigation. 'push' opts into a
  // back-button-able history entry per change instead.
  mode?: 'replace' | 'push';
}

/**
 * `HistoryPort` backed by the real `window.location`/`window.history` APIs.
 * SSR-safe: every method no-ops (or returns an empty/no-op value) when
 * `window` isn't defined, so this can be constructed unconditionally at
 * module scope in an SSR app without crashing on the server render.
 *
 * OPTIONAL helper: only meaningful paired with a `UrlSyncController` (see
 * that class's doc comment for why it is no longer the primary URL-sync
 * path). The recommended default (`styled/listing-app.tsx`'s `ListingApp`)
 * never constructs one of these — it emits filter changes and lets the
 * consumer call their own `window.history`/router APIs instead.
 */
export class BrowserHistoryPort implements HistoryPort {
  private readonly mode: 'replace' | 'push';

  constructor(opts: BrowserHistoryPortOptions = {}) {
    this.mode = opts.mode ?? 'replace';
  }

  getQuery(): QueryParams {
    if (typeof window === 'undefined') return {};

    const searchParams = new URLSearchParams(window.location.search);
    const query: QueryParams = {};
    for (const [key, value] of searchParams) {
      if (value !== '') query[key] = value;
    }
    return query;
  }

  setQuery(params: QueryParams): void {
    if (typeof window === 'undefined') return;

    const searchParams = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value === undefined || value === '') continue;
      searchParams.set(key, value);
    }

    const qs = searchParams.toString();
    const nextSearch = qs ? `?${qs}` : '';

    if (nextSearch === window.location.search) return; // already in sync -- skip a redundant history entry

    const url = `${window.location.pathname}${nextSearch}${window.location.hash}`;

    if (this.mode === 'push') {
      window.history.pushState(window.history.state, '', url);
    } else {
      window.history.replaceState(window.history.state, '', url);
    }
  }

  subscribe(cb: () => void): () => void {
    if (typeof window === 'undefined') return () => {};

    window.addEventListener('popstate', cb);
    return () => {
      window.removeEventListener('popstate', cb);
    };
  }
}
