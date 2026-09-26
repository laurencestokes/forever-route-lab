import type { StepId } from '../domain/ids';
import type { ValidationIssue } from '../domain/issues';
import type { TravelWarning } from '../domain/travel';
import type { ReadonlyCharacterState } from '../engine/types';
import type { EffectiveRules } from '../rules/precedence';
import type { SimFact } from '../sim/facts';
import { countText, createIssue, durationText, listText, type QuestNames, questLabel } from './issue';

/**
 * Simulation facts to issues (docs/SIMULATION.md §7.7; D-037: `src/sim` and the engine record
 * facts, only `src/validate` owns codes). Each `SimFact` kind maps to one SIM code, or to
 * `VAL030-objectives-incidental` or `VAL030-objectives-carried` (TIME-11, D-040); `pending-leg` is
 * counted into the route-level SIM-22, and `mob-level-assumed` (KXP-4) and `position-unknown`
 * (TIME-2) are not issues. The travel warnings of one step (SIM-17..21) are merged per kind, so a
 * step that walks several legs through the same passage says so once.
 */

const END_TEXT = { from: 'departure', to: 'destination' } as const;

const FLIGHT_REASON_TEXT = {
  'no-node': 'no flight node matches',
  'several-nodes': 'several flight nodes match',
  'no-position': 'the flight node has no position',
} as const;

const TIME_REASON_TEXT = {
  'reputation-objective': 'a reputation objective has no count',
  'item-without-source': 'the item has no known source',
  'above-max-level': 'the level is beyond the XP table',
  'gray-mob': 'the mobs give no XP at this level',
  'zero-rate': 'at 0 XP per hour the grind never reaches its target',
} as const;

const NAVMESH_END_TEXT = { from: 'start', to: 'end', both: 'start and end' } as const;

/** One step's travel warnings, merged per kind. */
interface TravelTally {
  noWalkingPath: number;
  offNavmesh: number;
  offEnds: { from: boolean; to: boolean };
  passages: number;
  passageNames: Set<string>;
  ambiguous: number;
  swims: number;
  longestSwimYd: number;
}

function tally(warnings: readonly TravelWarning[]): TravelTally {
  const out: TravelTally = { noWalkingPath: 0, offNavmesh: 0, offEnds: { from: false, to: false }, passages: 0, passageNames: new Set(), ambiguous: 0, swims: 0, longestSwimYd: 0 };
  for (const warning of warnings) {
    switch (warning.kind) {
      case 'no-walking-path':
        out.noWalkingPath += 1;
        break;
      case 'off-navmesh':
        out.offNavmesh += 1;
        if (warning.end !== 'to') out.offEnds.from = true;
        if (warning.end !== 'from') out.offEnds.to = true;
        break;
      case 'unverified-passage':
        out.passages += 1;
        for (const name of warning.passages) out.passageNames.add(name);
        break;
      case 'ambiguous-floor':
        out.ambiguous += 1;
        break;
      case 'long-swim':
        out.swims += 1;
        out.longestSwimYd = Math.max(out.longestSwimYd, warning.longestSwimYd);
        break;
    }
  }
  return out;
}

const legsText = (count: number): string => (count === 1 ? 'a leg' : `${String(count)} legs`);

