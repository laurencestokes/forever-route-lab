import type { DecodedBlock } from './format';
import { blockRect, MAP_ORIGIN_YD, neighbourBlock, SIDE_STEP, type BlockRect, type NavParams } from './grid';
import { climbThreshold, linkPortals, LinkList, linkTable, makePortal, recastAdjacency, sideLinks, type LinkTable, type Portal, type SideLinks } from './link';
import type { NavManifest, NavMapEntry } from './manifest';
import type { MapFacts } from './mapfile';

/**
 * The runtime mesh of one map (terrain-navigation.md §5, §6.1, §7.1, §9.6): the typed layout the
 * queries run on, filled block by block in any order.
 *
 * - **Global polygon ids** follow the manifest's block order and polygon counts, never the load
 *   order. Per-polygon arrays of the whole map (centroid, swim, winding, block) are allocated once;
 *   a block's entries are filled when it loads.
 * - **Per block** (`BlockMesh`): world-yard vertices (Float64, computed with the build's
 *   expressions), polygon slots, the derived internal adjacency per slot, the links between tiles
 *   of the block, the portal edges on the block's four outer sides, and one link table per side
 *   whose neighbour block is loaded. Links across a block seam are made when the second block of
 *   the pair loads and dropped when either unloads.
 * - **Per map** (`map.bin`): components, connector links, passage tags.
 *
 * A mesh with every block loaded equals the build's `buildMapMesh` edge for edge (same targets,
 * same portals, same order for any one pair of polygons), whatever the load order; the tests
 * check both.
 */

export class NavMeshError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NavMeshError';
  }
}

/** Outer portal edges of one block side, in (tile, polygon, edge) order. */
export interface OuterPortals {
  /** Tile index inside the block. */
  readonly tile: Int32Array;
  /** Global polygon id. */
  readonly poly: Int32Array;
  /** Slot index inside the block (the edge from slot s to the polygon's next slot). */
  readonly slot: Int32Array;
}

export interface BlockMesh {
  readonly index: number;
  readonly row0: number;
  readonly col0: number;
  readonly rect: BlockRect;
  /** Global id of the block's first polygon. */
  readonly base: number;
  readonly np: number;
  readonly tileTx: Int32Array;
  readonly tileTz: Int32Array;
  readonly tilePolyBase: Int32Array;
  /** Slots of local polygon p: polyFirst[p] .. polyFirst[p + 1] − 1. */
  readonly polyFirst: Int32Array;
  /** Block vertex of each slot. */
  readonly slotVert: Int32Array;
  /** Per slot j of a polygon: the local polygon across edge j → j + 1 in the same tile, or −1. */
  readonly nei: Int32Array;
  readonly vx: Float64Array;
  readonly vy: Float64Array;
  readonly vz: Float64Array;
  readonly zones: Int32Array;
  /** Links between tiles of this block, by source polygon. */
  readonly cross: LinkTable;
  /** Per local polygon: the sum of `SIDE_WEIGHT[side]` over the outer sides it has portal edges on. */
  readonly outerSides: Uint8Array;
  readonly outer: readonly OuterPortals[];
  /** Links across each side to the neighbour block, present while both are loaded. */
  readonly sides: (SideLinks | null)[];
  /** Snap bins, built on the first snap near the block (snap.ts). */
  bins: SnapBins | null;
}

export interface SnapBins {
  readonly x0: number;
  readonly y0: number;
  readonly cell: number;
  readonly nx: number;
  readonly ny: number;
  readonly first: Int32Array;
  /** Global polygon ids. */
  readonly items: Int32Array;
}

/** The weight of each side in `outerSides` (2^side, as a table: no `**`, which is `Math.pow`). */
export const SIDE_WEIGHT: readonly number[] = [1, 2, 4, 8];

/** `outerSides` holds a sum of distinct side weights; this tests one of them without bitwise operators. */
export const hasSide = (sides: number, side: number): boolean => Math.floor(sides / (SIDE_WEIGHT[side] ?? 1)) % 2 === 1;

const linkBytes = (t: LinkTable | SideLinks): number => t.to.byteLength + t.ax.byteLength + t.ay.byteLength + t.az.byteLength + t.bx.byteLength + t.by.byteLength + t.bz.byteLength;

