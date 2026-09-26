# UI

The visual system and component kit of Forever Route Lab: tokens, reserved hues, typography,
density, layout, the component inventory, accessibility rules, and how to add a component.
Authoritative for everything under `src/ui/` except `src/ui/App.tsx`, which wires the kit to the
store. Related: [ARCHITECTURE.md](ARCHITECTURE.md) §12.4 (layout and visual rules), §4
(dependency rules).

## 1. Principles

1. **Original.** The product is "Forever Route Lab". The information architecture follows common
   route-planner practice: a dense numbered route list on the left, a large map in the centre,
   quests and details on the right, a toolbar at the top and a status bar at the bottom. No name,
   branding, parchment or gold look, icons or assets are taken from any other planner or from the
   game. Every icon and glyph here is an original inline SVG.
2. **Dense and desktop-first.** 13px interface text, 28px one-line route rows, 26px controls. The
   layout degrades in steps below 1280px and stacks below 720px.
3. **Meaning is never carried by colour alone.** Every coloured signal also has a shape, a glyph
   or text, and a spoken form.
4. **Reserved hues mean one thing each.** The five difficulty colours mean quest difficulty and
   nothing else. Cyan means Forever provenance and nothing else.
5. **Unknown stays unknown.** An unknown number renders as `?` with its reason (tooltip and
   screen-reader text), never as `0` or an empty bar. Lower bounds read `≥`. Numbers that depend
   on assumptions carry the assumed marker.
6. **Presentational.** Components take typed props and callbacks. They never read the store,
   the dataset or IndexedDB, and they import only *types* from pure modules (`domain`, `rules`).
   The few pure values the kit needs (the difficulty labels) come re-exported through `app`
   (`src/app/rules-exports.ts`), never copied.

## 2. Styles

| File | Contents |
|---|---|
| `src/ui/styles/tokens.css` | Every design token, both themes |
| `src/ui/styles/base.css` | Reset, document typography, focus ring, reduced motion, utilities (`frl-visually-hidden`, `frl-num`) |
| `src/ui/**/<Component>.css` or `<area>.css` | Component styles, next to the component and imported by it |

- **Convention: plain CSS with BEM-like class names under an `frl-` prefix**, not CSS modules:
  `frl-<block>`, `frl-<block>__<element>`, `frl-<block>--<modifier>`, and `is-<state>` for
  runtime states (`is-selected`, `is-active`, `is-locked`, `is-dragging`). Plain classes keep
  selectors stable for tests and theming, and avoid `string | undefined` class maps under
  `noUncheckedIndexedAccess`. The prefix is the scope.
- Components use tokens only (`var(--frl-…)`), never raw colours. The exceptions are
  `tokens.css` itself and the CSS system colours (`Highlight`, `Canvas`, `CanvasText`,
  `GrayText`) inside `@media (forced-colors: active)` blocks (§9 rule 9).
  `tests/ui-tokens.test.ts` fails on any `var(--frl-…)` that no stylesheet defines.
- Colours for SVG parts are set from CSS classes, not from `fill="var(…)"` attributes.
- Load order: `tokens.css`, `base.css`, then component styles. `AppShell` imports the first two,
  so any page that renders the shell has them; the entry point may import them first as well
  (Vite deduplicates).

### 2.1 Themes

Light is the default. Dark applies when the operating system prefers dark and `data-theme` does
not force light, or wherever `data-theme="dark"` is set (on `<html>` or on any subtree).
`data-theme="light"` forces light. `lib/theme.ts` has `applyThemePreference(root, pref)` for
`'system' | 'light' | 'dark'` (system removes the attribute) and `nextThemePreference` for the
toggle. Persisting the preference belongs to the app's settings store.

`tokens.css` holds the dark values twice (the `prefers-color-scheme` block and the forced
block). `tests/ui-tokens.test.ts` parses the file and fails if it has any block but the four
documented ones (theme-independent `:root`, light, the two dark), if the two dark blocks differ,
if the light and dark token names differ, or if a theme block redefines a theme-independent
token.

## 3. Tokens

### 3.1 Colour (theme-dependent)

