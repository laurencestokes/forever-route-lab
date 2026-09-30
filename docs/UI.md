# UI

The visual system and component kit of Forever Route Lab: tokens, reserved hues, typography,
density, layout, the component inventory, accessibility rules, and how to add a component.
Authoritative for everything under `src/ui/` except `src/ui/App.tsx`, which wires the kit to the
store. Related: [ARCHITECTURE.md](ARCHITECTURE.md) §12.4 (layout and visual rules), §4
(dependency rules).

## 1. Principles

1. **Ours in look.** The product is "Forever Route Lab". The information architecture follows common
   route-planner practice: a dense numbered route list on the left, a large map in the centre,
   quests and details on the right, a toolbar at the top and a status bar at the bottom. The layout
   and affordances may follow WoWF-QRP (D-046: the route's quests with "!" and "?" marks, the quest
   lists, the buttons); the glyphs, the code and the palette are ours (warm neutrals, D-048 E). No
   name, branding, parchment or gold look, icons or assets are taken from any other planner or from
   the game. Every icon and glyph here is an original inline SVG; the "!" and "?" are our own paths
   (`src/map/marks.ts`).
2. **Dense and desktop-first.** 13px interface text, 28px one-line route rows, 28px controls (24px
   small). The layout degrades in steps below 1280px and stacks below 720px.
3. **Meaning is never carried by colour alone.** Every coloured signal also has a shape, a glyph
   or text, and a spoken form.
4. **Reserved hues mean one thing each.** The five difficulty colours mean quest difficulty and
   nothing else. Cyan means Forever provenance and nothing else.
5. **Unknown stays unknown.** An unknown number renders as `?` with its reason (tooltip and
   screen-reader text), never as `0` or an empty bar. Lower bounds read `≥`, upper bounds `≤`; a
   number bounded in no known direction is unknown. Numbers that depend on assumptions carry the
   assumed marker.
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

The neutrals are **warm** (D-048 E; ui-refresh.md §9.5): low saturation (every surface's channels
within 6%, hue 30° to 45°), never parchment or gold. The accent, severity, difficulty and provenance
colours are unchanged, so the difficulty colours still sit on near-neutral ground.
`tests/ui-tokens.test.ts` checks the surfaces stay neutral.

| Token | Light | Dark | Purpose |
|---|---|---|---|
| `--frl-bg` | `#e3ded5` | `#0f0e0c` | App backdrop; shows as 1px gutters between panels |
| `--frl-surface` | `#fdfcfa` | `#1a1815` | Panel and row background |
| `--frl-surface-raised` | `#f6f4f0` | `#201e1a` | Top bar, panel headers, tab strip, status bar, group rows |
| `--frl-surface-hover` | `#eeebe5` | `#2a2722` | Row and ghost-button hover |
| `--frl-surface-sunken` | `#ebe7e0` | `#141210` | Map area |
| `--frl-surface-later` | `#ebe7e0` | `#11100d` | The band under the route steps after the selection (D-048 B; drawn by UR.3). Decorative: 1.19:1 and 1.10:1 against the surface; every text pair on it passes |
| `--frl-tile` | `#e2ddd4` | `#2d2a24` | The default button's fill, segmented controls, step discs (visibly filled: 1.2 to 1.3:1 on the panels; the edge carries the shape) |
| `--frl-tile-hover` | `#d8d2c7` | `#36322b` | The default button's fill on hover, when its edge takes `--frl-fg-muted` |
| `--frl-border` | `#dcd6cc` | `#35312a` | Hairlines and row separators (decorative) |
| `--frl-border-strong` | `#777064` | `#827a6d` | Control edges, the hollow and dashed quest-mark rings and badge rims, and the dashed edge of an uncertain difficulty chip (3:1 on every surface, the tile, hovered, selected and later rows, and against the difficulty well) |
| `--frl-fg` | `#1b1916` | `#ebe7e0` | Primary text |
| `--frl-fg-muted` | `#4f4a42` | `#b4ac9f` | Secondary text, labels, glyphs; the default button's edge on hover (5:1 or more on the hover tile) |
| `--frl-fg-subtle` | `#635d53` | `#9c9487` | Tertiary text: step numbers, details (still 4.5:1) |
| `--frl-fg-disabled` | `#a39c90` | `#5f584e` | Disabled controls only (exempt from contrast) |
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
| `--frl-danger` | `#b0157f` | `#ff7ac8` | Destructive actions (the danger button's text and edge). The error hue on purpose: destructive and error share one meaning, "this loses or breaks something" |
| `--frl-danger-bg-hover` | `#fbe9f3` | `#3b1731` | The danger button's hover fill |
| `--frl-forever` | `#006d7d` | `#3ccfe0` | **Reserved:** Forever provenance glyphs and text |
| `--frl-forever-bg` | `#e0f3f6` | `#0f2f35` | Background of the full provenance badge |
| `--frl-assumed` | `#635d53` | `#b4ac9f` | Assumed and Era-fallback markers (neutral on purpose) |
| `--frl-xp-track` | `#e2ddd4` | `#2d2a24` | XP and progress bar track |
| `--frl-xp-fill` | `#3a4fc4` | `#8ea2ff` | XP and progress bar fill |
| `--frl-xp-tick` | white at 60% | page ink at 60% | The XP bar's 20 tick marks (drawn by UR.5; decorative, dropped under forced colours) |
| `--frl-xp-hatch` | accent at 35% | accent at 35% | Lower-bound hatching beyond the known XP (supplementary: the notch and `≥` carry the lower bound) |
| `--frl-unknown-hatch` | `#737d8b` | `#707c8e` | Hatching of unknown bars: unknown XP, and indeterminate progress under reduced motion (3:1 on the track, so an unknown bar never passes for an empty one) |
| `--frl-placeholder-stripe` | ink at 6% | ink at 5% | Hatching of the Placeholder label (decorative: the dashed edge and the word carry it) |
| `--frl-map-grid` | ink at 8% | ink at 7% | Grid of the map placeholder |
| `--frl-map-frame` | `#6b7482` | `#7a8699` | Zone-frame and extent outlines on the map canvas and in the map key, at full opacity (3:1 or more on `--frl-surface-sunken` and on `--frl-surface`, the frames' fill: 3.99 and 4.72 light, 4.97 and 4.78 dark; WCAG 1.4.11, M3 review MAP-A11Y-6). The canvas reads it as the `frame` role (MAPS.md §7.5) |
| `--frl-overlay` | ink at 45% | black at 60% | Dialog backdrop |
| `--frl-shadow` | soft | deeper | Floating cards and dialogs |
| `--frl-difficulty-well-border` | `#101216` | `#3a4350` | Edge of the difficulty chip |
| `--frl-map-label-halo` | white at 85% | near-black at 85% | The painted map style's label halo, laid under its labels and the selection ring (map-presentation.md §25.5, §25.6) |
| `--frl-map-hatch` | black at 35% | white at 35% | The map's optional faction hatching (D-039 C; decorative: the words carry it) |

### 3.2 Colour (theme-independent)

| Token | Value | Purpose |
|---|---|---|
| `--frl-difficulty-trivial` | `#808080` | **Reserved:** trivial (grey) |
| `--frl-difficulty-standard` | `#40bf40` | **Reserved:** standard (green) |
| `--frl-difficulty-difficult` | `#ffff00` | **Reserved:** difficult (yellow) |
| `--frl-difficulty-verydifficult` | `#ff8040` | **Reserved:** very difficult (orange) |
| `--frl-difficulty-impossible` | `#ff1a1a` | **Reserved:** impossible (red) |
| `--frl-difficulty-well` | `#101216` | Dark chip behind difficulty colours, in both themes; the glyph and keyline of a filled quest mark, drawn on the difficulty-coloured disc (the same pair, 4.75 to 17.46:1) |
| `--frl-difficulty-pip-off` | `#2a3039` | Unlit difficulty pips (every lit pip reaches 3:1 against it) |
| `--frl-difficulty-unknown` | `#c9ced6` | Level text when difficulty is unknown (not a difficulty); the fill of a filled quest mark whose difficulty is unknown |

The map's own tokens are theme-independent because the map's bases are (map-atlas.md §6.2, §19.3;
map-presentation.md §25.5; `tests/ui-tokens.test.ts` checks their contrast and hue distances):

| Token | Value | Purpose |
|---|---|---|
| `--frl-map-sea-deep`, `--frl-map-sea-coast` | `#3d3729`, `#837658` | The painted atlas's water, deep offshore and at the coast (D-042 O3) |
| `--frl-map-frame-atlas` | `#e8dfc8` | Frames and captions over the atlas tiles (the Zephras Isle card, the city cards) |
| `--frl-map-sea-navy` | `#0d1b30` | The minimap style's one even navy sea (D-045 item 4, D-049 O12), 15 or more (CIEDE2000) from both cyan tokens |
| `--frl-map-pin`, `--frl-map-pin-glyph` | `#101216`, `#f2f2f2` | The pins' dark body (the difficulty well) and light keyline; the light family (services) swaps them (D-047) |
| `--frl-map-minimap-ink`, `-ink-muted`, `-halo`, `-route` | `#f2f2f2`, `#c8cdd4`, near-black at 85%, `#8ea2ff` | The minimap style's ink set: labels and borders, network lines, the halo under both, the route line and the selection ring |
| `--frl-map-drawer-width` | 300px | The Map layers drawer (map-presentation.md §25.3.1) |

The difficulty colours are drawn **on or under the well**: on it in the chip, and under it in a
filled quest mark, whose disc takes the colour beneath the well's "!" or "?" (ui-refresh.md §5.1).

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
| `--frl-row-height-two-line` | 40px | Two-line route rows, the default density from UR.3 (D-048 A); `ROUTE_ROW_HEIGHT_TWO_LINE` will equal it |
| `--frl-control-height` / `-sm` | 28 / 24px | Buttons, inputs, selects / small buttons and each segment of a segmented control. 24px meets WCAG 2.2 target size (2.5.8) without relying on spacing; a small button leaves 4px above and below in the 32px status bar for the ring. The route rows' in-row affordances are 20 × 16px under 2.5.8's equivalent exception (§9 rule 13) |
| `--frl-topbar-height`, `--frl-statusbar-height` | 44px, 32px | Shell bars |
| `--frl-tab-height`, `--frl-panel-header-height` | 36px, 32px | Tab strip, panel headers |
| `--frl-left-width`, `--frl-right-width` | 340px, 340px | Route panel (320-380px, set by `AppShell`), side panel |
| `--frl-gap` | 1px | Panel gutters |
| `--frl-radius-sm` / `--frl-radius` / `-lg` | 3 / 4 / 8px | Badges / fields and panels / cards and dialogs |
| `--frl-radius-control` | 6px | Buttons, icon buttons, segmented controls, search fields |
| `--frl-mark-size` / `-compact` | 22 / 18px | Quest and step marks in two-line and one-line rows and in quest lists |
| `--frl-focus-width` | 2px | Focus ring width |
| `--frl-duration-fast` / `--frl-duration` / `--frl-ease` | 90 / 140ms, ease-out | Transitions; 0 under reduced motion |
| `--frl-z-sticky` / `--frl-z-drag` | 10 / 20 | Splitter / drop line |
| `--frl-z-popover` | 1200 | The route summary's panel (§16): above the map's own layers and overlays (`MapFrame.css` uses 1100), below modal dialogs (the top layer) |

`ROUTE_ROW_HEIGHT` in `src/ui/route/virtual.ts` must equal `--frl-row-height`;
`tests/ui-tokens.test.ts` checks it.

## 4. Reserved and semantic signals

| Signal | Colour | Non-colour cue | Text |
|---|---|---|---|
| Quest difficulty | the five reserved colours, on the dark difficulty well | 1-5 filled pips (trivial 1 … impossible 5): 2px bars with 1px gaps on whole pixels, crisp edges, lit 3:1 against unlit | "Difficult (yellow)" in the tooltip and screen-reader text; visible word in `full` variant |
| Quest-mark difficulty (`QuestMark`) | the reserved colour fills the disc under the well's "!" or "?", with a well keyline; only on a disc of 11px or more (22 and 18px, so always in rows), D-041 G as D-047 words it | the pips on the chip beside the mark | the row's or list item's name |
| Quest-mark state (the one table, map-presentation.md §25.2.3) | none | filled or hollow; a dashed ring for "not sure"; the lock, level or progress-pie badge top right, the dungeon-quest arch top left; "!" or "?" | "May be available: …", "Needs …", "Ready to turn in", "1 of 3 objectives done" |
| Step kind (`StepMark`) | none | the glyph on a neutral disc (the tile, a hairline edge); the map's flight point, vendor and innkeeper pins are the filled forms of the same glyphs (one symbol per concept) | the kind in the row's name |
| Destructive action | `--frl-danger` (the error hue, by design) | the delete icon or the words "Delete …" | the label |
| Pressed toggle, expanded disclosure | accent | the doubled accent edge and bold text (a 2px `Highlight` edge under forced colours) | `aria-pressed`, `aria-expanded` |
| Difficulty from a lower-bound level | same | dashed chip edge in `--frl-border-strong` (3:1 on every row state) | "…from a lower-bound level: may be easier" |
| New in Forever | cyan | ◆ glyph | "New in Forever (per the dataset)" |
| Changed in Forever | cyan | ◇ glyph | "Changed in Forever (per the dataset)" |
| …declared by the user | cyan | dashed frame around the glyph | "(user-declared)"; "· user-declared" in `full` |
| Forever status unknown | none | nothing in rows | "Forever status: unknown" in Details (`full` variant) |
| Assumption-dependent number | neutral | `≈` with dotted underline | "Depends on assumptions: …" |
| Era value standing in for Forever | neutral | boxed `E` | "Uses Era values where Forever values are unknown" |
| Lower bound | neutral | `≥` prefix; XP bar notch and hatching beyond it | "at least …", "(lower bound: …)" |
| Upper bound | neutral | `≤` prefix (XP per hour when some steps' time is unknown, §16) | "at most …", "Upper bound: the true value is at most this" |
| Unknown number | neutral | `?` (for XP, "XP ?" at every width); XP bar hatched at 3:1 with a dashed edge; indeterminate progress never drawn as a partial fill | "Unknown: <reason>" |
| Pending (provisional) number | neutral (`--frl-assumed`) | hourglass after the number, the number in italics; in a route row, the hourglass in the step-time column's left gutter only (the level and XP never wait for walking paths, so they never carry it) | "Pending: …" (the walking path is still being computed, or the navigation data is still being checked, so the travel time is a straight-line estimate for now) |
| Error / warning / info | magenta / violet / blue | octagon × / triangle ! / circle i | "Error", "Warning", "Info"; counts in words ("2 errors, 1 warning, 3 info issues": never "notes", a step kind) |
| Selection | accent tint | 3px left bar (a 4px `Highlight` strip under forced colours) | `aria-selected` |
| Keyboard focus | accent | 2px ring (active row: inset ring) | — |
| Placeholder content | none | dashed, hatched "PLACEHOLDER" label | "Placeholder <what>" |

Rules:

- Difficulty colours appear only through `DifficultyLabel` or components built on its rating: the
  quest mark (`QuestMark`) and the map's pins. `tests/ui-tokens.test.ts` allows only the chip's and
  the mark's rules (`.frl-difficulty--*`, `.frl-quest-mark--*` in `markers/markers.css`) to read
  `--frl-difficulty-*`, and no component to set them in a style attribute.
- The "!" is never in a triangle (the warning shape) and never in a gold of its own: its only
  colours are the five difficulty colours, on a disc.
- Cyan appears only through `ProvenanceBadge`.
- Severity, danger, accent and provenance hues sit at least 30° of hue away from every difficulty
  hue, and the severity, danger, accent and XP hues at least 25° away from the provenance cyan;
  `tests/ui-tokens.test.ts` checks both in each theme.
- Validation never borrows difficulty red or orange, and difficulty never uses the severity icons.
- *Milestone 6:* the issue indicators, the Validation tab's counts and its issues use the three
  severity tokens above (§3.1, unchanged since Milestone 1, already checked for hue distance and
  contrast); the pending hourglass, the simulation's status and the route summary use neutral
  tokens only. No new colour token was needed, so none reuses a difficulty or provenance hue.

## 5. Typography, spacing and density

- Interface text is 13px on an 18px line; secondary text 12px; small caps labels (panel
  sections, status bar labels) 11px bold with letter spacing.
- Numbers that line up use tabular figures (`frl-num`).
- Route rows have one fixed height per list (D-048 A): two lines of 40px by default, one line of
  28px as View's compact choice. Line 1 starts with the verb ("Accept", "Turn in", "Travel"); long
  titles ellipsise and details live in the right panel. Group headers are rows of the same height.
- Controls are 28px (24px small and inside rows). Icon buttons are square.
- Panels are separated by 1px gutters of `--frl-bg`, not by borders, so the panel edges stay crisp
  in both themes.

## 6. Layout

`AppShell` is a CSS grid:

```
┌────────────────────────── top (44px) ──────────────────────────┐
│ left 300-460px  │           centre (flexible)       │ right 300-460px │
│ route editor    │           map / placeholder       │ side panel  │
├────────────────────────── bottom (32px) ───────────────────────┤
```

| Width | Behaviour |
|---|---|
| > 1440px | Everything visible; action buttons show icon and word |
| ≤ 1440px | The status bar's route XP total hides (the route summary keeps it, §16); the optimiser item, while it is unavailable, leaves the view (still in the page, so still spoken) |
| ≤ 1280px | Status bar gaps tighten to 8px; the identity badges drop their key words from view ("65c377bc", "forever-beta"; "Data" and "Ruleset" are still spoken and in the tooltips); "In log" leaves the status bar (the Quest log tab and its name say it) |
| ≤ 1200px | Top-bar action words become visually hidden (icon buttons with names and tooltips); the character button drops "· Horde" and keeps "Orc Warrior" |
| ≤ 1180px | XP numbers in the status bar hide (the bar and its spoken value stay, and an unknown value keeps its visible "XP ?") |
| ≤ 1100px | The XP track narrows to 64px; the character button shows its settings glyph alone (its name stays "Orc Warrior · Horde, settings") |
| ≤ 1024px | Two columns: the route panel keeps the full height (36%, min 280px); the side panel moves under the map; the splitter hides (the map's Map layers drawer lies over the stage there, §12); the status bar may take a second line rather than cut anything, and its grid row follows it |
| ≤ 900px | The product name hides (the mark stays) |
| ≤ 720px | One column; the page scrolls; top and status bars wrap; the open route summary is laid out in the flow under its button |

**Status bar priorities** (Milestone 6 review UI-01, UI-02; ui-refresh.md §8). Items never shrink.
The level and its place ("Lv 4 after step 12") replace the Step item and its title: the active
step's number and title are the level's tooltip, and the selected row names the step;
the simulation item (§16) keeps its label, progress bar, count and Cancel or Resume whole, its
words capped at 160px (the longest state, "Some straight-line estimates", is 151px). The bar clips
sideways only (`overflow-x: clip`): it is never a scroll container, so focusing an item cannot
scroll it, and nothing in it clips a focus ring (the 22px buttons sit in the 32px bar with room
for the 2px ring and its 1px offset). Checked in the built app with walking paths held computing,
paused, the navigation data held checking, a map's navigation files failing and none available:
at 721, 800, 900, 1024, 1100, 1200, 1280, 1366, 1440 and 1600px, in both themes, the bar's
content ends inside it, no item's content is cut, every state's words are whole, and Cancel and
Resume, focused by keyboard, lie inside the bar with a complete ring (and under forced colours).

**Side panels** (ui-refresh.md §4.1 to §4.3). Both panels are resizable: pass `leftWidth` and
`onLeftWidthChange` (or `rightWidth` and `onRightWidthChange`) and `AppShell` renders a
`separator` on the panel's inner edge (pointer drag; ←/→ move the splitter by 4px, Shift for 20px,
so ← widens the right panel; Home/End for the limits). Widths are clamped to 300-460px
(`clampLeftWidth`, `clampRightWidth`), 340px by default. With `layout` and `onLayoutChange` either
panel collapses and comes back three ways: its **handle**, an 18 × 44px tab on the map's edge below
the map's top row ("Hide the route panel" ‹ / "Show the route panel" ›, and the same for "the quests
and details panel"); **Enter on its separator** (the window splitter's collapse key,
`aria-keyshortcuts="Enter"`); and **map focus**, a pressed toggle at the map's top right ("Map
focus", Alt+M) that hides both and restores them as they were. Showing one panel from map focus ends
map focus with that panel alone. A collapsed panel is not drawn (`hidden`) and its grid column goes;
below 1024px a collapsed side panel no longer moves under the map. Focus never stays on something
hidden: collapsing from a handle or a separator puts focus on the handle that now shows it,
restoring from a handle puts it into the panel (the route list, or the selected tab), and when Alt+M
hides the panel that has focus, focus moves to the Map focus toggle. As built (review UI-18), the
Map focus toggle keeps focus when it ends map focus, as a toggle button does (ui-refresh.md §4.3's
"restoring moves focus into it" holds for the handles); and a separator, hidden with its panel,
cannot restore it: Enter on a separator collapses, and the handle restores. The handles sit in the
DOM after the route panel and before the side panel, so each takes its hidden panel's place in the
tab order. While the Map layers drawer is open, the route panel's handle sits on the drawer's outer
edge rather than over its first row (review PR-08, UI-10, QA-11). At 1024px and below, where the
side panel sits under the map, its handle is on the map's bottom edge (the panel's own top edge),
left of the Map view toolbar, with its chevron turned down to hide the panel and up to show it
(review QA-21). When a panel beside the map collapses or comes back, the map pans by as much as its
edge moved, so what is on the map stays where it was on the screen and the new room shows more map
(review QA-16). The centre is a stacking context of its own (`isolation: isolate`), so the map's panes
stay inside it and the handles and the separators' overhang are drawn over the map and take the
pointer. The widths, the collapse flags and map focus are kept per browser (§11). Until MP.4b
floats the map's controls, the Map focus toggle sits at the right end of the map's toolbar row,
which keeps room for it.

**Route panel** (ui-refresh.md §4.1). One job, no tabs: a 36px header (the open project's name,
which opens the Projects menu and which Rename… changes, §13; View; Undo and Redo), a meta line ("55
steps · 1 selected · Orc Warrior from level 1", and a second line for a sample route or
placeholder data, which carries its Sample or Placeholder tag, so the name keeps about 200px of the
header; review UI-07), the list, the step toolbar and the Add footer ("Add after step 12": Grind,
Travel, Hearth, Train, Buy, Note; the buttons wrap onto a second line in a narrow panel). **View**
is a non-modal disclosure like the status bar's Summary (Escape, the button, a press outside or
focus leaving it closes it; Escape returns focus to the button): "Rows" (Two lines, One line),
the two-line rows' "Top number" (XP gained, Step time) or the one-line rows' "Rows show", and the key
to the marks, which replaces the banner's always-visible key. Its popup is placed in the header,
right-aligned with a 6px gutter and at most the panel's width less 12px, so it stays inside the
panel at every width from 300 to 460px (review UI-03, QA-07).

