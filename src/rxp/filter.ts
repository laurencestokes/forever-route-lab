import type { FilterAst } from '../domain/conditions';
import { classifyFilterWord } from './vocabulary';

/**
 * RXP `<<` filters (docs/RXP.md §6.2), parsed to `FilterAst` (src/domain/conditions.ts) and
 * printed back in canonical form (§13.4 rule 10). The parser never evaluates a filter.
 *
 * Reading rules, in our words:
 * 1. A group runs from `(` (or `!(`) to the first `)` after it; its content, without the blanks
 *    just inside the parentheses, is a filter of its own and acts as one term. Groups do not
 *    nest: a `(` inside a group only separates words. A group written directly against a letter,
 *    a digit or another group merges with them into one word that never matches.
 * 2. `/` separates alternatives (OR, lowest precedence). An empty alternative (no characters at
 *    all) is ignored; a filter with no alternative left is false.
 * 3. Inside an alternative every term must hold (AND). A word is a maximal run of ASCII letters
 *    and digits, optionally preceded directly by `!`. Every other character separates words, and
 *    an alternative that has characters but no words is true.
 *
 * AST shape (§6.2 table): one alternative is not wrapped in `or`, one term is not wrapped in
 * `and`, an alternative without words is `and []` (true), no alternative left is `or []` (false),
 * a level word is `minLevel`, and a merged word is a `word` spelled with its groups' canonical
 * content (`Orc(Warrior/Mage)`).
 */

export interface FilterQuirk {
  /** UTF-16 offset in the filter text. */
  readonly offset: number;
  readonly message: string;
}

export interface ParsedFilter {
  readonly ast: FilterAst;
  readonly quirks: readonly FilterQuirk[];
  /** A level word (`minLevel`) occurs, so `RXP028` applies (§6.5). */
  readonly usesLevel: boolean;
}

type Token =
  | { readonly type: 'or'; readonly offset: number }
  | { readonly type: 'term'; readonly ast: FilterAst; readonly offset: number };

interface State {
  usesLevel: boolean;
}

const isAlnum = (char: string | undefined): boolean => char !== undefined && /^[A-Za-z0-9]$/.test(char);
const isBlank = (char: string | undefined): boolean => char === ' ' || char === '\t';

const TRUE: FilterAst = { kind: 'and', exprs: [] };
const FALSE: FilterAst = { kind: 'or', exprs: [] };

interface NumberWord {
  readonly level: number;
  readonly odd: boolean;
}

/** Level words: digits, and the other forms RXP's number conversion reads (`1e1`, `0x10`). */
function numberWord(word: string): NumberWord | null {
  if (/^\d+$/.test(word)) return { level: Number(word), odd: false };
  if (/^0[xX][0-9a-fA-F]+$/.test(word)) return { level: parseInt(word.slice(2), 16), odd: true };
  if (/^\d+[eE]\d+$/.test(word)) {
    const value = Number(word);
    return Number.isFinite(value) ? { level: value, odd: true } : null;
  }
  return null;
}

function wordTerm(word: string, negated: boolean, offset: number, quirks: FilterQuirk[], state: State): FilterAst {
  const number = numberWord(word);
  let ast: FilterAst;
  if (number !== null) {
    state.usesLevel = true;
    if (number.odd) quirks.push({ offset, message: `"${word}" is read as the number ${String(number.level)} (a level test)` });
    ast = { kind: 'minLevel', level: number.level };
  } else {
    const info = classifyFilterWord(word);
    if (info.kind === 'unknown') {
      quirks.push({
        offset,
        message:
          info.caseHint !== null
            ? `"${word}" never matches: this word is case-sensitive in RXP (did you mean "${info.caseHint}"?)`
            : `"${word}" is not a filter word RXP knows on Forever, so it is always false`,
      });
    }
    ast = { kind: 'word', word };
  }
  return negated ? { kind: 'not', expr: ast } : ast;
}

interface Group {
  /** Index of `(`. */
  readonly open: number;
  /** Index of the first `)` after it. */
  readonly close: number;
  /** Written `!(`: the `!` belongs to the group. */
  readonly negated: boolean;
}

