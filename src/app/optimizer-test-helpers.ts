import type { QuestRecord } from '../domain/dataset';
import { type IdSource, questId, sequentialIdSource, worldMapId } from '../domain/ids';
import { type Location, worldSourcedPoint } from '../domain/points';
import type { CharacterProfile, ProjectV1 } from '../domain/project';
import { createEmptyProject } from '../domain/project-factory';
import type { RouteStep } from '../domain/route';
import { makeAcceptStep, makeNoteStep, makeTurnInStep } from '../domain/step-factory';
import { fixtureGeometry } from '../geo/test-fixtures';
import { analyseSection } from '../optimizer/core';
import type { OptimizationRequest, SectionAnalysis } from '../optimizer/types';
import { type DatasetSource, staticDatasetSource } from './dataset-source';
import { stubDataset, stubQuest } from './map-test-helpers';
import type { NavigationState } from './navigation-runtime';
import { createOptimizationHost, type OptimizationHost } from './optimizer-host';
import { sectionAnchors } from './optimizer-run';
import type { BaselineWalk } from './optimizer-verify';
import { createRunWalker, type RunWalker, walkSection } from './optimizer-walk';

/**
 * Test support for the app's optimiser files (not imported by application code): projects on
 * Kalimdor in world yards under harness H's assumptions (10 yd/s on foot, detour 1: a leg takes
 * yards / 10 seconds), a stub dataset of their quests, requests, and a run's baseline walk.
 */

export const T0 = '2026-09-27T12:00:00.000Z';

export const at = (x: number, y: number): Location => ({ source: worldSourcedPoint(worldMapId(1), x, y), label: null, radius: null });

/** A quest at level 30 (XP exactly `xp` for a level-10 character), minimum level 1. */
export const appQuest = (id: number, xp: number, fields: Partial<QuestRecord> = {}): QuestRecord =>
  stubQuest({ id: questId(id), name: `Quest ${String(id)}`, level: 30, minLevel: 1, xp: { questLevel: 30, baseXp: xp, basis: 'era-seed' }, ...fields });

export interface AppScenario {
  readonly project: ProjectV1;
  readonly data: DatasetSource;
  /** Route indices of the section (every step but the last, the exit note). */
  readonly section: { readonly first: number; readonly last: number };
}

/** Builds steps with one id source: `pair` accepts and turns a quest in at one point. */
export function appSteps(ids: IdSource = sequentialIdSource()) {
  return {
    ids,
    accept: (q: number, x: number, y: number, fields: Partial<RouteStep> = {}): RouteStep => ({ ...makeAcceptStep(ids, { questId: questId(q), location: at(x, y) }), ...fields }) as RouteStep,
    turnin: (q: number, x: number, y: number, fields: Partial<RouteStep> = {}): RouteStep => ({ ...makeTurnInStep(ids, { questId: questId(q), location: at(x, y) }), ...fields }) as RouteStep,
    note: (x: number, y: number, fields: Partial<RouteStep> = {}): RouteStep => ({ ...makeNoteStep(ids, { text: 'note', location: at(x, y) }), ...fields }) as RouteStep,
    pair: (q: number, x: number, y: number): RouteStep[] => [makeAcceptStep(ids, { questId: questId(q), location: at(x, y) }), makeTurnInStep(ids, { questId: questId(q), location: at(x, y) })],
  };
}

/** A level-10 Horde orc warrior at (0, 0); the section is `steps` after `prefix`, the suffix `suffix` (default: an exit note). */
export function appScenario(options: {
  readonly quests: readonly QuestRecord[];
  readonly prefix?: readonly RouteStep[];
  readonly steps: readonly RouteStep[];
  readonly exit?: readonly [number, number];
  readonly suffix?: readonly RouteStep[];
  readonly character?: Partial<CharacterProfile>;
}): AppScenario {
  const exit = options.exit ?? [0, 0];
  const suffix = options.suffix ?? [makeNoteStep(sequentialIdSource(9000), { text: 'exit', location: at(exit[0], exit[1]) })];
  const base = createEmptyProject({
    ids: sequentialIdSource(100),
    nowIso: T0,
    name: 'Optimiser',
    character: { faction: 'Horde', race: 'Orc', class: 'WARRIOR', startLevel: 10, startLocation: at(0, 0), ...options.character },
  });
  const prefix = options.prefix ?? [];
  const project: ProjectV1 = { ...base, assumptions: { runSpeedYps: 10, travelDetourFactor: 1 }, route: { ...base.route, steps: [...prefix, ...options.steps, ...suffix] } };
  return { project, data: staticDatasetSource(stubDataset({ quests: options.quests })), section: { first: prefix.length, last: prefix.length + options.steps.length - 1 } };
}

/** Quests accepted and turned in at one point each, then the exit note. */
export function questScenario(quests: readonly (readonly [id: number, xp: number, x: number, y: number])[], exit: readonly [number, number]): AppScenario {
  const s = appSteps();
  return appScenario({ quests: quests.map(([q, xp]) => appQuest(q, xp)), steps: quests.flatMap(([q, , x, y]) => s.pair(q, x, y)), exit });
}

export const describeStep = (step: RouteStep): string => (step.kind === 'accept' || step.kind === 'turnin' ? `${step.kind} ${String(step.questId)}` : step.kind);

export function appRequest(made: AppScenario, revision: number, targetXp: 'keep-original' | number = 'keep-original', scope: Partial<OptimizationRequest['scope']> = {}): OptimizationRequest {
  const steps = made.project.route.steps;
  const first = steps[made.section.first];
  const last = steps[made.section.last];
  if (first === undefined || last === undefined) throw new Error('no section');
  return {
    project: made.project,
    baseRevision: revision,
    section: { firstStepId: first.id, lastStepId: last.id },
    scope: { allowNewQuests: false, zones: null, levelWindow: null, ...scope },
    goal: { kind: 'min-time', targetXp },
  };
}

export function appHost(made: AppScenario, navigation: NavigationState = { kind: 'unavailable', reason: 'test' }, revision = 1): OptimizationHost {
  return createOptimizationHost({ project: made.project, revision, data: made.data, geometry: fixtureGeometry(), navigation });
}

/** A run's walker and baseline (the analysis and baseline walks on the straight-line model), as `startOptimization` makes them. */
export function appBaseline(made: AppScenario, targetXp: 'keep-original' | number = 'keep-original'): { readonly run: RunWalker; readonly baseline: BaselineWalk; readonly analysis: SectionAnalysis } {
  const host = appHost(made);
  const run = createRunWalker(host);
  const { project, section } = made;
  const analysisWalk = walkSection(run, project, section, { probe: false });
  const analysis = analyseSection({ project, section, goal: { targetXp, grindFill: 'shortfall' }, context: run.engine, walk: analysisWalk.walk, availability: run.availability });
  if (!analysis.ok) throw new Error(`analysis failed: ${analysis.reason}`);
  const walked = walkSection(run, project, section, { probe: true, from: analysis.castWindowStart });
  return {
    run,
    analysis,
    baseline: { project, section, walk: walked.walk, issues: walked.issues, summary: analysis.summary, anchors: sectionAnchors(analysis, project.route.steps) },
  };
}
