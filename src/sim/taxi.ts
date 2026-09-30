import type { WorldPoint } from '../domain/points';
import { distanceYards } from '../geo/distance';
import { type EffectiveRules, markedKeys } from '../rules/precedence';
import type { RuleKey } from '../rules/ruleset';
import type { CommittedTaxi } from '../rules/travel-graph';
import type { TimePart } from './estimate';
import type { SimFact } from './facts';
import { interactionTime } from './interaction';
import { ASSUMPTION, combine, mergeKeys, ruleInput, UNKNOWN, withBasis } from './provenance';

/**
 * Flight times (docs/SIMULATION.md TIME-5, TIME-6). With `taxiModel: 'auto'`, a journey the
 * per-leg data covers (TIME-6) is the shortest path over its flights' 3D lengths at the effective
 * taxi speed, plus `flightMasterSeconds`. The per-leg data is the committed client taxi file
 * (D-039 B: `public/maps/client/taxi.json`, `taxiLegDataOf`), in every build that loads it; a
 * developer's local extraction (`local-maps/taxi.local.json`) has the same shape. Otherwise, and
 * whenever the file failed to load, it is TIME-5: the straight line between the two flight masters
 * × `taxiDetourFactor` / (`taxiSpeed` × (1 + `taxiSpeedBonusPct` / 100)), plus
 * `flightMasterSeconds` (D-024). Resolving the nodes (TaxiNodeRef, `nodeQuery`, known paths) is the
 * walker's job with the TravelGraph queries in src/rules.
 */

/** One direct flight of the per-leg data: its two TaxiNodes ids and its 3D length along the path nodes. */
export interface TaxiLeg {
  readonly from: number;
  readonly to: number;
  readonly l3dYards: number;
}

/** A TaxiNodes row of the per-leg data: its id and world position (`Pos_0`, `Pos_1` on `ContinentID`). */
export interface TaxiLegNode {
  readonly id: number;
  readonly point: WorldPoint;
}

/**
 * The per-leg data of TIME-6: the committed taxi file's flights (`taxiLegDataOf`), or a local
 * extraction of the same shape. Transport paths (cost 0, stops with `Delay > 0`) are never legs.
 * `nodes` lets a dataset flight master that has no TaxiNodes id map to the row nearest it.
 */
export interface TaxiLegData {
  readonly build: string;
  readonly legs: readonly TaxiLeg[];
  readonly nodes?: readonly TaxiLegNode[];
}

/** The names of Milestone 6, when the per-leg data could only be a local extraction. */
export type LocalTaxiLeg = TaxiLeg;
export type LocalTaxiNode = TaxiLegNode;
export type LocalTaxiData = TaxiLegData;

/**
 * TIME-6 from the committed client taxi file (D-039 B, OD-6 closed): each `TaxiPath` with `Cost` >
 * 0 is a leg with its client 3D length, each `TaxiNodes` row a node with its position. The numbers
 * are the file's; nothing is estimated.
 */
export function taxiLegDataOf(taxi: CommittedTaxi): TaxiLegData {
  return {
    build: taxi.build,
    legs: taxi.flights.map((flight) => ({ from: flight.from, to: flight.to, l3dYards: flight.l3dYards })),
    nodes: taxi.nodes.map((node) => ({ id: node.id, point: node.point })),
  };
}

/**
 * How far a flight master may stand from its TaxiNodes row (INFERRED): a row further away is taken
 * to be another node, and the flight master stays unmatched (the flight falls back to TIME-5). The
 * TravelGraph matches the committed file's rows with the same distance (`CLIENT_NODE_MATCH_YARDS`),
 * so a node seeded from the file already carries its row.
 */
export const LOCAL_NODE_MATCH_YARDS = 50;

/**
 * TIME-6: the TaxiNodes row of the per-leg data nearest a flight master's position on its world
 * map, within `LOCAL_NODE_MATCH_YARDS` (INFERRED); ties go to the lower id. Null when none is.
 */
