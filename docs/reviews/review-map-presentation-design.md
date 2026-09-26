# Review: map presentation design

Critique of [docs/research/map-presentation.md](../research/map-presentation.md). Several critics append their sections here; findings carry ids, a severity (blocker, major, minor or nit), evidence and a required change.

## Critic: project rules and engineering constraints (2026-09-26)

Scope: `docs/research/map-presentation.md` revision 1 against UI.md §1, §3, §4, §9, §12; MAPS §7;
ARCHITECTURE §7, §9.1, §14; D-018, D-022, D-024, D-028, D-029, D-032 to D-034; and the code
(read only). `docs/research/map-atlas.md` does not exist yet; the atlas team's
`.cache/map-atlas/code-impact.md` was used instead. Scratch checks are in
`.cache/map-presentation/critic/` (`state-census.ts`, `rings.mjs`). This critic could not open a
built-in-browser tab of its own (the tab cap was reached by other agents' tabs), so MapGenie was
checked against the saved screenshots only.

Census method (MEASURED): `state-census.ts` walks `tests/bench/bench-support.ts`'s realistic
route (600 steps, Orc Warrior, `priorHistory: fresh`) and classifies the 2,155 race/class quests
that have starters, with `createAcceptChecks` and `acceptTruth`, as §7.1 specifies. Node 22.13.1,
unthrottled.

| Before step | Level | Available | Low level | Uncertain | Locked (main cause) | Giver sets drawn by default |
|---:|---:|---:|---:|---:|---|---:|
| 0 | 1 | 129 | 0 | 4 | 2,022 (1,948 VAL004 min level) | 1,081 |
| 100 | 7 (lower bound) | 154 | 4 | 860 | 1,116 (1,046 VAL008 pre-quest) | 1,293 |
| 600 | 15 (lower bound) | 141 | 27 | 770 | 1,090 (1,014 VAL008) | 1,205 |

Classifying all of them took 4.1-8.0 ms on the first pass and 2.7 ms (median of 7) warm.
`walker.stateBefore` took 0.07 ms and returns a fresh copy on every call.

### Findings

**MP-R01 (major): the state rule does not draw fewer quest marks.** Evidence: the census above.
Locked quests are on by default (§7.2), so the zone band still draws 1,081-1,293 giver sets, about
as many as the race/class rule does today. Of those, 101-154 are available and the rest are hollow
or dashed triangles. The cut of `available-quests` from 600 to 400 (§5.2, §16.1) therefore rests
on an assumption that is false. Required change: split "locked" into level-only ("unlocks at level
N", hidden by default beyond a margin) and prerequisite-locked. Split "uncertain" by its doubt
code (a lower-bound level against history or prerequisites). Measure the counts per band on the
sample route and the realistic route before rebalancing, and keep 600 until that is done.

**MP-R02 (major): the zone-card counts and state-free views hide unknowns.** Evidence: "▲ a" counts
only quests whose `acceptTruth` is `'true'` (§7.4). With 770-860 quests uncertain, that count is a
lower bound (UI.md §1 principle 5, §4). `DerivedState.selected` is null while the pipeline loads,
after a failure and without a focus (`src/app/derived.ts`), and the design does not say what is
drawn then. Required change: show "≥ a" or "a · u uncertain". Without a state, fall back to
today's race/class rule, labelled as such, and never say "after step N".

**MP-R03 (major): where the state comes from, and what it costs.** Evidence: §7.1 takes
`stateBefore(active + 1)` and memoises "per state object". `RouteWalker.stateBefore` returns a
copy on every call (`src/engine/walker.ts` 51, 170-187), so an identity memo never hits. The
stable object is `DerivedState.selected.after`, which carries a `revision`. The zone cards (§7.4)
need every quest on the surface, which contradicts §16.2's "evaluate only surviving givers". The
classification alone takes 2.7-8.0 ms unthrottled, which comes to roughly 11-32 ms at the 4× CPU
throttle that §14 uses. Required change: read `selected.after`, keyed by (revision, stepId).
Compute the classification once per publish, in the lazy derived pipeline or a worker, not in the
map sync. Gate it with the proposed bench.

**MP-R04 (major): step numbers break the edit budget.** Evidence: §12.4 redraws the step layer on
every renumbering. In Leaflet's canvas renderer that is a whole-canvas redraw (3.3-3.5 ms at the
cap, MAPS §7.2), the pattern that M3 PERF-1 removed. The edit is already at its budget: map-paths
move 8.0 ms of 8 ms (PERF-09), and PERF-2 p90 is 8.7 ms (STATUS). Separately, "after step N" in
the texts of quest marks and zone cards (§6.1, §7.4) would put positions into descriptors (MAPS
§7.3). Required change: redraw the numbers after the edit is measured (in idle time or the next
frame), for beads in view only and under a cap, measured in `map-edit` and `map-paths`. All "after
step N" text goes through the label provider from the active step id.

**MP-R05 (major): the keyboard paths it claims do not exist.** Evidence: §14 relies on "the
Available tab (state-aware in Milestone 6)" and on its zone grouping. `src/ui/app/AvailableQuests.tsx`
works from the start level ("requires 42"): it has no step state, no locked reasons and no zone
groups. The ux-benchmark rows for these were never built. The top bar lists zone names only, so
the zone span and rating have no path at all (UI.md §9 rule 12). Required change: add a step
before MP.3 and MP.7 that makes the Available tab state-aware (available, locked and uncertain,
with reasons, grouped by zone, with each zone's span and rating).

**MP-R06 (major): the card's span has no basis on the canvas.** Evidence: the card shows "11-25"
and a well with the median level where readers expect an official range (§11.2 card layout). The
basis appears only in the hover text, next to "1-12 (official)" on Zephras Isle. The span is an Era
baseline, so the boxed-E marker applies (UI.md §4). Required change: put a visible basis on the
card, for example "quests 11-25", *n* and E. Style it differently from official text, and name the
chip's number as the median quest level.

**MP-R07 (major): the atlas is aligned too late.** Evidence: MP.1-MP.10 build on the single-map
`MapView` (`src/map/adapter.ts` 495) with per-map caps and memo keys. The atlas code-impact
(§1-§2, and §7 steps 2-3) changes these to `visible` bounds per placed map, an on-surface
predicate instead of `descriptorMapId`, ranking in atlas units, and one shared cap. `bandAt(zoom)`
assumes that the atlas unit is one map-1 yard, which is only the atlas team's assumption, and it
ignores the scale of an inset. `BaseMapLabels`, the insets and `connector` are also assumptions.
Required change: make the interface part of MP.11 a precondition of MP.1, or gate MP.1 on
`map-atlas.md`. Compute the band per placement from pixels per yard (zoom + log2 of the placement
scale). Write the new builders against the surface predicate.

**MP-R08 (major): contrast over the art fails for some states.** Evidence: the hollow flight
plate is "edge only, ink chevron" (§6.1). Its light #f2f2f2 edge disappears on light art and its
ink chevron on dark art, so the known/not-known cue loses 3:1 (WCAG 1.4.11). The 1.25 px network
lines have no halo, and the 40% low-level and dim glyphs fall below 3:1. Required change: every
plate state keeps the dark core and the light edge, and "not yet known" is carried by the glyph
or a badge. Give the thin lines a halo. Add a contrast test over sampled light and dark D-033 art,
in both themes.

**MP-R09 (minor): fades and skipped cards.** Evidence: the cards fade over 0.5 zoom at each end of
the continent band (§12.2). With `zoomSnap` 0.25, the resting zooms −5.25 and −3.75 show them at
about 50% opacity, which puts the text below 4.5:1. A card skipped for overlap is "still reachable
by hover", but frames are not interactive (MAPS §7.5). Required change: fade only between resting
zooms, or set an opacity floor that keeps 4.5:1. Count skipped cards in the layer notes
(MAP-HONEST-5) and in the adapter's stats.

**MP-R10 (minor): import rules.** Evidence: `map/leaflet` may import values only from
`map/adapter`, and `map/layers` only from `domain` and `geo` (`tests/architecture.test.ts` 96-97).
Required change:
- The difficulty twin must receive a computed result (difficulty key, level text, lower-bound
  flag) from `src/app/zone-levels.ts`, not compute the rating itself.
- Flight and transport times must come from the effective rules (`taxiSpeed`,
  `taxiSpeedBonusPct`, `flightMasterSeconds`, which the user can override), not the template
  constants.
- The band's hysteresis belongs in the controller, as a `MapView.band` input, so that the
  stateless builders stay deterministic (MAPS §7.6).
- Name the module that computes the pole of inaccessibility.

**MP-R11 (minor): mislabelled numbers.** Evidence:
- "33 Forever entrances (MEASURED)" (§5.2, §16.1): `data/dungeons-report.json` has 33 dataset
  entries with 39 entrance points. These include Black Morass, Old Hillsbrad, the five Season of
  Discovery maps, AQ20, AQ40 and Naxxramas. 23 entries with 29 entrances are LFG-listed, once LFG
  row 45 ("Onyxia") is matched; the report's name join missed it.
- The sizes in §16.2 are MEASURED, not CITED.
- "49 zone and city UiMaps (CITED)" is a count of the committed frames (26 + 23), so it is
  MEASURED.
- The plate contrast is 15.5:1, not 16:1.
- Difficulty green #40bf40 has saturation 0.498, not "0.5 or more" (§11.3).

Required change: correct these.

**MP-R12 (minor): the provenance of the instance allowlist.** Evidence: Era membership is in effect
the LFGDungeons rows at 70009 (`data.md` §4). The design calls these individual cited values that
need no decision, yet puts the tuning levels from the same rows to the owner (decision E). D-022
literally covers docs and tests; the shipped precedent is `src/rules/travel-seeds.ts`. Required
change: give each entry its basis (the LFGDungeons id and build, or the announcement for the four
new instances). Either cite the precedent or fold the allowlist into decision E/F.

**MP-R13 (minor): "not yet known" asserts knowledge.** Evidence: `knownFlightPaths` holds only the
profile's declared nodes plus the discover steps (`src/engine/state.ts` `knownNodeKeys`;
`steps.ts` 674). With `priorHistory: 'unknown'` a hollow plate claims a fact nobody has. Also, a
log entry with no objectives (a quest the dataset does not know) reads as "ready". Required
change: say "not known to the route" and use an uncertain state under an unknown history. A quest
with an unknown record is never shown as ready.

**MP-R14 (minor): hit order.** Evidence: `labels` sits above the quest, place and route-line
layers (§5.2). A clickable card of about 110 × 34 px would take hover and clicks from focused marks
and route segments (MAPS §7.3). Collision avoids only labels and plates. Required change: make the
cards non-interactive except for a small handle, or put them lower in the hit order, and let
collision also avoid focused marks and beads.

**MP-R15 (minor): line patterns.** Evidence: `network-flight` is dotted 1-4 at 1.25 px, against the
route flight leg dotted 1 6 at 2.5 px. `network-transport` is 8-4 at 1.25 px, against the route
transport leg 10 6 at 3 px, and both are muted ink (`style.ts` `LINE_STYLES`). With decision B the
two overlap and differ only by width. Required change: give the network its own pattern, and add
the key and style tests.

**MP-R16 (minor): search as focus.** Evidence: when every filter result becomes a focused quest
(§13), a broad query floods the caps, because focused items are kept first (MAPS §7.2), and
rebuilds the layers on every key. Required change: debounce, and focus only when there are at
most N results; above that, show a note with the count.

**MP-R17 (minor): the popover contract is not defined.** Evidence: a non-modal dialog moved through
with arrow keys is not covered by UI.md §9 rule 7 or by MAP-UX-3. Required change: define its
role, its Tab and arrow behaviour and what it announces in UI.md before MP.6.

**MP-R18 (minor): how the MapGenie evidence was gathered.** Evidence: `mapgenie/cdp.mjs` ran a
headless Chrome with `Runtime.evaluate` on MapGenie's page. The §3.2 engine and style facts ("one
symbol layer", "region polygons present but off") come from that inspection, not from the built-in
browser that the owner allowed. Screenshots 02 and 12 confirm the visible claims (the inset
south-west of Kalimdor, the struck-through hidden categories, the flight pins coloured by side).
Required change: mark the inspected facts as such or drop them, and ask the owner whether
automated access falls within the allowance. No legal conclusion is drawn here.

**MP-R19 (nit): decision B columns.** Evidence: the `data.md` node row carries mount creature ids
that no layer or TIME-6 uses. Its 5.0 kB was measured over 98 nodes, not the 67 on paid paths.
Required change: ship only the columns used, list them in the manifest, and call 5.0 kB an upper
bound.

**MP-R20 (nit): the sources.** Evidence: Blizzard's UI Lua (the Gethe mirror) sits in
`data/ui-source/`, and D-029's licence was checked at `c1e3fcf`, while the code was read at
`378bed9e`. Required change: §23 says that the Lua was read for behaviour only, nothing was ported
and it is kept out of the repository. Any WoWF-QRP port records the licence at the commit it
comes from.

Checked and sound: every new token is achromatic and the hue analysis is correct (215°, 231°,
267°, 320°; allowed ranges 150-162° and 212-330°). No diamond is used. WoWF-QRP's zone colouring is
correctly identified as biome-based, and none of its data is used. Decisions A to F are put to the
owner with defaults. Terrain zone rings can be assembled: every one of the 28 + 26 zones in
`zones.json` closes from its arcs (`rings.mjs`). The budget sum is 2,500.

## Critic: project rules and engineering constraints, second pass (2026-09-26, evening)

Scope: the same revision 1 (unchanged since 17:56), now also against D-039 (owner decisions A to
F, recorded in DECISIONS and STATUS after the first pass). `docs/research/map-atlas.md` still does
not exist. The code the first pass cited is unchanged (`src/map`, `src/app/map-model.ts`,
`src/engine/walker.ts`, `tests/architecture.test.ts`), so MP-R01 to MP-R20 stand as written. New
scratch checks in `.cache/map-presentation/critic/`: `objective-points-dist.ts`,
`log-points-census.ts` and `log-size.ts` (Node 22.13.1, committed dataset, read only). MapGenie was
not reopened; the §3.2 claims about zoom 12 match screenshot `03-kalimdor-z12.png`.

### Findings

**MP-R21 (major): objectives of every log quest overflow the budget that §5.2 cuts.** Evidence
(MEASURED, `objectiveModel` over all 4,257 quests): objective points per quest have a median of 1,
p75 21, p90 116 and a maximum of 7,829. The first ten quests by id of a zone's level band give
1,459 points (The Barrens, 10-20), 6,132 (Elwynn Forest, 1-12) and 297 (Durotar, 1-12); twenty
Westfall quests (9-18) give 2,082. §16.1's basis, "about 70 points for one quest", is one sample.
§7.3 widens the layer from the focused quests to a log of up to 40 while §5.2 cuts its budget from
500 to 330. Over the cap the points nearest the centre survive, so dim dots fill the middle of the
view and its edges look empty. The realistic bench route cannot show this: its log holds 0 quests
at 139 steps and 1 at the other 462 (`log-size.ts`), so the MP.3 bench and the MP-R01 census never
see a real log. Required change: draw only the focused quests' objectives raw; aggregate the other
log quests' objectives (one mark per quest and target per zone, with a count). Add a bench fixture
with 10-20 concurrent quests, measure the in-view counts at the zone band, and keep 500 until then.

**MP-R22 (major): the Forever instance allowlist omits most announced new instances.** Evidence:
forever-game-rules §5.3 lists nine official new dungeons (`CONFIRMED`, S2), and its timeline lists
the Barrow Deeps and Hyjal Summit raids (`CONFIRMED`, S2). `data.md` §4 names Blackmaw Hold,
Krol'dok Stronghold, Shaper's Terrace, Drowned City and Alcaz Prison (no Map row), and Half-Pint
Tavern (3002) and Manor Mistmantle (3109) (instance maps with no LFG row). §8 allows "the four new
instances", and its "not drawn, counted" note names only those four. Five announced dungeons and
two raids would disappear without a count (UI.md §1 principle 5; MAP-HONEST-5). Required change:
list all nine dungeons and both raids with their source and what is known (area id, map id or
none). Name every one without an entrance in the layer's notes. Hide and count Half-Pint Tavern and
Manor Mistmantle as UNKNOWN, as decision F does for the raids.

**MP-R23 (major): the step plan does not meet D-039's rule for committed client tables.** Evidence:
D-039 says every committed client table has a manifest, a NOTICE and reproducible extraction with
`--check`. Only MP.8 (taxi) has an extraction tool, a manifest and a byte-identical `--check`. MP.10
("faction rows in `public/maps/client/`") names no tool, manifest or `--check`. Decision E
(`LFGDungeons` → `ContentTuning`, 30 rows) has no step at all, although MP.5 and §8 display it.
Required change: one extraction tool through `tools/casc` for B, C and E. Each table records its
FileDataID, CKey, the WoWDBDefs commit and the tool tree hash, and has a `--check`, the dist-audit
budget and the NOTICE. Add E to the plan before MP.5.

**MP-R24 (minor): the design still reads as undecided, and older decisions conflict with D-039.**
Evidence: §22 and §0 say "until the owner decides" and recommend. D-022 still says bulk client
tables stay local and taxi timings are local-only; D-024 makes the straight-line model the default.
D-039 carries no "Supersedes" line, and §21 does not ask for Status lines. Required change:
revision 2 records D-039 (A closed; B, C and E committed; D and F defaults) and keeps the
without-B paths only as load-failure fallbacks. §21 adds Status lines to D-022 and D-024 pointing
to D-039.

**MP-R25 (major): the budget claims rest on a measurement of other content.** Evidence: §16.1 says
the total stays within the 2,500-path cap, "measured at 3.3-3.5 ms" (MAPS §7.2, today's glyphs).
`perf.md` measured up to 6 ms of re-projection plus 7 ms of redraw per `moveend` at 4× in ordinary
views: 13 ms of the 16 ms budget. The design adds costlier paths: plates with an edge and an inner
glyph, dashed outlines (switching the dash pattern), badges and pills, and up to 110 cards. Each
card counts as one path but draws two lines of halo text (`strokeText` and `fillText`), a chip well
and five pips. The target "no frame over 50 ms at 4×" at the −3.5 crossing is a new budget that
ARCHITECTURE §14 does not contain. Required change: extend the §7.2 harness to the new glyph mix
and labels at the cap, at 1× and 4×, before MP.4 fixes the sizes. If it is over budget, draw cards
and plates from cached bitmaps keyed by text and theme. Label §16.1 ASSUMPTION until measured.
Either meet 16 ms at the crossing, or record a new budget in ARCHITECTURE §14 and DECISIONS.

**MP-R26 (minor): label collision runs at `moveend` only, but its inputs change without a move.**
Evidence: the card texts ("▲ a · ■ t" and the chip) change with the active step and with edits.
The priorities ("the selected step's zone", "zones the route visits", §12.2) change with the
selection and with edits. Required change: give cards a fixed width (reserve room for the widest
count), so that content changes never move them. Make priority independent of the selection, or
re-run collision in idle time after a change, and measure it.

**MP-R27 (minor): painted names replace ours with no size or contrast guarantee.** Evidence: §12.3
drops our labels wherever the base map "carries" a name. Painted text has no contrast control
(UI.md §9 rule 1). On the atlas, mosaics and continent paintings are drawn below native scale at
most zooms, and are cross-faded, so painted names can be a few pixels high. Required change:
`BaseMapLabels` reports a class only where the art is drawn at full opacity and at or above a stated
fraction of its native scale. Otherwise ours are drawn.

**MP-R28 (minor): glyph and badge collisions.** Evidence: MAPS §7.5 already uses a dashed ring
around the glyph for off-frame, a small square at the top right for instance, and a round badge at
the bottom right for a stack. §6.1 draws event-area objectives as a bare dashed ring, and puts both
the dungeon-quest arch and the "×n" pill at the top right. Required change: give event areas a shape
of their own and one slot per badge. Test a marker that carries every badge, with `glyphExtent`
covering all of them.

**MP-R29 (minor): the level chip ignores who can take the quests.** Evidence: §11.2 counts every
quest with the zone's `zoneOrSort`, of both factions and every race and class (The Barrens "98" in
`data.md` §2), but rates the result against the character. In zones with faction hubs, the other
faction's quests shift the span and the median (Hillsbrad 24-40, Duskwood 24-35). The thresholds
*n* ≥ 10 and a spread of at most 15 carry no label. Required change: compute over the quests open
to the character's race and class, and say so ("of 61 quests open to an Orc Warrior"). Apply
*n* ≥ 10 to that count, and label both thresholds ASSUMPTION.

**MP-R30 (minor): conflicting and duplicate tuning rows.** Evidence (`data/dungeons-report.json`):
Ruins of Lordaeron's LFG row 3272 has tuning level 15 but `LfgMin`/`LfgMax` 27. Excavation Site:
Wetlands has two rows (67 at level 0, 3274 at 26). §8 and §22 E show "one number" without the rule
for choosing it. Required change: record in the committed file which row and column each number
comes from. Where the row contradicts itself, either say so in the hover and popover or show "?"
with the reason, as the owner prefers under D-039 E.

**MP-R31 (minor): a faction mask of 0 does not mean "contested".** Evidence: `data.md` §2 records
`FactionGroupMask` 0 as "none (contested or unset)" for 37 zones, including every battleground and
the five new zones, and 6 as "both" (City of Dalaran). §5.3's `pattern` and §11.4 map 0 to
`'contested'` and have no case for 6. Required change: say "no faction territory in the client
(contested or unset)" for 0, handle 6, and never say "contested" from the mask alone.

**MP-R32 (minor): inferred dock positions reach the travel model.** Evidence: D-039 B says the
committed stops close the NAV-08 dock gap, but §10 matches stops to services by inference, reviewed
by hand. Required change: each dock carries the basis `inferred` and its matching record in the
TravelGraph and in leg texts. Unmatched stops never feed the engine.

**MP-R33 (nit): the dungeon chip.** The "available" count in "log 2 · available 1" leaves out
uncertain quests, as MP-R02 describes. Apply the same fix.

Checked and sound (second pass): one side's flights fit the `flight-network` budget on the atlas
(130 + 156 directed flights, so at most 143 node pairs, against 150). Turn-in points per quest have
a median of 1, p90 1 and a maximum of 111, so 120 holds for typical logs. The zone range texts
match forever-game-rules §5.1 (Zephras Isle 1-12, Riverglades mid-30s to mid-40s, Hyjal
"reported", Shen'dralas unknown). The log capacity of 40 is the ruleset's `client-data` value
(VAL-20). The design follows D-039 A: no game icons.

## Critic: the owner's point of view (2026-09-26, night)

Scope: revision 1 read as the owner would read it: does it deliver what he liked in WoWF-QRP and
MapGenie (quests, dungeons, flight paths, zone colouring on the zoomed map), and is it easy to read
at each zoom? D-039 (owner decisions A to F) is taken as settled. Scratch checks are in
`.cache/map-presentation/owner-review/`: `counts.cjs` (dataset dungeon-quest spans, service NPCs),
`cards.cjs` (zone-card collisions), `fit.txt` and `live-observations.txt`.

Live look (built-in browser, read-only tools, no scripts on either site). WoWF-QRP, header
"v2026.09.26-2017": one 1440 × 900 frame at about 0.09 px per yard (our zoom about −3.5) showed
opaque biome tints, zone names with ranges ("Tanaris 40-50"), named Horde flight points (red
diamonds) and named dungeons (purple spirals). Its "Map layers" panel now has 11 rows, including
"Towns" and "Vendors, trainers & graveyards (zoomed in)". The studied commit had 10. MapGenie: the
pane was hidden, so the WebGL map never drew and no zoom could be observed live. The text shows 22
categories with counts, among them Quest 190, Instance 29, Flight master (neutral) 72, Transport 28,
Class trainer 175, Merchant 148, Innkeeper 9 and Graveyard 30. After the first frame, every
screenshot timed out ("the Browser pane is not displayed"). Zoom-level evidence therefore comes from
`friend/shots/` and `mapgenie/shots/`, and none could be saved from the built-in browser.

### Findings

**MP-O01 (blocker): the design misreads WoWF-QRP's locked rule.** Evidence: WoWF-QRP draws a locked
giver only when the quest is prerequisite-locked, its level is above grey and at most the
character's level + 4, and it is not a follow-up of a quest in the log (`app.js` 329 and 333 at
`378bed9e`). Level-locked quests never reach its map. They appear only in the Available tab, as
"Unlocks at level N" (843, 854). So `01-world-all.png` at level 1 shows marks in Mulgore and Durotar
only. §7.2 says "so is ours", but it draws every locked quest: 1,081-1,293 giver sets against
101-154 available ones (MP-R01 census). The zone band would be covered in hollow triangles, the
opposite of the clean map the owner praised. Required change: by default, "Locked quests" uses
WoWF-QRP's relevance window. Level-locked quests go in a separate row, "Unlocks soon (within N
levels)", off by default. Split "uncertain" by its doubt, as MP-R01 asks. Measure the marks in view
per band on the sample route and put screenshots in the design.

