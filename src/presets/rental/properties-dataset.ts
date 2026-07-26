import type { Bounds, DatasetDefinition, EntityId, Page, PageRequest } from '~/interfaces';

import { formatRentalPrice } from './property-card.component';
import type { PropertyEntity, RentalFilters } from './rental-entity.interface';

/**
 * The "port" the CONSUMER implements against their real API (e.g. the app's
 * `LocaListingApi`) -- this preset never imports an HTTP client itself. `list`
 * feeds the paginated results list, `search` feeds the map (bounds-scoped,
 * no pagination), `getById` is optional (deep-link / selection lookups).
 */
export interface PropertiesApiPort {
  list(filters: RentalFilters, page: PageRequest): Promise<Page<PropertyEntity>>;
  search(filters: RentalFilters, bounds: Bounds): Promise<PropertyEntity[]>;
  getById?(id: EntityId): Promise<PropertyEntity>;
}

export interface PropertiesDatasetOptions {
  onClick?(property: PropertyEntity): void;
  iconUrl?(property: PropertyEntity): string;
  /**
   * Builds the `AdvancedMarkerElement` content for a property's map pin.
   * Defaults to `defaultPriceMarkerElement` (a green teardrop price pin
   * showing `formatRentalPrice(property.price)`) when omitted -- pass this
   * to replace the pin entirely with a custom marker.
   */
  element?(property: PropertyEntity): HTMLElement;
}

/**
 * Default `marker.element` builder: a raw DOM teardrop price PIN
 * (`formatRentalPrice(entity.price)` in a rounded pill, plus a small
 * rotated-square pointer tail so the marker's visual tip lands on the exact
 * coordinate -- Rentler-style) for the map's `AdvancedMarkerElement` content
 * -- `GoogleMapsProvider` prefers `element` over `iconUrl` (see
 * `google-maps.provider.ts`) when both are set.
 *
 * Built with `document.createElement` rather than React because map markers
 * are raw DOM nodes, not React elements (rendering the injected `Marker`
 * React component INTO a real marker via a portal is a documented future
 * enhancement -- see `listing-map.tsx`'s doc comment). Since this element is
 * constructed at runtime, Tailwind's build-time content scanner can't see
 * the `className` strings below to generate their CSS, so the classes are
 * kept (any consumer app that DOES happen to scan this file's literal
 * strings, e.g. via a broad `content` glob, gets real utility classes) but
 * are backed by the same values set directly as inline styles on both the
 * pill and its pointer child, so the pin renders correctly with zero
 * build-time cooperation from the consumer's Tailwind config. Mirrors
 * `.rle-pin`/`.rle-pin::after` in `src/styled/styles.css` (the `/styled`
 * equivalent for `StyledMarker`) -- a pseudo-element isn't an option here
 * since inline styles can't target `::after` on a JS-constructed node, so
 * the pointer is a real child element instead.
 */
export function defaultPriceMarkerElement(property: PropertyEntity): HTMLElement {
  const pin = document.createElement('div');
  pin.className =
    'relative inline-flex items-center whitespace-nowrap rounded-full bg-primary px-2.5 py-1 text-xs font-bold text-primary-foreground shadow';
  pin.textContent = formatRentalPrice(property.price);

  pin.style.position = 'relative';
  pin.style.display = 'inline-flex';
  pin.style.alignItems = 'center';
  pin.style.whiteSpace = 'nowrap';
  pin.style.borderRadius = '9999px';
  pin.style.backgroundColor = 'var(--primary, #16a34a)';
  pin.style.color = 'var(--primary-foreground, #ffffff)';
  pin.style.padding = '4px 10px';
  pin.style.fontSize = '12px';
  pin.style.fontWeight = '700';
  pin.style.fontFamily = 'inherit';
  pin.style.boxShadow = '0 1px 2px rgba(0, 0, 0, 0.3)';

  const pointer = document.createElement('span');
  pointer.className = 'absolute -bottom-[3px] left-1/2 h-2 w-2 -translate-x-1/2 rotate-45 rounded-br-[2px] bg-primary';
  pointer.style.position = 'absolute';
  pointer.style.left = '50%';
  pointer.style.bottom = '-3px';
  pointer.style.width = '8px';
  pointer.style.height = '8px';
  pointer.style.borderRadius = '0 0 2px 0';
  pointer.style.backgroundColor = 'var(--primary, #16a34a)';
  pointer.style.transform = 'translateX(-50%) rotate(45deg)';

  pin.appendChild(pointer);
  return pin;
}

/**
 * Wraps a `PropertiesApiPort` into a `DatasetDefinition` -- the properties
 * marker layer. Row -> `MapPoint` mapping reads `entity.coordinates`
 * directly; no other core/library change is needed to add this layer to a
 * listing.
 */
export function propertiesDataset(
  api: PropertiesApiPort,
  opts?: PropertiesDatasetOptions,
): DatasetDefinition<PropertyEntity, RentalFilters> {
  const getById = api.getById;
  return {
    id: 'properties',
    adapter: {
      list: (filters, page) => api.list(filters, page),
      getPoints: (filters, bounds) =>
        api.search(filters, bounds).then(rows => rows.map(row => ({ id: row.id, position: row.coordinates, entity: row }))),
      getById: getById ? (id: EntityId) => getById(id) : undefined,
    },
    marker: {
      iconUrl: opts?.iconUrl,
      element: opts?.element ?? defaultPriceMarkerElement,
      onClick: opts?.onClick,
    },
    clustering: { maxZoom: 14 },
  };
}
