import type { QuestId, UiMapId, WorldMapId, WorldPoint } from '../domain';
import type { ArtManifestLoad, LocalArtStatus, TerrainArcKind, TerrainArcsLoad, TerrainManifestLoad } from '../infra/maps';
import { viewBoundsOn, type LayerId, type LayerStats, type MapCategoryId, type MapDescriptor, type MapStyle, type MapView, type UnplacedReason, type WorldBounds } from '../map/adapter';
import { groupDigits, RELIEF_OPACITY } from '../map/layers';
import { characterName } from './character-names';
import type { MapCategoryGroupId } from './map-categories';
import type { MapCategoryCounts } from './map-controller';
import type { FlightMasterModel, GiverLayerModel, QuestPointsModel } from './map-model';
import type { PlacesModel } from './map-places';
import type { QuestStateModel } from './quest-state';
import type { EditorState } from './store';
import { noStateText, withArticle } from './quest-state-text';

/**
 * The words of the Map layers drawer's notes (docs/research/map-presentation.md §25.3.3; MAP-HONEST-5;
 * step MP.4b): what each layer leaves out and why, and how the route line draws the walked legs. Only
 * the drawer reads them, and the drawer is a lazy part, so the words are too: the controller gathers
 * the facts (`MapNotesSource`) and asks this module for the sentences once the drawer has installed it
 * (`MapController.setWording`), keeping them out of the entry chunk (ui-refresh.md §10.3). Until then
 * a layer's notes are empty.
 */

/** Each drawer row's name (§25.3.2; `map-categories.ts` has the rows). */
export const MAP_CATEGORY_LABELS: Readonly<Record<MapCategoryId, string>> = {
  available: 'Available',
  'may-be-available': 'May be available',
  'needs-prerequisite': 'Needs a prerequisite',
  'unlocks-soon': 'Unlocks soon',
  'low-level': 'Low level',
  'turn-ins': 'Turn-ins',
  objectives: 'Objectives',
  dungeons: 'Dungeons',
  raids: 'Raids',
  'unconfirmed-raids': 'Unconfirmed raids (AQ20, AQ40, Naxxramas)',
  'flight-points': 'Flight points',
  'flight-network': 'Flight network',
  'all-flights': 'All flights when zoomed in',
  'transport-stops': 'Transport stops',
  portals: 'Portals',
  'other-faction-flights': 'Other faction’s flight points',
  innkeepers: 'Innkeepers',
  trainers: 'Class trainers',
  vendors: 'Vendors (dataset only)',
  'route-line': 'Route line',
  'step-numbers': 'Step numbers',
  'walking-paths': 'Walking paths',
  'zone-labels': 'Zone names and levels',
  // What the row draws (review PR-01): the terrain's zone outlines, in the painted style only; the minimap's shared land borders wait for the zone-borders byproduct (§25.4).
  'zone-borders': 'Zone outlines (painted style only)',
  'zone-faction': 'Zone faction',
  relief: 'Relief (painted style only)',
  coastline: 'Coastline (painted style only)',
  'coordinate-grid': 'Coordinate grid (zoomed in)',
};

/** Each group's heading (§25.3.2): "Quests" is headed "after step N" and "Services" "zoomed in" by the drawer. */
export const MAP_CATEGORY_GROUP_LABELS: Readonly<Record<MapCategoryGroupId, string>> = {
  quests: 'Quests',
  instances: 'Instances',
  travel: 'Travel',
  services: 'Services',
  'route-and-map': 'Route and map',
};

/** The art layer's note on what the tiles are (D-042 O11: the alterations the atlas NOTICE lists). */
export const ATLAS_TILES_NOTE =
  'One seamless atlas composed by this project from the painted zone maps, with the changes its notice lists: each painting masked to its terrain, nine painted labels hidden, a relief-shaded tint where no painting reaches, and the sea in painted-water colours.';

