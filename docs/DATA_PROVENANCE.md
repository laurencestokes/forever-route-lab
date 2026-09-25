# Data provenance

The authoritative record of where forever-route-lab's game data comes from, what upstream
declares about its licence, the owner's posture, how the data is transformed, and how every
generated file is marked and traced. The detailed field reference and the Milestone 0 experiment
results are in [`research/questiedb-schema.md`](research/questiedb-schema.md).

| | |
| --- | --- |
| Status | **Milestone 2 (2026-09-25)**: §4-§9 describe the extractor as built in `tools/questiedb/` and the dataset it generated at the pin (dataRevision `65c377bc…`, `public/data/manifest.json`), including the fixes of the independent Milestone 2 data, coordinate and code reviews (finding IDs such as data-F3, COORD-3 and code-F8 refer to them; text changed by them says *changed after the review*). Revision 2 of Milestone 0 (aligned with [ARCHITECTURE.md](ARCHITECTURE.md) revision 2, [DECISIONS.md](DECISIONS.md) D-016 to D-026, the domain types in `src/domain/*.ts` and the independent critique [reviews/review-m0-architecture.md](reviews/review-m0-architecture.md); finding IDs such as LIC-09 refer to it) is the base. Where Milestone 2 deviates from the revision-2 plan, the text says **Changed in Milestone 2** and why. What is still not built is marked **Planned**. This file changes in the same commit as the tool. |
| Owner of this file | Whoever changes `tools/questiedb/`, the upstream pin, or the data notices |
| Authority | This file is the single definition of the dataset manifest (§8), which ARCHITECTURE §5.2 and D-026 reference. Where this file and ARCHITECTURE, a DECISIONS entry or the domain types in `src/domain/` disagree, they win and this file is corrected. |
| Related decisions | D-001 (repository licence; context and rationale superseded by D-016), D-002 (commit the dataset; manifest contents superseded by D-026, notices by D-016), D-007 (principle stands; vocabulary and classifier scope superseded by D-026, §9.3-9.4), D-009 (luaparse extractor), D-012 (arithmetic bit tests), D-013 (data frame 69893; per-row geometry builds, D-026), **D-016** (licence finding; publish anyway), **D-017** (spawns as published), **D-018** (placeholder geometry), D-022 (cited client values), D-025 (deployment hygiene), **D-026** (provenance vocabulary, manifest contents, build recording) |

---

## 1. Summary

