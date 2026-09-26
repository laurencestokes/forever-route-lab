/**
 * Display helpers for text that comes from RestedXP guides (docs/RXP.md §12, row 32 of the
 * lowering table; ARCHITECTURE §10). Guide text carries the game client's escape sequences and
 * RXP's colour tokens, which the addon turns into colours and icons at run time:
 *
 * - `|cAARRGGBB` … `|r`: a colour, and `|cRXP_FRIENDLY_` … `|r` (any `RXP_<WORD>_` token): an RXP
 *   colour token that RXP replaces with a colour when the guide loads;
 * - `|T<texture>|t` and `|A<atlas>|a`: an inline icon;
 * - `|H<link>|h<text>|h`: a hyperlink (its visible text is kept);
 * - `|n` and, in `*` note lines, a written `\n`: a line break; `||`: a literal `|`.
 *
 * `plainGuideText` removes them for display: route rows and their spoken labels, Details, the map's
 * labels and announcements. It is never stored: the step keeps its text as written, so an unedited
 * guide still exports byte for byte (docs/RXP.md §13.3). Pure; no locale, no globals.
 */

const HEX_COLOUR = /^[0-9A-Fa-f]{8}/;
/** An RXP colour token after `|c`: `RXP_` and a word of letters, closed by `_` (`RXP_WARN_`). */
const RXP_COLOUR_TOKEN = /^RXP_[A-Za-z]+_/;
const SPACES = /\s+/g;

/**
 * The text as a one-line plain string: colour escapes and RXP colour tokens removed (their words
 * kept), inline textures and atlas icons removed, hyperlinks reduced to their text, line breaks
 * made spaces, runs of white space collapsed and the ends trimmed. An escape that is not closed
 * (a `|T` without its `|t`) is left as written: nothing is guessed away.
 */
export function plainGuideText(text: string): string {
  if (!text.includes('|') && !text.includes('\\n')) return text.replace(SPACES, ' ').trim();
  let out = '';
  let i = 0;
  while (i < text.length) {
    const char = text.charAt(i);
    if (char === '\\' && text.charAt(i + 1) === 'n') {
      out += ' ';
      i += 2;
      continue;
    }
    if (char !== '|') {
      out += char;
      i += 1;
      continue;
    }
    const code = text.charAt(i + 1);
    const rest = text.slice(i + 2);
    switch (code) {
      case '|':
        out += '|';
        i += 2;
        continue;
      case 'c': {
        const token = HEX_COLOUR.exec(rest) ?? RXP_COLOUR_TOKEN.exec(rest);
        if (token !== null) {
          i += 2 + token[0].length;
          continue;
        }
        break;
      }
      case 'r':
      case 'h':
        // The end of a colour, or the end of a hyperlink's visible text.
        i += 2;
        continue;
      case 'n':
        out += ' ';
        i += 2;
        continue;
      case 'T':
      case 'A':
      case 'H': {
        // An icon (|T…|t, |A…|a) is dropped; a link's data (|H…|h) is dropped and its text kept.
        const close = text.indexOf(code === 'T' ? '|t' : code === 'A' ? '|a' : '|h', i + 2);
        if (close >= 0) {
          i = close + 2;
          continue;
        }
        break;
      }
      default:
        break;
    }
    out += char;
    i += 1;
  }
  return out.replace(SPACES, ' ').trim();
}

/** Whether `plainGuideText` would change what is shown (other than white space). */
export function hasGuideEscapes(text: string): boolean {
  return plainGuideText(text) !== text.replace(SPACES, ' ').trim();
}
