# Optimiser (Milestone 7 implementation plan, revision 2)

Status: **implementation plan, 2026-09-27, revision 2; built in Milestone 7 (steps M7.1-M7.7
and M7.9 done, M7.0 and M7.8 in part; §15).** Revision 1 was critiqued in
[reviews/review-optimizer-m7-plan.md](../reviews/review-optimizer-m7-plan.md) (one blocker, eleven
majors, eight minors), and revision 2 resolves every finding (§18). The build then went through a
critique of its own (correctness, parity, performance and runtime critics: 38 findings, COR, PAR,
PRF and RTD) and fixes, and a final verification on 2026-09-27. **What was built and measured is
[ARCHITECTURE.md](../ARCHITECTURE.md) §11, §13 and §14**; where this plan and those sections
differ, they win. §19 lists the departures. The figures below marked TARGET were measured in M7.7
(`docs/measurements/optimizer-m7.json`); the decision this plan asks the owner to ratify is still
D-043.

Authority: [ARCHITECTURE.md](../ARCHITECTURE.md) and [DECISIONS.md](../DECISIONS.md) (D-015,
D-021, D-028, D-037, D-038, D-040) win over this file until the §17 amendments land.
[SIMULATION.md](../SIMULATION.md) is the time and XP model the optimiser must reproduce, and
[terrain-navigation.md](terrain-navigation.md) §9.2-§9.5 is the leg table it reads.

**Labels.**

- **CODE**: read from the source on 2026-09-27; the file is named.
- **DECISION**: chosen here, for D-043.
- **CHECKED**: an expected figure walked through the real engine and validator. The scratch scripts
  are local and gitignored: `.cache/m7-plan-critic/fixtures.ts` (revision 1's figures, by the
  critic) and `.cache/m7-plan-rev2/{fixtures,bench-size}.ts` (revision 2's). A CHECKED figure is
  what the engine gives for that order. It is not yet the optimiser's output.
- **TARGET**: a budget or figure still to be measured in step M7.7. No optimiser figure in this plan
  is MEASURED yet.
- **ASSUMPTION** and **UNKNOWN** are as elsewhere.

**Words.**

- A **step** is a route step.
- A **unit** is what the search schedules: one quest action (the **host**) with the non-quest steps
  bound to it (§3.2).
- An **anchor** is a unit whose relative order among anchors is fixed.
- A **barrier** is a unit that leaves the position unknown. A **block** is a barrier merged with
  its original neighbours into one anchor (§3.6).
- A **location** is an interned endpoint (§5.2); a **point** is its world position.
- The **exit chain** is the travel from the section's end to the first suffix position that no
  longer depends on it (§5.4).
- Times inside the search are integer milliseconds.

The UI and every document say "best route found under these assumptions", never "optimal".

---

## 0. Summary

| Topic | Decision | Why |
|---|---|---|
| Scope | **Stage 1** ships: the section's own accept, complete and turn-in units are reordered or dropped, while anchors, blocks and bound units are kept. A **terminal grind fill** covers the XP that a reorder loses. By default it never replaces a dropped quest; the request may allow that (`grindFill: 'replace-quests'`, D-043, §2). `allowNewQuests`, objective clusters, hearth insertion and flight moves are deferred. | New quests need synthesised `complete` steps at representative objective locations, and flights need the taxi graph (D-039 B), which is not built. At the assumed kill rate, grinding beats a typical quest once its detour exceeds about 2,060 yd round trip, so replacing quests has to be the user's choice (review OP-08). |
| Contract | Checked twice. In the search it is compiled into obligations, precedence edges, barriers and numeric checks (level, log capacity, the suffix XP interval, riding tier). After the search, the app re-walks the whole route with the engine and the validator, and accepts a candidate only if every rule holds (§4). | `optimizer/core` may not import `validate` values, and the worker has no dataset. The validator stays the single authority. |
| Unknown positions | Every step that leaves the position unknown is a **barrier**. It moves only inside a **block** with its original neighbours, so no candidate prices a leg as unknown that the original priced (§3.6). | Travel from an unknown position costs 0 ms in the engine and in the search alike. Without blocks, the search would hide its longest leg there (review OP-01). |
| Availability | Relations come from a new `availabilityDependencies(record)` beside `check` in `src/validate/availability.ts`, including the breadcrumb target's. They are oriented by the original order, and minimum reputation is a `require` edge. VAL-4, VAL-5, VAL-20, the breadcrumb target's gates, any-of choices and `available` predicates are evaluated dynamically (§4.2). | "Through the validator's availability code", without a per-transition `ReadonlyCharacterState`. |
| Travel | One Int32 matrix of integer ms per riding tier present (at most three). Only the pairs that can be consecutive are requested and filled. The matrix is built at compile through the navigation model's **quiet** view (it reads the leg table without recording misses), after "computing paths" has filled the table. A run never compiles with pending legs (SIMULATION §6). A section needing more than 13,500 legs is refused (§5.3). | `model.leg` already turns tenth-yards into seconds with the speeds, picks same-map transports by total at those speeds, and applies the labelled fallback. Calling it keeps the engine and the optimiser equal by construction. |
| Positions | TIME-2's nearest spawn, the flight departure node and the transport crossing depend on where the character stands. They are tabulated per location at compile, with the engine's own choice functions and its own `Places` (§5.2, §5.4). | Parity (fixture 11) with no duplicated rules; the leg table's request cache is hit by point identity. |
| Pricing | Level-dependent work is priced **in the worker** by the `src/sim` functions themselves. The parts that depend on the level alone are memoised per (unit, level); grinds and hearth waits are priced per transition (§5.5, §6). | Exact, and no 60-level table at compile. |
| Search | A layered beam with records in typed arrays and **implicit drops** (no drop actions). A duplicate table is keyed by an **arithmetic two-lane hash** (no bitwise operators), with an exact comparison on a hit. Pareto pruning uses (elapsed, hearth ready time, unknown parts), with at most four entries per key. The XP total is part of the key, not the dominance test (§7). | "xp ≥ dominates" is not exact: quest XP falls with level, and VAL-5 blocks above a maximum level. |
| Determinism | The run is a fixed sequence of work items (rollouts and layers), never cut by the evaluation budget. The order is (score, elapsed, parent rank, unit index), where the unit index follows the original step order (§7.6). | Ties prefer the original order. Results are reproducible for exhaustion and budget stops, whatever the slice size. |
| Worker | `start`, `cancel` / `progress`, `best`, `done`, `error`. The worker owns the clock: slices of about 30 ms, a `MessageChannel` yield, and progress at most 10 per second. `done { cancelled }` acknowledges a cancel. The client terminates the worker if that does not arrive within 1 s, and drops messages from stale runs (§8). | This is the 3b.6 navigation worker pattern. |
| App | `DerivedActions.optimizationHost()` exposes the pipeline's context. The run uses **its own walker and validator**: an analysis walk, the paths phase, then a baseline re-walk that snapshots everything the run reads. Verification re-walks candidates on the same private walker (§9). There is no UI in Milestone 7. | The pipeline's shared walker re-walks while legs arrive, so its states can change during a run (review OP-11). |
| Diff | Match by id (or by semantic key). A **weighted** longest increasing subsequence keeps anchors fixed, so only free steps are reported as moved. Change-sets are grouped by quest, with non-quest steps grouped by their host. Exclusivity merges sets; prerequisites and the optimiser's step dependencies become `requires` edges; `applyChangeSets` closes over them (§10). | ARCHITECTURE §13. The relations are injected, because `diff` imports only `domain`. |
| Budgets | Analyse + compile ≤ 30 ms. At beam 256 on the Barrens and Durotar section (104 quests, 315 actions, CHECKED), the first improvement comes in < 2 s with the worker heap < 64 MB, measured in a worker thread. Fixture evaluations are exact. A diff of 10,000 steps takes ≤ 50 ms. The bundled, probe-normalised `tests/bench/optimizer.bench.ts --check` stores its results in `docs/measurements/optimizer-m7.json` (§14). | ARCHITECTURE §14, D-038. |

---

## 1. What changed since ARCHITECTURE §11 was written

| # | §11 or §13 says | The code now (CODE) | Resolution |
|---|---|---|---|
| 1 | `createTypeScriptBeamSearchOptimizer({ dataset, ruleset, geometry, workerFactory })` | Estimates need the **effective** rules (assumptions), the project's `TravelGraph` (user docks), the `TravelModel` with zone hints, the validator's availability, and a walk (`src/app/derived-pipeline.ts` `contextFor`) | `optimize(request, options, context)` with an `OptimizationContext` that the app builds from a private walk (§9, §11) |
| 2 | Phases `compiling`, `searching`, `finishing` | "Computing paths" (`scheduler.computeLegs`) must fill the leg table first (terrain-navigation.md §9.4) | New phase `paths`; `finishing` is the engine re-walk and verification (§9) |
| 3 | Rule 3: pool quests "never left in the log" | An original section may leave a quest in the log that nothing outside mentions. The incumbent would then be infeasible | Rule 3 is relative: all of a pool quest's units, or none (§4.1) |
| 4 | Rule 5 binds travel, note, vendor and train steps "to the next quest action in the same group, or else the next quest action", and anchors hearth, flight and abandon steps | A same-group host that is not the next quest step reorders the author's steps, so the incumbent would not be the original (review OP-03). Grind steps, `transport` travel, any-of accepts and turn-ins, `skipIfMissing` turn-ins, group skip decisions (`memo.groupSkip`) and completes before their accept (SIM-16) depend on state or order (`src/engine/steps.ts`) | A non-quest step binds to the **next quest step in the section**, whatever its group (§3.2). The state-dependent steps are implicit anchors. Steps whose static condition is `false` are inert anchors (§3.1) |
| 5 | Rule 2 "checked with the engine" per suffix accept; §11.3 "constraint records covering every VAL predicate" | Availability is `createAcceptChecks().check(questId, ReadonlyCharacterState)` in `src/validate/availability.ts`. `optimizer/core` may import only `domain, geo, rules, sim, engine` values (`tests/architecture.test.ts`) | Relations from `availabilityDependencies`, dynamic level, log and choice checks, suffix pins and the suffix XP interval, then the validator re-walk (§4) |
| 6 | Nothing about carried work | D-040: a turn-in carries the time and kill XP of objectives no `complete` step finished, **without the travel** (`carryWork`) | A `complete` unit is never dropped while its quest is kept, nor moved after its turn-in. A quest whose turn-in carries work is obligatory (§3.4). Carried work is priced exactly at the turn-in (§6) |
| 7 | "Matrix in integer ms, computed with `sqrt` only"; §9.4 "tenth-yards turned into ms in transitions" | `NavigationTravelModel.leg` computes `g/10/groundYps + s/10/swimYps + c/10`, and for cross-component pairs picks the cheapest same-map transport **at the given speeds**, else the labelled fallback. It records every miss for the scheduler's background drain (`src/app/navigation-model.ts`) | Integer-ms matrices per riding tier, built at compile through a **quiet** view of the model that records nothing (§5.3). Riding stays exact because the tier is state and selects the matrix |
| 8 | "Locations sorted by (mapId, x, y, entity id)" | A step without a location goes to its entity's spawn **nearest the current position** (`Places.nearestSpawn`, TIME-2). From an unknown position, several spawns leave the position unknown | A location is a spawn only if it is the nearest spawn from some reachable location (a fixpoint). Destinations are per-unit tables over the from-location (§5.2) |
| 9 | "The compiled problem (tens of KB)" | Every directed pair of N locations is N². "Computing paths" takes about 0.23 ms per leg on the realistic section (3.18 s for 116 locations, terrain-navigation.md §9.5) | Only pairs that can be consecutive are requested (§5.3). Size from 50 kB to about 4 MB per tier, **transferred** as copies (§5.6) |
| 10 | "XP is computed at transition time with the shared `sim` functions" | Objective work needs `ObjectiveLookup` (NPC levels and ranks, item drop sources and their spawns). The worker has no dataset | A pricing slice ships with the problem; the worker calls `sim` lazily (§5.5) |
| 11 | Dominance "elapsed ≤ and xp ≥, one strict" | `questXpTenths` falls as the level rises, and VAL-5 blocks above a quest's maximum level (`src/sim/quest-xp.ts`, `availability.ts`) | XP (level and XP into it) is part of the key. Dominance uses elapsed, hearth ready time, unknown parts, and divergence when penalised (§7.3) |
| 12 | "64-bit Zobrist key" | ESLint `no-bitwise` applies to the whole repository, tests included (`eslint.config.js`) | Two arithmetic lanes modulo primes (§7.2) |
| 13 | Drops not described | Rule 3's "untouched" option needs them | Implicit drops: `order` edges drop the units they overtake, and closing drops the rest (§3.4, §7.5) |
| 14 | Cancel "not acknowledged within a grace period" | — | `done` with termination `cancelled` is the acknowledgement; the grace period is 1,000 ms (§8) |
| 15 | "Identical output when the run ends by `maxEvaluations`" | — | The budget is checked after each work item (rollout or layer), and items are never cut (§7.6) |
| 16 | §11.7 lists 11 fixtures without numbers | — | Fully specified in §13, with three more (8b, 12, 13) |
| 17 | §13: "all operations touching one quest form one set"; moves from the LIS | Non-quest steps touch no quest. Prerequisites live in the dataset, and `diff` imports only `domain`. A plain LIS can report a locked step as moved (review OP-18) | Host binding from `domain`; relations and step dependencies injected; a weighted LIS that keeps fixed steps (§10) |
| 18 | §11.3 cross-world pairs "only via TravelGraph edges" | No instance entrance edges exist (ENG-01). Transports have no seeded dock positions (NAV-08). Moves between world maps happen only at hearth, flight and transport steps | Those steps are anchors. A free unit's cross-map pair is infeasible, never free. A guard test fails, and compile returns `failed`, when entrance edges meet the section (§5.3) |
| 19 | Stage 3 "flights over known paths" | D-039 B decided to commit the client taxi graph, but it is not built: `seedTravelGraph` has no taxi edges, so flights use TIME-5 (`src/sim/taxi.ts`) | Flights stay anchors in Milestone 7 (§2) |
| 20 | — | TIME-2 arrival radius `(d − r)/d`; TIME-8 visit discount (`acceptExtraSeconds` when not moved and same visit key, "moved" by point equality and legs walked); leg waypoints walked once per group before its first located step; `timeSec` advancing by known parts only (TIME-13); the XP-4 cap reset; `durationOverride` replacing work but not travel | All reproduced in transitions (§6) |
| 21 | — | Zone travel, death skips, unresolved destinations, several spawns from an unknown position, an unbound hearth and unresolved flight or transport arrivals leave the position unknown. The next move then costs nothing (`walkTo` → `unknownTravel`, `src/engine/movement.ts`) | Barriers and blocks (§3.6) |
| 22 | — | `stateBefore` returns only the character state. The visit key, walked waypoints and group skip decisions live in `WalkMemo` (`src/engine/state.ts`) | `RouteWalker.memoBefore(index)` and `RouteWalker.places` (M7.0) |
| 23 | — | SIMULATION §6: "Tests, exports and optimiser input never have pending legs" | Compile refuses a section whose legs are still pending after `paths` (§5.3). There is no provisional result |

---

## 2. Scope of Milestone 7: stage 1 now, stages 2 and 3 later

**Ships in Milestone 7 (DECISION):**

- **Stage 1.** The section's own quest units are reordered, and whole droppable quests are dropped
  (§3.4). Anchors and blocks keep their relative order. Bound units move with their host.
- **Terminal grind fill** (the smallest part of stage 2). When the known XP after the last unit is
  below the target, one new `grind` step is appended at the end of the section:
  - `until: { kind: 'level', level: L, offset: { kind: 'xpInto', xp } }` (or `offset: null` at a
    level boundary);
  - location, `mobLevel` and `xpPerHour` all null;
  - `origin: { source: 'optimizer', ref: null }`.

  It is priced by `sim/grind.ts` at the end state, as the engine will price it. It is offered only
  while `unknownXpEvents` is 0, so it never resets the uncertainty (XP-4). Without it, a reorder
  that turns quests in at a higher level would lose XP and could never meet `keep-original`, so
  stage 1 would rarely improve anything.
- **What the fill may cover (DECISION for D-043, review OP-08).** The request's
  `goal.grindFill` decides:
  - `'shortfall'` (default): the fill is offered only when **every droppable quest is scheduled**.
    It covers the XP a reorder loses (level-scaled quest and kill XP) or a numeric target above the
    pool, never a dropped quest.
  - `'replace-quests'`: the fill may also follow drops. At the assumed 30 s per kill, the review's
    example (a level-10, 1,000-XP quest with 8 kill objectives, worth about 18 kills) loses to
    grinding once its detour exceeds about 2,060 yd round trip. The user asks for this knowingly,
    and the result names the removed quests. Fixture 8b pins both modes.
- `src/diff`, the worker, the client, and the app's compile-search-verify path, without UI.

**Deferred, with reasons:**

| Deferred | To | Why not now |
|---|---|---|
| `scope.allowNewQuests` (and `scope.zones`, `scope.levelWindow`, which only filter new quests) | stage 2, after Milestone 8 | A new quest needs `complete` steps at representative objective locations. Without them, D-040 carries its work **without travel**, and the search would exploit the missing travel. No representative-location rule is accepted yet (terrain-navigation.md §9.5 used one for a benchmark only). Milestone 7 answers `allowNewQuests: true` with `failed`, reason "adding quests is not available yet". |
| Objective clusters (merging `complete` steps into multi-target blocks, TIME-10) and splitting steps | stage 2 | They synthesise and rewrite steps, which changes the diff and review model that Milestone 8 designs. |
| A grind fill anywhere but at the end | stage 2 | It needs a location and a mob level choice per insertion point. At the end, location null and the player's level (TIME-12) are what a user would write. |
| Moving or inserting hearth use and bind steps (cooldown-aware) | stage 3 | It changes bind points, and so every later hearth. The anchors keep TIME-4 exact. |
| Moving flight steps, or using flights over known paths | stage 3 | No taxi edges are seeded yet (D-039 B not built). TIME-5 times are straight line × detour and would reward flights the game may not offer. |
| Instance entrance edges in the matrix | when ENG-01 lands | None exist. The guard of §5.3 fails when they appear. |
| A leg-table fast path for large sections | if M7.7 measures compile over 30 ms | `model.leg` per pair is exact. A read of `g, s, c` from the table would duplicate `entrySeconds`. |
| Optimising over pending legs ("provisional" results) | not planned | SIMULATION §6 says optimiser input never has pending legs, and a result priced on fallback legs would be compared with a re-walk on navigation legs. A run whose paths are cancelled is `cancelled`; one whose legs stay pending is `failed` (§5.3). |

---

## 3. Sections, units, anchors and blocks

The request names the section by its first and last step ids. Compile maps them to indices in the
walked project (`first ≤ last`, both present, or `failed`). The **prefix** is the steps before
`first`, the **suffix** the steps after `last`, and the **pool** is every quest named by a quest
step in the section (`questId`, `anyOf`, `complete` targets).

### 3.1 How every step kind is classified

Rules are applied top to bottom; the first that applies decides. **Anchor** means an implicit
anchor. Locked steps are explicit anchors. Barrier status (§3.6) is decided separately, from the
original walk, and applies to a unit whatever its row.

| Step (CODE: `src/domain/route.ts`) | Role | Why |
|---|---|---|
| Static condition (`evaluateStaticCondition`, group or step) is `false` | **inert anchor**: 0 ms, no effect | It never runs; keeping it in place keeps the author's structure |
| `locked: true` | anchor | Rule 5 |
| `skipIf` not empty, on the step or on its group | anchor, with a truth check (§4.2) | Truth depends on state; the group decision is taken at the group's first step reached |
| `accept` or `turnin` with `anyOf` | anchor, with a choice check (§4.2) | The candidate chosen depends on state (`candidatesOf`, `turnInChoice`) |
| `turnin` with `skipIfMissing` | anchor, with `order` edges to its quest's units (§3.5) | Whether it runs depends on the log |
| `complete` whose target quests are not in the log at its original position (SIM-16 in the original walk) | anchor, with `order` edges to those quests' accepts (§3.5) | Items before the accept count at the accept (`itemsBeforeAccept`); kills do not |
| `hearth` (`use` or `bind`) | anchor; an unlocated `bind` also has a position check (§3.6) | Stage 3. A `bind` without a location binds where the character stands (`state.hearth = state.location`) |
| `flight` (`take` or `discover`) | anchor | Stage 3 |
| `abandon` | anchor | Rule 5 |
| `travel` with mode `transport` | anchor | A dock crossing and a change of world map (TIME-7) |
| `grind` | anchor | Its time depends on the XP state (TIME-12) and it may reset `unknownXpEvents`. It is priced by `grind()` wherever the chain puts it |
| `accept`, `complete` (`finish` or `partial`), `turnin` | **host** of a free unit | Stage 1 |
| `travel` (`auto`, `walk`, `mount`, located or not), `note` (death skips included), `vendor`, `train` | **bound** to a host (§3.2); an anchor when there is none | Rule 5 |

An anchor may still host bound steps. The unit is then an anchor unit.

### 3.2 Bound units (review OP-03)

- A non-quest step binds to the **next quest step in the section**, whatever its group. The
  non-quest steps between two quest steps therefore travel with the later one, and every unit is a
  contiguous run of the original section. The incumbent (the units in original order) is exactly
  the original section.
- Inert quest steps count as quest steps here, so binding follows contiguity exactly (a step bound
  to an inert host is part of an anchor unit).
- A trailing run of non-quest steps with no later quest step in the section is an anchor.
- Revision 1's "the next quest step in the same group" is withdrawn. With groups interleaved (T1 in
  G1, accept A in G2, accept B in G1), it bound T1 to B and put A before T1 in the incumbent.
