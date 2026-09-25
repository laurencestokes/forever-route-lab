import type {
  AssignmentStatement,
  Chunk,
  Expression,
  FunctionDeclaration,
  IfStatement,
  LocalStatement,
  Statement,
  TableConstructorExpression,
} from 'luaparse';
import { decodeLuaBytes } from './lua-source';
import { describeValue, type LuaFunction, type LuaKey, LuaTable, type LuaValue } from './lua-value';

/**
 * The whitelisted Lua evaluator (D-009, DATA_PROVENANCE §5). It runs exactly the constructs that
 * QuestieDB's Forever inputs use and throws on anything else, so an upstream change that adds a
 * loop, a new builtin or an unknown constant stops the extraction instead of silently producing
 * different data. There is no Lua runtime.
 *
 * Whitelisted statements: `local` declarations (never more names than values when the last value
 * is a call: Lua would expand its extra return values), assignment to a local or to a field of an
 * existing table, `function M:F()` / `function M.F()` declarations with no parameters, `return` with at most
 * one value, and `if` / `elseif` / `else`. Whitelisted expressions: literals, `...` (only as the
 * last initialiser of a `local`), names, `a.b` (the key must exist), `a[k]` (an absent key reads
 * nil), calls of host functions and declared functions, table constructors, `+ - == ~= < <= > >=`
 * on numbers (`==`/`~=` on anything), `and`, `or`, unary `-` and `not`.
 *
 * Every executed file is also scanned up front ({@link assertWhitelisted}), so an unsupported
 * construct anywhere in it fails closed, even on a branch the extraction would not take.
 */

export class LuaEvalError extends Error {
  constructor(file: string, line: number | null, message: string) {
    super(`${file}${line === null ? '' : `:${String(line)}`}: ${message}`);
    this.name = 'LuaEvalError';
  }
}

export interface Lint {
  readonly file: string;
  readonly line: number | null;
  readonly kind: 'duplicate-key';
  readonly detail: string;
}

export interface EvalContext {
  /** Repository-relative upstream path, for messages. */
  readonly file: string;
  /** The only globals the code may read. Anything else is an unknown global and fails closed. */
  readonly globals: ReadonlyMap<string, LuaValue>;
  /** The chunk's `...` (an addon file receives `addonName, addonTable`). */
  readonly varargs: readonly LuaValue[];
  /** Sink for well-defined but suspicious constructs (duplicate table keys). */
  readonly lints: Lint[];
}

class Scope {
  readonly #vars = new Map<string, LuaValue>();
  constructor(readonly parent: Scope | null) {}

  declare(name: string, value: LuaValue): void {
    this.#vars.set(name, value);
  }

