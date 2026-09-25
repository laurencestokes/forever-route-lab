import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The git tree id of a directory, computed in-process (review finding data-F7), for a copy of the
 * repository without `.git` (a source archive): what `git add -A -- <dir>` followed by
 * `git write-tree --prefix=<dir>/` records with a fresh index (lib/git.ts `workingTreeId`).
 *
 * It follows the parts of git this repository relies on: `.gitignore` files (the root one and any
 * on the way to and inside the directory; negation, directory-only, anchored and `**` patterns),
 * the `text` / `eol` / `binary` attributes of `.gitattributes` files with git's own text heuristic
 * for `text=auto` (convert.c `gather_stats` and `convert_is_binary`), CRLF → LF on add, blob and
 * tree object hashing (SHA-1), and git's tree entry order. Not covered, so they fail closed:
 * symbolic links and submodules. `.git/info/exclude` and `core.excludesFile` cannot apply (there
 * is no `.git`).
 */

// ---------------------------------------------------------------------------------------------
// Patterns

interface Pattern {
  readonly regex: RegExp;
  readonly negated: boolean;
  readonly directoryOnly: boolean;
  /** Directory (repository-relative, '' for the root) the pattern file lives in. */
  readonly base: string;
}

/** A gitignore/gitattributes glob as a regular expression over a base-relative `/` path. */
export function globToRegExp(glob: string): RegExp {
  const anchored = glob.includes('/');
  const body = glob.startsWith('/') ? glob.slice(1) : glob;
  let re = '';
  for (let i = 0; i < body.length; i += 1) {
    const c = body[i] ?? '';
    if (c === '*') {
      if (body[i + 1] === '*') {
        const atStart = i === 0;
        const beforeSlash = body[i - 1] === '/';
        const afterSlash = body[i + 2] === '/' || i + 2 === body.length;
        if ((atStart || beforeSlash) && afterSlash) {
          if (i + 2 === body.length) re += '.*';
          else re += '(?:.*/)?';
          i += body[i + 2] === '/' ? 2 : 1;
          continue;
        }
      }
      re += '[^/]*';
    } else if (c === '?') {
      re += '[^/]';
    } else if (c === '[') {
      const close = body.indexOf(']', i + 2);
      if (close < 0) re += '\\[';
      else {
        let set = body.slice(i + 1, close);
        if (set.startsWith('!')) set = `^${set.slice(1)}`;
        re += `[${set.replace(/\\/g, '\\\\')}]`;
        i = close;
      }
    } else if (c === '\\' && i + 1 < body.length) {
      i += 1;
      re += (body[i] ?? '').replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
    } else {
      re += c.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
    }
  }
  return new RegExp(anchored ? `^${re}$` : `^(?:.*/)?${re}$`);
}

function readPatterns(repoRoot: string, base: string, file: string): readonly Pattern[] {
  const path = join(repoRoot, base, file);
  if (!existsSync(path)) return [];
  const out: Pattern[] = [];
  for (const rawLine of readFileSync(path, 'utf8').split(/\r?\n/)) {
    let line = rawLine.replace(/(?<!\\)\s+$/, '');
    if (line === '' || line.startsWith('#')) continue;
    const negated = line.startsWith('!');
    if (negated) line = line.slice(1);
    const directoryOnly = line.endsWith('/');
    if (directoryOnly) line = line.slice(0, -1);
    out.push({ regex: globToRegExp(line), negated, directoryOnly, base });
  }
  return out;
}

const relativeTo = (base: string, path: string): string | null => {
  if (base === '') return path;
  return path.startsWith(`${base}/`) ? path.slice(base.length + 1) : null;
};

/** gitignore: the last matching pattern decides; a match on a negated pattern re-includes. */
function ignoredBy(patterns: readonly Pattern[], path: string, isDirectory: boolean): boolean {
  let ignored = false;
  for (const pattern of patterns) {
    if (pattern.directoryOnly && !isDirectory) continue;
    const rel = relativeTo(pattern.base, path);
    if (rel !== null && pattern.regex.test(rel)) ignored = !pattern.negated;
  }
  return ignored;
}

interface AttributeLine {
  readonly regex: RegExp;
  readonly base: string;
  /** 'set' | 'unset' | 'auto' for `text`; the eol value when given. */
  readonly text: 'set' | 'unset' | 'auto' | null;
  readonly eol: string | null;
}

function readAttributes(repoRoot: string, base: string): readonly AttributeLine[] {
  const path = join(repoRoot, base, '.gitattributes');
  if (!existsSync(path)) return [];
  const out: AttributeLine[] = [];
  for (const rawLine of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === '' || line.startsWith('#')) continue;
    const [glob, ...attrs] = line.split(/\s+/);
    if (glob === undefined) continue;
    let text: AttributeLine['text'] = null;
    let eol: string | null = null;
    for (const attr of attrs) {
      if (attr === 'text') text = 'set';
      else if (attr === '-text' || attr === 'binary') text = 'unset';
      else if (attr === 'text=auto') text = 'auto';
      else if (attr.startsWith('eol=')) eol = attr.slice('eol='.length);
    }
    out.push({ regex: globToRegExp(glob), base, text, eol });
  }
  return out;
}

/** git's crlf action for a path: whether CRLF is turned into LF on add, and if so, how. */
function textAction(lines: readonly AttributeLine[], path: string): 'convert' | 'auto' | 'none' {
  let text: AttributeLine['text'] = null;
  let eol: string | null = null;
  for (const line of lines) {
    const rel = relativeTo(line.base, path);
    if (rel === null || !line.regex.test(rel)) continue;
    if (line.text !== null) text = line.text;
    if (line.eol !== null) eol = line.eol;
  }
  if (text === 'unset') return 'none';
  if (text === 'auto') return 'auto';
  if (text === 'set') return 'convert';
  // convert.c: an eol attribute with `text` unspecified acts as if `text` were set.
  return eol === 'lf' || eol === 'crlf' ? 'convert' : 'none';
}

