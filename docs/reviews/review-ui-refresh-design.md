# Review: UI refresh design, and the map presentation revision 3, from the owner's point of view

Critique of [docs/research/ui-refresh.md](../research/ui-refresh.md) (revision 1, 2026-09-27) and
[docs/research/map-presentation.md](../research/map-presentation.md) revision 3 (§25, the D-045
addendum). Findings carry ids, a severity (blocker, major, minor or nit), evidence and a required
change. Neither design doc is edited here.

## Critic: the owner's point of view (2026-09-27)

**The question.** The owner asked, verbatim: "Let's also make our general UI more like:
https://tyba-dev.github.io/WoWF-QRP/ - e.g. how we present the quests on the left with the
exclamation mark, and the buttons", and, the same day, for "a mapgenie.io style overall (which I
think would be better)" (D-045, D-046). Will the left panel, the "!" marks and the buttons feel like
WoWF-QRP, and the map like MapGenie, when he opens the mocks? Where do our rules make the result
worse without a good reason?

**Scope and method.**
- Read: STATUS, UI.md (§1, §6, §8, §9), DECISIONS D-029, D-039, D-041, D-042, D-045 and D-046, both
  designs in full where they touch the UI, `.cache/ui-refresh/ours.md` and the token values in
  `src/ui/styles/tokens.css` (read only).
- Compared side by side: the UI refresh mock (`.cache/ui-refresh/mock/shots/`), the pins mock
  (`.cache/ui-refresh/pins-mock/shots/`), WoWF-QRP's saved shots and local stylesheet renders
  (`.cache/ui-refresh/friend/`, `.cache/map-presentation/friend/shots/`) and MapGenie's saved
  screenshots (`.cache/map-presentation/mapgenie/shots/`).
- Not visited: tyba-dev.github.io and mapgenie.io. The saved material answered every question. No
  WoWF-QRP source was fetched and nothing was ported.
- Nothing under `src/`, `tests/`, `tools/` or `public/` was touched, and no git state was changed.

**Evidence written for this review** (gitignored, `.cache/ui-refresh/critic/`, local evidence for
the owner's review only, not for publication):

| File | What |
|---|---|
| `sheet-1-left-panel.png` | WoWF-QRP's left panel (live `378bed9e`, light; HEAD `96f602b`, dark) beside our mock in both themes |
| `sheet-2-buttons-available.png` | WoWF-QRP's buttons and Available list beside our specimen and Available mock |
| `sheet-3-map.png` | MapGenie (world with panels collapsed; Durotar at z13.5) beside the pins mock (world, zone, close) and the UI refresh shell at 1366×768 |
| `sketch-disc-inverted.png` | Our own sketch for UO-01: the design's disc and an inverted disc, both themes |
| `compare.py` | Builds all four (`python .cache/ui-refresh/critic/compare.py` from the repository root) |

Labels: **OBSERVED** (seen in a saved screenshot or mock shot), **MEASURED** (computed here, method
named), **ESTIMATE**.

### What the owner will recognise

Most of the ask lands. The Available tab's zone groups, "Unlocks soon" and "Low level", one Accept
per row and the prerequisite link read like WoWF-QRP's (sheet 2). So do the character button
("Orc Warrior · Horde"), "Lv 4 after step 12" with a ticked XP bar, the Quest log tab, the dashed
insertion line and the Grind, Travel, Hearth and Note footer. On the map, the drawer's rows (pin
icon, name, count, tick and strike-through, Show all, Hide all, search that filters the map) are
recognisably MapGenie's panel (`pins-mock/shots/07`), and the keyline teardrop is a fair MapGenie
pin. The findings below are where he would still say "that isn't what I meant".

### Findings

**UO-01 (major): the "!" disc is the inverse of the one the owner pointed at.** Evidence (sheet 1,
`sketch-disc-inverted.png`, OBSERVED): WoWF-QRP's accept and turn-in marks are gold filled discs with
a dark "!" or "?" (`friend/b-left-panel.png`, callout 5). Ours are black discs with a coloured glyph.
In the light theme that is a column of black blobs next to black pip chips. In the dark theme the
filled disc is 1.06 to 1.35:1 against the row (the design's own figure, R5), so a filled mark and a
hollow "not yet" mark look alike. Inverting the disc keeps every reserved pair: the well-coloured
glyph on the difficulty-coloured disc is the same 4.75 to 17.46:1 as today's chip. In the dark theme
the disc is then 4.14:1 or more against `--frl-surface` and `--frl-surface-raised`, and in the light theme a 1.5 px well keyline gives
18.75:1 (MEASURED here with the WCAG formula on the token values). A yellow "!" disc for a
difficult quest is what WoWF-QRP and the game both look like, and it is still a difficulty use
(D-041 G). **Required change:** make the filled `QuestMark` a difficulty-coloured disc with a
`--frl-difficulty-well` glyph and keyline. Keep the pips beside it, keep the hollow states in ink,
and add the new pairs to §9.5 and `ui-tokens.test`. Amend UI.md §3.2's "drawn on the well" to "on or
under the well". The map pins may keep MapGenie's dark body: say in both docs that the glyph paths
and state cues are shared, and the fill follows its surface.

**UO-02 (major): the map is never MapGenie-sized.** Evidence (sheet 3, OBSERVED): MapGenie's map
fills the window. Both its panels collapse from edge handles, and its controls float on the map
(zoom at the bottom right, full screen at the top right; `02-world-z10-panels-closed.png`). Ours
keeps both side panels, a 32 px map toolbar and a 24 px map status line. At 1366×768 the stage is
684 px, or 448 px with the drawer docked (ui-refresh §11). The refresh also widens both panels to
300-460 px (§4.1, §4.2), which leaves about 446 px of map at their widest. Neither design lets the
map take the window. **Required change:** make both side panels collapsible, each with an edge
handle and a key, the state kept per browser. Add a "map focus" shortcut that collapses both
panels. The collapsed route panel stays reachable by the handle, and focus returns to it. Put the
map's controls over the stage (Map layers at the top left, zoom at the bottom right) instead of in a
toolbar row. Re-shoot the shell at 1366×768 with the panels collapsed.

**UO-03 (major): the two designs specify different drawers.** Evidence:
- ui-refresh §7.2 and §11, and its shell mock: a "Categories" button in a map toolbar; a 236 px
  drawer, open by default from a 1,600 px window; "Style: Minimap" as a select in the toolbar; a
  "Filter the map" field; pins that share `QuestMark`'s cues (an arc for progress, colour from
  11 px); the path module re-exported through `src/app`.
