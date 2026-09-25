# Data provenance

The authoritative record of where forever-route-lab's game data comes from, what upstream
declares about its licence, the owner's posture, how the data is transformed, and how every
generated file is marked and traced. The detailed field reference and the Milestone 0 experiment
results are in [`research/questiedb-schema.md`](research/questiedb-schema.md).

| | |
| --- | --- |
| Status | Milestone 0, **revision 2 (2026-09-25)**, aligned with [ARCHITECTURE.md](ARCHITECTURE.md) revision 2, [DECISIONS.md](DECISIONS.md) D-016 to D-026 and the domain types in `src/domain/*.ts` after the independent critique ([reviews/review-m0-architecture.md](reviews/review-m0-architecture.md); finding IDs such as LIC-09 refer to it) and the Milestone 0 consistency check. The extraction tool (`tools/questiedb/`) is a **Milestone 2** deliverable (ARCHITECTURE §18; critique F14) and does not exist yet. Sections marked **Planned** are the contract Milestone 2 implements; this file changes in the same commit as the tool. |
| Owner of this file | Whoever changes `tools/questiedb/`, the upstream pin, or the data notices |
| Authority | This file is the single definition of the dataset manifest (§8), which ARCHITECTURE §5.2 and D-026 reference. Where this file and ARCHITECTURE, a DECISIONS entry or the domain types in `src/domain/` disagree, they win and this file is corrected. |
| Related decisions | D-001 (repository licence; context and rationale superseded by D-016), D-002 (commit the dataset; manifest contents superseded by D-026, notices by D-016), D-007 (principle stands; vocabulary and classifier scope superseded by D-026, §9.3-9.4), D-009 (luaparse extractor), D-012 (arithmetic bit tests), D-013 (data frame 69893; per-row geometry builds, D-026), **D-016** (licence finding; publish anyway), **D-017** (spawns as published), **D-018** (placeholder geometry), D-022 (cited client values), D-025 (deployment hygiene), **D-026** (provenance vocabulary, manifest contents, build recording) |

---

## 1. Summary

