# Local context survey (Milestone 0)

- **Date:** 2026-09-25
- **Role:** local context research (read-only survey of local checkouts and the local World of
  Warcraft install)
- **Scope:** sibling repositories under `<repos>/` and the local World of Warcraft install
  (`<wow-install>`), surveyed for anything that can inform or speed up forever-route-lab.
- **Revision (2026-09-25, after the Milestone 0 critique):** trimmed for privacy (critique finding
  LIC-04 in [reviews/review-m0-architecture.md](../reviews/review-m0-architecture.md)), with
  licence wording aligned to LIC-10 and the wago.tools procedure aligned to LIC-14.
  Recommendations that [ARCHITECTURE.md](../ARCHITECTURE.md) revision 2 or
  [DECISIONS.md](../DECISIONS.md) replaced are marked **Superseded by D-0xx** (or by an
  ARCHITECTURE section) in place; the evidence behind them is kept. Where this file disagrees with
  those two documents, they win.
- **Second privacy pass (2026-09-25, architect ruling on LIC-04 item 4 after the Milestone 0
  consistency check):** some sibling repositories may be private, so this file no longer records
  commit pins for local checkouts, a sibling project's status, the description of an unrelated
  local project, or development-machine tooling. The only toolchain fact kept is this project's
  own requirement, Node >= 22.13 (`package.json` `engines`). Public upstreams are still named as
  sources.
- **Nothing was modified outside this file.** The WoW install was only listed and its AddOn
  `.toc` files, `.build.info` and the beta executable's version resource were read. `WTF/`,
  `Cache/`, `Logs/`, `SavedVariables`, `.product.db`, `.env*` and anything that looked like a
  key or token file were **not** opened, in any repository or in the install. Throwaway output
  (the AddOn inventory script and its full output) lives in the gitignored
  `.cache/experiments/local-context/`.

Conventions in this document:

- Path placeholders: `<repo>` is this repository's root; `<repos>` is the folder that holds the
  sibling checkouts (so ForeverSim is `<repos>/Forever`); `<wow-install>` is the World of Warcraft
  install root. Paths without a placeholder are relative to the repository under discussion.
- `Era` = WoW Classic Era (1.15.x). `Forever` = WoW Forever beta (1.60.x, product
  `wow_classic_beta`). Every game-rule fact says which one it comes from.
- **UNVERIFIED** = seen in data, but its meaning or how the live game uses it is not confirmed.
  **UNKNOWN** = no local source answers it.
- Citations are `path:line` in the local checkout under discussion, as read on 2026-09-24/25.
  No commit is recorded for sibling checkouts (some may be private), so line numbers can drift.
  Public upstreams are named where a finding depends on them. Citations into QuestieDB are
  against its pinned commit (`.cache/questiedb`, `b6f5b07`, DATA_PROVENANCE §2).
- Licence statements follow one pattern: what a project declares (with evidence), then the
  owner's posture. None of them is a legal conclusion.

## Key findings

| # | Finding | Source |
|---|---|---|
| K1 | The local beta client is **1.60.1.70009**, not the brief's 1.60.1.69977 (observed 2026-09-25). D-013 records 70009 as the observed build and pins the data frame to 1.60.1.69893. | `<wow-install>/.build.info` (row `wow_classic_beta`, `Version` column); `WowB.exe` FileVersion `1.60.1.70009` |
| K2 | Four Forever builds are now in play: QuestieDB's Forever data targets **1.60.1.69893**, ForeverSim's racials were read at **1.60.1.69977**, and the local client is **1.60.1.70009**. | `.cache/questiedb/data/Forever/conversion.json:1454`, `.cache/questiedb/docs/forever.md:140`; `Forever/docs/forever_rules.md:28`; K1 |
| K3 | wago.tools serves beta DB2 tables as CSV per build: `https://wago.tools/db2/<Table>/csv?build=<version>`. For this project it is a **manual cross-check** only: its `robots.txt` disallows crawling, and D-011 rules out scripting it or running it in CI. ForeverSim scripts it in five tools; this project does not follow that pattern. On 2026-09-25 an individual research request for `UiMap` (an agent WebFetch, one table and build per request; not scripted crawling and not a browser download) returned CSV for both `1.60.1.69977` and `1.60.1.70009`. | `Forever/tools/data_watch/spell_client.py:42-52`, `wago_db2_diff.py:26-30`; WebFetch of `https://wago.tools/db2/UiMap/csv?build=1.60.1.69977` on 2026-09-25; D-011; `docs/research/coordinates.md` section 1 (robots.txt) |
| K4 | ForeverSim's Go `db2tool` can read the beta straight off Blizzard's CDN (`--cdn`), so no install is needed. Its default local mode scans `<BaseDir>/**/DBCache.bin` inside the client's `Cache/`, which this project must not read. Running it needs a Go 1.25 toolchain or a Go container (section 1.3 B). | `Forever/tools/db2tool/README.md:22-48`, `tools/db2tool/main.go:248-252` |
| K5 | Skyborne occupy **race bits 32 and 33**. Forever race masks are wider than 32 bits: `ALL_ALLIANCE = 4294967373`, `ALL_HORDE = 8589934770`. JavaScript bitwise operators truncate to 32 bits. The survey suggested BigInt or split halves; **superseded by D-012**: masks stay JavaScript numbers (exact up to 2^53) and are tested with `Math.floor(mask / 2 ** bit) % 2 === 1`, never `&`. | `Forever/tools/data_watch/.cache/ChrRaces_1.60.1.69893.csv` (`PlayableRaceBit` 32/33); `.cache/questiedb/src/corrections/enum/expansions.lua:295-311`; DB2 `SkillLineAbility` stores masks as `RaceMasks_0`/`RaceMasks_1` |
| K6 | The Forever race/class matrix (client `CharBaseInfo`): no Blood Elf or Draenei, six new pairings, and the Skyborne as two faction halves (High Order = Alliance, Windshaper = Horde). | `Forever/docs/forever_rules.md:35-36`; `Forever/sim/core/character_constants.go:108-112`; cached `CharBaseInfo_1.60.1.69893.csv` |
| K7 | The beta client's `Interface/AddOns` folder is **empty**, so no local `.toc` shows the beta Interface number. QuestieDB configures Forever as Interface **`16001`**, game type `camelot` (alias `forever`). Neither value was verified against the local client. | `<wow-install>/_classic_beta_/Interface/AddOns` (0 entries); `.cache/questiedb/src/config.lua:61`; `.cache/questiedb/docs/toc-flavor-selection.md` |
| K8 | The installed RXPGuides **declares CC BY-NC-SA 4.0**. The owner's posture is not to combine RXPGuides material with this GPL-3.0-or-later repository: no RXPGuides code, guide text or data values, and `src/rxp` is implemented from docs/RXP.md alone (D-019). The installed Questie ships no licence file, which matches the upstream finding in D-016. This is not a legal conclusion. | `<wow-install>/<flavour>/Interface/AddOns/RXPGuides/LICENSE:1` (identical in every installed copy); section 4.3 |
| K9 | wow-forever-log-lab, a sibling project by the same owner, uses React 19 + Vite 8 + Vitest 5 + Playwright + a Web Worker, with a build-time licence-notice generator, a `dist/` asset audit and a review-document pattern worth copying. | section 2 |
| K10 | ForeverSim hard-coded `/forever/` as its base path and now fixes it with a `sed` rewrite of the built bundle. Use `import.meta.env.BASE_URL` from day one (adopted: ARCHITECTURE §16 builds with `base: './'` and derives every data, map and worker URL from `BASE_URL`). | `Forever/tools/site_base.sh:1-11` (comment line 5) |