- map-presentation §25.3: a "Map layers" toggle at the map's top left; a 300 px drawer, docked from
  a 900 px map region; "Minimap | Painted" as a segmented control inside the drawer; "Search the
  map"; a half-disc progress badge and colour from *D* 26; the paths in `src/map/pins.ts`.
- Each design leaves the zoom controls' corner to the other (ui-refresh §11, map-presentation
  §25.3.9).

The owner would review two different drawers at UR.0b and MP.0b-3. **Required change:** one
drawer spec, owned by map-presentation §25.3, with ui-refresh §11 reduced to a pointer. Settle the
name, width token, open rule, style control, search wording, the Available filter rule, the path
module and the progress cue once. Re-shoot the refresh shell with the agreed drawer. Show the owner
one sheet covering both mocks.

**UO-04 (major): quest pins show no difficulty zoomed out, which reopens decision G.** Evidence:
OD-24 and D-041 G set difficulty colour, with pips, from 11 px. §25.2.3 puts the pips inside the
head, so colour starts only at *D* 26 (the zone band), and P1 recommends keeping it there. At the
continent band every quest pin is a white "!" (`pins-mock/shots/02`). At *D* 26 the pips squeeze the
"!" to 13 px, where MapGenie's "!" fills its head (sheet 3). The route rows put the pips beside the
mark, so the "one language" rule points the same way. **Required change:** put the pips in a tag
beside the head (P1 b) or under the point, let the glyph fill the head, and colour from *D* 16,
where the glyph reaches 11 px. Draw *D* 16, 20 and 26 both ways on the pin sheet. Change P1's
recommendation to honour G unless the owner chooses otherwise.

**UO-05 (major): the first view the owner sees is framed in staircase boxes.** Evidence
(`pins-mock/shots/01`, `02`, sheet 3, OBSERVED): in the minimap style, `zone-outlines` draws the
terrain zone outlines at the world and continent bands. They follow the terrain grid in steps and
run out over the sea: boxes round Teldrassil, Moonglade and the Eastern Kingdoms' coast. MapGenie
draws no outlines. The mock's stand-in navy also shows tile-edge rectangles and a black Zephras
card. **Required change:** clip the outlines to land (the D-032 coastline), or draw only borders
shared by two land zones. Consider leaving them off at the world band. Apply the navy recolour
uniformly before MP.0b-3, so the owner judges the navy and not mock artefacts.

**UO-06 (minor): the full flight web covers the zone and close bands.** Evidence
(`pins-mock/shots/03`, `04`): all 148 flights are drawn from 0.03 px per yard, and about twenty of
them converge on the Crossroads at 1 px per yard. **Required change:** at the zone and close bands,
draw only the flights of the hovered or selected node and the route's own flights. The full network
stays at the world and continent bands, with an "All flights" row for the rest.

**UO-07 (minor): rows no longer say what the step does.** Evidence (sheet 1): WoWF-QRP's rows read
"Accept Sharing the Land" and "Turn in Sharing the Land". Ours show "Your Place in the World" twice
and "Cutting Teeth" three times, told apart only by a 22 px glyph. The verb exists only in the spoken
name. **Required change:** start line 1 with the kind ("Accept", "Turn in", "Complete"), muted if
width is short, or start line 2 with "from Gornek" and "to Gornek". Show it in the mock.

**UO-08 (minor): the reasons against WoWF-QRP's "later" look have a cheaper fix.** Evidence
(ui-refresh §6.4): 62 % opacity would fail contrast, but the PERF-11 reason applies only to a
per-row flag. One element drawn under the rows, as the insertion line is drawn, can give every row
after the selection a sunken background without re-rendering them. In the light theme
`--frl-fg-subtle` on `--frl-surface-sunken` is 4.69:1 (MEASURED). **Required change:** add this as
option (d) to decision B, with a dark-theme band token and every text pair computed, and mock it.

**UO-09 (major): decision E asks the owner to judge warmth without seeing it.** Evidence: both
benchmarks use a display typeface and warm or gold accents (sheet 2, sheet 3). Our mocks keep
system type and cool greys, so the refresh reads as today's app with discs. Options (b) and (c) are
mocked only "on request" (R10). A warm-neutral surface is not WoWF-QRP's branding. A self-hosted,
openly licensed heading face adds no JavaScript to the entry chunk (fonts load as separate assets),
though it needs a licence entry. **Required change:** mock (a), (b) and (c) side by side, beside the
minimap map, for UR.0b.

**UO-10 (minor): Train and Buy are missing from the footer.** Evidence: WoWF-QRP's footer has Train
and Buy (`h-head-left-panel-dark.png`, callout 7). The `train` and `vendor` step kinds already exist
(`src/domain/route.ts`). The design defers them to a map path (§7.3). **Required change:** add
Train and Buy to the Add footer, inserted like Grind, and check that the footer still fits at
288 px.