- The shared helper is a new `questHostIndices(steps, from, to)` in `src/domain/route-ops.ts`. The
  diff uses the same rule for change-sets (§10), and ARCHITECTURE §11.2 rule 5 is amended to match
  (§17).
- A unit's steps run in their original order: bound steps first, host last.
- If the host is dropped, bound `travel` and `note` steps are dropped with it (the diff lists
  them). A bound `train` or `vendor` step makes its host's quest **obligatory**, because it changes
  riding, skills or spells, which rule 4 and VAL-15/17 depend on.
- A bound `travel` step with mode `walk` walks at tier 0 speeds (`travelSpeeds`); `mount` before
  riding is trained also walks at tier 0, with its `mount-untrained` fact.

### 3.3 Groups, waypoints and visits

- **The memo at the section start (review OP-04).** `stateBefore` returns only the character state.
  M7.0 adds `RouteWalker.memoBefore(index): ReadonlyWalkMemo`, a copy of the walker's `WalkMemo`
  before step `index`: `groupSkip`, `waypointsDone`, `visitKey` and `entrance`. It is rebuilt from
  the same checkpoint and replay as `stateBefore`, never re-derived from records. Compile reads the
  prefix's walked waypoints, the group decisions already taken, and the visit key the first
  section accept compares with.
- **Leg waypoints.** `walkWaypoints` walks a group's `leg` waypoints once, before the group's
  **first located active step** in walk order (`memo.waypointsDone`).
  - A group's waypoints are done when the prefix walked them (`memoBefore(first).waypointsDone`),
    or when a unit that holds an active located step of the group has been scheduled. The flag
    derives from the scheduled set and is not stored.
  - A unit has two travel variants per group it touches: with and without the waypoint chain.
    Compile precomputes both (§5.4). A waypoint's static filter is evaluated at compile, and a
    `false` waypoint is skipped as the engine skips it.
  - **Groups that continue into the suffix (review OP-16).** If the original walked a group's
    waypoints inside the section and the group has a step in the suffix, the quest of the unit that
    walked them is obligatory (§3.4 item 9). The flag at the section end is then the original's,
    and no suffix step walks waypoints the original walked in the section.
- **Visits (TIME-8, review OP-13).** An accept costs `acceptSeconds` if it **moved**, or if its
  visit key differs from the previous active step's. Otherwise it costs `acceptExtraSeconds`.
  - "Moved" is the engine's rule, `!samePlace(before, after) || work.legs.length > 0`: the point
    after the accept's own travel differs from the point before it (by map and coordinates, not by
    location index or zone hint), or its travel walked a leg (a waypoint, or a leg with
    `d − r > 0`). A waypoint chain that returns to its start has moved.
  - The visit key is the resolved point (a located accept) or the entity (an accept going to its
    NPC or object), compared as `sameVisit` compares them.
  - Any other **active** step clears the key. An inactive step leaves it as it was (the early
    return in `runStep`). The state keeps `lastVisit`, seeded from `memoBefore(first).visitKey`.

### 3.4 Obligatory and droppable quests

A pool quest is **obligatory**, meaning all its units must be scheduled, when any of these holds:

1. it is in **Q_ext**: named by any step outside the section, by a `skipIf` `questState` predicate
   anywhere, or by the dependency lists of a suffix availability reader (§4.4);
2. one of its units is an anchor or lies in a block (locked, conditional, SIM-16, barrier and the
   rest);
3. a bound `train` or `vendor` step rides on one of its units;
4. its XP is unknown (no record, `xp: null`, or an unknown quest level: `questXp` returns unknown),
   or it is repeatable (SIMULATION §7.2: "keeps existing repeat turn-ins");
5. one of its units has unknown time: unknown objective time (reputation objectives, items without
   a source), or an unresolved location. This keeps the count of unknown parts the same in every
   candidate, so known milliseconds compare fairly;
6. a suffix accept depends on it positively (`availabilityDependencies`, §4.2), which is
   fixture 7b;
7. **it is not untouched at the section start, or the section has no accept for it (review
   OP-07).** Untouched is the engine's `untouched()`: not in the log, completed, abandoned or
   accepted in the route. A quest in the prior quest log, a quest accepted in the prefix, or a
   quest the section turns in or completes without accepting (assumed in the log under an unknown
   history) is obligatory. Dropping it would leave it open, which rule 3 forbids and which
   verification would reject anyway;
8. **its turn-in carries objective work in the original walk** (an `objectives-carried` fact,
   D-040, VAL-30). The carried work is priced without travel, so a search free to drop quests
   would prefer these to honestly priced ones. The result lists them (`summary.carried`), with the
   note that their objective travel is not priced (review OP-07);
9. it holds the unit that walked the waypoints of a group that continues into the suffix (§3.3).

Every other pool quest is **droppable**: all of its units, or none (rule 3).

**Implicit drops (DECISION).** There are no drop actions to branch on. A droppable quest is
dropped when either:

- a unit is scheduled that has an `order` edge from one of its unscheduled units (§3.5), because
  that unit could never come first any more; or
- the node closes (§7.5), which drops every unscheduled droppable quest.

A drop that would leave the quest partly scheduled, or that would remove a `require` predecessor
of an obligatory unit, kills the child. A drop cascades through `require` edges: dependants die,
and their quests are dropped too if droppable, else the child dies.

### 3.5 Precedence edges

Two edge kinds live in one CSR table over units:

- `require` (u → v): u must be scheduled before v.
- `order` (u → v): u must be scheduled before v, **or dropped**.

| Source of the edge | Kind | Direction |
|---|---|---|
| The anchor chain (anchors and blocks) | `require` | Original order |
| A block with the section start as its predecessor, or the exit as its successor (§3.6) | `require` from the block to every other unit / from every other unit to the block | First / last |
| Each quest's own units: accept, then its `complete` units in original order, then turn-in (repeatable quests repeat the chain) | `require` | Original order. `partial` completes stay in the chain |
| A multi-target `complete` | `require` | After every target quest's accept in the section; before its turn-in; within each quest's chain |
| Availability, positive: VAL-8/9 completed, VAL-10 parent in the log, VAL-18 `availableStartingWith` | `require` from the dependency's accept or turn-in to the accept when it came first in the original; for VAL-10 also `order` from the accept to the parent's turn-in | Original order |
| Availability, negative: VAL-11 next in chain, VAL-12 exclusive, VAL-13/14 breadcrumbs, VAL-18 until-completed and disabled-by, VAL-21 | `order` between the accept and the dependency's accept, turn-in and abandon units | Original side kept |
| VAL-16 **minimum** reputation: turn-ins whose `reputationReward` raises the faction, and that came before the accept (review OP-05) | `require` | Original order. Dropping the rewarding turn-in drops the accept's quest with it, or kills the child. Fixture 13b |
| VAL-16 maximum reputation, and rewards that lower the faction | `order` | Original side kept |
| VAL-15 skill, VAL-17 spell: bound `train` steps | `order` | Original side kept (the train's quest is obligatory, so in effect `require`) |
| A conditional anchor's `questState` predicates; a `skipIfMissing` turn-in's quest; an `abandon` anchor's quest | `order` between the anchor and the units of the named quests | Original side kept |
| An any-of anchor, and an anchor with an `available` predicate: the named quests and every quest in their dependency lists (§4.2) | `order` between the anchor and those quests' units | Original side kept |
| A SIM-16 `complete` anchor | `order` to its quests' accepts | Original side kept |
| An unknown-XP turn-in K, and every XP-granting unit X that came before it in the original: turn-ins with known quest XP, completes with kill XP, carried-work turn-ins, grind anchors (review OP-20) | `order` X → K | X stays before K, or is dropped. Units that came after K may still move before it |

Edges point in the direction the original walk had, so the incumbent satisfies all of them.

**Why the unknown-XP edges (review OP-20).** After an unknown-XP turn-in the engine prices XP at
the lower-bound level (XP-4). That level is the level computed from known XP alone, whatever the
turn-in's position, so moving the turn-in gives the search no computed advantage: the known gain
is the same number. It does change which prices are exact. A turn-in placed earlier makes quest
and kill XP that the original priced before any unknown event into prices at a lower bound, which
can over-state XP reduced by the level difference. The edges keep every price that was exact in
the original exact. The walked counts back the scope: 763 of the dataset's 4,257 quests have no XP
value, and none of the 104 bench quests (CHECKED, `bench-size.ts`).

### 3.6 Barriers, blocks and position checks (review OP-01, OP-06)

**Position-unknown events.** In the engine, a move from an unknown position, or to a destination
that does not resolve, is unknown travel: 0 known seconds, and the position follows the
destination (`walkTo`, `unknownTravel`). The search prices it the same way, so verification cannot
see a problem. If such a step could move, the search would put its longest leg behind it. A step
is a **position-unknown event** when its record in the original walk ends with the position
unknown (`delta.locationAfter === null`), or has travel priced as unknown because of the position
(a `position-unknown` fact, or SIM-3 for an unresolved destination). These are:

- zone `travel` steps (location null) and death-skip `note`s;
- a destination that does not resolve under the geometry;
- `several` spawns, reached from an unknown position;
- a `hearth use` with no bind point;
- a flight or transport whose arrival does not resolve.

**Barriers and blocks.**

- A unit that holds a position-unknown event is a **barrier**.
- Its **block** merges it with its original neighbours into one anchor unit, in original order:
  - backwards, over the units that have no travel of their own, up to and including the first unit
    that travels to a destination;
  - forwards, over the units that leave the position unknown, up to and including the first that
    ends at a known position.
- Blocks that touch merge, so chains of events form one block.
- The section start is a barrier when `stateBefore(first).location` is null. A block that reaches
  the section start is scheduled first (`require` edges to every other unit), and one that reaches
  the section end is scheduled last, so the exit from an unknown position is also the original's.
- Every leg a candidate prices as unknown is then a leg the original priced as unknown, between the
  same steps. Free units still move across blocks: their legs into and out of a block are priced
  from and to known positions (the block's first destination, and its end).
- A block is an anchor, so the quests of its units are obligatory (§3.4 item 2). §4.3 has the
  consequence for `unknownParts`.
- Fixture 12 pins it. Without the block, the engine itself prices the order "far quest, then the
  zone travel" 270 s cheaper than the original (338.000 s against 608.000 s, CHECKED), because
  the leg from the far quest is free. The predecessor side matters as much as the successor side:
  the leg into a zone travel is as free as the leg out of it, so the review's required change (fix
  the successor) is extended to the predecessor.
- Revision 1's §5.4 listed zone travel and death skips as "other anchors", which contradicted
  §3.1. Both now follow this section.

**Position-reading anchors.**

- **An unlocated `hearth bind`** binds where the character stands, so its effect depends on the
  unit before it. Such a bind is feasible only when the position before it equals its original
  position (by point). The transition checks this, and a mismatch kills the child. The bind point,
  and every later hearth destination, is then the original's (review OP-06).
- **Flight and transport anchors** read the position too, but only to choose a departure or a
  crossing, which is tabulated per from-location (§5.4). Their arrivals are priced exactly, so
  they need no check.

---

## 4. The section contract, checked twice

### 4.1 Rule by rule

| §11.2 rule | In the search (compiled) | After the search (app: engine and validator re-walk of prefix + candidate + suffix) |
|---|---|---|
| 1. End state on Q_ext | Q_ext quests are obligatory, and their units keep their chain. Log membership, objective flags, `routeAccepted`, `acceptedInRoute`, turned in and abandoned are therefore unchanged | The state before the first suffix step, projected on Q_ext, equals the original's: log entries (objectives, `failed`, `routeAccepted`), `completed`, `abandoned`, `acceptedInRoute`, `itemsBeforeAccept` |
| 2. No new blocking | Suffix pins (§3.4 item 6); relations; the suffix XP interval and log-count rule at closing (§4.4) | `errors`: no error-severity issue on a suffix step, and no route-level one, that the original walk did not have, compared as (stepId, code, questId). `availability`: no accept, in the section or the suffix, has a lower availability truth than at its original position (`false < unknown < true`). `suffix-activity`: every suffix step's activity, and every suffix any-of choice, equals the original's |
| 3. No loose ends (relative, §1 row 3) | All-or-none per droppable quest; closing requires no partly scheduled quest | Each pool quest outside Q_ext ends with its original status, or untouched |
| 4. Travel state no worse | Hearth, flight and bind steps are anchors; an unlocated bind has its position check (§3.6); `train` steps are never dropped. A train whose riding outcome differs from its original outcome kills the child, and closing requires the riding tier to be at least the incumbent's (review OP-06). Closing requires `readyAtRelMs ≤` the incumbent's | Bind point equal; known flight paths ⊇; riding tier ≥; `hearthReadyAt` (absolute) ≤ the original's |
| 5. Anchors and bound units | The anchor chain; units and blocks (§3) | Locked and implicit anchors in the same relative order; every original step present except those of dropped quests |
| 6. Unknown XP | Unknown-XP quests are obligatory, and their turn-ins keep the XP-granting units that preceded them (§3.5). Target and achieved XP are known XP. `unknownXpEvents` is state | `unknowns.quests` = the pool's unknown-XP quests |
| 7. Goal | `min(elapsedMs + fillMs + exitMs)` with known XP ≥ target | Improvement is judged on the re-walk: the section plus the exit chain must be shorter than the original's by at least 1 ms. Parity (§6.3) is recorded |
| — Validity (§12.5) | — | No error-severity issue in the section that the original did not have |

The worker returns up to four distinct solutions (`candidates`). The app verifies them in order and
keeps the first that passes. With none, the result is `no-improvement`, and the reasons are listed
in the verification report.

### 4.2 Availability through the validator's code (review OP-05)

- **Dependencies (new, CODE to add).** `availabilityDependencies(record, dataset)` in
  `src/validate/availability.ts`, beside `check`. It returns:
  - the quest ids read, by relation: `completed` (VAL-8/9, with exclusive alternatives),
    `inLog` (VAL-10), `takenOrDone` (VAL-18 starting-with) and `blockers` (VAL-11/12/13/14/18/21);
  - `minLevel`, `maxLevel` and `parent` (VAL-10's lift of the level requirement);
  - `skills`, `spells`, and `factions` split into `minReputation` and `maxReputation`;
  - `breadcrumbTarget`: for a breadcrumb, the target quest and **the target's own dependencies**.
    VAL-13 runs `check` on the target in full (level, log capacity and relations), so the
    closure is one level deep, as `check`'s depth limit is.

  A test asserts, for every quest in the committed dataset, that `check` returns the same findings
  on states that differ only in quests outside the dependency lists. The test **holds the log size
  constant**: it swaps log entries for others outside the lists, because VAL-20 reads the log size.
  A rule change then fails CI until both change together.
- **Original truths.** The baseline walk's probe visitor (§5.1) records, at every accept in the
  section and the suffix, the findings of `checks.check(q, state, subject, false)` on the live
  state: the truth (`acceptTruth`) and the codes, in one call. It does this for the quest, for each
  any-of candidate, and for each `available` predicate's quests. It also records each skip
  predicate's truth. This replaces revision 1's `stateBefore` per accept (review OP-14).
- **Dynamic checks in the search.** The combined truth ranks `false < unknown < true`. The static
  part (race, class, specialisation, and the relations the edges hold) comes from the original
  findings minus the dynamic codes. The dynamic codes are evaluated from the node's state:
  - **VAL-4/5.** Level `L` (the known-XP lower bound) against `minLevel`/`maxLevel`, unless the
    parent lifts the requirement; the parent relation is preserved (§3.5). A failing VAL-4 while
    `unknownXpEvents > 0` is `unknown`, as `-uncertain` is. A passing VAL-5 while uncertain is
    `unknown`.
  - **VAL-20.** `logCount ≥ questLogCapacity` means `false`. `logCount` = `externalActive` + pool
    quests in the log. `externalActive` counts the section-start log entries whose quests have no
    unit in the section. A pool quest touched by a turn-in or complete while `priorHistory` is
    `unknown` and untouched enters the log at first touch, as `assumeInLog` does.
  - **VAL-13, target unavailable.** For a breadcrumb, the target's VAL-4/5 and VAL-20 at the
    node's state (the target's relations are held by the edges of its dependency lists). A target
    error gives `VAL013-breadcrumb-target-unavailable`, which is a doubt, so the breadcrumb's
    truth falls to `unknown`. Fixture 13c pins it.
- **Feasibility rules.**
  - An **accept** is feasible when its combined truth is at least its original truth. A proposal
    therefore never adds a blocking error, and never turns a `true` into a doubt.
  - An **any-of accept** (an anchor) evaluates its candidates in order. Every candidate before the
    original choice must still be `false`, and the original choice must not be `false`, so the
    engine chooses the same quest. Otherwise the child dies. Fixture 13a pins it. Any-of turn-ins
    choose by log membership, which their `order` edges hold (§3.5).
  - A **conditional anchor** must keep its original truth, or the child dies:
    - a `levelAtLeast` predicate is evaluated from the state's level and XP, with the engine's
      `xpStepSkipping` and uncertainty rules;
    - an `available` predicate uses the dynamic availability above and must **equal** its original
      truth, not merely reach it, because it changes the step's activity;
    - `questState` predicates are kept equal by their `order` edges;
    - `opaque` ones are always `unknown`.
- **Minimum reputation** is a `require` edge (§3.5), not a dynamic check. Dropping the rewarding
  turn-in therefore cannot newly block the quest.

### 4.3 Unknown XP and unknown time

- A turn-in with unknown quest XP adds `unknownXpEvents += 1` and grants nothing. The state keeps
  the lower-bound level (XP-4). Carried kill XP is still granted, as D-040 ruling 3 says.
- The count resets as the engine resets it: at the cap after a step, or by a grind anchor to a
  level while uncertain. The search never adds a grind fill while the count is above 0.
- Target: `keep-original` is the original section's known XP gain, the baseline probe's known
  total at the end of the last section step minus its total before the first. `knownTotal` is
  `cumulativeXp(level) + xp` of the lower bound. A number is taken as given.
- Unknown time counts 0 ms and increments `unknownParts`: unknown objective time, travel from an
  unknown position or into an unresolved location, and a hearth wait after unknown time (TIME-4).
  - Blocks (§3.6) keep every unknown travel part between the same steps as in the original. A leg
    with unknown seconds is usable only where the original used it (§5.3), and unknown-time
    quests are obligatory.
  - The count can therefore rise only through hearth waits. Closing requires `unknownParts ≤`
    the incumbent's.
  - The result states that times are lower bounds when the count is above 0.
- If the original section itself has a `cross-world-no-transport` fact (SIM-4), compile returns
  `infeasible`, reason "the section moves between world maps without a transport step (SIM-4)".
  The incumbent could not be priced honestly.

### 4.4 The suffix guard (review OP-16)

The suffix is not searched, but the section's end state feeds it. Three things can change there:
the XP (with `xpStepSkipping`, on by default, `levelAtLeast` skips read it), availability (any-of
choices, `available` predicates and accepts), and the travel out of the section.

- **The XP interval.** Compile collects every suffix threshold that the XP reaches before the
  first suffix grind anchor to a level that both walks reach. That is: each `levelAtLeast`
  predicate (step or group), each accept's `minLevel`/`maxLevel` (and a breadcrumb target's), each
  any-of candidate's and `available` predicate quest's level gates, and each riding `train` step's
  level. For a threshold T met at the original known total X_p, the end difference
  `Δ = knownTotal(end) − knownTotal(original end)` must keep the side: `Δ ≥ T − X_p` if
  `X_p ≥ T`, else `Δ < T − X_p`. The intersection is one interval, `[ΔLo, ΔHi)`, checked at
  closing. It approximates suffix XP as the original plus Δ (R14); verification is authoritative.
