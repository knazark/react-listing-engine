import { importLibrary, setOptions, type APIOptions } from '@googlemaps/js-api-loader';
import type {
  Bounds,
  EntityId,
  LatLng,
  MapHandle,
  MapInitOptions,
  MapOverlayHandle,
  MapProvider,
  RenderedLayer,
  Unsubscribe,
} from '~/interfaces';

// `@googlemaps/markerclusterer` is an OPTIONAL peer dependency (see package.json) -- loaded via
// a dynamic `import()` inside `setupClustering` below, never eagerly, so consumers who never use
// `layer.clustering` don't pay for it and the package needn't be installed at all. `import type`
// is erased at compile time (no runtime import), so referencing its types here is safe even when
// the package is absent -- it's still a real devDependency of THIS package so these types resolve
// during our own typecheck/build.
import type { Cluster, MarkerClusterer as MarkerClustererInstance } from '@googlemaps/markerclusterer';

// --- Real `google.maps.*` types -----------------------------------------------------------
//
// `@types/google.maps` is a direct devDependency of this package (see package.json), which
// makes the ambient `declare namespace google.maps { ... }` load into the TS program via
// default `typeRoots` resolution (`node_modules/@types`). The aliases below are therefore
// literal `google.maps.X` types, not structurally derived from `importLibrary`'s return type.
type MarkerLibrary = google.maps.MarkerLibrary;
type GoogleMap = google.maps.Map;
type AdvancedMarker = google.maps.marker.AdvancedMarkerElement;
type GoogleMapsEventListener = google.maps.MapsEventListener;
type GoogleLatLngBounds = google.maps.LatLngBounds;
type LayerMarkerSpec = RenderedLayer['markers'][number];
/**
 * An `OverlayView`-backed HTML marker (see `getHtmlMarkerCtor`), used only in `styles`
 * (no-`mapId`) mode. Structurally it's just a `google.maps.OverlayView` -- all the provider needs
 * from it externally is `setMap()`, which `OverlayView` already exposes.
 */
type HtmlMarker = google.maps.OverlayView;
/**
 * Lifecycle hooks `createOverlayMarkers` passes into every `HtmlMarkerOverlay` instance so it can
 * maintain `raw.markerElements` (the id -> container-`<div>` index `updateMarkerStates` reads)
 * from INSIDE the overlay's own `onAdd`/`onRemove` -- the only place the container `<div>` is
 * actually created/torn down. `google.maps.OverlayView.onAdd()` fires asynchronously (on the
 * next map render cycle), never synchronously inside `setMap()`, so this is the only place that
 * reliably observes the container the moment it exists.
 */
interface HtmlMarkerLifecycle {
  /** Called from `onAdd()` with the freshly created container `<div>`. */
  onContainerAdd(container: HTMLElement): void;
  /**
   * Called from `onRemove()` with the container `<div>` that overlay itself created (and is now
   * tearing down). Receives the container so the caller can guard against clearing a FRESH entry
   * a later re-render for the same marker id may already have registered by the time this
   * (now-stale) overlay's `onRemove` gets around to firing -- both `onAdd`/`onRemove` are
   * asynchronous, so ordering across an old/new overlay pair for the same id is never guaranteed.
   */
  onContainerRemove(container: HTMLElement): void;
}
interface HtmlMarkerCtor {
  new (position: LatLng, content: HTMLElement, onClick: (() => void) | undefined, lifecycle: HtmlMarkerLifecycle): HtmlMarker;
}

export interface GoogleMapsProviderConfig {
  /** Google Maps JavaScript API key. Required -- there is no hardcoded fallback. */
  apiKey: string;
  /**
   * Forwarded to every `google.maps.Map`. Required by Google for `AdvancedMarkerElement` to
   * render at all -- a map created without a Map ID silently drops advanced markers (see
   * https://developers.google.com/maps/documentation/javascript/advanced-markers/migration).
   * Defaults to Google's documented zero-config dev Map ID (`DEFAULT_MAP_ID`,
   * `'DEMO_MAP_ID'`) when omitted, so advanced markers work out of the box with no setup.
   * `'DEMO_MAP_ID'` carries no custom styling and is not intended for production traffic --
   * consumers should supply their own Cloud Console-configured Map ID for production use or
   * custom map styling.
   */
  mapId?: string;
  /**
   * Extra `setOptions()` config (language, region, preloaded libraries, ...). `key` always
   * comes from `apiKey` and cannot be overridden here.
   */
  loaderOptions?: Partial<Omit<APIOptions, 'key'>>;
  /**
   * Extra `google.maps.MapOptions` merged into every map this provider creates -- the zoom
   * envelope (`minZoom`/`maxZoom`), UI chrome (`disableDefaultUI`, `zoomControl`), gesture
   * handling, `clickableIcons`, etc. Spread FIRST, so the provider's own required keys always
   * win over it: `mapId` here is ignored (use the `mapId` field), and `center`/`zoom` here are
   * ignored (they come from the per-mount `MapInitOptions`). NOTE: the legacy `styles` array is
   * IGNORED by Google whenever a `mapId` is present -- to apply legacy JSON styling, use the
   * top-level `styles` field (which switches the provider into no-`mapId` OverlayView marker
   * mode) rather than putting `styles` here, or style a Map ID via the Cloud Console.
   */
  mapOptions?: Partial<google.maps.MapOptions>;
  /**
   * Legacy JSON map styling (`google.maps.MapTypeStyle[]`). MUTUALLY EXCLUSIVE with `mapId`:
   * Google IGNORES JSON `styles` whenever a Map ID is present, and `AdvancedMarkerElement`
   * REQUIRES a Map ID -- so the two cannot coexist. Supplying `styles` therefore switches the
   * provider into a NO-`mapId` mode: the map is created with these `styles` (and no Map ID), and
   * markers are rendered as `OverlayView` HTML overlays -- which need no Map ID -- instead of
   * `AdvancedMarkerElement`s. `mapId` is ignored while `styles` is set. Clustering
   * (`layer.clustering`) is NOT supported in this OverlayView mode (`MarkerClusterer` only manages
   * `Marker`/`AdvancedMarkerElement`) and is skipped with a one-time console warning. Omit
   * `styles` to keep the default advanced-marker (`mapId`) path.
   */
  styles?: google.maps.MapTypeStyle[];
}