| Question | Answer |
| --- | --- |
| Upstream | [Questie/QuestieDB](https://github.com/Questie/QuestieDB), flavour **Forever** |
| Pinned commit | `b6f5b07b0acf1c820993cbb0ce2521c912bb4c92` (2026-09-23 14:13:50 +0200, "feat: add generated Era-to-Forever coordinate helpers") |
| Upstream licence | **No licence file, ever**, on the default branch of either Questie/QuestieDB or Questie/Questie (full-history check, 2026-09-25). Questie's unmerged `license` branch (commits `ce65498c`, 2023-02-13, to `842201bd`, 2024-05-06) drafts a notice saying that, when in doubt, Questie should be considered "all rights reserved", and a contributor licence agreement to relicense contributions as MIT, or CC0 where MIT is not applicable (§3.1) |
| Owner decision | Build, commit **and publish** the Questie-derived dataset with prominent notices of that finding; the owner accepts the risk (D-016). This repository's code stays GPL-3.0-or-later (D-001, D-016). Not a legal conclusion (§3.2) |
| What the data really is | The Classic Era QuestieDB baseline with an Era→Forever map-coordinate projection on four zones. **No Forever-specific quest, NPC, object or item content exists upstream yet** (§9). Every record ships `foreverStatus: 'unknown'`; the manifest says `foreverContentVerified: false` |
| What we ship | `public/data/`: `manifest.json`, `NOTICE.md`, `quests.json`, `entities.json`, `items.json`, `spawns.json`, `zones.json`, `overlays.json` (§6). Spawns stay as published: 0-100 zone percent keyed by AreaTable ID (D-017). Map geometry is not part of the dataset; it lives in `public/maps/placeholder/` (D-018). Never raw upstream Lua (D-002). The extraction report is neither shipped nor committed (§8.4) |
| Regeneration | Only by `tools/questiedb/` from the pinned commit; never hand-edited. The dataset is identified by a content-addressed `dataRevision` (§8.3). A `tools/questiedb` change lands in the same commit as the regenerated dataset, and CI re-extracts to check byte-reproducibility (§5) |

---

## 2. Upstream source and pin

| Field | Value |
| --- | --- |
| Repository | `https://github.com/Questie/QuestieDB` |
| Branch observed | `master` (the default branch) |
| Commit | `b6f5b07b0acf1c820993cbb0ce2521c912bb4c92` |
| Commit date / subject | 2026-09-23 14:13:50 +0200 / "feat: add generated Era-to-Forever coordinate helpers" |
| QuestieDB's own lineage | Initial data and schema imported from Questie/Questie; last migration reference `454b9d072965ee8f1a881429260fcf1fac8d60f7` (2026-09-15, "Bump version to v11.38.0"), described upstream as historical provenance, not a build input (`PROVENANCE.md:3-11` in QuestieDB) |
| Forever adoption lineage | Clean seed `0529e8d82075316242b0796e2128afb40d300130`; coordinate tool base `d94542ac92423f05c6fbde6574ada29b15c0d4e8` (`docs/forever-data.md:16-19`, `support/Forever/provenance.json:4,1178`) |
| Upstream authorship line | "Code: Logonz Data: Muehe/TheCrux(BreakBB)/Drejjmit/Dyaxler/Cheeq/TechnoHunter/Yttrium/Everyone else" (written by QuestieDB into every TOC, `generate.lua:90`). Quoted in `public/data/NOTICE.md` and THIRD_PARTY_NOTICES.md |
| Local research clones | `.cache/questiedb` (shallow, at the pin); full-history clones `.cache/hist-QuestieDB` and `.cache/hist-Questie` used for the licence check in §3.1. All gitignored, never committed |

Consumer semantics were cross-checked (read only) against Questie/Questie
`40016145f8181f3f92049146ee655bd03d604a0a` (2026-09-24), notably the objective order in
`Database/QuestieDB.lua:1735-1864` (§6.2.1). No Questie file is an input.

**Pin policy (Planned).** The pin is a full 40-character commit SHA in one place,
`tools/questiedb/upstream.json` (ARCHITECTURE §4), and is repeated in the manifest
(`upstream.commit`, §8) and in every generated file's `_generated.upstream` (§7). `fetch.ts` and
the CI re-extraction (§5) read it from that file. Branch names and release tags are never inputs.
Changing the pin is a reviewed change that regenerates `public/data/` and the fixture slice, runs
`validate` and `diff`, re-runs the licence check (§3.1 item 3), and records the diff summary in the
commit message (§12).

---

## 3. Licence finding, posture and owner decisions

### 3.1 Facts (no interpretation)

1. On 2026-09-25 GitHub reported `license: null` for both Questie/QuestieDB and Questie/Questie,
   and `LICENSE` returned 404 for both.
2. At the pinned commits, `git ls-files` in both clones lists no root `LICENSE*`, `COPYING*` or
   `NOTICE*` file, and neither README has a licence section. The only licence texts in the
   QuestieDB tree are third-party notices for the bundled Lua interpreters
   (`tools/lua-binary/THIRD_PARTY_NOTICES.txt`, MIT-style) and a note that vendored
   `LibDeflate.lua` is zlib-licensed (`docs/adr/0010-cbor-rows-and-tables.md:95`).
3. **Full-history check** (the verification task added by critique LIC-10), run 2026-09-25 in full
   clones with every remote branch: QuestieDB 12 remote branches, 183 commits, default branch
   `master` at `b6f5b07`; Questie 104 remote branches, 23,894 commits, default branch `master` at
   `40016145`. Command: `git log --all --format='%H %ad %s' -- 'LICENSE*' 'COPYING*' 'CLA*'`
   (root paths).
   - **QuestieDB:** no output. No root licence file has existed on any branch.
   - **Questie:** four commits, all on the unmerged branch `license`. None is reachable from
     `master` (`git merge-base --is-ancestor 842201bd origin/master` fails).

     | Commit | Date | Subject | What it does |
     | --- | --- | --- | --- |
     | `ce65498cfa436d50e0b0d00c1b8fa5491e79ddd4` | 2023-02-13 | Add licensing related information | Adds `LICENSE.md` and `Licenses/gpl-3.0.txt`. This first draft proposes collecting contributor consent for GPL v3, and says that since Questie never had a licence it should be considered "all rights reserved" when in doubt |
     | `68b58e19bdad1b2e11fef2c33f5f29e0278c35b7` | 2023-06-05 | Clarify license priority | Precedence: a per-file notice, then a subdirectory `LICENSE.md`, then the root file |
     | `375d5f0cb2788a546fbe25c2bb2faaa17169427e` | 2024-05-06 | Update licensing PR | Adds `CLA.md` and MIT, CC0 1.0 and CC BY 4.0 texts. The stated intent changes from GPL v3 to MIT by default, and CC0 where MIT is not applicable |
     | `842201bd59a088696400644f2e9de261013446d2` | 2024-05-06 | Sign CLA.md | First signature; branch tip |

   - The draft at the tip says Questie "historically never had a license" and keeps the "all
     rights reserved" disclaimer. It considers historic contributions to have been made in the
     spirit of open source, without speaking for individual contributors, and counts 110 historic
     contributors. Signers of `CLA.md` license their contributions as MIT and CC0 1.0 and allow
     relicensing under MIT, BSD, GPL-2, GPL-3, CC BY 4.0, CC0 1.0 or similar licences. The CLA's
     effective date is still the placeholder `TODO_ADD_MERGE_DATE`, and it lists one signatory.
   - Questie `master` does carry subdirectory licence files for bundled third-party material:
     `Libs/LICENSE.txt` (Ace3, BSD-style), `Libs/Krowi_WorldMapButtons/LICENSE.md`,
     `ExternalScripts(DONOTINCLUDEINRELEASE)/slpp/LICENSE`, and `Icons/LICENSE.md` (MIT for listed
     icon files copied from pfQuest). None covers Questie's own code or data, and none is a
     QuestieDB input.
4. The project brief describes QuestieDB as GPLv3. No upstream file supports that (D-016). D-001's
   original context line, which said Questie "has historically been published as GPL-3.0", is
   likewise unsupported by the history above. DECISIONS corrected that wording in place on
   2026-09-25, and D-016 supersedes D-001's context and rationale.
5. Parts of the upstream data declare non-Questie origins. They are carried into the manifest's
   per-output `origins` (§8.2) and into `NOTICE.md`:
   - **Drop percentages:** `support/Forever/DropTables/classicItemDrops.lua` holds `wowheadData`
     (line 7: "automatically generated from wowhead data") and `cmangosData` (line 17806:
     "automatically generated from cmangos data"). Not shipped (§3.2).
   - **Item quest starts:** `src/corrections/Forever/legacy/itemStartFixes.lua:13` says the file
     is "automatically generated from wowhead data". Shipped as `startQuest` by default (OD-7, §3.3).
   - **Client-derived values:** map, area, faction-template and coordinate-frame facts derive from
     Blizzard client DBC exports (builds 1.15.9.69722 and 1.60.1.69893; `data/Forever/conversion.json`,
     `support/Forever/provenance.json`). `areaIdToUiMapId.lua` and `uiMapIdToAreaId.lua` begin
     "Manually completed Forever handoff for build 1.60.1.69893" and warn that regeneration will
     overwrite the additions.
   - **Blizzard game content:** entity names, quest text (`objectivesText`, `triggerEnd` text),
     zone names and dungeon names.
   - **Quest XP:** `support/Forever/QuestXP/xpDB-classic.lua:1` says the file is generated by a
     `generateQuestXp.lua` script; where its values come from is not stated. It was seeded as a
     copy of the Era file (`docs/forever-data.md:70`).
   - Several field meanings (NPC `rank`, `factionID`, `npcFlags`; quest `questFlags`,
     `specialFlags`) are documented upstream with links to the CMaNGOS wiki (for example
     `data/Forever/foreverQuestDB.lua:40-41`). These are documentation references, not declared
     data origins.

### 3.2 Posture and owner decision

- **Owner decision (D-016).** The owner decided to build, commit **and publish** the
  Questie-derived dataset with prominent notices of the §3.1 finding, and accepts the risk.
  D-001 and D-002 stand; D-016 supersedes D-001's context and rationale and D-002's notices
  wording, and D-026 supersedes D-002's list of manifest contents (§8.1).
- **Pattern.** Questie/QuestieDB declare no licence (no licence file on either default branch in
  full history; §3.1). Questie's own unmerged draft says to consider Questie "all rights reserved"
  when in doubt. The owner's posture is to publish the derived dataset with these notices. This
  repository is licensed GPL-3.0-or-later, and it treats Questie-derived data under that licence
  as a posture. This is not a legal conclusion, and it grants no rights that upstream has not
  granted.
- **Carve-out (LIC-10).** Used verbatim in `NOTICE.md`, THIRD_PARTY_NOTICES.md, the README and
  the in-app About dialog:

  > GPL-3.0-or-later applies to this project's contributions and, as a posture, to
  > Questie-derived data; it grants no rights over Blizzard content (names, text, client-derived
  > values) or other third-party material embedded in that data.

- *Superseded by D-016 and LIC-10:* revision 1 said the whole repository "including
  `public/data/`, is distributed under GPL-3.0-or-later" and that the data is "treated as
  GPL-3.0". The carve-out above replaces both statements, and the manifest's `licence` object
  (§8.1) replaces the `licenceTreatment` string.
- **Regeneration materials.** The repository keeps what a recipient needs to regenerate the data:
  the extractor source, the pinned upstream commit, and per-input checksums in the manifest.
  Whether upstream inputs are also archived with releases is OD-8 (§3.3).
- **Drop percentages are not shipped** (§6). That removes the declared Wowhead- and
  CMaNGOS-generated numeric tables from the output. Drop *sources* (which NPCs, objects and items
  drop a quest item) come from QuestieDB item fields 2-4, for which upstream declares no origin.
- **Item-start facts** from `itemStartFixes.lua` are shipped by default, with their declared
  origin recorded in the manifest and `NOTICE.md`; the decision is OD-7 (§3.3). *Withdrawn
  (LIC-11):* revision 1 justified shipping them "because the addon itself exposes them". That
  others publish something does not establish permission, so that reasoning is not relied on.
- **Where notices live:** `public/data/NOTICE.md` and `public/maps/placeholder/NOTICE.md` (copied
  to `dist/data/NOTICE.md` and `dist/maps/placeholder/NOTICE.md`, both of which `audit-dist`
  requires, ARCHITECTURE §16), `tests/fixtures/data/NOTICE.md`,
  the `_generated` key of every generated JSON file (§7), THIRD_PARTY_NOTICES.md, the README and
  the About dialog (ARCHITECTURE §12.4, §16).
- **Change triggers.** If upstream publishes a licence file or merges its `license` branch,
  record the text, SPDX identifier and commit in §3.1, set `licence.upstreamLicenceFile` in the
  manifest, update `NOTICE.md` and THIRD_PARTY_NOTICES.md, and add a DECISIONS entry if the
  posture changes. The full-history check is repeated at every pin bump (§12).

### 3.3 Owner decisions

IDs are those of the **Owner decisions** table in [STATUS.md](../STATUS.md).

| ID | Question | Default until decided | Status |
| --- | --- | --- | --- |
| OD-7 | Ship `startQuest` values that exist only because of `itemStartFixes.lua` (declared "automatically generated from wowhead data")? At the pin the provider has 452 entries, 202 of them for items present in raw data (`research/questiedb-schema.md` §7.3); with `noOverwrites` it only fills empty fields | **Shipped** under D-002/D-016, origin recorded per output (§8.2) and in `NOTICE.md`. Alternative: ship `startQuest` only where it does not come solely from `itemStartFixes`. The extractor counts those values (`counts.itemStartFixesOnly`) so either choice is a one-line change | pending |
| OD-8 | Archive the pinned upstream source with each release (for example the §4.1 inputs at the pin plus a `SHA256SUMS` file)? | **Not archived**; the pinned commit is public. Regeneration depends on upstream remaining available | pending |
| OD-9 | Contact the Questie team about licensing permission? | Owner's call; not required by D-016 | open |
| (resolved) | Publish despite the licence finding? | Yes, with notices (D-016) | decided |
| (resolved) | Quote the upstream authorship line and list the declared origins? | Yes: `NOTICE.md`, manifest `origins`, THIRD_PARTY_NOTICES.md (LIC-11) | decided |
| (resolved) | Ship `objectivesText` (Blizzard quest text; the only place objective counts appear)? | Yes (ARCHITECTURE §5.2-5.3); revision 1 of this file had it unshipped pending a decision | decided |

---

## 4. Upstream inputs

Checksums are SHA-256 of the **committed (LF) blob** at the pin, i.e.
`git show <sha>:<path> | sha256sum`. Do not hash Windows working files: with
`core.autocrlf=true` they are CRLF and hash differently (`research/questiedb-schema.md` §2).
These LF hashes equal the output hashes recorded upstream in `data/Forever/conversion.json`.

### 4.1 Consumed (Planned)

| Path at pin | Role | SHA-256 (LF blob) |
| --- | --- | --- |
| `data/Forever/foreverQuestDB.lua` | Raw quests | `41cddaaf32b174eb2b80e216a0f070d3dfd16f7a717b83877a3b39f3514b8748` |
| `data/Forever/foreverNpcDB.lua` | Raw NPCs | `a8c4169690726323dac3c6441f74f7a4d9cafcc08ec42231d72ff28c9471f0ee` |
| `data/Forever/foreverObjectDB.lua` | Raw objects | `af4536c12c5b1da5fd32cb33be5c9c01d2436f97a5b9f60e2cdd238273b2cc09` |
| `data/Forever/foreverItemDB.lua` | Raw items | `987d037b6df94d5b0b1dc326a1670581e3abb952736a4ae055fd9f161328b71c` |
| `src/corrections/Forever/legacy/classicQuestReputationFixes.lua` | Static quest corrections | `155b2502990304339833f65c5d5f46d6f1ad84527b9e476a976f4f9157a14322` |
| `src/corrections/Forever/legacy/classicQuestFixes.lua` | Static and faction/class dynamic quest corrections; `itemObjectiveFirst` hints (lines 17-18) | `76cd6a05f035826cabc6180a0ff2a1a37c5e7946c891eb0a06412fab5a4caf2e` |
| `src/corrections/Forever/legacy/classicNPCFixes.lua` | Static and faction NPC corrections | `1de19d17db00581a35d397c7440124aa3f14150d5456c771d2deb3cfba79f031` |
| `src/corrections/Forever/legacy/classicObjectFixes.lua` | Static and faction object corrections | `181bea5a5db73f8af1bebe1d8aa835d28e2d4c11adf9ff786c4f54edb3cdc76a` |
| `src/corrections/Forever/legacy/itemStartFixes.lua` | Static item `startQuest` corrections (declared Wowhead-generated, §3.1) | `c5f379867c82a401432e0ba2ef58c4e44ffe878a806f4901e070f9f090523bc6` |
| `src/corrections/Forever/legacy/classicItemFixes.lua` | Static and faction item corrections | `688286a44e5d95045ff943d55ba3a9fccffce7ca4a982fa55a67499b39509b87` |
| `src/corrections/Forever/foreverQuestFixes.lua` | Authored Forever quest corrections (empty at pin) | `6b6769a3cb8c55cb3e92e92b6b1342337f2fd738abb121b51918550c48148e3f` |
| `src/corrections/Forever/foreverNPCFixes.lua` | Authored Forever NPC corrections (empty) | `3e578f228b2327e4ef0703e0eb693fee102a6dd8d22b79339cfd518fa662992e` |
| `src/corrections/Forever/foreverObjectFixes.lua` | Authored Forever object corrections (empty) | `1464ae42df2c7199bfeb9a5119eb8b7dd997de7d77aac551273efe802ade8c3f` |
| `src/corrections/Forever/foreverItemFixes.lua` | Authored Forever item corrections (empty) | `87a384d376b848a67722fa4c14bc2db1cd71e97c6e4161f2fa1d9733d22c5f63` |
| `src/corrections/enum/*.lua` (11 files) | Constants used by corrections (Era `byExpansion.Classic` masks; `npcFlags` values) | per-file hashes in the manifest; e.g. `expansions.lua` `68a4405bc9551a3efae61f4f2e20e12d8b9c4fd6cf99d59980e3e00daf1f52ac`, `zones.lua` `a39418b66c8f1c93fa435cbef6e30ba5a79b4a1af459fdd7af3af7729b1a975b` |
| `src/corrections/compat.lua` | Names of the five `*ObjectiveFirst` hint sets (lines 21-31) | in manifest |
| `src/meta/questMeta.lua` | Schema check (field indices/types) | `2cf91fe3dc43ac06b06fadf31c9dc05c48c545005ef49d70d3d413a3437e2bb2` |
| `src/meta/npcMeta.lua` | Schema check | `01d9f0047f4d8396be6dfaa7a6e286bd07f158c3c111245097f26e479319234e` |
| `src/meta/objectMeta.lua` | Schema check | `d53c228d4749eb125bd9fd513997b82d4e494a282af5db86fcde1dbab4929a1a` |
| `src/meta/itemMeta.lua` | Schema check | `a11209ef102e9cc0d1d199de4e7d662a515964a36f3013aafce9b6a14bae509f` |
| `src/config.lua`, `src/corrections/manifest.lua` | Provider list, order and options (verified against the tool's built-in plan); TOC interface | in manifest |
| `support/Forever/QuestXP/xpDB-classic.lua` | Per-quest `{questLevel, baseXp}` (Era seed) | `9f5ca777904f6f62693cbe6f8b8ce91d0e0430e3ed5f7621df6e8691d4269149` |
| `support/Forever/Zones/areaIdToUiMapId.lua` | AreaID → UiMapID (base + override) | `cf9ae6f896e3e2fb1e43352b11596641312d9e61365ca7f281e5af1092185d07` |
| `support/Forever/Zones/uiMapIdToAreaId.lua` | UiMapID → AreaID, and **zone names** from trailing comments (§6.6, LIC-13) | `4964def0918a8cddef6c5f8292526a076b2afe73ea58f178f68a78e35bec39e3` |
| `support/Forever/Zones/dungeons.lua` | Instance entrances, alternative IDs, dungeon names; `dungeonQuest` derivation | `e2aa4eb8daf0096958da848727af5d57d7b184b5fa73a3d3643bcb818a045b44` |
| `support/Forever/Zones/zoneIds.lua` | Zone symbols (validation/debug only) | `55d56138c2a6aeab0d76dd43003c894aae09b899ab0e998649a94796153c9a80` |
| `data/Forever/conversion.json` | Build numbers, transform coefficients (for `era-coords` tagging only, §9.3) and upstream output hashes. Its per-map bounds feed `tools/maps import --placeholder`, not this dataset (D-018) | `f4477d6c575575152225f2a9d40858029bf9d2d5fdf6b083c06557fce8b5984b` |
| `support/Forever/provenance.json` | Provenance cross-check only (not data) | `5538df5af9f749a28d25c605d6f8df4e0245aa4071c90fea870b61518fa07ac5` |

#### 4.1.1 Provenance-only inputs (fork base)

Read to compute `upstreamDiff` (§9.3); they never reach a shipped value. Their hashes equal the
`source_sha256` entries of `conversion.json.files[]` at the pin, so the fork base is the current
Era data. Recorded in the manifest with `role: "provenance-only"`.

| Path at pin | SHA-256 (LF blob) |
| --- | --- |
| `data/Classic/classicQuestDB.lua` | `210e9ac3f98baf2c624be0c8677e7e9adec3f2b9e426f30fd649c4018678afab` |
| `data/Classic/classicNpcDB.lua` | `ee4a241db3ff89e5f0883b688b58920c1121f5617202ecba81d90b17271ccd54` |
| `data/Classic/classicObjectDB.lua` | `d08fbd8216757918330d9ff02bfc1b13f837f198e0aa62aa76260bb1bd9cd042` |
| `data/Classic/classicItemDB.lua` | `987d037b6df94d5b0b1dc326a1670581e3abb952736a4ae055fd9f161328b71c` (byte-identical to the Forever item file) |
| `src/corrections/Era/classic{Quest,QuestReputation,NPC,Object,Item}Fixes.lua` | equal to `conversion.json` `source_sha256` (e.g. `classicNPCFixes.lua` `38e5217bfd4f23ba…`, `classicQuestFixes.lua` `fd28ff9f01e1b613…`); full hashes in the manifest |

### 4.2 Not consumed

| Path | Reason |
| --- | --- |
| `src/corrections/Tbc`, `Wotlk`, `Cata`, `MoP`, `Sod`, `Titan`, `Shared` | Not applied to the Forever flavour upstream (`src/config.lua:173-183`; `docs/forever.md:34-36`). `src/corrections/Era/*` is read only as a fork base (§4.1.1) |
| `l10n/Forever/**` | English-only first release; files are byte copies of the Era localisation. It has no zone-name tables (zone names come from §6.6) |
| `support/Forever/DropTables/*` | Drop percentages not shipped (declared Wowhead/CMaNGOS-generated, §3.1); drop *sources* come from item fields |
| `support/Forever/FactionTemplates/*`, `subZoneToParentZone.lua`, `instanceIdToAreaId.lua` | Not needed by the first planner; add to §4.1 if used |
| `tools/lua-binary/*`, `generate.lua`, `generator/*`, `emulator/*` | Not executed by the pipeline or CI (§5); may be used by the optional manual parity check (§5, ARCHITECTURE §5.2) |
| Questie/Questie (blacklists, policy corrections, XP formula) | Consumer-owned, not QuestieDB data. Read only for semantics (§2). Any future use is a separate input with its own entry here |

---

## 5. Processing pipeline (Planned)

`tools/questiedb/` (TypeScript, Node ≥ 22.13, run with pnpm scripts; no Lua runtime; D-009):

| Step | Script | Does |
| --- | --- | --- |
| 1 | `fetch.ts` (`pnpm data:fetch`) | Read the pin from `tools/questiedb/upstream.json`; clone or fetch that commit from GitHub into `.cache/questiedb` with `-c core.autocrlf=false`; verify `HEAD` equals the pin; read inputs from git blobs; compute SHA-256 per input |
| 2 | `extract.ts` (`pnpm data:extract`) | Parse entity long strings and correction/support Lua with **luaparse** (MIT, pinned dev dependency, never shipped); evaluate correction providers with a whitelisted evaluator that fails closed on any construct it does not understand; apply the layers below; collect objective hints; project to the shipped fields (§6); tag provenance (§9.3); write `public/data/**` deterministically with `_generated` and `NOTICE.md` (§7), then `manifest.json` (§8); write the gitignored, non-shipped report (§8.4) |
| 3 | `validate.ts` (`pnpm data:validate`, in CI) | Required checks only (ARCHITECTURE §5.2): schema; referential integrity; coordinate ranges and sentinels; golden counts (composed counts equal upstream: 4,257 / 10,122 / 6,666 / 14,899 at `b6f5b07`); every output hash and the `dataRevision` recomputed; `_generated` first key and `NOTICE.md` present in every marked directory (§7); `toolTreeHash` equals the checkout (§8.1); zone-name rules (§6.6); no absolute paths or `.cache` references in outputs. Field-level parity with QuestieDB's own Lua generation is **not** a `validate` check; it is the optional manual check below |
| 4 | `diff.ts` (`pnpm data:diff`) | Pin-to-pin dataset diff first; the three-way classifier is a stub returning `unknown` (§9.4; F23, D-026) |

**Commits and CI (ARCHITECTURE §5.2).** Every change to `tools/questiedb/` lands in the same
commit as the regenerated `public/data/**` and fixture slice; `validate` enforces this through
`toolTreeHash` (§8.1). CI fetches the pinned QuestieDB commit named in
`tools/questiedb/upstream.json` from GitHub, runs `extract`, and fails unless every output is
byte-identical to the committed files (reproducibility contract, §8.3). CI then runs `validate`.

Layers applied in order, reproducing what the addon reads (evidence in
`research/questiedb-schema.md` §7):

1. Raw Forever rows.
2. Static corrections in upstream load order: `classicQuestReputationFixes` and `itemStartFixes`
   (generated; `noNewEntries` + `noOverwrites` for items) before `classicQuestFixes`,
   `classicNPCFixes`, `classicObjectFixes`, `classicItemFixes`, then `forever*Fixes.Load`, with
   QuestieDB merge semantics (whole-field replace, `{}` deletes, absent IDs created). The
   `QuestieCorrections.*ObjectiveFirst[id] = true` side effects are collected as hint sets, not
   merged into records (`src/corrections/compat.lua:21-31`).
3. Derived pass `requiredRaces:questieCompatibility` (Era masks 77/178). The waypoint
   simplification pass is applied only if waypoints are shipped.
4. Dynamic layers kept **separate** in `overlays.json` (§6.7): per-faction values from
   `LoadFactionFixes` / `forever*Fixes.LoadDynamic`, per-class values for the four
   class-dependent quests (8315, 8977, 8997, 9015), and faction-dependent entrances from
   `dungeons.lua`.

Not done, deliberately:

- no Era→Forever coordinate conversion (already applied upstream; applying it again would corrupt
  the data), and **no conversion to world yards**: spawns ship as published and `infra/data`
  converts them at load (D-017, which supersedes D-004 for dataset rows);
- no pad-to-0: QuestieDB's read contract pads absent numeric slots to 0
  (`src/meta/normalize.lua:182-199`); the extractor reads the Lua source and emits `null`
  instead (DSO-05);
- no Questie consumer policy (blacklists, event gating) and no inference of Forever-only content.

Acceptance evidence from Milestone 0: a prototype of layers 1-3 produced 35,944 composed
entities, equal to upstream's recorded Forever Golden count (`docs/forever-validation.md:37,40`
in QuestieDB), in about 0.3 s (D-009). Field-level parity with upstream Generation is not yet
proven.

**Optional manual parity check (ARCHITECTURE §5.2).** The pipeline needs no Lua runtime (D-009),
so field-level parity with QuestieDB's own Lua generation is an optional manual check, not a CI
gate and not part of `validate.ts`. The required checks are golden counts, output hashes, schema
and referential integrity (step 3). When someone runs the parity check, it compares our records
with a Baked artifact built by upstream: a local `generate.lua Forever` run with an
owner-approved Lua 5.1 interpreter, or the published `QuestieDB-Forever.zip` release asset after
checksum verification against `release.json` (`research/questiedb-schema.md` §10, options A and
E). Its result is a review note; it never changes `public/data/` or the manifest.
*Superseded (ARCHITECTURE §5.2):* an earlier draft of this revision said `validate.ts` must
provide field-level parity.

---

## 6. Fields we ship (Planned contract)

Aligned with ARCHITECTURE §5.2-5.4. Field numbers are QuestieDB schema indices
(`research/questiedb-schema.md` §3). Values are after the §5 layers. "nil → null" means an absent
upstream value is emitted as `null`, never 0 or an empty list, unless a row says otherwise.
*Superseded (F07, ARCHITECTURE §5.2):* revision 1 shipped "only entities reachable from quests";
§6.3 adds flag-selected NPCs.

Record shapes and field names follow the domain types in `src/domain/dataset.ts` and
`points.ts`, which are authoritative (ARCHITECTURE §5.3). **Open item:** some upstream fields
listed below as shipped have no field in the current domain records: NPC 6 `rank` (the kill-XP
model needs it, SIMULATION KXP), NPC 9 `zoneID`, object 5 `zoneID` and 6 `factionID`, and item 12
`class`. Likewise `ZoneInfo.name` is a non-null string, while §6.6 rule 4 gives three UiMaps
`name: null`. Before Milestone 2 either the domain types gain these fields or this contract drops
them; until then they stay listed here, and the size estimates (§6.8) include them.

### 6.1 Files

| File | Contents | Section |
| --- | --- | --- |
| `quests.json` | Every composed quest (4,257 at the pin), including `objectivesText` | §6.2 |
| `entities.json` | Quest-referenced NPCs and objects, plus every flight master, innkeeper and trainer by `npcFlags` | §6.3 |
| `items.json` | Items referenced by quests: name, drop sources, `startQuest` (origin noted) | §6.4 |
| `spawns.json` | Spawn points per shipped entity, as published | §6.5 |
| `zones.json` | AreaID→UiMapID, UiMap names with source, dungeon entrances, instance areas. No world bounds or other geometry: zone frames are map metadata in `public/maps/placeholder/geometry.placeholder.json` (ARCHITECTURE §5.2, §6; D-018) | §6.6 |
| `overlays.json` | Dynamic corrections by faction and class | §6.7 |
| `NOTICE.md`, `manifest.json` | Marking and provenance | §7, §8 |

### 6.2 `quests.json`

| Record field (ARCHITECTURE §5.3) | Upstream | Rule |
| --- | --- | --- |
| `id` | row key | |
| `name` | 1 name | Blizzard game content |
| `level` | 5 questLevel | nil → null (14 raw quests lack it; SIMULATION QXP-7). `-1` ("scaling") is kept as published |
| `minLevel` / `maxLevel` | 4 requiredLevel / 32 requiredMaxLevel | nil → null |
| `races` / `classes` | 6 requiredRaces (after the derived pass) / 7 requiredClasses | nil → null; `0` kept as published (no restriction). Tested only arithmetically; Skyborne races use bits 32-33 (D-012) |
| `zoneOrSort` | 17 | Positive = AreaID, negative = QuestSort; nil → null |
| `dungeonQuest` | derived | `true` when `zoneOrSort > 0` and it is a `dungeons.lua` key or alternative AreaID, excluding that file's non-dungeon entries: 2257 Deeprun Tram, 2917 Hall of Legends, 2918 Champions' Hall, and the battlegrounds 2597, 3277, 3358 (a self-authored exclusion list in the tool). The resulting AreaID set goes to the report and its size to `counts` |
| `starters` / `finishers` | 2 startedBy `{npcs, objects, items}` / 3 finishedBy `{npcs, objects}` | `EntityRef { kind, id }`, in kind order then upstream order |
| `objectives` | 10 objectives, 9 triggerEnd | §6.2.1 |
| `objectiveHints` | 29 extraObjectives | `{ objectiveIndex, text, points, refs }`, points as published (§6.5). Hints are not counted and never shift objective indices (DSO-06) |
| `objectivesText` | 8 | `string[]` or null; Blizzard quest text; counts are not parsed at extraction (ARCHITECTURE §5.3) |
| `prerequisites` | 12 preQuestGroup, 13 preQuestSingle, 14 childQuests, 15 inGroupWith, 16 exclusiveTo, 22 nextQuestInChain, 25 parentQuest, 27 breadcrumbForQuestId, 28 breadcrumbs, 33 availableUntilCompleted, 34 availableStartingWith, 36 disabledByQuest | IDs kept as published, including signs. Shape is `QuestPrerequisites` (`src/domain/dataset.ts`): list fields nil → `[]`, single-ID fields nil → null |
| `requirements` | 18 requiredSkill → `skill`, 19 requiredMinRep → `minReputation`, 20 requiredMaxRep → `maxReputation`, 30 requiredSpell → `spell`, 31 requiredSpecialization → `specialization`, 11 sourceItemId → `sourceItemId`, 21 requiredSourceItems → `requiredSourceItems` | Shape is `QuestRequirements` (ARCHITECTURE §5.3: quest source items live in `requirements`). `{0,0}` pairs and nil → null; `requiredSourceItems` nil → `[]`. 35 requiredRanks has no field in `QuestRequirements` and is not shipped (one correction write at the pin; MoP-only, SIMULATION VAL-19); shipping it needs a domain-type change first |
| `reputationReward` | 26 | `{ factionId, value }[]` |
| `flags` | 23 questFlags, 24 specialFlags | `repeatable` = specialFlags bit value 1, `needsEvent` = bit value 2 (`foreverQuestDB.lua:41`); arithmetic tests. The raw `questFlags` and `specialFlags` values are kept as well (nil → 0 here, since the record type holds numbers and 0 means no flag) |
| `xp` | QuestXP `{questLevel, baseXp}` | `basis: 'era-seed'`; null when the quest has no QuestXP row (750 quests, SIMULATION QXP-7). The extractor never writes the `user` or `forever-observed` bases |
| `provenance` | §9.3 | `foreverStatus: 'unknown'`, `source: 'questiedb'` |

#### 6.2.1 Objective order and shape (DSO-06)

`objectives` is a discriminated union (ARCHITECTURE §5.3) in Questie's `ObjectiveData` order
(Questie `Database/QuestieDB.lua:1735-1864` at `40016145`):

| Order | Upstream | Emitted as |
| ---: | --- | --- |
| 1 | `objectives[1]` creature `{npcId, text?, iconType}` | `{ kind: 'kill', npcId, label, count: null }` |
| 2 | `objectives[2]` object | `{ kind: 'object', objectId, label, count: null }` |
| 3 | `objectives[3]` item | `{ kind: 'item', itemId, label, count: null }` |
| 4 | `objectives[4]` reputation (a single `{factionId, value}` pair) | `{ kind: 'reputation', factionId, value }` |
| 5 | `objectives[5]` killCredit `{{npcId, ...}, baseNpcId, baseText?, iconType}` (only a non-empty table) | `{ kind: 'killCredit', npcIds, rootNpcId, label, count: null }` |
| 6 | `objectives[6]` spell `{spellId, text?, itemId}` | `{ kind: 'spell', spellId, itemId, label }` (`itemId` nil → null) |
| 7 | field 9 triggerEnd `{text, {[areaId] = {{x, y}, ...}}}` | `{ kind: 'event', text, points }`; points as published (§6.5), turned into `PublishedPoint`s at load by the §6.5 rules: a zone-space `SourcedPoint` (frame `forever`), an `InstancePresence` or an `UnmappedAreaPoint` |

- **Hints.** Five hint sets: `killCreditObjectiveFirst`, `objectObjectiveFirst`,
  `itemObjectiveFirst`, `eventObjectiveFirst`, `spellObjectiveFirst`. Questie inserts each
  element of a hinted kind at position 1 as it processes it (`tinsert(ObjectiveData, 1, x)`), so
  several hinted elements of one kind end up at the front in reverse order. The extractor
  reproduces exactly that. At the pin only `itemObjectiveFirst = {503, 5088}` is set
  (`classicQuestFixes.lua:17-18`). The hint sets are recorded in the manifest `layers`.
- The objective **index** is the position in this list. RXP `.complete q,i` maps to index
  `i - 1` (ARCHITECTURE §5.4). Measured on raw Forever quests (critique DSO-06): 172 quests mix
  objective kinds and 14 combine objectives with `triggerEnd`.
- `label` is the upstream text slot (nil → null). `count` is always `null`: QuestieDB stores no
  counts. `iconType` is not shipped.
- Questie iterates these lists with `pairs`. The extractor iterates them as sequences `1..n` and
  fails closed on a sparse or non-integer-keyed list, whose `pairs` order would be unspecified.

### 6.3 `entities.json`

**NPCs.** The shipped set is the union of:

- *quest-referenced* NPCs: starters and finishers of any quest (`startedBy`/`finishedBy`, and
  NPC `questStarts`/`questEnds`), creature and killCredit objective targets (`npcIds` and
  `rootNpcId`), `npcDrops` of shipped items, and `"monster"` refs of `extraObjectives`;
- *flag-selected* NPCs (F07): the composed `npcFlags` value has FLIGHT_MASTER (8), TRAINER (16)
  or INNKEEPER (128) set (`src/corrections/enum/expansions.lua:24-41`), tested arithmetically
  (`Math.floor(flags / v) % 2 === 1`, as D-012 requires for masks). Measured on raw data at the
  pin (`research/questiedb-schema.md` §12.1): FLIGHT_MASTER 61 NPCs (51 not quest-referenced),
  TRAINER 499 (297), INNKEEPER 56 (34). That adds **382 NPCs**, so the NPC set grows from 5,809 to
  6,191. The critique's subName count (F07: 63 flight-master titles, 53 not quest-referenced; 45
  "Innkeeper" titles, 31 not quest-referenced) is kept as corroborating evidence; `npcFlags` is
  the selecting field.
  Static corrections write `npcFlags` on 31 NPCs, so the composed counts, which go to `counts`,
  may differ slightly.
