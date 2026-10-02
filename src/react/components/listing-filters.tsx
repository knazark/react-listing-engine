'use client';

import { memo, useCallback, type ComponentType } from 'react';

import { plainEqual } from '~/core/plain-equal';

import { useListingComponents } from '../components-provider';
import { useListing } from '../hooks/use-listing';
import { useListingFilters } from '../hooks/use-listing-filters';

export interface IListingFiltersProps<TFilters = unknown> {
  /**
   * ClassName for the container wrapping every filter group. Purely a
   * styling hook -- this component stays structure-only, so it never bakes
   * in its own layout beyond the `space-y-5` fallback below. Pass a
   * horizontal row (e.g. `"flex flex-wrap items-end gap-3"`) to flow filter
   * groups inline instead of stacking them, as the `/styled` adapter's
   * `StyledListingLayout` does for its top filter bar.
   */
  className?: string;
  /** ClassName applied to each individual filter group's wrapper `<div>` (including the string-placeholder case). */
  groupClassName?: string;
  /**
   * Suppress the per-filter `label` above each control. Use for a compact
   * inline filter bar where the control's own placeholder is label enough;
   * leave off (labels shown) for a stacked form layout like the mobile sheet.
   */
  hideLabels?: boolean;
  /**
   * Deferred/draft mode: supply alongside `onDraftChange` to have every
   * control read its value from `def.fromParams(draft)` instead of the
   * engine's live applied filters, and route `onChange` through
   * `onDraftChange` instead of `engine.applyFilters`. Nothing reaches the
   * engine until the caller applies its own accumulated draft (e.g. the
   * mobile sheet's "Show N results" button committing it via
   * `engine.applyFilters(draft)`).
   *
   * Both `draft` and `onDraftChange` must be supplied together to enable
   * deferred mode -- either one alone falls back to the original LIVE
   * behavior (default, used by the desktop filter bar): each control reads
   * `engine.filters`/live applied state and applies straight to the engine
   * on change.
   */
  draft?: TFilters;
  /** Paired with `draft` to enable deferred mode -- see `draft`'s doc. */
  onDraftChange?: (params: Partial<TFilters>) => void;
}

interface IFilterControlProps {
  value: unknown;
  onChange: (value: unknown) => void;
}

interface IFilterGroupControlProps {
  Control: ComponentType<IFilterControlProps>;
  value: unknown;
  /** The filter definition; its `toParams` maps the control's value to the params to write. */
  def: { toParams: (value: never) => unknown };
  /** Where a change goes: the caller's draft in deferred mode, the engine otherwise. */
  write: (params: unknown) => void;
}

/**
 * One filter's control, re-rendered only when ITS value changes.
 *
 * The panel re-renders on every filters write, and most writes are not about
 * most controls -- a map settle rewrites the viewport keys and nothing else,
 * yet used to re-render every control on the bar. `value` is compared
 * structurally because `fromParams` may build a fresh object each call.
 */
const FilterControl = memo(
  function FilterControl({ Control, value, def, write }: IFilterGroupControlProps) {
    const onChange = useCallback((next: unknown) => write(def.toParams(next as never)), [def, write]);
    return <Control value={value} onChange={onChange} />;
  },
  (previous, next) =>
    previous.Control === next.Control &&
    previous.def === next.def &&
    previous.write === next.write &&
    plainEqual(previous.value, next.value),
);

/**
 * Structure-only filter panel: one control per `engine.filters.list()` entry,
 * wrapped in the injected `FilterPanel`.
 *
 * - `def.render` as a component: mounted with `{ value, onChange }`, where
 *   `value = def.fromParams(filters)` and `onChange(v)` applies
 *   `def.toParams(v)` via `engine.applyFilters(...)` (not `setField` --
 *   `toParams` can legitimately touch more than one `TFilters` key, so the
 *   general bulk-patch mutator is the correct one to route through).
 * - `def.render` as a string (a *named* default control, e.g.
 *   `"text"`/`"range"`/`"toggle"`): there is no shared named-control registry
 *   yet, so this renders an inert `<div data-filter={def.key} />` placeholder.
 *   Wiring a real named-control registry (so `"range"` etc. resolve to an
 *   actual control) is a documented future
 *   enhancement, not attempted in this task.
 *
 * Each filter group is wrapped in its own `<div>`: when `def.label` is set,
 * a small label renders above the control; when absent, only the control
 * renders (unlabeled, same as before `label` existed) -- fully backward
 * compatible with filter defs that don't set it.
 *
 * `className`/`groupClassName` are optional styling hooks (default: `undefined`
 * -- the container falls back to the original vertical `space-y-5` stack, and
 * each group renders with no extra class, identical to pre-`className`
 * behavior). Passing a horizontal `className` does NOT change the
 * label-above-control structure within each group -- only how the groups
 * themselves are laid out relative to each other.
 *
 * `draft`/`onDraftChange` (both required together) switch every control from
 * LIVE (read/write straight through `engine.filters`/`applyFilters`) to
 * DEFERRED (read/write through the caller's own draft state) -- see
 * `IListingFiltersProps.draft`'s doc. Omitted (the default), this component's
 * behavior is unchanged from before either prop existed.
 */
export function ListingFilters<TFilters = unknown>({
  className,
  groupClassName,
  hideLabels,
  draft,
  onDraftChange,
}: IListingFiltersProps<TFilters> = {}) {
  const engine = useListing<unknown, TFilters>();
  const { FilterPanel } = useListingComponents();
  const { filters } = useListingFilters<TFilters>();

  // Deferred mode requires BOTH props -- a lone `draft` has no way to be
  // edited (no `onDraftChange` to call), and a lone `onDraftChange` has
  // nothing to read from -- either half-supplied case falls back to live.
  const deferred = draft !== undefined && onDraftChange !== undefined;
  // `filters` (from `useListingFilters`) is `DeepReadonly<TFilters>` -- cast
  // back to `TFilters` here (same shape at runtime, just not recursively
  // `readonly`-typed) so both branches of this ternary agree on one type.
  const activeFilters = deferred ? (draft as TFilters) : (filters as TFilters);

  // One writer for every control, stable while the mode is: a control's
  // `onChange` then only changes identity when its own inputs do.
  const applyLive = useCallback((params: unknown) => void engine.applyFilters(params as Partial<TFilters>), [engine]);
  const write = deferred ? (onDraftChange as (params: unknown) => void) : applyLive;

  return (
    <FilterPanel>
      <div className={className ?? 'space-y-5'}>
        {engine.filters.list().map(def => {
          if (typeof def.render === 'string') {
            return <div key={def.key} data-filter={def.key} className={groupClassName} />;
          }

          return (
            <div key={def.key} className={groupClassName}>
              {def.label && !hideLabels && (
                <div className="mb-1.5 text-[13px] font-medium text-foreground">{def.label}</div>
              )}
              <FilterControl
                Control={def.render as ComponentType<IFilterControlProps>}
                value={def.fromParams(activeFilters)}
                def={def}
                write={write}
              />
            </div>
          );
        })}
      </div>
    </FilterPanel>
  );
}
