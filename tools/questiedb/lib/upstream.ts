import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gitCapabilities, hasCommit, isPartialClone, listTree, localObjects, readBlobs, sha256Hex, type TreeEntry } from './git';

/** Repository root, resolved from this file's location (tools/questiedb/lib/). */
export const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
export const TOOL_DIR = 'tools/questiedb';
export const UPSTREAM_JSON = join(REPO_ROOT, TOOL_DIR, 'upstream.json');
export const PUBLIC_DATA_DIR = join(REPO_ROOT, 'public', 'data');
export const FIXTURE_DATA_DIR = join(REPO_ROOT, 'tests', 'fixtures', 'data');
export const REPORT_PATH = join(REPO_ROOT, 'generated', 'questiedb-report.json');

/**
 * `semantics`: an upstream file whose behaviour or content the tool transcribes by hand into
 * TypeScript and otherwise does not read (lib/semantics.ts; review finding data-F2).
 */
export type InputRole = 'data' | 'correction' | 'schema' | 'support' | 'semantics' | 'provenance-only';
const ROLES: readonly InputRole[] = ['data', 'correction', 'schema', 'support', 'semantics', 'provenance-only'];

export interface UpstreamInput {
  readonly path: string;
  readonly role: InputRole;
  readonly sha256: string;
}

export interface EntityCounts {
  readonly quests: number;
  readonly npcs: number;
  readonly objects: number;
  readonly items: number;
}

/**
 * The licence check repeated at every pin bump (DATA_PROVENANCE §3.1 item 3, §12 step 2), kept next
 * to the pin so NOTICE.md and the manifest are rendered from it rather than from dates in code
 * (review finding data-F9).
 */
export interface LicenceCheck {
  /** The day the check was run, `YYYY-MM-DD`. */
  readonly date: string;
  /** What was checked and how, as the notice states it. */
  readonly method: string;
  /** The finding, as the notice and the manifest state it. */
  readonly result: string;
  /** Anything a reader needs to read the finding correctly (optional). */
  readonly note: string | null;
  /** An upstream licence file, if one existed; null at this pin. */
  readonly upstreamLicenceFile: null;
  /** Where the full record is, e.g. `docs/DATA_PROVENANCE.md §3.1`. */
  readonly evidence: string;
}

export interface UpstreamPin {
  readonly repository: string;
  /** `owner/name`, as written in `_generated.upstream`. */
  readonly repositoryName: string;
  readonly branchObserved: string;
  readonly commit: string;
  readonly flavour: string;
  /** Repository-relative clone directory. Never written into any output. */
  readonly cachePath: string;
  readonly inputs: readonly UpstreamInput[];
  readonly licenceCheck: LicenceCheck;
  readonly golden: {
    readonly raw: EntityCounts;
    readonly composed: EntityCounts;
    /** Shipped record counts recorded at this pin, or null before the first extraction. */
    readonly shipped: ShippedCounts | null;
  };
}

export interface ShippedCounts extends EntityCounts {
  readonly spawnEntities: { readonly npc: number; readonly object: number };
}

const HEX40 = /^[0-9a-f]{40}$/;
const HEX64 = /^[0-9a-f]{64}$/;

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function str(record: Readonly<Record<string, unknown>>, key: string): string {
  const value = record[key];
  if (typeof value !== 'string' || value === '') throw new Error(`upstream.json: "${key}" must be a non-empty string`);
  return value;
}

function counts(value: unknown, where: string): EntityCounts {
  if (!isRecord(value)) throw new Error(`upstream.json: ${where} must be an object`);
  const out: Record<string, number> = {};
  for (const key of ['quests', 'npcs', 'objects', 'items']) {
    const n = value[key];
    if (typeof n !== 'number' || !Number.isInteger(n) || n < 0) throw new Error(`upstream.json: ${where}.${key} must be a count`);
    out[key] = n;
  }
  return out as unknown as EntityCounts;
}

function licenceCheck(value: unknown): LicenceCheck {
  if (!isRecord(value)) throw new Error('upstream.json: "licenceCheck" must be an object');
  const date = str(value, 'date');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('upstream.json: licenceCheck.date must be YYYY-MM-DD');
  if (value.upstreamLicenceFile !== null) throw new Error('upstream.json: licenceCheck.upstreamLicenceFile must be null (a licence file upstream is a DATA_PROVENANCE §3.2 change trigger)');
  const note = value.note;
  if (note !== undefined && note !== null && (typeof note !== 'string' || note === '')) throw new Error('upstream.json: licenceCheck.note must be a non-empty string or null');
  return { date, method: str(value, 'method'), result: str(value, 'result'), note: typeof note === 'string' ? note : null, upstreamLicenceFile: null, evidence: str(value, 'evidence') };
}

