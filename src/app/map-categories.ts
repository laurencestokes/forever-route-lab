import { isMapCategoryId, MAP_CATEGORY_IDS, type LayerId, type MapCategoryId, type MapMask } from '../map/adapter';
import type { QuestRow } from './quest-state';

/**
 * The Map layers drawer's rows and groups (docs/research/map-presentation.md §25.3.2 to §25.3.4,
 * §25.3.7; D-047; step MP.4b), as data: which rows there are, their defaults, and how each applies.
 * Framework-agnostic and small, because the map panel (entry chunk) applies the rows at the first
 * mount; the drawer that shows them is a lazy part, and so are their names (`app/map-wording.ts`).
 *
 * How a row applies:
 * - `mask`: a pin category (`MarkerDescriptor.category`), hidden by the adapter's mask
 *   (`MapAdapter.setMask`), a redraw and never a rebuild. Unlocks soon and Low level, off by
 *   default, also join the quest givers' input only while shown (`questRowsShown`), so they cost
 *   no budget until then.
 * - `layers`: a whole layer, shown or hidden in the store's map view state (the route line, zone
 *   names, zone borders, zone faction, the painted style's relief and coastline, the flight network).
 * - `walking-paths`, `step-numbers`: the route line's walking paths, and the step numbers on the
 *   labels canvas.
 * - `grid`: the yard grid (`MapAdapter.setGrid`), drawn from the zone band.
 * - `mode`: a drawing rule the controller reads from the hidden rows (all flights when zoomed in,
 *   MP.8; the zone faction overlay, MP.10, whose layer also draws the fallback tint).
 */

export type MapCategoryGroupId = 'quests' | 'instances' | 'travel' | 'services' | 'route-and-map';

export const MAP_CATEGORY_GROUP_IDS: readonly MapCategoryGroupId[] = ['quests', 'instances', 'travel', 'services', 'route-and-map'];

export const isMapCategoryGroupId = (value: unknown): value is MapCategoryGroupId => typeof value === 'string' && (MAP_CATEGORY_GROUP_IDS as readonly string[]).includes(value);

export type MapCategoryApply =
  | { readonly kind: 'mask' }
  | { readonly kind: 'layers'; readonly layers: readonly LayerId[] }
  | { readonly kind: 'walking-paths' }
  | { readonly kind: 'step-numbers' }
  | { readonly kind: 'grid' }
  | { readonly kind: 'mode' };

export interface MapCategoryRow {
  readonly id: MapCategoryId;
  readonly group: MapCategoryGroupId;
  readonly defaultShown: boolean;
  readonly apply: MapCategoryApply;
  /**
   * The layer whose availability the row takes (unavailable while its layer is: dungeons before
   * MP.5, and so on); null for none.
   */
  readonly layer: LayerId | null;
}

const mask: MapCategoryApply = { kind: 'mask' };
const layers = (...ids: LayerId[]): MapCategoryApply => ({ kind: 'layers', layers: ids });

/** Every row in the drawer's order (§25.3.2). */
export const MAP_CATEGORY_ROWS: readonly MapCategoryRow[] = [
  { id: 'available', group: 'quests', defaultShown: true, apply: mask, layer: 'available-quests' },
  { id: 'may-be-available', group: 'quests', defaultShown: true, apply: mask, layer: 'available-quests' },
  { id: 'needs-prerequisite', group: 'quests', defaultShown: true, apply: mask, layer: 'available-quests' },
  { id: 'unlocks-soon', group: 'quests', defaultShown: false, apply: mask, layer: 'available-quests' },
  { id: 'low-level', group: 'quests', defaultShown: false, apply: mask, layer: 'available-quests' },
  { id: 'turn-ins', group: 'quests', defaultShown: true, apply: mask, layer: 'turn-ins' },
  { id: 'objectives', group: 'quests', defaultShown: true, apply: mask, layer: 'objectives' },
  { id: 'dungeons', group: 'instances', defaultShown: true, apply: mask, layer: 'dungeons' },
  { id: 'raids', group: 'instances', defaultShown: true, apply: mask, layer: 'dungeons' },
  { id: 'unconfirmed-raids', group: 'instances', defaultShown: false, apply: mask, layer: 'dungeons' },
  { id: 'flight-points', group: 'travel', defaultShown: true, apply: mask, layer: 'flight-masters' },
  { id: 'flight-network', group: 'travel', defaultShown: true, apply: layers('flight-network'), layer: 'flight-network' },
  { id: 'all-flights', group: 'travel', defaultShown: false, apply: { kind: 'mode' }, layer: 'flight-network' },
  { id: 'transport-stops', group: 'travel', defaultShown: true, apply: mask, layer: 'transports' },
  { id: 'portals', group: 'travel', defaultShown: true, apply: mask, layer: 'transports' },
  { id: 'other-faction-flights', group: 'travel', defaultShown: false, apply: mask, layer: 'flight-masters' },
  { id: 'innkeepers', group: 'services', defaultShown: true, apply: mask, layer: 'services' },
  { id: 'trainers', group: 'services', defaultShown: true, apply: mask, layer: 'services' },
  { id: 'vendors', group: 'services', defaultShown: true, apply: mask, layer: 'services' },
  { id: 'route-line', group: 'route-and-map', defaultShown: true, apply: layers('route-line'), layer: 'route-line' },
  { id: 'step-numbers', group: 'route-and-map', defaultShown: true, apply: { kind: 'step-numbers' }, layer: 'route-steps' },
  { id: 'walking-paths', group: 'route-and-map', defaultShown: true, apply: { kind: 'walking-paths' }, layer: null },
  { id: 'zone-labels', group: 'route-and-map', defaultShown: true, apply: layers('labels'), layer: 'labels' },
  { id: 'zone-borders', group: 'route-and-map', defaultShown: true, apply: layers('zone-outlines'), layer: 'zone-outlines' },
  // A drawing mode (MP.10): the zone-fill layer also draws the fallback tint, which the row must not hide.
  { id: 'zone-faction', group: 'route-and-map', defaultShown: false, apply: { kind: 'mode' }, layer: 'zone-fill' },
  { id: 'relief', group: 'route-and-map', defaultShown: true, apply: layers('relief'), layer: 'relief' },
  { id: 'coastline', group: 'route-and-map', defaultShown: false, apply: layers('coastline'), layer: 'coastline' },
  // The yard grid (MAPS §8.1; review PR-10): shown by default, drawn from the zone band only; the key keeps its note.
  { id: 'coordinate-grid', group: 'route-and-map', defaultShown: true, apply: { kind: 'grid' }, layer: null },
];


