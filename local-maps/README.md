# local-maps

Local map sets built by `tools/maps` from your own client or the CDN (see docs/MAPS.md §5).
Everything except this README is gitignored. Vite serves this folder at `<base>local-maps/`
only in `dev` and `preview` (`tools/maps/vite-local-maps.ts`); `vite build` never includes it,
and the dist audit fails any build that does (D-018).

One set at a time:

```
maps.manifest.json     written only by `pnpm tsx tools/maps/validate.ts --activate`; its presence activates the set
geometry.local.json    rows with source "local-db2"
art/<uiMapId>.png      or .webp: one still image per UiMap, its LayerWidth × LayerHeight (1002 × 668;
                       512 × 512 for 1463, 1464, 2665), for a UiMap with a single full-rectangle row
taxi.local.json        optional: local taxi-derived leg times
```

Extraction from the client (`import.ts --build`, `convert.ts`) is Milestone 3b. Until then art can
only be placed by hand (docs/MAPS.md §5.4 (c)). After any change here, run
`pnpm tsx tools/maps/validate.ts --activate` again: the app checks every file against the
manifest's SHA-256 (the geometry at load, each image when it is first drawn) and ignores what
changed. `pnpm tsx tools/maps/validate.ts --local` reports what differs (check L8).
