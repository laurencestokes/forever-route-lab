# General UI refresh after WoWF-QRP (design, revision 2)

Status: **design proposal, revision 2, 2026-09-27.** It designs how the general UI follows WoWF-QRP's
layout and affordances, as the owner asked (D-046): the route's quests on the left with "!" and "?"
marks, the quest lists, and the buttons. Revision 1 was critiqued the same day from the owner's point
of view (UO-01 to UO-14) and against the project's rules and engineering constraints (UR-01 to UR-13),
in [docs/reviews/review-ui-refresh-design.md](../reviews/review-ui-refresh-design.md). This revision
resolves every major finding and every minor one it agrees with; the review file records each
resolution, and §19 lists what changed. Five questions are for the owner (§17), beside the map's P1 to
P4; he answers all of them in one review.

It sits beside the D-045 map work, [map-presentation.md](map-presentation.md), now at revision 3.1.
Two things that both designs use are **specified there once** and only cited here (review UO-03,
UR-03, UR-04):
- the quest-mark **state table and glyph geometry** (map-presentation §25.2.2, §25.2.3);
- the **Map layers drawer and the map's own floating controls** (map-presentation §25.3).

Authority: [ARCHITECTURE.md](../ARCHITECTURE.md) and [DECISIONS.md](../DECISIONS.md) win over this
file, in particular D-029, D-039 A, D-041 G and J, D-045 and D-046. [UI.md](../UI.md) §1, §3 to §9 and
§14 are the rules this design keeps or amends; §16 lists the edits for their owners.

**Labels.** **MEASURED**: counted or timed here, with the method and the evidence file. **OBSERVED**:
seen in a saved screenshot or in a local render of WoWF-QRP's own stylesheet, with the file.
**ESTIMATE**: a number worked out, not measured, with how. **ASSUMPTION**: a design value to be
checked in the step that builds it.

**Evidence** (gitignored, under `.cache/ui-refresh/`):

- `friend-ui.md` with `friend/` (a to i): annotated crops of WoWF-QRP's saved screenshots (commit
  `378bed9e`, light theme) and local renders of its HEAD stylesheet (`96f602b24ca9200855c27d6e31eb5a7e420aebf8`,
  both themes) with sample content, and `friend/specimen-measures.json`;
- `ours.md` with `shots/` and `shots/measure.json`: our production build of the working tree (sample
  route, 55 steps) at 1366×768 and 1920×1080 in both themes;
