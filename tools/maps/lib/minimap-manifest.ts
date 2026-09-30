import type { EncoderIdentity, WebpSettings } from './encode';
import type { FileRef } from './minimap-inputs';
import type { LiquidGridRecord } from './minimap-liquid';
import { CENSUS_GATES, MINIMAP_BASE_LEVEL, MINIMAP_BUDGET, MINIMAP_MAX_LEVEL, MINIMAP_MIN_LEVEL, MINIMAP_NOTICE_FILE, MINIMAP_TILE, MINIMAP_TILE_PATH, MINIMAP_TOOL_ENTRY, MINIMAP_UNDERLAY_LEVEL, NAVY, PHASE_MAPS_NOT_DRAWN, RECOLOUR, RESAMPLE, SEAM_MEASURE, STITCH_BLOCK } from './minimap-params';

/**
 * `public/maps/minimap/manifest.json` (docs/research/map-atlas.md §18.8; D-033, D-045, D-049): the
 * minimap tiles' provenance. Written by `tools/maps/minimap.ts`, read back by `minimap-checks.ts`
 * (M1-M11) and by the dist audit's allowlist (`files[].path`, `files[].sha256`). No timestamps: the
 * same inputs give the same bytes. It records:
 *
 * - the D-033 artwork notice, the client pin, the tool's module-closure hash, Node, the encoder and
 *   the platform;
 * - the layout's `atlasHash`, the maps drawn and the phase maps deliberately not drawn;
 * - every source: per minimap tile its map, row, column, FileDataID and CKey; the WDTs and root ADTs
 *   likewise; the Map and LiquidType tables; the terrain manifest's SHA-256 and each liquid grid's
 *   hash with its relief check;
 * - every parameter (`minimap-params.ts`), the census with its gates, per level the stored and sea
 *   keys and bytes, every file with its SHA-256, the pack's tree hash and contents, and the
 *   alterations.
 *
 * The pack's SHA-256, and so its asset name and release tag, are not here (the pack holds this
 * file); `pack.json` names and pins it (review finding MD-02).
 */

export interface MinimapFileEntry {
  readonly path: string;
  readonly bytes: number;
  readonly sha256: string;
}

export interface MinimapLevelSummary {
  readonly z: number;
  readonly ydPerPx: number;
  readonly grid: string;
  readonly stored: number;
  readonly sea: number;
  readonly flatNonSea: number;
  readonly bytes: number;
  readonly gzipBytes: number;
  readonly largestGzipBytes: number;
}

export interface MinimapAlteration {
  readonly id: number;
  readonly what: string;
}

/** The alterations the tiles make to Blizzard's minimap textures (§18.8, D-049 O15), each named. */
export const MINIMAP_ALTERATIONS: readonly MinimapAlteration[] = [
  {
    id: 1,
    what:
      'Water is recoloured onto a navy ramp from rgb(13, 27, 48) to rgb(60, 92, 130): by colour, gated by the liquid areas of the client\'s terrain data (the terrain byproducts\' grid, D-032), in full within about 4 yd of water and fading out by about 8 yd (4–8 yd); each tile\'s water takes its reference from a smoothed field of its own wet texels; and the steps between tiles are feathered along each tile edge and corner, with a floor at the navy. The gate reaches dry ground too: water-coloured dry ground within about 8 yd of water (banks, and shallows the terrain data calls dry) may be darkened or shifted toward the navy, but is never brightened.',
  },
  {
    id: 2,
    what: "The void (Zephras Isle's black background and the area beyond the map's tiles) is filled with the navy; the dark haze joined to it is re-composited over the navy; and the strips of flat ground along map edges that face no tile, with sea behind them (the edge skirts, listed in the census), are treated as void.",
  },
  { id: 3, what: 'The textures are resampled from 1.0417 to 1 yd per pixel (Lanczos-3) and reduced by 2 × 2 box filters for the coarser levels.' },
  { id: 4, what: 'The three maps are drawn in one raster by translation only (the compact layout), with Zephras Isle as a card that is not in its real position.' },
  { id: 5, what: 'The tiles are re-encoded lossily as WebP at quality 80.' },
];

/** What is deliberately kept as drawn (§18.5, §19.8; D-049 O16, O20). */
export const MINIMAP_KEPT: readonly string[] = [
  'Coloured water (the bright cyan ponds, the violet river by Dalaran), lava and slime keep their colours.',
  'Swamp and brown water (Dustwallow Marsh, the Swamp of Sorrows) is kept as drawn, olive or brown (O20).',
  'Pure-black texels not joined to the void (the edges of buildings and pits, a few whole black blocks) are kept as drawn (O16).',
];

