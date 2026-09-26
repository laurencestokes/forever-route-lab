import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  auditDist,
  checkDataBudgets,
  checkEntryChunks,
  checkFileContent,
  checkFileSignature,
  checkForbiddenPaths,
  checkGzipBudget,
  checkImages,
  checkMapFolders,
  checkNavBudget,
  checkRequiredFiles,
  formatAuditReport,
  gzipSize,
  parseDistRequirements,
  removeBuildManifest,
  resolveRequiredFiles,
  type DistRequirements,
  type MapFolder,
  type NavBudget,
} from './lib/audit';
import { REPO_ROOT } from './lib/fs';
import { globToRegExp, matchesAnyGlob } from './lib/glob';

let workspace = '';
let distDir = '';
let repoRoot = '';

beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), 'frl-audit-'));
  distDir = join(workspace, 'dist');
  repoRoot = join(workspace, 'repo');
  mkdirSync(distDir);
  mkdirSync(repoRoot);
});

afterEach(() => {
  rmSync(workspace, { recursive: true, force: true });
});

const writeFiles = (root: string, files: Readonly<Record<string, string | Uint8Array>>): void => {
  for (const [path, content] of Object.entries(files)) {
    const absolute = join(root, path);
    mkdirSync(join(absolute, '..'), { recursive: true });
    writeFileSync(absolute, content);
  }
};

const rulesOf = (violations: readonly { readonly rule: string; readonly path: string | null }[]): readonly string[] =>
  violations.map((violation) => `${violation.rule} ${violation.path ?? '(build)'}`);

const requirements: DistRequirements = {
  required: ['index.html', 'LICENSE.txt', 'third-party-notices.txt'],
  milestone2: {
    activatedBy: 'public/data/manifest.json',
    required: ['data/NOTICE.md', 'data/manifest.json', 'maps/placeholder/geometry.placeholder.json', 'maps/placeholder/NOTICE.md'],
  },
  allowedImages: [{ glob: 'favicon.svg', reason: 'app icon' }, { glob: 'assets/*.svg', reason: 'ui icons' }],
  entryChunkGzipBudgetBytes: 250_000,
  data: { totalGzipBudgetBytes: 1_200_000, baselineTolerance: 0.1, baselines: {} },
  mapFolders: [],
  nav: null,
};

// Built at runtime so this file never contains a literal user-profile path or WTF account path
// (tests/architecture.test.ts scans every repository file for them).
const windowsProfilePath = ['C:', 'Users', 'someone', 'Repos', 'app', 'src', 'x.ts'].join('\\');
const viteStyleProfilePath = ['C:', 'Users', 'someone', 'Repos', 'app'].join('/');
const savedVariablesPath = ['WTF', 'Account', 'x', 'SavedVariables', 'a.txt'].join('/');

const viteManifest = {
  'index.html': { file: 'assets/index-abc.js', name: 'index', src: 'index.html', isEntry: true, imports: ['_vendor-def.js'], dynamicImports: ['src/lazy.ts'], css: ['assets/index-abc.css'] },
  '_vendor-def.js': { file: 'assets/vendor-def.js', name: 'vendor', imports: ['index.html'] },
  'src/lazy.ts': { file: 'assets/lazy-ghi.js', name: 'lazy', src: 'src/lazy.ts', isDynamicEntry: true, imports: ['index.html'] },
};

const cleanDist = (): Record<string, string> => ({
  'index.html': '<!doctype html><script type="module" src="./assets/index-abc.js"></script>',
  'LICENSE.txt': 'GNU GENERAL PUBLIC LICENSE',
  'third-party-notices.txt': 'notices',
  'favicon.svg': '<svg xmlns="http://www.w3.org/2000/svg"></svg>',
  'assets/index-abc.js': 'import "./vendor-def.js"; const cache = React.cache; export { cache };',
  'assets/vendor-def.js': 'export const vendor = 1;',
  'assets/lazy-ghi.js': 'export const lazy = "x".repeat(1000);',
  'assets/index-abc.css': 'body{color:red}',
  '.vite/manifest.json': JSON.stringify(viteManifest),
});

