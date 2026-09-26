import { describe, expect, it } from 'vitest';
import { fixtureView, placeholderGeometry } from '../../tests/support/fixture-dataset';
import { questId, uiMapId } from '../domain';
import { createRxpContext, questFactsOf } from './rxp-context';

describe('createRxpContext', () => {
  it('builds the zone keys from the view’s validated zone names, shared by import and export', () => {
    const view = fixtureView();
    const geometry = placeholderGeometry();
    const ctx = createRxpContext(view, geometry);
    expect(ctx.zoneKey('Durotar')).toBe(uiMapId(1411));
    expect(ctx.zoneKey('durotar')).toBeNull();
    expect(ctx.zoneKey('Nowhere')).toBeNull();
    expect(ctx.lower.zoneKey).toBe(ctx.zoneKey);
    expect(ctx.export.zoneKey).toBe(ctx.zoneKey);
    expect(ctx.lower.geometry).toBe(geometry);
    expect(ctx.export.geometry).toBe(geometry);
  });

  it('resolves a name two UiMaps share to nothing rather than to a guess', () => {
    const ctx = createRxpContext(
      {
        quest: () => undefined,
        zones: () => [
          { uiMapId: uiMapId(1), name: 'Twin', worldMapId: null },
          { uiMapId: uiMapId(2), name: 'Twin', worldMapId: null },
          { uiMapId: uiMapId(3), name: null, worldMapId: null },
        ],
      },
      null,
    );
    expect(ctx.zoneKey('Twin')).toBeNull();
    expect(ctx.export.geometry).toBeNull();
  });
});

describe('questFactsOf', () => {
  it('gives the objective count and whether the quest is custom; null for a quest the view lacks', () => {
    const view = fixtureView();
    const facts = questFactsOf(view);
    const quest = view.quest(questId(788));
    expect(facts(questId(788))).toEqual({ objectiveCount: quest?.objectives.length, custom: false });
    expect(facts(questId(900001))).toBeNull();
  });
});
