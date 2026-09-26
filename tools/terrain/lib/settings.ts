import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { MAP_ORIGIN_YD, TILE_YD } from './formats/grid';

/**
 * The navigation build configuration (`tools/terrain/build.json`, terrain-navigation.md §4.3,
 * §14.1) and the Recast values derived from it.
 *
 * Recast space: recast (x, y, z) = world (X, Z, −Y). Recast tile (tx, tz) covers recast x from
 * −ORIGIN + tx·tileYd and z from −ORIGIN + tz·tileYd, on one grid per map; ADT row r holds the
 * x tiles (63 − r)·perAdt … (64 − r)·perAdt − 1, ADT column c the z tiles c·perAdt … .
 */

export const TERRAIN_DIR = join(import.meta.dirname, '..');
export const REPO_ROOT = join(TERRAIN_DIR, '..', '..');
export const BUILD_JSON = join(TERRAIN_DIR, 'build.json');

const pinSchema = z.strictObject({ product: z.string().min(1), version: z.string().regex(/^\d+\.\d+\.\d+\.\d+$/), buildKey: z.string().regex(/^[0-9a-f]{32}$/) });

const settingsSchema = z.strictObject({
  name: z.string().min(1),
  blockAdts: z.number().int().positive(),
  voxelsPerAdt: z.number().int().positive(),
  tileVoxels: z.number().int().positive(),
  cellHeightYd: z.number().positive(),
  mapOriginZ: z.number(),
  radiusVoxels: z.number().int().min(0),
  climbYd: z.number().positive(),
  heightYd: z.number().positive(),
  slopeDeg: z.number().positive().max(90),
  maxSimplificationErrorYd: z.number().positive(),
  maxEdgeLengthYd: z.number().min(0),
  minRegionSideYd: z.number().min(0),
  mergeRegionSideYd: z.number().min(0),
  vertsPerPoly: z.number().int().min(3).max(12),
  m2MinFootprintYd: z.number().min(0),
  swimDepthYd: z.number().positive(),
  clipMarginYd: z.number().positive(),
});

const stage2Schema = z.strictObject({
  snap: z.strictObject({ radiusYd: z.number().positive(), ruleBMinPolygons: z.number().int().min(0) }),
  prune: z.strictObject({ minComponentPolygons: z.number().int().min(0) }),
  water: z.strictObject({ openWaterYd: z.number().min(0) }),
  census: z.strictObject({
    growthTolerance: z.number().min(0),
    zoneMinSpawns: z.number().int().positive(),
    zoneMinShare: z.number().min(0).max(1),
    floorMinPolygons: z.number().int().positive(),
  }),
  seams: z.strictObject({ maxBlockOverInnerPp: z.number().min(0) }),
  longSwimWarningYd: z.number().positive(),
});

const buildSchema = z.strictObject({
  $comment: z.array(z.string()).optional(),
  schema: z.literal(1),
  kind: z.literal('nav-build'),
  pin: pinSchema,
  recastNavigation: z.string().regex(/^\d+\.\d+\.\d+$/),
  maps: z.array(z.strictObject({ id: z.number().int().min(0), name: z.string().min(1), wdtFileDataId: z.number().int().positive() })).min(1),
  settings: settingsSchema,
  stage2: stage2Schema,
});

export type BuildConfig = z.infer<typeof buildSchema>;
export type NavSettings = BuildConfig['settings'];
export type Stage2Settings = BuildConfig['stage2'];

