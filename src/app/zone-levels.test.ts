import { describe, expect, it } from 'vitest';
import { questId, uiMapId } from '../domain/ids';
import type { QuestRecord } from '../domain/dataset';
import { fixtureGeometry } from '../geo/test-fixtures';
import { effectiveRules, FOREVER_BETA } from '../rules';
import { publicSite } from '../../tests/support/fake-fetch';
import { HORDE_WARRIOR, placeholderGeometry, siteFiles, siteManifest } from '../../tests/support/fixture-dataset';
import { prepareDataset } from '../infra/data/dataset-view';
import { identityOf } from '../infra/data/manifest';
import { preparedDatasetSource } from './dataset-source';
import { stubDataset, stubQuest } from './map-test-helpers';
import { CARD_CHIP_PX, levelRange, RATING_MAX_SPREAD, RATING_MIN_QUESTS, SPAN_MIN_QUESTS, ZONE_LEVEL_TEXTS, zoneCardOf, zoneRating, zoneSpans } from './zone-levels';

/** Zone level spans for the character (map-presentation.md §12.5; step MP.3's span text). */

const DUROTAR = uiMapId(1411);
const DUROTAR_AREA = 14;
const ORC = { race: 'Orc', class: 'WARRIOR' } as const;
/** Race mask 1: Humans only (Human is bit 0). */
const HUMANS_ONLY = 1;

function quests(levels: readonly number[], fields: Partial<QuestRecord> = {}, from = 1): QuestRecord[] {
  return levels.map((level, i) => stubQuest({ id: questId(from + i), name: `Q${String(from + i)}`, level, zoneOrSort: DUROTAR_AREA, ...fields }));
}

const spanOf = (list: readonly QuestRecord[]) => zoneSpans(stubDataset({ quests: list }), fixtureGeometry(), ORC).get(DUROTAR);

describe('zoneSpans', () => {
  it('takes the p10 to p90 of the zone’s non-dungeon quests open to the character, with the counts', () => {
    const list = [...quests([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]), ...quests([30], { dungeonQuest: true }, 50), ...quests([40, 41], { races: HUMANS_ONLY }, 60)];
    const span = spanOf(list);
    expect(span).toMatchObject({ uiMapId: DUROTAR, name: 'Durotar', open: 11, all: 13, low: 2, median: 6, high: 10, text: 'quests 2–10 (11)', basis: 'derived' });
    expect(span?.detail).toBe('Durotar: quests 2–10 (11 open to an Orc Warrior; 13 in the dataset)');
  });

  it('gives no span below 5 quests, and says so; none open to the character says whose', () => {
    expect(SPAN_MIN_QUESTS).toBe(5);
    expect(spanOf(quests([3, 4, 5, 6]))).toMatchObject({ low: null, high: null, median: null, text: '4 quests: too few for a span' });
    expect(spanOf(quests([3, 4], { races: HUMANS_ONLY }))).toMatchObject({ open: 0, all: 2, text: 'no quests for an Orc Warrior' });
    expect(spanOf([])).toMatchObject({ open: 0, all: 0, text: 'no quests for an Orc Warrior', detail: 'Durotar: no quests for an Orc Warrior (0 quests in the dataset)' });
  });

  it('ignores scaling quests and quests with no zone', () => {
    expect(spanOf([...quests([-1, -1, -1, -1, -1]), ...quests([5, 5, 5, 5, 5], { zoneOrSort: null }, 20)])?.open).toBe(0);
  });

  it('writes a one-level span without a range', () => {
    expect(levelRange(7, 7)).toBe('7');
    expect(spanOf(quests([7, 7, 7, 7, 7]))?.text).toBe('quests 7 (5)');
  });

  it('counts a subzone’s quests for the zone its area is routed to (the Valley of Trials, 363, in Durotar; QA-02)', () => {
    const VALLEY_OF_TRIALS = 363;
    const list = [...quests([7, 8, 9, 10, 11, 12]), ...quests([1, 1, 2, 2, 3], { zoneOrSort: VALLEY_OF_TRIALS }, 20)];
    const dataset = stubDataset({ quests: list });
    // Without the area links only the zone's own AreaTable id counts, as before.
    expect(zoneSpans(dataset, fixtureGeometry(), ORC).get(DUROTAR)).toMatchObject({ open: 6, low: 8 });
    const routed = zoneSpans(dataset, fixtureGeometry(), ORC, new Map([[VALLEY_OF_TRIALS, DUROTAR]]));
    expect(routed.get(DUROTAR)).toMatchObject({ open: 11, all: 11, low: 1, high: 11, text: 'quests 1–11 (11)', basis: 'derived' });
  });
});

