import { importLibrary, setOptions, type APIOptions } from '@googlemaps/js-api-loader';
import type {
  Bounds,
  EntityId,
  FitBoundsOptions,
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
  /** The element passed to `mount()`. */
  containerEl: HTMLElement;
  /**
   * The Fullscreen API target for `toggleFullscreen` -- `opts.fullscreenTarget ?? containerEl`,
   * resolved once in `mount()`. Kept distinct from `containerEl` because a consumer overlay
   * rendered as a SIBLING of `containerEl` (e.g. `ListingMap`'s `mapControls`) would otherwise
   * vanish the instant `containerEl` alone is fullscreened -- see
   * `MapInitOptions.fullscreenTarget`'s doc comment.
   */
  fullscreenEl: HTMLElement;
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
  /**
   * The most recently requested selected/hovered marker ids (the arguments of the last
   * `updateMarkerStates` call), PERSISTED here rather than only applied transiently to the markers
   * live at that exact moment. A layer re-render (e.g. `ListingMap`'s layer effect rebuilding every
   * marker whenever `state.points` gets a new reference -- which happens on every bounds/idle event,
   * completely independent of selection/hover) tears down the old container and creates a brand-new
   * one with no classes at all. `ListingMap`'s separate marker-state effect deliberately only
   * re-invokes `updateMarkerStates` on a selection/hover CHANGE (see that effect's doc comment), so
   * without this, a freshly recreated container would silently stay unhighlighted until the next real
   * selection/hover change. Reading these back in `onContainerAdd` (see `createOverlayMarkers`) lets a
   * newly registered container regain the correct highlight immediately, regardless of *when* its
   * async `onAdd` happens to fire relative to the last `updateMarkerStates` call. `null` until
   * `updateMarkerStates` is first called. Overlay mode only -- unused (and harmless) in advanced mode.
   */
  selectedMarkerId: EntityId | null;
  hoveredMarkerId: EntityId | null;
  boundsListeners: Set<GoogleMapsEventListener>;
  /**
   * Live `onMapClick` google listeners, mirroring `boundsListeners` above: `onMapClick` (unlike
   * every other subscription method) takes no `MapHandle`, so a caller can hold onto its returned
   * `Unsubscribe` past this map's own `destroy()` -- e.g. `ListingMap`'s popup-overlay effect
   * unsubscribes in ITS OWN cleanup, which for the "close the whole map" unmount path runs in the
   * same tick as (but not provably before) the mount effect's `provider.destroy()`. Without this
   * set, a caller unsubscribing after `destroy()` has already run would find nothing left to force
   * a `remove()` on, and a still-attached `google.maps.MapsEventListener` would leak. `destroy()`
   * force-removes every listener still in this set as a backstop, exactly like `boundsListeners`.
   */
  clickListeners: Set<GoogleMapsEventListener>;
  /** `undefined` under SSR/environments without `ResizeObserver` -- see `observeContainerResize`. */
  resizeObserver: ResizeObserver | undefined;
  /**
   * Cancels whatever phase of an animated `fitBounds` fly is active (the rAF
   * camera drive, or a far-hop overview tile wait) -- `null` when no fly is
   * in flight. Invoked by a NEWER `fitBounds` call and by `destroy`: without
   * cancellation the stale flight would keep driving the camera after the
   * newer request and drag it back toward an old destination.
   */
  cancelFlight: (() => void) | null;
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
      // Stop a real pointer click on this marker from ALSO registering as a click on the
      // underlying map. Without this, `onMapClick`'s background-dismiss listener (added for
      // click-outside popup dismissal) fires on the SAME gesture that just selected this marker --
      // the marker is instantly deselected, so its popup opens and closes in the same click. A
      // synthetic `element.click()` never reproduces this in unit tests because it never produces
      // a real Google map hit; only a live pointer click on the real map does. Feature-detected
      // because this is a real (if old/unlikely) Maps JS API version concern, not just test hygiene.
      //
      // Deliberately `preventMapHitsFrom`, NOT `preventMapHitsAndGesturesFrom`: markers are map
      // furniture, so map GESTURES must keep working through them -- most visibly the scroll
      // wheel, which should zoom the map even when the cursor happens to rest on a price pill
      // (the "AndGestures" variant swallows the wheel and turns every marker into a zoom dead
      // zone). Click-through is still blocked, which is all the popup-dismiss guard needs. The
      // POPUP overlay below keeps the "AndGestures" variant: it is a CARD floating over the map,
      // and swiping/scrolling inside it must never pan or zoom the map underneath.
      if (typeof google.maps.OverlayView.preventMapHitsFrom === 'function') {
        google.maps.OverlayView.preventMapHitsFrom(div);
      }
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
// clears the marker centered on that coordinate rather than overlapping it. Mirrored below the
// anchor when `draw()` flips the popup to clear the map's top edge (see `clampPopupPosition`).
const POPUP_OFFSET_Y_PX = 14;

// Minimum breathing room (px) kept between the popup and the map's own edges when `draw()`
// clamps/flips it into the viewport -- see `clampPopupPosition`.
const POPUP_VIEWPORT_PAD_PX = 8;

/**
 * Pure geometry for keeping the on-map popup inside the map's own viewport -- Google's own
 * InfoWindow clamps/flips analogously; this mirrors that for the custom `OverlayView`-backed
 * popup (see `PopupOverlayView.draw()`, the only caller).
 *
 * The popup's DEFAULT placement puts its bottom-center at `(anchorX, anchorY - offsetY)`, i.e. in
 * viewport coordinates its box spans `[anchorX - popupW/2, anchorX + popupW/2]` horizontally and
 * `[anchorY - offsetY - popupH, anchorY - offsetY]` vertically.
 *
 * Returns:
 * - `dx`: horizontal shift (px) to keep the box's `[left, right]` within `[pad, mapW - pad]`.
 *   Negative shifts LEFT (the box was overflowing the right edge), positive shifts RIGHT
 *   (overflowing the left edge). If the popup doesn't fit within the padded viewport width at
 *   all, it's pinned to `pad` rather than split the difference between two edges it can't both
 *   satisfy.
 * - `flipBelow`: `true` when the default (above-anchor) placement would overflow the TOP edge
 *   (`top < pad`) and flipping BELOW the anchor (new top-center at `anchorY + offsetY`) actually
 *   fits (`anchorY + offsetY + popupH <= mapH - pad`). Otherwise `false` -- including when
 *   flipping wouldn't help either (a map too short for the popup either way), in which case the
 *   caller keeps the default above-anchor placement.
 *
 * Pure arithmetic, no DOM access -- exported so it's unit-testable without a `google.maps` mock.
 */
export function clampPopupPosition(a: {
  anchorX: number;
  anchorY: number;
  popupW: number;
  popupH: number;
  mapW: number;
  mapH: number;
  offsetY: number;
  pad: number;
}): { dx: number; flipBelow: boolean } {
  const { anchorX, anchorY, popupW, popupH, mapW, mapH, offsetY, pad } = a;

  const left = anchorX - popupW / 2;
  const right = anchorX + popupW / 2;

  let dx = 0;
  if (popupW > mapW - pad * 2) {
    // Doesn't fit within the padded viewport width at all -- pin the left edge to `pad` rather
    // than trying (and failing) to satisfy both edges at once.
    dx = pad - left;
  } else if (right > mapW - pad) {
    dx = mapW - pad - right;
  } else if (left < pad) {
    dx = pad - left;
  }

  const topIfAbove = anchorY - offsetY - popupH;
  const bottomIfBelow = anchorY + offsetY + popupH;
  const flipBelow = topIfAbove < pad && bottomIfBelow <= mapH - pad;

  return { dx, flipBelow };
}

/**
 * A lat/lng-anchored `OverlayView` that hosts an arbitrary `container` `<div>`
 * in the `floatPane` (the pane Google itself uses for InfoWindows -- above
 * markers and mouse-interactive, so the popup's own controls are clickable).
 * Backs `googleProvider.mountOverlay`; the caller portals React into `container`.
 * `updatePosition` re-anchors it (used by the returned handle's `setPosition`).
 */
type PopupOverlay = google.maps.OverlayView & { updatePosition(position: LatLng): void };
interface PopupOverlayCtor {
  new (container: HTMLElement, position: LatLng, mapContainerEl: HTMLElement): PopupOverlay;
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

    // The viewport clamp/flip computed for the CURRENT anchor, frozen after the first draw() that
    // could actually measure the popup's content -- see `draw()`. `null` means "not yet computed
    // for this anchor" (either never measured, or just reset by `updatePosition` re-anchoring to a
    // different marker). Google calls `draw()` on every map render frame (including every frame of
    // a pan), but the anchor's lat/lng doesn't change during a pan -- only its pixel projection
    // does -- so once this is set it must NOT be recomputed until the anchor itself changes.
    // Otherwise the popup re-clamps to the viewport edge every frame instead of translating with
    // its marker (this is exactly the bug this field fixes: a popup panned far from its marker
    // used to stay permanently pinned to whichever edge it first clamped to).
    private clampOffset: { dx: number; flipBelow: boolean } | null = null;

    constructor(
      private readonly container: HTMLElement,
      private position: LatLng,
      private readonly mapContainerEl: HTMLElement,
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
      // Same reasoning as `HtmlMarkerOverlay.onAdd` above: without this, a click INSIDE the popup
      // (the carousel arrows, the close button, ...) also registers as a map click, firing
      // `onMapClick`'s background-dismiss listener and closing the popup mid-interaction.
      if (typeof google.maps.OverlayView.preventMapHitsAndGesturesFrom === 'function') {
        google.maps.OverlayView.preventMapHitsAndGesturesFrom(this.container);
      }
      // The popup's React content portals into `container` asynchronously AFTER this fires (the
      // caller just appended a still-empty node), so the very first `draw()` -- called
      // synchronously right after `onAdd` by the Maps runtime -- almost always measures a 0x0
      // container and falls back to the un-clamped placement (see `draw()`). One extra,
      // rAF-deferred `draw()` nudges a re-clamp once that content has actually painted; Google's
      // own frequent draw() cadence (zoom/pan/idle) covers everything after that.
      if (typeof requestAnimationFrame !== 'undefined') {
        requestAnimationFrame(() => this.draw());
      }
    }

    override draw(): void {
      const projection = this.getProjection();
      if (!projection) return;
      const latLng = new google.maps.LatLng(this.position.lat, this.position.lng);
      // `fromLatLngToDivPixel` is in the floatPane's own (unclamped) coordinate system -- always
      // used for the actual `left`/`top` the container is positioned at, exactly as before. This
      // is what makes the popup translate WITH its marker on every call: unlike the clamp offset
      // below, this is recomputed on every single `draw()`, including every render frame of a pan.
      const point = projection.fromLatLngToDivPixel(latLng);
      if (!point) return;

      // The clamp/flip is computed ONCE per anchor and then frozen (see `clampOffset`'s doc
      // comment) -- Google calls `draw()` on every map render frame (every frame of a pan
      // included), and the anchor's lat/lng doesn't change during a pan, only its pixel
      // projection does. Recomputing the clamp on every call would re-pin the popup to the
      // viewport edge every frame instead of letting it move with its marker.
      if (this.clampOffset === null) {
        const popupW = this.container.offsetWidth;
        const popupH = this.container.offsetHeight;
        // `fromLatLngToContainerPixel` is in viewport-relative coordinates -- the same space as
        // `mapContainerEl`'s `clientWidth`/`clientHeight` -- needed for the clamp geometry below.
        // Only requested once the popup has a real size: content not yet measured (0x0, e.g. this
        // very first draw before React has portaled/painted into `container` -- see `onAdd`'s rAF
        // nudge) makes any clamp math meaningless anyway.
        const containerPoint = popupW && popupH ? projection.fromLatLngToContainerPixel(latLng) : null;

        if (!containerPoint) {
          // Not yet measurable (or the container-pixel projection isn't available, defensive) --
          // fall back to the original, un-clamped bottom-center placement for THIS frame only,
          // and deliberately leave `clampOffset` unset so the next `draw()` (the rAF nudge in
          // `onAdd`, or the map's own next render) computes and freezes it once real content has
          // been measured -- this is still effectively "on open", just a frame later.
          this.container.style.transform = 'translate(-50%, -100%)';
          this.container.style.left = `${point.x}px`;
          this.container.style.top = `${point.y - POPUP_OFFSET_Y_PX}px`;
          return;
        }

        this.clampOffset = clampPopupPosition({
          anchorX: containerPoint.x,
          anchorY: containerPoint.y,
          popupW,
          popupH,
          mapW: this.mapContainerEl.clientWidth,
          mapH: this.mapContainerEl.clientHeight,
          offsetY: POPUP_OFFSET_Y_PX,
          pad: POPUP_VIEWPORT_PAD_PX,
        });
      }

      const { dx, flipBelow } = this.clampOffset;
      this.container.style.left = `${point.x + dx}px`;
      if (flipBelow) {
        this.container.style.top = `${point.y + POPUP_OFFSET_Y_PX}px`;
        this.container.style.transform = 'translate(-50%, 0)';
      } else {
        this.container.style.top = `${point.y - POPUP_OFFSET_Y_PX}px`;
        this.container.style.transform = 'translate(-50%, -100%)';
      }
    }

    override onRemove(): void {
      this.attached = false;
      this.container.remove();
    }

    updatePosition(position: LatLng): void {
      // Re-anchoring to a genuinely DIFFERENT marker (not just another map-driven `draw()` call
      // for the same one, e.g. during a pan) invalidates the frozen clamp -- the next `draw()`
      // must re-clamp for the new anchor rather than reusing the old marker's offset.
      if (position.lat !== this.position.lat || position.lng !== this.position.lng) {
        this.clampOffset = null;
      }
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
 * Toggles `rle-marker--selected`/`rle-marker--hovered` on a single marker container `<div>` for
 * `id` against `selectedId`/`hoveredId` -- the one shared rule used both by `updateMarkerStates`
 * (an explicit selection/hover CHANGE, applied across every currently-registered container) and by
 * `onContainerAdd` (a container freshly (re)created by a layer re-render, which must regain
 * whatever highlight is already active -- see `GoogleMapRaw.selectedMarkerId`/`hoveredMarkerId`'s
 * doc comment). Selected always wins over hovered when the same id is passed for both.
 */
function applyMarkerStateClasses(
  el: HTMLElement,
  id: EntityId,
  selectedId: EntityId | null,
  hoveredId: EntityId | null,
): void {
  el.classList.toggle('rle-marker--selected', id === selectedId);
  el.classList.toggle('rle-marker--hovered', id === hoveredId && id !== selectedId);
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
      onContainerAdd: (container) => {
        raw.markerElements.set(marker.id, container);
        // Re-apply whatever selection/hover highlight is currently active -- see
        // `raw.selectedMarkerId`/`hoveredMarkerId`'s doc comment for why this container may be a
        // brand-new replacement (from a layer re-render) that came up with no classes at all.
        applyMarkerStateClasses(container, marker.id, raw.selectedMarkerId, raw.hoveredMarkerId);
      },
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

// --- Animated fitBounds ("fly-to") camera math --------------------------
//
// Google only animates its own `fitBounds`/`panTo` for SMALL camera deltas --
// a far destination teleports (on a raster map, with a blank-tile flash). The
// animated path therefore drives the camera itself: project everything into
// zoom-0 Mercator "world" coordinates (the 256x256 world tile), interpolate
// center and zoom per animation frame with `setCenter`/`setZoom` (fractional
// zoom enabled -- works on raster and vector maps alike), and give the zoom a
// distance-scaled mid-flight DIP so long hops read as zoom out -> glide ->
// zoom in rather than a linear slide.

const WORLD_SIZE = 256;
/** Flight duration envelope (ms), matched against the reference search UX:
 *  in-view moves settle in ~0.45s, and even a cross-country hop stays under
 *  ~1.5s -- a quick zoom-out, a beat at the overview (any un-fetched tiles
 *  gray out only for that beat, which the reference map exhibits too), and a
 *  zoom-in. A slower, cinematic glide reads as lag, not travel. */
const FLY_MIN_MS = 450;
const FLY_MAX_MS = 1500;
/** Extra duration (ms) per level of mid-flight zoom-out dip. */
const FLY_MS_PER_DIP = 260;
/**
 * Beyond this pan distance (in viewports, measured at the coarser endpoint
 * zoom) the "flight" is not flown -- the camera CUTS to a zoomed-out overview
 * of the destination and animates only the zoom-in (see `fitBounds`). On a
 * raster map every animated frame invalidates the tile pipeline, so a
 * cross-country glide renders as seconds of blank gray. This mirrors the
 * reference search UX: nearby moves animate, far destinations cut-then-zoom.
 */
const FLY_MAX_VIEWPORTS = 4;
/** How many levels above the target zoom the far-hop overview cut lands (a
 *  region-scale view of the destination -- few tiles, near-instant render). */
const FLY_FAR_OVERVIEW_LEVELS = 4;
/** Duration of the far-hop zoom-in leg (overview -> target). */
const FLY_FAR_ZOOM_IN_MS = 1400;
/** Max wait for the overview's 'tilesloaded' before the zoom-in starts anyway. */
const FLY_TILE_WAIT_MAX_MS = 900;
/** Max extra zoom-out (levels) at the midpoint of the longest flights. */
const FLY_MAX_DIP = 4;

interface WorldPoint {
  x: number;
  y: number;
}

function projectMercator(lat: number, lng: number): WorldPoint {
  const siny = Math.min(Math.max(Math.sin((lat * Math.PI) / 180), -0.9999), 0.9999);
  return {
    x: WORLD_SIZE * (0.5 + lng / 360),
    y: WORLD_SIZE * (0.5 - Math.log((1 + siny) / (1 - siny)) / (4 * Math.PI)),
  };
}

function unprojectMercator(point: WorldPoint): LatLng {
  const n = Math.PI - (2 * Math.PI * point.y) / WORLD_SIZE;
  return {
    lat: (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n))),
    lng: (point.x / WORLD_SIZE - 0.5) * 360,
  };
}

/**
 * The camera (center + fractional zoom) that fits `b` in a `width`x`height`
 * container -- the animated path's equivalent of `map.fitBounds(b)`'s end
 * state. `null` for degenerate inputs (zero-area bounds or container).
 */
function cameraForBounds(b: Bounds, width: number, height: number): { center: LatLng; zoom: number } | null {
  const northEast = projectMercator(b.north, b.east);
  const southWest = projectMercator(b.south, b.west);
  const dx = Math.abs(northEast.x - southWest.x);
  const dy = Math.abs(northEast.y - southWest.y);
  if (dx === 0 || dy === 0 || width === 0 || height === 0) return null;
  return {
    center: unprojectMercator({ x: (northEast.x + southWest.x) / 2, y: (northEast.y + southWest.y) / 2 }),
    zoom: Math.min(Math.log2(width / dx), Math.log2(height / dy)),
  };
}

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/**
 * Drives the camera from `from` to `to` (world coords + fractional zoom)
 * over `duration` ms on a `requestAnimationFrame` loop, with an optional
 * mid-flight zoom-out `dip`. Returns a cancel function; on natural
 * completion it clears `raw.cancelFlight` itself.
 */
function driveCamera(
  raw: GoogleMapRaw,
  from: WorldPoint & { zoom: number },
  to: WorldPoint & { zoom: number },
  duration: number,
  dip: number,
): () => void {
  const start = performance.now();
  let frame: number;
  const step = (): void => {
    const t = Math.min(1, (performance.now() - start) / duration);
    const eased = easeInOutCubic(t);
    raw.map.setZoom(from.zoom + (to.zoom - from.zoom) * eased - dip * Math.sin(Math.PI * eased));
    raw.map.setCenter(
      unprojectMercator({ x: from.x + (to.x - from.x) * eased, y: from.y + (to.y - from.y) * eased }),
    );
    if (t < 1) {
      frame = requestAnimationFrame(step);
    } else {
      raw.cancelFlight = null;
    }
  };
  frame = requestAnimationFrame(step);
  return () => cancelAnimationFrame(frame);
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
        containerEl: el,
        fullscreenEl: opts.fullscreenTarget ?? el,
        markerLib,
        markerMode: useOverlayMode ? 'overlay' : 'advanced',
        layers: new Map(),
        clusterers: new Map(),
        boundsListeners: new Set(),
        clickListeners: new Set(),
        resizeObserver,
        markerElements: new Map(),
        layerMarkerIds: new Map(),
        selectedMarkerId: null,
        hoveredMarkerId: null,
        cancelFlight: null,
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
      raw.clickListeners.add(listener);

      let disposed = false;
      return () => {
        if (disposed) return;
        disposed = true;
        listener.remove();
        raw.clickListeners.delete(listener);
      };
    },

    fitBounds(handle: MapHandle, b: Bounds, options?: FitBoundsOptions): void {
      // `Bounds` ({ west, south, east, north }) is structurally identical to
      // `google.maps.LatLngBoundsLiteral`, so it is passed straight through -- no need to
      // construct a `LatLngBounds` instance (which would pull in the 'core' library).
      const raw = toRaw(handle);
      // Any new fit request supersedes an in-flight fly -- cancel whatever
      // phase it is in (camera drive, or a far-hop tile wait) so a stale
      // flight can't keep dragging the camera afterward.
      raw.cancelFlight?.();
      raw.cancelFlight = null;

      if (!options?.animate) {
        raw.map.fitBounds(b);
        return;
      }

      // Fly-to (see the camera-math block above `projectMercator`). Falls back
      // to the direct fit whenever the flight can't be computed: no current
      // camera yet, or a zero-size/degenerate container or bounds.
      const currentZoom = raw.map.getZoom();
      const currentCenter = raw.map.getCenter();
      const target = cameraForBounds(b, raw.containerEl.clientWidth, raw.containerEl.clientHeight);
      if (currentZoom == null || !currentCenter || !target) {
        raw.map.fitBounds(b);
        return;
      }

      // Fractional zoom keeps the per-frame `setZoom` continuous (defaults
      // off on raster maps, where integer snapping would turn the flight into
      // a stutter). Idempotent, and deliberately left ON afterwards.
      raw.map.setOptions({ isFractionalZoomEnabled: true });

      const from = { ...projectMercator(currentCenter.lat(), currentCenter.lng()), zoom: currentZoom };
      const toWorld = projectMercator(target.center.lat, target.center.lng);
      const to = { ...toWorld, zoom: target.zoom };
      // Pan distance in SCREEN pixels at the coarser of the two zooms decides
      // the flight SHAPE: nearby targets are flown with a small zoom-out dip;
      // far targets are not flown at all (see below).
      const screenDistance =
        Math.hypot(to.x - from.x, to.y - from.y) * 2 ** Math.min(from.zoom, to.zoom);
      const viewport = Math.max(raw.containerEl.clientWidth, raw.containerEl.clientHeight);

      if (screenDistance > viewport * FLY_MAX_VIEWPORTS) {
        // Far hop, the reference search UX's sequence: CUT straight to a
        // zoomed-out overview of the DESTINATION region (low-zoom tiles cover
        // the screen with few requests, so it renders almost immediately),
        // let the tiles land ('tilesloaded', with a timeout fallback), then
        // animate only the zoom-in. Gliding the camera across the distance
        // instead invalidates the raster tile pipeline on every frame and
        // shows seconds of blank gray -- the pan happens invisibly here,
        // inside the cut.
        raw.map.setCenter(target.center);
        raw.map.setZoom(target.zoom - FLY_FAR_OVERVIEW_LEVELS);
        const begin = (): void => {
          cancelWait();
          // Read the zoom back rather than assuming: the map clamps to its
          // configured minZoom, and the drive must start from the REAL camera.
          const overviewZoom = raw.map.getZoom() ?? target.zoom - FLY_FAR_OVERVIEW_LEVELS;
          raw.cancelFlight = driveCamera(raw, { ...toWorld, zoom: overviewZoom }, to, FLY_FAR_ZOOM_IN_MS, 0);
        };
        const listener = raw.map.addListener('tilesloaded', begin);
        const timer = setTimeout(begin, FLY_TILE_WAIT_MAX_MS);
        const cancelWait = (): void => {
          listener.remove();
          clearTimeout(timer);
        };
        raw.cancelFlight = cancelWait;
        return;
      }

      const dip =
        screenDistance > viewport ? Math.min(FLY_MAX_DIP, Math.log2(screenDistance / viewport) + 1) : 0;
      const duration = Math.min(FLY_MAX_MS, FLY_MIN_MS + dip * FLY_MS_PER_DIP);
      raw.cancelFlight = driveCamera(raw, from, to, duration, dip);
    },

    destroy(handle: MapHandle): void {
      const raw = toRaw(handle);
      raw.resizeObserver?.disconnect();
      raw.cancelFlight?.();
      raw.cancelFlight = null;
      for (const listener of raw.boundsListeners) listener.remove();
      raw.boundsListeners.clear();
      // Backstop for a caller (e.g. `ListingMap`'s popup-overlay effect) that unsubscribes an
      // `onMapClick` listener AFTER this `destroy()` -- see `GoogleMapRaw.clickListeners`'s doc
      // comment. Force-remove every listener still registered here so none leaks.
      for (const listener of raw.clickListeners) listener.remove();
      raw.clickListeners.clear();
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
      // Persisted so a marker container recreated LATER by a layer re-render (unrelated to
      // selection/hover -- e.g. a bounds/idle-driven points reload) can regain the correct
      // highlight the instant it registers, without waiting for the next call here -- see
      // `GoogleMapRaw.selectedMarkerId`/`hoveredMarkerId`'s doc comment and `onContainerAdd` in
      // `createOverlayMarkers`.
      currentRaw.selectedMarkerId = selectedId;
      currentRaw.hoveredMarkerId = hoveredId;
      // `markerElements` is populated ONLY by `createOverlayMarkers` (overlay/`styles` mode), so
      // this loop is naturally empty -- a no-op -- in advanced-marker mode (`AdvancedMarkerElement`,
      // used only when a Map ID is set): that mode has no addressable container element to toggle
      // classes on, and is out of the perks path this task targets.
      for (const [id, el] of currentRaw.markerElements) {
        applyMarkerStateClasses(el, id, selectedId, hoveredId);
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
      const overlay = new PopupOverlayView(container, position, currentRaw.containerEl);
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

    zoomIn(): void {
      // No currently-mounted map -- nothing to zoom (mirrors `updateMarkerStates`).
      if (!currentRaw) return;
      currentRaw.map.setZoom((currentRaw.map.getZoom() ?? 0) + 1);
    },

    zoomOut(): void {
      if (!currentRaw) return;
      currentRaw.map.setZoom((currentRaw.map.getZoom() ?? 0) - 1);
    },

    toggleFullscreen(): void {
      if (!currentRaw) return;
      const el = currentRaw.fullscreenEl;
      // Feature-detected throughout -- older Safari and non-browser/test DOM
      // environments don't implement the Fullscreen API at all, and this must
      // never throw in that case (see this method's doc comment).
      const fullscreenElement = document.fullscreenElement;
      // `Node.contains(other)` is true when `other === el` too (a node contains itself), so
      // there is no need for a separate `fullscreenElement === el` check alongside it.
      const isThisElementFullscreen = fullscreenElement != null && el.contains(fullscreenElement);

      if (isThisElementFullscreen) {
        // `?.catch` (rather than an unconditional `.catch`) tolerates a `document.exitFullscreen`
        // stub that doesn't return a promise (e.g. a bare `vi.fn()` in a test) as well as a real
        // rejection (permissions/no-gesture) -- either way this must never throw or surface an
        // unhandled rejection.
        if (typeof document.exitFullscreen === 'function') void document.exitFullscreen()?.catch(() => {});
      } else if (typeof el.requestFullscreen === 'function') {
        void el.requestFullscreen()?.catch(() => {});
      }
    },
  };
}
