# Decisions

Architecture decision log. Each entry records what was decided, why, and what it rules out.
Newest last. An entry's decision is changed only by adding a later entry that supersedes it; the
older entry then gets a **Status** line pointing at its successor. Wording that stated an
unsupported fact or a legal conclusion was corrected in place on 2026-09-25 and is marked
"wording corrected".

## D-001: Licence the repository GPL-3.0-or-later

- **Status:** decision stands; context and rationale superseded by D-016.
- **Date:** 2026-09-25
- **Decided by:** project owner
- **Context (wording corrected):** The quest, NPC and object data come from QuestieDB, which
  derives from Questie. The project brief describes QuestieDB as GPLv3. On 2026-09-25 neither
  `Questie/QuestieDB` nor `Questie/Questie` published a licence file (GitHub API
  `license: null`; `LICENSE` returns 404); D-016 records the full-history finding.
- **Decision:** The whole repository is GPL-3.0-or-later.
- **Why (wording corrected):** The owner's conservative posture for a static site that ships
  Questie-derived data alongside the application code. This is not a legal conclusion; see
  [DATA_PROVENANCE.md](DATA_PROVENANCE.md).

## D-002: Commit the full generated Forever dataset

- **Status:** decision stands; manifest contents superseded by D-026, notices by D-016.
- **Date:** 2026-09-25
- **Decided by:** project owner
- **Decision:** The compact generated dataset under `public/data/` is committed, so the static
  site deploys straight from the repository. It carries a source manifest (upstream repository,
  commit SHA, extraction timestamp, flavour, build, tool version) and GPL notices, and it is
  regenerated only by the reproducible extraction tool, never edited by hand.
- **Rules out:** manually copying Lua tables; committing raw upstream Lua files.

## D-003: Package manager is pnpm

- **Date:** 2026-09-25
- **Decision:** pnpm 10.33.0 is available on the development machine, so the project uses pnpm
  with a committed lockfile.

## D-004: Canonical location is a world point in yards

- **Status:** superseded in part by D-017 (dataset spawns keep the source frame; route locations
  keep the authored point; world points are the runtime form).
- **Date:** 2026-09-25
- **Decision:** Dataset spawns and route-step locations are stored as `WorldPoint { mapId, x, y }`
  (yards, x north, y west, per world map). Zone percent (`MapPoint`) is derived for display with the
  current geometry.
- **Why:** World coordinates are frame-invariant. Forever beta builds already moved four zone frames
  (Mulgore, Stormwind City, Eastern Plaguelands, Redridge), and RXP's own Forever guides mostly use
  world coordinates for the same reason. Map metadata and art can be replaced without touching quest
  data or routes (docs/research/coordinates.md).
- **Rules out:** storing QuestieDB zone percentages as the source of truth; re-applying the
  Era→Forever transform to QuestieDB data at runtime.

## D-005: Leaflet 1.9.4 directly, no react-leaflet

- **Date:** 2026-09-25
- **Decision:** The map renderer is Leaflet (BSD-2-Clause) behind our own `MapAdapter`, with a thin
  in-house React wrapper.
- **Why (wording corrected):** react-leaflet 3.x-5.x declares Hippocratic-2.1, which is outside
  the project's licence allowlist (ARCHITECTURE §16; docs/MAPS.md §7). The adapter also keeps
  Leaflet replaceable.

## D-006: No RXPGuides material in the repository

- **Status:** rule stands; title, method and wording superseded by D-019 ("clean-room" is not
  claimed).
- **Date:** 2026-09-25
- **Decision:** No RXPGuides code, guide text or data tables (zone tables, flight tables, dungeon
  lists) enter this repository, including as test fixtures. The parser is written from documented
  behaviour (docs/RXP.md). Fixtures are self-authored. Zone-name tables come from QuestieDB data.
