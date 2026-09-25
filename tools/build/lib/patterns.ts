/**
 * Content patterns shared by `audit-dist` and `tests/architecture.test.ts` (ARCHITECTURE §16,
 * §17). None of these sources matches its own text: every pattern needs a character (a drive
 * letter, an account-name character, a `[` directly followed by `"`) exactly where its source
 * has regex syntax instead.
 */

/**
 * An absolute path into a user profile: a drive letter, `Users` and an account name, with raw
 * (`\`), escaped (`\\`, as in JSON and JS strings) or forward (`/`, as Vite writes Windows paths)
 * separators; the MSYS form (`/c/Users/<name>/`), macOS `/Users/<name>/` and Linux
 * `/home/<name>/`. The POSIX forms must start a path (not follow a host name or another path
 * segment), so URLs such as `https://www.chromium.org/Home/...` do not match.
 */
export const USER_PROFILE_PATH =
  /[A-Za-z]:(?:\\{1,2}|\/)(?:Users|users|USERS)(?:\\{1,2}|\/)[A-Za-z0-9._-]+(?:\\{1,2}|\/)|(?<![\w.-])(?:\/[A-Za-z])?\/Users\/[A-Za-z0-9._-]+\/|(?<![\w.-])\/home\/[A-Za-z0-9._-]+\//;

/**
 * A path through a `.cache` directory (the repository's gitignored upstream clones, or any tool
 * cache). A property access such as `React.cache` does not match: the dot must start a path
 * segment and be followed by a separator.
 */
export const CACHE_DIRECTORY_REFERENCE = /(?:^|[\s"'`(=:,;\\/])\.cache[\\/]/m;

/** Local map sets and their files always carry this marker (docs/MAPS.md §5.3, §5.7). */
export const LOCAL_ONLY_MARKER = /"redistribution"\s*:\s*"local-only"/;

/**
 * Markers of World of Warcraft `WTF/` or SavedVariables content: a path into a concrete account
 * folder, an AceDB `profileKeys` table, and an AceDB `"Character - Realm"` profile-key line.
 * Prose that merely names these folders (as the docs do) does not match.
 */
export const SAVED_VARIABLES_MARKERS: readonly RegExp[] = [
  /\bWTF(?:\\{1,2}|\/)Account(?:\\{1,2}|\/)[A-Za-z0-9#_-]+(?:\\{1,2}|\/)/i,
  /\["profileKeys"\]\s*=\s*\{/,
  /^\s*\["[^"\r\n]+ - [^"\r\n]+"\]\s*=\s*"[^"\r\n]+ - [^"\r\n]+",?\s*$/m,
];

/** A repository or dist path that runs through a `WTF` or `SavedVariables` folder. */
export const SAVED_VARIABLES_PATH = /(?:^|\/)(?:WTF|SavedVariables)(?:\/|$)/i;

export interface PatternHit {
  readonly pattern: string;
  /** 1-based line of the first match. */
  readonly line: number;
  /** The matched text, trimmed to at most 80 characters. */
  readonly excerpt: string;
}

/** Tests `text` against `pattern` and reports the first match, if any. */
export function findPattern(text: string, pattern: RegExp, label: string): PatternHit | null {
  const match = pattern.exec(text);
  if (match === null) return null;
  const line = text.slice(0, match.index).split('\n').length;
  return { pattern: label, line, excerpt: match[0].trim().slice(0, 80) };
}

/** Every privacy pattern that matches `text`: user-profile paths and SavedVariables content. */
export function findPrivacyLeaks(text: string): readonly PatternHit[] {
  const hits: PatternHit[] = [];
  const pathHit = findPattern(text, USER_PROFILE_PATH, 'absolute user-profile path');
  if (pathHit !== null) hits.push(pathHit);
  for (const marker of SAVED_VARIABLES_MARKERS) {
    const hit = findPattern(text, marker, 'WTF/SavedVariables content');
    if (hit !== null) hits.push(hit);
  }
  return hits;
}

/** True when the first 8,000 bytes contain a NUL byte, the usual text/binary heuristic. */
export function looksBinary(bytes: Uint8Array): boolean {
  const end = Math.min(bytes.length, 8000);
  for (let i = 0; i < end; i += 1) if (bytes[i] === 0) return true;
  return false;
}
