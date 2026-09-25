import type { MapGeometry } from './types';

/**
 * Content identity of a geometry (docs/MAPS.md §5.3 "Content hash"; M2 review code-F2).
 *
 * The frame hash (`frame.ts`) covers only the 49 QuestieDB frames the dataset's percentages are in,
 * so it cannot notice an edited AreaID, Era coefficient, continent row, name or parent. The content
 * hash covers everything a consumer reads from a parsed geometry, so `tools/maps` records it in
 * `geometry.placeholder.json` (`contentHash`) and `infra/maps` refuses a file whose content does not
 * hash to it.
 *
 * Canonical form (version 1): `JSON.stringify` of
 *
 * ```
 * ["frl-geometry-content", 1, kind, product,
 *   [[uiMapId, name, nameSource, type, parent,
 *     [[id, mapId, areaId, orderIndex, xMin, xMax, yMin, yMax, uiMinU, uiMinV, uiMaxU, uiMaxV, source, build], …]], …],
 *   [[uiMapId, scaleX, offsetX, scaleY, offsetY, fromBuild, toBuild, source], …]]
 * ```
 *
 * - UiMaps ascending by id; rows ascending by (OrderIndex, assignment id); coefficient sets ascending
 *   by UiMap. The order never depends on how the geometry was built.
 * - Numbers are the parsed doubles in ECMAScript's shortest round-trip form. Unlike the frame hash
 *   there is no `Math.fround`: any edit, however small, changes the content. A file written with
 *   `JSON.stringify` numbers (tools/maps/lib/json.ts) parses back to the same doubles, so the
 *   writer's in-memory geometry and the reader's parsed file give the same string.
 * - Not covered: the recorded hashes themselves (`frameHash`, `contentHash`) and the provenance keys
 *   `parseGeometryFile` ignores (`_generated`, `inputs`, a local set's `build`).
 *
 * The hash is the lowercase hex SHA-256 of the string's UTF-8 bytes. Hashing is not pure, so it
 * happens in `tools/maps` (node:crypto) and `infra/maps` (WebCrypto), never here.
 */

export const GEOMETRY_CONTENT_FORMAT = 'frl-geometry-content';
export const GEOMETRY_CONTENT_VERSION = 1;

const byNumber = (a: number, b: number): number => a - b;

export function canonicalGeometryContent(geometry: MapGeometry): string {
  const maps = [...geometry.maps.values()]
    .sort((a, b) => byNumber(a.uiMapId, b.uiMapId))
    .map((map) => [
      map.uiMapId,
      map.name,
      map.nameSource,
      map.type,
      map.parent,
      [...map.assignments]
        .sort((a, b) => a.orderIndex - b.orderIndex || a.id - b.id)
        .map((row) => [
          row.id,
          row.mapId,
          row.areaId,
          row.orderIndex,
          row.xMin,
          row.xMax,
          row.yMin,
          row.yMax,
          row.uiMin[0],
          row.uiMin[1],
          row.uiMax[0],
          row.uiMax[1],
          row.source,
          row.build,
        ]),
    ]);
  const era = [...geometry.eraToForever]
    .sort((a, b) => byNumber(a[0], b[0]))
    .map(([id, c]) => [id, c.scaleX, c.offsetX, c.scaleY, c.offsetY, c.fromBuild, c.toBuild, c.source]);
  return JSON.stringify([GEOMETRY_CONTENT_FORMAT, GEOMETRY_CONTENT_VERSION, geometry.kind, geometry.product, maps, era]);
}