**MP-O02 (major): there are no quest marks at the continent band.** Evidence: WoWF-QRP draws every
available and turn-in mark at "All" (s 0.028; `01`, `03`, `08`), and MapGenie every pin at z10-12.
That is where the owner sees where to go next. §5.4 and §7.2 give counts in zone cards instead,
and MP-O03 shows that the cards are often skipped. Under MP-O01's window, about 100-150 marks are
available, well inside the cap. Required change: at the continent band, draw available and
ready-to-turn-in marks raw at 7-9 px, with the counts as a supplement. Aggregate, with a label,
only above the cap.

**MP-O03 (major): the both-continents view names fewer than half the zones.** Evidence: in a
918 px panel (`ours.md`), fitting the land of both continents gives 0.0239 px per yard, zoom −5.39
(`fit.txt`). That is at the world edge, where the design draws no zone names at all (with
`zoomSnap` 0.25 and hysteresis, it stays in the world band). At WoWF-QRP's "All" scale (0.028),
110 × 34 px cards anchored at frame centres, placed greedily by area, fit 28 of 49 zones (19 at
0.022, 37 at 0.05). Mulgore, Darkshore, Loch Modan, Duskwood, Redridge and Un'Goro are among the
zones dropped (`cards.txt`). WoWF-QRP names every zone with its range. Required change: below
about 0.05 px per yard, use a compact one-line label (name and span), and use the full card above
that. Draw the compact labels from the fit-both view. Acceptance: every levelling zone is named at
the fit-both view in a 900 px panel, measured.

