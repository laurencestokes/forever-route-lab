# Review: Milestone 3 map

Reviewed 2026-09-25/26 by two critics working independently of the implementers.

- **Rendering and performance.** The critic built the production app and a harness around the
  real adapter, then measured in the desktop app's Chromium pane: User Timing marks, forced
  redraws, and a synthetic 5,000-path load.
- **Map UX, coordinates and accessibility.** The critic checked the live build against the data:
  all 557 zone-spawn markers on Kalimdor match an independent percent→world calculation to within
  1e-4 yd, the 23 instance markers sit on their entrances, and all 54 step markers match their
  spawns.

A third critic reviewed the Milestone 3b terrain design. Those findings (TN-01..18) are handled by
the design revision and are not part of this milestone.

**Result:** 28 findings (6 majors, 13 minors, 9 nits). All were accepted. A verifier confirmed
27 as done and 1 as partial.

## Majors

| ID | Finding | Resolution |
|---|---|---|
| PERF-1 | In-place updates and hovers restacked whole layers, so every frame redrew the full canvas | Restacks only on create or a real order change. Hover is drawn as a copy in the selection layer. Tests count `bringToFront` calls |
| PERF-2 | Step numbers baked into descriptors meant every insert or delete changed all later markers | Labels come from a provider at hover time. Route lines are cut into chunks at content-defined points. Label-only changes skip canvas work. **Partial:** see Known issues |
| PERF-3 | The 5,000-path cap had never been measured, and failed under throttling | Cap is now 2,500, with lower per-glyph cost and padding 0.1; the measurements are in MAPS §7.2 |
| PERF-4 / MAP-UX-2 | Zone jumps and aggregate clicks could stay stuck showing counts ("zoom in" did nothing) | Fits use a minimum zoom of the zone level, and the jumped-to zone is drawn raw |
| MAP-UX-1 | A click at continent zoom jumped to the smallest frame (Crossroads → Durotar) | The controller picks the zone the point is most central in (`geo` `zoneFramesContaining`). Tested |

## Minors and nits (all done)

**Performance:**
- resize coalescing (PERF-5);
- one sync per selection change (PERF-6);
- ranking hysteresis (PERF-7);
- capped timing entries (PERF-8);
- only drawn art requested (PERF-9);
- no-op timing entries skipped (PERF-10);
- unused Leaflet icons removed, with the lazy chunk reported by the audit (PERF-11);
- grid redraws (PERF-12);
- badge bounds (PERF-13);
- hover kept out of the store (PERF-14).

**Map UX:**
- merged co-located markers with a chooser, and flight masters open their quests (MAP-UX-3);
- zoom floor fitted to the container (MAP-UX-7);
- steps on unsupported world maps are explained (MAP-UX-9);
- zone selection clears when the zone leaves the view (MAP-UX-12);
- mojibake fixed (MAP-UX-11).

**Honesty:**
- quests with no spawns are counted and named (MAP-HONEST-4);
- units named in every note (MAP-HONEST-5);
- a hearth without a known destination is drawn as unknown (MAP-HONEST-8).

**Accessibility:**
- map-frame colour token at 3:1 or better (MAP-A11Y-6);
- legend and badge text (MAP-A11Y-10);
- schematic notice in the description (MAP-A11Y-13);
- axis labels with N/W (MAP-COORD-14).

**Open UI item:** hovering a route row now highlights its marker.

## Known issues (tracked)

- **PERF-2 at 10,000 steps:** moving a step takes 17–20 ms and a selection change 14–17 ms,
  against the 8 ms route-edit budget. The sample route and routes of up to about 1,000 steps are
  within budget. The cause is that the step-marker layer's cache key includes the focus, so the
  whole layer rebuilds (`layers.ts`). This is scheduled for Milestone 4 (route editing) with a
  measured target.
- One quest-giver aggregate is drawn for UiMap 947 (Azeroth), from points QuestieDB publishes on
  the world map. This is to be reviewed when the terrain map layers land (Milestone 3b).

## Evidence boundary

The measurements are unthrottled, on the development machine, with the browser pane hidden
(requestAnimationFrame stalls there, so redraws were forced). The 4× CPU-throttled runs are
planned with Playwright in Milestone 9.