| Question | Answer |
| --- | --- |
| Upstream | [Questie/QuestieDB](https://github.com/Questie/QuestieDB), flavour **Forever** |
| Pinned commit | `b6f5b07b0acf1c820993cbb0ce2521c912bb4c92` (2026-09-23 14:13:50 +0200, "feat: add generated Era-to-Forever coordinate helpers") |
| Upstream licence | **No root licence file (none covering Questie's own code or data)**, ever, on the default branch of either Questie/QuestieDB or Questie/Questie (full-history check, 2026-09-25; recorded in `tools/questiedb/upstream.json` `licenceCheck`). Questie's default branch carries licence files only for bundled third-party material (§3.1 item 3). Questie's unmerged `license` branch (commits `ce65498c`, 2023-02-13, to `842201bd`, 2024-05-06) drafts a notice saying that, when in doubt, Questie should be considered "all rights reserved", and a contributor licence agreement to relicense contributions as MIT, or CC0 where MIT is not applicable (§3.1) |
| Owner decision | Build, commit **and publish** the Questie-derived dataset with prominent notices of that finding; the owner accepts the risk (D-016). This repository's code stays GPL-3.0-or-later (D-001, D-016). Not a legal conclusion (§3.2) |
| What the data really is | The Classic Era QuestieDB baseline with an Era→Forever map-coordinate projection on four zones. **No Forever-specific quest, NPC, object or item content exists upstream yet** (§9). Every record ships `foreverStatus: 'unknown'`; the manifest says `foreverContentVerified: false` |
| What we ship | `public/data/`: `manifest.json`, `NOTICE.md`, `quests.json`, `entities.json`, `items.json`, `spawns.json`, `zones.json`, `overlays.json` (§6). Spawns stay as published: 0-100 zone percent keyed by AreaTable ID (D-017). Map geometry is not part of the dataset; it lives in `public/maps/placeholder/` (D-018). Never raw upstream Lua (D-002). The extraction report is neither shipped nor committed (§8.4) |
| Regeneration | Only by `tools/questiedb/` from the pinned commit (`pnpm data:fetch`, `pnpm data:extract`, `pnpm data:validate`; `pnpm data:check` runs fetch, `extract --check` and validate); never hand-edited. The dataset is identified by a content-addressed `dataRevision` (§8.3). A `tools/questiedb` change lands in the same commit as the regenerated dataset (`validate` compares `toolTreeHash`). `validate` proves internal consistency and runs in `pnpm check` with no clone; only `pnpm data:extract --check` proves the files equal a fresh extraction (§5, §7) |

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

**Pin policy.** The pin is a full 40-character commit SHA in one place,
`tools/questiedb/upstream.json` (ARCHITECTURE §4), together with the expected LF blob SHA-256 of
every input (§4.1), the golden counts (§5) and the licence check (`licenceCheck`: date, method,
result; §3.1), from which `NOTICE.md` and the manifest's `licence` object are rendered; it is repeated in the manifest
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
   clones with every remote branch (its date and result are recorded in `upstream.json`
   `licenceCheck`, next to the pin, and repeated at every pin bump, §12): QuestieDB 12 remote branches, 183 commits, default branch
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
- **Pattern.** Questie/QuestieDB declare no licence (no root licence file, none covering Questie's
  own code or data, on either default branch in full history; §3.1). Questie's own unmerged draft
  says to consider Questie "all rights reserved" when in doubt. The owner's posture is to publish
  the derived dataset with these notices. This repository's own code is licensed
  GPL-3.0-or-later. Treating Questie-derived data under that licence is a posture, not a legal
  conclusion; it grants no rights that upstream has not granted. (`NOTICE.md` uses this sentence
  verbatim.)
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
| OD-7 | Ship `startQuest` values that exist only because of `itemStartFixes.lua` (declared "automatically generated from wowhead data")? At the pin the provider has 452 entries, 202 of them for items present in raw data (`research/questiedb-schema.md` §7.3); with `noOverwrites` it only fills empty fields | **Shipped** under D-002/D-016, origin recorded per output (§8.2) and in `NOTICE.md`. Alternative: ship `startQuest` only where it does not come solely from `itemStartFixes`. The extractor counts those values (`counts.itemStartFixesOnly`) and publishes the item ids (`provenance.itemStartFixesOnly`), so either choice is a one-line change and each Wowhead-origin value is identifiable | pending |
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

### 4.1 Consumed

*Changed in Milestone 2:* built. `tools/questiedb/upstream.json` lists all 58 inputs with their
role and LF blob SHA-256 (`fetch.ts` and `extract.ts` refuse any mismatch), and the manifest's
`inputs` repeats them with git blob id and size. Six of them have role `semantics` (§4.1.2). Beyond the table below, the tool also reads
`src/corrections/registry.lua` (the `registry.loadOrder` windows), `src/corrections/enum/constants.lua`
(hash-pinned; its addon branch, `LibQuestieDB.Enum = constants`, is emulated rather than run), and two
provenance-only files: `docs/forever.md` (the researched UI build 1.60.1.69913, read by regex) and
`generate.lua` (the authorship line quoted in `NOTICE.md`).

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
| `src/corrections/enum/*.lua` (11 files) | Constants used by corrections (Era `byExpansion.Classic` masks; `npcFlags` values), run in `config.enumFiles` order | per-file hashes in `upstream.json` and the manifest; e.g. `expansions.lua` `68a4405bc9551a3efae61f4f2e20e12d8b9c4fd6cf99d59980e3e00daf1f52ac`, `zones.lua` `a39418b66c8f1c93fa435cbef6e30ba5a79b4a1af459fdd7af3af7729b1a975b` |
| `src/corrections/compat.lua` | The correction environment (module stand-ins, `pick`, `l10n`, the five `*ObjectiveFirst` hint sets, lines 21-31), transcribed in `tools/questiedb/lib/sandbox.ts`; hash-pinned | `a08c1f79…` |
| `src/meta/questMeta.lua` | Schema check (field indices/types) | `2cf91fe3dc43ac06b06fadf31c9dc05c48c545005ef49d70d3d413a3437e2bb2` |
| `src/meta/npcMeta.lua` | Schema check | `01d9f0047f4d8396be6dfaa7a6e286bd07f158c3c111245097f26e479319234e` |
| `src/meta/objectMeta.lua` | Schema check | `d53c228d4749eb125bd9fd513997b82d4e494a282af5db86fcde1dbab4929a1a` |
| `src/meta/itemMeta.lua` | Schema check | `a11209ef102e9cc0d1d199de4e7d662a515964a36f3013aafce9b6a14bae509f` |
| `src/config.lua`, `src/corrections/manifest.lua`, `src/corrections/registry.lua` | Provider list, order and options (`flavors`, `enumFiles`, `ownedCorrections`, `manifest`, `loadOrder`, read as literal tables and verified against the tool's reviewed plan, §5); TOC interface 16001 | `ec03223d…`, `60fcc8b7…`, `f8ad7dd5…`; full hashes in `upstream.json` |
| `support/Forever/QuestXP/xpDB-classic.lua` | Per-quest `{questLevel, baseXp}` (Era seed) | `9f5ca777904f6f62693cbe6f8b8ce91d0e0430e3ed5f7621df6e8691d4269149` |
| `support/Forever/Zones/areaIdToUiMapId.lua` | AreaID → UiMapID (base + override) | `cf9ae6f896e3e2fb1e43352b11596641312d9e61365ca7f281e5af1092185d07` |
| `support/Forever/Zones/uiMapIdToAreaId.lua` | UiMapID → AreaID, and **zone names** from trailing comments (§6.6, LIC-13) | `4964def0918a8cddef6c5f8292526a076b2afe73ea58f178f68a78e35bec39e3` |
| `support/Forever/Zones/dungeons.lua` | Instance entrances, alternative IDs, dungeon names; `dungeonQuest` derivation | `e2aa4eb8daf0096958da848727af5d57d7b184b5fa73a3d3643bcb818a045b44` |
| `support/Forever/Zones/zoneIds.lua` | Zone symbols; only its hash is used, checked against `conversion.json` `zone_symbols_sha256` | `55d56138c2a6aeab0d76dd43003c894aae09b899ab0e998649a94796153c9a80` |
| `data/Forever/conversion.json` | Build numbers, transform coefficients (for `era-coords` tagging only, §9.3) and upstream output hashes. Its per-map bounds feed `tools/maps import --placeholder`, not this dataset (D-018) | `f4477d6c575575152225f2a9d40858029bf9d2d5fdf6b083c06557fce8b5984b` |
| `support/Forever/provenance.json` | Provenance cross-check only (not data): `dbc_report.build` must equal `conversion.json` `geometry.target_build`; seed and tool-base commits are copied into `upstreamManifestCheck` | `5538df5af9f749a28d25c605d6f8df4e0245aa4071c90fea870b61518fa07ac5` |

#### 4.1.1 Provenance-only inputs (fork base)

Read to compute `upstreamDiff` (§9.3); they never reach a shipped value. Their hashes equal the
`source_sha256` entries of `conversion.json.files[]` at the pin, so the fork base is the current
Era data. Recorded in the manifest with `role: "provenance-only"`. *Changed in Milestone 2:* the
fork base is composed like Forever (raw rows, the Era static providers in the Vanilla flavour's
order, `src/corrections/Shared/itemStartFixes.lua` included, and the requiredRaces pass), and its
dynamic providers are evaluated per persona too (§9.3).

| Path at pin | SHA-256 (LF blob) |
| --- | --- |
| `data/Classic/classicQuestDB.lua` | `210e9ac3f98baf2c624be0c8677e7e9adec3f2b9e426f30fd649c4018678afab` |
| `data/Classic/classicNpcDB.lua` | `ee4a241db3ff89e5f0883b688b58920c1121f5617202ecba81d90b17271ccd54` |
| `data/Classic/classicObjectDB.lua` | `d08fbd8216757918330d9ff02bfc1b13f837f198e0aa62aa76260bb1bd9cd042` |
| `data/Classic/classicItemDB.lua` | `987d037b6df94d5b0b1dc326a1670581e3abb952736a4ae055fd9f161328b71c` (byte-identical to the Forever item file) |
| `src/corrections/Era/classic{Quest,QuestReputation,NPC,Object,Item}Fixes.lua` | equal to `conversion.json` `source_sha256` (e.g. `classicNPCFixes.lua` `38e5217bfd4f23ba…`, `classicQuestFixes.lua` `fd28ff9f01e1b613…`); full hashes in the manifest |

#### 4.1.2 Transcribed behaviour (`semantics` inputs)

*Added after the Milestone 2 review (data-F2).* Some upstream behaviour is not run but transcribed by
hand into TypeScript. Each transcribed file is a pinned input, and the module that transcribes it
names the LF blob SHA-256 it was written against (`TRANSCRIBES`, collected in
`tools/questiedb/lib/semantics.ts`). When a pin bump changes one of them, `upstream.json` gets the
new hash and the reference no longer matches: the extraction and `validate` fail until someone
reviews the transcription and updates the reference. Files the tool reads for nothing else have role
`semantics`:

| Path at pin | Transcribed in | What | SHA-256 (LF blob) |
| --- | --- | --- | --- |
| `src/corrections/register.lua` | `lib/plan.ts`, `lib/corrections.ts` | `FromManifest` load orders, `WindowFor`, the seasonal gates; `wrap` | `1abd208277be869221b08fd623cc78e1cef6fd1a80a8fca7e99a507a4a4bf7c0` |
| `src/derived/requiredRaces.lua` | `lib/derived.ts` | `ApplyQuestieCompatibility` | `19cab68a2ffc46dc2115f1387b8ac1dec526c67fcc57c4cc09dea57e4612299d` |
| `src/derived/_end.lua` | `lib/derived.ts` | pass registration (only `requiredRaces:questieCompatibility` affects shipped fields) | `60578bb0634acabc770c786a459baed2f1c0efab06b5adba68b012b51922195a` |
| `src/meta/normalize.lua` | `lib/points.ts`, `lib/corrections.ts`, `lib/project.ts` | `normalizeCoordinateRow`; `normalize.field` nil cases; the pad-to-0 that is not reproduced | `9047cb03c21dd5f26e007d07ee0f700dab0b20149484e5ee5ba4504e266b131b` |
| `src/support/data.lua` | `lib/sandbox.ts` | `support.Install` (module shim, seeded `Expansions`) | `70e4dba6d3eea140b47acf0a67d2a9bbcbc4bda0b251596eb584fdcc8d7e91d4` |
| `docs/forever-coordinate-audit.md` | `lib/zones.ts` | the three frame-unverified entrances (§6.6) | `ac4b4e56f34911c104ae374d2d936443fbf91a43e0cb76562b964ea95739aab6` |

Three inputs with other roles are referenced the same way for their transcribed parts:
`src/corrections/compat.lua` (`lib/sandbox.ts`: the stand-ins, `pick`, `Invoke`),
`src/corrections/registry.lua` (`lib/corrections.ts`, `lib/plan.ts`: `MergeInto`, `recompose`,
`Select`) and `src/config.lua` (`lib/plan.ts`: `correctionApplies`).

### 4.2 Not consumed

| Path | Reason |
| --- | --- |
| `src/corrections/Tbc`, `Wotlk`, `Cata`, `MoP`, `Sod`, `Titan`, `Shared` | Not applied to the Forever flavour upstream (`src/config.lua:173-183`; `docs/forever.md:34-36`). `src/corrections/Era/*` and `Shared/itemStartFixes.lua` are read only as the fork base (§4.1.1) |
| `l10n/Forever/**` | English-only first release; files are byte copies of the Era localisation. It has no zone-name tables (zone names come from §6.6) |
| `support/Forever/DropTables/*` | Drop percentages not shipped (declared Wowhead/CMaNGOS-generated, §3.1); drop *sources* come from item fields |
| `support/Forever/FactionTemplates/*`, `subZoneToParentZone.lua`, `instanceIdToAreaId.lua` | Not needed by the first planner; add to §4.1 if used |
| `tools/lua-binary/*`, `generate.lua`, `generator/*`, `emulator/*` | Not executed by the pipeline or CI (§5); may be used by the optional manual parity check (§5, ARCHITECTURE §5.2) |
| Questie/Questie (blacklists, policy corrections, XP formula) | Consumer-owned, not QuestieDB data. Read only for semantics (§2). Any future use is a separate input with its own entry here |

---

## 5. Processing pipeline

`tools/questiedb/` (TypeScript, Node ≥ 22.13, run with tsx through pnpm scripts; no Lua runtime;
D-009). The operator's guide is `tools/questiedb/README.md`; the whole extraction runs in memory in
`lib/pipeline.ts`, and the CLIs only read and write files.

| Step | Script | Does |
| --- | --- | --- |
| 1 | `fetch.ts` (`pnpm data:fetch`) | Reads the pin from `tools/questiedb/upstream.json`. Reuses `.cache/questiedb` when it already has the pinned commit and every input blob (no network access). Otherwise it makes a shallow fetch of the pinned commit alone (`git init`, `core.autocrlf=false`, `git fetch --depth 1 origin <sha>`): every blob of that commit, and not a partial clone, so nothing can be fetched lazily afterwards. An older partial clone that lacks input blobs gets them in one batched request (found with a listing that cannot fetch, `cat-file --batch-all-objects`), never one round trip per blob. It prints the git version (and whether it supports `GIT_NO_LAZY_FETCH`, git 2.45 and later) and whether the network was used. Then it verifies every input's LF blob SHA-256 against `upstream.json`, and the ten `output_sha256`/`source_sha256` pairs `conversion.json` records against the blobs. `--commit <sha>` fetches another commit and prints its input hashes for a reviewed pin bump (§12); it never edits `upstream.json`. *Changed after the review (data-F4):* the first version made a blob-filtered clone and then fetched each input blob lazily, one request at a time (7 min 33 s cold on git 2.44), and claimed "no network access" afterwards |
| 2 | `extract.ts` (`pnpm data:extract`) | Reads the 58 inputs as committed blobs of the pin (`git cat-file --batch` with `GIT_NO_LAZY_FETCH=1`; in a partial clone with a git that does not know that variable, every input blob is first checked to be present with a listing that cannot fetch, and a missing one is refused, so extraction never reaches the network), checks the transcription references (§4.1.2), refuses any hash mismatch, applies the layers below, projects to the shipped fields (§6), tags provenance (§9.3), renders `public/data/**` and the fixture slice `tests/fixtures/data/**` deterministically with `_generated` and `NOTICE.md` (§7) and each directory's `manifest.json` last (§8), then writes them and the gitignored report (§8.4). `--check` compares a fresh extraction with the committed bytes instead of writing, and fails on any file in either directory that the extractor does not write (the reproducibility gate); `--slice`, `--out` and `--slice-out` select or redirect the outputs. It needs no git checkout of this repository: in a copy without `.git` (a source archive), `toolTreeHash` is computed in-process (§8.1) |
| 3 | `validate.ts` (`pnpm data:validate`) | Needs no clone. For `public/data` and the slice: every expected file present and no other; UTF-8, LF, final newline, no BOM; no absolute paths or `.cache` references; each JSON file an object whose first key is `_generated` naming the pin; zod schemas for all six data files and the manifest (`lib/schema.ts`; no single id is 0, §6); the manifest's outputs, per-file SHA-256 and byte counts, the recomputed `dataRevision`, the pin and every input checksum against `upstream.json`, and `toolTreeHash` against the checkout (§8.1); the transcription references (§4.1.2); `NOTICE.md` content (carve-out verbatim, pin, non-affiliation, no `dataRevision`); golden raw and composed counts, and for `public/data` the recorded shipped counts (`upstream.json` `golden.shipped`); ascending unique ids; referential integrity (every entity a quest, item, spawn list or overlay names ships, overlay item drops included; for `public/data` also every quest an NPC, object or item names); coordinates within 0-100 or exactly `[-1, -1]`, no zero phase, for spawns, event and hint points and their overlay versions; **no drawable point keyed by a `routed` AreaId** (§6.5); every presence key in `instanceAreas`, and every resolution target a dungeon entry; zone link consistency (a `direct` link is its UiMap's own AreaId, a `routed` one is not) and the expected UiMap names (rule 5, §6.6); `frameVerified` false exactly for the audit's entrances; every `dungeons.lua` key classified and `dungeonQuest` recomputed from both factions' entries; provenance invariants. `--skip-tool-tree` skips the tree comparison for local work; CI never uses it. It runs in `pnpm check` and needs no clone |
| 4 | `diff.ts` (`pnpm data:diff`) | Pin-to-pin dataset diff between two extractions, two manifests (hashes and counts only) or `git:<rev>` (§9.4). The three-way classifier is a stub returning `unknown` (§9.4; F23, D-026) |

`pnpm data:all` runs fetch, extract and validate; `pnpm data:check` runs fetch, `extract --check` and
validate (the full gate, which needs the clone and so the network on first use).

**The whitelisted evaluator** (`lib/evaluator.ts`, `lib/lua-source.ts`). luaparse 0.3.1 parses every
file in `pseudo-latin1` mode (Lua strings are bytes); every string literal and comment is decoded back
as strict UTF-8, and a byte-order mark fails. The evaluator runs only: `local` declarations (`...`
only as the last initialiser, and never more names than values when the last value is a call: Lua
would expand the call's extra return values, which a one-value host function cannot give, so
`local playerClass, playerClassId = UnitClassBase("player")` fails closed; data-F1), assignment to a local or to a field of an existing table,
parameterless module methods `function M:F()` / `function M.F()` at top level, `return` of at most one
value, `if`/`elseif`/`else`, literals, names, `a.b` (the key must exist), `a[k]` (an absent key reads
nil, as `({ DRUID = … })[playerClass]` needs), calls of host functions and declared methods, table
constructors, `+ - == ~= < <= > >=` (arithmetic and ordering on numbers only), `and`, `or`, unary `-`
and `not`. Every executed file is scanned for anything else before it runs (loops, `local function`,
anonymous functions, `#`, `..`, `*`, call statements, several return values, table calls), so an
unsupported construct fails closed with its file and line even on a branch the extraction would not
take. Unknown globals, unknown members and global assignments fail at run time. Table constructors
follow Lua 5.1 (keyed fields stored as met, positional values last); a positional value colliding
with an explicit integer key is order-dependent and fails closed, and a repeated keyed field keeps the
last value, as Lua does, and is reported as a lint (none at the pin; repeated row ids in an entity
file fail). Files whose top level is not run (`config.lua`, `manifest.lua`, `registry.lua`) are read
only through literal subtrees located by their assignment target; any name or call inside fails.

**Environments** (`lib/sandbox.ts`). Support files run in the environment of
`src/support/data.lua`: `QuestieLoader` hands out `{ private = {} }` modules and `Expansions` is
seeded with the flavour's order (Forever rules "Classic", so `Expansions.Current = 1` and the
`>= Wotlk` / `>= Cata` blocks of `dungeons.lua` do not apply). Correction files run in the environment
of `src/corrections/compat.lua`: `QuestieDB`, `ZoneDB`, `QuestieProfessions`, `Phasing` and
`Expansions` stand-ins built with compat's `pick` (a shared constant, else `byExpansion.Classic`),
the five hint sets, identity `l10n`, the `Questie` icon constants (a global only while a provider
runs, as `compat.Invoke` installs it; a correction file that reads it while loading fails closed),
and the direct-write capture tables. `UnitFactionGroup` and `UnitClassBase` read a persona that is set only while a dynamic
provider runs; a static provider or support file that asks for it outside that fails closed.

**Layers**, reproducing what the addon reads (evidence in `research/questiedb-schema.md` §7):

1. **Raw rows.** Each `data/Forever/forever*DB.lua` runs in the support environment; its deferred
   `<type>Data` string is parsed and run as its own chunk. The key enum of each file must match
   `src/meta/*Meta.lua` (the item file's enum lacks `teachesSpell`, 16, which only corrections
   write), and `enum/fieldKeys.lua` must match the schema exactly. Every field value is type-checked
   against the schema's storage type; repeated ids fail.
2. **Static corrections** in upstream order with QuestieDB merge semantics. The plan (`lib/plan.ts`)
   is derived from upstream's own tables with a transcription of `config.correctionApplies`,
   `register.FromManifest` (load order = window base + (generated ? 1 : 10) + function offset) and
   `registry.Select` (load order, then registration sequence), and compared with the plan the tool
   was reviewed for; any difference fails. At the pin, per datatype: Quest
   `legacy/classicQuestReputationFixes.lua:Load` (2), `legacy/classicQuestFixes.lua:Load` (11),
   `foreverQuestFixes.lua:Load` (1411); NPC and Object `legacy/classic*Fixes.lua:Load` (11),
   `forever*Fixes.lua:Load` (1411); Item `legacy/itemStartFixes.lua:LoadAutomaticQuestStarts` (2,
   `noNewEntries` + `noOverwrites`), `legacy/classicItemFixes.lua:Load` (11),
   `foreverItemFixes.lua:Load` (1411). Each provider is materialised as `register.lua` `wrap` does
   (direct writes into `QuestieDB.<type>Data` first, the returned table on top) and merged with
   `registry.MergeInto` semantics (`lib/corrections.ts`): whole-field replacement; an absent id is
   created unless `noNewEntries`; `noOverwrites` writes only fields that are nil (an existing `{}` is
   not nil); `[k] = {}` stores the empty table, the delete idiom, which projection reads as absent;
   non-numeric field keys are ignored, as upstream ignores them; a value whose type does not suit the
   field, or a field outside the schema, fails closed. The last static writer of every field is
   logged (for `corrected` and `itemStartFixesOnly`). The `QuestieCorrections.*ObjectiveFirst[id] =
   true` side effects are collected as hint sets (`itemObjectiveFirst = {503, 5088}` at the pin; the
   other four are empty), not merged into records. Result at the pin: composed 4,257 quests, 10,122
   NPCs, 6,666 objects, 14,899 items (the golden counts); created by correction 13 / 3 / 21 / 10;
   `itemStartFixes` applied 202 values and skipped 250 ids absent from the item data.
3. **Derived pass** `requiredRaces:questieCompatibility` (`lib/derived.ts`), transcribed with its
   quirks (nil or 0 only; creature starters only; `"AH"` counts for both; missing NPCs ignored; the
   delete idiom is truthy and blocks it). It changes one quest at the pin (7162, to 77). The waypoint
   pass is not applied: waypoints do not ship.
4. **Dynamic layers**, kept separate in `overlays.json` (§6.7): every `LoadFactionFixes` /
   `LoadDynamic` provider is evaluated for each faction × class persona and composed as
   `registry.lua` `recompose` does (later providers win per field; `{}` and zero pairs of fields
   18-20 become nil; deprecated constant fields dropped; a non-empty table in a scalar field or a field
   outside the schema fails closed, where upstream warns and drops it), plus `dungeons.lua` evaluated
   once as Alliance and once as Horde.

The fork base (Vanilla flavour: `data/Classic/*`, the Era providers and `Shared/itemStartFixes.lua`,
the same derived pass and its own dynamic providers) is composed the same way, only for
`upstreamDiff` (§9.3).

Not done, deliberately:

- no Era→Forever coordinate conversion (already applied upstream; applying it again would corrupt
  the data; the projection is only recomputed to *check* `era-coords`, §9.3), and **no conversion to
  world yards**: spawns ship as published and `infra/data` converts them at load (D-017, which
  supersedes D-004 for dataset rows);
- no pad-to-0: QuestieDB's read contract pads absent numeric slots to 0
  (`src/meta/normalize.lua:182-199`); the extractor reads the Lua source and emits `null`
  instead (DSO-05);
- no Questie consumer policy (blacklists, event gating) and no inference of Forever-only content.

**Acceptance evidence at the pin** (measured by this tool; `extract.test.ts` pins the first four):

- composed counts equal upstream's Forever Golden (35,944 entities, `docs/forever-validation.md:37,40`
  in QuestieDB);
