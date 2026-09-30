import { ART_H, ART_W, ATLAS_PARAMS as PAR } from './atlas-params';
import type { AtlasBounds } from './atlas-plan';
import { boxMask, interiorWeight, smooth } from './atlas-raster';
import type { Segment } from './atlas-mask';
import type { Candidate } from './atlas-detect';

/**
 * The reviewed label list and the lettering census (docs/research/map-atlas.md §6.5; D-042 A11).
 *
 * `tools/maps/inputs/atlas-labels.json` holds one entry per painted label a rule applies to: the
 * painting (UiMap), the label's box in source pixels, the rule (`whole`: drawn whole across its
 * painting's polygon, coastal band or frame edge; `hide`: removed as a whole by a mirror fill from
 * the same painting), the levels (`all`, or `fine` for levels −1 and 0 only), the reason, and the
 * painting's `pixelsSha256`, so a changed painting stops the build until its entries are reviewed
 * again (check T9). The list is seeded by the detector (atlas-detect.ts) and the census below, then
 * reviewed on the contact sheet (atlas-review.ts); nothing adds an entry by itself.
 *
 * The census screens every detector candidate at the level −2 rules (the zone band): at 21 points
 * of its box (widened by 3 px) it measures the share of the detail its painting keeps (own detail
 * weight over all detail weights, times coverage), with the whole rules applied. A candidate is
 * `whole` when every point keeps ≥ 0.85, `hidden` when every point keeps ≤ 0.15, and `cut`
 * otherwise; a candidate a hide entry covers at every level is `hidden-by-rule`. Capital banners
 * hidden at levels −1 and 0 only are still tested at −2, where they must be whole. At levels −1
 * and 0 a candidate that is not hidden there is also `cut` when part of it lies under a city plan
 * or card drawn there.
 */

export const ATLAS_LABELS_FILE = 'tools/maps/inputs/atlas-labels.json';

export type LabelRule = 'whole' | 'hide';
export type LabelLevels = 'all' | 'fine';
export type Box = readonly [number, number, number, number];

export interface AtlasLabelEntry {
  readonly uiMapId: number;
  /** The painting's name (for reading the file). */
  readonly name: string;
  /** What the label says, as read on the painting. */
  readonly label: string;
  readonly box: Box;
  readonly rule: LabelRule;
  readonly levels: LabelLevels;
  readonly reason: string;
  /** `detector`: the box is a detector candidate's; `hand`: measured on the painting by eye. */
  readonly origin: 'detector' | 'hand';
  readonly pixelsSha256: string;
}

export interface AtlasLabelList {
  readonly labels: readonly AtlasLabelEntry[];
}

type Json = Readonly<Record<string, unknown>>;
const isRecord = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value);

