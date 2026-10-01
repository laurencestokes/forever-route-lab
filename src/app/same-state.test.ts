import { describe, expect, it } from 'vitest';
import type { ReadonlyCharacterState } from '../engine/types';
import { sameCharacterState, sameCharacterStateExcept } from './same-state';

/** A state with every kind of field the comparison meets: numbers, nested records, maps, sets and arrays. */
function state(patch: Partial<Record<keyof ReadonlyCharacterState, unknown>> = {}): ReadonlyCharacterState {
  const base = {
    timeSec: 120,
    location: { mapId: 1, x: 10, y: -20 },
    locationHint: 0,
    locationCause: null,
    level: 7,
    xp: 300,
    unknownXpEvents: 0,
    xpBasis: 'estimated',
    xpEraFallback: false,
    questLog: new Map([
      [2, { objectives: [{ index: 0, done: false }], failed: false, routeAccepted: true }],
      [5, { objectives: [], failed: false, routeAccepted: true }],
    ]),
    completed: new Set([1, 3]),
    abandoned: new Set<number>(),
    acceptedInRoute: new Set([1, 2, 3, 5]),
    itemsBeforeAccept: new Map([[9, [0, 1]]]),
    knownFlightPaths: new Set(['1:23']),
    hearth: null,
    hearthHint: 0,
    hearthReadyAt: 0,
    sinceCastBasis: 'estimated',
    sinceCastEraFallback: false,
    riding: { skill: 0, speed: 1 },
    skills: new Map([[164, 1]]),
    trainedSkills: new Set<number>(),
    reputationDelta: new Map<number, number>(),
    knownSpells: new Set<number>(),
  };
  return { ...base, ...patch } as unknown as ReadonlyCharacterState;
}

describe('sameCharacterState (review F-01)', () => {
  it('is true for two copies of the same value', () => {
    expect(sameCharacterState(state(), state())).toBe(true);
    const one = state();
    expect(sameCharacterState(one, one)).toBe(true);
  });

  it('is false when a number, a nested record, a log entry or a set member differs', () => {
    expect(sameCharacterState(state(), state({ timeSec: 121 }))).toBe(false);
    expect(sameCharacterState(state(), state({ location: { mapId: 1, x: 10, y: -21 } }))).toBe(false);
    expect(sameCharacterState(state(), state({ location: null }))).toBe(false);
    expect(
      sameCharacterState(
        state(),
        state({
          questLog: new Map([
            [2, { objectives: [{ index: 0, done: true }], failed: false, routeAccepted: true }],
            [5, { objectives: [], failed: false, routeAccepted: true }],
          ]),
        }),
      ),
    ).toBe(false);
    expect(sameCharacterState(state(), state({ completed: new Set([1, 4]) }))).toBe(false);
    expect(sameCharacterState(state(), state({ itemsBeforeAccept: new Map([[9, [0]]]) }))).toBe(false);
    expect(sameCharacterState(state(), state({ riding: { skill: 75, speed: 1.6 } }))).toBe(false);
  });

  it('counts order: the same quests in another order are another state (the panels list the log in order)', () => {
    const reordered = state({
      questLog: new Map([
        [5, { objectives: [], failed: false, routeAccepted: true }],
        [2, { objectives: [{ index: 0, done: false }], failed: false, routeAccepted: true }],
      ]),
    });
    expect(sameCharacterState(state(), reordered)).toBe(false);
    expect(sameCharacterState(state(), state({ completed: new Set([3, 1]) }))).toBe(false);
  });

  it('counts what it cannot compare as a value as different (a doubt costs a rebuild, never a stale state)', () => {
    const fn = (): number => 1;
    expect(sameCharacterState(state({ riding: fn }), state({ riding: fn }))).toBe(true);
    expect(sameCharacterState(state({ riding: () => 1 }), state({ riding: () => 1 }))).toBe(false);
    class Box {
      constructor(readonly v: number) {}
    }
    expect(sameCharacterState(state({ riding: new Box(1) }), state({ riding: new Box(1) }))).toBe(false);
    expect(sameCharacterState(state(), state({ riding: { skill: 0, speed: 1, extra: 1 } }))).toBe(false);
  });
});

describe('sameCharacterStateExcept (follow-up F-03)', () => {
  const ignored = new Set(['timeSec', 'location', 'hearthReadyAt']);

  it('leaves out only the fields named', () => {
    expect(sameCharacterStateExcept(state(), state({ timeSec: 999, location: null, hearthReadyAt: 60 }), ignored)).toBe(true);
    expect(sameCharacterStateExcept(state(), state({ timeSec: 999, level: 8 }), ignored)).toBe(false);
    expect(sameCharacterStateExcept(state(), state({ hearthHint: 3 }), ignored)).toBe(false);
    expect(sameCharacterStateExcept(state(), state({ completed: new Set([1, 3, 4]) }), ignored)).toBe(false);
    expect(sameCharacterStateExcept(state(), state(), new Set())).toBe(true);
  });

  it('differs when one state has a field the other has not', () => {
    const extra = { ...state(), fresh: 1 } as unknown as ReadonlyCharacterState;
    expect(sameCharacterStateExcept(state(), extra, ignored)).toBe(false);
    expect(sameCharacterStateExcept(extra, state(), ignored)).toBe(false);
  });
});
