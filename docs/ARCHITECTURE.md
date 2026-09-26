# Architecture

Status: **Milestone 0, revision 2 (2026-09-25)**, after independent critique
([docs/reviews/review-m0-architecture.md](reviews/review-m0-architecture.md)). Grounded in the
Milestone 0 research: [DATA_PROVENANCE.md](DATA_PROVENANCE.md), [MAPS.md](MAPS.md),
[RXP.md](RXP.md), [SIMULATION.md](SIMULATION.md) and `docs/research/`. `D-nnn` references are
entries in [DECISIONS.md](DECISIONS.md); where two entries conflict, the later one wins.
Sections 4, 7.2, 9, 11.3, 12.1 and 14 carry "as built" notes for the Milestone 3b part 2 and
Milestone 6 build (2026-09-26), and sections 9, 12.1, 12.4 and 14 notes on the Milestone 6 review
fixes (2026-09-26); where a note and the original text differ, the note describes the code.

forever-route-lab is a static web application (React, TypeScript, Vite; no backend, no accounts,
no runtime AI) for planning, simulating, validating, editing and optimising World of Warcraft:
Forever levelling routes.

---

## 1. What the research changed

| Assumption in the brief | Reality (2026-09-25) | Consequence |
|---|---|---|
| QuestieDB is GPLv3 | Neither Questie nor QuestieDB has ever had a root licence file on its default branch (none covering Questie's own code or data; Questie's subfolders carry licence files for bundled third-party material only). An unmerged Questie `license` branch drafts "consider Questie all rights reserved" and a CLA to relicense as MIT/CC0 | The owner decided to publish the derived dataset anyway, with prominent notices (D-016). No legal conclusion is drawn here |
| QuestieDB `data/Forever` holds Forever content | It is the Era 1.15.9 baseline with coordinates re-projected on four zones: zero Forever-only IDs, zero content diffs, empty Forever corrections, Era QuestXP seed | Every dataset record's Forever status is `unknown`. **Custom quests** are first-class. Unknown quest IDs are warnings |
| RXPGuides is reusable open source | It declares CC BY-NC-SA 4.0; the owner's posture is not to combine it with this repo | Independent implementation from a behavioural spec; no RXP code, guide text or data values (D-019) |
| RXP `.goto` is zone percent | 82% of RXP Forever gotos use world yards (`UiMapID/instance,y,x`); Zephras Isle gotos are always percent | Locations keep the **authored** point and derive world coordinates when geometry allows (D-017) |
| react-leaflet is neutral | react-leaflet 3-5 is Hippocratic-2.1 | Leaflet 1.9.4 (BSD-2) behind our `MapAdapter` (D-005) |
| wow.export is the extractor | GUI-only; with defaults it uploads the install's `Cache/` files to a third party | Not scripted; manual fallback in CDN mode only (D-011) |
| Era rules apply | Forever XP tuning is server-side and unknown; quest log 40; TBC-style riding; race masks exceed 32 bits | Versioned **Ruleset** with per-value provenance and visible Era fallback (D-008); arithmetic mask tests (D-012) |
| Build 1.60.1.69977 | Local client is 1.60.1.70009; QuestieDB's frame is 69893; UiMapAssignment is identical in both | Data frame pinned to 69893; local build recorded as observed (D-013) |

## 2. Principles

1. **Data ≠ map.** Quest data and map art/geometry are separate pipelines, files and modules,
   meeting only in the pure coordinate adapter (`src/geo`).
2. **Pure core, thin shell.** Everything that decides something is framework-free TypeScript
   with no DOM, React, Leaflet, IndexedDB, clock or randomness (§17 lists the pure set).
3. **Unknown stays unknown.** Missing values are `null` plus a reason, never 0 or a silent Era
   substitute. Numbers derived from unknowns say so (lower bounds, `unknown` basis). Every derived
   number states whether it came from **source data**, a **user assumption** or a **derived
   estimate**.
4. **IDs, not object graphs.** Routes reference quests and entities by branded integer IDs.
5. **Deterministic.** Same inputs, same outputs: simulation, validation, serialisation, data
   extraction, diff, and the optimiser when it terminates on its evaluation budget (§11.6).