describe('glob matching', () => {
  it.each([
    ['favicon.svg', 'favicon.svg', true],
    ['favicon.svg', 'assets/favicon.svg', false],
    ['assets/*.svg', 'assets/icon-abc.svg', true],
    ['assets/*.svg', 'assets/sub/icon.svg', false],
    ['assets/**/*.svg', 'assets/icon.svg', true],
    ['assets/**/*.svg', 'assets/a/b/icon.svg', true],
    ['**/*.png', 'maps/art/1411.png', true],
    ['icons/?.png', 'icons/a.png', true],
    ['icons/?.png', 'icons/ab.png', false],
    ['a.b', 'axb', false],
    ['maps/**', 'maps/placeholder/x.json', true],
  ])('%s matches %s: %s', (glob, path, expected) => {
    expect(globToRegExp(glob).test(path)).toBe(expected);
  });

  it('matches any of several globs', () => {
    expect(matchesAnyGlob('assets/x.svg', ['favicon.svg', 'assets/*.svg'])).toBe(true);
    expect(matchesAnyGlob('art/x.webp', ['favicon.svg', 'assets/*.svg'])).toBe(false);
  });
});

describe('path rules', () => {
  it('rejects local map sets, maps manifests, Lua, BLP, source maps and tool folders', () => {
    const violations = checkForbiddenPaths([
      'index.html',
      'local-maps/geometry.local.json',
      'maps/maps.manifest.json',
      'data/quests.lua',
      'art/1411.blp',
      'assets/index-abc.js.map',
      'models/x.m2',
      '.cache/questiedb/x.txt',
      '.git/config',
      savedVariablesPath,
      'assets/index-abc.js',
      'data/manifest.json',
    ]);
    expect(rulesOf(violations)).toEqual([
      'local-maps local-maps/geometry.local.json',
      'local-maps maps/maps.manifest.json',
      'file-type data/quests.lua',
      'file-type art/1411.blp',
      'file-type assets/index-abc.js.map',
      'file-type models/x.m2',
      'file-type .cache/questiedb/x.txt',
      'file-type .git/config',
      `privacy ${savedVariablesPath}`,
    ]);
  });

  it('allows only allowlisted images', () => {
    const violations = checkImages(
      ['favicon.svg', 'assets/icon-abc.svg', 'assets/logo.png', 'maps/art/1411.webp', 'art/zone.JPG', 'data/quests.json'],
      requirements.allowedImages,
    );
    expect(rulesOf(violations)).toEqual(['image assets/logo.png', 'image maps/art/1411.webp', 'image art/zone.JPG']);
  });
});

