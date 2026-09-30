import type { LayerId, MarkerDescriptor, MarkerMark } from '../adapter';
import {
  BADGE_SLOT_OF,
  bucketPinDiameter,
  DUNGEON_GLYPH,
  MARK_STATES,
  pinDiameterAt,
  resolveMarkLook,
  type BadgeKind,
  type GlyphPath,
  type MarkDifficulty,
  type MarkEdge,
  type MarkFamily,
  type MarkFill,
  type MarkGlyph,
  type MarkState,
  type ResolvedMarkLook,
} from '../marks';
import {
  BADGE_SIZE,
  badgeCentre,
  badgesDrawnAt,
  groupLook,
  MARK_GLYPHS,
  pinColour,
  pinExtent,
  pinGeometry,
  pinGlyphBoxPx,
  PIN_LINES,
  pipBars,
  PIP_TAG,
  PIP_TAG_FROM_D,
  SMALL_PIN_SCALE,
  STACK_MERGE_RATIO,
  type GroupMember,
} from '../marks-pins';

/**
 * The map's pins (docs/research/map-presentation.md revision 3.1 §25.2; D-047; step MP.4a): our own
 * teardrops, drawn on the canvas from cached bitmaps. No Leaflet import, so it runs in Node tests:
 * `leaflet-layers.ts` wraps a pin in a Leaflet path (`PinMarker`), and the adapter keeps the stacks
 * and the hit index made here.
 *
 * - **The look** (`pinSpecOf`) is the one state table's (`src/map/marks.ts`, §25.2.3): the glyph,
 *   edge, fill, badges and colour of a marker's state; a cluster's or a stack's by the group rule
 *   (`groupLook`: the colour and the pip tag only when every member shares one difficulty). The
 *   difficulty colour appears only with the pip tag, only on a glyph box of 11 px or more (from D 16),
 *   and only for the states that take one (D-041 G, D-047).
 * - **Drawing** (`drawPin`): the pip tag at the head's left, the silhouette's keyline (solid, dashed
 *   "not sure", or double "both factions") outside the body, the glyph (solid or hollow "not known
 *   yet"), a strike for the other faction, the badges in their fixed slots, and for a selected pin
 *   the ring in the style's route colour laid on a halo. It sets every canvas property it uses.
 * - **Bitmaps** (`PinBitmaps`): each look is drawn once per palette, size and pixel ratio into a
 *   canvas sized to its own extent (`pinExtent`), kept in an LRU of at most 256 (§25.7).
 * - **Stacks** (`stackPins`): at the zone and close bands, pins of one kind whose head centres lie
 *   within 0.4 D merge into their first member's pin with "×n", by a spatial hash with 0.4 D cells
 *   (each pin checks its own cell and the eight around it; §25.2.5).
 * - **Hit targets** (`PinHitIndex`, `targetContains`): the head circle plus 2 px and the triangle
 *   down to the point, at least a 24 px square below D 20; among the pins under the pointer the head
 *   centre nearest it wins, and two within 3 px of the same distance are a tie (a list). The index
 *   is a 32 px grid, built off the `moveend` frame (§25.2.7).
 * - **Palette** (`pinPaletteFrom`, `forcedPinPalette`): the pin tokens; under forced colours the
 *   system colours read from a probe element, the coloured quest pins keeping their well body, their
 *   difficulty colours and their tag, as `DifficultyLabel` opts out (§25.2.9; UI.md §9 rule 9).
 */

// =============================================================================================
// Palette

export interface PinPalette {
  /** The dark body, the pip tag, and the glyph on light pins and badges (`--frl-map-pin`). */
  readonly body: string;
  /** The glyph and keyline on dark pins, the tag's keyline, the light body, the badges' fill (`--frl-map-pin-glyph`). */
  readonly glyph: string;
  /** The keyline on dark pins (the glyph colour; `CanvasText` under forced colours). */
  readonly keyline: string;
  /** The difficulty twin (D-041 G): `--frl-difficulty-*`, for coloured quest glyphs and lit pips only. */
  readonly difficulty: Readonly<Record<MarkDifficulty, string>>;
  /** Unlit pips (`--frl-difficulty-pip-off`). */
  readonly pipOff: string;
  /** The selection ring: the style's route colour (`Highlight` under forced colours). */
  readonly ring: string;
  /** The halo laid on both sides of the ring (the style's label halo). */
  readonly ringHalo: string;
  readonly font: string;
  /** Under forced colours (§25.2.9). */
  readonly forced: boolean;
  /** The bitmap cache's key for this palette. */
  readonly key: string;
}

