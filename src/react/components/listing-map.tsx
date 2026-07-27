'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

import type { Bounds, LatLng, MapHandle, RenderedLayer, Unsubscribe } from '~/interfaces';

import { FallbackPopup, useListingComponents } from '../components-provider';
import { useListing } from '../hooks/use-listing';
import { useListingState } from '../hooks/use-listing-state';

// "Give me everything" bounds for the one-time initial points load (see the
// class doc comment's "Auto-fit" section) -- every adapter that filters
// points by a bounds-contains check (the in-memory/mock ones, and any real
// backend implementing the same "points within this box" contract) returns
// its full row set for a box this wide. Kept a hair inside the real
// lat/lng limits (not +/-90/+/-180) so it stays a valid, unambiguous
// `Bounds` for providers that reject or normalize exact-pole/antimeridian
// values.
const WORLD_BOUNDS: Bounds = { west: -179.9, south: -85, east: 179.9, north: 85 };

// Padding applied around the computed points bounding box before handing it
// to `provider.fitBounds()`, so the outermost markers don't sit flush
// against the map's edge -- 10% of each axis's span, added to both sides.
const BBOX_PAD_RATIO = 0.1;
// Fallback pad (in degrees) for an axis whose span is zero (all points share
// the same lat and/or lng, including the single-point case) -- 10% of a
// zero span is still zero, which would hand `fitBounds()` a degenerate box.
const SINGLE_POINT_PAD_DEGREES = 0.02;

// Computes a padded bounding box over `points`, or `null` for an empty list
// (nothing to frame). Exported for testability from within this module only
// -- not part of the package's public surface.
function computePointsBounds(points: LatLng[]): Bounds | null {
  if (points.length === 0) return null;

  let west = points[0].lng;
  let east = points[0].lng;
  let south = points[0].lat;
  let north = points[0].lat;
  for (const { lat, lng } of points) {
    if (lng < west) west = lng;
    if (lng > east) east = lng;
    if (lat < south) south = lat;
    if (lat > north) north = lat;
  }

  const latPad = north > south ? (north - south) * BBOX_PAD_RATIO : SINGLE_POINT_PAD_DEGREES;
  const lngPad = east > west ? (east - west) * BBOX_PAD_RATIO : SINGLE_POINT_PAD_DEGREES;

  return { west: west - lngPad, east: east + lngPad, south: south - latPad, north: north + latPad };
}

export interface IListingMapProps {
  /**
   * Initial map center, forwarded verbatim into `MapProvider#mount`'s
   * `MapInitOptions`. Read only at mount time for the mount itself -- not
   * reactive (see the mount effect's comment). Also read (reactively, on
   * every render) by the auto-fit effect: supplying `center` opts OUT of
   * auto-fit entirely, on the theory that an explicit initial view is a
   * deliberate choice the library should never override -- see the class
   * doc comment's "Auto-fit" section.
   */
  center?: LatLng;
  /** Initial zoom level, forwarded verbatim into `MapProvider#mount`'s `MapInitOptions`. Read only at mount time -- not reactive. */
  zoom?: number;
  /**
   * Rendered centered inside the map container when no `MapProvider` is
   * configured (`engine.map` is `undefined`), instead of an empty div.
   * Optional -- omit to keep the previous silent-empty behavior. Has no
   * effect once a provider IS configured: the container is left untouched
   * for the provider to mount into.
   */
  fallback?: ReactNode;
}

