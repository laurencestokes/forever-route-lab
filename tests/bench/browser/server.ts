/**
 * Builds and serves the builds the browser harness measures (tests/bench/browser/README.md):
 * `pnpm build` in a tree (the production build with its licence gate, notices and dist audit), a
 * copy of its `dist/` kept beside the results (so another build in that tree cannot change what is
 * being measured), and `vite preview` of that copy on a free port, with the tree's own Vite and
 * config (text gzip-compressed, as GitHub Pages sends it).
 */
import { type ChildProcess, execFileSync, spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { join, resolve } from 'node:path';

/** A free TCP port on 127.0.0.1 (the OS picks it). */
export function freePort(): Promise<number> {
  return new Promise((done, fail) => {
    const server = createServer();
    server.once('error', fail);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address !== null ? address.port : 0;
      server.close(() => {
        done(port);
      });
    });
  });
}

export interface TreeInfo {
  readonly dir: string;
  readonly head: string;
  /** `git status --porcelain` lines (the working tree's changes over HEAD). */
  readonly changes: readonly string[];
  /** SHA-256 of `git diff HEAD` plus the untracked files' names and bytes: equal hashes, equal sources. */
  readonly changesSha256: string;
}

function git(dir: string, args: readonly string[]): string {
  return execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
}

/** What the tree is: its commit and any changes over it. */
export function treeInfo(dir: string): TreeInfo {
  const head = git(dir, ['rev-parse', 'HEAD']).trim();
  const changes = git(dir, ['status', '--porcelain']).split('\n').filter((line) => line !== '');
  const hash = createHash('sha256');
  hash.update(git(dir, ['diff', 'HEAD', '--binary']));
  for (const file of git(dir, ['ls-files', '--others', '--exclude-standard', '-z']).split('\0').filter((name) => name !== '').sort()) {
    hash.update(`\0${file}\0`);
    const path = join(dir, file);
    if (existsSync(path)) hash.update(readFileSync(path));
  }
  return { dir, head, changes, changesSha256: hash.digest('hex') };
}

export interface BuildRecord {
  readonly label: string;
  readonly tree: TreeInfo;
  /** The entry chunk and its static imports, gzip kB, as the dist audit prints it; null when not found. */
  readonly entryGzipKb: number | null;
  readonly buildOk: boolean;
  readonly logFile: string;
  /** The copy of dist/ that is served. */
  readonly distDir: string;
}

/** The entry total the dist audit prints ("Entry "index.html" + static imports … total … gzip 247.50 kB"). */
export function entryGzipKbOf(log: string): number | null {
  const at = log.indexOf('Entry "index.html"');
  if (at < 0) return null;
  const match = /total\s+gzip\s+([\d.]+)\s+kB/.exec(log.slice(at));
  return match?.[1] === undefined ? null : Number(match[1]);
}

/**
 * `pnpm build` in `dir` (unless `build` is false: then its existing dist/ is used), then a copy of
 * dist/ into `outDir/builds/<label>`. A build whose audit fails still has its dist/ (vite built it
 * first); `buildOk` says so.
 */
export function buildAndSnapshot(label: string, dir: string, outDir: string, build: boolean): BuildRecord {
  const tree = treeInfo(dir);
  const logFile = join(outDir, `build-${label}.log`);
  mkdirSync(outDir, { recursive: true });
  let log = '';
  let buildOk = true;
  if (build) {
    const result = spawnSync('pnpm', ['build'], { cwd: dir, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    log = `${result.stdout}\n${result.stderr}`;
    buildOk = result.status === 0;
    writeFileSync(logFile, log);
  }
  const source = join(dir, 'dist');
  if (!existsSync(join(source, 'index.html'))) throw new Error(`${label}: ${source} has no index.html (build failed?) — see ${logFile}`);
  const distDir = join(outDir, 'builds', label);
  rmSync(distDir, { recursive: true, force: true });
  cpSync(source, distDir, { recursive: true });
  return { label, tree, entryGzipKb: entryGzipKbOf(log), buildOk, logFile, distDir };
}

export interface Served {
  readonly url: string;
  readonly port: number;
  stop(): Promise<void>;
}

async function answers(url: string): Promise<boolean> {
  try {
    const response = await fetch(url);
    return response.ok;
  } catch {
    return false;
  }
}

/** `vite preview` of `distDir` with the Vite and config of `treeDir`, on a free port of 127.0.0.1. */
export async function servePreview(treeDir: string, distDir: string): Promise<Served> {
  const port = await freePort();
  const vite = join(treeDir, 'node_modules', '.bin', 'vite');
  if (!existsSync(vite)) throw new Error(`${treeDir} has no node_modules/.bin/vite (run pnpm install --frozen-lockfile there)`);
  const child: ChildProcess = spawn(vite, ['preview', '--outDir', resolve(distDir), '--port', String(port), '--strictPort', '--host', '127.0.0.1'], {
    cwd: treeDir,
    stdio: ['ignore', 'ignore', 'pipe'],
    env: { ...process.env, VITE_CONFIG_NATIVE_IGNORE_WARNING: 'true' },
  });
  let stderr = '';
  child.stderr?.on('data', (chunk: Buffer) => {
    stderr += chunk.toString('utf8');
  });
  const url = `http://127.0.0.1:${String(port)}/`;
  const deadline = Date.now() + 30_000;
  while (!(await answers(url))) {
    if (child.exitCode !== null) throw new Error(`vite preview exited (${String(child.exitCode)}): ${stderr}`);
    if (Date.now() > deadline) {
      child.kill();
      throw new Error(`vite preview did not answer on ${url}: ${stderr}`);
    }
    await new Promise((done) => setTimeout(done, 100));
  }
  return {
    url,
    port,
    stop: () =>
      new Promise<void>((done) => {
        if (child.exitCode !== null) {
          done();
          return;
        }
        child.once('exit', () => {
          done();
        });
        child.kill();
      }),
  };
}
