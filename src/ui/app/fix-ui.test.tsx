// @vitest-environment happy-dom
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDerivedStore } from '../../app/derived';
import { stubDataset, stubNpc, stubQuest } from '../../app/map-test-helpers';
import type { MapStatus } from '../../app/map-controller';
import type { MapCategoryRow } from '../../app/map-categories';
import type { QuestStateModel } from '../../app/quest-state';
import { DerivedStoreProvider } from '../../app/react';
import type { NpcId, QuestId, UiMapId, WorldMapId } from '../../domain/ids';
import type { Location } from '../../domain/points';
import type { RouteStep } from '../../domain/route';
import { stepPlace } from '../app-model';
import { StepRow } from '../route/StepRow';
import type { StepRowModel } from '../route/rows';
import { MapKey } from '../shell/MapKey';
import { MapCategoryDrawer, type DrawerGroup, type MapCategoryDrawerProps } from '../shell/MapCategoryDrawer';
import { acceptFirstOf, groupHeadingWords } from './AvailableQuests';
import { countOf, searchPlacesOf } from './MapLayersPanel';
import { QuestDetails } from './QuestDetails';
import { UNNAMED_ZONE_NOTE, zoneChoices } from './StepEditors';

/*
 * The UI review's fixes that no other suite covers (fix-ui): Accept first never adds a second accept
 * (QA-05), the zone headings' words (UI-13), the Details zone choices (QA-22), line 2's short place
 * (UI-01), the drawer rows' one-line notes and the key's entries (PR-09, PR-14), the search's places
 * (PR-05), and Details' difficulty at the step (UI-12).
 */

afterEach(cleanup);

// Ids by type only: a ui file imports no domain values (ARCHITECTURE §4).
const npcId = (id: number): NpcId => id as NpcId;
const questId = (id: number): QuestId => id as QuestId;
const uiMapId = (id: number): UiMapId => id as UiMapId;
const worldMapId = (id: number): WorldMapId => id as WorldMapId;

const KALIMDOR = worldMapId(1);
const DUROTAR = uiMapId(1411);

describe('Accept first (review QA-05)', () => {
  const model = (entries: Record<number, 'available' | 'in-log' | 'done'>) =>
    ({ quests: new Map(Object.entries(entries).map(([id, cls]) => [Number(id) as never, { cls } as never])) }) as Pick<QuestStateModel, 'quests'>;
  const name = (id: number): string => `Quest ${String(id)}`;

  it('adds the first prerequisite the route does not take yet', () => {
    expect(acceptFirstOf([questId(1), questId(2)], model({ 1: 'available', 2: 'available' }), new Map(), '8', name)).toEqual({ id: 1, blocked: null });
    // The first is accepted later in the route: the second is the one to add.
    expect(acceptFirstOf([questId(1), questId(2)], model({ 1: 'available', 2: 'available' }), new Map([[questId(1), 11]]), '8', name)).toEqual({ id: 2, blocked: null });
  });

  it('never adds a second accept: with every prerequisite taken, it is unavailable and says why', () => {
    expect(acceptFirstOf([questId(1)], model({ 1: 'available' }), new Map([[questId(1), 11]]), '8', name)).toEqual({
      id: 1,
      blocked: 'Quest 1 is already accepted at step 11: move that step before step 8 instead of accepting it twice',
    });
    expect(acceptFirstOf([questId(1)], model({ 1: 'in-log' }), new Map([[questId(1), 3]]), '8', name).blocked).toBe('Quest 1 is already in the quest log after step 8: complete it and turn it in first');
    expect(acceptFirstOf([], model({}), new Map(), '8', name)).toEqual({ id: null, blocked: null });
  });
});

describe('zone headings in words (review UI-13)', () => {
  it('says what the count in brackets counts, the median chip, and how many are listed', () => {
    const words = groupHeadingWords(
      {
        key: 'zone:1411',
        kind: 'zone',
        title: 'Durotar',
        uiMapId: DUROTAR,
        span: { uiMapId: DUROTAR, name: 'Durotar', open: 31, text: 'quests 7–12 (31)', detail: 'Durotar: quests 7–12 (31 open to an Orc Warrior; 33 in the dataset)', basis: 'derived', viewing: '' } as never,
        rating: { level: 9, difficulty: 'impossible', lowerBound: false },
        distance: null,
        questIds: [questId(1), questId(2)],
      },
      '12',
    );
    expect(words).toBe('Durotar, quests 7–12 (31 open to an Orc Warrior; 33 in the dataset), median quest level 9, Impossible (red), at the level after step 12, 2 quests listed');
  });
});

