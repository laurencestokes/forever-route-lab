import { describe, expect, it, vi } from 'vitest';
import { CHECKING_TRAVEL, createDerivedStore, type DerivedResults, IDLE_PATHS, INITIAL_DERIVED_STATE, isCurrent, pendingTravelReason, pendingTravelText, provisionalNote } from './derived';

/** The derived-results store (ARCHITECTURE §12.1) and the "pending" wording for final metrics. */

const results = (fields: Partial<DerivedResults>): DerivedResults => ({ revision: 3, final: true, pendingLegs: 0, pendingSteps: 0, ...fields }) as DerivedResults;
const NAVIGATION = { ...CHECKING_TRAVEL, model: 'navigation' as const };

describe('createDerivedStore', () => {
  it('starts loading, publishes merged patches, and notifies only on a change', () => {
    const handle = createDerivedStore();
    expect(handle.store.getState()).toBe(INITIAL_DERIVED_STATE);
    const listener = vi.fn();
    handle.store.subscribe(listener);
    handle.publish({ status: 'loading', paths: IDLE_PATHS });
    expect(listener).not.toHaveBeenCalled();
    handle.publish({ status: 'ready' });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(handle.store.getState()).toMatchObject({ status: 'ready', results: null, paths: IDLE_PATHS });
  });

  it('routes actions to the pipeline once attached; computing paths before then is refused', async () => {
    const handle = createDerivedStore();
    handle.store.cancelPaths();
    await expect(handle.store.computePaths()).rejects.toThrow('The route simulation is still loading');
    expect(handle.store.stateBefore(0)).toBeNull();
    const actions = {
      cancelPaths: vi.fn(),
      resumePaths: vi.fn(),
      computePaths: vi.fn(() => Promise.resolve({ revision: 1, requested: 2, complete: true })),
      stateBefore: vi.fn(() => null),
    };
    handle.attach(actions);
    handle.store.cancelPaths();
    handle.store.resumePaths();
    await expect(handle.store.computePaths()).resolves.toEqual({ revision: 1, requested: 2, complete: true });
    expect(actions.cancelPaths).toHaveBeenCalledTimes(1);
    expect(actions.resumePaths).toHaveBeenCalledTimes(1);
  });
});

describe('provisionalNote', () => {
  it('is null for final results', () => {
    expect(provisionalNote({ results: results({}), travel: NAVIGATION, paths: IDLE_PATHS })).toBeNull();
  });

  it('says how many legs are pending, and whether computing is paused', () => {
    expect(provisionalNote({ results: results({ final: false, pendingLegs: 1, pendingSteps: 1 }), travel: NAVIGATION, paths: IDLE_PATHS })).toBe(
      'Pending: 1 walking leg is still being computed; its time uses the straight-line estimate.',
    );
    expect(provisionalNote({ results: results({ final: false, pendingLegs: 1200, pendingSteps: 40 }), travel: NAVIGATION, paths: { ...IDLE_PATHS, state: 'paused' } })).toBe(
      'Pending: 1,200 walking legs are not being computed (paused); their times use the straight-line estimate.',
    );
    expect(provisionalNote({ results: results({ final: false, pendingSteps: 1 }), travel: NAVIGATION, paths: IDLE_PATHS })).toBe(
      'Pending: some walking legs are still being computed; their times use the straight-line estimate.',
    );
  });

  it('says when computing waits to retry after a failure, or stopped on one, not "still being computed" (UI-04)', () => {
    const pending = results({ final: false, pendingLegs: 30, pendingSteps: 15 });
    expect(provisionalNote({ results: pending, travel: NAVIGATION, paths: { ...IDLE_PATHS, state: 'running', failure: '1/map.bin could not be fetched (Failed to fetch)' } })).toBe(
      'Pending: 30 walking legs are waiting to be computed again after a failure that may pass (1/map.bin could not be fetched (Failed to fetch)); their times use the straight-line estimate.',
    );
    expect(provisionalNote({ results: pending, travel: NAVIGATION, paths: { ...IDLE_PATHS, state: 'failed', failure: 'the model broke' } })).toBe(
      'Pending: 30 walking legs are not computed: computing them failed (the model broke); their times use the straight-line estimate.',
    );
  });

  it('says when navigation is still being checked, and when nothing is simulated yet', () => {
    expect(provisionalNote({ results: results({ final: false }), travel: CHECKING_TRAVEL, paths: IDLE_PATHS })).toBe(
      'Pending: checking for navigation data; times use the straight-line estimate.',
    );
    expect(provisionalNote({ results: null, travel: CHECKING_TRAVEL, paths: IDLE_PATHS })).toBe('Not simulated yet.');
  });
});

describe('pendingTravelText (UI-04)', () => {
  it('gives one reason for a pending travel time from the derived state: checking, computing, retrying, paused or failed', () => {
    const cases: [Parameters<typeof pendingTravelText>[0], string, string][] = [
      [{ travel: CHECKING_TRAVEL, paths: IDLE_PATHS }, 'checking', 'Pending: the navigation data is still being checked, so the travel time is a straight-line estimate for now'],
      [{ travel: NAVIGATION, paths: { ...IDLE_PATHS, state: 'running' } }, 'computing', 'Pending: the walking path is still being computed, so the travel time is a straight-line estimate for now'],
      [{ travel: NAVIGATION, paths: IDLE_PATHS }, 'computing', 'Pending: the walking path is still being computed, so the travel time is a straight-line estimate for now'],
      [
        { travel: NAVIGATION, paths: { ...IDLE_PATHS, state: 'running', failure: 'offline' } },
        'retrying',
        'Pending: computing the walking path failed (offline) and will be tried again shortly, so the travel time is a straight-line estimate for now',
      ],
      [{ travel: NAVIGATION, paths: { ...IDLE_PATHS, state: 'paused' } }, 'paused', 'Pending: computing walking paths is paused, so the travel time is a straight-line estimate until you resume'],
      [{ travel: NAVIGATION, paths: { ...IDLE_PATHS, state: 'failed', failure: 'boom' } }, 'failed', 'Pending: the walking path could not be computed (boom), so the travel time is a straight-line estimate'],
    ];
    for (const [state, reason, text] of cases) {
      expect(pendingTravelReason(state)).toBe(reason);
      expect(pendingTravelText(state)).toBe(text);
    }
  });
});

describe('isCurrent', () => {
  it('compares the results revision with the editor revision', () => {
    const state = { ...INITIAL_DERIVED_STATE, results: results({}) };
    expect(isCurrent(state, 3)).toBe(true);
    expect(isCurrent(state, 4)).toBe(false);
    expect(isCurrent(INITIAL_DERIVED_STATE, 0)).toBe(false);
  });
});