export function parseUpstream(value: unknown): UpstreamPin {
  if (!isRecord(value)) throw new Error('upstream.json: expected an object');
  const commit = str(value, 'commit');
  if (!HEX40.test(commit)) throw new Error('upstream.json: "commit" must be a full 40-character SHA');
  const cachePath = str(value, 'cachePath');
  if (isAbsolute(cachePath) || cachePath.split(/[\\/]/).includes('..')) throw new Error('upstream.json: "cachePath" must be repository-relative');
  if (!Array.isArray(value.inputs)) throw new Error('upstream.json: "inputs" must be an array');
  const seen = new Set<string>();
  const inputs = (value.inputs as readonly unknown[]).map((entry, index): UpstreamInput => {
    if (!isRecord(entry)) throw new Error(`upstream.json: inputs[${String(index)}] must be an object`);
    const path = str(entry, 'path');
    const role = entry.role;
    const sha256 = str(entry, 'sha256');
    if (typeof role !== 'string' || !ROLES.includes(role as InputRole)) throw new Error(`upstream.json: inputs[${String(index)}].role is invalid`);
    if (!HEX64.test(sha256)) throw new Error(`upstream.json: inputs[${String(index)}].sha256 must be 64 lowercase hex`);
    if (seen.has(path)) throw new Error(`upstream.json: input ${path} is listed twice`);
    seen.add(path);
    return { path, role: role as InputRole, sha256 };
  });
  const golden = value.golden;
  if (!isRecord(golden)) throw new Error('upstream.json: "golden" must be an object');
  let shipped: ShippedCounts | null = null;
  if (golden.shipped !== null) {
    const base = counts(golden.shipped, 'golden.shipped');
    const spawns = isRecord(golden.shipped) ? golden.shipped.spawnEntities : undefined;
    if (!isRecord(spawns) || typeof spawns.npc !== 'number' || typeof spawns.object !== 'number') {
      throw new Error('upstream.json: golden.shipped.spawnEntities must be { npc, object }');
    }
    shipped = { ...base, spawnEntities: { npc: spawns.npc, object: spawns.object } };
  }
  return {
    repository: str(value, 'repository'),
    repositoryName: str(value, 'repositoryName'),
    branchObserved: str(value, 'branchObserved'),
    commit,
    flavour: str(value, 'flavour'),
    cachePath,
    inputs,
    licenceCheck: licenceCheck(value.licenceCheck),
    golden: { raw: counts(golden.raw, 'golden.raw'), composed: counts(golden.composed, 'golden.composed'), shipped },
  };
}

export function loadUpstream(path = UPSTREAM_JSON): UpstreamPin {
  return parseUpstream(JSON.parse(readFileSync(path, 'utf8')) as unknown);
}

export const cacheDir = (pin: UpstreamPin, repoRoot = REPO_ROOT): string => resolve(repoRoot, pin.cachePath);

/** One input as read from the pinned commit. */
export interface InputFile extends UpstreamInput {
  readonly bytes: Buffer;
  readonly gitBlob: string;
}

/**
 * Where the extractor gets its upstream bytes. The real source reads blobs of the pinned commit;
 * tests use an in-memory source.
 */
export interface UpstreamSource {
  readonly commit: string;
  readonly commitDate: string;
  /** The bytes of one pinned input; fails for a path that is not listed in upstream.json. */
  read(path: string): Buffer;
  readonly inputs: readonly InputFile[];
}

export class InputHashError extends Error {
  constructor(readonly mismatches: readonly string[]) {
    super(`upstream input check failed:\n  ${mismatches.join('\n  ')}`);
    this.name = 'InputHashError';
  }
}

/**
 * Reads every input of `pin` from the clone's object store at the pinned commit and verifies its
 * LF blob SHA-256 against upstream.json. Nothing is fetched here (see fetch.ts): in a partial clone
 * with a git that does not know GIT_NO_LAZY_FETCH, every input blob is first checked to be present
 * with a listing that cannot fetch, and a missing one is refused before any read (data-F4).
 */
export function openPinnedSource(pin: UpstreamPin, repo: string, commitDateOf: (repo: string, commit: string) => string): UpstreamSource {
  if (!existsSync(repo)) throw new Error(`no QuestieDB clone at ${pin.cachePath}; run pnpm data:fetch`);
  if (!hasCommit(repo, pin.commit)) throw new Error(`the clone at ${pin.cachePath} lacks commit ${pin.commit}; run pnpm data:fetch`);
  const tree: ReadonlyMap<string, TreeEntry> = listTree(repo, pin.commit);
  const mismatches: string[] = [];
  const inputs: InputFile[] = [];
  const listed = pin.inputs.filter((input) => tree.has(input.path));
  if (isPartialClone(repo) && !gitCapabilities().noLazyFetch) {
    const present = localObjects(repo);
    const absent = listed.filter((input) => !present.has(tree.get(input.path)?.blob ?? ''));
    if (absent.length > 0) {
      throw new InputHashError(absent.map((input) => `${input.path}: blob not available locally (checked without fetching; this git lacks GIT_NO_LAZY_FETCH); run pnpm data:fetch`));
    }
  }
  const blobs = readBlobs(repo, pin.commit, listed.map((input) => input.path));
  for (const input of pin.inputs) {
    const entry = tree.get(input.path);
    if (entry === undefined) {
      mismatches.push(`${input.path}: not in commit ${pin.commit}`);
      continue;
    }
    const bytes = blobs.get(input.path) ?? null;
    if (bytes === null) {
      mismatches.push(`${input.path}: blob not available locally; run pnpm data:fetch`);
      continue;
    }
    const actual = sha256Hex(bytes);
    if (actual !== input.sha256) mismatches.push(`${input.path}: sha256 ${actual}, upstream.json pins ${input.sha256}`);
    inputs.push({ ...input, bytes, gitBlob: entry.blob });
  }
  if (mismatches.length > 0) throw new InputHashError(mismatches);
  const byPath = new Map(inputs.map((input) => [input.path, input]));
  return {
    commit: pin.commit,
    commitDate: commitDateOf(repo, pin.commit),
    inputs,
    read(path) {
      const input = byPath.get(path);
      if (input === undefined) throw new Error(`${path} is not a pinned input (add it to tools/questiedb/upstream.json)`);
      return input.bytes;
    },
  };
}
