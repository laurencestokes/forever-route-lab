/**
 * Serves the repository's gitignored `local-maps/` folder at `<base>local-maps/` in `vite` (dev)
 * and `vite preview`, and nowhere else (docs/MAPS.md §5.7; ARCHITECTURE §7.3, §16; D-018, D-025).
 *
 * - Middleware is registered only through `configureServer` and `configurePreviewServer`. The
 *   plugin has no build hooks (no `resolveId`, `load`, `transform`, `generateBundle`, `writeBundle`
 *   or copy step), so `vite build` never emits the folder; `tools/build/audit-dist.ts` fails a
 *   build that contains it anyway.
 * - The folder must lie outside `publicDir` (Vite copies everything there into `dist/`), and
 *   outside the build's `outDir`; `configResolved` refuses the configuration otherwise, in every
 *   command.
 * - Each request is resolved inside the folder: `.` and `..` segments, hidden names, backslashes,
 *   colons, NUL and undecodable escapes are refused (403, 400), and so is anything a link resolves
 *   to outside the folder. Only regular files are served; anything missing, a folder included,
 *   answers 404 here instead of falling through to the SPA's `index.html` (which the app would
 *   also treat as "no local set", but a 404 says so plainly).
 * - Responses carry the file's content type (JSON, WebP, PNG, text), `Cache-Control: no-store`
 *   (a re-activated set is picked up on reload) and `X-Content-Type-Options: nosniff`.
 */
import { createReadStream } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { isAbsolute, relative, resolve } from 'node:path';
import type { Plugin, ResolvedConfig } from 'vite';

export const LOCAL_MAPS_DIR = 'local-maps';
export const PLUGIN_NAME = 'forever-route-lab:local-maps';

/** Content types by extension; anything else is sent as bytes. */
export const CONTENT_TYPES: Readonly<Record<string, string>> = {
  '.json': 'application/json; charset=utf-8',
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
};
const DEFAULT_CONTENT_TYPE = 'application/octet-stream';

export interface LocalMapsOptions {
  /** The folder to serve; relative paths resolve against Vite's `root`. Default `local-maps`. */
  readonly dir?: string | undefined;
}

export type Next = (error?: unknown) => void;
export type LocalMapsMiddleware = (req: IncomingMessage, res: ServerResponse, next: Next) => void;

/** `base` as a URL path prefix ending in `/`: a relative base (`./`, ``) serves at `/`, as Vite does. */
export function basePrefix(base: string): string {
  if (base === '' || base.startsWith('.')) return '/';
  const withLead = base.startsWith('/') ? base : `/${base}`;
  return withLead.endsWith('/') ? withLead : `${withLead}/`;
}

/** True when `child` is `parent` or lies inside it. */
function isInside(parent: string, child: string): boolean {
  const rel = relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

function contentTypeOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return (dot > 0 ? CONTENT_TYPES[name.slice(dot).toLowerCase()] : undefined) ?? DEFAULT_CONTENT_TYPE;
}

function refuse(res: ServerResponse, status: number, message: string, extra: Readonly<Record<string, string>> = {}): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  for (const [name, value] of Object.entries(extra)) res.setHeader(name, value);
  res.end(`${message}\n`);
}

/** A path segment that may name a file inside the folder. */
const SAFE_SEGMENT = /^[^./\\:\0][^/\\:\0]*$/;

/**
 * The request handler: answers `GET`/`HEAD <base>local-maps/<path>` from `dir`, and passes every
 * other URL on. Exported for tests; the plugin installs it.
 */
