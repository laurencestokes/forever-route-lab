# tools/casc

A read-only reader for the local World of Warcraft client's CASC storage and its WDC5 DB2 tables
(docs/research/terrain-navigation.md §2, §2.1, §15; D-028). `tools/terrain` (navigation and terrain
byproducts) and `tools/maps` (map metadata and art, step 3b.8) both use it. Everything runs in
Node under `tsx`. It has no dependencies beyond Node's `crypto`, `fs` and `zlib`.

## Rules it enforces

- **Where it reads.** The install comes from `WOW_INSTALL` (`resolveInstall()`), else
  `C:\Program Files (x86)\World of Warcraft`. Only `<install>/.build.info` and
  `<install>/Data/{config,data}` are read, opened read-only. `paths.ts` is the only module that
  builds install paths, and it validates every name. No other install folder is named, listed or
  opened, and nothing is ever written. `casc.test.ts` scans the reader sources for write calls,
  network calls and other install folder names (gate G16).
- **What it keeps.** `.build.info` keeps four columns: product, version, build key and CDN key.
  Tags, CDN hosts and the install key are dropped while parsing.
- **Fail closed.** Every failure is a `CascError` with a `code` (`format`, `missing`, `encrypted`,
  `integrity`, `pin`, `path`, `layout`). The reader never falls back to the CDN. It never
  decrypts, and it never returns zero-filled bytes unless the caller asked for them.
- **No bitwise operators** (D-012): bit tests, XOR and 40-bit offsets use division and modulo
  (`bytes.ts`).
- **No raw client files leave memory.** Callers must not write what they read, except derived
  outputs (meshes, statistics, web images) as their own design allows.

## API

### Opening and reading files

```ts
import { LocalCasc } from './casc';
import { resolveInstall } from './paths';

const casc = LocalCasc.open({
  install: resolveInstall(),
  product: 'wow_classic_beta',
  pin: { product: 'wow_classic_beta', version: '1.60.1.70124', buildKey: 'dd3dfc2881c407299f46c2aaf34c130b' }, // optional; gate G1
});
const wdt = casc.file(782779);   // CascFile; throws CascError on any problem
casc.close();
```

| Member | Meaning |
|---|---|
| `LocalCasc.open({ install, product, pin? })` | `.build.info` → the one active row of `product` (pin checked: `pin` error) → build config → the newest `.idx` per bucket → encoding table (MD5 = its CKey) → root manifest (MD5 = its CKey). About 0.85 s and 315 MB RSS on the Forever client (the decoded encoding table stays resident). |
| `build: BuildInfoRow` | `{ product, version, buildKey, cdnKey }` of the opened build; record it in outputs |
| `buildConfig: BuildConfig` | `{ rootCKey, encodingCKey, encodingEKey }` |
| `stats: CascStats` | `indexEntries`, `indexFiles`, `encodingBytes`, `encodingPages`, `rootBytes`, `root: { blocks, entries, fileDataIds, encryptedFlagFileDataIds }`, `openMs` (timings, not deterministic) |
| `file(fileDataId, { encrypted?: 'fail' \| 'zero-fill' })` | `CascFile`: `{ fileDataId, ckey, ekey, data: Buffer, verified, chunks, encryptedRanges, keyNames, storedSize, headerless }`. Default `fail`: an encrypted BLTE chunk is an `encrypted` error. `zero-fill`: the chunks come back as zeros, listed in `encryptedRanges`, and `verified` is false; use it only for DB2 tables (`readDb2`). Otherwise `verified` is true: MD5(data) = CKey, and the size equals the encoding table's. |
| `has(fileDataId)`, `ckeyOf(fileDataId)` | Whether the root manifest keeps an enUS entry; its CKey (hex) or null. Use `ckeyOf` for input hashes: SHA-256 over sorted (FileDataID, CKey). |
| `encryptedFlag(fileDataId)` | The root's Encrypted content flag of the kept entry |
| `fileDataIds()` | The kept FileDataIDs, ascending (a copy) |
| `headerlessEntries` | Entries read so far that start with `BLTE` instead of the 0x1E local header |
| `close()` | Closes the archive file descriptors |

`file()` errors: `missing` (not in the enUS root, not in the encoding table, not in the local
indices, or an all-zero entry the client has not downloaded yet), `encrypted`, `integrity`
(a BLTE chunk MD5, an encoding page MD5, the file MD5 or the size), `format` (anything that does
not parse).

### DB2 tables

```ts
import { readDb2 } from './db2';
import { DB2 } from './layouts';

const areas = readDb2(casc, DB2.AreaTable);                          // skips its 3 encrypted sections
const wmo = readDb2(casc, DB2.WMOAreaTable, { requireComplete: true });
const parent = areas.byId.get(363)?.num('ParentAreaID');             // 14 (Durotar)
```

| Member | Meaning |
|---|---|
| `DB2` (`layouts.ts`, generated) | `DB2.<Table>` = `{ fileDataId, layout }` for AreaTable, GameObjects, LiquidType, Map, TransportAnimation, UiMap, UiMapArt, UiMapArtStyleLayer, UiMapArtTile, UiMapAssignment, UiMapXMapArt, WMOAreaTable, WorldMapOverlay, WorldMapOverlayTile from WoWDBDefs' 1.60.1.70009 blocks (`LAYOUT_BUILD`). The client pin is 1.60.1.70124 (since 2026-09-30, D-050): its files carry the same layout hashes, which `parseWdc5` checks on every read |
| `readDb2(casc, table, { requireComplete? })` | Reads the file with `zero-fill` and parses it with its layout and the zero-filled ranges |
| `parseWdc5(bytes, layout, { encryptedRanges?, requireComplete? })` | The WDC5 parser behind it (`wdc5.ts`) |
| `Wdc5Table` | `{ layout, header, sections, storage, rows, byId, skippedSections }`. `rows` is in file order (section, record), then copy-table rows. |
| `Wdc5Row` | `id`, `section`, `relation` (the relationship-map value or null), and typed accessors `num(name)`, `str(name)`, `nums(name)`, `strs(name)`. They throw a `layout` error on an unknown column or a wrong type. A non-inline ID or relation is a column too (`row.num('UiMapArtID')`). |

