# Review: Milestone 1 foundation

Reviewed 2026-09-25 by two critics, independently of the implementers:

- a **code and architecture** critic, who probed the architecture test and the schema type-equality
  test with synthetic violations in a scratch copy;
- a **UI/UX and accessibility** critic, who measured layout in a real browser at six viewport
  sizes in both themes and computed WCAG contrast for about 60 token pairs per theme.

**Result:** 46 findings (5 majors, 26 minors, 15 nits). All majors and all minors were accepted
and fixed, apart from the two noted under "Deferred". A separate verifier re-ran every check and
confirmed each fix in the code.

## Majors

| ID | Finding | Resolution |
|---|---|---|
| F1 / F-01 | The token and contrast guard `tests/ui-tokens.test.ts` was documented but did not exist | Added. It checks theme parity, reserved difficulty colours against `src/rules/difficulty.ts`, WCAG pairs (including the pairs behind F-04 and F-05), hue separation and row height |
| F2 | Bitwise operators were not forbidden, although race masks exceed 32 bits (D-012) | `no-bitwise` is an error repo-wide. The architecture test walks the TypeScript syntax tree for bitwise operators |
| F-02 | Visually hidden text escaped the scroll containers, so the whole shell could scroll | Containing blocks on the panels; the document does not scroll above 720 px |
| F-03 | Toolbar buttons that disabled themselves dropped keyboard focus to `<body>` | `aria-disabled` with guarded handlers; focus stays in place, with tests |

## Minors (all fixed)

- **Type checking:** three strict configs. Pure modules get ES2023 only, with no DOM or Node types
  (F3), and the banned-globals scan is extended.
- **Store and project data:**
  - prototype-key lookups go through `routeGroup` / `questOverride`, and reserved keys are rejected
    on import (F4);
  - the edit lock is a set of reasons, and `replaceProject` is refused while locked (F5);
  - the React binding exception is recorded as D-027 (F6);
  - clipboard-only commands close undo coalescing (F18).
- **Build gates:** the build runs the licence gate (F7), data files need a size baseline (F10),
  and the architecture scan cannot pass vacuously (F14).
- **Quest rules and data display:**
  - scaling quests (level −1) and unknown levels in difficulty (F8);
  - grind-fraction rounding (F9);
  - quests whose race or class masks are unreadable show as unknown in Available (F12);
  - the green-range table is injectable and the yellow bound is validated (F15);
  - `ValidationIssue` uses explicit nulls (F16).
- **App shell:** per-panel store slices, with `App.tsx` split from 821 to 141 lines (F13);
  deterministic ids in UI tests (F19).
- **UI behaviour:**
  - the About dialog has a placeholder mode (F11 / F-06);
  - a permanent polite live region announces selection and command results (F-07 / F-15);
  - jump-to-zone commits on Enter or Go (F-08);
  - destructive shortcuts are scoped to the route editor (F-23).
- **Accessibility:**
  - list positions count steps only (F-09);
  - stable option ids (F-10);
  - no focusable content inside options (F-11);
  - forced-colours support (F-12);
  - reduced-motion indeterminate bar (F-14);
  - crisp difficulty pips (F-16);
  - a visible legend for unknown values (F-17);
  - a page `h1` (F-19);
  - consistent `aria-controls` (F-21);
  - `aria-keyshortcuts` (F-22).
- **Visual fixes:**
  - unknown XP is visible at every width (F-04);
  - stronger `border-strong` (F-05);
  - no layout overlap in the map placeholder (F-13);
  - disabled ghost buttons (F-18);
  - quest-name ellipsis (F-20);
  - dialog backdrop close (F-26);
  - the placeholder frame build is labelled "placeholder" (F-25);
  - the build manifest is no longer deployed (F17 / F-24).

## Deferred

- **F-11 automated check:** an axe-core accessibility run was not added, because axe-core is not a
  dependency. It is planned with the Playwright smoke test in the gauntlet milestone.
- **F-02 regression check:** happy-dom has no layout engine, so the "page never scrolls" check is
  a manual step (docs/UI.md §6) until the Playwright smoke test exists.

## Evidence boundary

The browser measurements were taken on the development machine in the desktop app's browser.
Screen-reader behaviour (NVDA/JAWS) was reasoned from the ARIA patterns, not tested with a screen
reader.
