/**
 * The command registry: every dot-command name our parser recognises, as a data table written in
 * our own words from docs/RXP.md §9 (interoperability vocabulary, D-019). Any other name is
 * `RXP001-unknown-command`. The table says how a line's arguments are split and what the line
 * lowers to (§12.3); `lower.ts` interprets it.
 */

export type ArgumentSeparator = 'comma' | 'semicolon' | 'rest';

export type QuestStateName = 'onQuest' | 'complete' | 'turnedIn' | 'available';

export type CommandLowering =
  | { readonly kind: 'accept' }
  | { readonly kind: 'acceptAny' }
  | { readonly kind: 'turnin' }
  | { readonly kind: 'turninAny' }
  | { readonly kind: 'complete' }
  | { readonly kind: 'collect' }
  | { readonly kind: 'abandon' }
  | { readonly kind: 'goto' }
  | { readonly kind: 'waypoint'; readonly role: 'leg' | 'pin' }
  | { readonly kind: 'travelArea' }
  | { readonly kind: 'hearth'; readonly mode: 'use' | 'bind' }
  | { readonly kind: 'flight'; readonly mode: 'discover' | 'take' }
  | { readonly kind: 'xp' }
  | { readonly kind: 'maxlevel' }
  | { readonly kind: 'train' }
  | { readonly kind: 'trainer' }
  | { readonly kind: 'vendor' }
  /** A quest-state skip predicate (§12.2 table). `single`: only a one-ID form is structured. */
  | { readonly kind: 'questState'; readonly state: QuestStateName; readonly negate: boolean; readonly single: boolean }
  /** A skip predicate kept opaque (`raw`); `jump` forms are approximated as a skip (`RXP034`). */
  | { readonly kind: 'skipIf'; readonly jump: boolean }
  /** `.cooldown`: a skip predicate in its condition form (`<N`/`>N`), otherwise an annotation. */
  | { readonly kind: 'cooldown' }
  /** `.skill`/`.reputation`: a skip predicate when the skip argument is present, else a blocking objective (preserved). */
  | { readonly kind: 'skillCheck'; readonly skipArg: number }
  | { readonly kind: 'variant' }
  | { readonly kind: 'annotation' }
  | { readonly kind: 'disablecheckbox' }
  | { readonly kind: 'convertquest' }
  | { readonly kind: 'deathskip' }
  | { readonly kind: 'cast' }
  /**
   * Kept verbatim as a preserved note (§9.7, §12.3). `routeRelevant`: it can change which steps a
   * character does, so it gets `RXP034`; other-game and inert commands get no diagnostic.
   */
  | { readonly kind: 'preserved'; readonly routeRelevant: boolean };

export interface CommandSpec {
  readonly name: string;
  readonly separator: ArgumentSeparator;
  /** `always`: `>>` text is required (`RXP018`); `nameOrText`: `.fly` needs a node name or a text. */
  readonly requiredText: 'always' | 'nameOrText' | 'never';
  readonly lowering: CommandLowering;
  /** 1 structured and simulated, 2 structured annotation, 3 recognised and kept opaque (§9.0). */
  readonly tier: 1 | 2 | 3;
}

const L = {
  accept: { kind: 'accept' },
  acceptAny: { kind: 'acceptAny' },
  turnin: { kind: 'turnin' },
  turninAny: { kind: 'turninAny' },
  complete: { kind: 'complete' },
  collect: { kind: 'collect' },
  abandon: { kind: 'abandon' },
  goto: { kind: 'goto' },
  travelArea: { kind: 'travelArea' },
  xp: { kind: 'xp' },
  maxlevel: { kind: 'maxlevel' },
  train: { kind: 'train' },
  trainer: { kind: 'trainer' },
  vendor: { kind: 'vendor' },
  skip: { kind: 'skipIf', jump: false },
  jump: { kind: 'skipIf', jump: true },
  cooldown: { kind: 'cooldown' },
  variant: { kind: 'variant' },
  note: { kind: 'annotation' },
  disablecheckbox: { kind: 'disablecheckbox' },
  convertquest: { kind: 'convertquest' },
  deathskip: { kind: 'deathskip' },
  cast: { kind: 'cast' },
  /** Route-relevant preserved commands (§9.7 "Route relevance"). */
  preserved: { kind: 'preserved', routeRelevant: true },
  /** Preserved without a diagnostic: other games' commands and commands with no effect on Forever. */
  inert: { kind: 'preserved', routeRelevant: false },
} as const satisfies Record<string, CommandLowering>;

type Row = readonly [name: string, lowering: CommandLowering, tier: 1 | 2 | 3, separator?: ArgumentSeparator, requiredText?: CommandSpec['requiredText']];

const questState = (state: QuestStateName, negate: boolean, single = false): CommandLowering => ({ kind: 'questState', state, negate, single });

