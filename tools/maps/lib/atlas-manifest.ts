import type { EncoderIdentity, WebpSettings } from './encode';
import type { ToolTrees } from './tool-tree';

/**
 * `public/maps/atlas/manifest.json` (docs/research/map-atlas.md §7.4; D-033, D-042): the atlas's
 * provenance. Written by `tools/maps/atlas.ts`, checked offline by `validate.ts` (T1-T9) and by the
 * dist audit's allowlist, which reads `files[].path` and `files[].sha256`. No timestamps: the same
 * inputs give the same bytes.
 */

export const ATLAS_DIR = 'public/maps/atlas';
export const ATLAS_MANIFEST_FILE = 'manifest.json';
export const ATLAS_NOTICE_FILE = 'NOTICE.md';
/** Tile paths: `t/<z>/<x>/<y>.webp`, `z` from −8 to 0. */
export const ATLAS_TILE_PATH = /^t\/(-[1-8]|0)\/(0|[1-9]\d*)\/(0|[1-9]\d*)\.webp$/;

export interface AtlasFileEntry {
  readonly path: string;
  readonly bytes: number;
  readonly sha256: string;
}

export interface AtlasSourceRecord {
  readonly uiMapId: number;
  readonly name: string;
  /** `read`: a continent painting (land test and tint only); `polygon`, `card`, `inset`: drawn. */
  readonly role: 'read' | 'polygon' | 'card' | 'inset';
  readonly cls: string;
  readonly mapId: number;
  readonly assignment: number;
  readonly ydPerPx: number;
  readonly nearestLevel: number;
  readonly topLevel: number;
  /** Tile yards per pixel at the top level over the art's (above 1: coarser than the art). */
  readonly loss: number;
  readonly areas: readonly number[] | null;
  /** The painting's rectangle in atlas units (a card's for the inset). */
  readonly atlasRect: { readonly eMin: number; readonly eMax: number; readonly sMin: number; readonly sMax: number };
  readonly pixelsSha256: string;
  readonly overlaysSha256: string | null;
  readonly inputHash: string;
}

export interface AtlasLevelSummary {
  readonly z: number;
  readonly ydPerPx: number;
  readonly grid: string;
  readonly stored: number;
  readonly virtual: number | null;
  readonly sea: number | null;
  readonly bytes: number;
  readonly gzipBytes: number;
  readonly largestGzipBytes: number;
}

export interface AtlasAlteration {
  readonly id: number;
  readonly what: string;
}

export interface AtlasHiddenLabel {
  readonly uiMapId: number;
  readonly name: string;
  readonly label: string;
  readonly levels: 'all' | 'fine';
  readonly box: readonly number[];
  readonly reason: string;
}

export interface AtlasManifestFacts {
  readonly client: { readonly product: string; readonly version: string; readonly buildKey: string };
  readonly toolTrees: ToolTrees;
  readonly encoder: EncoderIdentity;
  readonly webp: WebpSettings;
  readonly layout: { readonly name: string; readonly seamE: number; readonly extent: Readonly<Record<string, number>>; readonly basis: string };
  readonly atlasHash: string;
  readonly placements: readonly unknown[];
  readonly sources: readonly AtlasSourceRecord[];
  readonly terrain: readonly { readonly path: string; readonly sha256: string }[];
  readonly labels: { readonly file: string; readonly sha256: string; readonly whole: number; readonly hidden: readonly AtlasHiddenLabel[] };
  readonly parameters: Readonly<Record<string, unknown>>;
  readonly sea: { readonly coast: readonly number[]; readonly deep: readonly number[]; readonly measuredCoast: readonly number[] };
  readonly levels: readonly AtlasLevelSummary[];
  readonly seaKeys: Readonly<Record<string, readonly (readonly [number, number])[]>>;
  readonly census: Readonly<Record<string, unknown>>;
  readonly files: readonly AtlasFileEntry[];
}