/**
 * Google's documented, zero-config dev Map ID -- enables `AdvancedMarkerElement` without
 * requiring a consumer to provision their own Map ID in Cloud Console first. See
 * https://developers.google.com/maps/documentation/javascript/advanced-markers/migration#creating-a-new-map-id
 * Used only as the fallback for `GoogleMapsProviderConfig.mapId`; see that field's doc comment.
 */
const DEFAULT_MAP_ID = 'DEMO_MAP_ID';

/** Internal state stashed behind `MapHandle.raw` -- needed by the synchronous `renderLayer`. */
interface GoogleMapRaw {
  map: GoogleMap;
  markerLib: MarkerLibrary;
  /**
   * Which marker implementation this map uses, decided once at `mount` from whether `config.styles`
   * was supplied: `'advanced'` = `AdvancedMarkerElement` (default, needs a `mapId`), `'overlay'` =
   * `OverlayView` HTML markers (no `mapId`, so JSON `styles` apply). See `GoogleMapsProviderConfig.styles`.
   */
  markerMode: 'advanced' | 'overlay';
  /** Per-layer live markers -- `AdvancedMarkerElement`s in advanced mode, `OverlayView`s in overlay mode. */
  layers: Map<string, AdvancedMarker[] | HtmlMarker[]>;
  /** One active `MarkerClusterer` per clustered layer id -- see `setupClustering`/`disposeClusterer`. */
  clusterers: Map<string, MarkerClustererInstance>;
  /**
   * Overlay-mode (`styles`/no-`mapId`) index of each rendered marker's CONTAINER `<div>`, keyed by
   * marker id, spanning every layer -- populated in `createOverlayMarkers`, pruned per-layer as
   * layers are replaced/torn down in `renderLayer` (via `layerMarkerIds`, below) and cleared
   * entirely in `destroy`. Read by `updateMarkerStates` to toggle
   * `rle-marker--selected`/`rle-marker--hovered` on the exact existing node -- never touched in
   * advanced-marker mode, so `updateMarkerStates` is naturally a no-op there.
   */
  markerElements: Map<EntityId, HTMLElement>;
  /**
   * Which marker ids each layer currently contributes to `markerElements`, so a layer
   * re-render/teardown can prune exactly its own entries (and no others') from that shared,
   * cross-layer index. Overlay mode only -- unused (and harmless to leave unused) in advanced mode.
   */
  layerMarkerIds: Map<string, EntityId[]>;
  boundsListeners: Set<GoogleMapsEventListener>;
  /** `undefined` under SSR/environments without `ResizeObserver` -- see `observeContainerResize`. */
  resizeObserver: ResizeObserver | undefined;
}

function toRaw(handle: MapHandle): GoogleMapRaw {
  return handle.raw as GoogleMapRaw;
}

function resolveMarkerContent(marker: LayerMarkerSpec, markerLib: MarkerLibrary): HTMLElement | undefined {
  if (marker.element) return marker.element;
  // `.element` is the actual HTMLElement -- the `PinElement` instance itself is
  // NOT a DOM node at runtime (despite `@types/google.maps` declaring it
  // `extends HTMLElement`), so passing the instance as `content` makes Google's
  // marker mount call `IntersectionObserver.observe()` on a non-Element and throw.
  if (marker.iconUrl) return new markerLib.PinElement({ glyphSrc: marker.iconUrl }).element;
  // Neither given: leave `content` unset so AdvancedMarkerElement falls back to its own
  // built-in default PinElement (Google's documented default for `content`).
  return undefined;
}

const OVERLAY_DOT_SIZE_PX = 12;
const OVERLAY_DOT_COLOR = '#b3261e';

/**
 * Overlay-mode counterpart to `resolveMarkerContent`. Unlike `AdvancedMarkerElement` (which has a
 * built-in default pin when `content` is unset), an `OverlayView` HTML marker has no fallback, so
 * this ALWAYS returns a real `HTMLElement`: the marker's own `element`, else an `<img>` for its
 * `iconUrl`, else a small default dot.
 */