/** The art layer's note on the minimap tiles (D-045, D-049 O15: the alterations the minimap NOTICE lists). */
export const MINIMAP_TILES_NOTE =
  'One seamless atlas stitched by this project from the client’s minimap textures, with the changes its notice lists: the water recoloured to one navy, the textures resampled, and Zephras Isle in its box.';

/** The art layer's note on whose artwork it is (D-033 rule 2); the About dialog has the full notice. */
export const MAP_ART_OWNER_NOTE =
  'Blizzard Entertainment’s artwork (© Blizzard Entertainment, Inc.), extracted from the World of Warcraft: Forever client. This project is not affiliated with or endorsed by Blizzard Entertainment; About has the notice.';

/** What each terrain layer is (D-032). */
const TERRAIN_NOTES: Readonly<Record<'relief' | 'zone-outlines' | 'coastline', string>> = {
  relief: 'Shaded relief computed by this project from the client’s terrain heights (about 17 yd per pixel; D-032), not the painted art.',
  'zone-outlines':
    'Zone outlines from the client’s terrain areas (D-032), in the terrain grid’s steps and out over coastal water; not drawn at the world view. The minimap style draws no zone borders until its borders between land zones are built. A picture: points are still attributed by their published zone.',
  coastline: 'Shores of the sea, lakes and rivers from the client’s terrain liquids (D-032).',
};

/** What the art layer draws, for its notes. */
export type ArtNotesState =
  /** The local set (developer builds): its size and the images refused. */
  | { readonly kind: 'local'; readonly count: number; readonly refused: readonly (readonly [UiMapId, string])[] }
  /** The atlas's tiles, in the style drawn. */
  | { readonly kind: 'tiles'; readonly style: MapStyle | null }
  | { readonly kind: 'tiles-loading' }
  /** The committed painted art, one map at a time (or only Zephras Isle's card on the atlas); `unplaced` names the images that span several world maps. */
  | { readonly kind: 'committed'; readonly onAtlas: boolean; readonly unplaced: readonly string[] }
  | { readonly kind: 'loading' }
  | { readonly kind: 'none' };

/** The facts the notes are worded from, as the controller has them (its models are memoised there). */
export interface MapNotesSource {
  readonly character: EditorState['project']['character'];
  /** The quest state after the active step; null without route state. */
  readonly questState: QuestStateModel | null;
  /** "After step 14: " before a quest layer's first note with route state; empty when the model's step left the route. */
  readonly afterStep: string;
  /** That step's number; null without route state or when it left the route. */
  readonly afterStepNumber: number | null;
  /** The givers of the quests open by race and class (the notes without route state). */
  givers(): GiverLayerModel;
  /** The focused quests' objectives or turn-ins. */
  focusWork(layer: 'objectives' | 'turn-ins'): QuestPointsModel;
  flightMasters(): FlightMasterModel;
  /**
   * The places model (steps MP.5, MP.8, MP.9): the notes of the dungeons, flight points, flight
   * network and transports layers, and their rows' counts; null until the derived pipeline has built it.
   */
  readonly places?: PlacesModel | null;
  /** A quest's name in the dataset; null when it has none. */
  questName(id: QuestId): string | null;
  readonly art: ArtNotesState;
  /** The painted art is shown and drawn (the relief is faint under it, the frames unfilled). */
  readonly artUnder: boolean;
  /** The terrain manifest is loading. */
  readonly terrainLoading: boolean;
  /** An outline layer's arcs are loading on a shown map. */
  arcsLoading(layer: 'zone-outlines' | 'coastline'): boolean;
}

/** How many walked legs follow their paths, wait for them or have none (`LayerStats.paths`, less the legs outside the view never asked for). */
export interface WalkingPathCounts {
  readonly along: number;
  readonly pending: number;
  readonly fallback: number;
  readonly outside: number;
}

/**
 * What the controller asks of the drawer's lazy part: the notes' words, and the drawer's counts
 * (only the drawer shows them). Installed by the drawer, or given to the controller in tests.
 */