**MP-O04 (major): nobody owns the zone colouring.** Evidence: §11.1 and §11.3 leave colour to the
atlas and call the close-zoom tint "a suggestion". The atlas prototype at −5.5
(`design-fidelity-first/fin-z-5.5-world.png`) shows uniformly gold continents. Zone colours appear
only as the mosaic fades in (`pv2-z-5-both.png`). The owner named colouring explicitly. Required
change: agree an acceptance criterion with `map-atlas.md`: every zone can be told apart by colour
from the fit-both view to close zoom, checked in MP.12 against WoWF-QRP `01`/`03` and MapGenie
`03`. If the atlas does not deliver it, this design owns the art-sampled tint. State how "colours
the zoomed map" is read, and confirm that reading with the owner.

**MP-O05 (major): the map turns monochrome, and the owner was not asked.** Evidence: P3 and §6.2
spend no hue at all, and R10 admits the cost. D-039 A settled the source of the icons, not colour.
Both benchmarks separate categories at a glance by colour. Our rules reserve two hue families and
forbid colour-only cues; they do not forbid colour. Required change: put an owner decision with a
mock: (a) monochrome, the default; (b) quest marks coloured by difficulty through the twin, the one
hue the rules give quests (D-039 "only for difficulty"), with the pips or the hover as the
non-colour cue; (c) a redundant category tint that passes the hue tests.