export function parseBuildConfig(value: unknown): BuildConfig {
  const parsed = buildSchema.safeParse(value);
  if (!parsed.success) throw new Error(`build.json: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
  const config = parsed.data;
  const s = config.settings;
  if (s.voxelsPerAdt % s.tileVoxels !== 0) throw new Error('build.json: voxelsPerAdt must be a multiple of tileVoxels');
  if (64 % s.blockAdts !== 0) throw new Error('build.json: blockAdts must divide 64');
  const ids = config.maps.map((m) => m.id);
  if (new Set(ids).size !== ids.length) throw new Error('build.json: duplicate map id');
  return config;
}

export function readBuildConfig(path = BUILD_JSON): BuildConfig {
  return parseBuildConfig(JSON.parse(readFileSync(path, 'utf8')) as unknown);
}

/** The Recast values of one setting (voxels and yards), computed once. */
export interface Derived {
  readonly settings: NavSettings;
  /** Cell size in yards: 1600/3 ÷ voxelsPerAdt (0.5208 yd). */
  readonly cs: number;
  readonly ch: number;
  /** Recast tile side in yards (133.33 yd). */
  readonly tileYd: number;
  /** Recast tiles per ADT side (4). */
  readonly perAdt: number;
  readonly walkableHeight: number;
  readonly walkableClimb: number;
  /** Heightfield border in voxels: radius + 3 (4). */
  readonly border: number;
  readonly minRegionArea: number;
  readonly mergeRegionArea: number;
  /** Simplification error in voxels (9.6). */
  readonly maxError: number;
  readonly maxEdgeLen: number;
}

export function derive(s: NavSettings): Derived {
  const cs = TILE_YD / s.voxelsPerAdt;
  const minR = Math.round(s.minRegionSideYd / cs);
  const mergeR = Math.round(s.mergeRegionSideYd / cs);
  return {
    settings: s,
    cs,
    ch: s.cellHeightYd,
    tileYd: cs * s.tileVoxels,
    perAdt: s.voxelsPerAdt / s.tileVoxels,
    walkableHeight: Math.ceil(s.heightYd / s.cellHeightYd),
    walkableClimb: Math.floor(s.climbYd / s.cellHeightYd),
    border: s.radiusVoxels + 3,
    minRegionArea: minR * minR,
    mergeRegionArea: mergeR * mergeR,
    maxError: s.maxSimplificationErrorYd / cs,
    maxEdgeLen: s.maxEdgeLengthYd > 0 ? Math.round(s.maxEdgeLengthYd / cs) : 0,
  };
}

/** The first Recast tile (tx, tz) of the block whose first ADT is (row0, col0). */
export function blockTileOrigin(d: Derived, row0: number, col0: number, blockAdts = d.settings.blockAdts): { readonly tx0: number; readonly tz0: number; readonly count: number } {
  return { tx0: (63 - (row0 + blockAdts - 1)) * d.perAdt, tz0: col0 * d.perAdt, count: blockAdts * d.perAdt };
}

/** World X of recast tile column tx plus vx voxels; world Y of tile row tz plus vz voxels. */
export function worldX(d: Derived, tx: number, vx: number): number {
  return -MAP_ORIGIN_YD + tx * d.tileYd + vx * d.cs;
}
export function worldY(d: Derived, tz: number, vz: number): number {
  return MAP_ORIGIN_YD - tz * d.tileYd - vz * d.cs;
}
export function worldZ(d: Derived, originStep: number, vy: number): number {
  return d.settings.mapOriginZ + (originStep + vy) * d.ch;
}

/** The blocks of a map: every blockAdts × blockAdts block with at least one present ADT, in canonical (row0, col0) order. */
export function mapBlocks(present: ReadonlySet<number>, blockAdts: number): readonly { readonly row0: number; readonly col0: number }[] {
  const out: { row0: number; col0: number }[] = [];
  for (let row0 = 0; row0 < 64; row0 += blockAdts) {
    for (let col0 = 0; col0 < 64; col0 += blockAdts) {
      let any = false;
      for (let r = row0; r < row0 + blockAdts && !any; r += 1) for (let c = col0; c < col0 + blockAdts && !any; c += 1) any = present.has(r * 64 + c);
      if (any) out.push({ row0, col0 });
    }
  }
  return out;
}

export const blockName = (row0: number, col0: number): string => `${String(row0)}_${String(col0)}`;
