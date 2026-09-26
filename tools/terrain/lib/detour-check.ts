import { createNavMeshData, NavMesh, NavMeshCreateParams, NavMeshParams, NavMeshQuery, QueryFilter, type RecastPolyMesh } from 'recast-navigation';
import { components } from './components';
import { encodeBlock, decodeBlock, type NavBlock } from './encode';
import { MAP_ORIGIN_YD } from './formats/grid';
import { legsFrom, scratch, type Endpoint } from './legs';
import { buildMapMesh, recastAdjacency } from './link';
import type { RecastTile } from './recast';
import { derive, type Derived, type NavSettings } from './settings';
import { snap, snapIndex } from './snap';
import { buildStage1Block, gridOf, type Stage1Inputs } from './stage1';
import { meshParams } from './stage2';
import type { Spawn } from './spawns';

/**
 * Implementation checks against Recast and Detour (terrain-navigation.md §16), not fidelity
 * checks: they compare our TypeScript with recast-navigation on the same polygons and say nothing
 * about the game (TN-11).
 *
 * - G5b: the derived internal adjacency and portal rule (link.ts) against the neighbours and
 *   portal flags `rcPolyMesh` stores, before deep and hazard polygons are dropped.
 * - G10: our pipeline (v3 encode → decode → derived adjacency → slab relinker → legsFrom) on a
 *   rebuild at 6 vertices per polygon (Detour's limit) against Detour's `findPath` +
 *   `findStraightPath` on the same `rcPolyMesh` tiles (no detail mesh), for fixed spawn pairs.
 * - G10b (RC-11): the same pairs with our TypeScript on the **shipped** 12-vertex blocks.
 *
 * Thresholds: median ratio ≤ 1.05, p90 ≤ 1.12, and every pair reachable on both sides.
 */

export interface AdjacencyCheck {
  readonly tiles: number;
  readonly internalRecast: number;
  readonly internalAgree: number;
  readonly portalsRecast: number;
  readonly portalsDerived: number;
  readonly portalsAgree: number;
}

export function adjacencyCheck(tiles: readonly RecastTile[], tileVoxels: number): AdjacencyCheck {
  const out = { tiles: 0, internalRecast: 0, internalAgree: 0, portalsRecast: 0, portalsDerived: 0, portalsAgree: 0 };
  for (const t of tiles) {
    out.tiles += 1;
    const polys: number[][] = [];
    const stored: number[][] = [];
    for (let p = 0; p < t.np; p += 1) {
      const vs: number[] = [];
      const ns: number[] = [];
      for (let j = 0; j < t.nvp; j += 1) {
        const v = t.polys[p * t.nvp * 2 + j] ?? 0xffff;
        if (v === 0xffff) break;
        vs.push(v);
        ns.push(t.polys[p * t.nvp * 2 + t.nvp + j] ?? 0xffff);
      }
      polys.push(vs);
      stored.push(ns);
    }
    const derived = recastAdjacency(polys, t.nv);
    polys.forEach((vs, p) => {
      vs.forEach((a, j) => {
        const n = stored[p]?.[j] ?? 0xffff;
        const d = derived[p]?.[j] ?? -1;
        const internal = n < 0x8000;
        const portal = n >= 0x8000 && n !== 0xffff;
        if (internal) {
          out.internalRecast += 1;
          if (d === n) out.internalAgree += 1;
        }
        const b = vs[(j + 1) % vs.length] ?? 0;
        const ax = t.verts[a * 3] ?? -1;
        const az = t.verts[a * 3 + 2] ?? -1;
        const bx = t.verts[b * 3] ?? -1;
        const bz = t.verts[b * 3 + 2] ?? -1;
        const onSide = (ax === 0 && bx === 0) || (az === tileVoxels && bz === tileVoxels) || (ax === tileVoxels && bx === tileVoxels) || (az === 0 && bz === 0);
        const derivedPortal = d < 0 && onSide;
        if (portal) out.portalsRecast += 1;
        if (derivedPortal) out.portalsDerived += 1;
        if (portal && derivedPortal) out.portalsAgree += 1;
      });
    });
  }
  return out;
}

export interface RatioStats {
  readonly pairs: number;
  readonly tsUnreachable: number;
  readonly p10: number;
  readonly p50: number;
  readonly p90: number;
  readonly min: number;
  readonly max: number;
}