**MP-O06 (major): places cannot be told apart at the continent band.** Evidence: in §6.1 every
place is the same dark rounded plate of 11-12 px, differing only by a glyph of about 7 px. WoWF-QRP
uses a purple disc against a red diamond; MapGenie uses pin colours. Required change: give each
family its own plate silhouette (round, square, hull; no 45° diamond), test it at the smallest
size, and show dungeon names from about 0.05 px per yard, as WoWF-QRP does.

**MP-O07 (major): dungeon level ranges exist without a new decision.** Evidence: §8 and §18 say
"no sourced range exists". The §11.2 method applied to dungeon quests (`zoneOrSort`, `counts.txt`)
gives Wailing Caverns 16-22 (*n* 9), Deadmines 17-22 (5), Scarlet Monastery 33-40 (7), Uldaman 40-45
(29) and Blackrock Depths 52-59 (41). MapGenie shows "Level 15-25". Required change: show "quests
16-22 (9 dataset quests, E)" in the hover and the popover, beside D-039 E's number, with the twin
rating the median, as for zones.

**MP-O08 (major): services are left out.** Evidence: the live WoWF-QRP added "Vendors, trainers &
graveyards". Most of MapGenie's categories are services. The dataset has 47 innkeepers, 499
trainers and 157 vendors (`counts.txt`), and MAPS §8.1 lists innkeepers and trainers as points of
interest. Routes have hearth, train and vendor steps. Required change: add a services layer at the
zone and close bands (innkeepers, the character's class trainers, and vendors where the dataset has
them), with "Set hearth / Train / Buy after step N". Graveyards only from a sourced table (owner).