**UO-11 (minor): "Accept it" sits away from what it accepts.** Evidence (sheet 2): WoWF-QRP puts
Accept right after "Needs: <prerequisite> [level]". Ours puts "Accept it" at the row's end, under
the locked quest's own title. **Required change:** place the button after the prerequisite link on
line 2 as the grid's next cell, or label it "Accept first".

**UO-12 (minor): the owner may look for WoWF-QRP's left-panel controls.** Evidence (sheet 1): its
rows show ×, "opt" and "wh↗" on every row, and its header is a route picker with New. Ours shows row
actions on hover and on the active row only, and moves the route switch to Projects at the top
right. **Required change:** add decision F (row actions on every row, muted, or as designed), with
a mock of both. Make the left header's route name open the Projects menu, with New.

**UO-13 (nit): default buttons read as outlines.** Evidence (§9.5): the tile is 1.05 to 1.13:1
against the light surfaces, where WoWF-QRP's `.btn` is a visibly filled chip. **Required change:**
darken the light tile to about 1.2:1 and recompute the pairs.

**UO-14 (nit): a bold "0" heads every accept row.** Evidence (sheet 1): WoWF-QRP shows no XP where
none is gained. **Required change:** draw a known zero in muted regular weight, and keep bold for
gains.

### Summary

| Id | Severity | Area | Design |
|---|---|---|---|
| UO-01 | major | "!" disc fill | ui-refresh §5.1 |
| UO-02 | major | Map size, collapsible panels | both |
| UO-03 | major | Two drawer specs | both |
| UO-04 | major | Pin colour threshold, pips in the head | map-presentation §25.2 |
| UO-05 | major | Zone outlines over the sea; mock navy | map-presentation §25.4 |
| UO-06 | minor | Flight web at close zoom | map-presentation §25.4 |
| UO-07 | minor | Verb in row titles | ui-refresh §6.1 |
| UO-08 | minor | "Later steps" band | ui-refresh §6.4, §17 B |
| UO-09 | major | Warmth and typeface not mocked | ui-refresh §17 E |
| UO-10 | minor | Train, Buy | ui-refresh §7.3 |
| UO-11 | minor | "Accept it" placement | ui-refresh §5.4 |
| UO-12 | minor | Row buttons, route picker | ui-refresh §4.1, §6.5 |
| UO-13 | nit | Button fill | ui-refresh §7.1 |
| UO-14 | nit | Bold zeros | ui-refresh §6.1 |


## Critic: project rules and engineering constraints (2026-09-27)

> *Restored on 2026-09-27 by the revision author.* This critic's section was missing from this file
> when revision 2 was written: the owner-view critic's write had replaced the file after this
> section was added. The text below is the critic's own copy, saved in
> `.cache/ui-refresh/critic-rules/section.md`, unchanged.


Scope: [ui-refresh.md](../research/ui-refresh.md) revision 1 and
[map-presentation.md](../research/map-presentation.md) revision 3 (§25), against UI.md §1, §3 to §6,
§8, §9, §11 and §12, ARCHITECTURE §4, D-029, D-039, D-041, D-042, D-045 and D-046. The code and the
working tree were read only; `git status` shows the map build editing `App.tsx`, `MapPanel.tsx`,
`MapFrame.tsx`, `MapLegend.*`, `tokens.css`, `tests/ui-tokens.test.ts` and
`tests/architecture.test.ts`. Scratch checks are in `.cache/ui-refresh/critic-rules/`:
`contrast-check.mjs` recomputes every new pair from `tokens.css` and the mock's proposed values, and
`hover-fix.mjs` computes the fixes and the glyph proportions. No site was visited.

**Checked and sound.** Every §9.5 value I recomputed matches to two decimals, except the pair
missing from it (UR-02). The two-tone pin's floor is 4.095:1. The hue distances hold: danger hover
33° from difficulty red; minimap muted ink 27° from cyan; navy candidate 28° to 30°; minimap route
43°. The per-band sums (1,560, 1,960, 2,160 and 2,140) are right. No faction colour is used, and
there is no cyan on the map.

### Findings

**UR-01 (major): quest-mark colour departs from D-041 G, and the two documents disagree on it.**
Evidence:
- D-041 G, restated in D-045 item 3, gives the difficulty colour with pips "from 11 px", and
  "smaller marks stay ink-coloured".
- §25.2.3 colours quest pins only at *D* 26. Pins of *D* 16 to 25 (glyphs about 11 to 17 px) stay
  light, and §25.11 P1 makes that the default. The map reads "11 px" as the glyph's height.
- ui-refresh §11 says pins are "filled with the difficulty colour and pips from 11 px … ink below
  11 px".
- ui-refresh's compact 18 px `QuestMark` colours a glyph 10.6 px tall (12.95 px at 22 px). Under
  the map's reading, that is below the threshold.

Required change:
- Define the 11 px measure once (mark or glyph) in DECISIONS.
- Until the owner answers P1, the default must satisfy G as written (P1 (b), or a pip tag). Option
  (a) goes to the owner as a proposed amendment of D-041 G.
- ui-refresh §11 quotes the map's rule.
- The compact mark meets the threshold or stays ink.

**UR-02 (major): the dark theme's default button edge fails 3:1 on hover.** Evidence:
- `--frl-border-strong` #707c8e on the proposed dark `--frl-tile-hover` #2d3544 is 2.91:1. In the
  light theme it is 3.33:1.