describe('the Details zone choices (review QA-22)', () => {
  const dataset = stubDataset({
    zones: [
      { uiMapId: DUROTAR, name: 'Durotar', worldMapId: KALIMDOR },
      { uiMapId: uiMapId(1414), name: 'Kalimdor', worldMapId: KALIMDOR },
      { uiMapId: uiMapId(1463), name: null, worldMapId: KALIMDOR },
    ],
  });
  const groups = [{ surface: 'atlas' as never, label: 'Kalimdor', zones: [{ uiMapId: DUROTAR, label: 'Durotar' }] }];

  it('offers the map’s zones by world map, never a continent or a map without a name', () => {
    expect(zoneChoices(dataset, groups, null)).toEqual([{ group: 'Kalimdor', options: [{ value: '1411', label: 'Durotar' }] }]);
    // Without a map: the named zones only.
    expect(zoneChoices(dataset, null, null).map((option) => ('label' in option ? option.label : option.group))).toEqual(['Durotar', 'Kalimdor']);
  });

  it('keeps a point already set on another map choosable, and says why an unnamed one has only its id', () => {
    const on = (id: number): Location => ({ source: { space: 'zone', uiMapId: uiMapId(id), x: 1, y: 2, frame: 'forever', lexemes: null }, label: null, radius: null });
    expect(zoneChoices(dataset, groups, on(1463)).at(-1)).toEqual({ group: 'Other maps', options: [{ value: '1463', label: `UiMap 1463 (${UNNAMED_ZONE_NOTE})` }] });
    expect(zoneChoices(dataset, groups, on(1414)).at(-1)).toEqual({ group: 'Other maps', options: [{ value: '1414', label: 'Kalimdor' }] });
  });
});

describe('line 2’s short place (review UI-01)', () => {
  const dataset = stubDataset({ zones: [{ uiMapId: DUROTAR, name: 'Durotar', worldMapId: KALIMDOR }] });
  const accept = (location: Location | null): RouteStep => ({ kind: 'accept', id: 's1' as never, questId: questId(1), anyOf: null, via: null, location, groupId: null, locked: false, note: null, durationOverride: null, origin: { kind: 'user' } }) as unknown as RouteStep;

  it('is who and the zone, without the coordinates', () => {
    const location: Location = { source: { space: 'zone', uiMapId: DUROTAR, x: 42.85, y: 69.15, frame: 'forever', lexemes: null }, label: 'Zureetha Fargaze', radius: null };
    expect(stepPlace(accept(location), dataset)).toEqual({ lead: 'Zureetha Fargaze', zone: 'Durotar' });
    expect(stepPlace(accept(null), dataset)).toBeNull();
  });

  it('draws the zone whole in its own span, the whole detail in the tooltip', () => {
    const model = {
      type: 'step',
      key: 's1',
      number: 12,
      kind: 'accept',
      verb: 'Accept',
      title: 'Vile Familiars',
      chain: null,
      detail: 'Zureetha Fargaze · Durotar 42.85, 69.15',
      place: { lead: 'Zureetha Fargaze', zone: 'Durotar' },
      projectedLevel: { value: null, unknownReason: null, lowerBound: false, upperBound: false, assumed: false, eraFallback: false },
      duration: { value: null, unknownReason: null, lowerBound: false, upperBound: false, assumed: false, eraFallback: false },
      xpGained: { value: null, unknownReason: null, lowerBound: false, upperBound: false, assumed: false, eraFallback: false },
      pending: null,
      assumptions: null,
      quest: null,
      issues: { error: 0, warning: 0, info: 0 },
      issue: null,
      mark: 'available',
      levelUp: null,
      locked: false,
    } as unknown as StepRowModel;
    const { container } = render(
      <div role="listbox" aria-label="Route">
        <StepRow model={model} selected={false} active={false} />
      </div>,
    );
    const detail = container.querySelector('.frl-steprow__line2 .frl-steprow__detail');
    expect(detail?.getAttribute('title')).toBe('Zureetha Fargaze · Durotar 42.85, 69.15');
    expect(detail?.querySelector('.frl-steprow__zone')?.textContent).toBe('Durotar');
    expect(detail?.textContent).not.toContain('42.85');
    // The row's name keeps the coordinates.
    expect(container.querySelector('[role="option"]')?.getAttribute('aria-label')).toContain('Durotar 42.85, 69.15');
  });
});

