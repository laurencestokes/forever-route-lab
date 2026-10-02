// @vitest-environment happy-dom
/**
 * The visual system's guarantees (docs/UI.md §2.1, §3, §4, §9), checked against the stylesheets
 * themselves. A cross-module test: it reads src/ui CSS from disk and imports the rules module's
 * DIFFICULTY_COLORS directly, which a ui file may not do (ARCHITECTURE §4).
 *
 * 1. Tokens (src/ui/styles/tokens.css): the block layout, the two identical dark blocks, the same
 *    names in light and dark, the reserved difficulty values, WCAG AA for every documented pair,
 *    hue separation between the reserved and semantic signals, and the row height.
 * 2. Stylesheet rules that carry an accessibility guarantee, evaluated in happy-dom where it can
 *    compute them (containing blocks and scrolling, media features) and read from the parsed CSS
 *    where it cannot (system colours, pseudo-elements).
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { cleanup, render } from '@testing-library/react';
import { createElement, type ReactElement } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { DIFFICULTIES, DIFFICULTY_COLORS } from '../src/rules';
import { DifficultyLabel } from '../src/ui/markers/DifficultyLabel';
import { ReadoutValue } from '../src/ui/markers/ReadoutValue';
import { unknownReadout } from '../src/ui/lib/readout';
import { Button } from '../src/ui/primitives/Button';
import { ROUTE_ACTIVE_ROW_EXTRA, ROUTE_ROW_HEIGHT, ROUTE_ROW_HEIGHT_TWO_LINE } from '../src/ui/route/virtual';
import { AppShell } from '../src/ui/shell/AppShell';
import { StatusBar, type StatusBarProps } from '../src/ui/shell/StatusBar';
import { Tabs } from '../src/ui/shell/Tabs';
import { XpBar } from '../src/ui/shell/XpBar';
import { SimulationStatus } from '../src/ui/shell/SimulationStatus';
import { PALETTE_SOURCES, paletteFrom } from '../src/map/leaflet/style';

const UI_DIR = join(import.meta.dirname, '..', 'src', 'ui');
const readCss = (path: string): string => readFileSync(join(UI_DIR, path), 'utf8').replace(/\r\n/g, '\n');

// =============================================================================================
// A small CSS reader: enough for our own stylesheets (no strings containing braces).

interface CssRule {
  /** The enclosing at-rule preludes, outermost first, e.g. `['@media (forced-colors: active)']`. */
  readonly atRules: readonly string[];
  /** Normalised selector list, e.g. `:root, [data-theme='light']`. */
  readonly selector: string;
  readonly declarations: ReadonlyMap<string, string>;
}

const normaliseSelector = (selector: string): string =>
  selector
    .replace(/\s+/g, ' ')
    .replace(/\s*,\s*/g, ', ')
    .trim();

function parseDeclarations(body: string): Map<string, string> {
  const out = new Map<string, string>();
  let depth = 0;
  let current = '';
  const flush = () => {
    const colon = current.indexOf(':');
    if (colon > 0) out.set(current.slice(0, colon).trim(), current.slice(colon + 1).trim().replace(/\s+/g, ' '));
    current = '';
  };
  for (const ch of body) {
    if (ch === '(') depth += 1;
    if (ch === ')') depth -= 1;
    if (ch === ';' && depth === 0) flush();
    else current += ch;
  }
  flush();
  return out;
}

function parseCss(text: string, atRules: readonly string[] = []): CssRule[] {
  const source = text.replace(/\/\*[\s\S]*?\*\//g, '');
  const rules: CssRule[] = [];
  let i = 0;
  while (i < source.length) {
    const open = source.indexOf('{', i);
    if (open === -1) break;
    const prelude = source.slice(i, open).replace(/^[\s;]+/, '').trim();
    let depth = 1;
    let close = open + 1;
    for (; close < source.length && depth > 0; close += 1) {
      if (source[close] === '{') depth += 1;
      if (source[close] === '}') depth -= 1;
    }
    const body = source.slice(open + 1, close - 1);
    if (prelude.startsWith('@media') || prelude.startsWith('@container') || prelude.startsWith('@supports')) {
      rules.push(...parseCss(body, [...atRules, prelude.replace(/\s+/g, ' ')]));
    } else if (!prelude.startsWith('@')) {
      rules.push({ atRules, selector: normaliseSelector(prelude), declarations: parseDeclarations(body) });
    }
    i = close;
  }
  return rules;
}

/** The declarations of `selector` (exactly, as one rule) inside the given at-rules. */
function declarationsOf(rules: readonly CssRule[], selector: string, atRules: readonly string[] = []): ReadonlyMap<string, string> {
  const found = rules.filter((rule) => rule.selector === normaliseSelector(selector) && rule.atRules.join(' | ') === atRules.join(' | '));
  const merged = new Map<string, string>();
  for (const rule of found) for (const [name, value] of rule.declarations) merged.set(name, value);
  return merged;
}

/** Rules whose selector list contains `selector` as one of its members. */
function rulesContaining(rules: readonly CssRule[], selector: string, atRules: readonly string[] = []): readonly CssRule[] {
  const wanted = normaliseSelector(selector);
  return rules.filter(
    (rule) => rule.atRules.join(' | ') === atRules.join(' | ') && rule.selector.split(', ').includes(wanted),
  );
}

// =============================================================================================
// Colour arithmetic (WCAG 2.2 relative luminance and contrast; HSL hue).

interface Rgba {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly a: number;
}

function parseColour(value: string): Rgba {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value);
  if (hex !== null) {
    const digits = hex[1] ?? '';
    const full = digits.length === 3 ? [...digits].map((d) => d + d).join('') : digits;
    return { r: parseInt(full.slice(0, 2), 16), g: parseInt(full.slice(2, 4), 16), b: parseInt(full.slice(4, 6), 16), a: 1 };
  }
  const rgb = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)\s*(?:[/,]\s*([\d.]+))?\s*\)$/.exec(value);
  if (rgb !== null) return { r: Number(rgb[1]), g: Number(rgb[2]), b: Number(rgb[3]), a: rgb[4] === undefined ? 1 : Number(rgb[4]) };
  throw new Error(`not a colour this test understands: ${value}`);
}

/** `fg` painted over an opaque `bg`. */
const composite = (fg: Rgba, bg: Rgba): Rgba => ({
  r: fg.r * fg.a + bg.r * (1 - fg.a),
  g: fg.g * fg.a + bg.g * (1 - fg.a),
  b: fg.b * fg.a + bg.b * (1 - fg.a),
  a: 1,
});

const channel = (c: number): number => {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};
const luminance = (c: Rgba): number => 0.2126 * channel(c.r) + 0.7152 * channel(c.g) + 0.0722 * channel(c.b);

