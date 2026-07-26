import type { Bounds, EntityId, LatLng } from '~/interfaces';

export type PropertyType = 'house' | 'apartment' | 'condo' | 'townhouse' | 'land';

/**
 * Mapped from the app's `@libs/core-base` `Listing` shape (nested
 * `property.coordinates`) -- not the old flat `/find` DTO. See design doc
 * D6/#11.
 */
export interface PropertyEntity {
  id: EntityId;
  title: string;
  address?: string;
  coordinates: LatLng;
  price: number;
  bedrooms: number;
  bathrooms: number;
  propertyType: PropertyType;
  imageUrl?: string;
}

export interface RentalFilters {
  minPrice?: number;
  maxPrice?: number;
  minBeds?: number;
  maxBeds?: number;
  minBaths?: number;
  maxBaths?: number;
  propertyTypes?: PropertyType[];
  keyword?: string;
  bounds?: Bounds;
}

/** Generic min/max shape shared by every range-style filter control (price, beds, baths). */
export interface RangeValue {
  min?: number;
  max?: number;
}
