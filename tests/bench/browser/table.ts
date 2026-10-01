/**
 * Prints a run's summary (tests/bench/browser/README.md) as a Markdown table: each figure's median
 * over the rounds with its spread, per tree, and each tree's ratio of medians to the base tree.
 *
 *   pnpm exec tsx tests/bench/browser/table.ts <out dir>/summary.json [--filter toLastPaintMs] [--base pre]
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Spread } from './stats';

interface Summary {
  readonly meta: { readonly base: string; readonly builds: readonly { readonly label: string }[] };
  readonly byTree: Readonly<Record<string, Readonly<Record<string, Spread>>>>;
}

const cell = (spread: Spread | undefined): string => (spread === undefined || spread.n === 0 ? '–' : `${String(spread.median)} [${String(spread.min)}–${String(spread.max)}]`);

function main(argv: readonly string[]): void {
  const file = argv.find((arg) => !arg.startsWith('--'));
  if (file === undefined) throw new Error('give the summary.json of a run');
  const option = (name: string): string | undefined => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const summary = JSON.parse(readFileSync(resolve(file), 'utf8')) as Summary;
  const labels = summary.meta.builds.map((build) => build.label);
  const base = option('--base') ?? summary.meta.base;
  const filter = option('--filter');
  const keys = [...new Set(labels.flatMap((label) => Object.keys(summary.byTree[label] ?? {})))].filter((key) => filter === undefined || key.includes(filter)).sort();
  const others = labels.filter((label) => label !== base);
  console.log(`| Figure | ${labels.join(' | ')} | ${others.map((label) => `${label}/${base}`).join(' | ')} |`);
  console.log(`|---|${labels.map(() => '---:').join('|')}|${others.map(() => '---:').join('|')}|`);
  for (const key of keys) {
    const row = labels.map((label) => cell(summary.byTree[label]?.[key]));
    const ratios = others.map((label) => {
      const a = summary.byTree[label]?.[key]?.median;
      const b = summary.byTree[base]?.[key]?.median;
      return a === undefined || b === undefined || !Number.isFinite(a) || !Number.isFinite(b) || b === 0 ? '–' : (a / b).toFixed(2);
    });
    console.log(`| ${key} | ${row.join(' | ')} | ${ratios.join(' | ')} |`);
  }
}

main(process.argv.slice(2));
