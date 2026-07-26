'use client';

import type { IListingCardProps, IListingMarkerProps } from '~/react';
import { cn } from '~/shadcn/utils/cn';

import type { PropertyEntity } from './rental-entity.interface';

/** Formats a whole-dollar rental price as USD, e.g. `2800` -> `"$2,800"`. */
export function formatRentalPrice(price: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(price);
}

function capitalize(value: string): string {
  return value.length ? `${value[0].toUpperCase()}${value.slice(1)}` : value;
}

/**
 * Real-estate `Card` slot matching the production `/find` widget's property
 * card layout: image -> title -> address -> "Type · N bd · N ba" -> price.
 * `item` is `unknown` at this layer (the engine is entity-erased, same
 * reasoning as `DefaultCard` -- see `src/shadcn/default-card.tsx`), so it's
 * read DEFENSIVELY via a cast to `PropertyEntity`, never assumed to be the
 * caller's real `TEntity`. Every field is optional and simply omitted from
 * the render when absent.
 *
 * Mirrors `DefaultCard`'s interactive/non-interactive split: the whole card
 * is a `button` (keyboard operable, `aria-pressed`) when `onSelect` is
 * given, otherwise a non-interactive `<article>` with the same visual
 * classes minus the button/focus/hover-shadow semantics.
 */
export function PropertyCard({ item, selected, onSelect }: IListingCardProps) {
  const property = item as Partial<PropertyEntity> | null;

  const className = cn(
    'flex w-full flex-col overflow-hidden rounded-[10px] border border-border bg-card text-left text-card-foreground',
    'motion-safe:transition-shadow',
    onSelect && 'hover:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
    selected && 'ring-2 ring-ring',
  );

  const content = (
    <>
      {property?.imageUrl ? (
        <img
          src={property.imageUrl}
          alt={property.title ?? ''}
          className="aspect-[4/3] w-full rounded-t-[10px] object-cover"
        />
      ) : (
        <div className="aspect-[4/3] w-full rounded-t-[10px] bg-muted" aria-hidden="true" />
      )}
      <div className="flex flex-1 flex-col gap-1 p-3">
        {property?.title && <span className="text-base font-semibold">{property.title}</span>}
        {property?.address && <span className="text-sm text-muted-foreground">{property.address}</span>}
        {property?.propertyType != null && property.bedrooms != null && property.bathrooms != null && (
          <span className="text-sm text-muted-foreground">
            {capitalize(property.propertyType)} &middot; {property.bedrooms} bd &middot; {property.bathrooms} ba
          </span>
        )}
        {property?.price != null && (
          <span className="mt-1 font-bold tabular-nums">
            {formatRentalPrice(property.price)}{' '}
            <span className="text-sm font-normal text-muted-foreground">/mo</span>
          </span>
        )}
      </div>
    </>
  );

  if (!onSelect) {
    return <article className={className}>{content}</article>;
  }

  return (
    <button type="button" onClick={onSelect} aria-pressed={selected ?? false} className={className}>
      {content}
    </button>
  );
}

/**
 * Real-estate `Marker` slot: a green teardrop price pin (Rentler-style) for
 * a map point -- a rounded pill plus a small rotated-square tail so the
 * marker's visual tip lands on the exact coordinate. Same defensive
 * view-model reasoning as `DefaultMarker` -- `point.entity` is the raw row
 * (`unknown` at this layer), read defensively via a cast. Tailwind-styled by
 * design (not `.rle-*`) -- see `properties-dataset.ts`'s `defaultPriceMarkerElement`
 * for the raw-DOM equivalent used by the map's own marker content, and
 * `StyledMarker` for the `.rle-pin` (Tailwind-free `/styled`) equivalent.
 */
export function PropertyMarker({ point }: IListingMarkerProps) {
  const property = point.entity as Partial<PropertyEntity> | null;

  return (
    <span className="relative inline-flex items-center whitespace-nowrap rounded-full bg-primary px-2.5 py-1 text-xs font-bold tabular-nums text-primary-foreground shadow">
      {property?.price != null ? formatRentalPrice(property.price) : ''}
      <span
        aria-hidden="true"
        className="absolute -bottom-[3px] left-1/2 h-2 w-2 -translate-x-1/2 rotate-45 rounded-br-[2px] bg-primary"
      />
    </span>
  );
}