describe('zoneSpans over the committed dataset (QA-02)', () => {
  const site = publicSite();
  const prepared = prepareDataset(siteFiles(site), identityOf(siteManifest(site)), placeholderGeometry(site));
  const source = preparedDatasetSource(prepared);

  it('starts Durotar’s span at level 1 to 2 with the Valley of Trials quests, and counts the other starting subzones for their zones', () => {
    const view = source.view(HORDE_WARRIOR);
    const areaZones = source.areaZones?.();
    expect(areaZones?.get(363)).toBe(DUROTAR);
    const spans = zoneSpans(view, prepared.geometry, ORC, areaZones);
    const durotar = spans.get(DUROTAR);
    // 788 Cutting Teeth is a Valley of Trials quest (zoneOrSort 363), not an area-14 one
    expect(view.quest(questId(788))?.zoneOrSort).toBe(363);
    expect(durotar?.low).toBeLessThanOrEqual(2);
    expect(durotar?.low).toBeGreaterThanOrEqual(1);
    expect(durotar?.open).toBeGreaterThan(31);
    // without the area links the span is the reported "quests 7–12 (31)"
    expect(zoneSpans(view, prepared.geometry, ORC).get(DUROTAR)?.text).toBe('quests 7–12 (31)');
    // Camp Narache (220) in Mulgore, Deathknell (154) in Tirisfal Glades: counted there now
    const unrouted = zoneSpans(view, prepared.geometry, ORC);
    for (const id of [1412, 1420]) expect(spans.get(uiMapId(id))?.all ?? 0, `UiMap ${String(id)}`).toBeGreaterThan(unrouted.get(uiMapId(id))?.all ?? 0);
  });

  it('gives Ironforge and the Undercity their minimap name, and no other zone one (D-049 O19; review PR-17)', () => {
    const spans = zoneSpans(source.view(HORDE_WARRIOR), prepared.geometry, ORC);
    expect(spans.get(uiMapId(1455))?.undergroundName).toBe('Ironforge (underground city)');
    expect(spans.get(uiMapId(1458))?.undergroundName).toBe('Undercity (underground city)');
    expect([...spans.values()].filter((span) => span.undergroundName !== null).map((span) => span.uiMapId)).toEqual([1455, 1458]);
  });
});

describe('zoneRating', () => {
  const rules = effectiveRules(FOREVER_BETA);

  it('rates the median quest level at the character’s level, from 10 quests and a spread of at most 15', () => {
    expect([RATING_MIN_QUESTS, RATING_MAX_SPREAD]).toEqual([10, 15]);
    const span = spanOf(quests([5, 6, 7, 8, 9, 10, 11, 12, 13, 14]));
    if (span === undefined) throw new Error('no span');
    expect(zoneRating(span, 9, false, rules)).toEqual({ difficulty: 'difficult', level: 10, lowerBound: false });
    expect(zoneRating(span, 30, true, rules)).toEqual({ difficulty: 'trivial', level: 10, lowerBound: true });
  });

  it('does not rate a span of fewer than 10 quests or one wider than 15 levels', () => {
    const few = spanOf(quests([5, 6, 7, 8, 9]));
    const wide = spanOf(quests([1, 2, 3, 4, 5, 30, 31, 32, 33, 40]));
    if (few === undefined || wide === undefined) throw new Error('no span');
    expect(zoneRating(few, 9, false, rules)).toBeNull();
    expect(zoneRating(wide, 9, false, rules)).toBeNull();
  });
});

describe('zone cards and the cited level text (MP.7)', () => {
  const rules = effectiveRules(FOREVER_BETA);

  it('words the card from the span with its basis, rated at the step, with a width that keeps room for the twin', () => {
    const span = spanOf(quests([5, 6, 7, 8, 9, 10, 11, 12, 13, 14]));
    if (span === undefined) throw new Error('no span');
    const rated = zoneCardOf('Durotar', 1411, span, zoneRating(span, 9, true, rules));
    expect(rated).toMatchObject({ name: 'Durotar', span: 'quests 6–13 (10)', compact: '6–13', basis: 'derived', difficulty: { key: 'difficult', levelText: '10', lowerBound: true } });
    const unrated = zoneCardOf('Durotar', 1411, span, null);
    expect(unrated.difficulty).toBeNull();
    // A step change never widens the card: the twin's room is kept either way.
    expect(unrated.widthPx).toBe(rated.widthPx);
    expect(unrated.widthPx).toBeGreaterThanOrEqual(CARD_CHIP_PX + 'quests 6–13 (10)'.length * 5);
    // The "Viewing" chip's words say whose quests they are.
    expect(span.viewing).toBe('quests 6–13 (10 open to an Orc Warrior)');
  });

  it('shows the cited text of the new zones instead of a span, with its basis, never rated, and names them alone on the compact label', () => {
    expect([...ZONE_LEVEL_TEXTS.keys()].sort()).toEqual([2482, 2524, 2548, 2652]);
    const span = spanOf(quests([5, 6, 7, 8, 9, 10, 11, 12, 13, 14]));
    if (span === undefined) throw new Error('no span');
    expect(zoneCardOf('Riverglades', 2548, span, zoneRating(span, 9, false, rules))).toMatchObject({ span: 'mid-30s to mid-40s (official)', compact: null, basis: 'official', difficulty: null });
    expect(zoneCardOf('Mount Hyjal', 2482, null, null)).toMatchObject({ span: 'endgame (reported)', basis: 'reported' });
    expect(zoneCardOf("Shen'dralas", 2652, null, null)).toMatchObject({ span: 'level range unknown ?', basis: 'unknown' });
    expect(zoneCardOf('Darkspear Islands', 2524, null, null)).toMatchObject({ span: 'Battleground (client: Map 2997 InstanceType 3)', basis: 'client' });
    // No span and no cited text: no second line, no basis.
    expect(zoneCardOf('Nowhere', 9999, null, null)).toMatchObject({ span: null, compact: null, basis: null, difficulty: null });
  });

  it('never gives a compact span without a span (too few quests, or none open)', () => {
    const few = spanOf(quests([3, 4, 5, 6]));
    if (few === undefined) throw new Error('no span');
    expect(zoneCardOf('Durotar', 1411, few, null)).toMatchObject({ span: '4 quests: too few for a span', compact: null, basis: 'derived' });
    expect(few.viewing).toBe('4 quests: too few for a span');
  });
});
