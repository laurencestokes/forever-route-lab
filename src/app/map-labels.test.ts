import { describe, expect, it } from 'vitest';
import { questId, uiMapId, worldMapId } from '../domain/ids';
import type { QuestRecord } from '../domain/dataset';
import { fixtureGeometry } from '../geo/test-fixtures';
import type { LabelDescriptor, MarkerDescriptor, PlaceLayerInput } from '../map/adapter';
import { LAYER_BAND_EDGES } from '../map/layers';
import { effectiveRules, FOREVER_BETA } from '../rules';
import { buildMapLabels, CITY_UIMAPS, PLACE_LABEL_MIN_PX, UNDERGROUND_CITIES, undergroundName, ZONE_LABEL_MAX_PX, zoneShapesOf } from './map-labels';
import { stubDataset, stubQuest } from './map-test-helpers';
import { zoneSpans } from './zone-levels';

/**
 * The labels canvas's names (docs/research/map-presentation.md §13; map-atlas.md §22; D-049 O19;
 * step MP.7): zones and cities with their cards, anchored at their terrain poles; the underground
 * cities in the minimap style; continents at the world band; dungeon and flight point names from
 * 0.05 px per yard; and the static priority that no selection or edit changes.
 */

const ORC = { race: 'Orc', class: 'WARRIOR' } as const;
const DUROTAR = uiMapId(1411);
const KALIMDOR_MAP = worldMapId(1);

function quests(levels: readonly number[], zoneOrSort: number, from: number): QuestRecord[] {
  return levels.map((level, i) => stubQuest({ id: questId(from + i), name: `Q${String(from + i)}`, level, zoneOrSort }));
}

const geometry = fixtureGeometry();
const dataset = stubDataset({ quests: [...quests([5, 6, 7, 8, 9, 10, 11, 12, 13, 14], 14, 1), ...quests([10, 12, 14, 16, 18, 20], 17, 100)] });
const spans = zoneSpans(dataset, geometry, ORC);
const rules = effectiveRules(FOREVER_BETA);

function place(id: string, name: string, category: MarkerDescriptor['category'], x: number): PlaceLayerInput['items'][number] {
  const descriptor: MarkerDescriptor = {
    type: 'marker',
    id,
    point: { mapId: KALIMDOR_MAP, x, y: -4000 },
    kind: 'transition',
    style: 'neutral',
    emphasis: 'normal',
    label: name,
    badges: [],
    ref: { kind: 'taxi-node', node: 1 },
    count: 1,
    refs: [{ kind: 'taxi-node', node: 1 }],
    labels: [name],
    ...(category === undefined ? {} : { category }),
  };
  return { descriptor, name };
}

const byId = (labels: readonly LabelDescriptor[], id: string): LabelDescriptor | undefined => labels.find((label) => label.id === id);

