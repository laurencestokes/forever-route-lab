import { describe, expect, it } from 'vitest';
import { createEditorStore, fixedClock, insertNote } from '../../app';
import { type DerivedState, INITIAL_DERIVED_STATE, IDLE_PATHS } from '../../app/derived';
import { mapTestWorkspace } from '../../app/map-test-helpers';
import { questDifficultyAt, sequentialIdSource } from '../../app/shell-support';
import type { QuestId } from '../../domain/ids';
import type { SimFact } from '../../sim/facts';
import { createIssueShortener, shortIssueText } from '../../app/issue-short';
import { buildRouteView, NOT_SIMULATED } from '../app-model';
import type { StepRowModel } from '../route/rows';
import { derivedResults, issue, known, readyState, unknownValue } from './derived-test-helpers';
import { sameResultsView } from './selectors';
import {
  carriedWorkSentence,
  COUNTING_LEGS_DETAIL,
  createGroupDeriver,
  createRowDeriver,
  fractionalLevel,
  isDoubtCode,
  lineTwoOf,
  questLogCountOf,
  questLogWords,
  rowMarkOf,
  worstIssue,
  mapWords,
  noResultsReason,
  objectiveWorkSentence,
  routeMetricsView,
  transportSentence,
  sameRowSource,
  sameSimulationStatus,
  SIMULATION_LOADING,
  simulationStatusOf,
  STEP_NOT_WALKED,
  stepNumbersOf,
  travelSentence,
  unknownTimeReason,
  validationCounts,
  xpBarAt,
} from './derived-view';

/**
 * The derived results as the shell shows them (src/ui/app/derived-view.ts): rows filled in from
 * the walk with their bases, reasons for unknown numbers, pending travel, issue counts, the route
 * metrics, the XP bar and the simulation's state.
 */

const ws = mapTestWorkspace();
const project = ws.project;
const view = buildRouteView(project.route, ws.dataset, project.character.startLevel);
const steps = project.route.steps;

/** The row of step `index` (the map test route has no groups: rows are steps). */
function rowOf(index: number): { readonly row: StepRowModel; readonly rowIndex: number } {
  const id = steps[index]?.id;
  const rowIndex = id === undefined ? undefined : view.rowOfStep.get(id);
  const row = rowIndex === undefined ? undefined : view.rows[rowIndex];
  if (rowIndex === undefined || row?.type !== 'step') throw new Error(`no row for step ${String(index)}`);
  return { row, rowIndex };
}

function derive(state: Parameters<typeof createRowDeriver>[2], index: number, rowView = view): StepRowModel {
  const deriver = createRowDeriver(rowView, ws.dataset, state);
  const { row, rowIndex } = rowOf(index);
  return deriver === undefined ? row : deriver(row, rowIndex);
}

describe('rows without results', () => {
  it('keep their own "not simulated" values without a derived store, and get line 2 only', () => {
    const row = derive(null, 1);
    expect(row.projectedLevel.unknownReason).toBe(NOT_SIMULATED);
    expect(row.detail).not.toBeNull();
    // Before the walk nothing is known at the step: an accept is "not sure", a turn-in's readiness unknown.
    expect(row.mark).toBe('uncertain');
    expect(derive(null, 4).mark).toBe('record-unknown');
    expect(derive(null, 0).mark).toBeNull();
  });

  it('say the simulation is loading, or why it failed, never 0', () => {
    const loading = derive(INITIAL_DERIVED_STATE, 1);
    expect(loading.projectedLevel).toMatchObject({ value: null, unknownReason: SIMULATION_LOADING });
    expect(loading.xpGained.unknownReason).toBe(SIMULATION_LOADING);
    expect(loading.duration.unknownReason).toBe(SIMULATION_LOADING);
    const failed = derive({ ...INITIAL_DERIVED_STATE, status: 'failed', failure: 'The route simulation could not be loaded: offline' }, 1);
    expect(failed.duration.unknownReason).toBe('The route simulation could not be loaded: offline');
    expect(noResultsReason(null)).toBe(NOT_SIMULATED);
  });
});

