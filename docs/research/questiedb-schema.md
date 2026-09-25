# QuestieDB Forever: schema reference and Milestone 0 experiments

Status: Milestone 0 research, 2026-09-25. Authoritative provenance and licence posture live in
[`../DATA_PROVENANCE.md`](../DATA_PROVENANCE.md); this file is the detailed technical reference.

**Revision (2026-09-25, after the Milestone 0 critique):** all measurements and citations are
unchanged. [ARCHITECTURE.md](../ARCHITECTURE.md) revision 2 and [DECISIONS.md](../DECISIONS.md)
are authoritative for design. Where a recommendation here conflicts with them, it is marked
**Superseded by D-0xx** (or by an ARCHITECTURE section) and kept as evidence. Notes marked
**Rev 2** say how the architecture uses a fact. One measurement was added (section 12.1: NPCs
with flight-master, trainer or innkeeper flags). After the Milestone 0 consistency check, the
provenance vocabulary is cited to D-026 (which supersedes D-007's vocabulary), and point, taxi and
validation notes follow the domain types in `src/domain/*.ts`.

| Item | Value |
| --- | --- |
| Upstream | https://github.com/Questie/QuestieDB |
| Pinned commit | `b6f5b07b0acf1c820993cbb0ce2521c912bb4c92` (2026-09-23 14:13:50 +0200, "feat: add generated Era-to-Forever coordinate helpers") |
| Local clone | `<repo>/.cache/questiedb` (shallow, gitignored; `<repo>` is this repository's root) |
| Consumer reference (read only for semantics) | Questie/Questie `40016145f8181f3f92049146ee655bd03d604a0a` (2026-09-24), clone at `<repo>/.cache/questie` |
| Experiment scripts | `<repo>/.cache/experiments/data/*.mjs` (gitignored, throwaway; described in section 16) |

All `file:line` citations are relative to the QuestieDB clone unless prefixed `Questie:`.
"Era" means Classic Era data (`data/Classic`, flavor `Vanilla`). "Forever" means the
`Forever` flavor (`data/Forever` etc.). A fact is only attributed to Forever when it was
observed in Forever inputs.

---

## 0. Executive summary (the facts that drive the architecture)

1. **Forever entity data is the Era baseline with a coordinate projection, nothing more.**
   All 35,897 raw Forever rows (4,244 quests, 10,119 NPCs, 6,645 objects, 14,889 items) have an
   Era row with the same ID; there are no Forever-only or Era-only IDs; 0 rows differ in any
   non-coordinate field. 1,333 rows differ only in coordinates, and every one of the 12,619 changed
   coordinate pairs is reproduced exactly by the documented DBC transform (section 9). Upstream
   says so explicitly: "this is a converted Era baseline, not complete Forever content"
   (`data/Forever/conversion.json:1782`) and "New entities, moved terrain/NPCs and Forever
   race/class restrictions are not provided by this conversion" (`docs/forever-data.md:122-123`).
2. **There is no Forever-specific content in QuestieDB yet.** The four authored Forever
   correction providers are empty (`src/corrections/Forever/forever*Fixes.lua`), localization is a
   byte copy of Era, and QuestXP is byte-identical to Era. New Forever zones (Zephras Isle,
   Riverglades, Darkspear Islands, Shen'dralas, Mount Hyjal) exist only as map metadata.
3. **Rows are Lua table literals inside one Lua long string per file, one row per line.** Both
   luaparse and a 150-line purpose-built parser decode every Forever file in 18-111 ms with
   identical results (section 11).
4. **Corrections matter and are statically evaluable.** Static corrections change real values
   (e.g. quest 7's reputation reward 250 -> 100, `nextQuestInChain` nil -> 15). All Forever
   providers are "local enum aliases + return a literal table" (plus a faction `if`). A
   whitelisted TypeScript evaluator reproduced the upstream-recorded composed entity count
   **35,944** exactly (section 7.6).
5. **Coordinates are 0-100 zone percentages keyed by AreaTable ID**, not UiMapID; instance
   presence is `{-1,-1}` keyed by the dungeon's AreaID; AreaID -> UiMapID comes from
   `support/Forever/Zones/areaIdToUiMapId.lua` (section 4-5). **Rev 2 (D-017):** the dataset
   ships these exactly as published and `infra/data` converts them to world points at load.
6. **Quest objective counts are not stored** ("Kill 10" appears only in `objectivesText`).
   **Rev 2:** every objective `count` is `null`, and `objectivesText` ships (ARCHITECTURE §5.2-5.3).
7. **Forever race bits exceed 32 bits** (Skyborne: 2^32 and 2^33) but no Forever data row uses
   them; the data still encodes faction-wide restrictions as Era masks 77/178 (section 8).
   **Rev 2:** arithmetic bit tests on JavaScript numbers (D-012).

---

## 1. Repository layout relevant to Forever

| Path | Role for Forever | Evidence |
| --- | --- | --- |
| `data/Forever/forever{Quest,Npc,Object,Item}DB.lua` | Raw entity rows (owned copy, coordinate-converted from Era) | `docs/forever.md:3-6`, `docs/forever-data.md:31-33` |
| `data/Forever/conversion.json` | Converter manifest: geometry, builds, per-file hashes and counts | `docs/forever-data.md:42-45`, section 5.3 |
| `src/corrections/Forever/legacy/*.lua` (6 files) | Inherited Era correction baseline, coordinate-converted; CI forbids edits | `src/corrections/Forever/legacy/README.md:3-9` |
| `src/corrections/Forever/forever*Fixes.lua` (4 files) | Authored Forever corrections, `Load()` static + `LoadDynamic()` dynamic; **empty** at the pin | `docs/forever.md:38-59` |
| `src/corrections/enum/*.lua` | Constants referenced by correction providers | `src/config.lua:143-155` |
| `src/corrections/manifest.lua`, `src/config.lua:158-170` | Provider inventory, static/dynamic classification, load windows | section 7 |
| `src/meta/{quest,npc,object,item}Meta.lua` | Canonical schema (index, storage type, structure, nil rules) | section 3 |
| `src/meta/normalize.lua` | Nil/empty read semantics shared by all read paths | section 3.6 |
| `src/derived/{requiredRaces,waypoints}.lua`, `src/derived/_end.lua:25-36` | Derived Passes run after static corrections | section 7.5 |
| `support/Forever/Zones/*.lua` | AreaID/UiMapID maps, dungeons, instance map, parents, zone symbols | section 5 |
| `support/Forever/QuestXP/xpDB-classic.lua` | Per-quest `{level, xp}` (Era seed) | section 6 |
| `support/Forever/FactionTemplates/factionTemplateClassic.lua` | FactionTemplate -> EnemyGroup, from Forever DBC 1.60.1.69893 | file header lines 1-3 |
| `support/Forever/DropTables/*.lua` | Drop percentages (Wowhead- and CMaNGOS-derived), Era seed | section 5.5 |
| `support/Forever/provenance.json` | One-time adoption evidence (hashes, DBC report) | `docs/forever-data.md:55-58` |
| `l10n/Forever/lookup{Quests,Npcs,Items,Objects}/<locale>.lua` | 36 locale files, byte-identical to `l10n/Classic` | `l10n/README.md:37-39`; `diff -rq` at the pin |
| `generate.lua`, `generator/`, `verify.lua`, `equivalence.lua`, `reconstruct.lua`, `emulator/` | Offline Lua 5.1 Generation/verification | section 10 |
| `tools/lua-binary/{lua.exe,linux-x64/lua}` | Bundled prebuilt Lua 5.1.5 (Windows x64, Linux x64) | `tools/lua-binary/README.md:3-9` |

Forever flavor definition: `{ name = "Forever", suffix = "_Forever", aliases = { "_Camelot" },
expansion = "Forever", dataPrefix = "forever", rules = "Classic", gameType = "camelot",
gameTypeAliases = { "forever" }, interface = "16001" }` (`src/config.lua:61`). `rules = "Classic"`
means correction constants, race/class masks and Derived Passes use **Era rules**
(`src/corrections/compat.lua:174`, `src/derived/requiredRaces.lua:42`).

---

## 2. Physical storage format of `data/Forever/*.lua`

Each file is executable Lua that assigns two globals on the `QuestieDB` module:

```lua
-- AUTO GENERATED FILE! DO NOT EDIT!
---@type QuestieDB
local QuestieDB = QuestieLoader:ImportModule("QuestieDB");
QuestieDB.questKeys = { ['name'] = 1, -- string ... }       -- key enum, with comments
QuestieDB.questData = [[return {
[2] = {"Sharptalon's Claw",{nil,nil,{16305}},...},
...
}]]
```

| File | Key enum | Data long string | Rows | Bytes (LF) |
| --- | --- | --- | ---: | ---: |
| `foreverQuestDB.lua` | lines 6-54 | opens line 56, closes line 4301 | 4,244 | 1,038,790 |
| `foreverNpcDB.lua` | lines 6-23 | opens line 25, closes line 10145 | 10,119 | 2,033,176 |
| `foreverObjectDB.lua` | lines 6-14 | opens line 16, closes line 6662 | 6,645 | 1,011,387 |
| `foreverItemDB.lua` | lines 6-22 | opens line 24, closes line 14914 | 14,889 | 2,181,706 |

Rules observed at the pin (verified by the parsers in section 11):

- The payload is **one Lua long string** (`[[ ... ]]`, level 0) containing `return { ... }`.
  QuestieDB's own loader runs the file under a mocked `QuestieLoader`, then calls
  `loadstring(payload)` (`generator/loader.lua:160-184`). Rows are not individually lazy strings in
  the source file; laziness exists only in QuestieDB's runtime (Source mode captures the payload
  and materializes on first use; Baked mode stores per-entity CBOR in TOC metadata,
  `docs/storage-format.md:19-75`).
- **One row per line**, `[id] = {field1,field2,...},`; no duplicate IDs in any Forever or Era
  file. IDs are ascending in the quest, NPC and object files, but **not** in the item file (237
  out-of-order positions), so never rely on file order. Positional fields; missing
  values are written `nil`; trailing nils are omitted (max raw width: quest 26 of 36, NPC 15,
  object 6 of 7, item 14 of 16).
- Only the literal subset appears: integers, decimals (no exponent/hex seen), `nil`, strings in
  `'...'` (NPC/item names) or `"..."` with backslash escapes (`\'`, `\"`), nested table
  constructors with positional values or `[number]=` keys. No comments, no expressions inside the
  payload.
- Encoding UTF-8. **Line endings:** the upstream blobs are LF; `.gitattributes` does not pin
  `*.lua`, so a Windows clone with `core.autocrlf=true` (the development machine) gets CRLF working
  files whose SHA-256 differs from upstream manifests. Hash the git blob (`git show <sha>:<path>`)
  or normalise CRLF->LF. **Rev 2:** input hashes are taken from LF git blobs, with
  `core.autocrlf=false` (ARCHITECTURE §5.1). Example: `foreverQuestDB.lua` blob `41cddaaf...b8748` (matches
  `conversion.json`) vs CRLF working file `ffdaa85d...471e`.
- The key enum header is authoritative for position; Generation fails if a data file's enum
  drifts from `src/meta` (`generator/schema.lua:19-37`) or a row has data beyond the declared keys
  (`generator/schema.lua:41-`). The item file header omits `teachesSpell` (16), which exists in the
  schema but only via corrections (`generator/schema.lua:15`).

---

## 3. Field lists

Types: `string`, `number`, `table` are QuestieDB storage types from `src/meta/*Meta.lua`
(`types`), "shape" is `structures`, "compiler" is the historical Questie compiler type kept for
provenance. "Raw" = rows with a non-empty value in raw Forever data; "Corr" = number of
static-correction writes to the field in Forever providers (section 7.3).

### 3.1 Quest (36 fields; `src/meta/questMeta.lua:19-130`, key enum `data/Forever/foreverQuestDB.lua:6-54`)

| # | Name | Type / shape (compiler) | Meaning | Raw | Corr |
| ---: | --- | --- | --- | ---: | ---: |
| 1 | name | string (u8string) | Quest name (enUS; localized field) | 4244 | 23 |
| 2 | startedBy | table / questgivers | `{npcIds?, objectIds?, itemIds?}`; never nil for a known quest | 4159 | 144 |
| 3 | finishedBy | table / questgivers | `{npcIds?, objectIds?}`; never nil for a known quest | 4153 | 52 |
| 4 | requiredLevel | number (u8) | Minimum player level to accept | 4243 | 117 |
| 5 | questLevel | number (s16) | Quest level (drives XP, colour) | 4230 | 45 |
| 6 | requiredRaces | number (u32 historically) | Race bitmask; 0/nil = any (section 8) | 2780 | 160 |
| 7 | requiredClasses | number (u16) | Class bitmask; 0/nil = any | 804 | 43 |
| 8 | objectivesText | table / stringarray | Objective description lines (localized field) | 3652 | 93 |
| 9 | triggerEnd | table / trigger | `{text, spawnlist}` exploration/event completion point | 34 | 110 |
| 10 | objectives | table / objectives | Six positional groups (3.2); never nil for a known quest | 2517 | 127 |
| 11 | sourceItemId | number (u24) | Item given by the starter | 1025 | 3 |
| 12 | preQuestGroup | table / idarray | All of these must be completed | 42 | 31 |
| 13 | preQuestSingle | table / idarray | Any one of these must be completed | 2232 | 329 |
| 14 | childQuests | table / idarray | Quests unlocked by this one | 30 | 16 |
| 15 | inGroupWith | table / idarray | Same quest group | 111 | 7 |
| 16 | exclusiveTo | table / idarray | Mutually exclusive quests | 258 | 211 |
| 17 | zoneOrSort | number (s16) | `>0` AreaTable ID (quest-log zone), `<0` QuestSort ID | 4243 | 73 |
| 18 | requiredSkill | table / pair | `{skillId, value}`; `{0,0}` reads nil | 141 | 40 |
| 19 | requiredMinRep | table / pair | `{factionId, value}`; `{0,0}` reads nil | 256 | 42 |
| 20 | requiredMaxRep | table / pair | `{factionId, value}`; `{0,0}` reads nil | 41 | 4 |
| 21 | requiredSourceItems | table / idarray | Items needed but not objectives | 54 | 74 |
| 22 | nextQuestInChain | number (u24) | Upstream comment: "if this quest is active/finished, the current quest is not available anymore" (`foreverQuestDB.lua` key enum) | 1431 | 550 |
| 23 | questFlags | number (u24) | Bitmask (cmangos QuestFlags; `src/corrections/enum/quests.lua:6-22`) | 3046 | 13 |
| 24 | specialFlags | number (u16) | 1 = repeatable (`enum/quests.lua:24-27`) | 816 | 188 |
| 25 | parentQuest | number (u24) | Parent must be active | 42 | 21 |
| 26 | reputationReward | table / pairs | `{{factionId, value}, ...}` | 2267 | 6 (+4254 via reputation provider) |
| 27 | breadcrumbForQuestId | number | Quest this breadcrumb leads to | 0 | 204 |
| 28 | breadcrumbs | table / idarray | Breadcrumbs leading here | 0 | 150 |
| 29 | extraObjectives | table / extraobjectives | Hidden objectives `{{spawnlist?, iconType, text?, objectiveIndex, refs?}, ...}` | 0 | 87 |
| 30 | requiredSpell | number (s24) | Spell the character must know | 0 | 0 |
| 31 | requiredSpecialization | number | Profession/spec requirement ID | 0 | 22 |
| 32 | requiredMaxLevel | number (u8) | Max level still able to take it | 0 | 42 |
| 33 | availableUntilCompleted | number | Available until that quest is turned in | 0 | 20 |
| 34 | availableStartingWith | number | Available once that quest is active/done | 0 | 0 |
| 35 | requiredRanks | table / pairs | Alternative `{skillId, rank}` (OR) | 0 | 1 |
| 36 | disabledByQuest | number | Unavailable while that quest is in the log | 0 | 10 |

Fields 27-36 are populated only by corrections in Forever. Localized fields: 1 and 8
(`questMeta.lua:130`).

### 3.2 Quest `objectives` (field 10) and related shapes

From the key-enum comments (`data/Forever/foreverQuestDB.lua:21-27`) and LuaLS types
(`src/types/General.t.lua:41-62`):

| Slot | Group | Element shape |
| ---: | --- | --- |
| 1 | creature | `{npcId, text?, iconType}` (text nil -> default "<Name> slain x/y") |
| 2 | object | `{objectId, text?, iconType}` |
| 3 | item | `{itemId, text?, iconType}` |
| 4 | reputation | `{factionId, value}` (a single pair, not a list) |
| 5 | killCredit | `{{npcId, ...}, baseNpcId, baseText?, iconType}` |
| 6 | spell | `{spellId, text?, itemId}` |

- **No required count is stored** for any objective; counts appear only in `objectivesText`
  (e.g. quest 7: "Kill 10 Kobold Vermin..."). A route planner that needs counts must source them
  elsewhere (e.g. from quest-log text or another dataset). UNVERIFIED which source is best.
  **Rev 2:** counts are `null` in every dataset objective; defaults are labelled assumptions with
  per-step overrides, and a later, clearly labelled heuristic may parse `objectivesText`, which
  ships (ARCHITECTURE §5.3, §19 item 2).
- Read contract pads absent numeric slots to 0 (`src/meta/normalize.lua:182-199`; ADR 0005).
  **Rev 2:** the extractor does not apply this padding (section 3.6).
- `triggerEnd` (9) = `{text, {[areaId] = {{x,y},...}}}`.
- `extraObjectives` (29) row = `{spawnlist?, iconType, text?, objectiveIndex, {{"monster"|"object"|"item", id}, ...}?}`;
  slot 3 is an enUS string (corrections call `l10n(text)`, stubbed to identity at
  `src/corrections/compat.lua:145`).

**Rev 2 objective model (ARCHITECTURE §5.3-5.4; critique DSO-06).** The shipped `ObjectiveDef` is a
discriminated union with one kind per group above plus the event: `kill {npcId}`,
`object {objectId}`, `item {itemId}`, `reputation {factionId, value}`,
`killCredit {npcIds, rootNpcId}`, `spell {spellId, itemId | null}` and `event {text, points}` (from
`triggerEnd`; `points` are `PublishedPoint`s: a zone-space `SourcedPoint`, an `InstancePresence`
or an `UnmappedAreaPoint`, `src/domain/dataset.ts`; DATA_PROVENANCE §6.5). `kill`, `object`,
`item` and `killCredit` also carry `label` and `count` (always `null` from QuestieDB); `spell`
carries `label`. The objective index is Questie's `ObjectiveData` order: creature, object, item,
reputation, killCredit, spell, then the `triggerEnd` event, with the `*ObjectiveFirst` hint sets
from the corrections applied at extraction (section 7.3). `extraObjectives` ship separately as `objectiveHints` and are not counted. RXP
`.complete q,i` maps to index `i-1`. The critique measured 172 raw Forever quests that mix
objective types and 14 that combine objectives with `triggerEnd`.

### 3.3 NPC (15 fields; `src/meta/npcMeta.lua:19-50`, key enum `foreverNpcDB.lua:6-23`)

| # | Name | Type / shape | Meaning | Raw | Corr |
| ---: | --- | --- | --- | ---: | ---: |
| 1 | name | string | NPC name (localized) | 10119 | 6 |
| 2 | minLevelHealth | number | Deprecated; always reads 0 (constant, `npcMeta.lua:88-90`) | 10090 | 0 |
| 3 | maxLevelHealth | number | Deprecated; always reads 1 | 10090 | 0 |
| 4 | minLevel | number | Min level | 10119 | 4 |
| 5 | maxLevel | number | Max level | 10119 | 4 |
| 6 | rank | number | cmangos creature rank (0 normal, 1 elite, 2 rare elite, 3 boss, 4 rare; UNVERIFIED mapping, see upstream link in key enum) | 2532 | 0 |
| 7 | spawns | table / spawnlist | `{[areaId] = {{x,y,phase?},...}}` | 7520 | 753 |
| 8 | waypoints | table / waypointlist | `{[areaId] = {{{x,y},...}, ...}}` paths | 503 | 113 |
| 9 | zoneID | number | "Best estimate" AreaID where most common | 7520 | 430 |
| 10 | questStarts | table / idarray | Quest IDs started (reverse of quest field 2) | 1504 | 155 |
| 11 | questEnds | table / idarray | Quest IDs finished | 1361 | 29 |
| 12 | factionID | number | FactionTemplate ID (not reputation faction) | 10119 | 0 |
| 13 | friendlyToFaction | string | `"A"`, `"H"`, `"AH"` or nil (hostile to both); normalized (`normalize.lua:226-231`) | 5955 | 0 |
| 14 | subName | string | Title, e.g. "Weapon Vendor" (localized) | 2401 | 0 |
| 15 | npcFlags | number | Era flag bitmask (`enum/expansions.lua:24-41`: QUEST_GIVER 2, VENDOR 4, FLIGHT_MASTER 8, TRAINER 16, INNKEEPER 128, ...) | 3404 | 31 |

**Rev 2:** `entities.json` ships every quest-referenced NPC plus every NPC whose `npcFlags` has
FLIGHT_MASTER, INNKEEPER or TRAINER set, tested arithmetically (ARCHITECTURE §5.2, D-012;
critique F07). Taxi nodes and known paths are identified by `TaxiNodeRef { npcId, taxiNodeId,
name }` (ARCHITECTURE §8.1, §9.1): a dataset flight master supplies `npcId`, and new Forever
nodes, which have no NPC in QuestieDB (section 0, item 2), use a cited TaxiNodes id or a name.
Counts are in section 12.1.

### 3.4 Object (7 fields; `src/meta/objectMeta.lua:19-34`, key enum `foreverObjectDB.lua:6-14`)

| # | Name | Type / shape | Meaning | Raw | Corr |
| ---: | --- | --- | --- | ---: | ---: |
| 1 | name | string | Object name (localized) | 6645 | 25 |
| 2 | questStarts | table / idarray | Quests started | 194 | 16 |
| 3 | questEnds | table / idarray | Quests finished | 176 | 5 |
| 4 | spawns | table / spawnlist | As NPC spawns | 4896 | 128 |
| 5 | zoneID | number | Most common AreaID | 4896 | 59 |
| 6 | factionID | number | Faction restriction mask from spawn data | 70 | 0 |
| 7 | waypoints | table / waypointlist | Transport paths (none in Forever raw data) | 0 | 0 |

### 3.5 Item (16 fields; `src/meta/itemMeta.lua:19-52`, key enum `foreverItemDB.lua:6-22`)

| # | Name | Type / shape | Meaning | Raw | Corr |
| ---: | --- | --- | --- | ---: | ---: |
| 1 | name | string | Item name (localized) | 14889 | 14 |
| 2 | npcDrops | table / idarray | NPC IDs that drop it | 4010 | 301 |
| 3 | objectDrops | table / idarray | Object IDs that contain it | 2905 | 204 |
| 4 | itemDrops | table / idarray | Container item IDs | 2052 | 9 |
| 5 | startQuest | number | Quest started by using the item | **0** | 6 (+202 via item-start provider) |
| 6 | questRewards | table / idarray | Quests rewarding it | 2138 | 1 |
| 7 | flags | number | cmangos item flags | 3334 | 2 |
| 8 | foodType | number | Food type | 0 | 0 |
| 9 | itemLevel | number | Item level | 14752 | 0 |
| 10 | requiredLevel | number | Level to use/equip | 8796 | 0 |
| 11 | ammoType | number | Ammo type | 219 | 0 |
| 12 | class | number | Item class (12 = quest, `enum/items.lua:6-10`) | 14103 | 54 |
| 13 | subClass | number | Item subclass | 9213 | 0 |
| 14 | vendors | table / idarray | NPC IDs selling it | 1751 | 16 |
| 15 | relatedQuests | table / idarray | Related quest IDs | **0** | 169 |
| 16 | teachesSpell | number | Spell taught | 0 (not in file enum) | 0 |

### 3.6 Read-contract nil/empty semantics (what the addon "sees")

From `src/meta/normalize.lua:12-22` and `docs/storage-format.md:217-233`:

| Source value | Read back as |
| --- | --- |
| number nil | `0` (never nil for a known entity) |
| string nil / `""` | nil / `""` (distinct) |
| table nil or `{}` | nil, except quest `startedBy`, `finishedBy`, `objectives` -> `{}` |
| pair `{0,0}` in quest fields 18-20 | nil |
| constant NPC fields 2/3 | 0 / 1 |
| unknown ID | nil for every field |

A route-planner export should normalise to its own explicit convention (recommended: omit
absent/zero/empty fields, never emit `{0,0}` pairs, document that absent numeric = 0).

**Superseded by ARCHITECTURE §2 (principle 3) and §5.3 (critique DSO-05):** the extractor never
applies the pad-to-0 read contract. An absent numeric value is `null` in the domain records (for
example `level: number | null`, `minLevel`, `maxLevel`, `races`, `classes`), never 0. Omitting
absent fields in the JSON files and never emitting `{0,0}` pairs stay compatible with this, as
long as the loader maps an omitted field to `null`. A raw 0 written explicitly upstream is
distinguishable from `nil` in the source rows (section 2) and keeps its upstream meaning (for
example `requiredRaces` 0 = any race).

---

## 4. Spawns, coordinates and waypoints

### 4.1 Format

- `spawns`: `{[areaId] = {{x, y}, {x, y, phase}, ...}}`. `x`,`y` are **0-100 percentages of the
  zone map** (the `EraToForever` helpers document "0-100 percentages, not normalized 0-1",
  `docs/api.md:583`). Observed range in raw Forever data: x 0.16-95.96, y 0.09-99.99; no values
  outside 0-100 other than the `-1,-1` sentinels.
- **Zone key = AreaTable ID** (e.g. 12 Elwynn Forest, 1519 Stormwind City, 3456 Naxxramas), not a
  UiMapID. Types alias it `AreaId` (`src/types/General.t.lua:31`). Quest `zoneOrSort` is also an
  AreaTable ID but is the quest-log category (Northshire quests use 9 "Northshire Valley" while
  their NPCs spawn under key 12).
- Optional third element = phase ID (`src/corrections/enum/phases.lua`; nonzero only). No raw
  Forever spawn carries a phase; corrections can add them (`classicNPCFixes` references `phases`).
- **Instance presence**: `{-1, -1}` means "present inside this instance, no drawable point"
  (`CONTEXT.md:85-89`), keyed by the dungeon/raid AreaID. 2,843 sentinel rows in raw Forever data
  (NPC 2,125 + object 718, matching `conversion.json` counts), all under the 29 dungeon/raid/alt
  area keys (Naxxramas 3456 alone has 1,320). Partial sentinels (`-1,20`) do not occur and the
  converter rejects them (`tools/dbc/coordinates.py:64-76`).
- Precision: raw values have up to 2 decimals (0 dp: 1,939 values, 1 dp: 18,606, 2 dp: 185,995).
  QuestieDB stores and serves raw precision (ADR 0006 `docs/adr/0006-raw-coordinate-storage.md:21-38`);
  Derived Pass waypoints can have more digits.
- **Rev 2 (D-017, ARCHITECTURE §5.1-5.2):** `spawns.json` ships spawns as published (AreaID →
  `[x%, y%]`, 2 dp, instance presence kept); the extractor never rounds or re-projects them.
  `infra/data` converts them once to `WorldPoint`s at load through `src/geo` and the committed
  geometry, so runtime domain types still see world yards. D-017 supersedes the part of D-004
  that stored dataset spawns as world yards: the critique measured world yards at +24% (0.1 yd),
  +52% (0.01 yd) and 3.4x (full doubles) the gzip size of the percent form (PERF-2).
- **Rev 2 (ARCHITECTURE §5.2; `src/domain/points.ts`):** at load every published point becomes a
  `PublishedPoint`. `{-1, -1}` becomes `InstancePresence { kind: 'instance', areaId }`, which
  resolves to the dungeon entrance from `zones.json` (section 4.2) when one exists and otherwise
  stays unresolved. A point whose AreaId maps to no UiMap becomes `UnmappedAreaPoint { kind:
  'unmapped', areaId, x, y, reason }`, with `reason` `suppressed` (UiMap 0: 2257, 2917, 2918 at
  the pin, see the census below), `instance-area` (an instance-type area whose only link is one
  of the 40 legacy compatibility pairs, which are not native Forever maps) or `no-uimap` (absent
  from the table). Nothing is guessed (DATA_PROVENANCE §6.5).
- `waypoints` (NPC 8, object 7): `{[areaId] = {{{x,y},...}, ...}}` (list of paths); corrections may
  author the bare `{{x,y},...}` shape which the Derived Pass normalises (`src/derived/waypoints.lua:18,70-73`).
  503 NPCs carry raw waypoints (all nested shape).
- Census of spawn zone keys in raw Forever NPC/object spawns: 78 distinct AreaIDs: 46 outdoor
  zones/cities of Kalimdor and the Eastern Kingdoms, 3 battlegrounds (2597, 3277, 3358) and 29
  instance-type areas (dungeons/raids, Blackrock Depths' Shadowforge City 1585, the Deeprun Tram
  2257 and the two PvP halls 2917/2918). All 78 keys appear in `areaIdToUiMapId`: 75 map to a
  nonzero UiMap (the instance ones only via the 40 legacy compatibility pairs, e.g. Naxxramas
  3456 -> 166), and 2257/2917/2918 map to 0 = display suppressed (`areaIdToUiMapId.lua:12-14`).
  Every instance-type key is also a `dungeons.lua` entry or alternative ID.
- 189 NPCs spawn under more than one zone key; `zoneID` (field 9) is always one of the spawn keys
  when spawns exist. 2,599 NPCs and 1,749 objects have no spawns at all.

### 4.2 Dungeon entrances

`support/Forever/Zones/dungeons.lua`: `[dungeonAreaId] = {name, alternativeAreaIds?, parentZoneAreaId, {{entranceAreaId, x, y}, ...}}`
(shape documented at `docs/support-data.md:46-52`, `docs/api.md:557-567`). The file calls
`UnitFactionGroup` at load (line 4), so it is not a pure literal. Seven Era-framed entrances were
re-projected to Forever; three later-expansion entries (5861, 6618, 10001) remain unverified
(`docs/forever-coordinate-audit.md:28-36,74-93`).

### 4.3 Era -> Forever coordinate conversion (already applied upstream)

Only four zone frames changed between Era DBC 1.15.9.69722 and Forever DBC 1.60.1.69893
(`data/Forever/conversion.json` `geometry.area_coefficients`, lines 1479-1775):

| Zone | AreaID | UiMapID | scale_x | offset_x | scale_y | offset_y |
| --- | ---: | ---: | --- | --- | --- | --- |
| Mulgore | 215 | 1412 | 0.8348002068275978 | 7.007453108736848 | 0.8349418225477033 | 13.15387327724201 |
| Eastern Plaguelands | 139 | 1423 | 0.8997577709204458 | -1.6464926382438023 | 0.9004358590984077 | -3.7790494664060477 |
| Redridge Mountains | 44 | 1433 | 0.9999996626080551 | -5.086374584221827 | 1.0 | 0.0 |
| Stormwind City | 1519 | 1453 | 0.7736792385183993 | 19.680449646264936 | 0.773826866980289 | 24.433287807510073 |

`x' = scale_x * x + offset_x`, `y' = scale_y * y + offset_y`, rounded to 2 dp halfway away from
zero, transformed pairs only (`conversion.json:1777-1781`). All other 45 AreaIDs have identity
coefficients. **Never apply it again to Forever data** (`docs/api.md:608`,
`docs/forever-data.md:84-86`). The assumption is unchanged world positions
(`conversion.json:1782`); it does not find moved or new content.

### 4.4 World-space geometry available offline

`conversion.json.geometry.transforms` (lines 5-1378) lists 49 UiMaps with `ui_map_id`, `area_id`,
`map_id` (0 Eastern Kingdoms, 1 Kalimdor, 30/489/529 battlegrounds) and `source_bounds` /
`target_bounds` `{left, right, top, bottom}` in world units. From `tools/dbc/coordinates.py:13-47`:
`left = Region_4`, `right = Region_1`, `top = Region_3`, `bottom = Region_0` of UiMapAssignment,
width = left - right, height = top - bottom, so a percentage point maps to world as
`worldY = left - x/100 * (left - right)`, `worldX = top - y/100 * (top - bottom)` (derived from
the transform in `coordinates.py:78-90`; treat as UNVERIFIED until checked against a known
landmark). This enables cross-zone distances per continent. New Forever maps (2482, 2521, 2524,
2548, 2652, 2665) are listed only by name in `added_maps` (lines 1411-1442), without bounds; 5
maps are `unsupported` (947 Azeroth, 1414/1464 Kalimdor, 1415/1463 Eastern Kingdoms; lines
1379-1410).

**Later checks and rev 2 use.**

- The formula was checked against landmarks in [coordinates.md](coordinates.md) sections 4, 7
  and 9: the Gornek round trip, and three city flight masters within 12 yd of their `TaxiNodes`
  positions (about 109 yd off if a changed frame is read with Era bounds). All 49
  `target_bounds` equal the 1.60.1.70009 `UiMapAssignment` rows bit for bit (coordinates.md
  section 10.3).
- `public/maps/placeholder/geometry.placeholder.json` holds these 49 frames
  (`source: 'questiedb-conversion'`) plus the 12 DB2-only UiMapAssignment rows that
  `conversion.json` lacks, covering UiMaps 947 (two rows), 1414, 1415, 1463, 1464, 2482, 2521,
  2524, 2548, 2652 and 2665. They come from hash-recorded CSVs at 1.60.1.70009, fetched as
  individual requests during research, not by scripted crawling (`source: 'db2-csv'`), and are
  committed by owner approval (D-018; ARCHITECTURE §6). Each row records its own source and build
  (D-026). *Corrected:* this note previously called the CSVs "manually downloaded"; they were
  fetched with individual web requests during research ([local-context.md](local-context.md)
  K3), as D-018 now states.

---

## 5. Zones, UiMaps and continents (`support/Forever/Zones/`)

### 5.1 Files

| File | Shape | Notes |
| --- | --- | --- |
| `areaIdToUiMapId.lua` | `ZoneDB.private.areaIdToUiMapIdOverride = [[return {...}]]` (line 10) and `ZoneDB.private.areaIdToUiMapId = [[return {...}]]` (line 67); deferred Lua strings with `--` comments | 1,064 forward DBC relationships (direct + parent-resolved) plus override: `[0]=0`, suppression of 2257/2917/2918, synthetic continents `[10073]=1414` Kalimdor, `[10074]=1415` Eastern Kingdoms, `[10089]=947` Azeroth (lines 11-17), and 40 legacy dungeon compatibility pairs that are **not native Forever maps** (`docs/forever-data.md:194-201`) |
| `uiMapIdToAreaId.lua` | same two-string pattern | 54 canonical reverse links + 3 continent aliases + compatibility pairs |
| `dungeons.lua` | Lua table (section 4.2) | executes `UnitFactionGroup` |
| `instanceIdToAreaId.lua` | `ZoneDB.instanceIdToAreaId = {[instanceMapId] = ZoneDB.zoneIDs.X}` | needs `zoneIds.lua` symbols |
| `subZoneToParentZone.lua` | override string + base string | parent routing; recorded refresh hash in `provenance.json` no longer matches (later edit) |
| `zoneIds.lua` | `ZoneDB.zoneIDs = {NAME = areaId}` | Era copy (byte-identical); symbols only |

Override precedence: override entries replace base entries (`docs/support-data.md`, consumer
wrapper decodes both). Values: UiMapID `0` means "suppress display".

**Rev 2 (ARCHITECTURE §10 step 4; critique LIC-13):** English zone names for RXP zone keys and
labels come from the trailing `--` comments of `uiMapIdToAreaId.lua` rows (for example
`[2521] = 16593, -- Zephras Isle`, line 113), validated, plus self-authored pseudo-zone keys. The
file's header (lines 1-4) says it was completed by hand for build 1.60.1.69893 and that
regenerating it with `generate.py` overwrites those additions, so the pin must be re-checked on a
bump. `l10n/Forever` is not consumed (DATA_PROVENANCE §4.2).

Forever-only map facts adopted from DBC 1.60.1.69893 (`docs/forever-data.md:155`):
Riverglades 16591 -> 2548, Zephras Isle 16593 -> 2521, Darkspear Islands 16606 -> 2524,
Shen'dralas 16651 -> 2652, Mount Hyjal 616 -> 2482. No entity spawns reference these areas.

### 5.2 Continents

The AreaID -> UiMap table does not carry continent IDs. Continent membership is available from
`conversion.json` `transforms[].map_id` (world map ID) for the 49 transformable maps, and
synthetic AreaIDs 10073/10074/10089 identify continent/world frames used by six unresolved
correction points (`docs/forever-data.md:87-99`).

**Rev 2 (D-018; ARCHITECTURE §5.2, §6):** `zones.json` carries no world bounds, continent or
world-map IDs. Those are map metadata in `public/maps/placeholder/geometry.placeholder.json`
(section 4.4), so quest data and map geometry stay separate.

### 5.3 `data/Forever/conversion.json` contents (beyond `geometry.transforms`)

| Key (line) | Content |
| --- | --- |
| `tool` (2), `format` (3) | `"QuestieDB convert-forever"`, `1` |
| `geometry.unsupported` (1379) | 5 maps with reasons |
| `geometry.added_maps` (1411) / `removed_maps` (1443) | 6 new Forever maps / none |
| `geometry.summary` (1444) | 55 source / 61 target assignments; 4 changed, 45 unchanged, 5 unsupported, 6 added |
| `geometry.source_build` / `target_build` (1453-1454) | `1.15.9.69722` / `1.60.1.69893` |
| `geometry.source_tables` / `target_tables` (1455-1478) | DBC snapshot SHA-256, row counts, coverage (`untracked` for Era, `ok` for Forever) |
| `geometry.area_coefficients` (1479) | 49 AreaID -> coefficients |
| `keep_unmapped` (1776) | `true` |
| `coordinate_rounding` (1777) | 2 dp, halfway away from zero, transformed pairs only |
| `assumption` (1782) | unchanged world positions; converted Era baseline |
| `zone_symbols_sha256` (1783) | = blob SHA-256 of `support/Forever/Zones/zoneIds.lua` (`55d56138...`) |
| `files` (1784) | 10 entries: source path + SHA-256, output SHA-256, pair counts (converted / unchanged / sentinels / unmapped), `converted_by_area` |
| `not_converted` (2008) | Questie runtime corrections; dungeon entrances; Forever race/class restrictions and new content; subzone/synthetic routing |
| `validation` (2014) | Lua semantic comparison statement |

At the pin all ten `files[].output_sha256` equal the LF blobs of the current outputs and all ten
`source_sha256` equal the current Era sources (checked with `git show HEAD:<path> | sha256sum`),
so neither side has drifted since adoption. The manifest's own hash no longer equals the
`coordinate_manifest_sha256` recorded in `support/Forever/provenance.json` (`f4477d6c...` vs
`7866f9eb...`) because its six correction paths were later moved into `legacy/`
(`docs/forever-data.md:318-321`).

### 5.4 Faction templates

`support/Forever/FactionTemplates/factionTemplateClassic.lua`: `QuestieDB.factionTemplate = {[templateId] = EnemyGroup}`,
453 rows exported from Forever DBC 1.60.1.69893 (header lines 1-3; blob SHA-256
`026489ae...` equals the DBC report output hash). For route planning `friendlyToFaction` (NPC 13)
is usually sufficient.

### 5.5 Drop tables

`support/Forever/DropTables/classicItemDrops.lua` holds `QuestieClassicItemDrops.wowheadData`
(line 10) and `.cmangosData` (line 17809) as deferred strings `[itemId] = {[npcId] = percent}`;
the file states the Wowhead table is "automatically generated from wowhead data". Byte-identical
to Era. Provenance/licensing of third-party-derived percentages is a separate risk (see
DATA_PROVENANCE.md); a planner needs only drop *sources*, which are item fields 2-4. (Rev 2: drop
percentages are not consumed, DATA_PROVENANCE §4.2; `items.json` ships drop sources.)

---

## 6. Quest XP (`support/Forever/QuestXP/xpDB-classic.lua`)

- Shape: `QuestXP.db = { [questId] = {questLevel, baseXp}, ... }` (line 6), with trailing comments
  comparing Classic/TBC/WotLK values, e.g. `[7] = {2, 170}` (line 10), `[783] = {1, 40}` (line 740).
  Header: "automatically generated ... checkout the generateQuestXp.lua script".
- 3,494 rows; every row's quest exists; 750 of 4,244 Forever quests have no XP row.
  **Rev 2 (ARCHITECTURE §5.3, §9.3):** a quest with a row ships `xp.basis: 'era-seed'`; a quest
  without one ships `xp: null` (unknown), which the simulator never counts as 0: it increments
  `unknownXpEvents` and marks later levels as lower bounds.
- **Era-inherited, not Forever-verified**: byte-identical to `support/QuestXP/xpDB-classic.lua`
  (`cmp` at the pin) and seeded by copy (`docs/forever-data.md:67-72`). The Forever DBC pass did
  not generate XP: "QuestXP rows alone lack per-quest level/reward-index inputs"
  (`support/Forever/provenance.json:471`).
- Current Questie generator reads a `QuestXP.5.5.0.61051.csv` (MoP Classic) plus a
  `data.csv` of `questId, questLevel, xpId` (`Questie:ExternalScripts(DONOTINCLUDEINRELEASE)/questXp/generateQuestXp.lua:1-40`);
  whether the Classic file was produced by this script is UNVERIFIED.
- Consumer formula (Questie, not QuestieDB): 0 at max level; otherwise
  `xp * clamp(2*(questLevel - charLevel) + 20, 1, 10) / 10`, then rounded to 5/10/25/50 steps
  by magnitude, times buff multipliers (`Questie:Database/QuestXP/QuestieXP.lua:59-86,93-106`,
  commented as "fetched from cmangos"). Whether Forever uses the same XP curve is UNVERIFIED
  (owned by the XP-rules research).

---

## 7. Corrections

### 7.1 Model

- A Correction is `[entityId] = { [fieldIndex] = value }` (`CONTEXT.md:97-99`).
- **Static**: folded in during Generation; applied live in Source mode. **Dynamic**: applied at
  query time, may depend only on class, race, faction, expansion, season (`CONTEXT.md:101-110`).
  Dynamic outranks all static data (`docs/forever.md:55-57`).
- Merge (`src/corrections/registry.lua:277-305`): **whole-field replacement**, not deep merge;
  an absent ID is **created** unless `noNewEntries`; `noOverwrites` writes only nil fields;
  `[k] = {}` deletes the field (reads nil / 0); `[k] = nil` is a no-op. The Era-window
  "no resurrection" rule (`registry.lua:314-325`) does not trigger for Forever because its rules
  expansion order equals the source order (both Classic = 1).
- Load order (`src/corrections/registry.lua:52-60`, `src/corrections/register.lua:146,163`):
  `window base + (generated ? 1 : 10) + functionOffset`. For Forever: legacy providers use the Era
  window (static 0, dynamic 100); `forever*Fixes` use ForeverStatic 1400 / ForeverDynamic 1500.
  So generated providers run **before** hand-authored ones.

### 7.2 Forever provider inventory (`src/config.lua:158-170`)

| Order | Provider (`src/corrections/Forever/...`) | Datatype | Static fn | Dynamic fn | Options |
| ---: | --- | --- | --- | --- | --- |
| 2 | `legacy/classicQuestReputationFixes.lua` | Quest | Load | - | generated |
| 11 | `legacy/classicQuestFixes.lua` | Quest | Load | LoadFactionFixes (111) | - |
| 11 | `legacy/classicNPCFixes.lua` | Npc | Load | LoadFactionFixes (111) | - |
| 11 | `legacy/classicObjectFixes.lua` | Object | Load | LoadFactionFixes (111) | - |
| 2 | `legacy/itemStartFixes.lua` | Item | LoadAutomaticQuestStarts | - | generated, noNewEntries, noOverwrites |
| 11 | `legacy/classicItemFixes.lua` | Item | Load | LoadFactionFixes (111) | - |
| 1411 | `foreverQuestFixes.lua`, `foreverNPCFixes.lua`, `foreverObjectFixes.lua`, `foreverItemFixes.lua` | each | Load (empty) | LoadDynamic (empty, 1511) | - |

Not applied to Forever: Era/TBC/Wrath/Cata/MoP providers (`src/config.lua:173-183`), SoD (Vanilla
season 2 only), Titan (Wrath season 109 only) (`docs/forever.md:34-36`).

### 7.3 What the providers touch (static AST analysis, `corrections.mjs`)

| Provider function | IDs | IDs not in raw (created) | Fields touched (writes) |
| --- | ---: | ---: | --- |
| classicQuestFixes `Load` | 1,844 | 13 | nextQuestInChain 550, preQuestSingle 329, exclusiveTo 211, breadcrumbForQuestId 204, specialFlags 188, requiredRaces 160, breadcrumbs 150, startedBy 144, objectives 127, requiredLevel 117, triggerEnd 110, objectivesText 93, extraObjectives 87, requiredSourceItems 74, zoneOrSort 73, finishedBy 52, questLevel 45, requiredClasses 43, requiredMinRep 42, requiredMaxLevel 42, requiredSkill 40, preQuestGroup 31, name 23, requiredSpecialization 22, parentQuest 21, availableUntilCompleted 20, childQuests 16, questFlags 13, disabledByQuest 10, inGroupWith 7, reputationReward 6, requiredMaxRep 4, sourceItemId 3, requiredRanks 1 |
| classicQuestFixes `LoadFactionFixes` | 83 per faction | 0 | reputationReward 52, startedBy 17, nextQuestInChain 13-14, requiredRaces 1, breadcrumbForQuestId 1 (Alliance) |
| classicQuestReputationFixes `Load` | 4,254 | 12 | reputationReward 4,254 |
| classicNPCFixes `Load` | 985 | 3 | spawns 753, zoneID 430, questStarts 155, waypoints 113, npcFlags 31, questEnds 29, name 6, minLevel 4, maxLevel 4 |
| classicNPCFixes `LoadFactionFixes` | 9 per faction | 1 | spawns 9, zoneID 8-9 |
| classicObjectFixes `Load` | 139 | 21 | spawns 128, zoneID 59, name 25, questStarts 16, questEnds 5 |
| classicObjectFixes `LoadFactionFixes` | 9 per faction | 0 | spawns 9, zoneID 2 |
| classicItemFixes `Load` | 405 | 10 | npcDrops 301, objectDrops 204, relatedQuests 169, class 54, vendors 16, name 14, itemDrops 9, startQuest 6, flags 2, questRewards 1 |
| classicItemFixes `LoadFactionFixes` | 5 per faction | 0 | npcDrops 3, objectDrops 3, relatedQuests 1, name 1 (Alliance) |
| itemStartFixes `LoadAutomaticQuestStarts` | 452 | 250 (not created: noNewEntries) | startQuest 452 (202 applied) |
| forever*Fixes `Load` / `LoadDynamic` | 0 | - | - |

Non-literal value expressions found (the complete list): member lookups on enum aliases
(`zoneIDs`, `raceIDs`, `classIDs`, `factionIDs`, `sortKeys`, `specialFlags`, `profKeys`, `specKeys`,
`rankKeys`, `npcFlags`, `phases`, `itemClasses`, `Questie.ICON_TYPE_*`), `+` on enum members
(e.g. `classIDs.WARRIOR + classIDs.PALADIN`, `classicQuestFixes.lua:3277`), `l10n("...")` (identity
offline), and `({ DRUID = ..., ... })[playerClass]` indexing. Function bodies contain only
`local x = Module.y` aliases, `local t = {...}`, `return t`, and one
`if UnitFactionGroup("Player") == "Horde" then return horde else return alliance end`
(e.g. `classicQuestFixes.lua:6842,7425`). The only top-level side effects are
`QuestieCorrections.itemObjectiveFirst[...] = true` UI hints (`classicQuestFixes.lua:17-18`, for
quests 503 and 5088). `src/corrections/compat.lua:21-31` collects five such sets
(`killCreditObjectiveFirst`, `objectObjectiveFirst`, `itemObjectiveFirst`,
`eventObjectiveFirst`, `spellObjectiveFirst`) as published consumer hints about objective order.
**Rev 2:** the extractor applies these hint sets when it fixes the objective index (ARCHITECTURE
§5.4; section 3.2 above).

### 7.4 Dynamic keys

`LoadFactionFixes` keys on **faction** (`UnitFactionGroup`, 4 providers) and, for quests, on
**class** (`UnitClassBase("player")`, `classicQuestFixes.lua:6842`). No Forever provider reads race.
Class-dependent quest IDs (same set for both factions): 8315, 8977, 8997, 9015; all other dynamic
values are class-invariant. `forever*Fixes:LoadDynamic` is empty.

### 7.5 Derived Passes (code transforms after static corrections)

Order `raw -> static corrections -> derived passes -> normalize -> encode`
(`src/derived/registry.lua:20-26`, `docs/adr/0004-derived-passes.md:72-82`). Registered
(`src/derived/_end.lua:25-36`):

1. `requiredRaces:questieCompatibility` (order 50): if a quest's `requiredRaces` is nil/0 and its
   creature starters are friendly to exactly one faction, set `ALL_ALLIANCE` (77) or `ALL_HORDE`
   (178) from **Era** masks (`src/derived/requiredRaces.lua:30-87`). On raw Forever data 69 quests
   qualify; after static corrections only 1 (quest 7162) still does, because corrections set
   67 explicitly and change one starter.
2. Waypoint simplification for Npc (100) and Object (110): Ramer-Douglas-Peucker tolerance 0.1,
   then subdivision of segments longer than `1.5 * zoneScale` (0.5 for the six capitals)
   (`src/derived/waypoints.lua:11-52`). Changes drawn waypoints; only needed if waypoints ship.

### 7.6 What an offline extractor must apply to match the addon's view

| Layer | Needed for a planner? | Evidence |
| --- | --- | --- |
| Raw rows | yes | - |
| All static providers in 7.2, in order, with MergeInto semantics | **yes** (changes availability, chains, rewards; e.g. quest 7 reputation 250 -> 100 and `nextQuestInChain` -> 15, quest 783 reputation 75 -> 50) | `classicQuestReputationFixes.lua:21-23,2262-2264`, `classicQuestFixes.lua:40-42` |
| requiredRaces Derived Pass | yes (1 quest after corrections) | 7.5 |
| Waypoint Derived Pass | only if waypoints are shipped | 7.5 |
| Dynamic faction/class layers | yes, as per-faction overlays + per-class values (Rev 2: `overlays.json`, applied by `DatasetView` from the project character, ARCHITECTURE §5.1-5.2) | 7.4 |
| Questie consumer policy (blacklists, hidden/unobtainable quests, event gating, DMF) | **not in QuestieDB**; a separate decision (Rev 2: not an input; VAL-22 is an info on accept for `needsEvent` quests and never blocks, ARCHITECTURE §9.4) | `CONTEXT.md:225-234`; `Questie:Database/Corrections/QuestieQuestBlacklist.lua` (8,563 lines, expansion-conditional Lua) |

Proof of concept (`evaluate.mjs`): luaparse + a whitelisted evaluator (literals, tables, unary
minus, `+`, enum member lookup from `src/corrections/enum/*.lua` with `byExpansion.Classic` race/class/npcFlag
masks, `l10n` identity, `[playerClass]` indexing, the faction `if`) + MergeInto + requiredRaces
produced **35,944** composed entities (quests 4,257, NPCs 10,122, objects 6,666, items 14,899) in
341 ms, equal to the upstream-recorded Forever Golden of 35,944 entities
(`docs/forever-validation.md:37,40`). Per-field value parity with QuestieDB's own Generation was
**not** checked (no Lua was executed); that is the recommended validation (section 10).
**Rev 2:** this approach is the pipeline (D-009). Equal composed counts (4,257 quests, 10,122
NPCs, 6,666 objects, 14,899 items at `b6f5b07`) are a gate (ARCHITECTURE §5.1). **Superseded by
ARCHITECTURE §5.2:** per-field parity is not "the" validation. The required checks are golden
counts, output hashes, schema and referential integrity; a per-field parity run against
QuestieDB's Lua generation is an optional manual check (DATA_PROVENANCE §5).

---

## 8. Race, class and faction encoding

### 8.1 Masks used by Forever data and corrections

Forever `rules = "Classic"` selects `byExpansion.Classic` (`src/corrections/enum/expansions.lua:8-62`):

| Race | Bit value | | Class | Bit value |
| --- | ---: | --- | --- | ---: |
| HUMAN | 1 | | WARRIOR | 1 |
| ORC | 2 | | PALADIN | 2 |
| DWARF | 4 | | HUNTER | 4 |
| NIGHT_ELF | 8 | | ROGUE | 8 |
| UNDEAD | 16 | | PRIEST | 16 |
| TAUREN | 32 | | SHAMAN | 64 |
| GNOME | 64 | | MAGE | 128 |
| TROLL | 128 | | WARLOCK | 256 |
| ALL_ALLIANCE | 77 | | DRUID | 1024 |
| ALL_HORDE | 178 | | ALL_CLASSES | 1503 |

(The Classic table also lists later-race bits such as GOBLIN 256; irrelevant to Era data.)

### 8.2 Forever-specific race keys (defined, not used by Forever generation)

`src/corrections/enum/expansions.lua:296-312` defines `byExpansion.Forever.raceKeys`:
`HIGHORDER_SKYBORNE = 4294967296` (2^32), `WINDSHAPER_SKYBORNE = 8589934592` (2^33),
`ALL_ALLIANCE = 4294967373` (77 + 2^32), `ALL_HORDE = 8589934770` (178 + 2^33). Only a test
references it (`test.lua:955`); compat and the requiredRaces pass select constants by
`flavor.rules` = Classic (`compat.lua:174`, `requiredRaces.lua:42`), so **Forever corrections and
the Derived Pass still emit 77/178**. Raw Forever `requiredRaces` values max out at 178; none use
bit 32+.

Consumer semantics (Questie, not QuestieDB): race IDs 95 "High Order Skyborne" (Alliance) and
96 "Windshaper Skyborne" (Horde) use PlayableRaceBit 32/33 in ChrRaces of build 69893; on Forever,
exact masks 77/178 are treated as faction-wide and include Skyborne, while race-specific subsets
still require the actual bit (`Questie:Modules/QuestiePlayer.lua:21-26,91-107`,
`Questie:docs/forever-development.md:164-168`). Live Skyborne eligibility is "pending"
(`Questie:FOREVER_WORK_LEFT_TO_DO.md:29`).

Implementation hazard: JavaScript bitwise operators truncate to 32 bits. Test masks with
`BigInt` or arithmetic (`(mask % (2*bit)) >= bit`, as Questie does), never `mask & bit`.
**Superseded in part by D-012:** the BigInt option is not used. Masks are JavaScript numbers
(exact up to 2^53) tested with `Math.floor(mask / 2 ** bit) % 2 === 1`, where `bit` is the bit
index; Questie's form, with `bit` as the power of two, is equivalent. Exact masks 77 and 178
include the Skyborne race of that faction, following Questie.

### 8.3 Faction

- NPC `friendlyToFaction` (13): `"A"`, `"H"`, `"AH"`, nil. NPC `factionID` (12) is a
  FactionTemplate ID resolvable via `support/Forever/FactionTemplates`.
- Quest faction availability = `requiredRaces` (77/178/specific) after corrections and the
  Derived Pass, plus faction dynamic overlays.
- Object `factionID` (6) is a spawn-data faction restriction mask (70 raw rows).

---

## 9. Era vs Forever comparison experiment (`compare.mjs`)

Method: parse `data/Classic/classic*DB.lua` and `data/Forever/forever*DB.lua` at the pin; compare
ID sets; deep-compare rows; for rows that differ, compare each field, masking coordinate numbers
in coordinate-bearing fields (NPC 7/8, object 4/7, quest 9 `triggerEnd[2]`, quest 29
`extraObjectives[i][1]`); for every changed pair, re-project the Era value with
`conversion.json` coefficients and 2 dp half-away rounding and require exact equality.

| Type | Era | Forever | Only Forever | Only Era | Identical | Coordinate-only | Non-coordinate diff | Changed pairs | Pairs reproduced by transform |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Quest | 4,244 | 4,244 | 0 | 0 | 4,241 | 3 | 0 | 3 | 3 |
| NPC | 10,119 | 10,119 | 0 | 0 | 9,395 | 724 | 0 | 8,472 | 8,472 |
| Object | 6,645 | 6,645 | 0 | 0 | 6,039 | 606 | 0 | 4,144 | 4,144 |
| Item | 14,889 | 14,889 | 0 | 0 | 14,889 | 0 | 0 | 0 | 0 |

- Changed pairs by area: NPC 44:1,457, 139:2,309, 215:2,652, 1519:2,054; object 44:820, 139:1,374,
  215:1,065, 1519:885; quest 44, 139, 215 (quests 1699, 6185, 9264). These equal the
  `converted_by_area` counts in `conversion.json`. No changed pair lies outside the four areas, and
  key enums are identical.
- Correction providers: Forever `legacy/` files are byte-identical to Era for items, reputation
  and item-start; quest/NPC/object providers are identical after masking numeric literals, with
  19 / 1,780 / 332 changed numeric tokens (= 10 / 890 / 172 converted pairs; Redridge `y` is
  unchanged because its `scale_y` is 1).
- After corrections, upstream's Golden records composed differences for 12 quests, 741 NPCs,
  607 objects and 0 items between Vanilla and Forever (`docs/forever-validation.md:47-49`); the
  extra rows over the raw diff come from converted correction coordinates.

**Reliability.** As a statement about *QuestieDB's data*, the classification is exact and
reproducible: every Forever entity is `era-inherited`, 1,333 are `era-inherited, coordinates
converted`, none are new or modified. **Superseded by D-026:** the labels `era-inherited` and
`era-inherited, coordinates converted` are this file's revision-1 vocabulary. D-026's
`RecordProvenance` replaces them with `upstreamDiff: 'era'` and `upstreamDiff: 'era-coords'`
(see the Rev 2 note at the end of this section); the counts are unchanged. As a statement about
*the Forever game* it is **NOT reliable**:

1. Coordinate conversion is a frame change, not a content change, and assumes unchanged world
   positions; it cannot detect moved NPCs or terrain.
2. No new Forever content has been imported (empty `forever*Fixes`, no new rows), so "not new"
   means "not yet captured", not "absent in Forever". New zones exist in DBC/map data
   (section 5.1) with zero entities.
3. Presence does not prove availability: Era rows (including content Blizzard may have removed or
   changed in Forever) are all present; QuestieDB keeps unobtainable quests by design
   (`CONTEXT.md:232-234`).
4. The future classifier must be three-way. Forever no longer follows Era (`docs/forever-data.md:256-259`),
   so later diffs mix Era-side edits with Forever-side edits. Use the adoption base
   (`conversion.json.files[].source_sha256`, still equal to current Era at the pin) as the merge base.

**Rev 2 (D-026; ARCHITECTURE §5.3, §12.4; DATA_PROVENANCE §9.3).** D-026 supersedes D-007's
vocabulary (`forever: 'unknown'`, `basis: 'era-baseline-copy'`) and classifier scope; D-007's
principle, that no record claims a Forever verification, stands. Every record carries a
`RecordProvenance` (`src/domain/dataset.ts`) with two separate fields. `upstreamDiff` is a fact
about QuestieDB: `'era'` (identical to Era), `'era-coords'` (differs only by converted
coordinates; 1,333 raw rows before corrections), `'forever-new'` or `'forever-changed'` (none at
the pin). `foreverStatus` is a claim about the game: `'unknown'` for every dataset record, or
`'user-declared-new'` / `'user-declared-changed'` when the user says so.
`corrected`, `created` and `source` complete the record. The manifest carries
`foreverContentVerified: false`. `tools/questiedb/diff.ts` is first a pin-to-pin dataset diff; its
three-way classifier is a stub that returns `unknown` until upstream has Forever content (review
F23, D-026).

---

## 10. Obtaining corrected tables offline: options

| Option | What it gives | Requirements / caveats |
| --- | --- | --- |
| A. `generate.lua Forever` | `QuestieDB_Forever.toc` (Baked CBOR metadata) with static corrections and Derived Passes folded in; `generate.flavor` prints counts (`generate.lua:294-384`) | Lua 5.1 (plain, no C modules; `generate.lua:20-22`). Output is TOC/CBOR, not JSON. Writes into the clone root. |
| B. `generator/flavor.lua` `load(flavor)` from a small Lua driver | In-memory corrected+derived tables (shared by generate/verify/reconstruct, `generator/flavor.lua:24-61`) | Lua 5.1 plus our own JSON dumper; couples to internal (non-public) generator APIs |
| C. Emulator persona | Load the addon under `emulator/client.lua` with `faction`, `classFile`, `raceName` etc. (`emulator/client.lua:86-160`) and read through the public API, including Dynamic Corrections | Lua 5.1; how `equivalence.lua` exercises personas |
| D. `verify.lua`, `reconstruct.lua`, `validators/run.lua` | Round-trip and byte-exact checks of an artifact | Lua 5.1; validation, not extraction |
| E. Release artifact | GitHub Releases list `QuestieDB-Forever.zip`, `QuestieDB-all.zip` and `release.json` for 1.0.0-1.0.3 (2026-09-19..22) and a rolling `preview` (per github.com/Questie/QuestieDB/releases fetched 2026-09-25; contents not downloaded, UNVERIFIED) | Baked data only (static layer); dynamic providers ship as Lua; CBOR storage is an internal contract (`contractVersion` 2) |
| F. TypeScript static evaluation (section 7.6) | Raw + static + dynamic overlays + requiredRaces, no Lua runtime | Must re-implement MergeInto/order/derived semantics and fail closed on unknown syntax; needs a parity check against A/B/E |

**Chosen: F** (D-009; ARCHITECTURE §5.1): luaparse (declared MIT, dev dependency only) plus a
whitelisted evaluator that fails closed. No Lua runtime is part of the pipeline or CI; A, B or E
remain candidates for the optional manual parity check (ARCHITECTURE §5.2; DATA_PROVENANCE §5).
**Superseded by ARCHITECTURE §5.2:** row F's "needs a parity check against A/B/E" is optional,
not required; the required checks are golden counts, output hashes, schema and referential
integrity.

Bundled Lua: **Lua 5.1.5** with bit32, LuaFileSystem 1.8.0, Busted 2.2.0 embedded, for
**Windows x64** (`tools/lua-binary/lua.exe`, SHA-256 `1e2911d6...7f0e`) and **Linux/WSL x64**
(`tools/lua-binary/linux-x64/lua`, SHA-256 `09ed2876...3ff2`); macOS needs an installed Lua 5.1 or
LuaJIT (`README.md:89-103`, `tools/lua-binary/README.md:1-35`). The Windows binary is unsigned
(`tools/lua-binary/README.md:33-35`). Local checksums match `SHA256SUMS`. **Not executed in
Milestone 0.** The QuestieDB DBC source database used for conversions is a private release that
needs an authenticated `gh` login (`README.md:228-231`), so DBC-derived steps are not reproducible
by us.

---

## 11. Parser experiment (`parse-timing.mjs`)

Node v22.13.1, luaparse 0.3.1 (MIT), Windows 11, `--expose-gc`, 3 runs, min time reported.
"literal" = purpose-built parser in `lib.mjs`; "luaparse" = `luaparse.parse` with
`encodingMode: 'pseudo-latin1'` (input re-encoded as latin1 so string escapes are byte-accurate,
then values decoded back as UTF-8), plus AST->value conversion.

| File | Bytes | Rows | literal ms | literal heap MB | luaparse AST ms | luaparse+convert ms | luaparse heap MB |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| foreverQuestDB.lua | 1,038,790 | 4,244 | 18 | 13.9 | 31 | 36 | 36.7 |
| foreverNpcDB.lua | 2,033,176 | 10,119 | 62 | 38.0 | 86 | 109 | 99.3 |
| foreverObjectDB.lua | 1,011,387 | 6,645 | 39 | 29.1 | 39 | 51 | 56.3 |
| foreverItemDB.lua | 2,181,706 | 14,889 | 50 | 17.3 | 78 | 91 | 60.2 |

Both parsers produced deep-equal values for all four files. Peak RSS for the whole run was
~237 MB. Whole-script wall-clock times (including Node start-up): `compare.mjs` (8 entity files)
0.59 s, `evaluate.mjs` (4 entity files, 10 correction providers, 10 enum files, all personas)
0.98 s, `corrections.mjs` 0.41 s. Parse cost is irrelevant to the design; correctness and
strictness are what matter.

---

## 12. Counts, reference graph and size estimates (`analyze.mjs`, raw Forever data)

### 12.1 Referenced entities

| Kind | Referenced | Roles (an entity can have several) |
| --- | ---: | --- |
| NPC | 5,809 of 10,119 | starter 1,504; finisher 1,361; creature objective 608; drop source of a quest item 4,205; has questStarts/Ends 1,624 |
| Object | 862 of 6,645 | starter 194; finisher 176; objective 76; drop source 561; has questStarts/Ends 225 |
| Item | 2,872 of 14,889 | objective 1,906; sourceItem 854; starter 206; requiredSourceItem 62; container source 100 |

All references resolve to existing rows. Kill-credit, spell-objective and extraObjective
references are empty in raw data (they come from corrections). Drop sources dominate the NPC set;
a planner that only needs "where to kill for item X" still needs them.

**Rev 2 entity set (ARCHITECTURE §5.2; critique F07).** `entities.json` also ships every NPC whose
`npcFlags` has FLIGHT_MASTER (8), TRAINER (16) or INNKEEPER (128): a dataset flight master
supplies the `npcId` of a `TaxiNodeRef { npcId, taxiNodeId, name }` (ARCHITECTURE §8.1, §9.1;
new Forever nodes have no dataset NPC and use a cited TaxiNodes id), and hearth binds and
training happen at innkeepers and trainers, most of which no quest references. Measured on raw
Forever data at `b6f5b07` during the post-critique revision; DATA_PROVENANCE §6.3 and §6.8 use
these numbers. Method: rebuild the reference graph exactly as `analyze.mjs` does
(reproducing 5,809 referenced NPCs), test NPC field 15 for bit indices 3, 4 and 7 with
`Math.floor(flags / 2 ** bit) % 2 === 1` (D-012), and gzip -9 the section 12.3 NPC planner fields
of the enlarged set:

| Flag | NPCs with the flag | Not quest-referenced |
| --- | ---: | ---: |
| FLIGHT_MASTER | 61 | 51 |
| TRAINER | 499 | 297 |
| INNKEEPER | 56 | 34 |
| **Added to the set** (no overlap among the added) | | **382** |

The NPC set grows from 5,809 to 6,191. With the section 12.3 NPC fields that adds 74 KB JSON and
14 KB gzip -9 (1,750 → 1,824 KB JSON; 458 → 472 KB gzip). The critique counted by `subName`
instead (63 flight-master titles, 53 of them unreferenced; 45 "Innkeeper" titles, 31 unreferenced);
`npcFlags` is the field ARCHITECTURE uses. Static corrections write `npcFlags` on 31 NPCs
(section 7.3), so the composed counts may differ slightly.

### 12.2 Quest scalar census

`requiredRaces`: 0 in 1,464 quests, 77 in 1,321, 178 in 1,170, then race-specific masks.
`requiredClasses`: 0 in 3,440. `zoneOrSort`: 3,260 positive AreaIDs, 983 negative QuestSort, 1 nil.
85 quests have no starter at all; 609 carry the repeatable flag; 34 have `triggerEnd`.

### 12.3 JSON size estimates (raw data, planner subset, before corrections)

| Payload | JSON | gzip -9 | brotli q11 |
| --- | ---: | ---: | ---: |
| All raw rows, all fields, 4 types | 6,199 KB | 1,549 KB | 1,084 KB |
| Quests, planner fields (all except objectivesText) | 1,014 KB | 124 KB | 92 KB |
| Quests, planner fields + objectivesText | 1,452 KB | 226 KB | 166 KB |
| Referenced NPCs: name, levels, rank, spawns, waypoints, zoneID, questStarts/Ends, factionID, friendly, subName, npcFlags | 1,750 KB | 458 KB | 351 KB |
| Referenced NPCs without waypoints/subName/npcFlags | 1,227 KB | 343 KB | 271 KB |
| Referenced objects (name, questStarts/Ends, spawns, zoneID, factionID) | 411 KB | 112 KB | 82 KB |
| Referenced items (name, npc/object/item drops, startQuest, class, subClass) | 358 KB | 82 KB | 56 KB |
| QuestXP | 55 KB | 13 KB | 10 KB |
| **Planner bundle** (quests w/o text + referenced NPC/object/item + XP) | **3,588 KB** | **789 KB** | **582 KB** |

Keyed-object JSON with field names; a columnar or positional encoding would be smaller. Spawn
coordinates are the bulk; corrections change these figures only marginally (+47 entities).

**Rev 2 reading of these numbers.**

- The estimates are on the source-frame percent coordinates, which is what ships (D-017), so they
  apply directly.
- ARCHITECTURE §5.2 ships `objectivesText` and the extended NPC set of section 12.1. Adjusting the
  planner bundle gives about **905 KB gzip** (789 − 124 + 226 + 14; derived by adding separately
  compressed parts, not measured as one payload). Zones, overlays and the manifest come on top.
  ARCHITECTURE §5.2 estimates under 1 MB gzip in total; the §14 CI gate is a recorded baseline
  + 10% per `public/data` file and 1.2 MB in total.
- Encoding: ARCHITECTURE §2 (principle 7) keeps plain JSON loaded whole at startup. A columnar or
  positional encoding, or per-zone chunking, is a later optimisation only if the §14 startup
  budget is missed (critique F08).

---

## 13. Worked examples (raw Forever rows, decoded)

### 13.1 Quest 7 "Kobold Camp Cleanup" (`data/Forever/foreverQuestDB.lua:60`)

Raw: `[7] = {"Kobold Camp Cleanup",{{197}},{{197}},1,2,77,nil,{"Kill 10 Kobold Vermin, then return to Marshal McBride."},nil,{{{6}}},nil,nil,{783},nil,nil,nil,9,nil,nil,nil,nil,nil,8,nil,nil,{{72,250}}},`

| # | Field | Raw value | Meaning | After static corrections |
| ---: | --- | --- | --- | --- |
| 1 | name | "Kobold Camp Cleanup" | | same |
| 2 | startedBy | `{{197}}` | NPC 197 starts it | same |
| 3 | finishedBy | `{{197}}` | NPC 197 finishes it | same |
| 4 | requiredLevel | 1 | | same |
| 5 | questLevel | 2 | XP row `[7] = {2, 170}` | same |
| 6 | requiredRaces | 77 | ALL_ALLIANCE (Era mask) | same |
| 7 | requiredClasses | nil | any | same |
| 8 | objectivesText | one line | only place the count "10" appears | same |
| 9 | triggerEnd | nil | | same |
| 10 | objectives | `{{{6}}}` | creature group: NPC 6, no text, no icon (read contract pads icon to 0) | same |
| 11-12 | sourceItemId, preQuestGroup | nil | | same |
| 13 | preQuestSingle | `{783}` | requires "A Threat Within" | same |
| 14-16 | childQuests, inGroupWith, exclusiveTo | nil | | same |
| 17 | zoneOrSort | 9 | AreaTable 9 Northshire Valley (maps to UiMap 1429 Elwynn) | same |
| 18-21 | skill/rep/source items | nil | | same |
| 22 | nextQuestInChain | nil | | **15** (`classicQuestFixes.lua:40-42`) |
| 23 | questFlags | 8 | SHARABLE | same |
| 24-25 | specialFlags, parentQuest | nil | | same |
| 26 | reputationReward | `{{72,250}}` | faction 72 (Stormwind) +250 | **`{{72,100}}`** (`classicQuestReputationFixes.lua:21-23`) |

### 13.2 NPC 197 "Marshal McBride" (`data/Forever/foreverNpcDB.lua:106`)

Raw: `[197] = {'Marshal McBride',484,484,20,20,0,{[12]={{48.92,41.61}}},nil,12,{7,15,21,54,3100,3101,3102,3103,3104,3105},{7,15,21,783},12,"A",nil,3},`

| # | Field | Value | Meaning |
| ---: | --- | --- | --- |
| 1 | name | 'Marshal McBride' | |
| 2-3 | min/maxLevelHealth | 484, 484 | deprecated; read as 0 and 1 |
| 4-5 | minLevel, maxLevel | 20, 20 | |
| 6 | rank | 0 | normal |
| 7 | spawns | `{[12]={{48.92,41.61}}}` | Elwynn Forest (AreaID 12 -> UiMap 1429) at 48.92%, 41.61%; Elwynn is an unchanged frame |
| 8 | waypoints | nil | stationary |
| 9 | zoneID | 12 | |
| 10 | questStarts | {7,15,21,54,3100,...,3105} | includes class quests 3100-3105 |
| 11 | questEnds | {7,15,21,783} | |
| 12 | factionID | 12 | FactionTemplate 12 |
| 13 | friendlyToFaction | "A" | Alliance only |
| 14 | subName | nil | |
| 15 | npcFlags | 3 | GOSSIP(1) + QUEST_GIVER(2) |

The objective target NPC 6 "Kobold Vermin" (`foreverNpcDB.lua:29`) has 31 spawn points under
`[12]`, levels 1-2, factionTemplate 25, `friendlyToFaction` nil (hostile to both).

### 13.3 Object 55 "A half-eaten body" (`data/Forever/foreverObjectDB.lua:28`)

Raw: `[55] = {"A half-eaten body",{45},{37},{[12]={{72.66,60.34}}},12},`

| # | Field | Value | Meaning |
| ---: | --- | --- | --- |
| 1 | name | "A half-eaten body" | |
| 2 | questStarts | {45} | starts "Discover Rolf's Fate" (quest 45 `startedBy = {nil,{55}}`, `foreverQuestDB.lua:94`) |
| 3 | questEnds | {37} | finishes quest 37 |
| 4 | spawns | `{[12]={{72.66,60.34}}}` | Elwynn Forest |
| 5 | zoneID | 12 | |
| 6-7 | factionID, waypoints | absent | |

### 13.4 Item 773 "Gold Dust" (`data/Forever/foreverItemDB.lua:127`)

`{'Gold Dust',{40,327,475,476},nil,nil,nil,nil,nil,nil,1,0,0,12,0}`: dropped by NPCs 40, 327,
475, 476; itemLevel 1; requiredLevel 0; ammoType 0; class 12 (quest item); subClass 0. It is the
item objective of quest 47 (`objectives = {nil,nil,{{773}}}`, `foreverQuestDB.lua:96`).

---

## 14. Provenance metadata and build numbers

| Build / ID | Meaning | Source |
| --- | --- | --- |
| `1.15.9.69722` | Era DBC build: source frame of the coordinate conversion | `conversion.json:1453`; `docs/forever-data.md:48` |
| `1.60.1.69893` | Forever DBC target build (maps, factions, conversion) | `conversion.json:1454`; `support/Forever/provenance.json:7`; `docs/forever.md:140` |
| `1.60.1.69913` | Researched Forever UI source; "not the same build" as the DBC target | `docs/forever.md:140-142`; Questie: "final observed build 69913" (`Questie:docs/forever-development.md:136`) |
| `1.60.1.69977` | Beta build of 2026-09-23 (`forever-game-rules.md` section 2, S8); the brief's value for the local client, **superseded**: the local client was observed at 1.60.1.70009 on 2026-09-25 (D-013) | not an input to any QuestieDB data |
| `1.60.1.70009` | Locally installed beta client observed 2026-09-25 (`.build.info`); recorded build of the 12 DB2-only placeholder geometry rows, while the 49 QuestieDB frames record 69893 (D-018, D-026) | not an input to any QuestieDB data; `UiMapAssignment` is byte-identical to 69893 (D-013) |
| Interface `16001` | Forever TOC interface declared by QuestieDB | `src/config.lua:61` |
| `0529e8d82075316242b0796e2128afb40d300130` | Clean QuestieDB seed commit for Forever adoption | `docs/forever-data.md:16`; `provenance.json:1178` |
| `d94542ac92423f05c6fbde6574ada29b15c0d4e8` | Coordinate-tool checkout base | `docs/forever-data.md:17-19`; `provenance.json:4` |
| `454b9d072965ee8f1a881429260fcf1fac8d60f7` | Last Questie migration reference (historical, 2026-09-15, v11.38.0) | `PROVENANCE.md:3-11` |
| `X-BUILD-COMMIT`, `X-BUILD-TIME` | Stamped into every generated TOC | `docs/storage-format.md:202-209` |
| `release.json` `producerCommit`, `artifacts[].sha256` | Release provenance | `docs/release-format.md:31-51` |

Authorship line QuestieDB writes into every TOC: "Code: Logonz Data:
Muehe/TheCrux(BreakBB)/Drejjmit/Dyaxler/Cheeq/TechnoHunter/Yttrium/Everyone else"
(`generate.lua:90`). No licence file or licence statement exists in either the QuestieDB or the
Questie clone at the pinned commits (`git ls-files`; `README.md` has no licence section).

A later full-history check (D-016, 2026-09-25) found that neither `Questie/Questie` nor
`Questie/QuestieDB` has ever had a root licence file (none covering Questie's own code or data; bundled third-party folders carry their own; wording corrected after the Milestone 2 review) on its default branch. Questie's unmerged
`license` branch (commits `ce65498c`, 2023-02-13, to `842201bd`, 2024-05-06) drafts a
`LICENSE.md` saying that Questie historically never had a licence and should, when in doubt, be
considered "all rights reserved", plus a contributor licence agreement intended to relicense as
MIT (CC0 where MIT is not applicable). The owner's posture (D-016) is to build, commit and
publish the Questie-derived dataset with prominent notices of this finding; the repository's own
code stays GPL-3.0-or-later, which grants no rights over Blizzard content or third-party material
embedded in the upstream data. This is not a legal conclusion; see DATA_PROVENANCE.md section 3.

---

## 15. Gotchas for the extractor

1. Hash LF blob bytes; Windows autocrlf silently changes working-file hashes (section 2).
2. Positional `nil` holes are significant (`{nil,{55}}` = object starter). Do not use array
   compaction; decode positional tables with holes.
3. Mixed tables do not occur in rows, but correction values can mix `[k]=` and positional parts
   (e.g. `extraObjectives` rows); the decoder must support both.
4. `[k] = {}` in a correction deletes; `[k] = nil` is a no-op; corrections replace whole fields.
5. `itemStartFixes` is `noNewEntries` + `noOverwrites` and runs before `classicItemFixes`.
6. Race masks can exceed 2^32 in future Forever data; avoid 32-bit bitwise ops (D-012:
   `Math.floor(mask / 2 ** bit) % 2 === 1`).
7. Coordinates are percent-of-zone by AreaID; convert via `areaIdToUiMapId` (override wins, value
   0 = suppressed) before drawing on a UiMap. Never re-apply the Era->Forever transform.
   **Rev 2 (D-017):** the extractor ships the percent values and the AreaId→UiMapId table
   (`zones.json`) unchanged; the conversion happens at load in `infra/data` through `src/geo`.
8. `{-1,-1}` is presence, not a point; resolve to entrances via `dungeons.lua`.
   **Rev 2 (ARCHITECTURE §5.2):** it loads as `InstancePresence`, resolved to the `zones.json`
   entrance when one exists and otherwise left unresolved; a point whose AreaId has no UiMap
   loads as `UnmappedAreaPoint` with a reason (section 4.1).
9. `zoneOrSort < 0` is a QuestSort category (class, profession, holiday), not a place.
10. Support files are executable Lua with deferred strings and runtime calls
    (`dungeons.lua:4` calls `UnitFactionGroup`; `instanceIdToAreaId.lua` references
    `ZoneDB.zoneIDs`); parse and evaluate them with the same whitelisted evaluator.
11. Objective counts and quest-reward money are not in QuestieDB (Rev 2: counts are `null`,
    ARCHITECTURE §5.3).
12. Do not apply the read contract's pad-to-0 (section 3.6); absent numbers are `null`.

## 16. Experiment scripts (throwaway, gitignored)

| Script | Purpose |
| --- | --- |
| `.cache/experiments/data/lib.mjs` | File splitting, literal parser, luaparse AST converter |
| `parse-timing.mjs` | Section 11 timings (`node --expose-gc`) |
| `compare.mjs` | Section 9 Era vs Forever comparison and transform verification |
| `corrections.mjs`, `stmts.mjs` | Sections 7.3 and 9 provider analysis |
| `evaluate.mjs` | Section 7.6 TypeScript-style static evaluation PoC |
| `analyze.mjs`, `probe.mjs`, `probe2.mjs`, `fieldcounts.mjs` | Sections 3, 4, 12 censuses |

They depend only on Node 22 and `luaparse@0.3.1` installed in that folder, and read the clone at
`.cache/questiedb`. They are evidence for this document, not project code.
