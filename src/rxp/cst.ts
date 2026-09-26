import { type CommandSpec, commandCaseMatch, commandSpec } from './commands';
import { type RawDiagnostic, rawDiagnostic } from './diagnostics';
import { type ParsedFilter, parseFilter } from './filter';
import { closestName, codePointColumn, leadingBlankLength, trimEndBlank, trimStartBlank } from './text';
import { GAME_TAGS, HEADER_TAGS, OTHER_GAME_GATE_TAGS, STEP_TAGS } from './vocabulary';

/**
 * Layer 1: the lossless concrete syntax tree of one guide text (docs/RXP.md §5, ARCHITECTURE §10
 * step 2). One node per physical line. `printRxpCst(parseRxpCst(x)) === x` for every string `x`:
 * the BOM, every line ending (CRLF, LF, CR, mixed, none at the end), indentation, trailing
 * whitespace and comments are kept.
 *
 * Classification follows the order RXP applies to a line (§4 P1-P8e), but nothing is dropped:
 * comments, blank lines, stray text and lines RXP would ignore are all nodes. Diagnostics about
 * what RXP would do differently are collected on the way (§11.1, stage "CST").
 */

export type RxpEol = '' | '\n' | '\r\n' | '\r';

export type RxpLineKind =
  /** Nothing but spaces and tabs. */
  | 'blank'
  /** Only a comment (after optional indentation). */
  | 'comment'
  /** Starts a step: the content begins with `step` (§4 P5). */
  | 'step'
  /** A header line that is only `<< filter` (the guide's `enabledFor`, §4 P7). */
  | 'enabledFor'
  | 'tag'
  | 'command'
  /** Has `>>` text but no command (`>>text`, or other text before the `>>`). */
  | 'note'
  /** `+label`, optionally with `>>` text. */
  | 'objective'
  /** `*label`, optionally with `>>` text. */
  | 'star'
  /** Anything else; RXP drops it silently. */
  | 'stray';

export interface CstFilter {
  /** The filter text after `<<` and the whitespace that follows it. */
  readonly text: string;
  /** UTF-16 offset of `<<` in the raw line. */
  readonly markerOffset: number;
  /** UTF-16 offset of `text` in the raw line. */
  readonly textOffset: number;
  readonly parsed: ParsedFilter;
}

export interface CstTag {
  /** The key without `#`: the maximal run of non-blank characters (so `#a=b` has the key `a=b`). */
  readonly key: string;
  readonly value: string | null;
  /** `#key = value`: the assignment form (a function reference in RXP). */
  readonly assignment: boolean;
}

export interface CstCommand {
  /** Without the dot; case-sensitive. */
  readonly name: string;
  readonly nameOffset: number;
  /** Everything after the whitespace that follows the name (text and filter already cut). */
  readonly argsRaw: string;
  readonly argsOffset: number;
  /** After the separator split and the empty-field collapse (§4 P8d, S6). */
  readonly args: readonly string[];
  readonly emptyFields: number;
  readonly spec: CommandSpec | null;
}

export interface RxpCstLine {
  /** 0-based index in `lines`. */
  readonly index: number;
  /** 1-based physical line number in the text. */
  readonly line: number;
  /** The line without its ending. `raw === indent + content + gap + (comment === null ? '' : '--' + comment)`. */
  readonly raw: string;
  readonly eol: RxpEol;
  readonly indent: string;
  /** What RXP reads after removing the comment and trimming spaces and tabs. */
  readonly content: string;
  /** Spaces and tabs between the content and the comment or the end of the line. */
  readonly gap: string;
  /** Text after the first `--`, or null. */
  readonly comment: string | null;
  /** `header` before the first step line, `step` from it on. */
  readonly section: 'header' | 'step';
  /** 0-based index of the step this line belongs to (its own index for a step line); null in the header. */
  readonly stepIndex: number | null;
  readonly kind: RxpLineKind;
  readonly filter: CstFilter | null;
  /** The content without the filter. */
  readonly code: string;
  /** The `>>` text (for notes, objectives, stars and commands), or null. */
  readonly text: string | null;
  readonly textOffset: number;
  /** Before the `>>` of a note, objective or star: the `+`/`*` label with its prefix, or other text. */
  readonly lead: string | null;
  readonly tag: CstTag | null;
  readonly command: CstCommand | null;
  /** For a step line: what follows `step` before any filter; null when the line is canonical. */
  readonly stepSuffix: string | null;
}

