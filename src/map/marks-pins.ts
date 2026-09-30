/**
 * The pins' part of the one path set and state table (docs/research/map-presentation.md revision 3.1
 * §25.2.1 to §25.2.7; D-047): the glyphs only the pins and the Map layers drawer draw, the glyph
 * boxes and badge thresholds, the pin, pip-tag and badge geometry, the pins' colour and group rules,
 * and their extents and hit targets.
 *
 * - **One module in two files.** This file belongs to `map/marks` (tests/architecture.test.ts), and
 *   its values are defined here once. It is kept apart from `marks.ts` so that the entry chunk,
 *   which holds the route rows' `QuestMark` and therefore `marks.ts`, does not carry what only the
 *   lazy map chunk (`map/leaflet`) and the drawer (a lazy part) read: the ledger's planned move of
 *   the pin-only exports (docs/research/ui-refresh.md §10.3; review UI-17).
 * - **Pure**: no DOM, clock, randomness or bitwise operator; it imports only `marks.ts`, which
 *   imports nothing (ARCHITECTURE §17).
 */
import {
  DUNGEON_GLYPH,
  isQuestGlyph,
  markColour,
  MARK_STATES,
  PIPS_LIT,
  QUEST_GLYPH,
  resolveMarkLook,
  TURN_IN_GLYPH,
  type BadgeKind,
  type BadgeSlot,
  type GlyphPath,
  type MarkDifficulty,
  type MarkEdge,
  type MarkGlyph,
  type MarkState,
  type ResolvedMarkLook,
} from './marks';

// =============================================================================================
// Glyph paths (the pins' and the drawer's; the route rows' "!", "?" and arch are in marks.ts)

/** A counted objective (§7.4): a ring with a centre dot. */
export const OBJECTIVE_GLYPH: GlyphPath = [
  { d: 'M12 5.6a6.4 6.4 0 1 1 0 12.8a6.4 6.4 0 1 1 0-12.8z', mode: 'stroke', width: 2.3 },
  { d: 'M12 9.8a2.2 2.2 0 1 1 0 4.4a2.2 2.2 0 1 1 0-4.4z', mode: 'fill' },
];

/** A raid entrance: a gate under three merlons. */
export const RAID_GLYPH: GlyphPath = [
  { d: 'M3.6 20.2V8.4h2.6V5.2h2.8v3.2h1.6V5.2h2.8v3.2h1.6V5.2h2.8v3.2h2.6v11.8h-5.3v-5.2a2.9 2.9 0 0 0-5.8 0v5.2z', mode: 'fill' },
];

/** A flight point: the filled form of the route rows' paper plane (review UR-12). */
export const FLIGHT_GLYPH: GlyphPath = [
  { d: 'M3.2 12.3 20.6 4.2 15.1 20.1 11.3 13.9z', mode: 'fill' },
  { d: 'M11.3 13.9 20.6 4.2', mode: 'cut', width: 1.5 },
];

/** A transport stop: a hull with two sails. */
export const TRANSPORT_GLYPH: GlyphPath = [
  { d: 'M3 14.6h18l-3 5.2H6.2z', mode: 'fill' },
  { d: 'M10.9 3.6v9.6H5z', mode: 'fill' },
  { d: 'M12.7 5.8v7.4h5.4z', mode: 'fill' },
];

/** A portal: an upright oval ring with a core. */
export const PORTAL_GLYPH: GlyphPath = [
  { d: 'M12 3.6c3 0 5.4 3.8 5.4 8.4s-2.4 8.4-5.4 8.4-5.4-3.8-5.4-8.4 2.4-8.4 5.4-8.4z', mode: 'stroke', width: 2.4 },
  { d: 'M12 8c1.3 0 2.3 1.8 2.3 4s-1 4-2.3 4-2.3-1.8-2.3-4 1-4 2.3-4z', mode: 'fill' },
];