/** The difficulty colours' light-theme values (the twin's fallbacks: UI.md §3.2, src/rules/difficulty.ts). */
const DIFFICULTY_FALLBACK: Readonly<Record<MarkDifficulty, string>> = {
  trivial: '#808080',
  standard: '#40bf40',
  difficult: '#ffff00',
  verydifficult: '#ff8040',
  impossible: '#ff1a1a',
};

const DIFFICULTY_KEYS: readonly MarkDifficulty[] = ['trivial', 'standard', 'difficult', 'verydifficult', 'impossible'];

function withKey(palette: Omit<PinPalette, 'key'>): PinPalette {
  const key = [palette.body, palette.glyph, palette.keyline, ...DIFFICULTY_KEYS.map((d) => palette.difficulty[d]), palette.pipOff, palette.ring, palette.ringHalo, palette.font, palette.forced ? 'forced' : ''].join('|');
  return { ...palette, key };
}

/**
 * The pin palette from custom-property lookups (`getComputedStyle(el).getPropertyValue`): the pin
 * tokens, the difficulty twin, and the ring and halo the map palette gives the shown style (its
 * route colour and label halo). Values that are not set take the tokens' own values.
 */
export function pinPaletteFrom(lookup: (property: string) => string, ring: string, ringHalo: string, font: string): PinPalette {
  const read = (property: string, fallback: string): string => {
    const value = lookup(property).trim();
    return value === '' ? fallback : value;
  };
  const glyph = read('--frl-map-pin-glyph', '#f2f2f2');
  return withKey({
    body: read('--frl-map-pin', '#101216'),
    glyph,
    keyline: glyph,
    difficulty: Object.fromEntries(DIFFICULTY_KEYS.map((d) => [d, read(`--frl-difficulty-${d}`, DIFFICULTY_FALLBACK[d])])) as Record<MarkDifficulty, string>,
    pipOff: read('--frl-difficulty-pip-off', '#2a3039'),
    ring,
    ringHalo,
    font,
    forced: false,
  });
}

/** The system colours a probe element resolves under forced colours (`color: CanvasText; background: Canvas; border-color: Highlight`). */
export interface SystemColours {
  readonly canvas: string;
  readonly canvasText: string;
  readonly highlight: string;
}

/**
 * The pin palette under forced colours (§25.2.9): body `Canvas`, keyline and glyph `CanvasText`, the
 * ring `Highlight`. The difficulty twin and the dark body of coloured quest pins are kept (their
 * glyph and tag are drawn on `normal.body`), as the difficulty chip opts out of forced colours.
 */
export function forcedPinPalette(normal: PinPalette, system: SystemColours): PinPalette {
  return withKey({
    ...normal,
    body: system.canvas,
    glyph: system.canvasText,
    keyline: system.canvasText,
    ring: system.highlight,
    ringHalo: system.canvas,
    forced: true,
    // The well stays for coloured pins: `drawPin` reads it from `well`.
  });
}

export const DEFAULT_PIN_PALETTE: PinPalette = pinPaletteFrom(() => '', '#3a4fc4', 'rgba(255, 255, 255, 0.85)', 'system-ui, sans-serif');

/** The dark well a coloured quest pin keeps under forced colours: the token's own value. */
const WELL = '#101216';

// =============================================================================================
// Sizes and thresholds (§25.2.2, §25.2.4)

/** The head's drawn diameter at a scale (px per world yard): `pinDiameterAt`, bucketed to even pixels over the continent band. */
export const pinDiameterFor = (pxPerYard: number): number => bucketPinDiameter(pinDiameterAt(pxPerYard));

/** Pins drawn at 0.8 of the band's size: the light family (services) and the counted objectives (§25.2.2). */
export function pinScaleOf(layer: LayerId, descriptor: Pick<MarkerDescriptor, 'mark'>): number {
  if (layer === 'services') return SMALL_PIN_SCALE;
  if (layer === 'objectives' && descriptor.mark?.state === 'objective') return SMALL_PIN_SCALE;
  return 1;
}

/**
 * The scale (px per world yard) a layer's pins are drawn from (§25.2.2): places (dungeons, flight
 * points, transport stops) from 0.0325 (D 16), services from 0.149, vendors from the close band;
 * quest pins and clusters at every band. With the bands' hysteresis (`aboveThreshold`).
 */
export const PIN_FROM_PX: Readonly<Partial<Record<LayerId, number>>> = { dungeons: 0.0325, 'flight-masters': 0.0325, transports: 0.0325, services: 0.149 };
export const VENDORS_FROM_PX = 0.5;

// =============================================================================================
// The look

export type PinState = 'normal' | 'hover' | 'selected';

