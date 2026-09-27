# Map presentation (design, revision 3.1)

Status: **revision 3.1, 2026-09-27: the D-045 addendum (§25), revised after its review.** The owner
asked for "a mapgenie.io style overall" (D-045) and for a general UI like WoWF-QRP's (D-046).
Revision 3 replaced §6's achromatic plate glyph families with teardrop pins (§25.2) and §14.3's layer
panel and key with a category drawer (§25.3). It also set how our extras draw on the minimap base and
on the painted style (§25.4), the new colour tokens (§25.5), contrast over both styles (§25.6), the pin
budgets (§25.7) and the step plan delta (§25.8).

Revision 3.1 answers the review of revision 3 and of the UI refresh
([docs/reviews/review-ui-refresh-design.md](../reviews/review-ui-refresh-design.md), findings UO-01 to
UO-14 and UR-01 to UR-13). It makes §25.3 the **one** specification of the category drawer and the
map's own controls, and §25.2.3 the **one** state table for quest marks in the route rows and on the
map ([ui-refresh.md](ui-refresh.md) revision 2 cites both). It moves the pips to a tag beside the pin's
head, so quest pins take their difficulty colour from *D* 16 as D-041 G asks, and it floats the map's
controls on the map so the map can take the window (§25.3.0). §25.10 lists every change and the
finding behind it. Revision 2 stands wherever §25 does not change it. The owner's answers to G to K are
in D-041, and D-045 supersedes H. Questions P1 to P4 for the owner are in §25.11.

Revision 2 (2026-09-26), for the record: it designs how the map presents quests,
dungeons, flight paths, transports, services and zone colouring, in answer to the owner's requests
(§2). Revision 1 was critiqued three times (project rules and engineering, twice; the owner's point
of view), in [docs/reviews/review-map-presentation-design.md](../reviews/review-map-presentation-design.md):
50 findings: 1 blocker, 21 major, 23 minor and 5 nits. This revision resolves every blocker and major finding and
the minors it agrees with; the review file records how each one was resolved, including those
changed in part. The owner has since taken decisions A to F (D-039), which this revision records as
settled (§23.1). Five questions remain for the owner (§23.2).

It sits on top of any base map. The base map (a seamless atlas of both continents and the islands,
with pre-composited painted-art tiles) is being designed by another team in
`docs/research/map-atlas.md`. That file still did not exist when this revision was written, so this
revision aligns with that team's working notes in `.cache/map-atlas/` (`code-impact.md`, `perf.md`,
the prototypes in `design-*/` and `judge-*/`). The interface both designs depend on is agreed before
any presentation code is written (step MP.0c, §20).

Authority: [ARCHITECTURE.md](../ARCHITECTURE.md) and [DECISIONS.md](../DECISIONS.md) win over this
file, in particular D-018, D-022, D-024, D-028, D-029, D-032, D-033, D-034 and D-039.
[UI.md](../UI.md) §1, §3, §4, §9 and §12 and [MAPS.md](../MAPS.md) §7 are the rules this design keeps;
§22 lists the edits it needs in them and in other files, for their owners.

**Labels.** **MEASURED**: counted or timed here, with the method and the evidence file. **OBSERVED**:
seen on a live site on 2026-09-26, with the zoom and the evidence file. **INSPECTED**: read from a
third-party page's own scripts in a headless browser during the revision 1 study (§3.2; the owner is
asked whether that falls within his allowance, §23.2 K). **CITED**: a client value cited by table,
build and column (D-022). **INFERRED**: a conclusion not tested directly. **ASSUMPTION**: a design
value or estimate, to be measured in the step that builds it. **UNKNOWN**: open.

**Evidence** (gitignored, under `.cache/map-presentation/`):

- revision 1: `friend.md` with `friend/shots/` (WoWF-QRP at commit `378bed9e`), `ours.md` with
  `shots/` (our production build), `data.md` with `data.json` and `data/` (client and dataset
  sourcing, build 1.60.1.70009), `mapgenie/shots/` (the MapGenie study, §3.2);
- the critics: `critic/` and `owner-review/`;
- revision 2: `rev2/` (listed in `rev2/README.txt`):
  - `census.ts` and `census.json`: quest marks under the relevance window, per band (§7.3);
  - `log-objectives.ts` and `log-objectives.json`: objectives of 10- and 20-quest logs (§7.4);
  - `prep.ts`, `spans.json`, `dungeon-spans.json`: zone and dungeon spans per character (§8.4, §12.5);
  - `mock/`: the static mock (our own drawing code over the committed D-033 art), with
    `results/` (label fit, zone colour and draw-cost measurements) and `shots/` (the four bands,
    the colour options, the glyph sheets and the benchmark comparison sheets).

- revision 3: `.cache/ui-refresh/pins-mock/`, listed in §25.0. It holds the pins mock and its shots,
  the contrast sampling and the draw-cost bench. Revision 3's own files are kept beside it with an
  `-r3` suffix (`pins-r3.js`, `mock-r3.js`, `shots-r3/`, `results-r3/`).
- revision 3.1: the same folder, updated in place, and `.cache/ui-refresh/shared/marks.js` (the one
  path set and state table the pins mock and the UI refresh mock both read), listed in §25.0.

Nothing from WoWF-QRP or MapGenie is copied here beyond short descriptions of what they show, and no
WoWF-QRP code was ported. The comparison sheets place the benchmarks' saved screenshots beside the
mock for the owner's review only; they are local evidence and are not for publication.

---

## 0. Summary

Revision 3 changes the rows for glyphs, colour of marks, the flow of quest marks, filters,
performance, comparison and owner decisions. The first row says how, and §25.10 has the details.

