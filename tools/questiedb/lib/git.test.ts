import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { commitDate, fetchObjects, git, gitCapabilities, gitText, isGitCheckout, isPartialClone, localObjects, parseCatFileBatch, sha256Hex, workingTreeId } from './git';
import { blobId, crlfToLf, globToRegExp, inProcessTreeId, looksBinary } from './git-tree';
import { InputHashError, loadUpstream, openPinnedSource, REPO_ROOT, TOOL_DIR } from './upstream';

const IN_CHECKOUT = isGitCheckout(REPO_ROOT);

describe('git cat-file --batch parsing (code-F13)', () => {
  const header = (oid: string, size: number): string => `${oid} blob ${String(size)}\n`;
  const a = 'a'.repeat(40);
  const b = 'b'.repeat(40);

  it('reads blobs in request order and maps a missing object to null', () => {
    const out = Buffer.concat([
      Buffer.from(header(a, 5)),
      Buffer.from('hello\n'),
      Buffer.from('c0ffee:missing.lua missing\n'),
      Buffer.from(header(b, 3)),
      Buffer.from([0x00, 0x0a, 0xff, 0x0a]),
    ]);
    const blobs = parseCatFileBatch(out, ['a.lua', 'missing.lua', 'b.bin']);
    expect(blobs.get('a.lua')?.toString('utf8')).toBe('hello');
    expect(blobs.get('missing.lua')).toBeNull();
    expect([...(blobs.get('b.bin') ?? [])]).toEqual([0x00, 0x0a, 0xff]);
  });

  it('fails closed on truncated output, a non-blob object and trailing bytes', () => {
    expect(() => parseCatFileBatch(Buffer.from(`${header(a, 10)}short\n`), ['a'])).toThrow(/truncated/);
    expect(() => parseCatFileBatch(Buffer.from(''), ['a'])).toThrow(/truncated/);
    expect(() => parseCatFileBatch(Buffer.from(`${a} tree 3\nabc\n`), ['a'])).toThrow(/is .* tree/);
    expect(() => parseCatFileBatch(Buffer.from(`${header(a, 1)}x\nextra`), ['a'])).toThrow(/trailing/);
  });
});

describe('git capabilities (data-F4)', () => {
  it('detects the version and whether GIT_NO_LAZY_FETCH is supported', () => {
    const caps = gitCapabilities();
    expect(caps.version).toMatch(/^git version \d+\.\d+/);
    expect(typeof caps.noLazyFetch).toBe('boolean');
  });

  describe('a partial clone', () => {
    const root = mkdtempSync(join(tmpdir(), 'questiedb-partial-'));
    afterAll(() => {
      rmSync(root, { recursive: true, force: true });
    });

    it('is detected, its missing blobs are found without fetching them, and one batched fetch gets them', () => {
      const origin = join(root, 'origin');
      const clone = join(root, 'clone');
      git(['init', '--quiet', origin]);
      writeFileSync(join(origin, 'a.txt'), 'first\n');
      writeFileSync(join(origin, 'b.txt'), 'second\n');
      const env = { GIT_AUTHOR_NAME: 'test', GIT_AUTHOR_EMAIL: 'test@example.invalid', GIT_COMMITTER_NAME: 'test', GIT_COMMITTER_EMAIL: 'test@example.invalid' };
      git(['-C', origin, 'add', 'a.txt', 'b.txt']);
      const tree = gitText(['-C', origin, 'write-tree']);
      const commit = gitText(['-C', origin, 'commit-tree', tree, '-m', 'fixture'], { env });
      git(['-C', origin, 'update-ref', 'refs/heads/main', commit]);
      git(['-C', origin, 'symbolic-ref', 'HEAD', 'refs/heads/main']);
      git(['-C', origin, 'config', 'uploadpack.allowFilter', 'true']);
      git(['-C', origin, 'config', 'uploadpack.allowAnySHA1InWant', 'true']);
      git(['clone', '--quiet', '--no-local', '--no-checkout', '--filter=blob:none', `file://${origin.replace(/\\/g, '/')}`, clone], { allowLazyFetch: true });

      expect(isPartialClone(clone)).toBe(true);
      expect(isPartialClone(origin)).toBe(false);
      const blobs = [gitText(['-C', origin, 'rev-parse', `${commit}:a.txt`]), gitText(['-C', origin, 'rev-parse', `${commit}:b.txt`])];
      // Listing twice proves the first listing fetched nothing, whatever this git's version.
      expect(blobs.filter((oid) => localObjects(clone).has(oid))).toEqual([]);
      expect(blobs.filter((oid) => localObjects(clone).has(oid))).toEqual([]);
      // The extractor refuses the missing input instead of fetching it (with or without GIT_NO_LAZY_FETCH support).
      const pin = { ...loadUpstream(), commit, inputs: [{ path: 'a.txt', role: 'data' as const, sha256: sha256Hex('first\n') }] };
      expect(() => openPinnedSource(pin, clone, commitDate)).toThrow(InputHashError);
      expect(() => openPinnedSource(pin, clone, commitDate)).toThrow(/a\.txt: blob not available locally/);
      expect(blobs.filter((oid) => localObjects(clone).has(oid))).toEqual([]);
      fetchObjects(clone, blobs);
      expect(blobs.filter((oid) => localObjects(clone).has(oid))).toEqual(blobs);
    }, 60_000);
  });
});

