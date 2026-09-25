# WoW Forever game rules that affect route planning

> Milestone 0 research. Written 2026-09-25 by the Forever Rules research role.
> Scope: every way *World of Warcraft: Forever* (the Classic+ relaunch announced at BlizzCon 2026)
> differs from Classic Era **in ways a leveling-route planner, simulator, validator or optimiser must
> model**. Class/talent balance is out of scope except where it changes movement or leveling.
>
> Read section 0 first. Every row carries a source ID (section 1) and a confidence label. Anything
> not sourced is in section 10 (Unknown). Classic Era facts appear **only** in section 11, labelled
> as fallback assumptions.
>
> **Revision (2026-09-25, after the Milestone 0 critique):** the facts are unchanged.
> [ARCHITECTURE.md](../ARCHITECTURE.md) revision 2 and [DECISIONS.md](../DECISIONS.md) are
> authoritative for design; where the recommendations in sections 12 and 13 conflict with them,
> the item carries a **Superseded by D-0xx** note and the original text is kept as evidence. Local
> paths use placeholders: `<repo>` (this repository), `<repos>` (the folder holding sibling
> checkouts) and `<wow-install>` (the World of Warcraft install root).
>
> **Second revision (2026-09-25, after the Milestone 0 consistency check):** the provenance
> vocabulary is cited to D-026 (which supersedes D-007's vocabulary); the quest-log row now
> records the Forever client constant (40 at 70009) that ARCHITECTURE §9.1 uses as
> `client-data`; section 6.4 notes how new flight nodes without a dataset NPC are referenced
> (`TaxiNodeRef`); and the section 12 notes follow the domain types in `src/domain/*.ts`.

## 0. Summary for the architect

1. **The level cap is 60.** `CONFIRMED` [S1, S2]. The beta started with a cap of 20 and is due to
   rise to 30. `REPORTED` [R2, R3].
2. **The XP curve is reported as unchanged, and quest-XP tables in the client are byte-identical to
   Era.** What changed is server-side: dungeon kill XP is "brought way down" and dungeon *quest* XP
   is "much, much, much higher" (developer interview). `REPORTED` [R5, R6]. The client cannot tell
   us the new numbers (`QuestXP.db2` is identical; `ContentTuning.XpMultQuest` = 1 everywhere).
   `CLIENT` [C1]. **The XP model must be parameterised, not hard-coded from Era.**
3. **Four new zones. Only two are ordinary leveling zones.**
   - **Zephras Isle**: levels 1-12, the Skyborne starting zone, on its own continent map. `CONFIRMED` [S1, S4].
   - **Riverglades**: mid-30s to mid-40s, Eastern Kingdoms. `CONFIRMED` [S2].
   - **Shen'dralas**: level range not announced. `UNKNOWN`.
   - **Mount Hyjal**: reported as a level-60 endgame zone. `REPORTED` [R4].
   - **Darkspear Islands is a 15v15 battleground, not a leveling zone.** `CONFIRMED` [S2].
   - "Zephyr/Zephyrus Isle" is not a real name. The zone is **Zephras Isle**. `CONFIRMED` [S1, S4].
4. **Riding is TBC-style.** The Forever client adds skill line 762 with *Apprentice Riding* (skill 75)
   and *Journeyman Riding* (skill 150). Mount spells no longer carry their own speed aura, and
   mount items still require level 40 (normal) or 60 (swift). `CLIENT` [C4]. The training level and
   gold cost are `UNKNOWN`. There are **no flying mounts**. `CONFIRMED` [S2].
5. **The travel graph grew.**
   - 13 new `TaxiNodes` rows. 7 are real flight masters (5 of them connected); 3 are deprecated
     `zzOLD` rows and 3 are quest-scripted paths.
   - 22 new network flight paths, in Riverglades and Mount Hyjal. There is also a new, unconnected
     Dun Morogh node. `CLIENT` [C2].
   - 5 new transport paths: the three official new ship routes, plus two links to Zephras Isle.
     `CONFIRMED` [S3] + `CLIENT` [C3].
   - The hearthstone cooldown is still 60 minutes in the client. `CLIENT` [C5].
6. **56 race/class pairs** (Era has 40). Two new races: High Order Skyborne (Alliance) and Windshaper
   Skyborne (Horde). There are no Blood Elves or Draenei. `CLIENT` [C6] + `CONFIRMED` [S4].
7. **More than 1,000 new quests** `CONFIRMED` [S1, S2]. **None of them are in QuestieDB's Forever
   data.** QuestieDB Forever is the Era quest set with converted coordinates. Its new-zone support is
   map IDs only, and its Forever correction files are empty. `LOCAL` [L1-L4].
8. **Account-wide Legacy perks change leveling inputs.** They are opt-in per character:
   - Well Rested: +20% rested-XP accrual and +20% rested cap.
   - Frequent Flier: 50% cheaper flights that fly 20% faster.
   - Talented: talent points from level 5 instead of 10.

   `CONFIRMED` names [S5] + `CLIENT` values [C7].
9. **Camping** is a new outdoor rest source. A Camp Tent grants "a small amount" of rested XP, at most
   once per hour. `CONFIRMED` system [S2] + `CLIENT` [C8]. The amount is `UNKNOWN`.
10. **No shared mob tagging** in the open world. `REPORTED` developer tweet [R7]. **No level
    scaling.** `CONFIRMED` [S2].
11. **The local beta client is build 1.60.1.70009** (updated 2026-09-25). The brief says 69977, and
    QuestieDB's DBC target is 69893. See `docs/research/local-context.md` K1/K2. D-013 pins the data
    frame to 69893 and records 70009 as the observed local build.

## 1. Confidence legend and source register

| Label | Meaning |
|---|---|
| `CONFIRMED` | Official Blizzard source: news.blizzard.com, worldofwarcraft.blizzard.com, or a staff (blue) post on us.forums.blizzard.com |
| `REPORTED` | Reputable secondary source (Wowhead, Icy Veins, Warcraft Tavern, warcraft.wiki.gg, or a developer interview or tweet relayed by press), or clearly labelled player reports |
| `CLIENT` | Read from the Forever beta client's own DB2/UI data at a pinned build (via wago.tools CSV exports of that exact build, or the Gethe UI mirror). This is **local client data**. It says what the client ships, not what the server does |
| `LOCAL` | A file in a local repo, cited by path and line: the QuestieDB clone at its pinned commit, or ForeverSim at `<repos>/Forever` (a local checkout, no commit recorded, built on the public `wowsims/forever` and `ElliotWood/Forever`; `docs/research/local-context.md` section 1.1) |
| `INFERRED` | The author's interpretation of `CLIENT`/`LOCAL` evidence. Treat it as unverified |
| `UNKNOWN` | No acceptable source. See section 10 |

All web sources were accessed on **2026-09-25**. Where an article's date could not be read from the
page, the cell says "date not shown".

### Official (S)

| ID | Source | Date | Notes |
|---|---|---|---|
| S1 | "Carve a New Path with World of Warcraft: Forever". https://news.blizzard.com/en-us/article/24302093/carve-a-new-path-with-world-of-warcraft-forever | date not shown (BlizzCon week, ~2026-09-12) | Launch time, beta start, level 60, Zephras Isle 1-12, rulesets, Legacy intro |
| S2 | "World of Warcraft: Forever What's Next Panel Recap". https://news.blizzard.com/en-us/article/24303862/world-of-warcraft-forever-whats-next-panel-recap | date not shown (BlizzCon, ~2026-09-13) | Zones, 9 dungeons, raids, Darkspear Islands BG, no flying, no level scaling, camping, Dec 9 raids |
| S3 | "World of Warcraft: Forever Found Photos Panel Recap". https://news.blizzard.com/en-us/article/24304071/world-of-warcraft-forever-found-photos-panel-recap | ~2026-09-15 (per R12; not shown on page) | Riverglades size and quests, Shen'dralas access, ship routes, Forsaken paladin content, starting-zone updates |
| S4 | "WoW: Forever Meet the New Skyborne". https://news.blizzard.com/en-us/article/24302071/wow-forever-meet-the-new-skyborne | date not shown | Skyborne factions, classes, racials, Zephras Isle 1-12 |
| S5 | "Get to Know the World of Warcraft: Forever Legacy System". https://worldofwarcraft.blizzard.com/en-us/news/24307383 | 2026-09-23 | Perk list, 16-point cap, first point at level 25 |
| S6 | Kaivax, "WoW Forever Beta Development Notes – Updated September 24". https://us.forums.blizzard.com/en/wow/t/wow-forever-beta-development-notes-%E2%80%93-updated-september-24/2360696 | 2026-09-24 | Weekly beta notes: quest, respawn and class changes |
| S7 | Kaivax, "WoW Forever Beta Known Issues". https://us.forums.blizzard.com/en/wow/t/wow-forever-beta-known-issues-september-24/2352687 | 2026-09-17, updated 2026-09-24 | Waylaid Crates, "Snowbound" XP bug |
| S8 | Kaivax, "Beta Client Update - September 22". https://us.forums.blizzard.com/en/wow/t/beta-client-update-september-22/2358655 | 2026-09-23 | Build 1.60.1.69977 announced |
| S9 | Kaivax, "Beta is Up - Development Notes Posted". https://us.forums.blizzard.com/en/wow/t/beta-is-up-development-notes-posted/2360719 | 2026-09-24 | New build the same day as S6 (the build number is not in the post; wago.tools shows 70009) |

### Secondary (R)

| ID | Source | Date | Reliability note |
|---|---|---|---|
| R1 | Warcraft Tavern, "World of Warcraft: Forever - Classic+ Announced at BlizzCon 2026" (Luxrah). https://www.warcrafttavern.com/forever/news/warcraft-forever-classic-announced-at-blizzcon-2026/ | 2026-09-12 | Announcement summary |
| R2 | Warcraft Tavern, "Beta Information, Phases & Level Caps" (Luxrah). https://www.warcrafttavern.com/forever/guides/beta/ | date not shown | Beta caps 20 then 30, end 22 Oct, no raid testing, wipe |
| R3 | Icy Veins, "The WoW Forever Beta Starts at Level 20 Cap, Level 30 After 'Couple of Weeks'". https://www.icy-veins.com/wow-forever/news/the-wow-forever-beta-starts-at-level-20-level-30-after-couple-of-weeks/ | date not shown | Title and search snippet only (the page returned 403 to the fetcher) |
| R4 | Warcraft Tavern, "All New Zones & Areas in WoW: Forever Revealed at BlizzCon" (Nevermore). https://www.warcrafttavern.com/forever/news/all-new-zones-areas-in-wow-forever-revealed-at-blizzcon/ | 2026-09-13 | Hyjal "endgame", entered via Darkwhisper Gorge. The Shen'dralas 30-50 range is the **author's speculation** |
| R5 | Warcraft Tavern, "Dungeon Mob XP Drastically Lowered in WoW Forever" (Val Hull). https://www.warcrafttavern.com/forever/news/dungeon-mob-xp-drastically-lowered-in-wow-forever/ | 2026-09-14 | Quotes Kris Zierhut (Principal Designer) from The Sun interview of 2026-09-13 |
| R6 | guided.news, "WoW Forever Is Deliberately Nerfing Dungeon Grinding..." (Sascha Asendorf). https://guided.news/en/news/wow-forever-is-deliberately-nerfing-dungeon-grinding-but-quests-will-reward-significantly-more-xp/ | 2026-09-14 | Summarises the same interview. The source of "the XP curve stays the same". The original article (thesun.co.uk/tech/40367702/...) could not be fetched |
| R7 | GameRant, "World of Warcraft Forever Breaks Silence on Shared Drops and Tagging" (James Ratcliff). https://gamerant.com/world-of-warcraft-forever-breaks-silence-on-shared-drops-and-tagging/ and Wowhead news 383019 (title only) | 2026-09-22 | Josh Greenfield (Aggrend) tweet: "hold the line" on first-come tagging |
| R8 | warcraft.wiki.gg, "Riverglades". https://warcraft.wiki.gg/wiki/Riverglades | last edited 2026-09-25 | Community wiki: 35-45, contested, flight masters, boat to Steamwheedle Port |
| R9 | Bolverk Games, "WoW: Forever Beta Doubles Quest Log to 40...". https://bolverkgames.com/wow/wow-forever-beta-doubles-quest-log-to-40-before-level-cap-climbs-to-30/ | ~2026-09-16 | Relays MrGM. Low-medium reliability |
| R10 | wowforeverbuilds.com, "WoW Forever beta moves leveling XP from dungeons to quests...". https://wowforeverbuilds.com/news/wow-forever-beta-moves-leveling-xp-from-dungeons-to-quests-and-players-say-dunge | 2026-09-19 (updated 09-20) | **Player reports only**, and says so |
| R11 | Gamepur, "How to Get to Zephras Isle in WoW Forever" (Aleksa Stojkovic). https://www.gamepur.com/guides/how-to-get-to-zephras-isle-wow-forever | 2026-09-22 | Cites no source. Low reliability |
| R12 | indiekings.com, "WoW Forever Ship Routes: 3 New Connections...". https://www.indiekings.com/2026/09/wow-forever-ship-routes-3-new.html | 2026-09-16 | Cites S3. Used only to date S3 |
| R13 | Wowhead Forever zone and quest database, e.g. https://www.wowhead.com/forever/quest=93746/a-firm-response | live DB | Search snippets only (page bodies were not retrievable). Zephras Isle "level 1-12 contested"; quest 93746 is a level 9 Zephras Isle quest |

Many SEO and "boost-shop" sites (lfcarry, mythic-store, skycoach, boostroom, mmoexp and others) turned
up in searches with confident numbers. They were **not** used as sources. Several of them contradict
each other on dungeon and zone levels.

### Client data (C) and local files (L)

Client tables come from `https://wago.tools/db2/<Table>/csv?build=<version>`, fetched 2026-09-25.
The builds compared were **Forever 1.60.1.69977** (and **1.60.1.70009** where noted) against **Era
1.15.9.69722** (the last Era build before Forever, 2026-09-12). The scratch copies and diff scripts
are in `.cache/experiments/forever-rules/` (gitignored). Aura numbers were decoded with the
TrinityCore `SpellAuraDefines.h` enum
(https://raw.githubusercontent.com/TrinityCore/TrinityCore/master/src/server/game/Spells/Auras/SpellAuraDefines.h,
fetched 2026-09-25). That mapping is **retail-derived and assumed to hold for this client**.

These were research fetches for Milestone 0. D-011 now limits wago.tools to manual cross-checks,
never scripted or run in CI (see section 13). D-022 (owner decision; the Forever beta has no NDA)
allows the individual client-derived values in this document to be committed because each cites
its table and build, and the column where a value is quoted. Bulk tables stay in the gitignored
`.cache/`.

| ID | Evidence |
|---|---|
| C1 | `QuestXP` (100 rows) byte-identical Era 69722 vs Forever 69977 vs 70009. `ContentTuning.XpMultQuest` = 1 in all 99 (69977) / 101 (70009) rows |
| C2 | `TaxiNodes` (Era 87 -> Forever 100 rows) and `TaxiPath` (Era 294 -> Forever 328 rows) diffs. TaxiPath is identical 69977 vs 70009 |
| C3 | `TaxiPathNode` paths with stop delays: Era 9 transports, Forever 14 (5 new) |
| C4 | `SpellName`, `SpellEffect`, `SkillLineAbility` (skill line 762), `ItemSparse.RequiredLevel` for mount items |
| C5 | `SpellCooldowns` for spell 8690 (Hearthstone): CategoryRecoveryTime 3,600,000 ms in both builds. `SpellCategories` category 89 |
| C6 | `CharBaseInfo` (Era 40 rows -> Forever 56), `ChrRaces` (IDs 95/96, `Alliance` flag, `PlayableRaceBit` 32/33) |
| C7 | `Spell.Description_lang` and `SpellEffect` for spells 1225470-1225500 (Legacy perk spells) |
| C8 | Camping spells 1229432 (Camp Tent), 1229451 (Boosted Rest, 1 h), 1229741 (Camp Benefits), 1283400 and 1291341 (Journeyman/Expert Campfire) |
| C9 | `AreaTable` (Era 1,212 -> Forever 1,372 rows, 160 new, 6 renamed, 1 re-parented), `UiMap`, `Map` (Era 59 -> Forever 73 rows at 69977) |
| C10 | `LFGDungeons` (Era has MinLevel/MaxLevel columns; Forever uses ContentTuningID) joined to `ContentTuning.MinLevelSquish/MaxLevelSquish` |
| C11 | Gethe/wow-ui-source `forever` branch, commit `bd2470aed543f72697a044e989285b6c83e63f73` "1.60.1 (70009)", clone at `.cache/wow-ui-source-forever` (sparse). Era counterpart: `.cache/wow-ui-source-classic_era` commit `33e177d9...` "1.15.9 (69722)" |

| ID | File |
|---|---|
| L1 | `.cache/questiedb/support/Forever/Zones/areaIdToUiMapId.lua:518` (Mount Hyjal 616 -> 2482), `:952` (Valley of Bones -> Shen'dralas), `:1044-1117` (new-zone subzones), `:657` (1216 Blackmaw Hold -> Azshara), `:764` (1769 Timbermaw Hold -> Felwood). QuestieDB commit `b6f5b07b0acf1c820993cbb0ce2521c912bb4c92` |
| L2 | `.cache/questiedb/docs/forever-data.md:81-83` (only four maps changed frame), `:122-125` (new entities not provided), `:155` (new-zone map imports), `:164-167` (Zephras 2665 unresolved) |
| L3 | `.cache/questiedb/data/Forever/conversion.json:37,289,569,1129` (changed transforms), `:1453-1454` (source 1.15.9.69722, target 1.60.1.69893). The `assumption` field says world positions are unchanged and the data "is a converted Era baseline, not complete Forever content" |
| L4 | `.cache/questiedb/data/Forever/foreverQuestDB.lua`: 4,244 quest entries, highest ID 9665 (all Era IDs; no 9xxxx Forever IDs such as 93746). `src/corrections/Forever/foreverQuestFixes.lua`: `Load()` and `LoadDynamic()` return empty tables. `support/Forever/QuestXP/xpDB-classic.lua` is the Era seed |
| L5 | `<repos>/Forever/docs/forever_rules.md:35-36` (race/class pairs from CharBaseInfo at 69977), `:46` (Skyborne racials), `:144` (Tier 1 raids 9 Dec), `:171-175` (Legacy perks) |
| L6 | `<repos>/Forever/docs/DATA_SOURCES.md:76` ("Beta is capped at level 30"; it conflicts with S/R sources, see section 9), `:78-82` (wago.tools serves the beta as `wow_classic_beta` 1.60.1) |

## 2. Timeline and client builds

| Date (2026) | Event | Source | Confidence |
|---|---|---|---|
| 12-13 Sep | BlizzCon 2026. Forever announced, with panels and interviews | R1 (Sep 12), R4 (Sep 13), R5 (interview Sep 13) | `REPORTED` (dates) |
| 12 Sep | Last Era build before the Forever beta: 1.15.9.69722 (the comparison baseline in this doc) | wago.tools builds API `https://wago.tools/api/builds` | `CLIENT` |
| 16 Sep | Beta builds 1.60.1.69876 and 1.60.1.69893 appear (product `wow_classic_beta`) | wago.tools builds API | `CLIENT` |
| 17 Sep | Beta opens, capped at level 20 | S1, S2 (start date); R2, R3 (cap) | `CONFIRMED` start / `REPORTED` cap |
| 18 Sep | Build 1.60.1.69913 | wago.tools builds API | `CLIENT` |
| 23 Sep | Build 1.60.1.69977 (Mac and controller fixes) | S8; wago.tools | `CONFIRMED` |
| 24 Sep | Weekly update, build 1.60.1.70009. Development notes updated | S6, S9; wago.tools (70009 created 2026-09-24 22:02) | `CONFIRMED` notes / `CLIENT` build number |
| 25 Sep | The local install is at 1.60.1.70009 (`.build.info`) | `docs/research/local-context.md` K1 | `LOCAL` |
| "after a couple of weeks" | Beta cap rises to 30 and stays there. Still 20 as of 24 Sep. No level 31-60 content in the beta | R2, R3 | `REPORTED` |
| 21 or 22 Oct | Beta ends. R2 says 22 Oct; other secondary sites say 21 Oct | R2 | `REPORTED` / conflicting |
| 4 Nov | Global launch at "3:00 p.m." Pacific. S1 says PDT and another official page reportedly says PST. US DST ends on 1 Nov 2026, so Pacific time on 4 Nov is PST (UTC-8), which gives **2026-11-04T23:00Z** (INFERRED) | S1, S2 | `CONFIRMED` date |
| 9 Dec | First raids unlock: Barrow Deeps (10-player), Hyjal Summit (20-player), plus Onyxia per L5 | S2; L5:144 | `CONFIRMED` / `LOCAL` |

The internal game-type token is `camelot`. The UI TOCs load `[AllowLoadGameType camelot]` files, and
QuestieDB selects Forever via `[AllowLoadGameType camelot, forever]` (`.cache/questiedb/docs/forever.md:22-27`;
C11 `Interface/AddOns/Blizzard_FrameXMLBase/Blizzard_FrameXMLBase.toc`). `LOCAL`/`CLIENT`.

## 3. Level cap and experience

| Rule | Forever value | Source | Confidence |
|---|---|---|---|
| Level cap | 60 | S1, S2 | `CONFIRMED` |
| Cap will never be raised | Reported as the stated intent ("frozen") | secondary search summaries of BlizzCon coverage | `REPORTED` (weak) |
| Beta cap | 20 at start, later 30 | R2, R3 | `REPORTED` |
| Total XP per level (XP curve) | Reported unchanged from Classic | R6 (summarising the Sun interview) | `REPORTED`. The table is not in the client, so this is `UNKNOWN` from data |
| Quest-XP-by-level table (`QuestXP.db2`, 100 levels x 10 difficulty columns) | Identical to Era | C1 | `CLIENT` |
| Per-quest XP | Server-side. Designers say **dungeon quest XP is much higher**. No numbers published | R5, R6 | `REPORTED` |
| Open-world quest XP | No official statement. Beta players report quest rewards "~200% higher" than Classic and single quest hubs giving several levels | R10 | `REPORTED` (player reports) |
| Dungeon mob (kill) XP | **Greatly reduced** by design | R5, R6 | `REPORTED` (developer quote) |
| Dungeon elite kill XP, observed | ~9-18 XP per elite in Ragefire Chasm | R10 | `REPORTED` (player reports) |
| Open-world kill XP | No statement | none | `UNKNOWN` |
| Client quest-XP multiplier | None: `ContentTuning.XpMultQuest` = 1 on every row | C1 | `CLIENT` |
| Quest XP bugs seen in beta | "Snowbound" (Loch Modan) gave excessive XP and was adjusted later | S7 | `CONFIRMED` |
| Rested XP base rules | No statement | none | `UNKNOWN` (see section 11 for the Era fallback) |
| Rested XP from camping | Camp Tent: "small amount of rest experience", once per `Boosted Rest` duration (3,600,000 ms = 1 h) | C8 (tooltip of 1229741; 1229451 duration) | `CLIENT`; the amount is `UNKNOWN` |
| Rested XP perk | Legacy "Well Rested": rested XP accrues 20% faster and the cap is +20% | S5 (name), C7 (values: SpellEffect 1225478 base points 20/20) | `CONFIRMED` + `CLIENT` |
| Group XP split / group bonus | No statement. Player reports say kill XP is split as in Classic and quest XP is not | R10-type reports | `UNKNOWN` |
| Shared mob tagging | **None** in the open world. Tags and drops stay first come, first served | R7 (Josh Greenfield / Aggrend tweet; Johnny Cash concurring) | `REPORTED` (developer statement) |
| Shared quest-item credit | Case by case. For example, the Shinyfinder Narf quest item (Elwynn) was made lootable by every party member, and shareable dungeon quests that granted items were fixed | S6 | `CONFIRMED` (per quest) |
| Level scaling | None | S2 | `CONFIRMED` |
| Talent points start | Level 10 by default. The Legacy "Talented" perk starts them at level 5, still max 51 | C7 (tooltip text of 1225474, base points 5), S5 | `CLIENT` + `CONFIRMED` |
| Waylaid Crates (SoD-style supply turn-ins) | Present in the Forever beta, including a new "Waylaid Crate: Apprentice Curiosities". The XP reward is not stated | S7; C4 (150 "Waylaid Supplies"/"Supply Shipment" items in ItemSparse) | `CONFIRMED` exists / `UNKNOWN` XP |

## 4. Races, classes, factions

`CLIENT` [C6] at 1.60.1.69977 (identical at 70009), matching `LOCAL` L5:35-36 and `CONFIRMED` S4 for the Skyborne.

| Race (ChrRaces ID) | Faction | Classes in Forever | New vs Era |
|---|---|---|---|
| Human (1) | Alliance | Hunter, Mage, Paladin, Priest, Rogue, Warlock, Warrior | **+Hunter** |
| Dwarf (3) | Alliance | Hunter, Paladin, Priest, Rogue, **Shaman**, Warrior | **+Shaman** |
| Night Elf (4) | Alliance | Druid, Hunter, Priest, Rogue, Warrior | none |
| Gnome (7) | Alliance | Mage, **Priest**, Rogue, Warlock, Warrior | **+Priest** |
| High Order Skyborne (95) | Alliance (`Alliance`=0, PlayableRaceBit 32) | Druid, Hunter, Mage, Rogue, Warrior | **new race** |
| Orc (2) | Horde | Hunter, **Mage**, Rogue, Shaman, Warlock, Warrior | **+Mage** |
| Undead (5) | Horde | Mage, **Paladin**, Priest, Rogue, Warlock, Warrior | **+Paladin** |
| Tauren (6) | Horde | Druid, Hunter, Shaman, Warrior | none |
| Troll (8) | Horde | Hunter, Mage, Priest, Rogue, Shaman, **Warlock**, Warrior | **+Warlock** |
| Windshaper Skyborne (96) | Horde (`Alliance`=1, PlayableRaceBit 33) | Druid, Hunter, Rogue, Shaman, Warrior | **new race** |

- The total is 56 race/class pairs (Era: 40). Blood Elf and Draenei have no CharBaseInfo rows, so
  they are not playable. `CLIENT`.
- Skyborne choose their faction at creation and start on **Zephras Isle (1-12)**. `CONFIRMED` S1, S4.
- New combinations use the race's normal start zone. That is `INFERRED`, not verified. A known issue
  mentions Coldridge Valley exploration (S7), which hints that Dwarf and Gnome starts are in use.
- **Movement racials** (route-relevant): `CLIENT` C4/C7, `CONFIRMED` names S4.
  - **Skysight** (1259686, both Skyborne): +10% movement **and mounted** speed via Elemental Blessing
    (1259688). It lasts 30 s, or longer (spell 1270893, duration not extracted) near an "elemental
    convergence". 2 min cooldown.
  - **Walk on Air** (1259416): a steerable 10 s glide, 2 min cooldown. It changes cliff and descent
    routes.
  - **Read Ley Line**: +100% health and mana regeneration. It shortens downtime.
- Forsaken (Undead) paladins have their own questline around **Bandarion Keep** in the Whispering
  Wood of Tirisfal, including a level-60 epic mount quest. `CONFIRMED` S3.

## 5. Zones

### 5.1 The zone names in the reference UI, checked

| Name as given in the brief | Verified name | What it is | Level range | Confidence |
|---|---|---|---|---|
| Zephyr / Zephyrus Isle | **Zephras Isle** (AreaID 16593, UiMap 2521, Map/continent **2991**) | Skyborne starting zone, contested (AreaTable FactionGroupMask 0). **Its own continent map**: the UiMap's parent is Azeroth (947), not Kalimdor or the Eastern Kingdoms | **1-12** | `CONFIRMED` S1/S4; IDs `CLIENT` C9; `LOCAL` L1:1045 |
| Riverglades | **Riverglades** (16591, UiMap 2548, continent 0 = Eastern Kingdoms) | New contested leveling zone east of the Badlands and Burning Steppes, between Redridge, the Swamp of Sorrows and the Badlands. Port: Powderfuse Port. S3 says it is "roughly the size of Stranglethorn Vale" | "**mid-30s to mid-40s**" (S2). R8 says 35-45 | `CONFIRMED` / `REPORTED` for exact numbers |
| Shen'dralas | **Shen'dralas** (16651, UiMap 2652, continent 1 = Kalimdor) | New zone "between Mulgore and Desolace" (S2), reached south of Desolace **through the Valley of Bones** (S3). Area 2657 Valley of Bones is re-parented from Desolace (405) to Shen'dralas (C9; L1:952). Themes: centaurs and the Shen'dralar | **Not announced**. R4 speculates 30-50; other sites say 35-40 or endgame | `CONFIRMED` location / `UNKNOWN` level |
| Mount Hyjal | **Mount Hyjal** (616, now UiMap 2482, continent 1). Area 616 existed in Era as unused "Hyjal" and was renamed | Post-Archimonde zone. S2 mentions Darkwhisper Gorge (Winterspring, area 16005). Reached by flight path from Everlook (section 6.4). Hosts the Hyjal Summit raid | **Endgame / level 60** per R4. S2 only places it within "the level 1-60 journey" | `CONFIRMED` existence / `REPORTED` level |
| Darkspear Islands | **Darkspear Islands** (16606, UiMap 2524, Map 2997 `InstanceType`=3) | **15v15 battleground** off the coast of Kalimdor. **Not a leveling zone.** At 70009 its UiMap was re-parented to Kalimdor with Type 6, the same as AV/AB/WSG | n/a | `CONFIRMED` S2 / `CLIENT` C9 |
| Mulgore (reworked geometry) | Mulgore (215, UiMap 1412) | Map frame enlarged. New subzones: Skywatcher Plateau (17045, exploration level 10), Gloomrise (17044), Camp Gev'rek (17223); area 474 renamed "Galak Camp" | unchanged (Era fallback) | `CLIENT` C9; `LOCAL` L3:37 |

### 5.2 Existing zones with changed map frames or new content

The map-frame change means percentage coordinates change even where the world position does not. The
coordinate/maps agent owns the transform. It is recorded here because a planner that reuses Era
percentages for these four zones will be wrong.

| Zone | Change | Source | Confidence |
|---|---|---|---|
| Mulgore (1412) | Map bounds changed. The Era box (left 2047.9, right -3089.6, top -272.9, bottom -3697.9) became (2479.2, -3675.0, 266.7, -3835.4): about 540 yd larger to the north, 430 yd west and 585 yd east. Transform scale ~0.835 | L3:37 | `LOCAL` (from DBC 69893) |
| Stormwind City (1453) | Map bounds enlarged (scale ~0.774). New subzone **Stormwind Harbor** (17203) with a ship to Auberdine | L3:1129; C9; S3 | `LOCAL`/`CLIENT`/`CONFIRMED` |
| Eastern Plaguelands (1423) | Map bounds enlarged (scale ~0.90) | L3:289 | `LOCAL` |
| Redridge Mountains (1433) | Map bounds widened 110 yd eastward (toward Riverglades); x offset about -5.09% | L3:569 | `LOCAL` |
| Tirisfal Glades | New subzones Bandarion Keep (16602), Whispering Forest (16616), Shadowvale (16881) (Forsaken paladin content) | C9; S3 | `CLIENT`/`CONFIRMED` |
| Wetlands | "gains quests". New subzones Dragonmaw Retreat, Excavation Site: Wetlands, The Drunken Dwarf. Also a dungeon (5.3) | S3; C9 | `CONFIRMED`/`CLIENT` |
| Desolace | Centaur faction quests get additional content and rewards | S3 | `CONFIRMED` |
| Starting zones | NPCs, quests, profession hooks and recipes added across the starting areas (Valley of Trials and Shadowglen named) | S3 | `CONFIRMED` (details `UNKNOWN`) |
| Elwynn Forest | Beta tuning: respawns, crate counts, Skinning learnable from Helene Peltskinner, candles removed in Jasperlode and Fargodeep | S6 | `CONFIRMED` |
| Dun Morogh | New Alliance flight node "Tidegear Coast" (no paths yet) and subzone Ironforge Submarine Facility (16741) | C2, C9 | `CLIENT` |
| Alterac Mountains / Dalaran | "City of Dalaran" questlines and a dungeon. Spawns added outside the city entrance (S6). New subzones Old Dalaran Ruins, The Eventide. A transport leaves the Dalaran area for Zephras Isle (6.5) | S2, S6, C3, C9 | `CONFIRMED`/`CLIENT` |
| Azshara | Area 1216, Era "Timbermaw Hold" (Azshara subzone), is renamed **Blackmaw Hold**, one of the nine new dungeons. The Felwood-Winterspring **Timbermaw Hold tunnel is a different area (1769) and keeps its name** | C9; L1:657, :764 | `CLIENT` |
| Un'Goro Crater | New subzones The Shaper's Terrace (16985), Pillar of Assimilation, Stomping Grounds ("Shaper's Terrace" is a named dungeon) | C9; S2 | `CLIENT` |
| Moonglade | New subzone Stormrage Barrow Dens (16916); Barrow Deeps raid | C9; S2 | `CLIENT`/`CONFIRMED` |
| Gilneas | New Eastern Kingdoms areas "Gilneas" (17065) and "Ruins of Gilneas" (16756, 9 subzones), plus a "Battle for Gilneas" BG map (3005) | C9 | `CLIENT`. Whether it is accessible at launch is `UNKNOWN` |
| Silithus | "Khonsu arrival removed from beta" | S6 | `CONFIRMED` (beta-only) |

The full list of 160 new AreaIDs (Forever 69977 vs Era 69722), grouped by parent, can be regenerated
with the method in section 13. New zones' subzones are also in L1:1044-1117.

### 5.3 New dungeons (affect routes because dungeon quests now carry most dungeon XP)

The nine official names are Hall of Thanes, Ruins of Lordaeron, Whelgar excavation site, City of
Dalaran, Blackmaw Hold, Drowned City, Krol'dok Stronghold, Alcaz Prison and Shaper's Terrace
(`CONFIRMED` S2). Client evidence:

| Dungeon | Client map / area | LFG ContentTuning level (C10) | Secondary level claim | Confidence |
|---|---|---|---|---|
| Hall of Thanes | Map 3065 (party), area 16919 | 13 | 13-18, beneath Ironforge (SEO sites) | `CLIENT` / `REPORTED` (weak) |
| Ruins of Lordaeron | Map 2999 (party), area 16611 | 15 | 15-20 (SEO sites; beta player reports R10) | `CLIENT` / `REPORTED` (weak) |
| Whelgar excavation site | Map 2998 "Excavation Site: Wetlands", area 16876 | 26 | none reliable | `CLIENT` |
| City of Dalaran | Map 2959 (party), area 16544 | 28 | none reliable | `CLIENT` |
| Blackmaw Hold | Area 1216 (Azshara), no Map row | none | none | `UNKNOWN` |
| Krol'dok Stronghold | Area 17780 (Riverglades subzone), no Map row | none | 40-45 (R8-type wiki) or 40-55 (R4). Conflicting | `UNKNOWN` |
| Shaper's Terrace | Area 16985 (Un'Goro subzone), no Map row | none | none | `UNKNOWN` |
| Drowned City, Alcaz Prison | not found in AreaTable or Map | none | none | `UNKNOWN` |

- The LFG level is `ContentTuning.MinLevelSquish` (= MaxLevelSquish) of the LFGDungeons row. **Its
  meaning is unverified.** For Era dungeons it does not equal Era's LFG MinLevel (for example
  Wailing Caverns is 17 here against Era MinLevel 15, and Scarlet Monastery 30 against 29). Treat it
  as a minimum or recommended level at best. `INFERRED`.