/** D-042 O11: the five alterations the tiles make to Blizzard's art (listed in the NOTICE and here). */
export const ATLAS_ALTERATIONS: readonly AtlasAlteration[] = [
  { id: 1, what: 'Each painting is masked to its terrain polygon, its painted ground (the explored-overlay union) and a coastal band, and neighbouring paintings\' colour is cross-faded over ±200 yd.' },
  { id: 2, what: 'Painted labels are hidden by a mirror fill from the same painting: the capital banners at levels −1 and 0, where the city plan they name is drawn, and duplicate names at every level (listed under "hiddenLabels").' },
  { id: 3, what: 'This project\'s own relief-shaded tint fills land that no painting shows.' },
  { id: 4, what: 'This project\'s sea colours fill the water outside the paintings\' coastal bands.' },
  { id: 5, what: 'The art is resampled (bilinear, from mip levels; coarser levels are 2×2 box reductions) and re-encoded as WebP at quality 80.' },
];

export function buildAtlasManifest(facts: AtlasManifestFacts): Readonly<Record<string, unknown>> {
  const bytes = facts.files.reduce((sum, f) => sum + f.bytes, 0);
  return {
    _generated: {
      by: 'tools/maps atlas',
      notice: ATLAS_NOTICE_FILE,
      edit: 'do not edit; regenerate with pnpm tsx tools/maps/atlas.ts (needs the pinned client at WOW_INSTALL); the owner signs off the contact sheet (atlas.ts --review) before the tiles are committed (D-042 O8)',
    },
    schema: 1,
    kind: 'map-atlas',
    artwork: {
      owner: 'Blizzard Entertainment',
      notice: ATLAS_NOTICE_FILE,
      decision: 'D-033',
      composition: 'D-042',
      terrain: 'D-032',
      what: "Blizzard Entertainment's painted world-map art from the World of Warcraft: Forever client, composited by this project's tool with terrain-derived masks, tint and shading; not this project's work and not covered by its licence",
    },
    client: facts.client,
    tool: {
      toolTreeHash: facts.toolTrees.trees,
      treeMethod: facts.toolTrees.method,
      encoder: facts.encoder,
      webp: facts.webp,
    },
    unit: 'one atlas unit is one yard; E grows east, S grows south; each world map is placed by translation only; display only, never a distance (D-017)',
    layout: facts.layout,
    atlasHash: facts.atlasHash,
    placements: facts.placements,
    alterations: ATLAS_ALTERATIONS,
    hiddenLabels: facts.labels.hidden,
    labels: { file: facts.labels.file, sha256: facts.labels.sha256, whole: facts.labels.whole, hidden: facts.labels.hidden.length },
    sources: facts.sources,
    terrain: facts.terrain,
    parameters: facts.parameters,
    sea: facts.sea,
    totals: { files: facts.files.length, tiles: facts.files.filter((f) => ATLAS_TILE_PATH.test(f.path)).length, bytes },
    levels: facts.levels,
    seaKeys: facts.seaKeys,
    census: facts.census,
    files: facts.files,
  };
}

// ---------------------------------------------------------------------------------------------
// Reading (validate.ts, tests)

type Json = Readonly<Record<string, unknown>>;
const isRecord = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value);
const isHex = (value: unknown, length: number): value is string => typeof value === 'string' && new RegExp(`^[0-9a-f]{${String(length)}}$`).test(value);
const isInt = (value: unknown, min = 0): value is number => typeof value === 'number' && Number.isInteger(value) && value >= min;

export interface ParsedAtlasManifest {
  readonly client: { readonly product: string; readonly version: string; readonly buildKey: string };
  readonly atlasHash: string;
  readonly layout: string;
  readonly sources: readonly AtlasSourceRecord[];
  readonly files: readonly AtlasFileEntry[];
  readonly levels: readonly AtlasLevelSummary[];
  readonly seaKeys: Readonly<Record<string, readonly (readonly [number, number])[]>>;
  readonly hiddenLabels: readonly AtlasHiddenLabel[];
  readonly alterations: readonly AtlasAlteration[];
  readonly labelsSha256: string;
  readonly census: Json;
  readonly encoder: Json;
  readonly webp: Json;
  readonly parameters: Json;
  readonly sea: Json;
  readonly raw: Json;
}