export interface MinimapManifestFacts {
  readonly client: { readonly product: string; readonly version: string; readonly buildKey: string };
  readonly tool: { readonly hash: string; readonly files: number };
  readonly node: string;
  readonly encoder: EncoderIdentity;
  readonly webp: WebpSettings;
  readonly layout: { readonly name: string; readonly seamE: number; readonly extent: Readonly<Record<string, number>> };
  readonly atlasHash: string;
  readonly placements: readonly unknown[];
  readonly maps: readonly { readonly mapId: number; readonly name: string; readonly directory: string; readonly wdt: FileRef; readonly tiles: number }[];
  readonly minimaps: readonly (readonly [number, number, number, number, string])[];
  readonly rootAdts: readonly (readonly [number, number, number, number, string])[];
  readonly tables: readonly { readonly table: string; readonly fileDataId: number; readonly ckey: string; readonly hazardIds?: readonly number[] }[];
  readonly terrain: { readonly manifestSha256: string; readonly reliefs: readonly { readonly mapId: number; readonly path: string; readonly sha256: string }[] };
  readonly liquidGrids: readonly (LiquidGridRecord & { readonly mapId: number; readonly relief: { readonly compared: number; readonly same: number } | null })[];
  readonly census: Readonly<Record<string, unknown>>;
  readonly levels: readonly MinimapLevelSummary[];
  readonly seaKeys: Readonly<Record<string, readonly (readonly [number, number])[]>>;
  readonly pack: { readonly treeHash: string; readonly contents: readonly string[] };
  readonly files: readonly MinimapFileEntry[];
}

export function minimapParameters(): Readonly<Record<string, unknown>> {
  return {
    tile: MINIMAP_TILE,
    levels: [MINIMAP_MIN_LEVEL, MINIMAP_MAX_LEVEL],
    baseLevel: MINIMAP_BASE_LEVEL,
    underlayLevel: MINIMAP_UNDERLAY_LEVEL,
    stitchBlock: STITCH_BLOCK,
    navy: NAVY,
    recolour: RECOLOUR,
    resample: RESAMPLE,
    seamMeasure: SEAM_MEASURE,
    gates: CENSUS_GATES,
    budget: MINIMAP_BUDGET,
  };
}

export function buildMinimapManifest(f: MinimapManifestFacts): Readonly<Record<string, unknown>> {
  const tiles = f.files.filter((x) => MINIMAP_TILE_PATH.test(x.path));
  return {
    _generated: {
      by: 'tools/maps minimap',
      notice: MINIMAP_NOTICE_FILE,
      edit: 'do not edit; regenerate with pnpm tsx tools/maps/minimap.ts (needs the pinned client at WOW_INSTALL); the owner signs off the contact sheets (minimap.ts --review) before a pack is published (D-049 O18)',
    },
    schema: 1,
    kind: 'map-minimap',
    artwork: {
      owner: 'Blizzard Entertainment',
      notice: MINIMAP_NOTICE_FILE,
      decisions: ['D-033', 'D-045', 'D-049'],
      terrain: 'D-032',
      what: "Blizzard Entertainment's minimap textures from the World of Warcraft: Forever client, recoloured, stitched and resampled by this project's tool; not this project's work and not covered by its licence",
    },
    client: f.client,
    tool: { entry: MINIMAP_TOOL_ENTRY, toolTreeHash: f.tool.hash, toolFiles: f.tool.files, node: f.node, encoder: f.encoder, webp: f.webp },
    unit: 'one atlas unit is one yard; E grows east, S grows south; each world map is placed by translation only; display only, never a distance (D-017)',
    layout: { ...f.layout, maps: f.maps.map((m) => m.mapId), notDrawn: PHASE_MAPS_NOT_DRAWN },
    atlasHash: f.atlasHash,
    placements: f.placements,
    alterations: MINIMAP_ALTERATIONS,
    kept: MINIMAP_KEPT,
    sources: {
      maps: f.maps,
      minimaps: { columns: ['mapId', 'row', 'col', 'fileDataId', 'ckey'], rows: f.minimaps },
      rootAdts: { columns: ['mapId', 'row', 'col', 'fileDataId', 'ckey'], rows: f.rootAdts },
      tables: f.tables,
      terrain: f.terrain,
      liquidGrids: f.liquidGrids,
    },
    parameters: minimapParameters(),
    census: f.census,
    totals: { files: f.files.length, tiles: tiles.length, bytes: f.files.reduce((s, x) => s + x.bytes, 0), tileBytes: tiles.reduce((s, x) => s + x.bytes, 0) },
    levels: f.levels,
    seaKeys: f.seaKeys,
    pack: f.pack,
    files: f.files,
  };
}

// ---------------------------------------------------------------------------------------------
// Reading (the notice, the checks, tests)

type Json = Readonly<Record<string, unknown>>;
const isRecord = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value);
const isHex = (value: unknown, length: number): value is string => typeof value === 'string' && new RegExp(`^[0-9a-f]{${String(length)}}$`).test(value);
const isInt = (value: unknown, min = 0): value is number => typeof value === 'number' && Number.isInteger(value) && value >= min;

