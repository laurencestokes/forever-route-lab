import { describe, expect, it } from 'vitest';
import { questId } from '../domain';
import type { LayerStats } from '../map/adapter';
import { EMPTY_LAYER_STATS } from '../map/adapter';
import { mapTestWorkspace } from './map-test-helpers';
import type { QuestStateModel } from './quest-state';
import { ATLAS_TILES_NOTE, categoryCountsOf, LAYER_STATS_UNITS, layerNotesOf, layerStatsNotes, MAP_ART_OWNER_NOTE, MINIMAP_TILES_NOTE, walkingPathNotesOf, type MapNotesSource } from './map-wording';

/*
 * The words of the Map layers drawer's notes (docs/research/map-presentation.md §25.3.3;
 * MAP-HONEST-5; step MP.4b): what a layer leaves out, always with the unit, and what each layer
 * draws from; a lazy part with the drawer, worded from the controller's facts.
 */

describe('layerStatsNotes', () => {
  const stats = {
    drawn: 10,
    notDrawn: 1234,
    aggregated: 1,
    unresolved: 12,
    unresolvedBy: { 'instance-without-entrance': 10, 'unmapped-area': 2 },
    otherSurfaces: 3,
  } as const;

  it('explains what a layer leaves out, always naming the unit (M3 review MAP-HONEST-5)', () => {
    expect(layerStatsNotes(stats, 'available-quests')).toEqual([
      '1,234 more markers not drawn: zoom in or pan to see them',
      '1 point shown as zone counts: zoom in to see them',
      '12 points not placed: 10 inside an instance with no known entrance, 2 in an area no map shows',
      '3 points on other world maps',
    ]);
    expect(layerStatsNotes({ drawn: 1, notDrawn: 0, aggregated: 0, unresolved: 0, unresolvedBy: {}, otherSurfaces: 0 }, 'route-steps')).toEqual([]);
  });

  it('uses each layer’s units, or one noun given for every count', () => {
    const one = { ...stats, notDrawn: 1, unresolved: 1, unresolvedBy: { 'destination-unknown': 1 }, otherSurfaces: 1 };
    expect(layerStatsNotes(one, 'route-steps')).toEqual([
      '1 more step marker not drawn: zoom in or pan to see them',
      '1 point shown as zone counts: zoom in to see them',
      '1 step not placed: 1 moving somewhere the route does not say',
      '1 step on other world maps',
    ]);
    expect(layerStatsNotes(stats, 'route-line').at(-1)).toBe('3 lines and glyphs on other world maps');
    expect(layerStatsNotes(stats, ['quest', 'quests']).at(-1)).toBe('3 quests on other world maps');
    for (const units of Object.values(LAYER_STATS_UNITS)) for (const [a, b] of Object.values(units)) expect(a !== '' && b !== '').toBe(true);
  });
});

describe('layerStatsNotes, the counts the builders keep', () => {
  it('says how many points are in clusters and how many labels were cut', () => {
    const clustered: LayerStats = { ...EMPTY_LAYER_STATS, drawn: 2, clustered: 3 };
    expect(layerStatsNotes(clustered, 'available-quests')).toEqual(['3 points in clusters: zoom in to separate them']);
    expect(layerStatsNotes({ ...EMPTY_LAYER_STATS, drawn: 60, notDrawn: 90 }, 'labels')).toEqual(['90 more labels not drawn: zoom in or pan to see them']);
    expect(layerStatsNotes({ ...EMPTY_LAYER_STATS, notDrawn: 7 }, 'available-quests')).toEqual(['7 more markers not drawn: zoom in or pan to see them']);
  });
});

/** Facts with no route state, no art and nothing loading; `overrides` changes some. */
function source(overrides: Partial<MapNotesSource> = {}): MapNotesSource {
  return {
    character: mapTestWorkspace().project.character,
    questState: null,
    afterStep: '',
    afterStepNumber: null,
    givers: () => ({ input: { groups: [] }, openQuests: 1204, itemStarted: 3, noStarter: 0, spawnlessGivers: 2, spawnlessQuests: 1 }),
    focusWork: () => ({ input: { groups: [] }, questIds: [questId(788)], missingQuests: 0, noPosition: 1, spawnless: 0 }),
    flightMasters: () => ({ input: { groups: [] }, otherFaction: 12, factionUnknown: 0, spawnless: 1 }),
    questName: (id) => (id === questId(788) ? 'Cutting Teeth' : null),
    art: { kind: 'none' },
    artUnder: false,
    terrainLoading: false,
    arcsLoading: () => false,
    ...overrides,
  };
}