**Side panel tabs** fill the strip (equal shares of the room their words leave) and are 36px tall;
the selected tab has body-colour bold text and the 2px accent bar. A tab's name starts with its
visible label: "Quest log, 4 quests after step 12", "Validation, 1 error" (WCAG 2.5.3).

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

**Map panel.** The centre is the map (§12; map-presentation.md §25.3.0): the stage takes the whole
region and its controls float on it (Map layers at the top left, Map focus at the top right, the
Map view toolbar at the bottom right, the caption at the bottom left). The 300px Map layers drawer
docks on the stage's left from a 900px map region (a container query) and lies over the stage's
left edge below that. Below 560px the caption's "Schematic map: zone frames, not terrain" shows its
short form, "Schematic" (the full text stays its tooltip and starts the map's instructions, M3
review MAP-A11Y-13). Beside a drawer that lies over the stage, the caption moves to the drawer's
right, as Map layers does, and its lines wrap there, so a pick's instructions stay visible (review
QA-12); the Viewing chip keeps to the room between Map layers and Map focus, ellipsised (its words
stay whole for assistive technology; review PR-08, QA-13); and in a map under 560px an open drawer
hides the Map view toolbar, the scale and the Viewing chip until it closes, rather than have them
draw over it (review QA-14). "Both continents" in the top bar's "Go to zone or view…" fits the
whole atlas, the inset card included, on every choice, also when the atlas is already shown
(review QA-03).

**Checked by hand.** happy-dom has no layout, so the tests check the mechanism (containing blocks,
overflow, grid areas; `tests/ui-tokens.test.ts`) and these results are checked in a browser after
layout changes (UR.3 to UR.6 add: with either panel collapsed and in map focus, the page still
never scrolls and every bar keeps its controls inside it): at 1920×1080, 1366×657, 1280×600, 1201×700, 1100×700 and 1024×768, in both
themes, with Details open on a quest step, `document.documentElement.scrollHeight` equals
`innerHeight`, `window.scrollTo(0, 500)` moves nothing, and with the drawer docked the bounding
rectangles of `.frl-mapframe__stage` and `.frl-mapframe__drawer` do not intersect (MP.4b: not yet
checked in a browser; the tests check the order and classes only). *Milestone 3:*
checked at 1366×768 in the built-in browser, light theme only (the page does not scroll with the
layer panel open; stage 424px and panel 260px wide, side by side); the other sizes and the dark
theme are still to check.

## 7. Component inventory

All exported from `src/ui/kit.ts`.

