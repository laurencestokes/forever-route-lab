# Rework follow-up (D-050, D-051): reports, findings and state

Recorded 2026-10-01, when the owner paused the local session and moved the work to a cloud session.

**State:** the follow-up workflow finished every stage except its last one, "fix + final verify".
Its work is on the `rework-followup` branch and is not yet verified. That means:
- the speed fixes and entry trim;
- the D-050 UX items (default state, level ceiling), the TR-03 berths and the minors;
- the re-pin to client 1.60.1.70124, with the rebuild (see [repin-70124.md](repin-70124.md)).

The findings of the follow-up critic below are the next work. Reproduce each, fix the confirmed
ones with tests, then run the full verification and merge to `main`.

**Not available outside the owner's machine:**
- **The WoW client.** Every client-gated `--check` (`nav:check`, `atlas.ts`, `minimap.ts`,
  `client-tables.ts`, `convert.ts`, `byproducts.ts`, `nav:validate --client` and
  `--partition`) needs the installed client at `.build.info` 1.60.1.70124.
- **The minimap tiles.** They are gitignored and the release-asset pack is not yet published
  (D-049 O14), so the app falls back to the painted style, and `pnpm check` warns but passes.
- **`.cache/`.** This held the measurement harness (`.cache/map-atlas/u2/cdp.mjs`), the
  readability mocks and owner sheet (`.cache/readability/`) and the earlier sheets. Recreate
  what is needed.

Report texts follow, from the agents' own words, with local paths removed. Paths under `.cache/`
refer to the owner's machine.

## Follow-up critic: findings to fix

# Critique of the D-050 follow-up

The follow-up does not close D-050 item 5. `derived --check` still fails, and part of that slowdown comes from the follow-up's own default-state change. Edit-to-map was not fixed, although the speed report left it off its list of failures. The first-view bytes are worse on the new opening view. The owner's readability complaint, relayed again in this run ("I think the left panel is more readable on wowF-QRP though"), has not been addressed: B+ is not built. The re-pin holds up: every rebuild matched byte for byte.

