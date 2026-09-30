/**
 * The one path set and the one state table for every quest mark and map pin
 * (docs/research/map-presentation.md revision 3.1 §25.2.1 to §25.2.4; D-047): the glyph paths, the
 * pin and badge geometry, the state table of §25.2.3, and the D-041 G threshold, defined once.
 *
 * - **Who reads it.** `map/leaflet` draws the pins from these paths (`Path2D`, step MP.4a) and
 *   `map/layers` gives descriptors their states; `ui` reads it through `src/app/map-exports.ts`
 *   for the route rows' `QuestMark` and the Map layers drawer's icons (ui-refresh.md §5.1, UR.2),
 *   so a row's disc and a pin share one object, not copies. `tests/architecture.test.ts` holds the
 *   `map/marks` rule.
 * - **Pure, and it imports nothing**: no DOM, clock, randomness or bitwise operator; plain data and
 *   arithmetic only (ARCHITECTURE §17).
 * - **Our own shapes** on a 24-unit grid (D-039 A: no interface icons; nothing is taken from
 *   WoWF-QRP or MapGenie). The flight point, vendor and innkeeper glyphs are the filled forms of
 *   the route rows' `StepTypeGlyph` paper plane, bag and hearth house (one symbol per concept,
 *   review UR-12). The paths are those of the reviewed mocks' shared stand-in
 *   (`.cache/ui-refresh/shared/marks.js`), which the owner saw on the revision 3.1 sheets.
 * - **Each glyph is its own export**, so a bundle takes only the paths it uses: the route rows need
 *   the "!", the "?" and the arch only (the entry chunk's ledger row, ui-refresh.md §10.3).
 * - **Two files, one module.** What only the pins and the Map layers drawer read (the other glyphs
 *   and `MARK_GLYPHS`, the pin, pip-tag and badge geometry, the pins' colour and group rules, the
 *   extents and hit targets) is in `marks-pins.ts`, which imports this file, so the entry chunk
 *   does not carry it (the ledger's planned move, review UI-17). This file keeps what the rows and
 *   the layer builder need: the rows' glyphs, the state table, the colour rule, the badge slots and
 *   the cluster levels with the pin sizes they are computed from.
 * - **Colour** (D-041 G, D-047): a mark takes its quest's difficulty colour only on a shape of at
 *   least 11 px that carries the colour (a disc mark's diameter, or a pin's glyph box, 0.70 of its
 *   head), and always with the pips beside it (`markColour`). The difficulty colours mean
 *   difficulty only; faction is glyph and outline, never a hue (D-045 item 3).
 *
 * The construction of the "!" (review UR-09): a vertical stroke of constant width 4.4 with round
 * caps from y 4.6 to 13, and a dot of radius 2.5 at y 18.8, both on x 12; it is not tapered. As
 * proportions of its ink height (18.9 units): bar 0.677, foot and top width 0.233, dot centre 0.868,
 * dot radius 0.132. The "?" is a stroke of width 3.9 with round caps and a dot of radius 2.4.
 */

// =============================================================================================
// Glyph paths

/** The glyphs' coordinate box: 24 units square, drawn scaled to the glyph's box in pixels. */
export const GLYPH_BOX_UNITS = 24;

/**
 * One part of a glyph: `fill` filled in the glyph colour; `stroke` stroked in the glyph colour at
 * `width` units, with round caps and joins; `cut` stroked in the body colour (a gap through the
 * glyph); `cut-fill` filled in the body colour (a hole, the hearth's flame).
 */
export interface GlyphPart {
  readonly d: string;
  readonly mode: 'fill' | 'stroke' | 'cut' | 'cut-fill';
  /** Stroke width in glyph units (`stroke` and `cut` only). */
  readonly width?: number;
}

export type GlyphPath = readonly GlyphPart[];

/** The quest "!": a constant-width stroke and a dot (construction above). */
export const QUEST_GLYPH: GlyphPath = [
  { d: 'M12 4.6V13', mode: 'stroke', width: 4.4 },
  { d: 'M12 16.3a2.5 2.5 0 1 1 0 5a2.5 2.5 0 1 1 0-5z', mode: 'fill' },
];

/** The turn-in "?". */
export const TURN_IN_GLYPH: GlyphPath = [
  { d: 'M8.3 8.6C8.3 4.4 15.7 4.3 15.7 8.6C15.7 11.4 12 11.8 12 14.2', mode: 'stroke', width: 3.9 },
  { d: 'M12 16.6a2.4 2.4 0 1 1 0 4.8a2.4 2.4 0 1 1 0-4.8z', mode: 'fill' },
];