/** Checks the list's shape; `errors` is empty exactly when `list` is not null. */
export function parseAtlasLabels(value: unknown): { readonly list: AtlasLabelList | null; readonly errors: readonly string[] } {
  const errors: string[] = [];
  if (!isRecord(value)) return { list: null, errors: ['(root): must be an object'] };
  if (value['schema'] !== 1) errors.push('schema must be 1');
  if (value['kind'] !== 'atlas-labels') errors.push('kind must be "atlas-labels"');
  const labels: AtlasLabelEntry[] = [];
  if (!Array.isArray(value['labels'])) errors.push('labels must be an array');
  else {
    (value['labels'] as readonly unknown[]).forEach((entry, i) => {
      const where = `labels[${String(i)}]`;
      if (!isRecord(entry)) {
        errors.push(`${where}: must be an object`);
        return;
      }
      const problems: string[] = [];
      const uiMapId = entry['uiMapId'];
      if (typeof uiMapId !== 'number' || !Number.isInteger(uiMapId) || uiMapId < 1) problems.push('uiMapId must be a positive integer');
      for (const key of ['name', 'label', 'reason']) if (typeof entry[key] !== 'string' || (entry[key]).trim() === '') problems.push(`${key} must be a non-empty string`);
      const box = entry['box'];
      const okBox =
        Array.isArray(box) &&
        box.length === 4 &&
        box.every((v) => typeof v === 'number' && Number.isInteger(v)) &&
        (box[0] as number) >= 0 &&
        (box[1] as number) >= 0 &&
        (box[2] as number) < ART_W &&
        (box[3] as number) < ART_H &&
        (box[0] as number) < (box[2] as number) &&
        (box[1] as number) < (box[3] as number);
      if (!okBox) problems.push(`box must be [x0, y0, x1, y1] of whole source pixels inside ${String(ART_W)} × ${String(ART_H)}, x0 < x1, y0 < y1`);
      const rule = entry['rule'];
      if (rule !== 'whole' && rule !== 'hide') problems.push('rule must be "whole" or "hide"');
      const levels = entry['levels'];
      if (levels !== 'all' && levels !== 'fine') problems.push('levels must be "all" or "fine"');
      if (rule === 'whole' && levels !== 'all') problems.push('a whole rule applies at every level ("all")');
      const origin = entry['origin'];
      if (origin !== 'detector' && origin !== 'hand') problems.push('origin must be "detector" or "hand"');
      if (typeof entry['pixelsSha256'] !== 'string' || !/^[0-9a-f]{64}$/.test(entry['pixelsSha256'])) problems.push('pixelsSha256 must be a lowercase hex SHA-256');
      if (problems.length > 0) {
        errors.push(...problems.map((p) => `${where}: ${p}`));
        return;
      }
      const b = box as readonly number[];
      labels.push({
        uiMapId: uiMapId as number,
        name: entry['name'] as string,
        label: entry['label'] as string,
        box: [b[0] ?? 0, b[1] ?? 0, b[2] ?? 0, b[3] ?? 0],
        rule: rule as LabelRule,
        levels: levels as LabelLevels,
        reason: entry['reason'] as string,
        origin: origin as 'detector' | 'hand',
        pixelsSha256: entry['pixelsSha256'] as string,
      });
    });
  }
  const keys = labels.map((l) => `${String(l.uiMapId)}:${l.box.join(',')}:${l.rule}`);
  if (new Set(keys).size !== keys.length) errors.push('labels lists a box twice with the same rule');
  return errors.length === 0 ? { list: { labels }, errors } : { list: null, errors };
}

/** Whether two boxes overlap, `a` widened by `pad` pixels. */
export const boxesOverlap = (a: Box, b: Box, pad = 0): boolean => !(a[2] + pad < b[0] || a[0] - pad > b[2] || a[3] + pad < b[1] || a[1] - pad > b[3]);

// ---------------------------------------------------------------------------------------------
// The census

/** One painting as the census sees it (zones and cities of one world map). */
export interface CensusPainting {
  readonly uiMapId: number;
  readonly name: string;
  readonly cls: 'zone' | 'city';
  readonly mapId: number;
  readonly bounds: AtlasBounds;
  /** The polygon boundary; empty for a card. */
  readonly segs: readonly Segment[];
  /** Overlay alpha per source pixel (zones only). */
  readonly overlayAlpha: Uint8Array | null;
  /** Drawn as a card at levels −1 and 0 (no terrain polygon). */
  readonly card: boolean;
}

/** Distance to terrain land in yards at a world point of a map (inland water counts as water). */
export type LandDistance = (mapId: number, X: number, Y: number) => number;

export type LetterState = 'whole' | 'whole-by-rule' | 'hidden' | 'hidden-by-rule' | 'cut';

