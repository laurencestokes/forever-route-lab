import { type QuestId, questId } from '../domain/ids';
import type { CharacterState } from '../engine/types';

/**
 * Synthetic walker states for the validator's tests: the fields a check reads, with made-up quest
 * ids. Nothing here is imported by application code.
 */

export interface StateFields {
  readonly level?: number;
  readonly unknownXpEvents?: number;
  readonly xpBasis?: CharacterState['xpBasis'];
  readonly xpEraFallback?: boolean;
  readonly log?: readonly number[];
  readonly completed?: readonly number[];
  readonly abandoned?: readonly number[];
  readonly accepted?: readonly number[];
  readonly skills?: Readonly<Record<number, number>>;
  readonly trainedSkills?: readonly number[];
  readonly reputationDelta?: Readonly<Record<number, number>>;
  readonly knownSpells?: readonly number[];
}

const numberMap = (record: Readonly<Record<number, number>> = {}): Map<number, number> => new Map(Object.entries(record).map(([key, value]) => [Number(key), value]));

/** A character state with the given fields; the rest empty, at level 10 with no unknown XP. */
export function stateWith(fields: StateFields = {}): CharacterState {
  const ids = (list: readonly number[] = []): Set<QuestId> => new Set(list.map(questId));
  return {
    timeSec: 0,
    location: null,
    locationHint: 0,
    locationCause: 'start-unset',
    level: fields.level ?? 10,
    xp: 0,
    unknownXpEvents: fields.unknownXpEvents ?? 0,
    xpBasis: fields.xpBasis ?? 'source',
    xpEraFallback: fields.xpEraFallback ?? false,
    questLog: new Map((fields.log ?? []).map((id) => [questId(id), { objectives: [], failed: false, routeAccepted: true }])),
    completed: ids(fields.completed),
    abandoned: ids(fields.abandoned),
    acceptedInRoute: ids(fields.accepted),
    itemsBeforeAccept: new Map(),
    knownFlightPaths: new Set(),
    hearth: null,
    hearthHint: 0,
    hearthReadyAt: 0,
    sinceCastBasis: 'source',
    sinceCastEraFallback: false,
    riding: { trained: 0, speedBonus: 0 },
    skills: numberMap(fields.skills),
    trainedSkills: new Set(fields.trainedSkills ?? []),
    reputationDelta: numberMap(fields.reputationDelta),
    knownSpells: new Set(fields.knownSpells ?? []),
  };
}
