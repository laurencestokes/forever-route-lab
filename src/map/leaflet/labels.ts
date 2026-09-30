import type { StepId } from '../../domain/ids';
import { BAND_HYSTERESIS_ZOOM, type LabelDescriptor } from '../adapter';
import { BADGE_SLOT_OF, type BadgeSlot } from '../marks';
import { BADGE_SIZE, badgeCentre, PIN_LINES, pinGeometry } from '../marks-pins';
import { chipWidth, drawDifficultyChip, type ChipInk } from './glyphs';

/**
 * The labels canvas's placement and drawing (docs/research/map-presentation.md §5.5, §13; step
 * MP.1): names and step numbers on their own non-interactive canvas in pane `frl-labels`
 * (z-index 450), above every path. This file has no Leaflet import, so it runs in the node test
 * environment; the canvas itself, as a Leaflet renderer, and the cross-fade are in
 * labels-canvas.ts.
 *
 * - **No hits.** The canvas takes no pointer events, so a label never takes a hover or a click from
 *   a mark or a route segment (review MP-R14).
 * - **Placed at `moveend`, drawn in the next frame** (§13.2, §25.7): the path canvas's frame is not
 *   charged for it. Between the two the old picture stays in place, following the map's zoom
 *   transform as Leaflet's own renderers do, so nothing flashes.
 * - **A renumbering redraws only this canvas** (§13.6): `requestDraw` repaints it in the next frame
 *   from the step numbers, and nothing else is redrawn.
 * - **Cross-fade at a band change** (§5.5): the outgoing picture is copied into a transient canvas
 *   that fades out over `--frl-duration` (140 ms) while the new one is drawn at full opacity; under
 *   reduced motion there is no fade. At every resting zoom every label is at full opacity.
 * - **Placement** (`placeLabels`, pure): greedy by static priority (higher first, ties by id),
 *   eleven positions round the anchor, then sixteen up to 3.5 lines away with a leader line to a dot
 *   at the anchor; obstacles are the labels already placed, the place pins, focused marks and the
 *   active and selected step beads. A label with no room is skipped and counted by name.
 * - **Step numbers** (`placeStepNumbers`, pure): beside each bead in view at the zone and close
 *   bands, 11 px, offset up and right; one within 16 px of a number already drawn is skipped (the
 *   active step's first, then the selected steps, then route order), at most 150 in view.
 *
 * The candidate offsets and fonts follow the revision 2 mock (`.cache/map-presentation/rev2/mock/`,
 * our own code), whose placement was measured there (§13.3).
 */

// =============================================================================================
// Text (§13.1)

/** Font sizes in CSS pixels, and the halo's stroke width (3 px, so text reaches 4.5:1 on any art). */
export const LABEL_TEXT = {
  compact: 11,
  compactSmall: 10,
  card: 12,
  cardLine2: 10,
  zone: 13,
  place: 10,
  continent: 18,
  inset: 12,
  halo: 3,
  /** Line height over the font size, for boxes. */
  lineGap: 3,
} as const;

/** Compact labels give way to cards from this scale (§13.3, §13.4), and zone labels (13 px) take over at the zone band. */
export const CARD_FROM_PX_PER_YARD = 0.05;
export const ZONE_LABEL_FROM_PX_PER_YARD = 0.088;

/** The step numbers' rules (§13.6). */
export const STEP_NUMBERS = { size: 11, dx: 7, dy: -7, minDistance: 16, maxInView: 150 } as const;

/** How long a band change's cross-fade lasts (`--frl-duration`). */
export const CROSS_FADE_MS = 140;

export type Measure = (text: string, font: string) => number;

/** The CSS font of a size and weight in `family`. */
export const fontOf = (size: number, weight: number, family: string): string => `${String(weight)} ${String(size)}px ${family}`;

// =============================================================================================
// Pure placement

