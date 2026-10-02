'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

import type { Bounds, LatLng, MapHandle, RenderedLayer, Unsubscribe } from '~/interfaces';

import { FallbackPopup, useListingComponents } from '../components-provider';
import { useListing } from '../hooks/use-listing';
import { useListingSelector } from '../hooks/use-listing-selector';
import type { useListingState } from '../hooks/use-listing-state';

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

/** Whether the element occupies real space -- false while it is `display: none`
 *  (the mobile List view's hidden map pane) or still mid-layout. */
function isLaidOut(el: HTMLElement): boolean {
  const { height, width } = el.getBoundingClientRect();
  return width > 0 && height > 0;
}

/**
 * Whether the environment lays anything out at all.
 *
 * jsdom and other non-visual DOMs report every box as 0x0 -- including the
 * document's own -- so "no size yet" and "hidden" are indistinguishable there
 * and waiting for a size would wait forever. A real browser always gives the
 * document element the viewport, hidden panes and all.
 */
function laysOut(el: HTMLElement): boolean {
  const root = el.ownerDocument.documentElement;
  const { height, width } = root.getBoundingClientRect();
  return width > 0 || height > 0;
}

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
  /**
   * Rendered as an absolutely-positioned overlay floating over the map (e.g. zoom/fullscreen
   * buttons), independent of `MapProvider.mount`/the map SDK -- unlike the `Popup` slot (which is
   * portaled through `provider.mountOverlay` so it can be lat/lng-anchored and pan with the map),
   * this is a plain React child laid over the WHOLE map area, positioned by the consumer's own
   * CSS on `mapControls`' content (e.g. `top-right`). The overlay wrapper itself is
   * `pointer-events: none` (so it never blocks map drag/click-through) while `mapControls` is
   * wrapped in a `pointer-events: auto` node so its own interactive content stays clickable.
   * Omit (the default, `undefined`) to render nothing extra -- no behavior change.
   */
  mapControls?: ReactNode;
  /**
   * Fires with the underlying map SDK's native map object (the
   * `google.maps.Map` for `googleProvider`) the moment the map finishes
   * mounting, and again with `null` when it is torn down (unmount / Strict-Mode
   * double-invoke). Typed `unknown` because this layer is provider-agnostic:
   * the consumer casts to their SDK's map type. This is the escape hatch for
   * provider-specific features the library doesn't wrap (e.g. Google
   * data-driven-styling `FeatureLayer`s). Omit (the default) to fire nothing --
   * a fully backward-compatible addition.
   */
  onMapReady?: (map: unknown) => void;
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
 *   to `engine.selectPoint(datasetId, markerId)`. The layer is handed to
 *   `provider.renderLayer` AGAIN on every change, never torn down first: a
 *   provider reconciles a layer id against its previous render (a kept marker
 *   keeps its DOM node), so a points reload does not blink the markers. A
 *   dataset that stops rendering (gone from `state.points`, hidden via
 *   `toggleLayer`) is torn down right there.
 * - Layer-teardown effect (declared SECOND): tears every live layer down when
 *   the map goes away (unmount, or a provider/engine change) -- and only then.
 * - Mount effect (declared THIRD): awaits `provider.mount(container, {
 *   center, zoom, fullscreenTarget })`, stashes the resulting `MapHandle` in a ref, and wires
 *   `provider.onBoundsChange(handle, b => engine.loadPoints(b))`. `fullscreenTarget` is the outer
 *   wrapper (`wrapperRef`), not `container` itself -- see "`mapControls`" below for why. Cleanup
 *   unsubscribes bounds and calls `provider.destroy(handle)`. Also kicks a
 *   one-time, unbounded `engine.loadPoints(WORLD_BOUNDS)` right after the
 *   handle is ready -- see "Auto-fit" below for why.
 * - Auto-fit effect (declared FOURTH): frames the map to its own data, once,
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
 *
 * `mapControls`: rendered as a plain (non-portaled) React overlay laid over the WHOLE map area --
 * see `IListingMapProps.mapControls`'s own doc comment. Deliberately NOT a child of the ref'd
 * container passed to `provider.mount()`: a real map SDK (e.g. Google Maps) takes ownership of
 * that element's contents, so `mapControls` is instead a sibling inside an outer wrapper `<div>`
 * (`wrapperRef`), absolutely positioned over it via CSS -- never competing with the map SDK for
 * that node's children. `null`/`undefined` renders nothing extra (no wrapper divs at all), so
 * this is a fully backward-compatible addition.
 *
 * Because `mapControls` is a SIBLING of the map mount div rather than a descendant, a
 * fullscreen/zoom button rendered through it needs `toggleFullscreen()` to target an element that
 * CONTAINS both of them -- the Fullscreen API only shows the target element and its descendants,
 * so fullscreening the mount div alone would make any such button disappear the instant
 * fullscreen is entered. `wrapperRef` (the outer `<div>` itself) is passed as `fullscreenTarget`
 * in the mount effect above for exactly this reason -- see `MapInitOptions.fullscreenTarget`'s
 * doc comment.
 */
