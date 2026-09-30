import { gzipSize } from '../../build/lib/audit';
import { buildArtManifest, parseArtManifest, type ArtBounds, type ArtDeployment, type ArtFileEntry, type ArtManifestFacts, type ArtSourceEntry } from './art-manifest';
import { artNoticeText } from './art-notice';
import { artFileName, planArt, planFileDataIds, type ArtPlan } from './art-plan';
import type { AssignmentRow, ClientMapTables } from './client-tables';
import { composeArt, type ComposeStats } from './compose';
import { encodeWebp, type EncoderIdentity, type WebpSettings } from './encode';
import { inputHash, type ClientInput } from '../../casc/input-hash';
import { formatJson } from './json';
import { rasterSha256, type Rgba } from './raster';
import { sha256Hex } from './hash';
import type { ToolTrees } from './tool-tree';

/**
 * The whole map-art build in memory (docs/MAPS.md §5.4 (b); terrain-navigation.md §13.4;
 * D-033): plan every UiMap's image from the tables, decode and compose its tiles, encode it, and
 * write the manifest and NOTICE texts. `convert.ts` feeds it from the client; tests feed it
 * synthetic tables and BLPs. It never touches the file system.
 */

export interface ArtSource {
  readonly tables: ClientMapTables;
  /** A BLP tile's bytes and CKey; must throw when the file is missing or encrypted. */
  readonly read: (fileDataId: number) => { readonly data: Uint8Array; readonly ckey: string };
}

export interface ArtBuildOptions {
  readonly client: { readonly product: string; readonly version: string; readonly buildKey: string };
  readonly toolTrees: ToolTrees;
  readonly encoder: EncoderIdentity;
  readonly webp: WebpSettings;
  /**
   * The UiMaps whose images are written, and why (D-042 O5; step ATL.10): `convert.ts` passes
   * `DEPLOYED_ART_UIMAPS`. Every plan is still composed and keeps its `sources` record, which the
   * atlas build checks its client rasters against. Omitted: every composed image is written (the
   * set before ATL.10; `convert.ts --all` for a local folder).
   */
  readonly deploy?: ArtDeployment | undefined;
}

export interface BuiltArtFile {
  readonly entry: ArtFileEntry;
  readonly bytes: Buffer;
  readonly gzipBytes: number;
  readonly stats: ComposeStats;
  /** The (FileDataID, CKey) list its input hash covers. */
  readonly inputs: readonly ClientInput[];
}

export interface ArtBuild {
  readonly files: readonly BuiltArtFile[];
  readonly manifestText: string;
  readonly noticeText: string;
  readonly skippedUiMaps: readonly { readonly uiMapId: number; readonly reason: string }[];
  readonly skippedOverlays: readonly { readonly uiMapId: number; readonly overlayId: number; readonly reason: string }[];
}

const FULL = (row: AssignmentRow): boolean => row.uiMin[0] === 0 && row.uiMin[1] === 0 && row.uiMax[0] === 1 && row.uiMax[1] === 1;

/** The world rectangle of a UiMap with exactly one row, OrderIndex 0 with the full UI rectangle (docs/MAPS.md §5.3 `bounds`). */
export function artBounds(rows: readonly AssignmentRow[]): ArtBounds | null {
  const [row] = rows;
  if (rows.length !== 1 || row === undefined || row.orderIndex !== 0 || !FULL(row)) return null;
  const [xMin, yMin, , xMax, yMax] = row.region;
  if (xMin === undefined || yMin === undefined || xMax === undefined || yMax === undefined) throw new Error(`UiMapAssignment ${String(row.id)}: Region has fewer than 5 values`);
  return { assignment: row.id, mapId: row.mapId, xMin, xMax, yMin, yMax };
}

function entryOf(plan: ArtPlan, file: { bytes: Buffer; pixelsSha256: string; inputHash: string }, assignments: readonly AssignmentRow[]): ArtFileEntry {
  return {
    path: artFileName(plan, 'webp'),
    uiMapId: plan.uiMapId,
    name: plan.name,
    uiMapType: plan.uiMapType,
    uiMapArtId: plan.uiMapArtId,
    styleId: plan.styleId,
    layer: plan.layerIndex,
    contentType: 'image/webp',
    width: plan.width,
    height: plan.height,
    bytes: file.bytes.length,
    sha256: sha256Hex(file.bytes),
    pixelsSha256: file.pixelsSha256,
    inputHash: file.inputHash,
    tiles: plan.tiles.map((t) => t.fileDataId),
    overlays: plan.overlays.map((o) => ({ id: o.id, areaIds: o.areaIds, tiles: o.tiles.map((t) => t.fileDataId) })),
    bounds: artBounds(assignments),
    assignments: assignments.map((r) => r.id).sort((a, b) => a - b),
  };
}