/** A screen rectangle in pixels: x right, y down. */
export interface Box {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

export const boxesOverlap = (a: Box, b: Box): boolean => !(a.x1 <= b.x0 || a.x0 >= b.x1 || a.y1 <= b.y0 || a.y0 >= b.y1);

const inside = (area: Box, b: Box): boolean => b.x0 >= area.x0 && b.y0 >= area.y0 && b.x1 <= area.x1 && b.y1 <= area.y1;

/** One way to draw a label: a two-line card, or one line at a font size. */
export interface LabelForm {
  readonly kind: 'card' | 'line';
  readonly width: number;
  readonly height: number;
  /** The font size of the (first) line. */
  readonly size: number;
}

export interface PlacementInput {
  readonly id: string;
  /** The text named in the skip notes. */
  readonly name: string;
  readonly priority: number;
  /** The anchor in screen pixels. */
  readonly x: number;
  readonly y: number;
  /** The forms to try, in order (a card, then its compact fallback; 11 px, then 10 px). */
  readonly forms: readonly LabelForm[];
}

export interface PlacedLabel {
  readonly id: string;
  readonly form: LabelForm;
  readonly box: Box;
  /** A leader line from the anchor to the box (a label placed away from its anchor). */
  readonly leader: boolean;
  readonly x: number;
  readonly y: number;
}

export interface PlacementResult {
  readonly placed: readonly PlacedLabel[];
  /** The names of labels with no room, in priority order. */
  readonly skipped: readonly string[];
  readonly leaders: number;
}

/** The eleven positions round an anchor (centre first), for a box of `w` × `h`. */
export function candidateOffsets(w: number, h: number): readonly (readonly [number, number])[] {
  return [
    [0, 0],
    [0, -h],
    [0, h],
    [-w * 0.3, 0],
    [w * 0.3, 0],
    [0, -2 * h],
    [0, 2 * h],
    [-w * 0.5, -h],
    [w * 0.5, -h],
    [-w * 0.5, h],
    [w * 0.5, h],
  ];
}

/** The sixteen positions with a leader: eight directions at 2.5 and 3.5 lines away. */
export function leaderOffsets(w: number, h: number): readonly (readonly [number, number])[] {
  const out: (readonly [number, number])[] = [];
  const directions: readonly (readonly [number, number])[] = [
    [0, -1],
    [0, 1],
    [-1, 0],
    [1, 0],
    [-0.7, -0.7],
    [0.7, -0.7],
    [-0.7, 0.7],
    [0.7, 0.7],
  ];
  for (const lines of [2.5, 3.5]) for (const [ux, uy] of directions) out.push([ux * (w / 2 + 6) * (lines / 2.5), uy * h * lines]);
  return out;
}

const byPriority = (a: PlacementInput, b: PlacementInput): number => b.priority - a.priority || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/**
 * Greedy placement by static priority (§13.2). Each label tries its forms in order; each form the
 * eleven positions round the anchor, then the sixteen with a leader. A box must lie inside `area`
 * and meet no obstacle and no label placed before it. `soft` obstacles (the pins' heads and pills,
 * review PR-16) are kept clear of too where a label has room; a label with none is placed over them
 * rather than dropped. Deterministic: the same inputs always give the same placements, in any input
 * order.
 */
export function placeLabels(inputs: readonly PlacementInput[], obstacles: readonly Box[], area: Box, soft: readonly Box[] = []): PlacementResult {
  const plain = placeGreedy(inputs, obstacles, area, []);
  if (soft.length === 0) return plain;
  // Keeping clear of the pins must never cost a name (a label moved off a pill can take the room of
  // a lower one): then the placement without them stands.
  const avoiding = placeGreedy(inputs, obstacles, area, soft);
  return avoiding.skipped.length > plain.skipped.length ? plain : avoiding;
}

function placeGreedy(inputs: readonly PlacementInput[], obstacles: readonly Box[], area: Box, soft: readonly Box[]): PlacementResult {
  const taken: Box[] = [...obstacles];
  const placed: PlacedLabel[] = [];
  const skipped: string[] = [];
  let leaders = 0;
  // `soft` obstacles (the pins' heads and pills, review PR-16) are kept clear of where a label can
  // be; a label with no such room is placed as before, over them, rather than dropped (§13.3's
  // acceptance: every zone named at the fit-both view).
  let avoidSoft = true;
  const fits = (b: Box): boolean => inside(area, b) && !taken.some((other) => boxesOverlap(other, b)) && !(avoidSoft && soft.some((other) => boxesOverlap(other, b)));
  const placeOne = (input: PlacementInput): boolean => {
    let done = false;
    for (const form of input.forms) {
      const boxAt = ([dx, dy]: readonly [number, number]): Box => ({
        x0: input.x + dx - form.width / 2 - 1,
        y0: input.y + dy - form.height / 2,
        x1: input.x + dx + form.width / 2 + 1,
        y1: input.y + dy + form.height / 2,
      });
      for (const [offsets, leader] of [
        [candidateOffsets(form.width, form.height), false],
        [leaderOffsets(form.width, form.height), true],
      ] as const) {
        for (const offset of offsets) {
          const box = boxAt(offset);
          if (!fits(box)) continue;
          taken.push(box);
          placed.push({ id: input.id, form, box, leader, x: input.x, y: input.y });
          if (leader) leaders += 1;
          done = true;
          break;
        }
        if (done) break;
      }
      if (done) break;
    }
    return done;
  };
  for (const input of [...inputs].sort(byPriority)) {
    let done = false;
    for (const pass of soft.length === 0 ? [false] : [true, false]) {
      avoidSoft = pass;
      done = placeOne(input);
      if (done) break;
    }
    if (!done) skipped.push(input.name);
  }
  return { placed, skipped, leaders };
}

/** A pill badge's estimated width for its text (700 8 px: about 5 px a character, plus 5 px; at least the badge's diameter), as `drawBadge` measures it. */
export const pillWidthOf = (text: string): number => Math.max(BADGE_SIZE.diameter, text.length * 5 + 5);

/**
 * What a drawn pin covers, relative to its point, y down (review PR-16): its head with the keyline
 * (unless `head` is false), and each drawn pill (the count "×n" at the bottom right, growing to the
 * right of its slot; the level at the top right, centred on it), rim included. The labels and step
 * numbers keep clear of these (here, in the lazy map chunk, rather than in map/marks, which the
 * entry holds).
 */
export function pinBoxes(diameter: number, pills: { readonly count: string | null; readonly level: string | null }, head = true): readonly Box[] {
  const { radius, centreToPoint } = pinGeometry(diameter);
  const reach = radius + PIN_LINES.keyline;
  const boxes: Box[] = head ? [{ x0: -reach, y0: -centreToPoint - reach, x1: reach, y1: -centreToPoint + reach }] : [];
  const half = BADGE_SIZE.diameter / 2 + BADGE_SIZE.rim;
  const pill = (slot: BadgeSlot, text: string, grows: boolean): void => {
    const centre = badgeCentre(slot, radius);
    const x = centre.x;
    const y = centre.y - centreToPoint;
    const width = pillWidthOf(text);
    const left = grows ? x - BADGE_SIZE.diameter / 2 : x - width / 2;
    boxes.push({ x0: left - BADGE_SIZE.rim, y0: y - half, x1: left + width + BADGE_SIZE.rim, y1: y + half });
  };
  if (pills.count !== null) pill(BADGE_SLOT_OF.count, pills.count, true);
  if (pills.level !== null) pill(BADGE_SLOT_OF.level, pills.level, false);
  return boxes;
}

/** A step bead in view, for the numbers. */
export interface BeadInput {
  readonly stepId: StepId;
  /** The bead's centre in screen pixels. */
  readonly x: number;
  readonly y: number;
  readonly number: number;
  /** 0 the active step, 1 a selected step, 2 any other. */
  readonly rank: 0 | 1 | 2;
}

export interface PlacedNumber {
  readonly stepId: StepId;
  readonly number: number;
  /** Where the text starts (left, middle), offset up and right of the bead. */
  readonly x: number;
  readonly y: number;
}

/** A step number's estimated width: its digits at 0.62 of the size each. */
const stepNumberWidth = (number: number): number => String(number).length * STEP_NUMBERS.size * 0.62;

/** Where a number may sit round its bead, in order: right or left (sign of x), up or down (sign of y, times `STEP_NUMBERS.dy`). */
const NUMBER_SPOTS: readonly (readonly [number, number])[] = [
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];

/**
 * A step number's box as drawn (`drawStepNumbers`: 11 px semibold, left and middle at its point),
 * `stepNumberWidth` wide, with the halo's 1.5 px round it.
 */
export function stepNumberBox(x: number, y: number, number: number): Box {
  const width = stepNumberWidth(number);
  const half = STEP_NUMBERS.size / 2;
  return { x0: x - 1.5, y0: y - half - 1.5, x1: x + width + 1.5, y1: y + half + 1.5 };
}

/**
 * The step numbers to draw (§13.6): the active step's first, then the selected steps, then route
 * order; a bead within `minDistance` pixels of one already numbered is skipped, and at most
 * `maxInView` are drawn. A number whose box would cover one of `obstacles` (the pins' heads and
 * pills, review PR-16: "27" over a "×2" reads as one number) moves round its bead (`NUMBER_SPOTS`),
 * and is skipped when no spot is clear. Deterministic.
 */
export function placeStepNumbers(
  beads: readonly BeadInput[],
  options: { readonly minDistance?: number; readonly maxInView?: number; readonly obstacles?: readonly Box[] } = {},
): { readonly drawn: readonly PlacedNumber[]; readonly skipped: number } {
  const minDistance = options.minDistance ?? STEP_NUMBERS.minDistance;
  const max = options.maxInView ?? STEP_NUMBERS.maxInView;
  const obstacles = options.obstacles ?? [];
  const order = [...beads].sort((a, b) => a.rank - b.rank || a.number - b.number);
  const drawn: PlacedNumber[] = [];
  const at: { x: number; y: number }[] = [];
  const minSq = minDistance * minDistance;
  let skipped = 0;
  for (const bead of order) {
    if (drawn.length >= max || at.some((p) => (p.x - bead.x) * (p.x - bead.x) + (p.y - bead.y) * (p.y - bead.y) < minSq)) {
      skipped += 1;
      continue;
    }
    // Up and right of the bead (§13.6), else down and right, up and left, down and left: the first clear of the obstacles.
    const width = stepNumberWidth(bead.number);
    const spot = NUMBER_SPOTS.map(([sx, sy]) => ({ x: sx > 0 ? bead.x + STEP_NUMBERS.dx : bead.x - STEP_NUMBERS.dx - width, y: bead.y + sy * STEP_NUMBERS.dy })).find(
      (p) => !obstacles.some((obstacle) => boxesOverlap(obstacle, stepNumberBox(p.x, p.y, bead.number))),
    );
    if (spot === undefined) {
      skipped += 1;
      continue;
    }
    at.push({ x: bead.x, y: bead.y });
    drawn.push({ stepId: bead.stepId, number: bead.number, x: spot.x, y: spot.y });
  }
  return { drawn, skipped };
}

// =============================================================================================
// Label forms and ranges

/**
 * A compact or zone label's one line (§13.3, §13.5): the name, then the compact span ("13–25") and
 * its basis marker (the boxed E) when the card has one; a zone with cited text shows its name alone.
 */
export function lineParts(label: LabelDescriptor): { readonly name: string; readonly span: string | null; readonly derived: boolean } {
  const card = label.card;
  const span = card?.compact ?? null;
  return { name: label.text, span, derived: span !== null && card?.basis === 'derived' };
}

/** The boxed E after a derived span: its width in pixels (the letter and its box). */
const BASIS_MARK_PX = 11;

/**
 * The forms a label may take at a scale (§13.3 to §13.5): a continent name 18 px; an inset's 12 px;
 * a place 10 px; a zone a two-line card from 0.05 px per yard to the zone band (falling back to the
 * compact line), a 13 px zone label from the zone band, and below 0.05 the compact line at 11 px,
 * then 10 px.
 */
/** A card's third line: the zone's faction words while the overlay is shown (§12.6; review PR-15), 10 px, 13 px below line 2. */
export const CARD_FACTION_LINE = { size: 10, dy: 13 } as const;

/**
 * `faction`: the zone's words while the faction overlay is shown (§12.6), a third line on the card,
 * which is then taller and at least as wide as the words.
 */
export function labelForms(label: LabelDescriptor, pxPerYard: number, measure: Measure, family: string, faction: string | null = null): readonly LabelForm[] {
  const line = (size: number): LabelForm => {
    const { name, span, derived } = lineParts(label);
    let width = measure(name, fontOf(size, 600, family));
    if (span !== null) width += 4 + measure(span, fontOf(size - 1, 400, family)) + (derived ? BASIS_MARK_PX + 2 : 0);
    return { kind: 'line', width, height: size + LABEL_TEXT.lineGap, size };
  };
  switch (label.kind) {
    case 'continent':
      return [line(LABEL_TEXT.continent)];
    case 'inset':
      return [line(LABEL_TEXT.inset)];
    case 'place':
      return [line(LABEL_TEXT.place)];
    case 'zone': {
      if (pxPerYard >= ZONE_LABEL_FROM_PX_PER_YARD) return [line(LABEL_TEXT.zone), line(LABEL_TEXT.compact)];
      const compact = [line(LABEL_TEXT.compact), line(LABEL_TEXT.compactSmall)];
      const card = label.card;
      if (card === null || pxPerYard < CARD_FROM_PX_PER_YARD) return compact;
      // Line 2 always keeps room for the difficulty twin, rated or not, so a step change never widens the card.
      const second = card.span === null ? 0 : chipWidth('88', measure, family) + 3 + measure(card.span, fontOf(LABEL_TEXT.cardLine2, 400, family)) + (card.basis === 'derived' ? BASIS_MARK_PX + 3 : 0);
      const third = faction === null ? 0 : measure(faction, fontOf(CARD_FACTION_LINE.size, 400, family));
      const height = faction === null ? 30 : 30 + CARD_FACTION_LINE.dy;
      return [{ kind: 'card', width: Math.max(card.widthPx, measure(card.name, fontOf(LABEL_TEXT.card, 600, family)), second, third) + 4, height, size: LABEL_TEXT.card }, ...compact];
    }
  }
}

const HYSTERESIS = 2 ** BAND_HYSTERESIS_ZOOM;

/**
 * Whether a label is in range at a scale (`minPxPerYard` to `maxPxPerYard`), with the bands'
 * hysteresis on both edges (§5.1: thresholds inside the bands use the same rule): a label drawn at
 * the last resting view (`previous` true) stays until the scale leaves its range by 0.125 zoom; one
 * that was not (`previous` false) shows only once the scale is inside it by as much; `previous`
 * null (never placed yet) compares plainly.
 */
export function labelInRange(label: Pick<LabelDescriptor, 'minPxPerYard' | 'maxPxPerYard'>, pxPerYard: number, previous: boolean | null): boolean {
  const margin = previous === true ? 1 / HYSTERESIS : previous === false ? HYSTERESIS : 1;
  const aboveMin = label.minPxPerYard <= 0 || pxPerYard >= label.minPxPerYard * margin;
  const belowMax = label.maxPxPerYard === null || pxPerYard < label.maxPxPerYard / margin;
  return aboveMin && belowMax;
}

// =============================================================================================
// Drawing

/** The part of a 2D context the labels use. */
export interface LabelCanvas {
  font: string;
  fillStyle: unknown;
  strokeStyle: unknown;
  lineWidth: number;
  lineJoin: string;
  textAlign: string;
  textBaseline: string;
  globalAlpha: number;
  save(): void;
  restore(): void;
  beginPath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  arc(x: number, y: number, radius: number, start: number, end: number): void;
  rect(x: number, y: number, w: number, h: number): void;
  fill(): void;
  stroke(): void;
  fillText(text: string, x: number, y: number): void;
  strokeText(text: string, x: number, y: number): void;
  setLineDash(segments: number[]): void;
}

export interface LabelInk {
  readonly ink: string;
  readonly halo: string;
  readonly font: string;
}

const NO_DASH: number[] = [];

/** Text with a 3 px halo under it. */
export function haloText(ctx: LabelCanvas, text: string, x: number, y: number, font: string, ink: LabelInk, align: 'left' | 'center' = 'left'): void {
  ctx.font = font;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.lineWidth = LABEL_TEXT.halo;
  ctx.strokeStyle = ink.halo;
  ctx.strokeText(text, x, y);
  ctx.fillStyle = ink.ink;
  ctx.fillText(text, x, y);
}

/**
 * Draws one placed label: its leader first (a haloed hairline to a dot at the anchor), then the card
 * (with the difficulty twin on line 2 when it is rated and `chip` is given) or the line.
 */
export function drawPlacedLabel(ctx: LabelCanvas, label: LabelDescriptor, placed: PlacedLabel, ink: LabelInk, measure: Measure, chip: ChipInk | null = null, faction: string | null = null): void {
  const { box, form } = placed;
  ctx.setLineDash(NO_DASH);
  if (placed.leader) {
    const ex = Math.max(box.x0, Math.min(box.x1, placed.x));
    const ey = Math.max(box.y0, Math.min(box.y1, placed.y));
    ctx.beginPath();
    ctx.moveTo(placed.x, placed.y);
    ctx.lineTo(ex, ey);
    ctx.lineWidth = 3;
    ctx.strokeStyle = ink.halo;
    ctx.stroke();
    ctx.lineWidth = 1;
    ctx.strokeStyle = ink.ink;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(placed.x, placed.y, 1.8, 0, 2 * Math.PI);
    ctx.fillStyle = ink.ink;
    ctx.fill();
  }
  const midY = (box.y0 + box.y1) / 2;
  if (form.kind === 'card' && label.card !== null) {
    const card = label.card;
    haloText(ctx, card.name, box.x0 + 2, box.y0 + 8, fontOf(LABEL_TEXT.card, 600, ink.font), ink);
    if (card.span !== null) {
      const font = fontOf(LABEL_TEXT.cardLine2, 400, ink.font);
      let x = box.x0 + 2;
      if (card.difficulty !== null && chip !== null) x += drawDifficultyChip(ctx, x, box.y0 + 22, card.difficulty, chip, measure) + 3;
      haloText(ctx, card.span, x, box.y0 + 22, font, ink);
      if (card.basis === 'derived') basisMark(ctx, x + measure(card.span, font) + 3, box.y0 + 22, ink);
    }
    // The zone's faction words while the overlay is shown (§12.6: "the words in the zone's hover and card").
    if (faction !== null && box.y1 - box.y0 >= 30 + CARD_FACTION_LINE.dy) haloText(ctx, faction, box.x0 + 2, box.y0 + 22 + CARD_FACTION_LINE.dy, fontOf(CARD_FACTION_LINE.size, 400, ink.font), ink);
    return;
  }
  const { name, span, derived } = lineParts(label);
  const nameFont = fontOf(form.size, 600, ink.font);
  const x = box.x0 + 1;
  haloText(ctx, name, x, midY, nameFont, ink);
  if (span === null) return;
  const spanFont = fontOf(form.size - 1, 400, ink.font);
  const spanX = x + measure(name, nameFont) + 4;
  haloText(ctx, span, spanX, midY, spanFont, ink);
  if (derived) basisMark(ctx, spanX + measure(span, spanFont) + 2, midY, ink);
}

/** The boxed E: the span's basis marker (UI.md §4: derived), a letter in a small box. */
function basisMark(ctx: LabelCanvas, x: number, y: number, ink: LabelInk): void {
  ctx.beginPath();
  ctx.rect(x, y - 5.5, BASIS_MARK_PX - 1, 11);
  ctx.lineWidth = 3;
  ctx.strokeStyle = ink.halo;
  ctx.stroke();
  ctx.lineWidth = 1;
  ctx.strokeStyle = ink.ink;
  ctx.stroke();
  haloText(ctx, 'E', x + (BASIS_MARK_PX - 1) / 2, y + 0.5, fontOf(9, 600, ink.font), ink, 'center');
}

/** Draws the step numbers (11 px, haloed), left-aligned at their places. */
export function drawStepNumbers(ctx: LabelCanvas, numbers: readonly PlacedNumber[], ink: LabelInk): void {
  const font = fontOf(STEP_NUMBERS.size, 600, ink.font);
  for (const n of numbers) haloText(ctx, String(n.number), n.x, n.y, font, ink);
}
