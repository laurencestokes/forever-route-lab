# Review: minimap addendum (map atlas revision 3, Part II)

Adversarial critique of [docs/research/map-atlas.md](../research/map-atlas.md) Part II (§16–§28, the
minimap style), 2026-09-27, against D-033, D-042, D-045 and its addendum. Findings carry an id, a
severity (blocker, major, minor, nit), evidence and a required change. The design doc is not edited
here. Nothing under `src/`, `tests/`, `tools/` or `public/` was touched and no git state was changed.
The client was not opened: every run below reads the addendum's decoded cache (`<mm>/raw/`) and its
`b4` build. Scratch: `.cache/minimap-addendum/review-mm/` (`<rr>`); `<mm>` is `.cache/minimap-addendum`.
Labels: **MEASURED** (script named), **OBSERVED** (looked at, file named), **ESTIMATE**, **UNKNOWN**.

## What was checked

| Check | Method | Result |
|---|---|---|
| A/B re-run | `<rr>/rr-ab.ts` (a copy of `p8-ab.ts` writing to `<rr>`) on `b1` and `b4` | `b1`: all 55 cells byte- and metric-identical to `<mm>/out/p8-ab.json`. MEASURED |
| Sizes | `<rr>/sizes.mjs`: gzip-6 of every file on disk | WebP q80 6,655 files, 52,343,652 B, largest 23,892, per-level figures equal §24.1; AVIF q60 4:2:0 41,834,954 B; tar 57,456,640 B; `b4`/`b4b` `index.json` identical. MEASURED |
| Index parse | re-ran `<mm>/p16-parse.ts` | accepted; every key stored or sea; 13 underlay keys. MEASURED |
| Sea recolour at native scale | `<rr>/crops.ts`: `b4` level 0 (1 yd/px) beside the source texels, 1× to 2× | see MM-01, MM-02. OBSERVED |
| Texture added to water | `<rr>/amplify.ts`, `<rr>/family-exp.ts` | MM-01. MEASURED |
| Recolour on land | `<rr>/dry.ts`, `<rr>/halo.ts`, `<rr>/wetmask.ts` | MM-02. MEASURED |
| Decoded open sea against the container colour | `<rr>/navy-decode.ts` (sharp decode of `b4` tiles) | WebP gives rgb(13, 28, 48) on 82–95 % (by level), AVIF rgb(12, 27, 48) on 88–96 %; one level from #0d1b30, not visible. **No finding.** MEASURED |
| Slime, crystals | `<rr>/find-ponds.ts`, crops `pond-*.png` | Hyjal slime and Un'Goro crystals kept. **No finding.** OBSERVED |

## Findings

**MM-01 (blocker) — The per-texel family switch posterises shallows and lakes.**
Evidence: §19.2 step 2 picks the open-sea reference per texel (`b − g ≥ 10` → luma 67.3, else 20.4),
so two texels of nearly equal colour on either side of the split map to t ≈ 0 and t ≈ 0.5.
Native crops show hard-edged black-navy blotches and contour bands where the source is smooth:
`<rr>/tir-speckle.png`, `tir-streak.png`, `lochmodan-worst.png`, `kal-worst.png` (a smooth teal
lake becomes a two-tone lake with a blocky core). MEASURED: 8,554 of 95,944 fully wet 16-px blocks
(8.9 %, Eastern Kingdoms) and 7,500 of 119,578 (6.3 %, Kalimdor) have their luma standard deviation
more than doubled (worst 1.0 → 24.6), and 91 % and 90 % of those contain both families
(`amplify-b4.json`). 288,532 and 248,223 wet neighbour pairs of near-equal luma (≤ 6) cross the split;
96 % and 99 % of them become jumps of 12+ luma (`family-census.json`). Blending the two references by
smoothstep(2, 18, b − g) removes the blotches (`fam-kal-lake.png`, `fam-lochmodan.png`). The design's
sheets hid this: `p3c-final.ts` averages 2 × 2 texels (4 × 4 for Zephras Isle), and §19.6 calls it "small
specks".
Required: a continuous family weight (or one reference per neighbourhood), a texture gate (share of wet
blocks whose luma deviation doubles, recorded in the census and checked), contact sheets at 1:1 and 2:1
of native pixels, a new build, and every §19.5 figure restated.