6. **Bounded optimisation** of a selected section between anchors, never "1-60".
7. **Measure before optimising.** Plain JSON, loaded whole; chunking or typed arrays only where
   a measured budget demands it (the optimiser's inner loop does, by design).

## 3. System context

```
 build time ───────────────────────────────────────────────────────────────────────────────
  QuestieDB @ pinned SHA ──► tools/questiedb  fetch → extract → validate → diff
     (Lua literals, corrections,    luaparse + whitelisted evaluator, static corrections,
      support tables)               source-frame coordinates kept as published)
                                              │
                                              ▼
                                  public/data/  (committed, D-002, D-016)
                                    manifest.json, NOTICE.md, quests.json, entities.json,
                                    items.json, spawns.json, zones.json, overlays.json

  QuestieDB conversion.json ─┐
  cited DB2 rows (D-018) ─────┴► tools/maps import --placeholder ─► public/maps/placeholder/
     (tools/maps/inputs/, committed)                                 geometry.placeholder.json
                                                                     NOTICE.md  (committed)
  Developer's own client/CDN ─► assets-source/ ─► tools/maps import/convert/validate
     (DB2 CSV, BLP/PNG)          (gitignored)       ─► local-maps/  (gitignored, outside public/,
                                                        never built or deployed)
 runtime ──────────────────────────────────────────────────────────────────────────────────
  infra/data  fetch all data files ─► geo converts spawns to WorldPoints ─► DatasetView (sync)
  infra/maps  fetch placeholder geometry; probe local-maps/ (dev/preview only)

  pure modules ("A ──► B" means B imports A; the §4 table is authoritative):
    domain ──► geo, rules ──► sim ──► engine ──► validate
                                        └──────► optimizer/core ◄── optimizer/worker
    domain, geo ──► rxp          domain ──► diff, project
  app (store, history, commands, proposal building) imports the pure modules and infra
     └──► infra/persistence (IndexedDB)
  ui (React) ──► app, map/adapter; map/leaflet is wired in at the composition root
```

## 4. Repository layout

```
src/
  domain/        hand-written types: ids, dataset records, route, project, conditions AST,
                 proposal, the travel contract (travel.ts, D-037); pure route operations
  geo/           SourcedPoint/WorldPoint/MapPoint, transforms, distances, zone attribution
  rules/         Ruleset profiles with per-value provenance (ruleset.ts, tables.ts), precedence
                 (effective rules), difficulty, riding, the straight-line TravelModel,
                 TravelGraph seed (travel-graph.ts, travel-seeds.ts)
  engine/        route walker (one mutable working state, checkpoints, visitors), condition
                 evaluation (engine/conditions.ts), places, movement, leg enumeration
  sim/           XP, level, time model and simulation facts (pure functions shared with the
                 optimiser); records facts, never issue codes (D-037)
  validate/      validation rules run as walker visitors; src/validate/codes.ts is the issue-code
                 registry
  rxp/           unwrap, CST parser, filter parser, command registry, lowering, serializer
  diff/          route diff (LIS based), change-sets, apply-selected
  nav/           pure navmesh runtime (D-028): block decode, snap, resumable search, funnel,
                 legsFrom/navPath; nav/worker/ (not pure): protocol.ts, core.ts (fetch, verify,
                 pin, LRU, resumable search with snap loads), host.ts, client.ts, nav.worker.ts
  project/       zod schemas typed against domain types, migrations, import/export
  optimizer/
    types.ts     Optimizer interface and request/options/progress/result types
    core/        problem.ts (compile), state.ts, transitions.ts, heuristic.ts, search.ts
    worker/      protocol.ts, optimizer.worker.ts, client.ts
    index.ts     createTypeScriptBeamSearchOptimizer
  infra/         data/ (dataset loader), maps/ (geometry, local-map probe, art manifest,
                 terrain files, map-resources.ts), persistence/ (IndexedDB), nav/ (nav manifest
                 loader)
  map/
    adapter.ts   MapAdapter interface, descriptors, view-model input types
    layers.ts    pure: view models → descriptors (memoised per layer), relief, outlines,
                 coastline, walking-path route lines
    leaflet/     LeafletMapAdapter (the only Leaflet importer)
  app/           store, revisions, history, commands, derived results (derived.ts, in the entry;
                 derived-pipeline.ts and derived-context.ts, lazy), navigation (leg table, travel
                 model, scheduler, runtime, zone hints: navigation-*.ts), walking-path feed
                 (route-paths.ts), proposals
  ui/            React components, styles, design tokens
tools/
  questiedb/     README.md, upstream.json (the single pin), fetch.ts, extract.ts, validate.ts,
                 diff.ts, lib/
  maps/          README.md, import.ts, convert.ts, validate.ts, vite-local-maps.ts (dev plugin),
                 inputs/db2-rows-1.60.1.70009.json (the 12 cited DB2 rows, committed)
  casc/          read-only CASC and WDC5 DB2 reader over the local client's Data/ (D-028)
  terrain/       extract.ts (navmesh build), validate.ts (gates G1-G15), byproducts.ts
                 (coastlines, zone outlines, relief), review-draft.ts, inputs/ (connectors,
                 passages, census reviews)
  build/         third-party-notices.ts, licence-gate.ts, audit-dist.ts, rxp-overlap.ts
generated/       questiedb-report.json: extraction report (gitignored; §5.2)
public/
  data/          committed generated dataset
  maps/placeholder/  committed placeholder geometry + NOTICE.md
  maps/art/      committed Blizzard painted map art (WebP) + manifest + NOTICE (D-033)
  maps/terrain/  committed coastlines, zone outlines, relief + manifest + NOTICE (D-032)
  nav/           committed navmesh blocks, per-map map.bin, connectors, manifest, NOTICE (D-028)
local-maps/      gitignored local map sets (outside public/)
tests/           fixtures and cross-module tests; unit tests sit beside their modules
docs/            this file, decisions, provenance, maps, RXP, simulation, research, reviews
```

### Dependency rules

`tests/architecture.test.ts` implements this table as an allowlist matrix. `import type` from
any pure module is allowed everywhere.

| Module | May import (values) |
|---|---|
| `domain` | nothing |
| `geo`, `rules` | `domain` |
| `engine` | `domain`, `geo`, `rules`, `sim` |
| `sim` | `domain`, `geo`, `rules` |
| `validate` | `domain`, `geo`, `rules`, `engine`, `sim` |
| `rxp` | `domain`, `geo` (dataset lookups injected through an interface) |
| `diff` | `domain` |
| `nav` | `domain`, `geo` (engine, sim and `optimizer/core` import its types only) |
| `nav/worker` | `nav` |
| `project` | `domain`, `zod` |
| `optimizer/core` | `domain`, `geo`, `rules`, `sim`, `engine` |
| `optimizer/worker` | `optimizer/core`, `optimizer/types` |
| `optimizer/index` | `optimizer/*`, `domain`, `engine`, `geo`, `rules`, `sim` |
| `infra/*` | pure modules (including `nav`), `idb`, browser APIs |
| `map/adapter`, `map/layers` | `domain`, `geo` |
| `map/leaflet` | `map/adapter`, `leaflet` |
| `app` | everything except `ui` and `map/leaflet`; React only in `src/app/react.ts`, the store binding (D-027) |
| `ui` | `app`, `map/adapter`, React; `map/leaflet` only in the composition root |

## 5. Dataset

### 5.1 Pipeline

`tools/questiedb` reads QuestieDB at a pinned commit (DATA_PROVENANCE §5):

- luaparse (MIT, dev only) plus a whitelisted evaluator that fails closed (D-009).
- Static corrections in upstream order with upstream merge semantics, then the `requiredRaces`
  derived pass. The composed counts must equal upstream (4,257 quests, 10,122 NPCs, 6,666
  objects, 14,899 items at `b6f5b07`).
- Dynamic corrections (faction; class for four quests) go to `overlays.json`, applied by
  `DatasetView` from the project character, never baked into one persona.
- Input hashes are taken from LF git blobs (`core.autocrlf=false`).
- Coordinates are shipped **as published**: 0-100 zone percent (2 dp) keyed by AreaTable ID,
  plus the AreaId→UiMapId table. The extractor never re-projects them (D-017).

### 5.2 Runtime files

The authoritative manifest is `public/data/manifest.json`, defined once in DATA_PROVENANCE §8
(content-addressed `dataRevision`, upstream commit and builds, tool tree hash, per-file SHA-256,
per-output origins, `foreverContentVerified: false`). `generated/questiedb-report.json` is a
gitignored superset (counts, coverage, lint, timings, extraction time) keyed by the same
`dataRevision`. `public/data/NOTICE.md` states origin, the licence finding and the carve-out for
third-party content.

Every change to `tools/questiedb` lands in the same commit as the regenerated dataset. CI
fetches the pinned QuestieDB commit, re-extracts, and fails unless the output is byte-identical
(DATA_PROVENANCE §8). Field-level parity against QuestieDB's own Lua generation is an optional
manual check, since no Lua runtime is required (D-009); the required checks are golden counts,
output hashes, schema and referential integrity.

| File | Contents |
|---|---|
| `quests.json` | every quest (§5.3), including `objectivesText` |
| `entities.json` | NPCs and objects that are quest-referenced, plus every flight master, innkeeper and trainer (by `npcFlags`), with name, level range, flags, provenance |
| `items.json` | items referenced by quests: name, drop sources, starts-quest (origin noted) |
| `spawns.json` | spawn points per entity, as published (AreaId → [x%, y%]), instance presence, waypoints if shipped |
| `zones.json` | AreaId→UiMapId, UiMap names (with source), dungeon entrances, instance areas (no bounds: geometry is map metadata, §6) |
| `overlays.json` | dynamic corrections by faction and class |

All files load in parallel at startup, before the dataset is marked ready. `infra/data`
converts spawns to `WorldPoint`s once through `geo` and the committed geometry, and builds a
**fully synchronous** `DatasetView`. A published point whose AreaId maps to no UiMap
(suppressed areas, legacy dungeon pairs, instance areas) becomes an `UnmappedAreaPoint` with a
reason; instance presence resolves to the dungeon entrance from `zones.json` when one exists,
and otherwise stays unresolved. Nothing is guessed. Measured estimate: about 0.35 MB gzip for spawns and under
1 MB gzip in total. Per-zone chunking is a later optimisation, only if the §14 startup budget is
missed; if it happens, giver locations and per-zone objective summaries stay in the startup set
and chunks feed drawing only.

### 5.3 Domain records (sketch)

The authoritative types are in `src/domain/dataset.ts`; this sketch summarises them.
`dungeonQuest` uses the dungeon list with the exclusions in DATA_PROVENANCE §6.2 (trams, halls,
battlegrounds). Quest source items live in `requirements`.

```ts
type QuestId = Brand<number, 'QuestId'>;   // also NpcId, ObjectId, ItemId, AreaId, UiMapId,
                                           // WorldMapId, FactionId, SkillId, SpellId
interface QuestRecord {
  id: QuestId; name: string;
  level: number | null; minLevel: number | null; maxLevel: number | null;   // no pad-to-0
  races: number | null; classes: number | null;      // arithmetic bit tests only (D-012)
  zoneOrSort: number | null; dungeonQuest: boolean;  // dungeonQuest derived at extraction
  starters: EntityRef[]; finishers: EntityRef[];     // { kind: 'npc'|'object'|'item', id }
  objectives: ObjectiveDef[];                        // Questie ObjectiveData order (§5.4)
  objectiveHints: ExtraObjective[];                  // extraObjectives: not counted
  objectivesText: string[] | null;
  prerequisites: QuestPrerequisites;                 // single, group (signed), exclusiveTo,
                                                     // nextQuestInChain, parent, breadcrumbs, ...
  requirements: QuestRequirements;                   // skill, rep, spell, specialization
  reputationReward: { factionId: FactionId; value: number }[];
  flags: { repeatable: boolean; needsEvent: boolean; questFlags: number; specialFlags: number };
  xp: { questLevel: number; baseXp: number; basis: 'era-seed' | 'user' | 'forever-observed' } | null;
  provenance: RecordProvenance;
}
type ObjectiveDef =
  | { kind: 'kill'; npcId: NpcId; label: string | null; count: number | null }
  | { kind: 'object'; objectId: ObjectId; label: string | null; count: number | null }
  | { kind: 'item'; itemId: ItemId; label: string | null; count: number | null }
  | { kind: 'reputation'; factionId: FactionId; value: number }
  | { kind: 'killCredit'; npcIds: NpcId[]; rootNpcId: NpcId; label: string | null; count: number | null }
  | { kind: 'spell'; spellId: SpellId; itemId: ItemId | null; label: string | null }
  | { kind: 'event'; text: string | null; points: PublishedPoint[] }; // from triggerEnd
interface RecordProvenance {              // same vocabulary for quests, NPCs, objects, items
  upstreamDiff: 'era' | 'era-coords' | 'forever-new' | 'forever-changed';  // fact about QuestieDB
  foreverStatus: 'unknown' | 'user-declared-new' | 'user-declared-changed'; // claim about the game
  corrected: boolean; created: boolean;   // touched / created by a static correction
  source: 'questiedb' | 'custom';
}
```

Counts are always `null` from QuestieDB (it has none). `objectivesText` ships, so a later,
clearly labelled heuristic may parse counts from it.

### 5.4 Objective indices

The objective index is Questie's `ObjectiveData` order: creature, object, item, reputation,
killCredit, spell, then the `triggerEnd` event, with the `*ObjectiveFirst` hint sets from the
corrections applied at extraction. RXP `.complete q,i` maps to index `i-1`; a diagnostic fires
only when `i` exceeds the objective count or the quest is custom.

### 5.5 Custom quests and overrides

- A custom quest keeps its real ID when known (for example a Forever quest from an RXP guide).
  Invented quests use negative IDs, which the dataset never uses.
- A custom quest overrides a dataset quest with the same ID; `DATA001-custom-shadowed` (info)
  lets the user choose per quest between the dataset record and their values.
- `questOverrides` (keyed by numeric quest ID) hold user values such as XP (`basis: 'user'`).
- When `project.dataRevision` differs from the loaded manifest, a drift check (missing IDs,
  changed objective lists or prerequisites) runs and a banner shows before autosave records the
  new revision.

## 6. Coordinates (`src/geo`)

From [docs/research/coordinates.md](research/coordinates.md):

```ts
type SourcedPoint =                                   // authoritative: src/domain/points.ts
  | { space: 'world'; mapId: WorldMapId; x: number; y: number;
      uiMapId: UiMapId | null;                        // the UiMap an RXP world-form goto named
      lexemes: [string, string] | null }
  | { space: 'zone'; uiMapId: UiMapId; x: number; y: number; frame: 'forever' | 'era';
      lexemes: [string, string] | null };
interface WorldPoint { mapId: WorldMapId; x: number; y: number }  // yards, x north, y west
interface Location { source: SourcedPoint; label: string | null; radius: number | null }
```

- A `Location` stores the point **as authored**; `resolve(location, geometry) → WorldPoint |
  null` derives world coordinates at runtime. Nothing derived is persisted, so projects do not
  depend on which geometry a machine has (D-017).
- A null resolution means unknown travel (`Estimated` `unknown`) plus an info issue. It is never
  treated as zero distance.
- `lexemes` keep RXP's original number strings, so exports reproduce them.
- `eraToForever` is applied only to `frame: 'era'` points on the four changed UiMaps
  (1412, 1423, 1433, 1453).
- `distanceYards` is null across world maps.

**Geometry.** `public/maps/placeholder/geometry.placeholder.json` is produced by
`tools/maps import --placeholder` from two committed or pinned inputs, so it is reproducible:

- the 49 zone frames from QuestieDB `conversion.json` target bounds at the pinned commit
  (`source: 'questiedb-conversion'`, build 1.60.1.69893);
- 12 DB2-only `UiMapAssignment` rows for 11 UiMaps (Azeroth 947 has two rows, one per continent;
  Kalimdor 1414, Eastern Kingdoms 1415, 1463, 1464, and the new Forever maps 2482, 2521, 2524,
  2548, 2652, 2665), committed with table/build/row citations and the full CSV's SHA-256 in
  `tools/maps/inputs/db2-rows-1.60.1.70009.json` (`source: 'db2-csv'`, build 1.60.1.70009; owner
  approval D-018). The CSVs were fetched as individual requests during research, never by
  scripted crawling (D-011).

The file also carries an `eraToForever` block (the four changed UiMaps' coefficients, copied from
`conversion.json`) and a canonical **frame hash** of the 49 shared rows (float32 tuples,
JSON, SHA-256; MAPS §5.6). It also carries a **content hash** over every row, name, parent and
coefficient (`canonicalGeometryContent`, MAPS §5.3); `infra/maps` recomputes both at load and
refuses the file on any mismatch (M2 review code-F2). Every row records its source and build.

A local geometry (`geometry.local.json`, rows `source: 'local-db2'`) is accepted only when its
frame hash equals the committed one. It may **add** UiMaps the committed file lacks; a local row
for a UiMap the committed file already has must be identical, otherwise the whole local set is
rejected as a frame mismatch. Resolution therefore never differs between machines for a UiMap
both know.

Tests pin the worked examples: Gornek (Durotar), Chief Hawkwind (Mulgore, Era→Forever), and the
flight-master vs TaxiNode cross-check (cited client values, D-022).

## 7. Map engine

### 7.1 `MapAdapter`

```ts
interface MapAdapter {
  mount(el: HTMLElement): void; destroy(): void;
  setSurface(surface: SurfaceId): void;         // 'world:0' | 'world:1' | 'world:2991' | ...
  setViewport(v: Viewport): void; fitBounds(b: WorldBounds, opts?: FitOptions): void;
  setLayer(layer: LayerId, content: LayerContent): void;   // markers | polylines | frames | art
  toggleLayer(layer: LayerId, visible: boolean): void;
  highlight(target: HighlightTarget | null): void;
  focus(point: WorldPoint, opts?: FocusOptions): void;
  on<E extends MapEvent['type']>(type: E, h: (e: Extract<MapEvent, { type: E }>) => void): () => void;
}
```

Descriptors are plain data with stable ids. `map/layers.ts` memoises each layer on its own
inputs (spawn layers do not depend on the route). The adapter skips a layer whose content is
unchanged by reference and otherwise diffs descriptors by id, so a route edit never re-creates
thousands of paths.

### 7.2 Leaflet implementation

- `L.CRS.Simple`, one surface per world map, `latLng = (x, -y)` in yards. Zone frames and art
  are rectangles in that space.
- Canvas renderer (`L.canvas`). **Level of detail:** raw spawn points only at zone zoom or for
  the selected/hovered quest; per-zone aggregate glyphs at continent zoom; a hard cap on drawn
  paths per surface. Labels on hover only.
- Route lines: one polyline per (world map, style) run plus a small highlight polyline;
  transport, flight and hearth legs styled distinctly.
- Layers: available quests, route line, step markers, objectives, turn-ins, flight masters,
  zone frames, map art, proposal overlay.
- **As built (Milestone 3b part 2; full detail in [MAPS.md](MAPS.md) §7):**
  - Layer order, bottom to top: `relief`, `art` (image overlays in their own panes, z-index 240
    and 250), `coastline`, `zone-outlines`, `zone-frames`, then the data layers, the route line,
    steps, proposal and selection on one canvas. Descriptors added: relief, outline
    (`zones` | `coast`), `FrameDescriptor.filled`, line styles `route-pending` and
    `route-fallback`.
  - Painted art (D-033) is drawn one image at a time: the continent zoomed out; zoomed in, the
    zone jumped to or the zone the view centre sits in. The relief is the backdrop elsewhere
    (opacity 0.85 alone, 0.4 under art); zone frames lose their fill over art.
  - Art and terrain files load on demand through `createMapResources` (`infra/maps`): JSON files
    are checked against their manifest's SHA-256, images are drawn from their deployed URLs
    (checked at build time only). A failure is shown in the map's status line; the map draws
    what it has.
  - Walking paths: with the "Walking paths" toggle on, a walked leg follows
    `TravelModel.path()`; a leg still pending is drawn straight in short dashes, one with no path
    in dash-dot-dot. Pieces keep at most 256 vertices. The app's path feed
    (`app/route-paths.ts`) asks for at most 64 legs in the padded view per paths object and
    issues a new object at most every 250 ms.
- A combined "overview" surface (both continents on one canvas) is deferred until after the MVP;
  the surface abstraction keeps it possible.

### 7.3 Placeholder and local maps

With no local art the map draws zone frames, labels, grid, yard scale bar and data points,
procedurally, from committed geometry and data. **Superseded in part by D-032/D-033:** from
Milestone 3b the deployed map shows the committed painted map art, extracted from the client, plus
terrain-derived coastlines, zone outlines and relief. The rectangle placeholder remains the
fallback when those files are absent.

A **local extraction set** lives in gitignored `local-maps/` at the repository root, **outside
`public/`**: `maps.manifest.json`, `geometry.local.json`, `art/`, and optionally
`taxi.local.json` (local taxi-derived leg times, D-022). A Vite plugin
(`tools/maps/vite-local-maps.ts`) serves it in `dev` and `preview` only; `vite build` never
emits it, and `audit-dist` fails if anything map-like appears (§16). `tools/maps validate
--activate` writes the manifest of the one active set. `infra/maps` probes
`local-maps/maps.manifest.json` (one same-origin request, also in deployed builds) and treats a
404, a non-JSON body (SPA fallback) or a frame mismatch as "no local set", falling back to the
placeholder and showing both builds in the layer panel.

## 8. Route model

### 8.1 Steps and groups

A route is a flat list of **atomic** steps plus a `groups` sidecar. An RXP step (a location,
several actions, tags, waypoints, annotations, conditions) lowers to several steps that share a
`groupId`; the group keeps everything that belongs to the RXP step as a whole (D-020).
The authoritative types are in `src/domain/route.ts`, `points.ts` and `conditions.ts`; the
sketch below summarises them (for example `TaxiNodeRef` is `{ npcId, taxiNodeId, name }`, since
new Forever flight masters have no dataset NPC, and `SourceLineRef` is
`{ importId, firstLine, lastLine }`).

```ts
interface StepBase {
  id: StepId;
  location: Location | null;        // where it happens (destination for travel)
  note: string | null;
  locked: boolean;                  // anchor for the optimiser (§11.2 rule 5)
  groupId: GroupId | null;
  condition: StepCondition | null;  // line-level; group-level conditions live on the group
  durationOverride: number | null;  // seconds, user override
  origin: { source: 'manual' | 'rxp' | 'optimizer' | 'duplicate' | 'paste'; ref: string | null };
  rxp: { text: string | null; line: SourceLineRef | null } | null;  // `>>` text, source line
  ext: Readonly<Record<string, unknown>> | null;   // forward-compatible (e.g. telemetry)
}
type RouteStep =
  | (StepBase & { kind: 'accept'; questId: QuestId; anyOf: QuestId[] | null; via: EntityRef | null })
  | (StepBase & { kind: 'complete'; targets: { questId: QuestId; objective: number | null }[];
                  progress: 'finish' | 'partial' })
  | (StepBase & { kind: 'turnin'; questId: QuestId; anyOf: QuestId[] | null;
                  rewardIndex: number | null /* 1-based */; skipIfMissing: boolean; via: EntityRef | null })
  | (StepBase & { kind: 'abandon'; questId: QuestId })
  | (StepBase & { kind: 'travel'; mode: 'auto' | 'walk' | 'mount' | 'transport'; transport: TransportRef | null })
  | (StepBase & { kind: 'grind'; until: GrindTarget;   // level + offset (xpInto | xpShort | fraction), or seconds
                  mobLevel: number | null; xpPerHour: number | null })
  | (StepBase & { kind: 'hearth'; mode: 'use' | 'bind' })   // 'use' destination comes from state
  | (StepBase & { kind: 'flight'; mode: 'take' | 'discover'; from: TaxiNodeRef | null;
                  to: TaxiNodeRef | null; nodeQuery: string | null })
  | (StepBase & { kind: 'train'; spellId: SpellId | null; skill: 'riding' | 'class' | 'profession' | null;
                  skillId: SkillId | null; rank: number | null; what: string | null; cost: number | null })
  | (StepBase & { kind: 'vendor'; what: string | null })
  | (StepBase & { kind: 'note'; text: string; preserved: PreservedSource | null });

interface StepCondition { filter: FilterAst | null; variant: VariantTags | null; skipIf: StatePredicate[] }
interface RouteGroup {
  id: GroupId;
  rxp: { importId: string; stepIndex: number; tags: RxpTag[];      // sticky, completewith, label,
         condition: StepCondition | null;                           // requires, optional, loop, ...
         waypoints: Waypoint[];                                     // ordered: leg | pin | closest
         annotations: RxpCommandNode[];                             // .target, .mob, .use, ...
         fingerprint: string } | null;                              // canonical hash at import
}
```

- `complete` with several targets is one work block (shared kill targets, drops); its duration
  is not the sum of its targets (§9.3). `partial` marks work that continues later (RXP sticky and
  `#completewith` windows). A target's `objective: null` means all of the quest's objectives.
- A `travel` step with a null location (RXP `.zone`, `.subzone`, `.explore`) moves the character
  somewhere unknown; so does a death skip (kept as a preserved note). The engine then sets the
  position to unknown until a step with a resolvable location.
- `turnin` of a quest whose objectives were never scheduled is a warning, not an error. For a quest
  an `accept` step of the route put in the log, the turn-in carries the objectives' time and kill
  XP, without the travel to them (D-040); for one in the log before the route, declared or assumed,
  they are "assumed completed incidentally" (SIMULATION TIME-11).
- A **section** is a contiguous selection of steps; it is not persisted. Operations (pure, in
  `domain/route`): insert, delete, move, duplicate, lock, cut section (to a clipboard), paste,
  join sections (move the later section to follow the earlier one), add note/travel/grind/quest.
  New step IDs come from an injected `IdSource`.

### 8.2 Project (schema version 1)

```ts
interface ProjectV1 {
  schemaVersion: 1; game: 'wow-forever';
  gameBuild: string;            // data frame build, e.g. '1.60.1.69893'
  dataRevision: string;         // manifest dataRevision last loaded
  rulesetId: 'forever-beta' | 'era-1.15';
  id: ProjectId; createdAt: string; updatedAt: string;   // stamped by app, not pure code
  route: { id: RouteId; name: string; description: string; steps: RouteStep[];
           groups: Record<string, RouteGroup> };
  character: {
    faction: 'Alliance' | 'Horde'; race: RaceToken; class: ClassToken; sex: 'male' | 'female' | null;
    startLevel: number; startXp: number;
    startLocation: Location | null; hearthLocation: Location | null;
    knownFlightPaths: TaxiNodeRef[]; professions: Record<string, number>;   // skillId -> value
    reputation: Record<string, number> | null;                             // null = unknown base
    priorHistory: 'fresh' | 'listed' | 'unknown';   // what happened before the route starts
    priorCompletedQuests: QuestId[]; priorQuestLog: QuestId[];
    riding: 0 | 1 | 2;                              // riding trained before the route
  };
  routeProfile: {               // RXP load-time variables (RXP.md §8.2, §15.5)
    xpRate: number; season: number | null; phase: number | null; hardcore: boolean; ssf: boolean;
    dungeons: string[]; groupQuests: boolean; xpStepSkipping: boolean; locale: string;
  };
  assumptions: Partial<AssumptionValues>;   // overrides; unset = ruleset default (§9.1)
  customQuests: CustomQuest[];
  questOverrides: Record<string, QuestOverride>;   // key = numeric quest id
  imports: RxpImport[];          // { id, name, sourceHash, text, options } for lossless export
  ext: Record<string, unknown>;  // reserved (planned vs actual telemetry)
}
```

- Types are hand-written in `domain`; `project/schema.ts` declares zod schemas typed
  `z.ZodType<ProjectV1>`, and a compile-time test asserts the two agree.
- **Schema version 1 is frozen from the Milestone 4 commit (D-035):** every change bumps
  `schemaVersion` and adds `migrateV1ToV2` and so on to the migration registry, with a test.
- Import: `unknown → detect version → migrate step by step → validate → latest`. Malformed input
  is rejected with path-level errors; nothing is silently repaired. Before an in-place migration
  of a stored project, the old record is copied to `backups`.

## 9. Rules, engine, simulation, validation

### 9.1 Ruleset and assumptions

`src/rules` exports `forever-beta` and `era-1.15`:

```ts
interface RuleValue<T> { value: T; basis: 'client-data' | 'official' | 'reported' | 'era-assumed' | 'assumption';
                         source: string; build?: string; note?: string }
```

Examples: `maxLevel` 60 (official; overridable to simulate beta caps), `xpToNextLevel` (Era;
`era-assumed` for Forever, reported unchanged), `questLogCapacity` 40 (`client-data`: the
Forever client constant; server enforcement at launch unknown) / 20 (Era), `questXpRounding`
'trinity-steps', `questXpMultiplier` and `dungeonQuestXpMultiplier` 1.0 (`assumption`; beta
reports suggest higher), `hearthCooldownSeconds` 3600 (client data), `hearthCastSeconds` 10,
`difficultyYellowLowerBound` -2 (`era-assumed`; the Forever UI fallback uses -4), mount levels
40/60 with TBC-style riding (client data; training cost unknown), `runSpeed` 7.0 yd/s,
`taxiSpeed` 32 yd/s (`era-assumed`, emulator value) with `taxiDetourFactor` (`assumption`),
transport wait and ride seconds (`assumption`), group XP rates (emulator "guesswork", off by
default).

**Precedence:** the effective value is the project assumption when set, else the ruleset value,
and it carries the provenance of whichever supplied it. The UI marks every number that depends
on an `era-assumed` or `assumption` value.

The ruleset also holds the riding spell ids (Apprentice and Journeyman Riding, cited client
values), so a `train` step is recognised as riding either by `skill: 'riding'` or by its
`spellId`.

`rules` also seeds a `TravelGraph`:

- transports (`{ id, from, to, waitS, rideS, factions, basis }`) whose dock positions come from
  dataset dock NPCs (zeppelin and dock masters) or user-entered locations, with assumed wait and
  ride times;
- taxi nodes identified by `TaxiNodeRef` (dataset flight masters by `npcFlags` FLIGHT_MASTER,
  or a cited TaxiNodes id for new Forever nodes), with edges only where known;
- instance entrance edges (zero wait) from the dungeon entrances in `zones.json`, so steps inside
  a dungeon's world map are reachable. An entrance with `frameVerified: false` (three at the pin,
  on changed frames QuestieDB's coordinate audit leaves unverified) seeds no edge
  (DATA_PROVENANCE §6.6; M2 review COORD-4).

Without committed taxi data a leg's time is straight-line distance × `taxiDetourFactor` / taxi
speed; the detour default is a cited aggregate client statistic (D-022, D-024). A local
`taxi.local.json` (§7.3) replaces it with per-leg times on that machine.

**Travel model (D-028).** Walking and riding legs go through one seam, typed in
`src/domain/travel.ts` (the full contract, with doc comments, is there):

```ts
interface TravelEndpoint { point: WorldPoint; zoneHint: number }   // top-level zone AreaTable id, 0 = none
interface TravelSpeeds { groundYps: number; swimYps: number }
interface TravelLeg { seconds: Estimated<number>; method: 'navigation' | 'same-map-transport' | 'straight-line';
                      pending: boolean; warnings: readonly TravelWarning[] }  // no-walking-path, off-navmesh,
                                                                              // unverified-passage, ambiguous-floor, long-swim
interface TravelModel {
  readonly id: 'straight-line' | 'navigation';
  readonly revision: string;                   // navRevision, or 'straight-line'
  leg(from: TravelEndpoint, to: TravelEndpoint, speeds: TravelSpeeds): TravelLeg;   // same world map only
  path(from: TravelEndpoint, to: TravelEndpoint): readonly WorldPoint[] | null;     // for drawing; null if unknown
}
```

The fallback rules (a same-map `TravelGraph` transport between components, then the labelled
straight line with a warning; pending legs; maps without navigation data) are in
[research/terrain-navigation.md](research/terrain-navigation.md) §9.3. The app owns the leg table
(§9.2 there), keyed by the navigation revision.

`straight-line` (distance × `travelDetourFactor` / speed, basis `assumption`) is the fallback.
`navigation` uses the committed derived navigation data built in Milestone 3b from the client's
terrain, liquids and object collision. That includes connectors for bridges, tunnels and
elevators, which come from client geometry or cited data only. Its results have basis
`derived`. The engine, simulation and the optimiser's travel matrix all call the same model, so
they agree. How queries stay fast (a precomputed region graph, caching, a worker) is decided in
the Milestone 3b design step, within the §14 budgets.

**As built (Milestone 3b part 2 and Milestone 6):**

- **Ruleset** (`src/rules/ruleset.ts`): `RULE_KEYS` uses SIMULATION §1.2's names. The detour key
  is `groundDetourFactor` (the project assumption `travelDetourFactor` overrides it); `swimSpeed`
  (4.722 yd/s, `era-assumed`) is new, for `TravelSpeeds.swimYps`. `effectiveRules(ruleset,
  assumptions)` gives every value with `from: 'project' | 'ruleset'`; a project value has basis
  `assumption`.
- **TravelGraph** (`seedTravelGraph`): 7 cited transports, one edge per ordered pair of stops,
  assumed wait and ride, factions unknown. None has a dock position yet (the dataset ships no dock
  NPCs), so transports apply only where the user enters a dock. 5 new Forever taxi nodes from
  cited `TaxiNodes` rows; no taxi edges (OD-6). **No entrance edges:** `zones.json` has no
  instance world map ids yet, so no step inside an instance is reachable and no kill counts as a
  dungeon kill until it does.
- **Straight-line model:** `createStraightLineTravelModel(detour)` (`src/rules/straight-line.ts`):
  basis `assumption`, never pending, `unknown` across world maps.
- **Navigation model:** `createNavigationTravelModel` (`src/app/navigation-model.ts`) reads the
  app's leg table synchronously:
  - the leg table (`NavigationLegTable`) is keyed as terrain-navigation.md §9.2; an entry is
    `{ g, s, c, flags, passages, swimRun }`, the flags being cross-component, ambiguous floor, long
    swim, unsnapped start, unsnapped end and unverified passage;
  - a present leg is `g/10/groundYps + s/10/swimYps + c/10` seconds, method `navigation`, basis
    `derived`, `eraFallback` false (the simulation combines the speeds' provenance);
  - a leg not yet computed is the fallback's seconds with `pending: true`, recorded for the
    scheduler;
  - an endpoint with no polygon within 6 yd: the fallback with `off-navmesh`, naming the end;
  - endpoints in different components: the cheapest same-map transport (walk, `TravelGraph` edge,
    walk; method `same-map-transport`, basis combined by SIMULATION §8, pending until every dock
    walk is known), else the fallback with `no-walking-path`;
  - a map without navigation data, or whose files failed closed: the fallback, final, with no
    warning;
  - flags become the warnings `unverified-passage` (naming the passages), `ambiguous-floor` and
    `long-swim` (with the run's length);
  - `path()` answers from a 256-entry path LRU and is null for fallbacks and transport
    compositions.
- **Scheduler** (`app/navigation-scheduler.ts`): drains the recorded missing legs (up to 2,048 per
  request) and applies results in batches at most every 100 ms. It marks a map unavailable on an
  `integrity`, `format`, `http` or `no-map` failure, and every map on `unsupported` or `not-ready`;
  `network` failures are retried after 5 s. `computeLegs(model, pairs)` is the "computing paths"
  phase (progress, cancel).
- **Worker** (`src/nav/worker`, a module worker; D-028, terrain-navigation.md §9.6): files are
  fetched relative to the app base plus `nav/` and checked against the manifest's SHA-256 (one
  refetch past the HTTP cache), `map.bin` first; integrity and format failures are permanent per
  file. Snaps load every block within 6 yd; the search resumes after each load. While a search
  runs, every loaded block of its map is kept; the LRU evicts over a 100 MB typed-array budget
  (heap target 128 MB). The worker yields through a `MessageChannel`.
- **Manifest** (`infra/nav`): `loadNavManifest` resolves `available` or `unavailable` with a
  reason (unsupported, not found, unreachable, not JSON, invalid, integrity); without a manifest
  the app uses the straight-line model for good.

**Milestone 6 review fixes (2026-09-26):**

- **Starting the worker:** `startNavigation` waits up to 20 s for the worker's `ready` (and its
  navRevision). A script that does not load, a worker that stops on an uncaught error, or no
  answer in time resolves `unavailable` with the reason, and the worker is stopped (NAV-01).
- **Failure classes:** the new `worker-failed` joins `unsupported` and `not-ready` and marks every
  map. `network` now also covers a file that does not arrive within 30 s (response and body) and
  HTTP 408, 425, 429 and 5xx, so those are retried after 5 s; `http` is left for statuses that do
  not pass (404, 403, 410 and the like) and still marks the map (NAV-04, NAV-10). An `internal`
  failure is asked again at most 3 times per map, then that map is marked unavailable; a failing
  group fails only its own legs (NAV-01).
- **Scheduler:** the background drain runs beside a bulk "computing paths" run, so an edit's legs
  go out at once as `interactive`; a leg or path already waiting or in flight is not recorded or
  asked again (NAV-03, NAV-09).
- **Worker memory:** blocks are pinned per search (one group), not per request, and evicted after
  each group; a request runs one map's groups together. On the 2,000-step stress harness the
  typed-array peak is 99.98 MB at the 100 MB budget (118.9 MB before), and 54.6 MB at a 40 MB
  budget, at the cost of refetching (NAV-02). Cancel fails a request at once and releases its
  pins; a fetch that only cancelled requests wait for is aborted (NAV-04). The yield budget
  carries across searches, so many small searches in a row still yield.
- **TravelGraph:** a dungeon entrance may say `raid`, and `instanceKindOf` gives the kill place
  `dungeon` or `raid` (KXP-5). User-entered docks on the project's transport steps position a
  seeded transport's dock when the transport has exactly one stop on that world map, and are part
  of the context key; on the real navmesh, with both docks positioned, Auberdine to Rut'theran
  comes back as `same-map-transport`. Two stops on one map (Rut'theran and Auberdine, Menethil
  and Southshore) cannot be matched yet, because `TRANSPORT_SEEDS` records no UiMap per stop
  (NAV-08, partly fixed). There are still **no entrance edges** (ENG-01): a guard test fails once
  `zones.json` gains instance map ids while the app still seeds none.

### 9.2 Engine walker (`src/engine`)

One state machine walks the route and feeds simulation, validation and route context, so they
cannot disagree.

```ts
interface CharacterState {
  timeSec: number; location: WorldPoint | null;
  level: number; xp: number;                 // known-XP lower bound
  unknownXpEvents: number;                   // > 0 means level/xp are lower bounds
  xpBasis: EstimateBasis; xpEraFallback: boolean;   // combined basis of every XP grant so far
  questLog: Map<QuestId, { objectives: ObjectiveProgress[]; failed: boolean }>;
  completed: Set<QuestId>; abandoned: Set<QuestId>;
  knownFlightPaths: Set<TaxiNodeKey>; hearth: WorldPoint | null; hearthReadyAt: number;
  riding: { trained: 0 | 1 | 2; speedBonus: number };   // set only by train steps
  skills: Map<number, number>; reputationDelta: Map<number, number>; knownSpells: Set<number>;
}
```

- The walker **mutates one working state** and passes visitors a read-only view plus a per-step
  delta. It keeps a cloned checkpoint every 256 steps per project revision, re-walks from the last
  checkpoint before the first changed index, and answers "state at the selected step" from the
  nearest checkpoint.
- Conditions are evaluated by `domain/conditions` against the character and route profile. Level
  words use the route's start level (as RXP does at guide load). Unresolvable tokens (for example
  an unknown Skyborne race token) evaluate to `unknown`: the step stays active with a warning; it
  is never silently hidden. Group-level conditions and variant tags apply to all steps of a group.
