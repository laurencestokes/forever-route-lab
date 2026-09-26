# generated

`questiedb-report.json` (written by `tools/questiedb`) is the non-shipped extraction report:
counts, coverage, lint, timings and extraction time, keyed by the dataset `dataRevision`. It is
gitignored because it changes on every run. The shipped, authoritative manifest is
`public/data/manifest.json` (docs/DATA_PROVENANCE.md §8).

`maps-art-report.json` (written by `tools/maps/convert.ts`) and `terrain-report.json` (written by
`tools/terrain/byproducts.ts`) are the non-shipped reports of the map art and the terrain
byproducts: the full per-file (FileDataID, CKey) input lists, compose statistics, sizes and
timings. They are gitignored too; the shipped manifests are `public/maps/art/manifest.json` and
`public/maps/terrain/manifest.json`.
