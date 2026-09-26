# STATUS

> The single source of truth for where this project is. Read this first, then
> [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) and [docs/DECISIONS.md](docs/DECISIONS.md).
> Nothing here depends on any previous AI conversation.

Last updated: 2026-09-25

## Current milestone

**Milestone 3: Map**, complete. Next: **Milestone 3b: Terrain navigation and map art** (D-028, D-030..D-033). The design revision is in progress in `docs/research/terrain-navigation.md`. Milestones 4 (editor and storage) and 5 (RXP) can run in parallel with 3b.

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

## Branch / commit

- Branch: `main`
- Commits: `e2e577f` skeleton, `14acc7a` M0, `374354a` M1, `daeefb1` M2, then the M3 commit (see `git log`).

## Build / test status

As of the Milestone 2 commit (`pnpm check`):

| Check | Status |
|---|---|
| Typecheck (pure, app, node configs) | pass |
| Lint | pass |
| Tests | 116 files, 1,521 tests, pass |
| Data validation (`data:validate`, public/data and fixture) | pass |
| Reproducibility (`extract --check`, needs the QuestieDB clone) | byte-identical (manual gate until CI, Milestone 9) |
| Licence gate | pass (8 shipped packages) |
| Production build + dist audit | pass; entry about 142 kB gzip of 250 kB; lazy map chunk about 54 kB; data 938.6 kB gzip of 1.2 MB |

## Known bugs / deferred checks

- No axe-core accessibility run yet (planned with the Playwright smoke test, Milestone 9).
- "The page never scrolls" (docs/UI.md §6) is a manual check until Playwright exists.
- `pnpm data:check` (fetch, `extract --check`, validate) is a manual gate until CI exists
  (Milestone 9): `pnpm check` runs `data:validate`, which proves the committed data is internally
  consistent but not that it equals a fresh extraction (DATA_PROVENANCE §7 item 1; M2 review
  data-F3). `extract.test.ts` is skipped, loudly, without the QuestieDB clone, and fails in CI
  (`CI` set) without it.
- `pnpm data:check` (fetch, extract --check, validate) is a manual gate until CI exists (Milestone 9).
- Map route-edit budget (8 ms) is missed at 10,000 steps (17-20 ms). The step-marker layer
  rebuilds because its cache key includes the focus. Fix in Milestone 4 (review-m3-map.md).
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

**Milestone 3b (terrain navigation and map art).** The design is being revised against critique
TN-01..18 and decisions D-030 to D-033. Once the re-critique gives a go:

1. `tools/casc`: shared read-only CASC reader plus a WDC5 DB2 reader, from the Milestone 0/3b
   experiments.
2. `tools/terrain`: geometry assembly (ADT, liquids, holes, WMO/M2 collision); a Recast build
   through recast-navigation-js (pinned dev dependency, build time only); the compact 4×4-block
   format; build-time components; connectors from the owner's observations (D-031); validation
   gates (spawn census, must-connect and must-not-connect fixtures, seams, determinism); the nav
   budget (D-030).
3. `src/nav` (pure): decode, snap, `legsFrom` (Dijkstra plus funnel), and a leg table. A worker
   with fetch/verify/pin, and a `TravelModel` 'navigation' implementation.
4. Map art (D-033): extraction via `tools/casc` (UiMapArt tiles, WorldMapOverlay), BLP decode,
   stitching, web images, a manifest with NOTICE and a size budget, and an audit allowlist.
5. Terrain byproducts (D-032): coastlines, zone outlines and low-res relief, rendered by the map
   adapter.
6. Reviews, fix, commit.

**In parallel, Milestone 4 (editor and storage) and Milestone 5 (RXP):**
- M4: editing polish, IndexedDB autosave and backups, JSON import/export UI, and the PERF-2
  10k-step fix.
- M5: `src/rxp` from RXP.md (unwrap, CST, diagnostics, lowering, serializer, fixtures, round
  trips), import/export UI, and `tools/build/rxp-overlap.ts`.

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
```

## Major design decisions

See [docs/DECISIONS.md](docs/DECISIONS.md). The most load-bearing: D-016 (licence finding and
publishing), D-017 (coordinates), D-018 (map files), D-019 (RXP), D-020 (route model),
D-021 (optimiser contract).

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
