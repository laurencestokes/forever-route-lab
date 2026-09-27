# Review: Milestone 7 (optimiser and route diff)

Reviewed 2026-09-27.

**Process:**
1. The plan ([research/optimizer-m7.md](../research/optimizer-m7.md)) was checked against the
   code as built in Milestone 6. A critic reviewed it
   ([review-optimizer-m7-plan.md](review-optimizer-m7-plan.md): 20 findings, 1 blocker). Revision
   2 resolved every finding.
2. The core and the diff were built in parallel, then the worker, the client and the app compile.
3. A black-box tester wrote the §11.7 fixtures from the specification alone.
4. Four critics reviewed the result, and a sceptic tried to refute each critic's findings:
   - search correctness and determinism;
   - simulation parity and the section contract on real data;
   - performance and memory;
   - the runtime and the diff.
5. Three fixers worked by area, and a final verifier closed the milestone.

**Result:** 38 findings: 10 majors, 20 minors and 8 nits after verification. None was refuted.

- **Fixed:** 36.
- **Kept by design:** COR-04. Nodes that could already close are never expanded, even though an
  arrival radius can make an optional quest save time. The tests' claims were corrected instead.
- **Partly fixed:** PAR-04. The core part was done by a fixer and the app part by the verifier.

## Majors (all fixed)

| ID | Finding | Resolution |
|---|---|---|
| COR-01, COR-02 | Dominance on elapsed time was unsound when a later hearth wait was uncertain, and an uncertain wait could turn unknown time into a reported saving | Solutions are ranked by `comparedMs`. Tests check every order with pruning on and off (D-043 item 7) |
| PAR-01 | A SIM-4 cross-world step at the start of the exit chain made compile fail, so the original was not always feasible | Fixed; tested on 4 real RXP sections |
| PAR-02, RTD-01 | Applying selected change-sets could put a turn-in before its own accept | New placement rule, with property and sample tests (D-043 item 12) |
| PAR-05 | With a numeric target above the original's XP, every faster proposal was rejected | The incumbent is the original plus its fill (D-043 item 11); tested on the real sample route |
| PRF-08 | The beam never beat its first greedy rollout; a nearest-neighbour route got no improvement | A local pass after each rollout (D-043 item 9). A nearest-neighbour incumbent now improves by 4.96% |
| PRF-09 | §14's exact-evaluations gate did not exist | `tests/optimizer-evaluations.test.ts`: 37 cases plus a check that the stored cases match |

## Measured at the final verification

Each figure is a median of three process medians, probe-normalised and bundled.

| Measure | Result | Budget |
|---|---|---|
| Compile, straight-line / navigation model (warm) | 9.6 / 14.0 ms | ≤ 30 ms |
| First improvement (100-quest pool, beam 256) | 10.9 ms at exactly 16,997 evaluations | < 2 s |
| Search throughput | about 4.3M evaluations per second (2,115,281 in 493 ms) | — |
| Worker heap | peak 26.4 MB | < 64 MB |
| Diff of two 10,000-step routes (reversed / shuffled) | 6.5 / 7.4 ms | ≤ 50 ms |
| Entry chunk | 237.60 kB gzip; the optimiser is lazy | ≤ 250 kB |
| Tests | 258 files, 3,840 tests; §11.7 fixtures 1-11 pass (276 tests, including a 160-seed brute-force oracle) | — |

## Open, tracked in STATUS

1. **Search quality from a weak starting route.** At 2M evaluations the beam's best is about 23%
   slower than a plain nearest-neighbour tour of the same pool. The tour itself improves by 4.96%
   once it is the incumbent. Remedy: seed the beam with constructive tours (nearest-neighbour and
   insertion, respecting the contract), and add or-opt and 2-opt local moves, before
   Milestone 8's proposal UX shows results to users.
2. **Partial apply and prerequisites.** Applying a quest's change-set alone can break the order of
   a prerequisite that also moved. D-043 item 12 makes the two sets require each other; this is
   built in Milestone 8.
3. **Cold compile.** A first-ever call can take 36.8 ms. It is reported, not gated (D-043 item 8).
4. **COR-02 leftover.** The app's shown saving and `bestSeconds` still use `estimatedMs`. The UI
   of Milestone 8 must show the guaranteed saving.
5. **Planned items not built:**
   - `DerivedActions.optimizationHost()`, replaced by `src/app/optimizer-host.ts`;
   - the engine exports of step M7.0, replaced by `core/replay.ts`;
   - the ARCHITECTURE §4 and §12.1 notes;
   - a `firstImprovement.guide` bench case.
6. **Store listeners.** The store calls its listeners without catching their errors. The
   optimiser's lock now survives a throwing listener (RTD-03), but the store itself does not.

## Evidence boundary

- **Benchmarks** ran bundled on the development machine at moderate load. The 4× throttled
  laptop run is Milestone 9.
- **The worker** has run in Node and happy-dom harnesses, and in-process in the app tests. It has
  not yet run in a real browser under the proposal UX (Milestone 8).