export interface MapWording {
  layerNotes(layer: LayerId, stats: LayerStats, source: MapNotesSource): readonly string[];
  /** The route line's walking paths; `counts` null while the paths are hidden or the line has no stats. */
  walkingPathNotes(counts: WalkingPathCounts | null): readonly string[];
  /** Why a layer cannot be shown now; null when it can (or while its data loads). */
  layerUnavailable(layer: LayerId, facts: MapResourceFacts): string | null;
  /** Map resources that could not be loaded, and what the map shows instead (the drawer's notices). */
  problems(facts: MapResourceFacts): readonly string[];
  /** The rows' counts (§25.3.3), with the last settled view's `inView`. */
  counts(source: MapNotesSource, inView: MapCategoryCounts['inView']): MapCategoryCounts;
  /** Per row, what the settled view `at` shows of it, from each pin layer's built items. */
  inView(at: MapView, itemsOf: (layer: InViewLayer) => readonly MapDescriptor[]): MapCategoryCounts['inView'];
}

/** The pin layers the "in view" counts read. */
export type InViewLayer = 'available-quests' | 'turn-ins' | 'objectives' | 'flight-masters' | 'dungeons' | 'transports' | 'services';

const plural = (n: number, one: string, many: string): string => `${groupDigits(n)} ${n === 1 ? one : many}`;

// Honest notes for a layer's counts (moved from map/layers with the drawer, step MP.4b)

const REASON_TEXT: Readonly<Record<UnplacedReason, string>> = {
  'no-geometry': 'on a map with no geometry',
  'outside-ui-rectangles': 'outside every map rectangle',
  'no-era-coefficients': 'in an Era frame with no conversion',
  'non-finite': 'with invalid coordinates',
  'instance-without-entrance': 'inside an instance with no known entrance',
  'unmapped-area': 'in an area no map shows',
  'destination-unknown': 'moving somewhere the route does not say',
};

/** A unit noun, singular and plural: `['point', 'points']`. */
export type StatsNoun = readonly [one: string, many: string];

/** What each `LayerStats` count of a layer counts. `aggregated` always counts points. */
export interface StatsUnits {
  /** `notDrawn`: descriptors cut by the cap. */
  readonly items: StatsNoun;
  /** `unresolved`. */
  readonly unplaced: StatsNoun;
  /** `otherSurfaces`. */
  readonly elsewhere: StatsNoun;
}

const SPAWN_UNITS: StatsUnits = { items: ['marker', 'markers'], unplaced: ['point', 'points'], elsewhere: ['point', 'points'] };
const LINE_UNITS: StatsUnits = {
  items: ['line piece or glyph', 'line pieces and glyphs'],
  unplaced: ['step', 'steps'],
  elsewhere: ['line or glyph', 'lines and glyphs'],
};
const uniform = (noun: StatsNoun): StatsUnits => ({ items: noun, unplaced: noun, elsewhere: noun });

/** The units of every layer's stats. */
export const LAYER_STATS_UNITS: Readonly<Record<LayerId, StatsUnits>> = {
  relief: uniform(['image', 'images']),
  art: uniform(['image', 'images']),
  coastline: uniform(['outline', 'outlines']),
  'zone-outlines': uniform(['outline', 'outlines']),
  'zone-fill': uniform(['zone fill', 'zone fills']),
  'zone-frames': uniform(['frame', 'frames']),
  'flight-network': uniform(['flight line', 'flight lines']),
  transports: { items: ['stop or route', 'stops and routes'], unplaced: ['stop', 'stops'], elsewhere: ['stop or route', 'stops and routes'] },
  'route-line': LINE_UNITS,
  services: SPAWN_UNITS,
  objectives: SPAWN_UNITS,
  'available-quests': SPAWN_UNITS,
  'turn-ins': SPAWN_UNITS,
  dungeons: uniform(['entrance', 'entrances']),
  'flight-masters': SPAWN_UNITS,
  'route-steps': { items: ['step marker', 'step markers'], unplaced: ['step', 'steps'], elsewhere: ['step', 'steps'] },
  proposal: LINE_UNITS,
  selection: { items: ['halo or leg', 'halos and legs'], unplaced: ['step', 'steps'], elsewhere: ['step', 'steps'] },
  labels: uniform(['label', 'labels']),
};

