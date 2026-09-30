/**
 * tools/maps tints (docs/research/map-presentation.md §12.4; step MP.10): the fallback zone tint,
 * generated from the painted zone images (D-033) and the committed terrain zone arcs
 * (`public/maps/terrain/`, D-032). It reads no client file and makes no new decision: each tint
 * is a zone's mean painted colour, bounded as a picture and pushed apart from its neighbours
 * (`lib/tints.ts`).
 *
 * The zone images: since step ATL.10 (D-042 O5) `public/maps/art/` deploys only the images still
 * drawn one at a time, so the tints are made from a folder with every composed image, written by
 * `pnpm tsx tools/maps/convert.ts --all --out <dir>` (needs the client) and named with `--art <dir>`.
 * Its WebP files are byte-identical to the images deployed before ATL.10, and `tints.json` records the
 * number of images it sampled and one SHA-256 over their SHA-256s. The committed `public/maps/art/` is
 * refused, saying why.
 *
 * Writes `public/maps/tint/`: `tints.json` (per zone its colour, the painting it came from and the
 * sample count; the parameters; the neighbour differences before and after the push; the checks),
 * `NOTICE.md` and `manifest.json` (the files' SHA-256 and the inputs' manifests' SHA-256). The map
 * draws the tint only where the painted art fails the §12.3 criteria (the relief backdrop), never in
 * the minimap style.
 *
 * Usage: pnpm tsx tools/maps/tints.ts --art <dir> [--check]
 *   --art    a folder of every composed painted image (`convert.ts --all --out <dir>`)
 *   --check  rebuild in memory and compare with the folder instead of writing (exit 1 on a difference)
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import sharp from 'sharp';
import { zoneRingsOf } from '../../src/geo/zone-rings';
import { parseTerrainArcs, parseTerrainManifest } from '../../src/infra/maps/terrain';
import { REPO_ROOT } from '../build/lib/fs';
import { sha256Hex } from './lib/hash';
import { formatJson } from './lib/json';
import { deriveTints, RESERVED_COLOURS, sharedBorders, TINT_PARAMS, toHex, type TintImage, type TintZone } from './lib/tints';

const OUT = join(REPO_ROOT, 'public', 'maps', 'tint');
const TERRAIN = join(REPO_ROOT, 'public', 'maps', 'terrain');
const GEOMETRY = join(REPO_ROOT, 'public', 'maps', 'placeholder', 'geometry.placeholder.json');
const CLIENT_ZONES = join(REPO_ROOT, 'public', 'maps', 'client', 'zones.json');

/** The continent paintings a zone with no image of its own is sampled from. */
const CONTINENT_IMAGE: Readonly<Record<number, number>> = { 0: 1415, 1: 1414 };
/** The six capitals (map-atlas.md §22): the neighbour push moves a city first. */
const CITIES: readonly number[] = [1453, 1454, 1455, 1456, 1457, 1458];

type Json = Record<string, unknown>;

interface GeometryRow {
  readonly mapId: number;
  readonly areaId: number;
  readonly uiMin?: readonly number[];
  readonly uiMax?: readonly number[];
}

