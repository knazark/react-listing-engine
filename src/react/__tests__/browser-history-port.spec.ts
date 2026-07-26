import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BrowserHistoryPort } from '../browser-history-port';

// vitest.config.ts pins `environment: 'happy-dom'` for this whole package, so
// `window` is always defined here -- there is no way to exercise the
// `typeof window === 'undefined'` branches (getQuery -> {}, setQuery/subscribe
// no-ops) from inside a spec run in this environment without deleting the
// global mid-test, which would destabilize every other test relying on
// happy-dom's `window`. Those branches are covered by code inspection instead
// (mirrors the reasoning `MemoryHistoryPort`'s existence documents: SSR uses
// `MemoryHistoryPort`, never `BrowserHistoryPort`, precisely because there is
// no `window` to guard on the server).

describe('BrowserHistoryPort', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/');
  });

  // vitest.config.ts doesn't set `restoreMocks`, and `vi.spyOn` on an
  // already-spied method returns the SAME mock (accumulating call counts
  // across tests) rather than re-wrapping -- restore explicitly so each
  // spy's call count in one test isn't polluted by a previous test's calls.
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('getQuery', () => {
    it('parses window.location.search into QueryParams', () => {
      window.history.replaceState(null, '', '/listings?minPrice=1000&q=loft');
      const port = new BrowserHistoryPort();

      expect(port.getQuery()).toEqual({ minPrice: '1000', q: 'loft' });
    });

    it('returns {} when there is no search string', () => {
      const port = new BrowserHistoryPort();

      expect(port.getQuery()).toEqual({});
    });

    it('drops keys with an empty-string value', () => {
      window.history.replaceState(null, '', '/listings?q=&minPrice=1000');
      const port = new BrowserHistoryPort();

      expect(port.getQuery()).toEqual({ minPrice: '1000' });
    });
  });

  describe('setQuery', () => {
    it('updates location.search (replace mode, the default) and preserves the hash', () => {
      window.history.replaceState(null, '', '/listings#gallery');
      const port = new BrowserHistoryPort();

      port.setQuery({ minPrice: '1000', q: 'loft' });

      expect(window.location.pathname).toBe('/listings');
      expect(window.location.search).toBe('?minPrice=1000&q=loft');
      expect(window.location.hash).toBe('#gallery');
    });

    it('skips undefined and empty-string values', () => {
      const port = new BrowserHistoryPort();

      port.setQuery({ minPrice: '1000', maxPrice: undefined, q: '' });

      expect(window.location.search).toBe('?minPrice=1000');
    });

    it('omits the "?" entirely when the resulting query is empty', () => {
      window.history.replaceState(null, '', '/listings?q=loft');
      const port = new BrowserHistoryPort();

      port.setQuery({});

      expect(window.location.search).toBe('');
      expect(window.location.pathname).toBe('/listings');
    });

    it('calls history.replaceState by default, never pushState', () => {
      const replaceSpy = vi.spyOn(window.history, 'replaceState');
      const pushSpy = vi.spyOn(window.history, 'pushState');
      const port = new BrowserHistoryPort();

      port.setQuery({ q: 'loft' });

      expect(replaceSpy).toHaveBeenCalledTimes(1);
      expect(pushSpy).not.toHaveBeenCalled();
    });

    it('calls history.pushState when mode is "push"', () => {
      const replaceSpy = vi.spyOn(window.history, 'replaceState');
      const pushSpy = vi.spyOn(window.history, 'pushState');
      const port = new BrowserHistoryPort({ mode: 'push' });

      port.setQuery({ q: 'loft' });

      expect(pushSpy).toHaveBeenCalledTimes(1);
      expect(replaceSpy).not.toHaveBeenCalled();
    });

    it('is a no-op when the resulting search string is unchanged (avoids a redundant history entry)', () => {
      window.history.replaceState(null, '', '/listings?q=loft');
      const replaceSpy = vi.spyOn(window.history, 'replaceState');
      const port = new BrowserHistoryPort();

      port.setQuery({ q: 'loft' });

      expect(replaceSpy).not.toHaveBeenCalled();
    });
  });

  describe('subscribe', () => {
    it('fires the callback when a popstate event is dispatched', () => {
      const port = new BrowserHistoryPort();
      const cb = vi.fn();
      port.subscribe(cb);

      window.dispatchEvent(new Event('popstate'));

      expect(cb).toHaveBeenCalledTimes(1);
    });

    it('the returned unsubscribe stops further notifications', () => {
      const port = new BrowserHistoryPort();
      const cb = vi.fn();
      const unsubscribe = port.subscribe(cb);
      unsubscribe();

      window.dispatchEvent(new Event('popstate'));

      expect(cb).not.toHaveBeenCalled();
    });
  });
});
