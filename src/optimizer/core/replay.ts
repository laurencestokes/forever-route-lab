import type { GroupId } from '../../domain/ids';
import { routeGroup } from '../../domain/route-ops';
import { createBasicAcceptPolicy } from '../../engine/accept';
import { createWalkEnv, type LegRecorder, recordingModel, type WalkEnv } from '../../engine/env';
import { sharedSimCache } from '../../engine/sim-cache';
import { cloneState, type WalkMemo } from '../../engine/state';
import { runStep, stepActivity } from '../../engine/steps';
import type { CharacterState, EngineContext, ReadonlyCharacterState, StepRecord, WalkProject } from '../../engine/types';
import { markedKeys } from '../../rules/precedence';
import { ruleInput } from '../../sim/provenance';
import { xpCurveOf } from '../../sim/xp';
import type { CompileInput, ReadonlyWalkMemo, SectionWalk } from './types';

/**
 * The section replay (a stand-in for the M7.0 engine exports `flightDeparture`, `chooseCrossing`
 * and the exit-chain tables, docs/research/optimizer-m7.md §5.4): compile runs the section, and the
 * suffix up to the end of the exit chain, through the engine's own `runStep` from the walk's state
 * and memo at the section start. The replay's live state before each step gives what compile reads
 * (log entries, the bind point, riding), and scratch copies of it, moved to another location, price
 * the steps whose choices read the position (flights and transports) with the engine itself, so the
 * optimiser and the engine agree by construction.
 */

export interface Replay {
  readonly env: WalkEnv;
  readonly project: WalkProject;
  /** The working state (mutated step by step). */
  readonly state: CharacterState;
  readonly memo: WalkMemo;
}

/** A mutable copy of a read-only memo. */
export function copyMemo(memo: ReadonlyWalkMemo): WalkMemo {
  return {
    groupSkip: new Map(memo.groupSkip),
    waypointsDone: new Set<GroupId>(memo.waypointsDone),
    visitKey: memo.visitKey,
    entrance: memo.entrance,
  };
}

/** The walk environment a `RouteWalker` would build for this context (engine/walker.ts). */
export function replayEnv(context: CompileInput['context'], project: WalkProject, places: SectionWalk['places']): WalkEnv {
  const engineContext: EngineContext = context;
  const recorder: LegRecorder = { current: null };
  const curve = xpCurveOf(context.rules);
  return createWalkEnv(
    {
      context: engineContext,
      dataset: context.dataset,
      rules: context.rules,
      curve,
      levelInputs: {
        table: curve.basis,
        tableKeys: markedKeys(context.rules, ['xpToNextLevel']),
        cap: ruleInput(context.rules.values.maxLevel),
        capKeys: markedKeys(context.rules, ['maxLevel']),
      },
      graph: context.graph,
      places,
      model: recordingModel(context.travel, recorder),
      recorder,
      sim: sharedSimCache(context.rules, context.dataset),
      acceptPolicy: context.acceptPolicy ?? createBasicAcceptPolicy(context.dataset),
    },
    project,
  );
}

/** A replay positioned before the section's first step. */
export function startReplay(input: Pick<CompileInput, 'context' | 'project'>, walk: Pick<SectionWalk, 'start' | 'memo' | 'places'>): Replay {
  return {
    env: replayEnv(input.context, input.project, walk.places),
    project: input.project,
    state: cloneState(walk.start),
    memo: copyMemo(walk.memo),
  };
}

/** Runs step `index` on the replay's working state, as the walker does; returns its record. */
export function replayStep(replay: Replay, index: number): StepRecord {
  const step = replay.project.route.steps[index];
  if (step === undefined) throw new RangeError(`No step ${String(index)}`);
  const group = step.groupId === null ? null : routeGroup(replay.project.route, step.groupId);
  const active = stepActivity(replay.env, replay.state, replay.memo, step, group);
  const record = runStep(replay.env, replay.state, replay.memo, step, index, group, active);
  replay.env.recorder.current = null;
  return record;
}

/**
 * Runs step `index` once on a scratch copy of `state` and `memo`, after `prepare` changes the copy
 * (for example its position or riding), with the activity the original walk gave the step.
 */
export function scratchStep(
  replay: Pick<Replay, 'env' | 'project'>,
  state: ReadonlyCharacterState,
  memo: ReadonlyWalkMemo,
  index: number,
  active: boolean | 'unknown',
  prepare: (state: CharacterState) => void,
): { readonly record: StepRecord; readonly state: CharacterState } {
  const step = replay.project.route.steps[index];
  if (step === undefined) throw new RangeError(`No step ${String(index)}`);
  const group = step.groupId === null ? null : routeGroup(replay.project.route, step.groupId);
  const scratch = cloneState(state);
  prepare(scratch);
  const record = runStep(replay.env, scratch, copyMemo(memo), step, index, group, active);
  replay.env.recorder.current = null;
  return { record, state: scratch };
}
