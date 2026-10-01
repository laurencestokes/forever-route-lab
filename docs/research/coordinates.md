# Coordinate systems for WoW Forever (research)

Milestone 0 research, written 2026-09-25 by the map research agent and revised the same day for
ARCHITECTURE revision 2; section 15 was rewritten in Milestone 2 to describe `src/geo` as built.
It holds the detailed derivations behind [docs/MAPS.md](../MAPS.md):

- axis conventions and the `UiMapAssignment` transform;
- continent and world maps;
- the QuestieDB `conversion.json` encoding;
- worked numeric examples and cross-checks against independent data;
- the rendering maths for Leaflet.

**Authority.** [ARCHITECTURE.md](../ARCHITECTURE.md) §6-§7, [DECISIONS.md](../DECISIONS.md)
and the domain types in `src/domain/*.ts` (`points.ts` for coordinates) win over this file:
D-017 for coordinates, D-018 for map files, D-019 for RXP material, D-022 for client values and
D-026 for per-row geometry builds. Design recommendations that revision 2 or the architect's
later rulings replaced are kept and marked **Superseded** with what replaced them. The
measurements are unchanged.

Every number below was computed from the pinned inputs in section 1. The scratch scripts are in
`.cache/experiments/maps/` (gitignored): `csv.js`, `worked.js` and `steps.js` (section 16). Since
Milestone 2 the worked examples of sections 7-9 are pinned by the `src/geo` and `tools/maps`
tests (section 15). Nothing here was checked in a live client. Where a fact comes from Classic Era rather than Forever, the
text says so.

**Citations.** Client-derived values here (`UiMap`, `UiMapAssignment`, `TaxiNodes` and similar)
are individual values cited by table, column and build, as D-022 allows. The column mapping is in
section 3. Bulk tables stay local. The 12 DB2-only `UiMapAssignment` rows in sections 6 and 12
(12 rows for 11 UiMaps; Azeroth 947 has two) are also committed: with their citations in
`tools/maps/inputs/db2-rows-1.60.1.70009.json`, and as `db2-csv` rows of
`public/maps/placeholder/geometry.placeholder.json` (D-018, D-026; full values in MAPS.md §8.3).

**RXP material.** RXPGuides was read for behaviour and counts only. No RXPGuides guide line or
coordinate value is reproduced here (D-019); `.goto` examples are self-authored.

## 0. Summary

| Topic | Result | Evidence |
|---|---|---|
| World axes | `+X` = north, `+Y` = west, `+Z` = up, in yards. A map's left edge is its **max Y** and its top edge is its **max X**. | wow.export `tab_maps.js:789-808`; Questie HBD `HereBeDragons-2.0.lua:174-196`; QuestieDB `tools/dbc/coordinates.py:13-30,47` |
| Zone percent (Questie, RXP names) | `x% = 100·(Ymax − Y)/(Ymax − Ymin)`, `y% = 100·(Xmax − X)/(Xmax − Xmin)`, using the zone's `UiMapAssignment.Region` | Same, plus worked examples (sections 7-9) |
| Continent UiMaps (Forever 1.60.1.70009) | Azeroth **947**, Kalimdor **1414** (MapID 1), Eastern Kingdoms **1415** (MapID 0). These are the same IDs and bounds as Era 1.15.9.69722. | wago.tools CSV `UiMap`/`UiMapAssignment` at both builds (section 6) |
| Changed zone frames in Forever | Mulgore 1412 (spans ×1.198, scale coefficient 0.8348), Eastern Plaguelands 1423 (×1.111), Redridge 1433 (shifted 110.4 yd east), Stormwind City 1453 (×1.292) | `conversion.json` `geometry.transforms[].changed`; section 11 |
| New Forever maps | Mount Hyjal 2482, Zephras Isle 2521 (+2665), Darkspear Islands 2524, Riverglades 2548, Shen'dralas 2652 | `UiMapAssignment` 1.60.1.70009 (section 12) |
| Geometry stability across betas | `UiMapAssignment` is byte-identical at 1.60.1.69893 and 1.60.1.70009. `UiMap` changed parent/type for 4 maps. | SHA-256 of both CSVs (section 11.3) |
| QuestieDB geometry | All 49 `target_bounds` in `conversion.json` equal the 70009 DB2 rows exactly. All 49 `source_bounds` equal Era 69722. | section 10.3 |
| Committed geometry (D-018) | `public/maps/placeholder/geometry.placeholder.json`: the 49 `conversion.json` frames (`questiedb-conversion`, build 69893) plus the 12 DB2-only rows (`db2-csv`, build 70009), generated from the pinned `conversion.json` and the committed `tools/maps/inputs/db2-rows-1.60.1.70009.json`. Local sets are accepted by frame hash, not build string, and may only add UiMaps. | ARCHITECTURE §6; MAPS.md §5.6, §8 |
| RXP Forever guides | Most `.goto` lines use `<UiMapID>/<MapID>,<worldY>,<worldX>`, which is HereBeDragons world order. That is frame-invariant. The `<UiMapID>` prefix is kept as the world `SourcedPoint`'s `uiMapId` hint. | rxpguides `functions.lua:1875-1896`; section 13.4 |
| Storage (D-017) | Dataset spawns keep QuestieDB's zone percent and are converted at load. Route locations keep the authored point (`SourcedPoint`) and are resolved at runtime. | section 15 |

## 1. Pinned inputs

| Input | Identity | Where |
|---|---|---|
| Local Forever beta client | product `wow_classic_beta`, **1.60.1.70009**, Build Key `05215079e3905ef5922ae0b03ffefb73`, CDN Key `9b3c456dbb837d133a026d380c7c13e9` when this research was done; since 2026-09-30 **1.60.1.70124**, Build Key `dd3dfc2881c407299f46c2aaf34c130b`, the tools' pin (D-050). `UiMap`, `UiMapAssignment`, `TaxiNodes` and every other table cited here that the tools read have the same CKey at both, so the values below hold at 70124 ([reviews/repin-70124.md](../reviews/repin-70124.md)) | `<wow-install>/.build.info` (the WoW installation root; read only, 2026-09-25 and 2026-09-30) |
| Blizzard patch server | `wow_classic_beta` us/eu/kr/tw = 1.60.1.70009, same BuildConfig | `https://us.version.battle.net/wow_classic_beta/versions`, fetched 2026-09-25 |
| DB2 CSV exports (research only) | `UiMap`, `UiMapAssignment`, `UiMapArt`, `UiMapArtTile`, `UiMapXMapArt`, `UiMapArtStyleLayer`, `WorldMapOverlay`, `WorldMapOverlayTile`, `AreaTable`, `Map`, `TaxiNodes`, `TaxiPath` at 1.60.1.70009; `UiMap` and `UiMapAssignment` at 1.60.1.69893; `UiMapAssignment` at 1.15.9.69722 | wago.tools per-table CSV endpoint (`/db2/<Table>/csv?build=<build>`), fetched as individual requests during research (not scripted crawling), saved to `.cache/experiments/maps/`. Full inventory with sizes, row counts and SHA-256: MAPS.md §8.3. |
| CSV hashes (SHA-256) | `UiMapAssignment` 1.60.1.69893 = 1.60.1.70009 = `79267e8be8034e47daab14350411b3acc0b1f64e86efc9d821a217497254ca0a`. `UiMap` 70009 = `1f4aac70eaac015b1d2d0ea0faf6e3d7fb2cf7afdf45e5bb6772d9b80a72346b`. `TaxiNodes` 70009 = `e3d4833dcb395214c0366d241fdaa4b7d7e2330133bb6db03ed5bfd01f974bea`. | `sha256sum .cache/experiments/maps/*.csv`, re-run 2026-09-25 |
| QuestieDB `conversion.json` | SHA-256 of the LF git blob `f4477d6c575575152225f2a9d40858029bf9d2d5fdf6b083c06557fce8b5984b` (a CRLF worktree copy hashes differently) | `git show b6f5b07:data/Forever/conversion.json \| sha256sum` |
| DB2 schemas | WoWDBDefs `cf84e010f84ba9c8d48fd61730f92bf0d8f2b1cd`. Layouts include builds 1.60.1.69876, 69893, 69913, 69977 and 70009. | `definitions/UiMapAssignment.dbd:150-167` and the other `.dbd` files |
| QuestieDB | `b6f5b07b0acf1c820993cbb0ce2521c912bb4c92` (2026-09-23) | `.cache/questiedb` |
| Questie (HereBeDragons copy) | `40016145f8181f3f92049146ee655bd03d604a0a` (2026-09-24) | `.cache/questie/Libs/HereBeDragons/HereBeDragons-2.0.lua` |
| RXP guides | `c3429e065c06271827e9e412306fb1cede5ae852` (2026-09-25) | `.cache/rxpguides` |
| wow.export | tag `0.2.19`, commit `c2fd7bde36a712be78a5da896c995b84fbfa2545` | `.cache/wow.export` |
| Leaflet | 1.9.4 (npm `latest`; declares BSD-2-Clause) | `https://raw.githubusercontent.com/Leaflet/Leaflet/v1.9.4/src/geo/crs/CRS.Simple.js` |

**wago.tools caveat.** `https://wago.tools/robots.txt` contains `User-agent: *`, `Allow: /$` and
`Disallow: /`. About 18 CSVs were fetched for this research, as individual requests (not scripted
crawling). Do not build automated tooling on wago.tools; use it only for individual manual
cross-checks (D-011; MAPS.md §4). The placeholder no longer needs it: its 12 DB2 rows are
committed in `tools/maps/inputs/db2-rows-1.60.1.70009.json` (MAPS.md §8.3). The service does not
echo the served build inside a CSV. The 69893 and 70009 `UiMap` files differ, so those two requests were served from
different builds, but exact build identity is not independently verified.

## 2. World coordinates

WoW world positions are `(X, Y, Z)` in yards, per world map (`Map.ID`, called MapID, instance ID or
continent ID). For MapID 0 (Eastern Kingdoms, directory `Azeroth`) and MapID 1 (Kalimdor):

- `+X` points **north**, `+Y` points **west** and `+Z` points up. East is `−Y`.
- On every 2D map the horizontal axis runs toward decreasing `Y` (eastward). The vertical axis runs
  downward toward decreasing `X` (southward).

Three independent open-source codebases agree:

| Source | What it states |
|---|---|
| wow.export `src/js/modules/tab_maps.js:789-808` (0.2.19) | The PNG map-export sidecar comment says world_x is north and world_y is west, in yards. The image horizontal axis follows tile Y and the vertical axis follows tile X. Its corners are `world_x = (32 − min_y)·TILE_SIZE` and `world_y = (32 − min_x)·TILE_SIZE`. |
| Questie `Libs/HereBeDragons/HereBeDragons-2.0.lua:174-196` | `C_Map.GetWorldPosFromMapPos(id, (0.5,0.5))` returns a vector whose `GetXY()` is unpacked as `top, left`. The first component (world X) is the map's north/south axis. The second (world Y) is east/west. |
| QuestieDB `tools/dbc/coordinates.py:13-30` | `Bounds` docstring: horizontal follows world axis 2 (Y) and vertical follows world axis 1 (X). `width = left − right` and `height = top − bottom`. |

### 2.1 ADT and minimap grid

World maps are divided into 64 × 64 ADT tiles, each `TILE_SIZE = (51200/3)/32 = 533.333…` yards
(`MAP_COORD_BASE = 51200/3 = 17066.67`, wow.export `src/js/constants.js:70-76`). The grid is centred
on world (0,0). Minimap tiles are `world/minimaps/<Map.Directory>/mapXX_YY.blp`
(`tab_maps.js:59`). Following the wow.export corner formula:

```
XX (first index)  = floor(32 − Y / 533.333…)    // column, west→east
YY (second index) = floor(32 − X / 533.333…)    // row, north→south
```

This grid is only relevant if minimap (terrain) tiles are ever used. The route planner uses UI map
art instead (MAPS.md section 3).

## 3. `UiMapAssignment`: the map-to-world link

Each row places a rectangle of world space (`Region`) onto a rectangle of a UI map (`UiMin`/`UiMax`,
normalised 0..1). Columns at 1.60.1.70009, as named by the wago.tools CSV and WoWDBDefs layout
`C9CC8DFB` (`UiMapAssignment.dbd:150-167`):

| Column | Meaning | Forever values |
|---|---|---|
| `ID` | Assignment ID | 46721… (Era IDs kept); new maps use 69032-69852 |
| `UiMapID` | Map this row belongs to | 947 … 2665 |
| `OrderIndex` | Priority when a map has several rows | 0 everywhere except Azeroth 947 (0 = Kalimdor, 1 = Eastern Kingdoms) |
| `MapID` | World map (continent or instance) of the region | 0, 1, 30, 489, 529, 2991, 2997 |
| `AreaID` | `AreaTable` zone. 0 for continents and world maps. | |
| `UiMin_0`, `UiMin_1` | Top-left corner of the UI sub-rectangle (u, v), 0..1 | (0,0) except 947 |
| `UiMax_0`, `UiMax_1` | Bottom-right corner (u, v) | (1,1) except 947 |
| `Region_0`, `Region_1`, `Region_2` | World **min** X, Y, Z | Z = −1,000,000 (unrestricted) |
| `Region_3`, `Region_4`, `Region_5` | World **max** X, Y, Z | Z = +1,000,000 |
| `WMODoodadPlacementID`, `WMOGroupID` | Restrict the row to one WMO interior | 0 everywhere |
| `Field_11_2_5_62687_010` | Unnamed field | 0 everywhere |

QuestieDB's naming (`coordinates.py:47`,
`bounds = cls(row["Region_4"], row["Region_1"], row["Region_3"], row["Region_0"])`):

| QuestieDB `Bounds` | DB2 column | Meaning |
|---|---|---|
| `left` | `Region_4` = Ymax | West edge |
| `right` | `Region_1` = Ymin | East edge |
| `top` | `Region_3` = Xmax | North edge |
| `bottom` | `Region_0` = Xmin | South edge |

QuestieDB only derives transforms from rows with `OrderIndex = 0`, `AreaID > 0`, no WMO restriction,
a full `(0,0)-(1,1)` UI rectangle and unrestricted Z (`coordinates.py:34-52`). That is why the
continents are "unsupported" in `conversion.json`: they have no AreaID.

## 4. Map percent ⇄ world

Let `a` be the assignment row. Let `u, v` be normalised map coordinates in 0..1 (Blizzard
`C_Map` convention) and `x% = 100u`, `y% = 100v` (Questie and RXP zone-name convention).

