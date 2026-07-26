'use client';

import type { ChangeEvent } from 'react';

import type { FilterControlProps } from '~/interfaces';

import type { RangeValue } from '../rental-entity.interface';

function toNumberOrUndefined(raw: string): number | undefined {
  if (raw === '') return undefined;
  const parsed = Number(raw);
  return Number.isNaN(parsed) ? undefined : parsed;
}

/**
 * Unstyled min/max number inputs for any `RangeValue`-shaped filter (price,
 * beds, baths). Deliberately generic -- no per-domain label prop -- consumers
 * restyle/relabel via a shadcn wrapper or their own `render` override.
 */
export function RangeFilterControl({ value, onChange }: FilterControlProps<RangeValue>) {
  const handleMinChange = (event: ChangeEvent<HTMLInputElement>) => {
    onChange({ ...value, min: toNumberOrUndefined(event.target.value) });
  };

  const handleMaxChange = (event: ChangeEvent<HTMLInputElement>) => {
    onChange({ ...value, max: toNumberOrUndefined(event.target.value) });
  };

  const inputClassName =
    'h-9 w-full rounded-md border border-border bg-background px-2 text-sm tabular-nums text-foreground ' +
    'placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

  return (
    <div className="flex items-center gap-2">
      <input
        type="number"
        inputMode="numeric"
        aria-label="Minimum"
        placeholder="Min"
        value={value.min ?? ''}
        onChange={handleMinChange}
        className={inputClassName}
      />
      <span aria-hidden="true" className="text-muted-foreground">
        -
      </span>
      <input
        type="number"
        inputMode="numeric"
        aria-label="Maximum"
        placeholder="Max"
        value={value.max ?? ''}
        onChange={handleMaxChange}
        className={inputClassName}
      />
    </div>
  );
}
