/**
 * Every parameter of the atlas composition (docs/research/map-atlas.md revision 2 §6, §7; D-042),
 * as the revision-2 prototype measured them (`.cache/map-atlas/revise/proto2.mjs`, the recommended
 * build `out-ru12`). The manifest records all of them, so a change to any value is visible in the
 * committed files and needs the owner's contact-sheet sign-off again (D-042 O8).
 *
 * Units: yards unless named `…Px` (source pixels of a 1002 × 668 painting).
 */

/** The painting size every atlas source has (UiMapArtStyleLayer style 1, 1.60.1.70009; CITED). */
export const ART_W = 1002;
export const ART_H = 668;

/** Tile size in pixels, and the stored levels (map-atlas.md §7.1). */
export const TILE = 256;
export const MIN_LEVEL = -8;
export const MAX_LEVEL = 0;
/** The composed level: 4 yd/px (§6.2). Coarser levels are its exact 2×2 reductions (§6.3). */
export const BASE_LEVEL = -2;

export const ATLAS_PARAMS = {
  /** Detail band half-width (§6.2 `oH`), colour band half-width (`oL`), low-pass sigma of the colour band. */
  detailBandYd: 24,
  colourBandYd: 200,
  lowPassSigmaYd: 64,
  /** Coastal band: a painting fades out over sea between these distances from land. */
  coastYd: [150, 300],
  /** Fallback weight of a painting's painted ground outside its polygon (`10⁻³·pa`). */
  fallbackWeight: 1e-3,
  /** Frame interior: `smoothstep(18, 30, e) · smoothstep(85, 97, c)` in source px. */
  framePx: [18, 30],
  cornerPx: 85,
  /** The narrower interior a label drawn whole may use (§6.5 rule 1): edges 6→10 px, corners 40 px. */
  labelFramePx: [6, 10],
  labelCornerPx: 40,
  /** City blend half-width (§6.2 step 5, §6.4). */
  cityBandYd: 40,
  /** Ironforge and Undercity cards: torn edge and ramp in source px (corners 80 px). */
  cardTornPx: 14,
  cardRampPx: 40,
  cardCornerPx: 80,
  /** The fallback tint (map-presentation §12.4): HSL saturation cap and lightness clamp. */
  tintMaxSaturation: 0.29,
  tintLightness: [0.38, 0.72],
  /** Relief shading of the tint: `f = clamp(1 + k·(g − g_med), lo, hi)`. */
  reliefK: 0.6,
  reliefClamp: [0.6, 1.25],
  /** The tint field's blur: three normalised box passes of this radius in relief cells (≈ 70 yd). */
  tintBlurRadiusCells: 4,
  tintBlurPasses: 3,
  /** The neutral tint where no area has a colour: `tint(rgb(176, 154, 108))`. */
  neutralTintSource: [176, 154, 108],
  /** A mean colour needs more than this many samples (§6.2 step 3). */
  tintMinSamples: 50,
  /** Overlay alpha ramp that counts as painted ground (§6.2 `pa`). */
  paintedAlpha: [0.35, 0.85],
  /** Hidden-label box feather (source px); fine levels recompose the box feathered three times as wide. */
  hideFeatherPx: 4,
  /** Whole-label box feather (source px), and the margin its atlas bounds are widened by. */
  wholeFeatherPx: 4,
  wholeMarginPx: 6,
  /** Continent painting: land where R − B > 95, dilated by 4 source px (≈ 145 yd) (§6.2 step 2; `contland.mjs`, MEASURED). */
  continentLandRMinusB: 95,
  continentLandDilatePx: 4,
  /** Sea: painted water up to 300 yd from kept land, the deep colour from 900 yd (§6.2 step 1). */
  deepSeaYd: [300, 900],
  /** Fine levels: a recomposed tile blends into its nearest stored ancestor over 0–200 yd inside a fine source. */
  fineBlendYd: 200,
  /** The O10 round-up: a source is stored one level finer when the nearest level is coarser than its art by more than this. */
  roundUp: 1.2,
  /** Top stored level given to the tint and to the coastal water gradient (the sparse rule, §7.1). */
  tintTopLevel: -4,
  seaGradientTopLevel: -5,
  /** A pixel counts toward a tile's top level when its coverage is above this (§7.1). */
  presenceAlpha: 0.03,
  /** Fine tile sets around the capital banners (yards) at level −1. */
  bannerTileMarginYd: 64,
} as const;