- Taxi nodes are identified by `TaxiNodeRef { npcId, taxiNodeId, name }` (ARCHITECTURE §8.1,
  §9.1). A dataset flight master supplies `npcId`. New Forever flight nodes have no dataset NPC
  (QuestieDB has no Forever-only NPCs, §9.1), so they are referred to by a cited TaxiNodes id
  (D-022) or a name, never by an invented NPC record.

| Shipped fields | Not shipped |
| --- | --- |
| 1 name, 4 minLevel, 5 maxLevel, 6 rank, 9 zoneID, 10 questStarts, 11 questEnds, 13 friendlyToFaction (`friendlyTo`), 14 subName (nil → null; `NpcRecord.subName`, trainer and flight-master titles), 15 npcFlags; `provenance`. Spawns (7) go to `spawns.json` | 2-3 (deprecated), 12 factionID, 8 waypoints (optional, about 0.5 MB raw JSON; into `spawns.json` if shipped) |

*Changed:* this file's earlier text left 14 subName unshipped pending a size measurement. The
domain type `NpcRecord` (`src/domain/dataset.ts`) carries `subName`, and the §6.8 NPC estimate
already includes it (`research/questiedb-schema.md` §12.3), so it ships.

**Objects.** Quest-referenced only: `startedBy`/`finishedBy` objects, object `questStarts`/
`questEnds`, object objectives, `objectDrops` of shipped items, and `"object"` refs of
`extraObjectives`. Fields: 1 name, 2 questStarts, 3 questEnds, 5 zoneID, 6 factionID;
`provenance`. Spawns (4) go to `spawns.json`. Not shipped: 7 waypoints (none in Forever).

