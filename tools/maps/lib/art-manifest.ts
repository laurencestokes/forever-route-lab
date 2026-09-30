import type { ArtBounds } from './art';
import type { EncoderIdentity, WebpSettings } from './encode';
import type { ToolTrees } from './tool-tree';

export type { ArtBounds };

/**
 * `public/maps/art/manifest.json` (terrain-navigation.md §13.4; docs/MAPS.md §5.2, §5.3; D-033):
 * the committed painted map art's provenance. Written by `convert.ts`, checked offline by
 * `validate.ts` (A1-A5) and by the dist audit's image allowlist, which reads `files[].path` and
 * `files[].sha256` (tools/build/lib/audit.ts). No timestamps: the same inputs give the same bytes.
 */

export const ART_DIR = 'public/maps/art';
export const ART_MANIFEST_FILE = 'manifest.json';
export const ART_NOTICE_FILE = 'NOTICE.md';
/** Published art file names: `<uiMapId>.webp`, or `<uiMapId>-<layer>.webp` for a layer other than 0. */
export const ART_FILE_NAME = /^[1-9]\d*(-[1-9]\d*)?\.webp$/;

export interface ArtOverlayEntry {
  readonly id: number;
  readonly areaIds: readonly number[];
  /** Overlay tile FileDataIDs, row-major. */
  readonly tiles: readonly number[];
}

export interface ArtFileEntry {
  readonly path: string;
  readonly uiMapId: number;
  readonly name: string;
  readonly uiMapType: number;
  readonly uiMapArtId: number;
  readonly styleId: number;
  readonly layer: number;
  readonly contentType: 'image/webp';
  readonly width: number;
  readonly height: number;
  readonly bytes: number;
  readonly sha256: string;
  /** SHA-256 of the composed RGBA before encoding (raster.ts `rasterSha256`), encoder-independent. */
  readonly pixelsSha256: string;
  /** SHA-256 over the sorted (FileDataID, CKey) list of the BLP tiles and DB2 tables it was made from (input-hash.ts). */
  readonly inputHash: string;
  /** Base tile FileDataIDs, row-major. */
  readonly tiles: readonly number[];
  readonly overlays: readonly ArtOverlayEntry[];
  /** The world rectangle the image covers when the UiMap has exactly one full-rectangle OrderIndex 0 row, else null. */
  readonly bounds: ArtBounds | null;
  /** Every `UiMapAssignment` ID of the UiMap, ascending. */
  readonly assignments: readonly number[];
}

/**
 * One composed UiMap's lossless identity (docs/research/map-atlas.md §7.4, §7.5 T5; ATL.6): the
 * pixel hash of the fully explored image and of its explored-overlay union (the overlays alone,
 * source-over on a transparent canvas; null when the plan has no overlays), both before encoding.
 * `convert.ts` keeps one record for every UiMap it composes, whether or not its image is deployed,
 * so the atlas build (tools/maps/atlas.ts), which reads the same rasters from the client, can prove
 * its inputs are these, and `validate.ts` T5 can check the atlas manifest against them offline.
 */
export interface ArtSourceEntry {
  readonly uiMapId: number;
  readonly layer: number;
  readonly name: string;
  readonly width: number;
  readonly height: number;
  readonly pixelsSha256: string;
  readonly overlaysSha256: string | null;
  readonly inputHash: string;
}

export interface ArtTableEntry {
  readonly table: string;
  readonly fileDataId: number;
  readonly ckey: string;
  readonly rows: number;
}

/**
 * Which composed images are deployed, and why (D-042 O5; docs/research/map-atlas.md §7.6, step
 * ATL.10): the manifest's `files` are the listed UiMaps' images; every composed UiMap keeps its
 * `sources` record. Null in a manifest whose every composed image is written (a local `--all` folder).
 */
export interface ArtDeployment {
  /** UiMap ids, ascending. */
  readonly uiMaps: readonly number[];
  readonly reason: string;
}

