import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  collectNoticeEntries,
  renderThirdPartyNotices,
  TRUNCATION_NOTE,
  truncateLicenceText,
  writeDistNotices,
  type NoticeEntry,
} from './lib/notices';
import { normaliseRepository, readPackageLegalFiles, type ShippedPackage } from './lib/packages';

let workspace = '';

beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), 'frl-notices-'));
});

afterEach(() => {
  rmSync(workspace, { recursive: true, force: true });
});

const writeFiles = (root: string, files: Readonly<Record<string, string>>): void => {
  for (const [path, content] of Object.entries(files)) {
    const absolute = join(root, path);
    mkdirSync(join(absolute, '..'), { recursive: true });
    writeFileSync(absolute, content);
  }
};

describe('repository normalisation', () => {
  it.each([
    ['git+https://github.com/colinhacks/zod.git', 'https://github.com/colinhacks/zod'],
    ['git://github.com/Leaflet/Leaflet.git', 'https://github.com/Leaflet/Leaflet'],
    ['git@github.com:owner/repo.git', 'https://github.com/owner/repo'],
    ['ssh://git@github.com/owner/repo.git', 'https://github.com/owner/repo'],
    ['github:owner/repo', 'https://github.com/owner/repo'],
    ['gitlab:owner/repo', 'https://gitlab.com/owner/repo'],
    ['owner/repo', 'https://github.com/owner/repo'],
    ['https://example.org/project', 'https://example.org/project'],
  ])('%s → %s', (input, expected) => {
    expect(normaliseRepository(input)).toBe(expected);
    expect(normaliseRepository({ type: 'git', url: input })).toBe(expected);
  });

  it('appends a monorepo directory and returns null when absent', () => {
    expect(normaliseRepository({ type: 'git', url: 'https://github.com/react/react.git', directory: 'packages/react' })).toBe(
      'https://github.com/react/react (packages/react)',
    );
    expect(normaliseRepository(undefined)).toBeNull();
    expect(normaliseRepository({ type: 'git' })).toBeNull();
    expect(normaliseRepository('  ')).toBeNull();
  });
});

describe('package legal files', () => {
  it('reads top-level licence and NOTICE files, sorted, with LF endings and no trailing whitespace', () => {
    writeFiles(workspace, {
      'LICENSE': 'MIT License\r\n\r\nCopyright (c) Someone\r\n\r\n',
      'LICENSE-APACHE': 'Apache text\n',
      'licence.txt': 'British spelling\n',
      'COPYING': 'Copying text',
      'NOTICE': 'Apache NOTICE\n',
      'THIRD-PARTY-LICENSE': 'bundled deps of the tool itself',
      'README.md': 'readme',
      'license.d/nested.txt': 'a directory whose name looks like a licence file is ignored',
    });
    const legal = readPackageLegalFiles(workspace);
    expect(legal.licences.map((file) => file.file)).toEqual(['COPYING', 'LICENSE', 'LICENSE-APACHE', 'licence.txt']);
    expect(legal.licences.find((file) => file.file === 'LICENSE')?.text).toBe('MIT License\n\nCopyright (c) Someone');
    expect(legal.notices).toEqual([{ file: 'NOTICE', text: 'Apache NOTICE' }]);
    expect(readPackageLegalFiles(join(workspace, 'missing'))).toEqual({ licences: [], notices: [] });
  });

  it('truncates a licence file at the configured line', () => {
    const text = '# Tool licence\nMIT text\n\n# Licenses of bundled dependencies\nlots of other licences';
    expect(truncateLicenceText(text, '# Licenses of bundled dependencies')).toBe(`# Tool licence\nMIT text\n\n${TRUNCATION_NOTE}`);
    expect(truncateLicenceText(text, 'no such line')).toBe(text);
    expect(truncateLicenceText(text, null)).toBe(text);
  });
});

describe('third-party notices', () => {
  const entry = (name: string, version: string, overrides: Partial<NoticeEntry> = {}): NoticeEntry => ({
    name,
    version,
    licence: 'MIT',
    repository: `https://github.com/example/${name}`,
    inclusion: 'production',
    reason: null,
    licenceFiles: [{ file: 'LICENSE', text: `${name} licence text` }],
    noticeFiles: [],
    ...overrides,
  });

  it('renders every package with its metadata and full licence text, sorted and byte-stable', () => {
    const entries = [
      entry('zod', '4.6.5'),
      entry('bundler', '1.0.0', { inclusion: 'bundled-dev', reason: 'injects runtime helpers', noticeFiles: [{ file: 'NOTICE', text: 'notice' }] }),
      entry('react', '19.3.0', { repository: null, licenceFiles: [] }),
      entry('react', '18.3.1'),
    ];
    const text = renderThirdPartyNotices('forever-route-lab', entries);
    expect(renderThirdPartyNotices('forever-route-lab', [...entries].reverse())).toBe(text);
    expect(text.startsWith('forever-route-lab: third-party software notices\n')).toBe(true);
    expect(text.endsWith('\n')).toBe(true);
    expect(text).toContain('Packages: 4.');
    const order = ['bundler 1.0.0', 'react 18.3.1', 'react 19.3.0', 'zod 4.6.5'].map((heading) => text.indexOf(`\n${heading}\n`));
    expect(order.every((index) => index > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(text).toContain('Licence (declared): MIT\nRepository: https://github.com/example/zod\nIncluded as: production dependency');
    expect(text).toContain('Included as: development dependency bundled into the build (injects runtime helpers)');
    expect(text).toContain('Repository: not declared');
    expect(text).toContain('No licence file was found in the package. Its declared licence is MIT.');
    expect(text).toContain('LICENSE:\n' + '-'.repeat(80) + '\n\nzod licence text');
    expect(text).toContain('NOTICE:\n' + '-'.repeat(80) + '\n\nnotice');
  });

  it('writes dist/third-party-notices.txt and dist/LICENSE.txt without install paths', () => {
    const packageDir = join(workspace, 'node_modules', 'demo');
    writeFiles(packageDir, {
      'package.json': JSON.stringify({ name: 'demo', repository: 'git+https://github.com/example/demo.git' }),
      'LICENSE': 'Demo licence',
    });
    writeFiles(workspace, { 'repo/LICENSE': 'GNU GENERAL PUBLIC LICENSE\n' });
    const distDir = join(workspace, 'dist');
    mkdirSync(distDir);
    const shipped: ShippedPackage = {
      name: 'demo',
      version: '1.2.3',
      licence: 'MIT',
      directory: packageDir,
      inclusion: 'production',
      reason: null,
      licenceTextUntil: null,
    };
    writeDistNotices({
      distDir,
      licencePath: join(workspace, 'repo', 'LICENSE'),
      projectName: 'forever-route-lab',
      entries: collectNoticeEntries([shipped]),
    });
    const notices = readFileSync(join(distDir, 'third-party-notices.txt'), 'utf8');
    expect(notices).toContain('demo 1.2.3\n');
    expect(notices).toContain('Repository: https://github.com/example/demo');
    expect(notices).toContain('Demo licence');
    expect(notices).not.toContain(workspace);
    expect(notices).not.toContain('node_modules');
    expect(readFileSync(join(distDir, 'LICENSE.txt'), 'utf8')).toBe('GNU GENERAL PUBLIC LICENSE\n');
  });

  it('refuses to run before the build', () => {
    expect(() =>
      writeDistNotices({ distDir: join(workspace, 'no-dist'), licencePath: join(workspace, 'LICENSE'), projectName: 'x', entries: [] }),
    ).toThrow(/run vite build first/);
  });
});