### 6.4 `items.json`

Selection, iterated to a fixed point: item objectives, spell-objective `itemId`s, `sourceItemId`,
`requiredSourceItems`, items in any quest's `startedBy`, and `itemDrops` containers of items
already selected. Fields: 1 name, 2 npcDrops (`dropNpcs`), 3 objectDrops (`dropObjects`), 4
itemDrops (`dropItems`), 5 startQuest (`startsQuest`), 12 class (open item, §6); `provenance`.
Drop percentages are not shipped (§3.2). `startQuest` values that exist only because of
`itemStartFixes` are counted (`counts.itemStartFixesOnly`) and listed in the report, for OD-7.

### 6.5 `spawns.json` (D-017)

```json
{ "_generated": { "...": "§7" },
  "npc":    { "3143": { "14": [[42.06, 68.33]] } },
  "object": { } }
```

NPC 3143 Gornek, AreaID 14 Durotar (`data/Forever/foreverNpcDB.lua:2604`; the worked example in
[research/coordinates.md](research/coordinates.md)). Objects use the same shape.

- Coordinates are **as published**: 0-100 zone percent, up to 2 decimals, keyed by AreaTable ID.
  They are never rounded, re-projected or converted to yards by the extractor.
- `infra/data` turns every published point into a `PublishedPoint` (`src/domain/dataset.ts`,
  `points.ts`) once at load, and converts it to a `WorldPoint` where the committed placeholder
  geometry allows, through `src/geo` (ARCHITECTURE §5.2, §6). The same rules apply to spawns,
  `triggerEnd` event points and `objectiveHints` points:
  - an AreaId that maps (`zones.json`) to a native Forever UiMap gives a zone-space
    `SourcedPoint` (frame `forever`, lexemes null); its world point is null while the geometry
    lacks that frame;
  - `[-1, -1]` is instance **presence** (the entity is inside that instance area), never a point.
    It becomes `InstancePresence { kind: 'instance', areaId }` and resolves to the dungeon
    entrance from `zones.json` (§6.6) when one exists; otherwise it stays unresolved;
  - a point whose AreaId maps to no UiMap becomes
    `UnmappedAreaPoint { kind: 'unmapped', areaId, x, y, reason }`, with `reason` one of
    `suppressed` (the AreaId maps to UiMap 0: 2257, 2917 and 2918 at the pin), `instance-area`
    (an instance-type AreaId, a `dungeons.lua` key or alternative ID, whose only link is a legacy
    compatibility pair, which is not a native Forever map; Forever has no dungeon UiMaps, MAPS
    §3) or `no-uimap` (an AreaId absent from the table; none of the 78 spawn keys at the pin,
    `research/questiedb-schema.md` §4.1).

  Nothing is guessed: an unmapped or unresolved point is kept with its reason, and travel to it
  is unknown, never zero (ARCHITECTURE §6).
