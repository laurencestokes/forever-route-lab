# Review: Milestone 0 architecture

Reviewed 2026-09-25, independently of the architecture's author, by four critics: general,
domain/simulation/optimiser, licensing/provenance, and performance. Each read ARCHITECTURE.md
revision 1 and the research documents cold and returned structured findings.

- **Result:** 68 findings (8 blockers, 34 majors, 23 minors, 3 nits). All blockers and majors were
  accepted, some in modified form. The fixes are in ARCHITECTURE.md revision 2 and in decisions
  D-016 to D-025.
- **Owner decisions** taken during triage: publish the Questie-derived dataset despite the
  licence finding (D-016); keep GPL-3.0-or-later; the Forever beta has no NDA (D-022); commit the
  12 DB2-only geometry rows (D-018).

## Blockers

| ID | Finding | Disposition |
|---|---|---|
| F01 / DSO-01 | Atomic steps with only a `group` key lose RXP tags, waypoints, annotations, payloads and sticky windows; round-trip export impossible | Accepted: `route.groups` sidecar, richer payloads, `project.imports`, export guarantee (ARCH §8.1, §10; D-020) |
| F02 / DSO-08 | `Location` required a WorldPoint, so percent points without geometry (Zephras Isle) were unstorable; export rewrote coordinate forms | Accepted: `Location` stores the authored `SourcedPoint`; world derived at runtime (ARCH §6; D-017) |
| F03 / LIC-01 | Local map art under `public/` would be copied into `dist/` | Accepted: `local-maps/` outside `public/`, dev/preview plugin, dist audit (ARCH §7.3, §16; D-018) |
| F04 / DSO-02 | Optimiser silently dropped unlocked non-quest steps; could break the suffix | Accepted: section contract with implicit anchors and bound steps (ARCH §11.2; D-021) |
| DSO-03 | Null XP would become 0 in the optimiser, dropping Forever-new quests | Accepted: unknown-XP quests are obligations; known-XP-only targets (ARCH §11.2 rule 6) |

## Majors