describe('rows with results', () => {
  const cull = steps[2];
  if (cull?.kind !== 'accept') throw new Error('the map test route changed');
  const cullId = cull.questId;
  const results = derivedResults(project, {
    steps: [
      {},
      { duration: known(125, 'derived'), xpGained: known(0, 'source'), level: 2, xpAfter: 100 },
      { duration: known(40, 'assumption', true), xpGained: known(450, 'assumption', true), level: 5, levelBasis: 'assumption', eraFallback: true, lowerBound: true, assumptionsUsed: ['killSeconds', 'runSpeed'] },
      { duration: unknownValue, xpGained: unknownValue, level: 5, lowerBound: true, facts: [{ kind: 'unknown-xp', questId: cullId, reason: 'no-record' }, { kind: 'time-unknown', part: 'objective', reason: 'item-without-source', questId: null, objective: null }] },
      { duration: known(300, 'assumption'), level: 5, facts: [{ kind: 'pending-leg' }] },
    ],
    issues: [
      issue('VAL004-min-level', 'error', steps[2]?.id ?? null, 'Cull needs level 3.'),
      issue('LINT003-low-value', 'warning', steps[2]?.id ?? null, 'Cull is grey.'),
      issue('SIM022-legs-pending', 'info', null, 'Travel legs still being computed.'),
    ],
  });
  const state = readyState(results);

  it('carry each estimate with its basis: assumed, Era values, lower bound', () => {
    const plain = derive(state, 1);
    expect(plain.duration).toEqual({ value: 125, unknownReason: null, lowerBound: false, upperBound: false, assumed: false, eraFallback: false });
    expect(plain.xpGained.value).toBe(0);
    // Level 2 and 100 XP of the 900 to level 3 (the XP-1 table): 2.11, shown as 2.1.
    const need = results.rules.values.xpToNextLevel.value[1] ?? 0;
    expect(plain.projectedLevel.value).toBeCloseTo(2 + 100 / need, 6);
    expect(plain.assumptions).toBeNull();
    const assumed = derive(state, 2);
    expect(assumed.xpGained).toMatchObject({ value: 450, assumed: true, eraFallback: true });
    expect(assumed.duration).toMatchObject({ value: 40, assumed: true, eraFallback: true });
    expect(assumed.projectedLevel).toMatchObject({ lowerBound: true, assumed: true, eraFallback: true });
    expect(assumed.assumptions).toContain('seconds per kill (');
    expect(assumed.assumptions).toContain('run speed (Era value)');
  });

  it('keep unknown numbers unknown with the reason the walk recorded', () => {
    const row = derive(state, 3);
    expect(row.xpGained).toMatchObject({ value: null, unknownReason: 'The quest’s XP is not in the data' });
    expect(row.duration).toMatchObject({ value: null, unknownReason: 'An item objective has no drop source in the data' });
  });

  it('mark a step whose walking leg is pending', () => {
    expect(derive(state, 4).pending).toBe('path');
    expect(derive(state, 3).pending).toBeNull();
  });

  it('say why a pending leg waits: computing, retrying, paused or failed, in rows and Details alike (UI-04)', () => {
    const paths = (patch: Partial<DerivedState['paths']>): DerivedState => readyState(results, { paths: { ...IDLE_PATHS, ...patch } });
    const cases = [
      [paths({ state: 'running', revision: 1, total: 1 }), 'path'],
      [paths({ state: 'running', revision: 1, total: 1, failure: 'offline' }), 'retrying'],
      [paths({ state: 'paused' }), 'paused'],
      [paths({ state: 'failed', failure: 'a bug' }), 'failed'],
    ] as const;
    for (const [pathsState, expected] of cases) {
      expect(derive(pathsState, 4).pending).toBe(expected);
      const numbers = stepNumbersOf(pathsState, view, steps[4]?.id ?? null);
      expect(numbers.kind === 'known' ? numbers.value.pending : 'none').toBe(expected);
      // A step without a pending leg stays final whatever the paths do.
      expect(derive(pathsState, 3).pending).toBeNull();
    }
    // The rows' selector sees a pause (their words change) but not a progress tick.
    const running = paths({ state: 'running', revision: 1, done: 0, total: 1 });
    const tick: DerivedState = { ...running, paths: { ...running.paths, done: 1 } };
    expect(sameRowSource(running, tick)).toBe(true);
    expect(sameRowSource(running, { ...running, paths: { ...running.paths, state: 'paused' } })).toBe(false);
  });

  it('hand back the same model for a row whose numbers a new walk left as they were (PERF-11)', () => {
    const first = derive(state, 2);
    // A new walk: new results and estimate objects, the same numbers.
    const again = derive(readyState({ ...results, estimates: results.estimates.map((e) => ({ ...e })) }), 2);
    expect(again).toBe(first);
    const changed = derivedResults(project, { steps: [{}, {}, { duration: known(41, 'assumption', true) }] });
    expect(derive(readyState(changed), 2)).not.toBe(first);
  });

  it('mark every step that travels as pending while the navigation data is checked (UI-05)', () => {
    const travelling = derivedResults(project, { steps: [{}, { duration: known(30, 'assumption'), travel: 20 }, { duration: known(5, 'assumption') }] });
    const checking = readyState(travelling, { travel: { model: 'checking', reason: null, revision: 'straight-line', unavailableMaps: [], unavailableAll: false } });
    expect(derive(checking, 1).pending).toBe('checking');
    // A step that does not move has no travel time to wait for.
    expect(derive(checking, 2).pending).toBeNull();
    expect(derive(readyState(travelling), 1).pending).toBeNull();
    // Details reads the same.
    const numbers = stepNumbersOf(checking, view, steps[1]?.id ?? null);
    expect(numbers.kind === 'known' ? numbers.value.pending : 'none').toBe('checking');
  });

  it('name the rule behind a note’s assumed 0 s, which reads no parameter (UI-20)', () => {
    const noted = derivedResults(project, { steps: [{ duration: known(0, 'assumption') }] });
    expect(steps[0]?.kind).toBe('note');
    expect(derive(readyState(noted), 0).assumptions).toBe('the rule that a note takes no time (SIMULATION TIME-8)');
    expect(derive(readyState(derivedResults(project)), 0).assumptions).toBeNull();
  });

  it('count the issues at each step by severity', () => {
    expect(derive(state, 2).issues).toEqual({ error: 1, warning: 1, info: 0 });
    expect(derive(state, 1).issues).toEqual({ error: 0, warning: 0, info: 0 });
    expect(validationCounts(state)).toEqual({ error: 1, warning: 1, info: 1 });
    // Cached per issue list: the side panel's tab keeps the same counts object.
    expect(validationCounts(state)).toBe(validationCounts(readyState(results)));
  });

  it('take quest difficulty at the level the step starts at, uncertain while it is a lower bound', () => {
    // Step 3 (complete Cull) starts at level 5, a lower bound after step 2.
    const row = derive(state, 3);
    expect(row.quest?.difficulty).toBe(questDifficultyAt(5, 1, 1));
    expect(row.quest?.uncertain).toBe(true);
    // Step 2 starts at level 2, known.
    expect(derive(state, 2).quest).toMatchObject({ difficulty: questDifficultyAt(2, 1, 1), uncertain: false });
  });

  it('draw the quest mark from the step’s issues, name the worst one, and mark a level-up', () => {
    // Step 2 (accept Cull) has an error: locked, and line 2 names it; step 1 is available.
    const locked = derive(state, 2);
    expect(locked.mark).toBe('locked');
    expect(locked.issue).toEqual({ severity: 'error', message: 'Cull needs level 3.' });
    // With the pipeline's shortener (UI-01), line 2's form drops the step's own quest.
    expect(derive(readyState({ ...results, shortIssue: createIssueShortener(ws.dataset) }), 2).issue).toEqual({ severity: 'error', message: 'Cull needs level 3.', short: 'Needs level 3' });
    expect(derive(state, 1).mark).toBe('available');
    expect(derive(state, 1).issue).toBeNull();
    // Level 1 → 2 after step 1, 2 → 5 after step 2: both cross whole levels; step 3 stays at 5.
    expect(derive(state, 1).levelUp).toBe(2);
    expect(locked.levelUp).toBe(5);
    expect(derive(state, 3).levelUp).toBeNull();
  });

  it('keep line 2 per dataset view and step, so a route edit formats nothing and a new view starts afresh (review UR-10)', () => {
    const step = steps[1];
    if (step === undefined) throw new Error('no step');
    const words = lineTwoOf(ws.dataset, step);
    // The place's label and point ("Kaltunk · Durotar 43.3, 68.5"); the test route's points have no label.
    expect(words).toBe('World map 1: X 0, Y -4000 yd');
    expect(lineTwoOf(ws.dataset, { ...step, location: step.location === null ? null : { ...step.location, label: 'Kaltunk' } })).toBe('Kaltunk · World map 1: X 0, Y -4000 yd');
    expect(lineTwoOf(ws.dataset, step)).toBe(words);
    const other = ws.data.view({ faction: 'Horde', class: 'WARRIOR', customQuests: [], questOverrides: {} });
    expect(lineTwoOf(other, step)).toBe(words);
    expect(derive(state, 1).detail).toBe(words);
    // A travel step's title names the destination: its line 2 is its time.
    expect(derive(state, 5).detail).toBeNull();
  });

  it('look steps up by id while the walk lags an edit, and say a new step is not walked yet', () => {
    const store = createEditorStore({ project, ids: sequentialIdSource(500), clock: fixedClock('2026-09-25T12:00:00.000Z') });
    store.dispatch(insertNote({ text: 'New' }, 0));
    const edited = buildRouteView(store.getState().project.route, ws.dataset, 1);
    const deriver = createRowDeriver(edited, ws.dataset, state);
    if (deriver === undefined) throw new Error('no deriver');
    const at = (index: number) => {
      const row = edited.rows[index];
      if (row?.type !== 'step') throw new Error('not a step row');
      return deriver(row, index);
    };
    expect(at(0).projectedLevel.unknownReason).toBe(STEP_NOT_WALKED);
    // Step 3 of the walk is row 4 now, found by its id.
    expect(at(3).xpGained.value).toBe(450);
  });
});

