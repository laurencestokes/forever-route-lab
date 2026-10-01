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

## D-030: Navigation data budget: the lighter mesh

- **Date:** 2026-09-26
- **Decided by:** project owner
- **Context:** The Milestone 3b research prototype measured about 8.6 MB gzip for both continents.
  The critique showed its settings disconnect quest caves (Skull Rock, Burning Blade Coven) and
  Thunder Bluff's rises. The accurate fix (0.52 yd cells) costs about +25%, roughly 11-12 MB
  (docs/research/terrain-navigation.md; critique TN-01, TN-09).
- **Decision:** Target a lighter, less accurate mesh of about 5-6 MB gzip in total, with a hard
  cap of 7 MB, in its own gated `nav` budget. Measurements use gzip level 6 and decimal units.
  A mandatory **spawn-census gate** lists every dataset spawn that snaps outside the main
  connected component of its map, each with a reviewed reason. Disconnections caused by the
  coarser mesh are therefore visible and never silent. Build settings are chosen by measured
  sweep against the budget and the census.

## D-031: Elevator and lift connectors come from the owner's in-game observations

- **Date:** 2026-09-26
- **Decided by:** project owner
- **Context:** Thunder Bluff's, Undercity's and the Great Lift's elevators are server-spawned and
  absent from client files.
- **Decision:** Connectors are cited in-game observations recorded by the owner: endpoints as
  `/way` coordinates, ride and wait seconds, date and build. Transport keyframe data may supply
  ride times where a transport id is cited (D-022). Until a connector exists, a leg between
  disconnected parts of one map uses the labelled straight-line fallback (basis `assumption`)
  plus a warning. It is never reported as a confident path, and never silently unknown.
- **Not now:** a general in-game calibration set of walked legs (owner: "not now"). Navigation
  estimates stay labelled `derived` (mesh-derived), and calibration remains an open item.

## D-032: Terrain-derived map byproducts are committed and deployed

- **Date:** 2026-09-26
- **Decided by:** project owner
- **Decision:** The terrain pipeline's map byproducts are committed and deployed with provenance
  notices, extending D-028. They are:
  - coastlines and zone outlines (vector geometry from terrain and per-chunk area ids);
  - a low-resolution shaded relief raster derived from heightmaps.

  They are derived from client terrain data, not from Blizzard's painted map art, which stays
  local-only (D-018). The deployed map can then show terrain-shaped zones instead of rectangles.
- **Provenance:** the same posture as D-018 and D-028. Each output records its pin, build, input
  hashes and tool tree hash, and carries its own NOTICE.

## D-033: Blizzard's painted map art is extracted, committed and deployed

- **Date:** 2026-09-26
- **Decided by:** project owner
- **Supersedes:** D-018's art rule (map art "never committed or deployed") and OD-10. D-018's
  `local-maps/` arrangement for developer-local sets stays.
- **Owner's rationale, recorded as stated, not verified here:** many third-party sites already
  show Blizzard's map art, and the owner believes Blizzard's policies allow this for third-party
  fan sites. This log draws no legal conclusion. The owner accepts the risk, as with D-016.
- **Decision:**
  - The world map's painted art is committed and deployed with a NOTICE. That covers the zone and
    continent images assembled from the client's UiMapArt / UiMapArtTile textures, and the
    WorldMapOverlay "explored area" pieces where they apply.
  - Extraction is reproducible. It uses our own read-only CASC reader over the local client's
    `Data/` folder (D-028), is pinned to a recorded build, and records per-file input hashes and
    the tool tree hash. The output is web images with a manifest, under a committed map-art
    folder, with its own size budget in the dist audit.
  - The procedural layers from D-032 (coastlines, zone outlines, relief) remain. They render where
    the painted art is missing or too coarse at close zoom.
- **Consequences:** the dist audit's map-image rule becomes an allowlist: the committed art folder
  and its manifest and NOTICE only. THIRD_PARTY_NOTICES, the README and the About dialog name
  Blizzard Entertainment as the owner of the artwork and state non-affiliation.
- **Governing source, recorded 2026-09-26:** Blizzard's Legal FAQ,
  https://www.blizzard.com/en-us/legal/c1ae32ac-7ff9-4ac3-a03b-fc04b8697010/blizzard-legal-faq,
  section "Copyright/Trademark Policy for the Internet". It grants a limited licence for "home,
  noncommercial and personal use only". Copyright and other notices must be kept. The licence is
  revocable at Blizzard's discretion, and it excludes sites with objectionable content, including
  hacks or cheats. The FAQ's mention of "fan-created maps" concerns custom game levels, not map
  artwork. Whether a public fan site hosting extracted map art fits "personal use" is not settled
  by the text, and no conclusion is drawn here.
- **Supporting context supplied by the owner:** third-party sites (MapGenie and Wowhead are the
  examples given) host stitched Blizzard map art for reference, quest tracking and coordinates.
  That is evidence of practice, not permission.
- **Project rules adopted from the FAQ's conditions:**
  1. The site stays non-commercial: no ads, paid features or sales.
  2. Blizzard copyright and trademark notices accompany the art (NOTICE, About dialog, README).
  3. The art is removed promptly if Blizzard asks.
  4. The project never distributes hacks, cheats or similar content.

## D-034: Milestone 3b interpretations (architect; the owner may overrule)