I edited no repository files; `git status` shows the same 127 entries as when I started. Everything I produced is under `.cache\followup-critic\`.

## Findings

**F-01 (major): `derived --check` still fails, and part of it is the follow-up's own code.**
- **Evidence:**
  - The check failed in 2 of 2 runs, even probe-normalised: editMiddle +38 and +45 %, classChange +28 and +33 %, navEditStart +35 and +47 %, editStart +25 %.
  - An interleaved A/B, 3 rounds, compared the pre-rework commit 95e84cc, eff4341 and the current tree (medians): editStart 25.4 / 29.5 / 38.2 ms, navEditMiddle 18.9 / 21.4 / 28.2 ms, editEnd 0.70 / 0.78 / 2.03 ms.
  - I then disabled only the end-of-route state (D-050 item 2, `derived-pipeline.ts:541`) in a scratch copy. Over 5 pairs, editEnd fell from 2.07–2.68 to 0.83–1.14 ms, and navEditMiddle was 3–6 ms lower in every pair.
  - The speed report's finding that "the gap is the machine, not the code" came from runs at 18:52. The default-state edit landed at 19:09.
  - editStart's remaining +8 ms against eff4341 is still unexplained.
- **Required:** keep the end-of-route quest state out of the edit's publish (or compute it only when something needs it), attribute editStart, and pass `--check`. D-050 does not allow a re-baseline.

**F-02 (minor): the `--check` rule itself changed.**
- **Evidence:** the stored baselines are identical to HEAD, but `derived --check` now divides by the CPU probe. It assumes the stored `derived10000` medians were taken at a 40 ms probe, and that block records no probe.
- **Required:** the architect approves the rule change, or the baseline's probe is shown.

**F-03 (major): edit-to-map is not fixed, and the speed report does not list it as failing.**
- **Evidence (my CDP runs, minimap / painted):**
  - Edit to pins painted: 46 / 45 ms at 1× (p90 52), 287 / 286 ms at 4×. The review had 40–54 ms, and 5.5 ms on 2026-09-28.
  - Selection to pins painted: 44 ms at 1× (p90 89–90), 275 ms at 4× (p90 511–554).
- **Required:** fix it, or the architect sets an explicit gate. Either way, record a verdict.

**F-04 (major): the other item-5 gates still fail, and the painted style's pans were never measured.**
- **Evidence:**
  - 10,000-step pan at 4×, minimap: p99 52.9 ms, 15 frames over 33 ms. The builder's final range was 45.9–48.7 ms.
  - Same pan, painted: p99 62.5 ms, 20 frames over 33 ms, six long tasks of 51–70 ms. The speed record covers the minimap only.
  - First art at 4×: 1,767–2,203 ms (minimap) and 1,912–2,232 ms (painted), and 2,700 / 3,410 ms in the uninstrumented run. The budget is 1.0 s. At 1× it passes (534–666 ms).
- **Required:** STATUS keeps item 5 open, and both styles are measured.

**F-05 (major): the first-view bytes got worse on the new opening view.**
- **Evidence:** selection on open moved the first view.
  - Minimap: 216.0 kB, up from 195.4 (15 level −2 tiles, 213,756 B).
  - Painted: 134.4 kB, up from 121.3, plus 23.3 kB of level −3 tiles and the 91.3 kB underlay.
  - Both are over the 100 kB budget, and `rework-speed-d050.json` still records the old view.
- **Required:** a MR-06 decision on this view, and the record updated.

**F-06 (major; the owner's relayed request): left-panel readability is still open.**
- **Evidence:**
  - B+ (D-051) is not built.
  - UI-15 only touches one-line rows, which are not the default, and 4 of 18 rows still show fewer than 15 characters.
  - `.cache/ui-d050/shots/open-view.png` still shows cut titles ("Turn in From The Wrecka…").
  - The entry is 247.50 kB on my audit, which leaves 1.00 kB under the stop rule.
  - The §10.3 ledger (`ui-refresh.md`) and `ui-refresh.json` stop at 248.98 / 246.82 kB.
- **Required:** build B+ next, with its entry cost planned within the 1.0 kB (or trim first), and add the 246.82 and 247.50 kB rows to the ledger.

**F-07 (minor): the berth rule cites a decision that does not exist, and departs from the ruling.**
- **Evidence:**
  - `berths.ts:5,10`, SIMULATION TIME-7 and three tests cite "D-050 item 4", which is actually the `map/marks` split. DECISIONS.md has no berth ruling.
  - Raising the radius from 40 to 100 yd means the untimed step from boarding point to berth can be up to 95.2 yd. At 7 yd/s that is 11.7 s unpriced at Menethil (81.6 yd) and 13.6 s at Rut'theran, at each end of a ride. For example, the walk from Menethil's flight master to the boarding point is 22.5 s; to the berth it was 45.8 s.
- **Required:** the architect records the ruling (the radius, and whether that step stays at 0 s or is priced as boardingYd at run speed as an ASSUMPTION), and the citations are fixed.

**F-08 (minor): the drawer's counts include quests the level ceiling holds back.**
- **Evidence:** at step 55 (level 9), 43 of the 128 quests in the drawn-by-default rows (available, may be available, needs a prerequisite) are held back. The drawer still says "87 · 73 givers" (`map-wording.ts:387`; `quest-state.ts:988–991` has no ceiling check).
- **Required:** count only what is drawn, or say how many are not drawn.

**F-09 (minor): UI-15 is a design change nobody ruled on.**
- **Evidence:** §6.1 says one-line rows show the verb, and the review's verifier called dropping it the owner's choice. DECISIONS.md records nothing.
- **Required:** owner ratification and a §6.1 edit, or revert.

**F-10 (nit): selection on open breaks the harness's 10k selection case.**
- **Evidence:** the list opens at step 10,000, so 9 of 14 harness clicks land on off-screen rows and cause no map calls.
- **Required:** fix the harness before any future 10k selection figures are used.

**F-11 (nit): the re-pin report is incomplete.**
- **Evidence:**
  - `repin-70124.md` §10 leaves out the four test-literal edits and the THIRD_PARTY_NOTICES lines.
  - `nav-m3b.json` still names 70009 as the client.
  - `.cache/minimap-pack` holds three stale packs.
- **Required:** complete §10, and add `2a05fc56` to STATUS's MD-10 list.

**F-12 (nit): the full test suite is not reliably green under load.**
- **Evidence:** of two full `pnpm test` runs, the first had 2 failures and the second 1:
  - the architecture test's path-hygiene check timed out at 6.7 s and 9.6 s against the default 5 s;
  - `App.pipeline` could not find the "Issues" list once.
  - Both pass on their own (23 of 23). Final counts: 4,871 passed, 1 skipped.
- **Required:** give the path-hygiene test an explicit timeout and make the `App.pipeline` wait sturdy.

## What held up

- **Node benches:**
  - `map-edit --check` passed 2 of 2: selection 1.34–1.43 ms, move 5.09–5.19 ms, p90 ≤ 6.09 ms; atlas move p90 5.68 ms.
  - `map-paths --budget --check`, `engine --check` and `validate --check` pass.
  - No stored baseline value changed; only new keys were added.
- **Berths:**
  - End to end through the pipeline, no Auberdine transport step raises the long-swim warning (SIM021), and `boardingYd` is recorded.
  - My own search (0.5 yd rings) agrees with the table: 36.5 / 16.0 / 15.5 yd against 36.8 / 15.8 / 16.1 yd.
  - Ratchet's boat (path 241) is not a seeded transport, so the rule never reaches it. Its berth snaps to water, and the nearest walkable point is 25.5 yd away; Booty Bay is 29 yd, Menethil–Theramore 20 and 39.5 yd.
- **Re-pin:**
  - `nav:check` rebuilt 113 of 113 files identical. `nav:validate` passes 56 checks, including G1 and G13 (the tool tree equals the checkout).
  - `client-tables`, `byproducts`, `convert`, `atlas` (792 tiles) and `minimap --check --pack` (6,647 tiles, pack `2bc7fa6b…`) all pass, and so does `maps:validate` with MT.
  - The census is unchanged and no component is new, so no review entry was owed.
  - No minimap tile is tracked, and no pin constant is left at 70009.
- **Typecheck and lint** pass.

Main files: `ab/summary.txt` and `ab3/` (A/B), `runs/` (CDP), `client/summary.log`, `probe/*.json`, `test.log`, `test2.log`.

## Speed regressions and entry trim (built)

# D-050 items 5 and 6: speed regressions and entry-chunk trim

Most of the regressions are fixed and the entry chunk is back under the stop rule. Three things still fail: `derived --check`, the 4× pan gate on the 10,000-step project (p99 is still over 33 ms), and first art at 4×. The first-view bytes also fail when measured on the view the app actually opens at.

Everything is uncommitted and stays inside the files I own. Typecheck and lint are clean. The full `pnpm test` passes: 335 files, 4,826 tests, 25 skipped.

Other agents kept the machine loaded throughout (Windows load 14–70 %; their Vite dev server alone used about 2.4 cores). So every comparison below is interleaved against a build of eff4341 itself (`git archive`, same `node_modules`). Figures are median [min–max].

## Results

| Item | Before (eff4341) | After | Verdict |
|---|---|---|---|
| **map-edit --check** (tsx, 3 runs) | selection 2.66, move 6.23 ms | selection 1.24–1.35, move 4.70–5.19, p90 ≤ 5.79 ms | pass, 3 of 3 |
| map-edit, bundled A/B (5 pairs) | selection 2.49 [2.28–2.68], move 6.60 [6.40–7.18], atlas move p90 7.73 ms | 1.34 [1.12–1.56], 4.74 [4.61–5.61], 5.41 ms | |
| Selection at the continent band (new case) | 1.9 ms | 0.8 ms | reported, not checked |
| map-paths | move 7.12, new paths object 2.62 ms | 5.89, 2.29 ms | `--budget` and `--check` pass |
| **derived --check** | fails | fails for both builds equally | not fixed |
| Selection → pins painted, 1× (42 selections) | 93.4 [6–199] ms | **40.1** [6–116] ms | |
| Selection → pins painted, 4× | 288 ms | 269 ms | |
| Edit → pins painted, 1× (36 edits) | 59.1 ms (last map call 45.0) | 53.8 ms (last map call 39.1) | |
| Edit → pins painted, 4× | 359 ms | 331 ms | |
| 10k pans at 4× (3 runs each) | p99 61.1 [55.5–62.5], longest task 74 ms, 21 frames over 33 ms, longest sync 69 ms | p99 **46.1** [45.9–48.7], no task over 50 ms, 14 frames, 41 ms | improved; p99 still fails |
| First art, 1× | 627 ms | 524 ms | pass |
| First art, 4× | 2,293 [1,804–2,526] ms | 2,065 [1,549–2,189] ms | still fails |
| First-view bytes, on the opening view | — | minimap 195.4 kB; painted 121.3 kB (+23.3 kB of level −3 tiles) | FAIL against 100 kB |
| **Entry chunk** | 248.98 kB | **246.82 kB** | 1.68 kB under the 248.5 kB stop rule |

**`derived --check`.** Two interleaved A/Bs show my tree running at eff4341's speed (classChange 65.8 against 66.7 ms). eff4341 itself now runs at +53 % against its own stored bundled figure, so the gap is the machine, not the code. It passed twice at the start of my session, when the machine was calmer. A CPU profile puts 91 % of the class-change case in the engine walk and the validator, which I don't own. I made `--check` divide each median by the CPU probe, as the engine and validate benches already do; the stored baselines are unchanged. That only takes back part of this kind of load (probe 48 ms against 40).

**10k pans at 4×.** What remains after each drag is the view's own sync plus one walking-path update, landing in one frame. The next step would be an incremental route walk when a new paths object arrives.

**First art at 4×.** The remaining time is before the map mounts: React's first commit takes about 620 ms at 4×, of which 390 ms is layout effects from `useMapRegionDocking` in `MapPanel` (src/ui). The map mount and fit take another 430 ms. Meeting 1.0 s would need `main.tsx` to request the tile index before the workspace loads, and a cheaper first commit on the UI side; neither is my code.

**First-view bytes.** I measured without the harness's Zoom in/out capture, which was loading extra tiles. It only passes with a different opening view or coarse-first loading. That is a design decision for you or the owner; I changed nothing, since the owner signed off the look.

## Fixes

- **Selection** (`src/map/layers.ts`): each spawn layer keeps its placed points and plain markers per input. It is keyed on the groups a focus holds, not the quest ids, so a selection change only rebuilds the focused groups' markers. Merged groups are memoised. The active-step split keeps each route piece's range of positions.
- **Moving a step**: step positions are now updated in place rather than rebuilt (`createPositions` in `src/app/map-model.ts`). Piece boundaries are cached per step, the focus check scans instead of renumbering, parts are counted in view only when a layer overflows its budget, and the cap uses a selection instead of a full sort.
- **Selection → map** (`src/app/derived-pipeline.ts`): a change to a still selection rebuilds the quest state straight after the next paint. While the selection is moving, the 60 ms settle still coalesces, so UI-04's goal holds. After a walk of 8 ms or less, an edit's quest state runs in the walk's own task.
- **Edit → map, tried and withdrawn:** walking before the edit's first frame painted everything together, but pushed the edit's own first paint from about 25 to about 50 ms, so I reverted it.
- **Clustering moved into the derived publish** (D-050 item 6): new `src/app/map-clusters.ts`. The quest-state task builds every level; the places model hands the clusters to the map as `PlacesModel.clusters`. Before the pipeline's chunk loads, zoomed-out givers show as per-zone counts.
- **10k pans**: the adapter now emits a `movestart` event. The paths feed holds new paths objects during a gesture and issues them once it settles. Off-view legs are no longer looked up on every pass ("parked"), and the route walk and `pathOf` bookkeeping are cheaper.
- **First art**: the tile-index reader chunk now loads alongside the index file instead of after it (requested at 1.25 s instead of 2.25 s at 4×). Each sync sends the tile band before building any other layer.
- **Entry chunk**: the terrain guards and the image-header reader became lazy chunks (−3.4 kB). Clustering left `layers.ts`, whose net change is −0.4 kB after the new caches.

## Tests and benches

- **New tests:**
  - `src/app/map-clusters.test.ts` (the cluster tests moved there with the code, plus a fallback test and a focus test).
  - The focus-groups memo in `layers.test.ts`.
  - `createPositions` in `map-model.test.ts`.
  - Pipeline scheduling and the published clusters in `derived-pipeline.test.ts`.
  - Holding and lapsing the paths feed in `route-paths.test.ts`.
  - Tiles-first ordering in `map-controller.styles.test.ts`, checked to fail without the change.
- **Benches:**
  - `map-edit.bench.ts` gains `selectionChangeContinent`.
  - `derived.bench.ts` gains a `questState` case and probe normalisation.

## Measurements

The full record is `docs/measurements/rework-speed-d050.json`. Short cross-references were added to `map-m3.json`, `engine-m6.json`, `ui-refresh.json` (entry chunk) and `map-atlas.json`. The harness and raw runs are in `.cache/perf-fix/`.

## Open

- The derived baseline needs a calm-machine run, or your decision on it.
- Incremental route walk for the 10k pans.
- `main.tsx`: request the tile index before the workspace loads.
- `useMapRegionDocking` cost at startup (src/ui).
- MR-06: restate the first-view budget or change the opening view.
- The ui-refresh.md §10.3 ledger row still needs adding (docs/research isn't mine).
- The left-panel B+ build (D-051), which the relayed request was about, can now go ahead within the stop rule.

## D-050 UX, TR-03 and minors (built)

I've built all five items. Typecheck, lint, the full `pnpm test` (337 files, 4,847 passed, 25 skipped) and `pnpm build` with its dist audit all pass. Three things fell short:
- **TR-03:** the measured radius is 100 yd, not the 40 yd in the ruling.
- **UI-15:** 4 of 18 one-line rows still show fewer than 15 characters.
- **PR-16:** the fix needed a small change in a file outside my list, `src/map/leaflet/LeafletMapAdapter.ts`.

Nothing is committed.

**Entry chunk:** 247.50 kB. That is 0.68 kB more than after the speed fixes (246.82) and 1.0 kB under the 248.5 kB stop rule, which leaves less room for the B+ build.

## D-050 items

1. **No step selected (PR-13):** the panels and the map now show the state after the last step. The Available tab says "At the end of the route (after step 55)…". The Quest log reads "Quest log at the end of the route". Only an empty route shows no route state.
2. **Selection on open (UI-08):** new `src/app/selection-memory.ts`, started from `App.tsx`. On open, and whenever another project replaces the open one, it selects the step last selected in that project, else the last step. It saves the last selected step in one `localStorage` record per browser, covering at most 50 projects. The project schema is frozen, so it can't go in the project file.
   - **Knock-on:** the map now opens on the selected step (Orgrimmar at step 55), not on the whole-route fit. The first-view bytes and first-art figures (MR-06, MR-07) were measured on the old view and should be measured again.
3. **Level ceiling (PR-18):** quests more than 5 levels above the character are left off the quest-giver layer. The layer notes count them as an assumption, and the lists keep them. A quest opened in Details or found by search is still drawn.
4. **Berths (TR-03):** walks now end at a boarding point on walkable ground, and the step from there to the berth counts as part of the wait. The old rule, which priced the swim as walking, is gone.
   - **Why not 40 yd:** every boat berth is 13–15 yd from a walkable polygon. But at those points the navmesh snap still lands on the water under the deck, so no walk can end there. The nearest points a walk can actually end on are 12.5–95.2 yd from the nine berths, so 40 yd would miss five. With 100 yd, no walk from a town's flight point to its boat's boarding point needs to swim. Rut'theran is the exception: its boarding point is reached through 72 yd of water.
   - **Where it lives:** the table is in `src/rules/berths.ts`. The new `tests/berth-boarding.test.ts` recomputes it from the committed navmesh and taxi file and fails when they differ. So after the re-pin rebuild it will fail until the table is regenerated. TIME-7 in `docs/SIMULATION.md` is rewritten to match.

## Remaining review items

| Item | Result |
|---|---|
| PR-16 | Labels now keep their positions until the view changes, so a selection change or an edit no longer moves them. A newly focused pin under a label stays covered until the next pan or zoom. The test fails without the change. |
| UI-06 | The dark later band is now `#050403` (1.16:1, was 1.07). New `--frl-row-hover` token: in light, row hover is 1.09:1 on the panel and 1.10:1 on the band (was 1.04 on the band). Every row contrast pair still passes. Owner sheets: `.cache/ui-d050/shots/band-hover-{light,dark}-340.png`. |
| UI-15 | One-line quest rows drop the verb (the "!"/"?" mark says it; the tooltip and screen-reader name keep it). At 340 px, 12–23 characters of the name now show, against 4–15 before. 14 of 18 rows reach 15. The four short ones are three rows with an issue marker and the active row with its buttons; closing that gap would change the row layout, which is the owner's choice. |
| QA-20 | With no route state, a quest's row and Details name the giver's place in the character's start zone first, then its continent, plus "and N other zones". |
| TR-10 | **Cause:** the committed taxi file keeps only nodes on paid paths, and Vesprystus and the two Moonglade druid masters fly only on free paths. **Fix:** they're now drawn from the dataset, with a note naming them. The dataset gives the druid masters both factions and records no class restriction, so the note says so. |
| Audit nit | A partial tile set now gives one missing-files line, not one extra line per tile. |
| MD-10 | I deleted nothing. The stale copies are still there: `.cache/minimap-addendum/out/b4` (1.4 GB) and `b5` (1.5 GB), `.cache/map-ui-build/verify-MD` (360 MB), and two stale packs in `.cache/minimap-pack` beside the pinned one. |

## Changes outside my listed files
- `src/map/leaflet/LeafletMapAdapter.ts` and its labels test (PR-16): this was the only place to fix it.
- Tests I had to change to match the new behaviour:
  - Updated: `tests/derived-navigation.test.ts`, `tests/map-places.test.ts`, `tests/ui-tokens.test.ts`, `src/validate/facts.test.ts`.
  - New: `tests/berth-boarding.test.ts`.
- Four existing `App` test files now pass `selectOnOpen={false}`, because they test other behaviour from an empty selection. The selection on open has its own tests.

## Owed by other owners
- **`docs/UI.md`:** the token table (new band value and the row-hover token).
- **`docs/research/map-presentation.md`:**
  - §9: "all 63 matched" is wrong for the committed file (TR-10).
  - §13.2: labels are placed again only when the view changes.
- **`docs/ARCHITECTURE.md` §12.1:** "selection is never persisted" is no longer quite true.
- **`docs/DECISIONS.md`:** D-050 notes on the 100 yd radius and the per-browser selection memory.
- **`STATUS.md`:** an update.

Measurement scripts and screenshots are in `.cache/berths-d050/` and `.cache/ui-d050/`.

## Re-pin to 1.60.1.70124 (built)

The re-pin to 1.60.1.70124 is finished. Every client-derived dataset rebuilt byte-identical to the 70009 build. Only provenance records changed: manifests, NOTICEs, the minimap pack pointer, the build string in the three client tables and one hash in the tint file. MD-01 and G13 are cleared. `pnpm check` passes: 337 files, 4,872 tests passed, 1 skipped (was 25; the client tests now run). Nothing is committed.

## 1. Pins
`.build.info` shows `wow_classic_beta` 1.60.1.70124, build key `dd3dfc2881c407299f46c2aaf34c130b`. I changed four pins:
- `tools/terrain/build.json`;
- `CLIENT_PIN` in `tools/maps/lib/shared.ts`;
- `CLIENT_TABLES_PIN` in `tools/maps/lib/client-data/constants.ts`;
- `FOREVER_TEST_PIN` in `tools/casc/test-support.ts`.

The pin is also updated in the tool READMEs, `import.ts` usage and the six docs you named.

Kept at 70009 on purpose:
- **Layout blocks** (`LAYOUT_BUILD`): all 19 tables at 70124 carry the same layout hashes, which the reader checks on every read.
- **The DB2 rows file** `tools/maps/inputs/db2-rows-1.60.1.70009.json` (`DB2_BUILD`): it cites the 70009 CSVs by file, line and SHA-256. `import.ts --build 1.60.1.70124` plus `validate.ts --local` L4 show all 61 rows identical, so the placeholder is unchanged. Relabelling the rows would need 70124 CSVs (a download) or a new rows format. That's the architect's call; I recommend keeping them.
- **Cited values** in `src/` fixtures and research notes, which stay true citations.

## 2. What changed (70009 → 70124)
Before rebuilding I compared CKeys. All of these match:
- 16 of 16 DB2 tables with a recorded 70009 CKey;
- 13,332 navigation inputs;
- 1,732 terrain inputs;
- 1,796 minimap textures and 3 WDTs.

The painted-art input hashes, which cover the tiles' CKeys, also match.

| Dataset | Result |
|---|---|
| Navmesh | navRevision `aefbc78d…` unchanged, 113 of 113 identical |
| Census | identical; no new entries, so `census-reviewed.json` is unchanged |
| Terrain byproducts | 6 data files identical, input hashes equal |
| Client tables | same content apart from the build string: 65 nodes, 286 flights (143 pairs), 14 transports (29 stops), 54 zones, 30 LFG rows with the same tuning, 51 instance maps |
| Painted art | 5 images and all 60 `sources` identical; `--all` output equals `.cache/art-all` |
| Atlas | 792 tiles and the index identical; censuses and label hashes unchanged |
| Minimap | 6,647 tiles and the index identical; tiles tree `42b33cc8…` unchanged |
| New zones, maps, UiMaps, nodes | none (the same tables have the same CKeys) |

I couldn't diff the whole client: the 70009 build config is still on disk, but its encoding table has been purged. The root shows 2 more entries and the same 1,435,081 file IDs.

No committed decision or design assumption is affected. `src/rules/berths.ts` still matches (same nav revision; its test passes). Since no tile changed, the sheets in `.cache/map-ui-build/` and `.cache/minimap-addendum/` still show the look, and no before/after sheet was needed.

**Sizes against budgets (gzip-6):**

| Folder | Size | Budget |
|---|---:|---:|
| nav | 5.44 MB | 7 MB |
| minimap | 52.17 MB (+296 B) | 60 MB |
| atlas | 6.95 MB | 8 MB |
| art | 689.21 kB | 1 MB |
| terrain | 445.06 kB | 600 kB |
| client | 34.54 kB | 40 kB |
| tint | 4.33 kB | 8 kB |
| entry chunk | 247.50 kB | 250 kB, stop rule 248.5 kB |

## 3. Timings (wall; each build then its byte-for-byte check)
- `nav:extract` 1 min 50 s; `nav:check` 1 min 47 s (106 s on the rerun).
- `nav:validate` 3 s (56 checks); `--client` 37 s (62); `--partition` 2 min 8 s; `nav:review-draft` 5.5 s.
- `byproducts.ts` 12.4 s and 12.5 s.
- `client-tables.ts` 1.9 s and 1.8 s.
- `convert.ts` 21.8 s and 20.7 s; `--all` 34.2 s.
- `maps:tints` 1.8 s and 1.7 s.
- `atlas.ts` 2 min 15 s and 2 min 11 s.
- `minimap.ts --pack` 5 min 20 s; `--check --pack` 5 min 10 s.
- `import.ts --build` 1.8 s and 1.6 s; `--placeholder --check`, `make-db2-rows --check` and `make-layouts --check` under 1 s each.

I then ran every client check once more after all edits. All pass.

## 4. MD-01 and G13
- **MD-01:** `minimap.ts --pack` then `--check --pack` passed on the pinned client, and the `tool.remanifest` record is gone. `maps:validate` passes all 35 checks, MT included.
  - Tool tree `729fbc2b…` (61 files); tiles tree `42b33cc8…`.
  - Pack `minimap-tiles-42b33cc815cd-2bc7fa6b0071.tar`, 58,071,040 B, SHA-256 `2bc7fa6b0071101367f5c2f0bb5bdc316ec23a411af564688d81de0dd0db1da3`.
  - Tag `minimap-1.60.1.70124-42b33cc815cd-2bc7fa6b0071`.
- **G13:** the manifest records tool tree `0e5cb74e…` (64 files), which equals the checkout. It will go stale again if anyone edits the files the nav build loads (`src/geo`, parts of `src/domain`, `src/infra/data`).

## 5. Other checks
- The dist audit passes in plain mode (inside `pnpm check`) and in deploy mode. For `build:deploy` I set `MINIMAP_PACK_SOURCE` to the local pack so nothing was downloaded; it verified all 6,647 tiles.
- **Latent defect fixed:** `byproducts.ts` couldn't run at all since the rework commit. A comment in `tools/build/lib/audit.ts` contained `new URL('./x.worker.ts', …)`, which the tool-tree scanner reads as an import. I reworded the comment. The sturdier fix, making the scanner skip comments, would move the nav tool tree and need another `nav:check`, so I left it as a follow-up.

## 6. Edits outside my files
- `casc.client.test.ts` now asserts the 70124 counts. Its 70009 CSV comparison runs only after checking that the ten tables keep their 70009 CKeys.
- Four tool tests now follow the pin constant: `client-tables.test.ts`, `scripts.test.ts`, `art-build.test.ts` and `inputs.test.ts`.
- Four tests outside tools assert the committed build, so I changed the literal to 70124: `src/infra/maps/art-manifest.test.ts`, `client-tables.test.ts`, `terrain.test.ts` and `tests/map-places.test.ts`.
- `THIRD_PARTY_NOTICES.md` had two lines stating the build of the shipped minimap and client-table data; I corrected them.

## 7. What STATUS.md needs
- The Build / test status table: client gates pass on 70124; tests 4,872 passed with 1 skipped; nav 56/62/60 checks; `maps:validate` MT passes; entry 247.50 kB.
- Remove the "client moved off the pin" known bug.
- Replace the minimap gate record with the one in §4.
- Add the stopgap pack `minimap-tiles-42b33cc815cd-2a05fc565d2d.tar` to the MD-10 stale list.
- Local environment notes: client observed at 1.60.1.70124 on 2026-09-30.
- Mark "Exact next tasks" 1.1 done.

## 8. What DECISIONS.md needs
- A D-050 item 1 status line: done, with a link to the review.
- The ruling on keeping the DB2 rows cited at 70009.
- A D-013 note: the local build is now 70124.
- A D-049 note that the §23.4 gate passed.
- `docs/measurements/nav-m3b.json` still names 70009 for the client; that file belongs to the measurements owner.

The full diff report is `docs\reviews\repin-70124.md`. The before snapshot, scripts and logs are in `.cache\repin\`.

## Readability study (input to D-051)

I measured why WoWF-QRP's left panel reads better; the study is in `.cache\readability\study.md`. No app code changed. The full `pnpm test` passed (334 files, 4,814 tests, 25 skipped), and typecheck and lint pass. I rebuilt production into `.cache/readability/dist` for this; its entry chunk is 239.28 kB gzip.

In short: our text is higher-contrast than theirs everywhere, and our right-hand numbers line up better. What makes ours harder to read is that each row has about twice as many separate parts. The loudest of them are the chip and the marks, not the words. Titles are cut off and issue text is unreadable. There is less space between rows.

**How I measured it.** I screenshotted and measured all 55 rows of the sample route, as the app opens, at 1366 × 768 in both themes. Counts were identical at DPR 1, 1.5 and 2. For WoWF-QRP I used only the saved screenshots and their saved stylesheet (not visited), compared at the same scale (1.5 device px per CSS px) as ours. As a control, I laid out our 55 steps with WoWF-QRP's own row stylesheet, locally and without their web font (so in Segoe UI). That separates their layout from their typeface.

## Ranked causes

**1. Twice as many parts per row, packed tighter.**
- Ours has a median of 17 visible parts per row (15-19 on quest rows); theirs has 9 (8-9). Both were counted by the same rule.
- Row 7, for example, has: number, mark, verb, name, issue shape and count, chip pips, chip level, issue icon, issue words, three icons, XP, ≈, ↑, level and ≈.
- Ours has about 1.7 times their ink per unit of area: 1,757 in a 40 px row against 1,208 in 46 px.
- The number of distinct text styles is similar (median 8 against 7), so it is the extra parts that differ, not extra styles.

**2. The loudest things in our rows are not the words.**

| Part | Ours | WoWF-QRP |
|---|---|---|
| Title | 17.1:1 | 14.0:1 |
| Secondary text | 6.4:1 | 5.6:1 |
| Row buttons | 6.4:1, the same as line 2's words | 2.1:1 (wh↗ and opt at 55 % opacity), × at 5.0:1 |
| Difficulty chip | black well at 18.3:1 | none |

- Theirs steps down in three clear tiers; ours has no tiers.
- The chip alone holds 31 % of each row's ink, the same as the whole title line (31 %). All our words together hold 42 %; theirs hold 62 %.
- A blur test (`crop-5-squint.png`) shows a column of black chips and yellow discs leading in ours, and the title lines leading in theirs.
- In dark theme the chip's well almost vanishes (1.06:1), but its yellow digit (17.5:1) is still brighter than the title (14.4:1).

**3. Titles are cut off, in smaller type.**
- Ours is 13 px Segoe UI: the name is set at weight 500 but Chrome draws it as Semibold (600), and the verb is muted. Its lowercase letters are 6.7 px tall, at 6.04 px per character.
- Theirs is 14 px Alegreya Sans in one weight and one colour. Its lowercase letters are 7.3 px tall, at 5.68 px per character, so it is both larger and narrower.
- On line 1, the "2/2" chain position (24 px) and the issue marker (26 px) take up to 50 px of our 208 px, leaving 184 or 158 px for the title.
- 13 of our 55 titles are cut (12 of 54 quest rows, 7 of them turn-ins). A cut title shows 15-24 characters of names that are 20-30 long.
- Their title column is only 148 px wide, but titles wrap, so none is cut. In the control none of our titles is cut, and 29 of 54 wrap to two lines in Segoe UI.
- With their web font about 18 would wrap. This is an estimate: I scaled word widths by 0.872, measured on three strings from their saved screenshot.
- Removing the chain and issue marker from line 1 would let 8 of the 12 cut titles fit; 4 would still be cut.

**4. Issue text is unreadable, and it hides the place.**
- 22 of 55 rows carry an issue, and all 22 show only 9-13 characters, such as "No step finis…" and "Needs Cuttin…". They get 73-80 px and need 146-423 px.
- When an issue shows, it replaces "NPC · zone", and the severity shape is drawn twice (on line 1 and line 2).
- WoWF-QRP writes issues in full and wraps them; in the control, 21 of our 22 take two lines. Their light-theme warning colours are faint, though (2.9:1 and 1.9:1).
- With the row icons moved off line 2, 15 of 22 would fit; with the chip moved too, 17 of 22.

**5. Less space between rows, plus a rule on every row.**

| | Ours | WoWF-QRP |
|---|---|---|
| Row height | 40 px, fixed | 46 px |
| Clear space between rows | 8.0 px, plus a 1 px rule | 11.3-12.7 px, no rule |
| Title to the line below | 4.0 px | 6.7 px |

Our chip sits 2 px under the verb's baseline, so no pixel row is clear across the text column between the two lines.

**6. Constant texture in the right-hand column.** 28 rows show a muted "0" XP, and there are 80 "≈" markers with dotted underlines (1.45 per row). WoWF-QRP shows XP only when it is not zero.

**Not causes:**
- Alignment favours us: all our numbers end at the same x, while theirs jump 34 px on rows without the wh↗ button.
- Our "NPC · zone" line always fits (0 of 32 cut).
- Contrast is higher in ours.
- "Accept" and "Turn in" take the same width.

## What copying it would cost

In their layout only 7 of our steps fit in the 505 px list, against 12 now (their rows average 64 px, 46-83 px). The control shows their layout alone gives the calm look and whole titles, even without their web font; losing density is the price.

The causes map onto the four options in D-050 item 7:

| Option in D-050 item 7 | Causes it addresses |
|---|---|
| Titles that wrap | 3 |
| Larger text and more spacing | 3 and 5 |
| Fewer inline parts | 1, 2, 4 and 6: the chip, the chain, the second issue shape, zeros and markers |
| Row buttons clear of the text | 2 and 4 |

## Limits

- WoWF-QRP was measured only from saved light-theme screenshots of their live site and from their saved stylesheet.
- The web-font width estimate rests on three strings.
- Everything was measured on this machine (Windows, Segoe UI, headless Chrome, 1366 × 768); your display is unknown.
- The two sample routes differ (our Durotar, their Mulgore).
- Readability is your judgement; these are measurable signs of it, not proof of a preference.

Files are in `.cache\readability\`. The crops show each point side by side at the same scale:
- `study.md`
- `crop-1-typography.png` – type size and letter height
- `crop-2-titles.png` – cut titles against wrapped ones
- `crop-3-parts.png` – numbered parts on the same two steps
- `crop-4-space.png` – clear space between rows
- `crop-5-squint.png` – the blur test
- `crop-6-controls.png` – row buttons and chips
- `crop-7-issues.png` – issue text
- `crop-8-scan.png` – column alignment
- `crop-9-transplant.png` – the control
- `shots/`
- `measure.json`, `summary.json`, `pixels.json`, `crops.json`, `transplant.json`, `transplant-parts.json`
- scripts: `shoot.mjs`, `measure-page.js`, `analyse.mjs`, `pixels.py`, `crops.py`, `transplant.mjs`, `transplant-parts.mjs`

## Readability mocks (input to D-051)

I built three static mocks of the left panel (A, B and C) plus a control, and put them beside WoWF-QRP's saved panels in both themes. My recommendation is **B**. No app code changed. `pnpm typecheck` and `pnpm lint` pass, and the full `pnpm test` passes: 335 files, 4,824 tests, 25 skipped. That is one file and 10 tests more than the study saw; someone else changed `src/map/layers.ts` during the session.

The mocks use our own row markup, glyphs, CSS and tokens, captured from the production build in `.cache/readability/dist`. They show the sample route's 55 real steps. The control mock (today's rows, unchanged) matches the real app panel except for 278 of 527,850 pixels, which is anti-aliasing. WoWF-QRP appears only through its saved screenshots; I did not visit it.

**Images**
- Owner sheet: `.cache/readability/owner-sheet.jpg`. It has a light band and a dark band, each with the columns WoWF-QRP, A, B, C and today, with step 8 selected at 1.5 device px per CSS px.
- Per-variant crops: `.cache/readability/variant-A-crop.png`, `variant-B-crop.png` and `variant-C-crop.png`. The B and A crops include a hover state.
- Mock pages: `.cache/readability/mocks/variant-{a,b,c,t}.html`. They open in a browser, with `?theme=dark`, `?steps=10000` and working keys.

**The variants**
- **A (faithful):** titles wrap at 14 px in one ink. The pips move under the disc, in ink, and the disc keeps the difficulty colour. The sub-line reads "Lv n · NPC · zone". The issue gets its own line, in full. XP shows only when it is not zero. The buttons sit in a quiet right-hand column.
- **B (balanced):** fixed 44 px rows. The chip is replaced by "Lv n" and the pips under the disc. The buttons show only on hover, on the selected row and on the keyboard's active row. The chain position shows only when it fits beside the title, and the issue shape is drawn once.
- **C (minimal change):** today's rows at 44 px, with no rule between rows and 14 px titles. Line 1 no longer repeats the issue shape, and the chain position is hidden first when space runs out.

**Measured on the sample route at 1366 × 768**

| | Today | C | B | A |
|---|---|---|---|---|
| Steps fully in view (505 px list) | 12 | 11 | 11 | 7 |
| Quest titles cut (of 54) | 13 | 4 | 4 | 0 (37 take 2 lines, 1 takes 3) |
| Issue words cut (of 22) | 22 | 22 | 7 | 0 |
| NPC names cut on the second line | 24 of 32 | 24 of 32 | 0 of 32 | 29 of 54 |
| Parts per row, median (the study's rule) | 17 | 16 | **13** | 18 |
| Row height | 40 px | 44 px | 44 px | 47–119 px (mean 74.7) |

Two corrections to the study:
- Today cuts 13 quest titles, not 12. Step 5 overflows by less than 1 px and does show an ellipsis; the study's whole-pixel test missed it.
- The NPC name *is* cut in 24 of 32 rows today (for example "Zureet…"). The study's "0 of 32" measured the container around the name, which never overflows because the name shrinks inside it.

**Contrast (computed on the rendered colours, over the resting row, the later band, hover and selection)**
- All text reaches at least 4.5:1 and all graphics at least 3:1 in both themes. The lowest text pair is 4.63:1 (dark line 2 on the selected row), the same as today.
- **Today and C:** the buttons are 6.4:1, the same as line 2's words. The chip well is 18.3:1 in light. In dark the well sinks to 1.06:1 while its digit stays at 17.5:1.
- **B:** there is no chip and no buttons at rest. Buttons are 7.4:1 on hover and 7.2:1 on the selected row.
- **A:** the resting buttons are 3.3–3.9:1 in light and 4.2–4.5:1 in dark. The light value (#857e73) is a new colour, not in `tokens.css`; dark reuses `--frl-border-strong`.
- **A and B:** lit pips are 8.6:1 against the row, and 6.1:1 (dark 5.75:1) against unlit pips. Issue words are 5.1–6.3:1, against WoWF-QRP's 1.9–2.9:1.

**Keyboard and screen reader**
- All four mocks keep the same listbox model and the same accessible names (captured verbatim from our rows), so a screen reader hears identical rows. This is reasoned from the ARIA markup; there was no NVDA run.
- I pressed ↓, ↓, PageDown, PageDown, PageUp, End and Home in each mock. The active row always ended fully in view.
- PageDown moves 11 rows today, 10 in B and C, and 5 in A, where paging goes by height.
- B's buttons remain pointer-only, as today; the keys and the toolbar are the keyboard path. On touch, the buttons appear only on the selected row.
- A's rows grow when a user overrides text spacing (WCAG 1.4.12). B and C clip at their fixed height, as today does.

**Virtualisation cost**
- **B and C:** the fixed row height changes from 40 to 44 px, and nothing else.
- **A:** rows need variable heights. The mock estimates each height from canvas text widths, then corrects it when the row is drawn, keeping the first visible row still. The estimate exactly matched the drawn heights on all 55 rows and on 10,000 rows.
- **A at 10,000 steps, 1× / 4× CPU:**
  - Estimating every height: 26 / 127 ms, or 115 / 660 ms when no word widths can be reused. That cost hits load, panel resize and font changes, so the build would need to spread it over several frames or move it to a worker.
  - One wheel step: 0.9 / 5.8 ms, against 1.4 / 8.0 for B and 1.8 / 9.8 today.
  - A random jump: 9.9 / 70 ms, against 9.8 / 68 for B and 13.8 / 93 today.
  - The End key: 7.3 / 46 ms, against 4.1 / 26 for B.
  - Measuring every row in the page instead would take 4.8 / 28 s, which rules it out.
- **A's build would also need:**
  - rows no longer strictly size-contained;
  - a re-measure whenever a row's content changes;
  - drag, paging and reveal to use row offsets instead of a fixed height;
  - the estimator on the entry path, which I have not measured and which counts against the 248.5 kB stop rule.
- The mock builds rows as plain strings rather than through React, and ran on one machine, so these timings are lower bounds.

**Recommendation: build B.** It gives the lowest part count (13 against 17), removes the loudest part (the chip), and clears the buttons at rest. It cuts title truncation from 13 to 4, issue truncation from 22 to 7, and NPC truncation from 24 to 0, for one step fewer in view and a trivial change to the virtual list.

A gives whole titles and issues and the calmest look, but shows 7 steps instead of 12, cuts 29 NPC names and costs the most to build. C leaves the chip and every issue cut. If you want whole issue words, A's separate issue line could later be tried on B's selected row.

This is your call once you have seen the sheet. The mock pages say "Lv 2" for the quest level; that wording is open to your choice.

## Readability critic (input to D-051)

**Mock critique: left-panel readability (D-050 item 7)**

Four things on the sheet would have misled you, and I've fixed all four. With the corrections, B no longer looks like a clear win. At rest it is the best row, but on the row you are working on it cuts every issue, as today does. I changed files under `.cache/readability/` only. `pnpm typecheck` and `pnpm lint` pass, and the full `pnpm test` passes: 335 files, 4,825 tests, 25 skipped. The first full run failed once: the path-hygiene test in `tests/architecture.test.ts` took 8.3 s against its 5 s limit. It passed on its own and on the rerun. Someone else is changing `src` at the same time (new untracked `src/app/map-clusters.ts`).

**What misled, and the fix**

1. **Ours looked sharper than WoWF-QRP for a technical reason.** WoWF-QRP's saved panels are 1× captures enlarged 1.5× (`ui-refresh/friend/mock/annotate.mjs`). Ours were real 1.5× renders. The sheet and `shoot.mjs` said "no scaling". Fix: I took 1× shots of every panel, today's real app included, and enlarged them 1.5× the same way. The counts still come from 1.5×.
2. **B's counts held only for rows at rest.** When B's buttons show (the selected, hovered or keyboard-active row):
   - issue words cut: **22 of 22**, not 7;
   - NPC names cut: **18 of 32**, not 0.

   A second check, which also catches words hidden by an enclosing box, gave the same numbers. The rework's final verification found that for carried turn-ins (D-040) that line is the only visible cue. So B hides it on exactly the row you are reading. B's line 2 also changes its words as the pointer passes over it.
3. **Two losses were missing from the sheet:**
   - B and C hide the chain position ("2/2") on 12 of 38 rows.
   - B, C and today show no NPC or zone at all on the 22 issue rows (32 of 54 shown). UI-01's gate asks for the zone on every quest row at 340 px, so only A meets it (54 of 54). Today and C also cut the zone on 2 rows.
4. **A's selected row was below the fold.** A now scrolls 35 px to show step 8, as selecting it would. It still shows 7 steps in view (+1 partly), and the key results are unchanged.

I also added WoWF-QRP's own figures to its column: a median of 9 parts per row, with a caveat. The counting rule scores our "Gornek · Durotar" as 3 parts and their "NPC · zone x, y" as 1. A's 18 includes its 3 always-visible buttons and two ≈ markers.

**What checked out**

- Every other count, contrast pair and key result came out the same on the rerun.
- The control mock matches the real app except for anti-aliasing: 396 of 527,850 pixels at 1.5× (you had 278), and 125 of 234,600 at 1×.
- Contrast:
  - The lowest text pair is 4.63:1.
  - A's resting buttons are 3.26:1 on the later band, which passes the 3:1 rule only narrowly. Their colour, #857e73, would need a new token and a pair in `ui-tokens.test.ts`.
  - The disc's outline drops to 1.01–1.35:1 in dark, but the disc fill carries the shape (UI.md §9 allows either), the same as today.
- In A and B the pips give difficulty a cue other than colour.

**Rules the mock report did not cover**

- **Entry chunk:** it is at 248.98 kB, already over the 248.5 kB stop rule. None of the variants can be built until clustering moves into the derived publish (follow-up item 3). A's height estimator adds code to the entry; B is mostly CSS.
- **A at 10,000 steps:** estimating every height takes 127 ms at 4× CPU, on load and on every panel resize. That is a long task, so it would have to be split or moved to a worker. It also lands on the list while the speed regressions (item 2) are still open.
- **Text spacing (WCAG 1.4.12):** B and C clip at their fixed height, as today does; A's rows grow.

**Recommendation**

B is still the right basis for performance and for the entry chunk, but not as mocked. It needs one amendment: let the **active row grow** to show its issue on its own line, in full, plus the NPC and zone. Every other row stays at 44 px, so the virtual list's arithmetic stays simple: row positions are index × 44, plus one fixed extra below the active row. This is not mocked or measured yet; mock it before building. You also need to decide whether the chain position may be hidden (12 of 38 rows).

Put A beside it when you look. A is the only variant that shows the zone on every row and keeps every title and issue whole, and it looks the most like WoWF-QRP. The cost is 7 steps in view against 11, and more work on the list. If you prefer A, build it after items 2 and 3. Either way it is your call.

**Files**

Everything is under `.cache\readability\`:
- Owner sheet: `owner-sheet.jpg`
- Per-variant crops: `variant-A-crop.png`, `variant-B-crop.png`, `variant-C-crop.png`
- Edited scripts, all in `mocks\`:
  - `src\runtime.js`: selecting a step now scrolls it into view;
  - `src\measure-mock.js`: measures each row with its buttons showing, and the NPC and zone separately;
  - `shoot.mjs`: adds the 1× shots and the new counts;
  - `sheets.py`: builds the sheet and crops from the 1× shots, with the extra lines.
- Regenerated: `mocks\variant-{a,b,c,t}.html`, `mocks\results.json`, `mocks\shots\*-1x.png`
- `mocks\perf.json` is unchanged: the timing pages open with no step selected, so the new scrolling never runs there.
