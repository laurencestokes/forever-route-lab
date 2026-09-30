import { blpInfo, BlpError, decodeBlp } from './blp';
import { MINIMAP_BLP } from './minimap-params';
import { TEX } from './minimap-texels';

/**
 * The minimap textures (docs/research/map-atlas.md §17.1, §18.2 step 3): every tile is BLP2 DXT1
 * with no alpha, one mip, 512 × 512 (132,244 bytes, MEASURED at the pin). The tool refuses anything
 * else, so a changed client format stops the build instead of being drawn wrongly. Decoding is our
 * own `blp.ts` (no bitwise operators, D-012). Pure.
 */

export class MinimapInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MinimapInputError';
  }
}

/** The decoded texels of one minimap texture: 512 × 512 × 3 bytes, row 0 north, column 0 west. */
export function decodeMinimapTexture(bytes: Uint8Array, where: string): Uint8Array {
  let info;
  try {
    info = blpInfo(bytes);
  } catch (error) {
    if (error instanceof BlpError) throw new MinimapInputError(`${where}: ${error.message}`);
    throw error;
  }
  if (info.encoding !== MINIMAP_BLP.encoding) throw new MinimapInputError(`${where}: ${info.encoding} texture, expected BLP2 DXT1`);
  if (info.alphaBits !== MINIMAP_BLP.alphaBits) throw new MinimapInputError(`${where}: alpha depth ${String(info.alphaBits)}, expected 0 (opaque DXT1)`);
  if (info.width !== MINIMAP_BLP.width || info.height !== MINIMAP_BLP.height) throw new MinimapInputError(`${where}: ${String(info.width)} × ${String(info.height)} texels, expected 512 × 512`);
  const { image } = decodeBlp(bytes);
  const out = new Uint8Array(TEX * TEX * 3);
  const d = image.data;
  for (let p = 0; p < TEX * TEX; p += 1) {
    out[p * 3] = d[p * 4] ?? 0;
    out[p * 3 + 1] = d[p * 4 + 1] ?? 0;
    out[p * 3 + 2] = d[p * 4 + 2] ?? 0;
  }
  return out;
}