- **Suffix availability readers.** Suffix any-of accepts and turn-ins, and suffix steps with
  `available` predicates, read the log and the quests' relations.
  - The quests in their dependency lists join Q_ext (§3.4 item 1).
  - When any reader exists, closing requires the end `logCount` to equal the original's (VAL-20).
    Otherwise it may only be lower: a smaller log never blocks a plain accept.
- **Verification** re-checks all three on the re-walk: `suffix-activity` and `availability`
  (§4.1).
- **The exit chain** (§5.4) prices the travel out of the section as a state transition, including
  waypoints and a hearth use.

---

## 5. Compilation

### 5.1 The run's walks and the two compile calls (review OP-11, OP-14)

The run never reads the pipeline's shared walker. That walker re-walks whenever navigation legs
arrive, so its records and checkpoints can change during a run, and it sees new legs only after
`invalidate`. Instead:

1. **Analysis walk** (phase `paths`). `startOptimization` creates its own validator
   (`createRouteValidator` on the host's `ValidatorContext`) and its own walker (the host's
   `EngineContext`, whose travel model is the quiet view of §5.3, with the validator's accept
   policy). It then walks `host.project` once.
2. **`analyseSection(input)`** classifies steps (§3), builds units, blocks, quests, edges and
   destinations, interns locations, and lists the pairs the matrix needs (§5.3). Navigation changes
   only seconds (terrain-navigation.md §9.4), so this structure does not depend on the legs.
3. **"Computing paths"**: `host.computeLegs(pairs)`. The pairs include the legs the analysis walk
   asked for from the last hearth cast before the section to the section start (the **cast
   window**). The time since the cast then sets `readyAtRelMs` from complete legs. With no cast in
   the prefix the hearth is ready (`hearthReadyAt` starts at 0), and the window is empty.
4. **Baseline re-walk** (phase `compiling`). `walker.invalidate(castWindowStart)` (the section
   start when the window is empty), then a synchronous walk with the validator and the **probe**
   visitor (§4.2). The probe records the state scalars (level, XP, known total, `unknownXpEvents`,
   log count) and the availability and predicate truths at every section and suffix step, and a
   copy of the state after the last section step (`cloneState`, for rule 1). If
   `host.missingLegs(pairs)` is above 0, the run is `failed` (§5.3).
5. **`compileProblem(analysis, baseline)`** builds the matrices from the complete leg table, the
   anchor and exit tables, the pricing slice and the start state. It checks that the baseline's
   structure equals the analysis's (barriers, any-of choices, activity), else `failed`. It then
   prices the incumbent with `evaluateSequence` as a self-check (§5.6).

The run reads `stateBefore(first)` and `memoBefore(first)` once each, plus the records and the
probe; the state at the section end comes from the probe, not from a replay. Revision 1 called
`stateBefore` 78 times (6.1-18.7 ms measured by the critic) and `codes()` as often again.

Everything is ordered deterministically:

- units by original step index (so a unit's index is its tie-break rank);
- quests by `QuestId`;
- locations by (mapId, x, y, zoneHint);
- spawn candidates in `DatasetView.spawns` order.

Nothing depends on data arrival order.

### 5.2 Locations and destinations

- **Endpoints** come from the walker's own `Places`, which M7.0 exposes as `RouteWalker.places`.
  Endpoint objects, zone hints and point identities are then those of the walk. The navigation
  model's per-point request cache (a `WeakMap` by point object) is hit rather than missed. Revision
  1's `createPlaces(context)` made new objects (review OP-14).
- **Locations** are interned by (mapId, x, y, zoneHint). Each carries a **point id**, interned by
  (mapId, x, y) alone. "Moved" and zero-length legs compare point ids (review OP-13).
- **Locations** are:
  - the section-start position (`stateBefore(first).location`);
  - every located step's location and every leg waypoint;
  - bind points, the flight nodes the anchors may use, and transport docks;
  - the exit chain's positions;
  - **spawn candidates, by fixpoint.** A spawn is a location only if it is the nearest spawn of an
    entity some unit walks to, from some location already in the set. Compile starts from the
    fixed locations and adds chosen spawns until none is new (monotone and finite). Revision 1
    took every spawn of every entity.
- **Destinations.** A destination per step is one of:
  - `fixed(ℓ)`: a location, or a custom quest's `starterLocation` or `finisherLocation`;
  - `spawn(table)`: the nearest spawn by straight line from the from-location (`Places.nearestSpawn`,
    ties by spawn order); with no spawn on that map, the first with a world point. From an unknown
    position it is `several` when the spawns lie at more than one point, which can happen only
    inside a block (§3.6);
  - `none`: no travel (a `complete` without a location, an item target, a quest step whose target
    names no single entity);
  - `unresolved`: the location does not resolve under the geometry; always inside a block.

  Spawn tables are `Int32Array(N)` per entity, filled with `Places.nearestSpawn` for each
  from-location. Distances use `Math.sqrt` (`distanceYards`), never `hypot`.
- **Arrival radius.** A destination's radius (`Location.radius`, `Waypoint.radius`) is kept with
  the step. The transition scales the matrix ms by `max(0, d − r)/d`, with `d` from the two points'
  coordinates, and rounds again (TIME-2's rule, as `groundTravel`). With `d − r ≤ 0` the move is
  0 ms, walks no leg, and the position becomes the destination.

### 5.3 Travel matrices (review OP-09, OP-10, OP-13)

- **Tiers.** The riding tiers the section can use: the start tier, every tier a riding `train`
  unit can set, and 0 when a `walk`-mode step exists while riding. Usually one.
- **The quiet model.** M7.0 adds `NavigationTravelModel.quiet: TravelModel`. It uses the same
  table and request cache, but a miss is not recorded (`table.recordMissing` is not called); it
  answers with the pending fallback. The straight-line model is its own quiet view. The host's
  `EngineContext.travel` is the quiet view, so neither compile nor the run's walks queue legs for
  the scheduler's background drain. Revision 1's compile would have queued the whole remaining
  matrix after a failed or partial paths phase.
- **Requested pairs.** Only pairs that can be consecutive in some candidate are requested and
  filled:
  - from the section start and from each unit's possible end locations, to each unit's possible
    first destinations and to the exit chain's first destination (a spawn destination contributes
    only the spawn chosen from that from-location);
  - the fixed pairs inside units and blocks;
  - waypoint chains (into the first waypoint from each possible from-location, then chain to
    chain);
  - anchor tables' walks (to flight masters and docks, §5.4).

  A unit's end locations are its last destination (with spawn destinations, the image of its spawn
  table).
- **Entries.** For each tier `k`, the speeds are
  `travelSpeeds('auto', initialRiding(k, rules), rules).speeds`. For every requested directed pair
  `(a, b)` of locations on one world map:

  `ms[k][a·N + b] = Math.round(1000 × quiet.leg(end(a), end(b), speeds_k).seconds.value)`

  - A navigation leg present in the table is `g/10/groundYps + s/10/swimYps + c/10`: the leg
    table's tenth-yards and connector tenth-seconds turned into seconds with the tier's speeds, by
    the model's own `entrySeconds`.
  - A cross-component pair is the cheapest same-map transport **at those speeds** (walk, the
    `TravelGraph` edge, walk), else the labelled straight-line fallback with `no-walking-path`.
  - An unsnapped end, or a map without navigation data (or whose files failed closed), is the
    fallback, final and not pending.
  - The straight-line model gives `distance × detour / groundYps`.
  - When the two points coincide (same point id), the entry is 0 and `model.leg` is not called,
    as `groundTravel` returns 0 s without a leg when `d − r ≤ 0`.
- **Sentinels** (named constants in `matrix.ts`):
  - `UNKNOWN_MS = −1`: the leg's `seconds.value` is null. A pair the original walk itself used
    stays feasible (0 ms, `unknownParts += 1`), so the incumbent is priced. Any other move over such
    a pair is infeasible, as `CROSS_MAP` is: the search may not swap a known leg for an unknown one,
    for the reason of §3.6.
  - `CROSS_MAP = −2`: the points lie on different world maps. A free unit whose move needs one is
    infeasible, never free (SIMULATION TIME-7). Moves between world maps happen only inside anchors
    (hearth, flight, transport; §5.4).
  - `NOT_REQUESTED = −3`: never read. A read is a bug, and the tests assert that none happens.
- **ENG-01 guard.** The existing guard in `tests/derived-navigation.test.ts` fails once
  `zones.json` records an instance world map while the app seeds no entrance edge. M7.0 extends it
  to fail once `seedTravelGraph` produces an entrance edge, naming the optimiser. At run time,
  compile returns `failed` ("instance entrances are not priced by the optimiser yet (ENG-01)") when
  the graph has an entrance edge and the section has a location on an instance map. The matrix
  must price `walkTo`'s entrance composition, through an exported engine helper, before entrances
  ship.
- **Pending legs.** After `paths` and the baseline re-walk, `host.missingLegs(pairs)` counts the
  requested pairs whose legs (or dock walks) are still missing (`legsNeeded` is not empty). Above 0,
  the run is `failed`: "walking paths are not complete for this section (N legs); try again when
  computing paths has finished". This honours SIMULATION §6: optimiser input never has pending
  legs. A `paths` phase that is cancelled ends the run as `cancelled`. Revision 1's `provisional`
  result is withdrawn (review OP-19).
- **The leg limit.** A section whose requested pairs exceed **13,500** is refused (`failed`,
  "section too large: select fewer steps (N legs of 13,500)").
  - RC-07's 16 s ceiling (3.18 s × 4 × 1.25, terrain-navigation.md §9.5) was derived from the
    realistic 116-location matrix: 116 × 115 = 13,340 legs, about 0.24 ms per leg, in one
    `legsFrom` search per source.
  - The limit therefore holds the phase within the ceiling for sections like the one measured.
    Sources whose targets are far apart settle more of the mesh per search, so the limit is revisited
    when the Milestone 9 throttled run sets the ceiling for real.
  - Revision 1's threshold (600 locations, all pairs: 359,400 legs, about 81 s unthrottled) is
    withdrawn.
- **Warnings.** `long-swim`, `unverified-passage` and the rest do not change time and are not used
  by the search. The re-walk's SIM-17..21 issues show them in the proposal (Milestone 8).
- **Directed caching.** An optional `MatrixCache` (a two-entry LRU the app keeps; pure code):
  - It **owns its buffers**. Compile copies a hit (or a new matrix) into the problem with `slice()`,
    and those copies are what the worker receives by transfer. A transferred buffer is detached, so
    the cache never hands out its own (review OP-10).
  - The key is:
    - `model.id` and `model.revision` (the navRevision, or `straight-line`);
    - the fallback detour factor (`groundDetourFactor`, which the navigation model's fallback
      applies too);
    - `runSpeed`, `swimSpeed` and `mountSpeedBonus`, and the tier list;
    - the same-map transports of each map the pairs touch (ids, dock endpoint keys and seconds),
      because user docks change the compositions;
    - the table's unavailable maps (sorted ids);
    - the requested pair list: a two-lane hash (§7.2) to find the entry, then an exact comparison
      of the stored list.
  - Matrices are never symmetrised: `ms[a][b]` and `ms[b][a]` are separate legs (one-way drops and
    connectors, terrain-navigation.md §9.4).

### 5.4 Anchors with position-dependent choices, and the exit chain

The walker makes three choices from the current position. Each becomes an exported pure function
of `src/engine`, used by the walker (unchanged behaviour, proven by the existing engine tests) and
by compile, which tabulates it per from-location and tier:

| Choice (CODE today) | Export (new, `src/engine/choices.ts`) | Table |
|---|---|---|
| `Places.nearestSpawn` | `RouteWalker.places` | spawn tables (§5.2) |
| `flight()`: departure = `step.from`, else the nearest known usable node, else the nearest usable node (`nearestTaxiNode`) | `flightDeparture(graph, faction, known, step, near)` | The departure node per from-location. Known flight paths at each flight anchor are fixed, because discover steps are anchors in order. The flight seconds per (departure, arrival) come from `flightTime` (with `localTaxi` when present); the arrival node's location is the position after |
| `transport()`: candidate edges, `priceCrossing`, `better` (known first, least total, lower edge id) | `chooseCrossing(input)` (the from-endpoint, the step, the speeds, the model, the graph, the places and the rules) | The chosen edge, the total seconds and the arrival position, per (from-location, tier) |

Other anchors:

- `hearth use`: the wait is `hearthUse()` in the worker from `readyAtRelMs`; the cast is fixed. The
  position becomes the bind point, which is the original's (binds are anchors, and an unlocated
  bind is position-checked, §3.6). With no bind point the unit is a barrier.
- `hearth bind`: travel to its location, then `bindSeconds`; unlocated, the position check.
- `grind`: travel, then `grind()` in the worker.
- Zone `travel` (location null) and death skips are barriers (§3.6), not ordinary anchors.

**The exit chain (review OP-16).** The travel out of the section is not always the first suffix
step's own leg. A suffix step without travel (a note or `complete` without a location), or with a
spawn destination, keeps or reads the section's end position. The exit chain therefore runs over
the suffix steps that the original walk ran as active, from the first to the first
**position-fixing** one:

- a step whose travel ends at a fixed location or the bind point: a located step, a custom quest's
  location, or a hearth use;
- or one that makes the position unknown in the original (then the exit ends unknown, as in the
  original).

Compile tabulates, per possible end location and tier, the chain's travel ms: legs, spawn choices
and the waypoints the original walked there. The waypoint flags at closing equal the original's
(§3.3). A hearth use in the chain adds its cast and its wait, computed at closing from
`elapsedMs + chainTravelMs` and `readyAtRelMs`. Only the chain's `travel` and `waiting` parts
count; the steps' own work is the suffix's. A section at the end of the route has an empty chain
(0 ms). After the chain, positions equal the original's.

### 5.5 Pricing slice (shipped with the problem)

| Data | Why |
|---|---|
| `rules: EffectiveRules` (plain data, about 5 kB) | Every `sim` function takes it |
| Per `complete` unit: the list of `ObjectiveWorkInput` without `playerLevel`: quest id, index, the view's `ObjectiveDef`, `at` (the resolved location, or null when the step has no location) and `place` (`killPlace`) | `objectiveWork` and `completeWork`, as `complete()` calls them. Which objectives a unit works on is fixed at compile, because each quest's chain keeps its original order. So the done-set at each complete is known, as are `objective-already-done` and unpriceable targets |
| Per turn-in unit: the open objectives it carries (D-040: route-accepted, not failed, not done by its chain) or `incidental` | `carryWork`: `at` null, open world, the lowest drop NPC id |
| The NPC records (levels, rank) and item records they reference, and the spawns of the drop NPCs of item objectives priced at a point | `ObjectiveLookup` for `killXp`, `mobLevelOf`, `dropNpcFor` |
| Per quest: its effective `QuestXp`, `minLevel` (QXP-7) and `dungeonQuest` | `questXp` |
| Per `train` unit: `skill`, `spellId`, `rank`, and its original riding outcome | `trainRiding`, and the outcome check (§4.1 rule 4) |
| Per grind anchor: `until`, `mobLevel`, `xpPerHour`, place | `grind` |
| Constant parts, computed at compile: interaction seconds per step (`interactionTime`), `durationOverride`, `partialWork` | Exact and level-free |

**Memoisation (review OP-12).** The worker memoises only what depends on the level alone, in
`Float64Array` tables filled on first use:

- a `complete` unit's objective block (seconds and kill XP) per (unit, level);
- a turn-in's carried block per (unit, level);
- `questXp` per (quest, level);
- `trainRiding` per (unit, level, uncertain, current tier).

`grind()` (anchors and the fill) depends on the XP into the level and on `unknownXpEvents`, and
`hearthUse()` on the time, so both are priced per transition, unmemoised. A turn-in reads its
carried block at L, grants the kill XP, and then reads `questXp` at the level after it (D-040
ruling 2): two lookups, not one (unit, level) entry. The entries are pure functions of the problem,
so the fill order cannot change results.

### 5.6 Self-check, size and budget