| Topic | Decision | Where |
|---|---|---|
| **Revision 3 (D-045)** | **Pins:** our own teardrop in a dark and a light family, one glyph per category. **State:** shown by glyph fill, edge and badges. **Quest pins:** difficulty colour with pips inside the head, from the zone band. **Size:** 12 to 26 px, constant from the zone band. **Grouping:** clusters below the zone band, stacks above. **Category drawer:** counts at the step, show and hide, Show all, Hide all and Defaults, search on the map, a key, kept per browser. **Palette:** the minimap style forces a dark ink set. **Budget:** at most 450 drawn pins per band, drawn from bitmaps | §25 |
| Scope | Presentation layers only. Every item is a plain-data descriptor in world coordinates (a `WorldPoint` with its world map); the adapter places it through the surface's placement. The same descriptors draw on today's per-world-map surfaces and on the atlas. | §4, §18 |
| Zoom bands | Four bands defined by pixels per world yard, computed per placement: **world** (below 0.022), **continent** (to 0.088), **zone** (to 0.5), **close** (above). Thresholds inside the bands switch labels and places (§5.4). | §5.1 |
| Flow | No aggregate flip for quest marks: marks are drawn at every band with sizes that change continuously with zoom; labels and step numbers live in their own non-interactive canvas; a band change cross-fades over 140 ms (none under reduced motion). | §5.5 |
| Quests | Marks show the **state after the active step**, with WoWF-QRP's **relevance window**: available, uncertain ("?" badge) and prerequisite-locked quests near the character's level are drawn; level-locked quests go to an "Unlocks soon" row, off by default. MEASURED: 131 to 373 giver points on both continents at twelve route states, against 590 to 912 under revision 1's rule. | §7 |
| Objectives | The focused quest's objectives raw; every other log quest one counted mark per target and zone, plus a faint outline labelled with the step that completes it. MEASURED over 10- and 20-quest logs. | §7.4 |
| Dungeons | A disc plate at each entrance of a Forever instance (membership from the committed LFG table, D-039 E, and the official announcement), raids ringed; the LFG tuning number (D-039 E) and the dataset's dungeon-quest span, each with its basis; all nine announced new dungeons and both raids listed, the unplaced ones counted by name. | §8 |
| Flight paths | The client taxi graph (D-039 B): nodes of the character's side on rounded-square plates, **known to the route** (solid edge, filled chevron) or not (dashed edge, outlined chevron), the network as thin haloed lines, times from real path lengths (TIME-6). | §9 |
| Transports | Stops from the committed taxi file on hexagon plates; which service a stop belongs to is **inferred** and says so; unmatched stops never feed the engine. | §10 |
| Services | New: innkeepers, the character's class trainers and the vendors the dataset carries, on small light plates, with "Set hearth", "Train" and "Buy" actions. Graveyards need a source (owner question I). | §11 |
| Zone colouring | Picture colour is the base map's; **this design owns the acceptance criteria and a fallback zone tint** (art-sampled, desaturated, neighbours pushed apart; MEASURED). The one semantic colouring is difficulty, in the canvas twin of `DifficultyLabel` on zone cards. Faction as hatching and words (D-039 C). | §12 |
| Colour of marks | Decided G-b (D-041 G): quest marks in the difficulty colour with pips. Revision 3 applies it to pins from the zone band, where the pips fit inside the head. | §6.3, §25.2.3 |
| Labels | Compact one-line labels (name and span) below 0.05 px per yard: every one of the 49 zones and cities is named at the fit-both view (MEASURED). Two-line cards to the zone band, falling back to the compact label. Zone labels to about −1.75, then a DOM "Viewing" chip. Step numbers beside beads. | §13 |
| Interaction | Hover as today. Click opens a DOM popover (the kit's components) with route-building actions. Its keyboard contract is defined in UI.md before it is built. A state-aware Available tab is the keyboard path. | §14 |
| Data | Nothing fabricated. Zone and dungeon spans derived at run time from the committed dataset, over the quests open to the character. Client tables B, C and E committed through one extraction tool with manifest, NOTICE and `--check` (D-039). | §16 |
| Performance | Per-band budgets inside the 2,500-path cap. MEASURED in the mock: 2.6 to 2.9 ms per full redraw of the new mix at the cap at 1×, 12.6 to 12.8 ms at 4×; cached bitmaps for plates and cards bring it to 9.0 to 9.8 ms. The Leaflet harness repeats this before sizes are fixed. Revision 3 measures pins: they are drawn from bitmaps, capped at 450 drawn pins per band, and estimated at about 14.6 ms with projection at 4×. | §17, §25.7 |
| Comparison | Beats both benchmarks on honesty, state at the step, known flight points, labels, accessibility and scale; matches WoWF-QRP on quest density at every zoom; matches both on colour only with decisions G and H; falls short of MapGenie's close-zoom picture. Revision 3 compares the pins and the drawer point by point. The minimap base (D-045) is meant to close the close-zoom gap; that is the atlas addendum's to show. | §19, §25.9 |
| Owner decisions | Taken: A to F (D-039), G to K (D-041), and D-045, which supersedes H. Revision 3 asks P1 to P4: when pins take colour, clusters, services, and the drawer's default. | §23, §25.11 |

---

## 1. Scope and inputs

In scope: what the presentation layers draw at each zoom, their glyphs, colours, labels, hover and
click, accessibility, data and basis, and performance. Out of scope: the base map (art, relief,
tiles, the atlas placements and the flow of the images), owned by `map-atlas.md`, except where
§12.3 sets acceptance criteria for zone colour and §12.4 designs a fallback; the route line's styles
(MAPS §7.4), kept except where §5.5 and §13.6 change them.

Inputs read for this revision, in addition to revision 1's:

- the three critic sections of the review file and their scratch checks (`critic/`, `owner-review/`);
- D-039 and D-040;
- WoWF-QRP `src/app.js` at `378bed9e` lines 322-360 and 596-620 (the availability window and the
  quest marks), read for behaviour only;
- the live WoWF-QRP page, re-checked on 2026-09-26 at about 23:00 (§3.1);
- the atlas team's `perf.md` and prototype shots.

## 2. What the owner asked for, and what "emulate" may mean

The owner, verbatim: "Also, the way https://tyba-dev.github.io/WoWF-QRP/ presents the quests,
dungeons, flight paths and colours the zoomed map is nice - we should emulate that"; later, "In
general, their map is better than ours currently/flows nicer for this tool" and
"https://mapgenie.io/world-of-warcraft-forever/maps/azeroth is nice". Earlier the same day: the map
is slow, the images do not flow from world to zone, both continents are not visible zoomed out, and
the Skyborne start (Zephras Isle) is missing from the world view. Those four belong to the atlas
team; this design must not stand in their way, and its own flow must match (§5.5).

Read as the owner would read it, the request has four parts: a clean quest map that shows where to
go next at every zoom; dungeons and flight points that can be told apart and named; zone names with
level ranges at every zoom, including both continents at once; and a map in colour. Revision 1 got
the ideas right but not these four (review MP-O01 to MP-O05). Revision 2 is built around them.

"Emulate" stays bounded by these rules:

1. **Ideas, not material.** WoWF-QRP is GPL-3.0. D-029 lets us port its *code* with attribution but
   never its data (`data/bundle.b64`, `tiles/`). The brief forbids scraping it and copying its
   branding, icons or assets. This design ports **no code**: its relevance window (§7.2) and its
   dimmed route after the selected step (§13.6) are ideas re-implemented from their behaviour. Its
   `BIOME` palette and zone level ranges are data and are not used. If an implementer later ports
   any code (for example `qmark`, the `draw()` compositing order or the curved flight arc), that port
   needs a D-029 header naming the source path and commit, the licence as it stands at that commit,
   and a THIRD_PARTY_NOTICES entry (§22). MapGenie is a commercial site: studied, never copied.
2. **Reserved colours.** The five difficulty colours mean quest difficulty only; cyan with ◆/◇ means
   Forever provenance only (UI.md §1 principle 4, §4; D-039). Colour is never the only signal (§1
   principle 3).
3. **Unknown stays unknown.** No invented level ranges, connections or times; every displayed
   number carries its basis (UI.md §1 principle 5).
4. **Publishing steps are the owner's.** D-039 settled the icons (our own glyphs) and the client
   tables B, C and E (committed). Anything further (graveyard positions, game icons) needs a new
   decision.
5. **The client is read-only**, through `tools/casc` (`.build.info` and `Data/` only).

## 3. The benchmarks as observed

### 3.1 WoWF-QRP

Studied at commit `378bed9e` (`friend.md`), live site checked the same day. **Version record
(MP-O16):** the owner-view critic read the header "Questie data · v2026.09.26-2017" (evening of
2026-09-26). This revision re-checked the live page at about 23:00 with read-only tools only (no
scripts): the version element exposes no text to them, the "Map layers" panel has 11 rows ("Towns"
and "Vendors, trainers & graveyards (zoomed in)" are new since the studied commit's 10), and the
route panel now offers "Die and res at a Spirit Healer (deathskip)", "Train class spells at the
nearest trainer for your class" and "Buy items from a vendor". The site changes daily, so step MP.12
re-checks it before the final review.

- **One canvas, both continents on one plane, continuous zoom** (scale `s` in px per yard, 0.004 to
  3; "All" is 0.028). No painted art: each zone is filled with an opaque hand-picked **biome** tint
  mixed towards parchment, with a hillshade, paper grain and a sea-foam glow. Zephras Isle is a
  dashed ellipse at a hard-coded position the code calls illustrative.
- **Quests** show the state at the selected step: gold `!` available, grey `!` trivial (off by
  default), a small blue `!` where only locked quests are, orange `!` dungeon quests, `?` turn-ins
  grey or gold by readiness. **The locked quests it draws are only those in a relevance window**
  (`app.js` 322-331): a quest locked by a missing prerequisite whose level is above grey and at most
  the character's level + 4, and which does not follow on from a quest in the log. Quests locked by
  level alone never reach the map; those within 3 levels appear in its Available list as "Unlocks at
  level N". At most three spawns per quest are drawn. Marks are 19 px (13 px below s 0.02) and never
  aggregate. Objectives of log quests: shapes by kind, colour by quest from a ten-colour palette.
  Hover lists the quests with level and "needs X"; click opens a popup with Accept, Objectives done,
  Turn in, Details, Wowhead, "Fly to" and "Go to".
- **Dungeons**: a purple spiral disc from s 0.03, names from 0.05, every entrance, raids included,
  no level; a "N quests inside" pill.
- **Flight paths**: Questie flight masters as faction-filled diamonds, known and unknown alike, no
  connections drawn; routing uses estimated edges, and times print with "≈".
- **Labels**: cream text with a dark halo, zone names with hand-set level ranges ("Tanaris 40-50",
  OBSERVED at s 0.09 by the owner-view critic), fading with zoom, gone by about s 0.26; no collision
  handling. Numbered step badges, skipped within 18 px of another.
- **Route**: solid up to the selected step, faint and dashed after it.
- **Zone colouring is biome-based**: fixed per zone, independent of the character and of level
  (`app.js` 417-418, 470-494). Its level ranges are hand-set, several with "?", including "Darkspear
  Islands (1-12?)", which the client says is a battleground (Map 2997 `InstanceType` 3); the live
  list re-checked tonight still shows it.

### 3.2 MapGenie (OBSERVED 2026-09-26, with INSPECTED facts marked)

**How.** The owner allowed mapgenie.io. The built-in browser pane was hidden in every session that
day, so the WebGL map never drew there (the atlas team and both critics met the same). Revision 1
therefore took its screenshots with a headless Chrome and a throwaway profile, and answered the
consent dialog "More Options", then "Reject All". That driver also ran scripts in MapGenie's page to
read its map engine's state (review MP-R18). The facts that came only from that inspection are
marked **INSPECTED** below; everything else is confirmed by the saved screenshots. The owner is
asked whether automated access of that kind falls within his allowance (§23.2 K); until he answers,
no further automated access is made, and the INSPECTED facts carry no design weight. The owner-view
critic's live look (read-only tools, pane hidden) read the category panel's text: 22 categories,
among them Quest 190, Instance 29, Flight master (neutral) 72, Transport 28, Class trainer 175,
Merchant 148, Innkeeper 9 and Graveyard 30.

**Zoom calibration (MEASURED on the screenshots):** the Orgrimmar and Thunder Bluff flight-master
pins were 625.2 px apart at MapGenie zoom 12, and the nodes are 5,204 yd apart, so **MapGenie zoom
= our CRS.Simple zoom + 15.06** on Kalimdor.

| MapGenie zoom | Our zoom | What it shows | Evidence |
|---:|---:|---|---|
| 7 (least) | −8.06 | Tiles start at z8, so the land disappears; the pins pile up | `15-world-min-zoom.png` |
| 10 (initial) | −5.06 | Both continents on one surface, Zephras Isle as a framed, labelled inset south-west of Kalimdor; every pin at full size, heavily overlapping | `01`, `02` |
| 12 | −3.06 | No zone names, borders or colouring beyond the ground render; town pins stacked; a click in a dense town hit a different pin | `03`, `08` |
| 13.5 | −1.56 | Quest pins separate; hover shows the title; click shows title, category, one line and a login call to action | `04`-`07` |
| 16 | +0.94 | A top-down render of the world with buildings | `10` |
| 17 (most) | +1.94 | Tiles upscaled from z16 | `11` |

- **Pins**: teardrops with a white or yellow glyph; flight masters red, blue or yellow by side
  (colour only on the map), quests a dark pin with a yellow "!", instances a swirl, transport an
  anchor. The pin size does not change with zoom (screenshots `01`, `03`, `04`, `10`; the engine
  detail behind it is INSPECTED).
- **Legend and filters**: the category panel is the legend: glyph, name and count per category,
  grouped; a hidden category is struck through; "Show all" and "Hide all"; search filters the map to
  its results (`12`, `14`).
- **Popups**: "Wailing Caverns — Instance — 5-Man Dungeon (Level 15-25)"; transport "Destination:
  Undercity"; a quest gives only "Start: <NPC>".
- **Not shown**: flight connections, transport routes, zone names, borders, level ranges, labels
  on the map (screenshots). Region titles and polygons that exist in its style but are switched off
  are INSPECTED.
- **Flow**: fractional zoom with cross-faded tiles on one surface, so zooming is smooth. A 300 px
  advertisement covers the lower left of the map at 1440 × 900.

### 3.3 Our map today (from `ours.md`, production build)

- One surface per world map; one painted image at a time; neighbours show as relief only.
- Quest givers: an upward triangle in ink for every quest open to the character's race and class
  (543 markers in the initial view); no state at a step. Below zoom −3.5, one count box per zone.
- No dungeon markers; flight masters as a plus, no names, no connections; transports as dashed legs
  and rings. No zone colouring. A full map key. Stack badges read like step numbers.

## 4. Principles

- **P1. Any base map.** Descriptors carry world coordinates and the world map; nothing in a
  descriptor knows the surface, its placement or its art.
- **P2. Scale, not zoom numbers.** Bands and thresholds are in pixels per world yard, computed per
  placement (§5.1), so they mean the same on every surface and inside an inset.
- **P3. Shape carries meaning; colour adds to it and never replaces it.** Categories and states
  differ by silhouette, fill, edge, dash and badge. Hue appears only where a rule allows it and a
  non-colour cue is drawn beside it (§6.3).
- **P4. The state at the selected step**, with a relevance window (§7.2), so the map shows where to
  go next and not everything that is not yet possible.
- **P5. Unknown stays unknown.** Every number says where it comes from (§16); what is not known is
  not drawn and is counted in the layer's notes.
- **P6. Flow first.** Nothing pops at a band edge: sizes change continuously, and label changes
  cross-fade (§5.5).
- **P7. The base map speaks first, where it can be read** (§13.5).
- **P8. Within the budgets** (ARCHITECTURE §14; MAPS §7.2): the 2,500-path cap, `moveend` at most
  16 ms at the cap, one route edit at most 8 ms. §17 measures what it can now and names what the
  harness measures next.
- **P9. Keyboard paths elsewhere.** The map stays supplementary (UI.md §9 rule 12), and every path
  this design relies on is built in its plan (§14.4).

## 5. Zoom bands, layers and descriptors

### 5.1 Bands

A band is chosen from the **pixels per world yard** of the placement an item is drawn through:
`pxPerYard = 2^zoom × placement.scale`, where `placement.scale` is atlas units per world yard (1 on
world surfaces; about 1.004 for map 0 on the atlas if its unit is one map-1 yard; the inset's own
scale for an inset). The adapter computes it per placement; the controller turns it into
`MapView.band` with hysteresis (below), so the stateless builders stay deterministic (review
MP-R10).

| Band | px per yard | Our zoom on world surfaces | WoWF-QRP `s` | MapGenie zoom | Typical view at 900 px |
|---|---|---|---|---|---|
| World | below 0.022 | below −5.5 | below 0.022 | below 9.56 | both continents on the atlas |
| Continent | 0.022 to 0.088 | −5.5 to −3.5 | 0.022 to 0.088 | 9.56 to 11.56 | a third of a continent to a whole one |
| Zone | 0.088 to 0.5 | −3.5 to −1.0 | 0.088 to 0.5 | 11.56 to 14.06 | one zone to a town and its surroundings |
| Close | 0.5 and above | −1.0 and above | 0.5 to 3 | 14.06 and above | a town, a camp |

- The fit-both view in the 918 px panel of a 1600 px window is 0.0239 px per yard (zoom −5.39,
  MEASURED, `owner-review/fit.txt` and `rev2/results/labels.json`): the top of the world band's
  hysteresis zone. Nothing in this design depends on which side of 0.022 it lands, because the
  compact labels (§13.3) run from the world band to 0.05.
- A band changes only when the scale passes its edge by 0.125 zoom (half a `zoomSnap` step), in the
  controller, so it does not flicker (ASSUMPTION; checked in MP.1).
- Thresholds inside the bands (§5.4) use the same rule.

### 5.2 Layers and budgets

New layers (`LAYER_IDS`), bottom to top. The image layers stay the base map's.

`relief`, `art`, `coastline`, `zone-outlines`, **`zone-fill`**, `zone-frames`, **`flight-network`**,
**`transports`**, **`dungeons`**, **`services`**, `available-quests`, `objectives`, `turn-ins`,
`flight-masters`, `route-line`, `route-steps`, `proposal`, `selection`; then, in a separate
non-interactive canvas pane above them, **`labels`** and **`step-numbers`** (§5.5, §13).

- `zone-fill`: the fallback zone tint (§12.4) and the optional faction hatching (§12.6).
- `flight-network`, `transports`: lines under every marker, so markers win hit-testing.
- `labels` and `step-numbers` draw above the route line for legibility but take no hits (review
  MP-R14): a card never takes hover or clicks from a mark or a route segment. An empty-map click at
  continent zoom still jumps to the zone, as today.

**Budgets per band.** *(Revision 3: the pin layers have new budgets, at most 450 drawn pins per
band, in §25.7. The other rows below stand.)* Not every layer draws at every band (objectives and services only at the
zone band and closer, the zone tint and hatching only at the world and continent bands), so
`DEFAULT_LOD` holds a budget per layer **per band**, and `createLod` refuses settings where any band's
sum exceeds the 2,500 cap. That keeps MAPS §7.2's guarantee (every layer capped on its own inputs,
the surface under the cap) while giving the layers of each band the room they need. On the atlas
both continents share the cap.

| Layer | World | Continent | Zone | Close | Basis |
|---|---:|---:|---:|---:|---|
| `zone-frames` (+ terrain paths) | 60 | 60 | 60 | 60 | 49 zone and city frames on maps 0 and 1 plus the extents and 4 terrain paths on the atlas (MEASURED, committed geometry) |
| `zone-fill` | 100 | 100 | 0 | 0 | at most 49 tint polygons and 49 hatching fills on the atlas |
| `flight-network` | 0 | 150 | 100 | 100 | 143 node pairs on maps 0 and 1 at most for one side (MEASURED by the rules critic; 143 pairs in the mock's taxi extract) |
| `transports` | 30 | 30 | 30 | 30 | 27 stops on maps 0 and 1 (MEASURED, mock extract) plus connectors |
| `dungeons` | 40 | 40 | 40 | 40 | 23 LFG-listed entries with 29 entrances plus the raid entrances (review MP-R11) |
| `services` | 0 | 0 | 60 | 60 | 10 to 12 in view at the zone band, 6 at the close band in the mock (MEASURED); ASSUMPTION until MP.11 |
| `available-quests` | 450 | 450 | 300 | 300 | at most 373 default giver points on both continents in twelve route states; at most 79 in view at the zone band (MEASURED, §7.3) |
| `objectives` | 80 | 80 | 500 | 500 | focused quests only below the zone band; 500 kept until the log bench measures (review MP-R21, §7.4) |
| `turn-ins` | 120 | 120 | 120 | 120 | log capacity 40 (client data); turn-in points per quest median 1, p90 1 (MEASURED by the rules critic) |
| `flight-masters` | 70 | 70 | 70 | 70 | 65 client nodes on paid paths on maps 0 and 1 (MEASURED, mock extract); one side shown |
| `labels` | 60 | 120 | 60 | 40 | 49 zone labels plus continent and inset names; plus place names at the continent band |
| `route-line` | 150 | 150 | 150 | 150 | unchanged |
| `route-steps` | 700 | 700 | 700 | 700 | unchanged |
| `proposal` | 100 | 100 | 100 | 100 | unchanged |
| `selection` | 100 | 100 | 100 | 100 | unchanged |
| **Sum** | **2,060** | **2,270** | **2,390** | **2,370** | each at most 2,500 |

`labels` and `step-numbers` are in their own canvas, but they count against the cap as paths, so the
total drawing work stays bounded. Step numbers are capped at 150 in view (ASSUMPTION; §13.6) inside
the `route-steps` budget.

### 5.3 Descriptor changes (`src/map/adapter.ts`)

All plain data with stable ids, as MAPS §7.3 requires; route descriptors still carry no step
numbers, and no descriptor text contains "after step N" (that goes through the label provider from
the active step id at paint time; review MP-R04).

- `MarkerKind` gains `dungeon`, `raid`, `flight-point` (replaces `flight-master` in the glyph set;
  the layer id stays), `transport-stop`, `portal`, `innkeeper`, `trainer`, `vendor`.
- `MarkerDescriptor` gains `state: MarkState | null`:
  `'available' | 'uncertain' | 'locked' | 'unlocks-soon' | 'low-level' | 'in-progress' | 'ready' | 'known' | 'not-known' | 'may-be-known' | null`,
  and `size: 'band'` (the adapter derives the pixel size from the zoom, §6.1). The state is part of
  `sameData`, so a state change restyles in place.
- `MarkerBadge` gains `uncertain` ("?"), `dungeon-quest`, `unverified-entrance` and `raid`; badge
  slots are fixed (§6.1).
- `LabelDescriptor` (new): `{ type: 'label', id, point, kind: 'continent' | 'inset' | 'zone' | 'place', text, card: ZoneCard | null, priority, minPxPerYard, maxPxPerYard, ref }`.
  `ZoneCard` holds the name, the span text and its basis key, the difficulty twin's computed input
  (a difficulty key, the level text and a lower-bound flag, computed in `src/app/zone-levels.ts`:
  review MP-R10), and a fixed width reserved for the widest content (review MP-R26). The priority is
  static (§13.2).
- `AreaDescriptor` (new): `{ type: 'area', id, ring: readonly WorldPoint[], style: 'objective-area', labelStep: StepRef | null, ref }`
  for the objective outlines (§7.4).
- `ZoneFillDescriptor` (new): `{ type: 'zone-fill', id, mapId, areaId, rings, fill: { tint: string } | { pattern: 'alliance' | 'horde' | 'none' | 'both' | 'sanctuary' }, ref }`.
  Rings are the terrain zone polygons (D-032), cut to land (§12.4).
- `PolylineDescriptor.style` gains `network-flight` and `network-transport` (§6.1).
- Cross-map rides use the atlas's `connector` descriptor, drawn only when both ends are placed.
- `MapRef` gains `{ kind: 'dungeon', dungeon }`, `{ kind: 'taxi-node', node }`,
  `{ kind: 'taxi-edge', from, to }`, `{ kind: 'transport', id }`, `{ kind: 'service', npc }` and
  `{ kind: 'zone', uiMapId }`.
- The label provider (`MapLabelProvider`) gains `stepNumber(stepId)` and `activeStepText()`, asked at
  paint time.
- The pole of inaccessibility used to anchor zone labels is computed by a pure function in
  `src/geo/pole.ts` over the terrain zone rings, when the outlines load (review MP-R10).

### 5.4 What appears at each band

| Element | World (< 0.022) | Continent (0.022-0.088) | Zone (0.088-0.5) | Close (≥ 0.5) |
|---|---|---|---|---|
| Base map (atlas team) | both continents, insets | continent painting or mosaic | zone mosaic | zone art, relief |
| Zone colour (§12) | the base map's; fallback tint if it fails §12.3 | same | the base map's | same |
| Continent and inset names | yes, unless painted legibly (§13.5) | — | — | — |
| Zone labels | compact: name and span (to 0.05) | compact to 0.05, then cards (compact fallback) | zone labels to about 0.3 (zoom −1.75), then the DOM "Viewing" chip | "Viewing" chip |
| Quest givers (default rows) | marks, 6 px | marks, 6 to 10 px | marks, 10 to 14 px | marks, 14 to 16 px |
| Turn-ins (log quests) | marks | marks | marks | marks |
| Objectives | focused quests only | focused quests only | focused raw; others counted; outlines | same, larger |
| Dungeons, flight points, transport stops | from 0.03 px per yard | plates; names from 0.05 | plates and names | same |
| Services | — | — | innkeepers and class trainers from 0.149 (zoom −2.75) | plus vendors from 0.5 |
| Flight network | — | from 0.03 | lines | lines |
| Route line | solid before the active step, faint and dashed after (§13.6) | same | same | same |
| Step beads and numbers | active step only | beads from 0.05 | beads and numbers | same |
| Faction hatching (D-039 C, off by default) | when chosen | when chosen | fades out | — |

### 5.5 Flow between bands (review MP-O09, MP-R09)

The owner's first complaint is flow. Revision 1 switched cards to marks at −3.5 and changed glyph
sizes in steps; revision 2 removes each pop:

- **No aggregate flip for quest marks.** Marks are drawn at every band (§7.3); zone aggregates return
  only when a layer is over its cap, and then only for the surplus, with a label (MAPS §7.2 rule).
  *(Revision 3: pins are about twice the size of these marks, so quest givers and turn-ins are
  clustered below the zone band. The clusters nest, count every member and split at fixed zooms
  with this cross-fade (§25.2.5).)*
- **Continuous sizes.** A glyph's size is a piecewise-linear function of the zoom (§6.1), evaluated
  at every redraw, so one `zoomSnap` step of 0.25 changes a mark by at most 0.6 px.
- **Labels in their own canvas.** `labels` and `step-numbers` live in a non-interactive canvas pane
  above the path canvas (`frl-labels`, z-index 450). A label change never redraws the 2,500 paths,
  and a renumbering after an edit redraws only that pane (§13.6).
- **A time-based cross-fade at a band change.** Leaflet redraws its canvas only at `zoomend`, so an
  opacity that depends on the zoom would be seen only at resting zooms, where `zoomSnap` 0.25 could
  leave text at half opacity (review MP-R09). Instead, at a band change the adapter copies the
  outgoing label canvas into a transient canvas and fades it out over `--frl-duration` (140 ms) while
  the new one is drawn at full opacity; under `prefers-reduced-motion` the duration is 0. At every
  resting zoom every label is at full opacity. The path canvas takes the same treatment when the
  objectives of other log quests appear at the zone band.
- **Pre-building.** Within one zoom level of a band edge, the controller builds the next band's
  content in idle time (perf.md hotspot 5), so the crossing costs a swap, not a rebuild.
- **Verification.** MP.1 measures the crossing, and MP.12 records a zoom sweep from the fit-both view
  to the close band at 1× and 4×, frame by frame, beside the benchmarks.

## 6. Glyphs and colour

> **Revision 3 supersedes most of this section (D-045).**
> - Replaced by §25.2 (pins) and §25.5 (tokens): the three families, the silhouettes, the sizes,
>   the plate tokens and the badge slots.
> - Still in force: the line styles table, §6.3's decision (taken as G-b, D-041 G) and the
>   objective point marks of a focused quest.
> - Amended: the rules for every glyph (§25.2.8).

### 6.1 Glyph set (our own shapes, drawn on the canvas)

Three families, so a glance separates tasks from places and places from services:

- **Marks** (quests, turn-ins, objectives, steps): bare glyphs in the ink colour with a 2 px halo in
  the surface colour, as today.
- **Places** (dungeons, raids, flight points, transport stops, portals): a dark core
  (`--frl-map-plate`) with a light 1.5 px edge (`--frl-map-plate-edge`) and a light glyph inside.
  **Each family has its own silhouette** (review MP-O06), so it can be told apart before the glyph is
  read: a **disc** for dungeons (a ringed disc for raids), a **rounded square** for flight points, a
  **flat-topped hexagon** for transport stops and an **upright oval** for portals. No plate is a 45°
  diamond.
- **Services** (§11): a smaller **light** rounded square (light core, dark edge and glyph), the
  inverse of a place plate.

**Sizes** are piecewise linear in the zoom (ASSUMPTION; tuned in MP.4 against the mock and the
benchmarks' 13 to 19 px marks): marks 6 px at zoom −5.5, 10 px at −3.5, 14 px at −1, 16 px at +1;
plates 9, 12, 16 and 18 px at −5, −3.5, −1 and +1; objectives 4, 5 and 7 px at −3.5, −1 and +1.
The glyph sheet (`rev2/shots/sheet-light.png`, `sheet-dark.png`) draws every entry below at its
smallest and a larger size over light and dark D-033 art, in both themes. Quoted texts are
templates: step numbers and names in them are examples, not data.

| Kind and state | Shape | Non-colour cue | Spoken form (key, hover) |
|---|---|---|---|
| Quest, available | solid upward triangle | solid | "Quest available after step 14" |
| Quest, uncertain | outline triangle with a "?" badge | the badge | "May be available after step 14: <doubt>" |
| Quest, locked by a prerequisite (in the window) | outline triangle, 1.6 px | hollow | "Locked after step 14: needs Cutting Teeth" |
| Quest, unlocks soon (off by default) | outline triangle at 80% with the required level beside it | the number | "Unlocks at level 16 (level after step 14: 14)" |
| Quest, low level (off by default) | solid triangle at 70% | smaller | "Low level after step 14" |
| Dungeon quest | the mark with the `dungeon-quest` badge (a small arch) | badge | "…has objectives inside a dungeon" |
| Turn-in, in progress / ready | outline square / solid square | fill | "Turn in: … (objectives not done after step 14)" / "Ready to turn in after step 14" |
| Objective: NPC / object / event area | filled dot / ring / plus sign | shape | "Objective of …: kill or loot <NPC>" / "…: use or loot <object>" / "…: event area" |
| Objective area of a log quest | faint outline with the step number that completes it | outline, number | "Objectives of Plainstrider Menace: completed at step 22" |
| Dungeon / raid entrance | disc / disc with an outer ring, arch glyph | silhouette, ring | "Dungeon entrance: Wailing Caverns" / "Raid entrance: …" |
| Unverified entrance | the above with the dashed off-frame ring | dashed ring | "position not verified by the dataset's audit" |
| Flight point, known to the route | rounded square, solid edge, filled chevron | solid | "Flight point: Crossroads, known to the route after step 14" |
| Flight point, not known to the route | rounded square, dashed edge, outlined chevron | dashed edge, hollow glyph | "…not known to the route after step 14" |
| Flight point, may be known (unknown history) | as not known, with the "?" badge | badge | "…may be known before the route (history unknown)" (review MP-R13) |
| Transport stop | hexagon, hull glyph | silhouette | "Transport stop: to Tirisfal Glades (service inferred)" |
| Portal | oval | silhouette | "Portal to Darnassus (owner's observation, date)" |
| Innkeeper / class trainer / vendor | light square with a cup / a book / a coin | light plate, glyph | "Innkeeper: … · Set hearth here after step 14" |
| Step | bead (as today) | — | as today |
| Stack of n items | "×n" pill | the "×", a pill | "6 here: …" |

**Badge slots** (review MP-R28), one position each, so no two collide: top left, the dungeon-quest
arch; top right, the instance square (existing); bottom left, the "?" of an uncertain state; bottom
right, the "×n" stack pill; around the glyph, the dashed off-frame ring (existing). Below 10 px only
the "?" and the "×n" are drawn, and the hover names the rest. `glyphExtent` covers every slot. The
sheet's last row draws a mark carrying every badge. The event-area objective is a plus sign, which
is free now that flight points are plates; it no longer uses the dashed ring, the off-frame badge.

Lines (review MP-R15):

| Style | Pattern | Width | Colour role | Meaning |
|---|---|---|---|---|
| `network-flight` | solid, with a 3 px halo | 1.1 px | muted ink | a flight the character's side may take (D-039 B) |
| `network-transport` | dashed 3-3, with a 3 px halo | 1.1 px | muted ink | a transport route |
| route legs | as MAPS §7.5 (flight dotted 1-6 at 2.5 px, transport dashed 10-6 at 3 px) | | accent / muted | unchanged, except the part after the active step (§13.6) |

Every pattern differs from every other by pattern and width, not colour alone; the key and
`style.test.ts` name each.

Rules for every glyph:

- **No diamond** (◆/◇ mean provenance; MAPS §7.5).
- **No triangle with "!"** (the severity warning's glyph, UI.md §4).
- **No "!" or "?" in a game-like gold**, and no game icons (D-039 A; UI.md §1 principle 1).
- Hit radius stays the glyph size plus 2 px plus the renderer's tolerance (MAPS §7.5).

### 6.2 Colour tokens

| Token | Light | Dark | Block | Purpose | Checks |
|---|---|---|---|---|---|
| `--frl-map-plate` | `#1a1a1a` | `#1a1a1a` | theme-independent | place plates; service glyphs and edges | achromatic |
| `--frl-map-plate-glyph` | `#f2f2f2` | `#f2f2f2` | theme-independent | glyph on a place plate; service core | 15.5:1 on the plate (review MP-R11) |
| `--frl-map-plate-edge` | `#f2f2f2` | `#f2f2f2` | theme-independent | place plate edge | 3:1 or more against the plate |
| `--frl-map-label-halo` | `#ffffff` at 85% | `#0d0d0d` at 85% | theme-dependent | text and line halo | `--frl-fg` on it, painted over black and over white, at least 4.5:1 |
| `--frl-map-hatch` | `#000000` at 35% | `#ffffff` at 35% | theme-dependent | faction hatching | decorative; the words carry it |

- All five are achromatic, so the hue test in `tests/ui-tokens.test.ts` returns no hue for them. Add
  them to its contrast pairs and to `style.test.ts`'s "never a reserved colour" check.
- The fallback zone tint (§12.4) is generated, not a token: it is picture, bounded by a test (§12.4).
- Why no free category hues: after the §4 distances (30° from 0°, 20°, 60° and 120°; 25° from cyan at
  about 187°) and 25° from the severity and accent hues (215°, 231°, 267°, 320°), the only window left
  is about 150° to 162°, which sits 30° to 42° from difficulty green. Option G-c (§6.3) uses it once.

### 6.3 Colour of the marks: owner decision G (review MP-O05)

*Decided: G-b (D-041 G). §25.2.3 applies it to pins: revision 3.1 shows the colour from a pin of
*D* 16, whose glyph box is 11 px, with the pips in a tag beside the head (revision 3 waited for the
zone band; review UO-04, UR-01).*

Revision 1 spent no hue at all, and the owner was not asked. D-039 A settled where icons come from,
not colour. The rules reserve two colour families and forbid colour-only cues; they do not forbid
colour. The mock (`rev2/shots/decision-G-colour.png`, the zone band in the three options and in the
dark theme; `band4-close-difficulty.png`) shows:

- **G-a. Monochrome** (the default until the owner decides): ink marks, dark plates, the accent route.
  Legible on every art, in both themes; reads less vividly than either benchmark.
- **G-b. Quest marks in the difficulty colour** (recommended). Available and ready-to-turn-in marks
  are filled with their quest's difficulty colour at the step (COL-1, the colour `DifficultyLabel`
  would show), edged with the dark well colour (`#101216`), because the colours are specified
  against that well, and carry the five-pip bar under the mark. That is difficulty, the one meaning
  the colours may carry (UI.md §1 principle 4; D-039). The pips are the non-colour cue, and they fit
  only from 11 px, so **below 11 px the marks stay ink**: the fit-both view and the low continent band
  stay monochrome, and nothing is ever coloured without pips beside it. Hollow marks (uncertain,
  locked) stay ink. Needs: a UI.md §4 amendment naming the map twin (as for the zone chip, §12.5),
  `style.test.ts` allowing the twin module alone to read `--frl-difficulty-*`, and the forced-colours
  rule (the twin opts out, as `DifficultyLabel` does).
- **G-c. One category hue.** A sea green (`#2f9e78`, hue 159.5°, in the only window left, §6.2) on
  the glyphs of place plates. It passes the hue tests, but it sits 40° from difficulty green, so on a
  small glyph it could read as "standard difficulty", especially for deuteranopes, for whom the two
  collapse further. Not recommended.

**Recommendation: G-b.** It gives the owner the colour he liked where he reads quests (the zone and
close bands), and the colour tells him something a route planner needs: how hard each quest is at
the step. The cost is one amendment and one test change.

### 6.4 Contrast over the art (review MP-R08)

*Revision 3: §25.6 measures the pins, lines and labels over the minimap samples and the committed
painted atlas tiles.*

- Every plate state keeps the dark core and the light edge, so it holds 3:1 against light art and
  dark art alike; "not known" and "may be known" are carried by the glyph, the dashed edge and the
  badge, never by removing the core.
- Thin lines (the network, the outlines, leader lines) carry a 3 px halo.
- No glyph is drawn at reduced opacity: low-level marks are smaller, not faded, and other log
  quests' objective marks use the muted ink at full opacity on their halo. The only faint element is
  the route after the active step (§13.6), which keeps its halo and its dash as the cue.
- A new test in MP.2 samples light and dark regions of the committed D-033 art (the glyph sheet uses
  Tanaris and Duskwood) and checks each glyph state's halo and core against them, in both themes.

## 7. Quests

### 7.1 Which state, from where, at what cost (review MP-R03, MP-R02)

- **Source.** `DerivedState.selected.after`, the stable state object published by the lazy derived
  pipeline with its `revision`, keyed by (revision, active step id). Not `RouteWalker.stateBefore`,
  which returns a fresh copy on every call.
- **Where the work runs.** The classification of every race-and-class quest (§7.2) runs once per
  publish **in the derived pipeline**, off the map sync, and is published as a `QuestStateModel`
  (class, reason, required level and doubt per quest). The map controller, the Available tab
  (§14.4) and the zone cards read it. MEASURED by the rules critic: 2.7 ms warm and 4.1 to 8.0 ms
  first pass, unthrottled (about 11 to 32 ms at 4×), which is why it stays out of the 8 ms map sync.
  The new `tests/bench/map-state.bench.ts` gates it (MP.3).
- **No state.** While the pipeline loads, after a failure, or without an active step, the map falls
  back to today's rule (quests open by race and class), labelled in the layer notes and the hover as
  "Quests open to an Orc Warrior (no route state yet)", and never says "after step N".

### 7.2 Classes and the relevance window (review MP-O01, MP-R01)

For each quest open to the character's race and class that has a giver on the shown surface, from
`acceptTruth` of `createAcceptChecks` (VAL-1 to VAL-22) at the state, and COL-1:

| Class | Rule | Drawn by default | Layer-panel row |
|---|---|---|---|
| in the log | in the state's log | as a turn-in (§7.5) | Turn-ins |
| done | completed or abandoned | no | — |
| available | `acceptTruth` true, not trivial | **yes** | Available quests |
| low level | `acceptTruth` true, trivial by COL-1 | no | Low-level quests |
| uncertain, level | a level doubt only (`VAL004-min-level-uncertain`, `VAL005-max-level-uncertain`: the level is a lower bound) and the required level at most level + 3 | **yes**, with "?" | Available quests |
| uncertain, history | an unverifiable prerequisite or chain doubt (`VAL008`/`009`/`010`-unverifiable, `VAL013` breadcrumb, `VAL021`), the quest level above grey and at most level + 4, and the required level at most level + 3 | **yes**, with "?" | Quests needing a prerequisite |
| uncertain, other | a skill, reputation, spell, window or specialisation doubt | **yes**, with "?" | Available quests |
| locked by a prerequisite | only prerequisite errors (`VAL008` to `VAL014`, `VAL021`), the quest level above grey and at most level + 4, and not a follow-up of a quest in the log (a direct pre-quest in the log, or a log quest of the same name) | **yes**, hollow | Quests needing a prerequisite |
| unlocks soon | only `VAL004-min-level` errors, or a level doubt, with the required level at most level + 3 | no | Unlocks soon |
| out of the window | everything else: level-locked further ahead, prerequisite-locked outside the window, locked by both, event-only (`VAL022`) | no; counted in the notes by reason | — |

- The windows (+3 for level, +4 and above grey for prerequisites) are WoWF-QRP's idea, re-implemented
  from its behaviour (§3.1), and they are ASSUMPTIONs to tune with the owner.
- A lower-bound character level never makes a quest locked for level: the mark is uncertain ("level
  after step 14 is at least 9").
- A giver with several quests is one mark; the best class wins (available, uncertain, locked) and
  the hover lists each quest with its class and reason. A giver that also takes a turn-in draws both
  glyphs, offset by 60% of the size.

### 7.3 Where and how many (MEASURED, `rev2/census.json`)

Method: `rev2/census.ts` walks the realistic bench route (Orc Warrior; 600 steps and 10,000 steps;
prior history `fresh` and `unknown`) and classifies every race-and-class quest with starters at
twelve states. It counts distinct giver points (at most three spawns per quest, merged by entity and
yard), and the points in a 918 × 720 px view centred on the character at five scales. Node 22.13.1,
committed dataset.

| State | Level | Revision 1 default | Revision 2 default, both continents | In view: continent (−4.5) | zone edge (−3.25) | zone (−2) | close (0) |
|---|---:|---:|---:|---:|---:|---:|---:|
| 600-step, before step 0 | 1 | 912 | 131 | (no position) | | | |
| 600-step, before step 100 | ≥ 7 | 900 | 210 | 128 | 56 | 34 | 10 |
| 600-step, before step 300 | ≥ 8 | 854 | 158 | 23 | 12 | 1 | 0 |
| 600-step, before step 600 | ≥ 15 | 823 | 177 | 38 | 34 | 29 | 1 |
| 10,000-step, before step 2,000 | ≥ 17 | 808 | 174 | 122 | 79 | 41 | 11 |
| 10,000-step, before step 5,000 | ≥ 34 | 719 | 194 | 36 | 17 | 12 | 12 |
| 10,000-step, before step 8,000 | ≥ 47 | 645 | 322 | 121 | 51 | 9 | 8 |
| 10,000-step, before step 10,000 | ≥ 53 | 590 | 373 | 94 | 36 | 8 | 5 |

With an unknown prior history the prerequisite-locked quests become "uncertain, history" (48 to 87
in the window) and the totals barely change (131 to 210 in the 600-step route). The twelve states
have 101 to 291 available quests each. Revision 1's rule drew 590 to 912 points, mostly hollow triangles;
revision 2 draws a third or less, close to WoWF-QRP's clean view, and never needs to aggregate within
its budgets (§5.2).

- **Every band draws marks** (review MP-O02), at the sizes of §6.1, so the continent band shows
  where to go next, as WoWF-QRP's "All" and MapGenie's z10 to z12 do. Aggregates appear only for a
  layer over its cap, for the surplus only, labelled "n more quest givers here: zoom in".
- **Counts** become a supplement in the hover of a zone label and in the status line (review
  MP-R02): "Durotar: 12 quests available, 3 may be available (uncertain) and 2 to turn in after step
  14 (dataset quests, the walk's state)". An uncertain count is never folded into the available one.
- The mock draws this rule at all four bands (`rev2/shots/band1-world-mosaic.png` to
  `band4-close.png`), and the comparison sheets set it beside the benchmarks
  (`compare-world.png`, `compare-continent.png`, `compare-zone.png`, `compare-close.png`).

### 7.4 Objectives (review MP-R21, MP-O10)

Revision 1 widened objectives from the focused quests to the whole log while cutting the budget, on
the basis of one 70-point sample. MEASURED (`rev2/log-objectives.json`, `objectiveModel` over the
committed dataset): logs of the first 10 or 20 quests of a zone's levelling band, open to the
character, sorted by level.

| Log | Raw objective points (all maps) | Heaviest quest | In view at the zone band (−2): raw | Revision 2: focused (heaviest) raw | other quests' counted marks | outlines |
|---|---:|---:|---:|---:|---:|---:|
| Durotar, 10 quests (7-9) | 457 | 225 | 410 | 179 | 18 | 9 |
| The Barrens, 10 (12-14) | 1,107 | 327 | 1,032 | 318 | 31 | 10 |
| The Barrens, 20 (12-16) | 2,192 | 669 | 1,932 | 508 | 51 | 20 |
| Elwynn Forest, 10 (6-10) | 1,407 | 946 | 614 | 153 | 25 | 10 |
| Westfall, 10 (12-16) | 2,258 | 1,051 | 1,601 | 543 | 39 | 10 |
| Stranglethorn Vale, 20 (31-37) | 1,008 | 172 | 978 | 172 | 45 | 20 |
| Tanaris, 20 (43-50) | 867 | 125 | 736 | 44 | 40 | 16 |

The rule:

- **Focused quests** (the active step's quests and those opened in Details): their objective points
  raw at the zone and close bands, strong, as today. Over the budget the nearest the centre survive,
  and the layer note counts the rest; the outline still shows the whole area.
- **Other log quests**: one counted mark per (quest, target, zone), at the centroid of that target's
  points in the zone, in the muted ink at full opacity; the hover gives the count and the target
  ("Plainstrider · 147 spawns in The Barrens · kill for Plainstrider Menace"). MEASURED: 18 to 51
  marks in view at the zone band, 28 to 103 over all zones.
- **Outlines** (review MP-O10): for every log quest, the objective points in each zone are grouped on a
  90 yd grid (8-connected cells), and each group of 5 points or more gets a faint convex outline,
  1 px in the ink at 65% over a halo. The largest group of each quest is labelled with the number of
  the step that completes it (its `complete` step; or its turn-in, marked "t 22", when D-040 carries
  the work there). A quest the route does not complete gets no number, and its hover says so. Numbers
  come from the label provider at paint time. MEASURED: 8 to 20 outlines in view. The geometry is a
  pure function in `src/geo` (grid groups and hulls), computed when the log changes.
- Items that drop from many NPCs spread their points across a continent (the Elwynn and Westfall
  logs have 335 and 167 points on other maps). Points outside the shown zone are counted, not
  outlined.
- **Telling quests apart** is by outline, number and hover, not by colour: WoWF-QRP's ten-colour
  palette is not emulated, because several of its hues sit near the difficulty colours and the cyan
  (`friend.md`) and colour would be the only cue.
- **Budget**: `objectives` stays at 500 at the zone and close bands until MP.3's new bench fixture
  (10 to 20 concurrent quests from one zone, as above) measures the in-view counts and the build
  cost. The realistic bench route cannot: its log holds 0 or 1 quests (rules critic, `log-size.ts`).
- The mock's zone band (`band3-zone-mono.png`) draws a 10-quest Barrens log this way: 326 raw points
  of the focused quest, 33 counted marks and 35 outlines. It is dense, as a real ten-quest log is;
  MP.4 tunes outline weight and dot size with the owner.

### 7.5 Turn-ins

In the log at the step: ready (solid square) when the walk marks every objective done; in progress
(hollow) otherwise. A log entry with no objective record (a quest the dataset does not know, or one
assumed through an unknown history) is **never** shown as ready; it is in progress with the "?"
badge (review MP-R13).

## 8. Dungeons and raids

### 8.1 Which instances (review MP-R12, MP-R22)

Membership comes from sourced records only, each with its basis:

- **Era instances in Forever**: the `LFGDungeons` rows at 1.60.1.70009, which the committed
  dungeon table (D-039 E, §16) carries with their row ids. Revision 1 called them individual cited
  values needing no decision while putting their tuning numbers to the owner; D-039 E now commits the
  rows, so membership and tuning come from one committed, reproducible file. This removes the dataset
  entries that are not Forever content (Utgarde Keep, Black Morass, Old Hillsbrad, the Season of
  Discovery maps, Blackrock Caverns, Firelands, Dragon Soul, Darkmoon Faire Island, the Deeprun Tram).
  Onyxia's Lair is matched to LFG row 45 by id, not by name (review MP-R11).
- **AQ20, AQ40 and Naxxramas**: instance maps with no LFG row; hidden by default (D-039 F), listed in
  the layer notes, and shown by the row "Show unconfirmed raids".
- **The new Forever instances** (forever-game-rules §5.3 and timeline; `data.md` §4):

| Instance | Kind | Source | Map / area (client) | Entrance | Level shown | Drawn |
|---|---|---|---|---|---|---|
| Hall of Thanes | dungeon | official (S2) | Map 3065, area 16919 | UNKNOWN | LFG tuning 13 | no; named in the notes |
| Ruins of Lordaeron | dungeon | official (S2) | Map 2999, area 16611 | UNKNOWN | "?" (the row disagrees with itself, §8.4) | no; named |
| Whelgar excavation site (client: Excavation Site: Wetlands) | dungeon | official (S2) | Map 2998, area 16876 | UNKNOWN | LFG tuning 26 (row 3274, §8.4) | no; named |
| City of Dalaran | dungeon | official (S2) | Map 2959, area 16544 | UNKNOWN | LFG tuning 28 | no; named |
| Blackmaw Hold | dungeon | official (S2) | area 1216 (Azshara), no Map row | UNKNOWN | UNKNOWN | no; named |
| Krol'dok Stronghold | dungeon | official (S2) | area 17780 (Riverglades), no Map row | UNKNOWN | UNKNOWN (secondary claims conflict) | no; named |
| Shaper's Terrace | dungeon | official (S2) | area 16985 (Un'Goro Crater), no Map row | UNKNOWN | UNKNOWN | no; named |
| Drowned City | dungeon | official (S2) | none found | UNKNOWN | UNKNOWN | no; named |
| Alcaz Prison | dungeon | official (S2) | none found | UNKNOWN | UNKNOWN | no; named |
| Barrow Deeps | raid (10) | official (S2), unlocks 9 December | area 16916 Stormrage Barrow Dens (Moonglade) | UNKNOWN | UNKNOWN | no; named |
| Hyjal Summit | raid (20) | official (S2), unlocks 9 December | Mount Hyjal (UiMap 2482) | UNKNOWN | UNKNOWN | no; named |
| Half-Pint Tavern | instance, purpose UNKNOWN | client only | Map 3002 | UNKNOWN | — | no; counted as unknown |
| Manor Mistmantle | instance, purpose UNKNOWN | client only | Map 3109 | UNKNOWN | — | no; counted as unknown |

The layer's note names every one without an entrance ("11 announced Forever instances have no known
entrance: Hall of Thanes, …"), and counts the two client-only maps ("2 instance maps of unknown
purpose not shown"). An entrance is added only from a sourced position (a dataset update or a cited
owner observation, as D-031 does for connectors).

### 8.2 Where

Every entrance with a position; `frameVerified: false` entrances with the dashed ring and "position
not verified". The four Blackrock instances share two entrances (Searing Gorge and Burning Steppes):
one plate per entrance with the pill "×4", and the hover lists them. Plates from 0.03 px per yard;
names from 0.05 (review MP-O06), placed by the label layer below zone labels in priority (§13.2).

### 8.3 Raids

A disc with an outer ring and the `raid` badge's words in the hover. Raid status is the client's
`Map.InstanceType` 2 from the committed table, not the player count.

### 8.4 Level (review MP-O07, MP-R30, MP-R29)

Two numbers, each with its basis, in the hover and the popover (never on the canvas as a range):

- **LFG tuning level** (D-039 E): "LFG tuning level 17 (client LFGDungeons row 1 → ContentTuning
  5254, build 1.60.1.70009; meaning unverified)". The committed file records the row id and the
  column of every number (review MP-R30):
  - Ruins of Lordaeron's row 3272 gives tuning level 15, while its own `LfgMin` and `LfgMax` columns
    say 27. The row disagrees with itself, so the level shows "?" with the reason ("the client's row
    gives both 15 and 27"), as unknown stays unknown under D-039 E.
  - Excavation Site: Wetlands has two rows: 67 at level 0 and 3274 at 26. A tuning level of 0 means
    "none set"; the level is 26 from row 3274, and the hover names both rows.
- **Dungeon-quest span** (new; review MP-O07): the p10 to p90 of the levels of the dataset's dungeon
  quests for that instance (`dungeonQuest` with a `zoneOrSort` of the instance's areas), **over the
  quests open to the character** (review MP-R29), with the count and the Era marker: "quests 16-22 (9
  open to an Orc Warrior) E". Shown when there are at least 5 such quests; rated by the difficulty twin
  on the median when there are at least 10 and the spread is at most 15 levels (both ASSUMPTIONs,
  labelled as such in the key). MEASURED for an Orc Warrior (`rev2/dungeon-spans.json`):

| Dungeon | LFG tuning (D-039 E) | Dungeon-quest span, Orc Warrior | All dataset quests (revision 1's method) |
|---|---:|---|---|
| Ragefire Chasm | 13 | 16 (6), no rating | 16 (6) |
| Wailing Caverns | 17 | 16-22 (9), no rating | 16-22 (9) |
| Blackfathom Deeps | 22 | 22-27 (8), no rating | 22-27 (12) |
| Gnomeregan | 25 | 30-35 (15), rated | 27-35 (27) |
| Razorfen Downs | 34 | 36-42 (6), no rating | 36-42 (7) |
| Uldaman | 35 | 40-47 (13), rated | 40-45 (29) |
| Zul'Farrak | 42 | 45-47 (9), no rating | 45-47 (10) |
| Maraudon | 42 | 47-51 (8), no rating | 42-51 (11) |
| Blackrock Depths | 48 | 52-59 (27), rated | 52-59 (41) |
| The Deadmines, The Stockade | 16, 23 | none open to a Horde character | 17-22 (5), 26-29 (6) |
| Shadowfang Keep, Razorfen Kraul | 18, 24 | 3 and 4 quests: too few | 25-27 (3), 30-34 (6) |

MapGenie's "Level 15-25" for Wailing Caverns has no stated source; ours says where each number comes
from.

### 8.5 Quests inside

A chip beside the plate at the zone band: "log 2 · available 1 · uncertain 1" (review MP-R33):
log quests with objectives inside, and quests at the step whose objectives are inside, the uncertain
ones counted apart. Click opens the popover listing them (WoWF-QRP's checklist idea), each with
`DifficultyLabel`, and "Complete objectives after step N" and "Turn in after step N" where they apply.

## 9. Flight paths (D-039 B)

- **Nodes**: the committed taxi file's nodes on paid paths (65 on maps 0 and 1, MEASURED in the
  mock's extract), matched to the dataset's 63 flight masters (all within 11.9 yd, `data.md` §3), plus
  the cited Forever nodes. Only nodes the character's side may use (its own and both-sides nodes);
  the other side's are hidden and counted. The side is from `TaxiNodes.Flags` (INFERRED decode, said in
  the hover).
- **Known to the route or not** (review MP-R13): known after the active step is
  `knownFlightPaths` (the profile's declared nodes plus the route's discover steps). With
  `priorHistory: 'unknown'`, a node not declared and not discovered is "may be known" (the "?"
  badge), because the character may have learned it before the route. Neither benchmark shows this.
- **Names**: the client node name ("Crossroads, The Barrens") from 0.05 px per yard, placed below
  dungeon names in priority.
- **Network**: one `network-flight` line per node pair the side may fly (at most 143 pairs on the
  atlas for one side), along the committed shape simplified to 25 yd. From 0.03 px per yard.
- **Times** in the hover of an edge: "Crossroads → Orgrimmar: ≈ m:ss (path L yd at the effective taxi
  speed, era-assumed) + the flight master's seconds (assumption)". The speed, the speed bonus and the
  flight-master seconds come from the effective rules (`taxiSpeed`, `taxiSpeedBonusPct`,
  `flightMasterSeconds`, which the user can override), not from constants in this document (review
  MP-R10). Route flight legs use TIME-6 from the committed lengths.
- **Fallback, only if the taxi file fails to load or its hash does not match** (review MP-R24): no
  network lines, the layer checkbox disabled with the reason, and flight legs on TIME-5 ("≈ m:ss,
  straight line × 1.4 at the taxi speed, assumed"), as D-024's model.

## 10. Transports and portals

- **Stops** from the committed taxi file's transport paths (`Delay` stops; 27 stops on maps 0 and 1
  in the mock's extract). Which named service a path is (the boat to Theramore, the Undercity
  zeppelin) is **INFERRED** by matching its stops to the TravelGraph's seven cited transports and
  their zones, reviewed by hand in MP.9.
- **Inferred docks reach the engine only with their basis** (review MP-R32): each dock carries
  `basis: 'inferred'` and the id of its matching record, in the TravelGraph and in the leg texts
  ("Boat to Theramore: dock position inferred from client transport path 1234"). A stop with no match
  is drawn as "Transport stop (service unknown)" and never feeds the engine. This closes the NAV-08
  dock gap only for the matched services.
- **Routes**: same-map rides as `network-transport` lines; cross-map rides as the atlas `connector`,
  and on world surfaces a transition glyph at the stop ("to Tirisfal Glades (Eastern Kingdoms)").
- **Zephras Isle** (map 2991: no taxi nodes, two transport paths): its position on the world map is
  UNKNOWN; on the atlas it is an inset placement, and a connector to it ends at the inset's frame,
  labelled "Zephras Isle: separate world map; position on the world map unknown".
- **Portals**: the D-031 / D-034 `teleport` connectors, drawn only once the owner's observation is
  recorded, with its date in the hover.
- **Times**: wait and ride seconds stay `assumption` (TIME-7) and say so.

## 11. Services (new; review MP-O08)

WoWF-QRP added "Vendors, trainers & graveyards (zoomed in)", most of MapGenie's categories are
services, and routes have hearth, train and vendor steps. The dataset carries 47 innkeepers (45 with a
spawn), 499 trainers (32 of them Warrior trainers) and 157 vendors (154 with a spawn) (MEASURED,
`owner-review/counts.txt`, `prep.ts`).

- **What is drawn**: innkeepers and the character's class trainers from zoom −2.75 (0.149 px per
  yard), vendors from the close band; the character's side and neutral NPCs only. Light square plates
  (§6.1).
- **Coverage is said, not implied**: the dataset holds quest-related NPCs plus flight masters,
  innkeepers and trainers (DATA_PROVENANCE), so its vendors are only those tied to quests. The
  layer's note says so: "Vendors: only the 154 the dataset carries (those tied to quests); many
  vendors are missing". Profession trainers are a later row.
- **Actions** in the popover: "Set hearth here after step N" (a hearth-bind step), "Train here after
  step N" (a `train` step), "Buy here after step N" (a vendor note step), each through the editor's
  insert-after-selection commands.
- **Graveyards**: the dataset has no graveyard table, and which graveyard serves a zone is decided by
  the server. Drawing them needs a sourced table: owner question I (§23.2).

## 12. Zone colouring

### 12.1 Two kinds of colour, two rules

1. **Picture colour**: the painted art (D-033), the relief (D-032), whatever the atlas derives from
   them, and this design's fallback tint (§12.4). It carries no meaning and is not a UI signal (as
   MAPS §7.5 already says of the relief palette). It must not use a reserved colour (§12.4 test).
2. **Semantic colouring**: exactly one, **difficulty**, inside the canvas twin of `DifficultyLabel`
   on zone cards (§12.5), and on quest marks if the owner chooses G-b (§6.3).

WoWF-QRP's colouring is **biome-based**: a fixed, hand-picked colour per zone, independent of level
and character (§3.1). Under our rules that is "anything else", so an emulation may not reuse the
difficulty or provenance colours, and its palette is D-029-excluded data. There is no conflict to
resolve for difficulty: WoWF-QRP does not colour zones by difficulty, and neither do we (a
translucent difficulty wash over art cannot keep 3:1 against the art and would make colour the only
cue across an area). No faction hues either: the game's zone-status colours collide with the
difficulty colours (`data.md` §2), so faction is hatching and words (§12.6).

### 12.2 What "colours the zoomed map" means (owner question H)

This design reads the owner's phrase as: **every zone shows its own colour at every zoom, from both
continents at once down to a camp, and the colour stays the zone's as you zoom** (WoWF-QRP never
changes a zone's tint with zoom; ours today loses colour where the art runs out and shows one
continent in one painting). It is picture colour, not a signal. The owner is asked to confirm this
reading, and to choose between the painted art as the colour (recommended) and a WoWF-QRP-like flat
colour style as an option (§23.2 H). The mock shows both (`rev2/shots/zone-colour-base.png`).

### 12.3 Who owns it: acceptance criteria agreed with the atlas (review MP-O04)

The base map is the atlas team's, but the owner named colouring explicitly, so this design owns the
criteria and a fallback. MP.0c agrees them with `map-atlas.md`; MP.12 checks them against the
benchmark shots (WoWF-QRP `01`, `03`; MapGenie `03`):

1. **Colour identity at every band.** At the fit-both view and at each band, every levelling zone in
   view is drawn in its own colour: no zone falls back to grey relief only, and the world band is not
   one painting that colours both continents alike. MEASURED: the Azeroth painting (947, the atlas's
   fidelity-first prototype at −5.5) gives neighbouring zones a median colour difference of 7.0
   (CIEDE2000; 64 of 94 neighbour pairs under 10), against 8.7 for the zone art mosaic
   (`rev2/results/tint.json`; the method is in §12.4).
2. **The same colour at every zoom.** A zone's mean colour at the close band is within 10 (CIEDE2000)
   of its mean colour at the continent band.
3. **Visible boundaries.** Neighbouring zones are separated by a painted border or an outline at 3:1.

Criterion 1 does not require neighbouring zones to differ strongly in mean colour: the painted art
does not (Tirisfal Glades and Silverpine Forest differ by 1.9; Alterac Mountains and Hillsbrad
Foothills by 1.4), and its zones are told apart by painted borders and texture. Forcing that on the
art would mean tinting over the art the owner chose (D-033). The strict neighbour rule applies to our
fallback tint alone.

If the atlas fails criterion 1 or 2 at a band, the `zone-fill` layer draws the fallback tint there
(for example under the 947 painting at the world band, or where no art exists).

### 12.4 The fallback zone tint (MEASURED in the mock)

- **Colour**: each zone's mean painted colour, sampled from its committed D-033 zone image inside its
  terrain polygon (pixels with alpha above 200; the continent image where a zone has no image of its
  own).
- **Bounded as picture**: HSL saturation capped at 0.29 (so a rounded colour stays at or below
  0.30; every chromatic reserved colour has 0.498 or more: review MP-R11), lightness kept between 0.38
  and 0.72. A test fails if any generated tint exceeds 0.30 saturation or comes within 15 (CIEDE2000)
  of a chromatic reserved colour.
- **Neighbours pushed apart**: where two zones sharing at least 300 yd of border differ by less than
  10, the less constrained one moves (lightness by 0.05, hue by 6° within 12° of its art hue, or
  saturation down by 0.06), keeping the move that most raises its smallest difference, for up to 40
  rounds.
- **Drawn** cut to land (the relief's non-water pixels, or the coastline) and shaded by the relief
  (multiply at 55%), never on a marker.
- **MEASURED** (`rev2/results/tint.json`, 94 neighbour pairs): before the push, median 5.2 and 82
  pairs under 10; after it, **median 15.2, minimum 9.1, 2 pairs under 10** (Silverpine Forest /
  Hillsbrad Foothills 9.1, Ashenvale / Felwood 9.6); highest saturation 0.295; nearest chromatic
  reserved colour 18.3 (Winterspring against difficulty orange). The values are ASSUMPTIONs to tune in
  MP.10; the shot is `band1-world-tint.png`.
- The tints are generated at build time by the art tool from committed art (no new client data, no
  new decision) and checked by the test above.

### 12.5 The level chip and the zone span (review MP-R06, MP-R29)

- **Span**: per zone or city UiMap, the p10 to p90 of `quest.level` over its non-dungeon quests
  **open to the character's race and class** (review MP-R29), with the count, computed at run time
  from the committed `quests.json` (basis `derived`, Era baseline). The hover says whose quests they
  are: "The Barrens: quests 13-25 (93 open to an Orc Warrior; 98 in the dataset)". MEASURED
  (`rev2/spans.json`): Duskwood is 24-35 over all 76 quests but 42 over the 4 open to an Orc Warrior;
  Hillsbrad Foothills 24-40 (53) against 22-40 (39); Westfall 10-44 (35) against 16-19 (7).
- **On the canvas the span always shows its basis** (review MP-R06): "quests 13-25 (93)" followed by
  the boxed E, in the regular weight; official text is worded as such ("mid-30s to mid-40s
  (official)", "endgame (reported)"), and Shen'dralas shows "level range unknown ?". Fewer than 5
  quests: no span ("4 quests: too few for a span"). None open to the character: "no quests for an Orc
  Warrior". Darkspear Islands: "Battleground (client: Map 2997 InstanceType 3)".
- **Rating**: the twin rates the **median quest level** (named so in the key and the hover) against
  the character's level at the step, with the dashed edge for a lower-bound level. Only where at least
  10 quests are open to the character and the spread is at most 15 levels; both thresholds are
  ASSUMPTIONs and are labelled as such in the key.
- The twin receives its computed result (difficulty key, level text, lower-bound flag) from
  `src/app/zone-levels.ts`; `map/leaflet` only draws it (review MP-R10).

### 12.6 Faction overlay (D-039 C)

- An optional mode "Zone faction" in the layer panel, off by default: each zone's land filled with
  `--frl-map-hatch` in a pattern, and the words in the zone's hover and card. From
  `AreaTable.FactionGroupMask` and `Flags` bit 0x800 (both INFERRED decodes, said in the hover):
  - 2: "Alliance territory", diagonal hatching (/);
  - 4: "Horde territory", the other diagonal (\);
  - 6: "Alliance and Horde (client value 6)", cross-hatching (only City of Dalaran, an instance area);
  - 0: "No faction territory in the client (contested or unset)", no pattern (review MP-R31: 37 zones,
    among them every battleground and the five new zones; never called "contested" from the mask
    alone);
  - sanctuary bit: "Sanctuary (client flag)", dots.

## 13. Labels

### 13.1 Text

The kit's UI font (`--frl-font-ui`), no web font. Compact labels 11 px (10 px when 11 px does not
fit), card names 12 px, zone labels 13 px, place names 10 px, continent names 18 px with letter
spacing. `--frl-fg` with a 3 px `--frl-map-label-halo`, so text reaches 4.5:1 on any art.

### 13.2 Placement

- **Anchors** in world coordinates: a zone label at the pole of inaccessibility of the zone's land
  ring (`src/geo/pole.ts`; the frame centre where there is no terrain); place labels to the right of
  their plate; continent names at the continent frame's centre; inset names at the inset's lower edge.
- **Collision**: greedy by a **static priority** (review MP-R26): levelling zones by frame area, then
  cities, then dungeon names, then flight-point names. The priority does not depend on the selection
  or the route, and card widths are fixed per zone, so an edit or a selection change never moves a
  label. Each label tries eleven positions around its anchor, then sixteen positions up to 3.5 lines
  away with a thin haloed leader line to a dot at the anchor. Obstacles: placed labels, place plates,
  focused marks and the active and selected step beads (review MP-R14).
- **When**: at `moveend` only, on the labels canvas. MEASURED: placing 49 compact labels takes less
  than the timer's 0.1 ms resolution in the mock (Chrome 153, 1×).
- **Skipped labels** are counted in the labels layer's note and in the adapter's stats ("2 zone
  labels hidden for lack of room: Deadwind Pass, Redridge Mountains") (review MP-R09); the zone is
  still reachable through the top bar's zone list.

### 13.3 Compact labels below 0.05 px per yard (review MP-O03)

One line: the name in medium weight, then the span in regular weight and the boxed E ("The Barrens
13-25 E"); official text zones show the name only (their text is on the card and in the hover).
MEASURED in the mock with Chrome's text metrics (`rev2/results/labels.json`), over the whole atlas:

| px per yard | Placed, name and span | of which with a leader | Skipped |
|---|---:|---:|---|
| 0.022 | 48 of 49 | 4 | Redridge Mountains |
| **0.0239 (fit-both, 918 px panel)** | **49 of 49** | 3 | none |
| 0.028 (WoWF-QRP "All") | 49 of 49 | 1 | none |
| 0.035 | 49 of 49 | 0 | none |
| 0.045 | 49 of 49 | 0 | none |

Revision 1's 110 × 34 px cards placed 28 of 49 at 0.028 (`owner-review/cards.txt`). **Acceptance
test (MP.7):** every levelling zone is named at the fit-both view of a 900 px panel; at 0.022 the
greedy placement may still drop one label, so the test covers the fit-both scale and MP.7 tunes the
candidate order until 0.022 passes too. The world-band mock is `band1-world-mosaic.png`.

### 13.4 Cards from 0.05 px per yard to the zone band

Two lines: the name; then the difficulty twin (a dark well with the median level and five pips),
"quests 13-25 (93)" and the boxed E. Fixed width per zone. A card that does not fit falls back to the
compact label (MEASURED: at 0.05 and 0.0544, 46 of 49 cards fit and the other three, Deadwind Pass,
Redridge Mountains and Thunder Bluff, take compact labels, so all 49 zones are named; from 0.07 all 49
cards fit). Counts are not on the card face (the marks are drawn raw); they are in the hover (§7.3).
The mock is `band2-continent.png`.

### 13.5 Zone labels at the zone band, the "Viewing" chip, and the base map (review MP-O13, MP-R27)

- **Zone labels** (name and span, 13 px) from 0.088 px per yard to about 0.3 (zoom −1.75), where the
  painted art's own town names take over. WoWF-QRP keeps its zone names to about 0.26.
- **The "Viewing" chip**: from the zone band, a DOM element in the map frame's top left names the zone
  at the view centre: "Viewing The Barrens · quests 13-25 (93 open to an Orc Warrior) E" with the real
  `DifficultyLabel` beside it. Being DOM, it is in the accessibility tree, keyboard-reachable, and
  shows the difficulty colours through the component itself. It replaces nothing: the top bar's zone
  select still shows the jumped-to zone.
- **The base map speaks first, where it can be read**: the base map reports which classes of names
  its picture carries (`BaseMapLabels`: `continents`, `zones`, `places`), **only where its art is drawn
  at full opacity and at or above 0.75 of the art's native scale** (ASSUMPTION; agreed in MP.0c).
  Where the art is scaled down, cross-faded or absent, our labels draw the same names. Zone labels and
  cards are always ours: the continent paintings do not name zones.

### 13.6 Step numbers and the route after the active step (review MP-R04, MP-O12)

- **Numbers**: at the zone and close bands each step bead in view shows its number (11 px, offset up
  and right), from the label provider at paint time; a number within 16 px of one already drawn is
  skipped (the active step's first, then selected steps, then route order); at most 150 in view
  (ASSUMPTION). They live on the labels canvas, so a renumbering after an edit redraws that canvas
  only, **after** the edit has been applied and measured: in idle time, at the latest on the next
  frame. The `map-edit` and `map-paths` benches measure the edit without the numbers and the
  renumbering on its own, each against its budget (MP.1).
- **Stack counts** become "×n" pills, a different shape, so "2" is never read as step 2.
- **The route after the active step** (WoWF-QRP's idea): the route line from the active step on is
  drawn in the accent at 55% with a 5-6 dash and its halo; beads after it at 60%. The key names it
  ("Route after the selected step: dashed"), and the dash, not the fade, is the cue. It is a style of
  existing route pieces: the pieces split at the active step, and `map-edit` measures the selection
  change that moves the split.

## 14. Hover, click and keyboard

### 14.1 Hover

One shared plain-text tooltip and the status line's "Pointer on:" (MAPS §7.5, UI.md §9 rule 12), with
the texts of §6.1 and §7 to §12. Difficulty is said in words ("standard").

### 14.2 Click: the map popover (review MP-O11, MP-R17)

A DOM component of the kit (`src/ui/shell/MapPopover.tsx`) anchored beside the point, replacing the
choice list (MAP-UX-3).

- **Contents and actions**:
  - quest givers and turn-ins: each quest with `DifficultyLabel`, XP with its basis markers, a
    `ProvenanceBadge` where the dataset gives one, its class and reason; "Accept after step N",
    "Turn in after step N", "Show in Details";
  - objectives (counted marks and raw points alike): "Complete objectives after step N";
  - any point: "Go here after step N" (a travel step to the point);
  - away from a flight point: "Fly from the nearest known flight point" (a `flight take` step from
    the nearest node known to the route to the node nearest the point), with the node names shown;
  - flight points: known or not, "Add flight from here after step N";
  - dungeons: §8.5; transport stops: destinations and "Add transport after step N"; services: §11;
  - stacks: the list of items, each as above.
  Actions are the editor's insert-after-selection commands, announced as today.
- **Keyboard contract**, written into UI.md §9 before MP.6 (review MP-R17): the popover is a
  non-modal `dialog` (`aria-modal="false"`), named after its subject ("Quests at Gornek"); opening it
  moves focus to its first action; the actions form one list (Up and Down arrows move, Home and End
  jump, Enter or Space activates); Tab and Shift+Tab leave the popover and close it; Escape or a press
  outside closes it and returns focus to the map; it announces nothing on opening (its name is read
  with the focus) and each action announces its result as the insert commands do.
- **A Wowhead link** ("Open on Wowhead"): no project rule forbids an external link; revision 1's "no
  external links" had no basis. It is owner question J (§23.2).

### 14.3 Filters, legend and search (review MP-O17, MP-R16)

*Superseded by revision 3's category drawer (§25.3).*
- It keeps this section's rows, glyphs, notes and key.
- Visibility is kept per browser.
- The search on the map replaces the Available tab's rule of at most 20 matches.

- The layer panel keeps its counts and notes (MAP-HONEST-5) and gains the new layers and rows:
  "Quests needing a prerequisite", "Unlocks soon", "Low-level quests", "Services", "Show unconfirmed
  raids", "Zone faction", and "Show all" and "Hide all" (MapGenie). **Every row shows its glyph**
  (UI.md §12 already asks this of the existing rows; the new rows follow it), and hidden rows are
  struck through as well as unticked. The key names every glyph, state, badge and line of §6.1.
- **Search**: the Available tab's filter, debounced by 250 ms, focuses its results on the map only
  when there are at most 20 (ASSUMPTION); above that the map notes "37 matches: narrow the search to
  show them on the map" and draws nothing extra, so a broad query neither floods the caps nor rebuilds
  the layers on every key.

### 14.4 Keyboard paths (review MP-R05)

Revision 1 relied on paths that do not exist: `AvailableQuests.tsx` works from the start level, with
no step state, no locked reasons and no zone groups. Step MP.3 now builds them before any map layer
depends on them:

- **A state-aware Available tab**: the classes of §7.2 after the active step, each quest with its
  reason ("needs Cutting Teeth", "unlocks at level 16", "may be available: the level is a lower
  bound"), grouped by zone, each zone heading with its span, count and `DifficultyLabel` rating.
- **The top bar's zone list** gains each zone's span text.
- Dungeons' quests: the Available tab's zone grouping includes a dungeon's quests under it; flight
  points: the flight step editor's node picker, with "known to the route" in each option; services:
  the step editors for hearth, train and vendor steps. Nothing is reachable only on the map.

## 15. Accessibility

- **Non-colour cues**: every state differs by silhouette, fill, edge, dash, badge or number, and has
  words in the key and the hover. Where hue appears (the difficulty twin, option G-b), pips and a
  number sit beside it.
- **Accessible names**: canvas items are not in the accessibility tree (MAPS §7.5); the engine's
  surface keeps its name and instructions; the popover and the "Viewing" chip are DOM.
- **Contrast**: plate glyphs 15.5:1 on the plate; plate edges 3:1 or more; marks keep their 3:1 halo;
  label text 4.5:1 on its halo; the art-sampling test of §6.4; pairs added to
  `tests/ui-tokens.test.ts`.
- **Forced colours**: `readMapPalette` reads `CanvasText`, `Canvas` and `Highlight` for ink, halo and
  accent; the plate becomes `Canvas` with a `CanvasText` edge and glyph; the fallback tint and the
  hatching are not drawn; the difficulty twin keeps its well and colours, as `DifficultyLabel` opts out
  (UI.md §9 rule 9).
- **Reduced motion**: the band cross-fade has zero duration; nothing else animates.

## 16. Data sources and the basis of every number

| Shown | Source | Basis, as displayed |
|---|---|---|
| Quest level, giver, finisher, objectives | `public/data` (QuestieDB `b6f5b07`) | dataset; Forever status unknown |
| Quest class at the step | the derived pipeline's `QuestStateModel` (`createAcceptChecks`, COL-1) | "after step N"; lower-bound levels say "at least"; no state: "open to an Orc Warrior (no route state yet)" |
| XP in the popover | simulation | its basis markers (`≈`, `E`, `≥`, `?`) |
| Counts in hovers | the same model | "after step N (dataset quests)"; uncertain counted apart |
| Zone and dungeon spans | derived at run time from `quests.json`, quests open to the character | "quests a-b (n open to an Orc Warrior)" and E |
| Zone range text | ruleset, cited (forever-game-rules §5.1) | "official" or "reported" |
| Difficulty chip | COL-1 on the median quest level | the chip's text and pips; "median quest level" in the key |
| Dungeon membership and tuning (D-039 E) | committed client table: `LFGDungeons` and `ContentTuning` rows at 1.60.1.70009, each number with its row and column | "LFG tuning level (client), meaning unverified"; "?" where a row disagrees with itself |
| New Forever instances | the official announcement (S2), the client's Map rows where they exist | "announced; entrance unknown" |
| Dungeon entrance | `zones.json` (QuestieDB) | "position not verified" where so |
| Flight node, side, network, path length (D-039 B) | committed taxi file | "side from TaxiNodes flags (inferred)"; "client path length" |
| Flight time | TIME-6 from the committed length and the effective rules; TIME-5 only as the load-failure fallback | "≈", era-assumed speed, assumption |
| Transport stops, docks | committed taxi file's transport paths | "which service: inferred" with the matching record |
| Transport wait and ride | TravelGraph seeds | "assumed" |
| Faction territory (D-039 C) | committed `AreaTable.FactionGroupMask`, `Flags` 0x800 | "inferred decode"; 0 worded as "no faction territory in the client (contested or unset)" |
| Services | dataset NPC flags | "only the vendors the dataset carries" |
| Zone tint | generated from committed D-033 art | picture; no basis needed, bounded by a test |
| Step numbers | route order | identities, no basis needed |

**Committed client tables (review MP-R23).** B, C and E come from **one extraction tool**,
`tools/maps/client-tables.ts`, through `tools/casc` (read-only, `.build.info` and `Data/` only). For
every table it records the FileDataID, the CKey, the build, the WoWDBDefs commit and the tool tree
hash; it writes `public/maps/client/{taxi.json, zones.json, dungeons.json}` with a manifest and a
NOTICE naming Blizzard Entertainment; `--check` rebuilds them byte for byte; the dist audit gives the
folder its own gated budget (40 kB gzip; D-039 B's file is about 27 kB, C about 0.5 kB and E about
0.6 kB, `data.md`). Only the columns used are shipped and listed in the manifest (review MP-R19): no
mount creature ids. The 5.0 kB figure for nodes, edges and lengths is an upper bound, measured over
98 nodes rather than the 65 on paid paths.

Nothing is drawn from WoWF-QRP's or MapGenie's data.

## 17. Performance

*Revision 3: §25.7 measures pins, which cost more than these marks, and sets their budgets. Pins
are drawn from cached bitmaps from the start.*

### 17.1 Counts per band (per surface, within §5.2's budgets)

MEASURED where a source is given; the rest are ASSUMPTIONs measured in the step that builds them.

| Layer | World | Continent | Zone | Close | Basis |
|---|---:|---:|---:|---:|---|
| `available-quests` | 131-373 (whole atlas) | 23-128 in view | 1-79 in view | 0-12 in view | `rev2/census.json` |
| `objectives` | focused only | focused only | focused 44-543 raw; others 18-51 marks; 8-20 outlines | fewer | `rev2/log-objectives.json` |
| `labels` | 49 zone labels | 16 in view (mock) | 2-5 zone labels | 0 | mock `results/band*.json` |
| places (`dungeons`, `flight-masters`, `transports`) | 0 | 34 in view (mock) | 6 | 1 | mock |
| `services` | 0 | 0 | 10-12 | 6 | mock |
| `flight-network` | 0 | ≤ 143 | ≤ 143 | ≤ 143 | taxi extract |
| step numbers | 0 | 0 | 23 (mock, 120 steps drawn) | 10 | mock |

### 17.2 Drawing cost (review MP-R25; MEASURED in the mock, labelled as a first measurement)

Revision 1 quoted the 3.3 to 3.5 ms cap measurement, which was of today's simpler glyphs. The mock's
bench (`rev2/results/bench-1x.json`, `bench-4x.json`) draws the revision 2 mix at the cap (900 quest
marks with halos and badges, 500 objectives, 150 plates with edges and glyphs, 150 haloed network
lines of 10 points, 590 beads, 110 two-line cards with a chip and the E, 100 place labels: 2,500
items) on a 1280 × 800 canvas at DPR 1.5, in headless Chrome 153, with CDP CPU throttling for 4×. It
measures canvas drawing only, not Leaflet's projection (perf.md: up to 6 ms at 4×) or hit-test
bookkeeping.

| Variant | 1× median (p90) | 4× median (p90) |
|---|---:|---:|
| All vector | 2.6-2.9 ms (3.1-4.0) | 12.6-12.8 ms (13.5-18.0) |
| Plates and cards from cached bitmaps | 1.8-1.9 ms (2.0-3.0) | 9.0-9.8 ms (9.7-12.1) |
| Marks, plates and cards from cached bitmaps | 1.4 ms (1.5) | 9.2 ms (15.1, noisy) |

Components at 4×: 900 marks 6.9 ms, 110 vector cards 3.4 ms (0.4 ms as bitmaps), 150 plates 1.1 ms,
500 objectives 0.6 ms, 150 lines 0.5 ms, 100 place labels 0.5 ms. Conclusions:

- At 1× the new mix fits the 16 ms `moveend` budget with room to spare. At 4×, vector drawing plus
  Leaflet's projection (up to 6 ms) is about 18 ms, over the budget; with **plates and cards drawn from
  cached bitmaps** (keyed by kind, state, size bucket, text and theme) it is about 15 ms. So MP.4 draws
  plates and cards from bitmaps from the start, and the MP.1 harness decides on marks.
- The labels canvas (§5.5) takes cards and labels out of the path canvas's redraw, and the cap is
  rarely reached at the continent band (§17.1).
- §17.1 and §17.2 stay ASSUMPTIONs for the real map until the MAPS §7.2 harness, extended in MP.1 to
  this mix at the cap at 1× and 4×, measures them **before MP.4 fixes the sizes**.

### 17.3 New costs and how they are held

| Cost | Held by | Target |
|---|---|---|
| Classifying quests at each selection | the derived pipeline, once per publish, keyed by (revision, step id); the map reads the published model | map sync ≤ 8 ms at 4,257 quests; classification off the sync (`map-state.bench.ts`) |
| Label placement | at `moveend` only; fixed widths; static priority | ≤ 1 ms per `moveend` (under 0.1 ms MEASURED for 49 compact labels) |
| Halo text | bitmaps for cards; labels on their own canvas | inside the 16 ms budget |
| Step numbers | a lookup per bead in view, drawn on the labels canvas after the edit | the edit within 8 ms without them; the renumbering on its own ≤ 4 ms (ASSUMPTION) |
| Objective outlines | grid groups and hulls once per log change | ≤ 5 ms for a 20-quest log (ASSUMPTION) |
| Zone and dungeon spans | once per dataset load and character | ≤ 20 ms once |
| Pole of inaccessibility | once per zone polygon, when the outlines load | ≤ 10 ms per world map |
| Crossing a band edge | idle-time pre-build; no aggregate flip; label cross-fade | see §17.4 |

### 17.4 The crossing budget (review MP-R25)

Crossing −3.5 today takes a 26.6 ms sync at 4× with one 42 ms frame (perf.md). Revision 2 removes the
largest part (the quest-giver aggregates flip and 540 markers are created in one task), but the 4×
crossing cannot be promised at 16 ms before it is measured. So MP.0 records a **new budget in
ARCHITECTURE §14 and DECISIONS**: "a band crossing: no frame over 16 ms at 1×, no long task over 50 ms
at 4×". MP.1 measures it; if MP.1 meets 16 ms at 4× too, the budget is tightened to that.

- Code: the new map code lives in the lazy map chunk; the popover in the lazy parts chunk. The entry
  chunk (236.96 kB of 250 kB gzip) does not grow.

## 18. Working on any base map

- **World surfaces** (today): descriptors on the shown world map are drawn through the identity
  placement; labels of other maps are counted in `otherSurfaces`.
- **Atlas surface**: each world map has a placement (`AtlasPlacement`: scale and offset, in the atlas
  notes). Every descriptor is placed through its `WorldPoint`'s map; builders filter by the surface
  predicate ("placed on this surface") and `MapView.visible`, rank in atlas units, and share one cap
  (review MP-R07; `code-impact.md` §1-§2). The band comes from each placement's pixels per yard (§5.1),
  so an inset drawn at another scale gets its own band.
- **Islands**: Zephras Isle (2991) and Darkspear Islands (2997) have no placement on UiMap 947
  (UNKNOWN). If the atlas draws them as insets, the inset is an ordinary placement (scale and offset
  into a framed box), so their descriptors draw inside it unchanged; its label says "position on the
  world map unknown". Darkspear Islands, a battleground, gets no quest marks or level chip.
- **Cross-map lines**: route legs and transports between world maps are `connector`s on the atlas and
  transition glyphs on world surfaces; the flight network never crosses maps.
- **Base-map names**: through `BaseMapLabels` with its opacity and scale condition (§13.5).
- **Zone colour**: the criteria of §12.3 hold on any base map; the fallback tint draws where they fail.

## 19. Comparison with WoWF-QRP and MapGenie

*Revision 3 compares the pins and the drawer point by point in §25.9.*

"Beats" means better for planning routes under this project's rules, not better looking. The
comparison sheets (`rev2/shots/compare-*.png`) put the mock beside both benchmarks at each band.

| Aspect | WoWF-QRP | MapGenie | Revision 2 | Verdict |
|---|---|---|---|---|
| Base map, flow, both continents | one plane, continuous zoom, tinted relief | one WebGL surface, cross-faded tiles | the atlas team's; this design adds no pop of its own (§5.5) | depends on `map-atlas.md` for the images; matches both on the presentation's flow, to be verified by MP.12's zoom sweep |
| Both continents at once | every zone named (overlapping), every mark | pins in heaps, no names | all 49 zones named without overlap, marks at 6 px, the route | beats both |
| Quest marks at every zoom | yes, never aggregated | yes, fixed size, overlapping | yes, relevance window, sizes by zoom, aggregates only over the cap | matches WoWF-QRP; beats MapGenie on legibility |
| State at the selected step | yes | no | yes, from the derived pipeline | matches WoWF-QRP |
| Locked and uncertain quests | only prerequisite-locked, in a window | no | the same window, plus "?" for unknowns, reasons in words, "Unlocks soon" on request | beats both |
| Turn-ins | `?` grey or gold | no | hollow or solid square, never "ready" when unknown | matches; beats on the unknown case |
| Objectives | log quests, colour per quest | no | focused raw, others counted, outlines numbered by their completing step | matches at telling quests apart, without colour |
| Dungeons | spiral disc, names, raids | swirl pin | disc plate, raid ring, names from 0.05, Forever membership, the new instances named | matches; beats on honesty |
| Dungeon level | none | "Level 15-25", no source | LFG tuning number and the dungeon-quest span, each with its basis | beats MapGenie on basis; matches it on content where there are 5 or more quests |
| Flight points | faction diamond, known = unknown | side-coloured pins | own side, known to the route or not, "may be known" | beats both |
| Flight network and times | estimated edges, "≈" times | none | client network and path lengths, times with basis | beats both |
| Transports | faction docks, dashed curves | anchor pins | client stops, inferred services said, connectors | matches WoWF-QRP; beats on basis |
| Services | vendors, trainers, graveyards (zoomed in) | most categories | innkeepers, class trainers, the dataset's vendors, with actions; graveyards by decision I | matches WoWF-QRP except graveyards; falls short of MapGenie's coverage (the dataset's vendors are incomplete, and said to be) |
| Zephras Isle | ellipse at an illustrative position | framed inset | inset, "position unknown" | matches MapGenie; beats WoWF-QRP on honesty |
| Zone colouring | biome tint, hand palette | ground render | painted art per zone at every band (criteria §12.3), fallback tint, difficulty chip | matches the coloured look if the atlas meets §12.3 (or with the fallback); beats both on meaning |
| Zone level ranges | hand-set, some guessed | none | derived span for the character's quests, with basis, official text, "?" | beats both on honesty |
| Colour of marks | gold, grey, blue, orange by state | category colours | monochrome, or difficulty colour with pips (decision G) | falls short on vividness with G-a; matches with G-b, with a meaning |
| Labels | halo text, fades, overlaps | none | halo text, collision with leaders, never half-faded at rest | beats both |
| Step numbers, route after the step | badges, dashed after | n/a | numbers beside beads, dashed after, "×n" stacks | matches |
| Click | Accept, Objectives done, Turn in, Details, Wowhead, Fly to, Go to | title, one line | the same route-building actions, with difficulty and XP basis; Wowhead by decision J | matches |
| Filters and legend | 11 checkboxes, no legend | category panel with glyphs and counts | layer panel with glyphs, counts, notes, show and hide all, full key | beats WoWF-QRP; matches MapGenie |
| Accessibility | canvas only, colour-only states | colour-only side | shape and words for every state, keyboard paths, forced colours | beats both |
| Scale and speed | full redraw every frame | WebGL, no level of detail | per-band budgets, bitmaps, a measured first cost | beats both on scale (the Leaflet harness confirms in MP.1) |
| Close-zoom picture | 2 yd per pixel relief | a detailed top-down render | painted art and relief (atlas) | falls short of MapGenie: no top-down render is in scope |
| Icons | own vector glyphs | own pins | own glyphs (D-039 A) | matches |

## 20. Step plan

*Revision 3 changes this plan. §25.8 has each step's state on 2026-09-27 and the delta: MP.0b-3,
and MP.4 split into MP.4a to MP.4c.*

Every step ends green on `pnpm check`, with the map-edit bench within its baseline + 25%.

| Step | Files | Tests and gates | Depends on |
|---|---|---|---|
| MP.0 | DECISIONS entry for this design (bands per placement, per-band budgets, glyph families and badge slots, the relevance window, the labels canvas, the crossing budget for ARCHITECTURE §14, the twin amendment); STATUS rows for G to K | review of the amendment texts | — |
| MP.0b | **Owner review of the mock** (`rev2/shots/`, produced with this revision; re-shot after any change), with his answers to G to K recorded | the owner's feedback in the review file | — |
| MP.0c | **Atlas interface agreement** with `map-atlas.md`: `AtlasPlacement` with scale, insets as placements, the surface predicate and `MapView.visible`, `connector`, `BaseMapLabels` with its opacity and scale condition, and the zone-colour criteria of §12.3 | layer tests over a fake atlas placement, including an inset | the atlas design |
| MP.1 | `src/map/adapter.ts` (`MapView.band`, `LabelDescriptor`, `AreaDescriptor`, layer ids, per-band budgets in `createLod`), `src/map/layers.ts` (surface predicate), the controller's band hysteresis, `src/map/leaflet/labels.ts` (the labels canvas, placement, cross-fade, step numbers after edits), and the MAPS §7.2 harness extended to the revision 2 mix at the cap at 1× and 4×, and the band crossing | `layers.test` (per-band sums ≤ 2,500, band per placement), `labels.test` (deterministic placement, static priority, leaders, skip counts), `LeafletMapAdapter.test` (labels canvas takes no hits; renumbering redraws only it), harness numbers recorded, map-edit and map-paths benches | MP.0c |
| MP.2 | `src/ui/styles/tokens.css` (five tokens), `tests/ui-tokens.test.ts` pairs, `style.test.ts` reserved checks, the art-sampling contrast test | contrast pairs; achromatic; art samples in both themes | MP.0 |
| MP.3 | The derived pipeline's `QuestStateModel` (§7.1-§7.2); **the state-aware Available tab and the top bar's spans** (§14.4); the map's quest layers and turn-ins from the model; objectives with counted marks and outlines (`src/geo` grid groups and hulls) | `quest-state.test` (every class and reason, windows, lower-bound level gives uncertain, unknown record never ready, no-state fallback wording), happy-dom tests of the Available tab, `tests/bench/map-state.bench.ts` with a 10-20 quest log fixture | MP.1 |
| MP.4 | `src/map/leaflet/glyphs.ts` (silhouettes, badge slots, pills, sizes by zoom, bitmaps for plates and cards), `MapLegend.tsx` key and layer-panel glyphs | `glyphs.test` (no 45° plate, no "!" in a triangle, extents cover every slot, a mark with every badge), key test, the harness at the chosen sizes | MP.1 harness numbers, MP.0b |
| MP.5a | `tools/maps/client-tables.ts` through `tools/casc` for B, C and E; `public/maps/client/` with manifest and NOTICE; `src/infra/maps/client-tables.ts` (hash-verified loading) | `--check` byte-identical; counts (65 nodes, 143 pairs, 286 flights, 14 transport paths, 30 LFG rows); row and column recorded per number; dist-audit budget | D-039 |
| MP.5 | The dungeon layer: membership from the E file plus the cited announcement table (§8.1), entrances, spans, tuning numbers with the conflict rules, the "quests inside" chip | membership excludes the listed non-Forever maps; the new instances are named in the notes; Ruins of Lordaeron shows "?"; chip counts uncertain apart | MP.5a, MP.3 |
| MP.6 | UI.md §9 popover rule first; `src/ui/shell/MapPopover.tsx` and CSS, `src/ui/app/MapPanel.tsx` | happy-dom: focus in, arrows, Tab leaves and closes, Escape returns focus, every action calls its insert command and announces | MP.3 |
| MP.7 | `src/app/zone-levels.ts` (spans for the character, medians, thresholds, ruleset text), compact labels, cards, zone labels, the "Viewing" chip, `glyphs.ts` `drawDifficultyChip` twin | spans for the fixture's zones; the twin's rating equals `DifficultyLabel`'s; the twin reads only difficulty tokens; **every levelling zone named at the fit-both view of a 900 px panel** | MP.0 amendment, MP.4 |
| MP.8 | TravelGraph edges and TIME-6 from the committed file; the network layer; the load-failure fallback | TIME-6 in deployed builds; fallback texts | MP.5a |
| MP.9 | The transports layer; stop-to-service matching reviewed by hand; inferred docks into the engine with their basis | matched docks carry `inferred` and their record; unmatched stops never reach the engine | MP.5a |
| MP.10 | The faction overlay (C) and the fallback zone tint (generated by the art tool) | patterns per value (0, 2, 4, 6, sanctuary); the tint's saturation and reserved-colour test; neighbour differences recorded | MP.5a, MP.0c |
| MP.11 | The services layer and its actions | coverage note; side filter; actions insert the right steps | MP.3 |
| MP.12 | Review: an independent critique; a browser check of each band against the benchmarks; a recorded zoom sweep at 1× and 4×; the §12.3 criteria on the atlas; a WoWF-QRP re-check | benches; screenshots at the four bands in both themes | all |

## 21. Risks

| # | Risk | Mitigation |
|---|---|---|
| R1 | The classification costs more than the sync budget | it runs in the derived pipeline, once per publish; the bench gates it (MP.3) |
| R2 | The windows hide a quest the user wanted | the rows "Unlocks soon" and "Low-level quests"; the notes count what is hidden by reason; the Available tab lists every class |
| R3 | The difficulty twin drifts from `DifficultyLabel` | one shared rating function; a test compares colours, pips and edges |
| R4 | Labels clutter the art or duplicate its names | collision with leaders, static priority, `BaseMapLabels` with its scale condition; checked at every band (MP.12) |
| R5 | Derived spans mislead (hub quests elsewhere, cities) | spans over the character's quests, *n* and basis always shown, thresholds labelled |
| R6 | The instance lists go out of date | membership from the committed table and a cited list, reviewed on each client or data pin bump |
| R7 | Beta churn changes the client tables | pinned build, recorded CKeys, `--check` |
| R8 | The atlas interface differs from its working notes | MP.0c before MP.1; descriptors stay in world coordinates |
| R9 | Transport stops are matched to the wrong service | reviewed by hand; the basis is shown; unmatched stops never reach the engine |
| R10 | Monochrome reads less vividly than the benchmarks | decision G with a mock; place silhouettes; the zone colour criteria |
| R11 | Canvas content is not in the accessibility tree | keyboard paths built in MP.3; popover and "Viewing" chip in the DOM |
| R12 | A ten-quest log makes the zone band dense | counted marks for other quests; outlines; MP.4 tunes weights with the owner |
| R13 | The drawing cost at 4× exceeds the budget | bitmaps for plates and cards from the start; the harness before sizes are fixed; the new crossing budget recorded |
| R14 | The fallback tint is mistaken for a signal | it is picture, bounded by a saturation and reserved-colour test, never on a marker, off under forced colours |

## 22. Edits this design needs elsewhere (for their owners)

- **DECISIONS**: one entry for this design (MP.0). **D-022** and **D-024** get Status lines pointing to
  D-039 (review MP-R24): D-022's "bulk client tables stay local" and "taxi-derived leg timings are
  local-only" no longer hold for the tables D-039 commits; D-024's straight-line flight model becomes
  the fallback when the taxi file cannot be used or a leg is off the graph. **D-039** gets a
  "Supersedes (in part): D-022 (client tables B, C and E; taxi timings), D-024 (default flight
  model)" line. One entry per owner decision taken in §23.2.
- **UI.md §4**: rows "Zone typical-quest difficulty (map)" and, with G-b, "Quest-mark difficulty
  (map)", both through the canvas twin (colour, pips, level text, dashed edge for a lower-bound
  level); a row "Map picture (painted art, relief, generated zone tint): not a signal". Amend "Difficulty
  colours appear only through `DifficultyLabel`" to name the twin. **§3**: the five tokens of §6.2.
- **UI.md §9**: the popover rule (§14.2); rule 9: forced colours for the canvas; rule 12: the
  keyboard paths of §14.4.
- **UI.md §12**: bands; the new layers and rows with their glyphs; the state after the active step
  and its windows; labels, cards, zone labels and the "Viewing" chip; step numbers; the route after
  the active step; the popover replacing the choice list; search focusing the map.
- **MAPS §7**: §7.2 per-band budgets and bands per placement; §7.3 the layer order, the labels canvas
  and new descriptors; §7.4 the network lines, connectors and the split at the active step; §7.5 glyph
  families, silhouettes, badge slots, plates, labels and palette roles; §7.6 the tests. §3: the taxi,
  faction and dungeon rows. §9: the redistribution record for the committed client tables.
- **ARCHITECTURE §7**: layers, bands, labels. **§9.1**: taxi edges and transport stops from the
  committed file, inferred docks with basis, instance membership. **§14**: the `public/maps/client/`
  budget and the band-crossing budget (§17.4). **§16**: the dist audit's rules for that folder.
- **SIMULATION TIME-5 and TIME-6**: TIME-6 applies in deployed builds from the committed file;
  `local-maps/taxi.local.json` only overrides it; TIME-5 is the fallback; OD-6 is closed (D-039).
- **Dist audit** (`tools/build/audit-dist.ts`, `dist-requirements.json`): the new folder, files and
  budget.
- **THIRD_PARTY_NOTICES**: "Client-derived tables" naming Blizzard Entertainment for `TaxiNodes`,
  `TaxiPath`, `TaxiPathNode`, `AreaTable`, `LFGDungeons` and `ContentTuning`; "Ported code" only if an
  implementer ports WoWF-QRP code (none is planned), with the licence recorded at the commit it comes
  from (review MP-R20).
- **STATUS**: owner-decision rows for G to K; "Exact next tasks" with MP.0 to MP.12.
- **About dialog and README**: the notices for the committed client tables.
- **research/ux-benchmark.md**: a pointer to this file for the map ideas.

## 23. Decisions

### 23.1 Taken (D-039, owner, 2026-09-26)

Revision 1's decisions A to F are settled, and this revision is written on them (review MP-R24):

- **A. Icons**: our own glyphs; no Blizzard interface icons.
- **B. Taxi graph: committed** (nodes, edges, 3D path lengths, 25 yd shapes, transport stops; about
  27 kB gzip). OD-6 is closed: deployed builds use TIME-6. The paths "without B" of revision 1 remain
  only as the fallback when the file fails to load (§9).
- **C. Zone faction and sanctuary: committed**; an optional overlay, off by default, hatching and
  words (§12.6).
- **D. Client zone level proxies: not committed** (architect default); spans are derived (§12.5).
- **E. Dungeon tuning levels: committed**, one number labelled "LFG tuning level (client), meaning
  unverified", never a range; "?" where the client's row disagrees with itself (§8.4).
- **F. Raids with no finder row: hidden by default** (architect default), with a row to show them.

### 23.2 Still needed from the owner

*Answered (D-041, 2026-09-26):*
- G-b, H (a) and J "yes" were decided by the owner.
- I "not now" and K "read-only viewing only" are architect defaults.
- D-045 then superseded H: the minimap is the default base and the painted atlas a style.

*Revision 3's questions are P1 to P4 in §25.11.*

Proposed STATUS rows: G as OD-23, H as OD-24, I as OD-25, J as OD-26, K as OD-27. Until he answers,
the design runs on the defaults stated.

**G. How much colour on the marks?** (§6.3; mock `rev2/shots/decision-G-colour.png`.) (a)
monochrome; (b) quest marks in their difficulty colour with pips, from 11 px; (c) one category hue on
place glyphs. **Recommendation: (b).** Default until decided: (a).

**H. What does "colours the zoomed map" mean?** (§12.2; mock `rev2/shots/zone-colour-base.png`.)
This design reads it as "every zone in its own colour at every zoom". (a) The painted art's colours at
every band, with this design's criteria on the atlas and the fallback tint only where they fail; (b)
additionally, a selectable flat-colour style (our generated tint with relief shading, like WoWF-QRP's
look) instead of the art. **Recommendation: (a)**, with (b) offered only if the owner prefers
WoWF-QRP's look to the painted art. Default: (a).

**I. Graveyards?** The dataset has none, and which graveyard serves a zone is decided by the server.
A table would need a source (a future dataset field or the owner's in-game observations, as D-031
does for lifts); whether the client carries usable positions was not checked here. **Recommendation:
not now**; revisit when a source exists. Default: not drawn, and the services layer's note says so.

**J. A link to Wowhead in the popover and Details?** No project rule forbids it. It would open an
external site in a new tab when the user clicks it, with `rel="noopener noreferrer"` and no referrer,
sending nothing but the quest id in the address. **Recommendation: yes**, labelled "Open on Wowhead
(external site)", provided the owner is content to point at a third-party site that may not reflect
Forever's changes. Default: no link.

**K. Automated reading of third-party pages.** Revision 1's MapGenie study ran scripts in MapGenie's
page from a headless browser to read its map engine's state (§3.2). The owner allowed mapgenie.io;
whether automated access of that kind falls within that allowance is his call. **Recommendation:**
treat the allowance as covering read-only viewing only (the browser pane's read-only tools, no
scripts, no headless drivers), which is how every later look was made, and discard the INSPECTED facts
if he prefers. No conclusion on any site's terms is drawn here. Default: no further automated access;
INSPECTED facts carry no design weight.

## 24. Sources

- WoWF-QRP, https://tyba-dev.github.io/WoWF-QRP/ and https://github.com/tyba-dev/WoWF-QRP at
  `378bed9e777bc6df0acbfdc4c87b97f1ace20c72` (`src/app.js`, `src/nav.js`, `src/shell_head.html`,
  `README.md`, `tools/{taxi_q,relief,hires}.py`), read 2026-09-26 for behaviour only; its licence was
  checked at `c1e3fcf` (D-029), and any port records the licence at the commit it comes from. Live
  page re-checked 2026-09-26 at about 23:00 with read-only tools.
- MapGenie, https://mapgenie.io/world-of-warcraft-forever/maps/azeroth, observed 2026-09-26
  (`.cache/map-presentation/mapgenie/shots/`, `capture-info.json`; INSPECTED facts marked in §3.2).
- Our build of the working tree, 2026-09-26 (`ours.md`, `shots/`), and the revision 2 mock
  (`rev2/`), which draws the committed D-033 art and D-032 relief from `public/` with our own code.
- Client tables at 1.60.1.70009 through `tools/casc`, cross-checked against the Milestone 0 CSVs
  (`data.md`, `data.json`). For the mock's flight network only, the three taxi tables were read again
  through `tools/casc`; the whole-table dumps were deleted after the scratch extract
  (`rev2/mock/taxi.json`) was written.
- Blizzard's interface source mirror, Gethe/wow-ui-source `bd2470ae` ("1.60.1 (70009)"), read by the
  data researcher for behaviour only; nothing was ported, and the copies stay out of the repository in
  `.cache/map-presentation/data/ui-source/` (review MP-R20).
- The atlas team's working notes, `.cache/map-atlas/` (2026-09-26), pending `docs/research/map-atlas.md`.
- The critics' scratch checks: `.cache/map-presentation/critic/` and `owner-review/`.

---

## 25. Revision 3.1: pins and the category drawer (the D-045 addendum)

**Status:** revision 3.1, 2026-09-27. Revision 3 of the same day, revised after the review in
[docs/reviews/review-ui-refresh-design.md](../reviews/review-ui-refresh-design.md). §25.10 says what
changed and why.

**D-045 (owner)** makes the map "a mapgenie.io style overall":
- a minimap base by default, with the painted atlas as a style toggle;
- MapGenie-style pins with a category panel;
- our route-planning extras;
- a navy sea.

**D-046 (owner)** makes the general UI follow WoWF-QRP's layout and affordances.

**What this section does.** It is the addendum D-045 asks for:
- it replaces §6's achromatic plate glyph families with teardrop pins (§25.2);
- it replaces §14.3's layer panel and key with a category drawer, and the map toolbar and status line
  with controls that float on the map (§25.3).

It is also the single owner of two things the UI refresh ([ui-refresh.md](ui-refresh.md) revision 2)
uses and does not restate (review UO-03, UR-03, UR-04):
- **the quest-mark state table and glyph geometry** (§25.2.2, §25.2.3), for the route rows' discs and
  the map's pins alike;
- **the category drawer and the map's own controls** (§25.3).

Everything else in revisions 1 and 2 stands unless this section says otherwise.

**Labels:** as in the header, plus **ESTIMATE** for arithmetic on stated, measured inputs.

### 25.0 Inputs and evidence

**Read for this revision:**
- D-029, D-039, D-041, D-042, D-045 and D-046; STATUS; UI.md §1 to §9 and §12; MAPS §7.
- **The review** of revision 3 and of the UI refresh (UO-01 to UO-14, UR-01 to UR-13) and its evidence
  in `.cache/ui-refresh/critic/` and `.cache/ui-refresh/critic-rules/`.
- **MapGenie:** only the saved screenshots (`.cache/map-presentation/mapgenie/shots/`, 2026-09-26)
  and §3.2's notes. The site was not visited. INSPECTED facts still carry no weight (D-041 K).
- **WoWF-QRP:**
  - the UI study `.cache/ui-refresh/friend-ui.md` (HEAD `96f602b`, with `src/shell_head.html` and
    `src/app.js` read one file at a time);
  - revision 1's `friend.md` (`378bed9e`).

  The site was not visited for this revision, no source was fetched, and no code was ported.
- **The minimap probe**, `.cache/minimap-probe/`. The probe read the client minimap textures through
  `tools/casc`, read-only. It holds nine native samples at 1.04 yd/px, whole-map overviews at
  8.33 yd/px, and water statistics.
- **Committed and built files:**
  - the painted atlas tiles, `public/maps/atlas/t/` (D-042);
  - the client tables, `public/maps/client/` (MP.5a, built and not yet committed);
  - the dataset.
- **The entry chunk**, measured again for this revision: 246.19 kB of 250 kB gzip on the working tree
  at 13:27 on 2026-09-27 (`.cache/ui-refresh/ledger/`, with the tree state in `tree.txt`). The shared
  ledger is ui-refresh.md §10.3.

**Written for revision 3.1** (gitignored):
- `.cache/ui-refresh/shared/marks.js`: the one path set and state table, read by both mocks (a scratch
  stand-in for `src/map/marks.ts`).
- `.cache/ui-refresh/pins-mock/` (revision 3's files kept with an `-r3` suffix):
  - **the static mock:** `pins.js` (our own pin code), `mock.js`, `panel.css` and `index.html`;
  - **scripts:** `prep.ts` (the data), `bases.mjs` (the base crops, now with one uniform stand-in navy),
    `serve.mjs`, `shoot.mjs` (headless Chrome over CDP against our own local page only, with a
    throwaway profile that is deleted afterwards), `contrast.mjs` (§25.6);
  - **`shots/`:** `01-world-minimap`, `02-continent-minimap`, `03-zone-minimap`, `04-close-minimap`
    (dark theme), `05-zone-painted`, `06-search-minimap`, `07-panel-light-dark-search`, `08-pin-sheet`
    (anatomy, every state over six bases, and the colour threshold both ways), `10-shell-stage` (the
    map the UI refresh shell mock shows);
  - **`results/`:** each view's counts and `bench-*.json` (§25.7); `work/r3/` re-runs revision 3's
    bench beside revision 3.1's on the same afternoon.
- `.cache/ui-refresh/rev2/sheets/`: `owner-sheet.png` (both mocks on one sheet, review UO-03) and
  `pins-threshold.png` (revision 3 against revision 3.1 at *D* 13, 16, 20 and 26).

**Mock caveats:**
- The navy in the mock is a stand-in: water pixels, found by a colour rule, become exactly #0d1b30.
  Revision 3 kept 35 % of each pixel's variation, which showed tile edges; revision 3.1 makes it
  uniform (review UO-05). The atlas addendum makes the real navy from the client's liquid data.
- The zone borders in the mock are found by rasterising the zones over the base's land mask, not from
  the D-032 byproducts; §25.4 specifies the real ones.
- The state is revision 2's mock state: the realistic bench route, Orc Warrior, before step 1425,
  level ≥ 14. Its 10-quest Barrens log is illustrative, with every other turn-in marked ready.
- The mock clusters on a screen grid rather than §25.2.5's nested yard grid.

### 25.1 What the owner asked, and how this revision reads it

**"A mapgenie.io style overall"** means the look and handling of MapGenie's map:
- teardrop pins that read at a glance;
- a category panel that is also the legend;
- filters and search;
- a minimap base with a navy sea;
- **a map that takes the window**: MapGenie's panels collapse from edge handles, and its controls
  float on the map (zoom at the bottom right, full screen at the top right; OBSERVED on
  `mapgenie/shots/02-world-z10-panels-closed.png`, review UO-02).

It does not mean MapGenie's assets, colours or data. Its pins, glyphs and palette belong to a
commercial site. Its faction colours and its yellow "!" also sit on hues reserved for difficulty.
MEASURED on its screenshots:
- **Glyph yellow:** rgb(225, 189, 9), hue 52°, 8° from difficulty yellow.
- **Sea:** rgb(1, 29, 41), hue 198°, 10° to 12° from our provenance cyan.

**"Plus our route-planning extras"** (D-045 item 3) means zone names with level spans, the flight
network, quest state at the selected step, and the route line. MapGenie has none of them (§3.2).

**Where the drawer sits.** On the map's left edge, toggled from the map's top left. That is where
MapGenie's category panel and WoWF-QRP's "Map layers" panel sit (OBSERVED). D-046 itself says nothing
about the drawer; revision 3 wrongly attributed this placement to it (review UR-04).

**Rules kept:**
- Difficulty colours mean difficulty only: D-041 G on quest marks, always with pips.
- Cyan means provenance only.
- Colour is never the only cue.
- The glyphs are our own (D-039 A).
- Unknown stays unknown.
- The map is supplementary (UI.md §9 rule 12).

### 25.2 Pins

#### 25.2.1 Anatomy

Every point item on the map is a **pin**: our own teardrop, drawn on the canvas. That covers quest
givers, turn-ins, counted objectives, dungeon and raid entrances, flight points, transport stops,
portals and services.

- **Head:** a circle of diameter *D* (§25.2.4).
- **Point:** the tip, on the item's location, 0.36 *D* below the head's lowest point.
  - Its sides are tangents from the point to the head, with a half-angle of about 36°.
  - At *D* 26 the pin is 26 × 35 px.
- **Body and keyline:**
  - The **dark family** has a `--frl-map-pin` body (#101216, the difficulty well) and a 1.5 px
    `--frl-map-pin-glyph` keyline (#f2f2f2) outside it.
  - The **light family** (services) swaps the two.
  - Against any base colour, one of the two reaches at least 4.09:1 (§25.6).
  - MapGenie's pins have no keyline. MEASURED on its screenshot 04: a #1f1f1f body. Over the
    minimap samples that body alone reaches 3:1 on 22.8 % of pixels, and never on the sea.
  - The pins keep MapGenie's dark body with a coloured glyph. The route rows' discs are the other way
    round (the disc takes the colour, ui-refresh §5.1), because a dark disc on a light row reads as a
    column of black blobs (review UO-01). The glyph paths and the state table are shared; the fill
    follows its surface.
- **Glyph:** our own path in a 24-unit box (§25.2.2). **Revision 3.1: the box is 0.70 *D* for every
  quest pin**, so the "!" fills the head as MapGenie's does (review UO-04). Other glyphs are 0.66 *D*.
  - Dark family: `--frl-map-pin-glyph`, or the difficulty colour (§25.2.3). Light family:
    `--frl-map-pin`.
- **Pip tag** (quest pins with a colour, §25.2.3; revision 3.1): `DifficultyLabel`'s staircase on a
  small tag at the head's left, at 9 o'clock, the one side no badge uses.
  - The tag: 18 × 10 px, `--frl-map-pin` with a 1.2 px `--frl-map-pin-glyph` keyline (the pin's own
    two tones, so the same 4.09:1 floor holds), overlapping the head by 2.5 px so it reads as part of
    the pin.
  - The pips: five bars 2 px wide with 1 px gaps, 2 to 6 px tall. Lit bars take the difficulty colour;
    unlit ones take `--frl-difficulty-pip-off` (lit against unlit 3.36 to 12.37:1).
  - Revision 3 put the pips inside the head, under a 13 px glyph, so they fitted only at *D* 26.
- **Badge slots:** four places on the rim at 45° (§25.2.3). Each badge is a 10 px light disc or pill
  with a dark rim, so it reads on either family.
- **Edge:**
  - solid;
  - **dashed** (3.2 on, 2.4 off) for "not sure";
  - **double** (an inner ring 2.6 px inside the keyline) for a flight point both factions use.
- **Glyph fill:** solid, or **hollow** (outline only) for "not known yet".
  - Stroked glyphs ("!", "?" and the ring) are too narrow to hollow at pin sizes, since their
    stroke is about 3 px.
  - Their "not yet" states use a badge instead.

`shots/08-pin-sheet.png` draws the anatomy and every state over six bases: navy, dark forest,
Durotar, the Barrens, snow and the painted art. Its last band draws *D* 13, 16, 20 and 26 with the
pips inside (revision 3) and in the tag (revision 3.1), as the review asked.

#### 25.2.2 Glyph per category, and the one path set

| Category | Glyph (ours) | Family, size | Drawn from | Layer |
|---|---|---|---|---|
| Quest giver | "!" | dark, *D* | every band; clustered below the zone band | `available-quests` |
| Turn-in | "?" | dark, *D* | every band; clustered below the zone band | `turn-ins` |
| Objective of another log quest (the counted mark of §7.4) | a ring with a centre dot | dark, 0.8 *D* | zone band | `objectives` |
| Objective point of a focused quest | not a pin: §6.1's dot, ring or plus, because there are hundreds | — | as §7.4 | `objectives` |
| Dungeon entrance | an arched doorway | dark, *D* | 0.0325 px/yd (*D* 16) | `dungeons` |
| Raid entrance | a gate under three merlons | dark, *D* | same | `dungeons` |
| Flight point | **a paper plane** (revision 3.1) | dark, *D* | same | `flight-masters` (id kept) |
| Transport stop | a hull with two sails | dark, *D* | same | `transports` |
| Portal | an upright oval ring with a core | dark, *D* | same, once an observation is recorded (§10) | `transports` |
| Innkeeper | **the hearth house with its flame** (revision 3.1) | light, 0.8 *D* | 0.149 px/yd | `services` |
| Class trainer | an open book | light, 0.8 *D* | 0.149 px/yd | `services` |
| Vendor | **a bag** (revision 3.1) | light, 0.8 *D* | close band | `services` |
| Cluster (§25.2.5) | its members' glyph, with "×n" | as its members | below the zone band | as its members |

- **One symbol per concept** (review UR-12). The flight point, vendor and innkeeper glyphs are the
  filled forms of the route rows' `StepTypeGlyph` paper plane, bag and hearth house, so a flight step
  and a flight point, a buy step and a vendor, a hearth step and an innkeeper look alike on one
  screen. Revision 3's wing, purse and tankard are withdrawn. The trainer's open book already
  matched. UI.md §4 gains the rule (§25.13).
- **"!" and "?"** are the game's vocabulary and WoWF-QRP's discs' (D-046), drawn in our own shapes.
  - We use no anchor, swirl or winged boot (MapGenie's shapes), and no interface icon (D-039 A).
  - **How the "!" is drawn** (review UR-09): a vertical stroke of constant width 4.4 units with round
    caps, from y 4.6 to 13 on x 12, and a dot of radius 2.5 at y 18.8. It is not tapered. As
    proportions of its ink height (18.9 units): bar 0.677, foot and top width 0.233, dot centre
    0.868, dot radius 0.132. WoWF-QRP's `qmark` (`src/app.js` lines 646-660 at `96f602b`, read for
    revision 1 of the UI refresh) gives 0.638, 0.203, 0.420, 0.858 and 0.142: only the dot centre is
    within 2 %, which any "!" with a dot under its bar shares. The UI refresh's revision 1 path, a
    tapered bar whose bar length, foot width and dot centre all fell within 2 % of `qmark`'s, is
    withdrawn. No code was ported, and no legal conclusion is drawn.
  - The "?" is a stroke of width 3.9 with round caps, and a dot of radius 2.4.
- **Services** are the light family at 0.8 *D*. Amenities then recede behind tasks and places, and
  read apart at a glance (P3).
- **One path set, one home** (review UR-03). A new pure module, **`src/map/marks.ts`**, holds the
  glyph paths (each glyph a separate export, so a bundle takes only the ones it uses), the badge
  geometry, the state table of §25.2.3, and the D-041 G threshold constants. It imports nothing.
  - `src/map/leaflet` (pins, through `Path2D`) and `src/map/layers.ts` (states) import it directly.
  - `src/ui` reads it through `src/app/map-exports.ts`, as it reads the difficulty labels through
    `rules-exports.ts` (UI.md §1 principle 6): the route rows' `QuestMark` and the drawer's icons.
  - It is a third single-file module beside `map/adapter` and `map/layers`, so
    `tests/architecture.test.ts` and `tsconfig.pure.json` gain it. The map team makes that change in
    step MP.2b (§25.8), because it is already editing `tests/architecture.test.ts`; the UI refresh
    touches neither file.
  - A test asserts that the canvas drawing and the SVG component read the same path strings (one
    object, not copies), and MP.12's browser check compares a pin's glyph with a row's disc at 4×.
  - The mocks already do this: `.cache/ui-refresh/shared/marks.js` feeds both.

#### 25.2.3 States, badges and difficulty: the one state table

This table is the state table for **every** quest mark: the map's pins and the UI refresh's route-row
and quest-list discs (`QuestMark`, ui-refresh §5.1), which cite it rather than restate it (review
UR-03). "Colour" means the shape that carries the colour takes the difficulty colour: the **glyph** on
a pin (dark body), the **disc** in a row (well glyph).

| Item and state | Glyph | Edge | Colour | Badge (slot) | Spoken form (hover, key); templates |
|---|---|---|---|---|---|
| Quest available | solid "!" | solid | the difficulty colour, pips beside | — | "Quest available after step 14: Plainstrider Menace (difficult, level 12)" |
| Quest may be available (uncertain, §7.2) | solid "!" | **dashed** | the difficulty colour, pips beside | — | "May be available after step 14: …: the level after step 14 is at least 9" |
| Quest needs a prerequisite (in the window), or (rows only) an error at the step | "!" uncoloured (light glyph on a pin, ink in a row) | solid | none | lock (TR) | "Needs Cutting Teeth after step 14" |
| Quest unlocks soon (off by default) | "!" uncoloured | solid | none | level pill "16" (TR) | "Unlocks at level 16 (level after step 14: 14)" |
| Low-level quest (off by default) | solid "!" | solid | trivial grey, one pip | — | "Low level after step 14 (trivial)" |
| Dungeon quest | as its class | as its class | as its class | arch (TL) | "…has objectives inside a dungeon" |
| Turn-in, ready | solid "?" | solid | the difficulty colour, pips beside | — | "Ready to turn in after step 14: …" |
| Turn-in, in progress | "?" uncoloured | solid | none | **progress pie** (TR): the share of objectives done, from 12 o'clock, clockwise; empty at none | "Turn in: 1 of 3 objectives done after step 14" |
| Turn-in, record unknown (§7.5) | "?" uncoloured | dashed | none | **dashed empty pie** (TR) | "…objective record unknown (quest assumed in the log)"; never "ready" |
| Dungeon or raid entrance | arch or gate | solid | none | position (BL), a dashed ring, if `frameVerified` is false; count (BR) "×4" if the entrance is shared | "Dungeon entrance: Wailing Caverns"; "position not verified by the dataset's audit" |
| Flight point, known to the route | solid plane | solid (own side) or double (both factions) | none | — | "Flight point: Ratchet (both factions), known to the route after step 14" |
| Flight point, not known | hollow plane | as above | none | — | "…not known to the route after step 14" |
| Flight point, may be known (unknown history) | hollow plane | dashed | none | — | "…may be known before the route (history unknown)" |
| Flight point, no side in the client (1 of 65 nodes) | as its state | dashed | none | — | "the client sets no side for this node" |
| Other faction's flight point (row off by default, D-039) | hollow plane, struck through | solid | none | letter "A" or "H" (TR) | "Alliance only: not usable by an Orc Warrior" |
| Transport stop, service inferred | ship | solid | none | — | "Transport stop: to Tirisfal Glades (service inferred from client transport path 1234)" |
| Transport stop, service unknown | ship | dashed | none | — | "Transport stop (service unknown)" |
| Portal | oval | solid | none | — | "Portal to Darnassus (owner's observation, date)" |
| Service | house, book or bag (light family) | solid | none | — | "Innkeeper: … · Set hearth here after step 14" |
| Stack or cluster | the members' glyph | solid; dashed only if every member is | the members' colour and pips **only when every member has the same difficulty**; otherwise none | count (BR) "×n" | "6 here: 4 standard, 2 difficult; …" |

Revision 3.1 unifies what the two designs drew differently (review UR-03):
- **"May be available"** keeps the colour with a dashed edge in both. On a pin the keyline is dashed;
  in a row a dashed ring in `--frl-border-strong` is drawn outside the coloured disc (3:1 or more on
  every row state, and visible in the dark theme, where the well keyline is not). It is the same cue as
  `DifficultyLabel`'s dashed chip for a lower-bound level.
- **Badges** take one slot each on both surfaces: TL the dungeon-quest arch, TR the state (lock,
  level, progress, faction letter), BL position not verified (pins only), BR the count (pins only).
  Revision 1 of the refresh put the lock at the lower right.
- **Progress** is one cue, the pie badge, on both. The refresh's arc round the disc and revision 3's
  half disc are withdrawn; the "1/3" words stay beside a row's mark.

**Colour, and the 11 px of D-041 G** (review UR-01, UO-04). A quest mark shows the difficulty colour
only together with the pips, and only when the **shape that carries the colour** is at least 11 px:
- in a route row, a quest list or the drawer's key, that shape is the **disc**: 22 px, or 18 px in
  compact rows, so row marks are always coloured (the pips are on the chip beside the mark);
- on a pin, it is the **glyph's box** (the 24-unit box, 0.70 *D*): 11.2 px at *D* 16, 14.0 px at
  *D* 20 and 18.2 px at *D* 26. So **quest pins are coloured from *D* 16**, with the pip tag. The
  ink of the "!" in that box is 8.8, 11.0 and 14.3 px tall.
- Below *D* 16 (the fit-both view and the low continent band) quest glyphs take the light glyph colour.

This is the wording proposed for DECISIONS (§25.13), so the measure is defined once. It is the
default until the owner answers P1; revision 3's "from the zone band only" is offered to him as a
proposed amendment of D-041 G, not applied.

**Uncertain** quests keep their colour, with the dashed edge.

**Locked and in-progress** marks lose colour and pips, since there is nothing to take yet. The lock and
progress badges carry the state.

**Edges** have three fixed meanings:
- solid;
- dashed, "not sure": uncertain, may be known, side unknown, service unknown, record unknown;
- double, "both factions".

**Faction** is shown by glyph and outline only (D-045 item 3):
- the character's own side is the default;
- both factions get the double edge;
- the other faction's nodes are struck through, with their letter.

No red, blue or yellow is used for faction.

Below *D* 20 only the count pill of the badges is drawn, and the hover names the rest; the pip tag is
drawn from *D* 16. `glyphExtent` covers the head, the point, the tag and every slot.

**Selection and hover** (review UR-11):
- A selected pin (its popover open, or the active search result) is drawn 1.15× with a 3 px ring in
  the style's route colour, **laid on a 1.5 px halo on both sides** (`--frl-map-minimap-halo` in the
  minimap style, `--frl-map-label-halo` in the painted style). The ring therefore meets only its halo:
  5.43:1 or more in the minimap style and 4.81:1 or more in the painted light theme, whatever the base
  (§25.6). Revision 3's ring had no halo: 2.14:1 against the keyline, about 1.1:1 over snow and 1.52 to
  1.74:1 over painted water.
- A hovered pin's keyline widens to 2.5 px.

#### 25.2.4 Sizes by band, and why they are not all constant

MapGenie keeps every pin about 32 × 44 px at every zoom (MEASURED on screenshot 04; the size is the
same in 01, 03, 04 and 10).
- The constant size keeps its pins legible and its targets stable.
- It also buries the world view: at z10 the continents are heaps of pins, and at z7 1,120 pins pile
  into one blob (§3.2, screenshots 01 and 15).

We keep the constant size where it helps and drop it where it hurts:

| px per yard | Band | *D* | What changes |
|---|---|---|---|
| below 0.022 | world | 12 | quest and turn-in clusters only; places not drawn; no colour |
| 0.022 to 0.088 | continent | 12 → 26, linear in zoom (1.75 px per 0.25 step); 12.8 at the fit-both view | **colour and the pip tag from *D* 16 (0.0325 px/yd)**; places from 0.0325 (*D* 16); badges from *D* 20 (0.049 px/yd); clusters |
| 0.088 and above | zone, close | 26, constant | no clusters; stacks; services from 0.149 |

**Why the size is not constant zoomed out:**
- At the fit-both view (0.0239 px per yard) a 26 px head covers about 1,100 yd, a tenth of
  Kalimdor's width.
- Revision 2's census draws 131 to 373 giver points there (§7.3).
- Constant pins would hide both continents, as MapGenie's do.

**Why it is constant from the zone band:**
- The census counts at most 79 givers in view there, so a constant size costs nothing.
- It keeps the glyph 18 px (its ink 14 px), the pips legible and the target 30 px across.

**Flow (§5.5):** over the continent band no size jumps by more than 1.75 px per zoom step, and the
colour and tag arrive at *D* 16 with the band's cross-fade.

Revision 2's marks were 6 to 16 px; §6.1's size rule is superseded.

#### 25.2.5 Clusters and stacks

**Clusters below the zone band** are new.
- **What is clustered:** quest givers and turn-ins, each kind separately.
- **Grid:** a fixed grid in atlas yards, with nested levels of 512, 1,024, 2,048 and 4,096 yd. At a
  zoom the level used is the power of two at or above 1.25 *D* in yards: 1,024 yd over most of the
  continent band, 512 yd at its top and 2,048 yd or more deep in the world band.
  - Cells nest, so a cluster splits only where the cell halves, never on a pan.
- **Where clusters are made, and where caps apply** (review UR-06):
  - The **layer builder** makes all four levels once per derived publish (the givers and their states
    change only then), keyed by the model's revision. MEASURED: 373 givers cluster in 0.1 to 0.2 ms
    per level at 1× and 0.8 to 0.9 ms at 4×, so four levels cost at most about 3.6 ms at 4×, in the
    publish and off the drawing frame.
  - The **adapter** picks the level for the zoom at `moveend`: a lookup, never a rebuild on zoom.
  - The **cap** applies to the clusters of the level in use, not to givers: the clusters nearest the
    view's centre are drawn up to the budget, as MAPS §7.2 does for any layer, and the layer's note
    counts the rest. A cluster is never trimmed by the cap, so every drawn cluster's count is whole.
    Revision 3 left open whether the build cap could cut 373 givers to 150 before clustering; it
    cannot.
- **The cluster pin:**
  - It shows its members' glyph with "×n". The n counts quests, not givers.
  - It takes the members' colour and pip tag when every member has the same difficulty, and the light
    glyph colour otherwise (review UO-04: colour zoomed out without mixing difficulties).
  - It is anchored at the member nearest the centroid, so its point is always a real giver.
  - Its edge is dashed only when every member is uncertain.
- **Hover:** "12 quests at 7 givers near here after step 14: 9 available, 2 may be available, 1 needs
  a prerequisite; 7 standard, 5 difficult. Zoom in to separate them."
- **Click and keyboard:** a click zooms to the members' bounds, no further than the zone band. The
  keyboard path is the Available tab's zone groups (§14.4).
- **Split:** a split cross-fades like a band change (§5.5), and does not fade under reduced motion.
- **MEASURED (mock):** the fit-both view draws 56 quest clusters for 183 giver points
  (`01-world-minimap.png`); at 0.05 px/yd (*D* 20) 19 quest and turn-in pins are coloured
  (`02-continent-minimap.png`).

This departs from §5.5's "no aggregate flip", but clusters are not aggregates:
- every member is counted in its cluster's pill and hover;
- nothing is "over the cap";
- splits happen at fixed zooms, with a fade.

MapGenie does not cluster (screenshots 01 and 15). WoWF-QRP draws 13 px marks at world zoom and lets
them overlap (§3.1).

**Stacks at the zone and close bands:**
- Items at one point stay one pin with "×n" (§6.1, MAPS §7.2).
- In addition, pins of one kind whose heads would overlap by more than about 60 % (centres within
  0.4 *D*) merge into one pin with "×n" at each `moveend`, coloured by the rule above. The popover
  lists them (§14.2's stack list).
- **The merge uses a spatial hash** with 0.4 *D* cells, each pin checking its own cell and the eight
  around it. MEASURED for 450 pins: 0.2 to 0.3 ms at 1× and 1.0 to 1.2 ms at 4×; the mock's
  pairwise scan took 12.4 ms at 4× and is not the design (review UR-06).
- Pins of different kinds are not merged. They overlap in the draw order below, and the hit rule
  (§25.2.7) resolves them.
- `04-close-minimap.png` shows the Crossroads at 1 px per yard.

#### 25.2.6 Draw order

Lines go under pins, and pins go under the route's beads. From the bottom:
1. Lines: zone borders, the flight lines drawn at this band (§25.4), transport routes, the route line,
   and the focused quest's raw objective points.
2. Pins, by tier: services, counted objectives, quest givers, turn-ins, places. Within a tier they
   are ordered by screen y, so southern pins overlap northern ones.
3. On the labels canvas (§5.5): step beads, step numbers and labels.
4. The selection.

A step at a quest giver therefore shows its bead on the giver pin's point.

This moves `route-line` below the pin layers. Revision 2's order (§5.2) kept MAPS §7.3's route line
above the markers. Route segments stay clickable wherever no pin's target covers them.

#### 25.2.7 Hit targets

- **Target:** a pin's target is its head circle plus 2 px (a 15 px radius at *D* 26) and the
  triangle down to its point. Below *D* 20 the target is at least a 24 × 24 px square centred on the
  head (WCAG 2.2 SC 2.5.8).
- **Overlaps:** the head centre nearest the pointer wins.
  - When two lie within 3 px of the same distance, or the pin is a stack or cluster, the popover
    opens as a list.
  - MapGenie's dense towns show the problem this avoids: a click there hit a different pin
    (screenshot 08).
- **Hit index:** the adapter keeps its own, a 32 px grid of targets. **Revision 3.1 builds it off the
  `moveend` frame** (review UR-06): in idle time after the redraw, or on the first pointer event if
  that comes first. MEASURED: 0.1 ms at 1× and 0.4 ms at 4× for 450 pins; 0.8 to 0.9 ms at 4× for
  1,050.
- **Lines** keep the canvas renderer's tolerance.

#### 25.2.8 Rules for every glyph (amending §6.1)

- **No 45° diamond** anywhere in pins, badges or glyphs: ◆ and ◇ mean provenance.
- **No triangle with "!"**, which is the warning glyph. The quest "!" sits in a teardrop or a disc.
- **No "!" or "?" in gold or yellow**, except in the difficulty colour under D-041 G, and then
  always with the pips.
- **No interface icons** (D-039 A), and no MapGenie or WoWF-QRP shapes.
- **One symbol per concept** between the map and the route rows (§25.2.2).
- **Colour is never alone.** Every state has a glyph, fill, edge, badge or pips, and words in the key
  and the hover.

#### 25.2.9 Pins under forced colours (review UR-11)

A canvas is not repainted by forced colours, so revision 3's "the body becomes `Canvas`" needed a
mechanism. It is:
- The adapter watches `matchMedia('(forced-colors: active)')` and its `change` event.
- While it matches, it reads the system colours from a hidden probe element in the map's container
  (`color: CanvasText; background: Canvas; border-color: Highlight`) through `getComputedStyle`, and
  switches the pin palette: body `Canvas`, keyline and glyph `CanvasText`, the selection ring
  `Highlight`. Quest pins with a colour keep the well body, the difficulty colours and the pip tag, as
  `DifficultyLabel` opts out (UI.md §9 rule 9).
- The bitmap cache is keyed by the palette, so a change of theme or forced colours redraws.
- MP.4a's test stubs `matchMedia` and the probe, and checks the palette and the redraw; MP.12 checks
  in a Windows contrast theme.

### 25.3 The category drawer and the map's own controls

This section is the one specification of the drawer and the map's chrome. UI refresh §11 points here
(review UO-03, UR-04).

#### 25.3.0 The map's chrome: controls that float on the map (review UO-02)

Revision 3 kept the map inside a 32 px toolbar and a 24 px status line, between two side panels: a
684 × 634 px stage at 1366 × 768, or 448 px wide with the drawer docked. MapGenie's map takes the
window. Revision 3.1 removes both rows and floats the controls on the map:

| Place | Control | Notes |
|---|---|---|
| Top left | **Map layers** (a default 28 px button with the layers icon; `aria-expanded`, `aria-controls`) | Opens and closes the drawer. When the drawer is open it sits just right of the drawer |
| Top right | **Map focus** (a default 28 px toggle; `aria-pressed`; shortcut Alt+M) | Hides both side panels, or restores them (the shell's state, ui-refresh §4.3) |
| Left and right edges, below the top row | **Panel handles** (18 × 44 px tabs; "Hide the route panel", "Show the route panel", and the same for the quests and details panel) | The shell's (ui-refresh §4.3); drawn over the map's edges |
| Bottom right | **Zoom in, Zoom out** (32 px, as one group), then **Fit route** and **Focus step** (32 px, a second group) | One `toolbar`, "Map view", arrow keys inside. MapGenie's corner |
| Bottom left | **The map caption**: hover text, and the route note ("Route: 54 of 55 steps on the map · 1 without a location") | On a 92 % surface backplate, 12 px text; never a live region (UI.md §9 rule 12) |

- Every floating control has a surface or tile backplate and a 1 px `--frl-border-strong` edge, so it
  reads over any base (the edge is 3:1 or more on the tile, and the backplate carries the text).
- **The surface select goes.** The atlas shows every world map at once (D-042 O1), and its view
  presets ("Both continents", "Kalimdor", "Eastern Kingdoms", "Zephras Isle") join the top bar's
  "Go to zone or view…" select, before the zones.
- **Measured in the UI refresh's mock** at 1366 × 768 (`.cache/ui-refresh/mock/measure.json`):
  - both panels open: the map is 684 × 690 px (revision 3: 684 × 634);
  - with **map focus**: the map is 1366 × 690 px; the drawer docks there (the map region is 900 px or
    more), leaving 1066 × 690 px beside it;
  - revision 3 with the drawer docked left 448 px.
- **Keyboard order in the map region:** Map layers, the drawer (when open), the map surface, Map focus,
  the Map view toolbar. The handles belong to the shell's order (ui-refresh §9.3).
- **Forced colours:** they are ordinary buttons with system colours; pressed and expanded ones get a
  2 px `Highlight` edge.

#### 25.3.1 Where the drawer lives, how wide, and when it opens

- **Position:** in the map region, on the stage's left edge. It replaces the layer panel and the map
  key (§14.3; UI.md §12's `LayerPanel` and `MapLegend`).
- **Name:** "Map layers", for the toggle, the drawer's `region` and its heading. Revision 1 of the
  refresh called it "Categories"; that name is withdrawn, since the drawer also holds the style, the
  route rows and the key.
- **Width:** 300 px, the token `--frl-map-drawer-width`. The refresh's 236 px did not fit the rows'
  counts and notes.
- **Docked or over the map:** the drawer docks beside the stage when the map region is at least 900 px
  wide, and lies over the stage's left edge below that (a container query). UI.md §6's "never over
  it" becomes "docked from a 900 px map region, over the stage below". At 1366 × 768 with both panels
  open (684 px) it lies over the map; in map focus (1366 px) it docks.
- **Open by default** where it docks, closed where it would lie over the map (P4). The choice is
  remembered per browser (§25.3.7), and the remembered "open" applies only where it docks, so a narrow
  window never opens with the map covered. This replaces the refresh's "open from a 1,600 px window"
  (its decision C, folded into P4): at 1,600 px with both panels at 340 px the map region is 918 px, so
  the two rules agree there.
- **Loading** (review UR-05): the drawer's code is a **lazy part**, in the existing `lazy-parts`
  chunk that holds the Validation panel, not a new dynamic import (UI.md §11, CR-19: separate dynamic
  imports made the entry larger). It is preloaded when idle after the first paint, so it is ready
  before anyone opens it; until it is, the toggle opens a drawer that says "Loading map layers…".
  Revision 3's "part of `MapFrame`, loaded lazily with the map engine" could not hold: `App.tsx`
  imports `MapFrame` statically, and ARCHITECTURE §4 keeps `src/ui` out of the `map/leaflet` chunk.
- **Look:** the UI refresh's kit (ui-refresh §7): default and small buttons, a checkbox with a mixed
  state, the radio segmented control, the search field and the focus ring. No primary button: nothing
  in the drawer is the single next action.

#### 25.3.2 Groups and categories

The top of the drawer holds:
- **the map style**, "Minimap | Painted" (D-045 item 2): the kit's `SegmentedControl`, native radios
  in a fieldset with the legend "Map style";
- **the search** field;
- a toolbar with **Show all**, **Hide all** and **Defaults**.

The groups follow. The counts in `07-panel-light-dark-search.png` are the mock's state.

| Group | Category (row) | Default | Count shown (the unit is in the name and the tooltip) |
|---|---|---|---|
| **Quests**, headed "after step N" | Available | on | quests, with givers as a second figure ("209 · 118 givers") |
| | May be available | on | quests |
| | Needs a prerequisite | on | quests |
| | Unlocks soon | off | quests |
| | Low level | off | quests |
| | Turn-ins | on | quests in the log ("8 · 4 ready") |
| | Objectives | on | log quests with objectives on the map |
| **Instances** | Dungeons | on | entrances |
| | Raids | on | raids |
| | Unconfirmed raids (AQ20, AQ40, Naxxramas) | off (D-039 F) | raids |
| **Travel** | Flight points | on | nodes of the character's side ("34 · 2 known") |
| | Flight network | on | flights |
| | **All flights when zoomed in** (revision 3.1) | off | — (§25.4) |
| | Transport stops | on | stops |
| | Portals | on; disabled with "none recorded" until an observation is recorded | portals |
| | Other faction's flight points | off | nodes |
| **Services**, headed "zoomed in" | Innkeepers | on | NPCs |
| | Class trainers ("Warrior trainers") | on | NPCs |
| | Vendors ("dataset only") | on | NPCs |
| **Route and map** | Route line | on | — |
| | Step numbers | on | — |
| | Walking paths | on | — (a mode, UI.md §12) |
| | Zone names and levels | on | — |
| | **Zone borders** (revision 3.1; was "Zone outlines") | on | — (§25.4) |
| | Zone faction (D-039 C) | off | — |
| | Relief and coastline (painted style only) | as today | — |

- **Each row** is 24 px tall, with a 16 px native checkbox inside a 24 px target, the category's pin
  icon, the name, and the count right-aligned in tabular figures (review UR-11: revision 3's mock rows
  were 20 px). MEASURED in `07-panel-light-dark-search.png`: rows 24 px, checkboxes 16 × 16 px.
  - The icon uses the map's own paths in monochrome. A difficulty colour in the key would read as the
    category's colour.
- **A hidden row** is unticked **and** struck through. MapGenie strikes through; we add the tick, a
  cue that does not depend on reading.
- **A group heading** has its own checkbox (checked, unchecked or mixed) and a collapse button.
- **The proposal row** arrives with Milestone 8.

#### 25.3.3 Counts

- **Scope:** totals on the whole surface (both continents and the islands on the atlas), like
  MapGenie's.
  - Counts are not per view, which would churn with every pan.
  - The tooltip adds "k in view", computed at `moveend`.
- **Sources:** quest rows count quests from the `QuestStateModel` at the active step (§7.1). Place
  and service rows count the layer builders' items.
- **Names:** every row's unit is in its accessible name ("Available: 209 quests at 118 givers after
  step 1425, shown").
- **Without route state:** "open to an Orc Warrior (no route state yet)", as §7.1.
- **Updates:** counts update after each derived publish, never per pan, and are never announced
  (UI.md §9 rule 6).
- **Honest notes (MAP-HONEST-5) stay.** When a row's layer has a note, the row shows it as a muted
  second line. Notes cover items not placed and why, items over the cap, the other faction hidden,
  and vendors being incomplete. The key at the foot of the drawer holds the rest.

#### 25.3.4 Show and hide

- **Checkboxes:** a row's checkbox shows or hides that category; a group checkbox does all its rows.
- **Show all** turns every category on, including the ones off by default.
- **Hide all** turns every pin category off (Quests, Instances, Travel, Services). It leaves Route
  and map alone, so the route is never lost.
- **Defaults** restores the defaults above.
- Their accessible names say what they cover ("Show all map categories").
- **Mechanism:** hiding is a mask in the adapter, by the descriptor's category (a new `category`
  field), applied when drawing and hit-testing. It costs a redraw, never a rebuild. Hidden categories
  do not free budget for others, because the caps apply when layers are built.

#### 25.3.5 Search

- **Field:** one field, named "Search the map", with the placeholder "Search quests, places, NPCs".
  The refresh's "Filter the map" wording is withdrawn.
  - It matches quest names, NPC and object names, dungeons, flight points, transport stops and
    zones.
  - Matching is by substring, ignoring case and accents, with prefix matches first.
  - It starts at two characters, 150 ms after the last key.
- **While a query is active:**
  - The categories give way to the **results**, grouped as Quests, Instances, Travel, Services and
    Zones, with a count line ("6 results: 4 quests, 1 flight point, 1 zone area").
  - Each result shows its pin icon, its name and one line ("Start: Thork · level 14 · available
    after step 1425").
  - The map draws only the results, plus the route and the selection. MapGenie filters its map the
    same way (screenshot 14).
- **Reach:** results outside the relevance window (§7.2) are found too, with their state in words
  ("not available after step 1425: unlocks at level 22"). A chosen one is drawn with its state.
  Search is how to find any quest on the map.
- **Choosing a result:**
  - The map pans to it (it never zooms out past it), rings its pin and opens its popover (§14.2),
    which takes focus.
  - "Fit results on the map" fits them all.
  - "Clear search" restores the categories and the map.
- **Escape in the field** (review UR-11): the first press clears the text (when there is any) and
  restores the categories; the next press closes a drawer that lies over the map and returns focus to
  the Map layers toggle. In a docked drawer Escape only clears.
- **One map filter:** the drawer's search replaces revision 2's rule that the Available tab's filter
  drives the map when it has at most 20 matches (§14.3). **The Available tab's filter filters only the
  tab.** The refresh follows this rule and no longer restates it.
- **Hidden categories:** their results show while the query lasts, marked "(hidden category)".
- **MEASURED:** an index of the 11,212 quest, NPC and object names builds in 1.6 ms. Over ten queries
  it answers in 0.58 ms median and 1.16 ms at worst (Node 22, 1×). It is built on the search field's
  first focus, in the lazy part.

#### 25.3.6 The key

MapGenie's panel is its legend, and ours is too: every row carries its category's pin.

A "Key" disclosure at the foot names what the rows cannot:
- the edges (solid, dashed, double);
- solid and hollow glyphs;
- the badges, including the progress pie;
- the pip tag and the difficulty colour ("Quest pins take their difficulty colour from 16 px, with
  the pips in a tag beside them; a cluster only when all its quests share one difficulty");
- clusters and stacks;
- the line styles (§6.1's table), and that flights show zoomed in only for a hovered or selected
  flight point and the route;
- the route after the active step;
- the zone borders.

UI.md §9 rule 12's "every glyph, line style and badge is named in the key" holds.

#### 25.3.7 Persistence

- **Where:** per browser, in the app's settings store (IndexedDB `settings`, ARCHITECTURE §12.3), as
  one record: `{ version: 1, style: 'minimap' | 'painted', hidden: CategoryId[], drawerOpen:
  boolean, collapsed: GroupId[] }`.
- **When:** it is written 500 ms after the last change and read at the map's first mount.
- **Fallbacks:** defaults apply when the record is absent or unreadable. An unknown id is ignored,
  and a new category takes its default. `drawerOpen` applies only where the drawer docks (§25.3.1).
- **What it is not:** it is not in the project file, not exported and not undone by Ctrl+Z. The
  search text is not kept.
- **Amendment:** this changes UI.md §12 ("visibility is view state: it is not persisted"). An owner
  who hides services once expects them to stay hidden.
- The panels' collapse state and map focus are the shell's, in the same store (ui-refresh §4.3).

#### 25.3.8 Keyboard and screen reader

- **Toggle:** a button, "Map layers", with `aria-expanded` and `aria-controls` (a disclosure, so not
  `aria-pressed`; review UR-04). Its look when expanded is the kit's pressed look.
- **The drawer** is a `region` named "Map layers".
  - When it lies over the map, it is non-modal. Escape inside it (outside the search field, §25.3.5)
    closes it and returns focus to the toggle, and so does its close button.
  - When docked, Escape does nothing outside the search field, and there is no close button: the
    toggle closes it.
- **Tab order:**
  1. the style control;
  2. the search field;
  3. the toolbar (one stop, arrow keys inside);
  4. each group, one stop each: a roving tabindex over the group heading and its rows. Up and Down
     move, Home and End jump, and Space toggles the checkbox under focus;
  5. the key's disclosure.

  This follows UI.md §9 rule 4 (one stop per composite widget): 5 group stops instead of about 25
  checkboxes.
- **Collapsing a group** (review UR-11): on the group heading, Enter, or Left and Right, collapse and
  expand it (Left collapses, Right expands); Space toggles the group's checkbox. The collapse button is
  also a pointer target and names its state ("Collapse Quests", `aria-expanded`). A collapsed group
  keeps its heading in the roving set.
- **Rows** are native checkboxes whose names carry the count and state ("Low level: 16 quests,
  hidden"). A group checkbox is mixed when its rows differ (`aria-checked="mixed"`).
- **Search:**
  - The field is a `searchbox`, and Down moves to the first result.
  - Results are a list of buttons with a roving tabindex, and Enter chooses one.
  - After the debounce, one polite line in the drawer's own status element gives the count
    ("6 results"). It is the result of what the user typed (UI.md §9 rule 6), and nothing else is
    announced.
- **Show all, Hide all and Defaults** announce their result through the shell's announcer ("All map
  categories shown").
- **Forced colours:** the icons are inline SVG in `currentColor`, the rows keep the system checkbox,
  and the strike-through stays. The pins follow §25.2.9.
- **The canvas** is still not in the accessibility tree (§15). The drawer is the keyboard path for
  every show and hide (UI.md §9 rule 12), and search is a keyboard path to any pin.

#### 25.3.9 The interface with the UI refresh

Revision 3 guessed at this interface, and the two designs disagreed (review UO-03, UR-04). It is now
settled, and ui-refresh revision 2 §11 cites it:

| Part | Owner | Built in |
|---|---|---|
| The quest-mark state table and glyph geometry | this section (§25.2.2, §25.2.3) | MP.2b (`src/map/marks.ts`), before UR.2 |
| Row and list discs (`QuestMark`, `StepMark`) | ui-refresh §5.1 (their drawing only) | UR.2 |
| The kit: default, small, danger, ghost, link buttons; pressed and expanded looks; `Checkbox` with a mixed state; `SearchField`; `SegmentedControl`; the focus ring; icons | ui-refresh §7 | **UR.1, before MP.4b** |
| The shell: side-panel widths, collapse, handles, map focus and its shortcut | ui-refresh §4.3 | UR.5, before MP.4b |
| The drawer, its content, persistence and keys | this section (§25.3.1 to §25.3.8) | MP.4b (UR.7 of the refresh's revision 1 is folded in) |
| The floating map controls and caption | this section (§25.3.0) | MP.4b |
| The Available tab: its look and keys | ui-refresh §5.4 | UR.6, after MP.3 |
| The Available tab: its content (classes, reasons, zone groups) | §7 (MP.3) | MP.3 |

- **Withdrawn from revision 3:** "the side panels becoming drawers below 900 px" (nothing in either
  design needs it: UI.md §6's width steps stand, and the panels collapse at any width); "the map
  toolbar's +, −, fit and step controls" as a refresh job (they float on the map, §25.3.0).
- **Settings:** the drawer's record lives in the same settings store as the refresh's own preferences
  (panel widths and collapse, density, theme).
- **Tokens:** the drawer adds `--frl-map-drawer-width` (300 px) and no colour token beyond §25.5.
- **Warmth and typeface:** whatever the owner answers to the refresh's decision E applies to the
  drawer and the floating controls too; the map's own palette (§25.4, §25.5) does not change with it.

### 25.4 Our extras on each base style

| Extra | Minimap style (default; navy sea) | Painted style (the D-042 atlas) |
|---|---|---|
| Zone names with level spans | Ours at every band: the minimap carries no names, so `BaseMapLabels` reports none. Compact labels up to 0.05 px/yd, cards up to the zone band, zone labels up to about 0.3, then the "Viewing" chip (§13). Ink `--frl-map-minimap-ink` on `--frl-map-minimap-halo` in either theme. The cards' difficulty chip gets a 1 px light keyline on the dark ground | As §13. The art's own names show where the art is drawn at 0.75 of its native scale or more; ours show where it is scaled down, cross-faded or absent. Ink and halo come from the theme (`--frl-fg`, `--frl-map-label-halo`) |
| Zone borders (revision 3.1; review UO-05) | **Only borders shared by two land zones, and only over land.** Built offline from the D-032 zone outlines and coastline as a new terrain byproduct, `zone-borders` (the shared edges of neighbouring zones' polygons, clipped to the land mask, simplified to 1 px at the continent band), with `--check` like the others. Drawn from 0.022 px/yd (not at the world band), fading through the zone band: 1 px ink at 60 % over a 3 px halo at 55 % (§12.3 criterion 3). Revision 3 drew every zone outline, which follows the terrain grid in steps and runs out over the sea | The art's painted borders; the byproduct optional, as today's outlines |
| Zone colour | The minimap's own ground colours; the fallback tint (§12.4) is not drawn | As §12: the art, with the fallback tint where the art fails §12.3 |
| Flight network (revision 3.1; review UO-06) | **World and continent bands:** the whole network of the character's side, `network-flight`: 1.1 px `--frl-map-minimap-ink-muted` over a 3 px halo. **Zone and close bands:** only the flights of the hovered or selected flight point and the route's own flight legs; "All flights when zoomed in" (off by default) restores the rest. Revision 3 drew all 148 flights at every band, about twenty of them converging on the Crossroads | The same rule, in the theme's muted ink over `--frl-map-label-halo` |
| Transport routes | `network-transport`, dashed 3-3, in the same inks | Same |
| Quest state at the selected step | The pins (§25.2.3), the same in both styles; counts in the drawer; the "Viewing" chip | Same |
| Route line | `--frl-map-minimap-route` (#8ea2ff), 2.6 px over a 5.5 px dark halo. After the active step: dashed 5-6 at 55 %. Beads on the labels canvas, above the pins | The theme's accent over the theme's halo, as MAPS §7.4 and §13.6 |
| Sea | Navy (D-045 item 4), from the atlas addendum: one uniform navy, with no tile-edge steps; the Zephras Isle card is navy with a thin frame and its caption, not a black box (review UO-05) | Painted water (D-042 O3) |
| Faction hatching (optional) | `--frl-map-hatch` in its dark-theme value (white at 35 %) | As §12.6 |

**On the minimap, the palette follows the base style, not the theme.**
- The minimap is dark in both themes: median luminance 0.063 over the probe samples.
- The map container therefore gets `data-map-style="minimap"`. A block in the map's stylesheet points
  the palette roles that `readMapPalette` reads (`--frl-map-ink`, `--frl-map-route` and the others)
  at the minimap tokens.
- The painted style keeps revision 2's theme-dependent palette.
- Pins are the same in both styles and both themes.

**Mock:** `03-zone-minimap.png` and `05-zone-painted.png` show the same view, state and pins over the
two styles, with no flight hovered and so no flight lines; `04-close-minimap.png` (dark theme) shows
the Crossroads hovered, with its 26 flights; `02-continent-minimap.png` shows the whole network. The
world and continent shots show the borders between land zones and the uniform navy.

### 25.5 Colour tokens

New tokens, theme-independent (in `tokens.css`'s `:root`), replacing revision 2's plate tokens:

| Token | Value | Purpose | Checks |
|---|---|---|---|
| `--frl-map-pin` | #101216 | Dark pin body and pip tag; glyphs on light pins and badges | Equals `--frl-difficulty-well` (a test asserts this). Every difficulty colour's contrast on the chip therefore holds on the pin and the tag: trivial 4.75, standard 7.81, difficult 17.46, very difficult 7.51, impossible 4.83 |
| `--frl-map-pin-glyph` | #f2f2f2 | Glyph and keyline on dark pins; the pip tag's keyline; light pin body; badge fill | 16.75:1 against `--frl-map-pin` either way; achromatic |
| `--frl-map-minimap-ink` | #f2f2f2 | Minimap-style labels and borders | 17.36:1 on the halo |
| `--frl-map-minimap-ink-muted` | #c8cdd4 | Minimap-style network lines and other log quests' marks | At least 3:1 over the halo on every sample |
| `--frl-map-minimap-halo` | #0d0d0d at 85 % | Minimap-style halo for text, lines and the selection ring | Labels at least 11.57:1 on it over every sampled pixel |
| `--frl-map-minimap-route` | #8ea2ff | Minimap-style route line and selection ring | The dark theme's accent: 8.11:1 on the halo. Hue 229.7°: 110° from difficulty green, 43° from the provenance cyan |

- **Reused:**
  - `--frl-difficulty-*`, for the pins' colour and pips as the twin of D-041 G;
  - `--frl-difficulty-pip-off`;
  - `--frl-map-hatch`;
  - `--frl-map-label-halo` (painted style).
- **Width:** `--frl-map-drawer-width`, 300 px.
- **Removed before they were built** (MP.2 never ran): `--frl-map-plate`, `--frl-map-plate-glyph`
  and `--frl-map-plate-edge`.
- **The navy sea is the atlas addendum's token** (`--frl-map-sea-navy` or similar). This design
  needs it, like any picture colour (§12.4), to be:
  - at least 25° of hue from the provenance cyan;
  - at least 15 (CIEDE2000) from both cyan tokens.

  The candidate #0d1b30 (hue 216°) is 28° to 30° and 30.2 and 65.7 away. MapGenie's own sea,
  rgb(1, 29, 41) at hue 198°, would be 10° to 12° from our cyan, so it is ruled out.

**Reserved-colour checks:**
- `--frl-map-pin` (hue 220°, saturation 0.16, near-neutral) and `--frl-map-minimap-ink-muted` are
  at least 30° from every difficulty hue and at least 25° from cyan. The other new tokens are
  achromatic, or share the dark accent's hue.
- Difficulty colours appear on the map only in quest pins and their pip tags (the D-041 G twin) and in
  the zone cards' chip (§12.5). UI.md §4's rule "Difficulty colours appear only through
  `DifficultyLabel`" must name the pin twin (§25.13).
- Cyan never appears on the map.
- `tests/ui-tokens.test.ts` adds the pairs above. `style.test.ts` adds its "never a reserved colour"
  check for every pin role except the twin.

### 25.6 Contrast of pins, lines and labels over both styles

**Method** (`contrast.mjs`). The samples:
- 20,000 random pixels from each of the probe's nine native minimap samples: 180,000 in all,
  excluding the magenta of missing tiles;
- 400 from each of the 318 committed painted atlas tiles at level −2: 127,200, sea included;
- five flat colours.

For each pixel it computes the WCAG contrast of:
- the pin body, and the pin keyline, against it;
- MapGenie's keyline-less body (#1f1f1f) against it;
- the label ink and the route line on the halo painted over it;
- the line, or its halo, against it.

**Results** (unchanged from revision 3; the pip tag uses the pin's two tones, so its floor is the
pin's):

| Base | Median luminance | Body alone ≥ 3:1 | Keyline alone ≥ 3:1 | MapGenie-style body ≥ 3:1 | Worst pin silhouette | Worst minimap label on halo | Worst minimap route on halo | Worst painted route on halo (light theme) |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Minimap: Barrens and Mulgore | 0.137 | 60.3 % | 88.7 % | 48.5 % | 4.09 | 12.7 | 5.91 | 4.92 |
| Minimap: Feralas west coast | 0.009 | 5.0 % | 99.8 % | 2.7 % | 4.11 | 13.9 | 6.47 | 4.87 |
| Minimap: Dun Morogh and Ironforge (snow) | 0.409 | 77.5 % | 38.1 % | 74.3 % | 4.09 | 11.6 | 5.40 | 4.88 |
| Minimap: Durotar and Orgrimmar | 0.074 | 32.5 % | 94.8 % | 24.5 % | 4.09 | 11.6 | 5.42 | 4.90 |
| Minimap: Elwynn and Stormwind | 0.065 | 21.0 % | 97.1 % | 15.7 % | 4.10 | 11.6 | 5.42 | 4.80 |
| Minimap: Teldrassil | 0.009 | 3.5 % | 99.7 % | 2.1 % | 4.10 | 13.6 | 6.37 | 4.85 |
| Minimap: Thunder Bluff | 0.110 | 43.5 % | 95.9 % | 28.5 % | 4.09 | 12.5 | 5.84 | 4.95 |
| Minimap: Tirisfal and Undercity | 0.061 | 8.6 % | 99.8 % | 4.3 % | 4.11 | 14.1 | 6.57 | 4.90 |
| Minimap: Zephras Isle (includes empty black tiles) | 0.000 | 5.1 % | 98.6 % | 4.1 % | 4.10 | 11.7 | 5.48 | 4.79 |
| **All minimap samples** | 0.063 | 28.6 % | 90.3 % | 22.8 % | **4.09** | **11.6** | **5.40** | 4.79 |
| **All painted atlas tiles** (level −2) | 0.172 | 71.8 % | 81.7 % | 63.2 % | **4.09** | 11.8 | 5.51 | **4.82** |
| Navy candidate #0d1b30 | 0.011 | 0 | 100 % | 0 | 15.42 | 17.1 | 8.00 | 4.98 |
| MapGenie's sea rgb(1, 29, 41) | 0.010 | 0 | 100 % | 0 | 15.51 | 17.2 | 8.01 | 4.96 |
| Minimap offshore water rgb(8, 16, 16) | 0.005 | 0 | 100 % | 0 | 17.18 | 17.3 | 8.10 | 4.90 |
| Painted deep sea #3d3729 | 0.039 | 0 | 100 % | 0 | 10.56 | 16.6 | 7.73 | 5.19 |
| Painted coastal water #837658 | 0.185 | 100 % | 100 % | 100 % | 4.19 | 15.1 | 7.04 | 5.67 |

**The selection ring** (revision 3.1, MEASURED in `.cache/ui-refresh/rev2/contrast.mjs`, worst case
over a white or black base under the 85 % halo):

| Style | Ring on its halo |
|---|---:|
| Minimap (#8ea2ff on `--frl-map-minimap-halo`) | 5.43 (over white) to 8.21 (over black) |
| Painted, light theme (#3a4fc4 on `--frl-map-label-halo`) | 4.81 (over black) to 6.78 (over white) |
| Painted, dark theme (#8ea2ff on the dark halo) | 5.43 or more |
| Revision 3's ring against the keyline, for comparison | 2.14 |

MP.2's art-sampling test adds the ring on its halo over every sample.

**Findings:**
- **The two-tone pin never falls below 4.09:1.** This is a mathematical floor: whichever of #101216
  and #f2f2f2 is farther from a pixel reaches at least 4.09:1 against it. The pip tag is drawn in the
  same two tones.
  - On snow (Dun Morogh, body alone 77.5 %) the body carries the silhouette.
  - On the navy, dark water and dark forest (Teldrassil, keyline 99.7 %) the keyline does.
- **A MapGenie-style dark pin without a keyline** reaches 3:1 on 22.8 % of minimap pixels, 63.2 % of
  painted ones, and never on any sea. That is why our pins have the keyline.
- **Services** (light body, dark keyline) are the mirror case, with the same floor.
- **Labels:**
  - The minimap style's light ink on its dark halo reaches at least 11.57:1 over every minimap pixel.
  - The painted style's dark ink on its light halo reaches at least 12.59:1.
- **The route line** reaches at least 5.40:1 on its halo in the minimap style, and 4.79:1 in the
  painted style (light theme).
- **Thin lines:** a line or its halo reaches at least 3.88:1 against every pixel.
- **Inside the pin and the tag nothing depends on the base** (the chip's own pairs):
  - the light glyph is 16.75:1;
  - difficulty glyphs are 4.75 to 17.46:1;
  - lit pips against unlit ones are 3.36 to 12.37:1.
- **The minimap tiles are not committed yet** (that is the atlas addendum's step). When the tiles of
  both styles land, MP.2's art-sampling test runs on them. Until then, these probe samples are the
  evidence.

### 25.7 Performance

**Budgets per band** (revised in 3.1; review UR-06). Pins cost more than revision 2's marks, so the pin
layers get their own budgets, **at most 300 drawn pins per band** (revision 3: 450). Clusters count as
pins; the rest of §5.2 is unchanged.

| Layer | World | Continent | Zone | Close | Basis |
|---|---:|---:|---:|---:|---|
| `available-quests` (pins or clusters) | 120 | 120 | 100 | 100 | 56 clusters in the mock's fit-both view; at most 128 givers in view at the continent band and 79 at the zone band (§7.3). Clusters are never trimmed (§25.2.5) |
| `turn-ins` | 40 | 40 | 40 | 40 | a log holds 40 quests, with one turn-in point per quest (median and p90) |
| `objectives` | 80 | 80 | 500, of which at most 50 are counted pins | same | 18 to 51 counted marks in view (§7.4) |
| `dungeons` | 0 | 30 | 30 | 30 | 29 entrances plus raids; drawn from 0.0325 px/yd |
| `flight-masters` | 0 | 35 | 35 | 35 | 35 nodes for one side: 30 of its own, 4 for both factions and 1 with no side |
| `transports` | 0 | 27 | 27 | 27 | 27 stops |
| `services` | 0 | 0 | 18 | 18 | 10 to 12 in view at the zone band and 6 at the close band (revision 2's mock) |
| **Pins at most** | **160** | **252** | **300** | **300** | revision 3: 210, 400, 450, 450 |
| **Sum of all layers** | 1,510 | 1,812 | 2,020 | 2,000 | each at most 2,500; the other rows as §5.2 |

**Drawing cost** (MEASURED, `bench-*.json`; the canvas was 1280 × 800 at DPR 1.5, in headless Chrome
on this machine; the method is revision 2's: the main-thread time taken to issue the drawing). The
machine was about 13 % slower in the afternoon than in the morning run revision 3 quoted, so revision
3's bench was run again beside revision 3.1's (`work/r3/`):

| Mix, 4× (median) | Revision 3, morning | Revision 3, afternoon | Revision 3.1, afternoon |
|---|---:|---:|---:|
| 2,500 items, pins from cached bitmaps | 14.4 to 14.6 ms | 16.4 ms | 16.2 to 17.7 ms |
| 1,050 pins alone, from bitmaps | 10.0 to 10.4 ms | 12.6 to 12.8 ms | 13.3 to 13.5 ms |
| 1,050 pins alone, as vectors | 28.1 to 29.2 ms | 36.2 to 36.7 ms | 44.6 to 48.5 ms |

At 1× revision 3.1 takes 2.1 to 2.9 ms for the full mix from bitmaps and 2.6 to 2.7 ms for the pins
alone. The pip tag makes vector pins dearer (five more fills), but pins are drawn from bitmaps, where
3.1 costs within the run-to-run spread of revision 3 on the same afternoon.

- **Pins are drawn from cached bitmaps from the start.**
  - The cache key is the glyph, fill, edge, difficulty, badges, tag, size, palette and DPR.
  - Each bitmap is sized to the pin's own extent (head, point, tag, badges), not a fixed box.
  - In the continent band, sizes are bucketed to even pixels.
  - An LRU keeps at most 256 bitmaps, about 7 MB at DPR 2 (ESTIMATE). The bench used 122.
- **What runs in the `moveend` frame, and what does not** (review UR-06):

  | Work | Where | 4× cost |
  |---|---|---:|
  | Leaflet's projection | the frame | up to 6 ms (perf.md) |
  | Drawing: 300 pins from bitmaps | the frame | 3.9 ms (ESTIMATE: 12.9 µs a pin, the slower afternoon's) |
  | Drawing: the other 1,720 items at the cap | the frame | 5.1 ms (ESTIMATE: 2.97 µs an item, from revision 3's 4.3 ms for 1,450; the afternoon runs gave 2.7 to 4.2 ms) |
  | Stack merge (spatial hash) | the frame | 0.8 to 1.2 ms (MEASURED 1.0 to 1.2 ms for 450 pins) |
  | Level choice for clusters | the frame | a lookup |
  | The hit index | idle after the frame, or the first pointer event | 0.4 ms (MEASURED, 450 pins) |
  | Label and card placement | the labels canvas, in the next frame | up to 1 ms (§17.3) |
  | Clustering four levels | the derived publish | up to about 3.6 ms (MEASURED 0.8 to 0.9 ms a level) |

  **In the frame: about 15.8 to 16.2 ms at 4× (ESTIMATE) on the slower afternoon's numbers, at the
  16 ms line, and about 14.8 ms on the morning's.** Revision 3's 14.6 ms left out the hit index, clustering and label placement,
  which brought it to 15.8 to 17.2 ms, and it costed the non-pin drawing for 1,450 items where the
  cap allowed 1,710.
- **The gate:** the MAPS §7.2 harness measures this mix at the cap, with the `moveend` bookkeeping,
  at 1× and 4× in MP.1, before MP.4a fixes the sizes. If it exceeds 16 ms at 4×, the fallbacks, in
  order: the `objectives` dots from 500 to 300 at the zone and close bands (about 0.6 ms), then the pin
  cap from 300 to 250 (about 0.65 ms).
- **Raster time is not in these numbers.** With a read-back after every frame, the full mix took 45 to
  49 ms from bitmaps at 1×. That is headless Chrome's software rasteriser on this machine with no GPU:
  an upper bound, not the app's GPU path.
- **Other costs** (MEASURED unless marked):
  - search: 0.58 ms median over 11,212 names (1×);
  - showing and hiding categories, and the search filter: a mask in the adapter, so one redraw and no
    rebuild;
  - counts: once per derived publish;
  - persistence: one IndexedDB write per burst of changes, off the redraw path.
- **Entry chunk** (review UR-05): one shared ledger for both plans lives in ui-refresh.md §10.3; this
  design's rows in it are:
  - the pins, clusters, hit index and the map's drawing: the lazy map chunk (about 10 to 12 kB gzip,
    ESTIMATE); nothing in the entry;
  - the drawer and search: the `lazy-parts` chunk (§25.3.1); a stub of 0.2 to 0.3 kB in the entry
    (ESTIMATE);
  - `src/map/marks.ts`: 0.3 to 0.5 kB in the entry, since the route rows import the "!" and "?" paths
    (ESTIMATE; each glyph is its own export);
  - MP.3's Available content (state classes, reasons and zone groups in the tab; the model itself is
    computed in the lazy derived pipeline): 0.8 to 1.5 kB (ESTIMATE);
  - the floating controls in place of the toolbar and status line: −0.2 to +0.3 kB (ESTIMATE);
  - removing `LayerPanel` and `MapLegend`: **−2.07 kB** (MEASURED in context, by removing their bytes
    from the measured entry chunk and compressing again).

  Revision 3's "the entry chunk does not grow" is withdrawn: it left out MP.3, the marks and the stub.
- **The route list:** nothing here touches the virtualised list. A drawer toggle or a search renders
  only the drawer.

### 25.8 Step plan delta

The map-build team had started part of revision 2's plan (§20). The state on 2026-09-27, in the
working tree (not committed):

| Step | State | Revision 3.1 |
|---|---|---|
| MP.0 DECISIONS entry | Not started | Also records the pins, the pip tag, the one state table, the drawer and the map's chrome, clusters and stacks, the style palette, the pin budgets, the zone borders, the flights zoomed in, and **the 11 px measure** (§25.2.3); proposed as D-047. Done with the refresh's UR.0 |
| MP.0b owner review | Done: D-041 (G, H and J by the owner; I and K architect defaults) | **MP.0b-3, merged with the refresh's UR.0b:** the owner reviews one sheet (`.cache/ui-refresh/rev2/sheets/owner-sheet.png`) with the decision sheets and the pin sheet, and answers P1 to P4 and the refresh's A, B, D, E and F, before MP.4a fixes the sizes |
| MP.0c atlas interface | Largely delivered by ATL.3 and ATL.7 | Remaining, agreed with the atlas addendum: the base style (`MapStyle`) in the adapter's options and status; `BaseMapLabels` empty for the minimap; the uniform navy and the Zephras card per style; §12.3's criteria per style |
| MP.1 bands, labels canvas, harness | Not started | Adds the pin extents and the pip tag, the cluster levels, stacks by spatial hash, the deferred hit index, the style palette (`data-map-style`), the draw order, the cluster split fade, and a harness mix at the new caps (300 pins and 1,720 other items) **with the `moveend` bookkeeping** |
| MP.2 tokens | Not started (only the atlas's three tokens are in) | The §25.5 tokens and `--frl-map-drawer-width`. The art-sampling test covers both styles, the navy and the selection ring on its halo. Lands before the refresh's UR.1, which edits the same `tokens.css` and `tests/ui-tokens.test.ts` |
| **MP.2b marks module** (new) | — | `src/map/marks.ts` (§25.2.2): paths, badges, the state table, the threshold constants; the `map/marks` rule in `tests/architecture.test.ts` and `tsconfig.pure.json`; the re-export in `src/app/map-exports.ts`; `marks.test.ts` (the state table's cases, no diamond, no triangle, colour only with pips and at 11 px or more). **Before the refresh's UR.2** |
| MP.3 quest state, Available tab, spans | Not started | Unchanged. The model also feeds the drawer's counts. The tab's look is the refresh's (UR.6); the refresh's UR.3 follows MP.3, since both touch the derived view |
| MP.4 glyphs and key | Not started | Replaced by MP.4a to MP.4c (below) |
| MP.5a client tables | Built by the map-build team, not committed: 65 nodes, 286 flights, 14 transport paths, 30 LFG rows | None. The nodes' side flags drive the faction edge |
| MP.5 dungeons | Not started | Entrances as pins |
| MP.6 popover | Not started | Also opened from a search result and from stack and cluster lists; its buttons are the refresh's kit |
| MP.7 labels and borders | Not started | The style palette; no base-map names on the minimap; **the `zone-borders` byproduct** (with the terrain tools' owner, `--check` and its budget line) drawn from 0.022 px/yd; the chip's keyline on the minimap |
| MP.8, MP.9 network and transports | Not started | Style inks; stops as pins; **flights zoomed in only for the hovered or selected flight point and the route**, with the "All flights when zoomed in" row |
| MP.10 faction overlay and fallback tint | Not started | The tint in the painted style only |
| MP.11 services | Not started | Light pins with the house, book and bag |
| MP.12 review | — | Joint with the refresh's UR.8: the MapGenie pin comparison, contrast sampling on the committed minimap tiles, a zoom sweep through the cluster splits, a Windows contrast theme, the shared entry-chunk ledger |

**MP.4 is replaced by three steps:**
- **MP.4a, pins:**
  - `src/map/leaflet/pins.ts`: bitmaps sized to extent, drawing, the pip tag, stacks by spatial hash,
    the deferred hit index, the forced-colours palette (§25.2.9);
  - the cluster levels in the layer builder, and the caps on clusters;
  - `MarkerDescriptor.category`, and the pin budgets.
  - Tests:
    - `pins.test`: geometry, extents, slots, the tag, no diamond, colour only with the tag and from
      *D* 16, uniform colour for clusters and stacks, the size curve, the forced-colours palette;
    - `clusters.test`: nesting, anchors on members, counts, caps on clusters never trimming one;
    - `hit.test`: the 24 px minimum and the nearest centre.
- **MP.4b, the drawer and the map's chrome** (the refresh's UR.7 folded in):
  - `src/ui/shell/MapCategoryDrawer.tsx`, a lazy part in `lazy-parts`; the floating controls and
    caption in `MapFrame`; the toolbar and status line removed; `LayerPanel` and `MapLegend` removed;
    `variant="secondary"` in `MapFrame.tsx` moved to the kit's default, and the alias the refresh
    keeps until then removed;
  - counts, show and hide, Show all, Hide all and Defaults, the key, persistence and the keyboard
    contract.
  - Needs the refresh's UR.1 (kit) and UR.5 (the shell's collapse and map focus state).
  - Tests (happy-dom): the roving tabindex per group, the mixed group state, collapse keys, names with
    counts, Escape in the field and in the drawer, a persistence round trip, `drawerOpen` only where
    it docks, the lazy part.
- **MP.4c, search:** the index, the results list and the map mask, with its tests.

**Order** (the combined order with the refresh's steps is in ui-refresh.md §14):
1. MP.0 with UR.0; then MP.0b-3 with UR.0b.
2. The rest of MP.0c; MP.1; MP.2; MP.2b.
3. MP.3.
4. MP.4a; MP.4b (after UR.1 and UR.5); MP.4c.
5. MP.5 to MP.11.
6. MP.12 with UR.8.

The pins do not wait for the minimap tiles: they draw on either base.

### 25.9 Comparison with MapGenie and WoWF-QRP

| Aspect | MapGenie (saved shots) | WoWF-QRP (378bed9e, 96f602b) | Revision 3.1 | Verdict |
|---|---|---|---|---|
| Map size | Fills the window; panels collapse from edge handles; controls float on the map | Map between the side panels | Controls float on the map; both panels collapse; map focus (Alt+M); 1366 × 690 px at 1366 × 768 | Matches MapGenie |
| Pin silhouette | Teardrop, about 32 × 44 px, dark body, no keyline | No pins: bare 19 px "!" and "?" with a dark outline | Our teardrop, 26 × 35 px from the zone band, dark body with a light keyline; the "!" fills the head | Matches MapGenie's look. Beats it on contrast: a 4.09:1 floor, where its pin reaches 3:1 on only 22.8 % of minimap pixels |
| Size with zoom | Constant at every zoom | 19 px; 13 px below s 0.02 | 12 → 26 px over the continent band, constant from the zone band | Matches MapGenie where pins are legible; beats it zoomed out |
| Zoomed out | Pins in heaps; 1,120 in one blob at z7 | Marks overlap | Clusters with counts, splitting at fixed zooms, coloured when their quests share a difficulty | Beats both |
| Glyph per category | Yes (its own icons) | "!", "?", spiral, diamonds | Our own, for 12 categories, one symbol per concept with the route rows | Matches |
| Quest colour | A yellow "!" for every quest | Colour by state: gold available, orange dungeon, grey trivial, blue locked | Difficulty colour with pips (D-041 G) from 16 px pins; state by edge and badges | Beats both on meaning; colour always has a non-colour cue |
| Faction | Red, blue or yellow pins | Faction-filled diamonds | Glyph and edge; the other faction opt-in and struck through | Beats both: no colour-only cue, no reserved hue |
| State at the selected step | None | Yes | Yes, with uncertainty, locks and progress | Matches WoWF-QRP; beats MapGenie |
| Dense towns and clicks | Overlaps; a click hit the wrong pin (08) | Overlaps | Stacks with lists; nearest-centre hits; a 24 px minimum | Beats both |
| Category panel | Groups, counts, strike-through, Show all and Hide all | 11 checkboxes in "Map layers", no counts | Groups; counts at the step; tick and strike-through; Show all, Hide all and Defaults; notes | Matches MapGenie; beats it on counts at the step and on honesty |
| Search | Lists results and filters the map (14) | Quest search in the top bar | Any pin; results with their state; the map filtered; a popover on choice | Matches MapGenie; beats it on state and reach |
| Legend | The panel | None | The drawer, plus a key for edges, badges, pips and lines | Beats both |
| Remembered filters | Not studied | Not studied | Kept per browser in settings | — |
| Keyboard and screen reader | Not studied | Checkboxes; the map by mouse and keys only | One stop per group, names with counts, search to any pin | Beats both, as far as studied |
| Zone names and levels | None | Hand-set ranges, some guessed | Derived spans with their basis, at every band | Beats both (§19) |
| Zone borders | None | Biome tints | Borders only where two land zones meet | Close to MapGenie's clean ground; adds borders |
| Flight network | None | None (estimated edges) | The client network zoomed out; zoomed in, only the hovered or selected flight point's flights and the route's | Beats both |
| Route line | None | Solid up to the selected step, dashed after | The same, with beads on pin points | Matches WoWF-QRP |
| Base | A minimap render with a navy sea | Biome tints | The minimap (navy) by default, the painted atlas as a style | Matches MapGenie, and adds the painted style |
| Sea | Navy #011d29 | Blue-green | A navy of our own (hue at least 212°), uniform | Matches the look without the reserved hue |
| Speed | WebGL, no level of detail | Full redraw every frame | Bitmaps, per-band caps, the bookkeeping off the frame, measured | Beats both on scale (confirmed by the harness in MP.1) |
| Advertising | A 300 px advertisement over the map | None | None | Beats MapGenie |

### 25.10 Resolution: what revision 3 and revision 3.1 change

**Revision 3** (against revision 2):

| # | Revision 2 | Revision 3 | Where |
|---|---|---|---|
| 1 | Three glyph families (§6.1): bare marks, dark place plates with a silhouette each, light service plates | One teardrop pin in two families. The glyph gives the category; fill, edge and badges give the state | §25.2 |
| 2 | Sizes 6 to 16 px, continuous (§6.1) | 12 to 26 px, constant from the zone band | §25.2.4 |
| 3 | Five achromatic plate tokens (§6.2) | Pin tokens and a minimap ink set | §25.5 |
| 4 | Decision G open (§6.3) | Decided (D-041 G); applied at *D* 26 with the pips inside the head (changed again in 3.1) | §25.2.3 |
| 5 | No aggregates for quest marks (§5.5) | Clusters below the zone band; stacks at the zone and close bands | §25.2.5 |
| 6 | The route line above markers (§5.2, MAPS §7.3) | Below pins, with beads above them | §25.2.6 |
| 7 | Hit radius: the glyph plus 2 px | Our own hit index, a 24 px minimum, nearest centre wins | §25.2.7 |
| 8 | A layer panel and key beside the stage; search through the Available tab, at most 20 matches (§14.3) | A category drawer: counts, show and hide, Show all, Hide all and Defaults, search on the map, a key | §25.3 |
| 9 | Visibility not persisted (UI.md §12) | Kept per browser | §25.3.7 |
| 10 | The layer panel never over the stage (UI.md §6) | Docked from 900 px, over the stage below | §25.3.1 |
| 11 | One palette per theme | The minimap style forces the dark ink set | §25.4 |
| 12 | Painted art as the only base (D-041 H); fallback tint everywhere | The minimap by default and the painted atlas as a style (D-045). The tint only in the painted style | §25.4 |
| 13 | Budgets per layer (§5.2) | The pin layers at most 450 drawn pins per band (changed in 3.1) | §25.7 |
| 14 | Marks bench; bitmaps only for plates and cards (§17) | Pins bench; every pin from bitmaps | §25.7 |
| 15 | G to K open (§23.2) | Answered by D-041; H superseded by D-045 | header, §23.2 |
| 16 | Step plan (§20) | MP.0b-3, MP.4a to MP.4c, and each step's delta | §25.8 |

**Revision 3.1** (against revision 3; the review's findings, whose resolutions are recorded in the
review file):

| # | Revision 3 | Revision 3.1 | Finding | Where |
|---|---|---|---|---|
| 17 | Pips inside the head; colour from *D* 26; P1 recommended keeping it | Pips in a tag at the head's left; the "!" fills the head; colour from *D* 16; clusters and stacks coloured when uniform; P1's default honours D-041 G | UO-04, UR-01 | §25.2.1, §25.2.3, §25.2.5, §25.11 |
| 18 | "11 px" read as the glyph's height, and read differently by the refresh | Defined once: the shape that carries the colour (the disc in rows, the glyph box on pins); proposed for DECISIONS | UR-01 | §25.2.3, §25.13 |
| 19 | Two drawer specs; placement attributed to D-046 | One spec here: "Map layers", `aria-expanded`, 300 px, docks from a 900 px map region, open where it docks, radio style control, "Search the map", a lazy part; D-046 attribution removed | UO-03, UR-04 | §25.1, §25.3 |
| 20 | Toolbar and status line; the map never takes the window | Controls float on the map; map focus; panel handles | UO-02 | §25.3.0 |
| 21 | Zone outlines everywhere, over the sea; stand-in navy with tile edges and a black Zephras card | Borders only between land zones, over land, none at the world band; one uniform navy; a navy Zephras card with a frame | UO-05 | §25.4, mock |
| 22 | All 148 flights at every band | Zoomed in: only the hovered or selected flight point's and the route's; "All flights when zoomed in" | UO-06 | §25.4, §25.3.2 |
| 23 | Paths "shared" but different; different states and badge slots; module in the adapter tier | One path set and state table in `src/map/marks.ts` (MP.2b); one badge slot per state; one progress cue | UR-03 | §25.2.2, §25.2.3 |
| 24 | Wing, purse, tankard | Paper plane, bag, hearth house: one symbol per concept with the rows | UR-12 | §25.2.2 |
| 25 | Caps "after clusters" at build; 14.6 ms without the bookkeeping | Clusters built per level in the builder, caps on clusters; 300 pins per band; stacks by spatial hash; hit index and labels off the frame; costs re-measured | UR-06 | §25.2.5, §25.2.7, §25.7 |
| 26 | "The entry chunk does not grow"; the drawer lazy "with the map engine" | One shared ledger (ui-refresh §10.3) with this design's rows; the drawer a lazy part | UR-05 | §25.3.1, §25.7 |
| 27 | Selected ring without a halo; pins under forced colours without a mechanism | The ring on a halo both sides, measured; a forced-colours palette read from a probe element | UR-11 | §25.2.3, §25.2.9, §25.6 |
| 28 | 20 px drawer rows; no key to collapse a group; Escape ambiguous in the field | 24 px rows with 16 px checkboxes; Enter and Left/Right collapse; Escape clears, then closes | UR-11 | §25.3.2, §25.3.5, §25.3.8 |
| 29 | The "!" construction unrecorded | Recorded; the refresh's tapered path withdrawn | UR-09 | §25.2.2 |
| 30 | Step plan collided with the refresh's | MP.2b first for the marks module; MP.2 before UR.1; MP.4b after UR.1 and UR.5; UR.7 folded into MP.4b; MP.12 joint | UR-07 | §25.8 |

### 25.11 Questions for the owner (MP.0b-3, with the refresh's UR.0b), and the architect's choices

**For the owner**, with `.cache/ui-refresh/rev2/sheets/owner-sheet.png`, `pins-threshold.png` and the
pin sheet:
- **P1. When quest pins take colour, and what the "11 px" of your decision G measures.**
  - (a) **From 16 px pins, with the pips in a tag beside the head** (revision 3.1). The "11 px" is
    measured on the shape that carries the colour: the glyph's box on a pin (0.70 of the head), the
    disc in a row. Colour then shows at the continent band too, as your decision G says.
    **Recommended, and the default.**
  - (b) From the zone band only (26 px pins), with the pips inside the head (revision 3). Fewer tags
    zoomed out, but no colour below the zone band: this would amend D-041 G.
  - Default: (a).
- **P2. Pins zoomed out.**
  - (a) Clusters with counts below the zone band, coloured when their quests share a difficulty.
    **Recommended.**
  - (b) MapGenie's way: every pin drawn, overlapping.
  - Default: (a).
- **P3. Services.**
  - (a) Light pins at 0.8 size. **Recommended.**
  - (b) Dark, like every other pin.
  - Default: (a).
- **P4. The Map layers drawer** (this also answers the refresh's decision C).
  - (a) **On the map's left, open by default where it docks (a map region of 900 px or more) and
    closed where it would cover the map; your last choice is remembered.** **Recommended.**
  - (b) The same, but always closed at first.
  - (c) On the map's right, where today's layer panel is.
  - Default: (a).

**The architect's choices** (the owner may overrule them):
- On the minimap, the palette follows the base style.
- The drawer's settings are kept per browser.
- The drawer's search replaces the Available tab's map filter.
- The rule for the navy's hue; the value itself is the atlas addendum's.
- Other-faction flight points are off by default (D-039).
- The node with no side in the client is drawn with a dashed edge.
- Zone borders only between land zones, and none at the world band.
- Flights zoomed in only for the hovered or selected flight point and the route.
- 300 pins per band.

### 25.12 Risks (new)

| # | Risk | Mitigation |
|---|---|---|
| R15 | Pins cover more of the base than marks did | Clusters zoomed out; stacks; the drawer hides any category; map focus. At the zone band pins are sized like MapGenie's, which the owner chose |
| R16 | The keyline looks heavy on the painted art | Where the body alone reaches 3:1 (71.8 % of painted pixels), the painted style can thin the keyline to 1 px: an MP.4a tuning with the owner |
| R17 | The pip tag widens pins and crowds dense views at the continent band | The tag is on the free side; clusters and stacks share one tag; P1 (b) remains the owner's alternative |
| R18 | The bitmap cache grows during continuous zoom | Size buckets; an LRU of 256; bitmaps sized to extent |
| R19 | The drawer and the UI refresh drift apart | One spec here (§25.3); the kit is the refresh's; the interface table (§25.3.9) |
| R20 | The minimap tiles or the navy differ from the probe | The contrast floor holds for any base colour; MP.2's test reruns on the committed tiles |
| R21 | Searching hidden categories surprises the user | The "(hidden category)" marker; "Clear search" restores the map |
| R22 | The `moveend` frame exceeds 16 ms at 4× on slower machines | The bookkeeping off the frame; the MP.1 gate and its fallbacks (§25.7) |
| R23 | Floating controls hide pins at the map's corners | 10 px margins; the controls are small; pans move content from under them; map focus gives more room |
| R24 | The `zone-borders` byproduct needs a terrain-tool change | A small derived file from committed inputs, with `--check`; until it lands, MP.7 draws no borders on the minimap rather than the stepped outlines |

### 25.13 Edits this revision needs elsewhere (for their owners)

- **DECISIONS:** an entry for revisions 3 and 3.1 (proposed as D-047), with P1 to P4 once answered.
  It includes the measure of D-041 G's threshold, worded once: "The 11 px of D-041 G is measured on the
  shape that carries the difficulty colour: a disc mark's diameter (route rows, quest lists, the
  drawer's key), or a pin's glyph box (0.70 of its head's diameter). The colour always comes with the
  pips beside it."
- **UI.md:**
  - §3: the §25.5 tokens and the width token; §3.2's "drawn on the well" becomes "on or under the
    well" (the refresh's discs put the colour under the well glyph).
  - §4: a row "Quest-pin difficulty (map)", and the rule naming the twin; "one symbol per concept"
    for step kinds and map categories.
  - §6: the map region's floating controls; the drawer, docked from a 900 px map region or over the
    stage; the toolbar and status line gone.
  - §9 rule 12: the drawer, the floating controls and search as keyboard paths; the caption in place
    of the status line.
  - §9 rule 9: pins under forced colours (§25.2.9).
  - §12: the drawer, persistence, the base style, search, the floating controls.
- **MAPS §7:**
  - §7.2: the pin budgets, cluster levels and caps on clusters.
  - §7.3: the draw order and `category`.
  - §7.5: pins replace the glyph families and plates.
- **ARCHITECTURE:**
  - §4: the `map/marks` module and who may import it.
  - §7: pins, clusters, stacks and the hit index.
  - §12.3: the settings record.
  - §14: the pin budget and the `moveend` bookkeeping.
- **D-032's byproducts:** the `zone-borders` file (MAPS §5 and the terrain tools' `--check`).
- **STATUS:** MP.0b-3 (with UR.0b), MP.2b and MP.4a to MP.4c in "Exact next tasks"; owner-decision
  rows for P1 to P4.
- **Tests:**
  - the pairs in `tests/ui-tokens.test.ts`, including the ring on its halo;
  - `style.test.ts`'s reserved-colour checks for the pin roles;
  - the `map/marks` rule in `tests/architecture.test.ts` and `tsconfig.pure.json` (MP.2b).

### 25.14 Sources (revision 3.1)

- **MapGenie:** the saved screenshots only (`.cache/map-presentation/mapgenie/shots/`, 2026-09-26).
  The pin size and colours and the sea colour were measured on them here. The site was not visited.
- **WoWF-QRP:** `.cache/ui-refresh/friend-ui.md` (HEAD `96f602b24ca9200855c27d6e31eb5a7e420aebf8`;
  `src/shell_head.html` and `src/app.js`, read one file at a time for the UI refresh's revision 1) and
  revision 1's `friend.md` (`378bed9e`). The site was not visited and nothing was fetched for this
  revision. No code was ported, so no D-029 notice is needed.
- **The review:** [docs/reviews/review-ui-refresh-design.md](../reviews/review-ui-refresh-design.md),
  with `.cache/ui-refresh/critic/` and `.cache/ui-refresh/critic-rules/`.
- **Client minimap textures:** the probe in `.cache/minimap-probe/` (build 1.60.1.70009, read-only
  through `tools/casc`).
- **Committed files:**
  - `public/maps/atlas/` (D-042);
  - `public/maps/client/taxi.json` (D-039 B; MP.5a, built and not yet committed);
  - `public/data/` (QuestieDB `b6f5b07`).
- **The mock and the measurements:** `.cache/ui-refresh/pins-mock/`, `.cache/ui-refresh/shared/`,
  `.cache/ui-refresh/rev2/` and `.cache/ui-refresh/ledger/` (§25.0).