- Hearth `use` teleports to `state.hearth` (possibly on another world map); if the hearthstone is
  on cooldown, the walker waits until it is ready and emits a warning.
- Moving to a step's location routes through its group's `leg` waypoints in order, since they
  encode the author's path.
- The initial state comes from the character: `priorCompletedQuests` and `priorQuestLog` seed
  `completed` and `questLog`, and `riding` seeds riding state. With `priorHistory: 'unknown'`,
  unmet prerequisites are `-unverifiable` warnings, not errors.

**As built (Milestone 6):**

- **API** (`src/engine`): `createRouteWalker(context: EngineContext): RouteWalker` with
  `walk(project, visitors?)`, `invalidate(fromIndex?)`, `stateBefore(index)`, `legs()` and
  `checkpointIndices()`; `walkRoute(project, context, visitors?)`, `walkMetrics(walk)`,
  `CHECKPOINT_INTERVAL` = 256. `EngineContext` is `{ dataset, geometry, rules, travel, graph,
  zoneHints?, localTaxi?, acceptPolicy? }`; `WalkProject` is the project's `route`, `character`,
  `routeProfile` and `customQuests`. One walker serves one context: a change of dataset view,
  rules, graph or travel model needs a new walker, and new navigation legs behind the same model
  need `invalidate()`.
