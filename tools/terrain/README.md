# tools/terrain

Terrain navigation and terrain byproducts for Milestone 3b
(docs/research/terrain-navigation.md; D-028, D-030 to D-034). The tool reads the local Forever
client through [`tools/casc`](../casc/README.md). It builds the committed navigation data in
`public/nav/` and the terrain byproducts in `public/maps/terrain/`. Everything runs in Node under
`tsx`.

## Status

| Step | Content | State |
|---|---|---|
| 3b.1 | `tools/casc`: CASC and WDC5 reader | done |
| 3b.2 | `lib/formats/*`, `lib/geometry.ts`, `lib/zones.ts`: file formats, the block triangle soup, areas and zones | done |
| 3b.3 | `lib/recast.ts`, `lib/encode.ts`, `lib/stage1.ts`, `lib/worker.ts`, `lib/parallel.ts`, `lib/manifest.ts`, `extract.ts`, `build.json`: Recast per tile, the v3 blocks, the manifest | done |
| 3b.4 | `lib/{link,components,snap,spawns,census,review,prune,water,passages,connectors,mapfile,stage2,fixtures,legs,detour-check,partition,validate-lib}.ts`, `validate.ts`, `review-draft.ts`, `inputs/*` | done |
| 3b.7 | `byproducts.ts`, `lib/byproducts/*`: zone outlines, coastlines, relief (`public/maps/terrain/`) | done |

The design's §17 has the whole plan. The two items open before 3b.3 froze the settings are
closed: the Gnarlpine Hold component of RC-02 is the lower chamber of the Ban'ethil Barrow Den,
cut off on a low, narrow stretch of the den's own ramp (no acceptable setting joins it, so it is
reviewed as `mesh-break-suspected`), and sizes and the census were re-measured with the corrected
WMO liquid rule (U14). Both are in docs/measurements/nav-m3b.json `implementation`.

## Client access

The rules of `tools/casc` apply. The install comes from `WOW_INSTALL`, and only `.build.info` and
`Data/` are read, read-only. The build refuses any build other than the pin. No raw client file
(ADT, WMO, M2, BLP or DB2) is written anywhere. Outputs are derived meshes, statistics and local
renders only. Client values quoted in docs and tests cite table, build and column (D-022).

## API (3b.2)

### `lib/formats/`: one parser per file type

All parsers take a decoded `Buffer` (from `LocalCasc.file(id).data`). They throw `FormatError`
on anything that does not follow the layout: a chunk past its end, stray bytes, a wrong count or
an index past a list. None uses bitwise operators.

| Module | Exports | Notes |
|---|---|---|
| `chunked.ts` | `chunks(bytes, start?, end?, what?)`, `findChunk`, `FormatError`, `flag(value, mask)`, `bitList`, `vec3`, `Vec3` | Ids are stored reversed (`REVM` = `MVER`) |
| `grid.ts` | `TILE_YD`, `CHUNK_YD`, `UNIT_YD`, `MAP_ORIGIN_YD`, `Rect`, `TileRef`, `tileRect`, `blockRect`, `expandRect`, `rectsOverlap`, `blockTiles(row0, col0, size = 4, ring = 1)`, `chunkKey`, `chunkKeyAt` | World X north, Y west, Z up; tile row 0 is the northernmost |
| `wdt.ts` | `parseWdt(bytes)` → `{ mphdFlags, tiles, hasMaid, globalWmo }`, `wdtTile(wdt, row, col)` | `WdtTile`: `rootAdt`, `obj0`, `obj1`, `tex0`, `lod`, `mapTexture`, `minimap` FileDataIDs |
| `adt.ts` | `parseAdtRoot(bytes)` → `{ chunks: Mcnk[256], hasMh2o }`, `outerIndex`, `innerIndex`, `MCNK_HIGH_RES_HOLES` | `Mcnk`: `ix`, `iy`, `flags`, `areaId`, `position` (north X, west Y, base Z), `heights` (145, or null), `holes` (64, row-major), `liquid` |
| `liquid.ts` | `parseMh2o`, `liquidAt(chunkLiquid, row, col)` → `{ height, type, deep }` or null, `hazardLiquidTypes(rows)`, `parseMliq`, `mliqTileHasLiquid`, `wmoLiquidType(groupLiquid, rootFlags, mogpFlags, mliq)` | LiquidObject instances (≥ 42) are flat at their maximum (U3). `wmoLiquidType` is the wowdev rule of design §3.1. |
| `obj0.ts` | `parseObj0(bytes)` → `Placement[]` | `kind`, `name` (FileDataID), `nameIsFileDataId`, `uniqueId`, `position` (world), `rotation` (degrees as stored), `scale`, `flags`, `doodadSet`, `nameSet`, `extents` (world AABB, WMO) |
| `wmo.ts` | `parseWmoRoot(bytes)`, `parseWmoGroup(bytes)`, `groupName(root, offset)`, `skipGroup(root, group)`, `isCollisionTriangle(flags)`, flag constants | Root: `wmoId` (the `WMOAreaTable.WMOID` key), `groupFileDataIds` (LOD 0), `doodadSets`, `doodadFileDataIds`, `doodads`, `boundsMin/Max`, `flags`. Group: `wmoGroupId`, `groupLiquid`, `flags`, `vertices`, `collision` (index triples of collision triangles only), `liquid`. |
| `m2.ts` | `parseM2Collision(bytes)` → `{ vertices, triangles, radius }` | Chunked (`MD21`, ids not reversed) or legacy `MD20` |
| `transform.ts` | `placementToWorld`, `placementTransform(position, rotation, scale)`, `apply(t, x, y, z)`, `doodadTransform(wmo, doodad)`, `eulerZYX`, `quaternionMatrix`, `multiply`, `determinant` | world = position + diag(−1, −1, 1)·Rz(b)·Ry(a)·Rx(c)·(scale·v); determinant +1 |
| `test-support.ts` | Synthetic WDT, ADT (with MH2O), obj0, WMO root and group, M2 builders for tests | No client bytes |

