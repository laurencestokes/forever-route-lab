import type { Rgb } from './minimap-texels';

/**
 * Every parameter of the minimap tile set (docs/research/map-atlas.md revision 3.1, Part II §18,
 * §19, §24; D-045, D-049), as one frozen record the manifest stores (check M10). The values are the
 * revision 3.1 prototype's `P31` (`rule3.ts`, the signed-off build `b5`), restated per step of §19.2;
 * the prototype's switches between revisions are gone, only the chosen rule is here. A change to any
 * value needs the owner's contact-sheet sign-off again (O18).
 */

// ---------------------------------------------------------------------------------------------
// Files (§18.1, §23.3)

export const MINIMAP_DIR = 'public/maps/minimap';
export const MINIMAP_INDEX_FILE = 'index.json';
export const MINIMAP_MANIFEST_FILE = 'manifest.json';
export const MINIMAP_NOTICE_FILE = 'NOTICE.md';
/** The pointer to the release-asset tile pack (§23.3); not listed in the manifest (it names the pack, which holds the manifest). */
export const MINIMAP_POINTER_FILE = 'pack.json';
/** The tiles' folder: gitignored, filled by this tool or by the pack (§23.3, D-049 O14). */
export const MINIMAP_TILES_DIR = 't';
export const MINIMAP_TILE_TEMPLATE = 't/{z}/{x}/{y}.webp';
/** Tile paths: `t/<z>/<x>/<y>.webp`, `z` from −8 to 0. */
export const MINIMAP_TILE_PATH = /^t\/(-[1-8]|0)\/(0|[1-9]\d*)\/(0|[1-9]\d*)\.webp$/;
/** The tool's entry: its module closure is the manifest's tool tree hash (tools/terrain `toolTreeHash`). */
export const MINIMAP_TOOL_ENTRY = 'tools/maps/minimap.ts';
/** The pack's contents, in order: the notice first, so a copy of the pack carries it (D-033 rule 2, MM-06). */
export const PACK_CONTENTS: readonly string[] = ['NOTICE.md', 'manifest.json', 't/'];

// ---------------------------------------------------------------------------------------------
// Maps (§17.1, §18.2)

/**
 * The phase maps with their own minimaps that are never read (D-045 addendum: only the default
 * phase is drawn). None matches map 0's minimap at the same position (MEASURED by the probe).
 */
export const PHASE_MAPS_NOT_DRAWN: readonly { readonly mapId: number; readonly reason: string }[] = [
  { mapId: 2868, reason: 'a phase of the Eastern Kingdoms (12 minimap tiles); only the default phase is drawn (D-045 addendum)' },
  { mapId: 2980, reason: 'a phase of the Eastern Kingdoms (16 minimap tiles); only the default phase is drawn (D-045 addendum)' },
  { mapId: 2959, reason: 'a phase of the Eastern Kingdoms (25 minimap tiles); only the default phase is drawn (D-045 addendum)' },
];

/**
 * The minimap tiles per map at the pinned build 1.60.1.70009 (MEASURED by the probe's raw MAID walk,
 * `.cache/minimap-probe-final.json`): recorded, not assumed. The build records the counts it finds,
 * and check M4 reports any change.
 */
export const RECORDED_TILE_COUNTS: Readonly<Record<string, number>> = { '1': 988, '0': 736, '2991': 72 };

/** The only minimap texture the tool accepts (§18.2 step 3): BLP2, DXT1, no alpha, 512 × 512. */
export const MINIMAP_BLP = { encoding: 'dxt1', alphaBits: 0, width: 512, height: 512 } as const;

// ---------------------------------------------------------------------------------------------
// Pyramid (§18.2 steps 6-8, §18.4)

export const MINIMAP_TILE = 256;
export const MINIMAP_MIN_LEVEL = -8;
export const MINIMAP_MAX_LEVEL = 0;
/** The stored base: level 0, 1 yd per pixel; every coarser level is its exact 2 × 2 reduction. */
export const MINIMAP_BASE_LEVEL = 0;
/** The minimap style's underlay (§24.5, MM-09): level −6, 4 tiles. */
export const MINIMAP_UNDERLAY_LEVEL = -6;
/** The stitch works per level −4 block: 4,096 × 4,096 pixels of level 0. */
export const STITCH_BLOCK = 4096;

/** The navy (§19.3): the sea keys', the container's and the index's sea colour. */
export const NAVY: Rgb = [13, 27, 48];

// ---------------------------------------------------------------------------------------------
// The recolour (§19.2, §19.7)

