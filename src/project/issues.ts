/**
 * A problem with a project document. `path` locates it in the JSON (`route.steps[3].kind`,
 * `route.groups["group-1"].id`); the empty string is the document itself.
 */
export interface ProjectIssue {
  readonly path: string;
  readonly message: string;
}

const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

export function formatPath(path: readonly PropertyKey[]): string {
  let out = '';
  for (const segment of path) {
    if (typeof segment === 'number') out += `[${String(segment)}]`;
    else if (typeof segment === 'string' && IDENTIFIER.test(segment)) out += out === '' ? segment : `.${segment}`;
    else out += `[${JSON.stringify(String(segment))}]`;
  }
  return out;
}
