import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Bounds, MapInitOptions, RenderedLayer } from '~/interfaces';
import { googleProvider, clampPopupPosition } from '../google-maps.provider';

// --- Fake Google Maps JS API surface -----------------------------------
//
// `@googlemaps/js-api-loader` v2 dropped the class-based `new Loader(...)` API
// (see MIGRATION.md in that package) in favor of module-level `setOptions()` +
// `importLibrary()` functions — that's the real, installed shape this project
// depends on, so we mock *that* surface rather than a `Loader` class that no
// longer exists at runtime. `setOptions`/`importLibrary` are `vi.fn()`s;
// `importLibrary` resolves fake `maps`/`marker` library objects built below.

interface FakeListener {
  remove: ReturnType<typeof vi.fn>;
}

// Advanced mode sets `mapId`; `styles` (OverlayView) mode sets `styles` and NO `mapId` -- both are
// optional here so one type covers a Map constructed in either mode.
interface FakeMapOptions {
  center: unknown;
  zoom: unknown;
  mapId?: unknown;
  styles?: unknown;
}

class FakeMap {
  center: unknown;
  zoom: unknown;
  mapId: unknown;
  styles: unknown;
  private readonly listeners: Record<string, Array<() => void>> = {};
  bounds: { getSouthWest(): { lat(): number; lng(): number }; getNorthEast(): { lat(): number; lng(): number } } | undefined;

  constructor(
    public el: HTMLElement,
    opts: FakeMapOptions,
  ) {
    this.center = opts.center;
    this.zoom = opts.zoom;
    this.mapId = opts.mapId;
    this.styles = opts.styles;
  }

  addListener(event: string, handler: () => void): FakeListener {
    (this.listeners[event] ??= []).push(handler);
    return {
      remove: vi.fn(() => {
        this.listeners[event] = (this.listeners[event] ?? []).filter((h) => h !== handler);
      }),
    };
  }

  getBounds() {
    return this.bounds;
  }

  fitBounds(b: Bounds): void {
    fitBoundsCalls.push(b);
  }

  // Recorded so the container-resize-hardening tests can assert the map is recentered exactly
  // once, on the first real container size the fake `ResizeObserver` below reports.
  setCenter(center: unknown): void {
    this.center = center;
    setCenterCalls.push(center);
  }

  getZoom(): number | undefined {
    return this.zoom as number | undefined;
  }

  setZoom(zoom: number): void {
    this.zoom = zoom;
  }

  trigger(event: string): void {
    for (const handler of this.listeners[event] ?? []) handler();
  }
}

// --- Fake `ResizeObserver` + `google.maps.event.trigger` ---------------
//
// `google-maps.provider.ts`'s `observeContainerResize` attaches a real
// `ResizeObserver` to the container and, on a real (non-zero) size, calls the
// ambient global `google.maps.event.trigger(map, 'resize')` then (once)
// `map.setCenter(...)`. Neither exists by default in `happy-dom` (this
// project's vitest environment) / at all in this Node test process (nothing
// here ever loads the real `google.maps` bootstrap script), so both are
// stubbed via `vi.stubGlobal` per test and restored via `vi.unstubAllGlobals()`.
// `requestAnimationFrame` is ALSO stubbed to an inert `vi.fn()` so the
// provider's one-time initial probe (see that function's doc comment) never
// actually fires on a real timer mid-test -- every test below drives the
// resize callback deterministically via `FakeResizeObserver`'s own `trigger()`
// instead.

interface FakeResizeObserverInstance {
  el: HTMLElement;
  disconnect: ReturnType<typeof vi.fn>;
  trigger(): void;
}

let resizeObserverInstances: FakeResizeObserverInstance[] = [];
let setCenterCalls: unknown[] = [];
const eventTriggerMock = vi.fn();

class FakeResizeObserver {
  private readonly disconnectMock = vi.fn();

  constructor(private readonly callback: () => void) {}

  observe(el: HTMLElement): void {
    resizeObserverInstances.push({ el, disconnect: this.disconnectMock, trigger: () => this.callback() });
  }

  disconnect(): void {
    this.disconnectMock();
  }
}

class FakeAdvancedMarkerElement {
  map: FakeMap | null;
  position: unknown;
  content: HTMLElement | undefined;
  private readonly listeners: Record<string, Array<() => void>> = {};

  constructor(opts: { map: FakeMap; position: unknown; content?: HTMLElement }) {
    this.map = opts.map;
    this.position = opts.position;
    this.content = opts.content;
    createdMarkers.push(this);
  }

  addListener(event: string, handler: () => void): FakeListener {
    (this.listeners[event] ??= []).push(handler);
    return {
      remove: vi.fn(() => {
        this.listeners[event] = (this.listeners[event] ?? []).filter((h) => h !== handler);
      }),
    };
  }

  trigger(event: string): void {
    for (const handler of this.listeners[event] ?? []) handler();
  }
}

// Models the real `google.maps.marker.PinElement`: the INSTANCE is not a DOM
// node -- the HTMLElement lives on its `.element` getter. (The `@types` wrongly
// say `PinElement extends HTMLElement`; the runtime does not.)
class FakePinElement {
  readonly element: HTMLElement;
  constructor(opts?: { glyphSrc?: string | URL | null }) {
    this.element = document.createElement('div');
    this.element.dataset.glyphSrc = String(opts?.glyphSrc ?? '');
  }
}

// --- Fake `google.maps.OverlayView` + `google.maps.LatLng` ---------------
//
// `styles` (no-`mapId`) mode makes the provider lazily define an `OverlayView` subclass (its
// `HtmlMarkerOverlay`, via `getHtmlMarkerCtor`) that renders each marker as an absolutely
// positioned HTML div and is added/removed through the inherited `setMap`. Neither
// `google.maps.OverlayView` nor `google.maps.LatLng` exists in this Node test process, so both are
// stubbed onto the `google` global (see `beforeEach`). This base fake records every instance and,
// on `setMap`, drives the subclass's own `onAdd`/`draw`/`onRemove` (exactly as the real Maps
// runtime does when a map is set/unset) so the overlay's DOM building is genuinely exercised.
//
// NOTE: the provider caches its `HtmlMarkerOverlay` ctor module-wide on first use, freezing this
// exact `FakeOverlayView` as the base class -- which is fine because every test stubs the SAME
// class reference here.

let createdOverlays: FakeOverlayView[] = [];
// Backs `FakeOverlayView.getProjection().fromLatLngToContainerPixel` -- see that method's doc
// comment. Reset to the default in `beforeEach`.
let containerPixelPoint: { x: number; y: number } | null = { x: 5, y: 7 };
// Flips `FakeOverlayView#setMap` from synchronously invoking `onAdd()`/`draw()` (the default,
// used by every other test in this file) to deferring them to a microtask -- matching the REAL
// `google.maps.OverlayView`, whose `onAdd()` fires asynchronously on the next map render cycle,
// never synchronously inside `setMap()`. Used by exactly one regression test below (container
// index must populate FROM `onAdd`, not from a synchronous read right after `setMap()`); reset in
// `beforeEach` like `simulateMarkerClustererImportFailure`.
let deferOverlayOnAdd = false;

class FakeOverlayView {
  // Static (mirrors the real `google.maps.OverlayView.preventMapHitsAndGesturesFrom`, which is a
  // static method on the OverlayView class/namespace, not an instance method) -- see the
  // `preventMapHitsAndGesturesFrom` regression tests below. Cleared (not reset -- tests need the
  // real fn back after the one test that deletes it) in `beforeEach`.
  static preventMapHitsAndGesturesFrom = vi.fn();

  // The pane the overlay's DOM is mounted into. Kept per-instance (not `document`) so tests can
  // query an overlay's own content without cross-test DOM bleed.
  readonly pane = document.createElement('div');

  readonly setMap = vi.fn((map: unknown) => {
    // The real OverlayView triggers onAdd()+draw() when added to a map, and onRemove() when
    // removed (setMap(null)). The subclass defines these on its prototype, so `this.onAdd` etc.
    // resolve to the subclass overrides.
    if (map) {
      const fire = () => {
        (this as unknown as { onAdd(): void }).onAdd();
        (this as unknown as { draw(): void }).draw();
      };
      if (deferOverlayOnAdd) {
        queueMicrotask(fire);
      } else {
        fire();
      }
    } else {
      (this as unknown as { onRemove(): void }).onRemove();
    }
  });

  constructor() {
    createdOverlays.push(this);
  }

  getPanes() {
    // `overlayMouseTarget` backs HtmlMarkerOverlay markers; `floatPane` backs the
    // PopupOverlayView (see `mountOverlay`). Same per-instance node -- a given
    // overlay instance is only ever one kind, so they never collide.
    return { overlayMouseTarget: this.pane, floatPane: this.pane };
  }