### `lib/geometry.ts`: the triangle soup of one block

```ts
import { blockGeometry } from './lib/geometry';
import { blockRect, blockTiles, expandRect } from './lib/formats/grid';

const geometry = blockGeometry(
  { read: (id) => casc.file(id).data },                 // FileSource: must throw on a missing or encrypted file
  wdt,
  blockTiles(28, 36).filter((t) => present.has(t.row * 64 + t.col)),
  { clip: expandRect(blockRect(28, 36), 8), swimDepth: 1.6, m2MinFootprint: 4, hazardLiquids, wmoAreas },
);
```

- Returns `BlockGeometry`: `positions` (Float64Array xyz, quantised to 1/256 yd, three vertices
  per triangle), `triangles` (Int32Array), `classes` (Uint8Array, `AREA_CLASS`: ground 1, object 2,
  water 3, deep 4, hazard 5), `tags` (Int32Array AreaTable id per triangle), `triangleCount`,
  `chunkAreas` (global chunk key → MCNK area), `inputs` (the FileDataIDs read, ascending, for the
  per-block input hash) and `stats`.
- `hazardLiquids`: `hazardLiquidTypes(readDb2(casc, DB2.LiquidType).rows.map((r) => ({ id: r.id, soundBank: r.num('SoundBank') })))`.
- `wmoAreas`: `wmoAreaIndex(readDb2(casc, DB2.WMOAreaTable).rows.map((r) => ({ wmoId: r.num('WMOID'), nameSet: r.num('NameSetID'), groupId: r.num('WMOGroupID'), areaId: r.num('AreaTableID') })))`.
- The same order and rules as the prototype `geom3.ts`, except the corrected WMO liquid rule, the
  TrinityCore "antiportal" group-name skip, deduplication by (kind, unique id), and failing closed
  where the prototype skipped silently. On all 136 blocks of both continents it is byte-identical
  to the prototype on 129; the other 7 differ only in 3,230 WMO liquid triangles, from hazard to
  water (design §1.1).
- `quantise(v)` and `triangleOverlaps(clip, …)` are exported for the Recast step's tests.

### `lib/zones.ts`: areas and zones

| Export | Meaning |
|---|---|
| `areaParents(rows)`, `topZone(parents, area)` | `ParentAreaID` roll-up to a row whose parent is 0; a cycle throws |
| `wmoAreaIndex(rows)`, `wmoGroupArea(index, wmoId, nameSet, groupId)`, `wmoRootArea(index, wmoId, nameSet)` | `WMOAreaTable` lookups with the name-set-0 and root-row fallbacks; for repeated keys the last row wins |
| `zoneIndex(geometry, cell = 4)`, `areaAt(zi, x, y, z)` → `{ area, fromTriangle }`, `zoneAt(parents, zi, x, y, z)`, `chunkAreaAt` | A polygon centroid's area: the tag of the containing source triangle nearest in height (within 8 yd), else the chunk's area |