**MP-O09 (major): the change of band pops.** Evidence: at −3.5 the cards give way to raw marks
(§5.4). Glyph sizes jump from 9 to 13 to 16 px. Only labels fade (§12.2). Crossing −3.5 already
takes 26.6 ms at 4×. Flow is the owner's first complaint. Required change: fade the marks in while
the cards fade out, and interpolate glyph sizes with zoom. Verify both in MP.12 by recording a
zoom sweep.

**MP-O10 (major): objectives of different quests cannot be told apart.** Evidence: our `06` shot
shows about 70 identical dots, while WoWF-QRP's `07` shows one colour cluster per quest. §7.3
offers hover and focus only. Required change, together with MP-R21: at the zone and close bands,
draw each log quest's objectives as a faint outline, labelled at its centroid with the number of its
complete step.

**MP-O11 (minor): the popover lacks WoWF-QRP's route-building actions.** Evidence: WoWF-QRP's
`05c` offers "Fly to Thunder Bluff", "Go to" and a Wowhead link, and its objectives are clickable
(`07e`). §13 gives objective dots no action, and "no external links" cites no rule. Required change:
add "Complete objectives after step N", "Go here after step N" and "Fly from the nearest known
point". Ask the owner about the Wowhead link.

**MP-O12 (minor): the route after the active step looks the same as before it.** Evidence:
WoWF-QRP draws the route solid up to the selected step and faint and dashed after it. MAPS §7.4
has no such split. Required change: dim and dash the route after the active step, with a key entry,
measured in `map-edit`.