const nounFor = (n: number, noun: StatsNoun): string => (n === 1 ? noun[0] : noun[1]);

/**
 * Short sentences for a layer panel: what the layer leaves out and why, always with the unit, for
 * example `1,234 more markers not drawn: zoom in or pan to see them` or
 * `12 points not placed: 10 inside an instance with no known entrance, 2 in an area no map shows`.
 * `unit` is the layer (its `LAYER_STATS_UNITS`) or one noun for every count.
 */
export function layerStatsNotes(stats: LayerStats, unit: LayerId | StatsNoun): readonly string[] {
  const units = typeof unit === 'string' ? LAYER_STATS_UNITS[unit] : uniform(unit);
  const notes: string[] = [];
  if (stats.notDrawn > 0) notes.push(`${groupDigits(stats.notDrawn)} more ${nounFor(stats.notDrawn, units.items)} not drawn: zoom in or pan to see them`);
  if (stats.aggregated > 0) notes.push(`${plural(stats.aggregated, 'point', 'points')} shown as zone counts: zoom in to see them`);
  if ((stats.clustered ?? 0) > 0) notes.push(`${plural(stats.clustered ?? 0, 'point', 'points')} in clusters: zoom in to separate them`);
  if (stats.unresolved > 0) {
    const parts = Object.entries(stats.unresolvedBy).map(([reason, count]) => `${groupDigits(count ?? 0)} ${REASON_TEXT[reason as UnplacedReason]}`);
    notes.push(`${plural(stats.unresolved, ...units.unplaced)} not placed: ${parts.join(', ')}`);
  }
  if (stats.otherSurfaces > 0) notes.push(`${plural(stats.otherSurfaces, ...units.elsewhere)} on other world maps`);
  return notes;
}

function artNotes(art: ArtNotesState): string[] {
  switch (art.kind) {
    case 'local':
      return [
        `${groupDigits(art.count)} images in the local set; only those drawn at this level of detail are loaded and verified; never deployed.`,
        ...art.refused.map(([uiMapId, reason]) => `UiMap ${String(uiMapId)} art ${reason}.`),
      ];
    case 'tiles':
      return [MAP_ART_OWNER_NOTE, art.style === 'minimap' ? MINIMAP_TILES_NOTE : ATLAS_TILES_NOTE];
    case 'tiles-loading':
      return ['Loading the atlas tiles…'];
    case 'committed': {
      const notes = [
        MAP_ART_OWNER_NOTE,
        art.onAtlas
          ? 'The atlas tiles are not available: only Zephras Isle’s own map is drawn, on its card; the relief is the backdrop.'
          : 'Zoomed out, the continent map; zoomed in, the map of the zone being viewed, one at a time.',
      ];
      if (art.unplaced.length > 0) {
        notes.push(`${plural(art.unplaced.length, 'image spans', 'images span')} several world maps and ${art.unplaced.length === 1 ? 'is' : 'are'} not drawn (${art.unplaced.join(', ')}).`);
      }
      return notes;
    }
    case 'loading':
      return ['Loading the painted map art…'];
    case 'none':
      return [];
  }
}

