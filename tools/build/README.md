# tools/build

The build gates and the release-pack commands. Every rule is a function of paths and bytes, so the
tests run it on temporary trees. None of these commands publishes or uploads anything.

| Command | What it does |
|---|---|
| `pnpm build` | `vite build`, then `licence-gate.ts`, `third-party-notices.ts` and `audit-dist.ts --strip-manifest` (the plain audit) |
| `pnpm build:deploy` | The Pages deploy build: `minimap-fetch.ts`, then the same steps with `audit-dist.ts --strip-manifest --deploy` |
| `pnpm licence:check` | `licence-gate.ts`: shipped dependencies against the SPDX allowlist |
| `pnpm maps:minimap:fetch` | `minimap-fetch.ts`: the minimap tiles from their release pack |
| `pnpm maps:minimap:pack` | `minimap-pack.ts`: the release pack assembled from built tiles |
| `pnpm rxp:overlap` | `rxp-overlap.ts`: the RXP fixture overlap gate (D-019) |

## The dist audit (`audit-dist.ts`, `lib/audit.ts`, `dist-requirements.json`)

The audit checks `dist/` after `vite build`: the required files, no forbidden paths or contents, the
image allowlist, the entry-chunk budget, and a budget per data and map folder. A map folder's images
may ship only with its `NOTICE.md` and a `manifest.json` that lists each file with its SHA-256; once
`<source>/manifest.json` exists in the repository, the folder must ship.

A map folder with an `external` prefix gets its files there from a release-asset pack, not from git.
Today that is only the minimap tiles (`maps/minimap/t/`, D-049 O14; docs/research/map-atlas.md
§23.4, §24.3). The audit has two modes for it:

- **plain** (`pnpm build`, so `pnpm check`): with none of the pack's files in `dist/`, the audit
  passes, checks the folder's budget from the manifest's per-level records, and prints a loud
  warning, last and on stderr. With every file present they are checked as usual. A partial set
  fails.
- **deploy** (`--deploy`, `pnpm build:deploy`): every file the manifest lists must be present with
  its SHA-256.

In both modes the pointer (`pack.json`) must ship and its tree hash must be the tree hash of the
files the manifest lists under the prefix. The painted `atlas` and `art` folders have no pack and
are checked the same way in both modes.

The minimap budget (D-049): 60 MB gzip-6 for the folder, 32 kB per tile, each level's tiles within
their baseline + 10 %, and `index.json`, `manifest.json`, `NOTICE.md` and `pack.json` within their
own baselines + 10 % (the baselines are gzip-6 as `tools/maps/minimap.ts` wrote them).

## The minimap tile pack (`minimap-fetch.ts`, `minimap-pack.ts`, `lib/pack.ts`)

The pack is `minimap-tiles-<tree hash, 12 hex>-<pack SHA-256, 12 hex>.tar`, an uncompressed tar of
`NOTICE.md`, `manifest.json` and `t/`, in that order (its format is `tools/maps/lib/minimap-pack.ts`'s),
attached to the release tagged `minimap-<client version>-<tree hash, 12 hex>-<pack SHA-256, 12 hex>`.
The name carries the pack's own SHA-256, so two packs with different bytes (the same tiles with another
manifest) never share a name or a tag, and a published release is never replaced. The committed
`public/maps/minimap/pack.json` names it and pins it by SHA-256 and tree hash; `readCommittedPack`,
`maps:validate` M7 and the dist audit apply the same name rules (`pointerNameProblems`).

- `pnpm maps:minimap:fetch` reads the pointer, obtains the pack (from `--from` or
  `MINIMAP_PACK_SOURCE`: a path, a `file:`, `https:` or `http:` URL, or `gh`; otherwise from
  `.cache/minimap-pack/` when that copy has the pinned SHA-256; otherwise from the GitHub release's
  public download address, which sends no token),
  verifies its size and SHA-256, that `NOTICE.md` and `manifest.json` come first and equal the
  committed ones, and that it holds exactly the manifest's tiles in path order with their sizes and
  SHA-256, and only then installs the tiles under `public/maps/minimap/t/`. Without a committed
  minimap folder (never built, or removed on request) there is nothing to fetch, and it succeeds.
  **A private repository** (or a release not yet public) needs `MINIMAP_PACK_SOURCE=gh` with a
  signed-in GitHub CLI; in the Pages workflow (Milestone 9) that is `GH_TOKEN` set to the workflow's
  token, because the default download is unauthenticated.
- `pnpm maps:minimap:pack` assembles the pack from the tiles in `public/maps/minimap/t/` (every
  tile present and matching the manifest, nothing unlisted) and refuses unless it is byte for byte the
  pack `pack.json` pins. It writes `.cache/minimap-pack/<asset>` and prints the command with which the
  owner can publish it, with the NOTICE as the release text, once OD-13 allows it.

The removal steps if Blizzard asks are in docs/research/map-atlas.md §23.3 and THIRD_PARTY_NOTICES.md
("Minimap tiles").
