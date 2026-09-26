import { fork } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { blockName, mapBlocks, TERRAIN_DIR, type BuildConfig } from './settings';
import type { BlockDone, FromWorker, ToWorker } from './worker';

/**
 * Stage 1 in parallel worker processes (worker.ts). Blocks are handed out largest first (most
 * present ADTs), one at a time, so the slowest block does not wait behind a queue; the outputs
 * never depend on the order.
 */

export const WORKER = join(TERRAIN_DIR, 'lib', 'worker.ts');

const log = (msg: string): void => {
  console.log(`[nav] ${msg}`);
};

/** Stage 1 over every block of `maps` with `parts` worker processes. */
export async function runStage1(config: BuildConfig, maps: readonly number[], present: ReadonlyMap<number, ReadonlySet<number>>, dir: string, parts: number, blockAdts = config.settings.blockAdts, quiet = false): Promise<BlockDone[]> {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const size = blockAdts;
  const jobs: { mapId: number; row0: number; col0: number; weight: number }[] = [];
  for (const mapId of maps) {
    const p = present.get(mapId) ?? new Set<number>();
    for (const b of mapBlocks(p, size)) {
      let weight = 0;
      for (let r = b.row0; r < b.row0 + size; r += 1) for (let c = b.col0; c < b.col0 + size; c += 1) if (p.has(r * 64 + c)) weight += 1;
      jobs.push({ mapId, row0: b.row0, col0: b.col0, weight });
    }
  }
  jobs.sort((a, b) => b.weight - a.weight || a.mapId - b.mapId || a.row0 - b.row0 || a.col0 - b.col0);
  const total = jobs.length;
  const results: BlockDone[] = [];
  const memory = Math.max(4096, Math.min(12288, Math.floor(28000 / parts)));
  let next = 0;
  const started = performance.now();
  await Promise.all(
    Array.from({ length: Math.min(parts, jobs.length) }, (_, w) =>
      new Promise<void>((resolveWorker, rejectWorker) => {
        const child = fork(WORKER, [], { execArgv: [...process.execArgv, `--max-old-space-size=${String(memory)}`], stdio: ['ignore', 'inherit', 'inherit', 'ipc'] });
        const post = (msg: ToWorker): void => {
          child.send(msg);
        };
        const feed = (): void => {
          const job = jobs[next];
          next += 1;
          if (job === undefined) post({ kind: 'exit' });
          else post({ kind: 'block', mapId: job.mapId, row0: job.row0, col0: job.col0, blockAdts: size });
        };
        let failed = false;
        child.on('message', (raw: unknown) => {
          const msg = raw as FromWorker;
          if (msg.kind === 'ready') feed();
          else if (msg.kind === 'block-done') {
            results.push(msg);
            const s = msg.stats;
            if (!quiet) log(`stage 1 ${String(results.length)}/${String(total)} map ${String(msg.mapId)} ${blockName(msg.row0, msg.col0)}: ${String(s.triangles)} triangles, ${String(msg.polygons)} polygons, geometry ${String(Math.round(s.geometryMs))} ms, recast ${String(Math.round(s.recastMs))} ms (worker ${String(w)}, ${String(msg.rssMb)} MB, ${String(Math.round((performance.now() - started) / 1000))} s)`);
            feed();
          } else {
            failed = true;
            rejectWorker(new Error(`stage-1 worker ${String(w)}: ${msg.message}`));
          }
        });
        child.on('exit', (code) => {
          if (failed) return;
          if (code === 0) resolveWorker();
          else rejectWorker(new Error(`stage-1 worker ${String(w)} exited with code ${String(code)}`));
        });
        post({ kind: 'init', buildJson: join(TERRAIN_DIR, 'build.json'), dir, maps });
      }),
    ),
  );
  return results.sort((a, b) => a.mapId - b.mapId || a.row0 - b.row0 || a.col0 - b.col0);
}