- `mock.css` keeps that edge on `.btn:hover`.
- §9.5 lists `tile-hover` only for text, icons and focus.
- UI.md §9 rule 1 computes `border-strong` on hovered backgrounds, and ui-refresh §7.1 promises 3:1
  "on the tile and on every panel".

Required change:
- Either darken the dark `tile-hover` (#2a3140 gives 3.08:1; #282f3c gives 3.18:1, with text at
  10.95:1 and icons at 6.14:1), or use a `fg-muted` edge on hover (5.63:1).
- Add the pair to §9.5 and to `tests/ui-tokens.test.ts`.

**UR-03 (major): the shared path set is not shared, and the quest-mark states differ between the
documents.** Evidence:
- **Glyphs.** ui-refresh §5.1 draws "!" as a filled tapered bar in a 22-unit box. Map §25.2.2 and
  `pins-mock/pins.js` draw it as a 4.4-unit round-capped stroke in a 24-unit box. The "?" differs
  as well.
- **States:**
  - "may be available": hollow ink with a dashed ring in rows; the difficulty colour with a dashed
    edge on pins.
  - the lock badge: lower right in rows; top right on pins, where lower right is the count.
  - progress: an arc in rows; a half-disc badge on pins.
- **Home.** The map puts the paths in `src/map/pins.ts`, in the `map/adapter` tier. That needs
  `tests/architecture.test.ts` and `tsconfig.pure.json` changes, because both allow only
  `adapter.ts` and `layers.ts` under `src/map`. ui-refresh re-exports them through `src/app`.
- Each document says the other matches it (ui-refresh §11; §25.3.9 item 3).

Required change: write one geometry, one state table and one home, and cite them from both
documents, with the canvas-equals-SVG test.

**UR-04 (major): the category drawer is specified twice, differently, and some parts have no
owner.** Evidence:

| Aspect | ui-refresh | map-presentation |
|---|---|---|
| Width | 236 px | 300 px |
| Docks from | 560 px of panel | 900 px of map region |
| Open by default | from a 1,600 px window (C) | where it docks (P4) |
| Toggle | "Categories", `aria-pressed` | "Map layers", `aria-expanded` |
| Built in | UR.7, in `MapFrame` | MP.4b, `MapCategoryDrawer.tsx` |

- At 1,366 px with 340 px side panels the map region is 684 px, so one design docks the drawer and
  the other overlays it.
- A disclosure takes `aria-expanded`, not `aria-pressed`.
- §25.3.9 item 1 gives the refresh four jobs it does not design:
  - side panels becoming drawers below 900 px;
  - the map's +, −, fit and step controls;
  - a checkbox with a mixed state;
  - a search field.

  ui-refresh §11 leaves the zoom controls to the addendum, and UR.1 adds no checkbox or field.
- §25.1 says D-046 places the drawer at the map's top left, but D-046 does not mention the drawer.

Required change:
- One drawer section, the map's, cited by the refresh.
- Use `aria-expanded`.
- Give each kit part MP.4b needs an owner and a UR step before MP.4b.

**UR-05 (major): the entry chunk has no room for both plans.** Evidence:
- ui-refresh §10.3 costs its parts at 2.6 to 3.7 kB, against a 248.5 kB stop rule: 2.31 kB above
  246.19 kB.
- Its +1.5 kB target depends on making Details lazy. §10.3 calls that a reserve, and §17 an "only
  if needed" default.
- §25.7 says the entry chunk "does not grow", but several costs are not counted:
  - MP.3's quest-state model and zone groups (`src/app`, used by Available, the start tab);
  - the drawer's counts and settings record;
  - the drawer's own dynamic import. UI.md §11 (CR-19) records that separate dynamic imports made
    the entry larger.
- `App.tsx` imports `MapFrame` statically. So §25.3.1's "part of the map (`MapFrame`) and loads
  lazily with the map engine" cannot both be true, and ARCHITECTURE §4 keeps `src/ui` out of the
  `map/leaflet` chunk.
- The baselines disagree: 237.60 kB (STATUS), about 244 kB (brief), 246.19 kB (`ours.md`).

Required change:
- Keep one shared ledger with both plans' items, including MP.3, measured by the dist audit on a
  stated tree.
- Decide the lazy moves (Details, the drawer, possibly the Projects dialog) before UR.1 and MP.3.

**UR-06 (major): the pin budgets and the 16 ms claim do not hold together.** Evidence:
- **Caps against clusters.** §25.7 caps `available-quests` at 150 (world) and 200 (continent)
  "after clusters and stacks", on a basis of 131 to 373 givers before clustering. §25.3.4 says caps
  apply when layers are built. §25.2.5's cells change with zoom inside the continent band, so:
  - clustering in the builder rebuilds on zoom, which revision 2 avoided;
  - clustering in the adapter lets the build cap cut 373 givers to 150, which §25.2.5 says never
    happens.
- **Time.** The 14.6 ms estimate at 4× leaves 1.4 ms, but §25.7 itself lists more `moveend` work
  at 4×. The hit index (0.8 to 0.9 ms), clustering (0.4 to 0.7 ms) and label placement (up to 1 ms,
  §17.3) bring the total to 15.8 to 17.2 ms, before the unmeasured stack merge.
- **Mix.** The 4.3 ms of non-pin drawing was measured over 1,450 items; the zone band's cap allows
  1,710.

Required change:
- State where clusters are made and where caps apply.
- Put the `moveend` work and the full capped mix in the MP.1 harness.
- If the total exceeds 16 ms, lower the pin cap or move the bookkeeping off the drawing frame.

**UR-07 (major): the step plans are not green and separate as written.** Evidence:
- **Button rename.** UR.1 renames `secondary` to default. `MapFrame.tsx:232`, a map-build file, and
  `ProjectMenu.tsx` use `variant="secondary"`.
