import { createHash } from 'node:crypto';
import type { InputFile } from './client';
import { unmatchedPct, type SeamStats } from './link';
import type { BuildConfig, NavSettings, Stage2Settings } from './settings';

/**
 * `public/nav/manifest.json` (terrain-navigation.md §5 "Manifest", §14; RC-03, TN-16, D-026):
 * the pin and client build, the tool identity, every setting, per map the block list in canonical
 * order with each block's stage-1 input hash, the `map.bin` file, the census summary, and the
 * stage-2 inputs. No timestamps: two builds of the same inputs give the same bytes (G3).
 *
 * `navRevision` is the SHA-256 over the sorted `path sha256` lines of every block and `map.bin`.
 * Global polygon ids follow the block order listed here, never the load order.
 */

export const MANIFEST_SCHEMA = 1;

export interface BlockEntry {
  readonly path: string;
  readonly row0: number;
  readonly col0: number;
  readonly polygons: number;
  readonly bytes: number;
  readonly sha256: string;
  /** SHA-256 over the sorted (FileDataID, CKey) lines of every file stage 1 read for the block (stage 1 only). */
  readonly inputHash: string;
}

export interface FileEntry {
  readonly path: string;
  readonly bytes: number;
  readonly sha256: string;
}

export interface CensusCountsEntry {
  readonly spawns: number;
  readonly main: number;
  readonly offMain: number;
  readonly none: number;
  readonly ambiguous: number;
  readonly overOffMainFloor: number;
  readonly offMainComponents: number;
  readonly overOffMainFloorComponents: number;
  readonly sha256: string;
}

export interface MapEntry {
  readonly mapId: number;
  readonly name: string;
  readonly wdt: InputFile;
  readonly polygons: number;
  readonly components: number;
  readonly mainPolygons: number;
  readonly mapFile: FileEntry;
  readonly blocks: readonly BlockEntry[];
  readonly connectorsApplied: readonly string[];
  readonly passagesTagged: readonly { readonly id: string; readonly polygons: number }[];
  /** Spawn area keys whose top-level zone differs from the key (AreaTable ParentAreaID), so validation needs no client. */
  readonly hintRollup: Readonly<Record<string, number>>;
  readonly census: CensusCountsEntry;
  /** Unmatched portal length in percent on block seams and inner seams (G5), before pruning (stage 1) and in the final mesh. */
  readonly seams: { readonly stage1: SeamEntry; readonly final: SeamEntry };
  /** Components the water rule splits (G9): parts of at least 50 polygons, largest first. */
  readonly waterSplits: readonly { readonly fullPolygons: number; readonly parts: readonly { readonly polygons: number; readonly zone: number; readonly centroid: readonly [number, number] }[] }[];
}

export interface SeamEntry {
  readonly innerPct: number;
  readonly blockPct: number;
  readonly deltaPp: number;
}

export interface NavManifest {
  readonly schema: number;
  readonly kind: 'nav-manifest';
  readonly notice: 'NOTICE.md';
  readonly navRevision: string;
  readonly format: { readonly block: string; readonly mapFile: string };
  readonly pin: BuildConfig['pin'];
  readonly client: { readonly rootCKey: string; readonly encodingCKey: string; readonly tables: readonly (InputFile & { readonly table: string })[] };
  readonly tool: {
    readonly toolTreeHash: string;
    readonly toolFiles: number;
    readonly nodeMajor: number;
    readonly recastNavigation: { readonly version: string; readonly wasmSha256: string; readonly wasmCompatJsSha256: string };
  };
  readonly settings: NavSettings;
  readonly derived: Readonly<Record<string, number>>;
  readonly stage2: {
    readonly settings: Stage2Settings;
    readonly dataset: { readonly dataRevision: string; readonly spawnsSha256: string; readonly geometrySha256: string };
    readonly censusReviewedSha256: string;
    readonly connectorsSha256: string;
    readonly passagesSha256: string;
  };
  readonly connectors: readonly string[];
  readonly passages: readonly string[];
  readonly connectorsFile: FileEntry;
  readonly maps: readonly MapEntry[];
}

export const sha256 = (bytes: Uint8Array | string): string => createHash('sha256').update(bytes).digest('hex');

/** SHA-256 over sorted `path sha256` lines. */
export function navRevision(files: readonly { readonly path: string; readonly sha256: string }[]): string {
  const lines = files.map((f) => `${f.path} ${f.sha256}\n`).sort();
  return sha256(lines.join(''));
}

/** The manifest's files that `navRevision` covers: every block and map.bin. */
export const revisionFiles = (maps: readonly MapEntry[]): FileEntry[] => maps.flatMap((m) => [...m.blocks.map((b) => ({ path: b.path, bytes: b.bytes, sha256: b.sha256 })), m.mapFile]);

/** Canonical JSON text of generated files: two-space indent, LF, final newline. */
export const jsonText = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;

const round4 = (v: number): number => Number(v.toFixed(4));

/** The seam figures of G5, rounded to 0.0001 percent. */
export function seamEntry(s: { readonly inner: SeamStats; readonly block: SeamStats }): SeamEntry {
  const inner = round4(unmatchedPct(s.inner));
  const block = round4(unmatchedPct(s.block));
  return { innerPct: inner, blockPct: block, deltaPp: round4(block - inner) };
}