describe('content rules', () => {
  const text = (value: string): Uint8Array => new TextEncoder().encode(value);

  it('finds image and BLP content under names that do not declare it (renamed map art)', () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
    const webp = new Uint8Array([...text('RIFF'), 4, 0, 0, 0, ...text('WEBPVP8L')]);
    const blp = new Uint8Array([...text('BLP2'), 1, 0]);
    expect(rulesOf(checkFileSignature('assets/tile-abc.bin', png))).toEqual(['image assets/tile-abc.bin']);
    expect(rulesOf(checkFileSignature('assets/icon-abc.svg', png))).toEqual(['image assets/icon-abc.svg']);
    expect(rulesOf(checkFileSignature('data/art.json', webp))).toEqual(['image data/art.json']);
    expect(rulesOf(checkFileSignature('assets/x.dat', blp))).toEqual(['file-type assets/x.dat']);
    expect(rulesOf(checkFileSignature('assets/y.jpg', new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61])))).toEqual(['image assets/y.jpg']);
    // A declared image is the extension rule's business (checkImages); text is never an image.
    expect(checkFileSignature('maps/art/1411.png', png)).toEqual([]);
    expect(checkFileSignature('art/1411.blp', blp)).toEqual([]);
    expect(checkFileSignature('assets/index.js', text('export const RIFF = "WEBP";'))).toEqual([]);
    expect(checkFileSignature('favicon.svg', text('<svg xmlns="http://www.w3.org/2000/svg"></svg>'))).toEqual([]);
  });

  it('refuses raw client files (terrain, objects, models, tables, CASC data) by extension and by content (G13)', () => {
    const client = ['maps/x.adt', 'maps/x.wdt', 'maps/x.wdl', 'models/x.wmo', 'models/x.skin', 'models/x.anim', 'data/x.db2', 'data/x.dbc'];
    expect(rulesOf(checkForbiddenPaths(client))).toEqual(client.map((path) => `file-type ${path}`));
    const adt = text('REVM\u0004\u0000\u0000\u0000\u0012\u0000\u0000\u0000');
    const signatures: readonly (readonly [string, Uint8Array])[] = [
      ['nav/0/28_36.bin', adt],
      ['assets/model.bin', text('MD21\u0000\u0000')],
      ['assets/model2.bin', text('MD20\u0000\u0000')],
      ['data/table.json', text('WDC5\u0000\u0000')],
      ['assets/blob', text('BLTE\u0000\u0000\u0000\u0000')],
    ];
    for (const [path, bytes] of signatures) {
      const found = checkFileSignature(path, bytes);
      expect(rulesOf(found)).toEqual([`file-type ${path}`]);
      expect(found[0]?.message).toMatch(/Blizzard client files \(.+ content\) must not ship, whatever the name/);
    }
    // The path rule reports a client file under its own extension; the signature rule does not repeat it.
    expect(checkFileSignature('maps/x.adt', adt)).toEqual([]);
    // Our own navigation blocks and map files are not client files.
    expect(checkFileSignature('nav/0/28_36.bin', text('FRN3\u0003\u0000'))).toEqual([]);
    expect(checkFileSignature('nav/0/map.bin', text('FRNM\u0001\u0000'))).toEqual([]);
  });

  it('finds user-profile paths in raw, escaped and Vite (forward-slash) spellings', () => {
    expect(rulesOf(checkFileContent('a.js', text(`const p = "${windowsProfilePath}";`)))).toEqual(['privacy a.js']);
    expect(rulesOf(checkFileContent('a.js', text(JSON.stringify({ p: windowsProfilePath }))))).toEqual(['privacy a.js']);
    expect(rulesOf(checkFileContent('a.js', text(`import "${viteStyleProfilePath}/src/main.ts";`)))).toEqual(['privacy a.js']);
    expect(checkFileContent('a.js', text('const docs = "C:\\\\Users\\\\<name>\\\\";'))).toEqual([]);
  });

  it('finds .cache path references but not property accesses', () => {
    expect(rulesOf(checkFileContent('a.js', text('fetch("./.cache/questiedb/x.lua")')))).toEqual(['cache-reference a.js']);
    expect(rulesOf(checkFileContent('a.txt', text('see .cache/questiedb')))).toEqual(['cache-reference a.txt']);
    expect(checkFileContent('a.js', text('const c = React.cache; x.cache/2;'))).toEqual([]);
  });

  it('finds local-only map data and SavedVariables content', () => {
    const localOnly = JSON.stringify({ schema: 1, redistribution: 'local-only' }, null, 2);
    expect(rulesOf(checkFileContent('maps/geometry.json', text(localOnly)))).toEqual(['local-maps maps/geometry.json']);
    expect(checkFileContent('a.json', text(JSON.stringify({ redistribution: 'placeholder' })))).toEqual([]);
    const profileKeys = `AddonDB = {\n\t[${'"profileKeys"'}] = {\n`;
    expect(rulesOf(checkFileContent('a.txt', text(profileKeys)))).toEqual(['privacy a.txt']);
  });

  it('checks binary files for user-profile paths only', () => {
    const binary = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, ...text(windowsProfilePath), 0, ...text('.cache/x')]);
    expect(rulesOf(checkFileContent('assets/x.wasm', binary))).toEqual(['privacy assets/x.wasm']);
    expect(checkFileContent('assets/y.wasm', new Uint8Array([0, 1, 2, ...text('.cache/x')]))).toEqual([]);
  });
});

describe('required files', () => {
  it('requires the Milestone 1 list until public/data/manifest.json exists', () => {
    const required = resolveRequiredFiles(requirements, repoRoot, distDir);
    expect(required.milestone2Active).toBe(false);
    expect(required.files).toEqual(['LICENSE.txt', 'index.html', 'third-party-notices.txt']);
    expect(rulesOf(checkRequiredFiles(['index.html'], required.files))).toEqual(['required LICENSE.txt', 'required third-party-notices.txt']);
  });

  it('adds the Milestone 2 list and every dataset output once the dataset manifest exists', () => {
    writeFiles(repoRoot, { 'public/data/manifest.json': '{}' });
    writeFiles(distDir, {
      'data/manifest.json': JSON.stringify({ outputs: [{ path: 'quests.json' }, { path: 'NOTICE.md' }, { path: 'spawns.json' }] }),
    });
    const required = resolveRequiredFiles(requirements, repoRoot, distDir);
    expect(required.milestone2Active).toBe(true);
    expect(required.violations).toEqual([]);
    expect(required.files).toEqual([
      'LICENSE.txt',
      'data/NOTICE.md',
      'data/manifest.json',
      'data/quests.json',
      'data/spawns.json',
      'index.html',
      'maps/placeholder/NOTICE.md',
      'maps/placeholder/geometry.placeholder.json',
      'third-party-notices.txt',
    ]);
  });

  it('reports a dataset manifest whose outputs cannot be trusted', () => {
    writeFiles(repoRoot, { 'public/data/manifest.json': '{}' });
    writeFiles(distDir, { 'data/manifest.json': JSON.stringify({ outputs: [{ path: '../index.html' }] }) });
    expect(rulesOf(resolveRequiredFiles(requirements, repoRoot, distDir).violations)).toEqual(['required data/manifest.json']);
  });
});

