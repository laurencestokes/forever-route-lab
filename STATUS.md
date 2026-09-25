# STATUS

> The single source of truth for where this project is. Read this first, then
> [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) and [docs/DECISIONS.md](docs/DECISIONS.md).
> Nothing here depends on any previous AI conversation.

Last updated: 2026-09-25

## Current milestone

**Milestone 1: Foundation**, complete. Next: **Milestone 2: Forever data pipeline**.

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

## Branch / commit

- Branch: `main`
- Commits: `e2e577f` skeleton, `14acc7a` Milestone 0, then the Milestone 1 commit (see `git log`).

## Build / test status

As of the Milestone 1 commit (`pnpm check`):

| Check | Status |
|---|---|
| Typecheck (pure, app, node configs) | pass |
| Lint | pass |
| Tests | 47 files, 746 tests, pass |
| Licence gate | pass (8 shipped packages) |
| Production build + dist audit | pass; entry chunk about 101 kB gzip of a 250 kB budget |

## Known bugs / deferred checks

- No axe-core accessibility run yet (planned with the Playwright smoke test, Milestone 9).
- "The page never scrolls" (docs/UI.md §6) is a manual check until Playwright exists.
- The app runs on synthetic placeholder data until Milestone 2.

## Blockers

_None._

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
| OD-10 | Any real map art ever deployed publicly? | Default: never; local only | default | D-018 |

## Open questions (research)

- Forever XP values (quest, kill, curve) are server-side; beta reports suggest higher open-world
  quest XP and much higher dungeon quest XP, but nothing is published. Simulation runs on labelled
  assumptions (SIMULATION.md, forever-game-rules.md §10).
- Objective counts are absent from QuestieDB (assumed defaults, per-step overrides).
- Skyborne race token and Forever realm season value for RXP filters.
- Forever quest-difficulty colour thresholds (the client's C API is opaque; Era rule is the
  labelled default).
- Riding training level and cost in Forever.

## Exact next tasks (Milestone 2: Forever data pipeline)

1. `tools/questiedb` (ARCHITECTURE §5, DATA_PROVENANCE §4-§9):
   - `upstream.json` pin, `fetch.ts` (git blobs, LF hashes), `extract.ts` (luaparse plus a
     whitelisted evaluator; static corrections in upstream order; overlays), `validate.ts` (golden
     counts 4,257 / 10,122 / 6,666 / 14,899, referential integrity, schema), `diff.ts` (pin-to-pin
     diff, stub three-way classifier);
   - output: `public/data/*.json` plus `manifest.json` and `NOTICE.md`, a test fixture slice, and
     size baselines in `tools/build/dist-requirements.json`.
2. `src/geo`: `SourcedPoint` resolution, world/percent transforms, `eraToForever`, distances and
   zone attribution, with the worked-example tests from coordinates.md §7-§9.
3. `tools/maps import --placeholder`, which builds
   `public/maps/placeholder/geometry.placeholder.json` and its `NOTICE.md` from the pinned
   `conversion.json` plus `tools/maps/inputs/db2-rows-1.60.1.70009.json` (12 cited rows; source
   CSVs in `.cache/experiments/maps/`).
4. `src/infra/data` loader and synchronous `DatasetView` (spawns converted to world points at load;
   overlays; custom quests), `src/infra/maps` geometry loader, and the app switched from placeholder
   to real data with a loading state.
5. Independent data/provenance, coordinate and code reviews; fix; checks; docs; commit.

## Important commands

```bash
pnpm install        # dependencies (pnpm 10.33, Node >= 22.13)
pnpm dev            # dev server
pnpm check          # typecheck, lint, test, build (licence gate, notices, dist audit)
pnpm test           # tests only
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