/** Everything `drawPin` needs, resolved (a bitmap's key). */
export interface PinSpec {
  readonly glyph: MarkGlyph;
  /** The head's diameter in CSS pixels (a selected pin's is 1.15× this). */
  readonly diameter: number;
  readonly family: MarkFamily;
  readonly fill: MarkFill;
  readonly edge: MarkEdge;
  /** The difficulty the glyph and the lit pips take, with the tag; null for none. */
  readonly colour: MarkDifficulty | null;
  /** The badges drawn at this size (`badgesDrawnAt`), in slot order. */
  readonly badges: readonly BadgeKind[];
  readonly struck: boolean;
  /** The count pill's text ("×12"), or null. */
  readonly count: string | null;
  /** The progress pie's share (0 to 1), or null. */
  readonly progress: number | null;
  /** The level pill's text ("16"), or null. */
  readonly level: string | null;
  /** The other faction's letter, or null. */
  readonly faction: 'A' | 'H' | null;
  readonly state: PinState;
}

/** The count pill's text: "×n", "×99+" beyond (the hover gives the exact number). */
export const countText = (n: number): string => (n > 99 ? '×99+' : `×${String(n)}`);

/** A layer's look for a marker without a state: the quest glyphs uncoloured, a flight point "not sure", the places and services plain. */
const STATELESS: Readonly<Partial<Record<LayerId, MarkState>>> = {
  'turn-ins': 'ready',
  objectives: 'objective',
  'flight-masters': 'flight-may-be-known',
  dungeons: 'dungeon',
  transports: 'transport-unknown',
  services: 'vendor',
};

function stateless(layer: LayerId): { readonly state: MarkState } {
  return { state: STATELESS[layer] ?? 'available' };
}

export interface PinSpecOptions {
  /** The band's head diameter (`pinDiameterFor`), before the layer's 0.8. */
  readonly diameter: number;
  readonly state?: PinState;
  /**
   * The members drawn now of a group pin: a cluster's visible members (the mask applied), or the
   * marks of the pins a stack leader stands for (its own first). Omitted: the descriptor's own.
   */
  readonly members?: readonly (MarkerMark | null)[];
  /** How many the pin stands for when it is a stack leader or a masked cluster (the "×n"); omitted: the descriptor's own. */
  readonly count?: number;
}

function progressOf(mark: MarkerMark | null | undefined): number | null {
  const progress = mark?.progress ?? null;
  if (progress === null) return null;
  return progress.total > 0 ? Math.min(1, Math.max(0, progress.done / progress.total)) : 0;
}

/**
 * A pin's look (§25.2.3): its state's row of the one table with the item's modifiers, its colour on
 * its glyph box, and for a group (a cluster, a stack) the group rule over its members.
 */
export function pinSpecOf(layer: LayerId, descriptor: MarkerDescriptor, options: PinSpecOptions): PinSpec {
  const diameter = options.diameter * pinScaleOf(layer, descriptor);
  const base = stateless(layer);
  const mark = descriptor.mark ?? null;
  const cluster = descriptor.cluster;
  const members = options.members ?? (cluster === undefined ? null : cluster.members.map((member) => member.mark));
  const count = options.count ?? (cluster === undefined ? descriptor.count : cluster.members.length);
  let look: ResolvedMarkLook;
  let colour: MarkDifficulty | null;
  if (members !== null && (members.length > 1 || count > 1)) {
    const group: GroupMember[] = members.map((member) => ({ state: member?.state ?? base.state, difficulty: member === null || member === undefined ? null : member.difficulty }));
    const result = groupLook(group, pinGlyphBoxPx(diameter, MARK_STATES[group[0]?.state ?? base.state].glyph));
    if (result === null) {
      look = resolveMarkLook(base.state, { count });
      colour = null;
    } else {
      look = resolveMarkLook(group[0]?.state ?? base.state, { count, dungeonQuest: members.some((member) => member?.dungeonQuest === true) });
      look = { ...look, edge: result.look.edge };
      colour = members.some((member) => member === null || member === undefined) ? null : result.colour;
    }
  } else if (mark !== null) {
    // A place's modifiers (steps MP.5, MP.8): a flight point's sides, an unverified entrance's ring.
    look = resolveMarkLook(mark.state, {
      dungeonQuest: mark.dungeonQuest,
      count,
      ...(mark.sides === undefined ? {} : { sides: mark.sides }),
      ...(mark.positionUnverified === true ? { positionUnverified: true } : {}),
    });
    colour = pinColour(mark.state, mark.difficulty, diameter)?.difficulty ?? null;
  } else {
    // No route state: the glyph, uncoloured, its edge solid and no badge beyond the count.
    const plain = resolveMarkLook(base.state, { count });
    look = { ...plain, badges: plain.badges.filter((badge) => badge === 'count') };
    colour = null;
  }
  if (colour !== null && diameter < PIP_TAG_FROM_D) colour = null;
  const firstMark = mark ?? members?.[0] ?? null;
  const badges = badgesDrawnAt(diameter, look.badges);
  const unlock = firstMark?.state === 'unlocks-soon' && typeof firstMark.unlockLevel === 'number' ? String(firstMark.unlockLevel) : null;
  return {
    glyph: look.glyph,
    diameter,
    family: look.family,
    fill: look.fill,
    edge: look.edge,
    colour,
    badges,
    struck: look.struck,
    count: badges.includes('count') ? countText(count) : null,
    progress: badges.includes('progress') ? (progressOf(firstMark) ?? 0) : null,
    level: badges.includes('level') ? (unlock ?? '?') : null,
    faction: badges.includes('faction') ? (firstMark?.faction ?? null) : null,
    state: options.state ?? 'normal',
  };
}

