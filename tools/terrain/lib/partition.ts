import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { decodeBlock, type BlockGrid, type NavBlock } from './encode';

/**
 * Partition invariance (terrain-navigation.md §6.2, gate G4; RC-10): the same map built with
 * 4×4 and with 8×8 blocks must give identical Recast tiles. A tile's hash covers its absolute
 * vertex voxels (heights with the block and tile steps added), its polygons and swim flags, and
 * separately its polygon zones.
 */

export interface TileHash {
  readonly polygons: number;
  readonly geometry: string;
  readonly zones: string;
  readonly zMin: number;
  readonly zMax: number;
}

export function tileHashes(blocks: readonly NavBlock[]): Map<string, TileHash> {
  const out = new Map<string, TileHash>();
  for (const b of blocks) {
    let base = 0;
    for (const t of b.tiles) {
      const v = Int32Array.from(t.verts);
      let zMin = Infinity;
      let zMax = -Infinity;
      for (let i = 1; i < v.length; i += 3) {
        const y = (v[i] ?? 0) + b.blockStep + t.originStep;
        v[i] = y;
        if (y < zMin) zMin = y;
        if (y > zMax) zMax = y;
      }
      const h = createHash('sha256');
      h.update(Buffer.from(v.buffer, v.byteOffset, v.byteLength));
      h.update(JSON.stringify(t.polys));
      h.update(JSON.stringify(t.swim));
      const zones = createHash('sha256').update(JSON.stringify([...b.zones.subarray(base, base + t.polys.length)])).digest('hex');
      out.set(`${String(t.tx)},${String(t.tz)}`, { polygons: t.polys.length, geometry: h.digest('hex'), zones, zMin, zMax });
      base += t.polys.length;
    }
  }
  return out;
}

export function readStage1Blocks(dir: string, mapId: number, grid: BlockGrid): NavBlock[] {
  const mapDir = join(dir, String(mapId));
  return readdirSync(mapDir)
    .filter((f) => /^\d+_\d+\.bin$/.test(f))
    .sort()
    .map((f) => decodeBlock(readFileSync(join(mapDir, f)), grid, `${String(mapId)}/${f}`));
}

export interface PartitionResult {
  readonly tilesA: number;
  readonly tilesB: number;
  readonly identical: number;
  readonly different: readonly string[];
  readonly zonesDifferent: number;
  /** Largest vertical span (yd) of the tiles of any one block of partition B. */
  readonly maxBlockSpanYd: number;
  readonly maxBlockSpanBlock: string;
}

export function comparePartitions(a: readonly NavBlock[], b: readonly NavBlock[], ch: number): PartitionResult {
  const ha = tileHashes(a);
  const hb = tileHashes(b);
  let identical = 0;
  let zonesDifferent = 0;
  const different: string[] = [];
  for (const [k, v] of ha) {
    const w = hb.get(k);
    if (w?.geometry === v.geometry) {
      identical += 1;
      if (w.zones !== v.zones) zonesDifferent += 1;
    } else different.push(`${k}: ${String(v.polygons)} vs ${w === undefined ? 'missing' : String(w.polygons)} polygons`);
  }
  for (const k of hb.keys()) if (!ha.has(k)) different.push(`${k}: only in the second partition`);
  let maxSpan = 0;
  let maxBlock = '';
  for (const blk of b) {
    let lo = Infinity;
    let hi = -Infinity;
    for (const t of blk.tiles) {
      for (let i = 1; i < t.verts.length; i += 3) {
        const y = (t.verts[i] ?? 0) + blk.blockStep + t.originStep;
        if (y < lo) lo = y;
        if (y > hi) hi = y;
      }
    }
    if ((hi - lo) * ch > maxSpan) {
      maxSpan = (hi - lo) * ch;
      maxBlock = `${String(blk.row0)}_${String(blk.col0)}`;
    }
  }
  return { tilesA: ha.size, tilesB: hb.size, identical, different, zonesDifferent, maxBlockSpanYd: maxSpan, maxBlockSpanBlock: maxBlock };
}