/** An innkeeper: the hearth house with its flame (the route rows' hearth, filled). */
export const INNKEEPER_GLYPH: GlyphPath = [
  { d: 'M5.9 10.2 12 4.6l6.1 5.6v9.9H5.9z', mode: 'fill' },
  { d: 'M3.6 11.2 12 3.6l8.4 7.6', mode: 'stroke', width: 1.9 },
  { d: 'M12 18.9c-1.6 0-2.5-1.15-2.5-2.45 0-1.9 2.5-3.3 2.5-4.75 0 0 2.5 2 2.5 4.75 0 1.3-.9 2.45-2.5 2.45z', mode: 'cut-fill' },
];

/** A class trainer: an open book. */
export const TRAINER_GLYPH: GlyphPath = [
  { d: 'M3.2 6.4c3-1 6.2-.7 8 1.1v12.2c-2-1.4-5-1.7-8-.8z', mode: 'fill' },
  { d: 'M20.8 6.4c-3-1-6.2-.7-8 1.1v12.2c2-1.4 5-1.7 8-.8z', mode: 'fill' },
];

/** A vendor: a bag (the route rows' bag, filled). */
export const VENDOR_GLYPH: GlyphPath = [
  { d: 'M4.9 8.6h14.2l-1.15 11.7H6.05z', mode: 'fill' },
  { d: 'M8.6 8.6V7.4a3.4 3.4 0 0 1 6.8 0v1.2', mode: 'stroke', width: 1.9 },
];

export const MARK_GLYPH_NAMES: readonly MarkGlyph[] = ['quest', 'turn-in', 'objective', 'dungeon', 'raid', 'flight', 'transport', 'portal', 'innkeeper', 'trainer', 'vendor'];

/** Every glyph's path by name: for the pins (the lazy map chunk). The route rows import `QUEST_GLYPH` and `TURN_IN_GLYPH` alone. */
export const MARK_GLYPHS: Readonly<Record<MarkGlyph, GlyphPath>> = {
  quest: QUEST_GLYPH,
  'turn-in': TURN_IN_GLYPH,
  objective: OBJECTIVE_GLYPH,
  dungeon: DUNGEON_GLYPH,
  raid: RAID_GLYPH,
  flight: FLIGHT_GLYPH,
  transport: TRANSPORT_GLYPH,
  portal: PORTAL_GLYPH,
  innkeeper: INNKEEPER_GLYPH,
  trainer: TRAINER_GLYPH,
  vendor: VENDOR_GLYPH,
};

// =============================================================================================
// Glyph boxes and badge thresholds (§25.2.1)

/** The glyph box of a quest pin ("!" and "?") as a share of the head's diameter (§25.2.1, review UO-04). */
export const QUEST_GLYPH_BOX = 0.7;
/** The glyph box of every other pin. */
export const OTHER_GLYPH_BOX = 0.66;

/** A pin's glyph box in pixels. */
export const pinGlyphBoxPx = (diameter: number, glyph: MarkGlyph): number => diameter * (isQuestGlyph(glyph) ? QUEST_GLYPH_BOX : OTHER_GLYPH_BOX);

/**
 * The smallest pin head that shows a quest's colour: D 16, whose glyph box is 11.2 px (continent-
 * band sizes are bucketed to even pixels, `bucketPinDiameter`, so D 14's 9.8 px never colours).
 */
export const PIN_COLOUR_FROM_D = 16;
/** Badges other than the count pill are drawn from D 20; below it the hover names them (§25.2.3). */
export const PIN_BADGES_FROM_D = 20;
/** The pip tag is drawn from D 16, with the colour. */
export const PIP_TAG_FROM_D = PIN_COLOUR_FROM_D;

// =============================================================================================
// Pin geometry (§25.2.1, §25.2.4)

/** The point sits this share of the head's diameter below the head's lowest point (§25.2.1). */
export const PIN_POINT_RATIO = 0.36;

