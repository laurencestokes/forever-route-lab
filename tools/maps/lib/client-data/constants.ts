/**
 * Fixed facts of the committed client tables (docs/research/map-presentation.md §9, §10, §12.6,
 * §16; D-039 B, C and E). Kept apart from `tools/maps/lib/constants.ts` so that edits there do not
 * change this tool's tree hash; a test checks the pin equals that file's `CLIENT_PIN`.
 */

/** The client build the tables are read from (`LocalCasc.open({ pin })` refuses any other). */
export const CLIENT_TABLES_PIN = { product: 'wow_classic_beta', version: '1.60.1.70009', buildKey: '05215079e3905ef5922ae0b03ffefb73' } as const;

/** The tool's entry point: the root of its module closure (the manifest's tool tree hash). */
export const CLIENT_TABLES_ENTRY = 'tools/maps/client-tables.ts';

/** The committed folder (repository-relative) and its files. */
export const CLIENT_TABLES_DIR = 'public/maps/client';
export const CLIENT_TABLES_MANIFEST = 'manifest.json';
export const CLIENT_TABLES_NOTICE = 'NOTICE.md';
export const CLIENT_TABLE_FILES = { taxi: 'taxi.json', zones: 'zones.json', dungeons: 'dungeons.json' } as const;
export type ClientTableKind = keyof typeof CLIENT_TABLE_FILES;
export const CLIENT_TABLE_KINDS: readonly ClientTableKind[] = ['taxi', 'zones', 'dungeons'];

/** map-presentation.md §16: the folder's own gated budget, gzip level 6, decimal units (also in tools/build/dist-requirements.json). */
export const CLIENT_TABLES_BUDGET_GZIP_BYTES = 40_000;

/** D-039 B: flight shapes are simplified to this tolerance (yards, Douglas-Peucker on x and y). */
export const TAXI_SHAPE_TOLERANCE_YD = 25;

/** The world maps whose flights the taxi file carries: Eastern Kingdoms and Kalimdor (map 2991 has no TaxiNodes). */
export const TAXI_FLIGHT_MAPS: readonly number[] = [0, 1];

/**
 * `TaxiNodes.Flags` bits the file decodes (INFERRED from Era usage; data.md §3): bit 0 Alliance,
 * bit 1 Horde. `TaxiPathNode.Flags` bit 1 (value 2) marks a stop for `Delay` seconds (wowdev.wiki).
 */
export const TAXI_NODE_ALLIANCE_BIT = 1;
export const TAXI_NODE_HORDE_BIT = 2;

/** `AreaTable.Flags[0]` bit 0x800: sanctuary by the wowdev convention (INFERRED for Forever). */
export const AREA_SANCTUARY_BIT = 0x800;

/** `LFGDungeons.TypeID` of the dungeon and raid rows (the zone rows are 4, the battlegrounds 5). */
export const LFG_DUNGEON_TYPE_ID = 0;

/** `Map.InstanceType` of dungeon (1) and raid (2) maps. */
export const INSTANCE_TYPES: readonly number[] = [1, 2];

export const REPOSITORY_URL = 'https://github.com/laurencestokes/forever-route-lab';
