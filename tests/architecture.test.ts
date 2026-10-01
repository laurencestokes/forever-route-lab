/**
 * Architecture enforcement (docs/ARCHITECTURE.md §4 "Dependency rules" and §17 "Enforcement").
 *
 * - Every source file under src/ belongs to exactly one §4 module, and its imports follow the
 *   allowlist matrix below, third-party packages and Node builtins included.
 * - The pure set references no browser, host, clock, locale or randomness globals.
 * - optimizer/core calls no implementation-approximated Math functions (§11.4).
 * - No file under src/ uses a bitwise operator (D-012: they truncate masks to 32 bits).
 * - No tracked or untracked-but-not-ignored text file contains an absolute user-profile path or
 *   WTF/SavedVariables content.
 *
 * Files are parsed with the TypeScript parser (syntax only, no type checking), so comments,
 * strings, template literals and regex literals never produce matches. Modules that have no
 * files yet are simply absent from the scan; the matrix itself is always complete.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { builtinModules } from 'node:module';
import { join, posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { findPrivacyLeaks, looksBinary, SAVED_VARIABLES_PATH } from '../tools/build/lib/patterns';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));

// =============================================================================================
// §4 module table

const MODULES = [
  'domain',
  'geo',
  'rules',
  'engine',
  'sim',
  'validate',
  'rxp',
  'diff',
  'project',
  'optimizer/core',
  'optimizer/worker',
  'optimizer/index',
  'nav',
  'nav/worker',
  'infra',
  'map/adapter',
  'map/layers',
  'map/marks',
  'map/leaflet',
  'app',
  'ui',
] as const;
type ModuleName = (typeof MODULES)[number];

/** §17: the pure set. `import type` from these is allowed everywhere (§4). */
const PURE_MODULES: readonly ModuleName[] = [
  'domain',
  'geo',
  'rules',
  'engine',
  'sim',
  'validate',
  'rxp',
  'diff',
  'project',
  'optimizer/core',
  'nav',
  'map/adapter',
  'map/layers',
  'map/marks',
];
const isPure = (module: ModuleName): boolean => PURE_MODULES.includes(module);

/**
 * §4 "May import (values)". A module may always import from itself. Third-party packages are in
 * PACKAGE_RULES; file-level additions (optimizer/types, the composition root) and the one file-level
 * restriction (the atlas files, map-atlas.md §8.1) are below.
 */
const MAY_IMPORT: Readonly<Record<ModuleName, readonly ModuleName[]>> = {
  domain: [],
  geo: ['domain'],
  rules: ['domain'],
  engine: ['domain', 'geo', 'rules', 'sim'],
  sim: ['domain', 'geo', 'rules'],
  validate: ['domain', 'geo', 'rules', 'engine', 'sim'],
  rxp: ['domain', 'geo'],
  diff: ['domain'],
  project: ['domain'],
  'optimizer/core': ['domain', 'geo', 'rules', 'sim', 'engine'],
  'optimizer/worker': ['optimizer/core'],
  'optimizer/index': ['optimizer/core', 'optimizer/worker', 'domain', 'engine', 'geo', 'rules', 'sim'],
  // terrain-navigation.md §18: nav may import domain and geo; nav/worker may import nav; infra and
  // app may import nav (infra through PURE_MODULES, app through its "everything" rule); engine, sim
  // and optimizer/core get only types (`import type` from a pure module is always allowed).
  nav: ['domain', 'geo'],
  'nav/worker': ['nav'],
  infra: PURE_MODULES,
  'map/adapter': ['domain', 'geo'],
  // map-presentation.md §25.2.2 (step MP.2b): the one path set and state table imports nothing;
  // map/layers (states) and map/leaflet (pins) import it directly, ui through app/map-exports, and
  // app and infra by their own rules.
  'map/layers': ['domain', 'geo', 'map/marks'],
  'map/marks': [],
  'map/leaflet': ['map/adapter', 'map/marks'],
  app: MODULES.filter((module) => module !== 'ui' && module !== 'map/leaflet' && module !== 'app'),
  ui: ['app', 'map/adapter'],
};

/** §4: optimizer/worker may import `optimizer/types` (which belongs to the optimizer/index module). */
const OPTIMIZER_TYPES_FILE = 'src/optimizer/types.ts';

/**
 * docs/research/map-atlas.md §8.1 (MA-14; D-042 A9): the atlas files hold atlas coordinates, which
 * are display only (D-017). Their values may be imported only by these modules, by tests and by the
 * two files themselves (and by tools/, which this test does not scan); every other module, geo's
 * own index included, may import their types only. Atlas units therefore cannot reach a distance,
 * a simulation or a saved project.
 */
const ATLAS_FILES: readonly string[] = ['src/geo/atlas.ts', 'src/geo/atlas-layout.ts'];
const ATLAS_VALUE_IMPORTERS: readonly ModuleName[] = ['map/adapter', 'map/layers', 'infra', 'app'];

/** §4: ui imports map/leaflet "only in the composition root" (the app entry). */
const COMPOSITION_ROOTS: readonly string[] = ['src/main.ts', 'src/main.tsx', 'src/ui/main.ts', 'src/ui/main.tsx'];

/** The store's React binding: the only app file that may import React. */
const APP_REACT_BINDING = /^src\/app\/react(?:\.test)?\.tsx?$/;

interface SourceInfo {
  /** Repository-relative, `/`-separated. */
  readonly file: string;
  readonly module: ModuleName;
  readonly isTest: boolean;
}

/** Third-party packages: who may import each one (type-only imports included). Anything else is refused. */
const PACKAGE_RULES: Readonly<Record<string, (source: SourceInfo) => boolean>> = {
  zod: (source) => source.module === 'project',
  idb: (source) => source.module === 'infra',
  leaflet: (source) => source.module === 'map/leaflet',
  react: (source) => source.module === 'ui' || APP_REACT_BINDING.test(source.file),
  'react-dom': (source) => source.module === 'ui' || APP_REACT_BINDING.test(source.file),
};

/** Test tooling that tests next to their module (`*.test.ts(x)`) may import in addition. */
const TEST_PACKAGES: readonly string[] = [
  'vitest',
  '@testing-library/dom',
  '@testing-library/react',
  '@testing-library/user-event',
  'fake-indexeddb',
  'happy-dom',
];

// =============================================================================================
// File → module

const SOURCE_EXTENSION = /\.(?:[cm]?tsx?|[cm]?jsx?)$/;
const TEST_FILE = /\.(?:test|spec)\.[cm]?[jt]sx?$/;

/** A file name without its extension(s): `adapter.test.ts` → `adapter`, `vite-env.d.ts` → `vite-env`. */
const stem = (name: string): string => name.replace(/(?:\.d)?(?:\.(?:test|spec))?\.[^./]+$/, '');

/** Maps a repository-relative path under src/ to its §4 module, or null when it belongs to none. */
function moduleOf(file: string): ModuleName | null {
  if (!file.startsWith('src/')) return null;
  const parts = file.slice('src/'.length).split('/');
  const [top, second] = parts;
  if (top === undefined) return null;
  if (parts.length === 1) return COMPOSITION_ROOTS.includes(file) ? 'ui' : null;
  switch (top) {
    case 'domain':
    case 'geo':
    case 'rules':
    case 'engine':
    case 'sim':
    case 'validate':
    case 'rxp':
    case 'diff':
    case 'project':
    case 'infra':
    case 'app':
    case 'ui':
      return top;
    case 'nav':
      return parts.length > 2 && second === 'worker' ? 'nav/worker' : 'nav';
    case 'optimizer':
      if (parts.length === 2) return second !== undefined && ['index', 'types'].includes(stem(second)) ? 'optimizer/index' : null;
      if (second === 'core') return 'optimizer/core';
      if (second === 'worker') return 'optimizer/worker';
      return null;
    case 'map':
      if (parts.length === 2) {
        const name = second === undefined ? '' : stem(second);
        if (name === 'adapter') return 'map/adapter';
        if (name === 'layers') return 'map/layers';
        // marks-pins.ts is the pins' half of map/marks, split off for the entry chunk (ui-refresh.md §10.3).
        if (name === 'marks' || name === 'marks-pins') return 'map/marks';
        return null;
      }
      return second === 'leaflet' ? 'map/leaflet' : null;
    default:
      return null;
  }
}