---

## 1. ForeverSim (`<repos>/Forever`)

### 1.1 Identity

| Item | Value |
|---|---|
| What it is | "ForeverSim": a DPS/tank/healing simulator for WoW Forever. Go engine compiled to WASM, TypeScript/React UI, Vite build, GitHub Pages deploy. Its README names two public upstreams: `wowsims/forever` (the WoWSims Forever sim, whose engine it is) and `ElliotWood/Forever` (which layers Forever rule changes, data tooling and documentation on top) (`README.md:10-15`). This survey did not check which cited file comes from which upstream. |
| Citations | `path:line` in a local checkout, read on 2026-09-24/25; no commit is recorded (see Conventions) |
| Licence | ForeverSim declares MIT (`LICENSE:1`), and its README says both upstreams are MIT (`README.md:17`). WoWSims asks that users keep a visible link back (`README.md:17-18`). Nothing from ForeverSim is planned for porting. The owner's posture for any permissive code ported into `tools/` is ARCHITECTURE §16: keep its header and list it in THIRD_PARTY_NOTICES under "Ported code". This is not a legal conclusion. |
| Toolchain (declared by ForeverSim) | Go 1.25 + protoc, Node 22, npm, oxlint/oxfmt, Vitest + happy-dom, Docker image (`Dockerfile`) |

### 1.2 How it gets beta-client data

| Mechanism | What it does | Where | Reads local install? | Reusable here? |
|---|---|---|---|---|
| **wago.tools DB2 CSV** | `GET https://wago.tools/db2/<Table>/csv?build=<ver>`, cached on disk as `<Table>_<build>.csv` | `tools/data_watch/spell_client.py:42-52`, `tools/forever_talents/export_beta.py:44-54`, `tools/data_watch/trait_curve.mjs:53-56`, `tools/data_watch/wago_db2_diff.py:26-30` | No | **Manual cross-check only** (D-011; section 1.3 A). The survey called this the primary path; that is superseded. |
| **wago.tools build list** | `curl https://wago.tools/api/builds \| jq` to find the newest `1.[2-9]x.` build. The comment says the list is not sorted, so it sorts by `created_at`. | `.github/workflows/watch_wowhead_forever.yml:87-92` | No | **No** as automation (D-011 rules out a scripted wago.tools build watcher). Looking at the list by hand is fine. |
| **wago.tools build diff** | Row-by-ID diff of two builds' CSVs, plus a link to `https://wago.tools/builds-diff?to=..&from=..` | `tools/data_watch/wago_db2_diff.py:39-79` | No | Pattern only: diff two manually saved CSVs locally |
| **db2tool local-CASC** (default) | Reads `.build.info`, the CASC archives under `Data/`, applies hotfixes from `<BaseDir>/**/DBCache.bin`, writes SQLite `tools/database/wowsims.db` | `tools/db2tool/README.md:24-28`, `main.go:248-279` | **Yes, including `Cache/`** | **No.** It breaks the read-only and no-`Cache/` rules. ForeverSim's committed `BaseDir` is the WSL path `/mnt/c/Program Files/World of Warcraft` (`tools/database/generator-settings.json:3`), which would need adapting anyway. |
| **db2tool CDN** (`--cdn`) | Same pipeline, but Blizzard's version service (`https://us.version.battle.net/wow_classic_beta/versions`) picks the build and every file comes from the CDN, hash-verified and cached in `tools/db2tool/cdncache/` | `tools/db2tool/README.md:29-40`; `.github/workflows/update_db.yml:59-68,94-98` | No | Possible developer-run fallback (section 1.3 B); needs Go or Docker. Its output would be a developer's own export into `assets-source/` (ARCHITECTURE §3), never a CI step. |
| **db2tool offline** (`--build`) | Decodes `.db2` files that were extracted earlier | `tools/db2tool/README.md:41-43` | No | Only if `.db2` files are already on hand |
| **Hotfix overlay** | Raidbots mirrors the live `DBCache.bin` at `https://storage.googleapis.com/raidbots-static/wow/classic_beta/enUS/DBCache.bin` | `.github/workflows/update_db.yml:18,80-83` | No | Optional. wago CSVs are the shipped data **without** hotfixes (`tools/data_watch/hotfix_cache.py:10-13`). |
| `hotfix_cache.py` | Reports hotfixed tables from the live cache. Its default path is `_classic_beta_\Cache\ADB\enUS\DBCache.bin`. | `tools/data_watch/hotfix_cache.py:51` | **Yes, `Cache/`** | **No.** Never run it with its default path. |
| WoWDBDefs `.dbd` | Schema per build from `raw.githubusercontent.com/wowdev/WoWDBDefs/master/definitions/<T>.dbd`. WoWDBDefs declares CC BY-SA 4.0 for these definition files; ForeverSim fetches them at build time and never vendors them. | `tools/data_watch/dbd.py:21-35`; `tools/db2tool/NOTICES.md:11,16-20` | No | Only needed to decode raw `.db2`. wago CSVs already carry named columns. |
| Community listfile | `https://github.com/wowdev/wow-listfile/releases/latest/download/community-listfile.csv` (filename to FileDataID) | `makefile:281-283` | No | Only for raw CASC work |
| TACT keys | Encrypted DB2 sections are decrypted with keys from `TactKey.db2`, from hotfixes, or from github.com/wowdev/TACTKeys | `tools/db2tool/README.md:50-73` | Via `Cache/` | Not needed for map, taxi or race tables. **UNVERIFIED** whether any of those tables are encrypted. |
| Wowhead gear planner | `nether.wowhead.com/forever/data/gear-planner?dv=100` | `.github/workflows/watch_wowhead_forever.yml:28-38` | No | No (items and gear, not routing) |

Code provenance for db2tool: `tools/db2tool/NOTICES.md:8-14` lists Go ports of wowdev/DBCD
(declared MIT), WoWDBDefs DBDefsLib (declared BSD-3-Clause), wowdev/TACTSharp (declared MIT) and
Marlamin/wow.tools.local (declared MIT), with commit pins. Nothing from db2tool is planned for use
here (section 5.2). If that changes, the ARCHITECTURE §16 posture for ported code applies. This is
not a legal conclusion.

### 1.3 Procedures for getting UiMap\*, AreaTable, TaxiNodes, ChrRaces and ChrClasses

**A. wago.tools CSV. Superseded by D-011: manual cross-check only; never scripted or run in CI.**
The survey first recommended a scripted download loop here, mirroring `spell_client.py:42-52`.
That loop has been removed from this document. What remains useful:

- **Manual procedure.** Open `https://wago.tools/db2/<Table>/csv?build=<build>` for one table at a
  time, save it as `<repo>/.cache/db2/<build>/<Table>.csv` (gitignored) and record its SHA-256.
  Pin the build (K2; D-013 pins the data frame to 1.60.1.69893). The 12 DB2-only UiMapAssignment
  rows (for 11 UiMaps; Azeroth 947 has one row per continent) in the committed placeholder
  geometry come from CSVs at 1.60.1.70009 that were fetched as individual requests during
  research (not scripted crawling), with their hashes recorded (D-018, D-026).
- Tables that matter for routing and maps: `UiMap`, `UiMapAssignment`, `UiMapLink`,
  `UiMapXMapArt`, `AreaTable`, `Map`, `TaxiNodes`, `TaxiPath`, `TaxiPathNode`, `ChrRaces`,
  `ChrClasses`, `CharBaseInfo`, `SkillLine`, `SkillLineAbility`.
- Check each file's first bytes before trusting it. ForeverSim guards the Wowhead fetch against
  Cloudflare HTML (`watch_wowhead_forever.yml:37-38`); do the same for CSV (the first line must be a
  header containing `ID`).
- Verified on 2026-09-25: the `UiMap` header is `Name_lang,ID,ParentUiMapID,Flags,System,Type,...`,
  and rows 1411 Durotar, 1412 Mulgore, 1426 Dun Morogh and 1429 Elwynn Forest are present with
  `Type=3` (zone). Checked for build `1.60.1.69977`.
- **UNVERIFIED:** whether wago returns an error or silently falls back to another build when the
  requested build is unknown. Build `1.60.1.70009` returned identical rows. Note the build wago
  reports, if any, next to the file's hash.
- The survey could not confirm every table name for 1.60.1. **Resolved by later Milestone 0
  research:** `UiMapAssignment` exists and is byte-identical at 69893 and 70009
  (`docs/research/coordinates.md` section 1; D-013); `TaxiNodes`, `TaxiPath` and `TaxiPathNode`
  exist at 69977 and 70009 (`docs/research/forever-game-rules.md` C2, C3); `UiMapLink` returned
  "Table not found" from wago.tools at 70009 (`docs/MAPS.md` section 3).
- Column names differ between builds and flavours. ForeverSim notes that Forever stores damage
  ranges differently from Era (`spell_client.py:18-20`). Parse by header name, never by position.

**B. ForeverSim db2tool in CDN mode, in a Go container (fallback, for raw DB2 or hotfixes).** Keep all
output out of the Forever repository and out of the install. Consistent with D-011 and
ARCHITECTURE §3, this would be a developer's manual export feeding `assets-source/`, never a
scripted pipeline step or CI job.

1. Write a new settings JSON under `<repo>/.cache/db2tool/settings.json`, shaped like
   `Forever/tools/database/generator-settings.json`: `Settings.Product` = `wow_classic_beta`,
   `TargetDirectory` = `dbfilesclient`, and `Tables` = the list above. The table list is the only
   thing to change (`tools/db2tool/README.md:156-158`).
2. Run it in a `golang:1.25` container with the Forever checkout mounted **read-only** and a
   writable `.cache` volume, e.g.
   `go run ./tools/db2tool --cdn --no-hotfixes -s /work/settings.json --output /work/client.db`.
   `db2tool` is CWD-dependent (`README.md:15-16`) and writes its caches (`cdncache/`, `DBDCache/`,
   `listfile.csv`) under `tools/db2tool/`. Copy the repository into the container rather than
   mounting it read-write, so that nothing lands in `<repos>/Forever`. **UNVERIFIED:** this command
   was not run for this survey.
3. It produces SQLite with one table per DB2 table, schema from WoWDBDefs (`README.md:104-113`).
   CDN mode always takes the build the CDN serves *today*. It cannot pin an older build, which
   makes it worse than a pinned-build CSV for reproducibility.

**C. Local CASC: do not use.** It reads the install and scans `Cache/` for `DBCache.bin`
(`main.go:248-252`).

### 1.4 Local data already cached by ForeverSim (build 1.60.1.69893)

`Forever/tools/data_watch/.cache/` holds 43 wago CSVs (28 MB), dated 2026-09-23. The ones that
matter here are `CharBaseInfo`, `ChrRaces`, `ChrClasses`, `SkillLine` and `SkillLineAbility`, all
`_1.60.1.69893.csv`. There is **no** UiMap, AreaTable or Taxi CSV in the cache, and the
checkout has no generated `tools/database/wowsims.db`. The individual
client-derived values below cite table and build, which D-022 allows in committed docs.

**Playable races (ChrRaces, Forever 1.60.1.69893)**, read with Python `csv`. The `Alliance`
column is 0 for Alliance and 1 for Horde (Human 0, Orc 1).

| ID | Name_lang | ClientPrefix | Alliance col | FactionID | PlayableRaceBit | StartingLevel |
|---:|---|---|---:|---:|---:|---:|
| 1 | Human | Hu | 0 | 1 | 0 | 1 |
| 2 | Orc | Or | 1 | 2 | 1 | 1 |
| 3 | Dwarf | Dw | 0 | 3 | 2 | 1 |
| 4 | Night Elf | Ni | 0 | 4 | 3 | 1 |
| 5 | Undead | Sc | 1 | 5 | 4 | 1 |
| 6 | Tauren | Ta | 1 | 6 | 5 | 1 |
| 7 | Gnome | Gn | 0 | 115 | 6 | 1 |
| 8 | Troll | Tr | 1 | 116 | 7 | 1 |
| 95 | High Order Skyborne | Sb | 0 | 3629 | **32** | 1 |
| 96 | Windshaper Skyborne | Sb | 1 | 3628 | **33** | 1 |

**Race/class pairs (CharBaseInfo, Forever 1.60.1.69893; 56 rows).** Class IDs: 1 Warrior,
2 Paladin, 3 Hunter, 4 Rogue, 5 Priest, 7 Shaman, 8 Mage, 9 Warlock, 11 Druid (ChrClasses).

| Race | Classes | New vs Era (per `forever_rules.md:36`) |
|---|---|---|
| Human | War, Pal, Hun, Rog, Pri, Mag, Wlk | Hunter |
| Orc | War, Hun, Rog, Sha, Wlk, Mag | Mage |
| Dwarf | War, Pal, Hun, Rog, Pri, Sha | Shaman |
| Night Elf | War, Hun, Rog, Pri, Dru | - |
| Undead | War, Rog, Pri, Mag, Wlk, Pal | Paladin |
| Tauren | War, Hun, Sha, Dru | - |
| Gnome | War, Rog, Mag, Wlk, Pri | Priest |
| Troll | War, Rog, Hun, Pri, Sha, Mag, Wlk | Warlock |
| High Order Skyborne (A) | Hun, Rog, War, Mag, Dru | new race |
| Windshaper Skyborne (H) | Hun, Rog, Sha, War, Dru | new race |

ForeverSim encodes the same matrix, re-checked at build 1.60.1.69977
(`sim/core/character_constants.go:108-112`).

**Riding in `SkillLineAbility` (skill line 762, Forever 1.60.1.69893). Every row here is
UNVERIFIED as a gameplay rule.** Trainer level and cost are server-side and not in these tables.