- **Why (wording corrected):** RXPGuides declares CC BY-NC-SA 4.0 (non-commercial, share-alike);
  the owner's posture is not to combine it with this GPL-3.0-or-later repository.
- **Enforced by:** `tools/build/rxp-overlap.ts` (D-019), replacing the marker check first planned.

## D-007: Forever provenance of dataset quests is `unknown`

- **Status:** principle stands; vocabulary and classifier scope superseded by D-026.
- **Date:** 2026-09-25
- **Decision:** Every QuestieDB quest ships with `forever: 'unknown'` and
  `basis: 'era-baseline-copy'`. `tools/questiedb/diff.ts` implements a three-way classification
  (fork base, current Era, current Forever) for when upstream gains Forever content. The dataset
  manifest carries `foreverContentVerified: false`.
- **Why:** At QuestieDB `b6f5b07`, `data/Forever` is the Era baseline with coordinate projection
  only: zero Forever-only IDs and zero content diffs (DATA_PROVENANCE §9). Calling these quests
  "inherited" would claim a verification nobody has done.

## D-008: Game rules live in a versioned Ruleset with per-value provenance

- **Date:** 2026-09-25
- **Decision:** `src/rules` defines `forever-beta` and `era-1.15` rulesets. Every value records
  its basis (`client-data`, `official`, `reported`, `era-assumed`, `assumption`), source and build.
  Unknown Forever values fall back to Era **visibly**: the UI marks numbers that depend on them.
- **Why:** Most levelling-critical Forever values (XP per quest, kill XP, rested, riding cost,
  flight speed) are server-side and unpublished (docs/research/forever-game-rules.md). Silent Era
  substitution is forbidden by the brief.

## D-009: Data extraction in TypeScript with luaparse and a whitelisted evaluator

- **Date:** 2026-09-25
- **Decision:** `tools/questiedb` parses QuestieDB Lua with luaparse (MIT, dev dependency only)
  and evaluates correction providers with a whitelisted evaluator that throws on any construct it
  does not understand. No Lua runtime is required.
- **Why:** The Milestone 0 experiment reproduced the upstream composed entity count (35,944)
  in about 0.3 s this way. A bundled Lua binary would be platform-specific and unsigned.
- **Consequence:** Each QuestieDB pin bump may need evaluator updates; the tool fails closed.

## D-010: Map art is never committed; committed geometry is QuestieDB-derived only

- **Status:** superseded by D-018.
- **Date:** 2026-09-25
- **Decision:** `public/maps/geometry.json` (zone frames from QuestieDB `conversion.json` target
  bounds) is committed. DB2-only geometry (continents, Azeroth layout, new Forever zones) and all
  map art are produced locally by `tools/maps` from a developer's own extraction into gitignored
  folders. The app falls back to a procedural placeholder map.
- **Why:** An extraction tool's licence grants nothing over Blizzard artwork, and beta terms are
  unknown. Revisit only on an explicit owner decision.

## D-011: wow.export is not part of any scripted pipeline

- **Date:** 2026-09-25
- **Decision:** `tools/maps` consumes files a developer has already exported (DB2 CSV, BLP or PNG)
  and never drives wow.export. If wow.export is used manually, use CDN mode or disable cache
  collection first. wago.tools is used only manually (its robots.txt disallows crawling).
- **Why:** wow.export is GUI-only (no CLI), and by default it uploads `Cache/WDB` and
  `Cache/ADB` files from local installs to a third party (docs/MAPS.md §4.1).

## D-012: Race and class masks use arithmetic bit tests

- **Date:** 2026-09-25
- **Decision:** Masks are JavaScript numbers (exact up to 2^53) tested with
  `Math.floor(mask / 2 ** bit) % 2 === 1`, never `&`. Exact masks 77 (Alliance) and 178 (Horde)
  include the Skyborne race of that faction, following Questie.
- **Why:** Skyborne races use bits 32 and 33. JavaScript bitwise operators truncate to 32 bits.