- **Date:** 2026-09-26
- **Context:** The re-critique of the revised terrain design (GO with conditions, RC-01..RC-13).
- **Decisions:**
  1. **Portals and teleporters** (for example Rut'theran Village ↔ Darnassus) are connectors under
     D-031. They are cited owner observations with a `teleport` type: endpoints, cast or wait
     seconds, date, build. Until one is recorded, the labelled fallback plus a warning applies.
  2. **Same-map transports** (for example the Auberdine ↔ Rut'theran boat) go through
     ARCHITECTURE's `TravelGraph`. The route is a walk to the dock taken from the leg table, then
     the transport edge, then a walk from the dock. The straight-line fallback applies only when no
     such path exists.
  3. **Per-polygon top-level zone ids** in the committed navigation blocks count as part of D-032's
     committed zone outlines. They are the same derived information at polygon resolution, from
     MCNK area ids and WMOAreaTable.
  4. **Map-art budget (D-033):** a separate gated `art` budget of at most 12 MB gzip-6 in decimal
     units, with per-file baselines. The terrain byproducts (D-032) get their own `terrain`
     budget, at most 600 kB.
  5. **Unverified passages** found by the mesh (the Undercity west tunnel, the Ironforge mountain
     top) are tagged at build time. Any leg whose corridor crosses one carries an "unverified
     passage" warning, and the owner's in-game check is tracked in STATUS. The navigation model
     is still preferred on map 0, because the warning keeps the claim honest.

## D-035: Project schema v1 is frozen from the Milestone 4 commit; Milestone 5 RXP rules ratified

- **Date:** 2026-09-26
- **Supersedes:** ARCHITECTURE §8.2's "unstable until the end of Milestone 6".
- **Context:** Milestone 4 autosaves users' projects to IndexedDB under the strict v1 schema. A
  later v1 change would leave every stored project unopenable (review CR-15).
- **Decision:**
  - From the Milestone 4 commit, every change to the project schema bumps `schemaVersion` and adds
    a migration to `src/project/migrations.ts`, with a test. The migration-backup path already
    exists. Milestone 6 (simulation and validation) follows the same rule.
  - Ratified RXP import rules (Milestone 5):
    - importing as a new project uses the default character, the same as "New project";
    - "append" means the end of the route;
    - unknown quests are collected from step quest ids only (accept and turn-in with their
      any-of alternatives, complete targets, abandon), not from skip conditions.

## D-036: Milestone 4/5 implementation choices and deferred decisions

- **Date:** 2026-09-26
- **RXP spec choices** (recorded in docs/RXP.md and ratified here, review F19):
  1. Degenerate filter spellings print back as written: `-`, `/` and `(/)`.
  2. A group written directly against a word, such as `(Orc)(Troll)` or `Orc(Warrior)`, is
     modelled as one merged word that never matches. This is UNVERIFIED in game and is reported
     with RXP016.
  3. A custom quest's objective count is trusted for "complete all objectives" export when it is
     above 0.
  4. The unedited-group check compares against the template first.
- **Deferred with triggers:**
  - **Chunked step storage** (CR-06). IndexedDB autosave of a 10,000-step project measures 35 ms
    unthrottled and is estimated at about 140 ms at 4× throttle. If the Milestone 9 throttled run
    exceeds the 50 ms budget, store steps in chunks (a database version 3 migration).
  - **Lazy Projects and Import/Export dialogs** (CR-19). Splitting `ProjectMenu.tsx` and
    `ImportExport.tsx` is deferred until the entry chunk nears its 250 kB budget. It is 206 kB now.
  - **PERF-2** stays open. The browser p90 for a 10,000-step move is up to 8.7 ms against 8 ms.
    The Node bench (`tests/bench/map-edit.bench.ts --check`) guards against regression.


## D-037: The travel contract lives in `src/domain/travel.ts`; census notes accepted for the MVP gate

- **Date:** 2026-09-26
- **Travel contract.** `TravelEndpoint`, `TravelSpeeds`, `TravelWarning`, `TravelLeg` and
  `TravelModel` are hand-written domain types, so the pure modules (engine, simulation, optimiser)
  and the app's navigation model share one contract without an import between them.
  - It refines terrain-navigation.md §9.3: `leg()` returns the seconds and also how they were
    obtained (`navigation`, `same-map-transport` or `straight-line`), whether they are pending,
    and structured warnings. The simulation passes those through, and the validator turns them
    into `SIM-` codes. Only `src/validate` owns issue codes.
  - `legSeconds()` from the first sketch is replaced by `leg().seconds`.
  - A leg exists only on one world map. Moves between maps go through the `TravelGraph`.
- **Census gate (D-030).** 283 of the 298 census review entries are notes drafted from explicit
  geometry rules (`pnpm nav:review-draft`, marked "rule:"). The other 15 are individual reviews.
  The architect accepts this for the MVP gate, for two reasons:
  - every entry names its rule and can be re-reviewed individually;
  - the individually reviewed entries cover the must-connect exceptions (Dustwind Cave, the
    Burning Blade hilltop), the zone checks, Teldrassil and Darnassus, the Thunder Bluff rises,
    Rut'theran Village and the Ban'ethil chamber.

  One must-connect place from terrain-navigation.md §4.5 has only a rule-drafted note: Zamja's
  upper floor in Orgrimmar (195 polygons, 22 spawns, anchor npc 2855). All 22 spawns snap to the
  main floor below it. The note records the geometry and nothing else, so an individual review of
  this place is owed. The owner may require individual review of every entry instead.

## D-038: Milestone 6 and 3b.6 implementation choices (architect; the owner may overrule)

- **Date:** 2026-09-26
- **Context:** the Milestone 6 and 3b.6 build and review ([reviews/review-m6-3b6.md](reviews/review-m6-3b6.md)).
- **Simulation:**
  1. QXP-3 erratum: the level cap is checked before a missing XP record, and a lower bound that
     reaches the effective cap is exact.
  2. New facts `grind-zero-rate` and `position-unknown` (with its cause).
  3. New codes `DATA003-unknown-objective`, `SIM005-hearth-cooldown-uncertain` and the route-level
     `SIM023-start-xp-beyond-level`. SIM-22 is a route-level info.
  4. TIME-7 erratum: a dock-only transport with no step location raises no SIM-4.
  5. A hearth wait after unknown time is unknown (`SIM005`), never a definite wait.
  6. Start XP beyond the start level carries over through XP-2, with a warning.
  7. `dungeonMobXpMultiplier` applies in raids (INFERRED). An instance of unknown type counts as a
     dungeon.
  8. A flight master matches a local taxi node within 50 yd.
  9. Pure caches are shared per (rules, dataset), so a context change walks a cold walker with warm
     pure caches.
  10. The remaining SIMULATION §1.5 clarifications are ratified.
- **Budget scope (ARCHITECTURE §14):** the 20 ms walk + simulate + validate budget applies to a
  realistic 10,000-step route. The 10,877-issue stress route keeps a 40 ms ceiling as a regression
  guard. Benches gate bundled, normalised by a CPU probe.
- **Derived results:**
  - They live in their own store beside the editor store.
  - The pipeline is lazy-loaded.
  - Results are not "final" while legs are pending or the navigation data is being checked.
  - One pending reason covers the whole route (checking, computing, retrying, paused, failed).
  - `cancelPaths` pauses automatic computing until `resumePaths` or `computePaths`. A caller's
    abort of `computePaths` stops only its own wait.
- **Navigation runtime:**
  - Blocks are pinned per search, not per request.
  - The LRU budget counts typed arrays (100 MB of the 128 MB heap target).
  - A worker that fails to start (20 s timeout) or crashes turns navigation off everywhere
    (`worker-failed`).
  - Fetches time out after 30 s. HTTP 408, 425, 429 and 5xx are retried; 403, 404 and 410 turn
    the map off.
  - `internal` errors are retried 3 times per map, and then that map is turned off.
  - A transport composition stays pending until every dock walk is known.
  - Navigation legs are `derived` with `eraFallback` false.
  - A user dock is used only when its transport has exactly one stop on that map.
- **UI:**
  - Metrics: time, XP and XP/h sit in the status bar. The level reached and the time shares sit in
    a Summary disclosure.
  - One estimate column per row, chosen with "Rows show".
  - The computing-paths item sits in the status bar, with the status-bar priorities and
    breakpoints of the fix pass. The bar wraps at 1024 px and below.
  - Focus stays on the status item when computing ends.
  - XP/h is `?` when both time and XP are missing.
  - "Info issue(s)" is the wording for the info severity.
- **Superseded before commit:** the map specialist's "one art image at a time" rendering stays only
  until the seamless atlas replaces it (owner feedback, 2026-09-26). Its relief opacity and
  zone-frame settings will be revisited there.

## D-039: Map presentation data and icons (owner, 2026-09-26)

- **Date:** 2026-09-26
- **Decided by:** project owner (A, B, C and E); architect defaults (D and F), which the owner may
  overrule.
- **Context:** docs/research/map-presentation.md §22. The presentation layer (quests, dungeons,
  flight paths, transports, zone colouring) is modelled on WoWF-QRP and MapGenie.
- **Decisions:**
  - **A. Icons:** our own glyphs. No Blizzard interface icons are extracted or deployed. D-033
    stays limited to map art.
  - **B. Taxi graph: commit.** This covers the flight nodes, edges, 3D path lengths, shapes
    simplified to 25 yd, and the transport stops, from the client's `TaxiNodes`, `TaxiPath` and
    `TaxiPathNode` (build 1.60.1.70009, with FileDataIDs, CKeys, the WoWDBDefs commit and the tool
    tree hash recorded), about 27 kB gzip, with a NOTICE naming Blizzard. This settles OD-6:
    deployed builds get per-leg flight times from real path lengths (TIME-6 semantics). Transports
    get dock positions, which closes the dock gap left by NAV-08.
  - **C. Zone faction and sanctuary: commit** (`AreaTable.FactionGroupMask` and the sanctuary bit,
    about 0.5 kB; the decodes are INFERRED). They drive only an optional overlay, off by default,
    drawn as hatching and words, never red or blue fills.
  - **D. Client zone level proxies (`AreaTable.ExplorationLevel` spans): not committed** (architect
    default). Zone spans are derived at run time from the committed dataset, and cited ruleset text
    covers the new zones.
  - **E. Dungeon tuning levels: commit** (`LFGDungeons.ContentTuningID` → `ContentTuning`, about 30
    rows). Each is shown as one number labelled "LFG tuning level (client), meaning unverified",
    never as a range.
  - **F. Raids with no dungeon-finder row** (AQ20, AQ40, Naxxramas): hidden by default (architect
    default).
- **Rules that still apply:**
  - The difficulty colours are used only for difficulty, and cyan only for provenance.
  - Every committed client table has a manifest, a NOTICE and reproducible extraction with
    `--check`.
  - Nothing is fabricated.

## D-040: A turn-in carries objective work that no step completed (owner, 2026-09-26)

- **Date:** 2026-09-26
- **Decided by:** project owner. The details are the architect's, and the owner may overrule them.
- **Context:** TIME-11 treated objectives still open at turn-in as completed incidentally, at 0 s
  and 0 kill XP. A route with only accept and turn-in steps therefore undercounted both time and
  XP.
- **Decision:** when a quest accepted in this route reaches its turn-in with objectives that no
  `complete` step finished, the turn-in step carries their work. That means the TIME-9 seconds and
  kill XP of each open objective, combined as a multi-target `complete` (TIME-10 overlap). The
  basis is `assumption`.
  - A fact records the carried objectives.
  - The validator raises an issue suggesting a `complete` step. Travel to the objective area is
    not priced, so the time is a lower bound there.
  - `partial` steps still cost only their override, and the carried work lands on the turn-in.
- **Not carried:**
  - quests only assumed to be in the log (unknown prior history) or declared in the prior quest
    log: their objective state is unknown, so they stay incidental with the existing fact;
  - failed quests;
  - objectives already finished.
- **Rulings (architect, after the D-040 review, 2026-09-26):**
  1. Carried work is priced at the turn-in's starting level and at no point, as a `complete` step
     without a location: open-world kills, and the lowest drop NPC id for items.
  2. Carried kill XP is granted before the quest XP, so the quest XP and LINT-4 use the level
     after the kills.
  3. Unknown quest XP on the turn-in still counts the known kill XP into the level and the route's
     known XP total (both lower bounds then).
  4. An item objective priced by a `complete` step while its quest was not in the log counts at
     the next accept (`itemsBeforeAccept`), so it is never priced twice. This is the review's
     reading of the game, not yet checked in game.
  5. Kill, `killCredit`, object, spell and event work done before the accept does not count in
     game, so the turn-in carries it again. The route then includes it twice, as the game needs it
     twice, and SIM-16 warns on the early step.
  6. `VAL030-objectives-carried` is a warning. Its wording follows the fact's `time` (`counted`,
     `overridden` or `unknown`).

## D-041: Map look, quest-mark colour and external links (owner, 2026-09-26)

- **Date:** 2026-09-26
- **Decided by:** project owner (G, H and J); architect defaults (I and K), which the owner may
  overrule.
- **Context:** docs/research/map-presentation.md revision 2, "Decisions for the owner".
- **Decisions:**
  - **H. Base-map look: Blizzard's painted art** (D-033), composed seamlessly from world to zone
    by the atlas design (docs/research/map-atlas.md). Our own tint appears only where the art fails
    the design's acceptance criteria. No flat biome-tint "terrain" style is built.
  - **G. Quest marks take the quest's difficulty colour**, meaning the exact WoW
    grey/green/yellow/orange/red against the character's level at the selected step, from 11 px
    upwards.
    - Pips carry the same information, so colour is never the only cue.
    - Smaller marks stay ink-coloured.
    - This is a difficulty use of the difficulty colours, so the colour reservation holds.
  - **J. A Wowhead link in a quest's pop-up**, marked as an external site and opening in a new tab.
  - **I. Graveyards:** not now; no sourced table.
  - **K. Other sites' pages** (WoWF-QRP, MapGenie) are studied with read-only viewing only. Facts
    obtained earlier by running scripts in MapGenie's page are marked INSPECTED and carry no design
    weight.

## D-042: The map atlas (owner and architect, 2026-09-27)

- **Date:** 2026-09-27
- **Decided by:** the owner decided O9, O3 and O11 when shown the prototype sheets. The other rows
  are the design's recommended defaults, adopted by the architect, and the owner may overrule them.
- **Context:** docs/research/map-atlas.md revision 2, and its review
  (docs/reviews/review-map-atlas-design.md). It answers the owner's feedback of 2026-09-26 on
  speed, flow from the world view to a zone, both continents at once, and Zephras Isle.
- **Owner:**
  - **O9 layout:** compact. The Eastern Kingdoms are placed 7,168 yd west of their 947 position,
    and Zephras Isle's card sits at the top of the gap. As a result the game's world painting
    (947) is not shown at the farthest zoom (O4 closed).
  - **O3 sea:** painted-water tones as in the revision 2 prototype, from rgb(131, 118, 88) at the
    coast to rgb(61, 55, 41) offshore, with a contrast of at least 2.5:1.
  - **O11 alterations covered by D-041 H:** the atlas tiles make five changes to Blizzard's art:
    1. each painting is masked to its terrain polygon, painted ground and coastal band, and
       neighbouring paintings' colour is cross-faded over ±200 yd;
    2. nine painted labels are hidden by a mirror fill from the same painting;
    3. our own relief-shaded tint fills land that no painting shows;
    4. our sea colours fill the water outside the coastal bands;
    5. the art is resampled and re-encoded as WebP q80.

    These changes are listed in the art NOTICE and manifest. No legal conclusion is drawn, and
    D-033's other terms stand.
- **Defaults (owner may overrule):**
  - O1: the atlas replaces the per-world-map surfaces for maps 0, 1 and 2991. "Kalimdor" and
    "Eastern Kingdoms" stay as view presets.
  - O2: Zephras Isle appears as a captioned card ("not in position"). Darkspear Islands keeps its
    own battleground surface.
  - O5: the budgets become `atlas` ≤ 8.0 MB and `art` ≤ 1.0 MB, superseding D-034's 12 MB art cap.
    The per-image art the atlas replaces is no longer deployed.
  - O6: land with no zone painting gets the area tint, shaded by the relief.
  - O7: the wheel moves 0.5 level per physical notch after calibration, with the trackpad
    calibrated separately.
  - O8: the owner signs off a contact sheet before the tiles are first committed and after any
    parameter change.
  - O10: the seven zones stored more than 1.2× coarser than their art are rounded up (6.88 MB).
- **Architect:**
  - A1: placement is a translation only, in yards and in whole 1,024-yd tiles.
  - A2: map layers are built per world map and joined in the controller, so only the adapter sees
    atlas coordinates.
  - A3: one tile layer with virtual and sea keys, plus a level −5 underlay.
  - A4: the Leaflet 1.9.4 internals the design names are pinned.
  - A5: clicks always resolve to a world point.
  - A6: the atlas is built from the lossless client rasters, with `--check` as a manual gate until CI.
  - A8: zone rectangles are not drawn while tiles show.
  - A9: the layout lives in `src/geo/atlas-layout.ts`, pinned by T4, with a file-level architecture
    rule.
  - A10: the underlay plus ancestor-first tiles, with `fadeAnimation` off.
  - A11: labels are governed by `tools/maps/inputs/atlas-labels.json`, and T7 fails on any cut label.
- **Supersedes:** D-034 item 4 (the 12 MB art budget), and the interim "one art image at a time"
  rendering (D-038, "Superseded before commit").

## D-043: Milestone 7 optimiser choices (architect; the owner may overrule)

- **Date:** 2026-09-27
- **Context:** docs/research/optimizer-m7.md (revision 2 and its §19 as-built notes), the plan
  review (docs/reviews/review-optimizer-m7-plan.md) and the Milestone 7 review
  (docs/reviews/review-m7.md).
- **Decisions:**
  1. **Stage 1 scope.** The section's own accept, complete and turn-in units are reordered or
     dropped, and one grind fill may be appended at the end of the section.
     - Adding new quests (`allowNewQuests`) is refused until stage 2.
     - Hearth and flight moves wait for stage 3 and the committed taxi graph (D-039 B).
  2. **Grind fill:** the default is `'shortfall'`, so grinding covers only the XP the kept quests
     cannot reach. Replacing quests with grinding (`'replace-quests'`) is an explicit choice for a
     run.
  3. **Rule 3 is relative:** each pool quest keeps all of its units or none of them.
  4. **Availability during search** comes from relations oriented by the original order, plus
     level and log-capacity checks that must be no worse than at the original position. The
     engine and validator re-walk the result, and that re-walk is the final authority.
  5. **Travel matrices:** one per riding tier, in integer milliseconds, built from
     `TravelModel.leg` once the leg table is filled.
  6. **Duplicate detection** uses two arithmetic hash lanes (primes 2147483647 and 2147483629)
     with an exact compare on every hit. XP is part of the key.
  7. **Uncertain hearth waits:** solutions are ranked by `comparedMs`, while `estimatedMs` is what
     gets checked against the engine. The UI shows the guaranteed saving (incumbent − `comparedMs`).
  8. **Compile budget:** ≤ 30 ms applies to the main-thread compile after the walks, gated warm.
     First-call figures are reported, not gated.
  9. **Search contract:** a local pass after each rollout (window 24) is part of the fixed
     work-item order.
  10. **Parity bound:** max(1 ms, min(1%, 4 ms × (steps + exit steps))).
  11. **A numeric XP target above the original's:** the incumbent is the original plus its fill.
      `no-improvement` returns it with a non-empty diff. If it fails verification, the run is
      `infeasible`.
  12. **Diff:** partial apply uses the new placement rule. When a quest and its prerequisite both
      move, their change-sets require each other. This is to be built in Milestone 8, and until
      then the M8 re-walk catches the case.
  13. **No Milestone 7 UI.** The proposal UX is Milestone 8.

## D-044: Optimiser search quality after the seeds (architect; the owner may overrule)

- **Date:** 2026-09-27
- **Context:** the search-quality review of the seeds and local pass (review M7Q, findings Q-01 to
  Q-10), docs/research/optimizer-m7.md §19 and ARCHITECTURE §11.4. It follows D-043 items 2 and 9.
- **Decisions:**
  1. **The drop move is off under `'keep-original'` (Q-05; the owner's call, default proposed
     here).** With the `'shortfall'` fill and the original's own XP as the target, the local pass
     never drops a quest. The drop relied on extra kill XP from reordering, which is estimated and
     thin (192 XP, 0.2%, in the bench pool), and it fired in 39 of 40 generated pools. With a
     numeric target or `'replace-quests'` the move stays on, because the request asks for less XP
     or lets grinding replace quests. Closing can still leave out an optional quest an order does not
     schedule, as the contract allows (§11.2 rule 3). So every result lists the quests it leaves
     out (`OptimizationResult.dropped`), and Milestone 8 shows them. The alternative the owner may
     choose instead is a margin: allow the drop under `'keep-original'` only when the rest exceeds
     the target by a set amount. **Adopted as the default (architect, 2026-09-27).** Milestone 8
     offers "allow dropping quests" as an explicit per-run option.
  2. **Kicks after the seeds (Q-01).** An iterated local search spends the budget after the
     seeds. Each kick swaps two adjacent segments of the best order (1-30 units each), repairs the
     precedence edges inside the span, and runs the local pass from there. It accepts an equal or
     lower `comparedMs`, and draws its kicks from a fixed Lehmer sequence, so runs stay
     deterministic. The beam runs first only when it can reach a closing depth within the budget
     (width × depth × units enabled at the root / 2 evaluations). Kicks follow an exhausted beam in
     sections of 16 units or more; a smaller section gets one last pass over the best instead.
  3. **Stop on stall (Q-07).** The kicks end, with termination `converged`, after
     max(100,000, 2,000 × units) evaluations without a strict improvement. The default budget stays
     4,000,000 evaluations.
  4. **The insertion seed's allowance (Q-03).** The seed may spend min(700 × units, budget / 2)
     evaluations. After that, nearest neighbour finishes its partial order, so the spend always
     yields a route. The allowance does not grow with the budget, so a larger budget only continues
     the same run.
  5. **The quality gate (Q-02).** The bench compares eleven generated pools with a stored,
     independent reference: for each pool, the better of two runs of 20,000,000 evaluations, from the
     nearest-neighbour seed, with other kick streams, one with the local pass's pre-screen and one
     pricing every move exactly. `--check` fails when the median gap exceeds 3% or any pool's
     exceeds 7%. The nearest-neighbour tour is the search's own first seed, so it is reported, not
     gated.
  6. **Divergence penalty (Q-08).** Under a divergence penalty above 0, the seeds, the pass and the
     kicks stay off, because they reorder freely and do not price divergence. From a weak route,
     the search under a penalty is still the beam alone, so review-m7 open item 1 stays open there.

## D-045: MapGenie-style map: minimap base, painted style as a toggle, pins and category panel (owner, 2026-09-27)

- **Date:** 2026-09-27
- **Decided by:** project owner.
- **Context:** the owner asked for "a mapgenie.io style overall (which I think would be better)".
  MapGenie's map (map-presentation.md §3.2) has:
  - a seamless top-down "minimap-style" render with buildings at close zoom;
  - a navy sea;
  - teardrop pins with a glyph per category;
  - a category panel with counts, show/hide and search.
- **Decisions:**
  1. **Base map: the client's minimap textures**, extracted read-only through `tools/casc` and
     deployed as the atlas tiles. They are Blizzard art: a new publishing step beyond D-033,
     which covered the painted map art. D-033's terms apply to them in the same way:
     - non-commercial;
     - a NOTICE naming Blizzard, with non-affiliation;
     - removal on request;
     - a manifest with provenance, `--check` and the dist audit's allowlist.
     No legal conclusion is drawn.
  2. **The painted zone-map atlas (D-042) stays as a switchable map style.** The minimap style is
     the default. Both share the atlas surface, placements, tile engine, underlay and smooth
     wheel. The budgets are set from the probe's measurements, in an addendum to
     docs/research/map-atlas.md.
  3. **Presentation: MapGenie-style pins and a category panel, plus our route-planning extras.**
     - Pins are teardrops with a glyph per category.
     - The side panel lists the categories with counts, show/hide, "Show all"/"Hide all" and a
       search that filters the map.
     - The extras are zone names with level spans, the flight network, quest state at the
       selected step, and the route line.
     - Faction is shown by glyph and outline, never by MapGenie's red, blue or yellow, because
       those hues are reserved for difficulty. Quest pins keep D-041 G: the difficulty colour with
       pips, from 11 px.
     - D-039 A stands: these are our own glyphs, not Blizzard interface icons.
  4. **Sea:** navy in the minimap style. The painted style keeps D-042's painted-water tones.
- **Supersedes:** D-041 H (painted art as the only base-map look), now the optional style; and the
  achromatic plate glyph families of map-presentation.md revision 2 §6, replaced by pins, pending
  its addendum.
- **Addendum (owner, 2026-09-27, after the minimap probe):**
  - **The probe:** .cache/minimap-probe/, independently checked. It found:
    - 1,796 minimap tiles (736 for the Eastern Kingdoms, 988 for Kalimdor, 72 for Zephras Isle),
      each 512×512 DXT1 at 1.042 yd/px, none missing or encrypted;
    - city exteriors drawn in (Ironforge is underground, so only its gate shows);
    - alignment with our coordinates within about 4 yd;
    - that MapGenie's base map matches the stitched minimap (correlation 0.90).
  - **Resolution: full detail, native 1 yd/px everywhere.**
  - **Format:** AVIF (about 28 MB) if a side-by-side visual check finds it as good as WebP q80.
    Otherwise WebP q80 (about 51 MB). The budget is set from the chosen build.
  - **Sea:** every water tone is recoloured to one navy: the dark family, the navy family, and the
    black background of Zephras Isle and of the map edges. Lava and slime keep their own colours.
  - **Phases:** only the default phase (map 0) is shown. The phase maps 2868, 2980 and 2959 are
    not drawn.

## D-046: The general UI follows WoWF-QRP's layout and affordances (owner, 2026-09-27)

- **Date:** 2026-09-27
- **Decided by:** project owner ("Let's also make our general UI more like
  https://tyba-dev.github.io/WoWF-QRP/, e.g. how we present the quests on the left with the
  exclamation mark, and the buttons").
- **Decision:**
  - The left panel's quest presentation (rows with "!" and "?" marks, grouping and inline action
    buttons) and the button style follow WoWF-QRP's layout and interaction.
  - It is built with our own code, glyphs and styles. The brief's rule against copying its
    branding, icons or assets stands. D-029 still allows porting code with attribution.
  - Quest marks keep D-041 G: difficulty colour with pips, from 11 px.
  - UI.md §1's "original look" principle is amended to match: the look is ours, but the layout
    and affordances may follow WoWF-QRP.
- **Design:** docs/research/ui-refresh.md (in design). It is built together with the D-045 map
  presentation.

## D-047: Map presentation revision 3.1: pins, state table and drawer (owner and architect, 2026-09-27)

- **Date:** 2026-09-27
- **Decided by:** the owner took P1 to P4 at the recommended defaults after reviewing
  `.cache/ui-refresh/rev2/sheets/owner-sheet.png`. The other choices are the design's, adopted by
  the architect.
- **Context:** docs/research/map-presentation.md revision 3.1 (the D-045 addendum) and its review
  (docs/reviews/review-ui-refresh-design.md).
- **Decisions:**
  - **The 11 px measure (D-041 G):** it is taken on whatever carries the colour: the disc in a
    route row, and the glyph's box on a map pin.
  - **Pins:** MapGenie-style teardrops with our own glyphs, with a dark body and a coloured glyph.
    - The difficulty pips sit in a tag beside the pin.
    - Pins take colour from 16 px, and are ink below that (P1).
    - One state table (§25.2.3) governs quest marks in rows and on pins. Their paths live in a pure
      module, `src/map/marks.ts`.
  - **Zoomed out:** pins form clusters, and a cluster is coloured only when all its quests share a
    difficulty (P2). The per-band limits count clusters, so no quest giver is dropped. The pin cap
    is 300 per zoom level.
  - **Services** (innkeepers, trainers, vendors) are light pins (P3).
  - **The "Map layers" drawer:**
    - It sits on the map's left, 300 px wide, docked when the map area is 900 px or wider, and open
      by default where it docks (P4).
    - It holds the Minimap/Painted toggle, a search, "Show all"/"Hide all"/"Defaults", and the
      category groups with counts.
    - It is lazily loaded.
    - It replaces the layer panel, the map toolbar and the status line. The map's controls float on
      the map.
  - **Map look:**
    - Zone borders are drawn only where two land zones meet, and not at the world view.
    - The navy sea is one even colour.
    - Zephras Isle is a framed card.
    - When zoomed in, only the hovered or selected flight point's flights and the route's own
      flights are drawn.

## D-048: UI refresh defaults (owner and architect, 2026-09-27)

- **Date:** 2026-09-27
- **Decided by:** the owner took A, B, D, E and F at the recommended options. The rest are the
  design's defaults, adopted by the architect.
- **Context:** docs/research/ui-refresh.md revision 2 (D-046) and its review.
- **Owner:**
  - **A:** two-line rows of 40 px by default: the verb first; the NPC and zone; the XP and the level
    after; any issue in words. One-line rows remain a View choice.
  - **B:** a shaded band under the steps after the selection. Text keeps its contrast, and a
    selection change does not re-render the rows.
  - **D:** the character button ("Orc Warrior · Horde") opens Settings.
  - **E:** warm neutral surfaces (low saturation, channels within 6%; no parchment or gold). The
    accent, severity, difficulty and provenance colours are unchanged, and the system typeface stays.
  - **F:** row action buttons appear on every row, muted. The toolbar and keys remain the keyboard
    path.
- **Architect:**
  - **Row marks:** the step-kind disc takes the quest's difficulty colour, with a dark "!" or "?" and
    a dark outline.
  - **Quiet zeros:** a zero XP is shown muted.
  - **Buttons:** the button kit and tokens of ui-refresh §8, with `secondary` kept as an alias until
    its last use is gone.
  - **Projects menu:** the route name opens it, with New.
  - **Collapsible panels:** the side panels collapse from handles, or with Enter on a separator, and
    "Map focus" (Alt+M) hides both.
  - **Lists:** layout grids for the quest lists, with headers in the reading order.
  - **Quest log tab:** built as a lazy part.
  - **Details panel:** made lazy now, to keep the entry chunk under 250 kB, tracked in the shared
    ledger.
  - **Ownership:** MP.3 owns the Available tab's content, and this design its look and keys.

## D-049: Minimap style build decisions (owner, 2026-09-27)

- **Date:** 2026-09-27
- **Decided by:** project owner. After reviewing the revision 3.1 sheets at native pixels
  (`.cache/minimap-addendum/r31/img/`), the owner signed off the look for building (O18) and took the
  recommended defaults.
- **Context:** docs/research/map-atlas.md revision 3.1, Part II "Minimap style" (§16-§28), and its
  review (docs/reviews/review-map-minimap-design.md: 1 blocker, 5 majors and 5 minors, all resolved).
- **Decisions:**
  - **O12, sea:** the revision 3.1 recolour.
    - A per-tile water reference moves water onto a navy ramp from #0d1b30 to rgb(60, 92, 130).
    - It is gated by the client's liquid grid, reaches 8 yd from water, and never brightens land.
    - The violet river by Dalaran, lava and slime keep their colours.
  - **O13, format:** WebP q80: 6,669 tiles, 51.8 MB gzip-6. AVIF was softer or larger at every
    setting tried.
  - **O17, contrast:** the minimap style's world-band gate is 2.0:1 by Part I's method, with the
    navy sea.
  - **O20, swamp water:** kept as drawn, olive or brown. A liquid-grid-driven recolour may follow
    as its own prototype.
  - **O19, labels:** Ironforge and the Undercity are labelled as underground cities, with a dashed
    outline.
  - **Order (MM-05):** the minimap becomes the default only after the presentation layer's names
    (MP.1, MP.7) are in, so it never shows without names.
  - **O14, hosting:** a release-asset tile pack.
    - The pack holds the NOTICE first, then the manifest and the tiles, with the NOTICE as the
      release text.
    - The main branch keeps the index, manifest, NOTICE and a SHA-256 pointer.
    - The Pages deploy build (`pnpm build:deploy`) downloads and verifies the pack.
    - `pnpm check` passes without the tiles, and warns loudly that they are absent.
    - Nothing is published until the owner authorises pushing (OD-13).
    - Removal on request: delete the asset, remove the pointer, redeploy, and confirm the tile URLs
      return 404.
  - **O15, O16 and the budgets:** the alterations are listed in the NOTICE and manifest, and black
    texels are kept as drawn.
    - The `minimap` folder is capped at 60 MB gzip-6, with 32 kB per tile and per-level baselines
      plus 10%.
    - `maps:validate` gains the offline checks M1-M10.
- **Status (2026-09-30, the map-data review fixes; details, no new owner choice):**
  - The offline checks are M1-M11 (map-atlas.md §24.4 lists M11, the independent seam measure), plus
    MT: the manifest's tool tree hash against the checkout (review finding MD-01).
  - The pack and its release are named by the tiles' tree hash and the pack's own SHA-256
    (`minimap-tiles-<tree 12>-<SHA-256 12>.tar`), so a new pack is always a new release and none is
    replaced (MD-02, §23.3).
  - The owner's sign-off of the built contact sheets (O18, §18.10), including `edge-skirts.png` (the
    edge-skirt rule is new since the prototype), is owed before the first release is published (MD-09).

