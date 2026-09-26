/**
 * Small text helpers shared by the RXP modules. Pure: no DOM, no Node, no TextEncoder (the pure
 * tsconfig has no DOM lib), no bitwise operators (D-012, ARCHITECTURE §17).
 */

/** U+FFFD, written for invalid UTF-8 (built from its code so no source file holds the raw character). */
export const REPLACEMENT_CHARACTER = String.fromCharCode(0xfffd);

/** RXP trims spaces and tabs only (docs/RXP.md §4 P4). */
export const isBlankChar = (char: string | undefined): boolean => char === ' ' || char === '\t';

export function trimStartBlank(value: string): string {
  let start = 0;
  while (start < value.length && isBlankChar(value[start])) start += 1;
  return value.slice(start);
}

export function trimEndBlank(value: string): string {
  let end = value.length;
  while (end > 0 && isBlankChar(value[end - 1])) end -= 1;
  return value.slice(0, end);
}

export const trimBlank = (value: string): string => trimEndBlank(trimStartBlank(value));

/** Length of the leading run of spaces and tabs. */
export function leadingBlankLength(value: string): number {
  let index = 0;
  while (index < value.length && isBlankChar(value[index])) index += 1;
  return index;
}

/** 1-based column, in Unicode code points, of UTF-16 offset `offset` within `line`. */
export function codePointColumn(line: string, offset: number): number {
  let column = 1;
  let index = 0;
  const end = Math.min(Math.max(offset, 0), line.length);
  while (index < end) {
    const code = line.charCodeAt(index);
    index += code >= 0xd800 && code <= 0xdbff && index + 1 < line.length ? 2 : 1;
    column += 1;
  }
  return column;
}

/** UTF-8 bytes of a string; a lone surrogate becomes U+FFFD, as TextEncoder does. */
export function utf8Encode(value: string): Uint8Array {
  const out: number[] = [];
  for (let index = 0; index < value.length; index += 1) {
    let code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = index + 1 < value.length ? value.charCodeAt(index + 1) : 0;
      if (next >= 0xdc00 && next <= 0xdfff) {
        code = 0x10000 + (code - 0xd800) * 0x400 + (next - 0xdc00);
        index += 1;
      } else code = 0xfffd;
    } else if (code >= 0xdc00 && code <= 0xdfff) code = 0xfffd;
    if (code < 0x80) out.push(code);
    else if (code < 0x800) out.push(0xc0 + Math.floor(code / 64), 0x80 + (code % 64));
    else if (code < 0x10000) out.push(0xe0 + Math.floor(code / 4096), 0x80 + (Math.floor(code / 64) % 64), 0x80 + (code % 64));
    else {
      out.push(
        0xf0 + Math.floor(code / 262144),
        0x80 + (Math.floor(code / 4096) % 64),
        0x80 + (Math.floor(code / 64) % 64),
        0x80 + (code % 64),
      );
    }
  }
  return Uint8Array.from(out);
}

const UTF8_LEADS = [
  { from: 0xc2, to: 0xdf, need: 1, base: 0xc0, min: 0x80 },
  { from: 0xe0, to: 0xef, need: 2, base: 0xe0, min: 0x800 },
  { from: 0xf0, to: 0xf4, need: 3, base: 0xf0, min: 0x10000 },
] as const;

/** Decodes UTF-8 bytes; an invalid or truncated sequence becomes U+FFFD. */
export function utf8Decode(bytes: readonly number[]): string {
  let out = '';
  let index = 0;
  while (index < bytes.length) {
    const first = bytes[index] ?? 0;
    if (first < 0x80) {
      out += String.fromCharCode(first);
      index += 1;
      continue;
    }
    const lead = UTF8_LEADS.find((candidate) => first >= candidate.from && first <= candidate.to);
    if (lead === undefined) {
      out += REPLACEMENT_CHARACTER;
      index += 1;
      continue;
    }
    const need = lead.need;
    const min = lead.min;
    let code = first - lead.base;
    let ok = true;
    for (let k = 1; ok && k <= need; k += 1) {
      const byte = bytes[index + k];
      if (byte === undefined || byte < 0x80 || byte > 0xbf) ok = false;
      else code = code * 64 + (byte - 0x80);
    }
    if (!ok || code < min || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) {
      out += REPLACEMENT_CHARACTER;
      index += 1;
      continue;
    }
    out += String.fromCodePoint(code);
    index += need + 1;
  }
  return out;
}

/**
 * A number as the serializer writes new values (docs/RXP.md §13.4 rule 8): integers without
 * decimals, decimals in shortest round-trip form, never an exponent or a leading `+`, and `-0` as
 * `0`. Returns null for NaN and infinities, which have no RXP form.
 */
export function formatNumber(value: number): string | null {
  if (!Number.isFinite(value)) return null;
  if (value === 0) return '0';
  const text = String(value);
  if (!/e/i.test(text)) return text;
  // Expand the exponent form by hand (String() uses it below 1e-6 and from 1e21).
  const negative = value < 0;
  const [mantissa = '', exponentText = '0'] = String(Math.abs(value)).split(/e/i);
  const exponent = Number(exponentText);
  const [whole = '', fraction = ''] = mantissa.split('.');
  const digits = whole + fraction;
  const point = whole.length + exponent;
  let expanded: string;
  if (point <= 0) expanded = `0.${'0'.repeat(-point)}${digits}`;
  else if (point >= digits.length) expanded = digits + '0'.repeat(point - digits.length);
  else expanded = `${digits.slice(0, point)}.${digits.slice(point)}`;
  expanded = expanded.replace(/^0+(?=\d)/, '');
  return negative ? `-${expanded}` : expanded;
}

/** A coordinate with exactly two decimals, as app-created points are written (§13.4 rule 8). */
export function formatFixed2(value: number): string | null {
  if (!Number.isFinite(value)) return null;
  const text = value.toFixed(2);
  return text === '-0.00' ? '0.00' : text;
}

/** Levenshtein distance, for "did you mean" suggestions. */
export function editDistance(a: string, b: string): number {
  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    let diagonal = previous[0] ?? 0;
    previous[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const above = previous[j] ?? 0;
      const left = previous[j - 1] ?? 0;
      previous[j] = Math.min(above + 1, left + 1, diagonal + (a[i - 1] === b[j - 1] ? 0 : 1));
      diagonal = above;
    }
  }
  return previous[b.length] ?? 0;
}

/** The closest candidate within `maxDistance` (case-insensitive), ties by list order; or null. */
export function closestName(value: string, candidates: readonly string[], maxDistance = 2): string | null {
  const lower = value.toLowerCase();
  let best: string | null = null;
  let bestDistance = maxDistance + 1;
  for (const candidate of candidates) {
    const distance = editDistance(lower, candidate.toLowerCase());
    if (distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return best;
}