/**
 * The sea (D-042 O3, owner): painted water at the coast, rgb(131, 118, 88), the per-channel median
 * of the zone paintings' pixels over terrain sea (MEASURED; the build re-measures it and records the
 * value), deepening to rgb(61, 55, 41) offshore (the same hue and saturation at HSL lightness 0.20).
 * The deep colour is the map container's background and the index's sea colour.
 */
export const SEA_COAST: readonly [number, number, number] = [131, 118, 88];
export const SEA_DEEP: readonly [number, number, number] = [61, 55, 41];
export const SEA_DEEP_LIGHTNESS = 0.2;

/** The terrain relief's water colour (tools/terrain byproducts palette index 1). */
export const RELIEF_WATER: readonly [number, number, number] = [96, 128, 160];

/**
 * City paintings (map-atlas.md §6.1): four with a terrain polygon (drawn over it at levels −1 and 0,
 * and as a filler on land at −2 and coarser), and two interior maps drawn as cards (Ironforge 1455,
 * Undercity 1458). The client has no "city" type; this list is the design's.
 */
export const CITY_UIMAPS: readonly number[] = [1453, 1454, 1455, 1456, 1457, 1458];

/**
 * A zone painting that also draws its capital: the capital's terrain area joins the zone's polygon
 * (Durotar/Orgrimmar 1637, Mulgore/Thunder Bluff 1638, Teldrassil/Darnassus 1657, Elwynn/Stormwind 1519).
 */
export const ZONE_CAPITAL_AREA: Readonly<Record<number, number>> = { 1411: 1637, 1412: 1638, 1429: 1519, 1438: 1657 };

/** The contrast criterion of §9.2 (D-042 O3): land/sea at the world band at least 2.5:1. */
export const CONTRAST_MIN = 2.5;

/** Budgets (D-042 O5): the folder, one file, and each level within its baseline + 10 %. */
export const ATLAS_BUDGET_GZIP_BYTES = 8_000_000;
export const ATLAS_FILE_CAP_GZIP_BYTES = 32_000;

/**
 * The tool directories whose tree ids the atlas manifest records, as the art manifest does. The
 * placements the tool takes from `src/geo/atlas.ts` are recorded as values, with their `atlasHash`.
 */
export const ATLAS_TOOL_DIRS: readonly string[] = ['tools/casc', 'tools/maps'];

/**
 * The census values T7 compares a build with (docs/research/map-atlas.md §6.5, §6.6, §7.5): the
 * coverage census of the reviewed build (percentages of terrain land per world map; a build may
 * differ by 0.5 percentage points) and the lettering detector's candidate count, which changes only
 * when a painting or the detector does (then the contact sheet is reviewed again).
 *
 * Coverage: MEASURED on the build the owner reviews (ATL.6). With the revision-2 label list it
 * equals the prototype's recommended build (`out-ru12`, §6.6) to the last digit; the whole rule
 * added in ATL.6 for the ORGRIMMAR banner's letters moves Kalimdor's own share from 85.61 to 85.65 %,
 * its painted fallback from 1.96 to 1.93 % and its tint from 12.25 to 12.24 %. Candidates: 208 by
 * the prototype's detector, 210 with the Dun Morogh pass (atlas-detect.ts `snow`).
 */
export const ATLAS_CENSUS_RECORDED = {
  coverage: {
    '0': { ownPct: 85.49, neighbourPct: 0.65, tintPct: 13.19, droppedPct: 0.67 },
    '1': { ownPct: 85.65, neighbourPct: 1.93, tintPct: 12.24, droppedPct: 0.18 },
  },
  letteringCandidates: 210,
} as const;