describe('the Map layers drawer’s rows and key (review PR-09, PR-14)', () => {
  const group = (notes: readonly string[]): DrawerGroup => ({
    id: 'instances',
    title: 'Instances',
    subtitle: null,
    state: true,
    collapsed: false,
    rows: [{ id: 'dungeons', label: 'Dungeons', icon: { kind: 'pin', glyph: 'dungeon' }, shown: true, unavailable: null, count: '19', name: 'Dungeons: 19 dungeons, shown', title: null, notes }],
  });
  const drawer = (groups: readonly DrawerGroup[]) => {
    const props: MapCategoryDrawerProps = {
      id: 'drawer',
      docked: true,
      style: { value: 'minimap', options: [], onChange: vi.fn(), note: null },
      notices: [],
      groups,
      onRow: vi.fn(),
      onGroup: vi.fn(),
      onCollapse: vi.fn(),
      onShowAll: vi.fn(),
      onHideAll: vi.fn(),
      onDefaults: vi.fn(),
      search: { query: '', onQuery: vi.fn(), onFocus: vi.fn(), results: null, onChoose: vi.fn(), onFit: vi.fn(), status: '' },
      onClose: vi.fn(),
      keyContent: null,
    };
    return render(<MapCategoryDrawer {...props} />);
  };

  it('shows a row’s notes as one line with how many more, and keeps every note in its description', () => {
    const notes = ['The instances of the client’s dungeon finder, at the dataset’s entrances.', 'Raids with no dungeon-finder row, hidden by default.', 'Quests inside: the dataset’s dungeon quests.'];
    const { container } = drawer([group(notes)]);
    const box = screen.getByRole('checkbox', { name: 'Dungeons: 19 dungeons, shown' });
    expect(document.getElementById(box.getAttribute('aria-describedby') ?? '')?.textContent).toBe(notes.join(''));
    const line = container.querySelector('.frl-mapdrawer__note-line');
    expect(line?.querySelector('.frl-mapdrawer__note-first')?.textContent).toBe(notes[0]);
    expect(line?.querySelector('.frl-mapdrawer__note-more')?.textContent).toBe('+2 more');
    expect(container.querySelector('.frl-mapdrawer__notes')?.getAttribute('title')).toBe(notes.join('\n'));
  });

  it('names the travel network’s lines, the zone borders, the unverified entrance ring and the other faction’s letter', () => {
    render(<MapKey shownStyle="minimap" notices={{ painted: 'p', minimap: 'm', art: 'a' }} atlas={null} />);
    for (const words of [
      /^Flight network: thin, solid/,
      /^Transport rides between stops: thin, dashed/,
      /^Zone border: /,
      /^Dashed ring, bottom left: the entrance’s position is not verified/,
      /^Letter A or H, top right/,
      /^Struck-through glyph with a letter/,
    ]) {
      expect(screen.getByText(words)).toBeTruthy();
    }
  });
});

