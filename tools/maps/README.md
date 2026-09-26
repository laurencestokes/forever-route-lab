# tools/maps

Map-metadata tooling (docs/MAPS.md, docs/research/coordinates.md; ARCHITECTURE §6-§7; D-011,
D-017, D-018, D-022, D-026). Everything here runs in Node under `tsx`; the coordinate maths it
uses is the pure `src/geo` module the app uses.

## Commands

| Command | Does |
|---|---|
| `pnpm maps:placeholder` | `tsx tools/maps/import.ts --placeholder`: writes `public/maps/placeholder/geometry.placeholder.json` and `NOTICE.md` |
| `pnpm maps:validate` | `tsx tools/maps/validate.ts`: placeholder checks R1, P1-P8 (MAPS.md §5.5) |
| `pnpm tsx tools/maps/import.ts --placeholder --check` | Rebuilds in memory and fails if either committed file differs |
| `pnpm tsx tools/maps/validate.ts --skip-tracking` | The same checks without P6 (git tracking), for use before the files are committed |
| `pnpm tsx tools/maps/validate.ts --local [dir] [--taxi-nodes <csv>]` | Also checks a local set (default `local-maps/`): L0-L7, and L8 against an existing manifest |
| `pnpm tsx tools/maps/validate.ts --activate [--source <source.json>]` | On a pass, writes `local-maps/maps.manifest.json` with its `art` section (activates the set); on a failure removes it |
| `pnpm tsx tools/maps/lib/make-db2-rows.ts [--check]` | Regenerates (or checks) the committed rows file from the two research CSVs, where they exist |

Common options: `--questiedb-repo <dir>` (default: the pin's `cachePath`, `.cache/questiedb`, the
checkout `tools/questiedb/fetch.ts` provides), `--commit <40-hex sha>` (must equal the pin; there
is no hash for any other commit), `--rows <file>` (default the committed rows file). Unknown
options fail.

## The placeholder (Milestone 2)

`import.ts --placeholder` has exactly two inputs, so any machine, CI included, reproduces both
output files byte for byte with no network request:

1. QuestieDB `data/Forever/conversion.json` at the pinned commit, read as the **LF git blob**
   (`git cat-file blob <commit>:<path>`, never the CRLF working file of a Windows clone) and
   checked against the pinned SHA-256 (`f4477d6c…` at `b6f5b07b`). The pin comes only from
   `tools/questiedb/upstream.json`, read with the data pipeline's `parseUpstream`
   (`tools/questiedb/lib/upstream.ts`): its commit, repository, `cachePath` and the SHA-256 of its
   `data/Forever/conversion.json` input (`lib/pin.ts`). Both are required. The DATA_PROVENANCE §2
   and §4.1 values are only a test oracle (`lib/test-support.ts`). Git runs with
   `GIT_NO_LAZY_FETCH=1` and `windowsHide` (`lib/git.ts`).
2. `inputs/db2-rows-1.60.1.70009.json`: the 12 DB2-only `UiMapAssignment` rows for 11 UiMaps
   (947 twice, 1414, 1415, 1463, 1464, 2482, 2521, 2524, 2548, 2652, 2665) and those UiMaps'
   `Name_lang`, `Type`, `ParentUiMapID`, each with table, build, row ID and CSV line, every value
   as the CSV's decimal string, plus both full CSVs' SHA-256. It is hashed as LF bytes.

Output (`public/maps/placeholder/geometry.placeholder.json`, about 28 kB):

- 49 `questiedb-conversion` UiMaps (build 1.60.1.69893) from `geometry.transforms[]`:
  `xMin/xMax/yMin/yMax` = `target_bounds.bottom/top/right/left`, `id` = `target_assignment_id`,
  name = `target_name`, `type`/`parent` null (conversion.json does not carry them). OrderIndex 0
  and the `(0,0)-(1,1)` UI rectangle are implied by QuestieDB's eligibility rule
  (`tools/dbc/coordinates.py:33-47`) and recorded under `inputs.questiedb-conversion.implied`.
- 11 `db2-csv` UiMaps, 12 rows (build 1.60.1.70009) from the rows file (`Region_0/3/1/4`).
  Rows with a Z, WMO or unnamed-field restriction are refused, because the format cannot carry
  them.
- `eraToForever`: the coefficients of every `changed` transform (1412, 1423, 1433, 1453), with
  `fromBuild`/`toBuild`; unchanged transforms must have identity coefficients.
- `frameHash`: SHA-256 of `canonicalFrameTuples` over the 49 frames (`2cb10551…`).
- `contentHash`: SHA-256 of `canonicalGeometryContent` (`src/geo/content.ts`): every row, name,
  parent and coefficient (`c05a47a2…`; MAPS.md §5.3). `infra/maps` recomputes it and refuses the
  file on a mismatch; `validate.ts` P8 checks it.
- `_generated` first; LF; final newline; fixed key order (`lib/json.ts`).

`NOTICE.md` is generated with it (`lib/notice.ts`): both origins and their hashes, the frame and
content hashes, D-016, D-018, D-022, D-026, the DATA_PROVENANCE §3.2 carve-out verbatim,
non-affiliation. It has no timestamp.

## The rows file (written once)

`lib/make-db2-rows.ts` wrote `inputs/db2-rows-1.60.1.70009.json` from
`UiMapAssignment_1.60.1.70009.csv` and `UiMap_1.60.1.70009.csv`, the research CSVs fetched from
wago.tools on 2026-09-25 as individual requests during research (MAPS.md §8.3). It checks both
CSVs' SHA-256 against the inventory, the row counts, columns by name, the 12 assignment IDs, the
raw-lines hash `0aff6391…`, the MAPS.md §8.3 reference table, and (with the QuestieDB checkout)
that the other 49 rows are exactly the `conversion.json` UiMaps. **It never downloads anything**
(D-011). Nothing else reads the CSVs; if they are missing, the placeholder is still reproducible.

