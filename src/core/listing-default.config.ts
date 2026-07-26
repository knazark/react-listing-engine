import { PaginationMode } from '~/enums';
import type { IListingConfigOptions } from '~/interfaces';

export const listingDefaultConfig: IListingConfigOptions = {
  pagination: PaginationMode.Paged,
  pageSize: 20,
  debounceMs: 250,
};