export interface CensusLabel {
  readonly uiMapId: number;
  readonly name: string;
  readonly box: Box;
  readonly polarity: string;
  /** At the level −2 rules. */
  readonly state: LetterState;
  /** At levels −1 and 0: hidden by a fine rule, cut by a city plan or card, or as at −2. */
  readonly fineState: LetterState;
  readonly keepMin: number;
  readonly keepMax: number;
  /** The city plans or cards that cover part of it at levels −1 and 0. */
  readonly underCity: readonly string[];
  /** The list entries that apply to it. */
  readonly entries: readonly number[];
  readonly mapId: number;
  /** World and atlas position of its centre. */
  readonly X: number;
  readonly Y: number;
}

export interface LetteringCensus {
  readonly paintings: number;
  readonly candidates: number;
  readonly counts: Readonly<Record<LetterState, number>>;
  readonly fineCounts: Readonly<Record<LetterState, number>>;
  readonly labels: readonly CensusLabel[];
  /** Entries no candidate matched: checked on their own box. */
  readonly entries: readonly { readonly index: number; readonly state: LetterState; readonly fineState: LetterState; readonly keepMin: number; readonly candidates: number }[];
}

const uvW = (b: AtlasBounds, X: number, Y: number): [number, number] => [((b.yMax - Y) / (b.yMax - b.yMin)) * ART_W, ((b.xMax - X) / (b.xMax - b.xMin)) * ART_H];

/** Exact signed distance in yards to a polygon (positive inside, even-odd rule). */
export function signedDistanceYd(segs: readonly Segment[], X: number, Y: number): number {
  let inside = false;
  let dm = 1e18;
  for (const [xa, ya, xb, yb] of segs) {
    if ((xa > X) !== (xb > X) && Y < ya + ((X - xa) * (yb - ya)) / (xb - xa)) inside = !inside;
    const dx = xb - xa;
    const dy = yb - ya;
    const L2 = dx * dx + dy * dy;
    let t = L2 > 0 ? ((X - xa) * dx + (Y - ya) * dy) / L2 : 0;
    t = Math.max(0, Math.min(1, t));
    const ex = xa + t * dx - X;
    const ey = ya + t * dy - Y;
    dm = Math.min(dm, ex * ex + ey * ey);
  }
  return (inside ? 1 : -1) * Math.sqrt(dm);
}

interface WholeRule {
  readonly painting: CensusPainting;
  readonly box: Box;
}

/**
 * The share of the detail `owner` keeps at a world point of its map, by §6.2's level −2 weights
 * (frame interior, coastal band, detail band, painted ground) and the whole rules.
 */
export function keepShare(owner: CensusPainting, X: number, Y: number, paintings: readonly CensusPainting[], whole: readonly WholeRule[], landDistance: LandDistance): number {
  let sumH = 0;
  let own = 0;
  let cov = 0;
  const coastBase = landDistance(owner.mapId, X, Y);
  const coast = coastBase === 0 ? 1 : 1 - smooth(PAR.coastYd[0], PAR.coastYd[1], coastBase);
  for (const p of paintings) {
    if (p.cls !== 'zone' || p.mapId !== owner.mapId) continue;
    const [u, v] = uvW(p.bounds, X, Y);
    if (u <= 0 || v <= 0 || u >= ART_W || v >= ART_H) continue;
    let lmOwn = 0;
    let lmOther = 0;
    for (const w of whole) {
      if (w.painting.mapId !== owner.mapId) continue;
      if (w.painting === p) lmOwn = Math.max(lmOwn, boxMask(u, v, w.box, PAR.wholeFeatherPx));
      else {
        const [wu, wv] = uvW(w.painting.bounds, X, Y);
        lmOther = Math.max(lmOther, boxMask(wu, wv, w.box, PAR.wholeFeatherPx));
      }
    }
    const inner = interiorWeight(u, v, PAR.framePx[0], PAR.framePx[1], PAR.cornerPx);
    const c = Math.max(inner * coast, lmOwn * interiorWeight(u, v, PAR.labelFramePx[0], PAR.labelFramePx[1], PAR.labelCornerPx));
    if (c <= 0) continue;
    const s = p.segs.length > 0 ? signedDistanceYd(p.segs, X, Y) : -1e9;
    const oH = Math.max(lmOwn, smooth(-PAR.detailBandYd, PAR.detailBandYd, s));
    const alpha = p.overlayAlpha === null ? 255 : (p.overlayAlpha[Math.min(ART_H - 1, Math.floor(v)) * ART_W + Math.min(ART_W - 1, Math.floor(u))] ?? 0);
    const pa = smooth(PAR.paintedAlpha[0], PAR.paintedAlpha[1], alpha / 255);
    const wh = c * Math.max(PAR.fallbackWeight * pa, oH) * (1 - lmOther);
    sumH += wh;
    if (p === owner) own = wh;
    cov = Math.max(cov, c * Math.max(oH, pa));
  }
  return sumH > 0 ? (own / sumH) * Math.min(1, cov) : 0;
}

