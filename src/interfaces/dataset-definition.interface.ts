import type { EntityAdapter } from './entity-adapter.interface';

export interface ClusterOptions { maxZoom?: number; radius?: number; }
export interface MarkerRenderer<TEntity> {
  iconUrl?(entity: TEntity): string;
  element?(entity: TEntity): HTMLElement;
  onClick?(entity: TEntity): void;
}
export interface DatasetDefinition<TEntity, TFilters> {
  id: string;
  adapter: EntityAdapter<TEntity, TFilters>;
  marker: MarkerRenderer<TEntity>;
  clustering?: ClusterOptions | false;
  visible?: () => boolean;
}
