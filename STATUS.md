# STATUS

> The single source of truth for where this project is. Read this first, then
> [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) and [docs/DECISIONS.md](docs/DECISIONS.md).
> Nothing here depends on any previous AI conversation.

Last updated: 2026-09-26

## Current milestone

**Milestones 4 (editor and storage) and 5 (RXP)**, complete. **Milestone 3b part 1** (game-data
reader, navmesh build and gates, map art and terrain layers, pure `src/nav` runtime), complete.
Next: **Milestone 3b part 2** (worker, travel model, map rendering of paths/art/terrain, review), then
**Milestone 6** (rules, simulation and validation).

## Completed work

- Repository initialised on `main` with remote `origin` = https://github.com/laurencestokes/forever-route-lab
  (nothing pushed yet). Licence GPL-3.0-or-later (`LICENSE`).
- Milestone 0 research, written into the repository:
  - [docs/DATA_PROVENANCE.md](docs/DATA_PROVENANCE.md), [docs/research/questiedb-schema.md](docs/research/questiedb-schema.md):
    QuestieDB Forever schema, extraction design, provenance and licence finding.
  - [docs/MAPS.md](docs/MAPS.md), [docs/research/coordinates.md](docs/research/coordinates.md):
    map sources, extraction, coordinate transforms with worked examples.
  - [docs/RXP.md](docs/RXP.md), [docs/research/rxp-samples/](docs/research/rxp-samples/):
    RestedXP custom-guide behaviour spec and self-authored fixtures.
  - [docs/SIMULATION.md](docs/SIMULATION.md): XP, difficulty, time and validation rules as a
    testable spec.
  - [docs/research/forever-game-rules.md](docs/research/forever-game-rules.md): what Forever
    changes, with confidence levels.
  - [docs/research/local-context.md](docs/research/local-context.md): reusable patterns from the
    owner's related repositories.
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) revision 2, after an independent four-lens critique
  ([docs/reviews/review-m0-architecture.md](docs/reviews/review-m0-architecture.md): 68 findings,
  all blockers and majors resolved).
- Decisions D-001 to D-027 in [docs/DECISIONS.md](docs/DECISIONS.md), with Status lines on superseded entries.
- **Milestone 1 (Foundation):**
  - Toolchain: pnpm, Vite 8, React 19.3, TypeScript 6.0 with three strict configs, ESLint 10
    (including `no-bitwise`) and Vitest 5.
  - Canonical domain types and pure route operations (`src/domain`); race/class masks without
    bitwise operators; the quest difficulty table (`src/rules`).
  - zod project schema (type-equal to `ProjectV1`), deterministic import/export and a
    migration registry (`src/project`).
  - Framework-agnostic editor store with undo/redo, coalescing, selection, a clipboard and
    edit-lock reasons (`src/app`).
  - Original UI kit and three-panel shell running on clearly labelled placeholder data
    (`src/ui`, `docs/UI.md`).
  - Build gates: the architecture test, the token/contrast test, an SPDX licence gate,
    third-party notices and a dist audit (`tests/`, `tools/build`).
  - README.
  - Independent review: [docs/reviews/review-m1-foundation.md](docs/reviews/review-m1-foundation.md)
    (46 findings, all majors and minors fixed).
- **Milestone 2 (Forever data pipeline):**
  - `tools/questiedb`: fetches, extracts, validates and diffs from the pinned QuestieDB
    (`b6f5b07`), with luaparse and a whitelisted evaluator that fails closed. It reproduces
    upstream's composed counts (4,257 / 10,122 / 6,666 / 14,899), extraction is byte-reproducible,
    and the tool works without git.
  - Committed dataset `public/data/` (`dataRevision` `65c377bc…`, 938.6 kB gzip): 4,257 quests,
    6,003 NPCs (quest-referenced plus flight masters, innkeepers and trainers), 952 objects,
    2,962 items and 77,828 points, with a manifest, NOTICE and fixture slice.
  - `src/geo`: transforms, resolve, era→forever, distances, zone attribution, frame and content
    hashes.
  - Committed placeholder geometry: 49 QuestieDB frames plus 12 cited DB2 rows, reproducible from
    `tools/maps/inputs/`.
  - `src/infra` loaders: SHA-256-verified data and geometry, a synchronous `DatasetView` with
    overlays, and spawns converted to world points (76,300 resolved, 1,282 instance-presence).
  - The app boots on real data with a labelled sample route (Durotar start).
  - Independent review: [docs/reviews/review-m2-data.md](docs/reviews/review-m2-data.md)
    (44 findings, all fixed).
