import { describe, expect, it } from 'vitest';
import { questId } from './ids';
import { type QuestOverride, questOverride, questOverrideKey } from './project';

describe('questOverride', () => {
  const override: QuestOverride = { xp: null, objectiveCounts: [2], foreverStatus: null };

  it('returns the override stored under the quest id as a decimal key', () => {
    const project = { questOverrides: Object.freeze({ [questOverrideKey(questId(-5))]: override }) };
    expect(questOverride(project, questId(-5))).toBe(override);
    expect(questOverride(project, questId(5))).toBeNull();
  });

  it('looks at own keys only, never at inherited ones', () => {
    const inherited = Object.create({ '7': override }) as Readonly<Record<string, QuestOverride>>;
    expect(inherited['7']).toBe(override);
    expect(questOverride({ questOverrides: inherited }, questId(7))).toBeNull();
  });
});
