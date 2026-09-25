import { areaId, uiMapId, worldMapId, type UiMapId } from '../domain/ids';
import { createMapGeometry } from './geometry';
import type { EraToForeverCoefficients, GeometryAssignment, MapGeometry, UiMapGeometry } from './types';

/**
 * Test-only geometry built from individually cited values (D-022), so `src/geo` tests need no
 * file access. Not imported by application code.
 *
 * - Zone frames: QuestieDB `data/Forever/conversion.json` at `b6f5b07b`, `geometry.transforms[]`
 *   `target_bounds` (`left = yMax`, `right = yMin`, `top = xMax`, `bottom = xMin`), build
 *   1.60.1.69893; equal bit for bit to `UiMapAssignment` at 1.60.1.70009 (coordinates.md §10.3).
 * - Continent and world rows: `UiMapAssignment` / `UiMap` at 1.60.1.70009 (docs/MAPS.md §8.3).
 * - Era frames (Mulgore, Eastern Plaguelands, Redridge Mountains, Stormwind City): `conversion.json`
 *   `transforms[ui_map_id=…].source_bounds` (Era 1.15.9.69722).
 * - Coefficients: `conversion.json` `transforms[].coefficients` for 1412, 1423, 1433, 1453.
 * - TaxiNodes: individual `TaxiNodes` rows at 1.60.1.70009 (`ID`, `ContinentID`, `Pos_0` = world X,
 *   `Pos_1` = world Y), cited one by one (D-022; coordinates.md §9).
 */

const QDB = '1.60.1.69893';
const DB2 = '1.60.1.70009';

interface RowSpec {
  readonly id: number;
  readonly mapId: number;
  readonly areaId: number;
  readonly orderIndex?: number;
  readonly xMin: number;
  readonly xMax: number;
  readonly yMin: number;
  readonly yMax: number;
  readonly uiMin?: readonly [number, number];
  readonly uiMax?: readonly [number, number];
}

const row = (spec: RowSpec, source: GeometryAssignment['source'], build: string): GeometryAssignment => ({
  id: spec.id,
  mapId: worldMapId(spec.mapId),
  areaId: areaId(spec.areaId),
  orderIndex: spec.orderIndex ?? 0,
  xMin: spec.xMin,
  xMax: spec.xMax,
  yMin: spec.yMin,
  yMax: spec.yMax,
  uiMin: spec.uiMin ?? [0, 0],
  uiMax: spec.uiMax ?? [1, 1],
  source,
  build,
});

/** A QuestieDB frame from `target_bounds` (`bottom`, `top`, `right`, `left`). */
export const questiedbFrame = (
  id: number,
  name: string,
  spec: RowSpec,
  source: GeometryAssignment['source'] = 'questiedb-conversion',
): UiMapGeometry => ({
  uiMapId: uiMapId(id),
  name,
  nameSource: source,
  type: null,
  parent: null,
  assignments: [row(spec, source, source === 'local-db2' ? DB2 : QDB)],
});

const db2Map = (id: number, name: string, type: number, parent: number, specs: readonly RowSpec[]): UiMapGeometry => ({
  uiMapId: uiMapId(id),
  name,
  nameSource: 'db2-csv',
  type,
  parent: uiMapId(parent),
  assignments: specs.map((spec) => row(spec, 'db2-csv', DB2)),
});