describe('route metrics', () => {
  it('are unknown with the reason before a walk', () => {
    const view0 = routeMetricsView(INITIAL_DERIVED_STATE, 0);
    expect(view0.duration).toMatchObject({ value: null, unknownReason: SIMULATION_LOADING });
    expect(view0.provisional).toBeNull();
    expect(routeMetricsView(null, null).notes).toEqual([NOT_SIMULATED]);
  });

  it('carry their bases, what is not counted, the travel model, and the pending note', () => {
    const results = derivedResults(project, {
      steps: [{ duration: known(600, 'assumption'), xpGained: unknownValue, facts: [{ kind: 'pending-leg' }] }, { duration: unknownValue }],
      revision: 3,
    });
    const metrics = routeMetricsView(readyState(results), 4);
    expect(metrics.duration).toMatchObject({ value: 600, lowerBound: true, assumed: true });
    expect(metrics.xpGained).toMatchObject({ lowerBound: true, assumed: true, eraFallback: true });
    expect(metrics.basis.xpGained).toBe('depends on assumptions; uses Era values');
    expect(metrics.travelShare.value).toBe(0.5);
    expect(metrics.provisional).toBe('Pending: 1 walking leg is still being computed; its time uses the straight-line estimate.');
    expect(metrics.notes).toContain('Updating: these numbers are for the route as it was a moment ago.');
    expect(metrics.notes).toContain('1 step with unknown time is not counted: the route takes at least this long.');
    expect(metrics.notes).toContain('Navigation data is unavailable (this deploy has no navigation data): every travel time is a straight-line estimate.');
    expect(routeMetricsView(readyState(results), 3).notes).not.toContain('Updating: these numbers are for the route as it was a moment ago.');
  });

  it('mark XP per hour as an upper bound when time is missing, a lower bound when XP is, and unknown with both (UI-10)', () => {
    const timeMissing = routeMetricsView(readyState(derivedResults(project, { steps: [{ duration: known(3600), xpGained: known(1000) }, { duration: unknownValue }] })), null);
    expect(timeMissing.xpPerHour).toMatchObject({ value: 1000, upperBound: true, lowerBound: false });
    expect(timeMissing.basis.xpPerHour).toMatch(/^at most this: steps with unknown time are not counted; /);
    // The shares are of the known time only: bounded in no direction, and their basis says so.
    expect(timeMissing.travelShare).toMatchObject({ lowerBound: false, upperBound: false });
    expect(timeMissing.basis.shares).toMatch(/^of the known time only \(1 step with unknown time not counted\); /);
    const xpMissing = routeMetricsView(readyState(derivedResults(project, { steps: [{ duration: known(3600), xpGained: known(1000) }, { xpGained: unknownValue }] })), null);
    expect(xpMissing.xpPerHour).toMatchObject({ value: 1000, lowerBound: true, upperBound: false });
    expect(xpMissing.basis.shares).not.toContain('known time only');
    const both = routeMetricsView(readyState(derivedResults(project, { steps: [{ duration: known(3600), xpGained: known(1000) }, { duration: unknownValue, xpGained: unknownValue }] })), null);
    expect(both.xpPerHour.value).toBeNull();
    expect(both.xpPerHour.unknownReason).toBe(
      '1 step with unknown time and 1 step with unknown XP are not counted, so the true rate could be higher or lower than the 1,000 XP per hour of the known steps',
    );
    const exact = routeMetricsView(readyState(derivedResults(project, { steps: [{ duration: known(3600), xpGained: known(1000) }] })), null);
    expect(exact.xpPerHour).toMatchObject({ value: 1000, lowerBound: false, upperBound: false });
  });

  it('list every parameter the route reads, with its origin, not the first four (UI-13)', () => {
    const keys = ['killSeconds', 'runSpeed', 'swimSpeed', 'questXpRounding', 'questXpMultiplier', 'lootSeconds'] as const;
    const metrics = routeMetricsView(readyState(derivedResults(project, { metrics: { assumptionsUsed: keys } })), null);
    expect(metrics.parameters.map((p) => p.key)).toEqual(keys);
    expect(metrics.parameters.find((p) => p.key === 'runSpeed')).toMatchObject({ label: 'run speed', origin: 'Era value' });
    expect(metrics.notes.some((note) => note.includes('more'))).toBe(false);
  });

  it('name world maps whose navigation failed, keeping the id (UI-14)', () => {
    const name = (id: number) => (id === 1 ? 'Kalimdor' : id === 36 ? 'World map 36' : null);
    expect(mapWords([1], name)).toBe('Kalimdor (world map 1)');
    expect(mapWords([0, 1, 36], name)).toBe('world map 0, Kalimdor (world map 1) and world map 36');
    const state = readyState(derivedResults(project), { travel: { model: 'navigation', reason: null, revision: 'nav-1', unavailableMaps: [1], unavailableAll: false } });
    expect(travelSentence(state, name)).toBe(
      'Walking legs follow the navigation data, except on Kalimdor (world map 1), whose navigation files could not be used: straight-line estimates there.',
    );
    expect(simulationStatusOf(state, name)).toMatchObject({ state: 'straight-line', detail: travelSentence(state, name) });
    expect(routeMetricsView(state, null, name).notes).toContain(travelSentence(state, name));
  });
});