/** Grouped as in docs/RXP.md §9; the order inside a group is ours. */
const ROWS: readonly Row[] = [
  // Quest state (§9.1)
  ['accept', L.accept, 1],
  ['acceptmultiple', L.acceptAny, 1],
  ['daily', L.acceptAny, 1],
  ['turnin', L.turnin, 1],
  ['turninmultiple', L.turninAny, 1],
  ['dailyturnin', L.turninAny, 1],
  ['complete', L.complete, 1],
  ['collect', L.collect, 1],
  ['abandon', L.abandon, 1],
  ['convertquest', L.convertquest, 1],
  ['mirrorquest', L.inert, 3],
  ['disablequestautomation', L.note, 2],
  // Inventory helpers (§9.1)
  ['collectmultiple', L.note, 2],
  ['addquestitem', L.note, 2],
  ['questitemcount', L.note, 2],
  ['buy', L.note, 2],
  ['buyAll', L.note, 2],
  ['buyUntilBroke', L.note, 2],
  ['retrieveitem', L.note, 2],
  ['bankdeposit', L.note, 2],
  ['bankwithdraw', L.note, 2],
  ['destroy', L.preserved, 2],
  // Step conditions (§9.2)
  ['isOnQuest', questState('onQuest', true), 1],
  ['isNotOnQuest', questState('onQuest', false), 1],
  ['isQuestTurnedIn', questState('turnedIn', true), 1],
  ['isQuestAvailable', questState('turnedIn', false, true), 1],
  ['isQuestComplete', questState('complete', true, true), 1],
  ['isQuestNotComplete', questState('complete', false, true), 1],
  ['questcount', L.skip, 1],
  ['xp', L.xp, 1],
  ['maxlevel', L.maxlevel, 1],
  ['money', L.skip, 1],
  ['itemcount', L.skip, 1],
  ['zoneskip', L.skip, 1],
  ['subzoneskip', L.skip, 1],
  ['bindlocation', L.skip, 1],
  ['istrained', L.skip, 1],
  ['spellmissing', L.skip, 1],
  ['skill', { kind: 'skillCheck', skipArg: 2 }, 2],
  ['reputation', { kind: 'skillCheck', skipArg: 3 }, 2],
  ['bronzetube', L.skip, 2],
  ['skipOnQuest', L.skip, 2],
  ['skipto', L.jump, 2],
  ['hideifcomplete', L.skip, 2],
  ['areapoiexists', L.skip, 2],
  ['isQuestOffered', L.skip, 2],
  ['totalbagslots', L.skip, 2],
  ['cooldown', L.cooldown, 2],
  // Location, travel, hearth, flight, death (§9.3, §10)
  ['goto', L.goto, 1],
  ['waypoint', { kind: 'waypoint', role: 'leg' }, 2],
  ['pin', { kind: 'waypoint', role: 'pin' }, 2],
  ['zone', L.travelArea, 1, 'comma', 'always'],
  ['subzone', L.travelArea, 1, 'comma', 'always'],
  ['explore', L.travelArea, 1],
  ['hs', { kind: 'hearth', mode: 'use' }, 1, 'comma', 'always'],
  ['home', { kind: 'hearth', mode: 'bind' }, 1],
  ['fp', { kind: 'flight', mode: 'discover' }, 1],
  ['fly', { kind: 'flight', mode: 'take' }, 1, 'comma', 'nameOrText'],
  ['deathskip', L.deathskip, 1],
  ['hastyhearth', L.inert, 3],
  ['ingamewaypoint', L.note, 2],
  ['questgoto', L.note, 2],
  ['questwaypoint', L.note, 2],
  ['groundgoto', L.note, 2],
  ['flygoto', L.note, 2],
  ['wpradius', L.note, 2],
  ['line', L.note, 2],
  ['loop', L.note, 2],
  ['treasure', L.note, 2],
  ['rare', L.note, 2],
  ['openmap', L.note, 2],
  // Trainers, vendors, NPC interaction (§9.5)
  ['train', L.train, 1],
  ['trainer', L.trainer, 1],
  ['vendor', L.vendor, 1],
  ['stable', L.preserved, 2],
  ['tame', L.preserved, 2],
  ['target', L.note, 2, 'semicolon'],
  ['mob', L.note, 2, 'semicolon'],
  ['unitscan', L.note, 2, 'semicolon'],
  ['skipgossip', L.note, 2],
  ['skipgossipid', L.note, 2],
  ['gossipoption', L.note, 2],
  ['gossip', L.note, 2],
  ['choose', L.note, 2],
  ['emote', L.note, 2],
  ['vehicle', L.note, 2],
  ['exitvehicle', L.note, 2],
  // Items, spells, UI (§9.6)
  ['use', L.note, 2],
  ['usespell', L.note, 2],
  ['cast', L.cast, 2],
  ['link', L.note, 2, 'rest', 'always'],
  ['clicknext', L.note, 2, 'rest', 'always'],
  ['macro', L.note, 2, 'comma', 'always'],
  ['timer', L.note, 2],
  ['disablecheckbox', L.disablecheckbox, 2],
  ['dungeon', L.variant, 2],
  ['group', L.variant, 2],
  ['solo', L.variant, 2],
  ['profession', L.variant, 2],
  ['next', L.note, 2],
  ['label', L.note, 2],
  ['itemStat', L.note, 2],
  ['equip', L.note, 2],
  ['aura', L.note, 2],
  ['engrave', L.note, 2],
  ['logout', L.note, 2],
  ['countdown', L.note, 2],
  ['wptimer', L.note, 2],
  ['wpbuff', L.note, 2],
  ['openitem', L.note, 2],
  ['scrap', L.note, 2],
  ['spec', L.note, 2],
  ['dualspec', L.note, 2],
  ['tradeskill', L.note, 2],
  // Opaque: execute Lua or change RXP's own quest database (§9.7)
  ['setquestdb', L.preserved, 3, 'rest'],
  ['addtoquestdb', L.preserved, 3],
  ['setturninroute', L.preserved, 3],
  ['setturninhs', L.preserved, 3],
  ['turninconfig', L.preserved, 3],
  ['show25quests', L.preserved, 3],
  ['showtotalxp', L.preserved, 3],
  ['requires', L.preserved, 3],
  ['tbcWBF', L.preserved, 3],
  ['getTBCchapters', L.preserved, 3],
  // Opaque: helpers of RXP's own Classic/Forever data (§9.7)
  ['xpto60', L.preserved, 3],
  ['xpto60alliance', L.preserved, 3],
  ['xpto60horde', L.preserved, 3],
  ['xpto60hc', L.preserved, 3],
  ['xpcheck', L.preserved, 3],
  // Opaque: other games only (§9.7)
  ['scenario', L.inert, 3],
  ['isInScenario', L.inert, 3],
  ['enterScenario', L.inert, 3],
  ['chromietime', L.inert, 3],
  ['skyriding', L.inert, 3],
  ['noskyriding', L.inert, 3],
  ['flyable', L.inert, 3],
  ['noflyable', L.inert, 3],
  ['collectmount', L.inert, 3],
  ['collecttoy', L.inert, 3],
  ['collectpet', L.inert, 3],
  ['collectcurrency', L.inert, 3],
  ['mountcount', L.inert, 3],
  ['petfamily', L.inert, 3],
  ['dailyhub', L.inert, 3],
  ['dailyreset', L.inert, 3],
  ['vale', L.inert, 3],
  ['klaxxi', L.inert, 3],
  ['celestial', L.inert, 3],
  ['landfall', L.inert, 3],
  ['acceptmap', L.inert, 3],
  ['areapoiguide', L.inert, 3],
  ['neutralzonefinished', L.inert, 3],
  ['pvp', L.inert, 3],
  ['pve', L.inert, 3],
  ['dmf', L.inert, 3],
  ['nodmf', L.inert, 3],
  ['holiday', L.inert, 3],
  ['beta', L.inert, 3],
  ['blastedLands', L.inert, 3],
  ['ironchain', L.inert, 3],
  ['bombdispenser', L.inert, 3],
  ['rescue', L.inert, 3],
  ['niffelen', L.inert, 3],
  ['hsbatching', L.inert, 3],
  ['maxskill', L.inert, 3],
  ['noop', L.inert, 3],
];

