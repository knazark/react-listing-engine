import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { FilterRegistry } from '~/core';

import { KeywordFilterControl } from '../controls/keyword-filter.control';
import { PropertyTypeFilterControl } from '../controls/property-type-filter.control';
import { RangeFilterControl } from '../controls/range-filter.control';
import type { PropertyType, RentalFilters } from '../rental-entity.interface';
import { rentalFilters, withRentalFilters } from '../rental-filters';

afterEach(() => {
  cleanup();
});

function findFilter(key: string) {
  const def = rentalFilters.find(f => f.key === key);
  if (!def) throw new Error(`filter "${key}" not registered`);
  return def;
}

// -----------------------------------------------------------------------------
// toParams / fromParams / isActive per filter
// -----------------------------------------------------------------------------

describe('rentalFilters', () => {
  describe('price', () => {
    const price = findFilter('price');

    it('round-trips toParams -> fromParams', () => {
      const params = price.toParams({ min: 1000, max: 3000 });
      expect(params).toEqual({ minPrice: 1000, maxPrice: 3000 });
      expect(price.fromParams(params)).toEqual({ min: 1000, max: 3000 });
    });

    it('isActive is true when either bound is set, false when neither is', () => {
      expect(price.isActive?.({ minPrice: 1000 })).toBe(true);
      expect(price.isActive?.({ maxPrice: 3000 })).toBe(true);
      expect(price.isActive?.({})).toBe(false);
    });
  });

  describe('beds', () => {
    const beds = findFilter('beds');

    it('round-trips toParams -> fromParams', () => {
      const params = beds.toParams({ min: 1, max: 3 });
      expect(params).toEqual({ minBeds: 1, maxBeds: 3 });
      expect(beds.fromParams(params)).toEqual({ min: 1, max: 3 });
    });

    it('isActive is true when either bound is set, false when neither is', () => {
      expect(beds.isActive?.({ minBeds: 1 })).toBe(true);
      expect(beds.isActive?.({})).toBe(false);
    });
  });

  describe('baths', () => {
    const baths = findFilter('baths');

    it('round-trips toParams -> fromParams', () => {
      const params = baths.toParams({ min: 1, max: 2 });
      expect(params).toEqual({ minBaths: 1, maxBaths: 2 });
      expect(baths.fromParams(params)).toEqual({ min: 1, max: 2 });
    });

    it('isActive is true when either bound is set, false when neither is', () => {
      expect(baths.isActive?.({ maxBaths: 2 })).toBe(true);
      expect(baths.isActive?.({})).toBe(false);
    });
  });

  describe('propertyType', () => {
    const propertyType = findFilter('propertyType');

    it('round-trips toParams -> fromParams', () => {
      const types: PropertyType[] = ['house', 'condo'];
      const params = propertyType.toParams(types);
      expect(params).toEqual({ propertyTypes: types });
      expect(propertyType.fromParams(params)).toEqual(types);
    });

    it('toParams drops an empty selection to undefined (not [])', () => {
      expect(propertyType.toParams([])).toEqual({ propertyTypes: undefined });
    });

    it('fromParams defaults to an empty array when unset', () => {
      expect(propertyType.fromParams({})).toEqual([]);
    });

    it('isActive is true only when at least one type is selected', () => {
      expect(propertyType.isActive?.({ propertyTypes: ['house'] })).toBe(true);
      expect(propertyType.isActive?.({ propertyTypes: [] })).toBe(false);
      expect(propertyType.isActive?.({})).toBe(false);
    });
  });

  describe('keyword', () => {
    const keyword = findFilter('keyword');

    it('round-trips toParams -> fromParams', () => {
      const params = keyword.toParams('loft');
      expect(params).toEqual({ keyword: 'loft' });
      expect(keyword.fromParams(params)).toBe('loft');
    });

    it('toParams drops an empty string to undefined', () => {
      expect(keyword.toParams('')).toEqual({ keyword: undefined });
    });

    it('fromParams defaults to an empty string when unset', () => {
      expect(keyword.fromParams({})).toBe('');
    });

    it('isActive is true only when a non-empty keyword is set', () => {
      expect(keyword.isActive?.({ keyword: 'loft' })).toBe(true);
      expect(keyword.isActive?.({ keyword: '' })).toBe(false);
      expect(keyword.isActive?.({})).toBe(false);
    });
  });
});