/** A spec's cache key. */
export const pinSpecKey = (spec: PinSpec): string =>
  [spec.glyph, spec.diameter, spec.family, spec.fill, spec.edge, spec.colour ?? '-', spec.badges.join(','), spec.struck ? 's' : '', spec.count ?? '', spec.progress ?? '', spec.level ?? '', spec.faction ?? '', spec.state].join('|');

/** The paint extent of a spec around its point (`pinExtent`), for the bitmap and the path's canvas bounds. */
export function specExtent(spec: PinSpec): { readonly left: number; readonly right: number; readonly up: number; readonly down: number } {
  const selected = spec.state === 'selected';
  return pinExtent(selected ? spec.diameter * PIN_LINES.selectedScale : spec.diameter, { tag: spec.colour !== null, pill: spec.count !== null || spec.level !== null, selected });
}

// =============================================================================================
// Drawing

/** The part of a 2D context the pins use (a recording context in tests). */
export interface PinCanvas {
  globalAlpha: number;
  fillStyle: unknown;
  strokeStyle: unknown;
  lineWidth: number;
  lineJoin: string;
  lineCap: string;
  font: string;
  textAlign: string;
  textBaseline: string;
  save(): void;
  restore(): void;
  translate(x: number, y: number): void;
  scale(x: number, y: number): void;
  beginPath(): void;
  closePath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  arc(x: number, y: number, radius: number, startAngle: number, endAngle: number, counterclockwise?: boolean): void;
  rect(x: number, y: number, width: number, height: number): void;
  fill(path?: unknown): void;
  stroke(path?: unknown): void;
  fillRect(x: number, y: number, width: number, height: number): void;
  fillText(text: string, x: number, y: number): void;
  measureText(text: string): { readonly width: number };
  setLineDash(segments: number[]): void;
}

/** Makes a path object from an SVG path string (`new Path2D(d)` in a browser); null where there is none (the glyph is then skipped). */
export type PathMaker = (d: string) => unknown;

const TAU = 2 * Math.PI;
const NO_DASH: number[] = [];

/** The teardrop's outline: the tip at (x, y), the two tangents to the head, and the head's arc over the top. */
function silhouette(ctx: PinCanvas, x: number, y: number, diameter: number): { readonly cx: number; readonly cy: number; readonly r: number } {
  const g = pinGeometry(diameter);
  const cy = y - g.centreToPoint;
  const t = Math.PI / 2 - g.halfAngle;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x - g.radius * Math.cos(t), cy + g.radius * Math.sin(t));
  ctx.arc(x, cy, g.radius, Math.PI - t, TAU + t, false);
  ctx.closePath();
  return { cx: x, cy, r: g.radius };
}

function roundRect(ctx: PinCanvas, x: number, y: number, width: number, height: number, radius: number): void {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.arc(x + width - r, y + r, r, -Math.PI / 2, 0);
  ctx.lineTo(x + width, y + height - r);
  ctx.arc(x + width - r, y + height - r, r, 0, Math.PI / 2);
  ctx.lineTo(x + r, y + height);
  ctx.arc(x + r, y + height - r, r, Math.PI / 2, Math.PI);
  ctx.lineTo(x, y + r);
  ctx.arc(x + r, y + r, r, Math.PI, (3 * Math.PI) / 2);
  ctx.closePath();
}

/** Draws a glyph's parts in a box of `box` px centred on (cx, cy): fills and strokes in `ink`, cuts in `body`; hollow fills are outlined. */
function drawGlyphPath(ctx: PinCanvas, glyph: GlyphPath, cx: number, cy: number, box: number, ink: string, body: string, hollow: boolean, path: PathMaker): void {
  const k = box / 24;
  ctx.save();
  ctx.translate(cx - 12 * k, cy - 12 * k);
  ctx.scale(k, k);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const part of glyph) {
    const p = path(part.d);
    if (p === null) continue;
    switch (part.mode) {
      case 'stroke':
        ctx.strokeStyle = ink;
        ctx.lineWidth = part.width ?? 1;
        ctx.stroke(p);
        break;
      case 'cut':
        ctx.strokeStyle = body;
        ctx.lineWidth = part.width ?? 1;
        ctx.stroke(p);
        break;
      case 'cut-fill':
        ctx.fillStyle = body;
        ctx.fill(p);
        break;
      case 'fill':
        if (hollow) {
          ctx.strokeStyle = ink;
          ctx.lineWidth = 1.6 / k;
          ctx.stroke(p);
        } else {
          ctx.fillStyle = ink;
          ctx.fill(p);
        }
        break;
    }
  }
  ctx.restore();
}