  getProjection() {
    return {
      fromLatLngToDivPixel: () => ({ x: 5, y: 7 }),
      // Viewport-relative pixel coords used by `draw()`'s clamp geometry (see
      // `clampPopupPosition`) -- controllable per test via the mutable `containerPixelPoint`
      // below, independent of the fixed `fromLatLngToDivPixel` value above (real Maps JS
      // projections return different numbers from each, since they're different coordinate
      // systems). Reset to a default in `beforeEach`; a test sets `null` to exercise the
      // defensive fallback when this projection isn't available.
      fromLatLngToContainerPixel: () => containerPixelPoint,
    };
  }
}

class FakeLatLng {
  constructor(
    public readonly lat: number,
    public readonly lng: number,
  ) {}
}

let fitBoundsCalls: Bounds[] = [];
let createdMarkers: FakeAdvancedMarkerElement[] = [];
let mapConstructorCalls: Array<{ el: HTMLElement; opts: FakeMapOptions }> = [];

const setOptionsMock = vi.fn();
// Extracted to a named const (rather than inlined straight into `vi.fn(...)`) so the
// currentRaw-race regression test below can restore this exact base behavior after overriding a
// specific call with `mockImplementationOnce` -- see that test's comment.
async function resolveLibrary(name: string) {
  if (name === 'maps') {
    return {
      Map: class extends FakeMap {
        constructor(el: HTMLElement, opts: FakeMapOptions) {
          super(el, opts);
          mapConstructorCalls.push({ el, opts });
        }
      },
    };
  }
  if (name === 'marker') {
    return { AdvancedMarkerElement: FakeAdvancedMarkerElement, PinElement: FakePinElement };
  }
  throw new Error(`unexpected library: ${name}`);
}
const importLibraryMock = vi.fn(resolveLibrary);

vi.mock('@googlemaps/js-api-loader', () => ({
  setOptions: (...args: unknown[]) => setOptionsMock(...args),
  importLibrary: (...args: [string]) => importLibraryMock(...args),
}));

// --- Fake `@googlemaps/markerclusterer` ---------------------------------
//
// `google-maps.provider.ts`'s `setupClustering` loads this via a dynamic
// `import('@googlemaps/markerclusterer')` (it's an OPTIONAL peer dependency,
// never eagerly imported) -- `vi.mock` intercepts dynamic imports of a
// specifier the same way it intercepts static ones, so this fake is used
// regardless of import style. Records every constructed instance (and its
// options) so tests can assert on what the provider passed in, and exposes
// a `setMap` spy so teardown (`disposeClusterer`) is directly observable.

interface FakeMarkerClustererOptions {
  map: unknown;
  markers: unknown[];
  algorithmOptions?: { maxZoom?: number };
  renderer: { render: (...args: unknown[]) => unknown };
}

let createdClusterers: FakeMarkerClusterer[] = [];
// Flips the mock's dynamic import to reject (simulating the optional dependency not being
// installed) for exactly the one test that exercises that path -- see that test's comment for
// why it runs first and doesn't need `vi.resetModules()`.
let simulateMarkerClustererImportFailure = false;

class FakeMarkerClusterer {
  readonly setMap = vi.fn();

  constructor(public readonly options: FakeMarkerClustererOptions) {
    createdClusterers.push(this);
  }
}

vi.mock('@googlemaps/markerclusterer', () => {
  if (simulateMarkerClustererImportFailure) {
    throw new Error('Cannot find module "@googlemaps/markerclusterer" (simulated -- not installed)');
  }
  return { MarkerClusterer: FakeMarkerClusterer };
});

function makeLayer(overrides: Partial<RenderedLayer> = {}): RenderedLayer {
  return {
    id: 'properties',
    markers: [{ id: 1, position: { lat: 40.7, lng: -74 } }],
    ...overrides,
  };
}

