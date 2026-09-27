import type { EntityRef } from '../../domain/dataset';
import type { TravelEndpoint } from '../../domain/travel';
import type { TravelPair } from '../../engine/types';
import { initialRiding } from '../../sim/travel';
import { endpointKey, entityKey, type IndexedLocations, indexLocations, LocationSet } from './locations';
import { replayEnv, scratchStep } from './replay';
import { MAX_LOCATIONS, MAX_REQUESTED_LEGS, type StepInfo, type Structure } from './section';
import { type CompileFailure, SPAWN_LOST, SPAWN_NONE, type SpawnTables } from './types';

const addEndpoint = (set: LocationSet, end: TravelEndpoint | null): void => {
  if (end !== null) set.add(end);
};

/**
 * Positions (docs/research/optimizer-m7.md §5.2-§5.4): the riding tiers, the locations (with the
 * spawn fixpoint), the nearest-spawn tables, the flight and transport tables priced with the engine
 * per from-location and tier, and the legs the matrix needs (only pairs that can be consecutive in
 * some candidate).
 */

/** One flight or transport step priced from one location at one tier. */
export interface TableEntry {
  readonly ms: number;
  /** The `travel` and `waiting` buckets (the exit chain counts only these). */
  readonly exitMs: number;
  readonly unknown: number;
  readonly arrival: TravelEndpoint | null;
  readonly legs: readonly TravelPair[];
}

export interface Geometry {
  /** Riding tiers the section can use, ascending; `tierIndex[t]` their matrix index (−1 absent). */
  readonly tiers: readonly number[];
  readonly tierIndex: Int32Array;
  readonly locations: IndexedLocations;
  readonly spawnEntities: readonly EntityRef[];
  readonly spawnTableOf: ReadonlyMap<string, number>;
  readonly spawnTables: SpawnTables;
  /** Per step (route index): the possible from-locations (−1 unknown), ascending. */
  readonly opFrom: ReadonlyMap<number, Int32Array>;
  /** Per table step: entries by `tier index × (N + 1) + from + 1`. */
  readonly tables: ReadonlyMap<number, readonly (TableEntry | null)[]>;
  /** Matrix pairs `from × N + to`, ascending. */
  readonly matrixPairs: Int32Array;
  /** Every leg "computing paths" must fill: the matrix pairs, then the table steps' legs. */
  readonly pairs: readonly TravelPair[];
}

const fail = (reason: string): CompileFailure => ({ ok: false, status: 'failed', reason });

/** Interned positions during the fixpoint (−1 is unknown); an endpoint's key is built once per object. */
class Positions {
  readonly ends: TravelEndpoint[] = [];
  private readonly byKey = new Map<string, number>();
  private readonly byObject = new WeakMap<TravelEndpoint, number>();

  id(end: TravelEndpoint | null): number {
    if (end === null) return -1;
    const known = this.byObject.get(end);
    if (known !== undefined) return known;
    const key = endpointKey(end);
    let id = this.byKey.get(key);
    if (id === undefined) {
      id = this.ends.length;
      this.ends.push(end);
      this.byKey.set(key, id);
    }
    this.byObject.set(end, id);
    return id;
  }

  end(id: number): TravelEndpoint | null {
    return id < 0 ? null : (this.ends[id] ?? null);
  }
}