/** The pip tag (§25.2.1): a small tag at the head's left, in the pin's two tones, with the five bars of the staircase. */
function drawTag(ctx: PinCanvas, cx: number, cy: number, r: number, difficulty: MarkDifficulty, palette: PinPalette, body: string, keyline: string): void {
  const right = cx - r + PIP_TAG.overlap;
  const left = right - PIP_TAG.width;
  const top = cy - PIP_TAG.height / 2;
  roundRect(ctx, left, top, PIP_TAG.width, PIP_TAG.height, PIP_TAG.radius);
  ctx.lineWidth = 2 * PIP_TAG.keyline;
  ctx.strokeStyle = keyline;
  ctx.stroke();
  ctx.fillStyle = body;
  ctx.fill();
  const barsWidth = 5 * PIP_TAG.barWidth + 4 * PIP_TAG.barGap;
  const x0 = left + (PIP_TAG.width - PIP_TAG.overlap - barsWidth) / 2;
  const baseline = cy + PIP_TAG.maxBarHeight / 2;
  for (const bar of pipBars(difficulty)) {
    ctx.fillStyle = bar.lit ? palette.difficulty[difficulty] : palette.pipOff;
    ctx.fillRect(x0 + bar.x, baseline - bar.height, PIP_TAG.barWidth, bar.height);
  }
}

/** One badge (§25.2.1, §25.2.3) at its slot: a light disc or pill with a dark rim, readable on either family. */
function drawBadge(ctx: PinCanvas, badge: BadgeKind, cx: number, cy: number, r: number, spec: PinSpec, palette: PinPalette, path: PathMaker): void {
  const centre = badgeCentre(BADGE_SLOT_OF[badge], r);
  const x = cx + centre.x;
  const y = cy + centre.y;
  const radius = BADGE_SIZE.diameter / 2;
  const fill = palette.glyph;
  const ink = palette.body;
  const pill = (text: string): void => {
    ctx.font = `700 8px ${palette.font}`;
    const width = Math.max(BADGE_SIZE.diameter, ctx.measureText(text).width + 5);
    // The count pill grows to the right of its slot, the level pill round it.
    const left = badge === 'count' ? x - radius : x - width / 2;
    roundRect(ctx, left, y - radius, width, BADGE_SIZE.diameter, radius);
    ctx.lineWidth = 2 * BADGE_SIZE.rim;
    ctx.strokeStyle = ink;
    ctx.stroke();
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.fillStyle = ink;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, left + width / 2, y + 0.5);
  };
  const disc = (): void => {
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, TAU);
    ctx.lineWidth = 2 * BADGE_SIZE.rim;
    ctx.strokeStyle = ink;
    ctx.stroke();
    ctx.fillStyle = fill;
    ctx.fill();
  };
  switch (badge) {
    case 'count':
      pill(spec.count ?? '');
      return;
    case 'level':
      pill(spec.level ?? '?');
      return;
    case 'lock':
      disc();
      ctx.beginPath();
      ctx.arc(x, y - 0.6, 1.6, Math.PI, TAU);
      ctx.lineWidth = 1.1;
      ctx.strokeStyle = ink;
      ctx.stroke();
      ctx.fillStyle = ink;
      ctx.fillRect(x - 2.4, y - 0.6, 4.8, 3.2);
      return;
    case 'progress':
    case 'progress-unknown': {
      disc();
      const pie = 3;
      ctx.beginPath();
      ctx.arc(x, y, pie, 0, TAU);
      ctx.lineWidth = 1;
      ctx.strokeStyle = ink;
      if (badge === 'progress-unknown') ctx.setLineDash([1.4, 1.2]);
      ctx.stroke();
      ctx.setLineDash(NO_DASH);
      const share = spec.progress ?? 0;
      if (badge === 'progress' && share > 0) {
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.arc(x, y, pie, -Math.PI / 2, -Math.PI / 2 + share * TAU, false);
        ctx.closePath();
        ctx.fillStyle = ink;
        ctx.fill();
      }
      return;
    }
    case 'faction':
      disc();
      ctx.font = `700 8px ${palette.font}`;
      ctx.fillStyle = ink;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(spec.faction ?? '?', x, y + 0.5);
      return;
    case 'dungeon-quest':
      disc();
      drawGlyphPath(ctx, DUNGEON_GLYPH, x, y, 7, ink, fill, false, path);
      return;
    case 'position':
      ctx.beginPath();
      ctx.arc(x, y, radius - 1, 0, TAU);
      ctx.lineWidth = 2 * BADGE_SIZE.rim;
      ctx.strokeStyle = ink;
      ctx.stroke();
      ctx.fillStyle = fill;
      ctx.fill();
      ctx.beginPath();
      ctx.arc(x, y, 2.6, 0, TAU);
      ctx.setLineDash([1.6, 1.2]);
      ctx.lineWidth = 1;
      ctx.strokeStyle = ink;
      ctx.stroke();
      ctx.setLineDash(NO_DASH);
      return;
  }
}