const ROW_BY_ID: ReadonlyMap<MapCategoryId, MapCategoryRow> = new Map(MAP_CATEGORY_ROWS.map((row) => [row.id, row]));

export const categoryRow = (id: MapCategoryId): MapCategoryRow | undefined => ROW_BY_ID.get(id);

/** The rows hidden by default: Unlocks soon, Low level, unconfirmed raids, all flights zoomed in, the other faction, zone faction, the coastline. */
export const DEFAULT_HIDDEN_CATEGORIES: readonly MapCategoryId[] = MAP_CATEGORY_ROWS.filter((row) => !row.defaultShown).map((row) => row.id);

/** The pin rows, the ones "Hide all" turns off (§25.3.4: every pin category; Route and map are left alone, so the route is never lost). */
export const PIN_CATEGORY_IDS: readonly MapCategoryId[] = MAP_CATEGORY_ROWS.filter((row) => row.group !== 'route-and-map' && row.apply.kind === 'mask').map((row) => row.id);

/** A hidden set in the rows' order, unknown ids and repeats dropped. */
export function normaliseHidden(ids: readonly unknown[]): readonly MapCategoryId[] {
  const wanted = new Set(ids.filter(isMapCategoryId));
  return MAP_CATEGORY_IDS.filter((id) => wanted.has(id));
}

/** "Show all": every category on, the ones off by default included. */
export const SHOW_ALL: readonly MapCategoryId[] = [];

/** "Hide all": the pin categories off, and Route and map as they are. */
export function hideAll(hidden: readonly MapCategoryId[]): readonly MapCategoryId[] {
  const routeAndMap = hidden.filter((id) => categoryRow(id)?.group === 'route-and-map');
  return normaliseHidden([...routeAndMap, ...PIN_CATEGORY_IDS]);
}

/** A group's check state from its rows (§25.3.8): every row shown, none, or mixed. */
export function groupState(group: MapCategoryGroupId, hidden: ReadonlySet<MapCategoryId>): boolean | 'mixed' {
  const rows = MAP_CATEGORY_ROWS.filter((row) => row.group === group);
  const shown = rows.filter((row) => !hidden.has(row.id)).length;
  return shown === rows.length ? true : shown === 0 ? false : 'mixed';
}

/** The hidden set after a group's checkbox is pressed: every row of it shown, or every row hidden. */
export function setGroup(hidden: readonly MapCategoryId[], group: MapCategoryGroupId, show: boolean): readonly MapCategoryId[] {
  const rows = MAP_CATEGORY_ROWS.filter((row) => row.group === group).map((row) => row.id);
  return normaliseHidden(show ? hidden.filter((id) => !rows.includes(id)) : [...hidden, ...rows]);
}

/** The hidden set after one row is shown or hidden. */
export function setCategory(hidden: readonly MapCategoryId[], id: MapCategoryId, show: boolean): readonly MapCategoryId[] {
  return normaliseHidden(show ? hidden.filter((entry) => entry !== id) : [...hidden, id]);
}

/** The adapter's mask for a hidden set (and a search's filter): the pin categories only. */
export function maskOf(hidden: readonly MapCategoryId[], only: MapMask['only'] = null): MapMask {
  return { hidden: hidden.filter((id) => categoryRow(id)?.apply.kind === 'mask'), only };
}

/** The quest-state rows whose givers the layer draws (`QuestStateModel.giversFor`): the three drawn by default, and Unlocks soon and Low level while shown. */
export function questRowsShown(hidden: ReadonlySet<MapCategoryId>): ReadonlySet<QuestRow> {
  const rows = new Set<QuestRow>(['available', 'may-be-available', 'needs-prerequisite']);
  if (!hidden.has('unlocks-soon')) rows.add('unlocks-soon');
  if (!hidden.has('low-level')) rows.add('low-level');
  return rows;
}

/** Each layer a `layers` row shows or hides, with whether it is shown. */
export function layerVisibility(hidden: ReadonlySet<MapCategoryId>): ReadonlyMap<LayerId, boolean> {
  const out = new Map<LayerId, boolean>();
  for (const row of MAP_CATEGORY_ROWS) if (row.apply.kind === 'layers') for (const layer of row.apply.layers) out.set(layer, !hidden.has(row.id));
  return out;
}
