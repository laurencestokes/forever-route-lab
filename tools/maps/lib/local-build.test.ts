import { describe, expect, it } from 'vitest';
import { parseGeometryFile } from '../../../src/geo/geometry';
import { syntheticArtWorld } from './art-test-support';
import type { ClientMapTables } from './client-tables';
import { formatJson } from './json';
import { localGeometryFromClient } from './local-build';

const client = { product: 'wow_classic_beta', version: '1.60.1.70009' };

describe('import --build: the local geometry from the client tables', () => {
  const { tables } = syntheticArtWorld();

  it('writes every UiMap with its rows as a local-only geometry the app parser accepts', () => {
    const geometry = localGeometryFromClient(tables, client);
    expect(geometry).toMatchObject({ kind: 'local', redistribution: 'local-only', product: 'wow_classic_beta', build: '1.60.1.70009', eraToForever: {} });
    expect(geometry['inputs']).toEqual({ tables: { UiMap: { rows: 2, fileDataId: 1957206, ckey: 'a'.repeat(32) }, UiMapAssignment: { rows: 3, fileDataId: 1957219, ckey: 'b'.repeat(32) } } });
    const parsed = parseGeometryFile(JSON.parse(formatJson(geometry)) as unknown);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const durotar = parsed.geometry.maps.get(1411 as never);
    expect(durotar?.assignments[0]).toMatchObject({ id: 46721, mapId: 1, areaId: 14, orderIndex: 0, xMin: -1716.6666259765625, xMax: 1808.333251953125, source: 'local-db2', build: '1.60.1.70009' });
    expect(parsed.geometry.maps.get(947 as never)?.assignments.map((r) => r.orderIndex)).toEqual([0, 1]);
  });

  it('refuses rows the format cannot carry and rows of unknown UiMaps', () => {
    const edit = (change: Partial<ClientMapTables['assignments'][number]>): ClientMapTables => ({
      ...tables,
      assignments: tables.assignments.map((r, i) => (i === 0 ? { ...r, ...change } : r)),
    });
    expect(() => localGeometryFromClient(edit({ wmoGroupId: 5 }), client)).toThrow(/UiMapAssignment 46721: Z or WMO restriction/);
    expect(() => localGeometryFromClient(edit({ region: [0, 0, -5, 1, 1, 5] }), client)).toThrow(/Z or WMO restriction/);
    expect(() => localGeometryFromClient(edit({ uiMapId: 9999 }), client)).toThrow(/rows 46721 name a UiMap that does not exist/);
  });
});
