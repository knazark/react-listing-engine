import type { IListingConfigOptions } from '~/interfaces';

import { listingDefaultConfig } from './listing-default.config';

/**
 * Merges a partial `IListingConfigOptions` over `listingDefaultConfig` and
 * freezes the result. Pure data holder — no reactivity/subscriptions, unlike
 * the wizard's `WizardConfig` (the listing engine doesn't need live config
 * updates for this task).
 */
export class ListingConfig {
  public readonly options: Readonly<IListingConfigOptions>;

  constructor(partial?: Partial<IListingConfigOptions>) {
    this.options = Object.freeze({ ...listingDefaultConfig, ...partial });
  }
}