export interface DetourCheck {
  readonly blocks: readonly string[];
  readonly dtTiles: number;
  readonly dtFail: number;
  readonly points: number;
  readonly dtNoPath: number;
  readonly dtPartial: number;
  readonly g10: RatioStats;
  readonly g10b: RatioStats;
  readonly adjacency: AdjacencyCheck;
}

const quantiles = (ratios: number[], tsUnreachable: number): RatioStats => {
  const r = [...ratios].sort((a, b) => a - b);
  const q = (p: number): number => r[Math.min(r.length - 1, Math.floor(p * r.length))] ?? Number.NaN;
  return { pairs: r.length, tsUnreachable, p10: q(0.1), p50: q(0.5), p90: q(0.9), min: r[0] ?? Number.NaN, max: r[r.length - 1] ?? Number.NaN };
};

export const detourPass = (c: DetourCheck, which: 'g10' | 'g10b'): boolean => {
  const s = c[which];
  return s.pairs > 0 && s.p50 <= 1.05 && s.p90 <= 1.12 && s.tsUnreachable === 0 && c.dtNoPath === 0 && c.dtPartial === 0 && c.dtFail === 0;
};

/**
 * Runs G5b, G10 and G10b on `blocks` of one map. `inp` is the map's stage-1 context (its derived
 * settings are replaced by the same settings at 6 vertices per polygon); `shipped` are the
 * committed final blocks of the same block rectangles.
 */