/** The group that starts at `index` (`(` or `!(`) and ends at the first `)` before `limit`, or null. */
function groupAt(text: string, index: number, limit: number): Group | null {
  const negated = text[index] === '!' && text[index + 1] === '(';
  const open = negated ? index + 1 : index;
  if (text[open] !== '(' || open >= limit) return null;
  const close = text.indexOf(')', open + 1);
  return close < 0 || close >= limit ? null : { open, close, negated };
}

/** `[start, end)` without the blanks at both ends. */
function trimmed(text: string, start: number, end: number): readonly [number, number] {
  let from = start;
  let to = end;
  while (from < to && isBlank(text[from])) from += 1;
  while (to > from && isBlank(text[to - 1])) to -= 1;
  return [from, to];
}

type Piece = { readonly kind: 'word'; readonly start: number; readonly end: number } | { readonly kind: 'group'; readonly group: Group; readonly start: number; readonly end: number };

/** Words and groups written directly together, from `at` (§6.2 rule 1). */
function readPieces(text: string, at: number, limit: number): Piece[] {
  const pieces: Piece[] = [];
  let cursor = at;
  for (;;) {
    if (cursor < limit && isAlnum(text[cursor])) {
      let end = cursor;
      while (end < limit && isAlnum(text[end])) end += 1;
      pieces.push({ kind: 'word', start: cursor, end });
      cursor = end;
      continue;
    }
    const group = groupAt(text, cursor, limit);
    if (group === null) return pieces;
    pieces.push({ kind: 'group', group, start: cursor, end: group.close + 1 });
    cursor = group.close + 1;
  }
}

function groupTerm(text: string, group: Group, quirks: FilterQuirk[], state: State): FilterAst {
  const [from, to] = trimmed(text, group.open + 1, group.close);
  if (text.slice(group.open + 1, group.close).includes('(')) {
    quirks.push({ offset: group.open, message: 'nested parentheses: RXP ends the group at the first ")" and reads the inner "(" as a separator' });
  }
  const inner = parseFlat(text, from, to, quirks, state);
  return group.negated ? { kind: 'not', expr: inner } : inner;
}

/** The canonical spelling of a merged word: its letters, and each group with canonical content. */
function mergedSpelling(text: string, pieces: readonly Piece[]): string {
  return pieces
    .map((piece) => {
      if (piece.kind === 'word') return text.slice(piece.start, piece.end);
      const [from, to] = trimmed(text, piece.group.open + 1, piece.group.close);
      const content = printGroupContent(parseFlat(text, from, to, [], { usesLevel: false })) ?? text.slice(from, to).replace(/[ \t]+/g, ' ');
      return `${piece.group.negated ? '!' : ''}(${content})`;
    })
    .join('');
}

function tokenize(text: string, start: number, limit: number, allowGroups: boolean, quirks: FilterQuirk[], state: State): Token[] {
  const tokens: Token[] = [];
  let index = start;
  while (index < limit) {
    const char = text[index];
    const next = index + 1 < limit ? text[index + 1] : undefined;
    const negatedWord = char === '!' && isAlnum(next);
    if (allowGroups) {
      const at = negatedWord ? index + 1 : index;
      if (isAlnum(text[at]) || groupAt(text, at, limit) !== null) {
        const pieces = readPieces(text, at, limit);
        const [first] = pieces;
        const end = pieces[pieces.length - 1]?.end ?? at + 1;
        let ast: FilterAst;
        if (pieces.length === 1 && first?.kind === 'group') ast = groupTerm(text, first.group, quirks, state);
        else if (pieces.length === 1 && first?.kind === 'word') ast = wordTerm(text.slice(first.start, first.end), negatedWord, first.start, quirks, state);
        else {
          const word = mergedSpelling(text, pieces);
          quirks.push({
            offset: at,
            message: `"${text.slice(at, end)}" is one word in RXP, because a group is written directly against a word or another group; that word never matches`,
          });
          ast = negatedWord ? { kind: 'not', expr: { kind: 'word', word } } : { kind: 'word', word };
        }
        tokens.push({ type: 'term', ast, offset: index });
        index = end;
        continue;
      }
      if (char === '(' || (char === '!' && next === '(')) {
        const open = char === '!' ? index + 1 : index;
        quirks.push({ offset: open, message: 'unbalanced "(": RXP reads it as a separator' });
        if (char === '!') quirks.push({ offset: index, message: '"!" is not directly before a word, so RXP ignores it' });
        index = open + 1;
        continue;
      }
    } else if (isAlnum(char) || negatedWord) {
      const wordStart = negatedWord ? index + 1 : index;
      let end = wordStart;
      while (end < limit && isAlnum(text[end])) end += 1;
      tokens.push({ type: 'term', ast: wordTerm(text.slice(wordStart, end), negatedWord, wordStart, quirks, state), offset: index });
      index = end;
      continue;
    }
    if (char === '/') {
      tokens.push({ type: 'or', offset: index });
      index += 1;
      continue;
    }
    if (char === '<' && next === '<') {
      quirks.push({ offset: index, message: 'a second "<<" does not start another filter: RXP ANDs the words on both sides' });
      index += 2;
      continue;
    }
    if (char === ')') quirks.push({ offset: index, message: allowGroups ? 'unmatched ")": RXP reads it as a separator' : '")" inside a group' });
    else if (char === '(') {
      // Inside a group: already reported as nesting.
    } else if (char === '!') quirks.push({ offset: index, message: '"!" is not directly before a word, so RXP ignores it' });
    index += 1;
  }
  return tokens;
}