## D-050: Map and UI rework sign-off and follow-ups (owner and architect, 2026-09-30)

- **Date:** 2026-09-30
- **Decided by:** the owner decided the sign-off and items 1-3. Items 4-7 are architect rulings on
  the final verification's proposals, and the owner may overrule them.
- **Context:** docs/reviews/review-map-ui-rework.md.
- **Owner:**
  - **Sign-off:** the owner signed off the built map and UI sheets on 2026-09-30.
    - This covers the minimap and painted contact sheets, the benchmark and UI comparisons, and the
      minimap edge skirts.
    - It is also D-049's O18 sign-off for the built tiles (MD-09), given before any publication.
  1. **Re-pin to client build 1.60.1.70124**, which the owner's beta client updated to. Everything
     client-derived is rebuilt with the usual byte-identical checks, and the changes are reviewed:
     - the navmesh;
     - the painted art;
     - the atlas and minimap tiles and the minimap pack;
     - the client tables;
     - the DB2 rows and the terrain byproducts.
  2. **Default state (PR-13, UI-08):**
     - With no step selected, the map and panels show the state after the last step, as the status
       bar already does.
     - The app selects a step when it opens: the last one selected in that project, otherwise the
       last step.
  3. **Level ceiling (PR-18):** available quests more than 5 levels above the character's level at
     the step are not drawn on the map. This is an ASSUMPTION, counted in the notes; the lists
     still show them.