/** A layer's notes (MAP-HONEST-5): what it draws from, and what it leaves out and why, with the unit. */
export function layerNotesOf(layer: LayerId, stats: LayerStats, source: MapNotesSource): readonly string[] {
  const notes: string[] = [];
  const afterStepNotes = (list: readonly string[]): string[] => list.map((note, i) => (i === 0 ? `${source.afterStep}${note}` : note));
  switch (layer) {
    case 'available-quests': {
      if (source.questState !== null) {
        notes.push(...afterStepNotes(source.questState.map.notes.givers));
        break;
      }
      const givers = source.givers();
      notes.push(`${noStateText(characterName(source.character))}: the givers of all ${groupDigits(givers.openQuests)} quests open by race and class.`);
      if (givers.itemStarted > 0) notes.push(`${groupDigits(givers.itemStarted)} start from an item: no map position.`);
      if (givers.noStarter > 0) notes.push(`${groupDigits(givers.noStarter)} have no starter in the dataset.`);
      if (givers.spawnlessGivers > 0) {
        const quests = givers.spawnlessQuests > 0 ? `: ${plural(givers.spawnlessQuests, 'quest has', 'quests have')} no giver marker` : '';
        notes.push(`${plural(givers.spawnlessGivers, 'quest giver has', 'quest givers have')} no spawn in the dataset${quests}.`);
      }
      break;
    }
    case 'objectives':
    case 'turn-ins': {
      const model = source.questState;
      if (model !== null) {
        notes.push(...afterStepNotes(layer === 'turn-ins' ? model.map.notes.turnIns : model.map.notes.objectives));
        if (layer === 'turn-ins') break;
      }
      const work = source.focusWork(layer);
      if (work.questIds.length === 0) notes.push('Select a quest step, or open a quest in Details, to see where its work is done.');
      else {
        const names = work.questIds.map((id) => source.questName(id) ?? `Quest ${String(id)}`);
        notes.push(`For ${names.length === 1 ? (names[0] ?? '') : `${groupDigits(names.length)} quests`}.`);
      }
      const [one, many] = layer === 'objectives' ? ['objective', 'objectives'] : ['turn-in', 'turn-ins'];
      if (work.noPosition > 0) notes.push(`${plural(work.noPosition, one, many)} ${work.noPosition === 1 ? 'has' : 'have'} no map position (reputation, spells, items without a listed source).`);
      if (work.spawnless > 0) notes.push(`${plural(work.spawnless, one, many)} ${work.spawnless === 1 ? 'has' : 'have'} no spawn in the dataset: not drawn.`);
      if (work.missingQuests > 0) notes.push(`${groupDigits(work.missingQuests)} quests are not in the dataset.`);
      break;
    }
    case 'flight-masters': {
      const places = source.places ?? null;
      if (places !== null) {
        notes.push(...places.notes['flight-masters']);
        break;
      }
      const model = source.flightMasters();
      if (model.otherFaction > 0) notes.push(`${groupDigits(model.otherFaction)} of the other faction not shown.`);
      if (model.factionUnknown > 0) notes.push(`${groupDigits(model.factionUnknown)} with an unknown faction are shown and say so.`);
      if (model.spawnless > 0) notes.push(`${plural(model.spawnless, 'flight master has', 'flight masters have')} no spawn in the dataset.`);
      break;
    }
    case 'art':
      notes.push(...artNotes(source.art));
      break;
    case 'relief':
    case 'zone-outlines':
    case 'coastline': {
      notes.push(TERRAIN_NOTES[layer]);
      if (layer === 'relief' && source.artUnder) notes.push(`Faint under the painted art (${String(Math.round(RELIEF_OPACITY.underArt * 100))}% opacity).`);
      if (source.terrainLoading) notes.push('Loading the terrain data…');
      if (layer !== 'relief' && source.arcsLoading(layer)) notes.push('Loading…');
      break;
    }
    case 'zone-frames':
      notes.push(
        source.artUnder
          ? 'Zone rectangles from the committed geometry, not zone borders; unfilled over the painted art.'
          : 'Schematic: zone rectangles from the committed geometry, not zone borders or terrain.',
      );
      break;
    // The places (steps MP.5, MP.8, MP.9, MP.11): their notes are the places model's.
    case 'dungeons':
    case 'flight-network':
    case 'transports':
      notes.push(...(source.places?.notes[layer] ?? ['Loading the client tables…']));
      break;
    case 'services':
      notes.push(...(source.places?.notes.services ?? ['Loading…']));
      break;
    case 'labels':
      notes.push(
        (source.places?.labels ?? null) === null
          ? 'Loading the zone names…'
          : `Zone and city names with the quest levels of each zone for ${withArticle(characterName(source.character))} (the dataset's Era quest levels, marked E; the new zones' announced levels); cards rate a zone's median quest level at the step. Dungeon and flight point names from zoom −4.3.`,
      );
      break;
    case 'zone-fill':
      notes.push(...(source.places?.zoneFill?.notes ?? ['Loading…']));
      break;
    // No notes of their own.
    case 'route-line':
    case 'route-steps':
    case 'proposal':
    case 'selection':
      break;
  }
  notes.push(...layerStatsNotes(stats, layer));
  return notes;
}

