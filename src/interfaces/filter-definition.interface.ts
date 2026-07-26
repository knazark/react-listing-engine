import type { ComponentType } from 'react'; // TYPE-ONLY import is allowed in interfaces/ (erased at build)

export interface FilterControlProps<TValue> { value: TValue; onChange(next: TValue): void; }
export interface FilterDefinition<TFilters, TValue = unknown> {
  key: string;
  order: number;
  render: string | ComponentType<FilterControlProps<TValue>>;
  toParams(value: TValue): Partial<TFilters>;
  fromParams(filters: TFilters): TValue;
  isActive?(filters: TFilters): boolean;
  /** Optional human-readable label rendered above the control by `ListingFilters`. Omit for an unlabeled filter (backward compatible). */
  label?: string;
}