- *Superseded (D-017):* D-004's "dataset spawns are stored as WorldPoint" no longer applies to
  dataset rows.
- Faction-dependent spawn corrections (NPC and object `LoadFactionFixes`: 9 each at the pin) go to
  `overlays.json`. Waypoints, if shipped, use the same form.
- Size (critique PERF-2, scratch measurement over 72,734 drawable points of 5,809 NPCs and 862
  objects, gzip -9): upstream percent keyed by AreaID 1,100 KB JSON / 353 KB gzip; world yards at
  full precision 2,986 KB / 1,205 KB; world yards at 0.01 yd 1,527 KB / 535 KB.

### 6.6 `zones.json`

- **AreaID → UiMapID** from `areaIdToUiMapId.lua`, override applied; `0` means suppressed and is
  kept. Includes the synthetic continent aliases (10073 → 1414 Kalimdor, 10074 → 1415 Eastern
  Kingdoms, 10089 → 947 Azeroth) and the 40 legacy dungeon compatibility pairs, which are flagged
  as not native Forever maps (`docs/forever-data.md:194-201`).
- **UiMap names (LIC-13).** Source: the trailing comment of each row in `uiMapIdToAreaId.lua`
  (the main table has 54 canonical rows; the override adds the three continents). Rules:
  1. Parse the file with luaparse. Each deferred string `[[return {...}]]` is parsed again as a
     Lua chunk with `{ comments: true, locations: true }`.
  2. A name is the `--` comment on the same line as a `[uiMapId] = areaId` field, trimmed.
     Comments on their own lines are never names.
  3. The 40 legacy compatibility rows in the override block carry no name. Their comment must be
     exactly "Referenced dungeon area" (27 rows at the pin) or "Referenced synthetic dungeon
     alias" (13 rows); any other comment there fails `validate`, so upstream edits are noticed.
  4. Each UiMap row in the main or continent block gets exactly one non-empty name. UiMaps the
     file does not list (1463, 1464 and 2665 at the pin) get `name: null`.
  5. The English zone keys that RXP guides use are checked against a self-authored expected list
     in `tools/questiedb` (50/50 matched at `b6f5b07`; see RXP.md). Localised names are not
     shipped.
  6. Each name records `nameSource: "questiedb:support/Forever/Zones/uiMapIdToAreaId.lua:<line>"`.

  Caveat: the file says it was completed by hand and that regenerating it upstream overwrites the
  additions, so names can disappear at a pin bump; rule 4 makes `validate` fail loudly then.
