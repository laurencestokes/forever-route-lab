import { mkdirSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseGeometryFile } from '../../../src/geo/geometry';
import type { MapGeometry } from '../../../src/geo/types';
import { pngImage, webpImage } from '../../../src/infra/maps/test-images';
import { artSectionDrift, expectedArtSize, scanArt } from './art';
import { sha256Hex } from './hash';
import { committedGeometryJson, tempDir, writeFile } from './test-support';

/*
 * Generated test images only (src/infra/maps/test-images.ts): decodable greyscale PNGs, and WebP
 * containers with valid headers and placeholder bitstreams (the checks read headers, never pixels).
 */

type Json = Record<string, unknown>;

/** The committed rows as a local geometry (every UiMap, Azeroth 947's two rows included), optionally edited. */
function localGeometry(edit: (maps: Record<string, Json>) => void = () => undefined): MapGeometry {
  const json = committedGeometryJson();
  const maps = json['maps'] as Record<string, Json>;
  for (const map of Object.values(maps)) {
    map['nameSource'] = 'local-db2';
    for (const row of map['assignments'] as Json[]) row['source'] = 'local-db2';
  }
  edit(maps);
  delete json['inputs'];
  const parsed = parseGeometryFile({ ...json, kind: 'local', redistribution: 'local-only', frameHash: null, contentHash: null });
  if (!parsed.ok) throw new Error(parsed.errors.join('; '));
  return parsed.geometry;
}
const local = localGeometry();

const DUROTAR_BOUNDS = { assignment: 46721, mapId: 1, xMin: -1716.6666259766, xMax: 1808.3332519531, yMin: -7249.9995117188, yMax: -1962.4998779297 };
const ZONE_PNG = pngImage(1002, 668);
const ZONE_WEBP = webpImage(1002, 668);

let dir = '';
let dispose = (): void => undefined;
beforeEach(() => {
  ({ dir, dispose } = tempDir('frl-art-'));
});
afterEach(() => dispose());

