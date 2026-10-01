import { useCallback, useEffect, useLayoutEffect, useMemo, useState, useSyncExternalStore } from 'react';
import type { EditorState, EditorStore } from '../../app';
import type { DerivedState } from '../../app/derived';
import { CLASS_NAMES, characterName } from '../../app/character-names';
import {
  categoryRow,
  DEFAULT_HIDDEN_CATEGORIES,
  hideAll,
  MAP_CATEGORY_GROUP_IDS,
  MAP_CATEGORY_ROWS,
  setCategory,
  setGroup,
  SHOW_ALL,
  type MapCategoryGroupId,
  type MapCategoryRow,
  type MapController,
  type MapStatus,
} from '../../app/map-exports';
import {
  createMapSearchIndex,
  foldText,
  MAP_SEARCH_DEBOUNCE_MS,
  MAP_SEARCH_GROUP_TITLES,
  MAP_SEARCH_GROUPS,
  MAP_SEARCH_LIST_MAX,
  MAP_SEARCH_MIN_CHARS,
  resultPoint,
  resultZone,
  searchFilterOf,
  type MapSearchIndex,
  type MapSearchItem,
  type MapSearchPlace,
} from '../../app/map-search';
import { MAP_CATEGORY_GROUP_LABELS, MAP_CATEGORY_LABELS, MAP_WORDING } from '../../app/map-wording';
import type { QuestStateEntry } from '../../app/quest-state';
import { withArticle } from '../../app/quest-state-text';
import { useDerivedSelector, useEditor } from '../../app/react';
import type { QuestId, WorldPoint } from '../../domain';
import { categoryOfMark, type MapCategoryId, type MapStyle } from '../../map/adapter';
import { formatInteger, plural, type SegmentedOption } from '../kit';
import { MapCategoryDrawer, type DrawerGroup, type DrawerIcon, type DrawerResult, type DrawerResultGroup, type DrawerRow } from '../shell/MapCategoryDrawer';
import { MapKey } from '../shell/MapKey';
import type { Announce } from './LiveAnnouncer';

/**
 * The Map layers drawer's container (docs/research/map-presentation.md §25.3; D-047; steps MP.4b,
 * MP.4c, MM.7): a lazy part (`lazy-parts.ts`), with the drawer it renders and the map search, so
 * none of it is in the entry chunk. It words the controller's counts and notes into rows, applies
 * the rows through the map panel (`onHidden`: the mask, the store's layers, the kept record), runs
 * the search (the index built on the field's first focus; the map filtered to the results while a
 * query lasts), and offers the base map's style (Minimap | Painted).
 */

export interface MapLayersPanelProps {
  readonly id: string;
  readonly docked: boolean;
  readonly controller: MapController;
  readonly store: EditorStore;
  readonly hidden: readonly MapCategoryId[];
  /** Applies a new hidden set; `announcement` is said by the shell's announcer (Show all, Hide all, Defaults). */
  readonly onHidden: (next: readonly MapCategoryId[], announcement?: string) => void;
  readonly collapsed: readonly MapCategoryGroupId[];
  readonly onCollapsed: (next: readonly MapCategoryGroupId[]) => void;
  /** Closes a drawer over the map and returns focus to the toggle. */
  readonly onClose: () => void;
  readonly announce: Announce;
  /** The notices' links for the key (relative to the page). */
  readonly notices: { readonly painted: string; readonly minimap: string; readonly art: string };
  /** Which geometry is loaded, named in the key (MAPS.md §5.6 step 6); null when not known. */
  readonly geometry: string | null;
}

const lowerFirst = (text: string): string => (text === '' ? text : `${text.charAt(0).toLowerCase()}${text.slice(1)}`);