## Navigation build (3b.3, 3b.4)

```bash
pnpm nav:extract [--parts N]      # stage 1 in N worker processes, then stage 2; writes public/nav/ (about 80 s with 12)
pnpm nav:extract --reuse-stage1   # stage 2 only, from .cache/terrain/stage1 (connectors, passages, dataset, review)
pnpm nav:check                    # G3: rebuild everything and compare every byte with public/nav/
pnpm nav:validate                 # offline gates (CI): G5, G6, G7-G8b, G9, G11, G12, G13, G15
pnpm nav:validate --client        # adds G1, the per-block input hashes, G5b, G10 and G10b (pinned client)
pnpm nav:validate --partition     # adds G4 on both maps: stage 1 rebuilt with 8x8 blocks (minutes)
pnpm nav:review-draft [--write]   # drafts census review entries for anything unreviewed (§12)
```

`public/nav/` holds `<mapId>/<row0>_<col0>.bin` (block format v3), `<mapId>/map.bin`
(components, connector links, passage tags), `manifest.json`, `connectors.json` (the observed
rows) and `NOTICE.md`. It is generated; never edit it by hand. The local report, with timings,
per-block statistics, every block's full input list and the census rows, is
`generated/terrain-nav-report.json` (gitignored).

### Stage 1 (per block: `lib/stage1.ts`, run in `lib/worker.ts` processes)

`buildStage1Block(inputs, row0, col0, { blockAdts?, hook?, keepRecastTiles? })` runs geometry
(`lib/geometry.ts`), then `buildBlockTiles` (`lib/recast.ts`), then `keepTile` (deep, hazard and
unwalkable polygons dropped, unused vertices removed, rcPolyMesh order kept), then per-polygon
zones (`areaAt` rolled up with `topZone`), then `encodeBlock`. It returns the block, its bytes,
every input file with its CKey (the WDT and four DB2 tables included) and the input hash, a
SHA-256 over `fileDataId ckey` lines that covers stage 1 only (RC-03).

| Module | Exports |
|---|---|
| `settings.ts` | `readBuildConfig`, `parseBuildConfig`, `derive(settings)` (cell size, tile yards, voxel values), `blockTileOrigin`, `worldX/Y/Z`, `mapBlocks`, `blockName`, `REPO_ROOT`, `TERRAIN_DIR` |
| `recast.ts` | `ensureRecast()`, `buildBlockTiles(geometry, derived, row0, col0, blockAdts?, hook?)` returning `RecastTile[]` (rcPolyMesh as typed arrays), `triangleKeys` and `canonicalOrder` (the triangle sort), `binTriangles`, `tileOriginStep`, `tileHeightVoxels`, `recastModuleInfo()` (version and WASM SHA-256), `RECAST_AREA` |
| `encode.ts` | `NavTile`, `NavBlock`, `BlockGrid`, `encodeBlock`, `decodeBlock` (strict, throws `NavFormatError`), `keepTile`, `compactTile`, `polygonCount` |
| `varint.ts` | `ByteWriter`, `ByteReader` (LEB128, zigzag, canonical varints only) |
| `client.ts` | `openClient(config)` (WOW_INSTALL and the pin), `readTables` (hazard liquids, WMOAreaTable, AreaTable parents, Map WDTs), `readMapWdt` (checked against `Map.WdtFileDataID`), `cascSource`, `ckeyOf` |
| `parallel.ts` | `runStage1(config, maps, present, dir, parts, blockAdts?)`: worker processes, largest blocks first |
| `manifest.ts` | `NavManifest`, `MapEntry`, `BlockEntry`, `navRevision`, `revisionFiles`, `seamEntry`, `jsonText`, `sha256` |
| `tool-tree.ts` | `toolTreeHash(repoRoot, entries)`: SHA-256 over every module the build loads (relative imports from `extract.ts` and the worker) |
| `notice.ts` | `navNotice(config, recastVersion)`: the text of `public/nav/NOTICE.md` |

### Stage 2 (per map: `lib/stage2.ts`)

`runStage2({ mapId, derived, stage2, blocks, spawns, hintOf, connectors, passages, geometry })`
links the blocks (`buildMapMesh`), adds the observed connectors as off-mesh links, labels
components and runs the census. It then applies the water rule, prunes, tags the passages, and
recomputes the components and the census. The water rule runs before pruning, as in the measured
prototype, so the pieces it cuts off are pruned like any other spawn-free component.

