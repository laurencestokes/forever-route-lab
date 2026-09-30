import type { LocalCasc } from '../../../casc/casc';
import { readDb2 } from '../../../casc/db2';
import { DB2, type Db2Table } from '../../../casc/layouts';
import type { Wdc5Table } from '../../../casc/wdc5';
import { CLIENT_DB2 } from './layouts';

/**
 * Reads the client tables the committed client tables are built from (map-presentation.md §16;
 * D-039 B, C and E), read-only through `tools/casc`, into plain rows holding only the columns the
 * builders use. Nothing read here is written anywhere except as the derived files' selected
 * columns (tools/casc README: no raw client file leaves memory).
 *
 * The taxi tables, `ContentTuning` and `UiMapAssignment` are required complete. `AreaTable`, `Map`
 * and `LFGDungeons` each have encrypted sections at 1.60.1.70009 (46, 8 and 5 rows); those rows
 * are unknown, are skipped, and their count is recorded in the manifest and the files.
 */

export interface TableInput {
  readonly table: string;
  readonly fileDataId: number;
  /** The file's CKey (MD5 of its decoded bytes) as the root manifest records it. */
  readonly ckey: string;
  /** The layout hash the file was parsed with (WoWDBDefs). */
  readonly layoutHash: string;
  /** Rows decoded. */
  readonly rows: number;
  /** Rows in encrypted sections that were skipped (unknown). */
  readonly skippedRows: number;
  /** The encrypted sections' TACT key names, ascending (empty when none were skipped). */
  readonly skippedKeys: readonly string[];
}

export interface TaxiNodeRow {
  readonly id: number;
  readonly name: string;
  readonly mapId: number;
  readonly x: number;
  readonly y: number;
  readonly flags: number;
}

export interface TaxiPathRow {
  readonly id: number;
  readonly from: number;
  readonly to: number;
  readonly cost: number;
}

export interface TaxiPathPointRow {
  readonly id: number;
  readonly pathId: number;
  readonly index: number;
  readonly mapId: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly flags: number;
  readonly delay: number;
}

export interface AreaRow {
  readonly id: number;
  readonly name: string;
  readonly mapId: number;
  readonly parentId: number;
  readonly factionGroupMask: number;
  /** `Flags[0]`. */
  readonly flags0: number;
}

export interface AssignmentRow {
  readonly id: number;
  readonly areaId: number;
}

export interface LfgRow {
  readonly id: number;
  readonly name: string;
  readonly typeId: number;
  readonly contentTuningId: number;
}

export interface ContentTuningRow {
  readonly id: number;
  readonly minLevelSquish: number;
  readonly maxLevelSquish: number;
  readonly lfgMinLevel: number;
  readonly lfgMaxLevel: number;
}

export interface MapRow {
  readonly id: number;
  readonly name: string;
  readonly instanceType: number;
}

export interface ClientTableRows {
  readonly taxiNodes: readonly TaxiNodeRow[];
  readonly taxiPaths: readonly TaxiPathRow[];
  readonly taxiPathPoints: readonly TaxiPathPointRow[];
  readonly areas: readonly AreaRow[];
  readonly assignments: readonly AssignmentRow[];
  readonly lfg: readonly LfgRow[];
  readonly contentTuning: readonly ContentTuningRow[];
  readonly maps: readonly MapRow[];
}

export interface ClientTablesRead {
  readonly rows: ClientTableRows;
  /** Every table read, ascending by FileDataID. */
  readonly inputs: readonly TableInput[];
}

function read(casc: LocalCasc, name: string, table: Db2Table, requireComplete: boolean, inputs: TableInput[]): Wdc5Table {
  const parsed = readDb2(casc, table, { requireComplete });
  const ckey = casc.ckeyOf(table.fileDataId);
  if (ckey === null) throw new Error(`${name}: FileDataID ${String(table.fileDataId)} has no CKey in the root manifest`);
  const skipped = parsed.skippedSections;
  inputs.push({
    table: name,
    fileDataId: table.fileDataId,
    ckey,
    layoutHash: table.layout.layoutHash,
    rows: parsed.rows.length,
    skippedRows: skipped.reduce((sum, s) => sum + s.recordCount, 0),
    skippedKeys: [...new Set(skipped.map((s) => s.tactKeyHash))].sort(),
  });
  return parsed;
}

