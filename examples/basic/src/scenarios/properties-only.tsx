import { ListingApp } from 'react-listing-engine';
import {
  PropertyCard,
  PropertyMarker,
  propertiesDataset,
  rentalFiltersFromQuery,
  rentalFiltersToQuery,
  withRentalFilters,
  type PropertyEntity,
  type RentalFilters,
} from 'react-listing-engine/presets/rental';

import { mockPropertiesApi } from '../mock-data';
import { MapKeyNotice } from '../map-key-notice';

const googleMapsKey = import.meta.env.VITE_GOOGLE_MAPS_KEY;

/**
 * EVENT-BASED URL API, consumer side: `ListingApp` never reads/writes
 * `window.location`/`window.history` itself (see its `initialFilters`/
 * `onFiltersChange` doc comments) -- this app owns that instead, with a
 * plain `history.replaceState` (any router's equivalent -- Next's
 * `router.replace`, React Router's `setSearchParams`, ... -- would slot in
 * here identically). `replaceState` (not `pushState`) so every filter tweak
 * overwrites the current entry rather than growing the back-button stack,
 * matching the old `rentalUrlSync()`'s default `mode: 'replace'`.
 */
function onFiltersChange(filters: RentalFilters): void {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(rentalFiltersToQuery(filters))) {
    if (value !== undefined) params.set(key, value);
  }
  const qs = params.toString();
  window.history.replaceState(null, '', qs ? `?${qs}` : window.location.pathname);
}

/**
 * Scenario 1: the turnkey `ListingApp` imported from the package's
 * MAIN entry (`react-listing-engine`, not `react-listing-engine/shadcn`) --
 * the self-contained, Tailwind-free `/styled` adapter is the default export
 * now. One call composes the dataset, the shipped rental filter set, the map
 * (env-guarded Google Maps key, `apiKey` shorthand -> `googleProvider`
 * internally, with an initial `center`/`zoom` over San Francisco -- where
 * `mockPropertiesApi`'s rows live -- so the pre-load view is never open
 * ocean), and the rental preset's `PropertyCard`/`PropertyMarker` slot
 * overrides layered over the rest of the `/styled` defaults (see
 * `ListingApp`'s own doc comment for how `components` merges OVER those
 * defaults instead of resetting every un-overridden slot).
 *
 * URL sync is EVENT-BASED, not internal: `initialFilters` (below) reads the
 * CURRENT `window.location.search` once per mount -- computed inline in the
 * component body (not module scope) so remounting this scenario (e.g.
 * switching tabs and back, in this demo's tab-driven `App`) re-hydrates from
 * whatever the URL holds AT THAT MOMENT, the same "fresh read at mount"
 * behavior the old `rentalUrlSync({ hydrateOnStart: true })` gave for free.
 * `onFiltersChange` (module-scope, above) is the other half: it fires every
 * time the engine's filters change and writes them back out via
 * `history.replaceState` -- `ListingApp`/the engine underneath it never
 * touch `window.history` on their own. `mobileAction` demonstrates the
 * mobile bottom-nav "Add" button now exposed directly as a `ListingApp` prop.
 */
export function PropertiesOnlyScenario() {
  const initialFilters = rentalFiltersFromQuery(Object.fromEntries(new URLSearchParams(window.location.search)));

  return (
    <div className="flex h-full min-h-0 flex-col">
      {!googleMapsKey && <MapKeyNotice />}
      <div className="min-h-0 flex-1">
        <ListingApp<PropertyEntity, RentalFilters>
          datasets={[propertiesDataset(mockPropertiesApi)]}
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