async function build(art: string): Promise<ReadonlyMap<string, Buffer>> {
  const terrainManifestBytes = readFileSync(join(TERRAIN, 'manifest.json'));
  const artManifest = JSON.parse(readFileSync(join(art, 'manifest.json')).toString('utf8')) as {
    deployment?: unknown;
    files: readonly { path: string; uiMapId: number; bounds: TintImage['bounds'] | null; sha256: string }[];
  };
  if (artManifest.deployment !== undefined && artManifest.deployment !== null) {
    throw new Error(`${art} deploys only some images (D-042 O5, step ATL.10); run pnpm tsx tools/maps/convert.ts --all --out <dir> and pass --art <dir>`);
  }
  const terrain = parseTerrainManifest(JSON.parse(terrainManifestBytes.toString('utf8')) as unknown, './');
  if (typeof terrain === 'string') throw new Error(`terrain manifest: ${terrain}`);
  const geometry = JSON.parse(readFileSync(GEOMETRY, 'utf8')) as { maps: Record<string, { name: string; assignments: readonly GeometryRow[] }> };
  const clientNames = new Map<number, string>();
  if (existsSync(CLIENT_ZONES)) {
    const client = JSON.parse(readFileSync(CLIENT_ZONES, 'utf8')) as { zones: readonly { areaId: number; name: string }[] };
    for (const zone of client.zones) clientNames.set(zone.areaId, zone.name);
  }
  // A zone's UiMap: the one full-rectangle row naming its area on its map.
  const uiMapOf = new Map<string, { readonly uiMapId: number; readonly name: string }>();
  for (const [id, map] of Object.entries(geometry.maps)) {
    if (map.assignments.length !== 1) continue;
    const [row] = map.assignments;
    if (row === undefined || row.areaId <= 0) continue;
    const full = (row.uiMin ?? [0, 0]).every((v) => v === 0) && (row.uiMax ?? [1, 1]).every((v) => v === 1);
    if (full) uiMapOf.set(`${String(row.mapId)}:${String(row.areaId)}`, { uiMapId: Number(id), name: map.name });
  }

  // Images, decoded once, and the SHA-256 of each one sampled (recorded as the tints' input).
  const images = new Map<number, TintImage>();
  const sampled = new Map<number, { readonly uiMapId: number; readonly sha256: string }>();
  const imageOfUiMap = async (uiMapId: number): Promise<TintImage | null> => {
    const known = images.get(uiMapId);
    if (known !== undefined) return known;
    const file = artManifest.files.find((entry) => entry.uiMapId === uiMapId && entry.bounds !== null);
    if (file === undefined || file.bounds === null) return null;
    const bytes = readFileSync(join(art, file.path));
    if (sha256Hex(bytes) !== file.sha256) throw new Error(`${file.path}: its SHA-256 is not the one ${art}/manifest.json records`);
    sampled.set(uiMapId, { uiMapId, sha256: file.sha256 });
    const { data, info } = await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const image: TintImage = { uiMapId, width: info.width, height: info.height, rgba: new Uint8Array(data.buffer, data.byteOffset, data.byteLength), bounds: file.bounds };
    images.set(uiMapId, image);
    return image;
  };

  const zones: TintZone[] = [];
  const borders = new Map<string, number>();
  for (const map of terrain.maps) {
    if (map.zones === null) continue;
    const arcs = parseTerrainArcs(JSON.parse(readFileSync(join(TERRAIN, String(map.mapId), 'zones.json'), 'utf8')) as unknown, map.zones);
    if (typeof arcs === 'string') throw new Error(`terrain zones of map ${String(map.mapId)}: ${arcs}`);
    for (const [key, yards] of sharedBorders(arcs.lines, arcs.sides)) borders.set(key, (borders.get(key) ?? 0) + yards);
    for (const entry of zoneRingsOf(arcs.lines, arcs.sides)) {
      const ui = uiMapOf.get(`${String(map.mapId)}:${String(entry.areaId)}`) ?? null;
      zones.push({
        mapId: map.mapId,
        areaId: entry.areaId,
        uiMapId: ui?.uiMapId ?? null,
        name: ui?.name ?? clientNames.get(entry.areaId) ?? `Area ${String(entry.areaId)}`,
        city: ui !== null && CITIES.includes(ui.uiMapId),
        rings: entry.rings,
      });
    }
  }
  const zoneImages = new Map<TintZone, readonly TintImage[]>();
  for (const zone of zones) {
    const list: TintImage[] = [];
    const own = zone.uiMapId === null ? null : await imageOfUiMap(zone.uiMapId);
    if (own !== null) list.push(own);
    const continent = CONTINENT_IMAGE[zone.mapId];
    const cont = continent === undefined ? null : await imageOfUiMap(continent);
    if (cont !== null) list.push(cont);
    zoneImages.set(zone, list);
  }
  const result = deriveTints(zones, (zone) => zoneImages.get(zone) ?? [], borders);

  const tints = {
    _generated: { by: 'tools/maps/tints.ts', notice: 'NOTICE.md', edit: 'Do not edit: run pnpm maps:tints --art <dir>' },
    schema: 1,
    kind: 'zone-tints',
    decision: 'map-presentation.md §12.4 (step MP.10); D-041 H: our own tint only where the painted art fails the §12.3 criteria',
    method:
      "Each zone's mean painted colour inside its terrain rings (pixels with alpha above 200), from its own zone image, else its continent's painting; HSL saturation capped at 0.29, lightness kept in 0.38–0.72; neighbours sharing at least 300 yd of border and differing by less than 10 (CIEDE2000) pushed apart (lightness ±0.05, hue ±6° within 12° of the art hue, saturation −0.06) for up to 40 rounds.",
    inputs: {
      // The zone images sampled: SHA-256 over "<uiMapId> <image SHA-256>\n" lines, ascending by UiMap.
      artImages: {
        count: sampled.size,
        sha256: sha256Hex(
          [...sampled.values()]
            .sort((a, b) => a.uiMapId - b.uiMapId)
            .map((entry) => `${String(entry.uiMapId)} ${entry.sha256}\n`)
            .join(''),
        ),
      },
      terrainManifestSha256: sha256Hex(terrainManifestBytes),
    },
    parameters: TINT_PARAMS,
    tints: result.tints.map((entry) => ({
      mapId: entry.zone.mapId,
      areaId: entry.zone.areaId,
      uiMapId: entry.zone.uiMapId,
      name: entry.zone.name,
      tint: toHex(entry.tint),
      art: toHex(entry.art),
      from: entry.from,
      samples: entry.samples,
    })),
    unsampled: result.unsampled,
    neighbours: { threshold: TINT_PARAMS.threshold, adjacency: 'terrain zone arcs shared by two zones, at least 300 yd of shared border', before: result.before, after: result.after },
    checks: { maxSaturation: result.maxSaturation, nearestReserved: result.nearestReserved, reserved: RESERVED_COLOURS },
  };
  const tintsText = formatJson(tints);
  const notice = [
    '# Fallback zone tints',
    '',
    "These colours are derived by this project's tool (`tools/maps/tints.ts`) from Blizzard Entertainment's painted",
    'world-map art (D-033; the images `tints.json` names by SHA-256) and the terrain-derived zone outlines (`../terrain/`, D-032): each is a',
    "zone's mean painted colour, bounded and adjusted as `tints.json` records. They are not Blizzard's art,",
    'and they carry no meaning: the map draws them only where no painted art is shown, as a picture.',
    '',
    'World of Warcraft and Blizzard Entertainment are trademarks or registered trademarks of Blizzard',
    'Entertainment, Inc. This project is not affiliated with or endorsed by Blizzard Entertainment.',
    '',
  ].join('\n');
  const manifest = {
    _generated: { by: 'tools/maps/tints.ts', notice: 'NOTICE.md', edit: 'Do not edit: run pnpm maps:tints --art <dir>' },
    schema: 1,
    kind: 'zone-tints-manifest',
    files: [
      { path: 'tints.json', sha256: sha256Hex(tintsText), zones: result.tints.length },
      { path: 'NOTICE.md', sha256: sha256Hex(notice) },
    ],
  };
  return new Map([
    ['tints.json', Buffer.from(tintsText)],
    ['NOTICE.md', Buffer.from(notice)],
    ['manifest.json', Buffer.from(formatJson(manifest))],
  ]);
}

