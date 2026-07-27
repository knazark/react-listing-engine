import type { Bounds, EntityId, LatLng } from './entity-adapter.interface';

/**
 * Providers that need an API key take it via their factory (e.g. `googleProvider({ apiKey })`),
 * not per-mount.
 */
export interface MapInitOptions { apiKey?: string; center?: LatLng; zoom?: number; }
export interface MapHandle { readonly raw: unknown; }
export interface RenderedLayer {
  id: string;
  markers: Array<{ id: string | number; position: LatLng; iconUrl?: string; element?: HTMLElement }>;
  clustering?: { maxZoom?: number } | false;
  onMarkerClick?(id: string | number): void;
}
export type Unsubscribe = () => void;
export interface MapProvider {
  mount(el: HTMLElement, opts: MapInitOptions): Promise<MapHandle> | MapHandle;
  renderLayer(handle: MapHandle, layer: RenderedLayer): Unsubscribe;
  onBoundsChange(handle: MapHandle, cb: (b: Bounds) => void): Unsubscribe;
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
}
