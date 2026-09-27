# Review: Milestone 7 optimiser plan

Adversarial critique of [docs/research/optimizer-m7.md](../research/optimizer-m7.md) revision 1,
before anything is built from it. Findings carry an id, a severity (blocker, major, minor), the
evidence and a required change.

## Critic: contract, parity, determinism and budgets (2026-09-27)

Scope: the plan against ARCHITECTURE §11, §12.1, §12.5, §13, §14 and §17; D-021, D-038 and D-040;
SIMULATION §6 and XP-4; terrain-navigation.md §9.4-§9.5; and the code as it stands (read only):
`src/engine` (`steps.ts`, `walker.ts`, `state.ts`, `places.ts`, `movement.ts`, `conditions.ts`),
`src/sim`, `src/validate/availability.ts`, `src/app/navigation-*.ts`, `src/app/derived-pipeline.ts`
and `tests/architecture.test.ts`.

Scratch checks (Node 22.13.1, tsx, unthrottled) are in `.cache/m7-plan-critic/`:

- `fixtures.ts` walks every order that §13 names, and the alternatives the contract allows,
  through the real engine and validator under harness H. The section-plus-exit time is the final
  `endSec`, less the exit step's own interaction where the exit is a quest step.
- `barrens.ts` sizes the §14.2 bench section with the plan's own filter and location rule.
- `statebefore.ts` times `RouteWalker.stateBefore` on the 10,000-step realistic route.

What holds: I found no bitwise operators and no forbidden `Math` in the design. The two-lane
Lehmer hash stays below 2^47 and is exact, and it is followed by an exact compare. Kill, quest and
grind XP are integers in the code, so the `xpInto` hash fold is exact. The worker's heap estimate
(about 4 MB of candidate records, two layers of `Uint8Array` sets and a 0.5 MB trail) is plausible
against 64 MB. The layer-0 rollout (about 80 enabled units × 235 layers, roughly 19,000
evaluations) makes the 2 s first improvement likely. Fixtures 1, 2, 3, 4, 5, 6, 7a, 7c, 7e, 7g, 8
and 10c reproduce exactly. For 7e, a brute force over every order that keeps L1 < C3 < L2
confirms 205.285 s. For fixture 4, beams 1 and 4 behave as stated.

### Findings

**OP-01 (blocker): travel from an unknown position is free, and the search will exploit it.**
Evidence: §6.1 step 2 prices a move from an unknown position, or into an `unresolved`
destination, at 0 ms with `unknownParts += 1`. §7.5 then only requires `unknownParts ≤` the
incumbent's. The engine does the same (`walkTo` → `unknownTravel`, `movement.ts`), so the
re-walk agrees and verification cannot see the problem. Several things leave the position
unknown:

- zone `travel` and death-skip `note` steps, which are bound units (§3.1) and so movable;
- unresolved destinations, whose quests are obligatory but still movable;
- `several` spawns reached from an unknown position;
- an unbound `hearth use`;
- unresolved flight or transport arrivals.

The search will therefore place the longest gap of the route across such a point: after it, the
farthest unit costs 0 ms. It also gets to choose which unit starts from an unknown section-start
position. That breaks "unknown stays unknown". (§5.4 also lists zone travel and death skips under
"other anchors", which contradicts §3.1.)

Required change:

- Treat every position-unknown event as a barrier. The unit that holds it is an anchor. The unit
  that follows it in the original stays its immediate successor. No free unit crosses the barrier;
  equivalently, split the section there.
- A section that starts at an unknown position keeps its first unit.
- Add a fixture in which a far quest could hide behind a zone travel.

**OP-02 (major): the expected answers of fixtures 7b and 7d are wrong.** Evidence: `fixtures.ts`
(engine walks).

- **7b:** N is droppable (it is not in Q_ext, and its XP and time are known), and P alone meets
  `targetXp: 1000`. P alone costs **186.000 s**, which beats P, N at 192.000 s. The result is
  therefore `improved`, not `no-improvement`. The original order is also not stated.