| ID | Finding | Disposition |
|---|---|---|
| F05 / LIC-02 / PERF-12 | Committed geometry path was gitignored; names and producer disagreed | Accepted: `public/maps/placeholder/geometry.placeholder.json`, one producer, per-row source (D-018) |
| F06 / PERF-2 | World-yard spawns contradicted DATA_PROVENANCE and inflate size | Accepted: ship source-frame percent; convert at load (D-017) |
| F07 | Flight masters and innkeepers missing from the shipped NPC set | Accepted: ship NPCs with FLIGHT_MASTER, INNKEEPER, TRAINER flags (ARCH §5.2) |
| F08 / PERF-3 | Premature lazy chunking; engine undefined before chunks load | Accepted F08 (load all at startup, synchronous `DatasetView`); PERF-3's design kept as the fallback if the budget is missed |
| F09 | Build-string equality could never match | Accepted: frame compatibility by hash (D-018) |
| F10 | Dependency table conflicted with type placement | Accepted: hand-written domain types, allowlist matrix, pure set listed (ARCH §4, §17) |
| F11 / DSO-12 / DSO-15 | Missing character/route profile and state (skills, reputation, spells, variants) | Accepted: `routeProfile`, character fields, state fields, `-unverifiable` codes (ARCH §8.2, §9) |
| F12 / DSO-05 | Unknown XP became 0 and levels looked exact | Accepted: `unknownXpEvents`, lower-bound levels, `-uncertain` codes, XP basis (ARCH §9.2-9.4) |
| F13 | Editing during a run or review could corrupt Accept | Accepted: revisions, editing locked during run/review, `baseRevision` check (ARCH §12.1) |
| F14 | Milestone order forced rework | Accepted: v1 unstable until M6; `geo` in M2; pure `diff` in M7 (ARCH §8.2, §18) |
| DSO-04 | Pruning was not a dominance rule; grind children always pruned | Accepted: Pareto dominance on exact keys (ARCH §11.4) |
| DSO-06 | ObjectiveDef could not hold all objective kinds; index order undefined | Accepted: discriminated union, Questie ObjectiveData order with hints (ARCH §5.3-5.4) |
| DSO-07 | `complete` could not express concurrent or incidental work | Accepted: multi-target `complete`, `partial`, incidental-completion warning; objective clusters in optimiser stage 2 (modified: not stage 1) |
| DSO-09 | Cross-world travel, flights and hearth under-specified | Accepted: TravelGraph, flight refs, hearth from state, cooldown wait (ARCH §9) |
| DSO-10 | Proposal reconstruction lost step fields; diff ambiguous; partial apply incoherent | Accepted: reuse original steps, change-sets, tie-breaking, re-walk before apply (ARCH §12.5, §13) |
| DSO-11 | Optimiser model could disagree with the engine | Accepted: constraint records for all VAL predicates, shared XP functions, engine re-walk, parity test |
| LIC-03 | DB2 values already in docs contradicted the posture | Owner decided: cited individual values allowed (D-022) |
| LIC-04 | local-context.md would publish a machine profile | Accepted: trimmed, absolute paths scrubbed, path check in the architecture test |
| LIC-05 | "Clean-room" claim unsupported by the process | Accepted: claim withdrawn; independent implementation rules (D-019); RXP.md transcriptions rewritten |
| LIC-06 | Fixtures contained lines matching RXP guides | Accepted: lines replaced; overlap tool (D-019) |
| LIC-07 | Default flight model fitted to RXP data | Accepted: emulator speed default (D-024) |
| LIC-08 | GPL delivery gaps (licence statement, notices, About, source link) | Accepted (ARCH §12.4, §16); archiving upstream source left as an owner decision |
| LIC-09 | Two manifests; non-reproducible fields | Accepted: one authoritative manifest, content-addressed `dataRevision`, non-shipped report |
| PERF-1 | Engine sized for 1k steps; per-step Map/Set copies; sync selectors | Accepted: mutable working state, checkpoints, one walk per revision, 10k budgets |
| PERF-4 | Search allocation and heuristic cost unbounded | Accepted: typed-array candidates, per-layer dedupe, trail arrays, travel matrix |
| PERF-5 | No anytime result; wall-clock vs determinism; yield mechanism | Accepted: incumbent, stepper, worker-owned clock, MessageChannel yield |
| PERF-6 | LCS diff O(n·m) on whole routes | Accepted: LIS O(n log n) |
| PERF-7 | Marker budget far below data volume | Accepted: level of detail, layer diffing (ARCH §7) |

## Minors and nits

Accepted: F15 (one provenance vocabulary), F16 (determinism contract), F17 (flight model source),
F18 / DSO-17 (custom-quest ID rules), F19 (Era-frame import option, `RXP030`), F20 (overlap
check scope), F21 (test additions), F22 (STATUS owner-decision table), F24 (naming, code
grammar), DSO-13 (determinism hazards), DSO-14 (fixture list), DSO-16 (assumption precedence,
riding, dungeon multiplier), LIC-10 (wording), LIC-11 (origins in manifest and notice), LIC-12
(SPDX allowlist), LIC-13 (zone-name source), LIC-14 (wago.tools manual-only), LIC-15 (build row),
PERF-8 (lazy boundaries; zod kept in entry to validate restored projects), PERF-9 (CI gates),
PERF-10 (idle-time autosave, project index), PERF-11 (fixed-height rows, in-house
virtualisation).

F23 accepted: overview surface deferred, group XP off by default, three-way provenance
classifier stubbed until upstream has Forever content.

## Evidence boundary

The critics worked from documents and the local QuestieDB clone. Their scratch measurements
(sizes, timings) were taken on this development machine and are indicative, not budgets. Legal
questions were identified, not answered.