**MP-O13 (minor): the zone name and range vanish at the zone band.** Evidence: the cards are gone
by −3.5. WoWF-QRP keeps "Mulgore 1-10" to about 0.14-0.26 px per yard (`07`), and the painted art
does not name its own zone. Required change: keep a zone label to about −2, or add a fixed
"Viewing" chip.

**MP-O14 (minor): a hollow and a dashed triangle look alike at 12 px.** Evidence: §6.1 shows
"locked" and "uncertain" as outline and dashed outline. Required change: give "uncertain" a small
"?" badge (our unknown glyph, UI.md §4; turn-ins are squares), tested at 12 px.

**MP-O15 (minor): the owner has not seen what "our glyphs" look like.** Evidence: §18 grades
"beats" in 14 rows with no image of the proposal, and MP.12 comes last. Required change: MP.0b, a
static mock of the four bands over the atlas prototype, beside the benchmark shots, for the owner
before MP.1.

**MP-O16 (nit): the benchmark has moved on.** Record the WoWF-QRP version studied, and re-check
before MP.12.

**MP-O17 (nit): the layer panel is not the legend.** Required change: show each row's glyph, as
MapGenie does.

## Resolutions: revision 2 of the design (2026-09-26, night)

Revision 2 of `docs/research/map-presentation.md` answers every finding above. No finding is
rejected outright. Three are accepted in part, and the part not taken is explained in its row
(MP-O04, MP-O10, MP-O17). Where a finding offered alternatives, the row says which one was taken.
New evidence is in `.cache/map-presentation/rev2/` (see its `README.txt`): a census of quest marks
under the relevance window, objective counts for 10- and 20-quest logs, zone and dungeon spans per
character, and a static mock (our own drawing code over the committed D-033 art) with label-fit,
zone-colour and draw-cost measurements and screenshots of the four bands, the colour options, the
glyph sheets and the benchmark comparison sheets. The revision has not had an independent critique
yet; step MP.12 plans one, and MP.0b puts the mock to the owner first.

Section numbers in this table are revision 2's.

