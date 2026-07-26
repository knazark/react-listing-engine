import { cleanup, render, waitFor } from '@testing-library/react';
import { StrictMode, useContext } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { composeListingProviders, withDataset, withUrlSync } from '~/core';
import { ListingEngine } from '~/core/listing-engine';
import { MemoryHistoryPort } from '~/core/strategies/url-sync/memory-history-port';
import { UrlSyncController } from '~/core/strategies/url-sync/url-sync.controller';
import type { EntityAdapter } from '~/interfaces';
import { ListingEngineContext, ListingProvider } from '~/react';

interface Filters {
  q?: string;
}

function makeAdapter(): EntityAdapter<{ id: number }, Filters> {
  return {
    list: async () => ({ items: [], nextCursor: null }),
    getPoints: async () => [],
  };
}

// Reads the context and reports readiness via a data-testid so tests can use
// findBy*/waitFor for the async (effect-driven) engine boot, plus hands the
// current context value back out via a callback on EVERY render (including
// `null`) — for spying on live engine instances, collecting every distinct
// instance constructed across a remount, and proving `Probe` itself is never
// rendered with a null context (see the two tests below that rely on this).
function Probe({ onEngine }: { onEngine?: (engine: ListingEngine<unknown, unknown> | null) => void }) {
  const engine = useContext(ListingEngineContext);
  onEngine?.(engine);
  return <div data-testid="probe">{engine ? 'ready' : 'booting'}</div>;
}

describe('ListingProvider', () => {
  afterEach(() => {
    cleanup();
  });

  it('constructs a ListingEngine and exposes it via ListingEngineContext after mount', async () => {
    const props = composeListingProviders<Filters>(
      withDataset({ id: 'p', adapter: makeAdapter(), marker: { iconUrl: () => '' } }),
    );

    const { findByTestId } = render(
      <ListingProvider {...props}>
        <Probe />
      </ListingProvider>,
    );

    const probe = await findByTestId('probe');
    expect(probe.textContent).toBe('ready');
  });

  it('renders null until the engine has booted (context is null pre-mount-effect)', async () => {
    const props = composeListingProviders<Filters>(
      withDataset({ id: 'p', adapter: makeAdapter(), marker: { iconUrl: () => '' } }),
    );

    const observedEngines: Array<ListingEngine<unknown, unknown> | null> = [];

    // React Testing Library's `render()` wraps the initial commit AND its
    // (synchronous) passive effects in one `act()`, so by the time
    // `render()` returns here the boot effect has already flushed — a
    // pre-flush DOM assertion (`container.firstChild === null`) would never
    // actually observe the pre-boot state and can't distinguish correct code
    // from a regression. Instead, rely on `Probe` reporting the context
    // value of EVERY render it's given, including `null`: `Probe` only gets
    // rendered at all once `ListingProvider` decides to render `children`.
    // If the `if (!engine) return null` guard in the provider were ever
    // removed, `Probe` would mount on the very first commit with a
    // still-null context, and `null` would show up in `observedEngines`.
    const { findByTestId } = render(
      <ListingProvider {...props}>
        <Probe onEngine={engine => observedEngines.push(engine)} />
      </ListingProvider>,
    );

    const probe = await findByTestId('probe');
    expect(probe.textContent).toBe('ready');

    expect(observedEngines.length).toBeGreaterThan(0);
    expect(observedEngines.every(engine => engine !== null)).toBe(true);
  });

  it('starts urlSync on mount and stops it + disposes the engine on unmount', async () => {
    const history = new MemoryHistoryPort();
    const urlSync = new UrlSyncController<Filters>({
      history,
      toQuery: filters => ({ q: filters.q }),
      toFilters: query => ({ q: query.q }),
      hydrateOnStart: false,
    });
    const startSpy = vi.spyOn(urlSync, 'start');
    const stopSpy = vi.spyOn(urlSync, 'stop');

    const props = composeListingProviders<Filters>(
      withDataset({ id: 'p', adapter: makeAdapter(), marker: { iconUrl: () => '' } }),
      withUrlSync(urlSync),
    );

    let liveEngine: ListingEngine<unknown, unknown> | null = null;

    const { findByTestId, unmount } = render(
      <ListingProvider {...props}>
        <Probe
          onEngine={engine => {
            liveEngine = engine;
          }}
        />
      </ListingProvider>,
    );

    await findByTestId('probe');
    await waitFor(() => {
      expect(liveEngine).not.toBeNull();
    });

    expect(startSpy).toHaveBeenCalledTimes(1);
    expect(startSpy).toHaveBeenCalledWith(liveEngine);
    // `UrlSyncController.start()` calls its own `stop()` first (idempotent
    // detach-before-rewire — see url-sync.controller.ts), so one `start()`
    // already accounts for one `stop()` call before unmount ever runs.
    const stopCallsBeforeUnmount = stopSpy.mock.calls.length;

    const disposeSpy = vi.spyOn(liveEngine!, 'dispose');

    unmount();

    expect(stopSpy.mock.calls.length).toBe(stopCallsBeforeUnmount + 1);
    expect(disposeSpy).toHaveBeenCalledTimes(1);
  });

  it('survives React Strict Mode mount/unmount/remount without leaving a disposed engine in context', async () => {
    const props = composeListingProviders<Filters>(
      withDataset({ id: 'p', adapter: makeAdapter(), marker: { iconUrl: () => '' } }),
    );

    // Spy on the prototype (not an instance) — the whole point of this test
    // is that we don't yet know which instance(s) will be constructed.
    const disposeSpy = vi.spyOn(ListingEngine.prototype, 'dispose');
    let liveEngine: ListingEngine<unknown, unknown> | null = null;

    const { findByTestId } = render(
      <StrictMode>
        <ListingProvider {...props}>
          <Probe
            onEngine={engine => {
              liveEngine = engine;
            }}
          />
        </ListingProvider>
      </StrictMode>,
    );

    const probe = await findByTestId('probe');
    await waitFor(() => {
      expect(probe.textContent).toBe('ready');
    });

    // React's dev-only StrictMode double-invoke of effects on the initial
    // mount (cleanup -> re-setup) runs entirely inside this flush, before
    // any intermediate render is ever committed for a descendant to observe
    // — verified empirically: `Probe`'s `onEngine` callback only ever fires
    // with the FINAL, live engine, never the transiently-constructed-and-
    // -discarded one, because the state update from the first `setEngine`
    // never gets its own painted commit before the double-invoke cleanup
    // already tears it down and replaces it. So the discarded instance is
    // only observable through `disposeSpy`, taken as a snapshot here before
    // this test's own `unmount`/`cleanup()` disposes the live engine too.
    const disposedInstances = [...disposeSpy.mock.instances];

    // The correct implementation constructs a fresh `ListingEngine` inside
    // the effect on every run, so the StrictMode-simulated unmount disposes
    // a DIFFERENT instance than the one left live in context: at least one
    // instance was constructed and discarded (disposed) before the live one
    // took its place.
    expect(disposedInstances.length).toBeGreaterThanOrEqual(1);
    expect(liveEngine).not.toBeNull();
    // The regression this guards against — constructing the engine once
    // (e.g. in the lazy `useState` initializer) and reusing that single
    // instance across the remount — disposes and then re-exposes the SAME
    // reference, which would make the live engine show up in the disposed
    // list too and fail this assertion.
    expect(disposedInstances).not.toContain(liveEngine);

    disposeSpy.mockRestore();
  });
});