export class NavMesh {
  readonly mapId: number;
  readonly P: NavParams;
  readonly entry: NavMapEntry;
  readonly facts: MapFacts;
  readonly connectorIds: readonly string[];
  readonly passageIds: readonly string[];
  /** Polygons of the whole map. */
  readonly n: number;
  readonly blockCount: number;
  /** First global polygon id of each block, plus the total. */
  readonly blockBase: Int32Array;
  /** Block index of every global polygon id. */
  readonly blockOf: Int32Array;
  /** Block index across each side of each block (blockCount × 4), −1 when none is listed. */
  readonly neighbours: Int32Array;
  readonly rects: readonly BlockRect[];
  readonly cx: Float64Array;
  readonly cy: Float64Array;
  readonly cz: Float64Array;
  readonly swim: Uint8Array;
  /** 1 when the polygon winds counter-clockwise in world X/Y (the funnel's left/right). */
  readonly ccw: Uint8Array;
  /** Component index per global polygon (map.bin). */
  readonly comp: Int32Array;
  readonly sizes: Int32Array;
  /** Connector link indices (into facts.links) by source polygon, in file order. */
  readonly connectorsFrom: ReadonlyMap<number, readonly number[]>;
  /** Passage indices (into passageIds) by tagged polygon. */
  readonly passagesOf: ReadonlyMap<number, readonly number[]>;
  /** Loaded blocks by manifest index (null when not loaded); change them only through addBlock and removeBlock. */
  readonly blocks: (BlockMesh | null)[];
  private readonly byName: ReadonlyMap<string, number>;
  private readonly threshold: number;
  private loadedCount = 0;
  /** Blocks unloaded so far: a running search refuses to continue after an unload. */
  removals = 0;

  constructor(manifest: NavManifest, mapId: number, facts: MapFacts) {
    const entry = manifest.maps.find((m) => m.mapId === mapId);
    if (entry === undefined) throw new NavMeshError(`map ${String(mapId)} has no navigation data`);
    if (facts.mapId !== mapId || facts.blockCount !== entry.blocks.length || facts.polygonCount !== entry.polygons) {
      throw new NavMeshError(`map.bin of map ${String(facts.mapId)} (${String(facts.blockCount)} blocks, ${String(facts.polygonCount)} polygons) does not match the manifest's map ${String(mapId)} (${String(entry.blocks.length)} blocks, ${String(entry.polygons)} polygons)`);
    }
    for (const l of facts.links) if (l.connector >= manifest.connectors.length) throw new NavMeshError(`map.bin names connector ${String(l.connector)} of ${String(manifest.connectors.length)}`);
    for (const t of facts.passages) if (t.passage >= manifest.passages.length) throw new NavMeshError(`map.bin names passage ${String(t.passage)} of ${String(manifest.passages.length)}`);
    this.mapId = mapId;
    this.P = manifest.params;
    this.entry = entry;
    this.facts = facts;
    this.connectorIds = manifest.connectors;
    this.passageIds = manifest.passages;
    this.n = entry.polygons;
    this.blockCount = entry.blocks.length;
    this.blockBase = new Int32Array(this.blockCount + 1);
    this.blockOf = new Int32Array(this.n);
    const byName = new Map<string, number>();
    entry.blocks.forEach((b, i) => {
      const base = this.blockBase[i] ?? 0;
      this.blockBase[i + 1] = base + b.polygons;
      this.blockOf.fill(i, base, base + b.polygons);
      byName.set(`${String(b.row0)}_${String(b.col0)}`, i);
    });
    this.byName = byName;
    this.neighbours = new Int32Array(this.blockCount * 4).fill(-1);
    entry.blocks.forEach((b, i) => {
      for (let s = 0; s < 4; s += 1) {
        const nb = neighbourBlock(this.P, b.row0, b.col0, s);
        this.neighbours[i * 4 + s] = byName.get(`${String(nb.row0)}_${String(nb.col0)}`) ?? -1;
      }
    });
    this.rects = entry.blocks.map((b) => blockRect(this.P, b.row0, b.col0));
    this.cx = new Float64Array(this.n);
    this.cy = new Float64Array(this.n);
    this.cz = new Float64Array(this.n);
    this.swim = new Uint8Array(this.n);
    this.ccw = new Uint8Array(this.n);
    this.comp = facts.comp;
    this.sizes = facts.sizes;
    const from = new Map<number, number[]>();
    facts.links.forEach((l, i) => {
      const list = from.get(l.from);
      if (list === undefined) from.set(l.from, [i]);
      else list.push(i);
    });
    this.connectorsFrom = from;
    const tagged = new Map<number, number[]>();
    for (const t of facts.passages) {
      for (const p of t.polygons) {
        const list = tagged.get(p);
        if (list === undefined) tagged.set(p, [t.passage]);
        else if (!list.includes(t.passage)) list.push(t.passage);
      }
    }
    for (const list of tagged.values()) list.sort((a, b) => a - b);
    this.passagesOf = tagged;
    this.threshold = climbThreshold(this.P.climbYd, this.P.ch);
    this.blocks = new Array<BlockMesh | null>(this.blockCount).fill(null);
  }

