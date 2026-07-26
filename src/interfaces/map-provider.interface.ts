import type { Bounds, LatLng } from './entity-adapter.interface';

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
}
