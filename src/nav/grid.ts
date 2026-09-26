/**
 * The navigation grid of one continent (terrain-navigation.md §5 "World coordinates";
 * docs/research/coordinates.md §2). World X points north, Y west, Z up. Recast space is
 * (x, y, z) = (X, Z, −Y): Recast tile (tx, tz) covers X from −ORIGIN + tx·tileYd and −Y from
 * −ORIGIN + tz·tileYd. ADT row r holds the x tiles (63 − r)·perAdt … (64 − r)·perAdt − 1 and ADT
 * column c the z tiles c·perAdt … (c + 1)·perAdt − 1. Blocks are blockAdts × blockAdts ADTs.
 *
 * Every world coordinate is computed with the same expressions, in the same order, as the build
 * (`tools/terrain/lib/link.ts`), so the runtime mesh is bit-identical to the build's mesh.
 */

/** One ADT tile side in yards (1600/3). */
export const TILE_YD = 1600 / 3;
/** Distance from the map's centre to its edge: 32 ADT tiles. */
export const MAP_ORIGIN_YD = 32 * TILE_YD;

/** The mesh parameters every navigation computation needs (from the manifest's settings). */
export interface NavParams {
  /** Cell size in yards: TILE_YD ÷ voxelsPerAdt (0.5208 yd). */
  readonly cs: number;
  /** Cell height in yards (0.25). */
  readonly ch: number;
  /** Recast tile side in voxels (256). */
  readonly tileVoxels: number;
  /** Recast tile side in yards: cs · tileVoxels (133.33 yd). */
  readonly tileYd: number;
  /** Recast tiles per ADT side (4). */
  readonly perAdt: number;
  /** ADTs per block side (4). */
  readonly blockAdts: number;
  readonly mapOriginZ: number;
  /** walkableClimb in yards (1.5); the relinker's height rule uses 2 × its voxel-rounded value. */
  readonly climbYd: number;
  /** Snap radius (6 yd, §8.1). */
  readonly snapRadiusYd: number;
  /** Rule B: components of at least this many polygons win (20, §8.1). */
  readonly ruleBMinPolygons: number;
  /** A leg whose longest contiguous swim exceeds this carries `long-swim` (200 yd, §9.3). */
  readonly longSwimYd: number;
}

/** A block's rectangle in world yards. */
export interface BlockRect {
  readonly xMin: number;
  readonly xMax: number;
  readonly yMin: number;
  readonly yMax: number;
}

/** The first Recast tile (tx0, tz0) of block (row0, col0). */
export function blockTileOrigin(P: NavParams, row0: number, col0: number): { readonly tx0: number; readonly tz0: number } {
  return { tx0: (63 - (row0 + P.blockAdts - 1)) * P.perAdt, tz0: col0 * P.perAdt };
}

/** Recast tiles per block side (16). */
export const blockSpan = (P: NavParams): number => P.blockAdts * P.perAdt;

export function blockRect(P: NavParams, row0: number, col0: number): BlockRect {
  return {
    xMin: MAP_ORIGIN_YD - (row0 + P.blockAdts) * TILE_YD,
    xMax: MAP_ORIGIN_YD - row0 * TILE_YD,
    yMin: MAP_ORIGIN_YD - (col0 + P.blockAdts) * TILE_YD,
    yMax: MAP_ORIGIN_YD - col0 * TILE_YD,
  };
}

/** 2D distance from (x, y) to a rectangle, 0 inside or on it. */
export function rectDistance(r: BlockRect, x: number, y: number): number {
  const dx = x < r.xMin ? r.xMin - x : x > r.xMax ? x - r.xMax : 0;
  const dy = y < r.yMin ? r.yMin - y : y > r.yMax ? y - r.yMax : 0;
  return Math.sqrt(dx * dx + dy * dy);
}

/** World X of voxel x in tile tx (the build's expression order). */
export const worldX = (P: NavParams, tx: number, vx: number): number => -MAP_ORIGIN_YD + tx * P.tileYd + vx * P.cs;
/** World Y of voxel z in tile tz. */
export const worldY = (P: NavParams, tz: number, vz: number): number => MAP_ORIGIN_YD - tz * P.tileYd - vz * P.cs;
/** World Z of voxel y with the block and tile origin steps. */
export const worldZ = (P: NavParams, blockStep: number, originStep: number, vy: number): number => P.mapOriginZ + (blockStep + originStep + vy) * P.ch;

/**
 * Tile sides, as in Recast and the build: 0 is x = 0 (towards tx − 1), 1 is z = tileVoxels
 * (tz + 1), 2 is x = tileVoxels (tx + 1), 3 is z = 0 (tz − 1).
 */
export const SIDE_STEP: readonly (readonly [number, number])[] = [
  [-1, 0],
  [0, 1],
  [1, 0],
  [0, -1],
];

/**
 * The block across side `side` of block (row0, col0): x decreases southwards, so side 0 (tx − 1)
 * is the block to the south (row0 + blockAdts) and side 2 the block to the north.
 */
export function neighbourBlock(P: NavParams, row0: number, col0: number, side: number): { readonly row0: number; readonly col0: number } {
  switch (side) {
    case 0:
      return { row0: row0 + P.blockAdts, col0 };
    case 1:
      return { row0, col0: col0 + P.blockAdts };
    case 2:
      return { row0: row0 - P.blockAdts, col0 };
    default:
      return { row0, col0: col0 - P.blockAdts };
  }
}

/** Endpoints are quantised to 1 yd before snapping and before any leg is computed (§8.1, §9.2). */
export function quantise(v: number): number {
  const q = Math.round(v);
  return q === 0 ? 0 : q; // never −0
}
