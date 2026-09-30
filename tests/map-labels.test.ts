/**
 * The labels canvas's names on the committed data, end to end (docs/research/map-presentation.md
 * §13.2, §13.3, §13.5; map-atlas.md §22; D-049 O19; step MP.7):
 *
 * - the derived pipeline loads the committed terrain zone arcs itself and publishes the names with
 *   the places, anchored at the zones' terrain poles, the underground cities named so in the minimap
 *   style;
 * - **the acceptance test** of §13.3: every zone and city of the atlas is named at the fit-both view
 *   of a 900 px panel (0.0239 px per yard, as the design measured it), by the same placement the
 *   labels canvas runs, with text measured by a fixed width per character that is wider than the
 *   UI font's (so the test errs towards a label that does not fit), and at the world band's edge
 *   (0.022 px per yard), where the design let one label drop and asked MP.7 to tune until it passes;
 * - **MM.9's gate** (map-atlas.md §25): the same test run on the minimap style's names (the default
 *   style since MM.9), whose underground cities carry the longer "(underground city)" text.
 *
 * No client needed.
 */
import { describe, expect, it } from 'vitest';
import { fixedClock } from '../src/app/clock';
import { createDerivedStore } from '../src/app/derived';
import { createDerivedPipeline } from '../src/app/derived-pipeline';
import { buildMapLabels, zoneShapesOf, type MapLabels } from '../src/app/map-labels';
import { createEditorStore } from '../src/app/store';
import { loadWorkspace } from '../src/app/workspace';
import { zoneSpans } from '../src/app/zone-levels';
import { sequentialIdSource, type WorldMapId } from '../src/domain/ids';
import { placementOf, worldToAtlas } from '../src/geo/atlas';
import { parseTerrainArcs, parseTerrainManifest } from '../src/infra/maps/terrain';
import type { LabelDescriptor } from '../src/map/adapter';
import { atlasSurfaceOf } from '../src/map/layers';
import { labelForms, labelInRange, placeLabels, type Measure, type PlacementInput } from '../src/map/leaflet/labels';
import { effectiveRules, FOREVER_BETA } from '../src/rules';
import { type Bytes, fakeServer, nodeSha256, publicSite, readDirectory } from './support/fake-fetch';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const NOW = '2026-09-26T00:00:00.000Z';
const ORC = { race: 'Orc', class: 'WARRIOR' } as const;

/** Text widths: 0.62 em a character in the bold weight and 0.56 em in the regular (wider than the system UI font's, MEASURED in the mock at about 0.55 and 0.5). */
const measure: Measure = (text, font) => {
  const size = Number(/(\d+(?:\.\d+)?)px/.exec(font)?.[1] ?? '11');
  const bold = /^(600|700)/.test(font);
  return text.length * size * (bold ? 0.62 : 0.56);
};

/** The fit-both view's scale in a 918 px panel, as the design measured it (§5.1: 0.0239 px per yard, zoom −5.39); a 900 × 672 px panel with 24 px of padding fits the atlas extent at the same scale. */
const FIT_BOTH = Math.min((900 - 48) / 30720, (672 - 48) / 26112);

async function until(check: () => boolean, what: string): Promise<void> {
  for (let i = 0; i < 600; i += 1) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`timed out waiting for ${what}`);
}

function terrainSite(): Map<string, Bytes> {
  return new Map([
    ...readDirectory('public/maps/terrain', 'maps/terrain/'),
    ...readDirectory('public/maps/terrain/0', 'maps/terrain/0/'),
    ...readDirectory('public/maps/terrain/1', 'maps/terrain/1/'),
    ...readDirectory('public/maps/tint', 'maps/tint/'),
  ]);
}

