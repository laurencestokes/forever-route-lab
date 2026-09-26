# RXP custom guides: behavioural specification for import, lowering and export

- **Status:** Milestone 0 research, revised on 2026-09-25 to match ARCHITECTURE.md revision 2,
  DECISIONS D-016 to D-026 and the domain types in `src/domain/*.ts` (points.ts, route.ts,
  conditions.ts, project.ts), which are authoritative where this document and they differ. A
  second pass the same day applied the architect's rulings on the Milestone 0 consistency check
  (any-of turn-ins, exact `.xp` offsets, the world-form UiMapID, `Location.radius`,
  `SourceLineRef`, `RxpDiagnostic`). Implemented in Milestone 5 as `src/rxp` (import, lowering,
  canonical form and export); a third pass on 2026-09-26 recorded the implementation's choices
  (sections 12.2-12.6 and 13.4-13.6) and applied the behaviour corrections of the Milestone 5 RXP
  review (sections 3.3, 4 P7, 6.2, 9.4, 9.7, 10.4, 12.3). Where the code and this document
  differ, this document is the specification and the code is fixed.
- **What this is:** the behavioural specification that D-019 requires. `src/rxp` (ARCHITECTURE
  §10) is built from this document and the self-authored fixtures in
  [docs/research/rxp-samples/](research/rxp-samples/).
- **Implementer rule (D-019):** implementers of `src/rxp` work only from this document and those
  fixtures. They do not open the RXPGuides source, whether a local clone, GitHub or an installed
  addon. A question this document does not answer is answered by updating this document. The
  Milestone 5 parser review checks that `src/rxp` is not a structural translation of RXPGuides
  code.