/** How the route line draws the walked legs on this surface. */
export function walkingPathNotesOf(counts: WalkingPathCounts | null): readonly string[] {
  const notes: string[] = ['Walked legs follow their walking paths; flight, transport and hearthstone legs stay straight.'];
  if (counts === null) return notes;
  const { along, pending, fallback, outside } = counts;
  notes.push(`${plural(along, 'walked leg follows its path', 'walked legs follow their paths')} on this map.`);
  if (pending > 0) notes.push(`${plural(pending, 'leg is', 'legs are')} straight, in short dashes, while ${pending === 1 ? 'its path is' : 'their paths are'} computed.`);
  if (fallback > 0) notes.push(`${plural(fallback, 'leg has', 'legs have')} no walking path: drawn straight, dash-dot-dot.`);
  if (outside > 0) notes.push(`${plural(outside, 'leg outside the view waits', 'legs outside the view wait')} to be computed until ${outside === 1 ? 'it comes' : 'they come'} into view.`);
  return notes;
}

/** The drawer's counts (map-presentation.md §25.3.3): the quest state's at the active step, else the quests open by race and class. */
export function categoryCountsOf(source: MapNotesSource, inView: MapCategoryCounts['inView']): MapCategoryCounts {
  const who = characterName(source.character);
  const placesModel = source.places ?? null;
  // The place rows count the places model's items once it is built (steps MP.5, MP.8, MP.9); the flight masters before that.
  const places = placesModel === null ? { 'flight-points': source.flightMasters().input.groups.length } : placesModel.counts;
  const flightsKnown = placesModel?.flightsKnown ?? null;
  const model = source.questState;
  if (model === null) return { afterStep: null, who, quests: { available: source.givers().openQuests }, availableGivers: null, ready: null, places, flightsKnown, inView };
  const rows = model.counts.rows;
  return {
    afterStep: source.afterStepNumber,
    who,
    quests: {
      available: rows.available,
      'may-be-available': rows['may-be-available'],
      'needs-prerequisite': rows['needs-prerequisite'],
      'unlocks-soon': rows['unlocks-soon'],
      'low-level': rows['low-level'],
      'turn-ins': rows['turn-ins'],
      objectives: model.counts.objectives,
    },
    availableGivers: model.counts.availableGivers,
    ready: model.counts.ready,
    places,
    flightsKnown,
    inView,
  };
}

const IN_VIEW_LAYERS: readonly InViewLayer[] = ['available-quests', 'turn-ins', 'objectives', 'flight-masters', 'dungeons', 'transports', 'services'];

/**
 * Per drawer row, what the settled view shows of it (§25.3.3's "k in view"): the quests of the
 * quest pins (a cluster's per member), the places of the other pins, counted from the layers built
 * for the view, at the view's rectangle on each shown map.
 */
export function inViewCountsOf(at: MapView, itemsOf: (layer: InViewLayer) => readonly MapDescriptor[]): MapCategoryCounts['inView'] {
  const out: Partial<Record<MapCategoryId, number>> = {};
  const add = (id: MapCategoryId, n: number): void => {
    out[id] = (out[id] ?? 0) + n;
  };
  const boundsOf = (mapId: WorldMapId): WorldBounds | null => viewBoundsOn(at, mapId);
  const inside = (point: WorldPoint): boolean => {
    const b = boundsOf(point.mapId);
    return b !== null && point.x >= b.xMin && point.x <= b.xMax && point.y >= b.yMin && point.y <= b.yMax;
  };
  for (const layer of IN_VIEW_LAYERS) {
    for (const item of itemsOf(layer)) {
      if (item.type !== 'marker' || item.category === undefined || !inside(item.point)) continue;
      const cluster = item.cluster;
      if (cluster !== undefined) {
        for (const member of cluster.members) add(member.category, 1);
        continue;
      }
      const quests = layer === 'available-quests' || layer === 'turn-ins' ? new Set(item.refs.flatMap((ref) => (ref.kind === 'spawn' ? ref.questIds : []))).size : item.count;
      add(item.category, quests);
    }
  }
  return out;
}

