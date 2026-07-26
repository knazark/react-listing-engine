'use client';

import { useListingComponents } from '../components-provider';
import { useListing } from '../hooks/use-listing';
import { useListingFilters } from '../hooks/use-listing-filters';

export interface IListingFiltersProps {
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
}

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
 */
export function ListingFilters({ className, groupClassName, hideLabels }: IListingFiltersProps = {}) {
  const engine = useListing();
  const { FilterPanel } = useListingComponents();
  const { filters } = useListingFilters();

  return (
    <FilterPanel>
      <div className={className ?? 'space-y-5'}>
        {engine.filters.list().map(def => {
          if (typeof def.render === 'string') {
            return <div key={def.key} data-filter={def.key} className={groupClassName} />;
          }

          const Control = def.render;
          return (
            <div key={def.key} className={groupClassName}>
              {def.label && !hideLabels && (
                <div className="mb-1.5 text-[13px] font-medium text-foreground">{def.label}</div>
              )}
              <Control
                value={def.fromParams(filters)}
                onChange={value => void engine.applyFilters(def.toParams(value))}
              />
            </div>
          );
        })}
      </div>
    </FilterPanel>
  );
}
