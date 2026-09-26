import { createHash } from 'node:crypto';
import { CascError } from './errors';

/**
 * Byte helpers shared by the CASC and DB2 readers. No bitwise operators anywhere (D-012, the repo's
 * `no-bitwise` lint rule): bit tests, shifts and XOR are written with division and modulo.
 */

export const HEX_KEY = /^[0-9a-f]{32}$/;

/** Lowercase hex of `length` bytes at `offset`. */
export function hexOf(bytes: Uint8Array, offset = 0, length = bytes.length - offset): string {
  return Buffer.from(bytes.buffer, bytes.byteOffset + offset, length).toString('hex');
}

/** Parses a 32-character lowercase hex key (a CKey or an EKey) into 16 bytes. */
export function keyBytes(hex: string, what: string): Buffer {
  if (!HEX_KEY.test(hex)) throw new CascError('format', `${what} is not 32 lowercase hex characters: "${hex}"`);
  return Buffer.from(hex, 'hex');
}

export function md5Hex(data: Uint8Array): string {
  return createHash('md5').update(data).digest('hex');
}

/** True when bit value `mask` (a power of two) is set in the non-negative integer `value`. */
export function hasFlag(value: number, mask: number): boolean {
  return Math.floor(value / mask) % 2 === 1;
}

/** Bitwise XOR of two bytes, by arithmetic. */
export function xorByte(a: number, b: number): number {
  let out = 0;
  let bit = 1;
  let x = a;
  let y = b;
  for (let i = 0; i < 8; i += 1) {
    if (x % 2 !== y % 2) out += bit;
    x = Math.floor(x / 2);
    y = Math.floor(y / 2);
    bit *= 2;
  }
  return out;
}

/** True when every byte of `bytes[start, end)` is zero. */
export function allZero(bytes: Uint8Array, start = 0, end = bytes.length): boolean {
  for (let i = start; i < end; i += 1) if (bytes[i] !== 0) return false;
  return true;
}

/** A half-open byte range `[start, end)` of a decoded file. */
export interface ByteRange {
  readonly start: number;
  readonly end: number;
}

/** Reads `bits` bits (at most 53) starting at bit `bitOffset` of `bytes[byteOffset…]`, least significant bit first. */
export function readBits(bytes: Uint8Array, byteOffset: number, bitOffset: number, bits: number): number {
  let value = 0;
  let weight = 1;
  for (let i = 0; i < bits; i += 1) {
    const position = bitOffset + i;
    const byte = bytes[byteOffset + Math.floor(position / 8)];
    if (byte === undefined) throw new CascError('format', `bit read past the end (byte ${String(byteOffset + Math.floor(position / 8))})`);
    if (Math.floor(byte / 2 ** (position % 8)) % 2 === 1) value += weight;
    weight *= 2;
  }
  return value;
}

/** Two's-complement reinterpretation of an unsigned `bits`-bit value. */
export function signExtend(value: number, bits: number): number {
  const half = 2 ** (bits - 1);
  return value >= half ? value - 2 * half : value;
}

/** Reinterprets the 32 bits of an unsigned integer as an IEEE-754 single. */
export function float32FromBits(bits: number): number {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(bits, 0);
  return b.readFloatLE(0);
}