function resolveOverlayContent(marker: LayerMarkerSpec): HTMLElement {
  if (marker.element) return marker.element;
  if (marker.iconUrl) {
    const img = document.createElement('img');
    img.src = marker.iconUrl;
    return img;
  }
  const dot = document.createElement('div');
  dot.style.width = `${OVERLAY_DOT_SIZE_PX}px`;
  dot.style.height = `${OVERLAY_DOT_SIZE_PX}px`;
  dot.style.borderRadius = '50%';
  dot.style.backgroundColor = OVERLAY_DOT_COLOR;
  dot.style.border = '2px solid #ffffff';
  dot.style.boxShadow = '0 1px 4px rgba(0, 0, 0, 0.4)';
  return dot;
}

// The `OverlayView` subclass can only be *defined* once the Maps JS `maps` library has loaded
// (`google.maps.OverlayView` doesn't exist before that), so it's built lazily on first use and
// cached in this module-level slot -- see `getHtmlMarkerCtor`.
let htmlMarkerCtor: HtmlMarkerCtor | undefined;

/**
 * Lazily defines (and caches) an `OverlayView` subclass that renders `content` as an absolutely
 * positioned HTML `div` centered on a lat/lng. Used only in `styles` (no-`mapId`) mode, where
 * `AdvancedMarkerElement` isn't available. Must be called only after the `maps` library has loaded.
 */
function getHtmlMarkerCtor(): HtmlMarkerCtor {
  if (htmlMarkerCtor) return htmlMarkerCtor;

  class HtmlMarkerOverlay extends google.maps.OverlayView {
    private div: HTMLDivElement | null = null;

    constructor(
      private readonly position: LatLng,
      private readonly content: HTMLElement,
      private readonly onClick: (() => void) | undefined,
      private readonly lifecycle: HtmlMarkerLifecycle,
    ) {
      super();
    }

    override onAdd(): void {
      const div = document.createElement('div');
      div.style.position = 'absolute';
      // Center the content on the coordinate rather than anchoring its top-left corner there.
      div.style.transform = 'translate(-50%, -50%)';
      if (this.onClick) {
        div.style.cursor = 'pointer';
        div.addEventListener('click', this.onClick);
      }
      div.appendChild(this.content);
      this.div = div;
      this.getPanes()?.overlayMouseTarget.appendChild(div);
      // Register the container the moment it actually exists -- `onAdd()` is the only place that
      // does, and (in the real Maps runtime) it fires asynchronously, never synchronously right
      // after `setMap()`. See `HtmlMarkerLifecycle`'s doc comment.
      this.lifecycle.onContainerAdd(div);
    }

    override draw(): void {
      if (!this.div) return;
      const projection = this.getProjection();
      if (!projection) return;
      const point = projection.fromLatLngToDivPixel(new google.maps.LatLng(this.position.lat, this.position.lng));
      if (!point) return;
      this.div.style.left = `${point.x}px`;
      this.div.style.top = `${point.y}px`;
    }

    override onRemove(): void {
      const div = this.div;
      this.div?.remove();
      this.div = null;
      if (div) this.lifecycle.onContainerRemove(div);
    }
  }

  htmlMarkerCtor = HtmlMarkerOverlay;
  return htmlMarkerCtor;
}

// How far (px) above the anchor coordinate the popup's bottom edge sits, so it
// clears the marker centered on that coordinate rather than overlapping it.
const POPUP_OFFSET_Y_PX = 14;

/**
 * A lat/lng-anchored `OverlayView` that hosts an arbitrary `container` `<div>`
 * in the `floatPane` (the pane Google itself uses for InfoWindows -- above
 * markers and mouse-interactive, so the popup's own controls are clickable).
 * Backs `googleProvider.mountOverlay`; the caller portals React into `container`.
 * `updatePosition` re-anchors it (used by the returned handle's `setPosition`).
 */
type PopupOverlay = google.maps.OverlayView & { updatePosition(position: LatLng): void };
interface PopupOverlayCtor {
  new (container: HTMLElement, position: LatLng): PopupOverlay;
}

// Same lazy-definition dance as `getHtmlMarkerCtor`: `google.maps.OverlayView`
// only exists once the `maps` library has loaded, so the subclass is built on
// first use (always after a `mount`, so the library is present) and cached.
let popupOverlayCtor: PopupOverlayCtor | undefined;

