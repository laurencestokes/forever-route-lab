# Map atlas (design, revision 2)

Status: **implementable design, 2026-09-27, revision 2.** It answers the owner's map feedback of
2026-09-26 (§1) and his two benchmarks, WoWF-QRP and MapGenie. Revision 1 was the synthesis of three
competing designs (A fidelity-first, B performance-first, C minimal-change) and two judges' reports;
**revision 2 resolves the adversarial review**
[docs/reviews/review-map-atlas-design.md](../reviews/review-map-atlas-design.md) (MA-01 to MA-15;
§0.1 maps each finding to its section) with a second prototype that measures every changed number
(§6, §7). Nothing under `src/`, `tools/` or `public/` has been built for it yet.

Authority: [ARCHITECTURE.md](../ARCHITECTURE.md) and [DECISIONS.md](../DECISIONS.md) win over this file,
in particular D-017, D-018, D-022, D-029, D-032, D-033, D-034, D-038, D-039 and D-041. §13 lists the
edits this design needs elsewhere; §14 lists the decisions it needs, proposed as **D-042**.
The presentation layer (quests, dungeons, flight paths, transports, zone colouring and labels) is
designed separately in [map-presentation.md](map-presentation.md); §8.7 is the interface both depend
on (its step MP.0c).

**Labels.** **MEASURED**: run here or by a named report, with its method and evidence file.
**CITED**: a client value cited by table, row and build (D-022). **OBSERVED**: seen on a live site with
read-only tools, or on a screenshot saved from one, with the zoom. **INSPECTED**: read from a
third-party page's own scripts, or from a scripted browser session on a third-party site; under D-041 K
it carries **no design weight** and is listed only so nobody repeats the work. **ESTIMATE**: arithmetic
on stated inputs. **ASSUMPTION**: a design value, measured in the step that builds it. **UNMEASURED**:
a figure a report gave without a measurement, kept only as a target. **UNKNOWN**: open.