## D-013: Pin the data frame to build 1.60.1.69893

- **Status:** stands for the dataset and the 49 QuestieDB frames; the committed geometry now
  records a build per row (D-018, D-026).
- **Date:** 2026-09-25
- **Decision:** Dataset and committed geometry record build 1.60.1.69893 (QuestieDB's DBC target).
  The local client build (1.60.1.70009 on 2026-09-25) is recorded separately as observed.
- **Why:** UiMapAssignment is byte-identical at 69893 and 70009, so the frame is current. A future
  pin bump re-runs the geometry equality check in `tools/maps/validate.ts`.

## D-014: Routes are flat lists of atomic steps

- **Status:** decision stands; rationale and the `group` key superseded by D-020 (`groupId` plus
  the `route.groups` sidecar).
- **Date:** 2026-09-25
- **Decision:** Each route step is one action (accept, complete, turn in, abandon, travel, grind,
  hearth, flight, train, vendor, note). An RXP step (a location plus several actions) is lowered to
  several steps sharing a `group` key and is re-grouped on export.
- **Why:** Atomic steps are what the editor, validator, optimiser and diff reason about.
  Container steps would make each of those harder, and the group key keeps RXP round trips intact.

## D-015: Optimiser objective is minimum estimated time for a bounded section

- **Status:** objective stands; contract superseded by D-021.
- **Date:** 2026-09-25
- **Decision:** The optimiser works on a selected section. It must satisfy locked anchors (in
  order) and the obligations the rest of the route depends on, and reach the target XP (by default
  the original section's). It minimises estimated elapsed time, including travel to the step after
  the section. The result is always a proposal.
- **Why:** This is the bounded, human-plus-optimiser workflow the brief asks for. It avoids
  impossible global search and keeps suffix steps valid.

## D-016: Questie licence finding; the owner publishes the derived dataset anyway

- **Date:** 2026-09-25
- **Decided by:** project owner
- **Facts (no legal conclusion; wording corrected after the Milestone 2 review):** A full-history
  check on 2026-09-25 found that neither `Questie/Questie` nor `Questie/QuestieDB` has ever had a
  root licence file on its default branch, meaning none covering Questie's own code or data.
  Questie's default branch does carry licence files for bundled third-party material such as
  `Libs/` and `Icons/`.
  Questie's unmerged `license` branch (commits `ce65498c`, 2023-02-13, to `842201bd`,
  2024-05-06) drafts a `LICENSE.md`. The draft says Questie "historically never had a license",
  and that "when in doubt you should consider Questie as 'all rights reserved'". It also says the
  project intends to default to MIT, and CC0 where MIT is not applicable, through a contributor
  licence agreement (`CLA.md`). That agreement also allows relicensing under GPL-2/GPL-3, BSD and
  CC BY 4.0. The brief's statement that QuestieDB is GPLv3 is therefore not supported by upstream.
- **Decision:** The owner chose to build, commit **and publish** the Questie-derived dataset,
  with prominent notices of this finding, and accepts the risk. This supersedes the rationale of
  D-001 and the context of D-002; both decisions stand.
- **Code licence:** The repository's own code stays GPL-3.0-or-later (owner decision). That
  licence covers this project's contributions. It grants no rights over Blizzard content, or over
  third-party material embedded in upstream data.
- **Notices:** `public/data/NOTICE.md`, THIRD_PARTY_NOTICES.md, the README and the in-app About
  dialog state the finding neutrally.

## D-017: Dataset keeps the source frame; locations keep the authored point

- **Date:** 2026-09-25
- **Supersedes:** part of D-004.
- **Decision:** Spawns ship exactly as QuestieDB publishes them: 0-100 zone percent, keyed by
  AreaTable ID, with the precision as published. That is up to 2 dp, except for 7 values with
  3 dp at the pin (DATA_PROVENANCE §6.5). `infra/data` converts them to `WorldPoint`s at load through `src/geo`,
  so every runtime domain type still sees world points. A route `Location` stores the point as
  authored, as a `SourcedPoint`: either world, or zone percent with its frame and, optionally,
  the original number lexemes. World coordinates are derived at runtime and never persisted.
- **Why:** This is faithful to the source, and 24-52% smaller than rounded world yards. It also
  keeps a project independent of the geometry any one machine has. Percent points on maps that
  lack geometry stay storable, and RXP export reproduces the original coordinate form.

## D-018: Map files: committed placeholder geometry, local maps outside `public/`

- **Date:** 2026-09-25
- **Supersedes:** D-010.
- **Decided by:** project owner (the 12 DB2-only rows) and architect (layout).
- **Decision:**
  - Committed: `public/maps/placeholder/geometry.placeholder.json` plus `NOTICE.md`. This holds
    the 49 zone frames from QuestieDB `conversion.json`. By owner approval it also holds 12
    DB2-only UiMapAssignment rows (947, 1414, 1415, 1463, 1464, 2482, 2521, 2524, 2548, 2652,
    2665): 12 rows for 11 UiMaps, because Azeroth 947 has one row per continent. They were taken
    from CSVs at 1.60.1.70009, fetched as individual requests during research (not scripted
    crawling), and their hashes are recorded. The rows are committed with citations in
    `tools/maps/inputs/db2-rows-1.60.1.70009.json`. Each row records its source and build.
  - Local map sets (art and extra geometry) live in the gitignored `local-maps/` folder at the
    repository root, outside Vite's `publicDir`. Only a dev/preview plugin serves them.
    `vite build` never emits them, and `audit-dist` fails on any map-like output. Map art is
    never committed or deployed.
  - Local geometry is accepted when its rows for the 49 shared frames hash-equal the committed
    rows (frame compatibility), not when build strings match.
- **Why:** Gitignore stops commits, not publication. Anything under `public/` is copied into
  `dist/`.

## D-019: RXP support is an independent implementation from a behavioural spec

- **Date:** 2026-09-25
- **Supersedes:** the wording of D-006; the rule stands.
- **Decision:** docs/RXP.md is a behavioural specification, written after reading RXPGuides
  (which declares CC BY-NC-SA 4.0). The project's posture is not to combine RXPGuides material
  with this repository:
  - **Allowed:** interoperability vocabulary, listed in our own words and our own order (command
    names, tag names, filter words, `.dungeon` tokens, pseudo-zone names).
  - **Forbidden:** RXPGuides code, guide lines or text, and data values. That includes zone,
    flight, dungeon or area tables, flight times, and constants fitted to any of them.
  - Implementers of `src/rxp` work only from RXP.md and self-authored fixtures. They do not open
    the RXPGuides source.
  - `tools/build/rxp-overlap.ts` checks for line overlap with RXPGuides guides at a pinned SHA.
- **Note:** The project does not claim this is "clean-room", and makes no statement about legal
  effect.

## D-020: Route model is atomic steps plus a group sidecar

- **Date:** 2026-09-25
- **Supersedes:** the rationale of D-014.
- **Decision:** Steps stay atomic. `route.groups` holds everything that belongs to an RXP step
  as a whole: tags, waypoints, annotations, step-level conditions and a fingerprint. `complete`
  steps take several targets and a `finish | partial` progress mode. `project.imports` keeps the
  imported guide text, so an unedited guide exports byte-identically.
- **Why:** The critique showed that a bare `group` key loses most RXP step semantics (tags,
  waypoints, annotations, sticky windows) and cannot deliver round-trip export.

## D-021: Optimiser section contract

- **Date:** 2026-09-25
- **Supersedes:** the details of D-015; the objective stands.
- **Decision:** A proposal must:
  - preserve the end state of quests used outside the section;
  - newly block no suffix quest;
  - leave no pool quest open;
  - keep travel state (bind, flight paths, riding, hearth readiness) at least as good;
  - keep locked and implicit anchors in order;
  - bind the other non-quest steps to their quest actions;
  - keep unknown-XP quests.

  The original section is the incumbent, which is always feasible. Pruning uses Pareto dominance
  on exact state keys. See ARCHITECTURE §11.2-11.6.
- **Why:** The first design would have silently dropped unlocked non-quest steps and unknown-XP
  (Forever-new) quests, and it could have broken the rest of the route.

## D-022: Beta-client values in docs and tests

- **Date:** 2026-09-25
- **Decided by:** project owner (no NDA; the Forever beta is public).
- **Decision:** Individual client-derived values may appear in committed docs and tests when
  they cite table, build and column. Examples are UiMapAssignment rows, a few TaxiNode landmarks,
  FileDataIDs and QuestXP rows. Bulk client tables and art stay local. Taxi-derived leg timings
  are **local-only by default** until the owner decides otherwise; clean deploys use the
  straight-line model.

## D-023: TypeScript 6.0.x

- **Date:** 2026-09-25
- **Decision:** Pin TypeScript `~6.0.3`, not 7.x.
- **Why:** typescript-eslint 8.70 declares the peer range `typescript >=4.8.4 <6.1.0`. Revisit
  once typescript-eslint supports TypeScript 7.

## D-024: No constants derived from RXP data

- **Date:** 2026-09-25
- **Decision:** The default flight-time model is straight-line distance × a detour factor, at
  the emulator taxi speed of 32 yd/s (`era-assumed`). The model fitted to RXPGuides' flight table
  during Milestone 0 research is not used, and its coefficients are not committed as defaults.
- **Why:** D-019 forbids RXP data values, and constants fitted to those values derive from them.
  The fitted coefficients do not appear anywhere in the repository, research docs included. The
  default `taxiDetourFactor` is a cited aggregate over client TaxiPathNode data (allowed under
  D-022), not an RXP-derived value.

## D-025: Deployment hygiene

- **Date:** 2026-09-25
- **Decision:** Deployable builds come from CI on a clean checkout. `audit-dist` enforces the
  map, path, file-type, size and notice rules in ARCHITECTURE §16. `licence-gate` enforces an
  SPDX allowlist for shipped dependencies.

## D-026: Provenance vocabulary, manifest contents and build recording

- **Date:** 2026-09-25
- **Supersedes:** D-007's vocabulary and classifier scope; D-002's manifest contents; D-013's
  single-build wording for the committed geometry.
- **Decision:**
  - **Provenance** of quests, NPCs, objects and items is `RecordProvenance`:
    - `upstreamDiff` (`era` | `era-coords` | `forever-new` | `forever-changed`) is a fact
      about QuestieDB;
    - `foreverStatus` (`unknown` | `user-declared-new` | `user-declared-changed`) is a claim
      about the game;
    - plus `corrected`, `created` and `source`.

    Every dataset record ships with `foreverStatus: 'unknown'`. `tools/questiedb/diff.ts` is
    first a pin-to-pin dataset diff; its three-way classifier is a stub that returns `unknown`
    until upstream holds Forever content.
  - **Manifest:** `public/data/manifest.json` is the single authoritative manifest
    (DATA_PROVENANCE §8). Its fields:
    - a content-addressed `dataRevision`, a SHA-256 over the sorted output paths and hashes;
    - `toolTreeHash` in place of a tool version or commit;
    - per-output `origins`;
    - no extraction timestamp. That goes in the gitignored `generated/questiedb-report.json`.
  - **Geometry builds:** every row of the committed placeholder geometry records its own source
    and build. The 49 QuestieDB frames are at 1.60.1.69893. The 12 DB2 rows are at 1.60.1.70009.
    Together these 61 rows are the whole UiMapAssignment table at 1.60.1.70009, committed by
    explicit owner approval (D-018). That makes it an exception to D-022's "bulk tables stay
    local".
- **Why:** The Milestone 0 consistency check found the older wording contradicting
  ARCHITECTURE revision 2 and DATA_PROVENANCE.

## D-027: The store's React binding lives in `src/app/react.ts`

- **Date:** 2026-09-25
- **Decision:** `src/app/react.ts` (`useEditor`, the store context) is the one file in `app` that
  imports React. Everything else in `app` stays framework-agnostic, and the architecture test
  allows React in that file only.
- **Why:** The binding is about the store's subscription contract (`useSyncExternalStore`
  semantics, snapshot caching), so it is tested with the store. Keeping it beside the store
  avoids a `ui` file reaching into store internals. The Milestone 1 review (F6) found the
  exception existed only in the test; this entry and ARCHITECTURE §4 now record it.

