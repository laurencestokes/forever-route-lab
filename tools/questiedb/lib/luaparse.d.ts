/**
 * Minimal type declarations for luaparse 0.3.1 (MIT; a pinned dev dependency, never shipped). Only
 * the node kinds and options tools/questiedb uses are typed precisely; every other node kind is
 * still a `Node` with its `type`, so the whitelisted evaluator can name it when it fails closed.
 */
declare module 'luaparse' {
  export interface Position {
    readonly line: number;
    readonly column: number;
  }
  export interface SourceLocation {
    readonly start: Position;
    readonly end: Position;
  }
  interface NodeBase<T extends string> {
    readonly type: T;
    readonly loc?: SourceLocation;
    readonly range?: readonly [number, number];
    /** Set by luaparse on a parenthesised expression. */
    readonly inParens?: boolean;
  }

  export interface Identifier extends NodeBase<'Identifier'> {
    readonly name: string;
  }
  export interface StringLiteral extends NodeBase<'StringLiteral'> {
    /** With encodingMode 'pseudo-latin1': one character per byte (U+0000-U+00FF). */
    readonly value: string | null;
    readonly raw: string;
  }
  export interface NumericLiteral extends NodeBase<'NumericLiteral'> {
    readonly value: number;
    readonly raw: string;
  }
  export interface BooleanLiteral extends NodeBase<'BooleanLiteral'> {
    readonly value: boolean;
    readonly raw: string;
  }
  export interface NilLiteral extends NodeBase<'NilLiteral'> {
    readonly value: null;
    readonly raw: string;
  }
  export interface VarargLiteral extends NodeBase<'VarargLiteral'> {
    readonly value: string;
    readonly raw: string;
  }
  export interface TableKey extends NodeBase<'TableKey'> {
    readonly key: Expression;
    readonly value: Expression;
  }
  export interface TableKeyString extends NodeBase<'TableKeyString'> {
    readonly key: Identifier;
    readonly value: Expression;
  }
  export interface TableValue extends NodeBase<'TableValue'> {
    readonly value: Expression;
  }
  export type TableField = TableKey | TableKeyString | TableValue;
  export interface TableConstructorExpression extends NodeBase<'TableConstructorExpression'> {
    readonly fields: readonly TableField[];
  }
  export interface BinaryExpression extends NodeBase<'BinaryExpression'> {
    readonly operator: string;
    readonly left: Expression;
    readonly right: Expression;
  }
  export interface LogicalExpression extends NodeBase<'LogicalExpression'> {
    readonly operator: 'and' | 'or';
    readonly left: Expression;
    readonly right: Expression;
  }
  export interface UnaryExpression extends NodeBase<'UnaryExpression'> {
    readonly operator: string;
    readonly argument: Expression;
  }
  export interface MemberExpression extends NodeBase<'MemberExpression'> {
    readonly indexer: '.' | ':';
    readonly identifier: Identifier;
    readonly base: Expression;
  }
  export interface IndexExpression extends NodeBase<'IndexExpression'> {
    readonly base: Expression;
    readonly index: Expression;
  }
  export interface CallExpression extends NodeBase<'CallExpression'> {
    readonly base: Expression;
    readonly arguments: readonly Expression[];
  }
  export interface StringCallExpression extends NodeBase<'StringCallExpression'> {
    readonly base: Expression;
    readonly argument: StringLiteral;
  }
  export interface TableCallExpression extends NodeBase<'TableCallExpression'> {
    readonly base: Expression;
    readonly arguments: TableConstructorExpression;
  }
  export interface FunctionDeclaration extends NodeBase<'FunctionDeclaration'> {
    readonly identifier: Identifier | MemberExpression | null;
    readonly isLocal: boolean;
    readonly parameters: readonly (Identifier | VarargLiteral)[];
    readonly body: readonly Statement[];
  }
  export type Expression =
    | Identifier
    | StringLiteral
    | NumericLiteral
    | BooleanLiteral
    | NilLiteral
    | VarargLiteral
    | TableConstructorExpression
    | BinaryExpression
    | LogicalExpression
    | UnaryExpression
    | MemberExpression
    | IndexExpression
    | CallExpression
    | StringCallExpression
    | TableCallExpression
    | FunctionDeclaration;

  export interface LocalStatement extends NodeBase<'LocalStatement'> {
    readonly variables: readonly Identifier[];
    readonly init: readonly Expression[];
  }
  export interface AssignmentStatement extends NodeBase<'AssignmentStatement'> {
    readonly variables: readonly Expression[];
    readonly init: readonly Expression[];
  }
  export interface CallStatement extends NodeBase<'CallStatement'> {
    readonly expression: Expression;
  }
  export interface ReturnStatement extends NodeBase<'ReturnStatement'> {
    readonly arguments: readonly Expression[];
  }
  export interface IfClause extends NodeBase<'IfClause'> {
    readonly condition: Expression;
    readonly body: readonly Statement[];
  }
  export interface ElseifClause extends NodeBase<'ElseifClause'> {
    readonly condition: Expression;
    readonly body: readonly Statement[];
  }
  export interface ElseClause extends NodeBase<'ElseClause'> {
    readonly body: readonly Statement[];
  }
  export interface IfStatement extends NodeBase<'IfStatement'> {
    readonly clauses: readonly (IfClause | ElseifClause | ElseClause)[];
  }
  /** Loops, `do`, `goto`, labels and `break`: never whitelisted, typed only by name. */
  export type OtherStatement = NodeBase<
    | 'WhileStatement'
    | 'DoStatement'
    | 'RepeatStatement'
    | 'ForNumericStatement'
    | 'ForGenericStatement'
    | 'BreakStatement'
    | 'GotoStatement'
    | 'LabelStatement'
  >;
  export type Statement =
    | LocalStatement
    | AssignmentStatement
    | CallStatement
    | ReturnStatement
    | IfStatement
    | FunctionDeclaration
    | OtherStatement;

  export interface Comment extends NodeBase<'Comment'> {
    readonly value: string;
    readonly raw: string;
  }
  export interface Chunk extends NodeBase<'Chunk'> {
    readonly body: readonly Statement[];
    readonly comments?: readonly Comment[];
  }

  export interface Options {
    readonly wait?: boolean;
    readonly comments?: boolean;
    readonly scope?: boolean;
    readonly locations?: boolean;
    readonly ranges?: boolean;
    readonly luaVersion?: '5.1' | '5.2' | '5.3' | 'LuaJIT';
    readonly encodingMode?: 'none' | 'pseudo-latin1' | 'x-user-defined';
  }

  export function parse(code: string, options?: Options): Chunk;

  const luaparse: {
    readonly version: string;
    readonly parse: typeof parse;
  };
  export default luaparse;
}