/** A dungeon entrance: an arched doorway. */
export const DUNGEON_GLYPH: GlyphPath = [{ d: 'M4.8 20.2V11.2a7.2 7.2 0 0 1 14.4 0v9h-4.4v-7.4a2.8 2.8 0 0 0-5.6 0v7.4z', mode: 'fill' }];

/** Every glyph a mark can carry (§25.2.2). */
export type MarkGlyph = 'quest' | 'turn-in' | 'objective' | 'dungeon' | 'raid' | 'flight' | 'transport' | 'portal' | 'innkeeper' | 'trainer' | 'vendor';

/** Quest glyphs ("!" and "?"): stroked, so too narrow to hollow at pin sizes (their "not yet" states take a badge, §25.2.1). */
export const isQuestGlyph = (glyph: MarkGlyph): boolean => glyph === 'quest' || glyph === 'turn-in';

// =============================================================================================
// Difficulty and the D-041 G threshold

/**
 * The five difficulty keys (`Difficulty` in src/rules/difficulty.ts, repeated here because this
 * module imports nothing; marks.test.ts checks they are the same list, in the same order).
 */
export type MarkDifficulty = 'trivial' | 'standard' | 'difficult' | 'verydifficult' | 'impossible';

export const MARK_DIFFICULTIES: readonly MarkDifficulty[] = ['trivial', 'standard', 'difficult', 'verydifficult', 'impossible'];

/** Lit pips per difficulty (`DifficultyLabel`'s staircase): trivial 1 to impossible 5. */
export const PIPS_LIT: Readonly<Record<MarkDifficulty, number>> = { trivial: 1, standard: 2, difficult: 3, verydifficult: 4, impossible: 5 };

/**
 * D-041 G as D-047 words it: the difficulty colour appears only on a shape that carries it of at
 * least this many pixels (a disc mark's diameter in rows, lists and the drawer's key; a pin's glyph
 * box, `QUEST_GLYPH_BOX` of its head), and always with the pips beside it.
 */
export const COLOUR_MIN_SHAPE_PX = 11;

/** Whether a shape of `shapePx` may carry the difficulty colour (with its pips). */
export const colourFits = (shapePx: number): boolean => Number.isFinite(shapePx) && shapePx >= COLOUR_MIN_SHAPE_PX;

// =============================================================================================
// Pin geometry (§25.2.1, §25.2.4)

/**
 * Pin sizes by scale (§25.2.4): the head's diameter is 12 px below the continent band (0.022 px per
 * yard), grows linearly in zoom to 26 px across the continent band (1.75 px per 0.25 zoom step) and
 * stays 26 px from the zone band (0.088 px per yard). The two scales are the band edges of
 * `BAND_EDGES` in src/map/adapter.ts (repeated here: this module imports nothing; marks.test.ts
 * checks them).
 */
export const PIN_SIZE = { min: 12, max: 26, fromPxPerYard: 0.022, toPxPerYard: 0.088 } as const;

/** The head's diameter at a scale (px per world yard), continuous; see `bucketPinDiameter` for the drawn size. */
export function pinDiameterAt(pxPerYard: number): number {
  if (!(pxPerYard > 0) || !Number.isFinite(pxPerYard)) return PIN_SIZE.min;
  if (pxPerYard <= PIN_SIZE.fromPxPerYard) return PIN_SIZE.min;
  if (pxPerYard >= PIN_SIZE.toPxPerYard) return PIN_SIZE.max;
  const span = Math.log2(PIN_SIZE.toPxPerYard) - Math.log2(PIN_SIZE.fromPxPerYard);
  const t = (Math.log2(pxPerYard) - Math.log2(PIN_SIZE.fromPxPerYard)) / span;
  return PIN_SIZE.min + t * (PIN_SIZE.max - PIN_SIZE.min);
}

/** The drawn head size: continent-band sizes bucketed down to even pixels (§25.7), so the bitmap cache stays small; the ends as they are. */
export function bucketPinDiameter(diameter: number): number {
  if (diameter <= PIN_SIZE.min) return PIN_SIZE.min;
  if (diameter >= PIN_SIZE.max) return PIN_SIZE.max;
  return Math.floor(diameter / 2) * 2;
}

// =============================================================================================
// Badges (§25.2.1, §25.2.3)

/** The four badge places on the rim, at 45°: TL the dungeon-quest arch; TR the state; BL position not verified; BR the count. */
export type BadgeSlot = 'tl' | 'tr' | 'bl' | 'br';