function travelIssues(stepId: StepId, warnings: readonly TravelWarning[], out: ValidationIssue[]): void {
  const t = tally(warnings);
  if (t.noWalkingPath > 0) out.push(createIssue('SIM017-no-walking-path', stepId, null, { legs: t.noWalkingPath }, { legsText: legsText(t.noWalkingPath) }));
  if (t.offNavmesh > 0) {
    const end = t.offEnds.from && t.offEnds.to ? 'both' : t.offEnds.from ? 'from' : 'to';
    out.push(createIssue('SIM018-off-navmesh', stepId, null, { legs: t.offNavmesh, end }, { legsText: legsText(t.offNavmesh), endText: NAVMESH_END_TEXT[end] }));
  }
  if (t.passages > 0) {
    const names = [...t.passageNames].sort();
    out.push(
      createIssue('SIM019-unverified-passage', stepId, null, { legs: t.passages, passages: names.join(', ') }, { passageText: names.length > 0 ? listText(names) : 'an unnamed passage' }),
    );
  }
  if (t.ambiguous > 0) out.push(createIssue('SIM020-ambiguous-floor', stepId, null, { legs: t.ambiguous }, { legsText: legsText(t.ambiguous) }));
  if (t.swims > 0) out.push(createIssue('SIM021-long-swim', stepId, null, { legs: t.swims, longestSwimYd: Math.round(t.longestSwimYd) }, null));
}

/** What fact issues read besides the facts. */
export interface FactContext {
  /** SIM-11's warning limit. */
  readonly rules: EffectiveRules;
  readonly names: QuestNames;
  /** A taxi node's name for SIM-7 messages, or null when unknown. */
  readonly taxiName: ((key: string) => string | null) | null;
}

/**
 * The issues of one step's facts, appended to `out`. `state` is the state after the step (for the
 * basis of a level named in a message).
 */