export interface ArtManifestFacts {
  readonly client: { readonly product: string; readonly version: string; readonly buildKey: string };
  readonly toolTrees: ToolTrees;
  readonly layoutBuild: string;
  readonly encoder: EncoderIdentity;
  readonly webp: WebpSettings;
  readonly tables: readonly ArtTableEntry[];
  readonly skippedUiMaps: readonly { readonly uiMapId: number; readonly reason: string }[];
  readonly skippedOverlays: readonly { readonly uiMapId: number; readonly overlayId: number; readonly reason: string }[];
  readonly files: readonly ArtFileEntry[];
  readonly sources: readonly ArtSourceEntry[];
  readonly deployment: ArtDeployment | null;
}

export const ART_RULES = {
  phase: 'UiMapXMapArt rows with PhaseID 0 only',
  tiles: 'UiMapArtTile of the art and layer at (ColIndex x TileWidth, RowIndex x TileHeight) on a LayerWidth x LayerHeight canvas; edge tiles cropped',
  overlays:
    'fully explored: every WorldMapOverlay of the art with PlayerConditionID 0, in ID order, source-over; WorldMapOverlayTile at (OffsetX + ColIndex x TileWidth, OffsetY + RowIndex x TileHeight) at the file pixel size, cut to the overlay rectangle',
  decoding: 'BLP2 mip 0 (tools/maps/lib/blp.ts, this project\'s decoder); straight alpha',
  inputHash: 'SHA-256 over "<FileDataID> <CKey>\\n" lines, ascending, of the BLP tiles and the DB2 tables (tools/casc/input-hash.ts)',
  pixelsSha256: 'SHA-256 of "frl-rgba8 <width> <height>\\n" + the RGBA bytes before encoding (tools/maps/lib/raster.ts)',
  sources:
    'one record per composed UiMap and layer, deployed or not: pixelsSha256 of the fully explored image and overlaysSha256 of its explored-overlay union (every overlay source-over on a transparent canvas; null without overlays), both before encoding; the atlas build (tools/maps/atlas.ts) checks the rasters it reads from the client against them (docs/research/map-atlas.md §7.5 T5)',
} as const;

export function buildArtManifest(facts: ArtManifestFacts): Readonly<Record<string, unknown>> {
  return {
    _generated: {
      by: 'tools/maps convert',
      notice: ART_NOTICE_FILE,
      edit: 'do not edit; regenerate with pnpm tsx tools/maps/convert.ts (needs the pinned client at WOW_INSTALL)',
    },
    schema: 1,
    kind: 'map-art',
    artwork: {
      owner: 'Blizzard Entertainment',
      notice: ART_NOTICE_FILE,
      decision: 'D-033',
      what: 'painted world-map art extracted from the World of Warcraft: Forever client; not this project\'s work and not covered by its licence',
    },
    client: facts.client,
    tool: {
      toolTreeHash: facts.toolTrees.trees,
      treeMethod: facts.toolTrees.method,
      layouts: `WoWDBDefs cf84e010f84ba9c8d48fd61730f92bf0d8f2b1cd (tools/casc/layouts.ts, build ${facts.layoutBuild})`,
      encoder: facts.encoder,
      webp: facts.webp,
    },
    rules: ART_RULES,
    tables: facts.tables,
    skipped: { uiMaps: facts.skippedUiMaps, overlays: facts.skippedOverlays },
    deployment: facts.deployment,
    totals: {
      files: facts.files.length,
      bytes: facts.files.reduce((sum, file) => sum + file.bytes, 0),
      tiles: facts.files.reduce((sum, file) => sum + file.tiles.length, 0),
      overlays: facts.files.reduce((sum, file) => sum + file.overlays.length, 0),
      overlayTiles: facts.files.reduce((sum, file) => sum + file.overlays.reduce((n, o) => n + o.tiles.length, 0), 0),
    },
    files: facts.files,
    sources: facts.sources,
  };
}

// ---------------------------------------------------------------------------------------------
// Reading (validate.ts, tests)

export interface ParsedArtManifest {
  readonly client: { readonly product: string; readonly version: string; readonly buildKey: string };
  readonly encoder: Readonly<Record<string, unknown>>;
  readonly webp: Readonly<Record<string, unknown>>;
  readonly toolTreeHash: Readonly<Record<string, string>>;
  readonly tables: readonly ArtTableEntry[];
  readonly files: readonly ArtFileEntry[];
  /** The lossless identity of every composed UiMap (`sources`), in (uiMapId, layer) order. */
  readonly sources: readonly ArtSourceEntry[];
  /** Which composed images are deployed (`files`), and why; null when every composed image is. */
  readonly deployment: ArtDeployment | null;
  /** UiMaps the build left without an image (`skipped.uiMaps[].uiMapId`). */
  readonly skippedUiMaps: readonly number[];
  readonly skippedOverlays: number;
}