- Other new instance maps are not on the official list: "Half-Pint Tavern" (3002, area CT 32-36) and
  "Manor Mistmantle" (3109). Their purpose (quest scenario?) is `UNKNOWN`.
- Hyjal Crater (2995) is `InstanceType`=4 (arena under the retail enum). `CLIENT`.

## 6. Travel

### 6.1 Mounts and riding

| Rule | Forever | Source | Confidence |
|---|---|---|---|
| Riding model | TBC-style skill line 762 "Riding": **Apprentice Riding** (33388, "basic ground mounts that require a riding skill of 75") and **Journeyman Riding** (33391, swift mounts, skill 150, supersedes Apprentice). Neither spell exists in Era 69722 | C4 (SpellName, SkillLineAbility rows 17539 and 15030, tooltip text) | `CLIENT` |
| Racial mount skills | Horse, Ram, Tiger, Mechanostrider, Wolf, Undead Horsemanship, Kodo, Raptor, plus new **Galestrider Riding** (1285849, Skyborne race bits 32/33) are listed under skill 762, auto-learned (AcquireMethod 1) for the owning race, with extra same-faction race masks | C4 | `CLIENT`. Cross-race riding rules are `INFERRED` |
| Mount speeds | Mount spells (e.g. 458 Brown Horse, 23229 Swift Brown Steed) **lost** their own mounted-speed aura (aura 32), which is present in Era. Speed now comes from generic spells **86457 "Mount Speed Mod: Standard Ground Mount" +60%** and **86458 "Epic Ground Mount" +100%**. Which riding tier maps to which is server-side | C4 (SpellEffect) | `CLIENT`; the tier mapping is `INFERRED` |
| Mount level requirement | Mount items: normal mounts `RequiredLevel` 40 (e.g. 5656 Brown Horse Bridle, 269681 Empyrean Galestrider), swift mounts 60 (e.g. 18777 Swift Brown Steed, 269671 Swift Empyrean Galestrider) | C4 (ItemSparse 69977) | `CLIENT` |
| Riding training level and cost | Not published | none | `UNKNOWN` |
| Official mount mention | S1 mentions a "Cerulean Prideclaw" ground mount that requires buying the riding skill in game. This confirms riding is a purchased skill, but gives no level or price | S1 | `CONFIRMED` |
| Flying | "No flying mounts" | S2 | `CONFIRMED` |
| Class mounts | Summon Felsteed/Warhorse `SpellLevel` 40, Dreadsteed/Charger 60 (`BaseLevel` changed from 40/60 to 0). Forsaken paladins have their own level-60 epic mount quest | C4; S3 | `CLIENT`/`CONFIRMED` |
| Other mount-speed effects in the client | 1314065 "Mount Speed" +5% (non-stacking), 1315080 +5% in Eastern and Western Plaguelands, 1315778 +6% in Winterspring, 1225498 "Mount Up" +10% (not in the official Legacy perk list). Their sources are unknown | C4/C7 | `CLIENT`; how they are obtained is `UNKNOWN` |