/** Each row's icon (§25.3.2): the category's pin in monochrome, or a line or area swatch. */
const ROW_ICONS: Readonly<Record<MapCategoryId, DrawerIcon>> = {
  available: { kind: 'pin', glyph: 'quest' },
  'may-be-available': { kind: 'pin', glyph: 'quest', edge: 'dashed' },
  'needs-prerequisite': { kind: 'pin', glyph: 'quest', badge: 'lock' },
  'unlocks-soon': { kind: 'pin', glyph: 'quest', badge: 'level' },
  'low-level': { kind: 'pin', glyph: 'quest' },
  'turn-ins': { kind: 'pin', glyph: 'turn-in' },
  objectives: { kind: 'pin', glyph: 'objective' },
  dungeons: { kind: 'pin', glyph: 'dungeon' },
  raids: { kind: 'pin', glyph: 'raid' },
  'unconfirmed-raids': { kind: 'pin', glyph: 'raid', edge: 'dashed' },
  'flight-points': { kind: 'pin', glyph: 'flight' },
  // The network as the canvas draws it: a thin solid line, not the route's dotted flight (review PR-14).
  'flight-network': { kind: 'swatch', swatch: 'network-flight' },
  'all-flights': { kind: 'swatch', swatch: 'network-flight' },
  'transport-stops': { kind: 'pin', glyph: 'transport' },
  portals: { kind: 'pin', glyph: 'portal' },
  'other-faction-flights': { kind: 'pin', glyph: 'flight', hollow: true, struck: true },
  innkeepers: { kind: 'pin', glyph: 'innkeeper', light: true },
  trainers: { kind: 'pin', glyph: 'trainer', light: true },
  vendors: { kind: 'pin', glyph: 'vendor', light: true },
  'route-line': { kind: 'swatch', swatch: 'route' },
  'step-numbers': { kind: 'swatch', swatch: 'numbers' },
  'walking-paths': { kind: 'swatch', swatch: 'walking' },
  'zone-labels': { kind: 'swatch', swatch: 'labels' },
  'zone-borders': { kind: 'swatch', swatch: 'border' },
  'zone-faction': { kind: 'swatch', swatch: 'faction' },
  relief: { kind: 'swatch', swatch: 'relief' },
  coastline: { kind: 'swatch', swatch: 'coast' },
  'coordinate-grid': { kind: 'swatch', swatch: 'grid' },
};

/** The rows whose layer's notes they carry (each layer's notes once, under its first row). */
const NOTES_UNDER: Readonly<Partial<Record<MapCategoryId, MapStatus['layers'][number]['layer']>>> = {
  available: 'available-quests',
  'turn-ins': 'turn-ins',
  objectives: 'objectives',
  dungeons: 'dungeons',
  'flight-points': 'flight-masters',
  'flight-network': 'flight-network',
  'transport-stops': 'transports',
  innkeepers: 'services',
  'route-line': 'route-line',
  'zone-labels': 'labels',
  'zone-borders': 'zone-outlines',
  'zone-faction': 'zone-fill',
  relief: 'relief',
  coastline: 'coastline',
};

/** Rows with nothing to draw although their layer draws (no portal observation is recorded, §10). */
const LATER: Readonly<Partial<Record<MapCategoryId, string>>> = {
  portals: 'None recorded yet: a portal is drawn once an observation is recorded',
};

/** The place rows' units (steps MP.5, MP.8, MP.9, MP.11): what their counts count (§25.3.3). */
const PLACE_UNITS: Readonly<Partial<Record<MapCategoryId, readonly [string, string]>>> = {
  dungeons: ['dungeon', 'dungeons'],
  raids: ['raid', 'raids'],
  'unconfirmed-raids': ['raid', 'raids'],
  'flight-network': ['flight', 'flights'],
  'transport-stops': ['stop', 'stops'],
  'other-faction-flights': ['flight point', 'flight points'],
  // The services (MP.11): NPCs, each drawn at its spawns.
  innkeepers: ['NPC', 'NPCs'],
  trainers: ['NPC', 'NPCs'],
  vendors: ['NPC', 'NPCs'],
};

const selectCharacter = (s: EditorState) => s.project.character;
const selectWalkingPaths = (s: EditorState) => s.view.map.walkingPaths;

interface Words {
  readonly after: string;
  readonly stated: boolean;
}

