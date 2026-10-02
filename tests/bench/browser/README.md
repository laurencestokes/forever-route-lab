# Browser measurement harness

The map's speed in a real browser, for D-050 item 5 and the rework follow-up (findings F-03, F-04,
F-05 and F-10 in [docs/reviews/rework-followup.md](../../../docs/reviews/rework-followup.md)). It
replaces the harness the earlier measurements used, which lived outside the repository
(`docs/measurements/map-atlas.json` `atl9mm8`, `docs/measurements/rework-speed-d050.json`), and
measures the same things the same way where those records say how, and says where it differs.

It drives production builds (`pnpm build`) served by `vite preview`, in Playwright's Chromium,
through real input (CDP mouse and keyboard events) and the app's own controls. Nothing in the app
is changed: the only code in the page is an observer script, [probe.ts](probe.ts).

## What it measures

| Figure | Definition |
|---|---|
| **Selection to pins painted** (`selection.toLastPaintMs`) | A click on a route row that is on screen, to the frame that draws the last map work it caused (`paintedAt`, below). Median and p90 of 14 clicks. |
| Selection to first paint (`selection.toFirstPaintMs`) | The same, for the first `frl:map:sync`: the selection itself on the map. |
| **Edit to pins painted** (`edit.toLastPaintMs`) | Alt+↓ then Alt+↑, alternately, on a selected step in the focused route list, to the frame that draws the last map work. Median and p90 of 12 edits. |
| `lastMapCallMs`, `derivedMs`, `maxLongTaskMs` | When the last map work ended; the app's own `frl:derived` measures in the window; the longest long task. |
| **Pans at 4×** (`pans`) | Five drags of about 0.5 s and one long drag of about 3 s at Durotar's zone fit on the 10,000-step project, each followed by its settle: the frame intervals' p50 to p99 and maximum, intervals over 16.7 and 33.4 ms, long tasks (count, over 50 ms, longest) and the app's `frl:map:sync` and `frl:map:update-paths` times. |
| **First art** (`firstArtAfterChunkMs`) | A first visit, cold cache, 50 Mbit/s down, 10 up, 20 ms round trip: the first map image (an atlas or minimap tile, or a painted art image before the atlas) loaded, after the map's Leaflet chunk loaded (both `responseEnd`). Also `firstArtEndMs` and `firstTileRequestMs` from navigation start, and `workspaceReadyMs` (the app's `frl:workspace-ready` mark). |
| **First-view bytes** (`firstViewBytes`) | The same first visit, read once the view has settled and before anything touches the map: the tiles at the view's own level (the finest level requested) plus the tile index, as body bytes (`encodedBodySize`, as the earlier records); `firstViewTransferBytes` adds the headers. `byLevel` has every level, the underlay included, and `allMapImageBytes` every map image. Before the atlas, the painted art images (`artImages`; the relief behind them is `reliefImages`). |

**The frame that draws the work** (`paintedAt` in [cases.ts](cases.ts)): map work done inside an
animation-frame callback (a canvas redraw, the labels) is drawn by that frame, so the end of the
work; work done in a task is drawn by the next frame, so the moment that frame's first callback ran.
Both leave out the frame's own style, layout and paint, the same in every build. The probe tells the
two apart by wrapping `requestAnimationFrame` and `performance.measure`; it records frames with a
plain rAF loop that changes nothing on screen, so a frame costs what it would without it.

**Quiet period**: an interaction's work is over when no `frl:map:*` or `frl:derived` measure has
ended for 500 ms at 1× or 1,100 ms at 4× (`quietPolicy`). A click that caused no map work is left
out of the figures and fails the run (F-10).

**CPU throttling**: `Emulation.setCPUThrottlingRate` on the page's CDP session. Interactions load at
1× and are throttled for the measurement only; first art is throttled from the first byte.

## The windows

