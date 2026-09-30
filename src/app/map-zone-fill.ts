import type { UiMapId, WorldMapId } from '../domain/ids';
import type { WorldPoint } from '../domain/points';
import { isFullUiRectangle } from '../geo/transforms';
import type { MapGeometry } from '../geo/types';
import type { ClientZones } from '../infra/maps/client-tables';
import type { ZoneTints } from '../infra/maps/tints';
import type { MapRef, ZoneFillDescriptor, ZonePattern } from '../map/adapter';
import type { ZoneShapes } from './map-labels';

/**
 * The map's zone fills (docs/research/map-presentation.md §12.4, §12.6; D-039 C; D-041 H; step
 * MP.10), built in the lazy derived pipeline from the terrain zone rings (D-032), the committed zone
 * tints (`public/maps/tint/`, generated from the painted art) and the committed client zone table
 * (`AreaTable.FactionGroupMask` and the sanctuary flag, INFERRED decodes):
 *
 * - **The fallback tint**: each zone's tint over its rings. The map draws it only where the painted
 *   art fails §12.3 (where the relief is the backdrop), never over the painted atlas tiles, which
 *   carry the same tint where no painting shows, and never in the minimap style (§25.4).
 * - **The faction overlay** (off by default): a pattern per zone, never a hue, with its words in the
 *   hover: 2 "Alliance territory" (`/`), 4 "Horde territory" (`\`), 6 "Alliance and Horde (client
 *   value 6)" (both), 0 "No faction territory in the client (contested or unset)" (none: never called
 *   contested from the mask alone), the sanctuary flag "Sanctuary (client flag)" (dots). A zone the
 *   client table does not list is not drawn and is counted in the notes.
 */

export interface ZoneFillModel {
  /** The tints, one per zone with rings and a tint; empty without the tint file. */
  readonly tint: readonly ZoneFillDescriptor[];
  /** The faction overlay, one per zone with rings and a client row; empty without the client zone table. */
  readonly faction: readonly ZoneFillDescriptor[];
  /** The layer's notes (MAP-HONEST-5). */
  readonly notes: readonly string[];
}

export interface ZoneFillInput {
  readonly geometry: MapGeometry;
  readonly shapes: ReadonlyMap<WorldMapId, ZoneShapes>;
  /** The client zone table, or null while it loads or when it failed (with why). */
  readonly zones: ClientZones | null;
  readonly zonesFailure: string | null;
  readonly tints: ZoneTints | null;
  readonly tintsFailure: string | null;
}

/** The words of a mask value (§12.6). */
export function factionWords(mask: number, sanctuary: boolean): { readonly pattern: ZonePattern; readonly words: string } {
  if (sanctuary) return { pattern: 'sanctuary', words: 'Sanctuary (client flag)' };
  if (mask === 2) return { pattern: 'alliance', words: 'Alliance territory' };
  if (mask === 4) return { pattern: 'horde', words: 'Horde territory' };
  if (mask === 6) return { pattern: 'both', words: 'Alliance and Horde (client value 6)' };
  return { pattern: 'none', words: mask === 0 ? 'No faction territory in the client (contested or unset)' : `Client value ${String(mask)}, not decoded` };
}

const plural = (n: number, one: string, many: string): string => `${n.toLocaleString('en-GB')} ${n === 1 ? one : many}`;

export function buildZoneFill(input: ZoneFillInput): ZoneFillModel {
  // Each terrain area's UiMap (the one full-rectangle row naming it) and name.
  const uiMaps = new Map<string, { readonly uiMapId: UiMapId; readonly name: string }>();
  for (const map of input.geometry.maps.values()) {
    const [row] = map.assignments;
    if (map.assignments.length !== 1 || row === undefined || row.areaId <= 0 || !isFullUiRectangle(row)) continue;
    uiMaps.set(`${String(row.mapId)}:${String(row.areaId)}`, { uiMapId: map.uiMapId, name: map.name });
  }
  const client = new Map((input.zones?.zones ?? []).map((zone) => [`${String(zone.mapId)}:${String(zone.areaId)}`, zone]));
  const tint: ZoneFillDescriptor[] = [];
  const faction: ZoneFillDescriptor[] = [];
  let unlisted = 0;
  let untinted = 0;
  for (const [mapId, shapes] of [...input.shapes].sort((a, b) => a[0] - b[0])) {
    for (const zone of shapes.rings) {
      const key = `${String(mapId)}:${String(zone.areaId)}`;
      const ui = uiMaps.get(key) ?? null;
      const row = client.get(key) ?? null;
      const name = ui?.name ?? row?.name ?? `Area ${String(zone.areaId)}`;
      const ref: MapRef = ui === null ? { kind: 'terrain', layer: 'zone-outlines', mapId } : { kind: 'zone', uiMapId: ui.uiMapId };
      const rings: readonly (readonly WorldPoint[])[] = zone.rings;
      const colour = input.tints?.byArea.get(key);
      if (colour !== undefined) tint.push({ type: 'zone-fill', id: `tint:${key}`, mapId, areaId: zone.areaId, rings, fill: { tint: colour }, label: null, ref });
      else if (input.tints !== null) untinted += 1;
      if (row === null) {
        if (input.zones !== null) unlisted += 1;
        continue;
      }
      const { pattern, words } = factionWords(row.factionGroupMask, row.sanctuary);
      const label = `${name}: ${words} (client AreaTable FactionGroupMask ${String(row.factionGroupMask)}${row.sanctuary ? ', sanctuary flag' : ''}; an INFERRED decode)`;
      faction.push({ type: 'zone-fill', id: `faction:${key}`, mapId, areaId: zone.areaId, rings, fill: { pattern }, label, ref, words });
    }
  }
  const notes: string[] = [
    'Zone faction (optional, off by default): hatching / for Alliance territory, \\ for Horde territory, both for the client value 6, dots for a sanctuary, none for no faction territory in the client; the words are in each zone’s hover. From the client’s AreaTable FactionGroupMask and sanctuary flag (INFERRED decodes). Drawn zoomed out, over the zones’ terrain outlines.',
    'The fallback tint (a picture, not a signal): each zone’s mean painted colour, drawn only where no painted art is shown, never in the minimap style.',
  ];
  if (input.zonesFailure !== null) notes.push(`The client zone table could not be used (${input.zonesFailure}): no faction overlay.`);
  else if (input.zones === null) notes.push('Loading the client zone table…');
  if (input.tintsFailure !== null) notes.push(`The zone tints could not be used (${input.tintsFailure}): no fallback tint.`);
  if (input.shapes.size === 0) notes.push('Loading the terrain zone outlines…');
  if (unlisted > 0) notes.push(`${plural(unlisted, 'area has', 'areas have')} no client zone row: no faction drawn.`);
  if (untinted > 0) notes.push(`${plural(untinted, 'area has', 'areas have')} no tint (no painted pixel).`);
  return { tint, faction, notes };
}
