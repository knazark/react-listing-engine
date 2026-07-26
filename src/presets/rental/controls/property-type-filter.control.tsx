'use client';

import { useState, type ChangeEvent, type MouseEvent } from 'react';

import type { FilterControlProps } from '~/interfaces';

import type { PropertyType } from '../rental-entity.interface';

const PROPERTY_TYPES: PropertyType[] = ['house', 'apartment', 'condo', 'townhouse', 'land'];

const PROPERTY_TYPE_LABELS: Record<PropertyType, string> = {
  house: 'House',
  apartment: 'Apartment',
  condo: 'Condo',
  townhouse: 'Townhouse',
  land: 'Land',
};

/**
 * Compact dropdown for the property-type multi-select -- a native
 * `<details>`/`<summary>` disclosure (no Radix dependency, so this preset
 * package doesn't have to pull one in) instead of the previous
 * always-expanded checkbox list, so the top filter bar (`ListingLayout`'s
 * horizontal row) stays compact regardless of how many property types exist.
 * `<summary>` is the button-like trigger: "Property type" plus a count badge
 * once 1+ types are selected. The panel (absolutely positioned so it doesn't
 * push sibling filter groups around) holds one checkbox per `PropertyType`,
 * unchanged from the previous always-expanded version.
 *
 * `open` is fully CONTROLLED local state, not left to `<details>`'s own
 * built-in toggle -- the trigger's `onClick` calls `event.preventDefault()`
 * (which, per spec, suppresses `<summary>`'s native open/close activation for
 * that click) and flips `open` itself instead. This makes `aria-expanded`
 * always exactly match what's rendered, and makes the open/close behavior
 * independent of a given DOM engine's level of native `<details>` support --
 * it doesn't rely on a `toggle` event firing. Keyboard access is unaffected:
 * `preventDefault()` only suppresses the native toggle side effect, not the
 * click event itself, so Enter/Space on a focused `<summary>` (which the
 * browser turns into a `click`) still reaches this handler. Outside click is
 * NOT handled (native `<details>` doesn't require it either) -- clicking
 * elsewhere leaves the panel open until the trigger (or a checkbox) is
 * clicked again; not fixed here, matching the design brief.
 */
export function PropertyTypeFilterControl({ value, onChange }: FilterControlProps<PropertyType[]>) {
  const [open, setOpen] = useState(false);

  const handleToggle = (type: PropertyType) => (event: ChangeEvent<HTMLInputElement>) => {
    onChange(event.target.checked ? [...value, type] : value.filter(selected => selected !== type));
  };

  const handleTriggerClick = (event: MouseEvent<HTMLElement>) => {
    event.preventDefault();
    setOpen(current => !current);
  };

  return (
    <details open={open} className="group relative">
      <summary
        onClick={handleTriggerClick}
        aria-expanded={open}
        className="flex h-9 w-fit cursor-pointer list-none items-center gap-1.5 rounded-md border border-border bg-background px-3 text-sm text-foreground motion-safe:transition-colors hover:bg-foreground/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden"
      >
        Property type
        {value.length > 0 && (
          <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1 text-xs font-semibold tabular-nums text-primary-foreground">
            {value.length}
          </span>
        )}
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          className="size-3.5 shrink-0 text-muted-foreground motion-safe:transition-transform group-open:rotate-180"
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </summary>

      <fieldset className="absolute z-10 mt-1.5 flex w-48 flex-col gap-1.5 rounded-md border border-border bg-popover p-3 text-popover-foreground shadow-md">
        <legend className="sr-only">Property type</legend>
        {PROPERTY_TYPES.map(type => (
          <label key={type} className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={value.includes(type)}
              onChange={handleToggle(type)}
              className="size-4 rounded border-border accent-primary"
            />
            {PROPERTY_TYPE_LABELS[type]}
          </label>
        ))}
      </fieldset>
    </details>
  );
}