function contrast(fg: Rgba, bg: Rgba): number {
  const a = luminance(composite(fg, bg));
  const b = luminance(bg);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/** HSL hue in degrees, or null for a grey. */
function hue(c: Rgba): number | null {
  const r = c.r / 255;
  const g = c.g / 255;
  const b = c.b / 255;
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  if (d === 0) return null;
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (h * 60 + 360) % 360;
}

const hueDistance = (a: number, b: number): number => {
  const d = Math.abs(a - b) % 360;
  return Math.min(d, 360 - d);
};

// =============================================================================================
// 1. Tokens

const TOKENS = parseCss(readCss('styles/tokens.css'));
const LIGHT_SELECTOR = ":root, [data-theme='light']";
const DARK_MEDIA = '@media (prefers-color-scheme: dark)';
const DARK_MEDIA_SELECTOR = ":root:not([data-theme='light'])";
const DARK_FORCED_SELECTOR = "[data-theme='dark']";

const customProperties = (declarations: ReadonlyMap<string, string>): Map<string, string> =>
  new Map([...declarations].filter(([name]) => name.startsWith('--')));

const SHARED = customProperties(declarationsOf(TOKENS, ':root'));
const LIGHT = customProperties(declarationsOf(TOKENS, LIGHT_SELECTOR));
const DARK_MEDIA_BLOCK = declarationsOf(TOKENS, DARK_MEDIA_SELECTOR, [DARK_MEDIA]);
const DARK_FORCED_BLOCK = declarationsOf(TOKENS, DARK_FORCED_SELECTOR);
const DARK = customProperties(DARK_FORCED_BLOCK);

type ThemeName = 'light' | 'dark';
const THEMES: Readonly<Record<ThemeName, ReadonlyMap<string, string>>> = {
  light: new Map([...SHARED, ...LIGHT]),
  dark: new Map([...SHARED, ...DARK]),
};

function tokenColour(theme: ThemeName, name: string, seen: readonly string[] = []): Rgba {
  const value = THEMES[theme].get(`--frl-${name}`);
  if (value === undefined) throw new Error(`--frl-${name} is not defined in the ${theme} theme`);
  const ref = /^var\(--frl-([\w-]+)\)$/.exec(value);
  if (ref?.[1] !== undefined) {
    if (seen.includes(ref[1])) throw new Error(`--frl-${name} refers to itself`);
    return tokenColour(theme, ref[1], [...seen, name]);
  }
  return parseColour(value);
}

describe('tokens.css layout', () => {
  it('has exactly the four documented blocks', () => {
    expect(TOKENS.map((rule) => [rule.atRules.join(' '), rule.selector])).toEqual([
      ['', ':root'],
      ['', LIGHT_SELECTOR],
      [DARK_MEDIA, DARK_MEDIA_SELECTOR],
      ['', DARK_FORCED_SELECTOR],
    ]);
  });

  it('keeps the two dark blocks identical', () => {
    expect([...DARK_MEDIA_BLOCK]).toEqual([...DARK_FORCED_BLOCK]);
    expect(DARK_FORCED_BLOCK.get('color-scheme')).toBe('dark');
    expect(declarationsOf(TOKENS, LIGHT_SELECTOR).get('color-scheme')).toBe('light');
  });

  it('defines the same token names in light and dark', () => {
    expect([...LIGHT.keys()].sort()).toEqual([...DARK.keys()].sort());
    expect(LIGHT.size).toBeGreaterThan(30);
  });

  it('never lets a theme redefine a theme-independent token', () => {
    const themed = new Set([...LIGHT.keys(), ...DARK.keys()]);
    expect([...SHARED.keys()].filter((name) => themed.has(name))).toEqual([]);
  });

  it('keeps --frl-row-height equal to ROUTE_ROW_HEIGHT (the virtualiser relies on it)', () => {
    expect(SHARED.get('--frl-row-height')).toBe(`${String(ROUTE_ROW_HEIGHT)}px`);
  });

  it('sizes controls, tabs, marks and two-line rows as the UI refresh does (ui-refresh.md §5.1, §6.1, §7.1)', () => {
    // 28 and 24px controls: WCAG 2.2 target size (2.5.8) without relying on spacing.
    expect(SHARED.get('--frl-control-height')).toBe('28px');
    expect(SHARED.get('--frl-control-height-sm')).toBe('24px');
    expect(SHARED.get('--frl-tab-height')).toBe('36px');
    expect(SHARED.get('--frl-radius-control')).toBe('6px');
    expect(SHARED.get('--frl-mark-size')).toBe('22px');
    expect(SHARED.get('--frl-mark-size-compact')).toBe('18px');
    // The two-line density (B+, D-051): the virtualiser's ROUTE_ROW_HEIGHT_TWO_LINE, 44px, and the
    // active row's one fixed extra, 32px, which the CSS moves the later rows by.
    expect(SHARED.get('--frl-row-height-two-line')).toBe(`${String(ROUTE_ROW_HEIGHT_TWO_LINE)}px`);
    expect(SHARED.get('--frl-row-height-two-line')).toBe('44px');
    expect(SHARED.get('--frl-row-grow')).toBe(`${String(ROUTE_ACTIVE_ROW_EXTRA)}px`);
    expect(SHARED.get('--frl-row-grow')).toBe('32px');
    // What moves the rows after the grown one (virtual.ts `rowTop`): one sibling rule on the grown
    // two-line step row, by the token. RouteList renders only rows between its first and last option
    // (RouteList.test), so this rule and the DOM order put every row where the virtualiser says.
    const routeCss = readCss('route/RouteList.css').replace(/\/\*[\s\S]*?\*\//g, '');
    const shift = /\.frl-row--two-line\.frl-steprow\.is-grown\s*~\s*\.frl-row\s*\{([^}]*)\}/.exec(routeCss);
    expect(shift?.[1]?.replace(/\s+/g, ' ').trim()).toBe('transform: translateY(var(--frl-row-grow));');
    // Nothing else moves or transforms a row.
    expect(routeCss.match(/translateY\(var\(--frl-row-grow\)\)/g)).toHaveLength(1);
    // A sm control fits the 32px status bar with room for the 2px ring and its 1px offset.
    const px = (name: string) => Number.parseFloat(SHARED.get(name) ?? 'NaN');
    expect(px('--frl-statusbar-height') - px('--frl-control-height-sm')).toBeGreaterThanOrEqual(2 * 3);
  });
});

describe('reserved difficulty colours', () => {
  it('equal DIFFICULTY_COLORS in src/rules/difficulty.ts', () => {
    for (const difficulty of DIFFICULTIES) {
      expect(SHARED.get(`--frl-difficulty-${difficulty}`)?.toLowerCase(), difficulty).toBe(DIFFICULTY_COLORS[difficulty].toLowerCase());
    }
  });

  it('are theme-independent, and the only other difficulty tokens are the chip parts', () => {
    const names = [...SHARED.keys(), ...LIGHT.keys()].filter((name) => name.startsWith('--frl-difficulty-')).sort();
    expect(names).toEqual(
      [
        ...DIFFICULTIES.map((d) => `--frl-difficulty-${d}`),
        '--frl-difficulty-pip-off',
        '--frl-difficulty-unknown',
        '--frl-difficulty-well',
        '--frl-difficulty-well-border',
      ].sort(),
    );
    for (const difficulty of DIFFICULTIES) expect(LIGHT.has(`--frl-difficulty-${difficulty}`)).toBe(false);
  });
});

/**
 * Every foreground a component draws on a background, per theme (docs/UI.md §9 rule 1). Text
 * needs 4.5:1; edges, rings, bars, meters, pips and hatching need 3:1.
 */
interface ContrastPair {
  readonly fg: string;
  readonly bg: string;
  readonly min: 4.5 | 3;
  readonly use: string;
}

const ROW_AND_PANEL_BACKGROUNDS = ['surface', 'surface-raised', 'surface-hover', 'selection-bg'] as const;
/** The route rows' states (ui-refresh.md §9.5): the surface, the hover, the selection and the band under the later steps. */
const ROW_STATES = ['surface', 'surface-hover', 'selection-bg', 'surface-later'] as const;
const TEXT_TOKENS = ['fg', 'fg-muted', 'fg-subtle', 'assumed', 'accent', 'severity-error', 'severity-warning', 'severity-info', 'forever'] as const;
/** The default button's fill at rest and on hover (ui-refresh.md §7.1). */
const TILES = ['tile', 'tile-hover'] as const;

const CONTRAST_PAIRS: readonly ContrastPair[] = [
  // Text and glyphs on panels, bars and rows (plain, hovered, selected).
  ...TEXT_TOKENS.flatMap((fg) =>
    ROW_AND_PANEL_BACKGROUNDS.map((bg): ContrastPair => ({ fg, bg, min: 4.5, use: 'text on panels, bars and rows' })),
  ),
  { fg: 'fg', bg: 'surface-sunken', min: 4.5, use: 'map area text' },
  { fg: 'fg-muted', bg: 'surface-sunken', min: 4.5, use: 'map area text' },
  { fg: 'accent-hover', bg: 'surface', min: 4.5, use: 'hovered links' },
  { fg: 'accent-fg', bg: 'accent', min: 4.5, use: 'primary buttons' },
  { fg: 'accent-fg', bg: 'accent-hover', min: 4.5, use: 'hovered primary buttons' },
  { fg: 'forever', bg: 'forever-bg', min: 4.5, use: 'full provenance badge' },
  ...[...DIFFICULTIES, 'unknown'].map((d): ContrastPair => ({ fg: `difficulty-${d}`, bg: 'difficulty-well', min: 4.5, use: 'difficulty level text' })),
  // Pips: each lit pip against an unlit one (the count is the non-colour cue).
  ...DIFFICULTIES.map((d): ContrastPair => ({ fg: `difficulty-${d}`, bg: 'difficulty-pip-off', min: 3, use: 'lit against unlit pips' })),
  // A two-line row's pips under its mark, in ink (B+, D-051): lit against unlit, and lit on every row state.
  { fg: 'fg-muted', bg: 'border', min: 3, use: 'lit against unlit pips under a route row mark' },
  ...ROW_STATES.map((bg): ContrastPair => ({ fg: 'fg-muted', bg, min: 3, use: 'lit pips under a route row mark' })),
  // Control edges, including the dashed edge of the uncertain difficulty chip, which sits on every
  // row background and shows the well in its gaps.
  ...[...ROW_AND_PANEL_BACKGROUNDS, 'surface-sunken', 'difficulty-well'].map(
    (bg): ContrastPair => ({ fg: 'border-strong', bg, min: 3, use: 'control edges and the uncertain chip edge' }),
  ),
  ...[...ROW_AND_PANEL_BACKGROUNDS, 'surface-sunken'].map((bg): ContrastPair => ({ fg: 'focus', bg, min: 3, use: 'focus ring' })),
  // Zone frames are the only geography on the schematic map (WCAG 1.4.11, M3 review MAP-A11Y-6):
  // stroked at full opacity on the map area, and over the frames' faint surface fill where they stack.
  { fg: 'map-frame', bg: 'surface-sunken', min: 3, use: 'zone frame outlines on the map' },
  { fg: 'map-frame', bg: 'surface', min: 3, use: 'zone frame outlines over stacked frame fills' },
  // Frames over the atlas tiles (map-atlas.md §8.8): the Zephras Isle card and the city cards on
  // the deep sea and the coastal water; the card's caption is text over the deep sea (with a halo).
  // --frl-map-frame itself cannot also reach 3:1 on both sea colours while it keeps 3:1 on the
  // light surfaces (it would need a relative luminance of at least 0.64 and at most 0.27).
  { fg: 'map-frame-atlas', bg: 'map-sea-deep', min: 4.5, use: 'inset and city card frames and captions over the deep sea' },
  { fg: 'map-frame-atlas', bg: 'map-sea-coast', min: 3, use: 'inset and city card frames over the coastal water' },
  { fg: 'selection-bar', bg: 'selection-bg', min: 3, use: 'selected-row bar' },
  { fg: 'accent', bg: 'surface-raised', min: 3, use: 'selected-tab bar' },
  { fg: 'drop-indicator', bg: 'surface', min: 3, use: 'drop line' },
  { fg: 'drop-indicator', bg: 'selection-bg', min: 3, use: 'drop line over selected rows' },
  // Meters.
  { fg: 'xp-fill', bg: 'xp-track', min: 3, use: 'XP fill' },
  { fg: 'accent', bg: 'xp-track', min: 3, use: 'optimiser progress fill' },
  { fg: 'fg', bg: 'xp-track', min: 3, use: 'lower-bound notch against the track beyond it' },
  { fg: 'unknown-hatch', bg: 'xp-track', min: 3, use: 'unknown XP hatching; indeterminate progress under reduced motion' },
  // The UI refresh's kit and rows (ui-refresh.md §9.5; D-048). Buttons: text and icons on the tile at
  // rest and on hover; the edge at rest on the tile and on every panel, and the hover edge (the muted
  // ink) on the hover tile (review UR-02); the focus ring on both tiles.
  ...TILES.flatMap((bg): ContrastPair[] => [
    { fg: 'fg', bg, min: 4.5, use: 'button text' },
    { fg: 'fg-muted', bg, min: 4.5, use: 'button icons, step-disc glyphs' },
    { fg: 'focus', bg, min: 3, use: 'focus ring on a button' },
  ]),
  ...['tile', 'surface', 'surface-raised'].map((bg): ContrastPair => ({ fg: 'border-strong', bg, min: 3, use: 'button edge at rest' })),
  { fg: 'fg-muted', bg: 'tile-hover', min: 3, use: 'button edge on hover (UR-02)' },
  // Danger buttons: the error hue's text and edge on the panels and on their hover fill.
  // (A danger button's hover is its own fill, never the tile's hover.)
  ...['surface', 'surface-raised', 'tile', 'danger-bg-hover'].map((bg): ContrastPair => ({ fg: 'danger', bg, min: 4.5, use: 'danger button text and edge' })),
  // The route rows on all four states, the later band included (decision B): every text colour, the
  // hollow and dashed rings and badge rims, and the insertion line.
  ...TEXT_TOKENS.map((fg): ContrastPair => ({ fg, bg: 'surface-later', min: 4.5, use: 'text on the later band' })),
  ...ROW_STATES.map((bg): ContrastPair => ({ fg: 'border-strong', bg, min: 3, use: 'hollow and dashed mark rings, badge rims' })),
  ...ROW_STATES.map((bg): ContrastPair => ({ fg: 'drop-indicator', bg, min: 3, use: 'the insertion line' })),
  // The filled quest mark (ui-refresh.md §5.1): the well glyph on the disc of each difficulty colour,
  // the same pair as the chip's text on its well (4.75 to 17.46:1).
  ...[...DIFFICULTIES, 'unknown'].map((d): ContrastPair => ({ fg: 'difficulty-well', bg: `difficulty-${d}`, min: 4.5, use: 'the "!" or "?" on a filled disc' })),
];

describe('WCAG AA contrast', () => {
  for (const theme of ['light', 'dark'] as const) {
    it(`meets the documented minimum for every pair in the ${theme} theme`, () => {
      const failures = CONTRAST_PAIRS.map((pair) => ({ pair, ratio: contrast(tokenColour(theme, pair.fg), tokenColour(theme, pair.bg)) }))
        .filter(({ pair, ratio }) => ratio < pair.min)
        .map(({ pair, ratio }) => `${pair.fg} on ${pair.bg}: ${ratio.toFixed(2)} < ${String(pair.min)} (${pair.use})`);
      expect(failures).toEqual([]);
    });
  }

  for (const theme of ['light', 'dark'] as const) {
    it(`keeps every filled disc's silhouette at 3:1 on every row state: the well keyline or the disc itself (${theme})`, () => {
      // In the light theme the keyline carries it (difficulty yellow is 1.07:1 on white); in the dark
      // theme the disc does (ui-refresh.md §5.1, §9.5).
      const failures: string[] = [];
      for (const d of [...DIFFICULTIES, 'unknown']) {
        for (const row of ROW_STATES) {
          const bg = tokenColour(theme, row);
          const silhouette = Math.max(contrast(tokenColour(theme, `difficulty-${d}`), bg), contrast(tokenColour(theme, 'difficulty-well'), bg));
          if (silhouette < 3) failures.push(`${d} on ${row}: ${silhouette.toFixed(2)}`);
        }
      }
      expect(failures).toEqual([]);
    });
  }

  // Review UI-06: the dark band was 1.07:1 and the light hover 1.04:1 on the band. The row hover
  // (--frl-row-hover) must show over both backgrounds a row sits on, the plain panel and the band.
  for (const theme of ['light', 'dark'] as const) {
    it(`shows the later band and a hovered row on it, with every row pair still passing (${theme}; review UI-06)`, () => {
      const surface = tokenColour(theme, 'surface');
      const band = tokenColour(theme, 'surface-later');
      if (theme === 'dark') expect(contrast(band, surface)).toBeGreaterThanOrEqual(1.15);
      const hover = tokenColour(theme, 'row-hover');
      const failures: string[] = [];
      for (const [name, base] of [['surface', surface], ['surface-later', band]] as const) {
        const hovered = composite(hover, base);
        const distinct = contrast(hovered, base);
        if (distinct < 1.08) failures.push(`hover on ${name}: ${distinct.toFixed(3)} < 1.08`);
        for (const fg of TEXT_TOKENS) {
          const ratio = contrast(tokenColour(theme, fg), hovered);
          if (ratio < 4.5) failures.push(`${fg} on hovered ${name}: ${ratio.toFixed(2)}`);
        }
        for (const fg of ['border-strong', 'drop-indicator', 'focus']) {
          const ratio = contrast(tokenColour(theme, fg), hovered);
          if (ratio < 3) failures.push(`${fg} on hovered ${name}: ${ratio.toFixed(2)}`);
        }
        for (const d of [...DIFFICULTIES, 'unknown']) {
          const silhouette = Math.max(contrast(tokenColour(theme, `difficulty-${d}`), hovered), contrast(tokenColour(theme, 'difficulty-well'), hovered));
          if (silhouette < 3) failures.push(`${d} disc on hovered ${name}: ${silhouette.toFixed(2)}`);
        }
      }
      expect(failures).toEqual([]);
    });
  }

  it('keeps the report-only pairs decorative and faint (the tile, the later band, the XP ticks)', () => {
    for (const theme of ['light', 'dark'] as const) {
      // The tile reads as filled but its edge carries the shape (ui-refresh.md §9.5: 1.20 to 1.30:1).
      const tile = contrast(tokenColour(theme, 'tile'), tokenColour(theme, 'surface'));
      expect(tile, theme).toBeGreaterThan(1.1);
      expect(tile, theme).toBeLessThan(1.5);
      // The later band is decorative: the insertion line carries the boundary.
      expect(contrast(tokenColour(theme, 'surface-later'), tokenColour(theme, 'surface')), theme).toBeLessThan(1.3);
      // The ticks are drawn over the fill; the numbers carry the value.
      expect(contrast(tokenColour(theme, 'xp-tick'), tokenColour(theme, 'xp-fill')), theme).toBeGreaterThan(1.5);
    }
  });

  it('computes ratios the WCAG way', () => {
    const black = parseColour('#000');
    const white = parseColour('#ffffff');
    expect(contrast(black, white)).toBeCloseTo(21, 5);
    expect(contrast(white, white)).toBe(1);
    expect(contrast(parseColour('#767676'), white)).toBeCloseTo(4.54, 2);
    // Alpha colours are painted over the background first.
    expect(contrast(parseColour('rgb(0 0 0 / 0)'), white)).toBe(1);
  });
});

describe('hue separation', () => {
  const chromaticDifficulties = DIFFICULTIES.filter((d) => d !== 'trivial');

  it('keeps trivial grey achromatic, so only the other four hues need distance', () => {
    expect(hue(tokenColour('light', 'difficulty-trivial'))).toBeNull();
    for (const d of chromaticDifficulties) expect(hue(tokenColour('light', `difficulty-${d}`)), d).not.toBeNull();
  });

  for (const theme of ['light', 'dark'] as const) {
    it(`keeps severity, accent and provenance at least 30° from every difficulty hue (${theme})`, () => {
      const near: string[] = [];
      for (const token of ['severity-error', 'severity-warning', 'severity-info', 'danger', 'accent', 'forever']) {
        const h = hue(tokenColour(theme, token));
        if (h === null) throw new Error(`${token} is grey`);
        for (const d of chromaticDifficulties) {
          const dh = hue(tokenColour(theme, `difficulty-${d}`)) ?? 0;
          if (hueDistance(h, dh) < 30) near.push(`${token} vs ${d}: ${hueDistance(h, dh).toFixed(1)}°`);
        }
      }
      expect(near).toEqual([]);
    });

    it(`keeps severity, accent and XP at least 25° from the provenance cyan (${theme})`, () => {
      const cyan = hue(tokenColour(theme, 'forever')) ?? 0;
      const near = ['severity-error', 'severity-warning', 'severity-info', 'danger', 'accent', 'xp-fill']
        .map((token) => ({ token, distance: hueDistance(hue(tokenColour(theme, token)) ?? cyan, cyan) }))
        .filter(({ distance }) => distance < 25)
        .map(({ token, distance }) => `${token}: ${distance.toFixed(1)}°`);
      expect(near).toEqual([]);
    });
  }
});

describe('warm neutrals (D-048 E; ui-refresh.md §9.5)', () => {
  const SURFACES = ['bg', 'surface', 'surface-raised', 'surface-hover', 'surface-sunken', 'surface-later', 'tile'] as const;

  for (const theme of ['light', 'dark'] as const) {
    it(`keeps the surfaces neutral: channels within 6%, a warm hue, never parchment or gold (${theme})`, () => {
      for (const name of SURFACES) {
        const c = tokenColour(theme, name);
        const spread = Math.max(c.r, c.g, c.b) - Math.min(c.r, c.g, c.b);
        expect(spread / 255, `${name}: ${String(spread)}`).toBeLessThanOrEqual(0.06);
        const h = hue(c);
        if (h !== null) {
          expect(h, name).toBeGreaterThanOrEqual(30);
          expect(h, name).toBeLessThanOrEqual(45);
        }
      }
    });
  }

  it('changes the neutrals only: the accent, severity, danger, difficulty and provenance values stay', () => {
    const light = THEMES.light;
    const dark = THEMES.dark;
    expect([light.get('--frl-accent'), light.get('--frl-severity-error'), light.get('--frl-forever'), light.get('--frl-selection-bg')]).toEqual(['#3a4fc4', '#b0157f', '#006d7d', '#e3e8fb']);
    expect([dark.get('--frl-accent'), dark.get('--frl-severity-error'), dark.get('--frl-forever'), dark.get('--frl-selection-bg')]).toEqual(['#8ea2ff', '#ff7ac8', '#3ccfe0', '#1f2a52']);
    // Destructive and error share one hue and one meaning (ui-refresh.md §7.1).
    for (const theme of [light, dark]) expect(theme.get('--frl-danger')).toBe(theme.get('--frl-severity-error'));
  });
});

describe('token references', () => {
  const cssFiles = readdirSync(UI_DIR, { recursive: true, encoding: 'utf8' })
    .map((path) => path.split('\\').join('/'))
    .filter((path) => path.endsWith('.css'));
  const sources = cssFiles.map((path) => ({ path, text: readCss(path) }));
  // Tokens, plus the few component-local custom properties (--frl-row-bg and the like).
  const defined = new Set(sources.flatMap(({ text }) => [...text.matchAll(/(--frl-[\w-]+)\s*:/g)].map((m) => m[1] ?? '')));

  it('finds the stylesheets', () => {
    expect(cssFiles).toContain('styles/tokens.css');
    expect(cssFiles.length).toBeGreaterThan(8);
  });

  it('lets only DifficultyLabel and the components built on its rating read the reserved difficulty colours (UI.md §4)', () => {
    // The allowlist (ui-refresh.md §16, review R4): the chip (.frl-difficulty--*) and the quest mark's
    // disc (.frl-quest-mark--*, QuestMark.tsx), both in markers/markers.css. The map's pins read them
    // through their own palette (src/map/leaflet), not through a ui stylesheet.
    const reserved = new RegExp(`var\\(--frl-difficulty-(${DIFFICULTIES.join('|')})\\)`);
    const readers = sources.flatMap(({ path, text }) =>
      parseCss(text)
        .filter((rule) => [...rule.declarations.values()].some((value) => reserved.test(value)))
        .map((rule) => `${path}: ${rule.selector}`),
    );
    expect(readers.length).toBe(2 * DIFFICULTIES.length);
    for (const reader of readers) expect(reader).toMatch(/^markers\/markers\.css: \.frl-(difficulty|quest-mark)--(trivial|standard|difficult|verydifficult|impossible)$/);
    // No component draws them from a style attribute.
    const components = readdirSync(UI_DIR, { recursive: true, encoding: 'utf8' })
      .map((path) => path.split('\\').join('/'))
      .filter((path) => path.endsWith('.tsx') && !path.endsWith('.test.tsx'));
    expect(components.filter((path) => /var\(--frl-difficulty-/.test(readFileSync(join(UI_DIR, path), 'utf8')))).toEqual([]);
  });

  it('uses no custom property that is not defined anywhere', () => {
    const missing = sources.flatMap(({ path, text }) =>
      [...text.matchAll(/var\((--frl-[\w-]+)/g)].map((m) => m[1] ?? '').filter((name) => !defined.has(name)).map((name) => `${path}: ${name}`),
    );
    expect(missing).toEqual([]);
  });
});

// =============================================================================================
// 1b. The map presentation's tokens (docs/research/map-presentation.md §25.5, §25.6; step MP.2)

/** CIE L*a*b* (D65) of an opaque sRGB colour. */
function lab(c: Rgba): readonly [number, number, number] {
  const [r, g, b] = [channel(c.r), channel(c.g), channel(c.b)];
  const x = (0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / 0.95047;
  const y = 0.2126729 * r + 0.7151522 * g + 0.072175 * b;
  const z = (0.0193339 * r + 0.119192 * g + 0.9503041 * b) / 1.08883;
  const f = (t: number): number => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
}

/** The CIEDE2000 colour difference (Sharma, Wu and Dalal 2005), as §12.4 and §25.5 measure distances. */
function ciede2000(one: Rgba, two: Rgba): number {
  const [l1, a1, b1] = lab(one);
  const [l2, a2, b2] = lab(two);
  const rad = Math.PI / 180;
  const c1 = Math.hypot(a1, b1);
  const c2 = Math.hypot(a2, b2);
  const cBar = (c1 + c2) / 2;
  const g = 0.5 * (1 - Math.sqrt(cBar ** 7 / (cBar ** 7 + 25 ** 7)));
  const ap1 = (1 + g) * a1;
  const ap2 = (1 + g) * a2;
  const cp1 = Math.hypot(ap1, b1);
  const cp2 = Math.hypot(ap2, b2);
  const hue = (bb: number, ap: number): number => (bb === 0 && ap === 0 ? 0 : (Math.atan2(bb, ap) / rad + 360) % 360);
  const hp1 = hue(b1, ap1);
  const hp2 = hue(b2, ap2);
  const dL = l2 - l1;
  const dC = cp2 - cp1;
  let dh = 0;
  if (cp1 * cp2 !== 0) dh = Math.abs(hp2 - hp1) <= 180 ? hp2 - hp1 : hp2 - hp1 > 180 ? hp2 - hp1 - 360 : hp2 - hp1 + 360;
  const dH = 2 * Math.sqrt(cp1 * cp2) * Math.sin((dh / 2) * rad);
  const lBar = (l1 + l2) / 2;
  const cpBar = (cp1 + cp2) / 2;
  let hBar = hp1 + hp2;
  if (cp1 * cp2 !== 0) hBar = Math.abs(hp1 - hp2) <= 180 ? (hp1 + hp2) / 2 : hp1 + hp2 < 360 ? (hp1 + hp2 + 360) / 2 : (hp1 + hp2 - 360) / 2;
  const t = 1 - 0.17 * Math.cos((hBar - 30) * rad) + 0.24 * Math.cos(2 * hBar * rad) + 0.32 * Math.cos((3 * hBar + 6) * rad) - 0.2 * Math.cos((4 * hBar - 63) * rad);
  const sl = 1 + (0.015 * (lBar - 50) ** 2) / Math.sqrt(20 + (lBar - 50) ** 2);
  const sc = 1 + 0.045 * cpBar;
  const sh = 1 + 0.015 * cpBar * t;
  const rt = -2 * Math.sqrt(cpBar ** 7 / (cpBar ** 7 + 25 ** 7)) * Math.sin(60 * Math.exp(-(((hBar - 275) / 25) ** 2)) * rad);
  return Math.sqrt((dL / sl) ** 2 + (dC / sc) ** 2 + (dH / sh) ** 2 + rt * (dC / sc) * (dH / sh));
}

/** The contrast of `fg` drawn on a translucent halo painted over an opaque base (labels, lines and rings on their halo, §25.6). */
const onHalo = (fg: Rgba, halo: Rgba, base: Rgba): number => contrast(fg, composite(halo, base));

const BLACK: Rgba = { r: 0, g: 0, b: 0, a: 1 };
const WHITE: Rgba = { r: 255, g: 255, b: 255, a: 1 };

describe('map presentation tokens (map-presentation.md §25.5, §25.6; D-047)', () => {
  const both = ['light', 'dark'] as const;

  it('keeps the pin and minimap tokens theme-independent, and the painted style’s label halo and the hatching in both themes', () => {
    for (const name of ['map-pin', 'map-pin-glyph', 'map-minimap-ink', 'map-minimap-ink-muted', 'map-minimap-halo', 'map-minimap-route', 'map-sea-navy', 'map-drawer-width']) {
      expect(SHARED.has(`--frl-${name}`), name).toBe(true);
    }
    for (const name of ['map-label-halo', 'map-hatch']) {
      expect(LIGHT.has(`--frl-${name}`), name).toBe(true);
      expect(DARK.has(`--frl-${name}`), name).toBe(true);
    }
    expect(SHARED.get('--frl-map-drawer-width')).toBe('300px');
    // Revision 2's plate tokens were removed before they were built (§25.5).
    for (const name of ['map-plate', 'map-plate-glyph', 'map-plate-edge']) expect(THEMES.light.has(`--frl-${name}`), name).toBe(false);
  });

  it('makes the pin body the difficulty well, so every difficulty colour keeps its chip contrast on a pin and on its pip tag', () => {
    expect(SHARED.get('--frl-map-pin')).toBe(SHARED.get('--frl-difficulty-well'));
    for (const d of [...DIFFICULTIES, 'unknown']) expect(contrast(tokenColour('light', `difficulty-${d}`), tokenColour('light', 'map-pin')), d).toBeGreaterThanOrEqual(4.5);
  });

  it('keeps the pin’s two tones 16.75:1 apart either way, the glyph achromatic and the body near-neutral', () => {
    const pin = tokenColour('light', 'map-pin');
    const glyph = tokenColour('light', 'map-pin-glyph');
    expect(contrast(glyph, pin)).toBeCloseTo(16.75, 1);
    expect(contrast(pin, glyph)).toBeCloseTo(16.75, 1);
    expect(hue(glyph)).toBeNull();
    // The two-tone floor (§25.6): whichever tone is farther from a base reaches 4.09:1 against it.
    let floor = Infinity;
    for (let v = 0; v <= 255; v += 1) {
      const base = { r: v, g: v, b: v, a: 1 };
      floor = Math.min(floor, Math.max(contrast(pin, base), contrast(glyph, base)));
    }
    expect(floor).toBeGreaterThanOrEqual(4.08);
  });

  it('keeps the minimap ink set readable on its halo over any base, painted over black and over white', () => {
    const halo = tokenColour('light', 'map-minimap-halo');
    for (const base of [BLACK, WHITE]) {
      expect(onHalo(tokenColour('light', 'map-minimap-ink'), halo, base)).toBeGreaterThanOrEqual(11.5);
      expect(onHalo(tokenColour('light', 'map-minimap-ink-muted'), halo, base)).toBeGreaterThanOrEqual(3);
      // The route line and the selection ring on the halo laid both sides of them (§25.2.3): 5.43:1 or more.
      expect(onHalo(tokenColour('light', 'map-minimap-route'), halo, base)).toBeGreaterThanOrEqual(5.4);
    }
    // The route colour is the dark theme's accent (§25.5).
    expect(tokenColour('light', 'map-minimap-route')).toEqual(tokenColour('dark', 'accent'));
  });

  for (const theme of both) {
    it(`keeps the painted style’s text and selection ring readable on the label halo over any base (${theme})`, () => {
      const halo = tokenColour(theme, 'map-label-halo');
      for (const base of [BLACK, WHITE]) {
        expect(onHalo(tokenColour(theme, 'fg'), halo, base)).toBeGreaterThanOrEqual(4.5);
        // The ring is the style's route colour, the theme's accent (a ring needs 3:1): 4.79:1 over
        // black in the light theme by this arithmetic (the design's contrast.mjs rounds to 4.81).
        expect(onHalo(tokenColour(theme, 'accent'), halo, base)).toBeGreaterThanOrEqual(4.5);
      }
    });
  }

  for (const theme of both) {
    it(`keeps the new hues at least 30° from every difficulty hue and 25° from the provenance cyan (${theme})`, () => {
      const cyan = hue(tokenColour(theme, 'forever')) ?? 0;
      const near: string[] = [];
      for (const token of ['map-pin', 'map-minimap-ink-muted', 'map-minimap-route', 'map-sea-navy']) {
        const h = hue(tokenColour(theme, token));
        if (h === null) continue;
        for (const d of DIFFICULTIES.filter((x) => x !== 'trivial')) {
          const dh = hue(tokenColour(theme, `difficulty-${d}`)) ?? 0;
          if (hueDistance(h, dh) < 30) near.push(`${token} vs ${d}: ${hueDistance(h, dh).toFixed(1)}°`);
        }
        if (hueDistance(h, cyan) < 25) near.push(`${token} vs cyan: ${hueDistance(h, cyan).toFixed(1)}°`);
      }
      expect(near).toEqual([]);
      expect(hue(tokenColour(theme, 'map-minimap-ink'))).toBeNull();
    });
  }

  it('keeps the navy sea at least 15 (CIEDE2000) from both cyan tokens, and the card frame, its caption and the zone frame readable on it', () => {
    const navy = tokenColour('light', 'map-sea-navy');
    expect(ciede2000(navy, tokenColour('light', 'forever'))).toBeGreaterThanOrEqual(15);
    expect(ciede2000(navy, tokenColour('dark', 'forever'))).toBeGreaterThanOrEqual(15);
    // The design's figures for the candidate: 30.2 and 65.7.
    expect(ciede2000(navy, tokenColour('light', 'forever'))).toBeCloseTo(30.2, 0);
    expect(ciede2000(navy, tokenColour('dark', 'forever'))).toBeCloseTo(65.7, 0);
    // The Zephras Isle card's frame and caption over the navy (map-atlas.md §8.8, §19.4).
    expect(contrast(tokenColour('light', 'map-frame-atlas'), navy)).toBeGreaterThanOrEqual(4.5);
    // The zone frame (role `frame`, which the minimap style keeps) over the navy container where no tile is drawn, in both themes (step MM.7).
    expect(contrast(tokenColour('light', 'map-frame'), navy)).toBeGreaterThanOrEqual(3);
    expect(contrast(tokenColour('dark', 'map-frame'), navy)).toBeGreaterThanOrEqual(3);
    // The minimap index's sea colour is this token (public/maps/minimap/index.json: [13, 27, 48]).
    expect([navy.r, navy.g, navy.b]).toEqual([13, 27, 48]);
  });

  it('points the minimap style’s palette roles only at the minimap ink set, the pin tones and the navy (src/map/leaflet/map.css)', () => {
    const mapCss = readFileSync(join(import.meta.dirname, '..', 'src', 'map', 'leaflet', 'map.css'), 'utf8').replace(/\r\n/g, '\n');
    const block = declarationsOf(parseCss(mapCss), ".frl-map[data-map-style='minimap']");
    expect(block.size).toBeGreaterThan(10);
    const roles = new Set(Object.keys(PALETTE_SOURCES).map((role) => `--frl-map-${role.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`));
    const resolved = new Map<string, string>();
    for (const [name, value] of block) {
      // Every property is a palette role the adapter reads.
      expect(roles.has(name), name).toBe(true);
      const ref = /^var\(--frl-([\w-]+)\)$/.exec(value);
      if (ref?.[1] !== undefined) {
        expect(/^map-(minimap-|pin|sea-navy)/.test(ref[1]), `${name}: ${value}`).toBe(true);
        const colour = tokenColour('light', ref[1]);
        resolved.set(name, `rgb(${String(colour.r)} ${String(colour.g)} ${String(colour.b)} / ${String(colour.a)})`);
      } else {
        expect(value, name).toMatch(/^rgb\(/);
        resolved.set(name, value);
      }
    }
    // The palette the adapter reads there: labels in the minimap ink on its halo, the route in its colour.
    const palette = paletteFrom((property) => resolved.get(property) ?? THEMES.light.get(property) ?? '');
    expect(palette.labelInk).toBe('rgb(242 242 242 / 1)');
    expect(palette.labelHalo).toBe('rgb(13 13 13 / 0.85)');
    expect(palette.route).toBe('rgb(142 162 255 / 1)');
    // No role takes a reserved colour: no difficulty token and no provenance cyan.
    const reserved = [...DIFFICULTIES.map((d) => tokenColour('light', `difficulty-${d}`)), tokenColour('light', 'forever'), tokenColour('dark', 'forever')];
    for (const value of Object.values(palette as unknown as Readonly<Record<string, string>>)) {
      if (!value.startsWith('rgb') && !value.startsWith('#')) continue;
      const colour = parseColour(value);
      expect(reserved.some((r) => r.r === colour.r && r.g === colour.g && r.b === colour.b), value).toBe(false);
    }
  });

  it('computes CIEDE2000 as the reference pairs give it', () => {
    // Sharma, Wu and Dalal (2005), table 1, pair 1 in sRGB terms: identical colours are 0 apart.
    expect(ciede2000(WHITE, WHITE)).toBe(0);
    expect(ciede2000(BLACK, WHITE)).toBeCloseTo(100, 0);
  });
});

// =============================================================================================
// 2. Stylesheet rules with accessibility guarantees

interface HappyDomControl {
  setViewport(viewport: { width: number; height: number }): void;
  readonly settings: { readonly device: { forcedColors: 'none' | 'active'; prefersReducedMotion: 'no-preference' | 'reduce' } };
}
const happyDOM = (window as unknown as { happyDOM: HappyDomControl }).happyDOM;

const COMPONENT_CSS = [
  'styles/tokens.css',
  'styles/base.css',
  'primitives/primitives.css',
  'markers/markers.css',
  'route/RouteList.css',
  'shell/AppShell.css',
  'shell/Tabs.css',
  'shell/SidePanel.css',
  'shell/StatusBar.css',
  'shell/MapPlaceholder.css',
  'shell/MapFrame.css',
  'shell/MapCategoryDrawer.css',
] as const;
const PARSED = new Map(COMPONENT_CSS.map((path) => [path, parseCss(readCss(path))]));
const rulesOf = (path: (typeof COMPONENT_CSS)[number]): readonly CssRule[] => PARSED.get(path) ?? [];

/**
 * Sets the viewport and media features, then loads the stylesheets and renders `tree`. Settings
 * come first so happy-dom computes styles against them from the start.
 */
function mount(
  tree: ReactElement,
  { width = 1366, height = 657, forcedColors = false, reducedMotion = false }: { width?: number; height?: number; forcedColors?: boolean; reducedMotion?: boolean } = {},
) {
  happyDOM.setViewport({ width, height });
  happyDOM.settings.device.forcedColors = forcedColors ? 'active' : 'none';
  happyDOM.settings.device.prefersReducedMotion = reducedMotion ? 'reduce' : 'no-preference';
  for (const path of COMPONENT_CSS) {
    const style = document.createElement('style');
    style.dataset.source = path;
    style.textContent = readCss(path);
    document.head.append(style);
  }
  return render(tree);
}

afterEach(() => {
  cleanup();
  for (const style of document.head.querySelectorAll('style[data-source]')) style.remove();
  happyDOM.settings.device.forcedColors = 'none';
  happyDOM.settings.device.prefersReducedMotion = 'no-preference';
});

const computed = (el: Element | null): CSSStyleDeclaration => {
  if (el === null) throw new Error('element not rendered');
  return getComputedStyle(el);
};

/** The nearest ancestor that is a containing block for an absolutely positioned element, or null (the initial one). */
function containingBlock(el: Element): Element | null {
  for (let node = el.parentElement; node !== null; node = node.parentElement) {
    if (computed(node).position !== 'static' && computed(node).position !== '') return node;
  }
  return null;
}

const XP_UNKNOWN = { level: 1, xp: null, xpToNext: null, lowerBound: true, unknownReason: 'Simulation arrives in Milestone 6' } as const;
const XP_KNOWN = { level: 12, xp: 3400, xpToNext: 9800, lowerBound: false } as const;

function statusBar(optimizer: StatusBarProps['optimizer']): ReactElement {
  return createElement(StatusBar, {
    xp: XP_UNKNOWN,
    currentStep: null,
    duration: unknownReadout<number>('Simulation arrives in Milestone 6'),
    xpPerHour: unknownReadout<number>('Simulation arrives in Milestone 6'),
    optimizer,
    data: { label: 'none', detail: 'Placeholder data', placeholder: true },
    ruleset: { label: 'placeholder', detail: 'Placeholder ruleset', eraFallback: true },
  });
}

/** The shell with visually hidden text in every area, as the real panels have. */
function shellWithHiddenText(): ReactElement {
  const hidden = (key: string) =>
    createElement(ReadoutValue<number>, { key, readout: unknownReadout<number>(`reason in ${key}`), format: String });
  const details = createElement(Tabs<'details'>, {
    label: 'Side panel',
    tabs: [{ id: 'details', label: 'Details' }],
    selectedId: 'details',
    onSelect: () => undefined,
    children: createElement(
      'div',
      { style: { height: '2000px' } },
      createElement(DifficultyLabel, { level: 12, difficulty: 'standard', uncertain: true }),
      hidden('details'),
    ),
  });
  return createElement(AppShell, {
    top: hidden('top'),
    left: hidden('left'),
    centre: hidden('centre'),
    right: details,
    bottom: statusBar({ state: 'idle' }),
  });
}

describe('the page never scrolls behind the shell (F-02)', () => {
  it('gives every shell area and the tab panel a containing block, so hidden text cannot escape', () => {
    const { container } = mount(shellWithHiddenText());
    for (const area of ['top', 'left', 'centre', 'right', 'bottom']) {
      expect(computed(container.querySelector(`.frl-shell__${area}`)).position, area).toBe('relative');
    }
    const panel = container.querySelector('.frl-tabs__panel');
    expect(computed(panel).position).toBe('relative');
    const hidden = [...container.querySelectorAll('.frl-visually-hidden')];
    expect(hidden.length).toBeGreaterThan(5);
    for (const el of hidden) {
      const block = containingBlock(el);
      // Never the initial containing block (which would lengthen the document) …
      expect(block, el.textContent).not.toBeNull();
      expect(block?.closest('.frl-shell__top, .frl-shell__left, .frl-shell__centre, .frl-shell__right, .frl-shell__bottom')).not.toBeNull();
    }
    // … and text inside the side panel stays inside its scroll container.
    for (const el of panel?.querySelectorAll('.frl-visually-hidden') ?? []) expect(panel?.contains(containingBlock(el))).toBe(true);
  });

  it('keeps the map’s stacking inside the centre, so the handles and splitters over its edges take the pointer', () => {
    // Leaflet's panes are z-index 400 and up, and the map frame's container query does not make a
    // stacking context; without one on the centre, the map was drawn over the handles (UR.5, seen in
    // a browser: happy-dom does not paint).
    const shell = rulesOf('shell/AppShell.css');
    expect(declarationsOf(shell, '.frl-shell__centre').get('isolation')).toBe('isolate');
    for (const selector of ['.frl-shell__handle.frl-icon-button', '.frl-shell__resize']) {
      expect(declarationsOf(shell, selector).get('z-index'), selector).toBe('var(--frl-z-sticky)');
    }
  });

  it('lets only the shell scroll above 720px, and the page below it', () => {
    mount(shellWithHiddenText(), { width: 1366, height: 657 });
    expect(computed(document.documentElement).overflow).toBe('hidden');
    expect(computed(document.body).overflow).toBe('hidden');
    cleanup();
    for (const style of document.head.querySelectorAll('style[data-source]')) style.remove();
    const { container } = mount(shellWithHiddenText(), { width: 700, height: 657 });
    expect(computed(document.body).overflow).not.toBe('hidden');
    expect(computed(container.querySelector('.frl-shell')).overflow).toBe('visible');
  });
});

describe('unknown XP stays visible (F-04)', () => {
  const tree = () => createElement('div', null, createElement(XpBar, { ...XP_UNKNOWN, className: 'unknown' }), createElement(XpBar, { ...XP_KNOWN, className: 'known' }));

  it('keeps "XP ?" at every width, and drops only known numbers below 1180px', () => {
    const wide = mount(tree(), { width: 1366 });
    expect(computed(wide.container.querySelector('.unknown .frl-xpbar__text')).display).not.toBe('none');
    expect(computed(wide.container.querySelector('.known .frl-xpbar__text')).display).not.toBe('none');
    cleanup();
    const narrow = mount(tree(), { width: 1100 });
    const text = narrow.container.querySelector('.unknown .frl-xpbar__text');
    expect(text?.textContent).toBe('XP ?');
    expect(computed(text).display).not.toBe('none');
    expect(computed(narrow.container.querySelector('.known .frl-xpbar__text')).display).toBe('none');
  });

  it('hatches the unknown track with the 3:1 unknown hatch, behind a dashed edge', () => {
    const track = declarationsOf(rulesOf('shell/StatusBar.css'), '.frl-xpbar--unknown .frl-xpbar__track');
    expect(track.get('border-style')).toBe('dashed');
    expect(track.get('background')).toContain('var(--frl-unknown-hatch)');
    expect(track.get('background')).not.toContain('placeholder-stripe');
  });
});

describe('reduced motion never draws a fake partial fill (F-14)', () => {
  const running = () => statusBar({ state: 'running', progress: null, detail: null });

  it('slides a 40% bar when motion is allowed', () => {
    const { container } = mount(running());
    expect(computed(container.querySelector('.frl-statusbar__progress-fill.is-indeterminate')).width).toBe('40%');
  });

  it('draws the whole track hatched, without animation, under reduced motion', () => {
    const { container } = mount(running(), { reducedMotion: true });
    const fill = computed(container.querySelector('.frl-statusbar__progress-fill.is-indeterminate'));
    expect(fill.width).toBe('100%');
    expect(fill.left).toMatch(/^0(px)?$/);
    const rule = declarationsOf(rulesOf('shell/StatusBar.css'), '.frl-statusbar__progress-fill.is-indeterminate', ['@media (prefers-reduced-motion: reduce)']);
    expect(rule.get('animation')).toBe('none');
    expect(rule.get('background')).toContain('var(--frl-unknown-hatch)');
  });
});

describe('forced colours (Windows high contrast) keep every state visible (F-12)', () => {
  const FORCED = ['@media (forced-colors: active)'];

  it('keeps the difficulty chip in its own colours', () => {
    const { container } = mount(createElement(DifficultyLabel, { level: 12, difficulty: 'impossible' }), { forcedColors: true });
    expect(computed(container.querySelector('.frl-difficulty')).getPropertyValue('forced-color-adjust')).toBe('none');
  });

  it('keeps a filled quest mark in its own colours, as the chip beside it does, and lets a hollow one follow the system', () => {
    const rules = rulesContaining(rulesOf('markers/markers.css'), '.frl-quest-mark.is-filled', FORCED);
    expect(rules.map((rule) => rule.declarations.get('forced-color-adjust'))).toContain('none');
    expect(rulesContaining(rulesOf('markers/markers.css'), '.frl-quest-mark.is-hollow', FORCED)).toEqual([]);
  });

  it.each([
    ['route/RouteList.css', '.frl-row.is-selected::before', 'background', 'Highlight'],
    ['route/RouteList.css', '.frl-routelist__drop', 'background', 'Highlight'],
    ['shell/Tabs.css', '.frl-tabs__tab.is-selected::after', 'background', 'Highlight'],
    ['shell/SidePanel.css', '.frl-issues__item', 'border-left', '3px solid CanvasText'],
    ['shell/AppShell.css', '.frl-shell__resize:focus-visible::after', 'background', 'Highlight'],
    ['shell/StatusBar.css', '.frl-xpbar__fill', 'background', 'Highlight'],
    ['primitives/primitives.css', '.frl-icon-button.is-pressed', 'border-color', 'Highlight'],
    ['markers/markers.css', '.frl-severity-icon__mark', 'stroke', 'Canvas'],
    ['shell/StatusBar.css', '.frl-statusbar__progress', 'border', '1px solid CanvasText'],
    // The UI refresh's kit (ui-refresh.md §9.4): pressed and expanded buttons, the checked segment,
    // and the one primary per context, which keeps a 2px edge.
    ['primitives/primitives.css', ".frl-button[aria-pressed='true']", 'border', '2px solid Highlight'],
    ['primitives/primitives.css', ".frl-button[aria-expanded='true']", 'border', '2px solid Highlight'],
    ['primitives/primitives.css', '.frl-segmented__option.is-checked', 'outline', '2px solid Highlight'],
    ['primitives/primitives.css', '.frl-button--primary', 'border-width', '2px'],
    // Quest and step marks (ui-refresh.md §9.4): hollow rings, glyphs, badges and the pie in the
    // system ink, badges on Canvas; the step disc's edge and glyph in the system ink.
    ['markers/markers.css', '.frl-quest-mark.is-hollow .frl-quest-mark__disc', 'stroke', 'CanvasText'],
    ['markers/markers.css', '.frl-quest-mark__ring', 'stroke', 'CanvasText'],
    ['markers/markers.css', '.frl-quest-mark__pie-rim', 'stroke', 'CanvasText'],
    ['markers/markers.css', '.frl-quest-mark.is-hollow .frl-quest-mark__glyph .frl-quest-mark__fill', 'fill', 'CanvasText'],
    ['markers/markers.css', '.frl-quest-mark__badge-ink', 'fill', 'CanvasText'],
    ['markers/markers.css', '.frl-quest-mark__badge', 'fill', 'Canvas'],
    ['markers/markers.css', '.frl-step-mark', 'border-color', 'CanvasText'],
  ] as const)('%s: %s gets %s %s', (path, selector, property, value) => {
    const rules = rulesContaining(rulesOf(path), selector, FORCED);
    expect(rules.map((rule) => rule.declarations.get(property))).toContain(value);
  });

  it('draws unknown progress as a dashed empty track under forced colours with reduced motion (M6 review UI-15)', () => {
    const rules = rulesContaining(rulesOf('shell/StatusBar.css'), '.frl-statusbar__progress.is-indeterminate', ['@media (forced-colors: active) and (prefers-reduced-motion: reduce)']);
    expect(rules.map((rule) => rule.declarations.get('border-style'))).toContain('dashed');
  });

  it('draws the selected-row strip as a real box (a pseudo-element with content)', () => {
    const strip = declarationsOf(rulesOf('route/RouteList.css'), '.frl-row.is-selected::before', FORCED);
    expect(strip.get('content')).toBe("''");
    expect(strip.get('position')).toBe('absolute');
    expect(strip.get('width')).toBe('4px');
  });
});

describe('the status bar keeps the simulation item whole (M6 review UI-01, UI-02, UI-07)', () => {
  it('never shrinks or clips the simulation item, and the bar is no scroll container', () => {
    const { container } = mount(createElement(SimulationStatus, { status: { state: 'computing', done: 3, total: 8, detail: 'x' }, onCancel: () => undefined }));
    const item = computed(container.querySelector('.frl-statusbar__simulation'));
    expect(item.flexShrink).toBe('0');
    // Nothing clips the item or its focus ring (happy-dom reports an unset overflow as '').
    expect(['', 'visible']).toContain(item.overflow);
    for (const selector of ['.frl-statusbar__item', '.frl-statusbar__simulation']) expect(declarationsOf(rulesOf('shell/StatusBar.css'), selector).get('overflow')).toBeUndefined();
    const bar = declarationsOf(rulesOf('shell/StatusBar.css'), '.frl-statusbar');
    expect(bar.get('overflow-x')).toBe('clip');
    expect(bar.get('overflow-y')).toBe('visible');
  });

  it('lays the open summary out in the flow at 720px and below (UI-07)', () => {
    const panel = declarationsOf(rulesOf('shell/StatusBar.css'), '.frl-summary__panel', ['@media (max-width: 720px)']);
    expect(panel.get('position')).toBe('static');
  });
});

describe('buttons (F-18)', () => {
  it('keeps a disabled ghost button as edgeless as an enabled one', () => {
    const { container } = mount(
      createElement('div', null, createElement(Button, { variant: 'ghost', disabled: true }, 'Undo'), createElement(Button, { variant: 'ghost' }, 'Redo')),
    );
    const [disabled, enabled] = [...container.querySelectorAll('button')];
    expect(computed(disabled ?? null).borderTopColor).toBe(computed(enabled ?? null).borderTopColor);
    expect(computed(disabled ?? null).borderTopColor).toBe('transparent');
  });

  it('gives disabled secondary buttons the hairline edge', () => {
    const { container } = mount(createElement(Button, { variant: 'secondary', disabled: true }, 'Export'));
    expect(computed(container.querySelector('button')).borderTopColor).toBe(THEMES.light.get('--frl-border'));
  });

  it('fills the default button with the tile and a strong edge that takes the muted ink on hover (ui-refresh.md §7.1)', () => {
    const rules = rulesOf('primitives/primitives.css');
    const rest = declarationsOf(rules, '.frl-button');
    expect(rest.get('background')).toBe('var(--frl-tile)');
    expect(rest.get('border')).toBe('1px solid var(--frl-border-strong)');
    expect(rest.get('border-radius')).toBe('var(--frl-radius-control)');
    const hover = declarationsOf(rules, ".frl-button:hover:not(:disabled, [aria-disabled='true'])");
    expect(hover.get('background')).toBe('var(--frl-tile-hover)');
    expect(hover.get('border-color')).toBe('var(--frl-fg-muted)');
    // The alias draws as the default: no rule of its own.
    expect(rules.some((rule) => rule.selector.includes('frl-button--secondary'))).toBe(false);
    const { container } = mount(createElement(Button, { variant: 'secondary' }, 'Show all'));
    expect(computed(container.querySelector('button')).backgroundColor).toBe(THEMES.light.get('--frl-tile'));
  });

  it('draws pressed and expanded buttons with a doubled accent edge, not only a change of fill', () => {
    const pressed = declarationsOf(rulesOf('primitives/primitives.css'), ".frl-button[aria-pressed='true'], .frl-button[aria-expanded='true']");
    expect(pressed.get('border-color')).toBe('var(--frl-accent)');
    expect(pressed.get('box-shadow')).toBe('inset 0 0 0 1px var(--frl-accent)');
    expect(pressed.get('font-weight')).toBe('var(--frl-weight-bold)');
    expect(pressed.get('color')).toBe('var(--frl-accent)');
  });

  it('draws danger buttons in the danger hue on the surface', () => {
    const danger = declarationsOf(rulesOf('primitives/primitives.css'), '.frl-button--danger');
    expect(danger.get('color')).toBe('var(--frl-danger)');
    expect(danger.get('border-color')).toBe('var(--frl-danger)');
  });
});

describe('map frame (M3 review MAP-A11Y-6, MAP-A11Y-13)', () => {
  const NARROW = ['@container frl-mapframe (width < 560px)'];

  it('keeps a visible "Schematic" in a narrow panel instead of hiding the notice', () => {
    const rules = rulesOf('shell/MapFrame.css');
    expect(declarationsOf(rules, '.frl-mapframe__notice-short').get('display')).toBe('none');
    expect(declarationsOf(rules, '.frl-mapframe__notice-short', NARROW).get('display')).toBe('inline');
    // Only a notice that has a short form loses its long one, and the badge itself is never hidden.
    expect(declarationsOf(rules, '.frl-mapframe__notice.has-short .frl-mapframe__notice-long', NARROW).get('display')).toBe('none');
    expect(declarationsOf(rules, '.frl-mapframe__notice', NARROW).get('display')).toBeUndefined();
  });

  it('strokes the drawer’s zone border swatch with the map frame token, as the canvas does (step MP.4b)', () => {
    const rules = rulesOf('shell/MapCategoryDrawer.css');
    expect(declarationsOf(rules, ".frl-mapdrawer__icon[data-swatch='border']").get('color')).toBe('var(--frl-map-frame)');
    expect(THEMES.light.get('--frl-map-frame')).not.toBe(THEMES.light.get('--frl-border-strong'));
  });
});

describe('map placeholder (F-13)', () => {
  it('places the card and the layer stub in grid areas, not over each other', () => {
    const rules = rulesOf('shell/MapPlaceholder.css');
    const layers = declarationsOf(rules, '.frl-mapph__layers');
    expect(layers.get('position')).not.toBe('absolute');
    expect(layers.get('grid-area')).toBe('layers');
    expect(declarationsOf(rules, '.frl-mapph__card').get('grid-area')).toBe('card');
    const layout = declarationsOf(rules, '.frl-mapph__layout');
    expect(layout.get('display')).toBe('grid');
    // The stub's column is never narrower than the stub; the card's column gives way instead.
    expect(layout.get('grid-template-columns')).toBe('minmax(0, 1fr) minmax(0, 400px) minmax(max-content, 1fr)');
    expect(declarationsOf(rules, '.frl-mapph').get('overflow')).toBe('auto');
  });
});

// =============================================================================================
// 3. The UI review's fixes (fix-ui): rules that keep focus, controls and text visible

describe('fix-ui: focus rings, pressed looks, pop-ups and the map chrome (review UI, PR and QA findings)', () => {
  const extra = (path: string): readonly CssRule[] => parseCss(readCss(path));

  it('leaves room on all four sides for a quest name’s focus ring inside the box that clips the name (UI-02)', () => {
    const name = declarationsOf(rulesOf('shell/SidePanel.css'), '.frl-quest-item__name');
    // The ring is 2px at a 1px offset: 3px of room, taken back by a negative margin so nothing moves.
    expect(name.get('--frl-ring-room')).toBe('calc(var(--frl-focus-width) + 1px)');
    expect(name.get('padding')).toBe('var(--frl-ring-room)');
    expect(name.get('margin')).toBe('calc(-1 * var(--frl-ring-room))');
    expect(name.get('height')).toBe('calc(20px + 2 * var(--frl-ring-room))');
    expect(name.get('overflow')).toBe('hidden');
    // The button shrinks inside it, so a long name never pushes the ring's right side out.
    const open = declarationsOf(rulesOf('shell/SidePanel.css'), '.frl-quest-item__open');
    expect(open.get('min-width')).toBe('0');
    expect(open.get('max-width')).toBe('100%');
    expect(THEMES.light.get('--frl-focus-width') ?? SHARED.get('--frl-focus-width')).toBe('2px');
  });

  it('places View’s popup in the route header, inside the panel at every width (UI-03, QA-07)', () => {
    const rules = extra('app/RoutePanel.css');
    // No containing block of its own: the popup is placed in the header, which spans the panel.
    expect(declarationsOf(rules, '.frl-view').get('position')).toBeUndefined();
    expect(declarationsOf(rules, '.frl-app-route__head').get('position')).toBe('relative');
    const popup = declarationsOf(rules, '.frl-view__popup');
    expect(popup.get('right')).toBe('6px');
    expect(popup.get('width')).toBe('min(300px, calc(100% - 12px))');
    expect(popup.get('left')).toBeUndefined();
  });

  it('draws a pressed icon button with the doubled accent edge, as a pressed text button, in both variants (UI-09)', () => {
    const pressed = declarationsOf(rulesOf('primitives/primitives.css'), ".frl-icon-button.is-pressed, .frl-icon-button.is-pressed:hover:not(:disabled, [aria-disabled='true'])");
    expect(pressed.get('border-color')).toBe('var(--frl-accent)');
    expect(pressed.get('box-shadow')).toBe('inset 0 0 0 1px var(--frl-accent)');
    expect(pressed.get('background')).toBe('var(--frl-selection-bg)');
    const forced = declarationsOf(rulesOf('primitives/primitives.css'), '.frl-icon-button.is-pressed', ['@media (forced-colors: active)']);
    expect(forced.get('border-color')).toBe('Highlight');
    expect(forced.get('outline')).toBe('1px solid Highlight');
  });

  it('makes each segment a 24px target of its own (UI-14)', () => {
    expect(declarationsOf(rulesOf('primitives/primitives.css'), '.frl-segmented__option').get('height')).toBe('var(--frl-control-height-sm)');
    expect(SHARED.get('--frl-control-height-sm')).toBe('24px');
  });

  it('draws the map surface’s focus ring above Leaflet’s panes and under the floating controls, and lets presses through (QA-08)', () => {
    const ring = declarationsOf(rulesOf('shell/MapFrame.css'), '.frl-mapframe__stage:has(.leaflet-container:focus-visible)::after');
    expect(ring.get('outline')).toBe('var(--frl-focus-width) solid var(--frl-focus)');
    expect(ring.get('pointer-events')).toBe('none');
    const z = Number(ring.get('z-index'));
    // Leaflet's panes and controls reach 1000; the floating controls are 1150.
    expect(z).toBeGreaterThan(1000);
    expect(z).toBeLessThan(Number(declarationsOf(rulesOf('shell/MapFrame.css'), '.frl-mapframe__focus').get('z-index')));
  });

  it('keeps the popover above the floating controls and lets its body scroll (PR-07)', () => {
    const rules = extra('shell/MapPopover.css');
    const controls = Number(declarationsOf(rulesOf('shell/MapFrame.css'), '.frl-mapframe__view').get('z-index'));
    expect(Number(declarationsOf(rules, '.frl-map-popover').get('z-index'))).toBeGreaterThan(controls);
    const body = declarationsOf(rules, '.frl-map-popover__body');
    expect(body.get('min-height')).toBe('0');
    expect(body.get('overflow-y')).toBe('auto');
  });

  it('keeps the route panel’s handle off an open drawer, and the Viewing chip between Map layers and Map focus (PR-08, UI-10, QA-11, QA-13)', () => {
    const shell = rulesOf('shell/AppShell.css');
    expect(declarationsOf(shell, '.frl-shell:has(.frl-mapframe.is-drawer-open.is-docked) .frl-shell__handle--left.frl-icon-button').get('left')).toBe('var(--frl-map-drawer-width)');
    expect(declarationsOf(shell, '.frl-shell:has(.frl-mapframe.is-drawer-open.is-over) .frl-shell__handle--left.frl-icon-button').get('left')).toBe('min(var(--frl-map-drawer-width), 100% - 56px)');
    const frame = rulesOf('shell/MapFrame.css');
    expect(declarationsOf(frame, '.frl-mapframe__viewing').get('overflow')).toBe('hidden');
    expect(declarationsOf(frame, '.frl-mapframe.is-drawer-open.is-over .frl-mapframe__viewing').get('max-width')).toBe('calc(100% - var(--frl-map-drawer-width) - 52px - 52px)');
  });

  it('puts the side panel’s handle on its own top edge below 1024px, with a turned chevron (QA-21)', () => {
    const narrow = ['@media (max-width: 1024px)'];
    const handle = declarationsOf(rulesOf('shell/AppShell.css'), '.frl-shell__handle--right.frl-icon-button', narrow);
    expect(handle.get('top')).toBe('auto');
    expect(handle.get('bottom')).toBe('0');
    expect(handle.get('width')).toBe('44px');
    expect(handle.get('height')).toBe('18px');
    expect(declarationsOf(rulesOf('shell/AppShell.css'), '.frl-shell__handle--right.frl-icon-button :where(svg)', narrow).get('transform')).toBe('rotate(90deg)');
  });

  it('moves the caption beside a drawer over the map and lets it wrap there; clears the chrome off a narrow map’s open drawer (QA-12, QA-14)', () => {
    const frame = rulesOf('shell/MapFrame.css');
    const over = ['@container frl-mapframe (560px <= width < 900px)'];
    expect(declarationsOf(frame, '.frl-mapframe.is-drawer-open .frl-mapframe__caption', over).get('left')).toBe('calc(min(var(--frl-map-drawer-width), 100% - 56px) + 10px)');
    expect(declarationsOf(frame, '.frl-mapframe.is-drawer-open .frl-mapframe__caption-line, .frl-mapframe.is-drawer-open .frl-mapframe__hover', over).get('white-space')).toBe('normal');
    const narrow = ['@container frl-mapframe (width < 560px)'];
    const hidden = declarationsOf(
      frame,
      '.frl-mapframe.is-drawer-open .frl-mapframe__view, .frl-mapframe.is-drawer-open .frl-mapframe__viewing, .frl-mapframe.is-drawer-open .leaflet-bottom.leaflet-right',
      narrow,
    );
    expect(hidden.get('visibility')).toBe('hidden');
  });

  it('shows a drawer row’s notes as one muted line that opens in full on keyboard focus (PR-09)', () => {
    const rules = rulesOf('shell/MapCategoryDrawer.css');
    const first = declarationsOf(rules, '.frl-mapdrawer__note-first');
    expect(first.get('overflow')).toBe('hidden');
    expect(first.get('text-overflow')).toBe('ellipsis');
    expect(declarationsOf(rules, '.frl-mapdrawer__note-line').get('white-space')).toBe('nowrap');
    expect(declarationsOf(rules, '.frl-mapdrawer__note-all').get('display')).toBe('none');
    expect(declarationsOf(rules, '.frl-mapdrawer__notes.is-open .frl-mapdrawer__note-all, .frl-mapdrawer__row:has(input:focus-visible) .frl-mapdrawer__note-all').get('display')).toBe('flex');
  });
});
