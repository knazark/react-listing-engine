import type { FilterRegistry } from '~/core';
import type { FilterDefinition } from '~/interfaces';

import { KeywordFilterControl } from './controls/keyword-filter.control';
import { PropertyTypeFilterControl } from './controls/property-type-filter.control';
import { RangeFilterControl } from './controls/range-filter.control';
import type { PropertyType, RangeValue, RentalFilters } from './rental-entity.interface';

const priceFilter = {
  key: 'price',
  order: 10,
  label: 'Price',
  render: RangeFilterControl,
  toParams: (value: RangeValue): Partial<RentalFilters> => ({ minPrice: value.min, maxPrice: value.max }),
  fromParams: (filters: RentalFilters): RangeValue => ({ min: filters.minPrice, max: filters.maxPrice }),
  isActive: (filters: RentalFilters) => filters.minPrice != null || filters.maxPrice != null,
} satisfies FilterDefinition<RentalFilters, RangeValue>;

const bedsFilter = {
  key: 'beds',
  order: 20,
  label: 'Bedrooms',
  render: RangeFilterControl,
  toParams: (value: RangeValue): Partial<RentalFilters> => ({ minBeds: value.min, maxBeds: value.max }),
  fromParams: (filters: RentalFilters): RangeValue => ({ min: filters.minBeds, max: filters.maxBeds }),
  isActive: (filters: RentalFilters) => filters.minBeds != null || filters.maxBeds != null,
} satisfies FilterDefinition<RentalFilters, RangeValue>;

const bathsFilter = {
  key: 'baths',
  order: 30,
  label: 'Bathrooms',
  render: RangeFilterControl,
  toParams: (value: RangeValue): Partial<RentalFilters> => ({ minBaths: value.min, maxBaths: value.max }),
  fromParams: (filters: RentalFilters): RangeValue => ({ min: filters.minBaths, max: filters.maxBaths }),
  isActive: (filters: RentalFilters) => filters.minBaths != null || filters.maxBaths != null,
} satisfies FilterDefinition<RentalFilters, RangeValue>;

const propertyTypeFilter = {
  key: 'propertyType',
  order: 40,
  label: 'Property type',
  render: PropertyTypeFilterControl,
  toParams: (value: PropertyType[]): Partial<RentalFilters> => ({ propertyTypes: value.length ? value : undefined }),
  fromParams: (filters: RentalFilters): PropertyType[] => filters.propertyTypes ?? [],
  isActive: (filters: RentalFilters) => (filters.propertyTypes?.length ?? 0) > 0,
} satisfies FilterDefinition<RentalFilters, PropertyType[]>;

const keywordFilter = {
  key: 'keyword',
  order: 50,
  label: 'Keyword',
  render: KeywordFilterControl,
  toParams: (value: string): Partial<RentalFilters> => ({ keyword: value || undefined }),
  fromParams: (filters: RentalFilters): string => filters.keyword ?? '',
  isActive: (filters: RentalFilters) => !!filters.keyword,
} satisfies FilterDefinition<RentalFilters, string>;

/**
 * Porting today's `/find` widget's fixed filter set (price, beds/baths,
 * property-type, keyword) to `FilterDefinition`s. Each `render` is an
 * unstyled control from `./controls/*`; consumers restyle/replace via
 * `FilterRegistry.replace()`.
 *
 * `render`'s `ComponentType<FilterControlProps<TValue>>` is (correctly)
 * contravariant in `TValue`, so this heterogeneous array of concretely-typed
 * defs can't assign element-by-element into `FilterDefinition<RentalFilters>[]`
 * (TValue defaults to `unknown`) without a cast -- `FilterRegistry` hits the
 * identical shape and resolves it by storing defs as `..., any>` internally
 * (see `core/registries/filter-registry.ts`); same fix here, scoped to this
 * one array literal. The exported type stays `FilterDefinition<RentalFilters>[]`,
 * `any`-free.
 */
export const rentalFilters: FilterDefinition<RentalFilters>[] = [
  priceFilter,
  bedsFilter,
  bathsFilter,
  propertyTypeFilter,
  keywordFilter,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
] as FilterDefinition<RentalFilters, any>[];

/** `withFilters(withRentalFilters())` registers all 5 rental filters, in order, on a fresh or existing `FilterRegistry`. */
export function withRentalFilters(): (registry: FilterRegistry<RentalFilters>) => void {
  return registry => {
    rentalFilters.forEach(filter => registry.add(filter));
  };
}