/** Why the layers not drawn yet are unavailable (their steps draw them). */
const LAYER_UNAVAILABLE: Partial<Readonly<Record<LayerId, string>>> = {
  proposal: 'No proposal is open (proposals arrive with the optimiser, Milestones 7 and 8)',
  // The presentation's new layers (map-presentation.md §5.2): their content arrives with their steps.
};

/** The map's resources as the controller has them, for the drawer's reasons and notices. */
export interface MapResourceFacts {
  /** The build has map resources (the committed art and terrain). */
  readonly resources: boolean;
  /** The local art set's status (developer builds); null for none. */
  readonly localArt: LocalArtStatus | null;
  readonly artManifest: ArtManifestLoad | null;
  readonly terrainManifest: TerrainManifestLoad | null;
  readonly shownMapIds: readonly WorldMapId[];
  /** The committed painted images of a world map. */
  committedArtOn(mapId: WorldMapId): number;
  /** An outline file's load; undefined when it was not asked for. */
  arcLoad(mapId: WorldMapId, kind: TerrainArcKind): 'loading' | TerrainArcsLoad | undefined;
  readonly onAtlas: boolean;
  readonly atlasMode: 'tiles' | 'loading' | 'refused' | 'local' | 'none';
  /** The atlas was asked for but cannot be placed from this geometry. */
  readonly atlasUnplaced: boolean;
  /** Why the chosen style's tiles failed; null when they did not. */
  readonly styleFailure: string | null;
  /** The chosen style's message when the other style is drawn in its place (§21.4); null otherwise. */
  readonly styleUnavailable: string | null;
  readonly layers: Readonly<Record<LayerId, boolean>>;
  /** The relief draws something. */
  readonly reliefDrawn: boolean;
  /** The places model, for why a place layer draws nothing (a client table failed); null or absent until it is built. */
  readonly places?: PlacesModel | null;
}

const TERRAIN_WHAT: Readonly<Record<TerrainArcKind, string>> = { zones: 'Zone outlines', coast: 'The coastline' };

/** The terrain arc file each outline layer draws. */
const OUTLINE_KIND: Readonly<Record<'zone-outlines' | 'coastline', TerrainArcKind>> = { 'zone-outlines': 'zones', coastline: 'coast' };

function artUnavailableOf(f: MapResourceFacts): string | null {
  if (f.localArt?.kind === 'listed') return null;
  if (f.onAtlas && f.atlasMode === 'tiles') return null;
  if (f.resources) {
    // Loading: nothing to say yet (the notes say it is loading).
    if (f.artManifest === null) return null;
    if (f.artManifest.kind === 'failed') return `Painted map art could not be loaded (${f.artManifest.detail})`;
    const maps = f.shownMapIds;
    return maps.length > 0 && maps.every((mapId) => f.committedArtOn(mapId) === 0) ? 'No painted art for this world map' : null;
  }
  if (f.localArt === null) return 'No local map set: the map shows zone frames, not terrain';
  switch (f.localArt.kind) {
    case 'none':
      return `No local map art (${f.localArt.detail})`;
    case 'refused':
      return `Local map art refused: ${f.localArt.detail}`;
  }
}

