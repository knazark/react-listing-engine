import { importLibrary, setOptions, type APIOptions } from '@googlemaps/js-api-loader';
import type { Bounds, LatLng, MapHandle, MapInitOptions, MapProvider, RenderedLayer, Unsubscribe } from '~/interfaces';

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
  layers: Map<string, AdvancedMarker[]>;
  /** One active `MarkerClusterer` per clustered layer id -- see `setupClustering`/`disposeClusterer`. */
  clusterers: Map<string, MarkerClustererInstance>;
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

function removeMarkers(markers: AdvancedMarker[]): void {
  for (const marker of markers) {
    marker.map = null;
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

  return {
    async mount(el: HTMLElement, opts: MapInitOptions): Promise<MapHandle> {
      ensureOptionsConfigured();
      const mapsLib = await importLibrary('maps');
      const markerLib = await importLibrary('marker');
      const center = opts.center ?? { lat: 0, lng: 0 };
      const map = new mapsLib.Map(el, {
        center,
        zoom: opts.zoom ?? 10,
        mapId: config.mapId ?? DEFAULT_MAP_ID,
      });
      const resizeObserver = observeContainerResize(el, map, center);
      const raw: GoogleMapRaw = {
        map,
        markerLib,
        layers: new Map(),
        clusterers: new Map(),
        boundsListeners: new Set(),
        resizeObserver,
      };
      return { raw };
    },

    renderLayer(handle: MapHandle, layer: RenderedLayer): Unsubscribe {
      const raw = toRaw(handle);

      const previous = raw.layers.get(layer.id);
      if (previous) {
        removeMarkers(previous);
        raw.layers.delete(layer.id);
      }
      // A re-render for the same `layer.id` always replaces its clusterer too (not just its
      // markers) -- see `setupClustering`'s doc comment for why this synchronous dispose, run
      // before `created`/`setupClustering` below, is what keeps a stale clusterer from a
      // still-in-flight PREVIOUS call from ever out-living this one.
      disposeClusterer(raw, layer.id);

      const created: AdvancedMarker[] = layer.markers.map((marker) => {
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
      raw.layers.set(layer.id, created);

      if (layer.clustering) {
        // Fire-and-forget: `setupClustering` is the only async step in this otherwise
        // synchronous render path (see its doc comment for the staleness guard this implies).
        void setupClustering(raw, layer.id, created, layer.clustering);
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
    },
  };
}