- **Conditions are evaluated in `engine/conditions.ts`**, not `domain/conditions`: `domain` holds
  the AST types only (it imports nothing, §4).
- **State additions:** `locationHint`, `hearthHint` (zone hints for travel endpoints),
  `acceptedInRoute` (the "never accepted in the route" test of §9.4) and `trainedSkills`.
  Checkpoints keep the collections that only grow by size and rebuild them as prefixes; tests
  show a re-walk equals a full walk.
- **Records and visitors:** each step gives a `StepRecord` (`estimate`, `delta`, the legs walked
  and every leg asked, for enumeration). A `WalkVisitor` has `begin`, `enter` (the state before the
  step), `leave` (after, with the record) and `end`.
- **Accept policy:** the walker asks an injected `AcceptPolicy` to pick an any-of accept's quest
  and to evaluate `questState: 'available'`; the validator supplies its full rules, and
  `createBasicAcceptPolicy` (VAL-1, 2, 4 and 5 only) is the default.
- **Leg enumeration** (terrain-navigation.md §9.4): `walker.legs()` lists every distinct pair the
  last walk asked the travel model for, compared transport walks included; the straight-line and
  navigation walks ask for the same pairs, except where a transport is chosen by leg cost: when
  navigation legs make another transport the cheapest, its arrival dock, and so the next leg,
  change (Milestone 6 review ENG-10, not changed). The pipeline still converges: the navigation
  model records the new pending leg and the scheduler's drain asks for it.
