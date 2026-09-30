import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LocalCasc } from '../../../casc/casc';
import { resolveInstall } from '../../../casc/paths';
import { toolTreeHash } from '../../../terrain/lib/tool-tree';
import { CLIENT_TABLES_ENTRY, CLIENT_TABLES_PIN } from './constants';
import { buildClientTables, type ClientTablesBuild } from './output';
import { readClientTableRows } from './read';

/** The repository root (this file is tools/maps/lib/client-data/run.ts). */
export const CLIENT_TABLES_REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));

/**
 * Opens the pinned client read-only, reads the tables and builds the folder in memory. The tool
 * tree hash is the module closure of `tools/maps/client-tables.ts` (tools/terrain/lib/tool-tree.ts),
 * so it changes when any module the tool loads changes, and not when unrelated files in
 * `tools/maps` do.
 */
export function buildFromClient(install: string = resolveInstall(), repoRoot: string = CLIENT_TABLES_REPO_ROOT): ClientTablesBuild {
  const casc = LocalCasc.open({ install, product: CLIENT_TABLES_PIN.product, pin: CLIENT_TABLES_PIN });
  try {
    const read = readClientTableRows(casc);
    const tree = toolTreeHash(repoRoot, [join(repoRoot, CLIENT_TABLES_ENTRY)]);
    return buildClientTables(read, {
      client: { product: casc.build.product, version: casc.build.version, buildKey: casc.build.buildKey },
      tool: { hash: tree.hash, files: tree.files.length },
    });
  } finally {
    casc.close();
  }
}

/** Compares a build with a folder byte for byte; returns the differences, one per line (empty when identical). */
export function checkFolder(outDir: string, build: ClientTablesBuild): readonly string[] {
  const problems: string[] = [];
  for (const output of build.outputs) {
    const path = join(outDir, output.name);
    if (!existsSync(path)) problems.push(`${output.name}: missing`);
    else if (!readFileSync(path).equals(output.bytes)) problems.push(`${output.name}: differs`);
  }
  const expected = new Set(build.outputs.map((o) => o.name));
  for (const name of existsSync(outDir) ? readdirSync(outDir) : []) if (!expected.has(name)) problems.push(`${name}: not produced by this build`);
  return problems;
}