describe('the XP bar', () => {
  const results = derivedResults(project, { steps: [{ level: 1, xpAfter: 50 }, { level: 2, xpAfter: 100, levelBasis: 'assumption', lowerBound: true }] });

  it('shows the level after the active step, with its basis', () => {
    const id = steps[1]?.id;
    if (id === undefined) throw new Error('no step');
    const bar = xpBarAt(readyState(results), view, { stepId: id, number: 2 }, { level: 1, xp: 0 });
    expect(bar).toMatchObject({ level: 2, xp: 100, lowerBound: true, assumed: true, label: 'Level after step 2' });
    expect(bar.xpToNext).toBe(results.rules.values.xpToNextLevel.value[1]);
  });

  it('shows the end of the route without an active step, and the start level as a lower bound before a walk', () => {
    expect(xpBarAt(readyState(results), view, null, { level: 1, xp: 0 }).label).toBe('Level at the end of the route');
    const before = xpBarAt(INITIAL_DERIVED_STATE, view, null, { level: 1, xp: 0 });
    expect(before).toMatchObject({ level: 1, lowerBound: true, unknownReason: SIMULATION_LOADING, label: 'Projected level' });
  });

  it('is fractional below the cap and whole at it', () => {
    const rules = results.rules;
    expect(fractionalLevel(rules, 60, 5000)).toBe(60);
    expect(fractionalLevel(rules, 1, 399)).toBeLessThan(2);
  });
});