/** The row's tooltip: how many are in view, and what "+n held" beside the count means (review C-04). */
function titleOf(inView: number | undefined, held: number): string | null {
  const parts = [inView === undefined ? null : `${formatInteger(inView)} in view`, held > 0 ? `${formatInteger(held)} more held back: above the level ceiling, not drawn (an assumption); the Available tab lists them` : null].filter((part) => part !== null);
  return parts.length === 0 ? null : parts.join('; ');
}

/** The row's count and accessible name (§25.3.3): the unit in the name, never announced. Exported for its tests. */
export function countOf(row: MapCategoryRow, status: MapStatus, words: Words, shown: boolean): { readonly count: string | null; readonly name: string } {
  const counts = status.counts;
  const label = MAP_CATEGORY_LABELS[row.id];
  const state = shown ? 'shown' : 'hidden';
  const quests = counts.quests[row.id];
  const plain = { count: null, name: `${label}, ${state}` };
  // The count is what the map draws; the quests the level ceiling holds back are named (F-08), and
  // shown beside the count in words, so a sighted user sees them too (review C-04).
  const held = counts.heldBack?.[row.id] ?? 0;
  const heldWords = held > 0 ? `, ${formatInteger(held)} more above the level ceiling not drawn (an assumption)` : '';
  const heldShown = held > 0 ? ` · +${formatInteger(held)} held` : '';
  if (row.id === 'available') {
    if (quests === undefined) return plain;
    const givers = counts.availableGivers;
    return {
      count: `${givers === null ? formatInteger(quests) : `${formatInteger(quests)} · ${plural(givers, 'giver')}`}${heldShown}`,
      name: `${label}: ${plural(quests, 'quest')}${givers === null ? '' : ` at ${plural(givers, 'giver')}`} ${words.after}${heldWords}, ${state}`,
    };
  }
  if (row.id === 'may-be-available' || row.id === 'needs-prerequisite' || row.id === 'unlocks-soon' || row.id === 'low-level') {
    return quests === undefined ? { count: null, name: `${label}: ${words.after}, ${state}` } : { count: `${formatInteger(quests)}${heldShown}`, name: `${label}: ${plural(quests, 'quest')} ${words.after}${heldWords}, ${state}` };
  }
  if (row.id === 'turn-ins') {
    return quests === undefined
      ? { count: null, name: `${label}: ${words.after}, ${state}` }
      : {
          count: `${formatInteger(quests)} · ${formatInteger(counts.ready ?? 0)} ready`,
          name: `${label}: ${plural(quests, 'quest')} in the log, ${formatInteger(counts.ready ?? 0)} ready, ${words.after}, ${state}`,
        };
  }
  if (row.id === 'objectives') {
    return quests === undefined
      ? { count: null, name: `${label}: ${words.after}, ${state}` }
      : { count: formatInteger(quests), name: `${label}: ${plural(quests, 'log quest')} with objectives on the map ${words.after}, ${state}` };
  }
  if (row.id === 'flight-points') {
    const places = counts.places['flight-points'];
    if (places === undefined) return plain;
    // "34 · 2 known" after the step (MP.8), or the side's flight points without route state.
    const known = counts.flightsKnown ?? null;
    return known === null
      ? { count: formatInteger(places), name: `${label}: ${plural(places, 'flight point')} of your side, ${state}` }
      : { count: `${formatInteger(places)} · ${formatInteger(known)} known`, name: `${label}: ${plural(places, 'flight point')} of your side, ${formatInteger(known)} known ${words.after}, ${state}` };
  }
  const unit = PLACE_UNITS[row.id];
  const places = counts.places[row.id];
  if (unit !== undefined && places !== undefined) return { count: formatInteger(places), name: `${label}: ${formatInteger(places)} ${places === 1 ? unit[0] : unit[1]}, ${state}` };
  return plain;
}