/**
 * Families RXP.md names only by prefix (`.multibox*`, `.singlebox*`, `.achievement*`,
 * `.isWorldQuest*`): every name that starts with the prefix, the bare prefix included (§9.7).
 */
const PREFIX_ROWS: readonly Row[] = [
  ['multibox', L.note, 2],
  ['singlebox', L.note, 2],
  ['achievement', L.inert, 3],
  ['isWorldQuest', L.inert, 3],
];

const toSpec = ([name, lowering, tier, separator = 'comma', requiredText = 'never']: Row): CommandSpec => ({
  name,
  lowering,
  tier,
  separator,
  requiredText,
});

const EXACT: ReadonlyMap<string, CommandSpec> = new Map(ROWS.map((row) => [row[0], toSpec(row)]));
const PREFIXES: readonly CommandSpec[] = PREFIX_ROWS.map(toSpec);

/** Every exact name, in table order (for tests and "did you mean"). */
export const COMMAND_NAMES: readonly string[] = ROWS.map((row) => row[0]);

/** The registered spec for a command name (case-sensitive, as in RXP), or null. */
export function commandSpec(name: string): CommandSpec | null {
  const exact = EXACT.get(name);
  if (exact !== undefined) return exact;
  const prefixed = PREFIXES.find((spec) => name.startsWith(spec.name));
  return prefixed === undefined ? null : { ...prefixed, name };
}

/** A registered name that equals `name` apart from letter case (`RXP017`), or null. */
export function commandCaseMatch(name: string): string | null {
  if (commandSpec(name) !== null) return null;
  const lower = name.toLowerCase();
  const exact = COMMAND_NAMES.find((candidate) => candidate.toLowerCase() === lower);
  if (exact !== undefined) return exact;
  const family = PREFIXES.find((spec) => lower.startsWith(spec.name.toLowerCase()));
  return family === undefined ? null : family.name + name.slice(family.name.length);
}
