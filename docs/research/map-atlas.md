# Map atlas (design, revision 3.1)

Status: **implementable design, 2026-09-27, revision 3.1: Part II, the minimap style (§16–§28), revised
after its review.** The owner chose a MapGenie-style base (D-045 and its addendum): the client's minimap
textures, with a navy sea, are the default base map, and the painted atlas of Part I stays as a style the
user can switch to. Part II designs the minimap tile tool, the sea recolour, the format (a real AVIF
against WebP comparison), the style switch, labels, hosting, budgets and gates, the steps MM.0–MM.9,
the risks and a comparison with MapGenie, each measured on a prototype (§16 summarises it). Revision 3
edited Part I only where the style switch touches it (§0.2). **Revision 3.1** resolves the review
[docs/reviews/review-map-minimap-design.md](../reviews/review-map-minimap-design.md) (MM-01 to MM-11,
§0.3): a new sea recolour rebuilt and re-measured as `b5`, an independent seam measure, a dist audit that
does not need the tiles, a release pack that carries its notice, a memory budget, and the minimap default
held until the presentation's names exist.

Part I (§0–§15) is revision 2: it answers the owner's map feedback of 2026-09-26 (§1) and his two
benchmarks, WoWF-QRP and MapGenie. Revision 1 was the synthesis of three competing designs (A
fidelity-first, B performance-first, C minimal-change) and two judges' reports; revision 2 resolved
the adversarial review [docs/reviews/review-map-atlas-design.md](../reviews/review-map-atlas-design.md)
(MA-01 to MA-15; §0.1 maps each finding to its section) with a second prototype that measures every
changed number (§6, §7). **Part I is built as ATL.0–ATL.8** in the working tree (not yet committed;
§3.5); ATL.9–ATL.11 remain.

