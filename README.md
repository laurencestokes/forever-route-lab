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

> **Pre-alpha.** The shell runs on the real dataset derived from QuestieDB (Milestone 2), with an
> auto-generated sample route that is not a recommendation, and a schematic map of zone frames
> (Milestone 3, before its reviews). Every number that needs the simulator still reads "unknown".
> Where the project stands, and what comes next, is in [STATUS.md](STATUS.md).

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

**Available now (Milestones 1 and 2: Foundation, Forever data pipeline; Milestone 3: the map, before its reviews; Milestone 4: project storage; Milestone 5: RestedXP custom guides, before its reviews)**

- **Your projects are kept in the browser**: every change is saved automatically to IndexedDB
  (after a short pause, in an idle moment; hiding or leaving the page starts the save at once),
  and the project you had open reopens after a restart. While changes cannot be kept, the browser
  asks before the page closes. The top bar says what is kept, in words: "Saved 12:03", "Unsaved
  changes", "Saving…", or "Not saved" with the reason (storage full, changed in another tab, open
  in another tab, storage unavailable). In a private window where the browser refuses storage,
  the app keeps working in memory and says that nothing outlives the tab.
- **Several projects**: new, open, rename, duplicate and delete from the Projects menu. A deleted
  project is kept in Recently deleted for 30 days, then removed, or deleted permanently at once to
  free space when storage is full; the original of a stored project that a newer version of the
  app migrates is kept the same way. Two tabs never silently overwrite each other: a project
  already open in another tab says so and offers to open it anyway or open a copy, a save in one
  tab reaches the others at once, and overwriting the other tab's version asks first, naming it.
- **Native project files**: export the open project as a `.frl.json` file (the same project always
  gives the same bytes) and import one as a new project. A file with problems is refused with
  every problem listed by where it is in the file; nothing is repaired or guessed.
- **RestedXP custom guides in and out**: "Import RXP custom guide" takes pasted guide text or a
  custom-guide addon's `.lua` file (read, never run; a file with several guides lets you choose),
  checks it line by line and lists every diagnostic with its line, column, severity and code;
  choosing one shows the line. The guide opens as a new project or is added to the end of the
  route in one undoable step. Quests the data does not have (new Forever content) become
  placeholder custom quests with their real ids, or stay unknown, as you choose; nothing about
  them is made up. RestedXP's protected, account-bound import strings are refused and never
  decoded. "Export RXP custom guide" previews, copies or downloads the route as guide text or a
  `.lua` file, says whether it is byte-identical to the imported guide (it is, when the guide was
  not edited) or rewritten in canonical form, and lists what has no RXP form. The RXP code loads
  on demand, in its own chunk.
- **Data drift**: a project saved with an older dataset revision opens with a "Data changed"
  report of the quests it uses that are gone or whose objectives or prerequisites changed (for an
  imported file, what cannot be compared is marked unknown).

- **One seamless map of both continents**: Leaflet behind the project's own adapter. Kalimdor and
  the Eastern Kingdoms sit side by side at one scale, with Zephras Isle, which the game does not
  place on its world map, in a captioned box between them; "Kalimdor" and "Eastern Kingdoms" are
  views of it, and instances and battlegrounds keep maps of their own. Two base-map styles, both
  Blizzard Entertainment's artwork from the client (see "Data and maps"): the **minimap** (the
  default: the client's minimap textures, one continuous picture at about a yard per pixel, with
  the sea recoloured to one navy) and the **painted** map (the game's painted zone maps composed
  into one picture). Choose in the Map layers drawer; the choice is kept in this browser. Tiles
  load as you pan and zoom, over a coarser picture, so nothing flashes blank, and the wheel zooms
  smoothly without dropping input.
- **What the map draws**: zone names with the character's level spans, the route line (transport
  dashed, flight dotted, hearthstone dash-dot; boats and zeppelins between the continents as arcs),
  step markers with numbers, quest pins coloured by difficulty with pips (clustered when zoomed
  out), turn-ins and objectives with their state after the selected step, dungeons, flight points
  and the flight network, transport stops, innkeepers, trainers and vendors, and the zones' faction.
  Fit the route, focus the selected step, jump to a zone, and click a pin for a pop-up with its
  quests and actions (Accept, Turn in, Add flight from here, Open on Wowhead). The Map layers drawer
  shows or hides each category, with counts, and searches the map.
