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
region ("Route status"). With project storage connected (Milestone 4, §13) the top row also holds
the project strip, a region ("Project storage") to the right of the top bar in the same 44px row;
at 720px and below it wraps onto its own line under the top bar.

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
| `Select`, `TextInput` | `primitives/` | Native controls, restyled, always labelled (`hideLabel` keeps the label for assistive technology). `TextInput` also takes `inputMode` (the on-screen keyboard; the value stays text), `describedBy`, `invalid` (`aria-invalid`, with the reason in a described-by element), `readOnly` (focusable and copyable, drawn with a dashed edge on the raised surface) and `onBlur` |
| `Checkbox` | `primitives/Checkbox.tsx` | A native checkbox with its label after it (`label`, `checked`, `onChange`, `describedBy`) |
| `Toolbar`, `ToolbarSeparator` | `primitives/Toolbar.tsx` | `role="toolbar"` with one tab stop and arrow-key movement |
| `PanelHeader` | `primitives/PanelHeader.tsx` | 32px header: title, meta, actions |
| `Badge`, `PlaceholderTag`, `VisuallyHidden` | `primitives/Badge.tsx` | Identity badges; the "Placeholder" label (`label` "Sample" for stand-in content built from real data, same style) |
| `Icon` | `primitives/Icon.tsx` | Interface icons in `currentColor` |

The project-storage components (§13) are not kit components: they read the project session, so
they live in `src/ui/app/` beside the other store-bound panels and are not exported from the kit.

| Component | File | Purpose and key props |
|---|---|---|
| `ProjectBar` | `app/ProjectMenu.tsx` | The project strip: the Projects button (described by the full save status), the save status in words with the warning shape when nothing is kept, "Data changed" (the drift report) and a notices button; owns `ProjectMenuDialog` and `DriftDialog` |
| `ProjectMenuDialog` | `app/ProjectMenu.tsx` | The Projects dialog: notices, the open project (status, conflict and retry actions, Rename, Duplicate, Export, Delete), the other stored projects (Open, Rename, Duplicate, Export, Delete; a project that cannot be opened says why, path by path, and can still be exported and deleted), New project, and Recently deleted with Restore |
| `DriftDialog` | `app/ProjectMenu.tsx` | The drift report (ARCHITECTURE §5.5): old and new data revision, missing quests, quests whose objectives or prerequisites changed (named from the loaded data), "unknown" where nothing can be compared; Keep the report / Dismiss the report |
| `ImportDialog`, `ExportDialog` | `app/ImportExport.tsx` | Native project files: pick or drop a `.frl.json` file (opened as a new project; refused with every problem by path, never repaired), or download the open project; an `rxp` slot each, which the top bar fills with `RxpImportEntry` and `RxpExportEntry` (§15) |
| `RxpImportDialog` | `app/RxpImportDialog.tsx` | "Import RXP custom guide" (§15): paste or open a `.lua`/`.txt` file, target (new project or the end of the route), percent frame of the four changed zone maps, check, diagnostics, quests the data lacks, import. Loaded on first use (§11) |
| `RxpExportDialog` | `app/RxpExportDialog.tsx` | "Export RXP custom guide" (§15): byte-identical or canonical in words, `.txt` or `.lua`, preview, Copy (with a visible "Copied" for a few seconds), Download, what the export cannot keep. Loaded on first use (§11) |
| `RxpImportEntry`, `RxpExportEntry` | `app/RxpEntries.tsx` | The Import and Export dialogs' RXP sections: a sentence and the button that opens the RXP dialog (in the entry chunk; the dialogs are not) |
| `RxpDiagnosticList`, `SourceExcerpt`, `RadioGroup` | `app/RxpParts.tsx` | The RXP diagnostics list (severity shape and word, line and column, message, code, whether RestedXP itself drops the line; counts, a severity filter, pages of 100); an item with a line is a disclosure button whose excerpt follows it. The excerpt: the line and two around it, numbered, the line marked (▶ and a tint) and its column outlined, a focusable region because long lines scroll sideways. Native radio buttons in a fieldset, each hint its option's description |
| `ModalDialog` | `app/ModalDialog.tsx` (re-exported by `app/ProjectMenuDialog.tsx`) | The native modal `<dialog>` every app dialog uses (§9 rule 7): title (focusable, the focus fallback), close button, optional footer, `onEscape` so an inner step (a name field, a delete confirmation) takes Escape first, `dismissOnBackdrop` (default true; false for a dialog that holds a draft), `onFileDrop` (a file dropped anywhere on it that no target inside took; without it such a drop is refused, never left to the browser); its own polite live region; Ctrl/Cmd keys pressed inside stop at the dialog; header and footer are plain elements, not landmarks |
| `LazyDialogFallback` | `app/lazy.tsx` | What stands in for a dialog that loads on first use (§11): the same modal and title, "Loading…", or why it could not be loaded with "Try again" |