describe('size gates', () => {
  it('sums the entry chunk and its static imports, not dynamic imports', () => {
    writeFiles(distDir, cleanDist());
    const { reports, violations } = checkEntryChunks(distDir, 250_000);
    expect(violations).toEqual([]);
    expect(reports).toHaveLength(1);
    const report = reports[0];
    expect(report?.entry).toBe('index.html');
    expect(report?.chunks.map((chunk) => chunk.file)).toEqual(['assets/index-abc.js', 'assets/vendor-def.js']);
    const expected = ['assets/index-abc.js', 'assets/vendor-def.js']
      .map((file) => gzipSize(readFileSync(join(distDir, file))))
      .reduce((a, b) => a + b, 0);
    expect(report?.totalGzipBytes).toBe(expected);
    expect(report?.css.map((sheet) => sheet.file)).toEqual(['assets/index-abc.css']);
  });

  it('reports what the entry loads lazily, transitively, without gating it or counting shared chunks twice', () => {
    writeFiles(distDir, {
      ...cleanDist(),
      'assets/map-jkl.js': 'export const map = "m".repeat(4000);',
      'assets/map-jkl.css': '.map{color:blue}',
      'assets/shared-mno.js': 'export const shared = 2;',
      'assets/deeper-pqr.js': 'export const deeper = 3;',
      '.vite/manifest.json': JSON.stringify({
        ...viteManifest,
        'index.html': { ...viteManifest['index.html'], dynamicImports: ['src/lazy.ts', 'src/map.ts', 'src/gone.ts'] },
        // Imports the entry's own vendor chunk (already loaded, not counted) and a chunk shared with another lazy chunk.
        'src/map.ts': { file: 'assets/map-jkl.js', isDynamicEntry: true, imports: ['_vendor-def.js', '_shared-mno.js'], dynamicImports: ['src/deeper.ts'], css: ['assets/map-jkl.css'] },
        '_shared-mno.js': { file: 'assets/shared-mno.js' },
        'src/deeper.ts': { file: 'assets/deeper-pqr.js', isDynamicEntry: true, imports: ['_shared-mno.js', 'index.html'] },
      }),
    });
    // A tiny budget fails the entry gate only: lazy chunks are never gated.
    expect(rulesOf(checkEntryChunks(distDir, 10).violations)).toEqual(['entry-chunk (build)']);
    const { reports, violations } = checkEntryChunks(distDir, 250_000);
    expect(violations).toEqual([]);
    const report = reports[0];
    expect(report?.chunks.map((chunk) => chunk.file)).toEqual(['assets/index-abc.js', 'assets/vendor-def.js']);
    const lazyFiles = ['assets/deeper-pqr.js', 'assets/lazy-ghi.js', 'assets/map-jkl.js', 'assets/shared-mno.js'];
    expect(report?.lazy.chunks.map((chunk) => chunk.file)).toEqual(lazyFiles);
    const expected = lazyFiles.map((file) => gzipSize(readFileSync(join(distDir, file)))).reduce((a, b) => a + b, 0);
    expect(report?.lazy.totalGzipBytes).toBe(expected);
    expect(report?.lazy.css.map((sheet) => sheet.file)).toEqual(['assets/map-jkl.css']);
  });

  it('fails above the budget, on a missing manifest and on dangling imports', () => {
    writeFiles(distDir, cleanDist());
    expect(rulesOf(checkEntryChunks(distDir, 10).violations)).toEqual(['entry-chunk (build)']);
    writeFiles(distDir, {
      '.vite/manifest.json': JSON.stringify({ 'index.html': { file: 'assets/index-abc.js', isEntry: true, imports: ['_gone.js'] } }),
    });
    expect(checkEntryChunks(distDir, 250_000).violations[0]?.message).toMatch(/unknown manifest key "_gone.js"/);
    rmSync(join(distDir, '.vite'), { recursive: true });
    expect(checkEntryChunks(distDir, 250_000).violations[0]?.message).toMatch(/manifest is missing/);
  });

  it('checks data files against baselines and the total budget', () => {
    const big = 'x'.repeat(5000);
    writeFiles(distDir, { 'data/quests.json': big, 'data/NOTICE.md': 'notice', 'index.html': 'x' });
    const files = ['data/NOTICE.md', 'data/quests.json', 'index.html'];
    const gz = gzipSize(new TextEncoder().encode(big));
    const within = checkDataBudgets(distDir, files, { totalGzipBudgetBytes: 1_200_000, baselineTolerance: 0.1, baselines: { 'data/quests.json': gz } }, false);
    expect(within.violations).toEqual([]);
    expect(within.report.files.map((file) => file.file)).toEqual(['data/NOTICE.md', 'data/quests.json']);
    const over = checkDataBudgets(distDir, files, { totalGzipBudgetBytes: 10, baselineTolerance: 0.1, baselines: { 'data/quests.json': Math.floor(gz / 2) } }, false);
    expect(rulesOf(over.violations)).toEqual(['data-budget data/quests.json', 'data-budget (build)']);
  });

  it('requires a baseline for every data file once Milestone 2 is active', () => {
    writeFiles(distDir, { 'data/quests.json': 'x'.repeat(5000), 'data/renamed.json': 'y'.repeat(9000), 'index.html': 'x' });
    const files = ['data/quests.json', 'data/renamed.json', 'index.html'];
    const data = { totalGzipBudgetBytes: 1_200_000, baselineTolerance: 0.1, baselines: { 'data/quests.json': 1_000 } };
    // Before Milestone 2 an unrecorded file is only counted in the total.
    expect(checkDataBudgets(distDir, files, data, false).violations).toEqual([]);
    const active = checkDataBudgets(distDir, files, data, true);
    expect(rulesOf(active.violations)).toEqual(['data-budget data/renamed.json']);
    expect(active.violations[0]?.message).toMatch(/no gzip baseline recorded/);
    // A key inherited from Object.prototype is not a recorded baseline.
    writeFiles(distDir, { 'data/constructor': 'z' });
    expect(rulesOf(checkDataBudgets(distDir, ['data/constructor'], { ...data, baselines: {} }, true).violations)).toEqual([
      'data-budget data/constructor',
    ]);
  });

  it('fails a whole dataset build on an unrecorded data file', () => {
    writeFiles(repoRoot, { 'public/data/manifest.json': '{}' });
    writeFiles(distDir, {
      ...cleanDist(),
      'data/NOTICE.md': 'notice',
      'data/manifest.json': JSON.stringify({ outputs: [{ path: 'quests.json' }] }),
      'data/quests.json': '[]',
      'maps/placeholder/geometry.placeholder.json': '{}',
      'maps/placeholder/NOTICE.md': 'notice',
    });
    const baselines = { 'data/NOTICE.md': 100, 'data/manifest.json': 100 };
    const result = auditDist({ distDir, repoRoot, requirements: { ...requirements, data: { ...requirements.data, baselines } } });
    expect(rulesOf(result.violations)).toEqual(['data-budget data/quests.json']);
  });

  it('measures gzip at zlib level 6', () => {
    const bytes = new TextEncoder().encode('forever route lab '.repeat(200));
    expect(gzipSize(bytes)).toBe(gzipSync(bytes, { level: 6 }).length);
  });
});