- **7d:** U is droppable, and T alone meets 1,000 XP. T alone costs **85.203 s**, against the
  stated 91.203 s for T then U.
- **7f:** dropping K would save 406 s (422 − 16), not 410 s.

Required change:

- 7b: state "Original: P, N". The expected result becomes "improved: accept P, turn in P; N
  removed; 186.000 s". That is the result which proves the pin: without it, N alone would win at
  26 s.
- 7d: use keep-original (2,000), which keeps 91.203 s and the riding assertion.
- 7f: correct the figure.

**OP-03 (major): with the same-group binding rule, the incumbent is not the original.** Evidence:
§3.2 binds a step to the next quest step *in the same group*, else to the next one in the section.
Take T1 (group G1), then accept A (G2), then accept B (G1). Unit B becomes [T1, B], so the unit
sequence runs A before T1, which is not the original order. In that case:

- the self-check prices a different route and can fail;
- the "incumbent" is not the author's section;
- the diff reports moves for an untouched section.

ARCHITECTURE rule 5 has the same wording.

Required change: bind only across a contiguous run, meaning no other quest step lies between the
step and its host. Otherwise the step is an anchor. Apply the same rule in `questHostIndices` and
amend §11.2 rule 5.

**OP-04 (major): the walker's memo is not available at the section start.** Evidence:
`stateBefore` returns only the `CharacterState` (`walker.ts`). `visitKey`, `waypointsDone`,
`groupSkip` and `entrance` live in `WalkMemo` (`state.ts`). §3.3 needs "the prefix has one"
(waypoints), and the first section accept's TIME-8 discount needs the prefix's last visit.

Required change: add `walker.memoBefore(index)`, or a `walkerStateBefore`, to M7.0. Do not
re-derive the memo from records.

**OP-05 (major): availability is only partly dynamic.** Evidence:

- `accept()` picks the first `anyOf` candidate that `acceptPolicy.acceptable` does not rule out,
  and `turnInChoice` depends on the log (`steps.ts`).
- `questState: 'available'` predicates call `acceptPolicy` (`conditions.ts`).
- VAL-13 `breadcrumb-target-unavailable` re-checks the target in full, including its level and
  log capacity (`availability.ts`).

All three depend on level and log size, not only on the order edges that §4.2 relies on. §4.2
also turns VAL-16 minimum reputation into an `order` edge. Dropping the rewarding turn-in then
newly blocks the quest, which contradicts "never adds a blocking error".

Required change:

- Compile each `anyOf` step's original choice, and the truth of every candidate before it; the
  child dies if the choice changes.
- Evaluate `available` predicates and VAL-13 with the dynamic rule. `availabilityDependencies`
  must include the breadcrumb target's closure.
- Make minimum reputation a `require` edge.
- The coverage test must hold the log size constant.
- Add fixtures.

**OP-06 (major): the bind point and the riding tier are not fixed by anchors.** Evidence:

- `hearth()` with mode `bind` and no location binds where the character stands
  (`state.hearth = state.location`, `steps.ts`). That position is the previous free unit's.
- `trainRiding` changes nothing below `mountLevels` when XP is known (`sim/travel.ts`). The tier
  therefore does not "derive from the scheduled set" (§7.1), and moving a `train` step earlier can
  lose riding. §7.5 has no tier check.

Required change:

- An unlocated bind pins its predecessor unit, or the bind point becomes state that closing checks.
- Closing requires riding tier ≥ the incumbent's, and a `train` step whose riding outcome differs
  from the original's makes the child infeasible.

**OP-07 (major): the droppable set includes quests that are not untouched or honestly priced.**
Evidence:

- A quest in the character's `priorQuestLog` whose turn-in is in the section is named by no other
  step, so §3.4 makes it droppable. Dropping it leaves the quest open, the D-021 loose end. The
  verification's rule 3 then rejects the candidate, because the engine's `untouched()` is false,
  and the search's work on it is wasted.