  /** The manifest index of block (row0, col0), or −1. */
  blockIndex(row0: number, col0: number): number {
    return this.byName.get(`${String(row0)}_${String(col0)}`) ?? -1;
  }

  isLoaded(b: number): boolean {
    return this.blocks[b] !== null && this.blocks[b] !== undefined;
  }

  block(b: number): BlockMesh | null {
    return this.blocks[b] ?? null;
  }

  get loaded(): number {
    return this.loadedCount;
  }

  /** Indices of the loaded blocks, ascending. */
  loadedBlocks(): number[] {
    const out: number[] = [];
    this.blocks.forEach((b, i) => {
      if (b !== null) out.push(i);
    });
    return out;
  }

  /** The loaded block of global polygon p; throws when it is not loaded. */
  blockOfPoly(p: number): BlockMesh {
    const b = this.blocks[this.blockOf[p] ?? -1];
    if (b === null || b === undefined) throw new NavMeshError(`polygon ${String(p)} is in block ${String(this.blockOf[p] ?? -1)}, which is not loaded`);
    return b;
  }

  zoneOf(p: number): number {
    const b = this.blockOfPoly(p);
    return b.zones[p - b.base] ?? 0;
  }

  /**
   * Adds decoded block `b` (manifest index): derives its adjacency, links its tiles, and links it
   * to every loaded neighbour block. Throws when the block does not match the manifest entry.
   */
  addBlock(b: number, d: DecodedBlock): BlockMesh {
    const e = this.entry.blocks[b];
    if (e === undefined) throw new NavMeshError(`block index ${String(b)} of ${String(this.blockCount)}`);
    if (this.isLoaded(b)) throw new NavMeshError(`block ${e.path} is already loaded`);
    if (d.mapId !== this.mapId || d.row0 !== e.row0 || d.col0 !== e.col0 || d.polygons !== e.polygons) {
      throw new NavMeshError(`block ${e.path}: the file holds map ${String(d.mapId)} block ${String(d.row0)}_${String(d.col0)} with ${String(d.polygons)} polygons, the manifest ${String(e.polygons)}`);
    }
    const P = this.P;
    const base = this.blockBase[b] ?? 0;
    const np = d.polygons;
    const nv = d.verts.length / 3;
    const vx = new Float64Array(nv);
    const vy = new Float64Array(nv);
    const vz = new Float64Array(nv);
    const voxX = new Int32Array(nv);
    const voxZ = new Int32Array(nv);
    for (let t = 0; t < d.tileCount; t += 1) {
      const tx = d.tileTx[t] ?? 0;
      const tz = d.tileTz[t] ?? 0;
      const os = d.tileOriginStep[t] ?? 0;
      for (let v = d.tileVertBase[t] ?? 0; v < (d.tileVertBase[t + 1] ?? 0); v += 1) {
        const x = d.verts[v * 3] ?? 0;
        const y = d.verts[v * 3 + 1] ?? 0;
        const z = d.verts[v * 3 + 2] ?? 0;
        vx[v] = -MAP_ORIGIN_YD + tx * P.tileYd + x * P.cs;
        vy[v] = MAP_ORIGIN_YD - tz * P.tileYd - z * P.cs;
        vz[v] = P.mapOriginZ + (d.blockStep + os + y) * P.ch;
        voxX[v] = x;
        voxZ[v] = z;
      }
    }
    const nei = new Int32Array(d.slotVert.length).fill(-1);
    for (let t = 0; t < d.tileCount; t += 1) {
      const vb = d.tileVertBase[t] ?? 0;
      recastAdjacency(d.polyFirst, d.slotVert, d.tilePolyBase[t] ?? 0, d.tilePolyBase[t + 1] ?? 0, vb, (d.tileVertBase[t + 1] ?? 0) - vb, nei, 0);
    }
    // centroids, swim and winding into the map-wide arrays
    for (let p = 0; p < np; p += 1) {
      const g = base + p;
      const a = d.polyFirst[p] ?? 0;
      const k1 = d.polyFirst[p + 1] ?? 0;
      let sx = 0;
      let sy = 0;
      let sz = 0;
      let a2 = 0;
      for (let s = a; s < k1; s += 1) {
        const v = d.slotVert[s] ?? 0;
        sx += vx[v] ?? 0;
        sy += vy[v] ?? 0;
        sz += vz[v] ?? 0;
        const w = d.slotVert[s + 1 < k1 ? s + 1 : a] ?? 0;
        a2 += (vx[v] ?? 0) * (vy[w] ?? 0) - (vx[w] ?? 0) * (vy[v] ?? 0);
      }
      const k = k1 - a;
      this.cx[g] = sx / k;
      this.cy[g] = sy / k;
      this.cz[g] = sz / k;
      this.swim[g] = d.swim[p] ?? 0;
      this.ccw[g] = a2 > 0 ? 1 : 0;
    }
    // portal edges per (tile, side)
    const tileAt = new Map<number, number>();
    for (let t = 0; t < d.tileCount; t += 1) tileAt.set((d.tileTx[t] ?? 0) * 4096 + (d.tileTz[t] ?? 0), t);
    const tilePortals = new Map<number, Portal[]>();
    const outerTile: number[][] = [[], [], [], []];
    const outerPoly: number[][] = [[], [], [], []];
    const outerSlot: number[][] = [[], [], [], []];
    const outerSides = new Uint8Array(np);
    const tv = P.tileVoxels;
    for (let t = 0; t < d.tileCount; t += 1) {
      const tx = d.tileTx[t] ?? 0;
      const tz = d.tileTz[t] ?? 0;
      for (let p = d.tilePolyBase[t] ?? 0; p < (d.tilePolyBase[t + 1] ?? 0); p += 1) {
        const a = d.polyFirst[p] ?? 0;
        const k1 = d.polyFirst[p + 1] ?? 0;
        for (let s = a; s < k1; s += 1) {
          if ((nei[s] ?? -1) >= 0) continue;
          const va = d.slotVert[s] ?? 0;
          const vb = d.slotVert[s + 1 < k1 ? s + 1 : a] ?? 0;
          const ax = voxX[va] ?? -1;
          const az = voxZ[va] ?? -1;
          const bx = voxX[vb] ?? -1;
          const bz = voxZ[vb] ?? -1;
          let side = -1;
          if (ax === 0 && bx === 0) side = 0;
          else if (az === tv && bz === tv) side = 1;
          else if (ax === tv && bx === tv) side = 2;
          else if (az === 0 && bz === 0) side = 3;
          if (side < 0) continue;
          const step = SIDE_STEP[side] ?? [0, 0];
          if (tileAt.has((tx + step[0]) * 4096 + (tz + step[1]))) {
            const key = t * 4 + side;
            const portal = makePortal(side, base + p, s - a, vx[va] ?? 0, vy[va] ?? 0, vz[va] ?? 0, vx[vb] ?? 0, vy[vb] ?? 0, vz[vb] ?? 0);
            const list = tilePortals.get(key);
            if (list === undefined) tilePortals.set(key, [portal]);
            else list.push(portal);
          } else if (this.isInsideBlock(d, tx + step[0], tz + step[1])) {
            // the neighbour tile is inside this block but holds no polygons: nothing to link
          } else {
            outerTile[side]?.push(t);
            outerPoly[side]?.push(base + p);
            outerSlot[side]?.push(s);
            if (!hasSide(outerSides[p] ?? 0, side)) outerSides[p] = (outerSides[p] ?? 0) + (SIDE_WEIGHT[side] ?? 0);
          }
        }
      }
    }
    const crossList = new LinkList();
    for (const [key, list] of [...tilePortals].sort((x, y) => x[0] - y[0])) {
      const t = Math.floor(key / 4);
      const side = key % 4;
      const step = SIDE_STEP[side] ?? [0, 0];
      const other = tileAt.get(((d.tileTx[t] ?? 0) + step[0]) * 4096 + (d.tileTz[t] ?? 0) + step[1]);
      if (other === undefined) continue;
      linkPortals(list, tilePortals.get(other * 4 + ((side + 2) % 4)) ?? [], this.threshold, crossList);
    }
    const block: BlockMesh = {
      index: b,
      row0: d.row0,
      col0: d.col0,
      rect: this.rects[b] ?? blockRect(P, d.row0, d.col0),
      base,
      np,
      tileTx: d.tileTx,
      tileTz: d.tileTz,
      tilePolyBase: d.tilePolyBase,
      polyFirst: d.polyFirst,
      slotVert: d.slotVert,
      nei,
      vx,
      vy,
      vz,
      zones: d.zones,
      cross: linkTable(crossList, base, np),
      outerSides,
      outer: outerTile.map((tiles, s) => ({ tile: Int32Array.from(tiles), poly: Int32Array.from(outerPoly[s] ?? []), slot: Int32Array.from(outerSlot[s] ?? []) })),
      sides: [null, null, null, null],
      bins: null,
    };
    this.blocks[b] = block;
    this.loadedCount += 1;
    for (let s = 0; s < 4; s += 1) {
      const nb = this.neighbours[b * 4 + s] ?? -1;
      const other = nb >= 0 ? this.blocks[nb] : null;
      if (other !== null && other !== undefined) this.linkBlocks(block, s, other);
    }
    return block;
  }

