# tools/questiedb

Builds the Forever dataset in `public/data/` (and the test fixture slice in `tests/fixtures/data/`)
from [Questie/QuestieDB](https://github.com/Questie/QuestieDB) at the commit pinned in
`upstream.json`. The contract is [docs/DATA_PROVENANCE.md](../../docs/DATA_PROVENANCE.md) (§4
inputs, §5 pipeline, §6 shipped fields, §7 marking, §8 manifest, §9 provenance); this file is the
operator's guide.

No Lua runtime is involved (D-009): luaparse (MIT, dev dependency) parses the Lua, and a whitelisted
evaluator (`lib/evaluator.ts`) runs exactly the constructs QuestieDB's Forever inputs use and throws
on anything else.

## Commands

| Command | Does |
| --- | --- |
| `pnpm data:fetch` | Ensures `.cache/questiedb` has the pinned commit and verifies every input's LF blob SHA-256 against `upstream.json` and `conversion.json`'s recorded output/source hashes. A new clone is a shallow fetch of the pinned commit alone (`--depth 1`, every blob of that commit, `core.autocrlf=false`; not a partial clone). An existing partial clone gets its missing input blobs in one batched request. It prints whether the network was used; an existing clone with everything present needs none |
| `pnpm data:extract` | Extracts `public/data/**` and `tests/fixtures/data/**` and writes the gitignored report `generated/questiedb-report.json`. `--check` compares a fresh extraction with the committed bytes instead, and fails on any stray file in either directory (the reproducibility gate); `--slice` writes only the fixture; `--out`/`--slice-out` write elsewhere |
| `pnpm data:validate` | Checks `public/data` and the fixture slice (below). Needs no clone, and runs in `pnpm check`. `--skip-tool-tree` skips the tool-tree comparison for local work; CI never skips it |
| `pnpm data:check` | fetch, `extract --check`, validate: the full data gate (needs the clone, so the network on first use) |
| `pnpm data:diff --from <src> [--to <src>]` | Pin-to-pin diff; a source is a data directory, a `manifest.json` (hashes and counts only) or `git:<rev>` (this repository's `public/data` at that revision; an unknown revision is an error, a file absent at a known revision is reported as absent). `--json <file>` writes the full diff |
| `pnpm data:all` | fetch, extract, validate |

Inputs are always read as committed blobs of the pinned commit (`git cat-file --batch`), never from
a working tree: on Windows with `core.autocrlf=true` the working files are CRLF and hash
differently. Only `fetch.ts` may reach the network. Extraction sets `GIT_NO_LAZY_FETCH=1`, which git
knows from 2.45; with an older git and a partial clone, it first checks that every input blob is
present with a listing that cannot fetch (`cat-file --batch-all-objects`) and refuses otherwise.

**What `validate` proves, and what it does not.** `validate` proves that a directory is internally
consistent: every file matches the manifest's hashes, the manifest matches `upstream.json`, and the
records pass the checks below. It cannot tell a hand edit whose hashes were recomputed from real
output; only `pnpm data:extract --check` (with the clone) proves the files equal a fresh extraction.
`pnpm test` validates `public/data` and the slice with no clone (`validate.test.ts`), and runs the
end-to-end extraction when the clone exists (`extract.test.ts`); without the clone that test says so
loudly, and with the environment variable `CI` set it fails.

**Tool identity.** `toolTreeHash.tree` is git's tree id of `tools/questiedb/` as a commit of the
working files would record it: from git in a checkout, or computed in-process (`lib/git-tree.ts`:
`.gitignore`, `.gitattributes` text handling, LF normalisation, blob and tree hashing) in a copy
without `.git`, such as a source archive. `toolTreeHash.lockfile` hashes only the lockfile entries the
tool runs with (`luaparse`, `tsx`, `zod`: importer specifier and version, `packages:` and `snapshots:`
entries), so an unrelated dependency change does not invalidate the dataset. The Node version is not
in the manifest (it does not change the bytes); the report records it.

## Pipeline

`lib/pipeline.ts` runs everything in memory; the CLIs only read and write files.

1. **Plan** (`lib/plan.ts`): the providers, order and merge options, derived from upstream's own
   tables (`config.lua` `flavors`/`ownedCorrections`/`enumFiles`, `manifest.lua`, `registry.lua`
   `loadOrder`) with a transcription of `correctionApplies`, `FromManifest` and `Select`, then
   compared with the plan the tool was reviewed for (`EXPECTED_PLANS`). A change fails closed.
2. **Compose** (`lib/compose.ts`) Forever, and the Era fork base the same way: enum constants, schema
   meta, raw rows (`lib/entities.ts`; key enums checked against `src/meta`), static corrections with
   `MergeInto` semantics (`lib/corrections.ts`: whole-field replace, absent ids created, `{}` stored
   as the delete idiom, `noNewEntries`/`noOverwrites`, a last-writer log), then the
   `requiredRaces:questieCompatibility` pass (`lib/derived.ts`).
3. **Dynamic layers** (`lib/overlays.ts`): every `LoadFactionFixes`/`LoadDynamic` provider for each
   faction × class persona (nine Era class tokens), composed as `recompose` does; per faction the
   class-invariant values form the faction layer, the rest a class layer under that faction.
4. **Project** (`lib/project.ts`, `lib/objectives.ts`, `lib/points.ts`) every composed record to the
   shipped shapes (`lib/shapes.ts`), tag provenance (`lib/provenance.ts`), select the shipped
   entities (`lib/select.ts`), build zones (`lib/zones.ts`) and overlays (`lib/dataset.ts`).
5. **Render** deterministically (`lib/json.ts`, `lib/render.ts`), write `NOTICE.md`
   (`lib/notice.ts`) and the manifest last (`lib/manifest.ts`); cut the fixture slice
   (`lib/slice.ts`) from the full dataset.

## What validate checks

Every file present and no other; UTF-8, LF, final newline, no BOM; no absolute paths or `.cache`
references; every JSON file an object whose first key is `_generated` naming the pin; zod schemas
(`lib/schema.ts`) for every file, with no single id shipped as 0; manifest outputs, per-file SHA-256
and bytes, the recomputed `dataRevision`, the pin and every input checksum against `upstream.json`,
`toolTreeHash` against the checkout; the transcription references (below); NOTICE.md content;
golden raw/composed counts (and, for `public/data`, the recorded shipped counts); ascending unique
ids; referential integrity (every entity a quest, item, spawn or overlay names ships, overlay item
drops included; for `public/data` also every quest an entity names); coordinates in 0-100 or the
exact `[-1, -1]` sentinel, overlay spawns, event and hint points included; no drawable point keyed by
a routed subzone; every presence key resolvable through `instanceAreas`; zone link consistency
(direct links are the UiMap's own AreaId, routed ones are not) and the expected UiMap names
(`lib/expected-zone-names.ts`); `frameVerified` false exactly for the audit's unverified entrances;
every dungeons.lua key classified and `dungeonQuest` recomputed from both factions; provenance
invariants.

## Transcribed upstream behaviour

Some upstream files are not run but transcribed by hand into TypeScript: the provider plan and
wrap of `register.lua`, `registry.lua` merge and ordering, `config.correctionApplies`, the
`requiredRaces` pass and its registration, `normalize.lua`'s coordinate and nil rules, the support
and correction environments, and the three frame-unverified entrances of QuestieDB's coordinate
audit. Each is a pinned input (`role: "semantics"` when nothing else is read from it), and the
transcribing module names the blob hash it was written against (`TRANSCRIBES`, collected in
`lib/semantics.ts`). A pin bump that changes one fails the extraction and `validate` until the
transcription is reviewed and the reference updated.

## Self-authored lists

Reviewed by hand at every pin bump, each failing closed when upstream moves: the expected UiMap
names (`lib/expected-zone-names.ts`), the dungeon classification for `dungeonQuest`
(`lib/dungeon-areas.ts`: every dungeons.lua key must be in `DUNGEON_KEYS` or `NON_DUNGEON_KEYS`),
the frame-unverified entrances (`FRAME_UNVERIFIED_ENTRANCES` in `lib/zones.ts`), the class tokens
(`CLASS_TOKENS` in `lib/overlays.ts`) and the reviewed correction plan (`EXPECTED_PLANS` in
`lib/plan.ts`).

## Optional manual parity check

Field-level parity with QuestieDB's own Lua generation is **not** a `validate` check (ARCHITECTURE
§5.2). To run it by hand: build a Baked artifact upstream (`lua5.1 generate.lua Forever` in a clone
at the pin, with an owner-approved Lua 5.1), or download the `QuestieDB-Forever.zip` release asset and
verify it against `release.json`; decode the entity rows of that artifact; and compare them field by
field with the composed rows this tool builds (`compose()` in `lib/compose.ts`, before projection).
Record the result as a review note; it never changes `public/data/` or the manifest.

## Changing the tool or the pin

- Every change under `tools/questiedb/` (tests and this README included) changes `toolTreeHash`, so
  it lands in the same commit as the regenerated `public/data/**` and fixture: run
  `pnpm data:extract`, then `pnpm data:validate`.
- A pin bump follows DATA_PROVENANCE §12: `pnpm data:fetch --commit <sha>` prints the new input
  hashes for `upstream.json`; review the upstream changes; update `upstream.json` (and `golden` if
  upstream's counts changed, and `licenceCheck` after repeating the licence check); update the
  `TRANSCRIBES` reference of any transcribed file that changed, after reviewing its transcription;
  extract; validate; `pnpm data:diff --from git:HEAD` for the commit message.
- The evaluator fails closed: a new construct in an upstream file stops extraction with the file and
  line. Extend the whitelist deliberately, with a test.
