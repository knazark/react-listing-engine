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
  /** Records each `zoomIn`/`zoomOut` call, in order, for assertions. */
  readonly zoomCalls: Array<'in' | 'out'> = [];
  /** Counts `toggleFullscreen` calls. */
  fullscreenToggles = 0;
  /**
   * The Fullscreen API target recorded from the most recent `mount()` call -- mirrors the real
   * `googleProvider`'s `opts.fullscreenTarget ?? el` resolution (see
   * `MapInitOptions.fullscreenTarget`'s doc comment), so a test can assert which element a caller
   * (e.g. `ListingMap`) passed as the fullscreen target -- the OUTER wrapper that also contains
   * the `mapControls` overlay, not the map mount `el` alone.
   */
  fullscreenTarget: HTMLElement | undefined;

  private readonly boundsListeners = new Set<BoundsListener>();
  private readonly mapClickListeners = new Set<() => void>();

  mount(el: HTMLElement, opts: MapInitOptions): MapHandle {
    const handle: MapHandle = { raw: { el, opts }, nativeMap: { el, opts } };
    this.mounts.push(handle);
    this.fullscreenTarget = opts.fullscreenTarget ?? el;
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

  onMapClick(cb: () => void): Unsubscribe {
    this.mapClickListeners.add(cb);
    return () => {
      this.mapClickListeners.delete(cb);
    };
  }

  /** Test-only: simulates a click on the map background by invoking every registered map-click listener. */
  emitMapClick(): void {
    for (const cb of this.mapClickListeners) {
      cb();
    }
  }

  fitBounds(_handle: MapHandle, b: Bounds, _options?: FitBoundsOptions): void {
    this.fitBoundsCalls.push(b);
  }

  destroy(handle: MapHandle): void {
    this.destroyed.push(handle);
    this.destroyCount += 1;
    this.boundsListeners.clear();
    this.mapClickListeners.clear();
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

  zoomIn(): void {
    this.zoomCalls.push('in');
  }

  zoomOut(): void {
    this.zoomCalls.push('out');
  }

  toggleFullscreen(): void {
    this.fullscreenToggles += 1;
    // Mirrors the real `googleProvider`'s guarded, feature-detected call against the resolved
    // fullscreen target -- never throws when `requestFullscreen` is absent (e.g. this project's
    // happy-dom test DOM, or a plain `vi.fn()` stub that doesn't return a promise). Unlike the
    // real provider, this fake never tracks enter/exit state -- it's only used to assert WHICH
    // element a caller targeted, not to simulate the full toggle lifecycle.
    if (this.fullscreenTarget && typeof this.fullscreenTarget.requestFullscreen === 'function') {
      void this.fullscreenTarget.requestFullscreen()?.catch(() => {});
    }
  }
}