function getPopupOverlayCtor(): PopupOverlayCtor {
  if (popupOverlayCtor) return popupOverlayCtor;

  class PopupOverlayView extends google.maps.OverlayView {
    // Tracks whether we're currently attached (between onAdd and onRemove) so
    // `updatePosition` knows if it can reposition NOW (projection ready) or
    // should just stash the new position for the next map-driven `draw()`.
    private attached = false;

    constructor(
      private readonly container: HTMLElement,
      private position: LatLng,
    ) {
      super();
    }

    override onAdd(): void {
      this.attached = true;
      // Attach the (already-created) container only now -- `onAdd` fires
      // asynchronously on the map's next render cycle, never synchronously in
      // `setMap()`. The container was returned to the caller up front so the
      // React portal target is stable regardless of this timing.
      this.getPanes()?.floatPane.appendChild(this.container);
    }

    override draw(): void {
      const projection = this.getProjection();
      if (!projection) return;
      const point = projection.fromLatLngToDivPixel(new google.maps.LatLng(this.position.lat, this.position.lng));
      if (!point) return;
      // Container CSS anchors its bottom-center on the coordinate
      // (`translate(-50%, -100%)`); lift it a touch so it clears the marker.
      this.container.style.left = `${point.x}px`;
      this.container.style.top = `${point.y - POPUP_OFFSET_Y_PX}px`;
    }

    override onRemove(): void {
      this.attached = false;
      this.container.remove();
    }

    updatePosition(position: LatLng): void {
      this.position = position;
      // Reposition immediately if live; otherwise the next map-driven draw()
      // (or the first draw() after onAdd) picks up the stashed position.
      if (this.attached) this.draw();
    }
  }

  popupOverlayCtor = PopupOverlayView;
  return popupOverlayCtor;
}

/**
 * Detaches every marker from the map, handling BOTH marker kinds: `OverlayView` HTML markers
 * (overlay mode) via `setMap(null)`, `AdvancedMarkerElement`s (advanced mode) via `.map = null`.
 * They're distinguished structurally -- only `OverlayView` exposes a `setMap` method.
 */
function removeMarkers(markers: ReadonlyArray<AdvancedMarker | HtmlMarker>): void {
  for (const marker of markers) {
    if (typeof (marker as HtmlMarker).setMap === 'function') {
      (marker as HtmlMarker).setMap(null);
    } else {
      (marker as AdvancedMarker).map = null;
    }
  }
}

// --- Clustering ----------------------------------------------------------------------------
//
// `layer.clustering` (`{ maxZoom? }` or `false`/`undefined` to opt out) is implemented by
// dynamically importing `@googlemaps/markerclusterer` (optional peer dep) and wrapping the
// layer's already-created `AdvancedMarkerElement`s in a `MarkerClusterer` with a custom renderer
// that draws a solid red circle showing the cluster's marker count -- Rentler's mobile map look.
// Cluster click zooms to the cluster's bounds via the library's own default `onClusterClick`
// (`defaultOnClusterClickHandler`, unset/unoverridden here), so no extra wiring is needed for that.

const CLUSTER_COLOR = '#b3261e';
const CLUSTER_MIN_SIZE_PX = 40;
const CLUSTER_MAX_SIZE_PX = 64;
const CLUSTER_SIZE_STEP_PX = 14;

/**
 * Renders one cluster as a solid red circle with a white, bold marker count. Size scales
 * (gently, log-scaled and capped) with `cluster.count` so a 3-marker cluster and a 300-marker
 * cluster read as visibly different without either becoming illegible or blowing up past a
 * reasonable on-map footprint.
 */
function buildClusterMarkerElement(markerLib: MarkerLibrary, cluster: Cluster): AdvancedMarker {
  const count = cluster.count;
  const size = Math.min(CLUSTER_MAX_SIZE_PX, CLUSTER_MIN_SIZE_PX + Math.round(Math.log10(count + 1) * CLUSTER_SIZE_STEP_PX));

  const circle = document.createElement('div');
  circle.textContent = String(count);
  circle.style.display = 'flex';
  circle.style.alignItems = 'center';
  circle.style.justifyContent = 'center';
  circle.style.width = `${size}px`;
  circle.style.height = `${size}px`;
  circle.style.borderRadius = '50%';
  circle.style.backgroundColor = CLUSTER_COLOR;
  circle.style.border = '2px solid #ffffff';
  circle.style.boxShadow = '0 1px 4px rgba(0, 0, 0, 0.4)';
  circle.style.color = '#ffffff';
  circle.style.fontFamily = 'inherit';
  circle.style.fontWeight = '700';
  circle.style.fontSize = size >= 52 ? '15px' : '13px';

  return new markerLib.AdvancedMarkerElement({ position: cluster.position, content: circle });
}

// Logged at most once per page load (module-level flag, not per-layer/per-call) -- a missing
// optional dependency is a one-time environment fact, not a per-render event.
let markerClustererImportWarned = false;

/**
 * Dynamically imports `@googlemaps/markerclusterer` and wraps `markers` (already live on
 * `raw.map`, created synchronously by `renderLayer` just before this was called) in a
 * `MarkerClusterer` for `layerId`, storing it in `raw.clusterers` for later teardown.
 *
 * Guarded on both ends against the optional dependency being absent AND against races with a
 * later `renderLayer`/`unsubscribe` call for the same `layerId` that may complete while this
 * import is in flight (dynamic `import()` is the only async step in an otherwise synchronous
 * render path -- see `renderLayer`'s doc comment):
 * - try/catch around the import: if `@googlemaps/markerclusterer` is not installed, warns once
 *   (never throws) and leaves `markers` rendered as plain, unclustered pins -- no crash.
 * - `raw.layers.get(layerId) !== markers` after the import resolves: a later `renderLayer` call
 *   for this `layerId` (or its returned `unsubscribe`) may already have replaced/removed
 *   `markers` while the import was in flight; bail out instead of clustering (or registering a
 *   clusterer for) a stale, no-longer-current marker set.
 */