- **Architect:**
  4. **`map/marks` is two files:** `marks.ts`, and `marks-pins.ts` for the pin code shared by the
     map and the drawer. The places model carries `zoneAt`.
  5. **The regressions are fixed, not re-baselined:**
     - map-edit and derived back within their --check rules;
     - the selection-to-map and edit-to-map times;
     - the 10,000-step pan at 4×;
     - first art at 4×.
     The first-view budget is measured on the view the app actually opens at (MR-06).
  6. **Clustering moves into the derived publish**, to bring the entry chunk back under the 248.5 kB
     stop rule.
  7. **The left panel's readability is revisited** against WoWF-QRP, which the owner finds more
     readable. The options are:
     - titles that wrap rather than being cut off;
     - larger text and more spacing;
     - fewer inline parts per row;
     - row buttons moved clear of the text.
     This is D-048 A/F refined. Mocks go to the owner before building.

## D-051: Left-panel layout "B+" for readability (owner, 2026-09-30)

- **Date:** 2026-09-30
- **Decided by:** the owner chose B+ from `.cache/readability/owner-sheet.jpg`: three mocks, A, B and
  C, beside WoWF-QRP's saved panel and today's app. The details are architect defaults, which the
  owner may overrule.
- **Context:** D-050 item 7. The owner found WoWF-QRP's left panel more readable. The study and
  mocks are in `.cache/readability/`, and the critic's corrections are folded into the sheet.
