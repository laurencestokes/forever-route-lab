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
import { ROUTE_ROW_HEIGHT } from '../src/ui/route/virtual';
import { AppShell } from '../src/ui/shell/AppShell';
import { StatusBar, type StatusBarProps } from '../src/ui/shell/StatusBar';
import { Tabs } from '../src/ui/shell/Tabs';
import { XpBar } from '../src/ui/shell/XpBar';

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
const TEXT_TOKENS = ['fg', 'fg-muted', 'fg-subtle', 'assumed', 'accent', 'severity-error', 'severity-warning', 'severity-info', 'forever'] as const;

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
  { fg: 'selection-bar', bg: 'selection-bg', min: 3, use: 'selected-row bar' },
  { fg: 'accent', bg: 'surface-raised', min: 3, use: 'selected-tab bar' },
  { fg: 'drop-indicator', bg: 'surface', min: 3, use: 'drop line' },
  { fg: 'drop-indicator', bg: 'selection-bg', min: 3, use: 'drop line over selected rows' },
  // Meters.
  { fg: 'xp-fill', bg: 'xp-track', min: 3, use: 'XP fill' },
  { fg: 'accent', bg: 'xp-track', min: 3, use: 'optimiser progress fill' },
  { fg: 'fg', bg: 'xp-track', min: 3, use: 'lower-bound notch against the track beyond it' },
  { fg: 'unknown-hatch', bg: 'xp-track', min: 3, use: 'unknown XP hatching; indeterminate progress under reduced motion' },
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
      for (const token of ['severity-error', 'severity-warning', 'severity-info', 'accent', 'forever']) {
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
      const near = ['severity-error', 'severity-warning', 'severity-info', 'accent', 'xp-fill']
        .map((token) => ({ token, distance: hueDistance(hue(tokenColour(theme, token)) ?? cyan, cyan) }))
        .filter(({ distance }) => distance < 25)
        .map(({ token, distance }) => `${token}: ${distance.toFixed(1)}°`);
      expect(near).toEqual([]);
    });
  }
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

  it('uses no custom property that is not defined anywhere', () => {
    const missing = sources.flatMap(({ path, text }) =>
      [...text.matchAll(/var\((--frl-[\w-]+)/g)].map((m) => m[1] ?? '').filter((name) => !defined.has(name)).map((name) => `${path}: ${name}`),
    );
    expect(missing).toEqual([]);
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
  'shell/MapLegend.css',
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

  it.each([
    ['route/RouteList.css', '.frl-row.is-selected::before', 'background', 'Highlight'],
    ['route/RouteList.css', '.frl-routelist__drop', 'background', 'Highlight'],
    ['shell/Tabs.css', '.frl-tabs__tab.is-selected::after', 'background', 'Highlight'],
    ['shell/SidePanel.css', '.frl-issues__item', 'border-left', '3px solid CanvasText'],
    ['shell/AppShell.css', '.frl-shell__resize:focus-visible::after', 'background', 'Highlight'],
    ['shell/StatusBar.css', '.frl-xpbar__fill', 'background', 'Highlight'],
    ['primitives/primitives.css', '.frl-icon-button.is-pressed', 'border-color', 'Highlight'],
    ['markers/markers.css', '.frl-severity-icon__mark', 'stroke', 'Canvas'],
  ] as const)('%s: %s gets %s %s', (path, selector, property, value) => {
    const rules = rulesContaining(rulesOf(path), selector, FORCED);
    expect(rules.map((rule) => rule.declarations.get(property))).toContain(value);
  });

  it('draws the selected-row strip as a real box (a pseudo-element with content)', () => {
    const strip = declarationsOf(rulesOf('route/RouteList.css'), '.frl-row.is-selected::before', FORCED);
    expect(strip.get('content')).toBe("''");
    expect(strip.get('position')).toBe('absolute');
    expect(strip.get('width')).toBe('4px');
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

  it('strokes the key’s frames with the map frame token, as the canvas does', () => {
    const rules = rulesOf('shell/MapLegend.css');
    expect(declarationsOf(rules, '.frl-mapglyph__frame').get('stroke')).toBe('var(--frl-map-frame)');
    expect(declarationsOf(rules, '.frl-mapglyph__extent').get('stroke')).toBe('var(--frl-map-frame)');
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
