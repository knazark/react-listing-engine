import type { Bounds, EntityId, LatLng } from './entity-adapter.interface';

/**
 * Providers that need an API key take it via their factory (e.g. `googleProvider({ apiKey })`),
 * not per-mount.
 */
export interface MapInitOptions {
  apiKey?: string;
  center?: LatLng;
  zoom?: number;
  /**
   * Element the Fullscreen API should target on `toggleFullscreen()`, instead of the `el`
   * passed to `mount`. Additive/optional -- providers resolve `fullscreenTarget ?? el`, so
   * existing callers that never supply it are unaffected.
   *
   * Needed because a consumer overlay rendered as a SIBLING of `el` (e.g. `ListingMap`'s
   * `mapControls`, deliberately never a child -- a real map SDK owns `el`'s contents) would
   * otherwise vanish the instant `el` alone is fullscreened: the Fullscreen API only shows the
   * target element and its descendants, never its siblings. Pass an outer wrapper that contains
   * BOTH `el` and the sibling overlay to keep the overlay visible in fullscreen.
   */
  fullscreenTarget?: HTMLElement;
}
export interface MapHandle { readonly raw: unknown; }
export interface RenderedLayer {
  id: string;
  markers: Array<{ id: string | number; position: LatLng; iconUrl?: string; element?: HTMLElement }>;
  clustering?: { maxZoom?: number } | false;
  onMarkerClick?(id: string | number): void;
}
export type Unsubscribe = () => void;
/**
 * Handle to an imperatively-mounted, lat/lng-anchored DOM overlay (see
 * `MapProvider.mountOverlay`). `container` is a stable element the provider
 * created and owns positioning of -- callers portal their own content (e.g. the
 * injected `Popup` slot) into it. `setPosition` re-anchors it at a new
 * coordinate; `unmount` detaches it from the map and the DOM.
 */
export interface MapOverlayHandle {
  readonly container: HTMLElement;
  setPosition(position: LatLng): void;
  unmount(): void;
}
export interface MapProvider {
  mount(el: HTMLElement, opts: MapInitOptions): Promise<MapHandle> | MapHandle;
  renderLayer(handle: MapHandle, layer: RenderedLayer): Unsubscribe;
  onBoundsChange(handle: MapHandle, cb: (b: Bounds) => void): Unsubscribe;
  /**
   * Subscribes to clicks on the map BACKGROUND (not on a marker) and returns an
   * unsubscribe. Used to dismiss an open on-map `Popup` overlay on a
   * tap/click-away -- the touch-friendly counterpart to `Esc`. HTML overlay
   * markers live in the map's `overlayMouseTarget` pane, so a marker click does
   * NOT surface here -- only genuine background clicks do, which is exactly what
   * dismissal wants. No `MapHandle` parameter: like `updateMarkerStates` and
   * `mountOverlay`, a provider instance operates on its own currently-mounted map.
   */
  onMapClick(cb: () => void): Unsubscribe;
  fitBounds(handle: MapHandle, b: Bounds): void;
  destroy(handle: MapHandle): void;
  /**
   * Repaints the SELECTED/HOVERED marker's existing DOM without recreating any marker -- toggles
   * `rle-marker--selected`/`rle-marker--hovered` on each rendered marker's container node
   * (`id === selectedId` / `id === hoveredId && id !== selectedId`, so selected wins when an id is
   * both). No `MapHandle` parameter: a provider instance tracks its own currently-mounted map, the
   * same way `ListingMap` holds a single `handleRef` per provider. Implementations that render
   * markers as plain host-SDK objects with no addressable container element (e.g. this library's
   * own advanced-marker/`AdvancedMarkerElement` mode) MAY no-op.
   */
  updateMarkerStates(selectedId: EntityId | null, hoveredId: EntityId | null): void;
  /**
   * Mounts an absolutely-positioned DOM `container` anchored at `position` on
   * the map (above any markers) and returns a `MapOverlayHandle` to
   * reposition/unmount it. The `container` is created and returned
   * SYNCHRONOUSLY so it is a stable React portal target, even though a real map
   * SDK attaches it to a map pane and positions it ASYNCHRONOUSLY on its next
   * render cycle (never synchronously inside the mount call) -- see the Google
   * provider's implementation. No `MapHandle` parameter: like
   * `updateMarkerStates`, a provider instance operates on its own
   * currently-mounted map. Used to render the injected `Popup` slot as an
   * on-map overlay when a point is selected.
   */
  mountOverlay(position: LatLng): MapOverlayHandle;
  /**
   * Increments the currently-mounted map's zoom level by 1. No `MapHandle` parameter: like
   * `updateMarkerStates`/`mountOverlay`/`onMapClick`, a provider instance operates on its own
   * currently-mounted map. No-op (never throws) when no map is currently mounted.
   */
  zoomIn(): void;
  /** Decrements the currently-mounted map's zoom level by 1. See `zoomIn`'s doc comment. */
  zoomOut(): void;
  /**
   * Toggles the browser Fullscreen API on the map's fullscreen target -- `opts.fullscreenTarget`
   * from `mount`, falling back to the mount `el` itself when omitted (see
   * `MapInitOptions.fullscreenTarget`'s doc comment for why a caller would supply a different
   * element): enters fullscreen on that target if it (or a descendant) is not already the
   * document's fullscreen element, else exits fullscreen. No `MapHandle` parameter, same
   * rationale as `zoomIn`/`zoomOut`. Guarded against environments without the Fullscreen API
   * (e.g. older Safari, or a test DOM that doesn't implement it) -- never throws, simply no-ops
   * when the relevant methods aren't present. No-op when no map is currently mounted.
   */
  toggleFullscreen(): void;
}
