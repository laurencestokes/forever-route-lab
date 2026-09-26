/**
 * Fixed facts the map tools check against. Each value is cited where it is recorded.
 */

export const PRODUCT = 'wow_classic_beta';

/**
 * The QuestieDB input the placeholder reads. The pin itself (commit, repository, default checkout
 * and this file's SHA-256) comes only from tools/questiedb/upstream.json (lib/pin.ts).
 */
export const CONVERSION_PATH = 'data/Forever/conversion.json';

export const DB2_BUILD = '1.60.1.70009';
export const ROWS_FILE = 'tools/maps/inputs/db2-rows-1.60.1.70009.json';
export const PLACEHOLDER_DIR = 'public/maps/placeholder';
export const GEOMETRY_FILE = 'geometry.placeholder.json';
export const NOTICE_FILE = 'NOTICE.md';

/** D-018: the 11 UiMaps whose 12 rows come from the cited DB2 CSV (Azeroth 947 has two rows). */
export const DB2_ONLY_UIMAP_IDS: readonly number[] = [947, 1414, 1415, 1463, 1464, 2482, 2521, 2524, 2548, 2652, 2665];
/** MAPS.md §5.5 P2: their `UiMapAssignment.ID`s. */
export const DB2_ONLY_ASSIGNMENT_IDS: readonly number[] = [46724, 46725, 46774, 46775, 46784, 46785, 69032, 69208, 69219, 69323, 69778, 69852];

/** ARCHITECTURE §6: the four UiMaps whose frame differs between Era and Forever. */
export const ERA_CHANGED_UIMAP_IDS: readonly number[] = [1412, 1423, 1433, 1453];

/**
 * MAPS.md §5.6 reference: the frame hash of `conversion.json` `target_bounds` at QuestieDB commit
 * `REFERENCE_FRAME_COMMIT` (and of both Forever CSVs). P4 compares with it only when the placeholder
 * was built at that commit; after a pin bump the recomputed hash is the only check.
 */
export const REFERENCE_FRAME_COMMIT = 'b6f5b07b0acf1c820993cbb0ce2521c912bb4c92';
export const REFERENCE_FRAME_HASH = '2cb10551b1502b652e4d54922e8b3a1ecb48057fbfb7cf9c77863edd7efea78f';

/** Sizes of the committed placeholder (MAPS.md §5.5 P3): 49 + 11 UiMaps, 49 + 12 rows. */
export const EXPECTED_FRAME_UIMAPS = 49;
export const EXPECTED_UIMAPS = 60;
export const EXPECTED_ROWS = 61;

/**
 * The two research CSVs the rows file was written from (MAPS.md §8.3 inventory). Fetched from
 * wago.tools on 2026-09-25 as individual requests during research, not by scripted crawling;
 * never fetched by any tool (D-011).
 */
export interface ResearchCsv {
  readonly table: 'UiMapAssignment' | 'UiMap';
  readonly file: string;
  readonly url: string;
  readonly fetched: string;
  readonly obtained: string;
  readonly bytes: number;
  readonly rows: number;
  readonly sha256: string;
}

const OBTAINED = 'individual research request, not scripted (D-011)';

export const RESEARCH_CSVS: Readonly<Record<'UiMapAssignment' | 'UiMap', ResearchCsv>> = {
  UiMapAssignment: {
    table: 'UiMapAssignment',
    file: 'UiMapAssignment_1.60.1.70009.csv',
    url: 'https://wago.tools/db2/UiMapAssignment/csv?build=1.60.1.70009',
    fetched: '2026-09-25',
    obtained: OBTAINED,
    bytes: 6778,
    rows: 61,
    sha256: '79267e8be8034e47daab14350411b3acc0b1f64e86efc9d821a217497254ca0a',
  },
  UiMap: {
    table: 'UiMap',
    file: 'UiMap_1.60.1.70009.csv',
    url: 'https://wago.tools/db2/UiMap/csv?build=1.60.1.70009',
    fetched: '2026-09-25',
    obtained: OBTAINED,
    bytes: 3097,
    rows: 60,
    sha256: '1f4aac70eaac015b1d2d0ea0faf6e3d7fb2cf7afdf45e5bb6772d9b80a72346b',
  },
};

/** MAPS.md §8.3: the 12 rows' CSV lines, LF-joined in file order with a trailing LF. */
export const DB2_ROWS_RAW_LINES_SHA256 = '0aff6391a197d4ff33a2f56bd3388ca72f305a5543fc646682580437646870bb';

/** Default location of the research CSVs on the research machine (gitignored, local). */
export const DEFAULT_RESEARCH_CSV_DIR = '.cache/experiments/maps';

/**
 * Isotropy (coordinates.md §4.1; MAPS.md §3): every UiMap with 1002 × 668 art (style 1,
 * `UiMapArtStyleLayer` at 1.60.1.70009) has `(Ymax − Ymin)/(Xmax − Xmin)` = 1.5, scaled by the UI
 * rectangle for Azeroth's sub-rectangles. The three style-4 maps have 512 × 512 art: 1463 and 1464
 * have square regions (1.0); 2665 has a 1.5-aspect region on square art, so it is not isotropic
 * and has no expected aspect.
 */
export const ART_ASPECT_EXCEPTIONS: Readonly<Record<number, number | null>> = { 1463: 1, 1464: 1, 2665: null };
export const DEFAULT_ART_ASPECT = 1002 / 668;
export const ASPECT_TOLERANCE = 0.002;

/**
 * Art pixel sizes (`UiMapArtStyleLayer` LayerWidth × LayerHeight at 1.60.1.70009; MAPS.md §3,
 * §5.4; coordinates.md §4.1): 1002 × 668 for style 1, every UiMap except the three style-4 maps,
 * which are 512 × 512. L3 requires an art image to have its UiMap's size. Like the aspects above,
 * this is the placeholder's table until `import.ts --build` reads UiMapArtStyleLayer (Milestone 3b).
 */
export const DEFAULT_ART_SIZE: { readonly width: number; readonly height: number } = { width: 1002, height: 668 };
export const ART_SIZE_EXCEPTIONS: Readonly<Record<number, { readonly width: number; readonly height: number }>> = {
  1463: { width: 512, height: 512 },
  1464: { width: 512, height: 512 },
  2665: { width: 512, height: 512 },
};