describe('the simulation status', () => {
  const results = derivedResults(project, { steps: [{ facts: [{ kind: 'pending-leg' }, { kind: 'pending-leg' }] }] });
  const navigation = { model: 'navigation', reason: null, revision: 'nav-1', unavailableMaps: [], unavailableAll: false } as const;

  it('says what is loading, failed or being checked', () => {
    expect(simulationStatusOf(null)).toEqual({ state: 'ready' });
    expect(simulationStatusOf(INITIAL_DERIVED_STATE).state).toBe('loading');
    expect(simulationStatusOf({ ...INITIAL_DERIVED_STATE, status: 'failed', failure: 'offline' })).toEqual({ state: 'failed', detail: 'offline' });
    expect(simulationStatusOf(readyState(results, { travel: { ...navigation, model: 'checking' } })).state).toBe('checking');
  });

  it('never says "0 of 0": a run that has not counted its legs is counting (UI-08)', () => {
    const starting = simulationStatusOf(readyState(results, { travel: navigation, paths: { state: 'running', revision: 1, done: 0, total: 0, failure: null } }));
    expect(starting).toEqual({ state: 'computing', done: null, total: null, detail: COUNTING_LEGS_DETAIL });
  });

  it('keeps saying legs are computed while they are pending between two runs, never vanishing in between (UI-03)', () => {
    // Resume publishes idle until the walk that asks for the legs again: the legs are still pending.
    const resumed = simulationStatusOf(readyState(results, { travel: navigation, paths: { state: 'idle', revision: 1, done: 3, total: 8, failure: null } }));
    expect(resumed).toMatchObject({ state: 'computing', done: null, total: null });
    // A run that answered every leg, before the walk that folds them in.
    const answered = simulationStatusOf(readyState(results, { travel: navigation, paths: { state: 'idle', revision: 1, done: 8, total: 8, failure: null } }));
    expect(answered).toMatchObject({ state: 'computing', done: 8, total: 8 });
    expect(simulationStatusOf(readyState(derivedResults(project), { travel: navigation, paths: { ...IDLE_PATHS, done: 8, total: 8 } }))).toEqual({ state: 'ready' });
  });

  it('compares states by what they show, so a tick re-renders only what changed (PERF-11)', () => {
    const running = (done: number) => readyState(results, { travel: navigation, paths: { state: 'running', revision: 1, done, total: 8, failure: null } });
    expect(sameSimulationStatus(simulationStatusOf(running(3)), simulationStatusOf(running(3)))).toBe(true);
    expect(sameSimulationStatus(simulationStatusOf(running(3)), simulationStatusOf(running(4)))).toBe(false);
    const base = running(3);
    const tick = { ...base, paths: { ...base.paths, done: 4 }, selected: null };
    expect(sameResultsView(base, tick)).toBe(true);
    expect(sameRowSource(base, tick)).toBe(true);
    expect(sameResultsView(base, { ...base, paths: { ...base.paths, state: 'paused' } })).toBe(false);
    expect(sameResultsView(base, { ...base, results: derivedResults(project) })).toBe(false);
    expect(sameRowSource(base, { ...base, travel: { ...navigation, model: 'checking' } })).toBe(false);
  });

  it('reports computing paths with progress, and a pause with the legs still pending', () => {
    const running = simulationStatusOf(readyState(results, { travel: navigation, paths: { state: 'running', revision: 1, done: 3, total: 8, failure: null } }));
    expect(running).toMatchObject({ state: 'computing', done: 3, total: 8 });
    // A run waiting to retry says so first (UI-04).
    const retrying = simulationStatusOf(readyState(results, { travel: navigation, paths: { state: 'running', revision: 1, done: 3, total: 8, failure: 'offline' } }));
    expect(retrying).toMatchObject({ state: 'computing', done: 3, total: 8 });
    expect(retrying.state === 'computing' ? retrying.detail : '').toMatch(/^Waiting to ask again after a failure that may pass \(offline\)\. 3 of 8 walking legs computed/);
    const paused = simulationStatusOf(readyState(results, { travel: navigation, paths: { ...IDLE_PATHS, state: 'paused' } }));
    expect(paused).toMatchObject({ state: 'paused', pending: 2 });
  });

  it('states plainly when travel uses straight lines, and says nothing when paths are known', () => {
    const straight = simulationStatusOf(readyState(results));
    expect(straight).toMatchObject({ state: 'straight-line', text: 'Straight-line estimates' });
    const final = derivedResults(project);
    expect(simulationStatusOf(readyState(final, { travel: { ...navigation, unavailableMaps: [1] } }))).toMatchObject({
      state: 'straight-line',
      text: 'Some straight-line estimates',
    });
    expect(simulationStatusOf(readyState(final, { travel: navigation }))).toEqual({ state: 'ready' });
  });
});