- **Self-check.** `evaluateSequence(problem, incumbent)` runs on the main thread (the pricing is
  pure). It must be feasible and within parity (§6.3) of the baseline walk's `sectionPlusExitMs`
  (§6.3's engine side, read from the baseline records). If not, compile returns `failed`, reason
  "the optimiser's model disagrees with the engine on this section: <which unit>". That is a bug
  signal, never shown silently.
- **Size.** For N locations and T tiers, `4 N² T` bytes plus the slice. The matrix is dense, with
  `NOT_REQUESTED` where no leg is needed:
  - the Barrens and Durotar bench (N about 150-200 after the spawn fixpoint, INFERRED from the
    Barrens pool's 116 locations plus Durotar's 26 quests): 90-160 kB per tier;
  - N is capped at 1,024 (4 MB per tier). Beyond that, or beyond the leg limit (§5.3), the result
    is `failed` with "section too large: select fewer steps".

  The problem's typed arrays are **copies** (§5.3) and are transferred to the worker
  (`postMessage(message, transfer)`). The main thread keeps the decode table (unit → step
  indices).
- **Budget:** analyse + compile ≤ 30 ms (TARGET) on the bench section. It excludes "computing
  paths" and the two walks, which are reported separately (§14). The main costs are the requested
  `quiet.leg` calls (about 13,000 per tier at most; each is a WeakMap hit, a table read and a small
  allocation) and the spawn tables.

---

## 6. Transitions and parity with the engine

### 6.1 One transition

`apply(node, u)` runs unit `u`'s steps in order, exactly as `runStep` would. For each step:

1. **Activity.** Inert: skip. It leaves `lastVisit` unchanged, as `runStep` returns before
   clearing it. For a conditional anchor, check the truth (§4.2). For an any-of accept, check the
   choice (§4.2).
2. **Travel.** The tier (`walk` mode is 0), then the group's waypoint chain if due (§3.3), then
   the destination (§5.2):
   - the same point id: 0 ms, no leg;
   - otherwise `ms += scale(ms[tier][loc][dest])`, and the location becomes `dest`;
   - `UNKNOWN_MS`: 0 ms and `unknownParts += 1` on a pair the original used, else infeasible
     (§5.3);
   - `CROSS_MAP`: infeasible for a free unit;
   - from an unknown position, or into `unresolved`: 0 ms and `unknownParts += 1`. This happens
     only inside blocks (§3.6), where it matches the original step for step;
   - a zone `travel` or a death skip: 0 ms, `unknownParts += 1`, and the position becomes unknown
     (also only inside blocks);
   - an unlocated `hearth bind`: the position check (§3.6).
3. **Interaction.** The fixed seconds, with the TIME-8 visit rule for accepts ("moved" by point id
   or a walked leg, §3.3).
4. **Work,** priced at the level at the step's start:
   - `complete`: the memoised objective block at level L, then grant its kill XP;
   - `turnin`: the carried block at L, grant its kill XP, then `questXp` at the new level; grant it,
     or `unknownXpEvents += 1`;
   - grind anchor: `grind()`;
   - hearth use: `hearthUse()`, with `sinceCastUnknown` making the wait unknown;
   - `train`: `trainRiding()`. An outcome that differs from the original's kills the child (§4.1
     rule 4);
   - flight or transport anchor: its table.
5. **Override.** A valid `durationOverride` replaces the step's interaction, objective and combat
   parts (`applyDurationOverride`); travel and waiting still count. Kill XP is unaffected. A
   `partial` complete costs its override or 0 and marks nothing.
6. **Effects:** log, objective flags, `logCount`, XP (see below), riding tier, bind point,
   `readyAtRelMs`, `lastVisit`, and position-unknown.

After the unit comes XP-4: at the effective cap with `unknownXpEvents > 0`, reset it to 0. XP is
kept as (level, XP into it, known total). A grant that stays below `toNext(level)` is added
directly; one that crosses a level or reaches the cap calls `grantXp(curve, state, amount)`. The
two agree by construction, and a property test checks it.

### 6.2 Each cost part and the `sim` function it reuses

| Engine step (CODE `src/engine/steps.ts`) | Part | `sim` function, same arguments |
|---|---|---|
| `accept` | interaction | `interactionTime({ kind: 'accept', firstInVisit })` |
| `complete` (finish) | objective, kill XP | `objectiveWork`, then `completeWork` (TIME-9, TIME-10) at `playerLevel = level before the move`, `at`, `place` |
| `complete` (partial) | objective | `partialWork(durationOverride)` |
| `turnin` | interaction, carried objective, kill XP, quest XP | `interactionTime({ kind: 'turnin', rewardChoice })`, `objectiveWork` + `completeWork` (at null, open world), `questXp` at the level after the carried kill XP (D-040 rulings 1-3) |
| `grind` anchor, and the grind fill | combat, XP, reset | `grind(input, xpCurveOf(rules), rules)` |
| `hearth` use / bind | waiting, travel (cast) / interaction | `hearthUse` / `interactionTime({ kind: 'bind' })` |
| `flight` | walk, flight-master interaction, flight | `interactionTime({ kind: 'flight-master' })`, `flightTime` (compile) |
| `travel` transport | walks, wait, ride | `groundTravel` + `transportCrossing` inside `chooseCrossing` (compile) |
| `train` | interaction, riding | `interactionTime({ kind: 'train' })`, `trainRiding` |
| `vendor`, `note`, `abandon` | interaction | `interactionTime` (`note` and `abandon` are 0 s) |
| Any ground move | travel | `model.leg` (matrix) and `groundTravel`'s radius rule |
| Any step | total | `stepDuration` semantics: known parts only (TIME-13) |

### 6.3 Rounding and parity (fixture 11)

- Each part is rounded to integer ms once (`Math.round(seconds × 1000)`), as is each matrix entry.
- The engine sums float seconds. The difference is at most 0.5 ms per part, plus 1 ms per
  radius-scaled leg.
- **Parity metric:**
  - the engine side, `engineMs`, is `(endSec(last section step) − startSec(first section step)) ×
    1000`, plus the `travel` and `waiting` buckets of the exit chain's steps × 1000, in the re-walk
    (all known seconds). The original's `sectionPlusExitMs` is the same quantity on the baseline
    walk;
  - the optimiser side is `estimatedMs = elapsedMs + fillMs + exitMs`;
  - required: `|estimatedMs − engineMs| ≤ max(0.01 × engineMs, 1 ms × priced parts)`.

  The 1% of ARCHITECTURE §11.7 is the ceiling. The part-count bound is what the design delivers,
  and the tests assert both.
- Determinism across engines: only `+ − × ÷`, `Math.sqrt`, `Math.round`, `floor`, `ceil`, `min`,
  `max`, `abs` and `Math.fround` (inside `sim`), which ECMA-262 specifies exactly. No `**` in
  `optimizer/core` (the G14 rule's spirit; the architecture test bans `Math.pow`).

---

## 7. Search

### 7.1 State

A node is a fixed-size record in parallel typed arrays, with two layers alive (current and next):

| Field | Type | Notes |
|---|---|---|
| `scheduled` | `Uint8Array(units)` per node | 1 byte per unit (no bit packing without bitwise operators) |
| `questStatus` | `Uint8Array(quests)` | 0 untouched, 1 in log, 2 turned in, 3 abandoned, 4 dropped |
| `loc` | Int32 | −1 unknown |
| `tier`, `unknownXp`, `sinceCastUnknown` | Uint8 | `tier` is state: `trainRiding` sets it (review OP-06) |
| `level`, `xpInto`, `knownTotal` | Int32 / Float64 | |
| `elapsedMs`, `readyAtRelMs` | Float64 | Exact integers |
| `lastVisit` | Int32 | −1 none |
| `logCount`, `unknownParts`, `divergence` | Int32 | |
| `anyDropped` | Uint8 | 1 once a droppable quest is dropped (the fill rule, §7.5) |
| `h1`, `h2` | Float64 | Hash lanes (§7.2) |
| `trail` | Int32 | Index into the ancestry trail |

The **key** is (scheduled set, quest statuses, `loc`, `lastVisit`, `tier`, `unknownXp`,
`sinceCastUnknown`, `level`, `xpInto`). The waypoint flags derive from the scheduled set (§3.3), as
does `anyDropped` (from the quest statuses).

**Divergence** counts units scheduled while an earlier unit, in original order, was still
unscheduled and not dropped. A per-node cursor `firstOpen` advances over scheduled units.

### 7.2 The arithmetic duplicate-detection hash

- **Constants.** A Lehmer generator, `x ← (x × 48271) mod 2147483647`, seeded with 20260927. The
  product stays below 2^47, so it is exact in doubles. The k-th feature takes the next two outputs:
  `c1[k] = x mod P1` and `c2[k] = x' mod P2`, with P1 = 2147483647 and P2 = 2147483629 (both
  prime).
- **Features.** One slot per unit (scheduled), per (quest, status), per location + 1, per visit key
  + 1, per tier, per `unknownXp` value (capped at 15), per `sinceCastUnknown`, per level, and
  `xpInto` folded as `c1[xpSlot] × (xpInto mod 65521) mod P1` (exact: the product is below 2^47).
  XP is an integer in every grant (quest, kill and grind XP), so the fold is exact.
- **Hash.** `h1 = Σ c1 mod P1`, `h2 = Σ c2 mod P2`. A child updates incrementally:
  `h' = (h − c[old] + c[new] + P) mod P` for each changed slot. All values stay below 2^34, so
  every operation is exact in doubles, and no bitwise operator appears.
- **Table.** Open addressing with linear probing. The capacity is the power of two ≥ 2 × (beam ×
  enabled units), and the index is `(h1 × 32 + (h2 mod 32)) mod capacity` (exact below 2^53).
- **Collisions.** A lane match is followed by an **exact state comparison**: the parent's
  scheduled bytes plus the unit, and the scalar fields. Hash quality affects speed only, never
  results.
- **The collision test (review OP-17).** A test-only option, `testHash: 'constant'`, makes every
  lane constant, so every insertion probes one chain in a table of normal size. The results must
  equal the normal mode's. Revision 1's two-slot table could not hold a layer.

### 7.3 Layers, candidates, duplicates and dominance

For each layer:

1. **Generate.** For each beam node in rank order, and each enabled unit in index order, evaluate
   the child into a **candidate record**. The record holds the parent rank, unit, score, elapsed,
   hashes, and the dominance and key scalars, in preallocated typed arrays sized beam × units.
   Child states are **not** built yet. Each candidate counts one evaluation.
   - An enabled unit is unscheduled and not dropped. Every `require` predecessor is scheduled, and
     every `order` predecessor is scheduled or droppable-and-unscheduled. Scheduling it then drops
     those (§3.4).
2. **Deduplicate.** Insert each candidate into the table in generation order. Among candidates
   with the same exact key, a new one is dropped if an existing one **dominates** it:
   - `elapsedMs ≤`, `readyAtRelMs ≤` and `unknownParts ≤`, plus `divergence ≤` when the penalty is
     above 0, with at least one strict;
   - it replaces those it dominates;
   - exact ties keep the first inserted;
   - **at most K = 4 entries per key (review OP-17).** When a key already holds four non-dominated
     entries and a fifth arrives, the five are ranked by the selection order (score, elapsed, parent
     rank, unit index) and the last is discarded, which may be the newcomer.
3. **Select.** Take the top `beamWidth` by (score, elapsed, parent rank, unit index): an in-place
   sort of indices by a total order over integers, so equal scores are broken the same way in
   every run.
4. **Build.** Materialise only the kept children, and append `(parentTrail, unit)` to the trail
   (`Int32Array`, beam × depth × 8 bytes).

**Why XP is in the key (§1 row 11).** Two states with the same scheduled set and different XP can
diverge either way later, so XP cannot prune. Most permutation duplicates reach equal XP (quests
below the reduction threshold, kills at the same level), so pruning keeps its power. Fixture 9 runs
with pruning on and off to check this, and the bench reports `duplicates` and `dominated` (§14).

### 7.4 Heuristic

`score = elapsedMs + nearestUsefulMs + remainingXpMs + divergencePenaltyMs × divergence`, integer
arithmetic in doubles:

- `nearestUsefulMs`: the smallest matrix ms (at the node's tier) from `loc` to the first
  destination of any enabled unit. It scans the location's neighbour list (its requested targets,
  sorted by (tier-0 ms, index), capped at 48, built at compile) until a location hosting an enabled
  unit is found. A unit with no travel counts as 0. It is 0 when nothing is found within the cap,
  or when `loc` is unknown.
- `remainingXpMs = Math.round(max(0, target − knownGain) × incumbentMs / max(1,
  incumbentKnownGain))`, so every term of the score is an integer.
- `divergencePenaltyMs = 1000 × options.divergencePenalty` (seconds per out-of-order unit;
  default 0).

It is a practical ranking, not a bound. Fixture 4 pins its behaviour at width 1.

### 7.5 Closing, grind fill and solutions

A node **closes** when:

- every obligatory unit is scheduled;
- no quest is partly scheduled;
- `readyAtRelMs ≤` the incumbent's, and `unknownParts ≤` the incumbent's;
- the riding tier is at least the incumbent's end tier (§4.1 rule 4);
- `Δ` lies in the suffix XP interval, and the log count meets the suffix rule (§4.4).

Closing drops every unscheduled droppable quest (cascading). Then, if `knownGain < target`:

- a fill is priced (`grind()` from the end state to the target total) when `unknownXp = 0`, and
  either no droppable quest was dropped or the request allows `grindFill: 'replace-quests'`
  (§2, review OP-08);
- otherwise the node cannot close.

The closed cost is `elapsedMs + fillMs + exitMs(loc, tier, elapsed, readyAt)` (§5.4). The Δ check
uses the known total after the fill.

Every kept node is tested for closing. A closable node whose remaining units are all optional and
whose known gain is at or above the target is **not expanded**, because optional units only add
time. The best `candidates` (default 4) distinct closed solutions are kept, ordered by (cost, unit
sequence, lexicographic). The incumbent (the original order, with a fill if the target is above the
original's XP) seeds the list.

### 7.6 Anytime rollout, termination, determinism (review OP-17)

- **Rollout.** A greedy rollout runs from the best-ranked node: it always takes the best-scored
  feasible child (ties by unit index) until it closes or has no child. It counts evaluations like
  any expansion. A result better than the best solution emits `best`. On a poor incumbent, the
  first improvement usually comes from the first rollout.
- **Work items.** A run is a fixed sequence of work items: rollout R0, layers L0-L7, rollout R8,
  layers L8-L15, and so on (`rolloutEvery`, default 8).
  - After each item, the stepper checks termination: `exhausted` (a layer produced no children),
    then `budget` (`evaluations ≥ maxEvaluations`).
  - An item is never cut short by the budget, so a budget reached during a rollout stops the run
    when that rollout ends.
  - The sequence does not depend on slicing.
- **Termination:** `exhausted`; `budget`; `timeout` (`maxMillis`, set by the host; reproducible
  false); `cancelled`.
- **Stepper.** `advance(n)` evaluates up to n candidates and stops anywhere inside an item if it
  must, keeping all item state in the typed arrays. The next call resumes exactly there. Results
  do not depend on slice sizes, which is tested with slices of 1, 7, 1,000 and 10^6.
- **No clock, no randomness** in `optimizer/core`. The Lehmer constants are fixed.

---

## 8. Worker protocol and client

```ts
// src/optimizer/worker/protocol.ts
type ToWorker =
  | { readonly type: 'start'; readonly runId: number; readonly problem: SearchProblem; readonly options: SearchOptions; readonly maxMillis: number | null }
  | { readonly type: 'cancel'; readonly runId: number };
type FromWorker =
  | { readonly type: 'progress'; readonly runId: number; readonly progress: SearchProgress }
  | { readonly type: 'best'; readonly runId: number; readonly solution: SearchSolution }
  | { readonly type: 'done'; readonly runId: number; readonly outcome: SearchOutcome }  // termination 'cancelled' acknowledges a cancel
  | { readonly type: 'error'; readonly runId: number; readonly message: string };
```

- **Host** (`host.ts`, no `self`; `optimizer.worker.ts` binds it, as `nav.worker.ts` does):
  - `start` creates the stepper. The slice loop calls `advance(slice)`, measures it with the
    injected `now()` (`performance.now` in the entry file), and adapts the slice to about 30 ms
    (clamped to 256..10^6 evaluations). The clock only sizes slices.
  - Between slices it yields through a `MessageChannel` self-post: `setTimeout` is clamped to
    4 ms once nested.
  - It checks for cancel and `maxMillis` between slices.
  - It posts `progress` at most every 100 ms, and `best` whenever the solution list's head
    improves.
  - An optional `sample()` hook runs after each slice. Only the bench uses it, to sample the worker
    heap (§14).
  - A new `start` cancels the running one first. One run at a time.
- **Client** (`client.ts`, main thread):
  - `run(problem, options, handlers)` posts `start` with the problem's `transfer` list (the copies
    of §5.3), under a fresh `runId`. It returns `{ result, cancel }`.
  - Messages whose `runId` is not the current run's are ignored (stale runs).
  - `cancel()` posts `cancel` and starts a grace timer (`cancelGraceMs`, default 1,000). If `done`
    for that run does not arrive in time, the client **terminates** the worker, resolves
    `cancelled` with the last progress's stats, and creates a new worker on the next `run`.
  - A worker `error` event, or a message that cannot be read, rejects with `failed`, and the
    worker is recreated next time.
  - `dispose()` terminates it.
  - The worker is a module worker in its own chunk,
    `new Worker(new URL('./optimizer.worker.ts', import.meta.url), { type: 'module', name: 'optimizer' })`,
    the form the architecture test's scanner already handles for `src/optimizer/worker/client.ts`.
- **Tests** use an in-process port (host and client wired through fake timers), as
  `src/nav/worker/client.test.ts` does. A second fake port ignores `cancel`, to test termination.

---

## 9. App wiring (minimal; no UI)

- **Host.** `DerivedActions` gains `optimizationHost(): OptimizationHost | null`. The pipeline
  answers from its current context, after `ensureWalked()`:
  - the revision and the project;
  - an `EngineContext`: the dataset view, geometry, rules, graph, the **quiet** view of the
    unwrapped travel model (not the pending tracker's wrapper), hints and `localTaxi`;
  - the `ValidatorContext` (view, rules, base view, graph);
  - `computeLegs(pairs, opts)`: for the navigation model,
    `runtime.scheduler.computeLegs(context.travel.navigation, pairs, opts)`; for the straight-line
    model it resolves at once;
  - `missingLegs(pairs)`: the pairs whose `legsNeeded` is not empty (0 for the straight-line
    model).

  The host hands out no walker, records or states. The UI's fake actions
  (`src/ui/app/derived-test-helpers.ts`) gain a one-line stub. It is not a map file.
- **Run.** `startOptimization(deps, request, options)` in `src/app/optimizer-run.ts`. The entry does
  not import it; Milestone 8 loads it lazily.
  1. **Checks.** Refuse (`failed`) if `host.revision !== request.baseRevision`, or if
     `allowNewQuests` is true. Acquire the `'optimizer'` edit lock; release it in `finally`, or hand
     it over (below).
  2. **`paths`.** The private validator and walker, and the analysis walk (§5.1). Then
     `analyseSection`, then `host.computeLegs(pairs, { signal, onProgress })`. Progress is
     `{ legs: { done, total } }`; `run.cancel()` aborts, and the result is `cancelled`.
  3. **`compiling`.** The baseline re-walk with the probe; the pending check; `compileProblem`
     (the self-check, the matrix cache).
  4. **`searching`.** The worker client; `best` feeds progress.
  5. **`finishing`.** For each candidate in order:
     - `decodeSolution` gives the original step objects, with dropped quests' steps removed and the
       fill step made with the injected `IdSource`, plus the step dependencies of §10;
     - splice it into the project;
     - `verifyCandidate` re-walks the private walker from the section start (its checkpoints make
       that cheap) with a fresh validator visitor and the probe, and checks §4.1 against the
       baseline.

     The first candidate that passes is `improved` if its re-walked section-plus-exit is shorter,
     else `no-improvement`. The baseline's records and probe are kept (the walker's `records` array
     is replaced, not mutated, by a re-walk).
- **Lock hand-over (review OP-19).** With `deps.handOver: 'proposal'`, an `improved` run acquires
  `'proposal'` before it releases `'optimizer'`, in the same synchronous task. Editing therefore
  never unlocks between the run and the proposal, and Milestone 8's proposal releases `'proposal'`.
- **For Milestone 8 (review OP-19).**
  - `verifyCandidate` takes `estimatedMs: number | null`. With null (a partial change-set
    application), the parity rule is skipped and every other rule runs.
  - `OptimizerUiState` (§11) is the state the proposal UI subscribes to, with the `paths` phase's
    leg progress.
  - The proposal overlay's walking paths come from `model.path()`. Its misses are recorded and
    drained in the background, as the route line's paths are (3b.6). `computeLegs` fills legs,
    not polylines, and Milestone 7 adds nothing for them.
- **Proposal building, the overlay and Accept / Reject / Apply selected** are Milestone 8.
  Milestone 7 returns the verified steps, the step dependencies, the verification report, the
  metrics and the phase timings.

---

## 10. Route diff (`src/diff`)

- **Matching.**
  - By `StepId` first.
  - Then, if `options.semanticKey` is given (imported updates), unmatched `after` steps are matched
    to unmatched `before` steps with an equal non-null key, taking the lowest `before` index first.
  - The default semantic key is `kind|questId|targets|location source` for quest steps and null
    otherwise.
- **Moves (review OP-18).** Take the before-indices of the matched steps in `after` order. The
  steps kept in place are a **maximum-weight increasing subsequence** of them. Every other matched
  step is a `move`.
  - **Weights.** A fixed step weighs `n + 1`, and any other step 1. `options.fixed(step)` names the
    fixed steps, by default `step.locked`; the optimiser passes its locked and implicit anchors.
    When the fixed steps are increasing among themselves, which the optimiser guarantees, the
    subsequence contains all of them. Moves are then free steps moved relative to the anchor chain,
    and no anchor is reported as moved.
  - Fixture 7e shows why. The after-order's before-indices are [2, 3, 6, 4, 5, 0, 1]. The plain LIS
    is [2, 3, 4, 5], which would mark the locked L2 (index 6) as moved. The weighted one keeps
    [2, 3, 6] (L1, C3, L2) and reports B's and A's steps as moved.
  - **Algorithm.** Dynamic programming over positions in `after` order: `best[i] = w[i] + max{best[j]
    : j < i, v[j] < v[i]}`. A max segment tree indexed by before-index gives O(n log n); its indices
    use `Math.floor(k / 2)`, with no bitwise operators and no Fenwick `k & −k`.
  - **Tie rule (review OP-17).** An increasing subsequence of maximum weight is not unique. Among
    equal `best[j]` the predecessor with the smaller before-index is taken, and among equal final
    values the end with the smaller before-index. The rule is documented and tested; revision 1's
    "unique" claim is withdrawn.
  - Unmatched `before` steps are `remove`, and unmatched `after` steps are `insert`. A matched step
    whose object differs (`!==` and not structurally equal) is also a `modify`.
- **Anchors of ops.** `insert` and `move` record `after: StepId | null`, the step before them in
  `after`.
- **Op order.** Removes (before order), inserts and moves (after order), modifies.
- **Change-sets.**
  - An op's quests are its step's quest ids (accept, turn-in, abandon, any-of candidates, complete
    targets). For a non-quest step they are its host's (`questHostIndices` over the sequence it
    lives in). With neither, the op forms a singleton set `s:<stepId>`.
  - Union-find merges quests that share an op (multi-target completes), and quests related by
    `options.relations?.exclusive(q)`.
  - `options.relations?.prerequisites(q)` gives `requires` edges between sets.
  - **Step dependencies (review OP-18).** `options.dependencies` lists
    `{ stepId, requires: StepId[] }`: the set holding `stepId`'s op requires the sets holding the
    ops of `requires`. Dataset relations cannot express these. The optimiser supplies one for the
    grind fill: it requires every removed step and every moved XP-granting step (turn-ins and
    completes). Applying the fill alone would add grinding that nothing needs, while applying the
    other changes without the fill is allowed, and the re-walk shows the XP.
  - Set ids are `q:<lowest QuestId>` or `s:<stepId>`, and sets are sorted by the first op's index.
