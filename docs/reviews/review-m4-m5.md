# Review: Milestones 4 (editor and storage) and 5 (RXP)

Reviewed 2026-09-26 by three critics, independently of the implementers:

- **Editor and storage.** Experiments against the real session code with fake-indexeddb and
  memory storage. They covered page-hide flushes, two tabs, quota, renames, deletes, and
  autosave and map benches on a 10,000-step route.
- **RXP parser.** A D-019 structural comparison with RXPGuides' loader. The critic is permitted
  to read it and copied nothing. It ran round trips over the fixtures, CR/CRLF/mixed/BOM
  variants, 4,500 grammar-fuzzed guides, and (in memory only) RXP's 58 Forever guides, and ran
  the overlap gate.
- **UI and accessibility.** A production preview in the desktop app's browser at 1366×768 in both
  themes, with the RXP import dialog also at 700 and 375 px.

**Result:** 71 findings (1 blocker, 17 majors, 30 minors, 12 nits, plus RXP UI integration
items). A three-way fix pass (storage, RXP core and spec, UI) and a verifier followed. The
architect closed the last small items (drift dialog focus, export file names, local dates).

## Blocker

| ID | Finding | Resolution |
|---|---|---|
| RXP-F1 | After canonicalisation, a self-authored fixture line equalled an RXPGuides guide line, and the overlap gate failed | Line reworded in both copies. The overlap tool now also compares canonical forms. 0 overlaps, 4 allowlisted API lines |

## Majors (all fixed)

**Storage:**
- writes started on hide are issued inside the handler, with a before-close guard (CR-01);
- tabs coordinate through Web Locks and BroadcastChannel (CR-02);
- permanent delete and quota recovery (CR-03);
- autosave is no longer cancelled by a rename (CR-04);
- unsaved work is kept on delete (CR-05);
- an autosave bench, and memory storage without copies (CR-06, bench partial, D-036);
- PERF-2 re-measured in the browser and reworded honestly (CR-07).

**RXP:**
- empty filter alternatives are ignored, matching RXP (RXP-F2);
- trailing comments are kept on rebuilt lines (RXP-F3).

**UI:**
- no undo behind modals (UI-F1);
- per-dialog live regions (UI-F2);
- Projects dialog focus (UI-F3);
- Details editor focus (UI-F4);
- custom quest editor focus (UI-F5);
- focus moves to the problem list on the first failed save (UI-F6);
- RXP colour and texture escapes shown as plain text (UI-F7).

**RXP UI integration:** "complete all objectives" steps are now exportable.

## Minors and nits

Fixed:

- **Storage and editor:**
  - failure status kept during retries (CR-09);
  - custom quest id safety (CR-10);
  - imports validated (CR-11);
  - export during drift (CR-12);
  - startup read errors (CR-13);
  - metadata-only index reads (CR-14);
  - strict UTF-8 (CR-16);
  - location editor re-sync (CR-17);
  - one migration backup per version (CR-18).
- **RXP:** RXP-F4 to F21, including safe-integer bounds, the quadratic Lua column fix, the prefix
  families, spec corrections and the fixture 04 diagnostics tests.
- **UI:** UI-F8, F9, F10, F11 (drift dialog focus, architect), F12 to F16, F18, and F19 and F20
  in part (file-name separator and local dates, architect).

**Deferred with triggers** (D-036): CR-06 chunked storage (Milestone 9 throttled run), CR-19 lazy
Projects and Import/Export dialogs (only if the entry chunk nears its budget), UI-F17 (locked
states not reachable until the optimiser exists), and UI-F19 item 4 (optional initial focus).

## Evidence boundary

- **Performance:** measured unthrottled on the development machine. The 4× throttled runs are
  planned for Milestone 9.
- **Screen readers:** behaviour was reasoned from the HTML and ARIA specifications (inert content,
  live regions), not tested with NVDA or JAWS.
- **RXPGuides:** only the critic read the source, and only to compare structure and behaviour.
  The implementers worked from RXP.md (D-019).