type Json = Readonly<Record<string, unknown>>;
const isRecord = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value);
const isInt = (value: unknown, min = 0): value is number => typeof value === 'number' && Number.isInteger(value) && value >= min;
const isHex = (value: unknown, length: number): value is string => typeof value === 'string' && new RegExp(`^[0-9a-f]{${String(length)}}$`).test(value);
const intList = (value: unknown, min = 0): value is readonly number[] => Array.isArray(value) && value.every((v) => isInt(v, min));

function readBounds(value: unknown, where: string, errors: string[]): ArtBounds | null {
  if (value === null) return null;
  if (!isRecord(value) || !isInt(value['assignment'], 1) || !isInt(value['mapId'])) {
    errors.push(`${where}.bounds: needs assignment, mapId, xMin, xMax, yMin, yMax`);
    return null;
  }
  const edges = ['xMin', 'xMax', 'yMin', 'yMax'].map((k) => value[k]);
  if (!edges.every((v) => typeof v === 'number' && Number.isFinite(v))) {
    errors.push(`${where}.bounds: edges must be finite numbers`);
    return null;
  }
  const [xMin, xMax, yMin, yMax] = edges as number[];
  return { assignment: value['assignment'], mapId: value['mapId'], xMin: xMin ?? 0, xMax: xMax ?? 0, yMin: yMin ?? 0, yMax: yMax ?? 0 };
}

function readFile(value: unknown, index: number, errors: string[]): ArtFileEntry | null {
  const where = `files[${String(index)}]`;
  if (!isRecord(value)) {
    errors.push(`${where}: must be an object`);
    return null;
  }
  const problems: string[] = [];
  const path = value['path'];
  if (typeof path !== 'string' || !ART_FILE_NAME.test(path)) problems.push('path must be <uiMapId>.webp or <uiMapId>-<layer>.webp');
  for (const key of ['uiMapId', 'uiMapArtId', 'styleId', 'width', 'height', 'bytes']) if (!isInt(value[key], 1)) problems.push(`${key} must be a positive integer`);
  for (const key of ['uiMapType', 'layer']) if (!isInt(value[key])) problems.push(`${key} must be a non-negative integer`);
  if (typeof value['name'] !== 'string') problems.push('name must be a string');
  if (value['contentType'] !== 'image/webp') problems.push('contentType must be image/webp');
  for (const key of ['sha256', 'pixelsSha256', 'inputHash']) if (!isHex(value[key], 64)) problems.push(`${key} must be a lowercase hex SHA-256`);
  const tiles = value['tiles'];
  if (!intList(tiles, 1) || tiles.length === 0) problems.push('tiles must be a non-empty list of FileDataIDs');
  if (!intList(value['assignments'], 1)) problems.push('assignments must be a list of UiMapAssignment IDs');
  const overlays: ArtOverlayEntry[] = [];
  if (!Array.isArray(value['overlays'])) problems.push('overlays must be an array');
  else {
    (value['overlays'] as readonly unknown[]).forEach((o, k) => {
      const overlayTiles = isRecord(o) ? o['tiles'] : undefined;
      if (!isRecord(o) || !isInt(o['id'], 1) || !intList(o['areaIds'], 1) || !intList(overlayTiles, 1) || overlayTiles.length === 0) {
        problems.push(`overlays[${String(k)}] needs id, areaIds and a non-empty tiles list`);
      } else overlays.push({ id: o['id'], areaIds: o['areaIds'], tiles: overlayTiles });
    });
  }
  const bounds = readBounds(value['bounds'], where, problems);
  if (problems.length > 0) {
    errors.push(...problems.map((p) => `${where}: ${p}`));
    return null;
  }
  const layer = value['layer'] as number;
  const uiMapId = value['uiMapId'] as number;
  if (path !== (layer === 0 ? `${String(uiMapId)}.webp` : `${String(uiMapId)}-${String(layer)}.webp`)) {
    errors.push(`${where}: path ${String(path)} does not name UiMap ${String(uiMapId)} layer ${String(layer)}`);
    return null;
  }
  return {
    path,
    uiMapId,
    name: value['name'] as string,
    uiMapType: value['uiMapType'] as number,
    uiMapArtId: value['uiMapArtId'] as number,
    styleId: value['styleId'] as number,
    layer,
    contentType: 'image/webp',
    width: value['width'] as number,
    height: value['height'] as number,
    bytes: value['bytes'] as number,
    sha256: value['sha256'] as string,
    pixelsSha256: value['pixelsSha256'] as string,
    inputHash: value['inputHash'] as string,
    tiles: value['tiles'] as readonly number[],
    overlays,
    bounds,
    assignments: value['assignments'] as readonly number[],
  };
}