export const BADGE_SLOTS: readonly BadgeSlot[] = ['tl', 'tr', 'bl', 'br'];

export type BadgeKind =
  /** TL: the quest has objectives inside a dungeon (a small arch). */
  | 'dungeon-quest'
  /** TR: needs a prerequisite, or (rows only) an error at the step. */
  | 'lock'
  /** TR: the level it unlocks at, as a pill ("16"). */
  | 'level'
  /** TR: the share of objectives done, a pie from 12 o'clock, clockwise; empty at none. */
  | 'progress'
  /** TR: the objective record is unknown: a dashed empty pie. */
  | 'progress-unknown'
  /** TR: the other faction's letter, "A" or "H". */
  | 'faction'
  /** BL (pins only): the entrance position is not verified by the dataset's audit (a dashed ring). */
  | 'position'
  /** BR (pins only): "×n" for a stack, a cluster or a shared entrance. */
  | 'count';

/** Each badge's one slot: no two collide. */
export const BADGE_SLOT_OF: Readonly<Record<BadgeKind, BadgeSlot>> = {
  'dungeon-quest': 'tl',
  lock: 'tr',
  level: 'tr',
  progress: 'tr',
  'progress-unknown': 'tr',
  faction: 'tr',
  position: 'bl',
  count: 'br',
};

// =============================================================================================
// The one state table (§25.2.3)

/** Dark body with a light glyph (every pin but services), or the light family (services). */
export type MarkFamily = 'dark' | 'light';
/** Solid; dashed, "not sure"; double, "both factions". The three edges have fixed meanings. */
export type MarkEdge = 'solid' | 'dashed' | 'double';
/** Solid glyph, or hollow (outline only), "not known yet". */
export type MarkFill = 'solid' | 'hollow';
/**
 * `difficulty`: the shape that carries colour takes the quest's difficulty colour at the step,
 * with the pips beside it (when it is 11 px or more); `trivial`: always the trivial grey and one pip
 * (a low-level quest); `none`: uncoloured (the light glyph on a pin, ink in a row).
 */
export type MarkColour = 'difficulty' | 'trivial' | 'none';

/** Every state a mark can be in, rows and pins alike. */
export type MarkState =
  | 'available'
  | 'uncertain'
  | 'locked'
  | 'unlocks-soon'
  | 'low-level'
  | 'ready'
  | 'in-progress'
  | 'record-unknown'
  | 'objective'
  | 'dungeon'
  | 'raid'
  | 'flight-known'
  | 'flight-not-known'
  | 'flight-may-be-known'
  | 'flight-other-faction'
  | 'transport-inferred'
  | 'transport-unknown'
  | 'portal'
  | 'innkeeper'
  | 'trainer'
  | 'vendor';

export interface MarkLook {
  readonly glyph: MarkGlyph;
  readonly family: MarkFamily;
  readonly fill: MarkFill;
  readonly edge: MarkEdge;
  readonly colour: MarkColour;
  /** The state's own badge (in its fixed slot), or null. */
  readonly badge: BadgeKind | null;
  /** Struck through (the other faction's flight point). */
  readonly struck: boolean;
  /**
   * The spoken form for the hover and the key: a template whose `{…}` parts are filled at paint
   * time (`fillSpoken`); step numbers and names in it are examples, not data.
   */
  readonly spoken: string;
}

/**
 * §25.2.3 as data: the state table for every quest mark (the route rows' and quest lists' discs,
 * and the map's pins) and every other pin. "Colour" is the colour rule of `MarkColour`; the badge is
 * the state's own (a dungeon quest adds the TL arch, an unverified entrance the BL ring and a shared
 * one the BR count: `markBadges`).
 */