### 6.2 Movement abilities (Forever client values; Era not compared, see section 13)

| Ability | Level (SpellLevels) | Effect | Source |
|---|---|---|---|
| Sprint (2983) | 10 | +50% run speed, 15 s, 5 min cooldown | C4 `CLIENT` |
| Aspect of the Cheetah (5118) | 20 | +30% run speed | C4 `CLIENT` |
| Ghost Wolf (2645) | 20 | +40% | C4 `CLIENT` |
| Travel Form passive (5419) | 30 | +40% | C4 `CLIENT` |
| Skysight (Skyborne) | 1 | +10% run and mounted speed, 30 s (longer near a convergence), 2 min cooldown | C4, S4 |
| Walk on Air (Skyborne) | 1 | 10 s steerable glide, 2 min cooldown | C4, S4 |
| Hunter Survival "Strider Kick" | talent | +30% movement speed for 3 s | S6 `CONFIRMED` |

### 6.3 Hearthstone and return abilities

| Rule | Forever | Source | Confidence |
|---|---|---|---|
| Hearthstone (item 6948, spell 8690) cooldown | 60 min (category 89, CategoryRecoveryTime 3,600,000 ms). Identical to Era 69722 | C5 | `CLIENT` (the server could override: `UNKNOWN`) |
| "Second Home" (1225494) | A second bind point set at any rest area. Shares the hearthstone cooldown (category 89, 60 min). **It is not in the official Legacy perk list (S5)**, so how it is obtained is unknown | C7 | `CLIENT` / obtainability `UNKNOWN` |
| Crumbling Hearthstone (item 282006, spell 1312670) | Single-use teleport to Orgrimmar or Stormwind by faction | C7 (tooltip), C4 | `CLIENT`. Who gets it (Skyborne leaving Zephras?) is `UNKNOWN` |
| Other hearth variants | 1315212 (Scarlet-themed hearthstone, same 60 min category), item 278162 "Pouch of Chipped Hearthstones" | C4 | `CLIENT`; purpose `UNKNOWN` |