/** Alternatives of `[start, end)` (§6.2 rule 2): empty ones are left out; none left is `or []`. */
function build(tokens: readonly Token[], start: number, end: number, quirks: FilterQuirk[]): FilterAst {
  const alternatives: { terms: FilterAst[]; start: number; end: number }[] = [];
  let current = { terms: [] as FilterAst[], start, end };
  for (const token of tokens) {
    if (token.type === 'or') {
      current.end = token.offset;
      alternatives.push(current);
      current = { terms: [], start: token.offset + 1, end };
    } else current.terms.push(token.ast);
  }
  alternatives.push(current);
  const kept: FilterAst[] = [];
  const empty: number[] = [];
  for (const alternative of alternatives) {
    if (alternative.end <= alternative.start) {
      empty.push(alternative.start);
      continue;
    }
    const [only] = alternative.terms;
    if (alternative.terms.length === 0) {
      quirks.push({ offset: alternative.start, message: 'an alternative that has characters but no words is always true in RXP' });
      kept.push(TRUE);
    } else kept.push(alternative.terms.length === 1 && only !== undefined ? only : { kind: 'and', exprs: alternative.terms });
  }
  if (kept.length === 0) {
    quirks.push({ offset: start, message: 'every alternative of this filter is empty, so RXP never matches it' });
    return FALSE;
  }
  for (const offset of empty) quirks.push({ offset, message: 'an empty alternative (nothing between two "/", or a "/" at the start or end) is ignored by RXP' });
  const [first] = kept;
  return kept.length === 1 && first !== undefined ? first : { kind: 'or', exprs: kept };
}

/** A group's content (already trimmed to `[start, end)`): a filter without groups. */
function parseFlat(text: string, start: number, end: number, quirks: FilterQuirk[], state: State): FilterAst {
  return build(tokenize(text, start, end, false, quirks, state), start, end, quirks);
}

/** Parses the text after `<<` (already cut from the line; blanks at either end are ignored). */
export function parseFilter(text: string): ParsedFilter {
  const quirks: FilterQuirk[] = [];
  const state: State = { usesLevel: false };
  const [start, end] = trimmed(text, 0, text.length);
  const ast = build(tokenize(text, start, end, true, quirks, state), start, end, quirks);
  return { ast, quirks: [...quirks].sort((a, b) => a.offset - b.offset), usesLevel: state.usesLevel };
}

/** True when the AST contains a level word. */
export function filterUsesLevel(ast: FilterAst): boolean {
  switch (ast.kind) {
    case 'minLevel':
      return true;
    case 'word':
      return false;
    case 'not':
      return filterUsesLevel(ast.expr);
    case 'and':
    case 'or':
      return ast.exprs.some(filterUsesLevel);
  }
}

// ---------------------------------------------------------------------------------------------
// Printing (§13.4 rule 10)