- **Decision: B+ ("balanced, row grows"):**
  - **Row size:** fixed two-line rows of 44 px.
  - **Difficulty:** "Lv n" with the pips under the disc replaces the chip; the disc keeps its
    difficulty colour.
  - **Buttons:** row buttons show only on hover, on the selected row and on the keyboard's active
    row.
  - **Issue shape:** drawn once.
  - **The active row grows:** it shows its issue in full on its own line, plus the NPC and zone,
    before the buttons take any space. The virtual list stays index × 44 px, plus one fixed extra
    below the active row.
  - **Measured on the mock:** titles cut fall from 13 to 4, issue words cut at rest from 22 to 7,
    and NPC names cut at rest from 24 to 0. About 11 steps are in view.
  - **Architect defaults:** the chain position ("2/2") is always shown on the active row and in
    the row's accessible name and tooltip, and on other rows only where it fits; the level reads
    "Lv n".
  - **Before building:** B+ is mocked and measured, including the active row's issue, NPC and zone
    being whole, and the D-040 carried-work cue.
  - **Order:** the build follows the entry-chunk trim (D-050 item 6), because the stop rule must
    hold.

## D-052: Rework follow-up rulings (owner and architect, 2026-10-01)

- **Date:** 2026-10-01
- **Decided by:** the owner ratified item 4; the rest are the architect's rulings on the follow-up
  critic's findings (docs/reviews/rework-followup.md), and the owner may overrule them.