| Spell | Name (SpellName) | Notes from the row |
|---:|---|---|
| 33388 | Apprentice Riding | `ClassMask` 0, `MinSkillLineRank` 1 |
| 33391 | Journeyman Riding | `ClassMask` 1503 (all nine classes), `MinSkillLineRank` 150, `AcquireMethod` 1. ForeverSim's rogue pass lists it as **new in the Forever class spellbook vs Era** (`docs/beta-pass/rogue.md:80`). |
| 824/825/826/828/10861/10906/10907/18995 | Era racial riding skills (Horse, Wolf, Ram, Tiger, Raptor, Undead Horsemanship, Mechanostrider, Kodo) | Still present |
| 1285849 | Galestrider Riding | `RaceMasks_1` = 3, i.e. bits 32 and 33 = both Skyborne. Probably the Skyborne racial mount skill (**UNVERIFIED**). |

The Apprentice/Journeyman spells look like a TBC-style riding progression. Whether Forever
changes the Era rule (mount at 40, epic at 60) was **UNKNOWN** locally. The game-rules research
later found TBC-style riding with mount items still at level 40 and 60, and training level and
cost `UNKNOWN` (`docs/research/forever-game-rules.md` section 6.1; ARCHITECTURE §9.1). In
ARCHITECTURE revision 2 the ruleset holds the Apprentice and Journeyman Riding spell ids, so a
`train` step counts as riding by `skill: 'riding'` or by its `spellId`; riding trained before the
route is `character.riding` (0 none, 1 apprentice, 2 journeyman) (ARCHITECTURE §8.2, §9.1-9.2).

### 1.5 Forever rule facts from ForeverSim relevant to routing

| Rule | Flavour | Source | Confidence |
|---|---|---|---|
| Beta started 2026-09-17; launch 2026-11-04; **beta is capped at level 30** | Forever | `docs/DATA_SOURCES.md:76` | Stated as verified there, on 17 Sep. **Contradicted** by `forever-game-rules.md` sections 3 and 9: the beta started at level 20 and is due to rise to 30 |
| Race/class pairings and no Blood Elf or Draenei, as in section 1.4 | Forever | `docs/forever_rules.md:35-36` | Client data |
| Skyborne: one racial skill line (2980) for both halves. Wind Blessed +1% haste, Elemental Insight +5% vs Elementals. No movement racial is listed for them. | Forever | `docs/forever_rules.md:46` | Client data. The game-rules research found Skyborne movement abilities (Skysight, Walk on Air) in the client (`forever-game-rules.md` section 4) |
| There are "movement, profession and dispel racials" the sim does not model. Which races have them, and what they do, is not listed. | Forever | `docs/forever_rules.md:157-160` | Movement racials may affect travel time: **UNKNOWN** detail |
| Legacy system: three account-wide trees of 20 perks, bought with a point per challenge completed. Perks cover **rested experience, mount speed**, profession skill-ups, reputation and vendor discounts. "Talented" starts talent points at level 5. | Forever | `docs/forever_rules.md:171-175` | From a published dataset (talentsforever), not the client. Magnitudes **UNKNOWN** here. The official post (S5 in `forever-game-rules.md` section 8.1) gives three trees of 7 perks and at most 16 points per character at launch; client tooltips give the Well Rested and Frequent Flier values |
| Skinning +5% damage vs Beasts and Dragonkin; Mining +5% health | Forever | `docs/forever_rules.md:22` | BlizzCon panel |
| World buffs do not work inside raids | Forever | `docs/forever_rules.md:23` | Demo report |
| Tier 1 raids open 2026-12-09: Barrow Deeps (10), Hyjal Summit (20), Onyxia's Lair (40). These are new instance zones. | Forever | `docs/forever_rules.md:144` | BlizzCon / Wowhead |
| Players learn the **same spell IDs as Era** (with new numbers behind them). 1.3M-range IDs that share a player spell's name are NPC spells. | Forever vs Era | `tools/data_watch/spell_client.py:13-14` | Client data |
| New Forever content uses IDs in the 1.2M-1.3M range (spells 1259719, 1285849, ...). **ID-range filters silently drop new content.** | Forever | `docs/DATA_SOURCES.md:49-50`; rows above | Observed for spells. New quest IDs sit elsewhere: Wowhead lists 9xxxx quests (`forever-game-rules.md` section 7), and RXP's Forever guides use 293 quest IDs ≥ 76,000 that QuestieDB lacks (`docs/RXP.md` section 15.4). No ID range can be assumed |

ForeverSim has **nothing** on XP curves, quest XP, flight paths, hearthstone, starting zones or
Skyborne start location. Those were **UNKNOWN** locally. QuestieDB's `support/Forever/QuestXP` and
`Zones` are the leads; they are covered by `docs/research/questiedb-schema.md` (sections 5-6),
`docs/research/forever-game-rules.md` and `docs/SIMULATION.md`.

### 1.6 Forever client build timeline (from local sources)

