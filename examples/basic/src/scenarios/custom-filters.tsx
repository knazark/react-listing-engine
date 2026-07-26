import type { ChangeEvent } from 'react';

import {
  composeListingProviders,
  ListingProvider,
  withDataset,
  withFilters,
  type FilterControlProps,
  type FilterDefinition,
  type FilterRegistry,
} from 'react-listing-engine';
import { ListingComponentsProviderWithDefaults, ListingLayout } from 'react-listing-engine/shadcn';
import {
  propertiesDataset,
  withRentalFilters,
  type PropertyEntity,
  type PropertyType,
  type RentalFilters,
} from 'react-listing-engine/presets/rental';

import { mockPropertiesApi } from '../mock-data';

/** Unstyled control for the custom "houses only" filter -- a single checkbox. */
function HousesOnlyControl({ value, onChange }: FilterControlProps<boolean>) {
  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    onChange(event.target.checked);
  };

  return (
    <label className="flex items-center gap-2 text-sm">
      <input type="checkbox" checked={value} onChange={handleChange} />
      Houses only
    </label>
  );
}

// A custom `FilterDefinition` the app authored itself -- maps to the
// EXISTING `propertyTypes` field of `RentalFilters` (a shortcut over the
// shipped `propertyType` checkbox group), proving a consumer can add
// arbitrary filter UI without needing a new `TFilters` field or any core
// change.
const housesOnlyFilter: FilterDefinition<RentalFilters, boolean> = {
  key: 'housesOnly',
  order: 0, // overwritten by reorder() below; the registry is the source of truth for order
  render: HousesOnlyControl,
  toParams: (value): Partial<RentalFilters> => ({ propertyTypes: value ? (['house'] as PropertyType[]) : undefined }),
  fromParams: filters => (filters.propertyTypes?.length === 1 && filters.propertyTypes[0] === 'house'),
  isActive: filters => filters.propertyTypes?.length === 1 && filters.propertyTypes[0] === 'house',
};

/**
 * Registers the 5 shipped rental filters, then mutates the registry
 * programmatically: `add`s a custom filter, `remove`s the shipped keyword
 * search, and `reorder`s so the new custom filter and property-type filter
 * lead. Passed straight into `withFilters`, exercising the full
 * `FilterRegistry` mutation surface end to end.
 */
function customizeFilters(registry: FilterRegistry<RentalFilters>): void {
  withRentalFilters()(registry);
  registry.add(housesOnlyFilter);
  registry.remove('keyword');
  registry.reorder(['housesOnly', 'propertyType', 'price', 'beds', 'baths']);
}

/**
 * Scenario 4: proves `FilterRegistry.add` / `.remove` / `.reorder` via a
 * `withFilters(reg => ...)` callback that starts from the shipped rental
 * filter set and mutates it -- rather than a scenario that only ever calls
 * `withRentalFilters()` verbatim like scenario 1.
 */
export function CustomFiltersScenario() {
  return (
    <ListingProvider<PropertyEntity, RentalFilters>
      {...composeListingProviders<RentalFilters>(withDataset(propertiesDataset(mockPropertiesApi)), withFilters(customizeFilters))}
    >
      <ListingComponentsProviderWithDefaults>
        <ListingLayout />
      </ListingComponentsProviderWithDefaults>
    </ListingProvider>
  );
}