const WORD = /^[A-Za-z0-9]+$/;
const MERGED_SHAPE = /^(?:[A-Za-z0-9]+|!?\([A-Za-z0-9 !/-]*\))+$/;

/** A merged word (§6.2 rule 1) in the spelling the parser gives it, so it reads back unchanged. */
function isMergedWord(word: string): boolean {
  if (!word.includes('(') || word.includes('--') || !MERGED_SHAPE.test(word)) return false;
  const again = parseFilter(word).ast;
  return again.kind === 'word' && again.word === word;
}

/** A word or level; merged words only at the top level of a filter (a group holds no groups). */
function printAtom(ast: FilterAst, topLevel: boolean): string | null {
  if (ast.kind === 'word') return WORD.test(ast.word) || (topLevel && isMergedWord(ast.word)) ? ast.word : null;
  if (ast.kind === 'minLevel') return Number.isSafeInteger(ast.level) && ast.level >= 0 ? String(ast.level) : null;
  return null;
}

/** A term inside a group: a word, a level or a negated one. */
function printGroupTerm(ast: FilterAst): string | null {
  if (ast.kind === 'not') {
    const atom = printAtom(ast.expr, false);
    return atom === null ? null : `!${atom}`;
  }
  return printAtom(ast, false);
}

/** Content of a group: RXP groups hold words only (no nested groups). */
function printGroupContent(ast: FilterAst): string | null {
  const printAlternative = (alt: FilterAst): string | null => {
    if (alt.kind === 'and') {
      if (alt.exprs.length === 0) return '-';
      const terms = alt.exprs.map(printGroupTerm);
      return terms.some((term) => term === null) ? null : terms.join(' ');
    }
    return printGroupTerm(alt);
  };
  if (ast.kind === 'or') {
    if (ast.exprs.length === 0) return '/';
    const alts = ast.exprs.map(printAlternative);
    return alts.some((alt) => alt === null) ? null : alts.join('/');
  }
  return printAlternative(ast);
}

/** A term of a top-level alternative: an atom, a negated atom, or a (negated) group. */
function printTerm(ast: FilterAst): string | null {
  if (ast.kind === 'word' || ast.kind === 'minLevel') return printAtom(ast, true);
  if (ast.kind === 'not') {
    const inner = ast.expr;
    if (inner.kind === 'word' || inner.kind === 'minLevel') {
      // `!` before `(` would start a group, so a merged word that starts with a group cannot be negated.
      if (inner.kind === 'word' && !isAlnum(inner.word[0])) return null;
      const atom = printAtom(inner, true);
      return atom === null ? null : `!${atom}`;
    }
    if (inner.kind === 'not') return null; // `!!x` has no RXP form
    const content = printGroupContent(inner);
    return content === null ? null : `!(${content})`;
  }
  const content = printGroupContent(ast);
  return content === null ? null : `(${content})`;
}

function printAlternative(ast: FilterAst): string | null {
  if (ast.kind === 'and') {
    if (ast.exprs.length === 0) return '-';
    const terms = ast.exprs.map(printTerm);
    return terms.some((term) => term === null) ? null : terms.join(' ');
  }
  return printTerm(ast);
}

/**
 * Canonical text of a filter (§13.4 rule 10): alternatives joined by `/`, terms by one space, `!`
 * directly before its word or `(`, word spelling kept exactly; an alternative without words is
 * `-`, no alternative left is `/`. Null when the AST has no RXP form (a word outside
 * `[A-Za-z0-9]+` that is not a merged word, nested groups, `!!`, or a non-integer level).
 */
export function printFilter(ast: FilterAst): string | null {
  if (ast.kind === 'or') return ast.exprs.length === 0 ? '/' : joinAlternatives(ast.exprs);
  return printAlternative(ast);
}

function joinAlternatives(exprs: readonly FilterAst[]): string | null {
  const alts = exprs.map((alt) => (alt.kind === 'or' ? wrapGroup(alt) : printAlternative(alt)));
  return alts.some((alt) => alt === null) ? null : alts.join('/');
}

function wrapGroup(ast: FilterAst): string | null {
  const content = printGroupContent(ast);
  return content === null ? null : `(${content})`;
}
