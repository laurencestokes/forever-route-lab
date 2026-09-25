import { describe, expect, it } from 'vitest';
import { DUNGEON_KEYS, dungeonClassificationProblems, dungeonQuestAreas, NON_DUNGEON_KEYS } from './dungeon-areas';

/** Every classified key once, as dungeons.lua has them at the pin (alternatives only where the test needs them). */
const ALL_KEYS = [...DUNGEON_KEYS.keys(), ...NON_DUNGEON_KEYS.keys()];
const entries = (extra: readonly number[] = [], without: readonly number[] = []) =>
  [...ALL_KEYS, ...extra]
    .filter((key) => !without.includes(key))
    .map((areaId) => ({ areaId, alternativeAreaIds: areaId === 209 ? [10014] : areaId === 2257 ? [99999] : [] }));

describe('dungeonQuest classification (data-F12)', () => {
  it('classifies each dungeons.lua key exactly once', () => {
    for (const key of DUNGEON_KEYS.keys()) expect(NON_DUNGEON_KEYS.has(key), String(key)).toBe(false);
    // The four later-expansion non-dungeons of the review, plus the original six.
    expect([...NON_DUNGEON_KEYS.keys()].sort((a, b) => a - b)).toEqual([2257, 2597, 2917, 2918, 3277, 3358, 5733, 5861, 6298, 6618]);
    expect(dungeonClassificationProblems(new Set(ALL_KEYS))).toEqual([]);
  });

  it('counts dungeon keys and their alternative ids, never a non-dungeon or its alternatives', () => {
    const areas = dungeonQuestAreas(entries());
    expect(areas.has(209)).toBe(true);
    expect(areas.has(10014)).toBe(true);
    for (const key of [2257, 5733, 5861, 6298, 6618, 99999]) expect(areas.has(key), String(key)).toBe(false);
  });

  it('fails closed on a new dungeons.lua key until someone classifies it', () => {
    expect(() => dungeonQuestAreas(entries([4242]))).toThrow(/key 4242 is in neither DUNGEON_KEYS nor NON_DUNGEON_KEYS/);
  });

  it('fails closed when a listed key leaves dungeons.lua', () => {
    expect(() => dungeonQuestAreas(entries([], [6618]))).toThrow(/NON_DUNGEON_KEYS lists 6618, which is not a dungeons.lua key any more/);
    expect(() => dungeonQuestAreas(entries([], [209]))).toThrow(/DUNGEON_KEYS lists 209/);
  });
});
