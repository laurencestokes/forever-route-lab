import type { QuestId, UiMapId } from '../domain';
import { LAYER_IDS, type LayerId, type SurfaceId } from '../map/adapter';
import type { LodLevel } from '../map/layers';
import type { Selection } from './selection';
import type { EditorStore } from './store';

/**
 * The map's part of the editor's view state (docs/ARCHITECTURE.md §7, §12.1; docs/UI.md §12):
 * which surface is shown, the zoom band, the visible layers, whether the route follows walking
 * paths, and the zone last jumped to. Framework-agnostic, not persisted, never part of undo history.
 *
 * The map adapter reports `surface` and `zoomBand` (the map controller writes them from its
 * events); the layer panel writes `layers` and `walkingPaths`; jump-to-zone writes `zone`, and the
 * controller clears it once the user pans the zone out of view or switches surface. What the
 * pointer is over is not here:
 * it changes on every marker the pointer crosses, and every panel that reads the store would
 * re-render for it, so the map controller keeps it (`MapController.getHover`, M3 review PERF-14).
 * Updates go through `patchMapUi`, which returns the current object when nothing changes, so an
 * unchanged patch never notifies the store's subscribers.
 */

export interface MapUiState {
  /** The surface the map shows (as the adapter reported it), or null before the map first mounts. */
  readonly surface: SurfaceId | null;
  /** Level of detail at the current zoom (`zone` at or above map/layers' zone zoom); null before the map mounts. */
  readonly zoomBand: LodLevel | null;
  /** Layer visibility, by layer. */
  readonly layers: Readonly<Record<LayerId, boolean>>;
  /**
   * Whether the route line follows walking paths where the navigation model gives them (MAPS
   * §7.4). A toggle of the layer panel, not a layer: off, every leg is drawn as a straight line.
   */
  readonly walkingPaths: boolean;
  /**
   * The zone the user last jumped to: its frame is drawn emphasised and its quest points raw at any
   * zoom. Null for none, and again once the zone is panned out of view or the surface changes.
   */
  readonly zone: UiMapId | null;
}

/** Layers hidden until the user shows them: the coastline (terrain-navigation.md §13.2 makes it optional; UI.md §12). */
const HIDDEN_BY_DEFAULT: readonly LayerId[] = ['coastline'];

/**
 * Every layer visible but the coastline: painted art, relief and zone outlines on (UI.md §12). The
 * proposal layer is empty until proposals exist (Milestone 8).
 */
export const DEFAULT_MAP_LAYERS: Readonly<Record<LayerId, boolean>> = Object.fromEntries(
  LAYER_IDS.map((layer) => [layer, !HIDDEN_BY_DEFAULT.includes(layer)]),
) as Record<LayerId, boolean>;

export const DEFAULT_MAP_UI: MapUiState = { surface: null, zoomBand: null, layers: DEFAULT_MAP_LAYERS, walkingPaths: true, zone: null };

const sameLayers = (a: Readonly<Record<LayerId, boolean>>, b: Readonly<Record<LayerId, boolean>>): boolean =>
  a === b || LAYER_IDS.every((layer) => a[layer] === b[layer]);

export type MapUiPatch = Partial<MapUiState>;

/** `current` with `patch` applied, or `current` itself when the patch changes nothing (layers compare by value). */
export function patchMapUi(current: MapUiState, patch: MapUiPatch): MapUiState {
  const next: MapUiState = { ...current, ...patch };
  const unchanged =
    next.surface === current.surface &&
    next.zoomBand === current.zoomBand &&
    next.zone === current.zone &&
    next.walkingPaths === current.walkingPaths &&
    sameLayers(next.layers, current.layers);
  if (unchanged) return current;
  return { ...next, layers: sameLayers(next.layers, current.layers) ? current.layers : next.layers };
}

/** `current` with one layer shown or hidden (`current` itself when it already is). */
export function withLayerVisible(current: MapUiState, layer: LayerId, visible: boolean): MapUiState {
  if (current.layers[layer] === visible) return current;
  return patchMapUi(current, { layers: { ...current.layers, [layer]: visible } });
}

// Quests opened in Details --------------------------------------------------------------------

/**
 * Quests the user opened in Details (from a quest-giver, objective or turn-in marker on the map,
 * or from the Available tab), remembered with the selection they were opened under: Details shows
 * them while the selection is that same object, and the active step again once the selection
 * changes (the pattern of the route list's active row).
 */
export interface OpenedQuests {
  readonly questIds: readonly QuestId[];
  readonly selection: Selection;
}

/** The opened quests to show now, or null when none are open or the selection has moved on since. */
export function shownOpenedQuests(opened: OpenedQuests | null, selection: Selection): readonly QuestId[] | null {
  return opened !== null && opened.selection === selection && opened.questIds.length > 0 ? opened.questIds : null;
}

/** Quest ids ascending without repeats (the order Details lists them in). */
export function normaliseQuestIds(ids: readonly QuestId[]): readonly QuestId[] {
  return [...new Set(ids)].sort((a, b) => a - b);
}

/** Opens quests in Details (and switches to the Details tab); an empty list does nothing. */
export function openQuestsInDetails(store: EditorStore, ids: readonly QuestId[]): void {
  if (ids.length === 0) return;
  store.setView({ openedQuests: { questIds: normaliseQuestIds(ids), selection: store.getState().selection }, rightTab: 'details' });
}

/** Closes the opened quests: Details shows the active step again. */
export function closeOpenedQuests(store: EditorStore): void {
  store.setView({ openedQuests: null });
}

/** Writes a map view-state patch; nothing happens (and nobody is notified) when it changes nothing. */
export function setMapUi(store: EditorStore, patch: MapUiPatch): void {
  const current = store.getState().view.map;
  const next = patchMapUi(current, patch);
  if (next !== current) store.setView({ map: next });
}

/** Shows or hides one map layer. */
export function setMapLayerVisible(store: EditorStore, layer: LayerId, visible: boolean): void {
  const current = store.getState().view.map;
  const next = withLayerVisible(current, layer, visible);
  if (next !== current) store.setView({ map: next });
}

/** Turns walking paths on the route line on or off. */
export function setMapWalkingPaths(store: EditorStore, on: boolean): void {
  setMapUi(store, { walkingPaths: on });
}
