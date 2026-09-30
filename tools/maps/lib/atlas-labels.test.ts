import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { REPO_ROOT } from '../../build/lib/fs';
import { ART_DIR, ART_MANIFEST_FILE, parseArtManifest } from './art-manifest';
import type { Candidate } from './atlas-detect';
import { ATLAS_LABELS_FILE, keepShare, letteringCensus, parseAtlasLabels, signedDistanceYd, type AtlasLabelEntry, type CensusPainting } from './atlas-labels';
import { boundaryOf } from './atlas-mask';
import { ISLAND_ARCS } from './atlas-test-support';

/** The label list and the lettering census of docs/research/map-atlas.md §6.5. */

const hash = 'a'.repeat(64);
const entry = (over: Partial<AtlasLabelEntry> = {}): Record<string, unknown> => ({
  uiMapId: 1412,
  name: 'Mulgore',
  label: 'SKYWATCHER PLATEAU',
  box: [275, 111, 357, 142],
  rule: 'whole',
  levels: 'all',
  reason: 'straddles the border',
  origin: 'detector',
  pixelsSha256: hash,
  ...over,
});

describe('the label list', () => {
  it('parses a well-formed list and refuses malformed entries', () => {
    expect(parseAtlasLabels({ schema: 1, kind: 'atlas-labels', labels: [entry()] }).errors).toEqual([]);
    const bad = parseAtlasLabels({ schema: 1, kind: 'atlas-labels', labels: [entry({ box: [10, 10, 5, 20] }), entry({ rule: 'whole', levels: 'fine' }), entry({ pixelsSha256: 'x' })] });
    expect(bad.list).toBeNull();
    expect(bad.errors.join('\n')).toMatch(/box must be/);
    expect(bad.errors.join('\n')).toMatch(/a whole rule applies at every level/);
    expect(bad.errors.join('\n')).toMatch(/pixelsSha256/);
    expect(parseAtlasLabels({ schema: 1, kind: 'atlas-labels', labels: [entry(), entry()] }).errors).toEqual(['labels lists a box twice with the same rule']);
  });

  it('the committed list parses, and every entry carries its painting\'s current pixel hash (T9)', () => {
    const list = parseAtlasLabels(JSON.parse(readFileSync(join(REPO_ROOT, ATLAS_LABELS_FILE), 'utf8')) as unknown);
    expect(list.errors).toEqual([]);
    const art = parseArtManifest(JSON.parse(readFileSync(join(REPO_ROOT, ART_DIR, ART_MANIFEST_FILE), 'utf8')) as unknown).manifest;
    for (const l of list.list?.labels ?? []) expect(art?.sources.find((s) => s.uiMapId === l.uiMapId)?.pixelsSha256).toBe(l.pixelsSha256);
    // the nine labels of D-042 O11 and the two found on the ATL.6 contact sheet are hidden
    expect(list.list?.labels.filter((l) => l.rule === 'hide').map((l) => l.label).sort()).toEqual(
      ['BLACKROCK MOUNTAIN', 'DARKWHISPER GORGE', 'DARNASSUS', 'IRONFORGE', 'LORDAMERE LAKE', 'ORGRIMMAR', 'RAZORFEN DOWNS', 'STORMWIND', 'THUNDER BLUFF', 'UNDERCITY', 'WETLANDS'].sort(),
    );
  });
});

describe('the lettering census', () => {
  // The synthetic island's zone painting (areas 10): 4 yd/px over X −1,336…1,336, Y −2,004…2,004.
  const bounds = { xMin: -1336, xMax: 1336, yMin: -2004, yMax: 2004 };
  const painted = new Uint8Array(1002 * 668).fill(255);
  const zone: CensusPainting = { uiMapId: 5001, name: 'Test Zone', cls: 'zone', mapId: 1, bounds, segs: boundaryOf(ISLAND_ARCS, new Set([10])), overlayAlpha: painted, card: false };
  const land = (): number => 0;
  // A label inside the polygon (u 300-340 → Y 804…644; v 250-260 → X 336…296), and one straddling its
  // edge at Y = 0 (u 480-520) over land.
  const inside: Candidate = { box: [300, 250, 340, 260], polarity: 'light', inkPixels: 100, rhythm: 0.2 };
  const straddling: Candidate = { box: [480, 250, 520, 260], polarity: 'light', inkPixels: 100, rhythm: 0.2 };
  const candidates = new Map([[5001, [inside, straddling]]]);

  it('measures the share of detail a painting keeps: all inside its polygon, none beyond its painted ground', () => {
    expect(signedDistanceYd(zone.segs, 0, 600)).toBeCloseTo(600, 6);
    expect(signedDistanceYd(zone.segs, 0, -600)).toBeCloseTo(-600, 6);
    expect(keepShare(zone, 316, 724, [zone], [], land)).toBe(1);
    // outside the polygon but on painted ground, with no other painting there, it keeps the detail
    expect(keepShare(zone, 316, -600, [zone], [], land)).toBe(1);
    const bare = { ...zone, overlayAlpha: new Uint8Array(1002 * 668) };
    expect(keepShare(bare, 316, -600, [bare], [], land)).toBe(0);
  });

  it('finds a label whole inside the polygon, cut across its edge where the painting has no painted ground, and whole under a whole rule', () => {
    const bare = { ...zone, overlayAlpha: new Uint8Array(1002 * 668) };
    const plain = letteringCensus(candidates, [bare], [], land);
    expect(plain.labels.map((l) => l.state)).toEqual(['whole', 'cut']);
    expect(plain.counts.cut).toBe(1);
    const rule = entry({ uiMapId: 5001, box: [478, 248, 522, 262], label: 'EDGE' }) as unknown as AtlasLabelEntry;
    const ruled = letteringCensus(candidates, [bare], [rule], land);
    expect(ruled.labels.map((l) => l.state)).toEqual(['whole', 'whole-by-rule']);
    expect(ruled.entries).toEqual([{ index: 0, state: 'whole-by-rule', fineState: 'whole-by-rule', keepMin: 1, candidates: 1 }]);
  });

  it('marks labels hidden by a rule, and a banner hidden at the fine levels only', () => {
    const all = entry({ uiMapId: 5001, box: [298, 248, 342, 262], rule: 'hide', levels: 'all', label: 'DUP' }) as unknown as AtlasLabelEntry;
    const fine = entry({ uiMapId: 5001, box: [298, 248, 342, 262], rule: 'hide', levels: 'fine', label: 'BANNER' }) as unknown as AtlasLabelEntry;
    expect(letteringCensus(new Map([[5001, [inside]]]), [zone], [all], land).labels[0]).toMatchObject({ state: 'hidden-by-rule', fineState: 'hidden-by-rule' });
    expect(letteringCensus(new Map([[5001, [inside]]]), [zone], [fine], land).labels[0]).toMatchObject({ state: 'whole', fineState: 'hidden-by-rule' });
  });

  it('calls a label cut at levels −1 and 0 when a city plan drawn there covers part of it', () => {
    const city: CensusPainting = { uiMapId: 6000, name: 'Test City', cls: 'city', mapId: 1, bounds, segs: [], overlayAlpha: null, card: true };
    expect(letteringCensus(new Map([[5001, [inside]]]), [zone, city], [], land).labels[0]).toMatchObject({ state: 'whole', fineState: 'cut', underCity: ['Test City'] });
  });
});
