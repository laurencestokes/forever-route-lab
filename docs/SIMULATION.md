# Simulation and validation rules (spec)

> Milestone 0 research, written 2026-09-25 by the Simulation research role. **Revision 2
> (2026-09-25)** aligns it with [ARCHITECTURE.md](ARCHITECTURE.md) revision 2 and
> [DECISIONS.md](DECISIONS.md) D-001 to D-026, after the independent critique
> ([reviews/review-m0-architecture.md](reviews/review-m0-architecture.md); finding IDs such as
> DSO-05 or LIC-07 refer to it). It also applies the architect's rulings on the Milestone 0
> consistency check and the domain types in `src/domain/*.ts` (section 1.4).
>
> This is the **rules spec** that the simulator (XP, levels, time) and the route validator (quest
> availability) are implemented and unit-tested against. ARCHITECTURE §9.4 names section 7 as the
> authoritative rule and code list. Every rule has an ID (`XP-3`, `TIME-5`,
> `VAL-7`, `SIM-4`, ...), a provenance label, and a source ID from section 11. Where this file and
> ARCHITECTURE, DECISIONS or the domain types in `src/domain/` disagree, those win and this file
> must be fixed.
> Recommendations of the first draft that revision 2 replaced are kept where they carry evidence
> and are marked **Superseded by ...**.
>
> **Milestone 6 edits (2026-09-26)** apply terrain-navigation.md §18's TIME-2 edit (ground legs
> come from the `TravelModel`), add the ruleset parameter `swimSpeed` and the travel-warning codes
> SIM-17..21, and fix the errata found while implementing `src/rules` and `src/sim`. Section 1.5
> lists them; each edited rule says so in place.
>
> Forever-specific *game* facts (zones, Legacy perks, transports, beta caps) are owned by
> [`research/forever-game-rules.md`](research/forever-game-rules.md). This file owns the **Classic-family
> mechanics** and says, for each one, whether Forever is known to match. Where Forever is unknown,
> the Era rule is the default, and the ruleset must say so visibly (section 1.2).

## 0. Summary

1. **XP to level (1-59) is the Classic table.** Three independent sources agree exactly: the cmangos
   `player_xp_for_level` table, the warcraft.wiki.gg vanilla/Classic table, and the closed-form
   formula rounded to the nearest 100. Total XP from 1 to 60 is **4,084,700**. Forever: the curve is
   *reported* unchanged, but the server owns it, so from data it is `UNKNOWN`; the `forever-beta`
   ruleset carries it with basis `era-assumed` (section 2).
2. **Quest XP = `QuestXP.db2[questLevel][difficulty]`, reduced by level difference and rounded.**
   QuestieDB's `support/Forever/QuestXP/xpDB-classic.lua` stores `{questLevel, fullXP}` per quest.
   3,492 of its 3,494 values are exact cells of the client's `QuestXP` table, which is byte-identical
   in Era 1.15.9.69722 and Forever 1.60.1.69977/70009. Reduction: 100% up to 5 levels above the
   quest, then 80/60/40/20%, then 10% from 10 levels above. The result is rounded to steps of
   5/10/25/50 (TrinityCore `RoundXPValue`, reproduced by Questie). **The QuestieDB Forever file is a
   byte copy of the Era file.** Forever per-quest XP (especially for dungeon quests) is reportedly
   higher and is `UNKNOWN`. The open-world and dungeon quest-XP multipliers default to 1.0 with
   basis `assumption` and apply only to `era-seed` XP, never to user-entered values (section 3).
3. **Kill XP** (Era, from the two emulators): `base = 5 x playerLevel + 45`. It is +5% per mob level
   above the player (capped at +4 levels). Below the player it falls linearly to zero at the gray
   level, using the "zero difference" table. Elites give x2, or x2.5 in 5-player dungeons
   (emulator-only). The group bonus is x1.166/1.3/1.4 for 3/4/5 members, split by level share.
   The emulators label the group bonus "guesswork". Forever dungeon kill XP is reportedly cut
   hard. **Rested XP and group XP are off by default** (section 4).
4. **Difficulty colour (Era client).** The Era client colours by `d = questLevel - playerLevel`:
   `d >= 5` red, `d >= 3` orange, `d >= -2` yellow, `-d <= GetQuestGreenRange()` green, else grey.
   The green range is 4/5/6/7/8/9/10/11/12 by player-level band. **Forever loads the Mainline UI
   (game type `camelot`).** There the quest log colour comes from a C API, and the Lua fallback
   uses `d >= -4` for yellow with `UnitQuestTrivialLevelRange`. The Forever thresholds are
   therefore `UNKNOWN`. Questie applies the Era thresholds on both clients (section 5).