export const MARK_STATES: Readonly<Record<MarkState, MarkLook>> = {
  available: { glyph: 'quest', family: 'dark', fill: 'solid', edge: 'solid', colour: 'difficulty', badge: null, struck: false, spoken: 'Quest available after step {step}: {title} ({difficulty}, level {level})' },
  uncertain: { glyph: 'quest', family: 'dark', fill: 'solid', edge: 'dashed', colour: 'difficulty', badge: null, struck: false, spoken: 'May be available after step {step}: {title}: {doubt}' },
  locked: { glyph: 'quest', family: 'dark', fill: 'solid', edge: 'solid', colour: 'none', badge: 'lock', struck: false, spoken: 'Needs {prerequisite} after step {step}' },
  'unlocks-soon': { glyph: 'quest', family: 'dark', fill: 'solid', edge: 'solid', colour: 'none', badge: 'level', struck: false, spoken: 'Unlocks at level {unlock} (level after step {step}: {level})' },
  'low-level': { glyph: 'quest', family: 'dark', fill: 'solid', edge: 'solid', colour: 'trivial', badge: null, struck: false, spoken: 'Low level after step {step} (trivial)' },
  ready: { glyph: 'turn-in', family: 'dark', fill: 'solid', edge: 'solid', colour: 'difficulty', badge: null, struck: false, spoken: 'Ready to turn in after step {step}: {title}' },
  'in-progress': { glyph: 'turn-in', family: 'dark', fill: 'solid', edge: 'solid', colour: 'none', badge: 'progress', struck: false, spoken: 'Turn in: {done} of {total} objectives done after step {step}' },
  'record-unknown': { glyph: 'turn-in', family: 'dark', fill: 'solid', edge: 'dashed', colour: 'none', badge: 'progress-unknown', struck: false, spoken: '{title}: objective record unknown (quest assumed in the log)' },
  objective: { glyph: 'objective', family: 'dark', fill: 'solid', edge: 'solid', colour: 'none', badge: null, struck: false, spoken: 'Objectives of {title}: {count} targets near here' },
  dungeon: { glyph: 'dungeon', family: 'dark', fill: 'solid', edge: 'solid', colour: 'none', badge: null, struck: false, spoken: 'Dungeon entrance: {name}' },
  raid: { glyph: 'raid', family: 'dark', fill: 'solid', edge: 'solid', colour: 'none', badge: null, struck: false, spoken: 'Raid entrance: {name}' },
  'flight-known': { glyph: 'flight', family: 'dark', fill: 'solid', edge: 'solid', colour: 'none', badge: null, struck: false, spoken: 'Flight point: {name}, known to the route after step {step}' },
  'flight-not-known': { glyph: 'flight', family: 'dark', fill: 'hollow', edge: 'solid', colour: 'none', badge: null, struck: false, spoken: 'Flight point: {name}, not known to the route after step {step}' },
  'flight-may-be-known': { glyph: 'flight', family: 'dark', fill: 'hollow', edge: 'dashed', colour: 'none', badge: null, struck: false, spoken: 'Flight point: {name}, may be known before the route (history unknown)' },
  'flight-other-faction': { glyph: 'flight', family: 'dark', fill: 'hollow', edge: 'solid', colour: 'none', badge: 'faction', struck: true, spoken: '{faction} only: not usable by {character}' },
  'transport-inferred': { glyph: 'transport', family: 'dark', fill: 'solid', edge: 'solid', colour: 'none', badge: null, struck: false, spoken: 'Transport stop: to {destination} (service inferred from client transport path {path})' },
  'transport-unknown': { glyph: 'transport', family: 'dark', fill: 'solid', edge: 'dashed', colour: 'none', badge: null, struck: false, spoken: 'Transport stop (service unknown)' },
  portal: { glyph: 'portal', family: 'dark', fill: 'solid', edge: 'solid', colour: 'none', badge: null, struck: false, spoken: 'Portal to {destination} ({source})' },
  innkeeper: { glyph: 'innkeeper', family: 'light', fill: 'solid', edge: 'solid', colour: 'none', badge: null, struck: false, spoken: 'Innkeeper: {name} · Set hearth here after step {step}' },
  trainer: { glyph: 'trainer', family: 'light', fill: 'solid', edge: 'solid', colour: 'none', badge: null, struck: false, spoken: 'Class trainer: {name}' },
  vendor: { glyph: 'vendor', family: 'light', fill: 'solid', edge: 'solid', colour: 'none', badge: null, struck: false, spoken: 'Vendor: {name} (dataset only)' },
};

/** Every state, in the table's order (written out, so an unused table costs a bundle nothing). */
export const MARK_STATE_NAMES: readonly MarkState[] = ['available', 'uncertain', 'locked', 'unlocks-soon', 'low-level', 'ready', 'in-progress', 'record-unknown', 'objective', 'dungeon', 'raid', 'flight-known', 'flight-not-known', 'flight-may-be-known', 'flight-other-faction', 'transport-inferred', 'transport-unknown', 'portal', 'innkeeper', 'trainer', 'vendor'];

/** The quest-mark states (the "!" and the "?"): the ones the route rows draw. */
export const QUEST_MARK_STATES: readonly MarkState[] = ['available', 'uncertain', 'locked', 'unlocks-soon', 'low-level', 'ready', 'in-progress', 'record-unknown'];

