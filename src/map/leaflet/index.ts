/**
 * `map/leaflet`: the Leaflet implementation of `MapAdapter` (ARCHITECTURE §7.2). The only module
 * that imports Leaflet; `ui` imports it only in the composition root (`src/main.tsx`), which loads it
 * lazily, in its own chunk, and passes `createLeafletMapAdapter` down as a `MapAdapterFactory`.
 */
export { createLeafletMapAdapter, LeafletMapAdapter, type LeafletMapAdapterOptions } from './LeafletMapAdapter';
export { DEFAULT_MAP_PALETTE, paletteFrom, readMapPalette, type MapPalette } from './style';
export {
  boundsToLatLngBounds,
  latLngBoundsToWorld,
  latLngToWorld,
  pointToLatLng,
  worldToLatLng,
  yardsPerPixel,
  type LatLngBoundsPair,
  type LatLngPair,
} from './transform';
export { createMapPerf, pagePerformance, type MapPerf, type PerformanceLike } from './perf';