- **The sample project** (a first visit's): "Go to zone" Durotar, the route list scrolled to its top;
  the clicks go to the rows wholly inside the list, every other row then the ones between (0, 2, 4,
  …, 1, 3, …), after one unmeasured click; the edits move the sixth visible row's step.
- **The 10,000-step project**: imported through the top bar's Import dialog into the sample's page,
  every walking leg computed before anything is measured; "Go to zone" Stranglethorn Vale, the list
  scrolled so that step 5,001 is its first row (mid-route, as UR.2b's step 5,001); clicks and edits
  as above. The app opens at the selected step since D-050 item 2, so the list is placed explicitly
  in every build (F-10).
- **Pans**: the 10,000-step project, "Go to zone" Durotar, then the drags at 4×.

**Builds with B+** (D-051): a click makes its row the active row, which grows by `--frl-row-grow`
(32 px) and moves every row below it down by as much. The clicks therefore go only to the rows that
stay wholly in view with that much room below them (`rowsInView`; usually one row fewer than are
in view), and each row is found again on screen before its click. Builds without the token ask for no
room, so their rows are chosen as before. `scrollListTo` adds the active row's extra when the active
row is above the step it scrolls to (`scrollTopForStep`): rows are placed at `index × 44` and moved
by a CSS transform, which `offsetTop` leaves out.

**Reduced motion**: under `prefers-reduced-motion: reduce`, base.css gives every element a 0.01 ms
transition, so a row's new height or shift lands a frame after the key or click that caused it.
The harness runs without reduced motion; a script that reads geometry under it should wait a frame
first.

Every page: 1366 × 768 CSS px at a device scale of 1.5, the painted map style (the Map layers
record's `style`, set before the app loads; builds before the atlas ignore it). The minimap style
needs the minimap tile pack, which is not in git (D-049 O14): measure it with `--style minimap` on a
machine that has the pack (`pnpm maps:minimap:fetch` before `pnpm build`); `--style app` leaves the
app's own default.

## Differences from the earlier harness

- **Edits** use the route list's own Alt+↓ and Alt+↑ instead of the step toolbar's Move buttons:
  builds before the UI refresh (95e84cc) have no toolbar, and both run the same action
  (`moveSteps`). The time runs from the `keydown`.
- **Selections** click rows the harness has put on screen (the list scrolled to a fixed step in
  every build), not rows by index: since D-050 item 2 the app opens at the selected step, and the
  earlier harness's clicks then landed on rows that were not there (F-10). A click with no map work
  fails the run.
- **The frame**: the frame that draws the work is found from the work's own measure (inside a frame
  callback or not, `paintedAt`), with a recorder that adds nothing to a frame. An earlier version of
  this harness marked each frame's rendering with a resized element; that cost about 3 ms per frame
  (12 ms at 4×) on a software-rendered machine and was dropped.
- **Pans and windows** are this harness's own (the earlier records name five drags and a long drag
  at the zone band, not their paths): compare pans only between builds measured by this harness.

## The 10,000-step project

[make-project.ts](make-project.ts) writes it: the benches' realistic route
(`buildRealisticRoute` in [../bench-support.ts](../bench-support.ts): an Orc Warrior's quests in
guide order, repaired with the validator, padded with travel waypoints to 10,000 steps) inside the
committed sample project, with the benches' character. That is the project of UR.2b and of the
earlier browser measurements (620 quests: 620 accepts, 711 completes, 620 turn-ins, 7,987 travels,
62 notes). It is deterministic; its SHA-256 is recorded with every run.

```bash
pnpm exec tsx tests/bench/browser/make-project.ts   # .cache/bench/browser/project-10000.frl.json
```

## Running it

Playwright is not a dependency of the project yet (Milestone 9 adds it). The harness loads
`FRL_PLAYWRIGHT` (a `playwright` package folder), else `playwright` or `playwright-core` from this
repository, else the global npm folder; and launches Playwright's own Chromium, or `FRL_CHROMIUM`
(an executable) when the installed browsers belong to another Playwright version.

```bash
# One tree, every part, five rounds (builds it, serves a copy of its dist/ with vite preview).
pnpm exec tsx tests/bench/browser/run.ts --tree cur=.

# An interleaved A/B: round r takes the trees in an order rotated by r; ratios are against the first.
git worktree add --detach <dir>/95e84cc 95e84cc && (cd <dir>/95e84cc && pnpm install --frozen-lockfile)
git worktree add --detach <dir>/eff4341 eff4341 && (cd <dir>/eff4341 && pnpm install --frozen-lockfile)
pnpm exec tsx tests/bench/browser/run.ts --tree pre=<dir>/95e84cc --tree main=<dir>/eff4341 --tree cur=. --rounds 5
```

Each worktree needs its own `pnpm install --frozen-lockfile`; never link one `node_modules` into
another. Options: `--rounds N`, `--parts first-view,sample,ten-k,pans`, `--throttles 1,4`,
`--sel 14`, `--edits 12`, `--style painted|minimap|app`, `--no-build` (serve the tree's existing
`dist/`), `--base <label>`, `--project <file>`, `--out <dir>` (default
`.cache/bench/browser/<time>/`).

**Output** (in `--out`): `meta.json` (machine, browser, Playwright, the builds with their commit, a
hash of their uncommitted changes and their entry chunk), one `r<round>-<part>-<label>.json` per
session (every sample), and `summary.json`: per tree, each figure's median over the rounds with its
minimum, maximum and the per-round values, and each tree's ratio of medians to the base tree.
`FRL_BENCH_TRACE=1` adds every interaction's measures, long tasks and frames to the session files.
[table.ts](table.ts) prints a summary as a Markdown table (`pnpm exec tsx tests/bench/browser/table.ts
<out>/summary.json [--filter toLastPaintMs] [--base <label>]`).

[harness.test.ts](harness.test.ts) checks the pure parts in `pnpm test` (the frame that draws the
work, the click order, the rows clicked and the list placed under B+, the frame statistics, the
first view's bytes, the statistics); the browser side is checked by running the harness, which fails
on a click without map work.

## Finding the cause

- [profile.ts](profile.ts): the selection or edit case under the CDP Profiler, on an unminified
  build (`pnpm exec vite build --minify false --outDir <dir>`); writes the `.cpuprofile` and the
  functions with the most self and inclusive time.
- [timeline.ts](timeline.ts): a few interactions' main-thread timelines from the profile (which
  function, or idle, ran when), with the app's measures and the frames timed from the input; the
  profile is aligned on its first busy sample, the input's dispatch.

## Reading the numbers

The absolute figures belong to the machine they were taken on. In a cloud container without a GPU
(`docs/measurements/followup-cloud.json`), Chromium composites and rasterises in software, so
frames, paints and first art take several times as long as on the owner's machine, although the
CPU probe (a 2e7 square-root loop in the page, recorded per session) took about the same there:
37-42 ms at 1×, against 38-40 ms on the owner's desktop. Only ratios between builds measured
interleaved on one machine compare. The interactions are measured on a warm page, one at a time;
other processes on the machine show up as spread, which the rounds and the medians are for.

## The left panel's readability

[readability.ts](readability.ts) measures the route list's readability in a built app, for D-051 (layout
"B+") with the definitions of the readability study, mocks and critic in
[docs/reviews/rework-followup.md](../../../docs/reviews/rework-followup.md). It opens the sample
project as a first visit does, at 1366 × 768 and a device scale of 1.5, light theme, and reads every
step row:

- **at rest** (not hovered, selected or active): quest titles cut, issue words cut, NPC names and zones
  cut, quest rows that show no place, chain positions hidden;
- **hovered**, one row at a time: issue words and NPC names cut while the row's buttons show;
- **active**, each row clicked in turn: whether its issue's words, NPC name and zone are whole, whether
  a carried turn-in's cue (D-040: its issue's words) shows and is whole, whether its chain position
  shows, and its height;
- the steps wholly in view (as the app opens, at the top of the list, and with step 8 active), whether
  the active row ends in view after ↓, ↓, PageDown, PageDown, PageUp, End and Home, and whether every
  row's name and title tooltip carry its chain position and level.

**Cut** is measured on the glyphs, not the box: a text is cut when a Range over it reaches past the
box that clips it (every clipping box from the text up to its row) by more than 0.02 px across or 1 px
up or down ([readability-summary.ts](readability-summary.ts) has the definitions and the counts, and
[readability-page.ts](readability-page.ts) the page side).

`--variant bplus` injects a mock of B+ ([bplus-mock.ts](bplus-mock.ts): a stylesheet and a small page
script, no product code) into the same build, so B+ is measured on the same data and in the same font
as today's panel. **B+ is built since 2026-10-02**, so `--variant today` on a current build measures
B+ itself; the mock only makes sense on a build from before it (for example `ff73222`), and on a
current build it would be applied twice.

**The font decides the figures.** D-051's figures were taken in Segoe UI on Windows. `--font
selawik` draws the UI in Selawik, Microsoft's open font with Segoe UI's metrics, installed for
measurement only (never committed; for example from the 1.01 release of
<https://github.com/microsoft/Selawik>, into `~/.fonts`), with weight 500 drawn Semibold as the study saw
Chrome draw Segoe UI; `--font system` (the default) keeps the app's own font stack, which is Segoe UI
on Windows and DejaVu Sans on a bare Linux container. Every result records the font Chromium used
(`fonts`); quote it with every figure. `--gutter N` takes N px from the right of the rows, as a classic
scroll bar would: Playwright's headless Chromium draws none, and the study's line 1 was 208 px where
this harness's is 218 px.

```bash
pnpm build
pnpm exec tsx tests/bench/browser/readability.ts --variant today,bplus [--font system|selawik] \
  [--theme light|dark] [--gutter 0] [--dpr 1.5] [--quick] [--no-shots] [--dist dist] [--out <dir>]
```

Output (default `.cache/readability/<time>/`): `readability-<variant>.json` (the counts and every row's
record), `table.md` (the counts side by side, also printed), and screenshots of the left panel:
`<variant>-open.png` (as the app opens), `-rest.png` (the top of the list, the active row out of view),
`-active-8.png`, `-hover.png` (step 11 hovered, step 8 active) and `-active-45.png` (a carried turn-in
active).