export function detourCheck(inp: Stage1Inputs, settings: NavSettings, blocks: readonly (readonly [number, number])[], shipped: readonly NavBlock[], spawns: readonly Spawn[], pairCount = 300): DetourCheck {
  const d6: Derived = derive({ ...settings, vertsPerPoly: Math.min(6, settings.vertsPerPoly) });
  const nav = new NavMesh();
  nav.initTiled(NavMeshParams.create({ orig: { x: -MAP_ORIGIN_YD, y: 0, z: -MAP_ORIGIN_YD }, tileWidth: d6.tileYd, tileHeight: d6.tileYd, maxTiles: 4096, maxPolys: 4096 }));
  let dtTiles = 0;
  let dtFail = 0;
  const rebuilt: NavBlock[] = [];
  const allTiles: RecastTile[] = [];
  const grid = gridOf(d6);
  for (const [row0, col0] of blocks) {
    const hook = (pm: RecastPolyMesh, tx: number, tz: number): void => {
      for (let i = 0; i < pm.npolys(); i += 1) {
        const a = pm.areas(i);
        pm.setFlags(i, a === 1 || a === 3 ? 1 : 0);
      }
      const p = new NavMeshCreateParams();
      p.setPolyMeshCreateParams(pm);
      p.setWalkableHeight(d6.walkableHeight * d6.ch);
      p.setWalkableRadius(settings.radiusVoxels * d6.cs);
      p.setWalkableClimb(d6.walkableClimb * d6.ch);
      p.setCellSize(d6.cs);
      p.setCellHeight(d6.ch);
      p.setBuildBvTree(true);
      p.setTileX(tx);
      p.setTileY(tz);
      const res = createNavMeshData(p);
      if (!res.success) {
        dtFail += 1;
        return;
      }
      nav.addTile(res.navMeshData, 1, 0);
      dtTiles += 1;
    };
    const r = buildStage1Block({ ...inp, derived: d6 }, row0, col0, { hook, keepRecastTiles: allTiles });
    if (r.block !== null) rebuilt.push(decodeBlock(encodeBlock(r.block, grid), grid));
  }
  const adjacency = adjacencyCheck(allTiles, settings.tileVoxels);
  const meshA = buildMapMesh(rebuilt, meshParams(d6));
  const compA = components(meshA);
  const meshB = buildMapMesh(shipped, meshParams(derive(settings)));
  const compB = components(meshB);
  const siA = snapIndex(meshA);
  const siB = snapIndex(meshB);
  const inRegion = spawns
    .map((s) => ({ s, r: snap(siA, compA.comp, compA.sizes, s.x, s.y, 0, 0) }))
    .filter((e) => e.r.poly >= 0 && e.r.dist === 0 && compA.comp[e.r.poly] === 0)
    .sort((a, b) => a.s.id - b.s.id || a.s.x - b.s.x || a.s.y - b.s.y);
  const step = Math.max(1, Math.floor(inRegion.length / 300));
  const pts = inRegion.filter((_, i) => i % step === 0).slice(0, 300);
  const q = new NavMeshQuery(nav, { maxNodes: 65535 });
  const filter = new QueryFilter();
  filter.includeFlags = 1;
  filter.setAreaCost(3, 7 / 4.72);
  const sa = scratch(meshA);
  const sb = scratch(meshB);
  const ratiosA: number[] = [];
  const ratiosB: number[] = [];
  let dtNoPath = 0;
  let dtPartial = 0;
  let unreachA = 0;
  let unreachB = 0;
  const at = (poly: number, x: number, y: number): Endpoint => ({ x, y, poly });
  for (let i = 0; i < pairCount && pts.length > 1; i += 1) {
    const a = pts[i % pts.length];
    const b = pts[(7919 * i + 13) % pts.length];
    if (a === undefined || b === undefined || a === b) continue;
    const A = { x: a.s.x, y: meshA.cz[a.r.poly] ?? 0, z: -a.s.y };
    const B = { x: b.s.x, y: meshA.cz[b.r.poly] ?? 0, z: -b.s.y };
    const na = q.findNearestPoly(A, { halfExtents: { x: 0.5, y: 4, z: 0.5 }, filter });
    const nb = q.findNearestPoly(B, { halfExtents: { x: 0.5, y: 4, z: 0.5 }, filter });
    if (!na.success || !nb.success || na.nearestRef === 0 || nb.nearestRef === 0) {
      dtNoPath += 1;
      continue;
    }
    const fp = q.findPath(na.nearestRef, nb.nearestRef, na.nearestPoint, nb.nearestPoint, { filter, maxPathPolys: 4096 });
    if (!fp.success || fp.polys.size === 0) {
      dtNoPath += 1;
      continue;
    }
    if (fp.polys.get(fp.polys.size - 1) !== nb.nearestRef) {
      dtPartial += 1;
      fp.polys.destroy();
      continue;
    }
    const sp = q.findStraightPath(na.nearestPoint, nb.nearestPoint, fp.polys, { maxStraightPathPoints: 4096 });
    let L = 0;
    for (let k = 1; k < sp.straightPathCount; k += 1) {
      const dx = sp.straightPath.get(k * 3) - sp.straightPath.get(k * 3 - 3);
      const dz = sp.straightPath.get(k * 3 + 2) - sp.straightPath.get(k * 3 - 1);
      L += Math.sqrt(dx * dx + dz * dz);
    }
    fp.polys.destroy();
    sp.straightPath.destroy();
    sp.straightPathFlags.destroy();
    sp.straightPathRefs.destroy();
    const [legA] = legsFrom(meshA, compA.comp, sa, at(a.r.poly, a.s.x, a.s.y), [at(b.r.poly, b.s.x, b.s.y)]);
    if (legA === undefined || !legA.reachable) unreachA += 1;
    else if (L > 20) ratiosA.push((legA.groundTenths + legA.swimTenths) / 10 / L);
    const ra = snap(siB, compB.comp, compB.sizes, a.s.x, a.s.y, 0, 0);
    const rb = snap(siB, compB.comp, compB.sizes, b.s.x, b.s.y, 0, 0);
    const [legB] = ra.poly < 0 || rb.poly < 0 ? [undefined] : legsFrom(meshB, compB.comp, sb, at(ra.poly, a.s.x, a.s.y), [at(rb.poly, b.s.x, b.s.y)]);
    if (legB === undefined || !legB.reachable) unreachB += 1;
    else if (L > 20) ratiosB.push((legB.groundTenths + legB.swimTenths) / 10 / L);
  }
  q.destroy();
  nav.destroy();
  return {
    blocks: blocks.map(([r, c]) => `${String(r)}_${String(c)}`),
    dtTiles,
    dtFail,
    points: pts.length,
    dtNoPath,
    dtPartial,
    g10: quantiles(ratiosA, unreachA),
    g10b: quantiles(ratiosB, unreachB),
    adjacency,
  };
}