async function setupClustering(
  raw: GoogleMapRaw,
  layerId: string,
  markers: AdvancedMarker[],
  clustering: Exclude<RenderedLayer['clustering'], false | undefined>,
): Promise<void> {
  let markerClusterer: typeof import('@googlemaps/markerclusterer');
  try {
    markerClusterer = await import('@googlemaps/markerclusterer');
  } catch (error) {
    if (!markerClustererImportWarned) {
      markerClustererImportWarned = true;
      console.warn(
        '[react-listing-engine] "@googlemaps/markerclusterer" is not installed -- rendering plain ' +
          '(unclustered) markers instead. Install "@googlemaps/markerclusterer" to enable clustering.',
        error,
      );
    }
    return;
  }

  if (raw.layers.get(layerId) !== markers) return;

  const clusterer = new markerClusterer.MarkerClusterer({
    map: raw.map,
    markers,
    algorithmOptions: { maxZoom: clustering.maxZoom },
    renderer: { render: cluster => buildClusterMarkerElement(raw.markerLib, cluster) },
  });
  raw.clusterers.set(layerId, clusterer);
}

/** Tears down (if present) and unregisters the `MarkerClusterer` owned by `layerId`. */
function disposeClusterer(raw: GoogleMapRaw, layerId: string): void {
  const clusterer = raw.clusterers.get(layerId);
  if (!clusterer) return;
  // `MarkerClusterer` is a `google.maps.OverlayView` subclass; `setMap(null)` triggers its
  // `onRemove()`, which sets every managed marker's (including any live cluster circle's) map
  // to `null` -- no separate marker cleanup is needed here on top of this.
  clusterer.setMap(null);
  raw.clusterers.delete(layerId);
}

// Logged at most once per page load (module-level flag) -- a consumer using `styles` mode with
// `layer.clustering` set is a static configuration fact, not a per-render event.
let overlayClusteringWarned = false;

/** Warns (once) that clustering is ignored in `styles` (OverlayView) mode. See `GoogleMapsProviderConfig.styles`. */
function warnOverlayClusteringUnsupported(): void {
  if (overlayClusteringWarned) return;
  overlayClusteringWarned = true;
  console.warn(
    '[react-listing-engine] Marker clustering is not supported in `styles` (OverlayView) mode -- ' +
      '"@googlemaps/markerclusterer" only manages Marker/AdvancedMarkerElement instances. Rendering ' +
      'plain, unclustered overlay markers instead. Use a `mapId` (advanced-marker mode) to enable clustering.',
  );
}

/** Creates one `AdvancedMarkerElement` per spec, live on `raw.map` (default advanced mode). */
function createAdvancedMarkers(raw: GoogleMapRaw, layer: RenderedLayer): AdvancedMarker[] {
  return layer.markers.map((marker) => {
    const advancedMarker = new raw.markerLib.AdvancedMarkerElement({
      map: raw.map,
      position: marker.position,
      content: resolveMarkerContent(marker, raw.markerLib),
      gmpClickable: Boolean(layer.onMarkerClick),
    });
    if (layer.onMarkerClick) {
      const onMarkerClick = layer.onMarkerClick;
      advancedMarker.addListener('click', () => onMarkerClick(marker.id));
    }
    return advancedMarker;
  });
}

/**
 * Creates one `OverlayView` HTML marker per spec, live on `raw.map` (`styles`/no-`mapId` mode).
 * Also indexes each marker's container `<div>` into `raw.markerElements` by marker id (used later
 * by `updateMarkerStates`) -- via the `HtmlMarkerLifecycle` hooks below, populated FROM the
 * overlay's own `onAdd`/`onRemove`, never by reading the container back synchronously right after
 * `setMap()` (real `OverlayView.onAdd()` fires asynchronously, on the next map render cycle --  a
 * synchronous read finds nothing, and the index stays permanently empty).
 */
function createOverlayMarkers(raw: GoogleMapRaw, layer: RenderedLayer): HtmlMarker[] {
  const HtmlMarkerOverlay = getHtmlMarkerCtor();
  return layer.markers.map((marker) => {
    const onMarkerClick = layer.onMarkerClick;
    const onClick = onMarkerClick ? () => onMarkerClick(marker.id) : undefined;
    const htmlMarker = new HtmlMarkerOverlay(marker.position, resolveOverlayContent(marker), onClick, {
      onContainerAdd: (container) => raw.markerElements.set(marker.id, container),
      onContainerRemove: (container) => {
        // Only clear if this id's index entry is still THIS container -- a re-render for the
        // same layer.id may already have registered a FRESH container for `marker.id` by the
        // time this (now-stale) overlay's onRemove gets around to firing (see
        // `HtmlMarkerLifecycle`'s doc comment).
        if (raw.markerElements.get(marker.id) === container) raw.markerElements.delete(marker.id);
      },
    });
    htmlMarker.setMap(raw.map);
    return htmlMarker;
  });
}