  /** Unloads block b and drops the links across its seams. */
  removeBlock(b: number): void {
    if (!this.isLoaded(b)) return;
    for (let s = 0; s < 4; s += 1) {
      const nb = this.neighbours[b * 4 + s] ?? -1;
      const other = nb >= 0 ? this.blocks[nb] : null;
      if (other !== null && other !== undefined) other.sides[(s + 2) % 4] = null;
    }
    this.blocks[b] = null;
    this.loadedCount -= 1;
    this.removals += 1;
  }

  private isInsideBlock(d: DecodedBlock, tx: number, tz: number): boolean {
    const span = this.P.blockAdts * this.P.perAdt;
    const tx0 = (63 - (d.row0 + this.P.blockAdts - 1)) * this.P.perAdt;
    const tz0 = d.col0 * this.P.perAdt;
    return tx >= tx0 && tx < tx0 + span && tz >= tz0 && tz < tz0 + span;
  }

  /** The outer portals of block `m` on `side`, grouped by tile, as world-yard portal records. */
  private outerPortals(m: BlockMesh, side: number): Map<number, Portal[]> {
    const o = m.outer[side];
    const out = new Map<number, Portal[]>();
    if (o === undefined) return out;
    for (let i = 0; i < o.tile.length; i += 1) {
      const t = o.tile[i] ?? 0;
      const g = o.poly[i] ?? 0;
      const s = o.slot[i] ?? 0;
      const p = g - m.base;
      const a = m.polyFirst[p] ?? 0;
      const k1 = m.polyFirst[p + 1] ?? 0;
      const va = m.slotVert[s] ?? 0;
      const vb = m.slotVert[s + 1 < k1 ? s + 1 : a] ?? 0;
      const portal = makePortal(side, g, s - a, m.vx[va] ?? 0, m.vy[va] ?? 0, m.vz[va] ?? 0, m.vx[vb] ?? 0, m.vy[vb] ?? 0, m.vz[vb] ?? 0);
      const key = (m.tileTx[t] ?? 0) * 4096 + (m.tileTz[t] ?? 0);
      const list = out.get(key);
      if (list === undefined) out.set(key, [portal]);
      else list.push(portal);
    }
    return out;
  }