**World → map** (valid only if the point's MapID equals `a.MapID`):

```
fu = (a.Region_4 − Y) / (a.Region_4 − a.Region_1)      // 0 at west edge, 1 at east edge
fv = (a.Region_3 − X) / (a.Region_3 − a.Region_0)      // 0 at north edge, 1 at south edge
u  = a.UiMin_0 + fu · (a.UiMax_0 − a.UiMin_0)
v  = a.UiMin_1 + fv · (a.UiMax_1 − a.UiMin_1)
```

**Map → world:**

```
fu = (u − a.UiMin_0) / (a.UiMax_0 − a.UiMin_0)
fv = (v − a.UiMin_1) / (a.UiMax_1 − a.UiMin_1)
Y  = a.Region_4 − fu · (a.Region_4 − a.Region_1)
X  = a.Region_3 − fv · (a.Region_3 − a.Region_0)
```

For every zone map (`UiMin = 0,0` and `UiMax = 1,1`) this reduces to:

```
x% = 100 · (Ymax − Y) / (Ymax − Ymin)        Y = Ymax − (x%/100) · (Ymax − Ymin)
y% = 100 · (Xmax − X) / (Xmax − Xmin)        X = Xmax − (y%/100) · (Xmax − Xmin)
```

Notes:

- A point on a multi-row map (Azeroth 947) needs the row whose MapID matches. The inverse needs the
  row whose UI sub-rectangle contains `(u, v)`. A point outside every sub-rectangle (ocean) has no
  world position.
- The `UiMin`/`UiMax` reading is the standard interpretation. It matches the data: Kalimdor sits on
  the left of the Azeroth map and Eastern Kingdoms on the right. It was **not** checked in a live
  client. It does reproduce Questie's own Classic world-map calibration. HereBeDragons stores the
  Azeroth map per continent as `{width, height, left, top}` in world yards (the legacy Classic
  constants it keeps for when the API gives no rectangle, `HereBeDragons-2.0.lua:274-275` at
  Questie `40016145`). Deriving the same four numbers from each 947 row
  (`width = (Ymax − Ymin)/(UiMax_0 − UiMin_0)`, `left = Ymax + width·UiMin_0`,
  `height = (Xmax − Xmin)/(UiMax_1 − UiMin_1)`, `top = Xmax + height·UiMin_1`) gives every
  constant to within 0.008 yd (HBD prints two decimals); points anywhere on the map agree to
  within 0.009 yd (measured 2026-09-25).
- Since Milestone 2 this reading places one shipped spawn. QuestieDB publishes object 180652 on
  the synthetic AreaID 10089 (→ 947, §6) at `29.99, 89.15`. That lies in the Kalimdor
  sub-rectangle and resolves to world `(−11845.68, −4735.15)` on MapID 1, 112 yd south of the
  Kalimdor frame and outside every zone frame; HBD's constants put it 0.004 yd away. The other
  five synthetic-alias points (NPCs 9026, 9046, 16033 on 10074 → 1415; NPC 15215 and object
  180453 on 10073 → 1414) are read in the continent frames. Resolving all six is frame-safe:
  rows 1414 and 1415 are identical at Era 69722 and Forever 70009, and the 947 rows differ only
  in assignment 46784's OrderIndex (§6), so no frame changed under them. That is not a claim that
  QuestieDB placed them accurately; QuestieDB itself leaves them unresolved.
- Percent values outside 0..100 are legal. They mean "outside this map's frame" (section 7.4).
  QuestieDB never clamps (`tools/dbc/README.md`, "What conversion preserves").

### 4.1 Maps are isotropic

For all 58 assignment rows whose map has 1002 × 668 art (including both Azeroth sub-rectangles,
scaled by their `UiMin`/`UiMax`), `(Ymax − Ymin)/(Xmax − Xmin) = 1.5 = 1002/668` to within 0.2%
(checked in `.cache/experiments/maps`, and on the committed placeholder by `tools/maps/validate.ts`
check P7). So one yard is the same number of pixels in both axes, and a
zone image can be placed on a continent (or a world-yard surface) as an axis-aligned rectangle with
no distortion.

The three maps with 512 × 512 art behave differently:

- UiMaps 1463 and 1464 also have square regions (21,797 × 21,797 yd for 1463), so they are
  isotropic.
- UiMap 2665 (second Zephras Isle) has a 1.5-aspect region on square art, so it is **not**
  isotropic. Do not use it as a base map.

### 4.2 Percent is not a distance

One percent is a different number of yards on every map. Distances, travel times and "nearest"
queries must use world yards.

| Map | Yards per 1% x | Yards per 1% y | Yards per art pixel |
|---|---:|---:|---:|
| Durotar 1411 | 52.875 | 35.250 | 5.277 |
| Mulgore 1412 (Forever) | 61.542 | 41.021 | 6.142 |
| Stormwind City 1453 (Forever) | 17.375 | 11.583 | 1.734 |
| Orgrimmar 1454 | 14.026 | 9.354 | 1.400 |
| Kalimdor 1414 | 367.998 | 245.332 | 36.726 |
| Eastern Kingdoms 1415 | 351.999 | 234.666 | 35.130 |

QuestieDB stores two decimals. That is about ±0.26 yd on Durotar and ±1.8 yd on the Kalimdor map.

## 5. Zone → continent → Azeroth

Because every zone frame on MapID 0 or 1 is linear in the same world axes, **zone percent →
continent percent is a pure per-axis affine map**. Go through world, or use the direct form:

```
cx% = sx · x% + ox        sx = (Z.Ymax − Z.Ymin)/(C.Ymax − C.Ymin)      ox = 100 · (C.Ymax − Z.Ymax)/(C.Ymax − C.Ymin)
cy% = sy · y% + oy        sy = (Z.Xmax − Z.Xmin)/(C.Xmax − C.Xmin)      oy = 100 · (C.Xmax − Z.Xmax)/(C.Xmax − C.Xmin)
```

`Z` is the zone row and `C` the continent row (1414 for MapID 1, 1415 for MapID 0). Then continent
→ Azeroth 947 uses the 947 row with the same MapID and its `UiMin`/`UiMax` (section 4).

A zone's rectangle on its continent (useful for placeholders and for composing a continent view):

```
left%   = 100 · (C.Ymax − Z.Ymax)/(C.Ymax − C.Ymin)
right%  = 100 · (C.Ymax − Z.Ymin)/(C.Ymax − C.Ymin)
top%    = 100 · (C.Xmax − Z.Xmax)/(C.Xmax − C.Xmin)
bottom% = 100 · (C.Xmax − Z.Xmin)/(C.Xmax − C.Xmin)
```

| Zone (UiMap) | Continent | left, top, right, bottom (%) |
|---|---|---|
| Durotar 1411 | Kalimdor | 51.71, 44.80, 66.08, 59.17 |
| Mulgore 1412 (Forever frame) | Kalimdor | 39.64, 51.09, 56.36, 67.81 |
| Orgrimmar 1454 | Kalimdor | 56.38, 42.91, 60.19, 46.72 |
| Thunder Bluff 1456 | Kalimdor | 44.97, 55.64, 47.81, 58.47 |
| Mount Hyjal 2482 (new) | Kalimdor | 48.88, 26.48, 58.32, 35.91 |
| Shen'dralas 2652 (new) | Kalimdor | 40.87, 59.92, 46.44, 65.49 |
| Stormwind City 1453 (Forever) | Eastern Kingdoms | 40.56, 65.89, 45.50, 70.83 |
| Eastern Plaguelands 1423 (Forever) | Eastern Kingdoms | 51.86, 16.09, 64.09, 28.30 |
| Redridge Mountains 1433 (Forever) | Eastern Kingdoms | 50.23, 68.36, 56.40, 74.53 |
| Riverglades 2548 (new) | Eastern Kingdoms | 50.83, 59.37, 64.61, 73.15 |

**Zone rectangles overlap.** They are map frames with margins, not zone borders. For example, the
Durotar and The Barrens frames overlap over X −1716…1612 and Y −7250…−1962. Cities sit inside their
parent zone's frame. The zone a point "belongs to" comes from `AreaTable` and terrain, not from the
rectangles. Keep the source map ID of every point; never infer it from rectangle containment.

## 6. Continent and world UiMaps in Forever

From `UiMap` and `UiMapAssignment` at 1.60.1.70009. Kalimdor and Eastern Kingdoms rows are identical
at Era 1.15.9.69722.

| UiMap | Name | `UiMap.Type` | Parent | Assignment | MapID | UiMin → UiMax | Xmin, Xmax | Ymin, Ymax |
|---:|---|---:|---:|---:|---:|---|---|---|
| 947 | Azeroth | 1 (world) | 0 | 46785, order 0 | 1 | (0.0399, 0.0855) → (0.4083, 0.9234) | −12800, 12266.700195312 | −9600, 6933.2998046875 |
| 947 | Azeroth | 1 | 0 | 46784, order 1 | 0 | (0.5505, 0.0994) → (0.8966, 0.8691) | −16000, 6933.2998046875 | −7466.7001953125, 8000 |
| 1414 | Kalimdor | 2 (continent) | 947 | 46724 | 1 | (0,0) → (1,1) | −11733.299804688, 12799.900390625 | −19733.2109375, 17066.599609375 |
| 1415 | Eastern Kingdoms | 2 | 947 | 46725 | 0 | (0,0) → (1,1) | −16000, 7466.6000976562 | −19199.900390625, 16000 |
| 1463 | Eastern Kingdoms | 2 | 0 | 46774 | 0 | (0,0) → (1,1) | −15980, 5817 | −11880, 9917 |
| 1464 | Kalimdor | 2 | 0 | 46775 | 1 | (0,0) → (1,1) | −11870, 12470 | −13370, 10970 |

- Columns: `UiMap.Type` and `UiMap.ParentUiMapID`; `UiMapAssignment.ID`, `OrderIndex`,
  `MapID`, `UiMin_0/1`, `UiMax_0/1` and `Region_0/1/3/4` (section 3). The UI rectangle values
  are rounded here; MAPS.md §8.3 gives them at full precision. All six rows are committed as
  `db2-csv` rows of the placeholder geometry (D-018).
- UiMap IDs 947, 1414 and 1415 are **verified for Forever 1.60.1.70009**. QuestieDB models them
  with synthetic AreaIDs `10089 ↔ 947`, `10073 ↔ 1414` and `10074 ↔ 1415`
  (`support/Forever/Zones/areaIdToUiMapId.lua:15-17`).
- 1463 and 1464 are alternative continent maps with a parent of 0 and a single 512 × 512 art tile.
  Their in-game purpose is **UNKNOWN**. QuestieDB lists them as unresolved (`docs/forever-data.md`).
- Between Era 69722 and Forever 70009, assignment 46784 (Azeroth/Eastern Kingdoms) changed
  `OrderIndex` from 0 to 1. Nothing else about the continents changed.
- `UiMapLink` returned `{"errors":"Table not found."}` from wago.tools at 70009, although WoWDBDefs
  lists 1.60.1.x builds for it (`UiMapLink.dbd:207`). *Answered since (map-atlas.md §3.1, read from
  the client through `tools/casc` and re-derived by that design's review):* the client's
  `UiMapLink` (FileDataID 2030690) has **0 records** at 1.60.1.70009.

## 7. Worked example 1: Gornek in Durotar (unchanged zone)

Input: QuestieDB `data/Forever/foreverNpcDB.lua:2604`, NPC 3143 Gornek, spawns `{[14]={{42.06,68.33}}}`.
AreaID 14 (Durotar) maps to UiMap 1411 (`support/Forever/Zones/areaIdToUiMapId.lua`). Durotar is not
one of the four changed frames, so Era and Forever percentages are equal.

Durotar row 46721 (MapID 1): `Xmin = −1716.6666259766`, `Xmax = 1808.3332519531`,
`Ymin = −7249.9995117188`, `Ymax = −1962.4998779297`.

### 7.1 Zone percent → world

```
W = Ymax − Ymin = 5287.4996337891        H = Xmax − Xmin = 3524.9998779297
Y = −1962.4998779297 − 0.4206 · 5287.4996337891 = −4186.4222239014
X =  1808.3332519531 − 0.6833 · 3524.9998779297 =  −600.2991646363
```

Gornek stands at world `(X, Y) = (−600.30, −4186.42)` on MapID 1. The round trip gives back
`42.06, 68.33` to 1e-12.

### 7.2 World → Kalimdor 1414 percent

```
Kalimdor: W = 17066.599609375 − (−19733.2109375) = 36799.810546875
          H = 12799.900390625 − (−11733.299804688) = 24533.200195313
cx% = 100 · (17066.599609375 − (−4186.4222239)) / 36799.810546875 = 57.7531
cy% = 100 · (12799.900390625 − (−600.2991646)) / 24533.200195313 = 54.6207
```

The direct affine form gives the same result: `cx% = 0.14368279·x% + 51.70977569` and
`cy% = 0.14368284·y% + 44.80282658`.

### 7.3 World → Azeroth 947 percent

Use the 947 row with MapID 1 (assignment 46785): region `Y ∈ [−9600, 6933.2998]`,
`X ∈ [−12800, 12266.7002]`, UI rectangle `(0.0399, 0.0855)-(0.4083, 0.9234)`.

```
fu = (6933.2998046875 − (−4186.4222239)) / 16533.2998046875 = 0.6725652
fv = (12266.700195312 − (−600.2991646))  / 25066.700195312 = 0.5133105
u  = 0.0399 + 0.6725652 · (0.4083 − 0.0399) = 0.2876730   → 28.7673 %
v  = 0.0855 + 0.5133105 · (0.9234 − 0.0855) = 0.5156028   → 51.5603 %
```

### 7.4 Art pixels and out-of-frame points

- On the 1002 × 668 Durotar art: `(0.4206 · 1002, 0.6833 · 668) = (421.4, 456.4)` px from the top-left.
- The same world point on the Orgrimmar 1454 frame is `x% = 36.06`, `y% = 307.26`. That is valid
  maths, but the point is far outside that map. Renderers should clip it or draw an off-map marker.

## 8. Worked example 2: Chief Hawkwind in Mulgore (changed zone)

Mulgore's frame changed in Forever, so the same NPC has different percentages in Era and Forever.

| Frame | Mulgore 1412 bounds (left=Ymax, right=Ymin, top=Xmax, bottom=Xmin) | Source |
|---|---|---|
| Era 1.15.9.69722 | 2047.9166259766, −3089.5832519531, −272.91665649414, −3697.9165039062 | `conversion.json` `transforms[ui_map_id=1412].source_bounds`; wago 69722 |
| Forever 1.60.1.69893 = 70009 | 2479.1669921875, −3675, 266.666015625, −3835.416015625 | `target_bounds`; wago 70009 |

1. Era point: `44.18, 76.06`, from the QuestieDB docs (`tools/dbc/README.md`, "Inspect a
   coordinate"). An RXP Classic Mulgore guide uses a point 0.01 away; the value is not
   reproduced here (D-019).
2. Era frame → world: `Y = 2047.9166 − 0.4418·5137.5 = −221.8308`,
   `X = −272.9167 − 0.7606·3425.0 = −2877.9715`.
3. World → Forever frame: `x% = 100·(2479.1670 + 221.8308)/6154.1670 = 43.888926` and
   `y% = 100·(266.6660 + 2877.9715)/4102.0820 = 76.659548`.
4. The coefficients give the same answer: `0.8348002068·44.18 + 7.0074531087 = 43.888926` and
   `0.8349418225·76.06 + 13.1538732772 = 76.659548`.
5. QuestieDB Forever data stores **`43.89, 76.66`** (`foreverNpcDB.lua:2448`, NPC 2981). World from
   the stored value: `(X, Y) = (−2877.99, −221.90)`, which is Kalimdor `46.98, 63.90`.
6. RXP's Forever Mulgore guide (`Guides/Forever/Horde-1-12_Mulgore.lua:30` at `c3429e06`) has a
   world-form `.goto` on MapID 1 for this step. It lies within 0.4 yd of QuestieDB's world point
   (measured 2026-09-25). The value itself is not reproduced here (D-019).

The assumption that the NPC did not move is QuestieDB's, not a proof (`conversion.json`
`assumption`). The RXP point was presumably recorded independently in the Forever client, and its
agreement is supporting evidence. The committed test for this example (ARCHITECTURE §6) uses only
the QuestieDB and `conversion.json` values in steps 1-5.

## 9. Independent cross-check: flight masters vs `TaxiNodes`

`TaxiNodes.Pos_0/Pos_1` (build 1.60.1.70009) are world X and Y. QuestieDB flight-master spawns are
zone percentages. Projecting each node onto its city map with the Forever bounds, and each flight
master to world:

| TaxiNode (70009) | World X, Y | Node on city map | QuestieDB flight master | Distance |
|---|---|---|---|---:|
| 2 Stormwind, Elwynn | −8832.77, 478.62 | 1453: 71.61, 72.25 | 352 Dungar Longdrink 70.95, 72.51 | 11.9 yd |
| 23 Orgrimmar, Durotar | 1677.59, −4315.71 | 1454: 45.28, 63.75 | 3310 Doras 45.12, 63.89 | 2.6 yd |
| 22 Thunder Bluff, Mulgore | −1197.21, 29.71 | 1456: 46.65, 49.90 | 2995 Tal 47.00, 49.83 | 3.6 yd |
| 5 Lakeshire, Redridge | −9429.10, −2231.40 | 1433: 25.34, 58.99 | 931 Ariena Stormfeather 25.50, 59.41 | 7.0 yd |
| 67 Light's Hope Chapel, Eastern Plaguelands | 2271.09, −5340.80 | 1423: 71.70, 49.56 | 12617 Khaelyn Steelwing 71.81, 49.60 | 4.9 yd |
| 68 Light's Hope Chapel, Eastern Plaguelands | 2327.41, −5286.89 | 1423: 70.45, 47.59 | 12636 Georgia 70.53, 47.55 | 3.8 yd |

Stormwind 1453, Redridge 1433 and Eastern Plaguelands 1423 are changed frames (§11.1). Reading
each flight master's Forever percent with the **Era** bounds of its zone (`conversion.json`
`source_bounds`) instead gives:

| TaxiNode | Flight master | Forever frame | Era frame |
|---|---|---:|---:|
| 2 Stormwind | 352 Dungar Longdrink | 11.9 yd | **108.9 yd** |
| 5 Lakeshire | 931 Ariena Stormfeather | 7.0 yd | **107.2 yd** |
| 67 Light's Hope Chapel | 12617 Khaelyn Steelwing | 4.9 yd | **450.5 yd** |
| 68 Light's Hope Chapel | 12636 Georgia | 3.8 yd | **445.0 yd** |

This confirms three things:

- The axis convention and formulas.
- QuestieDB Forever data is in the Forever frame on three of the four changed maps (Mulgore
  has no flight master of its own; Thunder Bluff is UiMap 1456, unchanged; §8 is its check).
- Mixing frames produces errors of 100 yards or more.

This check is a good automated validator (MAPS.md §5.5, local-set check L6). The six TaxiNodes
rows are individual cited client values (`TaxiNodes.ID`, `ContinentID`, `Pos_0`, `Pos_1` at
1.60.1.70009; the flight masters are `foreverNpcDB.lua` lines 222, 661, 2462, 2761, 8078 and
8079 at `b6f5b07b`). By D-022 they may be pinned as constants in `src/geo` tests, and
ARCHITECTURE §6 requires it (`TAXI_LANDMARKS` in `src/geo/test-fixtures.ts` and
`tools/maps/lib/local-set.ts`). One more row is cited for the zone-attribution test (§15):
TaxiNodes 25, Crossroads, The Barrens, `(−441.80, −2596.08)` on MapID 1, which lies in the
Durotar, Mulgore and The Barrens frames. The full `TaxiNodes`, `TaxiPath` and `TaxiPathNode`
tables stay local, and taxi-derived leg timings are local-only by default (D-022, STATUS OD-6).

## 10. QuestieDB `data/Forever/conversion.json`

### 10.1 Shape

| Path | Content |
|---|---|
| `tool`, `format` | `"QuestieDB convert-forever"`, `1` |
| `geometry.source_build`, `geometry.target_build` | `1.15.9.69722`, `1.60.1.69893` (lines 1453-1454) |
| `geometry.source_tables` / `target_tables` | Per table (`ui_map_assignment`, `ui_map`): `coverage` (`untracked` for Era, `ok` for Forever), `rows` (55/54 Era, 61/60 Forever), `snapshot_sha256` |
| `geometry.transforms[]` | 49 entries: `ui_map_id`, `source_name`, `target_name`, `area_id`, `map_id`, `source_assignment_id`, `target_assignment_id`, `changed`, `coefficients{scale_x, offset_x, scale_y, offset_y}`, `source_bounds{left,right,top,bottom}`, `target_bounds{…}` |
| `geometry.unsupported[]` | 947 (multiple assignments), 1414, 1415, 1463, 1464 (no explicit zone/world identity) |
| `geometry.added_maps[]` | 2482, 2521, 2524, 2548, 2652, 2665 (no Era counterpart, so **no bounds recorded**) |
| `geometry.removed_maps[]` | empty |
| `geometry.summary` | 55 source / 61 target assignments, 4 changed, 45 unchanged, 5 unsupported, 6 added, 0 removed |
| `geometry.area_coefficients` | AreaID → coefficients for all 49 (identity for 45) |
| `coordinate_rounding` | 2 decimals, halfway away from zero, transformed pairs only |
| `assumption` | NPC and terrain world positions are unchanged. This is a converted Era baseline, not complete Forever content. |
| `files`, `not_converted`, `validation` | Per-file hashes and counts; list of unconverted sources (Questie runtime corrections, dungeon entrances, new content, synthetic routing) |

`coordinates.py:132` also computes `area_transform_supported`, but the committed transforms do not
contain that key. The committed file therefore predates or omits it. Code should not rely on it.

### 10.2 Coefficients

From `coordinates.py:84-87`, with `W = left − right` and `H = top − bottom`:

```
scale_x  = W_era / W_forever             offset_x = 100 · (left_forever − left_era) / W_forever
scale_y  = H_era / H_forever             offset_y = 100 · (top_forever  − top_era)  / H_forever
x%_forever = scale_x · x%_era + offset_x      y%_forever = scale_y · y%_era + offset_y
```

Substituting the world formulas shows that this keeps the world position fixed (section 8, step 4).
It is **Era percent → Forever percent** for the same map. It is **not** zone → continent. QuestieDB
has already applied it to its Forever entity data, so applying it again double-converts
(`docs/api.md` "Era-to-Forever coordinates").

### 10.3 Agreement with DB2

- All 49 `target_bounds` equal the wago.tools 1.60.1.70009 `UiMapAssignment` rows bit for bit
  (`left = Region_4`, `right = Region_1`, `top = Region_3`, `bottom = Region_0`).
- All 49 `source_bounds` equal the wago.tools 1.15.9.69722 rows.
- Re-checked 2026-09-25 against the LF blob at `b6f5b07`: 0 mismatches in bounds and assignment
  IDs. Every one of the 49 CSV rows has `OrderIndex 0`, UI rectangle `(0,0)-(1,1)` and no WMO
  restriction.
- The 49 frames are committed as the `questiedb-conversion` rows of
  `public/maps/placeholder/geometry.placeholder.json`, each recording build 1.60.1.69893 (D-018).
  They stay valid until a build changes `UiMapAssignment` for them.
- Their frame hash (MAPS.md §5.6: float32-canonical tuples, JSON, SHA-256; the encoding is
  ratified in ARCHITECTURE §6) is
  `2cb10551b1502b652e4d54922e8b3a1ecb48057fbfb7cf9c77863edd7efea78f`. The 69893 and 70009 CSVs
  give the same value. The Era 69722 rows give
  `b94bf685200c28a7edc2720d995082ea32bbdcc5398ecc3c08dc33436a852cfb`, differing exactly at 1412,
  1423, 1433 and 1453.

### 10.4 What `conversion.json` cannot supply

It has no bounds for the continent frames (1414, 1415), the Azeroth sub-rectangles (947), the
alternative continents (1463, 1464) or any of the six new maps. These 12 rows for 11 UiMaps come
from `UiMapAssignment` at 1.60.1.70009. They are committed with citations in
`tools/maps/inputs/db2-rows-1.60.1.70009.json` and, through `tools/maps import --placeholder`, as
`db2-csv` rows of the placeholder geometry, by owner decision (D-018; values in MAPS.md §8.3).
A local set cannot replace them. Local geometry may only add UiMaps the committed file lacks; a
local row for one of these 11 UiMaps must be identical, otherwise the whole local set is rejected
as a frame mismatch (ARCHITECTURE §6; MAPS.md §5.6 step 4).
*Superseded by D-018:* revision 1 said these rows could only come from a developer's local
extraction and would not be committed. *Superseded by ARCHITECTURE §6:* this section's first
revision-2 wording proposed that a frame-compatible local set could replace them on the
developer's machine.

## 11. Forever geometry changes (Era 1.15.9.69722 → Forever 1.60.1.70009)

### 11.1 The four changed zone frames

| UiMap / AreaID | Zone | Era W × H (yd) | Forever W × H (yd) | Span ratio | Edge moves (yd): west, north, east, south | Coefficients (x; y) |
|---|---|---|---|---|---|---|
| 1412 / 215 | Mulgore | 5137.50 × 3425.00 | 6154.17 × 4102.08 | 1.198 | +431 W, +540 N, +585 E, +138 S | 0.834800, +7.007453; 0.834942, +13.153873 |
| 1423 / 139 | Eastern Plaguelands | 3870.83 × 2581.25 | 4302.08 × 2866.67 | 1.111 | −71 W (edge moved east), −108 N (moved south), +502 E, +394 S | 0.899758, −1.646493; 0.900436, −3.779049 |
| 1433 / 44 | Redridge Mountains | 2170.83 × 1447.92 | same | 1.000 | whole frame 110.4 east | 1.000000, −5.086375; 1, 0 |
| 1453 / 1519 | Stormwind City | 1344.27 × 896.35 | 1737.50 × 1158.34 | 1.292 | +342 W, +283 N, +51 E, −21 S | 0.773679, +19.680450; 0.773827, +24.433288 |

"Scale ~0.835" in the brief is the Mulgore **percent coefficient**. The Mulgore frame now covers
about 19.8% more yards per axis. The other 45 frames in `conversion.json` (42 zones and cities plus 3 battlegrounds) and both continent frames are unchanged.

### 11.2 Content implications (from QuestieDB, not re-verified)

- QuestieDB's entity baseline has already been converted: 140,660 pairs recognised, 13,691 changed.
  Six synthetic continent/world points remain unconverted (`tools/dbc/README.md`, "Convert data and
  corrections"; `docs/forever-data.md`).
- Seven dungeon entrances were rewritten into Forever literals (`docs/forever-coordinate-audit.md`).
- Any **Era-framed** coordinate from another source must be converted before use in the four zones.
  That includes RXP Classic guides, older Questie corrections and hand-authored notes. Everywhere
  else Era percent equals Forever percent.

### 11.3 Changes between Forever beta builds

- `UiMapAssignment` 1.60.1.69893 and 1.60.1.70009 are byte-identical (SHA-256 `79267e8b…a0ca`). So
  QuestieDB's 69893 geometry is valid for 70009.
- `UiMap` changed between them. Alterac Valley 1459, Warsong Gulch 1460 and Arathi Basin 1461 moved
  from parent 947 / Type 3 to parents 1424 / 1413 / 1417 with Type 6. Darkspear Islands 2524 moved
  from parent 947 / Type 3 to parent 1414 / Type 6. The parent graph is therefore not stable across
  beta builds.
- Consequences (D-018):
  - Every geometry row records its source and build.
  - The placeholder records `UiMap` type and parent at 70009 for the 11 DB2-only UiMaps, and none
    for the 49 QuestieDB frames, because `conversion.json` does not carry them.
  - Surfaces group maps by world `mapId`, not by the parent graph.
  - Local sets are accepted by the frame hash of the 49 shared rows, not by build equality, and
    may only add UiMaps the committed file lacks (ARCHITECTURE §6; MAPS.md §5.6).

  *Superseded by D-018 and F09:* revision 1's advice "pin the build" meant accepting a local set
  only when its build matched. The data frame (69893) and the client (70009) differ, so that test
  could never pass even though the frames are identical.

## 12. New Forever maps (1.60.1.70009)

| UiMap | Name | Type, parent | MapID (Map name, InstanceType) | AreaID (AreaTable ContinentID) | Xmin, Xmax | Ymin, Ymax | Art |
|---:|---|---|---|---|---|---|---|
| 2482 | Mount Hyjal | 3, 1414 | 1 Kalimdor, 0 | 616 (1) | 3989.583, 6304.166 | −4395.834, −922.916 | 1002×668, 9 overlays |
| 2521 | Zephras Isle | 3, 947 | **2991** "Zephras Isle", 0 | 16593 (2991) | 1247.917, 4956.25 | −1331.25, 4231.25 | 1002×668, 20 overlays |
| 2524 | Darkspear Islands | 6, 1414 | **2997** "Darkspear Islands", **3** | 16606 (2997) | −835.416, 447.916 | 993.75, 2918.75 | 1002×668, 0 overlays |
| 2548 | Riverglades | 3, 1415 | 0 Eastern Kingdoms, 0 | 16591 (0) | −9700, −6466.666 | −6741.666, −1891.666 | 1002×668, 14 overlays |
| 2652 | Shen'dralas | 3, 1414 | 1 Kalimdor, 0 | 16651 (1) | −3266.666, −1900 | −25, 2025 | 1002×668, 7 overlays |
| 2665 | Zephras Isle | 3, 0 | 2991, 0 | 0 | 1247.920, 4956.25 | −1331.25, 4231.25 | 512×512, 1 tile |

Columns: `UiMap.Type`, `ParentUiMapID`; `UiMapAssignment.MapID`, `AreaID`, `Region_0/3` (X),
`Region_1/4` (Y); `Map.InstanceType`; `AreaTable.ContinentID`; art from
`UiMapXMapArt`/`UiMapArtStyleLayer`/`WorldMapOverlay`, all at 1.60.1.70009. Bounds are rounded
here; the committed full-precision rows are in MAPS.md §8.3.

Observations:

- Hyjal, Shen'dralas and Riverglades are on the existing continents and fit the same world frames.
- Zephras Isle is on its own world map (2991), and Darkspear Islands is on 2997, which has
  `InstanceType = 3` (the value used for battlegrounds). Neither can be projected onto Kalimdor,
  Eastern Kingdoms or Azeroth with `UiMapAssignment`: 947 has rows only for MapIDs 0 and 1.
  **Answered for 1.60.1.70009 (C1):** the client places neither on the world map (`UiMapLink` 0
  records; `Map.ParentMapID` and `CosmeticParentMapID` −1; no `UiMapGroupMember` rows; map-atlas.md
  §3.1). Rows a server sends at run time are **UNKNOWN** (they live in `Cache/`, which is never
  read). The atlas surface (D-042) therefore shows Zephras Isle as a captioned card "not in
  position", placed by a committed layout constant with its reason, and Darkspear Islands, a
  battleground map, keeps its own surface `world:2997`.
- QuestieDB's Forever NPC and object DBs contain **zero** spawns keyed by AreaIDs 616, 16591,
  16593, 16606 or 16651 (grep of `data/Forever/*DB.lua`). The route planner has no QuestieDB points
  there yet.
- `Map` also has many other IDs above 2000 (for example 2784 Demon Fall Canyon and 2856 Scarlet
  Enclave). These mostly look like Season-of-Discovery-era instance maps present in the client
  files. They are not evidence of Forever content.
- QuestieDB routes AreaID 616 to 2482 (replacing Cata Hyjal 198) and 16593 to 2521. It leaves 2665
  unresolved (`docs/forever-data.md`, zone-map dispositions).

## 13. Namespaces and pitfalls

### 13.1 Four different integer IDs

| ID | Table | Example | Used by |
|---|---|---|---|
| AreaID | `AreaTable` | 14 Durotar, 1637 Orgrimmar, 16593 Zephras Isle | QuestieDB spawn keys (`npcKeys.spawns`: `{[zoneID]={{x,y}}}`), `zoneID`, dungeon tables |
| UiMapID | `UiMap` | 1411 Durotar, 1454 Orgrimmar, 2521 Zephras Isle | `C_Map`, HBD, RXP `.goto <id>/…`, art |
| MapID (instance / continent) | `Map` | 0 Eastern Kingdoms, 1 Kalimdor, 2991 Zephras | world coordinates, RXP `/<n>`, TaxiNodes `ContinentID` |
| UiMapAssignment ID | `UiMapAssignment` | 46721 | provenance only |

The namespaces collide: `areaIdToUiMapId[2521] = 1444` (AreaID 2521 is *Verdantis River*, in
Feralas), while **UiMapID** 2521 is Zephras Isle (`support/Forever/Zones/areaIdToUiMapId.lua:925,1045`).
Type every ID (branded TypeScript types) and never share a lookup table between namespaces.

### 13.2 AreaID → UiMap for QuestieDB points

- Use `support/Forever/Zones/areaIdToUiMapId.lua`: 1,064 forward DBC routes (54 direct, 1,010
  parent-resolved), plus overrides and 40 retired compatibility pairs (`docs/forever-map-override-audit.md`).
- Only **direct** assignments define a coordinate frame. QuestieDB's README says a selected map
  does not establish an existing point's frame (`tools/dbc/README.md`, "Inputs and ownership").
- In the raw Forever NPC and object DBs, every real (non-sentinel) spawn pair is keyed by an AreaID
  with a direct `UiMapAssignment`. The 29 NPC and 27 object keys without one (for example 3456
  Naxxramas and 2557 Dire Maul) hold only `{-1,-1}`: 2,125 NPC and 718 object pairs (checked in
  `.cache/experiments/maps`). Corrections and waypoints were not checked.
- `{-1,-1}` means "inside an instance", not a position. Resolve it to an outdoor entrance through
  `support/Forever/Zones/dungeons.lua` (`{name, altAreaIds, parentZone, {{areaId, x, y}, …}}`).
  The retired compatibility UiMaps are **not** native Forever maps. The Forever client has no
  dungeon UiMaps at all: the 60 UiMaps are types 1, 2, 3 and 6 only.
- A spawn tuple may have a third element, a phase (`src/meta/normalize.lua:54-63`). `{0,0}` is a
  real point.

### 13.3 HereBeDragons "world coordinates" are swapped

HBD's `GetWorldCoordinatesFromZone` returns `x = left − width·u` and `y = top − height·v`
(`HereBeDragons-2.0.lua:450-456`), where `left` is world Y and `top` is world X. So
**HBD `(x, y)` = Blizzard `(Y, X)`**. Any data produced through HBD, including RXP world-form
`.goto`, is in `(Y, X)` order.

### 13.4 RXP `.goto` forms

The examples are our own synthetic values (round numbers inside Durotar's frame), not RXPGuides
lines (D-019). None of the three example strings occurs in RXPGuides at `c3429e06` (checked
2026-09-25 with a fixed-string search of the checkout).

| Form | Example (synthetic) | Meaning | Parser |
|---|---|---|---|
| Zone name + percent | `.goto Durotar,50.00,50.00` | Percent on the named UiMap, resolved with the live client's geometry | `functions.lua:1898` (`addon.GetMapInfo`) |
| Numeric UiMapID + percent | `.goto 1411,50.00,50.00` | The same point, with the UiMap given by ID | RXP.md §10 (`map.lua:1530`) |
| UiMap/instance + world | `.goto 1411/1,-4000.00,-500.00` | First number = world **Y**, second = world **X**, on MapID 1 (the `/1`); the `1411` prefix names the UiMap. RXP converts the pair to zone percent with `HBD:GetZoneCoordinatesFromWorld`: here Durotar `38.53, 65.48` (section 4 formula, row 46721). | `functions.lua:1875-1896` |

*Corrected:* the Milestone 0 consistency check found an earlier draft of this table quoting two
lines taken from RXPGuides guides (one world-form Mulgore line and one percent-form Stormwind City
line). Those were guide text, which D-019 excludes; the synthetic examples above replace them.

In the RXP Forever guides (`Guides/Forever/`, 13 files) there are 11,655 world-form lines and
2,525 percent-form lines. 98 of the percent-form lines are on the four changed zones. Whether
those were authored in the Era or the Forever frame is **UNKNOWN**. RXP interprets them with the
running client's (Forever) geometry.

Revision 1's advice was to import them as Forever percent and flag them for landmark review.
*Superseded in detail by ARCHITECTURE §10 step 4:* percent points on 1412, 1423, 1433 and 1453 are
tagged with the import option's frame (`forever` by default, `era` optional) and get
`RXP030-frame-ambiguous`. Lowering maps the forms onto `SourcedPoint` (section 15;
`src/domain/points.ts`):

- percent form → `space: 'zone'` with the UiMapID and the `frame` (`forever` unless the import
  option says `era` for one of the four changed UiMaps). The first example becomes
  `{ space: 'zone', uiMapId: 1411, x: 50, y: 50, frame: 'forever', lexemes: ['50.00', '50.00'] }`;
- world form → `space: 'world'`, `mapId` from the `/n` part, `x` = second number, `y` = first
  number, and `uiMapId` = the prefix, kept as a hint (ARCHITECTURE §6). The third example
  becomes `{ space: 'world', mapId: 1, x: -500, y: -4000, uiMapId: 1411,
  lexemes: ['-4000.00', '-500.00'] }`.

Both keep `lexemes` in the order written. An arrival radius given on the line goes to
`Location.radius` (yards; RXP.md §10, §12.4). RXP.md owns the full syntax.

### 13.5 Other pitfalls

- `UiMapAssignment` rows for AreaID 0 (continents, world) do not appear in wow.export's Zones tab
  (`tab_zones.js:409-437` lists only AreaIDs that are in `UiMapAssignment` and `AreaTable`).
- wow.export's `get_zone_ui_map_id` returns the **first** assignment with a matching AreaID and
  ignores `OrderIndex` (`tab_zones.js:23-30`). That is harmless in Forever, where each AreaID has one
  row, but do not copy it.
- `UiMap.Type` and `ParentUiMapID` change between betas (section 11.3). Do not hard-code
  hierarchies. Read them from the geometry file, whose rows record their source and build
  (D-018). The placeholder has them only for the 11 DB2-only UiMaps (`null` for the 49
  QuestieDB frames).

## 14. Rendering maths (Leaflet)

Leaflet 1.9.4 `L.CRS.Simple` uses `LonLat` projection, transformation `(1, 0, −1, 0)`,
`scale(z) = 2^z`, Euclidean distance and `infinite: true` (`src/geo/crs/CRS.Simple.js`). So at zoom
`z`, a `LatLng(lat, lng)` is drawn at pixel `(lng·2^z, −lat·2^z)`. North is up when lat grows north.

### 14.1 Surfaces

**AtlasSurface**, `SurfaceId` `atlas` (ARCHITECTURE §7.2; D-042; map-atlas.md §5): maps 1 and 0
placed side by side and Zephras Isle (2991) as an inset card, **the default since step ATL.10**,
which retired `world:0`, `world:1` and `world:2991`. Units stay yards: each placement is a
translation only (`scale` 1), from the committed 947 rows moved by whole 1,024-yd tiles (the
compact layout), with the inset's corner a committed constant (`src/geo/atlas-layout.ts`):

```
E = eOff − Y,  S = sOff − X                 // atlas east and south, per placement
toLatLng(X, Y) = L.latLng(−S, E)            // one code path with the world surface's (offsets 0)
inverse: X = sOff − S, Y = eOff − E         // picks round to 0.1 yd, after which it is exact
map of a point: inside the card → 2991; E ≤ seamE (16,617) → 1; else 0
```

Compact layout (1.60.1.70009 rows): Kalimdor eOff 5,652, sOff 12,778; the Eastern Kingdoms 22,499,
7,907; Zephras Isle 17,671.25, 5,468.25 (its rectangle's north-west corner at E 13,440, S 512).
Extent E 0–30,720, S 0–26,112. Atlas units are display only (D-017): they never feed a distance or
reach a saved project, which a file-level rule in `tests/architecture.test.ts` enforces.

**WorldSurface(mapId)**, `SurfaceId` `world:<mapId>` (ARCHITECTURE §7.1): one per world MapID the
atlas does not place (instances, battlegrounds, Darkspear Islands 2997), and for every world map
when a geometry has no 947 rows. Units are yards.

```
toLatLng(X, Y) = L.latLng(X, −Y)            // lat = north, lng = east
zone/continent art overlay bounds = [[Xmin, −Ymax], [Xmax, −Ymin]]   // [southWest, northEast]
native zoom of an art image       = log2(LayerWidth / (Ymax − Ymin))
```

Native zooms: Kalimdor art −5.20, Eastern Kingdoms −5.13, Durotar −2.40, Mulgore −2.62, Stormwind
−0.79, Orgrimmar −0.49. Suggested settings: `minZoom −6`, `maxZoom 1`, `zoomSnap 0.25`. All zones of
a continent, the continent art and every route line share one coordinate system. A "zone view" is
`fitBounds(zoneBounds)` plus that zone's overlay. Route lines crossing zone borders need no special
handling.

**UiSurface(uiMapId)**, for maps that are not a single world rectangle (Azeroth 947) or for a
strict per-map "Blizzard map" view. *Deferred until after the MVP (F23), then superseded by the
atlas surface above (D-042), which places the continents in yards and draws no 947 painting.* The
maths is kept for reference. Units are art pixels, `W × H = LayerWidth × LayerHeight`
(1002 × 668):

```
toLatLng(u, v) = L.latLng(−v·H, u·W)        // u, v normalised 0..1
image bounds   = [[−H, 0], [0, W]]
```

World points reach a UiSurface through the matching assignment (section 4). On 947, each MapID has
its own sub-rectangle. Lines are drawn only between points on the same MapID.

### 14.2 Route lines across zones and continents

1. Resolve every step's `Location` to a `WorldPoint` at runtime with `resolve()` (section 15).
   *Superseded by D-017:* revision 1 converted every step to a `WorldPoint` at import and kept the
   `MapPoint` beside it. Now the project stores only the authored `SourcedPoint`, and nothing
   derived is persisted. A step that resolves to `null` is not drawn, and its leg is unknown.
2. Split the route into runs of consecutive steps that share a `mapId` and a line style. Draw
   each run as one polyline on that map's WorldSurface, plus a small highlight polyline for the
   selected leg (ARCHITECTURE §7.2).
3. At a `mapId` change (boat, zeppelin, portal, instance, hearthstone), end the run. Draw a
   transition glyph at both ends. On the atlas, a ride between the two placed continents is drawn
   as a `connector` arc instead (never measured); legs to the Zephras Isle card or an instance keep
   the glyph pair.
4. Instance-presence spawns (`{-1,-1}`) render at the resolved entrance, with an instance badge.
5. On a zone view, keep drawing points outside `[0,100]` with an off-map indicator. They are valid.
6. Level of detail, the path cap and layer diffing by descriptor id are specified in MAPS.md
   §7.2-§7.3 (PERF-7).

### 14.3 Composing a continent from zone rectangles

It is geometrically valid: zone frames are axis-aligned, isotropic rectangles in the continent's
world frame (sections 4.1 and 5). The practical problems:

- Frames overlap, so overlays fight. Cities overlap their parent zones.
- Zone art has painted parchment edges.
- The client already has continent art for 1414 and 1415.

Use the real continent art when it is available. Use zone rectangles only for placeholders,
hit-testing and "zoom into zone" affordances (MAPS.md section 7).

## 15. Coordinate model (`src/geo`)

Built in Milestone 2. This section describes `src/geo` as implemented; the point and spawn types
are authoritative in `src/domain/points.ts` and `src/domain/dataset.ts` and are repeated here with
shortened comments. Where this section and ARCHITECTURE or the domain types differ, they win.

*Superseded by D-017:* revision 1 of this section had a single-object `SourcedPoint` with
`point`, `frame: 'forever-percent' | 'era-percent' | 'world'` and a free-text `source`. It made
`WorldPoint` the stored form of every location, needed an Era `MapGeometry` for `eraToForever`,
and gave the render adapter a `ui` surface kind.
*Superseded by ARCHITECTURE §6 and `src/domain/points.ts`:* the first revision-2 sketch had
optional `lexemes?`, no `uiMapId` on the world variant, no `Location.radius`, and a two-variant
`SpawnPoint` for the shipped `spawns.json` rows with no case for AreaIDs that have no UiMap.
*Superseded by the Milestone 2 implementation:* the Milestone 0 sketch here named
`zoneToWorld`/`worldToZone`, `frameCanonicalString(g, frameSet)` and an `eraToForever` returning a
tuple; the built names and shapes follow.

```ts
// Branded IDs (src/domain/ids.ts). Separate namespaces; never share a lookup table (§13.1).
type AreaId = Brand<number, 'AreaId'>;
type UiMapId = Brand<number, 'UiMapId'>;
type WorldMapId = Brand<number, 'WorldMapId'>;          // Map.ID: 0, 1, 2991, 2997, …

// src/domain/points.ts (unchanged by Milestone 2)
interface WorldPoint { readonly mapId: WorldMapId; readonly x: number; readonly y: number }   // yards, x north, y west
interface MapPoint { readonly uiMapId: UiMapId; readonly x: number; readonly y: number }     // percent, display only
type SourcedPoint =
  | { readonly space: 'world'; readonly mapId: WorldMapId; readonly x: number; readonly y: number;
      readonly uiMapId: UiMapId | null; readonly lexemes: readonly [string, string] | null }
  | { readonly space: 'zone'; readonly uiMapId: UiMapId; readonly x: number; readonly y: number;
      readonly frame: 'forever' | 'era'; readonly lexemes: readonly [string, string] | null };
interface Location { readonly source: SourcedPoint; readonly label: string | null; readonly radius: number | null }

// src/geo/types.ts: one shape for the placeholder, a local set and the two merged (MAPS.md §5.3)
type GeometryRowSource = 'questiedb-conversion' | 'db2-csv' | 'local-db2';
interface GeometryAssignment {                       // one UiMapAssignment row
  readonly id: number;                               // UiMapAssignment.ID (provenance only)
  readonly mapId: WorldMapId;                        // MapID
  readonly areaId: AreaId;                           // AreaID; 0 for continent/world rows (DB2 value)
  readonly orderIndex: number;
  readonly xMin: number; readonly xMax: number;      // Region_0, Region_3 (south, north edges)
  readonly yMin: number; readonly yMax: number;      // Region_1, Region_4 (east, west edges)
  readonly uiMin: readonly [number, number];         // (UiMin_0, UiMin_1)
  readonly uiMax: readonly [number, number];         // (UiMax_0, UiMax_1)
  readonly source: GeometryRowSource; readonly build: string;
}
interface UiMapGeometry {
  readonly uiMapId: UiMapId; readonly name: string; readonly nameSource: GeometryRowSource;
  readonly type: number | null;                      // UiMap.Type; null for the 49 QuestieDB frames
  readonly parent: UiMapId | null;                   // ParentUiMapID (0 = root); null where not carried
  readonly assignments: readonly GeometryAssignment[];   // ≥ 1, ascending OrderIndex
}
interface EraToForeverCoefficients {
  readonly scaleX: number; readonly offsetX: number; readonly scaleY: number; readonly offsetY: number;
  readonly fromBuild: string; readonly toBuild: string; readonly source: 'questiedb-conversion';
}
interface MapGeometry {
  readonly kind: 'placeholder' | 'local' | 'merged';
  readonly product: string;                          // 'wow_classic_beta'
  readonly recordedFrameHash: string | null;         // as the file states; always recompute
  readonly recordedContentHash: string | null;       // `contentHash` as the file states; always recompute
  readonly maps: ReadonlyMap<UiMapId, UiMapGeometry>;                        // ascending
  readonly eraToForever: ReadonlyMap<UiMapId, EraToForeverCoefficients>;     // 1412, 1423, 1433, 1453
}
interface PercentPair { readonly x: number; readonly y: number }

// src/geo/geometry.ts
function parseGeometryFile(json: unknown): { ok: true; geometry: MapGeometry } | { ok: false; errors: readonly string[] };
function createMapGeometry(input: MapGeometryInput): MapGeometry;   // sorts; throws on duplicates or degenerate rows
function geometryProblems(input: MapGeometryInput): readonly string[];
function allAssignments(g: MapGeometry): readonly { uiMapId: UiMapId; row: GeometryAssignment }[];

// src/geo/transforms.ts
function mapToWorld(p: MapPoint, g: MapGeometry): WorldPoint | null;
function worldToMap(p: WorldPoint, uiMapId: UiMapId, g: MapGeometry): MapPoint | null;
function assignmentPercentToWorld(row: GeometryAssignment, x: number, y: number): WorldPoint;
function assignmentWorldToPercent(row: GeometryAssignment, worldX: number, worldY: number): PercentPair;
function assignmentForPercent(g: MapGeometry, uiMapId: UiMapId, x: number, y: number): GeometryAssignment | null;
function assignmentForWorld(g: MapGeometry, uiMapId: UiMapId, mapId: WorldMapId): GeometryAssignment | null;
function isFullUiRectangle(row: GeometryAssignment): boolean;
function uiRectangleContains(row: GeometryAssignment, x: number, y: number): boolean;

// src/geo/era.ts
const ERA_CHANGED_UIMAP_IDS: readonly UiMapId[];   // [1412, 1423, 1433, 1453]
function eraToForever(uiMapId: UiMapId, x: number, y: number, g: MapGeometry): PercentPair | null;

// src/geo/resolve.ts
type UnresolvedReason = 'no-geometry' | 'outside-ui-rectangles' | 'no-era-coefficients' | 'non-finite';
type Resolution = { kind: 'resolved'; point: WorldPoint } | { kind: 'unresolved'; reason: UnresolvedReason; uiMapId: UiMapId | null };
function resolve(input: Location | SourcedPoint, g: MapGeometry): WorldPoint | null;
function resolveDetailed(input: Location | SourcedPoint, g: MapGeometry): Resolution;
function resolvePoint(p: SourcedPoint, g: MapGeometry): WorldPoint | null;
function resolvePointDetailed(p: SourcedPoint, g: MapGeometry): Resolution;

// src/geo/distance.ts
function distanceYards(a: WorldPoint, b: WorldPoint): number | null;

// src/geo/zones.ts
function attributeZone(p: WorldPoint, hint: UiMapId | null, g: MapGeometry): { uiMapId: UiMapId; basis: 'hint' | 'containment' } | null;
function zoneFramesContaining(p: WorldPoint, g: MapGeometry): readonly UiMapId[];   // most central first
function frameCentrality(row: GeometryAssignment, p: WorldPoint): number;           // min(fu, 1 − fu, fv, 1 − fv)
function rowContainsWorldPoint(row: GeometryAssignment, p: WorldPoint): boolean;
function worldMapIdOf(uiMapId: UiMapId, g: MapGeometry): WorldMapId | null;
function worldMapIds(g: MapGeometry): readonly WorldMapId[];

// src/geo/frame.ts
type FrameTuple = readonly [uiMapId, mapId, xMin, xMax, yMin, yMax, uiMinU, uiMinV, uiMaxU, uiMaxV];   // numbers
function frameTuple(uiMapId: UiMapId, row: GeometryAssignment): FrameTuple;
function frameSetOf(g: MapGeometry): readonly UiMapId[];          // UiMaps with questiedb-conversion rows
function canonicalFrameTuples(g: MapGeometry, frameSet?: readonly UiMapId[]):
  | { ok: true; tuples: readonly FrameTuple[]; canonical: string } | { ok: false; incompatible: readonly UiMapId[] };
function canonicalFrameString(tuples: readonly FrameTuple[]): string;   // JSON.stringify
function mergeLocalGeometry(committed: MapGeometry, local: MapGeometry):
  | { kind: 'merged'; geometry: MapGeometry; added: readonly UiMapId[] }
  | { kind: 'mismatch'; frameUiMapIds: readonly UiMapId[]; sharedRowUiMapIds: readonly UiMapId[] };

// src/geo/content.ts (MAPS.md §5.3)
function canonicalGeometryContent(g: MapGeometry): string;   // every row, name, parent, coefficient
```

`src/geo/index.ts` re-exports all of it. The module is pure (ARCHITECTURE §17): no DOM, Node,
clock, randomness, locale or bitwise operators; `Math.sqrt`, `Math.min` and `Math.fround` only.
Hashing the canonical frame and content strings is done by `tools/maps` (`node:crypto`) and
`infra/maps` (WebCrypto).

Contracts:

- **`resolve` / `resolvePoint` / `…Detailed`:**
  - `space: 'world'` returns a new `{ mapId, x, y }`. The `uiMapId` hint is not used for
    resolution; it matters only for display and RXP export. World points resolve even on world
    maps the geometry does not know.
  - `space: 'zone'` with `frame: 'era'` first applies `eraToForever` (the geometry's block;
    identity outside the four changed UiMaps), then the zone transform.
  - Unresolved reasons: `no-geometry` (the UiMap has no row), `outside-ui-rectangles` (a
    multi-row map such as 947 and a point on none of its sub-rectangles), `no-era-coefficients`
    (an Era point on 1412/1423/1433/1453 and a geometry without that coefficient set: guessing
    identity would misplace it by about 100 yd, §9), `non-finite`.
  - Nothing is cached on the `Location`. `null` means unknown travel (`Estimated` basis
    `unknown`) plus an info issue, never zero distance (ARCHITECTURE §6).
- **`mapToWorld`:** a UiMap whose only row has the full `(0,0)-(1,1)` UI rectangle (every zone,
  continent and new map) always uses that row, so percent outside 0..100 extrapolates in the
  frame (§7.4). Otherwise the point must lie in a row's UI sub-rectangle, edges included; the
  lowest OrderIndex wins. A UiMap missing from the geometry gives `null`, and its percent point
  still stores and exports unchanged.
- **`worldToMap`** uses the lowest-OrderIndex row whose `mapId` equals the point's, and returns
  `null` when there is none. The result may lie outside 0..100 (§7.4).
- **World-form axes, UiMap hint and lexemes.** The world variant's `x`/`y` are Blizzard X
  (north) and Y (west). RXP and HereBeDragons write world pairs as `(Y, X)` (§13.3), so lowering
  swaps them. `uiMapId` keeps the `<UiMapID>` prefix of an RXP world-form goto and is `null` when
  a world point has none. `lexemes` keep the two number strings **in the order written**: `[Y, X]`
  for RXP world form, `[x%, y%]` for percent form. Export of points created or moved in the app is
  RXP.md's (§13.4).
- **`frame: 'era'`** comes only from an explicit import option on UiMaps 1412/1423/1433/1453
  (ARCHITECTURE §10). QuestieDB data is already in the Forever frame and is never converted again
  (§10.2).
- **Spawns are not `Location`s.** `infra/data` converts each shipped `spawns.json` entry once at
  load (ARCHITECTURE §5.2): a percent point whose AreaId has a UiMap becomes a zone `SourcedPoint`
  in the Forever frame and `resolvePoint` gives its world point; `{-1,-1}` becomes
  `InstancePresence` (world point: the dungeon entrance from `zones.json`, else `null`); a point
  whose AreaId has no UiMap becomes an `UnmappedAreaPoint` with its reason and a `null` world
  point. Nothing is guessed. `worldMapIdOf` gives `ZoneInfo.worldMapId` (null for 947).
- **`distanceYards`** is `Math.sqrt(dx² + dy²)` in yards, `null` across world maps. Cross-world
  moves need a transport step, a hearth or an instance entrance edge (ARCHITECTURE §9.1-§9.3).
- **`attributeZone`** (display only; §5 explains why rectangles are not zone borders): the hint
  wins when the geometry has it and one of its rows on the point's world map contains the point
  (`basis: 'hint'`). Otherwise the containing zone frame (a row with AreaID > 0, so never a
  continent) in which the point is **most central** wins: the largest
  `frameCentrality = min(fu, 1 − fu, fv, 1 − fv)`, ties by the smaller frame (a city before its
  zone), then by UiMapId (`basis: 'containment'`). Otherwise `null`. `zoneFramesContaining` lists
  the containing frames in the same order.
  *Measured agreement* (2026-09-25, the pinned `spawns.json` and the committed placeholder): over
  the 76,294 shipped zone spawns on direct frames, with each spawn's published UiMap as truth,
  the most-central rule agrees 87.6% of the time (NPCs 44,380 of 50,914, 87.2%; objects 22,490
  of 25,380, 88.6%). The earlier smallest-frame rule agreed 73.3% (NPCs 72.0%): it sent 2,121
  Barrens spawns to Durotar (542 now) and attributed Crossroads (TaxiNodes 25) to Durotar.
  Euclidean distance to the frame centre measured 88.2%, within a point of this rule. The rule
  still misses:
  Gornek (§7, Valley of Trials) is 0.3275 deep in The Barrens' frame and 0.3167 in Durotar's. So
  the fallback is for display only; grouping and anything stored use the published or authored
  UiMap (M2 review COORD-5).
- **`canonicalGeometryContent`** (MAPS.md §5.3): the canonical string the placeholder's
  `contentHash` is the SHA-256 of. It covers every row (all 61, the 12 `db2-csv` rows included),
  every name, name source, type and parent, and the `eraToForever` block, with no `Math.fround`,
  so any edit changes it. The committed placeholder's string is 10,983 bytes and hashes to
  `c05a47a2…`.
- **`canonicalFrameTuples`** builds the MAPS.md §5.6 canonical form: one tuple per frame-set UiMap
  (default: the geometry's `questiedb-conversion` UiMaps), ascending, from its single OrderIndex 0
  row, coordinates through `Math.fround`; a frame-set UiMap without exactly one OrderIndex 0 row
  makes the result `ok: false`. The committed placeholder's canonical string is 4,030 bytes and
  hashes to `2cb10551…`.
- **`mergeLocalGeometry`** needs no hash: equal canonical strings are equal frame hashes. Any
  frame-set UiMap whose local frame differs or is missing is listed in `frameUiMapIds`. Every
  other UiMap both have must have identical rows (sorted keys: the frame tuple plus OrderIndex
  and AreaID; assignment IDs, `source` and `build` are not compared), else it is listed in
  `sharedRowUiMapIds`. Any entry rejects the whole set. Otherwise the result is the committed
  geometry plus the local set's new UiMaps (`kind: 'merged'`); names, types, parents and the
  `eraToForever` block of committed UiMaps always come from the committed geometry.
- **`parseGeometryFile`** reads an already parsed file and fails closed with path-level errors:
  `schema` 1; `kind` `placeholder` (rows `questiedb-conversion`/`db2-csv`, a `frameHash`, no
  `redistribution` key) or `local` (rows `local-db2`, `"redistribution": "local-only"`); UiMap keys
  canonical positive integers; unknown keys inside maps, rows and coefficient sets refused;
  bounds finite with `min < max`; UI coordinates in 0..1 with `min < max`; builds `a.b.c.d`;
  unique OrderIndex per UiMap. Other top-level keys (`_generated`, `inputs`, `build`) are
  provenance and are ignored.
- **Rendering** is outside `src/geo`. `map/leaflet` maps a `WorldPoint` on surface `world:<mapId>`
  to `L.latLng(x, −y)` (§14.1). The `ui` surface kind is deferred with the overview surface (F23).

*Resolved (ARCHITECTURE §6, `src/domain/points.ts`):* this section used to raise an open point.
RXP world-form gotos carry a UiMapID (`<UiMapID>/<MapID>`, section 13.4), and the world variant
had no field for it, so an edited or split group's canonical re-emission could not reproduce the
prefix (unedited groups re-emit their original lines and were never affected). The world variant
now carries the optional `uiMapId` hint shown above, so lowering preserves the prefix in the
model and canonical re-emission writes it back.

Tests (Milestone 2), all with values cited in this document. `src/geo/*.test.ts` run on a small
cited fixture (`src/geo/test-fixtures.ts`); `tools/maps/placeholder-geometry.test.ts` repeats the
worked examples on the committed 61 rows.

1. Gornek (section 7): `{space:'zone', uiMapId:1411, x:42.06, y:68.33, frame:'forever'}` resolves
   to `(X, Y) = (−600.2992, −4186.4222)` on MapID 1. It is Kalimdor `57.7531, 54.6207` (row 1414)
   and Azeroth `28.7673, 51.5603` (947 row 46785), and Orgrimmar `36.06, 307.26` (off-frame).
   (`transforms.test.ts`, `resolve.test.ts`)
2. Hawkwind (section 8): `{space:'zone', uiMapId:1412, x:44.18, y:76.06, frame:'era'}` resolves via
   `eraToForever` to Forever `43.888926, 76.659548` and world `(−2877.9715, −221.8308)`, within
   1e-6 yd of reading the Era percent with the Era bounds; the stored QuestieDB value `43.89,
   76.66` is world `(−2877.99, −221.90)`, Kalimdor `46.98, 63.90`. (`resolve.test.ts`, `era.test.ts`)
3. TaxiNodes landmarks (section 9): nodes 2, 23, 22, 5, 67 and 68 lie 11.9, 2.6, 3.6, 7.0, 4.9
   and 3.8 yd from flight masters 352, 3310, 2995, 931, 12617 and 12636 (all under 30 yd); with
   the Era bounds of 1453, 1433 and 1423 the errors are 108.9, 107.2, 450.5 and 445.0 yd; a node
   on another world map has no distance (D-022). (`distance.test.ts`; the committed geometry in
   `tools/maps/placeholder-geometry.test.ts`)
4. Era and Forever frames differ only on the changed UiMaps. The committed placeholder's frame
   hash equals the MAPS.md §5.6 reference `2cb10551…` (`frame.test.ts`,
   `tools/maps/placeholder-geometry.test.ts`). The Era negative vector `b94bf685…` needs the Era
   CSV, which is local only; the fixture test checks that Era bounds change exactly the changed
   UiMaps' tuples.
5. World ↔ percent round trip below 1e-9 (fixture rows and all 61 committed rows, inside and
   outside 0..100). `resolve` returns `null` for a UiMap without geometry. `distanceYards` returns
   `null` across world maps.
6. A type-level test that `Location` has no derived world field, so nothing derived can be
   persisted. (`resolve.test.ts`)
7. World hint: the synthetic world point of section 13.4 (`mapId 1, x −500, y −4000,
   uiMapId 1411`) resolves to the same `WorldPoint` with and without its `uiMapId`, and is
   Durotar `38.5343, 65.4846` through row 46721. (`resolve.test.ts`)
8. `mergeLocalGeometry`: a local UiMap the placeholder lacks is added; a local row for a
   committed `db2-csv` UiMap that differs in one value (or in OrderIndex or AreaID) returns
   `mismatch`; decimal spellings of the same float32 and different assignment IDs, sources and
   builds are accepted; a moved or missing frame is a frame mismatch. (`frame.test.ts`)
9. Zone attribution: TaxiNodes 25 (Crossroads) lies in the 1411, 1412 and 1413 frames and is
   attributed to The Barrens 1413 (centrality 0.304, against 0.173 and 0.120); the Orgrimmar node
   goes to Orgrimmar 1454; Gornek without a hint goes to The Barrens (the documented miss); a
   centrality tie goes to the smaller frame. (`zones.test.ts`)
10. Content hash: the canonical string has the documented form, does not depend on build order,
   changes with every row, map and coefficient field (the `db2-csv` rows and the Era block
   included) and ignores the recorded hashes and provenance; the committed placeholder records
   the hash its content gives. (`content.test.ts`, `tools/maps/placeholder-geometry.test.ts`)

## 16. Reproducing these numbers

1. Inputs: the CSVs in `.cache/experiments/maps/` (gitignored, local), fetched as individual
   requests during research (not scripted crawling). MAPS.md §8.3 lists every file with its
   build, size, row count and SHA-256. The committed placeholder does not depend on them: it is
   generated from the pinned `conversion.json` and the committed
   `tools/maps/inputs/db2-rows-1.60.1.70009.json`. To recompute the research numbers without the
   CSVs, use a developer-local extraction at the same build (its parsed rows must agree after
   `Math.fround`), or fetch the tables again as individual requests. Never script wago.tools
   (D-011).
2. Since Milestone 2 the numbers of sections 7-9 and 10.3 are reproduced by the tests listed in
   section 15 (`pnpm test`), and by `pnpm maps:validate` for the committed geometry (P1-P8,
   MAPS.md §5.5). The Milestone 0 scratch scripts (`worked.js`, `steps.js`, `csv.js` in
   `.cache/experiments/maps/`, CommonJS, not committed) are no longer needed; to run them anyway,
   use copies renamed to `.cjs` outside the repository, because its `package.json` declares
   `"type": "module"`.
3. Compare `UiMapAssignment` against `conversion.json` `target_bounds` (section 10.3), and compute
   the frame hash (MAPS.md §5.6): `pnpm maps:validate` does both for the committed file
   (P1, P4); `tools/maps/lib/make-db2-rows.ts --check` checks the rows file against the CSVs where
   they exist.

## 17. Open questions

| # | Question | Why it matters |
|---|---|---|
| C1 | How does the client place Zephras Isle (MapID 2991) and Darkspear Islands (2997) on the world map? | **Answered for 1.60.1.70009** (map-atlas.md §3.1, read from the client through `tools/casc` and re-derived by its review): it places **neither**. `UiMapAssignment` has 947 rows only for MapIDs 0 and 1; `UiMapLink` (FileDataID 2030690) has 0 records; `Map` gives both maps `ParentMapID` and `CosmeticParentMapID` −1; `UiMapGroupMember` has no rows; `AreaTable` 16593 and 16606 have no parent. Rows a server may send at run time live in `Cache/`, which is never read: **UNKNOWN**. The atlas shows Zephras Isle as a card, not in position (D-042 O2), and Darkspear Islands keeps its own surface (a battleground, `InstanceType` 3). If a later build places either map, the atlas takes the cited row and its check T4 notices the change. |
| C2 | What are UiMaps 1463 and 1464 (512² continent maps with parent 0) for? | Only relevant if they are ever shown |
| C3 | Were the 98 RXP Forever percent-form `.goto` lines on changed zones authored in the Forever frame? | ~100 yd errors if they are Era-framed (section 9). Handled by the import frame option and `RXP030-frame-ambiguous`. |
| C4 | Do later betas change `UiMapAssignment`? | For the 49 shared frames, the frame hash detects it: local sets fall back, and a QuestieDB pin bump re-validates. For the 12 DB2-only rows, a local set with a differing row is rejected (C8); adopting a later build's rows needs a new committed rows file and owner review. |
| C5 | Is the `UiMin`/`UiMax` interpretation for 947 exact in-game? | Not checked in a live client, but it reproduces Questie's HereBeDragons Classic world-map constants to within 0.008 yd (section 4). It affects the deferred Azeroth overview and, since Milestone 2, one shipped spawn: object 180652 on synthetic AreaID 10089 → 947, which resolves through the Kalimdor sub-rectangle (section 4). |
| C6 | Did landmarks actually stay put on the four changed maps? | QuestieDB and this doc both assume it. **Partly answered:** six TaxiNodes landmarks were checked, four of them on three changed frames (Stormwind 1453, Redridge 1433, Eastern Plaguelands 1423): all lie within 12 yd in the Forever frame and 107-451 yd off in the Era frame (section 9). Mulgore 1412 has only the RXP point of section 8. |
| C7 | Should the world `SourcedPoint` carry the RXP UiMapID (section 15)? | **Decided** (ARCHITECTURE §6, `src/domain/points.ts`): yes, as the optional `uiMapId` hint, so RXP world-form UiMapIDs are preserved in the model and in canonical export of edited groups (sections 13.4, 15). |
| C8 | When a frame-compatible local set disagrees with a committed `db2-csv` row, which row wins? | **Decided** (ARCHITECTURE §6): the committed row. Local geometry may only add UiMaps the committed file lacks; a local row for a UiMap it already has must be identical, otherwise the whole local set is rejected as a frame mismatch (section 10.4; MAPS.md §5.6 step 4). *Superseded:* the proposal that local rows win on that machine, with a layer-panel notice. |
