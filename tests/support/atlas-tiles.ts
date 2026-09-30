import type { AtlasExtent, AtlasTileIndex, AtlasTileLevel, MapStyle, TileBandDescriptor } from '../../src/map/adapter';
import type { UiMapId } from '../../src/domain/ids';

/**
 * A small, synthetic atlas tile index for the tile tests (docs/research/map-atlas.md §7.2): levels
 * −8 to 0 over an extent, each level's grid sized as `tools/maps/lib/atlas-index.ts` sizes it, with
 * the stored and sea keys a test lists. Bitmaps are built by arithmetic (D-012), bit `y·nx + x` as
 * bit `k mod 8` of byte `floor(k / 8)`, and also returned as base64 JSON for the parser's tests.
 *
 * `style: 'minimap'` gives the minimap index's shape (§18.4, §21.1): a sea bitmap at every level
 * (`baseLevel` 0), `underlayLevel` −6, the navy #0d1b30 for both sea colours and no `uiMaps`; every
 * key the test does not list as stored is sea, as the minimap tool writes it (no virtual key).
 */

export type Keys = Readonly<Partial<Record<number, readonly (readonly [number, number])[]>>>;

export interface SyntheticIndexOptions {
  readonly hash?: string;
  readonly extent?: AtlasExtent;
  readonly stored: Keys;
  /** Painted only: the sea keys (the minimap's are every key not stored). */
  readonly sea?: Keys;
  /** Default `painted`. */
  readonly style?: MapStyle;
}

/** The minimap style's navy (map-atlas.md §19.3). */
export const MINIMAP_NAVY: readonly [number, number, number] = [13, 27, 48];

export const TEST_EXTENT: AtlasExtent = { eMin: 0, eMax: 30720, sMin: 0, sMax: 26112 };
export const TEST_HASH = '0123456789abcdef0123456789abcdef';
const MIN_LEVEL = -8;
const MAX_LEVEL = 0;
const BASE_LEVEL = -2;

function bitmap(nx: number, ny: number, keys: readonly (readonly [number, number])[]): Uint8Array {
  const bytes = new Uint8Array(Math.ceil((nx * ny) / 8));
  const seen = new Set<number>();
  for (const [x, y] of keys) {
    const k = y * nx + x;
    if (seen.has(k)) continue;
    seen.add(k);
    const at = Math.floor(k / 8);
    bytes[at] = (bytes[at] ?? 0) + 2 ** (k % 8);
  }
  return bytes;
}

/** The grid of level `z` over `extent` (as the tool sizes it: whole tiles covering the extent). */
export function gridOf(extent: AtlasExtent, z: number): { readonly nx: number; readonly ny: number } {
  const yards = 256 * 2 ** -z;
  return { nx: Math.max(1, Math.ceil(extent.eMax / yards)), ny: Math.max(1, Math.ceil(extent.sMax / yards)) };
}

/** Every key of an `nx` × `ny` grid not in `keys`. */
function complement(nx: number, ny: number, keys: readonly (readonly [number, number])[]): (readonly [number, number])[] {
  const listed = new Set(keys.map(([x, y]) => y * nx + x));
  const out: (readonly [number, number])[] = [];
  for (let y = 0; y < ny; y += 1) for (let x = 0; x < nx; x += 1) if (!listed.has(y * nx + x)) out.push([x, y]);
  return out;
}