describe('whole audit', () => {
  it('passes a clean build and prints a size report', () => {
    writeFiles(distDir, cleanDist());
    const result = auditDist({ distDir, repoRoot, requirements });
    expect(result.violations).toEqual([]);
    const report = formatAuditReport(result);
    expect(report).toContain('Entry "index.html" + static imports (budget 250.00 kB gzip)');
    expect(report).toContain('assets/vendor-def.js');
    // The lazy chunk is listed after the gated entry total, in its own section.
    const lazySection = report.indexOf('Loaded lazily by dynamic import() (not gated):');
    expect(lazySection).toBeGreaterThan(report.indexOf('assets/vendor-def.js'));
    expect(report.indexOf('assets/lazy-ghi.js')).toBeGreaterThan(lazySection);
    expect(report).toMatch(/dist audit passed\./);
  });

  it('reports every problem in a dirty build', () => {
    writeFiles(distDir, {
      ...cleanDist(),
      'local-maps/maps.manifest.json': JSON.stringify({ schema: 1, redistribution: 'local-only' }),
      'maps/art/1411.webp': new Uint8Array([0x52, 0x49, 0x46, 0x46, 0]),
      'assets/index-abc.js.map': '{"sources":["../src/main.ts"]}',
      'assets/leak.js': `console.log(${JSON.stringify(windowsProfilePath)});`,
    });
    rmSync(join(distDir, 'LICENSE.txt'));
    const result = auditDist({ distDir, repoRoot, requirements });
    expect(new Set(result.violations.map((violation) => violation.rule))).toEqual(
      new Set(['local-maps', 'image', 'file-type', 'privacy', 'required']),
    );
    expect(formatAuditReport(result)).toMatch(/dist audit FAILED with \d+ problem\(s\):/);
  });

  it('refuses to run before the build', () => {
    expect(() => auditDist({ distDir: join(workspace, 'missing'), repoRoot, requirements })).toThrow(/run vite build first/);
  });

  it('removes the build manifest after the audit, and only that', () => {
    writeFiles(distDir, cleanDist());
    expect(auditDist({ distDir, repoRoot, requirements }).violations).toEqual([]);
    expect(removeBuildManifest(distDir)).toBe(true);
    expect(existsSync(join(distDir, '.vite'))).toBe(false);
    expect(existsSync(join(distDir, 'index.html'))).toBe(true);
    expect(existsSync(join(distDir, 'assets', 'index-abc.js'))).toBe(true);
    expect(removeBuildManifest(distDir)).toBe(false);
  });
});