- **A map that says what it leaves out**: every row of the drawer counts, with its units, what it
  could not place (and why) and what it does not draw, and its key explains every pin, line style
  and badge. When the minimap tiles are not available it shows the painted map and says why; with
  no tiles at all, the terrain relief. A local set of your own client's art is drawn on your
  machine only, from bytes checked against its manifest.
- **Keyboard first, map second**: everything the map does can also be done from the route list,
  the Available tab, Details and the top bar, and the map follows the route list's selection.
  Leaflet loads on demand in its own chunk, fetched while the data loads.
- **The real dataset, integrity-checked at load**: 4,257 quests, 6,003 NPCs, 952 objects and
  2,962 items derived from QuestieDB at a pinned commit, about 0.94 MB gzip. Every file is checked against the
  SHA-256 in its manifest and against its shape before anything is shown; a mismatch shows an
  error screen that says what failed, never a partial dataset. On this machine it is ready in
  about 0.15-0.3 s (budget 1 s).
- **Spawns placed on the map geometry**: 76,300 spawn points (plus 1,282 instance-presence
  markers) become world positions through the committed placeholder geometry; instance presence
  resolves to the dungeon entrance when there is exactly one, and unmapped areas keep their reason
  instead of a guessed position.
  Faction and class variants of quests, NPCs and dungeon entrances follow the character.
- **A sample route built from the data**: "Sample: Durotar start (auto-generated)" for a level-1
  Horde Orc Warrior, generated on a first visit (when no project is stored) from the Durotar map's
  low-level quests (repeatable and holiday quests left out) and labelled "Sample route
  (auto-generated, not a recommended route)".
- **Quests and details from real data**: the Available tab lists the quests open to the character
  (a page of 100 at a time with an honest count, and search), and Details shows a quest's givers
  and receivers at zone and percent, its objectives and where they are done, its quest text, and
  where the record came from.
- **A three-panel editor shell**: route list on the left, the map in the centre, and Available,
  Quest log, Details and Validation tabs on the right, with a top bar and a status bar.
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
- **Honest unknowns**: duration, XP per hour and level projections show "unknown, simulation
  arrives in Milestone 6"; Forever XP is shown as QuestieDB's Era value and says so, and every
  record's Forever status is "unknown".

**Planned**

| Milestone | Scope |
|---|---|
| 3 | Map: the independent rendering, coordinate and accessibility reviews of what is above; then 3b, terrain navigation (D-028) |
| 4 | Route editor: editing polish and the 10,000-step map fix (storage, autosave and project files are above) |
| 5 | RestedXP custom guides: the independent reviews of what is above, and the overlap check against RXPGuides |
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

**The minimap tiles.** The minimap map style's tiles (about 52 MB) are not kept in git (D-049).
The repository holds only their index, manifest, notice and `pack.json`, a pointer that pins a tile
pack (a release asset) by SHA-256. To get them:

```bash
pnpm maps:minimap:fetch   # download the pack pack.json names, verify it and every tile, fill public/maps/minimap/t/
```

It checks the pack's SHA-256, that the pack's `NOTICE.md` and `manifest.json` are the committed
ones, and every tile's size and SHA-256, and installs nothing if any check fails. It keeps the pack
in `.cache/minimap-pack/`; `MINIMAP_PACK_SOURCE` (or `--from`) points it at another copy: a path, a
`file:`, `https:` or `http:` URL, or `gh` for `gh release download`. By default it downloads the
release's public address without a token, so while the repository (or the release) is private, use
`MINIMAP_PACK_SOURCE=gh` with a signed-in GitHub CLI (in a workflow, `GH_TOKEN`). Without the tiles, `pnpm build` and
`pnpm check` still pass, print a warning that the tiles are absent, and check the minimap budget
from the manifest's records; the app then shows the painted style in place of the minimap (the
default) and says why in the Map layers drawer. The deploy build fetches and requires them:

```bash
pnpm build:deploy   # maps:minimap:fetch, then the build with the dist/ audit in deploy mode (every tile required)
```