/**
 * Structure-only map mount point.
 *
 * - Renders a single ref'd `<div>` container. If `engine.map` is undefined
 *   (no `MapProvider` configured), that's the entire output -- no mount is
 *   attempted and nothing crashes.
 * - Layer effect (declared FIRST): reacting to `state.points`/`state.layers`,
 *   re-renders one `RenderedLayer` per dataset id present in `state.points`
 *   that is visible (`state.layers[id] !== false`, the same default-visible
 *   rule as `DatasetRegistry.visibleIds()`), looking up each dataset's
 *   `MarkerRenderer` via `engine.datasets.get(id)` (see the Step 0 note on
 *   `ListingEngine.datasets` in the task report). Each marker's click routes
 *   to `engine.selectPoint(datasetId, markerId)`.
 * - Mount effect (declared SECOND): awaits `provider.mount(container, {
 *   center, zoom })`, stashes the resulting `MapHandle` in a ref, and wires
 *   `provider.onBoundsChange(handle, b => engine.loadPoints(b))`. Cleanup
 *   unsubscribes bounds and calls `provider.destroy(handle)`. Also kicks a
 *   one-time, unbounded `engine.loadPoints(WORLD_BOUNDS)` right after the
 *   handle is ready -- see "Auto-fit" below for why.
 * - Auto-fit effect (declared THIRD): frames the map to its own data, once,
 *   the first time there is data to frame -- see "Auto-fit" below.
 *
 * ## Auto-fit
 *
 * The turnkey default: without an explicit `center`, a freshly-mounted map
 * has nothing to show it where the data is (a real `MapProvider` defaults
 * its own center/zoom when none is given -- see e.g. `googleProvider`'s
 * `center: opts.center ?? { lat: 0, lng: 0 }`, which is open ocean for most
 * datasets). Two mechanisms fix this together:
 *
 * 1. INITIAL LOAD: the mount effect fires `engine.loadPoints(WORLD_BOUNDS)`
 *    once, right after the handle is ready, so there is data in
 *    `state.points` even though the map hasn't panned (and therefore never
 *    fired its own bounds-changed event) yet. `WORLD_BOUNDS` is a
 *    "give me everything" box -- every bounds-contains-filter adapter
 *    (the in-memory/mock ones, and any real backend implementing the same
 *    contract) returns its full row set for it.
 * 2. AUTO-FIT: a separate effect watches `state.points`/`state.layers`; the
 *    first time the union of all VISIBLE layers' points is non-empty, it
 *    computes a padded bounding box (`computePointsBounds`) and calls
 *    `provider.fitBounds(handle, bbox)` -- once, ever, per mounted
 *    component instance (`didAutoFitRef`). Skipped entirely when the caller
 *    passed an explicit `center` prop: that is read as "I already chose my
 *    initial view, never override it" (checked reactively on every run of
 *    this effect, unlike the mount effect's one-time-at-mount read of the
 *    same prop).
 *
 * USER-PAN GUARD: auto-fit must never fight a user who has already panned
 * the map before their data loaded. `userMovedRef` tracks that: any
 * bounds-changed event NOT caused by our own `fitBounds()` call sets it, and
 * the auto-fit effect bails out early if it's set. To tell those apart,
 * `autoFitInProgressRef` is set to `true` immediately before calling
 * `fitBounds()`; the next bounds-changed event to arrive consumes it
 * (cleared, `userMovedRef` left untouched) instead of marking a user pan.
 * `didAutoFitRef` (checked first) already makes "at most once" absolute, so
 * `userMovedRef`'s only real job is gating the FIRST attempt: a user who
 * pans away before the initial load ever resolves is respected, and
 * auto-fit never yanks the view back. Known, deliberately accepted
 * limitation: a map SDK that fires its own bounds-changed event on initial
 * settle (e.g. Google Maps' first `idle`, unrelated to any `fitBounds()`
 * call) before the initial points load resolves will be misread as a user
 * pan and suppress that first auto-fit -- special-casing "the first
 * bounds-changed event is always free" was considered and rejected, because
 * it trades this rare false negative for the worse failure mode of
 * mistaking a genuine early user pan for that initial settle and overriding
 * it.
 *
 * Effect declaration order matters here: React runs cleanup functions in the
 * same order the effects were declared (top to bottom), so on final unmount
 * the layer effect's cleanup (unsubscribing each rendered layer) MUST run
 * before the mount effect's cleanup (`provider.destroy(handle)`) -- a real
 * map SDK adapter can throw when a layer/listener is removed from a map that
 * has already been torn down. Declaring the layer effect first is safe on
 * initial mount too: its `if (!handle) return` guard makes it a no-op until
 * the mount effect flips `ready` after `provider.mount()` resolves, so mount
 * behavior is unchanged by the reorder -- only unmount cleanup order changes.
 *
 * Async mount + React Strict Mode safety: `provider.mount()` can be async, so
 * Strict Mode's dev-only mount -> cleanup -> mount double-invoke can tear the
 * effect down while the first `mount()` call is still in flight. A per-run
 * `cancelled` flag (closed over by the async IIFE) is checked the instant the
 * mount promise resolves: if the effect was already cleaned up by then, the
 * now-orphaned handle is destroyed immediately (and never gets a bounds
 * subscription registered in the first place) instead of leaking a live map
 * instance that nothing in the component tree references anymore.
 *
 * Popup overlay: when a `Popup` slot is injected (via `ListingComponentsProvider`)
 * AND `state.selection` resolves to a loaded point of the primary dataset, the
 * injected `Popup` is rendered -- via `createPortal` -- into an on-map overlay
 * anchored at that point (`provider.mountOverlay(point.position)`; see that
 * method's doc comment for the sync-container / async-attach split). The
 * selected entity + anchor position are CAPTURED into component state
 * (`capturedPopup`) when the overlay mounts, and the rendered `Popup` reads from
 * that snapshot rather than from the live, pan-reactive `selected` -- so a pan
 * that drops the selected point out of `state.points` leaves the open popup
 * anchored and intact (it pans with the map like a Google InfoWindow) instead
 * of tearing its content out and leaving an empty overlay behind. The popup is
 * dismissed -- clearing the capture, unmounting the overlay, and clearing the
 * selection via `engine.selectPoint(primary, null)` -- by the `Popup`'s own
 * `onClose`, the `Esc` key, or a click on the map BACKGROUND
 * (`provider.onMapClick`; marker clicks live in a separate pane and never fire
 * it). Fully backward compatible: with NO `Popup` slot provided, nothing is
 * mounted and there is no behavior change (detected by `Popup !== FallbackPopup`
 * reference identity).
 *
 * Deliberately out of scope for this task (documented future enhancement):
 * rendering the injected `Marker` React component INTO map markers via portals
 * (only `iconUrl` + `onMarkerClick` -> `selectPoint` is wired).
 *
 * `fallback`: when `engine.map` is `undefined` (no `MapProvider` configured),
 * `fallback` renders centered inside the same ref'd container instead of an
 * empty div. The mount/layer effects both already no-op without a `provider`
 * (see their guards below), so swapping in `fallback` content here is purely
 * a render-output change -- it does not touch the mount lifecycle.
 */
