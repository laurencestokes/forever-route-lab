import { describe, expect, it } from 'vitest';
import { areaId, worldMapId } from '../domain/ids';
import { fixtureGeometry } from '../geo/test-fixtures';
import type { ClientZones } from '../infra/maps/client-tables';
import { zoneShapesOf } from './map-labels';
import { buildZoneFill, factionWords } from './map-zone-fill';

/**
 * The zone fills (map-presentation.md §12.4, §12.6; D-039 C; step MP.10): a pattern and words per
 * faction mask value and the sanctuary flag, never a hue; the fallback tint per zone; the zone as the
 * fill's ref (so a click jumps to it), and what cannot be drawn said in the notes.
 */

const KALIMDOR = worldMapId(1);
const square = (x0: number, y0: number) => [
  { mapId: KALIMDOR, x: x0, y: y0 },
  { mapId: KALIMDOR, x: x0 + 100, y: y0 },
  { mapId: KALIMDOR, x: x0 + 100, y: y0 + 100 },
  { mapId: KALIMDOR, x: x0, y: y0 + 100 },
  { mapId: KALIMDOR, x: x0, y: y0 },
];
// Durotar (14, UiMap 1411), The Barrens (17, UiMap 1413), and an area no UiMap frames (9999).
const shapes = new Map([[KALIMDOR, zoneShapesOf(KALIMDOR, [square(0, 0), square(500, 0), square(1000, 0)], [[14, 0], [17, 0], [9999, 0]])]]);
const zones: ClientZones = {
  build: 'test',
  zones: [
    { areaId: areaId(14), mapId: KALIMDOR, name: 'Durotar', factionGroupMask: 4, sanctuary: false },
    { areaId: areaId(17), mapId: KALIMDOR, name: 'The Barrens', factionGroupMask: 0, sanctuary: false },
  ],
};
const input = { geometry: fixtureGeometry(), shapes, zones, zonesFailure: null, tints: { byArea: new Map([['1:14', '#886f4b']]) }, tintsFailure: null };

describe('factionWords (§12.6)', () => {
  it('gives each value its pattern and words, never "contested" from the mask alone', () => {
    expect(factionWords(2, false)).toEqual({ pattern: 'alliance', words: 'Alliance territory' });
    expect(factionWords(4, false)).toEqual({ pattern: 'horde', words: 'Horde territory' });
    expect(factionWords(6, false)).toEqual({ pattern: 'both', words: 'Alliance and Horde (client value 6)' });
    expect(factionWords(0, false)).toEqual({ pattern: 'none', words: 'No faction territory in the client (contested or unset)' });
    expect(factionWords(0, true)).toEqual({ pattern: 'sanctuary', words: 'Sanctuary (client flag)' });
    expect(factionWords(8, false).pattern).toBe('none');
  });
});

describe('buildZoneFill', () => {
  it('draws the faction overlay over each listed zone’s rings, with its words and the zone to jump to', () => {
    const model = buildZoneFill(input);
    expect(model.faction.map((fill) => [fill.id, fill.fill, fill.ref])).toEqual([
      ['faction:1:14', { pattern: 'horde' }, { kind: 'zone', uiMapId: 1411 }],
      ['faction:1:17', { pattern: 'none' }, { kind: 'zone', uiMapId: 1413 }],
    ]);
    expect(model.faction[0]?.label).toBe('Durotar: Horde territory (client AreaTable FactionGroupMask 4; an INFERRED decode)');
    expect(model.faction[0]?.rings).toHaveLength(1);
    expect(model.notes.join(' ')).toContain('1 area has no client zone row: no faction drawn.');
  });

  it('draws the tint of each zone the tint file lists, saying nothing (a picture)', () => {
    const model = buildZoneFill(input);
    expect(model.tint.map((fill) => [fill.id, fill.fill, fill.label])).toEqual([['tint:1:14', { tint: '#886f4b' }, null]]);
    expect(model.notes.join(' ')).toContain('2 areas have no tint (no painted pixel).');
  });

  it('says why a table failed, and draws nothing of it', () => {
    const model = buildZoneFill({ ...input, zones: null, zonesFailure: 'HTTP 404', tints: null, tintsFailure: 'integrity check' });
    expect(model.faction).toEqual([]);
    expect(model.tint).toEqual([]);
    expect(model.notes).toContain('The client zone table could not be used (HTTP 404): no faction overlay.');
    expect(model.notes).toContain('The zone tints could not be used (integrity check): no fallback tint.');
  });
});