export function factIssues(stepId: StepId, facts: readonly SimFact[], state: ReadonlyCharacterState, context: FactContext, out: ValidationIssue[]): void {
  const { rules, names } = context;
  let warnings: TravelWarning[] | null = null;
  for (const fact of facts) {
    switch (fact.kind) {
      case 'unknown-xp':
        out.push(createIssue('SIM001-unknown-xp', stepId, fact.questId, { reason: fact.reason }, { quest: questLabel(names, fact.questId) }));
        break;
      case 'grind-upper-bound':
        out.push(createIssue('SIM002-grind-upper-bound', stepId, null, null, null));
        break;
      case 'unresolved-location':
        out.push(createIssue('SIM003-unresolved-location', stepId, null, null, null));
        break;
      case 'cross-world-no-transport':
        out.push(createIssue('SIM004-cross-world-no-transport', stepId, null, { fromMapId: fact.fromMapId, toMapId: fact.toMapId }, null));
        break;
      case 'hearth-cooldown':
        out.push(
          createIssue(fact.upperBound ? 'SIM005-hearth-cooldown-uncertain' : 'SIM005-hearth-cooldown', stepId, null, { waitSeconds: Math.round(fact.waitSeconds) }, {
            waitText: durationText(fact.waitSeconds),
          }),
        );
        break;
      case 'hearth-unbound':
        out.push(createIssue('SIM006-hearth-unbound', stepId, null, null, null));
        break;
      case 'flight-unknown-path':
      {
        const name = context.taxiName?.(fact.node) ?? null;
        out.push(createIssue('SIM007-flight-unknown-path', stepId, null, { end: fact.end, node: fact.node }, { endText: END_TEXT[fact.end], nodeText: name === null ? fact.node : `${name} (${fact.node})` }));
      }
        break;
      case 'flight-unresolved':
        out.push(createIssue('SIM008-flight-unresolved', stepId, null, { end: fact.end, reason: fact.reason }, { endText: END_TEXT[fact.end], reasonText: FLIGHT_REASON_TEXT[fact.reason] }));
        break;
      case 'mount-untrained':
        out.push(createIssue('SIM009-mount-untrained', stepId, null, null, null));
        break;
      case 'riding-too-low':
        out.push(
          createIssue(
            fact.uncertain ? 'SIM010-riding-too-low-uncertain' : 'SIM010-riding-too-low',
            stepId,
            null,
            { tier: fact.tier, requiredLevel: fact.requiredLevel, level: fact.level, levelBasis: state.xpBasis, levelEraFallback: state.xpEraFallback },
            null,
          ),
        );
        break;
      case 'target-level-late': {
        const warnSeconds = rules.values.grindWarnSeconds.value;
        out.push(
          createIssue(
            fact.uncertain ? 'SIM011-target-level-late-uncertain' : 'SIM011-target-level-late',
            stepId,
            null,
            { seconds: Math.round(fact.seconds), warnSeconds },
            { durationText: durationText(fact.seconds), warnText: durationText(warnSeconds) },
          ),
        );
        break;
      }
      case 'objective-already-done':
        out.push(
          createIssue('SIM012-objective-already-done', stepId, fact.questId, { objective: fact.objective }, {
            quest: questLabel(names, fact.questId),
            objectiveText: fact.objective === null ? 'every objective is' : `objective ${String(fact.objective + 1)} is`,
          }),
        );
        break;
      case 'condition-unknown':
        out.push(createIssue('SIM013-condition-unknown', stepId, null, null, null));
        break;
      case 'transport-faction':
        out.push(createIssue('SIM014-transport-faction', stepId, null, { transportId: fact.transportId }, null));
        break;
      case 'time-unknown':
        out.push(
          createIssue('SIM015-time-unknown', stepId, fact.questId, { part: fact.part, reason: fact.reason, objective: fact.objective }, {
            reasonText: TIME_REASON_TEXT[fact.reason],
          }),
        );
        break;
      case 'grind-zero-rate':
        out.push(createIssue('SIM015-time-unknown', stepId, null, { part: 'grind', reason: 'zero-rate', objective: null }, { reasonText: TIME_REASON_TEXT['zero-rate'] }));
        break;
      case 'complete-not-in-log':
        out.push(createIssue('SIM016-complete-not-in-log', stepId, fact.questId, null, { quest: questLabel(names, fact.questId) }));
        break;
      case 'objectives-incidental':
        out.push(
          createIssue('VAL030-objectives-incidental', stepId, fact.questId, { objectives: fact.objectives.join(',') }, {
            quest: questLabel(names, fact.questId),
            objectiveText: objectiveText(fact.objectives),
          }),
        );
        break;
      case 'objectives-carried':
        out.push(
          createIssue('VAL030-objectives-carried', stepId, fact.questId, { objectives: fact.objectives.join(','), time: fact.time }, {
            quest: questLabel(names, fact.questId),
            objectiveText: objectiveText(fact.objectives),
            workText: CARRIED_WORK_TEXT[fact.time],
          }),
        );
        break;
      case 'travel-warning':
        (warnings ??= []).push(fact.warning);
        break;
      case 'pending-leg':
      case 'mob-level-assumed':
      case 'position-unknown':
      case 'objectives-before-accept':
        break;
    }
  }
  if (warnings !== null) travelIssues(stepId, warnings, out);
}

/** 0-based objective indices as the 1-based numbers RXP and the quest log show. */
const listNumbers = (indices: readonly number[]): string => listText(indices.map((index) => String(index + 1)));

/** `objective 1`, `objectives 1 and 3`. */
const objectiveText = (indices: readonly number[]): string => `${indices.length === 1 ? 'objective' : 'objectives'} ${listNumbers(indices)}`;

/** What a turn-in's numbers take from the work it carries (D-040), by the fact's `time`. */
const CARRIED_WORK_TEXT: Readonly<Record<Extract<SimFact, { readonly kind: 'objectives-carried' }>['time'], string>> = {
  counted: 'the time and kill XP of that work are added to the turn-in, without the travel to it',
  overridden: "the kill XP of that work is added to the turn-in, and the step's duration override stands in for its time",
  unknown: 'the kill XP of that work is added to the turn-in, but its time cannot be estimated',
};

/** SIM-22: the route-level info while navigation legs are pending (their seconds are the fallback). */
export function pendingLegsIssue(legs: number, steps: number): ValidationIssue {
  return createIssue('SIM022-legs-pending', null, null, { legs, steps }, { stepsText: countText(steps, 'step') });
}
