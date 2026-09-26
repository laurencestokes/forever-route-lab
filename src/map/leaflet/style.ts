import type {
  AggregateDescriptor,
  Emphasis,
  FrameDescriptor,
  LineStyle,
  MarkerBadge,
  MarkerDescriptor,
  MarkerKind,
  MarkerStyle,
} from '../adapter';

/**
 * Colours, line styles and glyph specs for the canvas (docs/MAPS.md §7, §8.1; docs/UI.md §3-§4).
 * No Leaflet import, so it runs in the node test environment.
 *
 * Canvas paths cannot use CSS variables, so the adapter reads the palette from the container's
 * computed style (`readMapPalette`): an optional `--frl-map-<role>` token first, then any shared
 * map token the role also takes (`--frl-map-frame` for the extent), then the UI kit token the role
 * maps to, then the light-theme default. `--frl-map-frame` (the zone-frame stroke, role `frame`)
 * is defined by the kit's tokens at 3:1 or more against `--frl-surface-sunken` in both themes
 * (WCAG 1.4.11), so frames are stroked at full opacity. Nothing uses the reserved difficulty
 * colours or the provenance cyan (UI.md §4). Nothing relies on colour alone either: every line
 * style has its own dash pattern and every marker kind its own shape.
 */

export interface MapPalette {
  /** Canvas font family for labels and counts. */
  readonly font: string;
  readonly grid: string;
  readonly gridLabel: string;
  readonly extent: string;
  readonly frame: string;
  readonly frameFill: string;
  readonly frameStrong: string;
  readonly frameLabel: string;
  /** Neutral markers (quest givers, turn-ins, flight masters). */
  readonly ink: string;
  /** Muted markers and badges. */
  readonly inkMuted: string;
  /** Step markers, transitions, halos. */
  readonly accent: string;
  /** The thin outline around every glyph, so it stands out on lines and frames. */
  readonly markerEdge: string;
  readonly route: string;
  readonly transport: string;
  readonly flight: string;
  readonly hearth: string;
  readonly highlight: string;
  readonly proposal: string;
  readonly aggregateFill: string;
  readonly aggregateEdge: string;
  readonly aggregateText: string;
}

export type PaletteRole = keyof MapPalette;

/**
 * Where each role comes from: shared map tokens it also takes (`also`, after `--frl-map-<role>`),
 * the UI kit token it falls back to, and the light-theme value (UI.md §3.1) when none is set.
 */
export interface PaletteSource {
  readonly token: string;
  readonly also?: readonly string[];
  readonly fallback: string;
}

export const PALETTE_SOURCES: Readonly<Record<PaletteRole, PaletteSource>> = {
  font: { token: '--frl-font-ui', fallback: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif' },
  grid: { token: '--frl-map-grid', fallback: 'rgba(20, 24, 30, 0.08)' },
  gridLabel: { token: '--frl-fg-subtle', fallback: '#5f6978' },
  extent: { token: '--frl-border-strong', also: ['--frl-map-frame'], fallback: '#737d8b' },
  // Role `frame` reads --frl-map-frame first (the role token), then the kit's strong border.
  frame: { token: '--frl-border-strong', fallback: '#737d8b' },
  frameFill: { token: '--frl-surface', fallback: '#ffffff' },
  frameStrong: { token: '--frl-accent', fallback: '#3a4fc4' },
  frameLabel: { token: '--frl-fg-muted', fallback: '#4b5563' },
  ink: { token: '--frl-fg', fallback: '#14181e' },
  inkMuted: { token: '--frl-fg-muted', fallback: '#4b5563' },
  accent: { token: '--frl-accent', fallback: '#3a4fc4' },
  markerEdge: { token: '--frl-surface', fallback: '#ffffff' },
  route: { token: '--frl-accent', fallback: '#3a4fc4' },
  transport: { token: '--frl-fg-muted', fallback: '#4b5563' },
  flight: { token: '--frl-accent', fallback: '#3a4fc4' },
  hearth: { token: '--frl-fg-muted', fallback: '#4b5563' },
  highlight: { token: '--frl-accent-hover', fallback: '#2e40a8' },
  proposal: { token: '--frl-fg', fallback: '#14181e' },
  aggregateFill: { token: '--frl-surface-raised', fallback: '#f5f6f8' },
  aggregateEdge: { token: '--frl-border-strong', fallback: '#737d8b' },
  aggregateText: { token: '--frl-fg', fallback: '#14181e' },
};

const ROLES = Object.keys(PALETTE_SOURCES) as PaletteRole[];

const kebab = (role: string): string => role.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);

/** The light-theme palette. */
export const DEFAULT_MAP_PALETTE: MapPalette = Object.fromEntries(ROLES.map((role) => [role, PALETTE_SOURCES[role].fallback])) as unknown as MapPalette;

/**
 * Builds a palette from custom-property lookups (`getComputedStyle(el).getPropertyValue`):
 * `--frl-map-<role>` (for example `--frl-map-route`), then the role's kit token, then the default.
 */