- **Decisions:**
  1. **Berths (TR-03, F-07):**
     - The 100 yd boarding radius is kept.
     - The step between a boarding point and its berth is priced at each end of a ride as
       `boardingYd` at run speed, as a travel part of its own and not part of the wait (SIMULATION
       TIME-7).
     - Run speed is used even when the character is mounted. That is intended: the step is short,
       and how a mount behaves on a pier is unsourced. This is an ASSUMPTION.
  2. **The speed gate (F-02):**
     - **The rule:** an interleaved A/B on one machine (`tests/bench/ab-derived.ts`, and the same
       method for the other benches) against 95e84cc, the tree before the rework.
       - Each run has at least 5 rounds, and each checked case's ratio of medians must be ×1.25 or
         less.
       - The spread is reported. When a ratio is between ×1.15 and ×1.35 and the spreads overlap,
         rounds are added before a verdict.
       - A case that 95e84cc lacks is compared with eff4341.
     - This is the gate on every machine. The probe-normalised `--check` against stored baselines is
       not approved as a gate: the stored `derived10000` block records no probe, and the probe does
       not track this allocation-heavy workload. It stays as a raw guard on the owner's machine.
  3. **The drawer's counts (F-08):**
     - Rows count what the map draws, after the level ceiling (D-050 item 3).
     - Held-back quests show as "+n held" beside the count, and in the row's tooltip and notes.
  4. **UI-15 (F-09), ratified by the owner:** one-line accept and turn-in rows leave the verb to their
     "!" or "?" mark. The tooltip and the spoken name keep it. ui-refresh.md §6.1 and §6.2 and UI.md
     §7 and §8 are edited to match.
  5. **Still open and not re-baselined (D-050 item 5):**
     - **F-03:** since the rework, the pins follow the quest state, which UI-04 computes after the
       selection has painted. Every selection or edit therefore takes two frames, and ×1.25 against
       95e84cc is out of reach by design.
     - **F-04 and F-05:** the pans at 4× and the opening view's bytes (MR-06).
     - The architect rules on all three after absolute measurements on the owner's machine. The
       options are in `docs/measurements/followup-cloud.json`.
     - The follow-up's F-03 changes are kept: 8 to 14% faster in 4 of 8 cases, and none slower.
  6. **B+ (D-051)** is its own stage. Its truncation figures came from Segoe UI, so the cloud
     container (DejaVu Sans only) can build B+ but cannot confirm them; that re-measure is owed on the
     owner's machine.
  7. **The browser harness** is committed at `tests/bench/browser/`. It loads Playwright from
     `FRL_PLAYWRIGHT` or a global install until Milestone 9 adds it as a dev dependency.