- `mock/` (revision 2, updated in place; revision 1's files kept as `*-r1.*` and `shots-r1/`): the
  static mock (`shell.html`, `specimen.html`, `mock.css` with `mock-r2.css`, `mock.js`, our own code),
  its screenshots in `mock/shots/` and `mock/shots/parts/`, and the layout numbers in
  `mock/measure.json`;
- `shared/marks.js`: the one path set and state table both mocks read (a stand-in for the planned
  `src/map/marks.ts`);
- `rev2/`: `contrast.mjs` with `contrast.json` (every new pair of this revision, and decision E's
  warm option), `compose.mjs` and `sheets/` (the owner's sheets: `owner-sheet.png`, `decision-B-*`,
  `decision-E-*`, `decision-F-*`, `pins-threshold.png`);
- `ledger/`: the entry chunk measured on the working tree (`tree.txt`, `build.log`) and attributed to
  source files through a source map (`attribute.mjs`, `attribution.json`), all built into `.cache`
  with the project's own Vite configuration;
- `proto/`: size prototypes of four kit parts (revision 1, §10.3);
- `critic/` and `critic-rules/`: the review's evidence.

Nothing from WoWF-QRP or MapGenie is copied: no code, branding, icons, fonts or assets. The "!" and
"?" are our own paths; revision 1's tapered "!" is withdrawn for the pins' constant-width
construction, recorded in map-presentation §25.2.2 (review UR-09). tyba-dev.github.io and mapgenie.io
were not visited for this revision, and no WoWF-QRP source was fetched: the saved shots, revision 1's
two raw files and the review's sheets answered every question.

---

## 0. Summary

| Topic | Decision | Where |
|---|---|---|
| Reading of the ask | WoWF-QRP's "quests on the left with the exclamation mark" are its **route steps**, each led by a 22 px disc ("!" accept, "?" turn in). Its quest lists are on the right, with an Accept button per row. Both are designed here | §2 |
| Left panel | One job, no tabs: a 36 px header whose **route name opens the Projects menu** (with New), the Sample tag, View, Undo and Redo; a meta line; the step list; a step toolbar with Move up and down; an Add footer ("Add after step 12": Grind, Travel, Hearth, **Train, Buy**, Note). 13 two-line rows at 1366×768 | §4.1 |
| Right panel | Four tabs across the strip (Available, Quest log, Details, Validation), 36 px. Available and Quest log become WoWF-QRP-style quest lists with inline buttons; **"Accept first" sits right after "Needs <prerequisite>"** | §4.2, §5.4 |
| The map takes the window | **Both side panels collapse** from handles on the map's edges (and Enter on a separator); **Map focus** (Alt+M, or the button at the map's top right) hides both; the map's controls float on it. At 1366×768 the map is 684 × 690 px with both panels, 1366 × 690 in map focus (revision 1: 448 × 630 with the drawer docked) | §4.3; map §25.3.0 |
| Quest marks | `QuestMark`: a 22 px disc **filled with the difficulty colour, with a dark "!" or "?" and a dark keyline** (WoWF-QRP's gold disc, read as difficulty); the pips on the chip beside it (D-041 G). States from the one table in map §25.2.3: a dashed outer ring for "may be", hollow with a lock, level or progress-pie badge (top right) when there is nothing to take yet | §5.1-§5.3 |
| Route rows | Fixed **two-line rows of 40 px** (default) or one-line 28 px rows (a View choice). Line 1 **starts with the verb** ("Accept", "Turn in", "Complete"). Line 2: chip and "NPC · zone x, y", or the worst issue in words. Right: XP gained (**a known zero muted and regular**) over the level after | §6 |
| Later steps | **Recommended: a band drawn under the rows after the selection** (one element, no row re-renders, every text pair 4.5:1 or more), with the dashed insertion line; the owner chooses among four options (decision B) | §6.4 |
| Row buttons | Duplicate, Delete and Lock **on every row, muted** (recommended), or on hover only, or real buttons in a grid (decision F). All on a solid backplate | §6.5 |
| Buttons | Default: a tile fill **1.30:1 on the surface and 1.20:1 on raised panels**, a 3:1 edge that **strengthens to the muted ink on hover**, 6 px radius; 28 px (md) and 24 px (sm). Variants: default, primary (one per context), danger, ghost, link, external link, pressed and expanded looks, segmented control, checkbox with a mixed state, search field | §7 |
| Actions | Accept, Accept first, Objectives done, Done here, Turn in, Add all three, Grind, Travel, Hearth, Train, Buy, Note, Move up and down, Map focus, the panel handles, and the rest, each mapped to its `src/app` command and keyboard path | §7.3 |
| Top and status bars | The route name moves to the left header; **Projects moves with it**; the top bar gains the character button ("Orc Warrior · Horde", opens Settings) and "Go to zone or view…" (the atlas's view presets join the zones). The status bar: "Lv 4 after step 12", a 12 px XP bar with 20 ticks, "In log 4 / 40" | §8 |
| Accessibility | Rows stay listbox options; quest lists are APG layout grids whose **group headers take focus**; every new pair passes (§9.5), **including the button edge on the dark hover**; target size 24 px; forced colours for every new state | §9 |
| Performance | Row fields memo-stable (PERF-11), the line-2 cache keyed by view, geometry and step, a browser baseline taken first. **One entry-chunk ledger for both plans**: 246.19 kB measured today; **Details becomes lazy now** (−5.4 kB MEASURED) and the drawer is a lazy part, so both plans end at 242.9 to 246.0 kB | §10 |
| D-045 map | The Map layers drawer, the floating controls and the pin states are map-presentation §25's; this design supplies the kit (UR.1) and the shell's collapse and map focus (UR.5) | §11 |
| Mock | Shell at 1366×768 in both themes, with the drawer open and in map focus; specimen; forced colours; the owner's sheets for B, E and F and one sheet for both mocks | §12 |
| Owner decisions | A: two-line rows. B: the later band (d). D: the character button. E: warm neutrals (b), with the heading face offered. F: row buttons on every row, muted. (C is answered by map-presentation's P4.) | §17 |

---

## 1. Scope, inputs and rules

**In scope:** the left panel, the quest marks' drawing in rows and lists, the route rows, the right
panel's quest lists and tabs, the button kit and its placement, the top and status bars, the shell's
panel collapse and map focus, their accessibility and performance, and the shared entry-chunk ledger.

**Out of scope:** the map's pins, drawer, floating controls, pop-up contents and base map
(map-presentation §25, which also owns the quest-mark state table); the Available tab's *content*
rules (quest state, reasons, zone groups: MP.3); Milestone 8's proposal UI.

**Inputs:** the owner's words (§2), D-029, D-039, D-041, D-042, D-045, D-046, UI.md, STATUS, the two
audits (`friend-ui.md`, `ours.md`), the review, the code named in §14, and map-presentation §6, §7,
§14 and §25.

**Rules kept:**

1. **Ideas, not material.** WoWF-QRP is GPL-3.0 (D-029 allows porting its code with attribution,
   never its data). The brief forbids copying its branding, icons or assets. This design ports no
   code. Revision 1's "!" matched three proportions of WoWF-QRP's `qmark` (`src/app.js` lines 646-660
   at `96f602b`) within 2 % (review UR-09); it is withdrawn, and the shared "!" is a constant-width
   stroke and dot whose construction and proportions are recorded in map-presentation §25.2.2. If an
   implementer ever ports a piece of WoWF-QRP's code, that file needs D-029's header (notice, source
   path and commit, the licence at that commit) and a "Ported code" entry in THIRD_PARTY_NOTICES.
   Nothing here needs it, and no legal conclusion is drawn.
2. **Reserved colours.** The five difficulty colours mean difficulty only, and appear only through
   `DifficultyLabel` or components built on its rating (`QuestMark`, the map twin); cyan means
   provenance only. Colour is never the only cue. Faction is shown by words (and, on the map, by
   glyph and outline), never by red, blue or yellow.
3. **Unknown stays unknown.** Every number keeps its basis markers (≈, E, ≥, ≤, ?, hourglass).
4. **Hard constraints:** UI.md §9 accessibility, the virtualised route list's performance (PERF-11)
   and the entry chunk's 250 kB gzip budget.
5. **Other teams' files.** The map build is editing `App.tsx`, `MapPanel.tsx`, `MapFrame.tsx`,
   `MapLegend.*`, `tokens.css`, `tests/ui-tokens.test.ts` and `tests/architecture.test.ts` now; the
   step plan (§14) sequences around them, and this design never edits `tests/architecture.test.ts`.

## 2. The ask, and the two UIs today

The owner, verbatim (2026-09-27): "Let's also make our general UI more like:
https://tyba-dev.github.io/WoWF-QRP/ - e.g. how we present the quests on the left with the
exclamation mark, and the buttons." The same day: "going for a mapgenie.io style overall (which I
think would be better)" (D-045). D-046 records the first: the layout and affordances follow
WoWF-QRP, built with our own code, glyphs and styles; quest marks keep D-041 G.

**Reading.** In WoWF-QRP the "quests on the left" are the route's steps. Every step row opens with a
22 px disc; an accept step's disc is gold with a dark "!", a turn-in's a dark "?", a completion's green
with a tick (OBSERVED, `friend/b-left-panel.png`, `c-step-kinds-zoom.png`). Its rows say what the step
does ("Accept Sharing the Land"). The quest lists (Available, Quest log) sit on the right and lead with
a difficulty-coloured level number, with an **Accept** button ending each row, or right after "Needs:
<prerequisite>" on a locked one (`d-right-available.png`). What makes it feel good (`friend-ui.md` §6):
one selected step drives everything; the next action is one click; the nearest work comes first;
blockers come with their fixes; the arithmetic (XP and level) is on every row; the game's vocabulary;
quiet chrome.

**WoWF-QRP, in brief** (OBSERVED; details in `friend-ui.md`):

- Left panel: route select with New and Settings, "10 steps · starts at level 1", the step list, a
  footer of small buttons (Add grind, Add travel or note, "Hearth → place", Die, Train, Buy, Add custom
  quest, Undo). Rows are 32 px bare, about 46 px with a second line at `378bed9e`, and 86 to 102 px at
  HEAD, where six always-visible row buttons (×, opt, wh↗ and others) leave a 77 px title column and
  titles wrap to three lines (`h-head-left-panel-dark.png`, `specimen-measures.json`). Steps after the
  selected one are drawn at 62 % opacity.
- Right panel: four equal 40 px tabs; zone groups sorted by distance, then "Unlocks soon" and "Low
  level"; locked quests show "Needs: <prerequisite> [Accept]".
- Buttons: a 33 px panel-fill button with a 1 px edge (about 1.5:1) and 6 px radius, visibly filled; a
  gold primary; a danger button; 24 px small buttons; a pressed toggle; a segmented control; gold link
  text; 22 px row buttons at 55 % opacity; no disabled style (`i-head-buttons.png`). Display type
  (Alegreya Sans, Marcellus) and warm browns.
- Gaps: step rows cannot be reached by Tab, tabs have no arrow keys or panels, resizers are
  pointer-only, and the light theme's difficulty text fails 4.5:1.

**Ours today** (MEASURED, `ours.md`, `shots/1366x768-*-10-left-panel-2x.png`):

- Left panel: 168 px of chrome above the list (32 px header, 85 px banner, a 51 px toolbar that
  wraps), leaving 522 px for 19 one-line 28 px rows at 1366×768. Accept and turn-in share one grey
  card glyph (+ or ✓); titles are cut at 15 to 20 characters; one estimate per row; duplicate and
  delete slide in on hover and squeeze the title.
- Available: a flat list by level, a six-line hint, ⓘ and + icon buttons per row (about 210 tab stops
  per page), no state at the step. Quest log: a placeholder.
- Buttons: primary, secondary and ghost at 26 and 22 px; no danger variant, no pressed look for text
  buttons, no external-link form.
- The map sits between both panels under a 32 px toolbar and over a 24 px status line.

## 3. Principles

- **U1. One selected step drives the panels.** The route list's selection is the "now": the right
  panel's lists, the map, the status bar and the insertion point all read the state after it.
- **U2. The next action is one click, and it is the primary button.** At most one primary per
  context (a list row has none; Details, a pop-up and a dialog have one).
- **U3. The mark says what the step is and whether it can happen; colour says only difficulty.**
  Kinds are told apart by glyph, states by fill, dash and badge, and difficulty by the reserved
  colours with pips beside them. In rows the disc carries the colour; on the map the glyph does
  (map-presentation §25.2.1).
- **U4. Fixed row heights.** The virtualiser stays uniform: every row in a list has the same height,
  chosen by density.
- **U5. Nothing only by pointer or only by colour.** Every row action has a key and a toolbar
  button; every quest-list action is a real button reachable in a grid.
- **U6. The map can take the window.** The panels are the route and the quests; either can be put
  away, and the map's controls sit on the map (D-045, review UO-02).
- **U7. Ours in look.** Layout and affordances follow WoWF-QRP (D-046); the glyphs, code and palette
  are ours. Whether our palette turns warm and whether titles get a display face is decision E (§17):
  no gold, no parchment, and nothing fetched from another origin (UI.md §1, §3.3).

## 4. Panels and tabs

### 4.1 The left panel: the route, and no tabs

The left panel keeps one job, the route. WoWF-QRP's loop works because the quest lists (right) and
the route (left) are visible together: Accept on the right, see the step appear on the left, and the
selection moves on to it. A tab that hid the route behind Available would break that loop, so the
left panel has no tabs.

Top to bottom, at 1366×768 (MEASURED in the mock, `mock/measure.json`):

| Part | Height | Contents |
|---|---|---|
| Route header | 36 px | **The route's name as a menu button** ("Durotar start ▾", 15 px bold, ellipsised; an `h2` inside) that opens the **Projects menu** (switch route, New route…, Rename…, Duplicate, Recently deleted…, Delete route…), the Sample or Placeholder tag, **View** (a ghost disclosure), **Undo** and **Redo** (24 px icon buttons named "Undo <label> (Ctrl+Z)") |
| Meta | 22 px, or 42 px with a notice | "55 steps · 1 selected · Orc Warrior from level 1"; a second line only for a sample or placeholder route ("Auto-generated sample, not a recommended route") |
| Step list | the rest: 519 px (13 two-line rows) | §6 |
| Step toolbar | 34 px | One `toolbar`, one tab stop: Move up, Move down · Duplicate, Lock (a toggle, pressed when the selection is locked), Delete · Cut, Copy, Paste, Join (24 px icon buttons) |
| Add footer | 59 px | One `toolbar` named "Add after step 12": a small-caps caption "Add after step 12" and **Grind**, **Travel**, **Hearth**, **Train**, **Buy**, **Note** (24 px default buttons) on one line below it |

The chrome above the list falls from 168 px to 78 px (58 px without a sample notice). Below the list,
93 px of toolbars replace the 51 px toolbar that sat above it, so the list gets 519 px against 522 px
today, and the list's actions sit where WoWF-QRP puts them. Revision 1's list was 540 px; Train and
Buy (review UO-10) cost 21 px. MEASURED: the six buttons fit on one line at 340 px
(`addRowFits: true`); at the route panel's 288 px (800×700) they wrap onto two lines and nothing is
cut (ASSUMPTION, checked by hand in UR.4).

**The route name opens Projects** (review UO-12). WoWF-QRP's left header is a route picker with New.
Ours becomes the same: the name is a `menu` button (named "Durotar start, route: open the projects
menu"; the visible words start the name), and the menu is today's `ProjectMenu` content, with the
current route checked. The top bar's "Projects" button goes (§8); the save status stays there.

**View** is a non-modal disclosure like the status bar's Summary (Escape, the button, a press outside
or focus leaving closes it). It holds:

- **Rows:** "Two lines" (default) or "One line" (a segmented control, §7.1); a per-browser preference
  kept in the settings store beside the theme, not in the project.
- **Top number** (two-line rows): "XP gained" (default) or "Step time". One-line rows keep today's
  "Rows show" choice of one estimate: level after, XP gained or step time.
- **Key:** the marks (§5), the pips, ≈, E, ≥, ≤, ?, the hourglass, "↑" and the later band. This
  replaces the banner's always-visible key, which cost 32 px.

The panel stays resizable, and its range widens from 320-380 px to 300-460 px (`clampLeftWidth`),
with the existing keyboard separator; long titles are what the extra width buys (WoWF-QRP allows 240
px to 55 %). The default stays 340 px; the map's room comes from collapsing panels (§4.3), not from
narrow ones.

### 4.2 The right panel: four tabs across the strip

Available, Quest log, Details and Validation, as today, as tabs that fill the strip (`flex: 1 1 auto`:
equal shares of the space left after their words, because four strictly equal 85 px tabs cut
"Validation" with its count in the mock) and 36 px tall (`--frl-tab-height` 32 → 36). The selected tab
has body-colour bold text and the 2 px accent bar. Quest log carries its count ("Quest log 4"), named
**"Quest log, 4 quests after step 12"** so the name starts with the visible label (WCAG 2.5.3; review
UR-11); Validation carries its worst severity's shape and count, as now. Tabs keep automatic
activation, arrow keys and one tabpanel (UI.md §9 rule 10), which WoWF-QRP lacks.

- **Available** (§5.4): a filter row (text filter and "Near step 12 / All zones / <zone>"), a summary
  line ("31 available after step 12" and the **New custom quest** link), then the grouped quest grid.
  The six-line hint goes into the filter's description and the tab's empty state. The filter filters
  the tab only; the map has its own search (map-presentation §25.3.5).
- **Quest log** (§5.5): the quests in the log after the active step, with their objectives.
- **Details:** as today, with the state-aware primary action (§7.2), **Open on Wowhead** (D-041 J) and
  Delete as a danger button. It becomes a lazy part (§10.3).
- **Validation:** unchanged in content; restyled buttons.

The right panel gets the same separator as the left (300-460 px), a small `AppShell` change.

### 4.3 Collapsible panels and map focus (review UO-02)

MapGenie's map takes the window: both its panels collapse from edge handles, and its controls float on
the map. Revision 1 kept both panels, a toolbar and a status line, so the map was 448 × 630 px at
1366×768 with the drawer docked. Revision 2 lets the map take the window, and keeps WoWF-QRP's
three-part layout as the default.

- **Each side panel collapses** to nothing, and comes back, three ways:
  - its **handle**: an 18 × 44 px tab on the map's edge, below the map's top row of controls,
    "Hide the route panel" (‹) or "Show the route panel" (›), and the same for "the quests and
    details panel";
  - **Enter on its separator** (the APG window splitter's collapse key; the separators keep ←/→,
    Shift and Home/End);
  - **map focus** (below).
- **Map focus** hides both panels, or restores them to what they were. It is a toggle button,
  "Map focus", `aria-pressed`, at the map's top right (MapGenie's full-screen corner), and the
  shortcut **Alt+M** anywhere outside a text field (read from `KeyboardEvent.code`, so Option+M on a
  Mac, which types "µ", still works; ASSUMPTION: no conflict in Chrome, Edge and Firefox on Windows
  and macOS, checked in UR.5). The top and status bars stay.
- **Focus:** collapsing a panel from its handle, separator or map focus moves focus to the handle that
  now shows it, or to the Map focus button; restoring a panel moves focus into it (the route list, or
  the tab strip). Nothing focused is ever hidden. *As built* (review UI-18, recorded in UI.md §6 and
  §9 rule 14): the Map focus toggle keeps focus when it ends map focus, as a toggle does, and only a
  handle restores a panel (its separator is hidden with it; Enter on a separator collapses).
- **State:** the two collapse flags and map focus are kept per browser in the settings store, beside
  the widths, not in the project.
- **Measured** in the mock at 1366×768 (`mock/measure.json`): both panels open, the map is 684 ×
  690 px; in map focus it is 1366 × 690 px, and the Map layers drawer docks there, leaving 1066 × 690.
- **UI.md §6's width steps stand** (two columns at 1024 px and below, one at 720 px and below). The
  panels collapse at any width; below 1024 px the collapsed side panel no longer moves under the map.
  Revision 3 of the map design asked for "side panels becoming drawers below 900 px"; nothing needs
  it, and it is withdrawn (map-presentation §25.3.9).
- The handles are the shell's (`AppShell`, UR.5); they are drawn over the map's edges and belong to the
  shell's tab order (§9.3). The map's own controls are map-presentation §25.3.0's.

## 5. Quest marks and quest rows

### 5.1 The marks

`QuestMark` (new, `src/ui/markers/QuestMark.tsx`) draws a disc of `--frl-mark-size` (22 px; 18 px in
one-line rows) with our own "!" or "?". Its glyph paths, badges and states come from the pure module
`src/map/marks.ts` (map-presentation §25.2.2, created in MP.2b), read through `src/app/map-exports.ts`;
**the state table is map-presentation §25.2.3**, which the map's pins use too (review UR-03). It is
built on `DifficultyLabel`'s rating (its rank and the reserved tokens), so the rule "difficulty colours
only through `DifficultyLabel` or components built on it" holds.

**The filled disc takes the difficulty colour** (review UO-01). WoWF-QRP's accept and turn-in marks are
gold discs with a dark "!" or "?". Revision 1 drew the inverse, a black disc with a coloured glyph,
which in the light theme made a column of black blobs and in the dark theme a disc barely distinct
from the row (1.06 to 1.35:1). Revision 2:

- **Disc:** the difficulty colour (`--frl-difficulty-*`), radius 10 in the 22-unit box.
- **Glyph:** `--frl-difficulty-well`, the shared path at 0.70 of the box. The glyph on the disc is the
  same colour pair as the chip's text on its well: 4.75 to 17.46:1.
- **Keyline:** 1.5 px of `--frl-difficulty-well` round the disc. In the light theme it carries the
  silhouette, which the disc alone cannot on white (difficulty yellow is 1.07:1): 15.36:1 or more on
  every row state. In the dark theme the disc itself carries it: 3.52:1 or more on every row state.
- **Pips** stay on the chip beside the mark (8 px to its right on line 2 in two-line rows, beside the
  title in one-line rows), so colour never stands alone.
- A yellow "!" disc for a difficult quest is what WoWF-QRP and the game look like, and it is still a
  difficulty use of the colour (D-041 G). UI.md §3.2's "drawn on the well" becomes "on or under the
  well" (§16).

States (the table is map-presentation §25.2.3; this is how a disc draws them):

| State | Disc | Glyph | Extra cue | Where it appears |
|---|---|---|---|---|
| Available (accept) | the difficulty colour, well keyline | well "!" | pips on the chip beside it | route rows; Available |
| Low level | trivial grey | well "!" | 1 lit pip; the "Low level" group | Available |
| May be available | the difficulty colour, well keyline | well "!" | **a dashed outer ring** in `--frl-border-strong` (3:1 or more on every row state); the chip's dashed edge; the doubt in words | route rows; Available |
| Locked (a prerequisite, or an error at the step) | hollow: a `--frl-border-strong` ring, no fill | ink "!" | **lock badge, top right**; the reason in words | route rows; Available |
| Unlocks soon | hollow | ink "!" | **level badge, top right** ("7"); "Unlocks at level 7" | Available ("Unlocks soon" group) |
| Ready to turn in | the difficulty colour | well "?" | pips beside | route rows; Quest log |
| In progress | hollow | ink "?" | **progress pie, top right**: the share of objectives done; "1/3" beside | Quest log |
| Readiness unknown | hollow, dashed | ink "?" | a dashed empty pie; never "ready" | Quest log (a quest in the prior log with unknown objectives) |

- **The 11 px threshold** (D-041 G; review UR-01) is measured on the shape that carries the colour,
  worded once in map-presentation §25.2.3 and proposed for DECISIONS: in a row that shape is the disc,
  22 px or 18 px, so row marks are always coloured. Revision 1's compact mark coloured a 10.6 px glyph;
  under the inverted disc the glyph is never coloured.
- A hollow mark is always ink. The "!" is never in a triangle (the warning shape) and never in a gold
  of its own: its only colours are the five difficulty colours.
- Hollow discs have no fill, so the row's state (hover, selection, the later band) shows through.
- The badge slots are the map's: top left the dungeon-quest arch, top right the state. Revision 1's
  lower-right lock and its progress arc are withdrawn for the shared pie (review UR-03).

`StepMark` (new) draws the other kinds as **neutral discs**: a `--frl-tile` disc with a hairline edge
and today's `StepTypeGlyph` in `--frl-fg-muted` (complete, travel, grind, hearth, flight, train,
vendor, note, abandon). WoWF-QRP colours these by kind (green, purple, red, blue, teal); most of those
hues sit within 0° to 16.5° of a difficulty hue, the provenance cyan or our warning violet
(`friend-ui.md` §7), so we tell kinds apart by glyph alone. The map's flight point, vendor and
innkeeper pins are filled forms of the paper plane, bag and hearth house glyphs, so each concept has
one symbol on one screen (review UR-12, map-presentation §25.2.2).

### 5.2 States in route rows

A route row's mark reads the step's issues at the active walk, in `createRowDeriver` (only mounted rows
ask, §10):

- **accept, turn in:** an error at the step → locked (lock badge; line 2 names the error); a doubt
  code (the accept checks' `-uncertain` and `-unverifiable` codes, VAL013 and VAL021, the list
  map-presentation §7.2 uses) → may be available (dashed ring, colour kept); otherwise available or
  ready (difficulty colour at the level the step starts at, as the chip does today). A turn-in whose
  objectives are carried (D-040, VAL030) stays "ready" and shows the warning on line 2.
- **abandon:** a neutral disc with the abandon glyph.
- **complete and the other kinds:** neutral discs; no state.

### 5.3 Chain labels, level brackets and level-ups

- **Chain labels** stay the existing "(n/m)" from `quest-chains.ts`, drawn as muted "1/2" after the
  title and spoken "(1 of 2)". Details keeps "Chain: Part 2 of 3: A → B → C".
- **Level brackets** in quest lists: zone group headers carry the zone's level span ("Razor Hill ·
  Durotar 5-12", MP.3 and MP.7's derived spans), and a **Group by: Level** choice in the filter row
  groups by five-level brackets (1-5, 6-10, …) instead of zones. In the route list, group header rows
  show the level span of their steps ("6.0-6.8").
- **Level-ups** in the route list: where the level after a step crosses a whole level, the level cell
  reads "↑2.3" in bold and the row's name adds "reaches level 2". The deriver has both levels already
  (`levelBefore`, `projectedLevel`), so this costs a comparison.

### 5.4 The Available tab (quest rows on the right)

MP.3 owns the content (the state after the active step, the reasons, the zone groups sorted by
distance, the relevance windows). This design owns the look, the buttons and the keyboard, through
`QuestListItem`:

| Row part | Contents |
|---|---|
| Mark | `QuestMark` in the quest's state (§5.1) |
| Line 1 | The name, a button that opens the quest in Details; the chain label; the provenance badge where the dataset gives one |
| Line 2 | The difficulty chip; "+630 XP ≈" with its basis; the giver ("Gar'Thok"); or the reason: "Needs Vanquish the Betrayers" (a link button to the prerequisite in Details) **followed at once by Accept first**; "Unlocks at level 7 · level after step 12: 4.6"; "May be available: the level is a lower bound" |
| Action | **Accept** (default, sm) at the row's end; none on a locked row (its button is on line 2) or an "Unlocks soon" row |

**"Accept first"** (review UO-11): WoWF-QRP puts Accept right after "Needs: <prerequisite>". Ours now
does too: the prerequisite link and then **Accept first**, a 20 px default button, as the next grid
cell. Its name is "Accept first: Vanquish the Betrayers, the prerequisite of Encroachment" (label in
name). Revision 1's "Accept it" at the row's end, under the locked quest's own title, is withdrawn.

Rows are 48 px (not virtualised: pages of 100 as today, memoised). Group headers (28 px, sticky, small
caps) come in MP.3's order: zones by distance and class or quest-type groups, then **Unlocks soon**
(required level at most 3 above, WoWF-QRP's window, an ASSUMPTION in map-presentation §7.2), then
**Low level**. Within a group: available first, then by level, then by name.

The + button that today adds accept, complete and turn in at once moves to Details as **Add all
three**; the row's one button is Accept, as in WoWF-QRP. Accept inserts after the selection and the
new step becomes the selection (UI.md §14), so Accept, Accept, then Objectives done and Turn in from
the Quest log plays the route forward, as WoWF-QRP's does.

### 5.5 The Quest log tab (new)

It lists the quests in the log after the active step, from the derived pipeline's
`selected.after.questLog` (each entry's objectives are `open` or `done`), headed "Quest log after step
12: 4 / 40" (capacity from the ruleset's `questLogCapacity`, 40 in forever-beta, basis "client data").

- Each quest: `QuestMark` "?" (ready, in progress with its pie, or unknown), the name (opens Details),
  the chip, and **Objectives done** and **Turn in** (default, sm). A failed quest says "Failed" and
  has no Turn in.
- Each objective under it: ○ or ✓, its words, and **Done here** (a link button) while it is open.
- With no route state (loading, failed, no active step) it says so and lists nothing, as Validation
  does ("Not checked yet"); it never claims an empty log.

It is a lazy part (the chunk the Validation panel uses), so its code is not in the entry chunk
(§10.3).

## 6. Route step rows

### 6.1 Layout (two lines, 40 px; 44 px since B+)

**Layout B+ (D-051, built 2026-10-02).** The two-line row below is revised, and the revision is what
the app draws (UI.md §8 has the details):

- **44 px rows**, line 1 20 px and line 2 18 px (`ROUTE_ROW_HEIGHT_TWO_LINE`, `--frl-row-height-two-line`).
- **Difficulty:** the chip leaves two-line rows. The pips sit under the mark in ink, a filled disc
  keeps its difficulty colour, and line 2 starts with "Lv n", whose tooltip says the level and
  difficulty in words (a dotted underline for a lower-bound difficulty). One-line rows keep the chip.
  A hollow mark (locked, unlocks soon, in progress, record unknown) is not coloured, so those rows
  show no difficulty colour, only the lit pips' count, "Lv n" and the words (the chip carried the
  colour there before B+; owed to the owner). The unlit pips barely show against the row (1.1 to
  1.6:1): the cue is the lit count, not "n of 5".
- **Line 1:** the verb, title, provenance and lock, then the chain, which wraps out of sight where it
  does not fit. Line 1's issue marker is gone: the issue's shape is drawn once, on line 2, and the
  counts are in its tooltip and the name.
- **Row actions** (§6.5): only on the hovered row, the selected row (one row selected; a selection
  of several shows them on none of its rows at rest) and the active row.
- **The active row grows** by 32 px (`ROUTE_ACTIVE_ROW_EXTRA`, `--frl-row-grow`): the chain always
  shows, line 2 shows "Lv n · NPC · zone" whole, and the worst issue's words get up to two lines of
  their own below, with the row actions at the bottom right. The rows after it move down by 32 px
  through CSS, so a change of active row still re-renders two rows (§10.1). **Not in a list too
  short for it**: the row grows only when the list holds it and one plain row (120 px,
  `activeRowCanGrow`); at 200% zoom on a 768 px-high screen (a 61 px list) the active row stays
  44 px and is drawn as at rest, so it is never taller than the list.
- **Chain position** in every row's name and title tooltip ("(2 of 2)"), always on the active row,
  elsewhere where it fits.

MEASURED on the built B+ (`pnpm build`, then `tests/bench/browser/readability.ts --variant today`;
the committed sample project, 55 steps; 1366 × 768, device scale 1.5, light theme, Playwright's
Chromium 1194 headless, which draws no scroll bar; the glyph-box test of "cut"). **None of these
figures is in Segoe UI**: this container has no Segoe UI, so "Selawik" is Selawik 1.01 (Microsoft's
open, Segoe UI-metric font, drawn with weight 500 as Semibold) and "DejaVu" is the container's
system font. The Segoe UI re-measure is owed on the owner's Windows machine (`--font system`).

| | D-051's target (mock, Segoe UI) | Selawik | Selawik, 10 px gutter | DejaVu Sans |
|---|---|---|---|---|
| Quest titles cut at rest (of 54) | 4 (from 13) | 2 | 4 | 4 |
| Issue words cut at rest (of 22) | 7 (from 22) | 7 | 8 | 22 |
| NPC names cut at rest (of 32) | 0 (from 24) | 0 | 0 | 1 |
| Zones cut at rest (of 32) | — | 0 | 0 | 0 |
| Chain hidden at rest (of 38) | — | 2 | 8 | 12 |
| Steps wholly in view: as opened / top / step 8 active | about 11 | 10 / 11 / 10 | 10 / 11 / 10 | 10 / 10 / 10 |
| Active row: issue words whole | all | 22 of 22 | 22 of 22 | 21 of 22 |
| Active row: NPC and zone whole | all | 54 of 54 | 54 of 54 | 53 of 54 |
| Active row: D-040 carried-work cue shown / whole | kept | 18 / 18 of 18 | 18 / 18 of 18 | 18 / 18 of 18 |
| Active row: chain shown | always | 38 of 38 | 38 of 38 | 38 of 38 |
| Chain in the name / in the tooltip | all | 38 / 38 of 38 | 38 / 38 of 38 | 38 / 38 of 38 |
| Hovered row: issue words / NPC names cut | not covered | 22 of 22 / 17 of 31 | 22 of 22 / 18 of 31 | 22 of 22 / 24 of 31 |
| Active row height | 44 + one extra | 76 px | 76 px | 76 px |

- The list is 505 px in Selawik (476 px in DejaVu). With the grown active row in view 10 steps fit
  wholly, 11 without it. ↓ ↓ PageDown PageDown PageUp End Home each left the active row wholly in
  view; PageDown moves 10 rows. The dark theme gives the same counts as light (Selawik).
- The figures equal the B+ mock's (docs/reviews/rework-followup.md, "Readability mocks"), measured
  the same way in the mock stage. Our line 1 is about 10 px wider than the study's (218 against
  208 px): the 10 px gutter column reproduces the study's widths; a scroll bar on the owner's
  machine is the likely cause, not confirmed here.
- Today's panel before B+ (Selawik, no gutter): 7 quest titles cut, 22 of 22 issues, 18 of 32 NPC
  names, 12 steps in view, the chain in 0 of 38 tooltips.

**Before B+** (revision 2, built in UR.3):
MEASURED in the mock at a 340 px panel with hidden scroll bars: the text column is 212 px, about 28
to 30 characters of a 13 px title, against 15 to 20 today; a classic 17 px scroll bar leaves 195 px.

| Slot | Width | Line 1 (18 px) | Line 2 (16 px, 12 px text) |
|---|---|---|---|
| Selection bar | 3 px | selected rows (unchanged) | |
| Number | by digit count (20 px for two digits) | the step number, 11 px, right-aligned; it is also the drag handle (the grip icon goes) | |
| Mark | 22 px + 8 px | `QuestMark` or `StepMark`, centred over both lines | |
| Text | the rest | **the verb** in `--frl-fg-muted`, regular ("Accept", "Turn in", "Complete", "Travel", "Grind", "Buy"), then the title (13 px, medium), chain "1/2", provenance ◆ or ◇, then the issue marker (shape and count), and the lock when locked | the chip and "NPC · zone x, y" (quest steps), the objective and count (complete), "from A · 2m 05s ⌛" (travel), the note's first words; **or the worst issue's words** in its severity colour with its shape ("⊗ Needs level 3: level before is 2.6") |
| Estimates | 52 px | the top number: XP gained ("+1,380 ≈") by default, or the step time; **a known zero in `--frl-fg-muted`, regular**, gains in bold | the level after ("4.6 ≈", "↑4.6", "≥3.4") |

- **The verb** (review UO-07): WoWF-QRP's rows read "Accept Sharing the Land" and "Turn in Sharing the
  Land"; revision 1's showed "Cutting Teeth" three times, told apart only by the glyph. The verb costs
  6 to 8 characters of title; the step kind was already the start of the spoken name, which does not
  change. One-line rows show it for every kind except accept and turn-in. Those leave the verb to the "!" or "?" mark, whose shape says it, and give the 6 to 8 characters to the title. The tooltip and the spoken name keep the verb (UI-15, ratified by the owner on 2026-10-01, D-052 item 4).
- **The zero** (review UO-14): a bold "0" headed every accept row. A known zero is now muted and
  regular (fg-muted on every row state 6.19:1 or more); an unknown stays "?", and a lower bound "≥".
- **Basis markers** keep today's rules (UI.md §8): ≈ with its dotted underline, E folded into ≈ in
  dense cells, ≥ and ≤, ? with its reason, the hourglass in the step time's gutter only. The time,
  when not the top number, shows its hourglass on line 2 of travel steps and is always in the name
  and the cell's tooltip.
- **Line 2 detail** is formatted only for mounted rows and cached (§10.1), so building the row models
  on a route change does no extra work.
- **The issue line** shows the worst issue at the step (error, then warning, then info): its shape,
  its colour and its words. The fix stays in Details and Validation, one Enter away. WoWF-QRP's fix
  links inside the row are not copied, because a row is a listbox option and cannot hold a link (§9.3).

### 6.2 One-line rows (28 px, the compact choice)

Today's row with three changes: the grip goes (the number is the handle), the kind glyph becomes the
18 px mark, and the title starts with the verb, except on accept and turn-in rows, where the mark's "!" or "?" says it (UI-15); the name and tooltip keep it. The chip stays beside the title; one estimate, chosen
as today. It shows 19 rows at 1366×768 and 30 at 1920×1080 (MEASURED, `ours.md`).

### 6.3 Group header rows

The same height as step rows in each density. Two-line: the group's label in small caps on line 1;
"4 steps · imported RXP step" on line 2; the level span of its steps in the estimate column. The
spoken name gains the span.

### 6.4 Selection, insertion and later steps

- **Selection and focus** are unchanged: the 3 px bar and tint, the inset focus ring on the active
  row, `aria-activedescendant`.
- **Insertion point:** a 2 px dashed `--frl-drop-indicator` line with a small caret at the left edge,
  drawn by the list (one element, `aria-hidden`) at the boundary after the selection's last step, and
  the footer's "Add after step 12" caption. Nothing is written into a row, so the virtualiser and the
  memoised rows are untouched. The toolbar's name says it for assistive technology.
- **Later steps** (decision B, review UO-08). WoWF-QRP draws the steps after the selected one at 62 %
  opacity. Revision 1 rejected dimming, for text contrast and because every selection change would
  re-render every mounted row. The review pointed at a cheaper way, and revision 2 recommends it:
  - **(d) a band under the later rows** (recommended): the list draws **one element**, like the
    insertion line, from the boundary to the end of the list, in `--frl-surface-later`; rows have no
    background of their own at rest (hover and selection keep theirs), so the band shows through.
    Nothing is written into a row, so a selection change moves one element and re-renders at most the
    two rows whose selection changed (PERF-11). Every text pair on the band passes (§9.5): in the light
    theme `--frl-fg-subtle` is 4.69:1 on it; in the dark theme the band is the page background and every
    pair rises. Row actions on later rows take the band as their backplate (§6.5).
  - (a) nothing: the insertion line, the status bar's "after step 12" and the map's faint route after
    the active step (map-presentation §13.6) carry the "now";
  - (b) 62 % opacity, as WoWF-QRP: line 2 falls to about 2.6:1, and every mounted row re-renders;
  - (c) the marks alone at 45 %: text keeps its contrast, rows still re-render.

  `mock/shots/parts/B-*.png` and `rev2/sheets/decision-B-*.png` show all four with step 6 selected. The
  band is decorative: it is dropped under forced colours, where the insertion line (`Highlight`) stays.
  In the dark theme it is faint (1.10:1 against the surface), which the owner sees on the dark sheet.

### 6.5 Row actions (decision F)

**Since B+ (D-051)** the two-line rows show the actions only on the hovered row, the selected row
(one row selected: a selection of several shows them on none of its rows but the hovered and the
active one) and the active row, which is option (a) below; on the active row they sit at the bottom right of its
extra. They stay pointer-only `aria-hidden` spans, so the keys and the toolbar are unchanged. The
hovered row's line 2 still gives them its end (22 of 22 issues and about half the NPC names cut on
hover, §6.1); D-051 does not cover the hovered row.