5. **Colour never gates quest availability.** Grey quests stay legal and give reduced XP.
6. **Time model.** Run speed is 7.0 yd/s (`ERA RULE`). Ground legs come from one `TravelModel`
   shared with the engine and the optimiser: the straight line x `groundDetourFactor` by default, or
   the committed navigation data (TIME-2, Milestone 6). Mounts give +60%/+100% (`SOURCE DATA`,
   Forever spells 86457/86458), but only once riding is trained: from the declared
   `character.riding`, or through a `train` step recognised as riding by `skill: 'riding'` or by a
   riding spell id in the ruleset (Apprentice 33388, Journeyman 33391) (TIME-3). The
   hearthstone has a 10 s cast and a 60 min cooldown (`SOURCE DATA`, both builds); a hearth used on
   cooldown waits and warns (TIME-4). **Flights are timed from the committed client taxi file's
   path lengths at 32 yd/s (the emulators' taxi speed, `era-assumed`)** wherever it covers the
   journey (TIME-6; D-039 B commits the file, which settles OD-6). **The fallback, when the file
   fails to load or does not cover a journey, is straight-line distance x `taxiDetourFactor` (1.4,
   `assumption`, a cited aggregate client statistic) / 32 yd/s** (TIME-5, D-024). The first draft's
   default, a model fitted against RXPGuides' flight table, is superseded (research note R-1).
   Transports cost an assumed wait plus ride. Every move between world maps needs a transport, a
   hearth, or a zero-wait instance entrance edge (TIME-7).
7. **Validator.** Availability is the conjunction of about 20 predicates over QuestieDB fields,
   defined in section 7 from Questie `QuestieDB.IsDoable` and the vmangos `Player::CanTakeQuest`.
   The implemented rule list is **VAL-1..22, VAL-30..33 and LINT-1..4** (there is no VAL-23..29),
   plus the simulation checks **SIM-1..22** and the data codes **DATA001-002**; ARCHITECTURE §9.4
   names section 7 as the authoritative list. Issue codes follow one grammar, for example
   `VAL004-min-level` (section 7.8). The engine must use the **corrected** records: the raw Forever
   quest file has **zero** breadcrumb and `requiredMaxLevel` fields, and the legacy corrections add
   205/150/42 of them. Race masks reach bit 33 (Skyborne), so **JavaScript bitwise operators must
   not be used** on `requiredRaces`.
8. **Unknown stays unknown.** A turn-in with unknown XP adds nothing, increments `unknownXpEvents`
   and makes every later level a lower bound. Level checks that fail only on the lower bound become
   `-uncertain` warnings, and a grind step with a level target (with or without an XP offset) makes
   the level known again (XP-4, TIME-12).
   Objective time and objective kill XP use the same assumed kill count (TIME-9).
9. **Work on objectives.** A multi-target `complete` step costs the largest target plus a
   concurrency share of the others; a `partial` step costs 0 s or its override. A turn-in of a
   quest the route accepted carries the time and kill XP of the objectives no step finished, without
   the travel to them, with a warning; for a quest that was in the log before the route (declared or
   assumed) they are "assumed completed incidentally" at 0 s, also a warning. Items a `complete`
   step collected before the accept count when the quest is accepted, so they are priced once
   (TIME-10, TIME-11, D-040).
10. **State before the route is declared.** `character.priorHistory` (`fresh`, `listed` or
    `unknown`), `priorCompletedQuests`, `priorQuestLog` and `riding` seed the walker. With
    `priorHistory: 'unknown'`, unmet prerequisites are `-unverifiable` warnings, not errors
    (section 7.1, 7.6).

---

## 1. Conventions

### 1.1 Provenance labels (research evidence)

| Label | Meaning |
|---|---|
| `ERA-CLIENT` | Read from the Classic Era client: Blizzard UI source (Gethe mirror, `classic_era` branch, 1.15.9.69722) or a DB2 export of build 1.15.9.69722 |
| `FOREVER-CLIENT` | Read from the Forever client: Gethe `forever` branch (1.60.1.70009) or a DB2 export of 1.60.1.69977/70009. This says what the client ships, **not** what the server does |
| `ERA-EMU` | Classic 1.12 behaviour as re-implemented by open-source emulators (vmangos, cmangos-classic). These are reconstructions, not Blizzard code |
| `QUESTIE` | Behaviour of the Questie addon (master `40016145`), which runs on both Era and Forever |
| `DATA` | A property measured over the QuestieDB data at commit `b6f5b07` |
| `REPORTED` | Secondary or community source. See `research/forever-game-rules.md` for its reliability |
| `INFERRED` | Derived here from data consistency. The reasoning is given |
| `ASSUMPTION` | A default chosen here, with no source. Must be configurable |
| `UNKNOWN` | Not established. The Era rule applies as a visibly-labelled fallback |
| `CONFLICT` | Sources disagree. The chosen default is stated |

Section 6 also uses the three labels the brief asked for: **SOURCE DATA**, **ERA RULE**, **ASSUMPTION**.

These labels grade the research evidence in this file. At runtime every value carries the ruleset
`basis` vocabulary instead; section 1.2 maps one onto the other. Individual client-derived values
(DB2 rows, spell timings, TaxiNodes landmarks) appear in this file with table, build and column
cited, as D-022 allows; bulk client tables stay local.

### 1.2 Ruleset and assumptions (ARCHITECTURE §9.1, D-008)

> **Superseded by ARCHITECTURE §9.1 and D-008 (critique DSO-16, F24):** the first draft's nested
> `Ruleset` interface, its profile id `forever-1.60`, its provenance field `assumedFrom: "era-1.15"`
> and its `taxi.model: 'polyline-fit'` default. This section now states the rules the
> implementation follows.

**Rulesets.** `src/rules` exports two rulesets, `forever-beta` and `era-1.15` (the ids used by
`ProjectV1.rulesetId`). Every parameter is a `RuleValue<T>`:

```ts
interface RuleValue<T> { value: T; basis: 'client-data' | 'official' | 'reported' | 'era-assumed' | 'assumption';
                         source: string; build?: string; note?: string }
```

**Basis mapping.** A parameter's basis follows its best evidence:

| Research label (1.1) | Basis in `forever-beta` | Basis in `era-1.15` |
|---|---|---|
| `FOREVER-CLIENT`, SOURCE DATA read from a Forever build | `client-data` | n/a |
| `ERA-CLIENT` | `client-data` if the Forever client shows the same value, else `era-assumed` | `client-data` |
| Blizzard statement (`CONFIRMED` in forever-game-rules.md) | `official` | `official` |
| `ERA-EMU`, wiki, `QUESTIE` Era logic (ERA RULE) | `era-assumed` | `reported` |
| `REPORTED` | `reported` | `reported` |
| `INFERRED`, `ASSUMPTION` | `assumption` | `assumption` |
| `UNKNOWN` | the Era value, `era-assumed` | the best Era evidence |
| `CONFLICT` | the chosen default's own basis; `note` names the alternative | same |

`era-assumed` means "the Forever value is unknown and the Era rule is used". It appears only in
`forever-beta`.

**Precedence (DSO-16).** The effective value of a key is the project assumption when
`project.assumptions[key]` is set, else the active ruleset's value. It carries the provenance of
whichever supplied it: a project assumption is `{ value, basis: 'assumption', source: 'project' }`.
The keys a project can override are the fields of `AssumptionValues` (`src/domain/assumptions.ts`;
`project.assumptions` is `Partial<AssumptionValues>`, ARCHITECTURE §8.2). The table below uses
this spec's parameter names and gives the `AssumptionValues` field in its own column; a parameter
with no field there is ruleset-only in schema version 1. Adding a field is a schema change: it
bumps `schemaVersion` and adds a migration (**erratum, Milestone 6:** this sentence said such a
change was allowed without migration until the end of Milestone 6, which D-035 superseded by
freezing schema version 1 from the Milestone 4 commit). `maxLevel` in particular is overridable
so that the beta caps (20, then 30 [B1]) can be simulated. The UI marks every number that depends
on an effective value with basis `era-assumed` or `assumption` (section 8 gives the combination
rule).

Quest-level values are not ruleset keys: `QuestRecord.xp` carries its own basis (`era-seed`,
`user` or `forever-observed`; ARCHITECTURE §5.3), and custom quests and `questOverrides` supply
user values (ARCHITECTURE §5.5).

**Parameters** ("both" means the same default and basis in both rulesets; "—" in the override
column means ruleset-only):

| Parameter | `forever-beta` default (basis) | `era-1.15` default (basis) | Rule | Project override (`AssumptionValues`) |
|---|---|---|---|---|
| `maxLevel` | 60 (`official`, S1/S2 in forever-game-rules.md; set 20 or 30 to simulate beta caps) | 60 (`official`) | XP-3 | `maxLevel` |
| `xpToNextLevel` | XP-1 table (`era-assumed`; reported unchanged, R6) | XP-1 table (`reported`) | XP-1, TIME-12 | — |
| `questXpRounding` | `'trinity-steps'` (`era-assumed`; CONFLICT, alternative `'vmangos-ceil'`) | `'trinity-steps'` (`reported`; CONFLICT) | QXP-4 | — |
| `questXpMultiplier` | 1.0 (`assumption`; reports suggest about 2x, R5/R6/R10) | 1.0 (`reported`; the seed is Era quest XP) | QXP-3, QXP-5 | `questXpMultiplier` |
| `dungeonQuestXpMultiplier` | 1.0 (`assumption`; reports suggest much higher) | 1.0 (`reported`) | QXP-3, QXP-5 | `dungeonQuestXpMultiplier` |
| `maxLevelMoneyEstimate` | false (`assumption`) | false (`assumption`) | QXP-6 | — |
| `killXpRounding` | `'half-even'` (`era-assumed`) | `'half-even'` (`reported`) | KXP-6 | — |
| `eliteKillXpMultiplier` | 2.0 (`era-assumed`) | 2.0 (`reported`) | KXP-5 | — |
| `dungeonEliteKillXpMultiplier` | 2.5 (`era-assumed`; emulator-only, UNVERIFIED) | 2.5 (`reported`) | KXP-5 | — |
| `dungeonMobXpMultiplier` | 1.0 (`assumption`; reportedly much lower) | 1.0 (`reported`) | KXP-5 | — |
| `mobLevelChoice` | `'midpoint-floor'` (`assumption`) | both | KXP-4 | — |
| `zeroDifference` | KXP-2 table (`era-assumed`) | KXP-2 table (`reported`) | KXP-2 | — |
| `groupXpEnabled` | false (`assumption`; F23) | both | KXP-8 | `groupXp` |
| `groupXpRates` | 1.0, 1.0, 1.166, 1.3, 1.4 for 1-5 members (`era-assumed`; the emulators call them guesswork) | same (`reported`) | KXP-8 | — |
| `restedEnabled` | false (`assumption`) | both | KXP-9 | — |
| `greenRange` | COL-2 table (`era-assumed`; CONFLICT at levels 5-9) | COL-2 table (`reported`; CONFLICT) | COL-2 | — |
| `difficultyYellowLowerBound` | -2 (`era-assumed`; the Forever Lua fallback uses -4) | -2 (`client-data`) | COL-1, COL-4 | — |
| `questLogCapacity` | 40 (`client-data`: the Forever client constant at 70009, VAL-20; the `REPORTED` beta observation of 40, R9, supports it; `note`: server enforcement at launch is unknown, U13) | 20 (`client-data`) | VAL-20 | `questLogCapacity` |
| `runSpeed` | 7.0 yd/s (`era-assumed`) | 7.0 yd/s (`reported`) | TIME-1 | `runSpeedYps` |
| `swimSpeed` | 4.722 yd/s (`era-assumed`; section 6.1's emulator swim speed; navigation legs only; added in Milestone 6 for `TravelSpeeds.swimYps`) | 4.722 yd/s (`reported`) | TIME-1, TIME-2 | — |
| `groundDetourFactor` | 1.25 (`assumption`; the straight-line `TravelModel` and the navigation model's labelled fallback) | both | TIME-2 | `travelDetourFactor` |
| `mountLevels` | 40, 60 (`client-data`, ItemSparse 69977 `RequiredLevel`) | 40, 60 (`client-data`, ItemSparse 69722) | TIME-3 | — |
| `mountSpeedBonus` | 0.6, 1.0 (`client-data`, spells 86457/86458) | 0.6, 1.0 (`client-data`, aura 32 on mount spells) | TIME-3 | — |
| `ridingSpells` | 33388 Apprentice Riding = tier 1, 33391 Journeyman Riding = tier 2, as `{ spellId, tier, name }` entries (`client-data`, SpellName and SkillLineAbility rows cited as C4 in forever-game-rules.md section 6.1; the tier-to-speed mapping is `INFERRED`) | none (`client-data`: neither spell exists in Era 69722; Era riding is recognised by `skill: 'riding'` only) | TIME-3 | — |
| `hearthCastSeconds` | 10 (`client-data`) | 10 (`client-data`) | TIME-4 | — |
| `hearthCooldownSeconds` | 3600 (`client-data`; a server override is UNKNOWN) | 3600 (`client-data`) | TIME-4 | — |
| `taxiModel` | `'auto'` (`assumption`: TIME-6 legs where the committed taxi file covers the journey, else TIME-5); `'straight-line'` forces TIME-5 | both | TIME-5, TIME-6 | — |
| `taxiSpeed` | 32 yd/s (`era-assumed`; emulator constant) | 32 yd/s (`reported`) | TIME-5, TIME-6 | `taxiSpeedYps` |
| `taxiDetourFactor` | 1.4 (`assumption`; its value is a cited aggregate client statistic, TIME-5, allowed under D-022 and D-024) | both | TIME-5 | `taxiDetourFactor` |
| `taxiSpeedBonusPct` | 0 (`assumption`; Frequent Flier would be 20, `client-data` C7) | 0 (`assumption`) | TIME-5, TIME-6 | — |
| `transportWaitSeconds` | 60 (`assumption`) | both | TIME-7 | `transportWaitSeconds` |
| `transportRideSeconds` | 60 (`assumption`) | both | TIME-7 | `transportRideSeconds` |
| `acceptSeconds`, `acceptExtraSeconds` | 3, 2 (`assumption`) | both | TIME-8 | `interactionSeconds` sets `acceptSeconds` and `turninSeconds` |
| `turninSeconds`, `rewardChoiceSeconds` | 3, 2 (`assumption`) | both | TIME-8 | as above |
| `vendorSeconds`, `repairSeconds`, `trainerSeconds` | 10, 5, 10 (`assumption`) | both | TIME-8 | — |
| `bindSeconds`, `flightMasterSeconds` | 5, 3 (`assumption`) | both | TIME-4, TIME-5 | — |
| `lootSeconds` | 2 (`assumption`) | both | TIME-8, TIME-9 | `lootSeconds` |
| `objectUseSeconds` | 5 (`client-data`, spell 3365 `SpellMisc.CastingTimeIndex` 6, `SpellCastTimes` 6 = 5,000 ms, 1.60.1.69977) | 5 (`client-data`, the same rows in 1.15.9.69722) | TIME-8, TIME-9 | — |
| `skinSeconds` | 2 (`client-data`, spell 8613 `SpellMisc.CastingTimeIndex` 5, `SpellCastTimes` 5 = 2,000 ms, 1.60.1.69977) | 2 (`client-data`, the same rows in 1.15.9.69722) | TIME-8 | — |
| `killSeconds` | 30 (`assumption`; calibrate per class) | both | TIME-9, TIME-12 | `secondsPerKill` |
| `objectiveKillCount` | 8 (`assumption`) | both | TIME-9 | `killsPerObjective` |
| `objectiveItemCount`, `itemDropChance` | 5, 0.5 (`assumption`) | both | TIME-9 | — |
| `objectiveUseCount`, `objectSearchSeconds` | 6, 15 (`assumption`) | both | TIME-9 | — |
| `eventObjectiveSeconds` | 20 (`assumption`) | both | TIME-9 | — (see open question 10.14) |
| `objectiveConcurrency` | 0.5 (`assumption`; ARCHITECTURE §9.3's `concurrency`) | both | TIME-10 | `objectiveConcurrency` |
| `grindWarnSeconds` | 600 (`assumption`) | both | SIM-11 | — |

The objective defaults (`objectiveKillCount` and the rows after it) are placeholders with no
source, added in revision 2 so that every objective has a defined cost. They should be calibrated
(open question 10.13). Three `AssumptionValues` fields have no rule in this file yet
(`groupSize`, `secondsPerObjective`, `killXpMultiplier`); until one is defined they are read as
1, unused and 1.0 (open question 10.14).

### 1.3 Revision 2 at a glance

| Change | Where | Driver |
|---|---|---|
| Ruleset ids `forever-beta`/`era-1.15`; provenance field `basis`; precedence rule; `maxLevel` overridable; `dungeonQuestXpMultiplier` | 1.2 | DSO-16, F24, D-008 |
| Default flight time = straight line x `taxiDetourFactor` / 32 yd/s; the RXP-referenced fit becomes research note R-1 | 6.3 | LIC-07, F17, D-019, D-024 |
| Polyline flight model only with a local DB2 extraction; taxi-derived timings local-only (the local data is now `local-maps/taxi.local.json`, section 1.4). **Superseded by D-039 B** (section 1.6): the committed taxi file gives TIME-6 in every build | TIME-6 | D-022 |
| Unknown XP: known-XP lower bound, `unknownXpEvents`, lower-bound levels, `-uncertain` variants | XP-4, 7.6 | DSO-05, F12 |
| Objective time and kill XP from one assumed count | TIME-9 | DSO-05 |
| Multi-target and partial `complete`; incidental completion at turn-in | TIME-10, TIME-11 | DSO-07, D-020 |
| Hearth destination from state and cooldown wait; transports; cross-world travel | TIME-4, TIME-7 | DSO-09 |
| Riding state set only by `train` steps with skill `riding` (**superseded** by the rulings in 1.4: the starting tier comes from `character.riding`, and a riding spell id also counts) | TIME-3 | DSO-16, F11 |
| Rule list, `-unverifiable`, VAL-22 as `needsEvent` only, repeatable exemption, SIM checks, code grammar | 7.6-7.8 | DSO-15, F24 |
| Group XP off by default | KXP-8 | F23 |
| Mapping of every rule to ARCHITECTURE §9 types | 8 | task of revision 2 |
| Cited client values in docs and tests allowed | 1.1, QXP-2, 6 | D-022, LIC-03 |
| Absolute local paths replaced by `<repo>/` | 11 | LIC-04 |

### 1.4 Rulings applied after the consistency check

The Milestone 0 consistency check listed residual conflicts between this file, ARCHITECTURE
revision 2 and DECISIONS. The architect ruled on them, and ARCHITECTURE, DECISIONS (D-024, D-026)
and `src/domain/*.ts` were patched. This file now follows those rulings:

| Ruling | Where applied |
|---|---|
| `questLogCapacity` in `forever-beta` is 40 with basis `client-data`; the `REPORTED` beta observation (forever-game-rules.md, R9) supports it; server enforcement at launch is unknown | 1.2, VAL-20 |
| The ruleset holds the riding spell ids (Apprentice 33388, Journeyman 33391, cited client values). A `train` step enables riding when `skill === 'riding'` or its `spellId` is in that table | 1.2, TIME-3 |
| `character.riding` (0, 1 or 2) seeds the riding state | TIME-3, 7.1; resolves 10.11 |
| `TrainStep.skillId` lets a profession `train` step raise `CharacterState.skills` | TIME-3, 7.1, 7.6 |
| `character.priorHistory`, `priorCompletedQuests` and `priorQuestLog` seed the walker; with `priorHistory: 'unknown'`, prerequisite checks are `-unverifiable` warnings | 7.1, 7.6, 7.8; resolves 10.10 |
| VAL-22 is an info on accept that never blocks (confirmed) | 7.2, 7.6, 7.8 |
| TravelGraph dock positions come from dataset dock NPCs or user-entered locations (**extended** in section 1.6: or the committed taxi file's matched stops, inferred) | TIME-7 |
| Zero-wait instance entrance edges from the dungeon entrances in `zones.json` make dungeon steps reachable | TIME-7; resolves 10.12 |
| Local per-leg taxi times live in the local extraction set as `local-maps/taxi.local.json` (dev/preview only) (**superseded** in section 1.6: the committed taxi file) | TIME-6 |
| The `taxiDetourFactor` default is a cited aggregate client statistic, allowed under D-022 and D-024 | 1.2, TIME-5; resolves the aggregate part of 10.7 |
| Grind level targets carry an offset (`xpInto`, `xpShort`, `fraction`) resolved with the XP table | XP-4, TIME-12, TIME-T |
| The coefficients fitted to RXPGuides flight times appear nowhere in the repository (D-024) | R-1 (checked; one statement that bounded a fitted coefficient was removed) |
| ARCHITECTURE §9.4 names section 7 as the authoritative rule and code list (SIM-1..16, DATA001-002, `VAL005-max-level-uncertain`) | 7.6-7.8 |
| Domain types: `AcceptStep.anyOf` and `TurnInStep.anyOf`, `Location.radius`, `TaxiNodeRef { npcId, taxiNodeId, name }`, `UnmappedAreaPoint`, `CharacterState.xpBasis`/`xpEraFallback`, `AssumptionValues` field names | 1.2, TIME-2, TIME-5, 7.2, 7.5, 8 |
| A `travel` step with a null location, and a preserved `.deathskip` note, make the position unknown (ARCHITECTURE §8.1) | TIME-2 |
| No absolute user paths; local files are written `<repo>/...` | throughout |

### 1.5 Milestone 6 edits and errata

Applied when `src/rules` and `src/sim` were implemented (2026-09-26). Errata are marked; the other
rows are additions or clarifications, confirmed by the architect in D-038 (item 10).

| Change | Where | Driver |
|---|---|---|
| Ground legs come from the `TravelModel` (`src/domain/travel.ts`); the straight-line model reproduces revision 2's formula; the nearest-spawn choice stays straight-line; a leg's warnings pass through as structured data | TIME-2 | terrain-navigation.md §18, D-028, D-037 |
| An arrival radius shortens a navigation leg in proportion, `(d − r) / d` of its seconds (ASSUMPTION); with the straight-line model this equals revision 2's formula | TIME-2 | Milestone 6 |
| New ruleset parameter `swimSpeed` (4.722 yd/s, the emulator value already cited in section 6.1) for `TravelSpeeds.swimYps` | 1.2, TIME-1 | `src/domain/travel.ts` |
| Travel-warning codes SIM-17..21 (`no-walking-path`, `off-navmesh`, `unverified-passage`, `ambiguous-floor`, `long-swim`), one issue per step and kind with a leg count; a pending leg is not an issue of its own step (see SIM-22) | 7.7, 7.8 | terrain-navigation.md §9.3, §18 |
| **Erratum:** pending legs are counted into one route-level info, `SIM022-legs-pending` (legs and steps pending; their times are the straight-line fallback until computed). This row said pending legs are not issues | 7.7, 7.8 | `src/validate` (Milestone 6) |
| **Erratum:** open question 15 said `VAL030-not-in-log`, `VAL032-not-in-log` and SIM-16 stay errors with `priorHistory: 'unknown'`. ARCHITECTURE §9.4 (which governs) makes quest-state preconditions on quests the route never accepted `-unverifiable` warnings, so the registry has `VAL030-not-in-log-unverifiable`, `VAL032-not-in-log-unverifiable` and `SIM016-complete-not-in-log-unverifiable`; question 15 is closed | 7.8, 10.15 | ARCHITECTURE §9.4 |
| **Erratum:** section 9 called quests 2, 23 and 24 an "exclusive triple"; the data links them with `inGroupWith` (their `exclusiveTo` lists are empty) | 9 | `public/data/quests.json` |
| The walks to and from the dock in a `'transport'` step travel as `'auto'` (mounted once riding is trained) | TIME-2 | Milestone 6 clarification |
| An NPC with no level range (or no record) counts as a same-level mob, as TIME-12 does for grind steps, and the simulation records that the level was assumed | KXP-4, TIME-9 | Milestone 6 |
| A `maxLevel` above the XP table (for example 70) caps at 60: XP past the table is unknown, so it is not granted | XP-3 | Milestone 6 |
| An unbound `hearth use` charges no cast and leaves `hearthReadyAt` unchanged | TIME-4 | Milestone 6 |
| TIME-6 flights also charge `flightMasterSeconds` | TIME-6 | Milestone 6 clarification |
| **Erratum:** KXP-8 step 5 said the gray-group share is `trunc(xp*rate/2) + 1` with `rate` read as the group rate; the table's last row (levels 10 and 30, 14 XP) needs the member's level share inside it, `trunc(xp × groupRate × level(i) / sumLevels / 2 + 1)` | KXP-8 | the KXP-8 table |
| **Erratum:** schema version 1 is frozen from the Milestone 4 commit (D-035); a new `AssumptionValues` field needs a migration | 1.2, 10.14 | D-035 |

**Milestone 6 review (2026-09-26).** The review of `src/rules`, `src/sim`, `src/engine` and
`src/validate` found places where this file contradicted itself or was silent; these rows record the
rulings the fixes follow. The architect confirmed every row in D-038.

| Change | Where | Driver |
|---|---|---|
| **Erratum:** QXP-3 checks the cap first: at `P >= maxLevel` quest XP is a known 0 even without an XP record or with an unknown quest level, because XP-2's `GiveXP` returns at the cap. The pseudocode checked the record first, so a missing record at the cap raised SIM-1 and made the level a lower bound for good | QXP-3, XP-4 | review SIM-01 |
| A known-XP lower bound at the effective cap is exact (XP-2), so reaching the cap resets `unknownXpEvents` as a grind to a level does | XP-4, §8 | review SIM-01 |
| `floor(reduce(B) × m)` is exact arithmetic on the decimal multiplier, not a floor of the double product (45 × 1.4 is 63, not 62) | QXP-3 | review SIM-03 |
| The level after an XP grant reads `xpToNextLevel` (always) and `maxLevel` (when the cap bounded the grant): both enter `levelAfter`'s basis and `assumptionsUsed` | §8 | review SIM-02 |
| A grind to a level at `xpPerHour` 0 is unreachable (SIM-15); only a null rate runs the kill loop | TIME-12 | review SIM-04 |
| A `durationOverride` also drops the facts about the work it replaces (SIM-15; for grind steps SIM-11 and SIM-2) | TIME-8, TIME-9, TIME-12 | review SIM-05, ENG-04 |
| A `complete` target the dataset lacks, or whose objective index the record lacks, is an unknown `s_i`: `S` is unknown and kill XP is taken with `f = 1`. New `DATA003-unknown-objective` (warning) for the index | TIME-10, 7.4, 7.8 | review SIM-06, ENG-05, ENG-06 |
| The cooldown wait takes the basis of the step durations since the last cast; after a step with unknown time since the cast it is unknown time with `SIM005-hearth-cooldown-uncertain` | TIME-4, §8, 7.7, 7.8 | review SIM-07, ENG-09 |
| A transport dock without a position is an unresolved place (SIM-3). A dock-only transport without a step location arrives somewhere unknown without SIM-4 (**erratum**: TIME-7 said SIM-4, which is for map changes without a transport) | TIME-7 | review SIM-08, ENG-07, ENG-08 |
| Raid kills: elites take `eliteKillXpMultiplier`; `dungeonMobXpMultiplier` applies on any instance map, raids included; a grind on an instance map kills dungeon mobs | KXP-5, TIME-12 | review SIM-09 |
| TIME-6 maps a dataset flight master to the local TaxiNodes row nearest it within 50 yd (`INFERRED`), and a row is usable when a known node of the character's faction maps to it | TIME-6 | review SIM-10 |
| `objectUseSeconds` and `skinSeconds` are `client-data` in both rulesets, with their build (**erratum**: "not checked in Era") | 1.2, 6.5 | review SIM-11 |
| Group-XP shares are float32, as vmangos and the reference | KXP-8 | review SIM-12 |
| **Erratum:** the riding parameter is `ridingSpells` (entries with a tier), as the ruleset names it | 1.2, TIME-3, TIME-T 23, SIM-10, §8 | review SIM-13 |
| From an unknown position the nearest spawn is undefined: an entity with spawns at more than one point leaves the position unknown. A move from an unknown position records `position-unknown` with its cause (not an issue) | TIME-2, 7.1 | review ENG-02, ENG-03, UI-16 |
| A start XP at or beyond the start level's span is carried over by XP-2, with the route-level warning `SIM023-start-xp-beyond-level` | 7.1, 7.7, 7.8 | review ENG-11 |

**D-040 (owner, 2026-09-26): carried objective work.** The owner decided that a turn-in carries the
work of objectives no `complete` step finished. The rows below are the implementation's readings,
confirmed by the architect in D-040 ("Rulings").

| Change | Where | Driver |
|---|---|---|
| **Erratum:** a turn-in of a quest an `accept` step of the route put in the log carries the TIME-9 time and kill XP of its open objectives, combined as TIME-10, without the travel to them; `VAL030-objectives-carried` (warning). Pre-route, assumed and failed quests keep the incidental rule. TIME-11 said every unfinished objective was incidental at 0 s and 0 kill XP | TIME-11, TIME-T 17, 33-37, 7.5, 7.8 | D-040 |
| The carried work is priced at the turn-in's level (the level at the start of the step) and at no point, as a `complete` step without a location: the open world for KXP-5 and the lowest drop NPC id for items. Where the work was done is not known, and the turn-in's place is not it (a first reading used the turn-in's place, so an item's drop NPC and a kill's instance multiplier could differ from the explicit route's) | TIME-9, TIME-11, TIME-T 37 | D-040; review D40-02 |
| The carried kill XP is granted before the quest XP (as a `complete` step just before the turn-in), so the quest XP and LINT-4 use the level after it; the fact carries that level with its basis for LINT-4 | TIME-11, QXP-3, 7.5 | D-040 |
| The turn-in's `xpGained` is kill XP plus quest XP by the §8 rule; unknown quest XP makes it unknown while the known kill XP is still granted. The fact carries that kill XP, and the route's known XP total (ARCHITECTURE §9.3) counts it, as the level does and as the known seconds of a step with unknown time count (TIME-13); both are lower bounds then | TIME-11, XP-4, §8 | D-040; review D40-04 |
| An entry in the log before the route that the route accepts again (VAL-1) keeps its pre-route progress, so it stays incidental; one abandoned and accepted again is carried | TIME-11, 7.1 | D-040 |
| `VAL030-objectives-carried` is a warning, like `VAL030-objectives-incidental`: the route's time is short by the travel to the carried work until a `complete` step prices it, and the warning asks for that step | 7.8 | D-040 |
| A `durationOverride` on the turn-in replaces the carried time (TIME-8) and drops SIM-15 for it; the kill XP and `VAL030-objectives-carried` stay. The fact's `time` (`counted`, `overridden` or `unknown`) makes the warning, Details and the Summary note say whether the turn-in's time includes the work: an override stands in for it, and an unknown time is not claimed | TIME-8, TIME-11, 7.8 | D-040; review D40-03 |
| An `item` objective a `complete` step priced while the quest was not in the log (SIM-16) is remembered in the state (`itemsBeforeAccept`, copied by checkpoints), and the `accept` that next puts the quest in the log marks it done (fact `objectives-before-accept`, not an issue): the items are in the bags, which the game counts at the accept (the review's reading, not checked in game here; the RXP guides rely on it with `.collect` before the accept). Quest-only drops that need the quest in the log are the route author's to order. Neither a later step (SIM-12) nor the turn-in prices it again | TIME-10, TIME-11, 7.1, TIME-T 35 | review D40-01 |
| **Ruled (architect, D-040):** kill, `killCredit`, object, spell and event work a `complete` step priced before the accept does not count toward the quest in game (SIM-16 says so), so it stays open after the accept and the turn-in carries it again. The route's time and XP then include the work twice, as the game would need it done twice. SIM-16 already warns on the early step. The RXP Forever guides have no such case (the 19 double-priced turn-ins before this fix were all item objectives) | TIME-10, TIME-11, TIME-T 36 | review D40-01 |

---

### 1.6 The committed client taxi file (D-039 B; map presentation steps MP.8 and MP.9)

The owner committed the client taxi graph (D-039 B, 2026-09-26), which settles OD-6: deployed
builds time flights from real path lengths. Applied on 2026-09-28 with the map presentation's
steps MP.8 and MP.9 (docs/research/map-presentation.md §9, §10).

| Change | Where | Driver |
|---|---|---|
| TIME-6 applies in every build that loads `public/maps/client/taxi.json`: its 286 flights (`TaxiPath` with `Cost` > 0 between nodes of maps 0 and 1, build 1.60.1.70009) with their `L3D` lengths are the per-leg data. A developer's local `taxi.local.json` has the same shape; the app does not load it | TIME-6 | D-039 B, OD-6 |
| TIME-5 is the fallback: while the file loads (the first walk), for good when it fails (HTTP, hash, format), and for a journey its flights do not cover | TIME-5, TIME-6 | D-039 B; map-presentation.md §9 |
| The TravelGraph's nodes carry the file's `TaxiNodes` rows: a dataset flight master takes the row nearest it within 50 yd (`INFERRED`), the other rows are nodes of their own and replace the cited seeds of the same ids | TIME-5, TIME-6 | ARCHITECTURE §9.1 |
| A seeded transport's dock takes the position of the file's transport stop it was matched to by hand (`inferred`, with its record); user docks and dock NPCs win over it. The file's other transport paths reach no TravelGraph record | TIME-7 | D-039 B, NAV-08 |
| The flight's `model` is `taxi-path` for TIME-6 (it was `local`) | TIME-6 | `src/sim/taxi.ts` |

**Travel review of the map rework (2026-09-30, findings TR-01 to TR-14).** Applied with the fixes;
the berth rule (TR-03) is the fixer's choice among the review's options and waits for the
architect's ruling.

| Change | Where | Driver |
|---|---|---|
| A transport step that names no record and no dock no longer chooses its service among inferred docks: they count as unpositioned for the choice, so the step stays unknown with SIM-3, as before the file loaded, until it names its transport | TIME-7 | TR-01 |
| A ride records its edge and where each dock's position comes from, with an inferred dock's client record (`transport-ride`, not an issue); Details words it ("dock position inferred from client transport path 11616, stop 1 of 2"). The map popover's "Add transport" adds the transport by id and no longer copies the inferred stop into `TransportRef.dock`, so the graph keeps it `inferred` | TIME-7 | TR-02; map-presentation.md §10 (MP-R32) |
| A walk to or from an inferred dock (a client berth, in the water beside the pier) prices its swimming yards at the ground speed and raises no SIM-21: the swim stands for the walk along the pier (assumption) | TIME-7 | TR-03 |
| The same-map transport rule fires only between navmesh components: at nav revision of 1.60.1.70009 that is Rut'theran ↔ Auberdine; Menethil and Southshore are one component (a swim across the water joins them), so the rule never fires there | TIME-7 | TR-06, NAV-08 |
| While the taxi file loads the results are provisional (`final` false, `taxiPending` true, with the note "loading the client taxi file"); they become final with the walk after it loads or fails | TIME-5, TIME-6 | TR-07 |
| A taxi node's factions are one source for the engine and the map: the committed row's sides when they name one, else the flight master's; a flight whose departure or destination is not open to the character's faction is still timed, with `SIM024-flight-faction` | TIME-5, TIME-6, 7.7 | TR-08 |
| A journey the file covers only through flight points the character does not know is timed by TIME-5 with `SIM007-flight-unknown-path-journey`; one the file does not cover at all stays the ordinary fallback, without an issue | TIME-6, 7.7 | TR-09 |
| The TravelGraph's taxi edges say which flights exist; their lengths are TIME-6's per-leg data only (`localTaxi`), and the report says which set the edges are (`edgeSource`) | TIME-6 | TR-13 |

## 2. Levels and XP required

### XP-1 XP to the next level (`ERA-EMU` + `ERA` wiki + formula; Forever `UNKNOWN`)

`xpToNext(L)` is the XP needed to go from level `L` to `L + 1`. `cumulative(L)` is the total XP
from 0 XP at level 1 to 0 XP at level `L`.

| L | xpToNext | cumulative(L+1) | L | xpToNext | cumulative(L+1) | L | xpToNext | cumulative(L+1) |
|---|---|---|---|---|---|---|---|---|
| 1 | 400 | 400 | 21 | 25,200 | 215,600 | 41 | 95,800 | 1,340,900 |
| 2 | 900 | 1,300 | 22 | 27,300 | 242,900 | 42 | 101,000 | 1,441,900 |
| 3 | 1,400 | 2,700 | 23 | 29,400 | 272,300 | 43 | 106,300 | 1,548,200 |
| 4 | 2,100 | 4,800 | 24 | 31,700 | 304,000 | 44 | 111,800 | 1,660,000 |
| 5 | 2,800 | 7,600 | 25 | 34,000 | 338,000 | 45 | 117,500 | 1,777,500 |
| 6 | 3,600 | 11,200 | 26 | 36,400 | 374,400 | 46 | 123,200 | 1,900,700 |
| 7 | 4,500 | 15,700 | 27 | 38,900 | 413,300 | 47 | 129,100 | 2,029,800 |
| 8 | 5,400 | 21,100 | 28 | 41,400 | 454,700 | 48 | 135,100 | 2,164,900 |
| 9 | 6,500 | 27,600 | 29 | 44,300 | 499,000 | 49 | 141,200 | 2,306,100 |
| 10 | 7,600 | 35,200 | 30 | 47,400 | 546,400 | 50 | 147,500 | 2,453,600 |
| 11 | 8,800 | 44,000 | 31 | 50,800 | 597,200 | 51 | 153,900 | 2,607,500 |
| 12 | 10,100 | 54,100 | 32 | 54,500 | 651,700 | 52 | 160,400 | 2,767,900 |
| 13 | 11,400 | 65,500 | 33 | 58,600 | 710,300 | 53 | 167,100 | 2,935,000 |
| 14 | 12,900 | 78,400 | 34 | 62,800 | 773,100 | 54 | 173,900 | 3,108,900 |
| 15 | 14,400 | 92,800 | 35 | 67,100 | 840,200 | 55 | 180,800 | 3,289,700 |
| 16 | 16,000 | 108,800 | 36 | 71,600 | 911,800 | 56 | 187,900 | 3,477,600 |
| 17 | 17,700 | 126,500 | 37 | 76,100 | 987,900 | 57 | 195,000 | 3,672,600 |
| 18 | 19,400 | 145,900 | 38 | 80,800 | 1,068,700 | 58 | 202,300 | 3,874,900 |
| 19 | 21,300 | 167,200 | 39 | 85,700 | 1,154,400 | 59 | 209,800 | **4,084,700** |
| 20 | 23,200 | 190,400 | 40 | 90,700 | 1,245,100 | | | |

**Cross-check (all exact, levels 1-59):**

- **Source A:** cmangos-classic `sql/base/mangos.sql` lines 7953-8012 (`player_xp_for_level`) [E3].
- **Source B:** the warcraft.wiki.gg "Experience to level", "Vanilla / Classic table" [W1]. The wiki
  also lists 217,400 for level 60, which is unused at the cap.
- **Source C:** the formula `round100((8L + Diff(L)) x (45 + 5L))`, where `Diff = 0` (L <= 28),
  1 (29), 3 (30), 6 (31), `5(L-30)` (32-59). It reproduces A for all 59 levels with **round to
  nearest** 100 [W1]. The wiki's "always rounded down" note belongs to the post-2.3 `RF` formula.
  Rounding down mismatches 27 levels. Computed in `<repo>/.cache/experiments/simulation/`.
- A third-party guide addon's Forever module (RXPGuides [N1], `DB/forever/db.lua:450-457`) hard-codes
  Era XP-to-level values for levels 56-58 that equal the table above. It is cited, not reused
  (D-019). This shows the guide authors assume the Era curve; it is not evidence of the server value.

**Forever:** the server owns the XP table (it is not a client DB2). The curve is `REPORTED`
unchanged (forever-game-rules.md section 3, R6), so it is `UNKNOWN` from data (U1 there). The
`forever-beta` ruleset uses the table above with basis `era-assumed` (section 1.2).

### XP-2 Level-up semantics (`ERA-EMU`)

- A single XP grant can cross several levels. Excess XP carries over. The loop runs until XP is
  below the next threshold or the cap is reached (vmangos `Player::GiveXP`, Player.cpp:3043-3056 [E1]).
- At `level >= maxLevel`, `GiveXP` returns immediately: no XP, and no rested XP is gained
  (Player.cpp:3030-3031, 17835-17836).
- Each quest's XP uses the level **at that turn-in**. Two turn-ins in a row are computed
  sequentially, so a level-up from the first changes the reduction for the second.
- Implementation: store `(level, xpIntoLevel)` (`CharacterState.level` and `.xp`, where `xp` is the
  XP into the current level). Never store a float total. Both are the known-XP lower bound of
  XP-4.

### XP-3 Level cap

| Ruleset | Cap | Label |
|---|---|---|
| Era | 60 | `ERA-CLIENT` (Questie `QuestiePlayer.IsMaxLevel`, QuestiePlayer.lua:69-72 [Q1]) |
| Forever launch | 60 | `CONFIRMED` (forever-game-rules.md section 3, S1/S2) |
| Forever beta | 20, then 30 | `CONFIRMED`/`REPORTED` (Blizzard news 24304160, 2026-09-17 [B1]) |

`maxLevel` is a ruleset key with a project-assumption override (section 1.2), so beta caps can be
simulated: `assumptions.maxLevel = 20` gives an effective value `{ 20, basis: 'assumption',
source: 'project' }`. A value above the XP table (for example 70) caps at 60, the last level the
table reaches: XP beyond it is unknown, so it is not granted (Milestone 6).

### XP-4 Unknown XP and lower-bound levels (ARCHITECTURE §9.2-9.3; DSO-05, F12)

- **When XP is unknown.** A quest's XP is unknown when it has no XP record (`QuestRecord.xp` is
  null: 750 dataset quests, QXP-1), when its quest level is null, 0 or below -1 (QXP-7), or when it
  is a custom quest without user-entered XP. Unknown XP is **never 0**.
- **At the turn-in:** `xp` and `level` are unchanged, `unknownXpEvents` increases by 1, `xpGained`
  is `{ value: null, basis: 'unknown' }`, and `SIM001-unknown-xp` (info) is emitted.
- **Lower bound.** From then on `CharacterState.xp` and `.level` are the known-XP lower bound (the
  level is written `P_lb`), and every later `StepEstimate` has `levelIsLowerBound: true` while
  `unknownXpEvents > 0`.
  Level-dependent rules run on `P_lb`: quest XP reduction (QXP-3), kill XP (KXP-3), colour (COL),
  VAL-4, VAL-5, SIM-10 and SIM-11. Caveat: quest XP computed at `P_lb` can slightly overstate the
  true value, because a higher true level can mean more reduction. This is accepted as part of the
  approximation and made visible by the lower-bound marker.
- **Uncertain checks.** A level check that fails only on the lower bound becomes its `-uncertain`
  warning variant instead of an error; section 7.6 lists every variant.
- **Reset.** A grind step with a level target (`until: { kind: 'level', level, offset }`, with
  any offset or none) makes the level known again: the step asserts that the character is at its
  target when it ends. The walker sets `unknownXpEvents = 0` after it, and its
  duration, computed from the lower-bound deficit, is an upper bound (`SIM002-grind-upper-bound`,
  TIME-12). A grind whose target is already at or below the lower bound does nothing and resets
  nothing. Grind steps with a duration target (`{ kind: 'duration', seconds }`) never reset.
- **At the cap (Milestone 6 review).** XP-2's `GiveXP` returns at the cap, so the level cannot
  change there: a quest without an XP record turned in at `P >= maxLevel` gives a known 0 (QXP-3
  checks the cap first) and adds nothing to `unknownXpEvents`, and a lower bound that reaches the
  effective cap (`min(maxLevel, xpToNextLevel.length + 1)`) is the true level. The walker then
  sets `unknownXpEvents = 0`, as a grind to a level does (`StepDelta.unknownXpReset`).
- Kill XP is never unknown: it is always computable from the assumed mob level (KXP-4).
- The optimiser counts known XP only and keeps unknown-XP quests as obligations
  (ARCHITECTURE §11.2 rule 6).

---

## 3. Quest XP

### QXP-1 What QuestieDB holds (`DATA`)

- File: `<repo>/.cache/questiedb/support/Forever/QuestXP/xpDB-classic.lua`.
- Shape: `QuestXP.db[questId] = {questLevel, fullXP}`. Each row carries a comment
  `-- Classic: L: A->B->C , TBC: ..., WOTLK: ...`.
- **The Forever copy is byte-identical to the Era file.** `cmp` reports them identical, and
  `support/Forever/provenance.json:721-725` records adopted SHA-256 = source SHA-256 = `9f5ca777...`.
  QuestieDB's DBC pass explicitly did **not** regenerate QuestXP because the "rows alone lack
  per-quest level/reward-index inputs" (provenance.json:471).
- In the dataset these values ship as `QuestRecord.xp = { questLevel, baseXp, basis: 'era-seed' }`
  (ARCHITECTURE §5.3).

Statistics measured here over the Forever data at `b6f5b07`:

| Measure | Value |
|---|---|
| XP rows | 3,494 (every row's quest exists in `foreverQuestDB.lua`) |
| Quests in `foreverQuestDB.lua` | 4,244 |
| Quests **without** an XP row | 750. Of these, 539 have questLevel >= 60, 395 are repeatable and 114 are class-restricted. Only about 211 are leveling-range quests |
| Rows whose `questLevel` differs from the quest DB | 0 |
| Rows where `fullXP` equals a cell of `QuestXP.db2[questLevel]` | **3,492 / 3,494**. The exceptions are quests 8194 and 8856 |
| Difficulty column used (0-7) | 0:2, 1:480, 2:283, 3:413, 4:385, **5:1,274**, 6:363, 7:292 |

**Meaning of the comment columns (`INFERRED`, for provenance only; never use them).**

- `A` is the stored value.
- `C = RoundXPValue(B)` holds for all 3,494 rows.
- `RoundXPValue(A) = B` holds for 3,261 rows (93.3%).
- `B` matches, for example, `RewMoneyMaxLevel / 0.6`-style values from 1.12 server data. That is how
  cmangos-classic derives quest XP (QuestDef.cpp:171-209 [E3]). The origin of `B` is not documented
  in Questie's generator (`ExternalScripts(DONOTINCLUDEINRELEASE)/questXp/`, which only covers
  MoP-style DB2 input).
- Conclusion: `RoundXPValue(QuestXP cell)` reproduces the original 1.12 quest XP for 93% of quests.
  That is evidence the Era server applies the step rounding (QXP-4).

### QXP-2 Client table (`ERA-CLIENT` = `FOREVER-CLIENT`)

`QuestXP.db2` has 100 rows (the ID is the quest level) and `Difficulty_0..9` columns. The CSV
exports of 1.15.9.69722, 1.60.1.69977 and 1.60.1.70009 are **byte-identical** (wago.tools, fetched
2026-09-25 [D1]; matches C1 in forever-game-rules.md). Sample rows, cited under D-022 (table
`QuestXP`, columns `Difficulty_0..9`, builds above): level 10 = `0,85,210,420,630,840,1050,1250,0,0`;
level 60 = `0,660,1650,3300,4950,6600,8300,9950,0,0`. The per-quest difficulty index is server
data. Only QuestieDB's precomputed `fullXP` gives it to us. Do not commit the DB2 itself (a bulk
client table, D-022). Use QuestieDB's per-quest values, and keep the DB2 as a verification input
only.

### QXP-3 Reduction by level difference (`ERA-EMU` x 2, `QUESTIE`, TrinityCore)

Let `P` be the player level at turn-in (the lower bound `P_lb` when `unknownXpEvents > 0`, XP-4),
`Q` the quest level, `B` the full XP (`QuestRecord.xp.baseXp`) and `basis` its XP basis.

```
if P >= maxLevel: xp = 0                       (money instead, QXP-6; checked first, XP-2)
if xp record is null, or Q is null, or Q == 0, or Q < -1:  xp = unknown   (XP-4, QXP-7)
if Q == -1: Q = max(requiredLevel ?? 1, P)                             (QXP-7, scaling quests)
if B == 0: xp = 0                              (difficulty column 0; a real zero)
mult = clamp(2*(Q - P) + 20, 1, 10)            // tenths
reduce(B) = questXpRounding == 'trinity-steps'
          ? RoundXPValue(floor(B * mult / 10))  // integer division, then QXP-4 steps (also at 100%)
          : ceil(float32(B) * float32(mult / 10))   // 'vmangos-ceil', QXP-4
if basis == 'era-seed':
  m   = dungeonQuest ? dungeonQuestXpMultiplier : questXpMultiplier
  xp  = floor(reduce(B) * m)                   // Questie: floor(xp * multiplier), QuestieXP.lua:85; exact, see below
else:                                          // 'user' or 'forever-observed'
  xp  = mult == 10 ? B : reduce(B)             // no multiplier; value used as entered at 100%
```

- **Superseded (DSO-16, F12):** the first draft's `xp = RoundXPValue(raw) * ruleset.questXp.multiplier`
  applied one multiplier to every quest. Revision 2 applies the multiplier only to `era-seed` XP (so
  a user-entered Forever value is not scaled twice), picks the dungeon multiplier for quests with
  `QuestRecord.dungeonQuest` (derived at extraction from `zoneOrSort`, ARCHITECTURE §5.3) and floors
  the product as Questie does.
- A user-entered or Forever-observed value is taken as the full (100%) XP the game showed, which is
  already rounded; it is reduced and rounded only when the level difference reduces it.
- **Order (erratum, Milestone 6 review).** The cap comes first: at the cap no XP is granted (XP-2),
  so a missing record or an unknown quest level there changes nothing and is not unknown XP. The
  first revision checked the record first.
- **Exact floor (Milestone 6 review).** `floor(reduce(B) × m)` is exact arithmetic: `reduce(B)` is an
  integer and `m` a decimal the user enters, so the product is floored with an epsilon that absorbs
  float noise (`floor(x × m + 1e-9)`, as TIME-12's fraction offset does). A double product of a
  decimal multiplier can fall just below an integer (45 × 1.4 is 62.99999999999999 in doubles), so
  flooring it directly, as Questie's Lua does, loses 1 XP for common multipliers such as 1.15, 1.4
  and 2.3. Vectors: 45 × 1.4 = 63, 100 × 1.15 = 115, 50 × 2.3 = 115, 90 × 0.7 = 63.

| `P - Q` | <= 5 | 6 | 7 | 8 | 9 | >= 10 |
|---|---|---|---|---|---|---|
| Percent of `B` | 100 | 80 | 60 | 40 | 20 | 10 |

- **Four sources agree on the steps:**
  - vmangos `Quest::XPValue` (QuestDef.cpp:180-202 [E1]);
  - cmangos-classic `Quest::XPValue` (QuestDef.cpp:193-204 [E3]);
  - TrinityCore 3.3.5 `Quest::GetXPReward` (QuestDef.cpp:213-219 [E4]);
  - Questie `getAdjustedXP`, which says it is "fetched from cmangos" (QuestieXP.lua:59-86 [Q1]).
- A quest below the player's level (`Q > P`) never gives more than 100%.

### QXP-4 Rounding (`CONFLICT`; default `trinity-steps`)

| Variant | Rule | Source |
|---|---|---|
| **`trinity-steps` (default)** | `RoundXPValue(x)`: `x<=100 -> 5*floor((x+2)/5)`; `x<=500 -> 10*floor((x+5)/10)`; `x<=1000 -> 25*floor((x+12)/25)`; else `50*floor((x+25)/50)`. Applied **after** the multiplier, including at 100% | TrinityCore QuestDef.cpp:499-509 [E4]; Questie QuestieXP.lua:75-83 (float input, but provably the same result because the fraction is < 1 and every step boundary is an integer) |
| `vmangos-ceil` | `ceil(B * pct)`, no step rounding; the product is float32 as in vmangos (reference: `Math.ceil(fround(fround(B) * fround(pct)))` in `vectors.mjs`, which is why 335 at 60% gives 202) | vmangos QuestDef.cpp:188-199; cmangos QuestDef.cpp:193-204 |

"After the multiplier" in the table means after the level-difference multiplier `mult`; the
Forever quest-XP multipliers of QXP-3 apply after rounding.

The default follows Questie and the data evidence in QXP-1 (the 1.12 values are the rounded ones).
The emulators store the already-final 1.12 values, so at 100% they need no rounding. Their reduced
values can differ by a few XP (see QXP-T below). No in-game Era/Forever measurement of reduced
quest XP was found (`UNVERIFIED`). Ruleset key: `questXpRounding`.

### QXP-5 Buffs and bonuses

- **Era:** Questie adds temporary buffs to the multiplier: Darkmoon Faire 46668 (+10%), Hallow's End
  24705/95987 (+10%), and "Joyous Journeys" 377749 (+50%) (QuestieXP.lua:133-157). These are
  estimates. They are not modelled in v1; if added, they add to `m` in QXP-3. Default: none.
- **Rested XP never applies to quests.** vmangos grants the rested bonus only when a `victim` is
  passed (Player.cpp:3036-3037). Quest rewards call `GiveXP(xp, nullptr)` (Player.cpp:13155).
- **Forever:** dungeon-quest XP is reportedly "much, much, much higher", and open-world quest XP is
  reportedly around 200% of Classic. `REPORTED` (forever-game-rules.md section 3, R5, R6, R10).
  The ruleset provides `dungeonQuestXpMultiplier` and `questXpMultiplier`, both 1.0 with basis
  `assumption` in `forever-beta` (section 1.2). The first draft's label `assumedFrom: era` for them
  is superseded by ARCHITECTURE §9.1.

### QXP-6 Max level: XP becomes money (`ERA-EMU`)

- At `P >= maxLevel`, no XP is given. From patch 1.10 the quest instead pays `RewMoneyMaxLevel`
  copper (vmangos Player.cpp:13151-13157 and QuestDef.cpp:212-225, with the 1.10 patch-note comment).
- `RewMoneyMaxLevel` is a per-quest server field. **QuestieDB does not carry it.**
- cmangos-classic implies `RewMoneyMaxLevel = 0.6 x fullXP` for `Q <= 60` (it computes
  `fullxp = RewMoneyMaxLevel / 0.6`, QuestDef.cpp:180-191).
- The simulator may estimate level-60 money as `0.6 x B` copper (`INFERRED`, off by default:
  `maxLevelMoneyEstimate = false`) and must label it as an estimate. Forever: `UNKNOWN`.

### QXP-7 Edge cases

| Case | Rule | Source |
|---|---|---|
| Quest without an XP row | XP is `UNKNOWN`, **not 0**. Show "XP unknown", apply XP-4 and allow a user override | `DATA` (750 quests) |
| `questLevel == -1` ("scaling") | Effective quest level = `max(requiredLevel, P)`, as in Questie `GetEffectiveQuestLevel`. Questie's XP for level <= 0 is 0; TrinityCore uses `P` | QuestieLib.lua:221-234; QuestieXP.lua:98-101; TC QuestDef.cpp:208 |
| `questLevel == 0` (14 quests) or null | Unknown level: XP unknown (XP-4) and flag. **Superseded:** the first draft gave XP 0 here, following Questie; ARCHITECTURE principle 3 and DSO-05 make it unknown (`QuestRecord.level` is `number \| null`, no pad-to-0) | `DATA` |
| `requiredLevel > questLevel` (31 quests) | Legal. Reduction uses `questLevel` | `DATA`, QXP-3 |
| Repeatable quests | Each turn-in pays again (if an XP row exists) | VAL-3 |
| Custom quest without XP | XP unknown (XP-4) until the user enters it (`basis: 'user'`) | ARCHITECTURE §5.5 |

### QXP-T Test vectors (default ruleset; `vmangos-ceil` shown for contrast)

| B | Q | P | P-Q | xp (`trinity-steps`) | xp (`vmangos-ceil`) |
|---|---|---|---|---|---|
| 1000 | 20 | 18 | -2 | 1000 | 1000 |
| 1000 | 20 | 20 | 0 | 1000 | 1000 |
| 1000 | 20 | 25 | 5 | 1000 | 1000 |
| 1000 | 20 | 26 | 6 | 800 | 800 |
| 1000 | 20 | 27 | 7 | 600 | 600 |
| 1000 | 20 | 28 | 8 | 400 | 400 |
| 1000 | 20 | 29 | 9 | 200 | 200 |
| 1000 | 20 | 30 | 10 | 100 | 100 |
| 1000 | 20 | 45 | 25 | 100 | 100 |
| 335 | 5 | 5 | 0 | 340 | 335 |
| 840 | 10 | 10 | 0 | 850 | 840 |
| 910 | 12 | 12 | 0 | 900 | 910 |
| 980 | 13 | 19 | 6 | 775 | 784 |
| 335 | 5 | 12 | 7 | 200 | 202 |
| 2450 | 30 | 36 | 6 | 1950 | 1960 |
| 85 | 10 | 16 | 6 | 70 | 68 |
| 4400 | 48 | 58 | 10 | 440 | 440 |
| 6600 | 60 | 59 | -1 | 6600 | 6600 |
| 6600 | 60 | 60 | 0 | **0** (cap) | 0 (cap; vmangos pays money) |

`RoundXPValue` boundaries: 2->0, 3->5, 87->85, 88->90, 100->100, 101->100, 104->100, 105->110,
495->500, 512->500, 513->525, 1024->1000, 1025->1050, 2449->2450. The Questie unit test agrees:
`{20, 1000}` at P=27 gives 600, and at P=60 with `ignorePlayerLevel` gives 100
(QuestieXP.test.lua:25-31, 119-123).

**QXP-T2 Multiplier and basis vectors (revision 2; `trinity-steps`):**

| B | Q | P | XP basis | dungeonQuest | `questXpMultiplier` / `dungeonQuestXpMultiplier` | xp |
|---|---|---|---|---|---|---|
| 1000 | 20 | 20 | era-seed | no | 2.0 / 1.0 | 2000 |
| 335 | 5 | 5 | era-seed | no | 1.5 / 1.0 | floor(340 x 1.5) = 510 |
| 2450 | 30 | 30 | era-seed | yes | 2.0 / 3.0 | 2450 x 3 = 7350 |
| 1234 | 20 | 20 | user | no | 2.0 / 1.0 | 1234 (as entered; no multiplier) |
| 1234 | 20 | 26 | user | no | any | RoundXPValue(987) = 975 |
| (no record) | 20 | 20 | n/a | no | any | unknown; `unknownXpEvents` + 1; SIM001 |

---

## 4. Kill XP, group XP, rested XP

All rules in this section are `ERA-EMU`. vmangos `Formulas.h` [E1] and cmangos-classic
`Tools/Formulas.h` [E3] implement them identically except where noted. **Forever is `UNKNOWN`.**
Dungeon mob XP is reportedly "brought way down" by design (forever-game-rules.md section 3, R5, R6,
U3), so `dungeonMobXpMultiplier` must exist.

### KXP-1 Gray level

The mob is gray (0 XP) if `M <= grayLevel(P)`:

```
grayLevel(P) = 0                          if P <= 5
             = P - 5 - floor(P/10)        if 6 <= P <= 39
             = P - 1 - floor(P/5)         if 40 <= P <= 59 (and 60 in vmangos)
```

Sources: vmangos Formulas.h:36-44. cmangos's `GetGrayLevel` returns `P - 9` at 60+, which is a TBC
value (Formulas.h:306-315). However, its XP check `IsTrivialLevelDifference` uses the green-range
table (`diff > GetQuestGreenRange(P)`, Formulas.h:240-302), which gives 47 at 60. For every `P >= 5`
this equals `P - greenRange(P) - 1` (proved by the band table in COL-2). Level 60 gives no XP, so
the difference only matters for colour.

### KXP-2 Zero difference (ZD)

| P | 1-7 | 8-9 | 10-11 | 12-15 | 16-19 | 20-29 | 30-39 | 40-44 | 45-49 | 50-54 | 55-59 | 60+ |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| ZD | 5 | 6 | 7 | 8 | 9 | 11 | 12 | 13 | 14 | 15 | 16 | 17 |

Sources: vmangos Formulas.h:59-73, cmangos Formulas.h:330-344 and the wiki "Mob experience" [W2]
all agree.

### KXP-3 Base XP

```
base = 5*P + 45                           // Azeroth; P = player level, NOT mob level
if M >= P:            xp = base * (1 + 0.05 * min(M - P, 4))
elif M > grayLevel(P): xp = base * (ZD(P) + M - P) / ZD(P)
else:                 xp = 0
```

Both emulators use the **player** level in the base (vmangos Formulas.h:94-98, cmangos :346-364). The
wiki's "(Mob Level x 5) + 45" is explicitly the **patch 4.0.3a+** formula [W2]. Do not use it for
Era. Red mobs cap at +4 levels (+20%).

### KXP-4 Mob data available

- QuestieDB NPC fields are `minLevel`, `maxLevel`, `rank` and `spawns` (`src/meta/npcMeta.lua:18-50`).
- Rank values: 0 normal, 1 elite, 2 rare elite, 3 world boss, 4 rare (vmangos `CreatureDefines.h:89-93`).
- **Missing:** creature type (critters give 0 XP), `ExperienceMultiplier`, and no-XP flags. The
  emulators use all of these (vmangos Formulas.h:100-156).
- The simulator therefore needs: a mob level choice (`mobLevelChoice`, default the midpoint rounded
  down, configurable; `ASSUMPTION`); a user-editable "no XP" list; and XP multiplier 1 for
  everything else.
- An NPC with no level range, or no record, counts as a same-level mob (`M = P`, ASSUMPTION, as
  TIME-12 does for grind steps); the simulation records that the level was assumed (Milestone 6).
- Objective kills (TIME-9, including the objective work a turn-in carries, TIME-11) and grind
  kills (TIME-12) are the only kill-XP sources in v1. Objective kill XP uses the same assumed kill
  count as objective time (DSO-05), so an objective with no known count never yields time without
  XP.

### KXP-5 Multipliers

| Factor | Value | Source |
|---|---|---|
| Elite (rank 1, 2, 3) in the open world or a raid | x2.0 (`eliteKillXpMultiplier`) | vmangos :138-146, cmangos :375-381, wiki [W2] |
| Elite in a **non-raid dungeon** (`MAP_INSTANCE`) | x2.5 (`dungeonEliteKillXpMultiplier`) | Both emulators (`IsNonRaidDungeon`); **not in the wiki**. `UNVERIFIED` against Blizzard Era |
| Rare (rank 4) | x1 (not elite) | `IsElite()` excludes rank 4 (vmangos Creature.h:193-199) |
| Forever dungeon mobs | `dungeonMobXpMultiplier`, default 1, basis `assumption` (first draft: `assumedFrom: era`, superseded by section 1.2) | `REPORTED` greatly reduced |

A mob counts as a dungeon mob when the step's location is on an instance map.

- **Raids (Milestone 6 review).** An instance map is a raid or a five-player dungeon by the instance
  type `zones.json` gives with its instance world map (`DungeonEntrances.raid`; while the dataset
  gives no type, an instance counts as a dungeon, an assumption). Raid elites take
  `eliteKillXpMultiplier` (the emulators' `IsNonRaidDungeon`); `dungeonMobXpMultiplier` applies
  on every instance map, raids included, since Forever's reported reduction does not say it
  spares raids (`INFERRED`).
- **Grind kills** (TIME-12) are dungeon or raid kills when the grind step's location is on an
  instance map, like objective kills.

### KXP-6 Rounding

The final value is `std::nearbyint` in float32 (vmangos :155, cmangos :387): round half to even.
The reference implementation emulates float32 with `Math.fround`
(`<repo>/.cache/experiments/simulation/vectors.mjs`, research only). Example tie: P=10, M=12 gives 95 x 1.1
= 104.5, which rounds to **104**; an elite in a dungeon at 20/20 gives 145 x 2.5 = 362.5, which
rounds to **362**. Blizzard's own rounding is unknown, so tests should allow +/-1 against other
implementations. Ruleset key: `killXpRounding`.

### KXP-7 Kill-XP test vectors (solo, no rested)

| P | M | kind | grayLevel(P) | xp |
|---|---|---|---|---|
| 1 | 1 | normal | 0 | 50 |
| 5 | 7 | normal | 0 | 77 |
| 10 | 10 | normal | 4 | 95 |
| 10 | 12 | normal | 4 | 104 (tie 104.5) |
| 10 | 14 | normal | 4 | 114 |
| 10 | 20 | normal | 4 | 114 (capped at +4) |
| 10 | 9 | normal | 4 | 81 |
| 10 | 5 | normal | 4 | 27 |
| 10 | 4 | normal | 4 | 0 |
| 20 | 20 | normal | 13 | 145 |
| 20 | 15 | normal | 13 | 79 |
| 20 | 14 | normal | 13 | 66 |
| 20 | 13 | normal | 13 | 0 |
| 20 | 20 | elite, world | 13 | 290 |
| 20 | 20 | elite, 5-player dungeon | 13 | 362 (tie 362.5) |
| 40 | 35 | normal | 31 | 151 |
| 40 | 31 | normal | 31 | 0 |
| 59 | 60 | normal | 47 | 357 |
| 59 | 48 | normal | 47 | 106 |
| 59 | 47 | normal | 47 | 0 |
| 60 | 60 | normal | 47 | 0 (cap) |

### KXP-8 Group XP (`ERA-EMU`; the emulators call the rates "guesswork")

vmangos `Group::RewardGroupAtKill` (Group.cpp:1277-1316, 2295-2409 [E1]):

1. **Eligible members:** alive, in the world, and within reward distance. `count` is their number
   and `sumLevels` is their total level.
2. `ng` is the highest-level eligible member for whom the mob is **not** gray. If there is none,
   nobody gets XP.
3. `xp = killXP(level(ng), M)`, using the KXP-3/5 rules for that member's level.
4. `groupRate`: 1.0 for 1-2 members, 1.166 for 3, 1.3 for 4, 1.4 for 5, and `max(1 - 0.05*count, 0.01)`
   for more than 5. Same values in cmangos Formulas.h:390-408 and the wiki [W2]. The emulator
   comment says "this formula is completely guesswork" (vmangos Formulas.h:160).
5. Each member `i` with `level(i) <= level(ng)` gets `trunc(xp * groupRate * level(i) / sumLevels)`.
   If the group's highest-level member is gray to the mob (that is, not `ng`), each gets
   `trunc(xp * groupRate * level(i) / sumLevels / 2 + 1)` instead (**erratum, Milestone 6:** this
   read `trunc(xp*rate/2) + 1`, where `rate` includes the level share; the table's last row needs
   it). Members above `ng` get 0.
6. Each member's own rested bonus then applies (KXP-9).
7. cmangos rounds with `std::round` instead of truncating (Group.cpp:1508-1510 [E3]). That is a +/-1
   difference.
8. The arithmetic is float32, as in vmangos: `rate = f32(f32(groupRate × level(i)) / sumLevels)`,
   then `trunc(f32(xp × rate))`, or `trunc(f32(f32(f32(xp × rate) / 2) + 1))` in the gray case
   (Milestone 6 review; doubles differed by 1 in 61 of 12,462 cases, for example levels 7 and 39
   against a level-10 mob give 7 and 0, not 8 and 0).

| Levels | Mob | Shares |
|---|---|---|
| 20, 20 | 20 | 72, 72 |
| 20, 20, 20 | 20 | 56, 56, 56 |
| 20 x 4 | 20 | 47 each |
| 20 x 5 | 20 | 40 each |
| 20, 30 | 25 | 45, 68 |
| 10, 30 | 12 (gray to 30) | 14, 0 |

- **Quest XP is not split.** Each member receives their own QXP-3 amount.
- Forever group rules are `UNKNOWN` (U4 in forever-game-rules.md), and there is **no shared
  tagging** in the Forever open world (`REPORTED`, R7).
- **Decision (F23, ARCHITECTURE §9.1):** v1 simulates solo play. `groupXpEnabled` is false by
  default and carries an assumption marker when enabled. The rates stay in the ruleset
  (`groupXpRates`) for a later "group of N equal-level members" option. The first draft's
  recommendation to ship that option in v1 is superseded.

### KXP-9 Rested XP (`ERA-EMU`; default **off**)

Let `R` be the rested pool in **bonus-XP units**. The client displays `2R` as the rested marker.

| Rule | Value | Source |
|---|---|---|
| Kill bonus | `bonus = min(R, xp)`, then `R -= bonus`. The kill gives `xp + bonus`, so up to 200% | vmangos Player.cpp:8232-8243, 3036-3043 |
| Quest XP | Never gets a rested bonus | Player.cpp:3037 (`victim ? ... : 0`) |
| Cap | `R <= 0.75 x xpToNext(L)`, which displays as 1.5 levels | Player.cpp:17841-17846 |
| Accrual in a rest area (inn or city; online, or offline while flagged resting) | `xpToNext(L) / 1,152,000` per second: 5% of a level (displayed) per 8 h | Player.cpp:8245-8263 |
| Accrual offline outside a rest area | One quarter of that | Player.cpp:8261 |
| At max level | `R = 0` | Player.cpp:17835-17836 |
| Forever | Legacy "Well Rested" gives +20% accrual and a +20% cap; camping grants "a small amount" (amount `UNKNOWN`) | forever-game-rules.md sections 3 and 8.2 (C7, C8) |

**Recommendation:** `restedEnabled = false`. If it is enabled, the user supplies the starting `R`,
and the only accrual is from explicit "rest/logout" route steps with a duration and location type.
Rested XP otherwise makes route comparisons depend on real-world play schedules.

---

## 5. Quest difficulty colour

### COL-1 Era client logic (`ERA-CLIENT`, 1.15.9.69722)

`Blizzard_UIParent/Vanilla/UIParent.lua:1397-1424` [U1] is loaded by `Blizzard_UIParent_Vanilla.toc:12-14`:

```lua
function GetQuestDifficultyColor(level, isScaling) ... return GetRelativeDifficultyColor(UnitLevel("player"), level)
function GetRelativeDifficultyColor(unitLevel, challengeLevel)
  local levelDiff = challengeLevel - unitLevel
  if levelDiff >= 5 then impossible        -- red
  elseif levelDiff >= 3 then verydifficult -- orange
  elseif levelDiff >= -2 then difficult    -- yellow
  elseif -levelDiff <= GetQuestGreenRange() then standard -- green
  else trivial end                         -- grey
```

- The Era quest log calls it with the quest's level: `Vanilla/QuestLogFrame.lua:242-247`.
- Colours (`Blizzard_FrameXMLBase/Classic/Constants.lua:257-264`):
  - impossible `1.00/0.10/0.10`;
  - verydifficult `1.00/0.50/0.25`;
  - difficult `1.00/1.00/0.00`;
  - standard `0.25/0.75/0.25`;
  - trivial `0.50/0.50/0.50`.
- The same function colours creatures (`GetCreatureDifficultyColor`).

### COL-2 `GetQuestGreenRange()` by player level (`ERA-EMU`; `CONFLICT` for levels 5-9)

`GetQuestGreenRange()` is implemented in C, so its table is not in the UI source. The cmangos-classic
`GetQuestGreenRange` (Formulas.h:274-302) mirrors it:

| P | 1-9 | 10-19 | 20-29 | 30-39 | 40-44 | 45-49 | 50-54 | 55-59 | 60+ |
|---|---|---|---|---|---|---|---|---|---|
| greenRange | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 |

- **Consistent sources:**
  - the vmangos gray-level formula (KXP-1: `grayLevel = P - greenRange - 1` for every `P >= 5`);
  - warcraft.wiki.gg `API_GetQuestGreenRange`, which gives 10 at level 50 and 12 at 60 [W3].
- **Conflict:** the same wiki page's example says level 9 returns **5**. The emulators and the gray
  formula say **4**.
- **Default:** 4, with the band table as a ruleset parameter (`greenRange`). A one-time in-game
  check on Era (`/dump GetQuestGreenRange()` at levels 6-9) would settle it.
- Other wiki pages ("Mob difficulty colors") mix in TBC/WotLK values, such as gray <= 51 at 60.
  Do not use them.

### COL-3 Test table (Era; `colour = f(P, Q)`)

| P | Q | Q-P | greenRange | colour |
|---|---|---|---|---|
| 1 | 6 | 5 | 4 | red |
| 1 | 5 | 4 | 4 | orange |
| 1 | 4 | 3 | 4 | orange |
| 1 | 3 | 2 | 4 | yellow |
| 1 | 1 | 0 | 4 | yellow (no green or grey quest exists at P=1) |
| 5 | 10 | 5 | 4 | red |
| 5 | 9 | 4 | 4 | orange |
| 5 | 8 | 3 | 4 | orange |
| 5 | 7 | 2 | 4 | yellow |
| 5 | 3 | -2 | 4 | yellow |
| 5 | 2 | -3 | 4 | green |
| 5 | 1 | -4 | 4 | green |
| 10 | 15 | 5 | 5 | red |
| 10 | 13 | 3 | 5 | orange |
| 10 | 12 | 2 | 5 | yellow |
| 10 | 8 | -2 | 5 | yellow |
| 10 | 7 | -3 | 5 | green |
| 10 | 5 | -5 | 5 | green |
| 10 | 4 | -6 | 5 | grey |
| 20 | 25 | 5 | 6 | red |
| 20 | 23 | 3 | 6 | orange |
| 20 | 22 | 2 | 6 | yellow |
| 20 | 18 | -2 | 6 | yellow |
| 20 | 17 | -3 | 6 | green |
| 20 | 14 | -6 | 6 | green |
| 20 | 13 | -7 | 6 | grey |
| 39 | 44 | 5 | 7 | red |
| 39 | 42 | 3 | 7 | orange |
| 39 | 41 | 2 | 7 | yellow |
| 39 | 37 | -2 | 7 | yellow |
| 39 | 36 | -3 | 7 | green |
| 39 | 32 | -7 | 7 | green |
| 39 | 31 | -8 | 7 | grey |
| 40 | 45 | 5 | 8 | red |
| 40 | 43 | 3 | 8 | orange |
| 40 | 42 | 2 | 8 | yellow |
| 40 | 38 | -2 | 8 | yellow |
| 40 | 37 | -3 | 8 | green |
| 40 | 32 | -8 | 8 | green |
| 40 | 31 | -9 | 8 | grey |
| 50 | 55 | 5 | 10 | red |
| 50 | 53 | 3 | 10 | orange |
| 50 | 52 | 2 | 10 | yellow |
| 50 | 48 | -2 | 10 | yellow |
| 50 | 47 | -3 | 10 | green |
| 50 | 40 | -10 | 10 | green |
| 50 | 39 | -11 | 10 | grey |
| 59 | 64 | 5 | 11 | red |
| 59 | 62 | 3 | 11 | orange |
| 59 | 61 | 2 | 11 | yellow |
| 59 | 57 | -2 | 11 | yellow |
| 59 | 56 | -3 | 11 | green |
| 59 | 48 | -11 | 11 | green |
| 59 | 47 | -12 | 11 | grey |
| 60 | 65 | 5 | 12 | red |
| 60 | 63 | 3 | 12 | orange |
| 60 | 62 | 2 | 12 | yellow |
| 60 | 58 | -2 | 12 | yellow |
| 60 | 57 | -3 | 12 | green |
| 60 | 48 | -12 | 12 | green |
| 60 | 47 | -13 | 12 | grey |

For `P` from 6 to 9, the conflicted row is `Q = P - 5`: grey by default, green if the level-9 wiki
example is right.

### COL-4 Forever client (`FOREVER-CLIENT`, 1.60.1.70009): the thresholds differ in Lua and are opaque in C

- **Forever is the Mainline UI family with game type `camelot`.**
  - `Blizzard_FrameXMLUtil.toc:33-36` loads `Mainline\DifficultyUtil.lua [AllowLoadGameType mainline]`
    plus `Camelot\DifficultyUtilOverrides.lua`. The `Classic\` variants are for `classic` only.
  - Questie ships `Questie_Camelot.toc` (Interface 16001) and detects Forever by interface
    16000-16999 (VersionCheck.lua:60).
- **The quest log colour comes from C.** `QuestMapFrame.lua:2317` and `DifficultyUtil.lua:84-95` use
  `GetDifficultyColor(C_PlayerInfo.GetContentDifficultyQuestForPlayer(questID))`. That returns
  `Enum.RelativeContentDifficulty` {Trivial 0, Easy 1, Fair 2, Difficult 3, Impossible 4}
  (`PlayerInfoDocumentation.lua:79-92`, `QuestConstantsDocumentation.lua:130-142`). The mapping
  from level to difficulty is **not visible** (`UNKNOWN`).
- **The Lua fallback differs from Era.** In `Mainline/DifficultyUtil.lua:33-46`, yellow is
  `levelDiff >= -4` (Era: -2) and green is `-levelDiff <= UnitQuestTrivialLevelRange("player")`.
  `UnitQuestTrivialLevelRange` is C-side (`UnitDocumentation.lua:2895-2908`), and
  `GetQuestGreenRange` does not exist in the Forever API docs. **If** the C function uses the same
  thresholds, quests 3-4 levels below the player are yellow in Forever (green in Era). `UNKNOWN`.
- The Mainline "difficult" yellow is `1.00/0.82/0.00` (`Blizzard_FrameXMLBase/Constants.lua:195-203`,
  loaded for mainline, which includes camelot).
- Camelot prefixes the level and an elite "+" in the quest log title
  (`Camelot/QuestMapFrameOverrides.lua:13-17`).
- **Ruleset:** `difficultyYellowLowerBound` is -2 in `era-1.15` (`client-data`) and -2 in
  `forever-beta` (`era-assumed`, with -4 noted as the documented alternative). The Forever green
  range is the same table, `era-assumed`. (The first draft's `colour.yellowLowerBound` with
  `assumedFrom: era` is superseded by section 1.2.)
- Colour is computed on the lower-bound level while `unknownXpEvents > 0` (XP-4); it is display
  only.

### COL-5 Questie's implementation (`QUESTIE`)

- Questie hard-codes the **Era** thresholds on every client:
  - `QuestieLib:PrintDifficultyColor` and `GetDifficultyColorPercent` (QuestieLib.lua:35-91);
  - `QuestieDB.IsTrivial` (QuestieDB.lua:1609-1626).
- It uses its own colours: FF1A1A, FF8040, FFFF00, 40C040, C0C0C0.
- Its green range comes from `QuestieCompat.GetQuestGreenRange()` (QuestieCompat.lua:646-656). That
  is `UnitQuestTrivialLevelRange("player")` on Forever and `GetQuestGreenRange("player")` on Era.
- Questie treats `questLevel == -1` as the player's level (colour) and never trivial.
- Questie's map **hides** quests with `level < P - greenRange` by default
  (AvailableQuests.lua:576-585; IsLevelRequirementFulfilled.lua:47-52). That is a display filter,
  **not** an availability rule (VAL-4).

---

## 6. Time model

Each value is labelled **SOURCE DATA** (read from client/emulator data), **ERA RULE** (Era mechanics
from emulator or wiki) or **ASSUMPTION**. Every value is a ruleset parameter whose key is given in
section 1.2 (SOURCE DATA maps to `client-data`, ERA RULE to `era-assumed` in `forever-beta`,
ASSUMPTION to `assumption`). All times are seconds as JavaScript numbers; the optimiser's travel
matrix rounds to integer milliseconds (ARCHITECTURE §11.3), and parity with the simulator is
checked within 1% (ARCHITECTURE §11.7 fixture 11).

### 6.1 Movement

| Parameter | Default | Label | Source |
|---|---|---|---|
| Run speed (`runSpeed`) | 7.0 yd/s | ERA RULE | `baseMoveSpeed[MOVE_RUN]` in vmangos Unit.cpp:67-75 and cmangos Unit.cpp:63-71 (walk 2.5, back 4.5, swim 4.722) |
| Normal mount (`mountSpeedBonus[0]`, `mountLevels[0]`) | +60% (11.2 yd/s) from level 40 | SOURCE DATA | Era: mount spells carry aura 32 base 59 (+60%), e.g. 458/580/470; `RequiredLevel` 40 (ItemSparse 69722, items 5656/2411). Forever: spell 86457 +60%, items still `RequiredLevel` 40 (ItemSparse 69977) |
| Epic mount (`mountSpeedBonus[1]`, `mountLevels[1]`) | +100% (14.0 yd/s) from level 60 | SOURCE DATA | Era: aura 32 base 99, e.g. 23229/23250; item 18776 `RequiredLevel` 60. Forever: 86458 +100%, 18776 still 60 |
| When the character has the mount | **Superseded by TIME-3 (DSO-16):** the first draft used "the first route step at `level >= 40` after an explicit train riding / buy mount step", which free-text `train.what` could not express | ASSUMPTION | Era gold costs are not verified here. Forever training level and cost are `UNKNOWN` (U6 in forever-game-rules.md) |
| Other speed effects | Sprint, Aspect of the Cheetah, Ghost Wolf, Travel Form, Skysight, and the +5% "Mount Speed" spells | SOURCE DATA (Forever) | forever-game-rules.md sections 6.1-6.2. Stacking rules `UNKNOWN`. Default: ignored |
| Path length vs straight line (`groundDetourFactor`) | x1.25 detour factor on straight-line distance: the straight-line `TravelModel` and the navigation model's labelled fallback (TIME-2) | ASSUMPTION | none |
| Swim speed (`swimSpeed`) | 4.722 yd/s; navigation legs only (`TravelSpeeds.swimYps`), mounted or not | ERA RULE | the run-speed row's sources (Milestone 6) |

#### TIME-1 Speeds

On foot the character moves at `runSpeed`; mounted at `runSpeed x (1 + riding.speedBonus)`
(`CharacterState.riding`, TIME-3). The step mode `'walk'` means on foot at run speed, not the
2.5 yd/s walk speed. Swimming is at `swimSpeed`, mounted or not; only navigation legs use it
(Milestone 6). Mount-up time and indoor restrictions are not modelled (0 s, ASSUMPTION).

#### TIME-2 Ground travel between steps (ARCHITECTURE §6, §9.1, §9.3; terrain-navigation.md §9.3-§9.4)

> **Milestone 6 edit (terrain-navigation.md §18; D-028, D-037):** ground legs come from the
> `TravelModel` (`src/domain/travel.ts`), which the engine, the simulation and the optimiser share,
> so they agree about every leg. The choice of the nearest spawn stays straight-line.
> **Superseded:** revision 2's `seconds = d x groundDetourFactor / speed`, which is now the
> straight-line model's leg.

- Every step with a location starts with a move from `state.location` to that location, charged
  to `breakdown.travel` (hearth, flight and transport steps follow TIME-4, TIME-5 and TIME-7):

  ```
  from    = { point: state.location, zoneHint }                    // zoneHint: top-level zone AreaTable id, 0 = none
  to      = { point: resolve(step.location), zoneHint }
  d       = distanceYards(from.point, to.point)                    // src/geo; null across world maps
  r       = step.location.radius ?? 0                              // arrival radius, yards
  speeds  = { groundYps: mounted ? runSpeed * (1 + riding.speedBonus) : runSpeed, swimYps: swimSpeed }
  seconds = d <= r ? 0 : travelModel.leg(from, to, speeds).seconds * (d - r) / d
  ```

- **The two models** (ARCHITECTURE §9.1):
  - `straight-line` (clean deploys, tests, and maps without navigation data): the leg is
    `d x groundDetourFactor / groundYps`, basis `assumption`, method `straight-line`, never pending,
    no warnings. With it the formula above is revision 2's
    `max(0, d - r) x groundDetourFactor / speed`.
  - `navigation` (the committed navigation data): the navmesh leg, basis `derived`, or the labelled
    straight-line fallback with a warning (terrain-navigation.md §9.3).
  - The move's basis combines the leg's with the speeds' (`runSpeed` is `era-assumed` in
    `forever-beta`, so `eraFallback` is set). `assumptionsUsed` gains `groundDetourFactor` when the
    leg's method is `straight-line`, and `swimSpeed` with the navigation model.
- **Arrival radius:** `Location.radius` (an author's `.goto ...,radius`, ARCHITECTURE §6) and
  `Waypoint.radius` shorten the move by that many yards (ASSUMPTION: the step starts on reaching
  the radius). A navigation leg is shortened in proportion, `(d - r) / d` of its seconds
  (ASSUMPTION, Milestone 6), and no leg is requested when `d <= r`. `state.location` still becomes
  the resolved point. A world-form point's `uiMapId` hint is display metadata and does not change
  resolution.
- **Warnings** (terrain-navigation.md §9.3): a leg's warnings pass through unchanged as structured
  data, and the validator turns each into a warning: `no-walking-path` (SIM-17), `off-navmesh`
  (SIM-18), `unverified-passage` (SIM-19), `ambiguous-floor` (SIM-20) and `long-swim` (SIM-21).
  None changes the leg's seconds or basis.
- **Pending legs:** a navigation leg not computed yet carries the straight-line fallback with
  `pending: true`. It is shown as pending and is not an issue. Tests, exports and optimiser input
  never have pending legs.
- **Mounted** means travel mode `'mount'`, or `'auto'` with `riding.trained > 0`. Quest, vendor,
  train and grind steps travel as `'auto'`, and so do the walks to and from the dock in a
  `'transport'` step (Milestone 6 clarification). `'mount'` before riding is trained travels on
  foot and emits `SIM009-mount-untrained`.
- **Group waypoints** (ARCHITECTURE §8.1): `leg` waypoints are visited in order before the first
  located step of the group, each segment one leg by the formula above. `pin` and `closest`
  waypoints are display-only in v1.
- **Step without a location (not `travel`):** when it names one entity (`via`, or a quest's only
  starter or finisher), the walker uses that entity's spawn nearest to `state.location` by
  straight-line distance, ties by spawn order (ASSUMPTION; unchanged by the navigation model,
  terrain-navigation.md §9.4). Instance presence counts at its dungeon entrance from `zones.json`;
  spawns that are `UnmappedAreaPoint`s are skipped (ARCHITECTURE §5.2). If no spawn resolves, the
  step emits SIM-3 as below. When the step names no entity there is no travel and the location is
  unchanged. **From an unknown position** (Milestone 6 review) "nearest" is undefined: an entity
  whose resolved spawns lie at one point is reached there, but with spawns at more than one point
  the step's move is unknown and the position stays unknown, since picking the first spawn would
  price every later leg from a guessed place.
- **Position made unknown (ARCHITECTURE §8.1):** a `travel` step with a null location (RXP
  `.zone`, `.subzone`, `.explore`) and a `note` whose `preserved` RXP source is a `.deathskip`
  line move the character somewhere unknown. The step's travel time is unknown (TIME-13) and
  `state.location` becomes null without an issue; the position stays unknown until a step with a
  resolvable location.
- **Unknowns:** a location that resolves to null emits `SIM003-unresolved-location` (info) once;
  the move is unknown (TIME-13) and `state.location` becomes null. Travel from a null location is
  unknown without a further issue, until a step with a resolvable location is reached. A null
  resolution is never treated as zero distance (ARCHITECTURE §6).
- **Why the position is unknown (Milestone 6 review).** A move from a null location records the
  fact `position-unknown` with its cause, which is not an issue but lets the UI say why the time is
  unknown: `start-unset` or `start-unresolved` (7.1), `zone-travel`, `death-skip`, `unresolved`
  (an earlier SIM-3), `several-spawns` (above), `hearth-unbound` (TIME-4), `flight-unresolved`
  (TIME-5) or `transport-arrival` (TIME-7).
- Different world maps: a leg exists only on one world map; the move goes through the
  TravelGraph (TIME-7).

#### TIME-3 Riding state and training (ARCHITECTURE §8.1-9.2; DSO-16, F11)

- **Start:** `CharacterState.riding = { trained: character.riding, speedBonus }`, with
  `speedBonus = mountSpeedBonus[trained - 1]` (0 when `trained` is 0). `character.riding` is the
  riding trained before the route (0 none, 1 apprentice, 2 journeyman) and is applied as declared.
  **Superseded (architect ruling):** the first revision 2 text started every route at `{ 0, 0 }`,
  so a route starting at level 40 or higher was on foot until its first riding step.
- **Recognising riding:** during the route only `train` steps change `riding`. A `train` step is a
  riding step when `skill === 'riding'` **or** its `spellId` is in the ruleset's `ridingSpells`
  table (section 1.2: Apprentice Riding 33388 = tier 1, Journeyman Riding 33391 = tier 2 in
  Forever; cited client values, forever-game-rules.md section 6.1). An imported `.train 33388`
  therefore enables mounted travel. **Superseded (architect ruling):** revision 2 recognised
  riding from `skill: 'riding'` only.
- Tier: `rank` when given; else the tier of `spellId` in `ridingSpells`; else `trained + 1`.
  Capped at 2. Which riding tier grants which speed spell is server-side, so the tier-to-speed
  mapping is `INFERRED`.
- If the level is below `mountLevels[tier - 1]`: with `unknownXpEvents == 0`, the step does not
  change `riding` (it still costs `trainerSeconds`) and emits `SIM010-riding-too-low` (warning);
  with `unknownXpEvents > 0` (the true level may be high enough) the walker applies the tier and
  emits `SIM010-riding-too-low-uncertain`.
- Otherwise `trained = max(trained, tier)` and `speedBonus = mountSpeedBonus[trained - 1]`. The
  step costs `trainerSeconds`.
- A riding train step implies a usable mount; buying the mount is not modelled. Training cost
  (`train.cost`) is recorded, not simulated.
- **Other training:** every `train` step with a `spellId` adds it to `knownSpells` (VAL-17). A
  `train` step with `skill: 'profession'` and a `skillId` (`TrainStep.skillId`, the profession's
  skill line) raises `CharacterState.skills`: when the skill line is not yet in `skills` it is
  added with value 1 (ASSUMPTION: a newly learned profession starts at 1); a known skill line
  keeps its value. The walker records that the skill line was trained in the route, which VAL-15
  uses (section 7.6). Skill gains from use are not modelled, so a trained skill's value is a
  lower bound. A profession step with `skillId: null` changes only `knownSpells`.

### 6.2 Hearthstone and teleports

| Parameter | Default | Label | Source |
|---|---|---|---|
| Hearthstone cast (`hearthCastSeconds`) | 10 s | SOURCE DATA | Spell 8690 `SpellMisc.CastingTimeIndex` 7 -> `SpellCastTimes` 7 = 10,000 ms, in Era 69722 and Forever 69977 |
| Hearthstone cooldown (`hearthCooldownSeconds`) | 60 min, from cast completion | SOURCE DATA | `SpellCooldowns` spell 8690 `CategoryRecoveryTime` 3,600,000 ms, both builds (and C5 in forever-game-rules.md). A server override is `UNKNOWN` |
| Astral Recall (shaman, 556) | 15 min cooldown | SOURCE DATA | `SpellCooldowns` 900,000 ms, both builds. Not modelled in v1 |
| Set bind point (`bindSeconds`) | Innkeeper interaction, 5 s | ASSUMPTION | none |
| Second Home, Crumbling Hearthstone | See forever-game-rules.md section 6.3 | FOREVER-CLIENT | not modelled in v1 |

#### TIME-4 Hearth steps (ARCHITECTURE §8.1, §9.2; DSO-09)

- **Start:** `state.hearth = resolve(character.hearthLocation)` (null when unset or unresolvable);
  `hearthReadyAt = 0` (ASSUMPTION: the hearthstone is ready at route start).
- **`hearth bind`:** travel to the step's location (TIME-2), then `bindSeconds`; `state.hearth`
  becomes that resolved point. If it does not resolve, `state.hearth = null` and SIM-3 applies.
- **`hearth use`:** the destination is `state.hearth`; the step's own `location` is display-only.
  - `state.hearth == null`: `SIM006-hearth-unbound` (warning); travel unknown; location null. No
    cast is charged and `hearthReadyAt` is unchanged (Milestone 6).
  - `timeSec < hearthReadyAt`: the walker waits `hearthReadyAt - timeSec` (`breakdown.waiting`)
    and emits `SIM005-hearth-cooldown` (warning). It never errors. The wait is the cooldown less
    the time since the cast ended, so its basis combines the cooldown's with the durations of the
    steps since the cast (SIMULATION §8; `derived` only when no assumed time passed).
  - **After unknown time (Milestone 6 review).** When a step since the last cast has unknown time,
    `timeSec` is a lower bound (TIME-13) and the true wait lies anywhere from 0 to the computed
    one. The wait is then unknown time (0 s to `timeSec`, the step's duration unknown) and the step
    emits `SIM005-hearth-cooldown-uncertain` (warning) with the computed value as an upper bound.
    The unknown offset cancels at the cast (both the clock and `hearthReadyAt` carry it), so the
    wait at the next use is exact again unless more unknown time passes.
  - Cast `hearthCastSeconds` (`breakdown.travel`); `state.location = state.hearth`;
    `hearthReadyAt = timeSec + hearthCooldownSeconds`, where `timeSec` is the time the cast ends
    (the known parts only, TIME-13).
  - A declared `hearthLocation` that does not resolve counts as no bind point (SIM-6).
- Moving a bind step changes every later hearth destination automatically; nothing is stored on the
  `use` step (DSO-09).

### 6.3 Flight paths (taxi)

**Client data (`FOREVER-CLIENT`; individual values cited under D-022).**

- Forever `TaxiPath` (328 rows, 288 with `Cost > 0`) and `TaxiPathNode` (10,778 points, `Loc_0..2`,
  `NodeIndex`, `ContinentID`, `Flags`, `Delay`), exported from wago.tools at 1.60.1.69977 [D1]
  (fetched as individual requests during research, never by a scripted pipeline; D-011, D-018).
  The `TaxiPath` table is identical at 70009 (forever-game-rules.md section 6.4).
- **Flags** (wowdev.wiki [W4]): `0x1` = map change (teleport), `0x2` = stop for `Delay` seconds.
  In Forever, only **transport** paths (cost 0) have stops, with delays of 30 or 60 s. No path with
  `Cost > 0` has a non-zero `Delay`.
- **Model A, emulator (ERA RULE):** a spline at 32 yd/s through the nodes
  (vmangos `PLAYER_FLIGHT_SPEED 32.0f`, WaypointMovementGenerator.cpp:390-408; cmangos
  `TAXI_FLIGHT_SPEED 32.0f`, PathMovementGenerator.cpp:374-383). This is the source of
  `taxiSpeed = 32` (`era-assumed` in `forever-beta`).
- **Known-node rule (ERA RULE):** a node is usable only once discovered, by talking to its flight
  master (vmangos `IsTaximaskNodeKnown`, Player.cpp:17878). Race start nodes are known from the
  start; the project's `character.knownFlightPaths` must list them. The walker tracks discovered
  nodes in `CharacterState.knownFlightPaths`.
- **Forever modifiers:** Legacy "Frequent Flier" gives +20% taxi speed (aura 388
  `MOD_TAXI_FLIGHT_SPEED`; forever-game-rules.md section 6.4). Exposed as `taxiSpeedBonusPct`,
  default 0.

#### TIME-5 Straight-line flight time: the fallback (D-024; LIC-07, F17)

TIME-5 times a flight when TIME-6 cannot: while the committed taxi file loads, when it failed to
load or its hash did not match, for a journey its flights do not cover, and always with
`taxiModel: 'straight-line'`. Before D-039 B it was the default in every deployed build.

```
flightSeconds = flightMasterSeconds
              + straightYards(fromMaster, toMaster) * taxiDetourFactor
                / (taxiSpeed * (1 + taxiSpeedBonusPct / 100))
```

- `fromMaster` and `toMaster` are the world positions of the two taxi nodes. A `TaxiNodeRef
  { npcId, taxiNodeId, name }` (ARCHITECTURE §9.1) resolves to a TravelGraph node: by `npcId`,
  the node sits at that flight master's spawn (a dataset NPC with the FLIGHT_MASTER flag, converted
  by `geo`); by `taxiNodeId` alone (new Forever flight masters have no dataset NPC), at the cited
  `TaxiNodes` position the TravelGraph holds for that id (D-022), when it holds one; by `name`
  alone, or through the step's `nodeQuery`, by matching node names. Two refs are the same node
  when they resolve to the same TravelGraph node, so `knownFlightPaths` matches an `npcId` ref and
  a `taxiNodeId` ref for one node. Both nodes must be on the same world map; flights never cross
  world maps (map changes are transports, TIME-7), so a cross-map flight is unknown with SIM-4.
- `flight take`: walk (TIME-2) to `fromMaster`, fly, and end at `toMaster`. `from: null` means the
  known node nearest to `state.location` on the current world map (ties by the node key). A ref
  or `nodeQuery` that resolves to no node, or to several, or to a node without a position, makes
  the flight unknown with `SIM008-flight-unresolved` (warning).
- A node missing from `knownFlightPaths` emits `SIM007-flight-unknown-path` (warning); the flight is
  still timed. `flight discover` adds the node and costs `flightMasterSeconds`.
- A departure or destination node whose factions exclude the character's emits
  `SIM024-flight-faction` (warning); the flight is still timed. A node's factions
  (`TaxiNode.factions`) are one source for the engine and the map: with the committed file, the
  row's side flags when they name a side (an `INFERRED` decode), else the flight master's faction in
  the dataset; a cited node its seed's (review TR-08). Unknown factions count as open.
- TIME-5 has no taxi graph, so a multi-hop journey is timed as one straight line.
- Basis: `assumption` (`taxiDetourFactor`), with `eraFallback` in `forever-beta` (`taxiSpeed` is
  `era-assumed`). `breakdown.travel` takes the flight, `breakdown.interaction` the flight master.
- The map's flight network is not drawn while TIME-5 is the only model (the file failed), and its
  row says why (map-presentation.md §9).
- While the committed file is still loading, results that use TIME-5 are provisional: `final` is
  false and `taxiPending` true, and the provisional note says "loading the client taxi file"; the
  walk after the file loads (TIME-6) or fails (TIME-5 for good) is final (review TR-07).

**Evidence for `taxiDetourFactor = 1.4` (client data only; measured 2026-09-25 for revision 2; no
RXPGuides input).** Method: for every `TaxiPath` row with `Cost > 0` whose `TaxiPathNode` points
stay on one `ContinentID` and whose `FromTaxiNode`/`ToTaxiNode` lie on the same continent (286 of
288; the two excluded are the Ironforge and Undercity paths to the Alterac Valley battleground
nodes on map 30), sum the 3D segment lengths along the nodes in `NodeIndex` order (`L3D`) and
divide by the 2D distance between the two `TaxiNodes` positions (`Pos_0`, `Pos_1`). Build
1.60.1.69977. For journeys of two or more hops the route is the shortest `L3D` path over one
faction's direct legs (`TaxiNodes.Flags` bit 0 Alliance, bit 1 Horde), which is `INFERRED`
routing. Errors compare flight time only, without `flightMasterSeconds`.

| Measure | p10 | median | p90 | other |
|---|---|---|---|---|
| Straight-line length of a direct leg (yd) | 1,731 | 3,263 | 5,955 | |
| `L3D` / straight line, direct legs | 1.16 | 1.39 | 2.00 | min 1.04, max 3.53, length-weighted 1.45 |
| TIME-5 at factor 1.4 vs `L3D` / 32 yd/s, direct legs: relative error | -30% | +1% | +21% | sum over all legs -3% |
| Same, absolute error | | 17 s | 59 s | |
| Shortest `L3D` route / straight line, journeys of 2+ hops (Alliance 415 node pairs, Horde 439) | 1.35 (A), 1.34 (H) | 1.67 (A), 1.73 (H) | 2.68 (A), 2.95 (H) | |
| TIME-5 at factor 1.4 on those journeys: relative error | -48% (A), -53% (H) | -16% (A), -19% (H) | +4% | absolute median 66 s (A), 82 s (H) |

- 1.4 is the rounded direct-leg median. It is nearly unbiased for direct legs and underestimates
  multi-hop journeys by about a sixth at the median; a project that mostly takes long multi-hop
  flights can raise it as a project assumption.
- These are model-to-model comparisons (the straight-line model against the emulator polyline
  model). Neither is a measurement of the live game.
- The table records aggregate statistics with table and build cited; no per-leg timing is
  recorded. **Ruling (D-022, D-024):** the default `taxiDetourFactor` is a cited aggregate client
  statistic, which D-022 allows in committed docs and tests. It is not a taxi-derived leg timing,
  so the pending taxi-timing decision (OD-6 in STATUS.md) does not cover it, and it is not derived
  from RXPGuides data (D-024). Its ruleset basis stays `assumption`, because applying one factor
  to every straight line is a modelling choice. This resolves the aggregate part of open question
  10.7. OD-6 was later settled by D-039 B (section 1.6, TIME-6).

#### TIME-6 Per-leg flight times from the committed taxi file (`public/maps/client/taxi.json`; D-039 B)

- **Where the data lives (ARCHITECTURE §9.1; D-039 B, which settles OD-6):** the committed client
  taxi file, `public/maps/client/taxi.json`, written by `tools/maps/client-tables.ts` from the
  client's `TaxiNodes`, `TaxiPath` and `TaxiPathNode` (build 1.60.1.70009; FileDataIDs, CKeys, the
  WoWDBDefs commit and the tool tree hash in its manifest, with a NOTICE naming Blizzard), with
  `--check`. The app loads it with the other client tables (`src/infra/maps/client-tables.ts`,
  SHA-256 against the manifest), in the derived pipeline's chunk, once and never fatally, and gives
  the walker its flights as the per-leg data (`taxiLegDataOf` in `src/sim/taxi.ts`). A developer's
  local extraction (`local-maps/taxi.local.json`, the Milestone 6 arrangement) has the same shape
  and only overrides it where a caller passes it; the app does not load it.
- **When it is used:** with `taxiModel: 'auto'` (the default), a journey that the file's flights
  cover replaces TIME-5. While the file loads (the project's first walk), when it failed (HTTP,
  hash or format), and for a journey its flights do not cover, TIME-5 is used, and the project is
  walked again once the file has loaded or failed. Until then the results are not final
  (`taxiPending`, TIME-5). `taxiModel: 'straight-line'` forces TIME-5 everywhere.
- **What the simulator needs from each leg:** its two nodes (as `taxiNodeId`s), its `L3D` length
  and the build. The leg time is computed at load, so the effective speed and bonus still apply:

  ```
  legSeconds = L3D(path) / (taxiSpeed * (1 + taxiSpeedBonusPct / 100))
  ```

  The flight step still charges `flightMasterSeconds` to `breakdown.interaction`, as in TIME-5
  (Milestone 6 clarification).

- `L3D` is the sum of 3D segment lengths along the path's nodes in `NodeIndex` order; the emulators
  fly a spline through them, which is slightly longer (Model A).
- **Multi-hop:** the minimum-time path through nodes in `knownFlightPaths` that the character's
  faction may use; ties by fewer legs, then by the sequence of node ids. Time is the sum of the
  legs (`perLegOverheadS = 0`, ASSUMPTION; the chosen route is also an assumption, because the
  server's routing is unknown).
- A `TaxiNodeRef` with a `taxiNodeId` matches the file's legs directly. A ref with only an
  `npcId` maps to the TaxiNodes row nearest its flight master's position on the same map
  (`INFERRED`), within 50 yd (Milestone 6 review: a row further away is taken to be another node,
  and the flight falls back to TIME-5); the file lists each row's id and world position beside its
  flights for this. With the committed file the TravelGraph already gives each flight master its
  row (ARCHITECTURE §9.1): at 1.60.1.70009, 60 of the 63 dataset flight masters stand within
  11.5 yd of a row; Vesprystus (Rut'theran Village) and the two Moonglade druid flight masters,
  whose paths cost nothing, stand at no row of a paid path, so their flights use TIME-5. Transport
  paths (cost 0, `Delay > 0`) are never legs.
- A row is usable as an intermediate node when a node the character knows maps to it, whichever
  key form it was learned under (`npc:` or `taxi:`), and that node serves the character's faction
  (its `factions` include it or are unknown; the one faction source of TIME-5).
- **No journey through known nodes (review TR-09):** when the file joins the two rows only through
  rows the character does not know yet (open to its faction), the flight is timed by TIME-5 and
  records `SIM007-flight-unknown-path-journey` (warning), so the straight line never stands in
  silently. A journey the file does not cover at all (no path even through unknown nodes, or rows
  missing) is the ordinary fallback, without an issue.
- The TravelGraph's taxi edges say which flights exist; the lengths are only in the per-leg data
  (`EngineContext.localTaxi`), and `report.client.edgeSource` says whether the edges are the file's
  or the caller's (review TR-13).
- Basis: `L3D` is client data, `taxiSpeed` is `era-assumed`, the routing is an assumption, so the
  result is `assumption` with `eraFallback`. The flight's `model` is `taxi-path`.
- **The map** (map-presentation.md §9, §25.4) draws the same flights as the flight network, each
  pair's hover giving both directions' times by this rule from the effective `taxiSpeed`,
  `taxiSpeedBonusPct` and `flightMasterSeconds`, and marks the route's own journeys routed as this
  rule routes them.
- Unit tests use synthetic node lists; the committed file is checked end to end in
  `tests/map-places.test.ts` (a flight timed from its committed length, TIME-5 before it loads).

#### Research note R-1 (not a rule): the RXPGuides-referenced fit, superseded by D-024

- During Milestone 0 a model `legSeconds = L3D / v + c` was fitted by least squares on 261 direct
  Forever legs against the per-pair flight-duration table in RXPGuides' Forever module
  (`DB/forever/flightData.lua` [N1]; the table's own provenance is unknown). The first draft made
  this "model B" the default.
- RXPGuides declares CC BY-NC-SA 4.0 (`LICENSE`, line 1, at `c3429e06`). The owner's posture is not
  to combine RXPGuides material with this repository: D-019 lists flight times and constants fitted
  to them among the forbidden material, and D-024 makes the emulator speed the default. This is not
  a legal conclusion.
- **Superseded by D-024.** The fitted coefficients are not used and appear nowhere in the
  repository, this file included (D-019, D-024); they exist only as output of the gitignored
  research script `fit.mjs` (X1). Checked when the rulings of section 1.4 were applied: neither
  `v` nor `c` is stated here, and an earlier sentence that compared the fitted speed with the
  emulators' 32 yd/s was removed, because it bounded a fitted coefficient. Nothing in this file
  depends on the fit: the 32 yd/s default is the emulator constant (TIME-5, Model A).
- Kept as fit-quality statistics only: RMSE 0.98 s and maximum error 12 s over the 261 legs.
- Multi-hop, against the same reference: summing per-leg estimates slightly **over**-estimated long
  chains; the median of (reference - estimate) was -0.7 s at 2 legs, -2 s at 3, -3.5 s at 4 and
  -19 s at 5.
- Future calibration must be independent: self-timed in-game legs recorded in the project's
  planned-vs-actual `ext` bag (ARCHITECTURE §8.2), never a third-party table.

### 6.4 Transports and cross-world travel

#### TIME-7 Transports and moves between world maps (ARCHITECTURE §9.1, §9.3; DSO-09)

- A **world map** is a `WorldMapId`: the continents 0 (Eastern Kingdoms), 1 (Kalimdor) and 2991
  (Zephras Isle, reached only by transport; forever-game-rules.md sections 6.5 and 9), and instance
  maps. A move between two world maps is possible only through a `travel` step with mode
  `'transport'`, a `hearth use` (TIME-4), or an instance entrance edge (below). Anything else
  makes the move unknown and emits `SIM004-cross-world-no-transport` (warning); the optimiser
  treats it as infeasible, never as free (ARCHITECTURE §11.3).
- **Instance entrance edges (ARCHITECTURE §9.1; resolves open question 10.12).** The TravelGraph
  holds one zero-wait edge per dungeon entrance in `zones.json` (entrances that differ by faction
  come from `overlays.json` for the character's faction). An edge links the entrance's world point
  on its outdoor map to the dungeon's instance world map. The walker applies edges automatically,
  without a `travel` step:
  - **Entering:** a step on an instance map, reached from the entrance's outdoor map, walks
    (TIME-2) to the entrance nearest `state.location` and enters at 0 s. The dataset has no
    instance-side arrival point, so the move inside the instance to the step's location costs 0 s
    (ASSUMPTION; the step's own objective time carries the dungeon work). Moves between two steps
    on the same instance map use TIME-2 as usual.
  - **Leaving:** a step on the outdoor map of the instance's entrance, reached from inside the
    instance, leaves at 0 s at the entrance used to enter (else the entrance nearest the step's
    location) and walks from there.
  - An instance whose entrance is on another world map still needs a transport or hearth for that
    part of the journey (SIM-4 otherwise). An edge needs the dungeon's instance `WorldMapId`
    beside its entrances; a dungeon without one in `zones.json` gets no edge, and its steps keep
    SIM-4 (DATA_PROVENANCE §6.6 owns the file; QuestieDB's `instanceIdToAreaId.lua` holds the
    link).
  - Basis: `assumption` (zero wait, zero in-instance distance). Dataset entities with instance
    presence already resolve to the entrance (TIME-2), so only steps whose own location is on an
    instance map (for example a world-form point) use the edges.
- **Transport step:** the transport comes from the `TravelGraph` (`{ id, from, to, waitS, rideS,
  factions, basis }`, ARCHITECTURE §9.1). `TransportRef.id` names the record; `TransportRef.dock`,
  a user-entered location, replaces the record's departure point.
  - `seconds = ground(state.location -> from) + waitS + rideS`; then `state.location = to`, followed
    by ground travel to the step's location if it has one on the arrival map. `waitS` goes to
    `breakdown.waiting`, the walk and `rideS` to `breakdown.travel`.
  - `waitS` and `rideS` default to `transportWaitSeconds` and `transportRideSeconds` (60 s each,
    ASSUMPTION: wait = half an `UNKNOWN` cycle) unless the TravelGraph record carries its own values
    with their basis.
  - `transport: null`, or a `transport` with `id: null` and no `dock`: the walker picks the
    TravelGraph transport from the current map to the destination's map with the least total time,
    ties by transport id. None: unknown with SIM-4. **It never chooses among inferred docks (review
    TR-01):** which named service a client path is, is itself inferred (map-presentation.md §10), so
    for this choice a dock whose only position is the committed file's stop counts as unpositioned,
    and the step stays unknown with SIM-3, as before the file loaded, until it names its transport
    (`TransportRef.id`). User docks and dock NPCs still position the choice. No UI path creates such
    a step (the map popover names the transport, RXP import writes `auto` travel); imported or
    hand-edited projects can.
  - **What the ride records (review TR-02; map-presentation.md §10, MP-R32):** a named transport,
    or a chosen one whose total is known, records the edge ridden and each dock's name and position
    source (`transport-ride`; `inferred` with its client record, `user`, `dock-npc`, or none). It is
    not an issue; Details words it ("from Auberdine, dock position inferred from client transport
    path 11616, stop 1 of 2"). A user-entered dock replaces the departure's position and its record.
  - A `transport` with `id: null` and a `dock` but no matching record: the walker walks to the
    dock, waits and rides the default times, and arrives at the step's location (for a `travel`
    step the location is the destination, ARCHITECTURE §8.1). Without a step location the arrival
    is unknown: the position becomes unknown, as after a `.zone` step, and the next located step's
    move records `position-unknown` (TIME-2). **Erratum (Milestone 6 review):** this said "with
    SIM-4", but SIM-4 is for a map change without a transport, and the step's own time is known.
  - A seeded transport whose departure or arrival dock has no position (TIME-7 seeds none until a
    dock NPC or the user gives one) makes the walk to or from it unknown with SIM-3, the
    unresolved place (Milestone 6 review). The quickest-edge choice still ties by transport id
    when every total is unknown; while the docks are unpositioned the candidates price the same.
  - A transport whose `factions` excludes the character's faction emits `SIM014-transport-faction`
    (warning). Faction restrictions are `UNKNOWN` in the client data (forever-game-rules.md 6.5).
  - Transports do not use the taxi model.
  - **Client berths (review TR-03; the fixer's choice, pending the architect's ruling):** an
    inferred dock is the ship's stop, which lies in the water beside its pier, 13 to 15 yd from the
    nearest walkable polygon on the committed navmesh. The runtime snap puts a point over the pier
    on the water surface below the deck (the lowest floor), so the navmesh walk to a berth ends
    with a swim along the shore (400 yd from the Auberdine flight master to the path-11616 berth;
    SIM-21 on every step that used such a dock). A walk to or from an
    inferred dock (the walker's dock and onward walks, a walk from a berth where a ride left the
    character, and the same-map rule's walks) therefore prices its swimming yards at the ground
    speed, raises no long-swim warning (SIM-21), and is an assumption: the swim stands for the walk
    along the pier. Measured on the committed navmesh from each dock's town flight master, against
    the walk to the nearest point within 100 yd of the berth that the snap puts on a walkable
    polygon plus the straight rest at the run speed: the rule is within +12 % to -14 % at five of
    the seven berths (the swim-speed price was +8 % to +34 % there), and 38 % and 47 % short at the
    path-11167 Auberdine berth, where the walk along the piers (419 yd) is much longer than the
    navmesh path through the water (271 yd), and at Rut'theran, where the nearest walkable point found is 95 yd
    away and its walk still swims 72 yd, so that comparison is the weakest
    (`.cache/map-ui-build/fix-travel/berth-compare.json`; a research note, not a gate). Other
    options the review named, a boarding point per dock or a snap that prefers the deck, need a
    navigation-data change and remain open.
- **TravelGraph seed:** the client ships the Era transports (paths 241, 285, 292, 293, 295, 301, 302,
  303, 436) and the Forever paths 11616, 11167, 11391, 11398 and 11457 (forever-game-rules.md
  section 6.5). A path in the client does not prove the transport runs on the server, so each
  record's `basis` says what is known. **Dock positions (ARCHITECTURE §9.1)** come from
  user-entered locations (`TransportRef.dock`), dataset dock NPCs (zeppelin and dock masters, at
  their converted spawns), or, since D-039 B, the committed taxi file's transport stops: each seed
  names the client path its source cites and which of that path's stops each of its stops is,
  matched by hand (map-presentation.md §10), and the dock takes that stop's position with basis
  `inferred` and its record ("client transport path 11167, stop 2 of 3"; `TransportDock.pointFrom`
  and `record`), in that order of precedence. At 1.60.1.70009 every one of the 15 seeded docks is
  positioned this way. The same-map transport rule (terrain-navigation.md §9.3 case 2) fires only
  between two navmesh components, so on the committed navmesh it applies to Rut'theran ↔ Auberdine
  (Teldrassil is a component of its own); Menethil and Southshore are one component, joined by a
  swim across the water (a 1,078 yd swim with SIM-21 from flight master to flight master), so it
  never fires there (NAV-08, corrected by review TR-06; `tests/derived-navigation.test.ts`). A user
  dock still positions only a stop on a map where its transport has one stop (`userDocksOf`): on a
  map with two stops of one transport (Menethil and Southshore) which stop it is would be a guess,
  and that limit remains. The file's other transport paths (241, 285, 292, 301, 302, 303,
  436) match no seed: the map draws their stops as "service unknown", and they never reach the
  TravelGraph. (Revision 2's cited `TaxiPathNode` dock positions, superseded by an architect
  ruling, are not what this is: the positions are the committed file's, with their record.) Wait
  and ride times stay the assumed defaults: the stops' `Delay` seconds are not used as ride times.

### 6.5 Interaction times (all ASSUMPTION unless stated)

| Action | Default | Note |
|---|---|---|
| Accept quest (open dialog, accept) (`acceptSeconds`, `acceptExtraSeconds`) | 3 s | 3 s for the first quest at an NPC, +2 s for each further quest in the same visit |
| Turn in quest (`turninSeconds`, `rewardChoiceSeconds`) | 3 s; +2 s if a reward choice | |
| Vendor / repair / trainer visit (`vendorSeconds`, `repairSeconds`, `trainerSeconds`) | 10 s / 5 s / 10 s | |
| Loot a corpse (`lootSeconds`) | 2 s | Walking to each corpse is part of the kill-loop time |
| Click a quest object (`objectUseSeconds`) | 5 s | SOURCE DATA for the generic "Opening" spell 3365: `SpellMisc.CastingTimeIndex` 6, `SpellCastTimes` 6 = 5,000 ms, identical in 1.15.9.69722 and 1.60.1.69977 (research exports in `<repo>/.cache/experiments/simulation/`); some objects are instant |
| Skinning (`skinSeconds`) | 2 s | SOURCE DATA: spell 8613, `SpellMisc.CastingTimeIndex` 5, `SpellCastTimes` 5 = 2,000 ms, identical in 1.15.9.69722 and 1.60.1.69977 |
| Kill a same-level normal mob, including rest/drink (`killSeconds`) | 30 s per kill | Class, gear and zone dependent. Must be a user parameter, calibrated per class |
| Talk to a flight master (`flightMasterSeconds`) | 3 s | Revision 2 |
| Death / corpse run | not modelled | |

#### TIME-8 Interaction rules

- A **visit** is a run of consecutive accept (or turn-in) steps with the same `via` entity, or the
  same resolved location, with no travel between them. The first accept in a visit costs
  `acceptSeconds`, each further one `acceptExtraSeconds`.
- A turn-in costs `turninSeconds`, plus `rewardChoiceSeconds` when the step has a `rewardIndex`.
- An accept or turn-in with `anyOf` acts on one quest (7.2, VAL-30) and costs one accept or
  turn-in.
- `vendor` costs `vendorSeconds`; `train` costs `trainerSeconds`; `note` and `abandon` cost 0 s.
- `durationOverride` on any step replaces the step's computed interaction and objective time
  (travel is still computed); its basis is `assumption`. It also replaces what the simulation said
  about that work (Milestone 6 review): an unknown objective or grind time (SIM-15), and for a grind
  step a long grind (SIM-11) and its upper-bound time (SIM-2), are not raised.
- All interaction time goes to `breakdown.interaction`.

### 6.6 Objective work

#### TIME-9 One objective target (ARCHITECTURE §5.3, §9.3; DSO-05)

A `complete` target `{ questId, objective }` refers to one entry of the quest's `ObjectiveDef` list
in Questie ObjectiveData order (ARCHITECTURE §5.4); `objective: null` means every objective of the
quest not yet finished. Counts are always null in QuestieDB, so the defaults below are assumptions.
Each target has **one** work count `k` (kills) or `u` (uses), used for both its time and its kill
XP:

| Objective kind | Work count | Seconds `s` | Kill XP `x` |
|---|---|---|---|
| `kill`, `killCredit` (NPC = `rootNpcId`) | `k = count ?? objectiveKillCount` | `k * killSeconds` | `k * killXp(P, M, rank)` |
| `item` with an NPC drop source | `k = ceil((count ?? objectiveItemCount) / itemDropChance)` | `k * (killSeconds + lootSeconds)` | `k * killXp(P, M, rank)` of the drop NPC |
| `item` with only object sources; `object` | `u = count ?? objectiveUseCount` | `u * (objectUseSeconds + objectSearchSeconds)` | 0 |
| `spell`, `event` | none | `eventObjectiveSeconds` | 0 |
| `reputation`; `item` with no known source | none | unknown: `SIM015-time-unknown` (info) unless overridden | 0 |

- `P` is the level at the start of the step (the lower bound when `unknownXpEvents > 0`). `M` comes
  from `mobLevelChoice` over the NPC's level range (KXP-4); `rank` from the NPC record. For item
  drops the drop NPC is the source whose spawn is nearest to the step's resolved location; without
  a location, the lowest NPC id.
- The kill XP of the step is granted once, after the work, through XP-2 (a level-up within the
  objective does not change the per-kill value; a simplification).
- A `durationOverride` replaces the time only; kill XP still comes from `k`.
- Travel to the step's location is TIME-2; the table is the work at that location.
- Basis: `assumption` whenever a count is assumed (always for QuestieDB); a user-entered count on a
  custom quest is also `assumption`. `eraFallback` in `forever-beta` through the kill-XP rules.

#### TIME-10 Multi-target `complete` (ARCHITECTURE §8.1, §9.3; DSO-07, D-020)

A `complete` step with several targets is one work block (shared kill targets, drops):

```
S = max_i(s_i) + objectiveConcurrency * (sum_i(s_i) - max_i(s_i))
f = S / sum_i(s_i)                     // f = 1 when sum_i(s_i) == 0
killXp = floor(f * sum_i(x_i))
```

- For `n` equal targets this is ARCHITECTURE §9.3's `objectiveSeconds x (1 + (n - 1) x concurrency)`;
  the max-plus-share form generalises it to unequal targets. `objectiveConcurrency = 0` means the
  other targets are done entirely while doing the largest; 1 means no overlap.
- Kill XP is scaled by the same factor `f` as time, so time and XP stay consistent.
- If any `s_i` is unknown, `S` is unknown (TIME-13) and kill XP is taken over the known targets with
  `f = 1`. A target whose quest the dataset does not know (DATA002), or whose objective index the
  record does not have (`DATA003-unknown-objective`), is such an unknown `s_i` (Milestone 6 review).
- **Progress `finish`:** each target objective is marked done in `questLog`. A target already done
  contributes nothing and emits `SIM012-objective-already-done` (info), not an error.
- A target whose quest is not in the log emits `SIM016-complete-not-in-log` (warning); the work and
  its kill XP are still charged, and nothing is marked. The `item` objectives priced this way are
  remembered (`itemsBeforeAccept`, 7.1): the items are in the bags, so the `accept` that next puts
  the quest in the log marks those objectives done (fact `objectives-before-accept`), and nothing
  prices them again (D-040 review). Kills, uses and events do not count toward a quest that is not
  in the log, so those objectives stay open after the accept.
- Time goes to `breakdown.objective`.

#### TIME-11 Partial work and incidental completion (ARCHITECTURE §8.1; DSO-07)

- **Progress `partial`** (RXP sticky and `#completewith` windows, ARCHITECTURE §10): objective time
  is `durationOverride ?? 0` s ("incidental"), kill XP is 0, and no objective is marked. Travel and
  interaction are still charged. The finishing step carries the whole work of its targets.
- **Turn-in with unfinished objectives** (never scheduled, or only `partial` steps), **of a quest
  an `accept` step of the route put in the log** (D-040): the turn-in carries their work.
  - Each open objective is priced by TIME-9 as a `complete` step without a location at the
    turn-in: `P` is the level at the start of the turn-in step, the kill place is the open world
    (KXP-5), and an item's drop NPC is the lowest id. Where the work was done is not known; the
    turn-in's place is not it. So the carried work equals that of an explicit `complete` step
    without a location just before the turn-in.
  - The open objectives are combined as one multi-target `complete` (TIME-10: the overlap, and
    kill XP scaled by `f`).
  - The seconds go to the turn-in's `breakdown.objective`. The kill XP is granted by XP-2 before
    the quest XP, as a `complete` step just before the turn-in would grant it, so the quest XP (and
    LINT-4) uses the level after it. The step's `xpGained` is the kill XP plus the quest XP, and is
    unknown when the quest XP is unknown. The known kill XP is still granted, and the route's known
    XP total counts it, as TIME-13 keeps a step's known seconds.
  - The objectives are marked done, and the turn-in emits `VAL030-objectives-carried` (warning).
    The fact's `time` says whether the turn-in's time counts the work (`counted`), a duration
    override stands in for it (`overridden`) or it is unknown (`unknown`); the warning and the
    UI say which.
  - Basis `assumption`, as for `complete` steps. An objective whose time TIME-9 cannot estimate
    leaves the turn-in's time unknown with `SIM015-time-unknown` (TIME-13), and its kill XP is taken
    over the known work with `f = 1`.
  - **Travel to the objectives is not priced.** The route's time is short by that travel, which
    the warning says; a `complete` step at the objectives' location prices it.
  - `partial` steps still cost only their override; the carried work lands on the turn-in once.
  - A `durationOverride` on the turn-in replaces the carried time with the rest of the step's own
    work (TIME-8) and drops SIM-15 for it. The kill XP is still granted (TIME-9), and the warning
    stays.
- **Turn-in with unfinished objectives of any other quest**, that is one in the log before the route
  (`priorQuestLog`, including one the route accepts again while it is still in the log, VAL-1) or
  assumed to be (`priorHistory: 'unknown'`): its progress is unknown, so the objectives are assumed
  completed incidentally. They are marked done at 0 s and 0 kill XP, and the turn-in emits
  `VAL030-objectives-incidental` (warning), not an error. Quest XP is granted as usual. A pre-route
  quest abandoned and accepted again in the route is the route's own, so its work is carried.
- Not carried either: objectives an earlier `complete` step finished (they are done), `item`
  objectives whose items a `complete` step collected before the accept (the accept marked them
  done, TIME-10), and a failed quest (it cannot be turned in, VAL-30). Kill, use and event work done
  before the accept does not count toward the quest, so the turn-in carries it (for the architect
  to rule, §1.5).
- **Superseded (D-040):** revision 2 assumed every unfinished objective completed incidentally at
  0 s and 0 kill XP, so a route of accepts and turn-ins alone under-counted both time and XP.
- **Superseded (DSO-07):** the first draft had no multi-target or partial work; every `complete`
  step cost a fixed amount at one place and a turn-in before objectives was an error.

### 6.7 Grind steps

#### TIME-12 Grind (ARCHITECTURE §8.1, §9.3; XP-4)

- **Level target** (`until: { kind: 'level', level: L, offset }`, `GrindTarget` in
  `src/domain/route.ts`). The engine resolves the target to a cumulative XP total `T` with the
  effective `xpToNextLevel` table (XP-1; `cumulative(L)` is the total at 0 XP into level `L`):

  | `offset` | RXP form | `T` |
  |---|---|---|
  | `null` | `.xp L` | `cumulative(L)` |
  | `{ kind: 'xpInto', xp: N }` | `.xp L+N` | `cumulative(L) + N` |
  | `{ kind: 'xpShort', xp: N }` | `.xp L-N` | `cumulative(L) - N` (level `L - 1` with `xpToNext(L - 1) - N`) |
  | `{ kind: 'fraction', fraction: F }` | `.xp L.F` | `cumulative(L) + ceil(F * xpToNext(L))` (the smallest XP at which the fraction is reached; `INFERRED`) |

  `T` is a total, so an offset beyond its level carries over like XP-2, and a negative `T` counts
  as 0. In `forever-beta` the table is `era-assumed`, so the resolved target carries `eraFallback`.
  **Superseded (architect ruling):** revision 2's `{ level, xp }` target could not express `L-N`
  or `L.F`, which RXP import approximated as "until level L".
  - State already at or above `T`: 0 s, state unchanged (still a lower bound if
    `unknownXpEvents > 0`).
  - `T > cumulative(maxLevel)` (XP stays 0 at the cap, XP-2): unreachable; unknown (TIME-13) with
    SIM-15.
  - With `xpPerHour`: `seconds = (T - cumulative(state)) * 3600 / xpPerHour`, and exactly
    that deficit is granted. At `xpPerHour` 0 the target is never reached: unknown with SIM-15
    (reason `zero-rate`; Milestone 6 review). Only a null rate uses the kill loop.
  - Otherwise, level by level: `M = mobLevel ?? P` (a same-level mob at each level),
    `x = killXp(P, M, normal)` (KXP-3); `kills = ceil(need / x)` where `need` is the XP to the next
    level (or to `T` within its level); `kills * x` is granted, overshoot carries over (XP-2), and
    `seconds += kills * killSeconds`. A gray mob (`x = 0`) makes the target unreachable (SIM-15).
  - If `unknownXpEvents > 0` and the target was above the lower bound: after the step
    `unknownXpEvents = 0` (the level is known again) and `SIM002-grind-upper-bound` (info) says the
    duration is an upper bound.
  - **SIM-11 (target level reached too late):** `seconds > grindWarnSeconds` emits
    `SIM011-target-level-late` (warning) with the minutes needed, or
    `SIM011-target-level-late-uncertain` when the duration is an upper bound. ARCHITECTURE §9.4
    names the check; this threshold rule defines it.
- **Duration target** (`until: { kind: 'duration', seconds: S }`): XP is
  `floor(S * xpPerHour / 3600)` with `xpPerHour`, else the level-by-level loop with
  `floor(S / killSeconds)` kills. It never resets `unknownXpEvents`.
- Kills on an instance map are dungeon or raid kills (KXP-5).
- Grind time goes to `breakdown.combat`. Basis `assumption` (`killSeconds`, the mob level or the
  user's `xpPerHour`). Rested XP is off (KXP-9).

### 6.8 Unknown time

#### TIME-13 Durations with unknown parts (ARCHITECTURE principle 3, §6)

- A part of a step's time that cannot be computed (an unresolved location, a position made unknown
  by a null-location `travel` step or a death skip, a cross-world move without transport, an
  unbound hearth, an unresolved flight node, an objective or grind that cannot be estimated)
  contributes 0 s to `timeSec`. The step's `duration` is `{ value: null, basis:
  'unknown' }`; `breakdown` records the known parts.
- Later `startSec`/`endSec` values and the route duration are then lower bounds. Route metrics
  report the known sum, the number of steps with unknown time, and "at least".

### 6.9 TIME-T Test vectors (`forever-beta` defaults unless stated)

| # | Setup | Expected |
|---|---|---|
| 1 | Ground move, 700 yd straight line, on foot | 700 x 1.25 / 7.0 = 125 s |
| 2 | Same, riding tier 1 / tier 2 | 78.125 s / 62.5 s |
| 3 | `train` riding rank 1 at level 38, no unknown XP | `SIM010-riding-too-low`; riding unchanged; 10 s |
| 4 | Same at level 40 | riding `{ trained: 1, speedBonus: 0.6 }`; 10 s |
| 5 | Flight between known flight masters 3,200 yd apart | 3 + 3200 x 1.4 / 32 = 143 s; basis `assumption`, `eraFallback` true |
| 6 | Same with `taxiSpeedBonusPct = 20` | 3 + 3200 x 1.4 / 38.4 = 119.67 s |
| 7 | Flight to a node not in `knownFlightPaths` | as 5, plus `SIM007-flight-unknown-path` |
| 8 | `hearth use` at t = 0, hearthstone ready | 10 s cast; location = hearth; `hearthReadyAt` = 3,610 |
| 9 | A second `hearth use` at t = 1,800 | waits 1,810 s (`waiting`), then 10 s; `SIM005-hearth-cooldown`; `hearthReadyAt` = 7,220 |
| 10 | Transport step, dock 100 yd away, on foot, default wait and ride | 100 x 1.25 / 7 + 60 + 60 = 137.86 s (`waiting` 60) |
| 11 | Consecutive steps on world maps 0 and 1 with no transport step | move unknown; `SIM004-cross-world-no-transport` |
| 12 | `complete` finish, one `kill` target, count null, P = 10, M = 10 normal | 8 x 30 = 240 s; kill XP 8 x 95 = 760 |
| 13 | `complete` finish, one `item` target with an NPC drop source, count null, P = 10, M = 10 | k = ceil(5 / 0.5) = 10; 10 x 32 = 320 s; kill XP 950 |
| 14 | `complete` finish with two targets as in 12 (two quests) | S = 240 + 0.5 x 240 = 360 s; f = 0.75; kill XP 1,140 |
| 15 | `complete` finish with the targets of 12 and 13 | S = 320 + 0.5 x 240 = 440 s; kill XP floor(1710 x 440 / 560) = 1,343 |
| 16 | `complete` partial, target as in 12, no override | objective 0 s; kill XP 0; objective not marked |
| 17 | Accept, then turn-in, of a quest with one `kill` objective and no finish step (count null, P = 10, M = 10 normal) | **Revised (D-040):** the turn-in carries row 12's work: objective 240 s, kill XP 760 granted before the quest XP; `xpGained` 760 + 850 = 1,610; `VAL030-objectives-carried`. The same turn-in of a quest in `priorQuestLog`: `VAL030-objectives-incidental`; objective 0 s; quest XP granted |
| 18 | Level 5, 0 XP; turn-in A with unknown XP | xp 0; `unknownXpEvents` 1; `levelAfter` 5 with `levelIsLowerBound`; `SIM001-unknown-xp` |
| 19 | Then turn-in B (era-seed B 840, Q 10) | +850 (100%, `RoundXPValue`); xp 850 of 2,800 |
| 20 | Then accept a quest with `requiredLevel` 6 | `VAL004-min-level-uncertain` (warning), not an error |
| 21 | Then grind `until: { kind: 'level', level: 6, offset: null }`, `mobLevel` null | need 1,950; 70 XP per kill; 28 kills; 840 s; level 6 with 10 XP; `unknownXpEvents` 0; `SIM002-grind-upper-bound`; `SIM011-target-level-late-uncertain` (840 s > 600 s, an upper bound) |
| 22 | `assumptions.maxLevel = 20` on `forever-beta` | effective `{ value: 20, basis: 'assumption', source: 'project' }`; turn-ins at level 20 give 0 XP |
| 23 | `train { spellId: 33388, skill: null, rank: null }` at level 40, riding 0 | recognised by `ridingSpells`; riding `{ trained: 1, speedBonus: 0.6 }`; 10 s |
| 24 | `train { spellId: 33391, skill: null, rank: null }` at level 45, riding 1 | tier 2 needs level 60: `SIM010-riding-too-low`; riding unchanged; 10 s |
| 25 | `character.riding = 1`, start level 45; first step 700 yd away, mode `'auto'` | riding starts `{ 1, 0.6 }`; 78.125 s; no train step needed |
| 26 | Level 9, 0 XP; grind `until: { kind: 'level', level: 10, offset: { kind: 'xpShort', xp: 300 } }`, `xpPerHour` 40,000 | T = 27,600 - 300 = 27,300; deficit 6,200; 558 s; level 9 with 6,200 XP |
| 27 | Level 10, 0 XP; grind `until: { kind: 'level', level: 10, offset: { kind: 'fraction', fraction: 0.5 } }`, `xpPerHour` 40,000 | T = 27,600 + 3,800; deficit 3,800; 342 s; level 10 with 3,800 XP |
| 28 | Level 9, 6,000 XP; grind `until: { kind: 'level', level: 10, offset: { kind: 'xpInto', xp: 2500 } }`, `xpPerHour` 40,000 | T = 30,100; deficit 3,000; 270 s; level 10 with 2,500 XP |
| 29 | grind `until: { kind: 'level', level: 60, offset: { kind: 'xpInto', xp: 1 } }` with `maxLevel` 60 | unreachable; duration unknown; `SIM015-time-unknown` |
| 30 | Step on an instance map whose entrance is 350 yd away on the current continent, on foot | 350 x 1.25 / 7 = 62.5 s to the entrance, 0 s inside; no SIM-4 |
| 31 | `priorHistory: 'unknown'`; accept a quest whose `preQuestSingle` quest is not in `C` | `VAL008-prequest-single-unverifiable` (warning); the quest is accepted. With `'listed'`: `VAL008-prequest-single` (error) |
| 32 | `accept { questId: A, anyOf: [A, B] }` at level 5; A has `requiredLevel` 8, B is acceptable | B is accepted; no issue for A |
| 33 | Accept, then turn-in, of a quest with the two objectives of row 14 (D-040) | objective S = 360 s; kill XP 1,140; after a `complete` step that finished the first objective, the turn-in carries the second alone: 240 s, 760 |
| 34 | Row 17's accept and turn-in with `durationOverride` 7 on the turn-in (D-040) | the step's own work is 7 s (travel still computed); kill XP 760 still granted; `VAL030-objectives-carried` with `time` `overridden`, saying the override stands in for the time |
| 35 | `priorHistory: 'listed'`; `complete` finish of an `item` objective, then accept, then turn-in (D-040 review) | the `complete` step prices the work with `SIM016-complete-not-in-log`; the accept marks the objective done (`objectives-before-accept`); the turn-in carries nothing; route time, XP and final state equal accept, `complete`, turn-in |
| 36 | As 35 with row 17's `kill` objective | the accept marks nothing; the turn-in carries the kills again (240 s, 760 kill XP) with `VAL030-objectives-carried` (ruled in D-040, §1.5) |
| 37 | Accept and turn-in of a quest whose item drops from NPC 1 (level 10, no spawn) and NPC 3 (level 14, 10 yd from the finisher), P = 10 | the carried work uses NPC 1, as a `complete` step without a location: 950 kill XP, not 1,140; a turn-in inside an instance carries open-world kill XP |

---

## 7. Route validator

### 7.1 State

The state is (with its `CharacterState` field, ARCHITECTURE §9.2):

- `P` (level; `level`, the known-XP lower bound of XP-4); `race` (ID); `class` (ID); `faction`
  (from the project character);
- `C`, the set of completed (turned-in) quests (`completed`); abandoned quests (`abandoned`);
- `L`, the quest log: accepted and not turned in, each entry `complete | incomplete | failed`
  (`questLog`, with per-objective progress and `failed`);
- skills `{skillId: value}` (`skills`, from `character.professions`, plus skill lines learned by
  profession `train` steps with a `skillId`, TIME-3; skill gains from use are not modelled);
- reputation `{factionId: value}` (`character.reputation` as the base, `null` = unknown, plus
  `reputationDelta` from each turn-in's `reputationReward`), where an undiscovered faction is 0 (or
  -36000 for factions that start below neutral, as in QuestieReputation.lua:163-195);
- known spells (`knownSpells`, from `train` steps with a `spellId`), known taxi nodes
  (`knownFlightPaths`), hearthstone bind and cooldown (`hearth`, `hearthReadyAt`), riding
  (`riding`).

**Initial state (ARCHITECTURE §9.2).** The walker starts from `ProjectV1.character`:

- `level = startLevel`, `xp = startXp`, `unknownXpEvents = 0`; `xpBasis` is `source` (declared)
  and `xpEraFallback` false; `timeSec = 0`. `startXp` is the XP into the start level; a value at or
  beyond `xpToNext(startLevel)` is carried over by XP-2 from 0 XP into the start level (so the walk
  starts at the level it reaches, `xpBasis` `derived` with the table's Era fallback), and at or
  above the cap it is 0. The validator then raises `SIM023-start-xp-beyond-level` (Milestone 6
  review);
- `location = resolve(startLocation)` (null when unset or unresolvable; TIME-2's unknown rules
  then apply to the first move, which records `position-unknown` with cause `start-unset` or
  `start-unresolved`); `hearth` and `hearthReadyAt` as in TIME-4;
- `knownFlightPaths` from `character.knownFlightPaths`; `riding` from `character.riding`
  (TIME-3); `skills` from `character.professions`; `knownSpells`, `reputationDelta` and
  `abandoned` empty;
- `C = priorCompletedQuests` and `L = priorQuestLog`. A pre-route log entry starts with no
  objective marked done (ASSUMPTION: its progress is not declared), so a turn-in of it without a
  `complete` step is the usual `VAL030-objectives-incidental` warning (TIME-11). Each log entry
  records whether an `accept` step of the route made it (`routeAccepted`): only such an entry's
  turn-in carries objective work (TIME-11, D-040). `itemsBeforeAccept` starts empty: it holds the
  `item` objectives a `complete` step priced while their quest was not in the log, until the
  `accept` that marks them done (TIME-10).
- `character.priorHistory` says how complete those lists are:
  - `fresh`: a new character. The lists are expected to be empty; they are used as given.
  - `listed`: the lists are exactly what happened before the route. Every rule is checked as
    written.
  - `unknown`: a mid-level start without a full list. The lists are a partial record, so a
    prerequisite that fails only because a quest is missing from `C` or `L` becomes a
    `-unverifiable` warning instead of an error (section 7.6).

  The rule keys off `priorHistory` only, never off `startLevel` or `startXp`. **Superseded
  (architect ruling):** revision 2 had no pre-route history, and its open question 10.10
  suggested inferring unverifiability from `startLevel > 1`.

Records are the **corrected** QuestieDB Forever records: raw data plus the six legacy Classic
correction providers plus the (currently empty) Forever fixes. See the note under 7.4.

### 7.2 Availability: `canAccept(q, state)`

All checks must pass. The order follows Questie `QuestieDB.IsDoable` (QuestieDB.lua:855-1120 [Q1])
and vmangos `Player::CanTakeQuest` (Player.cpp:12581-12593 [E1]). Revision 2 adjustments to these
rules (uncertain and unverifiable variants, repeatable exemption) are in 7.6.

**Any-of accepts** (`AcceptStep.anyOf`, RXP `.acceptmultiple`/`.daily`). The candidates are
`questId` followed by the other `anyOf` ids in list order. The walker accepts the first candidate
that raises no error, and emits only that candidate's warnings and infos. If every candidate
raises an error, the step is checked as a single accept of `questId`.

| ID | Field(s) | Rule (fail means not acceptable) | Source |
|---|---|---|---|
| VAL-1 | (status) | `q` is not in `L` | vmangos `SatisfyQuestStatus` :13548-13561 |
| VAL-2 | (status) | `q` is not in `C`, **unless** repeatable (VAL-3) | Questie IsDoable :876-879 |
| VAL-3 | `specialFlags` | If `specialFlags & 1`, the quest is repeatable: after turn-in it is re-acceptable (vmangos sets status NONE, Player.cpp:13184-13188). `& 2` means "exploration or event": **completion** needs an area trigger or scripted event, and it is not an availability gate (cmangos QuestDef.h:147-161; Questie calls it "Needs event", QuestieDB.lua:1676). `& 4` is monthly and unused in Era | [E3], [Q1] |
| VAL-4 | `requiredLevel` | `P >= requiredLevel`. There is **no** lower bound from colour: grey quests are legal | vmangos `SatisfyQuestLevel` :13335-13346; Questie IsLevelRequirementFulfilled.lua:61-65 |
| VAL-5 | `requiredMaxLevel` | If non-zero: `P <= requiredMaxLevel` | vmangos CanTakeQuest :12583; Questie :66-70 |
| VAL-6 | `requiredRaces` | nil or 0 means any race. Otherwise the race's bit must be set; see 7.3 for Skyborne | Questie QuestiePlayer.lua:93-107; vmangos `SatisfyQuestRace` :13507-13523 |
| VAL-7 | `requiredClasses` | nil or 0 means any class. Otherwise bit `2^(classId-1)` must be set | QuestiePlayer.lua:109-113 |
| VAL-8 | `preQuestSingle` | If non-empty: **at least one** listed quest is in `C` | Questie `IsPreQuestSingleFulfilled` :838-850 |
| VAL-9 | `preQuestGroup` | Evaluated **only if `preQuestSingle` is empty**. **Every** entry `p` must satisfy: if `p > 0`, `p` is in `C`, or some quest in `exclusiveTo(p)` is in `C` (a group member can be replaced by its exclusive sibling); if `p < 0`, `abs(p)` is in `C` exactly, with no exclusive substitution | Questie `IsPreQuestGroupFulfilled` :803-834, IsDoable :970-982 |
| VAL-10 | `parentQuest` | If non-zero: the parent is **in `L`** (child quests are offered only while the parent is active; this also bypasses the level filter) | IsDoable :984-990; IsLevelRequirementFulfilled.lua:28-33 |
| VAL-11 | `nextQuestInChain` | If non-zero `n`: `n` is not in `C` and not in `L` (a later chain step taken or done blocks earlier steps) | IsDoable :992-998; vmangos `SatisfyQuestNextChain` :13610-13630 |
| VAL-12 | `exclusiveTo` | No listed quest is in `C` or in `L` | IsDoable :1000-1010; vmangos `SatisfyQuestExclusiveGroup` :13576-13608 |
| VAL-13 | `breadcrumbForQuestId` | If non-zero `t`: `t` is not in `C` and not in `L`. vmangos is stricter: `canAccept(t)` must be true (Player.cpp:13453-13469). Use Questie's rule and add vmangos's as a warning | IsDoable :1039-1056 |
| VAL-14 | `breadcrumbs` | No listed breadcrumb is in `L` (the target is blocked while a breadcrumb is active) | IsDoable :1058-1067; vmangos :13471-13487 |
| VAL-15 | `requiredSkill` | `{skill, value}`: the character has the skill and `value(skill) >= value` | QuestieProfessions.lua:147-149, 172-181 |
| VAL-16 | `requiredMinRep` / `requiredMaxRep` | `rep >= min` and `rep < max` (strict) | QuestieReputation.lua:156-196 |
| VAL-17 | `requiredSpell` | `> 0`: the spell must be known. `< 0`: it must **not** be known | IsDoable :1021-1031 |
| VAL-18 | `availableUntilCompleted`, `availableStartingWith`, `disabledByQuest` | The first is not in `C`. The second is in `C` or `L`. The third is not in `L` | IsDoable :1069-1102 |
| VAL-19 | `requiredSpecialization`, `requiredRanks` | Profession specialisation / rank checks. `requiredRanks` is MoP-only; ignore it | IsDoable :946-968, 1012-1019 |
| VAL-20 | quest log size | `size(L) < capacity`, with capacity the effective `questLogCapacity`. Era: 20 (`Vanilla/Constants.lua:86-88 MAX_QUESTS = 20`; vmangos/cmangos `MAX_QUEST_LOG_SIZE 20`, QuestDef.h:34/32). Forever: **40**. The Forever client documents `QuestLogConstsMainlineCamelot.MAXIMUM_NUM_QUESTS_LOG_CAN_ACCEPT = 40` (`QuestConstantsDocumentation.lua:145-150`, 70009), and the Camelot quest log reads `Constants.QuestLogConsts.MAXIMUM_NUM_QUESTS_LOG_CAN_ACCEPT` (`Camelot/QuestMapFrameUtils.lua:18-21`). This is `FOREVER-CLIENT`, so the ruleset basis is `client-data` (section 1.2). Supporting evidence: forever-game-rules.md grades the beta value of 40 `REPORTED` (R9) and notes that the Forever UI gets the cap from the server. What the server enforces at launch is unknown (U13 there), and the ruleset value's `note` says so | [U1], [U2], [E1], [E3], F1 |
| VAL-21 | (emulator only) previous chain step | If some quest `x` has `nextQuestInChain == q` and `x` is in `L`, then `q` is blocked. Not in Questie. Emit a **warning** only | vmangos `SatisfyQuestPrevChain` :13632-13657 |
| VAL-22 | `needsEvent` (`specialFlags & 2`) | **Superseded by ARCHITECTURE §9.4 (DSO-15), confirmed by the architect's ruling:** v1 checks the `needsEvent` flag only and emits `VAL022-needs-event` (info) on accept; it never blocks, because the flag means completion needs a trigger or event (VAL-3). Research rule, not implemented: quests hidden by corrections (`hiddenQuests`), `QuestieEvent` quests and invasion quests are **not acceptable** unless the user enables the event. Those lists are Questie consumer blacklists, which the dataset does not consume or ship (DATA_PROVENANCE §4.2, §11); an owner decision would have to add them as an input | IsDoable :881-891, 1079-1108 |

Informational fields (no gate):

- `childQuests` is the inverse of `parentQuest`. Questie uses it to draw children and reset dailies
  (AvailableQuests.lua:698-738, QuestLifecycle.lua:81-89).
- `inGroupWith` means "same quest group". It is not read by Questie's availability code.
- `requiredSourceItems` are needed items that are not objectives.
- `sourceItemId` is given on accept, so it needs bag space (vmangos `CanGiveQuestSourceItemIfNeed`).
  Not modelled.

### 7.3 Race and class bitmasks

| Race (ID) | Bit | Mask | | Class (ID) | Mask |
|---|---|---|---|---|---|
| Human 1 | 0 | 1 | | Warrior 1 | 1 |
| Orc 2 | 1 | 2 | | Paladin 2 | 2 |
| Dwarf 3 | 2 | 4 | | Hunter 3 | 4 |
| Night Elf 4 | 3 | 8 | | Rogue 4 | 8 |
| Undead 5 | 4 | 16 | | Priest 5 | 16 |
| Tauren 6 | 5 | 32 | | Shaman 7 | 64 |
| Gnome 7 | 6 | 64 | | Mage 8 | 128 |
| Troll 8 | 7 | 128 | | Warlock 9 | 256 |
| **High Order Skyborne 95 (Alliance)** | **32** | **4,294,967,296** | | Druid 11 | 1,024 |
| **Windshaper Skyborne 96 (Horde)** | **33** | **8,589,934,592** | | | |

- Faction-wide masks: `77` is all Alliance and `178` is all Horde.
- **Skyborne rule (Questie, Forever only):** the exact masks 77 and 178 also admit the Skyborne race
  of that faction. Any other mask requires the actual Skyborne bit, so Human-only quests stay
  closed (QuestiePlayer.lua:21-26, 93-107; Questie docs/forever-development.md:164-168). Live
  verification is still pending upstream (FOREVER_WORK_LEFT_TO_DO.md row "Skyborne eligibility").
- Data: 1,464 quests have mask 0, 1,321 have 77, 1,170 have 178, and the rest are race-specific
  (`DATA`, raw Forever quests).
- **Implementation:** use `Math.floor(mask / 2 ** bit) % 2 === 1` or `BigInt`, **never** `&`. JS
  bitwise operators truncate to 32 bits and would silently drop Skyborne (D-012).

### 7.4 Field usage in the Forever data (`DATA`, raw file; corrections add more)

| Field | Raw quests with value | Added by legacy corrections (entries) |
|---|---|---|
| preQuestSingle | 2,232 | 329 |
| nextQuestInChain | 1,431 | 577 |
| exclusiveTo | 258 (632 links, all symmetric) | 211 |
| requiredMinRep / MaxRep | 256 / 41 | n/a |
| requiredSkill | 141 | 40 |
| inGroupWith | 111 | n/a |
| preQuestGroup | 42 (no negative entries) | 31 |
| parentQuest / childQuests | 42 / 30 (1 child->parent mismatch) | 21 / 16 |
| breadcrumbForQuestId / breadcrumbs | **0 / 0** | **205 / 150** |
| requiredMaxLevel | **0** | **42** |
| availableUntilCompleted / disabledByQuest | 0 / 0 | 20 / 10 |
| specialFlags (1 = 603, 2 = 207, 3 = 6) | 816 | 188 |

- Counts are from `<repo>/.cache/experiments/simulation/queststats.mjs`. Correction counts are `grep` hits
  on `questKeys.<field>]` in `src/corrections/Forever/legacy/classicQuestFixes.lua`. They are an
  upper bound, because some entries may sit in conditional branches.
- **Raw data alone is wrong for validation.** The extraction tool must emit the corrected records
  (DATA_PROVENANCE owns this).
- Content caveat: QuestieDB Forever is the **Era** quest set with converted coordinates. It has no
  new Forever quests (forever-game-rules.md section 7, L4; `<repo>/.cache/questiedb/docs/forever-data.md:48, 70-76`).
- The validator must accept unknown quest IDs as `unknown`: a warning (`DATA002-unknown-quest`),
  not an error (ARCHITECTURE §9.4).
- Likewise a `complete` target whose objective index the quest's record does not have is a warning,
  `DATA003-unknown-objective` (the RXP import reports it as RXP031; RXP.md), and its work has an
  unknown time (TIME-10) (Milestone 6 review).

### 7.5 Turn-in, abandon and lint rules

| ID | Rule | Source |
|---|---|---|
| VAL-30 | Turn-in needs `q` in `L` and not failed, at a `finishedBy` NPC or object. There is no level requirement on turn-in. XP uses `P` at that moment (XP-2). **Revision 2 (DSO-07), D-040:** objectives not finished by a `complete` step are not an error: for a quest an `accept` step of the route put in the log the turn-in carries their work (`VAL030-objectives-carried`, warning), and for a pre-route or assumed quest they are assumed completed incidentally (`VAL030-objectives-incidental`, warning) (TIME-11). A turn-in with `skipIfMissing` (RXP negative ID) whose quest is not in `L` is skipped without an issue. **Any-of turn-ins** (`TurnInStep.anyOf`, RXP `.turninmultiple`/`.dailyturnin`): the candidates are `questId` followed by the other `anyOf` ids in list order; the first candidate in `L` and not failed is turned in (its XP, and `rewardIndex` if set); if none is, the step is checked as a single turn-in of `questId` | vmangos RewardQuest; QXP-3 |
| VAL-31 | A quest with nil `objectivesText` and no `objectives` is auto-complete and can be turned in immediately | foreverQuestDB.lua key comment ("Auto-complete if nil"); Questie `IsComplete` :1586-1599 |
| VAL-32 | Abandoning removes `q` from `L`. It can be re-accepted (VAL-1..22). Children of an abandoned parent become unavailable (VAL-10) | Questie QuestLifecycle.lua:160-166 (`CompleteQuest`), 212-218 (`AbandonQuest`) |
| VAL-33 | Accept order: after accepting `q`, re-evaluate every quest whose `exclusiveTo`, `nextQuestInChain`, `breadcrumbs`, `breadcrumbForQuestId`, `disabledByQuest` or `parentQuest` mentions `q` | derived from VAL-10..18 |
| LINT-1 | Both `preQuestSingle` and `preQuestGroup` set: data warning. Follow Questie precedence (single wins) | IsDoable :970-972 |
| LINT-2 | An asymmetric `exclusiveTo`, `parentQuest`/`childQuests` mismatch, or dangling prerequisite ID: data warning | `DATA` (1 mismatch found) |
| LINT-3 | An accepted quest that is grey (COL) or gives 0 XP: warning ("low value"), not an error. Unknown XP is not 0 and does not trigger it | COL-5 |
| LINT-4 | A turn-in where `P - Q >= 6`: warning showing the XP lost (QXP-3). `P` is the level the quest XP is taken at: after the kill XP of objective work the turn-in carries (TIME-11, D-040) | QXP-3 |

### 7.6 Revision 2 adjustments (ARCHITECTURE §9.4; DSO-05, DSO-15, F12)

- **Rule list.** The validator implements VAL-1..22, VAL-30..33 and LINT-1..4. There is no
  VAL-23..29. The "extra checks" of ARCHITECTURE §9.4 are the SIM rules in 7.7. ARCHITECTURE §9.4
  names this section as the authoritative rule and code list, including the variants below.
- **Level uncertainty.** Level checks use `P_lb` (XP-4). While `unknownXpEvents > 0`:
  - VAL-4 failing on `P_lb` emits `VAL004-min-level-uncertain` (warning) instead of the error;
  - VAL-5 failing on `P_lb` stays an error (the true level is at least `P_lb`); VAL-5 passing on
    `P_lb` emits `VAL005-max-level-uncertain` (warning), because the true level may be higher.
    ARCHITECTURE §9.4's own wording names only checks that fail on the lower bound; this variant is
    part of the list ARCHITECTURE §9.4 delegates to this section;
  - SIM-10 and SIM-11 have `-uncertain` variants (TIME-3, TIME-12);
  - LINT-3 and LINT-4 that fire on `P_lb` are certain (a higher level only makes a quest greyer
    and reduces its XP more); they have no variant, and no issue is raised when they pass on
    `P_lb`.
- **Unknown pre-route history (ARCHITECTURE §9.2, §9.4; resolves open question 10.10).** With
  `character.priorHistory: 'unknown'` (7.1), a prerequisite check that fails only because a quest
  is missing from `C` or `L` emits its `-unverifiable` **warning** instead of the error, and the
  accept proceeds:
  - VAL-8 (`VAL008-prequest-single-unverifiable`) and VAL-9 (`VAL009-prequest-group-unverifiable`):
    a required quest is not in `C`;
  - VAL-10 (`VAL010-parent-not-active-unverifiable`): the parent is not in `L`;
  - VAL-18 (`VAL018-availability-window-unverifiable`): the `availableStartingWith` quest is in
    neither `C` nor `L`. The missing data is pre-route history, so this variant is a warning like
    the other prerequisite variants, not a VAL-15..19 profile info.

  Checks that fail because a quest **is** in `C` or `L` (VAL-1, VAL-2, VAL-11..14, the other
  VAL-18 parts) are unchanged: the recorded state proves them. With `fresh` or `listed` every
  prerequisite check is an error as written.
- **Unverifiable profile data (VAL-15..19).** When the profile lacks the data the check emits a
  `-unverifiable` info instead of passing or failing silently:
  - VAL-15: a skill in neither `character.professions` nor a profession `train` step of the route
    gives `VAL015-skill-unverifiable`. A value below the requirement is an error when it is the
    declared start value and the route never trained that skill line; when a profession `train`
    step of the route trained it earlier (TIME-3), its value is only a lower bound, so the check
    gives `VAL015-skill-unverifiable` (info) instead. Skill gains from use are not modelled.
  - VAL-16: `character.reputation == null` gives `VAL016-reputation-unverifiable`.
  - VAL-17: the base spellbook is unknown. `requiredSpell > 0` passes when the spell was trained in
    the route, else `-unverifiable`; `requiredSpell < 0` fails when it was trained in the route,
    else `-unverifiable`.
  - VAL-18: evaluated on the route state seeded from `priorCompletedQuests` and `priorQuestLog`;
    see the pre-route rule above. **Superseded:** revision 2 evaluated it on route state only,
    because the project had no pre-route history.
  - VAL-19: the profile has no specialisation field, so a quest with `requiredSpecialization`
    always gives `VAL019-specialization-unverifiable`.
- **VAL-22** is an info on accept for `needsEvent` quests and never blocks (ARCHITECTURE §9.4,
  confirmed by the architect's ruling), as in the table.
- **Repeatable quests** (VAL-3; 609 raw quests have flag 1 or 3) are exempt from the duplicate
  checks: VAL-2 never fires for them, while VAL-1 still does. Each repeat turn-in pays XP again
  (QXP-7). The optimiser never adds repeatable quests and keeps existing repeat turn-ins
  (ARCHITECTURE §11.2 rule 6).
- **Quest-log capacity** is the effective `questLogCapacity` of the ruleset (VAL-20).
- **Unknown quest IDs** are warnings (`DATA002-unknown-quest`), never errors.

### 7.7 Simulation checks (SIM-1..24)

The walker emits these while simulating (ARCHITECTURE §9.2-9.4). ARCHITECTURE §9.4 names this
table as the authoritative SIM list and names five of its checks in words (flight to an unknown
path, hearth on cooldown, cross-world travel without a transport, unresolved location, target
level reached too late). Rules marked "defined here" have no ARCHITECTURE wording of their own;
they are defined by this table. There are no SIM codes beyond SIM-24. SIM-17..21 were added in
Milestone 6 for the travel warnings of TIME-2 (terrain-navigation.md §9.3, §18); the simulation
passes each leg's warning through as data and the validator emits the code. SIM-22 and SIM-23 are
the route-level SIM issues (`stepId` null).

| ID | Code | Severity | Trigger | ARCHITECTURE |
|---|---|---|---|---|
| SIM-1 | `SIM001-unknown-xp` | info | A turn-in whose XP is unknown (XP-4) | §9.4 (code example), §9.3 |
| SIM-2 | `SIM002-grind-upper-bound` | info | A grind step with a level target (any offset) after unknown XP; the level is known again and the duration is an upper bound (TIME-12) | §9.3 |
| SIM-3 | `SIM003-unresolved-location` | info | A location, or every spawn of a step's entity, resolves to null (TIME-2). Not raised when a `travel` step with a null location or a death skip makes the position unknown | §6, §9.4 "unresolved location" |
| SIM-4 | `SIM004-cross-world-no-transport` | warning | A move between world maps without a transport step, a hearth use or an instance entrance edge (TIME-7) | §9.3, §9.4 "cross-world travel without a transport" |
| SIM-5 | `SIM005-hearth-cooldown` | warning | `hearth use` before `hearthReadyAt`; the walker waits (TIME-4). `-uncertain` variant when a step since the last cast has unknown time: the wait is unknown, at most the computed one | §9.2, §9.4 "hearth on cooldown" |
| SIM-6 | `SIM006-hearth-unbound` | warning | `hearth use` with no bind point (TIME-4) | defined here |
| SIM-7 | `SIM007-flight-unknown-path` | warning | A flight from or to a node not in `knownFlightPaths` (TIME-5). `-journey` variant (warning): the committed taxi file joins the two flight points only through nodes the character does not know, so TIME-5 stands in (TIME-6; review TR-09) | §9.4 "flight to an unknown path" |
| SIM-8 | `SIM008-flight-unresolved` | warning | A `TaxiNodeRef` or `nodeQuery` that resolves to no node, several nodes, or a node without a position (TIME-5) | defined here |
| SIM-9 | `SIM009-mount-untrained` | warning | Travel mode `'mount'` before riding is trained (TIME-2) | defined here |
| SIM-10 | `SIM010-riding-too-low` | warning | A riding `train` step (by `skill` or `ridingSpells`) below `mountLevels`; `-uncertain` variant (TIME-3) | defined here (DSO-16) |
| SIM-11 | `SIM011-target-level-late` | warning | A grind step with a level target needing more than `grindWarnSeconds`; `-uncertain` variant (TIME-12) | §9.4 "target level reached too late" |
| SIM-12 | `SIM012-objective-already-done` | info | A `finish` target that is already done (TIME-10) | defined here (DSO-07) |
| SIM-13 | `SIM013-condition-unknown` | warning | A step or group condition evaluates to `unknown`; the step stays active (`active: 'unknown'`) | §9.2 |
| SIM-14 | `SIM014-transport-faction` | warning | A transport whose `factions` excludes the character (TIME-7) | defined here |
| SIM-15 | `SIM015-time-unknown` | info | Objective or grind time that cannot be estimated (TIME-9, TIME-12), unless a `durationOverride` prices it | defined here |
| SIM-16 | `SIM016-complete-not-in-log` | warning | A `complete` target whose quest is not in the log (TIME-10) | defined here |
| SIM-17 | `SIM017-no-walking-path` | warning | Same world map, but the navigation data has no walking path and no transport joins the two places; the leg is the labelled straight-line fallback (TIME-2) | defined here (terrain-navigation.md §9.3) |
| SIM-18 | `SIM018-off-navmesh` | warning | A leg endpoint has no walkable polygon within 6 yd; the leg is the labelled fallback (TIME-2) | defined here (terrain-navigation.md §9.3) |
| SIM-19 | `SIM019-unverified-passage` | warning | The leg crosses a passage nobody has walked in game yet (D-034 item 5); the leg keeps its basis (TIME-2) | defined here (terrain-navigation.md §9.3) |
| SIM-20 | `SIM020-ambiguous-floor` | warning | A leg endpoint's floor is ambiguous; the leg uses the chosen floor (TIME-2) | defined here (terrain-navigation.md §8.3) |
| SIM-21 | `SIM021-long-swim` | warning | The leg's longest contiguous swim is over 200 yd; fatigue is unverified (TIME-2) | defined here (terrain-navigation.md §10) |
| SIM-22 | `SIM022-legs-pending` | info | Route level: navigation legs are still being computed; their times are the straight-line fallback until then (TIME-2). Absent from a final state | defined here (terrain-navigation.md §9.3) |
| SIM-23 | `SIM023-start-xp-beyond-level` | warning | Route level: `character.startXp` is at or beyond what the start level holds; the walk starts at the level it reaches (7.1; Milestone 6 review) | defined here |
| SIM-24 | `SIM024-flight-faction` | warning | A flight's departure or destination node is not open to the character's faction (`TaxiNode.factions`); the flight is still timed (TIME-5; review TR-08) | defined here |

### 7.8 Issue codes (F24)

Codes use ARCHITECTURE §9.4's grammar: a family prefix, a three-digit number and a slug. Rule
`VAL-4` has code `VAL004-min-level`; a variant appends a suffix (`-uncertain`, `-unverifiable`).
The registry is `src/validate/codes.ts`. This table and 7.7 are the complete list of `VAL`,
`LINT`, `SIM` and `DATA` codes that ARCHITECTURE §9.4 delegates to this section. `RXP` codes are
owned by RXP.md (§11.1). `DATA001-custom-shadowed` is defined by ARCHITECTURE §5.5 and listed
here so the list is complete.

| Rule | Code | Severity | Variants |
|---|---|---|---|
| VAL-1 | `VAL001-already-in-log` | error | |
| VAL-2 | `VAL002-already-completed` | error | not raised for repeatable quests |
| VAL-3 | (definition only) | | |
| VAL-4 | `VAL004-min-level` | error | `-uncertain` (warning) |
| VAL-5 | `VAL005-max-level` | error | `VAL005-max-level-uncertain` (warning; raised when VAL-5 **passes** on the lower bound, 7.6) |
| VAL-6 | `VAL006-race` | error | |
| VAL-7 | `VAL007-class` | error | |
| VAL-8 | `VAL008-prequest-single` | error | `-unverifiable` (warning; `priorHistory: 'unknown'`, 7.6) |
| VAL-9 | `VAL009-prequest-group` | error | `-unverifiable` (warning; `priorHistory: 'unknown'`) |
| VAL-10 | `VAL010-parent-not-active` | error | `-unverifiable` (warning; `priorHistory: 'unknown'`) |
| VAL-11 | `VAL011-later-chain-step` | error | |
| VAL-12 | `VAL012-exclusive` | error | |
| VAL-13 | `VAL013-breadcrumb-target-taken` | error | `VAL013-breadcrumb-target-unavailable` (warning; the vmangos rule) |
| VAL-14 | `VAL014-breadcrumb-active` | error | |
| VAL-15 | `VAL015-skill` | error | `-unverifiable` (info; skill not declared, or trained in the route) |
| VAL-16 | `VAL016-reputation` | error | `-unverifiable` (info) |
| VAL-17 | `VAL017-spell` | error | `-unverifiable` (info) |
| VAL-18 | `VAL018-availability-window` | error | `-unverifiable` (warning; `priorHistory: 'unknown'`, `availableStartingWith` part only) |
| VAL-19 | `VAL019-specialization` | error | `-unverifiable` (info; always in v1) |
| VAL-20 | `VAL020-quest-log-full` | error | |
| VAL-21 | `VAL021-previous-chain-active` | warning | |
| VAL-22 | `VAL022-needs-event` | info | |
| VAL-30 | `VAL030-not-in-log` | error | `VAL030-not-in-log-unverifiable` (warning; `priorHistory: 'unknown'` and the route never accepted the quest, 7.6), `VAL030-failed` (error), `VAL030-objectives-incidental` (warning), `VAL030-objectives-carried` (warning, D-040: the turn-in carries the time and kill XP of objectives no step finished, without the travel to them; it suggests a `complete` step; `data.time` is `counted`, `overridden` or `unknown`), `VAL030-finisher-mismatch` (warning, `via` not among the finishers) |
| VAL-31 | (definition only) | | |
| VAL-32 | `VAL032-not-in-log` | error | `VAL032-not-in-log-unverifiable` (warning; as VAL-30's) |
| VAL-33 | (engine order, no issue) | | |
| LINT-1 | `LINT001-prequest-both` | warning | |
| LINT-2 | `LINT002-link-mismatch` | warning | |
| LINT-3 | `LINT003-low-value` | warning | |
| LINT-4 | `LINT004-xp-reduced` | warning | |
| (ARCHITECTURE §5.5) | `DATA001-custom-shadowed` | info | |
| (7.4) | `DATA002-unknown-quest` | warning | |
| (7.4) | `DATA003-unknown-objective` | warning | |
| SIM-1..24 | see 7.7 | see 7.7 | `SIM005-hearth-cooldown-uncertain`, `SIM007-flight-unknown-path-journey`, `SIM010-riding-too-low-uncertain`, `SIM011-target-level-late-uncertain`, `SIM016-complete-not-in-log-unverifiable` (warnings) |

---

## 8. Mapping to ARCHITECTURE §9 types

The walker (ARCHITECTURE §9.2) mutates one `CharacterState`; simulation writes one `StepEstimate`
per step; derived numbers are `Estimated<T> { value, basis: 'source' | 'assumption' | 'derived' |
'unknown', eraFallback }` (ARCHITECTURE §9.3).

**Combination rule.** A value is `unknown` (value null) when a required input is unknown.
Otherwise its basis is `assumption` if any input is an assumption (an effective ruleset or project
value with basis `assumption`, user-entered XP, a user override, an assumed count or level), else
`derived` if it was computed, else `source` (read unchanged from one input). Ruleset values with
basis `client-data`, `official` or `reported`, dataset values and the route's own authored points
count as source inputs. `eraFallback` is true when the ruleset is `forever-beta` and any input has
basis `era-assumed` or is `era-seed` XP; in `era-1.15` it is always false. `assumptionsUsed` lists
every key whose effective basis is `assumption` or `era-assumed` that the step read, by its
section 1.2 parameter name (`RuleKey` in `src/rules`; Milestone 6). A travel leg's seconds are an
input with the leg's own basis (`assumption` for the straight-line model, `derived` for a
navigation leg).

`levelAfter` and `xpAfter` depend on every XP grant since the route start, so the walker keeps the
combined basis and `eraFallback` of those grants beside `xp`: ARCHITECTURE §9.2's
`CharacterState` holds them as `xpBasis` and `xpEraFallback`. Each grant combines into them by
the rule above; the start values are `source` and false (7.1). **Superseded:** revision 2 kept
this as walker-internal state because the `CharacterState` sketch had no field for it.

A grant also reads the XP table, so `xpToNextLevel`'s provenance joins `levelAfter`'s (its Era
fallback in `forever-beta`) and the step's `assumptionsUsed` gains it; when the cap bounded the
grant, `maxLevel` joins them too (an `assumption` when the project sets it). This holds for quest,
objective-kill and grind XP alike (Milestone 6 review).

| Rules | Reads | `CharacterState` written | `StepEstimate` / `Estimated` |
|---|---|---|---|
| (7.1 initial state) | `character` (`startLevel`, `startXp`, `startLocation`, `hearthLocation`, `knownFlightPaths`, `riding`, `professions`, `priorHistory`, `priorCompletedQuests`, `priorQuestLog`) | every field | none |
| XP-1..3 | `xpToNextLevel`, `maxLevel` | `level`, `xp`, `xpBasis`, `xpEraFallback` | `xpAfter`; `levelAfter` (basis from `xpBasis`, combined over every XP grant so far); `eraFallback` from `xpEraFallback` |
| XP-4 | `QuestRecord.xp`, custom quests, `questOverrides` | `unknownXpEvents` (+1 per unknown turn-in; reset by TIME-12) | `xpGained = { null, 'unknown' }`; `levelIsLowerBound = unknownXpEvents > 0`; `levelAfter.value` is the lower bound; SIM-1 |
| QXP-3..7 | XP basis, `dungeonQuest`, quest level, `questXpRounding`, both quest multipliers | `xp`, `level`, `completed` | `xpGained`: era-seed is `assumption` in `forever-beta` (the multipliers are assumptions) and `derived` in `era-1.15`; user XP `assumption`; forever-observed `source` at 100% and `derived` when reduced |
| KXP-1..7 | NPC levels and rank, `mobLevelChoice`, kill multipliers | `xp`, `level` | kill part of `xpGained`, `assumption` |
| KXP-8, KXP-9 | `groupXpEnabled`, `restedEnabled` | none (off in v1) | none |
| COL-1..5 | `level`, `greenRange`, `difficultyYellowLowerBound` | none | display only; feeds LINT-3 |
| TIME-1..3 | `runSpeed`, `swimSpeed`, `groundDetourFactor`, `mountSpeedBonus`, `mountLevels`, `ridingSpells`, `Location.radius`, the `TravelModel`'s legs (seconds, method, pending, warnings) | `location`, `timeSec`, `riding`, `skills` (profession training), `knownSpells` | `duration`, `breakdown.travel`, `breakdown.interaction`; `assumption` (straight line) or `derived` (navigation); `eraFallback` via `runSpeed`; SIM-17..21 from the leg's warnings |
| TIME-4 | `hearthCastSeconds`, `hearthCooldownSeconds`, `bindSeconds`, the durations since the last cast | `hearth`, `hearthReadyAt`, `location`, `timeSec` | `breakdown.waiting` (cooldown), `breakdown.travel` (cast); the cast is `source` and a wait with no step since the cast `derived`; otherwise the wait takes the combined basis of the durations since the cast, and is unknown after unknown time (TIME-4) |
| TIME-5, TIME-6 | `taxiModel`, `taxiSpeed`, `taxiDetourFactor`, `taxiSpeedBonusPct`, `flightMasterSeconds`, TravelGraph taxi nodes, the committed taxi file's legs (`EngineContext.localTaxi`, `taxiLegDataOf`) | `knownFlightPaths` (discover), `location`, `timeSec` | `breakdown.travel`, `breakdown.interaction`; `assumption`; `eraFallback` via `taxiSpeed` |
| TIME-7 | TravelGraph transports and instance entrance edges, `TransportRef`, `transportWaitSeconds`, `transportRideSeconds` | `location`, `timeSec` | `breakdown.waiting` (wait), `breakdown.travel` (walk and ride); `assumption` |
| TIME-8 | interaction keys, `durationOverride` | `timeSec` | `breakdown.interaction`; `assumption` |
| TIME-9..11 | `ObjectiveDef`, counts, objective keys, `objectiveConcurrency`; a log entry's `routeAccepted` (D-040) | `questLog` objectives (finish, an accept's items collected before it, and a turn-in's carried or incidental ones), `itemsBeforeAccept`, `xp`, `level`, `timeSec` | `breakdown.objective`, kill part of `xpGained` (a `complete` step's, or a turn-in's carried work, D-040); `assumption` |
| TIME-12 | `GrindTarget` (level with offset, or duration), `xpToNextLevel` (offsets), `killSeconds`, `mobLevel`, `xpPerHour`, `grindWarnSeconds` | `level`, `xp`, `unknownXpEvents`, `timeSec` | `breakdown.combat`, `xpGained`, `duration` (an upper bound after unknown XP); SIM-2, SIM-11, SIM-15 |
| TIME-13 | none | `timeSec` (known parts only) | `duration = { null, 'unknown' }`; later `startSec`/`endSec` are lower bounds |
| VAL-1..22 | quest record, `questLogCapacity`, profile, `priorHistory`, `AcceptStep.anyOf` | `questLog`, `completed`, `abandoned` via accept, turn-in and abandon; reads `skills`, `reputationDelta`, `knownSpells` | `ValidationIssue` only |
| VAL-30..33 | finishers, objectives, `reputationReward`, `TurnInStep.anyOf` | `questLog`, `completed`, `abandoned`, `reputationDelta` | `xpGained` through QXP; issues |
| LINT-1..4 | dataset, `level` | none | issues |
| SIM-1..22 | as listed in 7.7 | none | issues (SIM-22 at route level); SIM-13 sets `active: 'unknown'` |

---

## 9. Unit tests to write

| Suite | Cases |
|---|---|
| `xpTable` | All 59 rows of XP-1; total 4,084,700; the formula reproduces the table |
| `levelUp` | P=9 with 6,000/6,500 XP + 1,000 XP gives level 10 with 500/7,600. A multi-level grant. Cap at 60 discards the excess |
| `questXp` | Every row of QXP-T for both rounding variants; the `RoundXPValue` boundaries; every row of QXP-T2 (multiplier only on era-seed, dungeon multiplier, user XP as entered); a missing row gives `unknown`; level 0 or null gives `unknown` |
| `unknownXp` | TIME-T rows 18-21: lower-bound flags, `VAL004-min-level-uncertain`, reset by grind-until-level, `SIM002` |
| `killXp` | Every row of KXP-7, including both .5 ties; gray boundaries at P = 5, 6, 10, 39, 40, 59 |
| `groupXp` | The KXP-8 table (behind `groupXpEnabled`, off by default) |
| `rested` | P=10 (xpToNext 7,600): R max = 5,700; a 95 XP kill with R = 5,700 gives 190 XP and R = 5,605; quest XP unaffected; R = 0 at 60 |
| `colour` | Every row of COL-3; a ruleset switch to `difficultyYellowLowerBound = -4` flips `Q-P = -3, -4` to yellow |
| `ruleset` | Both ids; every key has a basis; `questLogCapacity` in `forever-beta` is 40, `client-data`, with a launch-enforcement `note`; precedence (project assumption wins and carries `basis: 'assumption'`, `source: 'project'`); only `AssumptionValues` fields are overridable, with the names of section 1.2; `maxLevel` 20 override (TIME-T 22); `eraFallback` false in `era-1.15` |
| `travel` | TIME-T rows 1-4, 10-11 and 30; `'mount'` without training gives SIM-9; unresolved location gives SIM-3 and unknown time; `Location.radius` shortens the move; a `travel` step with a null location and a `.deathskip` note make the position unknown without SIM-3; a transport with a user-entered `dock` and no TravelGraph record; a navigation leg's warnings and pending flag pass through (SIM-17..21), and its radius shortening is proportional; a transport step with no record never chooses among inferred docks (TR-01); a ride's `transport-ride` fact with its docks' records (TR-02); walks to and from a client berth priced as walking, without SIM-21, in the walker and the same-map rule, and on the committed navmesh (TR-03, TR-06; `src/engine/walker-travel.test.ts`, `tests/derived-navigation.test.ts`) |
| `riding` | TIME-T rows 3-4 and 23-25: recognised by `skill: 'riding'` or by `ridingSpells`; starting tier from `character.riding`; `era-1.15` has no riding spell ids |
| `training` | A profession `train` step with a `skillId` adds the skill line at 1; a later VAL-15 check on it gives `-unverifiable`; `skillId: null` changes only `knownSpells` |
| `grindTarget` | TIME-T rows 21 and 26-29: every offset kind, carry-over past a level, unreachable targets above `maxLevel` |
| `hearth` | TIME-T rows 8-9; unbound hearth gives SIM-6; moving a bind step changes the later destination |
| `taxi` | TIME-T rows 5-7 (straight-line default); `TaxiNodeRef` resolution by `npcId`, `taxiNodeId` and `name`, and SIM-8 for no match or several; leg length from a synthetic `taxi.local.json`-shaped fixture (never a real extraction); multi-hop sum over known nodes; transports excluded (`Delay > 0`); `taxiModel: 'auto'` falls back to TIME-5 without the local file or for an uncovered leg; `'straight-line'` ignores the file; the `-journey` variant of SIM-7 only for a journey through unknown nodes; SIM-24 for an endpoint closed to the faction; results not final while the file loads (`tests/map-places.test.ts`). **Superseded:** the first draft's "model B on three legs" test (research note R-1) |
| `objectives` | TIME-T rows 12-17 and 33-37; unknown reputation objective gives SIM-15; already-done target gives SIM-12; a turn-in carries open objectives only for a quest the route accepted (not pre-route, assumed or failed ones), priced as an explicit `complete` step without a location (the same drop NPC and kill place) and without its travel; items collected before the accept are not priced again; the known kill XP of a turn-in with unknown quest XP counts in the route's XP; a re-walk from a checkpoint equals a full walk, including one between a `complete` step and the accept that counts its items (D-040) |
| `validator` | One fixture per VAL-1..22, built from real Forever quest IDs after corrections (e.g. the 5-quest "Sweet Amber" chain 48-53, the 2/23/24 `inGroupWith` triple); Skyborne masks 77, 178, 1; `-unverifiable` variants of VAL-15..19; VAL-22 is info only and never blocks; a repeatable quest accepted twice raises no VAL-2. The data has no record with `requiredSpell` or `availableStartingWith`, so VAL-17 and that part of VAL-18 stay synthetic |
| `priorHistory` | TIME-T row 31; `priorCompletedQuests` satisfies VAL-8/9; `priorQuestLog` satisfies VAL-10 and lets a turn-in pass VAL-30 (with `VAL030-objectives-incidental`); the four `-unverifiable` warnings with `'unknown'`; errors with `'listed'`; VAL-2 and VAL-12 still fire on listed quests |
| `anyOf` | TIME-T row 32; an any-of accept where every candidate fails reports `questId`'s errors; an any-of turn-in picks the first candidate in the log |
| `codes` | Every emitted code exists in `src/validate/codes.ts` and matches the grammar of 7.8 |

---

## 10. Open questions and risks

1. **Forever XP numbers are server-side and changing weekly.** Quest XP (especially dungeons),
   dungeon kill XP, and possibly the curve (U1-U5 in forever-game-rules.md). A simulator built only
   on Era rules will mis-rank Forever routes. Mitigation: ruleset multipliers plus user calibration
   from observed turn-ins.
2. The `GetQuestGreenRange` value for levels 6-9 (4 vs 5). Needs one in-game check on Era.
3. Forever colour thresholds (`GetContentDifficultyQuestForPlayer`, `UnitQuestTrivialLevelRange`).
   Needs in-game observation at a few (P, Q) pairs.
4. Whether Era/Forever round **reduced** quest XP with `RoundXPValue` (default) or not.
5. The x2.5 dungeon-elite multiplier exists only in the emulators.
6. **Flight-time calibration.** Both models (TIME-6 on the committed path lengths, TIME-5 on the straight line) assume an Era speed. Calibrate it
   independently from self-timed in-game legs (the planned-vs-actual `ext` bag). The first draft's
   item "re-validate model B against our own timings" is superseded: model B is not used (R-1,
   D-024).
7. **Taxi data in the repository. Resolved (owner, D-039 B):** the client taxi graph is committed
   (`public/maps/client/taxi.json`) and deployed builds use TIME-6 from it (section 1.6); OD-6 is
   closed. Before that it lived only in the local `local-maps/taxi.local.json`. **Resolved in part
   earlier (architect ruling, D-022, D-024):**
   the TIME-5 detour default is a cited aggregate client statistic, allowed under D-022; it is not
   a taxi-derived leg timing, so OD-6 does not cover it. The first draft's question about
   committing values derived from client DB2 is otherwise settled by D-022 (cited individual
   values allowed; bulk tables and art local).
8. QuestieDB lacks creature type and XP-multiplier fields, so critters and no-XP mobs need a manual
   list.
9. 750 Forever quests have no XP row, about 211 of them in the leveling range.
10. **Pre-route quest history. Resolved (architect ruling; ARCHITECTURE §8.2, §9.2, §9.4).**
    `character.priorHistory` (`fresh` | `listed` | `unknown`), `priorCompletedQuests` and
    `priorQuestLog` seed `C` and `L`; with `unknown`, prerequisite checks give `-unverifiable`
    warnings (7.1, 7.6). **Superseded:** the suggestion to infer this from `startLevel > 1` or
    `startXp > 0` and to emit an info.
11. **Starting riding state. Resolved (architect ruling; ARCHITECTURE §8.2).**
    `character.riding` (0, 1 or 2) seeds the riding state (TIME-3).
12. **Instance maps. Resolved (architect ruling; ARCHITECTURE §9.1).** Zero-wait instance
    entrance edges from the dungeon entrances in `zones.json` make steps on instance maps
    reachable without SIM-4 (TIME-7), basis `assumption`. Remaining data dependency: an edge needs
    each dungeon's instance `WorldMapId` in `zones.json` (DATA_PROVENANCE §6.6); without it that
    dungeon's steps keep SIM-4.
13. **Objective defaults.** `objectiveKillCount`, `objectiveItemCount`, `itemDropChance`,
    `objectiveUseCount`, `objectSearchSeconds`, `eventObjectiveSeconds` and `objectiveConcurrency`
    are unmeasured placeholders. Calibrate from observed routes, or from counts parsed out of
    `objectivesText` once a labelled heuristic exists (ARCHITECTURE §5.3).
14. **`AssumptionValues` fields without a rule here.** `src/domain/assumptions.ts` defines
    `groupSize` ("scales kill time"), `secondsPerObjective` and `killXpMultiplier`, which no rule
    in this file uses; section 1.2 reads them as 1, unused and 1.0. Several parameters of section
    1.2 have no override field (for example `eventObjectiveSeconds`, `taxiSpeedBonusPct`,
    `hearthCooldownSeconds`). The architect should either define rules for the three fields (for
    example `killXpMultiplier` on all kill XP in KXP-5) or remove them, and decide which ruleset
    parameters become overridable. **Erratum (Milestone 6):** this said "before Milestone 7
    freezes schema version 1"; D-035 froze it from the Milestone 4 commit, so either change now
    needs a schema version bump and a migration.
15. **Closed (Milestone 6; see section 1.5):** ARCHITECTURE §9.4 governs, and the registry has
    the three `-unverifiable` variants. The original question follows.
    **Turn-ins of unlisted quests with unknown history.** With `priorHistory: 'unknown'`, a quest
    accepted before the route but missing from `priorQuestLog` still gives `VAL030-not-in-log` or
    `VAL032-not-in-log` (errors) and SIM-16 (warning) when the route turns it in, abandons it or
    works on it. ARCHITECTURE §9.4 relaxes only prerequisite checks, so this file does not add
    `-unverifiable` variants for these. Mid-level RXP imports will often hit this; an
    ARCHITECTURE change could extend the relaxation.

---

## 11. Sources

Local clones live under `<repo>/.cache/` (gitignored) and were fetched on 2026-09-25.

| ID | Source | Pin |
|---|---|---|
| A1 | This repository: [ARCHITECTURE.md](ARCHITECTURE.md) revision 2 as patched after the consistency check (§5.2-5.5, §6, §7.3, §8.1-8.2, §9.1-9.4, §11.2-11.3), [DECISIONS.md](DECISIONS.md) D-008, D-012, D-016..D-026, the domain types in `src/domain/` (`points.ts`, `route.ts`, `project.ts`, `assumptions.ts`, `estimate.ts`), [reviews/review-m0-architecture.md](reviews/review-m0-architecture.md), STATUS.md owner decisions (OD-6) | 2026-09-25 |
| E1 | vmangos core, https://github.com/vmangos/core, `src/game/Formulas.h`, `QuestDef.cpp/.h`, `Objects/Player.cpp`, `Objects/Unit.cpp`, `Group/Group.cpp`, `Movement/WaypointMovementGenerator.cpp`, `Objects/Creature.h` | branch `development`, `4b350a09fca8b5797975e343ae6300fbb5f9937b` (2026-09-15) |
| E3 | cmangos mangos-classic, https://github.com/cmangos/mangos-classic, `src/game/Tools/Formulas.h`, `Quests/QuestDef.cpp/.h`, `Entities/Unit.cpp`, `Entities/Creature.h`, `Groups/Group.cpp`, `MotionGenerators/PathMovementGenerator.cpp`, `Maps/Map.h`, `sql/base/mangos.sql` | `master`, `8ec338a1704e7dcb1c0213eb7ed58f9231ade40f` (2026-08-31) |
| E4 | TrinityCore `src/server/game/Quests/QuestDef.cpp` (`GetXPReward`, `RoundXPValue`), https://raw.githubusercontent.com/TrinityCore/TrinityCore/3.3.5/src/server/game/Quests/QuestDef.cpp | branch `3.3.5` at `48128f325ac5f1b597ab86b6b410d9eed1024bb1` |
| U1 | Blizzard UI source mirror (Gethe), https://github.com/Gethe/wow-ui-source, `classic_era`: `Blizzard_UIParent/Vanilla/UIParent.lua`, `Blizzard_UIParent_Vanilla.toc`, `Blizzard_UIPanels_Game/Vanilla/QuestLogFrame.lua`, `Blizzard_FrameXMLBase/Classic/Constants.lua`, `Blizzard_FrameXMLBase/Vanilla/Constants.lua` | `33e177d9bf38d76d5c6c6e05d5da78db1899659a` = 1.15.9 (69722) |
| U2 | Same mirror, `forever`: `Blizzard_FrameXMLUtil/Blizzard_FrameXMLUtil.toc`, `Mainline/DifficultyUtil.lua`, `Blizzard_FrameXMLBase/Constants.lua` + toc, `Blizzard_UIPanels_Game/Mainline/QuestMapFrame.lua`, `Camelot/QuestMapFrameOverrides.lua`, `Camelot/QuestMapFrameUtils.lua`, `Blizzard_APIDocumentationGenerated/{PlayerInfo,Unit,QuestConstants}Documentation.lua` | `bd2470aed543f72697a044e989285b6c83e63f73` = 1.60.1 (70009) |
| Q1 | Questie, https://github.com/Questie/Questie: `Database/QuestXP/QuestieXP.lua` (+ `.test.lua`), `Database/QuestieDB.lua`, `Modules/Libs/QuestieLib.lua`, `Modules/QuestieCompat.lua`, `Modules/QuestiePlayer.lua`, `Modules/QuestieReputation.lua`, `Modules/QuestieProfessions.lua`, `Modules/Quest/AvailableQuests/{AvailableQuests,IsLevelRequirementFulfilled}.lua`, `Modules/Quest/Lifecycle/QuestLifecycle.lua`, `Modules/VersionCheck.lua`, `Questie_Camelot.toc`, `FOREVER_WORK_LEFT_TO_DO.md`, `docs/forever-development.md`. Rules and line references are cited. The licence finding for Questie is recorded in D-016 | `master`, `40016145f8181f3f92049146ee655bd03d604a0a` (2026-09-24) |
| Q2 | QuestieDB, https://github.com/Questie/QuestieDB: `support/Forever/QuestXP/xpDB-classic.lua`, `support/Forever/provenance.json`, `data/Forever/foreverQuestDB.lua`, `data/Forever/foreverItemDB.lua` (lines 1006, 3471, 11427), `src/meta/{questMeta,npcMeta,itemMeta}.lua`, `src/corrections/Forever/**`, `docs/forever-data.md`. Publication of data derived from it follows D-016 | `b6f5b07b0acf1c820993cbb0ce2521c912bb4c92` (2026-09-23) |
| D1 | wago.tools DB2 CSV exports (`https://wago.tools/db2/<Table>/csv?build=<build>`): `QuestXP`, `QuestMoneyReward`, `ContentTuning`, `SpellCooldowns`, `SpellCategories`, `SpellMisc`, `SpellCastTimes`, `SpellEffect`, `SpellName`, `SpellLevels`, `ItemSparse`, `TaxiPath`, `TaxiPathNode`, `TaxiNodes`. Kept in `<repo>/.cache/experiments/simulation/` (local; bulk tables are not committed, D-022). One CSV per table and build, each fetched as an individual research request, never by scripted crawling or a pipeline (D-011, D-018) | builds 1.15.9.69722 (Era), 1.60.1.69977 and 1.60.1.70009 (Forever); fetched 2026-09-25 |
| W1 | warcraft.wiki.gg "Experience to level" (vanilla/Classic table and formula), https://warcraft.wiki.gg/wiki/Experience_to_level | read 2026-09-25 |
| W2 | warcraft.wiki.gg "Mob experience" (ZD, gray level, group bonus; notes the 4.0.3a base change), https://warcraft.wiki.gg/wiki/Mob_experience | read 2026-09-25 |
| W3 | warcraft.wiki.gg "API GetQuestGreenRange", https://warcraft.wiki.gg/wiki/API_GetQuestGreenRange | read 2026-09-25 |
| W4 | wowdev.wiki "DB/TaxiPathNode" (Flags 0x1 map change, 0x2 stop for Delay seconds), https://wowdev.wiki/DB/TaxiPathNode | read 2026-09-25 |
| B1 | Blizzard, "The World of Warcraft: Forever Beta Now Live", https://worldofwarcraft.blizzard.com/en-us/news/24304160 (beta cap 20, then 30) | 2026-09-17 |
| F1 | Forever game-rules research (this repo), [`research/forever-game-rules.md`](research/forever-game-rules.md), with sources S1-S9, R1-R13, C1-C11 | 2026-09-25 |
| X1 | Research scripts (not part of the product): `<repo>/.cache/experiments/simulation/{lualit,queststats,missingxp,vectors,taxi,fit,multihop}.mjs`. `fit.mjs` and `multihop.mjs` (and the optional comparison in `taxi.mjs`) read the local RXPGuides clone for research note R-1; their fitted outputs are not recorded in the repository. The TIME-5 detour measurement uses only the Forever `TaxiNodes`, `TaxiPath` and `TaxiPathNode` CSVs, by the method stated there | local |
| N1 | Cited only, not reused: RXPGuides (the RestedXP guide addon), Forever module `DB/forever/db.lua` and `DB/forever/flightData.lua`. RXPGuides declares CC BY-NC-SA 4.0 (`<repo>/.cache/rxpguides/LICENSE`, line 1). The owner's posture is not to combine its code, guide text or data values with this repository (D-019, D-024). This is not a legal conclusion | `c3429e065c06271827e9e412306fb1cede5ae852` |