- **Milestone 6 review fixes (2026-09-26):**
  - **State additions:** `sinceCastBasis` and `sinceCastEraFallback`, the route clock's basis
    since the last hearth cast, which the cooldown wait takes (TIME-4; SIM-07, ENG-09).
  - **The cap:** quest XP at the cap is a known 0 even without an XP record, and a known-XP lower
    bound that reaches the effective cap is exact, so `unknownXpEvents` resets (XP-2, XP-4;
    SIM-01).
  - **Unknown positions:** a move from an unknown position records the non-issue fact
    `position-unknown` with its cause (`start-unset`, `start-unresolved`, `zone-travel`,
    `death-skip`, `unresolved`, `several-spawns`, `hearth-unbound`, `flight-unresolved`,
    `transport-arrival`). From an unknown position, an entity with spawns at more than one point
    leaves the position unknown instead of taking its first spawn (ENG-02, ENG-03).
  - **Start XP** beyond what the start level holds is carried over by XP-2, with the route-level
    warning `SIM023-start-xp-beyond-level` (ENG-11).
  - **Shared pure caches:** the simulation cache and the validator's availability caches are kept
    per (rules, dataset view) object pair (`sharedSimCache`), with walker-keyed entries held
    weakly. "A context change walks cold" now means a new walker with warm pure caches whenever
    the rules and dataset view objects are kept (PERF-06).
  - **Metrics:** `walkMetrics` continues from prefix sums stored every 256 steps, so an edit near
    the end re-sums at most one interval (PERF-07). A restored checkpoint has the initial state's
    property order (PERF-08).
- **Carried objective work (D-040, 2026-09-26):** each quest-log entry records whether an `accept`
  step of the route made it (`routeAccepted`; false for `priorQuestLog` entries and entries assumed
  through an unknown history), and checkpoints copy it. A turn-in of such an entry prices its open
  objectives as one multi-target `complete` without a location at the turn-in's level (open-world
  kills, the lowest drop NPC id), grants their kill XP before the quest XP, and records
  `objectives-carried` with whether its time counts the work (`counted`, `overridden`,
  `unknown`) and the kill XP; other entries keep `objectives-incidental` (SIMULATION TIME-11). The
  work asks the travel model for no leg, so leg enumeration is unchanged.
- **Items collected before the accept (D-040 review):** `CharacterState.itemsBeforeAccept` holds
  the `item` objectives a `complete` step priced while their quest was not in the log (SIM-16).
  It is not grow-only (the accept removes the entry), so checkpoints copy it. The accept that next
  puts the quest in the log marks them done and records `objectives-before-accept`, so nothing
  prices that work twice (SIMULATION TIME-10).
- **Zone hints** come from `app/navigation-hints.ts` through `ZoneHintResolver`; `NO_ZONE_HINTS`
  (all 0) serves the straight-line model and tests.

### 9.3 Simulation (`src/sim`)

Implements [SIMULATION.md](SIMULATION.md): XP table and level-ups, quest XP reduction and
rounding at the turn-in's level, kill XP, time model. Per step:

```ts
interface StepEstimate {
  stepId: StepId; index: number; active: boolean | 'unknown';
  startSec: number; endSec: number;
  duration: Estimated<number>; xpGained: Estimated<number>;
  xpAfter: number; levelAfter: Estimated<number>; levelIsLowerBound: boolean;
  breakdown: { travel: number; combat: number; interaction: number; objective: number; waiting: number };
  assumptionsUsed: AssumptionKey[];
}
interface Estimated<T> { value: T | null; basis: 'source' | 'assumption' | 'derived' | 'unknown'; eraFallback: boolean }
```

- A turn-in with unknown XP adds nothing to `xp`, increments `unknownXpEvents`, and marks later
  levels as lower bounds. A `grind until level L` step makes the level known again (its duration
  is then a derived upper bound).
- The quest XP multiplier applies only to `era-seed` XP, never to user-entered values.
- Objective time and objective kill XP use the same assumed kill count (`basis: 'assumption'`),
  so time and XP stay consistent. A multi-target `complete` costs
  `max(t) + concurrency × (sum(t) − max(t))` over its targets' times `t` (SIMULATION TIME-10;
  `concurrency` 0 = full overlap, 1 = none; an assumption); a `partial` step costs its override or
  0 s ("incidental"), with the finishing step carrying the work. A turn-in carries the work of
  objectives no step finished, priced as a `complete` step without a location at the turn-in's
  level, without travel, when the route accepted the quest (SIMULATION TIME-11, D-040).
- Travel: walking and mounted speed from the ruleset and riding state; cross-world moves need a
  transport step; unresolved locations make travel `unknown`.
- Route metrics: duration, XP, level reached, XP/hour, travel vs combat/objective vs
  interaction shares, each with its basis. The known XP includes the carried kill XP of a turn-in
  whose quest XP is unknown (the level has it too; D-040 review).

**As built (Milestone 6):**

- `StepEstimate.assumptionsUsed` is `RuleKey[]`, not `AssumptionKey[]`: it lists every rule key
  with basis `assumption` or `era-assumed` the step read (SIMULATION §8), ruleset keys included.
- `StepEstimate` gains `facts: SimFact[]` (`src/sim/facts.ts`): what happened that the validator
  turns into issues (SIM-1..21, `VAL030-objectives-incidental`, `VAL030-objectives-carried`), plus
  `pending-leg` (counted into the route-level SIM-22) and `mob-level-assumed` (not an issue). The
  simulation and the engine record facts; only `src/validate` owns issue codes (D-037).
- A leg's warnings pass through as `travel-warning` facts; a pending leg adds `pending-leg`. An
  arrival radius shortens a navigation leg in proportion, `(d − r) / d` (an assumption,
  SIMULATION TIME-2).
- `RouteMetrics` (`aggregateRouteMetrics`) adds `durationIsLowerBound`,
  `stepsWithUnknownTime`, `unknownXpSteps`, `pendingLegs` and `eraFallback`; each share and number
  carries its basis.
- Not applied yet: `groupSize`, `secondsPerObjective` and `killXpMultiplier` (SIMULATION open
  question 10.14), and the QXP-6 money estimate (off by default).
- **Milestone 6 review fixes (2026-09-26)**, with their rulings in SIMULATION §1.5:
  - quest XP checks the cap before the record; `floor(reduce(B) × m)` is `floorProduct`, which
    absorbs the float noise of a decimal multiplier (45 × 1.4 is 63; SIM-01, SIM-03);
  - `levelAfter` folds in the XP table's basis on every grant, and `maxLevel`'s when the cap cut
    the grant; their marked keys join `assumptionsUsed` (SIM-02);
  - new facts `grind-zero-rate` (a grind to a level at 0 XP per hour, SIM-15) and
    `position-unknown` (not an issue); `hearth-cooldown` gains `upperBound` (SIM-04, SIM-07);
  - a `durationOverride` drops the facts about the work it replaces (SIM-15, SIM-11, SIM-2;
    SIM-05, ENG-04);
  - a `complete` target the dataset lacks, or whose objective index its record lacks, is an
    unknown-time target, so kill XP is taken with `f = 1` (SIM-06, ENG-05);
  - kill places are `open-world`, `dungeon` and `raid`: raid elites take the elite multiplier
    only, and a grind on an instance map kills instance mobs (SIM-09; latent until entrance edges
    exist);
  - TIME-6 maps a dataset flight master to the local `TaxiNodes` row nearest it within 50 yd, and
    a row is usable when a known node of the character's faction maps to it (SIM-10; latent until
    a local taxi file with `nodes` exists);
  - group-XP shares are float32, as in vmangos (SIM-12).

### 9.4 Validation (`src/validate`)

```ts
interface ValidationIssue {
  code: string;            // registry in src/validate/codes.ts, e.g. 'VAL004-min-level'
  severity: 'info' | 'warning' | 'error';
  stepId: StepId | null; questId: QuestId | null; message: string;   // explicit nulls, fixed shape
  data: Record<string, string | number | boolean | null> | null;
}
```

Codes use one grammar: a family prefix and number, then a slug (`VAL004-min-level`,
`RXP001-unknown-command`, `DATA001-custom-shadowed`, `SIM001-unknown-xp`). SIMULATION §7 is
the authoritative rule and code list (VAL-1..22, VAL-30..33, LINT-1..4, SIM-1..23, DATA001-003;
SIM-17..23 and DATA003 were added in Milestone 6), with these adjustments:

- level-dependent checks that fail only on the lower bound while `unknownXpEvents > 0` emit a
  `-uncertain` warning variant instead of an error;
- VAL-15..19 (skills, reputation, spells, specialisation) emit `-unverifiable` info when the
  profile lacks the data;
