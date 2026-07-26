'use client';

import type { IListingCardProps } from '~/react';

import { cn } from './utils/cn';

// Common view-model shape the default card knows how to render. The engine
// is entity-erased at this layer (`item: unknown`, same reasoning as every
// other slot -- see components-provider.tsx's docstring), so this is read
// DEFENSIVELY via a cast, never assumed to be the caller's real TEntity.
// Every field is optional and simply omitted from the render when absent.
interface IListingCardViewModel {
  title?: string;
  subtitle?: string;
  imageUrl?: string;
  price?: string | number;
  badge?: string;
}

/** Currency-formats a numeric price (`1200` -> `"$1,200"`); a string price is passed through as-is (caller already formatted it). */
function formatCardPrice(price: string | number): string {
  if (typeof price !== 'number') return price;
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(
    price,
  );
}

/**
 * Default styled `Card` slot. Renders an optional image, title, subtitle,
 * price and badge from a plain view-model item, and doubles as the
 * clickable/selectable surface (`onSelect`) -- when `onSelect` is provided
 * the card is a `button` rather than a `div` + click handler so it is
 * keyboard operable and announces as a toggle (`aria-pressed`) for free.
 * When `onSelect` is absent (display-only usage) it renders as a
 * non-interactive `<article>` with the same visual classes, minus the
 * button/focus/aria-pressed semantics -- so a purely presentational card
 * doesn't add a no-op tab stop.
 */
export function DefaultCard({ item, selected, onSelect }: IListingCardProps) {
  const vm = (item ?? {}) as Partial<IListingCardViewModel>;

  const className = cn(
    'flex w-full flex-col overflow-hidden rounded-lg border bg-card text-left text-card-foreground shadow-sm',
    'motion-safe:transition-shadow',
    onSelect && 'hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
    selected && 'ring-2 ring-ring',
  );

  const content = (
    <>
      {vm.imageUrl && (
        <img src={vm.imageUrl} alt={vm.title ?? ''} className="aspect-video w-full rounded-t-lg object-cover" />
      )}
      <div className="flex flex-1 flex-col gap-1 p-3">
        <div className="flex items-start justify-between gap-2">
          {vm.title && <span className="font-medium">{vm.title}</span>}
          {vm.badge && (
            <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
              {vm.badge}
            </span>
          )}
        </div>
        {vm.subtitle && <span className="text-sm text-muted-foreground">{vm.subtitle}</span>}
        {vm.price != null && <span className="mt-1 font-semibold tabular-nums">{formatCardPrice(vm.price)}</span>}
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