// -----------------------------------------------------------------------------
// withRentalFilters
// -----------------------------------------------------------------------------

describe('withRentalFilters', () => {
  it('adds all 5 rental filters to a FilterRegistry, in definition order', () => {
    const registry = new FilterRegistry<RentalFilters>();
    withRentalFilters()(registry);
    expect(registry.list().map(f => f.key)).toEqual(['price', 'beds', 'baths', 'propertyType', 'keyword']);
  });
});

// -----------------------------------------------------------------------------
// Filter control components
// -----------------------------------------------------------------------------

describe('RangeFilterControl', () => {
  it('calls onChange with the updated min, preserving max', () => {
    const onChange = vi.fn();
    render(<RangeFilterControl value={{ min: undefined, max: undefined }} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText('Minimum'), { target: { value: '1000' } });
    expect(onChange).toHaveBeenCalledWith({ min: 1000, max: undefined });
  });

  it('calls onChange with the updated max, preserving min', () => {
    const onChange = vi.fn();
    render(<RangeFilterControl value={{ min: 500, max: undefined }} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText('Maximum'), { target: { value: '3000' } });
    expect(onChange).toHaveBeenCalledWith({ min: 500, max: 3000 });
  });

  it('clearing an input reverts that bound to undefined', () => {
    const onChange = vi.fn();
    render(<RangeFilterControl value={{ min: 1000, max: 3000 }} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText('Minimum'), { target: { value: '' } });
    expect(onChange).toHaveBeenCalledWith({ min: undefined, max: 3000 });
  });
});

describe('PropertyTypeFilterControl', () => {
  it('renders a collapsed compact trigger by default, with no count badge when nothing is selected', () => {
    const { container } = render(<PropertyTypeFilterControl value={[]} onChange={vi.fn()} />);

    const trigger = container.querySelector('summary')!;
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(container.querySelector('details')).not.toHaveAttribute('open');
    expect(within(trigger).queryByText(/^\d+$/)).not.toBeInTheDocument();
  });

  it('shows a count badge equal to the number of selected types', () => {
    const { container } = render(<PropertyTypeFilterControl value={['house', 'condo']} onChange={vi.fn()} />);

    const trigger = container.querySelector('summary')!;
    expect(within(trigger).getByText('2')).toBeInTheDocument();
  });

  it('clicking the trigger opens the panel and sets aria-expanded/open; clicking again closes it', () => {
    const { container } = render(<PropertyTypeFilterControl value={[]} onChange={vi.fn()} />);

    const trigger = container.querySelector('summary')!;
    const details = container.querySelector('details')!;

    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(details).not.toHaveAttribute('open');

    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(details).toHaveAttribute('open');

    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(details).not.toHaveAttribute('open');
  });

  it('checking an unselected type adds it to the selection', () => {
    const onChange = vi.fn();
    render(<PropertyTypeFilterControl value={['house']} onChange={onChange} />);
    fireEvent.click(screen.getByLabelText('Condo'));
    expect(onChange).toHaveBeenCalledWith(['house', 'condo']);
  });

  it('unchecking a selected type removes it from the selection', () => {
    const onChange = vi.fn();
    render(<PropertyTypeFilterControl value={['house', 'condo']} onChange={onChange} />);
    fireEvent.click(screen.getByLabelText('House'));
    expect(onChange).toHaveBeenCalledWith(['condo']);
  });
});

describe('KeywordFilterControl', () => {
  it('calls onChange with the typed value', () => {
    const onChange = vi.fn();
    render(<KeywordFilterControl value="" onChange={onChange} />);
    fireEvent.change(screen.getByLabelText('Keyword'), { target: { value: 'loft' } });
    expect(onChange).toHaveBeenCalledWith('loft');
  });
});
