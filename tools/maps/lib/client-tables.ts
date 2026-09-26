import type { LocalCasc } from '../../casc/casc';
import { readDb2 } from '../../casc/db2';
import { DB2, LAYOUT_BUILD, type Db2Table } from '../../casc/layouts';
import type { Wdc5Table } from '../../casc/wdc5';
import type { ArtTables } from './art-plan';

/**
 * The map tables read straight from the client through `tools/casc` (docs/MAPS.md §3, §5.4;
 * terrain-navigation.md §15): what `convert.ts` plans the art from and what `import.ts --build`
 * writes the local geometry from. Every column read here equals the research CSVs at
 * 1.60.1.70009 (`tools/casc/casc.client.test.ts`). Each table is required complete: none of these
 * has an encrypted section at the pin, and a skipped section would silently drop rows.
 */

export interface TableInput {
  readonly table: string;
  readonly fileDataId: number;
  /** The file's CKey (MD5 of its decoded bytes) as the root manifest records it. */
  readonly ckey: string;
  readonly rows: number;
}

export interface AssignmentRow {
  readonly id: number;
  readonly uiMapId: number;
  readonly orderIndex: number;
  readonly mapId: number;
  readonly areaId: number;
  /** `Region_0 … Region_5`: min X, min Y, min Z, max X, max Y, max Z (world yards). */
  readonly region: readonly number[];
  readonly uiMin: readonly number[];
  readonly uiMax: readonly number[];
  readonly wmoDoodadPlacementId: number;
  readonly wmoGroupId: number;
}

export interface ClientMapTables {
  readonly art: ArtTables;
  readonly assignments: readonly AssignmentRow[];
  /** The DB2 files read, by table name, ascending by FileDataID. */
  readonly inputs: readonly TableInput[];
  /** The layouts' WoWDBDefs build (`tools/casc/layouts.ts`). */
  readonly layoutBuild: string;
}

function read(casc: LocalCasc, name: string, table: Db2Table, inputs: TableInput[]): Wdc5Table {
  const parsed = readDb2(casc, table, { requireComplete: true });
  const ckey = casc.ckeyOf(table.fileDataId);
  if (ckey === null) throw new Error(`${name}: FileDataID ${String(table.fileDataId)} has no CKey in the root manifest`);
  inputs.push({ table: name, fileDataId: table.fileDataId, ckey, rows: parsed.rows.length });
  return parsed;
}

export function readClientMapTables(casc: LocalCasc): ClientMapTables {
  const inputs: TableInput[] = [];
  const uiMap = read(casc, 'UiMap', DB2.UiMap, inputs);
  const assignment = read(casc, 'UiMapAssignment', DB2.UiMapAssignment, inputs);
  const xMapArt = read(casc, 'UiMapXMapArt', DB2.UiMapXMapArt, inputs);
  const art = read(casc, 'UiMapArt', DB2.UiMapArt, inputs);
  const style = read(casc, 'UiMapArtStyleLayer', DB2.UiMapArtStyleLayer, inputs);
  const tile = read(casc, 'UiMapArtTile', DB2.UiMapArtTile, inputs);
  const overlay = read(casc, 'WorldMapOverlay', DB2.WorldMapOverlay, inputs);
  const overlayTile = read(casc, 'WorldMapOverlayTile', DB2.WorldMapOverlayTile, inputs);
  return {
    art: {
      uiMaps: uiMap.rows.map((r) => ({ id: r.id, name: r.str('Name_lang'), type: r.num('Type'), parent: r.num('ParentUiMapID') })),
      xMapArt: xMapArt.rows.map((r) => ({ id: r.id, uiMapId: r.num('UiMapID'), uiMapArtId: r.num('UiMapArtID'), phaseId: r.num('PhaseID') })),
      art: art.rows.map((r) => ({ id: r.id, styleId: r.num('UiMapArtStyleID') })),
      styleLayers: style.rows.map((r) => ({
        id: r.id,
        styleId: r.num('UiMapArtStyleID'),
        layerIndex: r.num('LayerIndex'),
        layerWidth: r.num('LayerWidth'),
        layerHeight: r.num('LayerHeight'),
        tileWidth: r.num('TileWidth'),
        tileHeight: r.num('TileHeight'),
      })),
      artTiles: tile.rows.map((r) => ({ id: r.id, uiMapArtId: r.num('UiMapArtID'), row: r.num('RowIndex'), col: r.num('ColIndex'), layerIndex: r.num('LayerIndex'), fileDataId: r.num('FileDataID') })),
      overlays: overlay.rows.map((r) => ({
        id: r.id,
        uiMapArtId: r.num('UiMapArtID'),
        textureWidth: r.num('TextureWidth'),
        textureHeight: r.num('TextureHeight'),
        offsetX: r.num('OffsetX'),
        offsetY: r.num('OffsetY'),
        playerConditionId: r.num('PlayerConditionID'),
        flags: r.num('Flags'),
        areaIds: r.nums('AreaID'),
      })),
      overlayTiles: overlayTile.rows.map((r) => ({
        id: r.id,
        overlayId: r.num('WorldMapOverlayID'),
        row: r.num('RowIndex'),
        col: r.num('ColIndex'),
        layerIndex: r.num('LayerIndex'),
        fileDataId: r.num('FileDataID'),
      })),
    },
    assignments: assignment.rows.map((r) => ({
      id: r.id,
      uiMapId: r.num('UiMapID'),
      orderIndex: r.num('OrderIndex'),
      mapId: r.num('MapID'),
      areaId: r.num('AreaID'),
      region: r.nums('Region'),
      uiMin: r.nums('UiMin'),
      uiMax: r.nums('UiMax'),
      wmoDoodadPlacementId: r.num('WMODoodadPlacementID'),
      wmoGroupId: r.num('WMOGroupID'),
    })),
    inputs: [...inputs].sort((a, b) => a.fileDataId - b.fileDataId),
    layoutBuild: LAYOUT_BUILD,
  };
}