/** Why a terrain layer cannot be shown on the current world map; null when it can (or is still loading). */
function terrainUnavailableOf(layer: 'relief' | 'zone-outlines' | 'coastline', f: MapResourceFacts): string | null {
  if (!f.resources) return 'No terrain data in this build';
  const manifest = f.terrainManifest;
  if (manifest === null) return null;
  if (manifest.kind === 'failed') return `Terrain data could not be loaded (${manifest.detail})`;
  const shown = f.shownMapIds;
  if (shown.length === 0) return null;
  const maps = manifest.manifest.maps;
  // On the atlas the layer is available while any shown map has its data.
  const having = shown.filter((mapId) => {
    const map = maps.find((entry) => entry.mapId === mapId);
    return map !== undefined && (layer === 'relief' ? map.relief !== null : map[OUTLINE_KIND[layer]] !== null);
  });
  if (having.length === 0) return `No terrain data for this world map (it covers ${maps.map((entry) => entry.name).join(' and ')})`;
  if (layer === 'relief') return null;
  const kind = OUTLINE_KIND[layer];
  const failed = having.flatMap((mapId) => {
    const load = f.arcLoad(mapId, kind);
    return load !== undefined && load !== 'loading' && load.kind === 'failed' ? [load.detail] : [];
  });
  return failed.length === having.length && failed[0] !== undefined ? `${TERRAIN_WHAT[kind]} could not be loaded (${failed[0]})` : null;
}

/** Why a layer cannot be shown now (`MapWording.layerUnavailable`). */
export function layerUnavailableOf(layer: LayerId, f: MapResourceFacts): string | null {
  if (layer === 'art') return artUnavailableOf(f);
  if (layer === 'relief' || layer === 'zone-outlines' || layer === 'coastline') return terrainUnavailableOf(layer, f);
  if (layer === 'dungeons' || layer === 'flight-network' || layer === 'transports') return f.places?.unavailable[layer] ?? null;
  return LAYER_UNAVAILABLE[layer] ?? null;
}

/** Map resources that could not be loaded, and what the map shows instead (the drawer's notices). */
export function mapProblemsOf(f: MapResourceFacts): readonly string[] {
  const problems: string[] = [];
  if (f.atlasUnplaced) problems.push('The atlas could not be placed from this geometry: the map shows one world map at a time');
  if (!f.resources) return problems;
  if (f.onAtlas && f.atlasMode === 'refused') {
    problems.push(`The atlas tiles could not be used (${f.styleFailure ?? 'this build has no tile index'}): the map shows the terrain relief instead`);
  } else if (f.onAtlas && f.atlasMode === 'tiles' && f.styleUnavailable !== null) {
    problems.push(f.styleUnavailable);
  }
  const reliefShown = f.layers.relief && f.reliefDrawn;
  if (f.localArt?.kind !== 'listed' && f.artManifest?.kind === 'failed') {
    problems.push(`Painted map art could not be loaded: the map shows ${reliefShown ? 'the terrain relief' : 'zone frames'} instead`);
  }
  if (f.terrainManifest?.kind === 'failed') problems.push('Terrain data could not be loaded: no relief, zone outlines or coastline');
  const places = f.places ?? null;
  if (places?.taxi === 'failed') problems.push('The client taxi file could not be loaded: flights are timed as a straight line (TIME-5), with no flight network or transport stops');
  if (places?.dungeonTable === 'failed') problems.push('The client dungeon table could not be loaded: no dungeon entrances');
  for (const layer of ['zone-outlines', 'coastline'] as const) {
    const kind = OUTLINE_KIND[layer];
    const failed = f.shownMapIds.some((mapId) => {
      const load = f.arcLoad(mapId, kind);
      return load !== undefined && load !== 'loading' && load.kind === 'failed';
    });
    if (f.layers[layer] && failed) problems.push(`${TERRAIN_WHAT[kind]} could not be loaded`);
  }
  return problems;
}

/** The drawer's words and counts (installed with `MapController.setWording`). */
export const MAP_WORDING: MapWording = {
  layerNotes: layerNotesOf,
  walkingPathNotes: walkingPathNotesOf,
  layerUnavailable: layerUnavailableOf,
  problems: mapProblemsOf,
  counts: categoryCountsOf,
  inView: inViewCountsOf,
};