/** A quest result's state in words (§25.3.5): its row after the step, or why it is not available. */
function questState(entry: QuestStateEntry | undefined, words: Words, who: string): string {
  if (!words.stated) return 'no route state yet';
  if (entry === undefined) return `not open to ${withArticle(who)}`;
  switch (entry.cls) {
    case 'available':
      return `available ${words.after}`;
    case 'low-level':
      return `low level ${words.after}`;
    case 'uncertain-level':
    case 'uncertain-history':
    case 'uncertain-other':
      return `${lowerFirst(entry.reason)} ${words.after}`;
    case 'locked':
      return `needs a prerequisite ${words.after}: ${lowerFirst(entry.reason)}`;
    case 'in-log':
      return `in the log ${words.after}`;
    case 'done':
      return `${lowerFirst(entry.reason)} ${words.after.replace(/^after/, 'by')}`;
    case 'unlocks-soon':
    case 'outside':
      return `not available ${words.after}: ${lowerFirst(entry.reason)}`;
  }
}

const RESULT_NOUNS: Readonly<Record<MapSearchItem['kind'], readonly [string, string]>> = {
  quest: ['quest', 'quests'],
  npc: ['NPC', 'NPCs'],
  object: ['object', 'objects'],
  'flight-point': ['flight master', 'flight masters'],
  zone: ['zone', 'zones'],
  dungeon: ['dungeon', 'dungeons'],
  raid: ['raid', 'raids'],
  'taxi-node': ['flight point', 'flight points'],
  transport: ['transport stop', 'transport stops'],
  service: ['service NPC', 'service NPCs'],
};

const RESULT_ICONS: Readonly<Record<MapSearchItem['kind'], DrawerIcon>> = {
  quest: { kind: 'pin', glyph: 'quest' },
  npc: { kind: 'pin', glyph: 'quest' },
  object: { kind: 'pin', glyph: 'objective' },
  'flight-point': { kind: 'pin', glyph: 'flight' },
  zone: { kind: 'swatch', swatch: 'labels' },
  dungeon: { kind: 'pin', glyph: 'dungeon' },
  raid: { kind: 'pin', glyph: 'raid' },
  'taxi-node': { kind: 'pin', glyph: 'flight' },
  transport: { kind: 'pin', glyph: 'transport' },
  service: { kind: 'pin', glyph: 'innkeeper', light: true },
};

/** A service result's icon: its kind's light pin. */
const SERVICE_ICONS: Readonly<Record<'innkeeper' | 'trainer' | 'vendor', DrawerIcon>> = {
  innkeeper: { kind: 'pin', glyph: 'innkeeper', light: true },
  trainer: { kind: 'pin', glyph: 'trainer', light: true },
  vendor: { kind: 'pin', glyph: 'vendor', light: true },
};

const selectPlaces = (state: DerivedState | null) => state?.places ?? null;