| Component | File | Purpose and key props |
|---|---|---|
| `AppShell` | `shell/AppShell.tsx` | Grid frame: `top`, `left`, `centre`, `right`, `bottom`; `leftWidth`, `onLeftWidthChange`, `rightWidth`, `onRightWidthChange` (300-460px); `layout` (`ShellLayout`: `leftCollapsed`, `rightCollapsed`, `mapFocus`) and `onLayoutChange`, which add the panel handles, Enter on the separators and the Map focus toggle (§6) |
| `TopBar` | `shell/TopBar.tsx` | Product, quest search (`search`), "Go to zone or view…" (`zones`), the character button (`character`: "Orc Warrior · Horde", opens Settings, D-048 D), Import, Export, theme toggle, About (ui-refresh.md §8) |
| `RouteList` | `route/RouteList.tsx` | Virtualised listbox of `RouteRowModel`s; controlled `activeIndex` and `selectedKeys`; selection, editing and drag callbacks by index (§8); `density` (`two-line`, the default, or `one-line`); `deriveRow(row, index)` and `deriveGroup` fill a row's derived values as it renders (only mounted rows ask); `topNumber` (two-line rows) and `estimateColumn` (one-line rows) pick the numbers (§8, §16); `insertAt`, the row boundary where new steps go, draws the insertion line and the later band |
| `StepRow`, `GroupRow` | `route/StepRow.tsx` | One route row (§8): two lines of 40px (the number, which is the drag handle; the mark; line 1 with the verb, title, chain, provenance, issue marker and lock; line 2 with the chip and where, or the worst issue in words, and the row actions; the top number over the level after) or one line of 28px (`density="one-line"`: the 18px mark, the verb and title, one estimate by `estimateColumn`, the lock; duplicate and delete on hover or when active). `groupLabel` for the spoken "in group …". `describeStepRow` says the row in a fixed order (number, kind, title with its chain part and where, group, the mark's state, difficulty, provenance, every estimate with a level-up, the issues and the worst one's words, the lock), never doubling a full stop; `formatXpGained` (`+450`) |
| `StepTypeGlyph` | `markers/StepTypeGlyph.tsx` | Original glyphs for accept, complete, turnin, abandon, travel, grind, hearth, flight, train, vendor, note (16, 14 or 12px) |
| `QuestMark` | `markers/QuestMark.tsx` | A quest's "!" or "?" in a row or a quest list (ui-refresh.md §5.1), 22px (`md`) or 18px (`compact`), in one of the eight quest-mark states of the one table (`src/map/marks.ts`, read through `app/map-exports` as the same objects the map's pins draw). Filled states take the difficulty colour on the disc with a well glyph and keyline (an unknown difficulty takes the neutral `--frl-difficulty-unknown`); hollow states are a strong ring with an ink glyph; "not sure" is a dashed ring; badges sit in the map's slots (`progress` fills the pie, `unlockLevel` the level pill, `dungeonQuest` the arch). `questMarkColour` says when the mark is coloured, so the caller draws the chip's pips beside it. Decorative (`aria-hidden`) |
| `StepMark` | `markers/StepMark.tsx` | The other step kinds on a neutral disc (the tile, a hairline edge) with `StepTypeGlyph` in the muted ink, 22 or 18px; decorative |
| `DifficultyLabel` | `markers/DifficultyLabel.tsx` | Quest level chip with difficulty colour, pips and text; `uncertain` for lower-bound levels |
| `ProvenanceBadge` | `markers/ProvenanceBadge.tsx` | ◆ / ◇ in cyan, user-declared variant; `compact` or `full`. `foreverProvenanceOf(record.provenance)` derives its input |
| `AssumedMarker` | `markers/AssumedMarker.tsx` | `≈` (assumption) or `E` (Era fallback) with text |
| `PendingMarker` | `markers/PendingMarker.tsx` | The neutral hourglass of a provisional number, with its words (`detail`, default `PENDING_TRAVEL_TEXT`; `PENDING_TRAVEL_TEXTS` by `PendingTravel`: `path`, `retrying`, `paused`, `failed` or `checking`, from the route-wide `pendingTravelReason`, Milestone 6 review UI-04); `silent` inside a route row, whose name says it |
| `ReadoutValue` | `markers/ReadoutValue.tsx` | Renders a `Readout<T>`: `≥` (lower bound, "at least"), `≤` (upper bound, "at most"), markers, `?` with reason; `pending` (a sentence) draws the value in italics with the pending marker |
| `SeverityIcon` | `markers/SeverityIcon.tsx` | Error, warning, info shapes |
| `SidePanel` | `shell/SidePanel.tsx` | Tabs Available, Quest log, Details, Validation with counts (`questLog`: the tab's count and its words); one content node per tab |
| `Tabs` | `shell/Tabs.tsx` | Accessible tablist, controlled, automatic activation; one tabpanel that every tab controls |
| `PanelSection`, `EmptyState` | `shell/PanelContent.tsx` | Side-panel building blocks |
| `QuestGrid`, `QuestGroupHeader`, `QuestListItem`, `QuestObjectiveRow` | `shell/PanelContent.tsx` | The quest lists as WAI-ARIA layout grids (ui-refresh.md §5.4, §5.5, §9.3): one tab stop that remembers its item (moved through the DOM, not React state); ↑ ↓ between rows, group headings included; ← → along a row; Home and End; Ctrl+Home and Ctrl+End; PageUp and PageDown by ten rows (`gridKeyTarget`); described by `QUEST_GRID_KEYS`. `QuestGroupHeader`: a sticky 28px row whose one `rowheader` takes focus and says the group ("Razor Hill, Durotar 5-12, 6 quests"). `QuestListItem` (memoised): the `QuestMark` in its state, the name as a button that opens Details (`nameLabel` says the row), the chain and provenance; line 2 with the chip beside a coloured mark and the giver or reason; `needs` ("Needs <prerequisite>" as a link and Accept first as the next cell); `actions` at the row's end (Accept; Objectives done and Turn in), `aria-disabled` with their reason when unavailable. `QuestObjectiveRow`: ○, ✓ or ? with its words, and Done here while it is open |
| `DetailList`, `IssueList` | `shell/DetailParts.tsx` | Term/value pairs for Details; `IssueList`: severity shape and word, message, where (step or "Route"), code and the code's `explanation`; with `onSelect` the issues about a step are buttons named in words (`describeIssue`: "Error, step 12: … (VAL004-min-level)", described by the explanation) forming one composite: one tab stop, ↑ ↓ Home End between them (§16). Only the lazy parts use them, so they are imported from their file (the kit exports their types only, §11) |
| `StatusBar` | `shell/StatusBar.tsx` | "Lv 4 after step 12" and the XP bar (the level merges with `currentStep`, whose title is the level's tooltip), the route's duration, XP (`xpGained`) and XP/hour with the pending marker while `provisional`, "In log 4 / 40" (`questLog`), the `summary` and `simulation` slots, optimiser state and progress, data and ruleset badges |
| `RouteSummary` | `shell/RouteSummary.tsx` | The "Summary" disclosure in the status bar: a table of the route metrics (`rows`: term, value, basis in words), `notes` and every parameter the route reads (`parameters`, each with its origin), opened above the status bar (in the flow at 720px and below); Escape, the button, a press outside or focus leaving it closes it (§16) |
| `SimulationStatus` | `shell/SimulationStatus.tsx` | The simulation's item in the status bar (`SimulationStatusModel`): loading, failed, checking navigation data, computing walking paths (progress bar, or counting while the total is unknown; `onCancel`), paused (`onResume`), straight-line travel with the reason; nothing when there is nothing to say, unless it holds keyboard focus (§16) |
| `XpBar` | `shell/XpBar.tsx` | Level and XP progressbar (200 × 12px, 20 decorative ticks in `--frl-xp-tick`) with lower-bound, unknown and cap states; `after` ("after step 12") shown small after the level |
| `MapFrame`, `MapHoverText`, `useMapRegionDocking` | `shell/MapFrame.tsx` | The map panel's frame (§12), memoised: the stage takes the region and the controls float on it: the Map layers toggle (a disclosure, `aria-expanded`), the claimed Map focus toggle, the Map view `Toolbar` of `MapCommand`s in groups (zoom; fit and focus; unavailable ones `aria-disabled` with their reason), the caption (the always-visible map-kind `notice` with `noticeShort` for narrow maps, the `caption` lines and the `hover` text, a string or an element that renders `MapHoverText` so only it re-renders; never a live region), the `stageRef` host the engine mounts into, the visually hidden instructions (`instructionsId`), the `drawer` (docked from a 900 px region, `useMapRegionDocking`, else over the stage), and `choice`: the items at a clicked point where several share it (a `dialog` beside the point, `mapChoicePosition`; focus on the first item, arrows, Home and End, Escape or a press outside closes); `engine` shows loading, failed (with "Try again") or unavailable over the stage |
| `MapCategoryDrawer`, `DrawerIconView`, `MapKey` | `shell/MapCategoryDrawer.tsx`, `shell/MapKey.tsx` | The Map layers drawer (§12), a lazy part: the style `SegmentedControl`, the notices, the `SearchField` with its results (a roving tabindex, Up from the first back to the field), Show all, Hide all and Defaults, the groups (each one stop: a roving tabindex over the group's mixed-state `Checkbox` and its rows; unavailable rows `aria-disabled` with their reason), and `MapKey` (pins, badges, route lines, the atlas's arcs and insets, the base maps' notices and which is shown, `MAP_GRID_NOTE`) in a closed disclosure. `DrawerIconView` draws a row's pin in monochrome with the map's own paths, or a line or area swatch, as an inline SVG in `currentColor` (`aria-hidden`) |
| `MapPlaceholder` | `shell/MapPlaceholder.tsx` | *Milestone 1-2 centre panel, no longer rendered by the app (Milestone 3).* Kept, with its CSS, because `tests/ui-tokens.test.ts` checks its card-and-stub grid; it can go once that check moves to `MapFrame` |
| `AboutDialog` | `shell/AboutDialog.tsx` (a lazy part: the kit exports its props type only) | Licence (GPL-3.0-or-later) and no-warranty line, data notice (D-016, with the LIC-10 carve-out verbatim; with `dataUpstreamCommit` set it is the real-data notice with the pinned commit, `dataIdentity`'s revision and frame build, and the "Full data notice" link to `data/NOTICE.md`), non-affiliation, source commit link |
| `LoadingScreen`, `LoadErrorScreen` | `shell/BootScreen.tsx` | The screens before the shell (Milestone 2): loading the dataset and geometry, with a progress bar and a `status` line ("Fetching and verifying data files: 3 of 7 (2.9 MB of 9.0 MB)"), then "placing … on the map geometry"; a failed start as an `alert` with title, message, a details disclosure and what can fix it (`remedy`): "Try again" for `reload`, or a sentence instead of the button for `redeploy` ("the deployed files need to be regenerated and redeployed") and `open-over-https` (no WebCrypto: "open the site over https (or on localhost)"). The heading takes focus. `src/ui/Boot.tsx` drives them |
| `Button`, `IconButton` | `primitives/` | Text and icon buttons (ui-refresh.md §7.1). `Button` variants: `default` (the tile fill with a strong edge that darkens and takes the muted ink on hover), `secondary` (an alias of `default`, kept while `MapFrame` and `ProjectMenu` use it), `primary` (one per context), `danger`, `ghost`, `link` (an inline action drawn as a link); `pressed` makes it a toggle (`aria-pressed`) drawn with the selection tint, bold accent text and a doubled accent edge, and `aria-expanded="true"` draws a disclosure the same way; the name never changes. `IconButton` requires `label`, supports `pressed`, `shortcut` (tooltip text and `aria-keyshortcuts`, §9 rule 3) and `variant` `ghost` or `tile` (`secondary` its alias). Both style `disabled` and `aria-disabled="true"` alike |
| `ExternalLink` | `primitives/ExternalLink.tsx` (imported from its file) | A link to another site (D-041 J): the external glyph after the words, "(opens in a new tab)" visually hidden in its name, `target="_blank"`, `rel="noopener noreferrer"`, no referrer |
| `SegmentedControl` | `primitives/SegmentedControl.tsx` (imported from its file) | Native radios in a fieldset with a visually hidden `legend` (arrow keys and one tab stop from the browser); the checked option has the selection tint, a 2px accent underline and bold text; an option with an `unavailable` reason is disabled with it as the tooltip. For View's rows choice and the map's style control |
| `SearchField` | `primitives/SearchField.tsx` | A `searchbox` with the search icon and a clear button while there is text (`clearLabel`, "Clear search"; it puts focus back in the field); Escape clears text and is left alone in an empty field, so a drawer or dialog around it can close on it; `onArrowDown` moves to the first result. For the Map layers drawer |
| `Select`, `TextInput` | `primitives/` | Native controls, restyled, always labelled (`hideLabel` keeps the label for assistive technology). `TextInput` also takes `inputMode` (the on-screen keyboard; the value stays text), `describedBy`, `invalid` (`aria-invalid`, with the reason in a described-by element), `readOnly` (focusable and copyable, drawn with a dashed edge on the raised surface) and `onBlur` |
| `Checkbox` | `primitives/Checkbox.tsx` | A native checkbox with its label after it (`label`, `checked`, `onChange`, `describedBy`); `checked="mixed"` is a group heading whose rows differ: the box's `indeterminate` flag (the dash) with `aria-checked="mixed"`, and a press checks it |
| `Toolbar`, `ToolbarSeparator` | `primitives/Toolbar.tsx` | `role="toolbar"` with one tab stop and arrow-key movement |
| `PanelHeader` | `primitives/PanelHeader.tsx` | 32px header: title, meta, actions |
| `Badge`, `PlaceholderTag`, `VisuallyHidden` | `primitives/Badge.tsx` | Identity badges; the "Placeholder" label (`label` "Sample" for stand-in content built from real data, same style) |
| `Icon` | `primitives/Icon.tsx` | Interface icons in `currentColor`; the refresh adds `undo`, `redo`, `up` and `down` (Move up and down), `left` and `right` (the panel handles), `external` and `map-focus` |

The project-storage components (§13) are not kit components: they read the project session, so
they live in `src/ui/app/` beside the other store-bound panels and are not exported from the kit.

| Component | File | Purpose and key props |
|---|---|---|
| `ProjectBar` | `app/ProjectMenu.tsx` | The project strip: the save status in words (its full sentence visually hidden beside it) with the warning shape when nothing is kept, "Data changed" (the drift report, which it owns) and a notices button (`onOpenProjects`) |
| `ProjectsMenu` | `app/ProjectMenu.tsx` | The route's name as a WAI-ARIA menu button (ui-refresh.md §4.1), "Durotar start, route: open the projects menu": Enter, Space or ↓ opens the menu on its first item, ↑ on its last; its content, `ProjectsMenuPopup` (`app/ProjectMenuPopup.tsx`, a lazy part), lists the routes in this browser (the open one checked) and New route…, Rename…, Duplicate, Recently deleted…, Projects… and Delete route… (the danger item); ↑ ↓ Home End move, Enter or Space runs, Escape closes to the name, Tab or a press outside closes |
| `ProjectsDialogHost` | `app/ProjectMenu.tsx` | Renders the lazy Projects dialog in a step (`ProjectsDialogMode`: `list`, `new`, `rename`, `delete`, `deleted`), for the menu and the notices |
| `ProjectMenuDialog` | `app/ProjectDialogs.tsx` (a lazy part) | The Projects dialog (`initial`: the step it opens in, focus in it): notices, the open project (status, conflict and retry actions, Rename, Duplicate, Export, Delete), the other stored projects (Open, Rename, Duplicate, Export, Delete; a project that cannot be opened says why, path by path, and can still be exported and deleted), New project, and Recently deleted with Restore |
| `DriftDialog` | `app/ProjectDialogs.tsx` (a lazy part) | The drift report (ARCHITECTURE §5.5): old and new data revision, missing quests, quests whose objectives or prerequisites changed (named from the loaded data), "unknown" where nothing can be compared; Keep the report / Dismiss the report |
| `ImportDialog`, `ExportDialog` | `app/ImportExport.tsx` (lazy parts) | Native project files: pick or drop a `.frl.json` file (opened as a new project; refused with every problem by path, never repaired), or download the open project; an `rxp` slot each, which the top bar fills with `RxpImportEntry` and `RxpExportEntry` (§15) |
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
| `QuestDetails` | `app/QuestDetails.tsx` | One quest in Details; with `actions` it adds the quest's steps (Accept, Objectives done, Turn in, with the one primary chosen by the quest's state at the step, `primaryQuestAction`; and Add all three) and opens the custom quest editor, with `baseDataset` it says when a custom quest replaces a dataset quest; "Open on Wowhead" (`ExternalLink`, `wowheadQuestUrl`: only the id goes in the address) for a dataset quest |
| `RoutePanel`, `RowViewPanel` | `app/RoutePanel.tsx`, `app/RouteView.tsx` (a lazy part) | The route panel (§6, §8); View's content: the rows' choices (`RowPrefs`) and the key |
| `AvailableQuests` | `app/AvailableQuests.tsx` | The Available tab (§14): the filter row, the summary line with New custom quest, and one `QuestGrid` of the quests after the active step by MP.3's groups, or by race and class without route state |
| `QuestLogPanel` | `app/QuestLogPanel.tsx` (a lazy part) | The Quest log tab (ui-refresh.md §5.5): the log after the active step (`selected.after.questLog`), "Quest log after step 12" with the count, capacity and basis; each quest's "?" (`logQuestState`: never ready while its record or progress is unknown), Objectives done and Turn in; each objective with Done here. Without route state it says why and lists nothing |
| view preferences | `app/view-prefs.ts` | `readShellPrefs`, `writeShellPrefs`: the rows' density and numbers, the panel widths, the collapse flags and map focus, per browser (§11) |

The simulation's store-bound parts (§16), in `src/ui/app/` for the same reason:

| Component or module | File | Purpose and key props |
|---|---|---|
| `ValidationPanel` | `app/ValidationPanel.tsx` | The Validation tab: counts by severity, the "Show" filter, the issues (`IssueList` with explanations from the registry) in pages of 100; choosing an issue selects its step and focuses it in the route list. Loaded on first use (§11) |
| `AppStatusBar` | `app/AppStatusBar.tsx` | The status bar over the derived store: the XP bar at the active step, the route metrics with their markers, `RouteSummary`, `SimulationStatus` with Cancel and Resume (announced) |
| derived view | `app/derived-view.ts` | Pure: `createRowDeriver` (the rows' `deriveRow`: the numbers, the mark's state from the step's issues with `rowMarkOf` and `isDoubtCode`, the worst issue with `worstIssue`, the level-up, and line 2's words from `lineTwoOf`, cached by dataset view and step), `createGroupDeriver` (a group's level span), `questLogCountOf` and `questLogWords` (the log after the step, its capacity and basis), `stepDerivedAt`, `stepNumbersOf` and `sameStepNumbers` (Details), `routeMetricsView`, `xpBarAt`, `simulationStatusOf`, `validationCounts`, the reasons for unknown numbers (`NOT_SIMULATED`, `SIMULATION_LOADING`, `STEP_NOT_WALKED`, `unknownTimeReason`, `unknownXpReason`) |
| test helpers | `app/derived-test-helpers.ts` | Hand-built derived results for the ui's tests (`derivedResults`, `readyState`, `derivedStoreWith`, `issue`) |

View-model types: `StepRowModel` (`verb`, `title`, `chain`, `detail`, the readouts, `issues` and the
worst `issue`, `mark`, `levelUp`), `GroupRowModel` (`imported`, `levelSpan`), `RouteRowModel`,
`EstimateColumn`, `TopNumber`, `RowMarkState` (`route/rows.ts`, with `routeRowContext` for step
positions and group membership, and `ESTIMATE_COLUMNS`, `ESTIMATE_COLUMN_LABELS`), `RowDensity`
(`route/virtual.ts`, with `routeRowHeight`),
`Readout<T>` (`lib/readout.ts`, with `knownReadout`, `unknownReadout`, `readoutFromEstimate`),
`IssueCounts` (`lib/issues.ts`, with `countIssues`), `ForeverProvenance`, `OptimizerStatus`,
`SimulationStatusModel`, `RouteSummaryRow`, `SidePanelTabId`, `ThemePreference`. Formatting
helpers (`lib/format.ts`) are locale-independent and truncate rather than round up (level 12.99
reads 12.9). `lib/rule-labels.ts` names the ruleset parameters in words (`RULE_LABELS`,
`assumptionWords`) for the tooltips of assumed numbers.

## 8. Route list

- **Virtualisation.** Index arithmetic over one fixed row height per list (`route/virtual.ts`):
  `ROUTE_ROW_HEIGHT_TWO_LINE` (40px, the default density, equal to `--frl-row-height-two-line`) or
  `ROUTE_ROW_HEIGHT` (28px, one-line rows, equal to `--frl-row-height`); `routeRowHeight(density)`
  gives it for the window, drag, auto-scroll and paging. `computeVirtualWindow` renders the visible
  rows plus 8 rows of overscan each side; the canvas is `rows × height` tall and rows are
  absolutely positioned at `index × height`. The active row is always mounted, even when scrolled
  away, so `aria-activedescendant` never dangles.
- **Two-line rows** (the default, D-048 A; ui-refresh.md §6.1). The number (its width follows the
  route's longest number) is also the drag handle; the mark (`QuestMark` for an accept or a turn-in
  in its state, `StepMark` for the other kinds); line 1: **the verb** in the muted ink ("Accept",
  "Turn in", "Complete", "Travel", "Grind", "Hearth", "Buy"), the title, the chain part ("1/2",
  spoken "1 of 2"), provenance, the issue marker and the lock when locked; line 2: the quest's chip
  (always beside a coloured mark, so the colour never stands alone) and where the step happens,
  short: who and the zone ("Kaltunk · Durotar"; the NPC gives way first, so the zone shows at a
  340px panel; the coordinates are in the tooltip and the row's name; a travel step's time with its
  hourglass), **or the worst issue at the step in words**, in its severity colour with its shape,
  in a short form that drops the step's own quest, which line 1 names ("Needs Cutting Teeth turned
  in first", "No step finishes objective 1"; the whole message is in the tooltip and the name;
  review UI-01); on the right the top number (XP
  gained, or the step time, a View choice) over the level after. **A known zero is muted and
  regular** (a gain is bold; an unknown stays "?", a lower bound "≥"). **A level-up** (the level
  after crosses a whole level) reads "↑4.6" in bold and the name adds "reaches level 4".
- **Marks at the walk** (ui-refresh.md §5.2). An accept or turn-in with an error at the step is
  locked (hollow, the lock badge; line 2 names the error); a doubt (the accept checks'
  `-uncertain` and `-unverifiable` codes, VAL013, VAL021) makes it "may be" (a dashed ring, colour
  kept); otherwise available or ready, in the difficulty colour at the level the step starts at. A
  turn-in whose objectives are carried (D-040) stays ready and line 2 says the warning. Before the
  walk an accept is "may be" and a turn-in's readiness unknown. A turn-in keeps its "?" in every
  state.
- **One-line rows** (View's compact choice): today's row with the 18px mark, the verb first and one
  estimate, chosen with "Rows show" (level after, XP gained or step time).
- **Where new steps go, and the later steps** (D-048 B). The list draws two single elements outside
  the rows (`insertAt`, `aria-hidden`): a 2px dashed insertion line with a caret at the boundary
  after the selection's last step, and **a band in `--frl-surface-later` under every row after it**;
  rows have no background at rest, so the band shows through. A selection change moves them and
  re-renders at most the two rows whose flags changed (PERF-11). Under forced colours the band is
  not drawn and the line is `Highlight`. The Add footer's caption and name say the place ("Add after
  step 12").
- **Derived values** (Milestone 6, §16). The row models are built once per route change from the
  route and the dataset (`buildRouteView`), with every estimate unknown and no place names. The
  walk's numbers are filled in as a row renders, through `deriveRow` (`createRowDeriver` in
  `app/derived-view.ts`), so only the mounted rows (the window, about 30) do any work when new
  results arrive; a walk never rebuilds the row models. The deriver reads memoised results only: an
  index lookup, three readouts, the step's issue counts, the mark's state and the worst issue, the
  level-up, and the quest chip at the level the step starts at. Line 2's words are formatted when a
  row first mounts and cached per dataset view, then per step object (`lineTwoOf`), so a route edit
  formats nothing and a new view starts afresh. A row whose fields a new walk left as they were
  keeps its model object, so the memoised row does not re-render.
- **Estimates.** A two-line row shows the XP gained (or the step time) over the level after; a
  one-line row has room for one estimate: the level after the step (default), the XP it gains
  (`+450`) or the time it takes (`2m 05s`), chosen with "Rows show" in View (kept per browser,
  §11). The row's name and the cell's tooltip always give all three. Each
  carries its basis: `≈` when it depends on assumptions (the tooltip names the ruleset parameters
  the step read and whether each is the user's, the ruleset's or an Era value), `E` for Era values
  standing in for Forever ones (dense rows fold both into one `≈` whose words say both), `≥` for a
  lower bound, `≤` for an upper bound, and `?` with its reason when unknown (never 0). A travel
  time that waits for its walking path, or for the navigation data to be checked, shows the
  hourglass in the step-time column's left gutter and the value in italics; the level and XP
  columns carry neither, because they do not wait for walking paths (Milestone 6 review UI-12).
  The name adds "pending: its walking path is still being computed, so the travel time is a
  straight-line estimate for now" (or "pending: the navigation data is still being checked, …").
  While computing is paused, waits to retry after a failure, or has failed, the row's name,
  the tooltip and Details say that instead ("computing walking paths is paused, …"; UI-04).
- **Narrow lists** (a container query on the list, below 320px of width; UI-18). The issue marker
  keeps its shape and drops its count (the tooltip and the row's name say the counts), the
  estimate cell takes only the room its number needs, and the row's gaps tighten from 6px to 4px.
  At the route panel's 288px (800×700), titles on rows with an issue marker keep at least 90px
  (98px with the level column), where they kept 40px.
- **Issue indicator.** The worst severity's shape (in its severity colour) and the step's issue
  count; its tooltip and the row's name say the counts by severity ("Issues: 1 error, 2
  warnings"). Option children are presentational, so the name carries it for assistive technology.
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
    row. In two-line rows they sit on **every row, muted** (D-048 F), at the right end of line 2,
    whose words end before them, on the row's own background (the band shows through at rest; `Canvas`
    under forced colours), never over a fade; in one-line rows duplicate and delete appear on hover
    or when active. Every action also has a list key (below) and a route-toolbar button. Component tests
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
  focus is: `isModalDialogOpen`, `lib/modal.ts`), and Alt+M map focus (read from
  `KeyboardEvent.code`, so Option+M on a Mac works; not in text fields). Every key also has a
  button: the step toolbar ("Selected steps", under the list) has Move up, Move down, Duplicate,
  Lock (a toggle, pressed while every selected step is locked), Delete, Cut, Copy, Paste and Join;
  the Add footer ("Add after step 12") Grind, Travel, Hearth, Train, Buy and Note; each
  `aria-disabled` while it cannot run (Copy stays available while editing is locked).

  Click selects (`replace`), Ctrl/Cmd+click toggles, Shift+click extends. The caller owns the
  selection anchor and applies `range`. `readOnly` (optimiser running, proposal open) turns off
  every editing key and affordance; navigation keeps working.
- **Drag.** Pointer drag from the step number (the grip icon went). The preview is local: the dragged row dims and an
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
   on an unlit pip. The UI refresh adds (ui-refresh.md §9.5): text and icons on the tile and its
   hover, the button edge at rest (on the tile and every panel) and on hover (`--frl-fg-muted` on the
   hover tile), the focus ring on both tiles, `--frl-danger` on the panels, the tile and its hover
   fill, every text colour on the later band, the rings and the insertion line on every row state,
   the well glyph on each difficulty disc, and a filled disc's silhouette (its keyline or the disc
   itself) at 3:1 on every row state. Add a pair there when you draw a new foreground on a new
   background.
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
   toolbar, quest grid), arrow keys inside, documented shortcuts for row actions. The quest lists
   (Available, Quest log) are layout grids whose group headings take focus, so ↓ lands on them and
   the group change is heard; a sticky heading never hides the focused row (the tab panel keeps a
   28px scroll padding, WCAG 2.2 2.4.11).
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
   which keeps one step selected, says nothing; a command that says its own result before the
   count settles, such as choosing an issue, is the only thing said), and brief results of row
   commands, inserts,
   undo and redo ("3 steps deleted. Undo with Ctrl+Z.", "2 steps cut. Paste with Ctrl+V; undo
   with Ctrl+Z.", "Cull: accept quest, complete objectives, turn in quest added as steps 4 to 6."),
   of the editors ("Duration of step 3 set to 2 minutes 30 seconds.", "Click the map to place the
   location of step 3. Escape cancels.", a field that cannot be saved: "Not set: …"), and the
   results of project actions
   ("Opened “Durotar run”.", "Imported “x” as a new project and opened it."), and of the RXP
   dialogs ("Imported “Guide”: 40 steps added as steps 13 to 52. Undo with Ctrl+Z.", "Copied the
   guide text to the clipboard." with a visible "Copied" beside Copy for a few seconds,
   "Exported “Guide.lua”."; §15), and of the simulation's controls (§16: Cancel and Resume of
   computing walking paths, the Validation tab's filter "Showing 2 errors.", "Show more", and
   choosing an issue "Showing step 12 in the route: error VAL004-min-level."). Background work
   is never announced: walking paths being computed, a walk finishing, issues appearing. A save that fails
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
   the progress tracks (the walking paths' and the optimiser's) get a 1px `CanvasText` edge, as
   the XP track has, and an unknown count with reduced motion is that edge dashed around an empty
   track (the hatching would otherwise fall back to a full `Highlight` bar that reads as done);
   issue severity bars become `CanvasText` borders (the icon shape and word still say which);
   pressed icon toggles get a `Highlight` edge, and pressed or expanded text buttons and the checked
   segment a 2px `Highlight` edge; the one primary button keeps a 2px edge; severity marks are cut
   out of their shapes in `Canvas`; disabled controls are `GrayText`. The difficulty chip opts out
   (`forced-color-adjust: none`): its reserved colours and pips carry the meaning and its own
   dark well gives them their contrast; a filled quest mark opts out the same way, while hollow
   marks, rings, badges and the pie take `CanvasText` (badges on `Canvas`) and a step disc's edge
   and glyph `CanvasText`. Unknown XP loses its hatching there but keeps the dashed edge and "XP ?".
10. Tabs have one `tabpanel` element with a stable id whose content changes with the selection;
    every tab names it in `aria-controls`, and it is labelled by the selected tab.
11. A long name in a list ellipsises in its own element and never pushes out the signal after
    it: in `QuestListItem` the name is `.frl-quest-item__label` (with the full name as its
    tooltip) and the provenance badge after it does not shrink.
12. **The map is supplementary.** Everything it does has a keyboard path elsewhere: select a step
    (the route list), open a quest in Details (a quest's name in the Available tab), jump to a
    zone (the top bar), fit the route and focus the active step (the Map view toolbar), switch
    surface (the top bar's "Go to zone or view…"), show and hide each kind of pin and search the
    map (the Map layers drawer, before the map in the keyboard order). The engine's
    focusable surface is named ("Route map: Kalimdor", `role="application"`,
    `aria-roledescription="map"`) and described by instructions that start with the map's kind
    ("Schematic map: zone frames, not terrain.") and say so; its own arrow-key panning and +/−
    zoom stay on, and Tab leaves it (no trap). Every glyph, line style and badge is named in the
    drawer's rows or its key, and hover text says what a marker's badges mean. Hover text also
    shows in the map's caption, never in a live region. Only results of explicit map commands are announced
    ("Map shows Durotar.", "Map centred on step 12."), and the one thing the map cannot do on its
    own: follow the active step to a world map it has no surface for ("Step 6 is on world map 36,
    which this map cannot show.").
13. **Toggles and disclosures keep their names.** A pressed text button (`aria-pressed`) and an
    expanded disclosure (`aria-expanded`) are drawn with the selection tint, bold accent text and a
    doubled accent edge, so the state is not only a change of fill; a pressed icon button (Map focus,
    the toolbar's Lock) takes the same accent edge and inset accent ring, ghost or tile (review
    UI-09). The name does not change with the state. Targets are at least 24px (the small control
    height); each segment of a segmented control is 24px on its own (UI-14). Three targets are
    smaller, under WCAG 2.2 2.5.8's exceptions, recorded here (review UI-14): the route rows'
    duplicate, delete and lock affordances (20 × 16px, 2px apart) are pointer-only (`aria-hidden`),
    and each has an equivalent that meets the size, its list key and the step toolbar's 24px button
    (the "equivalent" exception); the panel handles (18 × 44px, ui-refresh.md §4.3) and the 7px
    separators have Enter on the separator, the handles and map focus (Alt+M) as equivalents, and
    nothing else lies within 24px of a handle (the "spacing" exception).
14. **Nothing focused is ever hidden.** Collapsing a side panel or map focus (Alt+M) moves focus
    to the handle that shows the panel again, or to the Map focus toggle; restoring a panel from its
    handle moves focus into it, while the Map focus toggle keeps focus when it ends map focus (§6;
    review UI-18). The route name's menu and View return focus to their button on Escape. When a
    quest grid's focused item leaves the page (Accept moved its quest into the log, the list
    re-grouped for the new step), focus goes to the same item of the row now at that place, else to
    that row's heading, never to the page body (review QA-06). The map surface's focus ring is
    drawn on a layer above the map's panes, inset, so it shows over the art (review QA-08; WCAG
    2.4.7).
15. **The map popover** (map-presentation.md §14.2; step MP.6). A click on a pin, on a stack whose
    items do different things, or on empty map at the zone band or closer opens one non-modal
    `dialog` (`aria-modal="false"`) beside the point, named after its subject ("Quests at Gornek",
    "2 quests at Mahren Skyseer and Islen Waterseer" for a stack of several givers, "Flight point:
    Orgrimmar", "Here: Durotar"). It is never taller than the room on its side of the point (its
    body scrolls) and lies over the floating map controls while open, so every action stays in the
    stage and reachable (review PR-07). A quest's actions are named with the quest ("Accept Isha Awak
    after step 28", "Show Isha Awak in Details"), so a stack's buttons differ (review QA-18); the
    Wowhead link says "(Era page)" beside it and in its description (review PR-21). Choosing a map
    search result opens its pin's popover the same way (review PR-05). Opening it moves focus to its
    first action. Its
    actions, the external "Open on Wowhead" link included, form one list with one tab stop: Up and
    Down move, Home and End jump, Enter or Space activates. Tab and Shift+Tab leave the popover and
    close it, with focus where it went. Escape closes it and returns focus to the map surface; a
    press outside it closes it and leaves focus where the press put it (a press on the map is the
    map's own click, which closes it); a move of the map closes it too. It announces nothing when
    it opens: its name is read with the focus. Each action closes it, returns focus to the map and
    announces its result as the route's insert commands do; an unavailable action is `aria-disabled`
    with its reason as its description (rule 6). It holds no draft, so closing loses nothing, and
    everything in it has a keyboard path elsewhere (rule 12): the Available and Quest log tabs,
    Details, the Add footer and the step editors.

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
6. Export it from `src/ui/kit.ts` and add it to §7. A part that only the lazy parts use is
   imported from its own file and the kit exports its types only: a value export from the kit keeps
   the module in the entry chunk (§11).

## 11. Wiring the kit (for `src/ui/App.tsx`)

- Import from `src/ui/kit.ts`. Rendering `AppShell` loads `tokens.css` and `base.css`.
- Apply the stored theme at startup with `applyThemePreference(document.documentElement, pref)`
  and again from `TopBar`'s `onThemeChange`; persist it in the settings store.
- *UI refresh (UR.4, UR.5):* the shell's other per-browser choices (the rows' density, top number
  and column; both panel widths; the collapse flags and map focus) are one `localStorage` record,
  `forever-route-lab:shell` (`app/view-prefs.ts`), beside the theme's and the map style's keys:
  not in the project, not exported, not undone. Every access is guarded, and an absent or
  unreadable field takes its default. `App` takes `prefsStorage` (default the browser's).
- Map each route step to a `StepRowModel` (and each RXP group to a `GroupRowModel` header row):
  `number` is the 1-based step number, `title` one line, `projectedLevel` a `Readout<number>`
  (`unknownReadout(reason)` until the walk fills it in through `deriveRow`; never 0), `duration`
  and `xpGained` likewise, `pending` and `assumptions`, `quest` only for quest steps, `issues` from
  `countIssues`, `provenance` from `foreverProvenanceOf` (§8, §16).
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
  *Milestone 3:* the line is the layer panel's footer ("Geometry loaded: …"); from MP.4b it is in
  the Map layers drawer's key (and its stand-in when there is no map engine).
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
  *UI refresh:* the lazy parts now also hold the Details panel (UR.1a), the Projects dialog and the
  drift report (UR.4, the ledger's reserve), the Projects menu's content, View's content, the
  About, Import and Export dialogs and the Quest log tab (UR.3 to UR.6), in the same chunk. A part
  that only the lazy parts use is imported from its own file, not through the kit, because a value
  export from the kit (in the entry chunk) keeps the module there. `useLazyKept` keeps a dialog
  wanted once opened, so it stays mounted after it closes. Measured by `pnpm build`'s dist audit on 2026-09-26: the entry and its static
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
- *Milestone 6 (simulation and validation, §16):* `src/main.tsx` wraps `App` in
  `DerivedStoreProvider` (`src/app/react.ts`) with the derived-results store, and adds `resources`
  and `paths` to the map setup; `App` passes both to `createMapController`. Panels read the
  derived state with `useDerivedSelector` and module-level selectors (`src/ui/app/selectors.ts`:
  `selectDerived`, `selectIssueCounts` with `sameCounts`, and Details' narrow `stepNumbersOf`
  selector with `sameStepNumbers`), so the side panel's tabs re-render only when the counts
  change and Details only when its step's numbers do. `RoutePanel` takes `dataset` (the quest chip
  is taken at the level each step starts at) and `AppStatusBar` takes `announce` (Cancel and
  Resume). Outside a provider (component tests) the selector gets null and every estimate says
  "Not simulated: no route simulation is connected"; the Validation tab says "Not checked yet"
  and claims no absence of issues.
- *UI refresh (UR.1a):* the Details tab's panel is a lazy part too (`loadDetailsPanel`, the same
  chunk: `StepDetails`, `QuestDetails`, `StepEditors` and `field-parse` leave the entry), preloaded
  when the page is idle with the other parts; Available is the tab shown at start, so Details is not
  needed for the first paint. Until it loads the tab says "Loading the details panel…", and a failed
  load says why with "Try again". `useLazy` draws a part its loader already holds (`peek`) on the
  first render that wants it, so a preloaded Details never flashes "Loading…". `DETAILS_LOCKED`
  lives in `selectors.ts`, in the entry, for the quest actions. Measured by `pnpm build`'s dist audit
  on 2026-09-27: the entry and its static imports 248.98 → 243.81 kB gzip (−5.17 kB); the lazy parts
  13.92 → 19.62 kB gzip (docs/measurements/ui-refresh.json, and the shared ledger in
  docs/research/ui-refresh.md §10.3).
- *Milestone 6:* the Validation tab's panel is a lazy part (`loadValidationPanel`, the same chunk
  as the dialogs, §11 CR-19), so the issue-code registry (`src/app/issue-codes.ts` over
  `src/validate/codes.ts`) stays out of the entry chunk; until it loads the tab says "Loading the
  validation panel…", and a failed load says why with "Try again". Measured by `pnpm build`'s dist
  audit on 2026-09-26: the entry and its static imports 232.91 kB gzip of the 250 kB budget (225.00
  kB after the integrator's derived store; the rest is this milestone's rows, status bar, summary
  and simulation status); the lazy parts 13.66 kB gzip plus 1.62 kB of CSS; the registry 5.55 kB
  gzip in its own chunk (shared with the derived pipeline).

## 12. Map panel

The centre panel (ARCHITECTURE §7, §12.4; MAPS.md §7; map-presentation.md §25). By the §4 import
rules the logic lives in `app` and the ui only renders it:

| Where | What |
|---|---|
| `src/app/map-view.ts` | The map's view state in the store (`ViewState.map`): `surface`, `zoomBand` (`zone`/`continent`), `layers` (visibility: every layer on by default but the coastline; the drawer's rows set them at the first render), `walkingPaths` (on by default) and `zone` (the zone last jumped to, cleared once it is panned out of view or the surface changes). Not persisted: the Map layers drawer keeps its own record (below). Hover is not in the store. `patchMapUi` keeps the object when nothing changes, so a no-op write notifies nobody. `ViewState.openedQuests` holds quests opened in Details with the selection they were opened under (`shownOpenedQuests`). `openQuestsInDetails`, `closeOpenedQuests`, `setMapUi`, `setMapLayerVisible` and `setMapWalkingPaths` write them |
| `src/app/map-model.ts` | Pure view models: `questGiverModel` (the Available tab's rule: quests open by race and class), `objectiveModel` and `turnInModel` (the focused quests), `flightMasterModel` (the faction's, unknown-faction ones labelled so, each with the open quests it starts), `createRouteInputBuilder` (cached by step id) and `mapRouteInput`, `createDrawnRouteFilter` and `focusWithin` (what the route layers draw from), `routeMapSummary`, `stepsWithoutSurface`, `legUnknownAt`, `routeBoundsOn`, `routeStepIndex`, `zoneBounds`, `zoneGroups`, `focusQuestIds`, `stepFocusOf`. What has no map position (item starters, reputation objectives) or no spawn in the dataset is counted, never placed |
| `src/app/map-categories.ts` | The drawer's rows as data (map-presentation.md §25.3.2 to §25.3.4): `MAP_CATEGORY_ROWS` (27 rows in five groups, each with its default and how it applies), `DEFAULT_HIDDEN_CATEGORIES`, `normaliseHidden`, `SHOW_ALL`, `hideAll`, `groupState`, `setGroup`, `setCategory`, `maskOf`, `questRowsShown` and `layerVisibility`. Small and framework-free, because the map panel (entry chunk) applies the rows at the first render |
| `src/app/map-controller.ts` | `createMapController`. Store to layers: memoised inputs, `createMapLayers`, `setLayer` only for a changed `LayerContent`, visibility from the store. The adapter's label provider (`labelFor`). Adapter events to the store; hover kept here (`getHover`, `subscribeHover`); the map popover's target (`getStatus().popover`, `closePopover`; step MP.6 replaced the merged marker's choice list). The atlas (the `atlas` option, on unless a test passes false, since ATL.10) and the smooth wheel (`smoothWheel`, likewise). The commands `focusStep`, `fitRoute`, `jumpToZone`, `showSurface`, `showPreset`, `zoomBy` and `hoverSteps`. The drawer's side: `setCategories` (the adapter's mask, the step numbers, the givers of Unlocks soon and Low level only while shown), `setSearchFilter`, `showResult`, `fitPoints`, `setMapStyle` and `setWording`. The committed art and terrain (`MapControllerOptions.resources`) and local art as before (Milestone 3b). `getStatus`: per-layer stats, notes and reasons, the route summary, the active step's placement, the choice, the `backdrop` for the notice, the `walkingPaths` row, `problems`, the style, the drawer's `counts`, `hidden` and `searching`; the `frl:map:sync` User Timing measure (at most `MAX_SYNC_MEASURES` kept) |
| `src/app/map-wording.ts` | The words and counts only the drawer shows: each layer's notes (`layerNotesOf`, with `layerStatsNotes` and its units), the walking paths' notes, why a layer is unavailable, the map's problems, the rows' names (`MAP_CATEGORY_LABELS`, `MAP_CATEGORY_GROUP_LABELS`), the counts and the "in view" counts. A lazy part with the drawer: the controller gathers the facts (`MapNotesSource`, `MapResourceFacts`) and the drawer installs the words (`setWording`, before its first paint); until then the notes, reasons, problems and counts are empty. Tests pass `wording: MAP_WORDING` |
| `src/app/map-popover.ts` | The map popover's content (map-presentation.md §14.2, §8.5, §11; step MP.6), a lazy part with the popover: from the controller's target (`MapPopoverTarget`), the dataset, the quest state and the places, each quest with its state, chips and actions (Accept, Complete objectives, Turn in, the likely one primary; Show in Details; Open on Wowhead, external), flight points ("Add flight from here"), a dungeon's quests inside, transport stops ("Add transport", unavailable for a stop of unknown service), services (Set hearth, Train, Buy here), any point ("Go here", "Fly from the nearest known flight point") and a stack of steps ("Select step N", "Select all"). Each insert is the editor's insert-after-selection command |
| `src/app/map-labels.ts` | The labels canvas's names (map-presentation.md §13; D-049 O19; step MP.7), built with the places in the lazy derived pipeline: zones and cities with their cards (`zoneCardOf` in `zone-levels.ts`), anchored at the pole of inaccessibility of their terrain rings (`src/geo/pole.ts`, `src/geo/zone-rings.ts`) or their frame's centre; continent names at the world band; dungeon and flight point names from 0.05 px a yard; static priority; the minimap style's list names Ironforge and the Undercity "(underground city)" |
| `src/app/map-zone-fill.ts` | The zone fills (map-presentation.md §12.4, §12.6; step MP.10), built in the lazy derived pipeline: the fallback tint per zone (`public/maps/tint/`) and the faction overlay (the client zone table), with their notes |
| `src/app/map-search.ts` | The map search's index (`createMapSearchIndex`): quests, the NPCs and objects the quests name, flight masters and named zones, folded (`foldText`: case and accents), prefix matches first; `resultPoint`, `resultZone`, `searchFilterOf` |
| `src/app/map-exports.ts` | Re-exports for the ui: the controller and its types, the rows, `BADGE_TEXT`, `CLUSTER_MAX_ZOOM`, `DEFAULT_LOD`, `lodLevelAt`, `RELIEF_OPACITY`, `routeLegsOf`, the marks' paths and table, the local-art types, and for the composition root `createMapResources`, `createMapLayersSetting` and the notices' paths. Nothing lazy is re-exported here: a value re-exported from a lazy module would pull it into the entry |
| `src/infra/maps/map-style-setting.ts` | The drawer's record in this browser (`createMapLayersSetting`) and its style part for the controller (`createMapStyleSetting`) |
| `src/ui/shell/MapFrame.tsx` | The kit's frame (map-presentation.md §25.3.0): the stage takes the region, and the controls float on it: Map layers at the top left, Map focus (the shell's toggle, claimed through `MapFocusContext`) at the top right, the Map view toolbar at the bottom right, the caption at the bottom left; the drawer docked or over the stage (`useMapRegionDocking`); the "Viewing" chip and the map popover in the stage |
| `src/ui/shell/MapPopover.tsx` | The map popover, presentational (rule 15 of §9): a non-modal dialog beside the point, its sections (a quest's `DifficultyLabel`, XP with its basis marker, `ProvenanceBadge`, state words) and one list of actions, the Wowhead link included |
| `src/ui/app/MapPopoverPanel.tsx` | The popover's container (a lazy part): builds the content (`app/map-popover.ts`) and runs the chosen action through the route actions (`addQuest`, `insertCommand`), Details or the selection; closes and gives focus back to the map |
| `src/ui/shell/MapCategoryDrawer.tsx`, `MapKey.tsx` | The drawer, presentational: the style control, the notices, the search and its results, Show all, Hide all and Defaults, the groups of rows, and the key |
| `src/ui/app/MapLayersPanel.tsx` | The drawer's container (a lazy part, `lazy-parts.ts`): words the controller's counts and notes into rows, applies them through the map panel, runs the search, offers the style, installs the wording |
| `src/ui/app/MapPanel.tsx` | Loads the engine (loading, or failed with a retry), attaches and detaches the controller, names the engine's surface, reports the active step, reads and writes the drawer's record, applies the rows before the drawer loads, maps the status to the frame's props (the notice from `backdrop`, the caption, the commands), renders the pointer line from the controller's hover alone, the "Viewing" chip (`ViewingChip`) and the map popover (a lazy part) while the controller has a target |
| `src/ui/shell/AboutDialog.tsx` | Its "Map art" section (D-033): Blizzard Entertainment owns the art, non-affiliation, non-commercial, removal on request, the terrain line (D-032), the two base maps of the seamless atlas and which is shown (`BASE_MAPS_NOTICE`, `baseMapShownText`), with links to `maps/minimap/NOTICE.md`, `maps/atlas/NOTICE.md`, `maps/art/NOTICE.md` and `maps/terrain/NOTICE.md` |

**The atlas** (map-atlas.md §5, §8; D-042; on by default since step ATL.10). The map opens on one
surface for both continents, with Zephras Isle in a captioned box between them ("not in position":
the game does not place it). `world:0`, `world:1` and `world:2991` are retired. The top bar's "Go to
zone or view…" lists the views first ("Both continents", then the presets "Kalimdor" and "Eastern
Kingdoms", which fit the atlas to a continent), then the zones by world map; a zone on a separate map
(Darkspear Islands, a battleground) opens that map's own surface. The surface's accessible name is
"Route map: Azeroth". The
inset's note ("Zephras Isle: shown in a box, not in position; no quest data yet" while the dataset
has none there) is in the drawer's notices, the key and the map's instructions, which read "Route
map: Azeroth. Both continents; Zephras Isle is shown in a box between them, because the game does
not place it; it has no quest data yet." after the art notice. The key notes that the continents'
relative position is a layout choice. A geometry that cannot place the continents keeps one surface
per world map, and the drawer says why ("The atlas could not be placed from this geometry: the map
shows one world map at a time").

**The wheel** (map-atlas.md §8.4; on since ATL.10). Every wheel event changes the zoom (about half a
level per 100 px of scrolling, at most one level per event), eased around the pointer, and a gesture
settles once; the view never springs back from the edge. The zoom buttons and the + and − keys move
one level. Under reduced motion the wheel jumps without easing and the tiles do not fade. The two
wheel rates are the design's starting values until ATL.9 calibrates them.

**The frame** (§25.3.0). The map takes the whole region; nothing sits in a bar above or below it.

- **Map layers** (top left) opens and closes the drawer: a disclosure (`aria-expanded`,
  `aria-controls`), drawn pressed while open, sitting just right of an open drawer.
- **Map focus** (top right) is the shell's toggle (Alt+M), placed in the map's chrome so the
  keyboard order is Map layers, the drawer, the map surface, Map focus, the toolbar.
- **The Map view toolbar** (bottom right, 32 px buttons in two joined groups): Zoom in and Zoom
  out (whole levels, `zoomBy`), Fit route and Focus step, and Cancel pick while a pick lasts.
  Unavailable commands stay focusable, `aria-disabled`, with their reason as description and
  tooltip. Leaflet's yard scale sits above it.
- **The caption** (bottom left, never a live region): what kind of map this is (the notice, with a
  short form in a narrow map: "Art © Blizzard", "Relief", "Schematic"), the pick in progress, the
  route on this surface ("Route: 54 of 55 steps on Kalimdor · 1 without a location"; steps on maps
  no surface shows are counted apart, "1 on maps with no surface"), the active step the map cannot
  follow, and "Pointer on:" with the hover text.
- The surface select moved to the top bar's "Go to zone or view…" (the atlas's views, then the
  zones); the problems the status line gave are the drawer's notices.

**The Map layers drawer** (§25.3.1 to §25.3.8; D-047).

- **Where.** 300 px (`--frl-map-drawer-width`). From a map region of 900 px it docks beside the
  stage, which narrows; below that it lies over the stage's left edge, with a shadow, a close
  button and Escape to close (focus returns to the toggle). It is open by default where it docks
  and closed where it would lie over the map; a kept "open" applies only where it docks. It is a
  lazy part in `lazy-parts`: its code loads the first time it opens (the production build preloads
  it when idle), with a stand-in meanwhile and "Try again" if the chunk fails.
- **What.** From the top: "Map style" (below), the map's notices (what could not be loaded and
  what the map shows instead; the atlas's insets), "Search the map", a toolbar with Show all, Hide
  all and Defaults, the five groups (Quests, headed "after step N"; Instances; Travel; Services,
  headed "zoomed in"; Route and map) and the key in a closed disclosure.
- **Rows.** A checkbox, the category's pin in monochrome (the map's own paths) or a line or area
  swatch, the name, and the count right-aligned in tabular figures ("209 · 118 givers",
  "8 · 4 ready"). The accessible name carries the count with its unit and the state ("Available:
  209 quests at 118 givers after step 1425, shown"); the tooltip says how many are in view. Notes
  (MAP-HONEST-5) are one muted line under the row: the first note, ellipsised, and "+2 more" when
  there are more (review PR-09). The whole notes open under it while the row's box has keyboard
  focus and on a press of the line, are its tooltip, and are always the checkbox's description.
  A row that cannot be used now is `aria-disabled`, named for it ("Portals, unavailable: none
  recorded yet: …"; review PR-21), with its reason as its first note ("Not drawn yet: …", "No
  terrain data in this build", "Painted style only"), stays in the arrow order and does nothing; a
  hidden row is unticked and struck through. Without route state the quest rows say "open to an Orc
  Warrior (no route state yet)".
- **How a row applies** (`MapCategoryRow.apply`): a pin row by the adapter's mask (a redraw, never
  a rebuild); a whole-layer row by the store's layer visibility (route line, zone names, borders,
  faction, relief, coastline, flight network); Walking paths and Step numbers as their own
  switches. Rows apply at once, before the drawer's code has loaded. Unlocks soon and Low level,
  off by default, join the givers' input only while shown, so they cost no budget until then.
