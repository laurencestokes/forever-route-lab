import sharp from 'sharp';
import { isOpaque, type Rgba } from './raster';

/**
 * Web image encoding for the committed map art (docs/MAPS.md §5.4 (b); D-033). WebP through
 * `sharp` (declares Apache-2.0; its prebuilt libvips declares LGPL-3.0-or-later and bundles
 * libwebp, BSD-3-Clause), a development dependency that never reaches `dist/`
 * (THIRD_PARTY_NOTICES "Map art"). The same sharp version on the same platform gives the same
 * bytes; `convert.ts` also records the encoder-independent pixel hash (`rasterSha256`), so a
 * rebuild elsewhere can tell an encoder difference from an input or tool difference.
 *
 * An image without transparency is encoded from its RGB channels, so the file carries no alpha
 * plane. Metadata is never written (sharp strips it unless asked to keep it).
 */

export interface WebpSettings {
  /** libwebp quality, 1-100 (lossy). */
  readonly quality: number;
  /** Quality of the alpha plane, 0-100 (100 is lossless alpha). */
  readonly alphaQuality: number;
  /** libwebp method, 0-6 (6 is the slowest and smallest). */
  readonly effort: number;
  /** Sharper chroma subsampling for edges (slower). */
  readonly smartSubsample: boolean;
  /** libwebp preset (filter and spatial-noise-shaping defaults). */
  readonly preset: 'default' | 'photo' | 'picture' | 'drawing' | 'icon' | 'text';
}

/**
 * The committed settings. Measured on all 60 images at the pin (docs/MAPS.md §5.4 (b)): quality 80
 * with the `drawing` preset and smart subsampling gives 9.02 MB (gzip-6) at a mean PSNR of 33.65 dB
 * against the composed pixels; quality 85 would be 11.7 MB, too close to the 12 MB `art` budget,
 * and quality 88 (13.7 MB) is over it.
 */
export const DEFAULT_WEBP: WebpSettings = { quality: 80, alphaQuality: 100, effort: 6, smartSubsample: true, preset: 'drawing' };

export interface EncoderIdentity {
  readonly name: 'sharp';
  readonly sharp: string;
  readonly libvips: string;
  readonly libwebp: string;
  readonly platform: string;
}

export function encoderIdentity(): EncoderIdentity {
  const v = sharp.versions as Readonly<Record<string, string | undefined>>;
  return { name: 'sharp', sharp: v['sharp'] ?? 'unknown', libvips: v['vips'] ?? 'unknown', libwebp: v['webp'] ?? 'unknown', platform: `${process.platform}-${process.arch}` };
}

/** Strips the alpha channel of an opaque image. */
function rgbOf(image: Rgba): Buffer {
  const out = Buffer.alloc(image.width * image.height * 3);
  for (let i = 0, j = 0; i < image.data.length; i += 4, j += 3) {
    out[j] = image.data[i] ?? 0;
    out[j + 1] = image.data[i + 1] ?? 0;
    out[j + 2] = image.data[i + 2] ?? 0;
  }
  return out;
}

export async function encodeWebp(image: Rgba, settings: WebpSettings = DEFAULT_WEBP): Promise<Buffer> {
  // One thread and no operation cache: the output must not depend on scheduling.
  sharp.concurrency(1);
  sharp.cache(false);
  const opaque = isOpaque(image);
  const input = opaque ? rgbOf(image) : Buffer.from(image.data.buffer, image.data.byteOffset, image.data.byteLength);
  return sharp(input, { raw: { width: image.width, height: image.height, channels: opaque ? 3 : 4 } })
    .webp({
      quality: settings.quality,
      alphaQuality: settings.alphaQuality,
      effort: settings.effort,
      smartSubsample: settings.smartSubsample,
      preset: settings.preset,
      lossless: false,
    })
    .toBuffer();
}

/** Decodes an encoded image back to RGBA (tests and the offline checks). */
export async function decodeToRgba(bytes: Uint8Array): Promise<Rgba> {
  const { data, info } = await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { width: info.width, height: info.height, data: new Uint8Array(data.buffer, data.byteOffset, data.byteLength) };
}