export interface RxpCst {
  readonly bom: boolean;
  readonly lines: readonly RxpCstLine[];
  /** Line indices of the step lines, in order (`stepLines[k]` starts step k). */
  readonly stepLines: readonly number[];
  readonly diagnostics: readonly RawDiagnostic[];
}

const BOM = String.fromCharCode(0xfeff);

/** Physical lines: CRLF, LF and CR each end a line (§4 P3); the last line may have no ending. */
export function splitPhysicalLines(text: string): { readonly raw: string; readonly eol: RxpEol }[] {
  const out: { raw: string; eol: RxpEol }[] = [];
  let start = 0;
  let index = 0;
  while (index < text.length) {
    const code = text.charCodeAt(index);
    if (code === 13) {
      const eol: RxpEol = text.charCodeAt(index + 1) === 10 ? '\r\n' : '\r';
      out.push({ raw: text.slice(start, index), eol });
      index += eol.length;
      start = index;
    } else if (code === 10) {
      out.push({ raw: text.slice(start, index), eol: '\n' });
      index += 1;
      start = index;
    } else index += 1;
  }
  if (start < text.length) out.push({ raw: text.slice(start), eol: '' });
  return out;
}

interface FilterCut {
  readonly code: string;
  readonly filterText: string;
  /** Offsets inside the content. */
  readonly marker: number;
  readonly textStart: number;
}

/** §4 P8a: the filter starts at the first `<<` that has at least one character after it. */
function cutFilter(content: string): FilterCut | null {
  const marker = content.indexOf('<<');
  if (marker < 0 || marker + 2 >= content.length) return null;
  const after = content.slice(marker + 2);
  const filterText = trimStartBlank(after);
  return { code: trimEndBlank(content.slice(0, marker)), filterText, marker, textStart: marker + 2 + (after.length - filterText.length) };
}

function splitArgs(argsRaw: string, separator: CommandSpec['separator']): { readonly args: string[]; readonly empty: number } {
  if (argsRaw === '') return { args: [], empty: 0 };
  if (separator === 'rest') return { args: [argsRaw], empty: 0 };
  const fields = argsRaw.split(separator === 'semicolon' ? ';' : ',').map((field) => trimEndBlank(trimStartBlank(field)));
  const args = fields.filter((field) => field !== '');
  return { args, empty: fields.length - args.length };
}

interface ParseState {
  readonly diagnostics: RawDiagnostic[];
  /** Keys of tags seen without a filter, per scope (the header, or the current step): key → line. */
  seenTags: Map<string, number>;
  enabledForLine: number | null;
}

/** Parses one guide text. Never throws; every input yields a tree. */
export function parseRxpCst(text: string): RxpCst {
  const bom = text.startsWith(BOM);
  const body = bom ? text.slice(BOM.length) : text;
  const physical = splitPhysicalLines(body);
  const diagnostics: RawDiagnostic[] = [];
  if (bom) diagnostics.push(rawDiagnostic('RXP026-bom', 1, 1, 'The text starts with a UTF-8 byte-order mark; it is kept here, but canonical output has none.'));
  const state: ParseState = { diagnostics, seenTags: new Map(), enabledForLine: null };
  const lines: RxpCstLine[] = [];
  const stepLines: number[] = [];
  let stepIndex: number | null = null;
  physical.forEach(({ raw, eol }, index) => {
    const node = parseLine(raw, eol, index, stepIndex, state, index === physical.length - 1);
    if (node.kind === 'step') {
      stepIndex = stepIndex === null ? 0 : stepIndex + 1;
      stepLines.push(index);
      state.seenTags = new Map();
      lines.push({ ...node, section: 'step', stepIndex });
    } else lines.push(node);
  });
  return { bom, lines, stepLines, diagnostics };
}

/** Layer 1 printer: the exact inverse of `parseRxpCst`. */
export function printRxpCst(cst: RxpCst): string {
  let out = cst.bom ? BOM : '';
  for (const line of cst.lines) out += line.indent + line.content + line.gap + (line.comment === null ? '' : `--${line.comment}`) + line.eol;
  return out;
}