/** The labels placed on the atlas at `px` px per yard in a `width` × `height` px stage centred on it. */
function placeOnAtlas(geometry: Parameters<typeof atlasSurfaceOf>[0], labels: readonly LabelDescriptor[], px: number, width: number, height: number) {
  const atlas = atlasSurfaceOf(geometry);
  if (atlas === null) throw new Error('no atlas');
  const { eMin, eMax, sMin, sMax } = atlas.layout.extent;
  const dx = (width - (eMax - eMin) * px) / 2;
  const dy = (height - (sMax - sMin) * px) / 2;
  const inputs: PlacementInput[] = [];
  for (const label of labels) {
    if (!labelInRange(label, px, null)) continue;
    const placement = placementOf(atlas.placements, label.point.mapId);
    if (placement === null) continue;
    const { e, s } = worldToAtlas(placement, label.point.x, label.point.y);
    inputs.push({ id: label.id, name: label.text, priority: label.priority, x: dx + (e - eMin) * px, y: dy + (s - sMin) * px, forms: labelForms(label, px, measure, 'system-ui') });
  }
  return { inputs, result: placeLabels(inputs, [], { x0: 0, y0: 0, x1: width, y1: height }) };
}

describe('the labels canvas’s names on the committed data', () => {
  it('names every zone and city of the atlas at the fit-both view of a 900 px panel, anchored at the terrain poles', { timeout: 60_000 }, async () => {
    const server = fakeServer(publicSite());
    const workspace = await loadWorkspace({ fetch: server.fetch, baseUrl: './', sha256: nodeSha256, nowIso: NOW, yieldToRender: () => Promise.resolve() });
    const geometry = workspace.geometry.geometry;
    const view = workspace.data.view({ faction: 'Horde', class: 'WARRIOR', customQuests: [], questOverrides: {} });
    const spans = zoneSpans(view, geometry, ORC);
    // The committed terrain zone arcs, decoded as the app decodes them.
    const manifest = parseTerrainManifest(JSON.parse(readFileSync(join('public', 'maps', 'terrain', 'manifest.json'), 'utf8')) as unknown, './');
    if (typeof manifest === 'string') throw new Error(manifest);
    const anchors = new Map<WorldMapId, ReadonlyMap<number, { mapId: WorldMapId; x: number; y: number }>>();
    for (const map of manifest.maps) {
      if (map.zones === null) continue;
      const arcs = parseTerrainArcs(JSON.parse(readFileSync(join('public', 'maps', 'terrain', String(map.mapId), 'zones.json'), 'utf8')) as unknown, map.zones);
      if (typeof arcs === 'string') throw new Error(arcs);
      anchors.set(map.mapId, zoneShapesOf(map.mapId, arcs.lines, arcs.sides).anchors);
    }
    const labels: MapLabels = buildMapLabels({ geometry, spans, level: { level: 12, lowerBound: false }, rules: effectiveRules(FOREVER_BETA), anchors, dungeons: null, flightPoints: null });
    const atlas = atlasSurfaceOf(geometry);
    expect(FIT_BOTH).toBeCloseTo(0.0239, 4);
    // Both styles' names: the painted style's (MP.7), and the minimap's, the default since MM.9.
    for (const style of ['painted', 'minimap'] as const) {
      const onAtlas = labels[style].filter((label) => label.kind === 'zone' && atlas?.mapIds.includes(label.point.mapId) === true);
      // The 49 zones and cities of maps 0 and 1 (§13.3), and Zephras Isle in its inset.
      expect(onAtlas.filter((label) => label.point.mapId === 0 || label.point.mapId === 1)).toHaveLength(49);
      expect(onAtlas).toHaveLength(50);

      const fit = placeOnAtlas(geometry, onAtlas, FIT_BOTH, 900, 672);
      expect(fit.inputs).toHaveLength(onAtlas.length);
      expect(fit.result.skipped).toEqual([]);

      // At the world band's edge the design let greedy placement drop one label (§13.3) and asked MP.7 to
      // tune until 0.022 passes too: it does, with the anchors at the terrain poles.
      const edge = placeOnAtlas(geometry, onAtlas, 0.022, 900, 672);
      expect(edge.result.skipped).toEqual([]);
      console.log(`${style === 'painted' ? 'MP.7' : 'MM.9'} labels (${style}): fit-both ${String(FIT_BOTH.toFixed(4))} px/yd: ${String(fit.result.placed.length)} of ${String(onAtlas.length)} placed, ${String(fit.result.leaders)} with a leader; 0.022 px/yd: ${String(edge.result.placed.length)} placed, skipped ${JSON.stringify(edge.result.skipped)}`);
    }
    // The minimap style's underground cities are named so (map-atlas.md §22, D-049 O19).
    expect(labels.minimap.find((label) => label.id === 'zone:1455')?.text).toBe('Ironforge (underground city)');
  });

  it('publishes the names with the places, anchored once the pipeline has loaded the terrain arcs, the underground cities named in the minimap style', { timeout: 60_000 }, async () => {
    const site = new Map([...publicSite(), ...readDirectory('public/maps/client', 'maps/client/'), ...terrainSite()]);
    const server = fakeServer(site);
    const workspace = await loadWorkspace({ fetch: server.fetch, baseUrl: './', sha256: nodeSha256, nowIso: NOW, yieldToRender: () => Promise.resolve() });
    const project = { ...workspace.project, character: { ...workspace.project.character, faction: 'Horde' as const, race: 'Orc' as const, class: 'WARRIOR' as const } };
    const store = createEditorStore({ project, ids: sequentialIdSource(1000), clock: fixedClock(NOW) });
    const handle = createDerivedStore();
    const pipeline = createDerivedPipeline({
      store,
      data: workspace.data,
      geometry: workspace.geometry.geometry,
      output: handle,
      clientTables: { resources: { fetch: server.fetch, baseUrl: './', sha256: nodeSha256 } },
    });
    const durotarFrame = workspace.geometry.geometry.maps.get(1411 as never)?.assignments[0];
    if (durotarFrame === undefined) throw new Error('no Durotar frame');
    const anchored = (): boolean => {
      const durotar = handle.store.getState().places?.labels?.painted.find((label) => label.id === 'zone:1411');
      return durotar !== undefined && durotar.point.x !== (durotarFrame.xMin + durotarFrame.xMax) / 2;
    };
    await until(anchored, 'the labels anchored at the terrain poles');
    const labels = handle.store.getState().places?.labels;
    expect(labels?.minimap.find((label) => label.id === 'zone:1455')?.text).toBe('Ironforge (underground city)');
    expect(labels?.minimap.find((label) => label.id === 'zone:1458')?.text).toBe('Undercity (underground city)');
    expect(labels?.painted.find((label) => label.id === 'zone:1455')?.text).toBe('Ironforge');
    // Riverglades takes its cited text, never a dataset span.
    expect(labels?.painted.find((label) => label.id === 'zone:2548')?.card).toMatchObject({ span: 'mid-30s to mid-40s (official)', compact: null, basis: 'official' });
    // The dungeons and flight points are named from 0.05 px per yard once the client tables are in.
    await until(() => handle.store.getState().places?.labels?.painted.some((label) => label.id.startsWith('place:dungeon:')) === true, 'the place names');
    const named = handle.store.getState().places?.labels?.painted ?? [];
    expect(named.some((label) => label.kind === 'continent' && label.text === 'Kalimdor')).toBe(true);
    expect(named.find((label) => label.id.startsWith('place:flight:'))).toMatchObject({ kind: 'place', minPxPerYard: 0.05 });
    // MP.10: the zone fills from the terrain rings, the committed tints and the client zone table.
    await until(() => (handle.store.getState().places?.zoneFill?.faction.length ?? 0) > 0 && (handle.store.getState().places?.zoneFill?.tint.length ?? 0) > 0, 'the zone fills');
    const fills = handle.store.getState().places?.zoneFill;
    expect(fills?.faction.find((fill) => fill.id === 'faction:1:14')).toMatchObject({ fill: { pattern: 'horde' }, label: 'Durotar: Horde territory (client AreaTable FactionGroupMask 4; an INFERRED decode)', ref: { kind: 'zone', uiMapId: 1411 } });
    expect(fills?.faction.find((fill) => fill.id === 'faction:0:1519')?.fill).toEqual({ pattern: 'alliance' });
    console.log(`MP.10 zone fills: ${String(fills?.tint.length)} tints, ${String(fills?.faction.length)} faction fills; patterns ${JSON.stringify(Object.fromEntries(['alliance', 'horde', 'both', 'none', 'sanctuary'].map((p) => [p, fills?.faction.filter((fill) => 'pattern' in fill.fill && fill.fill.pattern === p).length])))}`);
    pipeline.dispose();
  });
});
