/**
 * Minimal glob matching for `/`-separated relative paths: `**` matches any number of whole path
 * segments (including none), `*` any run of characters within one segment, `?` one character
 * within a segment. Everything else is literal. Matching is case-sensitive.
 */
export function globToRegExp(glob: string): RegExp {
  let source = '';
  let i = 0;
  while (i < glob.length) {
    const char = glob.charAt(i);
    if (char === '*' && glob.charAt(i + 1) === '*') {
      const atSegmentStart = i === 0 || glob.charAt(i - 1) === '/';
      const atSegmentEnd = i + 2 === glob.length || glob.charAt(i + 2) === '/';
      if (atSegmentStart && atSegmentEnd) {
        // "**/" matches zero or more leading segments; a trailing "**" matches the rest.
        source += i + 2 === glob.length ? '.*' : '(?:[^/]+/)*';
        i += i + 2 === glob.length ? 2 : 3;
        continue;
      }
      source += '[^/]*';
      i += 2;
      continue;
    }
    if (char === '*') source += '[^/]*';
    else if (char === '?') source += '[^/]';
    else source += char.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    i += 1;
  }
  return new RegExp(`^${source}$`);
}

export function matchesAnyGlob(path: string, globs: readonly string[]): boolean {
  return globs.some((glob) => globToRegExp(glob).test(path));
}