**Units and machine.** Sizes are gzip level 6 of each file on its own (the dist audit's measure), in
decimal units (1 kB = 1,000 B). Zoom `z` is Leaflet's `CRS.Simple` zoom: `2^z` pixels per yard, so
tile level `z` holds `2^−z` yards per pixel. Client: build 1.60.1.70009 (`wow_classic_beta`, build key
`05215079…`), read only through `tools/casc` from `.build.info` and `Data/`. Machine: Ryzen 7 7800X3D
(16 threads), 32 GB, RTX 4090, Windows 11, Node 22.13.1, sharp 0.35.4 (libvips 8.18.6, libwebp 1.6.0).

**Evidence** (gitignored; `<ma>` is `.cache/map-atlas`):

- `<ma>/client-facts.md`, `client-facts.json`, `u1/`, `scripts/`: client facts (u1), including the
  lossless base, overlay and composed rasters of every UiMap (`u1/raw/<id>-{base,overlays,full}.png`).
- `<ma>/perf.md`, `u2/`: the performance profile (u2), with its CDP harness `u2/cdp.mjs`.
- `<ma>/prior-art.md`, `<ma>/code-impact.md`; the three designs and two judges' folders.
- `<ma>/synth/`: revision 1's prototype (`proto.mjs`, run `out-raw/`).
- `<ma>/critic/`: the review's scripts (`rederive.ts`, `view.mjs`, `levels.mjs`, `wheel.mjs`).
- **`<ma>/revise/`: revision 2's prototype and measurements** (`<rv>` below): `proto2.mjs` (every
  change behind a switch, so revision 1's behaviour can be rebuilt); runs `out-ru12/` (**the
  recommended build**), `out-ru12-b/` (its second run), `out-compact/` and `out-compact-b/` (nearest-
  level rule), `out-947/` (revision 1's layout), `out-ru10/` (full round-up), `out-fade/` and
  `out-tint/` (backdrop variants); the lettering census `letters-detect.mjs`, `letters-census.mjs`,
  `letters-census.json`, `letters-force.json`; `seams.mjs`, `inverse.mjs`, `bench-contrast.mjs`,
  `bench-gap.mjs`, `contland.mjs`, `dropped-map.mjs`, `bbox2.mjs`, `profile.mjs`; the contact sheets
  in `img/` (`places-sheet.jpg`, `bench-sheet.jpg`, `cut-labels-sheet.jpg`, `cities-sheet.jpg`,
  `cmp-tint-fade-*.jpg`, `dropped-{0,1}.png`, `letters-sheet.jpg`); run logs `run-*.log`.
- `.cache/map-presentation/`: the presentation team's benchmark screenshots (its §3), used here
  read-only; **no third-party site was visited for revision 2** (§4).

---

## 0. Summary

| Topic | Decision | Evidence |
|---|---|---|
| The problem | Four owner points: slow; no flow from world to zone; both continents never visible together; Zephras Isle missing. Measured causes: wheel settings drop about two notches in three (43–46 notches, 5.2–5.6 s from −6 to −2); route-list re-renders; an 18–91 ms blank gap on every art swap; one painting at a time; one surface per world map. | u2, critic (§3.2) |
| Surface | One **`atlas`** surface for maps 1 and 0 plus the Zephras Isle inset. **Translation only**: one atlas unit is one yard on both continents, so D-017, every zoom constant, the grid, the scale bar and the level-of-detail thresholds stay valid. **Compact layout** (recommended, owner O9): the Eastern Kingdoms sit 7,168 yd further west than on UiMap 947, leaving 0.39 Kalimdor widths of sea between the continents (947: 0.97); the whole world fits a 918×700 panel at **−5.22** (947 layout: −5.62), 1.32× larger. | §5; MEASURED |
| Islands | The client places **neither** Zephras Isle (2991) nor Darkspear Islands (2997) on the world map (CITED; the review re-derived it). Zephras Isle is a **framed card at the top of the sea between the continents**, at true scale, routable, captioned "not in position" and "no quest data yet"; its placement is a committed `src/geo` constant pinned by check T4. Darkspear Islands (a battleground) keeps its own surface. | §5.5 |
| Art | **One pre-composited raster** from Blizzard's paintings (D-033). Each zone painting is drawn over its own terrain polygon with A's two-band blend. Outside its polygon a painting may show only its **painted ground** (the explored-overlay union), never its parchment margins, so no neighbour's name or frame slice appears. A reviewed **label list** keeps lettering whole or hides it as a whole: 18 labels that straddle a border are drawn whole, 3 duplicates and the 6 capital banners that a city plan or card would cut are hidden. Land no painting shows gets the presentation's **area tint shaded by the relief** at every level; terrain the game's maps do not show is dropped. The sea is painted water at the coast and deepens offshore (land/sea contrast 2.65:1, was 1.01:1). | §6 |
| Pyramid | **791 tiles** of 256 px WebP q80, levels −8 to 0, sparse ("virtual" tiles drawn from their nearest stored ancestor; sea keys draw nothing). **6,882,978 B** with seven zones stored one level finer (owner O10); **6,346,342 B** at the nearest level. Tiles median 8.4 kB, largest 20.5 kB; runtime index 845 B with stored and sea bitmaps. **Byte-identical over two runs.** Build about 114 s. | §7; MEASURED |
| Loading | A never-pruned **underlay** of the level −5 tiles (13 tiles, 91.6 kB, the same files as the first view) under the tile layer, and tiles that start as a crop of their nearest decoded ancestor: nothing in the extent shows bare sea colour while tiles load, after the first view. | §8.3 |
| Runtime | One `AtlasTileLayer` plus the underlay; a continuous wheel handler of our own (one settle per gesture, no dropped input, centre clamped every frame); layers built per placed world map and joined; `connector` descriptors between the continents; atlas coordinates only in the adapter's funnel and the tile descriptor. | §8 |
| Speed | Step ATL.0 ships now: `wheelPxPerZoomLevel` 60 (22 notches from −6 to −2, against 46; MEASURED in the production app by the review). Then the smooth wheel, no art swaps, the relief overlay retired on the atlas, canvas at the real pixel ratio, markers created in chunks. Frame, hole and notch figures are **targets** until ATL.9 measures the real app, including the owner's laptop, **before** anything is switched on by default. | §9 |
| Budgets | `atlas` ≤ 8.0 MB (≤ 32 kB per file, per-level baselines + 10 %) and `art` ≤ 1.0 MB, replacing D-034's 12 MB art cap. Expected ≈ 7.56 MB in all with the round-up, against 9.05 MB today. | §7.6 |
| Benchmarks | Matches both on one continuous raster, both continents at once, an inset for Zephras Isle and filled loading; matches MapGenie's layout compactness and beats both on land/sea contrast; beats both on painted content, readable place names and honesty; falls short on close-zoom resolution (4–8 yd/px in most zones against 2.08 and ≈ 1.0) and on visible straight frame edges and palette changes between paintings. | §10 |
| Decisions | Owner O1–O11 and architect A1–A11, with defaults. | §14 |

### 0.1 What revision 2 changed (review findings)

| Finding | Severity | Resolution | Where |
|---|---|---|---|
| MA-01 loading holes | major | Underlay of level −5 (never pruned) and ancestor-first tiles; sea keys create no element; cold-cache pan, zoom-out, jump and preset cases added to the gate | §8.3, §9.2 |
| MA-02 lettering fragments, slices, duplicates | major | Painted-ground-only fallback (explored-overlay union); city filler on land only; reviewed label list (18 drawn whole, 9 hidden by a mirror fill); lettering census: 208 candidates, **0 cut**; contact sheet of the named places | §6.2, §6.5, §6.7, §7.5 T7 |
| MA-03 blurred, unused backdrop | major | Backdrop is the relief-shaded area tint at every level (the continent painting is no longer drawn); terrain the game's maps do not show is dropped (0.67 % and 0.18 % of land, listed); §6.7 describes what remains honestly | §6.2, §6.6, §6.7 |
| MA-04 coarser than the art | major | Corrected text; per-source loss listed; owner option O10: round up the seven zones coarser than 1.2× (+536 kB, measured) — recommended | §7.1, §14 O10 |
| MA-05 world band readability | major | Compact layout (recommended default, O9); deep open sea; contrast criterion ≥ 2.5:1 (measured 2.65:1; MapGenie 2.6, WoWF-QRP 2.38 on saved shots); benchmark contact sheet at equal scale | §5.2, §6.2, §9.2, §10 |
| MA-06 where the inset placement lives | major | `src/geo/atlas-layout.ts`, a committed constant pinned by T4; the tool imports it; no JSON layout input | §5.5, §8.1 |
| MA-07 level-0 seam | minor | Ancestor rule fixed (level −1 included); seam edges at level 0 13 → 4 (the rest are native steps); sizes and hashes restated | §6.4, §7 |
| MA-08 inverse not exact | minor | Text corrected; ATL.2 tests within 10⁻⁹ yd and exactly after the app's 0.1-yd rounding (re-measured) | §5.4, §11 |
| MA-09 gates | minor | Laptop trace (ATL.9) now precedes switching on (ATL.10); ATL.0 gated by a unit test, the harness figure recorded with an alarm at 25 notches | §11 |
| MA-10 sea versus virtual | minor | Index carries a sea bitmap per level −8 to −2; fine levels inherit; test named | §7.2, ATL.7 |
| MA-11 gestures | minor | Centre clamped every frame; trackpad streams calibrated apart; hairline-gap check with the underlay as mitigation | §8.4, §9.2 |
| MA-12 default view | minor | The fit includes the card (it now lies inside the extent); first view recomputed; caption says there is no quest data yet (MEASURED: no spawn in area 16593) | §5.6, §8.8, §9.1 |
| MA-13 decisions, provenance | minor | D-033 status line in D-042; every alteration listed for the owner (O11); T5 checks against records `convert.ts --check` confirms | §7.5, §13, §14 |
| MA-14 atlas units outside the funnel | minor | Tile descriptor named as the one exception; file-level architecture rule for `src/geo/atlas.ts` and `atlas-layout.ts` | §8.1 |
| MA-15 nits | nit | MapGenie resolution now OBSERVED; unsnapped fit values; `fadeAnimation` as a map option. **Rejected:** linear-light reductions (§6.3 gives the reason) | §4.2, §5.6, §6.3, §8.3 |

---

## 1. The owner's feedback and what answers it

The owner, 2026-09-26: *"A few things I've noticed - the map is quite slow - and the full images we get
don't flow very well (i.e. as you zoom in from the world map to a single zone map). We also can't see
both continents on the fully zoomed out map, nor the new starting area for Skyborne."* Later the same
day: WoWF-QRP's map *"is better than ours currently/flows nicer for this tool"*, and MapGenie's
Azeroth map *"is nice"*.

| Owner point | Cause (MEASURED unless marked) | Answer | Where |
|---|---|---|---|
| "quite slow" | Wheel capped at about 0.25 level per 0.3 s: Leaflet drops input during its 250 ms animation (u2 #1). Route-list re-renders (u2 #2, #3; partly fixed since by PERF-11). An 18–91 ms blank gap at each art swap (u2 #4). A 42–60 ms frame at the level-of-detail crossing (u2 #5). The dev server over a network, 20.8 MB (u2 #6). | ATL.0 wheel setting; smooth wheel; tiles instead of swaps, with an underlay; idle pre-build and chunked markers; laptop runbook | §8.3, §8.4, §9 |
| "don't flow" | One painting at a time; about 2.8 zoom levels (≈7×) between continent and zone art; every crossing swaps to a different painting with parchment borders (prior art §3) | One raster from world to zone: coarser levels are exact reductions of the zone mosaic; lettering whole across borders | §6 |
| "both continents" | One surface per world map (MAPS §7.1) | The `atlas` surface, compact, fitted at −5.22 in a 918×700 panel | §5 |
| "the new starting area for Skyborne" | Zephras Isle (2991) is its own world map, and the client does not place it on 947 | A labelled card inside the world view, at true scale | §5.5 |

---

## 2. How this design was chosen

### 2.1 The designs and the judges' scores

| Design | Experience judge (of 100) | Engineering judge (of 100) | Sum | Judges' verdicts |
|---|---:|---:|---:|---|
| A fidelity-first | 69 | 69 | 138 | Best art and cleanest seams; most risk; brings back image swaps as crossfades |
| **B performance-first** | **77** | **79** | **156** | Engineering judge: best overall "if its fill defect is fixed"; experience judge: joint first |
| C minimal-change | 77 | 75 | 152 | Experience judge: best on the tie (least risk, a quick win first); weakest look (lettering fragments, ragged coasts) |

B is first or joint first with both judges and has the highest sum, so it is the base. Both judges'
graft lists converge on the same hybrid: B's single raster and measurements, C's architecture, and A's
blend and fallback. Revision 2 keeps that base and replaces three of revision 1's choices that the
review showed to fail: the parchment fallback (MA-02), the continent-painting backdrop (MA-03) and the
947 layout as the default (MA-05).

### 2.2 Base and grafts

| Element | From | Why (judge or review) |
|---|---|---|
| One raster in yards, translation-only placement, exact 2×2 reductions, sparse 256 px RGB WebP, virtual tiles, index bitmaps, inset | B | Best continuity, measured size, determinism over the whole set |
| Two-band seam blend (colour ±200 yd, detail ±24 yd; low-pass σ 64 yd) | A | Both judges: hides the median 24-level palette steps |
| Fallback from other paintings, **restricted to their painted ground** | A, restricted in revision 2 | MA-02: parchment margins carry neighbours' names and frame slices |
| Area tint shaded by the relief as the backdrop at every level | map-presentation §12.4, revision 2 | MA-03: the continent painting was a 9× blur at zone zoom; measured against a level-dependent fade (§6.2) |
| Reviewed label list and lettering census | revision 2 | MA-02 |
| Frame interior (18→30 px, corners 85 px) and coastal band (150→300 yd) | A | Measured torn edge (u1 §5) |
| Checks T7 (coverage and lettering census) and T8 (every placed zone present) | A, extended | Engineering judge; MA-02 |
| One move-start and one move-end per gesture; mid-gesture canvas refresh; canvas at the real pixel ratio; chunked markers; tint pane | A | Both judges |
| Step 0 quick win (`wheelPxPerZoomLevel` 60, `zoomDelta` 1) | C | Both judges; measured by u2 and the review |
| Per-map builders joined; atlas coordinates only in the funnel; click partition keeps `MapEvent` unchanged | C | Engineering judge: D-017 by structure |
| Inland water keeps its zone's painting; cities masked to their terrain polygon; no line drawn to the inset | C | Engineering judge |
| Whole-set double build, lossless-source size, contact-sheet owner gate, per-level budgets with a per-file cap, the harness pointed at the real app | B | Both judges |
| Compact layout; deep open sea | revision 2 | MA-05; both benchmarks |
| Underlay and ancestor-first tiles | revision 2 | MA-01; WoWF-QRP's overview crop (prior art) |
| 947 world painting below −5.5 with one crossfade | A | **Not in the default**; owner option O4 (needs the 947 layout) |

### 2.3 Corrections to the reports

Every claim a judge flagged in revision 1, and how the design treats it. Revision 2's corrections to
revision 1 itself are in §0.1.

| # | Claim (report) | Finding | Resolution here |
|---|---|---|---|
| 1 | Per-notch wheel rates compared across designs and sites | Unlike inputs: CDP wheel events at DPR 1.5 arrive as 66.7 px, not 100 | Rates are stated **per 100 px of `deltaY`** only. A physical notch's `deltaY` on the owner's hardware is **UNKNOWN** and is calibrated in ATL.9. MapGenie rate figures are INSPECTED and carry no weight. |
| 2 | MapGenie's deepest detail: B 0.52 yd/px, C ≈0.6, A 1.2–1.5 | The two judges disagree | **≈ 1.0 yd per texel (OBSERVED):** the saved `11-close-z17-max.png` at MapGenie zoom 17 (our +1.94, 3.84 px per yard) shows texel blocks about 4 px wide. |
| 3 | Unpainted land: C 4.35 % and 6.71 %, A 9.42 % and 7.00 %, B 15.3 % | Different definitions | Reconciled in revision 1 on one lattice; revision 2's own census is §6.6. |
| 4 | Determinism: A 80 of 311 tiles, C 33 of 274 | Partial | **Re-measured: every tile byte-identical over two runs** (§7.3). |
| 5 | B's "1.3 s, no long tasks, p99 13.9 ms at 4×" | A standalone page on an RTX 4090 | Cited as MEASURED **(standalone page)**; the app is measured in ATL.9. |
| 6 | B: WoWF-QRP's "1.4 MB inline bundle" | No source | Removed; UNKNOWN. |
| 7 | A: "0 blank frames", "≤ 33 ms"; C: "about 8 notches in 1.0 s", "p99 ≤ 20 ms", "about 25 s" build | Unmeasured | Kept only as targets (§9.2) or dropped. |
| 8 | Third-party timings from scripted sessions | Broke the read-only rule | INSPECTED and **set aside** (D-041 K). |
| 9 | B: "single-threaded" build | It used 16 parallel encode jobs | Stated as such (§7.7). |
| 10 | C: WebP effort 4 proposed | Not measured | Effort 6 (`convert.ts`'s setting). |
| 11 | B's per-zone gap figures were console-only | They reproduce | Superseded by §6.6. |
| 12 | A, B, C propose "D-038" and "D-039" | Both numbers are taken | This design proposes **D-042**. |
| 13 | The brief called the art and terrain layers "uncommitted" | Committed on 2026-09-27 | §3.5 |

---

## 3. Facts used

### 3.1 Client facts (u1, `<ma>/client-facts.md`; re-derived independently by the review)

**UiMap 947 (Azeroth) has exactly two `UiMapAssignment` rows** (CITED). Flags 0x900; art UiMapArt 2141
(tiles 8025428–8025439), no overlays, no highlight.

| Row | Order | MapID | UI rectangle | World X | World Y | yd/px (x, y) |
|---|---|---|---|---|---|---|
| 46785 | 0 | 1 | (0.0399, 0.0855)→(0.4083, 0.9234) | −12800…12266.7 | −9600…6933.3 | 44.789, 44.785 |
| 46784 | 1 | 0 | (0.5505, 0.0994)→(0.8966, 0.8691) | −16000…6933.3 | −7466.7…8000 | 44.599, 44.603 |

- MapID 1: `u = 0.194390 − 2.22823e-5·Y`, `v = 0.495537 − 3.34268e-5·X`; MapID 0:
  `u = 0.729517 − 2.23771e-5·Y`, `v = 0.332099 − 3.35625e-5·X`. Each row is isotropic within 0.01 %.
- Kalimdor has 0.42 % fewer pixels per yard than the Eastern Kingdoms.
- MEASURED against the terrain coast: the 947 painting is off by 138 yd (Kalimdor) and 103 yd
  (Eastern Kingdoms), about 3 px.

**Resolution ladder** (CITED/MEASURED):

| Level | yd/px | Step up |
|---|---|---|
| 947 | 44.60–44.79 | – |
| Continents 1414, 1415 | 36.726, 35.130 | ×1.22, ×1.27 |
| 44 zones | 2.046 (Shen'dralas) … 10.113 (The Barrens), median 4.24 | ×3.6–18.0 from the continent |
| 6 cities | 0.789 (Ironforge) … 1.734 (Stormwind) | ×2.0–6.2 from the zone |
| Battlegrounds, Darkspear 2524 | 1.14–4.23; 2524 is 1.921 | – |
| Flight maps 1463, 1464, 2665 (512×512) | 42.57, 47.54; 2665 is 10.86×7.24 | – |

Style 1 (57 of 60 arts): 1002×668, `MaxScale` 2.14 with two extra zoom steps. **The client has no
higher-resolution art.** Eight overlays have no tiles (1412: 5551; 1434: 5252; 2521: 5545–5549;
2548: 5550).

**Where the new maps sit:**

| UiMap | Type, parent | MapID | Placement |
|---|---|---|---|
| 2482 Mount Hyjal | Zone, 1414 | 1 | 947 px (215, 190)–(293, 242) |
| 2548 Riverglades | Zone, 1415 | 0 | 947 px (773, 367)–(882, 439) |
| 2652 Shen'dralas | Zone, 1414 | 1 | 947 px (150, 373)–(195, 404) |
| 2521 Zephras Isle | Zone, parent **947** | 2991 | **UNKNOWN** |
| 2665 Zephras Isle | Flight map, parent 0 | 2991 | **UNKNOWN** |
| 2524 Darkspear Islands | Orphan, parent **1414** | 2997 | **UNKNOWN**; map 2997 is a battleground (`InstanceType` 3) |

Tables checked for 2991/2997: `UiMapAssignment` (61 rows; 947 only for MapIDs 0 and 1), `UiMapLink`
(FDID 2030690, **0 records, 0 sections**), `UiMapGroupMember` (0 rows), `Map` (`ParentMapID` and
`CosmeticParentMapID` −1), `AreaTable` (16593, 16606 with no parent), `UiMapArt` (no highlight),
`UIMapPinInfo` (no UiMap IDs); `UiMapPOI`, `WorldMapArea`, `WorldMapContinent`, `WorldMapTransforms`
are not in the client. Rows a server sends at run time live in `Cache/`, which may not be read:
**UNKNOWN**.

**What part of a zone image is the zone** (MEASURED):

- Each zone image is the **base** layer, a parchment sketch of its whole frame (the zone and its
  neighbours drawn alike, neighbours named in large letters), with a torn edge and corner ornaments,
  plus the **explored-area overlays**, which paint only the zone and carry its place names
  (`u1/raw/<id>-{base,overlays,full}.png`; `<rv>/img/layers-1426.png`, `layers-1428.png`). The zone's
  own land is a median 42 % of its frame (16–75 %).
- The terrain polygon includes sea (median 11 %, up to 66 % for Darkshore). The overlay union covers a
  median 90 % of the zone's land but only 42 % of Moonglade's. **Best mask: the terrain polygon on
  land plus a coastal band.**
- A zone's frame is a median 81 % covered by other frames.
- Paintings sit within a median 7.7 yd of the terrain (at most 17.3 yd), neighbours within 11.4 yd of
  each other (at most 23.9). Across a border the two paintings differ by a median 24 RGB levels in
  mean colour (at most 59): **the seams are palette and brushwork, not misplacement**.
- A landmark on a border can be painted by both zones: Blackrock Mountain is drawn and named by
  Searing Gorge and by Burning Steppes about 340 yd apart; Razorfen Downs by The Barrens and Thousand
  Needles 433 yd apart; Darkwhisper Gorge by Winterspring and Mount Hyjal 476 yd apart (MEASURED,
  lettering census §6.5).
- The continent paintings colour land and sea apart: over deep terrain land (≥ 400 yd from water)
  1414's pixels have R − B > 95 for 98.7 % of 41,885 samples and over open sea (≥ 1,500 yd from land)
  2.85 % of 204,217; 1415 89.3 % and 4.99 % (`<rv>/contland.mjs`, MEASURED).

### 3.2 Performance profile (u2, `<ma>/perf.md`; wheel re-measured by the review)

Headless Chrome 153 over CDP, 1366×768 at DPR 1.5, production and dev builds, 1× and 4× CPU. The GPU
(RTX 4090) is not slowed by CPU throttling, so **laptop GPU cost is not measured**.

| # | Hotspot | Evidence (MEASURED) | Cause |
|---|---|---|---|
| 1 | Wheel zoom capped | −6 → −2: 43 notches / 5.2 s (u2), 46 / 5.6 s (review) at prod 1×. `wheelPxPerZoomLevel` 60: **21 / 2.6 s (u2), 22 / 2.7 s (review)**; 30: 15–16 / 1.9–2.0 s | `zoomSnap` 0.25, `zoomDelta` 0.5, `wheelPxPerZoomLevel` 120 (`LeafletMapAdapter.ts:306-308`); Leaflet ignores zooms during its 250 ms animation |
| 2 | Step click re-renders every row | prod 1× 6–18 ms; prod 4× 30–87; dev 4× 243–318 ms | Rows not memoised at the time; PERF-11 (M6 review) has since memoised rows and narrowed selectors |
| 3 | Derived publishes during load | dev 4×: 27 long tasks, ≈5.1 s; prod: 5, ≈0.9 s | Each path-progress update re-rendered panels |
| 4 | Blank gap on art swap | 18–33 ms (prod 1×), 34–91 ms (4×) | One image, remove-then-create |
| 5 | Level-of-detail crossing | −3.5 at prod 4×: sync 26.6 ms (≈540 markers), one 42 ms frame | Aggregate flip, markers created in one task |
| 6 | Dev server over a network | dev 239 modules, 20.8 MB; prod 8 files, 1.7 MB | Dev mode |

Not hotspots: per `moveend` re-projection ≤ 6 ms, redraw ≤ 7 ms, pan sync ≤ 2.1 ms (4×); p99 frame
7.1 ms (1×), ≤ 14 ms (4×); no idle work.

### 3.3 Prior art (`<ma>/prior-art.md`), as corrected by the review

- Leaflet 1.9.4 `GridLayer` keeps a parent tile (up to 5 levels up) or children (2 levels down) **only
  if that tile is already in the layer's own tile set** (`_pruneTiles`, `_retainParent`,
  `leaflet-src.js` 11517–11600). A pan into new ground, a zoom-out's newly exposed edge, a jump and a
  preset therefore show the container background until each new tile decodes (review MA-01). During
  a pinch-path gesture tiles are added at most every `updateInterval` (200 ms by default).
- Leaflet's canvas renderer uses a 2× backing store whenever DPR > 1 (`Canvas.js` 108).
- GitHub Pages: HTTP/2, `Cache-Control: max-age=600` (MEASURED headers), 1 GB site limit.
- In game, moving between UiMaps is navigation, not continuous zoom; each painting is meant to be
  enlarged at most about 2.14×.
- No site composes painted zone art into a continent; minimap-based viewers are seamless but use no
  painted art.

### 3.4 Code impact (`<ma>/code-impact.md`)

The list of every site that assumes one world map per surface, the descriptor changes, how cross-map
legs are drawn today (transition glyph pairs), the tests that would break, what a pyramid needs from
the manifest and the dist audit (its own folder, A5 misses subfolders, per-tile audit entries),
migration risks (local sets' 947 rows must never change) and a change order that keeps every step
green. Line numbers are as read on 2026-09-26; each step re-reads them. Architecture limit:
`map/leaflet` may import only `map/adapter` (`tests/architecture.test.ts:97`).

### 3.5 State of the tree (2026-09-27)

- The art and terrain layers are committed with Milestone 6 and 3b.6. D-038 keeps the one-image
  rendering only until the atlas replaces it. Another team is building the Milestone 6 UI in the
  working tree; this design's steps start after it has landed (§11).
- Decisions run to D-041. D-041 H: the base-map look is Blizzard's painted art composed seamlessly by
  this design; our own tint appears only where the art fails the acceptance criteria. D-041 K:
  INSPECTED facts carry no design weight.
- `grid` canvas: class `frl-map__grid leaflet-zoom-hide`, redrawn on `moveend` only. In Leaflet 1.9.4
  `leaflet-zoom-anim` is added only by the animated-zoom path; the pinch path never adds it.

---

## 4. The benchmarks as observed

Only OBSERVED facts, WoWF-QRP code read under D-029, and measurements on saved screenshots carry
weight. **No third-party site was visited for revision 2.** WoWF-QRP was last checked live, read-only,
by the review on 2026-09-27 (header "Questie data · v2026.09.27-0030"); MapGenie was not visited
(owner's instruction); its facts come from the presentation team's screenshots of 2026-09-26
(`.cache/map-presentation/mapgenie/shots/`) and the recorded observations.

### 4.1 WoWF-QRP (https://tyba-dev.github.io/WoWF-QRP/)

| Aspect | What it does | Source |
|---|---|---|
| Renderer | One `<canvas>`, its own scale and translate; each change asks for one `requestAnimationFrame` redraw; backing store follows DPR, capped at 2 | prior art (code) |
| Zoom | Continuous. Wheel: scale × e^(−0.0016·deltaY), **0.23 level per 100 px**, applied at once; keys ×1.3. Scale 0.004–3 px/yd (our −7.97 to +1.58); "All" 0.028 px/yd (our −5.16) | prior art (code); presentation §3.1 |
| Layout | Both continents on one plane, closer than on 947. **Sea gap 0.32 Kalimdor widths** (MEASURED on the saved `01-world-all.png` by a column profile, `<rv>/bench-gap.mjs`; the review's live estimate was about 0.5). Zephras Isle a dashed ellipse at the top between the continents, which its code calls illustrative | saved shot; prior art |
| Imagery | No painted art: biome-tinted zone polygons, paper texture, vector coast, a hillshade overview at 16.7 yd/px, and single-level **1024 px tiles at 2.08 yd/px**; a loading tile is drawn from a crop of the overview. **Land/sea contrast 2.38:1** (median land luminance 0.272 against sea 0.085, pins and labels included; MEASURED on `01-world-all.png`, `<rv>/bench-contrast.mjs`) | prior art (code); saved shot |
| Level of detail | Towns from 0.03 px/yd (−5.06), flight paths and dungeons from 0.035 (−4.84); zone names with hand-set level ranges | A (code); presentation §3.1 |
| Islands | "Darkspear Islands *" east of Durotar, listed "(1-12?)" although the client says battleground | presentation §3.1 |
| Continent view | Orgrimmar to Thunder Bluff 235 px for 5,204 yd (0.0453 px/yd, our −4.47) in the saved `03-continent-kalimdor.png` (positions read by eye, ±5 px): the whole of Kalimdor with zone names, ranges and town names | saved shot |
| Close | ≈ −1.9 at Razor Hill: relief still crisp (its tiles are 2.08 yd/px) | review (OBSERVED live) |

### 4.2 MapGenie (https://mapgenie.io/world-of-warcraft-forever/maps/azeroth)

Zoom calibration (MEASURED on screenshots by the presentation team): **MapGenie zoom = our zoom + 15.06**.

| MapGenie zoom | Our zoom | What it shows | Source |
|---:|---:|---|---|
| 7 (least) | −8.06 | Tiles start at 8, so the land disappears; pins pile up | presentation §3.2 (`15`) |
| 10 (initial) | −5.06 | Both continents on a navy sea, **sea gap about 0.35 Kalimdor widths** (review, measured on `02`, ±15 %); Zephras Isle a dark framed inset south-west of Kalimdor; **land/sea contrast 2.6:1** (MEASURED on `02`, pins included, `<rv>/bench-contrast.mjs`) | saved shots |
| 12 | −3.06 | Top-down terrain render; zones are flat colour patches with hard borders; no names | presentation (`03`) |
| 13.5 | −1.56 | Quest pins separate; hover shows the title | presentation (`04`–`07`) |
| 16 | +0.94 | Top-down render with buildings, slightly soft | presentation (`10`) |
| 17 (most) | +1.94 | Tiles upscaled from 16; texel blocks about 4 px, so **≈ 1.0 yd per texel** | presentation (`11`); review |

- **Flow** (OBSERVED): one surface with fractional zoom and cross-faded tiles; no blank frame after a
  10-tick wheel burst (engineering judge); fast bursts compressed, a 10-notch burst moving about one
  level (experience judge).
- **Look**: minimap-style render, not the painted maps; flat navy sea; a 300 px advertisement covers
  the lower left, where the Zephras inset is.
- **INSPECTED, no design weight**: MapLibre GL; one raster source of 256 px JPG, levels 8–16; sea tiles
  answering 403; `wheelZoomRate` 1/150; a 300 ms tile fade; every frame timing and pixel read.

### 4.3 What "flows nicer" comes down to

Both benchmarks share five traits the current map lacks; this design adopts all five as requirements:

1. **One continuous picture at every zoom**, with a coarser version shown while finer data loads
   (WoWF-QRP's overview crop; MapGenie's cached parents). Here: the underlay and ancestor-first tiles
   (§8.3), not Leaflet's retention alone.
2. **Input that never waits**: every wheel event changes the view (§8.4).
3. **Both continents visible together and large** at the least zoom: a compact layout (§5.2).
4. **Land that stands out from the sea** at the world band (both ≥ 2.38:1; §6.2).
5. **Nothing pops at a zoom threshold** (presentation §5.5 handles the marks and labels).

---

## 5. Atlas layout

### 5.1 Unit, axes and grid

- One atlas unit is **one yard**. **E** grows east, **S** grows south. Leaflet `CRS.Simple`:
  `latLng = (−S, E)`. Tile (0, 0) at every level starts at the origin, so tile indices are
  non-negative and no custom CRS is needed. Tile level `z` covers `256·2^−z` yards.
- World surfaces keep `latLng = (X, −Y)`: the same formula with zero offsets. One code path serves
  both kinds of surface.

### 5.2 Placements

Each placement is `E = eOff − Y`, `S = sOff − X` (translation only; `scale: 1`, so map-presentation's
`pxPerYard = 2^zoom × scale` holds). The base translation of maps 0 and 1 comes from UiMap 947's rows
(`eOff = round((pxA + pxB·Yc)·K + Yc)`, `sOff = round((pyA + pyB·Xc)·K + Xc)`, K = 44.78908 yd per 947
px, (Xc, Yc) the row rectangle's centre); the layout then moves each map by whole multiples of
1,024 yd (one level −2 tile), so every level's pixels are identical in both layouts and only the tile
grid differs (MEASURED: the census and the contrast figures of `out-compact` and `out-947` agree to
the last digit).

| Map | Kind | Compact layout (recommended, O9) | 947 layout (revision 1; required by O4) | Source |
|---|---|---|---|---|
| 1 Kalimdor | placed | eOff **5,652**, sOff **12,778** (947 translation − (3,072, 2,048)) | 8,724, 14,826 | Row 46785 (CITED) + layout shift |
| 0 Eastern Kingdoms | placed | eOff **22,499**, sOff **7,907** (947 translation − (3,072 + 7,168, 2,048)) | 32,739, 9,955 | Row 46784 (CITED) + layout shift |
| 2991 Zephras Isle | **inset** | eOff **17,671.25**, sOff **5,468.25**: the 2521 rectangle (X 1,247.9…4,956.25, Y −1,331.25…4,231.25) with its north-west corner at E 13,440, S 512 | 5,255.25, 35,676.25 (corner E 1,024, S 30,720) | Layout choice (ASSUMPTION); reason recorded: no 947 row, `UiMapLink` 0 records (1.60.1.70009) |

Compact layout, MEASURED on the terrain (`<rv>/bbox2.mjs`, `profile.mjs`): Kalimdor's land spans
E 1,744–14,177 and S 1,136–24,736; the Eastern Kingdoms' E 19,057–28,924 and S 3,182–22,882; the
narrowest sea between them is **4,880 yd = 0.39 Kalimdor widths** (947 layout: 12,048 yd = 0.97 by the
same land-extreme measure; 1.30 against 0.39 by `bench-gap.mjs`'s column profile on the rendered fit
views). The card lies 1,897 yd from Kalimdor's nearest land and 1,529 yd from the Eastern Kingdoms' (MEASURED, `<rv>/card-clear.mjs`).

Why compact is recommended: the 947 layout's fidelity has no function while 947 is not drawn (atlas
units never feed a distance, §5.3), and it costs 0.40 zoom levels at the fit view; both benchmarks use
a compact layout (MapGenie 0.35, WoWF-QRP 0.32). The compact layout keeps 0.39 so the card sits in the
gap and the boat and zeppelin connectors (§8.5) keep room. The 947 layout remains an option (O9), and
is required if the owner chooses the 947 painting at the world band (O4).

### 5.3 What the layout does not change

Atlas units are never persisted and never used for a distance (D-017): `distanceYards` stays per
world map and `null` across maps. In the 947 layout, map 0 sits at most 58.2 yd (1.30 px of 947 art)
from the exact 947 layout (MEASURED, reproduced by the review); the 947 painting itself is 103–138 yd
off the terrain. In the compact layout the continents' relative position is a layout choice, stated
in the legend's note on the inset and in MAPS §7.1, not a geographic claim.

### 5.4 Partition and clicks

Every atlas point belongs to exactly one world map: inside the inset rectangle → 2991; otherwise
`E ≤ seamE` → map 1; otherwise → map 0. `seamE` is **16,617** in the compact layout (midway between
Kalimdor's east-most land, E 14,177, and the Eastern Kingdoms' west-most, E 19,057) and 21,532 in the
947 layout. A click therefore always yields a real `WorldPoint` of one map, and `MapEvent` is
unchanged. The inverse is a subtraction; **it is not bit-exact in doubles for 0.1-yd inputs**
(MEASURED, `<rv>/inverse.mjs`, 10,000 seeded points per placement: 54–81 % of 0.1-yd round trips differ,
by at most 3.6 × 10⁻¹² yd; whole-yard inputs 0 of 10,000; rounding the inverse to 0.1 yd, as picks do,
restores all 60,000 inputs). ATL.2 tests round trips within 10⁻⁹ yd and exactly after 0.1-yd rounding.

### 5.5 Where the client is silent

- **Zephras Isle (2991)**: the whole 2521 painting, with its own parchment frame, as a **card** at the
  top of the sea between the continents, at the atlas scale (E 13,440–19,002.5, S 512–4,220.3). A
  vector frame and the caption: *"Zephras Isle, the Skyborne starting zone: a separate world map. The
  game files do not place it on the world map, so it is shown here at the same scale, not in
  position. No quest data yet."* (The pinned dataset has no NPC or object spawn in area 16593:
  MEASURED, `public/data/spawns.json`.) Routes inside the card are true to scale; legs to or from it
  are transition glyph pairs, **never lines**. WoWF-QRP also puts its (illustrative) Zephras Isle at
  the top between the continents; MapGenie puts its inset south-west of Kalimdor (both OBSERVED on
  saved shots).
- **Where the placement lives (MA-06):** `src/geo/atlas-layout.ts`, a committed, typed constant:
  the layout name, the shifts of §5.2, the inset's UiMapAssignment row (69208) and corner, `seamE` and
  the extent. `atlasPlacements(geometry, ATLAS_LAYOUT)` combines it with the committed 947 rows, so the
  runtime, placeholder mode, the "index refused" fallback and the hash check all have it without a
  fetch; `tools/maps/atlas.ts` imports the same constant (tools already import `src/geo` for frame
  hashes); T4 pins `atlasHash` over the constant and the rows. There is no separate JSON layout
  input. The constant is not geometry, so `mergeLocalGeometry`'s 947-row check still holds.
- **Darkspear Islands (2997)** is a battleground in the client: it keeps `world:2997`, listed under
  "Separate maps"; no quest marks or level chip (map-presentation §18).
- **The four painted 947 islands** are not drawn (947 is not a source unless O4).
- **If a later build places 2991 or 2997** on 947, the tool places it from that row, cited, and the
  inset and its caption disappear (check T4 notices the change). Nothing is guessed.

### 5.6 Extent and zoom

- Extent: **E 0–30,720, S 0–26,112** (compact; the card inside it). 947 layout: E 0–44,879,
  S 0–34,428 (world rectangle plus the shelf below it).
- `minZoomFor` fits the extent, **card included** (MA-12). MEASURED fit zooms (unsnapped) and the tile
  level they draw:

  | Panel | Compact | 947 layout |
  |---|---|---|
  | 918×700 (the map panel in a 1600 px window) | **−5.221**, level −5 | −5.620, level −6 |
  | 1366×768 | −5.087, level −5 | −5.486, level −5 |
  | 700×500 | −5.707, level −6 | −6.106, level −6 |

- `maxBounds` stays the extent padded by 50 %. `maxZoom` 2, `zoneZoom` −3.5 and focus −2 are
  unchanged, because the unit is a yard.
- A world surface still exists for each instance and battleground. `world:0`, `world:1` and
  `world:2991` are retired when the atlas is on (ATL.10); "Kalimdor" and "Eastern Kingdoms" stay in
  the switcher as presets that fit the atlas to that continent.

---

## 6. Art composition (offline, deterministic)

Measured with `<rv>/proto2.mjs`, whose parameters are the ones specified here; every revision-2 rule
is behind a switch, so revision 1's behaviour can be rebuilt for comparison.

### 6.1 Sources

| Source | Count | Role | Top stored level (§7.1) |
|---|---:|---|---|
| Zone paintings on maps 0 and 1, including Hyjal 2482, Riverglades 2548, Shen'dralas 2652 | 43 | Own terrain polygon (plus the capital's area for Durotar/Orgrimmar 1637, Mulgore/Thunder Bluff 1638, Teldrassil/Darnassus 1657, Elwynn/Stormwind 1519), land and inland water plus a coastal band; elsewhere only their **painted ground** | −3 for 4, −2 for 27, −1 for 12 with the O10 round-up (nearest level: 9, 24, 10) |
| Their explored-overlay layers | 43 | The painted-ground mask (alpha of the overlay union) | – |
| City paintings with a terrain polygon: Orgrimmar 1454, Thunder Bluff 1456, Darnassus 1457, Stormwind 1453 | 4 | Own polygon at levels −1 and 0; at −2 and coarser a filler **on land only** where no zone painting reaches | 0 (Stormwind −1) |
| Interior city maps: Ironforge 1455, Undercity 1458 | 2 | Cards at their row's rectangle, levels −1 and 0 | 0 |
| Continent paintings 1414, 1415 | 2 | **Not drawn.** Only their land/sea colouring is read, for the land test (§6.2 step 2) | – |
| Zephras Isle 2521 | 1 | The inset card | −2 |
| Terrain byproducts (D-032): relief, zone arcs | 2 maps | Land, sea and inland-water classes; polygons; the tint's relief shading; distances for the sea | – |
| The reviewed label list | 27 entries | §6.5 | – |

Not drawn: 947 (unless O4), 1414 and 1415, the flight maps 1463, 1464 and 2665, and 2524 and
1459–1461 (separate surfaces, still drawn from `maps/art`).

### 6.2 The level −2 composite (4 yd/px)

Per atlas pixel, bottom to top:

1. **Sea** (MA-05): painted water rgb(131, 118, 88) (the per-channel median of the zone paintings'
   pixels over terrain sea, MEASURED) up to 300 yd from kept land, deepening to **rgb(61, 55, 41)** at
   900 yd and beyond (the same hue and saturation at HSL lightness 0.20; ASSUMPTION, owner O3), by
   smoothstep on the distance from kept land (a chamfer distance on the 16.7-yd relief grid, sampled
   bilinearly). The deep colour is the map container's background and the index's sea colour.
2. **Kept land** (MA-03): terrain land and inland water that the continent painting also shows as land
   (R − B > 95, dilated by 4 source px ≈ 145 yd for its 100–138 yd misregistration; §3.1) **or** that
   lies inside its own area's zone painting's frame interior (> 0.5). The rest is dropped: drawn as
   sea, listed in the census (§6.6). This removes the square and the L-shaped strip east of Winterspring
   (area 16 Azshara, outside Azshara's frame, sea on 1414) without holing land the game's maps paint.
   The review's rule "only land with an `AreaTable` area" was measured and not used: it keeps that
   square (it lies in area 16), and it would drop 42,640 lattice points of land that lies outside every
   terrain polygon but inside the continents, which the continent paintings show as land (the land test
   keeps 99.4 % and 100 % of them; §6.6).
3. **Backdrop on kept land**: the area's **fallback tint** (map-presentation §12.4: mean painted colour
   of the area's zone inside its polygon, or of the continent painting where the area has no zone
   image; HSL saturation ≤ 0.29, lightness 0.38–0.72), as a smooth field (normalised box blur over
   land, three passes of radius 4 relief cells, ≈ 70 yd, so area edges are gradients rather than
   the terrain chunks' staircase), shaded by the relief, mean-preserving:
   `f = clamp(1 + 0.6·(g − g_med), 0.6, 1.25)`. The same backdrop at every level (the review's
   level-dependent fade to the continent painting was built and measured: at the world band it adds
   saturated yellow and orange blocks at the continents' edges, `<rv>/img/cmp-tint-fade-z-5-world.jpg`,
   and it costs 233 kB; not used).
4. **Zone paintings** (A's two-band blend, revision-2 restriction). For each painting *i* whose frame
   is near:
   - `interior_i = smoothstep(18, 30, e) · smoothstep(85, 97, c)` (source px);
   - `coast_i = 1` on land or inland water, else `1 − smoothstep(150, 300 yd, distance to land)`;
   - `c_i = interior_i · coast_i`; `sd_i` the signed chamfer (3-4) distance to the zone's polygon,
     positive inside, in yards; `oH_i = smoothstep(−24, 24, sd_i)`, `oL_i = smoothstep(−200, 200, sd_i)`;
   - **`pa_i = smoothstep(0.35, 0.85, overlay alpha)`**, the painted ground;
   - `wH_i = c_i · max(10⁻³·pa_i, oH_i)`, `wL_i = c_i · max(10⁻³·pa_i, oL_i)`;
   - coverage `cov_i = c_i · max(oH_i, pa_i)`: outside its own polygon a painting covers only its
     painted ground, so its parchment margins, neighbours' names and frame ornaments never show
     (MA-02);
   - label rules (§6.5) adjust `oH_i`, `c_i` and other paintings' `wH` inside label boxes;
   - `Z = Σ wL_i·LP_i / Σ wL_i + Σ wH_i·(col_i − LP_i) / Σ wH_i`, `α = min(1, max_i cov_i)`.
5. **City filler** (levels −2 and coarser): each city painting with a polygon joins both sums with
   weight `10⁻² · interior · smoothstep(−40, 40 yd, sd_city) · land`, where `land` is the terrain land
   class sampled bilinearly. It shows only where no zone's own weight reaches (Orgrimmar north of
   Durotar's frame); on land only, so Stormwind's harbour decorations ("Stormwind Harbor", the shield)
   no longer appear as slices west of Stormwind at −2 (MA-02).
6. `out = Z·α + backdrop·(1 − α)`.
7. **Inset**: the 2521 painting over the card rectangle.

### 6.3 Coarser levels (−3 to −8)

Exact 2×2 box reductions of level −2 (integer, rounded). Every level is therefore continuous with the
zone mosaic by construction. The reductions average sRGB values, as revision 1 did. The review noted
that this darkens fine ink compared with averaging in linear light; **revision 2 keeps it**, because
between two levels the browser shows level z scaled down by up to 0.71×, and Chromium scales images
on the encoded values too (ASSUMPTION, checked in ATL.9 by comparing the mean luminance just below and
just above a level crossing on screen): a linear-light reduction would make each coarser level
lighter than the scaled finer one and add a step at every crossing.

### 6.4 Fine levels (−1 and 0)

A tile is composed at a fine level when it lies under the frame of a source whose top level reaches
that level, or under a capital banner box at level −1 (§6.5). It is recomposed from the sources with
§6.2's rules, then:

- `out = up·(1 − m) + composite·m`, where `up` is the bilinear upscale of the tile's **nearest stored
  ancestor, level −1 included** (MA-07; revision 1's prototype skipped −1), clamped at that ancestor
  tile's edges as the runtime draws a virtual tile, and `m = max_i c_i · smoothstep(0, 200 yd, sd_i)`
  over the zones with a top level ≥ z. Outside the fine sources a stored fine tile therefore equals
  what its virtual neighbours show. MEASURED (`<rv>/seams.mjs`, detail energy in 8-px bands across
  each edge between a stored and a virtual tile, a seam where one side has more than 1.6× the
  other's): level 0, **13 seam edges in revision 1, 4 in revision 2**, all where a city plan or a
  finely stored zone meets the tile edge; at level 0, 84 recomposed tiles blend against their level −1
  ancestor and 7 against −2 (their −1 parent is not stored). Level −1: 30 edges (revision 1: 33), the
  native step between a zone stored at −1 and a coarser neighbour.
- Cities are then blended over: polygon cities with `interior · smoothstep(−40, 40 yd, sd_city)`,
  Ironforge and Undercity as cards (torn edge 14 px, ramp 40 px, corners 80 px).

### 6.5 Lettering: the label list and the census (MA-02)

Painted place names are the atlas's main advantage over both benchmarks at the zone band, so a name
is either drawn whole or not at all. Three rules, over a **reviewed label list** committed as
`tools/maps/inputs/atlas-labels.json` (each entry: UiMap, box in source px, rule, levels, reason,
and the painting's `pixelsSha256`; the tool refuses to build when a listed painting changes until the
entry is reviewed again):

1. **Whole** (18 entries): a label that straddles its painting's polygon, coastal band or frame edge is
   drawn whole. Inside the box (feathered by 4 source px) the painting's detail weight is 1
   (`oH = max(oH, box)`, coverage from a narrower interior 6→10 px) and every other painting's detail
   weight is multiplied by `1 − box`; the colour band still blends. Examples: Skywatcher Plateau
   (Mulgore), Razorfen Downs and Northwatch Hold (The Barrens), Brackenwall Village (Dustwallow
   Marsh), The Vile Reef (Stranglethorn Vale, over the sea), Ahn'Qiraj (Silithus, at the frame edge).
2. **Hidden** (9 entries), by a **mirror fill**: inside the box the painting is sampled from its own
   rows just above the box reflected downwards and from the rows just below reflected upwards,
   blended across the middle (a side is used only if its reflected rows stay inside the painting's
   interior); the colour band likewise. This alters Blizzard's picture and is put to the owner (O11).
   - the six capital banners (IRONFORGE, UNDERCITY, ORGRIMMAR, THUNDER BLUFF, DARNASSUS, STORMWIND)
     **at levels −1 and 0 only**, where the city plan or card they name would cut them; at −2 and
     coarser they are whole. The plans and cards carry their own names;
   - three duplicates, at every level: Searing Gorge's BLACKROCK MOUNTAIN (Burning Steppes paints and
     names the mountain), Thousand Needles' RAZORFEN DOWNS (The Barrens keeps it) and Mount Hyjal's
     DARKWHISPER GORGE (Winterspring keeps it). Both paintings' mountain drawings stay; only the
     second name goes.
3. Every other label must be whole or hidden by the ordinary rules; T7 fails on any **cut** label.

**Lettering census (MEASURED, `<rv>/letters-census.mjs`, `letters-census.json`).** A detector
(`letters-detect.mjs`) finds label candidates in each painting's source raster: ink pixels next to the
opposite extreme (cream letters with a dark outline, or dark letters with a light halo) on painted
ground, grouped by a horizontal closing and kept by size, aspect and stroke rhythm. Each candidate is
tested at 21 points against §6.2's weights: `whole` if the painting keeps ≥ 0.85 of the detail at
every point, `hidden` if ≤ 0.15 everywhere, else `cut`; listed entries are `forced` or `reviewed`.
Result on the recommended build, 43 paintings: **208 candidates: 182 whole, 18 whole by rule 1,
8 reviewed (rule 2), 0 hidden, 0 cut** (before the label list: 20 cut). The detector's recall on a
hand-checked sample of four paintings (Mulgore, Searing Gorge, Ashenvale, Dun Morogh) is **17 of 22
labels (77 %)**, with 2 false positives, both in Dun Morogh, whose grey-on-snow labels it finds worst;
it misses the IRONFORGE banner, which is in the list anyway. So the census screens; the contact sheet
(`<rv>/img/cut-labels-sheet.jpg`, every listed label as the runtime draws it at −1.6) and the owner's
review decide. ATL.6 improves the detector's recall on Dun Morogh before the gate is final.

### 6.6 Coverage census (MEASURED, recommended build)

Terrain land (relief land class, water excluded) inside each map's row rectangle, on a 16 yd lattice at
level −2. "Own": own-polygon detail weight ≥ 0.5; "painted fallback": α ≥ 0.5 from other paintings'
painted ground or a city plan; "tint": the backdrop; "dropped": land the land test removes.

| Continent | Lattice points | Own painting | Painted fallback | Tint | Dropped |
|---|---:|---:|---:|---:|---:|
| Eastern Kingdoms | 399,413 | 85.49 % | 0.65 % | 13.19 % | 0.67 % |
| Kalimdor | 559,291 | 85.61 % | 1.96 % | 12.25 % | 0.18 % |

Revision 1 filled 5.1 % and 7.4 % of land with neighbours' paintings, most of it their parchment;
revision 2 shows that land as tint. Areas with the most tint or dropped land (≥ 200 points): 408
Gillijim's Isle 100 % dropped; 17066 Shark-Infested Waters 86 % dropped, 14 % tint; 3478 Gates of
Ahn'Qiraj 97 % tint; 16756 Ruins of Gilneas 99.8 % tint; 17065 Gilneas 94 % tint, 3.6 % dropped; land
outside every polygon 83 % tint and 16–17 % painted fallback on both continents (6,537 and 36,103
points); 1377 Silithus 47 % tint; 11 Wetlands 35 %; 51 Searing Gorge 28 %; 139 Eastern Plaguelands
24 %.

Dropped land by area (yd²): map 0: 408 Gillijim's Isle 213,333; 33 Stranglethorn Vale 134,444;
17066 101,944; 17065 81,944; 139 76,111; 85 39,722; 40 16,944; others ≤ 10,278. Map 1: 1377 Silithus
106,389; 16 Azshara 76,667 (the square and strip east of Winterspring); 876 47,500; 440 46,389; 331
16,944; 405 12,500. The map of what is dropped is `<rv>/img/dropped-{0,1}.png`: islets west of
Gilneas, a sliver of the Eastern Plaguelands' north coast outside its frame, Gillijim's Isle, and
the Azshara square and strip.

### 6.7 What remains visible (contact sheet)

Sheets: `<rv>/img/places-sheet.jpg` (every place the review named, revision 1 beside revision 2),
`bench-sheet.jpg` (§10), `cut-labels-sheet.jpg` (§6.5), `cities-sheet.jpg` (the six capitals at −1
and 0), previews in `<rv>/out-compact/preview/`.

- **Fixed**: the harbour slices, frame figure and "St… H…" west of Stormwind; the doubled Blackrock
  Mountain name; "IRO" at Ironforge; the blurred continent-painting blocks north of Stormwind and in
  southern Silithus; the square and strip east of Winterspring; "TCHER EAU" and 19 other cut labels;
  the level-0 sharpness seam at Ironforge.
- **Still visible**:
  - brushwork and palette changes along straight terrain chunk borders, softened by the colour blend;
  - **straight edges where a painting's frame ends and the tint begins** (Searing Gorge's frame, Dun
    Morogh's west, southern Silithus): the tint covers 12–13 % of land, more than revision 1's
    backdrop (7–9 %), because the parchment fallback is gone;
  - the tint itself: smooth area colour with the relief's shading, 16.7 yd/px relief magnified 4× at
    level −2 and 8× at −1, so it reads as soft shading, not painted detail;
  - the mirror fill where a banner or duplicate name was hidden: plausible texture with a faint
    horizontal symmetry (Ironforge at level 0);
  - two painted peaks of Blackrock Mountain with one name;
  - Orgrimmar's northern part drawn from the city plan at −2 and coarser (a pasted look, but painted);
  - coarse zones' lettering magnified at close zoom, since zone art is 2–10 yd/px and `MaxScale` is 2.14;
  - Ironforge and Undercity as rectangular cards (vector frame and caption, §8.5);
  - a soft halo of painted water around every coast (300–900 yd) on the deep sea.
- **Gate**: `atlas.ts --review` writes the contact sheet at fixed views (the places above, both
  continents, the card, the labels); the owner signs it off before tiles are committed (ATL.6), and
  again after any parameter change.

---

## 7. Tile pyramid, files, checks and budgets

### 7.1 Scheme

- **Levels −8 to 0**, 256 px tiles, file `public/maps/atlas/t/<z>/<x>/<y>.webp` (`z` signed).
- **Top stored level of a source** (MA-04): the nearest level, `t = min(0, round(−log₂ yd/px))`,
  stores 18 zones and 3 city maps coarser than their art (MEASURED, linear factor):

  | Factor | Sources |
  |---|---|
  | 1.39 | Ashenvale (5.76 yd/px → 8), Felwood (5.74 → 8) |
  | 1.37 | Burning Steppes (2.92 → 4) |
  | 1.30 | Mulgore (6.14 → 8) |
  | 1.27 | Ironforge (0.79 → 1; level 0 is the finest, so it cannot be stored finer) |
  | 1.26 | Stranglethorn Vale (6.37 → 8) |
  | 1.25 | Hillsbrad Foothills (3.19 → 4) |
  | 1.22 | Darkshore (6.54 → 8) |
  | 1.20 | Blasted Lands (3.34 → 4) |
  | 1.13–1.16 | Tanaris, Feralas, Westfall, Silithus, Mount Hyjal, Elwynn Forest, Stormwind City, Winterspring |
  | 1.04–1.11 | Arathi Highlands, Un'Goro Crater, The Hinterlands, Undercity |

  Revision 1's "native" was wrong for these. **Recommended (O10): store a source one level finer when
  the nearest level is coarser than its art by more than 1.2×**: the seven zones above 1.2 become
  native (Ashenvale, Felwood, Burning Steppes, Mulgore, Stranglethorn Vale, Hillsbrad, Darkshore), the
  worst remaining factor is 1.20 (Blasted Lands), for **+536,636 B (+8.5 %)**. Full round-up (every
  source native or finer): 1,032 tiles, 8,499,419 B, over the 8.0 MB cap (measured before the label
  list; the list changes a build by a few hundred bytes).
- **Sparse rule** (B): a tile at −8 to −2 is **sea** when it is all deep-sea colour, **stored** when the
  highest top level among what shows in it (the dominant detail source where α > 0.03, cities, the
  inset, −4 for tint, −5 for the coastal water gradient) is at least `z`, otherwise **virtual** (drawn
  from its nearest stored ancestor). At the fine levels a key is stored when composed and dominant
  (§6.4), sea when its level −2 ancestor is sea, otherwise virtual.
- **Format**: WebP q80, effort 6, `smartSubsample`, `preset: 'drawing'` (the `convert.ts` settings);
  RGB. 256 px wins for a sparse set and loads fewer bytes per view.

**The recommended build** (compact layout, round-up 1.2; MEASURED, `<rv>/out-ru12/report.json`), with
the nearest-level build for comparison:

| Level | yd/px | Grid | Stored | Virtual | Sea | Gzip | Largest tile | Nearest-level build (tiles, gzip) |
|---:|---:|---|---:|---:|---:|---:|---:|---|
| −8 | 256 | 1×1 | 1 | 0 | 0 | 2,147 | 2.1 kB | 1, 2,147 |
| −7 | 128 | 1×1 | 1 | 0 | 0 | 6,357 | 6.4 kB | 1, 6,357 |
| −6 | 64 | 2×2 | 4 | 0 | 0 | 23,739 | 9.7 kB | 4, 23,739 |
| −5 | 32 | 4×4 | 13 | 0 | 3 | 91,588 | 13.8 kB | 13, 91,588 |
| −4 | 16 | 8×7 | 41 | 4 | 11 | 340,928 | 20.3 kB | 41, 340,928 |
| −3 | 8 | 15×13 | 115 | 29 | 51 | 1,128,094 | 20.3 kB | 115, 1,128,094 |
| −2 | 4 | 30×26 | 318 | 171 | 291 | 3,085,659 | 20.5 kB | 280, 2,751,463 |
| −1 | 2 | 60×52 | 227 | rest | from −2 | 1,734,301 | 18.7 kB | 199, 1,534,085 |
| 0 | 1 | 120×104 | 71 | rest | from −2 | 470,165 | 14.3 kB | 71, 467,941 |
| **Total** | | | **791** | | | **6,882,978** | 20.5 kB | **725, 6,346,342** |

Tile sizes: median 8.4 kB, p95 16.7 kB, largest 20.5 kB. Revision 1 (947 layout, nearest level,
parchment fallback, continent backdrop): 728 tiles, 6,424,888 B. The same revision-2 rules in the 947
layout: 727 tiles, 6,345,101 B. The nearest-level build's −1 level has 10 more tiles than revision 1's (189), for the banner rule.

### 7.2 Runtime index

`public/maps/atlas/index.json`: tile size, the deep-sea colour, the coastal water colour, extent,
placements and `atlasHash`, the inset, `seamE`, per-UiMap native levels (for `BaseMapLabels`), and
**two bitmaps per level for −8 to −2 (stored, sea) and one for −1 and 0 (stored)** (MA-10), base64.
MEASURED for the prototype's index (without the per-UiMap list and the hash): 3,906 B, **845 B gzip**
(revision 1, stored bitmaps only: 805 B). `resolveTile(index, z, x, y)` returns `stored`, `virtual`
(with the ancestor and offsets) or `sea`; a fine key is `sea` when its level −2 ancestor is. The runtime
fetches only the index, checks its shape and that its `atlasHash` equals `src/geo`'s value, and
otherwise refuses it (§8.6). The runtime never builds a URL for a key the index does not list and
creates no element for a sea key.

### 7.3 Determinism (MEASURED)

Two runs of the recommended build produced identical `hashes.txt` files: **791 of 791 tiles**, tree
hash `d4ba41220c31bd98…` (`<rv>/out-ru12/`, `out-ru12-b/`). The nearest-level build likewise: 725 of
725, tree hash `1bf0387c8b7f5fcd…` (`out-compact/`, `out-compact-b/`). Both from the client's lossless
rasters (the production route). Composition uses IEEE arithmetic, integer box filters and a fixed
order; encoding uses the pinned sharp, libvips and libwebp. Output across platforms is UNKNOWN, as it
is for `convert.ts` today; the platform is recorded.

### 7.4 The tool

`tools/maps/atlas.ts [--check] [--review]`, with pure modules in `tools/maps/lib/`:
`atlas-plan.ts` (sources, levels, tile sets), `atlas-mask.ts` (polygon raster, chamfer distances,
land test, inland water, sea distance), `atlas-blend.ts` (§6.2), `atlas-labels.ts` (§6.5 rules and the
census), `atlas-pyramid.ts` (reductions, sparse rule, fine levels), `atlas-index.ts`,
`atlas-manifest.ts`, `atlas-checks.ts`, `atlas-notice.ts`, `atlas-review.ts`.

- **Inputs**: the lossless composed rasters **and the overlay-union rasters** that `convert.ts` builds
  before encoding, read from the client through `tools/casc` (so the atlas build needs the client, as
  `convert.ts` does), each checked against the hash the art manifest records for it (§7.5 T5); the
  terrain byproducts (checked against the terrain manifest's SHA-256); the 947 rows in the committed
  geometry; `src/geo/atlas-layout.ts`; `tools/maps/inputs/atlas-labels.json`.
- **Manifest** (`kind: 'map-atlas'`): the D-033 artwork notice and the client pin; the tool tree hash,
  encoder versions and platform; unit, placements and `atlasHash`; every source's `pixelsSha256`,
  `overlaysSha256` and `inputHash`; the terrain SHA-256s; every parameter of §6.2 and §6.5; the sea
  colours; the per-level summary; every tile's path, bytes and SHA-256; the coverage census, the
  dropped-land list and the lettering census; **the list of alterations** (§14 O11).
- **NOTICE.md**: Blizzard Entertainment's artwork (D-033), composited with terrain-derived data
  (D-032): masks, the tint's relief shading and the sea's distances come from the terrain byproducts;
  the hidden labels are listed.
- `--check` rebuilds in memory and compares every byte (a manual gate until CI, like `convert.ts`).
- `--review` writes the contact sheet of §6.7 and the census sheets.
- Workers may compose tiles in parallel; the prototype encodes with 16 parallel sharp jobs and the
  output is identical.

### 7.5 Validation (`maps:validate`, no client needed)

| Check | What it proves |
|---|---|
| T1 | `manifest.json`, `index.json` and `NOTICE.md` parse; the NOTICE equals the text regenerated from the manifest |
| T2 | Every file in `public/maps/atlas/` is listed with matching bytes and SHA-256, is a 256 px still WebP, and nothing unlisted is present |
| T3 | The index's stored keys equal the manifest's tiles; its sea keys equal the manifest's sea list |
| T4 | `atlasHash` equals `src/geo`'s value for the committed geometry and `ATLAS_LAYOUT` |
| T5 | Each source's `pixelsSha256` and `overlaysSha256` equal the **art manifest's `sources` records**, which `convert.ts` keeps for every UiMap it composes, deployed or not, and which `convert.ts --check` recomputes from the client (MA-13) |
| T6 | Budget: folder total, per-file cap, per-level baselines |
| T7 | Coverage census within the recorded values + 0.5 percentage points; **lettering census: 0 cut**, every listed label found whole or hidden as its rule says, candidate counts within the recorded values |
| T8 | Every placed zone and city appears at its top level |
| T9 | Every entry of `atlas-labels.json` carries its painting's current `pixelsSha256` |

`tools/maps/lib/art-checks.ts` check A5 is fixed to count subfolders; `art-build.test.ts` keeps
pinning A1–A5 and gains T1–T9 beside them.

### 7.6 Budgets and the dist audit

- **`atlas`** (new `mapFolders` entry, `maps/atlas`): ≤ **8.0 MB** in all (6.88 MB measured with the
  round-up, 16 % headroom), ≤ **32 kB per file**, and a baseline per level + 10 %. `audit-dist.ts` gains
  a tiled mode like the nav budget's.
- **`art`**: ≤ **1.0 MB**, per-file baselines + 10 % as now. It keeps only the images still drawn:
  2521 (the card's fallback when the index is refused), 2524, 1459, 1460 and 1461, 676 kB (MEASURED
  by the judges), plus the manifest and NOTICE.
- Together about 7.56 MB against 9.05 MB today (the atlas manifest's size is an ESTIMATE of about
  40 kB gzip). Owner decision O5 replaces D-034 item 4's 12 MB art cap.

### 7.7 Build time (MEASURED)

112–114 s per run of the recommended build on the machine above: loading 1.6–1.8 s, level −2
composition 41–42 s, reductions 0.2 s, fine levels 59–60 s (all single-threaded JavaScript), encoding
3.5–3.6 s with 16 parallel sharp jobs. Revision 1 took 62–64 s; the painted-ground sampling, the sea
distances and the label rules add the rest. Production adds the BLP decode that `convert.ts` already
performs (ESTIMATE: ≤ 150 s in all). The lettering census adds about 6 s.

---

## 8. Runtime

### 8.1 Pure modules and interfaces

- **`src/geo/atlas-layout.ts`**: `ATLAS_LAYOUT`, the committed constant of §5.5.
- **`src/geo/atlas.ts`**: `atlasPlacements(geometry, layout)` → `AtlasPlacement[] | null` (null
  without both 947 rows); `partition(E, S)`; `atlasHash(placements)`. `AtlasPlacement`:
  `{ mapId, kind: 'placed' | 'inset', scale: 1, eOff, sOff, rect: WorldBounds, source }`, where
  `source` is `{ table: 'UiMapAssignment', row, build, layoutShift }` or `{ kind: 'inset', row, reason }`.
- **Architecture rule (MA-14):** a file-level rule in `tests/architecture.test.ts`, like
  `OPTIMIZER_TYPES_FILE`: `src/geo/atlas.ts` and `src/geo/atlas-layout.ts` may be imported for values
  only by `map/adapter`, `map/layers`, `infra`, `app` and tests (and by `tools/`); `domain`, `rules`,
  `engine`, `sim`, `validate`, `rxp`, `diff`, `project`, `nav` and `optimizer/*` may import their types
  only. Atlas units therefore cannot reach a distance, a simulation or a saved project.
- **`src/map/adapter.ts`**:
  - `SurfaceId` gains `'atlas'`; `SurfaceInfo` gains `kind: 'world' | 'atlas'`, `mapIds` and
    `placements`.
  - `MapView` gains `surface` and `visible: readonly WorldBounds[]` (one per placed map that meets
    the view padded by 50 %); `center` and `mapId` name the partition under the view centre.
  - `TileBandDescriptor`: `{ type: 'tiles', id, urlTemplate, tileSize: 256, minNativeZoom: −8,
    maxNativeZoom: 0, bounds, index, underlayLevel: −5, ref }`, plain data. **It is the one descriptor
    in atlas units** (its `bounds` and `index` describe the raster, which has no world coordinates);
    every other descriptor stays in world coordinates.
  - `resolveTile(index, z, x, y)` → `{ kind: 'stored' } | { kind: 'virtual', z, x, y, scale, dx, dy }
    | { kind: 'sea' }`, pure, so `map/leaflet` imports only `adapter.ts`.
  - `ConnectorDescriptor`: `{ type: 'connector', id, from: WorldPoint, to: WorldPoint, style: LegStyle,
    label, ref }`, drawn only when both ends' maps are placed on the surface.
  - `shareCap(counts, cap)`: the cap split across active maps in proportion to their candidates in
    view, largest remainder, deterministic.
  - `BaseMapLabels` (map-presentation §13.5), computed from the index's per-UiMap native levels.
- Apart from the tile descriptor, nothing outside the adapter's funnel sees atlas coordinates.

### 8.2 Controller: per-map builders (C)

- One memoised `createMapLayers` per placed map whose rectangle meets the padded view, each with its
  own `MapView` (the atlas view translated into that map's yards). Each layer's content is the
  concatenation of the active builders' items, memoised on the parts' identities.
- The 2,500-path cap and map-presentation's per-band budgets are shared through `shareCap`.
- Descriptor ids are already unique across maps.
- `route-paths` asks for legs on every active view, not only `view.mapId`.
- Status counts, zone groups and the switcher count by the surface's `mapIds`.
- **Level-of-detail crossing**: within 0.5 levels of a band edge the next band's content is built in
  idle time; markers are created in chunks of at most 150 per frame.

### 8.3 Leaflet: `AtlasTileLayer` and `AtlasUnderlay` (MA-01)

Two layers, both our own code in `src/map/leaflet/`:

- **`AtlasUnderlay`** (`atlas-underlay.ts`), pane `frl-underlay` (z 244): one container holding an
  `<img>` for **every stored level −5 tile** (13 in the recommended build, 91,588 B, the same files and
  URLs as the first view's tiles), positioned at their level −5 pixel positions. It is never pruned.
  On `zoom`, `viewreset` and `zoomanim` it sets one transform on the container (translate and scale
  `2^(zoom+5)`, the computation `GridLayer._setZoomTransform` does), so it covers the whole extent at
  every zoom and during every gesture frame, including a zoom-out's newly exposed edges before the tile
  layer's next update. It is loaded right after the first view's tiles. Cost: 13 elements; at zoom +2
  the container is scaled 128×, which the GPU composites (measured in ATL.9's laptop trace; fallback:
  hide it above zoom 0 while no tile is loading).
- **`AtlasTileLayer`** (`atlas-tile-layer.ts`), an `L.TileLayer` subclass in pane `frl-atlas` (z 245):
  - `_isValidTile` returns false for sea keys (from the index), so they create no element and the
    container's deep-sea background shows (MA-10);
  - `createTile(coords, done)`: every element is a `<div aria-hidden="true">` that **starts as the crop
    of its nearest ancestor already decoded in this session** (a set of decoded keys; CSS background
    of that URL scaled by `2^k` and offset), so a pan, zoom-out, jump or preset shows the best picture
    already in memory at once, and the underlay only where nothing finer is decoded. A stored key then
    adds its own `<img alt="" decoding="async">`, which fades in over 150 ms after `decode()` (no fade
    under reduced motion). A virtual key keeps its ancestor crop (after the ancestor's `decode()`).
    `done` is called at once;
  - options: `tileSize` 256, `minNativeZoom` −8, `maxNativeZoom` 0, `maxZoom` 2, `bounds` the extent,
    `noWrap`, `keepBuffer` 2, `updateWhenZooming` true, `updateWhenIdle` false, **`updateInterval`
    100**, `detectRetina` false;
  - **`fadeAnimation` is a map option** (revision 1 listed it on the layer): it is set false on the
    map; the layer's own image fade replaces it.
- The container's background is the index's deep-sea colour.
- Panes: `frl-relief` 240 (fallback only), **`frl-underlay` 244**, **`frl-atlas` 245**, `frl-art` 250
  (per-image art on world surfaces and in local mode), **`frl-tint` 255** (reserved for the
  presentation's zone fill and hatching), grid 350, paths canvas 400, `frl-labels` 450.
- Holes are gated in §9.2 with a cold cache: a pan, a zoom-out, a jump and a preset.

### 8.4 Wheel and gestures

- **ATL.0 (now)**: `wheelPxPerZoomLevel` 60, `zoomDelta` 1 (buttons and keys). MEASURED in the app:
  −6 → −2 in 21 notches, 2.6 s (u2) and 22, 2.7 s (review), from 43–46 notches.
- **`SmoothWheel`** (`src/map/leaflet/smooth-wheel.ts`, our own code; replaces `scrollWheelZoom`):
  - Each `wheel` event (non-passive, default prevented): `px = deltaY` in pixel mode, ×100/3 in line
    mode, × the container height in page mode, ×2 with `ctrlKey` (trackpad pinch);
    `Δz = clamp(−px / R, −1, +1)`; target `= clamp(target + Δz, minZoom, maxZoom)`; the anchor is the
    pointer's container point.
  - **Two rates (MA-11)**: `R_notch` for notch-like input (pixel or line mode with |deltaY| ≥ 40 per
    event) and `R_stream` for continuous streams (pixel mode, |deltaY| < 40, events under 30 ms apart:
    trackpads and smooth-scrolling mice). Both start at 200 (0.5 level per 100 px) and are calibrated
    separately in ATL.9 on the owner's hardware, where a notch's `deltaY` and his input device are
    UNKNOWN.
  - First event of a gesture: `map._moveStart(true, false)`. Each animation frame: `z += (target − z)
    · (1 − e^(−dt/90 ms))` (snapping within 0.002), the centre chosen so the anchor's point stays under
    the pointer, then **clamped by `map._limitCenter(center, z, maxBounds)`** (MA-11), then
    `map._move(center, z, { pinch: true, round: false })`. With the clamp every frame, Leaflet's
    `_panInsideMaxBounds` finds nothing to correct at the settle, so there is no pan-back.
  - 140 ms after the last event, once the target is reached: `map._moveEnd(true)`. **One**
    re-projection, redraw and sync per gesture.
  - Mid-gesture, the path canvas is re-rendered through the renderer's `_reset()` when the zoom has
    drifted more than 0.5 levels since its last draw and that draw took under 8 ms.
  - **The grid canvas is hidden at gesture start** (a container class) and redrawn at the settle.
    Hover tooltips are suppressed during a gesture.
  - `zoomSnap` becomes 0 (any resting zoom); buttons and keys keep Leaflet's animated zoom with
    `zoomDelta` 1. Fractional zooms can show hairline gaps between tiles; the underlay lies beneath, so
    a gap shows the level −5 picture rather than the sea; ATL.9 looks for gaps (§9.2) and, if any are
    visible, tile images get a 0.5 px overlap. Reduced motion: each event jumps to its target without
    easing, one settle after 140 ms; no fades.
  - Touch keeps Leaflet's `TouchZoom`.
- **Canvas pixel ratio**: the measured renderer sizes its backing store by `devicePixelRatio`
  (capped at 2) instead of Leaflet's fixed 2×: at DPR 1.5, 43.75 % fewer pixels per redraw.
- Private Leaflet names used (`_move`, `_moveStart`, `_moveEnd`, `_limitCenter`, `_isValidTile`, the
  `pinch` and `round` flags, the renderer's `_reset` and its backing-store sizing) join MAPS §7.5's
  list; Leaflet stays pinned to 1.9.4.

### 8.5 Features in atlas space

- Markers, route runs, walking paths, aggregates, outlines and frames are built per world map as now
  and placed at the funnel (`leafletLatLng`, `leafletBounds`: two additions per point).
- The yard grid is drawn per placement, clipped to that map's row rectangle; the scale bar is exact
  everywhere (the unit is a yard) and names the map under the view centre.
- Focus, fit and jump-to-zone translate the point or frame; a step on an instance still switches
  surface.
- **Cross-map legs**: between maps 0 and 1 (boats, zeppelins, portals) a `connector`: a dashed
  quadratic arc in the leg's style bulging 12 % of the chord to the left of travel, with a mid-arc
  transition glyph and a label ("Boat to Eastern Kingdoms"); its length is never used. In the compact
  layout the arcs are shorter; the card at the top of the gap lies clear of them (the Auberdine–Menethil
  arc's apex is about 2,300 yd below it, ESTIMATE). Legs to the inset or to an instance keep the
  transition glyph pairs.
- The Ironforge and Undercity cards and the Zephras card get a vector frame (`--frl-map-frame`) and a
  caption from the frames layer.
- **Switcher**: "Azeroth (both continents; Zephras Isle inset)", the presets "Kalimdor" and
  "Eastern Kingdoms", then "Separate maps": Darkspear Islands, the instances and battlegrounds.

### 8.6 Modes and failures

| Mode | What the map draws |
|---|---|
| Atlas on (default after ATL.10) | Underlay and tiles; outlines on; zone frames not drawn while tiles show (they remain for hit-testing and jump-to-zone; A8). The relief `ImageOverlay` is not drawn. |
| "Painted art" off | The relief per placement (opacity 0.85 as backdrop), hidden above zoom 0, plus outlines and frames |
| Index refused or `atlasHash` mismatch | As "art off", plus the 2521 image on the card (map 2991 has no relief); the status line says why |
| Placeholder (no art, no terrain) | Frames and data, translated; placements from the committed 947 rows and `ATLAS_LAYOUT` |
| Local maps (dev and preview) | Tiles hidden; the local set's images drawn one at a time through the placements (documented as not seamless) |

### 8.7 Interface agreed with the presentation design (map-presentation MP.0c)

1. `AtlasPlacement` with `scale` (1 for every placement here); insets are placements.
2. Builders filter by "placed on this surface" and `MapView.visible`, and share the cap (`shareCap`).
3. `ConnectorDescriptor` for cross-map rides, drawn only when both ends are placed.
4. `BaseMapLabels`: `continents` is always false (no continent painting is drawn); `places` is true
   for a zone where its art is drawn at ≥ 0.75 of its native scale and not over the tint; the six
   capital banners are hidden at −1 and 0 (their plans carry the names); zone names are never
   painted, so zone labels are always the presentation's.
5. The `frl-tint` pane (z 255) and the `frl-labels` pane (z 450) are reserved for it; `frl-underlay`
   (z 244) is the atlas's.
6. Zone-colour criteria (map-presentation §12.3): criterion 2 holds by construction at levels ≤ −2;
   criteria 1 and 3 are measured in MP.12; land no painting reaches shows the area's own tint, so every
   zone keeps a colour of its own.
7. Band hysteresis: with `zoomSnap` 0 the presentation's "half a `zoomSnap` step" becomes a fixed
   0.125 zoom.
8. The presentation's `coastline` layer (D-032 arcs) may stroke coasts at the world band; the atlas
   meets its contrast criterion without it.

### 8.8 Accessibility (UI.md §9)

- The map stays supplementary: named "Route map: Azeroth", with instructions that start with the art
  notice and "Both continents; Zephras Isle is shown in a box between them, because the game does not
  place it; it has no quest data yet".
- Tiles and the underlay are `alt=""` or `aria-hidden`. Keyboard: arrows pan, ± zoom one level, Tab
  leaves the map; the focus ring stays on the container.
- The inset's note appears in the legend and status text ("Zephras Isle: shown in a box, not in
  position; no quest data yet"), not only on the canvas.
- Reduced motion: no easing, no tile fades, no zoom animation.
- Contrast pairs in `tests/ui-tokens.test.ts`: `--frl-map-frame` against the deep sea rgb(61, 55, 41)
  and against the coastal water rgb(131, 118, 88) at 3:1 or more, in both themes.

---

## 9. Performance

### 9.1 Hotspots, fixes and evidence

| u2 hotspot | Fix | Evidence or target |
|---|---|---|
| 1. Wheel capped | ATL.0 setting; then `SmoothWheel` | ATL.0: 21–22 notches, 2.6–2.7 s (MEASURED, app). B's handler on a **standalone page**: −5.5 → −1.83 in 11 notches, 1.32–1.35 s (MEASURED, not the app). Target in the app: world fit → zone fit (about 3 levels) in ≤ 8 physical notches, ≤ 1.5 s, every event changing the zoom |
| 2, 3. React re-renders | PERF-11 (done); progress published at most 4 times a second (M6 owners' files) | Re-measured in ATL.9 |
| 4. Art-swap gap | No swaps: underlay, ancestor-first tiles, sea keys empty | Target 0 hole frames inside the extent after the underlay has loaded (§9.2) |
| 5. Level-of-detail crossing | Idle pre-build within 0.5 level; chunks of ≤ 150 markers | No frame over 16 ms at 1×, no long task over 50 ms at 4× |
| 6. Dev server over a network | Runbook: `pnpm vite build`, then `pnpm vite preview --host` | About 12× fewer bytes; production React |
| Relief laid out 179,000 px wide | Not drawn on the atlas | Largest layer removed |
| 2× canvas store at DPR 1.5 | Real pixel ratio | 43.75 % fewer canvas pixels (arithmetic) |
| First art paint (MA-12) | Index (845 B) and the fit view's tiles | Fit of the whole extent, card included, in the 918×700 panel: −5.22, level −5: **13 tiles, 91,588 B** (MEASURED); the underlay is the same 13 files, so it adds no bytes there. In a 700×500 panel the fit is −5.71, level −6: 4 tiles, 23,739 B, and the underlay adds 91,588 B after first paint |

### 9.2 Budgets and gates (ATL.9: the u2 CDP harness against the production build at 1× and 4×, then the owner's laptop; all before ATL.10 switches anything on by default)

- World fit → zone fit in ≤ 8 physical notches and ≤ 1.5 s of input; no wheel event without a zoom
  change; no pan-back after a gesture that ends at the bounds.
- During wheel gestures and pans: frame p95 ≤ 16.7 ms and p99 ≤ 33 ms at 4×; no long task over 50 ms.
- Band crossing: no frame over 16 ms at 1×, no long task over 50 ms at 4×.
- **Holes (MA-01), cold cache, 50 Mbit/s emulated**: (a) a pan of three screens at the zone band;
  (b) a zoom-out from −1 to the world fit in one gesture; (c) a jump to a step 5,000 yd away at −2;
  (d) the preset "Kalimdor" → "Eastern Kingdoms". **0 frames with a pixel of bare container colour
  over kept land** (every frame's screenshot tested against the land mask), once the underlay has
  loaded; underlay loaded ≤ 0.5 s after the first art.
- **Hairline gaps (MA-11)**: screenshots at 20 fractional zooms between −5 and +1 show no
  one-pixel line of the underlay or the container colour between tiles over land.
- **World band (MA-05)**: at the fit view, land/sea contrast ≥ 2.5:1 (median land luminance against the
  open sea's, measured on the rendered view as in `<rv>/bench-contrast.mjs`); MEASURED on the raster:
  **2.65:1** (level −6), 2.63:1 (level −5); revision 1: 1.01:1.
- ARCHITECTURE §14 unchanged: `moveend` redraw ≤ 16 ms at the cap, one route edit ≤ 8 ms
  (`map-edit.bench.ts` gains a two-builder atlas case within its baseline + 25 %).
- ≤ 40 tile elements in view and ≤ 12 MB of decoded tiles (underlay included).
- First art ≤ 1.0 s after the map chunk at 50 Mbit/s.
- The laptop trace also records the underlay's compositing cost at zooms −5, −2 and +2.

### 9.3 Measured and not measured

MEASURED: every tile size, count and hash, the build time, the coverage and lettering censuses, the
seams, the fit zooms and first-view bytes, the raster's contrast, the layout's gap, ATL.0's wheel gain,
the current app's hotspots. Not measured: the real app with the new handler, tiles and underlay, any
laptop GPU (raster, compositing and WebP decode), a physical notch's `deltaY`, tile loads from GitHub
Pages (which revalidate after 10 minutes; a service-worker cache is a later option), the hole gate.

---

## 10. Comparison with WoWF-QRP and MapGenie

"Beats" means better for planning routes under this project's rules, not better looking. Side by side
at the same scale: `<rv>/img/bench-sheet.jpg` (MapGenie `02` and `03`, WoWF-QRP `01` and `03`, saved
screenshots, beside revision 2 at −5.06, −5.16, −3.06 and −4.47 with the same centres).

| Point | WoWF-QRP | MapGenie | This design | Verdict and why |
|---|---|---|---|---|
| Both continents at the least zoom | Yes; gap 0.32 Kalimdor widths | Yes; gap ≈ 0.35 | Yes; gap 0.39; the whole world, card included, fits 918×700 at −5.22 | **Matches** both: at the same scale the continents are the same size, and the whole world fits comparable panels at a comparable zoom (MapGenie's initial −5.06 at 1440×900; WoWF-QRP's "All" −5.16 at 750×790). **Short** of WoWF-QRP by about 20 % in compactness (0.39 against 0.32), a choice that leaves the gap for the card and the connectors |
| Land against sea at the world band | 2.38:1 | 2.6:1 | 2.65:1 | **Beats** WoWF-QRP and **matches** MapGenie (MEASURED on saved shots and on our raster; methods differ slightly: theirs include pins and labels) |
| Zephras Isle | Ellipse at the top between the continents, "illustrative" | Framed inset south-west of Kalimdor, with its own pins | Framed painted card at the top between the continents, true scale, cited reason, routable | **Beats** WoWF-QRP (painted, true scale, honest). **Matches** MapGenie's framing; **short** of it on content: no quest marks on the island yet, because the pinned dataset has none there (MapGenie shows its own data) |
| Darkspear Islands | A label east of Durotar, "(1-12?)" | not observed | Its own battleground surface | **Beats** WoWF-QRP on correctness (client `InstanceType` 3) |
| Continuity world → zone | One continuous raster | One tile set with fades | One raster; coarser levels are exact reductions; a level crossing changes a median 4.5 RGB levels at −1 and 3.8 at 0 (review's `levels.mjs` on the recommended build) | **Matches** both. **Short** at the −1.5 crossing in the six capitals, where the plan replaces the zone's drawing and the banner goes (36 tiles with a visible change) |
| Continuity across zone borders | Seamless vector tints | Seamless render | Painted ground only, no parchment margins; every detected label whole (208 candidates, 0 cut) | **Short**: brushwork and palette still change along borders, and straight frame edges show where a painting ends and the tint begins (12–13 % of land is tint). Separate paintings cannot be made seamless without repainting |
| Blank frames while loading | Overview crop | None observed after a 10-tick burst | Underlay of level −5 under ancestor-first tiles; sea keys empty | **Matches** both by mechanism (the same idea as WoWF-QRP's overview crop); the cold-cache gate is a target until ATL.9 |
| Wheel input | 0.23 level per 100 px, immediate | Eased; fast bursts compressed | 0.5 level per 100 px (to calibrate, notch and stream apart), eased over 90 ms, nothing dropped, no pan-back | **Beats** WoWF-QRP (fewer notches) and MapGenie on fast flicks; **matches** MapGenie's eased feel. Per-notch numbers UNKNOWN until ATL.9 |
| Main-thread work during a gesture | Repaints everything each frame | GPU (not measured here) | CSS transforms plus one settle; one canvas refresh per 0.5 level of drift | **Beats** WoWF-QRP by design with large routes (not measured side by side); **matches** MapGenie in principle |
| Detail at close zoom | 2.08 yd/px hillshade | ≈ 1.0 yd per texel render (OBSERVED) | Zones 2.05–10.11 yd/px (median 4.24), native in every zone with the O10 round-up except those within 1.2× (worst Blasted Lands 1.20×); cities 0.79–1.73 | **Short** of both in raw resolution in most zones: the client has no finer painted art. **Beats** both on content: towns, roads and Blizzard's place names |
| The picture | Biome tints, paper, hillshade, blue-green sea | Minimap-style render, navy sea | Blizzard's painted zone maps; relief-shaded tint on 12–13 % of land; painted water at the coast, deep sepia offshore | **Beats** both for this tool's users (the in-game look; D-041 H), where painted. The tint areas are plainer than WoWF-QRP's tints and hillshade |
| Readability of names | Zone names with ranges, overlapping when zoomed out | No zone names | Painted place names, whole, at the zone band; zone and continent names from the presentation layer at every band | **Short** of WoWF-QRP without the presentation layer; with it, **beats** both (map-presentation §19) |
| Room for quests, dungeons, flight lines, tints | Its own canvas layers | Pins | Plain descriptors, reserved `frl-tint` and `frl-labels` panes, `connector`, `BaseMapLabels` | **Matches** WoWF-QRP's capacity; **beats** MapGenie (pins only) |
| Assets | 170 WebP relief tiles, 6.25 MB, plus its bundle (UNKNOWN) | UNKNOWN (only INSPECTED counts) | 791 tiles, 6.88 MB for both continents, cities and the inset; first view 92 kB | Not comparable on the evidence allowed; ours is measured and budgeted |
| Provenance | Data derived from Blizzard files (its README) | Commercial; not stated | Reproducible from the pinned client, byte-identical rebuild, manifest, NOTICE and a list of alterations (D-033) | **Beats** both on reproducibility |
| Accessibility | Canvas only | Pins, colour-only sides | Keyboard, reduced motion, notes in the DOM | **Beats** both |

---

## 11. Step plan

Steps touching `src/`, `tools/` or `public/` start after the Milestone 6 UI team has landed. Every step
ends green on `pnpm check` and `maps:validate`, and no step leaves the map without art. Nothing is on by
default until ATL.9's measurements, the owner's laptop trace included, pass (MA-09).

| Step | Files | Tests and gates | Budgets | Depends on |
|---|---|---|---|---|
| ATL.0 Quick win | `src/map/leaflet/LeafletMapAdapter.ts` (`wheelPxPerZoomLevel` 60, `zoomDelta` 1); README laptop runbook | **Gate: an adapter unit test that the map is created with these two options** (deterministic). The u2 harness figure (−6 → −2) is recorded in `docs/measurements/`; an alarm, not a gate, above 25 notches (measured 21–22; today 43–46) | map-edit bench within baseline + 25 % | M6 UI landed |
| ATL.1 Decisions | DECISIONS D-042; STATUS owner rows; the MP.0c text in both designs | review of the texts | – | owner answers to O1–O11 (defaults otherwise) |
| ATL.2 Geo | `src/geo/atlas-layout.ts`, `src/geo/atlas.ts` + tests; the architecture test's file-level rule | offsets for both layouts; inset corner; `seamE`; 10,000 seeded round trips per placement **within 10⁻⁹ yd, and exact after 0.1-yd rounding**; whole-yard round trips exact; card at least 1,000 yd from every map's land (measured 1,529 yd); null without both rows; `atlasHash` pinned; the modules of §8.1 cannot import the files for values | – | ATL.1 |
| ATL.3 Transforms through placements | `src/map/leaflet/transform.ts`, the adapter funnel, identity for world surfaces | every existing transform and adapter test unchanged; atlas round trips; partition | map-edit bench + 25 % | ATL.2 |
| ATL.4 Per-map builders | `src/app/map-controller.ts`, `map-model.ts`, `route-paths.ts`; `src/map/adapter.ts` | golden: one-map output identical; two-map join; cap split; memo by part identity | map-edit two-builder case ≤ 8 ms; `map-paths.bench --budget` | ATL.3 |
| ATL.5 Atlas surface behind `atlas: false` | `src/map/layers.ts` (`atlasSurfaceOf`), `ConnectorDescriptor` and its drawing, switcher, status, legend (inset note); relief, outlines and frames translated; per-image art translated as interim art | new adapter, layer and controller tests; glyph pairs for the inset and instances | – | ATL.4 |
| ATL.6 Tool and tiles | `tools/maps/atlas.ts`, `tools/maps/lib/atlas-*.ts`, `tools/maps/inputs/atlas-labels.json`; `convert.ts` keeps `sources` records (lossless and overlay hashes) for every UiMap it composes; `public/maps/atlas/` | synthetic-raster tests (masks, painted-ground fallback, label rules, mirror fill, reductions, sparse rule, sea keys, index); client-gated double build byte-identical; `--check`; the detector's recall raised on Dun Morogh and re-measured on a hand-checked sample; `--review` signed off by the owner; T1–T9; A5 recursion; audit tiled mode | `atlas` ≤ 8.0 MB, ≤ 32 kB per file, per level + 10 % | ATL.2; O3, O6, O10, O11 |
| ATL.7 Runtime tiles | `src/map/leaflet/atlas-tile-layer.ts`, `atlas-underlay.ts`, `src/infra/maps/atlas-index.ts`, `TileBandDescriptor`, `resolveTile` | jsdom: a key not in the index makes no request; **a sea key creates no element; a fine key over a level −2 sea key is sea; a virtual key resolves its nearest stored ancestor**; a stored key starts as its nearest decoded ancestor's crop; the underlay holds every level −5 key and one transform per zoom event; hash mismatch falls back with a status; reduced motion disables fades | first view ≤ 100 kB | ATL.5, ATL.6 |
| ATL.8 Gestures and speed (behind `smoothWheel: false`) | `src/map/leaflet/smooth-wheel.ts`; grid hidden during gestures; mid-gesture refresh; canvas pixel ratio; chunked markers; idle pre-build | fake-rAF tests: no dropped input, 0.5 per 100 px, notch and stream rates apart, line and page modes, `ctrlKey` ×2, one `moveend` per gesture, **centre clamped every frame (no pan-back)**, reduced motion; grid hidden between `_moveStart` and `_moveEnd` | §9.2 | ATL.7 |
| ATL.9 Measure and review | the u2 harness against the production build at 1× and 4× with both switches on; **the owner's laptop trace (integrated GPU)**; calibrate `R_notch` and `R_stream`; the cold-cache hole cases, hairline-gap and contrast checks; the level-crossing luminance check (§6.3); the owner's contact-sheet and live review; WoWF-QRP re-checked read-only (MapGenie only if the owner approves a visit); `docs/measurements/map-atlas.json`; ARCHITECTURE §14 rows | §9.2 gates | – | ATL.8 |
| ATL.10 On by default; prune art | options on; `world:0`, `world:1`, `world:2991` retired; presets; the tests of code-impact §4 updated deliberately; `convert.ts` deploys only 2521, 2524, 1459–1461 | dist audit; art manifest checks | `art` ≤ 1.0 MB | ATL.9 green; O5 |
| ATL.11 Edits elsewhere | the documents of §13 | review | – | ATL.10 |

---

## 12. Risks

| # | Risk | Mitigation |
|---|---|---|
| R1 | Laptop GPU raster, compositing (the underlay at up to 128×) and WebP decode are unmeasured; every frame figure comes from an RTX 4090 | One tile layer of opaque 256 px RGB tiles, ≤ 40 in view, sea keys empty; relief overlay retired; canvas at the real pixel ratio; the ATL.9 laptop trace **before** ATL.10 switches anything on; underlay hidden above zoom 0 if it costs |
| R2 | The owner dislikes what remains visible (§6.7): frame edges against the tint, the tint itself, mirror fills, cards, magnified lettering | Contact-sheet gate before commit; parameters in the manifest; options O3, O4, O6, O11 |
| R3 | Leaflet private API (§8.4's list) | Pinned 1.9.4; names listed in MAPS §7.5; adapter tests exercise them |
| R4 | A physical notch's or a trackpad's `deltaY` differs by browser, OS scaling and device | Two rates calibrated on the owner's hardware; clamp ±1 level per event |
| R5 | Virtual tiles: an ancestor not yet decoded, or scaling artefacts at ancestor edges | Ancestor-first tiles over the underlay, so an undecoded ancestor shows the underlay rather than the sea; clamped per ancestor tile as the prototype measures; visual check in ATL.9 |
| R6 | The label list and the land test depend on hand-measured boxes and a colour rule | T9 pins every listed painting; the census fails T7 on any cut label; the dropped-land list is on the contact sheet |
| R7 | The lettering detector misses labels (recall 77 % on a sample) | The contact sheet at every border is reviewed by eye; ATL.6 raises the recall and re-measures |
| R8 | Cross-platform byte identity of libvips and libwebp is unknown | Platform recorded; `--check` on the reference machine |
| R9 | Client or server data later places 2991 or 2997 | Placements change only through cited rows; T4 detects a change; `Cache/` rows stay UNKNOWN |
| R10 | The React costs stay high on a laptop | PERF-11 done; progress throttling by its owners; ATL.9 re-measures |
| R11 | GitHub Pages revalidates tiles after 10 minutes | Small conditional requests; a service-worker cache later if measured to matter |
| R12 | Local-maps mode stays one image at a time | Dev and preview only; documented |
| R13 | Presentation and atlas interfaces drift | §8.7 agreed in MP.0c before MP.1; descriptors stay in world coordinates except the tile descriptor |
| R14 | The card, or the compact layout, is read as geography | Caption, legend and status text; no lines to the card; vector frame; the layout note in MAPS §7.1 |
| R15 | Budget growth when a client pin changes | Per-level baselines + 10 %, ≤ 32 kB per file, 8 MB cap with 1.1 MB headroom |
| R16 | The alterations (masks, mirror fills, tint, sea) go beyond what D-041 H decided | Listed in the manifest and NOTICE and put to the owner (O11); the tool can build without the mirror fill (labels then stay whole over the plans or cut, the owner's choice) |

---

## 13. Edits this design needs elsewhere (for their owners)

- **ARCHITECTURE §7.1**: `setSurface` comment gains `'atlas'`. **§7.2**: replace "Painted art … is
  drawn one image at a time" and the deferred-overview bullet with the atlas (one surface for maps 0
  and 1 plus insets; tiles and underlay; per-map builders; connectors). **§4 and the architecture
  test**: the file-level rule of §8.1. **§14**: rows for `public/maps/atlas` (≤ 8.0 MB, ≤ 32 kB per
  file, per level + 10 %) and `public/maps/art` (≤ 1.0 MB); time rows for the wheel trip, gesture
  frames, band crossing, holes and hairline gaps (§9.2). **§16**: the dist audit's tiled mode and the
  `maps/atlas` allowlist.
- **MAPS**: §1 renderer row; **§7.1** the surfaces table (the atlas row, the compact layout and its
  note that relative positions are a layout choice; `world:0`, `world:1`, `world:2991` retired;
  `minZoomFor` over the atlas extent, card included; `zoomSnap` 0); **§7.2** shared cap; **§7.4**
  connectors; **§7.5** "Painted art" (tiles, underlay, painted-ground fallback, label list, tint,
  sea colours), "Relief" (fallback only on the atlas), "Grid", "Leaflet internals" (the new names),
  the wheel; **§7.6** the new tests; **§9** the redistribution record (the atlas tiles are D-033 art
  composited with D-032 data, with the listed alterations); **§10** M3 (islands: the client places
  neither, 1.60.1.70009).
- **research/coordinates.md**: **§12** and **C1** answered for build 1.60.1.70009: the client places
  neither 2991 nor 2997 on 947 (`UiMapAssignment` only for MapIDs 0 and 1; `UiMapLink` 0 records; `Map`
  parents −1); server rows UNKNOWN. **§14.1**: the atlas surface maths (translation per placement)
  replaces the overview formula.
- **research/map-presentation.md**: §5.1 hysteresis as a fixed 0.125 zoom; the fit view is −5.22 in
  the 918 px panel with the compact layout (its −5.39 was over the 947 land span only); §18 and MP.0c
  point to §8.7 here; §12.4's tint is now also the atlas's backdrop; §12.3 criterion results recorded
  after MP.12.
- **UI.md §12**: switcher entries and presets; the inset note in the legend and status; ± buttons
  one level; "Painted art" toggle meaning. **§9**: the map's instructions text. **§3**: the contrast
  pairs `--frl-map-frame` on both sea colours.
- **DECISIONS**: **D-042** (§14: the atlas surface, translation-only placement, the compact layout,
  the inset and where it lives, the art composition, fallbacks, label rules and alterations, the
  pyramid, the underlay, budgets). Status lines: **D-018/F23** (overview no longer deferred),
  **D-033** (the committed art allowlist extends to `public/maps/atlas/`: tiles, index, manifest and
  NOTICE; `public/maps/art/` keeps 2521, 2524 and 1459–1461; the tiles alter the art as listed in
  O11) (MA-13), **D-034 item 4** (the 12 MB art budget superseded by D-042's `atlas` and `art`
  budgets), **D-038** ("Superseded before commit" item done by D-042).
- **STATUS**: the map-rework row points here; owner decisions O1–O11 as OD rows; "Exact next tasks"
  ATL.0 to ATL.11; the sizes row gains `atlas`.
- **Dist audit**: `tools/build/audit-dist.ts` (tiled mode), `tools/build/dist-requirements.json`
  (`mapFolders` entry for `maps/atlas`; `maps/art` baselines pruned), `tools/maps/lib/art-checks.ts`
  (A5 counts subfolders), their tests.
- **THIRD_PARTY_NOTICES**: "Map art" gains the atlas tiles (Blizzard Entertainment's artwork,
  composited by this project's tool with terrain-derived masks, tint and shading, with the listed
  alterations, D-032 and D-033). "Ported code": nothing (no WoWF-QRP code is ported; the wheel handler
  and underlay are our own).
- **README and About dialog**: the art notice names the composited atlas; the laptop runbook.

---

## 14. Decisions for the architect and owner

### 14.1 For the owner

| # | Question | Default (recommended) | Alternatives and evidence |
|---|---|---|---|
| O1 | Replace the per-world-map surfaces with the atlas? | Yes; "Kalimdor" and "Eastern Kingdoms" stay as presets; Zephras Isle joins as an inset | Keep `world:*` surfaces as well |
| O2 | Zephras Isle as a card with the caption of §5.5; Darkspear Islands stays a separate battleground surface | Yes | Show Darkspear on the card row too; or a card outside the map |
| O3 | The sea | Painted water rgb(131, 118, 88) at the coast, deepening to rgb(61, 55, 41) offshore (contrast 2.65:1) | Flat painted water (revision 1, 1.01:1); navy like MapGenie; a coastline stroke from the presentation layer |
| O4 | The world view | One raster at every zoom | The 947 painting below −5.5 with one crossfade (needs the 947 layout, O9) |
| O5 | Budgets | `atlas` ≤ 8.0 MB and `art` ≤ 1.0 MB; stop deploying the per-image art the atlas replaces | Keep every per-image WebP too (≈ 16 MB with the atlas) |
| O6 | Land no zone painting shows (12–13 %) | The area's tint shaded by the relief, at every level (`<rv>/img/places-sheet.jpg`) | The continent painting at the world and continent bands, fading to the tint (`cmp-tint-fade-*.jpg`, +233 kB); revision 1's parchment fallback (fragments) |
| O7 | Wheel rate | 0.5 level per physical notch after calibration; trackpad calibrated apart | Slower (0.4) or faster |
| O8 | Review gate | The owner signs off the contact sheet before tiles are committed, and after any parameter change | Architect review only |
| **O9** | **Layout** | **Compact**: Eastern Kingdoms 7,168 yd west, card at the top of the gap; fit −5.22 in 918×700; gap 0.39 Kalimdor widths | The game's 947 layout: fit −5.62 (0.40 levels smaller), gap 0.97; required for O4 |
| **O10** | **Sharpness against size** | Round up the seven zones stored more than 1.2× coarser than their art: 6.88 MB (+536,636 B, +8.5 %); worst remaining 1.20× | Nearest level: 6.35 MB, 18 zones up to 1.39× coarser (softer painted names than today's layer); full round-up: 8.50 MB, over the cap |
| **O11** | **Alterations to Blizzard's art in the tiles** (MA-13; no legal conclusion is drawn here). The tiles (1) mask each painting to its terrain polygon, painted ground and coastal band, and cross-fade neighbouring paintings' colour over ±200 yd; (2) hide nine painted labels by a mirror fill from the same painting (the six capital banners at levels −1 and 0; three duplicate names at every level); (3) draw our own relief-shaded tint where no painting shows; (4) draw the sea in our two colours outside the paintings' coastal bands; (5) resample and re-encode (WebP q80). Revision 1 also refilled the continent paintings' lettering; revision 2 does not draw the continent paintings | Accept all five as within D-041 H ("composed seamlessly") | Decline (2): banners then stay whole over the plans, covering part of them, and the duplicates stay; decline (3)/(4): parchment or flat colour instead, with the fragments of revision 1 |

### 14.2 For the architect

| # | Question | Default |
|---|---|---|
| A1 | Placement | Translation only in yards, shifts in whole 1,024-yd tiles, against an exact 947 scale per map (0.42 % off on the Eastern Kingdoms) |
| A2 | Layer building | Per-map builders joined in the controller (C) |
| A3 | Tiles | One layer with virtual and sea keys plus a level −5 underlay, against stacked per-level layers or a complete level −2 |
| A4 | Leaflet internals | Accept the names of §8.4, pinned to 1.9.4 |
| A5 | Clicks | Partition, so every click yields a point and `MapEvent` is unchanged |
| A6 | Build inputs | Lossless client rasters and overlay unions, so the atlas build needs the client as `convert.ts` does; `--check` a manual gate until CI |
| A7 | Decision number | D-042 |
| A8 | Zone frames on the atlas | Not drawn while tiles show; terrain outlines on by default |
| **A9** | **Where the layout lives** | `src/geo/atlas-layout.ts`, pinned by T4, with the file-level architecture rule of §8.1 |
| **A10** | **Loading** | The underlay and ancestor-first tiles together; `fadeAnimation` off on the map, the layer's own image fade |
| **A11** | **Label list governance** | `tools/maps/inputs/atlas-labels.json`, seeded by the detector, reviewed on the contact sheet, pinned by each painting's `pixelsSha256` (T9); T7 fails on any cut label |

No legal conclusion is drawn in this document. D-033's other terms stand: the tiles are Blizzard's
art under its NOTICE, the site stays non-commercial, and the art is removed promptly on request.

---

## 15. Evidence and sources

- Client facts (u1): `<ma>/client-facts.md`, `client-facts.json`, `transforms.json`, `tables.json`,
  `u1/` (with `raw/`), `scripts/`; re-derived by the review (`<ma>/critic/rederive.ts`, `rederive.txt`).
- Performance (u2): `<ma>/perf.md`, `<ma>/u2/`; the review's wheel run `<ma>/critic/wheel-prod-x1.json`.
- Prior art and code impact: `<ma>/prior-art.md`, `<ma>/code-impact.md`.
- Designs, judges and revision 1: `<ma>/design-*/`, `<ma>/judge-*/`, `<ma>/synth/`.
- Review: [docs/reviews/review-map-atlas-design.md](../reviews/review-map-atlas-design.md) and
  `<ma>/critic/`.
- **Revision 2**: `<ma>/revise/` (`proto2.mjs` and the scripts and sheets listed in the header).
- Presentation: [map-presentation.md](map-presentation.md) §3, §5, §12, §13.5, §17.4, §18, and its
  evidence `.cache/map-presentation/` (the benchmark screenshots, read only).
- Leaflet 1.9.4: `node_modules/.pnpm/leaflet@1.9.4/node_modules/leaflet/dist/leaflet-src.js` lines
  3354 (`setZoomAround`), 3577 and 4386 (`_panInsideMaxBounds`), 4315–4357 (`_moveStart`, `_move`,
  `_moveEnd`), 4647 (`_limitCenter`), 11201–11203 (`updateInterval`), 11343–11363 (`getEvents`),
  11517–11600 (`_pruneTiles`, `_retainParent`), 11630 (`_resetView`), 11730–11800 (`_onMoveEnd`,
  `_update`), 12671 (the canvas backing store), 14384 (the pinch path).
- WoWF-QRP: https://github.com/tyba-dev/WoWF-QRP (GPL-3.0; code read under D-029, nothing ported);
  https://tyba-dev.github.io/WoWF-QRP/ (not visited for revision 2; saved screenshots).
- MapGenie: https://mapgenie.io/world-of-warcraft-forever/maps/azeroth (not visited; saved
  screenshots and recorded observations).