- VAL-22 is an info on accept for `needsEvent` quests and never blocks (the flag means completion
  needs a trigger or event; Questie's consumer blacklists are not an input);
- when `priorHistory` is `unknown`, prerequisite checks, and quest-state preconditions on
  quests the route never accepted (turn-in, abandon, objective work), are `-unverifiable`
  warnings: the quest is assumed to have been accepted before the route;
- repeatable quests are exempt from duplicate accept/turn-in checks;
- unknown quest IDs are warnings; quest-log capacity comes from the ruleset;
- extra checks: flight to an unknown path, hearth on cooldown, cross-world travel without a
  transport, unresolved location, target level reached too late.

Clicking an issue selects its step and focuses the map.

**As built (Milestone 6):**

- **Registry** (`src/validate/codes.ts`, `ISSUE_CODES`): every code with its rule, severity,
  `variantOf`, fixed data keys, message template and explanation; `isRegisteredCode`,
  `issueCodeSpec`, `parseIssueCode`, `formatIssueMessage`. The `RXP` codes stay in `src/rxp`
  (`validate` may not import `rxp`, §4); a cross-module test checks them against the same grammar.
  The UI loads the registry lazily (`app/issue-codes.ts`, from the validation panel's chunk).
- **Codes added:** `SIM017-no-walking-path`, `SIM018-off-navmesh`, `SIM019-unverified-passage`,
  `SIM020-ambiguous-floor`, `SIM021-long-swim` (warnings, one issue per step and kind with a leg
  count) and `SIM022-legs-pending` (a route-level info while navigation legs are pending). The
  quest-state rule above gives `VAL030-not-in-log-unverifiable`, `VAL032-not-in-log-unverifiable`
  and `SIM016-complete-not-in-log-unverifiable` (warnings).
- **Codes added by the Milestone 6 review fixes:** `DATA003-unknown-objective` (warning: a
  target names an objective index its quest's record does not have; ENG-06),
  `SIM005-hearth-cooldown-uncertain` (warning: after a step with unknown time the wait is only an
  upper bound; SIM-07, ENG-09) and a second route-level SIM code, `SIM023-start-xp-beyond-level`
  (warning; ENG-11). A registry test rejects Markdown in messages and explanations (UI-19).
- **Code added by D-040:** `VAL030-objectives-carried` (warning): a turn-in carries the time and
  kill XP of objectives no `complete` step finished, without the travel to them, and the message
  suggests a `complete` step. Its `data.time` (`counted`, `overridden`, `unknown`) picks the
  words, so an override or an unknown time is not claimed as added. LINT-4 then reads the level
  after the carried kill XP. The accept's `objectives-before-accept` is not an issue: the earlier
  step's SIM016 is the warning.
- **Entry points:** `validateRoute(project, context, { baseDataset?, visitors? }) → { walk,
  issues }`, and `createRouteValidator({ dataset, rules, baseDataset?, graph? })`, which returns
  `{ acceptPolicy, visitor, issues(), stepIssues(i), routeIssues() }`. The rules run as a walker
  visitor: `enter` checks an accept against the state before the step, `leave` reads the step's
  record and facts. Issues are kept per step, so a re-walk from a checkpoint re-validates only the
  steps it visits.
- **Wiring:** the walker takes `acceptPolicy: validator.acceptPolicy` and every walk passes
  `validator.visitor`. The policy maps an error to `false`; the `-uncertain` and
  `-unverifiable` variants, `DATA002`, `VAL021` and the VAL-13 vmangos warning to `unknown`.
- **Order and shape:** route-level issues first, then by step, code, quest id and message; every
  issue has all six keys with explicit nulls, and numbers in `data` carry their basis
  (`levelBasis`, `xpBasis`, `eraFallback`, `assumed`, `capacityBasis`).

## 10. RXP (`src/rxp`)

An **independent implementation** built from the behavioural specification in
[RXP.md](RXP.md), which was written after reading RXPGuides. It copies no RXPGuides code, guide
text or data values (D-019). Implementers of `src/rxp` work only from RXP.md and the
self-authored fixtures and do not open the RXPGuides source; spec questions are answered by
updating RXP.md.

1. **Unwrap:** raw text, or static extraction of `RXPGuides.RegisterGuide([[...]])` string
   arguments with a small tokenizer; never a Lua VM. Protected/account-bound import strings are
   detected by shape and refused.
2. **Layer 1, lossless CST:** one node per physical line (kind, raw, indentation, comment, line
   ending, filter AST, text, command, raw args). `print(parse(x)) === x`.
3. **Diagnostics:** line/column-aware and coded, including RXP-compat warnings where RXP itself
   silently drops or changes input. Parser diagnostics are their own type, `RxpDiagnostic
   { code, severity, importId, line, column, rxpCompat, message }` (registry: RXP.md §11.1), because
   they describe text rather than steps; the UI lists them alongside `ValidationIssue`s.
4. **Layer 2, lowering contract:**
   - each RXP step becomes one `RouteGroup` plus its atomic steps, in source order;
   - `.accept`/`.turnin`/`.complete`/`.abandon` → quest steps (consecutive `.complete` lines
     merge into one multi-target step; `.complete` inside a sticky or `#completewith` step is
     `partial`);
   - the last unfiltered `.goto` that yields a point becomes the steps' location (RXP.md §12.4
     covers filtered, closest-point and radius-objective cases); earlier `.goto` legs and pins
     become group waypoints; world-form and percent-form points keep their space, UiMap and
     lexemes;
   - `.hs`/`.home`/`.fp`/`.fly`/`.train`/`.vendor`/`.xp` → hearth/flight/train/vendor/grind steps
     (`.xp L+N`, `L-N`, `L.F` keep their offset); `.zone`/`.subzone`/`.explore` → travel with a
     null location; `.deathskip` → preserved note (position afterwards unknown);
   - tags, step filter, variant tags, skip predicates and annotations go to the group;
   - line filters, `>>` text and source refs go to the step;
   - unknown or unmodelled commands become `note` steps with `preserved` text;
   - percent points on UiMaps 1412/1423/1433/1453 are tagged with the import option's frame
     (Forever by default, Era optional) and get `RXP030-frame-ambiguous`.
   Zone names resolve through a table built from QuestieDB data (validated names from
   `uiMapIdToAreaId.lua`) plus self-authored pseudo-zone keys; localised zone names are rejected.
Implemented in Milestone 5 as the pure `src/rxp` module (registry of diagnostics in
`src/rxp/diagnostics.ts`). Display of imported text strips RXP colour and texture escapes through
`src/app/ui-text.ts` (`plainGuideText`), while the raw text is kept for byte-identical export. A
"complete all objectives" step exports as one `.complete q,i` per known objective, otherwise as an
RXP042 note.

5. **Serializer and export guarantee** (definitions in RXP.md §13):
   - an unedited import exports byte-identical to its source. "Unedited" means every group of the
     import is present, contiguous, in original order, with no foreign steps between, and every
     fingerprint matches (the fingerprint covers the fields listed in RXP.md §13.2);
   - after edits, unedited groups are re-emitted from their original lines, and edited or new
     groups in deterministic canonical form (LF, fixed indent, stable order, original point
     space, UiMap and lexemes; world form only for points created or moved in the app);
   - a group split by editing is emitted as several RXP steps that repeat its tags (except
     `#label`, kept on the first run only), its group condition and its location line, with an
     info diagnostic; each remaining lossy construct has a named diagnostic.

UI labels: "Import RXP custom guide" and "Export RXP custom guide".

## 11. Optimiser (`src/optimizer`)

### 11.1 Interface

```ts
interface Optimizer { optimize(request: OptimizationRequest, options: OptimizationOptions): OptimizerRun }
interface OptimizerRun {
  readonly result: Promise<OptimizationResult>;
  cancel(): void;
  onProgress(cb: (p: OptimizationProgress) => void): () => void;
}
interface OptimizationRequest {
  project: ProjectV1; baseRevision: number;
  section: { firstStepId: StepId; lastStepId: StepId };
  scope: { allowNewQuests: boolean; zones: UiMapId[] | null; levelWindow: [number, number] | null };
  goal: { kind: 'min-time'; targetXp: 'keep-original' | number };
}
interface OptimizationOptions { beamWidth: number; maxEvaluations: number; maxMillis: number | null; divergencePenalty: number }
interface OptimizationProgress {
  phase: 'compiling' | 'searching' | 'finishing'; depth: number; evaluations: number;
  beamSize: number; incumbentSeconds: number; bestSeconds: number | null; elapsedMs: number;
}
type OptimizationResult =
  | { status: 'improved' | 'no-improvement'; termination: 'exhausted' | 'budget' | 'timeout';
      reproducible: boolean; steps: RouteStep[]; unknowns: { quests: QuestId[]; note: string }; stats: SearchStats }
  | { status: 'cancelled'; stats: SearchStats }
  | { status: 'infeasible' | 'failed'; reason: string; stats: SearchStats };
```

`createTypeScriptBeamSearchOptimizer({ dataset, ruleset, geometry, workerFactory })` implements it
(a future WASM implementation would too). It returns candidate steps; `app` builds the `Proposal`
(§12.5) with `diff` and an engine re-walk.

### 11.2 Section contract

Let Q_ext be every quest mentioned outside the section. A proposal must satisfy:

1. **End state:** the state at the section end, projected onto Q_ext (log membership, each
   objective's done flag, turned in, abandoned), equals the original's.
2. **No new blocking:** for each suffix quest, the end state does not newly block it under
   VAL-1..22 at its accept position (checked with the engine).
3. **No loose ends:** pool quests outside Q_ext end the section untouched or turned in, never
   left in the log.
4. **Travel state no worse:** hearth bind point, known flight paths, riding state and
   `hearthReadyAt` are at least as good as the original's.
5. **Anchors:** locked steps are never removed and keep their relative order. **Implicit
   anchors** are added for every step whose condition is not unconditionally true and, until
   stage 3, every unlocked hearth, flight or abandon step. Every other non-quest step (travel,
   note, vendor, train) is **bound** to the next quest action in the same group, or else the next
   quest action, and moves with it; with no such action it is an implicit anchor. Nothing in the
   section is dropped by omission.
6. **Unknown XP:** quests in the section with unknown XP keep their accept and turn-in as
   obligations. `allowNewQuests` never adds unknown-XP or repeatable quests. Target and achieved
   XP count known XP only, and the result lists the unknowns.
7. **Goal:** reach the target XP (default: the original section's known XP), then travel to the
   first step after the section; minimise estimated elapsed time.

The incumbent is the original section, which is always feasible, so every run returns a valid
answer.

### 11.3 Compilation

`optimizer/core/problem.ts` compiles on the main thread (budget ≤ 30 ms):

- pool quests sorted by QuestId, objectives by index, locations by (mapId, x, y, entity id), so
  results never depend on data arrival order;
- per-quest constraint records covering every VAL predicate the engine checks (min/max level,
  required-done sets, required-in-log, blocked-if-done-or-in-log, race/class) plus
  `externalActiveCount` for quest-log capacity;
- actions (accept, complete target, turn in, anchor, bound units, grind; objective clusters in
  stage 2) with location indices and (questLevel, baseXp, xpKnown); XP is computed at transition
  time with the shared `sim` functions;
- a location-by-location travel-time matrix in **integer milliseconds**, computed with `sqrt`
  only; cross-world pairs only via `TravelGraph` edges, otherwise infeasible (never zero);
- **(Milestone 3b, terrain-navigation.md §9.4; built in Milestone 7):** the matrix comes from
  the app's navigation leg table, in integer **tenth-yards** (ground and swim separately) plus
  connector tenth-seconds, as typed arrays; `transitions.ts` turns them into integer milliseconds
  with the state's speeds, so riding state stays exact. Before compile the app makes the
  section's legs complete (`computeLegs`, the "computing paths" phase with progress and cancel).
  Fallback entries come from the same `TravelModel`; pairs across world maps, and same-map pairs
  in different components that a transport joins, use the `TravelGraph`. Matrices are directed and
  cached per (navRevision, sorted endpoint keys);
- every action carries `sourceStepId | null`.

The compiled problem (tens of KB) is posted to the worker by structured clone; the main thread
keeps its decode tables.

### 11.4 Search

- **Stepper:** `createSearch(problem, options)` exposes `advance(maxEvaluations) → progress | done`.
  The output does not depend on slice size (tested with slices of 1 and 10^6).
- **Candidates** are scored as records in preallocated typed arrays (parent rank, action, score,
  elapsed, xp, 64-bit Zobrist key updated incrementally from fixed-seed constants); child states
  are built only for the kept top K.
- **Duplicate handling** per layer: an open-addressing table on the Zobrist key with an exact
  state comparison on a hit. A node is dropped only if another with the same exact key dominates
  it (elapsed ≤ and xp ≥, one strict); each key keeps at most K non-dominated entries.
- **Ordering:** (score, elapsed, parent rank, action index), total and deterministic.
- **Ancestry:** a trail of `(parentTrailIndex, action)` pairs in an `Int32Array`; memory is
  beam width × depth × 8 bytes.
- **Transitions by stage:** (1) accept, complete, turn in, anchors, bound units; (2) grind fill and
  objective clusters (shared targets, drop sources, nearby spawns); (3) hearth (cooldown-aware) and
  flights over known paths.
- **Anytime:** every N layers a greedy rollout from the best beam node may replace the incumbent
  and emits `best`.
- **Heuristic:** `score = elapsed + travelToNearestUsefulWork + remainingXp / estimatedXpRate +
  prerequisitePenalty + divergencePenalty × divergence`, with a precomputed per-location neighbour
  order. It is a practical ranking, not a bound. The UI says "best route found under these
  assumptions", never "optimal".
- `optimizer/core` may not call `Math.hypot`, `pow`, `exp`, `log` or trigonometric functions
  (their results may differ between engines); the architecture test enforces it.

### 11.5 Worker protocol

```ts
type ToWorker =
  | { type: 'start'; runId: number; problem: SearchProblem; options: OptimizationOptions }
  | { type: 'cancel'; runId: number };
type FromWorker =
  | { type: 'progress'; runId: number; progress: OptimizationProgress }
  | { type: 'best'; runId: number; actions: Int32Array; estimatedMs: number }
  | { type: 'done'; runId: number; result: SearchOutcome }
  | { type: 'error'; runId: number; message: string };
```

The worker owns the clock: it runs slices of about 25-50 ms, yields with a `MessageChannel`
self-post (not `setTimeout`, which is clamped), checks for cancel between slices and throttles
progress to about 10 per second. The client terminates and recreates the worker if a cancel is
not acknowledged within a grace period, and ignores messages from stale runs.

### 11.6 Determinism

Identical (problem, options) give identical output when the run ends by exhaustion or
`maxEvaluations`. Results ended by `maxMillis` are labelled `reproducible: false`; no test uses
`maxMillis`. Determinism tests compare proposals modulo new step IDs.

### 11.7 Fixtures (fully specified: coordinates, XP, target, scope, width, expected actions)

1. Greedy-XP trap: a far 3,000-XP quest vs two near 1,600-XP quests.
2. Nearest-neighbour trap (the nearest quest leads away from a cluster near the exit).
3. XP-per-second-ratio greedy trap.
4. Beam width 1 fails, width ≥ 4 succeeds.
5. Level gate: quest C needs a level reached only after A and B.
6. Locked turn-in anchor whose objectives must be scheduled first.
7. Each §11.2 rule, including a custom quest with null XP that must survive.
8. Grind fill reaching a target quests alone cannot.
9. Brute-force oracle over all orders of ≤ 7 actions: at sufficient width the beam equals the
   optimum and never beats it; pruning never removes the optimum.
10. Cancellation, evaluation budget, deterministic tie-breaking.
11. Parity: the worker's estimate for a proposal matches `simulate` within 1%.

## 12. Application shell

### 12.1 State and derived results

```ts
interface EditorState {
  project: ProjectV1; revision: number;       // monotonic, not persisted
  selection: { stepIds: ReadonlySet<StepId>; anchor: StepId | null; focus: StepId | null };
  view: ViewState; proposal: Proposal | null; optimizer: OptimizerUiState;
}
```

- A small framework-agnostic store, read by React with `useSyncExternalStore`.
- One engine walk per revision feeds simulation, validation and route context; results are
  published through the store as revisioned values (async-capable from day one). `DatasetView`
  is memoised on (dataset, customQuests, questOverrides, character overlays).
- **MVP rule:** while an optimiser run is active or a proposal is open, route editing and
  undo/redo are disabled; Reject re-enables them. Accept requires `revision === baseRevision`.
  The lock is a set of reasons (`'optimizer' | 'proposal'`, `acquireLock`/`releaseLock`), so one
  holder cannot release another's lock; `editingLocked` is derived from it. `replaceProject`
  (load or import) is refused while any lock is held and clears history, selection and clipboard.
  Copying stays allowed while locked.
- Lazy boundaries (dynamic `import()`): the map engine (Leaflet adapter), RXP import/export, diff
  and proposal review, optimiser client and worker, navigation worker, migrations. zod stays in the entry chunk to validate restored projects.

**As built (Milestone 6):**

- **A derived store beside the editor store** (`app/derived.ts`, in the entry chunk), not a field
  of `EditorState`, so re-walk batches wake neither the map controller nor autosave.
  `DerivedState` is `{ status: 'loading' | 'ready' | 'failed', failure, results, selected, travel,
  paths }`; `DerivedResults` carries the revision walked, records, estimates, metrics, issues (flat
  and per step), the effective rules, the travel model, pending legs and steps, `final` and
  timings. React reads it with `useDerived` / `useDerivedSelector` (`app/react.ts`). Results may
  lag the editor revision for a moment; the UI shows "updating" when they do (`isCurrent`).
- **The pipeline** (`app/derived-pipeline.ts`, a dynamic `import()` from the composition root,
  with the engine, simulation and validator): one walker and one validator per context (dataset
  view, rules, graph, travel model). Edits coalesce on a zero-delay timer, and a walk always
  reads the store's current project, so a superseded revision is never walked. A context change
  (assumptions, character, navigation becoming available) walks cold.
- **Navigation:** the manifest loads once beside the data. Until it is known the straight-line
  model is used and results are not `final`. After a walk with pending legs the pipeline calls
  `computeLegs(model, walker.legs())`; each batch of results triggers one re-walk from the first
  pending step, at most every 100 ms. `cancelPaths()` pauses computing (the background drain
  included) until `resumePaths()` or `computePaths()`; a caller's abort of `computePaths` stops
  only that caller's wait, and the run carries on (Milestone 6 review NAV-05). `final` is false
  while the manifest is being checked or any step used or compared a pending leg, and
  `provisionalNote(state)` is the sentence the UI puts beside route metrics.
- **Selection:** the state before and after the focused step comes from `stateBefore`.
- **Exports never wait** for any of this: they contain no times.
- **Chunks:** the navigation worker is a module worker emitted as its own script (not an
  `import()`); the issue-code registry is a lazy chunk of the validation panel.

**Milestone 6 review fixes (2026-09-26):**

- **The run's task:** "computing paths" starts in a task of its own after the results are
  published, so the walk that finds pending legs paints first (PERF-03). While a run is in flight,
  an edit's new legs go out at once through the scheduler's background drain; the newer revision
  gets a run of its own when this one ends (NAV-03).
- **Failures during a run:** a failure that may pass is retried after 5 s, and the run publishes
  the failure it waits on (`paths.state` `running` with a `failure`). An unexpected failure turns
  navigation off for every map, so the times become final straight-line estimates, and
  `resumePaths` tries again (NAV-05).
- **One pending reason:** progress counts pending legs, so `total − done` is the results'
  `pendingLegs` and the status bar and the pending note agree (UI-09). `pendingTravelReason`
  (`checking`, `computing`, `retrying`, `paused`, `failed`) gives the route rows, their names,
  Details and the status item's detail the same words (UI-04).
- **Views:** the pipeline keeps four dataset views, the project's and the one without its custom
  quests for two characters, so switching back to the previous character or class reuses its
  views and the pure caches keyed by them (PERF-06; a class toggle publishes in about 27-30 ms
  against 43-52 ms for a class not seen lately, §14).
- **Re-renders:** the panels' selectors ignore the paths' progress, and route rows are memoised
  with stable models, so a progress tick re-renders only the simulation item (PERF-11). The
  pipeline does not yet throttle progress publishes.
- **Walking-path feed** (`app/route-paths.ts`): one record per walked leg holds its request and its
  answer, so the 256-path LRU evicting a path never makes the feed ask for it again (NAV-06). A
  paths object is pending only while a leg in the padded view, or one already requested, has no
  answer; legs out of view that were never asked are drawn as fallbacks and counted apart in the
  map's note (NAV-07, partly fixed: the adapter's pending flag is per object, not per leg). Each
  leg's key is built once (PERF-09). The records hold every answered path of the shown world map,
  so their memory is bounded by the route, not by the LRU.

### 12.2 Undo and redo

Every mutation is a command (`label`, `apply(project) → project`). History keeps immutable
snapshots (structural sharing), capped at 200 entries and an approximate size bound, with
coalescing for rapid edits (typing, held-key moves). Accepting a proposal is one command.

### 12.3 Persistence

IndexedDB via `idb` (ISC): stores `projects` (id → project), `projectIndex` (id, name,
updatedAt, stepCount, dataRevision), `backups`, `settings`. Autosave runs in `requestIdleCallback`
(timeout about 2 s) when the revision changed, and flushes on `visibilitychange` and `pagehide`.
The last open project is restored at startup. Native JSON import/export goes through `project/`.

As built in Milestone 4:
- **Stores:** database version 2 adds a `backupIndex` store, so listings never load full records.
- **Tabs:** each open project holds a Web Lock, and a second tab asks before opening it
  ("Open anyway" or "Open a copy"). Saves are broadcast on a `BroadcastChannel`, so other tabs
  mark the project "changed elsewhere" at once.
- **Leaving the page:** a save started on `visibilitychange`/`pagehide` issues all its IndexedDB
  requests inside the handler. A `beforeunload` prompt guards unsaved changes when saving has
  failed, is blocked or is unavailable.
- **Deleting:** a deleted project goes to "Recently deleted" for 30 days, or until the tab closes
  when storage is unavailable. "Delete permanently" frees space when storage is full.
- **Imports:** imported projects, RXP ones included, are validated with `parseProject` before they
  are stored. Files are decoded as strict UTF-8.

### 12.4 Layout

Dense desktop layout with an original visual system (no copied branding, icons or art):

- **Top bar:** project and route name, quest search, jump-to-zone, import/export (JSON, RXP
  custom guide), settings (character, route profile, assumptions, ruleset), theme, About.
- **Left:** route editor with **fixed-height rows** (one line each; details in the right panel;
  group headers as rows) and in-house index-based virtualisation. Drag preview is local UI
  state; one move command commits on drop. Multi-select, keyboard reorder, duplicate, delete,
  insert, cut/paste/join, lock, add grind/travel/note/custom quest, undo/redo.
- **Centre:** map with layer panel, surface switcher, route line, markers, focus.
- **Right:** tabs Available (search, zone, level/difficulty, relevance, provenance, add), Quest
  log / route context, Details, Validation.
- **Bottom:** level and XP bar (lower-bound marker when uncertain), current step, duration,
  XP/hour, optimiser state and progress, data and ruleset badges.

  **As built (Milestone 6 review, UI-01..UI-03, UI-06, UI-07; to be confirmed):** the simulation
  item never shrinks (its words are capped at 160 px) and the current step is an item of its own
  that gives way first. At 1440 px and below the unavailable optimiser leaves the view but is still
  spoken; at 1280 px and below the gaps are 8 px and the badges drop "Data" and "Ruleset"; at
  1100 px and below the step title hides and the XP track narrows; at 1024 px and below the bar may
  wrap to two lines (the shell's bottom row is `minmax(32px, auto)`). The bar clips horizontally
  without being a scroll container, so a focused Cancel or Resume keeps its whole ring. Focus that
  sat on Cancel or Resume stays on the item when the state changes. The route summary closes when
  focus leaves it, and at 720 px and below it opens in the flow under its button.
- **About / licences:** project licence, no-warranty line, the data notice (including the
  upstream licence finding), non-affiliation with Blizzard, Questie and RestedXP, and a link to
  the exact source commit (injected at build).

Difficulty colours (grey/green/yellow/orange/red) mean difficulty only. Forever provenance uses
glyphs plus text: ◆ new in Forever, ◇ changed in Forever, each with a "user-declared" marker when
the claim comes from the user; "Forever status: unknown" appears as text in Details. Assumed
values carry their own marker. Nothing is conveyed by colour alone.

### 12.5 Proposal review

A `Proposal` holds `baseRevision`, the replacement steps for the section (original step objects
reused unchanged; only new actions get new IDs with `origin.source = 'optimizer'`), a `RouteDiff`,
and metrics from an engine re-walk of prefix + proposal + suffix: duration, XP, level, XP/hour,
travel time, step count, added/removed quests, moved steps. A proposal that adds validation
errors is marked invalid and cannot be accepted. The map can overlay the proposed line. Actions:
Accept, Reject, Apply selected changes (re-walked and re-validated before applying).

## 13. Route diff (`src/diff`)

- Match steps by ID; for imported updates, also by semantic key, with ties broken by original
  index. Each matched step maps to a unique before-index, so move detection is the longest
  increasing subsequence of before-indices (O(n log n)); unmatched steps are inserts or removes.
- Output: operations relative to `before` (`remove`, `insert after`, `move after`, `modify`),
  grouped into **change-sets**: all operations touching one quest form one set, and sets are
  closed under prerequisite and exclusivity dependencies. The UI selects change-sets.
- `applyChangeSets(before, diff, selected)` resolves insert/move anchors to the nearest surviving
  preceding step. The result is re-walked and re-validated before the user confirms.

## 14. Performance budgets

Machine-independent CI gates (fail the build):

| Gate | Budget |
|---|---|
| Entry chunk + static imports (gzip, from Vite's build manifest; chunks loaded by `import()` and worker scripts are reported, not gated) | ≤ 250 KB |
| Each `public/data` file (gzip) | recorded baseline + 10%; total ≤ 1.2 MB |
| Optimiser evaluations on fixed fixtures | recorded baseline, exact |
| `public/nav` (navmesh blocks, `map.bin`, connectors) | ≤ 7 MB total (target 5-6 MB; measured 5.44 MB); ≤ 300 kB per file; per-map baselines + 10% (D-030) |
| `public/maps/art` | ≤ 12 MB total (measured 9.05 MB); per-file baselines + 10% (D-034) |
| `public/maps/terrain` | ≤ 600 kB total (measured 445 kB); per-file baselines + 10% (D-034) |

Time budgets, as Node benchmarks against stored baselines in `docs/measurements/` (fail on a
>25% regression), and later a Playwright run with 4× CPU throttling:

| Area | Budget |
|---|---|
| Dataset fetch to ready | ≤ 1 s; no long task > 100 ms |
| Walk + simulate + validate, 10,000-step route | ≤ 20 ms |
| Edit to derived results published | ≤ 50 ms |
| Diff of two 10,000-step routes | ≤ 50 ms |
| Autosave of a 10,000-step project (main thread) | ≤ 50 ms |
| Map: moveend redraw at the LOD cap / one route edit applied | ≤ 16 ms / ≤ 8 ms |
| Optimiser compile | ≤ 30 ms |
| RXP import of a typical guide (≤ 300 steps), main thread | ≤ 250 ms (measured about 100 ms for 150 steps); whole addon files (thousands of steps, about 1.3 s) move to a worker when a measured need arises |
| Autosave IndexedDB put of a 10,000-step project | measured 35 ms median unthrottled; the Milestone 9 throttled run decides whether steps are stored in chunks (D-036) |
| Optimiser, pool 100 quests (~300 actions), beam 256 | first improvement < 2 s; worker heap < 64 MB |
| Navigation legs for a route section, in the nav worker (RC-07) | ceiling 16 s, with progress and cancel; measured 3.03 s for a realistic 116-point section, heap 60.9 MB; with the worker's fetch and SHA-256 (3b.6) 3.7-4.1 s, heap growth 64.7 MB after gc (peak 91-99 MB); the main thread never waits on it (straight-line fallback until legs arrive) |

**Measured at the final verification after the Milestone 6 review fixes (2026-09-26).** Node
22.13.1 on the reference Windows machine. Two stale background processes kept about two to three
of the 16 logical processors busy (Windows load 24-33%), so each figure is the median of several
process medians, with their spread in brackets. The CPU probe of the `--check` runs read 40.4-41.2
ms against the calm 40 ms.

| Area | Measured | Script, stored baseline |
|---|---|---|
| Entry chunk + static imports | 236.96 kB gzip of 250 kB (232.93 kB at the build, 206.1 kB at the Milestones 4/5 commit); navigation worker script 48.9 kB (17.2 kB gzip), reported, not gated | `pnpm build` (dist audit) |
| Walk only, 10,000 steps, realistic route (the §14 budget case, review PERF-01) | cold 13.4 ms [13.3-13.5], warm 9.3 [8.8-9.6], edit at step 5,000 4.7 [4.6-4.7] | `tests/bench/engine.bench.ts --check`, 3 runs of 3 processes, probe-normalised; `route10000` in `docs/measurements/engine-m6.json` |
| Walk only, stress route (a regression guard) | cold 28.0 ms [26.5-28.2], warm 11.5 [11.4-11.8], edit 5.8 [5.7-5.9] | the same |
| Walk + simulate + validate, realistic route (387 issues) | cold 16.3 ms [15.9-16.4], warm 12.2 [12.0-12.7], edit 6.0 [5.8-6.1]: within 20 ms | `tests/bench/validate.bench.ts --check`, as above; `validate10000` |
| Walk + simulate + validate, stress route (10,423 issues) | cold 40.0 ms [39.9-40.3], warm 23.3 [21.2-23.4] against its 40 ms ceiling, edit 10.5 [10.4-10.9] | the same |
| Edit to derived results published, stress route (10,423 issues) | edit at the start 26.5 ms [24.3-27.0], middle 13.4 [12.2-13.9], end 0.5; nav edits 27.0 / 14.3; a class not seen lately 51.5 [49.3-53.7], **over 50 ms under tsx** and 43.2 [41.2-44.0] bundled; a class toggle 29.9 (27.3 bundled); first walk 54.5 (44.2 bundled); navigation arriving 30.0 ms, then the run's own task 2.7 ms | `tests/bench/derived.bench.ts --budget`, 5 runs under tsx and 3 bundled with esbuild; `derived10000` in `docs/measurements/engine-m6.json` (new) |
| Map route edit with walking paths | move 8.0 ms [8.0-8.2], at the 8 ms budget in Node before the browser's `setLayer` and redraw; a new paths object 4.2 ms (15.4 ms at the build); pan 0.23 ms | `tests/bench/map-paths.bench.ts --budget`, 3 runs; `paths10000` in `docs/measurements/map-m3.json` (new) |
| Map route edit without paths (PERF-2) | move 5.0 ms [5.0-5.3], selection 1.9 ms | `tests/bench/map-edit.bench.ts --check`, 3 runs; `milestone4Perf2` in `docs/measurements/map-m3.json`, within 25% |
| Navigation worker memory (NAV-02) | 2,000-step stress harness: typed-array peak 99.98 MB at the 100 MB budget (118.9 MB before); 10,000 steps 99.99 MB | the nav owner's harness (Node), not stored |

`engine-m6.json`'s `route10000` and `validate10000` were measured after the review fixes by the
simulation owner, and the verification's figures are within 5% of them, so they were not
re-recorded. `derived10000` and `paths10000` are new: the fixes changed the pipeline and the path
feed, and the benches gained `--check`. The derived bench runs under tsx, whose keepNames wrapper
slows it by about 15-20% against a production bundle (review PERF-04), so its `--budget` fails for
a cold class change although a bundle is within the budget.

## 15. Testing

- Vitest: node environment for pure modules, `happy-dom` for components; `fake-indexeddb`.
- Fixtures: a small real Forever slice generated by the extractor (with a NOTICE), synthetic
  optimiser problems (§11.7), RXP samples (self-authored), projects (valid, malformed, old).
- Suites: geo worked examples; difficulty table (SIMULATION COL-3); XP vectors (QXP-T, KXP-7);
  validator rules; RXP lossless and canonical round trips, generated CR-only and mixed line-ending
  variants, whitespace fuzzing, golden canonical files; project schema, type equality and
  migrations; diff (including a large reversed route); optimiser (§11.7); IndexedDB.
- `pnpm data:validate` in CI: output hashes and golden counts.
- A pure end-to-end test: fixture import → lower → walk → validate → export, issues snapshotted.
- `tests/architecture.test.ts` (§17).
- Gauntlet: Playwright smoke against the production preview, including "no request leaves the
  origin" and the throttled performance budgets.

## 16. Build, deployment, licences and notices

- `vite build` → static `dist/`; `base: './'`; every data, map and worker URL is built from
  `import.meta.env.BASE_URL`.
- `package.json` has `"license": "GPL-3.0-or-later"`; the README carries the licence statement
  and copyright line.
- `dist/` must contain `LICENSE.txt`, `third-party-notices.txt` and `data/NOTICE.md`.
- `tools/build/licence-gate.ts` checks production dependencies (and dev dependencies whose code
  reaches `dist/`) against an SPDX allowlist: MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0,
  0BSD, Zlib, CC0-1.0, BlueOak-1.0.0. Anything else needs an exceptions entry and a decision.
- `tools/build/audit-dist.ts` fails if `dist/` contains: `local-maps/` or any `maps.manifest.json`
  marked local-only; images anywhere except `maps/art/` and `maps/terrain/`, and there only when
  that folder ships its `NOTICE.md` and `manifest.json` and the manifest lists the image with a
  matching SHA-256; raw client files (`.blp .adt .wdt .wdl .wmo .m2 .skin .anim .db2` by extension,
  and ADT/WDT/WDL/WMO, M2, DB2 or BLTE content under any name); local paths; `.cache` references;
  `.lua` or source maps; files over budget (§14). It also fails if a required file is missing:
  `LICENSE.txt`, `third-party-notices.txt`, `data/NOTICE.md`, every data file the manifest lists,
  `maps/placeholder/geometry.placeholder.json` and `maps/placeholder/NOTICE.md`. CI additionally
  checks with `git ls-files --error-unmatch` that every runtime-fetched file is tracked.
- Deployable builds come from CI on a clean checkout; release builds refuse a dirty tree.

Planned dependencies:

| Package | Use | Licence |
|---|---|---|
| react, react-dom 19.3 | UI | MIT |
| leaflet 1.9.4 | map | BSD-2-Clause |
| zod 4.x | project validation | MIT |
| idb 8.x | IndexedDB | ISC |
| vite 8, @vitejs/plugin-react 6 | build (dev) | MIT |
| typescript 6.0.x | types (dev; D-023) | Apache-2.0 |
| vitest 5, happy-dom, @testing-library/* | tests (dev) | MIT |
| fake-indexeddb 6 | tests (dev) | Apache-2.0 |
| eslint 10, typescript-eslint 8, eslint-plugin-react-hooks | lint (dev) | MIT |
| luaparse 0.3.1 | data extraction (dev) | MIT |
| tsx 4 | run tools (dev) | MIT |
| @playwright/test | gauntlet smoke (dev) | Apache-2.0 |

Code ported into `tools/` would keep its header and be listed in THIRD_PARTY_NOTICES under "Ported
code". None is ported so far: the CASC reader, the DB2 reader and the BLP decoder are our own.
Build-only dev dependencies added in Milestone 3b: recast-navigation 0.43.1 (MIT; the navmesh
build) and sharp 0.35.4 (Apache-2.0, with LGPL-3.0-or-later libvips; WebP encoding). Neither
reaches `dist/`.

## 17. Enforcement

`tests/architecture.test.ts`:

- the §4 allowlist matrix;
- the **pure set** (`domain`, `geo`, `rules`, `engine`, `sim`, `validate`, `rxp`, `diff`,
  `project`, `optimizer/core`, `nav`, `map/adapter`, `map/layers`) must not reference `window`,
  `document`, `indexedDB`, `Date.now`, argument-less `new Date()`, `Math.random`, `performance`,
  React, Leaflet or `idb`;
- `optimizer/core` and `nav` must not call `Math.hypot`, `pow`, `exp`, `log` or trigonometric
  functions, whose results the platform may approximate (terrain-navigation.md G14);
- committed text files must not contain an absolute path into a user profile, meaning a drive
  letter, `Users` and a real account name (written here as `C:\Users\<name>\` and
  `/c/Users/<name>/`; the check's regex requires an account-name character where `<name>`
  stands, so this definition does not match itself), nor WTF/SavedVariables content.

`tools/build/rxp-overlap.ts` (Milestone 5) clones RXPGuides at a pinned SHA into a temporary
directory and fails if any trimmed line of 24 or more characters in `src/`, `public/`, `tests/`
or `docs/research/rxp-samples/` equals a line of its guides, except for reviewed allowlist
entries.

## 18. Milestones

| # | Milestone | Scope |
|---|---|---|
| 0 | Research, architecture, critique | this document, decisions, provenance docs |
| 1 | Foundation | toolchain, strict TS, lint, Vitest, domain types, zod schemas (unstable v1), store and history skeleton, three-panel shell with placeholder data, architecture test, licence gate, dist audit |
| 2 | Forever data pipeline | `tools/questiedb`, committed dataset and NOTICE, `geo`, committed placeholder geometry (`tools/maps import --placeholder`), dataset loader and `DatasetView`, fixture slice, data review |
| 3 | Map | `MapAdapter`, Leaflet adapter, placeholder rendering with LOD, markers, route lines, focus, layers, local-maps plugin and `tools/maps` local pipeline, map review |
| 3b | Terrain navigation (D-028) | research and design step with critique; read-only TypeScript CASC reader over the local client's `Data/`; ADT terrain, liquids and holes plus WMO/M2 collision; derived walkability or navmesh plus connectors, committed with notices; `TravelModel` implementation and pathfinding within the §14 budgets; route lines follow paths; navigation review |
| 4 | Route editor and storage | route operations, virtualised list, drag and keyboard reorder, lock, undo/redo, IndexedDB autosave, JSON import/export |
| 5 | RXP | unwrap, CST, diagnostics, lowering, serializer, fixtures, round trips, import/export UI, rxp-overlap tool, parser review |
| 6 | Rules, simulation, validation | ruleset, walker, XP/time model, validator, route warnings, validation panel (schema v1 was frozen earlier, at the Milestone 4 commit, D-035) |
| 7 | Optimiser | core, stepper, worker, anchors and section contract, pure `diff`, fixtures, optimiser and performance reviews |
| 8 | Proposal UX | proposal building, metrics, overlay, accept/reject/apply change-sets |
| 9 | Gauntlet | independent reviews, fixes, Playwright smoke, docs, final commit |

## 19. Open questions

Owner decisions and open research items are tracked in the **Owner decisions** table and the
**Open questions** list of [STATUS.md](../STATUS.md). Design-relevant items:

1. Forever XP values (quest, kill, curve) are server-side and unknown; the simulator runs on
   labelled assumptions until measured.
2. Objective counts are absent from QuestieDB; defaults are assumptions with per-step overrides.
3. Taxi data (TaxiNodes/TaxiPath-derived leg times): committed, local-only or unknown in clean
   deploys. Default until decided: local-only; clean deploys use straight-line × detour / 32 yd/s.
   (Walking and riding legs move to the navigation model in Milestone 3b, D-028.)
4. The Skyborne race token and Forever realm season values for RXP filters.