function parseLine(raw: string, eol: RxpEol, index: number, stepIndex: number | null, state: ParseState, last: boolean): RxpCstLine {
  const lineNo = index + 1;
  const col = (offset: number): number => codePointColumn(raw, offset);
  const report = (code: Parameters<typeof rawDiagnostic>[0], offset: number, message: string): void => {
    state.diagnostics.push(rawDiagnostic(code, lineNo, col(offset), message));
  };
  const commentAt = raw.indexOf('--');
  const pre = commentAt >= 0 ? raw.slice(0, commentAt) : raw;
  const comment = commentAt >= 0 ? raw.slice(commentAt + 2) : null;
  const indentLength = leadingBlankLength(pre);
  const rest = pre.slice(indentLength);
  const content = trimEndBlank(rest);
  const gap = rest.slice(content.length);
  const section: RxpCstLine['section'] = stepIndex === null ? 'header' : 'step';
  const base: RxpCstLine = {
    index,
    line: lineNo,
    raw,
    eol,
    indent: pre.slice(0, indentLength),
    content,
    gap,
    comment,
    section,
    stepIndex,
    kind: 'blank',
    filter: null,
    code: content,
    text: null,
    textOffset: 0,
    lead: null,
    tag: null,
    command: null,
    stepSuffix: null,
  };
  if (comment !== null && last && eol === '') {
    report('RXP022-unterminated-comment', commentAt, 'RXP strips a "--" comment only up to a line break; this last line has none, so RXP would read the comment as part of the line.');
  }
  if (content === '') return { ...base, kind: comment === null ? 'blank' : 'comment' };

  const cut = cutFilter(content);
  const filter: CstFilter | null =
    cut === null
      ? null
      : { text: cut.filterText, markerOffset: indentLength + cut.marker, textOffset: indentLength + cut.textStart, parsed: parseFilter(cut.filterText) };
  const code = cut === null ? content : cut.code;
  if (filter !== null) {
    if (filter.text.includes('>>')) {
      report('RXP006-filter-before-text', filter.markerOffset, 'The filter comes before the ">>" text, so RXP reads the text as filter words and the line never shows. Put ">> text" before "<< filter".');
    }
    for (const quirk of filter.parsed.quirks) report('RXP016-filter-quirk', filter.textOffset + quirk.offset, quirk.message);
  }
  const withFilter: RxpCstLine = { ...base, filter, code };

  // §4 P5: a step line (a case-sensitive four-character prefix test).
  if (content.startsWith('step')) {
    const suffix = code.slice(4);
    if (suffix !== '') {
      report('RXP010-step-prefix', indentLength, `This line starts with "step", so RXP starts a new step here and ignores "${suffix}". Write "step" or "step << filter".`);
    }
    return { ...withFilter, kind: 'step', section: 'step', stepSuffix: suffix === '' ? null : suffix };
  }

  if (code === '') {
    if (section === 'header') {
      if (state.enabledForLine !== null) {
        report(
          'RXP013-shadowed-tag',
          filter?.markerOffset ?? indentLength,
          `Another "<< filter" header line: RXP keeps the first one (line ${String(state.enabledForLine)}) as the guide's filter, but decides whether the guide loads at all from the last such line.`,
        );
      } else state.enabledForLine = lineNo;
      return { ...withFilter, kind: 'enabledFor' };
    }
    report('RXP002-stray-line', indentLength, 'A filter with nothing before it: RXP drops this line.');
    return { ...withFilter, kind: 'stray' };
  }

  if (code.startsWith('#')) return parseTag(withFilter, code, indentLength, state, report);

  const textAt = code.indexOf('>>');
  const lead = textAt >= 0 ? trimEndBlank(code.slice(0, textAt)) : code;
  const textRaw = textAt >= 0 ? code.slice(textAt + 2) : null;
  const textTrimmed = textRaw === null ? null : trimStartBlank(textRaw);
  const text = textTrimmed === null || textTrimmed === '' ? null : textTrimmed;
  const textOffset = textRaw === null || textTrimmed === null ? 0 : indentLength + textAt + 2 + (textRaw.length - textTrimmed.length);
  const withText: RxpCstLine = { ...withFilter, text, textOffset };
  if (comment !== null && filter === null && text !== null) {
    report('RXP007-inline-comment', commentAt, 'RXP treats "--" as the start of a comment even inside ">>" text, so the text ends here.');
  }

  if (lead.startsWith('.')) return parseCommand(withText, lead, indentLength, section, commentAt, report);
  if (lead.startsWith('+')) {
    if (section === 'header') report('RXP002-stray-line', indentLength, 'RXP ignores this line: before the first step only tags and "<< filter" lines count.');
    return { ...withText, kind: 'objective', lead };
  }
  if (lead.startsWith('*')) {
    if (section === 'header') report('RXP002-stray-line', indentLength, 'RXP ignores this line: before the first step only tags and "<< filter" lines count.');
    return { ...withText, kind: 'star', lead };
  }
  if (text !== null) {
    if (section === 'header') report('RXP002-stray-line', indentLength, 'RXP ignores this line: before the first step only tags and "<< filter" lines count.');
    else if (lead !== '') report('RXP002-stray-line', indentLength, `RXP shows only the ">>" text of this line and ignores "${lead}".`);
    return { ...withText, kind: 'note', lead };
  }
  if (/^\w?step\b/i.test(code)) {
    report('RXP011-step-typo', indentLength, 'Possible typo of "step": RXP only starts a step on a line beginning with lower-case "step", so this line is dropped and the lines below stay in the previous step.');
  } else {
    report('RXP002-stray-line', indentLength, 'This line has no ".", "#", ">>", "+" or "*" prefix; RXP drops it silently. It is kept here as a preserved note.');
  }
  return { ...withText, kind: 'stray' };
}

