import luaparse, { type Chunk, type Comment, type StringLiteral } from 'luaparse';

/**
 * Reading Lua source bytes (D-009). QuestieDB files are UTF-8, but Lua strings are byte strings,
 * so luaparse runs in `pseudo-latin1` mode on the bytes decoded one-to-one as Latin-1; every string
 * literal and comment is then decoded back from its bytes as strict UTF-8.
 */

export class LuaSourceError extends Error {
  constructor(file: string, message: string) {
    super(`${file}: ${message}`);
    this.name = 'LuaSourceError';
  }
}

/** Bytes → one character per byte. A UTF-8 byte-order mark fails closed (Lua 5.1 rejects it too). */
export function bytesToLuaText(bytes: Uint8Array, file: string): string {
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    throw new LuaSourceError(file, 'starts with a UTF-8 byte-order mark');
  }
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('latin1');
}

const UTF8 = new TextDecoder('utf-8', { fatal: true });

/** A `pseudo-latin1` string (one character per byte) decoded as strict UTF-8. */
export function decodeLuaBytes(latin1: string, where: string): string {
  try {
    return UTF8.decode(Buffer.from(latin1, 'latin1'));
  } catch {
    throw new LuaSourceError(where, 'string is not valid UTF-8');
  }
}

export interface ParseOptions {
  /** Keep comments (needed only for the zone names, DATA_PROVENANCE §6.6). */
  readonly comments?: boolean;
  /** Keep line/column locations (error messages, comment matching). Costs memory on big files. */
  readonly locations?: boolean;
}

export function parseLua(text: string, file: string, options: ParseOptions = {}): Chunk {
  try {
    return luaparse.parse(text, {
      luaVersion: '5.1',
      encodingMode: 'pseudo-latin1',
      comments: options.comments ?? false,
      locations: options.locations ?? false,
      ranges: false,
      scope: false,
    });
  } catch (error) {
    throw new LuaSourceError(file, `luaparse: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * The file line on which the content of a long-bracket string starts. Lua (and luaparse) skip one
 * newline directly after the opening bracket, so a string written `[[\nreturn {` starts on the
 * next line, while `[[return {` starts on the bracket's own line.
 */
export function longStringContentLine(node: StringLiteral, file: string): number {
  const line = node.loc?.start.line;
  if (line === undefined) throw new LuaSourceError(file, 'string literal has no location (parse with locations)');
  const match = /^\[(=*)\[(\r\n|\n|\r)?/.exec(node.raw);
  if (match === null) throw new LuaSourceError(file, `line ${String(line)}: expected a long-bracket string`);
  return match[2] === undefined ? line : line + 1;
}

/** `--` line comments by line (trimmed text). Block comments and several comments on a line fail closed. */
export function lineCommentsByLine(chunk: Chunk, file: string): ReadonlyMap<number, { readonly text: string; readonly column: number }> {
  const out = new Map<number, { readonly text: string; readonly column: number }>();
  for (const comment of chunk.comments ?? []) {
    const loc = comment.loc;
    if (loc === undefined) throw new LuaSourceError(file, 'comment has no location (parse with locations)');
    if (isBlockComment(comment)) {
      throw new LuaSourceError(file, `line ${String(loc.start.line)}: block comments are not expected here`);
    }
    if (out.has(loc.start.line)) throw new LuaSourceError(file, `line ${String(loc.start.line)}: two comments on one line`);
    out.set(loc.start.line, { text: decodeLuaBytes(comment.value, `${file}:${String(loc.start.line)}`).trim(), column: loc.start.column });
  }
  return out;
}

const isBlockComment = (comment: Comment): boolean => /^--\[=*\[/.test(comment.raw);