// =============================================================================================
// Scanner

interface ImportRecord {
  readonly specifier: string;
  /** Erased at compile time: `import type`, `export type`, `typeof import(...)`. */
  readonly typeOnly: boolean;
  readonly dynamic: boolean;
  readonly line: number;
}

interface Finding {
  readonly line: number;
  readonly message: string;
}

interface ScanResult {
  readonly imports: readonly ImportRecord[];
  /** Imports the scanner cannot check (non-literal `import()` or `require()`). */
  readonly uncheckable: readonly Finding[];
  /** References the pure set may not make (§17). */
  readonly impure: readonly Finding[];
  /** Math that optimizer/core may not use (§11.4, §17). */
  readonly floatMath: readonly Finding[];
  /** Bitwise operators, which no src/ file may use (D-012). */
  readonly bitwise: readonly Finding[];
}

/**
 * Browser, host, clock, locale and randomness globals the pure set must not reference (§2, §17).
 * The pure tsconfig (tsconfig.pure.json: no DOM lib, no @types) rejects most of these at compile
 * time as well; this list also catches the ones every lib declares (eval, Intl, Function).
 */
const PURE_BANNED_GLOBALS: readonly string[] = [
  'window',
  'document',
  'location',
  'history',
  'indexedDB',
  'performance',
  'globalThis',
  'self',
  'navigator',
  'localStorage',
  'sessionStorage',
  'addEventListener',
  'removeEventListener',
  'dispatchEvent',
  'postMessage',
  'crypto',
  'fetch',
  'XMLHttpRequest',
  'WebSocket',
  'Worker',
  'setTimeout',
  'setInterval',
  'clearTimeout',
  'clearInterval',
  'setImmediate',
  'queueMicrotask',
  'requestAnimationFrame',
  'requestIdleCallback',
  'structuredClone',
  'process',
  'Buffer',
  'require',
  'eval',
  'Function',
  'Intl',
];

/** Methods whose result depends on the host's locale or time zone, on whatever object they are called. */
const PURE_BANNED_MEMBERS: readonly string[] = [
  'toLocaleString',
  'toLocaleDateString',
  'toLocaleTimeString',
  'toLocaleUpperCase',
  'toLocaleLowerCase',
  'localeCompare',
  'getTimezoneOffset',
];

/** `&`, `|`, `^`, `<<`, `>>`, `>>>` and their assignment forms (`~` is a prefix operator). */
const BITWISE_OPERATORS: ReadonlyMap<ts.SyntaxKind, string> = new Map([
  [ts.SyntaxKind.AmpersandToken, '&'],
  [ts.SyntaxKind.BarToken, '|'],
  [ts.SyntaxKind.CaretToken, '^'],
  [ts.SyntaxKind.LessThanLessThanToken, '<<'],
  [ts.SyntaxKind.GreaterThanGreaterThanToken, '>>'],
  [ts.SyntaxKind.GreaterThanGreaterThanGreaterThanToken, '>>>'],
  [ts.SyntaxKind.AmpersandEqualsToken, '&='],
  [ts.SyntaxKind.BarEqualsToken, '|='],
  [ts.SyntaxKind.CaretEqualsToken, '^='],
  [ts.SyntaxKind.LessThanLessThanEqualsToken, '<<='],
  [ts.SyntaxKind.GreaterThanGreaterThanEqualsToken, '>>='],
  [ts.SyntaxKind.GreaterThanGreaterThanGreaterThanEqualsToken, '>>>='],
]);

/** Implementation-approximated Math functions (ECMA-262 §21.3.2): results may differ between engines. */
const APPROXIMATED_MATH: readonly string[] = [
  'acos', 'acosh', 'asin', 'asinh', 'atan', 'atan2', 'atanh', 'cbrt', 'cos', 'cosh', 'exp', 'expm1', 'hypot', 'log',
  'log10', 'log1p', 'log2', 'pow', 'sin', 'sinh', 'tan', 'tanh',
];

const scriptKindOf = (fileName: string): ts.ScriptKind => {
  if (/\.[cm]?tsx$/.test(fileName)) return ts.ScriptKind.TSX;
  if (/\.[cm]?jsx$/.test(fileName)) return ts.ScriptKind.JSX;
  if (/\.[cm]?js$/.test(fileName)) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
};

function addBindingNames(name: ts.BindingName, out: Set<string>): void {
  if (ts.isIdentifier(name)) {
    out.add(name.text);
    return;
  }
  for (const element of name.elements) if (!ts.isOmittedExpression(element)) addBindingNames(element.name, out);
}

function addStatementDeclarations(statements: readonly ts.Statement[], out: Set<string>): void {
  for (const statement of statements) {
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) addBindingNames(declaration.name, out);
    } else if (
      (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement) || ts.isEnumDeclaration(statement)) &&
      statement.name !== undefined
    ) {
      out.add(statement.name.text);
    } else if (ts.isImportDeclaration(statement) && statement.importClause !== undefined) {
      const clause = statement.importClause;
      if (clause.name !== undefined) out.add(clause.name.text);
      const bindings = clause.namedBindings;
      if (bindings !== undefined) {
        if (ts.isNamespaceImport(bindings)) out.add(bindings.name.text);
        else for (const element of bindings.elements) out.add(element.name.text);
      }
    } else if (ts.isImportEqualsDeclaration(statement)) {
      out.add(statement.name.text);
    }
  }
}

/** Names a scope node declares directly (block-scoped approximation), or null for a non-scope node. */
function scopeNames(node: ts.Node): ReadonlySet<string> | null {
  const out = new Set<string>();
  if (ts.isSourceFile(node) || ts.isBlock(node) || ts.isModuleBlock(node)) addStatementDeclarations(node.statements, out);
  else if (ts.isCaseBlock(node)) for (const clause of node.clauses) addStatementDeclarations(clause.statements, out);
  else if (ts.isFunctionLike(node)) {
    for (const parameter of node.parameters) addBindingNames(parameter.name, out);
    if ((ts.isFunctionExpression(node) || ts.isFunctionDeclaration(node)) && node.name !== undefined) out.add(node.name.text);
  } else if (ts.isClassLike(node) && node.name !== undefined) out.add(node.name.text);
  else if (ts.isCatchClause(node) && node.variableDeclaration !== undefined) addBindingNames(node.variableDeclaration.name, out);
  else if (ts.isForStatement(node) || ts.isForInStatement(node) || ts.isForOfStatement(node)) {
    const initializer = node.initializer;
    if (initializer !== undefined && ts.isVariableDeclarationList(initializer)) {
      for (const declaration of initializer.declarations) addBindingNames(declaration.name, out);
    }
  } else return null;
  return out;
}

/** `import.meta.<name>` */
const isImportMetaMember = (node: ts.Node | undefined, name: string): boolean =>
  node !== undefined &&
  ts.isPropertyAccessExpression(node) &&
  ts.isMetaProperty(node.expression) &&
  node.expression.keywordToken === ts.SyntaxKind.ImportKeyword &&
  node.name.text === name;

