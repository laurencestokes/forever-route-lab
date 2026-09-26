/**
 * Drafts census review entries (terrain-navigation.md §12) for everything the census gate finds
 * unreviewed in the committed build: off-main components, off-main floors under or over main
 * spawns, unsnapped spawns, zones and water splits. Existing entries of
 * `tools/terrain/inputs/census-reviewed.json` are kept as they are.
 *
 * Usage: pnpm nav:review-draft [--write]
 *
 * Every drafted entry carries measured facts and a reason from explicit rules (below), marked
 * "rule:" in its note, for a person to confirm or change. Area names come from the client's
 * AreaTable when WOW_INSTALL has the pinned client (read-only), else ids are shown. Output:
 * `generated/terrain-nav-report.review-draft.json`; with `--write`, the merged file replaces
 * census-reviewed.json (the gate then passes until the next change, so review it first).
 *
 * Rules for an off-main component with spawns in it:
 * - closest approach to the main component (3D, vertex to vertex) ≤ 5 yd, or at least 10 dataset
 *   spawns in it (players likely go there): `mesh-break-suspected`;
 * - else most of its polygon centroids lie over a main floor: `unreachable-terrain` (a roof, a
 *   platform or a ledge above the walkable surface);
 * - else most lie under a main floor: `enclosed` (a room or cellar under the surface);
 * - else: `unreachable-terrain` (a plateau, pinnacle or shelf beside the main component).
 * Rules for an off-main floor that main spawns stand over: above the spawns' snapped floor for
 * most of them: `upper-floor`; below it: `floor-ambiguous` (the dataset has no heights).
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readDb2 } from '../casc/db2';
import { DB2 } from '../casc/layouts';
import type { ComponentRow } from './lib/census';
import { openClient } from './lib/client';
import { containsXY, type MapMesh } from './lib/link';
import { jsonText } from './lib/manifest';
import { anchorKey, censusGate, parseReviewed, type ReviewedFile } from './lib/review';
import { readBuildConfig, REPO_ROOT, TERRAIN_DIR } from './lib/settings';
import { snapIndex, type SnapIndex } from './lib/snap';
import { validateOffline, type MapValidation } from './lib/validate-lib';

const REVIEWED = join(TERRAIN_DIR, 'inputs', 'census-reviewed.json');
const OUT = join(REPO_ROOT, 'generated', 'terrain-nav-report.review-draft.json');

function areaNames(): (id: number) => string {
  try {
    const casc = openClient(readBuildConfig());
    const t = readDb2(casc, DB2.AreaTable);
    const m = new Map<number, string>(t.rows.map((r) => [r.id, r.str('AreaName_lang')]));
    casc.close();
    return (id) => `${m.get(id) ?? '?'} (${String(id)})`;
  } catch {
    return (id) => String(id);
  }
}

interface Facts {
  readonly polygons: number;
  readonly zMin: number;
  readonly zMax: number;
  readonly overMain: number;
  readonly underMain: number;
  readonly besideMain: number;
  /** Closest approach to a main vertex (3D), searched within 60 yd in 2D. */
  readonly gapYd: number;
  readonly centroid: readonly [number, number];
}