export const DUROTAR = questiedbFrame(1411, 'Durotar', {
  id: 46721, mapId: 1, areaId: 14, xMin: -1716.6666259766, xMax: 1808.3332519531, yMin: -7249.9995117188, yMax: -1962.4998779297,
});
export const MULGORE = questiedbFrame(1412, 'Mulgore', {
  id: 46722, mapId: 1, areaId: 215, xMin: -3835.416015625, xMax: 266.666015625, yMin: -3675, yMax: 2479.1669921875,
});
/** Mulgore in the Era frame (`source_bounds`, Era 1.15.9.69722). */
export const MULGORE_ERA = questiedbFrame(1412, 'Mulgore', {
  id: 46722, mapId: 1, areaId: 215, xMin: -3697.9165039062, xMax: -272.91665649414, yMin: -3089.5832519531, yMax: 2047.9166259766,
});
export const THE_BARRENS = questiedbFrame(1413, 'The Barrens', {
  id: 46723, mapId: 1, areaId: 17, xMin: -5143.75, xMax: 1612.4998779297, yMin: -7510.4165039062, yMax: 2622.9165039062,
});
export const EASTERN_PLAGUELANDS = questiedbFrame(1423, 'Eastern Plaguelands', {
  id: 46733, mapId: 0, areaId: 139, xMin: 825, xMax: 3691.6669921875, yMin: -6558.333984375, yMax: -2256.25,
});
/** Eastern Plaguelands in the Era frame (`source_bounds`), for the wrong-frame check (coordinates.md §9). */
export const EASTERN_PLAGUELANDS_ERA = questiedbFrame(1423, 'Eastern Plaguelands', {
  id: 46733, mapId: 0, areaId: 139, xMin: 1218.75, xMax: 3799.9997558594, yMin: -6056.25, yMax: -2185.4165039062,
});
export const REDRIDGE_MOUNTAINS = questiedbFrame(1433, 'Redridge Mountains', {
  id: 46743, mapId: 0, areaId: 44, xMin: -10022.916015625, xMax: -8575, yMin: -3852.083984375, yMax: -1681.25,
});
/** Redridge Mountains in the Era frame (`source_bounds`), for the wrong-frame check (coordinates.md §9). */
export const REDRIDGE_MOUNTAINS_ERA = questiedbFrame(1433, 'Redridge Mountains', {
  id: 46743, mapId: 0, areaId: 44, xMin: -10022.916015625, xMax: -8575, yMin: -3741.6665039062, yMax: -1570.8332519531,
});
export const STORMWIND = questiedbFrame(1453, 'Stormwind City', {
  id: 46763, mapId: 0, areaId: 1519, xMin: -9154.169921875, xMax: -7995.830078125, yMin: -14.58399963379, yMax: 1722.9200439453,
});
/** Stormwind City in the Era frame (`source_bounds`), for the wrong-frame check (coordinates.md §9). */
export const STORMWIND_ERA = questiedbFrame(1453, 'Stormwind City', {
  id: 46763, mapId: 0, areaId: 1519, xMin: -9175.205078125, xMax: -8278.8505859375, yMin: 36.70063018799, yMax: 1380.9714355469,
});
export const ORGRIMMAR = questiedbFrame(1454, 'Orgrimmar', {
  id: 46764, mapId: 1, areaId: 1637, xMin: 1338.4605712891, xMax: 2273.8771972656, yMin: -5083.2055664062, yMax: -3680.6010742188,
});
export const THUNDER_BLUFF = questiedbFrame(1456, 'Thunder Bluff', {
  id: 46766, mapId: 1, areaId: 1638, xMin: -1545.8332519531, xMax: -849.99993896484, yMin: -527.08331298828, yMax: 516.66662597656,
});

export const AZEROTH = db2Map(947, 'Azeroth', 1, 0, [
  {
    id: 46785, mapId: 1, areaId: 0, orderIndex: 0, xMin: -12800, xMax: 12266.700195312, yMin: -9600, yMax: 6933.2998046875,
    uiMin: [0.03990000114, 0.08550000191], uiMax: [0.40830001235, 0.92339998484],
  },
  {
    id: 46784, mapId: 0, areaId: 0, orderIndex: 1, xMin: -16000, xMax: 6933.2998046875, yMin: -7466.7001953125, yMax: 8000,
    uiMin: [0.55049997568, 0.09939999878], uiMax: [0.89660000801, 0.86909997463],
  },
]);
export const KALIMDOR = db2Map(1414, 'Kalimdor', 2, 947, [
  { id: 46724, mapId: 1, areaId: 0, xMin: -11733.299804688, xMax: 12799.900390625, yMin: -19733.2109375, yMax: 17066.599609375 },
]);
export const EASTERN_KINGDOMS = db2Map(1415, 'Eastern Kingdoms', 2, 947, [
  { id: 46725, mapId: 0, areaId: 0, xMin: -16000, xMax: 7466.6000976562, yMin: -19199.900390625, yMax: 16000 },
]);
export const ZEPHRAS_ISLE = db2Map(2521, 'Zephras Isle', 3, 947, [
  { id: 69208, mapId: 2991, areaId: 16593, xMin: 1247.9169921875, xMax: 4956.25, yMin: -1331.25, yMax: 4231.25 },
]);

const coefficients = (scaleX: number, offsetX: number, scaleY: number, offsetY: number): EraToForeverCoefficients => ({
  scaleX, offsetX, scaleY, offsetY, fromBuild: '1.15.9.69722', toBuild: QDB, source: 'questiedb-conversion',
});

