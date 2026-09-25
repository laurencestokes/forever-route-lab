import { describe, expect, it } from 'vitest';
import * as domain from '../domain';
import * as rules from '../rules';
import { DIFFICULTIES, DIFFICULTY_COLORS, DIFFICULTY_LABELS, questOverride, routeGroup } from './rules-exports';

describe('rules-exports', () => {
  it('re-exports the pure values themselves, not copies', () => {
    expect(DIFFICULTIES).toBe(rules.DIFFICULTIES);
    expect(DIFFICULTY_COLORS).toBe(rules.DIFFICULTY_COLORS);
    expect(DIFFICULTY_LABELS).toBe(rules.DIFFICULTY_LABELS);
    expect(routeGroup).toBe(domain.routeGroup);
    expect(questOverride).toBe(domain.questOverride);
  });
});
