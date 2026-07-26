import type { QueryParams } from '~/interfaces';

import type { HistoryPort } from './history-port.interface';

/**
 * In-memory `HistoryPort` — holds `QueryParams` in a plain field instead of
 * the browser URL. Used by tests (fast, no DOM/jsdom `history` needed) and by
 * SSR, where there is no `window` to read/write.
 */
export class MemoryHistoryPort implements HistoryPort {
  private query: QueryParams;
  private readonly listeners = new Set<() => void>();

  constructor(initial: QueryParams = {}) {
    this.query = { ...initial };
  }

  getQuery(): QueryParams {
    return { ...this.query };
  }

  setQuery(params: QueryParams): void {
    this.query = { ...params };
    this.notify();
  }

  subscribe(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }

  private notify(): void {
    for (const listener of [...this.listeners]) listener();
  }
}