/**
 * Draws one pin with its point at canvas point (x, y) (§25.2.1): the ring and halo when selected,
 * the pip tag, the silhouette's keyline outside its body (solid, dashed or double), the glyph, the
 * strike and the badges. Leaves the context as it found it (save and restore).
 */
export function drawPin(ctx: PinCanvas, x: number, y: number, spec: PinSpec, palette: PinPalette, path: PathMaker): void {
  const selected = spec.state === 'selected';
  const diameter = selected ? spec.diameter * PIN_LINES.selectedScale : spec.diameter;
  const light = spec.family === 'light';
  // A coloured quest pin keeps its dark well under forced colours (§25.2.9).
  const body = spec.colour !== null && palette.forced ? WELL : light ? palette.glyph : palette.body;
  const keyline = light ? palette.body : palette.keyline;
  const ink = spec.colour !== null ? palette.difficulty[spec.colour] : light ? palette.body : palette.glyph;
  ctx.save();
  ctx.globalAlpha = 1;
  ctx.setLineDash(NO_DASH);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'butt';
  const g = pinGeometry(diameter);
  const cy = y - g.centreToPoint;
  if (selected) {
    // The ring in the style's route colour, laid on a halo on both sides (review UR-11).
    const ringR = g.radius + PIN_LINES.keyline + 1 + PIN_LINES.selectionRing / 2 + PIN_LINES.selectionHalo;
    ctx.beginPath();
    ctx.arc(x, cy, ringR, 0, TAU);
    ctx.lineWidth = PIN_LINES.selectionRing + 2 * PIN_LINES.selectionHalo;
    ctx.strokeStyle = palette.ringHalo;
    ctx.stroke();
    ctx.lineWidth = PIN_LINES.selectionRing;
    ctx.strokeStyle = palette.ring;
    ctx.stroke();
  }
  if (spec.colour !== null) drawTag(ctx, x, cy, g.radius, spec.colour, palette, body, keyline);
  const head = silhouette(ctx, x, y, diameter);
  const keylineWidth = spec.state === 'hover' ? PIN_LINES.keylineHover : PIN_LINES.keyline;
  ctx.lineWidth = 2 * keylineWidth;
  ctx.strokeStyle = keyline;
  if (spec.edge === 'dashed') ctx.setLineDash([...PIN_LINES.dash]);
  ctx.stroke();
  ctx.setLineDash(NO_DASH);
  ctx.fillStyle = body;
  ctx.fill();
  if (spec.edge === 'double') {
    ctx.beginPath();
    ctx.arc(head.cx, head.cy, head.r - PIN_LINES.doubleInset, 0, TAU);
    ctx.lineWidth = 1;
    ctx.strokeStyle = keyline;
    ctx.stroke();
  }
  const box = pinGlyphBoxPx(diameter, spec.glyph);
  drawGlyphPath(ctx, MARK_GLYPHS[spec.glyph], head.cx, head.cy, box, ink, body, spec.fill === 'hollow', path);
  if (spec.struck) {
    const half = box / 2;
    ctx.beginPath();
    ctx.moveTo(head.cx - half, head.cy + half);
    ctx.lineTo(head.cx + half, head.cy - half);
    ctx.lineCap = 'round';
    ctx.lineWidth = 3.4;
    ctx.strokeStyle = body;
    ctx.stroke();
    ctx.lineWidth = 1.6;
    ctx.strokeStyle = ink;
    ctx.stroke();
  }
  for (const badge of spec.badges) drawBadge(ctx, badge, head.cx, head.cy, head.r, spec, palette, path);
  ctx.restore();
}

// =============================================================================================
// Bitmaps (§25.7)

/** A canvas a bitmap is drawn into (an `OffscreenCanvas` or a `<canvas>`). */
export interface BitmapCanvas {
  width: number;
  height: number;
  getContext(kind: '2d'): unknown;
}