**MM-02 (major) — The gate recolours bank land and darkens bright rivers.**
Evidence: the gate reaches 25 yd, and blue-grey canopy or rock inside it takes the ramp's bright end.
The Duskwood river is 10–15 yd wide in the liquid grid (`<rr>/wet-duskwood.png`) but becomes a blue
smear about three times as wide (`halo-ek-24515.png`). Stranglethorn shore rocks get blue patches
(`halo-ek-20282.png`), and Zephras Isle's beaches turn pale blue (`zeph-lake.png`). Dalaran's bright
violet river inverts (`pond-cyan-ek.png`; `<rr>/rivercheck.ts`, E 22,045). Source rgb(41, 60, 121) at
luma 60 becomes exactly the navy at luma 26, while the teal water beside it goes from luma 33 to 32.
The river was the brightest line and is now the darkest. The cause is the navy family's 20-luma dead
zone. One texel ends at rgb(7, 19, 38), darker than the navy.
MEASURED (`dry.json`): texels over dry quads recoloured at w ≥ 0.5: 89,841, 57,502 and 38,886 (1.5 %,
0.9 % and 12.6 % of the dry texels within the gate's reach). By `halo.json`, 4.8 % and 4.4 % of shore
land cells shift 8+ levels bluer, against 0.03 % and 0.01 % inland. Both are upper bounds, because
they include water shallower than 0.3 yd and mixed cells. §19.5's "0.02–0.05 % of land cells" divides
by all land, which the gate cannot reach.
Required: a tighter reach, plus a rule that dry texels may never brighten towards the shallow end.
Report rates over shore land. Put Duskwood, Stranglethorn, Dalaran and Zephras banks on the sheet.
Run M8 over shore cells.

**MM-03 (major) — The seam figures measure what the edge feather is built to cancel, and one run is misattributed.**
Evidence: the step metric is the mean difference over 4-texel bands across an edge. Step 5 (§19.2)
cancels exactly that difference, so "122 → 4" is partly true by construction. Edges with less than
64 texels of water on both sides (rivers, small lakes) are not counted at all. Visible lines remain:
the Tirisfal dark/navy tile edge and vertical streaks (`tir-streak.png`), and Loch Modan's tile line
(`lochmodan-worst.png`). §19.5 and O15 give `b3` as "9 and 6, largest 39.1". `<mm>/out/b3/report.json`
says 12 and 11, largest 45.2; 9, 6 and 39.1 are `b2`'s (navy rgb(8, 32, 48)) and `p17`'s.
Required: an independent seam measure (wide bands at levels −1 to −3, every edge with water). Correct
the `b3` figures.

**MM-04 (major) — MM.6 makes `pnpm check` depend on 52 MB of untracked tiles.**
Evidence: `tools/build/lib/audit.ts` (the map-folder rule) requires `dist/maps/minimap/` and every file
in its manifest once `public/maps/minimap/manifest.json` exists. `pnpm check` runs `pnpm build`, which
runs the audit. After a fresh clone or `git clean`, the check fails until someone runs a 3.5-min
client build or downloads a 57 MB pack. That pack cannot exist while OD-13 is open. So "every step
ends green" holds only on the owner's machine.
Required: the audit demands the tiles only in a deploy mode, set by the Pages workflow. `pnpm check`
verifies the index, manifest and pointer, and reports loudly that the tiles are absent. State this in
MM.6 and STATUS.

**MM-05 (major) — MM.9 can make the minimap the default before any names exist.**
Evidence: MR11 says the default waits for MP.7, but MM.9's "depends on" column lists only MM.8. STATUS
orders ATL.0–ATL.11 before MP.*. The minimap has no names and `BaseMapLabels` is empty, so the default
map would lose every zone and city name.
Required: make MM.9 depend on MP.1 (the labels canvas) and MP.7, and update the order in STATUS.

**MM-06 (major) — D-033 rules 2 and 3 for the release pack.**
Evidence: the pack is a tar of `t/` only (§23.3). A copy downloaded from the release carries no notice.
The removal steps (§23.3, MR2) delete the asset and the pointer but never redeploy Pages, which keeps
serving the last artifact.
Required: put `NOTICE.md` and `manifest.json` inside the pack and the notice in the release text. Add
"redeploy and confirm that `maps/minimap/t/` is gone" to the removal steps.

**MM-07 (minor) — The A/B supports WebP q80, but not "AVIF q60 is as good by eye".**
Evidence: on `b4`, AVIF q60 4:2:0 has a lower PSNR-Y than WebP q80 on 9 of 11 A/B tiles. The gap is
−2.5 to −2.7 dB on Stormwind, Winterspring and the level −4 tile, where SSIM is 0.928 against 0.961
(`<rr>/p8-ab-b4.json`). It is visibly softer at 3× (`abz-continent-4.png`, `abz-stormwind.png`). The
sweep's median parity comes from level 0, which is 320 of its 463 tiles. At levels −2 and −3 the
median gap is −0.65 and −1.98 dB, and 12 of 26 and 6 of 8 tiles are more than 1 dB worse (MEASURED
from `p5-sweep-b1.json`). The A/B and sweep used `b1`, and the sheet captions are cut off.
Required: restate O13 ("softer at the zone and region bands"), with a per-level table and an A/B on
the recommended build, magnified bilinearly.

**MM-08 (minor) — Swamp water stays brown without an owner question.**
Evidence: the lakes of Dustwallow Marsh (Kalimdor 36–40 × 38–40, about rgb(46, 55, 30)) and the Swamp
of Sorrows (Eastern Kingdoms 50–52 × 38–40, about rgb(79, 74, 20)) keep their colour, up to 80,537 wet
texels per ADT (`<rr>/untouched.ts`). The D-045 addendum exempts only lava and slime, and §19.1 names
only ponds.
Required: add this to O12/O15 with a sheet, or recolour them.

**MM-09 (minor) — Decoded-tile memory in the minimap style is not budgeted.**
Evidence: every land key is stored, so there is no ancestor reuse. At a half-level zoom a 918 × 700
view holds up to about 35 decoded tiles (9.2 MB) plus the 13-tile underlay (3.4 MB), which is over
§9.2's 12 MB (ESTIMATE). The 2 s hold during a style switch keeps both bands.
Required: set a per-style budget that includes the hold, and measure it in MM.8.

**MM-10 (minor) — The void fringe leaves a dark smudge on Zephras Isle.**
Evidence: haze wider than the 64-texel fringe stays near black on the navy (`<rr>/zeph-dock.png`, the
south-east dock). M8 cannot check the island.
Required: composite by coverage rather than by distance, and put the dock on the sheet.

**MM-11 (minor) — Labels and method changes.**
Evidence:
- The sizes are real, but the manifest's "MEASURED 1,065,545 / 335,892 B" comes from a prototype
  that lacks §18.8's WDT, root ADT, LiquidType and pack records, the black-texel list and the
  alterations. It is a lower-bound ESTIMATE.
- The prototype index has `seaColour` [8, 32, 48], not #0d1b30.
- O17 changes both the contrast method and the threshold. By Part I's method (48 levels) we measure
  2.09 against MapGenie's 2.60. The claim that "2.60 counts its pins" was not measured, and §27's
  "Matches" depends on the method.
- Lanczos-3 was chosen on SSIM, although bilinear and Catmull-Rom have a higher PSNR-Y (`p13`).
Required: fix the labels, give both contrast methods in §24.1 and §27, and state the trade-off in
§18.3.

## Verdict

Hosting (a release pack pinned by SHA-256) is workable for GitHub Pages and reproducible once MM-04
and MM-06 are fixed. The sizes are real. No figure was fabricated: one was misattributed (MM-03). The
recommended format stands. The recolour, the default step and bank handling need another revision:
MM-01 blocks the owner's sign-off, because the current sheets do not show the artefact.

## Resolutions (design revision 3.1, 2026-09-27)

Recorded by the design team after revising [docs/research/map-atlas.md](../research/map-atlas.md) to
revision 3.1 (§0.3 there maps each finding to its sections). Every finding is accepted: the blocker and
the five majors are resolved, and all five minors are agreed and resolved. The recolour was redesigned
and rebuilt as `b5`; revision 3's `b4` was rebuilt by the same code as `b4r`, identical to `b4` on all
6,655 tiles and every sea key, so each figure below compares like with like. The client was not opened.
Scratch: `.cache/minimap-addendum/r31/` (`<r31>`). Labels as above.

| Finding | Severity | Accepted | Resolution | Evidence |
|---|---|---|---|---|
| MM-01 | blocker | Yes | The per-texel split is replaced by **one reference per neighbourhood**: a family field per ADT tile (b − g of the tile's own wet, water-coloured texels, weighted, box-blurred twice with radius 12, then smoothstep(2, 18)). The review's per-texel smoothstep blend was tried first; it removes the contours but keeps DXT1-block patches, so the field was chosen. A texture census with a gate is in the build and the manifest. Contact sheets are at native pixels (1:1, 2:1, and 3:1 where a residue is faint), with no averaging. Every §19.5 figure is restated from `b5`. By the review's own measure (`amplify.ts` on level 0), amplified wet blocks fall from 8,554 of 95,944 (8.9 %) to 271 of 93,834 (0.29 %) in the Eastern Kingdoms, and from 7,500 of 119,578 (6.3 %) to 301 of 118,245 (0.25 %) in Kalimdor. Water-to-water luma inversions fall from 6.4 % to 0.025 % and from 7.1 % to 0.002 % of pairs. MEASURED | design §19.2 steps 1–5, §19.5, §18.10; `<r31>/rule3.ts`, `build3.ts`, `amplify5.ts`; `<r31>/img/mm31-{1,2}to1-A.png` |
| MM-02 | major | Yes | Gate reach 25 yd → 8.3 yd (1 quad full, 0 at 2 quads). **Dry texels never brighten**: a cap on the ramp, and a clamp after the feathers. Coloured water outside both families is kept (a hue window of 36–44 on b − g), so the violet river by Dalaran stays rgb(41, 60, 121) at luma 60 beside teal water at 32. Rates are now over shore land. Dry texels brightened by more than 1.5 luma: 57,556 and 35,117 → 0. By the review's measure (`halo.ts`), shore cells 8+ levels bluer: 4.8 % → 3.7 % and 4.4 % → 3.6 %; most of these cells hold water that is rightly recoloured. **Fully dry** shore cells: 0.63 % → 0.03 % and 0.45 % → 0.007 %. Duskwood, Stranglethorn, Dalaran and Zephras banks are on the sheet. M8 covers shore cells. MEASURED | §19.1, §19.2 steps 1, 2, 4, 9, §19.5, §24.4 M8; `halo5.ts`, `rivercheck5.ts`; `mm31-1to1-B.png`, `-C.png` |
| MM-03 | major | Yes | **An independent seam measure** on the built pyramid at levels −1 to −3 (`seams-levels.ts`): 8-px bands, the step less the local gradient, the median over wet rows, every ADT edge with 3+ wet rows counted, and control lines through tile middles for the false-positive rate. Long edges over 4 levels at level −2: source 104 of 726 (EK) and 45 of 883 (Kalimdor) → `b4` 19 and 10 → `b5` 13 and 9, against about 1 % of control lines. The feather is revised: a Gaussian along the edge with a taper, a corner term and a navy floor. The `b3` figures are corrected to 12 and 11 over 10 levels, largest 45.2; "9 and 6, largest 39.1" were `b2`'s. Offline check M11 re-derives the measure. MEASURED | §19.2 steps 7–9, §19.5, §24.4 M11, §28 O15; `<r31>/out/seams-{b0,b4,b5}.json`, `mm31-worst-seams.png` |
| MM-04 | major | Yes | The dist audit gains an `external` prefix for `maps/minimap/t/`. In plain mode (`pnpm build`, so `pnpm check`), no tiles gives one loud warning and a pass, a full set is checked, and a partial set fails. In deploy mode (`pnpm build:deploy`, run by the Pages workflow), every tile is required. MM.6's tests cover a clone without the tiles. The STATUS edit is listed in design §13, because this task may not edit STATUS | §23.4, §24.3, §25 MM.6, §13 |
| MM-05 | major | Yes | MM.9 now depends on MM.8, **MP.1 and MP.7**, and MM.7 on MP.4b (the drawer that holds the switch). MM.9's gate runs MP.7's test (every levelling zone named at the fit-both view) in the minimap style. Until then ATL.10 may switch the atlas on with the painted style as the default. The corrected STATUS order is listed in design §13 for the architect | §11, §22, §25, §26 MR11, §13 |
| MM-06 | major | Yes | The pack is a tar of `NOTICE.md`, `manifest.json` and `t/`, in that order. Its release text is the NOTICE, and the fetch refuses a pack whose NOTICE or manifest differs from the committed ones. Removal now runs: delete the asset; commit the pointer's removal; **redeploy Pages**; confirm 404s for the index and one tile per level, recorded in STATUS; delete retained Pages artifacts. A measured tar of `b5` with both files is 58,183,680 B | §18.2 step 10, §23.3, §24.4 M1 and M7, §26 MR2; `<r31>/index5.ts` |
| MM-07 | minor | Yes | The A/B and a per-level sweep were redone on `b5`, magnified bilinearly at 2:1 and 3:1, with two-line captions. AVIF q60 4:2:0 is 0.80× the bytes, as good at level 0 (median +0.25 dB), and softer from level −2 down (−0.56 dB at −2, −2.45 dB at −3; 71 of 464 tiles more than 1 dB worse). On the 14 A/B tiles, 10 are more than 0.5 dB worse, down to −2.8 dB. AVIF q70 4:2:0 is as good everywhere but 1.02–1.13× the bytes. O13 is restated: WebP q80 stands, and "as good by eye" is withdrawn. MEASURED | §20.1–§20.4, §20.7, §28 O13; `<r31>/sweep5.ts`, `ab5.ts`, `<r31>/img/ab5-*.png` |
| MM-08 | minor | Yes | Stated and measured. Swamp water is kept. One lake (Kalimdor 29_31–29_32) is drawn brown in one tile and teal in the next, and 11 and 14 ADT edges carry such two-style water. A colour-based trial fixed that lake but made tile-shaped patches in the swamps, so it is rejected. New owner question **O20**: keep as drawn (the default), or recolour swamp water by the liquid grid alone after its own prototype. Both are on a sheet | §19.8, §28 O20; `<r31>/split-census.ts`, `mm31-1to1-D.png`, `brown.png` |
| MM-09 | minor | Yes | The review's arithmetic is confirmed: 35 tiles plus the level −5 underlay is 12.6 MB (ESTIMATE). Budgets are now per style, counted as live tile images × 262,144 B: ≤ 12 MB in view, ≤ 20 MB with the kept buffer, and ≤ 26 MB for at most 2 s during a switch. To meet them, the minimap underlay moves to level −6 (4 tiles), the minimap band's `keepBuffer` is 1, and the old band's off-view tiles are pruned when a switch starts. Worst cases (ESTIMATE): 10.2, 17.6 and 22.9 MB. MM.8 measures them | §21.2, §24.5, §9.2, §26 MR15 |
| MM-10 | minor | Yes | The haze is now found by a flood from the void through texels darker than luma 64 (up to 192 texels) and composited by coverage, not by distance: 743,859 haze texels on Zephras Isle. The south-east dock's smudge is gone, and the dock is on the sheet. OBSERVED and MEASURED | §19.2 step 6, §19.4; `mm31-1to1-C.png` |
| MM-11 | minor | Yes | The manifest is now an ESTIMATE of about 385 kB gzip, written with every §18.8 record (root-ADT and `LiquidType` CKeys as placeholders of the right length). The prototype index writes #0d1b30 and `underlayLevel` −6: 2,272 B gzip, and the runtime parser accepts it. Contrast is given by both methods (Part I's: ours 2.09 against MapGenie's 2.60; revision 3's: 1.96 against 1.95). The gate keeps Part I's method with a threshold of 2.0 (O17). Whether MapGenie's 2.60 comes from its pins is UNKNOWN. Lanczos-3's trade-off is stated: higher SSIM-Y, lower PSNR-Y than bilinear and Catmull-Rom, and faint ringing | §18.3, §18.4, §18.8, §19.3, §24.1, §27, §28 O17; `contrast5.ts`, `parse5.ts` |

**What remains open.** All of these are on the sheets and in design §19.6:
- lakes and swamp coasts where kept swamp water meets recoloured water (O20);
- faint patches of a few levels at some ADT corners by rocky shallows, visible on flat navy at 3:1;
- soft bands where a lake's two tile styles are matched.

By the independent measure, the rate of seams at ADT edges after the recolour is close to the rate on
lines that are not ADT edges. It is not zero, and it is above them for Kalimdor at level −1 and the
Eastern Kingdoms at level −2. The owner's sign-off (O18) now uses sheets that show native pixels.