- **Apply.** `applyChangeSets(before, diff, selected)`:
  - close `selected` over `requires`;
  - apply the selected removes;
  - apply the selected inserts and moves in `after` order, each placed after the nearest preceding
    (in `after` order) step present in the result, or at the start;
  - apply modifies.

  With all sets it returns `after`; with none it returns `before`. The result is re-walked and
  re-validated by the caller (Milestone 8).
- **Budget:** a diff of two 10,000-step routes ≤ 50 ms (§14).

---

## 11. APIs

```ts
// src/optimizer/core/types.ts (pure; optimizer/types.ts re-exports: core may not import optimizer/index, even as types)
export interface CompileAvailability {
  dependencies(questId: QuestId): AvailabilityDependencies;   // import type from src/validate
}
/** What the baseline walk's probe visitor recorded at one section or suffix step (§4.2, §5.1). */
export interface StepProbe {
  readonly index: number;
  readonly active: boolean | 'unknown';
  readonly level: number; readonly xp: number; readonly knownTotal: number; readonly unknownXpEvents: number; readonly logCount: number;
  /** Accepts: the quest, then each any-of candidate, then each `available` predicate's quests. */
  readonly availability: readonly { readonly questId: QuestId; readonly truth: Truth; readonly codes: readonly string[] }[] | null;
  /** Conditional steps: each skip predicate's truth (the group's, then the step's). */
  readonly predicates: readonly Truth[] | null;
  /** Any-of steps: the quest the engine chose. */
  readonly chosen: QuestId | null;
}
export interface SectionProbe { readonly steps: ReadonlyMap<number, StepProbe>; /** A copy of the state after the last section step. */ readonly endState: ReadonlyCharacterState }
/** One walk of the run's private walker (§5.1). `probe` is null for the analysis walk. */
export interface SectionWalk {
  readonly records: readonly StepRecord[];
  readonly start: ReadonlyCharacterState;   // stateBefore(first)
  readonly memo: ReadonlyWalkMemo;          // memoBefore(first)
  readonly places: Places;                  // the walker's own
  readonly probe: SectionProbe | null;
}
export interface CompileInput {
  readonly project: WalkProject;
  readonly section: { readonly first: number; readonly last: number };
  readonly goal: { readonly targetXp: 'keep-original' | number; readonly grindFill: 'shortfall' | 'replace-quests' };
  readonly context: Pick<EngineContext, 'dataset' | 'geometry' | 'rules' | 'travel' | 'graph' | 'zoneHints' | 'localTaxi'>;
  readonly walk: SectionWalk;
  readonly availability: CompileAvailability;
}
export type CompileFailure = { readonly ok: false; readonly status: 'infeasible' | 'failed'; readonly reason: string };
export interface SectionAnalysis { readonly ok: true; readonly pairs: readonly TravelPair[]; readonly castWindowStart: number; readonly summary: ContractSummary; /* units, blocks, quests, edges, locations: internal */ }
export interface ContractSummary { readonly qExt: readonly QuestId[]; readonly pool: readonly QuestId[]; readonly obligatory: readonly QuestId[]; readonly unknownXp: readonly QuestId[]; readonly carried: readonly QuestId[]; readonly barriers: readonly number[]; readonly targetXp: number; readonly firstSuffixIndex: number; readonly exitChain: readonly number[]; readonly original: { readonly sectionPlusExitMs: number; readonly readyAt: number } }
export interface CompiledProblem { readonly ok: true; readonly problem: SearchProblem; readonly transfer: readonly ArrayBuffer[]; readonly decode: DecodeTable; readonly stats: { readonly units: number; readonly anchors: number; readonly blocks: number; readonly locations: number; readonly pairs: number; readonly tiers: number; readonly incumbentMs: number } }
export interface SearchOptions { readonly beamWidth: number; readonly maxEvaluations: number; readonly divergencePenalty: number; readonly candidates: number; readonly rolloutEvery: number; readonly dominance: boolean /* tests only */; readonly testHash?: 'constant' /* tests only */ }
export interface SearchSolution { readonly units: Int32Array; readonly estimatedMs: number; readonly knownGain: number; readonly fillXp: number; readonly fillMs: number; readonly exitMs: number; readonly unknownParts: number }
export interface SearchProgress { readonly layer: number; readonly evaluations: number; readonly beamSize: number; readonly incumbentMs: number; readonly bestMs: number | null }
export interface SearchStats { readonly evaluations: number; readonly layers: number; readonly duplicates: number; readonly dominated: number; readonly rollouts: number; readonly firstImprovementEvaluations: number | null; readonly arrayBytes: number }
export type SearchTermination = 'exhausted' | 'budget' | 'timeout' | 'cancelled';
export interface SearchOutcome { readonly termination: SearchTermination; readonly incumbent: SearchSolution; readonly solutions: readonly SearchSolution[]; readonly stats: SearchStats }
export interface Stepper {
  advance(maxEvaluations: number): { readonly done: false; readonly progress: SearchProgress; readonly best: SearchSolution | null } | { readonly done: true; readonly outcome: SearchOutcome };
  finish(termination: 'timeout' | 'cancelled'): SearchOutcome;
}

// src/optimizer/core/*.ts
export function analyseSection(input: CompileInput): SectionAnalysis | CompileFailure;                        // section.ts
export function compileProblem(analysis: SectionAnalysis, baseline: SectionWalk, options?: { readonly cache?: MatrixCache }): CompiledProblem | CompileFailure; // problem.ts
export function createMatrixCache(capacity?: number): MatrixCache;                                           // matrix.ts
export const UNKNOWN_MS = -1, CROSS_MAP = -2, NOT_REQUESTED = -3;                                            // matrix.ts
export function createSearch(problem: SearchProblem, options: SearchOptions): Stepper;                       // search.ts
export function evaluateSequence(problem: SearchProblem, units: Int32Array): SearchSolution | { readonly infeasible: string }; // evaluate.ts
export function decodeSolution(decode: DecodeTable, solution: SearchSolution, ids: IdSource): { readonly steps: readonly RouteStep[]; readonly dependencies: readonly StepDependency[] }; // decode.ts
export function laneConstants(count: number): { readonly c1: Float64Array; readonly c2: Float64Array };      // hash.ts

// src/optimizer/types.ts and index.ts (optimizer/index)
export interface OptimizationRequest { /* as ARCHITECTURE §11.1, with goal: { kind: 'min-time'; targetXp: 'keep-original' | number; grindFill?: 'shortfall' | 'replace-quests' } (default 'shortfall') */ }
export interface OptimizationOptions { readonly beamWidth: number; readonly maxEvaluations: number; readonly maxMillis: number | null; readonly divergencePenalty: number }
export const DEFAULT_OPTIMIZATION_OPTIONS: OptimizationOptions; // { beamWidth: 256, maxEvaluations: 4_000_000, maxMillis: null, divergencePenalty: 0 }
export type OptimizationPhase = 'paths' | 'compiling' | 'searching' | 'finishing';
export interface OptimizationProgress { readonly phase: OptimizationPhase; readonly depth: number; readonly evaluations: number; readonly beamSize: number; readonly incumbentSeconds: number; readonly bestSeconds: number | null; readonly elapsedMs: number; readonly legs: { readonly done: number; readonly total: number } | null }
export interface OptimizationContext {
  readonly analysis: SectionAnalysis;
  readonly baseline: SectionWalk;
  readonly cache?: MatrixCache;
}
export interface OptimizerRun<R> { readonly result: Promise<R>; cancel(): void; onProgress(cb: (p: OptimizationProgress) => void): () => void }
export type SearchedSection =
  | { readonly status: 'searched'; readonly termination: Exclude<SearchTermination, 'cancelled'>; readonly reproducible: boolean; readonly candidates: readonly { readonly steps: readonly RouteStep[]; readonly dependencies: readonly StepDependency[]; readonly solution: SearchSolution }[]; readonly incumbent: SearchSolution; readonly summary: ContractSummary; readonly stats: SearchStats }
  | { readonly status: 'cancelled'; readonly stats: SearchStats }
  | { readonly status: 'infeasible' | 'failed'; readonly reason: string; readonly stats: SearchStats };
/** Compiles and searches (phases compiling and searching); the app runs paths before and finishing after. */
export interface Optimizer { optimize(request: OptimizationRequest, options: OptimizationOptions, context: OptimizationContext, ids: IdSource): OptimizerRun<SearchedSection>; dispose(): void }
export function createTypeScriptBeamSearchOptimizer(options?: { readonly createPort?: () => OptimizerWorkerPort; readonly cancelGraceMs?: number; readonly timers?: OptimizerTimers }): Optimizer;

// src/optimizer/worker/client.ts
export interface OptimizerWorkerPort { postMessage(message: ToWorker, transfer: readonly ArrayBuffer[]): void; listen(onMessage: (m: FromWorker) => void, onError: (message: string) => void): void; terminate(): void }
export function createOptimizerWorkerClient(options?: { readonly createPort?: () => OptimizerWorkerPort; readonly cancelGraceMs?: number; readonly timers?: OptimizerTimers }): OptimizerWorkerClient;
export interface OptimizerWorkerClient { run(problem: CompiledProblem, options: SearchOptions & { readonly maxMillis: number | null }, handlers: { readonly onProgress?: (p: SearchProgress) => void; readonly onBest?: (s: SearchSolution) => void }): { readonly result: Promise<SearchOutcome>; cancel(): void }; dispose(): void }
// src/optimizer/worker/host.ts
export function createOptimizerWorkerHost(deps: { readonly post: (m: FromWorker) => void; readonly now: () => number; readonly yieldToEventLoop: () => Promise<void>; readonly sliceMs?: number; readonly progressMs?: number; readonly sample?: () => void }): { handle(message: ToWorker): void };

// src/app/optimizer-run.ts, optimizer-verify.ts, optimizer-availability.ts
export interface OptimizationHost {
  readonly revision: number;
  readonly project: ProjectV1;
  readonly engine: EngineContext;              // travel = the quiet view (§5.3)
  readonly validator: ValidatorContext;
  computeLegs(pairs: readonly TravelPair[], options: { readonly signal: AbortSignal; readonly onProgress: (p: { done: number; total: number }) => void }): Promise<{ readonly complete: boolean }>;
  missingLegs(pairs: readonly TravelPair[]): number;
}
export type OptimizationResult = /* ARCHITECTURE §11.1, plus: */ { /* improved | no-improvement */ readonly estimate: { readonly incumbentMs: number; readonly resultMs: number; readonly engineMs: number; readonly knownGain: number; readonly targetXp: number }; readonly dependencies: readonly StepDependency[]; readonly verification: VerificationReport; readonly timing: OptimizationTiming } /* | cancelled | infeasible | failed */;
export interface OptimizationTiming { readonly analysisWalkMs: number; readonly pathsMs: number; readonly baselineWalkMs: number; readonly compileMs: number; readonly searchMs: number; readonly verifyMs: number }
export type OptimizerUiState =
  | { readonly status: 'idle' }
  | { readonly status: 'running'; readonly runId: number; readonly progress: OptimizationProgress }
  | { readonly status: 'finished'; readonly runId: number; readonly result: OptimizationResult };
export function startOptimization(deps: { readonly host: OptimizationHost; readonly store: Pick<EditorStore, 'acquireLock' | 'releaseLock'>; readonly optimizer: Optimizer; readonly ids: IdSource; readonly cache?: MatrixCache; readonly handOver?: 'proposal' }, request: OptimizationRequest, options?: Partial<OptimizationOptions>): OptimizerRun<OptimizationResult>;
export interface VerificationReport { readonly ok: boolean; readonly failures: readonly { readonly rule: 'end-state' | 'errors' | 'availability' | 'suffix-activity' | 'loose-end' | 'travel-state' | 'anchors' | 'improvement' | 'parity'; readonly detail: string }[]; readonly engineMs: number; readonly estimatedMs: number | null; readonly parity: number | null; readonly newIssues: readonly ValidationIssue[]; readonly metrics: RouteMetrics }
export interface BaselineWalk { readonly walk: SectionWalk; readonly issues: readonly ValidationIssue[]; readonly summary: ContractSummary }
export function verifyCandidate(input: { readonly walker: RouteWalker; readonly validator: ValidatorContext; readonly baseline: BaselineWalk; readonly section: { readonly first: number; readonly last: number }; readonly steps: readonly RouteStep[]; readonly estimatedMs: number | null }): VerificationReport;
export function createSectionProbe(input: { readonly checks: AcceptChecks; readonly subject: AvailabilitySubject; readonly section: { readonly first: number; readonly last: number } }): { readonly visitor: WalkVisitor; result(): SectionProbe };
export function compileAvailability(context: ValidatorContext): CompileAvailability;

// src/diff/*.ts
export type DiffOp =
  | { readonly kind: 'remove'; readonly stepId: StepId; readonly beforeIndex: number }
  | { readonly kind: 'insert'; readonly step: RouteStep; readonly after: StepId | null }
  | { readonly kind: 'move'; readonly stepId: StepId; readonly after: StepId | null; readonly beforeIndex: number; readonly afterIndex: number }
  | { readonly kind: 'modify'; readonly stepId: StepId; readonly before: RouteStep; readonly after: RouteStep };
export interface ChangeSet { readonly id: string; readonly questIds: readonly QuestId[]; readonly ops: readonly number[]; readonly requires: readonly string[] }
export interface RouteDiff { readonly ops: readonly DiffOp[]; readonly changeSets: readonly ChangeSet[] }
export interface StepDependency { readonly stepId: StepId; readonly requires: readonly StepId[] }
export interface DiffOptions {
  readonly semanticKey?: (step: RouteStep) => string | null;
  readonly relations?: { exclusive(q: QuestId): readonly QuestId[]; prerequisites(q: QuestId): readonly QuestId[] };
  /** Steps that keep their place (weight n + 1 in the subsequence); default: `step.locked`. */
  readonly fixed?: (step: RouteStep) => boolean;
  readonly dependencies?: readonly StepDependency[];
}
export function longestIncreasingSubsequence(values: ArrayLike<number>, weights?: ArrayLike<number>): Int32Array;   // positions, lis.ts
export function diffRoutes(before: readonly RouteStep[], after: readonly RouteStep[], options?: DiffOptions): RouteDiff;
export function applyChangeSets(before: readonly RouteStep[], diff: RouteDiff, selected: ReadonlySet<string>): RouteStep[];

// Additions to existing modules
// src/domain/route-ops.ts
export function questHostIndices(steps: readonly RouteStep[], from?: number, to?: number): Int32Array;   // the next quest step in [from, to); −1 = none
// src/validate/availability.ts
export interface AvailabilityDependencies { readonly completed: readonly (readonly QuestId[])[]; readonly inLog: readonly QuestId[]; readonly takenOrDone: readonly QuestId[]; readonly blockers: readonly QuestId[]; readonly minLevel: number | null; readonly maxLevel: number | null; readonly parent: QuestId | null; readonly skills: readonly number[]; readonly spells: readonly number[]; readonly minReputation: readonly number[]; readonly maxReputation: readonly number[]; readonly breadcrumbTarget: { readonly questId: QuestId; readonly dependencies: Omit<AvailabilityDependencies, 'breadcrumbTarget'> } | null }
export function availabilityDependencies(record: QuestRecord, dataset: Pick<EngineDataset, 'quest'> & Partial<Pick<DatasetView, 'quests'>>): AvailabilityDependencies;
// src/engine/walker.ts and state.ts
export interface ReadonlyWalkMemo { readonly groupSkip: ReadonlyMap<GroupId, Truth>; readonly waypointsDone: ReadonlySet<GroupId>; readonly visitKey: VisitKey | null; readonly entrance: EntranceEdge | null }
interface RouteWalker { /* … */ memoBefore(index: number): ReadonlyWalkMemo; readonly places: Places }
// src/engine/choices.ts (exported from index.ts, with the Places, SpawnChoice and ReadonlyWalkMemo types)
export function flightDeparture(graph: TravelGraph, faction: Faction, known: ReadonlySet<TaxiNodeKey>, step: FlightStep, near: WorldPoint | null): TaxiNodeLookup | null;
export function chooseCrossing(input: CrossingInput): PricedCrossing | null;   // moved from steps.ts, behaviour unchanged
// src/app/navigation-model.ts
interface NavigationTravelModel { /* … */ readonly quiet: TravelModel }   // reads the table; records no miss
// src/app/derived.ts
interface DerivedActions { /* … */ optimizationHost(): OptimizationHost | null }
```