/** Checks the manifest's shape; `errors` is empty exactly when `manifest` is not null. */
export function parseAtlasManifest(value: unknown): { readonly manifest: ParsedAtlasManifest | null; readonly errors: readonly string[] } {
  const errors: string[] = [];
  if (!isRecord(value)) return { manifest: null, errors: ['(root): must be an object'] };
  if (value['schema'] !== 1) errors.push('schema must be 1');
  if (value['kind'] !== 'map-atlas') errors.push('kind must be "map-atlas"');
  const artwork = value['artwork'];
  if (!isRecord(artwork) || artwork['owner'] !== 'Blizzard Entertainment' || artwork['notice'] !== ATLAS_NOTICE_FILE) errors.push('artwork must name Blizzard Entertainment as the owner and NOTICE.md as the notice');
  const client = value['client'];
  if (!isRecord(client) || typeof client['product'] !== 'string' || typeof client['version'] !== 'string' || !isHex(client['buildKey'], 32)) errors.push('client needs product, version and a 32-hex buildKey');
  const tool = value['tool'];
  if (!isRecord(tool) || !isRecord(tool['toolTreeHash']) || !isRecord(tool['encoder']) || !isRecord(tool['webp'])) errors.push('tool needs toolTreeHash, encoder and webp');
  if (!isHex(value['atlasHash'], 32)) errors.push('atlasHash must be 32 lowercase hex digits');
  const layout = value['layout'];
  if (!isRecord(layout) || typeof layout['name'] !== 'string') errors.push('layout needs a name');
  const alterations = value['alterations'];
  if (!Array.isArray(alterations) || alterations.length !== ATLAS_ALTERATIONS.length) errors.push('alterations must list the five D-042 O11 alterations');
  const labels = value['labels'];
  if (!isRecord(labels) || !isHex(labels['sha256'], 64)) errors.push('labels needs the label list\'s sha256');
  const files: AtlasFileEntry[] = [];
  if (!Array.isArray(value['files']) || value['files'].length === 0) errors.push('files must be a non-empty array');
  else {
    (value['files'] as readonly unknown[]).forEach((f, i) => {
      if (!isRecord(f) || typeof f['path'] !== 'string' || !isInt(f['bytes'], 1) || !isHex(f['sha256'], 64)) errors.push(`files[${String(i)}]: needs path, bytes and sha256`);
      else if (f['path'] !== 'index.json' && !ATLAS_TILE_PATH.test(f['path'])) errors.push(`files[${String(i)}]: ${f['path']} is neither index.json nor a tile path`);
      else files.push({ path: f['path'], bytes: f['bytes'], sha256: f['sha256'] });
    });
  }
  if (new Set(files.map((f) => f.path)).size !== files.length) errors.push('files lists a path twice');
  const sources = value['sources'];
  if (!Array.isArray(sources) || sources.length === 0) errors.push('sources must be a non-empty array');
  else {
    for (const [i, s] of (sources as readonly unknown[]).entries()) {
      if (!isRecord(s) || !isInt(s['uiMapId'], 1) || !isHex(s['pixelsSha256'], 64) || !isHex(s['inputHash'], 64) || (s['overlaysSha256'] !== null && !isHex(s['overlaysSha256'], 64)) || typeof s['topLevel'] !== 'number') {
        errors.push(`sources[${String(i)}]: needs uiMapId, topLevel, pixelsSha256, overlaysSha256 and inputHash`);
      }
    }
  }
  if (!Array.isArray(value['levels'])) errors.push('levels must be an array');
  if (!isRecord(value['seaKeys'])) errors.push('seaKeys must be an object');
  if (!isRecord(value['census'])) errors.push('census must be an object');
  if (!Array.isArray(value['hiddenLabels'])) errors.push('hiddenLabels must be an array');
  if (errors.length > 0 || !isRecord(client) || !isRecord(tool) || !isRecord(layout) || !isRecord(labels)) return { manifest: null, errors };
  return {
    manifest: {
      client: { product: client['product'] as string, version: client['version'] as string, buildKey: client['buildKey'] as string },
      atlasHash: value['atlasHash'] as string,
      layout: layout['name'] as string,
      sources: value['sources'] as readonly AtlasSourceRecord[],
      files,
      levels: value['levels'] as readonly AtlasLevelSummary[],
      seaKeys: value['seaKeys'] as Readonly<Record<string, readonly (readonly [number, number])[]>>,
      hiddenLabels: value['hiddenLabels'] as readonly AtlasHiddenLabel[],
      alterations: value['alterations'] as readonly AtlasAlteration[],
      labelsSha256: labels['sha256'] as string,
      census: value['census'] as Json,
      encoder: tool['encoder'] as Json,
      webp: tool['webp'] as Json,
      parameters: isRecord(value['parameters']) ? value['parameters'] : {},
      sea: isRecord(value['sea']) ? value['sea'] : {},
      raw: value,
    },
    errors: [],
  };
}
