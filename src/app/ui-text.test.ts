import { describe, expect, it } from 'vitest';
import fixture01 from '../../tests/fixtures/rxp/01-basic-durotar.txt?raw';
import fixture02 from '../../tests/fixtures/rxp/02-filters-and-step-tags.txt?raw';
import fixture04 from '../../tests/fixtures/rxp/04-edge-cases-crlf.txt?raw';
import { hasGuideEscapes, plainGuideText } from './ui-text';

/** The guide text after `>>`, `+` or `*` on the fixture line that contains `marker`. */
function textOn(fixture: string, marker: string): string {
  const line = fixture.split(/\r\n|\r|\n/).find((l) => l.includes(marker));
  if (line === undefined) throw new Error(`no line with ${marker}`);
  const at = line.indexOf('>>');
  return at >= 0 ? line.slice(at + 2) : line.trim().slice(1);
}

describe('plainGuideText', () => {
  it('removes RXP colour tokens and keeps their words (fixture 01)', () => {
    expect(plainGuideText(textOn(fixture01, 'Kaltunk|r'))).toBe('Talk to Kaltunk');
    expect(plainGuideText(textOn(fixture01, 'Gornek|r'))).toBe('Talk to Gornek in the Den');
    expect(plainGuideText(textOn(fixture01, 'Mottled Boars'))).toBe('Hunt Mottled Boars south-east of the Den');
    expect(plainGuideText(textOn(fixture01, 'Cactus Apples'))).toBe('Loot Scorpid Worker Tails and collect Cactus Apples while you travel');
  });

  it('reads a coloured warning line (fixture 02)', () => {
    expect(plainGuideText(textOn(fixture02, 'RXP_WARN_This guide'))).toBe('This guide was written for Orcs and Trolls');
    expect(plainGuideText(textOn(fixture02, 'Scorpid Workers'))).toBe('Keep an eye out for Scorpid Workers while questing');
  });

  it('handles the edge cases E24-E26 of fixture 04', () => {
    // E24: a star note's written line break.
    expect(plainGuideText(textOn(fixture04, 'First line'))).toBe('First line Second line');
    // E25: an RXP colour token and a texture escape.
    expect(plainGuideText(textOn(fixture04, 'RXP_WARN_Careful'))).toBe('Careful [Example]');
    // E26: non-ASCII text is kept as it is.
    const e26 = textOn(fixture04, 'bersetzung');
    expect(plainGuideText(e26)).toBe(e26.trim());
    expect(hasGuideEscapes(e26)).toBe(false);
  });

  it('removes hex colours, atlas icons and hyperlink data, and reads escaped pipes and |n', () => {
    expect(plainGuideText('|cFFfa9602Warning:|r stay |cff00ff00here|r')).toBe('Warning: stay here');
    expect(plainGuideText('|A:Dungeon:24:24|a Enter the dungeon')).toBe('Enter the dungeon');
    expect(plainGuideText('Buy |Hitem:2512:0|h[Rough Arrow]|h x200')).toBe('Buy [Rough Arrow] x200');
    expect(plainGuideText('a || b|nc')).toBe('a | b c');
    // Nested tokens, as translated guides write them.
    expect(plainGuideText('|cRXP_WARN_Ask |cRXP_FRIENDLY_Pixie|r here|r |Tinterface/icon.blp:20|t[Coin]')).toBe('Ask Pixie here [Coin]');
  });

  it('leaves unclosed or unknown escapes as written, and plain text alone', () => {
    expect(plainGuideText('Use |T without an end')).toBe('Use |T without an end');
    expect(plainGuideText('|cRXP_ not a token')).toBe('|cRXP_ not a token');
    expect(plainGuideText('Pipe | alone')).toBe('Pipe | alone');
    expect(plainGuideText('  Talk   to\tGornek ')).toBe('Talk to Gornek');
    expect(hasGuideEscapes('Talk to Gornek')).toBe(false);
    expect(hasGuideEscapes('Talk to |cRXP_FRIENDLY_Gornek|r')).toBe(true);
  });

  it('gives the same text when applied twice', () => {
    for (const text of [textOn(fixture01, 'Kaltunk|r'), textOn(fixture04, 'RXP_WARN_Careful'), 'a || b', 'Buy |Hitem:1|h[X]|h']) {
      expect(plainGuideText(plainGuideText(text))).toBe(plainGuideText(text));
    }
  });
});