/** The city plan or card of the owner's map drawn over a world point at levels −1 and 0, or null. */
export function cityOver(owner: CensusPainting, X: number, Y: number, paintings: readonly CensusPainting[]): string | null {
  for (const p of paintings) {
    if (p.cls !== 'city' || p.mapId !== owner.mapId) continue;
    const [u, v] = uvW(p.bounds, X, Y);
    if (u <= 0 || v <= 0 || u >= ART_W || v >= ART_H) continue;
    if (p.card) {
      const eu = Math.min(u, ART_W - u);
      const ev = Math.min(v, ART_H - v);
      if (Math.min(eu, ev) > PAR.cardTornPx) return p.name;
    } else if (interiorWeight(u, v, PAR.framePx[0], PAR.framePx[1], PAR.cornerPx) > 0 && signedDistanceYd(p.segs, X, Y) > -PAR.cityBandYd) return p.name;
  }
  return null;
}

const emptyCounts = (): Record<LetterState, number> => ({ whole: 0, 'whole-by-rule': 0, hidden: 0, 'hidden-by-rule': 0, cut: 0 });

/** Tests a box of a painting at 21 points: the keep shares and the cities over it. */
function testBox(p: CensusPainting, box: Box, paintings: readonly CensusPainting[], whole: readonly WholeRule[], landDistance: LandDistance): { keep: number[]; cities: Set<string> } {
  const bx = [box[0] - 3, box[1] - 3, box[2] + 3, box[3] + 3];
  const keep: number[] = [];
  const cities = new Set<string>();
  for (let iy = 0; iy < 3; iy += 1) {
    for (let ix = 0; ix < 7; ix += 1) {
      const u = (bx[0] ?? 0) + ((ix + 0.5) / 7) * ((bx[2] ?? 0) - (bx[0] ?? 0));
      const v = (bx[1] ?? 0) + ((iy + 0.5) / 3) * ((bx[3] ?? 0) - (bx[1] ?? 0));
      const Y = p.bounds.yMax - (u / ART_W) * (p.bounds.yMax - p.bounds.yMin);
      const X = p.bounds.xMax - (v / ART_H) * (p.bounds.xMax - p.bounds.xMin);
      keep.push(keepShare(p, X, Y, paintings, whole, landDistance));
      const c = cityOver(p, X, Y, paintings);
      if (c !== null) cities.add(c);
    }
  }
  return { keep, cities };
}

function states(keep: readonly number[], cities: ReadonlySet<string>, byRule: { whole: boolean; hideAll: boolean; hideFine: boolean }): { state: LetterState; fineState: LetterState } {
  const mn = Math.min(...keep);
  const mx = Math.max(...keep);
  let state: LetterState;
  if (byRule.hideAll) state = 'hidden-by-rule';
  else if (mn >= 0.85) state = byRule.whole ? 'whole-by-rule' : 'whole';
  else if (mx <= 0.15) state = 'hidden';
  else state = 'cut';
  let fineState: LetterState = state;
  if (byRule.hideAll || byRule.hideFine) fineState = 'hidden-by-rule';
  else if (state !== 'hidden' && cities.size > 0) fineState = 'cut';
  return { state, fineState };
}