export function ListingMap(props: IListingMapProps) {
  const { center, zoom, fallback } = props;
  const engine = useListing();
  const state = useListingState();

  const containerRef = useRef<HTMLDivElement | null>(null);
  const handleRef = useRef<MapHandle | null>(null);
  const [ready, setReady] = useState(false);

  // Auto-fit bookkeeping -- see the class doc comment's "Auto-fit" section.
  const didAutoFitRef = useRef(false);
  const userMovedRef = useRef(false);
  const autoFitInProgressRef = useRef(false);

  const provider = engine.map;

  // Declared BEFORE the mount effect below so its cleanup (layer unsubs)
  // runs on unmount BEFORE the mount effect's cleanup (`provider.destroy`)
  // -- see the class doc comment above for why ordering matters here.
  useEffect(() => {
    const handle = handleRef.current;
    if (!provider || !handle) return;

    const unsubs: Unsubscribe[] = [];
    for (const datasetId of Object.keys(state.points)) {
      if (state.layers[datasetId] === false) continue;

      const dataset = engine.datasets.get(datasetId);
      const points = state.points[datasetId] ?? [];
      const layer: RenderedLayer = {
        id: datasetId,
        markers: points.map(point => ({
          id: point.id,
          position: point.position,
          iconUrl: dataset?.marker.iconUrl?.(point.entity),
          element: dataset?.marker.element?.(point.entity),
        })),
        clustering: dataset?.clustering,
        onMarkerClick: markerId => engine.selectPoint(datasetId, markerId),
      };
      unsubs.push(provider.renderLayer(handle, layer));
    }

    return () => {
      unsubs.forEach(unsub => unsub());
    };
  }, [engine, provider, ready, state.points, state.layers]);

  useEffect(() => {
    if (!containerRef.current || !provider) return;

    const container = containerRef.current;
    let cancelled = false;
    let boundsUnsub: Unsubscribe | null = null;

    void (async () => {
      const handle = await provider.mount(container, { center, zoom });

      if (cancelled) {
        // Strict-Mode double-invoke (or an unusually fast unmount) already
        // tore this run down before the async mount settled -- nothing in
        // the tree references `handle` anymore, so destroy it right away
        // instead of leaking it, and skip subscribing to its bounds.
        provider.destroy(handle);
        return;
      }

      handleRef.current = handle;
      boundsUnsub = provider.onBoundsChange(handle, bounds => {
        // Tell "we caused this" (our own fitBounds() call, below) apart from
        // a real user pan -- see the class doc comment's "Auto-fit" section
        // for the full rationale, including the one documented limitation.
        if (autoFitInProgressRef.current) {
          autoFitInProgressRef.current = false;
        } else {
          userMovedRef.current = true;
        }
        void engine.loadPoints(bounds);
      });
      setReady(true);

      // Kick a one-time, unbounded points load so there is data to frame
      // even though the map hasn't panned (and therefore never fired its
      // own bounds-changed event) yet -- see "Auto-fit" in the class doc
      // comment. Fire-and-forget: `loadPoints` itself is responsible for
      // getting its result into `state.points`, and this call only ever
      // runs once per real (non-Strict-Mode-discarded) mounted handle,
      // since it lives after the `cancelled` check above.
      void engine.loadPoints(WORLD_BOUNDS);
    })();

    return () => {
      cancelled = true;
      boundsUnsub?.();
      if (handleRef.current) {
        provider.destroy(handleRef.current);
        handleRef.current = null;
      }
      setReady(false);
    };
    // `center`/`zoom` are read only inside the async IIFE at mount time --
    // `MapInitOptions` is an initial-view option set, not a reactive prop
    // (mirrors how real map SDKs treat their own initial center/zoom), so
    // they're intentionally excluded from this dependency list: including
    // them would remount (destroy + re-mount) the whole map on every pan.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- center/zoom are read once as initial-view options, not reactive props (see comment above); including them would remount the whole map on every pan.
  }, [engine, provider]);

  // Auto-fit -- see the class doc comment's "Auto-fit" section for the full
  // algorithm and the guards' rationale. Declared last: it only ever acts
  // once the mount effect above has produced a handle (`handleRef.current`)
  // and `state.points` has data to frame, so its relative order versus the
  // other two effects has no cleanup-ordering implications (it registers no
  // cleanup of its own).
  useEffect(() => {
    const handle = handleRef.current;
    if (!provider || !handle) return;
    if (center) return; // caller supplied an explicit initial view -- respect it, never auto-fit over it
    if (didAutoFitRef.current || userMovedRef.current) return;

    const points: LatLng[] = [];
    for (const datasetId of Object.keys(state.points)) {
      if (state.layers[datasetId] === false) continue;
      for (const point of state.points[datasetId] ?? []) points.push(point.position);
    }

    const bbox = computePointsBounds(points);
    if (!bbox) return; // no data yet (across any visible layer) -- nothing to frame

    didAutoFitRef.current = true;
    autoFitInProgressRef.current = true;
    provider.fitBounds(handle, bbox);
  }, [provider, center, ready, state.points, state.layers]);

  // Marker-state repaint effect (declared last, no cleanup of its own): repaints the
  // SELECTED/HOVERED marker's existing container node via `provider.updateMarkerStates` whenever
  // `state.selection`/`state.hovered` change -- NEVER recreates marker DOM. Deliberately kept OUT
  // of the layer effect's dependency list above: adding selection/hover there would tear down and
  // recreate every marker on each hover, which is exactly what this separate effect avoids.
  useEffect(() => {
    provider?.updateMarkerStates(state.selection, state.hovered);
  }, [provider, ready, state.selection, state.hovered]);

  // --- Popup overlay -----------------------------------------------------
  // See the class doc comment's "Popup overlay" section. `Popup` always
  // resolves to SOME component (the inert `FallbackPopup` when no slot was
  // injected), so an actual injected slot is detected by reference identity.
  const { Popup } = useListingComponents();
  const hasPopup = Popup !== FallbackPopup;

  // The selected point of the PRIMARY dataset, or `undefined` when nothing is
  // selected / the selection isn't among the currently loaded points. Read ONLY
  // to seed the captured popup below when the selection changes -- never read by
  // the render (see `capturedPopup`), so a later pan that drops this point out
  // of `state.points` can't empty out an already-open popup.
  const primaryPoints = state.points[engine.primaryDatasetId] ?? [];
  const selected = state.selection != null ? primaryPoints.find(point => point.id === state.selection) : undefined;

  // The open popup's CAPTURED entity + anchor position + portal container,
  // snapshotted when the overlay effect mounts (and nulled on teardown). The
  // rendered Popup reads from THIS, not from the live `selected` above, so it
  // stays anchored and pans with the map (InfoWindow-style) until explicitly
  // dismissed -- even once a pan shrinks `state.points` so `selected` no longer
  // resolves. This is what keeps the overlay lifecycle (keyed on selection) and
  // the portal content (keyed on this captured snapshot) from drifting apart and
  // leaving a lingering empty overlay behind.
  const [capturedPopup, setCapturedPopup] = useState<{ entity: unknown; position: LatLng; container: HTMLElement } | null>(
    null,
  );

  // `selected` is derived from `state.points`, which is deliberately kept OUT of
  // this effect's deps: points reload on every pan, and we must NOT tear the
  // open popup down and rebuild it on each. The latest `selected` is read via a
  // ref so the effect can key only on selection / Popup / provider / ready.
  const selectedRef = useRef(selected);
  selectedRef.current = selected;

  useEffect(() => {
    const handle = handleRef.current;
    if (!provider || !handle || !hasPopup) return;
    const selectedPoint = selectedRef.current;
    if (!selectedPoint) return;

    const overlay = provider.mountOverlay(selectedPoint.position);
    // Capture entity + position NOW, decoupling the rendered Popup from live
    // `state.points` (see `capturedPopup`'s comment).
    setCapturedPopup({ entity: selectedPoint.entity, position: selectedPoint.position, container: overlay.container });

    const dismiss = () => engine.selectPoint(engine.primaryDatasetId, null);

    // Esc dismisses the popup (only registered while it's open -- this effect
    // only runs when a point is selected and a Popup slot exists).
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') dismiss();
    };
    document.addEventListener('keydown', onKeyDown);

    // A click on the map BACKGROUND dismisses it too -- the touch-friendly
    // counterpart to Esc. Marker clicks live in a separate pane and don't fire
    // this (see `MapProvider.onMapClick`), so this never fights marker selection.
    const unsubscribeMapClick = provider.onMapClick(dismiss);

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      unsubscribeMapClick();
      overlay.unmount();
      setCapturedPopup(null);
    };
  }, [engine, provider, ready, state.selection, hasPopup]);

  return (
    <div
      ref={containerRef}
      className={
        !provider && fallback
          ? 'flex h-full min-h-0 w-full items-center justify-center'
          : 'h-full min-h-0 w-full'
      }
    >
      {!provider && fallback}
      {hasPopup && capturedPopup
        ? createPortal(
            <Popup entity={capturedPopup.entity} onClose={() => engine.selectPoint(engine.primaryDatasetId, null)} />,
            capturedPopup.container,
          )
        : null}
    </div>
  );
}