export function createLocalMapsMiddleware(options: { readonly dir: string; readonly base: string }): LocalMapsMiddleware {
  const root = resolve(options.dir);
  const prefix = `${basePrefix(options.base)}${LOCAL_MAPS_DIR}/`;

  const serve = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const pathname = (req.url ?? '').replace(/[?#].*$/s, '');
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      refuse(res, 405, 'local-maps: only GET and HEAD', { Allow: 'GET, HEAD' });
      return;
    }
    let decoded: string;
    try {
      decoded = decodeURIComponent(pathname.slice(prefix.length));
    } catch {
      refuse(res, 400, 'local-maps: malformed URL escape');
      return;
    }
    const segments = decoded.split('/');
    if (decoded === '' || segments.some((segment) => segment === '')) {
      refuse(res, 404, 'local-maps: not found');
      return;
    }
    if (!segments.every((segment) => SAFE_SEGMENT.test(segment))) {
      refuse(res, 403, 'local-maps: path refused');
      return;
    }
    const target = resolve(root, ...segments);
    if (!isInside(root, target)) {
      refuse(res, 403, 'local-maps: path refused');
      return;
    }
    let real: string;
    let realRoot: string;
    try {
      [realRoot, real] = await Promise.all([realpath(root), realpath(target)]);
    } catch {
      refuse(res, 404, 'local-maps: not found');
      return;
    }
    // A link inside the folder may point anywhere: serve only what really lies inside it.
    if (!isInside(realRoot, real)) {
      refuse(res, 403, 'local-maps: path refused');
      return;
    }
    const info = await stat(real);
    if (!info.isFile()) {
      refuse(res, 404, 'local-maps: not found');
      return;
    }
    res.statusCode = 200;
    res.setHeader('Content-Type', contentTypeOf(real));
    res.setHeader('Content-Length', String(info.size));
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    await new Promise<void>((done, failed) => {
      const stream = createReadStream(real);
      stream.on('error', failed);
      res.on('finish', () => {
        done();
      });
      res.on('close', () => {
        stream.destroy();
        done();
      });
      stream.pipe(res);
    });
  };

  return (req, res, next) => {
    const pathname = (req.url ?? '').replace(/[?#].*$/s, '');
    if (pathname === prefix.slice(0, -1)) {
      refuse(res, 404, 'local-maps: not found');
      return;
    }
    if (!pathname.startsWith(prefix)) {
      next();
      return;
    }
    serve(req, res).catch((error: unknown) => {
      if (res.headersSent) res.destroy(error instanceof Error ? error : undefined);
      else next(error);
    });
  };
}

/** The folder the plugin serves for a resolved configuration. */
export function localMapsDir(config: Pick<ResolvedConfig, 'root'>, options: LocalMapsOptions = {}): string {
  return resolve(config.root, options.dir ?? LOCAL_MAPS_DIR);
}

/**
 * Why a configuration could publish the folder, or null. `publicDir` is copied into `dist/`
 * verbatim; a folder inside `outDir` would be written by the build itself.
 */
export function publicationProblem(dir: string, config: Pick<ResolvedConfig, 'root' | 'publicDir' | 'build'>): string | null {
  const publicDir = config.publicDir === '' ? null : resolve(config.root, config.publicDir);
  if (publicDir !== null && (isInside(publicDir, dir) || isInside(dir, publicDir))) {
    return `${dir} overlaps publicDir ${publicDir}: Vite would copy local map sets into the build (D-018)`;
  }
  const outDir = resolve(config.root, config.build.outDir);
  if (isInside(outDir, dir) || isInside(dir, outDir)) return `${dir} overlaps the build's outDir ${outDir} (D-018)`;
  return null;
}

/** The Vite plugin (vite.config.ts). */
export function localMaps(options: LocalMapsOptions = {}): Plugin {
  return {
    name: PLUGIN_NAME,
    configResolved(config) {
      const problem = publicationProblem(localMapsDir(config, options), config);
      if (problem !== null) throw new Error(`${PLUGIN_NAME}: ${problem}`);
    },
    configureServer(server) {
      server.middlewares.use(createLocalMapsMiddleware({ dir: localMapsDir(server.config, options), base: server.config.base }));
    },
    configurePreviewServer(server) {
      server.middlewares.use(createLocalMapsMiddleware({ dir: localMapsDir(server.config, options), base: server.config.base }));
    },
  };
}