export function collectGeometry(structure: Structure): Geometry | CompileFailure {
  const { input, walk } = structure;
  const { context } = input;
  const rules = context.rules;
  const steps = [...structure.steps.values()].sort((a, b) => a.index - b.index);
  const info = (i: number): StepInfo => {
    const found = structure.steps.get(i);
    if (found === undefined) throw new Error(`No step info for ${String(i)}`);
    return found;
  };

  // ---- Tiers (§5.3): the start tier, every tier a riding train sets, and 0 for walk steps while riding.
  const tierSet = new Set<number>([structure.startState.riding.trained]);
  for (const step of steps) if (step.step.kind === 'train' && step.riding.after !== step.riding.before) tierSet.add(step.riding.after);
  if ([...tierSet].some((t) => t > 0) && steps.some((step) => step.walk)) tierSet.add(0);
  const tiers = [...tierSet].sort((a, b) => a - b);
  const tierIndex = new Int32Array(3).fill(-1);
  tiers.forEach((t, k) => {
    tierIndex[t] = k;
  });

  const positions = new Positions();
  const chooser = structure.spawnChooser;

  // ---- Flight and transport steps, priced with the engine per from-position and tier (§5.4).
  const env = replayEnv(context, input.project, walk.places);
  const tableRuns = new Map<string, TableEntry>();
  const tableRun = (step: StepInfo, fromId: number, tier: number): TableEntry => {
    const key = `${String(step.index)}|${String(fromId)}|${String(tier)}`;
    let entry = tableRuns.get(key);
    if (entry === undefined) {
      const draft = step.table;
      if (draft === null) throw new Error(`Step ${String(step.index)} has no table`);
      const from = positions.end(fromId);
      const run = scratchStep({ env, project: input.project }, draft.state, draft.memo, step.index, draft.active, (state) => {
        state.location = from?.point ?? null;
        state.locationHint = from?.zoneHint ?? 0;
        state.locationCause = from === null ? 'unresolved' : null;
        state.riding = initialRiding(tier === 1 ? 1 : tier === 2 ? 2 : 0, rules);
      });
      const estimate = run.record.estimate;
      entry = {
        ms: Math.round((estimate.endSec - estimate.startSec) * 1000),
        exitMs: Math.round((estimate.breakdown.travel + estimate.breakdown.waiting) * 1000),
        unknown: estimate.duration.value === null ? 1 : 0,
        arrival: run.state.location === null ? null : { point: run.state.location, zoneHint: run.state.locationHint },
        legs: run.record.legsAsked,
      };
      tableRuns.set(key, entry);
    }
    return entry;
  };

  // ---- Positions after each op (§5.2): a set of possible from-positions maps to a set of ends.
  const chainOf = (step: StepInfo): { readonly ends: readonly (TravelEndpoint | null)[]; readonly prefixDone: boolean } | null => {
    if (step.chain === null) return null;
    const k = structure.chainIndex.get(step.chain);
    const chain = k === undefined ? undefined : structure.chains[k];
    return chain === undefined ? null : { ends: chain.ends, prefixDone: chain.prefixDone };
  };
  /** The position after the op from `from` (a waypoint chain precedes only fixed destinations). */
  const destImage = (step: StepInfo, from: number, out: Set<number>): void => {
    const d = step.dest;
    switch (d.kind) {
      case 'none':
        out.add(from);
        return;
      case 'loc':
      case 'hearth':
        out.add(positions.id(d.end));
        return;
      case 'lost':
        out.add(-1);
        return;
      case 'spawn': {
        const choice = chooser.choose(d.entity, positions.end(from)?.point ?? null);
        out.add(choice.kind === 'at' ? positions.id(choice.end) : choice.kind === 'none' ? from : -1);
        return;
      }
      case 'table':
        for (const tier of tiers) out.add(positions.id(tableRun(step, from, tier).arrival));
        return;
    }
  };
  const opImage = (step: StepInfo, froms: ReadonlySet<number>): ReadonlySet<number> => {
    if (!step.active) return froms;
    const out = new Set<number>();
    const d = step.dest;
    // A fixed destination ends at one place whatever the from-position.
    if (d.kind === 'loc' || d.kind === 'hearth' || d.kind === 'lost') {
      destImage(step, -1, out);
      return out;
    }
    for (const from of froms) destImage(step, from, out);
    return out;
  };

  const startId = walk.start.location === null ? -1 : positions.id({ point: walk.start.location, zoneHint: walk.start.locationHint });
  /** A unit's ends from a set of entry positions; with `record`, each op's from-set is kept. */
  const unitImage = (steps0: readonly number[], entry0: ReadonlySet<number>, record: Map<number, ReadonlySet<number>> | null): ReadonlySet<number> => {
    let froms = entry0;
    for (const i of steps0) {
      record?.set(i, froms);
      froms = opImage(info(i), froms);
    }
    return froms;
  };
  /**
   * Whether a unit ends where it does whatever its entry: it has an active op with a fixed
   * destination (the ops after it start from one place).
   */
  const fixedEnd = structure.units.map((unit) =>
    unit.steps.some((i) => {
      const step = info(i);
      const kind = step.dest.kind;
      return step.active && (kind === 'loc' || kind === 'hearth' || kind === 'lost');
    }),
  );
  // The fixpoint (§5.2): every unit may follow every other (and the start), except a block holding
  // the start. Known positions only: when the start is unknown, a block holding the start comes
  // first. Units whose end does not depend on their entry are imaged once.
  const entry = new Set<number>();
  if (startId >= 0) entry.add(startId);
  const unitEnds = new Set<number>();
  const absorb = (ends: ReadonlySet<number>): boolean => {
    let changed = false;
    for (const id of ends) {
      unitEnds.add(id);
      if (id < 0 || entry.has(id)) continue;
      entry.add(id);
      changed = true;
    }
    return changed;
  };
  structure.units.forEach((unit, u) => {
    if (fixedEnd[u] === true) absorb(unitImage(unit.steps, unit.first ? new Set([startId]) : new Set([startId]), null));
  });
  for (let changed = true, rounds = 0; changed; rounds += 1) {
    if (rounds > 64) return fail('the spawn fixpoint did not converge');
    changed = false;
    const frozen: ReadonlySet<number> = new Set(entry);
    structure.units.forEach((unit, u) => {
      if (fixedEnd[u] === true) return;
      if (absorb(unitImage(unit.steps, unit.first ? new Set([startId]) : frozen, null))) changed = true;
    });
  }
  // Each op's from-set, from the final entry set.
  const opFromIds = new Map<number, ReadonlySet<number>>();
  const finalEntry: ReadonlySet<number> = new Set(entry);
  for (const unit of structure.units) unitImage(unit.steps, unit.first ? new Set([startId]) : finalEntry, opFromIds);
  // The exit chain starts where any unit may end (or at the start, when every unit is dropped).
  const exitEnds = unitImage(structure.chain, new Set([...unitEnds, startId]), opFromIds);

  // ---- Locations: every position met, fixed destinations, waypoints, bind points, spawns chosen.
  const ids = new Set<number>();
  const addEnd = (end: TravelEndpoint | null): void => {
    if (end !== null) ids.add(positions.id(end));
  };
  // Every position the images met is interned already (spawns chosen from every from-position included).
  for (const step of steps) {
    const d = step.dest;
    if (d.kind === 'loc' || d.kind === 'hearth') addEnd(d.end);
    addEnd(step.bindBefore);
  }
  for (const chain of structure.chains) for (const end of chain.ends) addEnd(end);
  for (const run of tableRuns.values()) addEnd(run.arrival);
  for (const id of exitEnds) if (id >= 0) ids.add(id);
  for (let id = 0; id < positions.ends.length; id += 1) ids.add(id);
  const set = new LocationSet();
  for (const id of ids) addEndpoint(set, positions.end(id));
  if (set.size > MAX_LOCATIONS) return fail(`section too large: select fewer steps (${String(set.size)} locations of ${String(MAX_LOCATIONS)})`);
  const locations = indexLocations(set);
  const n = locations.table.count;
  const locCache = new Map<number, number>();
  /** Position id → location index. */
  const locOf = (id: number): number => {
    if (id < 0) return -1;
    let k = locCache.get(id);
    if (k === undefined) {
      const end = positions.end(id);
      k = end === null ? undefined : locations.index.get(endpointKey(end));
      if (k === undefined) throw new Error(`Position ${String(id)} is not a location`);
      locCache.set(id, k);
    }
    return k;
  };
  const locOfEnd = (end: TravelEndpoint | null): number => locOf(positions.id(end));

  // ---- Spawn tables (§5.2): the chosen location from the unknown position (slot 0) and from each location.
  const spawnEntities: EntityRef[] = [];
  const spawnTableOf = new Map<string, number>();
  for (const step of steps) {
    const d = step.dest;
    if (d.kind !== 'spawn') continue;
    const key = entityKey(d.entity);
    if (spawnTableOf.has(key)) continue;
    spawnTableOf.set(key, -1);
    spawnEntities.push(d.entity);
  }
  spawnEntities.sort((a, b) => (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : a.id - b.id));
  spawnEntities.forEach((ref, t) => spawnTableOf.set(entityKey(ref), t));
  const spawnData = new Int32Array(spawnEntities.length * (n + 1));
  spawnEntities.forEach((ref, t) => {
    for (let from = -1; from < n; from += 1) {
      const out = chooser.choose(ref, from < 0 ? null : (locations.endpoints[from]?.point ?? null));
      spawnData[t * (n + 1) + from + 1] = out.kind === 'none' ? SPAWN_NONE : out.kind === 'lost' ? SPAWN_LOST : locOfEnd(out.end);
    }
  });
  const spawnTables: SpawnTables = { count: spawnEntities.length, data: spawnData };

  // ---- From-locations per op, and the requested pairs (§5.3).
  const opFrom = new Map<number, Int32Array>();
  for (const [i, ids] of opFromIds) {
    const list = Int32Array.from([...ids].map(locOf));
    list.sort();
    opFrom.set(i, list);
  }
  const table = locations.table;
  const pairBits = new Uint8Array(n * n);
  let pairCount = 0;
  const addPair = (from: number, to: number): void => {
    if (from < 0 || to < 0) return;
    if ((table.mapId[from] ?? 0) !== (table.mapId[to] ?? 0) || (table.pointId[from] ?? -1) === (table.pointId[to] ?? -2)) return;
    const code = from * n + to;
    if (pairBits[code] === 0) {
      pairBits[code] = 1;
      pairCount += 1;
    }
  };
  const spawnTo = (table: number, from: number): number => spawnTables.data[table * (n + 1) + from + 1] ?? -1;
  const extra: TravelPair[] = [];
  const extraSeen = new Set<string>();
  const tables = new Map<number, (TableEntry | null)[]>();
  for (const step of steps) {
    if (!step.active) continue;
    const fromIds = opFromIds.get(step.index);
    const fromLocs = opFrom.get(step.index);
    if (fromIds === undefined || fromLocs === undefined) continue;
    const d = step.dest;
    if (d.kind === 'table') {
      const entries: (TableEntry | null)[] = new Array<TableEntry | null>(tiers.length * (n + 1)).fill(null);
      for (const fromId of fromIds) {
        tiers.forEach((tier, k) => {
          const run = tableRun(step, fromId, tier);
          entries[k * (n + 1) + locOf(fromId) + 1] = run;
          for (const leg of run.legs) {
            const key = `${endpointKey(leg.from)}>${endpointKey(leg.to)}`;
            if (extraSeen.has(key)) continue;
            extraSeen.add(key);
            extra.push(leg);
          }
        });
      }
      tables.set(step.index, entries);
      continue;
    }
    const target = d.kind === 'loc' ? locOfEnd(d.end) : -1;
    const spawnTable = d.kind === 'spawn' ? (spawnTableOf.get(entityKey(d.entity)) ?? -1) : -1;
    for (const from of fromLocs) {
      if (d.kind === 'loc') addPair(from, target);
      else if (d.kind === 'spawn') addPair(from, spawnTo(spawnTable, from));
    }
    const chain = chainOf(step);
    if (chain !== null && !chain.prefixDone) {
      const chainLocs = chain.ends.map(locOfEnd);
      for (const from of fromLocs) addPair(from, chainLocs[0] ?? -1);
      for (let k = 1; k < chainLocs.length; k += 1) addPair(chainLocs[k - 1] ?? -1, chainLocs[k] ?? -1);
      addPair(chainLocs[chainLocs.length - 1] ?? -1, target);
    }
  }
  const matrixPairs = new Int32Array(pairCount);
  for (let code = 0, k = 0; code < n * n; code += 1) if (pairBits[code] === 1) matrixPairs[k++] = code;
  const pairs: TravelPair[] = [];
  for (const code of matrixPairs) {
    const from = locations.endpoints[Math.floor(code / n)];
    const to = locations.endpoints[code % n];
    if (from !== undefined && to !== undefined) pairs.push({ from, to });
  }
  if (extra.length > 0) {
    const seen = new Set(pairs.map((pair) => `${endpointKey(pair.from)}>${endpointKey(pair.to)}`));
    for (const leg of extra) {
      const key = `${endpointKey(leg.from)}>${endpointKey(leg.to)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      pairs.push(leg);
    }
  }
  if (context.travel.id === 'navigation' && pairs.length > MAX_REQUESTED_LEGS) {
    return fail(`section too large: select fewer steps (${String(pairs.length)} legs of ${String(MAX_REQUESTED_LEGS)})`);
  }
  return { tiers, tierIndex, locations, spawnEntities, spawnTableOf, spawnTables, opFrom, tables, matrixPairs, pairs };
}