- **How it was written:** after reading the RXPGuides addon source, RestedXP's published
  documentation and RestedXP's own Forever guides (statistics only). Evidence order: (1) behaviour
  observed in the addon source, (2) the published documentation, (3) usage in the Forever guides.
  Where (1) and (2) disagree, [section 16](#16-documentation-versus-code-discrepancies) lists it
  and we follow (1). Everything is written in our own words and our own notation; no RXPGuides
  code, guide line or data value is reproduced (D-019).
- **Licence posture:** RXPGuides declares CC BY-NC-SA 4.0 (`LICENSE:1`). The owner's posture is
  not to combine RXPGuides material with this GPL-3.0-or-later repository: interoperability
  vocabulary is allowed; code, guide text and data values are not (D-019, D-024). This is not a
  legal conclusion.
- **Flavour labelling:** "Forever" means WoW Forever (addon game id `FOREVER`, see section 15).
  "Classic/Era" means WoW Classic Era (`CLASSIC`). Behaviour that the addon applies to only one
  of them is marked.
- **UNVERIFIED** = seen in code or data, not confirmed in a running Forever client.
  **UNKNOWN** = no available source answers it. **Superseded by D-0nn / ARCH §n** marks a
  recommendation of the first revision that a later decision replaced; its evidence is kept.

Citations like `GuideLoader.lua:873` are evidence for reviewers of this specification, not
instructions for implementers. They are paths inside an RXPGuides clone at commit
`c3429e065c06271827e9e412306fb1cede5ae852` (2026-09-25 05:06 +0200, "Skyborne: Add warning to skip
deathskips for now on beta") unless another repository is named. A spec reviewer re-creates the
clone in the gitignored `<repo>/.cache/rxpguides` with
`git clone https://github.com/RestedXP/RXPGuides .cache/rxpguides` followed by
`git -C .cache/rxpguides checkout c3429e065c06271827e9e412306fb1cede5ae852`.

## Contents

1. [Summary](#1-summary)
2. [Sources and licences](#2-sources-and-licences)
3. [Input forms](#3-input-forms)
4. [Behaviour of the addon's guide loader](#4-behaviour-of-the-addons-guide-loader)
5. [Line grammar (EBNF)](#5-line-grammar-ebnf)
6. [Filter expressions (`<<`)](#6-filter-expressions-)
7. [Guide header tags](#7-guide-header-tags)
8. [Step tags and load-time step filters](#8-step-tags-and-load-time-step-filters)
9. [Command reference](#9-command-reference)
10. [`.goto` and the other location commands](#10-goto-and-the-other-location-commands)
11. [Edge cases and diagnostics](#11-edge-cases-and-diagnostics)
12. [Lowering to the route model](#12-lowering-to-the-route-model)
13. [Export and serialization](#13-export-and-serialization)
14. [Runtime semantics: RXP and our engine](#14-runtime-semantics-rxp-and-our-engine)
15. [Forever-specific findings](#15-forever-specific-findings)
16. [Documentation versus code discrepancies](#16-documentation-versus-code-discrepancies)
17. [First-revision recommendations and their status](#17-first-revision-recommendations-and-their-status)
18. [Open questions](#18-open-questions)
19. [Fixtures](#19-fixtures)

---

## 1. Summary

| # | Finding | Source |
|---|---|---|
| S1 | **RXPGuides declares CC BY-NC-SA 4.0**. The owner's posture (D-019, D-024) is not to combine its material with this GPL-3.0-or-later repository: no RXPGuides code, guide lines or text, and no data values (zone, flight, dungeon or area tables, flight times, constants fitted to them). Interoperability vocabulary (command, tag and filter words, `.dungeon` tokens, pseudo-zone names) is allowed and is listed here in our own words and order. This is not a legal conclusion. | `.cache/rxpguides/LICENSE:1` |
| S2 | RXP has **no formal grammar**. The loader applies a fixed sequence of text substitutions and matches to each line (section 4). The grammar in section 5 is our own description of the resulting classification. | `GuideLoader.lua:859-969`, `972-1192` |
| S3 | `--` **anywhere** on a line starts a comment. That includes `>>` text and URLs. `.link` URLs use `\-` to write a `-`. | `GuideLoader.lua:988`, `1016`; `functions.lua:4753-4766` |
| S4 | A line is split in this order: filter (`<<` to end of line), then step tag (`#`), then text (`>>` to end), then command (`.name args`), then `+`/`*` prefixes. So **`>>text` must come before `<< filter`**. The other order silently deletes the line for everyone. | `GuideLoader.lua:873-948` |
| S5 | RXP evaluates filters **at parse time** against the logged-in character and caches the result per filter string for the whole UI session. We keep filters as ASTs; the engine evaluates them per project (level words at the route's start level; unresolvable words are `unknown`, and the step stays active with a warning) (ARCH §9.2, section 6.5). | `GuideLoader.lua:34`, `36-103`, `877` |
| S6 | Arguments are split on `,` (on `;` for `.mob`, `.target`, `.unitscan`; the whole rest of the line for `.link`, `.clicknext`, `.setquestdb`). **Empty fields are dropped**, so `a,,b` means `a,b`. | `GuideLoader.lua:903-910`; `functions.lua:4739-4744`, `4870-4878`; `DB/questDB.lua:1146-1148` |
| S7 | 176 names are registered as dot-commands (a few are really callbacks). RestedXP's 58 Forever guides use 59 of them, and **no unknown command**. About 85% of their non-blank lines (57,075 of 66,760) are `step` lines, `#` tags, `>>` notes or one of `.goto .target .accept .turnin .mob .complete .collect .train .xp`. | `functions.lua`, `DB/questDB.lua`, `DB/forever/db.lua`; count over `Guides/Forever/*.lua` (section 9.0) |
| S8 | **82% of `.goto` lines in RXP's Forever guides (11,655 of 14,180) use world coordinates**: `UiMapID/instance,a,b`, where `(a, b)` are HereBeDragons world coordinates in yards, which is Blizzard `(Y, X)` order. Our own example, computed from QuestieDB and client geometry rather than taken from a guide: Gornek is `.goto 1411/1,-4186.42,-600.30`. A route `Location` keeps the point as authored and derives world coordinates at runtime (D-017; section 10.4). | `functions.lua:1875-1896`; `libs/HereBeDragons/HereBeDragons-2.0.lua:410-459`, `580`; docs/research/coordinates.md §7, §13.3; counts in section 10.2 |
| S9 | Zone names in commands are **English keys** looked up in a per-game table, or numeric UiMapIDs. Localised guides (zhCN) keep English zone keys and translate only `>>` text; RXP rejects localised zone names. Our key table comes from QuestieDB `uiMapIdToAreaId.lua` row comments (validated) plus self-authored pseudo-zone keys (section 10.3); RXP's own table is not used. | `map.lua:1487-1531`; `DB/forever/db.lua:45-96`; `lang/Guides-zhCN/Classic-0.5.lua` |
| S10 | The addon detects Forever as Interface 16000-19999 (game id `FOREVER`; toc game type `camelot`). A guide loads on Forever if its header has `#forever`, or (only for guides parsed through the import/parse path) `#classic`. Filter token `Classic` is **false** on Forever even though the `#classic` header is accepted. | `RXPGuides.lua:190-193`; `RXPGuides.toc:1,46,66`; `GuideLoader.lua:569-575`, `1052-1059`, `78-79` |
| S11 | 293 of the 1,035 quest IDs used by RXP's Forever guides (all IDs ≥ 76,000, including the new Skyborne quests on Zephras Isle, UiMap 2521) are **absent from QuestieDB's Forever quest DB** at b6f5b07. Unknown quest IDs are warnings, not parse errors (ARCH §9.4); the user can make them custom quests that keep their real IDs (ARCH §5.5). | section 15.4 |
| S12 | Commercial RestedXP guides are delivered as **account-bound, encrypted import strings**. We detect and refuse them. We do not decode them. | `GuideLoader.lua:274-358`, `1318-1345`, `1411-1479`; <https://community.restedxp.com/start/> |
| S13 | Each RXP step lowers to one `RouteGroup` (tags, group condition, waypoints, annotations, fingerprint) plus atomic steps (ARCH §8.1, D-020). An unedited import exports byte-identical to its source; edited groups export in canonical form (sections 12 and 13). | ARCH §8.1, §10 |

---

## 2. Sources and licences

| Source | What it is | Version used | Licence | How used here |
|---|---|---|---|---|
| RXPGuides addon, <https://github.com/RestedXP/RXPGuides> | The in-game addon: loader, command registry, runtime, and RestedXP's own free guides (including `Guides/Forever/`). | `c3429e0…`, 2026-09-25, clone in `<repo>/.cache/rxpguides` | Declares **CC BY-NC-SA 4.0** (`LICENSE:1`) | Read to write this behavioural spec. Behaviour described in our own words, with citations. No code, guide text or data value copied (D-019). Statistics computed over its Forever guides. |
| RestedXP "Custom Guides" page, <https://community.restedxp.com/custom-guides/> | Official command and syntax tables ("Text Tutor", ".xp Expert", "Quest Coach", "Misc Mentor", "Inventory Instructor", "NPC Conversation Counselor", "Header Hero"). | Read 2026-09-25 in the desktop browser pane. Plain HTTP fetches get **HTTP 403**. Footer "©2025 RXP MEDIA LLC". | All rights reserved (site) | Summarised and cited only. |
| RXP Documentation spreadsheet, linked as "View Documentation" from the page above: <https://docs.google.com/spreadsheets/d/1lbkJzhOq6VgE535J9-e7Wm2RGJQBJJLisoNFoYyAOeE/> (tab gid 2110791261) | Same tables plus a ".goto Guru" table (goto radius variants, `.line`, `.loop`, `.groundgoto`) and "Exp Rate Headers" (`#xprate`). | Read 2026-09-25 (htmlview) | Not stated | Summarised and cited only. |
| RestedXP "Getting Started" page, <https://community.restedxp.com/start/> | Says purchased guides are bound to the buyer's Battle.net ID and imported as an exported string. | Read 2026-09-25 | All rights reserved | Evidence for the protected format (section 3.3). |
| Custom-guide template zip, `https://community.restedxp.com/wp-content/uploads/2025/08/RXPGuides_Template.zip` | Linked as "Download Template". | **Not downloaded** (no permission was asked for a file download). | Unknown | Not used. |
| RXPGuides_Template (community), <https://github.com/medicrxp/RXPGuides_Template> | A third-party custom-guide addon (WotLK achievements). Shows the addon wrapper: `.toc` with `## Dependencies: RXPGuides`, one `RXPGuides.RegisterGuide([[…]])` per file. | `e2a02df…`, 2023-02-10, clone in `<repo>/.cache/rxpguides-template` | **No licence file** | Only used to confirm the wrapper shape. Nothing copied. |
| QuestieDB, <https://github.com/Questie/QuestieDB> | Quest, NPC and item IDs, UiMapID↔AreaID table and zone names. | `b6f5b07…`, 2026-09-23, `<repo>/.cache/questiedb` | No licence file on its default branch at any point in its history (D-016). The owner publishes the derived dataset with prominent notices. This is not a legal conclusion. | IDs, names and coordinates in fixtures 01, 05 and 06; the zone-key table (section 10.3); section 15. |

Rules that follow from the posture (D-019, D-024):

1. **Forbidden** in `src/`, `public/`, `tests/` and the fixtures: RXPGuides code, guide lines or
   text, and data values: `DB/*` tables (for example `addon.mapId`, `FPDB`, `dungeonList`,
   `taxiPos`), zone, flight, dungeon or area tables, flight times, and constants fitted to any of
   them (D-024 withdrew a flight-time model fitted to RXP's flight table).
2. **Allowed:** interoperability vocabulary, listed in our own words and order: command names,
   tag names, filter words, `.dungeon` tokens and pseudo-zone names. Section 9 is that list.
3. **Zone keys** come from QuestieDB (section 10.3), never from RXP's table.
4. Users may paste their **own** guides, or RXP's free guides, into the static site at runtime.
   That is the user's material, processed in their browser. We do not ship RXP guides as
   examples.
5. All fixtures in `docs/research/rxp-samples/` are self-authored.
   `tools/build/rxp-overlap.ts` (ARCH §17, Milestone 5) checks them and `src/`, `public/`,
   `tests/` for lines equal to RXP guide lines (section 19.2).

---

## 3. Input forms

### 3.1 Raw guide text

The text that sits between the brackets of `RegisterGuide([[ … ]])`: optional header lines,
then `step` blocks. This is the primary input. A pasted file may contain several guides only in
the Lua-wrapped form (3.2). Raw text is one guide.

### 3.2 Lua-wrapped guides (addon files)

An RXP custom guide ships as a normal WoW addon: a `.toc` that depends on RXPGuides and `.lua`
files that call the global registration function (`RXPGuides.toc` loads the addon;
`GuideLoader.lua:1267-1272` exports `RXPGuides.RegisterGuide` and `RXPGuides.ImportGuide`;
`.cache/rxpguides-template/RXPGuides_Template.toc`).

| Call shape | Meaning | Source |
|---|---|---|
| `RXPGuides.RegisterGuide([[ text ]])` | One argument: the whole guide. Group comes from `#group` in the text. Used by all 58 Forever guides (all level-0 long brackets). | `GuideLoader.lua:416-432`, `985-1014` |
| `RXPGuides.RegisterGuide("Group", [[ text ]] [, "defaultFor"])` | Two/three arguments: first is the group name. **`#group` inside the text is then ignored** (the group is set before the header loop and header keys are first-wins). The third argument is a `#defaultfor` filter, used only when the text has no `#defaultfor`. | `GuideLoader.lua:1015-1026`, `1116`, `1136` |
| `RXPGuides.ImportGuide(text)` | Parses and caches a one-time guide (used by the in-game importer). | `GuideLoader.lua:393-414` |
| `RXPGuides.talents.RegisterGuide(...)` | **Talent guides**, a different format with its own parser. Out of scope. | `Talents.lua:364`, `1415` |

Static-extraction rules for our importer (never execute Lua):

1. Tokenise Lua enough to skip `--` line comments, `--[=*[ … ]=*]` block comments, and quoted
   and long-bracket strings, so that a `RegisterGuide(` inside a comment or string is not
   extracted.
2. For each `RXPGuides.RegisterGuide(` (whitespace allowed around `.` and before `(`), read up to
   three arguments. Each must be a string literal:
   - long bracket `[==[ … ]==]` (any level): content taken verbatim, **no escapes**; a newline
     immediately after the opening bracket is dropped (Lua rule). Reference Lua 5.1 (default
     `LUA_COMPAT_LSTR`) raises "nesting of [[...]] is deprecated" on `[[` inside a level-0 long
     string, so guide text that contains `[[` needs `[=[` (WoW's build flags: **UNVERIFIED**).
   - quoted `"…"` / `'…'`: decode Lua escapes (`\n`, `\t`, `\\`, `\"`, `\'`, `\ddd`, `\` + newline).
3. Any other argument (a variable, a `..` concatenation, a function call) makes the call
   **dynamic**: report `RXP020-lua-dynamic` and skip it.
4. Top-level code other than `RegisterGuide` calls (for example a guard that returns early for
   the wrong faction or locale) is ignored with the info diagnostic `RXP021-lua-guard-ignored`.
   Real Forever guide files begin with such guards (`Guides/Forever/Horde-01-12_Durotar.lua:1-4`).
5. Record for every extracted guide the Lua file line where its text starts, so diagnostics
   report file line numbers. Each extracted guide becomes one `RxpImport` whose `text` is the
   extracted (and, for quoted strings, unescaped) guide text. Recording the call form and its
   group and defaultFor arguments needs `options.lua`, which `RxpImport.options` does not have
   yet (proposed addition G4, section 12.2).

Fixture: `docs/research/rxp-samples/03-lua-wrapped.txt` (4 guides: level-0, level-2, two-arg
with defaultFor and extra whitespace, quoted; plus a call inside a block comment, which must not
be extracted, and a dynamic `prefix .. [[…]]` call, which must be reported and skipped). The
throwaway extractor in `.cache/experiments/rxp/classify.mjs` extracted exactly these 4 from the
first revision of the fixture, flagged the dynamic one, and extracted 58/58 guides from RXP's
Forever files.

### 3.3 Protected commercial guides (not supported, never bypassed)

RestedXP sells guides that are bound to the buyer's Battle.net account and delivered as an
exported string pasted into the in-game "Import guide" window
(<https://community.restedxp.com/start/>). In the addon, the string importer strips non-digits
from both ends, expects a guide count, a hash and a trailing version number separated by `|` and
`:`, then processes `%`-terminated base64 segments whose decoding depends on account-derived data
and fails with an account-mismatch error for any other account (`GuideLoader.lua:1411-1446`,
`1318-1345`, `274-358`).

Our rule: **detect and refuse.** Our own detection heuristics, as JavaScript regular
expressions, on the pasted input after trimming. Input that has a line whose content (after
leading spaces and tabs) starts with `#` or `step` is guide text and is never refused. Other
input is refused when

1. it matches `^[^\d\r\n]*\d+\|-?\d+:` (the count, `|`, the hash and `:` on the first line, with
   no line break before them), or
2. it contains runs of `-?\d+\D[A-Za-z0-9+/=]{16,}%`, or
3. it ends with `\|\d+\s*$`.

Then reply with `RXP019-protected-format`: "This looks like a RestedXP protected import string.
Those are licensed to one account and are not supported. Paste guide text or a custom-guide .lua
file instead." Do not attempt to decode, decrypt, inflate or fingerprint it. Do not log or store
it. The line conditions keep real guides from being refused: a header line such as
`#name 01|02: x` (below `#forever` or not), and a header-only text that ends with `#version 3|12`,
are guide text. A protected string is one line of digits, `|`, `:`, base64 and `%` and has no
such line. (The first revision anchored rule 1 at `^\D*`, which spans line breaks, applied it to
every input, and exempted only texts with a `step` line from rules 2 and 3; superseded.)

The addon also keeps an internal cache format (text prefixed by `--<digits>` and deflated,
`GuideLoader.lua:371-390`). Users never see it. We do not support it.

---

## 4. Behaviour of the addon's guide loader

What the addon does to the one-argument form, in order, described in our own words. Our parser
**reproduces the classification** but keeps everything that RXP throws away (comments, blank
lines, failed filters, stray text) in a lossless tree, and reports RXP's silent drops as
diagnostics.

| # | Stage | RXP behaviour | Source |
|---|---|---|---|
| P1 | Comment removal | Before anything else the whole text is scanned for `--`. Each `--`, the rest of its line and the line break that ends it are replaced by a single LF. In the one-argument form the whole run of consecutive CR/LF characters after the comment is consumed; in the two-argument form only one character. A `--` that has no line break after it (a comment on the last line of a text without a final newline) is **left in place**. Consequence: `--` inside `>>` text or a URL starts a comment. | `GuideLoader.lua:988`, `1016` |
| P2 | Conditional group | If no group was passed, `#group X << filter` lines are evaluated first; a failing one is blanked, the first passing one sets the group. No `#group` at all → "Invalid guide group" and the guide is **not loaded**. | `GuideLoader.lua:992-1013` |
| P3 | Line split | Lines are the maximal runs of characters other than CR and LF. So CRLF, LF and CR all separate lines, and **empty lines disappear**; RXP's own line counter counts non-empty lines only. | `GuideLoader.lua:1040-1041` |
| P4 | Trim | Leading and trailing whitespace (spaces and tabs) is removed. Indentation has no meaning. | `GuideLoader.lua:1042-1043` |
| P5 | Step start | A line whose **first four characters are `step`** starts a new step (a case-sensitive prefix test, so `stepwise…` also does and `Step` does not). `<<` + filter anywhere after it is the step filter. A failing step filter skips every line until the next step line. When a new step starts and the previous one has no elements, the previous one gets `hidewindow`. | `GuideLoader.lua:1045-1094` |
| P6 | Game/metadata gate | At the first step: if the header has any of `#classic #tbc #wotlk #df #retail #cata` but not the current game's tag (on Forever: `#forever` or `#classic` both pass), or `#name`/`#group` is missing, the guide is skipped. | `GuideLoader.lua:1049-1071` |
| P7 | Header lines (before the first step) | `code << filter`: if `code` is empty the filter becomes the guide's `enabledFor`, and the first such line wins for `enabledFor`. But RXP re-decides for **every** such line whether the guide is skipped for this character (the empty code counts as present), so the **last** `<< filter` header line decides whether the guide loads at all; `enabledFor` keeps the first. Otherwise (a non-empty `code`) a failing filter blanks the line. Then `#key value` or `#key = functionName` sets `guide[key]` **if not already set** (first wins). `#name` sets the guide name. **Every other header line is ignored**, including dot-commands. | `GuideLoader.lua:1100-1128` |
| P8a | Line filter | Inside a step, the filter starts at the first `<<` that has at least one character after it. That `<<`, the whitespace directly before and after it, and the rest of the line are cut off; the rest is the filter. If the filter is false the line is dropped. A `<<` at the very end of a line is not a filter and stays in the line. | `GuideLoader.lua:872-877` |
| P8b | Step tag | After the filter is cut, a line starting with `#` is a tag. The key is the run of non-space characters after `#`; then comes an optional `=` with optional whitespace around it; the value is the rest of the line. The first value stored for a key wins; keys are not validated. Nothing else on the line is interpreted (a `>>` stays part of the value). Because the key runs to the first whitespace, `#key=value` stores the key `key=value` with an empty value. | `GuideLoader.lua:879-891` |
| P8c | Text | Next, the text starts at the first `>>`: the `>>`, the whitespace around it and the rest of the line are cut off; the rest, if not empty, is the line's text. Later `>>` belong to the text. | `GuideLoader.lua:895-898` |
| P8d | Command | If what remains starts with `.`, the command name is the run of non-space characters after the dot and the arguments are everything after the whitespace that follows the name. A comma directly after the name is part of the name (`.collect,…` is an unknown command). The arguments are split by the command's separator (S6): by default the whitespace around each comma is removed and the rest is split on commas, dropping empty fields. The handler receives the original line, the text and the arguments, and returns an element or nothing. An unknown name prints an error to chat and produces no element. | `GuideLoader.lua:900-932` |
| P8e | Plain lines | If there is text but no element (including after a failed or unknown command): a **note** element. Else if the line starts with `+`: a manual **objective** (checkbox). Else if it starts with `*`: a note shown only in the step window, `\n` → newline. **Else the line is dropped silently.** So `+label >>text` is a plain note, not a checkbox. | `GuideLoader.lua:934-948` |
| P8f | Parent link | Elements that declare `parent` (for example `.goto` without radius, `.timer`, `.disablecheckbox`, `.mob +…`) are attached to the step's most recent objective: the most recent element of the same step that has text and is not text-only, or has dynamic text (such as `.complete`). | `GuideLoader.lua:864-869`, `917-919`, `949-951` |
| P9 | Finish | `#name` missing → hard error. `#defaultfor` (or the third argument) is applied. `#displayname` gets colour-token replacement. Names starting `D-D`/`D-DD` are zero-padded (`1-6 Durotar` → `01-06 Durotar`). Key = group, subgroup and name joined by pipe characters. `#version` → number (default 0). | `GuideLoader.lua:1134-1191`, `108-111`, `690-698` |
| P10 | Load time | When the guide is opened: steps failing the step-logic checks (xprate, season, hardcore, ah/ssf, phase, dungeon, …; section 8.2) are dropped; `#include` is expanded; labels are indexed; empty steps become `optional`; `#completewith` implies `sticky`; `#requires` on a sticky predecessor may add a `completewith`. | `GuideWindow.lua:1590-1726`, `1954-1976`; `RXPGuides.lua:2367-2600` |

Error reporting in RXP is non-fatal: errors print to chat and parsing continues
(`functions.lua:262-273`). Several `.goto` failures only print in debug mode
(`functions.lua:1885`, `1901`; `Communications.lua:430-433`), so a broken `.goto` usually
vanishes without any message.

---

## 5. Line grammar (EBNF)

This grammar describes what **our** parser accepts. It reproduces RXP's classification (section 4)
but is lossless. Notation: ISO-style EBNF; `ws` = space or tab; `eol` = `"\r\n" | "\n" | "\r"`;
`any` = any Unicode scalar except CR/LF.

```ebnf
(* ---------- document ---------- *)
document      = [ bom ] , { physical-line , eol } , [ physical-line ] ;
bom           = "\u{FEFF}" ;                         (* accepted, reported (RXP026) *)
physical-line = { ws } , [ content ] , { ws } , [ comment ] ;
comment       = "--" , { any } ;                     (* RXP: anywhere on the line (P1) *)

(* The first step-line splits the document into a header and steps.            *)
guide         = { header-line } , { step } ;
step          = step-line , { body-line } ;

(* ---------- classification, applied to content after comment removal and trim ---------- *)
header-line   = blank | enabled-for | tag-line | stray ;        (* commands here: RXP015 *)
body-line     = blank | tag-line | command-line | note-line | objective-line | star-line | stray ;
blank         = (* nothing left after trim *) ;

step-line     = "step" , { any } ;                   (* RXP: 4-char prefix; canonical: "step" [ filter-suffix ] *)
enabled-for   = "<<" , { ws } , filter ;             (* header only *)
tag-line      = "#" , tag-key , [ { ws } , "=" ] , { ws } , tag-value , [ filter-suffix ] ;
tag-key       = non-ws , { non-ws } ;                (* maximal, so it absorbs a directly following "=";
                                                        case-sensitive; includes "/" e.g. era/som *)
tag-value     = { any - "<<" } ;

command-line  = "." , command-name , [ ws , { ws } , args ] , [ text-suffix ] , [ filter-suffix ] ;
command-name  = non-ws , { non-ws } ;                (* case-sensitive; must be registered *)
args          = comma-args | semicolon-args | rest-arg ;
comma-args    = arg , { { ws } , "," , { ws } , arg } ;       (* default *)
semicolon-args= arg , { { ws } , ";" , { ws } , arg } ;       (* .mob .target .unitscan *)
rest-arg      = { any - ">>" - "<<" } ;                        (* .link .clicknext .setquestdb *)
arg           = { any - "," - ">>" - "<<" } ;                  (* empty args are dropped (S6) *)

note-line     = ">>" , { ws } , text , [ filter-suffix ] ;
objective-line= "+" , label , [ text-suffix ] , [ filter-suffix ] ;   (* manual checkbox, unless it has text *)
star-line     = "*" , label , [ filter-suffix ] ;                     (* window-only note, "\n" escapes *)
label         = { any - ">>" - "<<" } ;
text-suffix   = { ws } , ">>" , { ws } , text ;
text          = { any - "<<" } ;                     (* may contain later ">>"; never "<<" or "--" *)
filter-suffix = { ws } , "<<" , { ws } , filter ;    (* always the LAST part of a line *)
stray         = (* any other content; RXP drops it silently *) ;

(* ---------- filter expressions (section 6) ---------- *)
filter        = alternative , { "/" , alternative } ;          (* "/" = OR, lowest precedence *)
alternative   = term , { { ws } , term } ;                     (* juxtaposition = AND *)
term          = [ "!" ] , ( word | "(" , filter-flat , ")" ) ;  (* "!" = NOT, highest *)
filter-flat   = (* a filter with no parentheses; RXP does not nest parentheses *) ;
word          = alnum , { alnum } ;                            (* [A-Za-z0-9]; anything else separates words *)
```

Lexical priorities that the grammar cannot show by itself (evidence: `GuideLoader.lua:873-948`):

1. Comment removal happens before everything else, on the whole text.
2. The filter is the text after the **first** `<<` on the line. So text and args can never
   contain `<<`, and anything after the filter (for example a `>>` text) becomes part of the filter.
3. The text is the text after the **first** `>>` in what remains. Later `>>` belong to the text.
4. Only then is the command name/args split done.
5. Tag lines (`#`) are recognised after the filter is removed but **before** `>>` handling.

---

## 6. Filter expressions (`<<`)

### 6.1 Where filters can appear

| Position | Effect when the filter fails | Source |
|---|---|---|
| Header line that is only `<< filter` | The guide is disabled for this character (`enabledFor`). With several such lines, `enabledFor` is the first one, but the last one decides whether the guide loads (section 4 P7). | `GuideLoader.lua:1100-1106`, `576-581` |
| Header tag line, `#key value << filter` | That line is ignored (a later line with the same key may apply: first *applicable* wins). | `GuideLoader.lua:1107-1116`, `562-568` |
| `step << filter` | The whole step is skipped. | `GuideLoader.lua:1077-1080` |
| Any line inside a step (tag, command, note, `+`, `*`) | That line is dropped. | `GuideLoader.lua:873-877` |
| Values of `#defaultfor`, the `defaultFor` argument | Not a line filter: selects which guide is the default for this character. | `GuideLoader.lua:1136`, `1153-1168`, `595-599` |
| `#next` alternatives | Not a filter: `;`-separated guide names, the first *active* one is used. | `functions.lua:3846-3872` |

### 6.2 Evaluation rules

Behaviour of `applies()` (`GuideLoader.lua:36-103`), in our words:

1. **Parentheses.** Scanning left to right, a group runs from a `(` (optionally preceded directly
   by `!`) to the **first** `)` after it; whitespace just inside the parentheses is ignored. The
   group's content is evaluated as a filter of its own, and the group then acts as a single word
   that is true or false for this character; `!(…)` inverts it. Groups do not nest: in
   `((a/b) c)` the first group's content is `(a/b`, and the parenthesis characters left over act
   as word separators. RXP does this by replacing the group with a token made of word
   characters. So a group written **directly against** a letter or digit, as in `Orc(Warrior)`,
   `(Orc)Warrior` or `Orc!(Warrior)`, merges with those letters into one word, and that word
   never matches (RXP review, `GuideLoader.lua:43-52`). A `!` directly before the letters
   (`!Orc(Warrior)`) negates the merged word, which is then always true. Two groups written
   directly together (`(Orc)(Warrior)`) merge the same way, because both tokens are word
   characters (derived from the same behaviour; **UNVERIFIED** by a direct test).
2. **Alternatives.** The filter is split into alternatives at each `/`, and an **empty
   alternative** (no characters at all: two adjacent slashes, or a slash at the start or end of
   the filter or of a group's content) is **ignored** (RXP splits with a pattern that matches
   only non-empty runs, `GuideLoader.lua:50`). The filter is true if **any** remaining
   alternative is true. So `Orc/` and `/Orc` mean `Orc`, `Orc//Troll` means `Orc/Troll`, and a
   filter whose alternatives are all empty (`/`, or a group `(/)`) has none left and is
   **false**: RXP drops the line for everyone. The first revision said an empty alternative is
   true; superseded.
3. **Words.** In an alternative, every word must be true (AND). A word is a maximal run of ASCII
   letters and digits, optionally preceded **directly** by `!`. Every other character, including
   spaces, `-`, `'`, `_`, leftover parentheses and a second `<<`, only separates words. So
   `! Orc` is the positive word `Orc`, and an alternative that has characters but no words at
   all (such as ` - ` in `Orc/ - `) is true.
4. A word is true when it matches the character (vocabulary and case rules in 6.3); `!word` is
   true when `word` is false.
5. Results are **cached per filter string for the whole UI session** and never cleared
   (`GuideLoader.lua:34`, `94-100`). Level words therefore reflect the level at first use.

The published documentation says the same about operators: space = AND, `/` = OR, `!` = NOT,
priority `!` > space > `/` (<https://community.restedxp.com/custom-guides/>, "Text Tutor").

Our parser reproduces rules 1-3 exactly and reports nested or unbalanced parentheses, a `!`
separated from its word, an empty alternative, a filter with no alternative left, an alternative
without words, and a group written against a word with `RXP016-filter-quirk`.

How the `FilterAst` (src/domain/conditions.ts) represents these cases, so that the engine can
evaluate them and the serializer can write them back (13.4 rule 10):

| Filter | AST |
|---|---|
| empty alternatives | left out |
| no alternative left (`/`, `(/)`, `()`) | `{ kind: 'or', exprs: [] }`: false |
| an alternative without words (` - `) | `{ kind: 'and', exprs: [] }`: true |
| one alternative, one term | the term itself (not wrapped in `or` or `and`) |
| a merged word (`Orc(Warrior)`) | `{ kind: 'word', word }`, where `word` is the merged spelling with each group's content in canonical form (`Orc(Warrior/Mage)` for `Orc( Warrior / Mage )`); like every word outside the vocabulary it is false (6.5), and `!` in front gives `not` |

### 6.3 Word vocabulary

| Word | True when | Case rule | Notes |
|---|---|---|---|
| Class: `Warrior Paladin Hunter Rogue Priest Shaman Mage Warlock Druid` (and `DeathKnight`/`DK`, `Monk`, `DemonHunter`, `Evoker` on other games) | the upper-cased word equals the class file token (`WARRIOR`, …) | case-insensitive | `DK` → `DEATHKNIGHT` |
| Race token: `Human Orc Dwarf NightElf Scourge Tauren Gnome Troll …` | the word equals the race file token that the WoW API `UnitRace` returns | **case-sensitive** | `Undead` is rewritten to `Scourge`. `Night Elf` is two words → never true. Forever guides use `Skyborne` (13 times); the Skyborne race token itself is **UNVERIFIED** (local-context K5/K6: Skyborne come as two faction halves), so our engine evaluates race words for a Skyborne character as `unknown` (6.5). The project's own race keys for the two Skyborne halves (`src/domain`) are not RXP filter words: until Q1 is answered they are unknown words like any other (false, `RXP016`). |
| Faction: `Alliance`, `Horde` | equals the player's faction group | **case-sensitive** | Real guides contain the typo `Aliance` (always false). |
| Number `N` | player level ≥ N | — | `!N` = level < N. Load-time only (rule 5). RXP's number conversion also accepts words such as `1e1` (10) and `0x10` (16); we reproduce that and report `RXP016-filter-quirk`. |
| Game: `Classic`, `TBC`, `Wotlk`, `Cata`, `MoP`, `Retail`, `Forever`; `DF` → `RETAIL` | the upper-cased word equals the addon's game id | case-insensitive | On Forever only `Forever` is true. **`<< Classic` is false on Forever.** |
| `Male`, `Female` | the player's sex is 2 / 3 | case-insensitive | |
| `SoD` | season is 2 (then rewritten to the faction, so always true) | case-insensitive | Season on Forever: **UNKNOWN** (section 15.5). |
| Locale: `enUS deDE frFR esES esMX ruRU koKR zhCN zhTW ptBR itIT` | equals the client locale | case-sensitive | |
| `Haranir` | rewritten to another spelling, then compared as race | case-sensitive | Retail only. |
| Anything else (`skip`, `era`, `optional`, `NULL`, typos) | never | — | `step << skip` is the idiom to disable a step (the word `skip` occurs 232 times in Forever filters). |

A second `<<` on the same line does **not** start a second filter: `<< tbc << wotlk` is
`tbc AND wotlk` (never true). The documentation claims otherwise (section 16).

### 6.4 What the project must supply

The inputs map onto ProjectV1 (ARCH §8.2):

| RXP input | ProjectV1 field | Unknown when |
|---|---|---|
| faction | `character.faction` | never |
| race token | `character.race` | the race's client token is unverified (Skyborne, Q1) |
| class token | `character.class` | never |
| sex (2 male, 3 female) | `character.sex` | `null` |
| level at guide load | `character.startLevel` | never |
| locale | `routeProfile.locale` | never |
| game | constant `FOREVER` | never |
| season | `routeProfile.season` | `null` (section 15.5) |

### 6.5 How our engine evaluates filters (ARCH §9.2)

- `src/rxp` only produces the filter AST. `domain/conditions` evaluates it against the character
  and route profile; the serializer never evaluates filters.
- Evaluation is three-valued: `true`, `false`, `unknown`. AND is false if any term is false,
  else unknown if any term is unknown; OR is true if any alternative is true, else unknown if any
  is unknown; NOT keeps unknown. So an empty AND (an alternative without words) is true and an
  empty OR (no alternative left) is false, as in RXP (6.2).
- **Level words** use `character.startLevel`, the route's start level, as RXP does at guide load
  (`RXP028-level-filter`, info, once per guide that uses them).
- An **unresolvable word**, one whose truth depends on a profile value the project does not know
  (a race word while the character's race token is unverified, `SoD` while the season is `null`,
  `Male`/`Female` while the sex is `null`), is `unknown`.
- Words outside the vocabulary (`skip`, typos such as `Aliance`, other games' words) are false,
  as in RXP, with `RXP016-filter-quirk` info except for the `skip` idiom.
- A step or line whose filter is `unknown` stays **active with a warning**; it is never silently
  hidden. Group-level filters apply to every step of the group.

---

## 7. Guide header tags

Header = every line before the first `step`. Keys are case-sensitive and first-wins. Unknown keys
are stored and ignored by RXP; we keep them verbatim. The route model has no header fields: the
header lines stay in `project.imports[].text` and export reuses them (section 13.6).

| Tag | Value | Meaning | Source |
|---|---|---|---|
| `#forever` `#classic` `#era` `#som` `#tbc` `#wotlk` `#cata` `#mop` `#retail` `#df` | none | Game tags (section 4, P6). On Forever `#forever` or `#classic` passes; any other of `#tbc #wotlk #df #retail #cata` without them fails. For embedded addon guides the pre-scan also needs the text `#FOREVER` (case-insensitive substring) in the header, otherwise the guide is not loaded on Forever. `#era`/`#som` are also read by the season check of `#next` targets. | `GuideLoader.lua:569-575`, `1052-1059`; `functions.lua:3897` |
| `<< filter` (no key) | filter | Guide visible only to matching characters. | `GuideLoader.lua:1100-1106` |
| `#name` | text | **Required.** Guide name. `D-D…`/`D-DD…` prefix zero-padded. | `GuideLoader.lua:1123-1125`, `1134`, `1171` |
| `#group` | text | **Required** (unless given as first argument). A leading `+` marks a farming/gold guide. | `GuideLoader.lua:1007-1013`, `1020-1023` |
| `#subgroup` | text | Menu sub-heading; part of the guide key. | `GuideLoader.lua:692-693` |
| `#version` | number | Guide version (default 0). | `GuideLoader.lua:1174` |
| `#displayname` | text | Menu label (colour tokens replaced). Often given twice with faction filters. | `GuideLoader.lua:1170` |
| `#defaultfor` | filter | Characters for whom this guide is the suggested default; others see it as low priority. Special value `58Boost`. | `GuideLoader.lua:1136`, `1153-1168` |
| `#next` | `[Group\]Name{;[Group\]Name}` | Guide to load when this one ends. First active alternative wins; names get the same zero-padding. | `functions.lua:3810-3918` |
| `#groupid`, `#groupweight`, `#subweight`, `#groupdisplayname` | text/number | Menu grouping and ordering. | `GuideLoader.lua:178-179`, `1206-1215`; `GuideWindow.lua:2544` |
| `#internal` | none | Hidden from the menu; loadable only via `#next`/`#include`. | `GuideWindow.lua:1808` |
| `#disabled` | none | Not loadable. | `GuideWindow.lua:1808` |
| `#hardcore` `#softcore` | none | Guide mode. **On any game other than Classic, loading a guide forces it to `softcore` and then switches the user's hardcore setting off** (before steps are filtered). So on Forever the step-level `#hardcore` steps are always dropped and `#softcore` steps always kept (only `#hardcoreserver`/`#softcoreserver`, which test the realm rules, can differ). | `GuideWindow.lua:1828-1839` |
| `#title`, `#chapter`, `#chapters`, `#minLevel`, `#maxLevel`, `#theme`, `#loop` | various | Retail/menu features; `#loop` restarts the guide at the end. Preserve. | `GuideWindow.lua:758-763`, `1877`, `2461-2463` |
| `#xprate`, `#season`, `era/som` at header level | as step tags | Seen in Forever headers (11, 18, 3 uses). Stored on the guide table; we found no header-level consumer for `xprate`; `season` is read for `#next` targets. Preserve. | `functions.lua:3897`; counts from `classify.mjs` |
| `#key = functionName` | name | Stores the result of calling a registered addon function. **Opaque** (`RXP014-function-tag`). | `GuideLoader.lua:1117-1120` |

---

## 8. Step tags and load-time step filters

### 8.1 Step tags (lines starting `#` inside a step)

All are first-wins and unvalidated: a typo such as `#completwith` is silently stored and ignored
(`GuideLoader.lua:879-891`). Forever guides contain `#sofcore` (typo of softcore) once.

| Tag | Value | Meaning (runtime) | Route relevance | Forever uses | Source |
|---|---|---|---|---|---|
| `#completewith` | `next` or a label | The step becomes **sticky** and completes when the current step index passes the target (`next` = the next step after load-time filtering) or when the labelled sticky step is skipped. | ordering | 2503 | `GuideWindow.lua:690-713`, `1963` |
| `#sticky` | none | Stays active while later steps proceed, until its own elements complete. | ordering | 239 | `GuideWindow.lua:727-731`, `819-848` |
| `#label` | text | Names the step for `#completewith`, `#requires`, `.xp …,label`, `.maxlevel …,label`, `#include …@label`. Duplicate labels: last step wins in the index. | reference | 1214 | `GuideWindow.lua:1976` |
| `#requires` | label | Step is held back while the labelled step is active/unfinished. | ordering | 396 | `GuideWindow.lua:826-870`, `1964-1973` |
| `#optional` | none | Hidden from the upcoming-steps list; still in sequence. Steps with no elements become optional automatically. | UI | 1377 | `GuideWindow.lua:196-205`, `1956-1958` |
| `#hidewindow` | none | Step is not shown in the window (it still runs). Set automatically on element-less steps. | UI | 25 | `GuideLoader.lua:1082-1084`; `GuideWindow.lua:200` |
| `#loop` | none | The step's waypoints are cycled (grind loops). | map/UI | 443 | `map.lua:1006`, `1202` |
| `#level` | number | Step becomes active only at player level ≥ N (docs: use only on sticky steps). | level gate | 4 | `GuideWindow.lua:849`, `866`, `1975` |
| `#xprate` | `<R`, `>R`, `R1-R2` | Load-time filter on the configured XP-rate multiplier (section 8.2). | route variant | 1125 | `RXPGuides.lua:2500-2540` |
| `#season` | list of `0/1/2…` separated by `, ; space` | Load-time filter on season (0 none, 1 SoM, 2 SoD …). | route variant | 615 | `RXPGuides.lua:2467-2490` |
| `#era` `#som` `era/som` | none | Load-time season filters (Classic seasons). | route variant | 9/4/25 | `RXPGuides.lua:2475-2478` |
| `#phase` | `N` or `N-M` | Load-time filter on content phase (default 6). | route variant | 7 | `RXPGuides.lua:2391-2415` |
| `#hardcore` `#softcore` `#hardcoreserver` `#softcoreserver` | none | Load-time filter on hardcore setting / realm rules. `.deathskip` marks its step softcore automatically. | route variant | 125/170 | `RXPGuides.lua:2492-2498`; `functions.lua:2874` |
| `#ah` `#ssf` | none | Load-time filter on the solo-self-found setting. | route variant | 82/48 | `RXPGuides.lua:2443-2449` |
| `#maxlevel` | number | Load-time: step dropped when level > N (only if XP step skipping is on). Distinct from the `.maxlevel` command. | level gate | 0 | `RXPGuides.lua:2575-2581` |
| `#fresh` `#veteran` | level | Retail chromie-time checks. | n/a | 0 | `RXPGuides.lua:2558-2573` |
| `#questguide` `#speedrunguide` `#daily` `#aldor` `#scryer` | none | Loremaster / dailies / TBC reputation filters. Aldor/Scryer always pass on Classic and Forever. | n/a on Forever | 0 | `RXPGuides.lua:2369-2370`, `2417-2419`, `2452-2465` |
| `#include` | `[Group\]Name[@from[-to]]` | Splices another guide's steps (optionally between two labels or step IDs) in place. The `*label` form is dead code (a misspelt field name). | structure | 1 | `GuideWindow.lua:1607-1726`, `1653` |
| `#map` | zone | Map used for the step's arrow/pins. | UI | 19 | `map.lua:900` |
| `#arrowtext`, `#title` | text (`\n` allowed) | Arrow label / step title. | UI | 10/0 | `GuideWindow.lua:1959-1961`, `1050-1052` |
| `#tip`, `#track`, `#ignorecorpse`, `#timer`, others | various | Tip window, super-tracked quest, corpse arrow, … Preserve opaque. | UI | 0 | `GuideWindow.lua:611-620`, `716`, `788`; `map.lua:1035` |
| `#key = functionName` | name | Stores a function reference. **Opaque.** | — | 0 | `GuideLoader.lua:883-885` |

**Lowering** (section 12.5): the load-time tags `#xprate #season #era #som era/som #phase
#hardcore #softcore #hardcoreserver #softcoreserver #ah #ssf #maxlevel #fresh #veteran
#questguide #speedrunguide #daily #aldor #scryer` become `VariantTag` entries of the group
condition's `variant`. Every other step tag, including unknown, typo'd and function-assignment
tags, is an `RxpTag { name, value }` in `group.rxp.tags`, in source order. A later duplicate is
shadowed (first wins); that is derived from the order, not stored. Per-tag line filters are a
proposed domain addition (G1, section 12.2).

### 8.2 Load-time step filters (`addon.stepLogic`)

When a guide is opened, the addon keeps a step only if every step-logic check passes
(`GuideWindow.lua:1646`; `RXPGuides.lua:2421-2433`). Our engine evaluates the same checks against
the project's **route profile** (ARCH §8.2):

| Check | Reads | Addon setting (default) | Our route profile | Source |
|---|---|---|---|---|
| XpRateCheck | `#xprate` | `xprate` (1; slider 1-2 on non-Classic). Forever branches on 1.1, 1.2, 1.5, 1.59, 1.99, 2.09. | `routeProfile.xpRate` | `RXPGuides.lua:2500-2540`; `SettingsPanel.lua:155`, `1118-1140` |
| SeasonCheck | `#season #era #som era/som` | `season` (auto-detected; nil → 0), `phase` (6) | `routeProfile.season` (`null` = unknown), `routeProfile.phase` | `RXPGuides.lua:2467-2490`; `SettingsPanel.lua:154`, `3732-3752` |
| HardcoreCheck | `#hardcore #softcore …server` | `hardcore` setting (**forced off on Forever** when a guide loads, `GuideWindow.lua:1828-1840`), realm hardcore rule | `routeProfile.hardcore` (default false, matching RXP on Forever) | `RXPGuides.lua:2492-2498` |
| AHCheck | `#ah #ssf` | solo-self-found setting | `routeProfile.ssf` | `RXPGuides.lua:2443-2449` |
| GroupCheck | `.group` / `.solo` in the step | group-quests setting | `routeProfile.groupQuests` | `RXPGuides.lua:2435-2441`; `functions.lua:7584-7619` |
| DungeonCheck | `.dungeon` in the step | set of enabled dungeons | `routeProfile.dungeons` | `RXPGuides.lua:2583-2595`; `functions.lua:7511-7549` |
| ProfessionCheck | `.profession` | known professions | `character.professions` | `RXPGuides.lua:2597+` |
| LevelCheck | `#maxlevel` | XP step skipping (true), level | `routeProfile.xpStepSkipping`, `character.startLevel` | `RXPGuides.lua:2575-2581`; `SettingsPanel.lua:139` |
| PhaseCheck, DailyCheck, LoremasterCheck, FreshAccountCheck, AldorScryerCheck | as named | mostly inert on Forever | `routeProfile.phase`; the rest pass | `RXPGuides.lua:2369-2465`, `2558-2573` |

On Forever, automatic XP-rate detection is skipped: for game versions below 20000 the detection
only sets season/phase and returns (`SettingsPanel.lua:3724-3752`), so `xprate` is whatever the
user set (default 1). What Forever's XP multipliers actually are belongs to the XP-rules research
(**UNKNOWN** here).

---

## 9. Command reference

### 9.0 Legend and prevalence

- **Args:** positional after splitting (S6). `[x]` optional. Numbers use Lua's number
  conversion, so `+5`, `.5` and `5.` all parse; `5.5.5` fails.
- **Blocks:** whether the element must complete before the step completes (it is not
  `textOnly`). A step completes when every element is completed, skipped or text-only
  (`GuideWindow.lua:679-688`).
- **Effect:** `Q` quest state, `L` location/travel, `X` level/XP, `H` hearth/flight/death,
  `S` step condition (hides, skips or completes the step), `I` inventory/money, `U` UI or
  automation only, `M` guide structure/metadata.
- **Lowered to** (section 12): an ARCH §8.1 step kind (`accept`, `complete`, `turnin`,
  `abandon`, `travel`, `grind`, `hearth`, `flight`, `train`, `vendor`, `note`), or a slot of the
  group sidecar: `location` (the steps' shared location), `waypoint`, `annotation`, `skipIf` (a
  predicate in the group condition), `variant` (a variant entry in the group condition), or
  `preserved` (a `note` step with `preserved` set: kept for export, not simulated; `RXP034` when
  the command matters for the route).
- **Forever uses:** occurrences at line start in `Guides/Forever/*.lua` after stripping comments
  (13 files, 58 guides, c3429e0). `.goto` 14,180; `.target` 4,577; `.accept` 2,355; `.turnin`
  2,275; `.mob` 2,099; `.complete` 2,089; `.collect` 1,213; `.train` 1,046; `.itemStat` 986;
  `.dungeon` 876; `.itemcount` 740; `.xp` 732; `.use` 666; `.isOnQuest` 654; `.zoneskip` 544;
  `.money` 448; `.vendor` 385; `.isQuestComplete` 323; `.skill` 259; `.subzoneskip` 248;
  `.trainer` 241; `.isQuestTurnedIn` 232; `.waypoint` 224; `.isQuestAvailable` 179; `.fly` 173;
  `.unitscan` 154; `.zone` 152; `.cast` 131; `.subzone` 106; `.disablecheckbox` 101;
  `.skipgossipid` 89; `.link` 88; `.hs` 88; `.fp` 87; `.cooldown` 86; `.deathskip` 85;
  `.abandon` 80; `.usespell` 78; `.line` 71; `.bindlocation` 60; `.aura` 52; `.home` 51;
  `.timer` 42; `.equip` 42; `.destroy` 42; `.skipgossip` 32; `.isQuestNotComplete` 21;
  `.macro` 18; `.group` 18; `.bankdeposit` 17; `.maxlevel` 15; `.bronzetube` 15; `.engrave` 14;
  `.isNotOnQuest` 12; `.gossipoption` 6; `.bankwithdraw` 5; `.solo` 3; `.addquestitem` 2;
  `.emote` 1. Everything else: 0.

Parser tiers derived from this: **Tier 1** (structured, simulated): accept, turnin, complete,
goto, xp, hs, home, fp, fly, deathskip, train, trainer, vendor, collect, zone, subzone, abandon,
and all `is*`/`*skip`/`money`/`itemcount`/`maxlevel`/`bindlocation` conditions. **Tier 2**
(structured, annotation only): target, mob, unitscan, use, usespell, cast, link, waypoint, line,
loop, timer, cooldown, dungeon, group, solo, disablecheckbox, itemStat, skill, reputation, buy,
destroy, equip, aura, skipgossip*, gossipoption, macro, bankdeposit, bankwithdraw, bronzetube,
emote, engrave. **Tier 3**: everything else is recognised by name and kept opaque.

### 9.1 Quest state

| Command | Args | Meaning | Blocks | Effect | Lowered to | Source |
|---|---|---|---|---|---|---|
| `.accept` | `questId[,flags[,requiredTurnIn]]` | Accept quest. flags bit 1 = no auto-accept; bit 2 = element counts as done if `requiredTurnIn` is not turned in. Text defaults to "Accept *quest*" (`*quest*` = quest name at runtime). Multiple per step allowed. | yes | Q | `accept` | `functions.lua:1118-1151` |
| `.turnin` | `questId[,reward[,flags]]` | Turn in; `reward` = 1-based reward choice to auto-select; flags bit 1 = no auto turn-in. **Negative ID** = skip the element if the quest is not in the log (with `reward>0`: also if incomplete; the reward index is then not used). | yes | Q | `turnin` | `functions.lua:1334-1371` |
| `.complete` | `questId,objIndex[,objMax[,flags]]` | Track objective `objIndex` (1-based, in-game objective order); `objMax>0` = count needed for this step; flags odd = text-only (does not block). Negative ID = skip if not on quest. | yes (unless flags odd) | Q | `complete` (objective `objIndex − 1`) | `functions.lua:1754-1785` |
| `.daily`, `.acceptmultiple` | `questId{,questId}` | Accept any of several quests; done when one is accepted. | yes | Q | `accept` (`anyOf`) | `functions.lua:1271-1315`, `1534` |
| `.dailyturnin`, `.turninmultiple` | `questId{,questId}` | Turn in any of several. | yes | Q | `turnin` (`anyOf`). First revision: `preserved` with `RXP034`; superseded by ARCH §8.1 revision 2 (`turnin.anyOf`) | `functions.lua:1488-1535` |
| `.abandon` | `questId{,questId}` | Abandon quest(s). Text starting `*` changes the icon. | yes | Q | `abandon` (one step per ID) | `functions.lua:4030-4065` |
| `.collect` | `itemId,qty[,questId[,objFlags[,flags[,arg1…]]]]` | Have `qty` of item. With `questId`: tied to that quest (done when turned in; `objFlags` = bitmask of quest objectives tracked). flags: 1 text-only, 2 subtract from objective, 4 complete when flagged objectives done, 8 count bank, 16 don't complete on turn-in, 32 profession, 64 zero if none; negative flags = subtract multiplier. | yes (unless flag 1) | Q/I | `complete` (with `questId`) or `preserved` (without) | `functions.lua:2941-3010` (the flag list is in a source comment at `2961-2983`) |
| `.collectmultiple`, `.addquestitem`, `.questitemcount`, `.buy`, `.buyAll`, `.buyUntilBroke`, `.destroy`, `.retrieveitem`, `.bankdeposit`, `.bankwithdraw` | see source | Inventory helpers. `.buy item,qty[,questId,objIndex]` is text-only automation; `.destroy item` blocks. | varies | I/U | `annotation` (`.destroy`: `preserved`) | `functions.lua:2898-2940`, `3211`, `5087`, `5372-5470`, `5496-5540` |
| `.convertquest` | `srcId,dstId` | Remaps quest IDs for this guide (all later `.accept/.turnin/.complete` resolve through it). **Changes quest semantics.** | no | Q/M | `annotation`; later IDs remapped during lowering (`RXP029`) | `functions.lua:7676-7698`; `functions.lua:433-465` |
| `.mirrorquest` | `srcId,id{,id}` | Intended quest-ID aliasing; **always errors** in this version (a variable is tested before it is assigned). | — | — | `preserved` | `functions.lua:7700-7732` |
| `.disablequestautomation` | `questId{,questId}` | No element; turns off auto accept/turn-in for those quests. | no | U | `annotation` | `functions.lua:1317-1331` |

### 9.2 Step conditions (skip/complete predicates)

All are text-only (never block). "Skipped" = the step is marked completed while it is active.

| Command | Args | Step is skipped when | Lowered to | Source |
|---|---|---|---|---|
| `.isOnQuest` | `id{,id}` | none of the quests is in the log | `skipIf` | `functions.lua:4332-4373` |
| `.isNotOnQuest` | `id{,id}` | any is in the log | `skipIf` | `functions.lua:4375-4381` |
| `.isQuestTurnedIn` | `id{,id}[,account]` | none is turned in | `skipIf` | `functions.lua:4383-4443` |
| `.isQuestAvailable` | `id{,id}` | all are already turned in | `skipIf` | `functions.lua:4445-4450` |
| `.isQuestComplete` | `id[,account]` | the quest is not (in the log and complete) | `skipIf` | `functions.lua:4285-4323` |
| `.isQuestNotComplete` | `id` | the quest is in the log and complete | `skipIf` | `functions.lua:4325-4330` |
| `.questcount` | `[<]N[*]{,id}` | quest-log count test (`*` ignores turned-in) | `skipIf` | `functions.lua:4229-4283` |
| `.xp` | `levelExpr,skip[,label]` | see section 9.4; with a label: jump to that step instead | `skipIf` (jump: `RXP034`) | `functions.lua:3271-3393` |
| `.maxlevel` | `N[,label]` | level > N (only if XP step skipping is on); with label: jump | `skipIf` (jump: `RXP034`) | `functions.lua:5872-5939` |
| `.money` | `<G` or `>G` [,1] | `<G`: money < G gold; `>G`: money ≥ G gold (`,1` = net worth) | `skipIf` | `functions.lua:3768-3808` |
| `.itemcount` | `id{…},[<\|>][=]N[,bank]` | item count test fails (`<` = skip if you already have enough) | `skipIf` | `functions.lua:6079-6158` |
| `.zoneskip` | `zone{+zone\|/zone}[,1]` | player is in any listed map (flag 1 = skip when **not** in them) | `skipIf` | `functions.lua:4679-4715` |
| `.subzoneskip` | `areaId[,flags]` | current (sub)zone name equals the AreaTable name (flag 1 reverses) | `skipIf` | `functions.lua:4568-4605` |
| `.bindlocation` | `areaId[,1]` | hearth is bound there (flag 1: is not) | `skipIf` | `functions.lua:2664-2684` |
| `.train` | `spellId,1` / `spellId,3` | spell already known / not known | `skipIf` | `functions.lua:3921-3990` |
| `.istrained` / `.spellmissing` | `spellId{,id}` / `spellId` | knows any / … | `skipIf` | `functions.lua:4005-4028`, `4464+` |
| `.skill` | `name,[<]N[,skip[,useMax]]` | with skip: profession skill test | `skipIf` (without skip it is a blocking objective: `preserved`, `RXP034`) | `functions.lua:3395-3420` |
| `.reputation` | `factionId,standing[+/-value][,value[,skip]]` | with skip: reputation test; standings `hated…exalted` or 1-8 | `skipIf` (without skip: `preserved`, `RXP034`) | `functions.lua:3552-3600`; `DB/shared.lua:15-24` |
| `.bronzetube` | `[rev]` | (Classic Duskwood item check) | `skipIf` | `functions.lua:5469+` |
| `.skipOnQuest`, `.skipto`, `.hideifcomplete`, `.areapoiexists`, `.isQuestOffered`, `.totalbagslots`, `.cooldown`, `.aura`, `.equip`, `.itemStat` | see source | various | `skipIf` or `annotation` (jumps: `RXP034`) | `functions.lua:8190-8277`, `4452`, `4159`, `8104`, `8410`, `6240`, `7734`, `7822`, `7301` |

### 9.3 Location, travel, hearth, flight, death

| Command | Args | Meaning | Blocks | Effect | Lowered to | Source |
|---|---|---|---|---|---|---|
| `.goto` | see section 10 | Waypoint/arrow/pin, or a travel objective when a positive radius is given. | only with radius > 0 and no 6th arg | L | `location` (+ `travel` for a radius objective) or `waypoint` (section 12.4) | `functions.lua:1864-1964` |
| `.zone` | `zone` + **required** `>>text` | Done on entering that map. | yes | L | `travel` (`location: null`) | `functions.lua:4607-4638` |
| `.subzone` | `areaId[,flags]` + **required** text | Done on entering that area (flag 1 reverses; 2 = only when no map). | yes | L | `travel` (`location: null`) | `functions.lua:4527-4566` |
| `.explore` | `areaId,zone` + text | Done when the area is explored. | yes | L | `travel` (`location: null`) | `functions.lua:4640-4677` |
| `.hs` | **required** `>>text` | Use hearthstone: done when the player casts a hearthstone-type spell (Hearthstone, Astral Recall and a few others; on Retail also hearthstone toys). | yes | H | `hearth` (`mode: 'use'`) | `functions.lua:2529-2565` |
| `.home` | `[areaId]` | Bind hearthstone (text defaults from the area name). | yes | H | `hearth` (`mode: 'bind'`) | `functions.lua:2614-2662` |
| `.fp` | `nameSubstring[,flags]` | Discover a flight path. The name is matched case-insensitively as a **substring** of the faction's flight-node names (English). flags 1 text-only, 2 ignore click. | yes (unless flag 1) | H | `flight` (`mode: 'discover'`) | `functions.lua:2711-2789` |
| `.fly` | `nameSubstring` (text or name required) | Take a flight; destination matched as an uppercase substring of the node name when the taxi map opens. Done once on a taxi. | yes | H/L | `flight` (`mode: 'take'`) | `functions.lua:2790-2860` |
| `.deathskip` | — | Die and resurrect at the spirit healer; marks the step `softcore`. | yes | H/L | `preserved` (`RXP034`; the engine sets the position to unknown afterwards, ARCH §8.1) plus an implicit `softcore` variant entry | `functions.lua:2864-2896` |
| `.hastyhearth` | `[flag]` | Retail toy check. | — | — | `preserved` | `functions.lua:3992-4003` |
| `.waypoint`, `.pin`, `.ingamewaypoint`, `.questgoto`, `.questwaypoint`, `.groundgoto`, `.flygoto`, `.wpradius`, `.line`, `.loop`, `.treasure`, `.rare`, `.openmap` | see section 10 | Map/arrow decorations. | no | L (hint) | `.waypoint`: `waypoint` (leg); `.pin`: `waypoint` (pin); the rest: `annotation` | `functions.lua:1986-2527`, `6196` |

### 9.4 Level and XP

| Command | Args | Meaning | Blocks | Lowered to | Source |
|---|---|---|---|---|---|
| `.xp L` | `L` | Grind until level L. | yes | `grind` (no offset) | `functions.lua:3271-3317` |
| `.xp L+N` | `L+N` | Until N XP into level L. | yes | `grind` (offset `xpInto`) | same |
| `.xp L-N` | `L-N` | Until N XP short of level L (i.e. level L-1 with `max-N` XP). | yes | `grind` (offset `xpShort`) | same, `3343-3368` |
| `.xp L.F` | `L.F` (for example `10.5`) | Until fraction `.F` into level L (`10.5` = 50%, `10.25` = 25%). | yes | `grind` (offset `fraction`) | same |
| `.xp <expr` | `<` prefix | Reverse logic: condition is "below". | — | with a skip flag: `skipIf` | same |
| `.xp expr,S` | skip flag S | Text-only: when the target is reached (or, with `<`, not reached), the step is **skipped**. Without `<` this only acts if the user enabled XP step skipping (default on); a negative S also reverses. RXP converts S with Lua's `tonumber`, so an S that is not a number reads as no flag at all: the line stays an ordinary grind objective (`functions.lua:3275`, `3291-3293`). | no | `skipIf`; S not a number: as `.xp expr` without S, plus `RXP004` (warning) | `functions.lua:3316`, `3322-3326`, `3361-3390` |
| `.xp expr,S,label` | + label | Jump to the labelled step instead of skipping. | no | `skipIf` (jump approximated as skip, `RXP034`) | `functions.lua:3281`, `3372-3378` |

Behaviour of the level expression (`functions.lua:3279`), in our words: all spaces are removed
first. RXP then looks for the first place in the argument where this shape occurs: an optional
`<`, a run of decimal digits (the level), and optionally one of `+`, `-` or `.` followed by
digits (the offset). Characters before and after that shape are ignored, so RXP keeps the
element. Our parser accepts the same shape; extra characters are reported as
`RXP004-malformed-number` with severity warning (RXP keeps the element with the value it found),
and the lowering uses that value. A level or offset whose digits do not make a safe integer
(more than 15 or so digits), a level below 1 for a grind objective, and a fraction whose digits
round to 1 or more (`10.99999999999999999`) have no form in the route model: the line is
`RXP004` (error) and is kept as a preserved note. All three offset forms lower exactly: the engine resolves the
offset with the ruleset's XP table (12.3), so `src/rxp` needs no XP data. The first revision
approximated `L-N` and `L.F` as "until level L" with `RXP033`; that is superseded by the
`GrindTarget` offsets of ARCH §8.1 revision 2, and `RXP033` is retired (11.1).

### 9.5 Trainers, vendors, NPC interaction

| Command | Args | Meaning | Blocks | Lowered to | Source |
|---|---|---|---|---|---|
| `.train` | `spellId[,flags]` | Learn spell (numeric ID required). flag 1 = text-only skip-if-known; 2 = reverse. | yes (flags 0) | `train` (`spellId`); with flag bit 1: `skipIf`. Riding needs no parser rule: the engine recognises a riding `spellId` from the ruleset's riding spell table (ARCH §9.1; Apprentice 33388, Journeyman 33391, forever-game-rules.md §6.1) | `functions.lua:3921-3990` |
| `.trainer` | `[npcId]` | Done when a trainer window (from that NPC, if given) closes. | yes | `train` (`spellId: null`) | `functions.lua:3688-3711` |
| `.vendor` | `[npcId]` | Done when a merchant window closes. Text defaults "Sell junk/resupply". | yes | `vendor` | `functions.lua:3662-3686` |
| `.stable`, `.tame` | `[npcId]` / `npcId` | Hunter pet stable / tame. | yes | `preserved` (`RXP034`) | `functions.lua:3713-3766` |
| `.target`, `.mob`, `.unitscan` | `name\|id\|name::id{;…}`, leading `+` attaches to parent objective | Target macro / mob list / rare scanner. `name::id` keeps the name on English clients. | no | `annotation` (feeds NPC validation) | `functions.lua:4870-5006` |
| `.skipgossip`, `.skipgossipid`, `.gossipoption`, `.gossip`, `.choose`, `.emote`, `.vehicle`, `.exitvehicle` | see source | Dialogue/emote/vehicle automation. | mostly no | `annotation` | `functions.lua:5605-5870`, `6023-6077`, `6160-6194`, `8279-8300` |

### 9.6 Items, spells, UI

| Command | Args | Meaning | Lowered to | Source |
|---|---|---|---|---|
| `.use`, `.usespell` | `id[:arg]{,id}` | Adds an item/spell button. Text-only. | `annotation` | `functions.lua:5941-6021` |
| `.cast` | `spellId{,id}` or `unit,spellId…` | Done when the spell is cast (blocking only when it has text). | `annotation`; `preserved` (`RXP034`) when it blocks | `functions.lua:4797-4852` |
| `.link` | `url` (rest of line; `\-` → `-`) + **required** text | Clickable URL popup. | `annotation` | `functions.lua:4739-4796` |
| `.clicknext` | `Group\Name` (rest of line) + required text | Click to load another guide. | `annotation` | `functions.lua:4717-4744` |
| `.macro` | `name[,iconId]` + `>>macro body` | Builds a macro. | `annotation` | `functions.lua:5977-6017` |
| `.timer` | `seconds[,label[,callback…]]` | Timer bar, latches onto the element above. | `annotation` | `functions.lua:6585-6610` |
| `.cooldown` | `type,id,[<\|>]N[m\|s][,once]` | Cooldown condition/display. | `skipIf` / `annotation` | `functions.lua:6240-6325` |
| `.disablecheckbox` | — | Makes the **previous objective text-only** (non-blocking). | `annotation`; also makes a preceding `complete` step `partial` (section 12.3) | `functions.lua:7621-7633` |
| `.dungeon` | `TAG` or `!TAG` | Step belongs to a dungeon (shown only if enabled); `!` = hidden if enabled. Forever tokens, as interoperability vocabulary (D-019) in alphabetical order: `BFD BRD DM DME GNOMER LBRS MARA RFC RFD RFK SCHOLO SFK SM ST STOCKS STRAT ULDA WC ZF`. The addon also accepts aliases, not listed here; the data behind the tokens is not recorded (D-019). | `variant` | `functions.lua:7511-7549`; `DB/forever/db.lua:122-175` |
| `.group [N]`, `.solo` | | Group-quest step flags. | `variant` | `functions.lua:7584-7619` |
| `.next` | `[Group\]Name` | Element form of `#next`. | `annotation` | `functions.lua:3810-3918` |
| `.label` | `name` | Registers the step for `#include *name` (dead path). | `annotation` | `functions.lua:971-975` |
| `.itemStat`, `.equip`, `.aura`, `.engrave` (SoD only), `.logout`, `.countdown`, `.wptimer`, `.wpbuff`, `.openitem`, `.scrap`, `.spec`, `.dualspec`, `.tradeskill`, `.profession`, `.multibox*`, `.singlebox*` | see source | Gear/aura/UI helpers. | `annotation` (`.profession`: `variant`) | `functions.lua:6327-6420`, `6653-6686`, `7087`, `7301-7372`, `7446-7582`, `7734-7926`, `8357-8472` |

### 9.7 Opaque, internal or other-game commands

Recognise by name, keep verbatim, never evaluate. All lower to `preserved`:

- **Execute Lua or mutate RXP's own quest database:** `.setquestdb` (runs its argument as Lua
  code, `DB/questDB.lua:1150-1168`), `.addtoquestdb`, `.setturninroute`, `.setturninhs`,
  `.turninconfig`, `.show25quests`, `.showtotalxp`, `.requires` (dot-command, not the `#requires`
  tag; `DB/questDB.lua:1459-1523`), `.tbcWBF`, `.getTBCchapters`.
- **Classic/Forever DB helpers used by RXP's own guides:** `.xpto60`, `.xpto60alliance`,
  `.xpto60horde`, `.xpto60hc`, `.xpcheck` (`DB/forever/db.lua:311-640`).
- **Retail/other-game only:** `.scenario`, `.isInScenario`, `.enterScenario`, `.achievement*`,
  `.isWorldQuest*`, `.chromietime`, `.skyriding`, `.noskyriding`, `.flyable`, `.noflyable`,
  `.collectmount`, `.collecttoy`, `.collectpet`, `.collectcurrency`, `.mountcount`, `.petfamily`,
  `.dailyhub`, `.dailyreset`, `.vale`, `.klaxxi`, `.celestial`, `.landfall`, `.acceptmap`,
  `.areapoiguide`, `.neutralzonefinished`, `.pvp`, `.pve`, `.dmf`, `.nodmf`, `.holiday`, `.beta`,
  `.blastedLands`, `.ironchain`, `.bombdispenser`, `.rescue`, `.niffelen`, `.hsbatching`,
  `.maxskill`, `.noop`.

**Route relevance** (which preserved lines get `RXP034-not-simulated`, 12.3): the first two
groups above are route-relevant, because running Lua, changing RXP's quest database or RXP's own
level helpers can change which steps a character does; so are the preserved commands of sections
9.1-9.6 (`.destroy`, `.stable`, `.tame`, and the blocking `.collect`, `.cast`, `.skill` and
`.reputation` forms of 12.6, and `.deathskip`). The third group (other games only), `.mirrorquest`
(it always errors, 9.1) and `.hastyhearth` (a Retail toy check, 9.3) are not: they are preserved
without a diagnostic.

**Prefix families.** `.multibox*`, `.singlebox*`, `.achievement*` and `.isWorldQuest*` name every
command that starts with the prefix, **including the bare prefix** (RXP registers `.achievement`,
`.multibox` and `.singlebox` themselves as well as longer names; RXP review, `functions.lua:7147`,
`7477`, `7493`).

The full list of 176 registered names was produced with the research script
`.cache/experiments/rxp/gen-commands.sh <rxpguides clone>` (it lists the function names
registered on the addon's command table outside `libs/`; output `commands.txt`). Our parser ships
its own list of known names, written from this section as interoperability vocabulary (D-019),
and treats any other name as `RXP001-unknown-command`.

---

## 10. `.goto` and the other location commands

### 10.1 Argument forms

`.goto zone,x,y[,radius[,flag]]` (`functions.lua:1864-1964`). The zone argument has four forms:

| Form | Example | Coordinates | Resolution | Source |
|---|---|---|---|---|
| English zone key | `Durotar,42.06,68.33` | zone percent 0-100 | name → UiMapID through the game's table. Ours: the QuestieDB-derived key table (section 10.3). | `map.lua:1487-1531` |
| Numeric UiMapID | `1411,42.06,68.33` | zone percent | used directly | `map.lua:1530` |
| `UiMapID/instance` | `1411/1,-4186.42,-600.30` (Gornek, ours) | **HereBeDragons world coordinates in yards**: first = HBD x = Blizzard world Y, second = HBD y = Blizzard world X. HBD takes x from the **second** and y from the **first** return value of `UnitPosition`. | RXP computes the element's zone percent from the map's world rectangle. `instance` is 0 = Eastern Kingdoms, 1 = Kalimdor in Forever guides. If the point is outside the map, the element is dropped. | `functions.lua:1875-1896`; `libs/HereBeDragons/HereBeDragons-2.0.lua:442-459`, `580`; docs/research/coordinates.md §13.3 |
| Pseudo-zones | `StormwindClassic`, `StormwindNew`, `EPLClassic`, `EPLNew` | zone percent | RXP maps them to Stormwind City / Eastern Plaguelands with a linear conversion between the pre- and post-Wrath maps; on Forever (game version < 30000) `…Classic` is used unchanged and `…New` is converted. Ours: section 10.4. | `map.lua:1496-1537` |

The Gornek example is our own: QuestieDB NPC 3143 stands at Durotar `42.06, 68.33`
(`foreverNpcDB.lua:2604`), which is world `(X, Y) = (−600.30, −4186.42)` on map 1 through the
Durotar UiMapAssignment row (docs/research/coordinates.md §7). Converting
`1411/1,-4186.42,-600.30` back gives `42.0600, 68.3300`. Neither this world pair nor the percent
pair occurs in any RXP guide at c3429e0 (checked 2026-09-25). Fixtures 04 (E09) and 06 (L01) use
it; this document gives no other world-form values.

`.goto` with no zone (`.goto 45.2,33.1`) is **invalid**: the arguments are positional, so RXP
takes `45.2` as the zone and the element is dropped (debug message only). RXP's "last zone"
fallback only applies when there are no arguments at all, and then fails for lack of coordinates
(`functions.lua:1869-1873`). We report `RXP003-goto-missing-zone` and do not guess.

The fifth/sixth positions after the empty-field collapse (S6):

| Written | radius | flag present | Behaviour | Blocks | Waypoint kind when not the location (12.4) |
|---|---|---|---|---|---|
| `.goto z,x,y` | — | — | Arrow + map pin, attached to the previous objective | no | leg |
| `.goto z,x,y,R` (R > 0) | R | no | **Objective**: done within R yards; default text "Go to x,y (zone)" | yes | leg + `RXP034` |
| `.goto z,x,y,R,0` (R > 0) | R | yes (any value) | Arrow only, no pin; advances to the next waypoint within R yards (route leg) | no | leg |
| `.goto z,x,y,0` | 0 | no | Map pin only, no arrow | no | pin |
| `.goto z,x,y,0,0` | 0 | yes | Low-priority waypoint (arrow kept) | no | pin |
| `.goto z,x,y,-1` | < 0 | — | "Closest point": arrow points at the nearest of the step's dynamic points | no | closest |

Source: `functions.lua:1906-1958`; docs ".goto Guru" table (section 2). The flag is tested for
presence only, so `,1` and `,0` behave the same.

Related commands (same zone forms): `.waypoint zone,x,y[,radius[,lowPrio|callback,events…]]`
(arrow without pin; radius < 0 = persistent dynamic, `functions.lua:2061-2158`); `.pin zone,x,y[,tooltip]`
(`2187-2251`); `.questgoto`/`.questwaypoint zone,x,y,radius,questId,objIndex[,objMax[,flag]]`
(hidden once the objective count is reached, `2020-2059`); `.groundgoto`/`.flygoto` (goto that
turns off/on when the player can fly, `1986-1994`); `.wpradius zone,x,y,radius` (activation radius
for the previous waypoint, `2160-2185`); `.line zone,x1,y1,x2,y2,…` (polyline; negative pairs =
dashed, `2425-2476`); `.loop range,zone,x1,y1,…` (loop with visit radius, `2478-2527`).

### 10.2 What RXP's Forever guides actually use

Zone-argument form per command (`Guides/Forever/*.lua`, comments stripped):

| Command | `UiMapID/instance` world | numeric UiMapID | English name |
|---|---|---|---|
| `.goto` | 11,655 | 2,375 | 150 |
| `.waypoint` | 45 | 179 | 0 |
| `.line` | 0 | 0 | 71 |
| `.zone` | — | 0 | 152 |
| `.zoneskip` | — | 0 | 544 |

Most frequent `.goto` zones: `1413/1` (The Barrens) 1,719; `1412/1` (Mulgore) 1,148; `1411/1`
(Durotar) 1,036; `1426/0` (Dun Morogh) 936; `1429/0` (Elwynn Forest) 926; `2521` (Zephras Isle,
always percent) 840. Instances seen: `/0` with Eastern Kingdoms zones and `/1` with Kalimdor
zones, including the continent maps `1415/0` and `1414/1`. Per step: 6,856 of 8,674 steps have
at least one `.goto`; 59 `.goto` lines carry a line filter (in 20 steps the last `.goto` is
filtered, in 9 every one is); 14 radius objectives are not the last `.goto` of their step; in 28
steps the last `.goto` is a closest-point one (counted with a throwaway script, 2026-09-25).

The map layer converts between world and zone percent with the UiMapAssignment rectangle of each
UiMap (docs/research/coordinates.md §7, §13.3; MAPS.md §6). The committed placeholder geometry
holds the 49 QuestieDB frames (UiMaps 1411-1413 and 1416-1461) plus 12 DB2-only rows for 11
UiMaps (Azeroth 947 has one row per continent), among them the continents 1414 and 1415 and
Zephras Isle 2521 (D-018, D-026). So every UiMap that RXP's Forever guides use has a committed
frame.

### 10.3 Zone names and localisation

- Zone keys are English and case-sensitive table lookups. Localised guides keep English keys:
  the zhCN translations write `.zone Ironforge >>…` with Chinese text after `>>`
  (`lang/Guides-zhCN/Classic-0.5.lua`), and `.fp`/`.fly` keep English node names
  (`lang/Guides-zhCN/Classic-Horde-01-12_Durotar.lua`).
- `.subzone`/`.subzoneskip`/`.explore`/`.home`/`.bindlocation` take **AreaTable IDs** and compare
  the client's localised area name at runtime.
- `.fp`/`.fly` take a substring of the English flight-node name (RXP's flight table has English
  names, `DB/forever/flightData.lua:5+`).
- **Our key table** (ARCH §10 step 4; critique LIC-13): built by `tools/questiedb` from QuestieDB
  `support/Forever/Zones/uiMapIdToAreaId.lua` at the pinned commit. Its rows sit inside two
  long-bracket Lua strings (`uiMapIdToAreaIdOverride` and `uiMapIdToAreaId`); each row's trailing
  comment is the English name (for example UiMap 2521 → area 16593, "Zephras Isle", line 113).
  The extractor parses those inner chunks with comments enabled and validates them: exactly one
  name per zone-type UiMap, and non-name comments ("Referenced dungeon area", "Referenced synthetic
  dungeon alias") are rejected. The file's header says it was completed by hand and would be
  overwritten by upstream regeneration, so the file is a recorded manifest input. The names ship
  in `zones.json` with their source (ARCH §5.2); `src/rxp` receives the table through the injected
  lookup interface (ARCH §4).
- **Pseudo-zone keys** `StormwindClassic`, `StormwindNew`, `EPLClassic`, `EPLNew` are
  self-authored interoperability vocabulary (D-019); section 10.4 says how each lowers.
- A localised name (`Wald von Elwynn`) is `RXP009-localized-zone-name` (error: RXP would drop the
  line). QuestieDB's `l10n/Forever` has no zone-name tables, so an optional mapping would need
  AreaTable/UiMap names per locale from client data (**future work**).

### 10.4 Coordinates in the route model (ARCH §6, D-017)

| RXP form | `SourcedPoint` |
|---|---|
| `Durotar,x,y` or `1411,x,y` | `{ space: 'zone', uiMapId: 1411, x, y, frame, lexemes: [x, y] }` |
| `1411/1,a,b` | `{ space: 'world', mapId: 1, x: b, y: a, uiMapId: 1411, lexemes: [a, b] }` (world X is the **second** number; `uiMapId` is the UiMapID before the `/`) |
| `StormwindClassic,x,y` / `EPLClassic,x,y` | `{ space: 'zone', uiMapId: 1453 / 1423, x, y, frame, lexemes }` |
| `StormwindNew,…` / `EPLNew,…` | no point: `RXP036-pseudo-zone-unconverted` (warning). RXP converts these with coefficients this project does not have and does not take from RXP (D-019); the line survives through the source (section 13) |

- `lexemes` are the original number strings **in source order**, so export reproduces them
  exactly (`42.10` stays `42.10`, `+5` stays `+5`).
- `frame` is `'forever'` for every percent point, except on the four frame-changed UiMaps
  **1412 Mulgore, 1423 Eastern Plaguelands, 1433 Redridge Mountains, 1453 Stormwind City**
  (including the `…Classic` pseudo-zones). There the import option `options.changedZoneFrame`
  (`'forever'` by default, `'era'` for guides written against the Era maps) sets the frame, and
  each such line gets `RXP030-frame-ambiguous` (warning): RXP itself reads the numbers in the
  running client's frame, and an Era-framed point is about 100 yd off (docs/research/coordinates.md
  §9, §13.4: 98 such lines in RXP's Forever guides). `eraToForever` is applied at resolution only
  to `frame: 'era'` points (ARCH §6).
- The UiMapID of the world form is kept in the world variant's `uiMapId` (ARCH §6 revision 2,
  `src/domain/points.ts`), so export writes it from the model (13.4 rule 8), also for an edited or
  split group. When geometry is available (injected), a world point outside the frame of its
  `uiMapId` gets `RXP035-goto-outside-map` (warning; RXP drops such an element). The first
  revision kept this UiMapID only in the source line; that is superseded.
- A positive radius on the location `.goto` becomes the arrival radius `Location.radius`
  (ARCH §6). The 6th-position flag, and a radius of 0 or less (pin, closest point), are not
  arrival radii; they stay in the source line (12.4 rule 7).
- A number RXP cannot read (`-600.00.00`) is `RXP004-malformed-number` (error); the line yields
  no point.
- In the world form, the UiMapID before the `/` must be a positive safe integer and the instance
  after it a safe integer (`.goto 0/1,…` and `.goto 99999999999999999999/1,…` name no map, and a
  number beyond the safe-integer range cannot be stored exactly): otherwise the line is `RXP004`
  (error) and yields no point. A numeric UiMapID in the zone form that is not a positive safe
  integer is read as a missing zone (`RXP003`), as before.
- Resolution to a `WorldPoint` happens at runtime in `geo` and is never persisted; a point on a
  UiMap without geometry is still storable and resolves to null (unknown travel, ARCH §6).

---

## 11. Edge cases and diagnostics

"RXP" = reference behaviour (what the addon does). "Ours" = required behaviour of our parser.
Fixture references are `file:Enn` or `file:Lnn` in `docs/research/rxp-samples/`.

| # | Case | RXP | Ours | Fixture |
|---|---|---|---|---|
| 1 | Several `.accept`/`.turnin`/`.complete` in one step | normal; each is an element | one atomic step per line in source order, in one group (consecutive `.complete` lines merge, 12.3) | 01; 04:E04 |
| 2 | Filter on a single line, on the step line, on a header line, on a tag value | 6.1 | keep the filter AST on the node | 02 |
| 3 | `.complete id,obj` with several objectives of one quest | one element per objective index | `obj` maps to objective index `obj − 1` in Questie `ObjectiveData` order (ARCH §5.4). `RXP031-objective-out-of-range` when `obj` exceeds the dataset quest's objective count; `RXP032-objective-unchecked` when the quest is custom or unknown. `objMax` and flags are kept (12.3) | 01; 04:E22; 06:L04, L05 |
| 4 | `.goto` without zone | element dropped (debug msg) | `RXP003-goto-missing-zone` error; node kept | 04:E08 |
| 5 | Zone name vs ID vs `ID/instance` vs pseudo-zone | 10.1 | parse all four (10.4) | 04:E09-E10; 05; 06:L01-L03 |
| 6 | Localised zone name | dropped | `RXP009-localized-zone-name` error | 04:E11 |
| 7 | CRLF, CR, LF, mixed; blank lines | all are separators; blank lines vanish | accept all; the CST keeps each line's original ending; diagnostics use physical line numbers | 04 (CRLF) |
| 8 | Tabs, leading/trailing spaces | trimmed | trimmed; original indentation kept as trivia | 04:E03 |
| 9 | UTF-8 BOM | (a Lua file with a BOM fails to load before RXP sees it) | CST keeps it; `RXP026-bom` info; canonical output has none | — |
| 10 | Unknown command | error in chat, line dropped; if it had `>>text` that text **survives as a note** | `RXP001-unknown-command` warning; `preserved` note; we do not invent a note | 04:E06 |
| 11 | Wrong case (`.Accept`) | unknown | `RXP017-command-case` with suggestion | 04:E07 |
| 12 | Stray text (no prefix) | dropped silently | `RXP002-stray-line` warning; `preserved` note | 04:E05; real case in `Horde-12-22_Barrens.lua`: a coloured warning line that lacks its `+`/`*` prefix |
| 13 | `--` inside text/URL | text cut there | strip like RXP; `RXP007-inline-comment` info when the comment starts inside `>>` text or a rest-of-line argument (a trailing comment after ordinary arguments gets none) | 04:E18, E19 |
| 14 | Comment on a last line without newline | not stripped → args polluted, element usually fails | strip; `RXP022-unterminated-comment` warning ("RXP would not strip this") | 04:E35 |
| 15 | Filter before text (`<< Horde >> text`) | filter becomes "Horde >> text" → line dropped for everyone | `RXP006-filter-before-text` error | 04:E16 (E17 is the correct order) |
| 16 | `<< a << b` | AND | parse as AND, `RXP016-filter-quirk` info | 02 |
| 17 | Unknown filter words (`skip`, `era`, typos) | false | false; `RXP016-filter-quirk` info except for the `skip` idiom | 02 |
| 18 | Empty argument fields `a,,b`, trailing comma | dropped (positions shift) | reproduce the collapse, `RXP005-empty-field` warning; the serializer never emits empty fields. Real cases: one Skyborne `.goto` with an empty field before its radius, and a trailing comma in the Barrens guide | 04:E13-E14 |
| 19 | Spaces around commas | removed | same | 04:E15 |
| 20 | Malformed number (`-600.00.00`) | element dropped | `RXP004-malformed-number` error. A real case exists in `Horde-01-12_Durotar.lua` | 04:E12 |
| 21 | Negative quest IDs | `.turnin -id` / `.complete -id,…` = skip if not on quest | `turnin.skipIfMissing: true`; on `.complete` not modelled (`RXP034`) | 04:E21; 06:L01 |
| 22 | `.link` URL with commas; escaped `\-` | rest-of-line arg; `\-` → `-` | same; serializer escapes `-` pairs in URLs | 04:E19 |
| 23 | Names with commas in `.mob`/`.target` | use `;` | same | 04:E20 |
| 24 | Required text missing (`.hs`, `.zone`, `.subzone`, `.link`, `.clicknext`, `.macro`, `.fly` without location) | error, element dropped | `RXP018-missing-text` error | — |
| 25 | Line starting with `step…` | new step | new step + `RXP010-step-prefix` warning | 04:E31 |
| 26 | Step typos: a capitalised `Step`, or a doubled first letter (the prefix test is case-sensitive; leading spaces are trimmed first, so an indented `step` is fine) | stray (or filtered) | `RXP011-step-typo` "possible step typo" when a stray or filtered-out line matches `/^\w?step\b/i`. A real Forever guide (`Alliance-1-13_Human.lua:2743`) has a doubled-letter typo followed by a `skip` filter, which leaves the following lines active inside the previous step | 04:E32 |
| 27 | Duplicate header/step tags; several `<< filter` header lines | first wins; for `<< filter` header lines `enabledFor` is the first, but the last decides whether the guide loads (4 P7) | keep all in source order (a later duplicate is shadowed, derived from the order), `RXP013-shadowed-tag` info (for a later `<< filter` header line the message says that the last one decides loading) | 04:E01, E30 |
| 28 | Unknown or typo'd step tags (`#completwith`), and `#key=value` without spaces (key `key=value`, P8b) | stored silently | keep; `RXP012-unknown-tag` warning with did-you-mean | 04:E28 |
| 29 | `#key = functionName` | function reference | opaque tag, `RXP014-function-tag` info | 04:E29 |
| 30 | Commands before the first step | ignored | keep in the header, `RXP015-header-command` warning. Real case: three `.goto` lines in the header of `RestedXP-Skyborne.lua` | 04:E02 |
| 31 | Empty step / step with only text-only elements | hidden+optional / completes at once | keep; an empty step lowers to a carrier note (12.1) | 04:E33-E34 |
| 32 | `*quest*` placeholder, `\n` in `*` lines, RXP colour tokens (`cRXP_WARN_` and similar, written after a pipe), WoW colour and texture escapes (pipe-c … pipe-r, pipe-T … pipe-t) | runtime text features | text is opaque; offer a plain-text rendering that removes escapes and replaces RXP colour tokens | 04:E24-E26 |
| 33 | Missing `#name` / `#group` | hard error / not loaded | `RXP025-missing-name-or-group` error, still parse steps | — |
| 34 | Game tags only for other games (`#tbc` only) | skipped on Forever | `RXP024-other-game` warning; parse anyway | — |
| 35 | `#classic` guide on Forever | accepted by the parse path; embedded addon guides also need `#forever` | accept; `RXP027-classic-header` info recommending `#forever` | 01 |
| 36 | Level words in filters (`<< 10`) | evaluated once per session | evaluated at the route's start level (6.5); `RXP028-level-filter` info | 02 |
| 37 | `.xp`/`.maxlevel`/`.money`/`.itemcount` operator syntax | 9.2, 9.4 | structured parse; round-trip exact | 04:E27; 06:L07 |
| 38 | Protected import string pasted | — | `RXP019-protected-format`, refuse | — |
| 39 | Dynamic Lua (`..`, variables) | Lua evaluates it | `RXP020-lua-dynamic`, skip | 03 |
| 40 | `.convertquest` | remaps later quest IDs | apply to this guide during lowering, `RXP029-convertquest` warning | — |
| 41 | `+` manual objective | a checkbox that blocks the step until the player ticks it | `note` step; the simulator auto-ticks it and records the assumption (Q7) | 04:E23 |
| 42 | Percent point on UiMap 1412, 1423, 1433 or 1453 (including `StormwindClassic`, `EPLClassic`) | read in the running client's (Forever) frame | frame from `options.changedZoneFrame`; `RXP030-frame-ambiguous` warning | 06:L02 |
| 43 | `StormwindNew` / `EPLNew` | converted to the classic map | no point; `RXP036-pseudo-zone-unconverted` warning | 06:L03 |
| 44 | World-form point outside the named UiMap | element dropped | `RXP035-goto-outside-map` warning when geometry is available | — |
| 45 | Nested or unbalanced parentheses, `!` separated from its word, number-like words (`1e1`, `0x10`) | 6.2, 6.3 | reproduce; `RXP016-filter-quirk` info | — |
| 47 | Empty filter alternatives (`Orc/`, `/Orc`, `Orc//Troll`, `/`), an alternative without words (` - `), a group written against a word (`Orc(Warrior)`) | empty alternatives ignored, none left = false; word-less = true; merged word never matches (6.2) | reproduce (AST in 6.2); `RXP016-filter-quirk` info | — |
| 46 | Filtered `.goto` (location or waypoint), closest-point location, radius objective that is not the last `.goto` | 10.1 | 12.4; `RXP034-not-simulated` info | 06:L04 |

### 11.1 Diagnostic registry

Codes follow the project grammar `FAMILYnnn-slug` (ARCH §9.4) and are registered in
`src/validate/codes.ts` with the other families; this table is their definition (ARCH §10 step
3). Numbers are never reused: `RXP008` and `RXP023` are unassigned, and `RXP033` is retired.

Parser diagnostics are their own type, not `ValidationIssue`, because they describe text rather
than steps (ARCH §10 step 3):

```ts
interface RxpDiagnostic {
  code: string;                              // e.g. 'RXP001-unknown-command'
  severity: 'info' | 'warning' | 'error';    // IssueSeverity
  importId: string;                          // RxpImport.id
  line: number;                              // 1-based physical line
  column: number;                            // 1-based, in Unicode code points
  rxpCompat: boolean;                        // true: RestedXP would drop or change this line
  message: string;
}
```

`line` counts physical lines of the import text, or of the Lua file for wrapped guides (section
3.2 rule 5). The UI lists these diagnostics alongside the `ValidationIssue`s and says what
`rxpCompat: true` means.

| Code | Severity | Stage | rxpCompat | Meaning |
|---|---|---|---|---|
| `RXP001-unknown-command` | warning | CST | yes | command name not in our list |
| `RXP002-stray-line` | warning | CST | yes | line with no recognised prefix |
| `RXP003-goto-missing-zone` | error | lowering | yes | `.goto` whose first argument is a number |
| `RXP004-malformed-number` | error; warning where RXP keeps the element (extra characters in a `.xp` expression, a `.xp` skip flag that is not a number, 9.4) | lowering | yes | a number RXP cannot read, or one the route model cannot hold (a quest ID of 0 or less where RXP gives it no meaning, 12.3; a world-form UiMapID that is not a positive safe integer, 10.4; a `.xp` level or offset beyond the safe-integer range, 9.4) |
| `RXP005-empty-field` | warning | CST | yes | empty argument field collapsed |
| `RXP006-filter-before-text` | error | CST | yes | `<<` before `>>` on one line |
| `RXP007-inline-comment` | info | CST | yes | `--` cuts `>>` text or a rest-of-line argument |
| `RXP009-localized-zone-name` | error | lowering | yes | zone key not in the English key table |
| `RXP010-step-prefix` | warning | CST | yes | line starts with `step` but is not `step` or `step <<…` |
| `RXP011-step-typo` | warning | CST | yes | stray or filtered-out line that looks like `step` |
| `RXP012-unknown-tag` | warning | CST | yes | unknown or typo'd tag key |
| `RXP013-shadowed-tag` | info | CST | yes | later duplicate of a first-wins tag |
| `RXP014-function-tag` | info | CST | no | `#key = functionName`, kept opaque |
| `RXP015-header-command` | warning | CST | yes | command before the first step |
| `RXP016-filter-quirk` | info | CST | yes | double `<<`, unknown filter word, parenthesis or `!` oddity, number-like word, empty alternative or no alternative left, alternative without words, group written against a word (6.2) |
| `RXP017-command-case` | warning | CST | yes | command known only in another case |
| `RXP018-missing-text` | error | lowering | yes | command whose `>>` text is required |
| `RXP019-protected-format` | error | unwrap | no | protected import string; input refused |
| `RXP020-lua-dynamic` | warning | unwrap | no | non-literal `RegisterGuide` argument; call skipped |
| `RXP021-lua-guard-ignored` | info | unwrap | no | top-level Lua other than registration calls |
| `RXP022-unterminated-comment` | warning | CST | yes | comment on a last line without a line break |
| `RXP024-other-game` | warning | CST | yes | only other games' tags in the header |
| `RXP025-missing-name-or-group` | error | CST | yes | `#name` or `#group` missing |
| `RXP026-bom` | info | CST | no | UTF-8 byte-order mark |
| `RXP027-classic-header` | info | CST | no | `#classic` without `#forever` |
| `RXP028-level-filter` | info | lowering | no | level words evaluated at the route's start level |
| `RXP029-convertquest` | warning | lowering | no | quest IDs remapped for the rest of the guide |
| `RXP030-frame-ambiguous` | warning | lowering | no | percent point on 1412/1423/1433/1453; frame from the import option |
| `RXP031-objective-out-of-range` | warning | lowering (dataset lookup) | no | `.complete` index beyond the quest's objective count |
| `RXP032-objective-unchecked` | info | lowering (dataset lookup) | no | `.complete` on a custom or unknown quest |
| ~~`RXP033-xp-approximated`~~ | — | — | — | **Retired**: `.xp L-N` and `.xp L.F` now lower exactly to `GrindTarget` offsets (12.3); malformed `.xp` expressions are `RXP004`. The number is not reused. |
| `RXP034-not-simulated` | info | lowering | no | construct kept for export, approximated or ignored by the engine (12.6) |
| `RXP035-goto-outside-map` | warning | lowering (geometry lookup) | yes | world point outside the named UiMap |
| `RXP036-pseudo-zone-unconverted` | warning | lowering | no | `StormwindNew`/`EPLNew` point; no location |
| `RXP040-group-split` | info | export | no | a group exported as several RXP steps (13.6) |
| `RXP041-app-fields-not-exported` | info | export | no | once per export: counts of fields with no RXP form (13.6) |
| `RXP042-unrepresentable-step` | warning | export | no | step emitted as a `>>` note (13.6) |
| `RXP043-header` | info | export | no | header generated, or headers of other imports dropped |
| `RXP044-text-dropped` | info | export | no | `>>` texts of merged `.complete` lines after the first, when the step was rebuilt |
| `RXP045-comment-dropped` | info | export | no | comment attached to a deleted line |
| `RXP046-wrapper-args` | warning | export | no | raw export of a guide imported from the two/three-argument Lua form |

Dataset and geometry lookups add diagnostics only; they never change the lowered model (12.1).

---

## 12. Lowering to the route model

### 12.1 Contract (ARCH §8.1, §10 step 4; D-020)

- Lowering maps the Layer-1 CST of one guide to `RouteGroup`s and `RouteStep`s. It is
  deterministic and depends only on the guide text, `options` and the zone-key table. It never
  reads the dataset, geometry or ruleset; those are consulted through injected lookups for
  diagnostics only (`RXP031`, `RXP032`, `RXP035`).
- Each RXP step becomes exactly one `RouteGroup` with `rxp.importId`, `rxp.stepIndex` (0-based,
  in source order, before any load-time filtering) and its atomic steps, in source order. Filtered
  and empty steps are lowered too; filters are evaluated later by the engine.
- An RXP step that yields no atomic step (only tags, conditions, waypoints and annotations, or
  nothing) gets one **carrier** `note` step (`text: ''`, `preserved: { format: 'rxp', lines: [] }`)
  so that the group keeps its place in the route. No other note has an empty `lines` array.
- Steps get IDs from the injected `IdSource` and `origin = { source: 'rxp', ref: importId }`.
- A command line's `>>` text goes to `step.rxp.text`; its line filter to
  `step.condition = { filter, variant: null, skipIf: [] }`; its source line to `step.rxp.line`.
  For note lines (`>>`, `+`, `*`) the text is `note.text` and `rxp.text` is null.
- The header (lines before the first step) is not lowered. It stays in `project.imports[].text`
  and export reuses it (13.6).

### 12.2 Source references and sidecar shapes

The shapes are defined in `src/domain` (ARCH §8.1); the `.ts` files are authoritative. Summary:

```ts
// src/domain/route.ts
interface SourceLineRef { importId: string; firstLine: number; lastLine: number }
interface RxpTag { name: string; value: string | null;                  // name without '#'
                   assignment: boolean; line: SourceLineRef | null }
interface Waypoint { point: SourcedPoint; role: 'leg' | 'pin' | 'closest'; radius: number | null;
                     filter: FilterAst | null; line: SourceLineRef | null }
interface RxpCommandNode { command: string; args: string[]; text: string | null;
                           filter: FilterAst | null; line: SourceLineRef | null }
interface PreservedSource { format: 'rxp'; lines: string[] }
// src/domain/conditions.ts
interface StepCondition { filter: FilterAst | null; variant: VariantTag[] | null; skipIf: StatePredicate[] }
interface VariantTag { name: string; value: string | null; filter: FilterAst | null }
type StatePredicate =
  | { kind: 'questState'; state: 'onQuest' | 'complete' | 'turnedIn' | 'available';
      questIds: QuestId[]; match: 'any' | 'all'; negate: boolean }
  | { kind: 'levelAtLeast'; level: number; xp: number | null; negate: boolean }
  | { kind: 'opaque'; raw: string };
// src/domain/project.ts
RxpImport.options: { changedZoneFrame: 'forever' | 'era';
                     lua: { groupArg: string | null; defaultFor: string | null } | null }
```

Schema version 1 is frozen from the Milestone 4 commit (D-035): a change to these shapes bumps
`schemaVersion` and adds a migration.

How lowering fills them:

- **`SourceLineRef`:** 1-based physical lines of `imports[].text`, inclusive. `firstLine ===
  lastLine` except for merged `.complete` steps (12.3). Steps carry it in `rxp.line`, annotations
  in `line`.
- **`RxpTag`:** `name` is the key without `#` (maximal, so `#key=value` gives the name
  `key=value`, P8b). `value` is the rest of the line after the optional `=`, or null when it is
  empty. A later tag with the same name is shadowed (first wins); that follows from the order.
  `assignment` is true for the `#key = name` form (`RXP014`); `line` is the tag's source line.
- **`Waypoint`:** `role` from the table in 10.1 (`.waypoint` → leg, `.pin` → pin); `radius` as
  written (positive, 0 or negative), or null; `filter` the line filter (12.4 rule 4); `line` the
  source line.
- **`RxpCommandNode`:** `command` is the name without the dot, `args` the fields after the
  separator split and the empty-field collapse (S6), `text` the `>>` text or null, `filter` the
  line filter, `line` the source line.
- **`PreservedSource`:** `lines` holds the physical source line(s) exactly as written, without
  line endings. The note's `text`, for display, is the **canonical code** of the line: what RXP
  reads (the comment left out) in canonical spelling (13.4 rules 4-13, without indentation), or
  the trimmed content when the line has no canonical form (a tab inside it). Using the canonical
  spelling rather than the line as written keeps the model the same when a guide is re-indented
  or canonicalised (the idempotence obligation of 13.7). Why a line was preserved
  (unknown command, stray line, opaque or unmodelled command) is carried by its diagnostic
  (`RXP001`, `RXP002`, `RXP034`), not stored. A carrier note has `lines: []` (12.1).
- **`VariantTag`:** a load-time tag is `{ name, value }` as for `RxpTag` (`{ name: 'xprate',
  value: '<1.5' }`, `{ name: 'softcore', value: null }`). A command entry keeps the leading dot,
  so it cannot collide with a tag name: `{ name: '.dungeon', value: 'RFC' }`, and likewise
  `.group`, `.solo` and `.profession` with their raw arguments as `value` (null when none). The
  implicit entry of `.deathskip` is `{ name: 'softcore', value: null }`; it has no line of its own.
  `filter` is the line filter of the tag or command line (the implicit entry takes the filter of
  the `.deathskip` line).
- **`StatePredicate`:** mapped from the section 9.2 commands as in the table below. Lowering
  always writes `match: 'any'`: RXP's multi-ID `.is*` lines hold when **any** of `questIds` is in
  that state (this answers Q12). An `opaque` predicate's `raw` is the canonical code of its line
  (as for preserved notes above), so it includes the line filter when there is one.
- **`RxpImport.options.changedZoneFrame`:** the frame for percent points on the four changed
  UiMaps (10.4). **`RxpImport.options.lua`:** null for raw text; for a guide extracted from a Lua
  file, the group and defaultFor arguments of its `RegisterGuide` call (each null when absent).

| RXP line (section 9.2) | `StatePredicate` |
|---|---|
| `.isOnQuest ids` | `{ kind: 'questState', state: 'onQuest', questIds: ids, match: 'any', negate: true }` (skip when none is in the log) |
| `.isNotOnQuest ids` | `questState`, `onQuest`, `negate: false` |
| `.isQuestTurnedIn ids` | `questState`, `turnedIn`, `negate: true` |
| `.isQuestComplete id` | `questState`, `complete`, `[id]`, `negate: true` (skip unless it is in the log and complete) |
| `.isQuestNotComplete id` | `questState`, `complete`, `[id]`, `negate: false` |
| `.isQuestAvailable id` (one ID) | `questState`, `turnedIn`, `[id]`, `negate: false` (RXP skips once it is turned in and checks no prerequisites, D5) |
| `.xp L,S` or `.xp L+N,S` (S > 0) | `{ kind: 'levelAtLeast', level: L, xp: N or null, negate: false }` |
| `.xp <L,S` or `.xp <L+N,S` (S > 0) | the same with `negate: true` |
| `.maxlevel N` | `levelAtLeast`, `level: N + 1`, `xp: null`, `negate: false` (level > N) |
| jump forms (`.xp …,S,label`, `.maxlevel N,label`) | as the form without the label, plus `RXP034` (12.6) |
| anything else: `.isQuestAvailable` with several IDs, the `,account` forms, `.xp L-N,S`, `.xp L.F,S`, a negative `S`, `.money`, `.itemcount`, `.zoneskip`, `.subzoneskip`, `.bindlocation`, `.train id,1` / `,3`, `.istrained`, `.spellmissing`, `.skill` / `.reputation` with skip, `.questcount`, `.cooldown`, `.bronzetube`, …; a quest-state line with a quest ID of 0 or less (`RXP004`, 12.3); any skip line with a line filter (G1 below) | `{ kind: 'opaque', raw }`, `raw` being the canonical code of the line (without its comment). The engine evaluates it as `unknown` (section 14 row 5). |

RXP applies a level skip without `<` only while XP step skipping is on, and one with `<`
always (9.4). So the engine applies a `levelAtLeast` predicate with `negate: false` only when
`routeProfile.xpStepSkipping` is true, and one with `negate: true` always (section 14 row 5).

**Domain additions G1-G4 and their status.** The first revision proposed four additions. The
domain types above adopted most of them (in Milestone 1), and schema v1 is now frozen (D-035), so
the rest stay interim rules.

| # | Proposed addition | Status | Rule with the current types |
|---|---|---|---|
| G1 | `filter: FilterAst \| null` on `RxpTag`, `Waypoint`, `RxpCommandNode`, `VariantTag` and `StatePredicate` (line filters inside a step: 59 filtered `.goto` lines in RXP's Forever guides, 10.2) | **Adopted** for `Waypoint`, `RxpCommandNode` and `VariantTag`; **not** for `RxpTag` and `StatePredicate`. | Filtered waypoint, annotation and variant lines keep their filter in the model; a filtered variant entry applies only to characters whose filter holds (the first revision left such lines out of `variant`; superseded). A filtered skip line becomes an `opaque` predicate whose `raw` includes the filter (so `unknown`: active with a warning). A filtered tag is kept without its filter, with `RXP034` when lowering reads it (`#sticky`, `#completewith`). Every filter also survives in the source line. |
| G2 | `line: SourceLineRef` on `RxpTag`, `Waypoint`, `VariantTag` and `StatePredicate` (pairing template lines with sidecar entries, 13.5 rule 1) | **Adopted** for `RxpTag`, `Waypoint` and `RxpCommandNode`; **not** for `VariantTag` and `StatePredicate`. | Tags, waypoints and annotations pair with their template lines by `line`. Variant entries and predicates are compared as whole lists with those of the template group lowered again: an equal list keeps its template lines, a changed list is rebuilt from the model (13.5 rule 2). |
| G3 | `assignment: boolean` on `RxpTag` (`#key = name` versus `#key name`, P8b, `RXP014`) | **Adopted.** | A rebuilt tag writes `#key = name` when `assignment` is true (13.4 rule 5). |
| G4 | `lua: { form, level, groupArg, defaultForArg, fileLine } \| null` on `RxpImport.options` (the Lua wrapper export, 13.4 rule 14; `RXP046`; Lua-file line numbers after the import) | **Adopted in a reduced shape**: `lua: { groupArg, defaultFor } \| null`. | The wrapper export writes the one-, two- or three-argument form from `lua` (13.4 rule 14), and a raw export of a guide imported with group or defaultFor arguments gets `RXP046`. The string form and the long-bracket level are not kept (the wrapper chooses its own level). Diagnostics made during the import use Lua-file lines; later ones, from lowering the stored import again, use lines of `text`. |

**Superseded by `src/domain` (ARCH §8.1 revision 2):** the first revision's proposed shapes
(`key`, `kind` and `name` fields, `SourceLineRef { first, last }`, `options.percentFrame`, and
`shadowed`, `implicit` and `reason` fields). Shadowing follows from the order, an implicit
variant entry is recognised by having no template line, and the reason for preserving a line
is in its diagnostic.

### 12.3 Element lowering

| RXP line | Lowered to | Payload and rules |
|---|---|---|
| `.accept id[,flags[,req]]` | `accept` | `questId: id`, `anyOf: null`, `via: null`. `flags` and `requiredTurnIn` are not modelled (bit 2's conditional completion: `RXP034`); the source line keeps them for export. An `id` of 0 or less has no meaning for `.accept` in RXP, and negative quest IDs are reserved for the user's own custom quests (ARCH §5.5): the line is `RXP004` (error) and a preserved note. |
| `.acceptmultiple` / `.daily ids` | `accept` | `questId: ids[0]`, `anyOf: ids`: done when any one is accepted. An ID of 0 or less: `RXP004`, preserved note (as for `.accept`). |
| `.turnin id[,reward[,flags]]` | `turnin` | `questId: abs(id)`, `skipIfMissing: id < 0`, `rewardIndex`: `reward` as RXP writes it (1-based; the dataset has no reward lists to index), null when absent, 0, or `id < 0` (RXP then ignores it). `.turnin -id,reward` also skips an incomplete quest in RXP: not modelled (`RXP034`). `via: null`. |
| `.turninmultiple` / `.dailyturnin` | `turnin` | `questId: ids[0]`, `anyOf: ids`, `rewardIndex: null`, `skipIfMissing: false`, `via: null`: done when any one is turned in (0 uses in Forever guides). An ID of 0 or less: `RXP004`, preserved note (as for `.accept`; only the single-quest `.turnin` gives a negative ID a meaning). First revision: a preserved note with `RXP034`; superseded by `turnin.anyOf` (ARCH §8.1 revision 2). |
| `.complete id,obj[,max[,flags]]` | `complete` | target `{ questId: abs(id), objective: obj − 1 }`. **Consecutive** `.complete` lines (no other element line between them; comments and blank lines allowed) with the same line filter (the same meaning: the parsed filter ASTs are compared, so `<< Orc/Troll` and `<< Orc / Troll` are the same filter and canonicalisation cannot change the merge) and the same blocking status merge into one step with several targets in source order; `rxp.text` is the first merged line's text and `rxp.line` spans the merged lines. `id < 0` and `max` are not modelled (`RXP034` for `id < 0`). |
| `.collect item,qty,questId[,objFlags…]` | `complete` | one target per set bit of `objFlags` (bit value 2^(k−1) → `objective: k − 1`), or one target with `objective: null` when `objFlags` is absent or 0. Never merged with `.complete` lines. |
| `.collect item,qty` (no quest) | `preserved` | inventory objective, `RXP034`. |
| — | — | **`progress`** of a `complete` step: `'partial'` when the group has `#sticky` or `#completewith`, when the line is text-only (odd `flags`; `.collect` flag 1), or when a `.disablecheckbox` follows it; otherwise `'finish'`. |
| `.abandon ids` | `abandon` | one step per ID, in order. |
| `.goto` | `location`, `travel`, `waypoint` | section 12.4. |
| `.zone`, `.subzone`, `.explore` | `travel` | `mode: 'auto'`, `transport: null`, `location: null` (a zone or area is not a point). The destination survives through the source line. The engine sets the position to unknown until a step with a resolvable location (ARCH §8.1). |
| `.hs` | `hearth` | `mode: 'use'`. |
| `.home [areaId]` | `hearth` | `mode: 'bind'`; the bind point is the step's location. `areaId` survives through the source line. |
| `.fp name[,flags]` | `flight` | `mode: 'discover'`, `nodeQuery: name`, `from: null`, `to: null`. |
| `.fly name` | `flight` | `mode: 'take'`, `nodeQuery: name`, `from: null`, `to: null`. The engine resolves `nodeQuery` to a `TaxiNodeRef { npcId, taxiNodeId, name }` from dataset flight masters, cited TaxiNodes ids for new Forever nodes that have no dataset NPC, and taxi data when it has them (ARCH §9.1); lowering never does. |
| `.xp L` | `grind` | `until: { kind: 'level', level: L, offset: null }`; `mobLevel: null`, `xpPerHour: null`. |
| `.xp L+N` | `grind` | `until: { kind: 'level', level: L, offset: { kind: 'xpInto', xp: N } }`. |
| `.xp L-N` | `grind` | `until: { kind: 'level', level: L, offset: { kind: 'xpShort', xp: N } }`: N XP short of level L. |
| `.xp L.F` | `grind` | `until: { kind: 'level', level: L, offset: { kind: 'fraction', fraction: 0.F } }`: the digits after the dot read as a decimal fraction (`10.5` → 0.5, `10.25` → 0.25). The engine resolves every offset with the ruleset's XP table (ARCH §8.1); `src/rxp` needs no XP data. First revision: `{ level: L, xp: null }` with `RXP033`; superseded, and `RXP033` is retired. |
| `.xp` with `<` and/or a skip flag | `skipIf` | 12.2 (predicate table), 12.5. |
| `.train id[,flags]` | `train` | `spellId: id`; `skill`, `skillId`, `rank`, `what`, `cost`: null. With flag bit 1 set: `skipIf` instead. Lowering never infers `skill: 'riding'`: the engine recognises riding from the ruleset's riding spell table (ARCH §9.1), so an imported `.train 33388` enables mounted travel. |
| `.trainer [npc]` | `train` | all payload fields null. |
| `.vendor [npc]` | `vendor` | `what: null`. |
| `>>text` (note line) | `note` | `text`, `preserved: null`. |
| `+label` | `note` | `text: label`. Blocking in RXP: the simulator auto-ticks it and records an assumption (Q7). |
| `*label` | `note` | `text: label`, with `\n` kept as written. |
| `+label >>text` | `note` | `text: text` (RXP shows only the text and does not block, P8e). |
| stray line | `preserved` | `note` with `preserved: { format: 'rxp', lines: [line] }` (12.2); `RXP002`. |
| unknown command | `preserved` | as above; `RXP001`. |
| section 9.7 commands and other `preserved` entries of section 9 | `preserved` | as above; `RXP034` for route-relevant ones (section 9.7, **Route relevance**); the others get no diagnostic. |
| `.target`, `.mob`, `.unitscan`, `.use`, `.usespell`, `.cast`, `.link`, `.clicknext`, `.macro`, `.timer`, gossip commands, `.equip`, `.itemStat`, `.aura`, `.buy`, `.line`, `.loop`, `.questgoto`, `.wpradius`, … | `annotation` | `RxpCommandNode`, in source order. |
| `.disablecheckbox` | `annotation` | also sets `progress: 'partial'` on a directly preceding `complete` step; no model effect on other kinds. |
| `.dungeon`, `.group`, `.solo`, `.profession` | `variant` | 12.5. |
| `.is*`, `*skip`, `.money`, `.itemcount`, `.maxlevel`, `.bindlocation`, `.questcount`, `.istrained`, `.spellmissing`, `.cooldown` (condition form), `.skill` / `.reputation` with skip | `skipIf` | a `StatePredicate` per line (12.2 table), 12.5. |
| `.convertquest src,dst` | `annotation` | later lines of this guide are lowered with `src` replaced by `dst`; `RXP029`. |
| `.deathskip` | `preserved` | `RXP034`, plus an implicit `softcore` variant entry, because RXP marks its step softcore. The engine sets the position to unknown after it, until a step with a resolvable location (ARCH §8.1). |

### 12.4 Location, travel and waypoints

1. **Location.** The steps' location is the **last `.goto` of the RXP step that has no line
   filter and yields a point** (ratified in ARCH §10 step 4, which refers here for the
   filtered, closest-point and radius-objective cases). Every step of the group gets the same
   `Location { source, label: null, radius }`, where `radius` is the line's radius when it is
   positive and null otherwise (10.4). Without such a `.goto` the location is null.
2. **Travel.** If that location line is a travel objective (`R > 0`, no flag), it also lowers to
   a `travel` step (`mode: 'auto'`, `transport: null`) at the position of that line, so the travel
   has its own step for duration and optimiser binding. Other location forms create no step.
3. **Waypoints.** Every other `.goto` that yields a point, and every `.waypoint` and `.pin`,
   becomes a `Waypoint` in source order, with the role from the table in 10.1 (`.waypoint` →
   leg, `.pin` → pin) and its radius. A non-final radius objective becomes a leg with `RXP034`
   (RXP makes it a required visit; 14 lines in RXP's Forever guides).
4. **Filtered gotos.** A `.goto` with a line filter is never the location. It becomes a
   waypoint that carries its filter (`Waypoint.filter`, 12.2 G1), so the engine can apply it per
   character; the filter also survives in the source line. `RXP034` notes that the line is never
   the location, and, when the last `.goto` of the
   step is filtered (20 steps in RXP's Forever guides; in 9 of them every `.goto` is filtered),
   that the location from rule 1 is not character-specific. One `RXP034` per line.
5. **Closest point.** If the location line is a closest-point `.goto` (radius < 0; 28 steps),
   the location is that point, the other closest points are `closest` waypoints, and `RXP034`
   notes that RXP points at whichever is nearest.
6. A `.goto` that yields no point (`RXP003`, `RXP004`, `RXP009`, `RXP036`) is neither location nor
   waypoint; it survives through the source lines.
7. A positive radius on the location line is `Location.radius` (ARCH §6). Its 6th-position
   flag, and a radius of 0 or less, are not part of `Location`; export keeps them from the source
   line (13.5 rule 3). The first revision kept the radius only in the source line; superseded.
8. The engine routes travel to a step's location through its group's `leg` waypoints in order,
   since they encode the author's path (ARCH §9.2). That is RXP's meaning too: legs are visited
   in order before the location. This answers Q9.

### 12.5 Group condition and tags

- `group.rxp.condition = { filter, variant, skipIf }`, where `filter` is the step line's filter,
  `variant` holds the load-time tags (8.1) plus `.dungeon`, `.group`, `.solo`, `.profession` lines
  and implicit entries (`.deathskip` → `softcore`) as `VariantTag`s (null when there are none),
  and `skipIf` holds the skip predicates (9.2) as `StatePredicate`s (12.2 table), each list in
  source order.
- In RXP, a predicate or variant line with its own line filter applies only to characters whose
  filter passes (RXP drops the line for the others). Variant entries carry their filter
  (`VariantTag.filter`); predicates cannot, so a filtered predicate line becomes `opaque` (G1 in
  12.2).
- `group.rxp.tags` holds every other step tag as an `RxpTag` (8.1), including duplicates
  (shadowed by order, `RXP013`), unknown keys (`RXP012`) and `#key = name` (`RXP014`).
- `#sticky` and `#completewith` also make the group's `complete` steps `partial` (12.3).
- `group.rxp.waypoints` and `group.rxp.annotations` hold 12.4 waypoints and 12.3 annotations,
  each in source order.
- The engine applies group-level conditions and variant entries to all steps of the group
  (ARCH §9.2; section 14).

### 12.6 Constructs the engine approximates or ignores (`RXP034-not-simulated`)

Each is kept for export through its source line. The message names the construct and the
approximation:

| Construct | Engine behaviour |
|---|---|
| `.collect` without a quest; `.stable`, `.tame`, `.destroy`, a blocking `.cast`, `.skill` / `.reputation` objectives | preserved note; no state change, no time unless overridden |
| `.deathskip` | preserved note; the engine sets the position to unknown after it (ARCH §8.1) |
| `.turnin -id,reward` | skipped when missing; an incomplete quest is not skipped |
| `.complete -id,…` | the skip-if-not-on-quest rule is ignored |
| `.accept id,2,req` | conditional completion ignored |
| jump forms (`.xp …,S,label`, `.maxlevel N,label`, `.skipto`) | treated as a skip of the group |
| non-final radius-objective `.goto`; filtered `.goto`; closest-point location | 12.4 rules 3-5 |
| a filtered `#sticky` / `#completewith` (the step is treated as sticky for every character) | 12.2, G1 |

`.turninmultiple` and `.dailyturnin` were in this table in the first revision; they now lower
to `turnin` with `anyOf` (12.3).

### 12.7 Superseded: the first-revision container model

The first revision recommended keeping the RXP step as one container `RouteStep` holding an
ordered list of actions (`AcceptQuest`, `CompleteObjective`, `TurnInQuest`, `Travel`, `Grind`,
`Hearth`, `Flight`, `Train`, `Vendor`, `Note`, plus a new `AbandonQuest`), waypoints,
conditions and annotations, with step-level fields `sticky`, `completeWith`, `label`, `requires`,
`optional`, `hideWindow`, `loop`, `minLevel`, `variantFilters`, `include`, `mapHint`,
`arrowText` and `unknownTags`. **Superseded by D-020 and ARCH §8.1**: atomic steps plus the
`route.groups` sidecar. The old action names map onto the step kinds `accept`, `complete`,
`turnin`, `travel`, `grind`, `hearth` (with `mode`), `flight`, `train`, `vendor`, `note` and
`abandon`; the step-level fields become `RxpTag`s and group-condition entries (12.5). The earlier
plan to "map `.complete` indices with a warning when a quest mixes objective types" is withdrawn:
ARCH §5.4 fixes the index order.

---

## 13. Export and serialization

### 13.1 Two properties

- **Layer 1** (CST printer, ARCH §10 step 2): `print(parse(x)) === x` for every input, including
  a BOM, mixed line endings, trailing whitespace and a missing final newline.
- **Layer 2** (route → guide text, ARCH §10 step 5): the export guarantee in 13.3. The first
  revision's "lossless mode" (edited lines emitted in canonical form with their original
  indentation and line ending) is **superseded by ARCH §10 step 5**: the unit of reuse is the
  group, and edited groups are fully canonical.

### 13.2 Fingerprints and "unedited"

- At import, each group's `fingerprint` is the SHA-256 (lowercase hex) of the canonical JSON
  (object keys sorted, no insignificant whitespace) of its **RXP content**: the group sidecar
  without `fingerprint`, then for each of its steps in route order: `kind`, the kind's payload
  fields, `location.source` (with `uiMapId` and lexemes), `location.radius`, `condition`,
  `rxp.text` and `rxp.line`. Step `id`,
  `locked`, `note`, `durationOverride`, `origin`, `ext` and `location.label` are excluded because
  they have no RXP form. SHA-256 is computed in pure TypeScript (no WebCrypto), so `src/rxp`
  stays synchronous and pure (ARCH §17).
- A **group run** is *unedited* when its steps are contiguous in the route, they are all of the
  group's steps, and the fingerprint recomputed over them equals the stored one. A run whose RXP
  content (the canonical JSON above) equals that of its template group lowered again (13.5) is
  unedited too: its original lines are then exactly what the model says, whatever the stored
  fingerprint. The serializer checks this first, because comparing canonical JSON is much
  cheaper than SHA-256 in pure TypeScript, and hashes only a run whose content differs (edited,
  or lowered differently since the import, for example after the zone-key table changed).
- An **import** is *unedited* when the route consists of exactly that import's groups, each
  unedited, in their original order.

### 13.3 The export guarantee (ARCH §10 step 5)

1. **Unedited import:** the output is `imports[i].text`, byte for byte (BOM, line endings,
   comments and blank lines included). For a Lua-wrapped import, `text` is the extracted guide
   string, so the guarantee covers the guide text; a wrapper is added only on request (13.4 rule
   14; `RXP046` when the original call had group or defaultFor arguments and the export is raw).
2. **Otherwise:** the header (13.6), then the groups in route order. Each unedited group run is
   emitted from its original physical lines, byte for byte: from its `step` line up to the line
   before the next `step` line, so comments and blank lines at the end of a step belong to it.
   Those lines keep their original endings, so the output may mix CRLF and LF; RXP accepts both
   (P3).
3. Edited groups, split groups and app-created steps are emitted in canonical form (13.4-13.6).

### 13.4 Canonical form

1. **Encoding and lines:** UTF-8 without BOM, LF endings, exactly one final LF, no trailing
   whitespace on any line, no tab characters.
2. **Order is never changed** except where 13.5 says so. Element order is semantic (parent
   links, `.timer` latching, waypoint sequence, first-wins for tags, `.disablecheckbox`). A
   separate, explicit `normaliseHeaderOrder()` transform (for new guides only) may stable-sort
   header keys in this order: game tags, `<< enabledFor`, `#name`, `#displayname`, `#version`,
   `#group`, `#subgroup`, `#defaultfor`, `#next`, other keys; lines with the same key keep their
   relative order because first applicable wins.
3. **Layout:** header lines at column 0; one blank line between the header and the first step;
   no blank lines inside or between steps; `step` at column 0; every body line indented 4 spaces.
4. **Step line:** `step` or `step << FILTER`.
5. **Tag line:** `#key value` (one space; no space if the value is empty); `#key = name` for the
   assignment form; ` << FILTER` appended when present.
6. **Command line:** `.` + name, then if there are args: one space + args joined by the
   command's separator with no spaces (`,`, or `;` for `.mob/.target/.unitscan`; the raw rest-arg
   for `.link/.clicknext/.setquestdb`), then ` >> TEXT` if there is text, then ` << FILTER` if there
   is a filter.
7. **Note lines:** `>> TEXT`, `+LABEL`, `*LABEL`, each optionally followed by ` << FILTER`
   (`+LABEL >> TEXT` keeps both parts, although RXP then only shows TEXT).
8. **Points and numbers:** a point written from the model uses `Location.source`.
   - A point with lexemes (it came from the import) keeps its space and its lexemes: zone form
     with its UiMapID, or world form `<uiMapId>/<mapId>,<Y>,<X>` with the stored `uiMapId`
     (ARCH §6 revision 2). So an edited or split group keeps the author's UiMapID; the first
     revision could recover it only from the source line, which is superseded.
   - A point without lexemes was created or moved in the app. It is written in **world form**
     `.goto <uiMapId>/<mapId>,<Y>,<X>` with 2 decimals. The UiMapID is the world point's own
     `uiMapId` when set, a zone point's `uiMapId`, and otherwise the smallest committed frame that
     contains the point (ties: the lowest ID).
   - A zone point that geometry cannot place stays in zone form with its UiMapID and 2 decimals.
     A world point with `uiMapId: null` that no committed frame contains has no RXP form: its
     line is emitted as an `RXP042` note.

   Other edited or new numbers: integers without decimals; decimals in shortest round-trip form,
   no exponent, no leading `+` (except the `+` operator in `.xp L+N`). `-0` is written `0`.
9. **Operator arguments** are rebuilt from their structure: `.xp [<]L[+N|-N|.F]` (from the
   `GrindTarget` offset: `xpInto` → `+N`, `xpShort` → `-N`, `fraction` → `.F`),
   `.money <G|>G`, `.itemcount ids,[<|>][=]N`, `#xprate <R|>R|R1-R2`, `.questcount [<|>]N[*]`.
10. **Filters** are rebuilt from the AST: alternatives joined by `/`, terms by one space, `!`
    directly before its word or `(`, parentheses kept, **word spelling kept exactly** (race and
    faction words are case-sensitive in RXP). Never reorder, deduplicate or simplify words. The
    special shapes of 6.2 are written so that they read back the same: an alternative without
    words (`and []`) as `-`, no alternative left (`or []`) as `/` (inside a group, `(/)`), and a
    merged word with its spelling (`Orc(Warrior)`).
11. **Comments:** a full-line comment is emitted on its own line at the indentation of the
    context (0 in the header, 4 in a step) as `-- text` (the original text after `--`, trimmed).
    A trailing comment is emitted after all other parts as ` --text` with its original text
    (trailing whitespace removed), also when the line itself is rebuilt from the model (13.5
    rule 2). A tab inside a comment is written as a space: comments carry no RXP meaning, so this
    is the one place where canonical output changes content instead of refusing it (a tab
    anywhere else is refused, rule 12).
12. **Unrepresentable content is an error, never silently changed.** The serializer refuses
    (with the node and reason) when: any text, label, tag value or arg contains `--` (except a
    `.link` URL, where each `-` of a `--` is written `\-`), `<<`, a line break, or (for args) the
    command's separator; a text starts with `<<`; a filter word is not `[A-Za-z0-9]+` (or a
    merged word, 6.2); an arg is empty; a command name contains whitespace; `.goto` has no zone;
    any text, label, tag value, arg or filter holds a tab.
13. **Opaque nodes** (unknown commands, 9.7 commands, stray lines, `#key = fn`) are emitted as
    their trimmed raw content with canonical indentation.
14. **Lua wrapper output** (optional): `RXPGuides.RegisterGuide(` + optional group and
    defaultFor string arguments from `options.lua` (12.2 G4; with `lua: null`, or neither
    argument set, the one-argument form is written) + a long bracket `[=*[` + LF + canonical text +
    `]=*]` + `)` + LF per guide, using the smallest bracket level whose closing sequence does not
    occur in the text (level ≥ 1 if the text contains `[[`), guides separated by one blank line.
    Guards and other Lua from the input are not emitted.
15. **Derived text is never written back.** Default texts (`Accept *quest*`, "Go to …") are
    runtime rendering, not source. A missing `>>` stays missing, except for commands whose text
    is required (13.6).

### 13.5 Emitting an edited group

The group's original lines, taken from `imports[importId].text`, are the template.

1. Every template line is assigned to one model element: a step through its `rxp.line`, an
   annotation through its `line`, or the steps' shared location (the location `.goto`, which is
   also the line of the `travel` step that 12.4 rule 2 may create). Tags and waypoints pair
   through their `line` as well. Variant entries and predicates have no `line` (12.2, G2): the
   serializer lowers the template group again and compares the two lists as a whole. Comment
   lines anchor
   to the next non-comment line; blank lines are dropped (13.4 rule 3); lines that lowered to
   nothing (for example an `RXP036` goto) are unchanged elements.
2. A line's element is **unchanged** when it equals what lowering that single line produces
   today. An unchanged line is emitted as the canonical form of its CST node (so radius, flags,
   zone tokens and lexemes survive). A changed element is rebuilt from the model, keeping what
   the template line holds and the model does not: the note prefix (`>>`, `+`, `*`), `.accept`
   flags and `requiredTurnIn`, `.complete` `objMax` and flags, the NPC ID of `.trainer` and
   `.vendor`, the area ID of `.home`, the `.fp` flags, and the line's trailing comment, which is
   written after the rebuilt line (13.4 rule 11). A deleted element's line is omitted, and so
   are the comments anchored to it (`RXP045`). A comment that cannot stay with a surviving line
   also gets `RXP045`: the trailing comment of a sidecar line dropped because its list changed,
   of a line rebuilt to nothing (an empty note, 13.6), or of a merged `.complete` line whose
   target was removed.

   The **text-only flag** follows the model's `progress`: a `partial` step outside a sticky
   group gets the flag (odd `.complete` flags, `.collect` flag 1), and a `finish` step loses it
   (an odd `.complete` flags value moves one step towards 0; a positive odd `.collect` flags value
   loses 1). When the template step was `partial` only because a `.disablecheckbox` follows it,
   the flags are left as they are, and a `finish` in the model is counted in `RXP041` (the
   `.disablecheckbox` annotation still makes the step partial in RXP).
3. If the steps' shared location changed (its `source` or `radius`), the location line is
   rebuilt from the model: the point by 13.4 rule 8, and the radius from `Location.radius`. When
   `Location.radius` is null, a template radius of 0 or less is kept (it is not an arrival
   radius, 12.4 rule 7) and a positive one is dropped. The template line's flag is written only
   after a radius. When the location's `travel` step was deleted (or moved away) but a positive
   radius stays, the line is written `.goto …,R,0`: the flag keeps the radius without making the
   line an arrival objective, which would create a travel step again on re-import (10.1).
4. **Order:** the `step` line (with the group filter) first. Non-step lines anchor to the nearest
   preceding step line in the template, or to the group start. Emit the lines anchored to the
   group start, then each step of the run **in route order**, each followed by the lines anchored
   to it. Lines anchored to a deleted step re-anchor to the nearest surviving preceding step.
   Steps without a template line (moved in, or created in the app) are emitted by 13.6 rules
   directly after the step that precedes them in the route.
5. A merged `complete` step whose targets changed is rebuilt as one `.complete` line per target;
   only the first carries `rxp.text`, and texts of later original lines are dropped (`RXP044`).
   Each rebuilt line keeps the trailing comment of the template line of its target.

### 13.6 App-created steps, splits and headers

- **Ungrouped steps** (`groupId: null`): each maximal run of consecutive ungrouped steps with
  deep-equal `location.source` and `location.radius` (a null location counts as a value) is
  emitted as one RXP step: `step`, the location line, then one line per step. The location line
  carries `Location.radius` when it is set; a `travel` step's destination without one gets
  radius 10 (our constant), because only a positive radius makes a `.goto` an arrival objective
  in RXP. When the run has no `travel` step, a positive radius is followed by the flag `,0`, so
  the radius is kept without making the line an arrival objective (a re-import would otherwise
  add a travel step the model never had, 10.1). The same rule applies to every location line
  written from the model without a template line.

  | Kind | Line |
  |---|---|
  | `accept` | `.accept id`; with `anyOf`: `.acceptmultiple ids` |
  | `complete` | one `.complete q,objective+1` per target; a `partial` step's RXP step gets `#completewith next`. A target with `objective: null` (all objectives) becomes one `.complete q,i` per objective, for i from 1 to n, when the export context knows the quest's objective count n > 0 (from the dataset or the project's custom quest); this is counted in `RXP041`. When the count is not known, the step is an `RXP042` note. It is never a refusal. A target that comes up twice is written once. |
  | `turnin` | `.turnin id[,rewardIndex]`, with `-id` when `skipIfMissing`; with `anyOf`: `.turninmultiple ids` (it has no reward or skip form, so `rewardIndex` and `skipIfMissing` then count in `RXP041`) |
  | `abandon` | `.abandon id` |
  | `travel` | the location line with its radius, nothing else; no location → `RXP042` |
  | `grind` | `.xp L`, `.xp L+N`, `.xp L-N` or `.xp L.F` from the offset (13.4 rule 9); `{ kind: 'duration' }` → `RXP042` |
  | `hearth` | `.hs >> Use the Hearthstone` (the text is required; `rxp.text` wins when set) / `.home` |
  | `flight` | `.fp query` / `.fly query`; `nodeQuery: null` → `RXP042` |
  | `train` | `.train spellId`; `spellId: null` → `.trainer` |
  | `vendor` | `.vendor`, with ` >> what` when `what` is set |
  | `note` | `>> text`; `preserved`: each of its `lines`, trimmed, with canonical indentation; a carrier (`lines: []`) emits nothing; a note whose text is empty or only whitespace emits nothing either (RXP drops `>>` without text) and is counted in `RXP041` |

  Every line gets ` >> rxp.text` when `rxp.text` is set and ` << filter` from `condition.filter`.
  `RXP042-unrepresentable-step` emits `>> (not representable in RXP) <kind>: <detail>` instead.
- **Fields without an RXP form** (`note`, `locked`, `durationOverride`, `ext`, `location.label`,
  travel `mode`/`transport`, train `skill`/`skillId`/`rank`/`what`/`cost`, grind
  `mobLevel`/`xpPerHour`, and `rewardIndex`/`skipIfMissing` of an any-of turn-in) are not
  exported; one `RXP041-app-fields-not-exported` per export gives their counts, together with
  the other lossy writes named in 13.5 and in this section (empty notes, all-objective targets
  written per objective, a `finish` step followed by `.disablecheckbox`, a `finish` step in a
  sticky group).
- **Split groups** (`RXP040-group-split`, one per group): each maximal contiguous run of a group
  is emitted as its own RXP step, and a run whose steps no longer share one location is split
  further at each change of location. Every run repeats the step filter, the variant entries,
  the skip predicates, the location line and the tags, except `#label`, which stays on the first
  run only (RXP resolves a duplicated label to the last step that carries it, 8.1). Lines
  anchored to the group start go with the first run; other lines go with the run that holds
  their anchor step.
- **Header:** if the route's first group belongs to an import, that import's header lines are
  emitted unchanged (the model cannot edit them); headers of other imports are dropped
  (`RXP043-header`). Without any import, a generated header is written: `#forever`,
  `#name <route name>`, `#version 1`, `#group <route name>` (`RXP043-header`); a route name that
  breaks 13.4 rule 12 is refused.

### 13.7 Test obligations

- Layer 1: `print(parse(x)) === x` for every fixture and for CR-only and mixed-ending variants
  generated in the test; whitespace fuzzing around separators does not change the semantic CST.
- Layer 2: importing and exporting every fixture unedited is byte-identical (for fixture 03, each
  extracted guide text).
- Canonical idempotence: `canon(parse(canon(x))) === canon(x)`, and lowering `canon(x)` gives the
  same groups and steps as lowering `x` (ignoring line references).
- Golden canonical files for every fixture; fixture 06 export cases X1-X5 (19.3).
- The pure end-to-end test of ARCH §15: fixture import → lower → walk → validate → export.

---

## 14. Runtime semantics: RXP and our engine

RXP rules are from `GuideWindow.lua` unless noted. "Ours" is the engine behaviour (ARCH §9.2,
§9.3), which works on atomic steps in route order.

| # | RXP behaviour | Ours |
|---|---|---|
| 1 | **Step completion:** a step is complete when every element is completed, skipped, or text-only (`679-688`). Steps whose elements are all text-only complete as soon as they become active. | Atomic steps run in route order; a group has no completion state of its own. |
| 2 | **Sequencing:** the current step is the first incomplete, non-sticky step. Sticky steps (`#sticky`, or any `#completewith`) before it stay active in parallel if their `#requires` is met and `level >= #level` (`819-848`, `1963`). | Sticky and `#completewith` groups are linearised at their source position. Their `complete` steps are `partial`: they cost their override or 0 s ("incidental"), and a later `finish` step of the same objective carries the work (ARCH §8.1, §9.3). A turn-in whose objectives were never finished warns "assumed completed incidentally". |
| 3 | **`#completewith next\|label`:** the sticky step is closed when the guide moves past the target step, or when the labelled sticky target has been skipped (`690-713`). `next` means the next step **after** load-time filtering (step indices are assigned after filtering, `1954-1955`). | Only the `partial` marking; the end of the window is not simulated. |
| 4 | **`#requires label`:** a step waits while the required step is active or its own requirement chain is unfulfilled (`860-870`). | Not simulated; a validator hook may warn when the required group comes later in the route (section 17). |
| 5 | **Skip conditions** mark the active step completed (they do not remove it). XP/level skips depend on the XP step skipping setting (default true). | `condition.skipIf` is evaluated once, against the walker state when the first step of the group is reached; if any predicate is true, every step of the group is inactive. A predicate the state cannot decide (every `opaque` predicate, for example `.cooldown`, `.aura`, or `.itemcount` without inventory) is `unknown`: the group stays active with a warning. A `levelAtLeast` predicate with `negate: false` (RXP's level skip without `<`, and `.maxlevel`) applies only when `routeProfile.xpStepSkipping` is true; one with `negate: true` (the `<` form) always applies (12.2). |
| 6 | **Load-time variant filters** (8.2) remove steps before indexing. | `condition.variant` is evaluated against the route profile before the walk; failing groups are inactive for the whole walk; unknown values (season `null`) give `unknown` → active with a warning. |
| 7 | **Guide end:** `#next` alternatives, first active one (`functions.lua:3846-3872`); `#loop` guides restart (`758-763`). | Not simulated: the route is the guide. |
| 8 | **Parent links:** a `.goto` without radius is linked to the previous objective (its exact show/hide behaviour in the map code was not traced: **UNVERIFIED**); `.timer` copies its duration onto its parent element, which starts the timer when it completes (`functions.lua:6585-6594`, `1257-1260`). | Annotations only; `.timer` durations are not simulated (a step's `durationOverride` is the user's tool). |
| 9 | **Hardcore:** `.deathskip` steps are softcore-only (`functions.lua:2874`). On non-Classic games, loading a guide forces it softcore and turns the hardcore setting off before steps are filtered (`1828-1840`), so under RXP's own rules a Forever route keeps `#softcore`/death-skip steps and drops `#hardcore` steps. | `routeProfile.hardcore` defaults to false, which matches RXP on Forever; setting it true is labelled as a deviation from RXP. |
| 10 | **Filters** are evaluated at parse time and cached (6.2). | Step and line filters are evaluated by `domain/conditions` (6.5); a group filter applies to all steps of the group. |

---

## 15. Forever-specific findings

### 15.1 How the addon recognises Forever

- The addon sets its game id to `FOREVER`, with max level 60, when the client's interface
  version is ≥ 16000 and < 20000 (`RXPGuides.lua:155`, `190-193`). The toc lists Interface
  `16001` and loads Forever files with `[AllowLoadGameType camelot]` (`RXPGuides.toc:1`, `46`,
  `66`). QuestieDB uses the same values (`docs/research/local-context.md` K7). Whether the local
  beta client (1.60.1.70009 per local-context K1) reports 16001 is **UNVERIFIED**.
- Forever DB files return early unless the game id is `FOREVER` (`DB/forever/db.lua:3`,
  `DB/forever/flightData.lua:3`, `DB/forever/quest.lua:3`).
- Forever has its own flight data (`DB/forever/flightData.lua`), dungeon list
  (`DB/forever/db.lua:122-175`), flight-point-by-zone table (`177-233`) and an empty quest
  conversion table (`DB/forever/db.lua:42-43`; `DB/forever/quest.lua:15`). None of this data is
  used by this project (D-019).

### 15.2 RXP's Forever guides (statistics only; not reusable, D-019)

- 13 files, 58 guides, all `RXPGuides.RegisterGuide([[ … ]])`, all with `#forever`; two groups,
  one per faction (`Guides/GuideList-forever.xml`; `Guides/Forever/*.lua`).
- 8,674 steps; 8,956 `>>` note lines; 502 `+` lines; 88 `*` lines; 0 unknown commands; 3 stray
  lines; 7 lines with empty argument fields; 3 commands before the first step (all counted with
  `.cache/experiments/rxp/classify.mjs`).
- Filter words used (count): classes (Warrior 1,020 … Priest 346), `skip` 232, `Undead` 224,
  `NightElf` 216, `Alliance` 209, `Tauren` 195, `Dwarf` 144, `Troll` 131, `Gnome` 122, `Orc` 117,
  `Human` 109, `Horde` 74, `sod` 36, **`Skyborne` 13**, `era` 4, `Sod` 3, `optional` 1,
  `Aliance` 1. No parenthesised filters and no double `<<` in real Forever guides.
- The Skyborne start guide uses Zephras Isle, UiMapID 2521 (QuestieDB
  `support/Forever/Zones/uiMapIdToAreaId.lua:113` maps 2521 → area 16593 "Zephras Isle").

### 15.3 Zone table cross-check

During Milestone 0 research, all 50 name → UiMapID pairs of RXP's Forever zone table
(`DB/forever/db.lua:45-96`) were found among the names in QuestieDB
`support/Forever/Zones/uiMapIdToAreaId.lua` comments at b6f5b07 (50/50, checked with a throwaway
script). So the QuestieDB-derived key table (10.3) accepts every zone key RXP's Forever guides
can use. The check is not repeated in CI, because it would need RXP data; the QuestieDB names are
validated on their own by `tools/questiedb`.

### 15.4 Quest IDs missing from QuestieDB Forever

The 58 Forever guides reference 1,035 distinct quest IDs in `.accept/.turnin/.complete`
(comments stripped). **293 are not keys of QuestieDB `data/Forever/foreverQuestDB.lua`
(b6f5b07; 4,244 quests)**. All 293 are ≥ 76,156, and **every** ID ≥ 76,000 used by the guides is
missing. 139 of them are all the quest IDs of the Skyborne guide (`RestedXP-Skyborne.lua`); the
other 154 come from the 12 old-zone guides. Some of the latter may be Season-of-Discovery IDs
inside `#season 2` or `<< sod` lines, or sit in `<< skip` steps; that was not separated. All 742
IDs below 76,000 are present. Implications: unknown quest IDs are validator warnings (ARCH §9.4),
the user can declare them custom quests with their real IDs (ARCH §5.5), and QuestieDB coverage
of new Forever content is tracked by the data research (docs/DATA_PROVENANCE.md).

### 15.5 Variants that Forever guides branch on

`#xprate` thresholds 1.1, 1.2, 1.49/1.5, 1.59, 1.99, 2.09/2.1 (1,136 tags); `#season 0`,
`0,1`, `1`, `2` (633 tags, incl. 259 × `#season 2`); `#softcore` 170, `#hardcore` 125, `#ah` 82,
`#ssf` 48. What season value a Forever realm reports, and whether Forever has hardcore or
self-found realms, is **UNKNOWN** here. The route profile exposes all of them (ARCH §8.2).

### 15.6 Beta caveat in the latest commit

The HEAD commit adds a warning to skip death-skips "for now on beta" in the Skyborne guide
(commit subject; `.deathskip` lines in `Guides/Forever/RestedXP-Skyborne.lua:534`, `654`, `1851`).
Why is not stated (**UNKNOWN**). Treat `.deathskip` as a route variant the user can disable.

---

## 16. Documentation versus code discrepancies

| # | Documentation (custom-guides page / sheet, 2026-09-25) | Code at c3429e0 | We follow |
|---|---|---|---|
| D1 | `<< tbc << wotlk` "skips step if server is not on a tbc or wotlk patch" (OR) | The second `<<` is only a separator: `tbc AND wotlk`, never true (`GuideLoader.lua:50-89`, `873`) | code |
| D2 | `.collect,itemId,n,questID,skipifTurnedin` | The name must be followed by whitespace (`.collect,…` is an unknown command); 4th arg is `objFlags`, 5th `flags`; completes on turn-in **by default** (flag 16 disables) (`functions.lua:2941-2983`) | code |
| D3 | `#phase1-4`, `#phase5` | Tag name is `phase`, value `N` or `N-M`: `#phase 1-4`; `#phase1-4` is an unknown tag (`GuideLoader.lua:880`; `RXPGuides.lua:2391-2415`) | code |
| D4 | `.accept id,n,nid` | `flags` (1 no auto-accept, 2 conditional on `requiredTurnIn`), then `requiredTurnIn` (`functions.lua:1141-1149`) | code |
| D5 | `.isQuestAvailable id`: "skips step if quest id isn't able to be accepted" | Skips only when **all** listed quests are already turned in; prerequisites are not checked (`functions.lua:4402-4450`) | code |
| D6 | `.xp 10.5,1`: "skip step if you are above 50% of 10" | True, but only if the user has XP step skipping enabled (default on) (`functions.lua:3319-3326`) | code |
| D7 | `.money <0.01`: "skips step if you have less than 1 silver" | Unit is gold (the value is multiplied by 10,000 to get copper), so `0.01` = 1 silver: consistent. Noted because the unit is easy to misread (`functions.lua:3784`) | both |
| D8 | `.timer` "latches to .accept or .turnin directly above" | Latches to the step's most recent objective: the most recent element in the step that has text and is not text-only, or has dynamic text (such as `.complete`) (`functions.lua:6585-6594`; `GuideLoader.lua:917-919`, `949-951`) | code |
| D9 | Docs list `#scryer`/`#aldor` | Always pass on Classic and Forever (`RXPGuides.lua:2369-2370`) | code |

---

## 17. First-revision recommendations and their status

| # | Recommendation (revision 1) | Status |
|---|---|---|
| 1 | Two-layer parser: lossless CST, then lowering | **Adopted** (ARCH §10 steps 2-4). The serializer now works from the route model plus the stored import text (section 13), not from the CST alone. |
| 2 | Never evaluate filters at parse time | **Adopted**: `domain/conditions` evaluates them (ARCH §9.2; 6.5). |
| 3 | Reproduce RXP's quirks exactly and report them, with an RXP-compat flag | **Adopted** (ARCH §10 step 3; registry 11.1). |
| 4 | Command registry as data | **Adopted**, written in our own words from section 9 (D-019). Suggested shape: `commandSpec[name] = { separator, args, requiredText, blocksByDefault, loweredTo, tier }`. |
| 5 | Coordinates carry their space (`coordSpace`, `uiMapId`, `instance`) | **Superseded by D-017 / ARCH §6** (`SourcedPoint`); 10.4 maps RXP forms onto it. The world variant's `uiMapId` (ARCH §6 revision 2) keeps the UiMapID of the world form and its `mapId` the instance, so this item's content is covered. |
| 6 | Validator hooks | **Still recommended** (Milestone 6): unknown quest IDs (warning), `.accept`/`.turnin` far from the starter/finisher, `.complete` index range (`RXP031`), `.target`/`.mob` names against NPC data, label references of `#completewith`, `#requires`, `.xp …,label`, a `#requires` target placed after the requiring group, zone keys. |
| 7 | Static-only Lua input | **Adopted** (ARCH §10 step 1). |
| 8 | Detect and refuse protected strings | **Adopted** (ARCH §10 step 1). |
| 9 | Fixture 04 byte rules need an owner decision | **Done**: `.gitattributes` has `docs/research/rxp-samples/*-crlf.txt -text` and `tests/fixtures/rxp/*-crlf.txt -text`, and `.editorconfig` has the matching section (`end_of_line = unset`, `trim_trailing_whitespace = false`, `insert_final_newline = unset`). Edit fixture 04 only with byte-preserving tools. Tests still build CR-only and mixed variants. |
| 10 | CI marker check for RXPGuides strings | **Superseded by D-019 / ARCH §17**: `tools/build/rxp-overlap.ts` compares trimmed lines of 24 or more characters in `src/`, `public/`, `tests/` and `docs/research/rxp-samples/` with RXPGuides guides at a pinned SHA, with a reviewed allowlist; fixture lines are also compared in canonical form (19.2). Marker strings would also have matched our own fixtures, which use RXP colour tokens as vocabulary. |
| 11 | (added) Parser review | The Milestone 5 review checks that `src/rxp` is not a structural translation of the addon's loader (D-019). |

---

## 18. Open questions

| # | Question | Why it matters | How to answer |
|---|---|---|---|
| Q1 | Skyborne race token returned by `UnitRace` on Forever (is it `Skyborne` for both faction halves?) | filter evaluation; until answered, race words for Skyborne characters are `unknown` (6.5) | Forever client (read-only observation) or ChrRaces DB2 `ClientFileString`, checked manually (D-011) |
| Q2 | Season value reported on Forever realms; do Forever hardcore/SSF realms exist? | `#season`, `#hardcore`, `#ssf` variants | Forever rules research |
| Q3 | ~~Does `.complete`'s objective index equal QuestieDB's objective order?~~ **Resolved by ARCH §5.4**: the index is Questie's `ObjectiveData` order (creature, object, item, reputation, killCredit, spell, then the `triggerEnd` event) with the `*ObjectiveFirst` hints applied at extraction; Questie maps in-game objective numbers straight onto that order. Residual risk: a multi-type quest without a hint whose in-game order differs, which would show as a wrong objective label. | `complete` targets | — |
| Q4 | ~~Which client table gives HBD's per-map world rectangle?~~ **Answered**: the UiMapAssignment region (docs/research/coordinates.md §7, §13.3); the Gornek round trip (10.1) checks it. coordinates.md C6 tracks the remaining landmark check on the four changed maps. | 82% of Forever gotos | — |
| Q5 | Do the 293 missing quest IDs exist in the Forever client (QuestV2/QuestLine DB2) but not yet in QuestieDB? | validation coverage | QuestieDB research; manual DB2 check |
| Q6 | Forever XP multipliers that `#xprate` thresholds refer to (1.5? 2.0? rested/boost items?) | route variants | XP rules research |
| Q7 | Should `+text` manual objectives default to "done instantly" in the simulator, or cost time? | simulation fidelity | product decision |
| Q8 | Why RXP disabled death-skips "on beta" (15.6) | route validity | watch RXPGuides commits |
| Q9 | ~~Should the engine route travel through `leg` waypoints?~~ **Resolved by ARCH §9.2**: yes, in order (12.4 rule 8). | travel time for 1,575 multi-goto steps | — |
| Q10 | ~~Should `turnin` gain `anyOf` for `.turninmultiple`/`.dailyturnin`?~~ **Resolved by ARCH §8.1 revision 2**: `turnin.anyOf` exists (12.3). | — | — |
| Q11 | ~~Should `grind.until` gain exact forms for `.xp L-N` and `.xp L.F`?~~ **Resolved by ARCH §8.1 revision 2**: `GrindTarget` level offsets `xpInto`, `xpShort`, `fraction` (12.3); `RXP033` is retired. | — | — |
| Q12 | ~~Does a `questState` predicate test **any** or **all** of its `questIds`?~~ **Resolved by `src/domain`**: `questState.match` says which; lowering writes `'any'` (12.2). The domain additions G1-G4 are decided too (12.2: adopted in part; schema v1 frozen, D-035). | — | — |

---

## 19. Fixtures

### 19.1 Files

All self-authored for this project, GPL-3.0-or-later, in `docs/research/rxp-samples/`.

| File | Covers | Data provenance |
|---|---|---|
| `01-basic-durotar.txt` | Header, `<< Horde`, `#name` zero-padding, multiple accepts/turn-ins per step, `.complete` indices, name and numeric UiMapID gotos, `,R,0` legs, comments, `>>`/`+` notes, `.xp`, `.vendor`, `.trainer`, `.target Name::npcId`. | Quests 4641, 788, 789, 790, 792, 4402; NPCs 10176, 3143, 3145, 3287, 3281, 9796, 3098, 3124, 3101; items 4862, 4905: QuestieDB `data/Forever/*` at b6f5b07 (for example `foreverQuestDB.lua:811-815`, `2179`, `2240`; `foreverNpcDB.lua:2561`, `2564`, `2586`, `2604`, `2606`, `2738`, `2744`, `6691`, `6792`; `foreverItemDB.lua:2889`, `2924`). Coordinates = QuestieDB spawn points (zone 14 = UiMap 1411); the Kaltunk, Galgar and Zureetha gotos use the numeric UiMapID form (19.2). Route order untested. |
| `02-filters-and-step-tags.txt` | Every filter form with expected shown/hidden results for a fixed profile (the first revision was checked by `.cache/experiments/rxp/applies.mjs`: 17/17), conditional header lines, `#next` alternatives, all main step tags, empty step, loop, closest-point goto, `step << skip`. | IDs and two NPC positions from 01; other coordinates placeholders. |
| `03-lua-wrapped.txt` | Four `RegisterGuide` forms (level-0, level-2, two-arg + defaultFor with extra whitespace, quoted with escapes), a guard, a call inside a block comment, a dynamic (`..`) call. | Placeholders. |
| `04-edge-cases-crlf.txt` | Cases E01-E35 of section 11, **CRLF line endings**, no final newline, a tab, trailing spaces, non-ASCII text. Must stay byte-exact (section 17, item 9). | IDs from 01; Gornek's QuestieDB position in E03 and the last step, and its computed world form in E09 (10.1); other coordinates placeholders. |
| `05-travel-and-conditions.txt` | World-coordinate gotos, `.zone`, `.home`/`.bindlocation`/`.hs`, `.fp`/`.fly`, `.deathskip`, all quest-state conditions, `.itemcount`/`.money`/`.maxlevel`/`.xp <…,1`, `.collect` with quest and objective mask, `.abandon`, `.waypoint`/`.line`/`.loop`, vendor/trainer/buy/timer/link/dungeon. | Area IDs 362/363/364 from QuestieDB `support/Forever/Zones/areaIdToUiMapId.lua:354-356`; items 159, 6948 from `foreverItemDB.lua:62`, `4344`; spell 6673 is a real spell ID used only as a syntax example; coordinates placeholders. |
| `06-lowering-and-export.txt` | Lowering cases L01-L10 and export cases X1-X5 (19.3): world-form Gornek, frame-ambiguous points, pseudo-zones, waypoint kinds, arrival radius, merged and partial `complete` steps, objective-index diagnostics, any-of accept and turn-in, reward index, grind offsets, group condition, travel/bind/flight/hearth, an `RXP034` construct. | Quests, items and NPC positions from 01, plus Chief Hawkwind (`foreverNpcDB.lua:2448`, Mulgore 43.89, 76.66); quest 900001 synthetic; Gornek world point computed (10.1); other coordinates placeholders. |

The throwaway scripts used to check claims in this document are in `.cache/experiments/rxp/`
(gitignored): `classify.mjs` (static Lua extraction + RXP line classification + statistics),
`applies.mjs` (filter semantics check for fixture 02), `gen-commands.sh` (registered command
names) and `tablecheck.mjs` (Markdown table sanity check). They are research aids, not project
code, and contain no RXPGuides code.

### 19.2 Provenance and overlap check

The first revision's fixtures contained lines equal to RXP guide lines, while their headers
claimed otherwise (critique LIC-06). They were replaced on 2026-09-25: the malformed-number goto
(04:E12), the texture escape (04:E25), the step typo (04:E32 now tests a capitalised `Step`),
the `.zone` line of 05, the faction guard of 03, and the generic `>>` texts of 01, 02, 04 and 05;
05 now says that 6673 is a real spell ID.

On 2026-09-25 a throwaway line-equality check, the comparison `tools/build/rxp-overlap.ts` will
make (ARCH §17), was run against RXPGuides `Guides/**` at c3429e0. It found five fixture lines
of 24 or more characters equal to an RXP guide line: `01-basic-durotar.txt:24`, `:89` and `:97`,
and `03-lua-wrapped.txt:16` and `:59`.

The three lines of 01 were zone-name gotos at the QuestieDB positions of Kaltunk
(`foreverNpcDB.lua:6792`), Galgar (`:6691`) and Zureetha Fargaze (`:2606`). RXP's guides place
those NPCs at the same positions, both as zone-name gotos and as world-form gotos equal to the
world points computed from them through the Durotar row (checked 2026-09-25). So neither form
can be used for them. In a second pass the same day the three lines were rewritten in the
numeric UiMapID form (`.goto 1411,x,y` with the same QuestieDB values), which occurs in no RXP
guide at c3429e0. The fixture 04 E09 placeholder, which lay about 3 yd from an RXP world-form
point, was replaced by the Gornek world point (10.1), which occurs in no RXP guide either.

A re-run of the check after these edits finds only the two lines of 03. They are the allowlist
candidates for Milestone 5:

| Fixture line | Why it coincides |
|---|---|
| `03-lua-wrapped.txt:16`, `:59` | the registration API call `RXPGuides.RegisterGuide([[` (interoperability vocabulary) |

The Milestone 5 RXP review ran `tools/build/rxp-overlap.ts` itself and found one more line: the
golden canonical file of fixture 05 had a `.home` line whose `>>` text equals an RXP guide line.
The fixture line differed only by the missing space after `>>`, which canonicalisation adds, so
the raw comparison had not seen it. The `>>` text was reworded on 2026-09-26 in both copies of
fixture 05 (line 23), and the tool now also compares the **canonical form** of every line (13.4,
the line parsed on its own and printed without indentation) on both sides: each of our lines
under `docs/research/rxp-samples/` and `tests/fixtures/rxp/`, and each reference line. A
spacing-only difference around RXP's separators can therefore no longer hide an overlap. It is
not allowlisted: it was guide text, not vocabulary.

Shorter lines that also occur are vocabulary or minimal syntax examples and fall below the tool's
threshold: single tags such as `#softcore`, `#version 1` or `#xprate <1.5`, `.mob <NPC name>`,
`step << skip`, and short condition lines such as `.xp 6`, `.xp <5,1`, `.maxlevel 9` or
`.money <0.5`.

### 19.3 Fixture 06: expected lowering and export

Import options: `changedZoneFrame: 'forever'` unless stated. Waypoints and steps are listed in
source order; "loc" is the steps' shared location, with `radius: null` unless a radius is given.
Percent points without a UiMap are on Durotar (1411).

| Case | Groups and steps | Diagnostics |
|---|---|---|
| L01 | loc world `{ mapId: 1, x: −600.30, y: −4186.42, uiMapId: 1411, lexemes: ['-4186.42', '-600.30'] }`, resolving to UiMap 1411 at 42.06, 68.33 (±0.0001); `turnin { questId: 788, anyOf: null, rewardIndex: null, skipIfMissing: true }` with `rxp.text`; `accept { questId: 789, anyOf: null }` | — |
| L02 | waypoints: pin (1412, 43.89, 76.66), pin (1412, 44.00, 77.00); loc zone (1453, 60.00, 70.00); all three `frame: 'forever'` (`'era'` with `changedZoneFrame: 'era'`); `note` "Three frame-ambiguous points" | `RXP030` × 3 |
| L03 | loc null; `note` "An unconvertible pseudo-zone point" | `RXP036` |
| L04 | waypoints: leg (45.00, 70.00, r 35), leg (46.00, 68.00, r 35), pin (45.50, 69.00, r 0), leg (44.20, 69.20; its `<< Orc` filter is not modelled, 12.2 G1); loc (44.00, 69.00, radius 20); `travel { mode: 'auto' }` from the radius-20 location line; `complete { targets: [788/0, 789/0, 788/1], progress: 'finish' }`; annotation `{ command: 'mob', args: ['Mottled Boar'] }` | `RXP031` (`.complete 788,2`), `RXP034` (filtered `.goto`, also the last one) |
| L05 | tags `[{ name: 'completewith', value: 'next' }]`; `complete [792/0] partial`, `complete [789/0] partial` (from `.collect`, objective bit 1), `complete [900001/0] partial` | `RXP032` |
| L06 | loc (1411, 42.06, 68.33); `accept { questId: 790, anyOf: [790, 792] }`; `turnin { questId: 789, anyOf: null, rewardIndex: 2, skipIfMissing: false }` | — |
| L07 | four `grind` steps, `until`: `{ kind: 'level', level: 6, offset: null }`, `{ level: 6, offset: { kind: 'xpInto', xp: 150 } }`, `{ level: 7, offset: { kind: 'xpShort', xp: 200 } }`, `{ level: 7, offset: { kind: 'fraction', fraction: 0.5 } }` | — |
| L08 | condition `{ filter: Orc/Troll, variant: [{ name: 'xprate', value: '<1.5' }, { name: 'softcore', value: null }, { name: '.dungeon', value: 'RFC' }], skipIf: [{ kind: 'questState', state: 'onQuest', questIds: [790], negate: true }] }`; loc (1411, 40.60, 62.58); `turnin { questId: 790 }` | — |
| L09 | four groups: loc (52.00, 41.00, radius 15) with `travel` + `note`; loc (51.90, 41.60) with `hearth { mode: 'bind' }`; loc (45.50, 12.50) with `flight { mode: 'discover', nodeQuery: 'Orgrimmar' }` and `flight { mode: 'take', nodeQuery: 'Crossroads' }`; no loc with `hearth { mode: 'use' }` | — |
| L10 | variant `[{ name: 'softcore', value: null }]` (implicit, from `.deathskip`); `train { spellId: null }`, `train { spellId: 6673, skill: null }` (not a riding spell), `note` with `preserved.lines` = the `.deathskip` line, `turnin { questId: 790, anyOf: [790, 792], rewardIndex: null, skipIfMissing: false }` with `rxp.text` | `RXP034` (`.deathskip`) |

Export cases:

- **X1:** import and export with no edits → byte-identical to the file.
- **X2:** delete the `accept 789` step of L01 → L01 is emitted in canonical form (its comment
  lines, `.goto 1411/1,-4186.42,-600.30`, `.turnin -788 >> Hand in Cutting Teeth if it is in your
  log`); the header and every other group are byte-identical.
- **X3:** move L06's `turnin` step to directly after L07 → L06 is split: run 1 is `step`, its
  comment, `.goto Durotar,42.06,68.33`, `.acceptmultiple 790,792 >> Take whichever of the two is
  offered`; run 2 (after L07) is `step`, `.goto Durotar,42.06,68.33`, `.turnin 789,2`; one
  `RXP040`. L07 stays byte-identical.
- **X4:** in the app, set the location source of both steps of L09's first group to world
  `(X, Y) = (−500.00, −4000.00)` on map 1, with `uiMapId: null` and no lexemes, keeping
  `radius: 15` → the location line becomes `.goto 1411/1,-4000.00,-500.00,15` (world form; no
  UiMap in the model, so the smallest containing committed frame, Durotar; radius from
  `Location.radius`); the note line is unchanged; every other group is byte-identical.
- **X5:** append an app-created ungrouped step `accept { questId: 790 }` whose location is a copy
  of L01's (the same `source`, lexemes and `uiMapId: 1411` included) → it is emitted after the
  last group as `step`, `.goto 1411/1,-4186.42,-600.30`, `.accept 790`: the UiMapID comes from
  the model's `uiMapId` and the numbers from its lexemes (13.4 rule 8, 13.6); every group is
  byte-identical.
