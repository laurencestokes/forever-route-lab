/**
 * RXP benchmark (docs/RXP.md §13; the Milestone 5 RXP review F20): import, export and canonical
 * form of one large guide, on the main thread in Node.
 *
 *   pnpm exec tsx tests/bench/rxp.bench.ts [--runs 7] [--steps 3800]
 *
 * The guide is synthetic and self-authored (D-019): the step blocks of fixtures 01, 02, 05 and 06
 * (tests/fixtures/rxp) repeated, without their full-line comments, until it has `--steps` RXP
 * steps, below fixture 01's header. The default matches the size of the largest guide file the
 * RXP review measured (3,768 steps). The quest facts, zone keys and geometry are the test context
 * of `src/rxp/test-fixtures.ts`.
 *
 * Phases (median, min and max of `--runs` runs, in ms):
 * - `import`: `importRxp` (unwrap, CST, diagnostics, lowering, fingerprints);
 * - `importLua`: the same text as a Lua file with one `RegisterGuide([[…]])` call;
 * - `exportUnedited`: both export forms of the unedited import (`exportRxpForms`);
 * - `exportEdited`: both forms after deleting every 7th step, so every group is checked and many
 *   are rewritten;
 * - `exportEditedTwice`: the same edit exported twice with `exportRxp` (txt, then lua), as the
 *   export dialog did before `exportRxpForms`;
 * - `canonical`: `canonicalizeRxp` of the text.
 * Prints one JSON object. Record results in docs/measurements/rxp-m5.json.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { routeId, sequentialIdSource } from '../../src/domain/ids';
import type { Route } from '../../src/domain/route';
import { canonicalizeRxp, exportRxp, exportRxpForms, importRxp, type ImportedGuide } from '../../src/rxp';
import { FULL_CONTEXT, testGeometry } from '../../src/rxp/test-fixtures';
import { REPO_ROOT } from '../support/fake-fetch';

const args = process.argv.slice(2);
const option = (name: string, fallback: string): string => {
  const i = args.indexOf(name);
  return i >= 0 ? (args[i + 1] ?? fallback) : fallback;
};
const runs = Number(option('--runs', '7'));
const targetSteps = Number(option('--steps', '3800'));

const fixture = (name: string): string => readFileSync(join(REPO_ROOT, 'tests/fixtures/rxp', name), 'utf8');

/** A fixture's step blocks without full-line comments or blank lines. */
function stepBlocks(text: string): string {
  const body = text.slice(text.indexOf('\nstep') + 1);
  return body
    .split('\n')
    .filter((line) => line.trim() !== '' && !line.trim().startsWith('--'))
    .join('\n');
}

function syntheticGuide(steps: number): string {
  const one = fixture('01-basic-durotar.txt');
  const header = one
    .slice(0, one.indexOf('\nstep') + 1)
    .split('\n')
    .filter((line) => !line.startsWith('--'))
    .join('\n');
  const blocks = ['01-basic-durotar.txt', '02-filters-and-step-tags.txt', '05-travel-and-conditions.txt', '06-lowering-and-export.txt'].map((name) => stepBlocks(fixture(name)));
  let body = '';
  let count = 0;
  for (let k = 0; count < steps; k = (k + 1) % blocks.length) {
    const block = blocks[k] ?? '';
    body += `${block}\n`;
    count += block.split('\n').filter((line) => line.startsWith('step')).length;
  }
  return `${header}${body}`;
}

const median = (values: readonly number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? (sorted[mid] ?? 0) : ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
};
const round = (value: number): number => Math.round(value * 10) / 10;

function time<T>(work: () => T): { readonly result: T; readonly ms: number } {
  const started = performance.now();
  const result = work();
  return { result, ms: performance.now() - started };
}

function phase(work: () => unknown): { readonly median: number; readonly min: number; readonly max: number } {
  const values: number[] = [];
  work(); // warm-up
  for (let run = 0; run < runs; run += 1) values.push(time(work).ms);
  return { median: round(median(values)), min: round(Math.min(...values)), max: round(Math.max(...values)) };
}

function importOne(input: string): ImportedGuide {
  const result = importRxp(input, sequentialIdSource(), FULL_CONTEXT);
  if (result.status !== 'ok') throw new Error('refused');
  const [guide] = result.guides;
  if (guide === undefined) throw new Error('no guide');
  return guide;
}

const text = syntheticGuide(targetSteps);
const lua = `RXPGuides.RegisterGuide([[\n${text}]])\n`;
const guide = importOne(text);
const exportContext = { zoneKey: FULL_CONTEXT.zoneKey, geometry: testGeometry, quest: FULL_CONTEXT.quest };
const route = (steps: Route['steps']): Route => ({ id: routeId('route-bench'), name: 'Bench', description: '', steps, groups: guide.groups });
const edited = guide.steps.filter((_, index) => index % 7 !== 6);

const unedited = exportRxpForms(route(guide.steps), [guide.import], exportContext);
if (!unedited.txt.ok || unedited.txt.text !== text) throw new Error('the unedited export is not byte-identical');
const editedForms = exportRxpForms(route(edited), [guide.import], exportContext);
if (!editedForms.txt.ok) throw new Error(editedForms.txt.errors.map((e) => e.message).join('; '));

console.log(
  JSON.stringify(
    {
      runs,
      node: process.version,
      platform: `${process.platform} ${process.arch}`,
      guide: {
        bytes: Buffer.byteLength(text, 'utf8'),
        lines: text.split('\n').length,
        rxpSteps: Object.keys(guide.groups).length,
        routeSteps: guide.steps.length,
        editedRouteSteps: edited.length,
      },
      importMs: phase(() => importOne(text)),
      importLuaMs: phase(() => importOne(lua)),
      exportUneditedMs: phase(() => exportRxpForms(route(guide.steps), [guide.import], exportContext)),
      exportEditedMs: phase(() => exportRxpForms(route(edited), [guide.import], exportContext)),
      exportEditedTwiceMs: phase(() => {
        exportRxp(route(edited), [guide.import], exportContext, { wrapper: 'none' });
        exportRxp(route(edited), [guide.import], exportContext, { wrapper: 'lua' });
      }),
      canonicalMs: phase(() => canonicalizeRxp(text)),
    },
    null,
    2,
  ),
);