---

## 12. Files

**New:**

| Path | Contents |
|---|---|
| `src/optimizer/types.ts`, `src/optimizer/index.ts` | §11; `createTypeScriptBeamSearchOptimizer` (phases compiling and searching) |
| `src/optimizer/core/types.ts` | Search and compile types (pure) |
| `src/optimizer/core/section.ts` | `analyseSection`: classification, units, barriers and blocks, quests, Q_ext, obligations, pairs |
| `src/optimizer/core/locations.ts` | Interning (locations and point ids), the spawn fixpoint, destinations, spawn tables, neighbour lists |
| `src/optimizer/core/relations.ts` | Precedence edges (CSR), suffix pins, the suffix XP interval, suffix availability readers |
| `src/optimizer/core/matrix.ts` | Per-tier matrices over the requested pairs, sentinels, `MatrixCache` |
| `src/optimizer/core/anchors.ts` | Flight, transport and hearth tables, the exit chain |
| `src/optimizer/core/problem.ts` | `compileProblem`, the pricing slice, the structure check, the self-check |
| `src/optimizer/core/pricing.ts` | Lazy level-only pricing through `src/sim`; grinds and hearth waits per transition |
| `src/optimizer/core/state.ts` | Node layout and layers |
| `src/optimizer/core/hash.ts` | Lehmer constants, lanes, the table, the constant test mode |
| `src/optimizer/core/transitions.ts` | `apply`, feasibility (availability, any-of, predicates, bind, riding), closing |
| `src/optimizer/core/heuristic.ts` | Score |
| `src/optimizer/core/search.ts` | Stepper, work items, layers, dedup, rollout |
| `src/optimizer/core/evaluate.ts` | `evaluateSequence` |
| `src/optimizer/core/decode.ts` | `decodeSolution`, with the fill's step dependencies |
| `src/optimizer/core/index.ts` | Exports |
| `src/optimizer/core/*.test.ts` | Unit tests beside each module (section, locations, relations, matrix, pricing, hash, transitions, search, evaluate, decode) |
| `src/optimizer/worker/protocol.ts`, `host.ts`, `optimizer.worker.ts`, `client.ts`, `host.test.ts`, `client.test.ts` | §8 |
| `src/diff/index.ts`, `lis.ts`, `diff.ts`, `change-sets.ts`, `apply.ts` and their tests | §10 |
| `src/engine/choices.ts` (+ test) | `flightDeparture`, `chooseCrossing` |
| `src/app/optimizer-run.ts`, `optimizer-verify.ts`, `optimizer-availability.ts` and their tests | §9: the run, verification, the probe visitor and `compileAvailability` |
| `tests/support/optimizer-fixtures.ts` | The §13 harness and fixtures 1-8b, 10, 12 and 13 |
| `tests/optimizer-fixtures.test.ts` | Fixtures 1-8b, 10c, 12 and 13 |
| `tests/optimizer-oracle.test.ts` | Fixture 9 |
| `tests/optimizer-worker.test.ts` | Fixtures 10a and 10b through the host and client |
| `tests/optimizer-parity.test.ts` | Fixture 11 (synthetic and the bench section, straight-line model) |
| `tests/optimizer-navigation.test.ts` | End to end on the committed `public/nav` with the in-process nav worker (as `tests/derived-navigation.test.ts`): host → analysis walk → paths → baseline → compile → search → verify on a Durotar section of the sample route; parity; determinism; no leg recorded by compile |
| `tests/optimizer-evaluations.test.ts` | The §14 exact gate: fixture evaluations, costs and unit sequences equal `docs/measurements/optimizer-m7.json` `fixtures` |
| `tests/bench/optimizer-support.ts`, `tests/bench/optimizer.bench.ts`, `tests/bench/optimizer-bench.worker.ts` | §14 (the last is the bench's `worker_threads` entry) |
| `docs/measurements/optimizer-m7.json` | Stored baselines |

**Changed (minimal):**

- `src/engine/walker.ts`: `memoBefore`, `places`. `src/engine/state.ts`: `ReadonlyWalkMemo`.
- `src/engine/index.ts`: exports.
- `src/engine/steps.ts`: uses `choices.ts`, behaviour unchanged.
- `src/domain/route-ops.ts`: `questHostIndices`.
- `src/validate/availability.ts`: `availabilityDependencies`, with its coverage test.
- `src/app/navigation-model.ts`: the `quiet` view.
- `src/app/derived.ts`, `src/app/derived-pipeline.ts`: `optimizationHost`.
- `src/ui/app/derived-test-helpers.ts`: a stub.
- `tests/derived-navigation.test.ts`: the ENG-01 guard extended (§5.3).
- `tests/bench/bench-support.ts`: pass node flags (`--expose-gc`) to `--check` children.

**Not changed:**

- `tests/architecture.test.ts`: the `optimizer/core`, `optimizer/worker`, `optimizer/index` and
  `diff` rows already hold. Core imports `validate` as types only.
- `package.json`: the bench runs through `pnpm exec tsx`.
- `vite.config.ts`: `worker.format` is already `es`.
- No file of the map team: `src/map`, `src/app/map-*.ts`, `src/infra/maps`, the UI map files,
  `tools/maps`, `public/maps`.

---

## 13. Fixtures (ARCHITECTURE §11.7, fully specified)

### 13.0 Harness H (every fixture unless it says otherwise)

- **Engine setup.** `fixtureContext(fixtureDataset(...), { assumptions: { runSpeedYps: 10,
  travelDetourFactor: 1 } })` from `src/engine/test-helpers.ts`:
  - ruleset `forever-beta`;
  - straight-line model with detour 1, so a leg takes **yards / 10 s** on foot, and 16 yd/s at
    riding tier 1;
  - default assumptions otherwise: accept 3 s (2 s for a further accept at the same NPC without
    moving), turn-in 3 s, trainer 10 s, note 0 s, 30 s per kill, 8 kills per objective, quest log
    capacity 40.
- **Map and character.** Kalimdor (`worldMapId(1)`), world coordinates in yards. Character
  `defaultCharacter({ startLevel: 10, startXp: 0, startLocation: at(0, 0) })`: Horde, orc,
  warrior, history `fresh`, riding 0. toNext(10) = 7,600.
- **Quests.** `questRecord(id, { level: 30, minLevel: 1, objectives: [], xp: { questLevel: 30,
  baseXp: X, basis: 'era-seed' } })`, so XP is exactly X for players up to level 35 (`roundXpValue`
  keeps these multiples of 50 or 25).
- **Steps.** Each quest's accept and turn-in are at the same point, with `location: at(x, y)` on
  the step.
- **Section.** The suffix is one `note` step at the exit E, with `text: 'exit'`. The prefix is
  empty, and the section is everything else.
- **Walks.** The engine walks through `validateRoute`, so the walker uses the validator's accept
  policy, as the app's does.
- **Options.** Beam 16, `maxEvaluations` 100,000, divergence penalty 0, `grindFill: 'shortfall'`.
- **Expected times** are the engine walk's section plus exit chain, in seconds (§6.3), CHECKED
  unless marked. The optimiser's estimate must match within §6.3. When the exit is a suffix quest
  step, its own interaction is not counted. The ids below are the fixtures' quest ids.

### 13.1 The fixtures

| # | Purpose | Set-up (S = (0,0) unless stated) | Target, options | Expected result |
|---|---|---|---|---|
| 1 | Greedy-XP trap | 101 A: 3,000 XP at (3000,0). 102 B: 1,600 at (100,0). 103 C: 1,600 at (0,100). E (0,200). Original: A, B, C | `targetXp: 3000` | **improved**: accept 102, turn in 102, accept 103, turn in 103; A's two steps removed. 46.142 s (travel 341.421 yd); incumbent 632.142 s; A alone would be 606.666 s |
| 2 | Nearest-neighbour trap | 201 N (−100,0); 202 K1 (900,0); 203 K2 (950,50); 204 K3 (1000,0); 1,000 XP each. E (1000,0). Original: N, K1, K2, K3 | `targetXp: 3000` | **improved**: K1, K2, K3 (each accept then turn-in); N removed. 122.142 s (1,041.421 yd); nearest-first (N, K1, K2) 142.142 s; incumbent 148.142 s |
| 3 | XP-per-second trap | 301 R (−50,0); 302 P1 (600,0); 303 P2 (610,0); 1,000 XP each. E (620,0). Original: R, P1, P2 | `targetXp: 2000` | **improved**: P1, P2; R removed. 74.000 s (620 yd); ratio-greedy (R, P1) 84.000 s; incumbent 90.000 s |
| 4 | Width 1 fails, width ≥ 4 succeeds | 401 X (100,0); 402 Y (−150,0); 1,000 XP each. E (400,0). Original: X, Y | keep-original (2,000); run at beam 1 and at beam 4 | Beam 1: **no-improvement** (X, Y; 102.000 s; the §7.4 score picks X first). Beam 4: **improved**, Y then X, 82.000 s, termination `exhausted` (at most 4 distinct keys per layer for two quests) |
| 5 | Level gate | 501 A (400,300) and 502 B (800,0): 4,000 XP each. 503 C (−100,0): 1,000 XP, `minLevel: 11`. E (800,0). Original: A, B, C | keep-original (9,000) | **improved**: B, A, C: 296.310 s (2,783.095 yd); incumbent 298.000 s. C's accept comes after both turn-ins (level 11 at 8,000 XP). Any order with C before them is refused (VAL-4); C, A, B would be 136.310 s with a VAL-4 error |
| 6 | Locked turn-in whose objective must come first | Q 601: 2,000 XP, giver and finisher at (100,0), `objectives: [killObjective(6100)]` (NPC 6100 levels 10-10: 8 × 30 s, 8 × 95 XP). Its `complete` step is at K (1000,0). R 602: 1,000 XP at (0,150). E (0,200). Original: accept Q, accept R, turn in R, complete Q, turn in Q (**locked**) | keep-original (3,760) | **improved**: accept Q, complete Q, turn in Q (locked), accept R, turn in R. 465.028 s (2,130.278 yd + 240 s + 12 s); incumbent 493.507 s. The complete is **not** dropped: dropping it would let D-040 carry the work without travel (330.278 yd), which rule 5 and §3.4 forbid. Kill XP 760 is granted at the complete |
| 7a | Rule 1, end state | X 701: accept (500,0). Y 702 (−100,0). Suffix: turn in X at (500,0) = E. Original: accept X, accept Y, turn in Y | keep-original (1,000) | **improved**: accept Y, turn in Y, accept X: 79.000 s (700 yd); incumbent 179.000 s. At the section end X is in the log with `routeAccepted: true` and its objectives open |
| 7b | Rule 2, no new blocking | P 711 (−800,0), N 712 (100,0), 1,000 each. Suffix: accept F 713 at (200,0) = E, with `preQuestSingle: [711]`. **Original: P, N** | `targetXp: 1000` | **improved**: accept P, turn in P; N removed. **186.000 s**; incumbent 192.000 s. P is obligatory because F depends on it; without that pin, N alone would win at 26.000 s (and F would get VAL-8) |
| 7c | Rule 3, loose ends | L 721: accept at (0,0) **locked**, turn-in at (2000,0). M 722 (100,0). 1,000 each. E (100,0). Original: accept L, accept M, turn in M, turn in L | `targetXp: 1000` | **improved**: accept L, turn in L; M removed. 396.000 s; incumbent 402.000 s. L's turn-in is kept: dropping it alone (13 s) would leave L in the log |
| 7d | Rule 4, travel state | Character level 40. T 731 (0,50) with a `train` step (`skill: 'riding'`, `rank: 1`) at (0,60) placed before T's turn-in (so bound to it). U 732 (1000,0). Both `questLevel: 60`, 1,000 XP. E (1000,0). Original: accept U, turn in U, accept T, train, turn in T | **keep-original (2,000)** | **improved**: accept T, train, turn in T, accept U, turn in U: 91.203 s (tier 1 from the train on; 16 yd/s); incumbent 286.328 s. T is obligatory (bound train); the train's outcome equals the original's; riding at the end is 1. (With `targetXp: 1000`, U would be dropped at 85.203 s.) |
| 7e | Rule 5, anchors | A 741 (200,100), B 742 (−200,100), 1,000 each. `note` L1 at (300,−200), **locked**. `note` C3 at (0,−100) with `condition: { filter: null, variant: null, skipIf: [{ kind: 'levelAtLeast', level: 60, xp: null, negate: false }] }` (implicit anchor, active). `note` L2 at (−300,−200), **locked**. E (400,0). Original: A, L1, C3, B, L2 | keep-original (2,000) | **improved**: L1, C3, L2, B, A: 205.285 s (1,932.845 yd); incumbent 230.314 s. The chain L1 < C3 < L2 holds; A moves past two anchors. A brute force over every order that keeps the chain confirms the minimum (the critic's). Unconstrained, the best would be C3, L2, B, A, L1 (1,672.29 yd, UNCHECKED). The diff (§10) reports A's and B's steps as moved and no anchor |
| 7f | Rule 6, unknown XP | Custom quest K −751: `xp: null`, `starterLocation` = `finisherLocation` = at(−2000,0); its dataset record has `starters: []`, `finishers: []`. A 752 (100,0), 1,000. Two variants. **v1:** original accept K, turn in K, accept A, turn in A; E (−1000,0). **v2:** original A, K; E (100,0) | keep-original (1,000 known) | **v1: improved**, A, K: 332.000 s; incumbent 532.000 s. K kept (dropping it would save 206 s: A alone is 126.000 s). A moves before K, which only makes A's XP exact. **v2: no-improvement**, A, K: 442.000 s. K, A (422.000 s) is refused: A's quest XP, exact before K in the original, would be priced after an unknown event (§3.5). In both, `unknowns.quests = [−751]` and the level after K is a lower bound |
| 7g | Rule 7, the exit | A 761 (100,0), B 762 (−100,0), 1,000 each. Original: A, B. Two variants: E (1000,0) and E (−1000,0) | keep-original | E (1000,0): **improved**, B, A: 132.000 s (incumbent 152.000 s). E (−1000,0): **no-improvement**, A, B: 132.000 s |
| 8 | Grind fill | A 801 (100,0), B 802 (200,0), 1,000 each. E (200,0). Original: B, A | `targetXp: 2500` | **improved**: A, B, then a new `grind` step `until: { kind: 'level', level: 10, offset: { kind: 'xpInto', xp: 2500 } }`, location, mob level and rate null, origin `optimizer`. 6 kills at 95 XP (killXp(10, 10)) = 570 XP, 180 s. Total 212.000 s; incumbent (B, A + fill) 232.000 s. No quest is dropped, so `'shortfall'` allows the fill |
| 8b | The fill does not replace quests by default (review OP-08) | A 811 (100,0), F 812 (2000,0), 1,000 each. E (0,0). Original: A, F | keep-original (2,000); run with `grindFill: 'shortfall'` and with `'replace-quests'` | `'shortfall'`: **no-improvement**, A, F: 412.000 s (F, A also costs 412.000 s; the tie keeps the original order). `'replace-quests'`: **improved**, accept A, turn in A, then a fill `until: level 10, xpInto 2000`: 11 kills (1,045 XP), 330 s; 356.000 s; F removed, and the result names it |
| 9 | Brute-force oracle | 40 seeded instances; Lehmer PRNG in the test (`x ← x × 48271 mod 2147483647`, seeds 1-40). 2 or 3 quests (`2 + x mod 2`); accept and turn-in at separate uniform integer points in [−500,500]²; XP `50 × (10 + x mod 31)`. When `x mod 2 = 1`, one quest gets a kill objective (count 2 via `ObjectiveDef.count`: 60 s, 190 XP) with a located `complete` at a random point. Units ≤ 7. E random. Target by `seed mod 3`: keep-original / a random non-empty subset's XP / keep-original + 300 (fill) | Beam 5,040; then 1, 4 and 16; `dominance` on and off | The oracle enumerates every subset of droppable quests allowed by the fill rule (with a fill, every droppable quest is kept), and every order consistent with accept < complete < turn-in. It **walks each with the engine** (with the fill step when needed). At beam 5,040 the result equals the oracle minimum within §6.3, with dominance on and off. At every width the result is never below the minimum minus the tolerance |
| 10a | Cancellation | Grid-40: quests 1000+k, k = 0..39, 1,000 XP each; accept at (150 × (k mod 8), 150 × floor(k/8)); turn-in at quest ((k+13) mod 40)'s accept point. E (1050,600). Original: by id | Beam 256, `maxEvaluations` 10^8; cancel after the first `progress` | `cancelled`, `stats.evaluations > 0`, acknowledged within two slices. With a port that ignores `cancel`: terminated after `cancelGraceMs` (fake timers), `cancelled`, and the next run creates a new worker |
| 10b | Evaluation budget, determinism | Grid-40 | Beam 64, `maxEvaluations` 50,000 | termination `budget`, reproducible. Identical solutions and stats across slice sizes 1, 7, 1,000 and 10^6, across two runs, across the in-process host and a direct `advance` loop, and with `testHash: 'constant'`. The evaluation count equals the stored baseline (§14) |
| 10c | Tie-breaking | Fixture 1 with E (0,0) | as 1 | B, C (lower unit indices first) in every run. B, C and C, B cost exactly the same integer ms (46.142 s) |
| 11 | Parity | Every result of 1-13, their incumbents, and the bench section (§14) with the straight-line model; the navigation variant in `tests/optimizer-navigation.test.ts` | — | `\|estimatedMs − engineMs\| ≤ max(1% × engineMs, 1 ms × priced parts)` for every candidate and incumbent. The compile self-check (§5.6) passes on all |
| 12 | Position-unknown barrier (review OP-01) | 1201 A (100,0), 1202 B (200,0), 1203 F (3000,0), 1,000 each. A zone `travel` Z (location null) between turn in A and accept B, so bound to accept B. E (0,0). Original: accept A, turn in A, Z, accept B, turn in B, accept F, turn in F | keep-original (3,000) | **no-improvement**: 608.000 s, with two unknown travel parts (Z's own, and accept B's move from the unknown position). The block is [turn in A, Z, accept B]: accept B ends at a known point, so the block stops there. No feasible order is cheaper: accept F and turn in F between accept B and turn in B tie at 608.000 s (the tie keeps the original), and F before the block costs 628.000 s. Without the block, "accept F, turn in F, Z, B, A" is priced at 338.000 s by the engine itself, because the leg from F to B is free; `evaluateSequence` of that order returns `infeasible` (barrier) |
| 13a | Any-of choice (review OP-05) | Start XP 7,000. G 1301 (1000,0), 1,000 XP. An any-of accept S at (0,50): `questId` 1302, `anyOf: [1302, 1303]`; 1302 has `minLevel: 11`. Suffix: turn in 1302 at (1000,50) = E. Original: accept G, turn in G, S | keep-original (1,000) | **no-improvement**: 309.125 s; S chooses 1302 at level 11. S before G (119.125 s) would choose 1303 at level 10, and the suffix turn-in would fail (VAL-30); the choice check refuses it |
| 13b | Minimum reputation (review OP-05) | Character `reputation: { '76': 0 }`. R 1311 (−500,0), 1,000 XP, `reputationReward: [{ factionId: 76, value: 250 }]`. M 1312 (100,0), 1,000 XP, `minReputation: { factionId: 76, value: 250 }`. E (0,0). Original: R, M | `targetXp: 1000` | **improved**: R alone, M removed: 106.000 s; incumbent 132.000 s. M alone (26.000 s) is refused: it would newly block M (VAL-16). The `require` edge drops M with R |
| 13c | Breadcrumb target (review OP-05) | Start XP 7,000. G 1321 (1000,0), 1,000 XP. B 1322 (500 XP) is a breadcrumb for T 1323 (`minLevel: 11`). Section: accept G, turn in G, accept B at (0,50). Suffix: turn in B at (1000,50) = E | keep-original (1,000) | **no-improvement**: 309.125 s. Accepting B before G (119.125 s) would lower B's availability from true to unknown (`VAL013-breadcrumb-target-unavailable`, a doubt, because T needs level 11); the dynamic check refuses it |

Each fixture also asserts that the verification report is `ok` and that no error-severity issue is
new. The exact evaluation counts, costs and unit sequences of fixtures 1-8b, 10b, 10c, 12 and 13
are stored in `docs/measurements/optimizer-m7.json` (`fixtures`) and checked exactly (§14).

Unit tests (M7.2-M7.4) cover what the fixtures do not: an unlocated bind's position check, a train
whose riding outcome would change, `available` predicates, `skipIfMissing` turn-ins, a group whose
waypoints continue into the suffix, the exit chain through a spawn step and a hearth use, the Δ
interval, the K = 4 rule, a budget reached during a rollout, and the matrix sentinels.

---

## 14. Budgets, benches and measurements

### 14.1 Budgets (TARGET until M7.7 measures them)

| Gate | Budget | Where |
|---|---|---|
| Optimiser evaluations on fixed fixtures | Exact baseline (machine-independent CI gate) | `tests/optimizer-evaluations.test.ts` vs `optimizer-m7.json` `fixtures` |
| Analyse + compile, bench section, straight-line and navigation (table pre-filled) | ≤ 30 ms, and stored baseline + 25% | `optimizer.bench.ts --check`: `compile`, `compileNav` |
| Analysis walk and baseline re-walk | Reported; each within the §14 walk + validate budget (20 ms for 10,000 steps) | `walks` |
| First improvement, beam 256, "weak" incumbent | < 2,000 ms, and stored baseline + 25%; `evaluationsToFirstImprovement` exact | `firstImprovement.weak` |
| First improvement, beam 256, "guide" incumbent | Reported: time and exact evaluations to the first improvement, or `null` when none is found within `maxEvaluations` | `firstImprovement.guide` |
| Worker heap at beam 256 | < 64 MB (absolute ceiling): the largest sample, in the worker thread, of `used_heap_size + external_memory` (`v8.getHeapStatistics()`) after each slice; `stats.arrayBytes` reported beside it | `heap` |
| Full search to `maxEvaluations` 2,000,000 | Stored baseline + 25% (reported), with `duplicates` and `dominated` | `search` |
| Diff of two 10,000-step routes (reversed; seeded shuffle with 1% edits) | ≤ 50 ms | `diff10000` |
| "Computing paths" for the section | Existing 16 s ceiling (RC-07), reported; the leg limit is 13,500 (§5.3) | terrain-navigation.md §9.5 |

**Clocks (review OP-15).** "First improvement" starts when the client posts `start` (after
compile, with the transfer) and stops when the main thread receives the first `best` whose cost is
below the incumbent's. The worker heap is measured in the worker, not as in-process growth.

### 14.2 The bench

`tests/bench/optimizer.bench.ts` follows `engine.bench.ts`:

```
pnpm exec tsx tests/bench/optimizer.bench.ts [--case compile|compileNav|walks|firstImprovement|search|heap|diff10000] [--runs 15] [--warm 3]
pnpm exec tsx tests/bench/optimizer.bench.ts --check docs/measurements/optimizer-m7.json [--repeat 3] [--runs 15]
```

- `--check` uses `bench-support.ts`'s `runChecks`:
  - the script bundles itself with esbuild, as a production build is;
  - each gated case runs in a fresh process, `--repeat` times in rotating order;
  - each process times the CPU probe (2e7 square roots);
  - medians are normalised × 40 / probe ms;
  - it fails on more than 25% over the stored normalised median, or over the absolute budget.
- `heap`, `firstImprovement` and `search` run the real client from `run()` with a `createPort` that
  starts a Node `worker_threads` worker (`tests/bench/optimizer-bench.worker.ts`, bundled). The
  worker binds the real host with its `sample()` hook. `--expose-gc` is passed to those children
  (the one `bench-support.ts` change).
- **The bench section** (`tests/bench/optimizer-support.ts`, review OP-15):
  - the committed dataset through `loadWorkspace` and the fake fetch;
  - character: Horde orc warrior, level 10, 0 XP, starting at the Crossroads flight master's
    first spawn (npc 3615);
  - quests: those `bench-support.ts`'s realistic filter accepts (race and class masks, not
    repeatable, no event, no dungeon, no skill, reputation, spell or specialisation requirement,
    not a breadcrumb), restricted to `zoneOrSort` 17 (The Barrens) **and 14 (Durotar)**. That is
    104 quests and 315 actions before the validator repair (CHECKED, `bench-size.ts`; the Barrens
    alone are 78 quests and 235 actions, below ARCHITECTURE §14's pool of 100 quests and about 300
    actions). None has unknown XP;
  - written as accept (no location: the engine's nearest spawn), one located `complete` per
    objective at the spawn nearest the centroid of its zone's spawns (as nav.bench.ts's
    `barrensPool`), and turn-in;
  - two incumbents:
    - **weak**: ordered by (minLevel, id);
    - **guide**: a deterministic nearest-neighbour tour by straight line from the start, taking at
      each step the nearest action whose precedence (accept < complete < turn-in) and level gate
      hold;

    each is repaired with the validator (the existing ≤ 8 rounds);
  - suffix: a note at the start spawn.

  The counts after repair go in the JSON.
  - `compileNav` fills a leg table once per process from the committed `public/nav` through the
    in-process nav worker. That setup is not timed: about 4 s, from terrain-navigation.md §9.5.
- **`optimizer-m7.json`** holds `$comment` (method, machine, load), `date`, `machine`, and:
  - `compile.bench.{straightLine,navigation}` (process medians, medianMs, probeMs, normalised,
    limitMs 30, section counts: quests, actions, units, anchors, blocks, locations, pairs);
  - `walks` (analysis and baseline, medianMs);
  - `search.bench.{weak,guide}` (beam 256; `exact`: evaluationsToFirstImprovement, incumbentMs,
    bestMs, evaluations, duplicates, dominated, unitSequenceHash; `firstImprovement`, `full`,
    `heap`, `arrayBytes`);
  - `diff10000.{reversed,shuffled}`;
  - `fixtures.<id>` (evaluations, estimatedMs, units).

---

## 15. Step plan

Every step ends green on `pnpm typecheck`, `pnpm lint` and the full `pnpm test`.

| Step | Files | Tests and gates | Budget | Status (2026-09-27) |
|---|---|---|---|---|
| M7.0 | `src/engine/choices.ts` (extract `flightDeparture`, `chooseCrossing`); `RouteWalker.memoBefore` and `places`, `ReadonlyWalkMemo`; engine exports; `questHostIndices` (next quest step, group-agnostic); `availabilityDependencies` (with the breadcrumb target's closure and the reputation split); `NavigationTravelModel.quiet`; the ENG-01 guard extended | Every existing engine, validator and navigation test unchanged. The dependency coverage test over the committed dataset, holding the log size constant. `memoBefore` equals the memo of a full walk at every checkpoint boundary and between. `questHostIndices` cases: contiguous runs, interleaved groups, inert hosts, trailing runs. The quiet model records no miss, and its values equal `leg`'s | Engine bench within its baseline | Done in part. Built elsewhere: `hostIndices` in `src/diff/steps.ts`; `availabilityDependencies` in `src/app/optimizer-availability.ts` (not yet beside `check` in `src/validate`); the quiet view as `quietTravelModel` in `src/app/optimizer-host.ts`; the ENG-01 guard in `core/section.ts`. Not built: the engine exports (`flightDeparture`, `chooseCrossing`, `memoBefore`, `places`): `core/replay.ts` replays the section through the engine's `runStep` instead, and the prefix is replayed once per run |
| M7.1 | `src/diff/*` | The weighted LIS against brute force (n ≤ 9, all permutations, random weights): maximum weight and the tie rule. Fixture 7e's diff (no anchor moved). Reversed and shuffled 10,000-step routes. Apply-all = after, apply-none = before. Change-set closure (prerequisite requires, exclusive merge, multi-target merge, host binding, step dependencies). Semantic keys | `diff10000` ≤ 50 ms | Done. Review fixes: apply placement (PAR-02/RTD-01), the fill's own `s:` set (PAR-03/RTD-06), quadratic merged sets (RTD-07), duplicate detection (PRF-13). Measured 6.5 / 7.4 ms |
| M7.2 | `core/section.ts`, `locations.ts`, `relations.ts`, `matrix.ts`, `anchors.ts`, `problem.ts` | The §3.1 classification table as cases. Barriers and blocks (every event kind, chains, section start and end). Obligations (§3.4 items 1-9). Edges on fixtures 5, 6, 7a-7f and 13. The spawn fixpoint. Requested pairs and the leg limit. Matrix equality with `quiet.leg` for straight-line and a fake navigation table (walkable, cross-component with a same-map transport, unsnapped, missing; coinciding points; sentinels). The pending refusal. The ENG-01 runtime refusal. The cache key and copies. The exit chain. The suffix interval and readers. The structure check | `compile` ≤ 30 ms | Done (`anchors.ts` folded into `section.ts`). Review fixes: the exit chain's cross-world move (PAR-01), single-point NPC steps end the chain (PAR-07), the incumbent closed under the full rules (COR-03), the fill floor (PAR-06), one `Places` per host (PRF-07). Measured 9.6 ms (14.0 ms navigation) |
| M7.3 | `core/pricing.ts`, `transitions.ts`, `evaluate.ts`, `decode.ts` | `evaluateSequence(incumbent)` parity on every fixture (fixture 11, synthetic). Carried work (D-040), partial, overrides, radius, visit discount by point, waypoints, hearth wait after unknown time, riding tiers and the train outcome check, the unlocated bind check, any-of and predicate checks. The memo keys (grinds and hearths unmemoised). The `grantXp` equality property. The fill's step dependencies | — | Done. Review fix: uncertain hearth waits bounded by the wait excess (COR-01/02) |
| M7.4 | `core/hash.ts`, `state.ts`, `heuristic.ts`, `search.ts` | Fixtures 1-9, 10c, 12 and 13 at core level. The constant-hash mode. The K = 4 rule. Work items with a budget inside a rollout. Slice independence | — | Done. Review fixes: `comparedMs` and the wait-excess dominance field (COR-01/02), `unknownXpBlocked` (PAR-04), the local pass after each rollout (PRF-08), typed buffers, heap selection, word comparison and integer hashing (PRF-01 to PRF-05, PRF-11) |
| M7.5 | `worker/*` | Fixtures 10a and 10b through the in-process host and client; stale runs; worker error; terminate on an unacknowledged cancel | — | Done. Review fixes: a new run during an unacknowledged cancel (RTD-02), throttled progress (RTD-08) |
| M7.6 | `optimizer/index.ts`, `types.ts`; `app/optimizer-run.ts`, `optimizer-verify.ts`, `optimizer-availability.ts`; `optimizationHost` in the pipeline | App-level fixtures: phases, the private walker (the pipeline's walker untouched), the lock acquired, released and handed over, cancel in each phase, pending legs → `failed`, verification failures leading to the next candidate (every rule, including `availability` and `suffix-activity`), `estimatedMs: null`. `tests/optimizer-navigation.test.ts` | "Computing paths" within 16 s (reported) | Done, except `optimizationHost` in the pipeline: `createOptimizationHost` builds the host from the same inputs (Milestone 8). No `tests/optimizer-navigation.test.ts`: the navigation run is in `src/app/optimizer-run.test.ts`. Review fixes: the incumbent with a fill (PAR-05), notes (COR-06, PAR-08, PAR-10), the parity bound (PAR-09), the lock and revision (RTD-03, RTD-04), yields (RTD-05), leg progress (RTD-09) |
| M7.7 | `tests/bench/optimizer*.ts`, `docs/measurements/optimizer-m7.json`, `tests/optimizer-evaluations.test.ts` | `--check` passes; the exact gate | §14 | Done: `--check` and the exact gate pass (PRF-09, PRF-10). The bench section is a generated 100-quest pool, not the Barrens and Durotar section; `firstImprovement.guide` is not a bench case yet (measured by scratch: first improvement at 23,448 evaluations) |
| M7.8 | ARCHITECTURE §4, §11, §12.1, §13, §14; D-043; STATUS | Docs review | — | In part: ARCHITECTURE §11, §13 and §14 updated at the final verification. §4 and §12.1, D-043 and STATUS are for their owners |
| M7.9 | Critics: optimiser correctness (contract, parity, determinism), performance, and a sceptic's verification; fixes | Findings file under `docs/reviews/` | — | Done: the four critics' 38 findings fixed or answered (COR-04 kept by design), verified 2026-09-27. No findings file under `docs/reviews/` yet |

---

## 16. Risks

| # | Risk | Mitigation |
|---|---|---|
| R1 | The transitions drift from the engine when a SIMULATION rule changes | Pricing calls `sim` itself; position choices are engine exports; the compile self-check refuses to search on disagreement; fixture 11 on every fixture and the bench section |
| R2 | The availability relations miss a predicate, so a proposal blocks a quest | The dependency coverage test over the whole dataset (log size held constant); dynamic level, log and choice checks; the validator re-walk's `errors` and `availability` rules reject the candidate; up to four candidates are verified |
| R3 | Orienting relations by the original order is too conservative (a chain the author wrote late cannot move early) | Accepted for stage 1: it is what keeps the incumbent feasible and the contract exact. Measured by how often the bench run improves; revisit with a dynamic compiled check if needed |
| R4 | Compile over 30 ms for large sections | Only consecutive pairs; the 13,500-leg and 1,024-location limits; the matrix cache; a leg-table fast path (deferred, §2) if M7.7 needs it |
| R5 | First improvement over 2 s when the incumbent is already good | The layer-0 greedy rollout. The budget is gated on the weak incumbent, and the guide incumbent is reported. A well-ordered section simply yields `no-improvement` |
| R6 | Computing paths is cancelled or fails part-way | A cancel ends the run as `cancelled`. Pending legs after `paths` make it `failed` with a reason, never a result priced on fallback legs (SIMULATION §6). Maps whose navigation failed use the final, labelled fallback |
| R7 | The rider approximation and same-map transports make leg times speed-dependent | Per-tier matrices from `model.leg` (§5.3) |
| R8 | Dropping a quest the user wanted | Drops happen only when the target does not need the quest. With `keep-original`, the target is the original gain, and the fill never covers a drop unless the user chose `'replace-quests'` (§2), so a quest is dropped only when the rest of the section reaches the original XP without it. Q_ext, unknown-XP, locked, bound-train, carried-work and prior-log quests are never dropped. The diff shows removals as their own change-sets (Milestone 8). Revision 1's text ("only with an explicit numeric target") was wrong: the fill made keep-original drop far quests (review OP-08) |
| R9 | The grind fill rewards grinding over far quests under assumed kill rates | Default `'shortfall'`; the fill is terminal only, labelled with the kill assumptions (`killSeconds`, mob level); stage 2 revisits it |
| R10 | Hash collisions or float error make results differ between engines | Exact comparison on every hit; integer arithmetic below 2^53; no transcendental functions (G14) |
| R11 | Heap over 64 MB at beam 256 with 300 units | Byte-per-unit sets for two layers only, a trail of 8 bytes per kept node, candidates sized beam × enabled units (about 4 MB); measured in the worker thread (`heap`) |
| R12 | A worker stuck in a long slice ignores cancel | Adaptive slices of about 30 ms; termination after 1 s; stats kept from the last progress |
| R13 | ENG-01 entrance edges or D-039 B taxi edges arrive and silently change travel | The guard test fails and compile refuses (§5.3); flights and transports stay anchors until stage 3 |
| R14 | The suffix XP interval (§4.4) approximates suffix XP as the original plus Δ | The validator re-walk is authoritative (`errors`, `availability`, `suffix-activity`); a failing candidate falls through to the next |
| R15 | Whole-route effects outside the objective (suffix hearth waits after the exit chain) make a "faster" section slower overall | Verification reports whole-route metrics; Milestone 8 shows them beside the section gain |
| R16 | Shared files with the map team | None touched (§12) |
| R17 | Blocks and the unknown-XP edges make RXP sections (many `.zone` steps) or custom-quest sections hard to improve | Accepted: they are what keeps unknown travel and exact XP honest. The result's summary lists the barriers and unknown-XP quests, so a user can see why; M7.9's critics measure the effect on an RXP sample section |
| R18 | The private walks add time before the search | Both are reported (`timing`). The baseline re-walks only from the last hearth cast before the section. Each walk is within the 10,000-step walk budget |

---

## 17. Amendments needed elsewhere (for their owners)

- **ARCHITECTURE §4.**
  - The layout gains the `optimizer/core` files of §12, `optimizer/worker/host.ts`, and
    `src/diff/{lis,diff,change-sets,apply}.ts`.
  - The engine now exports `flightDeparture`, `chooseCrossing`, `RouteWalker.memoBefore` and
    `RouteWalker.places`, and the navigation model its `quiet` view.
  - Note that `optimizer/core` reads `validate` through `import type` only, with availability
    injected by `app`. The dependency table is unchanged.
- **ARCHITECTURE §11.1.**
  - `optimize(request, options, context, ids)` with an `OptimizationContext` (the analysis and the
    baseline walk), returning `SearchedSection`.
  - `createTypeScriptBeamSearchOptimizer({ createPort?, cancelGraceMs?, timers? })`.
  - Phases `paths | compiling | searching | finishing`, with `legs` progress.
  - `goal.grindFill: 'shortfall' | 'replace-quests'` (default `'shortfall'`).
  - `startOptimization` in `app` verifies and returns `OptimizationResult`, extended with
    `estimate`, `dependencies`, `verification` and `timing`. No `provisional` result.
  - `allowNewQuests` is refused until stage 2.
- **ARCHITECTURE §11.2.**
  - Rule 3 is relative: all of a pool quest's units, or none.
  - Rule 5: "Every other non-quest step (travel, note, vendor, train) is bound to the next quest
    action in the section and moves with it; with no later quest action in the section it is an
    implicit anchor." It gains the implicit anchors of §3.1 (grind, transport, any-of,
    `skipIfMissing`, conditional, group-condition, SIM-16 completes, inert steps), the bound-step
    drop rule (§3.2), and D-040: completes are never dropped while their quest is kept.
  - New: position-unknown events are barriers, which move only in a block with their original
    neighbours (§3.6).
  - Obligations (§3.4).
  - Rules 1, 2 and 4: compiled in the search and verified by the engine and validator re-walk,
    including the `availability` and `suffix-activity` checks.
  - Rule 6: unknown-XP turn-ins keep the XP-granting units that preceded them.
- **ARCHITECTURE §11.3.**
  - The run's private walks and the two-call compile (§5.1).
  - Destinations with spawn tables and the spawn fixpoint.
  - Matrices: integer ms per riding tier from the quiet `TravelModel.leg`, over the pairs that can
    be consecutive, after "computing paths". This replaces "tenth-yards turned into ms in
    `transitions.ts`" and gives the reasons in §5.3.
  - The radius at transition time; the sentinels; no compile with pending legs; the leg limit; the
    matrix cache's copies and key.
  - Position-dependent anchor tables through engine exports; the exit chain.
  - The pricing slice and lazy level-only pricing in the worker.
  - Size: tens of kB to about 4 MB per tier, transferred as copies.
  - The self-check.
- **ARCHITECTURE §11.4.**
  - Implicit drops.
  - The key includes XP; dominance on (elapsed, hearth ready, unknown parts[, divergence]); at
    most four entries per key, ranked by the selection order.
  - The two-lane arithmetic hash.
  - The heuristic formula of §7.4.
  - Closing (riding tier, the suffix interval) and the terminal grind fill with its rule.
  - Work items: a rollout before layer 0 and every 8 layers; the budget checked after each item.
  - Up to four solutions.
  - Stages: Milestone 7 = stage 1 + terminal fill.
- **ARCHITECTURE §11.5.**
  - The `start` message transfers typed-array copies; `best` carries a `SearchSolution`.
  - `done` with `cancelled` is the acknowledgement; the grace period is 1,000 ms.
  - The host/entry split as in `src/nav/worker`.
- **ARCHITECTURE §11.6.** The budget stop is after a work item; ties follow the original order.
- **ARCHITECTURE §11.7.** Refer to this file's §13 for the numbers.
- **ARCHITECTURE §12.1.** `DerivedActions.optimizationHost()`, the `'optimizer'` lock held for the
  run and handed to `'proposal'` without unlocking.
- **ARCHITECTURE §13.**
  - Semantic keys by option.
  - A weighted increasing subsequence that keeps fixed steps (locked, or the optimiser's anchors),
    with its tie rule.
  - Non-quest steps grouped with their host (`questHostIndices`).
  - Exclusivity merges sets; prerequisites and step dependencies become `requires` edges closed by
    `applyChangeSets`.
  - Relations are injected, because `diff` imports only `domain`.
  - The API of §11.
- **ARCHITECTURE §14.** The rows of §14.1, with `optimizer-m7.json`, the bench commands and the
  bench section (Barrens and Durotar). The compile budget excludes "computing paths" and the walks.
- **terrain-navigation.md §9.4.** "`transitions.ts` turns tenth-yards into integer milliseconds"
  and "Matrices are cached per (navRevision, sorted endpoint keys)" are superseded by §5.3 here.
- **DECISIONS D-043** (architect; the owner may overrule):
  - the stage 1 scope and the terminal fill;
  - **owner question (review OP-08): may the optimiser replace quests with grinding?** Architect's
    default: no. `goal.grindFill: 'shortfall'` is the default, and `'replace-quests'` is an
    explicit per-run choice;
  - relative rule 3;
  - the implicit anchors, barriers and blocks, and obligations;
  - binding to the next quest step in the section;
  - relation-based availability with dynamic checks, plus verification;
  - per-tier matrices from the quiet model over consecutive pairs, with the leg limit;
  - no optimisation over pending legs;
  - XP in the key;
  - the arithmetic hash;
  - the weighted-LIS diff;
  - `allowNewQuests` refused until stage 2;
  - no Milestone 7 UI.
- **STATUS.** Milestone 7 "Exact next tasks" points to this file and §15. The owner question of
  D-043 goes in the owner-decisions table.
- **SIMULATION §6.** One sentence: the optimiser rounds each part (not only the matrix) to integer
  milliseconds; parity is §6.3 here. The sentence "Tests, exports and optimiser input never have
  pending legs" stands and is honoured (§5.3); it needs no change.

---

## 18. Revision 2: the review's findings and where they are resolved

The review is [reviews/review-optimizer-m7-plan.md](../reviews/review-optimizer-m7-plan.md); its
resolutions section records each outcome and reason.

| Finding | Severity | Outcome | Where |
|---|---|---|---|
| OP-01 Free travel from unknown positions | blocker | Accepted, extended to the predecessor side (the leg into an event is free too) | §3.6, §4.3, §5.2, §6.1 step 2, fixture 12 |
| OP-02 Fixtures 7b, 7d and 7f | major | Accepted | §13: 7b, 7d, 7f |
| OP-03 Same-group binding reorders the incumbent | major | Accepted; binding is to the next quest step, group-agnostic | §3.2, `questHostIndices`, §17 rule 5 |
| OP-04 The walker memo at the section start | major | Accepted | §3.3, `memoBefore`, M7.0 |
| OP-05 Availability only partly dynamic | major | Accepted | §3.5, §4.2, §4.4, fixtures 13a-13c |
| OP-06 Bind point and riding tier | major | Accepted; an unlocated bind is position-checked rather than pinned | §3.6, §4.1 rule 4, §6.1, §7.5 |
| OP-07 Droppable quests that should stay | major | Accepted; carried-work quests are obligatory and listed | §3.4 items 7-8 |
| OP-08 The fill replaces far quests | major | Accepted; `grindFill` with default `'shortfall'`, owner question in D-043 | §2, §7.5, fixture 8b, R8, §17 |
| OP-09 Paths grow as N²; compile records misses | major | Accepted | §5.3 (quiet model, requested pairs, 13,500-leg limit) |
| OP-10 Cache and transfer clash; incomplete key | major | Accepted | §5.3, §5.6 |
| OP-11 Stale shared walks | major | Accepted; the run uses its own walker | §5.1, §9 |
| OP-12 Memo keys | minor | Accepted | §5.5 |
| OP-13 "Moved" and zero legs by index; −1 overloaded | minor | Accepted | §3.3, §5.2, §5.3 sentinels |
| OP-14 Compile budget spent before the matrix; new Places | minor | Accepted | §4.2 (probe), §5.1, §5.2 |
| OP-15 The bench is below the §14 case | minor | Accepted | §14 |
| OP-16 Unchecked suffix changes; the exit model | minor | Accepted | §3.3, §3.4 item 9, §4.4, §5.4 |
| OP-17 Determinism gaps | minor | Accepted | §5.3 (ENG-01), §7.2, §7.3, §7.6, §10 |
| OP-18 Locked steps reported as moved; fill dependencies | major | Accepted | §10, `decodeSolution` |
| OP-19 What Milestone 8 needs | minor | Accepted, except the SIMULATION §6 amendment: the plan honours §6 instead | §5.3, §9, §11 |
| OP-20 Unknown-XP turn-ins | minor | Accepted in one direction; the computed known gain does not change with the turn-in's position | §3.5, §4.1 rule 6, fixture 7f |

---

## 19. As built (final verification, 2026-09-27; search-quality work and its review the same day)

ARCHITECTURE §11, §13 and §14 describe the build. Where it departs from this plan:

| Plan | As built | Why |
|---|---|---|
| §4.3, §7.1-§7.5: an uncertain hearth wait (TIME-4) counts towards the closing limit on unknown parts | Each uncertain wait adds max(0, its bound − the incumbent's bound at that hearth) to a **wait excess**, a dominance field and a term of the score. Solutions are ranked by `comparedMs` = `estimatedMs` + excess; one whose `estimatedMs` beats the incumbent while its `comparedMs` does not is never listed | Review COR-01 (pruning was unsound) and COR-02 (unknown time became a saving) |
| §5.4: the exit chain | A move between world maps in it is unknown travel, as in the engine (SIM-4); a suffix step with no location whose NPC's spawns are all at one point ends it | PAR-01 (compile failed with "model disagrees"); PAR-07 (compile time grew with the suffix) |
| §7.5: the fill covers the target | It reaches max(target, the suffix floor); compile closes the incumbent under the full rules and refuses (`infeasible`) a target the fill could meet only across a suffix threshold. Closes refused because no fill may follow unknown XP are reported (`unknownXpBlocked`) and named in the result's note | COR-03, PAR-06, PAR-04 |
| §7.6: rollout, then layers | Work items R0, P0, L0-L7, R8, P8, …: a **local pass** after each rollout moves one unit up to 24 places either way and keeps a move only when it lowers `comparedMs` (off under a divergence penalty) | PRF-08: the beam never beat its first rollout, and a nearest-neighbour incumbent got no improvement (superseded by the seeds and the four-neighbourhood pass, below) |
| §6.3: parity within 1% | The verifier's bound is max(1 ms, min(1% of the re-walk, 4 ms × (steps + exit steps))) | PAR-09 |
| §9 step 5: candidates against the original | With a numeric target above the original's gain, the incumbent is the original plus its fill, re-walked first; `no-improvement` returns it; if it fails verification the run is `infeasible` | PAR-05 |
| §10 Apply: anchors to the nearest surviving step | A selected move or insert goes after the nearest preceding `after` step that is kept in place or placed by a selected op; the fill takes no host and forms its own `s:` set | PAR-02/RTD-01, PAR-03/RTD-06 |
| §14.1 bench section: the Barrens and Durotar (104 quests) | A generated pool of 100 quests (300 units) on Kalimdor; `search` runs to 2,000,000 evaluations (or until the kicks converge); both incumbents are cases: `firstImprovement.weak` and `.guide` (gated at 2 s), `search.weak` (gated) and `.guide` (reported), each exact block with the nearest-neighbour tour priced in its problem (reported: it is the search's own first seed). Quality is gated separately on eleven pools of the same generator against stored independent references (`quality`: median gap ≤ 3%, each ≤ 7%; review M7Q Q-02) | The stored baselines and exact blocks are in `optimizer-m7.json` |
| §7.6: the anytime search is the rollouts (and, since PRF-08, a single-unit local pass) | **Constructive seeds and a stronger local pass** (review open item 1), revised after the search-quality review (M7Q, D-044). Work items N, P(N), I, P(I); then the beam (R0, P0, L0-L7, R8, P8, and so on) only when it can reach a closing depth within the budget (width × depth × units enabled at the root / 2 evaluations), else **kicks** K: an iterated local search that swaps two adjacent segments of the best order (1-30 units each, from a fixed Lehmer sequence), repairs the precedence edges inside the span, runs the pass with the three junctions dirty, and keeps an end at or below the current order; kicks also follow an exhausted beam in sections of 16 units or more (a smaller section gets one last pass over the best), and stop after max(100,000, 2,000 × units) evaluations without improvement (`converged`). N is a nearest-neighbour seed (the enabled unit nearest by the matrix, no-drop units first); I is a global cheapest-insertion seed (open unit and position adding the least time, best positions kept between insertions, the rest re-applied before each insertion). Its cost grows faster than n² (320,000-1,000,000 evaluations for 300 units, over 2,000,000 for 600; the first build's "about 5 n²" was wrong), so it may spend min(700 × units, budget / 2) evaluations, and nearest neighbour then finishes its partial order. The pass has or-opt (runs of 1-3), exchange and 2-opt within 24 places, and a drop move (off under `'keep-original'` with `'shortfall'`: D-044 item 1); an edge precheck, and a 5 s matrix pre-screen only where the matrix sees the move's whole effect (the window ends before the order, so the exit leg is priced, and touches no anchor, hearth, bind, flight, grind, train, condition, waypoint chain, level-limited or any-of accept, or unknown-XP quest); don't-look bits; it runs to a local optimum or the budget. Everything prices with the transitions and closing, so the contract holds and the result is never worse than the best seed. Off under a divergence penalty (`seeds: false` turns the seeds off, `kicks: false` the kicks) | The first build's seeds and pass took the weak incumbent from 22.8% above a plain nearest-neighbour tour to below it, but the review found that nothing after the seeds improved the best (Q-01), that the tour it beat was its own first seed (Q-02), that the insertion seed could spend half the budget for nothing (Q-03), that the pre-screen lost optima (Q-04) and that the drop move fired in 39 of 40 pools (Q-05). Now, on eleven generated pools at 2,000,000 evaluations: every quest kept; median 1.26% above a stored independent reference ten times as long (from −1.44% to 5.69%) and −9.64% against the tour (from −11.73% to −5.05%). This is an improvement, not a solved problem: the best is above the reference on 9 of the 11 pools. The model oracle is reached on fixture 9's 120 instances at beam 1 in 113 (66 at the Milestone 7 commit, 94 after the first build), at beam 4 in 117 (94, 104), at 16 and 256 in all; on the review's 154 adversarial instances at beam 1, 4, 16 and 256 in 107, 123, 128 and 154 (Milestone 7: 29, 59, 82 and 152; first build: 91, 106, 118 and 151) |
| §14.1: the fixtures' exact evaluations | Re-recorded for the work items above: every fixture keeps its best except grid-40 (fixture 10b), which improves from 3,014,540 to 1,128,640 ms at the same budget; the first improvement comes earlier in 28 cases and later in 1. Re-recorded again after the review (M7Q): all 37 cases keep their best; the first improvement comes earlier in 1 and later in 2; four adversarial cases (seeds 11, 56, 123 and 131) are new, each gated at its stored model-oracle optimum (Q-06). Fixtures 1-11 and the oracle tests pass; the work-item tests that named the old order changed, and fixture 4's width-1 case is now the beam alone (see the next row) | `tests/optimizer-evaluations.test.ts`, whose `$comment` gives the reasons |
| §13 fixture 4: at beam 1, **no-improvement** (X, Y; 102.000 s) | The beam alone at width 1 (seeds and pass off) keeps X, Y as specified. The full search at width 1 finds Y, X (82.000 s): the pass over the nearest-neighbour seed tries it, and its pre-screen now counts the exit leg (Y, X adds 5 s inside the section and saves 25 s of exit). The first build's pre-screen ignored the exit leg, which is the only reason width 1 still failed there | Review M7Q Q-04; fixtures `4-beam1` (beam alone) and `4-beam1-pass` |
| §9 and §11: the shown saving | `OptimizationResult.estimate` gains `comparedMs` and `savingMs = incumbentMs − comparedMs`, and the progress's `bestSeconds` is the best's `comparedMs`; candidates are those whose `comparedMs` beats the incumbent's. After the review (M7Q) the estimate also carries `incumbentEngineMs`, the incumbent's re-walk, so the engine's saving can be checked (Q-10), and every result lists the quests it leaves out (`dropped`, Q-05) | D-043 item 7, review COR-02's leftover (open item 4); D-044 |
| §10: `requires` from the dependant to its placed prerequisites | A quest and a prerequisite both placed require each other, and placing a prerequisite needs a removed dependant removed (both found by a property test over seeded prerequisite graphs) | D-043 item 12 (open item 2): partial apply never breaks a prerequisite order |
| M7.0 engine exports | Not built; `core/replay.ts` replays through the engine's `runStep`; host and quiet view in `src/app/optimizer-host.ts` | Kept the engine untouched in Milestone 7 |

Open after the verification, and what became of it (2026-09-27, after the search-quality work):

- **Search quality from a weak route** (open item 1): much improved, not resolved. The seeds,
  the pass and, after the review (M7Q), the kicks take the weak incumbent below the plain
  nearest-neighbour tour on every pool measured (median −9.64%), but that tour is the search's own
  first seed. Against a stored reference ten times as long, the median gap is 1.26% and the largest
  5.69% (eleven pools); the bench gates it at 3% and 7% (D-044 item 5). Under a divergence penalty
  above 0 the seeds, the pass and the kicks are off, so there the item is still open (D-044 item 6).
- **Partial apply and prerequisites** (open item 2): resolved in `src/diff/change-sets.ts` (D-043
  item 12), with the property test in `src/diff/apply.test.ts`.
- **Cold compile** (open item 3): no change. Through `startOptimization` in a fresh bundled process,
  the first `analyseSection` takes 14.1 ms and the first compile 23.3 ms (medians of 5), each in a
  main-thread task of its own, so no task reaches 30 ms; the 36.8 ms was their sum. Warm they take
  1.9 and 4.4 ms: the rest is V8 running code it has not optimised yet. The one piece of repeated
  work, the geometry both calls build, is repeated on purpose: "computing paths" fills legs between
  the analysis walk and the baseline walk, and flights and transports are priced with the filled
  table. Warming the code ahead of a run would spend the same time elsewhere.
- **The shown saving** (open item 4): resolved (`estimate.savingMs`, `bestSeconds`; above).
- **Store listeners** (open item 6): resolved in `src/app/store.ts`. A listener that throws no
  longer stops the others or makes a store method throw (so a lock taken in `try`/`finally` is
  always released); each error goes to the store's `onListenerError` (default: rethrown in a
  microtask). A reporter that throws is isolated too (review M7Q Q-09): its error is rethrown in a
  microtask and the store method still returns. The optimiser run's own guards (review RTD-03) stay.