- **Milestone 3 (Map):**
  - `src/map/adapter.ts`: `MapAdapter` and plain-data descriptors.
  - `src/map/layers.ts`: pure layer builders with level of detail, caps, co-location merging,
    honest counts of what is not drawn, and route lines split per world map and chunked.
  - `src/map/leaflet`: `CRS.Simple` per world map (lat = x, lng = −y), a canvas renderer, glyphs,
    grid and scale, id-based diffing and performance marks. It is lazy-loaded (about 54 kB gzip).
  - Map panel with a surface switcher, layer panel and legend, route line and steps, quest givers,
    objectives, turn-ins, flight masters, zone frames, focus, fit, jump-to-zone, hover and click.
  - Local map sets: a dev/preview-only Vite plugin, an art manifest and hash-verified art loading.
  - Independent review: [docs/reviews/review-m3-map.md](docs/reviews/review-m3-map.md)
    (28 findings, 27 done, 1 partial).
- **Milestone 4 (Editor and storage):**
  - IndexedDB autosave. Saves issued on hide are written. Several projects can be kept, with
    Recently deleted (30 days) and Delete permanently. Tabs coordinate through Web Locks and
    BroadcastChannel. The drift report and native JSON import/export (strict UTF-8, validated)
    are in.
  - The editor adds quests (accept, complete, turn-in, or all three), inserts after the
    selection, and shows chain labels. It edits steps (note, duration, location picked on the
    map) and handles custom quests (with the DATA001 shadowing notice). A Settings dialog
    covers character and route profile.
  - Schema v1 frozen (D-035).
- **Milestone 5 (RXP):**
  - Pure `src/rxp`: unwrap (no Lua VM, protected strings refused), a lossless CST, filters,
    command registry, coded diagnostics, lowering to steps plus groups, and a serializer.
    Unedited imports export byte-identically; edited groups export canonically.
  - "Import RXP custom guide" and "Export RXP custom guide" dialogs. Imported colour escapes are
    shown as plain text.
  - `tools/build/rxp-overlap.ts`: 0 overlaps against RXPGuides guides (D-019).
- **Milestones 4/5 review:** three critics (editor/storage, RXP parser, UI/accessibility)
  and a fix pass. Every blocker and major is fixed; see D-036 for the deferred items and
  `docs/reviews/review-m4-m5.md`.

## Branch / commit

- Branch: `main`
- Commits: `e2e577f` skeleton, `14acc7a` M0, `374354a` M1, `daeefb1` M2, `0b56df9` M3, then the
  M4/M5/M3b-part-1 commit (see `git log`).

## Build / test status

As of the Milestones 4/5 and 3b part 1 commit (`pnpm check`, plus the nav, art and terrain gates):

| Check | Status |
|---|---|
| Typecheck (pure, app, node configs) | pass |
| Lint | pass |
| Tests | 188 files, 2,299 tests, pass (client tests: 25 of 25 ran against the installed client) |
| Data validation (`data:validate`, public/data and fixture) | pass |
| Reproducibility (`extract --check`, needs the QuestieDB clone) | byte-identical (manual gate until CI, Milestone 9) |
| Licence gate | pass (8 shipped packages) |
| Production build + dist audit | pass; entry 206.1 kB gzip of 250 kB; lazy chunks 98.4 kB; data 938.6 kB gzip of 1.2 MB |
| Navigation (`nav:validate` plain, `--client`, `--partition`; `nav:check`) | 56 / 62 / 60 checks pass; 113 of 113 files byte-identical on rebuild; gates G1-G15 pass (manual until CI; needs the client) |
| Map art and terrain (`convert.ts --check`, `byproducts.ts --check`, `maps:validate`) | up to date, byte-identical; 14 checks pass |
| Sizes (gzip-6) | nav 5,437,717 B of 7 MB; art 9,047,639 B of 12 MB; terrain 445,061 B of 600 kB |

## Known bugs / deferred checks

- No axe-core accessibility run yet (planned with the Playwright smoke test, Milestone 9).
- "The page never scrolls" (docs/UI.md §6) is a manual check until Playwright exists.
- `pnpm data:check` (fetch, `extract --check`, validate) is a manual gate until CI exists
  (Milestone 9): `pnpm check` runs `data:validate`, which proves the committed data is internally
  consistent but not that it equals a fresh extraction (DATA_PROVENANCE §7 item 1; M2 review
  data-F3). `extract.test.ts` is skipped, loudly, without the QuestieDB clone, and fails in CI
  (`CI` set) without it.
- `pnpm data:check` (fetch, extract --check, validate) is a manual gate until CI exists (Milestone 9).
- PERF-2 (map route edit at 10,000 steps): improved to a 6.0-6.8 ms median in the browser, but
  p90 is up to 8.7 ms against 8 ms. It stays open, guarded by `tests/bench/map-edit.bench.ts --check`
  (D-036).
- Autosave of a 10,000-step project is 35 ms unthrottled. Chunked storage is decided after the
  Milestone 9 throttled run (D-036).