  find(name: string): Scope | null {
    if (this.#vars.has(name)) return this;
    return this.parent === null ? null : this.parent.find(name);
  }

  read(name: string): LuaValue {
    return this.#vars.get(name) ?? null;
  }

  write(name: string, value: LuaValue): void {
    this.#vars.set(name, value);
  }
}

/** A host function exposed to Lua code (e.g. `UnitFactionGroup`). */
export function hostFunction(name: string, fn: (args: readonly LuaValue[]) => LuaValue, opts: { readonly singleValued?: boolean } = {}): LuaFunction {
  return { kind: 'function', name, invoke: fn, singleValued: opts.singleValued ?? false };
}

export const isFunction = (value: LuaValue): value is LuaFunction =>
  value !== null && typeof value === 'object' && !(value instanceof LuaTable);

export const truthy = (value: LuaValue): boolean => value !== null && value !== false;

const line = (node: { readonly loc?: { readonly start: { readonly line: number } } }): number | null => node.loc?.start.line ?? null;

/** A node the types say cannot occur: a kind a later luaparse may add. Never accepted silently. */
function unknownNode(node: unknown): { readonly type: string; readonly loc?: { readonly start: { readonly line: number } } } {
  return node as { readonly type: string; readonly loc?: { readonly start: { readonly line: number } } };
}

const BINARY_OPERATORS = new Set(['+', '-', '==', '~=', '<', '<=', '>', '>=']);
const UNARY_OPERATORS = new Set(['-', 'not']);

/**
 * `local a, b = f()`: Lua expands the call's return values into the extra variables, but every
 * host function here returns one value (the real `UnitClassBase` returns classFile and classId),
 * so the evaluator would bind nil where Lua binds a value. Only `...` may expand (data-F1).
 */
function expandsCall(statement: LocalStatement): boolean {
  const last = statement.init.at(-1);
  return statement.variables.length > statement.init.length && isCall(last);
}

function isCall(node: Expression | undefined): boolean {
  return node?.type === 'CallExpression' || node?.type === 'StringCallExpression';
}

// ---------------------------------------------------------------------------------------------
// Static whitelist scan

/** Throws on the first node outside the whitelist, wherever it is in the chunk. */
export function assertWhitelisted(chunk: Chunk, file: string): void {
  const fail = (node: { readonly type: string; readonly loc?: { readonly start: { readonly line: number } } }, what: string): never => {
    throw new LuaEvalError(file, line(node), `unsupported construct (${what}); the evaluator fails closed`);
  };
  const expression = (node: Expression, varargAllowed: boolean): void => {
    switch (node.type) {
      case 'NumericLiteral':
      case 'StringLiteral':
      case 'BooleanLiteral':
      case 'NilLiteral':
      case 'Identifier':
        return;
      case 'VarargLiteral':
        if (!varargAllowed) fail(node, '`...` outside a local initialiser');
        return;
      case 'MemberExpression':
        expression(node.base, false);
        return;
      case 'IndexExpression':
        expression(node.base, false);
        expression(node.index, false);
        return;
      case 'CallExpression':
        expression(node.base, false);
        // A call as the last argument is checked at run time against the callee's declared
        // return count (Evaluator#expandingCall), since the scan cannot know which function it is.
        for (const arg of node.arguments) expression(arg, false);
        return;
      case 'StringCallExpression':
        expression(node.base, false);
        return;
      case 'TableConstructorExpression':
        // A call as the last positional field is checked at run time, as for call arguments.
        for (const field of node.fields) {
          if (field.type === 'TableKey') expression(field.key, false);
          expression(field.value, false);
        }
        return;
      case 'BinaryExpression':
        if (!BINARY_OPERATORS.has(node.operator)) fail(node, `operator ${node.operator}`);
        expression(node.left, false);
        expression(node.right, false);
        return;
      case 'LogicalExpression':
        expression(node.left, false);
        expression(node.right, false);
        return;
      case 'UnaryExpression':
        if (!UNARY_OPERATORS.has(node.operator)) fail(node, `operator ${node.operator}`);
        expression(node.argument, false);
        return;
      case 'TableCallExpression':
      case 'FunctionDeclaration':
        fail(node, node.type);
        return;
      default:
        // A node kind luaparse may add later: never silently accepted.
        fail(unknownNode(node), `unknown node ${unknownNode(node).type}`);
    }
  };
  const statements = (body: readonly Statement[], topLevel: boolean): void => {
    for (const statement of body) {
      switch (statement.type) {
        case 'LocalStatement':
          if (expandsCall(statement)) fail(statement, 'several locals assigned from one call, whose extra return values Lua would expand');
          statement.init.forEach((init, index) => {
            expression(init, index === statement.init.length - 1);
          });
          break;
        case 'AssignmentStatement':
          for (const target of statement.variables) {
            if (target.type !== 'Identifier' && target.type !== 'MemberExpression' && target.type !== 'IndexExpression') {
              fail(target, `assignment to ${target.type}`);
            }
            expression(target, false);
          }
          for (const init of statement.init) expression(init, false);
          break;
        case 'ReturnStatement':
          if (statement.arguments.length > 1) fail(statement, 'return of several values');
          for (const arg of statement.arguments) expression(arg, false);
          break;
        case 'IfStatement':
          for (const clause of statement.clauses) {
            if (clause.type !== 'ElseClause') expression(clause.condition, false);
            statements(clause.body, false);
          }
          break;
        case 'FunctionDeclaration':
          if (!topLevel) fail(statement, 'nested function declaration');
          if (statement.isLocal || statement.identifier?.type !== 'MemberExpression') fail(statement, 'function that is not a module method');
          if (statement.parameters.length > 0) fail(statement, 'function with parameters');
          statements(statement.body, false);
          break;
        case 'CallStatement':
        case 'WhileStatement':
        case 'DoStatement':
        case 'RepeatStatement':
        case 'ForNumericStatement':
        case 'ForGenericStatement':
        case 'BreakStatement':
        case 'GotoStatement':
        case 'LabelStatement':
          fail(statement, statement.type);
          break;
        default:
          fail(unknownNode(statement), `unknown node ${unknownNode(statement).type}`);
      }
    }
  };
  statements(chunk.body, true);
}

// ---------------------------------------------------------------------------------------------
// Execution

type Flow = { readonly returned: LuaValue } | null;

export class Evaluator {
  constructor(private readonly ctx: EvalContext) {}

