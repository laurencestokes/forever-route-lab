import { decodeBlock } from './format';
import type { NavManifest } from './manifest';
import { decodeMapFile } from './mapfile';
import { NavMesh, type BlockMesh } from './mesh';

/**
 * Byte-level entry points for the worker (step 3b.6), which fetches and verifies the files
 * (SHA-256 against the manifest) before handing their bytes here. Nothing here fetches or hashes.
 */

/** A map's mesh from its verified `map.bin` (loaded before the first query of the map, §7.1). */
export function openMap(manifest: NavManifest, mapId: number, mapBin: Uint8Array): NavMesh {
  return new NavMesh(manifest, mapId, decodeMapFile(mapBin, `${String(mapId)}/map.bin`));
}

/** Decodes a verified block file and adds it (manifest index `b`), linking it to its loaded neighbours. */
export function loadBlock(mesh: NavMesh, b: number, bytes: Uint8Array): BlockMesh {
  const entry = mesh.entry.blocks[b];
  return mesh.addBlock(b, decodeBlock(bytes, mesh.P, entry?.path ?? `block ${String(b)}`));
}
