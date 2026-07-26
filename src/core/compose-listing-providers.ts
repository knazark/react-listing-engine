import type { DatasetDefinition, IListingConfigOptions, MapProvider } from '~/interfaces';

import { DatasetRegistry, FilterRegistry } from './registries';
import type { UrlSyncController } from './strategies';

/**
 * Aggregated provider props — the composition entry point of
 * react-listing-engine, mirroring `react-wizard-engine`'s
 * `composeWizardProviders` mutator pattern exactly (see that package's
 * `src/core/compose-wizard-providers.ts`). Built up by chaining `with*`
 * helpers via `composeListingProviders(...)`. A future React provider
 * consumes these props to construct `new ListingEngine(...)` (datasets,
 * filters, config, map, initialFilters, primaryDatasetId) and wire up an
 * optional `UrlSyncController` on top of it.
 *
 * Parameterized by `TFilters` only, not `TEntity` — same reasoning as
 * `ListingEngineOptions`: `datasets` is entity-erased
 * (`DatasetRegistry<unknown, TFilters>`) because one registry instance holds
 * heterogeneous layers (a properties layer and a businesses layer have
 * different entity types).
 */
export interface IListingProviderProps<TFilters> {
  config: Partial<IListingConfigOptions>;
  filters: FilterRegistry<TFilters>;
  datasets: DatasetRegistry<unknown, TFilters>;
  map?: MapProvider;
  urlSync?: UrlSyncController<TFilters>;
  initialFilters?: TFilters;
  primaryDatasetId?: string;
}

/**
 * Modifier function — receives the props in flight, mutates them, returns
 * void. Each `with*` helper returns one of these.
 */
export type ListingProviderMod<TFilters> = (props: IListingProviderProps<TFilters>) => void;

export function composeListingProviders<TFilters>(
  ...mods: Array<ListingProviderMod<TFilters>>
): IListingProviderProps<TFilters> {
  const props: IListingProviderProps<TFilters> = {
    config: {},
    filters: new FilterRegistry<TFilters>(),
    datasets: new DatasetRegistry<unknown, TFilters>(),
  };

  for (const mod of mods) {
    mod(props);
  }

  return props;
}

export const withConfig =
  <TFilters>(options: Partial<IListingConfigOptions>): ListingProviderMod<TFilters> =>
  props => {
    props.config = { ...props.config, ...options };
  };

export const withMap =
  <TFilters>(provider: MapProvider): ListingProviderMod<TFilters> =>
  props => {
    props.map = provider;
  };

// `TEntity` is generic per-call (not shared across `IListingProviderProps`)
// so two `withDataset` calls for the same `TFilters` can register layers of
// different entity types into the one entity-erased `DatasetRegistry`. This
// relies on `DatasetDefinition<TEntity, TFilters>` being assignable to
// `DatasetDefinition<unknown, TFilters>` — verified true for the current
// (non-generic) `DatasetRegistry.add` because `MarkerRenderer<TEntity>`'s
// members are method-shorthand (bivariant parameter checking), so no
// variance fix to `DatasetRegistry` was needed here.
export const withDataset =
  <TEntity, TFilters>(def: DatasetDefinition<TEntity, TFilters>): ListingProviderMod<TFilters> =>
  props => {
    props.datasets.add(def);
  };

export const withFilters =
  <TFilters>(fn: (reg: FilterRegistry<TFilters>) => void): ListingProviderMod<TFilters> =>
  props => {
    fn(props.filters);
  };

export const withUrlSync =
  <TFilters>(controller: UrlSyncController<TFilters>): ListingProviderMod<TFilters> =>
  props => {
    props.urlSync = controller;
  };

export const withInitialFilters =
  <TFilters>(filters: TFilters): ListingProviderMod<TFilters> =>
  props => {
    props.initialFilters = filters;
  };

export const withPrimaryDataset =
  <TFilters>(id: string): ListingProviderMod<TFilters> =>
  props => {
    props.primaryDatasetId = id;
  };