/**
 * What changes a flight point's edge (§25.2.3, D-045 item 3): the character's own side is the
 * default; a node both factions use gets the double edge; a node the client gives no side (1 of
 * 65) the dashed edge. The other faction's nodes are their own state (struck, lettered).
 */
export type FlightSides = 'own' | 'both' | 'none';

/** A look with the modifiers of one item applied. */
export interface ResolvedMarkLook extends MarkLook {
  /** Every badge the item carries, each in its own slot, in `BADGE_SLOTS` order. */
  readonly badges: readonly BadgeKind[];
}

export interface MarkModifiers {
  /** A quest whose objectives are inside a dungeon: the TL arch. */
  readonly dungeonQuest?: boolean;
  /** A flight point's sides. */
  readonly sides?: FlightSides;
  /** An entrance whose position the dataset's audit did not verify (`frameVerified` false): the BL dashed ring. */
  readonly positionUnverified?: boolean;
  /** A stack, a cluster or a shared entrance: how many (the BR "×n" when above 1). */
  readonly count?: number;
}

/** A state's look with an item's modifiers: the dungeon-quest arch, the flight edges, the position ring and the count. */
export function resolveMarkLook(state: MarkState, modifiers: MarkModifiers = {}): ResolvedMarkLook {
  const base = MARK_STATES[state];
  let edge = base.edge;
  if (base.glyph === 'flight' && state !== 'flight-other-faction') {
    if (modifiers.sides === 'both' && edge === 'solid') edge = 'double';
    if (modifiers.sides === 'none') edge = 'dashed';
  }
  const badges = new Set<BadgeKind>();
  if (base.badge !== null) badges.add(base.badge);
  if (modifiers.dungeonQuest === true && isQuestGlyph(base.glyph)) badges.add('dungeon-quest');
  if (modifiers.positionUnverified === true && (base.glyph === 'dungeon' || base.glyph === 'raid')) badges.add('position');
  if ((modifiers.count ?? 1) > 1) badges.add('count');
  const ordered = BADGE_SLOTS.flatMap((slot) => [...badges].filter((badge) => BADGE_SLOT_OF[badge] === slot));
  return { ...base, edge, badges: ordered };
}

/**
 * The colour a mark shows: the difficulty key to fill the coloured shape with and to light the pips
 * with, or null for none. Never a colour without pips (the pips come with it, `pips` true), never on
 * a shape under 11 px (`colourFits`), never for an unknown difficulty, and never for a state that
 * takes none (locked, unlocks soon, in progress, record unknown, and every place and service).
 */
export function markColour(
  state: MarkState,
  difficulty: MarkDifficulty | null,
  shapePx: number,
): { readonly difficulty: MarkDifficulty; readonly pips: true } | null {
  const rule = MARK_STATES[state].colour;
  if (rule === 'none' || !colourFits(shapePx)) return null;
  if (rule === 'trivial') return { difficulty: 'trivial', pips: true };
  return difficulty === null ? null : { difficulty, pips: true };
}

// =============================================================================================
// Cluster levels (§25.2.5; step MP.4a)

/** The nested grid levels of the clusters below the zone band, in yards: cells nest, so a cluster splits only where its cell halves, never on a pan. */
export const CLUSTER_LEVELS: readonly number[] = [512, 1024, 2048, 4096];

/** A cluster cell spans at least this many pin heads. */
export const CLUSTER_CELL_HEADS = 1.25;

/**
 * The cluster level used at a zoom (§25.2.5): the smallest level at or above 1.25 times the drawn
 * pin head (`bucketPinDiameter(pinDiameterAt(2^zoom))`) in yards, the largest beyond them: 1,024 yd
 * over most of the continent band, 512 yd at its top, 2,048 yd or more deep in the world band.
 * The layer builder makes every level once per input; this is the lookup at `moveend`, and the
 * adapter's cue for a split's cross-fade.
 */
export function clusterLevelAt(zoom: number): number {
  const px = 2 ** zoom;
  const last = CLUSTER_LEVELS[CLUSTER_LEVELS.length - 1] ?? 4096;
  if (!(px > 0) || !Number.isFinite(px)) return last;
  const yards = (CLUSTER_CELL_HEADS * bucketPinDiameter(pinDiameterAt(px))) / px;
  for (const level of CLUSTER_LEVELS) if (level >= yards) return level;
  return last;
}
