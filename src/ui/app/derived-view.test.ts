import { describe, expect, it } from 'vitest';
import { createEditorStore, fixedClock, insertNote } from '../../app';
import { type DerivedState, INITIAL_DERIVED_STATE, IDLE_PATHS } from '../../app/derived';
import { mapTestWorkspace } from '../../app/map-test-helpers';
import { questDifficultyAt, sequentialIdSource } from '../../app/shell-support';
import { buildRouteView, NOT_SIMULATED } from '../app-model';
import type { StepRowModel } from '../route/rows';
import { derivedResults, issue, known, readyState, unknownValue } from './derived-test-helpers';
import { sameResultsView } from './selectors';
import {
  COUNTING_LEGS_DETAIL,
  createRowDeriver,
  fractionalLevel,
  mapWords,
  noResultsReason,
  routeMetricsView,
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
  it('keep their own "not simulated" values without a derived store', () => {
    expect(createRowDeriver(view, ws.dataset, null)).toBeUndefined();
    expect(rowOf(1).row.projectedLevel.unknownReason).toBe(NOT_SIMULATED);
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

  it('say that a hearth wait after unknown time is unknown, and keep the generic words for nothing recorded', () => {
    expect(unknownTimeReason([{ kind: 'hearth-cooldown', waitSeconds: 3600, upperBound: true }])).toContain('may still be on cooldown');
    expect(unknownTimeReason([{ kind: 'hearth-cooldown', waitSeconds: 3600, upperBound: false }])).toBe('Part of this step’s time cannot be estimated');
    expect(unknownTimeReason([])).toBe('Part of this step’s time cannot be estimated');
  });
});
