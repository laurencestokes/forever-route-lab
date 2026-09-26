import type { Census } from './census';
import type { Components } from './components';
import type { ConnectorFile } from './connectors';
import type { MapFile } from './mapfile';
import type { PassageFile } from './passages';
import { anchorKey, type ReviewedFile } from './review';
import { snap, type SnapIndex } from './snap';
import type { Spawn } from './spawns';

/**
 * The navigation fixtures (terrain-navigation.md §16): must connect (G7, G7a, G7b, G7c), must not
 * connect (G8) and tagged passages (G8b), by dataset ids, never by coordinates.
 *
 * G7 checks **every** containing floor of at least `threshold` polygons of each fixture spawn,
 * not only where the snap lands (RC-05), and runs at rule-B thresholds of 20 and 10 so a
 * 19-polygon floor stays visible. A floor may be a reviewed exception (`mustConnectExceptions`:
 * the fixture spawn, the floor component's size within 25% and the floor's height range), for the
 * known upper floors such as Dustwind Cave's.
 */

export interface FixtureResult {
  readonly gate: string;
  readonly name: string;
  readonly pass: boolean;
  /** Passes only through a reviewed exception. */
  readonly reviewed: boolean;
  readonly detail: string;
}

export const MUST_CONNECT: readonly { readonly name: string; readonly map: number; readonly kind: 'npc' | 'object'; readonly id: number; readonly zone: number }[] = [
  { name: 'Skull Rock', map: 1, kind: 'npc', id: 3131, zone: 14 },
  { name: 'Burning Blade Coven', map: 1, kind: 'npc', id: 3197, zone: 14 },
  { name: 'Dustwind Cave', map: 1, kind: 'npc', id: 3116, zone: 14 },
  { name: 'Cleft of Shadow', map: 1, kind: 'npc', id: 5639, zone: 1637 },
];

export const GNARLPINE_HOLD = { map: 1, zone: 141, npcs: [2009, 2010, 2011, 7318] } as const;
export const THUNDER_BLUFF = { map: 1, zone: 1638, npcs: [10086, 3036, 3032, 3046] } as const;
export const TELDRASSIL = 141;
export const DARKSHORE = 148;

export interface FixtureInput {
  readonly mapId: number;
  readonly si: SnapIndex;
  readonly comps: Components;
  readonly census: Census;
  readonly spawns: readonly Spawn[];
  readonly hintOf: (s: Spawn) => number;
  readonly reviewed: ReviewedFile;
  readonly connectors: ConnectorFile;
  readonly passages: PassageFile;
  readonly mapFile: MapFile;
}