- `upstreamDiff` tags 12 quests, 741 NPCs, 607 objects and 0 items `era-coords` and nothing
  `forever-changed`: exactly the composed differences QuestieDB recorded between Vanilla and Forever
  (`docs/forever-validation.md:47-49`), every differing coordinate pair being the documented
  projection of the Era pair (13,297 pairs in the static rows);
- two extractions are byte-identical, and the committed files equal a fresh extraction;
- `validate` passes on both directories;
- run on raw rows, the same selection rules reproduce the Milestone 0 flag census exactly (51 flight
  masters, 297 trainers, 34 innkeepers not quest-referenced; 382 added; `research/questiedb-schema.md`
  §12.1);
- about 2.3 s for a full extraction on the development machine (0.3 s reading inputs, 0.7 s per
  composition, 0.35 s projection and provenance); a cold `pnpm data:fetch` takes about 25 s, a cached
  one under 1 s (`docs/measurements/data-m2.json`).

Field-level parity with upstream Generation is not proven (see the optional manual check below).

**Commits and CI (ARCHITECTURE §5.2).** Every change to `tools/questiedb/` (its tests and README
included) changes `toolTreeHash` and lands in the same commit as the regenerated `public/data/**` and
fixture slice; `validate` enforces this (§8.1). CI runs `pnpm data:check`: it fetches the pinned
QuestieDB commit named in `tools/questiedb/upstream.json` (`pnpm data:fetch`), runs
`pnpm data:extract --check`, which fails unless every output is byte-identical to the committed files
and no other file is there (reproducibility contract, §8.3), and then `pnpm data:validate`.

*Changed after the review (data-F3, code-F1):* `pnpm check` runs `pnpm data:validate` (no clone
needed), and `pnpm test` validates the committed `public/data` and the slice with no clone
(`validate.test.ts`). The end-to-end tool test (`extract.test.ts`) needs the clone; without it, it
prints a loud "SKIPPED" warning, and with the environment variable `CI` set it fails instead. So a
clean checkout without the clone gets every consistency check, but not the proof that the files
equal a fresh extraction. *Planned:* the CI workflow itself (Milestone 9 gauntlet); until then that
gate is `pnpm data:check`, run by hand, and STATUS tracks it.

**Optional manual parity check (ARCHITECTURE §5.2).** The pipeline needs no Lua runtime (D-009),
so field-level parity with QuestieDB's own Lua generation is an optional manual check, not a CI
gate and not part of `validate.ts`. The required checks are golden counts, output hashes, schema
and referential integrity (step 3). When someone runs the parity check, it compares the composed rows
of `compose()` (`tools/questiedb/lib/compose.ts`, before projection) with a Baked artifact built by
upstream: a local `generate.lua Forever` run with an owner-approved Lua 5.1 interpreter, or the
published `QuestieDB-Forever.zip` release asset after checksum verification against `release.json`
(`research/questiedb-schema.md` §10, options A and E). Its result is a review note; it never changes
`public/data/` or the manifest. Not run in Milestone 2.

---

## 6. Fields we ship

Aligned with ARCHITECTURE §5.2-5.4. Field numbers are QuestieDB schema indices
(`research/questiedb-schema.md` §3). Values are after the §5 layers. "nil → null" means an absent
upstream value is emitted as `null`, never 0 or an empty list, unless a row says otherwise.

