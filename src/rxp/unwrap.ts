import { type RawDiagnostic, rawDiagnostic } from './diagnostics';
import { splitPhysicalLines } from './cst';
import { REPLACEMENT_CHARACTER, utf8Decode } from './text';

/**
 * Unwrap (docs/RXP.md §3, ARCHITECTURE §10 step 1): turns pasted input into guide texts.
 *
 * - Raw guide text is one guide, taken exactly as given.
 * - A Lua file (an addon's guide file) is read statically: a small tokenizer skips comments and
 *   strings and finds `RXPGuides.RegisterGuide(...)` calls whose arguments are string literals.
 *   No Lua is ever executed.
 * - A RestedXP protected import string is recognised by its shape and refused. It is never
 *   decoded, decrypted, logged or stored, and no message repeats it (§3.3).
 */

export interface UnwrappedGuide {
  /** The guide text: the input itself, or the extracted (and, for quoted strings, unescaped) string. */
  readonly text: string;
  readonly form: 'raw' | 'long-bracket' | 'quoted';
  /** Long-bracket level (`[==[` is 2); null otherwise. */
  readonly level: number | null;
  /** First argument of the two/three-argument form, or null. */
  readonly groupArg: string | null;
  /** Third argument (the `defaultFor` filter), or null. */
  readonly defaultForArg: string | null;
  /** For each text line (index = line − 1), the Lua file line it starts on; empty for raw text. */
  readonly fileLines: readonly number[];
  /** Columns to add on the first text line (text that starts right after the opening bracket). */
  readonly firstLineColumnOffset: number;
}

export type UnwrapResult =
  | { readonly kind: 'refused'; readonly guides: readonly []; readonly diagnostics: readonly RawDiagnostic[] }
  | { readonly kind: 'raw' | 'lua'; readonly guides: readonly UnwrappedGuide[]; readonly diagnostics: readonly RawDiagnostic[] };

