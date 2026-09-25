import type { EntityRef } from './dataset';
import { type IdSource, type QuestId, type SpellId, type SkillId, stepId } from './ids';
import type {
  AbandonStep,
  AcceptStep,
  CompleteStep,
  FlightStep,
  GrindStep,
  GrindTarget,
  HearthStep,
  NoteStep,
  ObjectiveTarget,
  PreservedSource,
  TaxiNodeRef,
  TrainStep,
  TransportRef,
  TravelStep,
  TurnInStep,
  VendorStep,
} from './route';

/**
 * Pure step constructors. The id comes from the injected IdSource; every field the caller leaves
 * out is null (unknown or unset), `false`, or the kind's neutral mode, and the origin is manual.
 */

type CommonKey = 'location' | 'note' | 'locked' | 'groupId' | 'condition' | 'durationOverride' | 'origin' | 'rxp' | 'ext';

/** Fields every step kind shares, all optional. */
export type CommonStepFields = Partial<Pick<NoteStep, CommonKey>>;

type Common = Pick<NoteStep, 'id' | CommonKey>;

function common(ids: IdSource, fields: CommonStepFields): Common {
  return {
    id: stepId(ids.next('step')),
    location: fields.location ?? null,
    note: fields.note ?? null,
    locked: fields.locked ?? false,
    groupId: fields.groupId ?? null,
    condition: fields.condition ?? null,
    durationOverride: fields.durationOverride ?? null,
    origin: fields.origin ?? { source: 'manual', ref: null },
    rxp: fields.rxp ?? null,
    ext: fields.ext ?? null,
  };
}

export function makeNoteStep(
  ids: IdSource,
  fields: CommonStepFields & { readonly text: string; readonly preserved?: PreservedSource | null },
): NoteStep {
  return { ...common(ids, fields), kind: 'note', text: fields.text, preserved: fields.preserved ?? null };
}

/** A travel step's location is its destination; null means "somewhere unknown" (RXP `.zone`). */
export function makeTravelStep(
  ids: IdSource,
  fields: CommonStepFields & { readonly mode?: TravelStep['mode']; readonly transport?: TransportRef | null } = {},
): TravelStep {
  return { ...common(ids, fields), kind: 'travel', mode: fields.mode ?? 'auto', transport: fields.transport ?? null };
}

export function makeGrindStep(
  ids: IdSource,
  fields: CommonStepFields & {
    readonly until: GrindTarget;
    readonly mobLevel?: number | null;
    readonly xpPerHour?: number | null;
  },
): GrindStep {
  return {
    ...common(ids, fields),
    kind: 'grind',
    until: fields.until,
    mobLevel: fields.mobLevel ?? null,
    xpPerHour: fields.xpPerHour ?? null,
  };
}

export function makeAcceptStep(
  ids: IdSource,
  fields: CommonStepFields & {
    readonly questId: QuestId;
    readonly anyOf?: readonly QuestId[] | null;
    readonly via?: EntityRef | null;
  },
): AcceptStep {
  return {
    ...common(ids, fields),
    kind: 'accept',
    questId: fields.questId,
    anyOf: fields.anyOf ?? null,
    via: fields.via ?? null,
  };
}

export function makeTurnInStep(
  ids: IdSource,
  fields: CommonStepFields & {
    readonly questId: QuestId;
    readonly anyOf?: readonly QuestId[] | null;
    readonly rewardIndex?: number | null;
    readonly skipIfMissing?: boolean;
    readonly via?: EntityRef | null;
  },
): TurnInStep {
  return {
    ...common(ids, fields),
    kind: 'turnin',
    questId: fields.questId,
    anyOf: fields.anyOf ?? null,
    rewardIndex: fields.rewardIndex ?? null,
    skipIfMissing: fields.skipIfMissing ?? false,
    via: fields.via ?? null,
  };
}

export function makeCompleteStep(
  ids: IdSource,
  fields: CommonStepFields & {
    readonly targets: readonly ObjectiveTarget[];
    readonly progress?: CompleteStep['progress'];
  },
): CompleteStep {
  return { ...common(ids, fields), kind: 'complete', targets: fields.targets, progress: fields.progress ?? 'finish' };
}

export function makeAbandonStep(ids: IdSource, fields: CommonStepFields & { readonly questId: QuestId }): AbandonStep {
  return { ...common(ids, fields), kind: 'abandon', questId: fields.questId };
}

/** `use` (the default) teleports to the bind point; `bind` sets it at this step's location. */
export function makeHearthStep(
  ids: IdSource,
  fields: CommonStepFields & { readonly mode?: HearthStep['mode'] } = {},
): HearthStep {
  return { ...common(ids, fields), kind: 'hearth', mode: fields.mode ?? 'use' };
}

export function makeFlightStep(
  ids: IdSource,
  fields: CommonStepFields & {
    readonly mode?: FlightStep['mode'];
    readonly from?: TaxiNodeRef | null;
    readonly to?: TaxiNodeRef | null;
    readonly nodeQuery?: string | null;
  } = {},
): FlightStep {
  return {
    ...common(ids, fields),
    kind: 'flight',
    mode: fields.mode ?? 'take',
    from: fields.from ?? null,
    to: fields.to ?? null,
    nodeQuery: fields.nodeQuery ?? null,
  };
}

export function makeTrainStep(
  ids: IdSource,
  fields: CommonStepFields & {
    readonly spellId?: SpellId | null;
    readonly skill?: TrainStep['skill'];
    readonly skillId?: SkillId | null;
    readonly rank?: number | null;
    readonly what?: string | null;
    readonly cost?: number | null;
  } = {},
): TrainStep {
  return {
    ...common(ids, fields),
    kind: 'train',
    spellId: fields.spellId ?? null,
    skill: fields.skill ?? null,
    skillId: fields.skillId ?? null,
    rank: fields.rank ?? null,
    what: fields.what ?? null,
    cost: fields.cost ?? null,
  };
}

export function makeVendorStep(
  ids: IdSource,
  fields: CommonStepFields & { readonly what?: string | null } = {},
): VendorStep {
  return { ...common(ids, fields), kind: 'vendor', what: fields.what ?? null };
}