- Quests whose turn-in carries D-040 work (VAL030; no `complete` step) carry no objective travel.
  With a numeric target, the search keeps them in preference to honestly priced quests.

Required change: a pool quest that is not untouched at the section start is obligatory. Treat
carried-work quests as obligatory, or refuse them, and say so in the result.

**OP-08 (major): the grind fill turns keep-original into "drop far quests and grind".** Evidence:
at level 10 a kill is 95 XP per 30 s, the `killSeconds` assumption. A 1,000-XP quest with 8 kill
objectives is worth about 18 kills (540 s) of grinding. The search will therefore drop any quest
whose detour costs more than about 294 s, which is about 2,060 yd round trip at 7 yd/s: common in
the Barrens. R8's mitigation ("only with an explicit numeric target, or when a reorder makes it
free") is false.

Required change: an owner decision in D-043. Either:

- under keep-original, offer the fill only while every droppable quest is kept (it then covers the
  level-dependent XP loss only); or
- add an explicit "may replace quests with grinding" option, default off.

Pin the choice with a fixture and correct R8.

**OP-09 (major): "computing paths" grows as N², and compile records missing legs.** Evidence:

- The plan asks for every directed same-map pair of all locations, including waypoints, spawn
  candidates, bind points and docks.
- RC-07's 16 s ceiling was derived from the 116-point matrix: 3.18 s × 4 × 1.25 (terrain-navigation
  §9.5). That is about 0.23 ms per leg, so the ceiling holds only up to about 120 locations.
- The refusal threshold N = 600 means 359,400 legs, about 81 s unthrottled.
- RXP sections with `.goto` travel steps exceed 120 locations easily.
- `NavigationTravelModel.leg` calls `table.recordMissing` on a miss, and the scheduler's background
  drain takes those legs whenever no hold is active. After a failed or partial paths phase,
  compile therefore queues the whole remaining matrix.

Required change:

- Request only pairs that can be consecutive: each unit's end location to each unit's first
  destination, plus the fixed pairs inside units and waypoint chains.
- Derive the refusal limit from the leg count and the 16 s ceiling (about 13,500 legs), not from
  memory.
- Read the table without recording during compile.

**OP-10 (major): the matrix cache and the transfer clash.** Evidence: §5.3 caches matrices in a
two-entry LRU, and §5.6 transfers the same `ArrayBuffer`s to the worker, which detaches them in the
cache. The cache key also omits the TravelGraph's transports (user docks change same-map
transport compositions), the fallback detour factor inside the navigation model, and the table's
unavailable maps.

Required change: transfer copies, or cache copies. Add those three items to the key.

**OP-11 (major): compile and the self-check read stale, shared walks.** Evidence: the host shares
the pipeline's walker. Legs arrive in scheduler batches, and the pipeline re-walks up to 100 ms
later. The walker cannot see new legs without `invalidate` (the `walker.ts` doc). The self-check
therefore compares a navigation matrix with fallback-era records. `stateBefore` can also change
during the run.

Required change: after `paths`, invalidate from the section start, walk synchronously, and snapshot
the records and states the run uses. Alternatively, price the incumbent with the verification
walker.

**OP-12 (minor): lazy pricing keyed by (unit, level) is wrong for some parts.** Evidence:
`grind()` depends on level, XP and `unknownXpEvents` (`grind.ts`). The turn-in's quest XP is read
at the level *after* the carried kill XP, which depends on `xpInto`.

Required change: memoise only the parts that depend on level alone (the objective block, `questXp`
at a level, `trainRiding`), and price grinds and hearths directly.

