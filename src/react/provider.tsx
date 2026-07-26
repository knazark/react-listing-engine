'use client';

import { type ReactNode, useEffect, useState } from 'react';

import type { IListingProviderProps, UrlSyncEngine } from '~/core';
import { ListingEngine } from '~/core';

import { ListingEngineContext } from './context';

// TEntity intentionally does NOT appear here — `IListingProviderProps` is
// entity-erased (`DatasetRegistry<unknown, TFilters>`, same reasoning as
// `ListingEngineOptions`), so it has nothing to reference. `ListingProvider`
// still declares `<TEntity, TFilters>` below; TEntity can't be inferred from
// these props and must be supplied explicitly at the call site, exactly like
// `new ListingEngine<TEntity, TFilters>(options)`.
interface IListingProviderComponentProps<TFilters> extends IListingProviderProps<TFilters> {
  children: ReactNode;
}

/**
 * Top-level listing provider. Captures the composed boot props once via lazy
 * `useState`, then constructs a fresh `ListingEngine` inside an effect so
 * React Strict Mode's mount/unmount/remount cycle never leaves a permanently
 * disposed engine sitting in context — the effect runs again on remount and
 * produces a brand-new engine rather than reusing the disposed one. Any
 * `urlSync` controller is started against the freshly built engine and
 * stopped on cleanup, alongside `engine.dispose()`.
 *
 * Idiomatic shape:
 * ```tsx
 * <ListingProvider {...composeListingProviders(withDataset(...))}>
 *   <ListingLayout />
 * </ListingProvider>
 * ```
 */
export function ListingProvider<TEntity, TFilters>(props: IListingProviderComponentProps<TFilters>) {
  const { children, ...listingProps } = props;

  const [boot] = useState<IListingProviderProps<TFilters>>(() => listingProps);
  const [engine, setEngine] = useState<ListingEngine<TEntity, TFilters> | null>(null);

  useEffect(() => {
    const newEngine = new ListingEngine<TEntity, TFilters>({
      datasets: boot.datasets,
      filters: boot.filters,
      config: boot.config,
      map: boot.map,
      initialFilters: boot.initialFilters,
      primaryDatasetId: boot.primaryDatasetId,
    });

    if (boot.urlSync) {
      // `UrlSyncEngine<TFilters>.state.filters` is bare `TFilters`, while
      // `ListingEngine.state.filters` is `DeepReadonly<TFilters>` (see
      // listing-store.ts). This is an UNCHECKED cast bridging the two — it
      // is not statically provable for every TFilters shape (a
      // `DeepReadonly<T[]>` is NOT assignable to `T[]`, for instance, so an
      // array-valued filter field would break it in the general case). It's
      // sound at RUNTIME only because `url-sync` exclusively READS
      // `engine.state.filters` (never mutates it), so the readonly-vs-mutable
      // mismatch never manifests as an actual write. `url-sync.spec.ts`'s
      // "ListingEngine satisfies the UrlSyncEngine structural contract" test
      // is the runtime proof backing this cast.
      boot.urlSync.start(newEngine as unknown as UrlSyncEngine<TFilters>);
    }

    setEngine(newEngine);

    return () => {
      if (boot.urlSync) {
        boot.urlSync.stop();
      }
      newEngine.dispose();
      setEngine(prev => (prev === newEngine ? null : prev));
    };
  }, [boot]);

  if (!engine) {
    return null;
  }

  return (
    <ListingEngineContext.Provider value={engine as unknown as ListingEngine<unknown, unknown>}>
      {children}
    </ListingEngineContext.Provider>
  );
}
