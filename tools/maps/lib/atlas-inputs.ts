import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { atlasPlacements } from '../../../src/geo/atlas';
import { ATLAS_LAYOUT } from '../../../src/geo/atlas-layout';
import { parseGeometryFile } from '../../../src/geo/geometry';
import type { LocalCasc } from '../../casc/casc';
import { composeSourceRasters } from './art-build';
import { ART_DIR, ART_MANIFEST_FILE, parseArtManifest } from './art-manifest';
import { planArt } from './art-plan';
import type { AtlasBuildInputs, AtlasRasterInput, TerrainMapInput } from './atlas-build';
import { ATLAS_LABELS_FILE, parseAtlasLabels } from './atlas-labels';
import { ATLAS_PARAMS } from './atlas-params';
import { planAtlas, type PlanAssignment, type PlanUiMap } from './atlas-plan';
import { readClientMapTables } from './client-tables';
import { GEOMETRY_FILE, PLACEHOLDER_DIR } from './constants';
import { lfBytes, sha256Hex } from './hash';

/**
 * Reads the atlas build's inputs (docs/research/map-atlas.md §7.4): the committed files (the
 * placeholder geometry, the art manifest's `sources` records, the terrain byproducts and the label
 * list) and, from the client through `tools/casc`, the lossless rasters of the paintings the atlas
 * draws, composed exactly as `convert.ts` composes them (`composeSourceRasters`).
 */

export const TERRAIN_DIR = 'public/maps/terrain';

export type CommittedAtlasInputs = Pick<AtlasBuildInputs, 'layout' | 'geometry' | 'artSources' | 'terrain' | 'labels' | 'labelsFile'>;
export type ClientAtlasInputs = Pick<AtlasBuildInputs, 'uiMaps' | 'assignments' | 'artSize' | 'rasters'>;

function readTerrain(repoRoot: string): TerrainMapInput[] {
  const manifest = JSON.parse(readFileSync(join(repoRoot, TERRAIN_DIR, 'manifest.json'), 'utf8')) as {
    files: { path: string; mapId: number; sha256: string; kind: string; rect: TerrainMapInput['rect']; pixelYd?: number }[];
  };
  const out: TerrainMapInput[] = [];
  for (const mapId of [0, 1]) {
    const relief = manifest.files.find((f) => f.mapId === mapId && f.kind === 'relief');
    const zones = manifest.files.find((f) => f.mapId === mapId && f.kind === 'zones');
    if (relief === undefined || zones === undefined || relief.pixelYd === undefined) throw new Error(`the terrain manifest lacks the relief or zones of map ${String(mapId)}`);
    out.push({
      mapId,
      reliefPath: relief.path,
      reliefPng: readFileSync(join(repoRoot, TERRAIN_DIR, relief.path)),
      reliefSha256: relief.sha256,
      zonesPath: zones.path,
      // committed text: its LF bytes, which the terrain manifest's SHA-256 covers
      zonesBytes: lfBytes(readFileSync(join(repoRoot, TERRAIN_DIR, zones.path))),
      zonesSha256: zones.sha256,
      rect: relief.rect,
      pixelYd: relief.pixelYd,
    });
  }
  return out;
}

/** The committed inputs, parsed; throws naming the file on any problem. */
export function readAtlasInputs(repoRoot: string): CommittedAtlasInputs {
  const geometry = parseGeometryFile(JSON.parse(lfBytes(readFileSync(join(repoRoot, PLACEHOLDER_DIR, GEOMETRY_FILE))).toString('utf8')) as unknown);
  if (!geometry.ok) throw new Error(`the committed placeholder geometry does not parse: ${geometry.errors.join('; ')}`);
  const art = parseArtManifest(JSON.parse(lfBytes(readFileSync(join(repoRoot, ART_DIR, ART_MANIFEST_FILE))).toString('utf8')) as unknown);
  if (art.manifest === null) throw new Error(`the art manifest does not parse: ${art.errors.join('; ')}`);
  const labelsBytes = lfBytes(readFileSync(join(repoRoot, ATLAS_LABELS_FILE)));
  const labels = parseAtlasLabels(JSON.parse(labelsBytes.toString('utf8')) as unknown);
  if (labels.list === null) throw new Error(`${ATLAS_LABELS_FILE}: ${labels.errors.join('; ')}`);
  return {
    layout: ATLAS_LAYOUT,
    geometry: geometry.geometry,
    artSources: art.manifest.sources,
    terrain: readTerrain(repoRoot),
    labels: labels.list,
    labelsFile: { path: ATLAS_LABELS_FILE, sha256: sha256Hex(labelsBytes) },
  };
}

/** The client's tables, and the rasters of every painting the atlas plan draws or reads. */
export function readAtlasClient(casc: LocalCasc, committed: CommittedAtlasInputs): ClientAtlasInputs {
  const placements = atlasPlacements(committed.geometry, committed.layout);
  if (placements === null) throw new Error('the committed geometry cannot place the atlas layout');
  const tables = readClientMapTables(casc);
  const planned = planArt(tables.art);
  const artSize = new Map(planned.plans.filter((p) => p.layerIndex === 0).map((p) => [p.uiMapId, { width: p.width, height: p.height }]));
  const terrainZones = new Map(committed.terrain.map((t) => [t.mapId, (JSON.parse(Buffer.from(t.zonesBytes).toString('utf8')) as { zones: number[] }).zones]));
  const assignments: PlanAssignment[] = tables.assignments.map((a) => ({ id: a.id, uiMapId: a.uiMapId, orderIndex: a.orderIndex, mapId: a.mapId, areaId: a.areaId, region: a.region, uiMin: a.uiMin, uiMax: a.uiMax }));
  const uiMaps: PlanUiMap[] = tables.art.uiMaps.map((u) => ({ id: u.id, name: u.name, type: u.type }));
  const plan = planAtlas({ uiMaps, assignments, artSize, terrainZones, placements, roundUp: ATLAS_PARAMS.roundUp });
  const needed = new Set([...plan.sources.map((s) => s.uiMapId), ...plan.insets.map((i) => i.uiMapId)]);
  const rasters = new Map<number, AtlasRasterInput>();
  const source = {
    tables,
    read: (id: number): { data: Uint8Array; ckey: string } => {
      const file = casc.file(id);
      return { data: file.data, ckey: file.ckey };
    },
  };
  for (const p of planned.plans) {
    if (p.layerIndex !== 0 || !needed.has(p.uiMapId)) continue;
    const composed = composeSourceRasters(p, source);
    rasters.set(p.uiMapId, { full: composed.full, overlays: composed.overlays, record: composed.record });
  }
  return { uiMaps, assignments, artSize, rasters };
}
