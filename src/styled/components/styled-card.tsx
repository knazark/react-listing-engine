'use client';

import type { IListingCardProps } from '~/react';

import { formatStyledPrice } from '../utils/format-price';

// Common view-model shape the default card knows how to render. The engine
// is entity-erased at this layer (`item: unknown`, same reasoning as every
// other slot -- see `~/react/components-provider.tsx`'s docstring), so this
// is read DEFENSIVELY via a cast, never assumed to be the caller's real
// TEntity. Every field is optional and simply omitted from the render when
// absent. The view-model is styling-agnostic; only the `.rle-*` class names
// are specific to this styled adapter.
interface IStyledCardViewModel {
	title?: string;
	subtitle?: string;
	imageUrl?: string;
	price?: string | number;
	badge?: string;
}

function cardClassName(selected: boolean | undefined): string {
	return selected ? 'rle-card rle-card--selected' : 'rle-card';
}

/**
 * Default `/styled` `Card` slot. Renders an optional image, title, subtitle,
 * badge and price from a plain view-model item -- image -> title -> address
 * (subtitle) -> info line (badge) -> price, using only `.rle-*` classes (see
 * `styles.css`). Doubles as the clickable/selectable surface (`onSelect`):
 * when given, the card is a `<button type="button">` so it's keyboard
 * operable and announces as a toggle (`aria-pressed`) for free; the
 * `[type='button']` attribute selector in `styles.css` is what gives it the
 * pointer/hover/focus affordances the plain `<article>` variant doesn't get.
 */
export function StyledCard({ item, selected, onSelect }: IListingCardProps) {
	const vm = (item ?? {}) as Partial<IStyledCardViewModel>;
	const className = cardClassName(selected);

	const content = (
		<>
			{vm.imageUrl ? (
				<img src={vm.imageUrl} alt={vm.title ?? ''} className="rle-card-media" />
			) : (
				<div className="rle-card-media rle-card-media--placeholder" aria-hidden="true" />
			)}
			<div className="rle-card-body">
				{vm.title && <span className="rle-card-title">{vm.title}</span>}
				{vm.subtitle && <span className="rle-card-address">{vm.subtitle}</span>}
				{vm.badge && (
					<div className="rle-card-info">
						<span className="rle-card-info-item">{vm.badge}</span>
					</div>
				)}
				{vm.price != null && <span className="rle-card-price">{formatStyledPrice(vm.price)}</span>}
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