Authority: [ARCHITECTURE.md](../ARCHITECTURE.md) and [DECISIONS.md](../DECISIONS.md) win over this file,
in particular D-017, D-018, D-022, D-029, D-032, D-033, D-034, D-038, D-039, D-041, D-042 (Part I's
decisions), D-045 and its addendum (Part II's brief), D-046 and D-047. §13 lists the edits this design
needs elsewhere; §14 lists Part I's decisions (adopted as D-042) and §28 Part II's, proposed as one new
record, D-049 (§25, step MM.0).
The presentation layer (quests, dungeons, flight paths, transports, zone colouring and labels) is
designed separately in [map-presentation.md](map-presentation.md); §8.7 is the interface both depend
on (its step MP.0c).

**Labels.** **MEASURED**: run here or by a named report, with its method and evidence file.
**CITED**: a client value cited by table, row and build (D-022), or (revision 3) a published
document's figure, named with the date it was read. **OBSERVED**: seen on a live site with
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
- **Revision 3**: `.cache/minimap-probe/` and `.cache/minimap-probe-final.json` (the minimap probe and
  its independent check), and **`.cache/minimap-addendum/`** (`<mm>`), Part II's prototype, runs and
  images, listed at the head of Part II. No third-party site was visited for revision 3 either.
- **Revision 3.1**: `<mm>/r31/` (the revised rule, its builds' census, the independent seam measure,
  the contact sheets and the format A/B on the new build) and the review's scratch
  `<mm>/review-mm/`, listed at the head of Part II. No third-party site was visited and the client was
  not opened.

---

## 0. Summary

| Topic | Decision | Evidence |
|---|---|---|
| **Base style (revision 3, 3.1)** | **The minimap style is the default** (D-045): the client's minimap textures on the same surface, layout, tile engine, underlay and wheel, with a navy sea (Part II, summary in §16), once the presentation's names exist (MM.9). The painted atlas below is the other style, kept with its painted-water sea. The rows below describe the painted style and the shared machinery. | §16–§28 |
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

### 0.2 What revision 3 changed

| Change | Why | Where |
|---|---|---|
| Part II added: the minimap style, the default base (tool, recolour, format, switch, labels, hosting, budgets, steps, risks, MapGenie) | D-045 and its addendum | §16–§28 |
| Status, authority and evidence lines; Part I is built as ATL.0–ATL.8 | the working tree of 2026-09-27 | header, §3.5 |
| §0's first row: the default style | D-045 item 1 | §0 |
| Budgets: `atlas` and `art` unchanged for the painted style; a new `minimap` budget | measured build | §7.6, §24 |
| Tiles: one band per style, decoded keys per band, the switch holds the old picture | two tile sets on one layer engine | §8.3, §21.2 |
| Modes: the two styles and their fallbacks | §21.4 | §8.6 |
| Interface: `MapStyle`; `BaseMapLabels` empty in the minimap style; the sea per style | map-presentation §25.8's MP.0c remainder | §8.7 |
| Gates run in both styles; the minimap style's own contrast criterion | the minimap's land is darker than the painted art (§19.3) | §9.2, §24.1 |
| §10 compares the painted style; §27 the minimap style | – | §10, §27 |
| Steps MM.0–MM.9 after ATL.8; ATL.9 measures both styles, ATL.10 makes the minimap the default | – | §11, §25 |
| Risks, edits elsewhere and decisions for Part II | – | §12, §13, §14, §26, §28 |

### 0.3 What revision 3.1 changed (review MM-01 to MM-11)

Every figure of §16–§20 and §24 is restated from the new build `b5`; revision 3's `b4` is re-measured by
the same code (`b4r`, identical to `b4`) so each change is shown against it.

| Finding | Severity | Resolution | Where |
|---|---|---|---|
| MM-01 posterised shallows and lakes | blocker | One reference per neighbourhood: a family field per tile (b − g averaged over about 50 texels) replaces the per-texel split; a texture census and gate; contact sheets at 1:1, 2:1 and 3:1 of native pixels; rebuilt as `b5`. Amplified wet blocks 8.9 % → 0.29 % (EK) and 6.3 % → 0.25 % (Kalimdor) by the review's own measure; water-to-water inversions 6.4 % → 0.025 % and 7.1 % → 0.002 % | §18.10, §19.2, §19.5 |
| MM-02 bank land recoloured, bright river inverted | major | Gate reach 25 yd → 8.3 yd; dry texels never brighten (a cap on the ramp and a clamp after the feathers); coloured water outside both families kept (the violet river); rates over shore land (fully dry shore cells bluer 0.63 % → 0.03 %, 0.45 % → 0.007 %); the banks on the sheet; M8 over shore cells | §19.1, §19.2, §19.5, §24.4 |
| MM-03 seam figures measure what the feather cancels; `b3` misattributed | major | An independent measure on the pyramid at levels −1 to −3 with control lines, every edge with water counted (long ADT edges over 4 levels at level −2: 104 → 13 and 45 → 9 from the source, about the control lines' 1–2 %); the edge feather smoothed and tapered along the edge; a corner term; a navy floor; `b3` corrected to 12 and 11, largest 45.2; offline check M11 | §19.2, §19.5, §24.4, §28 O15 |
| MM-04 `pnpm check` depends on untracked tiles | major | The dist audit gains an `external` prefix: plain mode (so `pnpm check`) passes without the tiles and says so; deploy mode (`pnpm build:deploy`, the Pages workflow) requires them | §23.4, §24.3, §25 MM.6, §13 |
| MM-05 MM.9 can make the minimap the default before names exist | major | MM.9 depends on MM.8, MP.1 and MP.7; MM.7 on MP.4b (the drawer); STATUS's order to change accordingly (§13) | §22, §25, §13 |
| MM-06 release pack misses D-033 rules 2 and 3 | major | `NOTICE.md` and `manifest.json` inside the pack, first; the NOTICE as the release text; removal redeploys Pages and confirms the 404s | §18.2, §23.3, §24.4 M7 |
| MM-07 AVIF not "as good by eye" | minor | A/B and a per-level sweep on `b5`, magnified bilinearly: AVIF q60 4:2:0 is softer at the zone and region bands; the AVIF that is as good (q70 4:2:0) saves nothing. O13 restated; WebP q80 stands | §20 |
| MM-08 swamp water kept without a question | minor | Stated, measured (a two-style lake, the swamp coasts), a trial rule shown and rejected, owner question O20 with a sheet | §19.8, §28 O20 |
| MM-09 decoded-tile memory not budgeted | minor | Budgets per style in view, with the kept buffer and during the hold; minimap underlay at level −6 and `keepBuffer` 1; measured in MM.8 | §21.2, §24.5, §9.2 |
| MM-10 dark smudge at Zephras Isle's dock | minor | The haze is found by a flood through dark texels from the void and composited by coverage, not by distance; the dock on the sheet | §19.2 step 6, §19.4 |
| MM-11 labels and method changes | minor | Manifest size an ESTIMATE with every record (about 385 kB); the index's sea colour #0d1b30; both contrast methods in §19.3, §24.1 and §27, with Part I's method kept for the gate; Lanczos-3's trade-off stated | §18.3, §18.4, §18.8, §19.3, §24.1, §27 |

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

- **Revision 3:** ATL.0 to ATL.8 are built in the working tree and not yet committed (the build
  teams' reports, `.cache/map-build-partial.json`): the wheel setting, `src/geo/atlas-layout.ts` and
  `atlas.ts`, the per-map builders, the atlas surface behind its switch, `tools/maps/atlas.ts` with
  `public/maps/atlas/` (792 tiles, 6,946,513 B with its index, manifest and NOTICE; the dist audit's
  tiled mode), the tile layer, underlay and index loader (`src/map/leaflet/atlas-tile-layer.ts`,
  `atlas-underlay.ts`, `atlas-decoded.ts`, `src/infra/maps/atlas-index.ts`) and the smooth wheel.
  ATL.9 (measure), ATL.10 (on by default) and ATL.11 (edits elsewhere) remain; Part II's steps come
  between ATL.8 and ATL.9 (§25). The owner's contact-sheet sign-off (O8) is still owed.
- The art and terrain layers are committed with Milestone 6 and 3b.6. D-038 keeps the one-image
  rendering only until the atlas replaces it. Another team is building the Milestone 6 UI in the
  working tree; this design's steps start after it has landed (§11).
- **Revision 3.1:** decisions now run to D-048 (D-045 the minimap base, D-046 the WoWF-QRP-style UI,
  D-047 the presentation's pins and drawer, D-048 the UI refresh), so Part II's record is proposed as
  D-049. The drawer of D-047 holds the style switch and replaces the status line (§21).
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
- **Revision 3:** these two budgets are the painted style's and do not change. The minimap style has
  its own `minimap` folder and budget (≤ 60 MB gzip-6, ≤ 32 kB per tile, per-level baselines;
  §24), measured on its build (revision 3.1's `b5`: 51.8 MB), and its tiles come from a release pack
  that `pnpm check` does not need (§23.4, §24.3).

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
- **Revision 3, one band per style (§21.2):** the tile band's id names its style
  (`atlas-tiles:minimap`, `atlas-tiles:painted`); decoded keys are kept per band, never shared
  between styles; on a switch the new `AtlasTiles` (tiles and underlay) is added above the old one,
  which is removed once the new first view has decoded (or after 2 s). **Revision 3.1:** the underlay's
  level is the index's `underlayLevel` (−5 painted, −6 minimap), the band carries its `keepBuffer` (2
  painted, 1 minimap), and the old band's off-view tiles are pruned when a switch starts, to meet §24.5's
  decoded-memory budgets. Everything else in this section serves both styles unchanged.
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
| Minimap style (revision 3, the default after MM.9, which waits for the presentation's names) | The minimap band (`maps/minimap/`) and its level −6 underlay on a navy container; zone outlines on; Ironforge's and the Undercity's frames dashed from the zone band (§22) |
| Painted style (revision 3) | This design's band (`maps/atlas/`) on its painted-water container, as the row above |
| Minimap index refused, tiles missing (for example a clone without the pack), or AVIF unsupported (revision 3) | The painted style, with the reason where the drawer shows map notices (§21.4); the choice is not stored |
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
   painted, so zone labels are always the presentation's. **Revision 3:** in the minimap style
   `BaseMapLabels` is empty (the minimap has no names; its index's `uiMaps` is empty), and Ironforge
   and the Undercity are named as underground cities by the presentation (§22).
5. The `frl-tint` pane (z 255) and the `frl-labels` pane (z 450) are reserved for it; `frl-underlay`
   (z 244) is the atlas's.
6. Zone-colour criteria (map-presentation §12.3): criterion 2 holds by construction at levels ≤ −2;
   criteria 1 and 3 are measured in MP.12; land no painting reaches shows the area's own tint, so every
   zone keeps a colour of its own.
7. Band hysteresis: with `zoomSnap` 0 the presentation's "half a `zoomSnap` step" becomes a fixed
   0.125 zoom.
8. The presentation's `coastline` layer (D-032 arcs) may stroke coasts at the world band; the atlas
   meets its contrast criterion without it. In the minimap style (revision 3) it may help at
   the world band too: that style's own criterion is met without it (§24.1).
9. **Revision 3 (the MP.0c remainder, map-presentation §25.8):** `MapStyle` (`minimap` or `painted`)
   in the adapter's options and status; the sea colour per style from the drawn band's index; the
   container attribute `data-map-style` for the presentation's palette (its §25.4). The navy is
   #0d1b30 (§19.3), the presentation's own candidate.

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
  **2.65:1** (level −6), 2.63:1 (level −5); revision 1: 1.01:1. **Revision 3.1:** this is the painted
  style's criterion. The minimap style's land is darker, so by the same method it has its own threshold,
  ≥ 2.0:1 (measured 2.09:1; MapGenie's saved shot 2.60:1 with its pins and labels; O17, §19.3). Every
  gate of this section runs in both styles in ATL.9 (MM.8), and the style switch is added to the hole
  cases.
- ARCHITECTURE §14 unchanged: `moveend` redraw ≤ 16 ms at the cap, one route edit ≤ 8 ms
  (`map-edit.bench.ts` gains a two-builder atlas case within its baseline + 25 %).
- ≤ 40 tile elements in view and ≤ 12 MB of decoded tiles (underlay included), per style. **Revision
  3.1:** also ≤ 20 MB of live tile images with the kept buffer, and ≤ 26 MB for at most 2 s during a
  style switch (§24.5, MM-09), counted as live tile images × 262,144 B.
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

**Revision 3:** this section compares the painted style (Part I). The minimap style, now the
default, is compared with MapGenie in §27; it closes this table's "short" on close-zoom resolution
(1 yd/px everywhere) and gives up the painted names, which the presentation layer supplies.

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

**Revision 3:** ATL.0 to ATL.8 are built (§3.5). Part II's steps MM.0 to MM.7 (§25) come next; ATL.9
then runs as MM.8, measuring both styles, and ATL.10 switches the atlas on with the minimap style as
the default (MM.9). ATL.11's edit list gains Part II's (§13). **Revision 3.1:** ATL.10/MM.9 also waits
for the presentation's labels canvas (MP.1) and names (MP.7), because the minimap draws no names; until
then ATL.10 may switch the atlas on with the painted style as the default. "Every step ends green on
`pnpm check`" holds without the minimap tiles (§23.4).

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
| ATL.10 On by default; prune art | options on; `world:0`, `world:1`, `world:2991` retired; presets; the tests of code-impact §4 updated deliberately; `convert.ts` deploys only 2521, 2524, 1459–1461 | dist audit; art manifest checks | `art` ≤ 1.0 MB | ATL.9 green; O5; for the minimap as default, MM.9's MP.1 and MP.7 |
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
| R17 | Revision 3: the minimap style (the default) adds its own risks: hosting, the recolour, residual seams, contrast, names, memory, kept swamp water | §26 (MR1–MR16) |

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

**Revision 3 (Part II) adds:**

- **DECISIONS**: one record for Part II (O12–O20, A12–A21; §28), proposed as **D-049** (D-047 and
  D-048 are taken); status lines on **D-033** (the committed allowlist extends to
  `public/maps/minimap/`: index, manifest, NOTICE and pack pointer, with the tiles shipped from the
  release pack, which carries the NOTICE; the tiles alter the textures as §18.8 lists; removal redeploys
  Pages) and on **D-045** (the budget and format set from the measured build, as its addendum asks; the
  owner's "every water tone" read as the two families and their shallows, with coloured and swamp water
  kept, O12 and O20).
- **STATUS** (revision 3.1, MM-04 and MM-05):
  - owner rows for O12–O20;
  - "Exact next tasks" in this order: ATL.0–ATL.8 (built); MM.0–MM.8 alongside the presentation's MP.0
    to MP.7; ATL.10 with the minimap as default (MM.9) only after MM.8, MP.1 and MP.7 (the present
    wording, "atlas steps ATL.0-ATL.11, then presentation steps MP.*", would switch the minimap on with no
    names);
  - the sizes row gains `minimap`; the manual gates gain `minimap.ts --check` with the pack's tree hash;
  - `pnpm check` passes without the minimap tiles and prints that they are absent; `pnpm build:deploy`
    (the Pages workflow) requires them; `pnpm maps:minimap:fetch` joins the important commands;
  - the release of the pack waits on OD-13; a removal is recorded with its 404 check.
- **ARCHITECTURE**: §7.2 the two styles and the band per style; §12.3 the style in the per-browser
  settings; §14 the `minimap` budget rows (§24), the decoded-memory rows (§24.5) and the style-switch
  hole case; §16 the audit's new folder, its `external` prefix with the plain and deploy modes, and the
  pack fetch in the deploy build.
- **MAPS**: §1 the base styles; §7.5 the minimap style (tiles, navy, no painted names, outlines on);
  §9 the redistribution record (the client's minimap textures, D-033 and D-045, the listed
  alterations, the release pack); §10 the minimap tool and its checks.
- **map-presentation.md** (for its owners; revision 3 is in progress there): §22's requests
  (`BaseMapLabels` empty in the minimap style; Ironforge and the Undercity labelled as underground
  cities with a dashed frame from the zone band); the navy #0d1b30 as its `--frl-map-sea-navy`; the
  style switch in the category drawer (its MP.4b) and the one settings record (§21.3); the map notices
  of §21.4 in the drawer; the atlas's MM.9 waits for its MP.1 and MP.7, and MP.7's test (every levelling
  zone named at the fit-both view) also runs in the minimap style.
- **UI.md**: §3 the navy token and its pair with `--frl-map-frame` (≥ 3:1); §12 the style switch, its
  persistence and its fallbacks; §9 the map's instruction text naming the style.
- **THIRD_PARTY_NOTICES, README and the About dialog**: the minimap tiles as Blizzard Entertainment's
  artwork (the client's minimap textures) with the alterations and non-affiliation; both NOTICEs
  named; the README's build steps gain `pnpm maps:minimap:fetch`.
- **Dist audit and gates**: `tools/build/dist-requirements.json` (`minimap` folder with its `external`
  prefix, §24.3), `tools/build/lib/audit.ts` and `audit-dist.ts` (plain and deploy modes),
  `package.json` (`build:deploy`), `tools/maps/validate.ts` (M1–M11), `.gitignore` (allow
  `public/maps/minimap/`, ignore its `t/`).
- **tools/maps/README.md**: the minimap tool, its inputs, `--check`, `--review`, `--pack`, the census
  gates, and the fetch script; the removal steps of §23.3.

---

## 14. Decisions for the architect and owner

These are Part I's, adopted as D-042 (owner O3, O9 and O11; the rest as defaults). **Part II's
decisions are in §28** (O12–O20, A12–A21).

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
- **Revision 3**: the minimap probe and its check (`.cache/minimap-probe/`,
  `.cache/minimap-probe-final.json`); Part II's prototype `.cache/minimap-addendum/` (listed at the head
  of Part II); GitHub Docs on Pages limits, release assets and Git LFS, and caniuse.com on AVIF, read
  2026-09-27 (§20.6, §23.2).
- **Revision 3.1**: the review [docs/reviews/review-map-minimap-design.md](../reviews/review-map-minimap-design.md)
  with its scratch `.cache/minimap-addendum/review-mm/`; the revised prototype
  `.cache/minimap-addendum/r31/` and the builds `b5`, `b5b`, `b4r` and `b0` (listed at the head of Part II).

---

# Part II. Minimap style (revision 3.1)

Part II designs the owner's D-045 and its addendum: the client's minimap textures become the atlas's
default base map, with a navy sea, and the painted atlas of Part I stays as a style the user can switch
to. It reuses Part I's surface, layout, placements, tile engine, underlay and wheel unchanged (D-045
item 2); what it adds is a second tile set, the tool that makes it, the sea recolour, the format, the
style switch, the hosting of about 52 MB of tiles, budgets and gates, a step plan and the risks.

**Revision 3.1** answers the review [docs/reviews/review-map-minimap-design.md](../reviews/review-map-minimap-design.md)
(MM-01 to MM-11; §0.3 maps each finding to its section). The sea recolour is redesigned (§19.2) and
rebuilt as **`b5`**, and every figure of §18–§20 and §24 is restated from that build; hosting, the dist
audit, the default step and the memory budget change (§21.2, §23, §24, §25).

**Evidence** (gitignored; `<mm>` is `.cache/minimap-addendum`, `<mp>` is `.cache/minimap-probe`,
`<r31>` is `<mm>/r31`):

- `<mp>/` and `.cache/minimap-probe-final.json`: the probe and its independent check (2026-09-27).
- `<mm>/lib.ts`, `recolour.ts`, `metrics.ts`, `tiles.ts`: the prototype's shared code; `<mm>/p1-load.ts` …
  `p21-m9.ts`: revision 3's scripts, results in `<mm>/out/`.
- **`<r31>/`: revision 3.1's prototype.** `rule3.ts` is the rule (its `P31` object holds every
  parameter; its `P3B4` object reproduces revision 3's rule); `build3.ts` builds a pyramid with the census
  of §19.5; `seams-levels.ts` is the independent seam measure; `amplify5.ts` and `halo5.ts` are the
  review's own texture and shore measures, run on any build; `hue-census.ts`, `split-census.ts`,
  `contrast5.ts`, `m9.ts`, `index5.ts`, `parse5.ts`, `sweep5.ts`, `ab5.ts`, `rivercheck5.ts`; `iter.ts`,
  `diag-edge.ts` and `overview.ts` were used to tune the rule; `sheet.ts` and `sheets.sh` draw the contact
  sheets. Results in `<r31>/out/`, images in `<r31>/img/`.
- **The recommended build is `b5`** (`<mm>/out/b5/`: raw tiles, `index.json` with a hash per raw tile,
  `report.json` with the census; `b5b/` is its second run; `webp80/t/` and `avif60-420/t/` its encoded
  tiles; `pub-webp80/` the prototype's published folder; `pack-webp80.tar`). `b4` is revision 3's build;
  **`b4r`** is `b4` rebuilt by `build3.ts` with `P3B4`, identical to `b4` on all 6,655 tiles and every sea
  key (MEASURED), so revision 3's figures below are re-measured by the same code as revision 3.1's; **`b0`**
  is the source drawn through the same stitch and resample with no recolour, the "before" of every sheet.
  Revision 3's runs `b1`–`b3` are kept for comparison.
- **Images** (all at native pixels, nearest-neighbour magnification, source | `b4` | `b5`):
  `<r31>/img/mm31-1to1-{A,B,C,D}.png` and `mm31-2to1-{A,B,C,D}.png` (the named places of §18.10),
  `mm31-worst-seams.png` (the worst edges left by §19.5's independent measure), `mm31-stv-corner-3to1.png`
  (a residual patch, §19.6); the format A/B `ab5-{1,2,3}to1-{a,b}.png` (magnified bilinearly, §20.3); the
  swamp trial `brown.png` (§19.8). Revision 3's images (`<mm>/img/`) averaged 2 × 2 or 4 × 4 texels and are
  superseded.
- No third-party site was visited. MapGenie facts come from the saved screenshots of 2026-09-26
  (`.cache/map-presentation/mapgenie/shots/`). The client was not opened for revision 3.1: every run reads
  revision 3's decoded cache (`<mm>/raw/`, from `tools/casc`, `.build.info` and `Data/` only, build
  1.60.1.70009). Machine and units as Part I's header.

---

## 16. Summary

| Topic | Decision | Evidence |
|---|---|---|
| What is drawn | The client's minimap textures of maps 1, 0 and 2991 (1,796 tiles of 512 × 512 DXT1 at 1.0417 yd per texel), stitched onto Part I's atlas grid in the compact layout with Zephras Isle's card, resampled to 1 yd/px at level 0, reduced to level −8. Only the default phase (D-045 addendum). | §17; MEASURED |
| The tool | `tools/maps/minimap.ts`, a sibling of `atlas.ts` sharing its index writer, reductions, manifest helpers and checks harness. The client-backed build takes about 5 min (ESTIMATE by sum: decode 35 s, liquid grid 6 s, recolour 145–154 s, stitch and pyramid 72 s, WebP encode 30 s with 16 jobs). The raw pyramid is byte-identical over two runs, and the encoded tiles across job counts. | §18; MEASURED |
| Resampling | To our exact levels (Lanczos-3, 25 output pixels per 24 texels), not the native grid. Lanczos-3 keeps the most structure (SSIM-Y) at the cost of a slightly lower PSNR-Y than bilinear or Catmull-Rom and faint ringing at hard edges. | §18.3; MEASURED |
| Sea | One colour-only water map, gated by the client's liquid grid within 4–8 yd of wet quads, with **one reference per neighbourhood** (a family field per tile), so no texel's own tint can flip it: the two water families and their shallows go onto a navy ramp from **#0d1b30** to rgb(60, 92, 130); dry texels never brighten; the edge feather is smoothed along the edge and completed at ADT corners; lava, slime, bright ponds and the violet river by Dalaran keep their colours; swamp water is kept as drawn (owner question O20). Against revision 3: wet blocks whose texture more than doubles 8.9 % → 0.29 % (Eastern Kingdoms) and 6.3 % → 0.25 % (Kalimdor); water-to-water brightness inversions 6.4 % → 0.025 % and 7.1 % → 0.002 % of pairs; fully dry shore cells turned bluer 0.63 % → 0.03 % and 0.45 % → 0.007 %; long ADT edges with a step over 4 levels at the zone band (−2) 104 → 13 and 45 → 9 from the source, close to the 1–2 % of lines that are not ADT edges. | §19; MEASURED |
| Format | **WebP q80**, by the owner's rule: no AVIF setting is both as good at every level and smaller. AVIF q60 4:2:0 is 0.80× the bytes but softer at the zone and region bands (median −0.56 dB at −2, −2.45 dB at −3); AVIF q70 4:2:0 is as good or better everywhere but 1.02–1.13× the bytes. | §20; MEASURED |
| Size | 6,669 tiles, **51,768,589 B** gzip-6 (median 7.9 kB, largest 23.9 kB); index 2,272 B; manifest about 385 kB (ESTIMATE). First view 85 kB (13 tiles at level −5 and the index). | §18, §24; MEASURED |
| Style switch | Two indices of one shape, one tile band per style, decoded tiles kept per band, the old band held until the new one's first view has decoded, **with a decoded-memory budget per style that covers the hold**; the minimap style's underlay is level −6 (4 tiles); the choice is a per-browser view setting. | §21, §24.5 |
| Labels | The minimap has no names. Zone, continent and city names come from the presentation layer, with Ironforge and the Undercity named as underground cities; **the minimap becomes the default only after those names exist** (MM.9 after MP.1 and MP.7). | §22, §25 |
| Hosting | The tiles are not committed. They ship as a **release-asset tile pack** (the tiles, `NOTICE.md` and `manifest.json`) pinned by SHA-256 in a committed pointer; `main` holds the index, manifest, NOTICE and pointer. `pnpm check` passes without the tiles and says so; only the deploy build (the Pages workflow) requires them. Removal on request deletes the asset, commits the pointer's removal, redeploys Pages and confirms the tiles are gone. | §23 |
| Budgets and gates | `minimap` ≤ 60 MB gzip-6, ≤ 32 kB per tile, per-level baselines + 10 %, first view ≤ 100 kB; decoded tiles ≤ 12 MB in view per style, ≤ 20 MB with the kept buffer, ≤ 26 MB for at most 2 s during a style switch; world-band contrast ≥ 2.0:1 by Part I's method (measured 2.09; O17); the recolour census gates of §19.5; `maps:validate` checks M1–M11 without the client. | §24 |
| Steps | MM.0–MM.9 after ATL.8; MM.9 (ATL.10 with the minimap as default) waits for MM.8 and the presentation's MP.1 and MP.7. | §25 |

---

## 17. Facts used

### 17.1 From the probe and its check (`.cache/minimap-probe-final.json`)

- **Tiles** (MEASURED, raw MAID walk): Eastern Kingdoms 736, Kalimdor 988, Zephras Isle 72; every
  tile has a root ADT, a minimap and a map texture; 0 encrypted, 1,796 of 1,796 verified by MD5.
  Every minimap tile is BLP2 DXT1, alpha depth 0, one mip, 512 × 512, 132,244 bytes: **1.0417 yd per
  texel** (533.33 yd over 512 texels, exactly 25/24). No higher-resolution minimap exists; the MAID
  "map texture" slot is bare ground without buildings or water. Legacy `world/minimaps/…` names are
  not in the root: MAID is the only way to find the tiles.
- **Alignment**: tile (row, col) has its north edge at X = 17,066.67 − row·533.33 and its west edge
  at Y = 17,066.67 − col·533.33 (coordinates.md §2.1); no offset larger than about 4 yd was found
  against the coast data (MEASURED, six samples).
- **Water** is baked into opaque textures in two families, one per tile: *dark* rgb(8, 16, 16) with
  variants rgb(5, 16, 16), rgb(8, 20, 22) and rgb(8, 21, 24), and *navy* rgb(27–33, 47–68, 66–96)
  with rgb(3, 55, 71). Dark tiles are not always dark to the shore (Azshara's north coast,
  Riverglades' east coast have green-teal shallows). Lava is orange-red; Hyjal's slime is
  rgb(36, 208, 0); a Hyjal pond is bright cyan.
- **Black**: 6,592 (EK) and 8,973 (Kalimdor) pure-black texels, none from DXT1 transparency;
  Zephras Isle is 72.4 % pure black, 38 tiles wholly black.
- **Phases**: maps 2868, 2980 and 2959 have their own minimaps (12, 16, 25 tiles); none matches map
  0's at the same position; only the default phase is drawn (D-045 addendum).
- **MapGenie's base matches the stitched minimap** (brightness correlation 0.90 and 0.87 on saved
  shots 04 and 10, controls 0.63 and 0.03).

### 17.2 Measured for this addendum

| Fact | Value | Script |
|---|---|---|
| BLP bytes read | 237,510,224 B in 1,796 files; 1,399 distinct CKeys (775 Kalimdor, 589 EK, 35 Zephras: repeated flat tiles) | `<mm>/p1-load.ts` |
| DXT1 decode with `tools/maps/lib/blp.ts` | 18.7 s (Kalimdor), 14.9 s (EK), 1.5 s (Zephras) | `p1-load.ts` |
| Liquid grid (4.17-yd quads, `tools/terrain` `addTile` over the root ADTs; hazard liquids excluded; a quad is wet under liquid deeper than 0.3 yd) | 3.5 s, 2.5 s, 0.3 s; wet quads 7,950,001 (Kalimdor), 6,176,940 (EK), **26,337 (Zephras Isle)** | `p1-load.ts` |
| That grid against the committed relief's water class (maps 0, 1) | identical on all 753,664 and 1,011,712 compared pixels | `p20-relief-eq.ts` |
| Exactly flat minimap tiles | 96 (Kalimdor), 78 (EK), 38 (Zephras Isle, all black) | `p1-load.ts` |
| Wet texels by colour (8-level bins) | Kalimdor: (8,16,16) 98.7 M of 127.2 M wet texels, then (24,48,64) 7.9 M; EK: (8,16,16) 62.3 M of 98.8 M, (24,48,64) 13.6 M; the rest are shallows, inland lakes of other tones (teal-grey, swamp brown), foam and ice | `p2-explore.ts` |
| Dry texels within 8 texels of water | browns, sands and greys: warm (blue ≤ red) almost everywhere | `p2-explore.ts` |
| **b − g of wet, water-coloured texels** (revision 3.1) | The navy family reaches b − g = 31 (EK tiles 47_28 and 50_41 draw their sea as rgb(33, 66, 96)). Above 36 there are only 4,423 texels in the Eastern Kingdoms and 587 in Kalimdor, almost all the violet river by Dalaran, rgb(41, 60, 121) | `<r31>/hue-census.ts` |
| **Water drawn in two styles across one ADT edge** (revision 3.1): rows where one side's water is recoloured and the other's is warm and kept | 11 edges in Kalimdor and 14 in the Eastern Kingdoms with at least 16 such rows (some are reefs or sandbars on wet quads rather than water); the clearest is a lake at Kalimdor ADTs 29_31–29_32, half brown, half teal | `<r31>/split-census.ts` |

---

## 18. The minimap tile tool

### 18.1 A sibling tool

`tools/maps/minimap.ts [--out <dir>] [--report <file>] [--check] [--review [dir]] [--jobs <n>] [--pack <file>]`
builds `public/maps/minimap/` (index, manifest, NOTICE, pack pointer) and the tiles
(`public/maps/minimap/t/`, not committed, §23). It is a sibling of `atlas.ts`, not an extension of it,
because the two share only the back end: their inputs (client minimap textures and liquids against
lossless paintings and overlay unions), composition (a recolour and a resample against masks, blends,
label rules and tint) and alterations differ, and each has its own `--check`, budget and NOTICE.

Shared modules, generalised where needed:

- `atlas-index.ts`: the index writer and shape check, with `baseLevel`, `underlayLevel` and the tile
  extension as parameters (the minimap index has a sea bitmap at every level, §18.4);
- `atlas-pyramid.ts`: the integer 2 × 2 reductions and the bitmaps;
- `encode.ts` (encoder identity, WebP settings), `tool-tree.ts`, `json.ts`, `args.ts`;
- `src/geo/atlas-layout.ts` and `src/geo/atlas.ts` (`ATLAS_LAYOUT`, `atlasPlacements`, `partition`,
  `atlasHash`), as `atlas.ts` imports them.

New pure modules in `tools/maps/lib/`, each with synthetic tests:

| Module | Role |
|---|---|
| `minimap-inputs.ts` | Map rows, WDT, MAID discovery, root ADTs for the liquid grid, `LiquidType` hazard ids, per-file FDID and CKey |
| `minimap-decode.ts` | BLP checks (BLP2, DXT1, alpha 0, 512 × 512) and RGB from `blp.ts` |
| `minimap-liquid.ts` | The liquid grid through `tools/terrain/lib/byproducts/grids.ts`; the equality check against the committed relief (§18.2 step 4) |
| `minimap-recolour.ts` | §19.2: colour weight, gate, family field, ramp, dry cap, family feather, void and haze, edge skirts |
| `minimap-seams.ts` | §19.2 steps 7–9: the edge feather, the corner term, the navy floor and the dry clamp |
| `minimap-census.ts` | §19.5: the recolour census and its gates (texture, inversions, dry texels, shore cells, relief agreement, seams by both measures) |
| `minimap-stitch.ts` | Ownership by `partition`, the periodic Lanczos-3 weights, block composition |
| `minimap-keys.ts` | Sea keys, stored keys, the level census |
| `minimap-manifest.ts`, `minimap-notice.ts`, `minimap-pack.ts`, `minimap-checks.ts`, `minimap-review.ts` | Outputs, the tile pack, M1–M11 (§24.4), the contact sheets |
| `minimap-params.ts` | Every parameter of §18–§19 as one frozen object, recorded in the manifest |

### 18.2 Pipeline

1. **Pin and maps.** Open the client read-only with `CLIENT_PIN` (as `atlas.ts`). The maps are the
   placed and inset maps of `ATLAS_LAYOUT` (1, 0 and 2991); the phase maps 2868, 2980 and 2959 are
   never read.
2. **MAID discovery.** `Map.WdtFileDataID` → the WDT → `parseWdt` (`tools/terrain/lib/formats/wdt.ts`)
   → for each of the 64 × 64 entries with a minimap FileDataID: row, column, the minimap's FDID and
   CKey (`casc.ckeyOf`), and the root ADT's FDID and CKey. `casc.file` checks MD5 against the CKey;
   a missing or encrypted file stops the build. The counts (736, 988, 72) are recorded, not assumed;
   M4 reports a change.
3. **DXT1 decode** with our own `blp.ts` (no bitwise operators, D-012), refusing anything but BLP2
   DXT1 with alpha depth 0 at 512 × 512.
4. **Liquid grid.** The root ADTs through `grids.ts` `addTile`: a 4.17-yd quad is wet under a
   non-hazard liquid deeper than 0.3 yd. For maps 0 and 1 the tool reduces its grid by the relief's
   rule (a 16.7-yd pixel is water when its wet quads outnumber its land quads) and **refuses to build
   unless the result equals the committed `public/maps/terrain/<map>/relief.png` water class**, so
   the gate and the offline checks (M8, M9, M11) use the same terrain. MEASURED at this build: equal on
   every compared pixel (753,664 for EK, 1,011,712 for Kalimdor; 0 differences; `p20-relief-eq.ts`).
   Zephras Isle has no committed terrain; its grid is built the same way and recorded by hash
   (§19.4).
5. **Recolour** each ADT tile in texel space (§19.2 steps 1–6), then the seam steps across ADT edges
   and corners (steps 7–9), then the census (§19.5), which fails the build if a gate fails.
6. **Stitch and resample** per level −4 block (4,096 × 4,096 px at level 0). Each pixel belongs to the
   map `partition` gives it (the card rectangle → 2991; E ≤ `seamE` → 1; otherwise 0). Its value is
   a separable Lanczos-3 sample of that map's recoloured texels at texel
   `u = (E + 0.5 − eOff + 17,066.67) / K − 0.5` (and likewise `v` with S and `sOff`), K = 25/24 yd.
   Because 24 texels span exactly 25 pixels, the weights repeat every 25 pixels and are computed once
   per map and axis. Taps on an absent ADT read the navy; pixels outside the extent are navy.
7. **Pyramid**: the atlas's integer 2 × 2 reductions to level −8, so every level is an exact
   reduction of level 0 (Part I §6.3's argument applies unchanged).
8. **Keys** (§18.4), and the independent seam census on levels −1 to −3 (§19.5).
9. **Encode** with the atlas's WebP settings (q80, effort 6, `smartSubsample`, `preset: 'drawing'`)
   in parallel jobs.
10. **Outputs**: `index.json`, `manifest.json`, `NOTICE.md`, `pack.json` (the pointer, §23.3); with
    `--pack`, the tile pack: an uncompressed POSIX tar of **`NOTICE.md`, `manifest.json` and `t/`**, in
    that order (the notice first, so a copy of the pack carries it, D-033 rule 2), written by our own
    writer in path order with fixed metadata (mtime 0, uid and gid 0, mode 0644), so it is
    byte-reproducible.

### 18.3 Resampling to our levels, not the native grid (measured)

**The native grid cannot be described by one index.** Part I's tile layer draws one grid whose tile
(0, 0) starts at the atlas origin at every level, 256 px at 2^z px per yard. A minimap texel is
1.0417 yd, so a native tile of 256 texels would be 266.67 atlas pixels wide at level 0, and each
map's native grid starts somewhere else: map 1's texel (0, 0) is at E = −11,414.67, map 0's at
E = 5,432.33 and Zephras Isle's at E = 604.58 (from the placements; likewise in S). No one grid holds
all three, and none of them is the atlas grid. Keeping them native needs three tile layers with
fractional tile sizes and origins, three underlays, a new index shape and overrides of Leaflet's
private `_getTilePos` and `_pxBoundsToTileRange`; fractional tile positions also bring back the
hairline gaps §8.4 guards against.

**What resampling costs** (MEASURED, `p7-native.ts`, the same recoloured texels, WebP q80, on revision
3's `b3`; the recolour changes water only and does not affect the comparison):

| Level | Native grid (ADT-aligned) | Atlas grid (resampled) | Difference |
|---|---|---|---|
| 0 | 4,401 tiles, 36,001,834 B | 4,786 tiles, 35,702,138 B | +8.7 % tiles, −0.8 % bytes |
| −1 | 1,200 tiles, 10,581,630 B | 1,302 tiles, 11,031,096 B | +8.5 % tiles, +4.2 % bytes |
| 0 and −1 | 46,583,464 B | 46,733,234 B | **+0.3 % bytes** |

The resampled level 0 holds 8.5 % more pixels, but Lanczos-3 softens the DXT1 block noise slightly, and
the two effects almost cancel. Displayed at the same scale the difference is not visible
(`<mm>/img/resample-native-vs-atlas.jpg`: Orgrimmar and Tirisfal at 0.35 yd per screen pixel, bilinear as
a browser magnifies).

**The kernel, and its trade-off (MM-11).** A round trip through the resample and back (24 land ADTs,
`p13-roundtrip.ts`; an upper bound, since it resamples twice):

| Kernel | PSNR-Y median | SSIM-Y median |
|---|---:|---:|
| **Lanczos-3** | 28.1 dB | **0.981** |
| Catmull-Rom | 28.7 dB | 0.975 |
| bilinear | 29.1 dB | 0.951 |

Bilinear and Catmull-Rom score higher on PSNR-Y because they blur the DXT1 block noise, which PSNR
rewards; they keep less of the drawing's structure, which SSIM measures and which is what a map reader
sees at 1:1. The cost of Lanczos-3 is faint ringing at hard edges: a pale wall by Dalaran comes out up to
9 levels brighter beside its dark edge (MEASURED, `<r31>/rivercheck5.ts`). **Decision (A13): resample to
the atlas grid with Lanczos-3**, for structure at 1:1, accepting the ringing; Catmull-Rom is the fallback
if the owner's sign-off finds ringing. The index shape, the tile layer and the underlay stay Part I's.

### 18.4 Flat-tile and sea keys; the index

- **Sea key**: a tile every pixel of which is exactly the navy. It has no file and its sea bit is
  set. **Stored key**: every other tile. **No virtual keys**: every level is stored in full where
  there is anything but sea (the owner's "full detail everywhere"), so `resolveTile` never has to
  crop an ancestor. A flat tile of another colour would be stored like any other; `b5` has none
  (MEASURED; an earlier run had 135, all from a bug that darkened the void, found by this count).
- The recommended build (`b5`): stored 4,802 / 1,315 / 372 / 119 / 42 / 13 / 4 / 1 / 1 at levels
  0 to −8 (**6,669**), sea keys 7,438 / 1,745 / 408 / 76 / 14 / 3 / 0 / 0 / 0.
- **The index has Part I's shape** with `baseLevel` 0, so every level carries a sea bitmap (the
  painted index stops at −2 because its fine levels are sparse): `schema` 1, `kind`
  `map-atlas-index`, plus `style: "minimap"`; the same `layout`, `atlasHash`, extent, `seamE`,
  placements and insets as the painted index; `seaColour` and `coastColour` both **#0d1b30** (revision
  3's prototype index wrote rgb(8, 32, 48) by mistake; MM-11); **`underlayLevel` −6** (§24.5); `uiMaps`
  empty (no painted names, §22); `template` `t/{z}/{x}/{y}.webp`. MEASURED (`<r31>/index5.ts`): 6,797 B,
  **2,272 B gzip**. The runtime's parser (`src/infra/maps/atlas-index.ts`) accepts it unchanged, resolves
  every key as stored or sea and finds the 4 underlay keys at level −6 (`<r31>/parse5.ts`); only its fixed
  `maps/atlas/` directory must become a parameter (MM.1).

### 18.5 Black texels

MEASURED (`p10-black.ts`, texels not connected to the void):

| Map | Components | Texels | Tiles | Size classes | Largest |
|---|---:|---:|---:|---|---|
| Eastern Kingdoms | 906 | 6,592 | 78 | 392 single texels; 249 of 2–4; 185 of 5–16; 66 of 17–64; 12 of 65–256; 2 over 256 | 492 texels at world (−8,959, 1,046), a building south-west of Stormwind |
| Kalimdor | 1,213 | 8,973 | 55 | 530 single; 342 of 2–4; 229 of 5–16; 95 of 17–64; 15 of 65–256; 2 over 256 | 480 texels at (−4,237, −1,274) |
| Zephras Isle | 526 | 6,293 | – | inside the island (shadows) | – |

They are of three kinds (`<mm>/img/black-texels.png`): black DXT1 blocks around a building's edge; dark
outlines of lava pools and pits that are part of the drawing; and a few whole black 4 × 4 blocks on
open ground (40 blocks in 2 EK tiles, 76 in 5 Kalimdor tiles, MEASURED). Together they are 0.002 %
of the texels. **Default (O16): keep them as drawn**; they are Blizzard's pixels and filling them is
another alteration. The manifest lists every component over 64 texels with its world position, and
the contact sheet shows the largest. The alternative is to fill the whole black blocks from their
neighbours (116 blocks), listed as an alteration.

### 18.6 The map-edge staircase

Where a map's ADT grid ends, the picture would stop in a staircase along tile lines. Here the void
beyond the last tile is the navy (step 6 reads navy for absent ADTs), and the edge tiles' own sea
becomes the same navy, so over open sea the staircase disappears. MEASURED (`b4` census, unchanged in
`b5`): 172 (Kalimdor), 140 (EK) and 34 (Zephras) ADT sides face an absent ADT; on all of EK's and Zephras
Isle's the edge texels are water or void. Kalimdor has 12 sides with land: 8 belong to the stray
tiles at grid (0,0)–(2,0), which lie outside the atlas extent (E < 0) and are never drawn; the other 4
(north sides of tiles 20_45 to 20_47 and the east side of 20_47, north-east of Azshara) carry a
**skirt**: one chunk (32 texels, 33 yd) of flat rgb(71, 72, 44) and rgb(77, 74, 46) ground with sea
behind it, which would draw as an olive line in the sea (`<mm>/img/staircase-kalimdor-ne.jpg`). **Rule
(an alteration, listed):** on a side facing an absent ADT, a chunk-wide strip whose texels take at
most three distinct colours, whose chunks have no liquid, and behind which the next chunk row is at
least 90 % wet in the liquid grid is void (navy). The rule is designed from the census and the texels;
neither prototype build applies it, so `b5` still shows the olive line, and "exactly those 4 sides" is
an ESTIMATE until MM.3 builds the rule and M10 records the count.

### 18.7 Determinism and `--check`

- The raw pyramid is pure JavaScript in a fixed order: the recolour, the family field's box sums, the
  seam steps, the Lanczos weights (IEEE doubles, `Math.sin` and `Math.exp` in V8), integer rounding and
  reductions. MEASURED: two runs of `b5` wrote the same raw bytes at all nine levels (`b5/` and `b5b/`:
  every tile's hash in `index.json` and every sea key identical), and `b4r` reproduced `b4` on all 6,655
  tiles.
- The encoders are sharp 0.35.4 with libvips 8.18.6 and libwebp 1.6.0 (libheif 1.23.2 and aom 3.14.1
  for AVIF). MEASURED: all 6,669 WebP tiles of `b5` byte-identical with 16 and 8 parallel jobs (tree hash
  `583ac6d8…`).
- Across platforms and Node versions: UNKNOWN, as for `convert.ts` and `atlas.ts`; the platform, Node
  and encoder versions are recorded, and `--check` runs on the reference machine.
- `--check` rebuilds in memory and compares every byte of `index.json`, `manifest.json`, `NOTICE.md`,
  `pack.json` and every tile present under `public/maps/minimap/t/` (or, with `--pack`, the tar's
  SHA-256). It needs the client, so it is a manual gate like `convert.ts --check`, `atlas.ts --check`
  and `nav:check`, recorded in STATUS (§23.4).

### 18.8 Manifest and NOTICE

**`manifest.json`** (`kind: "map-minimap"`; **ESTIMATE about 385 kB gzip**, 1.26 MB raw: `<r31>/index5.ts`
writes every record below for `b5`, with random 32-hex stand-ins of the right length for the root ADTs'
and `LiquidType`'s CKeys, which the decode cache does not hold; revision 3's "MEASURED 335,892 B" came
from a prototype without these records and was a lower bound, MM-11):
- the D-033 artwork notice, the client pin, the tool tree hash, Node, encoder versions and platform;
- the layout's `atlasHash`; the maps drawn and those deliberately not drawn (the phase maps);
- **sources**: per minimap tile its map, row, column, FileDataID and CKey (1,796 rows); per map the
  WDT's and every root ADT's FDID and CKey (1,796 rows), and the `LiquidType` table's (the liquid grid's
  inputs); the terrain manifest's SHA-256 for the relief check;
- every parameter of `minimap-params.ts` (§19.7);
- the census (§19.5): the recolour counts, the texture, inversion, dry-texel and shore figures, the
  relief agreement, the seam steps by both measures with the worst edges, the feathered edges, the
  black-texel components over 64 texels, the edge skirts;
- per level: stored and sea counts, bytes; per file: path, bytes, SHA-256 (the dist audit's list);
- the pack: file name, bytes, SHA-256, the tiles' tree hash and its contents (`NOTICE.md`,
  `manifest.json`, `t/`);
- **the list of alterations** (below).

**`NOTICE.md`**, regenerated from the manifest and checked by M1: Blizzard Entertainment's artwork
(D-033 and D-045): the World of Warcraft client's minimap textures, extracted read-only from the
pinned build; not affiliated with or endorsed by Blizzard; non-commercial; removed promptly on
request; the project never distributes hacks or cheats. **The alterations**, each named:
1. water recoloured onto a navy ramp (the colour weight and a gate from terrain-derived liquid data,
   D-032; the family field; dry texels never brightened; the family feather, the edge feather, the corner
   term and the navy floor across tile edges); coloured water (bright ponds, the violet river), lava,
   slime and swamp water keep their colours;
2. the void (Zephras Isle's black background and the area beyond the tiles) filled with the navy,
   the dark haze connected to it re-composited over the navy, and the 4 edge skirts treated as void;
3. resampled from 1.0417 to 1 yd per pixel (Lanczos-3) and reduced to coarser levels;
4. the three maps drawn in one raster by translation only (compact layout), with Zephras Isle as a
   card that is not in position;
5. re-encoded lossily (WebP q80);
6. (only if O16 is changed) whole black DXT1 blocks filled from their neighbours;
7. (only if O20 is changed) swamp water recoloured.

No legal conclusion is drawn. D-033's other terms stand.

### 18.9 Build time (reference machine)

BLP decode 35 s and liquid grids 6 s (MEASURED in revision 3); recolour, seam steps and census 145–154 s
per build (MEASURED on `b5` and `b5b`, built at the same time on the 16-thread machine; revision 3's
recolour took 68 s: the family field's box sums, the haze flood and the census add the rest); stitch and
pyramid 72 s (single-threaded JavaScript); WebP encode 30 s with 16 jobs: **about 5 min** in all
(ESTIMATE by sum; the prototype read the decoded texels from a cache, the tool decodes them in the same
run). AVIF q60 4:2:0 takes 294 s to encode with 16 jobs. The recolour and stitch can use worker threads
per ADT row or block; the output does not depend on it (determinism is per tile).

### 18.10 The contact sheets (`--review`)

At **native pixels only**: each place at 1:1 and 2:1 (nearest neighbour), and 3:1 where the census
flags a faint residue, source (through the same stitch and resample) beside the build, with the previous
signed-off build as a third panel when there is one. No averaging: revision 3's sheets averaged 2 × 2 or
4 × 4 texels and hid the posterisation (MM-01). The places:
- **the recolour** (MM-01): the Kalimdor lake (E 6,200, S 19,850), Loch Modan, the Tirisfal coast and its
  north-coast ADT corner, Stormwind harbour, north Darkshore's family edge;
- **banks and rivers** (MM-02): the Duskwood river, the Stranglethorn shore rocks, the violet river by
  Dalaran, Zephras Isle's lake and beaches;
- **the void** (MM-10): Zephras Isle's south-east dock and the whole card;
- **kept water** (MM-08, O20): Dustwallow Marsh, the Swamp of Sorrows, the two-style lake at Kalimdor
  29_31–29_32;
- **the census's worst**: the ten worst long edges of the independent seam measure (§19.5) at the level
  where they are worst, the ten most amplified wet blocks, the ten bluest fully dry shore cells;
- as before: the six capitals at levels −1 and 0, both continents at the fit view, the black-texel
  components over 256 texels and the edge skirts.

The prototype's sheets for `b5` are `<r31>/img/mm31-1to1-{A,B,C,D}.png`, `mm31-2to1-{A,B,C,D}.png`,
`mm31-worst-seams.png` and `mm31-stv-corner-3to1.png` (`<r31>/sheets.sh`). The owner signs off the
tool's sheets before the first pack is published and after any parameter change (O18, as D-042 O8).

---

## 19. Sea recolour

### 19.1 What has to change

The owner's rule (D-045 addendum): every water tone becomes one navy (the dark family, the navy
family, Zephras Isle's black and the map edges), while lava and slime keep their colours. This design
reads "water tones" as the two families and their shallows: **coloured water keeps its colour** like
lava and slime (the bright cyan ponds of Hyjal and Kalimdor, and the violet river by Dalaran, whose
b − g of 53 lies far outside both families, §17.2), and **swamp water** (brown and olive, warm like the
land around it) is kept as drawn and put to the owner (O20, §19.8). The probe found the seams: water
drawn in one of two styles per tile meets in straight lines, with colour steps of 58 to 81 levels; the
check found more tones, navy-to-navy steps, and shallows in dark tiles.

Revision 3's rule failed the review in three ways, each reproduced here (MEASURED, `b4r`):
- **Posterisation (MM-01).** It picked each texel's open-sea reference by a hard split at b − g = 10, so
  two texels of almost the same colour on either side of the split came out far apart: a smooth teal lake
  became a two-tone lake with a blocky core (`mm31-2to1-A.png`, place 1). 6.4 % (EK) and 7.1 %
  (Kalimdor) of wet pairs 4 texels apart had their brightness order reversed.
- **Banks (MM-02).** The gate reached 25 yd, so blue-grey canopy and rock beside rivers and coasts took
  the ramp's bright end (the Duskwood river three times its width; pale blue beaches on Zephras Isle), and
  the violet river, inside the navy family's dead zone, went from the brightest line to the darkest.
- **Seams (MM-03).** The edge feather cancels the 4-texel difference that revision 3's seam metric
  measured, so "122 → 4" was partly true by construction; rivers and small lakes were not counted, the
  feather ended in straight cuts along the edge, and ADT corners kept square patches.

### 19.2 The rule (revision 3.1)

A **colour-only water map** decides, per texel, how water-like its colour is and where it goes; the
client's **liquid grid** decides where that map may apply. The reference that sets a texel's place on the
ramp comes from **its neighbourhood within its own tile**, never from the texel alone, so neither a tile
boundary nor a texel's own tint can create a step. Parameters are those of `P31` in `<r31>/rule3.ts`
(§19.7).

1. **Colour weight.** `w_c = warm · chroma · cap · hue`, each in 0..1:
   - `warm = smoothstep(−6, 2, b − r)`: water is not warm; sand, soil, lava, swamp and slime are;
   - `chroma = smoothstep(3, 8, max(g, b) − r)`: water has colour; grey rock does not;
   - `cap = 1 − smoothstep(90, 130, L)` (L = Rec. 709 luma of the sRGB values): bright cyan ponds,
     ice and foam keep their colour;
   - **`hue = 1 − smoothstep(36, 44, b − g)`** (new): water bluer than both families keeps its colour
     (the violet river; §17.2).
2. **Gate.** `g` is 1 on a wet quad of the liquid grid and within **1 quad (4.2 yd)** of one, falling to 0
   at **2 quads (8.3 yd)** by smoothstep, bilinear per texel (revision 3: 12.5 and 25 yd). The reach
   covers the texture's drawn water that the grid leaves dry: water shallower than 0.3 yd and the
   alignment error of up to about 4 yd (§17.1). `w = w_c · g`.
3. **Family field** (new, MM-01). Per ADT tile, the mean of b − g (clamped to −8…28) over the tile's own
   texels on wet quads, weighted by `w_c`, box-blurred twice with radius 12 texels (a tent 49 texels
   wide), normalised by the blurred weights; `f = smoothstep(2, 18, mean)`. The field reads only the
   tile's own texels, because the source draws one water style per tile; across tiles, steps 6–8 match
   the result. The open-sea reference is `ref = (14.4 + 6)(1 − f) + (47.3 + 20) f` (the dark and navy
   families' open-sea luma plus their dead zones).
4. **Ramp.** `t = smoothstep(0, 60, L − ref)`, then the family feather (unchanged: within 96 texels of an
   ADT edge whose neighbour's family differs, `t` fades to 0). **Dry cap** (new, MM-02): on a dry quad,
   `t` is limited so the target's luma does not exceed the texel's own (`t ≤ (L − L_navy) / (L_shallow −
   L_navy)`), so a dry texel may darken or change hue but never brighten. The target is
   `navy + t · (shallow − navy)`, navy **#0d1b30** (rgb 13, 27, 48), shallow rgb(60, 92, 130).
5. **Mix.** `out = c + w · (target − c)`: the recolour fades out where the colour stops being water-like
   or the gate ends.
6. **Void and haze** (MM-10). Pure-black texels connected through pure black to an absent ADT are void:
   navy. **Every texel connected to the void through texels darker than luma 64** (4-connected, up to 192
   texels, fading over the last 32) is haze and is re-composited over the navy by coverage:
   `a = min(1, L / 64)`, `out += (1 − a) · (1 − w) · navy`. Revision 3 used a fixed 64-texel fringe, so
   haze wider than that stayed near black (Zephras Isle's south-east dock, `mm31-1to1-C.png`, place 10).
   The edge skirts of §18.6 are void too.
7. **Edge feather** (revised, MM-03). For every ADT edge, per row where both sides' 4 edge texels are
   water (`w ≥ 0.9`), the colour difference across the edge; along the edge, a Gaussian (σ = 8 rows,
   over ±24) averages it over those rows and tapers it by their weighted share of the window (full from
   50 %, nothing below 5 %); half goes to each side, fading linearly over 128 texels and scaled by each
   texel's `w`. A river 10 rows wide gets about the full correction (revision 3 gave it about 40 %), and a
   correction fades out along the edge instead of ending in a straight cut.
8. **Corner term** (new). After the edge terms, the (up to) four tiles meeting at an ADT corner move to
   the mean of their corrected corner colours (8 × 8 texels each), faded by lin(dx) · lin(dy) over 128
   texels, so the corrections along the two edges agree near the corner instead of leaving a square.
9. **Floors and caps** (new). A fully recoloured texel (`w ≥ 0.99`) never ends darker than the navy in
   any channel (the feathers could push open sea below it), and a dry-quad texel never ends brighter than
   its source (the feathers could lift it); void and haze texels are exempt by rule.
10. Absent ADTs and pixels outside the extent are the navy (§18.2 step 6).

**Why a field and not the review's per-texel blend.** Blending the two references by
`smoothstep(2, 18, b − g)` per texel (the review's demonstration, `<mm>/review-mm/fam-*.png`) removes the
hard contours but keeps DXT1-block-shaped patches, because each texel's own b − g still moves its
reference by up to about 4 luma per level of b − g. A field averaged over about 50 texels moves the
reference slowly, so the ramp's gain (at most 1.56 in luma) bounds how much any local texture grows.
**Alternatives tried and rejected** (`<r31>/iter.ts` sheets in `<r31>/img/`): the field read across tile
boundaries (bands of lighter and darker water beside family edges in a full build, `worst2.png`); scaling `t` so both
sides of an edge meet in ramp position, which never moves open sea (a dark trough across Loch Modan,
whose upper tile draws its water darker, `ratio-r1.png`, `ratio-r3.png`); the family feather off (no
measurable difference in either seam measure, `fam-v2.png`).

### 19.3 The navy

- **#0d1b30** (rgb 13, 27, 48, hue 216°) is the presentation design's candidate (map-presentation.md
  §25.5): at least 25° of hue from the provenance cyan, and at least 15 (CIEDE2000) from both cyan
  tokens. MapGenie's own rgb(1, 29, 41) (hue 198°) is ruled out there as too close to cyan. The
  shallow end rgb(60, 92, 130) has hue 213°, so every recoloured texel stays in 213–216°. D-047 asks for
  "one even colour": the open sea is #0d1b30 (every open-sea tone of both families lies in the dead zone;
  the seam steps lift it by a few levels near some tile edges, §19.6), and only the shallows are lighter
  tints of it.
- **Contrast at the world band** (level −5, MEASURED on `b5`, `<r31>/contrast5.ts`), by two methods
  (MM-11):

  | Method | Land is | Ours (`b5`) | MapGenie shot 02 | Black sea on our land |
  |---|---|---:|---:|---:|
  | **Part I's** (§9.2, `bench-contrast.mjs`) | every pixel more than 48 (RGB, Euclidean) from the sea | **2.09:1** | 2.60:1 | 2.54:1 |
  | Revision 3's O17 | every pixel more than 24 (sum of absolute differences) from the sea | 1.96:1 | 1.95:1 | 2.38:1 |

  Other seas on our land by Part I's method: rgb(8, 32, 48) 2.02, the minimap's own rgb(27, 51, 71)
  1.58, MapGenie's rgb(1, 29, 41) 2.10. Revision 3 changed both the method and the threshold and called
  the result a match; by Part I's method we are **below** MapGenie's saved shot (2.09 against 2.60). How
  much of MapGenie's 2.60 its pins and labels contribute is UNKNOWN (they were not separated; revision 3's
  claim that they explain it was not measured). The minimap's land is much darker than the painted art
  (median relative luminance 0.069–0.077 against about 0.18 for the painted land, an ESTIMATE from Part
  I's 2.65:1 against rgb(61, 55, 41)), so Part I's 2.5:1 needs a near-black sea (2.54). The criterion is
  O17 (§24.1).

### 19.4 Zephras Isle

Zephras Isle has no committed terrain (`public/maps/terrain` holds maps 0 and 1 only), so the
brief's relief check cannot apply to it. It is handled in three ways:
- **its black background** (72.4 % of its texels) is the void, found by the flood of step 6 without
  any terrain, and the dark haze around its cliffs and the south-east dock is re-composited over the navy
  by the haze flood (743,859 texels, MEASURED);
- **its lake and rivers**: the tool builds the same liquid grid from the island's 72 root ADTs (26,337
  wet quads, MEASURED), so the gate works as on the continents; the grid is recorded by hash in the
  manifest;
- **the check**: no offline relief check is possible; M8 reports Zephras Isle as "not checked
  offline", and the contact sheet shows the card, the lake, the beaches and the dock. (Committing its
  terrain byproducts would make M8 cover it, but that is a new D-032 output, not proposed here.)

The card keeps its rectangle and partition (Part I §5.5); the island now sits on navy, not on its
painting's parchment, so the card's vector frame and caption (§8.5) are what mark it as a card.

### 19.5 Results (MEASURED, `b5` against `b4`)

Sheets: §18.10. Every figure below comes from `<r31>/build3.ts` (native texels, before the resample) or
from the review's own scripts run on the built level 0 (`amplify5.ts`, `halo5.ts`), for `b5` and for
`b4r` (= `b4`).

**Texture (MM-01).** A wet block is a block over wet quads only; it is *amplified* when its luma standard
deviation more than doubles (`sd' > 2 sd + 2`).

| Measure | Eastern Kingdoms `b4` → `b5` | Kalimdor `b4` → `b5` |
|---|---|---|
| Review's measure: 16-px blocks of stored level-0 tiles | 8,554 of 95,944 (8.9 %) → **271 of 93,834 (0.29 %)** | 7,500 of 119,578 (6.3 %) → **301 of 118,245 (0.25 %)** |
| Native 16-texel blocks (open sea included) | 8,252 of 377,776 (2.18 %) → **253 (0.067 %)** | 7,260 of 488,011 (1.49 %) → **322 (0.066 %)** |
| Mean luma SD of native wet blocks: source → `b4` → `b5` | 0.39 → 0.51 → **0.33** | 0.41 → 0.45 → **0.34** |
| Water-to-water order: pairs 4 texels apart, both `w ≥ 0.9`, luma differing by 8+, reversed by 4+ | 30,836 of 479,940 (6.4 %) → **117 of 476,616 (0.025 %)** | 48,713 of 688,809 (7.1 %) → **15 of 688,686 (0.002 %)** |

Zephras Isle: 0 amplified blocks and 0 inversions (`b4`: 1 and 259). The most amplified blocks left sit
where a tile's recoloured water meets the next tile's kept swamp water (`mm31-worst-seams.png`, F: the
Swamp of Sorrows coast); the most-inverted tile is EK 59_32 (87 pairs).

**Banks and rivers (MM-02).** Revision 3's "0.02–0.05 % of land cells" divided by all land, which the gate
cannot reach; the rates below are over **shore land**: relief land cells within 2 cells (33 yd) of a water
cell.

| Measure | Eastern Kingdoms `b4` → `b5` | Kalimdor `b4` → `b5` |
|---|---|---|
| Dry-quad texels brightened by more than 1.5 luma | 57,556 (up to +19) → **0** | 35,117 (up to +35) → **0** |
| Dry-quad texels recoloured at `w ≥ 0.5` | 87,286 → **46,540** | 56,779 → **35,300** |
| Review's measure: shore land cells 8+ levels bluer (level 0 against the source) | 1,799 of 37,673 (4.8 %) → **1,397 (3.7 %)** | 1,760 of 40,315 (4.4 %) → **1,435 (3.6 %)** |
| **Fully dry** shore cells (no wet quad in the cell) 8+ levels bluer | 178 of 28,443 (0.63 %) → **8 (0.03 %)** | 137 of 30,243 (0.45 %) → **2 (0.007 %)** |
| Inland land cells 8+ levels bluer (review's measure) | 97 → 90 of 330,663 | 38 → 31 of 475,358 |

Most shore cells counted by the review's measure hold water: the relief's majority rule calls a cell land
when its wet quads are the minority, and that water is rightly recoloured; the fully dry row isolates
the banks. The violet river by Dalaran keeps rgb(41, 60, 121) at luma 60 while the teal water beside it
goes from luma 33 to 32 (`rivercheck5.ts`); the Duskwood river stays its own width; Stranglethorn's
shore rocks and Zephras Isle's beaches keep their colours (`mm31-1to1-B.png`, `-C.png`).

**Seams (MM-03), two measures.** Revision 3's metric (the mean difference of 4-texel bands across each
ADT edge with at least 64 rows of water) is kept for continuity, but it measures what the edge feather
is built to cancel. **The independent measure** (`<r31>/seams-levels.ts`) reads the built pyramid at
levels −1, −2 and −3: per pixel row along an ADT edge whose four 8-px bands (A2, A1 | B1, B2) all lie over
wet quads, the step B1 − A1 less the local gradient ((A1 − A2) + (B2 − B1)) / 2; an edge's seam is the
**median** over its wet rows (a straight line, not noise or a pier crossing a few rows), in RGB levels.
Every edge with at least 3 wet rows counts, rivers and small lakes included; "long" edges have 16 or
more. **Controls**: the same statistic on the lines through the middle of each tile, where there is no ADT
edge, show the measure's false-positive rate.

| Revision 3's metric | Kalimdor: source → `b4` → `b5` | Eastern Kingdoms: source → `b4` → `b5` |
|---|---|---|
| Edges with water | 946 | 767 |
| Over 6 levels | 44 → 14 → **2** | 89 → 15 → **4** |
| Over 10 | 37 → 2 → **0** | 85 → 2 → **1** |
| Largest | 39.0 → 13.1 → **7.9** | 52.8 → 10.8 → **11.3** |

(Source counts use `b4`'s water weights; with `b5`'s the Eastern Kingdoms has 84 edges over 10.)

Correction (MM-03): without the edge feather, revision 3's `b3` left **12 and 11** edges over 10 levels
(Kalimdor, Eastern Kingdoms), the largest **45.2** at Loch Modan (`<mm>/out/b3/report.json`); the "9 and
6, largest 39.1" that §19.5 and O15 gave were `b2`'s.

| Independent measure: long edges with a seam over 4 levels (over 8) | Level −1 | Level −2 | Level −3 |
|---|---|---|---|
| Kalimdor source (`b0`) | 63 (43) of 941 | 45 (36) of 883 | 41 (32) of 830 |
| Kalimdor `b4` | 23 (9) | 10 (5) | 11 (3) |
| **Kalimdor `b5`** | **18 (9)** | **9 (4)** | **8 (3)** |
| Kalimdor controls in `b5` | 20 (8) of 1,903 | 20 (7) of 1,795 | 18 (8) of 1,653 |
| Eastern Kingdoms source | 112 (91) of 785 | 104 (83) of 726 | 91 (73) of 648 |
| Eastern Kingdoms `b4` | 20 (6) | 19 (8) | 10 (7) |
| **Eastern Kingdoms `b5`** | **15 (8)** | **13 (5)** | **5 (3)** |
| Eastern Kingdoms controls in `b5` | 34 (8) of 1,541 | 16 (8) of 1,447 | 16 (8) of 1,297 |

In the source 14 % of long Eastern Kingdoms edges and 5–7 % of Kalimdor's carry a seam over 4 levels,
against about 1 % of the control lines. After the recolour the rate at ADT edges is at or below the
control lines' except Kalimdor at level −1 (1.9 % against 1.1 %) and the Eastern Kingdoms at level −2
(1.8 % against 1.1 %). Zephras Isle has 8 long edges at level −1
(2 over 4 levels in the source, in `b4` and in `b5`). Of the 18 long edges over 8 levels at level −1 in
`b5`, 4 are water drawn in two styles (§19.8); the others on the sheet are swamp coasts, piers, reefs and
a harbour pool crossing an edge (`mm31-worst-seams.png`). The manifest records both measures with the ten
worst edges; the gates are in the table below.

**Agreement with the committed relief's water cells** (16.7-yd cells; the mean recolour weight of the
cell's 16 × 16 texels):

| Map | Water cells recoloured (≥ 0.5) | Water cells untouched (< 0.1) | Land cells recoloured (≥ 0.5) | Land cells partly (0.1–0.5) |
|---|---|---|---|---|
| Kalimdor | 484,482 of 496,039 (97.7 %) | 7,163 (1.4 %) | 93 of 515,673 (0.018 %) | 2,850 (0.55 %) |
| Eastern Kingdoms | 376,855 of 385,328 (97.8 %) | 4,592 (1.2 %) | 117 of 368,336 (0.032 %) | 2,797 (0.76 %) |

(`b4`: 125 and 199 land cells recoloured, 3,070 and 3,147 partly.) The untouched water cells are the
tones the rule keeps (swamp water, coloured ponds, ice, foam), and the partly recoloured land cells are
the shore band, where the relief's majority rule calls a mixed cell land.

**Counts** (`b5`): 122,970,972 (Kalimdor), 95,984,571 (EK) and 288,175 (Zephras) texels fully recoloured;
1,667,795, 938,242 and 115,437 partly; 13,656,284 void texels and 743,859 haze texels in Zephras Isle;
family feathers on 51 and 126 tiles; the edge feather touched 1,022, 840 and 111 edges; the dry cap bound
38,244, 55,917 and 15,081 texels; the navy floor lifted 179,053, 140,837 and 2,630.

**The census gates** (`minimap-census.ts`; the build fails on any; set from `b5` with headroom):

| Gate | Threshold per map | `b5` |
|---|---|---|
| Amplified wet blocks, native 16-texel blocks | ≤ 0.2 % | 0.066–0.067 % |
| Water-to-water inversions | ≤ 0.1 % of pairs | 0.002–0.025 % |
| Dry-quad texels brightened by more than 1.5 luma | 0 | 0 |
| Fully dry shore cells 8+ levels bluer | ≤ 0.1 % | 0.007–0.03 % |
| Long ADT edges over 8 levels at each of levels −1 to −3 (independent measure) | ≤ 12 | 3–9 |
| Water cells recoloured; land cells recoloured | ≥ 97 %; ≤ 0.05 % | 97.7–97.8 %; 0.018–0.032 % |

### 19.6 What remains visible (at 1:1 to 3:1, `b5`)

- **Water drawn in two styles where one is kept** (§19.8): a lake half brown, half navy at Kalimdor
  29_31–29_32, and the Swamp of Sorrows coast where recoloured teal meets kept olive water along a tile
  line (`mm31-1to1-D.png`, `mm31-worst-seams.png` C and F). This is the largest residue, and it follows
  from keeping swamp water.
- **Faint patches at some ADT corners by rocky shallows**, a few levels on flat navy, visible at 3:1
  (the Stranglethorn south shore, `mm31-stv-corner-3to1.png`); fainter than in `b4` (OBSERVED).
- **Soft bands** where a lake's two tile styles are matched across an edge (Loch Modan, north Darkshore):
  a gradient over about 250 yd instead of a line.
- **Ground seams**: the minimap's own lighting steps along tile lines on land (4.1 % and 6.1 % of
  textured edges above a ratio of 2 in the probe), for example the Badlands–Loch Modan border; the
  recolour does not touch land.
- **The shallows are one hue**: the seabed's greens and teals become navy tints; MapGenie keeps some
  teal in its shallows (saved shots 03 and 04).
- **Faint ringing** at hard land edges from Lanczos-3 (§18.3).

The DXT1 speckle, the black-navy blotches and contour bands, the blue banks and the dark haze of
revision 3 are gone at native scale (sheets A to C).

### 19.7 Parameters and the runs

| Parameter | Value |
|---|---|
| Navy, shallow end | rgb(13, 27, 48); rgb(60, 92, 130) |
| Warm, chroma, luma cap, hue | smoothstep(−6, 2, b − r); smoothstep(3, 8, max(g, b) − r); 1 − smoothstep(90, 130, L); 1 − smoothstep(36, 44, b − g) |
| Family field | per tile, b − g clamped to −8…28, weighted by `w_c` over wet quads, two box passes of radius 12; f = smoothstep(2, 18, ·) |
| Open-sea luma; dead zones; ramp | 14.4 and 47.3; 6 and 20; smoothstep over 60 |
| Gate; dry cap | 1 quad full, 1 more to 0 (4.2 and 8.3 yd); t ≤ (L − 25.5) / 62.4 on dry quads |
| Family feather; edge feather | 96 texels; 128 texels, 4-texel bands, both weights ≥ 0.9, Gaussian σ 8 rows over ±24 with a 5–50 % taper |
| Corner term; navy floor | 8 × 8 corner blocks, lin(dx) · lin(dy) over 128 texels; w ≥ 0.99 |
| Void; haze | flood through pure black from absent ADTs; flood through luma < 64 up to 192 texels (fade over the last 32), coverage L/64 |
| Resampling | Lanczos-3, 25/24 |

Runs: revision 3's `b1` (navy rgb(27, 51, 71), a linear ramp, no feathers), `b2` (rgb(8, 32, 48), the
smoothstep ramp and the family feather), `b3` (#0d1b30, the bluer shallow end) and `b4` (the edge
feather); revision 3.1's **`b5`** (this rule, recommended), `b5b` (its second run), `b4r` (`b4` rebuilt,
identical) and `b0` (no recolour). Tile counts and sizes differ by under 1.2 % between them
(6,641–6,669 tiles, 51.8–52.7 MB in WebP q80).

### 19.8 Swamp and brown water (MM-08, O20)

The lakes and channels of Dustwallow Marsh (Kalimdor 36–40 × 38–40, about rgb(46, 55, 30)) and the
Swamp of Sorrows (Eastern Kingdoms 50–52 × 38–40, about rgb(79, 74, 20)) are warm, so the colour weight
keeps them (up to 80,537 wet texels per ADT, the review's `untouched.ts`). The owner's addendum exempts
only lava and slime, and revision 3 did not say so. They are also where most residual seams of §19.5
lie, because a swamp tile's kept water meets its neighbour's recoloured water along a tile line, and
because one lake at Kalimdor 29_31–29_32 is drawn brown in one tile and teal in the next.

Colour cannot find this water: the olive channels of the Swamp of Sorrows are the colour of the grass
around them, so only the liquid grid can. A trial (`<r31>/img/brown.png`, `rule3.ts` `brownWater`)
recoloured texels near each tile's most common warm wet colour on wet quads: it fixed the two-style lake,
but in the swamps it made tile-shaped patches, because a swamp is drawn in several water tones and the
most common one changes from tile to tile. A rule that recolours every non-hazard wet quad by the liquid
grid alone would need its own prototype and sheet (reeds, logs, docks and mud drawn over the water would
turn navy with it, at the grid's 4.2-yd steps). **Default (O20): keep swamp and brown water as drawn** and
list it in the NOTICE as kept; the alternative is a liquid-grid recolour of swamp water, prototyped in
MM.3 and shown to the owner before it is adopted.

---

## 20. AVIF against WebP q80

### 20.1 Method

- **Sweep** (`<r31>/sweep5.ts`, MM-07): 464 stored tiles of **`b5`**, every 15th of each level plus all
  of levels −5 to −8, encoded as WebP q80 with the atlas settings and AVIF q50 (4:4:4, the probe's) and
  q60, q65 and q70 at 4:2:0 (effort 4). Each is decoded again with sharp and compared with the lossless
  tile: PSNR-Y and SSIM-Y (11 × 11 Gaussian, σ 1.5, our own code, `<mm>/metrics.ts`), **per level**.
  Revision 3's wider sweep on `b1` (`p5-sweep.ts`, §20.2) is kept for the other settings.
  **Butteraugli and ssimulacra2 are not available** on this machine and were not downloaded.
- **Side by side** (`<r31>/ab5.ts`, on `b5`): city (Orgrimmar, Stormwind), forest (Ashenvale, Duskwood),
  desert (Tanaris), snow (Winterspring, Dun Morogh), coast (Durotar) and sea (Azshara's and Tirisfal's
  shallows) tiles at level 0, plus one tile each at the zone (−2), region (−3), continent (−4) and world
  (−5) bands, at 1:1 and with the centre **magnified 2:1 and 3:1 bilinearly** (as a browser scales a
  tile), source beside WebP q80, AVIF q50, q60 4:2:0, q65 4:2:0 and q70 4:2:0, with two-line captions
  (`<r31>/img/ab5-{1,2,3}to1-{a,b}.png`; revision 3's sheets used `b1`, nearest-neighbour magnification
  and cut-off captions).
- **Full builds** of `b5` in WebP q80 and AVIF q60 4:2:0.
- **Decode** (`p9-decode.mjs`, on `b4`'s tiles; the recolour changes only water): headless Chrome 153
  over CDP on a local page serving our tiles from 127.0.0.1: 240 level-0 tiles decoded one at a time with
  WebCodecs `ImageDecoder` (median of three passes) and with `createImageBitmap`; a screenful of 40 tiles
  (around Orgrimmar) decoded in parallel with `img.decode()`; the 13 level −5 tiles of the first view; at
  1× and with 4× CPU throttling.

### 20.2 Metrics per level (`b5`, MEASURED)

Bytes relative to WebP q80; the median per-tile PSNR-Y difference from WebP q80; in brackets, the tiles
more than 1 dB worse than WebP q80.

| Level (tiles) | AVIF q50 | AVIF q60 4:2:0 | AVIF q65 4:2:0 | AVIF q70 4:2:0 |
|---|---|---|---|---|
| 0 (321) | 0.56×, −1.60 dB (224) | 0.83×, +0.25 dB (34) | 0.94×, +0.87 dB (4) | 1.18×, +2.32 dB (0) |
| −1 (88) | 0.53×, −1.99 dB (71) | 0.75×, −0.04 dB (12) | 0.85×, +0.66 dB (5) | 1.04×, +1.96 dB (0) |
| −2, zone band (25) | 0.52×, −3.06 dB (18) | 0.72×, **−0.56 dB (10)** | 0.81×, +0.30 dB (4) | 0.98×, +1.97 dB (0) |
| −3, region band (8) | 0.51×, −5.30 dB (8) | 0.72×, **−2.45 dB (6)** | 0.82×, −1.16 dB (4) | 0.99×, +1.19 dB (0) |
| −4 (3) | 0.50×, −4.20 dB (3) | 0.72×, −1.02 dB (2) | 0.82×, −0.07 dB (1) | 0.99×, +2.22 dB (0) |
| −5 to −8 (19) | 0.59×, −3.63 dB (18) | 0.82×, −0.60 dB (7) | 0.91×, +0.31 dB (3) | 1.10×, +2.59 dB (0) |
| **All (464)** | 0.55×, −1.81 dB (342) | 0.80×, +0.15 dB (71) | 0.91×, +0.78 dB (21) | 1.13×, +2.27 dB (0) |

WebP q80's own medians: PSNR-Y 38.1 dB overall (37.9 at −2, 39.1 at −3). The sweep's overall parity for
AVIF q60 4:2:0 comes from level 0, which is 321 of the 464 tiles; from level −2 down it is worse
(MM-07). Revision 3's sweep of `b1` (`p5-sweep-b1.json`) measured the other settings: WebP q75 0.78×
and q85 1.30×; AVIF q60 4:4:4 0.86×, q65 4:4:4 0.98×, q50 at effort 6 0.54×.

### 20.3 What the side-by-side shows (`b5`; MEASURED and OBSERVED on the sheets)

- **AVIF q60 4:2:0** is 0.75× the bytes of WebP q80 on the 14 A/B tiles and more than 0.5 dB worse on 10
  of them: −2.5 to −2.8 dB on Stormwind, Winterspring and the region, continent and world tiles, where
  SSIM-Y drops by up to 0.032 (0.929 against 0.961 on the continent tile). At 2:1 and 3:1 it reads softer
  on city roofs, snow ridges and the coarse bands, where the map shows these tiles magnified between
  levels. It is as good on the coast, Duskwood and sea tiles.
- **AVIF q65 4:2:0** (0.84×) is more than 0.5 dB worse on 7 of 14 (down to −1.7 dB, Winterspring).
- **AVIF q70 4:2:0** (1.02×) matches or beats WebP q80 on all 14 (+0.7 dB or more).
- **AVIF q50** (the probe's size) is visibly blurred on every land tile (SSIM-Y down to 0.843 on the
  continent tile).
- **Verdict:** no AVIF setting is both as good as WebP q80 at every level and smaller. **AVIF q60 4:2:0
  is not "as good by eye"**: it is as good at level 0 and softer at the zone and region bands (revision 3
  said otherwise; MM-07). The AVIF that is as good (q70 4:2:0) saves nothing.

### 20.4 Full builds (`b5`, MEASURED)

| Build | Tiles | Gzip-6 total | Median | Largest | Level 0 | Level −1 | Level −2 | Level −5 (first view) |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| **WebP q80** | 6,669 | **51,768,589 B** | 7,933 B | 23,876 B | 35,287,305 B | 10,919,395 B | 3,857,349 B | 82,819 B |
| AVIF q60 4:2:0 | 6,669 | 41,200,065 B (0.80×) | 6,584 B | 15,825 B | 29,018,460 B | 8,203,298 B | 2,734,814 B | 66,322 B |

Revision 3's `b4` builds of AVIF q65 (4:4:4) and q50 were 0.98× and 0.55× of WebP q80. The probe's
estimates (51.0 MB WebP q80, 27.8 MB AVIF q50, on its ADT-aligned grid without the recolour) hold within
2 % and 4 %.

### 20.5 Decode time in Chrome (MEASURED on `b4`'s tiles, `p9-decode-*.json`)

| | WebP q80 | AVIF q60 4:2:0 | Ratio |
|---|---:|---:|---:|
| One tile, `ImageDecoder`, 1× CPU | 0.61 ms | 0.84 ms | 1.37× |
| One tile, `ImageDecoder`, 4× CPU | 1.17 ms | 1.41 ms | 1.21× |
| 40 tiles in parallel (`img.decode()`), 1× / 4× | 27.6 / 39.0 ms | 39.8 / 56.3 ms | – |
| First view, 13 tiles, 1× / 4× | 5.6 / 9.3 ms | 9.7 / 14.9 ms | – |
| Bytes of the 240-tile sample | 1,738,490 B | 1,460,353 B | 0.84× |

The reference machine's desktop CPU; CDP's CPU throttling slows the page's threads but is not a
laptop. Either format decodes one tile in about a millisecond; AVIF costs 1.2–1.4× the decode time
(1.44× for a screenful in parallel) for 0.80–0.84× the bytes. Laptop decode is UNKNOWN until ATL.9's
trace.

### 20.6 Browser support and what it means for the app

- CITED (caniuse.com, read 2026-09-27): AVIF from Chrome 85, Edge 121, Firefox 93, Safari 16.4 on
  macOS (16.1–16.3 partial) and Safari 16.0 on iOS; global support 95.4 %. WebP is supported by every
  browser the app targets (its build target is ES2023, `vite.config.ts`).
- **With WebP** (the recommendation) nothing changes: the painted atlas is WebP already.
- **With AVIF** (only if the owner overrides O13) the app needs a fallback, because a browser that
  cannot decode AVIF would show only the sea. Not a second tile set (twice the hosting): at start the map
  decodes a 1 × 1 AVIF from a data URL; if that fails, the minimap style is unavailable, the painted style
  (WebP) is used, the map says why, and the choice is not stored. The index's `template` names the
  extension, so the runtime knows before its first request.

### 20.7 Recommendation (O13)

**WebP q80**, as the owner's rule asks ("AVIF if a side-by-side visual check finds it as good as WebP
q80, otherwise WebP q80"): the only AVIF that is as good at every level (q70 4:2:0) is 2–13 % larger, and
the ones that save bytes are softer at the zone and region bands: q60 4:2:0 (41.2 MB, 0.80×) by a median
0.56 dB at level −2 and 2.45 dB at level −3, with more than 1 dB lost on 71 of 464 sampled tiles; q65
4:2:0 (0.91×) by 1.16 dB at level −3. AVIF would also decode 1.2–1.4× slower, encode ten times slower
(294 s against 30 s) and need the fallback of §20.6.

---

## 21. The style switch

### 21.1 Two indices of one shape

`public/maps/minimap/index.json` (§18.4) and `public/maps/atlas/index.json` (Part I §7.2) share the
shape, the layout and `atlasHash`, so the runtime's `resolveTile`, `AtlasTileLayer` and
`AtlasUnderlay` serve both unchanged. The differences are data: the directory, the extension,
`baseLevel` (0 against −2), `underlayLevel` (−6 against −5), the sea colours, and `uiMaps` (empty for the
minimap). A style is therefore `{ style, dir }`: `minimap` → `maps/minimap/`, `painted` → `maps/atlas/`.

### 21.2 How the runtime swaps tile sets

- **Adapter**: `MapStyle = 'minimap' | 'painted'` in `src/map/adapter.ts`, in the adapter's options
  and its status (map-presentation §25.8 asks for the same). `tileBandOf(index, urlTemplate, style)`
  gives the band the id `atlas-tiles:<style>`, so the layer diff replaces the band when the style
  changes instead of treating it as the same layer. The band descriptor gains `keepBuffer` (§24.5).
- **Decoded tiles per band**: `DecodedTiles` keys are `z/x/y` today, shared by every band. They
  become per band (a map from band id to `DecodedTiles`), or the key gains the style. Otherwise a
  painted tile's key would make a minimap tile start as the crop of an ancestor that was never
  decoded in its own style. Test: switching styles never starts a tile from the other style's key.
- **No hole when switching**: the new band's `AtlasTiles` (its tiles and its own underlay) is added
  above the old one; at that moment the old band's tiles outside the view (its kept buffer) are pruned,
  and the old band is removed when the new tile layer's first view has decoded (`onceIdle`, as the
  underlay already waits for) or after 2 s, whichever is first. Until then the old picture shows under
  the new one, so the switch never shows bare container colour. Reduced motion: no fade, the same hold.
  The decoded memory of both bands during the hold is budgeted (§24.5, MM-09).
- **Sea background**: `syncSeaBackground` already reads the drawn band's `seaColour`; it takes the new
  band's when the old one is removed, so the container is navy in the minimap style and rgb(61, 55, 41)
  in the painted one.
- **Underlay**: each style has its own at its index's `underlayLevel`: the minimap's is level −6 (4 tiles,
  21,374 B), loaded after its own first view; the painted style's stays level −5. The painted underlay is
  not kept when the minimap is shown.
- **Loading**: the controller loads an index per style (`MapResources.atlas(expectedHash, style)`,
  memoised per style and hash); the painted index is fetched only when the painted style is first
  shown. `parseAtlasIndex(json, baseUrl, dir)` accepts `t/{z}/{x}/{y}.webp` and, only if the owner
  overrides O13 and the AVIF probe passed, `.avif`.
- **Nothing else changes**: the surface, placements, partition, wheel, underlay mechanism, markers and
  every descriptor stay the same; only the tile band and the presentation's palette (map-presentation
  §25.4) follow the style.

### 21.3 What persists

The style is a **view setting kept per browser**, not project data: not in the project file, not
exported, not undone. It lives where the presentation keeps its drawer settings (map-presentation
§25.3.7: the IndexedDB `settings` record, `{ version: 1, style: 'minimap' | 'painted', … }`), read at
the map's first mount; if that store is not built first, a `localStorage` key
`forever-route-lab:map-style` in the pattern of the theme (`src/main.tsx`), with every access in
`try`/`catch`. Default `minimap`. An unreadable value, or a style that is unavailable on this device
(§21.4), falls back to the default without being written.

### 21.4 Failures and fallbacks

The message goes where map-presentation §25.3 puts the map's notices (the drawer replaces the status
line, D-047).

| Case | What the map draws | Message |
|---|---|---|
| Minimap index missing or refused (`atlasHash` differs) | The painted style | "Minimap tiles unavailable: <why>; showing the painted map" |
| Minimap tiles missing (a clone or build without the pack, §23.3) | The index loads but the first tile fails: the painted style | "Minimap tiles not downloaded (run `pnpm maps:minimap:fetch`)"; a deploy build cannot lack them (§24.3) |
| AVIF chosen and not supported | The painted style | "This browser cannot show the minimap tiles (AVIF)" |
| Both indices refused | Part I §8.6's "art off" mode | as now |

### 21.5 What each style draws

As map-presentation §25.4 sets it; the atlas side is:

| | Minimap (default) | Painted |
|---|---|---|
| Tiles | `maps/minimap/`, 6,669 WebP | `maps/atlas/`, 792 WebP |
| Sea (container and sea keys) | navy #0d1b30 | rgb(61, 55, 41), coastal rgb(131, 118, 88) |
| Underlay | level −6, 4 tiles | level −5, 13 tiles |
| Painted names | none (`BaseMapLabels` empty) | Part I §8.7 |
| Zone outlines | on (the minimap has no borders) | optional, as now |
| Card for Zephras Isle | the island on navy, vector frame and caption | the 2521 painting, frame and caption |
| Ironforge, Undercity | named as underground cities (§22) | painted cards |

### 21.6 The control and accessibility

"Map style: Minimap / Painted" in the "Map layers" drawer (D-047, built by map-presentation's MP.4b), a
radio group with a visible label; the choice is announced; the About dialog and the legend name both
NOTICEs (D-033 rule 2) and say which is shown. Keyboard and screen-reader rules as UI.md §9; the map's
instruction text (Part I §8.8) names the style.

---

## 22. Labels

The minimap has **no names**: no zone, town or landmark lettering (OBSERVED on the probe's samples).
Every name therefore comes from the presentation layer (map-presentation.md §13 and §25.4), which
already plans compact labels, zone cards and zone labels with level spans at every band on the
minimap. The atlas's part is the interface:

- **`BaseMapLabels`** is empty for the minimap style (`continents`, `zones` and `places` all false),
  so the presentation never hides a name expecting the picture to carry it. In the painted style it
  stays as Part I §8.7 item 4 sets it.
- **City names**: the six capitals are named by the presentation's city labels at their frames'
  centres (the committed UiMap rows 1453–1458). In the minimap style **Ironforge (1455) and the
  Undercity (1458) are underground**: the minimap shows only Ironforge's gate and the ruins of
  Lordaeron (OBSERVED, probe crops). Their labels read "Ironforge (underground city)" and
  "Undercity (underground city)", anchored at the city frame's centre, and from the zone band their
  frame is drawn as a dashed outline (the frames layer, `--frl-map-frame`), so the quest givers and
  services drawn inside have a visible context. The painted style keeps its city cards and the
  capitals' painted banners (Part I §6.5).
- **The Zephras Isle card** keeps its caption from the frames layer (Part I §5.5).
- **Order (MM-05)**: because the minimap draws no names, it becomes the default (MM.9) only after the
  presentation's labels canvas (MP.1) and its zone, continent and city labels (MP.7) are built; until
  then the atlas stays on the painted style by default, and the minimap is reachable through the style
  switch for review.
- These are requests to the presentation design (§13's list); map-presentation.md revision 3 is
  being written by another team, and this design does not edit it.

---

## 23. Hosting and repository size

### 23.1 The problem

A WebP build is 51.8 MB of tiles (6,669 files). The painted art (9.0 MB) is already in `main`, and the
painted atlas (6.9 MB) will be with ATL.6's commit. Tiles would be re-committed whenever a client build
changes the minimap: a changed ADT rewrites the 4 to 9 level-0 tiles it touches and one to four tiles at
each coarser level, while a global change (lighting, water style, a new build of every texture) rewrites
all 52 MB (ESTIMATE; how often the client's minimaps change between builds is UNKNOWN). Git keeps every
version forever, and every clone downloads them.

### 23.2 Options

Limits CITED from GitHub Docs (read 2026-09-27): Pages source repository recommended ≤ 1 GB;
published site ≤ 1 GB; soft bandwidth 100 GB a month; deployment timeout 10 min; Pages artifact
officially under 1 GB (10 GB absolute); "Git LFS cannot be used with GitHub Pages sites"; LFS on
GitHub Free: 10 GiB storage and 10 GiB bandwidth, and downloads by Actions count against the owner's
bandwidth; release assets: each under 2 GiB, up to 1,000 per release, "no limit on the total size of
a release, nor bandwidth usage".

| Option | `main` history | Deploy | CI without the client | Removal on request (D-033 rule 3) | Verdict |
|---|---|---|---|---|---|
| **Commit to `main`** | +52 MB per full rebuild, forever; every clone pays | Simple | Yes | Deleting the files leaves them in history; full removal needs a history rewrite of `main` | Rejected: grows `main` without bound, and removal is hard |
| **Orphan branch** in the same repository | `main` lean, but the repository and default clones still carry it | Workflow checks out two refs | Yes | History rewrite of that branch only | Workable, but clones and the repository still grow, and the "1 GB recommended" limit applies to the whole repository |
| **Separate repository**, deployed alongside (its own Pages site, or checked out at build) | Lean | Two repositories to pin; a second Pages site means a second origin, cache and 1 GB budget | Yes | Delete or rewrite that repository | Workable; more moving parts than a release asset |
| **Release asset** (a tile pack downloaded at build time) | Lean: only index, manifest, NOTICE and a pointer (≈ 390 kB gzip) | One download and hash check in the workflow | Yes | Delete the release asset, commit the pointer's removal, redeploy; `main` never held the pixels | **Recommended** |
| **Git LFS** | Lean | Pages cannot serve LFS; an Actions build could check LFS files out, but each deploy spends about 52 MB of the 10 GiB monthly LFS bandwidth (ESTIMATE: under 200 deploys a month) | Yes, within quota | Hard: GitHub's documented way to remove LFS objects is to delete and recreate the repository (CITED) | Rejected |

### 23.3 The recommendation: a release-asset tile pack

- **In `main`** (`public/maps/minimap/`, allowlisted in `.gitignore` like `public/maps/atlas/`):
  `index.json`, `manifest.json` (every tile's path, bytes and SHA-256), `NOTICE.md` and `pack.json`,
  the pointer: `{ asset, tag, bytes, sha256, treeHash, client }`. `public/maps/minimap/t/` is
  gitignored, and a test fails if any file under it is tracked.
- **The pack** (MM-06): `minimap-tiles-<treeHash 12>.tar`, the tool's deterministic tar of
  **`NOTICE.md`, `manifest.json` and `t/`**, in that order, so a copy downloaded from the release carries
  Blizzard's notice, the non-affiliation statement and the list of alterations (D-033 rule 2). MEASURED on
  a tar of `b5` made with the system `tar` (`<r31>/index5.ts`): 58,183,680 B, headers and padding of 6,671
  files included; WebP does not compress further (52,206,634 B gzip-6). It is attached to a GitHub release
  tagged `minimap-<client version>-<treeHash 12>` (for the `b5` prototype,
  `minimap-1.60.1.70009-583ac6d8831e`), whose **release text is the NOTICE** (the tool writes it with the
  pack). One pack per tile set, **never replaced**: a new build is a new tag. Publishing the release is the
  owner's step (OD-13: nothing is pushed until he says so).
- **Local development**: `pnpm maps:minimap:fetch` downloads the asset `pack.json` names (with `gh`
  or the release URL), checks its SHA-256 and every tile's against the manifest, checks that the pack's
  `NOTICE.md` and `manifest.json` equal the committed ones, and extracts `t/` into
  `public/maps/minimap/t/`; on the machine with the client, `tools/maps/minimap.ts` writes the same
  folder directly. Without either, `pnpm check` still passes (§23.4) and the app falls back to the
  painted style (§21.4).
- **Deploy** (the Milestone 9 workflow): check out `main` → `pnpm maps:minimap:fetch` (with the
  workflow's token) → **`pnpm build:deploy`**, whose dist audit runs in deploy mode and verifies every tile
  (§24.3) → upload the Pages artifact (with a short artifact retention). Any commit's deploy is
  reproducible for as long as its pack exists, because the commit pins the pack by SHA-256.
- **Removal on request** (MM-06), in order:
  1. delete the release asset (and the release);
  2. commit the removal of `public/maps/minimap/` (index, manifest, NOTICE, pointer), so no later build
     looks for the pack;
  3. **redeploy Pages** from that commit (the workflow run), because GitHub Pages keeps serving the last
     deployed artifact until a new one replaces it;
  4. **confirm** on the published site that `maps/minimap/index.json` and a sample of tile URLs under
     `maps/minimap/t/` (one per level) return 404, and record the check in STATUS;
  5. delete any Pages artifacts of earlier workflow runs that are still retained.
  The pixels were never in git history (the manifest holds only hashes), so no history rewrite is needed.
  Copies already downloaded by others cannot be recalled; this is stated neutrally in the NOTICE's
  removal line, and no legal conclusion is drawn. The committed painted art is a separate matter (it is
  in history already); the same mechanism could later move it out of `main` (not proposed here).
- **Site size**: about 52.2 MB of minimap folder, 6.9 MB atlas, 1 MB art after ATL.10, 0.5 MB terrain and
  client tables, 5.4 MB navigation, 0.9 MB data and the app: about 67 MB, far under 1 GB (ESTIMATE from the
  measured parts). Bandwidth: a visitor typically loads a few MB of tiles; the whole set is 52 MB
  (ESTIMATE: 100 GB a month is about 1,900 complete downloads).

### 23.4 `--check`, CI and the dist audit without the client

- **CI cannot rebuild the tiles** (it has no client), exactly as for `nav:check`, `convert.ts --check`
  and `atlas.ts --check`. `minimap.ts --check` is a manual gate on the owner's machine, recorded in
  STATUS with the pack's tree hash, and required before a new pack is published.
- **`pnpm check` never needs the tiles** (MM-04). It runs `pnpm build`, whose dist audit runs in its plain
  mode: the minimap folder's index, manifest, NOTICE and pointer must ship and agree; tiles that are
  present must match the manifest; if none is present the audit prints one loud line ("minimap: 0 of
  6,669 tiles present; the pack is not fetched; a deploy build would fail") and passes; a partial set
  fails. So a fresh clone or `git clean` stays green, and the check reports the missing tiles instead of
  failing on them.
- **What CI checks** (no client): `maps:validate` M1–M11 (§24.4), with M6, M7 and M8 reported as skipped
  when the tiles are absent; with the pack fetched (once OD-13 allows a release): the pack's SHA-256 against
  `pack.json`, every tile's SHA-256 and size against the manifest, the index against the manifest, the
  NOTICE against the manifest, the layout hash, the budgets, M8, M11 and the deploy-mode dist audit.
- **The provenance chain**: the manifest records the client build, every input's FDID and CKey, the
  tool tree hash and the encoder versions; `--check` on the client machine proves the tiles equal the
  tool's output for those inputs; CI proves the deployed tiles equal the manifest.

---

## 24. Budgets and gates

### 24.1 The `minimap` budget (from the measured build)

- **Total**: ≤ **60.0 MB** gzip-6 (decimal) for `maps/minimap/`: 51.77 MB of WebP tiles plus about
  0.39 MB of manifest (ESTIMATE, §18.8), index, NOTICE and pointer (about 52.16 MB), with 15 % headroom
  (the painted atlas has 16 %). If the owner overrides O13 with AVIF: ≤ 48 MB (41.2 MB measured plus the
  same files and headroom).
- **Per tile**: ≤ **32 kB** gzip-6 (largest measured 23.9 kB), as the painted atlas.
- **Per level**: each level's tiles within their baseline + 10 %: 0: 35,287,305; −1: 10,919,395;
  −2: 3,857,349; −3: 1,251,623; −4: 340,719; −5: 82,819; −6: 21,374; −7: 5,971; −8: 2,034 B;
  `index.json`, `manifest.json`, `NOTICE.md` and `pack.json` within their own baselines + 10 %.
- **Together with the other map folders**: `atlas` ≤ 8.0 MB and `art` ≤ 1.0 MB (Part I), `terrain` ≤
  600 kB, `client` ≤ 40 kB. Expected after ATL.10: about 60.6 MB of map folders (minimap 52.2, atlas 6.9,
  art 1.0, terrain 0.4), against 9.5 MB committed today (art 9.0, terrain 0.4).
- **World-band contrast (O17)**: ≥ **2.0:1 at the fit view by Part I's method** (§9.2: median land
  luminance against the sea, land farther than 48 RGB from it); MEASURED on the raster: 2.09:1 (MapGenie's
  saved shot 2.60:1 by the same method, its pins and labels not separated; 1.96 and 1.95 by revision 3's
  method, recorded alongside). Part I's method is kept (MM-11); only the threshold is the minimap style's
  own, because Part I's 2.5:1 needs a near-black sea (2.54:1).
- **The recolour census gates** of §19.5.

### 24.2 First view

At the fit view in the 918 × 700 panel (−5.22, level −5): **13 tiles, 82,819 B**, plus the index
(2,272 B): 85 kB, within ATL.7's ≤ 100 kB gate, and 7 % less than the painted style's 91.6 kB. The
minimap underlay (level −6, 4 tiles, 21,374 B) loads after the first view. In a 700 × 500 panel (level
−6) the first view is those 4 tiles, and the underlay adds no bytes. First art ≤ 1.0 s after the map chunk
at 50 Mbit/s (Part I §9.2) applies unchanged.

### 24.3 The dist audit

A new `mapFolders` entry in `tools/build/dist-requirements.json`:

- `name` `minimap`, `dir` `maps/minimap`, `source` `public/maps/minimap`, `decision` the Part II decision
  record (D-049, §28), a `reason` naming Blizzard Entertainment's minimap textures, D-033 and D-045;
- `totalGzipBudgetBytes` 60,000,000; `baselineTolerance` 0.1; baselines for the four files;
- `tiled`: `prefix` `t/`, `perFileGzipCapBytes` 32,000, `levelBaselines` from §24.1;
- **`external`** (new, MM-04): `{ "prefix": "t/", "pointer": "pack.json" }`: the files under `t/` come from
  the release pack, not from git.

The audit's existing rules then apply: the NOTICE and manifest must be present; every file under the
folder must be listed in the manifest with its SHA-256; images outside the listed map folders fail.
`.webp` (and `.avif`) are already image extensions the audit knows. The folder becomes required once
`public/maps/minimap/manifest.json` exists. For an `external` prefix the listed-but-missing rule depends
on the mode:
- **plain mode** (`pnpm build`, so `pnpm check`): no file under the prefix → one loud warning line and a
  pass, with the budgets taken from the manifest's bytes; every file present → checked as today; some but
  not all → fail;
- **deploy mode** (`audit-dist.ts --deploy`, run by a new `pnpm build:deploy`, which the Pages workflow
  uses): every listed file is required, as today.

The painted `atlas` and `art` entries are unchanged by Part II. State this in MM.6's tests, in
`tools/build` README and in STATUS's commands (§13).

### 24.4 `maps:validate` without the client (M1–M11)

| Check | What it proves | Needs the tiles? |
|---|---|---|
| M1 | `index.json`, `manifest.json`, `NOTICE.md` and `pack.json` parse; the NOTICE equals the text regenerated from the manifest; the alterations are listed; the pack's recorded contents are `NOTICE.md`, `manifest.json` and `t/` | no |
| M2 | The index's stored keys equal the manifest's files, its sea keys the manifest's sea list; `baseLevel` 0; `underlayLevel` −6 and stored; no key both stored and sea; every level −8…0 present; `seaColour` and `coastColour` #0d1b30 | no |
| M3 | `atlasHash`, placements, insets, extent and `seamE` equal the painted index's and `src/geo`'s values for `ATLAS_LAYOUT` (as T4) | no |
| M4 | The sources: 1,796 minimap and 1,796 root-ADT rows at this build, unique FDIDs, 32-hex CKeys, maps exactly 0, 1 and 2991 (no phase map); the counts per map equal the recorded ones | no |
| M5 | Budgets from the manifest's bytes (total, per level, per tile); with the tiles, from the files | no |
| M6 | Every tile's bytes and SHA-256; each a 256 px still WebP (or AVIF); nothing unlisted under `t/` | yes |
| M7 | The pointer: the pack's name matches its tree hash; with the pack present, its SHA-256 and that its `NOTICE.md` and `manifest.json` equal the committed ones; the tree hash equals the hash over the manifest's files | the pack |
| M8 | Relief agreement, re-derived offline at level −2 over the committed relief (maps 0 and 1): the share of water cells, land cells and **shore land cells** (land within 2 cells of water; MM-02) whose pixels lie on the navy ramp (hue 213–216°, within the ramp's luma), against the manifest's census within a tolerance MM.4 calibrates on the real build; Zephras Isle reported as not checked | yes |
| M9 | No sea key at any level covers a committed relief land cell (a misplacement or a mask error would); MEASURED on `b5`: 0 at every level on both maps (`<r31>/m9.ts`) | no |
| M10 | The manifest's parameters equal `minimap-params.ts`, and its census (both seam measures, texture, inversions, dry texels, shore cells, skirts, black components) is present and within the §19.5 gates | no |
| **M11** | **The independent seam measure** (§19.5) re-derived from the tiles at levels −1 to −3, with the relief's water class as the wet mask, equals the manifest's relief-mask copy of that census within ±2 edges per level and map (the tool records both masks' results) | yes |

`art-build.test.ts` and the new `minimap-build.test.ts` pin M1–M11 on a synthetic folder, each shown
failing on a tampered copy, as T1–T9 are today.

### 24.5 Decoded-tile memory (MM-09)

In the minimap style every land key is stored, so no ancestor image is shared as in the painted style.
Arithmetic (ESTIMATE): a decoded 256 px tile is 262,144 B (RGBA). At the worst fractional zoom in the
918 × 700 panel (just above a half level, where Leaflet draws the lower level at 0.71×) the view spans
1,298 × 990 px of one level: up to 7 × 5 = **35 tiles, 9.2 MB**. With revision 3's level −5 underlay
(13 tiles, 3.4 MB) that is 12.6 MB, over Part I §9.2's 12 MB; Leaflet's default kept buffer (2 rows and
columns around the view after a pan) holds up to 11 × 9 = 99 tiles (26 MB); and the 2-second hold of a
style switch keeps both styles' tiles.

**Budgets per style**, counted in the ATL.9 harness as live tile images (loaded `<img>` elements in the
tile and underlay panes) × 262,144 B, at 20 fractional zooms and after pans, and observed on the owner's
laptop with Chrome's own memory figures:
- **in view** (tiles meeting the view, and the underlay): ≤ **12 MB** per style;
- **all live tiles** (with the kept buffer): ≤ **20 MB** per style;
- **during a style switch**: ≤ **26 MB**, for at most 2 s.

**Design changes to meet them**: the minimap index sets **`underlayLevel` −6** (4 tiles, 1.05 MB decoded,
21 kB; a coarser fallback picture, 64 yd/px, shown only while finer tiles load), so the worst view is
35 + 4 tiles, 10.2 MB; the minimap band sets **`keepBuffer` 1** (up to 9 × 7 = 63 tiles, 16.5 MB, plus the
underlay: 17.6 MB); at a switch the old band's kept buffer is pruned before the hold, so the hold holds at
most the two views and both underlays (9.2 + 3.4 + 9.2 + 1.05 = 22.9 MB for the worst case of painted to
minimap). The painted style keeps Part I's settings and budget. MM.8 measures all three figures; if one
fails, the fallback is `keepBuffer` 0 in the minimap style, then a shorter hold.

---

## 25. Step plan

Part I's ATL.0 to ATL.8 are built (§3.5). The minimap steps follow ATL.8; ATL.9 then measures both
styles (MM.8), and ATL.10 switches the atlas on with the minimap as the default (MM.9) **only once the
presentation's names exist** (MP.1, MP.7). Every step ends green on `pnpm check` and `maps:validate`
**without the minimap tiles** (§23.4), and nothing is the default until ATL.9 passes.

| Step | Files | Tests and gates | Budgets | Depends on |
|---|---|---|---|---|
| MM.0 Decisions | DECISIONS (Part II's record, proposed as **D-049**: D-047 and D-048 are taken); STATUS owner rows O12–O20 and the step order below | review of the texts | – | owner answers (defaults otherwise) |
| MM.1 Runtime for two styles | `src/map/adapter.ts` (`MapStyle`, band id per style, `keepBuffer` in the band), `src/infra/maps/atlas-index.ts` (`dir`, extension), `map-resources.ts` (an index per style), `src/map/leaflet/atlas-decoded.ts` and `LeafletMapAdapter.ts` (decoded tiles per band, the hold-until-idle swap with the old buffer pruned), `atlas-tile-layer.ts` (`keepBuffer` from the band), `src/app/map-controller.ts` | jsdom: a `baseLevel` 0 index with `underlayLevel` −6 accepted and every key stored or sea; a style switch shows no bare container frame; no tile starts from the other style's key; the old band's off-view tiles are removed at the switch; the sea colour follows the band; the painted index is not fetched until shown | first view ≤ 100 kB per style | ATL.8 |
| MM.2 Tool inputs | `tools/maps/minimap.ts`, `lib/minimap-inputs.ts`, `minimap-decode.ts`, `minimap-liquid.ts`, `minimap-params.ts` | synthetic WDT and BLP fixtures (`test-support.ts`); refusal on non-DXT1, alpha, size, missing or encrypted files; the relief-equality refusal; client-gated: counts 736/988/72 and the relief equality | – | MM.0 |
| MM.3 Recolour | `lib/minimap-recolour.ts`, `minimap-seams.ts`, `minimap-census.ts` | synthetic rasters: each family to the navy; **a lake whose b − g straddles 10 comes out without a contour** (the field); shallows to the ramp; warm and grey kept; the luma cap keeps bright ponds and the hue window the violet river; lava and slime kept; the gate's reach (4.2 and 8.3 yd); **a dry texel never brightens, before and after the feathers**; the family feather; the edge feather removes a synthetic step, including a 10-row river, and fades out along the edge; **the corner term makes four tiles meet**; the navy floor; void flood and **haze flood** (haze wider than 64 texels composited); the edge-skirt rule applied to exactly the 4 sides; each census gate failing on a crafted raster; client-gated: the census of §19.5 within ± 10 % of each figure, and the contact sheets | – | MM.2 |
| MM.4 Stitch, pyramid, outputs | `lib/minimap-stitch.ts`, `minimap-keys.ts`, `minimap-manifest.ts`, `minimap-notice.ts`, `minimap-pack.ts`, `minimap-checks.ts`, `minimap-review.ts`; the shared `atlas-index.ts` and `atlas-pyramid.ts` generalised | periodic weights equal direct ones; partition at the seam and card edges; reductions exact; sea keys; no flat non-sea tile; **the tar holds `NOTICE.md`, `manifest.json`, `t/` in that order** and is byte-identical; the independent seam census on levels −1 to −3 with both masks; client-gated double build byte-identical and `--check`; M1–M11 each failing on a tampered folder | `minimap` ≤ 60 MB, ≤ 32 kB per tile, per level + 10 % | MM.3 |
| MM.5 Owner review | `--review` contact sheets at 1:1, 2:1 and 3:1 of native pixels (§18.10); the format sheets magnified bilinearly (§20.3) | the owner signs off (O18) and answers O12, O17 and O20 | – | MM.4 |
| MM.6 Hosting and gates | `public/maps/minimap/` (index, manifest, NOTICE, pointer); `.gitignore` (allowlist the folder, ignore `t/`); `tools/maps/minimap-fetch.ts` and `maps:minimap:fetch`; `tools/maps/validate.ts` (M1–M11); `tools/build/dist-requirements.json` (`external`), `tools/build/lib/audit.ts` (plain and deploy modes), `audit-dist.ts --deploy`, `package.json` `build:deploy`, their tests; the release with the NOTICE as its text (the owner publishes it) | a test that nothing under `t/` is tracked; fetch refuses a wrong SHA-256 or a pack whose NOTICE or manifest differs; **`pnpm check` passes on a clone without the tiles and prints the warning; the plain audit fails on a partial set; the deploy audit fails without the tiles and passes with them** | as MM.4 | MM.5; OD-13 for publishing |
| MM.7 Style control and labels hook | the drawer's style switch (map-presentation MP.4b), persistence, About and legend text naming both NOTICEs, `data-map-style`; the §22 requests delivered to the presentation | component tests: persistence, fallback when unavailable, announcement; UI tokens: the navy against `--frl-map-frame` ≥ 3:1 | – | MM.1, MM.6, MP.4b |
| MM.8 Measure (ATL.9 with both styles) | ATL.9 as Part I §11, run in each style: laptop trace, holes, hairlines, decode, the style switch (no bare frame), contrast (§24.1), **decoded-tile memory (§24.5) in view, with the kept buffer and during the hold** | §9.2 gates in each style; ≥ 2.0:1 by Part I's method in the minimap style; §24.5's three budgets | – | MM.7, ATL.8 |
| MM.9 On by default, edits elsewhere | ATL.10 with `minimap` the default; §13's documents | dist audit in deploy mode; the fit-both view shows every levelling zone's name in the minimap style (MP.7's test run on the minimap); review | all | **MM.8, MP.1, MP.7** |

---

## 26. Risks

| # | Risk | Mitigation |
|---|---|---|
| MR1 | The release asset is deleted or unreachable, and a deploy or local build has no tiles | The pointer names it and the fetch fails loudly; the deploy-mode audit refuses a deploy without the tiles; `pnpm check` stays green and says so; the runtime falls back to the painted style; the owner keeps the pack locally |
| MR2 | Blizzard asks for removal | Delete the asset, commit the pointer's removal, redeploy Pages and confirm the 404s (§23.3); the pixels were never in git history. Copies downloaded before removal cannot be recalled. The painted art already committed is a separate case |
| MR3 | The recolour touches land or misses water | Colour, a gate of 4–8 yd and the dry cap; fully dry shore cells turned bluer 0.007–0.03 %, water cells untouched 1.2–1.4 % (measured); census gates in the build; M8 re-derives water, land and shore cells offline; the contact sheet names the banks |
| MR4 | Residual seams, patches and texture (§19.6) | The family field, both feathers and the corner term; both seam measures and the texture census in the manifest with gates; the sheet shows the worst; the parameters are tunable |
| MR5 | The shallows lose the seabed's hue | Luma detail kept. The alternative that keeps hue (shift each tile's water by navy minus its tile's base colour) was prototyped first and rejected: it depends on each tile's base, so tile-shaped blocks and seams remained (`<mm>/img/seam-<area>-v1.jpg`) |
| MR6 | Cross-platform determinism (V8's `Math.sin` and `Math.exp`, libwebp, aom) | Platform and versions recorded; `--check` on the reference machine; the periodic weights computed once, and could be tabulated in the tool if needed |
| MR7 | 52 MB of tiles is too much for the owner's laptop or connection | Only the view's tiles load (first view 85 kB; a screenful 35 tiles); decode 0.6 ms per tile measured on the desktop; the memory budgets of §24.5; ATL.9's laptop trace before the default |
| MR8 | The minimap changes in a new client build | A new pack per build; M4's counts and the census flag the change; the old pack stays for old commits |
| MR9 | Phases: a later build shows map 0 in another phase or moves content to a phase map | Only the layout's maps are read; phase maps listed as not drawn; M4 |
| MR10 | Contrast below Part I's criterion | The land is Blizzard's and darker; the style has its own threshold by Part I's method (O17); the presentation's outlines and labels add legibility; a coastline stroke is available (Part I §8.7 item 8) |
| MR11 | The presentation's names are late, so the minimap default would show no names | MM.9 depends on MP.1 and MP.7 in the step table and in STATUS's order (§13); until then the painted style stays the default |
| MR12 | AVIF chosen and the fallback fails | Not recommended (§20.7); if chosen, the capability probe runs before the first request and the painted style is always available |
| MR13 | Zephras Isle cannot be checked offline | Its own liquid grid in the build, its hash in the manifest, the card, lake, beaches and dock on the contact sheet |
| MR14 | Pages bandwidth or the Pages artifact size | About 67 MB site against 1 GB; about 1,900 complete downloads a month within the soft 100 GB (ESTIMATE); a service-worker cache later |
| MR15 | Decoded tiles exceed the memory budget on the laptop (MM-09) | Underlay at level −6, `keepBuffer` 1, the old buffer pruned at a switch (§24.5); MM.8 measures; fallback `keepBuffer` 0 and a shorter hold |
| MR16 | Kept swamp water leaves two-style lakes and seams (§19.8) | Listed as kept in the NOTICE; on the sheet; owner question O20; a liquid-grid rule prototyped only if chosen |

---

## 27. Comparison with MapGenie (saved screenshots only)

`<mm>/img/compare-mapgenie.jpg` puts the minimap style (revision 3's `b4`, WebP q80, drawn from the level
the runtime picks) beside MapGenie's saved shots 02 (world, z10 = our −5.06), 04 (Durotar, z13.5 =
−1.56), 10 (Razor Hill, z16 = +0.94) and 13 (the Zephras inset, z12.5 = −2.56), with the painted
style for 04 and 10. Revision 3.1 changes water only; at these scales the difference is the shallows.

| Point | MapGenie (OBSERVED on saved shots) | Minimap style | Verdict |
|---|---|---|---|
| Base picture | The client minimap (correlation 0.90 with ours) | The same minimap | **Matches**: the same pixels at the zone band and close zoom |
| Sea | Flat rgb(1, 29, 41) with the shallows kept; no tile seams visible | Navy #0d1b30, one even colour in the open sea, the shallows on a navy ramp; long ADT edges with a seam over 4 levels at the zone band at about the rate of lines that are not ADT edges (§19.5) | **Matches**; our navy is further from the app's cyan (the presentation's rule); both keep shallows |
| Land against sea at the world band | 2.60:1 by Part I's method (pins and labels not separated); 1.95:1 by revision 3's | 2.09:1; 1.96:1 | **Short** by Part I's method (2.09 against 2.60); level by revision 3's. How much MapGenie's pins add is UNKNOWN |
| Close zoom | Tiles to z16 (≈ 1 yd per texel), upscaled at z17 | Level 0 at 1 yd/px to zoom 0, magnified to +2 | **Matches** |
| Names | None on the base; region titles off | None on the base; the presentation's zone, continent and city names, Ironforge and the Undercity named as underground | **Beats** it with the presentation layer, which MM.9 waits for |
| Zephras Isle | A framed inset with a black background and its title, south-west of Kalimdor | A card at the top of the gap, the island on navy with its haze composited over it, vector frame and caption "not in position" | **Matches** the framing; ours follows the owner's navy rule and states why it is a card |
| Least zoom | Tiles stop at z8 (our −7.06); at z7 the land disappears | Levels to −8, the whole world always drawn | **Beats** it |
| Loading | Cross-faded tiles | Part I's underlay and ancestor-first tiles; the style switch holds the old picture | **Matches** by mechanism (ATL.9 measures it) |
| Style choice | One style | Minimap or painted | **Beats** it (the painted art's names and towns remain one click away) |
| Provenance | Not stated | Reproducible from the pinned client, byte-identical rebuild, manifest, NOTICE with the alterations, the NOTICE inside the pack | **Beats** it on reproducibility |

---

## 28. Decisions for the owner and the architect

### 28.1 For the owner

| # | Question | Default (recommended) | Alternatives and evidence |
|---|---|---|---|
| O12 | The sea | Navy #0d1b30 with the shallows on a ramp to rgb(60, 92, 130), by revision 3.1's rule (§19.2): the family field, a gate of 4–8 yd, dry texels never brighter, both feathers and the corner term; coloured water (bright ponds, the violet river by Dalaran) kept | Flat navy without shallows (MapGenie keeps its shallows; D-047's "one even colour" holds for the open sea either way); the violet river recoloured too (it then disappears into the navy, `<r31>/img/t2.png`); the minimap's own navy rgb(27, 51, 71) (contrast 1.58:1); MapGenie's rgb(1, 29, 41) (too close to the app's cyan) |
| O13 | Format | **WebP q80** (51.8 MB): no AVIF is both as good at every level and smaller (§20.7) | AVIF q60 4:2:0 (41.2 MB, 0.80×): as good at level 0, softer at the zone and region bands (−0.56 dB at −2, −2.45 dB at −3), 1.2–1.4× decode, a fallback; AVIF q70 4:2:0: as good, 1.02–1.13× the bytes |
| O14 | Hosting | Release-asset tile pack with the NOTICE and manifest inside, pinned in `main`; removal redeploys and confirms (§23.3) | A separate repository; an orphan branch; committing to `main` (grows history, removal needs a rewrite) |
| O15 | The alterations in the NOTICE (§18.8): recolour with the family field, dry cap, feathers, corner term and navy floor; void and haze; skirts; resample; compact layout and card; re-encode | Accept as within D-045 ("recoloured to one navy") | Decline the seam steps: of the 37 (Kalimdor) and 85 (EK) water edges over 10 levels in the source by revision 3's metric, 10 and 8 remain with no feathers (`b1`), 12 and 11 with the family feather only (`b3`, corrected), 2 and 2 with revision 3's feathers (`b4`), 0 and 1 with revision 3.1's (`b5`); by the independent measure, long edges over 4 levels at level −2 go 45 and 104 → 9 and 13 |
| O16 | Black texels | Keep as drawn (0.002 % of texels) | Fill the 116 whole black DXT1 blocks (another listed alteration) |
| O17 | Contrast gate for the minimap style | ≥ **2.0:1 by Part I's method** (ours 2.09; MapGenie's saved shot 2.60 with its pins and labels) | Part I's 2.5:1 (needs a near-black sea: 2.54); revision 3's method and 1.85:1 (1.96 against MapGenie's 1.95; a change of method as well as threshold) |
| O18 | Review | The owner signs off the contact sheets at native pixels (1:1, 2:1 and 3:1; §18.10) before the first pack is published and after any parameter change | Architect review only |
| O19 | Underground cities | "Ironforge (underground city)" and "Undercity (underground city)" labels with a dashed city frame from the zone band | The painted city cards drawn over the minimap from the zone band (mixes the styles) |
| **O20** | **Swamp and brown water** (MM-08) | **Keep as drawn**, listed as kept in the NOTICE; the two-style lakes and swamp coasts of §19.6 remain (`mm31-1to1-D.png`) | Recolour swamp water by the liquid grid alone: needs its own prototype (MM.3) and sheet; a colour-based trial made tile-shaped patches in the swamps (`<r31>/img/brown.png`) |

### 28.2 For the architect

| # | Question | Default |
|---|---|---|
| A12 | Tool | A sibling `tools/maps/minimap.ts` sharing the index, pyramid and manifest helpers |
| A13 | Grid | Resample to the atlas grid, Lanczos-3 (structure over PSNR; faint ringing accepted; Catmull-Rom the fallback); no native-grid index (§18.3) |
| A14 | Index | Part I's shape with `baseLevel` 0, `underlayLevel` −6, `style`, the directory and extension as data |
| A15 | Swap | One band per style, decoded tiles per band, the old band's buffer pruned and the old band held until the new first view has decoded, within §24.5's memory budgets |
| A16 | Water gate | The client's liquid grid for all three maps, refusing to build unless it equals the committed relief on maps 0 and 1; a reach of 4.2–8.3 yd |
| A17 | Pack | A deterministic uncompressed tar of `NOTICE.md`, `manifest.json` and `t/` per tile set, pinned by SHA-256 and tree hash in `pack.json`, never replaced; the NOTICE as the release text |
| **A18** | **Dist audit** | An `external` prefix per map folder: `pnpm check` passes without the tiles and warns; `pnpm build:deploy` (the Pages workflow) requires them (§24.3) |
| **A19** | **Memory** | Budgets per style in view, with the kept buffer and during the hold (§24.5); the minimap band's `keepBuffer` 1 |
| **A20** | **Record number** | D-049 for Part II (D-047 and D-048 are taken) |
| **A21** | **Recolour gates** | The census gates of §19.5 in the build, both seam measures in the manifest, M11 offline |

No legal conclusion is drawn in this document. D-033's terms apply to the minimap tiles as D-045
states: Blizzard's art under its NOTICE, a non-commercial site, and removal on request.