| Module | Exports |
|---|---|
| `link.ts` | `buildMapMesh(blocks, params, links?)` returning a `MapMesh` (world-yard polygons, CSR edges with portals, seam statistics), `recastAdjacency` (Recast's own pairing), `linkSymmetry`, `unmatchedPct`, `containsXY`, `distToPoly`, the edge kinds |
| `components.ts` | `components(mesh, passable?, keep?)`: every edge counts both ways; ordered by size, then lowest polygon id; main = 0 |
| `snap.ts` | `snapIndex(mesh, radius?)`, `snap(index, comp, sizes, x, y, hint, minComp)`: rules A and B, containing polygons first, the lowest floor, and `floors` (every containing polygon) |
| `spawns.ts` | `loadSpawns(repoRoot)` (dataset spawns through `src/infra/data` and `src/geo`, identity = kind, id, index), `loadGeometry`, `compareSpawnKeys`, `lfSha256` |
| `census.ts` | `runCensus(mapId, index, components, spawns, hintOf, { minComp, floorMin })` returning a `Census` (per-component rows with anchors, over-a-floor rows, unsnapped spawns, zone shares), `censusSummary`, `censusHash` |
| `review.ts` | `parseReviewed` (census-reviewed.json), `censusGate(census, splits, reviewed, stage2)`, `splitMatches`, `REASONS` |
| `water.ts` | `shoreDistance`, `waterKeep(mesh, distance, N)`, `waterSplits` |
| `prune.ts` | `pruneKeep`, `filterBlocks` (with the polygon remap), `remapLinks` |
| `connectors.ts` | `parseConnectors`, `connectorProblems` (G15, RC-12), `resolveConnectors`, `endpointWorld`, `endpointPolygon`, `observedRows` |
| `passages.ts` | `parsePassages`, `tagPassages` |
| `mapfile.ts` | `MapFile`, `encodeMapFile`, `decodeMapFile`, `runs`, `idRuns` |

### Validation (`lib/validate-lib.ts`, `validate.ts`)

`validateOffline({ repoRoot, skipToolTree?, staleInputsWarn? })` returns `{ checks, maps,
manifest, totals, censusGates, fixtures }`. The client gates use `lib/detour-check.ts`
(`detourCheck` and `adjacencyCheck`: G5b, G10, G10b, with the build-side `legsFrom` of
`lib/legs.ts`) and `lib/partition.ts` (`tileHashes`, `comparePartitions`: G4). `lib/fixtures.ts`
holds the must-connect and must-not-connect fixtures by dataset ids (G7, G7a, G7b, G7c, G8, G8b).

### Inputs (`inputs/`, committed)

| File | What |
|---|---|
| `connectors.json` | Owner-observed connectors (D-031, D-034): the design's template rows, both `todo`; Mulgore is UiMap 1412 (RC-12) |
| `passages.json` | Unverified passages (RC-09): the Undercity west tunnel and the Ironforge mountain top, with their boxes |
| `census-reviewed.json` | The reviewed census: components and over-a-floor components by anchor, unsnapped spawns, zones, water splits and the G7 floor exceptions |

## Tests

| File | What |
|---|---|
| `lib/formats/formats.test.ts` | Every format on synthetic files: chunk overruns, the grid, WDT, MCNK holes (both encodings), MH2O bitmaps, deep bits and heights, obj0 conversion, WMO collision rules, skips, MLIQ, the WMO liquid rule, M2 in both layouts, transforms |
| `lib/geometry.test.ts` | Terrain, liquids, holes and clipping; M2 and WMO objects, dedup, the footprint filter, doodad sets, area tags; fail-closed cases; zones |
| `lib/terrain.client.test.ts` | Against the pinned client: MODF extents (65 of 65 within 0.05 yd), the MCNK grid, the Undercity WMO (WMO ID 20736, 216 groups → zone 1497), and block 1:28_36's golden soup hash. Without the client it prints a `SKIPPED` banner and passes. |
| `lib/encode.test.ts` | Varints; the v3 block round trip, zones and strict decoding; `keepTile` |
| `lib/link.test.ts` | Recast's adjacency pairing, the slab relinker (overlap, climb, block seams), connector links, components, `map.bin` |
| `lib/census.test.ts` | Snap rules A and B and floors; the census per component with anchors; the gate; pruning; the water rule |
| `lib/inputs.test.ts` | The committed inputs; connector validation (RC-12) and resolution; passages; navRevision; the tool tree hash |
| `lib/recast.test.ts` | Recast on a synthetic soup: the per-tile origin, the canonical order, partition invariance |
| `lib/legs.test.ts` | The build-side `legsFrom`: a straight corridor with a swim split, an L bend, an unreachable target |
| `nav.committed.test.ts` | The committed `public/nav/` passes every offline gate (the tool tree and stale inputs are left to `nav:validate`) |
| `nav.client.test.ts` | Against the pinned client: block 1:28_36 built twice byte-identically, its golden bytes and manifest input hash, G5b on it, and a 2×2 against 1×1 partition (G4) |

## Byproducts (3b.7; design §13, D-032)

`pnpm tsx tools/terrain/byproducts.ts [--out <dir>] [--report <file>] [--check]`, with the pinned
client at `WOW_INSTALL`, writes the committed `public/maps/terrain/`: per map of `build.json`
(read only for `pin` and `maps`; each WDT is checked against `Map.WdtFileDataID`) `zones.json`,
`coast.json` and `relief.png`, plus `manifest.json` and `NOTICE.md`; the per-map input lists and
timings go to the gitignored `generated/terrain-report.json`. Ported from the m3b prototype
`byproducts.ts` (our own research code).

| Module | Exports |
|---|---|
| `lib/byproducts/grids.ts` | `tileBounds`, `boundsRect`, `createGrids`, `addTile` (zone per chunk, height per 8.33 yd, water per quad), `isWetQuad` (non-hazard liquid more than 0.3 yd deep) |
| `lib/byproducts/arcs.ts` | `boundaryArcs(label, grid, tolerance, keep?)`, `douglasPeucker`, `encodePoints` / `decodePoints` (1-yd delta coding), `reversePoints` |
| `lib/byproducts/relief.ts` | `shadedRelief` (16.7 yd per pixel, north-west light at 45°, ×2 exaggeration, 4-bit palette: 0 none, 1 water, 2-15 grey), `indicesSha256` |
| `lib/byproducts/png.ts` | `palettePng` (colour type 3, 4 or 8 bits, `tRNS`, per-row filter choice, deflate 9) |
| `lib/byproducts/build.ts` | `mapByproducts`, `buildTerrain`, `terrainManifest` |
| `lib/byproducts/notice.ts` | `terrainNoticeText` |

Formats (all coordinates in world yards, 1-yd integers, delta-coded):

- `zones.json`: `{ "schema": 1, "kind": "terrain-zones", "mapId", "units": "yd", "zones": [AreaTable ids], "arcs": [[left, right, x0, y0, dx1, dy1, …]] }`.
  On a map drawn with east to the right and north up (east = −Y, north = +X), zone `left` lies left
  of the arc's direction, and `left < right`; 0 is outside the map or an unassigned chunk. A zone's
  ring is its arcs with it on the left, forward, and on the right, reversed.
- `coast.json`: `{ "schema": 1, "kind": "terrain-coast", "mapId", "units": "yd", "arcs": [[x0, y0, dx1, dy1, …]] }`, land on the left.
- `relief.png`: row 0 is the north edge of the map's tile rectangle (`manifest.json` `maps[].rect`),
  column 0 its west edge.
- `manifest.json` `files[]`: `path`, `mapId`, `bytes`, `sha256`, `rect` and, for the PNG, `width`,
  `height`, `pixelYd` and the compressor-independent `indicesSha256`; `maps[].inputHash` is SHA-256
  over the sorted (FileDataID, CKey) lines of the WDT, the root ADTs and the AreaTable, LiquidType
  and Map tables (`tools/casc/input-hash.ts`); `tool.toolTreeHash` is the module-closure hash of
  `byproducts.ts` (`lib/tool-tree.ts`).

Measured at 1.60.1.70009 (this machine; 11.4 s wall for both maps): Eastern Kingdoms 736 tiles, 28
zones in 109 arcs, 876 coast arcs, relief 736 × 1344; Kalimdor 988 tiles, 26 zones in 127 arcs, 916
coast arcs, relief 1568 × 1792; 445,060 B gzip-6 for all eight files, 74.2% of the 600 kB `terrain`
budget. The prototype kept only the coast edges with land north or west of the water (its edge
filter compared the labels in lattice order), so its 29,585 coast arcs (159 kB) were fragments of
half the coastline; the port traces both orientations: 1,792 arcs, 61 kB. The zone arcs and the
relief match the prototype's counts and sizes (the relief within 0.02%).
`lib/byproducts/byproducts.client.test.ts` rebuilds both maps and compares them with the committed
files.
