import { describe, expect, it } from 'vitest';
import { syntheticArtWorld } from './art-test-support';
import { artFileName, planArt, planFileDataIds, type ArtTables } from './art-plan';

const world = (): ArtTables => syntheticArtWorld().tables.art;

describe('planning the art of each UiMap', () => {
  it('places base tiles on the layer grid and overlay tiles at their offsets, in UiMap and overlay ID order', () => {
    const report = planArt(world());
    expect(report.plans.map((p) => [p.uiMapId, p.name, p.width, p.height, p.tiles.length, p.overlays.length])).toEqual([
      [947, 'Azeroth', 4, 4, 1, 0],
      [1411, 'Durotar', 10, 6, 6, 1],
    ]);
    const durotar = report.plans[1];
    expect(durotar?.tiles.map((t) => [t.row, t.col, t.x, t.y, t.fileDataId])).toEqual([
      [0, 0, 0, 0, 1000],
      [0, 1, 4, 0, 1001],
      [0, 2, 8, 0, 1002],
      [1, 0, 0, 4, 1003],
      [1, 1, 4, 4, 1004],
      [1, 2, 8, 4, 1005],
    ]);
    const overlay = durotar?.overlays[0];
    expect(overlay).toMatchObject({ id: 7, areaIds: [370], rect: { x: 2, y: 1, width: 5, height: 3 }, clip: { x0: 2, y0: 1, x1: 7, y1: 4 } });
    expect(overlay?.tiles.map((t) => [t.x, t.y, t.fileDataId])).toEqual([
      [2, 1, 2000],
      [6, 1, 2001],
    ]);
    expect(report.skippedOverlays).toEqual([{ uiMapId: 1411, overlayId: 8, reason: 'no WorldMapOverlayTile rows' }]);
    expect(report.skippedUiMaps).toEqual([]);
    expect(durotar === undefined ? [] : planFileDataIds(durotar)).toEqual([1000, 1001, 1002, 1003, 1004, 1005, 2000, 2001]);
  });

  it('names files by UiMap and layer', () => {
    expect(artFileName({ uiMapId: 1411, layerIndex: 0 }, 'webp')).toBe('1411.webp');
    expect(artFileName({ uiMapId: 1411, layerIndex: 2 }, 'webp')).toBe('1411-2.webp');
  });

  it('plans one image per style layer', () => {
    const t = world();
    const layered: ArtTables = {
      ...t,
      styleLayers: [...t.styleLayers, { id: 3, styleId: 2, layerIndex: 1, layerWidth: 8, layerHeight: 8, tileWidth: 4, tileHeight: 4 }],
      artTiles: [...t.artTiles, ...[0, 1, 2, 3].map((k) => ({ id: 100 + k, uiMapArtId: 21, row: Math.floor(k / 2), col: k % 2, layerIndex: 1, fileDataId: 3000 + k }))],
    };
    expect(planArt(layered).plans.map((p) => [p.uiMapId, p.layerIndex, p.tiles.length])).toEqual([
      [947, 0, 1],
      [947, 1, 4],
      [1411, 0, 6],
    ]);
  });

  it('skips UiMaps without art or with phased art only, and overlays with a player condition', () => {
    const t = world();
    const report = planArt({
      ...t,
      uiMaps: [...t.uiMaps, { id: 1500, name: 'No art', type: 3, parent: 1414 }, { id: 1501, name: 'Phased', type: 3, parent: 1414 }],
      xMapArt: [...t.xMapArt, { id: 9, uiMapId: 1501, uiMapArtId: 20, phaseId: 12 }],
      overlays: t.overlays.map((o) => (o.id === 7 ? { ...o, playerConditionId: 55 } : o)),
    });
    expect(report.skippedUiMaps).toEqual([
      { uiMapId: 1500, reason: 'no UiMapXMapArt row' },
      { uiMapId: 1501, reason: 'only phased art (PhaseID 12)' },
    ]);
    expect(report.skippedOverlays.map((s) => [s.overlayId, s.reason])).toEqual([
      [7, 'PlayerConditionID 55'],
      [8, 'no WorldMapOverlayTile rows'],
    ]);
  });

  it.each([
    ['a missing base tile', (t: ArtTables): ArtTables => ({ ...t, artTiles: t.artTiles.slice(1) }), /5 tiles for a 2 × 3 grid/],
    ['two tiles in one cell', (t: ArtTables): ArtTables => ({ ...t, artTiles: [...t.artTiles, { ...t.artTiles[0]!, id: 99 }] }), /two tiles at \(0, 0\)/],
    ['a tile outside the grid', (t: ArtTables): ArtTables => ({ ...t, artTiles: [...t.artTiles.slice(1), { ...t.artTiles[0]!, row: 5 }] }), /outside its 2 × 3 grid/],
    ['a missing UiMapArt', (t: ArtTables): ArtTables => ({ ...t, art: t.art.slice(1) }), /UiMapArt 20 does not exist/],
    ['a style without layers', (t: ArtTables): ArtTables => ({ ...t, styleLayers: t.styleLayers.slice(1) }), /has no UiMapArtStyleLayer/],
    ['two phase-0 links', (t: ArtTables): ArtTables => ({ ...t, xMapArt: [...t.xMapArt, { id: 10, uiMapId: 1411, uiMapArtId: 20, phaseId: 0 }] }), /2 UiMapXMapArt rows for phase 0/],
    ['an overlay tile missing', (t: ArtTables): ArtTables => ({ ...t, overlayTiles: t.overlayTiles.slice(1) }), /overlay 7: 1 tiles for a 1 × 2 grid/],
  ])('fails closed on %s', (_, edit, message) => {
    expect(() => planArt(edit(world()))).toThrow(message);
  });
});