// ---------------------------------------------------------------------------------------------
// Content

/** convert.c `gather_stats` + `convert_is_binary`: the `text=auto` heuristic. */
export function looksBinary(bytes: Uint8Array): boolean {
  let printable = 0;
  let nonPrintable = 0;
  for (let i = 0; i < bytes.length; i += 1) {
    const c = bytes[i] ?? 0;
    if (c === 0x0d) {
      if (bytes[i + 1] === 0x0a) i += 1;
      else return true; // a lone CR
      continue;
    }
    if (c === 0x0a) continue;
    if (c === 0x7f) nonPrintable += 1;
    else if (c < 0x20) {
      if (c === 0x08 || c === 0x09 || c === 0x1b || c === 0x0c) printable += 1;
      else if (c === 0) return true;
      else nonPrintable += 1;
    } else printable += 1;
  }
  if (bytes.length > 0 && bytes[bytes.length - 1] === 0x1a) nonPrintable -= 1;
  return Math.floor(printable / 128) < nonPrintable;
}

/** CRLF → LF (a CR not followed by LF is kept). */
export function crlfToLf(bytes: Buffer): Buffer {
  if (!bytes.includes(0x0d)) return bytes;
  const out: number[] = [];
  for (let i = 0; i < bytes.length; i += 1) {
    const c = bytes[i] ?? 0;
    if (c === 0x0d && bytes[i + 1] === 0x0a) continue;
    out.push(c);
  }
  return Buffer.from(out);
}

const objectId = (type: 'blob' | 'tree', body: Buffer): string =>
  createHash('sha1').update(Buffer.concat([Buffer.from(`${type} ${String(body.length)}\0`, 'utf8'), body])).digest('hex');

export const blobId = (content: Buffer): string => objectId('blob', content);

interface Entry {
  readonly name: string;
  readonly mode: string;
  readonly oid: string;
  readonly directory: boolean;
}

/** git sorts tree entries by name, a directory as if its name ended in '/'. */
function treeObject(entries: readonly Entry[]): string {
  const key = (entry: Entry): Buffer => Buffer.from(entry.directory ? `${entry.name}/` : entry.name, 'utf8');
  const sorted = [...entries].sort((a, b) => Buffer.compare(key(a), key(b)));
  const body = Buffer.concat(sorted.flatMap((entry) => [Buffer.from(`${entry.mode} ${entry.name}\0`, 'utf8'), Buffer.from(entry.oid, 'hex')]));
  return objectId('tree', body);
}

// ---------------------------------------------------------------------------------------------
// Walk

/** Mode bits: owner-execute, tested arithmetically (no bitwise operators in this repository). */
const isExecutable = (mode: number): boolean => process.platform !== 'win32' && Math.floor(mode / 0o100) % 2 === 1;

/**
 * The tree id git would record for `dir` (repository-relative, `/`-separated) of the files under
 * `repoRoot`, or null when nothing in it would be committed.
 */
export function inProcessTreeId(repoRoot: string, dir: string): string | null {
  const segments = dir.split('/').filter((s) => s !== '');
  // Pattern files on the way down to `dir` apply too.
  let ignore: Pattern[] = [];
  let attributes: AttributeLine[] = [];
  for (let depth = 0; depth <= segments.length; depth += 1) {
    const base = segments.slice(0, depth).join('/');
    if (depth > 0 && ignoredBy(ignore, base, true)) return null;
    ignore = [...ignore, ...readPatterns(repoRoot, base, '.gitignore')];
    attributes = [...attributes, ...readAttributes(repoRoot, base)];
  }
  const walk = (path: string, inheritedIgnore: readonly Pattern[], inheritedAttributes: readonly AttributeLine[]): string | null => {
    const ownIgnore = path === segments.join('/') ? [] : readPatterns(repoRoot, path, '.gitignore');
    const ownAttributes = path === segments.join('/') ? [] : readAttributes(repoRoot, path);
    const ignoreHere = [...inheritedIgnore, ...ownIgnore];
    const attributesHere = [...inheritedAttributes, ...ownAttributes];
    const entries: Entry[] = [];
    for (const name of readdirSync(join(repoRoot, path))) {
      if (name === '.git') continue;
      const child = `${path}/${name}`;
      const stat = lstatSync(join(repoRoot, child));
      if (stat.isSymbolicLink()) throw new Error(`${child}: symbolic links are not supported by the in-process tree hash`);
      if (stat.isDirectory()) {
        if (ignoredBy(ignoreHere, child, true)) continue;
        if (existsSync(join(repoRoot, child, '.git'))) throw new Error(`${child}: nested repositories are not supported by the in-process tree hash`);
        const oid = walk(child, ignoreHere, attributesHere);
        if (oid !== null) entries.push({ name, mode: '40000', oid, directory: true });
      } else if (stat.isFile()) {
        if (ignoredBy(ignoreHere, child, false)) continue;
        let content: Buffer = readFileSync(join(repoRoot, child));
        const action = textAction(attributesHere, child);
        if (action === 'convert' || (action === 'auto' && !looksBinary(content))) content = crlfToLf(content);
        entries.push({ name, mode: isExecutable(stat.mode) ? '100755' : '100644', oid: blobId(content), directory: false });
      }
    }
    return entries.length === 0 ? null : treeObject(entries);
  };
  return walk(segments.join('/'), ignore, attributes);
}
