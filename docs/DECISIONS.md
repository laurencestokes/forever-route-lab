# Decisions

Architecture decision log. Each entry records what was decided, why, and what it rules out.
Newest last. An entry is changed only by adding a later entry that supersedes it.

## D-001: Licence the repository GPL-3.0-or-later

- **Date:** 2026-09-25
- **Decided by:** project owner
- **Context:** The quest, NPC and object data come from QuestieDB, which derives from Questie.
  The project brief describes QuestieDB as GPLv3, and Questie has historically been published as
  GPL-3.0. On 2026-09-25, however, neither `Questie/QuestieDB` nor `Questie/Questie` published a
  licence file (GitHub API `license: null`; `LICENSE` returns 404).
- **Decision:** The whole repository is GPL-3.0-or-later. Questie-derived data is treated as
  GPL-3.0 regardless of the missing upstream file.
- **Why:** It is the most conservative choice for a static site that ships Questie-derived
  data alongside the application code, and it keeps the combined work compatible with the
  licence the upstream data has historically carried. This is a compliance posture, not a legal
  conclusion; see [DATA_PROVENANCE.md](DATA_PROVENANCE.md).

## D-002: Commit the full generated Forever dataset

- **Date:** 2026-09-25
- **Decided by:** project owner
- **Decision:** The compact generated dataset under `public/data/` is committed, so the static
  site deploys straight from the repository. It carries a source manifest (upstream repository,
  commit SHA, extraction timestamp, flavour, build, tool version) and GPL notices, and it is
  regenerated only by the reproducible extraction tool, never edited by hand.
- **Rules out:** manually copying Lua tables; committing raw upstream Lua files.

## D-003: Package manager is pnpm

- **Date:** 2026-09-25
- **Decision:** pnpm 10.33.0 is available on the development machine, so the project uses pnpm
  with a committed lockfile.
