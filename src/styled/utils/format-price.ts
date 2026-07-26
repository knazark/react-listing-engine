/**
 * Currency-formats a numeric price (`1200` -> `"$1,200"`, USD, 0 decimals); a
 * string price is passed through as-is (caller already formatted it). Shared
 * by every `/styled` default slot that renders a price (`StyledCard`,
 * `StyledMarker`, `StyledPopup`) so the formatting rule lives in one place.
 */
export function formatStyledPrice(price: string | number): string {
	if (typeof price !== 'number') return price;
	return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(
		price,
	);
}
