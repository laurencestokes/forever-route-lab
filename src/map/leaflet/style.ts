import type {
  ZoneFillDescriptor,
  AggregateDescriptor,
  ConnectorDescriptor,
  Emphasis,
  FrameDescriptor,
  LineStyle,
  OutlineDescriptor,
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
  /**
   * Frames and captions over the atlas tiles (an inset's card, a city card): 3:1 or more against
   * both sea colours, the deep sea rgb(61, 55, 41) and the coastal water rgb(131, 118, 88), in both
   * themes (map-atlas.md §8.8); captions carry a halo in `frameAtlasHalo`.
   */
  readonly frameAtlas: string;
  readonly frameAtlasHalo: string;
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
  /** Terrain zone outlines (borders from the client's per-chunk areas, D-032). */
  readonly zoneOutline: string;
  /** The terrain coastline. */
  readonly coast: string;
  readonly aggregateFill: string;
  readonly aggregateEdge: string;
  readonly aggregateText: string;
  /**
   * The labels canvas (map-presentation.md §13.1, §25.4): names and step numbers in `labelInk` on a
   * 3 px `labelHalo`. In the painted style they follow the theme (`--frl-fg` on
   * `--frl-map-label-halo`); in the minimap style, whose base is dark in both themes, the map's
   * stylesheet points them at the minimap ink set (map.css, `data-map-style`).
   */
  readonly labelInk: string;
  readonly labelHalo: string;
  /**
   * The zone faction overlay's hatching (map-presentation.md §12.6, §25.4; `--frl-map-hatch`): black at
   * 35 % in the light theme, white at 35 % in the dark theme and in the minimap style. Never a hue.
   */
  readonly hatch: string;
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
  frameAtlas: { token: '--frl-map-frame-atlas', fallback: '#e8dfc8' },
  frameAtlasHalo: { token: '--frl-map-sea-deep', fallback: '#3d3729' },
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
  // Zone outlines take the zone frames' token (3:1 on the map background, WCAG 1.4.11).
  zoneOutline: { token: '--frl-border-strong', also: ['--frl-map-frame'], fallback: '#737d8b' },
  coast: { token: '--frl-fg-muted', fallback: '#4b5563' },
  aggregateFill: { token: '--frl-surface-raised', fallback: '#f5f6f8' },
  aggregateEdge: { token: '--frl-border-strong', fallback: '#737d8b' },
  aggregateText: { token: '--frl-fg', fallback: '#14181e' },
  // Role `labelHalo` reads --frl-map-label-halo first (the role token, tokens.css).
  labelInk: { token: '--frl-fg', fallback: '#14181e' },
  labelHalo: { token: '--frl-surface', fallback: 'rgba(255, 255, 255, 0.85)' },
  // Role `hatch` reads --frl-map-hatch (the role token, tokens.css; map.css points the minimap style at white).
  hatch: { token: '--frl-fg-subtle', fallback: 'rgba(0, 0, 0, 0.35)' },
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
 * dotted, hearth dash-dot, proposal long dashes, highlight a thick solid line, the flight network
 * a thin solid muted line and a transport ride a thin 3-3 dash in it; and, with walking
 * paths, a walked leg whose path is still being computed in short even dashes (faded), and one
 * with no path, drawn straight in its place, dash-dot-dot. Every pattern differs from the others
 * by more than colour.
 */
const LINE_STYLES: Readonly<
  Record<LineStyle, { readonly role: PaletteRole; readonly weight: number; readonly dash: string | null; readonly cap: PathStyle['lineCap']; readonly opacity: number }>
> = {
  // The route (map-presentation.md §25.4): 2.6 px over a 5.5 px halo (`lineHalo`).
  route: { role: 'route', weight: 2.6, dash: null, cap: 'round', opacity: 0.9 },
  transport: { role: 'transport', weight: 3, dash: '10 6', cap: 'butt', opacity: 0.9 },
  flight: { role: 'flight', weight: 2.5, dash: '1 6', cap: 'round', opacity: 0.9 },
  hearth: { role: 'hearth', weight: 2.5, dash: '12 5 2 5', cap: 'butt', opacity: 0.9 },
  'route-pending': { role: 'route', weight: 2.5, dash: '4 4', cap: 'butt', opacity: 0.6 },
  'route-fallback': { role: 'route', weight: 3, dash: '10 3 2 3 2 3', cap: 'butt', opacity: 0.9 },
  highlight: { role: 'highlight', weight: 6, dash: null, cap: 'round', opacity: 0.85 },
  proposal: { role: 'proposal', weight: 3, dash: '14 7', cap: 'butt', opacity: 0.9 },
  // The travel network (map-presentation.md §25.4): thin muted ink, a flight solid, a transport ride dashed 3-3.
  'network-flight': { role: 'inkMuted', weight: 1.1, dash: null, cap: 'round', opacity: 0.9 },
  'network-transport': { role: 'inkMuted', weight: 1.1, dash: '3 3', cap: 'butt', opacity: 0.9 },
};

/**
 * The route after the active step (map-presentation.md §13.6, §25.4; review PR-02): at 55 %, and a
 * solid leg dashed 5-6, so the dash, not the fade, is the cue; a leg with its own dashes (transport,
 * flight, hearth, pending, fallback) keeps them, so what the leg is stays said.
 */
export const ROUTE_AFTER = { opacity: 0.55, dash: '5 6' } as const;

/** A step bead after the active step (§13.6): at 60 %. */
export const BEAD_AFTER_ALPHA = 0.6;

/** `after`: a route piece after the active step (`PolylineDescriptor.after`, `ROUTE_AFTER`). */
export function polylineStyle(style: LineStyle, emphasis: Emphasis, palette: MapPalette, after = false): PathStyle {
  const spec = LINE_STYLES[style];
  const color = palette[spec.role];
  return {
    stroke: true,
    color,
    weight: emphasis === 'strong' ? spec.weight + 2 : spec.weight,
    opacity: (after ? ROUTE_AFTER.opacity : spec.opacity) * EMPHASIS_ALPHA[emphasis],
    fill: false,
    fillColor: color,
    fillOpacity: 0,
    dashArray: after && spec.dash === null ? ROUTE_AFTER.dash : spec.dash,
    lineCap: spec.cap,
    lineJoin: 'round',
  };
}

/** A line's halo: a wider stroke under it in the halo colour, along the same dashes. */
export interface LineHalo {
  readonly color: string;
  readonly weight: number;
}

/**
 * The halo under a line (map-presentation.md §25.4, §25.6; review PR-03): the route's legs a 5.5 px
 * halo under their 2.6 px line (their width plus 2.9 px), the travel network a 3 px halo under its
 * 1.1 px line, in the label halo (`--frl-map-minimap-halo` in the minimap style, the theme's
 * `--frl-map-label-halo` in the painted style), so a line keeps a dark (or light) edge on any
 * ground. The highlight and the proposal have none (they are drawn over the route, which has one).
 */
export function lineHalo(style: LineStyle, emphasis: Emphasis, palette: MapPalette): LineHalo | null {
  if (style === 'highlight' || style === 'proposal') return null;
  const spec = LINE_STYLES[style];
  const weight = emphasis === 'strong' ? spec.weight + 2 : spec.weight;
  const network = style === 'network-flight' || style === 'network-transport';
  return { color: palette.labelHalo, weight: network ? 3 : Math.round((weight + 2.9) * 10) / 10 };
}

/**
 * Zone frames: a hairline with a faint fill (none over painted art, `filled` false); the extent a
 * dashed outline; `strong` in the accent colour. Strokes are at full opacity: the frame token is
 * chosen for 3:1 against the map background, and a translucent stroke would fall below it (M3
 * review MAP-A11Y-6).
 */
export function frameStyle(
  kind: FrameDescriptor['kind'],
  emphasis: Emphasis,
  palette: MapPalette,
  filled = true,
  look: { readonly hidden?: boolean; readonly overTiles?: boolean; readonly dashed?: boolean } = {},
): PathStyle {
  if (look.hidden === true) {
    // Kept for `MapEvent.zones`, not painted: a zone rectangle over the atlas tiles (D-042 A8).
    return {
      stroke: false,
      color: palette.frame,
      weight: 0,
      opacity: 0,
      fill: false,
      fillColor: palette.frameFill,
      fillOpacity: 0,
      dashArray: null,
      lineCap: 'butt',
      lineJoin: 'miter',
    };
  }
  if (kind === 'inset' || kind === 'card') {
    // An inset's card on the atlas (map-atlas.md §5.5, §8.5), or a city card over the tiles: a
    // solid vector frame, heavier than a zone frame, so the box reads as "shown apart", not as a
    // zone. Over the tiles it takes the atlas frame colour (3:1 or more on both sea colours).
    return {
      stroke: true,
      color: look.overTiles === true ? palette.frameAtlas : palette.extent,
      weight: 2,
      opacity: 1,
      fill: false,
      fillColor: palette.extent,
      fillOpacity: 0,
      dashArray: null,
      lineCap: 'butt',
      lineJoin: 'miter',
    };
  }
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
  const dashed = look.dashed === true;
  return {
    stroke: true,
    // An underground city's frame keeps the frame colour when it is the jumped-to zone (review PR-17): the route's colour is the route's.
    color: strong && !dashed ? palette.frameStrong : palette.frame,
    weight: strong ? 2.5 : dashed ? 1.5 : 1,
    opacity: EMPHASIS_ALPHA[emphasis],
    fill: filled,
    fillColor: palette.frameFill,
    fillOpacity: filled ? (strong ? 0.45 : 0.25) : 0,
    // An underground city's frame in the minimap style (D-049 O19): dashed, in the frame colour.
    dashArray: dashed ? '5 4' : null,
    lineCap: 'butt',
    lineJoin: 'miter',
  };
}

/**
 * A connector's arc (map-atlas.md §8.5): the leg's own line style (transport dashed, flight dotted,
 * hearth dash-dot, the proposal's long dashes), so it reads as the same kind of leg as on a map;
 * the arc shape and its mid-arc ring glyph say it crosses between world maps.
 */
export function connectorStyle(style: ConnectorDescriptor['style'], emphasis: Emphasis, palette: MapPalette): PathStyle {
  return polylineStyle(style, emphasis, palette);
}

/**
 * A connector's halo: a network ride's (`network-transport`, review PR-11) is the travel network's
 * 3 px halo under its 1.1 px line, as on a map; the route's own connectors and the proposal's have
 * none (as before).
 */
export function connectorHalo(style: ConnectorDescriptor['style'], emphasis: Emphasis, palette: MapPalette): LineHalo | null {
  return style === 'network-transport' ? lineHalo(style, emphasis, palette) : null;
}

/**
 * The transition glyph at a connector's mid-arc: the ring of `transition` markers, in the accent
 * for the route's own connectors (the proposal's colour in the overlay), and neutral for a ride of
 * the travel network (review PR-11), so the route colour marks only the route.
 */
export function connectorGlyph(descriptor: ConnectorDescriptor, palette: MapPalette): GlyphSpec {
  const marker: MarkerDescriptor = {
    type: 'marker',
    id: descriptor.id,
    point: descriptor.from,
    kind: 'transition',
    style: descriptor.style === 'proposal' ? 'proposal' : descriptor.style === 'network-transport' ? 'neutral' : 'accent',
    emphasis: descriptor.emphasis,
    label: descriptor.label,
    badges: [],
    ref: descriptor.ref,
    count: 1,
    refs: [descriptor.ref],
    labels: [descriptor.label],
  };
  return markerGlyph(marker, palette);
}

/**
 * Terrain outlines: zone outlines a solid line in the frame colour, 1.5 px, at full opacity (3:1
 * on the map background, as frames are); the coastline a 1 px solid line in the muted ink. Neither
 * is interactive, and neither uses a difficulty colour or the provenance cyan.
 */
export function outlineStyle(kind: OutlineDescriptor['kind'], palette: MapPalette): PathStyle {
  const color = kind === 'zones' ? palette.zoneOutline : palette.coast;
  return {
    stroke: true,
    color,
    weight: kind === 'zones' ? 1.5 : 1,
    opacity: 1,
    fill: false,
    fillColor: color,
    fillOpacity: 0,
    dashArray: null,
    lineCap: 'round',
    lineJoin: 'round',
  };
}

/**
 * An objective outline of a log quest (map-presentation.md §7.4, §6.4): a 1.2 px line in the muted
 * ink at full opacity, over a 3 px halo in the label halo (drawn by `AreaOutline`), never filled.
 */
export function areaStyle(palette: MapPalette): PathStyle {
  return {
    stroke: true,
    color: palette.inkMuted,
    weight: 1.2,
    opacity: 1,
    fill: false,
    fillColor: palette.inkMuted,
    fillOpacity: 0,
    dashArray: null,
    lineCap: 'round',
    lineJoin: 'round',
  };
}

/**
 * The fallback tint's opacity over the relief (map-presentation.md §12.4): the relief's shading shows
 * through, as the design's multiply at 55 % would give it (an ASSUMPTION, drawn as alpha on the path
 * canvas, which cannot multiply with the relief image below it).
 */
export const TINT_OPACITY = 0.55;

/**
 * A zone fill (§12.4, §12.6): the tint as a fill at `TINT_OPACITY`; the faction overlay's pattern in
 * the hatch colour (the pattern itself is drawn by `ZoneFillShape`; this colour stands in where a
 * canvas pattern cannot be made); "no faction" with no fill at all, but still its hover words. No
 * stroke: the zone borders are the outlines' and the frames'.
 */
export function zoneFillStyle(fill: ZoneFillDescriptor['fill'], palette: MapPalette): PathStyle {
  const tint = 'tint' in fill;
  const colour = tint ? fill.tint : palette.hatch;
  return {
    stroke: false,
    color: colour,
    weight: 0,
    opacity: 0,
    fill: tint || fill.pattern !== 'none',
    fillColor: colour,
    fillOpacity: tint ? TINT_OPACITY : 1,
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
    alpha: EMPHASIS_ALPHA[emphasis] * (descriptor.after === true ? BEAD_AFTER_ALPHA : 1),
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
