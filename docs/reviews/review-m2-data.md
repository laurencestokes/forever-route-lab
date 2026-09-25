# Review: Milestone 2 Forever data pipeline

Reviewed 2026-09-25 by three critics working independently of the implementers. They ran
experiments in scratch copies only.

- **Data and provenance.** Re-ran the full extraction from the pin in a fresh clone. Spot-checked
  records against the upstream Lua and probed the correction evaluator with mutations.
- **Coordinates.** Recomputed all 61 geometry rows from the source CSVs, then recomputed every
  zone-spawn world point for both factions, 152,581 in total. Cross-checked flight masters against
  TaxiNodes and Era positions against Forever positions.
- **Code and app.** Probed the loader with a fake server, loaded tampered builds in a browser and
  measured build and render times.

**Result:** 44 findings: 2 majors, 25 minors and 17 nits. All were accepted and fixed. The
verifier found four residual gaps, and the architect closed them before the commit (below).

## What the critics confirmed

- **Reproducible.** A fresh fetch and extraction gave byte-identical `public/data` and fixture
  files, and the same `dataRevision`.
- **Correct.** No shipped value differs from its source:
  - 0 mismatches for uncorrected records against the raw upstream rows;
  - the static corrections re-applied independently;
  - more than 40 records checked by hand, including corrected fields, overlays, objective
    order hints, created records and sentinels;
  - all 57 zone names and all 557 dungeon-quest flags recomputed.
- **Geometry exact.** All 61 rows equal the CSVs and `conversion.json` exactly. The frame hash
  reproduces. World points recomputed independently differ by 0 yd. Flight masters lie a median
  of 3.5 yd from their TaxiNodes.

## Majors

| ID | Finding | Resolution |
|---|---|---|
| data-F1 | The correction evaluator accepted `local a, b = f()`, dropping values Lua would bind (D-009 says it fails closed) | Fails closed. The architect extended this to the whole bug class: host functions now declare whether they are single-valued, and a call in any position where Lua expands return values fails closed unless the callee is declared single-valued (upstream `l10n` and the module loaders are, citing `compat.lua:145, 199-206`). The dataset was unchanged (`dataRevision` identical) |
| code-F1 | Without the QuestieDB clone, `pnpm check` never validated `public/data` against its manifest | A clone-free validation test, and `data:validate` in `check`. `data:check` (fetch, `extract --check`, validate) stays a manual gate until CI |

## Minors and nits (all fixed)

**Tooling:** upstream semantics files hash-pinned (data-F2); accurate network logging and a depth-1
fetch, taking a cold fetch from 7 m 33 s to 24.5 s (data-F4); the Node major out of the manifest
(data-F5); lockfile hash limited to the tool's own packages (data-F6); tree hashing that works
without git (data-F7); stricter `extract --check` (code-F11); validator coverage (code-F15); new tool
tests (code-F13); overlay diffs that ignore `_generated` (data-F11); a dungeon allowlist that fails
on new keys (data-F12).

**Data contract:**
- upstream's "0 means none" single-id fields normalised to null (data-F13, code-F8);
- zone links split into direct and routed, with validate refusing drawable points on routed keys
  (COORD-3);
- three audit-flagged entrances marked frame-unverified (COORD-4);
- slice counts labelled (data-F16);
- the item-start ids of declared Wowhead origin published (data-F10).

**Notices and wording:**
- "no root licence file (none covering Questie's own code or data)" everywhere, rendered from the
  pin record (data-F9);
- NOTICE posture sentence (data-F8);
- repository links instead of repository-only paths, including the placeholder NOTICE (data-F15,
  closed by the architect);
- origin labels (data-F10, F17);
- README counts (data-F14).

**Loader and app:**
- geometry fetched revalidated, with a content hash covering every field and a retry past the cache
  (COORD-1, code-F2, closed by the architect);
- data and geometry paired by the `conversion.json` hash (COORD-10);
- instance-presence spawns labelled as instances, not entrance zones (COORD-2, code-F5);
- failures carry a remedy (code-F3);
- one abort signal for all loads, and body-read errors (code-F6);
- fixture slices refused at runtime (code-F7);
- local-set refusal reasons shown (code-F14);
- Available list paging (code-F4);
- sample route without seasonal or repeatable quests, and Available sorted by effective level with
  "requires N" (COORD-8, code-F9);
- world point axes labelled (COORD-7).

**Geo:** zone attribution falls back to the most central frame, raising agreement from 72.0% to
87.2% (COORD-5); more changed-frame landmarks (COORD-6); documentation (COORD-9, COORD-11).

## Residual gaps closed by the architect before the commit

1. **Evaluator:** the data-F1 class (see Majors). The first attempt, which rejected every such
   call, correctly failed on upstream `classicQuestFixes.lua:1082` (`l10n` in an
   `extraObjectives` entry). That led to the arity-based rule.
2. **Placeholder NOTICE:** it now links repository URLs.
3. **Damaged geometry copy:** refetched once past the cache before failing, with a test.
4. **Research docs:** licence wording corrected in place and marked.

## Evidence boundary

- **Measurements:** browser figures come from the desktop app's Chromium pane on the development
  machine and were not throttled. The planned 4× CPU throttle run happens with Playwright in
  Milestone 9.
- **Legal questions:** identified, not answered (D-016).