describe('unknown step times say what the walk recorded (UI-16)', () => {
  it('name the cause of an unknown position the step moved from', () => {
    expect(unknownTimeReason([{ kind: 'position-unknown', cause: 'start-unset' }])).toBe('The route has no start location, so the travel from it cannot be estimated');
    expect(unknownTimeReason([{ kind: 'position-unknown', cause: 'several-spawns' }])).toContain('several spawns');
    expect(unknownTimeReason([{ kind: 'position-unknown', cause: 'transport-arrival' }])).toContain('transport arrives somewhere unknown');
  });

  it('prefer the step’s own cause to the position it moved from', () => {
    const facts = [{ kind: 'position-unknown', cause: 'zone-travel' }, { kind: 'grind-zero-rate' }] as const;
    expect(unknownTimeReason(facts)).toBe('The grind is set to 0 XP per hour, so it never reaches its level');
    expect(unknownTimeReason([{ kind: 'position-unknown', cause: 'unresolved' }, { kind: 'unresolved-location' }])).toBe('A place of this step cannot be located');
  });

  it('say when the objective without a time estimate is one a turn-in carries (D-040)', () => {
    const carried: SimFact = {
      kind: 'objectives-carried',
      questId: 104 as QuestId,
      objectives: [0, 1],
      time: 'unknown',
      killXp: known(760, 'assumption', true),
      level: 10,
      levelBasis: 'assumption',
      levelEraFallback: true,
    };
    const reputation: SimFact = { kind: 'time-unknown', part: 'objective', reason: 'reputation-objective', questId: 104 as QuestId, objective: 1 };
    expect(unknownTimeReason([reputation, carried])).toBe(
      'A reputation objective has no time estimate: this turn-in carries its work, because no Complete step finishes objective 2',
    );
    expect(unknownTimeReason([reputation])).toBe('A reputation objective has no time estimate');
    expect(unknownTimeReason([{ ...reputation, questId: 105 as QuestId }, carried])).toBe('A reputation objective has no time estimate');
  });

  it('say that a hearth wait after unknown time is unknown, and keep the generic words for nothing recorded', () => {
    expect(unknownTimeReason([{ kind: 'hearth-cooldown', waitSeconds: 3600, upperBound: true }])).toContain('may still be on cooldown');
    expect(unknownTimeReason([{ kind: 'hearth-cooldown', waitSeconds: 3600, upperBound: false }])).toBe('Part of this step’s time cannot be estimated');
    expect(unknownTimeReason([])).toBe('Part of this step’s time cannot be estimated');
  });
});

