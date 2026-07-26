import type { Bounds, EntityId } from '~/interfaces';
import { ListingEventType } from '~/enums';

export type ListingEvent<TEntity = unknown, TFilters = unknown> =
  | { type: ListingEventType.FiltersChanged; filters: TFilters }
  | { type: ListingEventType.ResultsLoaded; datasetId: string; count: number }
  | { type: ListingEventType.PointClicked; datasetId: string; id: EntityId; entity: TEntity }
  | { type: ListingEventType.BoundsChanged; bounds: Bounds }
  | { type: ListingEventType.LayerToggled; datasetId: string; visible: boolean };
