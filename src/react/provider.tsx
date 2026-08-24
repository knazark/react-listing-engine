'use client';

import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';

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

  // Constructed during RENDER, not in an effect.
  //
  // It used to be built in an effect, with the provider returning `null` until
  // that ran -- which made every consumer client-only by construction: on a
  // server there are no effects, so the whole tree rendered to nothing. Seeding
  // `initialResults` would have been pointless while this gate stood.
  //
  // The constructor is pure: it builds the store, the registries and the config
  // and touches no browser API. Everything with a side effect -- starting
  // url-sync, disposing -- stays in the effect below.
  const build = useCallback(
    () =>
      new ListingEngine<TEntity, TFilters>({
        datasets: boot.datasets,
        filters: boot.filters,
        config: boot.config,
        map: boot.map,
        initialFilters: boot.initialFilters,
        initialResults: boot.initialResults,
        primaryDatasetId: boot.primaryDatasetId,
      }),
    [boot]
  );

  const [engine, setEngine] = useState<ListingEngine<TEntity, TFilters>>(build);

  // Read inside the effect WITHOUT making it a dependency. Depending on it
  // deadlocks: replacing a disposed engine changes the dep, React tears the
  // effect down, the cleanup disposes the replacement, and the next pass
  // replaces that -- forever. The ref lets the effect see the current engine
  // while staying tied to `boot` alone.
  const engineRef = useRef(engine);
  engineRef.current = engine;

  useEffect(() => {
    // Strict Mode runs mount -> cleanup -> mount, and that cleanup disposes.
    // Because the engine now outlives the effect (it is built during render so
    // a server render has one), the second mount would otherwise hand a DEAD
    // engine -- emitter torn down -- to every consumer. Replace it instead.
    // Re-running is safe: the fresh engine is not disposed, so this settles on
    // the next pass rather than looping.
    let newEngine = engineRef.current;
    if (newEngine.isDisposed) {
      newEngine = build();
      engineRef.current = newEngine;
      setEngine(newEngine);
    }

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

    return () => {
      if (boot.urlSync) {
        boot.urlSync.stop();
      }
      newEngine.dispose();
    };
     
    // `engineRef` on purpose; see the ref's comment above.
  }, [boot, build]);

  return (
    <ListingEngineContext.Provider value={engine as unknown as ListingEngine<unknown, unknown>}>
      {children}
    </ListingEngineContext.Provider>
  );
}