describe('the map search’s places (review PR-05)', () => {
  const marker = (id: string, fields: Record<string, unknown>) => ({ type: 'marker', id, point: { mapId: KALIMDOR, x: 0, y: 0 }, label: null, refs: [], ...fields });

  it('takes the dungeons, every flight point by its node’s name, the stops and the services by name and kind', () => {
    const places = {
      dungeons: { items: [{ descriptor: marker('dungeon:718', { mark: { state: 'dungeon' }, category: 'dungeons' }), name: 'Wailing Caverns' }], unplaced: 0 },
      flightPoints: { items: [{ descriptor: marker('flight:25', { category: 'flight-points' }), name: 'Crossroads, The Barrens' }], unplaced: 0 },
      transports: { items: [{ descriptor: marker('stop:1', { label: 'Transport stop: Orgrimmar, Zeppelin to Undercity (service inferred from client transport path 1) · wait' }) }], unplaced: 0 },
      services: {
        items: [
          { descriptor: marker('service:npc:40:0', { ref: { kind: 'service', service: 'innkeeper', npc: 40, spawnIndex: 0 } }) },
          { descriptor: marker('service:npc:40:1', { ref: { kind: 'service', service: 'innkeeper', npc: 40, spawnIndex: 1 } }) },
        ],
        unplaced: 0,
      },
    } as never;
    const dataset = stubDataset({ npcs: [stubNpc({ id: npcId(40), name: 'Innkeeper Grosk' })] });
    const found = searchPlacesOf(places, dataset, 'Warrior');
    expect(found.map((place) => [place.key, place.kind, place.name, place.category])).toEqual([
      ['place:dungeon:718', 'dungeon', 'Wailing Caverns', 'dungeons'],
      ['place:flight:25', 'taxi-node', 'Crossroads, The Barrens', 'flight-points'],
      ['place:stop:1', 'transport', 'Orgrimmar, Zeppelin to Undercity', 'transport-stops'],
      ['npc:40', 'service', 'Innkeeper Grosk', 'innkeepers'],
    ]);
    // A service NPC is one result with all its pins, found by its kind too.
    expect(found[3]).toMatchObject({ pins: ['service:npc:40:0', 'service:npc:40:1'], also: 'Innkeeper' });
    expect(searchPlacesOf(null, dataset, 'Warrior')).toEqual([]);
  });
});

describe('Details’ difficulty (review UI-12)', () => {
  it('is taken at the selected step when there is route state, as the rows and the Available tab take it', () => {
    const quest = stubQuest({ id: questId(1), name: 'Vile Familiars', level: 4 });
    const dataset = stubDataset({ quests: [quest] });
    const questState = { level: 3, levelLowerBound: false, quests: new Map([[questId(1), { questId: questId(1), level: 4, difficulty: 'difficult', cls: 'available' }]]) } as unknown as QuestStateModel;
    const handle = createDerivedStore();
    handle.publish({ questState });
    render(
      <DerivedStoreProvider store={handle.store}>
        <QuestDetails questId={questId(1)} dataset={dataset} character={{ race: 'Orc', class: 'Warrior', faction: 'Horde', startLevel: 1 } as never} />
      </DerivedStoreProvider>,
    );
    const text = document.body.textContent ?? '';
    expect(text).toContain('Difficulty at the level after the selected step (3), as the route list and the Available tab take it.');
    expect(within(document.body).getAllByText(/Difficult \(yellow\)/).length).toBeGreaterThan(0);
    expect(text).not.toContain('start level (1)');
  });
});

describe('the drawer’s quest counts and the level ceiling (follow-up F-08)', () => {
  const status = (heldBack: MapStatus['counts']['heldBack']) =>
    ({ counts: { afterStep: 55, who: 'Orc Warrior', quests: { available: 44, 'may-be-available': 20 }, heldBack, availableGivers: 40, ready: 4, places: {}, inView: {} } }) as unknown as MapStatus;
  const row = (id: MapCategoryRow['id']) => ({ id }) as MapCategoryRow;
  const words = { after: 'after step 55', stated: true };

  it('shows what the map draws, and names the quests the ceiling holds back in the accessible name', () => {
    expect(countOf(row('available'), status({ available: 43 }), words, true)).toEqual({
      count: '44 · 40 givers · +43 held',
      name: 'Available: 44 quests at 40 givers after step 55, 43 more above the level ceiling not drawn (an assumption), shown',
    });
    expect(countOf(row('may-be-available'), status({ available: 43 }), words, false)).toEqual({ count: '20', name: 'May be available: 20 quests after step 55, hidden' });
    // The held-back quests are visible beside the count, in words, not only in the accessible name (review C-04).
    expect(countOf(row('may-be-available'), status({ 'may-be-available': 1 }), words, true).count).toBe('20 · +1 held');
    expect(countOf(row('available'), status(undefined), words, true).name).toBe('Available: 44 quests at 40 givers after step 55, shown');
  });
});