/** Reads the eight tables from an opened, pinned client. */
export function readClientTableRows(casc: LocalCasc): ClientTablesRead {
  const inputs: TableInput[] = [];
  const nodes = read(casc, 'TaxiNodes', CLIENT_DB2.TaxiNodes, true, inputs);
  const paths = read(casc, 'TaxiPath', CLIENT_DB2.TaxiPath, true, inputs);
  const points = read(casc, 'TaxiPathNode', CLIENT_DB2.TaxiPathNode, true, inputs);
  const areas = read(casc, 'AreaTable', DB2.AreaTable, false, inputs);
  const assignments = read(casc, 'UiMapAssignment', DB2.UiMapAssignment, true, inputs);
  const lfg = read(casc, 'LFGDungeons', CLIENT_DB2.LFGDungeons, false, inputs);
  const tuning = read(casc, 'ContentTuning', CLIENT_DB2.ContentTuning, true, inputs);
  const maps = read(casc, 'Map', DB2.Map, false, inputs);
  const at = (values: readonly number[], index: number, what: string): number => {
    const value = values[index];
    if (value === undefined) throw new Error(`${what} has no element ${String(index)}`);
    return value;
  };
  return {
    rows: {
      taxiNodes: nodes.rows.map((r) => {
        const pos = r.nums('Pos');
        return { id: r.id, name: r.str('Name_lang'), mapId: r.num('ContinentID'), x: at(pos, 0, `TaxiNodes ${String(r.id)} Pos`), y: at(pos, 1, `TaxiNodes ${String(r.id)} Pos`), flags: r.num('Flags') };
      }),
      taxiPaths: paths.rows.map((r) => ({ id: r.id, from: r.num('FromTaxiNode'), to: r.num('ToTaxiNode'), cost: r.num('Cost') })),
      taxiPathPoints: points.rows.map((r) => {
        const loc = r.nums('Loc');
        const where = `TaxiPathNode ${String(r.id)} Loc`;
        return {
          id: r.id,
          pathId: r.num('PathID'),
          index: r.num('NodeIndex'),
          mapId: r.num('ContinentID'),
          x: at(loc, 0, where),
          y: at(loc, 1, where),
          z: at(loc, 2, where),
          flags: r.num('Flags'),
          delay: r.num('Delay'),
        };
      }),
      areas: areas.rows.map((r) => ({
        id: r.id,
        name: r.str('AreaName_lang'),
        mapId: r.num('ContinentID'),
        parentId: r.num('ParentAreaID'),
        factionGroupMask: r.num('FactionGroupMask'),
        flags0: at(r.nums('Flags'), 0, `AreaTable ${String(r.id)} Flags`),
      })),
      assignments: assignments.rows.map((r) => ({ id: r.id, areaId: r.num('AreaID') })),
      lfg: lfg.rows.map((r) => ({ id: r.id, name: r.str('Name_lang'), typeId: r.num('TypeID'), contentTuningId: r.num('ContentTuningID') })),
      contentTuning: tuning.rows.map((r) => ({
        id: r.id,
        minLevelSquish: r.num('MinLevelSquish'),
        maxLevelSquish: r.num('MaxLevelSquish'),
        lfgMinLevel: r.num('LfgMinLevel'),
        lfgMaxLevel: r.num('LfgMaxLevel'),
      })),
      maps: maps.rows.map((r) => ({ id: r.id, name: r.str('MapName_lang'), instanceType: r.num('InstanceType') })),
    },
    inputs: [...inputs].sort((a, b) => a.fileDataId - b.fileDataId),
  };
}