/**
 * Removes `layerId`'s marker ids (if any were recorded -- overlay mode only) from the shared,
 * cross-layer `raw.markerElements` index. Called both when a layer is REPLACED (a fresh
 * `renderLayer` call for the same `layer.id`) and when it is TORN DOWN (its `renderLayer`
 * unsubscribe is called), so no stale container-div reference for that layer ever lingers in the
 * index for `updateMarkerStates` to (harmlessly, but wastefully) keep toggling classes on.
 */
function pruneLayerMarkerElements(raw: GoogleMapRaw, layerId: string): void {
  const ids = raw.layerMarkerIds.get(layerId);
  if (!ids) return;
  for (const id of ids) raw.markerElements.delete(id);
  raw.layerMarkerIds.delete(layerId);
}

function boundsFromGoogle(bounds: GoogleLatLngBounds): Bounds {
  const southWest = bounds.getSouthWest();
  const northEast = bounds.getNorthEast();
  return { west: southWest.lng(), south: southWest.lat(), east: northEast.lng(), north: northEast.lat() };
}

/**
 * Google Maps needs a real, non-zero-size container to fetch tiles. A map created while its
 * container is still mid-layout (async mount, a CSS transition, a flex/grid pass not yet
 * settled) is created against a 0x0 box and silently never requests tiles -- Maps does not
 * observe its own container for later size changes, so a subsequent layout pass that DOES give
 * it real size still leaves the map blank forever without an explicit nudge.
 *
 * This attaches a `ResizeObserver` to `el` that, on every size change (including the first
 * time the container acquires a non-zero size), fires the documented `resize` event
 * (https://developers.google.com/maps/documentation/javascript/events#dom-events) so Maps
 * re-measures its container and starts fetching tiles. `initialCenter` is re-applied via
 * `setCenter` but ONLY the first time a real size is observed -- a 0->N size transition can
 * otherwise leave the viewport visibly off-center relative to what `mount()` asked for.
 * Subsequent resizes (e.g. a sidebar toggling) still trigger `resize` to keep Maps' internal
 * layout in sync, but never forcibly recenter again, so this never fights a user who has since
 * panned or zoomed.
 *
 * Also probes once via `requestAnimationFrame` (falling back to a microtask) right after
 * `observe()`: the observer's own spec'd initial callback is guaranteed but only on the next
 * repaint, and this is cheap, redundant insurance for that same first-size case rather than a
 * strict requirement.
 *
 * Returns `undefined` when `ResizeObserver` isn't available (SSR, or a test/DOM environment
 * that doesn't implement it) -- the map still mounts, it just loses this hardening.
 */
function observeContainerResize(el: HTMLElement, map: GoogleMap, initialCenter: LatLng): ResizeObserver | undefined {
  if (typeof ResizeObserver === 'undefined') return undefined;

  let hasAcquiredSize = false;
  const nudge = (): void => {
    const { width, height } = el.getBoundingClientRect();
    if (width === 0 || height === 0) return;

    google.maps.event.trigger(map, 'resize');
    if (!hasAcquiredSize) {
      hasAcquiredSize = true;
      map.setCenter(initialCenter);
    }
  };

  const observer = new ResizeObserver(nudge);
  observer.observe(el);

  if (typeof requestAnimationFrame !== 'undefined') {
    requestAnimationFrame(nudge);
  } else {
    queueMicrotask(nudge);
  }

  return observer;
}

/**
 * `MapProvider` backed by the Google Maps JavaScript API.
 *
 * The installed `@googlemaps/js-api-loader` (v2) dropped the class-based `new Loader(...)` API
 * in favor of module-level `setOptions()` + `importLibrary()` functions -- the `Loader` class
 * that remains exported is a deprecated stub whose constructor throws synchronously (see that
 * package's MIGRATION.md and `dist/index.js`). This implementation targets the functional API
 * since that is the real, installed shape.
 *
 * Throws immediately if `config.apiKey` is falsy -- callers must always supply a real key via
 * the factory; there is never a hardcoded fallback.
 */
