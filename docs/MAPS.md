# Maps

Status: **Milestone 0 research (2026-09-25), revised for ARCHITECTURE revision 2 and the
architect's rulings on the Milestone 0 consistency check; updated in Milestone 2 for what was
built.** Milestone 2 built `src/geo` (coordinates and geometry, [coordinates §15](research/coordinates.md#15-coordinate-model-srcgeo)),
`tools/maps/import.ts --placeholder`, `tools/maps/validate.ts` (placeholder checks, local-set
checks and `--activate`), the committed rows file and the committed placeholder
(`tools/maps/README.md` is the operator's guide). Milestone 3 built `vite-local-maps.ts`;
Milestone 3b (step 3b.8) built the extraction from the client, `import.ts --build` and
`convert.ts`, on the shared CASC reader `tools/casc`, and commits the painted map art under
`public/maps/art/` (D-033, §5.4 (b)). The map rework (2026-09-27 and 28;
[research/map-atlas.md](research/map-atlas.md) revision 3.1, steps ATL.0 to ATL.10 and MM.1 to MM.9,
D-042, D-045, D-049; [research/map-presentation.md](research/map-presentation.md), D-047) built the
seamless **atlas** surface for both continents and Zephras Isle, in two base-map styles: the
**minimap** (the client's minimap textures with a navy sea; the default since MM.9) and the
**painted atlas** (the painted zone maps composed into one raster). Since step ATL.10 the atlas and
its smooth wheel are on by default, `world:0`, `world:1` and `world:2991` are retired, and
`public/maps/art/` keeps only the five images still drawn one at a time (§1, §7.1, §7.5, §9). This
file covers:

- where map data comes from and how a developer extracts it locally;
- what is committed (the placeholder geometry) and how Milestone 2 reproduces it;
- how local map sets are served without ever reaching a deployed build;
- how the map renders.

Derivations and worked numbers are in [research/coordinates.md](research/coordinates.md).

**Authority.** [ARCHITECTURE.md](ARCHITECTURE.md) §6-§7 and §16, [DECISIONS.md](DECISIONS.md)
D-016 to D-026, and the domain types in `src/domain/*.ts` (`points.ts` for coordinates) win over
this file. D-017 covers coordinates, D-018 map files, D-022 client values in docs and tests,
D-025 deployment, and D-026 per-row geometry builds. Earlier recommendations that revision 2 or
the architect's later rulings replaced are kept for their evidence and marked **Superseded**
with the entry or section that replaced them. §12 lists them all. Findings such as F03 or LIC-01
are from the Milestone 0 critique; their dispositions are in
[reviews/review-m0-architecture.md](reviews/review-m0-architecture.md).

Placeholders: `<repo>/` is this repository. `<wow-install>` is the World of Warcraft installation
root; on Windows the Battle.net default is `C:\Program Files (x86)\World of Warcraft`. It is
**read-only** to every tool.

Rule: **never copy maps, tiles, geometry or code from any other WoW route-planner web app.**

## 1. Summary

| Item | Decision / fact | Source |
|---|---|---|
| Map source | The developer's **own** Forever client (local CASC, read-only) or Blizzard's public CDN for the same build. No third-party map images are used. | §2, §5 |
| WoW flavour / product | WoW Forever = product **`wow_classic_beta`** (`.flavor.info` in `<wow-install>/_classic_beta_`) | Local install, read only |
| Client build | **1.60.1.70124**, Build Key `dd3dfc2881c407299f46c2aaf34c130b`: the pin of every client tool since 2026-09-30 (D-050), when the launcher updated the client. Before that, **1.60.1.70009**, Build Key `05215079e3905ef5922ae0b03ffefb73` (the brief said 69977; the launcher updated the client on 2026-09-25, D-013). Every DB2 table and file the tools read has the same CKey at both builds, and every rebuild is byte-identical apart from the manifests and NOTICEs ([reviews/repin-70124.md](reviews/repin-70124.md)). | `<wow-install>/.build.info`; `us.version.battle.net/wow_classic_beta/versions` |
| Data frame | **1.60.1.69893**, QuestieDB's DBC target (D-013). `UiMapAssignment` is byte-identical at 69893 and 70009. | [coordinates §10-11](research/coordinates.md) |
| Frame compatibility | A local map set is accepted when its rows for the 49 shared zone frames **hash-equal** the committed rows, not when build strings match (D-018, F09). It may only **add** UiMaps: a local row for a UiMap the committed file already has must be identical, or the whole set is rejected (ARCHITECTURE §6). | §5.6 |
| Map art | UI world-map art: `UiMapXMapArt → UiMapArt → UiMapArtStyleLayer + UiMapArtTile` BLP tiles, plus `WorldMapOverlay(Tile)` explored overlays. Every Forever map with 1002 × 668 art uses 4 × 3 tiles of 256 px. **Committed and deployed** with a manifest and NOTICE (D-033, which superseded D-018's art rule), extracted by `tools/maps/convert.ts` (§5.4 (b)): since step ATL.10 (D-042 O5) `public/maps/art/` holds only the images still drawn one at a time (Alterac Valley 1459, Warsong Gulch 1460, Arathi Basin 1461, Zephras Isle 2521, Darkspear Islands 2524); the zone, city and continent paintings of maps 0 and 1 reach the site composed into the painted atlas's tiles (`public/maps/atlas/`, `tools/maps/atlas.ts`). | DB2 at 70009 (§3) |
| Base-map styles (D-045, D-049) | **Minimap** (default since MM.9): the client's minimap textures of maps 0, 1 and 2991, found through each map's WDT `MAID` chunk, recoloured to a navy sea and resampled onto the atlas grid (`tools/maps/minimap.ts`, `public/maps/minimap/`; the tiles come from a release-asset pack and are never committed, §9 item 14). **Painted**: the painted atlas. The choice is a per-browser view setting in the Map layers drawer; a style that cannot be drawn gives way to the other, saying why. | map-atlas.md §16-§28 |
| Map metadata | DB2 tables `UiMap`, `UiMapAssignment`, `UiMapArt`, `UiMapArtTile`, `UiMapArtStyleLayer`, `UiMapXMapArt`, `WorldMapOverlay`, `WorldMapOverlayTile`, `AreaTable`, `Map`, `TaxiNodes`, `TaxiPath`, `TaxiPathNode`, decoded with WoWDBDefs `cf84e010f84ba9c8d48fd61730f92bf0d8f2b1cd` (has the 1.60.1.x layouts) | §3, §5 |
| Primary tools (scripted, local) | **TACTTool** (wowdev/TACTSharp, declares MIT, `a507ff7b`) for read-only extraction by FileDataID. **DBC2CSV** (Marlamin, `1e4aaa46`) for DB2 → CSV. Our own `tools/maps/*.ts` for BLP decoding, stitching and manifests. | §4 |
| Fallback tool (GUI) | **wow.export 0.2.19** (declares MIT, commit `c2fd7bde`, 2026-06-22). NW.js GUI only, with no CLI or headless mode. Never scripted (D-011). **Use CDN mode or disable cache collection first** (§4.1). | `.cache/wow.export` |
| Raw file types | `.db2` (WDC5, per WoWDBDefs), `.blp` (BLP2: palette, DXT1/3/5 or BGRA) | §3 |
| Local map set | One local extraction set in `local-maps/` at the repository root: `maps.manifest.json`, `geometry.local.json`, `art/<uiMapId>.webp` and, optionally, `taxi.local.json`. It is gitignored and **outside `public/`**. `tools/maps/validate.ts --activate` writes `maps.manifest.json` after the checks pass; that file is the one `infra/maps` probes. Only `tools/maps/vite-local-maps.ts` serves the folder, in `dev` and `preview`; `vite build` never emits it (D-018, ARCHITECTURE §7.3). | §5.2, §5.7 |
| Committed geometry | `public/maps/placeholder/geometry.placeholder.json` plus `NOTICE.md`, produced only by `tools/maps/import.ts --placeholder` from the pinned QuestieDB `conversion.json` and the committed `tools/maps/inputs/db2-rows-1.60.1.70009.json`, so it is reproducible. It holds 49 zone frames (`source: 'questiedb-conversion'`, build 1.60.1.69893) and 12 DB2-only rows for 11 UiMaps (`source: 'db2-csv'`, build 1.60.1.70009), taken from CSVs fetched as individual requests during research (not scripted crawling). Every row records its source and build (D-018, D-026). | §8 |
| Coordinates | Dataset spawns ship as published zone percent and are converted to `WorldPoint` at load. A route `Location` stores the authored `SourcedPoint`; `resolve()` derives world coordinates at runtime, and nothing derived is persisted (D-017). | §6; [coordinates §15](research/coordinates.md#15-coordinate-model-srcgeo) |
| Renderer | Leaflet 1.9.4 (declares BSD-2-Clause) behind `MapAdapter`, `L.CRS.Simple` in yards. **The atlas surface** (on by default since ATL.10, D-042) shows Kalimdor and the Eastern Kingdoms in the compact layout and Zephras Isle as a card, placed by translation only; instances, battlegrounds and Darkspear Islands keep **one surface per world map**. Canvas renderer with level of detail, our own smooth wheel, and the atlas tiles over an underlay. No react-leaflet (D-005). *Superseded:* the overview surface deferred until after the MVP (F23), replaced by the atlas. | §7 |
| Images | `convert.ts` composes one image per UiMap and style layer at native `LayerWidth × LayerHeight` (1002 × 668; 512 × 512 for 1463, 1464, 2665), fully explored, **WebP** (lossy, quality 80, `drawing` preset), and keeps every composed UiMap's pixel hash (`sources`). Deployed since ATL.10: 5 images, 689 kB gzip-6 with the manifest and NOTICE, within the 1.0 MB `art` budget (D-042 O5; before ATL.10, 60 images, 9.05 MB, under D-034 item 4's 12 MB). The painted atlas: 792 tiles of 256 px, levels −8 to 0, 6.95 MB with its index, manifest and NOTICE (≤ 8.0 MB). The minimap: 6,647 tiles, 51.76 MB gzip-6 (52.17 MB with the committed files; ≤ 60 MB). | §5.4; map-atlas.md §7, §24 |

## 2. Client, build and data locations

| Fact | Value | Evidence |
|---|---|---|
| Install root | `<wow-install>` (**strictly read-only**) | — |
| `.build.info` | One row: `Product=wow_classic_beta`, `Version=1.60.1.70124`, `Branch=us`, `Active=1`, Build Key `dd3dfc2881c407299f46c2aaf34c130b`, CDN Key `43061ca8e9f0e2603c8ab50bcae97c2d`, `CDN Path tpr/wow` (on 2026-09-25: `Version=1.60.1.70009`, CDN Key `9b3c456dbb837d133a026d380c7c13e9`). Its `Tags` column includes account-region tags: do not copy it. | Read 2026-09-30 (and 2026-09-25) |
| CASC storage | `<wow-install>/Data/` (`data/`, `indices/`, `config/`, `ecache/`, plus one small folder per installed product such as `wow_classic_beta/`), shared by every installed flavour | Directory listing only |
| Flavour folder | `<wow-install>/_classic_beta_/` holds `WowB.exe`, `.flavor.info` (`wow_classic_beta`), `Interface/`, `Fonts/` and more. **Never read `WTF/`, `Cache/`, `Logs/` or SavedVariables.** | — |
| Public CDN | Patch server `https://us.version.battle.net/wow_classic_beta/versions` serves 1.60.1.70009 with the same BuildConfig, so the exact client build can also be streamed without a local install. Whether any files are **encrypted** is UNVERIFIED. | Fetched 2026-09-25 |
| Forever builds seen | 1.60.1.69876 (2026-09-16), 69893 (09-16), 69913 (09-18), 69977 (09-23), 70009 (09-24); 70124 (installed by 2026-09-30) | wago.tools `/api/builds`, WoWDBDefs `BUILD` lines; 70124 from `.build.info` only |

Each local map set comes from exactly one build and records it (§5.3). Whether a set can be used
with the committed data is decided by the frame hash (§5.6), not by comparing build strings.
Evidence that build strings are the wrong test: `UiMapAssignment` is byte-identical at 69893 and
70009, while `UiMap` parents and types changed between them
([coordinates §11.3](research/coordinates.md#113-changes-between-forever-beta-builds)).
*Superseded by D-018 and F09:* revision 1's rule "pin one build per map set, use it only when the
build matches" could never match, because the data frame is 69893 and the client is 70009.

## 3. What the Forever client contains (1.60.1.70009)

Values in this section are individual client-derived values. Each is cited by table and, where
relevant, column, at build 1.60.1.70009, as D-022 allows. The pin has been 1.60.1.70124 since
2026-09-30; every table and texture of this section that the tools read has the same CKey there
(`UiMapLink` was not re-read), so these values hold at 70124 too
([reviews/repin-70124.md](reviews/repin-70124.md)). Bulk tables stay local; the committed
placeholder's 61 `UiMapAssignment` rows are the one recorded exception (D-018, D-026).

| Kind | Content |
|---|---|
| UiMaps (`UiMap`) | 60 in total: Azeroth 947 (world); Kalimdor 1414 and Eastern Kingdoms 1415 (continents); alternative continents 1463 and 1464; 46 Classic zones and cities (1411-1413, 1416-1458); 3 battlegrounds (1459-1461); 6 new maps: Mount Hyjal 2482, Zephras Isle 2521 and 2665, Darkspear Islands 2524, Riverglades 2548, Shen'dralas 2652. **No dungeon UiMaps.** |
| Assignments (`UiMapAssignment`) | 61 rows. Every zone has one `OrderIndex 0` row with the full `(0,0)-(1,1)` UI rectangle and no WMO or Z restriction. 947 has two rows (MapID 1 → left sub-rectangle, MapID 0 → right). 49 rows are the zone frames in QuestieDB `conversion.json`; the other 12 (for 11 UiMaps) are the DB2-only rows (§8.3). |
| Art styles (`UiMapArtStyleLayer`) | Style 1: one layer of 1002 × 668 in 256 px tiles (57 UiMaps). Style 4: 512 × 512 single tile (1463, 1464, 2665). Styles 5, 106 and 107 (3840 × 2560) exist, but no Forever UiMap links to them. |
| Tiles (`UiMapArtTile.FileDataID`) | 687 rows are linked. 675 of them have FileDataIDs ≥ 5,000,000 (range 364,696 to 8,128,990). Whether Forever repainted the art compared with Era is UNVERIFIED. |
| Explored overlays (`WorldMapOverlay`, `WorldMapOverlayTile`) | 580 overlay rows on linked art, all with `PlayerConditionID = 0`, and 1,739 overlay tiles, placed at `OffsetX/OffsetY` in layer pixels |
| Minimaps | 1,796 BLP2 DXT1 textures of 512 × 512 (533.33 yd per tile, 1.0417 yd per texel) for maps 0, 1 and 2991, found through each map's WDT `MAID` chunk (the legacy `world/minimaps/…` names are not in the root). *Superseded:* "not used" (Milestone 0). Since D-045 and D-049 they are the minimap style's source (`tools/maps/minimap.ts`; map-atlas.md §17). |
| Taxi (`TaxiNodes`) | 100 nodes (51 on MapID 0, 47 on MapID 1, 2 on 30), world positions in `Pos_0/1/2`. Taxi-derived leg timings are local-only by default (D-022, STATUS OD-6). |
| `UiMapLink` | wago.tools reports "Table not found" at 70009, although WoWDBDefs lists the build. UNKNOWN. |

DB2 FileDataIDs, from WoWDBDefs `manifest.json`:

| Table | FDID | Table | FDID |
|---|---:|---|---:|
| UiMap | 1957206 | WorldMapOverlay | 1134579 |
| UiMapAssignment | 1957219 | WorldMapOverlayTile | 1957212 |
| UiMapArt | 1957202 | AreaTable | 1353545 |
| UiMapArtTile | 1957210 | Map | 1349477 |
| UiMapArtStyleLayer | 1957208 | TaxiNodes | 1068100 |
| UiMapXMapArt | 1957217 | TaxiPath | 1067802 |
| UiMapLink | 2030690 | TaxiPathNode | 1000437 |

Example: Durotar 1411 uses art 2169 (`UiMapXMapArt.UiMapArtID`). Its 12 tiles
(`UiMapArtTile.FileDataID`) are `8073638, 8074081, 8074082, 8074083` (row 0), `8074084…8074087`
(row 1) and `8074088, 8073639, 8073686, 8074080` (row 2). It has 11 overlays (`WorldMapOverlay`).
The first is ID 5358 at offset (427, 78), a 256 × 256 texture, AreaID 370.

## 4. Tools evaluated

| Tool | Licence (as declared) | Version / commit | Reads local CASC | Reads CDN | Headless | DB2 → CSV | Map art | Notes |
|---|---|---|---|---|---|---|---|---|
| **wow.export** | MIT | 0.2.19, `c2fd7bde…` (2026-06-22) | Yes (`casc-source-local.js:42-52`, via `.build.info`) | Yes (`casc-source-remote.js`, patch server) | **No.** NW.js 0.104.1 GUI; the only CLI flag is `--disable-auto-update` (`app.js:14`) | CSV, SQL or raw DB2 (`core.js:384-388`) | Zones tab (PNG/WebP); Textures tab (BLP → PNG/WebP/raw BLP); Maps tab (minimap/terrain PNG + JSON sidecar) | Privacy issue: **cache collection is on by default** (§4.1). Never scripted (D-011). |
| **TACTSharp / TACTTool** | MIT | `a507ff7b…` (HEAD as fetched 2026-09-25) | Yes: `-d/--basedir` is used "as source for build info and read-only file cache" (README) | Yes (`-p <product> -r <region>`) | **Yes** (CLI) | No | Extracts raw BLP/DB2 by `fdid`, `name`, `ckey`, `ekey` or a `list` file | README lists "support for encrypted products" as a TODO |
| **DBC2CSV** | No licence file found at `1e4aaa46` | `1e4aaa46…` | n/a | n/a | **Yes** (CLI or drag-drop) | Yes, WDB5+; optional hotfix `DBCache.bin` | No | .NET 8 runtime. Its bundled definitions are "likely outdated", so supply current WoWDBDefs (the flag is UNVERIFIED). |
| DBCD | MIT | `e732093f…` | n/a | n/a | Library | Yes | No | C# DB2 reader used by DBC2CSV |
| CascLib | MIT | `2a280f5a…` | Yes | Yes (online mode) | Library (C) | No | Raw files | Mature; would need bindings |
| CASCExplorer | No licence file found | — | Yes | Yes | GUI (and CASCConsole) | No | Raw files | Not evaluated further |
| wow.tools.local | MIT | `c58a179b…` | Yes | Yes | Local web server; CLI overrides such as `-wowFolder` and `-wowProduct` | Yes (web UI/API) | Yes | Heavy. Its README advises closing WoW and Battle.net while it runs. |
| **wago.tools** (web) | Service; no terms page found | Builds list includes all five 1.60.1.x builds | — | — | HTTP GET of a per-table CSV URL works | Yes | No | **`robots.txt`: `Disallow: /`.** Manual use only; never scripted and never in CI (D-011). The placeholder's two source CSVs were fetched this way, as individual requests during research (not scripted crawling). Reproducing the placeholder needs no request: the 12 rows are committed (§8.3). |
| QuestieDB `tools/dbc` | Repo has no licence file (D-016) | `b6f5b07b` | No | No | CLI (Python) | Reads a **private** `Questie/dbc` SQLite release (`download.py:23-24`, needs `gh` auth; `github.com/Questie/dbc` returns 404 anonymously) | No | Not reproducible for us. Its **output** `data/Forever/conversion.json` is public and is the source of the 49 committed frames (§8). |

### 4.1 wow.export details (0.2.19)

- **Products**: `wow_classic_beta` ("Beta: World of Warcraft Classic") is in `constants.js:114-126`,
  line 120. Local mode lists products from `.build.info` and falls back to the CDN for files
  missing locally (`casc-source-local.js:63-70`).
- **DB2**: uses WoWDBDefs definitions fetched at run time from the **unpinned `master`** branch
  (`default_config.jsonc:15`). Schema selection is by build or layout hash (`WDCReader.js:240-276`),
  and WDC2-WDC5 are supported (`WDCReader.js:22-26`). No hotfix (`DBCache.bin`) application was
  found in `src/js/db` or `src/js/casc`. Data tab exports write `<exportDir>/<Table>.csv`
  (`ui/data-exporter.js:41-42`).
- **Zones tab** (`modules/tab_zones.js`): lists AreaIDs that have a `UiMapAssignment` row
  (lines 409-437). It renders `UiMapXMapArt → UiMapArt → UiMapArtStyleLayer`, draws
  `UiMapArtTile` BLPs at `col·TileWidth, row·TileHeight` (lines 168-205) on a
  `LayerWidth × LayerHeight` canvas (lines 136-140), then draws `WorldMapOverlay` tiles at their
  offsets (lines 211-272; `showZoneOverlays` defaults to true, `default_config.jsonc:126`). It
  exports `zones/Zone_<AreaID>_<ZoneName>_<AreaName>[_Phase<n>].png|.webp` (lines 451-484) with
  **no metadata sidecar**. **Continents and Azeroth (AreaID 0) are not listed**, so their art must
  be exported as raw tiles from the Textures tab.
- **Maps tab** (`modules/tab_maps.js`): exports minimap tiles as `maps/<dir>/minimap/mapXX_YY.png`
  (line 846) and stitched PNGs with a JSON sidecar (`map_id`, `tiles`, `image`,
  `corners.{top_left,bottom_right}.{world_x,world_y}`, lines 789-808). This is the only sidecar
  wow.export writes, and it is for terrain minimaps, not UI maps.
- **Formats**: textures export as PNG, WebP (quality 90) or raw BLP (`core.js:299-304`;
  `default_config.jsonc:42-43`). Terrain exports as OBJ, PNG, minimap tiles, raw or heightmaps
  (`core.js:305-311`).
- **Network use**: listfile (GitHub `wowdev/wow-listfile` with a kruithne.net fallback), DBDs,
  TACT keys (`wowdev/TACTKeys`), update checks, and a realm list and armory at `marlam.in`
  (`default_config.jsonc:9-28`).
- **Privacy (important).** `allowCacheCollection` defaults to `true` (`default_config.jsonc:127`).
  When a **local** install is opened (`screen_source_select.js:109-128`), a worker scans every
  `_*_` flavour folder of the install. It reads `Cache/WDB/<locale>/*` and
  `Cache/ADB/<locale>/DBCache.bin` (`workers/cache-collector.js:179-236`), hashes executables, and
  uploads the cache files to `https://www.kruithne.net/wow.export/v2/cache/submit`
  (`constants.js:95`; `cache-collector.js:305`) with a random machine ID. This project's rules
  forbid reading `Cache/`. **Either use CDN mode**, where collection only runs for local sources,
  **or turn collection off before opening the local install.** It is not verified whether the
  setting can be reached before a source is selected, so CDN mode is the safer choice.

## 5. Local map pipeline

Milestone 2 built `import.ts --placeholder` (§8) and the local-set checks. Milestone 3 built the
serving side: `vite-local-maps.ts` (§5.7), the art checks and the manifest's `art` section
(`validate.ts`, `lib/art.ts`; §5.3, §5.5), and art entries in `infra/maps` (§5.6 step 7).
**Extraction from the client** was built in Milestone 3b (step 3b.8), on the shared read-only CASC
reader `tools/casc` (D-028; terrain-navigation.md §15): `import.ts --build` writes a developer's
local geometry from the client's own tables (§5.4 (a)), and `convert.ts` writes the **committed**
painted art in `public/maps/art/` (§5.4 (b); D-033). Hand-placed local art (§5.4 (c)) still works
and is checked exactly like any other local art.

### 5.1 Principles

1. **Developer-supplied, local, outside `public/`.** Raw inputs (DB2, CSV, BLP) go in the
   gitignored `assets-source/`, if a developer extracts any by hand; the CASC reader keeps them in
   memory and writes none. Generated local map sets go in the gitignored `local-maps/` at the
   repository root. Neither ever lives under `public/`: gitignore stops commits, not publication,
   and Vite copies everything under `public/` into `dist/` (D-018, F03/LIC-01). `tools/maps` writes
   under `public/` only in two runs: `import.ts --placeholder` (exactly the two committed placeholder
   files, from committed or pinned inputs) and `convert.ts` (the committed painted art in
   `public/maps/art/`, D-033; §5.4 (b)). `import.ts --build` refuses an output under `public/`.
2. **Read-only toward the client.** Tools may read `<wow-install>/Data/` through CASC. Nothing
   may be written under `<wow-install>`, and `WTF/`, `Cache/`, `Logs/` and SavedVariables must
   never be read. Close the game and the launcher first to avoid file locks (the wow.tools.local
   README gives the same advice).
3. **Pinned and reproducible.** The set manifest records product, build, Build Key, tool
   versions/commits, the WoWDBDefs commit and the SHA-256 of every input and output. It holds no
   timestamps, so the same inputs give the same bytes.
4. **The app never requires real maps.** `infra/maps` always loads the committed placeholder
   geometry. It then probes `local-maps/maps.manifest.json`, a URL that only the dev/preview
   plugin serves (§5.7). A deployed site therefore gets a 404 (or an SPA fallback page, which
   counts as absent) and stays placeholder-only. A local set is used only if it passes the frame
   check (§5.6).
   *Superseded by D-018 and F09:* revision 1 probed `public/maps/<build>/maps.manifest.json` and
   compared build strings.
5. **Deployable builds come only from CI on a clean checkout** (D-025). `audit-dist` enforces the
   map rules in ARCHITECTURE §16 (§5.7 below).

### 5.2 Directory layout

```
assets-source/                                  # gitignored except README.md: raw inputs only
  maps/wow_classic_beta/<build>/
    source.json          # developer-written: product, build, buildKey, method, tool versions (no local paths)
    extract-list.txt     # written by import.ts: "fdid;<id>;<relative out path>" lines for TACTTool
    db2/<Table>.db2      # raw DB2 (TACTTool)
    csv/<Table>.csv      # DBC2CSV (or wow.export Data tab) output, header row required
    blp/<fdid>.blp       # raw art and overlay tiles (TACTTool, or wow.export Textures → "BLP (Raw)")
tools/maps/
  README.md
  inputs/db2-rows-1.60.1.70009.json   # committed: the 12 cited DB2 rows and their UiMap rows (§8.3)
  import.ts              # --placeholder: pinned conversion.json + inputs/db2-rows-…json → public/maps/placeholder/ (M2)
                         # --build <b>: the client's UiMap + UiMapAssignment (tools/casc) → local-maps/geometry.local.json (M3b)
  convert.ts             # the client's art tables and BLP tiles (tools/casc) → decode → stitch → crop → overlays
                         #   → WebP → public/maps/art/ (committed, D-033) (M3b)
  validate.ts            # §5.5 checks (placeholder, committed art A1-A5); --activate writes local-maps/maps.manifest.json
  vite-local-maps.ts     # dev/preview-only Vite plugin (§5.7) (M3)
  art.client.test.ts     # 3b.8 checks against the pinned client (skipped with a banner without it)
  lib/                   # M2: checks, local-set, placeholder, notice, db2-rows, make-db2-rows (rows file), pin,
                         #     conversion, csv, git, hash, json, args, inputs; M3: art (L3, the art section);
                         #     M3b: client-tables, art-plan, blp, raster, compose, encode, art-build, art-manifest,
                         #     art-notice, art-checks, local-build, tool-tree; tools/maps/README.md lists them
public/maps/placeholder/                        # committed (§8.2)
  geometry.placeholder.json
  NOTICE.md
public/maps/art/                                # committed and deployed (D-033; §5.3 "Committed art", §5.4 (b))
  <uiMapId>.webp         # one per UiMap (and <uiMapId>-<layer>.webp for a style layer other than 0)
  manifest.json          # pin, build, tool tree hashes, encoder, rules; per file SHA-256, size, UiMap, bounds, input hash
  NOTICE.md              # Blizzard Entertainment as the owner, non-affiliation, D-033 and its four rules
public/maps/terrain/                            # committed and deployed terrain byproducts (D-032; terrain-navigation.md §13)
  <mapId>/zones.json, <mapId>/coast.json, <mapId>/relief.png, manifest.json, NOTICE.md
local-maps/                                     # gitignored except README.md; outside public/; never built or deployed
  maps.manifest.json     # written only by validate.ts --activate; its presence activates the set (§5.3)
  geometry.local.json    # rows with source "local-db2" (§5.3)
  art/<uiMapId>.webp     # or .png: one still image per UiMap, directly in art/ (L3, §5.5)
  taxi.local.json        # optional: local taxi-derived leg times (D-022; SIMULATION TIME-6)
```

`local-maps/` holds one set at a time, from one build (ARCHITECTURE §7.3). Raw inputs for several
builds can sit side by side in `assets-source/`, and a set for another build is rebuilt from
them. Proposal: `import.ts --build` first deletes `local-maps/maps.manifest.json`, so a set being
rebuilt is inactive until `validate.ts --activate` passes again. `infra/maps` also checks file
hashes against the manifest (§5.6), so a file changed after activation makes the set count as
absent. The content of `taxi.local.json` is specified with the simulation (SIMULATION TIME-6).

*Superseded by ARCHITECTURE §6-§7.3 (revision 2):* the first revision-2 draft of this file kept
one folder per set (`local-maps/<product>-<build>/`) with a copied discovery manifest and a
separate `validation.json`. It also proposed copying the two placeholder CSVs to
`assets-source/maps/placeholder-inputs/1.60.1.70009/`. The set now sits directly in
`local-maps/` with the validation result in its manifest, and the placeholder reads the committed
rows file instead of CSVs.

`.gitignore` already has `assets-source/*` with `!assets-source/README.md`, and `local-maps/*`
with `!local-maps/README.md`. It also has `public/maps/*` with `!public/maps/placeholder/`,
`!public/maps/art/` and `!public/maps/terrain/` (the committed outputs). These rules keep stray
files out of Git.
They do not keep anything out of `dist/`, which is why nothing local may be written under
`public/`.

*Superseded by D-018 (F03/LIC-01, F05/LIC-02/PERF-12):* revision 1 wrote local sets to
`public/maps/<build>/{maps.manifest.json, geometry.json, art/…}`, and ARCHITECTURE revision 1 put
the committed geometry at the gitignored path `public/maps/geometry.json`.

### 5.3 File formats

**Geometry** has one schema for both files, parsed by `parseGeometryFile` in `src/geo/geometry.ts`
(pure; the caller reads and `JSON.parse`s the file). This is the committed
`geometry.placeholder.json` as `tools/maps/import.ts --placeholder` writes it (Milestone 2), with
one zone and one continent shown; §8.2 lists its full content. The file is formatted by
`tools/maps/lib/json.ts`: fixed key order, two-space indentation, each assignment row on one line,
LF, final newline.

```jsonc
{
  "_generated": {                                        // first key (DATA_PROVENANCE §7); loaders ignore it
    "by": "tools/maps import --placeholder",
    "upstream": "Questie/QuestieDB@b6f5b07b0acf1c820993cbb0ce2521c912bb4c92 data/Forever/conversion.json; UiMapAssignment and UiMap @ 1.60.1.70009 (CSV SHA-256 79267e8b…, 1f4aac70…) via tools/maps/inputs/db2-rows-1.60.1.70009.json",
    "notice": "NOTICE.md",
    "edit": "do not edit; regenerate with pnpm maps:placeholder"
  },
  "schema": 1,
  "kind": "placeholder",
  "product": "wow_classic_beta",
  "frameHash": "2cb10551b1502b652e4d54922e8b3a1ecb48057fbfb7cf9c77863edd7efea78f",   // §5.6
  "contentHash": "c05a47a276295348a5b40a98dbe13c39ddc6fb4a899c21c821714ebf51c4e6ca", // content hash, below
  "inputs": {                                            // provenance; the parser ignores it
    "questiedb-conversion": {
      "repo": "https://github.com/Questie/QuestieDB",
      "commit": "b6f5b07b0acf1c820993cbb0ce2521c912bb4c92",
      "path": "data/Forever/conversion.json",
      "sha256": "f4477d6c575575152225f2a9d40858029bf9d2d5fdf6b083c06557fce8b5984b",   // LF git blob
      "gitBlob": "7cbcf66b224e77a4ed794f50055bdc68a7abc913",
      "build": "1.60.1.69893",                           // geometry.target_build
      "eraBuild": "1.15.9.69722",                        // geometry.source_build
      "implied": { "orderIndex": 0, "uiMin": [0, 0], "uiMax": [1, 1],
                   "evidence": "QuestieDB tools/dbc/coordinates.py:33-47 (Bounds.from_assignment accepts only …)" }
    },
    "db2-csv": {
      "path": "tools/maps/inputs/db2-rows-1.60.1.70009.json",
      "sha256": "c3dd1fb5615f19ef4614d6504cf47fffbe2582f4eaaebb594fc879341df70dc4",   // LF bytes of the committed file
      "build": "1.60.1.70009",
      "csvSha256": { "UiMapAssignment": "79267e8be8034e47daab14350411b3acc0b1f64e86efc9d821a217497254ca0a",
                     "UiMap": "1f4aac70eaac015b1d2d0ea0faf6e3d7fb2cf7afdf45e5bb6772d9b80a72346b" }
    }
  },
  "maps": {                                              // keys: UiMapIDs, ascending
    "1411": {
      "name": "Durotar", "nameSource": "questiedb-conversion", "type": null, "parent": null,
      "assignments": [
        { "id": 46721, "mapId": 1, "areaId": 14, "orderIndex": 0, "xMin": -1716.6666259766, "xMax": 1808.3332519531, "yMin": -7249.9995117188, "yMax": -1962.4998779297, "uiMin": [0, 0], "uiMax": [1, 1], "source": "questiedb-conversion", "build": "1.60.1.69893" }
      ]
    },
    "1414": {
      "name": "Kalimdor", "nameSource": "db2-csv", "type": 2, "parent": 947,
      "assignments": [
        { "id": 46724, "mapId": 1, "areaId": 0, "orderIndex": 0, "xMin": -11733.299804688, "xMax": 12799.900390625, "yMin": -19733.2109375, "yMax": 17066.599609375, "uiMin": [0, 0], "uiMax": [1, 1], "source": "db2-csv", "build": "1.60.1.70009" }
      ]
    }
  },
  "eraToForever": {                                      // keys: UiMapIDs, ascending
    "1412": { "scaleX": 0.8348002068275978, "offsetX": 7.007453108736848, "scaleY": 0.8349418225477033,
              "offsetY": 13.15387327724201, "fromBuild": "1.15.9.69722", "toBuild": "1.60.1.69893",
              "source": "questiedb-conversion" }
  }
}
```

- `xMin`, `xMax`, `yMin`, `yMax` are `Region_0`, `Region_3`, `Region_1`, `Region_4` (world X is
  north, Y is west; [coordinates §3](research/coordinates.md#3-uimapassignment-the-map-to-world-link)).
  QuestieDB's `bottom`, `top`, `right`, `left` are the same values.
- Numbers are written in ECMAScript's shortest round-trip form of the parsed source decimal, so
  the 49 rows equal `conversion.json` value for value (P1) and the 12 rows equal the rows file's
  decimal strings after `Number()` (P2).
- `type` and `parent` are `null` for the 49 QuestieDB rows, because `conversion.json` does not
  carry them. Surfaces group maps by `mapId`, so the placeholder does not need them. `parent` 0
  is the DB2 value for a root map (947, 1463, 1464, 2665); `areaId` 0 is the DB2 value for
  continent and world rows, which name no AreaTable zone.
- `conversion.json` carries no OrderIndex or UI rectangle. The 49 rows record `orderIndex` 0 and
  `(0,0)-(1,1)` because QuestieDB derives a transform only from such a row
  (`tools/dbc/coordinates.py:33-47` at the pin; the Milestone 0 check found all 49 so in the
  1.60.1.70009 CSV). `inputs.questiedb-conversion.implied` records this, with the evidence.
- `eraToForever` holds `conversion.json` `coefficients` for exactly 1412, 1423, 1433 and 1453 (the
  `changed` transforms). The importer refuses an unchanged transform with non-identity
  coefficients. ARCHITECTURE §6 names this block as the coefficients' source.
- `inputs.db2-csv` names the committed rows file and its hash. `csvSha256` repeats the hashes of
  the full research CSVs that the rows file records (§8.3); the importer does not read the CSVs.
- The placeholder carries **no** `redistribution` key; the parser refuses one.
- **Content hash** (`contentHash`, M2 review code-F2). The frame hash covers only the 49 frames,
  so it cannot notice an edited AreaID, Era coefficient, continent row, name or parent. The content
  hash covers everything a consumer reads from the parsed geometry. `canonicalGeometryContent(g)`
  in `src/geo/content.ts` (pure) builds its string: `JSON.stringify` of
  `["frl-geometry-content", 1, kind, product, maps, era]`, where `maps` is
  `[[uiMapId, name, nameSource, type, parent, rows], …]` ascending by UiMapId, each row is
  `[id, mapId, areaId, orderIndex, xMin, xMax, yMin, yMax, uiMinU, uiMinV, uiMaxU, uiMaxV, source, build]`
  ascending by (OrderIndex, id), and `era` is
  `[[uiMapId, scaleX, offsetX, scaleY, offsetY, fromBuild, toBuild, source], …]` ascending. Numbers
  are the parsed doubles in shortest round-trip form, with no `Math.fround`, so any edit counts. It
  leaves out `frameHash`, `contentHash` and the provenance keys the parser ignores (`_generated`,
  `inputs`, a local set's `build`). The hash is the lowercase hex SHA-256 of the UTF-8 bytes:
  `tools/maps` writes it, `validate.ts` P8 checks it, and `infra/maps` recomputes it with WebCrypto
  and refuses the file on a mismatch, in addition to the frame hash (§5.6). The committed
  placeholder's canonical string is 10,983 bytes and hashes to `c05a47a2…`. A local set may record
  one (informational, like its `frameHash`); a merged geometry records none.

`geometry.local.json` has the same `maps` and `eraToForever` shape with `"kind": "local"`,
`"redistribution": "local-only"`, a top-level `"build"` (the set's client build), rows with
`source: "local-db2"`, an optional informational `frameHash` and `contentHash`, `eraToForever` usually `{}` (a DB2
extraction cannot derive Era coefficients; the committed block is always used), and optionally
`inputs.tables` (`{ "<Table>": { "rows", "sha256" } }`), which activation copies into the
manifest. Milestone 3's `import.ts --build` writes it; Milestone 2's `validate.ts` checks it.

**Set manifest** (`local-maps/maps.manifest.json`). `validate.ts --activate` writes it only after
every local-set check passes (§5.5); its presence is what makes the set active (ARCHITECTURE
§7.3). A failing `--activate` removes an existing manifest. File paths are relative to
`local-maps/`. `set` is a label, `<product>-<build>`. As built (`tools/maps/lib/local-set.ts`):

```jsonc
{ "schema": 1, "redistribution": "local-only", "set": "wow_classic_beta-1.60.1.70124",
  "product": "wow_classic_beta", "build": "1.60.1.70124", "buildKey": "dd3dfc2881c407299f46c2aaf34c130b",
  "source": { "method": "tacttool-local | tacttool-cdn | wow.export-gui",
              "tools": { "TACTTool": "<commit/version>", "DBC2CSV": "<version>" },
              "wowdbdefs": "cf84e010f84ba9c8d48fd61730f92bf0d8f2b1cd" },     // from assets-source/…/source.json
  "generator": { "repoCommit": "<sha> | null", "node": "22.x" },
  "tables": { "UiMapAssignment": { "rows": 61, "sha256": "…" } },   // geometry.local.json inputs.tables, or null (unknown)
  "frameHash": "…",                  // recomputed by validate.ts; infra/maps recomputes it again
  "geometry": { "file": "geometry.local.json", "sha256": "…" },   // LF bytes
  "art": {                           // Milestone 3: one entry per art file that passed L3; {} without art
    "1411": { "file": "art/1411.webp", "contentType": "image/webp", "width": 1002, "height": 668,
              "sha256": "…",           // the file's bytes as they are (images are never LF-normalised)
              "bounds": { "assignment": 46721, "mapId": 1, "xMin": -1716.6666259766, "xMax": 1808.3332519531,
                          "yMin": -7249.9995117188, "yMax": -1962.4998779297 } } },   // the UiMap's row in geometry.local.json
  "taxi": { "file": "taxi.local.json", "sha256": "…" },          // only when the file exists
  "validation": { "passed": true, "checks": ["L0", "L1", "L2", "L3", "L4", "L7"],
                  "notRun": { "L5": "no local TaxiNodes CSV given (--taxi-nodes <csv>)", "L6": "…" } } }
```

`redistribution` is always `local-only`, in the manifest, `geometry.local.json` and
`taxi.local.json` alike, and `audit-dist` fails on any file that carries it (§5.7). Revision 1's
`generatedAt` field is dropped because it made identical inputs produce different bytes.

**The `art` section** (Milestone 3; `tools/maps/lib/art.ts`) replaces revision 2's planned
`images` block. It is keyed by UiMapID, ascending. `file` is relative to `local-maps/` and is
always `art/<uiMapId>.png` or `.webp`; `contentType`, `width` and `height` are read from the
file's own headers (`src/infra/maps/image-header.ts`, shared with the app: no decoding, no new
dependency); `sha256` covers the file's bytes. `bounds` is the world rectangle the whole image
covers: the UiMap's only row in `geometry.local.json` (assignment ID, world map and the four
edges, as the row writes them), so the image is one axis-aligned rectangle on one world surface
(coordinates §4.1, §14.1). A UiMap with several rows (Azeroth 947, one per continent) or a partial
UI rectangle has no art entry; its art needs the deferred UiSurface. `tileFdids` (the tiles an
image was stitched from) is recorded by the committed art's manifest (below), not in a local
set; hand-placed art has none to record. A manifest written before Milestone 3 has `images: {}`
and no `art`; the app reads that as "no art".

**Committed art** (`public/maps/art/manifest.json`, Milestone 3b; `tools/maps/lib/art-manifest.ts`).
`convert.ts` writes it with the images and `NOTICE.md`; there is no timestamp, so the same inputs,
tools and encoder give the same bytes. Abridged:

```jsonc
{ "_generated": { "by": "tools/maps convert", "notice": "NOTICE.md", "edit": "do not edit; …" },
  "schema": 1, "kind": "map-art",
  "artwork": { "owner": "Blizzard Entertainment", "notice": "NOTICE.md", "decision": "D-033", "what": "…" },
  "client": { "product": "wow_classic_beta", "version": "1.60.1.70124", "buildKey": "dd3dfc2881c407299f46c2aaf34c130b" },
  "tool": { "toolTreeHash": { "tools/casc": "<git tree id>", "tools/maps": "<git tree id>" }, "treeMethod": "git",
            "layouts": "WoWDBDefs cf84e010… (tools/casc/layouts.ts, build 1.60.1.70009)",
            "encoder": { "name": "sharp", "sharp": "0.35.4", "libvips": "8.18.6", "libwebp": "1.6.0", "platform": "win32-x64" },
            "webp": { "quality": 80, "alphaQuality": 100, "effort": 6, "smartSubsample": true, "preset": "drawing" } },
  "rules": { "phase": "…", "tiles": "…", "overlays": "…", "decoding": "…", "inputHash": "…", "pixelsSha256": "…" },
  "tables": [ { "table": "UiMapArtTile", "fileDataId": 1957210, "ckey": "<MD5>", "rows": 1672 } ],   // the 8 DB2s read
  "skipped": { "uiMaps": [], "overlays": [ { "uiMapId": 1434, "overlayId": 5252, "reason": "no WorldMapOverlayTile rows" } ] },
  "totals": { "files": 60, "bytes": 9019600, "tiles": 687, "overlays": 572, "overlayTiles": 972 },
  "files": [
    { "path": "1411.webp", "uiMapId": 1411, "name": "Durotar", "uiMapType": 3, "uiMapArtId": 2169, "styleId": 1, "layer": 0,
      "contentType": "image/webp", "width": 1002, "height": 668, "bytes": 183520, "sha256": "…",
      "pixelsSha256": "…",   // SHA-256 of "frl-rgba8 <w> <h>\n" + the composed RGBA, before encoding
      "inputHash": "…",      // SHA-256 over "<FileDataID> <CKey>\n" lines of its BLP tiles and the 8 tables (tools/casc/input-hash.ts)
      "tiles": [8073638, 8074081, …],                                  // base tiles, row-major
      "overlays": [ { "id": 5358, "areaIds": [370], "tiles": [8073637] }, … ],
      "bounds": { "assignment": 46721, "mapId": 1, "xMin": -1716.6666259765625, "xMax": 1808.333251953125,
                  "yMin": -7249.99951171875, "yMax": -1962.4998779296875 },   // null without a single full-rectangle row (947)
      "assignments": [46721] } ] }
```

- `files[].path` and `files[].sha256` are what the dist audit's image allowlist reads (§5.7).
- `bounds` is the UiMap's single `UiMapAssignment` row with OrderIndex 0 and the full UI rectangle,
  as the float32 values the DB2 stores (they equal the placeholder's rows after `Math.fround`, A4).
  Azeroth 947 has one row per continent, so it has no `bounds` (its art needs the deferred
  UiSurface, as in a local set).
- `pixelsSha256` does not depend on the encoder: a rebuild on another platform or with another
  sharp can tell an encoder difference (same pixels, different bytes) from an input or tool change.
- The full per-file (FileDataID, CKey) lists, compose statistics and gzip sizes go to the gitignored
  `generated/maps-art-report.json`.

### 5.4 Extraction steps (local sets; extraction is Milestone 3b)

**(a) Metadata (scripted, preferred).** None of these commands has been run yet; they come from
the tools' READMEs.

1. Write `assets-source/maps/wow_classic_beta/<build>/source.json` by hand.
2. Extract the DB2s read-only from the local install, with the product pinned. `-d` is a
   read-only base directory:
   `TACTTool -p wow_classic_beta -d "<wow-install>" -m list -i extract-list.txt -o assets-source/maps/wow_classic_beta/<build>`,
   with lines such as `fdid;1957219;db2/UiMapAssignment.db2` (FDIDs in §3). The exact `fdid;` list
   syntax is UNVERIFIED. Without `-d`, the same build is read from the CDN.
3. `DBC2CSV <dir>/db2` → `csv/*.csv`, using WoWDBDefs at the pinned commit. Do **not** pass any
   `DBCache.bin`: it comes from `Cache/`, which is forbidden.
4. `pnpm tsx tools/maps/import.ts --build 1.60.1.70009` reads the CSVs **by column name** and
   fails on missing columns. It deletes `local-maps/maps.manifest.json` (§5.2), writes
   `local-maps/geometry.local.json` (rows `source: "local-db2"`) and appends every art and overlay
   tile FDID to `extract-list.txt`.

*As built (Milestone 3b):* steps 2-4 are replaced by one command that needs neither TACTTool nor
DBC2CSV. `pnpm tsx tools/maps/import.ts --build 1.60.1.70124 [--out <dir>] [--check]` opens the
client through `tools/casc` (read-only; `.build.info` and `Data/` under `WOW_INSTALL`, pinned to
1.60.1.70124 and its build key since 2026-09-30, 1.60.1.70009 before: any other build is refused), reads `UiMap` and `UiMapAssignment`
with `readDb2` (every column equals the research CSVs, `tools/casc/casc.client.test.ts`), removes
`local-maps/maps.manifest.json` and writes `local-maps/geometry.local.json`: 60 UiMaps and 61 rows,
the values as the float32s the DB2 stores, `inputs.tables` with each table's rows, FileDataID and
CKey. Rows with a Z or WMO restriction are refused, as the placeholder importer refuses them. It
refuses an output under `public/`. The set passes L0-L4 and L7 as built: its frame hash is the
committed `2cb10551…` and every shared row is identical (`tools/maps/art.client.test.ts`), so the
client read reproduces the committed placeholder frames. Nothing is written to `extract-list.txt`:
`convert.ts` reads the tiles through the same reader.

**(b) Art (scripted; built in Milestone 3b with the CASC reader; committed, D-033).**

*Superseded by D-033:* the earlier plan fetched the tiles with TACTTool, wrote the art only under
`local-maps/art/` and suggested porting wow.export's `casc/blp.js` and `3D/loaders/DXTDecoder.js`.
As built, `convert.ts` reads the tiles through `tools/casc`, writes the committed
`public/maps/art/`, and decodes BLP with this project's own decoder (nothing ported,
THIRD_PARTY_NOTICES "Ported code").

`pnpm tsx tools/maps/convert.ts [--out <dir>] [--report <file>] [--check]`, with the pinned client
at `WOW_INSTALL`:

1. **Tables** (`lib/client-tables.ts`): `UiMap`, `UiMapAssignment`, `UiMapXMapArt`, `UiMapArt`,
   `UiMapArtStyleLayer`, `UiMapArtTile`, `WorldMapOverlay` and `WorldMapOverlayTile` through
   `readDb2`, each required complete (none has an encrypted section at the pin).
2. **Plan** (`lib/art-plan.ts`, pure). For every UiMap: its phase-0 `UiMapXMapArt` row (one per
   UiMap at the pin; phased-only art would be skipped and reported), the art's style layers (one
   image per layer: `<uiMapId>.webp` for layer 0, `<uiMapId>-<layer>.webp` otherwise), and:
   - base tiles at `(ColIndex · TileWidth, RowIndex · TileHeight)` on a `LayerWidth × LayerHeight`
     canvas, so edge tiles are cropped; every cell of the tile grid must have exactly one tile;
   - the **fully explored** map: every `WorldMapOverlay` of the art with `PlayerConditionID` 0 (all
     580 at the pin), in ID order, its `WorldMapOverlayTile` rows at `(OffsetX + ColIndex ·
     TileWidth, OffsetY + RowIndex · TileHeight)`, drawn at the file's own pixel size and cut to the
     overlay rectangle `(OffsetX, OffsetY, TextureWidth, TextureHeight)`. An overlay without tiles
     is skipped and listed in the manifest (8 at the pin: 5551 in 1412, 5252 in 1434, 5545-5549 in
     2521, 5550 in 2548).
3. **Decode** (`lib/blp.ts`): BLP2 mip 0 to straight RGBA: palette (1-, 4- and 8-bit alpha), DXT1
   (with and without 1-bit alpha), DXT3, DXT5 and B8G8R8A8; arithmetic only (D-012). At the pin
   every one of the 1,659 tiles is DXT (345 DXT1, 371 DXT1 with 1-bit alpha, 943 DXT5), none
   encrypted or missing; base tiles are 256 × 256 (512 × 512 for style 4) and must be exactly the
   layer's tile size.
4. **Compose** (`lib/compose.ts`, `lib/raster.ts`): source-over with integer rounding. The client's
   Lua sizes an edge overlay tile file as the next power of two from 16; 19 of the 972 overlay
   tiles are 32 px on a side where that rule gives 16. They are drawn at their pixel size (the
   visible part is at most 16 px), and counted in the report. Every composed image is opaque at
   the pin.
5. **Encode** (`lib/encode.ts`): lossy WebP through `sharp` 0.35.4 (libvips 8.18.6, libwebp 1.6.0;
   a development dependency, not shipped), one thread, no metadata, the alpha plane dropped for an
   opaque image. The settings were chosen by measurement on all 60 images (gzip-6 total, mean PSNR
   against the composed pixels): quality 75 → 7.21 MB; 78 → 8.37 MB (33.11 dB); **80 with the
   `drawing` preset and smart subsampling → 9.02 MB (33.65 dB)**; 80 default preset → 9.18 MB
   (33.59 dB); 82 → 10.11 MB (34.10 dB); 85 → 11.68 MB; 88 → 13.73 MB; 90 → 15.41 MB. Quality 80
   leaves 25% of the 12 MB budget free; 85 and above would not fit with per-file tolerance.
6. **Write**: the images, `manifest.json` (§5.3 "Committed art") and `NOTICE.md` into
   `public/maps/art/` (stale `<uiMapId>.webp` files removed), refusing to write over the budget;
   the report to the gitignored `generated/maps-art-report.json`. `--check` rebuilds in memory and
   compares instead of writing.

**Measured** (this machine, Ryzen 7 7800X3D, Node 22.13.1, warm cache; `convert.ts` wall time):
27 s for all 60 images (CASC open 0.9 s, tables and compose about 10 s, WebP effort 6 about
15 s). Output: 60 images, 9,019,600 B; with the manifest (98,322 B, 22,324 B gzip-6) and NOTICE
9,047,639 B gzip-6, 75.4% of the `art` budget; largest image 1438 Teldrassil, 202,013 B gzip-6;
the three 512 × 512 maps 40-46 kB. `tools/maps/art.client.test.ts` recomposes all 60 images to
the recorded `pixelsSha256` and input hashes and re-encodes three to the committed bytes.

**Local sets.** `pnpm tsx tools/maps/validate.ts --activate` runs the §5.5 local-set checks,
hashes every set file, and on a pass writes `local-maps/maps.manifest.json` (§5.3), which activates
the set. It takes the build from `geometry.local.json`, and product, method and tool versions from
that build's `source.json`. A developer who wants art in a local set copies committed images into
`local-maps/art/`; the committed art itself needs no activation.

**(c) Manual fallback (wow.export GUI).**

1. Start wow.export 0.2.19. **Choose "CDN" → Beta: World of Warcraft Classic at the pinned build
   (1.60.1.70124 since 2026-09-30; 1.60.1.70009 before)**, or
   disable cache collection (§4.1) before selecting the local folder.
2. Data tab: select the §1 tables → Export as CSV → copy to `csv/`.
3. Zones tab (optional): export zone PNGs. They match the `convert.ts` output for zones, but
   there are no continents and no sidecar. Save each one as `local-maps/art/<uiMapId>.png`. L3
   checks it like any other art file (name, headers, `LayerWidth × LayerHeight`, placement), and
   `--activate` lists it in the manifest. Since Milestone 3b `convert.ts` makes this unnecessary.
4. Textures tab: export the tile FDIDs as "BLP (Raw)" into `blp/`, then run `convert.ts` as in (b).
5. Record "wow.export-gui" and the version in `source.json`. This path is less reproducible: its
   DBDs are unpinned and it needs a GUI.

**Recommendation.** For (a), use `import.ts --build` on the CASC reader, checked against the
committed geometry by the frame hash (§5.6); TACTTool + DBC2CSV or the wow.export Data tab remain
manual fallbacks. wago.tools is a manual cross-check only (D-011). For (b), use `convert.ts`, so
that zones, continents and Azeroth go through one code path. Use the wow.export Zones tab only as a
visual reference.

### 5.5 `validate.ts` checks

**Placeholder checks** run in CI from Milestone 2 (`pnpm maps:validate`, implemented in
`tools/maps/validate.ts` and `tools/maps/lib/checks.ts`). Any failure fails the build. The
placeholder is first rebuilt in memory from the pinned inputs; every check then compares the
committed file with the inputs directly, not only with the importer's output.

| # | Check |
|---|---|
| R1 | Both committed files are byte-identical to a fresh `import.ts --placeholder` (reproducibility; also `import.ts --placeholder --check`). |
| P0 | The committed file parses (`parseGeometryFile`). |
| P1 | Exactly 49 UiMaps have `source: "questiedb-conversion"` rows. They are the `ui_map_id`s of `conversion.json` `geometry.transforms`, and each row equals its `target_bounds`, `target_assignment_id`, `map_id` and `area_id` at the pinned commit (with OrderIndex 0, the full UI rectangle and build `target_build`); the name equals `target_name`, type and parent are null. The input hash is the LF git blob (`f4477d6c…`, ARCHITECTURE §5.1), required by the pin (`tools/questiedb/upstream.json` when it records one, else DATA_PROVENANCE §4.1). |
| P2 | Exactly the 12 `db2-csv` rows of §8.3 exist, 12 rows for 11 UiMaps because Azeroth 947 has two (assignment IDs 46724, 46725, 46774, 46775, 46784, 46785, 69032, 69208, 69219, 69323, 69778, 69852). Each row, and each of the 11 UiMaps' name, type and parent, equals its entry in `tools/maps/inputs/db2-rows-1.60.1.70009.json`, and that file's SHA-256 (LF bytes) equals `inputs.db2-csv.sha256`; `csvSha256` equals the rows file's source hashes; the rows file equals the §8.3 reference table. CI needs no CSV and no network request. |
| P3 | Every row has `source` and `build` (`questiedb-conversion` rows at 1.60.1.69893, `db2-csv` rows at 1.60.1.70009), and no other UiMap or row is present (60 UiMaps, 61 rows). |
| P4 | `frameHash` equals the value recomputed from the 49 rows (§5.6), and, when the file was built at the reference commit `b6f5b07b`, also the §5.6 reference `2cb10551…`. |
| P5 | `eraToForever` has exactly 1412, 1423, 1433 and 1453, each equal to `conversion.json` `coefficients`, and the other 45 `conversion.json` coefficients are identity. |
| P6 | `git ls-files --error-unmatch public/maps/placeholder/geometry.placeholder.json public/maps/placeholder/NOTICE.md` succeeds (F05). `audit-dist` requires both files in `dist/maps/placeholder/`, byte-equal to the tracked files (PERF-12). `--skip-tracking` skips P6 (reported as SKIP) before the files are first committed. |
| P7 | Isotropy (coordinates §4.1): `(Ymax−Ymin)/(Xmax−Xmin)`, scaled by the UI rectangle, equals the art aspect within 0.2%: 1.5 (1002 × 668 art) for every UiMap except 1463 and 1464 (1.0: 512 × 512 art, square regions); 2665 (a 1.5 region on 512 × 512 art) is exempt. All 60 applicable rows pass. |
| P8 | `contentHash` equals the SHA-256 of `canonicalGeometryContent` of the committed file (§5.3), recomputed exactly as `infra/maps` does at load, and equals a fresh import's content hash. A hand edit that also rewrites `contentHash` passes the loader's self-check but fails P8 (and P1, P2 or P5). |

**Committed art checks** (Milestone 3b; `tools/maps/lib/art-checks.ts`) run in CI with the
placeholder checks (`pnpm maps:validate`); they need no client. `convert.ts --check` is the rebuild
from the client, and `tools/maps/art.client.test.ts` recomposes every image to its recorded pixel
hash.

| # | Check |
|---|---|
| A1 | `public/maps/art/manifest.json` and `NOTICE.md` exist; the manifest parses (schema, `kind: "map-art"`, Blizzard Entertainment as the owner, tool tree hashes, tables, every file entry well formed and in UiMap order) and records the pinned client build and build key. |
| A2 | Every listed image exists with its recorded byte count and SHA-256, and its headers (`readImageHeader`, shared with `infra/maps`) give a still WebP of the recorded size; no unlisted file is in the folder. |
| A3 | `NOTICE.md` equals the text regenerated from the manifest (`lib/art-notice.ts`). |
| A4 | Against the committed placeholder: every placeholder UiMap has an image or a recorded reason (60 of 60 have images); every image's UiMap is in the placeholder with its art size (1002 × 668; 512 × 512 for 1463, 1464, 2665); `bounds` equal the UiMap's single full-rectangle row after `Math.fround`, and are null exactly where there is no such row (947). |
| A5 | The folder is within the `art` budget: gzip-6 of every file ≤ 12,000,000 B (9,047,639 B at the pin). The dist audit also gates each file against its baseline + 10%. |

**Local-set checks** run on the developer's machine, in `validate.ts --local [dir]` (report
only) or `validate.ts --activate` (writes the manifest on a pass, removes an existing one on a
failure), implemented in `tools/maps/lib/local-set.ts` and tested with synthetic sets. They run
only after the placeholder checks pass. Any failure leaves the set inactive.

| # | Check |
|---|---|
| L0 | `geometry.local.json` exists and parses as a local geometry: `"kind": "local"`, `"redistribution": "local-only"`, a top-level `build`, rows `local-db2`, the placeholder's product. |
| L1 | Every Type 3/6 UiMap with art has exactly one `OrderIndex 0` assignment with `UiMin (0,0)`, `UiMax (1,1)`, WMO 0 and Z `±1e6`. Anything else is reported. *As built (Milestone 2):* the geometry format has no WMO or Z columns, so L1 checks the OrderIndex 0 row and the UI rectangle of every Type 3/6 UiMap; WMO and Z are for `import.ts --build` to check when it reads the CSVs (Milestone 3), as the placeholder importer already does for the 12 rows. |
| L2 | Isotropy: `(Ymax−Ymin)/(Xmax−Xmin)` equals `LayerWidth/LayerHeight` to within 0.2%. *As built (Milestone 2):* against the same art-aspect table as P7, since art dimensions are unknown before Milestone 3. |
| L3 | Image dimensions equal `LayerWidth × LayerHeight`, and every tile listed in `extract-list.txt` decoded. (`validate.ts` then hashes the set files into the manifest; `infra/maps` checks those hashes at runtime, §5.6.) *As built (Milestone 3, `lib/art.ts`):* every file directly in `art/` must be named `<uiMapId>.png` or `<uiMapId>.webp` (no subfolders or links; `Thumbs.db`, `desktop.ini` and `.DS_Store` are skipped), one per UiMap; its PNG or WebP headers must parse and match the extension, and animated images are refused (headers only: chunk structure, IHDR, VP8/VP8L/VP8X; nothing is decoded, and PNG CRCs are not checked, the SHA-256 is the integrity check); the UiMap must be in `geometry.local.json` with exactly one row, OrderIndex 0 with the full UI rectangle; the size must be the UiMap's art size (1002 × 668; 512 × 512 for 1463, 1464, 2665: the P7 table, until `import.ts --build` reads `UiMapArtStyleLayer`); and the image aspect must equal the row's world aspect within 0.2% (2665 exempt). The tile check is not needed for a local set: `convert.ts` fails closed on any tile that does not decode, and the committed art's A1-A5 cover its output. A geometry-only set passes. |
| L4 | **Frame compatibility** (§5.6). The frame hash of the set's rows for the 49 shared UiMaps equals the committed `frameHash`, and every row for a UiMap the placeholder already has is identical to the committed row (§5.6 step 4). On a hash mismatch the build's geometry has changed, so QuestieDB percentages would be read in the wrong frame. On a shared-row mismatch, resolution would differ between machines. Either way the set is not activated. *Superseded by D-018:* revision 1 compared DB2 bounds with `target_bounds` directly; the hash is the same test in a form `infra/maps` can also run. |
| L5 | Every `TaxiNodes` position on MapID *m* falls inside 0..100 of at least one zone on *m*. *As built:* runs with `--taxi-nodes <TaxiNodes.csv>` (a local CSV at the set's build, read by column name: `ID`, `ContinentID`, `Pos_0`, `Pos_1`) against the merged geometry's zone rows (AreaID > 0). Without the CSV, L5 and L6 are recorded under `validation.notRun` in the manifest and do not block activation. |
| L6 | Landmarks: each QuestieDB flight master is within 30 yd of a TaxiNode on the same MapID. Six landmarks (`TAXI_LANDMARKS` in `tools/maps/lib/local-set.ts`): nodes 2, 22 and 23 (Stormwind, Thunder Bluff, Orgrimmar) at 11.9, 3.6 and 2.6 yd, and nodes 5 (Lakeshire), 67 and 68 (Light's Hope Chapel) at 7.0, 4.9 and 3.8 yd. Four of them sit on three of the four changed frames (1453, 1433, 1423); reading their Forever percent in the Era frame gives 108.9, 107.2, 450.5 and 445.0 yd ([coordinates §9](research/coordinates.md#9-independent-cross-check-flight-masters-vs-taxinodes)). The TaxiNodes inputs are local. The six landmark rows are cited client values that `src/geo` tests pin (D-022, ARCHITECTURE §6). |
| L7 | World ↔ percent round-trip error is below 1e-9 for all spawn points. *As built (Milestone 2):* on a 5 × 5 grid of percent points, inside and outside 0..100, on every row of the merged geometry. |
| L8 | *Milestone 3, reports only (`--local` without `--activate`):* an existing `maps.manifest.json` still describes the files: the geometry's SHA-256, every art file listed with the same hash, type, size and bounds, no unlisted art, and the taxi file's hash. It names each difference and asks for `--activate` again. Without a manifest it is recorded as not run; `--activate` never runs it, because it replaces the manifest. |

### 5.6 Frame compatibility (D-018, F09)

**Frame set F.** F is the 49 UiMaps in `conversion.json` `geometry.transforms` at the pinned
QuestieDB commit: 1411-1413 and 1416-1461. The dataset's spawn percentages are in these frames
(data frame 1.60.1.69893).

**Canonical form** (ratified by ARCHITECTURE §6; Milestone 2 pins it in `src/geo` tests):

- Build one tuple per UiMap in F, sorted ascending by UiMapID:
  `[uiMapId, mapId, xMin, xMax, yMin, yMax, uiMin_u, uiMin_v, uiMax_u, uiMax_v]`. Assignment IDs
  are excluded, because they are provenance, not frame.
- Pass every coordinate through `Math.fround` (the two IDs are integers and are written as they
  are). DB2 stores float32, so exporters that print
  different decimal strings for the same float (wago CSV, DBC2CSV, wow.export) agree. The largest
  gap between a Milestone 0 CSV value and its float32 is 5e-10.
- Serialise the array with `JSON.stringify` (ECMAScript number formatting, no whitespace). The
  hash is the lowercase hex SHA-256 of its UTF-8 bytes.
- A UiMap in F without exactly one `OrderIndex 0` row makes the geometry incompatible.
- `src/geo` builds the canonical string (pure: `canonicalFrameTuples` and `canonicalFrameString`
  in `src/geo/frame.ts`); `infra/maps` hashes it with WebCrypto; `tools/maps` hashes it with
  `node:crypto`. The committed placeholder reproduces the reference below (4,030 bytes of JSON,
  `2cb10551…`; `tools/maps/placeholder-geometry.test.ts`).

**Reference values** at the Milestone 0 inputs:

| Input | Frame hash (SHA-256) |
|---|---|
| `conversion.json` `target_bounds` at `b6f5b07` (4,030 bytes of JSON) | `2cb10551b1502b652e4d54922e8b3a1ecb48057fbfb7cf9c77863edd7efea78f` |
| `UiMapAssignment` CSV at 1.60.1.69893, and the one at 1.60.1.70009 | same value (all three agree) |
| `UiMapAssignment` CSV at Era 1.15.9.69722, same 49 UiMaps (negative vector) | `b94bf685200c28a7edc2720d995082ea32bbdcc5398ecc3c08dc33436a852cfb`, differing exactly at 1412, 1423, 1433, 1453 |

**Runtime behaviour** (`infra/maps`, ARCHITECTURE §7.3):

1. Load `maps/placeholder/geometry.placeholder.json`. It is always required. Its frame hash and
   its content hash (§5.3) are recomputed with WebCrypto and must equal the ones it records;
   otherwise the file is refused.
2. Fetch `local-maps/maps.manifest.json`. A 404 (every deployed site), a non-JSON body (for
   example an SPA fallback page served with status 200) or a schema failure means "no local set";
   this is not an error.
3. Fetch `local-maps/geometry.local.json`, verify its SHA-256 against the manifest, and recompute
   the frame hash. Do not trust the manifest's `frameHash`.
4. If the hash equals the committed one, check the rows for UiMaps outside F (ARCHITECTURE §6):
   - a UiMap the committed file lacks is **added**;
   - a UiMap the committed file already has (one of the 11 `db2-csv` UiMaps) must have
     **identical** rows: the sorted lists of canonical tuples (one tuple per row, as above) are
     equal after `Math.fround`. Assignment IDs, `source` and `build` are provenance and are not
     compared. *As built* (`mergeLocalGeometry`, `src/geo/frame.ts`): each row's key is the tuple
     plus its OrderIndex and AreaID, because row selection and zone attribution use them, and the
     comparison also covers the frame-set UiMaps, so extra rows for one of them are rejected too;
   - if any such row differs, the whole local set is rejected as a frame mismatch (step 5).

   Resolution therefore never differs between machines for a UiMap both know.
   *Superseded by ARCHITECTURE §6:* this step first proposed that local rows could replace the
   committed `db2-csv` rows for the same UiMap on that machine, with each replaced UiMap listed
   in the layer panel.
5. If the hash differs, or a shared row differs, keep the placeholder and show a banner naming
   the local build and the UiMaps whose frames differ.
6. The layer panel always shows both builds: the data frame and placeholder rows ("data frame
   1.60.1.69893; placeholder: 49 frames @ 69893, 12 rows @ 70009") and the local set ("local set
   1.60.1.70009: compatible, N UiMaps added", "…: incompatible, using placeholder", or "none").
   *As built (Milestone 3):* a compatible set with art adds ", art for N UiMaps (verified when
   drawn)", or "; local art refused (…)".
7. *Milestone 3 (`src/infra/maps/local-art.ts`):* for a **compatible** set only, the manifest's
   `art` section is parsed and checked against the verified `geometry.local.json`: every entry's
   file name, type and size must be well formed, and its `bounds` must equal its UiMap's single
   full-rectangle row exactly. One bad entry refuses the whole section (the geometry is still
   used), because the manifest is written by one tool run. `LoadedGeometry.art` then holds
   `entries` (`{ uiMapId, mapId, bounds, url, width, height, contentType, sha256 }`, `bounds` in
   world yards on `mapId`) and `load(uiMapId)`. **Verification is lazy, for every set size:** the
   first `load` of a UiMap fetches its file (`no-store`), checks the SHA-256 against the manifest
   and the headers against the recorded type and size, and resolves to the verified bytes as a
   `Blob`; the map draws that `Blob` through an object URL, so what is drawn is what was verified
   (the plain `url` is never drawn). Results are memoised per UiMap; a failed request is tried
   again at the next draw. Hashing all art at load was rejected: megabytes of downloads and hashing
   would land in the startup budget (ARCHITECTURE §14) for surfaces that may never be shown, and
   one path for all set sizes is simpler to test than a size threshold. A changed file is refused
   at its draw (`changed`); a file that matches its hash but not the recorded size is `malformed`.

### 5.7 Serving local maps; keeping them out of `dist/` (D-018, D-025; F03/LIC-01)

`tools/maps/vite-local-maps.ts` is a Vite plugin that:

- registers middleware only through `configureServer` (dev) and `configurePreviewServer`
  (preview), serving `GET <base>local-maps/*` from `<repo>/local-maps/`;
- has no build hooks (no `generateBundle`, `writeBundle` or copy step), so `vite build` never
  emits the folder. `publicDir` stays `public/`, and `local-maps/` is never inside it;
- resolves each request inside `local-maps/` and refuses path traversal. It returns 404 for
  missing files, sets `Cache-Control: no-store`, and sends WebP/JSON content types.

*As built (Milestone 3):* the plugin (`localMaps()`, wired in `vite.config.ts`) has only
`configResolved`, `configureServer` and `configurePreviewServer`. `configResolved` refuses, in
every command, a folder that overlaps `publicDir` or the build's `outDir`. A relative base
(`./`) serves at `/`, as Vite's own servers do. Requests: `GET` and `HEAD` only (405 otherwise);
`.`/`..` segments, hidden names, backslashes, colons, NUL (403) and undecodable escapes (400) are
refused, and so is a link that resolves outside the folder; folders and missing files (the whole
folder included) answer 404 from the plugin, never the SPA's `index.html`. Content types: JSON,
WebP, PNG, Markdown, text and CSV, otherwise `application/octet-stream`; every answer has
`Cache-Control: no-store` and `X-Content-Type-Options: nosniff`. Its tests
(`tools/maps/vite-local-maps.test.ts`) drive a real dev server, `vite build` and `vite preview`
of a throwaway project, and check that the build output has no local-maps file and that the dist
audit flags a dist that does.

`vite preview` therefore shows local maps on the developer's machine, while the built `dist/` it
serves contains none.

`tools/build/audit-dist.ts` fails the build if `dist/`:

- contains `local-maps/`;
- contains any `maps.manifest.json` or JSON file with `"redistribution": "local-only"` (which
  also catches a copied `geometry.local.json` or `taxi.local.json`);
- contains images outside an allowlist of app assets, by extension and, since Milestone 3, by
  content: PNG, JPEG, GIF, WebP and AVIF/HEIF signatures under a name that does not declare them
  are refused as images, and BLP texture content under any other name as a client file
  (`checkFileSignature`, `tools/build/lib/audit.ts`). *Since Milestone 3b (D-033, the one image
  allowlist of terrain-navigation.md §13.3):* an image may also ship under `maps/art/` or
  `maps/terrain/` (`mapFolders` in `tools/build/dist-requirements.json`), only when that folder's
  `NOTICE.md` and `manifest.json` ship with it and the manifest lists the file with its SHA-256;
  every other file of those folders must be listed too, every listed file must be present, and once
  the repository has the folder's manifest the folder must ship. Each folder has its own gzip-6
  budget with per-file baselines + 10%: `art` ≤ 12 MB, `terrain` ≤ 600 kB (D-034 item 4);
- contains local paths, `.cache` references, `.lua`, `.blp` or source maps;
- contains files over budget;
- lacks a required notice file;
- lacks `maps/placeholder/geometry.placeholder.json` or `maps/placeholder/NOTICE.md` (P6).

Deployable builds come only from CI on a clean checkout, and release builds refuse a dirty tree
(D-025, ARCHITECTURE §16).

## 6. Coordinate transforms (summary)

Full derivations and numeric examples: [research/coordinates.md](research/coordinates.md).
Implemented in Milestone 2 by the pure `src/geo` module; its API and tests are listed in
[coordinates §15](research/coordinates.md#15-coordinate-model-srcgeo).

- **Storage (D-017).** Dataset spawns ship exactly as QuestieDB publishes them: 0-100 zone
  percent, 2 dp, keyed by AreaTable ID, in the Forever frame. `infra/data` converts them once at
  load through `src/geo` and the committed geometry, so runtime domain types see `WorldPoint`s. A
  route `Location` stores the authored `SourcedPoint` (world with an optional `uiMapId` hint, or
  zone percent with its frame; both with optional lexemes), a label and an optional arrival
  `radius` in yards (`src/domain/points.ts`). `resolve(location, geometry)` derives the world
  point at runtime; a `null` result means unknown travel plus an info issue, never zero distance
  (ARCHITECTURE §6).
  *Superseded by D-017:* D-004's "store everything as `WorldPoint`" and revision 1's build-time
  conversion.
- **World** (per `Map.ID`, yards): `+X` north, `+Y` west. On every map, right is east
  (decreasing Y) and down is south (decreasing X).
- **`UiMapAssignment.Region`**: `Region_0/1/2` are min X/Y/Z, and `Region_3/4/5` max X/Y/Z.
  QuestieDB's `left = Region_4`, `right = Region_1`, `top = Region_3`, `bottom = Region_0`.
- **Zone percent ⇄ world** (zone rows have `UiMin 0,0` and `UiMax 1,1`):

  ```
  x% = 100·(Ymax − Y)/(Ymax − Ymin)        Y = Ymax − x%/100·(Ymax − Ymin)
  y% = 100·(Xmax − X)/(Xmax − Xmin)        X = Xmax − y%/100·(Xmax − Xmin)
  ```

- **General form** (Azeroth 947 sub-rectangles):
  `u = UiMin_0 + (Ymax − Y)/(Ymax − Ymin)·(UiMax_0 − UiMin_0)` and
  `v = UiMin_1 + (Xmax − X)/(Xmax − Xmin)·(UiMax_1 − UiMin_1)`, using the row whose MapID
  matches.
- **Zone → continent**: go through world, or use the per-axis affine
  `cx% = (Wz/Wc)·x% + 100·(C.Ymax − Z.Ymax)/Wc` and `cy% = (Hz/Hc)·y% + 100·(C.Xmax − Z.Xmax)/Hc`.
- **Continent UiMaps** (`UiMap`/`UiMapAssignment` at 1.60.1.70009, unchanged from Era
  1.15.9.69722; committed as `db2-csv` rows, D-018): Azeroth **947** (MapID 1 in
  `(0.0399,0.0855)-(0.4083,0.9234)`, MapID 0 in `(0.5505,0.0994)-(0.8966,0.8691)`), Kalimdor
  **1414** (MapID 1, X −11733.30…12799.90, Y −19733.21…17066.60), Eastern Kingdoms **1415**
  (MapID 0, X −16000…7466.60, Y −19199.90…16000).
- **Worked example** (Gornek, Durotar `42.06, 68.33`): world `(X, Y) = (−600.30, −4186.42)` on
  MapID 1, Kalimdor `57.7531, 54.6207`, Azeroth `28.7673, 51.5603`.
- **Era → Forever** applies only to `frame: 'era'` points on Mulgore 1412, Eastern Plaguelands
  1423, Redridge 1433 and Stormwind City 1453, at resolve time:
  `x' = scale_x·x + offset_x`, `y' = scale_y·y + offset_y` (the `conversion.json` coefficients,
  carried in the placeholder's `eraToForever`). For example, Chief Hawkwind at Era `44.18, 76.06`
  becomes `43.888926, 76.659548`. QuestieDB Forever data is **already** converted and is never
  converted again. Era-frame points enter only through an explicit import option, for example
  RXP percent gotos on those four maps (`RXP030-frame-ambiguous`, ARCHITECTURE §10).
- **HBD and RXP world form**: HereBeDragons and RXP `.goto <UiMap>/<MapID>,a,b` use
  `(a, b) = (Y, X)`. Lowering swaps them into the world `SourcedPoint`, keeps `lexemes` in the
  order written, and keeps the `<UiMap>` prefix as the point's `uiMapId` hint (ARCHITECTURE §6).
  An edited group's canonical re-emission therefore reproduces the prefix as well. The hint is
  not used for resolution.
- **Pitfalls**: AreaID, UiMapID and MapID are separate namespaces that collide (AreaID 2521 ≠
  UiMapID 2521). `{-1,-1}` means instance presence (`InstancePresence`), resolved to a dungeon
  entrance when `zones.json` has one. A published point whose AreaID has no UiMap (suppressed
  areas, legacy dungeon pairs, instance areas) becomes an `UnmappedAreaPoint` with a reason and
  is not placed (ARCHITECTURE §5.2). Percent is not a distance: 1% is 52.9 yd on Durotar and
  17.4 yd on Stormwind.

## 7. Rendering (Leaflet behind `MapAdapter`)

This follows ARCHITECTURE §7. `map/leaflet` is the only Leaflet importer. **react-leaflet is not
used:** versions 3.x-5.x declare `Hippocratic-2.1` (npm registry; 2.8.0 declared MIT). The owner's
posture is not to use it in this GPL-3.0-or-later repository (D-005). This is not a legal
conclusion. The React integration is a thin wrapper of our own (a ref plus effects).

**As built (Milestone 3).** Three pieces, with the ARCHITECTURE §4 import rules:

| Module | What | May import |
|---|---|---|
| `src/map/adapter.ts` (pure) | The `MapAdapter` interface, the plain-data descriptors, the view-model inputs of `layers.ts` (with `ReliefInput`, `OutlineInput`, `RouteLeg`, `RoutePathsInput`), `LAYER_IDS` and `IMAGE_LAYER_IDS`, `routeLegKey`, surface-id and bounds helpers | `domain`, `geo` |
| `src/map/layers.ts` (pure) | View models → descriptors: `createMapLayers` (memoised per layer), the stateless `build*` functions, `surfacesOf`, `placeStep`, `legOf`, `routeStepInputOf`, `routeInputOf`, `routeLegsOf`, `routePieces`, `RELIEF_OPACITY`, `layerStatsNotes` with `LAYER_STATS_UNITS` | `domain`, `geo`; only types from `adapter.ts` |
| `src/map/leaflet/` | `createLeafletMapAdapter` and its helpers: `transform.ts` (world ⇄ lat/lng, scale and zoom maths, grid labels), `diff.ts`, `style.ts` (palette, path, outline and frame styles, glyph specs and extents), `glyphs.ts` (canvas glyphs), `perf.ts` (User Timing), `leaflet-layers.ts` (the Leaflet subclasses and draw-list placement), `leaflet-core.css` (Leaflet's stylesheet without its images), `map.css` | `adapter.ts`, `leaflet`; only types from the pure modules |
| `src/infra/maps/` (not pure) | Besides the geometry loader and local art: `art-manifest.ts` and `terrain.ts` (hand-written guards for the committed art manifest, the terrain manifest and the arc files), `map-resources.ts` (`createMapResources`: lazy, verified, memoised, never fatal) | pure modules, browser APIs |

`ui` may import `adapter.ts` but not `layers.ts`, and `map/leaflet` only in the composition root:
`src/main.tsx` hands the shell a lazy loader (`MapEngineSetup.loadAdapter`) that imports
`src/map/leaflet` in its own chunk and resolves to `createLeafletMapAdapter` as a
`MapAdapterFactory`, and the app layer re-exports the `layers.ts` builders the UI calls (as
`src/app/rules-exports.ts` does for rules).
There is no `src/map/index.ts`: the architecture test maps only `adapter.ts`, `layers.ts` and
`leaflet/` under `src/map`, and a barrel would mix a pure module with the Leaflet one.

### 7.1 Surfaces

| Surface | Status | CRS mapping | Image overlays (art, relief) |
|---|---|---|---|
| `atlas` (MapIDs 1 and 0 placed, 2991 as an inset card) | **The default since step ATL.10** (D-042): one surface for both continents and Zephras Isle; "Kalimdor" and "Eastern Kingdoms" are presets that fit it to a continent | `L.CRS.Simple` in atlas yards: `E = eOff − Y`, `S = sOff − X` per placement, `latLng = (−S, E)` (translation only; [coordinates §14.1](research/coordinates.md#141-surfaces)) | the base map's tile band and underlay (§7.5); per-map relief and Zephras Isle's image only as fallbacks |
| `world:<mapId>` (instances, the battlegrounds 30, 489, 529, Darkspear Islands 2997, …) | One surface per world map the atlas does not place, listed under "Separate maps". `world:0`, `world:1` and `world:2991` are **retired** since ATL.10 (they return only when a geometry cannot place the continents: no atlas without both 947 rows) | `L.CRS.Simple`, `latLng = (X, −Y)` in yards (north up, east right) | `L.imageOverlay(url, [[Xmin, −Ymax], [Xmax, −Ymin]])` |
| Overview (both continents on one canvas, Azeroth 947 layout; revision 1's `UiSurface`) | *Superseded by the atlas* (D-042; it was deferred until after the MVP, F23) | `latLng = (−v·668, u·1002)` | – |

- Surface extent: the committed continent frame (1414 for MapID 1, 1415 for MapID 0). For
  Zephras Isle (2991) and Darkspear Islands (2997), the union of their zone frames plus a margin.
  Where those two islands sit on the world map is unknown (§10 M3); per-world surfaces do not
  need to know.
- Zoom: an art image's native zoom is `log2(1002 / (Ymax − Ymin))`: −5.2 for continents, −2.4
  for Durotar and −0.8 for Stormwind.
- All zones of a continent share one world frame, so lines crossing zone borders need no special
  handling. Zone rectangles overlap and cities sit inside zones: use them for placeholders,
  hit-testing and "zoom to zone", and the committed continent art (§7.5) for the picture.

*As built, the atlas (steps ATL.2 to ATL.10; map-atlas.md §5, §8):*

- **Placements** (`src/geo/atlas-layout.ts`, `atlas.ts`): Kalimdor at eOff 5,652 and sOff 12,778,
  the Eastern Kingdoms at 22,499 and 7,907 (the 947 translation moved by whole 1,024-yd tiles; the
  compact layout, D-042 O9), Zephras Isle's 2521 rectangle as a card with its north-west corner at
  E 13,440, S 512. The extent is E 0–30,720, S 0–26,112, card included. The relative position of the
  continents is a layout choice, stated in the key's note, not a geographic claim; atlas units never
  feed a distance, which stays per world map (D-017). `atlasHash` pins the placements, and the tile
  indexes are refused unless they carry it.
- **Partition** (`partition`): inside the card → 2991; else `E ≤ seamE` (16,617) → map 1; else map
  0. A click therefore always yields a real `WorldPoint`; picks round to 0.1 yd, after which the
  inverse is exact.
- **Views**: `MapView.visible` lists each placed map's part of the view padded by 50 %; `center`
  and `mapId` name the partition under the view centre, and the scale bar names that map. Layers are
  built per placed map in view and joined (ARCHITECTURE §7.2).
- **Zoom**: `minZoomFor` fits the atlas extent, card included (−5.22 in a 918 × 700 panel);
  `maxZoom` 2; `zoneZoom` −3.5 and focus −2 are unchanged, since the unit is still a yard. Since
  ATL.0 the buttons and keys move one level (`zoomDelta` 1) and Leaflet's wheel used 60 px a level;
  since ATL.10 our `SmoothWheel` replaces it and `zoomSnap` is 0 (§7.5).
- **Cross-map legs**: rides between the continents are `connector` arcs (a dashed quadratic arc in
  the leg's style, a mid-arc ring and a label; never measured); legs to the card or to an instance
  keep their transition glyph pairs.

*As built, world surfaces (Milestone 3; since ATL.10 only for the maps the atlas does not place, or
every map when a geometry has no atlas):*

- `surfacesOf(geometry)` makes one `SurfaceInfo` per world map with at least one row, ascending.
  The extent is the frame of the map's one continent UiMap (Type 2 with a parent other than the
  root, which leaves out the alternative continents 1463 and 1464; with the placeholder: 1414 and
  1415); otherwise the union of its zone frames (AreaID > 0) plus 5% on every side. The name is
  the continent's, else the one name all its zone frames share (Zephras Isle 2521), else
  `World map <id>`. The placeholder gives surfaces 0, 1, 30, 489, 529, 2991 and 2997.
- The transform is in `src/map/leaflet/transform.ts`: `lat = x`, `lng = 0 − y` and back, exact
  (negation only; `0 − v` so a world 0 never becomes −0), with tests for round trips and bounds.
- `maxZoom 2` (Orgrimmar's native zoom is −0.5), `zoomSnap 0.25`, `zoomDelta 0.5` (Milestone 3;
  `zoomDelta` 1 since ATL.0, and `zoomSnap` 0 with the smooth wheel since ATL.10). The least
  zoom follows the container (`minZoomFor`, M3 review MAP-UX-7): −6 where the stage shows the
  largest surface extent at −6 (with 24 px padding), otherwise the zoom that fits it, snapped down
  to a quarter, never below −7.5; it is recomputed on every resize. At −6 Kalimdor (36,800 yd)
  needs about 623 px of width, so a 336 px stage (1280 px with the layer panel open) gets −7. The
  view is held inside the extent padded by 50% (`maxBounds`; a view wider than that is centred on
  it). `focus` zooms in to at least −2.
- `fitBounds` takes a `minZoom` floor: bounds that need a lower zoom to fit are centred at the
  floor instead. The controller passes the level-of-detail `zoneZoom` for jump-to-zone and
  aggregate clicks, so a zone that is wide for its stage still reaches raw points (M3 review
  PERF-4, MAP-UX-2).
- Each surface remembers its last view. Content is kept per layer and only descriptors on the
  current world map are drawn, so a surface switch redraws what the layers already hold. `focus`,
  `fitBounds` and `setViewport` on another world map switch surface and emit a `surface` event.

### 7.2 Level of detail (PERF-7)

Scale: the Milestone 0 critique counted 72,734 drawable referenced spawn points at `b6f5b07`:
39,585 on MapID 0, 31,961 on MapID 1 and 4,369 in The Barrens alone. This was a scratch count,
indicative only. Leaflet's canvas renderer moves the canvas with CSS during pan and zoom
animation. At `moveend`/`zoomend` it redraws every path, and each hit test walks the whole path
list. Cost therefore shows up as long frames at `moveend` and on layer changes, not as a lower
pan frame rate.

- Canvas renderer (`L.canvas`), one per map (it draws the current surface).
- **Raw points** (spawns, objectives, givers) are drawn only at zone zoom, or at any zoom for the
  selected or hovered quest. Threshold: zoom ≥ −3.5, between continent (−5.2) and zone (about
  −2.4) native zooms.
- **At continent zoom**, per-zone aggregate glyphs replace raw points: one glyph per (layer, zone)
  at the centroid of that zone's points, showing a count. A hex-bin density view (revision 1's
  placeholder "terrain hint") is an optional later layer and counts toward the cap.
- **Hard cap on drawn paths per surface**: 2,500 (revision 1's marker budget of 5,000 measured at
  5.9–15 ms per `moveend` unthrottled in the M3 review, PERF-3, too close to the 16 ms budget for
  the planned 4× CPU throttle). Above a layer's budget, the paths nearest the viewport centre are
  drawn, and the layer says how many it left out.
- Labels on hover only (zone-frame names excepted, §7.5).
- Budgets (ARCHITECTURE §14): `moveend` redraw ≤ 16 ms at the cap; applying one route edit
  ≤ 8 ms. Both are measured with `performance.measure` marks in `LeafletMapAdapter` (§7.3) and
  driven by Playwright (Milestone 9). The threshold is unmeasured until then (§10 M10); the cap has
  an unthrottled harness run (below), and the 4× throttled one stays for Milestone 9.

*As built* (`DEFAULT_LOD` in `layers.ts`, overridable with `createLod`):

| Layer | Budget (paths) | Continent zoom |
|---|---:|---|
| `relief` | 1 image (not a canvas path) | the world map's relief |
| `art` | 16 images (not canvas paths) | the continent image; zoomed in, the viewed zone's (one at a time, §7.5) |
| `coastline` | 1 | one path per world map |
| `zone-outlines` | 1 | one path per world map |
| `zone-frames` | 98 (100 before Milestone 3b) | frames and the extent |
| `available-quests` | 600 | per-zone aggregates |
| `objectives` | 500 | per-zone aggregates |
| `turn-ins` | 150 | per-zone aggregates |
| `flight-masters` | 100 | raw (`rawAtAnyZoom`: a few hundred at most, useful at continent zoom) |
| `route-line` | 150 | as at zone zoom (pieces of at most 256 vertices, §7.4) |
| `route-steps` | 700 | as at zone zoom |
| `proposal` | 100 | as at zone zoom |
| `selection` | 100 | as at zone zoom |

- The canvas budgets sum to the 2,500 cap (the two terrain paths come out of the zone frames' 100:
  a world map has at most about 40 frames), and `createLod` refuses settings where they do not
  fit, so every layer is capped on its own inputs and the surface stays under the cap.
- Over budget, focused items (the selected or hovered quest's points; selected, hovered and
  active steps) are kept first, then the nearest to the viewport centre (squared distance to a
  point, or to a line's or frame's bounding box), ties by id. Survivors keep their draw order.
  The cut is found without sorting every candidate (the budget-th smallest distance, then ties by
  id), which gives the same result as the full sort and saves about 1.5 ms on a 10,000-step route.
- The memoised builders (`createMapLayers`) rank from the centre snapped to a grid of 256 px at
  the zoom's whole level (`rankingCenter`, about a quarter of a view), so a pan inside a grid cell
  re-ranks nothing; and when they do re-rank, items they already draw stay first while they are
  inside the view grown by 25% on every side (`MapView.bounds`). Markers no longer drop out and
  reappear while panning over budget (M3 review PERF-7). The stateless `build*` functions rank
  from the exact centre alone.
- The zone the user jumped to (`view.map.zone`, passed as `rawZone` to `spawns`) is drawn raw at
  any zoom, like a focused quest's points (by the points' published UiMap).
- Aggregates group by the point's published UiMap (`SpawnPoint.uiMapId`, the hint, never
  rectangle containment; coordinates §5) when that UiMap is a zone: one drawn as a zone frame (a
  single full-rectangle row with an AreaID) on the same world map. Points without a hint, and
  points published on the world map (Azeroth 947, one row per continent) or on a continent
  (AreaID 0), group per world map (`No zone`). Milestone 3b fixed the one aggregate STATUS listed
  for Azeroth: QuestieDB publishes the object "Freshly Dug Dirt" (quest "rAnS0m") on 947, south
  of Tanaris, and the map drew an "Azeroth" count as if it were a zone. The glyph shows the point
  count (`4.3k` style, rounded down); the label also names the number of distinct subjects.
- Every layer returns `LayerStats`: `drawn`, `notDrawn` (cut by the cap), `aggregated`,
  `unresolved` by reason, and `otherSurfaces`. `layerStatsNotes(stats, layer)` turns them into
  panel sentences that always name the unit (M3 review MAP-HONEST-5), from `LAYER_STATS_UNITS`
  (images for the relief and art, outlines for the terrain lines):
  spawn layers count markers cut by the cap and points unplaced or elsewhere ("22 points not
  placed: 22 inside an instance with no known entrance", "377 points on other world maps"); step
  markers count steps; the route line counts logical lines and glyphs on other world maps (not
  its pieces) and steps not placed; frames, images, halos and legs likewise. A caller may pass one
  noun for every count instead of the layer.
- The adapter has its own hard cap too (`maxPathsPerSurface`, default 2,500): if content ever
  exceeds it, the bottom of a layer's draw order is dropped and counted in `renderStats()`.
- Measured with a standalone harness (1280×800 stage, DPR 1.5, unthrottled, 2,500 paths, 120
  pans of 120 px per setting): `frl:map:update-paths` median 3.3–3.5 ms (p90 4.0–4.4) with every
  path in view, and 1.9 ms with padding 0.1 against 2.2 ms with 0.25 when the content spreads over
  three views; see "canvas padding" in §7.5.

### 7.3 Layer updates

- Layers, bottom to top (`LAYER_IDS`): `relief`, `art`, `coastline`, `zone-outlines`,
  `zone-frames`, `available-quests`, `objectives`, `turn-ins`, `flight-masters`, `route-line`,
  `route-steps`, `proposal`, `selection`. `relief` and `art` are the image layers
  (`IMAGE_LAYER_IDS`), drawn as image overlays in their own panes; the rest share one canvas.
  Spawn layers sit below the route, so route markers win hit-testing; the terrain lines are not
  interactive.
- Descriptors are plain data with stable ids, unique within a layer: `extent:<mapId>`,
  `frame:<uiMapId>`, `art:<uiMapId>`, `relief:<mapId>`, `outline:<zones|coast>:<mapId>`,
  `spawn:<npc|object>:<id>:<i>`,
  `spawn:event:<questId>:<objective>:<i>`, `agg:<layer>:<uiMapId>` (or `agg:<layer>:map-<mapId>`),
  `run:<mapId>:<style>:<first step of the piece>` (`…:<step>@<n>` for a piece that starts `n`
  vertices into a walking path longer than a piece), `transition:out:<stepId>`,
  `transition:in:<stepId>`, `departure:<stepId>`, `step:<stepId>`, `halo:<stepId>`,
  `leg:<stepId>`. A repeated base id gets `~2`, `~3`, ….
- **No positional numbers** (M3 review PERF-2). Route descriptors name steps by id: a step
  marker's and a halo's `label` is its step id (a label key), `MapRef` `step` has no index, run
  labels are the style word ("Route", "Flight"), transition labels name the other surface
  ("Transport to Eastern Kingdoms") and the selected leg says "Selected leg". `RouteStepInput`
  holds no position or text either, so the app's route-input cache is keyed by step, not index.
  The adapter asks a label provider (`MapAdapterOptions.label` or `setLabelProvider`, a
  `MapLabelProvider = (ref) => string | null`) for the numbered text each time a label is shown,
  through `labelOf`, which a UI's "pointer on" line uses too. An insert therefore changes only the
  descriptors next to it: the other step markers keep their object identity.
- **Stacks** (M3 review MAP-UX-3): markers of one layer, kind and style at the identical world
  point merge into one marker with `count` > 1, every item's `refs` and `labels` in the layer's
  order, the union of their badges, the strongest emphasis and the focused tier if any item has
  it; it takes its first item's id and its last item's place (so it draws where its topmost item
  would). The glyph gets a count badge (`2`…`9`, `9+`), the hover label reads
  "6 here: a; b; c and 3 more", and a click reports every ref in `MapHit.refs`, so the UI can
  offer a choice. Quest givers stacked on one dungeon entrance and steps 4–8 on one NPC are one
  marker each. Items in different layers do not merge; a flight master that also starts quests
  carries them in its spawn ref's `questIds` (the app fills them), so its click opens them.
- `createMapLayers` memoises each layer on its own inputs: inputs by reference, focus by content,
  the view by world map and level of detail, and the viewport centre only while the cap bites, by
  grid cell (a pan under the cap changes nothing, §7.2). Spawn layers never see the route. A rebuilt layer keeps the
  object identity of every descriptor whose content is equal, returns the previous `items` array
  when nothing changed, and the previous `LayerContent` when its stats match too.
- The adapter skips a layer whose `items` array is unchanged by reference. Otherwise it diffs by
  id (`diffById`): it creates new ids, removes missing ones, and updates in place descriptors whose
  object changed, calling Leaflet only for what changed (`sameData`, structural equality): the
  position (`setLatLng`, `setLatLngs`, `setBounds`), then the glyph (`setSpec`) or style
  (`setStyle`, `setUrl`, `setOpacity`). A descriptor whose label or ref alone changed costs no
  canvas work, and a marker that moves and restyles is redrawn once. A route edit never
  re-creates thousands of paths.
- One canvas draws every layer, in the order of the renderer's draw list, which is also the
  hit-testing order. A created path (Leaflet appends it on top) or one whose place in its layer's
  order changed is moved to just after its predecessor (`placeAfter`: the previous path of its
  layer, or the topmost path of the visible layers below); only that path's own area is redrawn.
  Updates in place and highlights move nothing. The M3 review measured the old whole-stack
  `bringToFront` restack at 2,000–4,900 calls and a whole-canvas redraw per edit and per hover
  (PERF-1); the adapter now never calls it.
- `highlight` (hover emphasis) draws a strong copy of each highlighted marker or aggregate on top
  of the `selection` layer (hidden with that layer, and with a hidden highlighted layer), and
  restyles a highlighted line in place; the items themselves keep their place.
- User Timing measures (`perf.ts`): `frl:map:set-layer` (detail: layer and added, removed,
  changed and moved counts), `frl:map:update-paths` (the renderer's full update on `moveend`,
  recorded only when it runs: Leaflet postpones and skips the calls between `viewprereset` and
  `viewreset`, M3 review PERF-10) and `frl:map:redraw` (every canvas redraw). Marks are cleared
  after each measure and each name keeps at most 500 measures.

### 7.4 Route lines

- One polyline per (world map, style) run of consecutive steps, plus a small highlight polyline
  for the selected leg. Transport, flight and hearth legs are styled distinctly.
- A MapID change (boat, zeppelin, portal, instance, hearth) ends the run and gets transition
  glyphs at both ends. The switcher then moves between surfaces. Revision 1's dashed 947
  connector belongs to the deferred overview.
- Instance steps are drawn at their dungeon entrance (`zones.json`, from QuestieDB
  `support/Forever/Zones/dungeons.lua`) with an instance badge.
- A step whose `Location` resolves to `null` is not drawn. Its leg is marked unknown, matching the
  simulation (ARCHITECTURE §6). Unmapped spawn points, and instance presence without a known
  entrance, are not drawn either.
- Points outside a zone frame (percent outside 0..100) are valid. In a zone view, draw them with an
  off-frame indicator.

*As built:*

- `placeStep(step, geometry)` gives each step a placement until the engine walk provides
  positions (Milestone 6): a resolvable location is a `point` (with its UiMap and an off-frame
  flag: zone percent outside 0..100, or a world point outside the frame of the UiMap it names);
  an unresolvable one is `unknown` with the `geo` reason; a travel step without a location
  (RXP `.zone`) is `unknown` (`destination-unknown`); any other step without one is `none` and
  does not move the character. It does not know the hearth bind point or detect death skips.
- `legOf(step)`: a `transport` travel step arrives by transport; a flight `take` is walked to (its
  location is where the flight is taken) and departs by flight; a hearth `use` with a location
  arrives by hearth, and without one departs by hearth, so the leg to the next placed step is the
  teleport. Everything else is `route`.
- Runs: consecutive placed steps on one world map with one leg style; a style change starts a new
  run at the shared point; a lone point draws no line. An `unknown` placement ends the run and
  forgets the position, and the next placed step's marker gets the `leg-unknown` badge. A run's
  `ref` lists one step id per vertex, so a clicked segment `i` is the leg into `stepIds[i + 1]`.
- **Pieces** (M3 review PERF-2): a run is cut into polylines of at most 256 vertices
  (`MAX_POLYLINE_VERTICES`, `routePieces`) that share their end vertex, each with its own id and
  ref. Boundaries are content-defined: a piece ends at a step whose id hashes to a boundary (about
  one in 64) once it has 64 vertices, or at 256, so an insert or delete moves only the boundaries
  next to it and every other piece keeps its first step, hence its id and object. A 10,000-step
  route is about 80 pieces; an edit re-sets one or two.
- **A hearth `use` without a location** (M3 review MAP-HONEST-8) is `unknown`
  (`destination-unknown`) until the engine knows the bind point (Milestone 6): the line ends at
  the point it leaves from with a departure glyph (the transition ring, ref `departure`, label
  "Hearthstone (destination unknown until simulation)"), the next placed step gets the
  `leg-unknown` badge, and the step counts as unplaced, not as one that stays put. It used to draw
  a dash-dot teleport straight to the next step. A flight `take` without a location still styles
  the next leg as a flight.
- Transition glyphs sit at the last point before and the first point after a world-map change,
  labelled with the leg style and the other surface's name ("Transport to Eastern Kingdoms"; the
  label provider adds the step number).
- The selection layer draws a halo on every selected, hovered and active step and a highlight
  polyline for the leg into the active step, unless an unknown step or a world-map change comes
  first. The proposal layer draws the proposed route in one `proposal` style, split only by
  world map.

*Walking paths (Milestone 3b):*

- **Input** (`RoutePathsInput` in adapter.ts): `pathOf(leg)` gives a walked leg's path (its
  points in order, finite, on the leg's world map), or null; `pending` says paths are still being
  computed. A `RouteLeg` names the two steps and their placed points; `routeLegKey(leg)` is an
  exact string key (world map and both end points) for a caller's cache, and `routeLegsOf(route)`
  lists the legs the route line will ask for, so a navigation model can compute exactly those.
  The controller takes it with `MapController.setRoutePaths`; a new object is given whenever an
  answer changes (a batch arrived, computing finished).
- **Which legs**: from one placed step to the next placed step on the same world map, reached on
  foot or mounted (`route`: not after a flight `take`, not by transport or hearth), and moving
  (two steps at one point take no path). Proposal lines never take paths.
- **Drawing**: a leg with a path runs from the step point through the path's points to the next
  step point (a path whose ends were snapped away from the step points stays joined to the
  markers); its style stays `route`. A leg without a path is straight, as `route-pending` while
  `pending` (short even dashes, faded) or `route-fallback` otherwise (dash-dot-dot). A path that
  breaks the rules (a point off the leg's world map, not finite, empty) or a provider that throws
  draws a fallback: the map never breaks. Each of the three is its own run, so a style change
  starts a new polyline at the shared point, as leg styles always have. Neither new style uses a
  difficulty colour or the provenance cyan; both take the route colour and differ by dash.
- **Caps with paths** (§7.2): the steps are cut into pieces as before (`routePieces`,
  content-defined); a piece whose legs' path points take it over 256 vertices is cut again at the
  last step that fits, or inside a leg longer than a piece (`…@<n>` ids). Every polyline keeps at
  most 256 vertices, consecutive pieces share their end vertex, and the `route-line` layer keeps
  its budget of 150 paths, nearest the centre first, counting the rest as not drawn. The
  highlighted leg into the active step follows its path too, in pieces of at most 256 vertices.
- **Cost**: the memoised builder asks `pathOf` once per leg per paths object (a leg cache keyed
  by the step it leads into, checked against the step it leaves and the paths object), shared by
  the route line and the selection's leg; and it keeps each piece's descriptor while the steps
  and leg drawings of its range are the same objects (a piece cache), so an edit builds only the
  pieces it touched and the rest compare by identity. Without paths the pieces, ids and
  descriptors are exactly those of Milestone 3.
- **Counts**: `LayerStats.paths` (route line only, with paths) counts the walked legs on the
  shown world map along a path, pending and fallback; the layer panel's "Walking paths" row says
  them in words.

### 7.5 Drawing, events and theme

- **Glyphs** (`glyphs.ts`), simple original shapes drawn on the canvas, one per kind, so shape
  carries the meaning: step, a bead (a circle with a hole); quest start, an upward triangle;
  turn-in, a square; objective, a small dot; flight master, a plus; transition, a ring with a
  dot; halo, a wide ring; aggregate, a rounded box with the count. Badges: instance, a small
  square; off-frame, a dashed ring; leg unknown, a question mark; a stack, a round count badge at
  the bottom right. `strong` glyphs are 1.35 times larger, `dim` ones fade to 40%. No game icons,
  no diamond (◆/◇ mean Forever provenance, UI.md §4).
- **Glyph cost** (M3 review PERF-3): a glyph neither saves nor restores the context; it sets every
  property it uses (alpha, round joins, colours, fonts) and clears a dash pattern only when the
  measured renderer saw a dashed path stroked earlier in the pass (Leaflet leaves its dash set),
  with one shared empty dash list.
- **Glyph bounds** (M3 review PERF-13): a marker's canvas bounds cover its whole paint, badges and
  count included (`glyphExtent`), so a dirty-rectangle redraw that clears part of a glyph redraws
  all of it; its hit radius stays the glyph's size plus 2 px (plus the renderer's 2 px tolerance).
- **Lines**: route solid, transport dashed, flight dotted, hearth dash-dot, proposal long dashes,
  a walked leg whose path is pending short even dashes (faded), one with no path dash-dot-dot,
  highlight a thick solid line; every style differs by more than colour.
- **Colours** come from the kit's CSS custom properties, read from the map container
  (`readMapPalette`): an optional `--frl-map-<role>` token first (for example `--frl-map-route`),
  then any shared map token the role also takes, then the kit token (`--frl-accent` for steps and
  the route, `--frl-fg` for givers, turn-ins and the proposal, `--frl-fg-muted` for transport and
  hearth, `--frl-border-strong` for frames, `--frl-map-grid` for the grid), then the light-theme
  value. Zone frames and the extent are stroked with `--frl-map-frame` (defined in the kit's
  tokens at 3:1 or more against `--frl-surface-sunken` in both themes, WCAG 1.4.11) at full
  opacity; the extent reads `--frl-map-extent` first. The 0.7 and 0.8 opacities that took the
  frame stroke below 3:1 are gone (M3 review MAP-A11Y-6). Never a difficulty colour or the
  provenance cyan. The adapter re-reads them when the root's `data-theme` or the system colour
  scheme changes; `refreshTheme()` covers any other theme switch.
- **Zone frames** are rectangles with a faint fill and their geometry name, centred, drawn only
  when the frame is wide enough on screen; the surface extent is a dashed outline. Frames are not
  interactive (their hover would cover the whole map); a click on empty map reports the zone
  frames under it, smallest first. Jump-to-zone does not take the smallest, because frames
  overlap heavily (the Crossroads lies in Durotar's frame): the controller opens the frame the
  point is most central in (`zoneFramesContaining`, coordinates.md §15; M3 review MAP-UX-1).
- **Grid and scale** (procedural, §8.1): a yard grid on its own canvas in a pane below the paths
  (spacing 1, 2 or 5 × 10ⁿ yards, at least 96 px apart, clipped to the extent, hidden while
  zooming; on the atlas drawn per placement, clipped to its map's rectangle, and hidden for a whole
  wheel gesture) and a yard scale bar (bottom right since MP.4b, naming the map under the view
  centre on the atlas). Leaflet's own scale control would say metres and
  feet. Labels name the axis, the value with a true minus sign and the direction the axis grows,
  `X 500 (N)` and `Y −4100 (W)` (`gridLabel`): world X runs north and Y west, and RXP writes
  pairs as (Y, X), so a bare `X`/`Y` invited swapping them (M3 review MAP-COORD-14). The grid
  redraws once per settled view (`moveend`, which Leaflet also fires for a view reset and after a
  debounced resize) and reallocates its backing store only when the size or pixel ratio changes
  (M3 review PERF-12).
- **Canvas padding and resizing**: the path canvas extends 10% beyond the view on every side
  (`rendererPadding`, Leaflet's default; it was 0.25, which redraws 2.25 times the view's area on
  every `moveend` against 1.44 times). Measured on the harness above, padding made no difference
  with every path in view (3.4 ms against 3.5 ms median) and saved 0.3 ms when the content spread
  over three views (2.2 ms against 1.9 ms, p90 3.1 against 2.4). A `ResizeObserver` resize (a
  splitter drag, at most once a frame) calls `invalidateSize` with a debounced `moveend`, so the
  renderer redraws, the adapter emits one `move` and the controller syncs once, 200 ms after the
  resizing stops (M3 review PERF-5); `resize()` settles at once.
- **The base map on the atlas** (D-042, D-045, D-049; steps ATL.7, MM.1, MM.9; map-atlas.md §8.3,
  §21): one `tiles` descriptor per style, `atlas-tiles:minimap` (the default) or
  `atlas-tiles:painted`, drawn by `AtlasTileLayer` (a `GridLayer` in the `frl-atlas` pane, z-index
  245, 256 px tiles, levels −8 to 0, `updateInterval` 100) over `AtlasUnderlay` (pane `frl-underlay`,
  244: every stored tile of the index's `underlayLevel`, −6 for the minimap and −5 for the painted
  atlas, never pruned, one transform per zoom event). Sea keys create no element, so the container's
  sea colour shows (navy #0d1b30 in the minimap style, rgb(61, 55, 41) in the painted one); a
  virtual key (painted only) draws its nearest stored ancestor; every tile starts as the crop of its
  nearest ancestor already decoded in its own band, then fades its own image in over 150 ms (none
  under reduced motion). The band keeps 1 (minimap) or 2 (painted) rows of tiles around the view. A
  style switch adds the new band above the old one, prunes the old band's off-view tiles, and removes
  the old band once the new first view has decoded and faded in, or after 2 s; the container's
  `data-map-style` and the palette follow the picture shown. Each index (`maps/minimap/index.json`,
  `maps/atlas/index.json`) is fetched when its style is first shown. Zone rectangles are kept for
  hit-testing and jump-to-zone but not painted while tiles show; Ironforge's and the Undercity's
  frames are dashed in the minimap style (they are underground). The painted style's names are
  Blizzard's own lettering; the minimap has none, so the presentation layer's labels canvas names
  zones, continents and cities in both styles (map-presentation.md §13).
- **Fallbacks on the atlas** (map-atlas.md §8.6, §21.4): a style whose index is missing or refused,
  or whose first view's images all fail (a clone or build without the minimap tile pack, message
  "Minimap tiles not downloaded (run `pnpm maps:minimap:fetch`)"), gives way to the other style, with
  the reason in the drawer's notices; the choice is kept. With neither, or with "Painted art" off,
  the relief is drawn per placement (hidden above zoom 0), with outlines and frames, and Zephras
  Isle's painting (2521) on its card when the tiles cannot be used.
- **Per-image painted art** (D-033, Milestone 3b; since ATL.10 on world surfaces only, and for
  Zephras Isle's card as above): the committed images of `public/maps/art/` (Blizzard
  Entertainment's artwork, with its notice) as image overlays in the `frl-art` pane (z-index 250),
  below the grid (350) and the canvas (400), placed by the world rectangle the art manifest
  records for each image (its UiMapAssignment row at the art's build; `ArtInput.bounds`), in
  `CRS.Simple` as `[[Xmin, −Ymax], [Xmax, −Ymin]]`. The map draws the map being viewed, one image
  at a time as the game's world map does: zone images carry painted parchment borders, so
  neighbours drawn together cover each other (checked in a browser, Milestone 3b). Zoomed out,
  the surface's continent image (never the alternative continents 1463 and 1464); zoomed in, or
  on a world map without a continent image, the image of the zone being viewed: the zone jumped
  to while the view centre is in its rectangle, else the zone frame the centre is most central in
  that has an image (`zoneFramesContaining`). Zoomed in outside every zone image nothing is drawn:
  the continent image is too coarse there, and the relief is the backdrop. Of two images of one
  rectangle (Zephras Isle 2521 and 2665) the one with more pixels is drawn. Azeroth 947 spans two
  world maps and is drawn on none (the art layer says so). The images are drawn from their
  deployed URLs: they ship with the app as its code does, an `<img>` loads and decodes them off
  the main thread, and `tools/maps/validate.ts` and the dist audit check their hashes at build
  time. An art switch therefore never waits for an image; the old image is removed at once and
  the new one appears when it has loaded. Since ATL.10 the folder holds only the battlegrounds',
  Darkspear Islands' and Zephras Isle's images (D-042 O5); the continent and zone rules above apply
  to a local set's art and to a geometry without the atlas.
- **Local art** (dev and preview only, D-018): a compatible local set's art replaces the
  committed art while it lists images. It is drawn from object URLs of the verified image bytes
  (`infra/maps` local art), never from the plain file URL, and its rectangle comes from the
  geometry `createMapLayers` was given.
- **Relief** (D-032): the world map's shaded relief PNG (about 17 yd per pixel; maps 0 and 1) as
  an image overlay in the `frl-relief` pane (z-index 240), under everything, placed by the
  terrain manifest's rectangle (on the atlas, per placement, and only as the fallback above:
  never while tiles show). It is the backdrop at `RELIEF_OPACITY.backdrop` (0.85) where no
  painted art is drawn on the world map (none exists, the art layer is hidden, or the art could
  not be loaded), and faint at `RELIEF_OPACITY.underArt` (0.4) while art is drawn over it
  (terrain-navigation.md §13.2): the art covers it where it exists, and it shows the terrain
  around the viewed zone. Only its opacity changes (`setOpacity`), never its image. The PNG's own
  palette (transparent where there is no terrain, a muted blue for water, greys) is the terrain
  tool's; it is data, not a UI signal.
- **Zone outlines and coastline** (D-032): one non-interactive canvas path each per world map
  (`OutlineDescriptor`, a Leaflet multi-line polyline with `smoothFactor` 1), from the arc files
  decoded to world points (1-yd integers, delta-coded; `infra/maps/terrain.ts`). Zone outlines
  are stroked 1.5 px in the frame token (`--frl-map-frame`, 3:1 on the map background) at full
  opacity; the coastline 1 px in the muted ink. A click on them is a click on the map. They are
  a picture: points are still attributed by their published zone and the frames. Kalimdor's
  coastline has 916 arcs and 18,031 vertices, the Eastern Kingdoms' 876 and 15,552; the zone
  outlines 127 and 109 arcs.
- **Frames over art**: while painted art is drawn on the world map, zone frames lose their faint
  fill (`FrameDescriptor.filled` false): every frame a city lies in would add another veil over
  the art. Their stroke and labels stay.
- **Loading and failures** (`createMapResources`, infra/maps): the art manifest and the terrain
  manifest are fetched (revalidated) when the map first mounts, never during startup; an arc file
  is fetched when its layer is first shown on its world map (the coastline, off by default, is
  not fetched until it is shown), its bytes checked against the terrain manifest's SHA-256 (a
  mismatch is fetched once more past the HTTP cache), then decoded. Every call resolves: a
  missing or malformed manifest or file is a `failed` result with the reason, kept unless it
  could not be fetched (tried again at the next mount). The map then draws what it has: the relief
  without the art, the zone frames without either, and the route as ever. The layer says why
  (`unavailable`) and the status line what the map shows instead.
- **Events**: `click` (the topmost interactive item, or none, with the world point and the zone
  frames under it), `hover` (enter and leave), `move` (`moveend`), `zoom` (`zoomend`) and
  `surface`. Hits come from Leaflet's canvas hit-testing and carry every ref of the hit
  descriptor (`MapHit.refs`); paths do not bubble to the map, so an item click is never also a map
  click. Hover labels use one shared tooltip whose text is set as text, never HTML, from
  `labelOf` and the label provider.
- **Wheel and gestures** (map-atlas.md §8.4; steps ATL.0, ATL.8, on since ATL.10): our own
  `SmoothWheel` (`smooth-wheel.ts`) replaces Leaflet's `scrollWheelZoom`. Every wheel event moves
  the target zoom (0.5 level per 100 px, at most one level per event; line and page modes scaled,
  `ctrlKey` pinches doubled), the view eases towards it every frame around the pointer with the
  centre clamped to the bounds (no pan-back), and one `moveend` settles the gesture 140 ms after the
  last event. Notch-like and stream input have separate rates, both at the design's starting value
  until ATL.9 calibrates them on the owner's hardware. During a gesture the grid is hidden and hover
  labels are held back; the path canvas is re-rendered mid-gesture after half a level of drift when
  its last draw took under 8 ms; canvases use the device pixel ratio (capped at 2); new paths are
  created at most 150 per animation frame; near the level-of-detail edge the other band's spawn
  layers are built in idle time. Touch keeps Leaflet's `TouchZoom`; the map's `fadeAnimation` is off.
- **Accessibility**: Leaflet's keyboard panning and zoom buttons stay on and take the kit's focus
  ring; the route list, not the canvas, is the accessible view of the route. With
  `prefers-reduced-motion: reduce`, zoom, fade and inertia animations are off, the wheel jumps to
  each target without easing, and tiles do not fade.
- **Leaflet internals** (`leaflet-layers.ts`, Leaflet pinned to exactly 1.9.4): the glyph and
  frame classes draw from the canvas renderer's draw hook (`_updatePath`, `_renderer._ctx`,
  `_drawing`, `_point`, `_radius`, `_pxBounds`, `_updateBounds`, `_clickTolerance`); the measured
  renderer wraps `_redraw`, `_updatePaths` (checking `_postponeUpdatePaths`), `_draw` and
  `_fillStroke`; `placeAfter` relinks the draw list (`_drawFirst`, `_drawLast`, a path's
  `_order`) and calls `_requestRedraw`; `destroy` clears the map's `_sizeTimer`. The renderer's
  `_redraw` also cancels a pending animation frame first: in 1.9.4 a synchronous redraw leaves the
  frame requested before it scheduled, and a map removed in between (a React StrictMode remount)
  would then throw on the deleted context. The atlas and the smooth wheel add (steps ATL.7, ATL.8,
  MM.1, MP.1): `GridLayer._isValidTile`, `_update`, `_pruneTiles` and the maths of
  `_setZoomTransform` (reproduced by the underlay); `Map._getNewPixelOrigin`, `_stop`, `_moveStart`,
  `_move` (with its `pinch` and `round` flags), `_moveEnd` and `_limitCenter`; the renderers'
  `_update`, `_reset`, `_updateTransform`, `_bounds`, `_zoom`, `_container` and `_redrawRequest`,
  the canvas's backing-store sizing and `_postponeUpdatePaths`; `Polyline._rawPxBounds` and
  `_parts`. An upgrade must re-check these names.
- **Stylesheet** (M3 review PERF-11): `leaflet-core.css` is Leaflet 1.9.4's `leaflet.css`
  (BSD-2-Clause, notice kept in the file) without its three image rules (the layers-control
  toggle's `layers.png` and `layers-2x.png`, and the default marker icon path), which Vite
  inlined as data URIs past the dist audit's image rules; the map uses neither. It is re-copied on
  a Leaflet upgrade. The lazy chunk is 182.07 kB (54.29 kB gzip) of JavaScript and 12.77 kB
  (3.09 kB gzip) of CSS, against 17.6 kB (7.0 kB gzip) of CSS before. Importing
  `leaflet/dist/leaflet-src.esm.js` to let Rollup drop unused classes was tried: 179.07 kB
  (53.07 kB gzip), 1.2 kB gzip less, not worth a deep import and a type shim. The dist audit
  reports the lazy chunks' sizes after the gated entry total, not gated, so they cannot grow
  unnoticed.

### 7.6 Tests

- `src/map/adapter.test.ts`: surface ids, bounds helpers, layer order, `descriptorMapId`,
  `combineLabels`, `labelOf` with and without a label provider, `refsOf`.
- `src/map/layers.test.ts` (over the `src/geo` cited fixture geometry): surfaces and extents,
  level-of-detail settings, `placeStep` and `legOf` for every step kind, frames, art, spawn
  layers at zone and continent zoom (badges, reasons, aggregates and centroids, focus, merging,
  order independence), the cap (nearest-first, focus-first, no centre, zero budget), route runs,
  transitions, breaks and repeated ids, pieces (`routePieces`: lengths, shared ends, stable
  boundaries under an insert), the hearth departure, step markers without positions, stacks,
  selection, the proposal, the memoisation (identity kept, recomputed only on its own inputs, one
  changed descriptor per edit, every step marker kept on an insert above it), the raw zone, the
  snapped ranking centre and hold, units in the stats notes, and determinism.
- `src/map/leaflet/*.test.ts` (node): the transform and its inverse, scale bar and grid maths,
  grid labels, zoom-to-fit and the least zoom, hit helpers, diffing, `sameData` and the adapter
  cap, palette precedence (the frame token) and reserved colours, line and glyph styles, frame
  opacity, glyph extents and stack badges, glyph drawing with a recording context (no save or
  restore, dash cleared only when needed), User Timing.
- `src/map/leaflet/LeafletMapAdapter.test.ts` (happy-dom, with a recording canvas context and a
  fixed container size): mount, per-surface drawing, skip by reference and diff by id, content
  kept across remounts, painting, canvas hit-testing with layer order and toggles, polyline
  segments, text-only tooltips, surface switching and focus, fits, highlights, User Timing and
  palette refresh, and a destroy with a redraw frame pending; and since the M3 review: the draw
  list in layer order through creates, reorders and toggles, no `_bringToFront` call for an
  update in place or a highlight, the highlight overlay, Leaflet calls skipped for a label-only
  change, merged markers' refs and provider labels, the least zoom on small stages, fits with a
  zoom floor, a debounced observed resize with one grid redraw, glyph bounds with badges, the
  stack badge, dash handling in a draw pass, departures, and the canvas padding. happy-dom has no
  3D transforms, so Leaflet snaps views to whole zooms there.
- Milestone 3b (in the same files, and `src/infra/maps/*.test.ts`): the relief (backdrop and
  under-art opacity, the manifest's rectangle, an opacity-only change), committed art placed by
  its own rectangle, outlines as one path per world map with their descriptor kept per input,
  budgets still summing to the cap, unfilled frames; aggregates of points published on the world
  map or a continent; walking paths (`routeLegsOf`, legs along paths, pending and fallback runs,
  rule-breaking paths, snapped ends, the per-vertex step ids, no paths for the proposal); the caps
  with paths (a 2,000-step route with 20 path points per leg: every piece at most 256 vertices,
  ends shared, 150 drawn and the rest counted; a leg longer than a piece cut inside with `@` ids;
  the highlighted leg in pieces); the memoised builders asking only for changed legs and keeping
  every piece an edit did not touch. The Leaflet adapter: the relief and art panes below the grid
  and the canvas, images outside the path count and the draw list, an opacity change in place,
  outlines as non-interactive paths in layer order, a frame drawn without its fill. The loaders
  over the committed files: the manifests, every listed file present, the decoded arcs, hash
  verification with one retry past the cache, failures that never reject. The controller with a
  fake `MapResources`: loading at first mount, one image at a time, the continent zoomed out,
  relief opacity and frame fill following the art, outlines fetched per world map and the
  coastline only once shown, failures in the status line and the layer notes, retries at the next
  mount; walking paths given, counted, toggled off and on, pending and fallback, rebuilt only for
  a new object.
- A browser check with a scratch harness over the real adapter, layers and loaders (Milestone 3b,
  not committed): the Kalimdor and Eastern Kingdoms continent images and the Durotar image line up
  with the zone outlines and the coastline, and the relief orientation matches known land and sea
  points (north up, west left).
- The map rework (steps ATL.2 to ATL.10, MM.1 to MM.9; map-atlas.md §11, §25): `src/geo/atlas.test.ts`
  (offsets of both layouts, the card, 10,000 seeded round trips per placement, `atlasHash` pinned,
  the card's clearance against the committed coastline); the file-level architecture rule; the
  transforms through placements (identity placements bit-identical to the old functions); the
  per-map builders (a world surface's layers equal one builder's; the two-map join; the shared cap;
  the memo); the atlas surface, presets, connectors and the card in the controller and the panel
  (`*.atlas.test.ts`); the tile layer, underlay and index loader (a key not in the index makes no
  request, sea keys create no element, virtual keys resolve their ancestor, ancestor-first tiles,
  one underlay transform per zoom event, a refused hash falls back); the smooth wheel with fake
  frames; the two styles (`*.styles.test.ts`: no bare-container frame during a switch, never
  another style's tile, off-view pruning, the 2 s limit, failure and hand-back, the setting never
  written by a fallback); since ATL.10 and MM.9, the defaults (the atlas with no `atlas` option,
  the smooth wheel passed to the adapter, the minimap chosen first and its index alone fetched, the
  panel's notice and instructions naming the minimap art) and a geometry without the 947 rows
  keeping its world surfaces. `tests/map-labels.test.ts` runs MP.7's acceptance test in both styles:
  all 50 zone and city names placed at the fit-both view (0.0239 px per yard) and at 0.022 px per
  yard (MM.9's gate). The tools' tests are in `tools/maps` (`atlas*`, `minimap*`, `art-build` with
  the deployed set) and `tools/build` (the audit's tiled, plain and deploy modes; the pack).
- Not covered yet: the rework's time and memory targets (ARCHITECTURE §14), which ATL.9 and MM.8
  measure in a browser at 1× and 4× and on the owner's laptop, and the Playwright smoke test
  (Milestone 9).

## 8. Placeholder map and committed geometry

**Goal.** A clean checkout builds and deploys a usable map from committed files only. It
contains no Blizzard art.

### 8.1 What is drawn

| Layer | Drawn from | Committed? |
|---|---|---|
| Zone frames (outlines, labels) for 49 zones | `geometry.placeholder.json` rows with `source: "questiedb-conversion"` (QuestieDB `data/Forever/conversion.json` `geometry.transforms[].target_bounds`) | **Yes** (D-018) |
| Continent frames 1414/1415, the Azeroth 947 rows, alternative continents 1463/1464, the six new maps | The same file, rows with `source: "db2-csv"` | **Yes**, by owner approval (D-018). *Superseded by D-018:* revision 1's default "not committed; new zones show only with a local set". |
| Surface extent | Continent frame for MapIDs 0 and 1; union of zone frames plus a margin for 2991 and 2997 | Computed at runtime. *Superseded by D-018:* revision 1 used the union of zone frames everywhere, to avoid the then-uncommitted continent frames. |
| Grid, ticks, compass, scale bar in yards | Procedural | Code only |
| Points of interest: quest givers, flight masters, innkeepers, trainers, objects | `public/data/` (`entities.json` includes every flight master, innkeeper and trainer by `npcFlags`, ARCHITECTURE §5.2), drawn with level of detail (§7.2) | Committed data |
| Per-zone aggregates | Runtime, from the loaded spawns | Computed |
| Zone labels | The geometry's `name`: `conversion.json` `target_name` for the 49, `UiMap.Name_lang` at 1.60.1.70009 (from the committed rows file, §8.3) for the other 11 UiMaps. `zones.json` names are specified in DATA_PROVENANCE. | Committed. *Corrected (LIC-13):* revision 1 said names came from "QuestieDB zone and l10n tables"; QuestieDB's Forever l10n has no zone-name tables (RXP.md §10.3). |

A `PlaceholderLayer` draws in the same `world:<mapId>` coordinates as real art, so routes,
markers and hit-testing are identical; a local set changes only the base layer. The placeholder
uses an original visual style, not a Blizzard-style parchment look or game icons. It says
"schematic map: zone frames, not terrain" in the UI.

### 8.2 `geometry.placeholder.json` and `NOTICE.md`

- **Producer:** `tools/maps/import.ts --placeholder` (Milestone 2) is the only producer. The
  files are never edited by hand. It reads:
  - QuestieDB `data/Forever/conversion.json` as the **LF git blob** at the pinned commit, from
    the checkout that `tools/questiedb/fetch.ts` provides (`git cat-file blob`, default
    `.cache/questiedb`, `--questiedb-repo` to override). Blob SHA-256:
    `f4477d6c575575152225f2a9d40858029bf9d2d5fdf6b083c06557fce8b5984b`. A Windows worktree copy
    with `core.autocrlf=true` hashes differently (`6613032214aa517b…` was observed), which is why
    ARCHITECTURE §5.1 hashes LF blobs. The importer refuses a blob with any other hash. The pin
    comes only from `tools/questiedb/upstream.json`, read with the data pipeline's own
    `parseUpstream` (`tools/questiedb/lib/upstream.ts`): its `commit`, `repository`, `cachePath`
    (the default checkout) and the SHA-256 of its `data/Forever/conversion.json` input
    (`tools/maps/lib/pin.ts`). The file and that input are required. A `--commit` other than the
    pinned one is refused, because no hash is recorded for it. The values DATA_PROVENANCE §2 and
    §4.1 record are kept only as a test oracle (`tools/maps/lib/test-support.ts`). Git runs with
    `GIT_NO_LAZY_FETCH=1` and `windowsHide` (`tools/maps/lib/git.ts`), so a partial clone that
    lacks the blob fails instead of fetching it; git versions that predate the variable ignore
    it, and the blob must then already be in the checkout (`pnpm data:fetch`).
  - The committed `tools/maps/inputs/db2-rows-1.60.1.70009.json`, which holds the 12 cited rows
    and the 11 UiMaps' names, types and parents (§8.3).

  Both inputs are pinned or committed, so any machine, CI included, reproduces the two files
  byte for byte with no network request (ARCHITECTURE §6).
- **Content:** 60 UiMaps, 61 assignment rows:
  - 49 UiMaps with one `questiedb-conversion` row each (build 1.60.1.69893, `conversion.json`
    `geometry.target_build`);
  - 11 UiMaps with the 12 `db2-csv` rows (build 1.60.1.70009). Their `name`, `type` and `parent`
    come from `UiMap` at 70009; 2524 is recorded as Type 6, parent 1414, its 70009 values (at
    69893 it was Type 3, parent 947).

  Together the 61 rows equal the full `UiMapAssignment` table at 1.60.1.70009. Also included:
  `eraToForever` for the four changed maps, the input identities, `frameHash` and `contentHash`.
  As built: 28,277 bytes (4,195 bytes gzip -9); `NOTICE.md` 4,199 bytes (measured with Node's
  `fs` and `zlib.gzipSync` at level 9, 2026-09-25, after the content hash was added). The importer
  builds both in about 80 ms, excluding `tsx` start-up (`performance.now()` around the build in
  `import.ts`).
- **`NOTICE.md`** states:
  - What the files are: zone frames and map metadata for the procedural placeholder, no art.
  - Origin 1: the 49 frames and the four coefficient sets, copied from `conversion.json` at the
    pinned commit (with its blob SHA-256).
  - Origin 2: the 12 rows (and the 11 UiMaps' names, types and parents), Blizzard client values
    from `UiMapAssignment` and `UiMap` at 1.60.1.70009. The CSVs were fetched on 2026-09-25 as
    individual requests during research (not scripted crawling). The rows are committed with
    citations in `tools/maps/inputs/db2-rows-1.60.1.70009.json`, with both CSV hashes, by owner
    decision (D-018, D-022, D-026).
  - The D-016 finding: Questie/QuestieDB have no root licence file (none covering Questie's own
    code or data), and never had one on their default branches; the licence files in Questie's
    subfolders cover bundled third-party material only (M2 review data-F9). The draft on
    Questie's `license` branch says to consider Questie "all rights reserved".
  - The owner's posture (publish with notices, accepting the risk).
  - The carve-out, verbatim from [DATA_PROVENANCE.md](DATA_PROVENANCE.md) §3.2, as in
    `public/data/NOTICE.md`:

    > GPL-3.0-or-later applies to this project's contributions and, as a posture, to
    > Questie-derived data; it grants no rights over Blizzard content (names, text, client-derived
    > values) or other third-party material embedded in that data.

  - Non-affiliation with Blizzard Entertainment and the Questie project.
  - "This is not a legal conclusion."
  - The regeneration command, `pnpm maps:placeholder` (`pnpm tsx tools/maps/import.ts
    --placeholder`), and `pnpm maps:validate`.
  - The input hashes: the `conversion.json` blob, both research CSVs and the rows file, the
    frame hash and the content hash. It has no timestamp; `import.ts` generates it with the geometry
    (`tools/maps/lib/notice.ts`), so R1 checks it byte for byte.

  *Superseded by DATA_PROVENANCE §3.2 (LIC-10):* the first revision-2 text of this list said the
  licence "covers this project's contributions (the format and the generator)" and left out the
  posture clause for Questie-derived data. The NOTICE now uses the carve-out verbatim.

  THIRD_PARTY_NOTICES lists `public/maps/placeholder/**` among the Questie-derived and
  client-derived files (LIC-11).

### 8.3 Placeholder inputs and reproduction

**Committed rows file** (`tools/maps/inputs/db2-rows-1.60.1.70009.json`; ARCHITECTURE §6,
D-018). It is the placeholder's only input besides the pinned `conversion.json`, and is written
once in Milestone 2 from the two research CSVs below. It holds:

- the 12 `UiMapAssignment` rows for 11 UiMaps (Azeroth 947 has two), each with table, build and
  row ID and every column value as the CSV's decimal string;
- the `UiMap` `Name_lang`, `Type` and `ParentUiMapID` of the 11 UiMaps, cited the same way;
- per table, the full CSV's SHA-256, the request URL, the fetch date, and how it was obtained:
  fetched as an individual request during research, not by scripted crawling (D-011).

As built (13,054 bytes; one row of each kind shown; `tools/maps/lib/db2-rows.ts` defines and
parses it):

```jsonc
{
  "$comment": ["The 12 DB2-only UiMapAssignment rows (11 UiMaps; Azeroth 947 has two) …", "…"],
  "schema": 1, "product": "wow_classic_beta", "build": "1.60.1.70009",
  "sources": {
    "UiMapAssignment": { "url": "https://wago.tools/db2/UiMapAssignment/csv?build=1.60.1.70009",
        "fetched": "2026-09-25", "obtained": "individual research request, not scripted (D-011)",
        "file": "UiMapAssignment_1.60.1.70009.csv", "bytes": 6778, "rows": 61,
        "sha256": "79267e8be8034e47daab14350411b3acc0b1f64e86efc9d821a217497254ca0a",
        "header": ["UiMin_0", "UiMin_1", "UiMax_0", "UiMax_1", "Region_0", "…", "Field_11_2_5_62687_010"] },
    "UiMap": { "url": "https://wago.tools/db2/UiMap/csv?build=1.60.1.70009", "…": "…", "rows": 60,
        "sha256": "1f4aac70eaac015b1d2d0ea0faf6e3d7fb2cf7afdf45e5bb6772d9b80a72346b", "header": ["Name_lang", "ID", "…"] } },
  "rawLinesSha256": "0aff6391a197d4ff33a2f56bd3388ca72f305a5543fc646682580437646870bb",
  "assignments": [                                     // ascending (UiMapID, OrderIndex)
    { "table": "UiMapAssignment", "build": "1.60.1.70009", "id": 46724, "csvLine": 5,
      "columns": { "UiMin_0": "0", "UiMin_1": "0", "UiMax_0": "1", "UiMax_1": "1", "Region_0": "-11733.299804688",
                   "Region_1": "-19733.2109375", "Region_2": "-1000000", "Region_3": "12799.900390625",
                   "Region_4": "17066.599609375", "Region_5": "1000000", "ID": "46724", "UiMapID": "1414",
                   "OrderIndex": "0", "MapID": "1", "AreaID": "0", "WMODoodadPlacementID": "0", "WMOGroupID": "0",
                   "Field_11_2_5_62687_010": "0" } } ],   // all 18 columns, in CSV header order, as CSV strings
  "uiMaps": [                                          // ascending ID
    { "table": "UiMap", "build": "1.60.1.70009", "id": 1414, "csvLine": 6,
      "columns": { "Name_lang": "Kalimdor", "Type": "2", "ParentUiMapID": "947" } } ] }
```

`csvLine` is the 1-based line of the row in the full CSV (the header is line 1). The file is
hashed as LF bytes, the way ARCHITECTURE §5.1 hashes upstream inputs (`.gitattributes` already
sets `* text=auto eol=lf`); a CRLF copy is normalised before hashing. Only the importer, P2 and
the tests read it. The importer refuses any of its rows with a Z restriction (`Region_2`/`_5`
other than ∓1,000,000), a WMO restriction or a non-zero `Field_11_2_5_62687_010`, which the
geometry format cannot carry.

**Milestone 0 CSVs.** They still exist on the research machine (checked 2026-09-25) under
`<repo>/.cache/experiments/maps/`, which is gitignored and local. They were fetched on
2026-09-25 as individual requests during research (not scripted crawling), about 18 in total,
from wago.tools (`https://wago.tools/db2/<Table>/csv?build=<build>`). No script or CI job made
them.

All files are UTF-8 text with LF line endings, a trailing newline and a header row. Row counts
exclude the header and come from a quote-aware parser (`Map` has multi-line fields).

| File (in `.cache/experiments/maps/`) | Build | Bytes | Rows | SHA-256 | Used for |
|---|---|---:|---:|---|---|
| `UiMapAssignment_1.60.1.70009.csv` | 1.60.1.70009 | 6,778 | 61 | `79267e8be8034e47daab14350411b3acc0b1f64e86efc9d821a217497254ca0a` | **Source of the committed rows file**: the 12 `db2-csv` rows; frame-hash check |
| `UiMap_1.60.1.70009.csv` | 1.60.1.70009 | 3,097 | 60 | `1f4aac70eaac015b1d2d0ea0faf6e3d7fb2cf7afdf45e5bb6772d9b80a72346b` | **Source of the committed rows file**: names, types, parents of the 11 DB2-only UiMaps |
| `UiMapAssignment_1.60.1.69893.csv` | 1.60.1.69893 | 6,778 | 61 | `79267e8be8034e47daab14350411b3acc0b1f64e86efc9d821a217497254ca0a` | Byte identity with 70009 |
| `UiMap_1.60.1.69893.csv` | 1.60.1.69893 | 3,093 | 60 | `4c5ede52826ef48808aa7c0cd9d63fb3d028df88de1b2041148b164bb42328b2` | Parent/type changes ([coordinates §11.3](research/coordinates.md#113-changes-between-forever-beta-builds)) |
| `UiMapAssignment_1.15.9.69722.csv` | 1.15.9.69722 (Era) | 6,086 | 55 | `da74d3984c2625b4ec3a13d2a7cd93ed8c318dda4ab35ed82f69824a1e273fa1` | `source_bounds` check; negative frame-hash vector |
| `UiMapArt_1.60.1.70009.csv` | 1.60.1.70009 | 2,103 | 144 | `1e2635e147661b322fc2c63be7711230f9525fb88b1dfd7dcf07b4eaa118e968` | §3 art facts |
| `UiMapArtTile_1.60.1.70009.csv` | 1.60.1.70009 | 41,520 | 1,672 | `5e72ffb01f2a54e44d80c40c5cb7ef6724e7c5d0e4cadc84a341227f4e683c74` | §3 tile facts |
| `UiMapArtStyleLayer_1.60.1.70009.csv` | 1.60.1.70009 | 348 | 6 | `a8322f8c5c119f6c018ba47f750b42a8ad7f00f0881f4cec8ad36a35285af499` | §3 styles |
| `UiMapXMapArt_1.60.1.70009.csv` | 1.60.1.70009 | 1,049 | 60 | `81092d619701f0b31a3537129ec5667b38630b5291e211034971a1dde05678dc` | §3 art links |
| `WorldMapOverlay_1.60.1.70009.csv` | 1.60.1.70009 | 60,058 | 1,081 | `1c1df50805e6c65b9c840166542a6752c5ebad3fd8b2ca3715842f4ab5483108` | §3 overlays |
| `WorldMapOverlayTile_1.60.1.70009.csv` | 1.60.1.70009 | 42,204 | 1,739 | `31d8b8c4cae7a1afd312f13a74ba75a461042e00b6e69e2b63809ce9809df02f` | §3 overlays |
| `AreaTable_1.60.1.70009.csv` | 1.60.1.70009 | 148,651 | 1,371 | `33f9e012652d3648757c63081c8d7df2586813fe63aebbf6ad2bd71406d45fec` | New-map AreaIDs ([coordinates §12](research/coordinates.md#12-new-forever-maps-160170009)) |
| `Map_1.60.1.70009.csv` | 1.60.1.70009 | 11,640 | 72 | `97f83110f7f040868bc804aa1dce14a4691d3b8007abd11f4b4f7746009b6e89` | MapIDs 2991/2997, InstanceType |
| `TaxiNodes_1.60.1.70009.csv` | 1.60.1.70009 | 12,384 | 100 | `e3d4833dcb395214c0366d241fdaa4b7d7e2330133bb6db03ed5bfd01f974bea` | Landmark cross-check ([coordinates §9](research/coordinates.md#9-independent-cross-check-flight-masters-vs-taxinodes)) |
| `TaxiPath_1.60.1.70009.csv` | 1.60.1.70009 | 4,578 | 328 | `07222b184a692c0b275ad713bbb30e1a88e8da14e3f2e26d9afb6d6b59e41404` | Research only (taxi timings stay local, D-022) |
| `UiMapLink_1.60.1.70009.csv` | 1.60.1.70009 | 29 | — | `721db986bbf76b8cdc085d504fb9cc5dad36d02deade0e7f14eb765b5bcb58d8` | **Not a CSV**: the body is the JSON error `{"errors":"Table not found."}` |

The same folder also holds WoWDBDefs `.dbd` files, `dbd-manifest.json`, `builds.json` (the
wago.tools build list) and the scratch scripts `csv.js`, `worked.js`, `steps.js` and
`tablecheck.js`. None of them is a placeholder input.

Caveat: wago.tools does not echo the served build inside the CSV. The two `UiMap` files differ
between 69893 and 70009, which shows those two requests were served from different builds. That
a 70009 request was served from exactly 70009 is not independently verified.

**Reference rows: the 12 `db2-csv` rows.** From `UiMapAssignment` at 1.60.1.70009, with
`Name_lang`, `Type` and `ParentUiMapID` from `UiMap` at 1.60.1.70009. On every row, `Region_2` =
−1,000,000, `Region_5` = +1,000,000, and `WMODoodadPlacementID` = `WMOGroupID` = 0. These are
individual cited client values (D-022), committed by D-018 in the rows file above. With the 49
QuestieDB frames they make up the whole `UiMapAssignment` table at 1.60.1.70009, the exception
D-026 records.

| UiMap | Name | Type | Parent | ID | Order | MapID | AreaID | UiMin (u, v) | UiMax (u, v) | Region_0 (Xmin) | Region_3 (Xmax) | Region_1 (Ymin) | Region_4 (Ymax) |
|---:|---|---:|---:|---:|---:|---:|---:|---|---|---:|---:|---:|---:|
| 947 | Azeroth | 1 | 0 | 46785 | 0 | 1 | 0 | 0.03990000114, 0.08550000191 | 0.40830001235, 0.92339998484 | −12800 | 12266.700195312 | −9600 | 6933.2998046875 |
| 947 | Azeroth | 1 | 0 | 46784 | 1 | 0 | 0 | 0.55049997568, 0.09939999878 | 0.89660000801, 0.86909997463 | −16000 | 6933.2998046875 | −7466.7001953125 | 8000 |
| 1414 | Kalimdor | 2 | 947 | 46724 | 0 | 1 | 0 | 0, 0 | 1, 1 | −11733.299804688 | 12799.900390625 | −19733.2109375 | 17066.599609375 |
| 1415 | Eastern Kingdoms | 2 | 947 | 46725 | 0 | 0 | 0 | 0, 0 | 1, 1 | −16000 | 7466.6000976562 | −19199.900390625 | 16000 |
| 1463 | Eastern Kingdoms | 2 | 0 | 46774 | 0 | 0 | 0 | 0, 0 | 1, 1 | −15980 | 5817 | −11880 | 9917 |
| 1464 | Kalimdor | 2 | 0 | 46775 | 0 | 1 | 0 | 0, 0 | 1, 1 | −11870 | 12470 | −13370 | 10970 |
| 2482 | Mount Hyjal | 3 | 1414 | 69032 | 0 | 1 | 616 | 0, 0 | 1, 1 | 3989.5830078125 | 6304.166015625 | −4395.833984375 | −922.916015625 |
| 2521 | Zephras Isle | 3 | 947 | 69208 | 0 | 2991 | 16593 | 0, 0 | 1, 1 | 1247.9169921875 | 4956.25 | −1331.25 | 4231.25 |
| 2524 | Darkspear Islands | 6 | 1414 | 69219 | 0 | 2997 | 16606 | 0, 0 | 1, 1 | −835.416015625 | 447.916015625 | 993.75 | 2918.75 |
| 2548 | Riverglades | 3 | 1415 | 69323 | 0 | 0 | 16591 | 0, 0 | 1, 1 | −9700 | −6466.666015625 | −6741.666015625 | −1891.666015625 |
| 2652 | Shen'dralas | 3 | 1414 | 69778 | 0 | 1 | 16651 | 0, 0 | 1, 1 | −3266.666015625 | −1900 | −25 | 2025 |
| 2665 | Zephras Isle | 3 | 0 | 69852 | 0 | 2991 | 0 | 0, 0 | 1, 1 | 1247.9200439453 | 4956.25 | −1331.25 | 4231.25 |

The 12 rows' CSV lines, LF-joined in file order with a trailing LF, hash to
`0aff6391a197d4ff33a2f56bd3388ca72f305a5543fc646682580437646870bb`. This is a convenience check.
The 49 remaining rows equal `conversion.json` `target_bounds` bit for bit (checked 2026-09-25).

**Reproduction (Milestone 2 onward, any machine, CI included).**

1. `pnpm maps:placeholder` (`tsx tools/maps/import.ts --placeholder`) reads the pinned
   `conversion.json` LF blob (from the `tools/questiedb/fetch.ts` checkout) and
   `tools/maps/inputs/db2-rows-1.60.1.70009.json`, and writes both placeholder files. It reads no
   CSV and makes no request to wago.tools. `--check` compares instead of writing.
2. `pnpm maps:validate` runs R1, P0-P7 (§5.5).

**Re-pin check (2026-09-30, D-050).** At the pin 1.60.1.70124, `UiMap` and `UiMapAssignment` have the
CKeys they had at 1.60.1.70009, and `import.ts --build 1.60.1.70124` writes a local geometry whose 60
UiMaps and 61 rows pass L4 against the committed placeholder: the frame hash is `2cb10551…` and every
row, the 12 `db2-csv` rows included, is identical. So the rows file keeps its 70009 citations (the CSVs
it cites are of that build), and `import.ts --placeholder --check` and `make-db2-rows.ts --check` pass
unchanged ([reviews/repin-70124.md](reviews/repin-70124.md)). Relabelling the rows to 70124 would need
70124 CSVs or a rows format that cites a client extraction; that is the architect's call.

**Writing the rows file (once, Milestone 2; done).** `tools/maps/lib/make-db2-rows.ts`
implements steps 1-2 (and, with the QuestieDB checkout, checks that the other 49 CSV rows are
exactly the `conversion.json` UiMaps); `--check` compares with the committed file. It never
downloads anything. The committed file was written with it on 2026-09-25 from the research CSVs
listed above.

1. Generate it from `UiMapAssignment_1.60.1.70009.csv` and `UiMap_1.60.1.70009.csv` in
   `.cache/experiments/maps/`, parsing by column name, after checking both SHA-256 values
   against the inventory table above.
2. Check the 12 rows and 11 UiMaps against the reference table above, and the 12 raw CSV lines
   against `0aff6391…`.
3. If the research CSVs are missing (another machine, or a cleared `.cache/`), use a
   developer-local extraction at 1.60.1.70009 (§5.4 a). Its bytes differ (column order, float
   formatting), but its values must equal the reference table after `Math.fround`; record that
   source in the file. Fetching the two tables again from wago.tools is allowed only as
   individual requests, never by a script, loop or CI job: its `robots.txt` disallows crawling
   (D-011).
4. On a hash mismatch against the inventory (wago.tools may reformat or re-serve a table), do not
   edit values. Compare the parsed rows with the reference table and the 49 frames with the
   frame hash (§5.6):
   - if all values are equal, record the new CSV hash in the rows file and in `NOTICE.md`, with a
     note;
   - if any value differs, stop: the build's geometry changed and needs owner review.

*Superseded by ARCHITECTURE §6 and D-018:* the first revision-2 draft had `import.ts
--placeholder` read the two CSVs from `assets-source/maps/placeholder-inputs/1.60.1.70009/`,
re-downloaded when missing. That made the committed placeholder depend on local, uncommitted
files; the committed rows file replaces it.

The scratch scripts in `.cache/experiments/maps/` are CommonJS. Since the repository's
`package.json` declares `"type": "module"`, running them in place fails with
`require is not defined`. Run copies renamed to `.cjs` ([coordinates §16](research/coordinates.md#16-reproducing-these-numbers)).

## 9. Redistribution record (no legal conclusions)

This section records evidence and owner decisions. It is not legal advice, and it draws no legal
conclusions.

1. **Blizzard terms.** The Blizzard EULA (the fetched page states a last revision of 2024-03-21)
   says Blizzard owns game content, data and code (§2.A). It restricts copying, reproduction and
   derivative works except as permitted (§1.C.i). Map art, BLP tiles and DB2 tables are client
   content. Its §1.C.vi addresses unauthorised software that reads or "mines" information stored
   by the platform. Whether offline reading of local CASC files falls under it was not assessed.
2. **Legal FAQ.** Blizzard's Legal FAQ describes a limited, revocable permission to use its images
   on web pages for personal, non-commercial purposes, with notices and without alteration.
   Whether stitched or composited map images would fit it was not assessed. The owner's posture
   was that no map art is committed or deployed (D-018; STATUS OD-10, default "never").
   *Superseded by D-033 (2026-09-26):* the owner decided to commit and deploy the painted map art
   with a NOTICE naming Blizzard Entertainment as its owner, under four project rules
   (non-commercial, notices kept, prompt removal on request, no hacks or cheats); D-033 records the
   Legal FAQ as the governing source and draws no legal conclusion (§5.4 (b), THIRD_PARTY_NOTICES
   "Map art").
3. **Tool licences.** wow.export, TACTSharp, DBCD and CascLib declare MIT in their licence files.
   The project does not treat any tool's licence as permission for the files the tool extracts.
4. **Beta status.** The owner states that the Forever beta has no NDA and is public (D-022). On
   that basis, individual client-derived values may appear in committed docs and tests when they
   cite table, build and column. Bulk client tables and art stay local (the committed placeholder
   is the one recorded exception, item 5), and taxi-derived leg timings are local-only by
   default. The beta's terms themselves were not reviewed here.
   *Superseded by D-022:* revision 1 recorded the beta terms as UNKNOWN and asked for a check
   before publishing any beta-derived numbers.
5. **Client values in the committed placeholder.** The 12 `db2-csv` rows are Blizzard client
   values, committed by owner decision (D-018) with citations in
   `tools/maps/inputs/db2-rows-1.60.1.70009.json`. With the 49 `conversion.json` rows, the
   committed file holds every `UiMapAssignment` row of 1.60.1.70009; D-026 records this as an
   explicit exception to D-022's "bulk tables stay local". That others (QuestieDB, wago.tools)
   publish the same numbers is recorded as a fact, not as permission.
   *Superseded by D-018:* revision 1 limited the placeholder to what the QuestieDB lineage
   already contained.
6. **Questie lineage.** The 49 frames and the Era→Forever coefficients come from QuestieDB
   `conversion.json`. `Questie/Questie` and `Questie/QuestieDB` have no root licence file (none
   covering Questie's own code or data), and never had one on their default branches; the
   licence files in Questie's subfolders cover bundled third-party material only. Questie's unmerged `license` branch (commits `ce65498c`,
   2023-02-13, to `842201bd`, 2024-05-06) drafts a `LICENSE.md`. The draft says that, when in
   doubt, Questie should be considered "all rights reserved". It also drafts a CLA to relicense
   contributions as MIT (CC0 where MIT does not apply). The owner's posture is to publish the
   derived files with prominent notices and to accept the risk (D-016). This is not a legal
   conclusion.
7. **This repository's licence.** The repository's own code is GPL-3.0-or-later (D-001, D-016).
   The owner's posture is stated in every notice, the placeholder `NOTICE.md` included (§8.2),
   with the carve-out verbatim from DATA_PROVENANCE §3.2: "GPL-3.0-or-later applies to this
   project's contributions and, as a posture, to Questie-derived data; it grants no rights over
   Blizzard content (names, text, client-derived values) or other third-party material embedded
   in that data." This is not a legal conclusion.
   *Superseded by D-016 (LIC-10):* revision 1 said the GPL "covers this project's code and
   Questie-derived data". *Superseded by DATA_PROVENANCE §3.2:* this item's first revision-2
   wording paraphrased the carve-out and left out the posture clause.
8. **react-leaflet.** react-leaflet 3.x-5.x declares `Hippocratic-2.1` (npm registry; 2.8.0
   declared MIT). The owner's posture is not to use it and to use Leaflet (declares BSD-2-Clause)
   directly (D-005). This is not a legal conclusion.
9. **Other planners and map packs.** Never copied, whatever licence they declare.
10. **Hosting.** Anything committed to the public repository, or present in `dist/`, is
    published. Local map sets live outside `public/`, are served only by the dev/preview plugin,
    and `audit-dist` fails on map-like output. Deployable builds come from CI on a clean checkout
    (D-018, D-025). A developer's own `vite preview` shows local maps on that machine only.
11. **wago.tools.** No terms page was found, and `robots.txt` has `Disallow: /`. The owner's
    posture is manual use only (D-011). The placeholder's two source CSVs were fetched as
    individual requests during research (not scripted crawling). Reproducing the placeholder
    reads the committed rows file and makes no request (§8.3).
12. **Privacy.** wow.export uploads `Cache/` files from local installs by default (§4.1). This
    data-leak risk is separate from redistribution.
13. **The painted atlas tiles** (`public/maps/atlas/`, D-042, committed): Blizzard Entertainment's
    painted zone and city art, composited by this project's tool (`tools/maps/atlas.ts`) with
    terrain-derived masks, tint, relief shading and sea (D-032). Its NOTICE and manifest list the
    alterations the owner accepted as within D-041 H (D-042 O11): masking to each zone's terrain
    polygon, painted ground and coastal band with a colour cross-fade; labels hidden by a mirror fill
    (11 in the reviewed list); our tint where no painting shows; our sea colours; resampling and WebP
    q80. D-033's terms apply.
14. **The minimap tiles** (`public/maps/minimap/`, D-045, D-049): Blizzard Entertainment's minimap
    textures from the same client, stitched, recoloured to a navy sea and resampled by
    `tools/maps/minimap.ts`, with the alterations listed in the folder's NOTICE and manifest (D-049
    O15). **The tiles are not committed** (O14): `main` holds the index, manifest, NOTICE and the
    pointer `pack.json`; the tiles ship in a release-asset pack (`NOTICE.md` first, then
    `manifest.json`, then `t/`) whose release text is the NOTICE, downloaded and verified by
    `pnpm maps:minimap:fetch` and required only by the deploy build (`pnpm build:deploy`). The
    release is published only when the owner authorises pushing (OD-13). Removal on request: delete
    the asset and release, commit the removal of the folder, redeploy Pages and confirm the tile URLs
    return 404; copies already downloaded cannot be recalled. D-033's terms apply.
15. **The per-image art since ATL.10** (D-042 O5): `public/maps/art/` deploys only the five images
    still drawn one at a time; the others remain in git history from the commits before ATL.10.

## 10. Risks and open questions

| # | Item | Owner / next step |
|---|---|---|
| M1 | The Forever beta changes `UiMapAssignment` for the 49 shared frames, putting QuestieDB data in a stale frame | Frame hash (§5.6): local sets fall back with a banner. A QuestieDB pin bump re-runs P1-P5 (D-013). |
| M2 | TACTTool list syntax, encryption support and DBC2CSV definition flags are unverified | Try them in `.cache/experiments/` in Milestone 3 |
| M3 | Where Zephras Isle (MapID 2991) and Darkspear Islands (2997, InstanceType 3) sit on the world map | **Answered for 1.60.1.70009** (map-atlas.md §3.1, [coordinates.md C1](research/coordinates.md)): the client places **neither** on Azeroth 947 (`UiMapAssignment` has 947 rows only for MapIDs 0 and 1; `UiMapLink` has 0 records; `Map` parents are −1). Rows a server sends at run time are UNKNOWN. The atlas therefore shows Zephras Isle as a card "not in position" (D-042 O2), and Darkspear Islands keeps its own surface. |
| M4 | 98 RXP Forever percent-form `.goto` lines on the changed zones may be Era-framed | Import-time frame option and `RXP030-frame-ambiguous` (ARCHITECTURE §10); landmark review |
| M5 | Commit the 12 DB2-only geometry rows? | **Decided: commit** (D-018, STATUS OD-5) |
| M6 | May any real map art ever be deployed? | **Decided: yes** (D-033, STATUS OD-10): the painted art, and the minimap textures (D-045, D-049), with NOTICEs (§9) |
| M7 | wago.tools `robots.txt` disallows crawling, and some sibling tooling uses it | Manual only (D-011); never in CI. The 12 rows are committed with citations in `tools/maps/inputs/db2-rows-1.60.1.70009.json`, so reproducing the placeholder needs no request (§8.3). |
| M8 | A frame-compatible local set has different rows for one of the 11 `db2-csv` UiMaps (a later build) | **Decided** (ARCHITECTURE §6): local geometry may only add UiMaps. A differing row for a UiMap the committed file has rejects the whole local set as a frame mismatch (§5.6 step 4). *Superseded:* the proposal that local rows win on that machine. A later build that really changes these rows needs a new committed rows file and owner review. |
| M9 | wago.tools may not serve exactly the requested build | Not verified (§8.3 caveat). Mitigated by row-level comparison and the frame hash. |
| M10 | The path cap and the zone-zoom threshold are unmeasured | Milestone 3 measurement against the ARCHITECTURE §14 map budgets |
| M11 | RXP world-form gotos carry a UiMapID (`<UiMap>/<MapID>`) that the world `SourcedPoint` could not hold | **Decided** (ARCHITECTURE §6, `src/domain/points.ts`): the world variant has a `uiMapId: UiMapId \| null` hint, so the prefix survives lowering and canonical re-emission (§6; [coordinates §15](research/coordinates.md#15-coordinate-model-srcgeo)) |

## 11. Sources

- Local, read-only: `<wow-install>/.build.info`, `<wow-install>/_classic_beta_/.flavor.info`,
  and the `<wow-install>/Data/` directory listing (2026-09-25).
- QuestieDB `b6f5b07b`: `data/Forever/conversion.json`,
  `tools/dbc/{README.md,coordinates.py,maps.py,download.py}`, `support/Forever/Zones/*.lua`,
  `docs/{forever.md,forever-data.md,forever-coordinate-audit.md,forever-map-override-audit.md,forever-spatial-validation.md,api.md}`.
  `docs/client-metadata-probes.md` is about TOC metadata and has no map content.
- wow.export `c2fd7bde` (0.2.19): `package.json`, `LICENSE`, `src/js/constants.js`,
  `src/js/casc/casc-source-{local,remote}.js`,
  `src/js/modules/{tab_zones,tab_maps,tab_data,screen_source_select}.js`,
  `src/js/workers/cache-collector.js`, `src/default_config.jsonc`, `src/js/db/WDCReader.js`,
  `build.json`.
- WoWDBDefs `cf84e010` (`definitions/*.dbd`, `manifest.json`). TACTSharp, DBC2CSV and
  wow.tools.local READMEs (raw.githubusercontent.com, 2026-09-25).
- wago.tools `/api/builds` and the per-table CSV endpoint (2026-09-25, individual research
  requests; inventory in §8.3), plus `robots.txt`.
- Blizzard patch server `https://us.version.battle.net/wow_classic_beta/versions` (2026-09-25).
- Questie `40016145`, `Libs/HereBeDragons/HereBeDragons-2.0.lua`. RXPGuides `c3429e06`:
  `functions.lua` and `Guides/Forever/*`, read for behaviour and counts only (D-019).
- Leaflet v1.9.4 `src/geo/crs/CRS.Simple.js`. npm registry metadata for leaflet, react-leaflet,
  sharp and pngjs.
- Milestone 0 critique (level-of-detail counts, placement findings):
  [reviews/review-m0-architecture.md](reviews/review-m0-architecture.md).
- Blizzard EULA: https://www.blizzard.com/en-us/legal/fba4d00f-c7e4-4883-b8b9-1b4500a402ea/blizzard-end-user-license-agreement
  and Legal FAQ: https://www.blizzard.com/en-us/legal/c1ae32ac-7ff9-4ac3-a03b-fc04b8697010/blizzard-legal-faq
  (fetched and paraphrased 2026-09-25).

## 12. Superseded recommendations

Revision 1 recommendations first, then first-draft revision 2 proposals that the architect's
rulings on the Milestone 0 consistency check replaced.

| Earlier recommendation | Now |
|---|---|
| Local map sets under `public/maps/<build>/`, protected by `.gitignore` | Superseded by D-018: `local-maps/` outside `public/`, served only by `tools/maps/vite-local-maps.ts`; `audit-dist` rules (§5.7) |
| Use the local set when its manifest build matches | Superseded by D-018 (F09): frame hash of the 49 shared rows (§5.6); fixed discovery path `local-maps/maps.manifest.json` |
| Local DB2 geometry named `geometry.json`, one provenance per file | Superseded by D-018 (LIC-02): `geometry.local.json`; `source` and `build` on every row |
| `import.ts --from-questiedb` produces the placeholder | Superseded (ARCHITECTURE §3): `tools/maps/import.ts --placeholder`, the only producer |
| DB2-only rows (continents, 947, 1463/1464, new maps) not committed by default | Superseded by D-018: committed as `db2-csv` rows from hash-recorded CSVs |
| Placeholder continent extent from the union of zone frames | Superseded by D-018: committed continent frames; union only for 2991/2997 |
| Beta terms unknown; check before publishing numbers | Superseded by D-022 (owner: no NDA) |
| "GPL covers Questie-derived data" | Superseded by D-016 wording (§9 item 7) |
| Route steps stored as `WorldPoint`, converted at import | Superseded by D-017: `Location` stores the authored `SourcedPoint`; resolved at runtime |
| `UiSurface` for Azeroth 947 and a 947 connector | Deferred until after the MVP (F23); then superseded by D-042: the atlas surface places maps 0 and 1 by translation from the 947 rows, in a compact layout, without drawing the 947 painting (§7.1) |
| Placeholder hex-bin "terrain hint" | Folded into level of detail as an optional aggregate (§7.2, PERF-7) |
| Zone names from QuestieDB "zone and l10n tables" | Corrected (LIC-13; §8.1) |
| Manifest `generatedAt` | Dropped for byte reproducibility (§5.3) |
| Revision 2 draft: frame-compatible local rows replace committed `db2-csv` rows on that machine | Superseded by ARCHITECTURE §6: local geometry only adds UiMaps; a differing row for a committed UiMap rejects the whole set (§5.6 step 4, M8) |
| Revision 2 draft: placeholder reads two CSVs copied to `assets-source/maps/placeholder-inputs/1.60.1.70009/`, re-downloaded when missing | Superseded by ARCHITECTURE §6 and D-018: committed `tools/maps/inputs/db2-rows-1.60.1.70009.json` plus the pinned `conversion.json` (§8.3) |
| Revision 2 draft: one folder per local set, a copied discovery manifest and a separate `validation.json` | Superseded by ARCHITECTURE §7.3: one set directly in `local-maps/` (`maps.manifest.json`, `geometry.local.json`, `art/`, optional `taxi.local.json`), activated by `validate.ts --activate` (§5.2, §5.3) |
| Revision 2 draft: placeholder NOTICE says the GPL "covers this project's contributions (the format and the generator)" | Superseded by DATA_PROVENANCE §3.2: the carve-out verbatim (§8.2, §9 item 7) |
| Revision 2 draft: inaccurate wording of how the placeholder CSVs were obtained | Corrected: fetched as individual requests during research, not scripted crawling (§8.3) |
| Revision 2 draft: world `SourcedPoint` without the RXP UiMapID (M11 open) | Resolved by ARCHITECTURE §6: optional `uiMapId` hint on the world variant (§6) |
| Revision 2 draft: frame-hash encoding as a Milestone 0 proposal | Ratified by ARCHITECTURE §6 (§5.6) |
| Revision 2 draft: `eraToForever` block as a proposed coefficient source | Ratified by ARCHITECTURE §6 (§5.3, P5) |
