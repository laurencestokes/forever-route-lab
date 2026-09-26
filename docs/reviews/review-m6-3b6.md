# Review: Milestone 6 (rules, simulation, validation) and 3b.6 (navigation runtime)

Reviewed 2026-09-26. The work was built by seven specialists:
- rules and simulation;
- the navigation worker and leg table;
- map art, terrain and path layers;
- the engine walker;
- the validator;
- app integration;
- the Milestone 6 UI.

A build verifier ran next. Then five independent critics reviewed it, each paired with a sceptic
who tried to refute every finding before any fix. Three fixers followed, split by area, and a final
verifier. The painted-art, relief and outline layers were **out of scope**, because the base map
is being redesigned as a seamless atlas after owner feedback (docs/research/map-atlas.md). Walking
paths and the path feed were in scope.

**Result:** 67 findings. 66 were confirmed or partly confirmed, and 1 was refuted (UI-17: the
About sentence was judged neutral).

| Severity (after verification) | Count |
|---|---:|
| Major | 10 |
| Minor | 40 |
| Nit | 16 |
| Refuted | 1 |

Evidence and the full finding texts are in the fixers' and verifiers' scratch folders under
`.cache/m6-critic/`, `.cache/m6-fix-*` and `.cache/final-verify/`.

## Majors (all fixed)

| ID | Finding | Resolution |
|---|---|---|
| SIM-01 | An unknown-XP turn-in left a level-capped route "at least N" for good, turning errors into `-uncertain` warnings | The cap is checked before the missing record, and a lower bound that reaches the effective cap is exact. Errata to QXP-3 and XP-4 |
| NAV-01 | A worker that failed to start never fell back; legs stayed pending, retried every 5 s | New `worker-failed` code turns navigation off everywhere; 20 s start timeout; `internal` errors retried 3 times per map |
| NAV-06 | The path feed re-requested paths endlessly once more legs were in view than the 256-path cache held | One record per walked leg with its answer |
| UI-01, UI-02, UI-03 | Status-bar items squeezed; the Cancel/Resume focus ring was clipped or hidden; focus dropped to `<body>` | Status-bar priorities and breakpoints; `overflow-x: clip`; focus returned to the replacement control; CSS asserted in `tests/ui-tokens.test.ts` |
| UI-04 | "Still being computed" was shown while paused or after failures | One pending reason (checking, computing, retrying, paused, failed) used by rows, Details and the status item |
| PERF-02 | The navigation model added 8-10 ms to every walk | Leg requests are built once per endpoint pair, and warning lists are shared: 28.0 → 23.2 ms warm with navigation |

## Minors and nits

- **Rules and simulation:** SIM-02 to SIM-13, ENG-02 to ENG-13 and UI-16/UI-19 are fixed.
  New codes: `DATA003-unknown-objective`, `SIM005-hearth-cooldown-uncertain` and
  `SIM023-start-xp-beyond-level`. New facts: `grind-zero-rate` and `position-unknown` with its
  cause. The tie-break of ENG-08 is kept (TIME-7).
- **Navigation and derived results:**
  - fixed: NAV-02 to NAV-05, NAV-09 and NAV-10, UI-09, PERF-03 and PERF-10;
  - partly fixed: NAV-07, pending per paths object (the adapter needs a per-leg answer), and
    NAV-08, user docks work but not when a transport has two stops on one map.
- **UI:** UI-05 to UI-15 and UI-18 are fixed, as is PERF-11 (memoised rows and narrow selectors:
  a progress tick went from 7-11 ms to 0.4 ms). UI-20 is partly fixed: the simulation half is open.
- **Performance:**
  - PERF-01: the §14 20 ms budget is now measured on a realistic 10,000-step route, and the
    10,877-issue stress route keeps a 40 ms ceiling as a regression guard.
  - PERF-04 to PERF-08: bundled, probe-normalised `--check` runs; shared pure caches; running
    metric sums; stable object shapes.

## Measured at the final verification

The machine was loaded at 24-33%, so each figure is the median of run medians, measured bundled
unless stated.

| Measure | Result | Budget |
|---|---|---|
| Walk + validate, realistic 10,000 steps (warm / cold / edit) | 12.2 / 16.3 / 6.0 ms | ≤ 20 ms |
| Walk + validate, stress route (warm) | 23.3 ms | ≤ 40 ms guard |
| Class change (cold walker, warm pure caches) | 43.2 ms bundled; 51.5 ms under tsx | ≤ 50 ms |
| Map move at 10,000 steps (`map-edit`) | 5.0 ms | ≤ 8 ms |
| Map move with walking paths (`map-paths`, Node) | 8.0 ms | ≤ 8 ms, open |
| Entry chunk | 236.96 kB gzip | ≤ 250 kB |

## Open, tracked in STATUS

- **ENG-01 (instance world map ids).** Without them there are no entrance edges, so every step
  inside an instance gets SIM-4 and the dungeon and raid multipliers never apply. A join through
  `AreaTable.ContinentID` proved unreliable (Blackrock Depths maps to map 0, and area 206
  disagrees between QuestieDB and the client). The source should be QuestieDB's
  `instanceIdToAreaId`.
- **NAV-08 (transport docks).** The dataset has no zeppelin or dock masters for the seeded
  transports: all 6,003 NPCs were searched. The same-map transport rule fires only with
  user-entered docks.
- **Class change under tsx:** 51.5 ms. `derived.bench --budget` should bundle itself as the engine
  and validate benches do.
- **PERF-09:** a map move with walking paths is 8.0 ms in Node, so the browser's `setLayer` and
  redraw leave no headroom. The store's `idsOf` and `retainedBytes` cost remains.
- **Browser coverage:** the navigation worker has run in a browser for the sample route, but not
  under the stress harness. Its heap figures come from Node.

## Evidence boundary

- **Benchmarks** were run on a loaded development machine. Baselines stored under load
  (`derived10000`, `paths10000`) stay provisional until re-measured idle (Milestone 9, throttled).
- **Screen readers:** behaviour is reasoned from ARIA; no NVDA or JAWS run.