## D-028: Terrain-aware travel from committed, derived navigation data

- **Date:** 2026-09-25
- **Decided by:** project owner (scope, publishing, extraction method); architect (design).
- **Decision:**
  - Travel time goes through a pluggable `TravelModel` (ARCHITECTURE §9.1).
  - The straight-line × detour model stays as the labelled fallback.
  - A navigation model built from the Forever client's world geometry is the preferred model
    whenever its data is present. That geometry is terrain, liquids and holes, plus the collision
    of placed objects (WMO and M2): bridges, tunnels, buildings and cities.
  - The **derived** navigation data (a compact walkability or navmesh representation plus
    connectors, never raw game files or art) is **committed and deployed** with provenance
    notices. That is the same posture as the committed DB2 rows (D-018, D-022), and the owner
    accepts it.
  - Extraction uses **our own read-only TypeScript CASC reader**. It reads the local install's
    `Data/` folder only, never `Cache/`, `WTF/` or `Logs/`. It requires no new system
    software, and it is pinned to a recorded build.
  - Connectors (bridges, tunnels, elevators, portals) come from client geometry or cited data,
    never from guesses.
  - A new **Milestone 3b: Terrain navigation** runs after the map milestone, so simulation (M6)
    and the optimiser (M7) are built on it. It starts with a research and design step (CASC
    reading, ADT/WMO/M2 collision, grid vs navmesh, size and query cost), followed by an
    independent critique.