On a machine with the pinned client, `pnpm tsx tools/maps/minimap.ts` builds the tiles directly, and
`pnpm maps:minimap:pack` assembles the pack from them (it must equal the one `pack.json` pins).
Publishing the pack as a release is the owner's step; no command here uploads anything.

**Trying it on another machine (laptop runbook).** To judge speed on a laptop, serve a production
build over the network, not the dev server:

```bash
pnpm vite build            # or pnpm build, which also runs the notices and the dist/ audit
pnpm vite preview --host   # then open http://<this machine's address>:4173 on the laptop
```

Over a network the dev server is slow for reasons unrelated to the app's own speed: it sends 239
unbundled modules, about 20.8 MB, and runs React in development mode, where the production build
sends 8 files, about 1.7 MB (measured with the map's performance harness,
[docs/research/map-atlas.md](docs/research/map-atlas.md) §3.2). `--host` makes the preview server
listen on every network interface, and the preview also serves your `local-maps/` set if you have
one (D-018: local map files are never deployed), so use it only on a network you trust, and stop
it when you are done.

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
| `src/infra/` | Browser-facing adapters: the dataset loader and synchronous `DatasetView` (`data/`), the map geometry loader and local-map probe (`maps/`); IndexedDB later |
| `src/main.tsx` | Composition root |
| `tools/build/` | Licence gate, third-party notices and the `dist/` audit |
| `tests/` | Cross-module tests (architecture rules, project fixtures) and fixtures; unit tests sit next to their modules |
| `docs/` | Architecture, decisions, specifications, research and reviews |
| `public/` | Static files copied into the build |
| `local-maps/`, `assets-source/` | Gitignored folders for map files from your own client; never built or deployed |

Milestone 2 added `src/geo/` (coordinate transforms and zone attribution), `tools/questiedb/` (the
dataset extractor and validator) and `tools/maps/` (the placeholder geometry importer); the planned
modules (`engine`, `sim`, `validate`, `rxp`, `diff`, `optimizer`, `map`) arrive with their milestones.

## Development

```bash
pnpm typecheck      # three strict configs: pure (ES2023 only, no DOM or Node), app (DOM), node
pnpm lint           # ESLint with type-aware typescript-eslint rules, react-hooks, no-bitwise
pnpm test           # Vitest: node for pure modules, happy-dom for components
pnpm test:watch     # the same, watching
pnpm licence:check  # shipped dependencies against the SPDX allowlist (also run by build)
pnpm build          # vite build, licence gate, third-party notices, dist/ audit
pnpm check          # typecheck, lint, test, data:validate (committed data, no clone needed), build
pnpm maps:validate  # the committed map folders' offline checks (the minimap's M1-M11; tile checks skipped without the tiles)
pnpm maps:minimap:fetch   # the minimap tiles from their release pack (see "Run it")
pnpm build:deploy   # the Pages deploy build: fetch the pack, build, audit with every minimap tile required
```

Tests are deterministic and sit next to the code they test (`*.test.ts`, `*.test.tsx`). Pure
modules never read the clock or generate IDs; tests inject both. `tests/architecture.test.ts`
enforces the module dependency rules, the pure-module ban on browser, Node, clock and randomness
APIs, the ban on bitwise operators (race masks exceed 32 bits), and path hygiene in committed
files. `tests/ui-tokens.test.ts` guards the visual system: reserved difficulty colours, theme
parity and WCAG contrast pairs.

## Data and maps