describe('map folders: the one image allowlist (D-032, D-033)', () => {
  const sha = (bytes: string | Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
  const webp = new Uint8Array([...new TextEncoder().encode('RIFF'), 4, 0, 0, 0, ...new TextEncoder().encode('WEBPVP8 ')]);
  const art: MapFolder = { name: 'art', dir: 'maps/art', source: 'public/maps/art', reason: 'D-033', totalGzipBudgetBytes: 12_000_000, baselineTolerance: 0.1, baselines: {} };
  const terrain: MapFolder = { ...art, name: 'terrain', dir: 'maps/terrain', source: 'public/maps/terrain', totalGzipBudgetBytes: 600_000 };
  const artFiles = (overrides: Readonly<Record<string, string | Uint8Array>> = {}, manifestFiles?: readonly unknown[]): Record<string, string | Uint8Array> => ({
    'maps/art/NOTICE.md': 'Blizzard Entertainment owns the artwork',
    'maps/art/1411.webp': webp,
    'maps/art/manifest.json': JSON.stringify({ files: manifestFiles ?? [{ path: '1411.webp', sha256: sha(webp) }] }),
    ...overrides,
  });
  const list = (): readonly string[] => {
    const out: string[] = [];
    const walk = (dir: string, prefix: string): void => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p, `${prefix}${name}/`);
        else out.push(`${prefix}${name}`);
      }
    };
    walk(distDir, '');
    return out.sort();
  };

  it('allows an image a folder manifest lists with its SHA-256, next to its NOTICE', () => {
    writeFiles(distDir, artFiles());
    const result = checkMapFolders(distDir, list(), [art, terrain], repoRoot);
    expect(result.violations).toEqual([]);
    expect([...result.allowedImages]).toEqual(['maps/art/1411.webp']);
    expect(checkImages(list(), requirements.allowedImages, result.allowedImages)).toEqual([]);
    // Without the folder allowlist the same image is refused, as before D-033.
    expect(rulesOf(checkImages(list(), requirements.allowedImages))).toEqual(['image maps/art/1411.webp']);
  });

  it('refuses unlisted files, changed bytes, a missing NOTICE or manifest, and listed files that are missing', () => {
    writeFiles(distDir, artFiles({ 'maps/art/1412.webp': webp, 'maps/art/extra.json': '{}' }));
    expect(rulesOf(checkMapFolders(distDir, list(), [art], repoRoot).violations)).toEqual(['map-folder maps/art/1412.webp', 'map-folder maps/art/extra.json']);
    rmSync(distDir, { recursive: true });
    writeFiles(distDir, artFiles({}, [{ path: '1411.webp', sha256: sha('something else') }]));
    const changed = checkMapFolders(distDir, list(), [art], repoRoot);
    expect(rulesOf(changed.violations)).toEqual(['map-folder maps/art/1411.webp']);
    expect(changed.allowedImages.size).toBe(0);
    rmSync(join(distDir, 'maps', 'art', 'NOTICE.md'));
    expect(rulesOf(checkMapFolders(distDir, list(), [art], repoRoot).violations)).toContain('map-folder maps/art/NOTICE.md');
    rmSync(distDir, { recursive: true });
    writeFiles(distDir, artFiles({}, [{ path: '1411.webp', sha256: sha(webp) }, { path: 'gone.webp', sha256: sha('x') }]));
    expect(rulesOf(checkMapFolders(distDir, list(), [art], repoRoot).violations)).toEqual(['map-folder maps/art/gone.webp']);
    rmSync(join(distDir, 'maps', 'art', 'manifest.json'));
    expect(rulesOf(checkMapFolders(distDir, list(), [art], repoRoot).violations)).toEqual(['map-folder maps/art/manifest.json', 'map-folder maps/art/1411.webp']);
    writeFiles(distDir, { 'maps/art/manifest.json': JSON.stringify({ files: [{ path: '../x.webp', sha256: sha(webp) }] }) });
    expect(checkMapFolders(distDir, list(), [art], repoRoot).violations[0]?.message).toMatch(/invalid files\[\] entry/);
  });

  it('requires the folder once the repository has its manifest, and refuses images of an unconfigured folder', () => {
    writeFiles(repoRoot, { 'public/maps/terrain/manifest.json': '{}' });
    writeFiles(distDir, artFiles({ 'maps/other/1411.webp': webp }));
    const result = checkMapFolders(distDir, list(), [art, terrain], repoRoot);
    expect(rulesOf(result.violations)).toEqual(['map-folder maps/terrain']);
    expect(rulesOf(checkImages(list(), requirements.allowedImages, result.allowedImages))).toEqual(['image maps/other/1411.webp']);
  });

  it('gates a folder by per-file baselines and its total, requiring baselines once active', () => {
    writeFiles(distDir, artFiles());
    const files = list();
    const where = { prefix: 'maps/art/', section: 'mapFolders "art"', rule: 'art-budget', why: 'D-034 item 4' };
    const baselines = Object.fromEntries(files.map((f) => [f, gzipSize(readFileSync(join(distDir, f)))]));
    expect(checkGzipBudget(distDir, files, where, { ...art, baselines }, true).violations).toEqual([]);
    expect(rulesOf(checkGzipBudget(distDir, files, where, { ...art, baselines: {} }, true).violations)).toEqual(['art-budget maps/art/1411.webp', 'art-budget maps/art/NOTICE.md', 'art-budget maps/art/manifest.json']);
    expect(checkGzipBudget(distDir, files, where, { ...art, baselines: {} }, false).violations).toEqual([]);
    const over = checkGzipBudget(distDir, files, where, { ...art, totalGzipBudgetBytes: 10, baselines: { ...baselines, 'maps/art/1411.webp': 1 } }, true);
    expect(rulesOf(over.violations)).toEqual(['art-budget maps/art/1411.webp', 'art-budget (build)']);
  });

  it('passes a whole build with a committed art folder and reports its budget', () => {
    writeFiles(repoRoot, { 'public/maps/art/manifest.json': '{}' });
    writeFiles(distDir, { ...cleanDist(), ...artFiles() });
    const baselines = Object.fromEntries(Object.keys(artFiles()).map((f) => [f, gzipSize(readFileSync(join(distDir, f)))]));
    const result = auditDist({ distDir, repoRoot, requirements: { ...requirements, mapFolders: [{ ...art, baselines }] } });
    expect(result.violations).toEqual([]);
    expect(formatAuditReport(result)).toMatch(/maps\/art\/ \(art budget 12\.00 MB gzip\): 3 files/);
    const unrecorded = auditDist({ distDir, repoRoot, requirements: { ...requirements, mapFolders: [art] } });
    expect(new Set(unrecorded.violations.map((v) => v.rule))).toEqual(new Set(['art-budget']));
  });
});