- **Why:** The optimiser chooses routes by travel cost. A model that walks through cliffs, lakes
  and mountains would confidently propose routes no player can walk. Terrain alone is not enough,
  because bridges, tunnels and cities are object geometry.

## D-029: Reuse of WoWF-QRP code is allowed, with attribution; its data is not

- **Date:** 2026-09-25
- **Decided by:** project owner
- **Context:** WoWF-QRP (https://github.com/tyba-dev/WoWF-QRP, a friend's project) declares
  GPL-3.0 in its `LICENSE` at commit `c1e3fcf31be65d742858c1e87a5ce87b3565da60`. The owner said
  its code may be reused if needed.
- **Decision:** Code from WoWF-QRP may be read and ported where it helps, mainly for Milestone 3b
  navigation and path-finding. Conditions:
  - Each ported file or block keeps the original copyright and licence notice and names the
    source path and commit.
  - Every port is listed under "Ported code" in THIRD_PARTY_NOTICES.md.
  - Ported files are marked as carrying GPL-3.0 terms. This project is GPL-3.0-or-later; this is
    a compliance posture, not a legal conclusion.
- **Excluded:**
  - WoWF-QRP's data (`data/bundle.b64`, `tiles/`), which its README says is derived from
    Blizzard game files. We derive our own from the client (D-028).
  - Its RXP code. `src/rxp` implementers keep working only from RXP.md (D-019).
- **Note on approach:** Its `tools/nav.py` says it builds a walkability grid from Forever spawn
  and patrol-path positions. Milestone 3b derives walkability from the client's terrain, liquids
  and object collision instead (D-028). A spawn-inferred grid may serve as an independent
  cross-check, not as the source.