Duplicate, Delete and the lock toggle stay **pointer-only** affordances (`aria-hidden` spans, UI.md §8)
at the right end of **line 2**, so they never squeeze the title. Every one has a list key and a toolbar
button. D-046 names WoWF-QRP's "inline action buttons", and the review asks the owner (UO-12, UR-08):

- **(b) on every row, muted** (recommended): drawn in `--frl-fg-subtle` on every row, and in
  `--frl-fg-muted` on the hovered and active rows. Line 2's text ends 66 px earlier. The rows stay
  listbox options, so every list key stays as it is; only CSS changes.
- (a) on hover and on the active row only, as revision 1 designed.
- (c) real buttons in a grid: the list becomes an APG grid whose cells hold buttons, so each one is
  reachable by keyboard. Every list key users rely on changes (arrows move between cells, and
  selection needs its own key), `aria-activedescendant` gives way to a roving tabindex over up to
  10,000 rows, and the memo tests are rewritten. Not recommended.

`rev2/sheets/decision-F-*.png` shows the three, with the route name's Projects menu open beside them.

**Backplate** (review UR-11): the actions sit on a solid backplate in the row's own background
(`--frl-surface`, the hover, the selection or the later band), not over a gradient fade, which forced
colours remove; under forced colours the backplate is `Canvas`. WoWF-QRP's other row buttons have no
counterpart here: "opt", "shared" and "sticky" are features we do not have, the note editor is
Details, and "wh↗" is Details' Open on Wowhead.

## 7. Buttons

### 7.1 Style, variants and tokens

**Default** (was `secondary`): a `--frl-tile` fill, a 1 px `--frl-border-strong` edge (3:1 or more on
the tile and on every panel), `--frl-radius-control` (6 px), 13 px medium text; **on hover the fill
becomes `--frl-tile-hover` and the edge `--frl-fg-muted`**; no gradient or shadow. WoWF-QRP's
panel-fill button with an edge is the model; its edges are about 1.5:1, ours at least 3.20:1 (§9.5).

- **The tile is visibly filled** (review UO-13): #dde2e9 in the light theme, 1.30:1 on the surface
  and 1.20:1 on raised panels (revision 1: 1.13 and 1.05, which read as outline buttons); #262d3a in
  the dark theme, 1.27:1 and 1.18:1.
- **The hover edge** (review UR-02): revision 1 kept the `--frl-border-strong` edge on the dark
  `--frl-tile-hover`, 2.91:1, below 3:1. The hover now strengthens the edge to `--frl-fg-muted`:
  5.32:1 (light) and 5.63:1 (dark). It is also a hover cue that is not only a change of fill.