  /** Links block `a` across its side `side` to the loaded block `b`, both directions. */
  private linkBlocks(a: BlockMesh, side: number, b: BlockMesh): void {
    const opposite = (side + 2) % 4;
    const pa = this.outerPortals(a, side);
    const pb = this.outerPortals(b, opposite);
    const step = SIDE_STEP[side] ?? [0, 0];
    const ab = new LinkList();
    const ba = new LinkList();
    for (const [key, list] of [...pa].sort((x, y) => x[0] - y[0])) {
      const tx = Math.floor(key / 4096);
      const tz = key % 4096;
      const facing = pb.get((tx + step[0]) * 4096 + (tz + step[1]));
      if (facing === undefined) continue;
      linkPortals(list, facing, this.threshold, ab);
      linkPortals(facing, list, this.threshold, ba);
    }
    a.sides[side] = sideLinks(ab);
    b.sides[opposite] = sideLinks(ba);
  }

  /** A cheap pre-test for `missingFor`: false when polygon p can never need another block. */
  mayNeedBlocks(p: number): boolean {
    const m = this.blocks[this.blockOf[p] ?? -1];
    if (m === null || m === undefined) return true;
    if ((m.outerSides[p - m.base] ?? 0) > 0) return true;
    return this.facts.links.length > 0 && this.connectorsFrom.has(p);
  }