The route editor's store-bound components (§14) live in `src/ui/app/` for the same reason:

| Component | File | Purpose and key props |
|---|---|---|
| `LocationEditor` | `app/StepEditors.tsx` | A location as a `fieldset`: what it is now, a typed zone point (Zone, X % and Y % kept together, "Set point": the keyboard path), "Pick on map" (`pick`: the map controller and what the point is for; a toggle that keeps its name) and Clear; controlled (`value`, `onChange`): the typed fields follow the value whenever it changes |
| `DurationEditor` | `app/StepEditors.tsx` | A step's duration override, typed in minutes and stored in whole seconds, the conversion said in words; Set, Clear. Keyed per step, not per value, so Enter keeps focus in the field; the text follows the value |
| `CustomQuestEditor` | `app/CustomQuestEditor.tsx` | Create, edit or replace-a-dataset-quest form (`edit`: `new` with an optional id, `edit`, `replace`), in the Details tab; DATA001 info; Save, Cancel, Delete (saying how many steps use the quest); the id is read-only except for a new quest. `onClose` says how it closed (`saved`, `cancelled`, `deleted`). Loaded on first use (§11) |
| `FormProblems` | `app/FormProblems.tsx` | The problems that stop a form's save, at its top, focused after every failed save (`useFocusProblems`); `fieldProblemProps` gives each field it names `aria-invalid` and the problems as its description |
| `SettingsDialog` | `app/SettingsDialog.tsx` | The Settings dialog (`ModalDialog`, not closed by a backdrop press): character and route profile as a draft; Cancel and "Save settings" (one command) in the footer. Loaded on first use (§11) |
| `QuestDetails` | `app/QuestDetails.tsx` | One quest in Details; with `actions` it adds the quest's steps and opens the custom quest editor, with `baseDataset` it says when a custom quest replaces a dataset quest |

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
  | Ctrl/Cmd+X | Cut the selection to the clipboard |
  | Ctrl/Cmd+C | Copy the selection (also while editing is locked) |
  | Ctrl/Cmd+V | Paste the clipboard after the selection |
  | J | Join the selection's sections: every later run of selected steps moves to follow the first |
  | Escape | Clear the selection (while a map pick is in progress, cancel the pick first) |

  The list handles the row keys itself; Ctrl/Cmd+X/C/V, J and Escape are the route editor's
  (`useShortcuts.ts`), so they act only while focus is inside the route editor and never in a text
  field. Global keys: Ctrl/Cmd+Z undo, Ctrl/Cmd+Shift+Z or Ctrl/Cmd+Y redo, Ctrl/Cmd+K quest
  search (not in text fields, and not while any modal dialog is open, whoever owns it and wherever
  focus is: `isModalDialogOpen`, `lib/modal.ts`). Every key also has a button: the
  route toolbar has Note, Travel, Grind, Duplicate, Lock, Delete, Cut, Copy, Paste and Join, each
  `aria-disabled` while it cannot run (Copy stays available while editing is locked).

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
6. Live regions stay quiet and polite, and never announce percentages. They are the status
   bar's optimiser state, the shell's one app region (`src/ui/app/LiveAnnouncer.tsx`), mounted
   empty at startup and never remounted, because a region inserted together with its text is
   often not read, and one region per modal dialog (M4 review UI-F2). A modal dialog makes the
   page outside it inert, and inert content is not exposed to assistive technology, so while
   dialogs are open the announcer (`createAnnouncer`, given to them through `AnnouncerContext`)
   speaks in the top-most open dialog's region, mounted with the dialog. When a dialog closes,
   a message said by the action that closed it (no press or key in the dialog since: "Settings
   saved.", "Imported …") is said again in the region below, the shell's once no dialog is open;
   older messages are not repeated. The regions say only the result of what the user just did:
   the selection count once it settles ("12 steps selected", "Selection cleared"; arrowing,
   which keeps one step selected, says nothing), and brief results of row commands, inserts,
   undo and redo ("3 steps deleted. Undo with Ctrl+Z.", "2 steps cut. Paste with Ctrl+V; undo
   with Ctrl+Z.", "Cull: accept quest, complete objectives, turn in quest added as steps 4 to 6."),
   of the editors ("Duration of step 3 set to 2 minutes 30 seconds.", "Click the map to place the
   location of step 3. Escape cancels.", a field that cannot be saved: "Not set: …"), and the
   results of project actions
   ("Opened “Durotar run”.", "Imported “x” as a new project and opened it."), and of the RXP
   dialogs ("Imported “Guide”: 40 steps added as steps 13 to 52. Undo with Ctrl+Z.", "Copied the
   guide text to the clipboard." with a visible "Copied" beside Copy for a few seconds,
   "Exported “Guide.lua”."; §15). A save that fails
   is announced once, when it fails ("Not saved: …"), because the edit just made is not kept; the
   save status itself is not a live region. Unavailable actions are not
   announced: they render `aria-disabled` (focusable, and in toolbars in the arrow-key order),
   with the reason as their description and tooltip ("Arrives in Milestone 4 …"), and their
   handlers do nothing.
7. Dialogs are native modal `<dialog>`s (`ModalDialog`): focus moves in, Escape closes, focus
   returns. When the control that has focus removes itself ("Try again" replaced by progress,
   the last "Show more"), focus goes to the dialog's title (or, where the dialog knows better,
   to what took its place), never to the page body. A press that starts and ends on the backdrop
   closes a dialog, except one that holds a draft (Settings, RXP import): those close only by
   Escape, Cancel or Close, so a slip of the pointer loses nothing (UI-F10). While a dialog is
   open the shell's global keys are off and Escape belongs to the dialog, even with a map pick
   waiting behind it (UI-F1, UI-F8). A form's failed save moves focus to its list of problems,
   every time, and marks each field a problem names (`aria-invalid`, described by it). A file
   dropped on a dialog outside its drop target is never opened by the browser in place of the app:
   the RXP import takes it as its file, other dialogs refuse it (UI-F14).
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
- *Milestone 4:* `src/main.tsx` opens project storage beside the data load, restores the last open
  project (`loadWorkspace`), creates the project session (`createProjectSession`) and provides it
  with `ProjectSessionProvider` (`src/ui/app/ProjectMenuContext.tsx`). `App`'s `projectName` and
  `routeNotice` follow the session's open project (the sample notice only while the sample is
  open). `AppTopBar` reads the session from the context: with one, Import and Export open their
  dialogs and the project strip renders; without one (component tests) they stay unavailable and
  say that no project storage is connected (§13).
- *Milestone 4 (route editor):* `App` wraps its `DatasetSource` in `cachedDatasetSource`
  (`src/app/dataset-views.ts`), so the project's view and the view without its custom quests
  (`datasetBaseView`: what a custom quest with a real id replaces) are both kept, and the map
  controller reads through the same cache. `createRouteActions(store, announce, { geometry })`
  takes the map geometry (null without a map) for placing quest steps. `AppTopBar` gets
  `onOpenSettings` (Settings is then available and opens `SettingsDialog`); `AppSidePanel` gets
  `baseDataset`, `mapController` and `announce`, and holds the custom quest editor's state.
- *Milestone 5 (RXP custom guides, §15):* `AppTopBar` fills the Import and Export dialogs' `rxp`
  slots and owns the two RXP dialogs. It takes two optional props for them: `geometry` (the map
  geometry, `map?.geometry`: `RXP035` at import, and the map frame of points made in the app at
  export) and `data` (the `DatasetSource`, so a guide imported as a new project is checked against
  the data alone, without the open project's custom quests). `App` passes both (`map?.geometry`
  and its cached `DatasetSource`); without them (component tests) the import does not check world
  points against their map, the export cannot place an app-made world point that has no UiMap,
  and the open project's view stands in for a new project's.
- *Milestone 4 review (UI-F2):* `App` provides its announcer through `AnnouncerContext`
  (`src/ui/app/LiveAnnouncer.tsx`), so every `ModalDialog` speaks in its own region (§9 rule 6).
- *Milestone 4 review (CR-19):* the Settings dialog, the custom quest editor and the two RXP
  dialogs load on first use: one dynamic import (`src/ui/app/lazy.tsx`, `lazy-parts.ts`) for all
  four, so the kit modules they share stay in the entry chunk instead of in extra shared chunks
  (separate imports made the entry and its static imports larger, not smaller). `useLazy` keeps a
  part once loaded (a dialog then stays mounted, so its native focus return works); while one
  loads, `LazyDialogFallback` shows the dialog's title with "Loading…", and a failed load says why
  with "Try again". Production builds fetch the chunk once the page is idle (`preloadLazyParts`).
  The Projects dialog, Import and Export are still in the entry chunk: `ProjectMenu.tsx` holds
  both the always-visible project strip and the Projects dialog, and imports `downloadFile` from
  `ImportExport.tsx`. Measured by `pnpm build`'s dist audit on 2026-09-26: the entry and its static
  imports 205.96 kB gzip of the 250 kB budget (210.74 kB before; M3 141.88 kB; the growth since
  M3 is Milestones 4 and 5: project storage and its dialogs, the editors, zod-validated autosave,
  the RXP sections), the lazy parts 12.40 kB gzip plus 1.50 kB of CSS.
- *Milestone 4 review (UI-F7):* text from RestedXP guides is shown plain: `plainGuideText`
  (`src/app/ui-text.ts`) removes the game's colour (`|cAARRGGBB` … `|r`) and texture (`|T` … `|t`,
  `|A` … `|a`) escapes and RXP's colour tokens (`|cRXP_FRIENDLY_` … `|r`, keeping their words),
  keeps a hyperlink's text, and makes `|n` and a written `\n` spaces. `stepTitle`, `stepDetail`
  and the group rows' guide names use it, so route rows, their spoken labels, Details, the status
  bar, the map's labels (the controller's label provider applies it too) and announcements read
  "Talk to Kaltunk", never "Talk to |cRXP_FRIENDLY_Kaltunk|r". The step keeps its text as written
  (the Details text field edits it), so an unedited guide still exports byte for byte.
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
- **Pick on map** (Milestone 4, §14). `startPick({ label, onPick })` makes the next click on the
  map a point and nothing else (it selects nothing); `getStatus().pick` names it, the status line
  says "Picking the location of step 3: click the map to place it. Escape cancels.", and the
  toolbar has "Cancel pick". Escape anywhere cancels it first (a capture listener while it lasts),
  except while a modal dialog is open: the map is inert then, so Escape closes the dialog and the
  pick waits behind it (UI-F8).
  The point is world form, where the click was to 0.1 yd, with the zone hint as its UiMap: the
  zone the map was jumped to when its frame holds the point, else the zone frame the point is
  most central in (`attributeZone`), else none. A pick ends on detach, and when the editor that
  started it leaves Details.
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
  descriptors next to it (no step numbers in them). The step markers do not see the focus
  (M3 review PERF-2, Milestone 4): every one is `normal`, and the selection layer draws the
  selected, hovered and active steps' halos and a strong copy of their markers on top (the active
  step's first under its cap), so a selection change never rebuilds the step markers. They are
  built from caches (a candidate per step input, points interned for finding stacks, merged stacks
  by their members), so a move rebuilds only what it touched; the same descriptor objects in a
  new order diff to nothing in the adapter. Hover writes nothing to the store, so no panel but the pointer line re-renders for it
  (PERF-14). `docs/measurements/map-m3.json` has the numbers and how they were taken.