**Quest data.** The quest, NPC, object, item and zone data are derived from
[QuestieDB](https://github.com/Questie/QuestieDB) (flavour Forever) at a pinned commit
(`b6f5b07b0acf1c820993cbb0ce2521c912bb4c92`) by a reproducible extractor (`tools/questiedb`,
`pnpm data:extract`), and committed in `public/data/` with a manifest and a notice
([docs/DATA_PROVENANCE.md](docs/DATA_PROVENANCE.md)). Nothing in it is edited by hand.

At startup the app fetches `data/manifest.json` and then every file it lists, in parallel, from
the site itself (nothing leaves the origin). It checks each file's size and SHA-256 against the
manifest, and the manifest's own `dataRevision` against its file list, then checks every record's
shape. Only then are spawns converted once to world positions through the committed placeholder
geometry (`public/maps/placeholder/`), which must come from the same QuestieDB pin. A failure
stops the start with a screen that names the file and the reason; nothing partial is shown. The
data badge in the status bar shows the loaded `dataRevision`, and About links the full data
notice. Checking needs WebCrypto, so the site must be served over https (or from localhost).

Neither Questie nor QuestieDB has ever had a root licence file on its default branch, none covering
Questie's own code or data (checked across full history on 2026-09-25; Questie's default branch
carries licence files only for bundled third-party material). An unmerged draft in Questie's
repository says that, when in doubt, Questie should be considered "all rights reserved", and
proposes a contributor licence agreement to relicense contributions. The project owner has chosen
to publish the derived data with prominent notices and accepts the risk. This records a finding and
a decision; it is not a legal conclusion. The details are in
[docs/DATA_PROVENANCE.md](docs/DATA_PROVENANCE.md) §3 and decision D-016.

At the pinned commit, QuestieDB's Forever data is the Classic Era baseline with re-projected
coordinates on four zones: it holds no Forever-specific content yet. Every record therefore
carries "Forever status: unknown", and Forever XP values are assumptions until someone enters
observed ones.

**Maps.** Both base-map styles are Blizzard Entertainment's artwork (© Blizzard Entertainment,
Inc.), extracted from the World of Warcraft: Forever client; they are not this project's work, and
this project's licence grants no rights over them. They are published with their notices by the
owner's decisions D-033 (the painted map art) and D-045 (the minimap textures, on D-033's terms),
which draw no legal conclusion. D-033's terms apply to both: the site stays non-commercial, with no
ads, paid features or sales; Blizzard's copyright and trademark notices accompany the art (the
NOTICE files, this README and the About dialog, which names both notices and says which style is
shown); the art is removed promptly if Blizzard asks
([issues](https://github.com/laurencestokes/forever-route-lab/issues)); and the project never
distributes hacks, cheats or similar content.

The painted style is the game's painted zone maps composed into one map by this project's tool
(`public/maps/atlas/`): each painting is masked to its zone with neighbours' colours blended, a few
painted labels are hidden where a city plan or a duplicate would cut them, this project's own tint
and sea colours fill what no painting shows, and the tiles are resampled and re-encoded as WebP;
[public/maps/atlas/NOTICE.md](public/maps/atlas/NOTICE.md) lists each alteration. The painted
images still drawn one at a time (the battlegrounds, Darkspear Islands and Zephras Isle) are in
`public/maps/art/` ([public/maps/art/NOTICE.md](public/maps/art/NOTICE.md)).

The minimap style's tiles are also Blizzard Entertainment's artwork (© Blizzard Entertainment,
Inc.): the World of Warcraft: Forever client's minimap textures, which D-045 publishes on D-033's
terms and D-049 builds, with no legal conclusion drawn. This project's tool alters them: the water
is recoloured to one navy ramp, the void and edge strips are filled with the navy, the textures are
resampled and joined into one map with Zephras Isle as a card out of position, and the tiles are
re-encoded as WebP; [public/maps/minimap/NOTICE.md](public/maps/minimap/NOTICE.md) lists each
alteration and what is kept as drawn. The tiles are never committed: they ship as a release asset
that carries that notice first, and if Blizzard asks, the asset is deleted, the pointer removed, the
site redeployed and the tile addresses confirmed gone (copies already downloaded cannot be
recalled). Forever Route Lab is not affiliated with or endorsed by Blizzard Entertainment.

The terrain outlines and relief in
`public/maps/terrain/` (D-032) and the navigation data in `public/nav/` (D-028) are derived by
this project from the same client, and each ships with its own notice. Map files you extract from
your own client for local use stay in the gitignored `local-maps/` folder, which only the
development server serves and which the build audit keeps out of `dist/`
([docs/MAPS.md](docs/MAPS.md)). On every load the app asks for `local-maps/maps.manifest.json`
once, to find such a set; where there is none (every deployed site) the browser's developer tools
list that request as a failed "404 (Not Found)" resource. That is expected and harmless: the map
then uses the committed geometry.

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
