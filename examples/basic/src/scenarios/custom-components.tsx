import {
  composeListingProviders,
  ListingComponentsProvider,
  ListingProvider,
  withDataset,
  withFilters,
  type IListingCardProps,
  type IListingEmptyProps,
} from 'react-listing-engine';
import { ListingLayout } from 'react-listing-engine/shadcn';
import { propertiesDataset, withRentalFilters, type PropertyEntity, type RentalFilters } from 'react-listing-engine/presets/rental';

import { mockPropertiesApi } from '../mock-data';

/**
 * App-authored `Card` slot -- deliberately styled nothing like `DefaultCard`
 * (a horizontal row with a colored price chip instead of a vertical image
 * card) to make the swap visually obvious. `item` is `unknown` at this layer
 * (the engine is entity-erased), so it's read defensively via a cast, same
 * pattern as the package's own `DefaultCard`.
 */
function CustomPropertyCard({ item, selected, onSelect }: IListingCardProps) {
  const property = item as Partial<PropertyEntity> | null;
  if (!property) return null;

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected ?? false}
      className={`mb-2 flex w-full items-center justify-between gap-3 rounded-none border-l-4 bg-secondary px-4 py-3 text-left ${
        selected ? 'border-l-primary' : 'border-l-transparent'
      }`}
    >
      <div className="flex flex-col">
        <span className="text-sm font-semibold uppercase tracking-wide text-secondary-foreground">
          {property.title}
        </span>
        <span className="text-xs text-muted-foreground">
          {property.bedrooms} bd &middot; {property.bathrooms} ba &middot; {property.propertyType}
        </span>
      </div>
      <span className="shrink-0 rounded-full bg-primary px-3 py-1 text-xs font-bold tabular-nums text-primary-foreground">
        ${property.price?.toLocaleString()}
      </span>
    </button>
  );
}

/** App-authored `Empty` slot -- proves the injected component (not the package's `DefaultEmpty`) renders when results are empty. */
function CustomEmptyState(_props: IListingEmptyProps) {
  return (
    <div className="flex flex-col items-center gap-1 border-2 border-dashed border-border p-10 text-center">
      <p className="text-sm font-bold text-foreground">Nothing matched (custom Empty slot)</p>
      <p className="text-xs text-muted-foreground">This is an app-authored component, not the package's DefaultEmpty.</p>
    </div>
  );
}

/**
 * Scenario 3: `ListingComponentsProvider` used directly (not
 * `ListingComponentsProviderWithDefaults`) with only `Card` and `Empty`
 * overridden -- every other slot (Sidebar, FilterPanel, Search, Loading,
 * ResultHeader, Toolbar, Marker, Popup) falls back to the package's
 * internal UNSTYLED fallbacks, which is deliberate here: it makes the
 * override boundary visually obvious (the two overridden slots look
 * custom-designed; everything else looks bare) and proves per-slot
 * injection is real, not just a themed reskin.
 */
export function CustomComponentsScenario() {
  return (
    <ListingProvider<PropertyEntity, RentalFilters>
      {...composeListingProviders<RentalFilters>(
        withDataset(propertiesDataset(mockPropertiesApi)),
        withFilters(withRentalFilters()),
      )}
    >
      <ListingComponentsProvider Card={CustomPropertyCard} Empty={CustomEmptyState}>
        <ListingLayout />
      </ListingComponentsProvider>
    </ListingProvider>
  );
}