function componentFacts(g: MapMesh, comp: Int32Array, c: number, si: SnapIndex): Facts {
  const polys: number[] = [];
  for (let p = 0; p < g.n; p += 1) if (comp[p] === c) polys.push(p);
  let zMin = Infinity;
  let zMax = -Infinity;
  let sx = 0;
  let sy = 0;
  let over = 0;
  let under = 0;
  let beside = 0;
  const cell = 8;
  const mainBins = new Map<number, number[]>();
  const key = (x: number, y: number): number => (Math.floor(x / cell) + 4096) * 8192 + (Math.floor(y / cell) + 4096);
  let xl = Infinity;
  let xh = -Infinity;
  let yl = Infinity;
  let yh = -Infinity;
  for (const p of polys) {
    for (let k = g.vFirst[p] ?? 0; k < (g.vFirst[p + 1] ?? 0); k += 1) {
      xl = Math.min(xl, g.vx[k] ?? 0);
      xh = Math.max(xh, g.vx[k] ?? 0);
      yl = Math.min(yl, g.vy[k] ?? 0);
      yh = Math.max(yh, g.vy[k] ?? 0);
      zMin = Math.min(zMin, g.vz[k] ?? 0);
      zMax = Math.max(zMax, g.vz[k] ?? 0);
    }
  }
  for (let p = 0; p < g.n; p += 1) {
    if (comp[p] !== 0) continue;
    for (let k = g.vFirst[p] ?? 0; k < (g.vFirst[p + 1] ?? 0); k += 1) {
      const x = g.vx[k] ?? 0;
      const y = g.vy[k] ?? 0;
      if (x < xl - 60 || x > xh + 60 || y < yl - 60 || y > yh + 60) continue;
      const kk = key(x, y);
      const list = mainBins.get(kk);
      if (list === undefined) mainBins.set(kk, [k]);
      else list.push(k);
    }
  }
  let gap = Infinity;
  for (const p of polys) {
    const cx = g.cx[p] ?? 0;
    const cy = g.cy[p] ?? 0;
    const cz = g.cz[p] ?? 0;
    sx += cx;
    sy += cy;
    const bin = si.bins.get((Math.floor(cx / si.cell) + 1024) * 4096 + (Math.floor(cy / si.cell) + 1024)) ?? [];
    let below = false;
    let above = false;
    for (const q of bin) {
      if (comp[q] !== 0 || !containsXY(g, q, cx, cy)) continue;
      const dz = (g.cz[q] ?? 0) - cz;
      if (dz < -1.5) below = true;
      if (dz > 1.5) above = true;
    }
    if (below) over += 1;
    else if (above) under += 1;
    else beside += 1;
    for (let k = g.vFirst[p] ?? 0; k < (g.vFirst[p + 1] ?? 0); k += 1) {
      const x = g.vx[k] ?? 0;
      const y = g.vy[k] ?? 0;
      const z = g.vz[k] ?? 0;
      for (let i = -1; i <= 1; i += 1) {
        for (let j = -1; j <= 1; j += 1) {
          for (const m of mainBins.get(key(x + i * cell, y + j * cell)) ?? []) {
            const dx = (g.vx[m] ?? 0) - x;
            const dy = (g.vy[m] ?? 0) - y;
            const dz = (g.vz[m] ?? 0) - z;
            const dd = Math.sqrt(dx * dx + dy * dy + dz * dz);
            if (dd < gap) gap = dd;
          }
        }
      }
    }
  }
  return { polygons: polys.length, zMin, zMax, overMain: over, underMain: under, besideMain: beside, gapYd: gap, centroid: [Math.round(sx / polys.length), Math.round(sy / polys.length)] };
}

const fmt = (v: number): string => (Number.isFinite(v) ? `${v.toFixed(1)} yd` : 'none within 60 yd');

function draftComponent(mapId: number, r: ComponentRow, f: Facts, names: (id: number) => string): ReviewedFile['components'][number] {
  const n = f.polygons;
  let reason: ReviewedFile['components'][number]['reason'];
  let why: string;
  if (f.gapYd <= 5) {
    reason = 'mesh-break-suspected';
    why = `closest approach to main ${fmt(f.gapYd)}`;
  } else if (r.spawns >= 10) {
    reason = 'mesh-break-suspected';
    why = `${String(r.spawns)} dataset spawns stand here, so players likely reach it; closest approach to main ${fmt(f.gapYd)}`;
  } else if (f.overMain * 2 > n) {
    reason = 'unreachable-terrain';
    why = `${String(f.overMain)} of ${String(n)} polygon centroids over a main floor (a roof, platform or ledge); closest approach ${fmt(f.gapYd)}`;
  } else if (f.underMain * 2 > n) {
    reason = 'enclosed';
    why = `${String(f.underMain)} of ${String(n)} polygon centroids under a main floor (a room or cellar); closest approach ${fmt(f.gapYd)}`;
  } else {
    reason = 'unreachable-terrain';
    why = `beside the main component (${String(f.besideMain)} of ${String(n)} centroids with no main floor above or below); closest approach ${fmt(f.gapYd)}`;
  }
  return {
    map: mapId,
    anchor: r.anchor,
    reason,
    spawns: r.spawns,
    polygons: r.polygons,
    zones: r.zones.map(([z, c]) => `${names(z)}: ${String(c)}`),
    note: `rule: ${why}; z ${f.zMin.toFixed(0)} to ${f.zMax.toFixed(0)} around (${String(f.centroid[0])}, ${String(f.centroid[1])}); polygon areas ${r.polygonZones.map(([z, c]) => `${names(z)} ${String(c)}`).join(', ')}; ${r.sample.join(' ')}`,
  };
}

function draftFloor(mv: MapValidation, r: ComponentRow, f: Facts, names: (id: number) => string): ReviewedFile['overOffMainFloor'][number] {
  const g = mv.mesh;
  let above = 0;
  let below = 0;
  for (const s of mv.census.results) {
    if (s.comp !== 0) continue;
    const floors = s.snap.floors.filter((p) => mv.mapFile.comp[p] === r.comp);
    if (floors.length === 0) continue;
    const z = g.cz[s.snap.poly] ?? 0;
    if (floors.some((p) => (g.cz[p] ?? 0) > z)) above += 1;
    else below += 1;
  }
  const reason = above >= below ? 'upper-floor' : 'floor-ambiguous';
  return {
    map: mv.mapId,
    anchor: r.anchor,
    reason,
    spawns: r.spawns,
    polygons: r.polygons,
    zones: r.zones.map(([z, c]) => `${names(z)}: ${String(c)}`),
    note: `rule: for ${String(above)} of ${String(above + below)} spawns the isolated floor is above the main floor they snap to${reason === 'floor-ambiguous' ? ' (below for the rest: the dataset has no heights, so a spawn may stand on the isolated floor)' : ''}; floor z ${f.zMin.toFixed(0)} to ${f.zMax.toFixed(0)} around (${String(f.centroid[0])}, ${String(f.centroid[1])}); closest approach to main ${fmt(f.gapYd)}; ${r.sample.join(' ')}`,
  };
}