export interface PinGeometry {
  /** The head's radius. */
  readonly radius: number;
  /** From the head's centre down to the point. */
  readonly centreToPoint: number;
  /** Half the angle at the point between the two tangents to the head. */
  readonly halfAngle: number;
  /** From the head's top to the point. */
  readonly height: number;
}

/** A teardrop of head diameter `diameter` (26 → a 26 × 35 px pin, half-angle about 36°). */
export function pinGeometry(diameter: number): PinGeometry {
  const radius = diameter / 2;
  const centreToPoint = radius + PIN_POINT_RATIO * diameter;
  return { radius, centreToPoint, halfAngle: Math.asin(radius / centreToPoint), height: radius + centreToPoint };
}

/** Lines of a pin (§25.2.1, §25.2.3), in pixels. */
export const PIN_LINES = {
  /** The keyline outside the body. */
  keyline: 1.5,
  /** A hovered pin's keyline. */
  keylineHover: 2.5,
  /** The dashed edge ("not sure"): on, off. */
  dash: [3.2, 2.4] as readonly number[],
  /** The double edge ("both factions"): an inner ring this far inside the keyline. */
  doubleInset: 2.6,
  /** A selected pin: scale, its ring in the style's route colour, and the halo laid on both sides of it. */
  selectedScale: 1.15,
  selectionRing: 3,
  selectionHalo: 1.5,
} as const;

/** The light family (services) and counted objectives are drawn at this share of the band's diameter (§25.2.2). */
export const SMALL_PIN_SCALE = 0.8;

/**
 * The pip tag (§25.2.1, revision 3.1): `DifficultyLabel`'s staircase on a small tag at the head's
 * left (9 o'clock, the side no badge uses), in the pin's two tones, overlapping the head.
 */
export const PIP_TAG = { width: 18, height: 10, overlap: 2.5, keyline: 1.2, radius: 2.5, barWidth: 2, barGap: 1, minBarHeight: 2, maxBarHeight: 6 } as const;

/** Where the pip tag's five bars go, relative to the tag's left edge and baseline: x offset and height for each, lit or not. */
export function pipBars(difficulty: MarkDifficulty): readonly { readonly x: number; readonly height: number; readonly lit: boolean }[] {
  const lit = PIPS_LIT[difficulty];
  return [0, 1, 2, 3, 4].map((i) => ({ x: i * (PIP_TAG.barWidth + PIP_TAG.barGap), height: PIP_TAG.minBarHeight + i, lit: i < lit }));
}

// =============================================================================================
// Badges (§25.2.1, §25.2.3)

/** A badge's diameter (a light disc or pill with a dark rim, readable on either family) and its rim. */
export const BADGE_SIZE = { diameter: 10, rim: 1.2 } as const;

/**
 * A badge's centre relative to the head's centre, in pixels (y down): on the 45° diagonals, at
 * this share of the radius along each axis (the reviewed mock's placement, where the badge sits
 * across the rim).
 */
export const BADGE_OFFSET = 0.8;

export function badgeCentre(slot: BadgeSlot, radius: number): { readonly x: number; readonly y: number } {
  const x = slot === 'tl' || slot === 'bl' ? -1 : 1;
  const y = slot === 'tl' || slot === 'tr' ? -1 : 1;
  return { x: x * radius * BADGE_OFFSET, y: y * radius * BADGE_OFFSET };
}

/** The badges drawn at a head size: every one from `PIN_BADGES_FROM_D`, below it only the count pill (the hover names the rest). */
export const badgesDrawnAt = (diameter: number, badges: readonly BadgeKind[]): readonly BadgeKind[] =>
  diameter >= PIN_BADGES_FROM_D ? badges : badges.filter((badge) => badge === 'count');

// =============================================================================================
// Pin colour and groups (§25.2.3, §25.2.5)

