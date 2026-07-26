import type { PaginationMode } from '../enums/pagination-mode.enum';

export interface IListingConfigOptions {
  pagination: PaginationMode;
  pageSize: number;
  debounceMs: number;
}