describe('buildMapLabels', () => {
  const base = { geometry, spans, level: { level: 9, lowerBound: false }, rules, anchors: new Map(), dungeons: null, flightPoints: null };

  it('names every zone and city with a span, with its card rated at the step, drawn to about zoom −1.75', () => {
    const { painted } = buildMapLabels(base);
    const durotar = byId(painted, 'zone:1411');
    expect(durotar).toMatchObject({ kind: 'zone', text: 'Durotar', minPxPerYard: 0, maxPxPerYard: ZONE_LABEL_MAX_PX, ref: { kind: 'zone', uiMapId: DUROTAR } });
    expect(ZONE_LABEL_MAX_PX).toBeCloseTo(0.297, 3);
    expect(durotar?.card).toMatchObject({ name: 'Durotar', span: 'quests 6–13 (10)', compact: '6–13', basis: 'derived', difficulty: { key: 'difficult', levelText: '10', lowerBound: false } });
    // Every UiMap with a span is named (the fixture's zones and cities, not the continents).
    expect(painted.filter((label) => label.kind === 'zone').map((label) => label.id).sort()).toEqual([...spans.keys()].map((id) => `zone:${String(id)}`).sort());
    // Without route state the cards carry no twin.
    expect(byId(buildMapLabels({ ...base, level: null }).painted, 'zone:1411')?.card?.difficulty).toBeNull();
  });

  it('anchors a zone at its terrain pole when the arcs are in, else at its frame centre', () => {
    const frame = geometry.maps.get(DUROTAR)?.assignments[0];
    if (frame === undefined) throw new Error('no Durotar frame');
    const centre = byId(buildMapLabels(base).painted, 'zone:1411')?.point;
    expect(centre).toEqual({ mapId: KALIMDOR_MAP, x: (frame.xMin + frame.xMax) / 2, y: (frame.yMin + frame.yMax) / 2 });
    // A square of area 14 (Durotar) off the frame's centre: the label follows the land.
    const square = [
      { mapId: KALIMDOR_MAP, x: 0, y: -6000 },
      { mapId: KALIMDOR_MAP, x: 1000, y: -6000 },
      { mapId: KALIMDOR_MAP, x: 1000, y: -5000 },
      { mapId: KALIMDOR_MAP, x: 0, y: -5000 },
      { mapId: KALIMDOR_MAP, x: 0, y: -6000 },
    ];
    const shapes = zoneShapesOf(KALIMDOR_MAP, [square], [[14, 0]]);
    const anchored = byId(buildMapLabels({ ...base, anchors: new Map([[KALIMDOR_MAP, shapes.anchors]]) }).painted, 'zone:1411')?.point;
    expect(anchored).toEqual({ mapId: KALIMDOR_MAP, x: 500, y: -5500 });
  });

  it('ranks by a static priority: continents, levelling zones by frame area, cities, dungeons, flight points', () => {
    const labels = buildMapLabels({
      ...base,
      dungeons: { items: [place('dungeon:1', 'Ragefire Chasm', 'dungeons', 1500)], unplaced: 0 },
      flightPoints: { items: [place('flight:1', 'Orgrimmar', 'flight-points', 1700), place('flight:2', 'Theramore', 'other-faction-flights', -3700)], unplaced: 0 },
    }).painted;
    const priority = (id: string): number => byId(labels, id)?.priority ?? -1;
    expect(priority('continent:1')).toBeGreaterThan(priority('zone:1413'));
    // The Barrens' frame is larger than Durotar's.
    expect(priority('zone:1413')).toBeGreaterThan(priority('zone:1411'));
    expect(priority('zone:1411')).toBeGreaterThan(priority('zone:1454'));
    expect(CITY_UIMAPS).toContain(1454);
    expect(priority('zone:1454')).toBeGreaterThan(priority('place:dungeon:1'));
    expect(priority('place:dungeon:1')).toBeGreaterThan(priority('place:flight:1'));
    // The other faction's flight points are not named.
    expect(byId(labels, 'place:flight:2')).toBeUndefined();
    expect(byId(labels, 'place:dungeon:1')).toMatchObject({ kind: 'place', text: 'Ragefire Chasm', minPxPerYard: PLACE_LABEL_MIN_PX, maxPxPerYard: null });
    // The priority depends on nothing that changes with the step.
    const later = buildMapLabels({ ...base, level: { level: 30, lowerBound: true } }).painted;
    expect(later.map((label) => [label.id, label.priority])).toEqual(buildMapLabels(base).painted.map((label) => [label.id, label.priority]));
  });

  it('names the continents at the world band only, at their frames’ centres', () => {
    const continent = byId(buildMapLabels(base).painted, 'continent:1');
    expect(continent).toMatchObject({ kind: 'continent', text: 'Kalimdor', minPxPerYard: 0, maxPxPerYard: LAYER_BAND_EDGES.continent, card: null });
  });

  it('names Ironforge and the Undercity as underground cities in the minimap style only (D-049 O19)', () => {
    expect(UNDERGROUND_CITIES).toEqual([1455, 1458]);
    expect(undergroundName('Ironforge')).toBe('Ironforge (underground city)');
    // The fixture has no underground city: every minimap label is the painted one.
    const { painted, minimap } = buildMapLabels(base);
    expect(minimap).toEqual(painted);
  });
});