export function nearestLocalTaxiNode(data: LocalTaxiData, point: WorldPoint): number | null {
  let best: number | null = null;
  let bestYards = Number.POSITIVE_INFINITY;
  for (const node of data.nodes ?? []) {
    const yards = distanceYards(point, node.point);
    if (yards === null || yards > LOCAL_NODE_MATCH_YARDS) continue;
    if (yards < bestYards || (yards === bestYards && best !== null && node.id < best)) {
      best = node.id;
      bestYards = yards;
    }
  }
  return best;
}

export interface LocalTaxiRoute {
  readonly l3dYards: number;
  /** TaxiNodes ids from start to end. */
  readonly nodes: readonly number[];
}

interface Label {
  readonly yards: number;
  readonly nodes: readonly number[];
}

function better(a: Label, b: Label): boolean {
  if (a.yards !== b.yards) return a.yards < b.yards;
  if (a.nodes.length !== b.nodes.length) return a.nodes.length < b.nodes.length;
  for (let i = 0; i < a.nodes.length; i += 1) {
    const x = a.nodes[i] ?? 0;
    const y = b.nodes[i] ?? 0;
    if (x !== y) return x < y;
  }
  return false;
}

const NO_LEGS: readonly TaxiLeg[] = [];
const LEGS_FROM = new WeakMap<LocalTaxiData, ReadonlyMap<number, readonly TaxiLeg[]>>();

/** The per-leg data's legs by departure node, in data order: built once per data (review TR-11). */
function legsFromOf(data: LocalTaxiData): ReadonlyMap<number, readonly TaxiLeg[]> {
  let out = LEGS_FROM.get(data);
  if (out === undefined) {
    const byFrom = new Map<number, TaxiLeg[]>();
    for (const leg of data.legs) {
      const list = byFrom.get(leg.from);
      if (list === undefined) byFrom.set(leg.from, [leg]);
      else list.push(leg);
    }
    out = byFrom;
    LEGS_FROM.set(data, out);
  }
  return out;
}

/**
 * TIME-6 multi-hop: the shortest journey over the per-leg data (at one speed, shortest is quickest)
 * through intermediate nodes `usable` admits (known to the character and open to its faction);
 * ties by fewer legs, then by the sequence of node ids. Null when no journey exists.
 */
export function localTaxiRoute(data: LocalTaxiData, from: number, to: number, usable: (taxiNodeId: number) => boolean): LocalTaxiRoute | null {
  if (from === to) return { l3dYards: 0, nodes: [from] };
  const out = legsFromOf(data);
  const best = new Map<number, Label>([[from, { yards: 0, nodes: [from] }]]);
  const settled = new Set<number>();
  for (;;) {
    let current: [number, Label] | null = null;
    for (const entry of best) {
      if (settled.has(entry[0])) continue;
      if (current === null || better(entry[1], current[1])) current = entry;
    }
    if (current === null) return null;
    const [node, label] = current;
    if (node === to) return { l3dYards: label.yards, nodes: label.nodes };
    settled.add(node);
    if (node !== from && !usable(node)) continue;
    for (const leg of out.get(node) ?? NO_LEGS) {
      if (settled.has(leg.to)) continue;
      const candidate: Label = { yards: label.yards + leg.l3dYards, nodes: [...label.nodes, leg.to] };
      const known = best.get(leg.to);
      if (known === undefined || better(candidate, known)) best.set(leg.to, candidate);
    }
  }
}

export interface FlightInput {
  /** The world positions of the two taxi nodes. */
  readonly from: WorldPoint;
  readonly to: WorldPoint;
  /** Their TaxiNodes ids when known (the per-leg data matches legs by them). */
  readonly fromTaxiNodeId: number | null;
  readonly toTaxiNodeId: number | null;
}