export function syntheticIndex(options: SyntheticIndexOptions): AtlasTileIndex {
  const extent = options.extent ?? TEST_EXTENT;
  const minimap = options.style === 'minimap';
  const baseLevel = minimap ? MAX_LEVEL : BASE_LEVEL;
  const levels: AtlasTileLevel[] = [];
  for (let z = MIN_LEVEL; z <= MAX_LEVEL; z += 1) {
    const { nx, ny } = gridOf(extent, z);
    const stored = options.stored[z] ?? [];
    const sea = minimap ? complement(nx, ny, stored) : (options.sea?.[z] ?? []);
    levels.push({ z, nx, ny, stored: bitmap(nx, ny, stored), sea: z <= baseLevel ? bitmap(nx, ny, sea) : null });
  }
  return {
    hash: options.hash ?? TEST_HASH,
    tileSize: 256,
    minLevel: MIN_LEVEL,
    maxLevel: MAX_LEVEL,
    baseLevel,
    underlayLevel: minimap ? -6 : -5,
    seaColour: minimap ? MINIMAP_NAVY : [61, 55, 41],
    coastColour: minimap ? MINIMAP_NAVY : [131, 118, 88],
    extent,
    levels,
    uiMaps: new Map<UiMapId, { readonly topLevel: number; readonly ydPerPx: number }>(minimap ? [] : [[1411 as UiMapId, { topLevel: -2, ydPerPx: 5.277 }]]),
  };
}

const toBase64 = (bytes: Uint8Array): string => Buffer.from(bytes).toString('base64');

/** The index as `index.json` holds it (what `parseAtlasIndex` reads); the minimap's carries `style` (map-atlas.md §18.4). */
export function indexJson(index: AtlasTileIndex, style: MapStyle = 'painted'): Record<string, unknown> {
  return {
    schema: 1,
    kind: 'map-atlas-index',
    ...(style === 'minimap' ? { style } : {}),
    layout: 'compact',
    atlasHash: index.hash,
    tileSize: index.tileSize,
    minLevel: index.minLevel,
    maxLevel: index.maxLevel,
    baseLevel: index.baseLevel,
    underlayLevel: index.underlayLevel,
    template: 't/{z}/{x}/{y}.webp',
    seaColour: [...index.seaColour],
    coastColour: [...index.coastColour],
    extent: { ...index.extent },
    seamE: 16617,
    placements: [],
    insets: [],
    uiMaps: Object.fromEntries([...index.uiMaps].map(([id, entry]) => [String(id), [entry.topLevel, entry.ydPerPx]])),
    levels: index.levels.map((level) =>
      level.sea === null
        ? { z: level.z, nx: level.nx, ny: level.ny, stored: toBase64(level.stored) }
        : { z: level.z, nx: level.nx, ny: level.ny, stored: toBase64(level.stored), sea: toBase64(level.sea) },
    ),
  };
}

export const TEST_TEMPLATE = './maps/atlas/t/{z}/{x}/{y}.webp';
export const MINIMAP_TEMPLATE = './maps/minimap/t/{z}/{x}/{y}.webp';

/** The band the controller would build for `index`, written out (map/adapter `tileBandOf` must equal it). */
export function bandFor(index: AtlasTileIndex, urlTemplate = TEST_TEMPLATE, style: MapStyle = 'painted'): TileBandDescriptor {
  return {
    type: 'tiles',
    id: `atlas-tiles:${style}`,
    style,
    urlTemplate,
    tileSize: index.tileSize,
    minNativeZoom: index.minLevel,
    maxNativeZoom: index.maxLevel,
    bounds: index.extent,
    index,
    underlayLevel: index.underlayLevel,
    keepBuffer: style === 'minimap' ? 1 : 2,
    label: null,
    ref: { kind: 'atlas-tiles' },
  };
}

/** The key (z, x, y) of a URL built from `TEST_TEMPLATE` or `MINIMAP_TEMPLATE`, or null. */
export function keyOfUrl(url: string): string | null {
  const match = /\/t\/(-?\d+)\/(\d+)\/(\d+)\.webp/.exec(url);
  return match === null ? null : `${match[1] ?? ''}/${match[2] ?? ''}/${match[3] ?? ''}`;
}

/** The style of a URL built from `TEST_TEMPLATE` or `MINIMAP_TEMPLATE`, or null. */
export function styleOfUrl(url: string): MapStyle | null {
  if (url.includes('/maps/minimap/t/')) return 'minimap';
  return url.includes('/maps/atlas/t/') ? 'painted' : null;
}
