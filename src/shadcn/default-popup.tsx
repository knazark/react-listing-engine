'use client';

import type { IListingPopupProps } from '~/react';

// Same defensive view-model reasoning as DefaultCard.
interface IListingPopupViewModel {
  title?: string;
  subtitle?: string;
  price?: string | number;
}

/**
 * Default styled `Popup` slot: a small card with an accessible close button.
 * `role="group"` + `aria-label` (rather than `role="dialog"`) since this is a
 * non-modal, non-focus-trapped popup anchored to a map marker -- `dialog`
 * without modality/focus management would misrepresent it to AT users.
 */
export function DefaultPopup({ entity, onClose }: IListingPopupProps) {
  const vm = (entity ?? {}) as Partial<IListingPopupViewModel>;

  return (
    <div
      className="relative w-64 rounded-lg border bg-popover p-3 text-popover-foreground shadow-md"
      role="group"
      aria-label="Location details"
    >
      <button
        type="button"
        onClick={onClose}
        aria-label="Close"
        className="absolute right-2 top-2 rounded-md p-1 text-muted-foreground motion-safe:transition-colors hover:bg-foreground/[0.06] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          className="h-4 w-4"
          aria-hidden="true"
        >
          <path d="M18 6 6 18" />
          <path d="m6 6 12 12" />
        </svg>
      </button>

      <div className="pr-6">
        {vm.title && <div className="font-medium">{vm.title}</div>}
        {vm.subtitle && <div className="text-sm text-muted-foreground">{vm.subtitle}</div>}
        {vm.price != null && <div className="mt-1 font-semibold tabular-nums">{vm.price}</div>}
      </div>
    </div>
  );
}