describe('in-process tree hashing (data-F7)', () => {
  it('follows git on text=auto: binary heuristics and CRLF → LF', () => {
    expect(looksBinary(Buffer.from('plain\r\ntext\n'))).toBe(false);
    expect(looksBinary(Buffer.from('nul\0byte'))).toBe(true);
    expect(looksBinary(Buffer.from('lone\rcr'))).toBe(true);
    expect(crlfToLf(Buffer.from('a\r\nb\rc\r\n')).toString('latin1')).toBe('a\nb\rc\n');
    // git hash-object of "hello\n" is well known.
    expect(blobId(Buffer.from('hello\n'))).toBe('ce013625030ba8dba906f756967f9e9ca394464a');
  });

  it('translates gitignore globs', () => {
    expect(globToRegExp('*.log').test('deep/dir/x.log')).toBe(true);
    expect(globToRegExp('public/maps/*').test('public/maps/x')).toBe(true);
    expect(globToRegExp('public/maps/*').test('other/public/maps/x')).toBe(false);
    expect(globToRegExp('**/cache').test('a/b/cache')).toBe(true);
    expect(globToRegExp('a/**/b').test('a/b')).toBe(true);
    expect(globToRegExp('a/**/b').test('a/x/y/b')).toBe(true);
    expect(globToRegExp('logs/**').test('logs/a/b')).toBe(true);
  });

  it.skipIf(!IN_CHECKOUT)('gives the id git records for tools/questiedb in this checkout', () => {
    expect(inProcessTreeId(REPO_ROOT, TOOL_DIR)).toBe(workingTreeId(REPO_ROOT, TOOL_DIR));
  });

  describe('against git on a synthetic repository', () => {
    const root = mkdtempSync(join(tmpdir(), 'questiedb-gittree-'));
    afterAll(() => {
      rmSync(root, { recursive: true, force: true });
    });
    const file = (path: string, content: string | Buffer): void => {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), content);
    };

    it('agrees on attributes, ignore rules (negation, directories, anchoring) and entry order', () => {
      git(['init', '--quiet', root]);
      git(['-C', root, 'config', 'core.autocrlf', 'false']);
      file('.gitattributes', '* text=auto eol=lf\n*.bin binary\nsub/raw.txt -text\n');
      file('.gitignore', '*.log\n!keep.log\nsub/ignored/\n/sub/anchored.txt\n');
      file('sub/.gitignore', 'local-*.txt\n');
      file('sub/crlf.txt', 'one\r\ntwo\r\n');
      file('sub/raw.txt', 'kept\r\nas is\r\n');
      file('sub/lone-cr.txt', 'lone\rcr\r\n');
      file('sub/data.bin', Buffer.from([0x01, 0x0d, 0x0a, 0x00, 0x0d, 0x0a]));
      file('sub/x.log', 'ignored\n');
      file('sub/keep.log', 're-included\n');
      file('sub/ignored/y.txt', 'ignored directory\n');
      file('sub/anchored.txt', 'ignored by an anchored rule\n');
      file('sub/deeper/anchored.txt', 'not anchored here\n');
      file('sub/local-notes.txt', 'ignored by the nested .gitignore\n');
      file('sub/a-b.txt', 'sorts before the a directory\n');
      file('sub/a/inner.ts', 'export {};\n');
      file('sub/a.txt', 'sorts after a/ ("a/" > "a.")\n');
      file('sub/only-ignored/z.log', 'a directory with nothing to commit\n');
      expect(inProcessTreeId(root, 'sub')).toBe(workingTreeId(root, 'sub'));
    });
  });

  it.skipIf(!IN_CHECKOUT)('lists local objects without fetching', () => {
    const objects = localObjects(REPO_ROOT);
    expect(objects.size).toBeGreaterThan(0);
    for (const oid of [...objects].slice(0, 5)) expect(oid).toMatch(/^[0-9a-f]{40}$/);
  });
});