- One quest-giver aggregate is drawn for UiMap 947 (Azeroth). Review it with the terrain map
  layers (Milestone 3b).
- The planned 4× CPU-throttled startup measurement happens with Playwright (Milestone 9).

## Blockers

_None._

## Feature backlog (post-MVP or later milestones)

- UX ideas from a community planner, with target milestones: [docs/research/ux-benchmark.md](docs/research/ux-benchmark.md).
- ~~Terrain-aware walking (post-MVP)~~: promoted to **Milestone 3b** by owner decision (D-028).

## Owner decisions

| ID | Question | Decision / default | Status | Source |
|---|---|---|---|---|
| OD-1 | Repository licence | GPL-3.0-or-later | decided (D-001, D-016) | owner |
| OD-2 | Commit the generated dataset | Commit the full dataset | decided (D-002) | owner |
| OD-3 | Questie/QuestieDB publish no licence; Questie's draft says "all rights reserved" | Build, commit **and publish** with prominent notices; owner accepts the risk | decided (D-016) | owner |
| OD-4 | Is the Forever beta under an NDA? | No; cited client values may appear in docs and tests | decided (D-022) | owner |
| OD-5 | Commit the 12 DB2-only geometry rows (continents, new zones) | Commit | decided (D-018) | owner |
| OD-6 | Commit taxi-derived leg timings (TaxiNodes/TaxiPath)? | **Pending.** Default: local-only; clean deploys use straight-line × detour / 32 yd/s | pending | ARCH §19 item 3, D-022 |
| OD-7 | Ship item-start facts that come only from QuestieDB's Wowhead-generated `itemStartFixes`? | **Pending.** Default: shipped, origin noted in the manifest and NOTICE | pending | DATA_PROVENANCE §3.3 |
| OD-8 | Archive the pinned upstream QuestieDB inputs with each release? | **Pending.** Default: not archived (the pinned commit is public) | pending | DATA_PROVENANCE §3.3 |
| OD-9 | Contact the Questie team about licensing permission? | Owner's call; not required by D-016 | open | D-016 |
| OD-10 | Any real map art ever deployed publicly? | Yes: extracted, committed and deployed with notices (owner accepts the risk) | decided (D-033, supersedes D-018 art rule) | owner |
| OD-11 | Terrain-aware walking: derived navigation data committed and deployed? | Commit + deploy with notices | decided (D-028) | owner |
| OD-12 | Terrain extraction method | Own read-only TypeScript CASC reader over `Data/` | decided (D-028) | owner |
| OD-13 | Push to the GitHub remote? | Not pushed until the owner says so | open | owner |
| OD-14 | Navigation data size | Lighter mesh, target 5-6 MB gzip, hard cap 7 MB, mandatory spawn census | decided (D-030) | owner |
| OD-15 | Elevator/lift connectors | Owner's in-game observations (cited); interim straight-line fallback plus warning | decided (D-031) | owner |
| OD-16 | Terrain map byproducts (coastlines, zone outlines, low-res relief) | Commit and deploy with notices | decided (D-032) | owner |
| OD-17 | In-game calibration set (walked legs) | Not now; estimates stay labelled mesh-derived | deferred (D-031) | owner |

## Open questions (research)

- Forever XP values (quest, kill, curve) are server-side; beta reports suggest higher open-world
  quest XP and much higher dungeon quest XP, but nothing is published. Simulation runs on labelled
  assumptions (SIMULATION.md, forever-game-rules.md §10).
- Objective counts are absent from QuestieDB (assumed defaults, per-step overrides).
- Skyborne race token and Forever realm season value for RXP filters.
- Forever quest-difficulty colour thresholds (the client's C API is opaque; Era rule is the
  labelled default).
- Riding training level and cost in Forever.

## Exact next tasks

