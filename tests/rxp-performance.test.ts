/**
 * Scaling checks for the RXP import path (docs/RXP.md §3.2). They run outside `src/rxp` because
 * they read the clock, which the pure set may not (ARCHITECTURE §17). The budgets are loose
 * ceilings with a wide margin, not measurements: `tests/bench/rxp.bench.ts` measures.
 */
import { performance } from 'node:perf_hooks';
import { describe, expect, it } from 'vitest';
import { unwrapRxpInput } from '../src/rxp';

describe('RXP unwrap scaling', () => {
  it('reads a long single-line Lua file in linear time, so a minified addon file does not freeze the import', () => {
    const line = `${'local x = 1 '.repeat(17000)}RXPGuides.RegisterGuide([[#name A\nstep\n]])`;
    expect(line.length).toBeGreaterThan(200000);
    const started = performance.now();
    const out = unwrapRxpInput(line);
    const elapsed = performance.now() - started;
    expect(out.guides.map((guide) => guide.text)).toEqual(['#name A\nstep\n']);
    expect(out.diagnostics.map((d) => `${String(d.line)}:${String(d.column)} ${d.code}`)).toEqual(['1:1 RXP021-lua-guard-ignored']);
    // Column counting from the start of the line for every token took tens of seconds on such a
    // line (RXP review F9); counting on from the previous token takes milliseconds.
    expect(elapsed).toBeLessThan(2000);
  });

  it('gives the same columns late on a long line as a count from the start of the line would', () => {
    const prefix = '🐗 '.repeat(5000);
    const out = unwrapRxpInput(`x = "${prefix}" RXPGuides.RegisterGuide(v)`);
    // "x = " (4), the quote (5), 5000 × (boar + space) (to 10005), the closing quote and a space: the call starts at column 10008.
    expect(out.diagnostics.map((d) => `${String(d.line)}:${String(d.column)} ${d.code}`)).toEqual(['1:1 RXP021-lua-guard-ignored', '1:10008 RXP020-lua-dynamic']);
  });
});