What the WDC5 reader does:

- IDs come from the section's ID list or the inline ID field (bitpacked signed at 1.60.1).
  Common-data values are keyed by that record ID (the m3b fix).
- All six compression types are handled: none, bitpacked (signed when its flag is set), common
  data, pallet, pallet array, and bitpacked signed. Integers are narrowed to the column's width
  and sign, so an `int<16>` stored as 65535 is −1. Floats are reinterpreted from their bits.
- Strings and locstrings are resolved through the virtual string layout (records of all
  sections, then all string tables). A zero offset is `''`.
- Copy tables add rows; the relationship map feeds `relation` and non-inline relation columns.
  A row without a relationship-map entry has `relation` null and reads 0 in a non-inline relation
  column (WMOAreaTable: 8 of its 52,578 rows have no entry).
- Encryption: a section is skipped when a zero-filled range covers it exactly and it declares a
  TACT key. A range over the header, over part of a section, or over a section with no key is an
  `encrypted` error. Without ranges, an all-zero section that declares a key is skipped.
  `requireComplete` refuses any skip.
- Refused: another layout hash, a different field count, a stored size that disagrees with the
  layout, sparse tables (offset map), 64-bit integers.

Verified on the client (`casc.client.test.ts`): every column of ten tables equals the research
CSVs of docs/MAPS.md §8.3.

### Layouts

`layouts.ts` is generated and must not be edited by hand:

```bash
pnpm tsx tools/casc/make-layouts.ts            # regenerate from the research copies
pnpm tsx tools/casc/make-layouts.ts --check    # fail when the committed file differs
```

The inputs are the research copies of WoWDBDefs at `cf84e010f84ba9c8d48fd61730f92bf0d8f2b1cd`
(`definitions/<Table>.dbd` and `manifest.json`, in `.cache/experiments/maps/` and
`.cache/experiments/terrain/refs/`). No tool downloads them. `dbd.ts` reads a `.dbd` file's
`COLUMNS` and the definition block of the build. To add a table, add it to `LAYOUT_TABLES` in
`layout-source.ts`, put its `.dbd` beside the others and regenerate. WoWDBDefs licenses
`definitions/` as CC BY-SA 4.0; the layouts are attributed in THIRD_PARTY_NOTICES.md "Format
definitions".

### Lower layers

Most callers never need these; they are exported for tests and tools:

| Module | Exports |
|---|---|
| `buildinfo.ts` | `parseBuildInfo(text)`, `readBuildInfo(install)`, `selectProduct(rows, product)`, `checkPin(row, pin)` |
| `config.ts` | `parseConfig(text)`, `parseBuildConfig(text)`, `readBuildConfig(install, buildKey)` |
| `idx.ts` | `parseIndexFile(bytes)`, `bucketOfEKey(ekey)`, `lookupInIndex(file, ekey)`, `LocalIndex.read(install)` / `.fromFiles(map)` / `.lookup(ekey)` |
| `blte.ts` | `decodeBlte(raw, { verifyChunks? })` → `{ data, chunks, encryptedRanges, keyNames }` |
| `encoding.ts` | `EncodingTable.parse(bytes)`, `.lookup(ckey)` → `{ ekey, size }` or null |
| `root.ts` | `RootManifest.parse(bytes)`, `.ckey(id)`, `.has(id)`, `.encryptedFlag(id)`, `.fileDataIds()`, `.stats` |
| `paths.ts` | `resolveInstall(env)`, `DEFAULT_WOW_INSTALL`, `buildInfoPath`, `configPath`, `dataDirectory`, `indexPath`, `archivePath` |
| `bytes.ts` | `hexOf`, `keyBytes`, `md5Hex`, `hasFlag`, `xorByte`, `allZero`, `readBits`, `signExtend`, `float32FromBits`, `ByteRange` |
| `input-hash.ts` | `inputHash(inputs)`, `inputListText(inputs)`: the input hash of a derived file, SHA-256 over sorted `<FileDataID> <CKey>` lines (the map art and terrain byproduct manifests, step 3b.7/3b.8) |

## Tests

| File | What |
|---|---|
| `formats.test.ts` | Byte helpers, `.build.info`, build config, idx buckets and lookups, BLTE N/Z/E/F, encoding pages, MFST blocks |
| `casc.test.ts` | A whole synthetic install (`test-support.ts`): open, files, headerless and placeholder entries, encryption, corruption, pin; install paths; the source discipline scan (G16) |
| `wdc5.test.ts` | Synthetic WDC5 tables for every storage type, strings across sections, encrypted sections, layout checks; the DBD reader |
| `layouts.test.ts` | The generated layouts' shape; the committed file against the generator (skipped with a banner without the research copies) |
| `casc.client.test.ts` | Against the pinned client at `WOW_INSTALL`: §2.1's counts, the WDTs, Map, AreaTable, WMOAreaTable, LiquidType, and the CSV comparison (the 1.60.1.70009 CSVs, run only while the ten tables keep their 70009 CKeys). Without the client it prints a `SKIPPED` banner to stderr and passes. |

`test-support.ts` also exports `pinnedClientStatus()`, `announceSkip()` and `FOREVER_TEST_PIN`
for other tools' client tests (for example `tools/terrain/lib/terrain.client.test.ts`).