- **Dungeons** from `dungeons.lua` (`[areaId] = {name, alternativeAreaIds?, parentZone,
  entrances}`). The file calls `UnitFactionGroup` (line 5), so the evaluator runs it once as
  Alliance and once as Horde. Entries equal under both go to `zones.json`. Entries that differ (the
  battleground entrances 2597, 3277, 3358 at the pin) go to `overlays.json` by faction. Dungeon
  names are Blizzard game content.
- **Instance areas:** the AreaIDs used as `[-1, -1]` presence keys (29 dungeon, raid and
  alternative areas; 2,843 sentinel rows at the pin: 2,125 NPC and 718 object;
  `research/questiedb-schema.md` §4). At load, instance presence resolves to the entrance of the
  matching `dungeons.lua` entry (by key or alternative AreaID) when one exists, and otherwise
  stays unresolved (§6.5; ARCHITECTURE §5.2). The same entrances seed the TravelGraph's instance
  entrance edges (ARCHITECTURE §9.1).
- **No geometry.** `zones.json` carries no world bounds, continent or world-map IDs, or
  transform coefficients. Geometry is map metadata: the 49 QuestieDB zone frames, the 12 cited
  DB2 rows and the `eraToForever` block live in `public/maps/placeholder/geometry.placeholder.json`,
  produced by `tools/maps import --placeholder` with a source and build per row (ARCHITECTURE
  §5.2, §6; D-018, D-026). *Superseded (D-018):* revision 1 put per-UiMap world bounds and
  continent `map_id` from `conversion.json` here; quest data and map geometry now stay separate
  (ARCHITECTURE §2, §6).
- Parent-zone routing (`subZoneToParentZone.lua`) is not shipped until needed.

### 6.7 `overlays.json`

```json
{ "_generated": { "...": "§7" },
  "faction": { "Alliance": { "quests": {}, "npcs": {}, "objects": {}, "items": {}, "dungeons": {} },
               "Horde":    { "...": "same shape" } },
  "class":   { "<CLASS>": { "quests": { "8315": { "<field>": "<value>" } } } } }
```

Values are whole-field replacements with upstream merge semantics. `DatasetView` applies them on
top of the static records from the project character (ARCHITECTURE §5.1); nothing is baked into one
persona. Sources at the pin: `LoadFactionFixes` (quests 83 per faction, NPCs 9, objects 9, items
5; `research/questiedb-schema.md` §7.3), the class-dependent values of quests 8315, 8977, 8997 and
9015, and the faction-dependent `dungeons.lua` entrances. `forever*Fixes.LoadDynamic` is empty.

### 6.8 Size

Estimates from raw data (`research/questiedb-schema.md` §12.1 and §12.3; re-measured by the
extractor and gated by ARCHITECTURE §14: each file within its recorded baseline + 10%, total
≤ 1.2 MB gzip):

| Part | JSON | gzip -9 |
| --- | ---: | ---: |
| Planner bundle without `objectivesText` (quests, quest-referenced NPCs, objects and items, QuestXP) | about 3,588 KB | 789 KB (582 KB brotli) |
| `objectivesText` (quests 124 → 226 KB gzip) | | + 102 KB |
| Flag-selected NPCs (§6.3): **+382 NPCs, 5,809 → 6,191**; NPC fields 1,750 → 1,824 KB JSON, 458 → 472 KB gzip | + 74 KB | + 14 KB |
| **Total** (789 − 124 + 226 + 14) | | **about 905 KB** |

The total adds separately compressed parts; it was not measured as one payload. `zones.json`,
`overlays.json`, `NOTICE.md` and the manifest come on top. The NPC figures were measured with
waypoints and `factionID`, which do not ship (§6.3), so they are on the high side; corrections add
47 records. Spawns alone are about 353 KB gzip (§6.5). ARCHITECTURE §5.2 estimates under 1 MB gzip
in total. *Superseded:* this section previously said the flag-selected NPCs were not yet measured.

---

## 7. Marking of generated artifacts (Planned)

**Scope** (LIC-11): every Questie-derived artifact in the repository, which is
`public/data/**`, `public/maps/placeholder/**` and `tests/fixtures/data/**` (the Forever slice
the extractor generates for tests; ARCHITECTURE §15).

1. No file in a marked directory is edited by hand. CI recomputes every output hash and fails on
   a difference from the record that describes the directory: `public/data/manifest.json` (§8);
   `tests/fixtures/data/manifest.json`, written by the extractor in the same format with its own
   `dataRevision`; and, for the placeholder geometry, the per-row sources and hashes that
   `tools/maps/validate.ts` checks ([MAPS.md](MAPS.md)).
2. Each marked directory has a `NOTICE.md`. `public/data/NOTICE.md` states:
   - generated from Questie/QuestieDB at commit `<40-char sha>` by `tools/questiedb`;
     "do not edit; regenerate with `pnpm data:extract`";
   - the licence finding, neutrally (§3.1), and the owner's posture and carve-out (§3.2);
   - the upstream authorship line (§2) and the declared origins (§8.2);
   - non-affiliation with Blizzard Entertainment and the Questie project;
   - pointers to `manifest.json` and `docs/DATA_PROVENANCE.md`.

   It contains no `dataRevision`, tool hash or timestamp, so it can itself be hashed into the
   `dataRevision` (§8.3). `public/maps/placeholder/NOTICE.md` says the same for its 49
   QuestieDB-derived frames and cites the 12 DB2 rows (THIRD_PARTY_NOTICES.md, "Map geometry").
   `tests/fixtures/data/NOTICE.md` repeats the `public/data` notice and names the pin the slice
   was cut from.
3. **`_generated`.** Every generated JSON file is a top-level **object** whose first key is
   `"_generated"`. A payload that is naturally an array is written as
   `{ "_generated": { ... }, "rows": [ ... ] }`, and loaders read `rows`; no marked file has an
   array at the top level. For `public/data`:

   ```json
   "_generated": { "by": "tools/questiedb",
                   "upstream": "Questie/QuestieDB@b6f5b07b0acf1c820993cbb0ce2521c912bb4c92",
                   "notice": "NOTICE.md", "manifest": "manifest.json",
                   "edit": "do not edit; regenerate with pnpm data:extract" }
   ```

   It holds only values fixed by the upstream pin, never a timestamp, tool hash or
   `dataRevision`, so identical inputs give identical bytes and a tool refactor that does not
   change the data does not change the `dataRevision`. Loaders ignore the key. The placeholder
   geometry uses `"by": "tools/maps import --placeholder"`, and its `upstream` names both the
   QuestieDB commit and the DB2 CSV build and hash. *Superseded (LIC-10):* revision 1's field
   `"licence": "GPL-3.0 (treated; ...)"`; licence statements live in `NOTICE.md`.
4. `.gitattributes` already marks `public/data/**` and `public/maps/placeholder/*.json` as
   `linguist-generated=true -diff`. `tests/fixtures/data/**` is added as `linguist-generated=true`
   in Milestone 2 (without `-diff`, so fixture changes stay reviewable).
5. THIRD_PARTY_NOTICES.md lists these directories and points here.
6. Committing `public/data/` follows D-002; raw upstream Lua is never committed.

---

## 8. Manifest (Planned): `public/data/manifest.json`

The **single authoritative manifest** (LIC-09, D-026). ARCHITECTURE §5.2 references it and does
not restate it. It is written last, after every other output, and is not listed in its own
`outputs`. Where the manifest and the extraction report (§8.4) disagree, the manifest wins.

### 8.1 Fields