export const ERA_TO_FOREVER: readonly (readonly [UiMapId, EraToForeverCoefficients])[] = [
  [uiMapId(1412), coefficients(0.8348002068275978, 7.007453108736848, 0.8349418225477033, 13.15387327724201)],
  [uiMapId(1423), coefficients(0.8997577709204458, -1.6464926382438023, 0.9004358590984077, -3.7790494664060477)],
  [uiMapId(1433), coefficients(0.9999996626080551, -5.086374584221827, 1, 0)],
  [uiMapId(1453), coefficients(0.7736792385183993, 19.680449646264936, 0.773826866980289, 24.433287807510073)],
];

export const FIXTURE_MAPS: readonly UiMapGeometry[] = [
  AZEROTH, DUROTAR, MULGORE, THE_BARRENS, KALIMDOR, EASTERN_KINGDOMS, STORMWIND, ORGRIMMAR, THUNDER_BLUFF, ZEPHRAS_ISLE,
];

/** A placeholder-like geometry over the fixture UiMaps. */
export function fixtureGeometry(maps: readonly UiMapGeometry[] = FIXTURE_MAPS, era = ERA_TO_FOREVER): MapGeometry {
  return createMapGeometry({ kind: 'placeholder', product: 'wow_classic_beta', recordedFrameHash: null, maps, eraToForever: era });
}

/** The two changed zones only the TaxiNodes landmarks need; `fixtureGeometry([...FIXTURE_MAPS, ...LANDMARK_MAPS])`. */
export const LANDMARK_MAPS: readonly UiMapGeometry[] = [EASTERN_PLAGUELANDS, REDRIDGE_MOUNTAINS];

/** The Era frame of each changed UiMap (`source_bounds`), for reading a Forever percent in the wrong frame. */
export const ERA_FRAMES: Readonly<Record<number, UiMapGeometry>> = {
  1412: MULGORE_ERA,
  1423: EASTERN_PLAGUELANDS_ERA,
  1433: REDRIDGE_MOUNTAINS_ERA,
  1453: STORMWIND_ERA,
};

/**
 * Cited `TaxiNodes` rows at 1.60.1.70009 (`ID`, `Pos_0` = world X, `Pos_1` = world Y; D-022) and
 * the QuestieDB Forever flight-master spawns next to them (`data/Forever/foreverNpcDB.lua` at
 * `b6f5b07b`: 352 line 222, 3310 line 2761, 2995 line 2462, 931 line 661, 12617 line 8078, 12636
 * line 8079), coordinates.md §9. `yards` is the distance in the Forever frame; `eraYards` is the
 * distance when the same Forever percent is read with the Era frame (null on unchanged UiMaps).
 * Four landmarks cover three of the four changed frames (1453, 1433, 1423).
 */
export const TAXI_LANDMARKS = [
  { taxiNode: 2, name: 'Stormwind, Elwynn', mapId: 0, x: -8832.76953125, y: 478.62298583984, npc: 352, uiMapId: 1453, spawn: [70.95, 72.51], yards: 11.9, eraYards: 108.9 },
  { taxiNode: 23, name: 'Orgrimmar, Durotar', mapId: 1, x: 1677.5899658203, y: -4315.7099609375, npc: 3310, uiMapId: 1454, spawn: [45.12, 63.89], yards: 2.6, eraYards: null },
  { taxiNode: 22, name: 'Thunder Bluff, Mulgore', mapId: 1, x: -1197.2099609375, y: 29.70999908447, npc: 2995, uiMapId: 1456, spawn: [47.0, 49.83], yards: 3.6, eraYards: null },
  { taxiNode: 5, name: 'Lakeshire, Redridge', mapId: 0, x: -9429.099609375, y: -2231.3999023438, npc: 931, uiMapId: 1433, spawn: [25.5, 59.41], yards: 7.0, eraYards: 107.2 },
  { taxiNode: 67, name: "Light's Hope Chapel, Eastern Plaguelands", mapId: 0, x: 2271.0900878906, y: -5340.7998046875, npc: 12617, uiMapId: 1423, spawn: [71.81, 49.6], yards: 4.9, eraYards: 450.5 },
  { taxiNode: 68, name: "Light's Hope Chapel, Eastern Plaguelands", mapId: 0, x: 2327.4099121094, y: -5286.8901367188, npc: 12636, uiMapId: 1423, spawn: [70.53, 47.55], yards: 3.8, eraYards: 445.0 },
] as const;

/**
 * `TaxiNodes` 25 at 1.60.1.70009 (Crossroads, The Barrens; `ContinentID` 1, `Pos_0`, `Pos_1`),
 * cited for zone attribution: it lies in the Durotar, Mulgore and The Barrens frames (M2 review
 * COORD-5).
 */
export const CROSSROADS_NODE = { taxiNode: 25, mapId: 1, x: -441.79998779297, y: -2596.080078125 } as const;
