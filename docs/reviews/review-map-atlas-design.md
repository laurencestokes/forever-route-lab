# Review: map atlas design

Critique of [docs/research/map-atlas.md](../research/map-atlas.md) (revision 1, 2026-09-27). Findings
carry ids, a severity (blocker, major, minor or nit), evidence and a required change. The design doc
itself is not edited here.

## Critic: adversarial review (2026-09-27)

Scope: the design against the owner's feedback of 2026-09-26 and his two benchmarks; D-017, D-018,
D-022, D-029, D-032, D-033, D-034, D-038, D-041; ARCHITECTURE §7, §14, §16, §17; MAPS §7; the
architecture test; Leaflet 1.9.4 as installed; the synthesis prototype `.cache/map-atlas/synth/`.
Nothing under `src/`, `tests/`, `tools/`, `public/` or the root configs was touched, and no git state
was changed. Scratch work is in `.cache/map-atlas/critic/` (`<cr>` below).

Labels as in the design: **MEASURED** (method named), **OBSERVED** (seen on a live site or a saved
screenshot, read-only), **ESTIMATE**, **UNKNOWN**. Machine and client as in the design's header.

### What was checked, and how

| Check | Method | Result |
|---|---|---|
| Placements from the client | `<cr>/rederive.ts` (own script, `tools/casc` read-only, build 1.60.1.70009), independent of u1's `transforms.json`; output `<cr>/rederive.txt` | **Reproduces.** Rows 46785 (map 1) and 46784 (map 0); K 44.78908; offsets (8724, 14826) and (32739, 9955); map 0 drift 33.3 / 47.7 / 58.2 yd = 1.30 px; seam E 21,531.5; inset (5255.25, 35676.25), 800.9 yd below the 947 image. Every placed painting's bounds equal its own `UiMapAssignment` row, all with UI rectangle (0,0)–(1,1). MEASURED |
| Where 2991 and 2997 sit | Same script | **Confirms UNKNOWN.** MapID 2991 has only rows 69208 (UiMap 2521) and 69852 (2665); 2997 only 69219 (2524). `UiMapLink` (FDID 2030690) header: 0 records, 0 sections. `Map` 2991 and 2997: `ParentMapID` and `CosmeticParentMapID` −1; 2997 `InstanceType` 3. UiMap 2665 has no parent (system 1). CITED |
| Sizes and determinism | Rebuilt the production route myself: `SRC=raw OUT=<cr>/rerun-raw node synth/proto.mjs` | **Reproduces.** 728 tiles, 6,424,888 B gzip-6, `hashes.txt` byte-identical to `synth/out-raw` (tree `c383d772…`), 59.7 s. This is the first double run of the lossless route (the design's two identical runs used the WebP inputs). MEASURED |
| Wheel figures | Rebuilt the app (`pnpm vite build --outDir .cache/map-atlas/perf-dist`), served it on localhost, ran a wheel-only copy of u2's harness (`<cr>/wheel.mjs`, prod 1×, CDP, DPR 1.5) | **Reproduces within noise:** `wheelPxPerZoomLevel` 120: 46 notches / 5.6 s (u2: 43 / 5.2); 60: 22 / 2.7 s (u2: 21 / 2.6); 30: 16 / 2.0 s (u2: 15 / 1.9). MEASURED (`<cr>/wheel-prod-x1.json`) |
| Continuity between levels | `<cr>/levels.mjs`: each stored tile at −1 and 0, reduced 2×2, against what the level below shows there | −1: median 4.7 RGB levels, 25 of 189 tiles with more than 5 % of pixels changing by over 24 levels, the worst Stormwind (−1/62/36, 59 %), Undercity (−1/63/16) and Darnassus (−1/12/9), i.e. the city plans the design already names. 0: median 3.2, none over 5 %. MEASURED |
| Borders and levels, looked at | `<cr>/view.mjs` draws a window as the runtime would (stored tiles; virtual tiles from their nearest stored ancestor, per ancestor tile; fractional zoom resampled); `<cr>/native.mjs` draws one painting as today's layer does | Images in `<cr>/img/`; cited below |
| WoWF-QRP | Own tab in the built-in browser, 2026-09-27, read-only tools (navigate, screenshot, wheel scroll, viewport size); tab closed afterwards. Header "Questie data · v2026.09.27-0030" | Below. The pane was hidden, so about one screenshot in two timed out; no frame timings were taken |
| MapGenie | **Not visited** (owner's instruction). The presentation team's saved screenshots (`.cache/map-presentation/mapgenie/shots/`, 2026-09-26) and the recorded observations only. A tab at mapgenie.io already open in the built-in browser was left untouched | Below |

### Benchmarks at the same places (OBSERVED, zooms are ESTIMATES from on-screen distances)

| Band | WoWF-QRP (live, own tab) | MapGenie (saved shots) | This design's prototype (`<cr>/img`) |
|---|---|---|---|
| World | ≈ −6.3: both continents side by side, sea about 0.5 Kalimdor widths wide, blue textured sea, biome patches with borders, "Kalimdor" and "Eastern Kingdoms" labels. At its minimum both are specks and the two labels collide | z10 (our −5.06), `02`: navy sea, a natural render, sea between the continents about 0.35 Kalimdor widths (measured on the image, ±15 %), Zephras inset just south-west of Kalimdor | Fit of the whole extent in 918×700 (−5.62, `fit-918x700.png`): sea between the continents about 1.1 Kalimdor widths (12,800 yd of sea against 11,840 yd of Kalimdor at the land extremes, `z-5-world.jpg`); land and sea luminance 0.188 against 0.185, **1.01:1**, 85 % of land pixels within 1.5:1 of the sea (MEASURED on the render); a patchwork of zone palettes with rectangular blocks |
| Continent | ≈ −5.0 (Orgrimmar–Thunder Bluff 164 px for 5,204 yd): every zone named with its range; EK labels overlap; "Darkspear Islands \*" east of Durotar; the narrowest sea between the continents ≈ 5,700 yd | z12 (our −3.06), `03`: a render with no names or borders | ≈ 12,800 yd of sea at the same scale; names come only from the presentation layer |
| Zone | ≈ −2.8 over Durotar: tinted hillshade, crisp, continuous across the zone border; town and dungeon labels overlap | z13.5, `04` | −2.8 (`ours-z-2.8-durotar.png`): painted roads, towns and names; Orgrimmar city plan pasted over Durotar's banner; the coastal band ends in a visible edge |
| Close | ≈ −1.9 at Razor Hill: relief still crisp (its tiles are 2.08 yd/px) | z16 (our +0.94) slightly soft, z17 (+1.94) blocky at about 4 px per texel, so **≈ 1.0 yd per texel** (`mg-z16-z17.png`) | −1.9 (`ours-z-1.9-razorhill.png`): legible painted Durotar from 5.28 yd/px art stored at 4 yd/px |

### Findings

**MA-01 (major): nothing draws under a tile that is still loading, except during a zoom-in.**
Evidence: Leaflet 1.9.4 `_pruneTiles` and `_retainParent` (`leaflet-src.js` 11517–11600) keep a parent
only if it is already in the layer's own `_tiles`; `_update` (11747) creates tiles for the view only;
tiles at other levels are marked not current and pruned. So a pan into new ground, a zoom-out (the
newly exposed edge), a jump to a step and a surface preset all show the container background (the
sea colour) until each new tile decodes. §8.3's idle fetch of levels −8 to −5 only fills the HTTP
cache; it draws nothing. During a `SmoothWheel` gesture the pinch path calls `_setView(…, noPrune,
noUpdate)`, so edges are filled at most every `updateInterval` (200 ms). WoWF-QRP draws a crop of its
overview under a loading tile, and MapGenie (MapLibre) draws cached parents; §4.3 trait 1 and §10
"Blank frames: Matches" therefore have no mechanism. Required change: an always-mounted underlay (for
example level −6 or −5 as a second, never-pruned layer, 23–91 kB), or a `createTile` that paints the
nearest decoded ancestor at once from an in-memory cache and swaps in the real tile; state which; add
a pan, zoom-out and jump case with a cold cache at 50 Mbit/s to the §9.2 gate.

**MA-02 (major): lettering fragments, frame slices and duplicated landmarks; §6.7's "no lettering
fragment" is contradicted by the design's own previews.** Evidence: `synth/out-webp/preview/z-2-elwynn-westfall.jpg`:
west of Stormwind (px 340–450 × 60–660) stacked rectangular slices of other paintings, a frame
figure and a label fragment "St… H…" (crop `<cr>/img/elwynn-west-slices.png`); Blackrock Mountain is
drawn and named twice, by Searing Gorge's painting (px 1100, 230) and by Burning Steppes' (px 1050,
310), also in `<cr>/img/cmp-bs-sg-z-1.png`. `z0-ironforge.jpg`: Dun Morogh's "IRONFORGE" banner is
cut to "IRO" by the Ironforge card. Cause: the 10⁻³ fallback lets any painting's frame interior show
where no own polygon reaches, and the paintings draw ground outside their zone as blank parchment
with neighbours' names; landmarks on a border are painted by both sides. Required change: restrict
the fallback to painted ground (not parchment margins, for example by a low-texture, low-saturation
test or the explored-overlay union); a rule for labels and landmarks that straddle a border (keep one
painting's detail over a hand-reviewed box, as done for the continent lettering); cards that cover
a zone banner hide the whole banner; a lettering census in T7; and these places on the contact sheet.

**MA-03 (major): the backdrop is a 9× blur at zone zoom, and it paints unused terrain as land.**
Evidence: the continent paintings are 35–37 yd/px, drawn at 4 yd/px at level −2. North of Stormwind
(`z-2-elwynn-westfall.jpg` px 420–850 × 150–400, X ≈ −7,530, Y ≈ 500) it is a bright, out-of-focus
block with straight frame edges beside the Human start area; southern Silithus and the Gates of
Ahn'Qiraj (100 % backdrop) look the same (`z-3-silithus.jpg`, lower left). A square and an L-shaped
strip of terrain land stand in the sea east of Winterspring (E 15,680, S 8,384; `<cr>/img/odd-z-3.png`,
`odd-z-1.png`); the game's maps show neither. §6.7 describes this only as "smooth continent colour".
Required change: say so in §6.7 and §10; above the continent band fade the backdrop to the §12.4 tint
shaded by the relief (16.7 yd/px is sharper than 35) or widen the frame-edge ramps; draw backdrop only
on land with an `AreaTable` area (or reviewed), and list what is dropped in the census.

**MA-04 (major): 18 of 43 zones and Stormwind are stored coarser than their art; §10 says "native".**
Evidence: `t = min(0, round(−log₂ yd/px))` rounds to the nearest level, so Ashenvale (5.76 yd/px),
Felwood (5.74), Stranglethorn (6.37), Mulgore (6.14), Darkshore, Feralas, Tanaris and Winterspring
are stored at 8 yd/px, and Burning Steppes (2.92), Hillsbrad (3.19), Blasted Lands, Elwynn, Westfall,
Silithus, Mount Hyjal, Arathi, Un'Goro and The Hinterlands at 4 (report `sourceTop`): up to 1.39× in
each direction, about half the texels. Today's layer shows them native; the painted names are
visibly softer (`<cr>/img/cmp-bs-sg-z-1.png`: atlas left, today right). B's round-up (1,058 tiles,
8.31 MB) would break the proposed 8.0 MB cap. Required change: correct §0, §10 and §8.7 item 4;
list the loss per zone; measure an option that rounds up only where the loss exceeds, say, 1.2×, and
give the owner the size against the sharpness.

**MA-05 (major): the world and continent bands are less readable than both benchmarks, and §10's
"beats both" on the picture is not shown there.** Evidence: the table above (sea gap 1.1 against 0.35
and 0.5 Kalimdor widths; land/sea contrast 1.01:1; rectangular palette blocks such as Eastern
Plaguelands, `<cr>/img/w5-ek-north.png`). The 947 layout buys nothing functional while 947 is not
drawn (atlas units never feed a distance, §5.3). Required change: an owner option for a compact
layout (translation only, so D-017 and every zoom constant still hold), with the fit zoom it gains
(ESTIMATE: about +0.35 levels, continents 1.28× larger); a world-band acceptance criterion
(land/sea contrast, for example the D-032 coastline as a stroke or a darker sea beyond the coastal
band); and world and continent views beside both benchmarks, at the same scale, on the contact sheet.

**MA-06 (major): where the runtime gets the inset placement is not specified.** Evidence:
`atlasPlacements(geometry, layout)` takes `tools/maps/inputs/atlas-layout.json` (§5.5, §8.1, ATL.2),
which is not deployed and which `src/` may not import. The "index refused" fallback draws 2521 on the
shelf, the placeholder row claims "placements need only the committed 947 rows" (§8.6), and the
runtime `atlasHash` check needs the layout too. Required change: ship the layout as a committed public
file (placeholder folder or its own) or as a `src/geo` constant pinned by T4, and say which.

**MA-07 (minor): the prototype's level-0 tiles have the sharpness seam the design says is gone.**
Evidence: `proto.mjs` line 447 skips level −1 when choosing a fine tile's ancestor
(`if (a > -2) continue;`), while virtual neighbours use the nearest stored ancestor. 40 of 71 stored
level-0 tiles meet a virtual tile drawn from −1 along 47 edges (MEASURED); `z0-ironforge.jpg`, which
§6.4 cites as the fix, shows the seam at the tile row y 768 (`<cr>/img/if-seam-z0.png`). Required
change: fix the rule as §6.4 specifies, rebuild, and re-state §7's sizes and hashes.

**MA-08 (minor): the inverse is not exact in doubles, so ATL.2 would be red.** Evidence: 23,376 of
60,000 random 0.1-yd round trips through the six offsets were not bit-identical (worst 3.6 × 10⁻¹² yd;
`14826 − (14826 − 0.1)` = 0.1000000000003638). Required change: correct §5.4; test with a tolerance or
integer yards.

**MA-09 (minor): two step-plan gates.** Evidence: R1 wants the laptop trace "before the handler is on
by default", but ATL.9 turns it on and ATL.10 measures afterwards. ATL.0's gate "≤ 21 notches" failed on
today's build in my run (22). Required change: move the laptop trace before ATL.9; give ATL.0 a margin
or a deterministic unit test of the options.

**MA-10 (minor): the index cannot tell sea from virtual.** Evidence: §7.2 stores only stored-key
bitmaps, so `resolveTile` cannot return `sea`; every open-sea tile at fine levels becomes a virtual
tile scaled up to 2⁸ from level −8, against §8.3 and the "≤ 40 tile elements" budget. Required
change: a sea bitmap for levels −8 to −2 (fine levels inherit it), and a test.

**MA-11 (minor): gesture details.** Evidence: `SmoothWheel` sets the centre without `_limitCenter`,
and Leaflet pans back on every `moveend` (`_panInsideMaxBounds`, 3577 and 4386), a visible correction
after gestures near the edge. Trackpad two-finger scrolls are pixel streams at 0.5 level per 100 px
with only `ctrlKey` pinch treated apart; the owner's laptop input is UNKNOWN. With `zoomSnap` 0 every
rest is fractional, where Leaflet tiles can show hairline gaps (sea colour here). Required change:
clamp per frame; calibrate trackpad streams separately in ATL.10; look for tile gaps in ATL.10.

**MA-12 (minor): the default view and Zephras Isle.** Evidence: §9.1's "fit-both view (−5.39)" is
arithmetic over the land span only (`.cache/map-presentation/owner-review/fit.txt`) and does not
contain the shelf (S 30,720–34,428); the whole extent needs about −5.6 to −5.7 in that panel, which
loads level −6, not −5. The pinned dataset has no NPC or object spawns in areas mapped to 2521, so the
card will show only the painting. Required change: the "Azeroth" fit includes the shelf; recompute the
first-view bytes; say in the caption or legend that Zephras Isle has no quest data yet.

**MA-13 (minor): decisions and provenance.** Evidence: D-033 allowlists "the committed art folder and
its manifest and NOTICE only", but the design says "D-033 applies unchanged" and adds no status line
for it. The tiles also alter the artwork (lettering refilled, relief shading multiplied in, masks);
D-041 H covers "composed seamlessly", not removing Blizzard lettering. After ATL.9, T5 checks 55
sources against hashes recorded only in the atlas manifest itself. Required change: a D-033 status
line in D-042; put the alterations to the owner explicitly (no legal conclusion here); record the
pruned sources' raster hashes where `convert.ts --check` can confirm them.

**MA-14 (minor): atlas units outside the funnel.** Evidence: `TileBandDescriptor.bounds` and the index
are in atlas units, against §0 and §8.1 ("atlas coordinates exist only in the adapter's funnel") and
map-presentation P1. The architecture test is per module and lets `engine` import `geo`
(`tests/architecture.test.ts` 80). Required change: name the tile descriptor as the one exception, and
add a file-level rule for `src/geo/atlas.ts` in ATL.2.

**MA-15 (nit):** §2.3 #2's ≈1.0 yd/px for MapGenie rests on INSPECTED facts; the saved `11-close-z17-max.png`
shows about 4-px texel blocks at our +1.94, which gives the same figure from OBSERVED evidence. Cite
that. Also: coarse levels are reduced in gamma space (darkens fine ink); "fits it at −6" is the
snapped value (−5.73 unsnapped); `fadeAnimation` is a map option, not a tile-layer option.

### Verdicts

- **Owner's four points.** Slow: ATL.0 is real (reproduced); the smooth wheel is measured only on a
  standalone page. Flow: the one-raster idea holds between levels (median change 3–5 levels at a
  crossing, except the six cities) but MA-01, MA-02 and MA-03 break it on pans, borders and
  unpainted land. Both continents: yes, small and low in contrast (MA-05). Skyborne: yes, as an
  honest inset, once MA-06 and MA-12 are fixed.
- **Fabrication.** None found: every MEASURED figure sampled (placements, tiles, bytes, hashes,
  census, build time, wheel notches) reproduces. Four claims are contradicted by the evidence:
  "no lettering fragment", "no sharpness seam", "exact in doubles" and "native" resolution.
- **Against the benchmarks.** Matches both on one surface, both continents and an inset, and
  continuity across levels. Beats both on painted content at the zone band (roads, towns, names),
  on client-cited placement and islands, and on reproducibility. Falls short of both on world-band
  compactness and contrast (MA-05), on loading holes (MA-01) until an underlay exists, on seams and
  blur at borders and in unpainted land (MA-02, MA-03), and on close-zoom sharpness (WoWF-QRP's relief
  2.08 yd/px, MapGenie ≈ 1.0, ours 4–8 yd/px in most zones, and coarser than today's layer in 18
  zones, MA-04).
- **Step plan.** Not green as written at ATL.2 (MA-08) and ATL.0 (MA-09); ATL.9 precedes the
  measurement its risk depends on.

## Resolution (design revision 2, 2026-09-27)

The design is now [map-atlas.md revision 2](../research/map-atlas.md); its §0.1 maps each finding to
the sections that changed. Scratch work and evidence are in `.cache/map-atlas/revise/` (`<rv>` below):
the prototype `proto2.mjs` (every change behind a switch, so revision 1's behaviour can be rebuilt),
its runs, the censuses and the contact sheets. Nothing under `src/`, `tests/`, `tools/`, `public/` or
the root configs was touched, no git state was changed, and no third-party site was visited (the
benchmark figures below are measured on the presentation team's saved screenshots).

Status: **Resolved** (the required change made), **Resolved differently** (the defect removed by
another means, with the reason), **Rejected** (not changed, with the reason).

| Finding | Status | Resolution | Evidence (MEASURED unless marked) |
|---|---|---|---|
| MA-01 loading holes | Resolved | Both mechanisms: a never-pruned `AtlasUnderlay` holding every stored level −5 tile (13 tiles, 91,588 B, the same files as the first view), scaled by one transform per zoom event, under `AtlasTileLayer`, whose tiles start as the crop of their nearest decoded ancestor; sea keys create no element (`_isValidTile`); `updateInterval` 100. §9.2 gains a cold-cache (50 Mbit/s) pan, zoom-out, jump and preset case: 0 frames with bare container colour over kept land once the underlay has loaded. A target until ATL.9 | design §8.3, §9.2; `<rv>/out-ru12/report.json` (`underlay`) |
| MA-02 lettering fragments, slices, duplicates | Resolved | Outside its own polygon a painting now covers and contributes detail only on its **painted ground** (the explored-overlay union's alpha), never its parchment margins; the city filler draws on land only (the "St… H…" slices were Stormwind City's harbour label and shield); a reviewed label list: 18 straddling labels drawn whole, 9 hidden by a mirror fill from the same painting (the six capital banners at −1 and 0 only, and the second Blackrock Mountain, Razorfen Downs and Darkwhisper Gorge names); a lettering census in T7 (no cut label allowed); the named places on the contact sheet | Census: 208 candidates in 43 paintings, 182 whole, 18 whole by rule, 8 reviewed, **0 cut** (20 cut before the list); detector recall 17 of 22 on a hand-checked sample, 2 false positives (`<rv>/letters-census.json`, `img/cut-labels-sheet.jpg`, `img/letters-sheet.jpg`); before and after: `<rv>/img/places-sheet.jpg` |
| MA-03 blurred, unused backdrop | Resolved differently, in part | The backdrop is the presentation's area tint shaded by the relief **at every level**; the continent painting is not drawn at all. The level-dependent fade was built and measured: at the world band it shows saturated yellow and orange blocks at the continents' edges and costs 233 kB (`<rv>/img/cmp-tint-fade-*.jpg`), so it is an owner alternative (O6), not the default. Terrain the game's maps do not show is dropped by a **land test** (terrain land that the continent painting colours as land, dilated 145 yd, or that lies inside its own zone painting's frame). **Not adopted:** "only land with an `AreaTable` area": the square east of Winterspring lies in area 16 (Azshara), so that rule keeps it, and it would drop 42,640 lattice points of land outside every polygon that the continent paintings show as land. Widening the frame ramps was not adopted either: it would shrink painted coverage without removing the straight edges. §6.7 now says plainly what the tint looks like and that straight frame edges remain | Tint 13.19 % / 12.25 % of land, dropped 0.67 % / 0.18 %, the dropped areas listed (design §6.6; `<rv>/img/dropped-{0,1}.png`); continent-painting colour separation `<rv>/contland.mjs` |
| MA-04 coarser than the art | Resolved | §0, §7.1 and §10 corrected; the loss listed for all 21 sources (18 zones and 3 city maps, 1.04–1.39×); owner option O10, recommended: round up where the loss exceeds 1.2× (7 zones native; worst remaining 1.20×) | 791 tiles, 6,882,978 B against 725, 6,346,342 B at the nearest level (+536,636 B, +8.5 %); full round-up 1,032 tiles, 8,499,419 B, over the cap (`<rv>/out-ru12`, `out-compact`, `out-ru10`) |
| MA-05 world band readability | Resolved | The compact layout (translation only, in whole 1,024-yd tiles) is the **recommended default** (O9), not only an option; the 947 layout stays the alternative. Deep open sea beyond a painted-water coastal band; a world-band criterion (contrast ≥ 2.5:1); world and continent views beside both benchmarks at equal scale | Fit 918×700: −5.22 against −5.62 (1.32× larger); gap 0.39 Kalimdor widths (947 layout 0.97, land extremes); contrast 2.65:1 (was 1.01:1); MapGenie 2.6:1 and WoWF-QRP 2.38:1 on the saved shots (`<rv>/bench-contrast.mjs`); WoWF-QRP's gap 0.32 on its saved "All" shot (`bench-gap.mjs`; the review's live estimate was about 0.5); `<rv>/img/bench-sheet.jpg` |
| MA-06 inset placement at run time | Resolved | `src/geo/atlas-layout.ts`, a committed constant (layout, shifts, the inset's row and corner, `seamE`, extent), used by the runtime, placeholder mode and the refused-index fallback, and imported by the tool; T4 pins `atlasHash` over it and the 947 rows; no JSON layout input | design §5.5, §8.1 |
| MA-07 level-0 seam | Resolved | The fine-level ancestor rule includes level −1; `up` is clamped at the ancestor tile's edges as the runtime draws; sizes and hashes restated | Seam edges (8-px detail-energy bands across stored/virtual edges, `<rv>/seams.mjs`): level 0 **13 → 4**, the rest at a city plan's or a fine zone's edge; 84 level-0 tiles now blend against −1; the review's `levels.mjs` on the new build: −1 median 4.54, 0 median 3.83, no level-0 tile over 5 % |
| MA-08 inverse not exact | Resolved | §5.4 corrected; ATL.2 tests within 10⁻⁹ yd and exactly after 0.1-yd rounding; whole yards exact | 54–81 % of 0.1-yd round trips not bit-identical, worst 3.6 × 10⁻¹² yd; whole yards 0 of 10,000 per placement; 0.1-yd rounding restores all 60,000 (`<rv>/inverse.mjs`) |
| MA-09 step-plan gates | Resolved | Measurement with the laptop trace is ATL.9, before ATL.10 switches anything on; ATL.0 is gated by a deterministic adapter-options test, the harness figure recorded with an alarm at 25 notches | design §11 |
| MA-10 sea versus virtual | Resolved | The index carries stored and sea bitmaps for −8 to −2 (fine levels inherit sea from −2); `resolveTile` returns `sea`; ATL.7 tests it | Index 3,906 B, 845 B gzip (was 805 B) |
| MA-11 gesture details | Resolved | Centre clamped by `_limitCenter` every frame (no pan-back); notch and stream rates calibrated apart; a hairline-gap check at 20 fractional zooms, with the underlay beneath the tiles as the first mitigation and a 0.5 px overlap as the second | design §8.4, §9.2 |
| MA-12 default view and Zephras Isle | Resolved | The card now lies inside the extent, so the fit includes it; first-view bytes recomputed; caption, legend and status say there is no quest data yet | Fit −5.22 in 918×700, level −5, 13 tiles, 91,588 B + 845 B index; no spawn in area 16593 in `public/data/spawns.json` |
| MA-13 decisions, provenance | Resolved | D-033 status line in D-042's edits (§13); every alteration listed for the owner as O11 (masks and colour cross-fade, mirror fills, our tint, our sea, re-encoding); T5 compares with the art manifest's `sources` records, which `convert.ts --check` recomputes from the client for every UiMap, deployed or not | design §7.4, §7.5, §13, §14 |
| MA-14 atlas units outside the funnel | Resolved | `TileBandDescriptor` named as the one descriptor in atlas units; a file-level rule for `src/geo/atlas.ts` and `atlas-layout.ts` (values only for `map/adapter`, `map/layers`, `infra`, `app`, tests and tools) | design §8.1 |
| MA-15 nits | Resolved, one part rejected | MapGenie ≈ 1.0 yd per texel now rests on the saved z17 screenshot (OBSERVED); fit values given unsnapped; `fadeAnimation` treated as a map option (set false; the layer fades its own images). **Rejected: reducing coarse levels in linear light.** Between two levels the browser shows the finer level scaled down, and Chromium scales on encoded values (ASSUMPTION, checked in ATL.9 by comparing mean luminance either side of a crossing), so linear-light reductions would add a brightness step at every crossing | design §2.3, §5.6, §6.3, §8.3 |

**Re-measured numbers** (all `<rv>`, lossless client rasters, the recommended build unless stated):
791 tiles, 6,882,978 B, byte-identical over two runs (tree `d4ba4122…`; the nearest-level build, 725
tiles and 6,346,342 B, also identical over two runs, tree `1bf0387c…`); tile median 8.4 kB, largest
20.5 kB; build 112–114 s; coverage own 85.49 % / 85.61 %, painted fallback 0.65 % / 1.96 %, tint
13.19 % / 12.25 %, dropped 0.67 % / 0.18 % (Eastern Kingdoms / Kalimdor).

**Still open after revision 2** (the design says so): straight frame edges where a painting ends and
the tint begins; palette and brushwork changes at borders; close-zoom resolution below both
benchmarks; the detector's recall (77 % on a sample) until ATL.6 raises it; every runtime figure
(holes, frames, notches, laptop GPU) until ATL.9.
