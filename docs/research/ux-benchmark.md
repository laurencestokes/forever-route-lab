# UX benchmark: another community planner (feature notes only)

Observed 2026-09-25 at https://tyba-dev.github.io/WoWF-QRP/ (the planner shown in the project
brief's reference screenshot), through its visible interface only. Nothing was taken from it:
no code, data files, map art, icons or text. Per the brief, it is never scraped. These notes
record interaction ideas, for us to implement in our own way where they fit our architecture.

## Ideas worth adopting

| Idea | What we would build | Milestone |
|---|---|---|
| Available quests grouped by zone, with a "near this step" filter | Available tab: group by zone and add a distance-from-selected-step filter, both from engine state at the selected step | 4 (grouping), 6 (state-aware) |
| Locked quests shown with the reason ("needs X", "level N") | Available tab: quests that fail `canAccept` show the failing rule (VAL codes) instead of being hidden | 6 |
| "Unlocks soon": quests gated only by level | A section for quests blocked only by VAL-4 (level), with the level they open at | 6 |
| New steps inserted after the highlighted step | Insert-after-selection as the default insert point for Accept and Add actions | 4 |
| Quest chain position ("(1/2)") | Chain position from `nextQuestInChain` and pre-quest links, shown in titles | 4 |
| Status summary at route end: level, turn-ins, quest-log fill | Status bar: route-end level (lower bound when uncertain), turn-in count, `log n / capacity` | 6 |
| Group size selector in the status bar | Quick group-size control bound to `assumptions.groupSize` | 6 |

## Deliberate differences

- **Quest log capacity.** It displays a 20-quest log, the Era value. The Forever client constant
  is 40 (`client-data`; server enforcement at launch unknown, SIMULATION.md VAL-20), and our
  ruleset uses 40.
- **Unknown values.** It shows XP figures as plain numbers. We label Era-seed XP and assumption-
  based numbers, and show unknown XP as unknown, never as 0 (ARCHITECTURE §2 principle 3).
- **Zones.** Its zone list gives a levelling range for Darkspear Islands; our research found it
  to be a 15v15 battleground (docs/research/forever-game-rules.md §5.1). Our zone list comes
  from committed geometry and data, and ranges are shown only where sourced.
- **Map art.** It uses Blizzard map artwork. Ours stays procedural unless a developer extracts
  maps locally (D-018).

## From its README (read for reference with the owner's permission, 2026-09-25)

The project declares GPL-3.0. Its README describes four capabilities:

- terrain-following walking routes (path-finding over walkability derived from terrain files
  exported from the game);
- flight paths from Questie's flight masters, with connections and times estimated from distance;
- zeppelins, boats and the Deeprun Tram;
- RXP import and export that keeps guide steps as written.

No code was read beyond the README and the repository's top-level layout, and nothing was copied.

- **Already in our design:** distance-estimated flights keyed by flight masters (ARCHITECTURE
  §9.1), a transport graph (§9.1), and RXP export that reproduces unedited guides byte for byte
  (§10).
- **Terrain-aware walking:** promoted to Milestone 3b by owner decision D-028, with committed,
  derived navigation data (terrain plus object collision) and our own read-only CASC reader.
  The straight-line × detour model stays as the labelled fallback.
- **Licence statement:** its README describes QuestieDB as GPL-3.0. Our full-history check found
  no licence file ever published by Questie or QuestieDB (D-016). Our notices say so neutrally.