| Variant | Look | Used for |
|---|---|---|
| default | tile, strong edge; hover: darker tile, muted-ink edge | most actions: Accept, Accept first, Turn in, Import, the Add footer, Show all and Hide all |
| primary | accent fill, accent-fg text, bold; hover `--frl-accent-hover`; a 2 px edge under forced colours | the one likely next action in a context: Save in dialogs, the state's action in Details and map pop-ups |
| danger (new) | `--frl-danger` text and edge on the surface; hover `--frl-danger-bg-hover` | Delete project, Delete route, Delete custom quest, Delete step in Details, Delete permanently |
| ghost | no fill or edge until hover | toolbars, View, Summary |
| link (new) | accent text, underlined | inline actions: New custom quest, Done here, Needs <prerequisite>, "Show in Details" |
| external link (new `ExternalLink`) | a link with the external glyph and "(opens in a new tab)" hidden; `target="_blank"`, `rel="noopener noreferrer"`, no referrer | Open on Wowhead (D-041 J) |
| pressed (new, text buttons) | `--frl-selection-bg`, accent text, bold, a doubled accent edge (inset); `aria-pressed` | Pick on map, Map focus, toggles |
| expanded (new) | the pressed look, driven by `aria-expanded` on a disclosure | Map layers, View, Summary |
| unavailable | `aria-disabled`, transparent, `--frl-fg-disabled`, the reason as the tooltip (unchanged) | anything that cannot run now |

**Sizes:** md 28 px (`--frl-control-height` 26 → 28), sm 24 px (`--frl-control-height-sm` 22 → 24).
24 px meets WCAG 2.2 target size (2.5.8) without relying on spacing; widths do not change (padding is
kept), so the status bar's width rules hold; its 32 px still leaves 4 px above and below a sm button
for the 2 px ring and its 1 px offset. The map toolbar and layer panel that 28 and 24 px would have
resized are removed by MP.4b; until then UR.1 checks them by hand (§14).

**Segmented control** (new `SegmentedControl`): native radios in a fieldset with a visually hidden
legend; the checked option has the selection tint, a 2 px accent underline and bold text. Arrow keys
come from the browser. The map's style control ("Minimap | Painted") is one.