/** A pin's colour: `markColour` on its glyph box (a light-family pin never takes one). */
export function pinColour(state: MarkState, difficulty: MarkDifficulty | null, diameter: number): { readonly difficulty: MarkDifficulty; readonly pips: true } | null {
  const base = MARK_STATES[state];
  if (base.family === 'light') return null;
  return markColour(state, difficulty, pinGlyphBoxPx(diameter, base.glyph));
}

/** One member of a stack or a cluster, as the group rule needs it. */
export interface GroupMember {
  readonly state: MarkState;
  readonly difficulty: MarkDifficulty | null;
}

/**
 * A stack's or cluster's look (§25.2.3, §25.2.5): its members' glyph (the first member's state
 * gives it; members are of one kind), with "×n"; dashed only when every member is; the members'
 * colour and pips only when every member shows one and they all share it; otherwise none.
 */
export function groupLook(members: readonly GroupMember[], shapePx: number): { readonly look: ResolvedMarkLook; readonly colour: MarkDifficulty | null } | null {
  const [first] = members;
  if (first === undefined) return null;
  const allDashed = members.every((member) => MARK_STATES[member.state].edge === 'dashed');
  const base = resolveMarkLook(first.state, { count: members.length });
  const colours = members.map((member) => markColour(member.state, member.difficulty, shapePx)?.difficulty ?? null);
  const [shared] = colours;
  const uniform = shared !== undefined && shared !== null && colours.every((colour) => colour === shared);
  const edge: MarkEdge = allDashed ? 'dashed' : base.edge === 'dashed' ? 'solid' : base.edge;
  return { look: { ...base, edge }, colour: uniform ? shared : null };
}

/** Fills a spoken template's `{name}` parts; a part with no value stays as written (so a missing value is visible in tests). */
export function fillSpoken(template: string, values: Readonly<Record<string, string | number>>): string {
  return template.replace(/\{(\w+)\}/g, (whole, name: string) => {
    const value = values[name];
    return value === undefined ? whole : String(value);
  });
}

// =============================================================================================
// Extents and hit targets (§25.2.7)

/**
 * A pin's paint extent around its point, in pixels (left, right, up, down): the head, the point,
 * the pip tag on the left when coloured, the badge slots, and a count pill's width on the right;
 * a selected pin adds its ring and halo. The bitmap cache sizes each pin's bitmap by it (§25.7).
 */
export function pinExtent(diameter: number, options: { readonly tag?: boolean; readonly pill?: boolean; readonly selected?: boolean } = {}): {
  readonly left: number;
  readonly right: number;
  readonly up: number;
  readonly down: number;
} {
  const { radius, height } = pinGeometry(diameter);
  const pad = options.selected === true ? 8 : 3;
  return {
    left: Math.ceil(radius + (options.tag === true ? 17 : 6) + pad),
    right: Math.ceil(radius + (options.pill === true ? 22 : 6) + pad),
    up: Math.ceil(height + 6 + pad),
    down: Math.ceil(2 + (options.selected === true ? 10 : 0)),
  };
}

/** The smallest pointer target, a square this many pixels across, for pins under `PIN_BADGES_FROM_D` (WCAG 2.2 SC 2.5.8). */
export const MIN_TARGET_PX = 24;

/** A pin's pointer target: its head circle plus 2 px (at least a `MIN_TARGET_PX` square below D 20), and the triangle down to its point. */
export function pinTarget(diameter: number): { readonly headOffsetY: number; readonly radius: number; readonly minSquare: number | null } {
  const { radius, centreToPoint } = pinGeometry(diameter);
  return { headOffsetY: -centreToPoint, radius: radius + 2, minSquare: diameter < PIN_BADGES_FROM_D ? MIN_TARGET_PX : null };
}

/** Pins of one kind whose head centres lie within this share of the diameter merge into one "×n" pin at the zone and close bands (§25.2.5). */
export const STACK_MERGE_RATIO = 0.4;