**OP-13 (minor): TIME-8 and zero-length legs by index, not by point.** Evidence: the engine's rule
is `moved = !samePlace(before, after) || work.legs.length > 0`, and `groundTravel` returns 0 s
without calling `model.leg` when `yards − radius ≤ 0`. The plan compares location indices instead.
Two interned locations at one point with different zone hints then give 3 s in the plan against
2 s in the engine, and a non-zero navmesh leg. A waypoint chain that returns to its start counts
as moved in the engine. §5.3 also uses −1 both for cross-map pairs and for unknown seconds.

Required change: define "moved" and zero legs by point equality and by legs actually walked. Set
0 ms whenever the points coincide, and separate the two meanings of −1.

**OP-14 (minor): the compile budget is spent before the matrix.** Evidence: 78 `stateBefore`
calls took 6.1-18.7 ms (`statebefore.ts`), and `codes()` doubles the count. `createPlaces(context)`
also builds a new `Places`, so its endpoints are *not* the walk's objects (§5.2 claims they are).
Every one of the N² requests then misses the navigation model's per-point request cache.

Required change: collect the original findings in one visitor pass, or from the validator's
issues, and expose the walker's `Places`.

**OP-15 (minor): the bench is below the §14 budget case.** Evidence: the plan's filter keeps 78 of
the 98 Barrens quests and about 235 actions (`barrens.ts`: race and class 5, repeatable, event or
dungeon 11, breadcrumbs 4), before the validator repair drops quests gated by level. ARCHITECTURE
§14 budgets 100 quests and about 300 actions. The (minLevel, id) incumbent is one any greedy
rollout beats. The heap figure is in-process growth, not the worker heap, and the start of the
first-improvement clock is not defined.

Required change:

- Reach at least 100 quests and 300 actions, for example by adding Durotar quests.
- Add a guide-quality incumbent case.
- Measure in a `worker_thread` from `run()`.
- Report `duplicates`, to back the claim that "XP in the key keeps pruning power".

**OP-16 (minor): changes to the suffix go unchecked.** Evidence: `xpStepSkipping` is on by default
(`project-factory.ts`), so `levelAtLeast` and `available` skips in the suffix can flip when the
XP at the section end differs, and rules 1 and 2 do not see it. Two more gaps:

- A group whose only in-section located step belonged to a dropped quest walks its waypoints in
  the suffix, and the exit model has no waypoint variant.
- A hearth-use exit cannot be the table `exitMs[loc][tier]`.

Required change: verification compares the activity of every suffix step with the original's.
Price the exit as a state transition, including waypoints.

**OP-17 (minor): gaps in the determinism specification.** Evidence:

- Which entry goes when a key already holds K = 4 Pareto entries is unspecified.
- It is undefined whether an evaluation budget reached during a rollout stops at the next layer's
  end.
- A two-slot open-addressing table cannot hold one layer; use a constant-hash test mode instead.
- The LIS is not unique; the plan says it is.
- An ENG-01 guard already exists in `tests/derived-navigation.test.ts`: extend it, and add a
  runtime `failed` when the graph has entrance edges.

Required change: specify each of these.

**OP-18 (major; it shapes Milestone 8): the diff reports locked steps as moved.** Evidence:
fixture 7e's after-order before-indices are [2,3,6,4,5,0,1]. Its only LIS of length 4 is
[2,3,4,5], so the locked L2 becomes a singleton `move` set that can be applied alone. The fill's
change-set also has no `requires` edge to the drop or reorder sets that created the deficit.
Dataset relations cannot express that edge.

Required change:

- Use a weighted LIS that keeps anchors fixed, and report moves of free steps relative to the
  anchor chain.
- The optimiser emits change-set dependencies (fill → drops) for the diff.

**OP-19 (minor): Milestone 8 needs more than the plan provides.**

- `verifyCandidate` must accept a partial change-set application without `estimatedMs`.
- The lock must pass from `optimizer` to `proposal` atomically.
- `computeLegs` fills legs, not the path polylines the proposal overlay draws.
- `OptimizerUiState` and the progress of the `paths` phase need defining.
- SIMULATION §6 ("optimiser input never has pending legs") contradicts the provisional compile.
  List it in the amendments of §17.

