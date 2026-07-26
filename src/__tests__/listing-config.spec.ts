import { describe, it, expect } from 'vitest';
import { ListingConfig } from '~/core/listing-config';
import { listingDefaultConfig } from '~/core/listing-default.config';
import { PaginationMode } from '~/enums';

describe('ListingConfig', () => {
  it('uses listingDefaultConfig when constructed with no arguments', () => {
    const config = new ListingConfig();
    expect(config.options).toEqual(listingDefaultConfig);
  });

  it('uses listingDefaultConfig when constructed with undefined', () => {
    const config = new ListingConfig(undefined);
    expect(config.options).toEqual(listingDefaultConfig);
  });

  it('merges a partial override on top of the defaults', () => {
    const config = new ListingConfig({ pageSize: 50 });
    expect(config.options.pageSize).toBe(50);
    expect(config.options.pagination).toBe(listingDefaultConfig.pagination);
    expect(config.options.debounceMs).toBe(listingDefaultConfig.debounceMs);
  });

  it('merges multiple overridden fields at once', () => {
    const config = new ListingConfig({ pagination: PaginationMode.Infinite, debounceMs: 500 });
    expect(config.options.pagination).toBe(PaginationMode.Infinite);
    expect(config.options.debounceMs).toBe(500);
    expect(config.options.pageSize).toBe(listingDefaultConfig.pageSize);
  });

  it('freezes options so mutation throws in strict mode', () => {
    const config = new ListingConfig();
    expect(() => {
      (config.options as { pageSize: number }).pageSize = 999;
    }).toThrow(TypeError);
  });

  it('does not mutate listingDefaultConfig when a partial override is applied', () => {
    new ListingConfig({ pageSize: 999 });
    expect(listingDefaultConfig.pageSize).toBe(20);
  });
});
