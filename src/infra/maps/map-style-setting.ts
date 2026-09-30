import { isMapCategoryId, isMapStyle, type MapCategoryId, type MapStyle } from '../../map/adapter';

/**
 * The map's settings kept in this browser (docs/research/map-presentation.md §25.3.7;
 * docs/research/map-atlas.md §21.3; steps MP.4b and MM.7): one record, `{ version: 1, style,
 * hidden, drawerOpen, collapsed }`, for the base map's style, the Map layers drawer's hidden rows,
 * whether the drawer was left open, and its collapsed groups. View settings, not project data: not
 * in the project file, not exported and not undone by Ctrl+Z; the search text is not kept.
 *
 * It is one `localStorage` key, in the pattern of the theme and of the shell's own preferences
 * (`forever-route-lab:shell`), not the IndexedDB `settings` store the design names: the drawer
 * decides at its first render whether it is open, and a synchronous read gives that answer before
 * the map draws (the store's read is asynchronous). Every access is guarded: private windows,
 * blocked storage and quota errors leave the choice for this page load only. An absent or unreadable
 * record gives the defaults, field by field; an unknown id is dropped. The style the atlas step kept
 * under `forever-route-lab:map-style` (MM.1) is read when the record has none, and never written.
 */

/** The record's `localStorage` key. */
export const MAP_LAYERS_STORAGE_KEY = 'forever-route-lab:map-layers';

/** The key the map style was kept under before the record (read once, when the record has no style). */
export const MAP_STYLE_STORAGE_KEY = 'forever-route-lab:map-style';

/** What the setting needs of `Storage`. */
export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** The record as read: null for a field that was never stored (the caller's default applies). */
export interface MapLayersRecord {
  readonly version: 1;
  readonly style: MapStyle | null;
  readonly hidden: readonly MapCategoryId[] | null;
  readonly drawerOpen: boolean | null;
  /** The drawer's collapsed groups, as stored (the drawer checks them). */
  readonly collapsed: readonly string[];
}

export const EMPTY_MAP_LAYERS_RECORD: MapLayersRecord = { version: 1, style: null, hidden: null, drawerOpen: null, collapsed: [] };

/** Reads and writes the chosen style (the map controller's view of the record). */
export interface MapStyleSetting {
  /** The stored style; null when none is stored, or it is not a style, or the storage cannot be read. */
  read(): MapStyle | null;
  /** Stores a style the user chose (a fallback is never written, map-atlas.md §21.3). */
  write(style: MapStyle): void;
}

/** The whole record (the Map layers drawer's view of it). */
export interface MapLayersSetting {
  read(): MapLayersRecord;
  /** Merges fields into the stored record (the others kept). */
  write(patch: Partial<Omit<MapLayersRecord, 'version'>>): void;
  /** The style part, for the map controller. */
  readonly style: MapStyleSetting;
}

function parse(text: string | null): MapLayersRecord {
  if (text === null) return EMPTY_MAP_LAYERS_RECORD;
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return EMPTY_MAP_LAYERS_RECORD;
  }
  if (typeof raw !== 'object' || raw === null) return EMPTY_MAP_LAYERS_RECORD;
  const r = raw as Partial<Record<keyof MapLayersRecord, unknown>>;
  return {
    version: 1,
    style: isMapStyle(r.style) ? r.style : null,
    hidden: Array.isArray(r.hidden) ? r.hidden.filter(isMapCategoryId) : null,
    drawerOpen: typeof r.drawerOpen === 'boolean' ? r.drawerOpen : null,
    collapsed: Array.isArray(r.collapsed) ? r.collapsed.filter((value): value is string => typeof value === 'string') : [],
  };
}

/** The record over `storage` (called at each access, so a storage that throws on access is caught). */
export function createMapLayersSetting(storage: () => KeyValueStorage | null): MapLayersSetting {
  const readRecord = (): MapLayersRecord => {
    try {
      const store = storage();
      const record = parse(store?.getItem(MAP_LAYERS_STORAGE_KEY) ?? null);
      if (record.style !== null) return record;
      const legacy = store?.getItem(MAP_STYLE_STORAGE_KEY) ?? null;
      return isMapStyle(legacy) ? { ...record, style: legacy } : record;
    } catch {
      return EMPTY_MAP_LAYERS_RECORD;
    }
  };
  const write = (patch: Partial<Omit<MapLayersRecord, 'version'>>): void => {
    try {
      const store = storage();
      if (store === null) return;
      const current = parse(store.getItem(MAP_LAYERS_STORAGE_KEY));
      const next = { ...current, ...patch, version: 1 as const };
      // Only what was ever chosen is written: a field left null keeps its default.
      const stored: Record<string, unknown> = { version: 1 };
      if (next.style !== null) stored['style'] = next.style;
      if (next.hidden !== null) stored['hidden'] = next.hidden;
      if (next.drawerOpen !== null) stored['drawerOpen'] = next.drawerOpen;
      if (next.collapsed.length > 0) stored['collapsed'] = next.collapsed;
      store.setItem(MAP_LAYERS_STORAGE_KEY, JSON.stringify(stored));
    } catch {
      // Not stored: the choice holds for this page load.
    }
  };
  return {
    read: readRecord,
    write,
    style: {
      read: () => readRecord().style,
      write: (style) => {
        write({ style });
      },
    },
  };
}

/** The style part alone over `storage` (the record's `style`, with the earlier key read as a fallback). */
export function createMapStyleSetting(storage: () => KeyValueStorage | null): MapStyleSetting {
  return createMapLayersSetting(storage).style;
}
