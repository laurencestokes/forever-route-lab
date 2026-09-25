/**
 * A small SPDX licence-expression parser and evaluator for the licence gate
 * (docs/ARCHITECTURE.md §16, D-025).
 *
 * Grammar (SPDX 2.3 annex D, without DocumentRef shortcuts beyond what the tokeniser accepts):
 *
 *   expression := and-expression ( "OR" and-expression )*
 *   and-expression := term ( "AND" term )*
 *   term := "(" expression ")" | licence [ "WITH" exception ]
 *   licence := id [ "+" ]
 *
 * `AND` binds tighter than `OR`. Operators are matched case-sensitively, as the SPDX
 * specification requires, so a declared `"MIT or Apache-2.0"` does not parse and fails closed.
 * Licence identifiers are compared case-insensitively.
 */

export type SpdxNode =
  | {
      readonly kind: 'licence';
      readonly id: string;
      /** `Apache-2.0+`: this version or any later one. */
      readonly orLater: boolean;
      readonly exception: string | null;
    }
  | { readonly kind: 'and' | 'or'; readonly left: SpdxNode; readonly right: SpdxNode };

export type SpdxParseResult =
  | { readonly ok: true; readonly node: SpdxNode }
  | { readonly ok: false; readonly error: string };

export interface SpdxVerdict {
  readonly allowed: boolean;
  /** Human-readable explanation: the chosen licence(s) when allowed, the blocker otherwise. */
  readonly reason: string;
}

/** The allowlist in docs/ARCHITECTURE.md §16. */
export const ALLOWED_LICENCES: readonly string[] = [
  'MIT',
  'ISC',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'Apache-2.0',
  '0BSD',
  'Zlib',
  'CC0-1.0',
  'BlueOak-1.0.0',
];

const OPERATORS = new Set(['AND', 'OR', 'WITH']);
const IDENTIFIER = /^(?:DocumentRef-[A-Za-z0-9.-]+:)?[A-Za-z0-9.-]+\+?$/;

class SpdxSyntaxError extends Error {
  override readonly name = 'SpdxSyntaxError';
}

function tokenise(text: string): readonly string[] {
  return text.match(/\(|\)|[^\s()]+/g) ?? [];
}

export function parseSpdxExpression(text: string): SpdxParseResult {
  const tokens = tokenise(text);
  if (tokens.length === 0) return { ok: false, error: 'empty licence expression' };
  let position = 0;

  const peek = (): string | undefined => tokens[position];
  const fail = (message: string): never => {
    throw new SpdxSyntaxError(`${message} at token ${String(position + 1)} of "${text}"`);
  };

  const parseTerm = (): SpdxNode => {
    const token = peek();
    if (token === undefined) return fail('expected a licence');
    if (token === '(') {
      position += 1;
      const inner = parseOr();
      if (peek() !== ')') fail('expected ")"');
      position += 1;
      return inner;
    }
    if (token === ')' || OPERATORS.has(token) || !IDENTIFIER.test(token)) {
      return fail(`unexpected "${token}"`);
    }
    position += 1;
    const orLater = token.endsWith('+');
    const id = orLater ? token.slice(0, -1) : token;
    let exception: string | null = null;
    if (peek() === 'WITH') {
      position += 1;
      const next = peek();
      if (next === undefined || next === '(' || next === ')' || OPERATORS.has(next) || !IDENTIFIER.test(next)) {
        return fail('expected an exception identifier after WITH');
      }
      exception = next;
      position += 1;
    }
    return { kind: 'licence', id, orLater, exception };
  };

  const parseAnd = (): SpdxNode => {
    let left = parseTerm();
    while (peek() === 'AND') {
      position += 1;
      left = { kind: 'and', left, right: parseTerm() };
    }
    return left;
  };

  const parseOr = (): SpdxNode => {
    let left = parseAnd();
    while (peek() === 'OR') {
      position += 1;
      left = { kind: 'or', left, right: parseAnd() };
    }
    return left;
  };

  try {
    const node = parseOr();
    if (position !== tokens.length) fail(`unexpected "${tokens[position] ?? ''}"`);
    return { ok: true, node };
  } catch (error) {
    if (error instanceof SpdxSyntaxError) return { ok: false, error: error.message };
    throw error;
  }
}

function describe(node: SpdxNode): string {
  if (node.kind === 'licence') {
    const base = node.orLater ? `${node.id}+` : node.id;
    return node.exception === null ? base : `${base} WITH ${node.exception}`;
  }
  return `(${describe(node.left)} ${node.kind.toUpperCase()} ${describe(node.right)})`;
}

function evaluateNode(node: SpdxNode, allowed: ReadonlySet<string>): SpdxVerdict {
  switch (node.kind) {
    case 'licence': {
      const key = node.id.toLowerCase();
      if (node.exception !== null) {
        const withKey = `${key} with ${node.exception.toLowerCase()}`;
        return allowed.has(withKey)
          ? { allowed: true, reason: describe(node) }
          : { allowed: false, reason: `${describe(node)} is not on the allowlist` };
      }
      // "X+" means "X or any later version"; choosing X itself is always permitted.
      return allowed.has(key)
        ? { allowed: true, reason: describe(node) }
        : { allowed: false, reason: `${describe(node)} is not on the allowlist` };
    }
    case 'and': {
      const left = evaluateNode(node.left, allowed);
      const right = evaluateNode(node.right, allowed);
      if (!left.allowed) return left;
      if (!right.allowed) return right;
      return { allowed: true, reason: `${left.reason} AND ${right.reason}` };
    }
    case 'or': {
      const left = evaluateNode(node.left, allowed);
      if (left.allowed) return left;
      const right = evaluateNode(node.right, allowed);
      if (right.allowed) return right;
      return { allowed: false, reason: `no alternative of ${describe(node)} is on the allowlist` };
    }
  }
}

/**
 * Decides whether a declared licence expression is acceptable: `OR` passes when any alternative
 * is allowed, `AND` only when every part is. An expression that does not parse is rejected.
 */
export function evaluateSpdx(expression: string, allowlist: readonly string[] = ALLOWED_LICENCES): SpdxVerdict {
  const parsed = parseSpdxExpression(expression);
  if (!parsed.ok) return { allowed: false, reason: `unparseable licence expression: ${parsed.error}` };
  const allowed = new Set(allowlist.map((id) => id.toLowerCase()));
  return evaluateNode(parsed.node, allowed);
}
