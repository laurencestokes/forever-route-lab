import type { WorldMapId } from '../domain/ids';
import type { WorldPoint } from '../domain/points';
import { isFullUiRectangle } from '../geo/transforms';
import { attributeZone } from '../geo/zones';
import type { MapGeometry } from '../geo/types';
import { poleOf } from '../geo/pole';
import { zoneRingsOf, type ZoneRings } from '../geo/zone-rings';
import type { LabelDescriptor, PlaceLayerInput } from '../map/adapter';
import { LAYER_BAND_EDGES, surfacesOf } from '../map/layers';
import type { EffectiveRules } from '../rules/precedence';
import { UNDERGROUND_CITIES, undergroundName, zoneCardOf, zoneRating, type ZoneSpans } from './zone-levels';

/**
 * The names on the map's labels canvas (docs/research/map-presentation.md §13, §25.4; map-atlas.md
 * §22; D-049 O19; step MP.7), as plain `LabelDescriptor`s in world coordinates, built in the lazy
 * derived pipeline with the places (the map only keeps those of its view and band, places them and
 * draws them):
 *
 * - **Zones and cities**: every UiMap with a level span (`zoneSpans`), anchored at the pole of
 *   inaccessibility of its terrain rings (the D-032 zone arcs, `src/geo/pole.ts`), or at its frame's
 *   centre where the terrain has none of its area (Ironforge, the Undercity, Zephras Isle). Each has
 *   its card (`zoneCardOf`: the span with its basis, the cited text of the new zones, and the
 *   difficulty twin's input: the median quest level rated at the character's level after the step).
 *   The adapter draws the compact line to 0.05 px per yard, the card to the zone band, and the 13 px
 *   zone label to about 0.3 (zoom −1.75), beyond which the "Viewing" chip names the zone.
 * - **Underground cities** (D-049 O19; map-atlas.md §22): in the minimap style, whose picture shows
 *   only Ironforge's gate and the ruins of Lordaeron, their labels read "Ironforge (underground
 *   city)" and "Undercity (underground city)" (and the frames layer draws their frames dashed from
 *   the zone band). The painted style keeps its city plans, so the names stay plain there.
 * - **Continent names** at the continent frames' centres, at the world band only (§5.4: no continent
 *   painting is drawn, so `BaseMapLabels.continents` is always false).
 * - **Place names** of the places model's dungeon entrances and flight points (the character's side),
 *   from 0.05 px per yard, next to their pins. Each carries its zone (`uiMapId`), so the adapter
 *   leaves it out where that zone's painted art is drawn legibly and names it itself
 *   (`BaseMapLabels.places`, §13.5; review PR-12).
 *
 * **Static priority** (§13.2): continents, then levelling zones by frame area, then cities, then
 * dungeons, then flight points. It never depends on the selection or the route, so an edit never
 * moves a label.
 */

/** Zone labels are drawn to about zoom −1.75 (§13.5), where the "Viewing" chip takes over. */
export const ZONE_LABEL_MAX_PX = 2 ** -1.75;
/** Place names are drawn from this scale (§5.4: "names from 0.05"). */
export const PLACE_LABEL_MIN_PX = 0.05;

/** The six capitals (the committed UiMap rows 1453–1458, map-atlas.md §22). */
export const CITY_UIMAPS: readonly number[] = [1453, 1454, 1455, 1456, 1457, 1458];

/** The underground cities (D-049 O19), defined with the zone spans that carry their minimap name. */
export { UNDERGROUND_CITIES, undergroundName } from './zone-levels';

/** The priority tiers (§13.2), each above every label of the tier below. */
const TIER = { continent: 6_000_000, zone: 4_000_000, city: 3_000_000, dungeon: 2_000_000, flight: 1_000_000 } as const;
/** Within the zone and city tiers, frame area in units of 10,000 square yards (at most 999,999). */
const AREA_UNIT = 10_000;

export interface MapLabelsInput {
  readonly geometry: MapGeometry;
  readonly spans: ZoneSpans;
  /** The character's level after the active step, for the cards' twin; null without route state. */
  readonly level: { readonly level: number; readonly lowerBound: boolean } | null;
  readonly rules: EffectiveRules;
  /** Zone anchors per world map, by AreaTable id (`zoneAnchorsOf`); empty until the terrain arcs are in. */
  readonly anchors: ReadonlyMap<WorldMapId, ReadonlyMap<number, WorldPoint>>;
  /** The places model's dungeon entrances and flight points; null while it is not built. */
  readonly dungeons: PlaceLayerInput | null;
  readonly flightPoints: PlaceLayerInput | null;
}

/** The labels per base style: the minimap's name the underground cities (D-049 O19). */
export interface MapLabels {
  readonly painted: readonly LabelDescriptor[];
  readonly minimap: readonly LabelDescriptor[];
}