- **Control heights.** 28 and 24 px controls resize the map toolbar and the layer panel.
- **Shared tests.** `tests/ui-tokens.test.ts` and `tests/architecture.test.ts` are being edited by
  the map build now. R7 omits both.
- **Path module.** UR.2 depends on "MP.4", which revision 3 replaced. MP.4a, which creates
  `src/map/pins.ts`, follows MP.1 to MP.3, so UR.2 to UR.4 either wait for it or collide with it.
- **Derived state.** UR.3 edits `app/derived-view.ts` without depending on MP.3.
- **Drawer.** UR.7 and MP.4b both build it.
- **Danger variant.** No step restyles `ProjectMenu`'s own destructive style to it.

Required change:
- Keep `secondary` as an alias until MP.4b removes the layer panel.
- Sequence the shared test files.
- Decide who creates the path module first.
- Order UR.3 against MP.3.
- Fold UR.7 into MP.4b.

**UR-08 (major): D-046's inline buttons in the left panel are not delivered, and the owner is not
asked.** Evidence:
- D-046 says the left panel's quest presentation "(rows with '!' and '?' marks, grouping and inline
  action buttons)" follows WoWF-QRP.
- ui-refresh §6.5 and §9.3 keep the rows as listbox options with pointer-only hover spans, and put
  the inline buttons on the right.
- The accessibility reason is sound, but it is not among decisions A to E.

Required change: add owner question F, offering both:
- the listbox and toolbar, as designed;
- a grid of rows with real buttons, with the key changes that brings.

**UR-09 (minor): the "!" geometry needs a recorded origin.** Evidence:
- ui-refresh §1 cites WoWF-QRP's `qmark` (`src/app.js` lines 646-660 at `96f602b`) as read.
- Three proportions of the glyph's height match within 2%:

  | Proportion | Ours | WoWF-QRP |
  |---|---:|---:|
  | Bar length | 0.641 | 0.638 |
  | Foot width | 0.208 | 0.203 |
  | Dot centre | 0.869 | 0.858 |

- Top width (0.297 against 0.420) and dot radius (0.131 against 0.142) differ.
- No legal conclusion is drawn.

Required change: either record how the path was drawn and change the proportions, or treat it as
ported code with D-029's header and a THIRD_PARTY_NOTICES entry.

**UR-10 (minor): the PERF-11 gate has no baseline, and the line-2 cache can go stale.** Evidence:
- UR.3 requires "PERF-11's browser measure … no regression beyond 10%".
- UI.md's PERF-11 numbers are relative (happy-dom and a development build), and browser times are
  left to Milestone 9.
- §10.1 caches "NPC · zone x, y" in a `WeakMap` keyed by the step object. Those words depend on the
  dataset view and the zone geometry, which change without new step objects.

Required change:
- Take a browser baseline on the unchanged tree before UR.3, in both densities, for a selection
  change and a re-walk publish.
- Key the cache by view and step, and compare line 2 in `sameDerivedRow`.

**UR-11 (minor): accessibility details.**
- **Quest log tab.** It is spoken "4 quests in the log after step 12", which does not contain its
  visible label (WCAG 2.5.3). Start the name with "Quest log".
- **Grid group headers.** The layout grids skip group header rows, so "Low level", "Unlocks soon"
  and the zone groups are never heard. Describe the group on each row, or let headers take focus.
- **Drawer rows.** The mock's rows are 20 px, with 14 px checkboxes at a 20 px pitch, below the
  refresh's 24 px target size. Specify at least 24 px.
- **Drawer keys:**
  - group collapse has no key;
  - Escape in the search field of an overlaid drawer is ambiguous. Define it as clear first, then
    close.
- **Forced colours, rows.** Row affordances cover the end of line 2 behind a gradient fade, which
  forced colours remove. Give them a solid backplate.
- **Selected-pin ring.** It has no halo and was not sampled. It is 2.14:1 against the keyline,
  about 1.1:1 over snow-grey minimap, and 1.52 to 1.74:1 over painted water. Halo it, and add it
  to `contrast.mjs`.
- **Forced colours, pins.** Canvas pins are not affected by forced colours, so §25.13's "the body
  becomes `Canvas`" needs a mechanism and an MP.4a test.

**UR-12 (minor): two symbols for one concept on one screen.** Evidence:

| Concept | Route rows (`StepTypeGlyph`) | Pins and the drawer's key |
|---|---|---|
| Flight | paper plane | wing |
| Vendor | bag | purse |
| Hearth, innkeeper | house with a flame | tankard |
| Trainer | open book | open book |

Only the trainer matches. Required change: one family per concept, or a stated reason in UI.md §4.

**UR-13 (nit):** ui-refresh §9.5 says the tile hues are "27° or more from cyan". The light tile
#eef1f5 (214.3°) is 26.6° from #006d7d (187.7°). That still satisfies the 25° rule, but the figure
needs correcting.

## Resolutions: ui-refresh revision 2 and map-presentation revision 3.1 (2026-09-27)

