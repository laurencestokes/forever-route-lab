import { STACK_BADGE_OFFSET, STACK_BADGE_RADIUS, type GlyphSpec } from './style';

/**
 * Small original canvas glyphs, one simple shape per marker kind (docs/MAPS.md §8.1: an original
 * visual style, no game icons). No Leaflet import: the Leaflet marker class calls `drawGlyph` from
 * its canvas draw hook, and tests call it with a recording context.
 *
 * | Kind | Shape |
 * |---|---|
 * | `step` | filled circle with a hole (a bead) |
 * | `quest-start` | upward triangle |
 * | `quest-end` | square |
 * | `objective` | small dot |
 * | `flight-master` | plus sign |
 * | `transition` | ring with a centre dot |
 * | `halo` | wide ring, no fill |
 * | `aggregate` | rounded box with a count |
 *
 * Badges: `instance` a small square at the top right, `off-frame` a dashed ring around the glyph,
 * `leg-unknown` a question mark at the top right; a merged stack gets a round count badge at the
 * bottom right. Everything stays inside `glyphExtent` (style.ts).
 *
 * The renderer draws thousands of glyphs per frame, so a glyph neither saves nor restores the
 * context: it sets every property it relies on, and clears a dash pattern only when one may be set.
 */

/** The part of `CanvasRenderingContext2D` the glyphs use. */
export interface GlyphCanvas {
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
  beginPath(): void;
  closePath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  arc(x: number, y: number, radius: number, startAngle: number, endAngle: number): void;
  rect(x: number, y: number, width: number, height: number): void;
  fill(): void;
  stroke(): void;
  fillText(text: string, x: number, y: number): void;
  setLineDash(segments: number[]): void;
}

const TAU = 2 * Math.PI;
/** One shared empty dash list (`setLineDash` copies it), so clearing a dash allocates nothing. */
const NO_DASH: number[] = [];

function paint(ctx: GlyphCanvas, spec: GlyphSpec): void {
  if (spec.fill !== null) {
    ctx.fillStyle = spec.fill;
    ctx.fill();
  }
  if (spec.strokeWidth > 0) {
    ctx.lineWidth = spec.strokeWidth;
    ctx.strokeStyle = spec.stroke;
    ctx.stroke();
  }
}

