import type { AssignmentRow, ClientMapTables } from './client-tables';

/**
 * `local-maps/geometry.local.json` from the client's own tables (docs/MAPS.md §5.3, §5.4 (a);
 * terrain-navigation.md §15): what `import.ts --build` writes. Every `UiMap` with its
 * `UiMapAssignment` rows, `source: "local-db2"`, `"redistribution": "local-only"`. The values are
 * the float32s the DB2 stores, written in their shortest round-trip double form, so the frame
 * check (which applies `Math.fround`) compares them exactly with the committed rows.
 *
 * Rows the geometry format cannot carry are refused, as the placeholder importer refuses them: a Z
 * restriction (`Region_2`/`Region_5` not ∓1,000,000) or a WMO restriction. The set is local only:
 * `validate.ts --activate` checks it and writes `maps.manifest.json`.
 */

export const LOCAL_BUILD_SOURCE = 'local-db2';

function row(r: AssignmentRow, build: string): Readonly<Record<string, unknown>> {
  const [xMin, yMin, zMin, xMax, yMax, zMax] = r.region;
  const what = `UiMapAssignment ${String(r.id)}`;
  if ([xMin, yMin, zMin, xMax, yMax, zMax].some((v) => v === undefined)) throw new Error(`${what}: Region has fewer than 6 values`);
  if (zMin !== -1000000 || zMax !== 1000000 || r.wmoDoodadPlacementId !== 0 || r.wmoGroupId !== 0) {
    throw new Error(`${what}: Z or WMO restriction the geometry format cannot carry`);
  }
  return {
    id: r.id,
    mapId: r.mapId,
    areaId: r.areaId,
    orderIndex: r.orderIndex,
    xMin,
    xMax,
    yMin,
    yMax,
    uiMin: [r.uiMin[0], r.uiMin[1]],
    uiMax: [r.uiMax[0], r.uiMax[1]],
    source: LOCAL_BUILD_SOURCE,
    build,
  };
}

export function localGeometryFromClient(tables: ClientMapTables, client: { readonly product: string; readonly version: string }): Readonly<Record<string, unknown>> {
  const maps: Record<string, unknown> = {};
  for (const uiMap of [...tables.art.uiMaps].sort((a, b) => a.id - b.id)) {
    const rows = tables.assignments.filter((r) => r.uiMapId === uiMap.id).sort((a, b) => a.orderIndex - b.orderIndex || a.id - b.id);
    if (rows.length === 0) continue;
    if (uiMap.name === '') throw new Error(`UiMap ${String(uiMap.id)} has no Name_lang`);
    maps[String(uiMap.id)] = {
      name: uiMap.name,
      nameSource: LOCAL_BUILD_SOURCE,
      type: uiMap.type,
      parent: uiMap.parent,
      assignments: rows.map((r) => row(r, client.version)),
    };
  }
  const known = new Set(tables.art.uiMaps.map((m) => m.id));
  const orphans = tables.assignments.filter((r) => !known.has(r.uiMapId)).map((r) => r.id);
  if (orphans.length > 0) throw new Error(`UiMapAssignment rows ${orphans.join(', ')} name a UiMap that does not exist`);
  const tableEntry = (name: string): Readonly<Record<string, unknown>> => {
    const t = tables.inputs.find((i) => i.table === name);
    if (t === undefined) throw new Error(`${name} was not read`);
    return { rows: t.rows, fileDataId: t.fileDataId, ckey: t.ckey };
  };
  return {
    _generated: {
      by: 'tools/maps import --build',
      upstream: `the local ${client.product} ${client.version} client through tools/casc (UiMap, UiMapAssignment)`,
      edit: 'local only; never commit or deploy (D-018); activate with pnpm tsx tools/maps/validate.ts --activate',
    },
    schema: 1,
    kind: 'local',
    redistribution: 'local-only',
    product: client.product,
    build: client.version,
    inputs: { tables: { UiMap: tableEntry('UiMap'), UiMapAssignment: tableEntry('UiMapAssignment') } },
    maps,
    eraToForever: {},
  };
}