/** True when an identifier position is a reference to a binding, not a property or declaration name. */
function isReference(id: ts.Identifier): boolean {
  const parent = id.parent;
  if (ts.isPropertyAccessExpression(parent) && parent.name === id) return false;
  if (ts.isQualifiedName(parent) && parent.right === id) return false;
  if (ts.isBindingElement(parent) && (parent.name === id || parent.propertyName === id)) return false;
  if (ts.isImportSpecifier(parent) || ts.isExportSpecifier(parent) || ts.isNamespaceExport(parent)) return false;
  if (ts.isLabeledStatement(parent) || ts.isBreakOrContinueStatement(parent) || ts.isJsxAttribute(parent) || ts.isMetaProperty(parent)) {
    return false;
  }
  if (
    (ts.isPropertyAssignment(parent) ||
      ts.isPropertySignature(parent) ||
      ts.isPropertyDeclaration(parent) ||
      ts.isMethodDeclaration(parent) ||
      ts.isMethodSignature(parent) ||
      ts.isGetAccessorDeclaration(parent) ||
      ts.isSetAccessorDeclaration(parent) ||
      ts.isEnumMember(parent) ||
      ts.isVariableDeclaration(parent) ||
      ts.isParameter(parent) ||
      ts.isFunctionDeclaration(parent) ||
      ts.isFunctionExpression(parent) ||
      ts.isClassDeclaration(parent) ||
      ts.isClassExpression(parent) ||
      ts.isInterfaceDeclaration(parent) ||
      ts.isTypeAliasDeclaration(parent) ||
      ts.isEnumDeclaration(parent) ||
      ts.isModuleDeclaration(parent) ||
      ts.isTypeParameterDeclaration(parent) ||
      ts.isImportClause(parent) ||
      ts.isNamespaceImport(parent) ||
      ts.isImportEqualsDeclaration(parent)) &&
    parent.name === id
  ) {
    return false;
  }
  return true;
}

function scanSource(fileName: string, text: string): ScanResult {
  const source = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, scriptKindOf(fileName));
  const imports: ImportRecord[] = [];
  const uncheckable: Finding[] = [];
  const impure: Finding[] = [];
  const floatMath: Finding[] = [];
  const bitwise: Finding[] = [];
  const scopeCache = new Map<ts.Node, ReadonlySet<string> | null>();
  const lineOf = (node: ts.Node): number => source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
  const literalText = (node: ts.Node | undefined): string | null =>
    node !== undefined && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) ? node.text : null;

  const isShadowed = (id: ts.Identifier): boolean => {
    for (let scope: ts.Node | undefined = id.parent; scope !== undefined; scope = scope.parent) {
      let names = scopeCache.get(scope);
      if (names === undefined) {
        names = scopeNames(scope);
        scopeCache.set(scope, names);
      }
      if (names?.has(id.text) === true) return true;
    }
    return false;
  };
  const isGlobal = (node: ts.Node, name: string): node is ts.Identifier =>
    ts.isIdentifier(node) && node.text === name && !isShadowed(node);

  /** `Date.now`, `Math["random"]`, ...: the static member name of an access on `object`, or '' if computed. */
  const memberName = (node: ts.PropertyAccessExpression | ts.ElementAccessExpression): string =>
    ts.isPropertyAccessExpression(node) ? node.name.text : (literalText(node.argumentExpression) ?? '');

  let sawJsx = false;
  const visit = (node: ts.Node): void => {
    // ---- imports
    if (ts.isImportDeclaration(node)) {
      const specifier = literalText(node.moduleSpecifier);
      if (specifier !== null) {
        // verbatimModuleSyntax keeps `import { type A } from 'x'` as `import {} from 'x'`: a runtime import.
        const typeOnly = node.importClause?.phaseModifier === ts.SyntaxKind.TypeKeyword;
        imports.push({ specifier, typeOnly, dynamic: false, line: lineOf(node) });
      }
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier !== undefined) {
      const specifier = literalText(node.moduleSpecifier);
      if (specifier !== null) imports.push({ specifier, typeOnly: node.isTypeOnly, dynamic: false, line: lineOf(node) });
    } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
      const specifier = literalText(node.moduleReference.expression);
      if (specifier !== null) imports.push({ specifier, typeOnly: node.isTypeOnly, dynamic: false, line: lineOf(node) });
    } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) {
      const specifier = literalText(node.argument.literal);
      if (specifier !== null) imports.push({ specifier, typeOnly: true, dynamic: false, line: lineOf(node) });
    } else if (ts.isCallExpression(node)) {
      const isDynamicImport = node.expression.kind === ts.SyntaxKind.ImportKeyword;
      const isRequire = isGlobal(node.expression, 'require');
      if (isDynamicImport || isRequire) {
        const specifier = literalText(node.arguments[0]);
        if (specifier === null) {
          uncheckable.push({ line: lineOf(node), message: `${isRequire ? 'require' : 'import'}() with a non-literal specifier cannot be checked` });
        } else {
          imports.push({ specifier, typeOnly: false, dynamic: isDynamicImport, line: lineOf(node) });
        }
      }
      if (isGlobal(node.expression, 'Date')) impure.push({ line: lineOf(node), message: 'Date() reads the clock' });
      if (isImportMetaMember(node.expression, 'glob')) {
        uncheckable.push({ line: lineOf(node), message: 'import.meta.glob() cannot be checked' });
      }
    } else if (ts.isNewExpression(node) && isGlobal(node.expression, 'URL') && isImportMetaMember(node.arguments?.[1], 'url')) {
      // Vite bundles `new URL('./x', import.meta.url)` (workers, assets): a runtime dependency.
      const specifier = literalText(node.arguments?.[0]);
      if (specifier?.startsWith('.') === true) imports.push({ specifier, typeOnly: false, dynamic: true, line: lineOf(node) });
    } else if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node) || ts.isJsxFragment(node)) {
      sawJsx = true;
    }

    // ---- pure-set references
    if (ts.isIdentifier(node) && PURE_BANNED_GLOBALS.includes(node.text) && isReference(node) && !isShadowed(node)) {
      impure.push({ line: lineOf(node), message: `references the global "${node.text}"` });
    }
    if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
      const name = memberName(node);
      if (isGlobal(node.expression, 'Date') && (name === 'now' || name === '')) {
        impure.push({ line: lineOf(node), message: name === 'now' ? 'Date.now reads the clock' : 'computed access on Date' });
      }
      if (isGlobal(node.expression, 'Math')) {
        if (name === 'random') impure.push({ line: lineOf(node), message: 'Math.random is nondeterministic' });
        if (name === '') floatMath.push({ line: lineOf(node), message: 'computed access on Math cannot be checked' });
        else if (APPROXIMATED_MATH.includes(name)) floatMath.push({ line: lineOf(node), message: `Math.${name} is implementation-approximated` });
      }
    }
    if (ts.isNewExpression(node) && isGlobal(node.expression, 'Date') && (node.arguments?.length ?? 0) === 0) {
      impure.push({ line: lineOf(node), message: 'new Date() without arguments reads the clock' });
    }
    if ((ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) && PURE_BANNED_MEMBERS.includes(memberName(node))) {
      impure.push({ line: lineOf(node), message: `.${memberName(node)} depends on the host locale or time zone` });
    }
    if (ts.isMetaProperty(node) && node.keywordToken === ts.SyntaxKind.ImportKeyword) {
      const env = isImportMetaMember(node.parent, 'env');
      impure.push({ line: lineOf(node), message: env ? 'import.meta.env is build configuration' : 'import.meta is host-specific' });
    }

    // ---- bitwise operators (D-012). Type-level `&` and `|` are type nodes, not expressions.
    if (ts.isBinaryExpression(node)) {
      const operator = BITWISE_OPERATORS.get(node.operatorToken.kind);
      if (operator !== undefined) bitwise.push({ line: lineOf(node), message: `bitwise ${operator} truncates to 32 bits (D-012)` });
    }
    if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.TildeToken) {
      bitwise.push({ line: lineOf(node), message: 'bitwise ~ truncates to 32 bits (D-012)' });
    }

    // ---- optimizer/core float math
    if (
      isGlobal(node, 'Math') &&
      isReference(node) &&
      !((ts.isPropertyAccessExpression(node.parent) || ts.isElementAccessExpression(node.parent)) && node.parent.expression === node)
    ) {
      floatMath.push({ line: lineOf(node), message: 'Math is aliased or passed around, so its uses cannot be checked' });
    }
    if (
      ts.isBinaryExpression(node) &&
      (node.operatorToken.kind === ts.SyntaxKind.AsteriskAsteriskToken ||
        node.operatorToken.kind === ts.SyntaxKind.AsteriskAsteriskEqualsToken)
    ) {
      floatMath.push({ line: lineOf(node), message: '** is Math.pow (implementation-approximated)' });
    }

    ts.forEachChild(node, visit);
  };
  visit(source);

  // The react-jsx transform adds `import { jsx } from 'react/jsx-runtime'` to any file with JSX.
  if (sawJsx) imports.push({ specifier: 'react/jsx-runtime', typeOnly: false, dynamic: false, line: 1 });
  return { imports, uncheckable, impure, floatMath, bitwise };
}