### 6.4 Flight paths

Changes between Era 69722 and Forever 69977 (the `TaxiPath` table is identical at 70009; one
`TaxiNodes` position moved at 70009: Stormwind, Elwynn by about 13 yd). `CLIENT` [C2].

**New flight nodes.** Faction is decoded from Era usage: `Flags` bit 0 = Alliance, bit 1 = Horde;
`MountCreatureID_0` = Horde mount (2224), `_1` = Alliance mount (541). Positions are world x, y.

| Node ID | Name | Continent | Faction (flags) | Position | Status |
|---|---|---|---|---|---|
| 559 | Summit of Eternity, Mount Hyjal | 1 Kalimdor | both (1027) | 5283, -3307 | live (paths) |
| 3242 | Tainted Foothills, Mount Hyjal | 1 | both (1027) | 4394, -2836 | live |
| 3203 | Rog'mar, Riverglades | 0 EK | Horde (1026) | -7924, -4783 | live |
| 3276 | Farholde Keep, Riverglades | 0 | Alliance (1025) | -9104, -4830 | live |
| 3275 | Powderfuse Port, Riverglades | 0 | Alliance mount, no faction bit (1024) | -8180, -5616 | live (to Farholde only) |
| 3274 | Powderfuse Port, Riverglades | 0 | Horde mount, no faction bit (1024) | -8157, -5725 | **no paths** in 69977/70009 |
| 3205 | Tidegear Coast, Dun Morogh | 0 | Alliance mount (1152) | -4376, 865 | **no paths** |
| 3206-3208 | `zzOLD...` Riverglades/Bolder'ok/Powderfuse | mixed | n/a | n/a | deprecated, ignore |
| 3260-3262 | Quest paths: Dalaran Translocation; "Shaman - Level 40 Quest - Thousand Needles - A" (+ flight back) | n/a | n/a | n/a | quest-scripted, not network nodes |