export function runFixtures(inp: FixtureInput): FixtureResult[] {
  const out: FixtureResult[] = [];
  const { si, comps } = inp;
  const g = si.g;
  const mine = inp.spawns.filter((s) => s.mapId === inp.mapId);
  const snapOf = new Map(inp.census.results.map((r) => [anchorKey(r.spawn), r]));
  // G7: every floor, at rule-B thresholds 20 and 10
  for (const f of MUST_CONNECT.filter((x) => x.map === inp.mapId)) {
    const list = mine.filter((s) => s.kind === f.kind && s.id === f.id && inp.hintOf(s) === f.zone);
    for (const threshold of [20, 10]) {
      const bad: string[] = [];
      let viaException = false;
      for (const s of list) {
        const r = snap(si, comps.comp, comps.sizes, s.x, s.y, inp.hintOf(s), threshold);
        const c = r.poly < 0 ? -1 : (comps.comp[r.poly] ?? -1);
        if (c !== 0) bad.push(`${anchorKey(s)} snaps to ${c < 0 ? 'nothing' : `component ${String(c)} (${String(comps.sizes[c] ?? 0)} polygons)`}`);
        for (const p of r.floors) {
          const fc = comps.comp[p] ?? -1;
          const size = comps.sizes[fc] ?? 0;
          if (fc === 0 || size < threshold) continue;
          const z = g.cz[p] ?? 0;
          const exception = inp.reviewed.mustConnectExceptions.find(
            (e) => e.map === inp.mapId && e.fixture === f.name && anchorKey(e.spawn) === anchorKey(s) && Math.abs(size - e.polygons) <= 0.25 * e.polygons && z >= e.zMin && z <= e.zMax,
          );
          if (exception !== undefined) viaException = true;
          else bad.push(`${anchorKey(s)} stands over a ${String(size)}-polygon off-main floor at z ${z.toFixed(1)}`);
        }
      }
      out.push({
        gate: 'G7',
        name: `${f.name} (npc ${String(f.id)}), rule B ${String(threshold)}`,
        pass: list.length > 0 && bad.length === 0,
        reviewed: viaException,
        detail: list.length === 0 ? 'no dataset spawn' : bad.length === 0 ? `${String(list.length)} of ${String(list.length)} spawns: every floor of ≥ ${String(threshold)} polygons in main${viaException ? ' (reviewed exceptions used)' : ''}` : bad.join('; '),
      });
    }
  }
  // G7a: Gnarlpine Hold in Teldrassil's dominant component
  if (GNARLPINE_HOLD.map === inp.mapId) {
    const zone = inp.census.zones.find((z) => z.zone === GNARLPINE_HOLD.zone);
    const list = mine.filter((s) => s.kind === 'npc' && (GNARLPINE_HOLD.npcs as readonly number[]).includes(s.id) && inp.hintOf(s) === GNARLPINE_HOLD.zone);
    const outside = list.filter((s) => (snapOf.get(anchorKey(s))?.comp ?? -1) !== (zone?.dominant ?? -2));
    const reviewedComps = new Set(
      inp.census.offMain.filter((row) => inp.reviewed.components.some((e) => e.map === inp.mapId && anchorKey(e.anchor) === anchorKey(row.anchor) && e.reason === 'mesh-break-suspected')).map((row) => row.comp),
    );
    const unreviewed = outside.filter((s) => !reviewedComps.has(snapOf.get(anchorKey(s))?.comp ?? -1));
    out.push({
      gate: 'G7a',
      name: 'Gnarlpine Hold in Teldrassil’s dominant component',
      pass: list.length > 0 && unreviewed.length === 0,
      reviewed: outside.length > 0 && unreviewed.length === 0,
      detail: `${String(list.length - outside.length)} of ${String(list.length)} spawns in the dominant component${outside.length > 0 ? `; ${String(outside.length)} outside it (${unreviewed.length === 0 ? 'reviewed mesh-break-suspected' : `${String(unreviewed.length)} unreviewed`})` : ''}`,
    });
  }
  // G7b: the Thunder Bluff rises and the Pools of Vision in one component
  if (THUNDER_BLUFF.map === inp.mapId) {
    const list = mine.filter((s) => s.kind === 'npc' && (THUNDER_BLUFF.npcs as readonly number[]).includes(s.id) && inp.hintOf(s) === THUNDER_BLUFF.zone);
    const set = new Set(list.map((s) => snapOf.get(anchorKey(s))?.comp ?? -1));
    const ids = new Set(list.map((s) => s.id));
    out.push({ gate: 'G7b', name: 'Thunder Bluff rises and Pools of Vision in one component', pass: set.size === 1 && !set.has(-1) && ids.size === THUNDER_BLUFF.npcs.length, reviewed: false, detail: `${String(list.length)} spawns of ${String(ids.size)} NPCs in components ${[...set].join(', ')}` });
    // G8: Thunder Bluff separate from Mulgore while no elevator is observed
    const elevator = inp.connectors.connectors.some((c) => c.map === inp.mapId && c.status === 'observed' && c.type === 'elevator' && (c.a.uiMapId === 1456 || c.b.uiMapId === 1456));
    out.push({ gate: 'G8', name: 'Thunder Bluff rises not connected to Mulgore without an elevator', pass: elevator || !set.has(0), reviewed: false, detail: elevator ? 'an elevator is observed: not applicable' : `components ${[...set].join(', ')} (0 = main)` });
  }
  // G8: Teldrassil must not connect to Darkshore
  if (inp.mapId === 1) {
    const compsOf = (zone: number): Set<number> => new Set(inp.census.results.filter((r) => r.hint === zone && r.comp >= 0).map((r) => r.comp));
    const tel = compsOf(TELDRASSIL);
    const dks = compsOf(DARKSHORE);
    const shared = [...tel].filter((c) => dks.has(c));
    out.push({ gate: 'G8', name: 'Teldrassil not connected to Darkshore', pass: shared.length === 0, reviewed: false, detail: shared.length === 0 ? `${String(tel.size)} Teldrassil and ${String(dks.size)} Darkshore components, none shared` : `shared components ${shared.join(', ')}` });
  }
  // G7c: pending connectors
  const pending = inp.connectors.connectors.filter((c) => c.map === inp.mapId && c.status === 'todo').map((c) => c.id);
  if (pending.length > 0) out.push({ gate: 'G7c', name: 'connectors pending', pass: true, reviewed: false, detail: `todo: ${pending.join(', ')} (checked once observed)` });
  // G8b: unverified passages are tagged
  inp.passages.passages.forEach((p, index) => {
    if (p.map !== inp.mapId || p.status !== 'unverified') return;
    const tag = inp.mapFile.passages.find((t) => t.passage === index);
    const n = tag?.polygons.length ?? 0;
    out.push({ gate: 'G8b', name: `passage ${p.id} tagged`, pass: n > 0, reviewed: false, detail: `${String(n)} polygons tagged in map.bin` });
  });
  return out;
}