export interface PinBitmap {
  /** The drawn image (a canvas). */
  readonly image: BitmapCanvas;
  /** The point's offset in the bitmap, CSS pixels: `left` from its left edge, `up` from its top. */
  readonly left: number;
  readonly up: number;
  /** The bitmap's size in CSS pixels. */
  readonly width: number;
  readonly height: number;
}

/** The most bitmaps kept (§25.7: about 7 MB at DPR 2, ESTIMATE). */
export const PIN_BITMAPS_MAX = 256;

/**
 * An LRU of drawn pins, keyed by the look, the palette and the pixel ratio (§25.7): each bitmap sized
 * to its pin's own extent, at most `max` kept. `create` makes a canvas (null where there is none:
 * the pin is then not drawn from a bitmap, and `get` returns null).
 */
export class PinBitmaps {
  private readonly cache = new Map<string, PinBitmap>();
  private readonly create: (width: number, height: number) => BitmapCanvas | null;
  private readonly path: PathMaker;
  private readonly max: number;
  /** Bitmaps drawn so far (for tests and the harness). */
  drawn = 0;

  constructor(create: (width: number, height: number) => BitmapCanvas | null, path: PathMaker, max = PIN_BITMAPS_MAX) {
    this.create = create;
    this.path = path;
    this.max = max;
  }

  get size(): number {
    return this.cache.size;
  }

  clear(): void {
    this.cache.clear();
  }

  get(spec: PinSpec, palette: PinPalette, ratio: number): PinBitmap | null {
    const key = `${pinSpecKey(spec)}#${palette.key}#${String(ratio)}`;
    const hit = this.cache.get(key);
    if (hit !== undefined) {
      // Most recently used last.
      this.cache.delete(key);
      this.cache.set(key, hit);
      return hit;
    }
    const e = specExtent(spec);
    const width = e.left + e.right;
    const height = e.up + e.down;
    const image = this.create(Math.max(1, Math.ceil(width * ratio)), Math.max(1, Math.ceil(height * ratio)));
    const ctx = image?.getContext('2d') as PinCanvas | null | undefined;
    if (image === null || ctx === null || ctx === undefined) return null;
    ctx.scale(ratio, ratio);
    drawPin(ctx, e.left, e.up, spec, palette, this.path);
    this.drawn += 1;
    const made: PinBitmap = { image, left: e.left, up: e.up, width, height };
    this.cache.set(key, made);
    while (this.cache.size > this.max) {
      const oldest = this.cache.keys().next();
      if (oldest.done === true) break;
      this.cache.delete(oldest.value);
    }
    return made;
  }
}

// =============================================================================================
// Stacks (§25.2.5)

export interface StackInput {
  readonly id: string;
  /** Pins merge only within one kind: the layer and glyph. */
  readonly kind: string;
  /** The head centre in pixels at the current zoom (any pan-invariant frame: layer or atlas pixels). */
  readonly x: number;
  readonly y: number;
  /** The head's diameter. */
  readonly diameter: number;
}

/**
 * Pins of one kind whose head centres lie within 0.4 D merge into their first pin with "×n"
 * (§25.2.5), by a spatial hash with 0.4 D cells: each pin looks for a stack leader in its own cell
 * and the eight around it, joins the first one it finds (in the pins' order), and otherwise leads a
 * stack of its own. Deterministic for the same pins in the same order. Returns each leader's members
 * (the leader first) for the stacks of two or more.
 */
export function stackPins(pins: readonly StackInput[]): ReadonlyMap<string, readonly string[]> {
  const grids = new Map<string, Map<string, StackInput[]>>();
  const members = new Map<string, string[]>();
  for (const pin of pins) {
    const cell = STACK_MERGE_RATIO * pin.diameter;
    if (!(cell > 0)) continue;
    const grid = grids.get(pin.kind) ?? new Map<string, StackInput[]>();
    grids.set(pin.kind, grid);
    const gx = Math.floor(pin.x / cell);
    const gy = Math.floor(pin.y / cell);
    let leader: StackInput | null = null;
    for (let dx = -1; dx <= 1 && leader === null; dx += 1) {
      for (let dy = -1; dy <= 1 && leader === null; dy += 1) {
        for (const other of grid.get(`${String(gx + dx)}:${String(gy + dy)}`) ?? []) {
          const ddx = other.x - pin.x;
          const ddy = other.y - pin.y;
          const reach = STACK_MERGE_RATIO * Math.max(other.diameter, pin.diameter);
          if (ddx * ddx + ddy * ddy <= reach * reach) {
            leader = other;
            break;
          }
        }
      }
    }
    if (leader !== null) {
      const list = members.get(leader.id);
      if (list === undefined) members.set(leader.id, [leader.id, pin.id]);
      else list.push(pin.id);
      continue;
    }
    const key = `${String(gx)}:${String(gy)}`;
    const cellPins = grid.get(key);
    if (cellPins === undefined) grid.set(key, [pin]);
    else cellPins.push(pin);
  }
  return members;
}