## Local sets (checks, activation and serving; extraction from the client is Milestone 3b)

`validate.ts --local` checks `local-maps/geometry.local.json` (`"kind": "local"`,
`"redistribution": "local-only"`, a top-level `build`, rows `source: "local-db2"`):

| Check | What |
|---|---|
| L0 | The file parses as a local geometry for the placeholder's product |
| L1 | Every Type 3/6 UiMap has exactly one OrderIndex 0 row with the full UI rectangle |
| L2 | Isotropy against the art aspect (1.5; 1.0 for 1463/1464; 2665 exempt), 0.2% |
| L3 | Art (`lib/art.ts`): each file directly in `art/` is `<uiMapId>.png` or `.webp`, one per UiMap; its PNG/WebP headers parse and match the name (still images only; headers are read with `src/infra/maps/image-header.ts`, nothing is decoded); the UiMap has exactly one row in `geometry.local.json`, OrderIndex 0 with the full UI rectangle; its size is the UiMap's art size (1002 × 668; 512 × 512 for 1463, 1464, 2665); its aspect equals the row's world aspect within 0.2% (2665 exempt) |
| L4 | Frame hash equals the committed one, and every UiMap both have has identical rows (`mergeLocalGeometry`): local sets may only add UiMaps |
| L5 | With `--taxi-nodes <TaxiNodes.csv>`: every node lies inside a zone frame on its world map |
| L6 | With `--taxi-nodes`: TaxiNodes 2, 23, 22, 5, 67, 68 within 30 yd of QuestieDB flight masters 352, 3310, 2995, 931, 12617, 12636 (four of them on the changed frames 1453, 1433, 1423) |
| L7 | Percent → world → percent below 1e-9 on every row of the merged geometry |
| L8 | `--local` only, with an existing manifest: the geometry, art and taxi hashes, art sizes and bounds still match the files; otherwise not run. `--activate` never runs it |

L5/L6 without a TaxiNodes CSV are recorded as not run and do not block activation.
`--activate` needs `assets-source/maps/<product>/<build>/source.json` (or `--source`): product,
build, 32-hex `buildKey`, `method` (`tacttool-local`, `tacttool-cdn`, `wow.export-gui`), `tools`
versions and the WoWDBDefs commit; it must contain no local paths. The manifest has no timestamp
and always carries `"redistribution": "local-only"`, which `audit-dist` refuses in `dist/`.

The manifest's `art` section lists every art file that passed L3, keyed by UiMapID:
`{ "file": "art/1411.webp", "contentType", "width", "height", "sha256", "bounds": { "assignment",
"mapId", "xMin", "xMax", "yMin", "yMax" } }`, where `bounds` is the UiMap's row in
`geometry.local.json` and `sha256` covers the file's bytes as they are. `infra/maps` checks each
entry against the local geometry at load and each file's SHA-256 and headers when it is first
drawn (docs/MAPS.md §5.3, §5.6).

Until `convert.ts` exists (Milestone 3b, with the CASC reader), art can only be placed by hand, for
example wow.export Zones-tab PNGs saved as `local-maps/art/<uiMapId>.png` (docs/MAPS.md §5.4 (c));
L3 checks them like any other art.

`vite-local-maps.ts` (`localMaps()` in `vite.config.ts`) serves `local-maps/` at
`<base>local-maps/` in `vite` and `vite preview` only: no build hooks, the folder must lie outside
`publicDir` and `outDir`, traversal, hidden names and links out of the folder are refused, missing
files answer 404, and every answer is `no-store` with its content type (docs/MAPS.md §5.7).

## Layout

```
import.ts               --placeholder (Milestone 2); --build is not built yet (planned with the Milestone 3b extraction)
validate.ts             placeholder checks; --local / --activate
vite-local-maps.ts      dev/preview-only Vite plugin serving local-maps/ (Milestone 3)
inputs/db2-rows-1.60.1.70009.json   the 12 cited DB2 rows (committed)
lib/args.ts             strict option parsing
lib/art.ts              L3 (art files, headers, sizes, placement), the manifest's art section, L8 art drift
lib/checks.ts           R1, P0-P5, P7, P8 (P6 in validate.ts)
lib/constants.ts        reference frame hash, expected IDs, research-CSV inventory, art aspects
lib/conversion.ts       fail-closed reader for conversion.json's geometry block
lib/csv.ts              quote-aware LF CSV reader
lib/db2-rows.ts         rows file: build from CSVs, parse, reference table, rows → geometry
lib/git.ts              git blobs, commit resolution, tracking (GIT_NO_LAZY_FETCH, windowsHide)
lib/hash.ts             SHA-256, git blob ids, LF normalisation
lib/inputs.ts           reads the pinned inputs and builds the placeholder in memory
lib/json.ts             deterministic JSON formatting
lib/local-set.ts        L0-L8, activation manifest, deactivation
lib/make-db2-rows.ts    one-off regeneration script for the rows file
lib/notice.ts           NOTICE.md text
lib/pin.ts              QuestieDB pin and conversion.json hash, from tools/questiedb/upstream.json
lib/placeholder.ts      buildPlaceholder
lib/test-support.ts     fixtures for the tests only (generated test images: src/infra/maps/test-images.ts)
```