// =============================================================================================
// Resolution and rules

type ImportTarget =
  | { readonly kind: 'module'; readonly module: ModuleName; readonly file: string }
  | { readonly kind: 'unmapped'; readonly file: string }
  | { readonly kind: 'outside-src'; readonly file: string }
  | { readonly kind: 'package'; readonly name: string }
  | { readonly kind: 'builtin'; readonly name: string }
  | { readonly kind: 'unresolved' };

const BUILTINS: ReadonlySet<string> = new Set(builtinModules);

/** The npm package a bare specifier names: `react/jsx-runtime` → `react`, `@scope/pkg/x` → `@scope/pkg`. */
const packageName = (specifier: string): string => {
  const parts = specifier.split('/');
  return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : (parts[0] ?? specifier);
};

const RESOLUTION_SUFFIXES = ['', '.ts', '.tsx', '.d.ts', '.mts', '.cts', '.js', '.jsx', '/index.ts', '/index.tsx'];

/**
 * Resolves a specifier the way Vite and TypeScript's Bundler resolution do for this repository:
 * relative or root-relative paths with optional extension or `/index`, `.js` naming a `.ts`
 * source, and `?query` suffixes (`?worker`, `?raw`) stripped.
 */
function resolveImport(fromFile: string, specifier: string, fileExists: (file: string) => boolean): ImportTarget {
  const bare = specifier.replace(/[?#].*$/, '');
  if (bare.startsWith('.') || bare.startsWith('/')) {
    const base = bare.startsWith('/') ? posix.normalize(bare.slice(1)) : posix.normalize(posix.join(posix.dirname(fromFile), bare));
    if (base.startsWith('../') || base === '..') return { kind: 'unresolved' };
    const candidates = [
      ...RESOLUTION_SUFFIXES.map((suffix) => base + suffix),
      ...(/\.[cm]?jsx?$/.test(base) ? [base.replace(/\.([cm]?)js(x?)$/, '.$1ts$2')] : []),
    ];
    const file = candidates.find(fileExists);
    if (file === undefined) return { kind: 'unresolved' };
    if (!file.startsWith('src/')) return { kind: 'outside-src', file };
    const module = moduleOf(file);
    return module === null ? { kind: 'unmapped', file } : { kind: 'module', module, file };
  }
  if (bare.startsWith('node:') || BUILTINS.has(packageName(bare))) return { kind: 'builtin', name: bare };
  return { kind: 'package', name: packageName(bare) };
}

/** Why `source` may not make this import, or null when it may. */
function importViolation(source: SourceInfo, record: ImportRecord, target: ImportTarget): string | null {
  const what = `${record.typeOnly ? 'type' : 'value'} import "${record.specifier}"`;
  switch (target.kind) {
    case 'module': {
      if (
        ATLAS_FILES.includes(target.file) &&
        !record.typeOnly &&
        !source.isTest &&
        !ATLAS_FILES.includes(source.file) &&
        !ATLAS_VALUE_IMPORTERS.includes(source.module)
      ) {
        return `${what}: ${target.file} holds atlas coordinates (display only, D-017); only ${ATLAS_VALUE_IMPORTERS.join(', ')}, tests and the atlas files may import its values (docs/research/map-atlas.md §8.1); \`import type\` is allowed`;
      }
      if (target.module === source.module) return null;
      if (record.typeOnly && isPure(target.module)) return null;
      if (MAY_IMPORT[source.module].includes(target.module)) return null;
      if (source.module === 'optimizer/worker' && target.file === OPTIMIZER_TYPES_FILE) return null;
      if (source.module === 'ui' && target.module === 'map/leaflet' && COMPOSITION_ROOTS.includes(source.file)) return null;
      const allowed = MAY_IMPORT[source.module];
      return `${what}: ${source.module} may not import ${target.module} (allowed: ${allowed.length === 0 ? 'nothing' : allowed.join(', ')}${
        record.typeOnly ? '' : '; `import type` from a pure module is always allowed'
      })`;
    }
    case 'unmapped':
      return `${what}: ${target.file} belongs to no §4 module`;
    case 'outside-src':
      return source.isTest && target.file.startsWith('tests/') ? null : `${what}: ${target.file} is outside src/`;
    case 'package': {
      const rule = PACKAGE_RULES[target.name];
      if (rule?.(source) === true) return null;
      if (source.isTest && TEST_PACKAGES.includes(target.name)) return null;
      return rule === undefined
        ? `${what}: package "${target.name}" is not allowed in src/ (not in the architecture test's package rules)`
        : `${what}: package "${target.name}" is not allowed in ${source.module}`;
    }
    case 'builtin':
      return `${what}: Node builtins are never allowed in src/`;
    case 'unresolved':
      return `${what}: cannot be resolved`;
  }
}

interface FileReport {
  readonly info: SourceInfo;
  readonly scan: ScanResult;
}

function importViolations(report: FileReport, fileExists: (file: string) => boolean): readonly string[] {
  const out = report.scan.uncheckable.map((finding) => `${report.info.file}:${String(finding.line)} ${finding.message}`);
  for (const record of report.scan.imports) {
    const violation = importViolation(report.info, record, resolveImport(report.info.file, record.specifier, fileExists));
    if (violation !== null) out.push(`${report.info.file}:${String(record.line)} ${violation}`);
  }
  return out;
}

// =============================================================================================
// Repository access

const toPosix = (path: string): string => path.split('\\').join('/');

function listSourceFiles(): readonly string[] {
  const root = join(REPO_ROOT, 'src');
  if (!existsSync(root)) return [];
  return readdirSync(root, { recursive: true, encoding: 'utf8' })
    .map((path) => `src/${toPosix(path)}`)
    .filter((file) => SOURCE_EXTENSION.test(file) && statSync(join(REPO_ROOT, file)).isFile())
    .sort();
}

const repoFileExists = (file: string): boolean => {
  const absolute = join(REPO_ROOT, file);
  return existsSync(absolute) && statSync(absolute).isFile();
};

interface SourceScan {
  readonly reports: readonly FileReport[];
  /** Source files that belong to no §4 module. */
  readonly unmapped: readonly string[];
}

let cachedScan: SourceScan | null = null;

/** Scans src/ once per test run. */
function scanRepository(): SourceScan {
  if (cachedScan !== null) return cachedScan;
  const reports: FileReport[] = [];
  const unmapped: string[] = [];
  for (const file of listSourceFiles()) {
    const module = moduleOf(file);
    if (module === null) {
      unmapped.push(file);
      continue;
    }
    const scan = scanSource(file, readFileSync(join(REPO_ROOT, file), 'utf8'));
    reports.push({ info: { file, module, isTest: TEST_FILE.test(file) }, scan });
  }
  cachedScan = { reports, unmapped };
  return cachedScan;
}

function git(args: readonly string[]): readonly string[] {
  const output = execFileSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return output.split('\0').filter((path) => path !== '');
}

// =============================================================================================
// Self-tests on synthetic snippets

describe('architecture scanner (self-test)', () => {
  it('extracts static, type-only, side-effect, re-export and dynamic imports, ignoring comments and strings', () => {
    const scan = scanSource(
      'src/geo/sample.ts',
      [
        "import a from './a';",
        "import type { B } from './b';",
        "import { type C } from './c';",
        "import { type D, e } from './d';",
        "import './side-effect.css';",
        "export * from './f';",
        "export type { G } from './g';",
        "export { type H } from './h';",
        "export type * from './i';",
        "const lazy = () => import('./j');",
        "type K = typeof import('./k');",
        "// import fake from './comment';",
        "/* import('./block-comment') */",
        "const s = \"import x from './string'\";",
        "const t = `import('./template')`;",
        "const r = /import y from '.\\/regex'/;",
        'export const all = [a, e, lazy, s, t, r];',
        'export type Everything = B | C | D | G | H | K;',
      ].join('\n'),
    );
    expect(scan.imports.map(({ specifier, typeOnly, dynamic }) => ({ specifier, typeOnly, dynamic }))).toEqual([
      { specifier: './a', typeOnly: false, dynamic: false },
      { specifier: './b', typeOnly: true, dynamic: false },
      // verbatimModuleSyntax emits `import {} from './c'`: still a runtime import.
      { specifier: './c', typeOnly: false, dynamic: false },
      { specifier: './d', typeOnly: false, dynamic: false },
      { specifier: './side-effect.css', typeOnly: false, dynamic: false },
      { specifier: './f', typeOnly: false, dynamic: false },
      { specifier: './g', typeOnly: true, dynamic: false },
      { specifier: './h', typeOnly: false, dynamic: false },
      { specifier: './i', typeOnly: true, dynamic: false },
      { specifier: './j', typeOnly: false, dynamic: true },
      { specifier: './k', typeOnly: true, dynamic: false },
    ]);
    expect(scan.uncheckable).toEqual([]);
  });

  it('adds the implicit JSX runtime import and reports non-literal dynamic imports', () => {
    const jsx = scanSource('src/ui/View.tsx', 'export const View = () => <div />;');
    expect(jsx.imports.map((record) => record.specifier)).toEqual(['react/jsx-runtime']);
    const noJsx = scanSource('src/ui/helpers.tsx', 'export const two = 2;');
    expect(noJsx.imports).toEqual([]);
    const dynamic = scanSource(
      'src/app/load.ts',
      ['export const load = (name: string) => import(name);', "export const all = import.meta.glob('./*.ts');"].join('\n'),
    );
    expect(dynamic.uncheckable.map((finding) => finding.message)).toEqual([
      'import() with a non-literal specifier cannot be checked',
      'import.meta.glob() cannot be checked',
    ]);
  });

  it('treats new URL(literal, import.meta.url) as a runtime dependency (Vite workers and assets)', () => {
    const scan = scanSource(
      'src/optimizer/worker/client.ts',
      [
        "export const make = () => new Worker(new URL('./optimizer.worker.ts', import.meta.url), { type: 'module' });",
        "export const page = new URL('https://example.org/', import.meta.url);",
        "export const other = new URL('./x', 'https://example.org/');",
      ].join('\n'),
    );
    expect(scan.imports.map(({ specifier, dynamic }) => ({ specifier, dynamic }))).toEqual([
      { specifier: './optimizer.worker.ts', dynamic: true },
    ]);
  });

  it('finds pure-set globals only where they are real global references', () => {
    const scan = scanSource(
      'src/sim/sample.ts',
      [
        'export const a = window.innerWidth;', // 1: flagged
        'export const b = document;', // 2: flagged
        'export const c = Date.now();', // 3: flagged
        'export const d = new Date();', // 4: flagged
        'export const e = new Date(0);', // 5: fine
        'export const f = Math.random();', // 6: flagged
        'export const g = performance.now();', // 7: flagged
        '// window document Date.now() Math.random()', // 8: comment
        "export const h = 'document window indexedDB';", // 9: string
        'export const i = (o: { window: number }) => o.window;', // 10: property names
        'export const j = { document: 1, performance: 2 };', // 11: object keys
        'export function k(document: string) { return document.length; }', // 12: parameter shadows
        'export function l() { const performance = 3; return performance; }', // 13: local shadows
        'export const m = globalThis.indexedDB;', // 14: flagged (globalThis)
        'export const n = Date.UTC(2026, 8, 25);', // 15: fine
        'export const o = Date();', // 16: flagged
        'export const { p = window, q: document2 } = { q: 1 } as { p?: unknown; q: number };', // 17: default value flagged
        'export const r = (s: { document: number }) => { const { document } = s; return document; };', // 18: destructured local
      ].join('\n'),
    );
    expect(scan.impure.map((finding) => finding.line)).toEqual([1, 2, 3, 4, 6, 7, 14, 16, 17]);
  });

  it('finds host, locale and eval references in the pure set', () => {
    const scan = scanSource(
      'src/rules/sample.ts',
      [
        'export const a = location.href;', // 1: flagged
        'export const b = history.length;', // 2: flagged
        "addEventListener('message', () => undefined);", // 3: flagged
        "removeEventListener('message', () => undefined);", // 4: flagged
        "export const c = Buffer.from('x');", // 5: flagged
        "export const d = (0, eval)('1');", // 6: flagged
        'export const e = import.meta.env.MODE;', // 7: flagged
        'export const f = Intl.DateTimeFormat().resolvedOptions().timeZone;', // 8: flagged
        'export const g = (1234.5).toLocaleString();', // 9: flagged
        'export const h = new Date(0).toLocaleDateString() + new Date(0).toLocaleTimeString();', // 10: flagged
        "export const i = 'a'.localeCompare('b');", // 11: flagged
        'export const j = setTimeout(() => undefined, 1) + setInterval(() => undefined, 1);', // 12: flagged
        "export const k = fetch('x');", // 13: flagged
        'export const l = crypto.getRandomValues(new Uint8Array(1));', // 14: flagged
        "export const m = new Function('return 1');", // 15: flagged
        "export const n = { location: 1, history: 2, toLocaleString: 3 };", // 16: object keys
        'export function o(location: string, history: number[]) { return location + String(history.length); }', // 17: parameters shadow
        "export const p = 'location history eval Intl';", // 18: string
        'export const q = import.meta.url;', // 19: flagged (host-specific)
        "export const r = (1).toFixed(2) + JSON.stringify({ a: 1 }) + 'x'.toUpperCase();", // 20: fine
      ].join('\n'),
    );
    expect([...new Set(scan.impure.map((finding) => finding.line))]).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 19]);
    // Both locale calls on line 10 and both timers on line 12 are reported.
    expect(scan.impure.filter((finding) => finding.line === 10 || finding.line === 12)).toHaveLength(4);
    expect(scan.impure.find((finding) => finding.line === 7)?.message).toBe('import.meta.env is build configuration');
  });

  it('finds bitwise operators but not logical operators, type unions or intersections', () => {
    const scan = scanSource(
      'src/domain/sample.ts',
      [
        'export const a = (2 ** 32 & 4) !== 0;', // 1: flagged
        'export const b = 5 | 0;', // 2: flagged
        'export const c = 5 ^ 1;', // 3: flagged
        'export const d = [1 << 2, 8 >> 1, -8 >>> 1];', // 4: flagged (three)
        'export const e = ~5;', // 5: flagged
        'let f = 1; f &= 3; f |= 4; f ^= 1; f <<= 1; f >>= 1; f >>>= 1;', // 6: flagged (six)
        'export type G = { a: 1 } & { b: 2 };', // 7: type intersection
        "export type H = 'x' | 'y' | null;", // 8: type union
        'export const i = (x: number | null, y: { a: 1 } & { b: 2 }) => x ?? y.a;', // 9: types in a signature
        'let j: boolean | null = true && false; j ||= true; j &&= false; j ??= null;', // 10: logical
        "// 1 & 2 | 3 ^ ~4 << 5 in a comment", // 11: comment
        "export const k = '1 & 2 | 3' + `${'x'} >> y` + String(/a|b/);", // 12: strings, template, regex
        'export const l = !1;', // 13: logical not
        'export const m = f;', // 14: fine
      ].join('\n'),
    );
    expect(scan.bitwise.map((finding) => finding.line)).toEqual([1, 2, 3, 4, 4, 4, 5, 6, 6, 6, 6, 6, 6]);
    expect(scan.bitwise.map((finding) => finding.message)).toContain('bitwise >>>= truncates to 32 bits (D-012)');
  });

  it('finds implementation-approximated Math in optimizer/core', () => {
    const scan = scanSource(
      'src/optimizer/core/sample.ts',
      [
        'export const a = Math.hypot(3, 4);', // 1: flagged
        'export const b = Math.sqrt(2) + Math.floor(2.5) + Math.max(1, 2);', // 2: fine (correctly rounded / exact)
        'export const c = 2 ** 3;', // 3: flagged
        "export const d = Math['pow'](2, 3);", // 4: flagged
        'const M = Math;', // 5: flagged (alias)
        'export const e = M.abs(-1);', // 6: fine by itself
        '// Math.sin(1) in a comment', // 7: comment
        "export const f = 'Math.exp(1)';", // 8: string
      ].join('\n'),
    );
    expect(scan.floatMath.map((finding) => finding.line)).toEqual([1, 3, 4, 5]);
  });

  it('maps files to §4 modules', () => {
    expect(moduleOf('src/domain/route.ts')).toBe('domain');
    expect(moduleOf('src/domain/route.test.ts')).toBe('domain');
    expect(moduleOf('src/optimizer/core/search.ts')).toBe('optimizer/core');
    expect(moduleOf('src/optimizer/worker/client.ts')).toBe('optimizer/worker');
    expect(moduleOf('src/optimizer/index.ts')).toBe('optimizer/index');
    expect(moduleOf('src/optimizer/types.ts')).toBe('optimizer/index');
    expect(moduleOf('src/optimizer/helpers.ts')).toBeNull();
    expect(moduleOf('src/map/adapter.ts')).toBe('map/adapter');
    expect(moduleOf('src/map/layers.test.ts')).toBe('map/layers');
    expect(moduleOf('src/map/marks.ts')).toBe('map/marks');
    expect(moduleOf('src/map/marks.test.ts')).toBe('map/marks');
    expect(moduleOf('src/map/marks-pins.ts')).toBe('map/marks');
    expect(moduleOf('src/map/leaflet/LeafletMapAdapter.ts')).toBe('map/leaflet');
    expect(moduleOf('src/map/other.ts')).toBeNull();
    expect(moduleOf('src/infra/persistence/db.ts')).toBe('infra');
    expect(moduleOf('src/nav/legs.ts')).toBe('nav');
    expect(moduleOf('src/nav/worker.ts')).toBe('nav');
    expect(moduleOf('src/nav/worker/nav.worker.ts')).toBe('nav/worker');
    expect(moduleOf('src/main.tsx')).toBe('ui');
    expect(moduleOf('src/stray.ts')).toBeNull();
    expect(moduleOf('src/widgets/x.ts')).toBeNull();
  });

  it('applies the matrix to modules, packages, builtins and file-level allowances', () => {
    const files = new Set([
      'src/domain/index.ts',
      'src/geo/index.ts',
      'src/rules/index.ts',
      'src/infra/clock.ts',
      'src/app/store.ts',
      'src/map/leaflet/index.ts',
      'src/optimizer/types.ts',
      'src/optimizer/index.ts',
      'src/optimizer/core/search.ts',
      'src/misc/stray.ts',
      'tests/fixtures/sample.json',
    ]);
    const exists = (file: string): boolean => files.has(file);
    const check = (file: string, code: string): readonly string[] => {
      const module = moduleOf(file);
      if (module === null) throw new Error(`test file ${file} has no module`);
      const report = { info: { file, module, isTest: TEST_FILE.test(file) }, scan: scanSource(file, code) };
      return importViolations(report, exists).map((line) => line.replace(/^[^ ]+ /, ''));
    };

    expect(check('src/geo/a.ts', "import { x } from '../domain';")).toEqual([]);
    expect(check('src/geo/a.ts', "import { x } from '../rules';")[0]).toMatch(/geo may not import rules/);
    expect(check('src/geo/a.ts', "import type { X } from '../rules';")).toEqual([]);
    expect(check('src/geo/a.ts', "import { type X } from '../rules';")[0]).toMatch(/value import/);
    expect(check('src/domain/a.ts', "export * from './b';\nimport type { G } from '../geo';")).toEqual(['value import "./b": cannot be resolved']);
    expect(check('src/ui/Panel.tsx', "import type { Clock } from '../infra/clock';")[0]).toMatch(/ui may not import infra/);
    expect(check('src/ui/Panel.tsx', "import { store } from '../app/store';")).toEqual([]);
    expect(check('src/ui/Panel.tsx', "import { m } from '../map/leaflet';")[0]).toMatch(/ui may not import map\/leaflet/);
    expect(check('src/ui/main.tsx', "import { m } from '../map/leaflet';")).toEqual([]);
    expect(check('src/main.tsx', "import { m } from './map/leaflet';")).toEqual([]);
    expect(check('src/optimizer/worker/w.ts', "import { T } from '../types';")).toEqual([]);
    expect(check('src/optimizer/worker/w.ts', "import { o } from '../index';")[0]).toMatch(/optimizer\/worker may not import optimizer\/index/);
    expect(check('src/optimizer/core/a.ts', "import type { Options } from '../types';")[0]).toMatch(/may not import optimizer\/index/);
    expect(check('src/app/a.ts', "import { s } from '../misc/stray';")[0]).toMatch(/belongs to no §4 module/);

    expect(check('src/project/schema.ts', "import { z } from 'zod';")).toEqual([]);
    expect(check('src/domain/a.ts', "import type { ZodType } from 'zod';")[0]).toMatch(/"zod" is not allowed in domain/);
    expect(check('src/infra/db.ts', "import { openDB } from 'idb';")).toEqual([]);
    expect(check('src/app/a.ts', "import { openDB } from 'idb';")[0]).toMatch(/"idb" is not allowed in app/);
    expect(check('src/map/leaflet/a.ts', "import L from 'leaflet';\nimport 'leaflet/dist/leaflet.css';")).toEqual([]);
    expect(check('src/map/adapter.ts', "import type { Map } from 'leaflet';")[0]).toMatch(/"leaflet" is not allowed/);
    expect(check('src/app/react.ts', "import { useSyncExternalStore } from 'react';")).toEqual([]);
    expect(check('src/app/store.ts', "import { useState } from 'react';")[0]).toMatch(/"react" is not allowed in app/);
    expect(check('src/app/view.tsx', 'export const V = () => <b />;')[0]).toMatch(/"react\/jsx-runtime"/);
    expect(check('src/ui/main.tsx', "import { createRoot } from 'react-dom/client';")).toEqual([]);
    expect(check('src/ui/a.ts', "import { x } from 'left-pad';")[0]).toMatch(/not in the architecture test's package rules/);

    expect(check('src/rxp/a.ts', "import { readFileSync } from 'node:fs';")[0]).toMatch(/Node builtins/);
    expect(check('src/rxp/a.ts', "import { join } from 'path';")[0]).toMatch(/Node builtins/);
    expect(check('src/rxp/a.test.ts', "import { readFileSync } from 'node:fs';")[0]).toMatch(/Node builtins/);
    expect(check('src/rxp/a.test.ts', "import { describe } from 'vitest';")).toEqual([]);
    expect(check('src/rxp/a.ts', "import { describe } from 'vitest';")[0]).toMatch(/"vitest" is not allowed/);
    expect(check('src/rxp/a.test.ts', "import data from '../../tests/fixtures/sample.json';")).toEqual([]);
    expect(check('src/rxp/a.ts', "import data from '../../tests/fixtures/sample.json';")[0]).toMatch(/outside src/);
    expect(check('src/app/a.ts', "export const w = () => import('../optimizer/index');")).toEqual([]);
    expect(check('src/app/a.ts', "import W from '../optimizer/core/search?worker';")).toEqual([]);
  });

  it('applies the nav rows (terrain-navigation.md §18)', () => {
    const files = new Set(['src/domain/index.ts', 'src/geo/index.ts', 'src/rules/index.ts', 'src/nav/index.ts', 'src/nav/worker/client.ts', 'src/engine/index.ts']);
    const exists = (file: string): boolean => files.has(file);
    const check = (file: string, code: string): readonly string[] => {
      const module = moduleOf(file);
      if (module === null) throw new Error(`test file ${file} has no module`);
      const report = { info: { file, module, isTest: TEST_FILE.test(file) }, scan: scanSource(file, code) };
      return importViolations(report, exists).map((line) => line.replace(/^[^ ]+ /, ''));
    };
    expect(check('src/nav/a.ts', ["import { x } from '../geo';", "import { y } from '../domain';"].join('\n'))).toEqual([]);
    expect(check('src/nav/a.ts', "import { x } from '../rules';")[0]).toMatch(/nav may not import rules/);
    expect(check('src/nav/a.ts', "import { w } from './worker/client';")[0]).toMatch(/nav may not import nav\/worker/);
    expect(check('src/nav/worker/w.ts', "import { legsFrom } from '../index';")).toEqual([]);
    expect(check('src/nav/worker/w.ts', "import { x } from '../../geo';")[0]).toMatch(/nav\/worker may not import geo/);
    expect(check('src/engine/a.ts', "import { legsFrom } from '../nav';")[0]).toMatch(/engine may not import nav/);
    expect(check('src/engine/a.ts', "import type { Leg } from '../nav';")).toEqual([]);
    expect(check('src/infra/a.ts', "import { openMap } from '../nav';")).toEqual([]);
    expect(check('src/app/a.ts', ["import { openMap } from '../nav';", "import W from '../nav/worker/client?worker';"].join('\n'))).toEqual([]);
    expect(check('src/ui/a.ts', "import { openMap } from '../nav';")[0]).toMatch(/ui may not import nav/);
    expect(isPure('nav')).toBe(true);
    expect(isPure('nav/worker')).toBe(false);
  });

  it('applies the map/marks rows (docs/research/map-presentation.md §25.2.2, step MP.2b)', () => {
    const files = new Set(['src/domain/index.ts', 'src/geo/index.ts', 'src/map/marks.ts', 'src/map/adapter.ts', 'src/app/map-exports.ts']);
    const exists = (file: string): boolean => files.has(file);
    const check = (file: string, code: string): readonly string[] => {
      const module = moduleOf(file);
      if (module === null) throw new Error(`test file ${file} has no module`);
      const report = { info: { file, module, isTest: TEST_FILE.test(file) }, scan: scanSource(file, code) };
      return importViolations(report, exists).map((line) => line.replace(/^[^ ]+ /, ''));
    };
    // The one path set imports nothing: not even domain or geo, and no package.
    expect(check('src/map/marks.ts', "import { x } from '../domain';")[0]).toMatch(/map\/marks may not import domain \(allowed: nothing/);
    expect(check('src/map/marks.ts', "import { x } from './adapter';")[0]).toMatch(/map\/marks may not import map\/adapter/);
    expect(check('src/map/marks.ts', "import type { Difficulty } from '../domain';")).toEqual([]);
    expect(check('src/map/marks.ts', "import L from 'leaflet';")[0]).toMatch(/"leaflet" is not allowed in map\/marks/);
    // Its readers: map/layers (states) and map/leaflet (pins) directly, app (and infra) by their rules.
    expect(check('src/map/layers.ts', "import { MARK_STATES } from './marks';")).toEqual([]);
    expect(check('src/map/leaflet/pins.ts', "import { QUEST_GLYPH } from '../marks';")).toEqual([]);
    expect(check('src/app/map-exports.ts', "export { QUEST_GLYPH } from '../map/marks';")).toEqual([]);
    expect(check('src/infra/a.ts', "import { MARK_STATES } from '../map/marks';")).toEqual([]);
    // ui reads it only through app/map-exports (as it reads the rules through app/rules-exports).
    expect(check('src/ui/markers/QuestMark.tsx', "import { QUEST_GLYPH } from '../../map/marks';")[0]).toMatch(/ui may not import map\/marks/);
    expect(check('src/ui/markers/QuestMark.tsx', "import type { MarkState } from '../../map/marks';")).toEqual([]);
    expect(check('src/ui/markers/QuestMark.tsx', "import { QUEST_GLYPH } from '../../app/map-exports';")).toEqual([]);
    // map/adapter does not take it (only types, like any pure module); other pure modules neither.
    expect(check('src/map/adapter.ts', "import { MARK_STATES } from './marks';")[0]).toMatch(/map\/adapter may not import map\/marks/);
    expect(check('src/engine/a.ts', "import { MARK_STATES } from '../map/marks';")[0]).toMatch(/engine may not import map\/marks/);
    expect(isPure('map/marks')).toBe(true);
  });

  it('applies the atlas file-level rule (docs/research/map-atlas.md §8.1, MA-14)', () => {
    const files = new Set(['src/geo/atlas.ts', 'src/geo/atlas-layout.ts', 'src/geo/index.ts', 'src/geo/distance.ts']);
    const exists = (file: string): boolean => files.has(file);
    const check = (file: string, code: string): readonly string[] => {
      const module = moduleOf(file);
      if (module === null) throw new Error(`test file ${file} has no module`);
      const report = { info: { file, module, isTest: TEST_FILE.test(file) }, scan: scanSource(file, code) };
      return importViolations(report, exists).map((line) => line.replace(/^[^ ]+ /, ''));
    };
    const values = (from: string): string => [`import { atlasPlacements } from '${from}/atlas';`, `import { ATLAS_LAYOUT } from '${from}/atlas-layout';`].join('\n');
    const types = (from: string): string =>
      [`import type { AtlasPlacement } from '${from}/atlas';`, `import type { AtlasLayout } from '${from}/atlas-layout';`].join('\n');
    // Value importers: map/adapter, map/layers, infra, app, tests and the atlas files themselves.
    expect(check('src/map/adapter.ts', values('../geo'))).toEqual([]);
    expect(check('src/map/layers.ts', values('../geo'))).toEqual([]);
    expect(check('src/infra/maps/atlas-index.ts', values('../../geo'))).toEqual([]);
    expect(check('src/app/map-controller.ts', values('../geo'))).toEqual([]);
    expect(check('src/engine/walk.test.ts', values('../geo'))).toEqual([]);
    expect(check('src/geo/atlas.ts', "import { ATLAS_LAYOUT } from './atlas-layout';")).toEqual([]);
    expect(check('src/geo/atlas-layout.ts', "import { partition } from './atlas';")).toEqual([]);
    // Every other module that may import geo gets the types only.
    for (const file of [
      'src/engine/walk.ts',
      'src/sim/time.ts',
      'src/validate/rules.ts',
      'src/rxp/lower.ts',
      'src/nav/legs.ts',
      'src/optimizer/core/search.ts',
      'src/optimizer/index.ts',
    ]) {
      const from = posix.relative(posix.dirname(file), 'src/geo');
      const found = check(file, values(from));
      expect(found, file).toHaveLength(2);
      for (const line of found) expect(line, file).toMatch(/holds atlas coordinates \(display only, D-017\)/);
      expect(check(file, types(from)), file).toEqual([]);
    }
    // Modules that may not import geo at all are refused too, and may still import the types.
    for (const file of ['src/domain/route.ts', 'src/rules/tables.ts', 'src/diff/diff.ts', 'src/project/schema.ts', 'src/optimizer/worker/w.ts', 'src/ui/Map.tsx', 'src/map/leaflet/a.ts']) {
      const from = posix.relative(posix.dirname(file), 'src/geo');
      expect(check(file, values(from)), file).toHaveLength(2);
      expect(check(file, types(from)), file).toEqual([]);
    }
    // Inside geo: no re-export from the index, no use by the rest of the module.
    expect(check('src/geo/index.ts', "export * from './atlas';")[0]).toMatch(/holds atlas coordinates/);
    expect(check('src/geo/index.ts', "export type { AtlasPlacement } from './atlas';")).toEqual([]);
    expect(check('src/geo/distance.ts', "import { worldToAtlas } from './atlas';")[0]).toMatch(/holds atlas coordinates/);
    expect(check('src/geo/distance.ts', "import { distanceYards } from './index';")).toEqual([]);
  });

  it('keeps the matrix complete, consistent and acyclic', () => {
    for (const module of MODULES) {
      for (const dependency of MAY_IMPORT[module]) {
        expect(MODULES, `${module} lists unknown module ${dependency}`).toContain(dependency);
        expect(dependency, `${module} lists itself`).not.toBe(module);
      }
    }
    for (const module of PURE_MODULES) {
      for (const dependency of MAY_IMPORT[module]) expect(isPure(dependency), `pure ${module} may import non-pure ${dependency}`).toBe(true);
    }
    const visiting = new Set<ModuleName>();
    const done = new Set<ModuleName>();
    const cycle = (module: ModuleName, path: readonly ModuleName[]): string | null => {
      if (done.has(module)) return null;
      if (visiting.has(module)) return [...path, module].join(' → ');
      visiting.add(module);
      for (const dependency of MAY_IMPORT[module]) {
        const found = cycle(dependency, [...path, module]);
        if (found !== null) return found;
      }
      visiting.delete(module);
      done.add(module);
      return null;
    };
    for (const module of MODULES) expect(cycle(module, [])).toBeNull();
    expect(MAY_IMPORT.app).not.toContain('ui');
    expect(MAY_IMPORT.app).not.toContain('map/leaflet');
  });

  it('recognises privacy leaks without matching the placeholder spellings the docs use', () => {
    const windowsProfile = ['C:', 'Users', 'alice', 'Repos', 'x'].join('\\');
    const escapedProfile = ['C:', 'Users', 'alice', 'x'].join('\\\\');
    const forwardProfile = ['C:', 'Users', 'alice', 'x'].join('/');
    const msysProfile = ['', 'c', 'Users', 'alice', 'x'].join('/');
    for (const leak of [windowsProfile, escapedProfile, forwardProfile, msysProfile]) {
      expect(findPrivacyLeaks(`path: ${leak}`), leak).not.toEqual([]);
    }
    const lowerCaseDrive = ['c:', 'users', 'alice', 'x'].join('\\');
    const linuxHome = ['', 'home', 'alice', 'x'].join('/');
    expect(findPrivacyLeaks(lowerCaseDrive)).not.toEqual([]);
    expect(findPrivacyLeaks(`"file://${linuxHome}"`)).not.toEqual([]);
    const placeholders = [
      ['C:', 'Users', '<name>', ''].join('\\'),
      ['', 'c', 'Users', '<name>', ''].join('/'),
      'https://www.chromium.org/Home/chromium-security/x',
      'https://example.org/Users/someone/profile',
      'https://example.org/home/someone/profile',
    ];
    for (const text of placeholders) expect(findPrivacyLeaks(text), text).toEqual([]);
    expect(findPrivacyLeaks('Never read WTF/, Cache/ or SavedVariables.')).toEqual([]);
    const accountPath = ['WTF', 'Account', 'ACCOUNT1', 'SavedVariables', 'Addon.lua'].join('/');
    expect(findPrivacyLeaks(accountPath)).not.toEqual([]);
    const key = ['"Name', 'Realm"'].join(' - ');
    const aceDb = ['AddonDB = {', `\t[${'"profileKeys"'}] = {`, `\t\t[${key}] = ${key},`, '\t},', '}'].join('\n');
    expect(findPrivacyLeaks(aceDb).length).toBe(2);
    expect(SAVED_VARIABLES_PATH.test('local/WTF/Account/x.lua')).toBe(true);
    expect(SAVED_VARIABLES_PATH.test('docs/wtf-notes.md')).toBe(false);
  });
});

// =============================================================================================
// The repository

describe('dependency rules (ARCHITECTURE §4)', () => {
  // The first call parses every src/ file: about 6 s under full-suite load, over the default 5 s.
  it('scans the real source tree', { timeout: 60_000 }, () => {
    // Guards every repository test below against passing on an empty scan (a wrong REPO_ROOT or a moved src/).
    const scanned = scanRepository().reports.map((report) => report.info.file);
    expect(scanned.length).toBeGreaterThan(0);
    expect(scanned).toContain('src/domain/route.ts');
    expect(scanned).toContain('src/app/store.ts');
  });

  it('every source file under src/ belongs to a §4 module', () => {
    expect(scanRepository().unmapped).toEqual([]);
  });

  it('imports follow the allowlist matrix', () => {
    const violations = scanRepository().reports.flatMap((report) => importViolations(report, repoFileExists));
    expect(violations).toEqual([]);
  });
});

describe('pure set (ARCHITECTURE §17)', () => {
  it('references no browser, host, clock, locale or randomness globals', () => {
    const violations = scanRepository().reports
      .filter((report) => isPure(report.info.module))
      .flatMap((report) => report.scan.impure.map((finding) => `${report.info.file}:${String(finding.line)} ${finding.message}`));
    expect(violations).toEqual([]);
  });

  it('tsconfig.pure.json compiles exactly the pure set, with no DOM lib and no ambient types', () => {
    const config = JSON.parse(readFileSync(join(REPO_ROOT, 'tsconfig.pure.json'), 'utf8')) as {
      readonly compilerOptions: { readonly lib?: readonly string[]; readonly types?: readonly string[] };
      readonly include: readonly string[];
      readonly exclude: readonly string[];
    };
    expect(config.compilerOptions.lib).toEqual(['ES2023']);
    expect(config.compilerOptions.types).toEqual([]);
    // map/adapter and map/layers are single files, map/marks two (marks.ts and marks-pins.ts); every other
    // pure module is a directory, and nav/worker (not pure) sits inside the pure nav directory, so it is excluded.
    const expected = [...PURE_MODULES.map((module) => (module.startsWith('map/') ? `src/${module}.ts` : `src/${module}`)), 'src/map/marks-pins.ts'];
    expect([...config.include].sort()).toEqual([...expected].sort());
    expect(config.exclude).toEqual(['src/**/*.test.ts', 'src/**/*.test.tsx', 'src/nav/worker']);
  });

  it('optimizer/core and nav use no implementation-approximated Math (§11.4; terrain-navigation.md G14)', () => {
    const violations = scanRepository().reports
      .filter((report) => (report.info.module === 'optimizer/core' || report.info.module === 'nav') && !report.info.isTest)
      .flatMap((report) => report.scan.floatMath.map((finding) => `${report.info.file}:${String(finding.line)} ${finding.message}`));
    expect(violations).toEqual([]);
  });
});

describe('masks (D-012)', () => {
  it('no src/ file uses a bitwise operator', () => {
    const violations = scanRepository().reports.flatMap((report) =>
      report.scan.bitwise.map((finding) => `${report.info.file}:${String(finding.line)} ${finding.message}`),
    );
    expect(violations).toEqual([]);
  });
});

describe('path hygiene (ARCHITECTURE §17)', () => {
  // Reads every tracked and untracked non-ignored file: 6.7 to 9.6 s under full-suite load, over the default 5 s (follow-up F-12).
  it('no tracked or untracked non-ignored text file contains a user-profile path or SavedVariables content', { timeout: 60_000 }, () => {
    const files = [...new Set([...git(['ls-files', '-z']), ...git(['ls-files', '-z', '--others', '--exclude-standard'])])].sort();
    expect(files.length).toBeGreaterThan(0);
    const violations: string[] = [];
    for (const file of files) {
      if (SAVED_VARIABLES_PATH.test(file)) violations.push(`${file}: path runs through a WTF/SavedVariables folder`);
      const absolute = join(REPO_ROOT, file);
      if (!existsSync(absolute) || !statSync(absolute).isFile()) continue; // deleted in the working tree
      const bytes = readFileSync(absolute);
      if (looksBinary(bytes)) continue;
      for (const hit of findPrivacyLeaks(bytes.toString('utf8'))) {
        violations.push(`${file}:${String(hit.line)} ${hit.pattern}`);
      }
    }
    expect(violations).toEqual([]);
  });
});