- **Show all** shows every row, the defaults' hidden ones too; **Hide all** hides every pin row and
  leaves Route and map as they were, so the route is never lost; **Defaults** restores the rows'
  defaults. Each is announced ("All map categories shown.", "All map categories hidden; the route
  stays.", "Map categories back to their defaults."); a single row is not.
- **Keyboard** (UI.md §9 rule 4): the style control (native radios: one stop, arrows inside); the
  search field (Down moves to the first result); the toolbar (one stop, arrows inside); each group
  one stop, a roving tabindex over the group's own box and its rows (Up and Down move, Home and End
  jump, Space toggles; on the group's box Enter, or Left and Right, collapse and expand it); the
  key's disclosure. A group's box is checked, unchecked or mixed, counting only the rows that can be
  used: an unavailable row never leaves it mixed (review QA-25).
- **Kept** (§25.3.7): one record in this browser's `localStorage` under
  `forever-route-lab:map-layers`: `{ version: 1, style, hidden, drawerOpen, collapsed }`, read at
  the first render and written 500 ms after the last change. Only what was chosen is written, and
  a value that is not understood is dropped (the defaults apply). The style's earlier key
  (`forever-route-lab:map-style`) is read when the record has no style. Not in the project, not
  exported, not undone by Ctrl+Z; the search text is not kept.

**The map search** (§25.3.5; MP.4c). "Search the map" matches the names of quests, the NPCs and
objects the quests name (givers, finishers, objective targets), flight masters and zones, and the
places the places model draws (review PR-05): dungeons and raids by their instances' names, every
flight point by its client node's name (client-only nodes too), transport stops, and the services
by name and by kind ("innkeeper", "Warrior trainer", "vendor"), ignoring case and accents, prefix
matches first. Its index is built on the field's first focus. A query
starts at two characters, 150 ms after the last key, and the status says how many results there
are (politely, after the debounce). While a query lasts:

- the results replace the rows, grouped (Quests, Instances, Travel, Services, Zones), at most 60
  listed and "and 12 more: type more to narrow the search"; each says what it is in one line
  ("Start: Gornek · level 2 · available after step 12", "Flight master · Orgrimmar", "Dungeon
  entrance", "Innkeeper", "Zone · Kalimdor"), and a result in a hidden row says "(hidden
  category)";
- the map draws only the results' pins (whatever their row; a place by its pins' ids), with the
  route and the selection;
- choosing a result shows it: a zone is jumped to; anything else is shown at the zone band at
  least, its pin ringed and its popover opened, which takes focus (rule 15); the right panel's tab
  is left as it is (the popover's Show in Details opens the quest there; review PR-05). "Fit results
  on the map" fits them; "Clear search" (or Escape in the field) ends the query and the map draws
  the rows again.

**The map style** (map-atlas.md §21; steps MM.7 and MM.9). "Map style: Minimap | Painted", a radio
group with a visible label at the drawer's top. **The minimap is the default** since MM.9 (a browser
with no stored choice opens in it; D-045 item 2, after the presentation's names existed, D-049). The
choice is announced ("Map style: Painted.") and kept in the record. It applies to the seamless atlas;
without one (a geometry that cannot place the continents) both radios are unavailable, with the
reason as the control's description ("Styles apply to the seamless atlas, which this geometry cannot
place: the map shows one world map at a time."). When the chosen style cannot be drawn, the other is
shown and the note says so ("Minimap tiles unavailable: …; showing the painted map", or "Minimap
tiles not downloaded (run `pnpm maps:minimap:fetch`); showing the painted map" in a build without the
tile pack); the choice stands and is never overwritten by the fallback. The container carries
`data-map-style` for the style shown, and the palette follows it. The caption's notice names the art
shown ("Minimap art © Blizzard Entertainment" or "Painted map art © Blizzard Entertainment"), and so
do the map's instructions. The key and About name both base maps' notices and say which is shown.

**Pins** (§25.2; MP.4a). The quest givers, turn-ins, counted objectives, flight points and later the
dungeons, transport stops and services are pins: our own teardrop, a dark body with a light glyph
(services the light family), drawn from cached bitmaps (an LRU of 256).

- **Size.** The head is 12 px below the continent band, grows to 26 px across it and stays 26 px from
  the zone band; services and counted objectives at 0.8 of that. Places (dungeons, flight points,
  transports) are drawn from 0.0325 px a yard, services from 0.149.
- **Colour.** A quest pin's glyph takes the quest's exact difficulty colour from a 16 px head, with
  the pip tag beside it; below that it is uncoloured. A cluster is coloured only when all its quests
  share one difficulty. Colour is never the only cue: the pips, the edge (solid: as stated; dashed:
  not sure; double: both factions), the fill (hollow: not known yet) and the badges (lock, level,
  progress pie, the dungeon arch, "×n") say it too. Faction is a glyph and an outline, never a hue.
  Under forced colours the pins take system colours.
- **Clusters** (§25.2.5). Below the zone band, quest givers and turn-ins fold into the cells of a
  nested yard grid (512, 1,024, 2,048 and 4,096 yd; the smallest cell of at least 1.25 heads). The
  builder makes all four levels once per input; the zoom picks one. A cluster sits at its member
  nearest the centroid, counts quests, places and points, and says so ("3 quests at 3 givers near
  here: 2 available, 1 may be available; 3 standard. Zoom in to separate them."); a click zooms in
  to its members, at most to just inside the zone band, where they separate. The pin cap (at most
  300 a band, §25.7) counts clusters and never trims one.
- **Stacks.** At the zone and close bands, pins of one kind whose heads overlap by more than about
  60 % merge into one "×n" (a spatial hash, recomputed at a zoom settle, a new layer or a new mask,
  never on a pan); a click lists them.
- **Hits.** Leaflet's topmost path first, then the pins' own index (a 32 px grid, built in idle
  time after a settle or at the first pointer event; a pin's target is its head and point with 2 px
  to spare, and at least a 24 px square below a 20 px head): the nearest head centre wins, and pins
  within 3 px of it are a list. Hover rings a pin; the
  pointer line names it.
- **Other markers** (step beads, halos, objective dots) and every line style are as before; the key
  names each glyph, line style and badge (rule 12 of §9) and how to read the grid.

**Names on the map** (map-presentation.md §13, §25.4; D-049 O19; step MP.7). The labels canvas draws
the places model's names (`app/map-labels.ts`): every zone and city with its level span for the
character, below 0.05 px a yard as one compact line ("The Barrens 13–25" and the boxed E; a new zone
with cited text by its name alone), to the zone band as a two-line card (the name; the difficulty
chip's canvas twin rating the zone's median quest level at the step, dashed for a lower-bound level,
"quests 13–25 (93)" and the boxed E, or the cited text: "mid-30s to mid-40s (official)", "endgame
(reported)", "level range unknown ?", "Battleground (client: Map 2997 InstanceType 3)"), and as a 13 px
zone label to about zoom −1.75; the continents' names at the world band; dungeon and flight point
names from 0.05 px a yard. Each card keeps room for the twin, so a step change never widens it. The
priority is static (continents, levelling zones by frame area, cities, dungeons, flight points). In
the minimap style, which has no names, Ironforge and the Undercity read "Ironforge (underground
city)" and "Undercity (underground city)", and from the zone band their frames are dashed outlines.
From the zone band the **"Viewing" chip** (DOM, at the stage's top left beside Map layers) names the
zone at the view centre: "Viewing The Barrens · quests 13–25 (93 open to an Orc Warrior)" with the
boxed E and the real `DifficultyLabel` rating its median quest level.

**The map popover** (map-presentation.md §14.2; rule 15 of §9; step MP.6). A click on a pin, on a
stack whose items do different things, or on empty map at the zone band or closer opens the popover
beside the point, in place of the old choice list. It lists what is there and what can be added
after the selection: a quest's Accept, Complete objectives or Turn in (the likely one primary), Show
in Details and Open on Wowhead (marked external: a new tab, no opener, no referrer; D-041 J); a flight
point's "Add flight from here"; a dungeon's quests inside (§8.5); a transport stop's "Add transport"
(unavailable, with why, for a stop of unknown service); a service's Set hearth, Train or Buy here; any
point's "Go here" and "Fly from the nearest known flight point" (both flight points named); a stack of
steps' "Select step N" and "Select all". A cluster still zooms in; a step marker still selects its
step. Every insert is announced as the other inserts are.

**Services** (map-presentation.md §11; step MP.11). Innkeepers, the character's class trainers and the
vendors the dataset carries (only those tied to quests, and the notes say so), of the character's
side and both factions, as light pins from zoom −2.75 (vendors from the close band). An NPC with no
faction in the dataset is not drawn, and one inside an instance is not drawn at its entrance.

**Zone fills** (map-presentation.md §12.4, §12.6; step MP.10), zoomed out only (the zone band's budget
is 0). The **fallback tint** (each zone's mean painted colour, `public/maps/tint/`, generated by
`tools/maps/tints.ts` from the painted zone images and the terrain; since ATL.10 those images come from
a local `convert.ts --all` folder, as `public/maps/art/` keeps five) is drawn where no painted art is shown on a
map (the relief backdrop), never over the atlas tiles and never in the minimap style. The **zone
faction** row (off by default) draws each zone's pattern in the hatch colour, never a hue: `/` for
Alliance territory, `\` for Horde territory, both for the client value 6, dots for a sanctuary, none
for no faction territory; its words are in the zone's hover, and a click on it jumps to the zone.

**Behaviour** (unchanged by the presentation work, but for the clicks, which the popover changed).

- **It follows the route list.** When the active step changes (list, keyboard, map click), the map
  brings it into view with `focus`, which zooms in to at least −2 and pans only when the point is
  not comfortably visible; on the atlas a step on the other continent or the isle only pans and
  zooms, and a step in an instance or on a battleground switches surface. A selection change moves
  the active step in the same sync, so one click or arrow key costs one sync (M3 review PERF-6).
  "Focus step" recentres on request, and says why it cannot ("Step 1 has no location", "Step 6 is
  not on the map: it moves the character somewhere the route does not say", "Step 6 is on world
  map 36, which this map cannot show"). The last one is also announced and shown in the caption
  when the active step lands there, since the map cannot follow it (MAP-UX-9).
- **Labels.** Route descriptors carry no step numbers (MAPS §7.3): the controller is the adapter's
  label provider and numbers steps from the current route order when a tooltip opens ("12 ·
  Accept quest: Your Place in the World", "Route: steps 3–40"). A marker's badges are said in
  words after its text (MAP-A11Y-10). With route state, a quest pin's hover starts "After step N:".
- **Clicks.** A step marker, halo, route segment or leg selects that step; a transition glyph
  selects the step at its other end; a pin opens the map popover (above); a cluster zooms in; an
  aggregate glyph or a zone's faction fill opens its zone. Several steps at one point whose clicks
  would differ open the popover's list ("2 steps here", with "Select all 2 steps"; MAP-UX-3). A click
  on empty map at continent zoom jumps to the zone frame the point is most central in
  (`zoneFramesContaining`; MAP-UX-1); at the zone band or closer it opens the popover for the point;
  with the popover open, a click on empty map only closes it.
- **Zones.** Jump to zone (the top bar, an aggregate click, an empty click, a zone result) fits the
  zone's frame at the zone zoom or closer (PERF-4, MAP-UX-2). Its frame is drawn emphasised and the
  top bar's select shows it until the zone is panned out of view or another surface is shown.
- **Route rows.** The pointer over a route row highlights that step's marker, on top of every layer,
  without rebuilding anything.
- **Pick on map** (§14). `startPick({ label, onPick })` makes the next click a point and nothing
  else; the caption says "Picking the location of step 3: click the map to place it. Escape
  cancels.", and the toolbar has "Cancel pick". Escape anywhere cancels it first, except while a
  modal dialog is open (UI-F8). The point is world form, to 0.1 yd, with the zone hint as its UiMap.
- **Focused quests.** The quests opened in Details while they are shown, otherwise the active
  step's quests: their objectives and turn-ins are drawn, and their givers raw and emphasised.
- **Initial view.** The route's first surface, fitted to the route there (never closer than zoom
  −1.5): the atlas, with every placed step on both continents and the isle, for a route in the open
  world. A remount keeps the adapter and its views.
- **Painted art and terrain** (Milestone 3b; D-032, D-033; MAPS §7.5): as before; the notice in the
  caption says what is under the pins, and the surface's instructions start with the same words
  (rule 12 of §9), so they name the style shown.
- **Failures never block.** A manifest or file that cannot be loaded leaves the map drawing what it
  has; its row is unavailable with the reason, and the drawer's notices say what the map shows
  instead ("Painted map art could not be loaded: the map shows the terrain relief instead").
- **Walking paths.** A row under Route line: how the route line draws walked legs, not a layer
  (`MapUiState.walkingPaths`), unavailable until the navigation model gives paths. Its notes count
  the legs that follow their paths, wait for them, or have none.
- **Performance.** Only a layer whose inputs changed is rebuilt and sent; the rows and the search
  are a mask in the adapter (a redraw, no rebuild). Route layers are built from the steps they draw,
  so selecting or editing a note rebuilds none. Hover writes nothing to the store. The pins' budgets
  and the 4× measurements are in `docs/measurements/map-presentation.json` (`mp4a`), the drawer's
  cost to the entry chunk in ui-refresh.md §10.3.

## 13. Project storage

The project strip, the Projects dialog, import, export and the drift report (ARCHITECTURE §5.5,
§8.2, §12.3). The logic is the project session in `src/app/persistence.ts` (with
`project-library.ts`, `autosave.ts` and `drift.ts`; storage, and the links between tabs, in
`src/infra/persistence`); the ui only renders it (§4).

**Save status.** The strip always says, in words, what is kept:

| Status | Strip | Full sentence (tooltip, the strip's visually hidden words, the dialog) |
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

**The Projects menu** (ui-refresh.md §4.1). The route's name, in the route panel's header, is a
menu button: the routes in this browser (the open one checked; one that cannot be opened is
unavailable, with why), New route…, Rename…, Duplicate, Recently deleted…, Projects… and Delete
route…. Switching opens the project and announces it; Duplicate runs at once; each "…" item opens
the Projects dialog in that step (the name field of New or Rename, the delete confirmation, or the
Recently deleted heading), and Cancel or Escape in the step returns focus to its button in the
dialog. The top bar's Projects button went; the save status stays beside the top bar.

**Projects dialog.** Actions are buttons whose names include the project ("Open “Durotar run”").
Destructive choices (Delete, Delete permanently, Overwrite) are danger buttons.
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
The new steps become the selection. The route list draws the place (the insertion line and the
band under the later steps, §8) and the Add footer names it: Grind, Travel, **Hearth** (a
hearthstone use, to the bind point the walk knows), **Train** and **Buy** (a train or vendor step
with nothing set, which open Details to set it) and Note.

**Adding quests** (ui-refresh.md §5.4, §5.5, §7.3). The Available tab's Accept on each quest adds
its accept step; its name says where it goes ("after step 12", or "at the end of the route" while
nothing is selected; review UI-08). Line 2 shows the quest's XP at the level after the step with its
basis marker ("+630 XP ≈"; an upper bound while that level is a lower bound; review UI-05). A locked
quest has "Needs <prerequisite>" (which opens the prerequisite in Details) and **Accept first** right
after it, which accepts the prerequisite: the first one the route does not already accept and that
is neither in the log nor done after the step, named first ("and 1 more" lists the others in its
tooltip). When every prerequisite is taken already, Accept first is unavailable and says why ("…
is already accepted at step 11: move that step before step 8"), so it never adds a second accept
(review QA-05). A zone heading's name words its numbers: the span with what its count counts, the
median chip ("median quest level 9, Impossible (red), at the level after step 12") and how many
quests are listed (review UI-13). The tab's summary line has "New custom quest". The Quest log tab has Objectives done and Turn in on each quest ("…
after step 12"), every quest with its chip, and Done here on each open objective ("Done here: Kill
10 boars (objective 1 of Vile Familiars), after step 12"); every objective's words are a grid item,
so ↓ reaches a done one too (review UI-11). Details' difficulty is taken at the level after the
selected step when there is route state, as the rows and the Available tab take it, and at the
start level only without it (review UI-12). A quest in Details has Accept, Objectives done and Turn in, with the
quest's state at the step making one of them primary (none without route state), **Add all three**
(accept, complete and turn-in as one command, "Add quest", which the Available rows' + did), and
"Complete objective n" beside each objective when there are several. Each step is placed at
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
XP (into the start level), what happened before the route and riding trained before it. "Before
the route" is a new character, exactly the listed quests, or partly known: the quests listed and
maybe others (SIMULATION §7.1 `unknown`). The quest lists (completed, and in the log at the start,
by id) show for the last two, labelled for the third as a partial record with what that means (a
prerequisite or turn-in that fails only because a quest is missing from them is a warning that it
cannot be checked, not an error), and are saved for both; an unrelated save never drops them.
Choosing "A new character" empties them in the open dialog, where it can be seen (Cancel brings
them back). A project that is new-character yet holds lists (an imported file) shows them, with a
note that they are used as given (Milestone 6 review ENG-12). The route profile: XP rate,
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
  steps; 2 warnings, 5 info issues"), or for a Lua file each guide as a checkbox (all chosen). Changing an
  option checks the same text again without moving focus; editing the text marks the result stale,
  and Import waits for a new check. A problem ("Paste guide text or open a file first.") takes
  focus on every attempt, the same one again included (UI-F12). A press on the backdrop keeps the
  text and the check (§9 rule 7).
- *Diagnostics* (`RxpDiagnosticList`): in line order (for a Lua file, lines of the file, with
  "in “guide”" after the line of a guide's own diagnostic), each with its severity shape and word,
  "Line 12, column 5", the message, the code and, where it applies, "RestedXP itself drops or
  changes this". An item with a line is a button; pressing it shows the line right after it
  (`SourceExcerpt`: two lines either side, the line marked with ▶ and a tint, its column outlined),
  and pressing it again hides it. Counts by severity ("2 errors, 14 warnings, 30 info issues"), a Show
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

## 16. Simulation and validation

What the engine walk works out, shown in the shell (ARCHITECTURE §9.3, §9.4, §12.1; SIMULATION
§7.7-§7.8; Milestone 6). The logic is `src/app`: the derived-results store (`derived.ts`: one walk
per revision with simulation and validation, published as revisioned values; `provisionalNote`,
`isCurrent`), its pipeline in a lazy chunk (`derived-pipeline.ts`), and `issue-codes.ts` over the
registry. The ui only renders it: `src/ui/app/derived-view.ts` turns the derived state into row
values, readouts and sentences (pure, tested alone), and the panels read it through memoised
selectors (§11).

**Principles.** Unknown stays unknown: a number the walk could not work out is `?` with the reason
it recorded, said after "Unknown:" ("An item objective has no drop source in the data", "The
quest’s XP is not in the data"), never 0; before the first walk the reason is "Not simulated
yet: the route simulation is loading", or the failure. Every number carries its basis from its
estimate: `≈` for an assumption, `E` for Era values standing in for Forever ones, `≥` for a lower
bound, `≤` for an upper bound (§4). An assumed number that reads no parameter names the rule it
rests on: a note's or an abandon's 0 s reads "the rule that a note takes no time (SIMULATION
TIME-8)". Numbers that depend on travel time while walking paths are computed, or while the
navigation data is still being checked, carry the pending hourglass with `provisionalNote`'s
sentence ("Pending: 3 walking legs are still being computed; their times use the straight-line
estimate."). No new colour: severity keeps its three tokens, everything else here is neutral.

**Route rows** (§8). The estimate column (level after, XP gained or step time, "Rows show"), its
markers, the pending hourglass (step-time column only) and the issue indicator are filled in from
the walk as the row renders. A step is pending when one of its walking legs is still being
computed, and, while the navigation data is being checked, every step that travels is (its time
is the straight-line estimate until the check ends; Milestone 6 review UI-05); rows, row names and
Details say which. The quest chip's difficulty is taken at the level the step starts at (the level
after the previous step, or the start level), dashed while that level is a lower bound; the
colours are the reserved difficulty colours, unchanged. After an edit the walk follows within a
timer tick: until it does, rows are matched to the published walk by step id, and a step the walk
has not seen yet says "Not simulated yet: the route is being simulated again after the last edit".

**Status bar: where the route metrics go.** ARCHITECTURE §12.4 puts the level and XP bar, the
duration and XP per hour in the status bar; it says nothing about the route's XP total and the
time shares, so they go where they take least room:

- *Always visible:* "Lv 4 after step 12" (the level in 15px bold and where it is read in 12px
  muted; ui-refresh.md §8) and the XP bar at the active step ("Level after step 12"), else at the end
  of the route: 200 × 12px with 20 ticks every 5% (decorative, not drawn under forced colours; the
  numbers carry the value), its value beside it; "Time" (the route's duration), "XP" (the route's XP
  total, hidden at 1440px and below) and "XP/h", each a `ReadoutValue` with its markers; Time and
  XP/h carry the pending marker while the walk is provisional.
- *In log* ("In log 4 / 40", hidden at 1280px and below): the quests in the log after the active
  step against the ruleset's `questLogCapacity`, "≥4 / 40" while the log before the route is not
  known (history "partly known"); its tooltip and spoken words name the capacity's basis ("client
  data", or "your project's value"); "?" with the reason without a walked step, never 0. The Quest
  log tab's count and name say the same ("Quest log, 4 quests after step 12").
- *XP per hour's bound* (UI-10). It is the known XP over the known time. When some steps' time is
  unknown (the duration is `≥`) and all XP is known, the true rate is at most this: `≤`, said "at
  most". When some XP is unknown and all time is known, it is at least this: `≥`. When both are
  missing it is bounded in no direction, so it is `?`, and the reason gives the rate over the known
  steps. The shares are of the known time only: bounded in no direction, their basis says "of the
  known time only (2 steps with unknown time not counted)".
- *Summary* (a disclosure button after XP/h, `RouteSummary`): a table of every route metric with
  its basis in words: duration, XP gained, level reached, XP per hour, and the shares of travel,
  combat and objectives, interaction and waiting (the time-based ones pending while provisional),
  then notes: the pending sentence, "Updating: …" while the walk lags an edit, what is not counted
  ("2 steps with unknown time are not counted: the route takes at least this long.", and the travel
  to objective work turn-ins carry, D-040: "3 turn-ins include the time and kill XP of objectives no
  Complete step finishes, but not the travel to them, so the route may take longer.", counting only
  the turn-ins whose time includes that work: not those whose duration override stands in for it
  or whose time is unknown), that XP per
  hour and the shares are over the known time and XP, and the travel model in a sentence; then
  every parameter the route reads that is an assumption or an Era value, as a list, each with its
  origin ("run speed (Era value)", "seconds per kill (your assumption)"): all of them, never "and 3
  more", which only tooltips use (UI-13). The travel sentence names the world maps whose
  navigation files failed ("except on Kalimdor (world map 1)", the id kept for diagnosis; a map
  without a name is "world map 36"), from the map panel's surfaces (UI-14). The panel opens above
  the status bar, at its right end, over the side panel (`position: absolute` in the status bar,
  its containing block, so it clears a bar of two lines at 1024px and below; `--frl-z-popover`),
  and closes with its button, Escape (focus back on the button), a press outside, or keyboard focus
  leaving it: a Tab or Shift+Tab past it closes it, so it never hides the focused control behind
  it (WCAG 2.4.11, UI-06). It holds no controls; when its content scrolls, the browser makes the
  panel itself a tab stop for keyboard scrolling. At 720px and below the page scrolls, so the open
  panel is laid out in the flow, on its own line under its button: it scrolls with the button and
  never covers it (UI-07).

**Simulation status** (`SimulationStatus`, before the optimiser in the status bar). One item that
says what the simulation is doing, never as a dialog and never announced by itself. It has
priority in the bar (§6): it never shrinks or clips.

| State | Shows |
|---|---|
| loading / failed | "Simulation: Loading" / "Simulation: Failed" with the reason |
| checking | "Travel: Checking navigation data" (times are straight-line estimates meanwhile; the rows that travel are pending) |
| computing | "Paths", a progress bar (legs answered of those asked, `aria-valuetext` "3 of 8 legs"), "3/8", and "Cancel" (named "Cancel computing walking paths"). While the run has not said how many legs it computes (a total of 0), and between two runs while legs are still pending (after Resume, until the walk that asks for them again), it is "Paths: Counting legs…" with the indeterminate bar (the unknown hatching under reduced motion), `aria-valuetext` "Counting legs", no numbers and never "0/0" (UI-08) |
| paused | "Paths: Paused, 42 legs pending" and "Resume" |
| straight-line | "Travel: Straight-line estimates" (or "Some straight-line estimates" for some maps, or after a worker failure) with the reason in words: "Navigation data is unavailable (…): every travel time is a straight-line estimate." |
| ready | nothing; while the item still holds keyboard focus (computing ended under the focused Cancel), "Paths: None pending", until focus leaves it |

Cancel calls the derived store's `cancelPaths` (legs computed so far are kept; pending legs keep
their straight-line estimates, labelled pending, until Resume, `resumePaths`) and announces
"Computing walking paths paused: pending legs keep their straight-line estimates. Resume from the
status bar."; Resume announces "Computing walking paths resumed.". Keyboard focus is never
dropped to the page (UI-03): each button replaces the other, and focus moves to the one that takes
its place, or to the item when none does; the item never disappears between two states while
legs are pending; and when computing ends in the background under the focused Cancel, the item
stays, focused and showing its ring, as "Paths: None pending" until focus leaves it. Background
work never moves focus anywhere else: the item takes focus back only when the focused control
inside it went.

**Validation tab** (`ValidationPanel`, loaded on first use). The tab's badge is the worst
severity's shape and the total, named in words ("2 errors, 14 warnings, 30 info issues"; one word,
"info", in the counts, the filter and its messages, UI-20); it is empty, never "no issues", until
the route has been checked. The panel:

- says "Not checked yet" with the reason while there are no results, and that no issues are
  claimed to be absent;
- heads the list with the counts in words, the pending sentence when travel checks may still
  change, and the last walk's failure when a later one failed;
- lists the issues in the validator's order (route-level first, then by step), each with its
  severity's shape and word, message, where it is ("Step 12", "Route", or "A step no longer in the
  route" while the walk lags an edit), its code and, from the registry, what the code means;
- filters with "Show": all, errors and warnings, errors, warnings, info (each with its count),
  announcing the count shown; pages of 100 with "Show 100 more";
- makes each issue about a step a button, all of them one composite: one tab stop (the issue last
  used), ↑ ↓ Home End between issues, Enter or Space (or a click) to choose. Choosing selects the
  step, puts keyboard focus on the route list with that step active (the map follows the active
  step) and announces "Showing step 12 in the route: error VAL004-min-level.", and only that: the
  new selection's count is not said after it (§9 rule 6, UI-11); the tab stays on Validation, so
  the next issue is a Tab away. Route-level issues are text, not buttons.

**Details.** For the active step: Duration (with the pending marker and its reason, and the
override when one replaces the step's own work), XP gained and Level after, each with its
markers; for a turn-in that carries objective work (D-040), "Objective work" says which objectives'
time and kill XP it includes, without the travel to them (or, with a duration override or an
unknown time, that it includes their kill XP and what stands for the time), and for an accept that
counts items a Complete step collected before it, which objectives count at once; and "Issues at
this step" (the kit's `IssueList` without buttons, and a pointer to the Validation tab for the
explanations).

**Performance** (Milestone 6 review PERF-11). No per-row heavy work: rows are built once per route
change; the walk's numbers are read as the ~40 mounted rows render. The pipeline publishes the
paths' progress once per worker message; only the simulation item draws it, so it subscribes on
its own (`simulationStatusOf` with `sameSimulationStatus`), and the status bar's metrics, the
validation panel (`sameResultsView`) and the route rows (`sameRowSource`) compare the derived
state without the progress counts, so a progress tick re-renders the simulation item alone. The
rows are memoised: `deriveRow` hands back the same model for a row whose numbers a new walk left as
they were, and the list's row callbacks are one stable object, so a re-walk re-renders only the
rows whose numbers changed. The side panel's tab counts and Details use narrow selectors with
equality. Issue counts are cached per issue list. Measured on a 10,000-step route with 10,877
issues (happy-dom and React's development build, so relative; `act` around one publish; median of
the three runs' medians of 40, on a loaded machine): a progress tick 7.0 → 0.41 ms with Details
open and 11.0 → 0.37 ms with the Validation tab open; a re-walk publish with unchanged numbers
6.6 → 3.8 ms and 11.0 → 5.5 ms; an edit 73 → 70 ms and 117 → 108 ms (the route view is rebuilt,
so it is unchanged within the noise). Throttling the progress publishes is the pipeline's
(ARCHITECTURE §12.1); the browser commit times are for the Milestone 9 run.

**A selection change** (review UI-04). The quest state, places and labels for the new active step
are rebuilt in a task of their own once the selection has stood still for `SELECTION_SETTLE_MS`
(60 ms, which the app passes to the pipeline; `selectionSettleMs`): arrowing through the list
rebuilds them once, where it stops, and the selection paints first. **Gate:** a selection change on
the 10,000-step project settles in 50 ms or less at 4× CPU throttling (headless Chrome, the UR.2b
harness, the Available tab, median of 30). MEASURED (fix-ui, 2026-09-30, the working tree with the
other fixes of this review): 8.0 ms at 1× and 47.1 ms at 4× (p90 54.6 ms), against 19.8 ms and
112.3 ms with the rebuild in the next task (the `?settle=0` comparison on the same build).

**Checked by hand** (Milestone 6 review fixes, in the built app in headless Edge through the
DevTools protocol, walking paths held by holding the navigation files): the status bar at 721-1600px
in both themes and under forced colours (§6); Cancel then Resume by keyboard keeps focus on a
button (Resume, then Cancel at once), and computing ending under the focused Cancel leaves focus on
the item with its ring (Shift+Tab then reaches Summary, and the item goes); with the summary open,
thirty Shift+Tab stops from it leave no focused control under the panel (it closes on the first
step out); at 375×812 the open panel sits in the flow under its button and scrolls with it;
choosing an issue says only "Showing step …"; with the navigation manifest held, the rows that
travel say the checking sentence (14 of 27 on the sample route) and so does Details; a map whose
navigation files fail is named "Kalimdor (world map 1)"; at 800×700 (a 288px route panel) titles on
rows with an issue marker keep at least 90px. The component and shell tests (happy-dom and Testing
Library) cover rendering with issues, the keyboard path from an issue to its step, basis, bound and
pending markers, Cancel and Resume with focus, names and announcements, what a progress tick
re-renders, and the shell over the real pipeline (`App.pipeline.test.tsx`).