describe('nav budget (D-030)', () => {
  const nav: NavBudget = {
    dir: 'nav',
    activatedBy: 'public/nav/manifest.json',
    required: ['nav/manifest.json', 'nav/NOTICE.md'],
    totalGzipBudgetBytes: 7_000_000,
    targetGzipBytes: { min: 5_000_000, max: 6_000_000 },
    perFileGzipCapBytes: 300_000,
    baselineTolerance: 0.1,
    mapBaselines: { '0': 1_000, '1': 1_000 },
  };
  /** Incompressible, deterministic bytes (a SHA-256 chain), so gzip sizes are predictable. */
  const random = (n: number, seed: number): Uint8Array => {
    const parts: Buffer[] = [];
    let block = createHash('sha256').update(String(seed)).digest();
    for (let size = 0; size < n; size += block.length) {
      parts.push(block);
      block = createHash('sha256').update(block).digest();
    }
    return new Uint8Array(Buffer.concat(parts).subarray(0, n));
  };

  it('sums per map folder, caps every file and the total, and needs baselines and notices once active', () => {
    writeFiles(distDir, { 'nav/0/28_36.bin': random(400, 1), 'nav/1/28_36.bin': random(400, 2), 'nav/1/map.bin': random(300, 3) });
    const files = ['nav/0/28_36.bin', 'nav/1/28_36.bin', 'nav/1/map.bin'];
    const inactive = checkNavBudget(distDir, files, nav, repoRoot);
    expect(inactive.violations).toEqual([]);
    expect(inactive.report.maps.map((m) => [m.mapId, m.files])).toEqual([['0', 1], ['1', 2]]);
    expect(inactive.report.totalGzipBytes).toBe(files.map((f) => gzipSize(readFileSync(join(distDir, f)))).reduce((a, b) => a + b, 0));
    const tight = checkNavBudget(distDir, files, { ...nav, perFileGzipCapBytes: 350, mapBaselines: { '0': 1_000, '1': 500 }, totalGzipBudgetBytes: 1_000 }, repoRoot);
    expect(rulesOf(tight.violations)).toEqual(['nav-budget nav/0/28_36.bin', 'nav-budget nav/1/28_36.bin', 'nav-budget nav/1', 'nav-budget (build)']);
    writeFiles(repoRoot, { 'public/nav/manifest.json': '{}' });
    expect(rulesOf(checkNavBudget(distDir, files, { ...nav, mapBaselines: { '0': 1_000 } }, repoRoot).violations)).toEqual(['nav-budget nav/manifest.json', 'nav-budget nav/NOTICE.md', 'nav-budget nav/1']);
  });
});