| Build | First seen | Source |
|---|---|---|
| 1.60.1.69876 | 2026-09-16 | `Forever/docs/DATA_SOURCES.md:77-78` |
| 1.60.1.69893 | 2026-09-16 | same; the QuestieDB DBC target (`.cache/questiedb/docs/forever.md:140`) and this project's pinned data frame (D-013) |
| 1.60.1.69913 | 2026-09-19 | `Forever/docs/data-changes/2026-09-19-client-1.60.1.69913.md` (no change in the sim's tables); the QuestieDB UI-source build (`docs/forever.md:140-141`) |
| 1.60.1.69977 | 2026-09-23 | `Forever/docs/data-changes/2026-09-23-client-1.60.1.69977.md`; `assets/db_inputs/forever_client_build.txt` |
| 1.60.1.70009 | 2026-09-24 on wago.tools (`forever-game-rules.md` section 2); observed in the local beta client 2026-09-25 | `.build.info`; `WowB.exe` version resource |

### 1.7 Lessons ForeverSim records (worth inheriting)

- Put a source link beside every hand-set constant; it is the only audit trail (`docs/DATA_SOURCES.md:56`).
  (Adopted: every `RuleValue` carries `basis` and `source`, D-008, ARCHITECTURE §9.1.)
- The wago build is pinned by hand (`docs/DATA_SOURCES.md:55`). Pin one build per dataset and
  record it in the manifest (adopted: D-013).
- Reworked content can share names with the Era original, so dedupe by ID, not by name
  (`docs/DATA_SOURCES.md:53`).
- Data-watch workflows are **manual dispatch only**, and each opens one PR with a readable
  Markdown diff under `docs/data-changes/` (`.github/workflows/watch_wowhead_forever.yml:1-14`).
  This fits a QuestieDB-SHA watcher. A wago.tools build watcher is ruled out (D-011).
- `db2tool` warns, rather than failing, when the hotfix cache belongs to another build
  (`update_db.yml:91-103`). Surface that kind of mismatch in the manifest instead of hiding it.

---

## 2. wow-forever-log-lab (`<repos>/wow-forever-log-lab`)

A sibling project by the same owner. Only its engineering patterns are recorded here. Citations
are `path:line` in the local checkout, without a commit pin (see Conventions).

### 2.1 Stack baseline (as declared in its `package.json`)

react/react-dom 19.3.0, recharts 3.10.1, vite 8.3.1, @vitejs/plugin-react 6.1.1, vitest 5.0.1,
typescript ^5.9.3, eslint 10.11.0, typescript-eslint ^8.48.0, @eslint/js 10.0.1, globals ^16.5.0,
tsx ^4.21.0, @types/node ^22.19.0, Node `>=22.13.0` (`engines`); it uses npm. This project
requires Node >= 22.13 (`package.json` `engines`) and uses pnpm (`packageManager`, D-003). This
project's planned versions are in ARCHITECTURE §16; its TypeScript is 6.0.x (D-023), not 5.9.

### 2.2 Patterns

| Area | Pattern | File(s) | Verdict for forever-route-lab |
|---|---|---|---|
| TypeScript | `strict: true`, `target ES2022`, `moduleResolution: "Bundler"`, `verbatimModuleSyntax`, `isolatedModules`, `allowImportingTsExtensions`, `noEmit`, `lib` includes `WebWorker`, `jsx: react-jsx`. **No** `noUncheckedIndexedAccess` or `exactOptionalPropertyTypes`. | `tsconfig.json:1` | **Mirror, and tighten** with `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride` and `noFallthroughCasesInSwitch`. Route data is ID-indexed maps, where unchecked indexing hides missing-NPC bugs. |
| ESLint | Flat config: `js.configs.recommended` + `typescript-eslint` `recommended` (not type-aware), browser+node globals, `no-unused-vars` with `^_` ignore | `eslint.config.js:1-4` | **Adapt**: use `recommendedTypeChecked`/`strictTypeChecked` and add `eslint-plugin-react-hooks`. |
| Vitest | `include: tests/**/*.test.ts`, `exclude: tests/browser/**`, `testTimeout: 20000`, Node environment | `vitest.config.ts:1-2` | **Mirror.** For component tests, add happy-dom + @testing-library/react as ForeverSim does (`Forever/vitest.config.mts:23-26`, `vitest.setup.ts:1-6`). (Adopted: ARCHITECTURE §15.) |
| Playwright | `testDir tests/browser`, one worker, not fully parallel, `baseURL http://127.0.0.1:4173`, `trace: retain-on-failure`, `reducedMotion: reduce`, Desktop Chrome only, `webServer: npm run dev -- --port 4173` | `playwright.config.ts:1-2` | **Mirror.** Point `webServer` at `pnpm preview` over the built `dist/` so base path and data fetching are tested as deployed. (Adopted: the ARCHITECTURE §15 gauntlet runs against the production preview.) |
| Privacy test | Browser journey collects every request and asserts none leave the origin and none carry a body | `tests/browser/journey.spec.ts:13,21` | **Mirror**: "the planner makes no request that leaves the origin" (adopted in ARCHITECTURE §15). |
| Mobile test | Asserts `document.documentElement.scrollWidth <= window.innerWidth` at 390x844 | `tests/browser/journey.spec.ts:24,69` | Survey verdict: mirror. **Not adopted** in ARCHITECTURE rev 2, which specifies a dense desktop layout (§12.4) and no mobile-width check (§15). |
| Web Worker bridge | `new Worker(new URL('./parser.worker.ts', import.meta.url), {type:'module'})`. Messages carry an `id` and form a discriminated union (`WorkerRequest`/`WorkerResponse`) in a shared `contracts.ts`. `terminate()` on cancel and on completion. `onerror`/`onmessageerror` become a user-facing retry. Progress is throttled to 100 ms. | `src/worker/client.ts:1-20`, `src/worker/parser.worker.ts:1-13`, `src/core/contracts.ts:46-47`; `vite.config.ts:3` (`worker:{format:'es'}`) | Survey verdict: mirror for the simulator, validator and optimiser workers, with a long-lived optimiser worker that keeps the dataset warm. **Superseded in part by ARCHITECTURE §11.3-11.5 and §12.1:** only the optimiser runs in a worker; it receives a compiled problem (tens of KB) by structured clone, not the dataset; cancel is a message checked between 25-50 ms slices, and the client terminates and recreates the worker only if a cancel is not acknowledged; progress is throttled to about 10 per second. Simulation and validation come from one engine walk per revision. The typed discriminated-union protocol and run ids (§11.5 `runId`) follow this pattern. |
| Stale-result guard | UI keeps a monotonically increasing generation, and every callback checks it before `setState` | `src/ui/App.tsx:374-387`; `docs/frontend.md:12-14` | **Mirror** (route edits spawn many re-simulations). (Adopted: monotonic `revision`, ARCHITECTURE §12.1.) |
| Pure core | `src/core` imports no UI or hosting code; "all parsing and statistics run locally" | `docs/architecture.md` ("Architecture and boundaries"); `AGENTS.md:2` | **Mirror**, and enforce it with a test (section 3.1). (Adopted: ARCHITECTURE §17 pure set.) |
| Bounded outputs | Explicit caps (`MAX_EVIDENCE = 200`, etc.) plus `capped` flags surfaced to the user | `src/core/engine.ts` (constants at the top); `docs/benchmarks.md` | **Mirror** for optimiser search limits and "result truncated" states |
| Composite check | `check` = typecheck, lint, test, build, check:assets. `build` = notices, `tsc --noEmit`, `vite build`. | `package.json` scripts | **Mirror** under pnpm |
| Licence notices | `scripts/third-party-notices.ts` reads `package-lock.json`, takes production deps only, **fails the build if a dependency has no licence file**, special-cases a vendored bundle, and writes `public/third-party-notices.txt`, which is served in `dist/` | `scripts/third-party-notices.ts:1-21`, `scripts/licenses/` | Survey verdict: adapt for pnpm and add a data section calling the data a QuestieDB GPL-3.0 notice. **Superseded by ARCHITECTURE §16 and D-016:** `tools/build/licence-gate.ts` checks shipped dependencies against an SPDX allowlist (not only a missing licence); `dist/` must carry `LICENSE.txt`, `third-party-notices.txt` and `data/NOTICE.md`; the data notice states origin, the Questie licence finding and the carve-out for third-party content. Which pnpm source is more reliable (`pnpm licenses list --prod --json` or walking `node_modules/.pnpm`) remains **UNVERIFIED** for pnpm 10.33. |
| Asset audit | `scripts/audit-assets.ts` walks `dist/` and fails on absolute Windows or macOS user-profile paths, `.map` source maps, `.git` directories, non-anonymised player GUIDs, GitHub links outside an allowlist, and API-key patterns | `scripts/audit-assets.ts:1-7` | **Adapt**: add checks for raw Lua, `.cache/` paths, `WTF`/`SavedVariables` strings, Blizzard art extensions (`.blp`, `.m2`) and any file over a size budget. Keep the "the guard is not proof; inspect manually" wording (`docs/privacy.md`). (Adopted as `tools/build/audit-dist.ts`, ARCHITECTURE §16, D-025.) |
| CI | GitHub Actions with `permissions: contents: read`. Deploy is gated behind `vars.DEPLOY_ENABLED == 'true'`, a protected `production` environment and `main` only. | `.github/workflows/ci.yml:8-9,31-38` | **Mirror** the permissions and the gate. Target GitHub Pages, not Cloudflare. (Deployable builds come from CI on a clean checkout: D-025.) |
| Line endings | `* text=auto eol=lf`, `*.png binary` | `.gitattributes:1-3` | **Mirror.** Also mark `public/data/**` as `-diff` or `linguist-generated`. |
| Docs set | `architecture.md`, `format.md`, `frontend.md`, `privacy.md`, `deployment.md`, `benchmarks.md`, `verification.md` | `docs/` | Mirror the split: ARCHITECTURE, DATA_PROVENANCE, MAPS, RXP, verification, benchmarks |
| Reviews | One file per review (`review-<topic>.md`). Each opens with "Reviewed <date> independently of <component>" and has sections *Findings resolved during review* (`### Resolved P1 - ...`), *Verified behavior*, *Independent validation*, and *Evidence/interpretation boundary* or *Remaining limits*. Screenshots go in `docs/review-evidence/*.png`. Rule: reviewers never review their own implementation. | `docs/review-*.md` headings; `docs/review-journey.md:22-68`; `AGENTS.md:2` | **Mirror** in `docs/reviews/` (the folder already exists) |
| Verification doc | `docs/verification.md` has a *Current checks* table (check, result), exact reproduce commands, retained earlier validation, and explicit limits; machine-readable measurements live in `docs/measurements/*.json` | `docs/verification.md:5-50`; `docs/measurements/` | **Mirror.** STATUS.md already has a check table; link it to a verification doc. (ARCHITECTURE §14 stores benchmark baselines in `docs/measurements/`.) |
| README | Sections in this order: one-paragraph purpose, *Run locally* (exact commands), *Supported analyses* (each with what is **not** claimed), *Privacy*, *Verify* (command block), *Benchmarks*, *Deployment, later*, and links to current reviews | `README.md:1-77` | **Mirror** the order and the "what is not claimed" discipline |
| Agent ownership | `AGENTS.md` assigns file ownership per agent role and forbids push, deploy and global Git changes | `AGENTS.md:1-4` | **Adapt** to the Milestone 1+ roles |
| Code style | `engine.ts`, `contracts.ts` and `App.tsx` are normally formatted. Configs, `worker/*.ts`, the scripts and `journey.spec.ts` are packed onto single long lines. No formatter is configured. | e.g. `tsconfig.json:1`, `scripts/audit-assets.ts:5-7` | **Avoid**: use Prettier or oxfmt and keep configs readable. |
| Unpinned deps | `@playwright/test: "latest"`, `@cloudflare/workers-types: "latest"` | `package.json` | **Avoid**: pin everything and commit `pnpm-lock.yaml` (D-003). |
| Backend/AI | Cloudflare Worker, Durable Object rate limiter, optional LLM "interpretation" | `server/`, `wrangler.jsonc` | **Not applicable** (the planner has no backend) |

---

## 3. Other local projects (brief)

Other local projects under `<repos>/` offered nothing reusable, apart from the public third-party
project below.

### 3.1 world-of-claudecraft (README only)

A third-party open-source browser MMO, `levy-street/world-of-claudecraft`, which declares MIT. A
local clone at `cecebab4` (2026-09-21) was read, README only. It is written in TypeScript,
Three.js, Vite 8, Vitest and pnpm 10.34.5, and it is not a WoW tool. Architecture ideas from its
README:

| Idea | README location | Use here |
|---|---|---|
| A deterministic core with **zero DOM imports**, all randomness through one seeded `Rng`, no wall clock | "Architecture (one sim, three hosts)" section (README ~line 309) | The route simulator and optimiser should be pure and replayable, so that results are reproducible and testable. ARCHITECTURE §2 and §17 go further: the pure set uses no randomness and no clock at all (Zobrist keys come from fixed-seed constants, §11.4). |
| `tests/architecture.test.ts` scans every core file for forbidden imports, DOM globals, `Math.random` and clock calls | README ~line 329 | **Mirror** (adopted: ARCHITECTURE §17 applies it to the listed pure set, not to a single `src/core/**`) |
| One interface seam (`IWorld`) that both hosts implement; UI talks only to it | README ~line 306 | One typed facade from UI to worker (the log-lab `contracts.ts` pattern; ARCHITECTURE §11.1 `Optimizer`) |
| Content as data; wiki generated from live content "so it cannot drift" | README lines 58, 272 | Generate docs and coverage tables from `public/data` rather than writing them by hand |
| The sim emits stable keys and the client localises at the boundary | README line 399 | Keep IDs in the core and names only in the UI layer. ARCHITECTURE rev 2 ships enUS names in the dataset records (§5.3) and does not consume QuestieDB `l10n/Forever` (DATA_PROVENANCE §4.2) |

---

## 4. Local World of Warcraft install (read-only)

### 4.1 Install root (`<wow-install>`)

`.build.info` has one row, for product `wow_classic_beta`, with `Version` = `1.60.1.70009`
(observed 2026-09-25; the beta executable's version resource agrees). D-013 records this as the
observed local build.

### 4.2 Beta client (`_classic_beta_`)

- `Interface/AddOns` exists and is **empty** (0 entries). No `.toc` reveals the beta Interface
  number.
- Best available value: QuestieDB's flavour table sets Forever to `interface = "16001"`,
  `gameType = "camelot"`, `gameTypeAliases = {"forever"}`, suffix `_Forever` (alias `_Camelot`)
  (`.cache/questiedb/src/config.lua:61`). `QuestieDB.toc:12` lists `16001` among its Interface
  values. QuestieDB's own docs say the client build, Interface value and game type still need
  live acceptance checks (`.cache/questiedb/docs/forever.md:113-141`). **Treat 16001 as UNVERIFIED.**
- Project ID: QuestieDB's offline emulator maps `Forever = 2` (the same as `WOW_PROJECT_CLASSIC`)
  (`.cache/questiedb/emulator/client.lua:62-69`). log-lab records the Forever combat-log header
  as `...BUILD_VERSION,1.60.1,PROJECT_ID,18` (`wow-forever-log-lab/docs/format.md:5`,
  `docs/architecture.md` "Fixture provenance"). These may be different identifiers.
  **UNVERIFIED**; it only matters if the site ever parses in-game exports.

### 4.3 Questie and RXPGuides installed locally

- **RXPGuides** declares CC BY-NC-SA 4.0 (`<wow-install>/<flavour>/Interface/AddOns/RXPGuides/LICENSE:1`;
  MD5 `3d2f1dc412c615863e37ab2de60ecd8d`, identical in every installed copy). The owner's posture
  is not to combine RXPGuides material with this GPL-3.0-or-later repository (D-019):
  docs/RXP.md is a behavioural specification written after reading RXPGuides; `src/rxp`
  implementers work only from RXP.md and self-authored fixtures and do not open the RXPGuides
  source; no RXPGuides code, guide lines or text, or data values are copied; and
  `tools/build/rxp-overlap.ts` checks for line overlap. The project makes no statement about the
  legal effect of this process (D-019). This is not a legal conclusion.
- **Questie**: the installed AddOn has no `LICENSE` file, and no licence line in its `README.md`
  or `.toc`. This matches the upstream finding in D-016: neither `Questie/Questie` nor
  `Questie/QuestieDB` has ever had a root licence file (none covering Questie's own code or data; bundled third-party folders carry their own; wording corrected after the Milestone 2 review) on its default branch, and an unmerged Questie
  `license` branch drafts "all rights reserved" wording plus a contributor licence agreement. The
  owner publishes the Questie-derived dataset with notices of this finding (D-016). This is not a
  legal conclusion.

### 4.4 AddOn inventory (not committed)

The full AddOn inventory of the local install was kept in the gitignored
`.cache/experiments/local-context/addon-inventory.md` and is not committed.

---

## 5. Recommendations: what to reuse

These are the survey's recommendations as written on 2026-09-25. Items that ARCHITECTURE rev 2 or
DECISIONS later changed carry a **Superseded**, **Resolved** or **Adopted** note.

### 5.1 Mirror

1. **Superseded by D-011 and D-018.** *Survey text:* take DB2 data from wago.tools CSVs at a
   pinned build (procedure 1.3 A), with a small Node TypeScript script under `tools/` that caches
   into `.cache/db2/<build>/`, and record in the `public/data` manifest the build, the URL
   template, the fetch timestamp and a SHA-256 per CSV. *Now:* no script fetches from wago.tools;
   it is a manual cross-check only. `tools/maps` consumes files a developer has already exported or
   downloaded (DB2 CSV, BLP or PNG) into the gitignored `assets-source/` (ARCHITECTURE §3). The
   committed placeholder geometry holds the 49 zone frames from QuestieDB `conversion.json`
   (build 1.60.1.69893) plus 12 DB2-only UiMapAssignment rows (11 UiMaps) from CSVs at
   1.60.1.70009, fetched as individual requests during research (not scripted crawling) and
   hash-recorded; every row records its own source and build (D-018, D-026). The dataset manifest
   is defined once in DATA_PROVENANCE §8 (D-026). Still valid: never read
   DB2 data from the local install, and record the build and a SHA-256 for every CSV used.
2. **Pick one Forever build per dataset and say so.** The natural choice is **1.60.1.69893**,
   which QuestieDB's Forever coordinates were projected against (K2). Mixing UiMap bounds from
   70009 with QuestieDB coordinates from 69893 needs a check that the bounds did not change
   between the two builds. A build-to-build diff like `wago_db2_diff.py` makes that check cheap.
   **Resolved by D-013, D-018 and D-026:** the data frame is pinned to 1.60.1.69893;
   UiMapAssignment is byte-identical at 69893 and 70009; every committed geometry row records its
   own source and build; local geometry is accepted when its rows for the 49 shared frames
   hash-equal the committed rows (ARCHITECTURE §6).
3. **Superseded by D-012.** *Survey text:* store race masks as decimal strings or `[lo, hi]` pairs
   in JSON, decode to `bigint` (or test with `Math.floor(mask / 2**32)` for the high word), and
   never use `&`/`|` on a mask held as `number`. *Now:* masks are plain JavaScript numbers (exact
   up to 2^53), tested with `Math.floor(mask / 2 ** bit) % 2 === 1`, never `&`; exact masks 77
   (Alliance) and 178 (Horde) include the Skyborne race of that faction, following Questie. The
   unit tests the survey listed still apply: High Order (2^32), Windshaper (2^33),
   `ALL_ALLIANCE` and `ALL_HORDE` (K5).
4. **Engineering baseline from log-lab** (section 2.2): strict tsconfig plus
   `noUncheckedIndexedAccess`/`exactOptionalPropertyTypes`; Vitest (Node) for the core and
   happy-dom for components; Playwright in Chromium on one worker against the production preview,
   with the "no off-origin requests" and "no horizontal scroll at 390 px" assertions; a
   `pnpm check` composite; a build-time licence-notice generator that fails on a missing licence;
   a `dist/` asset audit; `eol=lf`. **Adopted with changes** (ARCHITECTURE §15-16): the licence
   gate is an SPDX allowlist; there is no 390 px check (§12.4 is a dense desktop layout); the
   gauntlet adds throttled performance budgets.
5. **Worker architecture from log-lab**: a shared `contracts.ts` discriminated union,
   id-tagged messages, a generation guard in the UI, cancel through `terminate()` or an
   AbortSignal, and throttled progress. Keep the route core pure and seeded, enforced by an
   architecture test in the world-of-claudecraft style (section 3.1). **Superseded in part by
   ARCHITECTURE §11.5 and §17:** cancel is a `cancel` message checked between slices, with
   terminate-and-recreate only when a cancel is not acknowledged; the pure set uses no randomness
   or clock at all.
6. **Docs discipline**: `docs/reviews/review-<topic>.md` with "Reviewed <date> independently of
   ..." and the sections Findings resolved / Verified behavior / Evidence boundary;
   `docs/verification.md` with a check table and reproduce commands; `docs/measurements/*.json`;
   a source link beside every hand-set rule constant (`Forever/docs/DATA_SOURCES.md:56`).
7. **Base path**: build with Vite `base` from an env var, and reference every data or asset URL
   through `import.meta.env.BASE_URL`, so GitHub Pages under `/forever-route-lab/` works without
   ForeverSim's `site_base.sh` rewrite (K10). **Superseded by ARCHITECTURE §16:** `base: './'`
   (relative, no env var), with every data, map and worker URL built from
   `import.meta.env.BASE_URL`.
8. **Data watch**: a manual-dispatch workflow that records the QuestieDB `master` SHA and the
   newest `1.60.x` wago build, and opens one PR with a Markdown diff under `docs/data-changes/`.
   This is the ForeverSim pattern (section 1.7). **Do not auto-merge** a data PR, unlike
   ForeverSim's snapshot PRs (`watch_wowhead_forever.yml:73-78`): here a data change can change
   routes. **Superseded in part by D-011:** the QuestieDB half stands (pin bumps follow
   DATA_PROVENANCE §12); the wago.tools build half does not.

### 5.2 Adapt

- log-lab's notice script reads `package-lock.json`. Rewrite it for pnpm and extend it with a
  **data notices** section: QuestieDB (upstream commit), WoWDBDefs if raw DB2 decoding is ever
  added (it declares CC BY-SA 4.0 and asks for attribution), and a note that the game data belongs
  to Blizzard Entertainment. The survey described the QuestieDB entry as "treated as GPL-3.0";
  **superseded by D-016 and ARCHITECTURE §5.2, §16**: `public/data/NOTICE.md` states origin, the
  Questie licence finding and the carve-out for third-party content, and `licence-gate` enforces an
  SPDX allowlist.
- log-lab's asset audit: add patterns for `.cache/`, raw `.lua`, `WTF`/`SavedVariables`, and
  Blizzard art extensions. Also add a size budget per `public/data` file. (Adopted:
  `tools/build/audit-dist.ts`, ARCHITECTURE §16; per-file gzip budgets, ARCHITECTURE §14.)
- ForeverSim's `db2tool` (declared MIT/BSD): run it in Docker in CDN mode with `--no-hotfixes`
  **only** if wago.tools becomes unavailable or a needed table is missing there. Do not vendor or
  port it unless that happens. Any such run is a developer's manual export into `assets-source/`
  (ARCHITECTURE §3), never a pipeline step or CI job.

### 5.3 Avoid

- Any tool mode that reads the install's `Cache/` (db2tool local-CASC, `hotfix_cache.py`
  defaults) (K4).
- Copying RXPGuides code or guides into the repository, or loading them in CI (RXPGuides declares
  CC BY-NC-SA 4.0, K8). If a local parser-regression run against the installed guides is ever
  wanted, make it an opt-in script that reads a path from an environment variable, writes nothing
  into the install, commits nothing and is skipped in CI. **UNVERIFIED** as a licensing position;
  the conservative default is not to do it at all. **Superseded by D-019 and ARCHITECTURE §17:**
  the only automated use of RXPGuides is `tools/build/rxp-overlap.ts` (Milestone 5), which clones
  RXPGuides at a pinned SHA into a temporary directory and fails if any trimmed line of 24 or more
  characters in `src/`, `public/`, `tests/` or `docs/research/rxp-samples/` equals a guide line
  (reviewed allowlist excepted). A parser-regression run against RXPGuides guides is not planned:
  `src/rxp` implementers do not open the RXPGuides source.
- ID-range filters on quests, NPCs or spells: new Forever spells live in the 1.2M-1.3M range
  (section 1.5), and new quest IDs are not confined to any range either (section 1.5; ARCHITECTURE
  §5.5 gives invented custom quests negative IDs because the dataset never uses them).
- `"latest"` dependency versions and single-line config files (log-lab); any backend, analytics or AI proxy (log-lab `server/`). ForeverSim's README states "No
  analytics" (`README.md:27`), and so should this project.

---

## 6. Contradictions with the brief, risks and open questions

### 6.1 Where local reality contradicts the brief

| Brief assumption | Local reality | Evidence |
|---|---|---|
| Beta client `.build.info` Version is 1.60.1.69977 | **1.60.1.70009** when observed on 2026-09-25 (D-013) | K1 |
| One Forever build | QuestieDB data is 69893, ForeverSim's rules are 69977, the client is 70009. D-013 pins the data frame to 69893 | K2, section 1.6 |
| A beta `.toc` might reveal the Interface version | Beta `Interface/AddOns` is empty; only QuestieDB's configured `16001` exists (unverified) | K7 |
| RXPGuides Lua can inform the parser | RXPGuides declares CC BY-NC-SA 4.0. The owner's posture (D-019): docs/RXP.md is a behavioural specification written after reading it, and `src/rxp` is implemented from RXP.md alone, with no RXPGuides code, text or data values. This is not a legal conclusion | K8 |
| ForeverSim's extraction can be rerun locally | Its default mode reads `Cache/`, and its committed `BaseDir` is a hard-coded WSL path (`tools/database/generator-settings.json:3`). CDN mode avoids the install but needs a Go toolchain or container (section 1.3 B). | K4 |
| ForeverSim documents all its checklists | `docs/forever_rules.md:6-7` and `docs/DATA_SOURCES.md:84` reference `forever_beta_checklist.md` and `talent-check-2026-09-17.md`, which are not tracked anywhere in the repository | `git ls-files` in `Forever` (no match) |

### 6.2 Risks

- **Build drift**: coordinates projected at 69893 and rendered on UiMap bounds from another build
  would misplace pins silently if the bounds changed. (Mitigated: D-013 pin; frame compatibility
  checked by hash, D-018.)
- **Hotfixes**: wago CSVs are shipped data without server hotfixes
  (`hotfix_cache.py:10-13`). Routing tables are unlikely to be hotfixed, but this is
  **UNVERIFIED**.
- **Race masks over 32 bits** break naive JS bit tests (K5; handled by D-012).
- **Beta cap**: ForeverSim says 30 (`DATA_SOURCES.md:76`); the game-rules research found that the
  beta started at 20 and is due to rise to 30 (`forever-game-rules.md` sections 3 and 9). Content
  above the cap, and in any case above 30, cannot be validated in the beta.
- **Licensing and terms**: RXPGuides declares CC BY-NC-SA 4.0; WoWDBDefs declares CC BY-SA 4.0 for
  its definition files. No wago.tools terms of use were found (`docs/MAPS.md` section 4), and its
  `robots.txt` disallows crawling, hence manual use only (D-011). DB2 content is Blizzard's. The
  survey said to commit only derived numeric data, never raw tables; **superseded by D-022**:
  individual client-derived values may appear in committed docs and tests when they cite table,
  build and column; bulk client tables and art stay local; taxi-derived leg timings are local-only
  by default. None of this is a legal conclusion.
- **Rate limits and availability**: GitHub (the QuestieDB pin) is external; wago.tools is outside
  the pipeline (D-011). Cache upstream clones under `.cache/` and keep extraction re-runnable
  offline from the cache.

### 6.3 Open questions (for the game-rules, maps and QuestieDB research)

Status notes record where later Milestone 0 research answered a question.

1. Forever's real Interface number and `WOW_PROJECT_ID` (QuestieDB says 16001, and its emulator
   says project 2; log-lab's combat log shows `PROJECT_ID,18`). *Still open;* it matters only if
   the site parses in-game exports.
2. The Skyborne starting zone and its UiMap ID. Nothing local answers this. *Answered:* Zephras
   Isle (AreaID 16593, UiMap 2521, its own continent Map 2991), levels 1-12
   (`forever-game-rules.md` section 5.1).
3. Riding in Forever: the level, cost and speed of Apprentice (33388) and Journeyman (33391)
   Riding, and what Galestrider Riding (1285849) is. *Partly answered:* TBC-style skill line 762,
   mount items at level 40 and 60, speed from generic +60% / +100% spells, Galestrider Riding
   auto-learned for the Skyborne race bits; training level and cost still `UNKNOWN`
   (`forever-game-rules.md` section 6.1).
4. Legacy perks: the exact rested-XP and mount-speed values (`forever_rules.md:171-175`), and
   whether a route planner should model account-wide perks. *Partly answered:* Well Rested +20%
   accrual and +20% cap, Frequent Flier -50% cost and +20% flight speed, from client tooltips
   (`forever-game-rules.md` section 8.1). SIMULATION.md recommends rested XP off by default.
5. Which races have the "movement racials" (`forever_rules.md:159`), and their effects.
   *Answered for the Skyborne:* Skysight, Walk on Air and Read Ley Line (`forever-game-rules.md`
   section 4). Other races: still open.
6. Whether wago.tools returns an error or falls back when asked for a build it does not have.
   *Still open;* no longer on the pipeline's path (D-011).
7. Whether `TaxiNodes`, `TaxiPath`, `TaxiPathNode` and `UiMapAssignment` exist unchanged for
   1.60.1, and whether any are encrypted (TACT) in the beta. *Answered for existence:* all four
   exist; UiMapAssignment is byte-identical at 69893 and 70009, and TaxiPath is identical at 69977
   and 70009 (`coordinates.md` section 1; `forever-game-rules.md` C2). wago.tools served readable
   CSVs for all four; client-side encryption was not checked.
