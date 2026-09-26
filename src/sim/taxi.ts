import type { WorldPoint } from '../domain/points';
import { distanceYards } from '../geo/distance';
import { type EffectiveRules, markedKeys } from '../rules/precedence';
import type { RuleKey } from '../rules/ruleset';
import type { TimePart } from './estimate';
import type { SimFact } from './facts';
import { interactionTime } from './interaction';
import { ASSUMPTION, combine, mergeKeys, ruleInput, UNKNOWN, withBasis } from './provenance';

/**
 * Flight times (docs/SIMULATION.md TIME-5, TIME-6). The default is the straight line between the
 * two flight masters × `taxiDetourFactor` / (`taxiSpeed` × (1 + `taxiSpeedBonusPct` / 100)), plus
 * `flightMasterSeconds` (D-024). Per-leg lengths from a developer's local extraction
 * (`local-maps/taxi.local.json`, dev/preview only, D-022) replace it where they cover the journey.
 * Resolving the nodes (TaxiNodeRef, `nodeQuery`, known paths) is the walker's job with the
 * TravelGraph queries in src/rules.
 */

/** One direct leg of a local extraction: its two TaxiNodes ids and its 3D length along the path nodes. */
export interface LocalTaxiLeg {
  readonly from: number;
  readonly to: number;
  readonly l3dYards: number;
}

/** A TaxiNodes row of a local extraction: its id and world position (`Pos_0`, `Pos_1` on `ContinentID`). */
export interface LocalTaxiNode {
  readonly id: number;
  readonly point: WorldPoint;
}

/**
 * The local per-leg data (TIME-6). Transport paths (cost 0, stops with `Delay > 0`) are excluded
 * when the file is built. Never committed or deployed while OD-6 is pending. `nodes` lets a
 * dataset flight master, which has no TaxiNodes id, map to the row nearest it.
 */
export interface LocalTaxiData {
  readonly build: string;
  readonly legs: readonly LocalTaxiLeg[];
  readonly nodes?: readonly LocalTaxiNode[];
}

/**
 * How far a flight master may stand from its TaxiNodes row (INFERRED): a row further away is taken
 * to be another node, and the flight master stays unmatched (the flight falls back to TIME-5).
 */
export const LOCAL_NODE_MATCH_YARDS = 50;

/**
 * TIME-6: the TaxiNodes row of a local extraction nearest a flight master's position on its world
 * map, within `LOCAL_NODE_MATCH_YARDS` (INFERRED, local); ties go to the lower id. Null when none is.
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

/**
 * TIME-6 multi-hop: the shortest journey over the local legs (at one speed, shortest is quickest)
 * through intermediate nodes `usable` admits (known to the character and open to its faction);
 * ties by fewer legs, then by the sequence of node ids. Null when no journey exists.
 */
export function localTaxiRoute(data: LocalTaxiData, from: number, to: number, usable: (taxiNodeId: number) => boolean): LocalTaxiRoute | null {
  if (from === to) return { l3dYards: 0, nodes: [from] };
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
    for (const leg of data.legs) {
      if (leg.from !== node || settled.has(leg.to)) continue;
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
  /** Their TaxiNodes ids when known (a local extraction matches legs by them). */
  readonly fromTaxiNodeId: number | null;
  readonly toTaxiNodeId: number | null;
}

export interface Flight {
  /** `interaction` (the flight master) and `travel` (the flight; unknown across world maps). */
  readonly parts: readonly TimePart[];
  readonly model: 'straight-line' | 'local' | null;
  /** The local journey's nodes, when the local model priced it. */
  readonly nodes: readonly number[] | null;
  readonly used: readonly RuleKey[];
  readonly facts: readonly SimFact[];
}

/**
 * TIME-5 with TIME-6: `taxiModel` `'auto'` uses the local journey when `local` covers it, else the
 * straight line; `'straight-line'` always uses the straight line. Flights never cross world maps
 * (map changes are transports): across maps the flight is unknown and records
 * `cross-world-no-transport`. Basis `assumption` (the detour factor, or the local routing) with the
 * Era fallback of `taxiSpeed` in `forever-beta`.
 */
export function flightTime(
  input: FlightInput,
  rules: EffectiveRules,
  local: { readonly data: LocalTaxiData; readonly usable: (taxiNodeId: number) => boolean } | null = null,
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
  if (taxiModel.value === 'auto' && local !== null && input.fromTaxiNodeId !== null && input.toTaxiNodeId !== null) {
    const route = localTaxiRoute(local.data, input.fromTaxiNodeId, input.toTaxiNodeId, local.usable);
    if (route !== null) {
      return {
        parts: [master.part, { bucket: 'travel', seconds: withBasis(route.l3dYards / speed, combine([ASSUMPTION, ...speedInputs])) }],
        model: 'local',
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
    facts: [],
  };
}