  /** Runs a whitelisted chunk; returns its `return` value (nil when it returns nothing). */
  runChunk(chunk: Chunk): LuaValue {
    assertWhitelisted(chunk, this.ctx.file);
    const flow = this.#block(chunk.body, new Scope(null));
    return flow === null ? null : flow.returned;
  }

  /** Evaluates one expression with no locals (for literal subtrees of files that are not run). */
  expression(node: Expression): LuaValue {
    return this.#expr(node, new Scope(null));
  }

  #error(node: { readonly loc?: { readonly start: { readonly line: number } } } | null, message: string): LuaEvalError {
    return new LuaEvalError(this.ctx.file, node === null ? null : line(node), message);
  }

  #block(body: readonly Statement[], scope: Scope): Flow {
    for (const statement of body) {
      const flow = this.#statement(statement, scope);
      if (flow !== null) return flow;
    }
    return null;
  }

  #statement(statement: Statement, scope: Scope): Flow {
    switch (statement.type) {
      case 'LocalStatement':
        this.#local(statement, scope);
        return null;
      case 'AssignmentStatement':
        this.#assign(statement, scope);
        return null;
      case 'FunctionDeclaration':
        this.#declareFunction(statement, scope);
        return null;
      case 'ReturnStatement': {
        const [arg] = statement.arguments;
        return { returned: arg === undefined ? null : this.#expr(arg, scope) };
      }
      case 'IfStatement':
        return this.#if(statement, scope);
      case 'CallStatement':
      case 'WhileStatement':
      case 'DoStatement':
      case 'RepeatStatement':
      case 'ForNumericStatement':
      case 'ForGenericStatement':
      case 'BreakStatement':
      case 'GotoStatement':
      case 'LabelStatement':
        throw this.#error(statement, `unsupported statement ${statement.type}`);
      default:
        throw this.#error(unknownNode(statement), `unknown node ${unknownNode(statement).type}`);
    }
  }

  #local(statement: LocalStatement, scope: Scope): void {
    if (expandsCall(statement)) throw this.#error(statement, 'several locals assigned from one call');
    const values: LuaValue[] = [];
    statement.init.forEach((init, index) => {
      if (init.type === 'VarargLiteral' && index === statement.init.length - 1) values.push(...this.ctx.varargs);
      else values.push(this.#expr(init, scope));
    });
    statement.variables.forEach((variable, index) => {
      scope.declare(variable.name, values[index] ?? null);
    });
  }

  #assign(statement: AssignmentStatement, scope: Scope): void {
    if (statement.init.length !== statement.variables.length) throw this.#error(statement, 'assignment with unequal target and value counts');
    const values = statement.init.map((init) => this.#expr(init, scope));
    statement.variables.forEach((target, index) => {
      const value = values[index] ?? null;
      if (target.type === 'Identifier') {
        const owner = scope.find(target.name);
        if (owner === null) throw this.#error(target, `assignment to global ${target.name}`);
        owner.write(target.name, value);
      } else if (target.type === 'MemberExpression') {
        if (target.indexer !== '.') throw this.#error(target, 'assignment through `:`');
        this.#tableOf(target.base, scope, 'assignment target').set(target.identifier.name, value);
      } else if (target.type === 'IndexExpression') {
        const table = this.#tableOf(target.base, scope, 'assignment target');
        table.set(this.#key(target.index, scope), value);
      } else {
        throw this.#error(target, `assignment to ${target.type}`);
      }
    });
  }

  #declareFunction(statement: FunctionDeclaration, scope: Scope): void {
    const id = statement.identifier;
    if (statement.isLocal || id?.type !== 'MemberExpression' || statement.parameters.length > 0) {
      throw this.#error(statement, 'only parameterless module methods may be declared');
    }
    const module = this.#tableOf(id.base, scope, 'function owner');
    const method = id.indexer === ':';
    const name = id.identifier.name;
    const closure = scope;
    const fn: LuaFunction = {
      kind: 'function',
      name,
      invoke: (args) => {
        const local = new Scope(closure);
        if (method) local.declare('self', args[0] ?? null);
        const flow = this.#block(statement.body, local);
        return flow === null ? null : flow.returned;
      },
      // The static scan rejects `return a, b`, so a declared method returns at most one value.
      singleValued: true,
    };
    module.set(name, fn);
  }

  #if(statement: IfStatement, scope: Scope): Flow {
    for (const clause of statement.clauses) {
      if (clause.type === 'ElseClause' || truthy(this.#expr(clause.condition, scope))) {
        return this.#block(clause.body, new Scope(scope));
      }
    }
    return null;
  }

  #tableOf(node: Expression, scope: Scope, what: string): LuaTable {
    const value = this.#expr(node, scope);
    if (!(value instanceof LuaTable)) throw this.#error(node, `${what} is ${describeValue(value)}, not a table`);
    return value;
  }

  #key(node: Expression, scope: Scope): LuaKey {
    const key = this.#expr(node, scope);
    if (key === null) throw this.#error(node, 'table index is nil');
    if (typeof key === 'number' && Number.isNaN(key)) throw this.#error(node, 'table index is NaN');
    if (typeof key === 'object') throw this.#error(node, `table index is a ${describeValue(key)}`);
    return key;
  }

  #expr(node: Expression, scope: Scope): LuaValue {
    switch (node.type) {
      case 'NumericLiteral':
        if (!Number.isFinite(node.value)) throw this.#error(node, `non-finite number ${node.raw}`);
        return node.value;
      case 'StringLiteral':
        if (node.value === null) throw this.#error(node, 'string literal without a value (wrong encoding mode)');
        return decodeLuaBytes(node.value, `${this.ctx.file}:${String(line(node) ?? '?')}`);
      case 'BooleanLiteral':
        return node.value;
      case 'NilLiteral':
        return null;
      case 'Identifier': {
        const owner = scope.find(node.name);
        if (owner !== null) return owner.read(node.name);
        if (this.ctx.globals.has(node.name)) return this.ctx.globals.get(node.name) ?? null;
        throw this.#error(node, `unknown global ${node.name}`);
      }
      case 'MemberExpression': {
        if (node.indexer !== '.') throw this.#error(node, '`:` outside a call');
        const table = this.#tableOf(node.base, scope, `base of .${node.identifier.name}`);
        if (!table.has(node.identifier.name)) throw this.#error(node, `unknown member ${node.identifier.name}`);
        return table.get(node.identifier.name);
      }
      case 'IndexExpression':
        return this.#tableOf(node.base, scope, 'indexed value').get(this.#key(node.index, scope));
      case 'CallExpression':
        return this.#call(node.base, node.arguments, scope, node);
      case 'StringCallExpression':
        return this.#call(node.base, [node.argument], scope, node);
      case 'TableConstructorExpression':
        return this.#table(node, scope);
      case 'BinaryExpression':
        return this.#binary(node.operator, node.left, node.right, scope, node);
      case 'LogicalExpression': {
        const left = this.#expr(node.left, scope);
        if (node.operator === 'and') return truthy(left) ? this.#expr(node.right, scope) : left;
        return truthy(left) ? left : this.#expr(node.right, scope);
      }
      case 'UnaryExpression': {
        const value = this.#expr(node.argument, scope);
        if (node.operator === 'not') return !truthy(value);
        if (node.operator === '-') {
          if (typeof value !== 'number') throw this.#error(node, `unary minus on ${describeValue(value)}`);
          return -value;
        }
        throw this.#error(node, `unsupported unary operator ${node.operator}`);
      }
      case 'VarargLiteral':
      case 'TableCallExpression':
      case 'FunctionDeclaration':
        throw this.#error(node, `unsupported expression ${node.type}`);
      default:
        throw this.#error(unknownNode(node), `unknown node ${unknownNode(node).type}`);
    }
  }

  /**
   * A call in a position where Lua passes on every return value: the last positional table field
   * or the last call argument. Host functions return one value, so this is sound only when the
   * upstream function is declared single-valued; anything else fails closed (M2 review data-F1).
   */
  #expandingCall(node: Expression, scope: Scope): LuaValue {
    if (node.type === 'CallExpression') return this.#call(node.base, node.arguments, scope, node, true);
    if (node.type === 'StringCallExpression') return this.#call(node.base, [node.argument], scope, node, true);
    return this.#expr(node, scope);
  }

  #call(base: Expression, argNodes: readonly Expression[], scope: Scope, node: Expression, expanding = false): LuaValue {
    let fn: LuaValue;
    const args: LuaValue[] = [];
    if (base.type === 'MemberExpression' && base.indexer === ':') {
      const self = this.#tableOf(base.base, scope, `receiver of :${base.identifier.name}`);
      if (!self.has(base.identifier.name)) throw this.#error(base, `unknown method ${base.identifier.name}`);
      fn = self.get(base.identifier.name);
      args.push(self);
    } else {
      fn = this.#expr(base, scope);
    }
    if (!isFunction(fn)) throw this.#error(node, `call of a ${describeValue(fn)}`);
    if (expanding && !fn.singleValued) {
      throw this.#error(node, `${fn.name} called where Lua expands every return value, and it is not declared single-valued; the evaluator fails closed`);
    }
    argNodes.forEach((arg, index) => {
      if (arg.type === 'VarargLiteral') throw this.#error(arg, '`...` as a call argument');
      args.push(index === argNodes.length - 1 ? this.#expandingCall(arg, scope) : this.#expr(arg, scope));
    });
    try {
      return fn.invoke(args);
    } catch (error) {
      if (error instanceof LuaEvalError) throw error;
      throw this.#error(node, `${fn.name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Lua 5.1 constructor semantics: keyed fields are stored as they are met, positional values at
   * the end, so a positional value overwrites a keyed one with the same integer key. Such a
   * collision is legal but order-dependent, so it fails closed; a repeated keyed field keeps the
   * last value (as Lua does) and is reported as a lint.
   */
  #table(node: TableConstructorExpression, scope: Scope): LuaTable {
    const table = new LuaTable();
    const keyed = new Set<LuaKey>();
    const positional: LuaValue[] = [];
    for (const field of node.fields) {
      if (field.type === 'TableValue') {
        positional.push(field === node.fields.at(-1) ? this.#expandingCall(field.value, scope) : this.#expr(field.value, scope));
        continue;
      }
      const key = field.type === 'TableKey' ? this.#key(field.key, scope) : field.key.name;
      const value = this.#expr(field.value, scope);
      const normalised = typeof key === 'number' && Object.is(key, -0) ? 0 : key;
      if (keyed.has(normalised)) {
        this.ctx.lints.push({ file: this.ctx.file, line: line(field), kind: 'duplicate-key', detail: `key ${JSON.stringify(normalised)} repeated; the last value wins` });
      }
      keyed.add(normalised);
      table.set(normalised, value);
    }
    positional.forEach((value, index) => {
      const key = index + 1;
      if (keyed.has(key)) throw this.#error(node, `positional value ${String(key)} collides with an explicit [${String(key)}] key`);
      table.set(key, value);
    });
    return table;
  }

  #binary(operator: string, leftNode: Expression, rightNode: Expression, scope: Scope, node: Expression): LuaValue {
    const left = this.#expr(leftNode, scope);
    const right = this.#expr(rightNode, scope);
    if (operator === '==') return left === right;
    if (operator === '~=') return left !== right;
    if (typeof left !== 'number' || typeof right !== 'number') {
      throw this.#error(node, `operator ${operator} on ${describeValue(left)} and ${describeValue(right)} (numbers only)`);
    }
    switch (operator) {
      case '+':
        return left + right;
      case '-':
        return left - right;
      case '<':
        return left < right;
      case '<=':
        return left <= right;
      case '>':
        return left > right;
      case '>=':
        return left >= right;
      default:
        throw this.#error(node, `unsupported operator ${operator}`);
    }
  }
}
