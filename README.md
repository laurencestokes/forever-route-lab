<div align="center">

# Forever Route Lab

**Plan, simulate, validate and optimise World of Warcraft: Forever levelling routes, entirely in your browser.**

[![TypeScript](https://img.shields.io/badge/TypeScript-6.0-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-19.3-61DAFB?logo=react&logoColor=black)](https://react.dev/)
[![Vite](https://img.shields.io/badge/Vite-8-646CFF?logo=vite&logoColor=white)](https://vite.dev/)
[![Vitest](https://img.shields.io/badge/Vitest-5-6E9F18?logo=vitest&logoColor=white)](https://vitest.dev/)
[![Leaflet](https://img.shields.io/badge/Leaflet-1.9.4-199900?logo=leaflet&logoColor=white)](https://leafletjs.com/)
[![License: GPL-3.0-or-later](https://img.shields.io/badge/License-GPL--3.0--or--later-blue.svg)](LICENSE)
[![Status: pre-alpha](https://img.shields.io/badge/status-pre--alpha-orange)](STATUS.md)

[What this is](#what-this-is) · [Run it](#run-it) · [Architecture](#architecture) · [Data and maps](#data-and-maps) · [Contributing](#contributing) · [License](#license)

</div>

> **Pre-alpha.** Milestone 1 (Foundation) is a working shell over placeholder data. Nothing in it
> is real Forever quest data yet, and every number that needs the simulator reads "unknown". Where
> the project stands, and what comes next, is in [STATUS.md](STATUS.md). Screenshots will be added
> once the map and the real dataset land.

## What this is

Forever Route Lab is a workbench for levelling routes on World of Warcraft: Forever. It is meant to
cover the whole loop in one place:

- **plan** a route as a list of steps (accept, complete, turn in, travel, grind, hearth, flight,
  train, vendor, note),
- **simulate** it against a versioned ruleset (level, XP, time), with every assumption labelled,
- **validate** it (level gates, prerequisites, quest log capacity, travel),
- **import and export** RestedXP-format custom guides, losslessly where the guide was not edited,
- **optimise** a selected section between anchors you lock, and review the proposal as a diff
  before accepting any of it.

It is a static site: no backend, no accounts, no runtime AI, and nothing leaves your browser.
The optimiser is a tool for a human route author, not a "solve 1-60" button: it works on a bounded
section, keeps what the rest of the route depends on, and says "best route found under these
assumptions", never "optimal".

## Highlights

**Available now (Milestone 1: Foundation)**

- **A three-panel editor shell**: route list on the left, a map placeholder in the centre, and
  Available, Quest log, Details and Validation tabs on the right, with a top bar and a status bar.
- **A route list built for long routes**: fixed one-line rows with in-house virtualisation,
  single, toggle and range selection, keyboard navigation, drag to reorder, Alt+↑/↓ moves, lock,
  duplicate, delete, and insert note, travel or grind steps.
- **Undo and redo** over immutable project snapshots (200 entries, coalesced typing and held-key
  moves), with the usual shortcuts: Ctrl+Z, Ctrl+Shift+Z or Ctrl+Y, Delete, Ctrl+D, Ctrl+A, Escape.
- **Quest difficulty** in the client's own difficulty colours, always with pips and words as well,
  never colour alone. Thresholds are the Era rule and are labelled as such; Forever's are unknown.
- **An original visual system** with design tokens, light and dark themes (your choice is
  remembered), visible focus, and keyboard and screen-reader support designed in from the start.
- **The domain model and its contract**: branded IDs, the route model (atomic steps plus RXP group
  sidecars), the project format with zod schemas typed against it, and pure, tested route
  operations.
- **Honest placeholders**: the shell runs on a tiny synthetic dataset (quests and NPCs named
  "Placeholder ...") and a 40-step placeholder route, both labelled in the UI. Duration, XP per
  hour and level projections show "unknown, simulation arrives in Milestone 6".

**Planned**

| Milestone | Scope |
|---|---|
| 2 | Forever data pipeline from QuestieDB at a pinned commit, committed dataset with notices |
| 3 | Map: Leaflet behind an adapter, placeholder geometry, route lines and markers, no game art |
| 4 | Route editor and storage: IndexedDB autosave, native JSON import and export |
| 5 | RestedXP custom guide import and export with lossless round trips |
| 6 | Ruleset, simulation (XP, level, time) and validation |
| 7 | Optimiser for a locked-anchor section, in a web worker |
| 8 | Proposal review: diff, metrics, accept, reject or apply selected changes |
| 9 | Independent reviews, end-to-end smoke tests, release |

The full plan, with the reasoning behind each piece, is [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Run it

You need Node.js 22.13 or newer and pnpm 10.33 (see `packageManager` in `package.json`).

```bash
pnpm install --frozen-lockfile
pnpm dev         # then open http://localhost:5173
```

To build and serve the static site:

```bash
pnpm build       # vite build, then third-party notices and the dist/ audit
pnpm preview     # serve dist/ locally
```

`dist/` runs from any path on any static host (relative base). It ships `LICENSE.txt` and
`third-party-notices.txt` next to the app, and the build fails if anything that must not ship
(local map sets, source maps, raw Lua, local paths) reaches it.

## Architecture

A few principles carry the design:

- **Data ≠ map.** Quest data and map art or geometry are separate pipelines, files and modules.
  They meet only in a pure coordinate adapter. Locations keep the point as it was authored, and
  world coordinates are derived at runtime, so a project never depends on which map files a
  machine has.
- **Pure core, thin shell.** Everything that decides something (domain, rules, simulation,
  validation, RXP, diff, the optimiser core) is framework-free TypeScript with no DOM, React,
  Leaflet, IndexedDB, clock or randomness. Time and IDs are injected.
- **Unknown stays unknown.** A missing value is `null` with a reason, never 0 or a silent Era
  substitute, and every derived number says whether it comes from source data, a user assumption
  or an estimate.
- **Deterministic.** Same inputs, same outputs: simulation, validation, serialisation, data
  extraction, diff, and the optimiser when it stops on its evaluation budget.

The modules, in dependency order (`A ──► B` means B imports A):

```
domain ──► geo, rules ──► sim ──► engine ──► validate
                                    └──────► optimizer/core ◄── optimizer/worker
domain, geo ──► rxp          domain ──► diff, project
pure modules, infra (data, maps, IndexedDB) ──► app (store, history, commands)
app, map/adapter ──► ui (React)          map/leaflet ──► composition root only
```

None of this is honour-system: `tests/architecture.test.ts` checks every import in `src/` against
the allowlist, keeps browser, clock and randomness globals out of the pure modules, and rejects
committed files that contain local user paths. Read more in
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) and the decision log [docs/DECISIONS.md](docs/DECISIONS.md);
the specifications are [docs/SIMULATION.md](docs/SIMULATION.md), [docs/RXP.md](docs/RXP.md),
[docs/MAPS.md](docs/MAPS.md), [docs/DATA_PROVENANCE.md](docs/DATA_PROVENANCE.md) and
[docs/UI.md](docs/UI.md).

## Project layout

| Path | What it is |
|---|---|
| `src/domain/` | Hand-written domain types (IDs, dataset records, route, project, conditions) and pure route operations, step and project factories, race and class masks |
| `src/rules/` | Game rules; today the quest difficulty table, later the versioned rulesets |
| `src/project/` | zod schemas for the project format, migrations, parse and serialise |
| `src/app/` | Framework-agnostic editor store: revisions, selection, commands, undo and redo; the React binding lives in `react.ts` |
| `src/ui/` | React components, design tokens and styles; `App.tsx` composes the kit with the store |
| `src/infra/` | Browser-facing adapters; today the placeholder dataset, later the dataset loader and IndexedDB |
| `src/main.tsx` | Composition root |
| `tools/build/` | Licence gate, third-party notices and the `dist/` audit |
| `tests/` | Cross-module tests (architecture rules, project fixtures) and fixtures; unit tests sit next to their modules |
| `docs/` | Architecture, decisions, specifications, research and reviews |
| `public/` | Static files copied into the build |
| `local-maps/`, `assets-source/` | Gitignored folders for map files from your own client; never built or deployed |

Planned modules (`geo`, `engine`, `sim`, `validate`, `rxp`, `diff`, `optimizer`, `map`) and tools
(`tools/questiedb`, `tools/maps`) arrive with their milestones.

## Development

```bash
pnpm typecheck      # three strict configs: pure (ES2023 only, no DOM or Node), app (DOM), node
pnpm lint           # ESLint with type-aware typescript-eslint rules, react-hooks, no-bitwise
pnpm test           # Vitest: node for pure modules, happy-dom for components
pnpm test:watch     # the same, watching
pnpm licence:check  # shipped dependencies against the SPDX allowlist (also run by build)
pnpm build          # vite build, licence gate, third-party notices, dist/ audit
pnpm check          # typecheck, lint, test, build
```

Tests are deterministic and sit next to the code they test (`*.test.ts`, `*.test.tsx`). Pure
modules never read the clock or generate IDs; tests inject both. `tests/architecture.test.ts`
enforces the module dependency rules, the pure-module ban on browser, Node, clock and randomness
APIs, the ban on bitwise operators (race masks exceed 32 bits), and path hygiene in committed
files. `tests/ui-tokens.test.ts` guards the visual system: reserved difficulty colours, theme
parity and WCAG contrast pairs.

## Data and maps

**Quest data.** From Milestone 2 the quest, NPC, object, item and zone data will be derived from
[QuestieDB](https://github.com/Questie/QuestieDB) (flavour Forever) at a pinned commit
(`b6f5b07b0acf1c820993cbb0ce2521c912bb4c92`), by a reproducible extractor, and committed with a
manifest and notices. Milestone 1 ships no QuestieDB data at all, only the synthetic placeholder
set.

Neither Questie nor QuestieDB has ever published a licence file on its default branch (checked
across full history on 2026-09-25). An unmerged draft in Questie's repository says that, when in
doubt, Questie should be considered "all rights reserved", and proposes a contributor licence
agreement to relicense contributions. The project owner has chosen to publish the derived data
with prominent notices and accepts the risk. This records a finding and a decision; it is not a
legal conclusion. The details are in [docs/DATA_PROVENANCE.md](docs/DATA_PROVENANCE.md) §3 and
decision D-016.

At the pinned commit, QuestieDB's Forever data is the Classic Era baseline with re-projected
coordinates on four zones: it holds no Forever-specific content yet. Every record therefore
carries "Forever status: unknown", and Forever XP values are assumptions until someone enters
observed ones.

**Maps.** No Blizzard map art is committed or deployed. The planned map draws zone frames, labels
and data points procedurally from committed geometry. If you extract map files from your own
client, they stay in the gitignored `local-maps/` folder, which only the development server
serves and which the build audit keeps out of `dist/` ([docs/MAPS.md](docs/MAPS.md)).

**RestedXP guides.** Import and export follow the RestedXP custom-guide format from an independent
behavioural specification ([docs/RXP.md](docs/RXP.md)). No RXPGuides code, guide text or data
values are included (decision D-019).

## Contributing

Read [STATUS.md](STATUS.md) first: it is the single source of truth for where the project is,
what is decided and what comes next. Then [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) and
[docs/DECISIONS.md](docs/DECISIONS.md), and the specification for the area you want to work on.

A few house rules: keep pure modules pure, keep unknown values unknown, label anything that
stands in for real content as "Placeholder", never add game data by hand (it comes from the
extractor), and run `pnpm check` before you open a pull request.

## License

Copyright (C) 2026 Laurence Stokes

This program is free software: you can redistribute it and/or modify it under the terms of the
GNU General Public License as published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without
even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU
General Public License for more details.

You should have received a copy of the GNU General Public License along with this program. If
not, see <https://www.gnu.org/licenses/>. The full text is in [LICENSE](LICENSE)
(SPDX: `GPL-3.0-or-later`).

**Data.** GPL-3.0-or-later applies to this project's contributions and, as a posture, to Questie-derived data; it grants no rights over Blizzard content (names, text, client-derived values) or other third-party material embedded in that data.

**Third parties.** Bundled dependencies and their licences are listed in `third-party-notices.txt`
in every build; data sources and other third-party material are recorded in
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

**Trademarks.** World of Warcraft is a trademark of Blizzard Entertainment, Inc. Forever Route
Lab is not affiliated with or endorsed by Blizzard Entertainment, the Questie project or
RestedXP.
