# STATUS

> The single source of truth for where this project is. Read this first, then
> [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) and [docs/DECISIONS.md](docs/DECISIONS.md).
> Nothing here depends on any previous AI conversation.

Last updated: 2026-09-25

## Current milestone

**Milestone 0: Research, architecture, critique**, finishing. Next: **Milestone 1: Foundation**.

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
- Decisions D-001 to D-026 in [docs/DECISIONS.md](docs/DECISIONS.md), with Status lines on superseded entries.

## Branch / commit

- Branch: `main`
- Commits: `e2e577f` (skeleton), then the Milestone 0 research/architecture commit (see `git log`).

## Build / test status

| Check | Status |
|---|---|
| Tests | not yet set up (Milestone 1) |
| Typecheck | not yet set up (Milestone 1) |
| Production build | not yet set up (Milestone 1) |

## Known bugs

_None (no code yet)._

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

## Exact next tasks (Milestone 1: Foundation)

1. Toolchain with pnpm: Vite 8, React 19.3, TypeScript `~6.0.3` strict (with
   `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`,
   `verbatimModuleSyntax`), ESLint 10 + typescript-eslint (type-aware) + react-hooks, Vitest 5
   (node + happy-dom), `package.json` `"license": "GPL-3.0-or-later"`, Node `>=22.13`.
2. Scripts: `dev`, `build`, `preview`, `test`, `typecheck`, `lint`, `check` (all of them).
3. Domain types from ARCHITECTURE §5.3, §6, §8 in `src/domain` (branded IDs, records, route,
   project, conditions AST), pure route operations with tests, zod schemas typed against them in
   `src/project` with a type-equality test (schema v1 unstable until M6).
4. `src/app` store with revisions, commands and undo/redo history (framework-agnostic, tested).
5. Three-panel shell (top bar, route list, map placeholder, right tabs, status bar) on placeholder
   data, original visual system with design tokens and light/dark themes.
6. `tests/architecture.test.ts` (allowlist matrix, pure-set globals, path hygiene).
7. `tools/build/licence-gate.ts`, `tools/build/audit-dist.ts`, `tools/build/third-party-notices.ts`
   wired into `build`/`check`.
8. `README.md` in the style of the owner's reference README: what it is, highlights, quick start,
   architecture summary, project layout, development commands, licence section with the
   copyright line and the D-016 data notice.
9. Critique, fix, run checks, update docs and this file, commit.

## Important commands

_Added in Milestone 1._ Research tooling used so far:

```bash
git clone --depth 1 https://github.com/Questie/QuestieDB.git .cache/questiedb   # pinned: b6f5b07
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