export function ListingMap(props: IListingMapProps) {
  const { center, zoom, fallback, mapControls, onMapReady } = props;
  const engine = useListing();
  // The four values this component draws from, each its own subscription: a
  // filter write or a results load is none of the map's business, and a
  // re-render here re-runs every effect's dependency check below.
  type State = ReturnType<typeof useListingState>;
  const state = {
    hovered: useListingSelector<State['hovered']>(s => s.hovered),
    layers: useListingSelector<State['layers']>(s => s.layers),
    points: useListingSelector<State['points']>(s => s.points),
    selection: useListingSelector<State['selection']>(s => s.selection),
  };

  // Latest `onMapReady` reachable from the mount effect WITHOUT joining its
  // dependency list: an inline consumer closure changes identity every render,
  // but the mount effect keys only on `[engine, provider]` -- remounting the
  // whole map on any other change would tear down and rebuild the SDK map. Read
  // through a ref so the fire below always calls the current callback (same
  // ref-latch pattern as `selectedRef`/`FiltersChangeEmitter`).
  const onMapReadyRef = useRef(onMapReady);
  onMapReadyRef.current = onMapReady;

  const containerRef = useRef<HTMLDivElement | null>(null);
  // The outer wrapper -- contains BOTH `containerRef`'s map mount div and the `mapControls`
  // overlay (a sibling of it, never a child -- see this component's doc comment). Passed to
  // `provider.mount` as `fullscreenTarget` so `toggleFullscreen()` fullscreens an element that
  // still shows `mapControls`; fullscreening `containerRef` alone would hide it (the Fullscreen
  // API only shows the target element and its descendants, never a sibling).
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const handleRef = useRef<MapHandle | null>(null);
  const [ready, setReady] = useState(false);

  // Auto-fit bookkeeping -- see the class doc comment's "Auto-fit" section.
  const didAutoFitRef = useRef(false);
  const userMovedRef = useRef(false);
  const autoFitInProgressRef = useRef(false);

  // Subscribed, not read once: a provider can be attached after this mounted
  // (`engine.attachMap`), which announces itself through a store write.
  const provider = useListingSelector(() => engine.map);

  // Live layer renders by dataset id -- the unsubscribe each `provider.renderLayer`
  // call returned. Kept in a ref, not effect-local, so a points reload hands the
  // layer to the provider AGAIN without tearing the previous render down first:
  // a provider reconciles a layer id against its previous render (a kept marker
  // keeps its DOM node -- see the Google provider's `reconcileOverlayMarkers`)
  // and the superseded unsubscribe is a guarded no-op. An effect-local cleanup
  // ran on every deps change instead, so every map settle rebuilt every marker
  // and blinked them all.
  const layerUnsubsRef = useRef(new Map<string, Unsubscribe>());

  useEffect(() => {
    const handle = handleRef.current;
    if (!provider || !handle) return;

    const unsubs = layerUnsubsRef.current;
    const rendered = new Set<string>();
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
      unsubs.set(datasetId, provider.renderLayer(handle, layer));
      rendered.add(datasetId);
    }

    // A dataset that no longer renders -- gone from `state.points`, or hidden
    // via `toggleLayer` -- has its layer torn down; the others stay live.
    for (const [datasetId, unsub] of unsubs) {
      if (rendered.has(datasetId)) continue;
      unsub();
      unsubs.delete(datasetId);
    }
  }, [engine, provider, ready, state.points, state.layers]);

  // Layer teardown: every live layer goes when the map does (unmount, or a
  // provider/engine change) -- and only then. Declared BEFORE the mount effect
  // below so this cleanup runs on unmount BEFORE the mount effect's cleanup
  // (`provider.destroy`) -- see the class doc comment above for why ordering
  // matters here.
  useEffect(() => {
    const unsubs = layerUnsubsRef.current;
    return () => {
      unsubs.forEach(unsub => unsub());
      unsubs.clear();
    };
  }, [engine, provider, ready]);

  useEffect(() => {
    if (!containerRef.current || !provider) return;

    const container = containerRef.current;
    let cancelled = false;
    let boundsUnsub: Unsubscribe | null = null;
    let sizeObserver: ResizeObserver | null = null;

    const mount = async (): Promise<void> => {
      const handle = await provider.mount(container, {
        center,
        zoom,
        fullscreenTarget: wrapperRef.current ?? undefined,
      });

      if (cancelled) {
        // Strict-Mode double-invoke (or an unusually fast unmount) already
        // tore this run down before the async mount settled -- nothing in
        // the tree references `handle` anymore, so destroy it right away
        // instead of leaking it, and skip subscribing to its bounds.
        provider.destroy(handle);
        return;
      }

      handleRef.current = handle;
      // Register the mounted handle on the engine so engine-level map actions
      // that need one (`engine.fitBounds`, surfaced as
      // `useListingMap().fitBounds`) can reach it from anywhere under the
      // provider -- consumers have no access to this component-local ref.
      // Cleared in this effect's cleanup below, alongside `handleRef`.
      //
      // Guard interaction, on purpose: a consumer-invoked `engine.fitBounds`
      // does NOT set `autoFitInProgressRef`, so the bounds-changed event the
      // map SDK fires for it is treated exactly like a user pan --
      // `userMovedRef` is set (suppressing any not-yet-fired auto-fit, which
      // must never yank the view away from a destination the consumer
      // explicitly flew to) and, crucially, `engine.loadPoints(bounds)` below
      // still runs unconditionally, so the normal bounds-changed flow
      // (store.setBounds + BoundsChanged + per-layer point reload, and any
      // consumer bounds->filters sync built on it) fires for the new area.
      // The guard never swallows the event -- it only classifies its origin.
      engine.setMapHandle(handle);
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

      // Hand the consumer the native map now that it's fully mounted (see
      // `onMapReady`'s doc). Placed AFTER the `cancelled` guard above, so a
      // Strict-Mode-discarded mount never leaks a live map object the consumer
      // would attach overlays to and then never hear was destroyed.
      onMapReadyRef.current?.(handle.nativeMap ?? handle.raw);

      // Kick a one-time, unbounded points load so there is data to frame
      // even though the map hasn't panned (and therefore never fired its
      // own bounds-changed event) yet -- see "Auto-fit" in the class doc
      // comment. Fire-and-forget: `loadPoints` itself is responsible for
      // getting its result into `state.points`, and this call only ever
      // runs once per real (non-Strict-Mode-discarded) mounted handle,
      // since it lives after the `cancelled` check above.
      void engine.loadPoints(WORLD_BOUNDS);
    };

    // Nothing boots into a container that has not been laid out.
    //
    // A map SDK is the heaviest thing on the page -- Google's costs the better
    // part of a megabyte of script before it draws anything -- and a hidden
    // pane cannot draw. The mobile layout keeps the map mounted but
    // `display: none` behind the List view, so every visitor who never opened
    // the map paid for the SDK anyway. Waiting for real size defers that until
    // the pane is actually shown, and costs a laid-out desktop map nothing: the
    // container already has size on this first pass and mounts synchronously.
    //
    // The same rule also protects the map itself. Created against a 0x0 box it
    // comes up centered on nothing and framed on the whole world -- the state
    // `fitBounds` callers have to work around today.
    //
    // Degrades to mounting straight away wherever the wait could never end: a
    // DOM with no `ResizeObserver`, or one that lays nothing out.
    if (isLaidOut(container) || !laysOut(container) || typeof ResizeObserver === 'undefined') {
      void mount();
    } else {
      sizeObserver = new ResizeObserver(() => {
        if (!isLaidOut(container)) return;
        sizeObserver?.disconnect();
        sizeObserver = null;
        void mount();
      });
      sizeObserver.observe(container);
    }

    return () => {
      cancelled = true;
      sizeObserver?.disconnect();
      boundsUnsub?.();
      if (handleRef.current) {
        provider.destroy(handleRef.current);
        handleRef.current = null;
        // Deregister so `engine.fitBounds` goes back to being a safe no-op --
        // the engine outlives this component (it belongs to the provider), so
        // a stale handle left behind would delegate into a destroyed map.
        engine.setMapHandle(null);
        // Tell the consumer the native map is gone so it can drop any
        // provider-specific overlays/layers it attached in `onMapReady`.
        onMapReadyRef.current?.(null);
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
    <div ref={wrapperRef} className="relative h-full min-h-0 w-full">
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
      {mapControls != null && (
        <div className="pointer-events-none absolute inset-0">
          <div className="pointer-events-auto">{mapControls}</div>
        </div>
      )}
    </div>
  );
}