/** The terrain zone rings of one world map, and each area's pole of inaccessibility. */
export interface ZoneShapes {
  readonly mapId: WorldMapId;
  readonly rings: readonly ZoneRings<WorldPoint>[];
  readonly anchors: ReadonlyMap<number, WorldPoint>;
}

/** One world map's zone rings (from its zone arc file) and the poles the zone labels are anchored at. */
export function zoneShapesOf(mapId: WorldMapId, lines: readonly (readonly WorldPoint[])[], sides: readonly (readonly [number, number])[]): ZoneShapes {
  const rings = zoneRingsOf(lines, sides);
  const anchors = new Map<number, WorldPoint>();
  for (const entry of rings) {
    const pole = poleOf(entry.rings);
    if (pole !== null) anchors.set(entry.areaId, { mapId, x: Math.round(pole.x), y: Math.round(pole.y) });
  }
  return { mapId, rings, anchors };
}

const byId = (a: LabelDescriptor, b: LabelDescriptor): number => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** The labels of both styles, sorted by id (the adapter places them by priority). */
export function buildMapLabels(input: MapLabelsInput): MapLabels {
  const painted: LabelDescriptor[] = [];
  const minimap: LabelDescriptor[] = [];
  const both = (label: LabelDescriptor): void => {
    painted.push(label);
    minimap.push(label);
  };

  // Continents (§5.4): the world band only.
  for (const surface of surfacesOf(input.geometry)) {
    if (surface.extentSource !== 'continent') continue;
    const e = surface.extent;
    both({
      type: 'label',
      id: `continent:${String(surface.mapId)}`,
      point: { mapId: surface.mapId, x: (e.xMin + e.xMax) / 2, y: (e.yMin + e.yMax) / 2 },
      kind: 'continent',
      text: surface.name,
      card: null,
      priority: TIER.continent,
      minPxPerYard: 0,
      maxPxPerYard: LAYER_BAND_EDGES.continent,
      label: null,
      ref: { kind: 'surface', mapId: surface.mapId },
    });
  }

  // Zones and cities (§13.3 to §13.5).
  for (const [uiMapId, span] of input.spans) {
    const map = input.geometry.maps.get(uiMapId);
    const [row] = map?.assignments ?? [];
    if (map === undefined || row === undefined || !isFullUiRectangle(row)) continue;
    const city = CITY_UIMAPS.includes(uiMapId);
    const area = (row.xMax - row.xMin) * (row.yMax - row.yMin);
    const point = input.anchors.get(row.mapId)?.get(row.areaId) ?? { mapId: row.mapId, x: (row.xMin + row.xMax) / 2, y: (row.yMin + row.yMax) / 2 };
    const rating = input.level === null ? null : zoneRating(span, input.level.level, input.level.lowerBound, input.rules);
    const labelOf = (name: string): LabelDescriptor => ({
      type: 'label',
      id: `zone:${String(uiMapId)}`,
      point,
      kind: 'zone',
      text: name,
      card: zoneCardOf(name, uiMapId, span, rating),
      priority: (city ? TIER.city : TIER.zone) + Math.min(999_999, Math.round(area / AREA_UNIT)),
      minPxPerYard: 0,
      maxPxPerYard: ZONE_LABEL_MAX_PX,
      label: null,
      ref: { kind: 'zone', uiMapId },
    });
    const plain = labelOf(map.name);
    painted.push(plain);
    minimap.push(UNDERGROUND_CITIES.includes(uiMapId) ? labelOf(undergroundName(map.name)) : plain);
  }

  // Place names (§5.4): dungeon entrances, then the side's flight points, from 0.05 px per yard.
  const places = (layer: PlaceLayerInput | null, tier: number): void => {
    for (const item of layer?.items ?? []) {
      const descriptor = item.descriptor;
      if (descriptor.type !== 'marker' || item.name === undefined || item.name === '' || descriptor.category === 'other-faction-flights') continue;
      // The place's zone, whose painted art may carry its name (§13.5; review PR-12).
      const zone = attributeZone(descriptor.point, null, input.geometry)?.uiMapId;
      both({
        type: 'label',
        id: `place:${descriptor.id}`,
        point: descriptor.point,
        kind: 'place',
        text: item.name,
        card: null,
        priority: tier,
        minPxPerYard: PLACE_LABEL_MIN_PX,
        maxPxPerYard: null,
        label: null,
        ref: descriptor.ref,
        ...(zone === undefined ? {} : { uiMapId: zone }),
      });
    }
  };
  places(input.dungeons, TIER.dungeon);
  places(input.flightPoints, TIER.flight);

  return { painted: painted.sort(byId), minimap: minimap.sort(byId) };
}