function main(argv: readonly string[]): number {
  const write = argv.includes('--write');
  const names = areaNames();
  const reviewed = parseReviewed(JSON.parse(readFileSync(REVIEWED, 'utf8')) as unknown);
  const result = validateOffline({ repoRoot: REPO_ROOT, skipToolTree: true, staleInputsWarn: true });
  const config = readBuildConfig();
  const draft: ReviewedFile = JSON.parse(JSON.stringify(reviewed)) as ReviewedFile;
  let added = 0;
  for (const mv of result.maps) {
    const si = snapIndex(mv.mesh);
    const have = (list: 'components' | 'overOffMainFloor', r: ComponentRow): boolean =>
      draft[list].some((e) => e.map === mv.mapId && anchorKey(e.anchor) === anchorKey(r.anchor) && (e.polygons === undefined || Math.abs(e.polygons - r.polygons) <= 0.25 * e.polygons));
    for (const r of mv.census.offMain) {
      if (have('components', r)) continue;
      draft.components.push(draftComponent(mv.mapId, r, componentFacts(mv.mesh, mv.mapFile.comp, r.comp, si), names));
      added += 1;
    }
    for (const r of mv.census.overOffMainFloor) {
      if (have('overOffMainFloor', r)) continue;
      draft.overOffMainFloor.push(draftFloor(mv, r, componentFacts(mv.mesh, mv.mapFile.comp, r.comp, si), names));
      added += 1;
    }
    for (const s of mv.census.unsnapped) {
      if (draft.unsnapped.some((e) => e.map === mv.mapId && anchorKey(e) === anchorKey(s))) continue;
      const row = mv.census.results.find((x) => anchorKey(x.spawn) === anchorKey(s));
      draft.unsnapped.push({ map: mv.mapId, ...s, reason: 'no-mesh', note: `rule: no polygon within 6 yd of (${row?.spawn.x.toFixed(1) ?? '?'}, ${row?.spawn.y.toFixed(1) ?? '?'}), zone ${names(row?.hint ?? 0)}` });
      added += 1;
    }
    const entry = result.manifest.maps.find((m) => m.mapId === mv.mapId);
    for (const s of entry?.waterSplits ?? []) {
      for (const p of s.parts.slice(1)) {
        if (draft.waterSplits.some((e) => e.map === mv.mapId && e.zone === p.zone && Math.abs(e.polygons - p.polygons) <= 0.25 * e.polygons)) continue;
        draft.waterSplits.push({ map: mv.mapId, zone: p.zone, polygons: p.polygons, centroid: [p.centroid[0], p.centroid[1]], reason: 'island', note: `rule: a ${String(p.polygons)}-polygon part (${names(p.zone)}) joined to the rest of its component only across open water wider than ${String(config.stage2.water.openWaterYd)} yd` });
        added += 1;
      }
    }
    for (const z of mv.census.zones) {
      if (z.spawns < config.stage2.census.zoneMinSpawns || draft.zones.some((e) => e.map === mv.mapId && e.zone === z.zone)) continue;
      if (z.dominant === 0 && z.dominantShare >= config.stage2.census.zoneMinShare) continue;
      draft.zones.push({ map: mv.mapId, zone: z.zone, name: names(z.zone), reason: 'other', ...(z.dominantShare < config.stage2.census.zoneMinShare ? { minShare: Math.floor(z.dominantShare * 100) / 100 } : {}), note: `rule: ${String(z.dominantSpawns)} of ${String(z.spawns)} spawns in the dominant component${z.dominant === 0 ? ' (main)' : ' (not main)'}` });
      added += 1;
    }
    const gate = censusGate(mv.census, [], draft, config.stage2, names);
    console.log(`map ${String(mv.mapId)}: ${String(gate.failures.filter((f) => !f.includes('water split')).length)} census failures left after the draft`);
  }
  const text = jsonText(draft);
  writeFileSync(OUT, text);
  if (write) writeFileSync(REVIEWED, text);
  console.log(`[nav] review draft: ${String(added)} entries added, written to ${write ? REVIEWED : OUT}${existsSync(OUT) ? '' : ''}`);
  return 0;
}

process.exitCode = main(process.argv.slice(2));