describe('carried objective work (D-040)', () => {
  const carried = (objectives: readonly number[], time: 'counted' | 'overridden' | 'unknown' = 'counted'): SimFact => ({
    kind: 'objectives-carried',
    questId: 790 as QuestId,
    objectives,
    time,
    killXp: known(0, 'assumption', true),
    level: 5,
    levelBasis: 'assumption',
    levelEraFallback: true,
  });

  it('says in a sentence what a turn-in’s numbers include, and nothing for other steps', () => {
    expect(carriedWorkSentence([carried([0])])).toBe(
      'This turn-in includes the time and kill XP of objective 1, which no Complete step finishes; the travel to that work is not included',
    );
    expect(carriedWorkSentence([{ kind: 'pending-leg' }, carried([0, 2])])).toBe(
      'This turn-in includes the time and kill XP of objectives 1 and 3, which no Complete step finishes; the travel to that work is not included',
    );
    expect(carriedWorkSentence([{ kind: 'objectives-incidental', questId: 790 as QuestId, objectives: [0] }])).toBeNull();
  });

  it('does not claim the time when a duration override stands in for it or it cannot be estimated (review D40-03)', () => {
    expect(carriedWorkSentence([carried([0], 'overridden')])).toBe(
      'This turn-in includes the kill XP of objective 1, which no Complete step finishes; the step’s duration override stands in for the time of that work',
    );
    expect(carriedWorkSentence([carried([0, 1], 'unknown')])).toBe(
      'This turn-in includes the kill XP of objectives 1 and 2, which no Complete step finishes; the time of that work cannot be estimated',
    );
    // The summary counts only the turn-ins whose time includes the carried work.
    const results = derivedResults(project, { steps: [{ facts: [carried([0])] }, { facts: [carried([0], 'overridden')] }, { facts: [carried([1], 'unknown')] }] });
    expect(routeMetricsView(readyState(results), null).notes).toContain(
      '1 turn-in includes the time and kill XP of objectives no Complete step finishes, but not the travel to them, so the route may take longer.',
    );
    const none = derivedResults(project, { steps: [{ facts: [carried([0], 'overridden')] }, { facts: [carried([1], 'unknown')] }] });
    expect(routeMetricsView(readyState(none), null).notes.some((line) => line.includes('turn-in'))).toBe(false);
  });

  it('says in Details when an accept counts items collected before it (review D40-01)', () => {
    expect(objectiveWorkSentence([{ kind: 'objectives-before-accept', questId: 790 as QuestId, objectives: [0] }])).toBe(
      'Objective 1 counts as soon as the quest is accepted: a Complete step collected its items before this accept',
    );
    expect(objectiveWorkSentence([{ kind: 'objectives-before-accept', questId: 790 as QuestId, objectives: [0, 2] }])).toBe(
      'Objectives 1 and 3 count as soon as the quest is accepted: a Complete step collected their items before this accept',
    );
    expect(objectiveWorkSentence([carried([0])])).toBe(carriedWorkSentence([carried([0])]));
    expect(objectiveWorkSentence([{ kind: 'pending-leg' }])).toBeNull();
  });

  it('says in Details which transport a step rode and where its docks come from, with the client record (TIME-7, MP-R32; TR-02)', () => {
    // TIME-7 (D-052 item 1; TR-03): a client berth's walks end at its boarding point, the step between them timed at run speed.
    const ride = (pointFrom: 'inferred' | 'user', arrivalBoardingYd: number | null): SimFact => ({
      kind: 'transport-ride',
      transportId: 'stormwind-auberdine',
      edgeId: 'stormwind-auberdine:0>1',
      name: 'Stormwind Harbor – Auberdine ship',
      docks: [
        { end: 'departure', name: 'Auberdine', pointFrom, record: pointFrom === 'inferred' ? 'client transport path 11616, stop 1 of 2' : null, boardingYd: pointFrom === 'inferred' ? 36.8 : null },
        { end: 'arrival', name: 'Stormwind Harbor', pointFrom: 'inferred', record: 'client transport path 11616, stop 2 of 2', boardingYd: arrivalBoardingYd },
      ],
    });
    expect(transportSentence([ride('inferred', 12.5)])).toBe(
      'Stormwind Harbor – Auberdine ship: from Auberdine, dock position inferred from client transport path 11616, stop 1 of 2, boarding on walkable ground 37 yd from the berth; to Stormwind Harbor, dock position inferred from client transport path 11616, stop 2 of 2, boarding on walkable ground 13 yd from the berth; wait and ride times assumed, and the step between berth and boarding point timed at run speed (assumed)',
    );
    expect(transportSentence([ride('user', null)])).toBe(
      'Stormwind Harbor – Auberdine ship: from Auberdine, at the dock you entered; to Stormwind Harbor, dock position inferred from client transport path 11616, stop 2 of 2; wait and ride times assumed',
    );
    expect(transportSentence([{ kind: 'pending-leg' }])).toBeNull();
    const results = derivedResults(project, { steps: [{ facts: [ride('inferred', 12.5)] }, {}] });
    const numbers = stepNumbersOf(readyState(results), view, steps[0]?.id ?? null);
    expect(numbers.kind === 'known' ? numbers.value.transport : null).toBe(transportSentence([ride('inferred', 12.5)]));
  });

  it('gives Details the sentence, and the summary a note counting the turn-ins that carry work', () => {
    const results = derivedResults(project, { steps: [{}, { facts: [carried([0])] }, { facts: [carried([1, 2])] }] });
    const numbers = stepNumbersOf(readyState(results), view, steps[1]?.id ?? null);
    expect(numbers.kind === 'known' ? numbers.value.objectiveWork : null).toBe(carriedWorkSentence([carried([0])]));
    const plain = stepNumbersOf(readyState(results), view, steps[0]?.id ?? null);
    expect(plain.kind === 'known' ? plain.value.objectiveWork : 'missing').toBeNull();
    const note = '2 turn-ins include the time and kill XP of objectives no Complete step finishes, but not the travel to them, so the route may take longer.';
    expect(routeMetricsView(readyState(results), null).notes).toContain(note);
    const one = derivedResults(project, { steps: [{ facts: [carried([0])] }] });
    expect(routeMetricsView(readyState(one), null).notes).toContain(
      '1 turn-in includes the time and kill XP of objectives no Complete step finishes, but not the travel to them, so the route may take longer.',
    );
    expect(routeMetricsView(readyState(derivedResults(project)), null).notes.some((line) => line.includes('turn-in'))).toBe(false);
  });
});