async function main(argv: readonly string[]): Promise<number> {
  const check = argv.includes('--check');
  const at = argv.indexOf('--art');
  const art = at >= 0 ? argv[at + 1] : undefined;
  const unknown = argv.filter((arg, i) => arg !== '--check' && i !== at && i !== at + 1);
  if (unknown.length > 0) throw new Error(`unknown option ${unknown.join(', ')}`);
  if (art === undefined || art.startsWith('--')) throw new Error('--art <dir> is required: a folder of every composed painted image (pnpm tsx tools/maps/convert.ts --all --out <dir>)');
  const outputs = await build(resolve(REPO_ROOT, art));
  if (check) {
    const problems = [...outputs].flatMap(([name, bytes]) => {
      const path = join(OUT, name);
      if (!existsSync(path)) return [`${name}: missing`];
      return readFileSync(path).equals(bytes) ? [] : [`${name}: differs`];
    });
    for (const problem of problems) console.error(`tints --check: ${problem}`);
    if (problems.length === 0) console.log(`tints --check: public/maps/tint/ is up to date (${String(outputs.size)} files)`);
    return problems.length === 0 ? 0 : 1;
  }
  mkdirSync(OUT, { recursive: true });
  for (const [name, bytes] of outputs) writeFileSync(join(OUT, name), bytes);
  const summary = JSON.parse(outputs.get('tints.json')?.toString('utf8') ?? '{}') as Json;
  console.log(`tints: wrote public/maps/tint/ (${JSON.stringify((summary['neighbours'] as Json | undefined)?.['after'] ?? {})})`);
  return 0;
}

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    console.error(`tints: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  },
);