type Report = (code: Parameters<typeof rawDiagnostic>[0], offset: number, message: string) => void;

function parseTag(line: RxpCstLine, code: string, indentLength: number, state: ParseState, report: Report): RxpCstLine {
  const rest = code.slice(1);
  let keyLength = 0;
  while (keyLength < rest.length && rest[keyLength] !== ' ' && rest[keyLength] !== '\t') keyLength += 1;
  const key = rest.slice(0, keyLength);
  const after = rest.slice(keyLength);
  const assignment = /^[ \t]*=/.exec(after);
  const valueText = trimStartBlank(assignment === null ? after : after.slice(assignment[0].length));
  const tag: CstTag = { key, value: valueText === '' ? null : valueText, assignment: assignment !== null };
  const known = line.section === 'header' ? HEADER_TAGS : STEP_TAGS;
  if (tag.assignment) {
    report('RXP014-function-tag', indentLength, `"#${key} = ${tag.value ?? ''}" stores a reference to an addon function in RXP; it is kept opaque here.`);
  } else if (key === '') {
    report('RXP012-unknown-tag', indentLength, 'A tag line with no key after "#".');
  } else if (key.includes('=')) {
    report('RXP012-unknown-tag', indentLength, `RXP reads the key "${key}" (the key runs to the first space), with no value. Write "#${key.replace('=', ' ')}" or "#${key.replace('=', ' = ')}".`);
  } else if (!known.includes(key)) {
    const suggestion = closestName(key, known);
    report('RXP012-unknown-tag', indentLength, `RXP stores "#${key}" but never reads it${suggestion === null ? '' : `; did you mean "#${suggestion}"?`}`);
  }
  const earlier = state.seenTags.get(key);
  if (earlier !== undefined) {
    report('RXP013-shadowed-tag', indentLength, `"#${key}" already appears without a filter on line ${String(earlier)}; the first one wins, so RXP ignores this line.`);
  } else if (line.filter === null) state.seenTags.set(key, line.line);
  return { ...line, kind: 'tag', tag };
}