/** Does the input have a line whose content starts with `#` or `step`, as guide text has (§3.3, §4 P5)? */
const hasGuideLine = (input: string): boolean => /(?:^|[\r\n])[ \t]*(?:#|step)/.test(input);

/**
 * Our heuristics for RestedXP's account-bound import strings (§3.3). Input with a line that starts
 * with `#` or `step` is guide text and never refused. Otherwise: (1) a count, a hash and `:` on
 * the first line, with no line break before them; (2) runs of `%`-terminated base64 segments; or
 * (3) a trailing `|version`. The line conditions keep real guides from being refused (a header
 * line `#name 01|02: x`, a header-only text ending in `#version 3|12`, a percent-encoded URL).
 */
export function looksProtected(input: string): boolean {
  const trimmed = input.trim();
  if (hasGuideLine(trimmed)) return false;
  return /^[^\d\r\n]*\d+\|-?\d+:/.test(trimmed) || /-?\d+\D[A-Za-z0-9+/=]{16,}%/.test(trimmed) || /\|\d+\s*$/.test(trimmed);
}

const PROTECTED_MESSAGE =
  'This looks like a RestedXP protected import string. Those are licensed to one account and are not supported. Paste guide text or a custom-guide .lua file instead.';

// ---------------------------------------------------------------------------------------------
// Lua tokenizer (enough of Lua 5.1's lexical rules to skip comments and strings correctly)

interface LuaString {
  readonly text: string;
  readonly form: 'long-bracket' | 'quoted';
  readonly level: number | null;
  readonly fileLines: readonly number[];
  readonly firstLineColumnOffset: number;
  readonly terminated: boolean;
}

type LuaToken =
  | { readonly type: 'name'; readonly value: string; readonly line: number; readonly column: number }
  | { readonly type: 'string'; readonly value: LuaString; readonly line: number; readonly column: number }
  | { readonly type: 'op'; readonly value: string; readonly line: number; readonly column: number }
  | { readonly type: 'number'; readonly value: string; readonly line: number; readonly column: number };

class LuaLexer {
  private index = 0;
  private line = 1;
  private lineStart = 0;
  /** The last column computed: `columnValue` is the column of UTF-16 index `columnAt` on the line that starts at `columnLine`. */
  private columnLine = 0;
  private columnAt = 0;
  private columnValue = 1;

  constructor(private readonly source: string) {}

  /**
   * 1-based column of `at` in code points, as `codePointColumn` counts it. Tokens come in source
   * order, so the count continues from the previous token on the same line: linear in the line
   * length rather than quadratic (a minified one-line file stays fast).
   */
  private column(at: number): number {
    if (this.columnLine !== this.lineStart || at < this.columnAt) {
      this.columnLine = this.lineStart;
      this.columnAt = this.lineStart;
      this.columnValue = 1;
    }
    let index = this.columnAt;
    let column = this.columnValue;
    while (index < at) {
      const code = this.source.charCodeAt(index);
      index += code >= 0xd800 && code <= 0xdbff && index + 1 <= at ? 2 : 1;
      column += 1;
    }
    this.columnAt = index;
    this.columnValue = column;
    return column;
  }

  /** Advances over one line break at `index` (CRLF counts once, as in the CST). */
  private newline(): void {
    if (this.source[this.index] === '\r' && this.source[this.index + 1] === '\n') this.index += 2;
    else this.index += 1;
    this.line += 1;
    this.lineStart = this.index;
  }

  private isNewline(at: number): boolean {
    const char = this.source[at];
    return char === '\n' || char === '\r';
  }

  /** `[` followed by `=`* and `[`: the level, or -1. */
  private longBracketLevel(at: number): number {
    if (this.source[at] !== '[') return -1;
    let level = 0;
    while (this.source[at + 1 + level] === '=') level += 1;
    return this.source[at + 1 + level] === '[' ? level : -1;
  }

  private readLongBracket(level: number): LuaString {
    const openLine = this.line;
    this.index += level + 2;
    let firstLineColumnOffset = 0;
    if (this.isNewline(this.index)) this.newline();
    else firstLineColumnOffset = this.column(this.index) - 1;
    const start = this.index;
    const startLine = this.line;
    const close = `]${'='.repeat(level)}]`;
    const end = this.source.indexOf(close, this.index);
    const stop = end < 0 ? this.source.length : end;
    while (this.index < stop) {
      if (this.isNewline(this.index)) this.newline();
      else this.index += 1;
    }
    const text = this.source.slice(start, stop);
    this.index = end < 0 ? this.source.length : stop + close.length;
    const fileLines = splitPhysicalLines(text).map((_, k) => startLine + k);
    return {
      text,
      form: 'long-bracket',
      level,
      fileLines: fileLines.length > 0 ? fileLines : [startLine],
      firstLineColumnOffset: startLine === openLine ? firstLineColumnOffset : 0,
      terminated: end >= 0,
    };
  }

  private readQuoted(quote: string): LuaString {
    const startLine = this.line;
    const firstLineColumnOffset = this.column(this.index);
    this.index += 1;
    let text = '';
    const charLines: number[] = [];
    let pendingBytes: number[] = [];
    const flushBytes = (): void => {
      if (pendingBytes.length === 0) return;
      const decoded = utf8Decode(pendingBytes);
      for (let k = 0; k < decoded.length; k += 1) charLines.push(this.line);
      text += decoded;
      pendingBytes = [];
    };
    const push = (value: string): void => {
      flushBytes();
      for (let k = 0; k < value.length; k += 1) charLines.push(this.line);
      text += value;
    };
    let terminated = false;
    while (this.index < this.source.length) {
      const char = this.source[this.index] ?? '';
      if (char === quote) {
        this.index += 1;
        terminated = true;
        break;
      }
      if (this.isNewline(this.index)) break; // an unescaped line break ends a Lua short string with an error
      if (char !== '\\') {
        push(char);
        this.index += 1;
        continue;
      }
      const next = this.source[this.index + 1] ?? '';
      const simple: Readonly<Record<string, string>> = { n: '\n', t: '\t', r: '\r', a: '\u0007', b: '\b', f: '\f', v: '\v', '\\': '\\', '"': '"', "'": "'" };
      const mapped = simple[next];
      if (mapped !== undefined) {
        push(mapped);
        this.index += 2;
      } else if (next === '\n' || next === '\r') {
        this.index += 1;
        push('\n');
        this.newline();
      } else if (/[0-9]/.test(next)) {
        const digits = /^[0-9]{1,3}/.exec(this.source.slice(this.index + 1))?.[0] ?? '';
        const value = Number(digits);
        this.index += 1 + digits.length;
        if (value < 128) push(String.fromCharCode(value));
        else if (value < 256) pendingBytes.push(value);
        else push(REPLACEMENT_CHARACTER); // Lua 5.1 rejects escapes above 255
      } else {
        // Lua 5.1 keeps the character after an unknown escape.
        push(next);
        this.index += 2;
      }
    }
    flushBytes();
    const fileLines: number[] = [];
    let offset = 0;
    for (const part of splitPhysicalLines(text)) {
      fileLines.push(charLines[offset] ?? charLines[charLines.length - 1] ?? startLine);
      offset += part.raw.length + part.eol.length;
    }
    return { text, form: 'quoted', level: null, fileLines: fileLines.length > 0 ? fileLines : [startLine], firstLineColumnOffset, terminated };
  }

  next(): LuaToken | null {
    const source = this.source;
    while (this.index < source.length) {
      const char = source[this.index] ?? '';
      if (this.isNewline(this.index)) {
        this.newline();
        continue;
      }
      if (char === ' ' || char === '\t' || char === '\f' || char === '\v') {
        this.index += 1;
        continue;
      }
      if (char === '-' && source[this.index + 1] === '-') {
        const level = this.longBracketLevel(this.index + 2);
        if (level >= 0) {
          this.index += 2;
          this.readLongBracket(level);
        } else {
          while (this.index < source.length && !this.isNewline(this.index)) this.index += 1;
        }
        continue;
      }
      const line = this.line;
      const column = this.column(this.index);
      const level = this.longBracketLevel(this.index);
      if (level >= 0) return { type: 'string', value: this.readLongBracket(level), line, column };
      if (char === '"' || char === "'") return { type: 'string', value: this.readQuoted(char), line, column };
      const name = /^[A-Za-z_][A-Za-z0-9_]*/.exec(source.slice(this.index, this.index + 256));
      if (name !== null) {
        this.index += name[0].length;
        return { type: 'name', value: name[0], line, column };
      }
      const number = /^(?:0[xX][0-9a-fA-F]+|\d+\.?\d*(?:[eE][+-]?\d+)?|\.\d+(?:[eE][+-]?\d+)?)/.exec(source.slice(this.index, this.index + 64));
      if (number !== null) {
        this.index += number[0].length;
        return { type: 'number', value: number[0], line, column };
      }
      const op = /^(?:\.\.\.|\.\.|==|~=|<=|>=)/.exec(source.slice(this.index, this.index + 3))?.[0] ?? char;
      this.index += op.length;
      return { type: 'op', value: op, line, column };
    }
    return null;
  }
}

function tokenizeLua(source: string): LuaToken[] {
  const lexer = new LuaLexer(source);
  const tokens: LuaToken[] = [];
  for (let token = lexer.next(); token !== null; token = lexer.next()) tokens.push(token);
  return tokens;
}

const isOp = (token: LuaToken | undefined, value: string): boolean => token?.type === 'op' && token.value === value;
const isName = (token: LuaToken | undefined, value: string): boolean => token?.type === 'name' && token.value === value;

/** Index just after the `)` matching the `(` at `open`, or the end. */
function skipCall(tokens: readonly LuaToken[], open: number): number {
  let depth = 0;
  for (let index = open; index < tokens.length; index += 1) {
    if (isOp(tokens[index], '(')) depth += 1;
    else if (isOp(tokens[index], ')')) {
      depth -= 1;
      if (depth === 0) return index + 1;
    }
  }
  return tokens.length;
}

/** Index of the next `RXPGuides . RegisterGuide` at or after `from` (not a field of something else), or -1. */
function findRegistration(tokens: readonly LuaToken[], from: number): number {
  for (let index = from; index + 2 < tokens.length; index += 1) {
    if (!isName(tokens[index], 'RXPGuides') || !isOp(tokens[index + 1], '.') || !isName(tokens[index + 2], 'RegisterGuide')) continue;
    const before = tokens[index - 1];
    if (isOp(before, '.') || isOp(before, ':')) continue;
    return index;
  }
  return -1;
}

function extractLua(tokens: readonly LuaToken[]): { guides: UnwrappedGuide[]; diagnostics: RawDiagnostic[] } {
  const guides: UnwrappedGuide[] = [];
  const diagnostics: RawDiagnostic[] = [];
  let index = 0;
  const guard = (from: number, to: number): void => {
    const first = tokens.slice(from, to).find((token) => !isOp(token, ';'));
    if (first !== undefined) {
      diagnostics.push(rawDiagnostic('RXP021-lua-guard-ignored', first.line, first.column, 'Top-level Lua other than RXPGuides.RegisterGuide calls (for example a faction or locale guard) is ignored; nothing is executed.'));
    }
  };
  while (index < tokens.length) {
    const call = findRegistration(tokens, index);
    if (call < 0) {
      guard(index, tokens.length);
      break;
    }
    guard(index, call);
    const head = tokens[call];
    const open = call + 3;
    const at = { line: head?.line ?? 1, column: head?.column ?? 1 };
    if (!isOp(tokens[open], '(')) {
      diagnostics.push(rawDiagnostic('RXP020-lua-dynamic', at.line, at.column, 'RXPGuides.RegisterGuide is not called here as RegisterGuide(...) with string literals; nothing is extracted.'));
      // A call without parentheses (`RegisterGuide [[...]]`) takes one string argument: skip it too.
      index = tokens[open]?.type === 'string' ? open + 1 : open;
      continue;
    }
    const args: LuaString[] = [];
    let cursor = open + 1;
    let dynamic = false;
    for (;;) {
      const token = tokens[cursor];
      if (token?.type !== 'string' || !token.value.terminated) {
        dynamic = true;
        break;
      }
      args.push(token.value);
      cursor += 1;
      if (isOp(tokens[cursor], ')')) break;
      if (isOp(tokens[cursor], ',') && args.length < 3) {
        cursor += 1;
        continue;
      }
      dynamic = true;
      break;
    }
    if (dynamic || args.length === 0) {
      diagnostics.push(
        rawDiagnostic('RXP020-lua-dynamic', at.line, at.column, 'This RegisterGuide call has an argument that is not a complete string literal (a variable, a ".." join or a function call); it is skipped and never evaluated.'),
      );
      index = skipCall(tokens, open);
      continue;
    }
    const [first, second, third] = args;
    const textArg = args.length === 1 ? first : second;
    if (textArg !== undefined) {
      guides.push({
        text: textArg.text,
        form: textArg.form,
        level: textArg.level,
        groupArg: args.length >= 2 ? (first?.text ?? null) : null,
        defaultForArg: args.length === 3 ? (third?.text ?? null) : null,
        fileLines: textArg.fileLines,
        firstLineColumnOffset: textArg.firstLineColumnOffset,
      });
    }
    index = cursor + 1;
  }
  return { guides, diagnostics };
}

/** Unwraps pasted input into guide texts (§3). */
export function unwrapRxpInput(input: string): UnwrapResult {
  if (looksProtected(input)) return { kind: 'refused', guides: [], diagnostics: [rawDiagnostic('RXP019-protected-format', 0, 0, PROTECTED_MESSAGE)] };
  if (input.includes('RegisterGuide')) {
    const tokens = tokenizeLua(input);
    if (findRegistration(tokens, 0) >= 0) {
      const { guides, diagnostics } = extractLua(tokens);
      return { kind: 'lua', guides, diagnostics };
    }
  }
  return {
    kind: 'raw',
    guides: [{ text: input, form: 'raw', level: null, groupArg: null, defaultForArg: null, fileLines: [], firstLineColumnOffset: 0 }],
    diagnostics: [],
  };
}

/**
 * The smallest long-bracket level for `text` (§13.4 rule 14): its closing sequence must not occur
 * in the text or run into its end, and the level is at least 1 when the text contains `[[`.
 */
export function longBracketLevelFor(text: string): number {
  for (let level = text.includes('[[') ? 1 : 0; ; level += 1) {
    const close = `]${'='.repeat(level)}]`;
    if ((text + close).indexOf(close) === text.length) return level;
  }
}

const BACKSLASH = String.fromCharCode(92);

/** Escapes a string as a Lua double-quoted literal (for the wrapper's group and defaultFor arguments). */
export function luaQuoted(value: string): string {
  let out = '"';
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    if (char === '"' || char === BACKSLASH) out += BACKSLASH + char;
    else if (char === '\n') out += `${BACKSLASH}n`;
    else if (char === '\r') out += `${BACKSLASH}r`;
    else if (code < 32 || code === 127) out += BACKSLASH + String(code);
    else out += char;
  }
  return `${out}"`;
}