describe('layerNotesOf (MAP-HONEST-5)', () => {
  it('words the givers without route state from the quests open by race and class, with what cannot be drawn', () => {
    const notes = layerNotesOf('available-quests', EMPTY_LAYER_STATS, source());
    expect(notes[0]).toMatch(/: the givers of all 1,204 quests open by race and class\.$/);
    expect(notes.slice(1)).toEqual(['3 start from an item: no map position.', '2 quest givers have no spawn in the dataset: 1 quest has no giver marker.']);
  });

  it('reads the first quest note after "After step N: " with route state', () => {
    const model = { map: { notes: { givers: ['Givers of 3 quests.', 'Second.'], turnIns: ['Turn-ins.'], objectives: ['Objectives.'] } } } as unknown as QuestStateModel;
    expect(layerNotesOf('available-quests', EMPTY_LAYER_STATS, source({ questState: model, afterStep: 'After step 14: ' }))).toEqual(['After step 14: Givers of 3 quests.', 'Second.']);
    expect(layerNotesOf('turn-ins', EMPTY_LAYER_STATS, source({ questState: model, afterStep: 'After step 14: ' }))).toEqual(['After step 14: Turn-ins.']);
    // The objectives add the focused quests' work to the model's notes.
    expect(layerNotesOf('objectives', EMPTY_LAYER_STATS, source({ questState: model, afterStep: '' }))).toEqual([
      'Objectives.',
      'For Cutting Teeth.',
      '1 objective has no map position (reputation, spells, items without a listed source).',
    ]);
  });

  it('names the art’s owner and what the tiles are, in the style drawn', () => {
    expect(layerNotesOf('art', EMPTY_LAYER_STATS, source({ art: { kind: 'tiles', style: 'minimap' } }))).toEqual([MAP_ART_OWNER_NOTE, MINIMAP_TILES_NOTE]);
    expect(layerNotesOf('art', EMPTY_LAYER_STATS, source({ art: { kind: 'tiles', style: 'painted' } }))).toEqual([MAP_ART_OWNER_NOTE, ATLAS_TILES_NOTE]);
    expect(layerNotesOf('art', EMPTY_LAYER_STATS, source({ art: { kind: 'committed', onAtlas: false, unplaced: ['Kalimdor'] } })).at(-1)).toBe('1 image spans several world maps and is not drawn (Kalimdor).');
    expect(layerNotesOf('art', EMPTY_LAYER_STATS, source({ art: { kind: 'local', count: 1200, refused: [[1411 as never, 'failed its hash']] } }))).toEqual([
      '1,200 images in the local set; only those drawn at this level of detail are loaded and verified; never deployed.',
      'UiMap 1411 art failed its hash.',
    ]);
  });

  it('says what the terrain layers are, and that they are loading', () => {
    const notes = layerNotesOf('zone-outlines', EMPTY_LAYER_STATS, source({ terrainLoading: true, arcsLoading: () => true }));
    expect(notes[0]).toMatch(/^Zone outlines from the client’s terrain areas/);
    expect(notes.slice(1)).toEqual(['Loading the terrain data…', 'Loading…']);
    expect(layerNotesOf('relief', EMPTY_LAYER_STATS, source({ artUnder: true }))[1]).toMatch(/^Faint under the painted art \(\d+% opacity\)\.$/);
  });

  it('adds the counts’ notes with the layer’s units', () => {
    expect(layerNotesOf('flight-masters', { ...EMPTY_LAYER_STATS, otherSurfaces: 2 }, source())).toEqual([
      '12 of the other faction not shown.',
      '1 flight master has no spawn in the dataset.',
      '2 points on other world maps',
    ]);
  });
});

describe('walkingPathNotesOf', () => {
  it('says what the route line does with the walked legs', () => {
    expect(walkingPathNotesOf(null)).toEqual(['Walked legs follow their walking paths; flight, transport and hearthstone legs stay straight.']);
    expect(walkingPathNotesOf({ along: 3, pending: 1, fallback: 2, outside: 1 }).slice(1)).toEqual([
      '3 walked legs follow their paths on this map.',
      '1 leg is straight, in short dashes, while its path is computed.',
      '2 legs have no walking path: drawn straight, dash-dot-dot.',
      '1 leg outside the view waits to be computed until it comes into view.',
    ]);
  });
});

describe('categoryCountsOf (§25.3.3; follow-up F-08)', () => {
  it('counts what the map draws, the level ceiling applied, and keeps the quests it holds back per row', () => {
    const zero = { available: 0, 'may-be-available': 0, 'needs-prerequisite': 0, 'unlocks-soon': 0, 'low-level': 0, 'turn-ins': 0 };
    const counts = {
      rows: { ...zero, available: 87, 'may-be-available': 30, 'needs-prerequisite': 11, 'turn-ins': 8 },
      rowsDrawn: { ...zero, available: 60, 'may-be-available': 20, 'needs-prerequisite': 5, 'turn-ins': 8 },
      availableGivers: 41,
      ready: 4,
      objectives: 6,
      aboveCeiling: 43,
    };
    const model = { counts } as unknown as QuestStateModel;
    const result = categoryCountsOf(source({ questState: model, afterStepNumber: 55 }), {});
    expect(result.quests).toMatchObject({ available: 60, 'may-be-available': 20, 'needs-prerequisite': 5, 'turn-ins': 8 });
    expect(result.heldBack).toEqual({ available: 27, 'may-be-available': 10, 'needs-prerequisite': 6 });
    expect(result.availableGivers).toBe(41);
    expect(categoryCountsOf(source(), {}).heldBack).toBeUndefined();
  });
});