function polygon(ctx: GlyphCanvas, points: readonly (readonly [number, number])[]): void {
  ctx.beginPath();
  points.forEach(([px, py], index) => {
    if (index === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  });
  ctx.closePath();
}

function roundedBox(ctx: GlyphCanvas, x: number, y: number, halfWidth: number, halfHeight: number, radius: number): void {
  const r = Math.min(radius, halfWidth, halfHeight);
  const left = x - halfWidth;
  const right = x + halfWidth;
  const top = y - halfHeight;
  const bottom = y + halfHeight;
  ctx.beginPath();
  ctx.moveTo(left + r, top);
  ctx.lineTo(right - r, top);
  ctx.arc(right - r, top + r, r, -Math.PI / 2, 0);
  ctx.lineTo(right, bottom - r);
  ctx.arc(right - r, bottom - r, r, 0, Math.PI / 2);
  ctx.lineTo(left + r, bottom);
  ctx.arc(left + r, bottom - r, r, Math.PI / 2, Math.PI);
  ctx.lineTo(left, top + r);
  ctx.arc(left + r, top + r, r, Math.PI, (3 * Math.PI) / 2);
  ctx.closePath();
}

/** Half the height of an aggregate box. */
export const AGGREGATE_HALF_HEIGHT = 8.5;

function drawShape(ctx: GlyphCanvas, x: number, y: number, spec: GlyphSpec): void {
  const r = spec.size;
  switch (spec.shape) {
    case 'step':
      ctx.beginPath();
      ctx.arc(x, y, r, 0, TAU);
      paint(ctx, spec);
      ctx.beginPath();
      ctx.arc(x, y, Math.max(1, r * 0.35), 0, TAU);
      ctx.fillStyle = spec.edge;
      ctx.fill();
      return;
    case 'objective':
      ctx.beginPath();
      ctx.arc(x, y, r, 0, TAU);
      paint(ctx, spec);
      return;
    case 'quest-start':
      polygon(ctx, [
        [x, y - r * 1.15],
        [x + r, y + r * 0.75],
        [x - r, y + r * 0.75],
      ]);
      paint(ctx, spec);
      return;
    case 'quest-end': {
      const h = r * 0.85;
      ctx.beginPath();
      ctx.rect(x - h, y - h, 2 * h, 2 * h);
      paint(ctx, spec);
      return;
    }
    case 'flight-master': {
      const t = r * 0.38;
      polygon(ctx, [
        [x - t, y - r],
        [x + t, y - r],
        [x + t, y - t],
        [x + r, y - t],
        [x + r, y + t],
        [x + t, y + t],
        [x + t, y + r],
        [x - t, y + r],
        [x - t, y + t],
        [x - r, y + t],
        [x - r, y - t],
        [x - t, y - t],
      ]);
      paint(ctx, spec);
      return;
    }
    case 'transition':
      ctx.beginPath();
      ctx.arc(x, y, r, 0, TAU);
      ctx.fillStyle = spec.edge;
      ctx.fill();
      ctx.lineWidth = spec.strokeWidth;
      ctx.strokeStyle = spec.stroke;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(x, y, Math.max(1.5, r * 0.32), 0, TAU);
      ctx.fillStyle = spec.fill ?? spec.stroke;
      ctx.fill();
      return;
    case 'halo':
      ctx.beginPath();
      ctx.arc(x, y, r, 0, TAU);
      ctx.lineWidth = spec.strokeWidth + 2;
      ctx.strokeStyle = spec.edge;
      ctx.stroke();
      ctx.lineWidth = spec.strokeWidth;
      ctx.strokeStyle = spec.stroke;
      ctx.stroke();
      return;
    case 'aggregate':
      roundedBox(ctx, x, y, r, Math.min(r, AGGREGATE_HALF_HEIGHT), 4);
      paint(ctx, spec);
      if (spec.text !== null) {
        ctx.fillStyle = spec.textColor;
        ctx.font = `600 11px ${spec.font}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(spec.text, x, y + 0.5);
      }
      return;
  }
}

const OFF_FRAME_DASH: number[] = [2, 2];

function drawBadges(ctx: GlyphCanvas, x: number, y: number, spec: GlyphSpec): void {
  const r = spec.size;
  for (const badge of spec.badges) {
    switch (badge) {
      case 'instance': {
        const s = 2.5;
        const cx = x + r * 0.9;
        const cy = y - r * 0.9;
        ctx.beginPath();
        ctx.rect(cx - s, cy - s, 2 * s, 2 * s);
        ctx.fillStyle = spec.badgeColor;
        ctx.fill();
        ctx.lineWidth = 1;
        ctx.strokeStyle = spec.edge;
        ctx.stroke();
        break;
      }
      case 'off-frame':
        ctx.beginPath();
        ctx.arc(x, y, r + 3, 0, TAU);
        ctx.setLineDash(OFF_FRAME_DASH);
        ctx.lineCap = 'butt';
        ctx.lineWidth = 1;
        ctx.strokeStyle = spec.badgeColor;
        ctx.stroke();
        ctx.setLineDash(NO_DASH);
        break;
      case 'leg-unknown':
        ctx.font = `700 10px ${spec.font}`;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'alphabetic';
        ctx.fillStyle = spec.badgeColor;
        ctx.fillText('?', x + r + 1, y - r + 2);
        break;
    }
  }
}

function drawStack(ctx: GlyphCanvas, x: number, y: number, spec: GlyphSpec): void {
  if (spec.stack === null) return;
  const offset = spec.size * STACK_BADGE_OFFSET.scale + STACK_BADGE_OFFSET.plus;
  const cx = x + offset;
  const cy = y + offset;
  ctx.beginPath();
  ctx.arc(cx, cy, STACK_BADGE_RADIUS, 0, TAU);
  ctx.fillStyle = spec.badgeColor;
  ctx.fill();
  ctx.lineWidth = 1;
  ctx.strokeStyle = spec.edge;
  ctx.stroke();
  ctx.font = `700 8px ${spec.font}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = spec.edge;
  ctx.fillText(spec.stack, cx, cy + 0.5);
}

/**
 * Draws one glyph centred on canvas point `(x, y)`, without saving or restoring the context (see
 * the module note). `lineDashed` says whether a dash pattern may be set on the context (the
 * measured renderer tracks the last path it stroked); only then is it cleared. The glyph always
 * leaves the context with no dash pattern.
 */
export function drawGlyph(ctx: GlyphCanvas, x: number, y: number, spec: GlyphSpec, lineDashed = true): void {
  if (lineDashed) ctx.setLineDash(NO_DASH);
  ctx.globalAlpha = spec.alpha;
  ctx.lineJoin = 'round';
  drawShape(ctx, x, y, spec);
  drawBadges(ctx, x, y, spec);
  drawStack(ctx, x, y, spec);
}
