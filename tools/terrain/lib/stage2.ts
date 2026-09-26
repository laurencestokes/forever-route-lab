import type { MapGeometry } from '../../../src/geo';
import { runCensus, type Census } from './census';
import { components, type Components } from './components';
import { resolveConnectors, type ConnectorFile, type ResolvedConnector } from './connectors';
import type { NavBlock } from './encode';
import { buildMapMesh, type MapMesh, type MeshParams, type OffMeshLink, type SeamStats } from './link';
import type { MapFile, PassageTag } from './mapfile';
import { tagPassages, type PassageFile } from './passages';
import { filterBlocks, pruneKeep, remapLinks } from './prune';
import type { Derived, Stage2Settings } from './settings';
import { snapIndex } from './snap';
import type { Spawn } from './spawns';
import { shoreDistance, waterKeep, waterSplits, type WaterSplit } from './water';

/**
 * Stage 2 of one map (terrain-navigation.md §3.2): link the stage-1 blocks, add the observed
 * connectors, label components, run the census, apply the water rule, prune, tag the unverified
 * passages, then recompute components and the census.
 *
 * Order: the water rule runs before pruning (as in the measured prototype, `link2.ts`), so the
 * small pieces the water rule cuts off (an offshore swim, say) are pruned by the same rule as any
 * other spawn-free component. §3.2 lists pruning first; the measured sizes and census were made
 * in this order.
 */

export const meshParams = (d: Derived): MeshParams => ({
  cs: d.cs,
  ch: d.ch,
  tileVoxels: d.settings.tileVoxels,
  tileYd: d.tileYd,
  perAdt: d.perAdt,
  blockAdts: d.settings.blockAdts,
  mapOriginZ: d.settings.mapOriginZ,
  climbYd: d.settings.climbYd,
});

export interface Stage2Input {
  readonly mapId: number;
  readonly derived: Derived;
  readonly stage2: Stage2Settings;
  /** Decoded stage-1 blocks in canonical (row0, col0) order. */
  readonly blocks: readonly NavBlock[];
  readonly spawns: readonly Spawn[];
  readonly hintOf: (s: Spawn) => number;
  readonly connectors: ConnectorFile;
  readonly passages: PassageFile;
  readonly geometry: MapGeometry;
}

export interface Stage2Output {
  readonly blocks: readonly NavBlock[];
  readonly mesh: MapMesh;
  readonly comps: Components;
  readonly links: readonly OffMeshLink[];
  readonly connectors: readonly ResolvedConnector[];
  readonly passageTags: readonly PassageTag[];
  readonly mapFile: MapFile;
  readonly census: Census;
  readonly pre: { readonly polygons: number; readonly components: number; readonly main: number; readonly census: Census['counts']; readonly seams: { readonly inner: SeamStats; readonly block: SeamStats; readonly mid: SeamStats } };
  readonly water: { readonly swimPolygons: number; readonly droppedSwimPolygons: number; readonly splits: readonly WaterSplit[] };
  readonly prune: { readonly droppedPolygons: number; readonly droppedComponents: number };
  readonly ms: Readonly<Record<string, number>>;
}

export function mapMeshWithConnectors(blocks: readonly NavBlock[], P: MeshParams, file: ConnectorFile, mapId: number, geometry: MapGeometry, radius: number): { mesh: MapMesh; links: OffMeshLink[]; connectors: ResolvedConnector[] } {
  const bare = buildMapMesh(blocks, P);
  const { connectors, links } = resolveConnectors(file, mapId, geometry, snapIndex(bare, radius));
  return { mesh: links.length === 0 ? bare : buildMapMesh(blocks, P, links), links, connectors };
}

export function runStage2(inp: Stage2Input): Stage2Output {
  const P = meshParams(inp.derived);
  const st = inp.stage2;
  const censusOptions = { minComp: st.snap.ruleBMinPolygons, floorMin: st.census.floorMinPolygons };
  const ms: Record<string, number> = {};
  let t = performance.now();
  const lap = (name: string): void => {
    const now = performance.now();
    ms[name] = now - t;
    t = now;
  };
  // 1-4: link, connectors, components, census
  const first = mapMeshWithConnectors(inp.blocks, P, inp.connectors, inp.mapId, inp.geometry, st.snap.radiusYd);
  const c1 = components(first.mesh);
  const census1 = runCensus(inp.mapId, snapIndex(first.mesh, st.snap.radiusYd), c1, inp.spawns, inp.hintOf, censusOptions);
  lap('link');
  // water rule
  const distance = shoreDistance(first.mesh);
  const keepW = waterKeep(first.mesh, distance, st.water.openWaterYd);
  let swimPolygons = 0;
  let droppedSwim = 0;
  for (let p = 0; p < first.mesh.n; p += 1) {
    if (first.mesh.swim[p] === 1) swimPolygons += 1;
    if (keepW[p] !== 1) droppedSwim += 1;
  }
  const splits = waterSplits(first.mesh, c1, keepW);
  const w = filterBlocks(inp.blocks, keepW);
  const linksW = remapLinks(first.links, w.remap);
  const meshW = buildMapMesh(w.blocks, P, linksW);
  const cW = components(meshW);
  lap('water');
  // pruning, with the census after the water rule
  const censusW = runCensus(inp.mapId, snapIndex(meshW, st.snap.radiusYd), cW, inp.spawns, inp.hintOf, censusOptions);
  const pk = pruneKeep(cW, censusW, st.prune.minComponentPolygons, linksW);
  const f = filterBlocks(w.blocks, pk.keep);
  const links = remapLinks(linksW, f.remap);
  const mesh = buildMapMesh(f.blocks, P, links);
  const comps = components(mesh);
  lap('prune');
  const passageTags = tagPassages(inp.passages, inp.mapId, mesh);
  const census = runCensus(inp.mapId, snapIndex(mesh, st.snap.radiusYd), comps, inp.spawns, inp.hintOf, censusOptions);
  lap('census');
  const connectors = first.connectors.map((c) => ({
    ...c,
    a: { ...c.a, poly: f.remap[w.remap[c.a.poly] ?? -1] ?? -1 },
    b: { ...c.b, poly: f.remap[w.remap[c.b.poly] ?? -1] ?? -1 },
  }));
  return {
    blocks: f.blocks,
    mesh,
    comps,
    links,
    connectors,
    passageTags,
    mapFile: { mapId: inp.mapId, blockCount: f.blocks.length, polygonCount: mesh.n, sizes: comps.sizes, comp: comps.comp, links, passages: passageTags },
    census,
    pre: { polygons: first.mesh.n, components: c1.sizes.length, main: c1.sizes[0] ?? 0, census: census1.counts, seams: first.mesh.seams },
    water: { swimPolygons, droppedSwimPolygons: droppedSwim, splits },
    prune: { droppedPolygons: pk.droppedPolygons, droppedComponents: pk.droppedComponents },
    ms,
  };
}
