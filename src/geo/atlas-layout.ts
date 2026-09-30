import { uiMapId, worldMapId, type UiMapId, type WorldMapId } from '../domain/ids';

/**
 * Where each world map sits on the atlas surface: the committed layout constant
 * (docs/research/map-atlas.md §5.2, §5.5; D-042 O9 and A9).
 *
 * The atlas is display only (D-017). One atlas unit is one yard; `E` grows east and `S` grows
 * south, and a world map is placed by translation only: `E = eOff − Y`, `S = sOff − X` (world `x`
 * north, `y` west). Atlas coordinates are never persisted and never used for a distance.
 *
 * The runtime, placeholder mode, the "index refused" fallback and `tools/maps/atlas.ts` all read
 * this constant, so none of them needs a fetch; `atlasPlacements` (atlas.ts) combines it with the
 * committed UiMap 947 rows, and the atlas index's `atlasHash` pins the result (check T4). It is not
 * geometry, so `mergeLocalGeometry`'s row checks are unaffected.
 *
 * Who may import it (map-atlas.md §8.1, MA-14): for values, only `map/adapter`, `map/layers`,
 * `infra`, `app`, tests, `atlas.ts` and `tools/`; every other module may import its types only
 * (tests/architecture.test.ts, the file-level rule). It is deliberately not re-exported from
 * `src/geo/index.ts`.
 */

/** `compact` is the owner's layout (D-042 O9); `uimap-947` is the game's own world-map layout, kept for comparison and for option O4. */
export type AtlasLayoutName = 'compact' | 'uimap-947';

/** A translation in atlas units (yards): whole multiples of 1,024 yd, one level −2 tile (D-042 A1). */
export interface AtlasShift {
  readonly e: number;
  readonly s: number;
}

/** A point in atlas units (yards; `e` east, `s` south). */
export interface AtlasPoint {
  readonly e: number;
  readonly s: number;
}

/** An axis-aligned rectangle in atlas units, edges included. */
export interface AtlasRect {
  readonly eMin: number;
  readonly eMax: number;
  readonly sMin: number;
  readonly sMax: number;
}

/**
 * A world map placed from its UiMap 947 (`UiMapAssignment`) row: the row's translation, then the
 * layout's shift.
 */
export interface AtlasPlacedSpec {
  readonly mapId: WorldMapId;
  /** Which side of `seamE` the map's land lies on; the partition gives the map every point on that side outside the insets. */
  readonly side: 'west' | 'east';
  /** Added to the 947 translation (map-atlas.md §5.2). */
  readonly shift: AtlasShift;
}

/**
 * A world map the client does not place on UiMap 947, shown as a card at the atlas scale (map-atlas.md
 * §5.5). Its world rectangle is its zone row's rectangle; the card's north-west corner (the row's
 * `xMax`, `yMax`) is drawn at `corner`.
 */
export interface AtlasInsetSpec {
  readonly mapId: WorldMapId;
  /** The zone UiMap whose row gives the rectangle (2521 Zephras Isle). */
  readonly uiMapId: UiMapId;
  /** Its `UiMapAssignment.ID` (69208 for 2521 at 1.60.1.70009). */
  readonly row: number;
  readonly corner: AtlasPoint;
  /** Why it is an inset, with the client build the reason was checked at. Provenance: not part of `atlasHash`. */
  readonly reason: string;
}

/** The world map (UiMap 947 Azeroth) whose rows give the base translation (map-atlas.md §3.1, §5.2). */
export interface AtlasWorldMapSpec {
  readonly uiMapId: UiMapId;
  /** The UiMap's art size in pixels: its `UiMapArtStyleLayer` (CITED). */
  readonly artWidth: number;
  readonly artHeight: number;
  /**
   * The world map whose 947 row sets the scale `K`, yards per 947 art pixel along `u`: Kalimdor's
   * row 46785, 44.78908 yd/px at 1.60.1.70009 (map-atlas.md §5.2).
   */
  readonly scaleMapId: WorldMapId;
  /** Where the art size comes from. Provenance: not part of `atlasHash`. */
  readonly source: string;
}

export interface AtlasLayout {
  readonly name: AtlasLayoutName;
  readonly worldMap: AtlasWorldMapSpec;
  /** The placed world maps, west first. */
  readonly placed: readonly AtlasPlacedSpec[];
  readonly insets: readonly AtlasInsetSpec[];
  /** Points outside every inset with `E ≤ seamE` belong to the `west` map, the rest to the `east` map (map-atlas.md §5.4). */
  readonly seamE: number;
  /** The raster's extent (tile (0, 0) starts at the origin at every level), card included (map-atlas.md §5.6). */
  readonly extent: AtlasRect;
  /** Why the values are what they are. Provenance: not part of `atlasHash`. */
  readonly basis: string;
}