/**
 * The explored-overlay union of a plan: every overlay drawn source-over, in ID order, on a
 * transparent canvas without the base tiles (the atlas's painted-ground mask, map-atlas.md §6.2),
 * or null when the plan has no overlays.
 */
export function composeOverlayUnion(plan: ArtPlan, read: (fileDataId: number) => Uint8Array): Rgba | null {
  return plan.overlays.length === 0 ? null : composeArt({ ...plan, tiles: [] }, read).image;
}

/** A plan's lossless rasters and their inputs (what `convert.ts` records in `sources` and the atlas build reads). */
export interface SourceRasters {
  readonly plan: ArtPlan;
  readonly full: Rgba;
  readonly overlays: Rgba | null;
  readonly stats: ComposeStats;
  readonly inputs: readonly ClientInput[];
  readonly record: ArtSourceEntry;
}

/** Composes one plan's fully explored image and its overlay union, with the `sources` record of both. */
export function composeSourceRasters(plan: ArtPlan, source: ArtSource): SourceRasters {
  const tableInputs: ClientInput[] = source.tables.inputs.map((t) => ({ fileDataId: t.fileDataId, ckey: t.ckey }));
  const ckeys = new Map<number, string>();
  const read = (fileDataId: number): Uint8Array => {
    const file = source.read(fileDataId);
    ckeys.set(fileDataId, file.ckey);
    return file.data;
  };
  const { image, stats } = composeArt(plan, read);
  const overlays = composeOverlayUnion(plan, read);
  const inputs = [...planFileDataIds(plan).map((id) => ({ fileDataId: id, ckey: ckeys.get(id) ?? '' })), ...tableInputs];
  const record: ArtSourceEntry = {
    uiMapId: plan.uiMapId,
    layer: plan.layerIndex,
    name: plan.name,
    width: plan.width,
    height: plan.height,
    pixelsSha256: rasterSha256(image),
    overlaysSha256: overlays === null ? null : rasterSha256(overlays),
    inputHash: inputHash(inputs),
  };
  return { plan, full: image, overlays, stats, inputs: [...inputs].sort((a, b) => a.fileDataId - b.fileDataId), record };
}

export async function buildArtSet(source: ArtSource, options: ArtBuildOptions): Promise<ArtBuild> {
  const report = planArt(source.tables.art);
  const files: BuiltArtFile[] = [];
  const sources: ArtSourceEntry[] = [];
  const deployed = options.deploy === undefined ? null : new Set(options.deploy.uiMaps);
  for (const plan of report.plans) {
    const composed = composeSourceRasters(plan, source);
    sources.push(composed.record);
    if (deployed !== null && !deployed.has(plan.uiMapId)) continue;
    const bytes = await encodeWebp(composed.full, options.webp);
    const assignments = source.tables.assignments.filter((r) => r.uiMapId === plan.uiMapId).sort((a, b) => a.orderIndex - b.orderIndex || a.id - b.id);
    const entry = entryOf(plan, { bytes, pixelsSha256: composed.record.pixelsSha256, inputHash: composed.record.inputHash }, assignments);
    files.push({ entry, bytes, gzipBytes: gzipSize(bytes), stats: composed.stats, inputs: composed.inputs });
  }
  const facts: ArtManifestFacts = {
    client: options.client,
    toolTrees: options.toolTrees,
    layoutBuild: source.tables.layoutBuild,
    encoder: options.encoder,
    webp: options.webp,
    tables: source.tables.inputs.map((t) => ({ table: t.table, fileDataId: t.fileDataId, ckey: t.ckey, rows: t.rows })),
    skippedUiMaps: report.skippedUiMaps,
    skippedOverlays: report.skippedOverlays,
    files: files.map((f) => f.entry),
    sources: [...sources].sort((a, b) => a.uiMapId - b.uiMapId || a.layer - b.layer),
    deployment: options.deploy === undefined ? null : { uiMaps: [...options.deploy.uiMaps].sort((a, b) => a - b), reason: options.deploy.reason },
  };
  const manifestText = formatJson(buildArtManifest(facts));
  const parsed = parseArtManifest(JSON.parse(manifestText) as unknown);
  if (parsed.manifest === null) throw new Error(`the manifest convert.ts built does not parse: ${parsed.errors.join('; ')}`);
  return { files, manifestText, noticeText: artNoticeText(parsed.manifest), skippedUiMaps: report.skippedUiMaps, skippedOverlays: report.skippedOverlays };
}