export function paletteFrom(lookup: (property: string) => string): MapPalette {
  const read = (property: string): string | null => {
    const value = lookup(property).trim();
    return value === '' ? null : value;
  };
  const resolve = (role: PaletteRole): string => {
    const source = PALETTE_SOURCES[role];
    for (const property of [`--frl-map-${kebab(role)}`, ...(source.also ?? []), source.token]) {
      const value = read(property);
      if (value !== null) return value;
    }
    return source.fallback;
  };
  return Object.fromEntries(ROLES.map((role) => [role, resolve(role)])) as unknown as MapPalette;
}

/** The palette under `element`, from its computed style (the adapter calls this at mount and on `refreshTheme`). */
export function readMapPalette(element: Element): MapPalette {
  const view = element.ownerDocument.defaultView;
  if (view === null) return DEFAULT_MAP_PALETTE;
  const style = view.getComputedStyle(element);
  return paletteFrom((property) => style.getPropertyValue(property));
}

// =============================================================================================
// Paths

/** Leaflet path options, as plain data. */
export interface PathStyle {
  readonly stroke: boolean;
  readonly color: string;
  readonly weight: number;
  readonly opacity: number;
  readonly fill: boolean;
  readonly fillColor: string;
  readonly fillOpacity: number;
  /** Canvas dash pattern in pixels; null for solid. */
  readonly dashArray: string | null;
  readonly lineCap: 'butt' | 'round' | 'square';
  readonly lineJoin: 'miter' | 'round' | 'bevel';
}

const EMPHASIS_ALPHA: Readonly<Record<Emphasis, number>> = { normal: 1, strong: 1, dim: 0.4 };

/**
 * Line styles. The dash pattern is the non-colour cue: route solid, transport dashed, flight
 * dotted, hearth dash-dot, proposal long dashes, highlight a thick solid line.
 */
const LINE_STYLES: Readonly<Record<LineStyle, { readonly role: PaletteRole; readonly weight: number; readonly dash: string | null; readonly cap: PathStyle['lineCap'] }>> = {
  route: { role: 'route', weight: 3, dash: null, cap: 'round' },
  transport: { role: 'transport', weight: 3, dash: '10 6', cap: 'butt' },
  flight: { role: 'flight', weight: 2.5, dash: '1 6', cap: 'round' },
  hearth: { role: 'hearth', weight: 2.5, dash: '12 5 2 5', cap: 'butt' },
  highlight: { role: 'highlight', weight: 6, dash: null, cap: 'round' },
  proposal: { role: 'proposal', weight: 3, dash: '14 7', cap: 'butt' },
};

export function polylineStyle(style: LineStyle, emphasis: Emphasis, palette: MapPalette): PathStyle {
  const spec = LINE_STYLES[style];
  const color = palette[spec.role];
  return {
    stroke: true,
    color,
    weight: emphasis === 'strong' ? spec.weight + 2 : spec.weight,
    opacity: (style === 'highlight' ? 0.85 : 0.9) * EMPHASIS_ALPHA[emphasis],
    fill: false,
    fillColor: color,
    fillOpacity: 0,
    dashArray: spec.dash,
    lineCap: spec.cap,
    lineJoin: 'round',
  };
}

/**
 * Zone frames: a hairline with a faint fill; the extent a dashed outline; `strong` in the accent
 * colour. Strokes are at full opacity: the frame token is chosen for 3:1 against the map
 * background, and a translucent stroke would fall below it (M3 review MAP-A11Y-6).
 */
export function frameStyle(kind: FrameDescriptor['kind'], emphasis: Emphasis, palette: MapPalette): PathStyle {
  if (kind === 'extent') {
    return {
      stroke: true,
      color: palette.extent,
      weight: 1,
      opacity: 1,
      fill: false,
      fillColor: palette.extent,
      fillOpacity: 0,
      dashArray: '6 4',
      lineCap: 'butt',
      lineJoin: 'miter',
    };
  }
  const strong = emphasis === 'strong';
  return {
    stroke: true,
    color: strong ? palette.frameStrong : palette.frame,
    weight: strong ? 2.5 : 1,
    opacity: EMPHASIS_ALPHA[emphasis],
    fill: true,
    fillColor: palette.frameFill,
    fillOpacity: strong ? 0.45 : 0.25,
    dashArray: null,
    lineCap: 'butt',
    lineJoin: 'miter',
  };
}

// =============================================================================================
// Glyphs

export type GlyphShape = MarkerKind | 'aggregate';

/** Everything `drawGlyph` needs, resolved to colours and pixels. */
export interface GlyphSpec {
  readonly shape: GlyphShape;
  /** Base radius in CSS pixels (half the glyph's extent). */
  readonly size: number;
  readonly fill: string | null;
  readonly stroke: string;
  readonly strokeWidth: number;
  readonly alpha: number;
  readonly badges: readonly MarkerBadge[];
  readonly badgeColor: string;
  readonly edge: string;
  /** Text drawn in the glyph (aggregate counts); null for none. */
  readonly text: string | null;
  /** The count badge of a merged stack (`2`…`9`, `9+`); null for a single item. */
  readonly stack: string | null;
  readonly textColor: string;
  readonly font: string;
}