/**
 * The lettering census over the detector's candidates of every zone painting, with the list's
 * rules; list entries no candidate matched are tested on their own box.
 */
export function letteringCensus(
  candidates: ReadonlyMap<number, readonly Candidate[]>,
  paintings: readonly CensusPainting[],
  entries: readonly AtlasLabelEntry[],
  landDistance: LandDistance,
): LetteringCensus {
  const byId = new Map(paintings.map((p) => [p.uiMapId, p]));
  const whole: WholeRule[] = [];
  for (const e of entries) {
    const p = byId.get(e.uiMapId);
    if (e.rule === 'whole' && p !== undefined) whole.push({ painting: p, box: e.box });
  }
  const labels: CensusLabel[] = [];
  const matched = new Map<number, number>();
  for (const p of paintings) {
    if (p.cls !== 'zone') continue;
    for (const c of candidates.get(p.uiMapId) ?? []) {
      const applying = entries.map((e, i) => ({ e, i })).filter(({ e }) => e.uiMapId === p.uiMapId && boxesOverlap(c.box, e.box, 3));
      for (const { i } of applying) matched.set(i, (matched.get(i) ?? 0) + 1);
      const { keep, cities } = testBox(p, c.box, paintings, whole, landDistance);
      const rule = {
        whole: applying.some(({ e }) => e.rule === 'whole'),
        hideAll: applying.some(({ e }) => e.rule === 'hide' && e.levels === 'all'),
        hideFine: applying.some(({ e }) => e.rule === 'hide' && e.levels === 'fine'),
      };
      const st = states(keep, cities, rule);
      const cu = (c.box[0] + c.box[2]) / 2;
      const cv = (c.box[1] + c.box[3]) / 2;
      labels.push({
        uiMapId: p.uiMapId,
        name: p.name,
        box: c.box,
        polarity: c.polarity,
        ...st,
        keepMin: Math.round(Math.min(...keep) * 100) / 100,
        keepMax: Math.round(Math.max(...keep) * 100) / 100,
        underCity: [...cities].sort(),
        entries: applying.map(({ i }) => i),
        mapId: p.mapId,
        X: Math.round(p.bounds.xMax - (cv / ART_H) * (p.bounds.xMax - p.bounds.xMin)),
        Y: Math.round(p.bounds.yMax - (cu / ART_W) * (p.bounds.yMax - p.bounds.yMin)),
      });
    }
  }
  const entryStates = entries.map((e, index): LetteringCensus['entries'][number] => {
    const p = byId.get(e.uiMapId);
    if (p === undefined) return { index, state: 'cut', fineState: 'cut', keepMin: 0, candidates: 0 };
    const { keep, cities } = testBox(p, e.box, paintings, whole, landDistance);
    // the entry's own rule, and any other rule of the same painting whose box overlaps it
    const applying = entries.filter((o) => o.uiMapId === e.uiMapId && boxesOverlap(e.box, o.box));
    const st = states(keep, cities, {
      whole: applying.some((o) => o.rule === 'whole'),
      hideAll: applying.some((o) => o.rule === 'hide' && o.levels === 'all'),
      hideFine: applying.some((o) => o.rule === 'hide' && o.levels === 'fine'),
    });
    return { index, ...st, keepMin: Math.round(Math.min(...keep) * 100) / 100, candidates: matched.get(index) ?? 0 };
  });
  const counts = emptyCounts();
  const fineCounts = emptyCounts();
  for (const l of labels) {
    counts[l.state] += 1;
    fineCounts[l.fineState] += 1;
  }
  return { paintings: paintings.filter((p) => p.cls === 'zone').length, candidates: labels.length, counts, fineCounts, labels, entries: entryStates };
}