describe('quest marks at a step (ui-refresh.md §5.2)', () => {
  const at = (code: string, severity: 'error' | 'warning' | 'info') => issue(code, severity, null, code);

  it('lock on an error, doubt on an uncertain or unverifiable code, and keep a carried turn-in ready', () => {
    expect(rowMarkOf('accept', [])).toBe('available');
    expect(rowMarkOf('turnin', [])).toBe('ready');
    expect(rowMarkOf('accept', [at('VAL004-min-level', 'error')])).toBe('locked');
    expect(rowMarkOf('accept', [at('VAL004-min-level-uncertain', 'warning')])).toBe('uncertain');
    expect(rowMarkOf('accept', [at('VAL008-prequest-single-unverifiable', 'warning')])).toBe('uncertain');
    expect(rowMarkOf('turnin', [at('VAL030-carried-objectives', 'warning')])).toBe('ready');
    expect(rowMarkOf('complete', [at('VAL004-min-level', 'error')])).toBeNull();
    expect(isDoubtCode('VAL013-breadcrumb-target-unavailable')).toBe(true);
    expect(isDoubtCode('VAL021-previous-chain-active')).toBe(true);
    expect(isDoubtCode('LINT003-low-value')).toBe(false);
  });

  it('name the worst issue: an error before a warning before an info, the first of each', () => {
    expect(worstIssue([at('A', 'info'), at('B', 'warning'), at('C', 'warning')])).toEqual({ severity: 'warning', message: 'B' });
    expect(worstIssue([at('A', 'info'), at('B', 'error')])).toEqual({ severity: 'error', message: 'B' });
    // With the results' shortener, line 2's short form comes with it (UI-01).
    expect(worstIssue([at('B', 'error')], (issue) => `short ${issue.message}`)).toEqual({ severity: 'error', message: 'B', short: 'short B' });
    expect(worstIssue([])).toBeNull();
  });

  it('give line 2 a short form that drops the step’s own quest, which line 1 names (UI-01)', () => {
    const quests = { quest: (id: number) => (id === 2383 ? { name: 'Simple Parchment' } : id === 788 ? { name: 'Cutting Teeth' } : undefined) } as never;
    const short = (message: string, questId: number | null = 2383) => shortIssueText({ message, questId: questId as never }, quests);
    expect(short('Simple Parchment (2383) needs one of these quests turned in first: Cutting Teeth (788).')).toBe('Needs Cutting Teeth turned in first');
    expect(short('Simple Parchment (2383) is already in the quest log.')).toBe('Already in the quest log');
    expect(short('Simple Parchment (2383) needs level 3; the character is level 2.')).toBe('Needs level 3; the character is level 2');
    expect(short('Cutting Teeth (788) is turned in, but no step finishes objective 1: the time and kill XP of that work are added to the turn-in, without the travel to it. Add a Complete step where the work is done.', 788)).toBe(
      'No step finishes objective 1',
    );
    expect(short('Cutting Teeth (788) is turned in, but no step finishes objective 1; assumed completed along the way.', 788)).toBe('No step finishes objective 1; assumed done on the way');
    // A message about another quest, or with no quest, keeps its words (ids dropped).
    expect(short('The quest log is full (40 of 40), so Simple Parchment (2383) cannot be accepted.')).toBe('The quest log is full (40 of 40), so Simple Parchment cannot be accepted');
    expect(short('Route-level note.', null)).toBe('Route-level note');
    // The gate: the first 20 characters of line 2 are never the row's own title.
    for (const message of ['Simple Parchment (2383) needs one of these quests turned in first: Cutting Teeth (788).', 'Simple Parchment (2383) has failed, so it cannot be turned in.']) {
      expect(short(message).slice(0, 20).startsWith('Simple Parchment')).toBe(false);
    }
  });
});

describe('group headers', () => {
  it('get the level after their first and last steps from the walk, the same object while it reads the same', () => {
    const results = derivedResults(project, { steps: [{}, { level: 2 }, { level: 3 }, { level: 4 }] });
    const group = { type: 'group' as const, key: 'g', label: 'Guide, step 1', stepCount: 3, imported: true, levelSpan: null };
    const spanView = { ...view, rowSteps: [[steps[1]?.id, steps[2]?.id, steps[3]?.id].filter((id) => id !== undefined)] };
    const derive = createGroupDeriver(spanView, readyState(results));
    if (derive === undefined) throw new Error('no deriver');
    const first = derive(group, 0);
    expect(first.levelSpan?.from.value).toBeCloseTo(2, 0);
    expect(first.levelSpan?.to.value).toBeCloseTo(4, 0);
    expect(derive(group, 0)).toBe(first);
    expect(createGroupDeriver(spanView, null)).toBeUndefined();
  });
});

describe('the quest log after the active step (ui-refresh.md §5.5, §8)', () => {
  const count = { stepId: steps[1]?.id ?? ('s' as never), atEnd: false, size: 4, capacity: 40, capacityBasis: 'client-data' as const, capacityFrom: 'ruleset' as const };

  it('says the count against the capacity with its basis, a lower bound while the log before the route is unknown', () => {
    expect(questLogWords(count, 12, 'fresh', '')).toEqual({
      text: '4 / 40',
      detail: 'In the quest log after step 12: 4 of 40 quests (capacity 40: client data).',
      badge: '4',
      badgeLabel: '4 quests after step 12',
    });
    const unknown = questLogWords(count, 12, 'unknown', '');
    expect(unknown.text).toBe('≥4 / 40');
    expect(unknown.badgeLabel).toBe('at least 4 quests after step 12');
    expect(unknown.detail).toContain('there may be more');
    expect(questLogWords({ ...count, capacityFrom: 'project' }, 12, 'fresh', '').detail).toContain('capacity 40: your project’s value');
    // With no step selected, the last step's log is the end of the route's (D-050 item 2).
    expect(questLogWords({ ...count, atEnd: true }, 12, 'fresh', '')).toMatchObject({
      detail: 'In the quest log at the end of the route (after step 12): 4 of 40 quests (capacity 40: client data).',
      badgeLabel: '4 quests at the end of the route (after step 12)',
    });
  });

  it('never claims an empty log without a walked step', () => {
    expect(questLogWords(null, null, 'fresh', 'select a step to see the quest log after it')).toEqual({
      text: '?',
      detail: 'Quest log unknown: select a step to see the quest log after it.',
      badge: null,
      badgeLabel: null,
    });
    expect(questLogCountOf(null)).toBeNull();
    expect(questLogCountOf(INITIAL_DERIVED_STATE)).toBeNull();
  });
});
