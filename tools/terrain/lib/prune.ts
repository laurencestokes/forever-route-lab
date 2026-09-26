import type { Census } from './census';
import type { Components } from './components';
import { compactTile, type NavBlock, type NavTile } from './encode';
import type { OffMeshLink } from './link';

/**
 * Pruning (terrain-navigation.md §7.2): a component is dropped when it has fewer than
 * `minPolygons` polygons, no dataset spawn snaps into it, no dataset spawn has a containing
 * polygon in it (so an ambiguous floor is never pruned) and it holds no connector endpoint.
 * Components this size are mostly roofs, prop tops and pinnacles (INFERRED); larger spawn-free
 * components are kept, as suspicious rather than junk.
 */

export function pruneKeep(c: Components, census: Census, minPolygons: number, links: readonly OffMeshLink[]): { keep: Uint8Array; droppedPolygons: number; droppedComponents: number } {
  const used = new Uint8Array(c.sizes.length);
  for (const r of census.results) {
    if (r.comp >= 0) used[r.comp] = 1;
    for (const p of r.snap.floors) {
      const fc = c.comp[p] ?? -1;
      if (fc >= 0) used[fc] = 1;
    }
  }
  for (const l of links) {
    for (const p of [l.from, l.to]) {
      const fc = c.comp[p] ?? -1;
      if (fc >= 0) used[fc] = 1;
    }
  }
  const drop = new Uint8Array(c.sizes.length);
  let droppedComponents = 0;
  c.sizes.forEach((size, i) => {
    if (size < minPolygons && used[i] !== 1) {
      drop[i] = 1;
      droppedComponents += 1;
    }
  });
  const keep = new Uint8Array(c.comp.length);
  let droppedPolygons = 0;
  for (let p = 0; p < c.comp.length; p += 1) {
    const fc = c.comp[p] ?? -1;
    const k = fc >= 0 && drop[fc] !== 1 ? 1 : 0;
    keep[p] = k;
    if (k === 0) droppedPolygons += 1;
  }
  return { keep, droppedPolygons, droppedComponents };
}

/**
 * The blocks with only the polygons `keep` marks (global ids in block order); unused vertices are
 * removed, empty tiles and blocks dropped. Returns the new blocks and the old → new polygon ids
 * (−1 for a dropped polygon).
 */
export function filterBlocks(blocks: readonly NavBlock[], keep: Uint8Array): { blocks: NavBlock[]; remap: Int32Array } {
  const remap = new Int32Array(keep.length).fill(-1);
  const out: NavBlock[] = [];
  let base = 0;
  let next = 0;
  for (const b of blocks) {
    const tiles: NavTile[] = [];
    const zones: number[] = [];
    let local = 0;
    for (const t of b.tiles) {
      const polys: (readonly number[])[] = [];
      const swim: boolean[] = [];
      t.polys.forEach((vs, p) => {
        const g = base + p;
        if (keep[g] !== 1) return;
        polys.push(vs);
        swim.push(t.swim[p] === true);
        zones.push(b.zones[local + p] ?? 0);
        remap[g] = next;
        next += 1;
      });
      base += t.polys.length;
      local += t.polys.length;
      if (polys.length > 0) tiles.push(compactTile({ tx: t.tx, tz: t.tz, originStep: t.originStep, verts: t.verts, polys, swim }));
    }
    if (tiles.length > 0) out.push({ mapId: b.mapId, row0: b.row0, col0: b.col0, blockStep: b.blockStep, tiles, zones: Int32Array.from(zones) });
  }
  return { blocks: out, remap };
}

/** Connector links under a polygon remap; throws when an endpoint polygon was dropped. */
export function remapLinks(links: readonly OffMeshLink[], remap: Int32Array): OffMeshLink[] {
  return links.map((l) => {
    const from = remap[l.from] ?? -1;
    const to = remap[l.to] ?? -1;
    if (from < 0 || to < 0) throw new Error(`connector ${String(l.connector)}: an endpoint polygon was dropped by the water rule or pruning`);
    return { ...l, from, to };
  });
}