QuestieDB's Forever data has no Forever-only NPCs (L2:122-125; `docs/research/questiedb-schema.md`
section 0), so none of the seven real new nodes has a flight-master NPC in the dataset.
ARCHITECTURE revision 2 therefore names a flight node with `TaxiNodeRef { npcId, taxiNodeId,
name }` (`src/domain/route.ts`): a dataset flight master by `npcId`, a new Forever node by its
cited TaxiNodes id (for example 3203 Rog'mar; D-022), or by the name text a guide used
(ARCHITECTURE §8.1, §9.1).

**New flight paths** (`TaxiPath.Cost` shown as stored; it is conventionally copper before server
discounts, but that is `INFERRED`):

| From -> To | Cost | Path IDs |
|---|---|---|
| Tainted Foothills <-> Summit of Eternity | 510 each way | 11528 / 11524 |
| Everlook (A 52 and H 53) -> Tainted Foothills | 330 | 11530 (A), 11525 (H) |
| Tainted Foothills -> Everlook (A / H) | 1020 | 11529 (A), 11526 (H) |
| Rog'mar <-> Stonard | 630 | 11574 / 11575 |
| Rog'mar <-> Kargath | 630 | 11576 / 11577 |
| Rog'mar <-> Flame Crest | 630 | 11578 / 11579 |
| Rog'mar <-> Hammerfall | 830 | 11580 / 11581 |
| Powderfuse Port (3275) <-> Farholde Keep | 330 | 11582 / 11583 |
| Farholde Keep <-> Lakeshire | 630 | 11584 / 11585 |
| Farholde Keep <-> Morgan's Vigil | 630 | 11586 / 11587 |
| Farholde Keep <-> Thelsamar | 630 | 11588 / 11589 |

- No Era flight node or path was removed or re-routed. Every existing node gained flag bit `0x400`
  (1024), whose meaning is `UNKNOWN`. `CLIENT`.
- Flight speed is server-side (`UNKNOWN`). The Legacy perk **Frequent Flier** makes flights 50%
  cheaper and 20% faster (C7: SpellEffect 1225490, aura 620 base -50, aura 388
  `MOD_TAXI_FLIGHT_SPEED` base 20). `CONFIRMED` S5 (name) + `CLIENT`.
- There is a second Zephras Isle UiMap, 2665, with `System`=1, which is `INFERRED` to be a taxi map.
  No Zephras Isle TaxiNodes exist in 69977/70009, so whether the island has internal flight paths is
  `UNKNOWN`. `CLIENT` + L2:164-167.

### 6.5 Ships, zeppelins, portals

Official: "Stormwind Harbor to Auberdine ... while Menethil, Southshore, and Auberdine add another
route" (S3), plus the Steamwheedle Cartel (Tanaris) route to Powderfuse Port in the Riverglades.
`CONFIRMED` S3.

Client transport paths (TaxiPathNode paths with stop delays; stops labelled by the nearest flight
node; `CLIENT` C3):

| Path | Stops (continent: world x, y) | Interpretation | Confidence |
|---|---|---|---|
| 11616 | 1: 6548, 942 (Auberdine) -> 0: -8654, 1344 (Stormwind, 875 yd from the SW flight master = harbor) | Stormwind Harbor <-> Auberdine ship | `CONFIRMED` S3 + `CLIENT` |
| 11167 | 0: -3709, -575 (Menethil) -> 0: -1103, -555 (116 yd from "Southshore Ferry") -> 1: 6406, 823 (Auberdine) | Menethil -> Southshore -> Auberdine ship. The old Menethil-Auberdine path 295 still exists | `CONFIRMED` S3 + `CLIENT` |
| 11391 | 1: -6933, -4951 (Tanaris east coast) -> 0: -8232, -5801 (Powderfuse Port) | Steamwheedle Port (Tanaris) <-> Powderfuse Port, Riverglades. "Steamwheedle Port" is named by R8 | `CONFIRMED` S3 + `CLIENT` |
| 11398 | 0: 545, 424 (Dalaran area, Alterac) -> 2991: 1848, 569 (Zephras Isle) | Dalaran <-> Zephras Isle transport. R11 calls it a "Skycutter" from Valanaar to Dalaran | `CLIENT` / `REPORTED` (weak) |
| 11457 | 1: -802, 367 (about 519 yd from the Thunder Bluff flight master = northern Mulgore / Skywatcher Plateau) -> 2991: 1953, 1019 | Mulgore <-> Zephras Isle transport. R11: a Horde Skycutter from the cliffs north-west of Thunder Bluff | `CLIENT` / `REPORTED` (weak) |

- All nine Era transports (paths 241, 285, 292, 293, 295, 301, 302, 303, 436) remain. Path 293
  (Rut'theran - Auberdine) has changed geometry. `CLIENT`.
- A path existing in the client does **not** prove the transport runs on the server. Activation,
  schedules and faction restrictions are `UNKNOWN` until observed.
- R11 reports an Alliance portal to Zephras Isle (Valanaar) in the Stormwind Mage Quarter. `REPORTED`
  (weak, unsourced).
- Mage portals and teleports: nothing Forever-specific found. `UNKNOWN`.

## 7. Quests

| Rule | Forever | Source | Confidence |
|---|---|---|---|
| New quests | "more than a thousand new quests woven throughout the level 1-60 journey" | S2 (also S1) | `CONFIRMED` |
| Riverglades quests | "more than 150 new quests" (S2); "nearly 200 quests for Horde and Alliance" (S3) | S2, S3 | `CONFIRMED` (two figures) |
| New quest IDs | Wowhead lists new quests with IDs in the 9xxxx range, e.g. 93746 "A Firm Response", a level 9 Zephras Isle quest | R13 | `REPORTED` |
| QuestieDB coverage | **No new Forever quests.** 4,244 entries, highest ID 9665, and zero references to the new zone AreaIDs. Corrections empty; QuestXP seed = Era | L4; L2:122-125 | `LOCAL` |
| Modified Era quests | Beta tuning so far, e.g. Teldrassil "Bounty: Gnarlpine Furbolg" 20 -> 15 kills; respawn changes in Dun Morogh, Durotar, Elwynn, Mulgore, Silverpine and Westfall; Skyborne "Exploring the Horde" in Undercity | S6 | `CONFIRMED` |
| Removed Era quests | No list published | none | `UNKNOWN` |
| Class quests | Forsaken paladin chain and level-60 epic mount quest (S3). A Shaman "Level 40 Quest - Thousand Needles" exists for **both** factions (TaxiNodes 3261/3262 for Alliance and relabelled 2913/2914 for Horde; the Horde paths were SoD runecarving paths in Era) | S3; C2 | `CONFIRMED` / `CLIENT` |
| Quest log size | **40.** The Forever UI does not load the Era `Vanilla/Constants.lua` (`MAX_QUESTS = 20`). It uses a retail-style quest map frame, and the client documents `QuestLogConstsMainlineCamelot.MAXIMUM_NUM_QUESTS_LOG_CAN_ACCEPT = 40`, which the Camelot quest log reads. Beta reported at 40 (MrGM via R9). *Corrected in the second revision:* the first revision said the UI "gets the cap from the server"; the client constant was found later (SIMULATION.md VAL-20). ARCHITECTURE §9.1 uses 40 as `client-data` | C11 `Blizzard_APIDocumentationGenerated/QuestConstantsDocumentation.lua:145-150`, `Blizzard_UIPanels_Game/Camelot/QuestMapFrameUtils.lua:18-21`, `Blizzard_FrameXMLBase.toc` (loads `[Game]\Constants.lua` for camelot); R9; Era `Vanilla/Constants.lua:86` | `CLIENT` constant (70009) + `REPORTED` beta value / server enforcement at launch `UNKNOWN` |
| Shared tagging | None (see section 3) | R7 | `REPORTED` |
| Dungeon quests | Worth "much, much, much" more XP; the first clear is the intended big reward | R5 | `REPORTED` |
| Hunter taming | "Tame Beast no longer works on beasts above hunter's level" | S6 | `CONFIRMED` |
| Profession hooks on routes | Skinning is learnable from Helene Peltskinner during her quest (Elwynn) | S6 | `CONFIRMED` |

## 8. Other systems that change leveling routes

### 8.1 Legacy system (account-wide, spent per character)

`CONFIRMED` S5 (2026-09-23):

- There are three trees (Professions, Adventure, Resourcefulness) of 7 perks each.
- A character can spend at most 16 points at launch. A single character can earn 29.
- A character first earns points around level 25. Other triggers are a non-gathering primary
  profession at 150, or exploring the whole world map.
- Legacy is not available on Hardcore characters.

Values are from the client tooltips (C7).

| Perk (official name) | Effect (client values) | Route impact |
|---|---|---|
| Well Rested | Rested accrual +20%, rested cap +20% | XP model |
| Talented | Talent points from level 5 instead of 10 (max 51) | Early power, not XP |
| Frequent Flier | Flights -50% cost, +20% speed | Travel time and gold |
| Thrill of Adventure | Killing blow on a non-trivial enemy restores 5% health and mana over time (not in instances) | Downtime model |
| Field Medicine | Shorter Recently Bandaged (not in instances) | Downtime |
| Gourmand | Food buff duration +100% | minor |
| The Quick and the Dead | +10% movement while dead; free helpful spells for 2 min after resurrection | Death recovery time |
| Field Guide | Camp-feature cooldown -25% (-900,000 ms on the "Camping Feature" category 97) | Camping frequency |
| High Alert, Reinforce, Diplomat, and the professions perks | Stealth detection, durability, reputation, professions | none or minor |

`Mount Up` (+10% mounted speed), `Second Home`, `Master Swimmer` (+30% swim speed, +100% breath) and
`Personal Banking` are spells in the same ID block but **not** in S5's perk list. How they are obtained
is `UNKNOWN`. Model them as unavailable by default.

### 8.2 Camping

Players craft campfires outdoors, and others can add profession objects and share buffs (S2,
`CONFIRMED`). In the client (C8) the tiers are Camp Tent (Tier 1), Journeyman Campfire (Tier 2) and
Expert Campfire (Tier 3). Sitting at the fire for 60 s (Welcoming Campfire duration) grants Camp
Benefits for 1 h. The tent benefit gives a small amount of rested XP, limited to once per hour. Beta
fixes let players sit, sleep or craft while waiting (S6). The amount of rested XP is `UNKNOWN`.

### 8.3 Realm rulesets and Hardcore

The realm types are Normal, PvP, Roleplaying and Hardcore, each a large "ecosystem" (S1). S5 says
Hardcore "will follow later", and S2 lists Hardcore in the post-launch roadmap. **Whether Hardcore is
available at launch is conflicting and therefore `UNKNOWN`.** Death rules for route risk scoring are
`UNKNOWN`.

## 9. Contradictions with the brief or with likely planner assumptions

| Assumption | Reality | Source |
|---|---|---|
| The local beta client is 1.60.1.69977 | It is **1.60.1.70009** (updated 2026-09-25). The data tables used here barely changed between the two (section 6.4, C2) | `local-context.md` K1; wago.tools |
| "Zephyr/Zephyrus Isle" | **Zephras Isle**, a separate continent map (2991), levels 1-12 | S1, S4, C9 |
| Darkspear Islands is a new leveling zone | It is a **15v15 battleground** | S2, C9 |
| Mount Hyjal is a leveling zone with a level band | Reported as a level-60 endgame zone with a raid. Area 616 existed in Era DBC as unused "Hyjal" | R4, C9 |
| Mulgore is the one reworked geometry | **Four** maps changed frame: Mulgore, Stormwind City, Eastern Plaguelands and Redridge Mountains | L2:81-83, L3 |
| QuestieDB Forever = Forever quest data | It is the **Era quest set** with coordinate conversion. New zones exist only as map IDs. No new quests, NPCs or objects; empty Forever corrections; Era QuestXP seed | L2, L3, L4 |
| Era XP values can drive the simulator | The curve is reportedly unchanged, but dungeon kill XP is cut and dungeon quest XP is raised on the server, and open-world quest XP is reportedly higher. The client has no numbers | R5, R6, R10, C1 |
| Era riding: buy a level 40 mount and a racial riding skill | TBC-style Apprentice/Journeyman riding; mount spells carry no speed. Items are still level 40 or 60; cost and training level are unknown | C4 |
| Beta capped at 30 (ForeverSim `DATA_SOURCES.md:76`) | The beta started at **20**; 30 comes later. Still 20 on 24 Sep | L6 vs R2, R3 |
| ForeverSim racials are current (`forever_rules.md:42` gives class-specific Eureka! discounts of 40/20/50/15%) | The 24 Sep beta notes changed Eureka to a flat 10% discount (not route-relevant, but it shows local docs drift weekly) | S6 vs L5 |
| Shared tagging (as in Era since 2023 / SoD) | None in Forever's open world | R7 |
| One map per continent (Kalimdor, Eastern Kingdoms) | Zephras Isle is its own continent/UiMap under Azeroth, reached only by transport | C3, C9 |
| Timbermaw Hold (tunnel) changes | Only Azshara area 1216 was renamed to Blackmaw Hold (dungeon). The Felwood tunnel area 1769 keeps its name | L1:657, :764 |

## 10. Unknown / needs verification

| # | Unknown | Why it matters | How to resolve |
|---|---|---|---|
| U1 | XP required per level 1-60 | Core of the XP simulator | Beta/live observation (UnitXPMax per level), or an official statement. The Era table is the fallback |
| U2 | Per-quest XP in Forever (open-world and dungeon quests), and whether a global multiplier exists | Route optimiser objective | Wowhead Forever quest pages (reward XP), beta logs, a Questie/QuestieDB Forever XP update |
| U3 | Mob kill XP formula, open world and dungeon (the multiplier for dungeons) | Grinding segments | Beta combat-log or addon measurements |
| U4 | Group XP split and bonus; party quest-sharing rules | Group routes | Observation |
| U5 | Base rested XP rate and cap; Camp Tent amount | Rested simulation | Observation; tooltip text only says "small amount" |
| U6 | Riding training level and gold cost (Apprentice and Journeyman); vendor mount cost | The mount step is a huge time saver | Trainer observation at launch (the beta cap of 30 may hide it) |
| U7 | Flight speed and actual flight costs (server discounts) | Travel-time model | Timing flights in beta |
| U8 | Level ranges of Shen'dralas and Mount Hyjal (official) | Zone ordering | Blizzard or Wowhead zone pages post-launch |
| U9 | Level ranges and entrances of the nine new dungeons (only LFG CT values for 4) | Dungeon-quest routing | Wowhead dungeon pages; client data from later builds (Blackmaw Hold, Drowned City, Krol'dok, Alcaz, Shaper's Terrace have no Map rows yet) |
| U10 | Which transports actually run (paths 11167, 11391, 11398, 11457, 11616), their schedules, and the Stormwind-to-Zephras portal | Travel graph edges | In-game observation |
| U11 | Horde Powderfuse Port node 3274 and Tidegear Coast node 3205 have no paths | Riverglades travel for the Horde | Later builds |
| U12 | Zephras Isle internal flight paths (UiMap 2665, System=1) | Starting-zone routing | Later builds / observation |
| U13 | Whether the server enforces the quest log size of 40 at launch (client constant 40 at 70009, C11; 40 in beta per R9) | Route validators that check the quest cap | Observation at launch |
| U14 | Removed or changed Era quests and chains | Route validity for Era-based guides | Wowhead Forever DB; QuestieDB Forever updates |
| U15 | Whether Gilneas / Ruins of Gilneas is an accessible questing area | Zone list | Official info / observation |
| U16 | Hearthstone cooldown server override; how Second Home is obtained | Hearth planning | Observation |
| U17 | Start zones and trainers for new combos (Dwarf shaman, Orc mage, Undead paladin, and others) | Early-route correctness | Observation |
| U18 | Beta end date (21 vs 22 Oct); date the beta cap rises to 30 | Test planning only | Blue posts |
| U19 | Hardcore at launch or later | Risk scoring | Blue posts |
| U20 | Meaning of the new TaxiNodes flag 0x400 | Parser correctness | Compare with retail TaxiNodeFlags; observation |
| U21 | Mount-speed spells 1314065/1315080/1315778 (source) and Mount Up / Master Swimmer availability | Movement model | Wowhead spell pages |
| U22 | Riverglades exact level range (official "mid-30s to mid-40s"; wiki says 35-45) | Zone ordering | Wowhead zone page post-launch |

## 11. Classic Era fallback assumptions (explicitly labelled; use only where section 10 is unresolved)

These are **Classic Era** facts, **not Forever facts**. Each row says whether the Era fact itself was
verified in this research.

| Topic | Era fallback | Verified here? |
|---|---|---|
| XP per level 1-60 | Era table (the XP rules agent owns it) | No |
| Quest XP by level and difficulty | `QuestXP.db2` (identical in Forever, C1) + Questie `xpDB-classic.lua` per-quest values | Table yes (C1); per-quest values are Era |
| Rested XP | Accrues in inns and cities; about 5% of a level per 8 h; cap 1.5 levels | No (general Classic knowledge) |
| Quest log | 20 quests (`Vanilla/Constants.lua:86 MAX_QUESTS = 20`, Era UI 1.15.9) | Yes for Era (C11). Forever differs |
| Hearthstone | 60 min | Yes, and Forever matches (C5) |
| Riding | Racial riding at 40 (60% speed) and epic at 60 (100% speed). Costs about 100 g at 40 and about 1,000 g at 60 before reputation discounts | Speeds consistent with the Forever spells (C4); costs **not verified** |
| Flight speed | Constant server speed, cost by distance | No |
| Group XP | Kill XP split between group members with a small group bonus; quest XP not split | No |
| Mob tagging | Era realms added shared quest-mob credit in later patches. **Do not apply to Forever** (R7) | n/a |

ARCHITECTURE §9.1 implements these fallbacks as the `era-1.15` ruleset and as `era-assumed` values
in `forever-beta`. For flight speed the default is the emulator taxi speed of 32 yd/s
(`era-assumed`) times a detour factor (`assumption`) (D-024). Group XP rates are off by default.

## 12. Recommendations for the architecture

These are the recommendations as written for the Milestone 0 architect. The note under each item
records what ARCHITECTURE revision 2 and DECISIONS adopted or superseded.

1. **Rules profile as data.** Put every rule the engine uses into a versioned `RulesProfile`
   (e.g. `rules/forever.json`). Give each value `{value, unit, source, confidence, build, asOf}`.
   Ship an `era` profile and a `forever` profile. A `forever` value that is `UNKNOWN` must fall back
   to `era` **visibly**, with an "assumed" badge, never silently.
   - **Superseded by D-008 (ARCHITECTURE §9.1) in naming and form.** There is no `RulesProfile`
     and no `era`/`forever` profile: the rulesets are `forever-beta` and `era-1.15`, exported from
     `src/rules` (TypeScript, not a JSON file), and a project selects one with
     `rulesetId: 'forever-beta' | 'era-1.15'` (ARCHITECTURE §8.2, `src/domain/project.ts`). Each
     value is a `RuleValue<T>` `{ value, basis, source, build?, note? }`, where `basis` is one of
     `client-data`, `official`, `reported`, `era-assumed` or `assumption`. `basis` replaces the
     proposed `confidence`, and there is no `unit` or `asOf` field. The visible fallback stands:
     the UI marks every number that depends on an `era-assumed` or `assumption` value, and a
     project assumption, when set, overrides the ruleset value and carries its own provenance.
     This document's labels are a different vocabulary. A suggested mapping (not defined in
     ARCHITECTURE): `CLIENT` → `client-data`, `CONFIRMED` → `official`, `REPORTED` → `reported`, a
     section 11 fallback → `era-assumed`, and `INFERRED` or a chosen default for an `UNKNOWN` →
     `assumption`. A `LOCAL` fact takes the basis of the evidence it relays.
2. **Parameterise the XP model.**
   - Keep separate knobs: `questXpMultiplier` (open world), `dungeonQuestXpMultiplier`,
     `dungeonMobXpMultiplier`, `openWorldMobXpMultiplier`, `restedAccrualRate`, `restedCap`,
     `campTentRestedXp`, and perk toggles.
   - Defaults are Era values with the Forever direction noted (dungeon mobs lower, dungeon quests
     higher).
   - Let users calibrate from observed data.
   - **Partly adopted (ARCHITECTURE §5.3, §5.5, §9.1, §9.3).** `questXpMultiplier` and
     `dungeonQuestXpMultiplier` exist, default 1.0 with basis `assumption` (beta reports suggest
     higher), and apply only to `era-seed` XP, never to user-entered values. Per-quest XP carries a
     basis (`era-seed`, `user` or `forever-observed`) and may be `null`; unknown XP is never counted
     as 0. Users calibrate through project assumptions and per-quest `questOverrides`. Kill-XP and
     rested parameters are specified in SIMULATION.md (sections 1.2 and 4), which recommends rested
     XP off by default. Perk toggles are not in revision 2.
3. **The quest data will be incomplete for Forever.**
   - The planner must accept quest IDs that are not in the dataset, e.g. from RXP guides or user
     input. Show them as "unknown quest" placeholders with user-entered XP and coordinates, rather
     than rejecting the route.
   - Record the QuestieDB commit and its DBC build (69893) in the data manifest. Surface "dataset
     has no Forever-new quests" in the UI.
   - **Adopted (ARCHITECTURE §1, §5.3, §5.5, §12.4; D-013, D-026).** Custom quests are
     first-class: they keep a real ID when known, and invented quests use negative IDs; a custom
     quest may carry null XP and its own `starterLocation`/`finisherLocation`
     (`src/domain/project.ts`). Unknown quest IDs are warnings. The provenance vocabulary is
     D-026's `RecordProvenance` (it supersedes D-007's vocabulary; D-007's principle stands):
     every dataset record ships `foreverStatus: 'unknown'`, `upstreamDiff` states what QuestieDB
     shows, and a user can declare a quest new or changed through `questOverrides`. The manifest
     carries the upstream commit, the builds and `foreverContentVerified: false` (DATA_PROVENANCE
     §8, D-026), and Details shows "Forever status: unknown" as text.
4. **Continents are data, not an enum.** Support Zephras Isle (Map 2991 / UiMap 2521, parent 947) as
   a third continent reachable only by transport. Keep Darkspear Islands out of the leveling zone
   list (it is a battleground).
   - **Adopted (ARCHITECTURE §6, §7.1-7.2, §9.3; D-018).** Map surfaces are keyed by world map ID
     (`'world:0' | 'world:1' | 'world:2991' | ...`); cross-world moves need a transport step.
     UiMap 2521 (and the second Zephras map 2665) are among the 12 DB2-only UiMapAssignment rows
     (11 UiMaps; Azeroth 947 has one row per continent) committed in
     `public/maps/placeholder/geometry.placeholder.json` at build 1.60.1.70009 (D-018, D-026).
5. **Travel graph from client tables.**
   - Build nodes and edges from `TaxiNodes`/`TaxiPath` (faction from flags bit0/bit1, deprecated
     `zzOLD` and `Quest Path` nodes excluded), transports from `TaxiPathNode` stop delays, and
     hearthstone / Second Home as special edges.
   - Pin the client build in the manifest.
   - Mark edges `verifiedActive: false` until observed, and let the optimiser optionally exclude
     unverified edges.
   - A small reproducible extractor (like the method in section 13) can regenerate this per build.
     The redistribution terms of Blizzard-derived tables are an open question (section 10 / DATA_PROVENANCE).
   - **Superseded by D-022 and D-024 (ARCHITECTURE §9.1, §19 item 3).** Clean deploys do not build
     the taxi graph from committed `TaxiNodes`/`TaxiPath` tables. `src/rules` seeds a `TravelGraph`
     of transports (`{ id, from, to, waitS, rideS, factions, basis }`; wait and ride times are
     assumptions) and taxi nodes identified by `TaxiNodeRef { npcId, taxiNodeId, name }`: dataset
     flight masters (`npcFlags` FLIGHT_MASTER) by NPC, and the new Forever nodes of section 6.4,
     which have no dataset NPC, by their cited TaxiNodes id. Edges exist only where known.
     Taxi-derived leg timings are **local-only by default** (D-022); without them a flight leg
     costs straight-line distance × a detour factor (`assumption`; its default is a cited
     aggregate client statistic) at 32 yd/s (`era-assumed`, D-024). Revision 2 has no
     `verifiedActive` flag and no optimiser switch for unverified edges; transport edges carry a
     `basis`. The extractor idea
     is limited by D-011: `tools/maps` reads a developer's own exports and never scripts
     wago.tools. The redistribution question is settled for docs and tests by D-022 (individual
     cited values allowed; bulk tables local); committing taxi-derived data stays an owner decision
     (ARCHITECTURE §19 item 3).
6. **Movement model.** The base speed table (run, mount 60%/100%, Ghost Wolf, Travel Form, Cheetah,
   Sprint, Skysight) comes from the client. Mount availability is gated by level (40/60) plus the
   `UNKNOWN` training cost. No flying.
   - **Adopted in part (ARCHITECTURE §8.2, §9.1-9.2).** `runSpeed` 7.0 yd/s and mount levels 40/60
     with TBC-style riding (`client-data`; training cost unknown). Riding trained before the route
     is `character.riding` (0 none, 1 apprentice, 2 journeyman); during the route it changes only
     through `train` steps, recognised as riding by `skill: 'riding'` or by a `spellId` in the
     ruleset's riding spell ids (Apprentice 33388 and Journeyman 33391, section 6.1). Ability
     speed buffs (Sprint, Ghost Wolf, Travel Form, Cheetah, Skysight) are not among the
     revision 2 ruleset values.
7. **Per-zone coordinate frames.** Four zones changed frame (Mulgore, Stormwind City, EPL,
   Redridge). Never reuse Era percentages for them. Store coordinates with their frame/build.
   - **Adopted (ARCHITECTURE §6, §10; D-017).** A zone-percent `SourcedPoint` records its frame
     (`'forever' | 'era'`), and `eraToForever` is applied only to `frame: 'era'` points on UiMaps
     1412, 1423, 1433 and 1453. A world-space point keeps the UiMap an RXP goto named alongside it
     (`uiMapId`, or null; `src/domain/points.ts`). RXP import tags percent points on those four
     maps with the import option's frame (Forever by default) and emits `RXP030-frame-ambiguous`.
     Dataset spawns ship as QuestieDB publishes them (Forever frame, keyed by AreaID) and are
     converted to world points at load; the Era→Forever transform is never re-applied to them.
   - **Superseded in part by D-017 and D-026 ("store ... with their build"):** a `SourcedPoint`
     carries its frame but no build (D-017). The project records its data frame build
     (`gameBuild`, ARCHITECTURE §8.2), and each committed geometry row records its own source and
     build (D-026).
8. **Validator rules.** Forever-specific checks:
   - quest-log cap (configurable: 20 Era, 40 beta, launch `UNKNOWN`);
   - race/class matrix (56 pairs, from CharBaseInfo);
   - faction of flight nodes and transports;
   - level-gated mounts;
   - hearthstone and Second Home sharing one cooldown.
   - **Adopted in part (ARCHITECTURE §9.1-9.4; D-012).** Quest-log capacity comes from the ruleset
     (40 in `forever-beta` as `client-data`, from the client constant in section 7, with server
     enforcement at launch unknown; 20 in `era-1.15`). Race and class masks use arithmetic bit tests.
     Transports carry `factions`. Revision 2 adds checks for a flight to an unknown path, a hearth
     on cooldown (the walker waits and warns) and cross-world travel without a transport. Second
     Home is not modelled: `CharacterState` has one hearth bind point, consistent with section 8.1
     ("model them as unavailable by default").
9. **Beta volatility.** Weekly builds change quests, respawns and tuning (S6). Keep rules and data
   regenerable, and add a "rules as of build X" banner. Re-check the unknowns table at launch
   (4 Nov 2026).
   - **Adopted (ARCHITECTURE §9.1, §12.4).** `RuleValue.build` records the build of a client value,
     and the bottom bar shows data and ruleset badges.

## 13. How the client-data claims were produced (reproducible)

**Superseded by D-011 as a procedure: wago.tools is a manual cross-check only; never scripted or
run in CI** (its `robots.txt` disallows crawling). This section records how the Milestone 0 values
were obtained, so that a reader can check an individual value by hand. It is not a pipeline to
re-run by script.

- Source URL template (research fetches, one table and build at a time):
  `https://wago.tools/db2/<Table>/csv?build=<build>`, for
  - builds `1.60.1.69977`, `1.60.1.70009` and `1.15.9.69722`;
  - tables `QuestXP, TaxiNodes, TaxiPath, TaxiPathNode, SpellName, Spell, SpellEffect, SpellLevels,
    SpellCooldowns, SpellCategories, SpellCategory, SpellMisc, SpellDuration, SkillLineAbility,
    ItemSparse, CharBaseInfo, ChrRaces, ChrClasses, AreaTable, UiMap, Map, LFGDungeons, ContentTuning`.
- Build list: `https://wago.tools/api/builds` (key `wow_classic_beta`, versions `1.60.*`).
- Scratch files and throwaway Python diff scripts are in
  `<repo>/.cache/experiments/forever-rules/` (gitignored):
  `taxi_diff.py`, `path_diff.py`, `spells.py <spellIds>`, `aura.py`.
- Caveats:
  - The Era 69722 `SpellEffect` export has `EffectBasePointsF` = 0 for every row, so Era spell
    magnitudes were **not** compared. Only Forever magnitudes are reported.
  - Column names come from wago.tools/WoWDBDefs. Aura numbers are decoded with the TrinityCore enum.
  - Nothing was read from inside `<wow-install>` except the version column of `.build.info`, and
    nothing there was modified or launched.
