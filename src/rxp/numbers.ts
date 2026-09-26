/**
 * Number reading as RXP's arguments need it (docs/RXP.md §9.0, §9.4). RXP converts arguments
 * with Lua's number conversion, so `+5`, `.5`, `5.` and `1e3` read as numbers, and `5.5.5` does
 * not. Hexadecimal (`0x10`) is accepted as well. Infinity and NaN spellings are not numbers here
 * (what the WoW client's conversion does with them is not documented).
 */

const DECIMAL = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;
const HEX = /^([+-]?)0[xX]([0-9a-fA-F]+)$/;

/** The number an argument reads as, or null when RXP could not read it. */
export function parseLuaNumber(text: string): number | null {
  if (DECIMAL.test(text)) {
    const value = Number(text);
    return Number.isFinite(value) ? value : null;
  }
  const hex = HEX.exec(text);
  if (hex !== null) {
    const value = parseInt(hex[2] ?? '', 16);
    if (!Number.isFinite(value)) return null;
    return hex[1] === '-' ? -value : value;
  }
  return null;
}

/** An argument that reads as an integer (a quest, spell, item or area ID, a count), or null. */
export function parseLuaInteger(text: string): number | null {
  const value = parseLuaNumber(text);
  return value !== null && Number.isSafeInteger(value) ? value : null;
}

/** The level expression of `.xp` (§9.4). */
export interface XpExpression {
  /** `<` prefix: the condition is "below". */
  readonly below: boolean;
  readonly level: number;
  readonly offset:
    | { readonly kind: 'xpInto'; readonly xp: number }
    | { readonly kind: 'xpShort'; readonly xp: number }
    | { readonly kind: 'fraction'; readonly fraction: number; readonly digits: string }
    | null;
  /** Characters around the shape that RXP ignores (reported as `RXP004`, warning). */
  readonly extra: boolean;
}

const XP_SHAPE = /(<?)(\d+)(?:([+\-.])(\d+))?/;

/**
 * RXP removes every space, then uses the first place where the shape `[<]digits[(+|-|.)digits]`
 * occurs; characters before and after it are ignored. Null when the shape does not occur, or when
 * the route model cannot hold what it says (§9.4): a level or offset beyond the safe-integer range,
 * or a fraction whose digits round to 1.
 */
export function parseXpExpression(argument: string): XpExpression | null {
  const compact = argument.replace(/ /g, '');
  const match = XP_SHAPE.exec(compact);
  if (match === null) return null;
  const level = Number(match[2]);
  if (!Number.isSafeInteger(level)) return null;
  const operator = match[3];
  const digits = match[4];
  let offset: XpExpression['offset'] = null;
  if (operator !== undefined && digits !== undefined) {
    if (operator === '.') {
      const fraction = Number(`0.${digits}`);
      if (!(fraction < 1)) return null;
      offset = { kind: 'fraction', fraction, digits };
    } else {
      const xp = Number(digits);
      if (!Number.isSafeInteger(xp)) return null;
      offset = operator === '+' ? { kind: 'xpInto', xp } : { kind: 'xpShort', xp };
    }
  }
  return { below: match[1] === '<', level, offset, extra: match[0].length !== compact.length };
}
