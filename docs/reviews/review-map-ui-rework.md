# Review: the map and UI rework (atlas, minimap style, pins and drawer, WoWF-QRP-like UI)

Reviewed 2026-09-28 to 2026-09-30, after the owner's feedback of 2026-09-26/27 (the map was slow and
did not flow; both continents and Zephras Isle were missing; it should be "mapgenie.io style overall";
the UI should be "more like WoWF-QRP").

**Designs:**
- [research/map-atlas.md](../research/map-atlas.md) revision 3.1 (atlas and minimap style);
- [research/map-presentation.md](../research/map-presentation.md) revision 3.1 (pins, drawer,
  extras);
- [research/ui-refresh.md](../research/ui-refresh.md) revision 2.

Each design was critiqued and revised before building. Decisions D-042, D-045 to D-049 and D-050.

**Build:** the steps ATL.0-ATL.10, MM.1-MM.9, MP.0c-MP.11 and UR.1a-UR.6 ran as one serial chain on
the shared map and UI files. The minimap tile tool and its hosting were built in parallel. Then came
a measurement pass (ATL.9, MM.8, UR.8) in both styles at 1× and 4× CPU.

**Review:** six critics, each with a sceptic who tried to refute every finding:
- map runtime and speed;
- tiles, hosting and provenance;
- pins, drawer and extras;
- the UI refresh against WoWF-QRP;
- travel data and the engine;
- whole-app QA.

Then came five fixers by area and a final verifier. The fixers and the verifier were interrupted by
a usage limit and resumed from cache on 2026-09-30.

**Result:** 100 findings. 99 were confirmed or partly confirmed (26 major, 54 minor, 19 nit); 1 was
refuted. By area:

| Area | Findings |
|---|---:|
| Whole-app QA | 27 |
| Pins, drawer and extras | 21 |
| UI refresh | 18 |
| Travel data | 14 |
| Tiles and hosting | 11 |
| Map runtime | 9 |

The owner signed off the built sheets on 2026-09-30:
- `.cache/map-ui-build/bench-compare.jpg`;
- `ui-compare.jpg`;
- `contact-sheet-minimap.jpg`;
- `contact-sheet-painted.jpg`;
- `minimap-sheets/edge-skirts.png`.

## What was built

- **One atlas surface** with both continents in the compact layout and Zephras Isle as a captioned
  card. Instances keep their own surfaces.
- **Two styles:**
  - the client minimap at 1 yd/px with a navy sea, as the default: 6,647 tiles, 52.17 MB gzip-6,
    shipped as a release-asset pack that is never committed;
  - the painted atlas as a toggle: 6.95 MB.
- **Tiles:**
  - an underlay, with no hole frames in 20 cases;
  - a smooth wheel: 5-8 notches from the world view to a zone, against 43-46 before;
  - memory within budget in both styles.
- **Presentation:**
  - MapGenie-style pins with the pip tag, clusters and the one state table (`src/map/marks.ts`,
    split into `marks.ts` and `marks-pins.ts`);
  - the "Map layers" drawer with counts, search and the style toggle;
  - zone labels with level spans, and the underground cities labelled;
  - dungeons with their LFG tuning levels;
  - the client flight network and TIME-6 flight times (OD-6 settled);
  - transports with inferred docks;
  - the faction overlay, services, and a popover with a Wowhead link.
- **UI:**
  - a WoWF-QRP-like left panel with "!"/"?" discs in difficulty colour, two-line rows and muted row
    buttons;
  - the shaded band for later steps;
  - the button kit and warm neutrals;
  - collapsible panels and map focus (Alt+M);
  - the tabs, quest lists and a lazy Quest log.

## Open, tracked in STATUS

1. **The client is off the pin.** The owner's client updated to 1.60.1.70124. Every client gate
   refuses to run, and `nav:validate` G13 fails, because the navigation tool's tree hash moved when
   `src/geo` changed. The owner decided to re-pin and rebuild (D-050).
2. **Speed regressions:**
   - `map-edit --check`: selection 2.4-3.4 ms against 1.84; move 6.5-7.4 ms, p90 up to 8.9 against
     8.
   - `derived --check`: +26% to +75%.
   - The map follows a selection 89-95 ms after the click (the 60 ms settle), and an edit in
     40-54 ms (was 5.5).
   - A 10,000-step pan at 4× has p99 48.7 ms.
   - First art at 4× takes 1.6-2.3 s (MR-07).
   - First-view bytes: 398 kB counting everything loaded before the view settles (MR-06).
3. **Entry chunk:** 248.98 kB, 0.48 kB over the 248.5 kB stop rule. Moving the clustering into
   the derived publish, about −1.1 kB, is still owed.
4. **Readability of the left panel.** The owner, after sign-off: "I think the left panel is more
   readable on WoWF-QRP". Titles are cut off, and each row carries many small parts.
5. **Smaller items:**
   - TR-03: berths in the water are priced as swims;
   - TR-10: 3 flight masters are unmatched;
   - PR-16: labels move with the selection;
   - UI-04: selection p90 is 54.6 ms;
   - UI-06: the dark later band;
   - UI-15: one-line titles;
   - UI-16: warmth;
   - QA-20;
   - MD-01: the stopgap re-manifest;
   - MD-10;
   - PR-13, PR-18 and UI-08, now decided in D-050.

## Evidence boundary

- **Measurements** were taken on the development machine, with the WoW client running during the
  final run (12-15% CPU). The owner's laptop trace (integrated GPU) is still owed.
- **Screen readers:** behaviour is reasoned from ARIA; there was no NVDA or JAWS run.
