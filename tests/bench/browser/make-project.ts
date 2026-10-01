/**
 * Writes the 10,000-step project the browser harness imports (tests/bench/browser/README.md).
 *
 * It is the project the earlier browser measurements used (docs/measurements/ui-refresh.json,
 * `ur2bRouteListBaseline.project`; map-atlas.json `atl9mm8.project`): the benches' realistic route
 * (tests/bench/bench-support.ts `buildRealisticRoute`: an Orc Warrior's quests in guide order,
 * repaired with the validator, padded with travel waypoints) inside the committed sample project,
 * with the benches' character (a fresh one, hearth at the start). Self-built from the committed
 * dataset; no guide text is used. Deterministic: the same dataset gives the same bytes, so the
 * file's SHA-256 is recorded beside every measurement.
 *
 * Usage: pnpm exec tsx tests/bench/browser/make-project.ts [--steps 10000] [--out <file>]
 * Default output: .cache/bench/browser/project-10000.frl.json (gitignored).
 */
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { loadWorkspace } from '../../../src/app/workspace';
import type { ProjectV1 } from '../../../src/domain/project';
import { parseProjectText, serializeProject } from '../../../src/project/io';
import { fakeServer, nodeSha256, publicSite, REPO_ROOT } from '../../support/fake-fetch';
import { benchSetup } from '../bench-support';

/** As bench-support's own NOW: the timestamps the sample project is stamped with. */
const NOW = '2026-09-26T00:00:00.000Z';

export interface BuiltProject {
  readonly text: string;
  readonly sha256: string;
  readonly steps: number;
  readonly composition: Readonly<Record<string, number>>;
}

/** The sample project with the realistic bench route of `count` steps and the benches' character. */
export async function buildBenchProject(count: number): Promise<BuiltProject> {
  const server = fakeServer(publicSite());
  const workspace = await loadWorkspace({
    fetch: server.fetch,
    baseUrl: './',
    sha256: nodeSha256,
    nowIso: NOW,
    now: () => performance.now(),
    yieldToRender: () => Promise.resolve(),
  });
  const sample = workspace.project;
  const setup = await benchSetup('realistic', count);
  const project: ProjectV1 = {
    ...sample,
    character: setup.character,
    route: { ...sample.route, steps: setup.steps, groups: {} },
    customQuests: [],
  };
  const text = serializeProject(project);
  // The app refuses a file that does not pass the schema; so does this script.
  const parsed = parseProjectText(text);
  if (!parsed.ok) throw new Error(`the bench project does not pass the project schema: ${JSON.stringify(parsed.errors.slice(0, 5))}`);
  return { text, sha256: createHash('sha256').update(text).digest('hex'), steps: setup.steps.length, composition: setup.composition };
}

export function defaultProjectPath(count: number): string {
  return join(REPO_ROOT, '.cache', 'bench', 'browser', `project-${String(count)}.frl.json`);
}

async function main(argv: readonly string[]): Promise<void> {
  const option = (name: string): string | undefined => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const count = Number(option('--steps') ?? '10000');
  if (!Number.isInteger(count) || count < 1) throw new Error('--steps must be a positive whole number');
  const out = resolve(option('--out') ?? defaultProjectPath(count));
  const built = await buildBenchProject(count);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, built.text);
  console.log(JSON.stringify({ out, steps: built.steps, bytes: Buffer.byteLength(built.text), sha256: built.sha256, composition: built.composition }));
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  main(process.argv.slice(2)).catch((error: unknown) => {
    console.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
    process.exitCode = 1;
  });
}