[docs/research/ui-refresh.md](../research/ui-refresh.md) revision 2 and
[docs/research/map-presentation.md](../research/map-presentation.md) revision 3.1 answer every finding
above: 27 findings, 14 major, 10 minor and 3 nits across both critics (the owner-view critic's 14 and
the rules critic's 13). **No finding is rejected.** One is accepted in part (UO-09), and its row says
what was not done and why. Where a finding offered alternatives, the row says which was taken.

The review asked for several changes outside the two design documents: DECISIONS, UI.md, STATUS,
`tests/ui-tokens.test.ts` and `tests/architecture.test.ts`. This pass was limited to the two design
documents and this file, so those edits are written into the designs' "edits elsewhere" sections for
their owners (ui-refresh §16, map-presentation §25.13) and scheduled in the combined step plan
(ui-refresh §14, steps UR.0 with MP.0, and MP.2b). Nothing under `src/`, `tests/`, `tools/` or
`public/` was touched. Neither site was visited and no WoWF-QRP source was fetched or ported.

**New evidence** (gitignored, local; the sheets hold only our own mocks):
- `.cache/ui-refresh/shared/marks.js`: the one path set and state table both mocks read.
- `.cache/ui-refresh/mock/`: the refresh mock, revision 2 (revision 1 kept as `*-r1.*` and
  `shots-r1/`), with the shell in both themes, with the drawer open and in map focus, the specimen, the
  forced-colours renders, `shots/parts/` for decisions B, E and F, and `measure.json`.
- `.cache/ui-refresh/pins-mock/`: the pins mock, revision 3.1 (revision 3 kept with an `-r3` suffix),
  its shots and benches, and `work/r3/`, which re-runs revision 3's bench on the same afternoon.
- `.cache/ui-refresh/rev2/`: `contrast.mjs` and `contrast.json` (every new pair, and decision E's warm
  option), `compose.mjs` and `sheets/` (`owner-sheet.png` for both mocks, `decision-B-*`,
  `decision-E-*`, `decision-F-*`, `pins-threshold.png`), `water-probe.mjs` (the stand-in navy's
  colours), and `sec25-r3.md` (revision 3's §25 as it was).
- `.cache/ui-refresh/ledger/`: the entry chunk rebuilt from the working tree with the project's own
  Vite configuration into `.cache` (246.19 kB gzip at 13:27, tree state in `tree.txt`), and its bytes
  attributed to source files through a source map (`attribute.mjs`, `attribution.json`).

Section numbers below are the revised documents': "UR" is ui-refresh.md revision 2, "MP" is
map-presentation.md revision 3.1.

| Finding | Severity | Resolution | Where |
|---|---|---|---|
| UO-01 | major | **Accepted.** The filled `QuestMark` is a difficulty-coloured disc with a `--frl-difficulty-well` glyph and a 1.5 px well keyline; the pips stay on the chip beside it; hollow states stay in ink. MEASURED: glyph on disc 4.75 to 17.46:1 (the chip's pairs); the keyline 15.36:1 or more on every light row state; the disc itself 3.52:1 or more on every dark row state (the critic's 4.14:1 was against the surface and raised panel only; the hover and selection rows bring it to 3.52). The pins keep MapGenie's dark body; both documents say the paths and states are shared and the fill follows its surface. UI.md §3.2's "on or under the well" is listed for its owner. Mocked beside revision 1's disc in the specimen. | UR §5.1, §9.5; MP §25.2.1; `mock/shots/specimen-*.png`, `left-panel-2x-*.png` |
| UO-02 | major | **Accepted.** Both side panels collapse: from 18 × 44 px handles on the map's edges, from Enter on a separator (the APG window splitter's key), and together through **Map focus** (a toggle at the map's top right, shortcut Alt+M). Focus moves to the handle that now shows a collapsed panel and back into a restored one; the state is kept per browser. The map's toolbar and status line go: Map layers floats at the top left, zoom and fit at the bottom right, the caption at the bottom left. MEASURED in the mock at 1366×768: 684 × 690 px with both panels (revision 1: 448 × 630 with the drawer docked), 1366 × 690 in map focus, 1066 × 690 beside the docked drawer. The panels' widths stay 300 to 460 px with a 340 px default; the room comes from collapsing. | UR §4.3, §9.3; MP §25.3.0; `mock/shots/shell-*.png`, `shell-focus-*.png` |
| UO-03 | major | **Accepted.** One drawer spec, map-presentation §25.3, with ui-refresh §11 reduced to a pointer. Settled once: the name "Map layers"; 300 px (`--frl-map-drawer-width`); docked from a 900 px map region, over the map below; open by default where it docks; "Minimap \| Painted" as the kit's radio segmented control inside the drawer; the field "Search the map"; the Available tab's filter filters only the tab; the paths in `src/map/marks.ts`; the progress pie. The refresh shell was re-shot with the agreed drawer, and one sheet shows both mocks. The refresh's decision C is folded into the map's P4. | MP §25.3, §25.3.9; UR §11, §17; `rev2/sheets/owner-sheet.png` |
| UO-04 | major | **Accepted.** The pips move to a tag at the head's left (9 o'clock, the side no badge uses; the critic offered "beside the head or under the point", and under the point would hide the location). The "!" fills the head (the glyph box is 0.70 *D*). Colour comes from *D* 16, where the glyph box is 11.2 px. Clusters and stacks take the colour when all their quests share one difficulty. P1 now recommends this as the default that honours D-041 G; revision 3's rule is offered as an amendment. The pin sheet draws *D* 13, 16, 20 and 26 both ways. | MP §25.2.1, §25.2.3, §25.2.5, §25.11; `pins-mock/shots/08-pin-sheet.png`, `rev2/sheets/pins-threshold.png` |
| UO-05 | major | **Accepted.** Zone borders are drawn only where two land zones meet, and only over land (a new `zone-borders` byproduct built from the D-032 outlines and coastline, with `--check`), and not at the world band. The mock's stand-in navy is one uniform colour (every water pixel becomes #0d1b30, where revision 3 kept 35 % of each pixel's variation), and the Zephras Isle card is navy with a thin frame and its caption. Re-shot before the owner's review. | MP §25.4, §25.0; `pins-mock/shots/01-world-minimap.png`, `02-continent-minimap.png` |
| UO-06 | minor | **Accepted.** At the zone and close bands only the flights of the hovered or selected flight point and the route's own flight legs are drawn; the whole network stays at the world and continent bands; a drawer row "All flights when zoomed in" (off by default) restores the rest. Mocked: none at the zone band with nothing hovered; the Crossroads' 26 flights when it is hovered at the close band. | MP §25.4, §25.3.2; `pins-mock/shots/03-*.png`, `04-*.png` |
| UO-07 | minor | **Accepted,** first option: line 1 starts with the verb ("Accept", "Turn in", "Complete", "Travel", "Grind", "Buy") in the muted ink and regular weight, in both densities. | UR §6.1, §6.2; `mock/shots/left-panel-2x-*.png` |
| UO-08 | minor | **Accepted.** Option (d), one band drawn under the rows after the selection, is added to decision B, with its token (`--frl-surface-later`: #e9ecf0 light, #0b0d11 dark) and every text pair computed (the lowest, `--frl-fg-subtle`, is 4.69:1 light and 6.58:1 dark). It is mocked beside the other three options, and it is now the recommendation. Rows have no background of their own at rest, so the band needs no per-row flag; the memo test checks that it moves without row renders. | UR §6.4, §9.5, §17 B; `rev2/sheets/decision-B-*.png` |
| UO-09 | major | **Accepted in part.** Options (a), (b) and (c), and (b) with (c), are mocked side by side in the whole shell beside the minimap map, in both themes; (b)'s warm-neutral tokens are specified and every pair computed. **Not done:** the heading face in the mock is a stand-in (Constantia, a Windows system font, local only), not the candidate Source Serif 4 (SIL OFL 1.1), because downloading a font needs the owner's permission and the mock must fetch nothing from another origin. The sheet says so, and UR.1 re-shoots with the real file if the owner chooses (c). The recommendation is now (b). | UR §12, §17 E, §9.5; `rev2/sheets/decision-E-*.png` |
| UO-10 | minor | **Accepted.** Train and Buy join the Add footer (the existing `train` and `vendor` step kinds, inserted after the selection like Grind). The footer is a caption line and one row of six buttons, which fits at 340 px (MEASURED); it wraps at 288 px (checked by hand in UR.4). The list loses 21 px (13 rows visible, not 13.5). | UR §4.1, §7.3 |
| UO-11 | minor | **Accepted,** both parts: the button sits right after the prerequisite link on line 2, as the grid's next cell, and it is labelled "Accept first". | UR §5.4; `mock/shots/right-panel-2x-*.png` |
| UO-12 | minor | **Accepted.** Decision F offers (a) row buttons on hover and the active row, (b) on every row, muted, and (c) real buttons in a grid, all mocked; (b) is recommended. The left header's route name opens the Projects menu, with New, and the top bar's Projects button moves there. | UR §4.1, §6.5, §17 F; `rev2/sheets/decision-F-*.png` |
| UO-13 | nit | **Accepted.** The light tile is #dde2e9: 1.30:1 on the surface and 1.20:1 on raised panels; every pair recomputed (button text 13.68:1, the edge 3.20:1). The dark tile is #262d3a (1.27 and 1.18:1). | UR §7.1, §9.5 |
| UO-14 | nit | **Accepted.** A known zero is drawn in the muted ink, regular weight; gains stay bold; unknown stays "?". | UR §6.1 |
| UR-01 | major | **Accepted.** The 11 px is defined once: it is measured on the shape that carries the colour, the disc's diameter in a row or list, the glyph's box (0.70 *D*) on a pin; the wording is proposed for DECISIONS (D-047) and written in map-presentation §25.2.3, which ui-refresh quotes. The default now satisfies G as written (pins coloured from *D* 16 with the pip tag); revision 3's rule goes to the owner as a proposed amendment (P1 (b)). The compact 18 px row mark meets the threshold, because its coloured shape is the 18 px disc; its glyph is never coloured. | MP §25.2.3, §25.11, §25.13; UR §5.1 |
| UR-02 | major | **Accepted,** third option: on hover the edge becomes `--frl-fg-muted` (5.32:1 light, 5.63:1 dark), in both themes, rather than a darker dark-theme fill; it also gives the hover a cue beyond the fill. The pair is in §9.5 and listed for `tests/ui-tokens.test.ts`. | UR §7.1, §9.5, §14 UR.1 |
| UR-03 | major | **Accepted.** One geometry, one state table, one home: `src/map/marks.ts`, a pure single-file module (`map/marks`) that imports nothing, read directly by `src/map/leaflet` and `src/map/layers.ts` and by `src/ui` through `src/app/map-exports.ts`. The map team creates it (MP.2b) with the architecture and `tsconfig.pure.json` changes, before the refresh's UR.2. Unified: the "!" (the pins' constant-width construction), "may be available" (colour kept, dashed edge; in rows a dashed ring outside the disc), badge slots (TL arch, TR state, BL position, BR count), progress (a pie badge on both). A test asserts the canvas and the SVG read the same strings; the mocks already share `shared/marks.js`. | MP §25.2.2, §25.2.3, §25.8; UR §5.1 |
| UR-04 | major | **Accepted.** One drawer section, the map's; the toggle uses `aria-expanded` and `aria-controls`; every kit part MP.4b needs has an owner and a step before it (UR.1: `Checkbox` with a mixed state, `SearchField`, the pressed and expanded looks; UR.5: the shell's collapse and map focus); the zoom controls float on the map (MP.4b); "side panels becoming drawers below 900 px" is withdrawn as unneeded; the D-046 attribution is removed. | MP §25.1, §25.3.8, §25.3.9; UR §7.1, §11, §14 |
| UR-05 | major | **Accepted.** One ledger for both plans (UR §10.3), measured on a stated tree: 246.19 kB (the three figures were three states of the tree). It counts MP.3's Available content, the marks module and the drawer's stub. Decided now: Details becomes a lazy part (−5.43 kB MEASURED in context) as the first refresh step, and the drawer is a lazy part in the existing `lazy-parts` chunk (not a new dynamic import, and not "with the map engine", since `App.tsx` imports `MapFrame` statically); the Projects menu's content (up to −4.8 kB) is the reserve. Both plans end at 242.9 to 246.0 kB; without Details lazy they would end at 248.2 to 251.2 kB. | UR §10.3; MP §25.3.1, §25.7 |
| UR-06 | major | **Accepted.** Clusters are made in the layer builder for four nested levels once per derived publish; the adapter picks a level by zoom; caps apply to clusters (nearest the view's centre, as MAPS §7.2), and never trim one. The pin cap drops to 300 per band (layer caps revised; sums 1,510 to 2,020). The stack merge uses a spatial hash (MEASURED 1.0 to 1.2 ms at 4× for 450 pins; the mock's pairwise scan took 12.4 ms); the hit index and label placement move off the `moveend` frame. The bench was re-run: the machine was about 13 % slower in the afternoon, so revision 3 was run again beside 3.1. ESTIMATE in the frame: 15.8 to 16.2 ms at 4× on the slower numbers, 14.8 ms on the morning's; MP.1's harness measures the whole capped mix with the bookkeeping, with two named fallbacks if it exceeds 16 ms. | MP §25.2.5, §25.2.7, §25.7 |
| UR-07 | major | **Accepted.** `secondary` stays as an alias of the default until MP.4b removes its last use in `MapFrame.tsx`; the 28 and 24 px controls are checked by hand on today's map toolbar and layer panel in UR.1 until MP.4b removes them; the shared tests have one owner at a time (`tests/architecture.test.ts` only MP.2b; `tests/ui-tokens.test.ts` MP.2, then UR.1, then MP.4a); MP.2b creates the path module before UR.2; UR.3 follows MP.3; UR.7 is folded into MP.4b; UR.4 moves `ProjectMenu`'s destructive items to the danger variant. The combined order is one table. | UR §7.1, §14; MP §25.8 |
| UR-08 | major | **Accepted,** with UO-12: decision F offers the listbox with its toolbar (on hover, or on every row), and a grid of rows with real buttons, with the key changes that brings. | UR §6.5, §17 F |
| UR-09 | minor | **Accepted,** first option: revision 1's tapered "!" is withdrawn, and the shared "!" (a constant-width round-capped stroke and a dot, drawn for the pins mock) is recorded with its construction and proportions. Against WoWF-QRP's `qmark`: bar 0.677 against 0.638, foot 0.233 against 0.203, top 0.233 against 0.420, dot centre 0.868 against 0.858, dot radius 0.132 against 0.142; only the dot centre is within 2 %, which any "!" with a dot under its bar shares. No code was ported, so no D-029 notice is needed; no legal conclusion is drawn. | MP §25.2.2; UR §1 |
| UR-10 | minor | **Accepted.** A new step, UR.2b, takes PERF-11's browser baseline on the unchanged tree (a selection change and a re-walk publish, 10,000 steps) before UR.3, which is measured against it in both densities. The line-2 cache is keyed by the dataset view and the zone geometry, then by step, and `sameDerivedRow` compares line 2. | UR §10.1, §14 |
| UR-11 | minor | **Accepted,** all seven: the Quest log tab is named "Quest log, 4 quests after step 12"; the quest grids' group headers take focus (a row with a `rowheader`); the drawer's rows are 24 px with 16 px checkboxes (MEASURED); a group collapses with Enter or Left and Right on its heading; Escape in the search field clears first, then closes an overlaid drawer; row actions sit on a solid backplate (`Canvas` under forced colours); the selected pin's ring lies on a halo both sides (5.43:1 or more in the minimap style, 4.81:1 or more in the painted light theme, MEASURED); pins under forced colours get a palette read from a probe element, with an MP.4a test. | UR §4.2, §6.5, §9; MP §25.2.3, §25.2.9, §25.3.2, §25.3.5, §25.3.8, §25.6 |
| UR-12 | minor | **Accepted,** one family per concept: the map's flight point, vendor and innkeeper pins become filled forms of the rows' paper plane, bag and hearth house (the trainer's book already matched). UI.md §4 gains the rule. Mocked in the pin sheet and the drawer. | MP §25.2.2; UR §5.1 |
| UR-13 | nit | **Accepted.** The new light tile #dde2e9 (215.0°) is 27.3° from #006d7d, and the dark tile #262d3a (219.0°) 32.8° from #3ccfe0; the text states the figures. | UR §9.5 |

**Also corrected on the way:** revision 3 said the drawer's placement came from D-046, which says
nothing about it (UR-04); ui-refresh revision 1 claimed pins coloured "from 11 px" while the map
coloured them from *D* 26 (UR-01); and this file had lost the rules critic's section, which is
restored above from the critic's own copy.

**Owner decisions still needed** (one review, `.cache/ui-refresh/rev2/sheets/`): the refresh's A
(recommended: two-line rows), B (recommended: the band, (d)), D (recommended: the character button),
E (recommended: warm neutrals, (b); the heading face offered) and F (recommended: row buttons on every
row, muted); the map's P1 (recommended: colour from 16 px pins with the pip tag, and the 11 px
measured on the coloured shape), P2 (recommended: clusters), P3 (recommended: light service pins) and
P4 (recommended: the Map layers drawer on the left, open where it docks).
