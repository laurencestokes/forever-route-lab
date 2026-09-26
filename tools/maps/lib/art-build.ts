import { gzipSize } from '../../build/lib/audit';
import { buildArtManifest, parseArtManifest, type ArtBounds, type ArtFileEntry, type ArtManifestFacts } from './art-manifest';
import { artNoticeText } from './art-notice';
import { artFileName, planArt, planFileDataIds, type ArtPlan } from './art-plan';
import type { AssignmentRow, ClientMapTables } from './client-tables';
import { composeArt, type ComposeStats } from './compose';
import { encodeWebp, type EncoderIdentity, type WebpSettings } from './encode';
import { inputHash, type ClientInput } from '../../casc/input-hash';
import { formatJson } from './json';
import { rasterSha256 } from './raster';
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

export async function buildArtSet(source: ArtSource, options: ArtBuildOptions): Promise<ArtBuild> {
  const report = planArt(source.tables.art);
  const tableInputs: ClientInput[] = source.tables.inputs.map((t) => ({ fileDataId: t.fileDataId, ckey: t.ckey }));
  const files: BuiltArtFile[] = [];
  for (const plan of report.plans) {
    const ckeys = new Map<number, string>();
    const read = (fileDataId: number): Uint8Array => {
      const file = source.read(fileDataId);
      ckeys.set(fileDataId, file.ckey);
      return file.data;
    };
    const { image, stats } = composeArt(plan, read);
    const inputs = [...planFileDataIds(plan).map((id) => ({ fileDataId: id, ckey: ckeys.get(id) ?? '' })), ...tableInputs];
    const bytes = await encodeWebp(image, options.webp);
    const assignments = source.tables.assignments.filter((r) => r.uiMapId === plan.uiMapId).sort((a, b) => a.orderIndex - b.orderIndex || a.id - b.id);
    const entry = entryOf(plan, { bytes, pixelsSha256: rasterSha256(image), inputHash: inputHash(inputs) }, assignments);
    files.push({ entry, bytes, gzipBytes: gzipSize(bytes), stats, inputs: [...inputs].sort((a, b) => a.fileDataId - b.fileDataId) });
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
  };
  const manifestText = formatJson(buildArtManifest(facts));
  const parsed = parseArtManifest(JSON.parse(manifestText) as unknown);
  if (parsed.manifest === null) throw new Error(`the manifest convert.ts built does not parse: ${parsed.errors.join('; ')}`);
  return { files, manifestText, noticeText: artNoticeText(parsed.manifest), skippedUiMaps: report.skippedUiMaps, skippedOverlays: report.skippedOverlays };
}