const BASE_SIZE: Readonly<Record<GlyphShape, number>> = {
  step: 5.5,
  'quest-start': 6.5,
  'quest-end': 5.5,
  objective: 3.5,
  'flight-master': 6,
  transition: 6.5,
  halo: 11,
  aggregate: 9,
};

const STYLE_ROLE: Readonly<Record<MarkerStyle, PaletteRole>> = { neutral: 'ink', accent: 'accent', muted: 'inkMuted', proposal: 'proposal' };

const scaleFor = (emphasis: Emphasis): number => (emphasis === 'strong' ? 1.35 : 1);

export function markerGlyph(descriptor: MarkerDescriptor, palette: MapPalette, emphasis: Emphasis = descriptor.emphasis): GlyphSpec {
  const color = palette[STYLE_ROLE[descriptor.style]];
  const ring = descriptor.kind === 'halo' || descriptor.kind === 'transition';
  return {
    shape: descriptor.kind,
    size: BASE_SIZE[descriptor.kind] * scaleFor(emphasis),
    fill: descriptor.kind === 'halo' ? null : color,
    stroke: ring ? color : palette.markerEdge,
    strokeWidth: (ring ? 2.5 : 1.5) + (emphasis === 'strong' ? 0.5 : 0),
    alpha: EMPHASIS_ALPHA[emphasis],
    badges: descriptor.badges,
    badgeColor: palette.ink,
    edge: palette.markerEdge,
    text: null,
    stack: descriptor.count > 1 ? stackText(descriptor.count) : null,
    textColor: palette.ink,
    font: palette.font,
  };
}

/** A stack's count badge: one character up to 9, then `9+` (the hover label gives the exact number). */
export const stackText = (count: number): string => (count > 9 ? '9+' : String(count));

/** `37` → `37`, `4369` → `4.3k`, `12500` → `12k`: at most four characters, rounded down so a count is never overstated. */
export function compactCount(n: number): string {
  if (n < 1000) return String(n);
  if (n < 10000) return `${(Math.floor(n / 100) / 10).toFixed(1)}k`;
  return `${String(Math.floor(n / 1000))}k`;
}

export function aggregateGlyph(descriptor: AggregateDescriptor, palette: MapPalette, emphasis: Emphasis = descriptor.emphasis): GlyphSpec {
  const text = compactCount(descriptor.count);
  // Wide enough for the text at 11px (about 6.5px per character) plus padding.
  const size = Math.max(BASE_SIZE.aggregate, 3.4 * text.length + 5) * scaleFor(emphasis);
  return {
    shape: 'aggregate',
    size,
    fill: palette.aggregateFill,
    stroke: emphasis === 'strong' ? palette.accent : palette.aggregateEdge,
    strokeWidth: emphasis === 'strong' ? 2 : 1.5,
    alpha: EMPHASIS_ALPHA[emphasis],
    badges: [],
    badgeColor: palette.ink,
    edge: palette.markerEdge,
    text,
    stack: null,
    textColor: palette.aggregateText,
    font: palette.font,
  };
}

/** The pointer hit radius of a glyph: its extent plus a little slack. */
export const glyphHitRadius = (spec: GlyphSpec): number => spec.size + 2;

/** Radius of a stack's count badge, and how far its centre sits from the glyph's (times the size, plus a constant). */
export const STACK_BADGE_RADIUS = 5.5;
export const STACK_BADGE_OFFSET = { scale: 0.85, plus: 2.5 } as const;

/**
 * How far a glyph's paint reaches from its centre along either axis, badges and strokes included,
 * plus a pixel of anti-aliasing (glyphs.ts draws inside it). The marker's canvas bounds use it, so a
 * redraw that clears a glyph's area always redraws the whole glyph (M3 review PERF-13).
 */
export function glyphExtent(spec: GlyphSpec): number {
  const r = spec.size;
  const halfStroke = spec.strokeWidth / 2;
  let extent: number;
  switch (spec.shape) {
    case 'quest-start':
      extent = r * 1.15 + halfStroke;
      break;
    case 'quest-end':
      extent = r * 0.85 + halfStroke;
      break;
    case 'halo':
      extent = r + (spec.strokeWidth + 2) / 2;
      break;
    case 'step':
    case 'objective':
    case 'flight-master':
    case 'transition':
    case 'aggregate':
      extent = r + halfStroke;
      break;
  }
  for (const badge of spec.badges) {
    if (badge === 'instance') extent = Math.max(extent, r * 0.9 + 3);
    if (badge === 'off-frame') extent = Math.max(extent, r + 3.5);
    // The question mark starts 1 px right of the glyph and is about 6 px wide and 8 px tall.
    if (badge === 'leg-unknown') extent = Math.max(extent, r + 7.5);
  }
  if (spec.stack !== null) extent = Math.max(extent, r * STACK_BADGE_OFFSET.scale + STACK_BADGE_OFFSET.plus + STACK_BADGE_RADIUS + 0.5);
  return extent + 1;
}
