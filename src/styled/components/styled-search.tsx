'use client';

import type { IListingSearchProps } from '~/react';

/** Default `/styled` `Search` slot: a plain `.rle-input` text input. */
export function StyledSearch({ value, onChange, placeholder }: IListingSearchProps) {
	return (
		<input
			type="search"
			value={value}
			placeholder={placeholder}
			onChange={event => onChange(event.target.value)}
			aria-label={placeholder ?? 'Search'}
			className="rle-input"
		/>
	);
}
