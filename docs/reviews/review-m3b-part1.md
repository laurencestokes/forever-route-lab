# Review: Milestone 3b part 1 (terrain build, map art, pure navigation runtime)

Reviewed 2026-09-26. The design ([research/terrain-navigation.md](../research/terrain-navigation.md))
went through two critiques before implementation (revision 3; re-critique conditions RC-01..RC-13).
Four implementers built the parts: navmesh build, map art with terrain byproducts, and the pure
`src/nav` runtime. A foundations pass came first. An independent verifier then re-ran every gate
against the installed client (1.60.1.70009) and fixed what it found.

The navigation worker, the `TravelModel` wiring and the map layers are part 2. Part 2 ends with
the 3b.9 navigation review, which critiques the runtime and the map from the user's side.

## Measured results

| Output | Measured (gzip-6, decimal) | Budget |
|---|---|---|
| `public/nav/` (113 files) | 5,437,717 B; blocks and `map.bin` 5,423,019 B (Eastern Kingdoms 2,526,155, Kalimdor 2,896,864); largest file 131,177 B | 7 MB cap, 5-6 MB target, 300 kB per file |
| `public/maps/art/` (60 WebP images plus manifest and NOTICE) | 9,047,639 B | 12 MB |
| `public/maps/terrain/` (relief, coastlines, zone outlines) | 445,061 B | 600 kB |

- **Build:** a full navmesh build takes 76 s on the development machine. An independent rebuild
  gave 113 of 113 files byte-identical, and the art and byproducts rebuild byte for byte.
- **Census (74,608 spawns):** 72,626 on the main component. The other 1,982 spawns are:
  - 1,946 off-main, in 134 components;
  - 36 unsnapped.

  All of them are reviewed (see the census note below).
- **Path quality (G10/G10b):** path length ÷ straight line has median 1.032 and p90 1.076/1.094.
  All 300 of 300 sampled pairs are reachable.

## Gates

G1-G15 pass. G7 and G7a pass with reviewed exceptions:
- Dustwind and the Burning Blade hilltop;
- the Ban'ethil Barrow Den lower chamber.

G13 (dist audit) was tested on a tampered `dist/`. It refused:
- a `local-maps/` file;
- an image outside the art allowlist;
- a raw client file inside `nav/`;
- a modified art image.

## Findings and resolutions

| ID | Finding | Resolution |
|---|---|---|
| V-1 | The dist audit's nav baselines were still the prototype's | Re-recorded from the committed build |
| V-2 | Raw client files were only caught as BLP, M2 and DB2 | The audit also refuses ADT, WDT, WDL, WMO, skin and anim by extension and by content under any name; test added |
| V-3 | README said no Blizzard map art is deployed | Rewritten with the D-033 notice and rules |
| V-4 | The owner's in-game checks (D-034 item 5) were not tracked in STATUS | Table added to STATUS |
| V-5 | TrinityCore was read for movement rules but not recorded | Added under "Consulted but not included" in THIRD_PARTY_NOTICES |
| V-6 | The design doc quoted prototype sizes, census and seam figures | §0, §14.3 and §16 updated with the measured values |
| B-1 | Gnarlpine Hold (RC-02) was cut off from the main mesh | It is the Ban'ethil Barrow Den's lower chamber. The den's own ramp overhang leaves too little clearance. Every setting that joins it costs +41% or walks under furniture everywhere, so it is a reviewed `mesh-break-suspected` exception pending the owner's walk |
| B-2 | The prototype's WMO liquid rule treated type 15 as lava (risk U14) | Fixed. Kalimdor gained 168 polygons; sizes and the census were re-measured |
| B-3 | The prototype's coastline tracer kept only about half the coast | The port traces the full coastline in 1,792 arcs (61 kB) |

## Open items (tracked in STATUS)

- **Census entries:** 283 of the 298 census review entries are rule-drafted geometry notes, not
  individual reviews. The architect accepted this for the MVP, and the owner can override it.
- **In-game connectors:** the owner has not yet recorded the Thunder Bluff and Undercity elevators
  or the Rut'theran portal (D-031, D-034).
- **Unverified passages:** the Undercity tunnel, the Ironforge summit and the Ban'ethil ramp are
  unverified. Legs through them carry the `unverified-passage` flag.
- **About dialog:** it still says no map art is included. The D-033 notice lands with the map layers
  in part 2.
- **RC-07:** a realistic route section takes 3.03 s (116 points, 60.9 MB heap). The proposed 16 s
  ceiling is adopted in ARCHITECTURE §14 with part 2.
- **Suggestion:** move `gzipSize` out of `tools/build/lib/audit.ts`, so that audit changes stop
  invalidating the terrain byproducts' provenance hash.

## Evidence boundary

- **Client-backed gates:** these need the installed client and stay manual until CI (Milestone 9).
  CI can run only the offline checks: `nav:validate` without `--client`, `maps:validate` and the
  dist audit.
- **Walkability:** walkability comes from collision geometry and Recast settings, not from in-game
  observation. Where it has not been checked in game, the app says so.
