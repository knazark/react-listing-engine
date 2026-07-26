import { ListingApp } from 'react-listing-engine';
import {
  PropertyCard,
  PropertyMarker,
  nearbyBusinessesDataset,
  propertiesDataset,
  rentalFiltersFromQuery,
  rentalFiltersToQuery,
  withRentalFilters,
  type PropertyEntity,
  type RentalFilters,
} from 'react-listing-engine/presets/rental';

import { mockBusinessesApi, mockPropertiesApi } from '../mock-data';
import { MapKeyNotice } from '../map-key-notice';

const googleMapsKey = import.meta.env.VITE_GOOGLE_MAPS_KEY;

// DATA, not code -- per-category marker icons for the nearby-businesses
// layer. New category = new map entry, no library change (see
// `nearbyBusinessesDataset`'s doc comment).
const BUSINESS_ICONS: Record<string, string> = {
  grocery: 'https://maps.google.com/mapfiles/ms/icons/grocery.png',
  shopping: 'https://maps.google.com/mapfiles/ms/icons/shopping.png',
  restaurants: 'https://maps.google.com/mapfiles/ms/icons/restaurant.png',
  schools: 'https://maps.google.com/mapfiles/ms/icons/schools.png',
  hospitals: 'https://maps.google.com/mapfiles/ms/icons/hospitals.png',
  parks: 'https://maps.google.com/mapfiles/ms/icons/parks.png',
  gyms: 'https://maps.google.com/mapfiles/ms/icons/sportsactivities.png',
  cafes: 'https://maps.google.com/mapfiles/ms/icons/cafe.png',
};

/** Same event-based URL write-back as `PropertiesOnlyScenario` -- see that scenario's doc comment. */
function onFiltersChange(filters: RentalFilters): void {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(rentalFiltersToQuery(filters))) {
    if (value !== undefined) params.set(key, value);
  }
  const qs = params.toString();
  window.history.replaceState(null, '', qs ? `?${qs}` : window.location.pathname);
}

/**
 * Scenario 2: `ListingApp` again (the package's main-entry, `/styled`
 * default), this time with TWO marker layers on one map -- the primary
 * `properties` dataset (drives the results list + pagination, since
 * `ListingApp.datasets` is added in order and the FIRST entry is primary)
 * plus a second `businesses` layer registered purely for the map (nearby
 * amenities), proving `nearbyBusinessesDataset` composes as a second
 * `DatasetDefinition` alongside `propertiesDataset` with zero core changes.
 *
 * Same `components` merge, event-based `initialFilters`/`onFiltersChange`
 * URL wiring, `mobileAction`, and initial SF `map.center`/`zoom` as
 * `PropertiesOnlyScenario` -- see that scenario's doc comment for the full
 * reasoning. The businesses layer's map pins are driven entirely by
 * `BUSINESS_ICONS`/`nearbyBusinessesDataset`'s `marker.iconUrl`, not by the
 * `Marker` slot override -- `ListingMap` doesn't render the injected
 * `Marker`/`Popup` components yet (documented future enhancement in
 * `listing-map.tsx`), so this wiring is forward-looking.
 */
export function PropertiesAndBusinessesScenario() {
  const initialFilters = rentalFiltersFromQuery(Object.fromEntries(new URLSearchParams(window.location.search)));

  return (
    <div className="flex h-full min-h-0 flex-col">
      {!googleMapsKey && <MapKeyNotice />}
      <div className="min-h-0 flex-1">
        <ListingApp<PropertyEntity, RentalFilters>
          datasets={[
            propertiesDataset(mockPropertiesApi),
            nearbyBusinessesDataset(mockBusinessesApi, { icons: BUSINESS_ICONS }),
          ]}
          filters={withRentalFilters()}
          map={
            googleMapsKey
              ? { apiKey: googleMapsKey, mapId: 'DEMO_MAP_ID', center: { lat: 37.76, lng: -122.44 }, zoom: 12 }
              : undefined
          }
          components={{ Card: PropertyCard, Marker: PropertyMarker }}
          initialFilters={initialFilters}
          onFiltersChange={onFiltersChange}
          mobileAction={{ label: 'Add', onClick: () => alert('Add listing (demo)') }}
        />
      </div>
    </div>
  );
}
