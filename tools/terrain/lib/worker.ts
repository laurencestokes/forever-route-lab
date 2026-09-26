import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { LocalCasc } from '../../casc/casc';
import { cascSource, openClient, readMapWdt, readTables, type ClientTables } from './client';
import { sha256 } from './manifest';
import { ensureRecast } from './recast';
import { derive, readBuildConfig, blockName, type BuildConfig } from './settings';
import { buildStage1Block, stage1Inputs, type Stage1Inputs, type Stage1Stats } from './stage1';
import type { InputFile } from './client';

/**
 * The stage-1 worker process (forked by extract.ts): it opens the pinned client once, reads the
 * tables and WDTs, loads Recast, then builds the blocks the parent sends, one at a time, writing
 * each stage-1 block to `<dir>/<mapId>/<row0>_<col0>.bin`. Blocks never share state, so the
 * scheduling order cannot change any output.
 */

export type ToWorker =
  | { readonly kind: 'init'; readonly buildJson: string; readonly dir: string; readonly maps: readonly number[] }
  | { readonly kind: 'block'; readonly mapId: number; readonly row0: number; readonly col0: number; readonly blockAdts: number }
  | { readonly kind: 'exit' };

export interface BlockDone {
  readonly kind: 'block-done';
  readonly mapId: number;
  readonly row0: number;
  readonly col0: number;
  /** Null when the block has no walkable polygon (no file written). */
  readonly sha256: string | null;
  readonly bytes: number;
  readonly polygons: number;
  readonly inputHash: string;
  readonly inputs: readonly InputFile[];
  readonly stats: Stage1Stats;
  readonly rssMb: number;
}

export type FromWorker = { readonly kind: 'ready' } | BlockDone | { readonly kind: 'error'; readonly message: string };

function send(msg: FromWorker): void {
  if (process.send === undefined) throw new Error('worker.ts must run as a forked child of extract.ts');
  process.send(msg);
}

let casc: LocalCasc | null = null;
let config: BuildConfig | null = null;
let outDir = '';
const inputsByMap = new Map<number, Stage1Inputs>();

async function init(msg: Extract<ToWorker, { kind: 'init' }>): Promise<void> {
  config = readBuildConfig(msg.buildJson);
  outDir = msg.dir;
  casc = openClient(config);
  const tables: ClientTables = readTables(casc);
  const d = derive(config.settings);
  for (const mapId of msg.maps) {
    const m = config.maps.find((x) => x.id === mapId);
    if (m === undefined) throw new Error(`map ${String(mapId)} is not in build.json`);
    const { wdt, present, input } = readMapWdt(tables, mapId, m.wdtFileDataId);
    inputsByMap.set(mapId, stage1Inputs(casc, tables, mapId, wdt, present, d, input, cascSource(casc)));
    mkdirSync(join(outDir, String(mapId)), { recursive: true });
  }
  await ensureRecast();
}

function block(msg: Extract<ToWorker, { kind: 'block' }>): BlockDone {
  const inp = inputsByMap.get(msg.mapId);
  if (inp === undefined) throw new Error(`map ${String(msg.mapId)} was not initialised`);
  const r = buildStage1Block(inp, msg.row0, msg.col0, { blockAdts: msg.blockAdts });
  if (r.bytes !== null) writeFileSync(join(outDir, String(msg.mapId), `${blockName(msg.row0, msg.col0)}.bin`), r.bytes);
  return {
    kind: 'block-done',
    mapId: msg.mapId,
    row0: msg.row0,
    col0: msg.col0,
    sha256: r.bytes === null ? null : sha256(r.bytes),
    bytes: r.bytes?.length ?? 0,
    polygons: r.stats.polygonsKept,
    inputHash: r.inputHash,
    inputs: r.inputs,
    stats: r.stats,
    rssMb: Math.round(process.memoryUsage().rss / 1e6),
  };
}

process.on('message', (raw: unknown) => {
  const msg = raw as ToWorker;
  void (async () => {
    try {
      if (msg.kind === 'init') {
        await init(msg);
        send({ kind: 'ready' });
      } else if (msg.kind === 'block') {
        send(block(msg));
      } else {
        casc?.close();
        process.exit(0);
      }
    } catch (error) {
      send({ kind: 'error', message: error instanceof Error ? `${error.message}\n${error.stack ?? ''}` : String(error) });
      process.exit(1);
    }
  })();
});