describe('scanArt', () => {
  it('has nothing to check without an art folder', () => {
    expect(scanArt(dir, local)).toEqual({ problems: [], art: {} });
  });

  it('lists each image with its type, size, SHA-256 and the row it covers', () => {
    writeFile(dir, 'art/1411.png', ZONE_PNG);
    writeFile(dir, 'art/1414.webp', ZONE_WEBP);
    writeFile(dir, 'art/1463.png', pngImage(512, 512));
    writeFile(dir, 'art/Thumbs.db', 'ignored');
    const scan = scanArt(dir, local);
    expect(scan.problems).toEqual([]);
    expect(Object.keys(scan.art)).toEqual(['1411', '1414', '1463']);
    expect(scan.art['1411']).toEqual({ file: 'art/1411.png', contentType: 'image/png', width: 1002, height: 668, sha256: sha256Hex(ZONE_PNG), bounds: DUROTAR_BOUNDS });
    expect(scan.art['1414']).toMatchObject({ file: 'art/1414.webp', contentType: 'image/webp', bounds: { assignment: 46724, mapId: 1 } });
    expect(scan.art['1463']).toMatchObject({ width: 512, height: 512 });
  });

  it('refuses stray names, subfolders, duplicates, non-images and a type its name does not promise', () => {
    writeFile(dir, 'art/durotar.png', ZONE_PNG);
    writeFile(dir, 'art/01411.png', ZONE_PNG);
    writeFile(dir, 'art/1411.PNG', ZONE_PNG);
    writeFile(dir, 'art/zones/1411.png', ZONE_PNG);
    writeFile(dir, 'art/1412.png', ZONE_PNG);
    writeFile(dir, 'art/1412.webp', ZONE_WEBP);
    writeFile(dir, 'art/1413.webp', ZONE_PNG);
    writeFile(dir, 'art/1416.png', 'not really an image');
    const scan = scanArt(dir, local);
    expect(scan.problems).toEqual([
      'art/01411.png: not an art file name (expected <uiMapId>.png or <uiMapId>.webp)',
      'art/1411.PNG: not an art file name (expected <uiMapId>.png or <uiMapId>.webp)',
      'art/1412.webp: UiMap 1412 already has art/1412.png',
      'art/1413.webp: the file is a image/png, its name says otherwise',
      'art/1416.png: not a PNG or WebP file',
      'art/durotar.png: not an art file name (expected <uiMapId>.png or <uiMapId>.webp)',
      'art/zones/: art must sit directly in art/ as <uiMapId>.png or <uiMapId>.webp',
    ]);
    expect(Object.keys(scan.art)).toEqual(['1412']);
  });

  it('refuses art that cannot be placed: unknown UiMaps, Azeroth with a row per continent, a partial row', () => {
    writeFile(dir, 'art/4242.png', ZONE_PNG);
    writeFile(dir, 'art/947.png', ZONE_PNG);
    expect(scanArt(dir, local).problems).toEqual([
      'art/4242.png: UiMap 4242 is not in geometry.local.json',
      'art/947.png: UiMap 947 has 2 row(s) on world map(s) 1, 0, not one full-rectangle row, so its art cannot be placed on one world surface',
    ]);
  });

  it('refuses a size other than the UiMap art size, and an aspect off the world rectangle', () => {
    writeFile(dir, 'art/1411.png', pngImage(1004, 668));
    writeFile(dir, 'art/1463.webp', webpImage(1002, 668));
    expect(scanArt(dir, local).problems).toEqual([
      "art/1411.png: 1004 × 668 pixels, UiMap 1411's art is 1002 × 668 (LayerWidth × LayerHeight)",
      "art/1463.webp: 1002 × 668 pixels, UiMap 1463's art is 512 × 512 (LayerWidth × LayerHeight)",
    ]);
    expect([expectedArtSize(1411), expectedArtSize(2665)]).toEqual([
      { width: 1002, height: 668 },
      { width: 512, height: 512 },
    ]);

    // A row whose world aspect is not the art's: the image would be stretched off the geometry.
    const wide = localGeometry((maps) => {
      const [row] = (maps['1411']?.['assignments'] ?? []) as Json[];
      if (row !== undefined) row['yMax'] = Number(row['yMax']) + 500;
    });
    writeFile(dir, 'art/1463.webp', webpImage(512, 512));
    writeFile(dir, 'art/1411.png', ZONE_PNG);
    expect(scanArt(dir, wide).problems).toEqual([expect.stringMatching(/^art\/1411\.png: the image aspect is \d+\.\d{3}% off its world rectangle's \(row 46721; tolerance 0\.2%\)$/)]);
    // 2665 (a 1.5-aspect region on square art) is exempt from the aspect check.
    writeFile(dir, 'art/1411.png', ZONE_PNG);
    writeFile(dir, 'art/2665.png', pngImage(512, 512));
    expect(scanArt(dir, local).problems).toEqual([]);
  });

  it('does not follow links', () => {
    mkdirSync(join(dir, 'elsewhere'));
    writeFile(dir, 'elsewhere/1411.png', ZONE_PNG);
    mkdirSync(join(dir, 'art'));
    try {
      symlinkSync(join(dir, 'elsewhere', '1411.png'), join(dir, 'art', '1411.png'));
    } catch {
      // Creating file links needs a privilege on Windows; the directory case below still runs.
    }
    try {
      symlinkSync(join(dir, 'elsewhere'), join(dir, 'art', 'more'), 'junction');
    } catch {
      return;
    }
    const scan = scanArt(dir, local);
    expect(scan.art).toEqual({});
    expect(scan.problems.every((p) => /: a link, which is not followed/.test(p))).toBe(true);
    expect(scan.problems.length).toBeGreaterThan(0);
  });
});

describe('artSectionDrift', () => {
  it('reports nothing for the section scanArt wrote, and every difference otherwise', () => {
    writeFile(dir, 'art/1411.png', ZONE_PNG);
    writeFile(dir, 'art/1414.webp', ZONE_WEBP);
    const { art } = scanArt(dir, local);
    expect(artSectionDrift(art, art)).toEqual([]);
    expect(artSectionDrift(undefined, {})).toEqual([]);
    const recorded = structuredClone(art) as unknown as Record<string, Json>;
    (recorded['1411'] as Json)['sha256'] = '0'.repeat(64);
    (recorded['1414'] as Json)['width'] = 1000;
    recorded['1415'] = { file: 'art/1415.png' };
    expect(artSectionDrift(recorded, art)).toEqual([
      `art/1411.png changed after activation (SHA-256 ${sha256Hex(ZONE_PNG).slice(0, 12)}…, the manifest records 000000000000…)`,
      'art/1414.webp: width is 1002, the manifest records 1000',
      'art for UiMap 1415 is listed, but its file is missing or fails L3',
    ]);
    expect(artSectionDrift(undefined, art)).toEqual(['art/1411.png is not listed', 'art/1414.webp is not listed']);
    expect(artSectionDrift([], art)).toEqual(['its art section is not an object']);
  });
});