## D-053: GitHub Pages deployment, painted map only until the minimap pack is published (owner and architect, 2026-10-01)

- **Date:** 2026-10-01
- **Decided by:** the owner made the repository public, enabled GitHub Pages and asked for a workflow
  to deploy (this settles OD-13 for pushing and deploying). The workflow's design is the architect's;
  the owner may overrule it.
- **Context:** ARCHITECTURE §16. D-025: deployable builds come from CI on a clean checkout. D-049
  O14: the minimap tiles ship in a release-asset pack, which only the owner publishes; none is
  published, and the pack exists only on the owner's machine.
- **Decisions:**
  - **The workflow:** `.github/workflows/pages.yml` deploys on every push to `main`, and when run by
    hand (a run on another branch builds and checks but does not deploy).
    - The build job has `contents: read` only. The deploy job alone has `pages: write` and
      `id-token: write`, in the `github-pages` environment.
    - Each branch has its own concurrency group (`pages-<ref>`), and no run cancels one in progress.
    - Every third-party action is pinned to a full commit SHA, with its release tag in a comment.
  - **The gates, in order:**
    - `pnpm install --frozen-lockfile`;
    - the QuestieDB clone, cached by the pinned commit and verified by `pnpm data:fetch`
      (`extract.test.ts` requires it under CI, so every run includes `pnpm data:check`'s checks);
    - in a full build, the minimap pack downloaded and verified first, so the tests that need the
      tiles run on them;
    - `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm data:validate`;
    - the build;
    - a check that no tracked file changed and that nothing untracked under `public/` ships, the
      minimap tiles excepted.
  - **Three outcomes for the minimap:**
    - **full:** the release that `pack.json` pins exists. `pnpm build:deploy` builds from the
      verified pack, and its audit requires every tile. Any failure fails the run.
    - **painted:** no minimap pack is released yet. `pnpm build:painted` (new: `vite build --mode
      painted` with the plain audit) builds a site whose only style is the painted map:
      - it never fetches or offers the minimap;
      - the Map layers drawer shows Minimap as unavailable, with the reason;
      - a minimap choice kept in the browser is left as it is, for a build that has the tiles.
      The run names the missing release in a warning and in its summary. A full build is unchanged.
    - **stopped:** an earlier pack is released but not the pinned one (a re-pin pushed before its
      pack). The run fails and the live site keeps its minimap, unless the run was started by hand
      with "painted" ticked.
  - **Publishing the pack** stays the owner's step, after the minimap gate (map-atlas.md §23.4). It
    uses the command `pnpm maps:minimap:pack` prints: `gh release create <tag>
    .cache/minimap-pack/<asset> --repo laurencestokes/forever-route-lab --title <tag> --notes-file
    public/maps/minimap/NOTICE.md`. The next run deploys the full site.
  - **Hosting:** <https://www.lozstokes.co.uk/forever-route-lab/>, under the owner's user site and its
    custom domain.
    - The Pages source must be GitHub Actions; the deploy job checks it.
    - Enforce HTTPS must be on. On a plain http page the app cannot verify its files with WebCrypto
      and stops at its loading screen. The deploy job warns when Pages reports HTTPS as not enforced.
- **Review:** a builder, an independent critic with two sceptics per finding (10 findings, all
  confirmed, 9 fixed; the tenth is a re-measure owed after the follow-up merges), a repair and a final
  verifier. The verifier ran actionlint with shellcheck, the workflow schema, the SHA pins, every
  step's script as written, and a clean-copy build. It also ran a Playwright smoke test under
  `/forever-route-lab/`. The first run on GitHub is the only end-to-end test.
