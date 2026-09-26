import { mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { request, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { Writable } from 'node:stream';
import { build, createServer, preview, type Plugin } from 'vite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { pngImage, webpImage } from '../../src/infra/maps/test-images';
import { checkFileContent, checkForbiddenPaths, checkImages } from '../build/lib/audit';
import { listFiles, REPO_ROOT } from '../build/lib/fs';
import { basePrefix, createLocalMapsMiddleware, localMaps, PLUGIN_NAME, publicationProblem } from './vite-local-maps';
import { tempDir, writeFile } from './lib/test-support';

/*
 * The local-maps plugin (docs/MAPS.md §5.7): unit tests of the request handler over a temporary
 * folder, then a real dev server, a real build and a real preview of a throwaway project. The
 * images are generated (src/infra/maps/test-images.ts); no real map art is involved (D-018).
 */

const MANIFEST = '{ "schema": 1, "redistribution": "local-only" }\n';
const PNG = pngImage(6, 4);
const WEBP = webpImage(4, 4);

let dir = '';
let dispose = (): void => undefined;
beforeEach(() => {
  ({ dir, dispose } = tempDir('frl-vite-local-maps-'));
});
afterEach(() => dispose());

/** A local-maps folder with a manifest, two images and a file outside it. */
function writeLocalSet(root: string): void {
  writeFile(root, 'local-maps/maps.manifest.json', MANIFEST);
  writeFile(root, 'local-maps/art/1411.png', PNG);
  writeFile(root, 'local-maps/art/9999.webp', WEBP);
  writeFile(root, 'local-maps/.hidden.json', '{}');
  writeFile(root, 'secret.txt', 'outside the folder');
}

interface Answer {
  readonly status: number;
  readonly headers: Readonly<Record<string, string | number | readonly string[] | undefined>>;
  readonly body: Buffer;
  readonly passed: boolean;
}

/** Runs the middleware on a fake request (`url` is sent as is: no client-side normalisation). */
function call(url: string, method = 'GET', base = '/'): Promise<Answer> {
  const middleware = createLocalMapsMiddleware({ dir: join(dir, 'local-maps'), base });
  return new Promise((done, failed) => {
    const chunks: Buffer[] = [];
    const headers: Record<string, string | number | readonly string[] | undefined> = {};
    const res = new Writable({
      write(chunk: Buffer, _encoding, callback) {
        chunks.push(Buffer.from(chunk));
        callback();
      },
    }) as unknown as ServerResponse & Writable;
    Object.assign(res, {
      statusCode: 200,
      headersSent: false,
      setHeader(name: string, value: string | number | readonly string[]) {
        headers[name.toLowerCase()] = value;
        return res;
      },
    });
    const finish = () => {
      done({ status: res.statusCode, headers, body: Buffer.concat(chunks), passed: false });
    };
    res.on('finish', finish);
    const originalEnd = res.end.bind(res);
    res.end = ((chunk?: unknown) => {
      if (typeof chunk === 'string' || chunk instanceof Uint8Array) chunks.push(Buffer.from(chunk));
      return originalEnd();
    }) as typeof res.end;
    const req = { url, method } as IncomingMessage;
    middleware(req, res, (error?: unknown) => {
      if (error !== undefined) failed(error instanceof Error ? error : new Error('the middleware passed an error on', { cause: error }));
      else done({ status: 0, headers, body: Buffer.alloc(0), passed: true });
    });
  });
}

describe('the request handler', () => {
  it('serves files with their content type, no-store and nosniff, and only under <base>local-maps/', async () => {
    writeLocalSet(dir);
    const manifest = await call('/local-maps/maps.manifest.json');
    expect([manifest.status, manifest.headers['content-type'], manifest.body.toString('utf8')]).toEqual([200, 'application/json; charset=utf-8', MANIFEST]);
    expect(manifest.headers['cache-control']).toBe('no-store');
    expect(manifest.headers['x-content-type-options']).toBe('nosniff');
    expect(manifest.headers['content-length']).toBe(String(Buffer.byteLength(MANIFEST)));
    const png = await call('/local-maps/art/1411.png?v=2');
    expect([png.status, png.headers['content-type']]).toEqual([200, 'image/png']);
    expect(new Uint8Array(png.body)).toEqual(PNG);
    const webp = await call('/local-maps/art/9999.webp');
    expect([webp.status, webp.headers['content-type']]).toEqual([200, 'image/webp']);
    expect((await call('/index.html')).passed).toBe(true);
    expect((await call('/data/local-maps/maps.manifest.json')).passed).toBe(true);
    // Another base: only its prefix is served.
    expect((await call('/forever/local-maps/maps.manifest.json', 'GET', '/forever/')).status).toBe(200);
    expect((await call('/local-maps/maps.manifest.json', 'GET', '/forever/')).passed).toBe(true);
    expect((await call('/local-maps/maps.manifest.json', 'GET', './')).status).toBe(200);
  });

  it('answers 404 for missing files, folders and a missing local-maps folder, never the SPA page', async () => {
    writeLocalSet(dir);
    for (const url of ['/local-maps/nothing.json', '/local-maps/art', '/local-maps/art/', '/local-maps/', '/local-maps', '/local-maps/art//1411.png']) {
      const answer = await call(url);
      expect([url, answer.status, answer.passed]).toEqual([url, 404, false]);
    }
    dispose();
    ({ dir, dispose } = tempDir('frl-vite-local-maps-empty-'));
    expect((await call('/local-maps/maps.manifest.json')).status).toBe(404);
  });

  it('refuses traversal, hidden names, backslashes, colons, NUL and bad escapes', async () => {
    writeLocalSet(dir);
    const refused = [
      '/local-maps/../secret.txt',
      '/local-maps/art/../../secret.txt',
      '/local-maps/%2e%2e/secret.txt',
      '/local-maps/..%2fsecret.txt',
      '/local-maps/%2E%2E%2Fsecret.txt',
      '/local-maps/..%5csecret.txt',
      '/local-maps/art%5c..%5c..%5csecret.txt',
      '/local-maps/.hidden.json',
      '/local-maps/./maps.manifest.json',
      '/local-maps/C:%5cWindows%5cwin.ini',
      '/local-maps/maps.manifest.json%00.png',
    ];
    for (const url of refused) {
      const answer = await call(url);
      expect([url, answer.status]).toEqual([url, 403]);
      expect(answer.body.toString('utf8')).not.toContain('outside the folder');
    }
    expect((await call('/local-maps/%E0%A4%A')).status).toBe(400);
  });

  it('refuses a link that leads out of the folder', async () => {
    writeLocalSet(dir);
    mkdirSync(join(dir, 'outside'));
    writeFileSync(join(dir, 'outside', 'x.json'), '{"leak":true}');
    try {
      symlinkSync(join(dir, 'outside'), join(dir, 'local-maps', 'linked'), 'junction');
    } catch {
      return; // no link support on this machine
    }
    const answer = await call('/local-maps/linked/x.json');
    expect(answer.status).toBe(403);
    expect(answer.body.toString('utf8')).not.toContain('leak');
  });

  it('answers HEAD without a body and refuses other methods', async () => {
    writeLocalSet(dir);
    const head = await call('/local-maps/art/1411.png', 'HEAD');
    expect([head.status, head.headers['content-length'], head.body.length]).toEqual([200, String(PNG.length), 0]);
    const post = await call('/local-maps/maps.manifest.json', 'POST');
    expect([post.status, post.headers['allow']]).toEqual([405, 'GET, HEAD']);
  });

  it('treats a relative base as the server root, as Vite does', () => {
    expect([basePrefix('./'), basePrefix(''), basePrefix('/'), basePrefix('/forever'), basePrefix('/forever/')]).toEqual(['/', '/', '/', '/forever/', '/forever/']);
  });
});

describe('the plugin', () => {
  it('has only config and server hooks: nothing that could emit files in a build', () => {
    const plugin = localMaps();
    expect(plugin.name).toBe(PLUGIN_NAME);
    expect(Object.keys(plugin).sort()).toEqual(['configResolved', 'configurePreviewServer', 'configureServer', 'name']);
  });

  it('refuses a folder inside publicDir or the build output, in every command', () => {
    const config = (publicDir: string, outDir = 'dist') => ({ root: dir, publicDir, build: { outDir } }) as Parameters<typeof publicationProblem>[1];
    expect(publicationProblem(join(dir, 'local-maps'), config(join(dir, 'public')))).toBeNull();
    expect(publicationProblem(join(dir, 'public', 'local-maps'), config(join(dir, 'public')))).toMatch(/overlaps publicDir .*D-018/);
    expect(publicationProblem(join(dir, 'local-maps'), config(dir))).toMatch(/overlaps publicDir/);
    expect(publicationProblem(join(dir, 'dist', 'local-maps'), config(''))).toMatch(/overlaps the build's outDir/);
    expect(publicationProblem(join(dir, 'local-maps'), config(''))).toBeNull();
  });

  it('is wired into the repository vite.config.ts, which keeps publicDir at public/', async () => {
    const { default: config } = (await import('../../vite.config')) as { default: { plugins?: unknown[]; publicDir?: unknown } };
    const names = (config.plugins ?? []).flat(3).map((p) => (p as Plugin | null)?.name);
    expect(names).toContain(PLUGIN_NAME);
    expect(config.publicDir).toBeUndefined();
    expect(publicationProblem(join(REPO_ROOT, 'local-maps'), { root: REPO_ROOT, publicDir: join(REPO_ROOT, 'public'), build: { outDir: 'dist' } } as Parameters<typeof publicationProblem>[1])).toBeNull();
  });
});

/** A throwaway Vite project: an index page, a module, a public/ file and a local set. */
function writeProject(root: string): void {
  writeFile(root, 'index.html', '<!doctype html><html><body><script type="module" src="/main.js"></script></body></html>\n');
  writeFile(root, 'main.js', 'document.body.dataset.ready = "yes";\n');
  writeFile(root, 'public/robots.txt', 'User-agent: *\n');
  writeLocalSet(root);
}

const quiet = { configFile: false, logLevel: 'silent', clearScreen: false } as const;

/** GET over real HTTP, with the path sent exactly as written. */
function get(port: number, path: string): Promise<{ status: number; type: string | undefined; body: Buffer }> {
  return new Promise((done, failed) => {
    const req = request({ host: '127.0.0.1', port, path, method: 'GET' }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => {
        done({ status: res.statusCode ?? 0, type: res.headers['content-type'], body: Buffer.concat(chunks) });
      });
    });
    req.on('error', failed);
    req.end();
  });
}

describe('dev, build and preview', () => {
  it('the dev server serves local-maps/ and answers 404 (not the SPA page) for what is missing', async () => {
    writeProject(dir);
    const server = await createServer({ ...quiet, root: dir, base: './', plugins: [localMaps()], server: { host: '127.0.0.1', port: 0, strictPort: false, ws: false }, optimizeDeps: { noDiscovery: true, include: [] } });
    try {
      await server.listen();
      const { port } = server.httpServer?.address() as AddressInfo;
      const manifest = await get(port, '/local-maps/maps.manifest.json');
      expect([manifest.status, manifest.type, manifest.body.toString('utf8')]).toEqual([200, 'application/json; charset=utf-8', MANIFEST]);
      const png = await get(port, '/local-maps/art/1411.png');
      expect([png.status, png.type]).toEqual([200, 'image/png']);
      expect(new Uint8Array(png.body)).toEqual(PNG);
      const missing = await get(port, '/local-maps/art/1412.png');
      expect(missing.status).toBe(404);
      expect(missing.body.toString('utf8')).not.toContain('<!doctype html>');
      expect((await get(port, '/local-maps/../secret.txt')).status).toBe(403);
    } finally {
      await server.close();
    }
  }, 60_000);

  it('vite build emits no local-maps file, and the dist audit fails a dist that has one', async () => {
    writeProject(dir);
    const outDir = join(dir, 'dist');
    await build({ ...quiet, root: dir, base: './', plugins: [localMaps()], build: { outDir, emptyOutDir: true } });
    const files = listFiles(outDir);
    expect(files).toContain('index.html');
    expect(files).toContain('robots.txt');
    expect(files.some((file) => file.split('/').includes('local-maps'))).toBe(false);
    const localBytes = [readFileSync(join(dir, 'local-maps', 'maps.manifest.json')), Buffer.from(PNG), Buffer.from(WEBP)];
    for (const file of files) {
      const bytes = readFileSync(join(outDir, file));
      expect(localBytes.some((local) => bytes.equals(local))).toBe(false);
      expect(checkFileContent(file, bytes)).toEqual([]);
    }
    expect(checkForbiddenPaths(files)).toEqual([]);

    // Confirm the audit's map rules: a dist that did contain the set, or a copy of it, fails.
    const leaked = [...files, 'local-maps/maps.manifest.json', 'local-maps/art/1411.png', 'maps/maps.manifest.json', 'maps/art/1411.webp'];
    expect(checkForbiddenPaths(leaked).map((v) => `${v.rule} ${v.path ?? ''}`)).toEqual([
      'local-maps local-maps/maps.manifest.json',
      'local-maps local-maps/maps.manifest.json',
      'local-maps local-maps/art/1411.png',
      'local-maps maps/maps.manifest.json',
    ]);
    expect(checkImages(leaked, []).map((v) => v.path)).toEqual(['local-maps/art/1411.png', 'maps/art/1411.webp']);
    expect(checkFileContent('assets/copied.json', Buffer.from(MANIFEST)).map((v) => v.rule)).toEqual(['local-maps']);
  }, 60_000);

  it('vite preview serves local-maps/ from the folder while the built dist has none', async () => {
    writeProject(dir);
    const outDir = join(dir, 'dist');
    await build({ ...quiet, root: dir, base: './', plugins: [localMaps()], build: { outDir, emptyOutDir: true } });
    const server = await preview({ ...quiet, root: dir, base: './', plugins: [localMaps()], build: { outDir }, preview: { host: '127.0.0.1', port: 0, strictPort: false } });
    try {
      const { port } = server.httpServer.address() as AddressInfo;
      const webp = await get(port, '/local-maps/art/9999.webp');
      expect([webp.status, webp.type]).toEqual([200, 'image/webp']);
      expect(new Uint8Array(webp.body)).toEqual(WEBP);
      expect((await get(port, '/local-maps/nothing.json')).status).toBe(404);
      expect((await get(port, '/index.html')).status).toBe(200);
      expect(listFiles(outDir).some((file) => file.includes('local-maps'))).toBe(false);
    } finally {
      await server.close();
    }
  }, 60_000);
});
