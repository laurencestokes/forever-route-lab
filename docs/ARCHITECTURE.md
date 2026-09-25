# Architecture

Status: **Milestone 0, revision 2 (2026-09-25)**, after independent critique
([docs/reviews/review-m0-architecture.md](reviews/review-m0-architecture.md)). Grounded in the
Milestone 0 research: [DATA_PROVENANCE.md](DATA_PROVENANCE.md), [MAPS.md](MAPS.md),
[RXP.md](RXP.md), [SIMULATION.md](SIMULATION.md) and `docs/research/`. `D-nnn` references are
entries in [DECISIONS.md](DECISIONS.md); where two entries conflict, the later one wins.

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
                 proposal; pure route operations; condition evaluation (domain/conditions)
  geo/           SourcedPoint/WorldPoint/MapPoint, transforms, distances, zone attribution
  rules/         Ruleset profiles with per-value provenance; TravelGraph seed
  engine/        route walker (one mutable working state, checkpoints, visitors)
  sim/           XP, level, time model (pure functions shared with the optimiser)
  validate/      validation rules; src/validate/codes.ts is the issue-code registry
  rxp/           unwrap, CST parser, filter parser, command registry, lowering, serializer
  diff/          route diff (LIS based), change-sets, apply-selected
  project/       zod schemas typed against domain types, migrations, import/export
  optimizer/
    types.ts     Optimizer interface and request/options/progress/result types
    core/        problem.ts (compile), state.ts, transitions.ts, heuristic.ts, search.ts
    worker/      protocol.ts, optimizer.worker.ts, client.ts
    index.ts     createTypeScriptBeamSearchOptimizer
  infra/         data/ (dataset loader), maps/ (geometry + local-map probe),
                 persistence/ (IndexedDB)
  map/
    adapter.ts   MapAdapter interface, descriptors, view-model input types
    layers.ts    pure: view models → descriptors (memoised per layer)
    leaflet/     LeafletMapAdapter (the only Leaflet importer)
  app/           store, revisions, history, commands, derived-result pipeline, proposals
  ui/            React components, styles, design tokens
tools/
  questiedb/     README.md, upstream.json (the single pin), fetch.ts, extract.ts, validate.ts,
                 diff.ts, lib/
  maps/          README.md, import.ts, convert.ts, validate.ts, vite-local-maps.ts (dev plugin),
                 inputs/db2-rows-1.60.1.70009.json (the 12 cited DB2 rows, committed)
  build/         third-party-notices.ts, licence-gate.ts, audit-dist.ts, rxp-overlap.ts
generated/       questiedb-report.json: extraction report (gitignored; §5.2)
public/
  data/          committed generated dataset
  maps/placeholder/  committed placeholder geometry + NOTICE.md
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
| `project` | `domain`, `zod` |
| `optimizer/core` | `domain`, `geo`, `rules`, `sim`, `engine` |
| `optimizer/worker` | `optimizer/core`, `optimizer/types` |
| `optimizer/index` | `optimizer/*`, `domain`, `engine`, `geo`, `rules`, `sim` |
| `infra/*` | pure modules, `idb`, browser APIs |
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
- A combined "overview" surface (both continents on one canvas) is deferred until after the MVP;
  the surface abstraction keeps it possible.

### 7.3 Placeholder and local maps

With no local art the map draws zone frames, labels, grid, yard scale bar and data points,
procedurally, from committed geometry and data. It contains no Blizzard art.

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
- `turnin` of a quest whose objectives were never scheduled is a warning ("assumed completed
  incidentally"), not an error.
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
- **Schema version 1 is unstable until the end of Milestone 6**: no migration obligation before
  then; fixtures are regenerated. From Milestone 7 it is frozen, and every change adds
  `migrateV1ToV2` and so on to the migration registry.
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

**Travel model (D-028).** Walking and riding legs go through one seam:

```ts
interface TravelModel {
  readonly id: 'straight-line' | 'navigation';
  legSeconds(from: WorldPoint, to: WorldPoint, speedYps: number): Estimated<number>;
  path(from: WorldPoint, to: WorldPoint): readonly WorldPoint[] | null;   // for drawing; null if unknown
}
```

`straight-line` (distance × `travelDetourFactor` / speed, basis `assumption`) is the fallback.
`navigation` uses the committed derived navigation data built in Milestone 3b from the client's
terrain, liquids and object collision. That includes connectors for bridges, tunnels and
elevators, which come from client geometry or cited data only. Its results have basis
`derived`. The engine, simulation and the optimiser's travel matrix all call the same model, so
they agree. How queries stay fast (a precomputed region graph, caching, a worker) is decided in
the Milestone 3b design step, within the §14 budgets.

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
  0 s ("incidental"), with the finishing step carrying the work.
- Travel: walking and mounted speed from the ruleset and riding state; cross-world moves need a
  transport step; unresolved locations make travel `unknown`.
- Route metrics: duration, XP, level reached, XP/hour, travel vs combat/objective vs
  interaction shares, each with its basis.

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
the authoritative rule and code list (VAL-1..22, VAL-30..33, LINT-1..4, SIM-1..16, DATA001-002),
with these adjustments:

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
- Lazy boundaries (dynamic `import()`): RXP import/export, diff and proposal review, optimiser
  client and worker, migrations. zod stays in the entry chunk to validate restored projects.

### 12.2 Undo and redo

Every mutation is a command (`label`, `apply(project) → project`). History keeps immutable
snapshots (structural sharing), capped at 200 entries and an approximate size bound, with
coalescing for rapid edits (typing, held-key moves). Accepting a proposal is one command.

### 12.3 Persistence

IndexedDB via `idb` (ISC): stores `projects` (id → project), `projectIndex` (id, name,
updatedAt, stepCount, dataRevision), `backups`, `settings`. Autosave runs in `requestIdleCallback`
(timeout about 2 s) when the revision changed, and flushes on `visibilitychange` and `pagehide`.
The last open project is restored at startup. Native JSON import/export goes through `project/`.

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
| Entry chunk + static imports (gzip, from Vite's build manifest) | ≤ 250 KB |
| Each `public/data` file (gzip) | recorded baseline + 10%; total ≤ 1.2 MB |
| Optimiser evaluations on fixed fixtures | recorded baseline, exact |

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
| Optimiser, pool 100 quests (~300 actions), beam 256 | first improvement < 2 s; worker heap < 64 MB |

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
  marked local-only; images outside an allowlist of app assets; local paths; `.cache` references;
  `.lua`, `.blp` or source maps; files over budget. It also fails if a required file is missing:
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

Code ported into `tools/` (for example BLP decoding from wow.export, MIT) keeps its header and is
listed in THIRD_PARTY_NOTICES under "Ported code".

## 17. Enforcement

`tests/architecture.test.ts`:

- the §4 allowlist matrix;
- the **pure set** (`domain`, `geo`, `rules`, `engine`, `sim`, `validate`, `rxp`, `diff`,
  `project`, `optimizer/core`, `map/adapter`, `map/layers`) must not reference `window`,
  `document`, `indexedDB`, `Date.now`, argument-less `new Date()`, `Math.random`, `performance`,
  React, Leaflet or `idb`;
- `optimizer/core` must not call `Math.hypot`, `pow`, `exp`, `log` or trigonometric functions;
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
| 6 | Rules, simulation, validation | ruleset, walker, XP/time model, validator, route warnings, validation panel; schema v1 frozen at the end |
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