export function googleProvider(config: GoogleMapsProviderConfig): MapProvider {
  if (!config.apiKey) {
    throw new Error('googleProvider: config.apiKey is required (no hardcoded fallback key is ever used).');
  }

  // `setOptions()` reads `window` internally (to detect an already-loaded `google.maps`) and
  // the library only tolerates a single call. It is deferred to the first `mount()` rather
  // than run here so this factory stays safe to construct at module scope under SSR, where
  // `mount()` (which requires a real `HTMLElement`) will simply never be invoked.
  let optionsConfigured = false;
  const ensureOptionsConfigured = (): void => {
    if (optionsConfigured) return;
    setOptions({ ...config.loaderOptions, key: config.apiKey });
    optionsConfigured = true;
  };

  // The currently-mounted map's raw state, tracked at the FACTORY level (not per-`MapHandle`)
  // because `MapProvider#updateMarkerStates` takes no `MapHandle` parameter -- it mirrors
  // `ListingMap`'s own single `handleRef`, which likewise assumes one live handle per provider
  // instance at a time. Set (see `mountGeneration` below for HOW) and cleared by `destroy()` when
  // the handle being destroyed is the current one, so a stale/discarded handle (e.g. a React
  // Strict Mode double-invoke) can never leave a dangling reference here.
  let currentRaw: GoogleMapRaw | undefined;
  /**
   * Bumped synchronously at the START of every `mount()` call (before its two `await
   * importLibrary(...)` calls), and captured into `myGeneration` below. `mount()` only assigns
   * `currentRaw = raw` once its OWN async work finishes IF its captured generation is still the
   * latest -- i.e. no NEWER `mount()` call has started meanwhile.
   *
   * This is what makes "the most recently STARTED mount always wins `currentRaw`" hold
   * regardless of COMPLETION order. Without it, two overlapping `mount()` calls (e.g. React
   * Strict Mode's dev-only mount -> cleanup -> mount double-invoke, where the first call is
   * cancelled but not yet destroyed since its handle doesn't exist yet) race on whichever one's
   * async chain (two sequential `importLibrary` awaits, real network loads) happens to finish
   * LAST: if the cancelled/stale mount's async work finishes after the kept mount's, it would
   * overwrite `currentRaw` with its own (about-to-be-destroyed) `raw`, and the subsequent
   * `destroy()` call on that stale handle would then (correctly, by its own logic) clear
   * `currentRaw` back to `undefined` -- permanently nulling out `updateMarkerStates`' repaint
   * capability even though the kept mount is still live. The generation guard makes that
   * ordering irrelevant: only the call that is *still the latest* when it finishes ever touches
   * `currentRaw`, so a slower-finishing stale mount silently no-ops instead of overwriting it.
   */
  let mountGeneration = 0;

  return {
    async mount(el: HTMLElement, opts: MapInitOptions): Promise<MapHandle> {
      const myGeneration = ++mountGeneration;
      ensureOptionsConfigured();
      const mapsLib = await importLibrary('maps');
      const markerLib = await importLibrary('marker');
      const center = opts.center ?? { lat: 0, lng: 0 };
      // `styles` and `mapId` are mutually exclusive (see `GoogleMapsProviderConfig.styles`):
      // supplying `styles` creates the map WITHOUT a `mapId` (so JSON styling applies) and drives
      // OverlayView markers; otherwise the default advanced-marker (`mapId`) path is used.
      const useOverlayMode = config.styles != null;
      const map = new mapsLib.Map(el, {
        ...config.mapOptions,
        center,
        zoom: opts.zoom ?? 10,
        ...(useOverlayMode ? { styles: config.styles } : { mapId: config.mapId ?? DEFAULT_MAP_ID }),
      });
      const resizeObserver = observeContainerResize(el, map, center);
      const raw: GoogleMapRaw = {
        map,
        markerLib,
        markerMode: useOverlayMode ? 'overlay' : 'advanced',
        layers: new Map(),
        clusterers: new Map(),
        boundsListeners: new Set(),
        resizeObserver,
        markerElements: new Map(),
        layerMarkerIds: new Map(),
      };
      // Only the still-latest mount call ever becomes `currentRaw` -- see `mountGeneration`'s doc
      // comment for why this can't just be an unconditional assignment.
      if (myGeneration === mountGeneration) currentRaw = raw;
      return { raw };
    },

    renderLayer(handle: MapHandle, layer: RenderedLayer): Unsubscribe {
      const raw = toRaw(handle);

      const previous = raw.layers.get(layer.id);
      if (previous) {
        removeMarkers(previous);
        raw.layers.delete(layer.id);
        pruneLayerMarkerElements(raw, layer.id);
      }
      // A re-render for the same `layer.id` always replaces its clusterer too (not just its
      // markers) -- see `setupClustering`'s doc comment for why this synchronous dispose, run
      // before `created`/`setupClustering` below, is what keeps a stale clusterer from a
      // still-in-flight PREVIOUS call from ever out-living this one.
      disposeClusterer(raw, layer.id);

      const created: AdvancedMarker[] | HtmlMarker[] =
        raw.markerMode === 'overlay' ? createOverlayMarkers(raw, layer) : createAdvancedMarkers(raw, layer);
      raw.layers.set(layer.id, created);
      if (raw.markerMode === 'overlay') {
        raw.layerMarkerIds.set(
          layer.id,
          layer.markers.map((marker) => marker.id),
        );
      }

      if (layer.clustering) {
        if (raw.markerMode === 'overlay') {
          // `MarkerClusterer` only manages Marker/AdvancedMarkerElement, not OverlayView markers --
          // warn once and leave the overlay markers rendered plain (unclustered).
          warnOverlayClusteringUnsupported();
        } else {
          // Fire-and-forget: `setupClustering` is the only async step in this otherwise
          // synchronous render path (see its doc comment for the staleness guard this implies).
          void setupClustering(raw, layer.id, created as AdvancedMarker[], layer.clustering);
        }
      }

      let disposed = false;
      return () => {
        if (disposed) return;
        disposed = true;
        // Guard against a stale closure tearing down a layer that a later `renderLayer`
        // call already replaced for the same `layer.id`.
        if (raw.layers.get(layer.id) === created) {
          removeMarkers(created);
          raw.layers.delete(layer.id);
          disposeClusterer(raw, layer.id);
          pruneLayerMarkerElements(raw, layer.id);
        }
      };
    },

    onBoundsChange(handle: MapHandle, cb: (b: Bounds) => void): Unsubscribe {
      const raw = toRaw(handle);
      const listener = raw.map.addListener('idle', () => {
        const bounds = raw.map.getBounds();
        if (!bounds) return;
        cb(boundsFromGoogle(bounds));
      });
      raw.boundsListeners.add(listener);

      let disposed = false;
      return () => {
        if (disposed) return;
        disposed = true;
        listener.remove();
        raw.boundsListeners.delete(listener);
      };
    },

    onMapClick(cb: () => void): Unsubscribe {
      // No `MapHandle` here (mirrors `mountOverlay`/`updateMarkerStates`): the
      // listener attaches to the currently-mounted map. No live map -> an inert
      // unsubscribe, so a caller can subscribe without crashing.
      const raw = currentRaw;
      if (!raw) return () => {};

      // Mirrors the `'idle'` listener wiring in `onBoundsChange`. A click on the
      // map background fires 'click'; HTML overlay markers live in the
      // `overlayMouseTarget` pane, so clicking a marker does NOT fire this --
      // exactly the "background clicks only" behavior popup dismissal wants.
      const listener = raw.map.addListener('click', () => cb());

      let disposed = false;
      return () => {
        if (disposed) return;
        disposed = true;
        listener.remove();
      };
    },

    fitBounds(handle: MapHandle, b: Bounds): void {
      // `Bounds` ({ west, south, east, north }) is structurally identical to
      // `google.maps.LatLngBoundsLiteral`, so it is passed straight through -- no need to
      // construct a `LatLngBounds` instance (which would pull in the 'core' library).
      toRaw(handle).map.fitBounds(b);
    },

    destroy(handle: MapHandle): void {
      const raw = toRaw(handle);
      raw.resizeObserver?.disconnect();
      for (const listener of raw.boundsListeners) listener.remove();
      raw.boundsListeners.clear();
      // Snapshot the keys before disposing -- `disposeClusterer` deletes from `raw.clusterers`
      // as it goes, and mutating a Map mid-iteration-over-its-own-keys is easy to get subtly
      // wrong, so iterate a plain array copy instead.
      for (const layerId of [...raw.clusterers.keys()]) disposeClusterer(raw, layerId);
      for (const markers of raw.layers.values()) removeMarkers(markers);
      raw.layers.clear();
      raw.markerElements.clear();
      raw.layerMarkerIds.clear();
      if (currentRaw === raw) currentRaw = undefined;
    },

    updateMarkerStates(selectedId: EntityId | null, hoveredId: EntityId | null): void {
      // No currently-mounted map (never mounted yet, or its handle has since been destroyed) --
      // nothing to repaint.
      if (!currentRaw) return;
      // `markerElements` is populated ONLY by `createOverlayMarkers` (overlay/`styles` mode), so
      // this loop is naturally empty -- a no-op -- in advanced-marker mode (`AdvancedMarkerElement`,
      // used only when a Map ID is set): that mode has no addressable container element to toggle
      // classes on, and is out of the perks path this task targets.
      for (const [id, el] of currentRaw.markerElements) {
        el.classList.toggle('rle-marker--selected', id === selectedId);
        el.classList.toggle('rle-marker--hovered', id === hoveredId && id !== selectedId);
      }
    },

    mountOverlay(position: LatLng): MapOverlayHandle {
      // Create and style the container UP FRONT (synchronously) so the returned
      // `container` is a stable React portal target immediately -- the overlay
      // only *attaches/positions* it asynchronously (see `PopupOverlayView`).
      const container = document.createElement('div');
      container.style.position = 'absolute';
      // Anchor its bottom-center on the coordinate (see `PopupOverlayView.draw`).
      container.style.transform = 'translate(-50%, -100%)';
      // floatPane content is clickable; ensure the popup itself receives pointer events.
      container.style.pointerEvents = 'auto';

      // No currently-mounted map (never mounted, or its handle was destroyed):
      // return an inert handle over a stable, detached container so a caller can
      // still portal into it without crashing -- and WITHOUT touching
      // `google.maps.OverlayView`, which may not even be loaded in that state.
      if (!currentRaw) {
        return {
          container,
          setPosition: () => {},
          unmount: () => container.remove(),
        };
      }

      const PopupOverlayView = getPopupOverlayCtor();
      const overlay = new PopupOverlayView(container, position);
      overlay.setMap(currentRaw.map);

      return {
        container,
        setPosition: (next: LatLng) => overlay.updatePosition(next),
        unmount: () => {
          overlay.setMap(null); // triggers onRemove() -> detaches the container
          container.remove(); // belt-and-suspenders if onRemove never ran (never attached)
        },
      };
    },
  };
}
