'use client';

import type { IListingSearchProps } from '~/react';

import { cn } from './utils/cn';

/** Default styled `Search` slot: a plain styled text input. */
export function DefaultSearch({ value, onChange, placeholder }: IListingSearchProps) {
  return (
    <input
      type="search"
      value={value}
      placeholder={placeholder}
      onChange={event => onChange(event.target.value)}
      aria-label={placeholder ?? 'Search'}
      className={cn(
        'h-9 w-full rounded-md border bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground',
        'focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
      )}
    />
  );
}
