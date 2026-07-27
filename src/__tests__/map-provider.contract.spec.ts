import { describe, it, expect, vi } from 'vitest';
import type { Bounds, MapInitOptions, RenderedLayer } from '~/interfaces';
import { FakeMapProvider } from '~/testing';

function makeLayer(overrides: Partial<RenderedLayer> = {}): RenderedLayer {
  return {
    id: 'properties',
    markers: [{ id: 1, position: { lat: 40.7, lng: -74 } }],
    ...overrides,
  };
}

describe('MapProvider contract (FakeMapProvider)', () => {
  it('mount returns a handle and records the call', async () => {
    const provider = new FakeMapProvider();
    const el = document.createElement('div');
    const opts: MapInitOptions = { apiKey: 'test-key', zoom: 12 };

    const handle = await provider.mount(el, opts);

    expect(handle).toBeDefined();
    expect(provider.mounts).toEqual([handle]);
  });

  it('renderLayer records the layer in order, and the returned unsubscribe removes just that layer', async () => {
    const provider = new FakeMapProvider();
    const handle = await provider.mount(document.createElement('div'), { apiKey: 'k' });
    const layerA = makeLayer({ id: 'properties' });
    const layerB = makeLayer({ id: 'businesses' });

    const unsubscribeA = provider.renderLayer(handle, layerA);
    provider.renderLayer(handle, layerB);

    expect(provider.renderedLayers).toEqual([layerA, layerB]);

    unsubscribeA();

    expect(provider.renderedLayers).toEqual([layerB]);
  });

  it('onBoundsChange registers a callback that emitBounds triggers with the exact bounds', async () => {
    const provider = new FakeMapProvider();
    const handle = await provider.mount(document.createElement('div'), { apiKey: 'k' });
    const cb = vi.fn();
    const bounds: Bounds = { west: -1, south: -2, east: 3, north: 4 };

    provider.onBoundsChange(handle, cb);
    provider.emitBounds(bounds);

    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb).toHaveBeenCalledWith(bounds);
  });

  it('the onBoundsChange unsubscribe stops further delivery to that callback only', async () => {
    const provider = new FakeMapProvider();
    const handle = await provider.mount(document.createElement('div'), { apiKey: 'k' });
    const cbA = vi.fn();
    const cbB = vi.fn();

    const unsubscribeA = provider.onBoundsChange(handle, cbA);
    provider.onBoundsChange(handle, cbB);

    provider.emitBounds({ west: 0, south: 0, east: 1, north: 1 });
    unsubscribeA();
    provider.emitBounds({ west: 5, south: 5, east: 6, north: 6 });

    expect(cbA).toHaveBeenCalledTimes(1);
    expect(cbB).toHaveBeenCalledTimes(2);
  });

  it('fitBounds records each call in order', async () => {
    const provider = new FakeMapProvider();
    const handle = await provider.mount(document.createElement('div'), { apiKey: 'k' });
    const first: Bounds = { west: 0, south: 0, east: 1, north: 1 };
    const second: Bounds = { west: 2, south: 2, east: 3, north: 3 };

    provider.fitBounds(handle, first);
    provider.fitBounds(handle, second);

    expect(provider.fitBoundsCalls).toEqual([first, second]);
  });

  it('destroy clears bounds listeners so emitBounds delivers to nobody afterwards', async () => {
    const provider = new FakeMapProvider();
    const handle = await provider.mount(document.createElement('div'), { apiKey: 'k' });
    const cb = vi.fn();
    provider.onBoundsChange(handle, cb);

    provider.destroy(handle);
    provider.emitBounds({ west: 0, south: 0, east: 1, north: 1 });

    expect(cb).not.toHaveBeenCalled();
    expect(provider.destroyed).toEqual([handle]);
    expect(provider.destroyCount).toBe(1);
  });

  it('updateMarkerStates records the last selected/hovered ids passed to it', async () => {
    const provider = new FakeMapProvider();
    await provider.mount(document.createElement('div'), { apiKey: 'k' });

    expect(provider.markerStates).toBeNull();

    provider.updateMarkerStates('a', null);
    expect(provider.markerStates).toEqual({ selected: 'a', hovered: null });

    provider.updateMarkerStates(null, 'b');
    expect(provider.markerStates).toEqual({ selected: null, hovered: 'b' });

    provider.updateMarkerStates('c', 'c');
    expect(provider.markerStates).toEqual({ selected: 'c', hovered: 'c' });
  });

  it('mountOverlay returns a container handle, records the overlay, and unmount removes it', async () => {
    const provider = new FakeMapProvider();
    await provider.mount(document.createElement('div'), { apiKey: 'k' });

    expect(provider.overlays).toEqual([]);

    const overlay = provider.mountOverlay({ lat: 10, lng: 20 });

    expect(overlay.container).toBeInstanceOf(HTMLElement);
    expect(provider.overlays).toHaveLength(1);
    expect(provider.overlays[0].position).toEqual({ lat: 10, lng: 20 });

    overlay.setPosition({ lat: 30, lng: 40 });
    expect(provider.overlays[0].position).toEqual({ lat: 30, lng: 40 });

    overlay.unmount();
    expect(provider.overlays).toEqual([]);
  });

  it('zoomIn/zoomOut record each call in order', async () => {
    const provider = new FakeMapProvider();
    await provider.mount(document.createElement('div'), { apiKey: 'k' });

    expect(provider.zoomCalls).toEqual([]);

    provider.zoomIn();
    provider.zoomIn();
    provider.zoomOut();

    expect(provider.zoomCalls).toEqual(['in', 'in', 'out']);
  });

  it('toggleFullscreen increments a counter each time it is called', async () => {
    const provider = new FakeMapProvider();
    await provider.mount(document.createElement('div'), { apiKey: 'k' });

    expect(provider.fullscreenToggles).toBe(0);

    provider.toggleFullscreen();
    expect(provider.fullscreenToggles).toBe(1);

    provider.toggleFullscreen();
    expect(provider.fullscreenToggles).toBe(2);
  });

  it('drives the full mount -> renderLayer -> onBoundsChange -> destroy sequence end to end', async () => {
    const provider = new FakeMapProvider();
    const el = document.createElement('div');
    const opts: MapInitOptions = { apiKey: 'test-key', center: { lat: 0, lng: 0 }, zoom: 8 };

    const handle = await provider.mount(el, opts);
    expect(provider.mounts).toEqual([handle]);

    const layer = makeLayer();
    const unsubscribeLayer = provider.renderLayer(handle, layer);
    expect(provider.renderedLayers).toEqual([layer]);

    const cb = vi.fn();
    const unsubscribeBounds = provider.onBoundsChange(handle, cb);
    const bounds: Bounds = { west: -10, south: -10, east: 10, north: 10 };
    provider.emitBounds(bounds);
    expect(cb).toHaveBeenCalledWith(bounds);

    unsubscribeLayer();
    expect(provider.renderedLayers).toEqual([]);

    unsubscribeBounds();
    provider.emitBounds(bounds);
    expect(cb).toHaveBeenCalledTimes(1); // unsubscribed before this second emit

    provider.destroy(handle);
    provider.emitBounds(bounds);

    expect(cb).toHaveBeenCalledTimes(1); // no delivery after destroy either
    expect(provider.destroyCount).toBe(1);
    expect(provider.destroyed).toEqual([handle]);
  });
});