export const RECOLOUR = {
  /** Step 4: the ramp's ends. */
  navy: NAVY,
  shallow: [60, 92, 130] as Rgb,
  /** Step 1: `warm = smoothstep(−6, 2, b − r)`. */
  warm: [-6, 2],
  /** Step 1: `chroma = smoothstep(3, 8, max(g, b) − r)`. */
  chroma: [3, 8],
  /** Step 1: `cap = 1 − smoothstep(90, 130, L)`: bright ponds, ice and foam keep their colour. */
  lumaCap: [90, 130],
  /** Step 1: `hue = 1 − smoothstep(36, 44, b − g)`: water bluer than both families (the violet river) keeps its colour. */
  hue: [36, 44],
  /** Step 2: the gate is 1 on a wet quad and within 1 quad of one, 0 from 2 quads (chamfer 1, √2). */
  gateQuads: [1, 2],
  /** Step 3: the family field: b − g clamped, two box passes of this radius over the tile's own wet texels, then smoothstep. */
  familyClamp: [-8, 28],
  familyRadius: 12,
  familyStep: [2, 18],
  /** Step 3: the two families' open-sea luma (rgb 8, 16, 16 and 27, 51, 71) and their dead zones. */
  darkLuma: 0.2126 * 8 + 0.7152 * 16 + 0.0722 * 16,
  navyFamilyLuma: 0.2126 * 27 + 0.7152 * 51 + 0.0722 * 71,
  darkDeadZone: 6,
  navyDeadZone: 20,
  /** Step 4: `t = smoothstep(0, 60, L − ref)`. */
  rampSpan: 60,
  /** Step 4: the family feather, in texels from an edge whose neighbour's family differs. */
  familyFeather: 96,
  /** Step 7: the edge feather: fade length, bands, the water test (weight ≥ 230/255), the Gaussian along the edge and its taper. */
  edgeFeather: 128,
  edgeBand: 4,
  edgeWaterWeight: 230,
  edgeWindow: 24,
  edgeSigma: 8,
  edgeTaper: [0.05, 0.5],
  /** Step 8: the corner term's blocks (8 × 8 texels, at least half water) and the smallest correction applied. */
  cornerBlock: 8,
  cornerMinCorrection: 0.25,
  /** Step 9: the navy floor for texels recoloured at weight ≥ 252/255 (0.99). */
  floorWeight: 252,
  /** Step 6: the haze flood: through luma below 64, up to 192 texels, fading over the last 32; coverage L/64. */
  hazeLuma: 64,
  hazeMax: 192,
  hazeFade: 32,
  /** §18.6: the edge skirts (see `minimap-recolour.ts` `edgeSkirts`). */
  skirtDepth: 32,
  skirtMinDryShare: 0.5,
  skirtTopColours: 3,
  skirtTopShare: 0.9,
  skirtNextWetShare: 0.9,
} as const;

type Widen<T> = T extends number ? number : T extends readonly [number, number] ? readonly [number, number] : T;
/** The recolour's parameters with their types widened, so a test can vary one. */
export type RecolourParams = { readonly [K in keyof typeof RECOLOUR]: Widen<(typeof RECOLOUR)[K]> };

/** §18.3, A13: Lanczos-3 from 25/24 yd texels to the atlas grid (24 texels span exactly 25 pixels). */
export const RESAMPLE = { kernel: 'lanczos3', radius: 3, period: { pixels: 25, texels: 24 } } as const;

// ---------------------------------------------------------------------------------------------
// The census gates (§19.5; the build fails on any) and the independent seam measure

export const SEAM_MEASURE = {
  /** Levels −1 to −3 of the built pyramid; 8-px bands A2 A1 | B1 B2. */
  levels: [-1, -2, -3],
  band: 8,
  /** Edges with at least 3 wet rows count; "long" ones have at least 16. */
  minRows: 3,
  longRows: 16,
  thresholds: [2, 4, 8],
} as const;

export const CENSUS_GATES = {
  /** Native 16-texel wet blocks whose luma SD more than doubles (`sd' > 2 sd + 2`): at most 0.2 %. */
  amplifiedShareMax: 0.002,
  /** Water-to-water brightness inversions: at most 0.1 % of pairs. */
  inversionShareMax: 0.001,
  /** Dry-quad texels brightened by more than 1.5 luma: none. */
  dryBrightenedMax: 0,
  /** Fully dry shore cells 8+ levels bluer: at most 0.1 %. */
  dryShoreBluerShareMax: 0.001,
  /** Long ADT edges over 8 levels at each of levels −1 to −3 (independent measure): at most 12 per map. */
  longSeamsOver8Max: 12,
  /** Relief water cells recoloured (mean weight ≥ 0.5): at least 97 %; land cells recoloured: at most 0.05 %. */
  waterRecolouredMin: 0.97,
  landRecolouredMax: 0.0005,
  /** World-band contrast at level −5 by Part I's method (O17): at least 2.0:1. */
  contrastMin: 2.0,
} as const;

// ---------------------------------------------------------------------------------------------
// Budgets (§24.1; D-049)

export interface MinimapBudget {
  readonly totalGzipBytes: number;
  readonly perTileGzipBytes: number;
  readonly tolerance: number;
  readonly levelBaselines: Readonly<Record<string, number>>;
}

export const MINIMAP_BUDGET: MinimapBudget = {
  /** The whole folder, gzip-6, decimal. */
  totalGzipBytes: 60_000_000,
  perTileGzipBytes: 32_000,
  /** Each level within its baseline + 10 % (the signed-off `b5`, WebP q80, MEASURED). */
  tolerance: 0.1,
  levelBaselines: { '0': 35_287_305, '-1': 10_919_395, '-2': 3_857_349, '-3': 1_251_623, '-4': 340_719, '-5': 82_819, '-6': 21_374, '-7': 5_971, '-8': 2_034 },
};