export interface Flight {
  /** `interaction` (the flight master) and `travel` (the flight; unknown across world maps). */
  readonly parts: readonly TimePart[];
  /** `taxi-path`: TIME-6 over the per-leg data; `straight-line`: TIME-5; null: across world maps. */
  readonly model: 'straight-line' | 'taxi-path' | null;
  /** The journey's TaxiNodes ids, when TIME-6 priced it. */
  readonly nodes: readonly number[] | null;
  readonly used: readonly RuleKey[];
  readonly facts: readonly SimFact[];
}

/**
 * TIME-5 with TIME-6: `taxiModel` `'auto'` uses the journey over the per-leg data when `local`
 * (the committed taxi file, or a local extraction) covers it, else the straight line;
 * `'straight-line'` always uses the straight line. Flights never cross world maps (map changes are
 * transports): across maps the flight is unknown and records `cross-world-no-transport`. When
 * `local` has a journey only through rows that are open to the faction but not known, the straight
 * line is used and `flight-no-known-journey` recorded (the SIM-7 variant, TIME-6). Basis
 * `assumption` (the detour factor, or the routing over client path lengths) with the Era fallback
 * of `taxiSpeed` in `forever-beta`.
 */
export function flightTime(
  input: FlightInput,
  rules: EffectiveRules,
  local: {
    readonly data: LocalTaxiData;
    /** Rows usable as intermediate nodes: known to the character and open to its faction. */
    readonly usable: (taxiNodeId: number) => boolean;
    /**
     * Rows open to the character's faction, known or not: when a journey exists through them but
     * none through `usable` ones, the flight records `flight-no-known-journey` (SIM-7 variant).
     * Absent: no such check.
     */
    readonly open?: (taxiNodeId: number) => boolean;
  } | null = null,
): Flight {
  const { taxiModel, taxiSpeed, taxiDetourFactor, taxiSpeedBonusPct } = rules.values;
  const master = interactionTime({ kind: 'flight-master' }, rules);
  const speed = taxiSpeed.value * (1 + taxiSpeedBonusPct.value / 100);
  const straight = distanceYards(input.from, input.to);
  if (straight === null) {
    return {
      parts: [master.part, { bucket: 'travel', seconds: withBasis<number>(null, UNKNOWN) }],
      model: null,
      nodes: null,
      used: master.used,
      facts: [{ kind: 'cross-world-no-transport', fromMapId: input.from.mapId, toMapId: input.to.mapId }],
    };
  }
  const speedInputs = [ruleInput(taxiSpeed), ruleInput(taxiSpeedBonusPct)];
  let noJourney = false;
  if (taxiModel.value === 'auto' && local !== null && input.fromTaxiNodeId !== null && input.toTaxiNodeId !== null) {
    const route = localTaxiRoute(local.data, input.fromTaxiNodeId, input.toTaxiNodeId, local.usable);
    // TIME-6: the file has a journey only through flight points not known yet: TIME-5 with the SIM-7 variant.
    noJourney = route === null && local.open !== undefined && localTaxiRoute(local.data, input.fromTaxiNodeId, input.toTaxiNodeId, local.open) !== null;
    if (route !== null) {
      return {
        parts: [master.part, { bucket: 'travel', seconds: withBasis(route.l3dYards / speed, combine([ASSUMPTION, ...speedInputs])) }],
        model: 'taxi-path',
        nodes: route.nodes,
        used: mergeKeys(master.used, markedKeys(rules, ['taxiModel', 'taxiSpeed', 'taxiSpeedBonusPct'])),
        facts: [],
      };
    }
  }
  return {
    parts: [
      master.part,
      { bucket: 'travel', seconds: withBasis((straight * taxiDetourFactor.value) / speed, combine([ruleInput(taxiDetourFactor), ...speedInputs])) },
    ],
    model: 'straight-line',
    nodes: null,
    used: mergeKeys(master.used, markedKeys(rules, ['taxiModel', 'taxiSpeed', 'taxiDetourFactor', 'taxiSpeedBonusPct'])),
    facts: noJourney ? NO_JOURNEY : [],
  };
}

const NO_JOURNEY: readonly SimFact[] = [{ kind: 'flight-no-known-journey' }];