| Token | Light | Dark | Purpose |
|---|---|---|---|
| `--frl-bg` | `#dfe3e9` | `#0b0d11` | App backdrop; shows as 1px gutters between panels |
| `--frl-surface` | `#ffffff` | `#151920` | Panel and row background |
| `--frl-surface-raised` | `#f5f6f8` | `#1b2029` | Top bar, panel headers, tab strip, status bar, group rows |
| `--frl-surface-hover` | `#eceff3` | `#232a35` | Row and button hover |
| `--frl-surface-sunken` | `#e9ecf0` | `#11151b` | Map area |
| `--frl-border` | `#d5dae1` | `#2a313c` | Hairlines and row separators (decorative) |
| `--frl-border-strong` | `#737d8b` | `#707c8e` | Control edges and the dashed edge of an uncertain difficulty chip (3:1 on every surface, hovered row and selected row, and against the difficulty well) |
| `--frl-fg` | `#14181e` | `#e5e8ed` | Primary text |
| `--frl-fg-muted` | `#4b5563` | `#a7b0bd` | Secondary text, labels, glyphs |
| `--frl-fg-subtle` | `#5f6978` | `#8d97a5` | Tertiary text: step numbers, details (still 4.5:1) |
| `--frl-fg-disabled` | `#9aa2ad` | `#58616e` | Disabled controls only (exempt from contrast) |
| `--frl-accent` | `#3a4fc4` | `#8ea2ff` | Interactive accent: primary buttons, links, selected tab, brand mark |
| `--frl-accent-hover` | `#2e40a8` | `#a9b8ff` | Hover of the above |
| `--frl-accent-fg` | `#ffffff` | `#0d1014` | Text on accent |
| `--frl-focus` | `#3a4fc4` | `#8ea2ff` | Focus ring |
| `--frl-selection-bg` | `#e3e8fb` | `#1f2a52` | Selected rows, pressed toggles, text selection |
| `--frl-selection-bar` | `#3a4fc4` | `#8ea2ff` | 3px left bar on selected rows (the non-colour cue is the bar) |
| `--frl-drop-indicator` | `#3a4fc4` | `#8ea2ff` | Drag-and-drop insertion line |
| `--frl-severity-error` | `#b0157f` | `#ff7ac8` | Error (magenta) |
| `--frl-severity-warning` | `#7a3fc2` | `#c3a2ff` | Warning (violet) |
| `--frl-severity-info` | `#2560b0` | `#7fb0ff` | Info (blue) |
| `--frl-forever` | `#006d7d` | `#3ccfe0` | **Reserved:** Forever provenance glyphs and text |
| `--frl-forever-bg` | `#e0f3f6` | `#0f2f35` | Background of the full provenance badge |
| `--frl-assumed` | `#5f6978` | `#a7b0bd` | Assumed and Era-fallback markers (neutral on purpose) |
| `--frl-xp-track` | `#dde2ea` | `#262d38` | XP and progress bar track |
| `--frl-xp-fill` | `#3a4fc4` | `#8ea2ff` | XP and progress bar fill |
| `--frl-xp-hatch` | accent at 35% | accent at 35% | Lower-bound hatching beyond the known XP (supplementary: the notch and `≥` carry the lower bound) |
| `--frl-unknown-hatch` | `#737d8b` | `#707c8e` | Hatching of unknown bars: unknown XP, and indeterminate progress under reduced motion (3:1 on the track, so an unknown bar never passes for an empty one) |
| `--frl-placeholder-stripe` | ink at 6% | ink at 5% | Hatching of the Placeholder label (decorative: the dashed edge and the word carry it) |
| `--frl-map-grid` | ink at 8% | ink at 7% | Grid of the map placeholder |
| `--frl-map-frame` | `#6b7482` | `#7a8699` | Zone-frame and extent outlines on the map canvas and in the map key, at full opacity (3:1 or more on `--frl-surface-sunken` and on `--frl-surface`, the frames' fill: 3.99 and 4.72 light, 4.97 and 4.78 dark; WCAG 1.4.11, M3 review MAP-A11Y-6). The canvas reads it as the `frame` role (MAPS.md §7.5) |
| `--frl-overlay` | ink at 45% | black at 60% | Dialog backdrop |
| `--frl-shadow` | soft | deeper | Floating cards and dialogs |
| `--frl-difficulty-well-border` | `#101216` | `#3a4350` | Edge of the difficulty chip |

### 3.2 Colour (theme-independent)

| Token | Value | Purpose |
|---|---|---|
| `--frl-difficulty-trivial` | `#808080` | **Reserved:** trivial (grey) |
| `--frl-difficulty-standard` | `#40bf40` | **Reserved:** standard (green) |
| `--frl-difficulty-difficult` | `#ffff00` | **Reserved:** difficult (yellow) |
| `--frl-difficulty-verydifficult` | `#ff8040` | **Reserved:** very difficult (orange) |
| `--frl-difficulty-impossible` | `#ff1a1a` | **Reserved:** impossible (red) |
| `--frl-difficulty-well` | `#101216` | Dark chip behind difficulty colours, in both themes |
| `--frl-difficulty-pip-off` | `#2a3039` | Unlit difficulty pips (every lit pip reaches 3:1 against it) |
| `--frl-difficulty-unknown` | `#c9ced6` | Level text when difficulty is unknown (not a difficulty) |

The five difficulty values **mirror `DIFFICULTY_COLORS` in `src/rules/difficulty.ts`** (the
Era client's `QuestDifficultyColors`, SIMULATION.md COL-1). A stylesheet cannot import a
TypeScript constant, so the values are written out here, and `tests/ui-tokens.test.ts` (a
cross-module test, free of the §4 import rules) compares them with `DIFFICULTY_COLORS`, case
aside, and fails on any mismatch. Change both files together. The test also fails if a theme
block redefines a difficulty colour or if a new `--frl-difficulty-*` token appears. The
difficulty *words* are not duplicated: `DifficultyLabel` uses the rules module's
`DIFFICULTY_LABELS`, re-exported through `src/app/rules-exports.ts` (the kit's `DIFFICULTY_TEXT`
is the same object, kept for the kit's export list).

### 3.3 Type, space, size, motion

| Token | Value | Purpose |
|---|---|---|
| `--frl-font-ui` | system UI stack | All interface text. No web fonts: nothing is fetched from another origin |
| `--frl-font-mono` | system monospace stack | Issue codes, commit hashes |
| `--frl-text-xs` / `-sm` / `--frl-text` / `-lg` | 11 / 12 / 13 / 15px | Badges and small caps / secondary / **interface default** / titles |
| `--frl-leading` / `-tight` | 18 / 16px | Line heights |
| `--frl-weight-regular` / `-medium` / `-bold` | 400 / 500 / 650 | |
| `--frl-space-half`, `--frl-space-1` … `-6` | 2, 4, 8, 12, 16, 24, 32px | 4px grid with a 2px half step |
| `--frl-row-height` | 28px | Route rows (fixed; the virtualiser relies on it) |
| `--frl-control-height` / `-sm` | 26 / 22px | Buttons, inputs, selects / small buttons and in-row affordances |
| `--frl-topbar-height`, `--frl-statusbar-height` | 44px, 32px | Shell bars |
| `--frl-tab-height`, `--frl-panel-header-height` | 32px, 32px | Tab strip, panel headers |
| `--frl-left-width`, `--frl-right-width` | 340px, 340px | Route panel (320-380px, set by `AppShell`), side panel |
| `--frl-gap` | 1px | Panel gutters |
| `--frl-radius-sm` / `--frl-radius` / `-lg` | 3 / 4 / 8px | Badges / controls / cards and dialogs |
| `--frl-focus-width` | 2px | Focus ring width |
| `--frl-duration-fast` / `--frl-duration` / `--frl-ease` | 90 / 140ms, ease-out | Transitions; 0 under reduced motion |
| `--frl-z-sticky` / `--frl-z-drag` | 10 / 20 | Splitter / drop line |

`ROUTE_ROW_HEIGHT` in `src/ui/route/virtual.ts` must equal `--frl-row-height`;
`tests/ui-tokens.test.ts` checks it.

## 4. Reserved and semantic signals

| Signal | Colour | Non-colour cue | Text |
|---|---|---|---|
| Quest difficulty | the five reserved colours, on the dark difficulty well | 1-5 filled pips (trivial 1 … impossible 5): 2px bars with 1px gaps on whole pixels, crisp edges, lit 3:1 against unlit | "Difficult (yellow)" in the tooltip and screen-reader text; visible word in `full` variant |
| Difficulty from a lower-bound level | same | dashed chip edge in `--frl-border-strong` (3:1 on every row state) | "…from a lower-bound level: may be easier" |
| New in Forever | cyan | ◆ glyph | "New in Forever (per the dataset)" |
| Changed in Forever | cyan | ◇ glyph | "Changed in Forever (per the dataset)" |
| …declared by the user | cyan | dashed frame around the glyph | "(user-declared)"; "· user-declared" in `full` |
| Forever status unknown | none | nothing in rows | "Forever status: unknown" in Details (`full` variant) |
| Assumption-dependent number | neutral | `≈` with dotted underline | "Depends on assumptions: …" |
| Era value standing in for Forever | neutral | boxed `E` | "Uses Era values where Forever values are unknown" |
| Lower bound | neutral | `≥` prefix; XP bar notch and hatching beyond it | "at least …", "(lower bound: …)" |
| Unknown number | neutral | `?` (for XP, "XP ?" at every width); XP bar hatched at 3:1 with a dashed edge; indeterminate progress never drawn as a partial fill | "Unknown: <reason>" |
| Error / warning / info | magenta / violet / blue | octagon × / triangle ! / circle i | "Error", "Warning", "Info"; counts in words |
| Selection | accent tint | 3px left bar (a 4px `Highlight` strip under forced colours) | `aria-selected` |
| Keyboard focus | accent | 2px ring (active row: inset ring) | — |
| Placeholder content | none | dashed, hatched "PLACEHOLDER" label | "Placeholder <what>" |

Rules:

- Difficulty colours appear only through `DifficultyLabel` (or components built on it).
- Cyan appears only through `ProvenanceBadge`.
- Severity, accent and provenance hues sit at least 30° of hue away from every difficulty hue, and
  the severity, accent and XP hues at least 25° away from the provenance cyan; `tests/ui-tokens.test.ts`
  checks both in each theme.
- Validation never borrows difficulty red or orange, and difficulty never uses the severity icons.

## 5. Typography, spacing and density

- Interface text is 13px on an 18px line; secondary text 12px; small caps labels (panel
  sections, status bar labels) 11px bold with letter spacing.
- Numbers that line up use tabular figures (`frl-num`).
- Route rows are exactly 28px and one line: long titles ellipsise, details live in the right
  panel. Group headers are rows of the same height.
- Controls are 26px (22px inside rows). Icon buttons are square.
- Panels are separated by 1px gutters of `--frl-bg`, not by borders, so the panel edges stay crisp
  in both themes.

## 6. Layout

`AppShell` is a CSS grid:

```
┌────────────────────────── top (44px) ──────────────────────────┐
│ left 320-380px  │           centre (flexible)       │ right 340px │
│ route editor    │           map / placeholder       │ side panel  │
├────────────────────────── bottom (32px) ───────────────────────┤
```

| Width | Behaviour |
|---|---|
| > 1200px | Everything visible; action buttons show icon and word |
| ≤ 1200px | Top-bar action words become visually hidden (icon buttons with names and tooltips) |
| ≤ 1180px | XP numbers in the status bar hide (the bar and its spoken value stay, and an unknown value keeps its visible "XP ?") |
| ≤ 1024px | Two columns: the route panel keeps the full height (36%, min 280px); the side panel moves under the map; the splitter hides (the map's layer panel stays a toggle, §12) |
| ≤ 900px | The product name hides (the mark stays) |
| ≤ 720px | One column; the page scrolls; top and status bars wrap |

The route panel is resizable-ready: pass `leftWidth` and `onLeftWidthChange` and `AppShell`
renders a `separator` on its right edge (pointer drag; ←/→ by 4px, Shift for 20px, Home/End for
the limits). Widths are clamped to 320-380px (`clampLeftWidth`).

Landmarks: the top bar is a `header` (banner); the route editor is `main` ("Route editor"); the
map is a region ("Map"); the side panel is an `aside` ("Quests and details"); the status bar is a
region ("Route status").

**Scrolling.** Above 720px the shell owns all scrolling and the document never scrolls: `html`
and `body` clip overflow (`AppShell.css`), every shell area and the tab panel is a containing
block (`position: relative`), and the panels scroll or clip their own content. Without the
containing blocks, absolutely positioned content such as `.frl-visually-hidden` text escapes to
the initial containing block and lengthens the page (the M1 review measured a 176px page scroll
at 1366×657 with Details open). At 720px and below the page scrolls as a whole.

**Map panel.** The centre is the map (§12): a 32px toolbar, the stage the map engine fills, the
layer panel and the map key beside the stage when it is open (never over it), and a 24px status
line. Below 560px of panel width (a container query) the open layer panel lies over the stage's
right edge instead of squeezing it, and the toolbar's "Schematic map: zone frames, not terrain"
badge shows its short form, "Schematic" (the full text stays its tooltip and starts the map's
instructions, M3 review MAP-A11Y-13).

**Checked by hand.** happy-dom has no layout, so the tests check the mechanism (containing blocks,
overflow, grid areas; `tests/ui-tokens.test.ts`) and these results are checked in a browser after
layout changes: at 1920×1080, 1366×657, 1280×600, 1201×700, 1100×700 and 1024×768, in both
themes, with Details open on a quest step, `document.documentElement.scrollHeight` equals
`innerHeight`, `window.scrollTo(0, 500)` moves nothing, and with the layer panel open the bounding
rectangles of `.frl-mapframe__stage` and `.frl-mapframe__side` do not intersect. *Milestone 3:*
checked at 1366×768 in the built-in browser, light theme only (the page does not scroll with the
layer panel open; stage 424px and panel 260px wide, side by side); the other sizes and the dark
theme are still to check.

## 7. Component inventory

All exported from `src/ui/kit.ts`.

| Component | File | Purpose and key props |
|---|---|---|
| `AppShell` | `shell/AppShell.tsx` | Grid frame: `top`, `left`, `centre`, `right`, `bottom`; `leftWidth`, `onLeftWidthChange` |
| `TopBar` | `shell/TopBar.tsx` | Product, project › route (with `placeholder` label; `placeholderLabel` "Sample" for the generated sample route), quest search (`search`), jump to zone (`zones`), Import, Export, Settings, theme toggle, About |
| `RouteList` | `route/RouteList.tsx` | Virtualised listbox of `RouteRowModel`s; controlled `activeIndex` and `selectedKeys`; selection, editing and drag callbacks by index (§8) |
| `StepRow`, `GroupRow` | `route/StepRow.tsx` | One 28px row: number, step glyph, title and detail, provenance, difficulty, issue marker, projected level, lock toggle; duplicate and delete on hover or when active (pointer-only affordances, §8); `groupLabel` for the spoken "in group …" |
| `StepTypeGlyph` | `markers/StepTypeGlyph.tsx` | Original glyphs for accept, complete, turnin, abandon, travel, grind, hearth, flight, train, vendor, note |
| `DifficultyLabel` | `markers/DifficultyLabel.tsx` | Quest level chip with difficulty colour, pips and text; `uncertain` for lower-bound levels |
| `ProvenanceBadge` | `markers/ProvenanceBadge.tsx` | ◆ / ◇ in cyan, user-declared variant; `compact` or `full`. `foreverProvenanceOf(record.provenance)` derives its input |
| `AssumedMarker` | `markers/AssumedMarker.tsx` | `≈` (assumption) or `E` (Era fallback) with text |
| `ReadoutValue` | `markers/ReadoutValue.tsx` | Renders a `Readout<T>`: `≥`, markers, `?` with reason |
| `SeverityIcon` | `markers/SeverityIcon.tsx` | Error, warning, info shapes |
| `SidePanel` | `shell/SidePanel.tsx` | Tabs Available, Quest log, Details, Validation with counts; one content node per tab |
| `Tabs` | `shell/Tabs.tsx` | Accessible tablist, controlled, automatic activation; one tabpanel that every tab controls |
| `PanelSection`, `EmptyState`, `DetailList`, `IssueList`, `QuestListItem` | `shell/PanelContent.tsx` | Side-panel building blocks; `QuestListItem` takes `onOpen` ("Show in Details: <quest>", the info icon) and `onAdd` |
| `StatusBar` | `shell/StatusBar.tsx` | XP bar, current step, duration, XP/hour, optimiser state and progress, data and ruleset badges |
| `XpBar` | `shell/XpBar.tsx` | Level and XP progressbar with lower-bound, unknown and cap states |
| `MapFrame`, `LayerPanel`, `MapHoverText` | `shell/MapFrame.tsx` | The map panel's frame (§12), memoised: surface `Select`, a `Toolbar` of `MapCommand`s (unavailable ones `aria-disabled` with their reason) and the Layers toggle, the always-visible map-kind `notice` (with `noticeShort` for narrow panels), the `stageRef` host the engine mounts into, the visually hidden instructions (`instructionsId`), the layer panel (`MapLayerRow`s: checkbox, the layer's `glyph`, count, notes, disabled with a reason) with the map key under it, the `status` line and the `hover` text (a string, or an element that renders `MapHoverText` so only it re-renders), and `choice`: the items at a clicked point where several share it (a `dialog` beside the point, `mapChoicePosition`; focus on the first item, arrows, Home and End between items, Escape or a press outside closes, focus back to the map); `engine` shows loading, failed (with "Try again") or unavailable over the stage |
| `MapGlyph`, `MapLegend` | `shell/MapLegend.tsx` | The map key (§12): `MapGlyph` draws one canvas glyph, line style or badge as a 20 × 16 inline SVG (`aria-hidden`, kit colours, the canvas geometry and dash patterns); `MapLegend` lists `MAP_KEY` (markers, route lines, badges, each with its meaning) and `MAP_GRID_NOTE` (the grid's axes) |
| `MapPlaceholder` | `shell/MapPlaceholder.tsx` | *Milestone 1-2 centre panel, no longer rendered by the app (Milestone 3).* Kept, with its CSS, because `tests/ui-tokens.test.ts` checks its card-and-stub grid; it can go once that check moves to `MapFrame` |
| `AboutDialog` | `shell/AboutDialog.tsx` | Licence (GPL-3.0-or-later) and no-warranty line, data notice (D-016, with the LIC-10 carve-out verbatim; with `dataUpstreamCommit` set it is the real-data notice with the pinned commit, `dataIdentity`'s revision and frame build, and the "Full data notice" link to `data/NOTICE.md`), non-affiliation, source commit link |
| `LoadingScreen`, `LoadErrorScreen` | `shell/BootScreen.tsx` | The screens before the shell (Milestone 2): loading the dataset and geometry, with a progress bar and a `status` line ("Fetching and verifying data files: 3 of 7 (2.9 MB of 9.0 MB)"), then "placing … on the map geometry"; a failed start as an `alert` with title, message, a details disclosure and what can fix it (`remedy`): "Try again" for `reload`, or a sentence instead of the button for `redeploy` ("the deployed files need to be regenerated and redeployed") and `open-over-https` (no WebCrypto: "open the site over https (or on localhost)"). The heading takes focus. `src/ui/Boot.tsx` drives them |
| `Button`, `IconButton` | `primitives/` | Text and icon buttons; `IconButton` requires `label`, supports `pressed` and `shortcut` (tooltip text and `aria-keyshortcuts`, §9 rule 3). Both style `disabled` and `aria-disabled="true"` alike |
| `Select`, `TextInput` | `primitives/` | Native controls, restyled, always labelled (`hideLabel` keeps the label for assistive technology) |
| `Toolbar`, `ToolbarSeparator` | `primitives/Toolbar.tsx` | `role="toolbar"` with one tab stop and arrow-key movement |
| `PanelHeader` | `primitives/PanelHeader.tsx` | 32px header: title, meta, actions |
| `Badge`, `PlaceholderTag`, `VisuallyHidden` | `primitives/Badge.tsx` | Identity badges; the "Placeholder" label (`label` "Sample" for stand-in content built from real data, same style) |
| `Icon` | `primitives/Icon.tsx` | Interface icons in `currentColor` |

View-model types: `StepRowModel`, `GroupRowModel`, `RouteRowModel` (`route/rows.ts`, with
`routeRowContext` for step positions and group membership),
`Readout<T>` (`lib/readout.ts`, with `knownReadout`, `unknownReadout`, `readoutFromEstimate`),
`IssueCounts` (`lib/issues.ts`, with `countIssues`), `ForeverProvenance`, `OptimizerStatus`,
`SidePanelTabId`, `ThemePreference`. Formatting helpers (`lib/format.ts`) are locale-independent
and truncate rather than round up (level 12.99 reads 12.9).

## 8. Route list

- **Virtualisation.** Index arithmetic over a fixed 28px row (`route/virtual.ts`):
  `computeVirtualWindow` renders the visible rows plus 8 rows of overscan each side; the canvas
  is `rows × 28px` tall and rows are absolutely positioned at `index × 28px`. The active row is
  always mounted, even when scrolled away, so `aria-activedescendant` never dangles.
- **Semantics.** `role="listbox"`, `aria-multiselectable`, one tab stop, focus stays on the
  list and `aria-activedescendant` names the active row. Every row is an `option` with
  `aria-selected` and an `aria-label` that states the whole row in words.
  - **Ids** come from the row's stable key (`routeRowDomId`), not its index, so the active
    descendant changes whenever the active item does (a delete or undo that keeps the index) and
    stays put when only its index moves.
  - **Positions.** Step rows carry `aria-posinset` and `aria-setsize` among the *steps* only
    (rows outside the window are unmounted, so the browser cannot count them): "16. Travel …"
    is also "16 of 40". Group header rows carry neither, so no row is announced with two
    conflicting numbers. A step under a header adds ", in group <label>" to its name
    (`routeRowContext` works out the membership from each header's `stepCount`).
  - **In-row affordances.** Option children are presentational, so duplicate, delete and the
    lock toggle are not buttons: they are `aria-hidden` spans with pointer handlers and a
    tooltip, never focusable, and pressing one keeps focus on the list without selecting the
    row. Every action also has a list key (below) and a route-toolbar button. Component tests
    assert that no option contains focusable or interactive content (axe-core's
    nested-interactive rule; axe itself is not a dependency yet, so the planned Playwright
    smoke test is where it will run).
- **Keys.**

  | Keys | Action |
  |---|---|
  | ↑ ↓ Home End PageUp PageDown | Move the active row; the selection follows |
  | Shift + those | Extend the selection from the anchor (`onSelect(i, 'range')`) |
  | Ctrl/Cmd + those | Move the active row only |
  | Space / Shift+Space | Toggle / extend to the active row |
  | Ctrl/Cmd+A | Select all |
  | Enter (or double-click) | Activate (open in Details) |
  | Alt+↑ / Alt+↓ | Move the step up / down |
  | Delete | Delete |
  | L | Lock or unlock |
  | Ctrl/Cmd+D | Duplicate |

  Click selects (`replace`), Ctrl/Cmd+click toggles, Shift+click extends. The caller owns the
  selection anchor and applies `range`. `readOnly` (optimiser running, proposal open) turns off
  every editing key and affordance; navigation keeps working.
- **Drag.** Pointer drag from the grip. The preview is local: the dragged row dims and an
  insertion line follows the nearest gap; the list auto-scrolls near its edges. On release,
  `onDrop(from, to)` receives the final index (`move(from, to)` semantics); Escape, pointer
  cancel or a drop in place calls `onDragCancel`. Keyboard users move steps with Alt+↑/↓.

## 9. Accessibility rules

1. WCAG 2.2 AA. Text pairs reach 4.5:1, and UI edges, focus rings, selection and tab bars,
   meters, the lower-bound notch, lit against unlit difficulty pips and the unknown hatching
   reach 3:1, in both themes. `tests/ui-tokens.test.ts` computes every documented pair from
   `tokens.css` (alpha colours painted over their background first): each text colour on
   surface, raised, hovered and selected backgrounds; `--frl-border-strong` on those, on the
   sunken map area and on the difficulty well (the uncertain chip's dashes and gaps);
   `--frl-unknown-hatch` and the fills on the XP track; the difficulty colours on the well and
   on an unlit pip. Add a pair there when you draw a new foreground on a new background.
2. Visible focus everywhere: the 2px accent ring from `base.css`; components that manage focus
   themselves (route rows, tabs, splitter) draw the same ring.
3. No meaning by colour alone (§4). Every icon-only control has an accessible name and a tooltip;
   decorative SVGs are `aria-hidden`. `IconButton`'s tooltip is the native `title` (the kit has
   no custom tooltip): `aria-label` is the name and the title adds the shortcut
   ("Delete selected steps (Delete)"). Some screen readers also read the title as a description,
   repeating the name; that is accepted knowingly, since it is also how the shortcut is heard.
   The shortcut is exposed as `aria-keyshortcuts` too, converted from the `shortcut` text by
   `lib/keys.ts` (`'Ctrl+D'` → `'Control+D'`, `'Alt+↑'` → `'Alt+ArrowUp'`).
4. Everything works from the keyboard: one tab stop per composite widget (list, tablist,
   toolbar), arrow keys inside, documented shortcuts for row actions.
5. `prefers-reduced-motion` zeroes the duration tokens and suppresses animations and smooth
   scrolling. Nothing may freeze into a false value when its animation stops: the indeterminate
   optimiser bar then shows the unknown hatching across the whole track instead of a still 40%
   bar that would read as "40% done".
6. Live regions stay quiet and polite, and never announce percentages. Two exist: the status
   bar's optimiser state, and the shell's one app region (`src/ui/app/LiveAnnouncer.tsx`),
   mounted empty at startup and never remounted, because a region inserted together with its
   text is often not read. The app region says only the result of what the user just did:
   the selection count once it settles ("12 steps selected", "Selection cleared"; arrowing,
   which keeps one step selected, says nothing), and brief results of row commands, inserts,
   undo and redo ("3 steps deleted. Undo with Ctrl+Z."). Unavailable actions are not
   announced: they render `aria-disabled` (focusable, and in toolbars in the arrow-key order),
   with the reason as their description and tooltip ("Arrives in Milestone 4 …"), and their
   handlers do nothing.
7. Dialogs are native modal `<dialog>`s: focus moves in, Escape closes, focus returns.
8. Placeholder content is labelled "Placeholder" visibly and in text, and must not resemble real
   quest data.
9. Forced colours (Windows high contrast) drop author backgrounds, background gradients and box
   shadows, so every state drawn with them has a system-colour fallback under
   `@media (forced-colors: active)`: selected rows get a 4px `Highlight` strip (a pseudo-element,
   so rows do not shift); the selected tab's bar, the XP and progress fills, the drop line and
   the splitter's hover and focus line are `Highlight`; the lower-bound notch is `CanvasText`;
   issue severity bars become `CanvasText` borders (the icon shape and word still say which);
   pressed toggles get a `Highlight` edge; severity marks are cut out of their shapes in
   `Canvas`; disabled controls are `GrayText`. The difficulty chip opts out
   (`forced-color-adjust: none`): its reserved colours and pips carry the meaning and its own
   dark well gives them their contrast. Unknown XP loses its hatching there but keeps the
   dashed edge and "XP ?".
10. Tabs have one `tabpanel` element with a stable id whose content changes with the selection;
    every tab names it in `aria-controls`, and it is labelled by the selected tab.
11. A long name in a list ellipsises in its own element and never pushes out the signal after
    it: in `QuestListItem` the name is `.frl-quest-item__label` (with the full name as its
    tooltip) and the provenance badge after it does not shrink.
12. **The map is supplementary.** Everything it does has a keyboard path elsewhere: select a step
    (the route list), open a quest in Details (the Available tab's "Show in Details"), jump to a
    zone (the top bar), fit the route and focus the active step (the map toolbar), switch surface
    (the surface select), show and hide layers (the layer panel's checkboxes). The engine's
    focusable surface is named ("Route map: Kalimdor", `role="application"`,
    `aria-roledescription="map"`) and described by instructions that start with the map's kind
    ("Schematic map: zone frames, not terrain.") and say so; its own arrow-key panning and +/−
    zoom stay on, and Tab leaves it (no trap). Every glyph, line style and badge is named in the
    layer panel's key, and hover text says what a marker's badges mean. Hover text also shows in
    the status line, never in a live region. Only results of explicit map commands are announced
    ("Map shows Durotar.", "Map centred on step 12."), and the one thing the map cannot do on its
    own: follow the active step to a world map it has no surface for ("Step 6 is on world map 36,
    which this map cannot show.").

## 10. Adding a component

1. Decide where it belongs: `primitives/` (generic control), `markers/` (a signal from §4),
   `route/`, or `shell/` (a panel or bar).
2. Write it presentational: typed `readonly` props, callbacks for intent, no store or dataset
   access, and only `import type` from `domain` or `rules` (a value it needs from them comes
   re-exported through `app`, as `DIFFICULTY_LABELS` does). Optional props are typed
   `?: T | undefined` so callers can pass conditional values under `exactOptionalPropertyTypes`.
3. Style it in a co-located CSS file imported by the component, with `frl-<block>` classes and
   tokens only. If you need a new token, add it to both themes in `tokens.css`, document it in §3
   and, for colours, add its contrast pairs to `tests/ui-tokens.test.ts`. If a state is drawn
   with a background, gradient or box shadow, give it a forced-colours fallback (§9 rule 9). If
   the component sits in a scroll container, make sure that container is positioned (§6).
4. Name it for assistive technology (roles, labels, spoken forms of abbreviated numbers) and give
   every coloured signal its non-colour cue.
5. Test it next to the file (`// @vitest-environment happy-dom` for components): behaviour,
   keyboard, accessible names, and the unknown and lower-bound states where they apply.
6. Export it from `src/ui/kit.ts` and add it to §7.

## 11. Wiring the kit (for `src/ui/App.tsx`)

- Import from `src/ui/kit.ts`. Rendering `AppShell` loads `tokens.css` and `base.css`.
- Apply the stored theme at startup with `applyThemePreference(document.documentElement, pref)`
  and again from `TopBar`'s `onThemeChange`; persist it in the settings store.
- Map each route step to a `StepRowModel` (and each RXP group to a `GroupRowModel` header row):
  `number` is the 1-based step number, `title` one line, `projectedLevel` a `Readout<number>`
  (`unknownReadout(reason)` until the simulator exists; never 0), `quest` only for quest steps,
  `issues` from `countIssues`, `provenance` from `foreverProvenanceOf`.
- `RouteList` is controlled: keep `activeIndex` and the selection (with its anchor) in the store,
  apply `onSelect(index, mode)` there (`replace`, `toggle`, `range` from the anchor), and turn
  `onDrop(from, to)` into one move command. Pass `readOnly` while an optimiser run or a proposal
  is open.
- Anything that stands in for real content (sample routes, placeholder data) carries the
  Placeholder label: `TopBar placeholder`, `PlaceholderTag`, `EmptyState placeholder`, and a
  `StatusBar` data badge with `placeholder: true`. The map is real geometry drawn schematically:
  it says "Schematic map: zone frames, not terrain" instead (§12). The auto-generated sample route over the real
  dataset (Milestone 2) says "Sample" instead of "Placeholder": `TopBar placeholderLabel="Sample"`
  and a banner line "Sample route (auto-generated, not a recommended route)" above the route
  (`RoutePanel notice`, from `App routeNotice`).
- `AboutDialog` takes `version`, `sourceCommit` (injected at build; null otherwise),
  `dataUpstreamCommit` (from the loaded dataset's identity; null when none is loaded or the data is
  the placeholder test set) and `dataIdentity`.
- *Milestone 2:* `src/main.tsx` renders `Boot` (`src/ui/Boot.tsx`), which shows `LoadingScreen`
  while `loadWorkspace` (`src/app/workspace.ts`) fetches and verifies the dataset and the geometry,
  then `App`, or `LoadErrorScreen` with the reason and the remedy `describeLoadFailure` gives
  (`reload` for network, server and cache problems; `redeploy` for a malformed or inconsistent
  file, the fixture slice deployed as data, or data and geometry that do not pair even after the
  geometry is fetched again past the cache; `open-over-https` without WebCrypto). `App` takes a `DatasetSource`
  (`src/app/dataset-source.ts`), not a `DatasetView`: it asks the source for the view of the
  project's faction, class, custom quests and overrides, memoised, so the overlays follow the
  character. The data badge label is the first 8 hex digits of the `dataRevision` (full identity
  in its tooltip).
- *Milestone 2:* the Available tab renders at most `AVAILABLE_PAGE_SIZE` (100) quests, by level
  (the required level when it is higher: a level-1 quest that needs level 42 sorts at 42) and then
  id, with the count of the rest ("Showing 100 of 2,202 quests open to Orc Warrior") and a
  "Show 100 more" button. Any change of the search, clearing it included, starts over at one page.
  A row says "requires N" when the quest's required level is above the character's start level.
  Rows are memoised, so "Show more" renders only the rows it adds.
  Details lists a quest's givers and receivers with where they are (zone name and percent as
  published, `Gornek (NPC) · Durotar 42.06, 68.33`; "inside an instance" or "no map position" when
  there is no point), its objectives with where they are done, its quest text, and QuestieDB's
  provenance of the record.
- *Milestone 2:* a spawn inside an instance (QuestieDB's `[-1, -1]` presence) is never shown as
  being in its entrance's zone: summaries say "1 spawn in an instance (entrance in Westfall)", the
  quest's zone "Inside an instance (entrance in The Barrens)", and "an instance" alone when the
  entrance is unknown. World points always name their axes ("World map 1: X -500.00, Y -4000.00
  yd"), with RXP's written `Y, X` order swapped back.
- *Milestone 2:* the map panel's geometry line says why a local map set is not used ("local set:
  refused (… changed after the set was activated …)"), except when there is none at all.
  *Milestone 3:* the line is the layer panel's footer ("Geometry loaded: …").
- *Milestone 3:* `src/main.tsx` passes `App` a `map` (`MapEngineSetup`: the merged geometry, the
  local set's art and `loadAdapter`, a dynamic import of `src/map/leaflet` started with the data
  load). `App` creates one map controller (`createMapController`, `src/app/map-controller.ts`) and
  gives it to `MapPanel` (`src/ui/app/MapPanel.tsx`, which mounts it) and to `AppTopBar` (jump to
  zone). Without `map` the centre says there is no map and jump-to-zone is unavailable ("No map is
  loaded").

## 12. Map panel

The centre panel (ARCHITECTURE §7, §12.4; MAPS.md §7). By the §4 import rules the logic lives in
`app` and the ui only renders it:

| Where | What |
|---|---|
| `src/app/map-view.ts` | The map's view state in the store (`ViewState.map`): `surface`, `zoomBand` (`zone`/`continent`), `layers` (visibility) and `zone` (the zone last jumped to, cleared once it is panned out of view or the surface changes). Hover is not in the store (below). `patchMapUi` keeps the object when nothing changes, so a no-op write notifies nobody. `ViewState.openedQuests` holds quests opened in Details with the selection they were opened under (`shownOpenedQuests`). `openQuestsInDetails`, `closeOpenedQuests`, `setMapUi` and `setMapLayerVisible` write them |
| `src/app/map-model.ts` | Pure view models: `questGiverModel` (the Available tab's rule: quests open by race and class), `objectiveModel` and `turnInModel` (the focused quests), `flightMasterModel` (the faction's, unknown-faction ones labelled so, each with the open quests it starts), `createRouteInputBuilder` (cached by step id) and `mapRouteInput`, `createDrawnRouteFilter` and `focusWithin` (what the route layers draw from), `routeMapSummary`, `stepsWithoutSurface`, `legUnknownAt`, `routeBoundsOn`, `routeStepIndex`, `zoneBounds`, `zoneGroups`, `focusQuestIds`, `stepFocusOf`. What has no map position (item starters, reputation objectives) or no spawn in the dataset is counted, never placed |
| `src/app/map-controller.ts` | `createMapController`. Store to layers: memoised inputs, `createMapLayers`, `setLayer` only for a changed `LayerContent`, visibility from the store. The adapter's label provider (`labelFor`). Adapter events to the store; hover kept here (`getHover`, `subscribeHover`); a merged marker's choice (`getStatus().choice`, `choose`, `chooseAll`, `dismissChoice`). The commands `focusStep`, `fitRoute`, `jumpToZone`, `showSurface` and `hoverSteps`. Local art: only the images drawn at this level of detail, verified, drawn through object URLs, revoked on detach. `getStatus` (per-layer stats and notes, the route summary, the active step's placement, the choice) and the `frl:map:sync` User Timing measure (at most `MAX_SYNC_MEASURES` kept) |
| `src/app/map-exports.ts` | Re-exports for the ui: the controller and its types, `BADGE_TEXT`, `layerStatsNotes`, `DEFAULT_LOD`, `lodLevelAt` and the local-art types |
| `src/ui/shell/MapFrame.tsx`, `MapLegend.tsx` | The kit's frame, `LayerPanel`, the choice list and the map key (§7) |
| `src/ui/app/MapPanel.tsx` | Loads the engine (loading, or failed with a retry), attaches and detaches the controller, names the engine's surface, reports the active step to it, maps its status to the frame's props, and renders the pointer line from the controller's hover alone |

**Behaviour.**

- **It follows the route list.** When the active step changes (list, keyboard, map click), the map
  brings it into view with `focus`, which zooms in to at least −2 and pans only when the point is
  not comfortably visible; a step on another world map switches surface. A selection change moves
  the active step in the same sync, so one click or arrow key costs one sync (M3 review PERF-6).
  "Focus step" recentres on request, and says why it cannot ("Step 1 has no location", "Step 6 is
  not on the map: it moves the character somewhere the route does not say", "Step 6 is on world
  map 36, which this map cannot show"). The last one is also announced and shown in the status
  line when the active step lands there, since the map cannot follow it (MAP-UX-9).
- **Labels.** Route descriptors carry no step numbers (MAPS §7.3): the controller is the adapter's
  label provider and numbers steps from the current route order when a tooltip opens ("12 ·
  Accept quest: Your Place in the World", "Route: steps 3–40", "Transport to Eastern Kingdoms:
  step 12 to step 13", "Step 20: Hearthstone (destination unknown until simulation)"). A marker's
  badges are said in words after its text: "(outside its zone’s map frame)", "(leg unknown: an
  earlier step could not be placed)", "(inside an instance: drawn at its entrance)" (MAP-A11Y-10).
  The status line's "Pointer on:" text is the tooltip's.
- **Clicks.** A step marker, halo, route segment (the leg into the step after it) or leg selects
  that step; a transition glyph selects the step at its other end, so the map follows across; a
  departure glyph (a hearth with no known bind point) selects its step; a quest giver, objective,
  turn-in or flight master that starts quests opens its quests in Details; an aggregate glyph
  opens its zone. Several items at one point are one marker with a count badge: when their clicks
  would differ, a small list beside the point names them ("6 steps here", each with its hover
  text) with an "all" action ("Select all 6 steps", "Open all 9 quests in Details"); the first item
  takes focus, arrows move, Escape or a press outside closes, and focus returns to the map
  (MAP-UX-3). A click on empty map at continent zoom jumps to the zone frame the point is most
  central in (`zoneFramesContaining`; the Crossroads opens The Barrens, not Durotar's overlapping
  frame, coordinates.md §15; MAP-UX-1). Frames themselves are not interactive (MAPS §7.5).
- **Zones.** Jump to zone (the top bar, an aggregate click, an empty click) fits the zone's frame
  at the zone zoom or closer, so its points are drawn raw even where the stage is too small to
  fit the zone there, and the zone's points stay raw at any zoom while it is the zone (PERF-4,
  MAP-UX-2). Its frame is drawn emphasised and the top bar's select shows it until the zone is
  panned out of view or another surface is shown; then both reset (MAP-UX-12).
- **Route rows.** The pointer over a route row highlights that step's marker (a group header: its
  steps'), on top of every layer, without rebuilding anything.
- **Focused quests.** The quests opened in Details while they are shown, otherwise the active
  step's quests: their objectives and turn-ins are drawn, and their givers raw and emphasised at
  any zoom.
- **Initial view.** The route's first surface, fitted to the route there (never closer than zoom
  −1.5). A remount keeps the adapter and its views.
- **Honest counts.** The layer panel lists every layer, topmost first, with its glyph, what is
  drawn and notes that always name their unit (MAP-HONEST-5): points folded into zone counts,
  markers over the cap, points not placed and why, points or steps on other world maps, quests that
  start from an item, quest givers, objectives, turn-ins and flight masters with no spawn in the
  dataset (MAP-HONEST-4), flight masters of the other faction. Under the layers, the key names every
  glyph, line style and badge and says how to read the grid (MAP-A11Y-10). Art is unavailable
  without a compatible local set, and the proposal until proposals exist. The status line gives
  the route on this surface ("Route: 54 of 55 steps on Kalimdor · 1 without a location"; steps on
  maps no surface shows are counted apart, "1 on maps with no surface") and, zoomed out, "Zoomed
  out: quest points shown as zone counts".
- **Performance.** Only a layer whose inputs changed is rebuilt and sent. Route layers are built
  from the steps they draw (`createDrawnRouteFilter`, `focusWithin`), so inserting, editing,
  deleting or selecting a note rebuilds no route layer; an insert elsewhere changes only the
  descriptors next to it (no step numbers in them), and a step move sends the route line and the
  selection. Hover writes nothing to the store, so no panel but the pointer line re-renders for it
  (PERF-14). `docs/measurements/map-m3.json` has the numbers and how they were taken.