**0 → null for single ids** (*changed after the review*, code-F8, data-F13). Upstream writes 0 for
"none" in single-id fields. The extractor ships `null` there instead, so a shipped single id is
never 0 and a consumer never looks up id 0. The fields: quest `zoneOrSort`, `prerequisites`
`nextQuestInChain`, `parentQuest`, `breadcrumbForQuestId`, `availableUntilCompleted`,
`availableStartingWith` and `disabledByQuest`, `requirements` `spell`, `specialization` and
`sourceItemId`, the spell objective's `itemId`, NPC and object `zoneId`, object `factionId`, and item
`startsQuest`. All of them hold positive ids, except `zoneOrSort` (a negative value is a QuestSort)
and `requirements.spell` (a negative value means "must not know the spell"), which are non-zero
signed ids. A negative value in a positive-id field fails the extraction. At the pin this changes 16
`nextQuestInChain` values (15 static and quest 1198's Horde layer), 11 `parentQuest`, 1
`sourceItemId`, 165 NPC and 35 object `zoneId`s. Masks (`races`, `classes`: 0 means no restriction)
and values (`rank`, `itemClass`, levels, flags) are not ids and keep their 0. The domain types
(`src/domain/dataset.ts`) state the same on each field, and the loader checks these fields as
positive (or non-zero signed) ids.

Record shapes and field names follow the domain types in `src/domain/dataset.ts` and
`points.ts`, which are authoritative (ARCHITECTURE §5.3); `tools/questiedb/lib/shapes.ts` states the
JSON shapes in TypeScript and `lib/schema.ts` validates them. A JSON record equals its domain record
field for field, with plain numbers for ids and **every key present** (explicit `null` or `[]`), with
one exception: published points stay as published, a **PointMap** `{ "<areaId>": [[x, y], ...] }`
(ascending AreaIds; rows in upstream order), which `infra/data` turns into `PublishedPoint`s at load
(§6.5). *Resolved in Milestone 2:* the open item of revision 2 is closed by the domain types, which now
carry NPC `rank`, `zoneId` and `subName`, object `zoneId` and `factionId`, and item `itemClass`, and
whose `ZoneInfo.name` is nullable.

### 6.1 Files

| File | Top-level shape | Records at the pin | Section |
| --- | --- | ---: | --- |
| `quests.json` | `{ "_generated", "rows": QuestRow[] }` | 4,257 | §6.2 |
| `entities.json` | `{ "_generated", "npcs": NpcRow[], "objects": ObjectRow[] }` | 6,003 + 952 | §6.3 |
| `items.json` | `{ "_generated", "rows": ItemRow[] }` | 2,962 | §6.4 |
| `spawns.json` | `{ "_generated", "npc": { "<id>": PointMap }, "object": { "<id>": PointMap } }` | 5,862 + 918 | §6.5 |
| `zones.json` | `{ "_generated", "areas", "uiMaps", "dungeons", "instanceAreas" }` (maps keyed by id). No geometry: zone frames are map metadata in `public/maps/placeholder/geometry.placeholder.json` (ARCHITECTURE §5.2, §6; D-018) | 1,111 + 57 + 122 + 41 | §6.6 |
| `overlays.json` | `{ "_generated", "faction": { "Alliance", "Horde" }, "class": { "Alliance": { "<CLASS>": … }, "Horde": … } }` | 276 patches | §6.7 |
| `NOTICE.md`, `manifest.json` | Marking and provenance | | §7, §8 |

Rows are in ascending id order, one record (or map entry) per line; §8.3 has the byte rules.

### 6.2 `quests.json`

| Record field (ARCHITECTURE §5.3) | Upstream | Rule |
| --- | --- | --- |
| `id` | row key | |
| `name` | 1 name | Blizzard game content; a record without a name fails closed |
| `level` | 5 questLevel | nil → null. `-1` ("scaling") and `0` are kept as published. *Changed in Milestone 2:* no composed quest has a nil level; the 14 raw quests revision 2 counted as lacking it have `0` (the Milestone 0 census counted 0 as empty). After corrections, 1 quest has 0 and 12 have -1 |
| `minLevel` / `maxLevel` | 4 requiredLevel / 32 requiredMaxLevel | nil → null |
| `races` / `classes` | 6 requiredRaces (after the derived pass) / 7 requiredClasses | nil → null; `0` kept as published (no restriction). Tested only arithmetically; Skyborne races use bits 32-33 (D-012) |
| `zoneOrSort` | 17 | Positive = AreaID, negative = QuestSort; nil or 0 → null |
| `dungeonQuest` | derived | `true` when `zoneOrSort > 0` and it is a dungeon key of `dungeons.lua` (either faction) or one of that entry's alternative AreaIDs. Every key must be classified in `tools/questiedb/lib/dungeon-areas.ts` (self-authored): `DUNGEON_KEYS` (115 dungeons and raids) or `NON_DUNGEON_KEYS` (2257 Deeprun Tram, 2917 Hall of Legends, 2918 Champions' Hall, the battlegrounds 2597, 3277, 3358, and *added after the review (data-F12)* 5733 Molten Front, 5861 Darkmoon Faire Island, 6298 Brawl'gar Arena and 6618 Bizmo's Brawlpub). A new key in neither list, or a listed key that leaves `dungeons.lua`, fails the extraction and `validate` until someone classifies it. 217 AreaIds (in the report), 557 dungeon quests |
| `starters` / `finishers` | 2 startedBy `{npcs, objects, items}` / 3 finishedBy `{npcs, objects}` | `{ "kind", "id" }` refs in kind order, then upstream order; an unknown slot fails |
| `objectives` | 10 objectives, 9 triggerEnd | §6.2.1 |
| `objectiveHints` | 29 extraObjectives | `{ "text", "objectiveIndex", "points", "refs" }` (domain `ExtraObjective` order): `text` nil → null; `objectiveIndex` as published (Questie's value, nil → null); `points` a PointMap (`{}` when absent); `refs` `{ "kind", "id" }` from `{"monster" \| "object" \| "item", id}` (any other kind fails). Hints are not counted and never shift objective indices (DSO-06) |
| `objectivesText` | 8 | `string[]` or null; Blizzard quest text; counts are not parsed at extraction (ARCHITECTURE §5.3) |
| `prerequisites` | 12 preQuestGroup, 13 preQuestSingle, 14 childQuests, 15 inGroupWith, 16 exclusiveTo, 22 nextQuestInChain, 25 parentQuest, 27 breadcrumbForQuestId, 28 breadcrumbs, 33 availableUntilCompleted, 34 availableStartingWith, 36 disabledByQuest | IDs kept as published, including signs. Shape is `QuestPrerequisites` (`src/domain/dataset.ts`): list fields nil → `[]`, single-ID fields nil or 0 → null (§6 "0 → null"; the Horde layer's `nextQuestInChain = 0` for quest 1198 ships as `null`, over the static 1200). *Changed after the review:* a written 0 was kept |
| `requirements` | 18 requiredSkill → `skill {skillId, value}`, 19 requiredMinRep → `minReputation {factionId, value}`, 20 requiredMaxRep → `maxReputation`, 30 requiredSpell → `spell`, 31 requiredSpecialization → `specialization`, 11 sourceItemId → `sourceItemId`, 21 requiredSourceItems → `requiredSourceItems` | Shape is `QuestRequirements`. `{0,0}` pairs, `{}` and nil → null; `spell`, `specialization` and `sourceItemId` nil or 0 → null; `requiredSourceItems` nil → `[]`. 35 requiredRanks has no field in `QuestRequirements` and is not shipped (one correction write at the pin; MoP-only, SIMULATION VAL-19) |
| `reputationReward` | 26 | `{ "factionId", "value" }[]`; nil → `[]` |
| `flags` | 23 questFlags, 24 specialFlags | `repeatable` = specialFlags bit 0 (value 1), `needsEvent` = bit 1 (value 2), arithmetic tests (`Math.floor(v / 2 ** bit) % 2 === 1`). Raw `questFlags` and `specialFlags` kept (nil → 0, since the record holds numbers and 0 means no flag) |
| `xp` | QuestXP `{questLevel, baseXp}` | `{ "questLevel", "baseXp", "basis": "era-seed" }`; null for the 763 quests without a QuestXP row (750 raw + the 13 created by corrections; SIMULATION QXP-7). The extractor never writes the `user` or `forever-observed` bases |
| `provenance` | §9.3 | `{ "upstreamDiff", "foreverStatus": "unknown", "corrected", "created", "source": "questiedb" }` |

#### 6.2.1 Objective order and shape (DSO-06)

`objectives` is a discriminated union (ARCHITECTURE §5.3) in Questie's `ObjectiveData` order
(Questie `Database/QuestieDB.lua:1735-1864` at `40016145`), built by `lib/objectives.ts`:

| Order | Upstream | Emitted as |
| ---: | --- | --- |
| 1 | `objectives[1]` creature `{npcId, text?, iconType}` | `{ "kind": "kill", "npcId", "label", "count": null }` |
| 2 | `objectives[2]` object | `{ "kind": "object", "objectId", "label", "count": null }` |
| 3 | `objectives[3]` item | `{ "kind": "item", "itemId", "label", "count": null }` |
| 4 | `objectives[4]` reputation (a single `{factionId, value}` pair) | `{ "kind": "reputation", "factionId", "value" }` |
| 5 | `objectives[5]` killCredit `{{npcId, ...}, baseNpcId, baseText?, iconType}` (only a non-empty table) | `{ "kind": "killCredit", "npcIds", "rootNpcId", "label", "count": null }` |
| 6 | `objectives[6]` spell `{spellId, text?, itemId}` | `{ "kind": "spell", "spellId", "itemId", "label" }` (`itemId` nil or 0 → null) |
| 7 | field 9 triggerEnd `{text, {[areaId] = {{x, y}, ...}}}` | `{ "kind": "event", "text", "points": PointMap }`; turned into `PublishedPoint`s at load by the §6.5 rules |

- **Hints.** Five hint sets: `killCreditObjectiveFirst`, `objectObjectiveFirst`,
  `itemObjectiveFirst`, `eventObjectiveFirst`, `spellObjectiveFirst` (creature objectives have
  none). Questie inserts each element of a hinted kind at position 1 as it processes it
  (`tinsert(ObjectiveData, 1, x)`), so several hinted elements of one kind end up at the front in
  reverse order; the extractor does exactly that. At the pin only `itemObjectiveFirst = {503, 5088}`
  is set (`classicQuestFixes.lua:17-18`). The hint sets are recorded in the manifest `layers`.
- The objective **index** is the position in this list. RXP `.complete q,i` maps to index
  `i - 1` (ARCHITECTURE §5.4). Measured on the composed quests: 177 mix objective kinds and 24
  combine objectives with an event (the critique measured 172 and 14 on raw rows); objectives by
  kind: 754 kill, 97 object, 3,333 item, 144 reputation, 5 killCredit, 0 spell, 130 event.
- `label` is the upstream text slot (nil → null). `count` is always `null`: QuestieDB stores no
  counts. `iconType` is not shipped.
- Questie iterates these lists with `pairs`. The extractor iterates them as sequences `1..n` and
  fails closed on a sparse or non-integer-keyed list or an unexpected slot, whose `pairs` order or
  meaning would be unspecified.

### 6.3 `entities.json`

**NPCs.** The shipped set (`lib/select.ts`) is the union of:

- *quest-referenced* NPCs: starters and finishers of any quest, creature and killCredit objective
  targets (`npcIds` and `rootNpcId`), `monster` refs of objective hints, `dropNpcs` of shipped items,
  and every NPC whose `questStarts` or `questEnds` is non-empty;
- *flag-selected* NPCs (F07): the composed `npcFlags` value has FLIGHT_MASTER, TRAINER or
  INNKEEPER set, with the values read from `byExpansion.Classic.npcFlags` (8, 16, 128;
  `src/corrections/enum/expansions.lua:24-41`) and tested arithmetically (D-012).

Every record variant a faction or class overlay produces is scanned as well, so a reference only a
persona layer introduces still resolves. *Changed in Milestone 2 (measured):* 6,003 NPCs, not the
6,191 estimated on raw rows: 5,598 quest-referenced, plus 405 flag-only (flight masters 63, trainers
499, innkeepers 47 in total; 51, 323 and 31 of them not quest-referenced). Static corrections change
drop lists and write `npcFlags` on 31 NPCs (several false innkeeper flags 135 become 0). On raw rows
the same rules give 5,828 quest-referenced NPCs (the wider rules add 19 to the research's 5,809) and
exactly the research's 382 flag-only NPCs.

- Taxi nodes are identified by `TaxiNodeRef { npcId, taxiNodeId, name }` (ARCHITECTURE §8.1,
  §9.1). A dataset flight master supplies `npcId`. New Forever flight nodes have no dataset NPC
  (QuestieDB has no Forever-only NPCs, §9.1), so they are referred to by a cited TaxiNodes id
  (D-022) or a name, never by an invented NPC record.

| NPC record field | Upstream | Rule |
| --- | --- | --- |
| `id`, `name` | key, 1 | name required (Blizzard game content) |
| `subName` | 14 | nil → null; `""` kept (trainer and flight-master titles) |
| `minLevel`, `maxLevel`, `rank` | 4, 5, 6 | nil → null |
| `zoneId` | 9 | nil or 0 → null (upstream's 0 means "unknown or varies": NPC 5676's static 0, for example, while its faction layers give 1519 and 1637) |
| `npcFlags` | 15 | nil → 0 (the record holds a number) |
| `friendlyTo` | 13 friendlyToFaction | `"A"`, `"H"`, `"AH"`; nil or `""` → null; any other value fails closed |
| `questStarts`, `questEnds` | 10, 11 | nil → `[]` |
| `provenance` | §9.3 | |

Not shipped: 2-3 (deprecated), 12 factionID, 8 waypoints. Spawns (7) go to `spawns.json`.

**Objects.** Quest-referenced only: starters and finishers, object objectives, `object` refs of
objective hints, `dropObjects` of shipped items, and every object with non-empty `questStarts` or
`questEnds`: 952 at the pin. Fields `id`, `name` (1), `zoneId` (5; nil or 0 → null), `factionId` (6;
nil or 0 → null), `questStarts` (2), `questEnds` (3), `provenance`. Spawns (4) go to `spawns.json`. Not shipped: 7 waypoints (none in
Forever).

### 6.4 `items.json`

Selection, iterated to a fixed point: item objectives, spell-objective `itemId`s, `sourceItemId`,
`requiredSourceItems`, items in any quest's `startedBy`, `item` refs of objective hints, every item
whose `startQuest` names a quest of the dataset (the reverse link, like NPC `questStarts`), and the
`itemDrops` containers of items already selected: 2,962 at the pin. *Changed in Milestone 2:* the
reverse link and the hint refs are added; three items whose `startQuest` names a quest absent from
the dataset (10590 → 3482, 20483 → 8338, 227911 → 84377) are therefore not selected on their own.

Fields `id`, `name` (1), `itemClass` (12 class), `dropNpcs` (2 npcDrops), `dropObjects` (3
objectDrops), `dropItems` (4 itemDrops), `startsQuest` (5 startQuest, nil or 0 → null), `provenance`. Drop
percentages are not shipped (§3.2). `startQuest` values whose last static writer is `itemStartFixes`
are counted (`counts.itemStartFixesOnly`: 199 shipped items; 201 of the 202 applied values survive
`classicItemFixes`) and, *changed after the review (data-F10)*, listed by id in the manifest
(`provenance.itemStartFixesOnly`), so the values of declared Wowhead origin can be identified in the
published files, for OD-7.

### 6.5 `spawns.json` (D-017)

```json
{ "_generated": { "...": "§7" },
  "npc":    { "3143": { "14": [[42.06, 68.33]] } },
  "object": { } }
```

NPC 3143 Gornek, AreaID 14 Durotar (`data/Forever/foreverNpcDB.lua:2604`; the worked example in
[research/coordinates.md](research/coordinates.md)); `extract.test.ts` pins it. An entity without
spawns has no key (141 shipped NPCs and 34 objects).

- Coordinates are **as published**: 0-100 zone percent keyed by AreaTable ID, never rounded,
  re-projected or converted to yards by the extractor. Numbers are written in shortest round-trip form
  (`42.10` in the Lua becomes `42.1`). At the pin 7 values have 3 decimals (correction points in the
  unconverted synthetic continent areas) and ship as they are; all 76,300 drawable shipped points lie
  within 0-100.
- A row is `[x, y]`, or `[x, y, phase]` when upstream gives a non-zero phase (one point at the pin;
  a phase of 0 is dropped, as QuestieDB's read contract drops it), or exactly `[-1, -1]` (1,282 rows
  among the shipped spawns). A partial sentinel fails closed.
- `infra/data` turns every published point into a `PublishedPoint` (`src/domain/dataset.ts`,
  `points.ts`) once at load, and converts it to a `WorldPoint` where the committed placeholder
  geometry allows, through `src/geo` (ARCHITECTURE §5.2, §6). The same rules apply to spawns,
  event points and objective-hint points; `zones.json` `areas` gives the link for each AreaId:
  - `link: "direct"`, `"routed"` or `"synthetic-alias"`: a zone-space `SourcedPoint` on that UiMap
    (frame `forever`, lexemes null), read in the mapped UiMap's frame as Questie reads it; its world
    point is null while the geometry lacks that frame. Only a `direct` AreaId defines a coordinate
    frame (research/coordinates.md §13.2): a `routed` subzone borrows its parent's. None of the
    76,300 drawable points at the pin uses a `routed` key (76,294 are on `direct` AreaIds, 6 on
    synthetic aliases), and `validate` fails if one appears, so a pin bump that ships one is reviewed
    (*added after the review*, COORD-3);
  - `[-1, -1]` is instance **presence**, never a point: `InstancePresence { kind: 'instance', areaId }`,
    resolved through `zones.json` `instanceAreas` to the dungeon entrance (the faction-dependent ones
    in `overlays.json`) when one exists, and otherwise unresolved;
  - `link: "suppressed"` (UiMap 0: AreaIds 0, 2257, 2917, 2918): `UnmappedAreaPoint` reason
    `suppressed`; `link: "legacy-compat"`: reason `instance-area` (every such AreaId is a
    `dungeons.lua` key or alternative id, which the extractor checks); an AreaId absent from `areas`:
    reason `no-uimap` (none of the 91 spawn keys at the pin).

  Nothing is guessed: an unmapped or unresolved point is kept with its reason, and travel to it
  is unknown, never zero (ARCHITECTURE §6).
- The six points on synthetic continent aliases (10073 → 1414, 10074 → 1415, 10089 → 947), which
  QuestieDB itself leaves unconverted, can be resolved without a frame error: the 1414 and 1415
  `UiMapAssignment` rows are byte-identical at 1.15.9.69722 and 1.60.1.70009, and 947 changed only
  its OrderIndex, so the Era frame they were written in is the Forever frame. This is a statement
  about the frame, not a claim that the points are placed accurately (§11).
- *Superseded (D-017):* D-004's "dataset spawns are stored as WorldPoint" no longer applies to
  dataset rows.
- Faction-dependent spawns (NPC and object `LoadFactionFixes`: 9 each at the pin) are in
  `overlays.json` as whole replacement PointMaps (§6.7). Waypoints do not ship.
- Size: 1,171 KB JSON, 360 KB gzip (level 6) for 6,780 entities; the critique's scratch estimate was
  1,100 KB / 353 KB gzip -9 (PERF-2).

### 6.6 `zones.json`

```json
{ "_generated": { "...": "§7" },
  "areas":  { "14": { "uiMapId": 1411, "link": "direct" }, "363": { "uiMapId": 1411, "link": "routed" }, "209": { "uiMapId": 310, "link": "legacy-compat" } },
  "uiMaps": { "1411": { "name": "Durotar", "nameSource": "questiedb:support/Forever/Zones/uiMapIdToAreaId.lua:63", "areaId": 14 } },
  "dungeons": { "209": { "name": "Shadowfang Keep", "alternativeAreaIds": [10014], "parentZoneAreaId": 130, "entrances": [{ "areaId": 130, "x": 44.8, "y": 67.8, "frameVerified": true }] } },
  "instanceAreas": { "10000": { "dungeonAreaId": 2100 } } }
```

- **`areas`: AreaID → UiMapID** from `areaIdToUiMapId.lua` (1,064 base rows, 47 override rows;
  1,111 AreaIds), override winning. Every override row is classified and an unclassifiable one fails:
  `0` → `suppressed` (kept, 4 AreaIds); a legacy dungeon compatibility pair → `legacy-compat` (40 at
  the pin; not native Forever maps, `docs/forever-data.md:194-201`); a synthetic continent/world alias
  (10073 → 1414 Kalimdor, 10074 → 1415 Eastern Kingdoms, 10089 → 947 Azeroth) → `synthetic-alias`.
  Base rows are `direct` when the AreaId is the UiMap's own AreaId in `uiMapIdToAreaId` (the
  `UiMapAssignment` AreaID that defines the frame; 54 at the pin, each cross-checked against the
  frames of `conversion.json` `geometry.transforms`, and a mismatch fails the extraction) and
  `routed` otherwise (a subzone routed to its parent zone's UiMap, such as 363 Valley of Trials →
  1411; 1,010 at the pin). *Changed after the review (COORD-3):* revision 1 of the tool called every
  base row `native`.
- **`uiMaps`: names (LIC-13)**, from the trailing comments of `uiMapIdToAreaId.lua` (54 canonical
  rows; the override adds the three continents), `lib/zones.ts`. Rules as built:
  1. The file runs in the support environment; each deferred string `[[return {...}]]` is parsed again
     as a Lua chunk with comments and locations. Every row must be `[number] = number` alone on its
     line; anything else fails.
  2. A name is the `--` comment on the same line as the row, after it, trimmed. Comments on their
     own lines are never names.
  3. A row of the override block whose AreaId is instance-type (a `dungeons.lua` key or alternative
     id) is a legacy compatibility row and carries no name; its comment must be exactly "Referenced
     dungeon area" (27 rows at the pin) or "Referenced synthetic dungeon alias" (13 rows), and the
     same pair must appear in `areaIdToUiMapId`'s override with the same kind of comment; anything else
     fails.
  4. Every other main or override row gets exactly one non-empty name, or the extraction fails. A
     UiMap that a direct, routed or alias link reaches but no row names gets `name: null` and `nameSource:
     null` (none at the pin). *Changed in Milestone 2:* UiMaps 1463, 1464 and 2665 appear in neither
     QuestieDB table, so `zones.json` does not list them at all; they exist only in the placeholder
     geometry, and a loader gives such UiMaps `name: null`. At the pin: 57 named UiMaps, 0 unnamed.
  5. The names are checked against a self-authored expected list
     (`tools/questiedb/lib/expected-zone-names.ts`, 57 names) by `validate`, so a name that
     disappears or changes at a pin bump fails loudly. The 50 RXP zone keys of Milestone 0 are all in
     it (RXP.md §15.3); RXP's table is not used. Localised names are not shipped.
  6. Each name records `nameSource: "questiedb:support/Forever/Zones/uiMapIdToAreaId.lua:<line>"`.
     `areaId` is the UiMap's canonical AreaId from the same row.

  Caveat: the file says it was completed by hand and that regenerating it upstream overwrites the
  additions, so names can disappear at a pin bump; rules 4 and 5 make the extraction or `validate`
  fail loudly then.
- **`dungeons`** from `dungeons.lua` (`[areaId] = {name, alternativeAreaIds?, parentZone,
  entrances}`), evaluated once as Alliance and once as Horde (it calls `UnitFactionGroup` at load).
  Entries equal under both (122 at the pin) are here as `{ "name", "alternativeAreaIds" ([] when
  absent), "parentZoneAreaId", "entrances": [{ "areaId", "x", "y", "frameVerified" }] }`; entries
  that differ (the battleground entrances 2597, 3277, 3358) are in `overlays.json` by faction.
  Dungeon names are Blizzard game content.
- **`frameVerified`** (*added after the review*, COORD-4) is `false` for the three entrances that
  QuestieDB's own audit lists as not eligible for the Era transform and leaves unverified
  (`docs/forever-coordinate-audit.md` at the pin, "Entrances not eligible for the Era transform"):
  Darkmoon Faire Island 5861 at Mulgore 36.85, 35.86; Bizmo's Brawlpub 6618 at Stormwind 69.49, 31.2;
  and Stratholme Gauntlet 10001 at Eastern Plaguelands 43.5, 19.4. All three are on changed frames,
  so their frame is unknown. The list is a self-authored transcription (`FRAME_UNVERIFIED_ENTRANCES`
  in `lib/zones.ts`, hash-pinned to the audit, §4.1.2); each entry must match exactly one entrance,
  or the extraction fails. Every other entrance is `true`. A loader leaves presence behind such an
  entrance unresolved (gap `entrance-frame-unverified`), and the TravelGraph must not seed an edge
  from it. At the pin no presence point reaches these three.
- **`instanceAreas`**: every AreaId used as a `[-1, -1]` presence key in the shipped points (spawns,
  event and hint points, overlay spawns), with `dungeonAreaId`: the `dungeons.lua` key itself, else the
  entry that lists it as an alternative id, else null. *Changed in Milestone 2 (measured):* 41 AreaIds
  at the pin, all resolvable (the Milestone 0 count of 29 was over raw rows; corrections add presence
  under synthetic dungeon aliases such as 10000 and under 2257 and 3358). The same entrances seed the
  TravelGraph's instance entrance edges (ARCHITECTURE §9.1).
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
  "faction": { "Alliance": { "quests": { "687": { "starters": [{ "kind": "npc", "id": 2786 }] } },
                             "npcs": { "5676": { "zoneId": 1519, "spawns": { "1519": [[39.09, 84.37]] } } },
                             "objects": {}, "items": {}, "dungeons": { "2597": { "...": "a whole DungeonRow" } } },
               "Horde":    { "...": "same shape" } },
  "class":   { "Alliance": { "WARRIOR": { "quests": { "8315": { "prerequisites": { "...": "whole field" } } } }, "...": "all nine" },
               "Horde":    { "...": "same shape" } } }
```

*Changed in Milestone 2:* built with two refinements of the revision-2 sketch. (1) A patch holds
**projected, shipped** top-level fields, not upstream field indices: each dynamic layer is applied to
the composed row as `recompose` would, the result is projected, and every top-level record field
whose value changed is written whole (`prerequisites` is always a complete object, and so on). NPC and
object patches may also hold `spawns`, a whole PointMap replacing the entity's `spawns.json` entry. A
patch never holds `id` or `provenance`; a dynamic write that changes no shipped field produces no
patch. (2) **The class layer is nested under the faction**, because the class-dependent values differ
per faction: Alliance varies quests 8315, 8977, 8997 and 9015 by class, Horde varies 8315, 8978,
8998 and 9015, and a class absent from one faction's table (for example `SHAMAN` for 8977) leaves the
field to the faction layer. The nine Era class tokens (`CLASS_TOKENS` in `lib/overlays.ts`,
self-authored; a Forever-only class would have to be added) are all listed, with empty `quests` where
nothing varies.

`DatasetView` applies them on top of the static records from the project character (ARCHITECTURE
§5.1): **static record → `faction[F]` → `class[F][C]`**, each a shallow top-level merge;
nothing is baked into one persona. Per faction, the values that are identical for every class form the
faction layer; only values that vary by class are in the class layer. Sources at the pin:
`LoadFactionFixes` (quests 83 per faction, of which 79 give patches; NPCs 9, objects 9, items 5),
the class-dependent quests above, and the three faction-dependent `dungeons.lua` entrances.
`forever*Fixes.LoadDynamic` is empty. Every patched entity ships (patches for unshipped entities
would be dropped and listed in the report; none at the pin).

### 6.8 Size

Measured at the pin (`docs/measurements/data-m2.json`: each file compressed on its own; gzip level 6
is the dist audit's measure and the basis of the baselines in `tools/build/dist-requirements.json`):

| File | JSON | gzip -6 | gzip -9 |
| --- | ---: | ---: | ---: |
| `quests.json` | 4,916 KB | 316 KB | 304 KB |
| `spawns.json` | 1,171 KB | 360 KB | 358 KB |
| `entities.json` | 1,966 KB | 157 KB | 150 KB |
| `items.json` | 808 KB | 81 KB | 79 KB |
| `zones.json` | 73 KB | 10 KB | 9 KB |
| `overlays.json` | 38 KB | 3 KB | 3 KB |
| `manifest.json` | 34 KB | 9 KB | 9 KB |
| `NOTICE.md` | 4 KB | 2 KB | 2 KB |
| **Total** | **9,011 KB** | **939 KB** | **914 KB** |

The total is within the ARCHITECTURE §14 budget (1.2 MB gzip; each file within its baseline + 10%)
and close to revision 2's estimate of about 905 KB. The raw size is large because every key is
present on every record (explicit nulls); gzip removes most of that. In Node, `JSON.parse` of the
three large files takes about 18, 15 and 7 ms on the development machine (a guide only; the browser
budget is measured later). The fixture slice is 231 KB raw, 34 KB gzip. *Re-measured after the
review fixes*, which added the `frameVerified` flags, the published `itemStartFixesOnly` ids and
longer notices (about +10 KB raw, +2 KB gzip); the baselines in `tools/build/dist-requirements.json`
come from the same run. *Superseded:* the revision-2 estimates of this section.

---

## 7. Marking of generated artifacts

**Scope** (LIC-11): every Questie-derived artifact in the repository, which is
`public/data/**`, `public/maps/placeholder/**` and `tests/fixtures/data/**` (the Forever slice
the extractor generates for tests; ARCHITECTURE §15).

1. No file in a marked directory is edited by hand. Two checks enforce this, and they prove
   different things. `validate` proves **internal consistency**: it recomputes every output hash and
   fails on a difference from the record that describes the directory (`public/data/manifest.json`,
   §8; `tests/fixtures/data/manifest.json`, written by the extractor in the same format with its own
   `dataRevision`; and, for the placeholder geometry, the per-row sources and hashes that
   `tools/maps/validate.ts` checks, [MAPS.md](MAPS.md)). It cannot detect a hand edit whose hashes,
   byte counts and `dataRevision` were recomputed as well. Only `pnpm data:extract --check`, which
   needs the QuestieDB clone, proves that the files **equal a fresh extraction** (§5). *Reworded after
   the review (data-F3):* this item said `validate` alone enforced it.
2. Each marked directory has a `NOTICE.md` (`lib/notice.ts`). `public/data/NOTICE.md` states:
   - generated from Questie/QuestieDB at commit `<40-char sha>` (with its date) by
     `tools/questiedb`; "do not edit; regenerate with `pnpm data:extract`";
   - the licence finding, neutrally (§3.1), rendered from `upstream.json` `licenceCheck` (so a pin
     bump updates it), and the owner's posture ("Treating Questie-derived data under that licence is
     a posture, not a legal conclusion; it grants no rights that upstream has not granted", §3.2) and
     carve-out, verbatim;
   - the upstream authorship line (§2, read from `generate.lua`) and the declared origins (§8.2),
     including Blizzard game content, client-derived values, `itemStartFixes`' declared Wowhead
     origin and the values this tool derives;
   - that the data is the Era baseline and every record is `foreverStatus: "unknown"`;
   - non-affiliation with Blizzard Entertainment and the Questie project;
   - pointers to `manifest.json` and to this file by its repository URL
     (`https://github.com/laurencestokes/forever-route-lab/blob/main/docs/DATA_PROVENANCE.md`),
     which a reader of the deployed site can follow (data-F15).

   It contains no `dataRevision`, tool hash or timestamp, so it is itself hashed into the
   `dataRevision` (§8.3). `public/maps/placeholder/NOTICE.md` says the same for its 49
   QuestieDB-derived frames and cites the 12 DB2 rows (THIRD_PARTY_NOTICES.md, "Map geometry").
   `tests/fixtures/data/NOTICE.md` repeats the `public/data` notice, names the pin, and describes the
   slice (§7.1).
3. **`_generated`.** Every generated JSON file is a top-level **object** whose first key is
   `"_generated"`. A payload that is naturally an array is written as
   `{ "_generated": { ... }, "rows": [ ... ] }`, and loaders read `rows`; no marked file has an
   array at the top level. For `public/data` and the fixture slice:

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
4. `.gitattributes` marks `public/data/**` and `public/maps/placeholder/*.json` as
   `linguist-generated=true -diff`. It also marks `tests/fixtures/data/**` `linguist-generated=true
   -diff`; revision 2 said the fixtures would drop `-diff` to stay reviewable. *Planned:* that
   `.gitattributes` change (not made in Milestone 2; `pnpm data:diff` summarises changes meanwhile).
5. THIRD_PARTY_NOTICES.md lists these directories and points here.
6. Committing `public/data/` follows D-002; raw upstream Lua is never committed.

### 7.1 The fixture slice (`tests/fixtures/data/`)

The same seven files, cut from the full dataset by `lib/slice.ts` (so consistent with it by
construction) and written by every `pnpm data:extract` (`--slice` writes only it). Region: Durotar,
UiMap 1411, and its subzones (the AreaIds linking to 1411 directly or as routed subzones, the Valley
of Trials among them).
Quests: those whose NPC or object starters or finishers have a spawn point in the region (96 at the
pin). Entities: everything those quests reference, under the overlays too (starters, finishers,
objective targets, hint refs, source items, item containers and drop sources), the NPCs and objects
whose `questStarts`/`questEnds` name a sliced quest, the items that start one, and the flight masters,
innkeepers and trainers spawning in the region (149 NPCs, 13 objects, 56 items). Records and spawns
are complete; an entity's `questStarts`/`questEnds` may name quests outside the slice (so `validate`
skips entity→quest integrity and the golden shipped counts for it). `zones.json` keeps the areas,
UiMaps, instance areas and dungeons the slice uses; overlays keep the sliced entities' patches. The
manifest has the same format plus a `slice` object (region, AreaIds, rule). Its counts describe the
slice, except `raw` and `composed`, which describe the upstream composition it was cut from (and are
golden-checked); the counts only the whole extraction can state (`createdByCorrection`,
`npcSelection`, `dungeonQuestAreas`, `derivedRequiredRaces`, `unresolvedReferences`) are `null`
(*changed after the review*, data-F16). 231 KB raw.

---

## 8. Manifest: `public/data/manifest.json`

The **single authoritative manifest** (LIC-09, D-026). ARCHITECTURE §5.2 references it and does
not restate it. It is written last, after every other output, and is not listed in its own
`outputs`. Where the manifest and the extraction report (§8.4) disagree, the manifest wins. It is
pretty-printed JSON (two-space indent) with the keys in the order below.

### 8.1 Fields

| Field | Type | Meaning |
| --- | --- | --- |
| `_generated` | object | As §7, item 3 (first key) |
| `schemaVersion` | integer | Version of this manifest format (1) |
| `dataRevision` | string | Content-addressed identifier of the dataset (§8.3). Saved in projects as `ProjectV1.dataRevision`; a change triggers the drift check (ARCHITECTURE §5.5, §8.2). `65c377bccf19f41759780b0d3052e1f972e317135d17ae763edd13b768866ab6` at the pin |
| `dataset` | string | `"questiedb-forever"` |
| `flavour` | string | `"Forever"` (upstream flavour name) |
| `slice` | object | Fixture manifest only: `{ "uiMapId", "label", "areaIds", "rule" }` (§7.1) |
| `upstream` | object | `{ "repository": "https://github.com/Questie/QuestieDB", "branchObserved": "master", "commit": "<40 hex>", "commitDate": "2026-09-23T14:13:50+02:00" }` (commit date from git, `%cI`) |
| `licence` | object | `{ "upstreamLicenceFile": null, "checked": "2026-09-25", "finding": "no root licence file (none covering Questie's own code or data) on the default branch of Questie/QuestieDB or Questie/Questie, full-history check (docs/DATA_PROVENANCE.md §3.1)", "projectLicence": "GPL-3.0-or-later", "scope": "<the §3.2 carve-out, verbatim>", "notice": "NOTICE.md" }`, rendered from `upstream.json` `licenceCheck` (data-F9). Not a legal conclusion |
| `sourceGameBuilds` | object | `{ "dbcTarget": "1.60.1.69893", "conversionSource": "1.15.9.69722", "uiSourceResearched": "1.60.1.69913", "tocInterface": 16001 }`, read from upstream files, not typed by hand (`dbcTarget`/`conversionSource` from `conversion.json.geometry`, `tocInterface` from `config.flavors`, `uiSourceResearched` from `docs/forever.md:140-142`). The local client build is never recorded here: the extractor does not read a client (§10) |
| `toolTreeHash` | object | `{ "tree": "<git tree id of tools/questiedb/>", "lockfile": "<SHA-256 of the lockfile entries the tool runs with>" }`. `tree` is the tree id git records for the directory: with a temporary index, `git add -A -- tools/questiedb && git write-tree --prefix=tools/questiedb/` (`lib/git.ts` `workingTreeId`). In a copy without `.git` (a source archive) the same id is computed in-process (`lib/git-tree.ts`: `.gitignore` rules, `.gitattributes` text handling with git's `text=auto` heuristic, CRLF → LF, blob and tree hashing; a test checks it equals git's on this repository; data-F7), and the report records which way it was computed. It equals `git rev-parse <commit>:tools/questiedb` for the commit that contains the regenerated dataset, and it is the same on every OS because text files are LF-normalised (`.gitattributes`). `lockfile` hashes only the `pnpm-lock.yaml` entries of `luaparse`, `tsx` and `zod` (importer specifier and version, `packages:` and `snapshots:` entries) and the lockfile version, so an unrelated dependency change does not invalidate the dataset (data-F6). `validate` fails when it differs from the checkout, so a tool change and its regenerated dataset land in the same commit. `tools/questiedb` makes no value imports from outside itself except npm packages covered by the lockfile (`luaparse`, `zod`); its `import type` of `src/domain` is erased |
| `runtime` | object | `{ "luaparse": "0.3.1" }` (the luaparse version from the lockfile). *Changed after the review (data-F5):* the Node major version moved to the report; the output bytes do not depend on it (ECMAScript defines the shortest round-trip number format), and recording it made `extract --check` fail on another allowed Node major |
| `inputs` | array | `{ "path", "sha256" (LF blob), "gitBlob", "bytes", "role" }` for all 58 inputs of `upstream.json` (§4.1, §4.1.1 and §4.1.2; `role` `"data"`, `"correction"`, `"schema"`, `"support"`, `"semantics"` or `"provenance-only"`) |
| `upstreamManifestCheck` | object | `{ "conversionFiles": [{ "output", "outputSha256Matches", "source", "sourceSha256Matches" }] (all ten), "zoneSymbolsSha256Matches", "provenanceJson": { "dbcReportBuild", "matchesDbcTarget", "upstreamSeedCommit", "coordinateToolBase" }, "allMatch": true }`. Extraction fails unless everything matches |
| `layers` | array | Applied providers per datatype in order, then `"derived:requiredRaces:questieCompatibility"`, then the five hint sets, e.g. `"legacy/itemStartFixes.lua:LoadAutomaticQuestStarts(noNewEntries,noOverwrites)"`, `"hints:itemObjectiveFirst=[503,5088]"` |
| `dynamicLayers` | array | `[{ "key": "faction:Alliance", "file": "overlays.json", "providers": [...], "dungeons": "support/Forever/Zones/dungeons.lua (UnitFactionGroup)" }, { "key": "faction:Horde", ... }, { "key": "class", "file": "overlays.json", "providers": [...], "classes": [nine tokens], "appliedAfter": "faction" }]` |
| `outputs` | array | `{ "path", "sha256", "bytes", "records", "origins" }` for every file of the directory except `manifest.json`: the six JSON files and `NOTICE.md`, sorted by path. `records` is the number of rows, map entries or patches (null for `NOTICE.md`); `origins` as §8.2 |
| `counts` | object | `raw`, `composed` and `shipped` `{ quests, npcs, objects, items }`; `spawnEntities`; `spawnPoints` (drawable, instance presence); `createdByCorrection`; `npcSelection` (quest-referenced, per flag, flag-only; null in the slice); `questsWithNullLevel`, `questsWithNullXp`, `dungeonQuests`, `dungeonQuestAreas` (null in the slice), `itemStartFixesOnly`, `derivedRequiredRaces` (null in the slice); `uiMaps` (named, unnamed); `areas`; `unresolvedReferences` (0; null in the slice). `createdByCorrection` is null in the slice as well (§7.1) |
| `provenance` | object | `comparisonBasis` (§9.3), `upstreamDiff` per type and tag, `taggedByPersonaLayers` per type, `corrected` and `created` per type (all over the shipped records), `forkBase` (flavour, data files, layers; §4.1.1), `itemStartFixesOnly` (the ids of the shipped items whose `startsQuest` was last written by `itemStartFixes`, declared Wowhead-generated; OD-7), and `threeWayClassifier: "stub"` (§9.4) |
| `foreverContentVerified` | boolean | `false`. Top level, as ARCHITECTURE §5.2 states. Stays false until records are validated against the Forever game by some other means |

Values at the pin: raw 4,244 / 10,119 / 6,645 / 14,889; composed 4,257 / 10,122 / 6,666 / 14,899;
shipped 4,257 / 6,003 / 952 / 2,962 (quests / NPCs / objects / items).

*Superseded (LIC-09, D-026):* revision 1's flat `repository`, `commitSha`, `commitDate` and
`licenseFile` fields are grouped under `upstream` and `licence`; `licenceTreatment` became
`licence`; `toolVersion` and `toolCommit` are replaced by `toolTreeHash` (a commit cannot name the
commit that contains it, so `toolCommit` was always the parent or "dirty"); `extractedAt` moved to
the report (§8.4); `foreverContentVerified` moved from `provenance` to the top level. D-026
supersedes D-002's list of manifest contents (which named an extraction timestamp and a tool
version), and D-016 supersedes its "GPL notices" wording; D-002's decision to commit the dataset
stands.

### 8.2 Origins (LIC-11)

Each output lists the declared origin of its content (`lib/manifest.ts` `ORIGINS`), so `NOTICE.md`
and the About dialog can render them. Vocabulary: `questiedb` (Questie/QuestieDB contributors' data:
IDs, relations, levels, flags, corrections), `blizzard-game-content` (text and names from the game,
via QuestieDB), `blizzard-client-derived` (values derived from client DBC/DB2 exports, via QuestieDB),
`declared:<source>` (a third-party origin that upstream declares), `blizzard-game-content or
questiedb-authored (not distinguished)` (text that is Blizzard's in raw rows but that corrections also
write), and `derived by forever-route-lab from questiedb` (values this tool computes from QuestieDB
data with its own, documented rules). *Changed after the review (data-F10):* objective labels and
event text were labelled `blizzard-game-content` alone, and `dungeonQuest` `questiedb`.

| Output | Fields | Origin | Evidence |
| --- | --- | --- | --- |
| `quests.json` | structure, levels, flags, relations, requirements | `questiedb` | §4.1 |
| `quests.json` | `dungeonQuest` | `derived by forever-route-lab from questiedb` | `dungeons.lua`; `lib/dungeon-areas.ts` (§6.2) |
| `quests.json` | `name`, `objectivesText` | `blizzard-game-content` | §3.1 item 5 |
| `quests.json` | objective labels and event text | `blizzard-game-content or questiedb-authored (not distinguished)` | raw rows; `classicQuestFixes.lua` writes them too (for example quest 667's event text) |
| `quests.json` | event and hint points | `questiedb`; Era→Forever projection `blizzard-client-derived` | `conversion.json` |
| `quests.json` | `objectiveHints[].text` | `questiedb` | `extraObjectives` are authored in the corrections |
| `quests.json` | `xp` | `questiedb` (Era seed; value origin not declared) | `xpDB-classic.lua:1`; `docs/forever-data.md:70` |
| `entities.json` | `name`, `subName` | `blizzard-game-content` | |
| `entities.json` | other fields | `questiedb` | |
| `items.json` | `name` | `blizzard-game-content` | |
| `items.json` | `startsQuest` of the items listed in manifest `provenance.itemStartFixesOnly` | `declared:wowhead-generated via questiedb:itemStartFixes` | `itemStartFixes.lua:13` |
| `items.json` | drop sources, `startsQuest` otherwise, `itemClass` | `questiedb` (no third-party origin declared; the declared Wowhead/CMaNGOS drop percentages are not shipped) | `classicItemDrops.lua:7,17806` |
| `spawns.json` | Forever-frame coordinates | `questiedb`, Era→Forever projection `blizzard-client-derived` (1.15.9.69722 → 1.60.1.69893) | `conversion.json` |
| `zones.json` | `areas[].uiMapId` | `blizzard-client-derived` (1.60.1.69893, hand-completed upstream) | `areaIdToUiMapId.lua:1-4` |
| `zones.json` | `areas[].link` | `derived by forever-route-lab from questiedb` | `lib/zones.ts` (§6.6) |
| `zones.json` | UiMap and dungeon names | `blizzard-game-content` (from comments of a hand-completed file; `dungeons.lua`) | §6.6 |
| `zones.json`, `overlays.json` | entrances, alternative ids, instance areas, dynamic values | `questiedb` | |
| `zones.json` | `dungeons[].entrances[].frameVerified` | `derived by forever-route-lab from questiedb` | QuestieDB `docs/forever-coordinate-audit.md`; `lib/zones.ts` (§6.6) |

Each entry is `{ "fields": [...], "origin": "...", "evidence": "<upstream path:line>" }`.
`NOTICE.md` has no origins entries.

### 8.3 `dataRevision` and reproducibility

```
lines        = for each output sorted by path (UTF-8 byte order): path + "\t" + sha256 + "\n"
dataRevision = lowercase hex SHA-256 of the UTF-8 concatenation of lines
```

- `sha256` is of the file bytes as written (UTF-8, LF, no BOM). Paths containing tabs or newlines
  are rejected.
- The `dataRevision` depends only on what the tool emits, so it changes exactly when shipped
  content changes. A tool change with identical output changes `toolTreeHash`, which is a
  manifest-only change, and projects see no drift.
- **Reproducibility contract:** the same pin and `toolTreeHash` produce byte-identical
  `public/data/**` and fixture slice, including `manifest.json`, on any OS and any supported Node
  version (nothing in the output depends on the Node version; *changed after the review*, data-F5). The
  serialiser (`lib/json.ts`) is deterministic: `_generated` first; record keys in a fixed order (the
  domain record order); id maps and PointMaps in ascending numeric order; lists in upstream order
  unless §6 says otherwise; numbers in ECMAScript shortest round-trip form; one record per line; LF;
  final newline; no timestamps anywhere except the report. `extract.test.ts` runs the extraction twice
  and compares bytes, and compares both with the committed files; `pnpm data:extract --check` is the
  CI form of the same check (§5). Because `validate` requires `toolTreeHash` to equal the checkout,
  every `tools/questiedb` change lands in the same commit as its regenerated dataset.

### 8.4 Extraction report (not shipped, gitignored): `generated/questiedb-report.json`

A superset of the manifest for review, keyed by the same `dataRevision` (and the slice's):
`extractedAt` (ISO 8601 UTC), the full Node version, its major version and the platform, how
`toolTreeHash.tree` was computed (`git` or `in-process`), timings (per phase, and the CLI's
reading and total times), lints (duplicate table keys; none at the pin), coverage (objective kinds,
quests without starters or finishers, null levels and XP, entities without spawns), per-provider
write counts by field (and ignored keys, ids skipped by `noNewEntries`), the quests the derived pass
changed, the `dungeonQuest` AreaID set, the `itemStartFixesOnly` item list (also in the manifest),
the zone-table and name validation results (with the direct and routed link counts), the NPC selection counts, unresolved references (none at the pin), dynamic entry
counts per provider and faction and any dropped overlay ids, provenance over all composed records
(tags, the ids tagged by persona layers, converted pairs, corrected), the slice region, and warnings.
It lives outside `public/` and never reaches `dist/`. It is **gitignored** (the
`generated/questiedb-report.json` entry in `.gitignore`; ARCHITECTURE §4, §5.2; D-026), so it is
never committed and a fresh extraction never dirties the tree. It is a review aid only: the
manifest (§8.1) is authoritative, and neither the app nor any `validate` check reads the report.
It is the only extraction output allowed to differ between runs of identical inputs, and it is
never an input to any hash.

---

## 9. Era vs Forever provenance classification

### 9.1 Result at the pin

The Milestone 0 experiment compared **raw** rows:

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

The extractor (Milestone 2) compares **composed** rows and their persona layers (§9.3):

| Type | Composed | `era` | `era-coords` | `forever-new` | `forever-changed` | Shipped `era` / `era-coords` |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| Quest | 4,257 | 4,245 | 12 | 0 | 0 | 4,245 / 12 |
| NPC | 10,122 | 9,381 | 741 (3 only through faction layers) | 0 | 0 | 5,538 / 465 |
| Object | 6,666 | 6,059 | 607 (1 only through a faction layer) | 0 | 0 | 879 / 73 |
| Item | 14,899 | 14,899 | 0 | 0 | 0 | 2,962 / 0 |

These equal the composed differences QuestieDB records between its Vanilla and Forever Goldens
(12 quests, 741 NPCs, 607 objects, 0 items; `docs/forever-validation.md:47-49` in QuestieDB), and
every differing pair is again exactly the projection.

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
| `upstreamDiff` | `era` | The record is identical to the fork-base (Era) record | extractor (fact about QuestieDB) |
| | `era-coords` | Differs from the fork base only by the documented coordinate projection (re-projecting the Era value with `conversion.json` coefficients and 2 dp half-away rounding, QuestieDB `tools/dbc/convert.py` `round_coordinate`, gives exactly the Forever value) | extractor |
| | `forever-new` | ID absent from the fork base (none at this pin) | extractor |
| | `forever-changed` | Any other difference from the fork base (none at this pin) | extractor |
| `foreverStatus` | `unknown` | Nobody has verified this record against the Forever game. **Every dataset record ships with this value** | extractor |
| | `user-declared-new`, `user-declared-changed` | A claim the user makes in a project (ARCHITECTURE §5.5, §12.4) | the app, never the extractor |
| `corrected` | boolean | A static correction changed at least one shipped field: the record projected from its raw row differs from the record projected from its statically corrected row (before the derived pass; spawns included). Always true for a created record. 3,168 quests, 833 NPCs, 126 objects, 502 items among the shipped records | extractor |
| `created` | boolean | The record was created by a correction (47 composed at this pin: 13 quests, 3 NPCs, 21 objects, 10 items; shipped 13 / 3 / 19 / 9) | extractor |
| `source` | `questiedb`, `custom` | Dataset record or user custom quest | extractor / app |

*Changed in Milestone 2:* revision 2 compared raw rows (and, for a created record, its creating
correction). The extractor instead compares each record's **composed static row** (raw + static
corrections + requiredRaces) with the fork base composed the same way (§4.1.1), and each of its
faction × class **persona rows** (the static row with that persona's dynamic layers applied) with the
fork base's persona row; the most severe tag wins (`forever-new` > `forever-changed` > `era-coords` >
`era`). This covers created records uniformly, and records whose Forever coordinates come only from a
converted correction (3 NPCs and 1 object only through faction layers), and it reproduces upstream's
own composed Golden differences (§9.1). The manifest's `provenance.comparisonBasis` states it.

*Superseded by D-026:* D-007's `forever: 'unknown'` with `basis: 'era-baseline-copy'`,
ARCHITECTURE revision 1's `forever: 'inherited' | 'new-in-forever' | 'modified-in-forever' |
'unknown'`, and this file's revision 1 tags `+corrected` / `+created` are all replaced by the
table above (critique F15, ARCHITECTURE §5.3, `RecordProvenance` in `src/domain/dataset.ts`).
D-007's principle stands: no dataset record claims a Forever verification nobody has done.

### 9.4 `diff.ts` scope (F23)

1. **The pin-to-pin dataset diff** that §12 needs (`lib/diff-lib.ts`).
   `pnpm data:diff --from <source> [--to <source>] [--json <file>]`, where a source is a data
   directory, a `manifest.json` (hashes and counts only) or `git:<rev>` (this repository's
   `public/data` at that revision; `--to` defaults to `public/data`). It reports changed outputs, the
   `dataRevision` and upstream commit, added and removed IDs per type, per-record changed top-level
   fields, `upstreamDiff` and `corrected` changes, spawn, zone and overlay changes, and count deltas.
   Its text summary goes into the pin-bump commit message.
2. **`upstreamDiff` tagging** is the two-way comparison with the fork base of §9.3, run during
   extraction.
3. **Three-way classifier** (fork base, current Era, current Forever; it attributes a change to
   the Era side or the Forever side): a **stub**, `classifyThreeWay`, that returns `unknown` for every
   record, recorded as `provenance.threeWayClassifier: "stub"`. No record field depends on it.
   *Planned:* implement it when §9.1 first shows a non-zero `forever-new` or `forever-changed` count.
   *Superseded by D-026:* D-007 said `diff.ts` implements the three-way classification; critique F23
   deferred it, and D-026 records the pin-to-pin diff first and the classifier as a stub.

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
| Zone names come from comments in a hand-completed upstream file | They can vanish at a pin bump; the extraction or `validate` fails loudly (§6.6 rules 4-5) |
| The whitelisted evaluator covers only the constructs at this pin | A new construct upstream stops the extraction with its file and line; extend the whitelist deliberately, with a test (D-009) |
| Some items start quests the dataset lacks (3 at the pin) | They are not selected by that link (§6.4) and none ships; if a future pin references one otherwise, `validate` reports the dangling quest id for review rather than dropping or inventing anything |
| Six synthetic continent/world points and three later-expansion dungeon entrances are unverified upstream | The six points are frame-safe (§6.5) but low-confidence placements. The three entrances ship with `frameVerified: false` (§6.6); a loader leaves presence behind them unresolved |
| Parent-routed subzone AreaIds define no frame of their own | None carries a drawable point at the pin; `validate` fails when one appears (§6.5) |
| QuestXP is an Era seed; 763 composed quests have no row (750 raw + 13 created by corrections) | XP is `era-seed` and null where missing (unknown, never 0) until measured for Forever |
| Consumer policy (unobtainable or hidden quests) lives in Questie, not QuestieDB | Needs a separate decision and input record |
| Upstream CBOR/TOC storage and generator internals are not a public contract | We depend only on the owned Lua source format, which upstream validates against its schema |

## 12. Updating the pin

1. Choose a new upstream commit; read its `docs/forever*.md` changes.
2. Re-run the licence check (§3.1 items 1-3) in full-history clones, including the state of
   Questie's `license` branch, and record its date and result in `upstream.json` `licenceCheck`
   (`NOTICE.md` and the manifest are rendered from it); if anything changed, follow §3.2 "Change
   triggers".
3. `pnpm data:fetch --commit <sha>` fetches the commit and prints its input hashes; after reviewing
   the upstream changes, update `tools/questiedb/upstream.json` (commit, input hashes, and `golden`
   if upstream's counts changed). For every transcribed file whose hash changed (§4.1.2), review the
   upstream change against its transcription and update the module's `TRANSCRIBES` reference; the
   extraction refuses to run until then. Review any new `dungeons.lua` key (`lib/dungeon-areas.ts`)
   and the coordinate audit's entrance list (`lib/zones.ts`). Then `pnpm data:fetch` and
   `pnpm data:extract` (which also regenerates the fixture slice).
4. `pnpm data:validate` must pass (update `golden.shipped` and, if names changed deliberately,
   `lib/expected-zone-names.ts`, after review). Review `pnpm data:diff --from git:HEAD` (IDs,
   `upstreamDiff` tags, field changes, counts, zone names). If §9.1 shows Forever-only or
   Forever-changed rows, implement the three-way classifier (§9.4) before merging.
5. Update §2, §3.1 (if licence facts changed), §4.1, §6.8 (sizes), §8 (example counts) and §10
   of this file, the pin in `tools/questiedb/upstream.json` (ARCHITECTURE §4), the regenerated
   `public/data/**` and fixture slice, and `NOTICE.md` if its content changes, all in the same
   commit, with the diff summary in the commit message. CI then re-extracts from the new pin and
   must reproduce the committed bytes (§5).