const AZEROTH: AtlasWorldMapSpec = {
  uiMapId: uiMapId(947),
  artWidth: 1002,
  artHeight: 668,
  scaleMapId: worldMapId(1),
  source: 'UiMapArtStyleLayer row 1 (UiMapArtStyle 1, the style of UiMapArt 2141 for UiMap 947): 1002 x 668 px, build 1.60.1.70009 (CITED, docs/research/map-atlas.md §3.1)',
};

const KALIMDOR = worldMapId(1);
const EASTERN_KINGDOMS = worldMapId(0);

const ZEPHRAS_ISLE_REASON =
  'UiMap 947 has no UiMapAssignment row for MapID 2991 and UiMapLink has 0 records (build 1.60.1.70009), so the client does not place Zephras Isle on the world map; it is shown at the atlas scale, not in position (docs/research/map-atlas.md §5.5; D-042 O2)';

/**
 * The owner's layout (D-042 O9; map-atlas.md §5.2): both continents moved by (−3,072, −2,048) yd
 * from their 947 translation, the Eastern Kingdoms a further 7,168 yd west, leaving 0.39
 * Kalimdor widths of sea between them (MEASURED on the terrain, `.cache/map-atlas/revise/bbox2.mjs`).
 * Zephras Isle's card sits at the top of the gap.
 *
 * - `eOff`, `sOff` that result: Kalimdor 5,652 and 12,778; the Eastern Kingdoms 22,499 and 7,907;
 *   Zephras Isle 17,671.25 and 5,468.25 (its card spans E 13,440–19,002.5, S 512–4,220.3).
 * - `seamE` 16,617: midway between Kalimdor's east-most land (E 14,177) and the Eastern Kingdoms'
 *   west-most land (E 19,057), MEASURED on the terrain relief (`bbox2.mjs`).
 * - Extent E 0–30,720, S 0–26,112 (map-atlas.md §5.6): it holds both continents' land (MEASURED,
 *   `bbox2.mjs`; atlas.test.ts checks it against the committed coastline) and the card.
 */
export const ATLAS_LAYOUT_COMPACT: AtlasLayout = {
  name: 'compact',
  worldMap: AZEROTH,
  placed: [
    { mapId: KALIMDOR, side: 'west', shift: { e: -3072, s: -2048 } },
    { mapId: EASTERN_KINGDOMS, side: 'east', shift: { e: -3072 - 7168, s: -2048 } },
  ],
  insets: [{ mapId: worldMapId(2991), uiMapId: uiMapId(2521), row: 69208, corner: { e: 13440, s: 512 }, reason: ZEPHRAS_ISLE_REASON }],
  seamE: 16617,
  extent: { eMin: 0, eMax: 30720, sMin: 0, sMax: 26112 },
  basis:
    'D-042 O9 (owner): the compact layout of docs/research/map-atlas.md revision 2 §5.2. Shifts in whole 1,024-yd tiles (A1); seamE and the extent MEASURED on the terrain (map-atlas.md §5.2, §5.4, §5.6); the card position is a layout choice (§5.5).',
};

/**
 * The game's own world-map layout (map-atlas.md §5.2, revision 1): maps 0 and 1 at their 947
 * translation, Zephras Isle's card on a shelf below the world rectangle. Not the default (D-042
 * O9); kept so the layout choice stays measurable, and required if option O4 (the 947 painting at
 * the world band) is ever chosen.
 *
 * - `eOff`, `sOff`: Kalimdor 8,724 and 14,826; the Eastern Kingdoms 32,739 and 9,955; Zephras Isle
 *   5,255.25 and 35,676.25 (its card spans E 1,024–6,586.5, S 30,720–34,428.3).
 * - `seamE` 21,532: midway between Kalimdor's row edge (E 18,324) and the Eastern Kingdoms' row
 *   edge (E 24,739), rounded half up.
 * - Extent: the 947 art rectangle (1002 × 44.789 = 44,878.7 yd wide) and the shelf below it, each
 *   rounded up to a whole yard (E 0–44,879, S 0–34,429).
 */
export const ATLAS_LAYOUT_947: AtlasLayout = {
  name: 'uimap-947',
  worldMap: AZEROTH,
  placed: [
    { mapId: KALIMDOR, side: 'west', shift: { e: 0, s: 0 } },
    { mapId: EASTERN_KINGDOMS, side: 'east', shift: { e: 0, s: 0 } },
  ],
  insets: [{ mapId: worldMapId(2991), uiMapId: uiMapId(2521), row: 69208, corner: { e: 1024, s: 30720 }, reason: ZEPHRAS_ISLE_REASON }],
  seamE: 21532,
  extent: { eMin: 0, eMax: 44879, sMin: 0, sMax: 34429 },
  basis:
    'docs/research/map-atlas.md revision 2 §5.2, "947 layout": the UiMap 947 translation without shifts; the card below the world rectangle at E 1,024, S 30,720 (a layout choice).',
};

/** The layout the app draws: compact (D-042 O9). */
export const ATLAS_LAYOUT: AtlasLayout = ATLAS_LAYOUT_COMPACT;
