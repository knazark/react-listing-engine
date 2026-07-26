// keys PascalCase; values equal keys so engine.on('ResultsLoaded') works
export enum ListingEventType {
  FiltersChanged = 'FiltersChanged',
  ResultsLoaded = 'ResultsLoaded',
  PointClicked = 'PointClicked',
  BoundsChanged = 'BoundsChanged',
  LayerToggled = 'LayerToggled',
}