| Finding | Severity | Resolution | Where |
|---|---|---|---|
| MP-O01 | blocker | Accepted. WoWF-QRP's relevance window, re-implemented from its behaviour: prerequisite-locked quests drawn only when their level is above grey and at most level + 4 and they do not follow a log quest; level-locked quests within 3 levels go to an "Unlocks soon" row, off by default; the rest are counted by reason. Uncertain split by its doubt, each with the same window. MEASURED over twelve route states: 131 to 373 default giver points on both continents, against 590 to 912 under revision 1's rule; in view per band 23-128, 12-79, 1-41 and 0-12. Screenshots of all four bands. | §7.2, §7.3; `rev2/census.json`; `rev2/shots/band*.png` |
| MP-O02 | major | Accepted. Marks at every band, 6 px at the fit-both view growing continuously to 10 px at the top of the continent band (a range rather than a fixed 7-9 px, for MP-O09); counts move to the hover and status line; aggregates only for the surplus over a cap. | §5.4, §6.1, §7.3 |
| MP-O03 | major | Accepted. Compact one-line labels (name, span, boxed E) below 0.05 px per yard, with leader lines; cards above, falling back to the compact label. MEASURED with Chrome's text metrics: 49 of 49 zones and cities named at the fit-both view (0.0239) and at 0.028 to 0.045; 48 of 49 at 0.022 (Redridge Mountains), which MP.7 tunes. Acceptance test in MP.7. | §13.3, §13.4; `rev2/results/labels.json` |
| MP-O04 | major | Accepted in part. The design now owns the zone-colour acceptance criteria (colour identity at every band, the same colour at every zoom, visible boundaries), agreed with `map-atlas.md` in MP.0c, and a fallback tint drawn where the base map fails them; the owner is asked what "colours the zoomed map" means (question H). **Not taken:** a rule that neighbouring zones must differ strongly in colour on the painted art itself. MEASURED: the art's own neighbouring zones differ by a median of 8.7 (CIEDE2000), 57 of 94 pairs under 10; they are told apart by painted borders and texture, and enforcing the rule would mean tinting over the art the owner chose (D-033). The strict rule applies to the fallback tint, which reaches a median of 15.2 and a minimum of 9.1. | §12.2 to §12.4; `rev2/results/tint.json`; `zone-colour-base.png` |
| MP-O05 | major | Accepted. New owner decision G with a mock: monochrome (default), quest marks in the difficulty colour with pips from 11 px (recommended), one category hue at 159.5° (not recommended: 40° from difficulty green). | §6.3, §23.2 G; `decision-G-colour.png` |
| MP-O06 | major | Accepted. One silhouette per place family: disc (dungeon; ringed for raids), rounded square (flight point), flat-topped hexagon (transport), oval (portal); services a light square. No 45° plate. Drawn at the smallest size (9 px) on light and dark art in the glyph sheets. Dungeon and flight-point names from 0.05 px per yard. | §6.1, §5.4; `sheet-light.png`, `sheet-dark.png` |
| MP-O07 | major | Accepted. Dungeon-quest span over the quests open to the character (MP-R29), with count and E, beside D-039 E's number, shown from 5 quests and rated by the twin from 10 quests and a spread of at most 15 (labelled ASSUMPTIONs). MEASURED table for an Orc Warrior. | §8.4; `rev2/dungeon-spans.json` |
| MP-O08 | major | Accepted. A services layer: innkeepers and the character's class trainers from zoom −2.75, vendors at the close band, with "Set hearth", "Train" and "Buy" after step N. The note says the dataset's vendors are only those tied to quests. Graveyards need a sourced table: owner question I. | §11, §23.2 I |
| MP-O09 | major | Accepted. No aggregate flip for quest marks; sizes continuous with zoom; labels and step numbers on their own canvas; a 140 ms time-based cross-fade at band changes (none under reduced motion), so nothing is half-faded at rest; idle-time pre-building; a recorded zoom sweep in MP.12. | §5.5, §20 |
| MP-O10 | major | Accepted in part. Outlines for every log quest, labelled with the number of the step that completes it ("t 22" when D-040 carries the work to the turn-in; none when the route does not complete it). **Changed:** one outline per group of 5 or more points on a 90 yd grid, not one outline per quest, because item drop sources spread a quest's points across a zone or a continent (335 of the Elwynn log's points are on other maps) and a single hull would cover the zone. MEASURED: 8 to 20 outlines in view. | §7.4; `rev2/log-objectives.json` |
| MP-O11 | minor | Accepted. "Complete objectives after step N", "Go here after step N" and "Fly from the nearest known flight point" added. Revision 1's "no external links" had no basis; the Wowhead link is owner question J (recommended yes). | §14.2, §23.2 J |
| MP-O12 | minor | Accepted. The route after the active step is dashed and at 55%, with its halo and a key entry; the dash is the cue; measured in `map-edit`. | §13.6 |
| MP-O13 | minor | Accepted, both options: zone labels to about zoom −1.75, then a DOM "Viewing" chip with the real `DifficultyLabel`. | §13.5 |
| MP-O14 | minor | Accepted. Uncertain states carry a "?" badge (bottom-left slot); tested at 7 px and 10 px in the glyph sheets. | §6.1 |
| MP-O15 | minor | Accepted. The static mock of the four bands, the colour options and the glyph sheets exists now, with comparison sheets beside the benchmark shots; MP.0b puts it to the owner before MP.1. Its base is the committed zone art clipped to the terrain zones, a stand-in for the atlas; the atlas prototypes appear in the zone-colour sheet. | `rev2/shots/`, §20 MP.0b |
| MP-O16 | nit | Accepted. Version recorded ("v2026.09.26-2017", read by the owner-view critic); re-checked at about 23:00 with read-only tools: the version element exposes no text to them; 11 layer rows; new route actions for deathskip, training and vendors. MP.12 re-checks. | §3.1 |
| MP-O17 | nit | Accepted in part. UI.md §12 already has each layer row show its glyph; the new rows follow that rule, and hidden rows are struck through. Nothing else to change. | §14.3 |
| MP-R01 | major | Accepted, with MP-O01. Level-only and prerequisite locks split, uncertain split by doubt, counts measured on the realistic route (600 and 10,000 steps, fresh and unknown history) before rebalancing; `available-quests` is 450 at the world and continent bands and 300 at the zone and close bands, against measured maxima of 373 and 79. | §7.2, §7.3, §5.2 |
| MP-R02 | major | Accepted. Uncertain quests are counted apart ("3 may be available"), never folded into the available count; without a state the map uses today's rule, labelled "no route state yet", and never says "after step N". | §7.1, §7.3 |
| MP-R03 | major | Accepted. The state is `DerivedState.selected.after`, keyed by (revision, step id); the classification runs once per publish in the derived pipeline and is published as a model; `map-state.bench.ts` gates it. | §7.1 |
| MP-R04 | major | Accepted. Step numbers live on the labels canvas and are redrawn after the edit, in idle time or the next frame, for beads in view only, at most 150; the edit and the renumbering are measured apart in `map-edit` and `map-paths`. Every "after step N" goes through the label provider. | §13.6, §5.3 |
| MP-R05 | major | Accepted. MP.3 builds the state-aware Available tab (classes, reasons, zone groups with span and rating) and the top bar's spans before any map layer depends on them. | §14.4, §20 |
| MP-R06 | major | Accepted. The span always shows its basis on the canvas ("quests 13-25 (93)" and the boxed E); official text is worded as such; the chip is named the median quest level in the key and hover. | §12.5, §13.3, §13.4 |
| MP-R07 | major | Accepted. MP.0c agrees the atlas interface (placements with scale, insets, surface predicate, `visible`, connectors, `BaseMapLabels`) before MP.1; bands come from each placement's pixels per yard; builders use the surface predicate. | §5.1, §18, §20 |
| MP-R08 | major | Accepted. Every plate keeps its dark core and light edge; "not known" is a dashed edge and an outlined glyph; thin lines have a 3 px halo; no glyph is faded (low level is smaller); an art-sampling contrast test in both themes (MP.2). | §6.4 |
| MP-R09 | minor | Accepted. Fades are time-based at band changes, so every label is opaque at rest; skipped labels are counted in the notes and the adapter's stats. | §5.5, §13.2 |
| MP-R10 | minor | Accepted, all four: the twin receives a computed result from `src/app/zone-levels.ts`; times come from the effective rules; hysteresis is in the controller as `MapView.band`; the pole of inaccessibility is `src/geo/pole.ts`. | §5.1, §5.3, §9, §12.5 |
| MP-R11 | minor | Accepted; corrected: 23 LFG-listed entries with 29 entrances (Onyxia matched by row id), sizes MEASURED, 49 frames MEASURED, 15.5:1, green's saturation 0.498 (the tint cap is now 0.29). | §5.2, §6.2, §8.1, §12.4 |
| MP-R12 | minor | Accepted. Membership comes from the committed LFG table (D-039 E), each entry with its row id, and from the official announcement for the new instances. | §8.1, §16 |
| MP-R13 | minor | Accepted. "Known to the route" and "not known to the route"; "may be known" with "?" under an unknown history; a log entry with no objective record is never "ready". | §6.1, §7.5, §9 |
| MP-R14 | minor | Accepted, first option taken: labels and cards are wholly non-interactive (their own canvas takes no hits), so no handle is needed; an empty click at continent zoom still jumps to the zone. Collision avoids focused marks and the active and selected beads. | §5.2, §13.2 |
| MP-R15 | minor | Accepted. `network-flight` thin solid with a halo, `network-transport` thin 3-3 dash with a halo, both unlike the route's flight (dotted 1-6, 2.5 px) and transport (10-6, 3 px) legs; key and style tests. | §6.1 |
| MP-R16 | minor | Accepted. Debounced by 250 ms; the map focuses results only when there are at most 20, otherwise a note with the count. | §14.3 |
| MP-R17 | minor | Accepted. The popover's contract (non-modal dialog, arrow keys, Tab leaves and closes, Escape returns focus, what it announces) goes into UI.md §9 before MP.6. | §14.2 |
| MP-R18 | minor | Accepted. The facts that came only from script inspection are marked INSPECTED and carry no design weight; the rest are tied to screenshots; the owner is asked (question K). Every look in this revision used read-only tools only. | §3.2, §23.2 K |
| MP-R19 | nit | Accepted. Only the columns used are shipped and listed; no mount ids; 5.0 kB is an upper bound. | §16 |
| MP-R20 | nit | Accepted. §24 says the Lua was read for behaviour only, nothing was ported, and it stays out of the repository; a port records the licence at its commit. | §2, §24 |
| MP-R21 | major | Accepted. Focused quests raw; other log quests one counted mark per quest, target and zone; outlines; `objectives` stays at 500 at the zone and close bands; MP.3 adds a 10-20 quest log fixture. MEASURED over seven logs: 457 to 2,258 raw points; focused raw 44 to 543 in view; 18 to 51 counted marks. | §7.4, §5.2 |
| MP-R22 | major | Accepted. All nine announced dungeons and both raids listed with source and what is known, every unplaced one named in the notes; Half-Pint Tavern and Manor Mistmantle hidden and counted as unknown. | §8.1 |
| MP-R23 | major | Accepted. One extraction tool (`tools/maps/client-tables.ts`, through `tools/casc`) for B, C and E, each table with FileDataID, CKey, build, WoWDBDefs commit and tool tree hash, `--check`, a dist-audit budget and the NOTICE; MP.5a precedes MP.5. | §16, §20 |
| MP-R24 | minor | Accepted. D-039 recorded as settled; the "without B" paths kept only as load-failure fallbacks; §22 asks for Status lines on D-022 and D-024 and a "Supersedes (in part)" line on D-039. | §9, §22, §23.1 |
| MP-R25 | major | Accepted. A first measurement in the mock (canvas drawing of the new mix at the cap: 2.6-2.9 ms at 1×, 12.6-12.8 ms at 4×; 9.0-9.8 ms with bitmaps for plates and cards), labelled as such; bitmaps for plates and cards from MP.4; the Leaflet harness at 1× and 4× in MP.1, before sizes are fixed. Of the two options for the crossing, the second is taken: a new budget ("no frame over 16 ms at 1×, no long task over 50 ms at 4×") is recorded in ARCHITECTURE §14 and DECISIONS by MP.0, and tightened if MP.1 meets 16 ms at 4×. | §17.2, §17.4 |
| MP-R26 | minor | Accepted. Fixed card widths, a static priority, placement at `moveend` only. | §13.2, §5.3 |
| MP-R27 | minor | Accepted. `BaseMapLabels` reports a class only where the art is at full opacity and at or above 0.75 of its native scale (ASSUMPTION, agreed in MP.0c). | §13.5 |
| MP-R28 | minor | Accepted. The event area is a plus sign; one slot per badge (top left arch, top right instance, bottom left "?", bottom right "×n", ring off-frame); below 10 px only "?" and "×n"; a mark with every badge in the glyph sheets and in `glyphs.test`. | §6.1 |
| MP-R29 | minor | Accepted. Spans over the quests open to the character's race and class, said in the hover; thresholds labelled ASSUMPTIONs. MEASURED, for example Duskwood 24-35 (76) over all quests against 4 quests for an Orc Warrior. | §12.5, §8.4; `rev2/spans.json` |
| MP-R30 | minor | Accepted. The committed file records each number's row and column; Ruins of Lordaeron shows "?" with the reason (its row gives both 15 and 27); Excavation Site: Wetlands takes row 3274 (26), naming row 67 (level 0, none set). | §8.4 |
| MP-R31 | minor | Accepted. 0 is worded "no faction territory in the client (contested or unset)" with no pattern; 6 is handled with cross-hatching; "contested" is never said from the mask alone. | §12.6 |
| MP-R32 | minor | Accepted. Each inferred dock carries `basis: 'inferred'` and its matching record in the TravelGraph and leg texts; unmatched stops never feed the engine. | §10 |
| MP-R33 | nit | Accepted. The chip reads "log 2 · available 1 · uncertain 1". | §8.5 |

Owner decisions still needed after revision 2 (§23.2 of the design): G (colour of the marks;
recommended: difficulty colour with pips), H (the reading of "colours the zoomed map"; recommended:
the painted art's colours at every band, with the fallback tint), I (graveyards; recommended: not
now), J (a Wowhead link; recommended: yes, marked external), K (automated reading of third-party
pages; recommended: read-only viewing only).