describe('dist-requirements.json', () => {
  it('the committed file configures the art, terrain and nav budgets, and records a baseline for every committed map-folder file', () => {
    const parsed = parseDistRequirements(JSON.parse(readFileSync(join(REPO_ROOT, 'tools', 'build', 'dist-requirements.json'), 'utf8')) as unknown);
    expect(parsed.mapFolders.map((f) => [f.name, f.dir, f.source, f.totalGzipBudgetBytes])).toEqual([
      ['art', 'maps/art', 'public/maps/art', 12_000_000],
      ['terrain', 'maps/terrain', 'public/maps/terrain', 600_000],
    ]);
    expect(parsed.nav).toMatchObject({ dir: 'nav', totalGzipBudgetBytes: 7_000_000, perFileGzipCapBytes: 300_000, targetGzipBytes: { min: 5_000_000, max: 6_000_000 } });
    expect(Object.keys(parsed.nav?.mapBaselines ?? {})).toEqual(['0', '1']);
    for (const folder of parsed.mapFolders) {
      const source = join(REPO_ROOT, folder.source);
      if (!existsSync(source)) continue;
      const committed: string[] = [];
      const walk = (dir: string, prefix: string): void => {
        for (const name of readdirSync(dir)) {
          const p = join(dir, name);
          if (statSync(p).isDirectory()) walk(p, `${prefix}${name}/`);
          else committed.push(`${folder.dir}/${prefix}${name}`);
        }
      };
      walk(source, '');
      expect(Object.keys(folder.baselines).sort()).toEqual(committed.sort());
      const total = committed.reduce((sum, path) => sum + gzipSize(readFileSync(join(source, path.slice(folder.dir.length + 1)))), 0);
      expect(total).toBeLessThanOrEqual(folder.totalGzipBudgetBytes);
    }
  });

  it('the committed file is valid and lists the Milestone 1 and Milestone 2 requirements', () => {
    const parsed = parseDistRequirements(JSON.parse(readFileSync(join(REPO_ROOT, 'tools', 'build', 'dist-requirements.json'), 'utf8')) as unknown);
    expect(parsed.required).toEqual(['index.html', 'LICENSE.txt', 'third-party-notices.txt']);
    expect(parsed.milestone2.activatedBy).toBe('public/data/manifest.json');
    expect(parsed.milestone2.required).toEqual([
      'data/NOTICE.md',
      'data/manifest.json',
      'maps/placeholder/geometry.placeholder.json',
      'maps/placeholder/NOTICE.md',
    ]);
    expect(parsed.entryChunkGzipBudgetBytes).toBe(250_000);
  });

  it('rejects malformed requirements', () => {
    expect(() => parseDistRequirements([])).toThrow(/expected an object/);
    expect(() => parseDistRequirements({ ...requirements, required: 'index.html' })).toThrow(/required must be an array/);
    expect(() => parseDistRequirements({ ...requirements, allowedImages: [{ glob: '*.png' }] })).toThrow(/non-empty "reason"/);
    expect(() => parseDistRequirements({ ...requirements, entryChunkGzipBudgetBytes: -1 })).toThrow(/non-negative/);
  });
});
