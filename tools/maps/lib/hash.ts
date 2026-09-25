import { createHash } from 'node:crypto';

/** Lowercase hex SHA-256 of bytes, or of a string's UTF-8 bytes. */
export function sha256Hex(data: string | Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}

/** The git blob id (`git hash-object`): SHA-1 of `blob <length>\0` followed by the bytes. */
export function gitBlobId(bytes: Uint8Array): string {
  return createHash('sha1').update(`blob ${String(bytes.length)}\0`).update(bytes).digest('hex');
}

/**
 * The bytes of a committed text file as git stores them. `.gitattributes` sets
 * `* text=auto eol=lf`, so the working file is LF already; a CRLF copy (an editor or a
 * `core.autocrlf` checkout) is normalised so the hash is always of the LF bytes (ARCHITECTURE §5.1).
 */
export function lfBytes(bytes: Uint8Array): Buffer {
  const text = Buffer.from(bytes).toString('utf8');
  return Buffer.from(text.replace(/\r\n/g, '\n'), 'utf8');
}

export const SHA256_HEX = /^[0-9a-f]{64}$/;
export const COMMIT_SHA = /^[0-9a-f]{40}$/;