export interface ParsedMinimapManifest {
  readonly raw: Json;
  readonly client: { readonly product: string; readonly version: string; readonly buildKey: string };
  readonly encoder: Readonly<Record<string, unknown>>;
  readonly webp: Readonly<Record<string, unknown>>;
  readonly atlasHash: string;
  readonly maps: readonly { readonly mapId: number; readonly name: string; readonly directory: string; readonly tiles: number }[];
  readonly notDrawn: readonly { readonly mapId: number; readonly reason: string }[];
  readonly alterations: readonly MinimapAlteration[];
  readonly kept: readonly string[];
  readonly levels: readonly MinimapLevelSummary[];
  readonly seaKeys: Readonly<Record<string, readonly (readonly [number, number])[]>>;
  readonly pack: { readonly treeHash: string; readonly contents: readonly string[] };
  readonly files: readonly MinimapFileEntry[];
}

/** Checks the manifest's shape; `errors` is empty exactly when `manifest` is not null. */
export function parseMinimapManifest(value: unknown): { readonly manifest: ParsedMinimapManifest | null; readonly errors: readonly string[] } {
  const errors: string[] = [];
  if (!isRecord(value)) return { manifest: null, errors: ['(root): must be an object'] };
  if (value['schema'] !== 1) errors.push('schema must be 1');
  if (value['kind'] !== 'map-minimap') errors.push('kind must be "map-minimap"');
  const client = value['client'];
  if (!isRecord(client) || typeof client['product'] !== 'string' || typeof client['version'] !== 'string' || !isHex(client['buildKey'], 32)) errors.push('client needs product, version and a 32-hex buildKey');
  const tool = value['tool'];
  if (!isRecord(tool) || !isHex(tool['toolTreeHash'], 64) || !isRecord(tool['encoder']) || !isRecord(tool['webp'])) errors.push('tool needs toolTreeHash, encoder and webp');
  if (!isHex(value['atlasHash'], 32)) errors.push('atlasHash must be 32 hex digits');
  const layout = value['layout'];
  if (!isRecord(layout) || !Array.isArray(layout['maps']) || !Array.isArray(layout['notDrawn'])) errors.push('layout needs maps and notDrawn');
  const sources = value['sources'];
  if (!isRecord(sources) || !Array.isArray(sources['maps'])) errors.push('sources needs maps');
  const alterations = value['alterations'];
  if (!Array.isArray(alterations) || alterations.length === 0 || !alterations.every((a) => isRecord(a) && isInt(a['id'], 1) && typeof a['what'] === 'string')) errors.push('alterations must list { id, what }');
  if (!Array.isArray(value['kept']) || !value['kept'].every((k) => typeof k === 'string')) errors.push('kept must list strings');
  const levels = value['levels'];
  if (!Array.isArray(levels) || levels.length !== MINIMAP_MAX_LEVEL - MINIMAP_MIN_LEVEL + 1) errors.push('levels must list every level −8 … 0');
  if (!isRecord(value['seaKeys'])) errors.push('seaKeys must be an object');
  const pack = value['pack'];
  if (!isRecord(pack) || !isHex(pack['treeHash'], 64) || !Array.isArray(pack['contents'])) errors.push('pack needs treeHash and contents');
  else if ('asset' in pack || 'tag' in pack) errors.push("pack must not name the asset or the tag: they carry the pack's SHA-256, which only pack.json can hold (MD-02)");
  const files = value['files'];
  if (!Array.isArray(files)) errors.push('files must be an array');
  else {
    for (const [i, entry] of (files as unknown[]).entries()) {
      if (!isRecord(entry) || typeof entry['path'] !== 'string' || !isInt(entry['bytes']) || !isHex(entry['sha256'], 64)) {
        errors.push(`files[${String(i)}]: needs path, bytes and sha256`);
        break;
      }
    }
  }
  if (!isRecord(value['census'])) errors.push('census must be an object');
  if (!isRecord(value['parameters'])) errors.push('parameters must be an object');
  if (errors.length > 0 || !isRecord(client) || !isRecord(tool) || !isRecord(layout) || !isRecord(sources) || !isRecord(pack)) return { manifest: null, errors };
  return {
    manifest: {
      raw: value,
      client: { product: String(client['product']), version: String(client['version']), buildKey: String(client['buildKey']) },
      encoder: tool['encoder'] as Json,
      webp: tool['webp'] as Json,
      atlasHash: String(value['atlasHash']),
      maps: (sources['maps'] as Json[]).map((m) => ({ mapId: Number(m['mapId']), name: String(m['name']), directory: String(m['directory']), tiles: Number(m['tiles']) })),
      notDrawn: layout['notDrawn'] as { mapId: number; reason: string }[],
      alterations: alterations as MinimapAlteration[],
      kept: value['kept'] as string[],
      levels: levels as MinimapLevelSummary[],
      seaKeys: value['seaKeys'] as Record<string, [number, number][]>,
      pack: { treeHash: String(pack['treeHash']), contents: pack['contents'] as string[] },
      files: files as MinimapFileEntry[],
    },
    errors,
  };
}