/** Checks the manifest's shape; `errors` is empty exactly when `manifest` is not null. */
export function parseArtManifest(value: unknown): { readonly manifest: ParsedArtManifest | null; readonly errors: readonly string[] } {
  const errors: string[] = [];
  if (!isRecord(value)) return { manifest: null, errors: ['(root): must be an object'] };
  if (value['schema'] !== 1) errors.push('schema must be 1');
  if (value['kind'] !== 'map-art') errors.push('kind must be "map-art"');
  const artwork = value['artwork'];
  if (!isRecord(artwork) || artwork['owner'] !== 'Blizzard Entertainment' || artwork['notice'] !== ART_NOTICE_FILE) {
    errors.push('artwork must name Blizzard Entertainment as the owner and NOTICE.md as the notice');
  }
  const client = value['client'];
  if (!isRecord(client) || typeof client['product'] !== 'string' || typeof client['version'] !== 'string' || !isHex(client['buildKey'], 32)) {
    errors.push('client needs product, version and a 32-hex buildKey');
  }
  const tool = value['tool'];
  const trees = isRecord(tool) ? tool['toolTreeHash'] : undefined;
  if (!isRecord(trees) || Object.keys(trees).length === 0 || !Object.values(trees).every((t) => isHex(t, 40))) errors.push('tool.toolTreeHash must map tool directories to git tree ids');
  if (!isRecord(tool) || !isRecord(tool['encoder']) || !isRecord(tool['webp'])) errors.push('tool needs encoder and webp');
  const tables: ArtTableEntry[] = [];
  if (!Array.isArray(value['tables'])) errors.push('tables must be an array');
  else {
    for (const t of value['tables'] as readonly unknown[]) {
      if (!isRecord(t) || typeof t['table'] !== 'string' || !isInt(t['fileDataId'], 1) || !isHex(t['ckey'], 32) || !isInt(t['rows'])) errors.push('tables[]: needs table, fileDataId, ckey, rows');
      else tables.push({ table: t['table'], fileDataId: t['fileDataId'], ckey: t['ckey'], rows: t['rows'] });
    }
  }
  const files: ArtFileEntry[] = [];
  if (!Array.isArray(value['files']) || value['files'].length === 0) errors.push('files must be a non-empty array');
  else (value['files'] as readonly unknown[]).forEach((f, i) => {
    const file = readFile(f, i, errors);
    if (file !== null) files.push(file);
  });
  const paths = files.map((f) => f.path);
  if (new Set(paths).size !== paths.length) errors.push('files lists a path twice');
  const sorted = [...files].sort((a, b) => a.uiMapId - b.uiMapId || a.layer - b.layer);
  if (sorted.some((f, i) => f !== files[i])) errors.push('files must be in (uiMapId, layer) order');
  const sources: ArtSourceEntry[] = [];
  if (!Array.isArray(value['sources'])) errors.push('sources must be an array');
  else {
    (value['sources'] as readonly unknown[]).forEach((entry, i) => {
      const where = `sources[${String(i)}]`;
      if (!isRecord(entry)) {
        errors.push(`${where}: must be an object`);
        return;
      }
      const problems: string[] = [];
      for (const key of ['uiMapId', 'width', 'height']) if (!isInt(entry[key], 1)) problems.push(`${key} must be a positive integer`);
      if (!isInt(entry['layer'])) problems.push('layer must be a non-negative integer');
      if (typeof entry['name'] !== 'string') problems.push('name must be a string');
      for (const key of ['pixelsSha256', 'inputHash']) if (!isHex(entry[key], 64)) problems.push(`${key} must be a lowercase hex SHA-256`);
      if (entry['overlaysSha256'] !== null && !isHex(entry['overlaysSha256'], 64)) problems.push('overlaysSha256 must be a lowercase hex SHA-256 or null');
      if (problems.length > 0) {
        errors.push(...problems.map((p) => `${where}: ${p}`));
        return;
      }
      sources.push({
        uiMapId: entry['uiMapId'] as number,
        layer: entry['layer'] as number,
        name: entry['name'] as string,
        width: entry['width'] as number,
        height: entry['height'] as number,
        pixelsSha256: entry['pixelsSha256'] as string,
        overlaysSha256: entry['overlaysSha256'] as string | null,
        inputHash: entry['inputHash'] as string,
      });
    });
  }
  const sortedSources = [...sources].sort((a, b) => a.uiMapId - b.uiMapId || a.layer - b.layer);
  if (sortedSources.some((entry, i) => entry !== sources[i])) errors.push('sources must be in (uiMapId, layer) order');
  if (new Set(sources.map((entry) => `${String(entry.uiMapId)}-${String(entry.layer)}`)).size !== sources.length) errors.push('sources lists a UiMap and layer twice');
  for (const file of files) {
    const record = sources.find((entry) => entry.uiMapId === file.uiMapId && entry.layer === file.layer);
    if (record === undefined) errors.push(`${file.path}: no sources record`);
    else if (record.pixelsSha256 !== file.pixelsSha256 || record.inputHash !== file.inputHash) errors.push(`${file.path}: its sources record disagrees with its pixelsSha256 or inputHash`);
  }
  let deployment: ArtDeployment | null = null;
  const deploymentValue = value['deployment'];
  if (deploymentValue !== null && deploymentValue !== undefined) {
    if (!isRecord(deploymentValue) || !intList(deploymentValue['uiMaps'], 1) || typeof deploymentValue['reason'] !== 'string' || deploymentValue['reason'] === '') {
      errors.push('deployment must be null or name its UiMaps and a reason');
    } else {
      const uiMaps = deploymentValue['uiMaps'];
      if (uiMaps.some((id, i) => i > 0 && id <= (uiMaps[i - 1] ?? 0))) errors.push('deployment.uiMaps must be ascending, without repeats');
      deployment = { uiMaps, reason: deploymentValue['reason'] };
      const composed = new Set(sources.map((entry) => entry.uiMapId));
      const wanted = uiMaps.filter((id) => composed.has(id));
      const written = [...new Set(files.map((file) => file.uiMapId))];
      if (written.length !== wanted.length || written.some((id) => !wanted.includes(id))) {
        errors.push(`files must be exactly the images of deployment.uiMaps that were composed (${wanted.join(', ')}), not ${written.join(', ')}`);
      }
    }
  }
  const skipped = value['skipped'];
  const skippedOverlays = isRecord(skipped) && Array.isArray(skipped['overlays']) ? skipped['overlays'].length : 0;
  const skippedUiMaps: number[] = [];
  if (!isRecord(skipped) || !Array.isArray(skipped['uiMaps']) || !Array.isArray(skipped['overlays'])) errors.push('skipped needs uiMaps and overlays arrays');
  else {
    for (const s of skipped['uiMaps'] as readonly unknown[]) {
      if (!isRecord(s) || !isInt(s['uiMapId'], 1) || typeof s['reason'] !== 'string') errors.push('skipped.uiMaps[]: needs uiMapId and reason');
      else skippedUiMaps.push(s['uiMapId']);
    }
  }
  if (errors.length > 0 || !isRecord(client) || !isRecord(tool) || !isRecord(trees)) return { manifest: null, errors };
  return {
    manifest: {
      client: { product: client['product'] as string, version: client['version'] as string, buildKey: client['buildKey'] as string },
      encoder: tool['encoder'] as Json,
      webp: tool['webp'] as Json,
      toolTreeHash: trees as Readonly<Record<string, string>>,
      tables,
      files,
      sources,
      deployment,
      skippedUiMaps,
      skippedOverlays,
    },
    errors: [],
  };
}
