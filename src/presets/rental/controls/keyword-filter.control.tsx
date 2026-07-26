'use client';

import type { ChangeEvent } from 'react';

import type { FilterControlProps } from '~/interfaces';

/** Unstyled free-text keyword input. */
export function KeywordFilterControl({ value, onChange }: FilterControlProps<string>) {
  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    onChange(event.target.value);
  };

  return (
    <input
      type="search"
      value={value}
      onChange={handleChange}
      aria-label="Keyword"
      placeholder="Search keyword"
      className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    />
  );
}
