import { LocalCasc } from '../../casc/casc';
import { readDb2 } from '../../casc/db2';
import { DB2 } from '../../casc/layouts';
import { resolveInstall } from '../../casc/paths';
import { hazardLiquidTypes } from './formats/liquid';
import { parseWdt, type Wdt } from './formats/wdt';
import type { FileSource } from './geometry';
import type { BuildConfig } from './settings';
import { areaParents, wmoAreaIndex, type WmoAreaIndex } from './zones';

/**
 * The pinned client and the tables every block needs (terrain-navigation.md §2; D-028, TN-16).
 * The install comes from `WOW_INSTALL` (`resolveInstall`); `tools/casc` reads only `.build.info`
 * and `Data/`, read-only, and refuses any other build than the pin (gate G1). Nothing read here is
 * ever written anywhere: outputs are derived meshes and statistics.
 */

export interface InputFile {
  readonly fileDataId: number;
  readonly ckey: string;
}

export interface ClientTables {
  readonly casc: LocalCasc;
  readonly hazardLiquids: ReadonlySet<number>;
  readonly wmoAreas: WmoAreaIndex;
  readonly parents: ReadonlyMap<number, number>;
  /** WdtFileDataID per Map ID (Map.db2), for the cross-check against build.json. */
  readonly wdtOfMap: ReadonlyMap<number, number>;
  /** The DB2 tables read, with their CKeys: inputs of every block. */
  readonly tableInputs: readonly InputFile[];
}

export function openClient(config: BuildConfig, env: NodeJS.ProcessEnv = process.env): LocalCasc {
  return LocalCasc.open({ install: resolveInstall(env), product: config.pin.product, pin: config.pin });
}

export function ckeyOf(casc: LocalCasc, fileDataId: number): string {
  const ckey = casc.ckeyOf(fileDataId);
  if (ckey === null) throw new Error(`FileDataID ${String(fileDataId)} is not in the client's root manifest`);
  return ckey;
}

export function readTables(casc: LocalCasc): ClientTables {
  const liquid = readDb2(casc, DB2.LiquidType, { requireComplete: true });
  const wmo = readDb2(casc, DB2.WMOAreaTable, { requireComplete: true });
  const areas = readDb2(casc, DB2.AreaTable);
  const maps = readDb2(casc, DB2.Map);
  const wdtOfMap = new Map<number, number>();
  for (const r of maps.rows) wdtOfMap.set(r.id, r.num('WdtFileDataID'));
  const tableInputs = [DB2.AreaTable, DB2.LiquidType, DB2.Map, DB2.WMOAreaTable]
    .map((t) => ({ fileDataId: t.fileDataId, ckey: ckeyOf(casc, t.fileDataId) }))
    .sort((a, b) => a.fileDataId - b.fileDataId);
  return {
    casc,
    hazardLiquids: hazardLiquidTypes(liquid.rows.map((r) => ({ id: r.id, soundBank: r.num('SoundBank') }))),
    wmoAreas: wmoAreaIndex(wmo.rows.map((r) => ({ wmoId: r.num('WMOID'), nameSet: r.num('NameSetID'), groupId: r.num('WMOGroupID'), areaId: r.num('AreaTableID') }))),
    parents: areaParents(areas.rows.map((r) => ({ id: r.id, parent: r.num('ParentAreaID') }))),
    wdtOfMap,
    tableInputs,
  };
}

/** The map's WDT, checked against `Map.WdtFileDataID`. */
export function readMapWdt(tables: ClientTables, mapId: number, wdtFileDataId: number): { wdt: Wdt; present: Set<number>; input: InputFile } {
  const fromTable = tables.wdtOfMap.get(mapId);
  if (fromTable !== wdtFileDataId) throw new Error(`build.json names WDT ${String(wdtFileDataId)} for map ${String(mapId)}, Map.db2 says ${String(fromTable)}`);
  const wdt = parseWdt(tables.casc.file(wdtFileDataId).data);
  const present = new Set(wdt.tiles.filter((t) => t.rootAdt !== 0).map((t) => t.row * 64 + t.col));
  return { wdt, present, input: { fileDataId: wdtFileDataId, ckey: ckeyOf(tables.casc, wdtFileDataId) } };
}

/** A FileSource over the client: every read is MD5-checked and fails closed on a missing or encrypted file (gate G2). */
export const cascSource = (casc: LocalCasc): FileSource => ({ read: (id) => casc.file(id).data });