**OP-20 (minor): an unknown-XP turn-in can inflate known XP.** Evidence: after an unknown event,
`questXp` uses the lower-bound level (XP-4). `questXpTenths` falls as the level rises, so quest XP
reduced by level difference is over-stated. Moving an unknown-XP turn-in earlier can therefore
lift the "known" gain towards the target.

Required change: unknown-XP turn-ins keep their order relative to units that grant XP (anchor
them), or the plan justifies why not.

### Summary

One blocker (OP-01) and eleven majors: the fixtures (OP-02), the contract (OP-03 to OP-08), paths
and caching (OP-09 to OP-11), and the diff (OP-18). The plan should be revised to revision 2 and
these findings resolved before step M7.0 starts.

## Resolutions (plan revision 2, 2026-09-27)

The plan is now [revision 2](../research/optimizer-m7.md). Every finding is resolved:

- 15 are accepted as required;
- OP-01 is accepted and extended;
- OP-03, OP-06 and OP-20 are accepted with a different mechanism or in a narrower form;
- OP-19 is accepted except its SIMULATION §6 amendment, which is rejected.

The reasons are below. One claim of OP-20's evidence is not upheld. Plan §18 maps each finding to
the sections that changed.

New and changed fixture figures were walked through the real engine and validator
(`validateRoute`, so the walker uses the validator's accept policy), with the critic's harness H:
`.cache/m7-plan-rev2/fixtures.ts`. The bench counts come from `.cache/m7-plan-rev2/bench-size.ts`.
Both are local scratch scripts, read only.

| Finding | Outcome | Resolution in revision 2 |
|---|---|---|
| OP-01 (blocker) | **Accepted, extended** | Every position-unknown event is a **barrier** (plan §3.6). The events are found from the original records: the position ends unknown, or travel is unknown because of the position (zone travel, death skips, unresolved destinations, `several` spawns, an unbound hearth, unresolved flight or transport arrivals). A barrier moves only inside a **block** with its original neighbours. The block runs backwards over units without travel, up to the first unit that travels to a destination, and forwards over units that leave the position unknown, up to the first that ends at a known one. The section start and end act as neighbours, and touching blocks merge. **Extension:** the review fixed only the successor, but the leg *into* a zone travel is as free as the leg out of it (`travel` with a null location calls `unknownTravel` whatever the origin), so the predecessor is fixed too. Free units still cross blocks, because their legs into and out of a block start and end at known positions. For the same reason, a matrix leg whose seconds are unknown (`UNKNOWN_MS`) is usable only on a pair the original walk used (plan §5.3). §5.4's contradiction is removed. New fixture 12: no-improvement at 608.000 s. The exploiting order is priced at 338.000 s by the engine itself and is refused. The order that puts F between accept B and turn in B ties at 608.000 s; the tie keeps the original. |
| OP-02 | **Accepted** | 7b: "Original: P, N"; expected **improved**, P alone, N removed, 186.000 s against 192.000 s (N alone would be 26.000 s with VAL-8). 7d: keep-original (2,000), 91.203 s, riding 1. 7f is redesigned for OP-20 (below); its "dropping K would save" figure is now computed per variant (206 s in v1). |
| OP-03 | **Accepted, simplified** | A non-quest step binds to the **next quest step in the section**, whatever its group, so every unit is a contiguous run and the incumbent is exactly the original. Inert quest steps count as hosts, and a trailing run is an anchor (plan §3.2, `questHostIndices`, ARCHITECTURE rule 5 amendment in §17). The review's version kept the same-group preference and made a non-adjacent case an anchor. The simpler rule has the same effect on the incumbent and moves more steps with their natural host. |
| OP-04 | **Accepted** | `RouteWalker.memoBefore(index): ReadonlyWalkMemo` in M7.0, rebuilt from the checkpoint as `stateBefore` is, never from records (plan §3.3). |
| OP-05 | **Accepted** | `availabilityDependencies` gains the breadcrumb target's closure and splits minimum and maximum reputation. Minimum reputation is a `require` edge. Any-of accepts check that every earlier candidate stays `false` and the chosen one stays not `false`. `available` predicates use the dynamic rule and must keep their exact truth. VAL-13's target gates are evaluated dynamically; `target-unavailable` is a doubt (`DOUBT` in `availability.ts`), so it lowers truth to `unknown`, which the rule refuses. Verification gains an `availability` rule, because the validator alone would not flag that doubt as an error. The coverage test holds the log size constant (plan §3.5, §4.2). Fixtures 13a (any-of, 309.125 s kept), 13b (minimum reputation: R alone, 106.000 s; M alone refused) and 13c (breadcrumb target: 309.125 s kept; the reorder would raise `VAL013-breadcrumb-target-unavailable`). |
| OP-06 | **Accepted, other mechanism for the bind** | Riding as required: a `train` whose riding outcome differs from the original's kills the child, and closing requires tier ≥ the incumbent's (plan §4.1 rule 4, §7.5). The unlocated bind is **position-checked**, not pinned: it is feasible only where the position before it equals its original position, by point. Pinning the predecessor unit would not fix the point when that unit's destination is a spawn chosen by position; the check is exact and lets any unit that ends there precede the bind. |
| OP-07 | **Accepted** | Obligatory (plan §3.4): a quest not untouched at the section start, or one the section turns in or completes without accepting it (item 7); and a quest whose original turn-in carries D-040 work (item 8), listed in `summary.carried` with the note that its objective travel is not priced. |
| OP-08 | **Accepted; owner decision requested** | `goal.grindFill: 'shortfall' \| 'replace-quests'`, default `'shortfall'`: the fill is offered only while every droppable quest is scheduled. `'replace-quests'` is an explicit per-run choice. D-043 carries the owner question, with the architect's default "no" (plan §2, §7.5, §17). Fixture 8b: `'shortfall'` gives no-improvement at 412.000 s; `'replace-quests'` gives A plus an 11-kill fill, 356.000 s, with F removed. R8 is rewritten. |
| OP-09 | **Accepted** | Only pairs that can be consecutive are requested (plan §5.3). The refusal is at **13,500 requested legs** (the 116 × 115 = 13,340 legs behind RC-07's ceiling), and locations are capped at 1,024. The run reads the table through a new **quiet** view of the navigation model that records no miss, so neither compile nor the run's walks queue legs for the background drain. |
| OP-10 | **Accepted** | The cache owns its buffers, and compile transfers `slice()` copies. The key adds the fallback detour factor, the same-map transports of the maps touched, the table's unavailable maps, the model id, and the requested pair list (hashed, then compared exactly). |
| OP-11 | **Accepted** | The run never reads the pipeline's walker. It builds its own validator and walker on the host's context: an analysis walk before `paths`, then a baseline re-walk after it, invalidated from the last hearth cast before the section and run synchronously with a probe visitor. Verification re-walks candidates on the same private walker (plan §5.1, §9). |
| OP-12 | **Accepted** | Memoised: objective blocks, carried blocks and `questXp` per level, and `trainRiding` per (level, uncertain, tier). Grinds and hearth waits are priced per transition (plan §5.5). |
| OP-13 | **Accepted** | "Moved" follows the engine: point equality by coordinates, or a leg walked. Locations carry a point id; coinciding points are 0 ms with no leg. Sentinels `UNKNOWN_MS = −1`, `CROSS_MAP = −2` and `NOT_REQUESTED = −3` (plan §3.3, §5.2, §5.3). |
| OP-14 | **Accepted** | The probe visitor records original truths, codes and state scalars in the baseline walk. Only `stateBefore(first)` and `memoBefore(first)` are replayed. `RouteWalker.places` is exposed, so compile uses the walk's endpoint objects (plan §4.2, §5.1, §5.2). |
| OP-15 | **Accepted** | The bench is The Barrens plus Durotar: 104 quests and 315 actions before repair (the Barrens alone: 78 and 235), none with unknown XP. It has a weak (minLevel, id) incumbent, which is gated, and a guide incumbent (a deterministic nearest-neighbour tour), which is reported. The heap is measured in a `worker_threads` worker from `run()`, and `duplicates` and `dominated` are reported. The first-improvement clock runs from the `start` post to the main thread's receipt of the first improving `best` (plan §14). |
| OP-16 | **Accepted** | Verification's `suffix-activity` rule compares every suffix step's activity and any-of choice. In the search, a suffix XP interval `[ΔLo, ΔHi)` covers the suffix's `levelAtLeast` predicates, level gates and riding trains, and the quests read by suffix availability readers join Q_ext, with the log count held equal. The exit is an **exit chain**, priced as a state transition up to the first position-fixing suffix step, including waypoints and a hearth use. A group whose waypoints the section walked and which continues into the suffix makes that unit's quest obligatory (plan §3.3, §3.4 item 9, §4.4, §5.4). |
| OP-17 | **Accepted** | The K = 4 overflow keeps the four best by the selection order. The budget is checked after each work item (rollout or layer), never inside one. A `testHash: 'constant'` mode replaces the two-slot table. The subsequence's tie rule is documented, and "unique" is withdrawn. The existing ENG-01 guard in `tests/derived-navigation.test.ts` is extended, and compile returns `failed` when entrance edges meet an instance location in the section (plan §5.3, §7.2, §7.3, §7.6, §10). |
| OP-18 | **Accepted** | The diff uses a maximum-weight increasing subsequence in which fixed steps (locked by default; the optimiser passes its anchors) weigh n + 1. It runs in O(n log n) with a segment tree and no bitwise operators. On fixture 7e it keeps L1, C3 and L2 and reports only A's and B's steps as moved. `DiffOptions.dependencies` carries the optimiser's step dependencies: the fill requires every removed step and every moved XP-granting step (plan §10). |
| OP-19 | **Accepted, except one item (rejected)** | `verifyCandidate` takes `estimatedMs: number \| null`. The lock hand-over acquires `'proposal'` before releasing `'optimizer'`, in one synchronous task. `OptimizerUiState` is defined, with the `paths` phase's leg progress. The overlay's polylines come from `model.path()`, as for the route line, and are recorded as a Milestone 8 requirement. **Rejected:** amending SIMULATION §6. The plan honours it instead: a run never compiles with pending legs (`failed`, with a reason), and revision 1's `provisional` result is withdrawn. A result priced on fallback legs would be verified against a re-walk on navigation legs, which makes "improved" unreliable. |
| OP-20 | **Accepted in one direction; the evidence's claim is not upheld** | The computed known gain does not change with an unknown-XP turn-in's position. After it, the engine prices XP at the lower-bound level, which is the level computed from known XP alone, whatever the turn-in's position. What moving it earlier changes is which prices are exact: quest or kill XP that the original priced before any unknown event becomes a price at a lower bound, which can over-state reduced XP. Revision 2 therefore adds `order` edges from each XP-granting unit that preceded an unknown-XP turn-in to that turn-in. Units that followed it may still move before it, because that only makes more prices exact. Anchoring the turn-in both ways would forbid those harmless moves. Scope: 763 of the dataset's 4,257 quests have no XP value; none of the 104 bench quests do. Fixture 7f now has two variants: v1 (original K, A) improves to A, K at 332.000 s from 532.000 s, and v2 (original A, K) keeps 442.000 s, refusing K, A (422.000 s). |

Shared files: none changed by revision 2. The plan still changes no shared file except the minimal
list in its §12: `tests/derived-navigation.test.ts` (the ENG-01 guard) and
`tests/bench/bench-support.ts`, neither of them a map-team file.
