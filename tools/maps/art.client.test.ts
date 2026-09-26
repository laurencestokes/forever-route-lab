/**
 * Step 3b.8 checks against the local Forever client (terrain-navigation.md §13.4, §17; docs/MAPS.md
 * §3, §5.4). They need the pinned build at WOW_INSTALL and skip with a banner otherwise.
 * Read-only; nothing is written.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { canonicalFrameTuples, frameSetOf, mergeLocalGeometry } from '../../src/geo/frame';
import { parseGeometryFile } from '../../src/geo/geometry';
import type { MapGeometry } from '../../src/geo/types';
import { REPO_ROOT } from '../build/lib/fs';
import { LocalCasc } from '../casc/casc';
import { inputHash } from '../casc/input-hash';
import { announceSkip, FOREVER_TEST_PIN, pinnedClientStatus } from '../casc/test-support';
import { ART_DIR, ART_MANIFEST_FILE, parseArtManifest, type ParsedArtManifest } from './lib/art-manifest';
import { planArt, planFileDataIds, type PlanReport } from './lib/art-plan';
import { readClientMapTables, type ClientMapTables } from './lib/client-tables';
import { composeArt } from './lib/compose';
import { GEOMETRY_FILE, PLACEHOLDER_DIR, REFERENCE_FRAME_HASH } from './lib/constants';
import { DEFAULT_WEBP, encodeWebp, encoderIdentity } from './lib/encode';
import { lfBytes, sha256Hex } from './lib/hash';
import { formatJson } from './lib/json';
import { localGeometryFromClient } from './lib/local-build';
import { rasterSha256 } from './lib/raster';

const status = pinnedClientStatus();

it('finds the pinned client, or says loudly why the 3b.8 client tests are skipped', () => {
  if (!status.available) announceSkip('tools/maps art and tables on the client (art.client.test.ts)', status.reason);
  expect(status.available || status.reason.length > 0).toBe(true);
});

describe.skipIf(!status.available)('map art on the pinned Forever client', () => {
  let casc: LocalCasc;
  let tables: ClientMapTables;
  let report: PlanReport;
  let committed: ParsedArtManifest;
  let placeholder: MapGeometry;

  beforeAll(() => {
    if (!status.available) return;
    casc = LocalCasc.open({ install: status.install, product: FOREVER_TEST_PIN.product, pin: FOREVER_TEST_PIN });
    tables = readClientMapTables(casc);
    report = planArt(tables.art);
    const parsed = parseArtManifest(JSON.parse(readFileSync(join(REPO_ROOT, ART_DIR, ART_MANIFEST_FILE), 'utf8')) as unknown);
    if (parsed.manifest === null) throw new Error(parsed.errors.join('; '));
    committed = parsed.manifest;
    const geometry = parseGeometryFile(JSON.parse(lfBytes(readFileSync(join(REPO_ROOT, PLACEHOLDER_DIR, GEOMETRY_FILE))).toString('utf8')) as unknown);
    if (!geometry.ok) throw new Error(geometry.errors.join('; '));
    placeholder = geometry.geometry;
  });

  afterAll(() => {
    casc.close();
  });

  it('reads the eight map tables complete, with the counts of docs/MAPS.md §3', () => {
    expect(Object.fromEntries(tables.inputs.map((t) => [t.table, t.rows]))).toEqual({
      WorldMapOverlay: 1081,
      UiMapArt: 144,
      UiMap: 60,
      UiMapArtStyleLayer: 6,
      UiMapArtTile: 1672,
      WorldMapOverlayTile: 1739,
      UiMapXMapArt: 60,
      UiMapAssignment: 61,
    });
    const linked = new Set(tables.art.xMapArt.map((x) => x.uiMapArtId));
    expect(tables.art.artTiles.filter((t) => linked.has(t.uiMapArtId))).toHaveLength(687);
    const overlays = tables.art.overlays.filter((o) => linked.has(o.uiMapArtId));
    expect(overlays).toHaveLength(580);
    expect(overlays.every((o) => o.playerConditionId === 0)).toBe(true);
  });

  it('plans one image for each of the 60 UiMaps, Durotar as docs/MAPS.md §3 cites it', () => {
    expect(report.plans).toHaveLength(60);
    expect(report.skippedUiMaps).toEqual([]);
    expect(report.skippedOverlays.map((s) => s.overlayId)).toEqual([5551, 5252, 5545, 5546, 5547, 5548, 5549, 5550]);
    const sizes = new Map<string, number>();
    for (const p of report.plans) sizes.set(`${String(p.width)}x${String(p.height)}`, (sizes.get(`${String(p.width)}x${String(p.height)}`) ?? 0) + 1);
    expect(Object.fromEntries(sizes)).toEqual({ '1002x668': 57, '512x512': 3 });
    const durotar = report.plans.find((p) => p.uiMapId === 1411);
    expect(durotar?.uiMapArtId).toBe(2169);
    expect(durotar?.tiles.map((t) => t.fileDataId)).toEqual([8073638, 8074081, 8074082, 8074083, 8074084, 8074085, 8074086, 8074087, 8074088, 8073639, 8073686, 8074080]);
    expect(durotar?.overlays).toHaveLength(11);
    expect(durotar?.overlays[0]).toMatchObject({ id: 5358, areaIds: [370], rect: { x: 427, y: 78, width: 256, height: 256 } });
    expect(report.plans.reduce((n, p) => n + p.overlays.reduce((k, o) => k + o.tiles.length, 0), 0)).toBe(972);
  });

  it('composes every image to the pixels and inputs the committed manifest records', () => {
    const tableInputs = tables.inputs.map((t) => ({ fileDataId: t.fileDataId, ckey: t.ckey }));
    let oversized = 0;
    for (const plan of report.plans) {
      const { image, stats } = composeArt(plan, (id) => casc.file(id).data);
      oversized += stats.oversizedEdgeTiles;
      const entry = committed.files.find((f) => f.uiMapId === plan.uiMapId && f.layer === plan.layerIndex);
      expect(entry?.pixelsSha256, `UiMap ${String(plan.uiMapId)}`).toBe(rasterSha256(image));
      const inputs = [...planFileDataIds(plan).map((id) => ({ fileDataId: id, ckey: casc.ckeyOf(id) ?? '' })), ...tableInputs];
      expect(entry?.inputHash, `UiMap ${String(plan.uiMapId)}`).toBe(inputHash(inputs));
    }
    expect(oversized).toBe(19);
  }, 120_000);

  it('re-encodes to the committed bytes with the recorded encoder (Durotar, Kalimdor, 1463)', async () => {
    const same = JSON.stringify(committed.encoder) === JSON.stringify(encoderIdentity()) && JSON.stringify(committed.webp) === JSON.stringify(DEFAULT_WEBP);
    if (!same) {
      announceSkip('art byte reproducibility', `the committed art was encoded by ${JSON.stringify(committed.encoder)}, this machine has ${JSON.stringify(encoderIdentity())}`);
      return;
    }
    for (const id of [1411, 1414, 1463]) {
      const plan = report.plans.find((p) => p.uiMapId === id);
      if (plan === undefined) throw new Error(`no plan for ${String(id)}`);
      const bytes = await encodeWebp(composeArt(plan, (fdid) => casc.file(fdid).data).image, DEFAULT_WEBP);
      expect(sha256Hex(bytes)).toBe(committed.files.find((f) => f.uiMapId === id)?.sha256);
    }
  }, 120_000);

  it('import --build: the client rows reproduce the committed frame hash and every shared row', () => {
    const text = formatJson(localGeometryFromClient(tables, { product: casc.build.product, version: casc.build.version }));
    const local = parseGeometryFile(JSON.parse(text) as unknown);
    if (!local.ok) throw new Error(local.errors.join('; '));
    const frame = canonicalFrameTuples(local.geometry, frameSetOf(placeholder));
    expect(frame.ok && sha256Hex(frame.canonical)).toBe(REFERENCE_FRAME_HASH);
    const merge = mergeLocalGeometry(placeholder, local.geometry);
    expect(merge.kind).toBe('merged');
    expect(merge.kind === 'merged' ? merge.added : null).toEqual([]);
    expect(local.geometry.maps.size).toBe(60);
  });
});
