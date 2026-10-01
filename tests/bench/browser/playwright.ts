/**
 * Playwright for the browser harness (tests/bench/browser/README.md), without making it a
 * dependency of the project: Milestone 9 adds Playwright to package.json; until then the harness
 * loads whichever copy it can find, in this order:
 * 1. `FRL_PLAYWRIGHT`: a path to a `playwright` or `playwright-core` package folder;
 * 2. `playwright`, then `playwright-core`, resolved from this repository (a future dev dependency);
 * 3. the global npm folder (`npm root -g`), where a machine's own Playwright usually lives.
 *
 * The browser is Playwright's own full Chromium for that version in Chrome's headless mode, or
 * `FRL_CHROMIUM` (an executable path) when the installed browsers belong to another Playwright
 * version (`launchOptions`).
 *
 * Only the few calls the harness makes are typed here, so the harness typechecks without
 * Playwright's types.
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

export interface Box {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface Locator {
  click(options?: { readonly timeout?: number; readonly position?: { readonly x: number; readonly y: number } }): Promise<void>;
  selectOption(values: { readonly label?: string; readonly value?: string }, options?: { readonly timeout?: number }): Promise<string[]>;
  setInputFiles(files: string, options?: { readonly timeout?: number }): Promise<void>;
  waitFor(options?: { readonly state?: 'attached' | 'visible' | 'hidden' | 'detached'; readonly timeout?: number }): Promise<void>;
  locator(selector: string): Locator;
  first(): Locator;
  count(): Promise<number>;
  boundingBox(): Promise<Box | null>;
  evaluate<R>(fn: string): Promise<R>;
  focus(): Promise<void>;
}

export interface Mouse {
  move(x: number, y: number, options?: { readonly steps?: number }): Promise<void>;
  down(): Promise<void>;
  up(): Promise<void>;
  click(x: number, y: number): Promise<void>;
}

export interface Keyboard {
  press(key: string): Promise<void>;
}

export interface CdpSession {
  send(method: string, params?: Readonly<Record<string, unknown>>): Promise<unknown>;
  detach(): Promise<void>;
}

export interface Page {
  goto(url: string, options?: { readonly waitUntil?: 'load' | 'domcontentloaded' | 'commit'; readonly timeout?: number }): Promise<unknown>;
  /** The harness passes expression strings only (see probe.ts: no function is serialised). */
  evaluate<R>(expression: string): Promise<R>;
  waitForFunction(expression: string, arg?: unknown, options?: { readonly timeout?: number; readonly polling?: number | 'raf' }): Promise<unknown>;
  waitForTimeout(ms: number): Promise<void>;
  locator(selector: string): Locator;
  getByRole(role: string, options?: { readonly name?: string | RegExp; readonly exact?: boolean }): Locator;
  screenshot(options: { readonly path: string }): Promise<unknown>;
  on(event: 'pageerror', handler: (error: Error) => void): void;
  on(event: 'console', handler: (message: { type(): string; text(): string }) => void): void;
  readonly mouse: Mouse;
  readonly keyboard: Keyboard;
}

export interface BrowserContext {
  addInitScript(script: { readonly content: string }): Promise<void>;
  newPage(): Promise<Page>;
  newCDPSession(page: Page): Promise<CdpSession>;
  close(): Promise<void>;
}

export interface Browser {
  newContext(options: { readonly viewport: { readonly width: number; readonly height: number }; readonly deviceScaleFactor: number }): Promise<BrowserContext>;
  version(): string;
  close(): Promise<void>;
}

export interface LaunchOptions {
  readonly headless: boolean;
  readonly channel?: string;
  readonly executablePath?: string;
  readonly args?: readonly string[];
}

export interface BrowserType {
  launch(options: LaunchOptions): Promise<Browser>;
}

export interface LoadedPlaywright {
  readonly chromium: BrowserType;
  /** Where it was loaded from, and its version (recorded with the results). */
  readonly from: string;
  readonly version: string;
}

function tryLoad(path: string): LoadedPlaywright | null {
  try {
    const require = createRequire(import.meta.url);
    const loaded = require(path) as { chromium?: BrowserType };
    if (loaded.chromium === undefined) return null;
    let version = 'unknown';
    try {
      version = (require(join(require.resolve(path).replace(/[\\/]index\.js$/, ''), 'package.json')) as { version?: string }).version ?? 'unknown';
    } catch {
      // The version is a record, not a requirement.
    }
    return { chromium: loaded.chromium, from: path, version };
  } catch {
    return null;
  }
}

function globalNpmRoot(): string | null {
  try {
    return execFileSync('npm', ['root', '-g'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
}

/** Playwright, from the first place that has it (see the file comment); throws with what was tried. */
export function loadPlaywright(): LoadedPlaywright {
  const tried: string[] = [];
  const explicit = process.env['FRL_PLAYWRIGHT'];
  const candidates: string[] = [];
  if (explicit !== undefined && explicit !== '') candidates.push(explicit);
  candidates.push('playwright', 'playwright-core');
  const root = globalNpmRoot();
  if (root !== null) {
    for (const name of ['playwright', 'playwright-core']) {
      const path = join(root, name);
      if (existsSync(path)) candidates.push(path);
    }
  }
  for (const candidate of candidates) {
    tried.push(candidate);
    const loaded = tryLoad(candidate);
    if (loaded !== null) return loaded;
  }
  throw new Error(`Playwright was not found (tried ${tried.join(', ')}); set FRL_PLAYWRIGHT to a playwright package folder`);
}

/**
 * How to launch Chromium: `FRL_CHROMIUM` (an executable) when set, else Playwright's own full
 * Chromium for its version (`channel: 'chromium'`), both in Chrome's own headless mode, as the
 * earlier measurements ran ("headless=new"); not Playwright's default, the separate headless shell.
 */
export function launchOptions(): LaunchOptions {
  const explicit = process.env['FRL_CHROMIUM'];
  return explicit === undefined || explicit === '' ? { headless: true, channel: 'chromium' } : { headless: true, executablePath: explicit };
}