/** A stop's name from its pin's words ("Transport stop: Orgrimmar, Zeppelin to Undercity (service inferred …)"). */
function stopName(label: string | null): string {
  const found = label === null ? null : /^Transport stop: (.+?) \(service inferred/.exec(label);
  return found?.[1] ?? 'Transport stop (service unknown)';
}

/**
 * The places model's places for the map search (review PR-05; map-presentation.md §25.3.5): the
 * dungeons and raids by their instances' names, every flight point by its client node's name (the
 * client-only nodes too, which no flight master names), the transport stops, and the services by
 * name and by kind ("innkeeper", "Warrior trainer", "vendor"), one entry per NPC with all its pins.
 * Only what the model draws is found.
 */
export function searchPlacesOf(
  places: Pick<NonNullable<DerivedState['places']>, 'dungeons' | 'flightPoints' | 'transports' | 'services'> | null,
  dataset: { npc(id: never): { readonly name: string } | undefined },
  className: string,
): readonly MapSearchPlace[] {
  if (places === null) return [];
  const out: MapSearchPlace[] = [];
  for (const item of places.dungeons.items) {
    const d = item.descriptor;
    if (d.type !== 'marker' || item.name === undefined) continue;
    const raid = d.mark?.state === 'raid';
    out.push({ key: `place:${d.id}`, kind: raid ? 'raid' : 'dungeon', id: 0, name: item.name, also: raid ? 'raid instance' : 'dungeon instance', pins: [d.id], point: d.point, what: raid ? 'Raid entrance' : 'Dungeon entrance', category: d.category ?? 'dungeons' });
  }
  for (const item of places.flightPoints.items) {
    const d = item.descriptor;
    if (d.type !== 'marker' || item.name === undefined) continue;
    const other = d.category === 'other-faction-flights';
    out.push({ key: `place:${d.id}`, kind: 'taxi-node', id: 0, name: item.name, also: 'flight point', pins: [d.id], point: d.point, what: other ? 'Flight point of the other faction' : 'Flight point', category: d.category ?? 'flight-points' });
  }
  for (const item of places.transports.items) {
    const d = item.descriptor;
    if (d.type !== 'marker') continue;
    out.push({ key: `place:${d.id}`, kind: 'transport', id: 0, name: stopName(d.label), also: 'transport stop', pins: [d.id], point: d.point, what: 'Transport stop', category: 'transport-stops' });
  }
  const services = new Map<number, { readonly kind: 'innkeeper' | 'trainer' | 'vendor'; readonly pins: string[]; readonly point: MapSearchPlace['point'] }>();
  for (const item of places.services.items) {
    const d = item.descriptor;
    if (d.type !== 'marker' || d.ref.kind !== 'service') continue;
    const known = services.get(d.ref.npc);
    if (known === undefined) services.set(d.ref.npc, { kind: d.ref.service, pins: [d.id], point: d.point });
    else known.pins.push(d.id);
  }
  for (const [npc, entry] of services) {
    const name = dataset.npc(npc as never)?.name;
    if (name === undefined) continue;
    const what = entry.kind === 'innkeeper' ? 'Innkeeper' : entry.kind === 'trainer' ? `${className} trainer` : 'Vendor (dataset only)';
    const category: MapCategoryId = entry.kind === 'innkeeper' ? 'innkeepers' : entry.kind === 'trainer' ? 'trainers' : 'vendors';
    out.push({ key: `npc:${String(npc)}`, kind: 'service', id: npc, name, also: what, pins: entry.pins, point: entry.point, what, category });
  }
  return out;
}

export function MapLayersPanel({ id, docked, controller, store, hidden, onHidden, collapsed, onCollapsed, onClose, announce, notices, geometry }: MapLayersPanelProps) {
  // The notes' words come with this lazy part (app/map-wording.ts): installed before the first paint.
  useLayoutEffect(() => {
    controller.setWording(MAP_WORDING);
  }, [controller]);
  const status = useSyncExternalStore(controller.subscribe, controller.getStatus, controller.getStatus);
  const character = useEditor(store, selectCharacter);
  const walkingPaths = useEditor(store, selectWalkingPaths);
  const who = characterName(character);
  const hiddenSet = useMemo(() => new Set(hidden), [hidden]);
  const onAtlas = controller.surfaces.some((info) => info.kind === 'atlas');
  const stated = status.counts.afterStep !== null;
  const words: Words = useMemo(
    () => ({ after: status.counts.afterStep === null ? `open to ${withArticle(who)} (no route state yet)` : `after step ${formatInteger(status.counts.afterStep)}`, stated }),
    [status.counts.afterStep, who, stated],
  );

  // Rows and groups (§25.3.2, §25.3.3).
  const groups = useMemo((): readonly DrawerGroup[] => {
    const layerStatus = new Map(status.layers.map((entry) => [entry.layer, entry]));
    const minimap = status.style.shown === 'minimap';
    const rowView = (row: MapCategoryRow): DrawerRow => {
      const layer = row.layer === null ? undefined : layerStatus.get(row.layer);
      let unavailable = LATER[row.id] ?? layer?.unavailable ?? null;
      if (row.id === 'walking-paths') unavailable = status.walkingPaths.unavailable;
      // The minimap style draws no terrain outline (D-047, §25.4; review PR-01).
      if ((row.id === 'relief' || row.id === 'coastline' || row.id === 'zone-borders') && minimap) unavailable = 'Painted style only';
      const shown = row.id === 'walking-paths' ? walkingPaths && !hiddenSet.has(row.id) : !hiddenSet.has(row.id);
      const { count, name } = countOf(row, status, words, unavailable === null && shown);
      const notesLayer = NOTES_UNDER[row.id];
      const notes = row.id === 'walking-paths' ? status.walkingPaths.notes : notesLayer === undefined ? [] : (layerStatus.get(notesLayer)?.notes ?? []);
      const inView = status.counts.inView[row.id];
      const label = row.id === 'trainers' ? `${CLASS_NAMES[character.class]} trainers` : MAP_CATEGORY_LABELS[row.id];
      return {
        id: row.id,
        label,
        icon: ROW_ICONS[row.id],
        shown,
        unavailable,
        count,
        // A row that cannot be used now is named for it, not "hidden" (review PR-21): "Portals, unavailable: none recorded yet…".
        name: unavailable !== null ? `${label}, unavailable: ${lowerFirst(unavailable)}` : row.id === 'trainers' ? name.replace(MAP_CATEGORY_LABELS[row.id], label) : name,
        title: titleOf(inView, status.counts.heldBack?.[row.id] ?? 0),
        notes,
      };
    };
    return MAP_CATEGORY_GROUP_IDS.map((group): DrawerGroup => {
      const rows = MAP_CATEGORY_ROWS.filter((row) => row.group === group).map(rowView);
      // A group's box counts the rows that can be used: an unavailable row never leaves it mixed (review QA-25).
      const usable = rows.filter((row) => row.unavailable === null);
      const checked = usable.filter((row) => row.shown).length;
      return {
        id: group,
        title: MAP_CATEGORY_GROUP_LABELS[group],
        subtitle: group === 'quests' ? words.after : group === 'services' ? 'zoomed in' : null,
        state: usable.length > 0 && checked === usable.length ? true : checked === 0 ? false : 'mixed',
        collapsed: collapsed.includes(group),
        rows,
      };
    });
  }, [status, words, hiddenSet, walkingPaths, collapsed, character.class]);

  const onRow = useCallback(
    (row: string, show: boolean) => {
      const entry = categoryRow(row as MapCategoryId);
      if (entry === undefined) return;
      onHidden(setCategory(hidden, entry.id, show));
    },
    [hidden, onHidden],
  );
  const onGroup = useCallback(
    (group: MapCategoryGroupId, show: boolean) => {
      onHidden(setGroup(hidden, group, show));
    },
    [hidden, onHidden],
  );
  const onCollapse = useCallback(
    (group: MapCategoryGroupId, fold: boolean) => {
      onCollapsed(fold ? [...new Set([...collapsed, group])] : collapsed.filter((entry) => entry !== group));
    },
    [collapsed, onCollapsed],
  );

  // The base map's style (map-atlas.md §21.6; step MM.7): announced, kept in this browser.
  const style = useMemo(() => {
    const need = onAtlas ? null : 'Styles apply to the seamless atlas, which this geometry cannot place: the map shows one world map at a time.';
    const options: readonly SegmentedOption<MapStyle>[] = [
      { value: 'minimap', label: 'Minimap', unavailable: need },
      { value: 'painted', label: 'Painted', unavailable: need },
    ];
    return {
      value: status.style.chosen,
      options,
      onChange: (next: MapStyle) => {
        controller.setMapStyle(next);
        announce(`Map style: ${next === 'minimap' ? 'Minimap' : 'Painted'}.`);
      },
      note: need ?? status.style.unavailable,
    };
  }, [onAtlas, status.style.chosen, status.style.unavailable, controller, announce]);

  // The search (§25.3.5; step MP.4c).
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  // The index is built on the field's first focus (§25.3.5), and again only for another dataset view.
  const [wanted, setWanted] = useState(false);
  const dataset = controller.dataset();
  // The places model's places join the index (review PR-05): dungeons, flight points, stops and services.
  const places = useDerivedSelector(selectPlaces);
  const className = CLASS_NAMES[character.class];
  const searchPlaces = useMemo(() => (wanted ? searchPlacesOf(places, dataset, className) : []), [wanted, places, dataset, className]);
  const index: MapSearchIndex | null = useMemo(() => (wanted ? createMapSearchIndex(dataset, controller.flightMasterIds(), searchPlaces) : null), [wanted, dataset, controller, searchPlaces]);
  const long = foldText(query.trim()).length >= MAP_SEARCH_MIN_CHARS;
  useEffect(() => {
    if (!long) return undefined;
    const handle = window.setTimeout(() => {
      setDebounced(query.trim());
    }, MAP_SEARCH_DEBOUNCE_MS);
    return () => {
      window.clearTimeout(handle);
    };
  }, [query, long]);
  // A query starts at two characters, 150 ms after the last key.
  const active = long ? debounced : '';
  const hits = useMemo(() => (active === '' || index === null ? null : index.search(active).items), [active, index]);
  // While a query lasts the map draws only its results (plus the route and the selection).
  useEffect(() => {
    controller.setSearchFilter(hits === null ? null : searchFilterOf(hits));
  }, [controller, hits]);
  useEffect(
    () => () => {
      controller.setSearchFilter(null);
    },
    [controller],
  );

  const model = controller.questState();
  const results = useMemo(() => {
    if (hits === null) return null;
    const zoneName = (point: { readonly uiMapId: number | null } | undefined): string | null => (point?.uiMapId === null || point === undefined ? null : (dataset.zone(point.uiMapId as never)?.name ?? null));
    const line = (item: MapSearchItem): string => {
      const place = item.place;
      if (place !== undefined) return `${place.what}${hiddenSet.has(place.category) ? ' (hidden category)' : ''}${place.point === null ? ' · no map position' : ''}`;
      switch (item.kind) {
        case 'quest': {
          const record = dataset.quest(item.id as QuestId);
          const starter = record?.starters.find((ref) => ref.kind !== 'item');
          const starterName = starter === undefined ? null : starter.kind === 'npc' ? dataset.npc(starter.id)?.name : starter.kind === 'object' ? dataset.object(starter.id)?.name : null;
          const entry = model?.quests.get(item.id as QuestId);
          const hiddenMark = entry !== undefined && entry.mark !== null && hiddenSet.has(categoryOfMark(entry.mark)) ? ' (hidden category)' : '';
          const parts = [starterName === null || starterName === undefined ? 'No giver on the map' : `Start: ${starterName}`, record?.level === null || record?.level === undefined ? null : `level ${String(record.level)}`, `${questState(entry, words, who)}${hiddenMark}`];
          return parts.filter((part): part is string => part !== null).join(' · ');
        }
        case 'npc':
        case 'flight-point':
        case 'object': {
          const spawns = dataset.spawns(item.kind === 'object' ? { kind: 'object', id: item.id as never } : { kind: 'npc', id: item.id as never });
          const zone = zoneName(spawns[0]);
          const what = item.kind === 'flight-point' ? `Flight master${hiddenSet.has('flight-points') ? ' (hidden category)' : ''}` : item.kind === 'object' ? 'Object' : 'NPC';
          const placed = spawns.some((spawn) => spawn.world !== null);
          return [what, zone, placed ? null : 'no map position'].filter((part): part is string => part !== null).join(' · ');
        }
        case 'zone': {
          const mapId = dataset.zone(item.id as never)?.worldMapId ?? null;
          const map = mapId === null ? null : controller.mapName(mapId);
          return map === null ? 'Zone' : `Zone · ${map}`;
        }
        case 'dungeon':
        case 'raid':
        case 'taxi-node':
        case 'transport':
        case 'service':
          return RESULT_NOUNS[item.kind][0];
      }
    };
    const iconOf = (item: MapSearchItem): DrawerIcon => {
      if (item.kind !== 'service' || item.place === undefined) return RESULT_ICONS[item.kind];
      const category = item.place.category;
      return category === 'trainers' ? SERVICE_ICONS.trainer : category === 'vendors' ? SERVICE_ICONS.vendor : SERVICE_ICONS.innkeeper;
    };
    const listed = hits.slice(0, MAP_SEARCH_LIST_MAX);
    const groupsOut: DrawerResultGroup[] = MAP_SEARCH_GROUPS.flatMap((group) => {
      const inGroup = listed.filter((item) => item.group === group);
      return inGroup.length === 0 ? [] : [{ title: MAP_SEARCH_GROUP_TITLES[group], results: inGroup.map((item): DrawerResult => ({ id: item.key, icon: iconOf(item), name: item.name, line: line(item) })) }];
    });
    const byKind = (['quest', 'npc', 'object', 'dungeon', 'raid', 'flight-point', 'taxi-node', 'transport', 'service', 'zone'] as const).flatMap((kind) => {
      const n = hits.filter((item) => item.kind === kind).length;
      const [one, many] = RESULT_NOUNS[kind];
      return n === 0 ? [] : [`${formatInteger(n)} ${n === 1 ? one : many}`];
    });
    const summary = hits.length === 0 ? `No results for “${active}”` : `${plural(hits.length, 'result')}: ${byKind.join(', ')}`;
    const more = hits.length > listed.length ? `and ${formatInteger(hits.length - listed.length)} more: type more to narrow the search` : null;
    return { summary, groups: groupsOut, more };
  }, [hits, controller, dataset, model, words, who, hiddenSet, active]);

  const onChoose = useCallback(
    (key: string) => {
      const item = hits?.find((entry) => entry.key === key);
      if (item === undefined) return;
      const zone = resultZone(item);
      if (zone !== null) {
        if (controller.jumpToZone(zone)) announce(`Map shows ${item.name}.`);
        return;
      }
      const point: WorldPoint | null = resultPoint(dataset, item);
      if (point === null) {
        announce(`${item.name} has no place on the map.`);
        return;
      }
      // The map pans to it, rings its pin and opens its popover, which takes focus (§25.3.5; review
      // PR-05); the right panel's tab stays as it is (the popover's Show in Details opens it there).
      const match = item.place !== undefined ? { pins: item.place.pins } : item.kind === 'quest' ? { questId: item.id as QuestId } : { subject: item.key };
      const shown = controller.showResult(point, match);
      if (!shown) announce(`${item.name} is on a map this view cannot show.`);
      else if (controller.getStatus().popover === null) announce(`Map shows ${item.name}.`);
    },
    [hits, controller, dataset, announce],
  );
  const onFit = useCallback(() => {
    if (hits === null) return;
    const points = hits.slice(0, 500).flatMap((item) => {
      const point = resultPoint(dataset, item);
      return point === null ? [] : [point];
    });
    if (controller.fitPoints(points)) announce(`Map shows ${plural(points.length, 'result')}.`);
  }, [hits, controller, dataset, announce]);

  const search = {
    query,
    onQuery: setQuery,
    onFocus: () => {
      setWanted(true);
    },
    results,
    onChoose,
    onFit,
    status: hits === null ? '' : hits.length === 0 ? 'No results' : plural(hits.length, 'result'),
  };

  const notes = status.insets.map((inset) => `${inset.name}: shown in a box, not in position${inset.questData ? '' : '; no quest data yet'}`);
  return (
    <MapCategoryDrawer
      id={id}
      docked={docked}
      style={style}
      notices={[...status.problems, ...notes]}
      groups={groups}
      onRow={onRow}
      onGroup={onGroup}
      onCollapse={onCollapse}
      onShowAll={() => {
        onHidden(SHOW_ALL, 'All map categories shown.');
      }}
      onHideAll={() => {
        onHidden(hideAll(hidden), 'All map categories hidden; the route stays.');
      }}
      onDefaults={() => {
        onHidden(DEFAULT_HIDDEN_CATEGORIES, 'Map categories back to their defaults.');
      }}
      search={search}
      onClose={onClose}
      keyContent={<MapKey shownStyle={status.style.shown} notices={notices} atlas={status.insets.length > 0 || onAtlas ? { notes } : null} geometry={geometry} />}
    />
  );
}
