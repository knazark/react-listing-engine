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

type BoundsListener = (b: Bounds) => void;

/** One live overlay record kept by `FakeMapProvider.mountOverlay` for assertions. */
interface FakeOverlay {
  container: HTMLElement;
  position: LatLng;
}

/**
 * Headless in-memory `MapProvider` test double. Records everything it is
 * asked to do (mounts, rendered layers, fitBounds calls, destroys) into
 * public arrays/counters, and exposes `emitBounds()` so a test can simulate
 * a user pan/zoom without a real map SDK or browser.
 */
export class FakeMapProvider implements MapProvider {
  readonly mounts: MapHandle[] = [];
  readonly renderedLayers: RenderedLayer[] = [];
  readonly removedLayers: RenderedLayer[] = [];
  readonly fitBoundsCalls: Bounds[] = [];
  readonly destroyed: MapHandle[] = [];
  destroyCount = 0;
  /** Records the most recent `updateMarkerStates` call -- `null` until it is first called. */
  markerStates: { selected: EntityId | null; hovered: EntityId | null } | null = null;
  /**
   * Currently-live overlays created via `mountOverlay` (removed on `unmount`),
   * newest last -- lets a test assert an overlay was mounted/anchored/torn down.
   */
  readonly overlays: FakeOverlay[] = [];

  private readonly boundsListeners = new Set<BoundsListener>();

  mount(el: HTMLElement, opts: MapInitOptions): MapHandle {
    const handle: MapHandle = { raw: { el, opts } };
    this.mounts.push(handle);
    return handle;
  }

  renderLayer(_handle: MapHandle, layer: RenderedLayer): Unsubscribe {
    this.renderedLayers.push(layer);
    let removed = false;
    return () => {
      if (removed) return;
      removed = true;
      const index = this.renderedLayers.indexOf(layer);
      if (index !== -1) {
        this.renderedLayers.splice(index, 1);
        this.removedLayers.push(layer);
      }
    };
  }

  onBoundsChange(_handle: MapHandle, cb: BoundsListener): Unsubscribe {
    this.boundsListeners.add(cb);
    return () => {
      this.boundsListeners.delete(cb);
    };
  }

  /** Test-only: simulates a user pan/zoom by invoking every registered bounds listener. */
  emitBounds(b: Bounds): void {
    for (const cb of this.boundsListeners) {
      cb(b);
    }
  }

  fitBounds(_handle: MapHandle, b: Bounds): void {
    this.fitBoundsCalls.push(b);
  }

  destroy(handle: MapHandle): void {
    this.destroyed.push(handle);
    this.destroyCount += 1;
    this.boundsListeners.clear();
  }

  updateMarkerStates(selectedId: EntityId | null, hoveredId: EntityId | null): void {
    this.markerStates = { selected: selectedId, hovered: hoveredId };
  }

  // Creates a real (detached) container and appends it to `document.body` so
  // React content portal'd into it is queryable via Testing Library's
  // `screen`; records it in `overlays` and drops it on `unmount`.
  mountOverlay(position: LatLng): MapOverlayHandle {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const record: FakeOverlay = { container, position };
    this.overlays.push(record);
    return {
      container,
      setPosition: (next: LatLng) => {
        record.position = next;
      },
      unmount: () => {
        container.remove();
        const index = this.overlays.indexOf(record);
        if (index !== -1) this.overlays.splice(index, 1);
      },
    };
  }
}