function parseCommand(line: RxpCstLine, lead: string, indentLength: number, section: RxpCstLine['section'], commentAt: number, report: Report): RxpCstLine {
  const afterDot = lead.slice(1);
  let nameLength = 0;
  while (nameLength < afterDot.length && afterDot[nameLength] !== ' ' && afterDot[nameLength] !== '\t') nameLength += 1;
  const name = afterDot.slice(0, nameLength);
  const tail = afterDot.slice(nameLength);
  const argsRaw = trimStartBlank(tail);
  const argsOffset = indentLength + 1 + nameLength + (tail.length - argsRaw.length);
  const spec = commandSpec(name);
  const { args, empty } = splitArgs(argsRaw, spec?.separator ?? 'comma');
  const command: CstCommand = { name, nameOffset: indentLength + 1, argsRaw, argsOffset, args, emptyFields: empty, spec };
  if (section === 'header') {
    report('RXP015-header-command', indentLength, `".${name}" sits before the first step; RXP ignores commands there.`);
  }
  if (spec === null) {
    const caseMatch = commandCaseMatch(name);
    if (caseMatch !== null) {
      report('RXP017-command-case', indentLength + 1, `RXP command names are case-sensitive: ".${name}" is unknown; did you mean ".${caseMatch}"?`);
    } else {
      const commaHint = name.includes(',') ? ' (a comma directly after the name is part of the name; put a space after it)' : '';
      report('RXP001-unknown-command', indentLength + 1, `".${name}" is not a command this parser knows${commaHint}; RXP would drop the line. It is kept as a preserved note.`);
    }
  }
  if (empty > 0) {
    report('RXP005-empty-field', argsOffset, `${String(empty)} empty argument field${empty === 1 ? '' : 's'} dropped, as RXP does; the positions of later arguments shift.`);
  }
  if (spec?.separator === 'rest' && line.comment !== null && line.text === null && line.filter === null && argsRaw !== '') {
    report('RXP007-inline-comment', commentAt, 'RXP treats "--" as the start of a comment even inside this argument, so the argument ends here (write "\\-" for a "-").');
  }
  return { ...line, kind: 'command', command };
}

/** Header facts RXP checks before a guide loads (§4 P6, P9). */
export interface GuideHeader {
  /** Value of the first `#name` line without a filter (else the first `#name`), or null. */
  readonly name: string | null;
  readonly hasName: boolean;
  readonly hasGroup: boolean;
  /** Line numbers of the game tags present. */
  readonly gameTags: ReadonlyMap<string, number>;
}

export function guideHeader(cst: RxpCst): GuideHeader {
  let name: string | null = null;
  let filteredName: string | null = null;
  let hasName = false;
  let hasGroup = false;
  const gameTags = new Map<string, number>();
  for (const line of cst.lines) {
    if (line.section !== 'header' || line.tag === null) continue;
    const { key, value } = line.tag;
    if (key === 'name') {
      hasName = true;
      if (line.filter === null) name ??= value;
      else filteredName ??= value;
    } else if (key === 'group') hasGroup = true;
    if (GAME_TAGS.includes(key) && !gameTags.has(key)) gameTags.set(key, line.line);
  }
  return { name: name ?? filteredName, hasName, hasGroup, gameTags };
}

/** Guide-level diagnostics: `RXP024`, `RXP025`, `RXP027`. `groupArg` is the Lua two/three-argument group. */
export function guideDiagnostics(cst: RxpCst, options: { readonly groupArg: string | null }): RawDiagnostic[] {
  const header = guideHeader(cst);
  const out: RawDiagnostic[] = [];
  const firstLine = cst.lines.length > 0 ? 1 : 0;
  if (!header.hasName || (!header.hasGroup && options.groupArg === null)) {
    const missing = [header.hasName ? null : '#name', header.hasGroup || options.groupArg !== null ? null : '#group'].filter((item) => item !== null);
    out.push(rawDiagnostic('RXP025-missing-name-or-group', firstLine, firstLine, `The header has no ${missing.join(' and no ')} line; RXP refuses to load such a guide. The steps are still read.`));
  }
  const forever = header.gameTags.get('forever');
  const classic = header.gameTags.get('classic');
  if (forever === undefined && classic === undefined) {
    const other = OTHER_GAME_GATE_TAGS.map((tag) => header.gameTags.get(tag)).filter((line) => line !== undefined);
    if (other.length > 0) {
      out.push(rawDiagnostic('RXP024-other-game', Math.min(...other), 1, 'The header names only other games (no "#forever" or "#classic"), so RXP skips this guide on Forever. It is read anyway.'));
    }
  }
  if (classic !== undefined && forever === undefined) {
    out.push(rawDiagnostic('RXP027-classic-header', classic, 1, 'RXP accepts "#classic" guides on Forever when they are imported, but a guide shipped in an addon also needs "#forever"; consider adding it.'));
  }
  return out;
}