| Field | Type | Meaning |
| --- | --- | --- |
| `_generated` | object | As §7, item 3 (first key) |
| `schemaVersion` | integer | Version of this manifest format (1) |
| `dataRevision` | string | Content-addressed identifier of the dataset (§8.3). Saved in projects as `ProjectV1.dataRevision`; a change triggers the drift check (ARCHITECTURE §5.5, §8.2) |
| `dataset` | string | `"questiedb-forever"` |
| `flavour` | string | `"Forever"` (upstream flavour name) |
| `upstream` | object | `{ "repository": "https://github.com/Questie/QuestieDB", "branchObserved": "master", "commit": "<40 hex>", "commitDate": "<ISO 8601 from git>" }` |
| `licence` | object | `{ "upstreamLicenceFile": null, "finding": "no licence file on the default branch in full history (docs/DATA_PROVENANCE.md §3.1)", "projectLicence": "GPL-3.0-or-later", "scope": "<the §3.2 carve-out, verbatim>", "notice": "NOTICE.md" }`. Not a legal conclusion |
| `sourceGameBuilds` | object | `{ "dbcTarget": "1.60.1.69893", "conversionSource": "1.15.9.69722", "uiSourceResearched": "1.60.1.69913", "tocInterface": 16001 }`, read from upstream files, not typed by hand (`dbcTarget`/`conversionSource` from `conversion.json.geometry`, `tocInterface` from `src/config.lua:61`); `uiSourceResearched` from `docs/forever.md:140-142`. The local client build is never recorded here: the extractor does not read a client (§10) |
| `toolTreeHash` | object | `{ "tree": "<git tree id of tools/questiedb/>", "lockfile": "<SHA-256 of the LF pnpm-lock.yaml>" }`. `tree` is the tree id git records for the directory: with a temporary index, `git add -A -- tools/questiedb && git write-tree --prefix=tools/questiedb/`. It equals `git rev-parse <commit>:tools/questiedb` for the commit that contains the regenerated dataset, and it is the same on every OS because text files are LF-normalised (`.gitattributes`). `validate` fails when it differs from the checkout, so a tool change and its regenerated dataset land in the same commit. `tools/questiedb` makes no value imports from outside itself except npm packages covered by the lockfile; any exception is added to this hash |
| `runtime` | object | `{ "nodeMajor": 22, "luaparse": "0.3.1" }` (versions from the lockfile; the full Node version goes to the report) |
| `inputs` | array | `{ "path", "sha256" (LF blob), "gitBlob", "bytes", "role" }` for every file in §4.1 and §4.1.1 (`role` `"data"`, `"correction"`, `"support"`, `"schema"` or `"provenance-only"`) |
| `upstreamManifestCheck` | object | Our input hashes compared with `conversion.json.files[].output_sha256` (all ten must match at the current pin) and fork-base hashes with `source_sha256` |
| `layers` | array | Applied providers, passes and hint sets in order, e.g. `"legacy/classicQuestReputationFixes.lua:Load"`, `"legacy/itemStartFixes.lua:LoadAutomaticQuestStarts(noNewEntries,noOverwrites)"`, `"derived:requiredRaces:questieCompatibility"`, `"hints:itemObjectiveFirst=[503,5088]"` |
| `dynamicLayers` | array | `[{ "key": "faction:Alliance", "file": "overlays.json" }, { "key": "faction:Horde", ... }, { "key": "class", ... }]` |
| `outputs` | array | `{ "path", "sha256", "bytes", "records", "origins" }` for every file under `public/data/` except `manifest.json`: the six JSON files and `NOTICE.md`. `path` is relative to `public/data/` with `/` separators; `origins` as §8.2 |
| `counts` | object | Raw, composed and shipped counts per type; NPCs selected by quest reference and by each flag (flight master, innkeeper, trainer); created by correction per type; quests with null `level` and null `xp`; `dungeonQuest` count; `itemStartFixesOnly`; named and unnamed UiMaps |
| `provenance` | object | `upstreamDiff` counts per type and tag, `corrected` and `created` counts (§9.3), the fork base used (§4.1.1), and `threeWayClassifier: "stub"` (§9.4) |
| `foreverContentVerified` | boolean | `false`. Top level, as ARCHITECTURE §5.2 states. Stays false until records are validated against the Forever game by some other means |

Example values at the current pin: raw 4,244 / 10,119 / 6,645 / 14,889; composed 4,257 / 10,122 /
6,666 / 14,899 (quests / NPCs / objects / items).

*Superseded (LIC-09, D-026):* revision 1's flat `repository`, `commitSha`, `commitDate` and
`licenseFile` fields are grouped under `upstream` and `licence`; `licenceTreatment` became
`licence`; `toolVersion` and `toolCommit` are replaced by `toolTreeHash` (a commit cannot name the
commit that contains it, so `toolCommit` was always the parent or "dirty"); `extractedAt` moved to
the report (§8.4); `foreverContentVerified` moved from `provenance` to the top level. D-026
supersedes D-002's list of manifest contents (which named an extraction timestamp and a tool
version), and D-016 supersedes its "GPL notices" wording; D-002's decision to commit the dataset
stands.

### 8.2 Origins (LIC-11)

Each output lists the declared origin of its content, so `NOTICE.md` and the About dialog can
render them. Vocabulary: `questiedb` (Questie/QuestieDB contributors' data: IDs, relations, levels,
flags, corrections), `blizzard-game-content` (text and names from the game, via QuestieDB),
`blizzard-client-derived` (values derived from client DBC/DB2 exports, via QuestieDB), and
`declared:<source>` (a third-party origin that upstream declares).

| Output | Fields | Origin | Evidence |
| --- | --- | --- | --- |
| `quests.json` | structure, levels, flags, relations, requirements | `questiedb` | §4.1 |
| `quests.json` | `name`, `objectivesText`, objective and event text | `blizzard-game-content` | §3.1 item 5 |
| `quests.json` | `xp` | `questiedb` (Era seed; value origin not declared) | `xpDB-classic.lua:1`; `docs/forever-data.md:70` |
| `quests.json` | `objectiveHints[].text` | `questiedb` | `extraObjectives` are authored in the corrections |
| `entities.json` | `name` | `blizzard-game-content` | |
| `entities.json` | other fields | `questiedb` | |
| `items.json` | `name` | `blizzard-game-content` | |
| `items.json` | `startQuest` where set by `itemStartFixes` | `declared:wowhead-generated` via `questiedb:itemStartFixes` | `itemStartFixes.lua:13` |
| `items.json` | drop sources, `startQuest` otherwise, `class` | `questiedb` (no third-party origin declared; the declared Wowhead/CMaNGOS drop percentages are not shipped) | `classicItemDrops.lua:7,17806` |
| `spawns.json` | Forever-frame coordinates | `questiedb`, Era→Forever projection `blizzard-client-derived` (1.15.9.69722 → 1.60.1.69893) | `conversion.json` |
| `zones.json` | AreaID→UiMapID links | `blizzard-client-derived` (1.60.1.69893, hand-completed upstream) | `areaIdToUiMapId.lua:1-4` |
| `zones.json` | UiMap and dungeon names | `blizzard-game-content` (from comments of a hand-completed file; `dungeons.lua`) | §6.6 |
| `zones.json`, `overlays.json` | entrances, dynamic values | `questiedb` | |

Each entry is `{ "fields": [...], "origin": "...", "evidence": "<upstream path:line>" }`.

### 8.3 `dataRevision` and reproducibility

```
lines        = for each output sorted by path (UTF-8 byte order): path + "\t" + sha256 + "\n"
dataRevision = lowercase hex SHA-256 of the UTF-8 concatenation of lines
```

- `sha256` is of the file bytes as written (UTF-8, LF, no BOM). `validate` rejects paths
  containing tabs or newlines.
- The `dataRevision` depends only on what the tool emits, so it changes exactly when shipped
  content changes. A tool change with identical output changes `toolTreeHash`, which is a
  manifest-only change, and projects see no drift.
- **Reproducibility contract:** the same pin, `toolTreeHash` and Node major version produce
  byte-identical `public/data/**`, including `manifest.json`, on any OS. The serialiser is
  deterministic: `_generated` first, fixed key order per record, numeric-ID maps in ascending
  numeric order, lists in upstream order unless §6 says otherwise, LF, final newline. CI checks
  this by fetching the pinned commit from `tools/questiedb/upstream.json`, re-extracting and
  comparing bytes (§5). Because `validate` requires `toolTreeHash` to equal the checkout, every
  `tools/questiedb` change lands in the same commit as its regenerated dataset.

### 8.4 Extraction report (not shipped, gitignored): `generated/questiedb-report.json`

A superset of the manifest for review, keyed by the same `dataRevision`: `extractedAt` (ISO 8601
UTC), the full Node version and platform, timings, lint findings, coverage (objective kinds,
quests without starters, unresolved references), per-provider write counts, the `dungeonQuest`
AreaID set, the `itemStartFixesOnly` item list, zone-name validation results, provenance detail,
and warnings. It lives outside `public/` and never reaches `dist/`. It is **gitignored** (the
`generated/questiedb-report.json` entry in `.gitignore`; ARCHITECTURE §4, §5.2; D-026), so it is
never committed and a fresh extraction never dirties the tree. It is a review aid only: the
manifest (§8.1) is authoritative, and neither the app nor any `validate` check reads the report.
It is the only extraction output allowed to differ between runs of identical inputs, and it is
never an input to any hash.