  /** True when polygon p of loaded block m has a portal edge towards a listed block that is not loaded (no allocation). */
  sideBlockMissing(m: BlockMesh, p: number): boolean {
    const sides = m.outerSides[p - m.base] ?? 0;
    for (let s = 0; s < 4; s += 1) {
      if (!hasSide(sides, s)) continue;
      const nb = this.neighbours[m.index * 4 + s] ?? -1;
      if (nb >= 0 && this.blocks[nb] === null) return true;
    }
    return false;
  }

  /**
   * Blocks that must be loaded before polygon p may be relaxed (§9.6, RC-06): the listed
   * neighbour blocks across the outer sides p has portal edges on, and the blocks of its connector
   * links' targets, when not loaded. Ascending, without duplicates.
   */
  missingFor(p: number): number[] {
    const bi = this.blockOf[p] ?? -1;
    const m = this.blocks[bi];
    if (m === null || m === undefined) return [bi];
    const out: number[] = [];
    const sides = m.outerSides[p - m.base] ?? 0;
    if (sides > 0) {
      for (let s = 0; s < 4; s += 1) {
        if (!hasSide(sides, s)) continue;
        const nb = this.neighbours[bi * 4 + s] ?? -1;
        if (nb >= 0 && this.blocks[nb] === null) out.push(nb);
      }
    }
    const links = this.connectorsFrom.get(p);
    if (links !== undefined) {
      for (const li of links) {
        const to = this.facts.links[li]?.to ?? 0;
        const tb = this.blockOf[to] ?? -1;
        if (this.blocks[tb] === null && !out.includes(tb)) out.push(tb);
      }
    }
    return out.sort((x, y) => x - y);
  }

  /** Bytes of the typed arrays the mesh holds (map-wide and per loaded block): the runtime layout. */
  typedBytes(): { readonly map: number; readonly blocks: number } {
    let map = 0;
    for (const a of [this.blockBase, this.blockOf, this.neighbours, this.cx, this.cy, this.cz, this.swim, this.ccw, this.comp, this.sizes]) map += a.byteLength;
    let blocks = 0;
    for (const m of this.blocks) {
      if (m === null) continue;
      for (const a of [m.tileTx, m.tileTz, m.tilePolyBase, m.polyFirst, m.slotVert, m.nei, m.vx, m.vy, m.vz, m.zones, m.outerSides]) blocks += a.byteLength;
      blocks += linkBytes(m.cross) + m.cross.first.byteLength;
      for (const o of m.outer) blocks += o.tile.byteLength + o.poly.byteLength + o.slot.byteLength;
      for (const s of m.sides) if (s !== null) blocks += linkBytes(s) + s.from.byteLength;
      if (m.bins !== null) blocks += m.bins.first.byteLength + m.bins.items.byteLength;
    }
    return { map, blocks };
  }
}