// =============================================================================================
// Hit targets (§25.2.7)

/** A pin's pointer target: its point (the tip) in pixels, its head's diameter, and whether a press opens a list (a stack or cluster). */
export interface PinTarget {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly diameter: number;
  readonly list: boolean;
}

/** The smallest target square below D 20 (WCAG 2.2 SC 2.5.8). */
export const MIN_TARGET_SQUARE = 24;
/** Two head centres within this many pixels of the same distance from the pointer are a tie: the press opens a list. */
export const HIT_TIE_PX = 3;
/** The hit index's grid. */
export const HIT_CELL_PX = 32;

function headOf(target: PinTarget): { readonly cx: number; readonly cy: number; readonly r: number; readonly g: ReturnType<typeof pinGeometry> } {
  const g = pinGeometry(target.diameter);
  return { cx: target.x, cy: target.y - g.centreToPoint, r: g.radius + 2, g };
}

/**
 * Whether a pin's target holds a point (§25.2.7): the head circle plus 2 px, the triangle down to
 * the point, and below D 20 at least a 24 × 24 px square centred on the head.
 */
export function targetContains(target: PinTarget, x: number, y: number): boolean {
  const { cx, cy, r, g } = headOf(target);
  const dx = x - cx;
  const dy = y - cy;
  if (dx * dx + dy * dy <= r * r) return true;
  if (target.diameter < 20 && Math.abs(dx) <= MIN_TARGET_SQUARE / 2 && Math.abs(dy) <= MIN_TARGET_SQUARE / 2) return true;
  // The triangle from the head's tangent points down to the tip (above them, the head is the target).
  const tangentY = cy + g.radius * Math.sin(g.halfAngle);
  if (y < tangentY || y > target.y) return false;
  const share = (target.y - y) / (target.y - tangentY);
  return Math.abs(dx) <= g.radius * Math.cos(g.halfAngle) * share + 2;
}

/** A pin's target bounds, for the grid. */
function targetBox(target: PinTarget): { readonly x0: number; readonly y0: number; readonly x1: number; readonly y1: number } {
  const { cx, cy, r } = headOf(target);
  const half = Math.max(r, target.diameter < 20 ? MIN_TARGET_SQUARE / 2 : 0);
  return { x0: cx - half, y0: cy - half, x1: cx + half, y1: target.y + 2 };
}

export interface PinHit {
  /** The pin whose head centre is nearest the pointer among those whose target holds it. */
  readonly nearest: string;
  /** Every pin within `HIT_TIE_PX` of the nearest's distance (the nearest first); more than one is a list. */
  readonly ties: readonly string[];
  /** A list opens: a tie, or the nearest is a stack or cluster. */
  readonly list: boolean;
}

/** The adapter's own hit index for pins (§25.2.7): a 32 px grid of targets, the nearest head centre wins. */
export class PinHitIndex {
  private readonly cells = new Map<string, PinTarget[]>();
  readonly size: number;

  constructor(targets: readonly PinTarget[]) {
    this.size = targets.length;
    for (const target of targets) {
      const box = targetBox(target);
      for (let gx = Math.floor(box.x0 / HIT_CELL_PX); gx <= Math.floor(box.x1 / HIT_CELL_PX); gx += 1) {
        for (let gy = Math.floor(box.y0 / HIT_CELL_PX); gy <= Math.floor(box.y1 / HIT_CELL_PX); gy += 1) {
          const key = `${String(gx)}:${String(gy)}`;
          const list = this.cells.get(key);
          if (list === undefined) this.cells.set(key, [target]);
          else list.push(target);
        }
      }
    }
  }

  hit(x: number, y: number): PinHit | null {
    const cell = this.cells.get(`${String(Math.floor(x / HIT_CELL_PX))}:${String(Math.floor(y / HIT_CELL_PX))}`) ?? [];
    const found = cell
      .filter((target) => targetContains(target, x, y))
      .map((target) => {
        const { cx, cy } = headOf(target);
        return { target, distance: Math.hypot(x - cx, y - cy) };
      })
      .sort((a, b) => a.distance - b.distance || (a.target.id < b.target.id ? -1 : a.target.id > b.target.id ? 1 : 0));
    const [first] = found;
    if (first === undefined) return null;
    const ties = found.filter((entry) => entry.distance - first.distance <= HIT_TIE_PX).map((entry) => entry.target.id);
    return { nearest: first.target.id, ties, list: ties.length > 1 || first.target.list };
  }
}
