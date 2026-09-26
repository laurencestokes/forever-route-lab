# Terrain navigation (Milestone 3b design, revision 3)

Status: **implementable design, 2026-09-26, revision 3.** Revision 2 replaced the first design of
2026-09-25 and answered the critique (TN-01 to TN-18, `.cache/m3-review.txt`, "CRITIC
terrain-design") and owner decisions D-030 to D-032. Revision 3 applies the re-critique
(RC-01 to RC-13, `.cache/m3b-recritique.txt`, all accepted) and decisions D-033 and D-034, and
records what steps 3b.1 and 3b.2 measured with the ported code (§1.1). `tools/casc/` (3b.1) and
`tools/terrain/lib/` (3b.2) now exist, and so do `public/nav` (3b.3, 3b.4) and the pure runtime
`src/nav` (3b.5, measured in §9.5); `src/nav/worker` (3b.6) does not yet. The prototypes are
gitignored research code in `.cache/experiments/terrain/m3b/` (§19).

Authority: [ARCHITECTURE.md](../ARCHITECTURE.md) and [DECISIONS.md](../DECISIONS.md) (D-005,
D-017, D-018, D-022, D-028 to D-034) win over this file. §18 lists the edits this design needs
in other documents.

**Figures.** Every number of revision 2 is in
[docs/measurements/nav-m3b.json](../measurements/nav-m3b.json), with its method. Sizes are
gzip level 6 of each file on its own (the dist audit's measure) in decimal units: 1 kB = 1,000 B,
1 MB = 1,000,000 B. Labels: **MEASURED** (run here, build 1.60.1.70009), **MEASURED (3b.x)**
(run with the ported code of that step; the method is given where the number appears and the
pinned numbers are asserted by the step's client tests), **RE-CRITIQUE** (measured by the
re-critique on the prototype's final blocks, `.cache/m3b-recritique.txt`, not re-run here),
**CITED** (a client value cited by table, build and column, D-022), **INFERRED** (a conclusion
not tested directly), **UNKNOWN** (open, §17). Machine: Ryzen 7 7800X3D (8 cores, 16 threads),
32 GB, Windows 11, Node 22.13.1, tsx, warm OS cache.

Accuracy statements are about the mesh, never about the game. "Mesh-derived" ratios and
connectivity have no ground truth; D-031 defers a calibration set.

Placeholders: `<exp>` is `.cache/experiments/terrain`, `<m3b>` is `<exp>/m3b`.

---

## 0. Summary

| Topic | Decision | Evidence (MEASURED unless marked) |
|---|---|---|
| Representation | Recast navmesh built offline (recast-navigation-js 0.43.1, build time only), exported straight from `rcPolyMesh` to our own **v3 block format**, queried by pure TypeScript. No WASM at runtime; grids and HPA* stay rejected. | §3, §5 |
| Settings | Cell 0.521 yd (533.33/1024), Recast tile 256 voxels (133.3 yd), radius 1 voxel (0.52 yd), climb 1.5 yd, height 2.0 yd, **slope 60°**, simplification error 5 yd, up to 12 vertices per polygon, M2 collision under 4 yd dropped. | Sweep of 18 settings on both continents, §4 |
| Size (D-030) | Committed build (3b.4, corrected WMO liquid rule): **5,423,019 B** for both continents in 108 blocks of 4×4 ADT tiles plus two `map.bin` files; largest block 131,177 B. Target 5-6 MB met, 7 MB cap kept with 1.58 MB headroom. (The prototype's figure in §4.3 was 5,704,757 B.) | §4.3, §14.3 |
| Census (D-030) | 74,608 dataset spawns on maps 0 and 1. Committed build (3b.4): 72,626 in the main component, 1,946 outside it in 134 components, 36 with no polygon within 6 yd, and 1,086 over an off-main floor, all reviewed per component (G6). The prototype figures that follow: 72,594 in the main component, 1,977 outside it and 37 with no polygon within 6 yd. The census is kept **per component** (RC-01, RC-02). Of the 1,977: 1,334 are Teldrassil and Darnassus (reached from Rut'theran by the portal, a `teleport` connector, D-034), 9 are Rut'theran Village (reached by the Auberdine boat, a same-map `TravelGraph` transport), 27 are Gnarlpine Hold (a walk-in quest camp the mesh does not connect: a must-connect fixture) and 93 are Thunder Bluff (elevators missing). **541** are left to review (the 514 of revision 2 plus Gnarlpine Hold). The first design's settings leave 9,755 outside and 1,526 unsnapped. | §4.4, §12 |
| Seams (TN-06) | Triangle-AABB clipping, a per-tile vertical origin on one 0.25-yd grid per map, and a canonical triangle order make every Recast tile independent of how blocks are cut: **11,776 of 11,776 Eastern Kingdoms tiles and 15,803 of 15,803 Kalimdor tiles are identical** in 4×4 and 8×8 blocks (G4 on both maps, RC-10; Kalimdor's 8×8 block 16_32 spans 2,514 yd in height). Block seams: +0.03 pp unmatched over inner seams on both maps. | §6 |
| Components (TN-02, RC-03) | Components are computed at build time for the whole map, after connectors. They live in **one per-map file** (`<mapId>/map.bin`: component sizes, a run-length component per polygon in manifest block order, the resolved connector links and the unverified-passage tags), never in the blocks, so a connector or a dataset pin bump rewrites that file and only the blocks whose pruning changes. Unreachable is an O(1) test. Components that no dataset spawn stands on and that have fewer than 1,000 polygons are dropped: 183,421 polygons, 26% of the size. | §5, §7 |
| Queries (TN-03/04/05) | One routine, `legsFrom(source, targets)`: Dijkstra ordered by (cost, polygon id), a funnel per target, and a ground/swim split. It fills one directed leg table in tenth-yards, which both the engine and the optimiser read. Lengths are horizontal (2D), a labelled assumption (RC-13). Durotar 300-point matrix: 1.76 s; Barrens: 6.40 s, a stress case: a realistic section is measured in 3b.5, with an absolute ceiling on the Milestone 9 throttled profile and a cancellable, progress-reporting "computing paths" phase (RC-07). Both are deterministic, and component pruning makes them 9.9× and 2.8× faster. | §9 |
| Multi-level (TN-07) | Snap rule A (the point's top-level zone) and rule B (components of at least 20 polygons), then the lowest floor. Rule A moves 20 Undercity and 22 Ironforge spawns off another zone's floor, such as the mountain top above Ironforge. An endpoint whose candidates span components is flagged, never resolved by a minimum over floors. Snapping loads every block within 6 yd first (RC-06). The must-connect fixtures check **every** containing floor of at least 20 polygons, and spawns over an off-main floor are gated like off-main spawns (RC-05). Per-polygon zones are committed under D-034 item 3. | §8, §12 |
| Water (TN-10) | Open water wider than **N = 800 yd** is not connected: swim polygons more than 400 yd from shore are dropped. This cuts Teldrassil from Darkshore, which leaks at N ≥ 1,200, and costs 9 census spawns. Legs with a swim run over 200 yd carry a warning. | §10 |
| Connectors (TN-08, D-031, D-034) | An owner-observation file (`/way` endpoints, ride, cast or wait seconds, date, build) of types `elevator`, `lift`, **`teleport`** (portals, D-034 item 1) and `walk`, and an optional TransportAnimation ride time. Same-map boats and zeppelins go through the `TravelGraph` (D-034 item 2). Until a row or a transport exists, a leg between components of one map uses the labelled straight-line fallback plus a warning. Passages the mesh finds but nobody verified (the Undercity west tunnel, the Ironforge mountain top) are tagged, and legs through them warn (RC-09, D-034 item 5). | §9.3, §11 |
| Byproducts (D-032) | Zone outline arcs (5.7 kB for both maps), coastline arcs (61 kB, 1,792 arcs: the full coastline; the prototype's 159 kB traced only half of it) and a 4-bit shaded relief PNG at 16.7 yd/px (375 kB); 445,061 B in all with the manifest and NOTICE (3b.7), within their own 600 kB `terrain` budget, with per-map input hashes (RC-08). | §13 |
| Map art (D-033, D-034) | Blizzard's painted zone and continent art is extracted by step 3b.8 through `tools/casc`, **committed and deployed** under `public/maps/art/` with a manifest (per-file input hashes, tool tree hash), a NOTICE naming Blizzard as the owner, and its own `art` budget of at most 12 MB gzip-6. The procedural layers stay as the fallback. | §13.4, §15 |
| Tools (TN-12) | A shared `tools/casc` (reader and WDC5, **implemented in 3b.1**) serves `tools/terrain` and `tools/maps`. The formats, block geometry and zones are ported (**3b.2**): the ported block geometry is byte-identical to the prototype's on 129 of 136 blocks; the other 7 differ only by a corrected WMO liquid rule (3,230 triangles from hazard to water, §3.1). Map extraction (`import.ts --build`, `convert.ts`) is step 3b.8. | §1.1, §15 |

---

## 1. Changes from the first design

| First design (2026-09-25) | Revision | Why |
|---|---|---|
| Cell 1.04 yd, radius 1.04 yd, slope 55°, error 3.1 yd, 6 vertices per polygon | 0.52 yd, 0.52 yd, **60°**, 5 yd, 12 | TN-01: the old settings disconnect caves and Thunder Bluff's rises. Slope 60° reconnects the Cleft of Shadow (§4.5). |
| Compact v2: 1/8-yd float-origin vertices, stored neighbours, per-ADT and 4×4 layouts | **v3**: voxel integers, derived adjacency, zone attributes (the component attributes of revision 2 moved to the per-map `map.bin` in revision 3, RC-03), 4×4 blocks only | 31% smaller at the same settings (5,887,812 B against 8,558,774 B), TN-09, TN-17 |
| Centroid clipping, one vertical origin per block, Recast's triangle order | AABB clipping, per-tile origin on a per-map grid, sorted triangles | TN-06. Exact partition invariance (§6). |
| Detour tile data built and discarded | Recast only; Detour only in the implementation check | Build 109 s wall (was 150 s) at twice the resolution |
| Components per loaded area; bounding-box matrices | Build-time components for the whole map; queries over the whole map | TN-02 |
| A* for legs, Dijkstra for the matrix | One `legsFrom` for both | TN-05 |
| `LegKey` = map and 1-yd XY | Adds navRevision and a snap hint per endpoint; legs are computed from the quantised points | TN-04 |
| `nearestReachable` for TIME-2 | Deferred. TIME-2 keeps the straight-line spawn choice. | TN-04 |
| Minimum over layers | Rules A and B, then the lowest floor. Endpoints that span components are flagged. | TN-07, TN-13 |
| Unreachable leg → `unknown` | Same-map: labelled straight-line fallback plus a warning (D-031). A map without navigation data gets a permanent labelled fallback. | TN-08, TN-15 |
| No water rule | Open water wider than 800 yd is cut; diagnostics and warnings | TN-10 |
| Byproducts local-only | Committed and deployed (D-032) | D-032 |
| About 9-10 MB budget, level-9 and MiB figures | 7 MB cap at gzip level 6, decimal units, and one measurement file | D-030, TN-09, TN-14 |

Where each finding is answered: TN-01 §4, §12; TN-02 §7, §9.6; TN-03 §9.5; TN-04 §9.2-§9.4; TN-05
§9.1, §9.3; TN-06 §6; TN-07 §8; TN-08 §11; TN-09 §4.3, §14.3; TN-10 §10; TN-11 §12, §16; TN-12
§15; TN-13 §8.1; TN-14 (this file and nav-m3b.json); TN-15 §9.6; TN-16 §2, §14.1; TN-17 §4.2,
§5; TN-18 §9.2 and §18.

### 1.1 Revision 3: the re-critique, D-033, D-034 and steps 3b.1-3b.2

| Finding | Change | Where |
|---|---|---|
| RC-01 same-map transports and portals | `teleport` connector type (D-034 item 1); a same-map cross-component pair first looks for a `TravelGraph` transport path (D-034 item 2); Rut'theran ↔ Darnassus added to "Needed"; census rows per component | §9.3, §9.4, §11, §12 |
| RC-02 Gnarlpine Hold | Gnarlpine Hold (npc 2009, 2010, 2011, 7318, zone 141) is a G7 must-connect fixture; its cause is found before 3b.3 freezes the settings, or it is reviewed as `mesh-break-suspected`; the zone rule is measured against each zone's dominant component; 541 to review | §4.4, §4.5, §12, §16, §17 |
| RC-03 component ids in blocks | The block format has no component stream; a per-map `map.bin` holds components, connector links and passage tags; the manifest records the stage-2 inputs; per-block input hashes cover stage 1 only | §5, §7, §14 |
| RC-04 painted art | D-033 is in the authority list; 3b.8 writes the committed `public/maps/art/`; one dist-audit allowlist for `maps/art/` and `maps/terrain/`; NOTICE wording | §13.3, §13.4, §15, §17 |
| RC-05 every floor | G7 checks every containing floor of at least 20 polygons for all cave fixtures, with reviewed exceptions, and also runs at a rule-B threshold of 10; spawns over an off-main floor are gated per anchor | §8.3, §12, §16 |
| RC-06 lazy loading | Snapping loads every block within 6 yd; target-snap loads count in the fetch baselines; pause-before-relax covers connector links; a random-load-order unit test | §8.1, §9.6, §17 |
| RC-07 matrix cost | A realistic-section matrix, an absolute ceiling on the Milestone 9 profile, progress and cancel for "computing paths", and a measured typed runtime layout before whole-continent residency | §9.5, §14.3, §17 |
| RC-08 per-polygon zones, byproduct hashes | D-034 item 3 records that per-polygon zone ids are covered; byproducts get per-map input hashes | §8.1, §13.3 |
| RC-09 unverified passages | Tagged at build time; legs through them carry `SIM-unverified-passage` (D-034 item 5) | §9.3, §11.3, §16 |
| RC-10 G4 on Kalimdor | G4 runs on both maps, including a Kalimdor region that crosses the 2,047-yd span | §6.2, §16 |
| RC-11 shipped 12-vertex mesh | G10b: the shipped 12-vertex blocks against Detour at 6 vertices, same thresholds | §16 |
| RC-12 template UiMap | The Mulgore landing is UiMap 1412 (not AreaTable 215); validate rejects a UiMap that is not a row of the connector's map | §11.1 |
| RC-13 2D lengths | The horizontal-length assumption is stated next to the rider approximation (basis `assumption`); the `src/nav` heap uses `Math.floor((i − 1) / 2)` | §9.1 |

What the ported code measured (3b.1 `tools/casc`, 3b.2 `tools/terrain/lib`; client
1.60.1.70009; method: the step's client tests plus one scan of every navigation input of both
continents with the ported parsers, 16.9 s):

- **CASC** (MEASURED 3b.1; median of three runs, `node --expose-gc`): the reader opens in 0.85 s
  (0.84-0.86 s) with 315 MB of RSS growth, now including the MD5 checks of the
  encoding table (160,535,468 B, 23,425 pages) and the root (56,899,122 B, 1,182 blocks, 2,747,339
  entries, 1,435,081 enUS FileDataIDs, 4,970 with the Encrypted flag). All 13,686 navigation inputs
  are present, unencrypted and MD5-verified. 1,642 of the 13,688 files read (the inputs plus both
  WDTs) are archive entries without the 0x1E local header; revision 2's 273 was counted by the first
  prototype over a set it did not record, so that figure is superseded.
- **WDC5** (MEASURED 3b.1): with the 14 layouts copied from WoWDBDefs, every column of ten tables
  equals the research CSVs (AreaTable, Map, UiMap, UiMapAssignment, UiMapArt, UiMapArtTile,
  UiMapArtStyleLayer, UiMapXMapArt, WorldMapOverlay, WorldMapOverlayTile). The encrypted sections of
  Map and AreaTable (3 each) coincide exactly with their zero-filled BLTE chunks. Inline IDs are
  bitpacked-signed. Narrow signed columns stored wide must be narrowed (`Map.ParentMapID` 65535 is
  −1). UiMapArt's 54 records plus 90 copy-table rows make its 144 rows. WMOAreaTable: 52,578 rows,
  338 areas; its relationship map has 52,570 entries, all equal to the inline WMOID.
- **Undercity** (MEASURED 3b.2): the city WMO placed on map 0 is FileDataID 7675285, MOHD WMO ID
  **20736**, name set 1. Its root row and all 216 groups resolve to zone 1497. WMOID 1150, revision
  2's example, keeps 861 rows (root → 1497) but is not placed on map 0 at this build.
- **Formats** (MEASURED 3b.2): all 1,724 root ADTs have 256 MCNKs on the world grid (maximum
  deviation 0.002 yd over 441,344 chunks), all with high-resolution holes; all 233,912 MH2O
  instances name a LiquidObject (no raw vertex format). No placement is named by a string index.
  No group is named "antiportal" without the antiportal flag (30 of 3,968 groups are skipped by
  flags). The MODF extents of 65 of 65 placements are reproduced within 0.05 yd (worst 0.0025 yd)
  by transforming the eight corners of the MOHD bounding box.
- **Geometry** (MEASURED 3b.2): the ported `blockGeometry` against the prototype's `geom3.ts` on
  all 136 blocks of both maps: 129 byte-identical (positions, triangles, classes, tags); 7
  Kalimdor blocks (12_28, 20_32, 24_44, 32_28, 32_40, 40_24, 40_28) differ only in the class of
  3,230 WMO liquid triangles, from hazard to water. The cause is the WMO liquid rule (§3.1): the
  prototype read a group liquid of 15 ("none") as LiquidType 15 (Green Lava). Six WMOs are
  involved, placed near Shadowglen (Teldrassil), in Felwood, on the Barrens coast, in Azshara,
  Feralas and the Isle of Dread, and one at (−1,058, 206, 109) by Thunder Bluff (block 32_28)
  (positions from their MODF entries; places from the chunk areas around them, INFERRED). Sizes
  and the census must be re-measured in 3b.3 (U14).

---

## 2. Inputs and read-only discipline

| Input | Identity | Use |
|---|---|---|
| Forever client | `wow_classic_beta` 1.60.1.70009, build key `05215079e3905ef5922ae0b03ffefb73` | Terrain (ADT root), placements (obj0), WMO roots and LOD0 groups, M2 collision, `Map`, `AreaTable`, `LiquidType`, `WMOAreaTable` |
| Dataset | `public/data` at QuestieDB `b6f5b07`, placeholder geometry | Spawns, as world points through `src/infra/data/points.ts` and `src/geo` (§12) |
| recast-navigation-js 0.43.1 | npm; MIT, embedding Recast/Detour (zlib) | Build-time voxelisation and polygon mesh; Detour only in the implementation check (§16) |
| WoWDBDefs `cf84e010` | `definitions/*.dbd` and `manifest.json`, research copies in `<exp>/refs/` and `.cache/experiments/maps/` (docs/MAPS.md §8.3); `definitions/` is CC BY-SA 4.0 (its `LICENSE.md`, same blob at that commit and on master, checked 2026-09-26) | The 14 table layouts at 1.60.1.70009 and their FileDataIDs, copied as data into `tools/casc/layouts.ts` (generated by `tools/casc/make-layouts.ts`, checked by a test), attributed in THIRD_PARTY_NOTICES "Format definitions" |
| TrinityCore `85d3c251` (GPL-2.0-or-later) | Files in `<exp>/refs/` | Rules only (WMO collision flags, group skips, the WMO liquid-type rule). Nothing ported. |

Rules (TN-16, D-028), implemented by `tools/casc` (3b.1):

- Tools take the install from `WOW_INSTALL`, never a hard-coded path (`resolveInstall()`; the
  Battle.net default when unset). They read only `<install>/.build.info`, keeping four columns,
  and `<install>/Data/{config,data}`, opened with `'r'`. `tools/casc/paths.ts` is the only module
  that builds install paths and it validates every name. No path under `Cache/`, `WTF/`, `Logs/`
  or `Interface/` is ever built, and nothing is written under the install; a test scans the reader
  sources for write calls, network calls and those folder names.
- The build refuses to run unless `.build.info` matches the pin in `tools/terrain/build.json`
  (`LocalCasc.open({ pin })`, error code `pin`).
- Tools never write raw client files, DB2s included. The first prototype's copies in
  `<exp>/out/` (Map, AreaTable and LiquidType DB2s; two WDTs) are the only ones; they are inside
  `.cache` and can be deleted. The m3b code writes only derived meshes, statistics and local
  renders; `tools/casc` writes nothing at all.
- Re-measured by 3b.1 and 3b.2 with the ported code (§1.1): the reader opens in 0.85 s (MD5 of the
  encoding table and root included); all 13,686 navigation inputs are present, unencrypted and
  MD5-verified; 1,642 of the 13,688 files read are archive entries without the 30-byte header;
  WMO placement extents are reproduced for 65 of 65 placements within 0.05 yd. nav-m3b.json
  `carriedOver` keeps the first design's figures, which these supersede.
- Our WDC5 reader needed one fix for `WMOAreaTable` (`facts.tables`). Tables whose ID is an
  inline field must key common-data lookups by that inline ID. The first reader keyed them by
  −1, which made `AreaTableID` read 0 everywhere. `WMOID` is an inline field at 1.60.1 and is
  also repeated in the relationship map. The 52,578 rows give 338 distinct areas. The Undercity
  city WMO placed on map 0 is MOHD WMO ID 20736 (FileDataID 7675285, name set 1), whose root row
  and 216 groups all give area 1497; WMOID 1150 also maps to 1497 but is not placed on map 0.

### 2.1 CASC read path (implemented in 3b.1: `tools/casc`, API in `tools/casc/README.md`)

| Step | What | Notes |
|---|---|---|
| `.build.info` | Header `Name!TYPE:len\|…`; take the one active row with `Product = wow_classic_beta` | Keep Product, Version, Build Key and CDN Key only; never Tags or CDN hosts. No product, or two active rows, is an error. |
| Build config | `Data/config/<k[0..2]>/<k[2..4]>/<build key>`, `key = value` lines | Uses `root` (a CKey) and `encoding` (CKey and EKey) |
| Local indices | `Data/data/<bucket 00-0f><version>.idx`, version 7, the newest version per bucket: 9-byte EKey prefix, 5-byte big-endian offset (archive = off ÷ 2³⁰, offset = off mod 2³⁰), 4-byte size | The bucket of a key is the XOR of its nine bytes, high nibble XOR low nibble (computed arithmetically); one binary search in that bucket (2,161,431 entries) |
| Data | `data.NNN` at the offset: normally a 0x1E local header, then BLTE | Some entries start directly with `BLTE` (1,642 of the 13,688 files read): both forms are read; an all-zero entry (not downloaded yet) is `missing` |
| BLTE | Modes N and Z (`node:zlib`); every chunk's MD5 is checked against the chunk table; E (encrypted) chunks are zero-filled and reported as byte ranges; F (nested) is refused; a table-less encrypted stream is refused | `LocalCasc.file()` fails closed on an E chunk unless `encrypted: 'zero-fill'` is asked for (DB2 tables only). Never falls back to the CDN. |
| Encoding | `EN`, 16-byte keys; binary search over the page index, then one page | Each page is checked against its MD5 when first used; MD5 of the whole table = its CKey at open |
| Root | `TSFM` (MFST) version 2; blocks of (count, locale, three content-flag words), FileDataID deltas, CKeys, name hashes unless NoNameHash | Keep the first enUS, non-LowViolence entry per FileDataID (1,435,081 of 2,747,339 entries in 1,182 blocks). Stored as sorted typed arrays (21 B per FileDataID). Opening grows the RSS by 315 MB, of which the decoded encoding table (161 MB) stays resident for lookups; the prototype's `Map` of hex strings alone grew it by about 496 MB. |
| File | root CKey → encoding EKey → index → data → BLTE → MD5(decoded) = CKey; decoded size = the encoding table's size | Errors carry a code: `format`, `missing`, `encrypted`, `integrity`, `pin`, `path`, `layout` |
| WDC5 | Layout-driven (`tools/casc/layouts.ts`); IDs from the ID list or the inline ID field; common data keyed by the record ID; pallet, pallet array, bitpacked and signed bitpacked fields; strings through the virtual string layout; copy tables; the relationship map | A section is skipped when a zero-filled BLTE range covers it exactly (Map and AreaTable: 3 each); a range over the header, over part of a section or over a section that declares no TACT key is an `encrypted` error; `requireComplete` refuses any skip. Sparse tables are refused. |

No arithmetic needs bitwise operators: 40-bit offsets, flags, bucket XORs and varints use division
and modulo, so the `no-bitwise` lint rule holds without an override. 4,970 FileDataIDs carry the
root Encrypted flag. None of the 13,686 navigation inputs is encrypted or missing, so no key
ring is needed and none may be shipped or fetched.

---

## 3. Build pipeline

One process builds one block of 4×4 ADT tiles. Blocks run in parallel processes and never share
state. Stage 2 runs once per map.

### 3.1 Stage 1: per block

1. **Geometry** (`tools/terrain/lib/geometry.ts`, ported from `geom3.ts` in 3b.2). The inputs
   are the terrain quads (holes removed; terrain under more than 1.6 yd of water is not walked),
   MH2O liquids, WMO LOD0 collision with the TrinityCore collision rule, WMO liquids, and M2
   collision. The M2s are ADT placements plus the WMO doodad set and set 0, deduplicated by
   (kind, unique ID), with footprints under 4 yd dropped.
   - The block's ADTs plus a one-tile ring are read (`blockTiles`).
   - **Clipping is by triangle AABB** against the block plus 8 yd. That margin is larger than the
     Recast border of 4 voxels (2.1 yd).
   - Each triangle carries an area class and an AreaTable tag: the MCNK area for terrain and
     liquid, and `WMOAreaTable(WMOID, NameSetID, WMOGroupID)` for WMO groups. The lookup falls
     back to name set 0, then to the root row (group −1; the placement's name set, then name set
     0), then to 0. Doodads take the WMO's root area; M2s take 0.
   - **WMO liquids** are classed by the group's resolved LiquidType (wowdev.wiki "MOGP
     groupLiquid", the rule TrinityCore follows): with root flag 0x4 the group value is a
     LiquidType ID; otherwise 15 means none and any other value v is legacy v + 1; a result of 0
     with an MLIQ takes the first liquid tile's legacy type + 1; legacy 1-20 map to water 13 (ocean
     14 with MOGP 0x80000), ocean 14, magma 19 and slime 20. Hazard = LiquidType SoundBank 2 or 3.
     The prototype tested the raw group value instead; the change turns 3,230 triangles in 7
     Kalimdor blocks from hazard to water (§1.1, U14).
   - A group is skipped when MOGP has 0x80 or 0x4000000, or it is named "antiportal"
     (TrinityCore's rule); a skipped group contributes neither collision nor liquid.
   - Fail closed: a missing, encrypted or corrupt input, a placement named by a string index, or
     a chunk that runs past its file stops the block.
   - Vertices are quantised to 1/256 yd before Recast.
   - The FileDataIDs read are listed for the per-block input hash (§5).
2. **Recast** (`build3.ts`). Recast tiles lie on a map-wide grid: tile (tx, tz) covers recast x
   from −17,066.67 + tx·133.33 yd, and recast (x, y, z) = (X, Z, −Y). For each tile:
   - its triangles are the ones overlapping the tile plus the border, **sorted by quantised
     coordinates**;
   - its vertical origin is `floor((zMin − 1) / 0.25) · 0.25` of those triangles;
   - the filters run, then erosion (radius 1), watershed regions, contours with wall-edge
     tessellation, and the polygon mesh.
   - No detail mesh is built, and no Detour data.
3. **Export** (`format3.ts`). Deep-water and hazard polygons are dropped (never traversable). The
   rest is written as v3 tiles (§5).
4. **Zones** (`tools/terrain/lib/zones.ts`, ported from `zones3.ts` in 3b.2). Each polygon's
   centroid is matched to the source triangle that contains it in 2D and is nearest in height
   (strictly within 8 yd). Its tag, or the MCNK area when the tag is 0, is rolled up through
   `ParentAreaID` to the top-level zone. For 83.9% of the chosen build's
   stage-1 polygons the area comes from a source triangle; the rest take the chunk's area
   (MEASURED, `facts.zoneFromTriangle`). Those are mostly M2 surfaces, whose tag is 0
   (INFERRED).

### 3.2 Stage 2: per map

1. Decode all blocks, derive adjacency and link tiles with the slab rule (§6.1).
2. Add connectors (§11) as directed off-mesh links: the `observed` rows of type `elevator`,
   `lift`, `teleport` and `walk`.
3. Compute components over the whole map, ordered by size, then lowest polygon id; main = index 0.
4. Run the census (§12).
5. Prune the components that no dataset spawn stands on and that have fewer than 1,000 polygons.
   "Stands on" covers the snapped polygon and every other containing floor, so an ambiguous floor
   is never pruned.
6. Apply the water rule (§10).
7. Tag the unverified passages (§11.3): the polygons of each must-verify passage listed in
   `tools/terrain/inputs/passages.json` (RC-09, D-034 item 5).
8. Recompute components, re-run the census, and write the final blocks, the per-map `map.bin`
   (components, connector links, passage tags; §5) and the manifest with the stage-2 inputs.

Stage 2's inputs are the stage-1 blocks plus the dataset (its revision and the SHA-256 of
`spawns.json`), `census-reviewed.json`, `connectors.json`, `passages.json`, and the prune and water
parameters. The manifest records each of them (§5), so a pin bump or a new connector shows which
of them changed. A dataset or connector change rewrites `map.bin` and only the blocks whose
pruning changes (RC-03).

Timings for the chosen build (MEASURED):

- stage 1 over 136 blocks: 1,018 s CPU (geometry 103 s, Recast 888 s, encode and zones 27 s),
  109 s wall with 12 processes; the slowest block takes 14.8 s;
- stage 2: 8.4 s for Kalimdor and 7.0 s for the Eastern Kingdoms.

The first prototype took 150 s wall at half the resolution.

### 3.3 Determinism (MEASURED)

- Two full builds of the same settings under different names are byte-identical: stage-1,
  final and pruned blocks on both maps, for the chosen settings and for one other set.
- Builds with 4×4 and 8×8 blocks produce identical tiles (§6.2).
- Rasterisation is order-sensitive: without the sort, 321 of 11,776 tiles differ. That is why
  triangles are sorted.
- Floating point: vertices are quantised before Recast. The WASM module carries its own libm
  (INFERRED). The Node major version is pinned.

### 3.4 Format notes (implemented in 3b.2: `tools/terrain/lib/formats/`; wowdev.wiki, checked against wow.export, first design)

| Item | Rule |
|---|---|
| WDT | `MAID`: 64×64 × 8 FileDataIDs, row-major `[YY][XX]`. Navigation reads only `root` and `obj0`; `obj1` and `tex0` are never read. |
| MCNK | These offsets are from the MCNK data. flags 0x00; index x/y 0x04/0x08; high-res holes u64 at 0x14 (8×8, one byte per row, bit = column; flag 0x10000), else low-res holes u16 at 0x3C (4×4 cells of 2×2 quads); area id 0x34; position 0x68 (world X of the north edge, world Y of the west edge, base Z). MCVT has 145 heights (9-8-9…); each quad is a 4-triangle fan around its centre. All 441,344 chunks of both continents use high-res holes and lie on the grid within 0.002 yd (MEASURED 3b.2). |
| MH2O | 256 headers of (instances, layers, attributes); attributes carry the fishable and **deep** u64 masks. Every instance uses a LiquidObject id (≥ 42), not a raw LVF, so heights are the instance maximum for now (U3): 233,912 of 233,912 instances on both continents (MEASURED 3b.2). Hazard = `LiquidType.SoundBank` 2 or 3: LiquidTypes 3, 4, 7, 8, 11, 12, 15, 19, 20, 21, 1174, 1177, 1267, 1268, 1269, 1284 and 1295 (MEASURED 3b.1). |
| obj0 | `MDDF` 36 bytes (FileDataID when flag 0x40); `MODF` 64 bytes (FileDataID when flag 0x8; doodad set +0x3A, **name set +0x3C**, scale +0x3E). Deduplicate by (kind, unique id). The MODF extents equal the transformed corners of the WMO's MOHD box: 65 of 65 within 0.05 yd (MEASURED 3b.2). |
| Transform | world = (ORIGIN − p[2], ORIGIN − p[0], p[1]); R = Rz(b)·Ry(a)·Rx(c) of the file rotation (a, b, c); world(v) = position + diag(−1, −1, 1)·R·(scale·v). A WMO doodad composes the WMO's transform with the MODD quaternion. The determinant is +1, so no winding flips are needed. Recast gets (X, Z, −Y). |
| WMO root | `MOHD` (wmoID at +0x20, bounding box +0x24, flags +0x3C); `GFID` holds nGroups × LOD levels, so take the first nGroups; `MOGN` group names; `MODS`/`MODD`/`MODI` doodads. |
| WMO group | `MOGP` header 0x44 bytes (name offset +0x00, flags +0x08, groupLiquid +0x34, **WMOGroupID +0x38**); `MOPY` or `MPY2` flags, `MOVI` or `MOVX` indices. Collision when flag 0x08 is set, or 0x20 without 0x04. Skip groups with MOGP flag 0x80 or 0x4000000, or named "antiportal". `MLIQ` is a liquid surface (8-byte vertices, height at +4; tile low nibble 15 = no liquid); its LiquidType follows the rule in §3.1. |
| M2 | `MD21` wraps `MD20`; collisionIndices at 0xD8, collisionPositions at 0xE0, offsets from the `MD20` magic. Chunked M2 ids are stored in reading order (`MD21`), unlike ADT and WMO ids, which are reversed. |
| Winding | M2 collision is counter-clockwise outward; WMO floors are counter-clockwise from above |

---

## 4. Settings sweep (D-030)

### 4.1 Method

Each setting was built for both continents. Stage 2 then ran twice:

- **unpruned**, with snap rule A only (`link.ts`);
- **pruned**: components under 1,000 polygons, water N = 800, snap rules A and B (`link2.ts`).

The census snaps every dataset spawn on maps 0 and 1 (§12). Names such as `c05r1+n12+e5+s60`
mean: base `c05r1` (cell 0.52 yd, radius 1 voxel), `n12` (12 vertices per polygon), `e5`
(simplification error 5 yd), `s60` (slope 60°). Other modifiers: `t4` (Recast tile = 1 ADT,
1024 voxels), `a` (keep all M2 collision), `l0` (no maximum edge length).

### 4.2 Trade-off table (MEASURED; nav-m3b.json `sweep`)

Off-main / no-polygon counts include the 1,370 spawns of Teldrassil, Darnassus and Rut'theran
and the 93 Thunder Bluff spawns, which are disconnected in the game too until their connectors
and transports exist (§12). They also include Gnarlpine Hold, which is not (RC-02, §4.5). The
unpruned census uses rule A only; the pruned census uses rules A and B.

| Set | Cell yd | Tile vox | Radius yd | Slope | Error yd | Verts | M2 | Unpruned MB | Off / none | Pruned MB | Off / none | Ambiguous | CPU s | Wall s |
|---|---:|---:|---:|---:|---:|---:|---|---:|---:|---:|---:|---:|---:|---:|
| `c1r1` (first design) | 1.042 | 128 | 1.042 | 55 | 3.125 | 6 | ≥ 4 | 5.89 | 11059 / 1508 | 3.41 | 9755 / 1526 | 2105 | 538 | 59 |
| `c1r0` | 1.042 | 128 | 0 | 55 | 3.125 | 6 | ≥ 4 | 8.29 | 8417 / 481 | 4.62 | 22681 / 494 | 1993 | 497 | 55 |
| `c075r1` | 0.694 | 192 | 0.694 | 55 | 3.125 | 6 | ≥ 4 | 8.43 | 3856 / 102 | — | — | — | 719 | 78 |
| `c05r1` | 0.521 | 256 | 0.521 | 55 | 3.125 | 6 | ≥ 4 | 9.25 | 2601 / 31 | 6.29 | 2100 / 32 | 1592 | 1050 | 111 |
| `c05r1+t4` | 0.521 | 1024 | 0.521 | 55 | 3.125 | 6 | ≥ 4 | 8.80 | 2625 / 36 | — | — | — | 1259 | 134 |
| `c05r1+n12` | 0.521 | 256 | 0.521 | 55 | 3.125 | 12 | ≥ 4 | 9.04 | 2600 / 47 | — | — | — | 1062 | 114 |
| `c05r1+l0` | 0.521 | 256 | 0.521 | 55 | 3.125 | 6 | ≥ 4 | 9.24 | 2601 / 31 | — | — | — | 1042 | 112 |
| `c05r1+e6` | 0.521 | 256 | 0.521 | 55 | 6 | 6 | ≥ 4 | 6.93 | 2804 / 54 | 4.88 | 2128 / 55 | 1424 | 1076 | 114 |
| `c05r1+t4+n12` | 0.521 | 1024 | 0.521 | 55 | 3.125 | 12 | ≥ 4 | 8.50 | 2625 / 36 | 5.88 | 2141 / 49 | 1493 | 1337 | 143 |
| `c075r1+t4+n12` | 0.694 | 768 | 0.694 | 55 | 3.125 | 12 | ≥ 4 | 7.71 | 3882 / 106 | 4.94 | 3020 / 125 | 1734 | 828 | 89 |
| `c05r1+t4+n12+e4` | 0.521 | 1024 | 0.521 | 55 | 4 | 12 | ≥ 4 | 7.44 | 2695 / 36 | 5.18 | 2151 / 41 | 1387 | 1259 | 133 |
| `c05r1+t4+n12+e6` | 0.521 | 1024 | 0.521 | 55 | 6 | 12 | ≥ 4 | 6.32 | 2837 / 61 | 4.49 | 2161 / 66 | 1242 | 1276 | 134 |
| `c05r1+t4+n12+e4+s60` | 0.521 | 1024 | 0.521 | 60 | 4 | 12 | ≥ 4 | 7.93 | 2526 / 33 | 5.89 | 2014 / 38 | 1295 | 1269 | 134 |
| `c05r1+t4+n12+e5+s60` | 0.521 | 1024 | 0.521 | 60 | 5 | 12 | ≥ 4 | 7.27 | 2569 / 41 | 5.44 | 2007 / 47 | 1136 | 1294 | 136 |
| `c05r1+t4+n12+e6+s60` | 0.521 | 1024 | 0.521 | 60 | 6 | 12 | ≥ 4 | 6.83 | 2640 / 46 | 5.16 | 2025 / 51 | 1073 | 1314 | 138 |
| `c05r1+t4+n12+e4+s60+a` | 0.521 | 1024 | 0.521 | 60 | 4 | 12 | all | 8.42 | 2606 / 32 | 6.38 | 2043 / 37 | 1400 | 1308 | 137 |
| `c05r1+n12+e4+s60` | 0.521 | 256 | 0.521 | 60 | 4 | 12 | ≥ 4 | 8.45 | 2501 / 39 | 6.16 | 2007 / 40 | 1171 | 1004 | 108 |
| **`c05r1+n12+e5+s60` (chosen)** | 0.521 | 256 | 0.521 | 60 | 5 | 12 | ≥ 4 | 7.76 | 2537 / 36 | **5.70** | **1977 / 37** | 1060 | 1018 | 109 |

What the table shows:

- **Cell size and radius decide connectivity.**
  - 1.04 yd cells with a 1.04 yd radius leave 9,755 spawns off-main and 1,526 unsnapped, even
    after pruning.
  - Radius 0 at 1.04 yd costs +41% and still breaks two land connections (nav-m3b.json
    `radius0Breaks`):
    - Kalimdor: Winterspring (26,791 polygons, 1,163 spawns) is separate. Timbermaw Hold is its
      land link (INFERRED).
    - Eastern Kingdoms: the land route between Lordaeron (121,910 polygons, Tirisfal to the
      Plaguelands) and the south (142,886 polygons) survives only through an open-water swim.
      The water rule cuts that swim, so pruned `c1r0` puts 22,681 spawns off-main. §10 uses this
      as the diagnostic's worked example.
  - 0.69 yd cells leave about 1,000 more spawns off-main than 0.52 yd.
- **Pruning pays for most of the finer cell** (§7): 9.25 MB → 6.29 MB at the same settings.
  The v3 encoding (§5) is already in both figures.
- **Simplification error** of 3.1 → 6 yd saves 25% unpruned. It adds 203-212 off-main spawns
  under rule A alone, but only 20-28 after rule B (`c05r1` against `c05r1+e6`, and `t4+n12`
  against `t4+n12+e6`).
- **Slope 60°** costs 7-8% unpruned. After pruning it costs 14-15%, because fewer polygons are
  pruned. It removes 136-137 off-main spawns (`t4+n12+e4/e6`, with and without `s60`).
- **Tile size** (256 against 1024 voxels): 1024 is 5% smaller, but it loses the Cleft of Shadow
  connection (§4.5).
- **12 vertices per polygon**: −2.2% bytes.
- **No maximum edge length**: −0.1%, not worth a change.
- **M2 filter (TN-17).** Keeping all M2 collision costs +8% and leaves 29 more spawns off-main
  (2,043 against 2,014). The must-connect fixtures are the same either way, except one Dustwind
  Cave spawn. The filter stays. It changes reachability in both directions; the census gate shows
  both.

### 4.3 Chosen settings and size

`c05r1+n12+e5+s60`:

| Parameter | Value | Note |
|---|---|---|
| Cell size | 533.33/1024 = 0.521 yd | TN-01 fix |
| Cell height | 0.25 yd | 13-bit spans, so a tile's range is at most 2,047 yd |
| Recast tile | 256 voxels = 133.3 yd, 4×4 per ADT | 512 and 1024 lose the Cleft of Shadow |
| Walkable radius | 1 voxel = 0.52 yd | Close to TrinityCore's effective 0.53 yd (critic) |
| Walkable climb | 1.5 yd (6 voxels) | Needed for new Orgrimmar (first design) |
| Walkable height | 2.0 yd (8 voxels) | |
| Walkable slope | 60°, terrain and objects | 55° isolates the Cleft of Shadow. A 60° limit on objects only does not help: the step is terrain (§4.5). The client's value is UNKNOWN. |
| Simplification error | 5 yd (9.6 voxels) | |
| Maximum edge length | 66.7 yd (128 voxels) | |
| Region areas | min 16² voxels, merge 40² voxels (8.3 and 20.8 yd sides) | |
| Vertices per polygon | 12 | Our format; Detour's limit of 6 does not apply |
| M2 collision | Footprint ≥ 4 yd | §4.2 |
| Swim depth | 1.6 yd | |
| Pruning | Spawn-free components under 1,000 polygons | §7.2 |
| Water | N = 800 yd | §10 |

Size (MEASURED, nav-m3b.json `final`):

| Map | Blocks | Polygons | Raw | gzip6 | Largest block | Median block |
|---|---:|---:|---:|---:|---:|---:|
| Kalimdor | 58 | 367,400 | 4,223,863 B | 3,043,014 B | 128,074 B | 48,932 B |
| Eastern Kingdoms | 50 | 322,143 | 3,709,585 B | 2,661,743 B | 138,855 B | 54,209 B |
| **Both** | 108 | 689,543 | 7,933,448 B | **5,704,757 B** | 138,855 B | — |

That is inside the owner's 5-6 MB target, under the 7 MB cap, and each block is under half the
300 kB block cap. The headroom of 1.30 MB is for Zephras Isle (2991, not built, §17 U6), pin
bumps, connectors and the two per-map `map.bin` files (RC-03), whose size 3b.4 measures and adds
to this table. The WMO liquid correction (§3.1) keeps 3,230 more triangles swimmable; its effect
on sizes and the census is re-measured in 3b.3 (U14).

### 4.4 Census of the chosen build (MEASURED)

| Class | Kalimdor | Eastern Kingdoms | Total |
|---|---:|---:|---:|
| Spawns with a world point | 33,410 | 41,198 | 74,608 |
| In the main component | 31,650 | 40,944 | 72,594 |
| Outside it | 1,748 | 229 | 1,977 |
| of which Teldrassil and Darnassus (component 1, 11,977 polygons; the Rut'theran portal, a `teleport` connector missing) | 1,334 | — | 1,334 |
| of which Rut'theran Village (component 2, 9,239 polygons; the Auberdine boat, a same-map `TravelGraph` transport) | 9 | — | 9 |
| of which Gnarlpine Hold (component 23, 98 polygons; a walk-in quest camp, mesh break suspected, RC-02) | 27 | — | 27 |
| of which Thunder Bluff (elevators missing, D-031) | 93 | — | 93 |
| of which to review (Gnarlpine Hold included) | 312 | 229 | 541 |
| No polygon within 6 yd | 12 | 25 | 37 |
| Snap ambiguous: containing candidates span components (legs flagged, §8.3) | 653 | 407 | 1,060 |
| In main, standing over an off-main floor of ≥ 20 polygons (information) | 599 | 487 | 1,086 |

The rows for components 1, 2 and 23 are the re-critique's split of revision 2's single
"Teldrassil and Darnassus (island, boat)" row of 1,370 (RE-CRITIQUE, RC-01 and RC-02; 1,334 + 9 +
27 = 1,370). Revision 2 bucketed the census by zone, which hid Gnarlpine Hold: 3b.4's census is
per component, each identified by its anchor (§12), and recomputes every row. Rut'theran's 9
move from "island" to "transport" and stay reviewed; the critic's "at least 550" counts them with
the 541.

By size of the component they land in (both maps, off-main only): 1,343 in components of at
least 2,000 polygons, all Teldrassil, Darnassus and Rut'theran. Then 175 in 200-1,999, 331 in
20-199 (Gnarlpine Hold among them), and 128 under 20.

Zones with the most off-main spawns after the reviewed ones (nav-m3b.json
`final.perMap.*.zonesTop`):

- Kalimdor: Darkshore 88 of 2,020, Desolace 39, Felwood 37, the Barrens 29, Ashenvale 23,
  Feralas 19, Durotar 18.
- Eastern Kingdoms: Stranglethorn Vale 33 of 3,274, Alterac Mountains 23, Burning Steppes 22,
  Searing Gorge 19, Dun Morogh 19, Silverpine Forest 16, Redridge Mountains 15, Undercity 12.

Among unreviewed zones with at least 50 spawns, the lowest main share is Undercity's 94.0%
(12 of 199 off-main). Next are Darkshore 95.6% and Ironforge 95.7% (nav-m3b.json
`facts.map*.worstZones`). Two new small areas fall below that: AreaTable 10089 (1 spawn) and
10074 (3 spawns). They go to the review. These shares are against the map's main component, so
they cannot see a break inside a reviewed island: 3b.4 also measures each zone against its own
dominant component (§12, RC-02), which is where Gnarlpine Hold's 27 of Teldrassil's spawns show.

### 4.5 The critic's must-connect places and the three that stayed isolated (TN-01)

**Region probes** (`region.ts`, nav-m3b.json `isolatedPlaces`). Durotar and Orgrimmar were built
as two blocks per setting. Each probe takes the polygon containing the point and nearest the
height the critic recorded. A cell gives the size in polygons of the isolated component the probe
lands in.

| Setting | Cleft of Shadow floor (npc 5639, z −24) | Zamja upper floor (npc 3399, z 98.5) | Dustwind upper layer (npc 3116, z 40.5) | Burning Blade Coven (npc 3197) | Skull Rock (npc 3131) |
|---|---|---|---|---|---|
| `c1r1` | 19 | 136 | 129 | 47 | 87 |
| `c1r0` | 25 | 255 | 190 | 73 | main |
| `c05r1` | 369 | 214 | 128 | main | main |
| `c05r1+a` (all M2) | 369 | 214 | 128 | main | main |
| `c05r1+c2` (climb 2 yd) | 387 | 218 | 116 | main | main |
| `c05r1+o60` (60° on objects only) | 369 | 226 | 128 | main | main |
| `c05r1+s60` / `+s70` | **main** | 237 / 264 | 105 / 107 | main | main |
| `c05r1+t4+n12+e4+s60` | 251 | 183 | 63 | main | main |
| `c05r1+t2+n12+e4+s60` | 257 | 194 | 77 | main | main |
| **chosen** | **main** | 195 | 84 | main | main |

Findings:

- **Skull Rock and Burning Blade Coven** join the main component at 0.52 yd cells, as the critic
  found. One Burning Blade Coven spawn stands over an isolated 138-polygon floor as well
  (RE-CRITIQUE, RC-05); the snap order hides it, so G7 now checks every containing floor.
- **Cleft of Shadow.**
  - At npc 5639's point there are two floors: the Valley of Strength above, and the Cleft at
    z −22 to −24 (probe heights).
  - The Cleft floor is terrain. Its closest approach to the main component is a 3.2-yd vertical
    step at (1827.6, −4426.6). A WMO ramp there reaches it, and the terrain between them is
    steeper than 55° (`geomprobe.ts`).
  - The Cleft joins at slope ≥ 60° with 256-voxel tiles. With 512- or 1024-voxel tiles it stays
    separate, a region-partitioning sensitivity.
  - In the chosen build both floors are main. The six NPCs whose 9 spawns sat on the separate
    Cleft floor at slope 55° (npc 5882, 5883, 5885, 5958, 7311, 11178) now snap into the main
    component (`facts.map1.cleftNpcs`).
- **Zamja (npc 3399) and Dustwind Cave (npc 3116):** in the chosen build the 2D snap lands in the
  main component, on the lowest plausible floor. The height the critic recorded is on an upper
  floor, and that floor stays isolated at every setting tried:
  - Zamja's floor: z 51-120, 195 polygons, its closest approach 28 yd from main;
  - Dustwind's layer: z 27-66, 84 polygons, 13.6 yd from main (`probes.isolatedFloorGaps`); 3 of
    Dustwind's 13 spawns have a containing polygon on it (RE-CRITIQUE, RC-05).

  Dustwind's 13 of 13 pass exists only because the snap orders component size before the lowest
  floor. G7 therefore checks every containing floor of at least 20 polygons, with these two upper
  floors as reviewed exceptions (§16).
- **Gnarlpine Hold** (RC-02): component 23, 98 polygons on Teldrassil's surface (z 1,258-1,312,
  around world X 9,730-9,896, Y 1,460-1,630) with 27 spawns: Gnarlpine Shaman, Defender and Augur
  (npc 2009, 2010, 2011), Rageclaw (npc 7318) and three chests (object 106318). It is a level 6-10
  quest camp, walked in the game. No setting of the sweep joins it: 43 of the camp's 67 spawns are
  cut off in the chosen build, 21 at `c05r1` and 14 at `c1r1` (RE-CRITIQUE).
  Its cause is found before 3b.3 freezes the settings, as the Cleft's was (a slope limit); if it
  is not found, it is reviewed as `mesh-break-suspected` pending a `walk` connector. It is a G7
  must-connect fixture either way.

  The dataset has no heights, so which floor the NPC is on is UNKNOWN. The census reports both
  as "main, over an off-main floor" (§12). No coordinate problem was found (next point).
- **QuestieDB's Era coordinates against the new Orgrimmar WMO:**
  - 158 of the 159 Orgrimmar spawns (99.4%) lie inside a mesh polygon, and 1 within 6 yd;
  - 1 is off-main;
  - rule A changes nothing, because every floor there is zone 1637.
  - The same rates for old-WMO cities: Stormwind 99.6% inside and 0 off-main; Undercity 89.9%
    inside and 12 off-main; Ironforge 89.0% and 7.

  There is **no 2D evidence** that the Era positions miss the new city. Heights cannot be
  checked. (`cities.ts`, nav-m3b.json `multiLevel`.)
- **Thunder Bluff:** the four rises, the rope bridges and the Pools of Vision form one
  953-polygon component. It holds npc 10086, 3036, 3032 and 3046 and 93 Thunder Bluff spawns.
  It joins Mulgore only through elevator connectors (§11).
- **Thousand Needles** is in the main component without the Great Lift, over land (1 of 1,725
  spawns off-main). Until the lift connector exists, Barrens → Needles legs detour by land. That
  errs long, never short.

---

## 5. Block format v3

One file per 4×4-ADT block: `public/nav/<mapId>/<row0>_<col0>.bin`, with rows and columns in
ADT tile units. Encoding:

- little-endian;
- unsigned LEB128 varints;
- zigzag for signed deltas;
- **no floating point anywhere**: every coordinate is an integer on the map's voxel grid.

```
'FRN3'  u8 version = 3
varint mapId, varint row0, varint col0
zig    blockStep                  (0 in this build; the tile steps carry the origin)
varint tileCount
per tile (in Recast order):
  varint dtx, varint dtz          tile position inside the block (tx0 = (63 - (row0 + 3)) * 4, tz0 = col0 * 4)
  zig    originStep               tile heightfield origin = mapOriginZ + (blockStep + originStep) * 0.25 yd
  varint nv, varint np
  nv x (zig dx, zig dz, zig dy)   vertex voxel coordinates, delta to the previous vertex;
                                  x, z in 0..256 (cells of 0.521 yd), y in 0.25-yd steps
  np x (u8 header = (nv_p - 3) * 2 + swim,  nv_p x zig (index - previous index))
attributes (mode 3):
  u8 3, varint zoneCount, zoneCount x varint AreaTable id (top-level zones of this block)
  per tile: varint n, n x varint zone index, then (n > 1) per polygon varint local index
```

A block carries no component index (RC-03). Components are global to a map and ordered by size,
so they change with any connector, pruning or dataset change; in the prototype's final blocks,
merging Thunder Bluff into main through one elevator changed 43 of Kalimdor's 58 blocks
(RE-CRITIQUE). They live in the per-map `map.bin` instead (below). The prototype's mode 2, with a
component stream, is retired. §4.3's sizes include that stream, so dropping it can only shrink
the blocks; `map.bin` is new bytes, measured in 3b.4.

World coordinates:

```
X = -17066.667 + tx·133.333 + vx·0.520833
Y = 17066.667 - tz·133.333 - vz·0.520833
Z = mapOriginZ + originStep·0.25 + vy·0.25
```

`mapOriginZ` is 0 in this build: only the grid phase matters.

**Derived, not stored:**

- **Internal adjacency.** Two polygons of a tile are neighbours when they share a vertex-index
  pair in opposite order. The pairing is Recast's own `buildMeshAdjacency` pairing:
  - forward edges (v0 < v1) are listed per v0, in polygon order;
  - each reverse edge takes the first unmatched forward edge.

  So adjacency is symmetric even where more than two polygons meet at one edge. A first map-based
  version left 155 of 1.9 million internal edges without a reverse; the Recast pairing leaves
  none (`linkSymmetry`).
- **Portal edges.** An edge with no internal neighbour whose two vertices both lie on x = 0,
  x = 256, z = 0 or z = 256 is a portal to the tile on that side. This is Recast's own rule for
  border edges.
- **Check** (`adjcheck.ts`, nav-m3b.json `adjacency`): on all 512 Recast tiles of two Durotar
  blocks, the derived adjacency equals the neighbours `rcPolyMesh` stores for 54,098 of 54,098
  internal edges, and the derived portals equal its portal flags for 7,924 of 7,924 edges.
- **Cross-tile links** are the relinker's job (§6.1).

**Why this layout (MEASURED on the chosen build's stage-1 blocks, both maps, before pruning;**
nav-m3b.json `encoding`**):**

| Variant | gzip6 | vs chosen |
|---|---:|---:|
| Chosen: voxel integers, Recast vertex order, no neighbours | 7,181,158 B | — |
| Vertices renumbered by first use | 7,459,539 B | +3.9% |
| Explicit neighbour per edge (the v2 approach) | 9,751,847 B | +35.8% |
| 1/8-yd XY and 1/4-yd Z vertices (the v2 quantisation) | 8,495,583 B | +18.3% |
| Zone attribute stream added (component stream all zero) | 7,483,856 B | +4.2% (+0.3% for the attributes alone) |

At the first design's settings, v3 is 5,887,812 B against compact v2's 8,558,774 B, which is
−31.2%.

**Per-map file** (`public/nav/<mapId>/map.bin`, stage 2's output, RC-03). The same encoding
rules (little-endian, LEB128, zigzag, no floating point):

```
'FRNM'  u8 version = 1
varint mapId, varint blockCount, varint polygonCount    (must equal the manifest's block list)
components:
  varint componentCount
  componentCount x varint size                          (polygons; index order = size desc, then lowest polygon id)
  varint runCount
  runCount x (varint component index, varint run length) over global polygon ids 0..polygonCount-1
connector links (directed, §11.2):
  varint linkCount
  linkCount x (varint connector index, varint from polygon, varint to polygon, varint cost tenth-seconds)
unverified passages (§11.3, RC-09):
  varint passageCount
  passageCount x (varint passage index, varint runCount, runCount x (zig polygon delta, varint run length))
```

Connector and passage indices refer to the manifest's `connectors` and `passages` lists (their
ids, in file order). Its size is measured in 3b.4 and counts in the `nav` total (§14.3).

**Manifest** (`public/nav/manifest.json`):

- `navRevision` (SHA-256 over sorted (path, SHA-256) pairs, blocks and `map.bin` files);
- the pin (product, version, build key);
- the root CKey;
- the `toolTreeHash` of `tools/terrain` and `tools/casc`;
- recast-navigation's version and WASM SHA-256;
- every setting;
- per map: the block list in canonical order (path, row0, col0, polygon count, bytes, SHA-256,
  **per-block stage-1 input hash**); the `map.bin` path, bytes and SHA-256; the component count
  (1,138 and 1,101 after pruning in the prototype); the connector ids applied and the passage ids
  tagged; and the census summary hash;
- **the stage-2 inputs** (RC-03): the dataset revision and the SHA-256 of `spawns.json`, and the
  SHA-256 of `census-reviewed.json`, `connectors.json` and `passages.json` (LF bytes), plus the
  prune and water parameters;
- no timestamps.

Global polygon ids are defined by the manifest's block order and polygon counts, never by load
order.

The per-block input hash is a SHA-256 over the sorted (FileDataID, CKey) list of the files that
block read, including the ring (TN-16); `blockGeometry` returns the FileDataIDs and
`LocalCasc.ckeyOf` their CKeys. **It covers stage 1 only.** A block's final bytes also depend on
which of its polygons stage 2 prunes, which the stage-2 inputs decide; a pin bump therefore
rewrites the blocks whose inputs changed plus the blocks whose pruning changed, and `map.bin`.
The full lists go only to the gitignored `generated/terrain-report.json`; git deduplicates
identical blobs.

---

## 6. Seams (TN-06)

### 6.1 The slab relinker

For each tile side with a loaded neighbour, every portal edge on that side is matched against
the neighbour's portal edges on the opposite side. This follows Detour's
`dtNavMesh::findConnectingPolys` and `overlapSlabs`, reimplemented in TypeScript (not copied):

1. The two edges must lie on the same line, within 0.01 yd.
2. Their along-side intervals, each shrunk by 0.01 yd, must overlap.
3. Heights are interpolated linearly at both ends of the overlap. The edges link when they cross,
   or when either end's height difference is at most 2 × walkableClimb (3.0 yd).
4. At most one link is made per target polygon for a given source edge.
5. The portal is the overlap interval, kept in the source polygon's vertex order for the funnel.

Every link is made from both sides. In the final blocks, all 175,453 cross-tile links have their
reverse: 96,480 on Kalimdor and 78,973 on the Eastern Kingdoms (`linkSymmetry`).

The implementation check against Detour (§16 G10) covers the relinker, the derived adjacency and
the queries together.

### 6.2 Results (MEASURED; nav-m3b.json `seams`)

| Build | Map | Block-seam unmatched | Inner unmatched | Δ | Mid-block lines (control) |
|---|---|---:|---:|---:|---:|
| First prototype, loader rule (critic) | Kalimdor / EK | 2.37% / 2.20% | 1.43% / 1.53% | +0.94 / +0.67 pp | — |
| `c1r1` in v3 | Kalimdor / EK | 1.89% / 2.22% | 1.83% / 2.01% | +0.06 / +0.21 pp | 1.73% / 2.03% |
| **Chosen** | Kalimdor / EK | 2.16% / 2.23% | 2.13% / 2.19% | **+0.03 / +0.03 pp** | 2.07% / 2.26% |

"Unmatched" is the portal-edge length on a side with a loaded neighbour that no link covers.
Much of it is real: a wall on one side, or a region boundary.

The critic's invariant, block seams unmatched ≤ inner + 0.2 pp, holds for the chosen build.
It is a noisy statistic, though. Individual line classes on the Eastern Kingdoms range from
1.78% to 2.82% (`byLineMod32`). `c1r1` misses it by 0.01 pp purely by which lines happen to be
block lines.

The exact test is **partition invariance** (`cmp-partition.ts`): build the same map with 4×4 and
8×8 blocks and compare the SHA-256 of every decoded Recast tile.

| Pipeline | Tiles identical |
|---|---:|
| Per-tile origin, sorted triangles (chosen settings, Eastern Kingdoms) | **11,776 of 11,776** |
| Same, `c1r1` settings | 11,776 of 11,776 |
| Per-block vertical origin, as in the first prototype | 11,667 of 11,776 |
| Unsorted triangles, same partition (sorted vs unsorted) | 11,455 of 11,776 |

All four rows are the Eastern Kingdoms. Kalimdor has no 8×8 build yet, and it is the map whose
2,992-yd height span motivated the per-tile origin: G4 runs on both maps, at least on a Kalimdor
region whose polygons cross the 2,047-yd span of one 13-bit tile range (RC-10, §16).

Consequences:

- Block seams are inner seams by construction. A tile's output depends only on its own
  triangles.
- **Why a per-tile origin, not a single origin per map:** the chosen build's Kalimdor polygons
  span 2,992 yd (z −504 to 2,487), more than the 2,047 yd that 13-bit spans allow at 0.25 yd
  (`facts.map1.unprunedPolygonZ`).
  - A single origin was tested on the Eastern Kingdoms, whose polygons span 1,883 yd, with
    `c1r1` settings and an origin of −1,010 yd. It also gave full invariance (11,776 of 11,776)
    and the same seam figures, 2.22% against 2.01% (`probes.fixedMapOriginSeams`).
  - The per-tile origin sits on the same 0.25-yd grid, costs 0.3% in bytes, and works on both
    maps.

---

## 7. Components and pruning (TN-02)

### 7.1 Build-time components

Stage 2 links the whole map, adds connectors, and labels components over every polygon (ground
and swim). They are ordered by size, then lowest polygon id, and the main component is index 0.
The size table and each polygon's index go into the per-map `map.bin` (§5), never into the
blocks (RC-03).

At runtime:

- the worker loads `map.bin` before the first query of a map (one file per map);
- `comp[a] !== comp[b]` decides "no walking path" in O(1);
- the snap rule reads the stored sizes, so it never depends on which blocks are loaded;
- the fixtures check that the stored components equal a recomputation over the decoded map (0
  mismatches, MEASURED).

### 7.2 Pruning

Rule: a component is dropped when all of these hold:

- it has fewer than 1,000 polygons;
- no dataset spawn snaps into it;
- no dataset spawn has a containing polygon in it;
- it holds no connector endpoint.

Effect on the chosen build:

- 183,421 polygons in 54,516 components are dropped. They are mostly roofs, prop tops and
  isolated pinnacles (INFERRED).
- Size falls from 7.76 to 5.70 MB together with the water rule. The census before and after
  differs by one off-main and one unsnapped spawn, both on Kalimdor and both from the water rule
  (`final.perMap.*.pre` against `.census`).
- Pruning at 100 or with no size limit gives 4.70 and 4.46 MB on `c05r1+t4+n12+e6`, against
  4.49 at 1,000, with the same census (`pruneThreshold`).

The limit of 1,000 keeps large spawn-free components. Such a component is suspicious rather than
junk: in `c1r0`, all of Winterspring was one. Pruning never removes a floor a spawn stands on,
so an ambiguous floor stays visible.

A route point in a pruned area snaps to the nearest kept polygon within 6 yd, or else gets the
labelled fallback (§9.4).

---

## 8. Snapping and multi-level places (TN-07, TN-13)

### 8.1 Rule

An endpoint is (mapId, x, y, hint): x and y quantised to 1 yd, and the hint a top-level zone
AreaTable id. For a dataset spawn the hint is its area key rolled up through `ParentAreaID`. For
a route point it is the zone of its UiMap row. 0 means none.

0. **Loading (RC-06):** before choosing, every block whose rectangle is within 6 yd of the
   quantised point is loaded (at most 4). The snap then never depends on which blocks happened
   to be loaded, and these loads count in the fetch baselines (§9.6).
1. **Candidates:** every walkable polygon whose 2D distance to the point is ≤ 6 yd (0 when it
   contains the point).
2. **Rule A (zone):** if any candidate's zone equals the hint, keep only those. Otherwise record
   "hint miss" and keep all.
3. **Rule B (size):** if some candidates lie in components of at least 20 polygons, keep only
   those. Record a reassignment when this changes the component.
4. **Order:** containing before non-containing, then distance, then component size (largest
   first), then **lowest floor**, then polygon id.
5. **Flags:**
   - `ambiguous`: the remaining containing candidates lie in more than one component;
   - `spanYd`: the vertical spread of the containing floors;
   - `none`: no candidate.

Rule A needs a zone per polygon. That zone is the same derived data as the committed zone
outlines, at polygon resolution, from MCNK area ids and `WMOAreaTable`. **D-034 item 3** records
that D-032's committed zone outlines cover it (RC-08), so the extra owner decision TN-07 asked for
is settled by the decision log, not by this design. It costs 0.3% of the block bytes (§5).

### 8.2 Prototype results on the multi-level cities (MEASURED; nav-m3b.json `multiLevel`)

| City | Spawns | Inside a polygon | Without rule A: lands on another zone's floor | Off-main with A+B (without A) | Ambiguous with A+B (without A) |
|---|---:|---:|---|---:|---:|
| Undercity (1497) | 199 | 89.9% | 20: Tirisfal Glades 17 (the ruins above), Silverpine Forest 3; all > 10 yd off | 12 (22) | 36 (121) |
| Ironforge (1537) | 164 | 89.0% | 22: Dun Morogh (the mountain top above the city), all > 10 yd off | 7 (0) | 1 (0) |
| Orgrimmar (1637) | 159 | 99.4% | 0 (every floor is zone 1637) | 1 (1) | 26 (26) |
| Stormwind City (1519) | 272 | 99.6% | 1 | 0 (0) | 22 (22) |
| Thunder Bluff (1638) | 108 | 97.2% | 2 (Mulgore ground) | 93 (93) | 0 (0) |

Without rule A, Ironforge looks better (0 off-main). That is because 22 of its spawns land on the
mountain top above the city, which the mesh connects to Dun Morogh. Rule A puts them in the
city. The 7 that stay off-main stand on floors of fewer than 20 polygons, with no larger city
floor within 6 yd; they are reported.

### 8.3 Ambiguous floors in legs

A leg is never the minimum over floors.

- If an endpoint's snap is `ambiguous` (1,060 dataset spawns, 1.4%), the leg is computed from
  the chosen floor. It carries the flag `ambiguous-floor`, shown as a warning naming the
  endpoint.
- A vertical spread over 20 yd inside one component (3,464 spawns; mostly bridges and building
  roofs, INFERRED) is recorded in the census but does not flag legs. Rule A and the lowest-floor rule
  handle the city cases that matter. Flagging all of them would bury the real warnings.
- **Floors the snap order hides (RC-05).** The order puts component size before the lowest floor,
  so an isolated floor under or over a main surface always loses to main, and a regression that
  isolates a cave under a walkable surface would not move a single snap. Two checks see it:
  - G7 checks **every** containing floor of at least 20 polygons of every cave fixture, not only
    where the snap lands, with reviewed exceptions for the known upper floors (Dustwind's 84-polygon
    layer, Zamja's 195-polygon floor), and runs a second time with rule B at 10 polygons, so that
    a 19-polygon floor such as `c1r1`'s Cleft stays visible;
  - the census gates the class "in main, over an off-main floor of ≥ 20 polygons" (1,086 spawns in
    the prototype) like off-main spawns: per anchor, reviewed, failing on an unreviewed new
    component or on more than 10% growth (§12).

---

## 9. Queries (TN-03, TN-04, TN-05)

### 9.1 `legsFrom(source, targets)`

It lives in `src/nav` (pure): `sqrt` only, no `hypot` or trigonometry, no clock, no randomness.

1. Targets in another component return `unreachable` at once (O(1)).
2. Dijkstra from the source polygon.
   - The heap is ordered by (cost, polygon id). An equal-cost relaxation keeps the lower parent
     id.
   - Edge cost is the half-edge distance from the centroid (the source point for the source
     polygon) to the portal midpoint and on to the next centroid, each half times its polygon's
     factor: ground 1, swim 7/4.72 (era-assumed run and swim speeds), connector seconds × 7.
   - It stops when every same-component target polygon is settled.
3. Per target:
   - the tree corridor;
   - the simple stupid funnel (Detour's `findStraightPath` algorithm) from the exact source point
     to the exact target point;
   - the **ground/swim split**: the funnel path crosses each corridor portal at one point, and
     between consecutive crossings it is straight inside one corridor polygon, so each piece is
     ground or swim by that polygon;
   - the longest contiguous swim run.
4. The result per target: `{ reachable, groundTenths, swimTenths, connectorTenthsSeconds,
   longestSwimYd, flags }`, lengths rounded to integer tenth-yards (TN-18).

The engine's single legs and the optimiser's matrices both come from this routine, so
equal-cost ties resolve the same way (TN-05).

**The rider approximation.** The path is chosen with on-foot costs, and a rider's leg is
`ground / mountedSpeed + swim / swimSpeed`. This is an **assumption**, recorded with the
`TravelModel`. It errs where a mount would prefer a longer dry path over a short swim. It was
**not measured** on lake or river fixtures; that stays open (§17 U12).

**Horizontal lengths (RC-13).** The funnel runs on the polygons' 2D projection, so leg lengths are
horizontal: a ramp at the 60° slope limit counts half its walked length, and the floors of a
multi-level city add nothing for the climb. This is an **assumption** too (basis `assumption`,
recorded with the rider approximation). 3b.5 reports the 3D ÷ 2D ratio of the Durotar and Barrens
fixtures so its size is known.

**Purity (G14).** The priority queue uses `Math.floor((i − 1) / 2)` for the parent index; the
prototype's `>>` would break the `no-bitwise` rule in `src/nav`.

### 9.2 The leg table

- One directed table, keyed by
  `navRevision | mapId | qx0,qy0,hint0 | qx1,qy1,hint1` (1-yd quantisation).
- The leg is computed from the quantised points and hints, so the cache never depends on which
  requester arrived first (TN-04).
- Values: `{ g, s, c, flags }`: ground and swim tenth-yards, connector tenth-seconds, and flag bits
  (`fallback-cross-component`, `ambiguous-floor`, `long-swim`, `unsnapped-endpoint`,
  `unverified-passage`). A same-map transport path (§9.3) is composed from two leg-table entries
  and a `TravelGraph` edge; it is not a leg-table entry itself.
- Owner: `app`, keyed by revision.
- IndexedDB persistence is deferred until a measured first-walk time needs it (TN-17).

### 9.3 `TravelModel`

```ts
// src/domain (types only)
interface TravelSpeeds { groundYps: number; swimYps: number }
interface TravelModel {
  readonly id: 'straight-line' | 'navigation';
  readonly revision: string;                       // navRevision, or 'straight-line'
  legSeconds(from: Endpoint, to: Endpoint, speeds: TravelSpeeds): Estimated<number>;
  path(from: Endpoint, to: Endpoint): readonly WorldPoint[] | null;
}
```

- **Leg present:** `g/10/groundYps + s/10/swimYps + c/10` seconds.
  - Basis `derived`. When a connector is part of the leg, its seconds carry their own basis
    (`reported` or `client-data`).
- **Cross-component, same map (D-031, D-034 items 1 and 2):**
  1. A `teleport`, `elevator`, `lift` or `walk` connector that is `observed` is already an
     off-mesh link (§11.2), so such a pair is in one component and takes the first case.
  2. Otherwise the `TravelGraph` is asked for a transport path between the two components (a
     boat or zeppelin with both docks on this map, for example Auberdine ↔ Rut'theran): the walk
     to the departure dock from the leg table, the transport edge, and the walk from the arrival
     dock. The route is the cheapest such path; its transport part carries the transport's own
     basis.
  3. Only when neither exists: the labelled straight-line fallback,
     `distance × travelDetourFactor / speed`, basis `assumption`, warning `SIM-no-walking-path`
     ("disconnected in the navigation data; connector missing").
  - Never a confident path across a missing connector, never silently unknown.
- **Endpoint with no polygon within 6 yd:** the labelled fallback plus warning
  `SIM-off-navmesh`.
- **Map without navigation data** (instances, 2997, 3021, and 2991 until built): the permanent
  labelled fallback. This is not "pending" (TN-15).
- **Leg not computed yet:** the fallback value, marked pending.
  - Worker results are batched into one re-walk every 100 ms.
  - Tests and final states run with complete tables.
- **Flags become warnings:** `ambiguous-floor`; `long-swim` when the longest swim run is over
  200 yd ("long swim; fatigue unverified"); and `unverified-passage` when the leg's corridor
  crosses a tagged passage (§11.3), warning `SIM-unverified-passage` naming the passage
  ("passage not verified in game", RC-09, D-034 item 5). The leg keeps basis `derived`; the
  warning keeps the claim honest, so the navigation model stays preferred on map 0.
- `path()` returns the funnel polyline for drawing; `map/layers` keeps its vertex cap.

### 9.4 TIME-2, enumeration and the optimiser

- **TIME-2** keeps choosing the nearest spawn by straight-line distance. One fallback walk then
  enumerates every leg a revision needs: consecutive located steps, `leg` waypoints, the TIME-2
  spawn positions and hearth destinations. Navigation changes only seconds, so enumeration is not
  a fixpoint (TN-04).
- `nearestReachable` is **deferred**.
- **Optimiser.** Compile reads the section's location-by-location matrix from the same leg table,
  as typed arrays.
  - Before compile, the app requests the missing legs from the worker in a "computing paths"
    phase.
  - Pairs across world maps use the `TravelGraph`, and so do same-map pairs in different
    components that a transport joins (§9.3).
  - Fallback entries come from the same `TravelModel`.
  - `transitions.ts` turns tenth-yards into integer milliseconds with the state's speeds, so
    riding state stays exact.
  - Matrices are directed, so one-way drops and connectors fit later.
  - Matrices are cached per (navRevision, sorted endpoint keys).
  - "First improvement < 2 s" is measured after the matrix is ready.

### 9.5 Measured on the fixtures (MEASURED; nav-m3b.json `queries`)

Fixtures:

- Queries run over the whole Kalimdor mesh of the chosen build: 367,400 polygons, loaded in
  703 ms by the experiment.
- Times are the median of three runs on an otherwise idle machine.
- The **Durotar** and **Barrens** sets are the zone's dataset spawns, sorted by (kind, id, x, y);
  every k-th is taken to 300, and each is rounded to 1 yd and snapped with rules A and B.
- Each fixture is one `legsFrom` per source over all 300 targets: 90,000 directed legs.

| Fixture | Reachable legs | Matrix | Per source | Without component pruning | Consecutive legs (299, one target each) | Blocks the searches touch | Deterministic |
|---|---:|---:|---:|---:|---:|---:|---|
| Durotar | 88,218 | **1.76 s** (1.74-1.77) | 5.9 ms (27,160 polygons settled) | 17.46 s (328,734 settled) | 0.40 ms mean | 14 blocks, 1,006,536 B | yes (identical hashes in all runs) |
| Barrens | 89,402 | **6.40 s** (6.29-6.40) | 21.3 ms (111,562 settled) | 18.11 s | 2.16 ms mean | 37 blocks, 2,339,548 B | yes |

- The first design's absolute 2 s budget for a 300-location matrix is replaced by these stored
  baselines, with §14's 25% regression rule (TN-03).
- The Barrens set spans the whole zone, so it is a stress case. Whether optimiser sections are
  smaller is **not established** (RC-07): ARCHITECTURE §14 budgets the optimiser for a pool of 100
  quests, about 300 actions. 3b.5 therefore also measures a **realistic section**: the unique
  locations of a Crossroads quest pool of that size (and, where it fits, of an RXP sample's
  section), stored as a baseline beside Durotar and the Barrens.
- **Absolute ceiling (RC-07).** Stored baselines catch regressions but bound nothing a user
  waits for. The "computing paths" phase for the realistic section gets a ceiling on the
  Milestone 9 throttled profile (4× CPU), set from that measurement in 3b.5 and gated in
  Milestone 9. The phase reports progress (legs done of legs needed) and can be cancelled; a
  cancelled compile keeps the fallback entries, marked pending.
- If real sections miss the optimiser budgets, the next step is a portal graph over block
  borders. It is deferred and unprototyped.

Mesh-derived path ÷ straight line (legs with straight distance > 50 yd):

- Durotar: median 1.169, p90 1.890, maximum 33.3. The maximum pairs npc 3101 with a copper
  vein (object 1731): 64 yd apart, with 27 yd of height between them. Their path is 2,114 yd
  (`probes.durotarOutliers`); a cliff between them is INFERRED. Drops are not modelled, so the
  mesh walks around.
- Barrens: median 1.081, p90 1.152.

Long swims: in Durotar, 9,489 legs have a swim run over 200 yd, and 3,928 over 400 yd. Their
sources are offshore and island points along the Durotar coast (INFERRED from the source
coordinates in `probes.durotarOutliers`). In the Barrens, 638 and 45.

Worker memory. A typed runtime layout needs about 137 B per polygon: Float32 coordinates, Int32
ids, and 3.0 edges and 4.1 vertex slots per polygon. That is 50 MB for the whole Kalimdor mesh
and 44 MB for the Eastern Kingdoms (INFERRED from the measured counts; the experiment's Float64
layout used 307-319 MB of heap). 3b.5 prototypes that typed layout and measures the heap with the
whole Kalimdor mesh resident before §9.6 relies on whole-continent residency (RC-07). Decoding and internally linking one block took:

| Map | p50 | p90 | Max |
|---|---:|---:|---:|
| Kalimdor | 7.8 ms | 19.3 ms | 45.1 ms |
| Eastern Kingdoms | 7.5 ms | 20.1 ms | 26.5 ms |

**The runtime (MEASURED 3b.5; nav-m3b.json `runtime`).** `src/nav` on the committed
`public/nav`, measured by `tests/bench/nav.bench.ts` (three runs, median; the machine above, with
another workload running):

- **Equal to the build.** Loaded in any block order, the runtime mesh equals the build's
  `buildMapMesh` edge for edge on both maps (`tests/nav-runtime.test.ts`), the stored components
  equal a recomputation over it, and its legs equal the build reference (`tools/terrain/lib/legs.ts`,
  the code G10 and G10b check against Detour) bit for bit: 193,456 fixture legs, 0 differences.
  G10b's figures therefore hold for the shipped runtime unchanged.
- **The fixtures reproduce the prototype's:** Durotar 88,218 reachable legs, ratio median 1.1687,
  p90 1.8897, maximum 33.28, 9,489 and 3,928 swims over 200 and 400 yd; the Barrens 89,402, 1.0810
  and 1.1522.
- **Realistic section (RC-07).** Every quest whose `zoneOrSort` is The Barrens (17): 98 quests
  and 289 actions, ARCHITECTURE §14's pool of 100. Locations: each quest giver and turn-in target
  (its first spawn on the map) and one per objective (the spawn nearest the centroid of the
  objective's Barrens spawns; items through their droppers), unique after 1-yd rounding: 116, 9 of
  them off-main. 19 actions have no location: 6 item-started quests, 3 escort events, 9 objectives
  with no Barrens spawn, 1 giver with no spawn on the map.
- **Timings.** The Barrens-scale searches run 15-23% slower than the build reference in the same
  process: the reference stores portal coordinates per edge, the runtime computes them from the
  polygon's vertices to stay within the heap budget. Precomputed edge costs were measured and
  dropped: 6% faster on the Barrens, none on Durotar, for 24 MB more on Kalimdor.

| Fixture | Points | Matrix (range) | Per source (settled) | Build reference | Consecutive legs | 3D ÷ 2D length: median, p90, total | "Computing paths" from an empty mesh | Blocks loaded: by snaps, total |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Durotar | 300 | 1.89 s (1.84-1.93) | 6.3 ms (27,154) | 1.85 s | 0.51 ms | 1.013, 1.025, 1.015 | 1.95 s | 4 (258 kB), 14 (951 kB) |
| Barrens | 300 | 7.33 s (7.20-7.37) | 24.4 ms (111,553) | 6.39 s | 2.67 ms | 1.049, 1.086, 1.052 | 7.46 s | 9 (732 kB), 38 (2.29 MB) |
| Barrens pool (realistic) | 116 | 3.03 s (3.01-3.05) | 26.1 ms (125,121) | 2.47 s | 1.07 ms | 1.044, 1.080, 1.048 | 3.18 s | 11 (854 kB), 43 (2.53 MB) |

"Computing paths from an empty mesh" snaps every endpoint (loading every block within 6 yd) and
then runs the matrix with the searches loading what they reach (RC-06): decoding and linking are
included, fetching and SHA-256 are not. Its loaded blocks are the fetch baseline of §9.6; they
exceed the prototype's settled-block counts because a search loads the block behind a portal
before it knows whether anything there will settle.

- **The 3D ÷ 2D ratio (RC-13, U16):** horizontal lengths understate the 3D length through the
  portal crossings by 1.5% in Durotar and 5.2% in the Barrens in total (1.29 at most).
  The 3D length lifts each crossing to its portal edge's interpolated height and each endpoint by a fan triangle of its polygon. The
  mesh has no detail heights, so this is INFERRED as an estimate of the walked length.
- **Proposed absolute ceiling (RC-07):** 16.0 s for "computing paths" of the realistic section on
  the Milestone 9 throttled profile (3.18 s × 4 × 1.25, rounded up to 100 ms). Fetch and SHA-256
  come on top (3b.6). The runtime reports progress (`LegSearch.run(budget)` yields) and can be
  cancelled between yields. If that wait is judged too long, the deferred portal graph (§9.5) is
  the next step.
- **Memory (RC-07).** Typed layout with Kalimdor resident: 49.5 MB of mesh arrays plus
  10.3 MB of search scratch, 162.7 B per polygon; heap growth after gc 60.9 MB. The Eastern
  Kingdoms: 43.1 MB plus 9.0 MB, 52.8 MB. Coordinates stay Float64 so the runtime equals the
  build bit for bit.
- **Loading:** a whole continent in 215 ms (Kalimdor) and 158 ms (Eastern Kingdoms). One block
  decoded and linked alone: p50 2.7 ms, p90 5.2 ms, maximum 11.8 ms (Kalimdor); 3.4, 8.2 and
  14.1 ms (Eastern Kingdoms).

### 9.6 Worker loading (TN-15)

- **Where the work runs.** `src/nav/worker` fetches blocks itself, base-URL relative, verifies
  each against the manifest's SHA-256 with `crypto.subtle`, decodes it, and links it to its
  loaded neighbours. `infra/nav` only locates the manifest.
- **The per-map file first.** Before the first query of a map the worker fetches and verifies
  its `map.bin` (components, connector links, passage tags; §5).
- **Resumable search.** A query is a resumable Dijkstra. The search pops a polygon in normal
  order. If a border edge of that polygon, **or a connector link from it** (RC-06), leads into a
  block that is not loaded, the search pauses before relaxing the polygon. It fetches, verifies
  and links the block, then relaxes the polygon with its new cross links. The expansion order
  depends only on (cost, id), so results equal those of a fully loaded mesh whatever the load
  order.
- **Snapping loads** every block within 6 yd of the endpoint first (§8.1).
- **Test (RC-06):** a unit test snaps and queries the synthetic meshes under several random
  block load orders (a seeded order generator in the test, never in `src/nav`) and compares every
  snap and leg with the fully loaded mesh.
- **Pinning.** Blocks touched by a running query are pinned until it completes. The LRU evicts
  only unpinned blocks. The target heap is ≤ 128 MB, which holds a whole continent (about
  50 MB).
- **Fetch scope.** A target's component is known only after its snap, which needs the blocks
  around it (RC-06): those loads happen for every target. After that, targets in other components
  never trigger search loads. The prototype's fixture figures count settled blocks only: Durotar
  14 blocks (1.0 MB), the Barrens 37 blocks (2.3 MB). 3b.5's baselines count the snap loads too.
- **Prefetch** along the straight line is allowed as an optimisation. It never changes results.

---

## 10. Water (TN-10)

- **The problem.** MH2O deep bits cover only 1.6-1.7% of liquid quads (critic TN-10,
  `carriedOver`), so nearly all ocean is swimmable in the mesh. Fatigue in Forever is UNVERIFIED, and the owner is not calibrating now.
- **Conservative default rule.** A swim polygon whose distance from the nearest ground polygon,
  measured through water, exceeds N/2 is dropped. Open water wider than N is therefore not
  connected unless a verified connector says so. Rivers and coasts of any length stay
  swimmable.
- **Choosing N from the data** (MEASURED on `c05r1`, unpruned; nav-m3b.json `water`):

| N (yd) | Kalimdor off-main | Teldrassil spawns sharing a component with Darkshore | EK off-main |
|---:|---:|---:|---:|
| ∞ (no rule) | 1,978 | **8** | 623 |
| 200 | 2,715 | 0 | 1,140 |
| 400 | 2,053 | 0 | 731 |
| 600 | 1,999 | 0 | 651 |
| **800** | 1,987 | **0** | 623 |
| 1,200 | 1,978 | 8 | 623 |

  **N = 800 yd** is the largest value tested that keeps the must-not-connect fixture. It changes
  the Kalimdor census by 9 spawns and the Eastern Kingdoms by 0. Values from 1,200 up let
  Teldrassil leak again.
- **Diagnostic** (a validate report, not a failure): components that are one at N = ∞ and split
  at N. For the chosen build these are:
  - a 9,239-polygon part of Teldrassil that reached the mainland only by a long swim;
  - an offshore Tanaris piece (799 polygons);
  - a 50-polygon piece of Azshara;
  - Gillijim's Isle (2,129 polygons, Eastern Kingdoms).

  Each needs a reviewed reason ("island"), like census components. The
  diagnostic also catches land connections that were only masked by swimming: in `c1r0` it split
  Lordaeron from the southern Eastern Kingdoms (§4.2).
- **Fixtures:** Teldrassil (141) ↔ Darkshore (148) must not connect. More are added after owner
  verification.
- **Leg warning:** `long-swim` when the longest contiguous swim is over 200 yd (§9.3).
- **Size:** the rule drops 15,635 swim polygons in the chosen build (8,648 and 6,987).

---

## 11. Connectors (TN-08, D-031, D-034)

### 11.1 File

`tools/terrain/inputs/connectors.json` (committed). The template is
`<m3b>/connectors.template.json` (its Mulgore landing corrected to UiMap 1412, RC-12):

```json
{
  "schema": 1,
  "kind": "nav-connectors",
  "connectors": [
    {
      "id": "thunder-bluff-elevator-west",
      "status": "todo",
      "type": "elevator",
      "map": 1,
      "bidirectional": true,
      "a": { "uiMapId": 1412, "x": null, "y": null, "floor": "lowest", "note": "bottom landing, on the Mulgore ground" },
      "b": { "uiMapId": 1456, "x": null, "y": null, "floor": "highest", "note": "top landing, on the rise" },
      "rideSeconds": { "value": null, "basis": "reported", "note": "platform moving, one way" },
      "waitSeconds": { "value": null, "basis": "reported", "stat": "max" },
      "transport": { "gameObjectEntry": null, "transportAnimationId": null },
      "observed": { "date": null, "build": null, "by": "owner" },
      "citation": null
    },
    {
      "id": "rutheran-to-darnassus-portal",
      "status": "todo",
      "type": "teleport",
      "map": 1,
      "bidirectional": false,
      "a": { "uiMapId": 1438, "x": null, "y": null, "floor": "only", "note": "the portal in Rut'theran Village" },
      "b": { "uiMapId": 1457, "x": null, "y": null, "floor": "only", "note": "where you arrive in Darnassus" },
      "castSeconds": { "value": null, "basis": "reported", "note": "stepping in to control at the arrival, loading screen included" },
      "waitSeconds": { "value": 0, "basis": "reported", "stat": "max" },
      "transport": { "gameObjectEntry": null, "transportAnimationId": null },
      "observed": { "date": null, "build": null, "by": "owner" },
      "citation": null
    }
  ]
}
```

Row fields:

- `type`: `elevator`, `lift`, `teleport` or `walk`. A `teleport` row is a portal or teleporter
  (D-034 item 1): one direction per row unless both ends are portals, with `castSeconds` in place
  of `rideSeconds`. A `walk` row is a passage the owner walked that the mesh does not connect.
- Boats and zeppelins are not connectors. They are `TravelGraph` transport edges (ARCHITECTURE
  §9.1), also when both docks are on one map (D-034 item 2, §9.3).
- `status`: `observed` (built) or `todo` (listed by validate as missing).
- Endpoints are `/way`-style zone percent on a UiMap, resolved with `src/geo` and the committed
  geometry. **Validate rejects** an endpoint whose `uiMapId` has no `UiMapAssignment` row on the
  connector's `map` in the committed geometry (RC-12: the first template named Mulgore's AreaTable
  id 215 where its UiMap, 1412, belongs).
- `floor` (`lowest`, `highest` or `only`) picks the floor at that point. It is needed because an
  elevator's landings share X and Y.

### 11.2 Build rules

- Every `observed` row becomes a directed off-mesh link, or two links, before components are
  computed, stored in `map.bin` (§5). Its cost is wait + ride (or cast) seconds; the link has no
  length.
- **Ride time sources:**
  - the observed stopwatch time (basis `reported`); or,
  - when `transport.transportAnimationId` cites a `TransportAnimation.db2` TransportID, the
    keyframe span (basis `client-data`, D-022). Keyframes give time but no world position, so
    the endpoints still come from the owner.
- Emulator rows are allowed only with basis `era-assumed` and a citation. None are planned.
- A `todo` row changes nothing. The census names it as the reason for its component, for example
  Thunder Bluff's 93 spawns.

### 11.3 How-to for the owner (one connector, about five minutes)

1. Stand on the lower landing. Open the world map on the zone it belongs to (Mulgore for the
   Thunder Bluff ground) and read the cursor or `/way` coordinates to two decimals. Enter
   `uiMapId`, `x`, `y` and `floor: "lowest"` in `a`.
2. Ride up. On the upper landing, record `b` the same way, on the map the game shows there
   (Thunder Bluff), with `floor: "highest"`.
3. Ride time: start a stopwatch when the platform starts moving and stop it when it stops. Wait
   time: the longest time you waited for the platform to arrive (`stat: "max"`), or one full
   cycle minus the ride.
4. Record the date and the client build shown at login, set `status` to `observed`, and commit.
   The next build connects the component. Validate reports the census change.

A teleport row the same way: stand on the portal's arrival spot for `b`, the portal itself for
`a`, and time from stepping in to having control at the arrival (`castSeconds`).

Needed:

- Thunder Bluff: at least three elevators;
- Undercity: three;
- Rut'theran Village → Darnassus: the portal (`teleport`), and Darnassus → Rut'theran if the
  game has a return portal (RC-01);
- the Great Lift: optional, Thousand Needles is connected over land.

The Auberdine ↔ Rut'theran boat needs no row: it is a `TravelGraph` transport (§9.3).

**Unverified passages (RC-09, D-034 item 5).** Walks the mesh finds that may be false passes are
tagged at build time from `tools/terrain/inputs/passages.json` (committed):

```json
{ "schema": 1, "kind": "nav-passages", "passages": [
  { "id": "undercity-west-tunnel", "map": 0, "status": "unverified", "zone": 1497,
    "box": { "xMin": 1580, "xMax": 1695, "yMin": 420, "yMax": 735, "zMin": -52, "zMax": 79 },
    "check": "walk from Varimathras to Brill without an elevator" },
  { "id": "ironforge-mountain-top", "map": 0, "status": "unverified", "zone": 1,
    "box": null, "check": "walk from the mountain top above Ironforge to Dun Morogh" }
] }
```

- The polygons whose centroid lies in the box (and whose zone is `zone`, when given) are the
  passage; `map.bin` lists them (§5). A `box` of null is an error for an `unverified` row: the
  Ironforge box is drawn in 3b.4 from a local render (`<m3b>/layers.ts`).
- A leg whose corridor crosses a tagged polygon carries `unverified-passage` (§9.3). Every
  Forsaken city leg does until the tunnel is checked.
- The owner's in-game checks are tracked in STATUS (D-034 item 5). `verified-pass` removes the
  tag; `verified-block` turns the passage into a must-not-connect fixture plus a mesh cut.

**The Undercity city is in the main component without elevators.** Its polygons (zone 1497) climb
continuously from z −52 to +79 through a tunnel on the west side, at about X 1,580-1,695 and
Y 420-735. `path.ts` gives Varimathras → Brill as 1,692.5 yd, against 986 yd straight
(`probes.undercityToBrill`). Whether that tunnel is walkable in game is UNKNOWN.

---

## 12. Spawn census gate (D-030, TN-01, TN-11, TN-13)

- **What it snaps.** Every dataset spawn with a world point on a built map is snapped with the
  runtime rules (§8.1).
- **Components.** Off-main spawns are grouped **by component, never by zone** (RC-02: zone
  buckets hid Gnarlpine Hold inside the reviewed Teldrassil row). A component is identified by its
  **anchor**: the lowest (kind, id, spawn index) among the dataset spawns in it. The anchor
  survives rebuilds, whereas component ids change.
- **The reviewed file** is `tools/terrain/inputs/census-reviewed.json` (committed). The example
  below shows the shape; the anchors and counts come from 3b.4's first per-component census:

```json
{ "schema": 1, "components": [
  { "map": 1, "anchor": { "kind": "npc", "id": 1984, "index": 0 }, "reason": "teleport-connector-missing", "zones": ["Teldrassil", "Darnassus"], "connectors": ["rutheran-to-darnassus-portal"], "spawns": 1334, "note": "reached from Rut'theran through the portal" },
  { "map": 1, "anchor": { "kind": "npc", "id": 3838, "index": 0 }, "reason": "transport", "zones": ["Teldrassil"], "spawns": 9, "note": "Rut'theran Village: the Auberdine boat (TravelGraph)" },
  { "map": 1, "anchor": { "kind": "npc", "id": 2009, "index": 0 }, "reason": "mesh-break-suspected", "zones": ["Teldrassil"], "spawns": 27, "note": "Gnarlpine Hold, walked in game; G7 fixture" },
  { "map": 1, "anchor": { "kind": "npc", "id": 2798, "index": 0 }, "reason": "elevator-connector-missing", "connectors": ["thunder-bluff-elevator-west"], "spawns": 93 }
], "overOffMainFloor": [
  { "map": 1, "anchor": { "kind": "npc", "id": 3116, "index": 0 }, "reason": "upper-floor", "spawns": 3, "note": "Dustwind Cave's 84-polygon upper layer" }
], "unsnapped": [ { "kind": "npc", "id": 0, "index": 0, "reason": "no-mesh" } ] }
```

- **Reasons:**
  - `transport`: a `TravelGraph` boat or zeppelin reaches it (was `island-transport`);
  - `teleport-connector-missing`: a portal row is `todo` (D-034 item 1);
  - `elevator-connector-missing`;
  - `upper-floor` (only in `overOffMainFloor`): a known isolated floor above or below a main
    surface, such as Dustwind's and Zamja's;
  - `enclosed` (a room, cage or counter; reached by interaction range);
  - `unreachable-terrain` (plateau, roof, pinnacle);
  - `floor-ambiguous`;
  - `mesh-break-suspected`: a candidate for a `walk` connector after owner verification;
  - `no-mesh` (water, cliff face, no geometry within 6 yd);
  - `other`, with a note.
- **The gate fails when:**
  - an off-main or unsnapped spawn's component has no reviewed anchor;
  - a spawn in the main component stands over a containing off-main floor of at least 20
    polygons whose component has no reviewed anchor in `overOffMainFloor` (RC-05; 1,086 spawns in
    the prototype);
  - a reviewed component's spawn count, in either list, grows by more than 10%;
  - a zone with at least 50 spawns keeps less than 90% of them in its **dominant component**
    (the one holding most of them), which must be main unless the zone is reviewed (RC-02). The
    worst unreviewed zone today is Undercity at 94.0% in main. The rule catches broken land
    bridges such as `c1r0`'s, and now also a break inside a reviewed island such as Teldrassil.
- **Report only**, not failures:
  - rule-driven reassignments;
  - `ambiguous` snaps;
  - the water split list.
- **First review.** The chosen build's first review covers, per component: the 1,334 Teldrassil
  and Darnassus spawns (teleport), the 9 Rut'theran spawns (transport), the 93 elevator spawns,
  541 others (514 in 137 components, 83 on Kalimdor and 54 on the Eastern Kingdoms, plus
  Gnarlpine Hold's 27 in one more), the over-an-off-main-floor components, and 37 unsnapped.
  `<m3b>/path.ts` renders any component locally (never committed).

The census is the gate against false *blocks*. False *passes*, such as the Undercity tunnel,
need owner observations (§11.3). The detour ratios in §9.5 are mesh-derived and are not accuracy
claims (TN-11).

---

## 13. Byproducts (D-032)

### 13.1 Formats and sizes (MEASURED; nav-m3b.json `byproducts`)

Built from the same parsed ADT roots in about 11 s for both maps (`byproducts.ts`).

| Output | Format | Kalimdor | Eastern Kingdoms | Both |
|---|---|---:|---:|---:|
| Zone outlines | `zones.json` arcs, gzip6 | 3,103 B (127 arcs, 1,973 vertices, 26 zones) | 2,924 B (109 arcs, 1,808 vertices, 28 zones) | 6,027 B |
| Coastline | `coast.json` arcs, gzip6 | 83,807 B (15,633 arcs) | 74,752 B (13,952 arcs) | 158,559 B |
| Relief 16.7 yd/px | 4-bit palette PNG, file bytes | 218,729 B (1568×1792) | 157,213 B (736×1344) | **375,942 B** |
| Relief 16.7 yd/px, 8-bit | palette PNG | 471,766 B | 336,013 B | 807,779 B |
| Relief 33.3 yd/px | 4-bit palette PNG | 58,959 B | 43,020 B | 101,979 B |

- **Zone outlines.** Each MCNK chunk's AreaTable id is rolled up through `ParentAreaID`, and the
  outlines are the boundary arcs between 33.3-yd chunk cells. An arc is a maximal chain between
  one ordered pair of zones, broken at junctions, so neighbouring zones share each arc exactly
  once. The arcs are Douglas-Peucker simplified at 8 yd (sqrt only) and stored as 1-yd integers,
  delta-coded:

  ```json
  { "schema": 1, "kind": "terrain-zones", "mapId": 1, "units": "yd",
    "zones": [14, 17],
    "arcs": [[14, 17, x0, y0, dx1, dy1]] }
  ```

  The `zones` array lists AreaTable ids only. Names come from the dataset and geometry the app
  already has. The measured prototype file also carried the names, so the committed form is
  slightly smaller. Arcs next to area 0 mark unassigned chunks.
- Underground cities are not visible in chunk areas: the chunks over Undercity are Tirisfal
  Glades. The per-polygon zones (§8) carry WMOAreaTable areas instead, so a city outline could
  later come from navigation polygons if the map wants one.
- **Coastline.** Arcs between land quads and water quads (non-hazard liquid more than 0.3 yd
  deep) at 4.17 yd, Douglas-Peucker at 4 yd. Most of the 29,585 arcs are small ponds
  (INFERRED). Dropping water bodies under a size threshold is a later option, and not
  measured.
- **Relief.**
  - A hillshade of MCVT heights box-averaged to 16.7 yd: light from the north-west at 45°, with
    ×2 vertical exaggeration.
  - A palette PNG: entry 0 transparent (no terrain), 1 water, 2-15 fourteen grey levels.
  - The raster's world rectangle is the ADT grid of the map's present tiles, recorded in the
    manifest.

Budget line (a new `terrain` section in dist-requirements): **≤ 600 kB** for all byproducts. It
uses gzip6 for JSON and file bytes for PNG, with baselines + 10%. The chosen formats total
540,528 B.

### 13.2 Rendering plan for the map adapter

This is for the map owners; `src/map` is not changed here.

- **Per surface `world:<mapId>`:**
  - the relief is an `L.imageOverlay(url, [[Xmin, −Ymax], [Xmax, −Ymin]])` under every other
    layer: the backdrop where the committed painted art (§13.4) is missing or too coarse at close
    zoom, and under the art at low opacity elsewhere (D-033);
  - zone outlines are one canvas polyline path per surface, built from the arcs;
  - the coastline is one more path, optional;
  - together that is 2 paths against MAPS §7.2's cap of 2,500.
- Zone fills and hit-testing need rings, which are assembled from the arcs at load. The placeholder
  map can then draw terrain-shaped zones instead of rectangles (D-032).
- At zone zoom (about −2.4) one relief pixel covers about 3 screen pixels. It is a soft backdrop,
  not art.
- New descriptor kinds (`relief`, `outline`) belong in `MapAdapter` and are the map owners'
  decision.

### 13.3 Provenance

`public/maps/terrain/`:

- `manifest.json`: the pin, build, `toolTreeHash` and parameters; **per map, an input hash**: the
  SHA-256 over the sorted (FileDataID, CKey) list of the WDT and root ADTs that map's byproducts
  read (RC-08; D-032 says "input hashes"), with the full lists only in the gitignored
  `generated/terrain-report.json`; for each file, its SHA-256 and world rectangle;
- `NOTICE.md`: derived by this project from Forever client terrain data (heights, liquids,
  per-chunk area ids), not a copy of game files or of the painted map art; Blizzard
  Entertainment owns the game and its data; the owner decisions D-032 and D-033; the
  non-affiliation line;
- `<mapId>/zones.json`, `<mapId>/coast.json`, `<mapId>/relief.png`.

**One dist-audit allowlist (D-033, RC-04).** D-033 turns the map-image rule into an allowlist, and
the terrain byproducts join it instead of taking an exception of their own. An image is allowed
in `dist/` only under `maps/art/` or `maps/terrain/`, only when that folder's `NOTICE.md` and
`manifest.json` exist, and only when the manifest lists the file with its SHA-256. Every other
map-like output stays forbidden, `local-maps/` included.

### 13.4 Painted map art (D-033; step 3b.8)

The world map's painted art is extracted, committed and deployed (D-033); revision 2's
"art stays local" is withdrawn.

- **Source.** `UiMapArt`, `UiMapArtStyleLayer`, `UiMapArtTile` and `UiMapXMapArt` pick the tiles of
  each zone and continent map; `WorldMapOverlay` and `WorldMapOverlayTile` the explored-area pieces
  where they apply. `tools/casc` reads the DB2s (their layouts are in `tools/casc/layouts.ts`) and
  the BLP tiles; `convert.ts` decodes, stitches and crops them (MAPS §5.4 b).
- **Output** (`public/maps/art/`, committed): web images per UiMap and style layer, `manifest.json`
  with the pin, build, `toolTreeHash` of `tools/maps` and `tools/casc`, and per output file its
  SHA-256, pixel size, UiMap and **input hash** (SHA-256 over the sorted (FileDataID, CKey) list of
  the BLP tiles and DB2 tables it was made from); `NOTICE.md` naming Blizzard Entertainment as the owner of
  the artwork, the non-affiliation line, D-033 and its four project rules (non-commercial, notices
  kept, prompt removal on request, no hacks or cheats).
- **Budget.** A separate gated `art` budget of at most 12 MB gzip-6 in decimal units, with
  per-file baselines + 10% (D-034 item 4); `terrain` keeps its 600 kB.
- **Fallback.** The procedural layers (§13.1) stay: they render where the painted art is missing
  or too coarse at close zoom, and the rectangle placeholder remains when both are absent.
- THIRD_PARTY_NOTICES, the README and the About dialog name Blizzard Entertainment as the owner
  of the artwork and state non-affiliation (D-033; for their owners, §18).

---

## 14. Provenance, committed layout and budgets

### 14.1 Committed

| Path | Content |
|---|---|
| `public/nav/manifest.json`, `public/nav/NOTICE.md` | §5; the NOTICE describes a derived polygon mesh (not game files or art) from Forever client terrain, liquids and object collision, with the pin, D-028 and D-030, and the non-affiliation line |
| `public/nav/<mapId>/<row0>_<col0>.bin` | v3 blocks (stage 1, pruned) |
| `public/nav/<mapId>/map.bin` | Components, connector links and passage tags of the map (§5, RC-03) |
| `public/nav/connectors.json` | The `observed` rows with their citations |
| `public/maps/terrain/**` | §13 |
| `public/maps/art/**` | Painted map art with its manifest and NOTICE (§13.4, D-033; step 3b.8) |
| `tools/terrain/build.json` | Pin, maps, settings, prune and water parameters, recast-navigation version |
| `tools/terrain/inputs/connectors.json`, `census-reviewed.json`, `passages.json` | §11, §12 |
| `tools/casc/layouts.ts` | The 14 DB2 layouts, generated from WoWDBDefs (CC BY-SA 4.0, attributed; §2) |

Nothing raw is committed: no ADT, WMO, M2, BLP or DB2. Individual client values in docs and
tests cite table, build and column (D-022). The painted art is committed as web images made from
the BLP tiles, never the BLP files themselves (D-033).

THIRD_PARTY_NOTICES gains:

- "Format definitions" for the WoWDBDefs layouts (added with step 3b.1);
- "Derived navigation data", "Derived terrain map data" and "Map art" sections, the last naming
  Blizzard Entertainment as the owner of the artwork (D-033);
- a build-tools entry for recast-navigation-js (MIT) and Recast/Detour (zlib). They are not
  shipped. Detour is the reference for the relinker and the funnel, whose algorithms are
  reimplemented, not ported.

`.gitattributes`: `*.bin binary`, `public/nav/** linguist-generated=true -diff`.

### 14.2 Reproducibility

CI has no client, so CI runs `validate --offline`:

- hashes;
- decoding every block;
- link symmetry;
- the stored components against a recomputation;
- the fixtures that do not need the client.

`extract --check` rebuilds and compares bytes. It is a manual gate like `data:check`, and it needs
the pinned client. A pin bump is reviewed like a QuestieDB pin bump:

- per-block input hashes and polygon deltas, and the stage-2 input hashes (§5);
- the census diff, per component;
- the water split diff;
- an owner review.

### 14.3 Budgets (proposed; stored baselines with §14's 25% rule for times)

| Gate | Budget | Measured |
|---|---|---|
| `nav` total, gzip6 (blocks and `map.bin` files) | ≤ 7,000,000 B (cap, D-030); target 5-6 MB | committed build (3b.4): 5,423,019 B = map 0 2,526,155 B (50 blocks 2,517,680 + `map.bin` 8,475) + map 1 2,896,864 B (58 blocks 2,886,601 + `map.bin` 10,263); the audit's per-map baselines (was 5,704,757 B of prototype blocks) |
| `nav` per block | ≤ 300,000 B and ≤ baseline + 10% | largest 131,177 B (0/28_28) |
| `terrain` byproducts | ≤ 600,000 B (D-034 item 4) | 445,061 B, 8 files (3b.7; the prototype's 540,528 B had half-coastline arcs, §13.1) |
| `art`, gzip6 | ≤ 12,000,000 B, per-file baselines + 10% (D-034 item 4) | 9,047,639 B, 60 WebP images plus manifest and NOTICE (3b.8) |
| Full build, both continents | ≤ 5 min wall on 8 cores | 76 s wall with 12 worker processes (3b.4); 102 s for `pnpm nav:check` in the verification run, with another workflow sharing the machine |
| `legsFrom` Durotar / Barrens 300-point matrix | stored baseline | 1.76 s / 6.40 s |
| "Computing paths" for a realistic section (RC-07) | stored baseline; an absolute ceiling on the Milestone 9 throttled profile: **16.0 s** proposed (3b.5) | 3.18 s from an empty mesh, 3.03 s resident (Barrens pool, 116 locations, §9.5) |
| Consecutive single legs, Durotar / Barrens fixture | stored baseline | 0.40 / 2.16 ms mean |
| Blocks fetched by the fixtures | stored baseline | 1.01 MB / 2.34 MB |
| Nav worker heap | ≤ 128 MB | 60.9 MB with Kalimdor resident, 52.8 MB with the Eastern Kingdoms (MEASURED 3b.5, §9.5) |
| Block decode and link | p90 ≤ 50 ms | p90 5.2 ms (Kalimdor), 8.2 ms (Eastern Kingdoms) (3b.5) |

---

## 15. Shared CASC reader and map extraction (TN-12)

`tools/casc/` holds everything both tools need. `tools/terrain` and `tools/maps` both import it.
Implemented in 3b.1; the API is in `tools/casc/README.md`.

- `paths.ts`: `WOW_INSTALL`, and the only functions that build install paths (validated names);
- `buildinfo.ts`: four columns, one active row per product, the pin check;
- `config.ts`: the build config's `root` and `encoding`;
- `idx.ts`: v7 `.idx` files, the newest per bucket, the bucket computed from the key, one binary
  search (named `idx.ts`, not `index.ts`, so it is never mistaken for a barrel module);
- `blte.ts`: N, Z and E chunks, chunk MD5s, E reported as zero-filled ranges, F refused;
- `encoding.ts`: page-index search, page MD5 on first use;
- `root.ts`: MFST v2, as sorted typed arrays;
- `casc.ts`: `LocalCasc.open` (pin, MD5 of encoding and root), `file()` by FileDataID with the
  MD5 check, fail-closed on encryption unless zero-fill is asked for, both entry forms;
- `wdc5.ts`: layout-driven WDC5 (all six compression types, copy tables, the relationship map,
  strings), the inline-ID common-data fix, skip exactly the zero-filled encrypted sections, fail
  closed on anything ambiguous;
- `layouts.ts` (generated by `make-layouts.ts` from WoWDBDefs through `dbd.ts` and
  `layout-source.ts`) and `db2.ts` (`readDb2(casc, DB2.Table)`);
- `errors.ts` (`CascError` with a code), `bytes.ts` (arithmetic bit helpers), `test-support.ts`
  (synthetic installs and WDC5 tables, the pinned-client probe and the skip banner).

Map extraction becomes step **3b.8**:

- `tools/maps/import.ts --build` reads `UiMap`, `UiMapAssignment`, `UiMapArt`,
  `UiMapArtStyleLayer`, `UiMapArtTile`, `UiMapXMapArt`, `WorldMapOverlay(Tile)`, `AreaTable` and
  `Map` directly through `readDb2` (every column of these tables equals the research CSVs,
  §1.1). For local sets, TACTTool and DBC2CSV (MAPS §5.4 a) become optional.
- `convert.ts` reads the BLP tiles through the same reader, decodes them (the MAPS §5.4 b port,
  wow.export's BLP code with its MIT header and a THIRD_PARTY_NOTICES "Ported code" entry) and
  writes the **committed** `public/maps/art/` with its manifest, NOTICE and per-file input hashes
  (§13.4, D-033). `local-maps/` stays for developer-local sets (D-018's arrangement, kept by
  D-033).
- MAPS §5 needs this update (§18).

---

## 16. Validation gates

| # | Gate | Where | Status today |
|---|---|---|---|
| G1 | Pin: `.build.info` version and build key equal `build.json` | extract (`LocalCasc.open({ pin })`) | implemented in `tools/casc` (3b.1); the pinned client matches |
| G2 | Inputs: every navigation input present and unencrypted, MD5 = CKey | extract | 13,686 of 13,686 (MEASURED 3b.1 scan) |
| G3 | Determinism: two builds byte-identical (`extract --check`) | manual | pass: `pnpm nav:check`, 113 of 113 files of `public/nav` identical on an independent full rebuild (3b.4; re-run by the 3b verification, 2026-09-26) |
| G4 | Partition invariance: a region built as 4×4 and as 8×8 blocks gives identical tile hashes, **on both maps**, including a Kalimdor region whose polygons span more than 2,047 yd (RC-10); unit tests for the triangle sort | extract test (client), unit; `pnpm nav:validate --partition` | pass on both maps (verified 2026-09-26): Eastern Kingdoms 11,776 of 11,776 tiles, Kalimdor 15,803 of 15,803, including 8×8 block 16_32 whose height span is 2,514 yd; zones differ on 0 |
| G5 | Seams: block-seam unmatched ≤ inner + 0.2 pp per map; every link has its reverse | validate | +0.03 / +0.03 pp; 0 links without reverse |
| G5b | Derived adjacency and portals equal `rcPolyMesh`'s neighbours and portal flags on fixed blocks | extract test (client) | 54,098 of 54,098 and 7,924 of 7,924 |
| G6 | Spawn census (§12), per component: every off-main, unsnapped and over-an-off-main-floor component reviewed by anchor; each zone of ≥ 50 spawns ≥ 90% in its dominant component (main unless reviewed) | validate | pass on the committed build (3b.4; verified 2026-09-26): 1,946 off-main spawns in 134 components, 1,086 over an off-main floor in 117 floor components and 36 unsnapped spawns, all reviewed in `inputs/census-reviewed.json`. Of its 298 entries, 15 carry individual notes (11 `reviewed:` and the 4 G7 floor exceptions); the other 283 (130 components, 115 floors, 36 unsnapped spawns, 2 water splits) carry `rule:` notes drafted by `pnpm nav:review-draft` from geometry, not in-game checks |
| G7 | Must connect (by dataset ids), in the main component: Skull Rock npc 3131 (Durotar), Burning Blade Coven npc 3197 (Durotar), Dustwind Cave npc 3116, Cleft of Shadow npc 5639. **Every** containing floor of ≥ 20 polygons of every fixture spawn must be in main, except the reviewed upper floors (Dustwind's 84-polygon layer, Zamja's 195-polygon floor); run twice, with rule B at 20 and at 10 polygons (RC-05) | validate | pass at rule B 20 and 10 (3b.4; verified 2026-09-26): Skull Rock 11 of 11 and Cleft of Shadow 1 of 1 outright; Burning Blade Coven 23 of 23 and Dustwind Cave 13 of 13 with their reviewed upper-floor exceptions (`mustConnectExceptions`) |
| G7a | Must connect: Gnarlpine Hold (npc 2009, 2010, 2011, 7318 in zone 141) in Teldrassil's dominant component (RC-02) | validate | reviewed exception (3b.3/3b.4; verified 2026-09-26): 100 of the fixture NPCs' 124 spawns are in Teldrassil's dominant component; the other 24 stand in the Ban'ethil Barrow Den's lower chamber (98 polygons), cut off on the den's own ramp; no acceptable setting joins it, so it is reviewed `mesh-break-suspected` pending the owner's walk and a `walk` connector (tracked in STATUS) |
| G7b | Must connect: Thunder Bluff npc 10086, 3036, 3032 and 3046 in one component | validate | pass (one 953-polygon component) |
| G7c | Must connect: Thunder Bluff and Undercity to main, and Teldrassil to Rut'theran, **once** their connectors are `observed` | validate | pending connectors |
| G8 | Must not connect: Teldrassil ↔ Darkshore; Thunder Bluff rises ↔ Mulgore while no connector exists | validate | pass (0 shared components; Thunder Bluff separate) |
| G8b | Unverified passages (Undercity west tunnel, Ironforge mountain top) are tagged in `map.bin` and every leg crossing one carries `unverified-passage` (RC-09, D-034 item 5) | validate, unit | pass: tagged (3b.4); legs through a tagged polygon carry the flag and name the passage (3b.5, `tests/nav-runtime.test.ts`) |
| G9 | Water split list reviewed (§10) | validate | 4 splits |
| G10 | TS ÷ Detour implementation check on blocks 28_36 and 28_40, 300 fixed pairs, the chosen settings at 6 vertices per polygon: median ≤ 1.05, p90 ≤ 1.12, 100% reachability agreement | extract test (client) | median 1.032, p90 1.076, 300 of 300 agree |
| G10b | The same pairs with our TypeScript on the **shipped 12-vertex blocks** against Detour at 6 vertices, the same thresholds (RC-11) | extract test (client) | median 1.032, p90 1.094, 300 of 300 (3b.4, build reference); the `src/nav` runtime equals that reference bit for bit (193,456 legs, §9.5) |
| G11 | Sizes (§14.3): `nav`, `terrain`, `art` | audit-dist | pass (verified 2026-09-26, gzip-6 per file as the audit measures): `nav` 5,423,019 B of blocks and `map.bin` (5,437,717 B with the manifest, NOTICE and connectors), largest file 131,177 B, map baselines re-recorded from the committed build; `terrain` 445,061 B of 600,000; `art` 9,047,639 B of 12,000,000 |
| G12 | Query determinism: fixture hashes equal between runs; the component test gives the same result as the full search; the stored components equal a recomputation; snaps and legs under random block load orders equal the fully loaded mesh (RC-06) | unit and benchmark | pass: `src/nav/load-order.test.ts` (six seeds), `tests/nav-runtime.test.ts` (committed data), fixture hashes in nav-m3b.json `runtime` |
| G13 | Provenance: manifests, NOTICE files, no raw client files in `dist/`, per-block and stage-2 input hashes, per-map byproduct input hashes, per-file art input hashes; the one image allowlist (§13.3) | audit-dist, validate | pass (verified 2026-09-26): `nav:validate` checks the manifest, the per-file SHA-256 of all 113 files, the generated NOTICE, the stage-2 input hashes and the tool tree hash; `maps:validate` A1-A5 the art folder; the dist audit admits images only through the art and terrain manifests, refuses `local-maps/`, and refuses raw client files by extension and by content (BLP, ADT/WDT/WDL/WMO, M2, DB2, BLTE) |
| G14 | `src/nav` purity: no `hypot`, trigonometry, clock or randomness, no bitwise operators; imports per §18 | architecture test | pass (`nav` and `nav/worker` rows, the pure set, no implementation-approximated Math, no bitwise) |
| G15 | Connector file: every endpoint's `uiMapId` has a `UiMapAssignment` row on the connector's map (RC-12); `teleport` rows name `castSeconds` | validate | pass: 2 rows, both `todo` (unit test: UiMap 215 is refused on map 1) |
| G16 | Reader discipline: `tools/casc` never writes, never builds a path outside `.build.info` and `Data/{config,data}`, never opens the network | unit (`casc.test.ts`) | pass (3b.1) |

G10 is an implementation test: it compares our TypeScript with Detour on the same polygons. It
says nothing about fidelity to the game (TN-11).

---

## 17. Implementation plan

Every step ends green on `pnpm check`.

| Step | Files | Tests and gates | Budget |
|---|---|---|---|
| 3b.1 **(done)** | `tools/casc/*` (§15; API in `tools/casc/README.md`) | Synthetic fixtures built inside the tests: a whole install (`.build.info`, build config, 16 idx buckets with an older version each, one archive), encoding pages, MFST blocks, BLTE N/Z/E/F, headerless and zero-placeholder entries, WDC5 with an encrypted zero section, an inline-ID table with common data, pallets, copies, a relationship map. The client test (`casc.client.test.ts`) asserts §2.1's counts and compares ten tables with the research CSVs; without the client it prints a skip banner. G16. no-bitwise lint. | — |
| 3b.2 **(done)** | `tools/terrain/lib/formats/{chunked,grid,wdt,adt,liquid,obj0,wmo,m2,transform}.ts`, `lib/geometry.ts` (AABB clip, quantisation, tags, the WMO liquid rule), `lib/zones.ts`; `tools/terrain/README.md` | Synthetic chunks for every format, the geometry and the zones. With the client (`terrain.client.test.ts`): MODF extents (65 of 65), the MCNK grid, the Undercity WMO (20736 → 1497, 216 groups), and block 1:28_36's golden soup hash (equal to the prototype's). | — |
| 3b.3 | `tools/terrain/lib/recast.ts` (per-tile origin, sorted triangles), `lib/encode.ts` (v3 without the component stream, and the manifest), `extract.ts` (`WOW_INSTALL`, `--check`, `--parts`), `build.json`; maps 0 and 1. **Before the settings freeze:** find Gnarlpine Hold's cause (RC-02), and re-measure sizes and the census with the corrected WMO liquid rule (U14). | G1, G3, G4 on both maps (with the client), decode round trip, G11 | build ≤ 5 min |
| 3b.4 | `tools/terrain/lib/{link,components,prune,water,census,passages}.ts`, `lib/mapfile.ts` (`map.bin`), `validate.ts`, `inputs/connectors.json` (with the Rut'theran portal row), `inputs/passages.json`, `inputs/census-reviewed.json` (first per-component review), `lib/detour-check.ts` | G5-G10b, G12, G15 (offline parts in CI); `map.bin` sizes into §4.3 | — |
| 3b.5 **(done)** | `src/nav/{bytes,grid,manifest,format,mapfile,mesh,link,components,snap,heap,cost,funnel,legs,open}.ts` (pure); `tests/support/nav-mesh.ts`, `tests/nav-runtime.test.ts`, `tests/bench/nav.bench.ts` | Synthetic meshes with exact lengths (a corridor, an L bend, a swim crossing, a portal overlap, a connector link into an unloaded block), tie-break determinism, the split sums, the random-load-order test (RC-06), G14; fixture baselines in `docs/measurements/`, including a realistic section and the 3D ÷ 2D ratio (RC-07, RC-13); the typed layout's heap with Kalimdor resident (RC-07) | §14.3 |
| 3b.6 | `src/nav/worker/*` (fetch, verify, pin, LRU, resumable search with snap loads), `src/infra/nav/manifest.ts`, `app` leg table, `TravelModel` `navigation` with the same-map `TravelGraph` rule (D-034 item 2), SIM warnings including `SIM-unverified-passage` (§9.3), progress and cancel for "computing paths" (RC-07), `path()` route lines | Engine tests with complete tables; pending state; no-nav-map fallback; cross-component fallback; a same-map transport path; the map draws paths | heap ≤ 128 MB |
| 3b.7 | `tools/terrain/byproducts.ts`, `public/maps/terrain/**` with per-map input hashes (RC-08), the one image allowlist (§13.3); map adapter layers (map owners) | Sizes, hashes, the arc topology (every arc used once per side) | ≤ 600 kB |
| 3b.8 | `tools/maps/import.ts --build`, `convert.ts` on `tools/casc`; the committed `public/maps/art/**` with manifest, NOTICE and per-file input hashes (§13.4, D-033) | MAPS §5.5 checks; art hashes; the `art` budget | ≤ 12 MB |
| 3b.9 | Navigation review: accuracy claims, sizes, privacy and provenance, performance | Benchmarks against baselines | — |

**Deferred:**

- `nearestReachable`;
- IndexedDB leg persistence;
- `indoorYards` (no mounting indoors);
- one-way drops as off-mesh links;
- a portal-graph speed-up;
- a calibration set (owner: not now);
- the LiquidObject → LiquidType → LiquidMaterial vertex format (sloped rivers, U3);
- Darkspear Islands (2997) and Eastern Kingdoms Preserved (3021), whose purpose is UNKNOWN.

Zephras Isle (2991) follows 3b.3 once its size and census are measured.

**Risks and unknowns**

| # | Item | Mitigation |
|---|---|---|
| U1 | The client's walkable slope (60° here), climb and swim-start depth are UNKNOWN | Parameters recorded in the manifest; owner checks (§11.3) |
| U2 | Fatigue water in Forever is UNVERIFIED | The N = 800 rule, warnings, reviewed splits |
| U3 | Liquid surfaces are flat at their maximum height | Deferred LiquidObject chain |
| U4 | Server-side doors, gates and phasing are not in client data | Census, owner checks, the "derived" label |
| U5 | Elevators and lifts | D-031 connectors (§11) |
| U6 | 2991 not built; 2997 and 3021 unknown | 1.30 MB headroom |
| U7 | Beta churn | Per-block input hashes, pin-bump review |
| U8 | Floors of 2D points | Rules A and B, flags (§8) |
| U9 | Indoor mounting not modelled | Deferred `indoorYards` |
| U10 | One fast machine | Stored baselines, the Milestone 9 throttled run |
| U11 | Possible false passes: the Undercity tunnel, the Ironforge mountain top | Tagged passages and the `unverified-passage` warning (D-034 item 5); owner checks tracked in STATUS; must-not-connect fixtures after checking |
| U12 | The rider approximation is unmeasured | A lake and river fixture in 3b.5 |
| U13 | The Barrens matrix is 6.4 s | Stored baseline, caching, a realistic-section baseline and an absolute ceiling (RC-07), the deferred portal graph |
| U14 | The corrected WMO liquid rule (§3.1) turns 3,230 triangles in 7 Kalimdor blocks from hazard to water; sizes and the census were measured before it | Re-measure in 3b.3 before the settings freeze; the census diff shows any component that joins or splits |
| U15 | Gnarlpine Hold (component 23) is disconnected at every swept setting | Find the cause before 3b.3 freezes the settings; else a reviewed exception and a `walk` connector after owner verification |
| U16 | Leg lengths are horizontal (RC-13) | Labelled assumption; measured in 3b.5: 3D ÷ 2D 1.015 (Durotar), 1.052 (Barrens) in total (§9.5) |

---

## 18. Edits this design needs elsewhere (for their owners)

- **ARCHITECTURE §9.1:** the `TravelModel` signature (endpoints with hints, speeds, `revision`)
  and the leg table; fallback rules (§9.3), including the same-map `TravelGraph` transport rule
  and `teleport` connectors (D-034 items 1 and 2).
- **ARCHITECTURE §4 layout:** `tools/casc/` (shared reader) and `tools/terrain/` in the tree.
- **ARCHITECTURE §4:**
  - `nav` may import `domain` and `geo`;
  - `nav/worker` may import `nav`;
  - `infra` and `app` may import `nav`;
  - `engine`, `sim` and `optimizer/core` get only a `TravelModel` or matrices (`import type`).
- **ARCHITECTURE §11.3:** the matrix comes from the leg table in tenth-yards; §14: the budgets
  in §14.3 (`nav`, `terrain`, `art`, the realistic-section ceiling); §16: the `nav` rules and the
  one image allowlist for `maps/art/` and `maps/terrain/` (§13.3); §17: G14.
- **SIMULATION TIME-2:** the straight-line spawn choice stays, legs come from the `TravelModel`,
  and the warnings are `SIM-no-walking-path`, `SIM-off-navmesh`, `SIM-unverified-passage`,
  `ambiguous-floor` and `long-swim`.
- **tools/build/dist-requirements.json:** the `nav`, `terrain` and `art` sections.
- **MAPS §5:** the shared reader, `readDb2` and the generated layouts, and 3b.8 writing the
  committed `public/maps/art/` (§13.4); §7: the terrain layers under the art.
- **STATUS:** "Exact next tasks" with 3b.1 and 3b.2 done, and the owner's in-game checks of the
  unverified passages (D-034 item 5); link this file from it and from ARCHITECTURE §9.1 (TN-18).
- **THIRD_PARTY_NOTICES:** "Format definitions" (WoWDBDefs, added with 3b.1); later "Derived
  navigation data", "Derived terrain map data", "Map art" and the recast-navigation build tool
  (§14.1).
- **README and the About dialog:** Blizzard Entertainment as the owner of the map artwork, and
  non-affiliation (D-033).

---

## 19. Experiments (`<m3b>`, gitignored)

Ported into the repository so far (our own research code, with tests; nothing third-party):

| Prototype | Repository |
|---|---|
| `<exp>/lib/casc.ts` | `tools/casc/{paths,buildinfo,config,idx,blte,encoding,root,casc}.ts` |
| `<m3b>/lib/db2b.ts`, `<m3b>/lib/tables.ts` | `tools/casc/{wdc5,dbd,layout-source,layouts,db2}.ts`; `tools/terrain/lib/zones.ts` (areas, WMOAreaTable) |
| `<exp>/lib/chunks.ts`, `<exp>/lib/adt.ts`, `<exp>/lib/models.ts` | `tools/terrain/lib/formats/*.ts` |
| `<m3b>/lib/geom3.ts` | `tools/terrain/lib/geometry.ts` (plus the WMO liquid rule, §3.1) |
| `<m3b>/lib/zones3.ts` | `tools/terrain/lib/zones.ts` |

| File | Purpose |
|---|---|
| `lib/env.ts` | `WOW_INSTALL`, pin check, output folder |
| `lib/tables.ts`, `lib/db2b.ts` | AreaTable parents, LiquidType hazards, WMOAreaTable; WDC5 with the inline-ID fix |
| `lib/geom3.ts` | Block geometry: AABB clip, tags, quantisation, obj0 with the name set |
| `lib/build3.ts`, `lib/settings.ts` | Recast per tile (per-tile origin, sort, object slope option), polymesh export; the named settings |
| `lib/format3.ts` | The v3 encoder and decoder, encoding variants |
| `lib/mesh3.ts` | TS map mesh: derived adjacency, slab relinker, seam statistics, components |
| `lib/zones3.ts`, `lib/snap.ts`, `lib/spawns.ts` | Polygon zones; snapping rules; dataset spawns through `src/infra/data` and `src/geo` |
| `lib/query3.ts` | `legsFrom`, the funnel, the ground/swim split |
| `build.ts`, `link.ts`, `link2.ts`, `run.sh`, `run1.sh`, `sweep.sh`, `prune.sh` | Stage 1, stage 2 (unpruned), stage 2 (pruning, water, census), drivers |
| `queries.ts`, `cities.ts`, `hintcheck.ts`, `dtcheck.ts`, `memstats.ts` | §9.5, §8.2, G10, memory |
| `mustcheck.ts`, `symcheck.ts`, `adjcheck.ts`, `facts.ts` | G7/G8, link symmetry, G5b, figures for §3-§12 |
| `relink-all.sh` | Re-runs stage 2 and the analyses for every set with the current mesh code |
| `region.ts`, `layers.ts`, `gap.ts`, `geomprobe.ts`, `path.ts`, `dbg-pathz.ts`, `outliers.ts`, `ifdiag.ts` | Probes and local renders (`out/png/`, never committed) |
| `cmp-partition.ts` | G4 |
| `byproducts.ts` | §13 |
| `collect.ts` | Writes docs/measurements/nav-m3b.json |
| `connectors.template.json` | §11 |

Rerun, from `<m3b>` with the client at `WOW_INSTALL`:

1. `SET=c05r1+n12+e5+s60 ./run.sh 6`
2. `WRITE=1 MINCOMP=20 ./prune.sh c05r1+n12+e5+s60 1000 800`
3. `SET=… FINAL=-p1000-w800 MINCOMP=20 node --import tsx queries.ts`, then `cities.ts`,
   `hintcheck.ts` and `memstats.ts` the same way, and `dtcheck.ts`
4. `node --import tsx byproducts.ts`
5. `node --import tsx collect.ts`

Ablation switches: `BLOCK=8`, `UNSORTED=1`, `ORIGIN_MODE=block`, `FIXED_ORIGIN=1`.

The output folders `c1r1b8`, `c1r1fo`, `c1r1fo2`, `c1r1fob8`, `c1r1s` and `c1r1sb8` predate the
per-tile origin field. The current decoder cannot read them, and nav-m3b.json cites none of
them.

## 20. Sources

- wowdev.wiki: ADT/v18, WDT, WMO (MOHD, MOGP, MOPY/MPY2, MLIQ, GFID), M2 collision, CASC/TACT,
  DB2 (WDC5 relationship map).
- WoWDBDefs `cf84e010f84ba9c8d48fd61730f92bf0d8f2b1cd`: `WMOAreaTable.dbd` (1.60.1.x layout),
  plus the first design's `Map`, `AreaTable`, `LiquidType`, `GameObjects` and
  `TransportAnimation`.
- recast-navigation-js 0.43.1 (MIT); Recast and Detour by Mikko Mononen (zlib):
  `rcBuildPolyMesh` adjacency and portal rules, `dtNavMesh::findConnectingPolys`,
  `overlapSlabs` and `findStraightPath` (algorithms reimplemented).
- TrinityCore `85d3c25180a89f889294d54d855efccae0945f20` (GPL-2.0-or-later): collision and skip
  rules, and Recast settings (read for rules only).
- WoWDBDefs licence: `LICENSE.md` (blob `a9b117ce`, the same at `cf84e010` and on master,
  checked 2026-09-26): `definitions/` is CC BY-SA 4.0, the code BSD-3-Clause.
- wowdev.wiki WMO "MOGP groupLiquid" and the matching TrinityCore `WMOGroup::GetLiquidTypeId`
  (read for the rule only): the WMO liquid-type resolution of §3.1.
- The critique: `.cache/m3-review.txt`, "CRITIC terrain-design", TN-01 to TN-18; the re-critique:
  `.cache/m3b-recritique.txt`, RC-01 to RC-13.
- This repository: D-028 to D-034; ARCHITECTURE §4, §7.3, §9.1, §11, §14, §16; SIMULATION TIME-2;
  MAPS §5 and §7; [coordinates.md](coordinates.md) §2; `tools/casc/README.md`,
  `tools/terrain/README.md`.