**Checkbox** (restyled, with a **mixed** state for group headings: `aria-checked="mixed"`, a dash in the
box) and **SearchField** (the top bar's search look: a search icon, the field, a clear button) are kit
parts the Map layers drawer needs; UR.1 builds them before MP.4b (review UR-04).

**Icon buttons:** ghost (as today) or tile (the default look); pressed as now; 24 and 28 px. The map's
floating zoom buttons are 32 px tile icon buttons.

**New tokens** (both themes; values in §9.5's table): `--frl-tile`, `--frl-tile-hover`, `--frl-danger`,
`--frl-danger-bg-hover`, `--frl-surface-later`, `--frl-xp-tick`; sizes `--frl-radius-control` (6 px),
`--frl-row-height-two-line` (40 px), `--frl-mark-size` (22 px), `--frl-mark-size-compact` (18 px);
changed `--frl-control-height`, `--frl-control-height-sm`, `--frl-tab-height`. `--frl-danger` has the
error severity's values on purpose: destructive and error share one hue and one meaning ("this loses
or breaks something"); it is 41° (light) and 35° (dark) from the nearest difficulty hue and 131° to
139° from cyan, inside UI.md §4's limits.

**Renaming `secondary`** (review UR-07): UR.1 adds `default` and keeps `secondary` as an alias of it,
because `MapFrame.tsx` (a map-build file) and `ProjectMenu.tsx` use `variant="secondary"`. MP.4b
removes the last use in `MapFrame.tsx` and the alias with it; UR.4 moves `ProjectMenu`'s own
destructive style to the danger variant.

### 7.2 Placement and labels

| Where | Buttons |
|---|---|
| Top bar | Go (default); the character button (default, settings glyph, "Orc Warrior · Horde"); Import and Export (default, icons); theme and About (icon); the save status in words |
| Left header | the route name (a menu button: the Projects menu); View (ghost disclosure); Undo, Redo (icon) |
| Step toolbar | Move up, Move down, Duplicate, Lock, Delete, Cut, Copy, Paste, Join (icon, sm) |
| Add footer | Grind, Travel, Hearth, Train, Buy, Note (default, sm) |
| Available rows | Accept (default, sm) at the end; Accept first (default, 20 px) right after "Needs <prerequisite>"; the name and the prerequisite are link-like buttons |
| Quest log rows | Objectives done, Turn in (default, sm); Done here (link) per objective |
| Details, a quest | **one primary by state**: Accept (available), Objectives done (in the log, objectives open), Turn in (ready); the others default; Add all three (default); Open on Wowhead (external link) |
| Details, a step | the editors as today; Lock and Duplicate (default, sm); Delete (danger, sm) |
| Map pop-up (MP.6) | the likely action primary ("Accept after step 12", "Turn in after step 12", "Complete objectives after step 12"); Show in Details (default); Open on Wowhead (external) |
| The map (floating; map-presentation §25.3.0) | Map layers (default, expanded); Map focus (default, pressed); Zoom in, Zoom out, Fit route, Focus step (32 px tile icons); the panel handles (the shell's) |
| The Map layers drawer (map-presentation §25.3) | the style control (segmented); the search field; Show all, Hide all, Defaults (default, sm); checkboxes with a mixed group state |
| Dialogs | at the right: Cancel (default) then the primary; confirmations of loss use danger |
| Status bar | Summary (ghost disclosure); Cancel, Resume (default, sm) |

WoWF-QRP's labels are followed where they are clear ("Accept", "Turn in", "Objectives done", "Train",
"Buy"); ours are kept where they say more ("Add after step 12" rather than "Add grind", because the
caption names the place once for six buttons; "Accept first" rather than a second "Accept").

### 7.3 Every action, its command and its keyboard path

Commands are in `src/app` (`commands.ts`, `quest-steps.ts`); the ui calls them through
`src/ui/app/route-actions.ts`, which announces each result (UI.md §14, §9 rule 6).

| Action | Label and place | Command | Keyboard path |
|---|---|---|---|
| Accept a quest | Accept: Available row, Details, map pop-up | `actions.addQuest(dataset, id, ['accept'])` → `addQuestSteps` | Available grid: arrows to the cell, Enter or Space |
| Accept the prerequisite | Accept first: a locked Available row, after "Needs …" | `actions.addQuest(dataset, prerequisiteId, ['accept'])` | Available grid |
| Complete all objectives | Objectives done: Quest log row, Details | `actions.addQuest(dataset, id, ['complete'])` | Quest log grid |
| Complete one objective | Done here: Quest log objective; Details "Complete objective n" | `actions.addQuest(dataset, id, ['complete'], n)` | Quest log grid |
| Turn in | Turn in: Quest log row, Details, pop-up | `actions.addQuest(dataset, id, ['turnin'])` | Quest log grid |
| Add all three | Add all three: Details | `actions.addQuest(dataset, id, QUEST_STEP_PARTS)` | Tab in Details |
| Show a quest in Details | the quest's name in any list; Needs <prerequisite> | the existing `onOpen` (`openQuestsInDetails`, `setView({ rightTab: 'details' })`) | Enter on the name cell |
| New custom quest | link, Available summary line | the custom quest editor (`AppSidePanel`) | Tab |
| Grind / Travel / Note | Add footer | `actions.insertGrind`, `insertTravel`, `insertNote` (Note also opens Details) | footer toolbar: arrows, Enter |
| Hearth (new) | Add footer | new `actions.insertHearth`, a wrapper over `insertStep` with a `hearth` step (destination "unknown until simulation" as today) | footer toolbar |
| **Train, Buy** (new; review UO-10) | Add footer | new `actions.insertTrain`, `insertBuy`: wrappers over `insertStep` with the existing `train` and `vendor` step kinds (`src/domain/route.ts`), inserted after the selection like Grind; Details then edits the trainer or vendor and the location, as today's step editors do | footer toolbar |
| Move up / down (new buttons) | step toolbar | `actions.moveSteps({ by: -1 })`, `({ by: 1 })` | Alt+↑ / Alt+↓ in the list |
| Duplicate, Lock, Delete | step toolbar; row affordances | `duplicateSteps`, `toggleLock`, `deleteSteps` | Ctrl+D, L, Delete |
| Cut, Copy, Paste, Join | step toolbar | `cutSteps`, `copySteps`, `pasteSteps`, `joinSections` | Ctrl+X, Ctrl+C, Ctrl+V, J |
| Undo, Redo | left header | `actions.undo`, `actions.redo` | Ctrl+Z; Ctrl+Shift+Z or Ctrl+Y |
| Open a step in Details | Enter or double-click on a row | `setView({ rightTab: 'details' })` | Enter |
| Switch, create, rename, delete routes | the route name's menu | today's `ProjectMenu` commands | Tab to the name, Enter or ↓ opens, arrows, Enter, Escape |
| View (rows, top number, key) | left header | local state and the settings store | Tab; radios by arrows; Escape closes |
| Hide or show a side panel | the handles; Enter on a separator | the shell's collapse state (settings store) | Tab to the handle or separator, Enter |
| Map focus | the map's top right | the shell's map-focus state | Alt+M anywhere outside a text field; Tab to the button |
| Settings | the character button | `onOpenSettings` → `SettingsDialog` | Tab |
| Quest search | top bar | as today | Ctrl+K |
| Go to a zone or view | top bar select and Go | `jumpToZone`; the atlas's view presets | Tab, select, Go |
| Open on Wowhead | Details, pop-up | an external link (D-041 J) | Tab, Enter |
| Map layers, the drawer, zoom, Fit route, Focus step | the map | map-presentation §25.3 | map-presentation §25.3.0, §25.3.8 |
| Summary, Cancel, Resume | status bar | as today | Tab |

Not adopted from WoWF-QRP: Die (not modelled), "Hearth → place" naming the bind point (we do not model
the bind point yet), optional, shared and sticky steps (no such features), the group-size select.

## 8. The top bar and the status bar

**Top bar** (44 px), left to right (MEASURED to fit at 1366 px in the mock, `topFits: true`):

1. the product mark and name;
2. quest search, flexible to 420 px ("Search quests (Ctrl+K)");
3. **"Go to zone or view…"** and Go. The atlas's view presets ("Both continents", "Kalimdor", "Eastern
   Kingdoms", "Zephras Isle"), which lived in the map toolbar's surface select, come first, then the
   zones (map-presentation §25.3.0). Go stays: a select that acts on change would jump on every arrow
   key;
4. **the character button** (new): the settings glyph, "Orc Warrior" in bold and "· Horde", opening
   Settings; named "Orc Warrior · Horde, settings" so the visible words start the name (WCAG 2.5.3).
   Faction is words only. It replaces the word "Settings" (owner decision D);
5. Import and Export (default buttons with icons), theme and About (icons);
6. the save status ("Saved 11:35"), in the project strip's region. The **Projects** button moves to the
   left header, as the route name's menu (§4.1).

The project › route crumb leaves the top bar: at 1366 px it showed only "Sample …" (`ours.md`). The
route's name moves to the left header, where it gets about 200 px. UI.md §6's width steps keep working:
at 1200 px and below the action words hide (as now) and the character button keeps "Orc Warrior" to
1100 px, then its glyph alone, with its name.

**Status bar** (32 px, unchanged height; WoWF-QRP's footer is 59 px, which we keep for rows):

- **"Lv 4 after step 12"**: the level in 15 px bold and "after step 12" in 12 px muted, merging the
  level with today's Step item; the step's title item goes (the selected row names it, and the Step
  item's tooltip keeps it);
- **the XP bar**: 200 px by 12 px, a 1 px strong edge, the fill as now and 20 tick marks every 5 % in
  `--frl-xp-tick` (decorative: dropped under forced colours; the numbers carry the value); the value
  "1,500 / 2,500 XP ≈" beside it, never inside; the lower-bound notch, hatching and unknown states as
  now;
- Time, XP/h as now; **"In log 4 / 40"** (new, from the state after the active step and the ruleset's
  capacity; "≥4 / 40" when the prior log is only partly known; its tooltip names the basis);
- Summary, the simulation item, the optimiser item and the Data and Ruleset badges as now.

UI.md §6's width priorities gain one rule: "In log" hides at 1280 px and below with the badges' key
words (it is also in Summary).

## 9. Accessibility

### 9.1 Names

- **Route rows** keep one name that says the whole row (UI.md §8), now with the mark's state and the
  level-up: "22. Turn in quest: Lazy Peons (1 of 2), Foreman Thazz'ril, Durotar 44.6, 68.6. Ready to
  turn in. Quest level 4, Standard (green). Level after step about 6.0 (depends on assumptions),
  reaches level 6. XP gained 330. Time 25 seconds." A row with issues adds the worst issue's words
  after the counts, since line 2 shows them. `describeStepRow` also stops doubling a full stop when a
  title ends in one ("not planned.. Level after", `ours.md` §5).
- **Marks, chips, arrows, the band and markers** stay `aria-hidden`; the names carry them.
- **Quest-list cells:** the name button "Break a Few Eggs, quest level 6, Difficult (yellow), 420 XP
  (depends on assumptions), from Cook Torka"; Accept "Accept Break a Few Eggs after step 12"; Accept
  first "Accept first: Vanquish the Betrayers, the prerequisite of Encroachment". Each starts with its
  visible words (label in name).
- **Tabs:** "Quest log, 4 quests after step 12" (review UR-11), "Validation, 1 error".
- **The route name:** "Durotar start, route: open the projects menu".
- **Handles and map focus:** "Hide the route panel", "Show the quests and details panel", "Map focus
  (Alt+M)" with `aria-pressed`.
- **Icon buttons** keep required names with shortcuts ("Move up (Alt+↑)"); **External links** end with
  "(opens in a new tab)".

### 9.2 Focus

The 2 px accent ring everywhere, offset 1 px on buttons and inset on rows (unchanged). Sticky group
headers in the quest lists must not hide the focused row (WCAG 2.2 2.4.11): the list sets
`scroll-padding-top` to the header's 28 px. Disclosures (View, the Projects menu) return focus to
their button. Collapsing and restoring panels move focus as §4.3 says, so focus is never left on
something hidden.

### 9.3 Keyboard

- **Route list:** unchanged keys (UI.md §8). The rows stay listbox options, so they hold no focusable
  content (decision F (c) would change this, §6.5).
- **Toolbars** (step toolbar, Add footer): one tab stop, arrows inside (the kit's `Toolbar`).
- **Available and Quest log:** APG **layout grids**: `role="grid"`, one tab stop that remembers its
  cell; ↑ ↓ between rows, ← → between the cells of a row (name, prerequisite, Accept first or Accept),
  Home and End along a row, Ctrl+Home and Ctrl+End to the ends, PageUp and PageDown by ten rows,
  Enter or Space to activate. **Group header rows take focus** (review UR-11): each is a row with one
  `rowheader` cell ("Razor Hill, Durotar 5-12, 6 quests"; "Unlocks soon, 2 quests"; "Low level,
  1 quest"), so ↓ lands on it and a screen reader hears the group change. A page of 100 quests is one
  tab stop instead of about 210. The grid's description says the keys.
- **Separators:** ←/→ resize (Shift for 20 px), Home and End go to the limits, **Enter collapses or
  restores** the panel (APG window splitter).
- **Shell tab order:** top bar, the route panel (or its "Show" handle), the map region (its own order,
  map-presentation §25.3.0), the right panel (or its handle), the status bar. The handles take the
  collapsed panel's place in the order.
- **Alt+M** toggles map focus anywhere outside a text field.
- **Segmented controls:** native radios (arrows). **Tabs:** unchanged.

### 9.4 Forced colours

Each new state drawn with a background has a fallback (UI.md §9 rule 9); the emulated renders are
`mock/shots/specimen-forced-colours.png` and `shell-forced-colours.png` (Chrome's emulation, to be
confirmed in Windows contrast themes in UR.8):

| Element | Under forced colours |
|---|---|
| Filled `QuestMark` | opts out (`forced-color-adjust: none`), as `DifficultyLabel` does: the disc, its well glyph and keyline keep their colours, and the chip's pips beside it carry the meaning too |
| Hollow marks, the dashed ring, badges and the pie | `CanvasText` rings and glyphs; badges on `Canvas` |
| `StepMark` | `CanvasText` edge and glyph |
| Primary button | a 2 px edge, so the one primary still stands out |
| Pressed and expanded buttons, the checked segment | a 2 px `Highlight` edge |
| Insertion line | `Highlight` |
| The later band | not drawn (a background); decorative, the insertion line stays |
| Row actions | on a `Canvas` backplate (no gradient fade) |
| Selected rows, tab bar, XP fill | as today (`Highlight`) |
| XP ticks | not drawn (a background image); decorative |
| Unavailable | `GrayText` (as today) |
| The map's pins | map-presentation §25.2.9 |

### 9.5 Contrast of every new pair (MEASURED, `rev2/contrast.mjs`, WCAG 2.2 luminance)

Row states are the surface, the hover, the selection and the later band.

| Foreground on background | Need | Light | Dark |
|---|---|---|---|
| `fg` on `tile` / `tile-hover` (button text) | 4.5 | 13.68 / 12.54 | 11.26 / 10.03 |
| `fg-muted` on `tile` / `tile-hover` (button icons, step-disc glyphs) | 4.5 | 5.80 / 5.32 | 6.31 / 5.63 |
| `border-strong` on `tile` / `surface` / `surface-raised` (button edge at rest) | 3 | 3.20 / 4.17 / 3.86 | 3.27 / 4.16 / 3.86 |
| **`fg-muted` on `tile-hover` (button edge on hover; UR-02)** | 3 | 5.32 | 5.63 |
| `focus` on `tile` / `tile-hover` | 3 | 5.21 / 4.78 | 5.77 / 5.14 |
| `accent-fg` on `accent` / `accent-hover` (primary; existing) | 4.5 | 6.78 / 8.70 | 7.96 / 9.98 |
| `accent` on `selection-bg` (pressed and expanded text) | 4.5 | 5.56 | 5.80 |
| `danger` on `surface` / `surface-raised` / `tile` / `danger-bg-hover` | 4.5 | 6.44 / 5.96 / 4.95 / 5.54 | 7.44 / 6.90 / 5.84 / 6.56 |
| `accent` on `surface` / `surface-raised` / `surface-hover` (links) | 4.5 | 6.78 / 6.27 / 5.88 | 7.35 / 6.82 / 6.03 |
| the well glyph on the difficulty disc: grey, green, yellow, orange, red; unknown | 4.5 | 4.75, 7.81, 17.46, 7.51, 4.83; 11.86 | the same (theme-independent) |
| the filled disc's silhouette on the row states: the well keyline (light), the disc itself (dark) | 3 | 18.75 / 16.25 / 15.36 / 15.82 | 3.52 or more (grey 3.52, red 3.58, the rest 5.57 or more) |
| `fg` on the row states (titles, hollow glyph) | 4.5 | 17.81 / 15.44 / 14.59 / 15.03 | 14.35 / 11.76 / 11.31 / 15.83 |
| `fg-muted` on the row states (the verb, a zero, badge ink, the pie) | 4.5 | 7.56 / 6.55 / 6.19 / 6.38 | 8.05 / 6.59 / 6.34 / 8.88 |
| `fg-subtle` on the row states (line 2; muted row actions) | 4.5 | 5.56 / 4.82 / 4.55 / 4.69 | 5.96 / 4.88 / 4.70 / 6.58 |
| error, warning, info on the row states (the lowest of the three) | 4.5 | 5.09 or more | 5.87 or more |
| `border-strong` on the row states (hollow and dashed rings, badge rims) | 3 | 4.17 / 3.62 / 3.42 / 3.52 | 4.16 / 3.41 / 3.28 / 4.60 |
| `drop-indicator` on the row states (insertion line) | 3 | 6.78 / 5.88 / 5.56 / 5.72 | 7.35 / 6.03 / 5.80 / 8.11 |
| Report only: `tile` against `surface` / `surface-raised` | none (the edge carries it) | 1.30 / 1.20 | 1.27 / 1.18 |
| Report only: `surface-later` against `surface` | none (decorative) | 1.19 | 1.10 |
| Report only: `xp-tick` over the fill / the track | none (decorative) | 3.53 / 1.17 | 3.66 / 1.26 |

**Values:** light `--frl-tile` #dde2e9, `--frl-tile-hover` #d3d9e1, `--frl-surface-later` #e9ecf0 (the
sunken surface's value); dark #262d3a, #2d3544 and #0b0d11 (the page background's value). `--frl-danger`
and `--frl-danger-bg-hover` are revision 1's.

No pair fails. `tests/ui-tokens.test.ts` gains every non-report row (§16), including the hover edge.
**Hue distances** (review UR-13): the tile hues are 215.0° (light) and 219.0° (dark), 95° or more from
every difficulty hue, and 27.3° (light) and 32.8° (dark) from their theme's cyan. Revision 1 said "27°
or more"; its light tile was 26.6°. Both pass UI.md §4's 25°.

**Decision E's option (b)** (warm neutrals; `rev2/contrast.json`, "warm-light" and "warm-dark"):
every pair above also passes, the lowest being `danger` on the tile at 4.76:1 (light), `fg-subtle` on
the selection at 4.63:1 (dark), and the edge on the tile at 3.37:1 (dark). Its surfaces' channels
differ by 6 % at most (hue 36° to 40°), so they read as neutral; the reserved, accent and severity
colours do not change.

### 9.6 Not by colour alone

| Signal | Colour | Non-colour cue | Words |
|---|---|---|---|
| Quest difficulty (marks) | the five reserved colours on the disc | the chip's pips and level beside it | "Quest level 6, Difficult (yellow)" |
| Mark state | none | filled or hollow, dashed ring, lock, level or pie badge, glyph "!" or "?" | "May be available: …", "Locked: …", "Ready to turn in", "1 of 3 objectives done" |
| Step kind | none | the glyph in the disc, and the verb | the kind in the name |
| Level-up | none | "↑" and bold | "reaches level 6" |
| Later steps | the band (decorative) | the insertion line and "after step 12" | "Add after step 12" |
| Issue line | severity colours | the severity shape | the message |
| Danger | the error hue | the delete icon or the words ("Delete …") | the label |
| Pressed or expanded | accent | the doubled edge and bold text | `aria-pressed`, `aria-expanded` |

## 10. Performance

### 10.1 The virtualised route list

- **Fixed heights stay.** `ROUTE_ROW_HEIGHT` (28) and a new `ROUTE_ROW_HEIGHT_TWO_LINE` (40; 44
  since B+) in `virtual.ts`, each equal to its token (tested); `RouteList` takes the density and
  uses one row height for the window, drag, auto-scroll and paging, as it does now. No offset table
  is needed. **B+ (D-051)** adds one exception: the active two-line step row is
  `ROUTE_ACTIVE_ROW_EXTRA` (32) taller, so `rowTop(i) = i × 44`, plus 32 after the grown row; every
  offset function takes that one `GrownRow`. The rows after it move down by CSS
  (`.frl-row--two-line.frl-steprow.is-grown ~ .frl-row`), the list keeping the rows in index order in the DOM, so a change of
  active row re-renders only the two rows whose flags changed (tested in `RouteList.memo.test.tsx`).
- **Fewer mounted rows.** At 1366×768 the list is 519 px (MEASURED, mock): 13 visible rows, so about
  21 mounted at the top of the list and 29 mid-list (8 rows of overscan each side), against 27 and 35
  today.
- **Per row:** one SVG mark (3 to 6 elements) and a second line of 2 to 3 spans; with decision F (b)
  three always-rendered action spans, which are part of the memoised row and cost no re-render.
- **Derived values:** `createRowDeriver` adds the mark state (from the step's issues it already
  reads), the worst issue's words, the level-up flag and line 2's text: constant work per mounted row.
  `stableRow`'s `sameDerivedRow` compares the four new fields, so a new walk that leaves a row
  unchanged returns the same model object and the memoised row does not re-render (PERF-11).
- **Line 2 text** ("NPC · zone x, y") is formatted when a row mounts and cached, not in
  `buildRouteView`, so a route edit on a 10,000-step route does no extra formatting. **The cache is
  keyed by the dataset view and the zone geometry, then by step object** (review UR-10): a `Map` from
  the view and geometry objects to a `WeakMap` of steps, so a new view (character, overlays) or new
  geometry starts a new cache. Revision 1 keyed by step only, which would have kept stale words.
- **Selection** re-renders only the rows whose selected or active flag changed, as now; the insertion
  line and the later band are one element each outside the rows.

### 10.2 Quest lists

Pages of 100 memoised rows, as now. The grid's roving focus moves `tabIndex` on two cells through the
DOM (as the prototype does), not through React state, so arrowing re-renders nothing. Group headers
join the roving rows at no cost.

### 10.3 The entry chunk: one ledger for both plans (review UR-05)

The budget is 250 kB gzip for the entry and its static imports. **Measured again for this revision:
246.19 kB** at 13:27 on 2026-09-27, on the working tree with the map build's uncommitted atlas changes
(`ledger/tree.txt`: the build used the project's own Vite configuration, written to `.cache`). The
three figures the review found are three states of the tree: 237.60 kB at the Milestone 7 commit
(STATUS), "about 244 kB" in the brief, and 246.19 kB now. CSS is not counted.

**This table is the one ledger.** Map-presentation §25.7 cites it for its rows, and every UR and MP
step records its dist-audit figure in it.

| Item | Plan | Entry cost (gzip) | Basis |
|---|---|---:|---|
| Baseline, working tree | — | 246.19 kB | MEASURED (`ledger/build.log`) |
| Two map styles: the controller's style state, fallbacks and messages, the per-browser setting, the band's style fields (map-atlas.md §21) | MM.1 | +0.93 (247.12 kB) | MEASURED (dist audit, 2026-09-27; the controller +1.7 kB minified) |
| Zoom bands with hysteresis, per-band budgets, the `labels` layer and its builder, the new layer ids and the step numbers the controller hands the adapter (map-presentation.md MP.0c, MP.1); the labels canvas itself is in the lazy map chunk | MP.1 | +1.86 (248.98 kB) | MEASURED (dist audit, 2026-09-27; in context: controller +0.60, map/layers +0.74, map/adapter +0.41, MapPanel +0.04). **Above the 248.5 kB stop line**: for the architect; UR.1a's −5.43 kB is the next entry step |
| The map presentation's tokens (§25.5) | MP.2 | 0 (CSS only) | MEASURED |
| `src/map/marks.ts`, re-exported through `app/map-exports.ts` with no reader yet | MP.2b | 0 until UR.2 imports the "!" and "?" paths (the table is written as literals, so it is tree-shaken while unused) | MEASURED (not in the entry chunk) |
| **Details lazy**: `DetailsPanel` (`StepDetails`, `QuestDetails`, `StepEditors`, `field-parse`) in the `lazy-parts` chunk, preloaded when idle, with `DETAILS_LOCKED` moved to `selectors.ts` | UR.1a | **−5.17** (243.81 kB) | MEASURED (dist audit, 2026-09-27; lazy parts 13.92 → 19.62 kB gzip; entry CSS 10.82 → 10.46 kB) |
| The kit: `Button` restyled (default, `secondary` as its alias, primary, danger, ghost, link; pressed and expanded looks), `IconButton`'s tile, nine icons, `Checkbox`'s mixed state, `useLazy`'s peek | UR.1 | +0.45 (244.26 kB); **+0.59 more** when `SearchField`, `SegmentedControl` and `ExternalLink` are first used (tree-shaken until then) | MEASURED (dist audit; the three unused parts in context by a probe build, `docs/measurements/ui-refresh.json`) |
| `QuestMark`, `StepMark` and the part of `src/map/marks.ts` they read (the state table with its spoken templates, the "!", "?" and arch paths) | UR.2 | **+2.36** (246.62 kB) | MEASURED (dist audit; in context `QuestMark` 1.04, `StepMark` 0.05, `marks.ts` 1.25). In the entry from UR.2 because `memo()` components are kept once the kit exports them. 1.0 kB over the two estimate rows' 0.9 to 1.3; under the 248.5 kB stop line |
| MP.3's content: the state-aware Available tab (groups, reasons, search to any quest, the words without route state), the top bar's zone spans, and the map's quest layers from the model (the controller's inputs, hover prefix and notes; `map/layers`' marks on markers, counted marks, outlines and their budget). The model, its words and the layer notes are built in the lazy derived pipeline | MP.3 | **+1.60** (248.22 kB) | MEASURED (dist audit, 2026-09-27; in context: the Available content 1.25, the controller 0.65, `map/layers` 0.56, the top bar 0.04, `quest-state-text` 0.06). Inside the tab's 0.8 to 1.5 estimate; the map side was not in the ledger. `quest-state.ts`, `zone-levels.ts` and `geo/groups.ts` are not in the entry (the lazy derived pipeline is 42.3 kB gzip with them). Under the 248.5 kB stop line by 0.28 kB |
| UR.3 to UR.6 together: two-line rows, their deriver fields and the verb, the later band and insertion line; the route panel's header (the Projects menu button, View), step toolbar and Add footer with Hearth, Train and Buy; the character button, the status bar's "Lv N after step N" and "In log"; panel collapse, the handles, map focus and Alt+M; the Available tab's layout grid, locked, uncertain and "Unlocks soon" rows and Accept first. **Lazy now as well**: the Projects menu's popup and dialogs and the drift report (the reserve, taken in UR.4), About, Import and Export, View's content, the Quest log tab, and Details' texts (`app/detail-text.ts`); the kit exports lazy-only parts as types only | UR.3 to UR.6 | **−0.55** (247.67 kB) | MEASURED (dist audit, 2026-09-28). A build with the new content and none of the new lazy boundaries measured 254.12 kB (+5.90); the boundaries took back 6.45 kB. The lazy parts are now 31.93 kB gzip. Against the estimate rows (+1.6 to 2.6 for these steps), the content cost more; the roving helper is not shared with `IssueList` and `Toolbar` (decision 3 below), because the grid's keys differ. Under the 248.5 kB stop line by 0.83 kB |
| MP.4a to MP.4c and MM.7 together: the pins and the hit index (in the lazy map chunk), the quest givers' and turn-ins' clusters in the layer builder, the drawer's rows applied at the first render and kept in one record, the floating controls, the style control; **lazy**: the Map layers drawer, its key and the map search, and (moved in this step) the drawer's words, reasons, problems and counts (`app/map-wording.ts`, installed by the drawer); `LayerPanel` and `MapLegend` removed | MP.4, MM.7 | **+0.32** (247.99 kB) | MEASURED (dist audit, 2026-09-28; in context against a build of the UR.3 to UR.6 tree: `map/layers` +1.11 (the clusters), `map/marks` +1.41 (the pins' paths and geometry: read by the lazy pins and drawer, they stay in the module the entry holds, so "each glyph its own export" no longer keeps them out), `map-categories` +0.79, `map-style-setting` +0.29, `map/adapter` +0.14, `Icon` +0.11, `AppShell` +0.07, `MapLegend` −2.14, the controller −0.52 net). The lazy parts 31.93 → 45.02 kB, the leaflet chunk 65.10 → 72.23 kB. The first build of this step measured 251.34 kB, over the 250 kB budget, with the drawer's words in the controller; moving them into the lazy part took back 3.35 kB. Under the 248.5 kB stop line by 0.51 kB. Against §25.7's rows: the clusters were to be built in the derived pipeline (nothing in the entry), and `map/marks` was estimated at 0.3 to 0.5 kB |
| MP.5, MP.8 and MP.9 together: the place layers' builders in `map/layers` (the view's map, the flight network's zoomed-in rule, connectors), the controller's calls, the hovered flight point and the step numbers in place hovers, the adapter's types and the step token, the dataset's dungeon tables kept by reference; **lazy**: the places model (`app/map-places.ts`), the client tables' loader and the dungeon converter in the derived pipeline, the notes and counts in the drawer's words. **Moved out of the entry**: the TravelGraph, which reached it only through `isFlightMaster` (now `rules/travel-graph-flags.ts`) | MP.5, MP.8, MP.9 | **−1.35** (246.64 kB) | MEASURED (dist audit, 2026-09-28; against the MP.4 tree: `index` 233.71 → 234.69 kB (+0.98, this step's entry code) and the shared chunk 13.96 → 11.62 kB (−2.34, the TravelGraph and its seeds leaving it). The first build of this step measured 249.76 kB, with the graph's new seeding in the shared chunk. The derived pipeline 43.14 → 57.19 kB gzip (the TravelGraph, the places model and the client-table loader), the lazy parts 45.41 → 45.69 kB, the leaflet chunk 72.88 → 73.00 kB. Under the 248.5 kB stop line by 1.86 kB) |
| MP.6, MP.7, MP.10 and MP.11 together: the controller's popover target in place of the choice list (`MapFrame`'s choice list, its CSS and the controller's choose, choose-all and dismiss removed), the "Viewing" chip in `MapPanel`, the zone-frames call's minimap flag and dashed underground frames, the services and zone-fill calls in `map/layers`, the adapter's card, service and zone-fill types; **lazy**: the popover (`MapPopover`, `MapPopoverPanel`, `app/map-popover.ts`) in the lazy parts; the labels, the zone rings and poles, the services and the zone fills in the derived pipeline (`app/map-labels.ts`, `geo/zone-rings.ts`, `geo/pole.ts`, `app/map-zone-fill.ts`, `infra/maps/tints.ts`); the chip's canvas twin and the hatch in the leaflet chunk | MP.6, MP.7, MP.10, MP.11 | **−0.53** (246.11 kB) | MEASURED (dist audit, 2026-09-28, gzip level 6, against a build of the MP.5 tree taken in this step: `index` 234.69 → 234.10 kB; not attributed in context). The derived pipeline 56.55 → 60.67 kB, the lazy parts 45.30 → 50.10 kB, the leaflet chunk 72.34 → 73.39 kB, the entry CSS 12.80 → 12.69 kB (the audit's figures; the MP.5 row's lazy figures are Vite's). Under the 248.5 kB stop line by 2.39 kB |
| The atlas's MM.9 and ATL.10: the minimap as the default style, the atlas and the smooth wheel as the controller's defaults, and the `?atlas` and `?smooth-wheel` switches removed from `main.tsx`; two wording changes (the style note without an atlas, About's "Shown now: neither") | MM.9, ATL.10 | **−0.06** (246.05 kB) | MEASURED (dist audit, 2026-09-28, gzip level 6; `index` 234.04 kB and the shared chunk 11.69 kB). The lazy parts 50.10 kB, the derived pipeline 60.67 kB and the leaflet chunk 73.39 kB are unchanged. Under the 248.5 kB stop line by 2.45 kB |
| The review's UI fixes (fix-ui): Accept first that never adds a second accept, the quest grid's focus kept when a row leaves, the rows' short place, the XP on Available rows, the Viewing chip, the handles, map focus ring and pressed icon buttons (CSS), the popover's height and names, the map search's places and popover on choose, Both continents; **moved out of the entry**: the map search's index (the controller now imports only its drawing rule, `app/map-search-draw.ts`: −0.79 kB) and the rows' short issue form (built in the derived pipeline, `app/issue-short.ts`: −0.35 kB) | fix-ui | **+1.2 to 1.4** (fix-ui's own code, MEASURED in context by line range, `.cache/map-ui-build/fix-ui/ledger/attribute-ranges.mjs`) | MEASURED (dist audit, 2026-09-30 13:05, gzip level 6, the working tree with every fixer's changes so far: **251.10 kB**, `index` 239.01 + shared 11.76 + http 0.32). **Over the 250 kB budget by 1.10 kB**, with the other fixers' changes (about +3.9 kB) and this step's together: for the architect. The plan below (the pin-only exports and the clusters out of the entry, 2.52 kB) brings it under |
| `QuestMark`, `StepMark` | UR.2 | +0.6 to 0.8 | prototype (revision 1) |
| Two-line `StepRow`, deriver fields, the verb | UR.3 | +0.4 to 0.6 | ESTIMATE |
| `RoutePanel`: the route-name menu button, View, toolbars, the Add footer with Hearth, Train and Buy, the later band; less the banner and key | UR.4 | +0.3 to 0.6 | ESTIMATE |
| Button variants, `ExternalLink`, `SegmentedControl`, `Checkbox` mixed, `SearchField`, icons | UR.1 | +0.8 to 1.1 | prototype plus ESTIMATE |
| Available grid (one roving helper shared with `IssueList` and `Toolbar`) | UR.6 | +0.4 to 0.6 | prototype |
| Top and status bar items | UR.5 | +0.2 to 0.3 | ESTIMATE |
| Panel collapse, handles, map focus and Alt+M | UR.5 | +0.3 to 0.5 | ESTIMATE |
| Quest log tab | UR.6 | 0 (lazy part) | — |
| `src/map/marks.ts` ("!" and "?" paths, badges, states; each glyph its own export) | MP.2b | +0.3 to 0.5 | ESTIMATE |
| MP.3's Available content (classes, reasons, zone groups in the tab; the model is in the lazy derived pipeline) | MP.3 | +0.8 to 1.5 | ESTIMATE (today's tab is 1.16 kB in context) |
| The drawer and search: a lazy part in `lazy-parts`; the stub in the entry | MP.4b | +0.2 to 0.3 | ESTIMATE |
| Floating map controls in place of the toolbar and status line | MP.4b | −0.2 to +0.3 | ESTIMATE |
| Removing `LayerPanel` and `MapLegend` | MP.4b | **−2.07** | MEASURED in context |
| **Details lazy** (`StepDetails`, `QuestDetails`, `StepEditors`, `field-parse`) | **UR.1a** | **−5.43**, +0.1 to 0.2 for the boundary | MEASURED in context |
| **Total after both plans** (superseded: the plan rows above this line are the estimates the design began with; the MEASURED rows are what was built) | | ~~242.9 to 246.0 kB~~ | superseded (review UI-17) |
| The final verification (2026-09-30): every fixer's changes together measured **251.12 kB**; then **moved out of the entry**: the pins' half of `map/marks` (the other glyphs and `MARK_GLYPHS`, the pin, pip-tag and badge geometry, the pins' colour and group rules, the extents and hit targets) into its own file, `src/map/marks-pins.ts`, which the lazy map chunk and the drawer share as a 1.39 kB chunk (−1.30 kB), and the "Viewing" chip's ring lookup (`app/map-viewing.ts` with `geo/zone-rings.ts`), which the derived pipeline now publishes as the places' `zoneAt` (−0.84 kB) | final | **−2.14** (248.98 kB) | MEASURED (dist audit, 2026-09-30, gzip level 6: `index` 236.89 + shared 11.76 + http 0.32; `pnpm build:deploy` 248.97 kB). Under the budget, but **0.48 kB above the 248.5 kB stop rule**: for the architect. The quest givers' clusters (+1.11 kB) are still in the entry |
| The D-050 speed fixes (item 6): the quest givers' clusters (their cells, pins and hover words) moved from `map/layers` into `app/map-clusters.ts`, made in the derived pipeline's quest-state task and handed to the layer builder by the places model (`PlacesModel.clusters`), less the builder's new focus and split caches; **moved out of the entry**: the terrain byproducts' guards (`terrain.ts`, 1.62 kB) and the image-header reader (`image-header.ts`, 1.79 kB), each now a chunk of its own loaded with its first file (their paths and the image types stay in the entry) | D-050 speed | **−2.16** (246.82 kB) | MEASURED (dist audit, 2026-09-30, `tools/build/audit-dist.ts` on a build of `eff4341` and of the tree: `index` 236.89 → 234.73 kB, shared 11.76 and http 0.32 kB unchanged; in context `map/layers` 15.34 → 14.94 kB; `ui-refresh.json` `d050`; `docs/reviews/rework-followup.md`, Results). The clusters' −1.1 kB is the one still owed in the "Planned before Milestone 8" row. Under the 248.5 kB stop rule by 1.68 kB |
| The D-050 UX items and the review's minors together (rework follow-up): selection on open (`app/selection-memory.ts`, UI-08), the state after the last step with no step selected (PR-13), the level ceiling (PR-18), the berth table (TR-03), labels kept until the view changes (PR-16), the later band and row hover tokens (UI-06), one-line quest rows without the verb (UI-15), the giver's place without route state (QA-20), the free-path flight points (TR-10) | D-050 UX | **+0.68** (247.50 kB) | MEASURED (dist audit of the follow-up's build, 2026-09-30; not attributed in context; the same 247.50 kB on the re-pin's audit and on the follow-up critic's: `docs/reviews/rework-followup.md`, F-06, "Entry chunk" and the re-pin's budget table; `ui-refresh.json` `d050ux`). **1.00 kB under the 248.5 kB stop rule**, the room left for D-051's B+ build |
| The rework follow-up's cloud fixes (2026-10-01): the side panel's tab stops written only when they change (F-03, `PanelContent.tsx`), and the repair stage's drawer counts (C-04; `MapLayersPanel` is a lazy part, so it adds nothing to the entry) | follow-up | **+0.01** (247.51 kB) | MEASURED (dist audit, 2026-10-01, gzip level 6: `index` 235.43 + shared 11.76 + http 0.32; 247,515 B before the repair stage and 247,512 B after it, so the entry's own code is unchanged by the repair; `ui-refresh.json` `followupCloud`). **0.99 kB under the 248.5 kB stop rule** (988 B), the room left for D-051's B+ build |
| Left-panel layout B+ (D-051): `virtual.ts`'s grown-row offsets (`rowTop`, the window, the row and gap under the pointer, the reveal), `RouteList`'s grown row (its height, the DOM order, the scroll anchoring, the band and lines by `rowTop`), `StepRow`'s two-line row ("Lv n", the pips under the mark, the chain's group, the active row's place and issue block, the chain in the tooltip; less the chip and line 1's issue marker), `DifficultyPips` split from `DifficultyLabel`; the rest is CSS (not counted). Nothing on the row path can be lazy: the grown active row is painted as the app opens | B+ | **+0.51** (248.14 kB) | MEASURED (dist audit, 2026-10-02, gzip level 6: `index` 235.54 → 236.05 kB, shared 11.76 and http 0.32 kB unchanged; 247,622 → 248,136 B. In context, against a source-map build of `ff73222`: `StepRow` 2,891 → 3,042 B (+151), `virtual.ts` 686 → 887 B (+201), `RouteList` 1,963 → 2,064 B (+101), `DifficultyLabel` 446 → 417 B (−29)). Inside the mock stage's ESTIMATE of +0.45 to 0.85 kB. **Under the 248.5 kB stop rule by 0.36 kB** (364 B); no room-maker was taken |
| **Measured total** (the last MEASURED row; review UI-17) | | **246.05 kB** after MM.9 and ATL.10; **251.10 kB** with the review's fixes on 2026-09-30 13:05; **248.98 kB** after the final verification's moves; **246.82 kB** after the D-050 speed fixes; **247.50 kB** after the rework follow-up; **247.51 kB** after its cloud fixes; **247.62 kB** at `ff73222`; **248.14 kB** after B+ | MEASURED |
| **Planned before Milestone 8** (review UI-17): the pin-only exports of `map/marks` (+1.41 kB in the MP.4 row) into the lazy map chunk (**taken** in the final verification: −1.30 kB), and the quest givers' clusters (+1.11 kB) into the derived pipeline, as §25.7 first planned (still owed) | — | about −2.5; about −1.1 left | MEASURED in context (the MP.4 row) |
| Reserve: the Projects menu's content lazy (the button stays) | — | up to −4.8 | MEASURED in context (`ProjectMenu.tsx`). **Taken in UR.4** (the UR.3 to UR.6 row) |

"MEASURED in context" (`ledger/attribute.mjs`): the entry chunk was built with a source map, the bytes
of the named files were removed from it, and the rest was compressed again at gzip level 6; the
difference is what those files cost in the chunk.

**Decided now, not held in reserve:**
1. **Details becomes a lazy part** in the existing `lazy-parts` chunk, preloaded when idle (Available is
   the tab shown at start, so Details is not needed for the first paint). Without it the two plans end
   at 248.2 to 251.2 kB, past the stop rule. It is the first refresh step (UR.1a), so every later step
   has room.
2. **The drawer is a lazy part** in the same chunk, not a new dynamic import (UI.md §11, CR-19), and
   not "loaded with the map engine": `App.tsx` imports `MapFrame` statically (map-presentation §25.3.1).
3. The Quest log is a lazy part; one roving-focus helper serves the grid, `IssueList` and `Toolbar`.
4. Every UR and MP step records the dist audit here; a step that would take the entry above 248.5 kB
   stops for the reserve or the architect.

## 11. How it fits the D-045 MapGenie-style map

**Map-presentation §25 owns the map's side, and this section only points to it** (review UO-03,
UR-04):

- **The Map layers drawer** (name, 300 px width, where it docks, when it opens, the style control, the
  search and its wording, keys, persistence, loading as a lazy part): map-presentation §25.3.1 to
  §25.3.8. Revision 1's "Categories" drawer (236 px, open from a 1,600 px window, a "Filter the map"
  field, a style select in a toolbar) is withdrawn; its decision C is answered by the map's P4.
- **The map's controls** float on the map (Map layers at the top left, Map focus at the top right,
  zoom and fit at the bottom right, the caption at the bottom left): map-presentation §25.3.0.
- **The quest marks' states and glyphs** are the one table in map-presentation §25.2.3, with the
  paths in `src/map/marks.ts` (MP.2b). Rows fill the disc with the colour, pins the glyph; the
  threshold is measured on the coloured shape.
- **What this design supplies** (map-presentation §25.3.9): the kit (UR.1: buttons with the pressed
  and expanded looks, `Checkbox` with a mixed state, `SearchField`, `SegmentedControl`, focus), the
  shell's panel collapse, handles and map focus (UR.5), and the Available tab's look (UR.6).
- **The Available tab's filter** filters the tab only; the map's search is the drawer's.
- **Pop-ups** (MP.6) use §7's variants: the likely action primary, Show in Details default, Open on
  Wowhead external.

## 12. The mock

Static HTML, our own code (`.cache/ui-refresh/mock/`): `shell.html` (the whole window with the new left
panel, the Available grid, the top and status bars, and the map from the pins mock with its floating
controls and the Map layers drawer) and `specimen.html` (every button variant and state, every mark
state, revision 1's disc beside revision 2's, the step discs, and rows with a spoken name). The page
options `?e=`, `?later=`, `?f=`, `?sel=`, `?focus=1`, `?drawer=open` and `?menu=projects` draw the
decisions' options. Values are illustrative and the pages say so; the map is the pins mock's state
(Orc Warrior before step 1425), not the route in the panel.

| File | What |
|---|---|
| `shots/shell-light.png`, `shell-dark.png` | 1366×768, both panels open, the drawer closed (it would cover the map) |
| `shots/shell-drawer-light.png`, `-dark.png` | the Map layers drawer open over the map |
| `shots/shell-focus-light.png`, `-dark.png` | map focus: both panels hidden, the drawer docked |
| `shots/left-panel-2x-light.png`, `-dark.png`; `right-panel-2x-*` | the side panels at 2× |
| `shots/specimen-light.png`, `-dark.png` | buttons and marks at 1366×768 |
| `shots/specimen-forced-colours.png`, `shell-forced-colours.png` | Chrome's emulated forced colours |
| `shots/parts/` | the decision options B, E and F in both themes |
| `measure.json` | the layout numbers quoted here (no page scroll; every bar and toolbar fits at 1366 px) |
| `../rev2/sheets/` | the owner's sheets: `owner-sheet.png` (both mocks), `decision-B-*`, `decision-E-*`, `decision-F-*`, `pins-threshold.png` |

Made by `node .cache/ui-refresh/mock/shoot.mjs` (headless Chrome over the DevTools protocol, a
throwaway profile deleted afterwards) and `node .cache/ui-refresh/rev2/compose.mjs`. The stage image
comes from `node .cache/ui-refresh/pins-mock/shoot.mjs` (map-presentation §25.0). The sheets hold only
our own mocks; the review's comparison sheets, which hold benchmark screenshots, stay for the owner's
local review and are not for publication.

**Decision E's mock** (review UO-09): the shell four times, beside the minimap map: (a) cool neutrals
and system type; (b) warm neutrals; (c) a heading face for titles (the route name, the product name,
the tabs and the quest-list group names); (b) and (c) together. The face in the mock is a **stand-in**,
Constantia, a Windows system font used only in this local mock and not shippable; the candidate to
self-host is **Source Serif 4** (SIL Open Font License 1.1), one weight, Latin subset, about 30 to 60 kB
of WOFF2 (ESTIMATE), served from our own origin with `font-display: swap` and a licence entry. A font
loads as a separate asset and adds nothing to the JavaScript entry chunk.

## 13. Comparison with WoWF-QRP

"Beats" means better for planning routes under this project's rules, not better looking.

| Aspect | WoWF-QRP (HEAD, OBSERVED) | Ours today | This design | Verdict |
|---|---|---|---|---|
| "!" and "?" on the left | 22 px gold disc with a dark glyph; kinds by fill colour | 16 px grey card glyph (+ or ✓) | 22 px disc in the difficulty colour with a dark "!"/"?" and keyline, pips beside; states by dash and badges; kinds by glyph on neutral discs | matches the look (a yellow disc for a difficult quest); beats on meaning; falls short on at-a-glance kind colour |
| Row content | the verb, title, "NPC · zone x, y", XP over level | one line, title cut at 15-20 characters, one estimate | two lines, the verb first, 28-30 characters, NPC · zone, XP over level with basis markers, "↑" level-ups, quiet zeros | matches; beats on basis |
| Row height and scale | 32 to 102 px, not virtualised | fixed 28 px, virtualised | fixed 40 px (or 28), virtualised | beats on scale (10,000 steps) |
| Visible rows at 340 × 690 px | about 7 to 14 | 19 | 13 (19 compact) | matches WoWF-QRP; falls short of our compact list, by choice |
| Problems in the row | red or orange line with fix links | count marker only | the worst issue's shape and words on line 2; fixes one Enter away in Details | matches the display; falls short on one-click fixes |
| Insertion point | "New steps are added here" | none shown | dashed line with caret; "Add after step 12" | matches |
| Later steps | 62 % opacity | no | a band under them (recommended) | matches the look without the contrast cost |
| Row buttons | six at 55 % opacity, title column 77 px | two on hover, squeezing the title | three on every row, muted, on line 2 (recommended); all in the toolbar with keys | matches; beats on title room and access |
| Many selected | a bar with Up, Down, Move after, Delete, Clear | toolbar | toolbar with Move up and down | matches |
| Footer | Add grind, Add travel or note, Hearth → place, Die, Train, Buy, Add custom quest, Undo (three rows) | Note, Travel, Grind in the toolbar | Grind, Travel, Hearth, Train, Buy, Note, with the place named | matches, except Die and the named hearth |
| Route picker | a select with New in the left header | a crumb and Projects in the top bar | the route name opens Projects, with New | matches |
| Available | zone groups by distance, Unlocks soon, Low level, Accept, Needs + Accept | flat list by level, ⓘ and +, no state | MP.3's groups and states; marks; Accept and "Needs … Accept first"; one tab stop | matches; beats on keyboard and cues |
| Quest log | Done, Turn in, ○/✓, done here, "(2/40)" | placeholder | the same with pie badges and "4 / 40" with basis | matches; beats on the cue and basis |
| Buttons | gold primary, 33 px filled chips, edges about 1.5:1, no disabled style, blue Wowhead | indigo primary, 26 px, three variants | filled tile 28/24 px, one primary per context, danger, pressed, expanded, link, external, segmented; edges 3.20:1 or more | matches the roles and the filled look; beats on access; differs in colour (no gold) |
| Top bar | brand, search, zone, character → Settings, About, Theme, Import/Export | name, crumb, Sample, search, zone and Go, Import, Export, Settings, theme, About, Projects, saved | brand, search, zone or view and Go, character → Settings, Import, Export, theme, About, saved | matches |
| Footer or status bar | 59 px: level "after step N", XP bar with 20 ticks, group, route end | 32 px: level and bar, step, time, XP, XP/h, Summary, badges | 32 px: "Lv 4 after step 12", 12 px bar with 20 ticks, time, XP/h, "In log 4 / 40", Summary, badges | matches the content; smaller on purpose |
| Tabs | four equal, 40 px, gold underline, no arrows or panel | four, 32 px, arrows, panel | four across the strip, 36 px, accent underline, arrows, panel | matches; beats on keyboard |
| Resizing and collapsing | both panels, 240 px to 55 %, pointer only | left only, 320-380 px, keys | both, 300-460 px, keys; both collapse; map focus | beats on access; matches MapGenie's collapse |
| Type and palette | Alegreya Sans and Marcellus (web fonts), warm browns and gold | system UI, cool greys, indigo | decision E: warm neutrals recommended, a self-hosted heading face offered; no gold | closer on warmth if the owner agrees; still no gold |
| Contrast | dark passes; light fails for difficulty text and warnings | passes | passes, every new pair computed, in both palettes of decision E | beats |

## 14. Step plan (the combined order with the map build)

Every step ends green on `pnpm check`, records the dist audit's entry size in the ledger (§10.3), and
edits no file the map build owns until that team hands it over. The shared test files have one owner
at a time: `tests/architecture.test.ts` only the map team (MP.2b); `tests/ui-tokens.test.ts` the map
team's MP.2, then UR.1, then MP.4a (review UR-07).

The State column was added on 2026-09-28, after the map build's MM.9 and ATL.10: every built step is in
the working tree and not committed, and its figures are in the ledger (§10.3).

| Order | Step | Team | Files | Tests and gates | Depends on | State (2026-09-28) |
|---|---|---|---|---|---|---|
| 1 | **UR.0 with MP.0** | architect | DECISIONS: D-047 (map revision 3.1, including the 11 px measure) and D-048 (this design's defaults); UI.md amendments (§16); STATUS rows for A, B, D, E, F and P1 to P4 | review of the amendment texts | — | Done: D-047, D-048 |
| 2 | **UR.0b with MP.0b-3** | owner | One review: `rev2/sheets/owner-sheet.png`, the B, E and F sheets, `pins-threshold.png` and the pin sheet; his answers recorded | the answers in STATUS and DECISIONS | 1 | Done: the owner took A, B, D, E, F and P1 to P4 |
| 3 | MP.0c (rest), MP.1, MP.2 | map | map-presentation §25.8 | its own | 2 | Built |
| 4 | **MP.2b** | map | `src/map/marks.ts`, the `map/marks` rule in `tests/architecture.test.ts` and `tsconfig.pure.json`, the re-export in `src/app/map-exports.ts` | `marks.test.ts` | MP.2 | Built |
| 5 | **UR.1a** | refresh | `app/lazy-parts.ts`, `app/AppSidePanel.tsx` (Details through the lazy boundary, preloaded when idle) | `lazy.test.tsx` (Details chunk, idle preload, the loading state); the ledger's first row | 2 | Built (−5.17 kB) |
| 6 | **UR.1** | refresh | `src/ui/styles/tokens.css` (after MP.2), `primitives/Button.tsx` (default, `secondary` as its alias, primary, danger, ghost, link; `pressed`, expanded look), new `ExternalLink.tsx`, `SegmentedControl.tsx`, `SearchField.tsx`, `Checkbox.tsx` mixed state, `Icon.tsx` (undo, redo, up, down, left, right, external, layers, map focus), `primitives.css`, `base.css` | `tests/ui-tokens.test.ts` (§9.5's pairs including the hover edge, `danger` hue, control and tab heights, forced-colours rules), `primitives.test.tsx` (variants, pressed and expanded names, the alias, `rel` and hidden words of external links, the mixed checkbox), a `SegmentedControl` test; **by hand**: UI.md §6's widths in both themes with 24 and 28 px controls, including today's map toolbar and layer panel until MP.4b removes them | MP.2, UR.1a | Built |
| 7 | **UR.2** | refresh | new `markers/QuestMark.tsx`, `StepMark` (beside `StepTypeGlyph`), `markers.css`, `kit.ts` | `markers.test.tsx`: each state of map-presentation §25.2.3 (the dashed ring, badge kinds in the top-right slot, the pie fraction), colour only when filled with a known difficulty, the paths identical to the module's, never a triangle; the difficulty-token reader allowlist names `QuestMark`; forced-colours rules | MP.2b, UR.1 | Built |
| 8 | **UR.2b** | refresh | none (a measurement) | **PERF-11's browser baseline** on the unchanged tree and the 10,000-step project: a selection change and a re-walk publish, recorded in `docs/measurements/` (review UR-10) | 2 | Measured (`ur2bRouteListBaseline`) |
| 9 | MP.3 | map | quest state, Available content, spans | its own | MP.1, MP.2 | Built |
| 10 | **UR.3** | refresh | `route/rows.ts` (mark state, issue line, level-up, the verb, density), `route/virtual.ts` (`ROUTE_ROW_HEIGHT_TWO_LINE`), `route/RouteList.tsx` (row height by density, insertion line, the later band, number as handle), `route/StepRow.tsx` (two lines, compact, the quiet zero, `describeStepRow`), `route/RouteList.css`, `app/derived-view.ts` (`createRowDeriver`, `sameDerivedRow`, the line-2 cache by view, geometry and step) | `StepRow.test.tsx`, `RouteList.test.tsx` (both densities: window, drag, auto-scroll, paging, the insertion line and band), `RouteList.memo.test.tsx` (one changed row re-renders one row; a selection change re-renders at most two; the line and band move without row renders; a view change refreshes line 2), `virtual.test.ts`, `derived-view.test.ts`, `ui-tokens` (both row-height tokens); **PERF-11's browser measure against UR.2b's baseline, both densities, no regression beyond 10 %** | UR.2, UR.2b, MP.3 | Built (UR.3 to UR.6 together; `ur3RouteListMeasure`) |
| 11 | **UR.4** | refresh | `app/RoutePanel.tsx` (the route-name menu, meta, View, step toolbar with Move up and down, the Add footer with Hearth, Train and Buy, row actions per decision F), `app/ProjectMenu.tsx` (opened from the name; destructive items to the danger variant), `app/route-actions.ts` (`insertHearth`, `insertTrain`, `insertBuy`), `src/app/commands.ts` only if a helper is needed over `insertStep`, `App.css`, the settings store (density) | `panels.test.tsx`, `editing.test.tsx` (Hearth, Train and Buy insert after the selection and announce; Move up and down), `ProjectMenu.test.tsx` (opened from the name, focus returns), `App.test.tsx` (the sample notice), keyboard; by hand at 1366×768, 1024×768 and 800×700 | UR.3 | Built |
| 12 | **UR.5** | refresh | `shell/TopBar.*`, `app/AppTopBar.tsx` (character button; crumb and Projects moved; the zone-or-view select), `shell/StatusBar.*`, `shell/XpBar.tsx` (ticks), `app/AppStatusBar.tsx` ("after step N", "In log"), `shell/AppShell.*` (the right separator, the wider ranges, **collapse, handles, map focus and Alt+M**, their settings) | `TopBar.test.tsx`, `StatusBar.layout.test.tsx`, `shell.test.tsx` (collapse by handle, separator and Alt+M; focus moves; state kept), `useShortcuts.test.ts`; by hand, UI.md §6's widths and the "page never scrolls" check with panels collapsed | UR.1 | Built |
| 13 | **UR.6** | refresh | `shell/Tabs.*`, `shell/SidePanel.*`, `shell/PanelContent.tsx` (`QuestListItem`, the grid, group headers that take focus), `app/AvailableQuests.tsx` (**after MP.3**, one owner at a time; Accept first after the prerequisite), new `app/QuestLogPanel.tsx` (lazy, `lazy-parts.ts`), `app/QuestDetails.tsx` (state primary, Add all three, Open on Wowhead), `app/StepDetails.tsx` (Delete as danger) | `SidePanel.test.tsx`, `Tabs.test.tsx` (the Quest log name), `panels.test.tsx` (grid keys, headers in the order, one tab stop, names, sticky headers with scroll padding), `lazy.test.tsx` (Quest log chunk), `derived-view.test.ts` (log rows, objectives, capacity basis) | UR.1, UR.2, MP.3 | Built |
| 14 | MP.4a, then **MP.4b** (the drawer and floating controls; UR.7 is folded in), MP.4c | map | map-presentation §25.8 | its own | MP.4b after UR.1 and UR.5 | Built |
| 15 | MP.5 to MP.11 | map | map-presentation §25.8 | its own | | Built |
| 16 | **UR.8 with MP.12** | reviewers | Review: an independent critique (accessibility, performance, the owner's view); a browser check against the mocks at UI.md §6's widths in both themes, with panels collapsed and in map focus, and in a Windows contrast theme; the shared ledger | screenshots beside the mocks; the dist audit; axe when Milestone 9 brings it | all | Measurement part done 2026-09-28 (`ui-refresh.json` `ur8`: the route list against UR.2b in both densities, the entry chunk at 246.05 kB, `.cache/map-ui-build/ui-compare.jpg`); the review is owed |

Folded in on the way (`ours.md` §5): `StepEditors.tsx`'s "unknown until simulation, Milestone 6" and the
Quest log tab's "arrives in Milestone 6" texts (UR.6), the doubled full stop in row names (UR.3), and
the missing pressed style for text buttons (UR.1).

If the owner chooses differently at step 2, the steps change only in UR.3 and UR.4 (density, band,
row actions) and UR.1 (decision E's tokens, and a font file with its licence entry for (c)).

## 15. Risks

| # | Risk | Mitigation |
|---|---|---|
| R1 | Fewer visible rows (13 against 19) slow long-route editing | the one-line density in View, kept per browser; the chrome above the list cut from 168 to 78 px; map focus and collapse give room back to whichever side needs it; owner decision A |
| R2 | The entry chunk overflows | one ledger for both plans; Details and the drawer lazy now; the Projects menu in reserve; a 248.5 kB stop rule per step (§10.3) |
| R3 | New row fields break PERF-11 memoisation | `sameDerivedRow` compares them; memo tests count renders; the band is one element; the line-2 cache keyed by view, geometry and step; a browser baseline first (UR.2b) |
| R4 | Difficulty colours spread beyond their component | `QuestMark` built on `DifficultyLabel`'s rating; the test allowlist of readers of `--frl-difficulty-*` |
| R5 | A yellow disc on white loses its edge | the well keyline (15.36:1 or more on light rows); the pips beside |
| R6 | Longer spoken row names | fixed order (number, kind and state, title, detail, difficulty, estimates, issues); checked with a screen reader in UR.8 |
| R7 | Conflicts with the map build (`tokens.css`, the shared tests, `AvailableQuests.tsx`, `MapFrame`, the marks module) | the combined order (§14): MP.2 before UR.1, MP.2b before UR.2, MP.3 before UR.3 and UR.6, UR.1 and UR.5 before MP.4b; `secondary` kept as an alias until MP.4b |
| R8 | The layout grid is unfamiliar to some screen-reader users | the APG pattern, headers in the order, keys in the grid's description, the Details path for everything |
| R9 | 28 and 24 px controls crowd tight bars (top bar at 1024-1200 px, the status bar) | widths unchanged; UI.md §6's widths checked by hand in UR.1 and UR.5 |
| R10 | The owner judges the heading face by a stand-in | the sheet says so; UR.1 re-shoots with the real file before it ships, if (c) is chosen |
| R11 | A yellow "!" on a disc reads like the game's own mark | it is only ever the difficulty yellow, for difficult quests (D-041 G, D-046); our own paths; no game icons (D-039 A) |
| R12 | Alt+M collides with a browser, assistive technology or keyboard layout | read from `KeyboardEvent.code`; ignored in text fields; checked in UR.5; the button and the handles are always there |
| R13 | Always-visible row buttons (F (b)) invite stray deletes | Delete is undoable (Ctrl+Z) and announced; the buttons are muted until the row is hovered or active |
| R14 | The dark theme's later band is faint | the insertion line carries the boundary; the owner sees the dark sheet before choosing B |

## 16. Edits elsewhere (for their owners)

- **DECISIONS:** D-048 for this design's defaults (two-line rows, the verb, quiet zeros, the filled
  disc, the button kit and tokens, the later band, row actions, the Projects menu on the route name,
  collapsible panels and map focus, the layout grids with headers in the order, the Quest log tab,
  Details lazy, the shared ledger), and one entry per owner decision A, B, D, E and F once taken. D-047
  (map-presentation) carries the 11 px measure, the state table and the drawer. D-046's "Design" line
  points to this file.
- **UI.md §1:** principle 1 per D-046 (the layout and affordances may follow WoWF-QRP; the glyphs and
  code stay ours; the palette per decision E; the "!" and "?" are our own glyphs).
- **UI.md §3:** §3.1 `--frl-tile`, `--frl-tile-hover`, `--frl-danger`, `--frl-danger-bg-hover`,
  `--frl-surface-later`, `--frl-xp-tick`; §3.2 "on or under the well" (the disc takes the colour under
  the well glyph); §3.3 `--frl-control-height` 28, `-sm` 24, `--frl-tab-height` 36,
  `--frl-row-height-two-line` 40, `--frl-radius-control` 6, `--frl-mark-size` 22 and `-compact` 18;
  the note that `ROUTE_ROW_HEIGHT_TWO_LINE` equals its token; and, if decision E is (b) or (c), the
  warm values or the font.
- **UI.md §4:** rows for quest-mark difficulty (through `QuestMark` and the map twin, built on
  `DifficultyLabel`), the mark states and their cues (citing map-presentation §25.2.3), the step kind
  (neutral disc glyph, and one symbol per concept with the map), destructive actions (`--frl-danger`,
  the error hue by design), the level-up arrow, the later band (decorative).
- **UI.md §5:** two-line rows of 40 px by default and one-line rows of 28 px; the verb first; controls
  28 and 24 px.
- **UI.md §6:** the left panel's parts; tabs across the strip; both separators, their ranges, Enter to
  collapse; the handles and map focus; "In log" in the width steps; the character button's steps; the
  map region's floating controls and drawer (map-presentation §25.3); the "checked by hand" list with
  collapsed panels.
- **UI.md §7:** `QuestMark`, `StepMark`, `SegmentedControl`, `ExternalLink`, `Checkbox` (mixed),
  `SearchField`, the Button variants with `pressed` and the expanded look, `QuestLogPanel`, the
  quest-list grid.
- **UI.md §8:** row heights by density, the two lines' contents, the verb, quiet zeros, the number as
  the handle, the insertion line and the band, row actions on line 2 on a backplate, Move up and Move
  down in the toolbar.
- **UI.md §9:** rule 4 (layout grids for quest lists, headers in the order); a rule for pressed and
  expanded text buttons; target size 24 px; focus not hidden by sticky headers or collapsed panels;
  rule 9's new forced-colours fallbacks; the Alt+M shortcut.
- **UI.md §11:** the density, collapse and map-focus preferences in the settings store; Details, the
  Quest log and the drawer as lazy parts with measured sizes.
- **UI.md §12** (with map-presentation): the drawer and floating controls replacing the layer panel,
  toolbar and status line.
- **UI.md §14:** Adding quests (Accept, Accept first, Objectives done, Done here, Turn in; Add all three
  in Details; Hearth, Train and Buy).
- **UI.md §16:** the status bar's "after step N" and "In log".
- **`tests/ui-tokens.test.ts`:** §9.5's pairs; `danger` in the hue checks; both row-height tokens; the
  control and tab heights; the forced-colours rules; the allowlist for `--frl-difficulty-*`.
- **ARCHITECTURE §12.4:** "one-line rows" becomes "fixed-height rows of one or two lines".
- **STATUS:** owner-decision rows for A, B, D, E and F (next free OD numbers); "Exact next tasks" with
  §14's combined order; the entry-chunk baseline of 246.19 kB on the working tree.
- **research/ux-benchmark.md:** a pointer to this file.
- **THIRD_PARTY_NOTICES:** nothing (no code is ported); a font entry only if decision E is (c).

## 17. Decisions for the owner

Until he answers, the design runs on the recommendations. `rev2/sheets/` holds a sheet for each.

**A. Default row density.** (a) **Two lines, 40 px** (13 rows at 1366×768): the WoWF-QRP reading,
with the verb, NPC and zone, XP and level, and the issue in words; one line stays a View choice.
(b) One line, 28 px (19 rows), with two lines as the choice. **Recommendation: (a).**

**B. The steps after the selected one** (`decision-B-*.png`, step 6 selected). (a) Not marked: the
insertion line, "after step 12" and the map's faint route carry the "now". (b) 62 % opacity, as
WoWF-QRP: line 2 falls below 4.5:1 and every row re-renders on each selection change. (c) The marks
alone dimmed: text keeps its contrast, but rows still re-render. (d) **A band under the later steps**:
every text pair 4.5:1 or more, one element, no row re-renders; faint in the dark theme.
**Recommendation: (d).**

**C.** *Answered by map-presentation's P4* (the Map layers drawer's place and when it opens), so there
is one question, not two.

**D. The character button.** (a) **"Orc Warrior · Horde" opens Settings**, replacing the word
"Settings" (WoWF-QRP's way, and it shows the character, which the top bar does not today); (b) keep
"Settings" and add the character as text. **Recommendation: (a).**

**E. Warmth and typefaces** (`decision-E-*.png`, beside the minimap map). WoWF-QRP's feel owes much to
its warm browns, its gold and its two web fonts. Gold stays out (it sits 11° to 16.5° from difficulty
yellow), and nothing may be fetched from another site (UI.md §3.3). (a) Cool neutrals and the system
typeface, as today. (b) **Warm neutral surfaces**: low saturation (channels within 6 %), never parchment
or gold; accent, severity, difficulty and provenance colours unchanged; every pair passes (§9.5).
(c) A self-hosted, openly licensed face for titles only (candidate Source Serif 4, SIL OFL 1.1; about
30 to 60 kB of font, a licence entry, no JavaScript); the mock shows a stand-in. (b) and (c) combine.
**Recommendation: (b)**: it brings the refresh closer to the look the owner pointed at for the cost of
token values, and the difficulty colours still sit on near-neutral ground. (c) is a matter of taste
with a small cost, offered for him to judge.

**F. Row buttons** (`decision-F-*.png`; D-046's "inline action buttons"). (a) On hover and on the
active row, as revision 1 designed. (b) **On every row, muted**, as WoWF-QRP shows them; the list's
keys do not change. (c) Real buttons in a grid, each reachable by Tab and arrows; every list key
changes. **Recommendation: (b).** In every option the toolbar and the keys remain the keyboard path,
and the route name opens the Projects menu, with New (WoWF-QRP's route picker).

Architect defaults, which the owner may overrule: MP.3 owns the Available tab's content and this design
its look and keys (one owner of `AvailableQuests.tsx` at a time, MP.3 first); the Quest log is built
here, as a lazy part; Details becomes lazy now; Alt+M for map focus; the handles on the map's edges.

## 18. Sources

- WoWF-QRP: https://github.com/tyba-dev/WoWF-QRP at `96f602b24ca9200855c27d6e31eb5a7e420aebf8`
  (`src/shell_head.html`, `src/app.js`, fetched one raw file at a time for revision 1, read for
  behaviour and layout only; saved in `.cache/ui-refresh/friend/src-96f602b/`), and the saved
  screenshots of https://tyba-dev.github.io/WoWF-QRP/ at `378bed9e`
  (`.cache/map-presentation/friend/shots/`). Licence as in D-029. The site was not visited, and nothing
  was fetched for revision 2.
- MapGenie: the saved screenshots and notes of map-presentation.md §3.2
  (`.cache/map-presentation/mapgenie/shots/`), observed 2026-09-26. The site was not visited.
- The review: [docs/reviews/review-ui-refresh-design.md](../reviews/review-ui-refresh-design.md), with
  `.cache/ui-refresh/critic/` and `.cache/ui-refresh/critic-rules/`.
- Our build: `.cache/ui-refresh/ours.md` and `shots/`, 2026-09-27; the entry chunk in
  `.cache/ui-refresh/ledger/`.
- WCAG 2.2 (contrast, 1.4.11, 2.4.11, 2.5.3, 2.5.8) and the WAI-ARIA Authoring Practices' layout grid,
  toolbar, menu button and window splitter patterns.
- Source Serif 4 is named as a candidate only; nothing was downloaded.

## 19. Revision 2: what changed, and the finding behind it

| Finding | Change | Where |
|---|---|---|
| UO-01 | The disc takes the difficulty colour; well glyph and keyline; pips beside | §5.1, §9.5 |
| UO-02 | Collapsible panels, handles, map focus (Alt+M); the map's controls float (map §25.3.0) | §4.3, §9.3 |
| UO-03, UR-04 | One drawer spec, the map's; §11 is a pointer; decision C folded into P4 | §11, §17 |
| UO-04, UR-01 | The 11 px measured on the coloured shape; row marks always coloured; pins from *D* 16 (map) | §5.1 |
| UO-05, UO-06 | The map's (§25.4) | — |
| UO-07 | The verb first in line 1 | §6.1, §6.2 |
| UO-08 | Decision B's option (d), the band, recommended and mocked | §6.4, §17 |
| UO-09 | Decision E mocked side by side beside the minimap map; (b) recommended | §12, §17 |
| UO-10 | Train and Buy in the Add footer | §4.1, §7.3 |
| UO-11 | "Accept first" right after "Needs <prerequisite>" | §5.4 |
| UO-12, UR-08 | Decision F with three options mocked; the route name opens Projects | §4.1, §6.5, §17 |
| UO-13 | A darker tile: 1.30:1 and 1.20:1 | §7.1, §9.5 |
| UO-14 | A known zero muted and regular | §6.1 |
| UR-02 | The hover edge becomes the muted ink (5.32 and 5.63:1); the pair tested | §7.1, §9.5 |
| UR-03 | One path set and state table (map §25.2.2, §25.2.3); top-right badges; the pie | §5.1 |
| UR-05 | One ledger, re-measured; Details and the drawer lazy now | §10.3 |
| UR-06 | The map's (§25.7) | — |
| UR-07 | The combined order; `secondary` kept as an alias; shared tests sequenced; UR.7 folded into MP.4b | §7.1, §14 |
| UR-09 | Revision 1's "!" withdrawn; the construction recorded (map §25.2.2) | §1 |
| UR-10 | UR.2b's browser baseline; the line-2 cache keyed by view, geometry and step | §10.1, §14 |
| UR-11 | The Quest log tab's name; grid headers take focus; backplates for row actions; drawer rows, keys, the ring and pins under forced colours are the map's | §4.2, §6.5, §9 |
| UR-12 | One symbol per concept (the map's pins take the rows' glyphs) | §5.1 |
| UR-13 | The tile's hue distance stated exactly (27.3° and 32.8°) | §9.5 |