**Milestone 3b (terrain navigation and map art).** Design:
[docs/research/terrain-navigation.md](docs/research/terrain-navigation.md) (revision 3, re-critique
RC-01..RC-13 accepted, D-028 to D-034). Steps 3b.1-3b.5, 3b.7 and 3b.8 are built (uncommitted):
`tools/casc`, `tools/terrain` with `public/nav/` (5,423,019 B gzip-6, gates G1-G15 pass),
`src/nav` (pure runtime), `public/maps/terrain/` (445,061 B) and `public/maps/art/` (9,047,639 B,
Blizzard's art under D-033); committed with Milestones 4/5. The build and verifier reports are summarised
in [docs/reviews/review-m3b-part1.md](docs/reviews/review-m3b-part1.md). Next:

1. 3b.6: `src/nav/worker` (fetch, verify, pin, LRU, resumable search), the leg table, the
   `TravelModel` 'navigation' with the same-map `TravelGraph` rule (D-034 item 2), the SIM warnings
   including `SIM-unverified-passage`, progress and cancel for "computing paths".
2. Map adapter: the art and terrain layers and the path lines.
3. D-033 notices still owed in the About dialog (it says "No map art is included").
4. 3b.9 review, fix, commit.

**Owner in-game checks (D-031, D-034 items 1 and 5).** Each is tracked here until recorded:

| Check | Where it is recorded | State |
|---|---|---|
| Undercity west tunnel: walk from Varimathras to Brill without an elevator | `tools/terrain/inputs/passages.json` `undercity-west-tunnel` (49 polygons tagged; legs through it warn) | unverified |
| Ironforge mountain top: walk from the summit above Ironforge down to Dun Morogh | `passages.json` `ironforge-mountain-top` (597 polygons tagged) | unverified |
| Ban'ethil Barrow Den lower chamber (Gnarlpine Hold, G7a): walk the spiral ramp under the overhang near (9857, 1571, 1328) | `tools/terrain/inputs/census-reviewed.json` (`mesh-break-suspected`); a `walk` connector if passable | unverified |
| Thunder Bluff elevators (at least three) | `tools/terrain/inputs/connectors.json` (`thunder-bluff-elevator-west` is `todo`) | to record |
| Undercity elevators (at least three) | `connectors.json` | to record |
| Rut'theran Village → Darnassus portal (`teleport`) | `connectors.json` `rutheran-to-darnassus-portal` (`todo`) | to record |

**Census gate (D-030), architect's call, open to owner override:** 283 of the 298 census review
entries are rule-drafted geometry notes from `pnpm nav:review-draft` ("rule:" prefix), not
individual reviews or in-game checks. They are accepted for the MVP gate because each names its rule
and can be re-reviewed individually; the 15 largest or oddest components were reviewed one by one.

**In parallel with 3b part 2, Milestone 6 (rules, simulation and validation):** the pure core first
(rules, engine walker, simulation, validator), then the app and UI integration (route-list warnings,
validation panel, estimates).

## Important commands

```bash
pnpm install        # dependencies (pnpm 10.33, Node >= 22.13)
pnpm dev            # dev server
pnpm check          # typecheck, lint, test, data:validate, build (licence gate, notices, dist audit)
pnpm test           # tests only
pnpm data:validate  # validate public/data and the fixture (no clone needed)
pnpm data:check     # fetch the pinned QuestieDB, extract --check, validate (reproducibility)
pnpm data:all       # regenerate public/data from the pin (commit with any tools/questiedb change)
pnpm maps:placeholder  # regenerate public/maps/placeholder from the pin + tools/maps/inputs
pnpm maps:validate     # placeholder geometry and committed art checks (no client needed)
pnpm rxp:overlap       # D-019 gate: self-authored RXP text must not equal RXPGuides lines
# The following need the installed WoW: Forever client (read-only: .build.info and Data/ only)
pnpm nav:extract       # build public/nav from the client (about 76 s, 12 workers)
pnpm nav:check         # rebuild and compare byte for byte
pnpm nav:validate      # gates; add --client or --partition for the client-backed checks
pnpm tsx tools/maps/convert.ts --check          # painted map art is up to date
pnpm tsx tools/terrain/byproducts.ts --check    # coastlines, zone outlines, relief are up to date
```

## Major design decisions

See [docs/DECISIONS.md](docs/DECISIONS.md). The most load-bearing: D-016 (licence finding and
publishing), D-017 (coordinates), D-018 (map files), D-019 (RXP), D-020 (route model),
D-021 (optimiser contract), D-028 (terrain navigation), D-033 (Blizzard map art).

## External research links

- QuestieDB: https://github.com/Questie/QuestieDB (pinned `b6f5b07b0acf1c820993cbb0ce2521c912bb4c92`)
- Questie: https://github.com/Questie/Questie (licensing draft on the `license` branch)
- wow.export: https://github.com/Kruithne/wow.export
- WoWDBDefs: https://github.com/wowdev/WoWDBDefs
- RestedXP custom guides: https://community.restedxp.com/custom-guides/ (returns HTTP 403 to
  fetchers; read in a browser)
- Blizzard Forever announcements: see docs/research/forever-game-rules.md §1

## Local environment notes

- The Forever beta client (`wow_classic_beta`, observed build 1.60.1.70009 on 2026-09-25) is at
  `C:\Program Files (x86)\World of Warcraft\_classic_beta_`. Treat it as read-only. Never read its
  `WTF/`, `Cache/` or `Logs/` folders (privacy), and never run wow.export against it with default
  settings (D-011).
- `.cache/` (gitignored) holds upstream clones and Milestone 0 experiments.

## Files a future agent should read first

1. `STATUS.md` (this file)
2. `docs/ARCHITECTURE.md`
3. `docs/DECISIONS.md`
4. The spec for the area you are working on: DATA_PROVENANCE.md, MAPS.md, RXP.md, SIMULATION.md