describe('googleProvider', () => {
  beforeEach(() => {
    setOptionsMock.mockClear();
    // `mockReset()` (not just `mockClear()`) so a queued `mockImplementationOnce` left behind by
    // an earlier failing/aborted test (see the currentRaw-race regression test below) never
    // leaks into a later one; re-applies the base implementation right after.
    importLibraryMock.mockReset();
    importLibraryMock.mockImplementation(resolveLibrary);
    eventTriggerMock.mockClear();
    fitBoundsCalls = [];
    createdMarkers = [];
    mapConstructorCalls = [];
    resizeObserverInstances = [];
    setCenterCalls = [];
    createdClusterers = [];
    createdOverlays = [];
    deferOverlayOnAdd = false;
    containerPixelPoint = { x: 5, y: 7 };
    // Restore the real fn in case the previous test deleted it (the
    // `preventMapHitsAndGesturesFrom`-unavailable guard test below) and clear call history from
    // every other test.
    FakeOverlayView.preventMapHitsAndGesturesFrom = vi.fn();

    vi.stubGlobal('ResizeObserver', FakeResizeObserver);
    vi.stubGlobal('requestAnimationFrame', vi.fn());
    // `OverlayView`/`LatLng` are added for `styles`-mode tests; harmless to advanced-mode tests,
    // which never touch them.
    vi.stubGlobal('google', {
      maps: { event: { trigger: eventTriggerMock }, OverlayView: FakeOverlayView, LatLng: FakeLatLng },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('throws immediately when apiKey is falsy, and never falls back to a hardcoded key', () => {
    expect(() => googleProvider({ apiKey: '' })).toThrow();
    // @ts-expect-error -- exercising the missing-apiKey runtime guard
    expect(() => googleProvider({})).toThrow();
    expect(setOptionsMock).not.toHaveBeenCalled();
  });

  it('constructs the loader with the passed apiKey and never a hardcoded one', async () => {
    const provider = googleProvider({ apiKey: 'my-real-key' });
    await provider.mount(document.createElement('div'), { zoom: 10 } as MapInitOptions);

    expect(setOptionsMock).toHaveBeenCalledTimes(1);
    const [options] = setOptionsMock.mock.calls[0] as [{ key?: string }];
    expect(options.key).toBe('my-real-key');
    expect(options.key).not.toBe('AIzaHardcodedFallback');
  });

  it('mount creates a Map with the passed center/zoom/mapId', async () => {
    const provider = googleProvider({ apiKey: 'k', mapId: 'my-map-id' });
    const el = document.createElement('div');

    await provider.mount(el, { center: { lat: 1, lng: 2 }, zoom: 14 });

    expect(mapConstructorCalls).toHaveLength(1);
    expect(mapConstructorCalls[0].el).toBe(el);
    expect(mapConstructorCalls[0].opts).toEqual({ center: { lat: 1, lng: 2 }, zoom: 14, mapId: 'my-map-id' });
  });

  it('mount defaults mapId to Google\'s "DEMO_MAP_ID" when config.mapId is not supplied, so AdvancedMarkerElement renders out of the box', async () => {
    const provider = googleProvider({ apiKey: 'k' });

    await provider.mount(document.createElement('div'), {});

    expect(mapConstructorCalls).toHaveLength(1);
    expect(mapConstructorCalls[0].opts.mapId).toBe('DEMO_MAP_ID');
  });

  it('mount merges config.mapOptions into the Map, but center/zoom/mapId still win over it', async () => {
    const provider = googleProvider({
      apiKey: 'k',
      mapId: 'real-map-id',
      // `mapId`/`center`/`zoom` here must be overridden by the required keys below.
      mapOptions: { minZoom: 2.5, maxZoom: 17, disableDefaultUI: true, mapId: 'ignored', center: { lat: 9, lng: 9 }, zoom: 99 },
    });

    await provider.mount(document.createElement('div'), { center: { lat: 1, lng: 2 }, zoom: 14 });

    const opts = mapConstructorCalls[0].opts as unknown as Record<string, unknown>;
    // Pass-through options are applied...
    expect(opts.minZoom).toBe(2.5);
    expect(opts.maxZoom).toBe(17);
    expect(opts.disableDefaultUI).toBe(true);
    // ...but never at the expense of the provider's own required keys: `center`/`zoom` come
    // from the per-mount MapInitOptions and `mapId` from the config field, so the same keys
    // in mapOptions are ignored.
    expect(opts.mapId).toBe('real-map-id');
    expect(opts.center).toEqual({ lat: 1, lng: 2 });
    expect(opts.zoom).toBe(14);
  });

  it('renderLayer creates one marker per layer.markers entry', async () => {
    const provider = googleProvider({ apiKey: 'k' });
    const handle = await provider.mount(document.createElement('div'), {});
    const layer = makeLayer({
      markers: [
        { id: 1, position: { lat: 1, lng: 1 } },
        { id: 2, position: { lat: 2, lng: 2 } },
      ],
    });

    provider.renderLayer(handle, layer);

    expect(createdMarkers).toHaveLength(2);
    expect(createdMarkers[0].position).toEqual({ lat: 1, lng: 1 });
    expect(createdMarkers[1].position).toEqual({ lat: 2, lng: 2 });
  });

  it('renders an iconUrl marker as the PinElement.element (a real HTMLElement), not the PinElement instance', async () => {
    const provider = googleProvider({ apiKey: 'k' });
    const handle = await provider.mount(document.createElement('div'), {});
    const layer = makeLayer({
      markers: [{ id: 'biz', position: { lat: 1, lng: 1 }, iconUrl: 'https://example.test/icon.png' }],
    });

    provider.renderLayer(handle, layer);

    // Regression: `resolveMarkerContent` used to return the PinElement INSTANCE,
    // which is not a DOM node at runtime -- Google's marker mount then called
    // `IntersectionObserver.observe()` on a non-Element and threw, crashing any
    // iconUrl-driven layer (e.g. nearby businesses). Content must be the
    // PinElement's `.element`.
    const content = createdMarkers[0].content;
    expect(content).toBeInstanceOf(HTMLElement);
    expect(content).not.toBeInstanceOf(FakePinElement);
    expect((content as HTMLElement).dataset.glyphSrc).toBe('https://example.test/icon.png');
  });

  it('re-calling renderLayer for the same layer.id replaces markers instead of duplicating them', async () => {
    const provider = googleProvider({ apiKey: 'k' });
    const handle = await provider.mount(document.createElement('div'), {});
    const layerV1 = makeLayer({ markers: [{ id: 1, position: { lat: 1, lng: 1 } }] });
    const layerV2 = makeLayer({
      markers: [
        { id: 2, position: { lat: 2, lng: 2 } },
        { id: 3, position: { lat: 3, lng: 3 } },
      ],
    });

    provider.renderLayer(handle, layerV1);
    const firstMarker = createdMarkers[0];
    provider.renderLayer(handle, layerV2);

    // the old marker for this layer id was torn down (removed from the map), not left dangling
    expect(firstMarker.map).toBeNull();
    // exactly the new layer's markers are live on the map now
    const liveMarkers = createdMarkers.filter((m) => m.map !== null);
    expect(liveMarkers).toHaveLength(2);
    expect(liveMarkers.map((m) => m.position)).toEqual([
      { lat: 2, lng: 2 },
      { lat: 3, lng: 3 },
    ]);
  });

  it('renderLayer unsubscribe removes exactly that layer\'s markers', async () => {
    const provider = googleProvider({ apiKey: 'k' });
    const handle = await provider.mount(document.createElement('div'), {});
    const layerA = makeLayer({ id: 'a', markers: [{ id: 1, position: { lat: 1, lng: 1 } }] });
    const layerB = makeLayer({ id: 'b', markers: [{ id: 2, position: { lat: 2, lng: 2 } }] });

    const unsubscribeA = provider.renderLayer(handle, layerA);
    provider.renderLayer(handle, layerB);
    unsubscribeA();

    const liveMarkers = createdMarkers.filter((m) => m.map !== null);
    expect(liveMarkers).toHaveLength(1);
    expect(liveMarkers[0].position).toEqual({ lat: 2, lng: 2 });
  });

  it('fires layer.onMarkerClick with the marker id when a marker is clicked', async () => {
    const provider = googleProvider({ apiKey: 'k' });
    const handle = await provider.mount(document.createElement('div'), {});
    const onMarkerClick = vi.fn();
    const layer = makeLayer({
      markers: [
        { id: 'marker-a', position: { lat: 1, lng: 1 } },
        { id: 'marker-b', position: { lat: 2, lng: 2 } },
      ],
      onMarkerClick,
    });

    provider.renderLayer(handle, layer);
    createdMarkers[1].trigger('click');

    expect(onMarkerClick).toHaveBeenCalledTimes(1);
    expect(onMarkerClick).toHaveBeenCalledWith('marker-b');
  });

  it('onBoundsChange maps a Google LatLngBounds to our Bounds on idle, and unsubscribe removes the listener', async () => {
    const provider = googleProvider({ apiKey: 'k' });
    const handle = await provider.mount(document.createElement('div'), {});
    const raw = handle.raw as { map: FakeMap };
    raw.map.bounds = {
      getSouthWest: () => ({ lat: () => -10, lng: () => -20 }),
      getNorthEast: () => ({ lat: () => 30, lng: () => 40 }),
    };
    const cb = vi.fn();

    const unsubscribe = provider.onBoundsChange(handle, cb);
    raw.map.trigger('idle');

    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb).toHaveBeenCalledWith({ west: -20, south: -10, east: 40, north: 30 });

    unsubscribe();
    raw.map.trigger('idle');

    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('fitBounds forwards our Bounds straight through to map.fitBounds', async () => {
    const provider = googleProvider({ apiKey: 'k' });
    const handle = await provider.mount(document.createElement('div'), {});
    const bounds: Bounds = { west: -1, south: -2, east: 3, north: 4 };

    provider.fitBounds(handle, bounds);

    expect(fitBoundsCalls).toEqual([bounds]);
  });

  it('destroy removes all bounds listeners and all markers across every layer', async () => {
    const provider = googleProvider({ apiKey: 'k' });
    const handle = await provider.mount(document.createElement('div'), {});
    const raw = handle.raw as { map: FakeMap };
    raw.map.bounds = {
      getSouthWest: () => ({ lat: () => 0, lng: () => 0 }),
      getNorthEast: () => ({ lat: () => 1, lng: () => 1 }),
    };
    const cb = vi.fn();
    provider.onBoundsChange(handle, cb);
    provider.renderLayer(handle, makeLayer());

    provider.destroy(handle);
    raw.map.trigger('idle');

    expect(cb).not.toHaveBeenCalled();
    expect(createdMarkers.every((m) => m.map === null)).toBe(true);
  });

  it('updateMarkerStates is a no-op in advanced-marker mode (no container index is kept there)', async () => {
    const provider = googleProvider({ apiKey: 'k' }); // default advanced-marker mode, no styles
    const handle = await provider.mount(document.createElement('div'), {});
    provider.renderLayer(handle, makeLayer({ markers: [{ id: 1, position: { lat: 1, lng: 1 } }] }));

    expect(() => provider.updateMarkerStates(1, null)).not.toThrow();
  });

  it('updateMarkerStates before any mount is a no-op (no crash)', () => {
    const provider = googleProvider({ apiKey: 'k' });
    expect(() => provider.updateMarkerStates(1, 2)).not.toThrow();
  });

  describe('zoomIn / zoomOut', () => {
    it('zoomIn increments the map\'s current zoom by 1 via getZoom/setZoom', async () => {
      const provider = googleProvider({ apiKey: 'k' });
      const handle = await provider.mount(document.createElement('div'), { zoom: 10 });
      const raw = handle.raw as { map: FakeMap };

      provider.zoomIn();

      expect(raw.map.getZoom()).toBe(11);
    });

    it('zoomOut decrements the map\'s current zoom by 1 via getZoom/setZoom', async () => {
      const provider = googleProvider({ apiKey: 'k' });
      const handle = await provider.mount(document.createElement('div'), { zoom: 10 });
      const raw = handle.raw as { map: FakeMap };

      provider.zoomOut();

      expect(raw.map.getZoom()).toBe(9);
    });

    it('zoomIn/zoomOut treat an undefined current zoom as 0 (defensive default -- e.g. a map SDK state where getZoom() hasn\'t settled yet)', async () => {
      const provider = googleProvider({ apiKey: 'k' });
      const handle = await provider.mount(document.createElement('div'), { zoom: 10 });
      const raw = handle.raw as { map: FakeMap };
      // Force the exact edge case `?? 0` guards against, regardless of what `mount` itself defaults
      // zoom to -- `getZoom()` returning `undefined` at the moment `zoomIn`/`zoomOut` reads it.
      raw.map.zoom = undefined;
      expect(raw.map.getZoom()).toBeUndefined();

      provider.zoomIn();

      expect(raw.map.getZoom()).toBe(1);
    });

    it('zoomIn/zoomOut before any mount are a no-op (no crash)', () => {
      const provider = googleProvider({ apiKey: 'k' });
      expect(() => provider.zoomIn()).not.toThrow();
      expect(() => provider.zoomOut()).not.toThrow();
    });
  });

  describe('toggleFullscreen', () => {
    afterEach(() => {
      // Restore whatever this describe block's tests stubbed onto `document`/the
      // container element, so no fake Fullscreen API state leaks into a later test.
      // @ts-expect-error -- test-only cleanup of a property this suite adds
      delete document.exitFullscreen;
      // @ts-expect-error -- test-only cleanup of a property this suite adds
      delete document.fullscreenElement;
    });

    it('is a no-op (no throw) in an environment without the Fullscreen API -- e.g. this project\'s happy-dom test DOM, which implements neither method', async () => {
      const provider = googleProvider({ apiKey: 'k' });
      await provider.mount(document.createElement('div'), {});

      expect(() => provider.toggleFullscreen()).not.toThrow();
    });

    it('requests fullscreen on the map\'s own container element when it is not currently fullscreen', async () => {
      const provider = googleProvider({ apiKey: 'k' });
      const el = document.createElement('div');
      const handle = await provider.mount(el, {});
      const raw = handle.raw as { containerEl: HTMLElement };
      expect(raw.containerEl).toBe(el);

      const requestFullscreenMock = vi.fn();
      el.requestFullscreen = requestFullscreenMock;

      provider.toggleFullscreen();

      expect(requestFullscreenMock).toHaveBeenCalledTimes(1);
    });

    it('exits fullscreen when the container element is currently the document\'s fullscreen element', async () => {
      const provider = googleProvider({ apiKey: 'k' });
      const el = document.createElement('div');
      await provider.mount(el, {});

      const requestFullscreenMock = vi.fn();
      const exitFullscreenMock = vi.fn();
      el.requestFullscreen = requestFullscreenMock;
      document.exitFullscreen = exitFullscreenMock;
      // @ts-expect-error -- `fullscreenElement` is normally a read-only getter; a plain
      // assignment is enough to simulate it in this fake DOM (happy-dom doesn't define
      // it at all, so this doesn't shadow any real getter).
      document.fullscreenElement = el;

      provider.toggleFullscreen();

      expect(exitFullscreenMock).toHaveBeenCalledTimes(1);
      expect(requestFullscreenMock).not.toHaveBeenCalled();
    });

    it('exits fullscreen when a DESCENDANT of the container is the fullscreen element', async () => {
      const provider = googleProvider({ apiKey: 'k' });
      const el = document.createElement('div');
      const child = document.createElement('div');
      el.appendChild(child);
      await provider.mount(el, {});

      const exitFullscreenMock = vi.fn();
      document.exitFullscreen = exitFullscreenMock;
      // @ts-expect-error -- see the previous test's comment
      document.fullscreenElement = child;

      provider.toggleFullscreen();

      expect(exitFullscreenMock).toHaveBeenCalledTimes(1);
    });

    it('requests fullscreen (does not exit) when a DIFFERENT, unrelated element is currently fullscreen', async () => {
      const provider = googleProvider({ apiKey: 'k' });
      const el = document.createElement('div');
      const otherElement = document.createElement('div');
      await provider.mount(el, {});

      const requestFullscreenMock = vi.fn();
      const exitFullscreenMock = vi.fn();
      el.requestFullscreen = requestFullscreenMock;
      document.exitFullscreen = exitFullscreenMock;
      // @ts-expect-error -- see above
      document.fullscreenElement = otherElement;

      provider.toggleFullscreen();

      expect(requestFullscreenMock).toHaveBeenCalledTimes(1);
      expect(exitFullscreenMock).not.toHaveBeenCalled();
    });

    it('before any mount, is a no-op (no crash)', () => {
      const provider = googleProvider({ apiKey: 'k' });
      expect(() => provider.toggleFullscreen()).not.toThrow();
    });
  });

  describe('mountOverlay', () => {
    it('anchors a PopupOverlayView container in the floatPane and positions it via the projection', async () => {
      const provider = googleProvider({ apiKey: 'k' });
      await provider.mount(document.createElement('div'), {});

      const overlay = provider.mountOverlay({ lat: 3, lng: 4 });

      // Container is returned SYNCHRONOUSLY (stable portal target), styled to
      // anchor its bottom-center on the coordinate.
      expect(overlay.container).toBeInstanceOf(HTMLElement);
      expect(overlay.container.style.transform).toBe('translate(-50%, -100%)');
      expect(overlay.container.style.position).toBe('absolute');

      // A PopupOverlayView was created and added to the map; the fake's setMap
      // fires onAdd()+draw() synchronously.
      const created = createdOverlays[createdOverlays.length - 1];
      expect(created.setMap).toHaveBeenCalled();
      // onAdd() appended the container into the floatPane...
      expect(created.pane.contains(overlay.container)).toBe(true);
      // ...and draw() positioned it from fromLatLngToDivPixel ({ x: 5, y: 7 })
      // lifted by POPUP_OFFSET_Y_PX (14) so it clears the marker: top = 7 - 14.
      expect(overlay.container.style.left).toBe('5px');
      expect(overlay.container.style.top).toBe('-7px');
    });

    it(
      'calls google.maps.OverlayView.preventMapHitsAndGesturesFrom on the popup container in onAdd ' +
        '(regression: without it, a click INSIDE the popup -- e.g. the carousel arrows, the close button ' +
        "-- also registers as a map click, firing onMapClick's background-dismiss listener and closing " +
        'the popup mid-interaction)',
      async () => {
        const provider = googleProvider({ apiKey: 'k' });
        await provider.mount(document.createElement('div'), {});

        const overlay = provider.mountOverlay({ lat: 3, lng: 4 });

        expect(FakeOverlayView.preventMapHitsAndGesturesFrom).toHaveBeenCalledWith(overlay.container);
      },
    );

    it('does not throw when google.maps.OverlayView.preventMapHitsAndGesturesFrom is unavailable (older Maps JS API version/environment)', async () => {
      // Simulate an environment where this static method doesn't exist at all -- the fix must
      // feature-detect it (`typeof ... === 'function'`) rather than call it unconditionally.
      // @ts-expect-error -- test-only: simulating an older Maps JS API missing this static method
      delete FakeOverlayView.preventMapHitsAndGesturesFrom;

      try {
        const provider = googleProvider({ apiKey: 'k' });
        await provider.mount(document.createElement('div'), {});

        expect(() => provider.mountOverlay({ lat: 3, lng: 4 })).not.toThrow();
      } finally {
        FakeOverlayView.preventMapHitsAndGesturesFrom = vi.fn();
      }
    });

    it('setPosition re-runs the projection to re-anchor the (attached) container', async () => {
      const provider = googleProvider({ apiKey: 'k' });
      await provider.mount(document.createElement('div'), {});

      const overlay = provider.mountOverlay({ lat: 1, lng: 1 });
      overlay.container.style.left = '';
      overlay.container.style.top = '';

      overlay.setPosition({ lat: 9, lng: 9 });

      expect(overlay.container.style.left).toBe('5px');
      expect(overlay.container.style.top).toBe('-7px');
    });

    it('unmount detaches the container via setMap(null) -> onRemove', async () => {
      const provider = googleProvider({ apiKey: 'k' });
      await provider.mount(document.createElement('div'), {});

      const overlay = provider.mountOverlay({ lat: 1, lng: 1 });
      const created = createdOverlays[createdOverlays.length - 1];
      expect(created.pane.contains(overlay.container)).toBe(true);

      overlay.unmount();

      expect(created.setMap).toHaveBeenCalledWith(null);
      expect(created.pane.contains(overlay.container)).toBe(false);
    });

    it('before any mount, returns an inert handle over a stable detached container (no crash)', () => {
      const provider = googleProvider({ apiKey: 'k' });
      const overlaysBefore = createdOverlays.length;

      const overlay = provider.mountOverlay({ lat: 1, lng: 1 });

      // No live map -> no OverlayView is even constructed; the container is a
      // stable, detached portal target and the handle's methods are inert.
      expect(overlay.container).toBeInstanceOf(HTMLElement);
      expect(createdOverlays.length).toBe(overlaysBefore);
      expect(() => overlay.setPosition({ lat: 2, lng: 2 })).not.toThrow();
      expect(() => overlay.unmount()).not.toThrow();
    });

    it('returns the container SYNCHRONOUSLY (stable portal target) and only appends it to the floatPane after the deferred async onAdd flushes', async () => {
      // Real `OverlayView.onAdd()` fires on the map's NEXT render cycle, never
      // synchronously inside `setMap()` -- the fake defers it to a microtask.
      deferOverlayOnAdd = true;
      const provider = googleProvider({ apiKey: 'k' });
      await provider.mount(document.createElement('div'), {});

      const overlay = provider.mountOverlay({ lat: 3, lng: 4 });
      const created = createdOverlays[createdOverlays.length - 1];

      // Container exists immediately (React can portal into it right away)...
      expect(overlay.container).toBeInstanceOf(HTMLElement);
      // ...but onAdd hasn't run yet, so it is NOT attached to the pane.
      expect(created.pane.contains(overlay.container)).toBe(false);

      // Flush the deferred onAdd microtask -- mirrors the map's next render cycle.
      await vi.waitFor(() => expect(created.pane.contains(overlay.container)).toBe(true));
    });

    it('onAdd schedules a requestAnimationFrame-deferred re-draw (so the viewport clamp can re-apply once the popup\'s async-portaled content has actually been measured)', async () => {
      const rafSpy = vi.fn();
      vi.stubGlobal('requestAnimationFrame', rafSpy);

      const provider = googleProvider({ apiKey: 'k' });
      await provider.mount(document.createElement('div'), {});
      // `mount()` itself already schedules one rAF probe (see `observeContainerResize`) -- count
      // from here so this assertion isolates the NEW nudge `mountOverlay`'s `onAdd` adds.
      const callsBeforeOverlay = rafSpy.mock.calls.length;

      provider.mountOverlay({ lat: 3, lng: 4 });

      expect(rafSpy.mock.calls.length).toBe(callsBeforeOverlay + 1);
      expect(rafSpy.mock.calls[callsBeforeOverlay][0]).toEqual(expect.any(Function));
    });

    describe('viewport clamping (regression: a popup centered on a marker near the map edge used to render half off-screen)', () => {
      async function mountClampableOverlay(el: HTMLElement, position: { lat: number; lng: number }) {
        const provider = googleProvider({ apiKey: 'k' });
        await provider.mount(el, {});
        const overlay = provider.mountOverlay(position);
        // Simulate the popup's React content having been measured: a real 200x100 box.
        Object.defineProperty(overlay.container, 'offsetWidth', { value: 200, configurable: true });
        Object.defineProperty(overlay.container, 'offsetHeight', { value: 100, configurable: true });
        // mountOverlay's own initial draw() already ran against the (still 0x0 at that instant)
        // container, so force a re-draw now that size + containerPixelPoint are set up -- mirrors
        // the existing 'setPosition re-runs the projection' test's approach.
        overlay.setPosition(position);
        return overlay;
      }

      function makeMapEl(width: number, height: number): HTMLElement {
        const el = document.createElement('div');
        Object.defineProperty(el, 'clientWidth', { value: width, configurable: true });
        Object.defineProperty(el, 'clientHeight', { value: height, configurable: true });
        return el;
      }

      it('shifts the popup LEFT (negative dx) when its marker sits near the map\'s right edge', async () => {
        containerPixelPoint = { x: 780, y: 300 }; // near the right edge of an 800px-wide map
        const overlay = await mountClampableOverlay(makeMapEl(800, 600), { lat: 3, lng: 4 });

        // divPixel is the fake's fixed { x: 5, y: 7 }; clampPopupPosition shifts left by 88px for
        // this exact geometry (see the equivalent clampPopupPosition unit test).
        expect(overlay.container.style.left).toBe('-83px'); // 5 + (-88)
        expect(overlay.container.style.top).toBe('-7px'); // unchanged -- no vertical flip
        expect(overlay.container.style.transform).toBe('translate(-50%, -100%)');
      });

      it('shifts the popup RIGHT (positive dx) when its marker sits near the map\'s left edge', async () => {
        containerPixelPoint = { x: 20, y: 300 }; // near the left edge
        const overlay = await mountClampableOverlay(makeMapEl(800, 600), { lat: 3, lng: 4 });

        expect(overlay.container.style.left).toBe('93px'); // 5 + 88
        expect(overlay.container.style.top).toBe('-7px');
        expect(overlay.container.style.transform).toBe('translate(-50%, -100%)');
      });

      it('flips the popup BELOW the anchor (and switches the transform) when its marker sits near the map\'s top edge', async () => {
        containerPixelPoint = { x: 400, y: 20 }; // near the top edge, horizontally centered
        const overlay = await mountClampableOverlay(makeMapEl(800, 600), { lat: 3, lng: 4 });

        expect(overlay.container.style.left).toBe('5px'); // no horizontal shift needed
        expect(overlay.container.style.top).toBe('21px'); // 7 + 14 (flipped BELOW the anchor)
        expect(overlay.container.style.transform).toBe('translate(-50%, 0)');
      });

      it('does not shift or flip when the marker is well within the map, away from every edge', async () => {
        containerPixelPoint = { x: 400, y: 300 }; // dead center of an 800x600 map
        const overlay = await mountClampableOverlay(makeMapEl(800, 600), { lat: 3, lng: 4 });

        expect(overlay.container.style.left).toBe('5px');
        expect(overlay.container.style.top).toBe('-7px');
        expect(overlay.container.style.transform).toBe('translate(-50%, -100%)');
      });

      it('falls back to the original un-clamped placement when the container-pixel projection is unavailable (defensive, even with a measured popup)', async () => {
        containerPixelPoint = null;
        const overlay = await mountClampableOverlay(makeMapEl(800, 600), { lat: 3, lng: 4 });

        expect(overlay.container.style.left).toBe('5px');
        expect(overlay.container.style.top).toBe('-7px');
        expect(overlay.container.style.transform).toBe('translate(-50%, -100%)');
      });
    });
  });

  describe('container resize hardening', () => {
    it('mount attaches a ResizeObserver to the map container', async () => {
      const provider = googleProvider({ apiKey: 'k' });
      const el = document.createElement('div');

      await provider.mount(el, {});

      expect(resizeObserverInstances).toHaveLength(1);
      expect(resizeObserverInstances[0].el).toBe(el);
    });

    it('destroy disconnects the ResizeObserver attached to the container', async () => {
      const provider = googleProvider({ apiKey: 'k' });
      const handle = await provider.mount(document.createElement('div'), {});

      expect(resizeObserverInstances[0].disconnect).not.toHaveBeenCalled();
      provider.destroy(handle);

      expect(resizeObserverInstances[0].disconnect).toHaveBeenCalledTimes(1);
    });

    it('does nothing while the container is still 0x0', async () => {
      const provider = googleProvider({ apiKey: 'k' });
      const el = document.createElement('div');
      vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({ width: 0, height: 0 } as unknown as DOMRect);

      await provider.mount(el, { center: { lat: 5, lng: 6 } });
      resizeObserverInstances[0].trigger();

      expect(eventTriggerMock).not.toHaveBeenCalled();
      expect(setCenterCalls).toHaveLength(0);
    });

    it('fires the "resize" event and recenters on the FIRST real size, then only fires "resize" on later size changes', async () => {
      const provider = googleProvider({ apiKey: 'k' });
      const el = document.createElement('div');
      const rect = vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({ width: 0, height: 0 } as unknown as DOMRect);

      const handle = await provider.mount(el, { center: { lat: 5, lng: 6 } });
      const raw = handle.raw as { map: FakeMap };
      const { trigger } = resizeObserverInstances[0];

      // 0x0 -> N: first real size. Fires 'resize' AND recenters to the initial center.
      rect.mockReturnValue({ width: 400, height: 300 } as unknown as DOMRect);
      trigger();

      expect(eventTriggerMock).toHaveBeenCalledTimes(1);
      expect(eventTriggerMock).toHaveBeenCalledWith(raw.map, 'resize');
      expect(setCenterCalls).toEqual([{ lat: 5, lng: 6 }]);

      // A later resize (e.g. a sidebar toggling) still nudges Maps to re-layout, but must never
      // fight a user who may have since panned/zoomed by forcing the center back again.
      rect.mockReturnValue({ width: 500, height: 300 } as unknown as DOMRect);
      trigger();

      expect(eventTriggerMock).toHaveBeenCalledTimes(2);
      expect(setCenterCalls).toHaveLength(1);
    });

    it('mount does not throw when ResizeObserver is unavailable (SSR / unsupported environment)', async () => {
      vi.stubGlobal('ResizeObserver', undefined);
      const provider = googleProvider({ apiKey: 'k' });

      const handle = await provider.mount(document.createElement('div'), {});

      expect(resizeObserverInstances).toHaveLength(0);
      expect(() => provider.destroy(handle)).not.toThrow();
    });
  });

  describe('clustering', () => {
    // Declared FIRST in this describe block, deliberately: it's the only test in the whole file
    // that needs `@googlemaps/markerclusterer`'s dynamic `import()` to actually reject (real
    // dynamic `import()` failures aren't cached for retry, unlike successes -- so running this
    // before any successful clustering import elsewhere in the file avoids needing
    // `vi.resetModules()`/a fresh SUT re-import just to un-cache a prior success).
    it('falls back to plain (unclustered) markers -- no crash -- and warns once when the optional dependency fails to load', async () => {
      simulateMarkerClustererImportFailure = true;
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const provider = googleProvider({ apiKey: 'k' });
      const handle = await provider.mount(document.createElement('div'), {});
      const layer = makeLayer({
        markers: [
          { id: 1, position: { lat: 1, lng: 1 } },
          { id: 2, position: { lat: 2, lng: 2 } },
        ],
        clustering: { maxZoom: 10 },
      });

      expect(() => provider.renderLayer(handle, layer)).not.toThrow();

      await vi.waitFor(() => expect(warnSpy).toHaveBeenCalledTimes(1));
      expect(String(warnSpy.mock.calls[0][0])).toContain('@googlemaps/markerclusterer');

      // Plain markers still rendered as a fallback -- no crash, no silent drop.
      expect(createdMarkers).toHaveLength(2);
      expect(createdMarkers.every((m) => m.map !== null)).toBe(true);
      expect(createdClusterers).toHaveLength(0);

      warnSpy.mockRestore();
      simulateMarkerClustererImportFailure = false;
    });

    it('renderLayer wraps the layer\'s markers in a MarkerClusterer when layer.clustering is truthy', async () => {
      const provider = googleProvider({ apiKey: 'k' });
      const handle = await provider.mount(document.createElement('div'), {});
      const raw = handle.raw as { map: FakeMap };
      const layer = makeLayer({
        markers: [
          { id: 1, position: { lat: 1, lng: 1 } },
          { id: 2, position: { lat: 2, lng: 2 } },
        ],
        clustering: { maxZoom: 12 },
      });

      provider.renderLayer(handle, layer);

      await vi.waitFor(() => expect(createdClusterers).toHaveLength(1));
      const clusterer = createdClusterers[0];
      expect(clusterer.options.map).toBe(raw.map);
      expect(clusterer.options.markers).toEqual(createdMarkers);
      expect(clusterer.options.algorithmOptions).toEqual({ maxZoom: 12 });
      expect(clusterer.options.renderer.render).toBeTypeOf('function');
    });

    it('renderLayer does NOT construct a MarkerClusterer when layer.clustering is omitted or false', async () => {
      const provider = googleProvider({ apiKey: 'k' });
      const handle = await provider.mount(document.createElement('div'), {});

      provider.renderLayer(handle, makeLayer({ id: 'no-clustering-field' }));
      provider.renderLayer(handle, makeLayer({ id: 'clustering-false', clustering: false }));

      // Flush any pending microtasks so a wrongly-triggered import would have had time to resolve.
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(createdClusterers).toHaveLength(0);
    });

    it("the custom renderer draws a red circle showing the cluster's count as an AdvancedMarkerElement", async () => {
      const provider = googleProvider({ apiKey: 'k' });
      const handle = await provider.mount(document.createElement('div'), {});
      provider.renderLayer(handle, makeLayer({ clustering: { maxZoom: 12 } }));
      await vi.waitFor(() => expect(createdClusterers).toHaveLength(1));

      const markersBefore = createdMarkers.length;
      const fakeCluster = { count: 7, position: { lat: 5, lng: 6 } };
      const rendered = createdClusterers[0].options.renderer.render(fakeCluster, {}, handle.raw) as FakeAdvancedMarkerElement;

      // Built via `markerLib.AdvancedMarkerElement` -- same constructor individual pins use --
      // so it shows up in `createdMarkers` exactly like any other advanced marker.
      expect(createdMarkers).toHaveLength(markersBefore + 1);
      expect(createdMarkers[createdMarkers.length - 1]).toBe(rendered);
      expect(rendered.position).toEqual({ lat: 5, lng: 6 });

      const content = rendered.content as HTMLDivElement;
      expect(content.textContent).toBe('7');
      expect(content.style.borderRadius).toBe('50%');
    });

    it('cluster circle size scales with count and is capped for very large clusters', async () => {
      const provider = googleProvider({ apiKey: 'k' });
      const handle = await provider.mount(document.createElement('div'), {});
      provider.renderLayer(handle, makeLayer({ clustering: { maxZoom: 12 } }));
      await vi.waitFor(() => expect(createdClusterers).toHaveLength(1));

      const render = createdClusterers[0].options.renderer.render;
      const small = render({ count: 2, position: { lat: 0, lng: 0 } }, {}, handle.raw) as FakeAdvancedMarkerElement;
      const large = render({ count: 20, position: { lat: 0, lng: 0 } }, {}, handle.raw) as FakeAdvancedMarkerElement;
      const huge = render({ count: 500_000, position: { lat: 0, lng: 0 } }, {}, handle.raw) as FakeAdvancedMarkerElement;

      const sizeOf = (m: FakeAdvancedMarkerElement) => parseInt((m.content as HTMLDivElement).style.width, 10);
      expect(sizeOf(small)).toBeLessThan(sizeOf(large));
      expect(sizeOf(large)).toBeLessThan(sizeOf(huge));
      // Capped -- an astronomically large count must not blow past a reasonable on-map footprint.
      expect(sizeOf(huge)).toBeLessThanOrEqual(64);
    });

    it('renderLayer unsubscribe (layer teardown) disposes the clusterer via setMap(null) -- no leak', async () => {
      const provider = googleProvider({ apiKey: 'k' });
      const handle = await provider.mount(document.createElement('div'), {});
      const unsubscribe = provider.renderLayer(handle, makeLayer({ clustering: { maxZoom: 12 } }));

      await vi.waitFor(() => expect(createdClusterers).toHaveLength(1));
      expect(createdClusterers[0].setMap).not.toHaveBeenCalled();

      unsubscribe();

      expect(createdClusterers[0].setMap).toHaveBeenCalledWith(null);
    });

    it('re-rendering the same layer.id replaces the clusterer: the old one is disposed, a new one takes over', async () => {
      const provider = googleProvider({ apiKey: 'k' });
      const handle = await provider.mount(document.createElement('div'), {});

      provider.renderLayer(handle, makeLayer({ clustering: { maxZoom: 12 } }));
      await vi.waitFor(() => expect(createdClusterers).toHaveLength(1));
      const first = createdClusterers[0];

      provider.renderLayer(
        handle,
        makeLayer({ markers: [{ id: 9, position: { lat: 9, lng: 9 } }], clustering: { maxZoom: 12 } }),
      );

      // The old clusterer is disposed synchronously, at the start of the replacing renderLayer
      // call -- doesn't need to wait for the new clusterer's own (async) setup to finish.
      expect(first.setMap).toHaveBeenCalledWith(null);

      await vi.waitFor(() => expect(createdClusterers).toHaveLength(2));
      const second = createdClusterers[1];
      expect(second.setMap).not.toHaveBeenCalled();
      expect(second.options.markers).not.toBe(first.options.markers);
    });

    it('destroy() disposes every active clusterer across all layers -- no leak', async () => {
      const provider = googleProvider({ apiKey: 'k' });
      const handle = await provider.mount(document.createElement('div'), {});

      provider.renderLayer(handle, makeLayer({ id: 'a', clustering: { maxZoom: 12 } }));
      await vi.waitFor(() => expect(createdClusterers).toHaveLength(1));
      provider.renderLayer(handle, makeLayer({ id: 'b', clustering: { maxZoom: 14 } }));
      await vi.waitFor(() => expect(createdClusterers).toHaveLength(2));

      provider.destroy(handle);

      expect(createdClusterers[0].setMap).toHaveBeenCalledWith(null);
      expect(createdClusterers[1].setMap).toHaveBeenCalledWith(null);
    });
  });

  describe('styles (OverlayView) mode', () => {
    const styles = [
      { elementType: 'geometry', stylers: [{ color: '#242f3e' }] },
    ] as google.maps.MapTypeStyle[];

    it('mount creates the Map WITH styles and WITHOUT a mapId when config.styles is supplied', async () => {
      const provider = googleProvider({ apiKey: 'k', mapId: 'ignored-in-styles-mode', styles });

      await provider.mount(document.createElement('div'), { center: { lat: 1, lng: 2 }, zoom: 8 });

      expect(mapConstructorCalls).toHaveLength(1);
      const opts = mapConstructorCalls[0].opts;
      // Legacy JSON styling only applies on a map with no Map ID -- so `styles` is set and `mapId`
      // is never sent, even though a `mapId` was also (wrongly) supplied above.
      expect(opts.styles).toBe(styles);
      expect(opts.mapId).toBeUndefined();
    });

    it('renderLayer creates OverlayView markers (not AdvancedMarkerElements) and adds them via setMap', async () => {
      const provider = googleProvider({ apiKey: 'k', styles });
      const handle = await provider.mount(document.createElement('div'), {});
      const raw = handle.raw as { map: FakeMap; markerMode: string };
      const layer = makeLayer({
        markers: [
          { id: 1, position: { lat: 1, lng: 1 } },
          { id: 2, position: { lat: 2, lng: 2 } },
        ],
      });

      provider.renderLayer(handle, layer);

      // Overlay markers, not advanced markers.
      expect(raw.markerMode).toBe('overlay');
      expect(createdOverlays).toHaveLength(2);
      expect(createdMarkers).toHaveLength(0);
      // Each overlay was added to the map via setMap(map) at creation.
      for (const overlay of createdOverlays) {
        expect(overlay.setMap).toHaveBeenCalledWith(raw.map);
      }
    });

    it(
      'calls google.maps.OverlayView.preventMapHitsAndGesturesFrom on each marker\'s container div in ' +
        "onAdd (regression: a real pointer click on a marker also registered as a map click, firing " +
        "onMapClick's background-dismiss listener and instantly deselecting the just-clicked marker -- " +
        'popup opened and closed in the same gesture. A synthetic element.click() never reproduced this ' +
        "because it doesn't produce a real Google map hit.)",
      async () => {
        const provider = googleProvider({ apiKey: 'k', styles });
        const handle = await provider.mount(document.createElement('div'), {});

        provider.renderLayer(handle, makeLayer({ markers: [{ id: 1, position: { lat: 1, lng: 1 } }] }));

        const div = createdOverlays[0].pane.firstElementChild as HTMLElement;
        expect(FakeOverlayView.preventMapHitsAndGesturesFrom).toHaveBeenCalledWith(div);
      },
    );

    it('overlay markers render iconUrl content as an <img> and fire onMarkerClick when clicked', async () => {
      const provider = googleProvider({ apiKey: 'k', styles });
      const handle = await provider.mount(document.createElement('div'), {});
      const onMarkerClick = vi.fn();
      const layer = makeLayer({
        markers: [{ id: 'biz', position: { lat: 1, lng: 1 }, iconUrl: 'https://example.test/icon.png' }],
        onMarkerClick,
      });

      provider.renderLayer(handle, layer);

      // onAdd() ran (via the fake setMap), appending an <img> whose src is the marker's iconUrl
      // into the overlay's own pane.
      const img = createdOverlays[0].pane.querySelector('img');
      expect(img).not.toBeNull();
      expect(img?.getAttribute('src')).toBe('https://example.test/icon.png');

      // Clicking the overlay's wrapper div fires onMarkerClick with the marker id.
      const wrapper = img?.parentElement as HTMLElement;
      wrapper.click();
      expect(onMarkerClick).toHaveBeenCalledTimes(1);
      expect(onMarkerClick).toHaveBeenCalledWith('biz');
    });

    it('renderLayer unsubscribe tears down overlay markers via setMap(null)', async () => {
      const provider = googleProvider({ apiKey: 'k', styles });
      const handle = await provider.mount(document.createElement('div'), {});

      const unsubscribe = provider.renderLayer(handle, makeLayer({ markers: [{ id: 1, position: { lat: 1, lng: 1 } }] }));
      expect(createdOverlays).toHaveLength(1);
      expect(createdOverlays[0].setMap).not.toHaveBeenCalledWith(null);

      unsubscribe();

      expect(createdOverlays[0].setMap).toHaveBeenCalledWith(null);
    });

    it('destroy tears down every overlay marker via setMap(null)', async () => {
      const provider = googleProvider({ apiKey: 'k', styles });
      const handle = await provider.mount(document.createElement('div'), {});
      provider.renderLayer(handle, makeLayer({ id: 'a', markers: [{ id: 1, position: { lat: 1, lng: 1 } }] }));
      provider.renderLayer(handle, makeLayer({ id: 'b', markers: [{ id: 2, position: { lat: 2, lng: 2 } }] }));

      expect(createdOverlays).toHaveLength(2);
      provider.destroy(handle);

      for (const overlay of createdOverlays) {
        expect(overlay.setMap).toHaveBeenCalledWith(null);
      }
    });

    it('updateMarkerStates toggles rle-marker--selected/--hovered on the exact existing container divs (no DOM recreation)', async () => {
      const provider = googleProvider({ apiKey: 'k', styles });
      const handle = await provider.mount(document.createElement('div'), {});
      provider.renderLayer(
        handle,
        makeLayer({
          markers: [
            { id: 'a', position: { lat: 1, lng: 1 } },
            { id: 'b', position: { lat: 2, lng: 2 } },
          ],
        }),
      );

      const [overlayA, overlayB] = createdOverlays;
      const divA = overlayA.pane.firstElementChild as HTMLElement;
      const divB = overlayB.pane.firstElementChild as HTMLElement;

      provider.updateMarkerStates('a', null);
      expect(divA.classList.contains('rle-marker--selected')).toBe(true);
      expect(divB.classList.contains('rle-marker--selected')).toBe(false);
      expect(divA.classList.contains('rle-marker--hovered')).toBe(false);

      provider.updateMarkerStates(null, 'b');
      expect(divA.classList.contains('rle-marker--selected')).toBe(false);
      expect(divB.classList.contains('rle-marker--hovered')).toBe(true);

      // Selected wins over hovered when the same id is passed for both.
      provider.updateMarkerStates('a', 'a');
      expect(divA.classList.contains('rle-marker--selected')).toBe(true);
      expect(divA.classList.contains('rle-marker--hovered')).toBe(false);

      // No DOM recreation -- the exact same container nodes are still the ones in each pane.
      expect(overlayA.pane.firstElementChild).toBe(divA);
      expect(overlayB.pane.firstElementChild).toBe(divB);
    });

    it('renderLayer unsubscribe prunes that layer\'s marker ids from the id->element index (no stale references linger)', async () => {
      const provider = googleProvider({ apiKey: 'k', styles });
      const handle = await provider.mount(document.createElement('div'), {});
      const raw = handle.raw as { markerElements: Map<string | number, HTMLElement> };

      const unsubscribeA = provider.renderLayer(
        handle,
        makeLayer({ id: 'a', markers: [{ id: 1, position: { lat: 1, lng: 1 } }] }),
      );
      provider.renderLayer(handle, makeLayer({ id: 'b', markers: [{ id: 2, position: { lat: 2, lng: 2 } }] }));

      expect(raw.markerElements.size).toBe(2);

      unsubscribeA();

      expect(raw.markerElements.has(1)).toBe(false);
      expect(raw.markerElements.has(2)).toBe(true);
      expect(raw.markerElements.size).toBe(1);
    });

    it('re-rendering a layer.id replaces its entries in the id->element index with the fresh markers', async () => {
      const provider = googleProvider({ apiKey: 'k', styles });
      const handle = await provider.mount(document.createElement('div'), {});

      provider.renderLayer(handle, makeLayer({ markers: [{ id: 'a', position: { lat: 1, lng: 1 } }] }));
      const staleDiv = createdOverlays[0].pane.firstElementChild as HTMLElement;

      provider.renderLayer(handle, makeLayer({ markers: [{ id: 'a', position: { lat: 9, lng: 9 } }] }));
      const freshDiv = createdOverlays[1].pane.firstElementChild as HTMLElement;

      provider.updateMarkerStates('a', null);

      // Only the CURRENT container div for id 'a' gets the class -- the stale, already-torn-down
      // node from the replaced layer is untouched.
      expect(freshDiv.classList.contains('rle-marker--selected')).toBe(true);
      expect(staleDiv.classList.contains('rle-marker--selected')).toBe(false);
    });

    it(
      'a marker container recreated by a layer re-render (e.g. a bounds/idle-driven points reload while a ' +
        'marker is selected/hovered) immediately regains its rle-marker--selected/--hovered class on ' +
        'registration -- even though the marker-state effect in `ListingMap` only re-invokes ' +
        'updateMarkerStates on a selection/hover CHANGE, never on a points-only reload, so nothing else ' +
        'ever re-applies the highlight to the fresh container (regression: the old container is torn down ' +
        'and a brand-new one is created with NO class, and it silently stays unhighlighted until the next ' +
        'real selection/hover change)',
      async () => {
        deferOverlayOnAdd = true;
        const provider = googleProvider({ apiKey: 'k', styles });
        const handle = await provider.mount(document.createElement('div'), {});

        // Initial render of two markers, then select 'a' and hover 'b' -- both containers pick up
        // their class via the normal updateMarkerStates path.
        provider.renderLayer(
          handle,
          makeLayer({
            markers: [
              { id: 'a', position: { lat: 1, lng: 1 } },
              { id: 'b', position: { lat: 2, lng: 2 } },
            ],
          }),
        );
        await vi.waitFor(() => expect(createdOverlays[0].pane.firstElementChild).not.toBeNull());
        await vi.waitFor(() => expect(createdOverlays[1].pane.firstElementChild).not.toBeNull());
        provider.updateMarkerStates('a', 'b');

        const firstDivA = createdOverlays[0].pane.firstElementChild as HTMLElement;
        const firstDivB = createdOverlays[1].pane.firstElementChild as HTMLElement;
        expect(firstDivA.classList.contains('rle-marker--selected')).toBe(true);
        expect(firstDivB.classList.contains('rle-marker--hovered')).toBe(true);

        // Simulate a points reload recreating markers for the SAME layer.id (a fresh `state.points`
        // reference -> the layer-render effect tears down every existing marker and builds new ones)
        // WITHOUT touching selection/hover -- exactly what happens on every bounds/idle event while a
        // marker is selected/hovered (perks' `/find` refilters on every map move). Registration is
        // async (deferred `onAdd`), mirroring the real Maps runtime.
        provider.renderLayer(
          handle,
          makeLayer({
            markers: [
              { id: 'a', position: { lat: 1, lng: 1 } },
              { id: 'b', position: { lat: 2, lng: 2 } },
            ],
          }),
        );

        await vi.waitFor(() => expect(createdOverlays[2].pane.firstElementChild).not.toBeNull());
        await vi.waitFor(() => expect(createdOverlays[3].pane.firstElementChild).not.toBeNull());
        const freshDivA = createdOverlays[2].pane.firstElementChild as HTMLElement;
        const freshDivB = createdOverlays[3].pane.firstElementChild as HTMLElement;

        // The freshly (re)created containers must already carry the correct highlight -- nothing in
        // this test ever calls updateMarkerStates a second time.
        expect(freshDivA.classList.contains('rle-marker--selected')).toBe(true);
        expect(freshDivB.classList.contains('rle-marker--hovered')).toBe(true);
      },
    );

    it('populates the container index from the overlay\'s ASYNC onAdd, not a synchronous read right after setMap() (regression: real OverlayView.onAdd fires on the next render cycle, never synchronously inside setMap -- a synchronous read finds nothing and updateMarkerStates silently never repaints)', async () => {
      deferOverlayOnAdd = true;
      const provider = googleProvider({ apiKey: 'k', styles });
      const handle = await provider.mount(document.createElement('div'), {});
      const raw = handle.raw as { markerElements: Map<string | number, HTMLElement> };

      provider.renderLayer(handle, makeLayer({ markers: [{ id: 'a', position: { lat: 1, lng: 1 } }] }));

      // `onAdd` hasn't fired yet (deferred to a microtask) -- a synchronous
      // read-right-after-setMap() implementation would already have missed it here, and (since
      // nothing else ever populates the index later) would stay empty forever.
      expect(raw.markerElements.size).toBe(0);

      // Flush the deferred onAdd microtask -- mirrors the real Maps runtime's next render cycle.
      await vi.waitFor(() => expect(raw.markerElements.size).toBe(1));

      provider.updateMarkerStates('a', null);
      const div = createdOverlays[0].pane.firstElementChild as HTMLElement;
      expect(div.classList.contains('rle-marker--selected')).toBe(true);
    });

    it('destroy clears the id->element index entirely', async () => {
      const provider = googleProvider({ apiKey: 'k', styles });
      const handle = await provider.mount(document.createElement('div'), {});
      const raw = handle.raw as { markerElements: Map<string | number, HTMLElement> };
      provider.renderLayer(handle, makeLayer({ markers: [{ id: 1, position: { lat: 1, lng: 1 } }] }));

      expect(raw.markerElements.size).toBe(1);
      provider.destroy(handle);

      expect(raw.markerElements.size).toBe(0);
    });

    it(
      'destroying a STALE mount handle must never clear currentRaw out from under a later, kept ' +
        'mount just because the stale one happened to finish constructing its raw state LAST ' +
        '-- regression for a React Strict Mode double-mount race (mount->cleanup->mount) that could ' +
        'permanently null out updateMarkerStates\' repaint capability',
      async () => {
        const provider = googleProvider({ apiKey: 'k', styles });

        // Reproduces "call order A, B; completion order B, A" deterministically: A is called
        // first (mirroring ListingMap's first, Strict-Mode-discarded effect run) but its very
        // first `importLibrary` call is gated to resolve strictly AFTER B's mount has already
        // fully completed and become `currentRaw` -- exactly the adversarial ordering the real
        // async `mount()` (two sequential `importLibrary` awaits) can produce under overlapping
        // concurrent mounts, without depending on real timing.
        let releaseStale: (() => void) | undefined;
        const gate = new Promise<void>((resolve) => {
          releaseStale = resolve;
        });
        importLibraryMock.mockImplementationOnce(async (name: string) => {
          await gate;
          return resolveLibrary(name);
        });

        const mountAPromise = provider.mount(document.createElement('div'), {}); // call order: first (gated -- resolves last)
        const handleB = await provider.mount(document.createElement('div'), {}); // call order: second (resolves first)

        // The kept mount (B) is live and has a real marker.
        provider.renderLayer(handleB, makeLayer({ markers: [{ id: 'x', position: { lat: 1, lng: 1 } }] }));

        releaseStale?.();
        const handleA = await mountAPromise;

        // Mirrors `ListingMap`'s mount effect discovering its own `cancelled` flag is true once
        // this (call-order-first, but slow-to-resolve) mount finally settles: it discards the
        // now-orphaned handle immediately.
        provider.destroy(handleA);

        // The surviving handle's repaint capability must still work -- destroying the STALE
        // handle must not have nulled out the package-internal `currentRaw` pointer just because
        // A's raw construction happened to finish after B's.
        provider.updateMarkerStates('x', null);
        const div = createdOverlays[0].pane.firstElementChild as HTMLElement;
        expect(div.classList.contains('rle-marker--selected')).toBe(true);
      },
    );

    it('skips clustering in overlay mode: no MarkerClusterer, warns once', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const provider = googleProvider({ apiKey: 'k', styles });
      const handle = await provider.mount(document.createElement('div'), {});

      provider.renderLayer(handle, makeLayer({ id: 'a', clustering: { maxZoom: 10 } }));
      provider.renderLayer(handle, makeLayer({ id: 'b', clustering: { maxZoom: 10 } }));

      // No clusterer ever constructed, overlay markers still rendered plain.
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(createdClusterers).toHaveLength(0);
      expect(createdOverlays).toHaveLength(2);
      // Warned exactly once (module-level flag), mentioning the unsupported mode.
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(String(warnSpy.mock.calls[0][0])).toContain('OverlayView');

      warnSpy.mockRestore();
    });
  });
});

// --- clampPopupPosition (pure) -------------------------------------------------------------
//
// Pure geometry backing `PopupOverlayView.draw()`'s viewport clamp/flip -- no `google.maps` mock
// needed, unlike the rest of this file. See that function's doc comment in the source module.

describe('clampPopupPosition', () => {
  // An 800x600 map with a 200x100 popup, 14px above-anchor offset, 8px viewport padding -- the
  // shared geometry for every case below except the ones that deliberately vary map/popup size.
  const base = { mapW: 800, mapH: 600, popupW: 200, popupH: 100, offsetY: 14, pad: 8 };

  it('does not shift or flip a popup anchored well within the map, away from every edge', () => {
    // box: left=300, right=500 -- both within [pad, mapW-pad] = [8, 792].
    // topIfAbove = 300 - 14 - 100 = 186, not < pad(8) -- no top overflow either.
    expect(clampPopupPosition({ ...base, anchorX: 400, anchorY: 300 })).toEqual({ dx: 0, flipBelow: false });
  });

  it('shifts LEFT (negative dx) when the popup would overflow the map\'s right edge', () => {
    // box: left=680, right=880; clamped right edge is mapW-pad=792 -> dx = 792 - 880 = -88.
    const result = clampPopupPosition({ ...base, anchorX: 780, anchorY: 300 });
    expect(result.dx).toBe(-88);
    expect(result.dx).toBeLessThan(0);
    expect(result.flipBelow).toBe(false);
  });

  it('shifts RIGHT (positive dx) when the popup would overflow the map\'s left edge', () => {
    // box: left=-80, right=120; clamped left edge is pad=8 -> dx = 8 - (-80) = 88.
    const result = clampPopupPosition({ ...base, anchorX: 20, anchorY: 300 });
    expect(result.dx).toBe(88);
    expect(result.dx).toBeGreaterThan(0);
    expect(result.flipBelow).toBe(false);
  });

  it('flips BELOW the anchor when the default above-anchor placement overflows the top edge and there is room below', () => {
    // topIfAbove = 20 - 14 - 100 = -94, < pad(8) -- overflows the top.
    // bottomIfBelow = 20 + 14 + 100 = 134, <= mapH-pad(592) -- flipping fits.
    const result = clampPopupPosition({ ...base, anchorX: 400, anchorY: 20 });
    expect(result.flipBelow).toBe(true);
    expect(result.dx).toBe(0); // horizontally centered -- no shift needed either way
  });

  it('does NOT flip when the top overflows but flipping below would ALSO overflow (a map too short for the popup either way)', () => {
    // Same top overflow as above, but a short 100px-tall map: bottomIfBelow(134) > mapH-pad(92).
    const result = clampPopupPosition({ ...base, mapH: 100, anchorX: 400, anchorY: 20 });
    expect(result.flipBelow).toBe(false);
  });

  it('pins to the left pad -- rather than splitting the difference between two edges it cannot both satisfy -- when the popup is wider than the map has room for', () => {
    // popupW(200) > mapW-pad*2 (150-16=134) -- doesn't fit no matter how it's shifted.
    // left = 75-100=-25 -> dx = pad - left = 8-(-25) = 33, pinning the left edge to exactly `pad`.
    const result = clampPopupPosition({ ...base, mapW: 150, anchorX: 75, anchorY: 300 });
    expect(result.dx).toBe(33);
  });

  it('does not shift when the box sits exactly on the padded edges (boundary, not overflow)', () => {
    // right = 692+100=792, exactly mapW-pad(792); left = 592, within bounds -- no overflow.
    const result = clampPopupPosition({ ...base, anchorX: 692, anchorY: 300 });
    expect(result.dx).toBe(0);
  });
});