---

## 9. Era vs Forever provenance classification

### 9.1 Result at the pin (from the Milestone 0 experiment)

| Type | Forever rows | Only in Forever | Only in Era | Identical to Era | Coordinates only | Other changes |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Quest | 4,244 | 0 | 0 | 4,241 | 3 | 0 |
| NPC | 10,119 | 0 | 0 | 9,395 | 724 | 0 |
| Object | 6,645 | 0 | 0 | 6,039 | 606 | 0 |
| Item | 14,889 | 0 | 0 | 14,889 | 0 | 0 |

All 12,619 changed coordinate pairs are exactly the documented DBC projection of the Era value
for Mulgore (215), Eastern Plaguelands (139), Redridge Mountains (44) and Stormwind City (1519).
The Forever correction providers equal Era's after masking numeric literals. The authored Forever
correction files are empty. QuestXP and localisation are byte copies of Era.

### 9.2 Reliability

- **Reliable** as a description of QuestieDB's data: deterministic, fully explained by the
  coordinate transform, and consistent with upstream's own statement that Forever is "a converted
  Era baseline, not complete Forever content" (`data/Forever/conversion.json:1782`).
- **Not reliable** as a description of the Forever game:
  1. Coordinate conversion is a frame change that assumes unchanged world positions; it cannot
     detect moved NPCs or objects.
  2. Missing Forever content is invisible: new zones (Zephras Isle, Riverglades, Darkspear
     Islands, Shen'dralas, Mount Hyjal) and Skyborne race content exist in map/DBC metadata but
     have no entities upstream.
  3. Presence is not availability: every Era row is present, including content that may not
     exist in Forever; QuestieDB keeps unobtainable quests by design.
  4. Forever no longer tracks Era upstream, so future two-way diffs will mix Era-side and
     Forever-side edits.

### 9.3 Provenance vocabulary (F15)

One vocabulary for quests, NPCs, objects and items, identical to ARCHITECTURE §5.3
`RecordProvenance` (`src/domain/dataset.ts`) and recorded by D-026:

| Field | Values | Meaning | Set by |
| --- | --- | --- | --- |
| `upstreamDiff` | `era` | Raw row identical to the fork-base (Era) row | extractor (fact about QuestieDB) |
| | `era-coords` | Differs from the fork base only by the documented coordinate projection (re-projecting the Era value with `conversion.json` coefficients and 2 dp half-away rounding gives exactly the Forever value) | extractor |
| | `forever-new` | ID absent from the fork base (none at this pin) | extractor |
| | `forever-changed` | Any other difference from the fork base (none at this pin) | extractor |
| `foreverStatus` | `unknown` | Nobody has verified this record against the Forever game. **Every dataset record ships with this value** | extractor |
| | `user-declared-new`, `user-declared-changed` | A claim the user makes in a project (ARCHITECTURE §5.5, §12.4) | the app, never the extractor |
| `corrected` | boolean | A static correction changed at least one shipped field | extractor |
| `created` | boolean | The record was created by a correction (47 at this pin: 13 quests, 3 NPCs, 21 objects, 10 items) | extractor |
| `source` | `questiedb`, `custom` | Dataset record or user custom quest | extractor / app |

`upstreamDiff` compares raw rows with the fork base (§4.1.1). A `created` record has no raw row,
so it takes its tag from comparing its creating correction with the fork-base provider's: `era`
or `era-coords` by the same rules (true for every provider at the pin, §9.1), otherwise
`forever-changed`.

*Superseded by D-026:* D-007's `forever: 'unknown'` with `basis: 'era-baseline-copy'`,
ARCHITECTURE revision 1's `forever: 'inherited' | 'new-in-forever' | 'modified-in-forever' |
'unknown'`, and this file's revision 1 tags `+corrected` / `+created` are all replaced by the
table above (critique F15, ARCHITECTURE §5.3, `RecordProvenance` in `src/domain/dataset.ts`).
D-007's principle stands: no dataset record claims a Forever verification nobody has done.

### 9.4 `diff.ts` scope (F23)

1. **First: the pin-to-pin dataset diff** that §12 needs. `pnpm data:diff --from <pin> --to <pin>`
   reports added and removed IDs per type, per-field changes, `upstreamDiff` and `corrected`
   changes, and count deltas. Its summary goes into the pin-bump commit message.
2. **`upstreamDiff` tagging** is a two-way comparison with the fork base, run during extraction
   (the Milestone 0 experiment already reproduces §9.1).
3. **Three-way classifier** (fork base, current Era, current Forever; it attributes a change to
   the Era side or the Forever side): a **stub** that returns `unknown` for every record, recorded
   as `provenance.threeWayClassifier: "stub"`. No record field depends on it. Implement it when
   §9.1 first shows a non-zero `forever-new` or `forever-changed` count. *Superseded by D-026:*
   D-007 said `diff.ts` implements the three-way classification; critique F23 deferred it, and
   D-026 records the pin-to-pin diff first and the classifier as a stub.

---

## 10. Game builds referenced

| Build | Role | Source |
| --- | --- | --- |
| 1.15.9.69722 | Era DBC frame the coordinates were converted from | `conversion.json` `geometry.source_build` |
| 1.60.1.69893 | Forever DBC target: map bounds, area/UiMap links, faction templates. The data frame is pinned here (D-013), and it is the recorded build of the 49 QuestieDB frames in the placeholder geometry (D-026) | `conversion.json` `geometry.target_build`; `support/Forever/provenance.json` |
| 1.60.1.69913 | Forever UI source researched upstream; explicitly not the DBC build | `docs/forever.md:140-142` |
| 1.60.1.70009 | **Local beta client observed 2026-09-25** (`<wow-install>/.build.info`, product `wow_classic_beta`). The brief's 1.60.1.69977 is superseded (D-013; critique LIC-15). Also the recorded build of the 12 DB2-only UiMapAssignment rows in the committed placeholder geometry, which records a build per row (D-018, D-026). Not an input to any upstream data | `.build.info`; [MAPS.md](MAPS.md) |
| Interface 16001 | Forever TOC interface declared upstream | `src/config.lua:61` |

No upstream data was produced from build 70009, and upstream states that neither 69893 nor 69913
establishes the running client's map geometry. Independently, the `UiMapAssignment` CSVs at 69893
and 70009 are byte-identical (SHA-256 `79267e8be8034e47daab14350411b3acc0b1f64e86efc9d821a217497254ca0a`;
[research/coordinates.md](research/coordinates.md) §11), so the zone frames are current at 70009
(D-013); `UiMap` changed parent or type for four maps between the two builds. The manifest
records only upstream builds (§8.1).

---

## 11. Known gaps and risks

| Gap | Consequence for the planner |
| --- | --- |
| No upstream licence; Questie's draft says "all rights reserved" when in doubt (§3.1) | The owner publishes anyway with notices and accepts the risk (D-016). A change upstream triggers §3.2 |
| No Forever-specific entities; Era baseline only | New Forever quests and zones are missing; removed Era content is present. Every record is `foreverStatus: 'unknown'`; custom quests are first-class (ARCHITECTURE §1, §5.5) |
| Race restrictions use Era masks (77/178); Skyborne bits 2^32/2^33 are defined upstream but unused | Faction-wide quests are treated as including Skyborne (as Questie does); code never uses 32-bit bitwise operators on masks (D-012) |
| Objective counts not stored | `count` is always null; `objectivesText` ships, so a later, clearly labelled heuristic may parse counts from it (ARCHITECTURE §5.3) |
| Zone names come from comments in a hand-completed upstream file | They can vanish at a pin bump; `validate` fails loudly (§6.6) |
| Six synthetic continent/world points and three later-expansion dungeon entrances are unverified upstream | Treat as low-confidence locations |
| QuestXP is an Era seed; 750 quests have no row | XP is `era-seed` and null where missing (unknown, never 0) until measured for Forever |
| Consumer policy (unobtainable or hidden quests) lives in Questie, not QuestieDB | Needs a separate decision and input record |
| Upstream CBOR/TOC storage and generator internals are not a public contract | We depend only on the owned Lua source format, which upstream validates against its schema |

## 12. Updating the pin (Planned procedure)

1. Choose a new upstream commit; read its `docs/forever*.md` changes.
2. Re-run the licence check (§3.1 items 1-3) in full-history clones, including the state of
   Questie's `license` branch; if anything changed, follow §3.2 "Change triggers".
3. `pnpm data:fetch --commit <sha>`, then `pnpm data:extract` (which also regenerates the fixture
   slice).
4. `pnpm data:validate` must pass. Review `pnpm data:diff --from <old> --to <new>` (IDs,
   `upstreamDiff` tags, field changes, counts, zone names). If §9.1 shows Forever-only or
   Forever-changed rows, implement the three-way classifier (§9.4) before merging.
5. Update §2, §3.1 (if licence facts changed), §4.1, §6.8 (sizes), §8 (example counts) and §10
   of this file, the pin in `tools/questiedb/upstream.json` (ARCHITECTURE §4), the regenerated
   `public/data/**` and fixture slice, and `NOTICE.md` if its content changes, all in the same
   commit, with the diff summary in the commit message. CI then re-extracts from the new pin and
   must reproduce the committed bytes (§5).
