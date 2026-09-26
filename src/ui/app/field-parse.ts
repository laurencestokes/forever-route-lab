/**
 * Parsing of the editors' text fields. Pure and locale-independent: a dot is the decimal
 * separator, and nothing is rounded except where a field says it stores whole units. Empty means
 * "not set" (unknown), never 0.
 */

export type ParsedNumber = { readonly kind: 'empty' } | { readonly kind: 'number'; readonly value: number } | { readonly kind: 'invalid' };

const DECIMAL = /^-?\d+(?:\.\d+)?$/;

/** A plain decimal number (`12`, `-3.5`); empty or spaces only is `empty`; anything else (`1e3`, `12,5`, `abc`) is `invalid`. */
export function parseNumber(text: string): ParsedNumber {
  const trimmed = text.trim();
  if (trimmed === '') return { kind: 'empty' };
  if (!DECIMAL.test(trimmed)) return { kind: 'invalid' };
  const value = Number(trimmed);
  return Number.isFinite(value) ? { kind: 'number', value } : { kind: 'invalid' };
}

/** A whole number (`12`, `-4`), or `empty`, or `invalid` (a fraction included). */
export function parseWhole(text: string): ParsedNumber {
  const parsed = parseNumber(text);
  return parsed.kind === 'number' && !Number.isInteger(parsed.value) ? { kind: 'invalid' } : parsed;
}

/**
 * A duration typed in minutes (`12.5`), stored in whole seconds (750): the unit the project keeps
 * (`durationOverride`, seconds). Negative is invalid.
 */
export function parseMinutes(text: string): { readonly kind: 'empty' } | { readonly kind: 'seconds'; readonly seconds: number } | { readonly kind: 'invalid' } {
  const parsed = parseNumber(text);
  if (parsed.kind === 'empty') return parsed;
  if (parsed.kind === 'invalid' || parsed.value < 0) return { kind: 'invalid' };
  return { kind: 'seconds', seconds: Math.round(parsed.value * 60) };
}

/** Seconds as the minutes field shows them: `750` → `12.5`, `45` → `0.75`. */
export function minutesText(seconds: number): string {
  const minutes = seconds / 60;
  return String(Math.round(minutes * 1000) / 1000);
}

/** Quest ids separated by commas or spaces (`123, 456 -2`); empty is an empty list. Null when one is not a whole number other than 0. */
export function parseIdList(text: string): readonly number[] | null {
  const parts = text
    .split(/[\s,]+/)
    .map((part) => part.trim())
    .filter((part) => part !== '');
  const ids: number[] = [];
  for (const part of parts) {
    const parsed = parseWhole(part);
    if (parsed.kind !== 'number' || parsed.value === 0 || !Number.isSafeInteger(parsed.value)) return null;
    if (!ids.includes(parsed.value)) ids.push(parsed.value);
  }
  return ids;
}

/** A list of words separated by commas (`RFC, WC`), trimmed, without empties or repeats. */
export function parseWordList(text: string): readonly string[] {
  const words: string[] = [];
  for (const part of text.split(',')) {
    const word = part.trim();
    if (word !== '' && !words.includes(word)) words.push(word);
  }
  return words;
}