## 13. Project storage

The project strip, the Projects dialog, import, export and the drift report (ARCHITECTURE §5.5,
§8.2, §12.3). The logic is the project session in `src/app/persistence.ts` (with
`project-library.ts`, `autosave.ts` and `drift.ts`; storage, and the links between tabs, in
`src/infra/persistence`); the ui only renders it (§4).

**Save status.** The strip always says, in words, what is kept:

| Status | Strip | Full sentence (tooltip, the Projects button's description, the dialog) |
|---|---|---|
| saved | "Saved 12:03" (local 24-hour time; the date first on another day) | "All changes are saved in this browser (last saved 12:03)." |
| pending | "Unsaved changes" | "Changes are saved automatically in a moment." |
| saving | "Saving…" | "Saving changes in this browser." |
| failed | "Not saved: storage full", "…: changed elsewhere", "…: open in another tab", "…: storage closed", "Not saved" | "Not saved: <reason>. Last saved 12:00." (storage full adds the usage, what to do and the three largest stored records) |
| unavailable | "Not saved: storage unavailable" | "<why>. Projects are kept in this tab only and are lost when it closes. Export a project to keep it." |

Failed and unavailable carry the warning triangle as well as the words. A failure stays on show
until a save succeeds, also while the save is tried again: the strip never switches to "Saving…"
in between, and the failure is announced once per reason (§9 rule 6), not at every retry. A failed
save offers "Try saving again".

**Other tabs and windows.** Each tab holds a Web Lock on the project it has open, and every change
a tab stores is announced to the others on a BroadcastChannel (`src/infra/persistence/tabs.ts`;
where a browser lacks either, the `writeSeq` check still refuses a stale save, only later).

- A project another tab already has open opens with "Not saved: open in another tab": this tab
  saves nothing of it until the user chooses "Open anyway" (this tab saves it too) or "Open a copy"
  (the copy opens and is saved; the other tab's project is left alone). When the other tab lets
  the project go (it closes, or opens another project), this tab takes the lock and saves again by
  itself. Opening such a project from the list is refused first, with the same two choices in the
  failure message.
- "Changed elsewhere" means another tab or window stored the project since this page did; it shows
  as soon as the other tab saves. The dialog offers "Save as a copy" (the primary choice) and
  "Keep this version (overwrite)", which asks first in place and names the version it replaces
  ("The version saved in another tab or window (“Durotar run”, saved 12:05, 42 steps) is replaced
  by this page's version, and cannot be restored."). Overwriting keeps the stored name, so a rename
  made in the other tab stays; a rename alone in another tab is taken over without a conflict.
  When the other tab deleted the project, the choice reads "Keep this version (store it again)".

**Autosave.** A change starts a quiet period (750 ms, restarted by each change); the save then
waits for an idle moment (`requestIdleCallback`, at most 2 s; where it is missing, 50 ms). Edits
that never pause still save every 10 s. Hiding or leaving the page (`visibilitychange`,
`pagehide`) starts the save at once, inside the event handler: every storage request of the save
is made before the handler returns. A save already running when the page is hidden is followed by
another as soon as it ends. While changes cannot be kept (a failed save, "changed elsewhere", "open
in another tab", or, without browser storage, any edit at all), the browser asks before the page
closes (`beforeunload`). Opening, creating or importing another project first saves the open one;
when that fails, the switch is refused with the reason, so changes are never dropped silently.

**Projects dialog.** Actions are buttons whose names include the project ("Open “Durotar run”").
Rename and New project open a name field in place (focus moves to it; Enter confirms, Escape
cancels without closing the dialog). While an operation runs the actions are `aria-disabled`
("Wait for the current operation to finish").

- **Focus.** After an inline step (Cancel, Escape, or an action that succeeds), focus returns to
  the button that opened it, found again by its project and action after the list re-renders (a
  renamed project's Rename button included), or to the list heading when that button is gone. A
  failed action shows its message, with every path-level problem, at the top of the dialog, and
  focus moves there; the inline step stays open with what was typed (a refused rename keeps its
  name field and draft).
- **Delete** asks first, in place, with focus on Cancel. The question says where the project goes:
  "It moves to Recently deleted and is kept there for 30 days." (`BACKUP_RETENTION_DAYS`), or,
  without browser storage, "…which is kept only until this tab closes."; for the open project, what
  opens instead ("This closes it and opens “Durotar run”.", "…opens the sample project.", "…starts a
  new empty project."). It offers "Delete" and "Delete permanently" (removed now, with no copy to
  restore). Deleting the open project keeps its latest changes in Recently deleted even when they
  could not be saved (or were never stored); when another tab's version is the stored one, both are
  kept. Recently deleted rows offer "Restore" and "Delete permanently", which asks first.
- **Destructive style.** "Delete", "Delete permanently" and "Overwrite" never use the primary accent
  fill: they are secondary buttons with a doubled edge in the text colour (`--frl-fg`; a 2px edge
  under forced colours) and, for deletes, the delete icon. No reserved or severity hue is used.
- **Storage full.** The failure names the usage, what to do and the three largest records ("The
  largest: “Durotar run” (8.0 MB), “Old run” in Recently deleted (3.1 MB)."), and each project and
  backup row shows its size ("· about 8.0 MB") until a save succeeds. Moving a project to Recently
  deleted needs space too; when that fails, the message says to delete it permanently. A permanent
  delete frees the space, and the open project's failed save is tried again at once ("The open
  project is saved now.").
- **Projects that did not open** are listed with why. Those this version cannot read are "Cannot be
  opened: …", then the problems; they are kept unchanged and can be exported as stored. Those that
  could not be read (or whose migration backup failed) are "Not opened: … try opening it again", with
  a "Try opening again" button. When the stored projects cannot even be listed at the start, a new
  unsaved project opens, nothing stored changes, and a notice says to reload.

**Import and export.** Import takes a file from the file field ("Choose a project file") or a
drop on its section (the drop target is outlined; the field is the keyboard path). Files over
50 MB are refused before reading. The file is decoded as strict UTF-8: a file with an invalid byte
is refused ("“name” is not valid UTF-8 text…"), never repaired. A good file opens as a new project
named after the file; a bad one is refused with "“name” is not a project file this app can open."
and its problems by path, focused. A project built elsewhere (an RXP guide) is checked against the
project schema before it is stored, the same way. Export downloads the open project as
`<name>.frl.json` (a Blob behind an object URL); the same project always gives the same bytes
(`serializeProject`). RXP custom guides go in each dialog's `rxp` slot: its button opens the RXP
dialog in place of the Import or Export dialog (§15); without a slot the section says RestedXP
custom guides are not available there.

**Drift.** When the open project was saved with another data revision, the strip shows "Data
changed" (warning triangle and words). Its dialog lists what changed; "Dismiss the report"
records the loaded revision with the next save, and "Keep the report" leaves it, so it comes back
at the next start. Until it is dismissed, saves, copies and exports all record the old revision.

**Checked by hand.** Milestone 4, in the built-in browser, light theme only, at 1366×768,
1280×600, 1024×768 and 700×900: the strip sits in the top row with no horizontal scroll, and the
page does not scroll above 720px. The strip takes about 160px of the row, so at 1024px the top
bar's project and route names are short ellipses. A reload reopens the last open project. The
review fixes (other tabs, delete permanently, the destructive style) are covered by component and
session tests, not yet checked by hand.

## 14. Route editing

The route editor's commands and editors (ARCHITECTURE §8.1, §12.2, §12.4; Milestone 4). The logic
is in `src/app` (`commands.ts`, `quest-steps.ts`, `quest-chains.ts`, `project-commands.ts`); the
ui runs it through `src/ui/app/route-actions.ts`, which announces each result (§9 rule 6). Every
edit is one command, so one undo entry; a command that changes nothing adds none.

**Where new steps go.** After the selection (after its last step), else after the focused step,
else at the end (`insertionIndex`): where the planner is working (docs/research/ux-benchmark.md).
The new steps become the selection.

**Adding quests.** The Available tab's + on each quest adds its accept, complete and turn-in as
one command ("Add quest"); the tab also has "New custom quest". A quest in Details has "Add
accept, complete and turn in", Accept, "Complete" (or "Complete all objectives") and "Turn in",
and "Complete objective n" beside each objective when there are several. Each step is placed at
the relevant spawn nearest the insertion context, by straight line: the starter's spawns for an
accept, the finisher's for a turn-in, the objective targets' (a creature, an object, an item's
drop sources, an event's points) for a complete. The context is the last step before the
insertion point whose location resolves, else the character's start location; each added step is
the next one's context, so the three walk from giver to work to receiver. With no context the
first spawn the dataset lists is taken. The location is the spawn's published point as published,
labelled with the entity's name, and `via` names the entity. A spawn with no published zone point
(inside an instance) is never used; a step with no usable spawn has no location, and the
announcement says so.

**Chain positions.** A quest in a chain carries "(n/m)" in step titles, the Available list and
Details ("Chain: Part 2 of 3: A → B → C"), from `nextQuestInChain` and single pre-quest links only
(`quest-chains.ts`). An ambiguous or missing link ends the chain there; a quest in no chain has no
label.

**Clipboard and join.** Cut and copy put the selection on the store's clipboard (with the groups
its steps name); paste inserts fresh copies after the selection (origin `paste`, restoring a group
the cut pruned). Join moves every later run of selected steps to follow the first run ("Join the 2
selected sections"); it needs two or more runs.

**Details.** For the active step: the note text (note steps), the step's note, the location, the
duration override and Lock, Duplicate and Delete. While editing is locked the fields are read-only
and say why.

- *Location* (`LocationEditor`): the current point in words; a typed zone point (Zone, X %, Y %,
  "Set point", in the Forever frame, the keyboard path); "Pick on map" (§12: the next click, as a
  world-form point with the zone hint; Escape, pressing it again or the map's "Cancel pick"
  cancels; it is a toggle, `aria-pressed` while picking, and keeps its name; without a map it is
  `aria-disabled` and says to type the point); Clear. The typed fields follow the location
  whenever it changes (undo, redo, a pick, Clear), so "Set point" never re-applies a point that
  is gone; pressed on the location's own point it changes nothing, so an Era-frame point stays in
  the Era frame (CR-17). A travel step's location is its destination.
- *Duration override* (`DurationEditor`): typed in minutes, stored in whole seconds, and said in
  both ("Set: 2 minutes 30 seconds (stored as 150 seconds), replacing the estimate."). Empty or
  Clear removes the override: the estimate applies (unknown until simulation). A negative or
  unreadable value is refused (`aria-invalid`, the reason described and announced). The editor is
  not remounted by its own change, so focus stays in the field after Enter.
- *Clear* is `aria-disabled` with its reason ("Nothing to clear: no value is set") when there is
  nothing to clear, never natively disabled, so the button keeps the focus it had (UI-F4).

**Custom quests** (ARCHITECTURE §5.5; `CustomQuestEditor`, in the Details tab so the map stays
usable for picking). "New custom quest" proposes the next invented id (negative); a real id is
allowed (a Forever quest from a guide, say). Fields: id, name, level, required level, base XP (the
user's, basis `user`, taken at the quest level, so it needs a level), Forever status (unknown, or
new or changed as declared by the user) and the starter and finisher locations (each a
`LocationEditor`). Empty fields are unknown. A dataset quest's Details offer "Replace with a
custom quest", which starts from the dataset record (starters, objectives, prerequisites) but not
its XP. Whenever the id is a dataset quest's, the form and Details say `DATA001-custom-shadowed`
(info): the custom quest replaces the dataset quest in this project; "Use the dataset record"
deletes the custom quest. Problems stop a save, are listed at the top of the form (which takes
focus after every failed save), mark the fields they name and are announced. The id is the
quest's identity, which its steps point at: it is read-only when editing (and when replacing,
where it is the dataset quest's), and "Delete custom quest" says how many steps use the quest
and what their id then means (CR-10). The form takes focus when it opens (its Name field);
Cancel puts focus back on the button that opened it, and Save or Delete on the Details tab
panel, which then shows the saved quest or the step. "Use the dataset record" removes its own
button, so focus moves to the "Replace with a custom quest" that takes its place (UI-F5).

**Settings** (`SettingsDialog`, from the top bar). The character: faction, race and class (the
Forever client's 56 playable pairs; a project holding another pair keeps it, marked as not
playable), sex, start level (1 to the assumed level cap, 60 unless the project sets another), start
XP (into the start level), what happened before the route (a new character, exactly the listed
quests with their ids, or unknown) and riding trained before it. The route profile: XP rate,
season and phase (empty: unknown), locale, dungeons, and hardcore, self-found, group quests and XP
step skipping. The fields are a draft: "Save settings" applies them as one command ("Edit
settings"), Cancel or Escape drops them; a press on the backdrop does not (UI-F10). The actions
sit in the dialog's footer, Cancel first. A race the character's faction does not have (from an
imported file) is shown as it is, marked "(not a race of the Alliance)", never replaced by the
first race. Known flight paths, professions, reputation and the start and hearth locations are
not edited here yet.

**Checked by hand.** Milestone 4, in the built-in browser on the production preview at 1366×768,
light theme, by measurement (the pane was hidden, so no screenshots): the route actions wrap onto
a second line (51 px) instead of being clipped at the 340 px route panel; the Details tab with the
editors open has no horizontal scroll (330 of 340 px) and the page does not scroll; the Settings
dialog (680 × 521 px) fits; "Pick on map" then a click on the Leaflet map set the step's location to a world point
(0.1 yd, with its zone hint). Still to check: 1024×768 and 720px, and the dark theme.
The component tests cover behaviour, keyboard, names and announcements (happy-dom has no layout).

## 15. RXP custom guides

Import and export of RestedXP custom guides (ARCHITECTURE §10, §12.1; docs/RXP.md; D-019). The
logic is `src/rxp` (pure) and, over it, `src/app/rxp-context.ts` (the injected lookups),
`rxp-import.ts` and `rxp-export.ts`; the dialogs only render it (§4). The labels are exactly
"Import RXP custom guide" and "Export RXP custom guide".

**Loading.** RXP is a lazy boundary: `src/app/rxp-options.ts` (in the entry chunk) holds the option
types, labels, limits and `loadRxpTools`, a dynamic `import()` of `src/app/rxp-tools.ts`, which
brings `src/rxp` in its own chunk (about 30 kB gzip) the first time a dialog checks or exports. A
failed load says so, and the next attempt loads again. The dialogs themselves load on first use
too (§11, CR-19); the Import and Export dialogs' RXP sections (`RxpEntries.tsx`) do not.

**Lookups** (`createRxpContext`). Zone keys are the view's zone names, which come only from
`zones.json` (QuestieDB's validated English names): exact, case-sensitive, and a name two UiMaps
share resolves to nothing. Quest facts (objective count, custom or not) come from the view, for
`RXP031` and `RXP032`. Geometry, when given, adds `RXP035`. Import and export use the same table,
so an imported step lowers again exactly as it was imported.

**Display.** Guide text is shown plain wherever the app shows a step (route rows, Details, the
map, announcements): colour and texture escapes and RXP colour tokens are removed for display
only, and the step keeps the text as written for export (§11, `plainGuideText`, UI-F7).

**Import** (`RxpImportDialog`, from the Import dialog's "Import RXP custom guide").

- *Input.* A text field ("Guide text or custom-guide .lua file": the text of a guide, or a whole
  addon `.lua` file; it is read, never run) and a file field ("Or open a file", `.lua` or `.txt`;
  a drop on the section works too). A file is decoded as UTF-8 keeping a byte-order mark, so an
  unedited guide exports byte for byte; a file that is not UTF-8 is refused ("… is not UTF-8
  text, so it cannot be imported unchanged."). Over 8 MB is refused before reading.
- *Options.* "Import into": a new project (named after the guide's `#name`, or after the file for
  several guides, with the default character; the open project is kept) or the end of the current
  route (one command, "Import RXP guide": one undo removes all of it). "Percent coordinates in
  Mulgore, Eastern Plaguelands, Redridge Mountains and Stormwind City": Forever maps (default) or
  Era maps (`options.changedZoneFrame`, docs/RXP.md §10.4). Without project storage only the route
  is offered.
- *Check guide* runs unwrap, CST, diagnostics and lowering with throwaway ids and shows the result
  in a region that takes focus: the guide's name and size ("One guide, “…”: 18 RXP steps, 40 route
  steps; 2 warnings, 5 notes"), or for a Lua file each guide as a checkbox (all chosen). Changing an
  option checks the same text again without moving focus; editing the text marks the result stale,
  and Import waits for a new check. A problem ("Paste guide text or open a file first.") takes
  focus on every attempt, the same one again included (UI-F12). A press on the backdrop keeps the
  text and the check (§9 rule 7).
- *Diagnostics* (`RxpDiagnosticList`): in line order (for a Lua file, lines of the file, with
  "in “guide”" after the line of a guide's own diagnostic), each with its severity shape and word,
  "Line 12, column 5", the message, the code and, where it applies, "RestedXP itself drops or
  changes this". An item with a line is a button; pressing it shows the line right after it
  (`SourceExcerpt`: two lines either side, the line marked with ▶ and a tint, its column outlined),
  and pressing it again hides it. Counts by severity ("2 errors, 14 warnings, 30 notes"), a Show
  filter (all, errors and warnings, errors) and pages of 100.
- *Refused.* A RestedXP protected import string (docs/RXP.md §3.3) is refused with `RXP019`'s
  sentence and why: those strings are licensed to one account; nothing is decoded, decrypted or
  kept. Closing the dialog clears the text field, whatever it held.
- *Quests the data lacks* (docs/RXP.md §15.4, ARCHITECTURE §5.5): listed with how many steps use
  each and a "Show line n" disclosure. "Add them as placeholder custom quests" (the default) adds
  each with its real id, named "Quest 76156 (placeholder from an RXP guide)", and nothing else: the
  name in the game, level, objectives, givers and XP stay unknown until the user enters them.
  "Leave them unknown" keeps only the ids on the steps; the validator warns about them (Milestone
  6). Appending counts the project's custom quests as known; a new project is checked against the
  data alone.
- *Import* adds exactly what the check showed (the pipeline is deterministic; it runs again with the
  store's ids) and keeps every guide's text in `project.imports`. It is `aria-disabled` with the
  reason beside it until then ("Check the guide first.", "The text or the options changed since
  the check: check it again.", "This input is refused.", "Choose at least one guide."). The result
  is announced: "Imported “Guide”: 40 steps added as steps 13 to 52. 1 placeholder custom quest
  added (900001). Undo with Ctrl+Z.", or the session's "Imported “Guide” as a new project and
  opened it." with "It has 40 steps."

**Export** (`RxpExportDialog`, from the Export dialog's "Export RXP custom guide").

- It says what the text is: "Byte-identical to the imported guide “…”" (the route is that guide,
  unedited: docs/RXP.md §13.3 rule 1), "Not byte-identical to an imported guide: … RXP steps left
  unedited keep their original lines; edited, split and new steps are written in canonical form.",
  or "Canonical form: nothing in this route came from an imported RXP guide …". A route that
  cannot be written says so and names each step ("Step 12: a .complete target that means all
  objectives"); nothing can be copied or downloaded then.
- Format: "Guide text (.txt)" or "Custom-guide addon file (.lua)" (the text in
  `RXPGuides.RegisterGuide(…)`, with the group and defaultFor arguments of a two- or
  three-argument import). A read-only preview of the chosen text, "Copy" (to the clipboard, with
  "Copied" and a tick beside the button for a few seconds; when the browser refuses, the preview
  is selected and a note says to press Ctrl+C, without the browser's own error text) and "Download
  <name>.txt" or "Download <name>.lua" (the route's name, else the project's; plain text, UTF-8,
  line endings as exported).
- "What the export cannot keep": the export diagnostics (RXP040-RXP046, docs/RXP.md §11.1) in the
  same list; one on a line of an imported guide shows that line.

**Checked by hand.** Not yet. The component tests cover behaviour, keyboard paths, names, focus
and announcements (happy-dom has no layout). The dialogs are at most 880 px wide
(`min(880px, 100vw - 32px)`) and scroll inside; the layout at 1366×768, 1024×768 and 720px and the
dark theme are still to check in a browser.
