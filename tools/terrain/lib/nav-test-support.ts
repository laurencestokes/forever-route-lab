import type { BlockGrid, NavBlock, NavTile } from './encode';
import type { MeshParams } from './link';
import { derive, readBuildConfig } from './settings';
import { meshParams } from './stage2';

/**
 * Synthetic navigation meshes for tests: tiles from polygons given as voxel coordinates, on the
 * chosen settings' grid (4 Recast tiles of 256 voxels per ADT, 4×4-ADT blocks). No client bytes.
 */

export const DERIVED = derive(readBuildConfig().settings);
export const GRID: BlockGrid = { perAdt: DERIVED.perAdt, blockAdts: DERIVED.settings.blockAdts, tileVoxels: DERIVED.settings.tileVoxels };
export const PARAMS: MeshParams = meshParams(DERIVED);

export type Voxel = readonly [number, number, number];

/** A tile from polygons of voxel (x, y, z) vertices; shared vertices are merged, first use order. */
export function tileOf(tx: number, tz: number, polys: readonly (readonly Voxel[])[], swim: readonly boolean[] = [], originStep = 0): NavTile {
  const index = new Map<string, number>();
  const verts: number[] = [];
  const out = polys.map((vs) =>
    vs.map(([x, y, z]) => {
      const k = `${String(x)},${String(y)},${String(z)}`;
      let i = index.get(k);
      if (i === undefined) {
        i = verts.length / 3;
        index.set(k, i);
        verts.push(x, y, z);
      }
      return i;
    }),
  );
  return { tx, tz, originStep, verts: Int32Array.from(verts), polys: out, swim: polys.map((_, i) => swim[i] === true) };
}

/** Recast tile origin of a block's first tile. */
export const firstTile = (row0: number, col0: number): { tx0: number; tz0: number } => ({ tx0: (63 - (row0 + GRID.blockAdts - 1)) * GRID.perAdt, tz0: col0 * GRID.perAdt });

export function blockOf(row0: number, col0: number, tiles: readonly NavTile[], zones?: readonly number[], mapId = 1): NavBlock {
  const n = tiles.reduce((s, t) => s + t.polys.length, 0);
  return { mapId, row0, col0, blockStep: 0, tiles, zones: Int32Array.from(zones ?? new Array<number>(n).fill(14)) };
}

/** A square polygon (counter-clockwise from above in world X/Y) covering voxels [x0, x1] × [z0, z1] at height y. */
export const square = (x0: number, z0: number, x1: number, z1: number, y = 40): Voxel[] => [
  [x0, y, z0],
  [x0, y, z1],
  [x1, y, z1],
  [x1, y, z0],
];
