/**
 * SHA-256 through WebCrypto (`crypto.subtle`), shared by the data and map loaders. The hash is
 * the lowercase hex digest, the form the manifests record (DATA_PROVENANCE §8, MAPS.md §5.6).
 *
 * WebCrypto exists only in secure contexts (https, or http on localhost). Without it nothing can be
 * verified, so the loaders refuse to run instead of trusting unverified files.
 */

/** The one WebCrypto method the loaders use; `crypto.subtle` satisfies it (so does Node's). */
export interface Sha256Digest {
  digest(algorithm: 'SHA-256', data: BufferSource): Promise<ArrayBuffer>;
}

const HEX_DIGITS = '0123456789abcdef';

/** Lowercase hex of the bytes, two digits per byte (no bitwise operators: D-012, ARCHITECTURE §17). */
export function hexOf(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let out = '';
  for (const byte of bytes) out += (HEX_DIGITS[Math.floor(byte / 16)] ?? '') + (HEX_DIGITS[byte % 16] ?? '');
  return out;
}

const encoder = new TextEncoder();

/** Lowercase hex SHA-256 of `data`; a string is hashed as its UTF-8 bytes. */
export async function sha256Hex(subtle: Sha256Digest, data: BufferSource | string): Promise<string> {
  const bytes = typeof data === 'string' ? encoder.encode(data) : data;
  return hexOf(await subtle.digest('SHA-256', bytes));
}

/**
 * The browser's WebCrypto digest, or null where it is missing (a page served over plain http from
 * another host). Callers turn null into a clear "needs a secure context" error.
 */
export function defaultSha256(): Sha256Digest | null {
  const subtle: SubtleCrypto | undefined = (globalThis.crypto as Crypto | undefined)?.subtle;
  return subtle === undefined ? null : subtle;
}
