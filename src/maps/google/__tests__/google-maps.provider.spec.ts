import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Bounds, MapInitOptions, RenderedLayer } from '~/interfaces';
import { googleProvider } from '../google-maps.provider';

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

class FakeOverlayView {
  // The pane the overlay's DOM is mounted into. Kept per-instance (not `document`) so tests can
  // query an overlay's own content without cross-test DOM bleed.
  readonly pane = document.createElement('div');

  readonly setMap = vi.fn((map: unknown) => {
    // The real OverlayView triggers onAdd()+draw() when added to a map, and onRemove() when
    // removed (setMap(null)). The subclass defines these on its prototype, so `this.onAdd` etc.
    // resolve to the subclass overrides.
    if (map) {
      (this as unknown as { onAdd(): void }).onAdd();
      (this as unknown as { draw(): void }).draw();
    } else {
      (this as unknown as { onRemove(): void }).onRemove();
    }
  });

  constructor() {
    createdOverlays.push(this);
  }

  getPanes() {
    return { overlayMouseTarget: this.pane };
  }

  getProjection() {
    return { fromLatLngToDivPixel: () => ({ x: 5, y: 7 }) };
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
const importLibraryMock = vi.fn(async (name: string) => {
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
});

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
    importLibraryMock.mockClear();
    eventTriggerMock.mockClear();
    fitBoundsCalls = [];
    createdMarkers = [];
    mapConstructorCalls = [];
    resizeObserverInstances = [];
    setCenterCalls = [];
    createdClusterers = [];
    createdOverlays = [];

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
