'use client';

import type { IListingPopupProps } from '~/react';

import { formatStyledPrice } from '../utils/format-price';

// Same defensive view-model reasoning as StyledCard.
interface IStyledPopupViewModel {
	title?: string;
	subtitle?: string;
	price?: string | number;
}

/**
 * Default `/styled` `Popup` slot: a small `.rle-popup` card with an
 * accessible close button. `role="group"` + `aria-label` (rather than
 * `role="dialog"`) since this is a non-modal, non-focus-trapped popup
 * anchored to a map marker -- `dialog` without modality/focus management
 * would misrepresent it to AT users. Mirrors `/shadcn`'s `DefaultPopup`.
 */
export function StyledPopup({ entity, onClose }: IListingPopupProps) {
	const vm = (entity ?? {}) as Partial<IStyledPopupViewModel>;

	return (
		<div className="rle-popup" role="group" aria-label="Location details">
			<button type="button" onClick={onClose} aria-label="Close" className="rle-popup-close">
				<svg
					xmlns="http://www.w3.org/2000/svg"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					strokeWidth={2}
					strokeLinecap="round"
					strokeLinejoin="round"
					width="16"
					height="16"
					aria-hidden="true"
				>
					<path d="M18 6 6 18" />
					<path d="m6 6 12 12" />
				</svg>
			</button>

			<div>
				{vm.title && <div className="rle-card-title">{vm.title}</div>}
				{vm.subtitle && <div className="rle-card-address">{vm.subtitle}</div>}
				{vm.price != null && <div className="rle-card-price">{formatStyledPrice(vm.price)}</div>}
			</div>
		</div>
	);
}
