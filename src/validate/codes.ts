import type { IssueSeverity } from '../domain/issues';

/**
 * The issue-code registry (docs/ARCHITECTURE.md §9.4; docs/SIMULATION.md §7.7-§7.8, the
 * authoritative rule and code list). Every `ValidationIssue` the validator emits has a code listed
 * here, with its default severity, the keys of its `data`, a message template and a short
 * explanation for the UI.
 *
 * One grammar for every family: a family prefix and a three-digit number, then a slug
 * (`VAL004-min-level`); a variant appends a suffix to its rule's code (`-uncertain`,
 * `-unverifiable`) or, for VAL-30, names its case (`VAL030-failed`). The `RXP` family is
 * registered in src/rxp/diagnostics.ts (`RXP_CODES`, docs/RXP.md §11.1) under the same grammar;
 * this module may not import rxp values (ARCHITECTURE §4), so tests/validate-e2e.test.ts checks the
 * two registries against each other.
 *
 * Message templates use `{name}` placeholders, filled from the issue's `data` and from words the
 * rule supplies (always `{quest}`, the quest's name and id, for an issue about a quest).
 */

export type IssueFamily = 'VAL' | 'LINT' | 'SIM' | 'DATA' | 'RXP';

export const ISSUE_FAMILIES: readonly IssueFamily[] = ['VAL', 'LINT', 'SIM', 'DATA', 'RXP'];

/** A value in `ValidationIssue.data`. */
export type IssueDataValue = string | number | boolean | null;
export type IssueData = Readonly<Record<string, IssueDataValue>>;

/** The code grammar of every family: prefix, three digits, a lower-case slug of dash-separated words. */
export const ISSUE_CODE_PATTERN = /^(VAL|LINT|SIM|DATA|RXP)(\d{3})-([a-z0-9]+(?:-[a-z0-9]+)*)$/;

export interface IssueCodeSpec {
  readonly code: string;
  /** The SIMULATION rule (`VAL-4`, `SIM-17`) or the section that defines the code. */
  readonly rule: string;
  readonly severity: IssueSeverity;
  /** The rule's base code when this code is one of its variants, else null. */
  readonly variantOf: string | null;
  /** The keys of `data`, in order; empty means `data` is null. */
  readonly params: readonly string[];
  /** Message template (`{name}` placeholders). */
  readonly message: string;
  /** What the check means, for the UI. */
  readonly explanation: string;
}

const LEVEL = ['level', 'levelBasis', 'levelEraFallback'] as const;

/**
 * VAL-1..22, VAL-30..33, LINT-1..4 (SIMULATION §7.2, §7.5, §7.8), SIM-1..21 (§7.7) plus the
 * route-level SIM-22 and SIM-23, and DATA001-003. VAL-3, VAL-31 and VAL-33 define behaviour and
 * have no code.
 */
export const ISSUE_CODES = [
  // Availability (SIMULATION §7.2, §7.6)
  {
    code: 'VAL001-already-in-log',
    rule: 'VAL-1',
    severity: 'error',
    variantOf: null,
    params: [],
    message: '{quest} is already in the quest log.',
    explanation: 'A quest can be accepted only while it is not in the quest log.',
  },
  {
    code: 'VAL002-already-completed',
    rule: 'VAL-2',
    severity: 'error',
    variantOf: null,
    params: [],
    message: '{quest} has already been turned in, and it is not repeatable.',
    explanation: 'A quest that is not repeatable can be done once. Repeatable quests are exempt.',
  },
  {
    code: 'VAL004-min-level',
    rule: 'VAL-4',
    severity: 'error',
    variantOf: null,
    params: ['requiredLevel', ...LEVEL],
    message: '{quest} needs level {requiredLevel}; the character is level {level}.',
    explanation: "The character's level must reach the quest's required level. A quest's colour never blocks it.",
  },
  {
    code: 'VAL004-min-level-uncertain',
    rule: 'VAL-4',
    severity: 'warning',
    variantOf: 'VAL004-min-level',
    params: ['requiredLevel', ...LEVEL],
    message: '{quest} needs level {requiredLevel}; the character is at least level {level}, but the XP of an earlier quest is unknown.',
    explanation: 'After a turn-in with unknown XP the level is a lower bound, so the check cannot fail for certain.',
  },
  {
    code: 'VAL005-max-level',
    rule: 'VAL-5',
    severity: 'error',
    variantOf: null,
    params: ['maxLevel', ...LEVEL, 'levelIsLowerBound'],
    message: '{quest} is offered only up to level {maxLevel}; the character is {levelText}.',
    explanation: 'Some quests are offered only up to a level. The check stays an error on a lower-bound level, because the true level is at least as high.',
  },
  {
    code: 'VAL005-max-level-uncertain',
    rule: 'VAL-5',
    severity: 'warning',
    variantOf: 'VAL005-max-level',
    params: ['maxLevel', ...LEVEL],
    message: '{quest} is offered only up to level {maxLevel}; the character is at least level {level} and may be above it, because the XP of an earlier quest is unknown.',
    explanation: 'After a turn-in with unknown XP the true level may be above the lower bound, and so above the limit.',
  },
  {
    code: 'VAL006-race',
    rule: 'VAL-6',
    severity: 'error',
    variantOf: null,
    params: ['race', 'races'],
    message: "{quest} is not offered to the character's race ({race}).",
    explanation: "The quest's race mask excludes the character's race. The exact faction masks 77 and 178 also admit that faction's Skyborne race.",
  },
  {
    code: 'VAL007-class',
    rule: 'VAL-7',
    severity: 'error',
    variantOf: null,
    params: ['class', 'classes'],
    message: "{quest} is not offered to the character's class ({class}).",
    explanation: "The quest's class mask excludes the character's class.",
  },
  {
    code: 'VAL008-prequest-single',
    rule: 'VAL-8',
    severity: 'error',
    variantOf: null,
    params: ['quests'],
    message: '{quest} needs one of these quests turned in first: {questNames}.',
    explanation: 'At least one of the listed prerequisite quests must be turned in before this quest is offered.',
  },
  {
    code: 'VAL008-prequest-single-unverifiable',
    rule: 'VAL-8',
    severity: 'warning',
    variantOf: 'VAL008-prequest-single',
    params: ['quests'],
    message: '{quest} needs one of these quests turned in first: {questNames}. The route does not turn one in, and the history before the route is unknown.',
    explanation: 'With an unknown history before the route, a prerequisite the route never touches may have been done before it.',
  },
  {
    code: 'VAL009-prequest-group',
    rule: 'VAL-9',
    severity: 'error',
    variantOf: null,
    params: ['quests'],
    message: '{quest} needs all of its prerequisite quests turned in first; missing: {questNames}.',
    explanation: 'Every quest of the prerequisite group must be turned in (or, for a positive entry, one of its exclusive alternatives).',
  },
  {
    code: 'VAL009-prequest-group-unverifiable',
    rule: 'VAL-9',
    severity: 'warning',
    variantOf: 'VAL009-prequest-group',
    params: ['quests'],
    message: '{quest} needs all of its prerequisite quests turned in first; the route does not turn in {questNames}, and the history before the route is unknown.',
    explanation: 'With an unknown history before the route, a prerequisite the route never touches may have been done before it.',
  },
  {
    code: 'VAL010-parent-not-active',
    rule: 'VAL-10',
    severity: 'error',
    variantOf: null,
    params: ['parentQuestId'],
    message: '{quest} is offered only while {parentName} is in the quest log.',
    explanation: 'A child quest is offered only while its parent quest is in the quest log; then no level requirement applies.',
  },
  {
    code: 'VAL010-parent-not-active-unverifiable',
    rule: 'VAL-10',
    severity: 'warning',
    variantOf: 'VAL010-parent-not-active',
    params: ['parentQuestId'],
    message: '{quest} is offered only while {parentName} is in the quest log. The route never accepts it, and the history before the route is unknown.',
    explanation: 'With an unknown history before the route, the parent quest may have been accepted before it.',
  },
  {
    code: 'VAL011-later-chain-step',
    rule: 'VAL-11',
    severity: 'error',
    variantOf: null,
    params: ['nextQuestId'],
    message: '{quest} is no longer offered once the next quest in its chain, {nextName}, is taken or done.',
    explanation: 'Taking or finishing a later step of a quest chain closes the earlier steps.',
  },
  {
    code: 'VAL012-exclusive',
    rule: 'VAL-12',
    severity: 'error',
    variantOf: null,
    params: ['quests'],
    message: '{quest} is exclusive with {questNames}, already taken or done.',
    explanation: 'Only one quest of an exclusive group can be taken.',
  },
  {
    code: 'VAL013-breadcrumb-target-taken',
    rule: 'VAL-13',
    severity: 'error',
    variantOf: null,
    params: ['targetQuestId'],
    message: '{quest} leads to {targetName}, which is already taken or done.',
    explanation: 'A breadcrumb quest is not offered once the quest it leads to is taken or done.',
  },
  {
    code: 'VAL013-breadcrumb-target-unavailable',
    rule: 'VAL-13',
    severity: 'warning',
    variantOf: 'VAL013-breadcrumb-target-taken',
    params: ['targetQuestId', 'reason'],
    message: '{quest} leads to {targetName}, which cannot be accepted yet ({reason}). Questie still offers the breadcrumb; the vmangos emulator does not.',
    explanation: 'The vmangos emulator also requires the quest a breadcrumb leads to to be acceptable. Questie does not, so this is a warning.',
  },
  {
    code: 'VAL014-breadcrumb-active',
    rule: 'VAL-14',
    severity: 'error',
    variantOf: null,
    params: ['quests'],
    message: '{quest} is not offered while its breadcrumb {questNames} is in the quest log.',
    explanation: 'A quest is closed while a breadcrumb leading to it is in the quest log.',
  },
  {
    code: 'VAL015-skill',
    rule: 'VAL-15',
    severity: 'error',
    variantOf: null,
    params: ['skillId', 'requiredValue', 'value'],
    message: '{quest} needs skill {skillId} at {requiredValue}; the character has {value}.',
    explanation: 'The declared skill value is below the requirement, and the route never trains that skill. Skill gains from use are not modelled.',
  },
  {
    code: 'VAL015-skill-unverifiable',
    rule: 'VAL-15',
    severity: 'info',
    variantOf: 'VAL015-skill',
    params: ['skillId', 'requiredValue', 'value', 'reason'],
    message: '{quest} needs skill {skillId} at {requiredValue}; {reasonText}.',
    explanation: 'The profile does not say enough about this skill to check it.',
  },
  {
    code: 'VAL016-reputation',
    rule: 'VAL-16',
    severity: 'error',
    variantOf: null,
    params: ['factionId', 'min', 'max', 'value'],
    message: '{quest} needs reputation {rangeText} with faction {factionId}; the character has {value}.',
    explanation: "Reputation is the declared value plus the reputation rewards of the route's turn-ins.",
  },
  {
    code: 'VAL016-reputation-unverifiable',
    rule: 'VAL-16',
    severity: 'info',
    variantOf: 'VAL016-reputation',
    params: ['factionId', 'min', 'max'],
    message: '{quest} needs reputation {rangeText} with faction {factionId}, which the profile does not declare.',
    explanation: 'The profile does not declare this reputation, so the check cannot be made.',
  },
  {
    code: 'VAL017-spell',
    rule: 'VAL-17',
    severity: 'error',
    variantOf: null,
    params: ['spellId'],
    message: '{quest} is not offered to a character who knows spell {spellId}, which the route trains.',
    explanation: 'Some quests are closed to characters who know a spell.',
  },
  {
    code: 'VAL017-spell-unverifiable',
    rule: 'VAL-17',
    severity: 'info',
    variantOf: 'VAL017-spell',
    params: ['spellId', 'mustKnow'],
    message: '{quest} is offered only to a character who {knowText} spell {spellId}; the spellbook before the route is unknown.',
    explanation: 'Only spells trained in the route are known; the rest of the spellbook is not in the profile.',
  },
  {
    code: 'VAL018-availability-window',
    rule: 'VAL-18',
    severity: 'error',
    variantOf: null,
    params: ['part', 'relatedQuestId'],
    message: '{quest} {windowText}.',
    explanation: 'Some quests are offered only before, after or outside another quest.',
  },
  {
    code: 'VAL018-availability-window-unverifiable',
    rule: 'VAL-18',
    severity: 'warning',
    variantOf: 'VAL018-availability-window',
    params: ['part', 'relatedQuestId'],
    message: '{quest} is offered only once {relatedName} is taken or done. The route never takes it, and the history before the route is unknown.',
    explanation: 'With an unknown history before the route, the other quest may have been taken before it.',
  },
  {
    code: 'VAL019-specialization',
    rule: 'VAL-19',
    severity: 'error',
    variantOf: null,
    params: ['specialization'],
    message: '{quest} needs profession specialisation {specialization}.',
    explanation: 'Registered for completeness: the profile has no specialisation field, so version 1 always reports the unverifiable variant.',
  },
  {
    code: 'VAL019-specialization-unverifiable',
    rule: 'VAL-19',
    severity: 'info',
    variantOf: 'VAL019-specialization',
    params: ['specialization'],
    message: '{quest} needs profession specialisation {specialization}, which the profile cannot declare.',
    explanation: 'The profile has no specialisation field, so the check cannot be made.',
  },
  {
    code: 'VAL020-quest-log-full',
    rule: 'VAL-20',
    severity: 'error',
    variantOf: null,
    params: ['size', 'capacity', 'capacityBasis'],
    message: 'The quest log is full ({size} of {capacity}), so {quest} cannot be accepted.',
    explanation: "The capacity is the ruleset's quest log size (40 in forever-beta, 20 in era-1.15) or the project's value.",
  },
  {
    code: 'VAL021-previous-chain-active',
    rule: 'VAL-21',
    severity: 'warning',
    variantOf: null,
    params: ['previousQuestId'],
    message: '{quest} follows {previousName} in its chain, which is still in the quest log. Questie offers it; the vmangos emulator does not.',
    explanation: 'An emulator-only rule: a quest is closed while the previous step of its chain is in the quest log.',
  },
  {
    code: 'VAL022-needs-event',
    rule: 'VAL-22',
    severity: 'info',
    variantOf: null,
    params: [],
    message: '{quest} needs an area trigger or a scripted event to complete.',
    explanation: 'The quest can be accepted; finishing it needs an area trigger or a scripted event.',
  },
  // Turn-in and abandon (SIMULATION §7.5; ARCHITECTURE §9.4)
  {
    code: 'VAL030-not-in-log',
    rule: 'VAL-30',
    severity: 'error',
    variantOf: null,
    params: [],
    message: '{quest} is not in the quest log, so it cannot be turned in.',
    explanation: 'A quest must be in the quest log, and not failed, to be turned in.',
  },
  {
    code: 'VAL030-not-in-log-unverifiable',
    rule: 'VAL-30',
    severity: 'warning',
    variantOf: 'VAL030-not-in-log',
    params: [],
    message: '{quest} is turned in but never accepted in the route; it is assumed to have been in the quest log before the route.',
    explanation: 'With an unknown history before the route, a quest the route never accepted is assumed to have been accepted before it.',
  },
  {
    code: 'VAL030-failed',
    rule: 'VAL-30',
    severity: 'error',
    variantOf: 'VAL030-not-in-log',
    params: [],
    message: '{quest} has failed, so it cannot be turned in.',
    explanation: 'A failed quest cannot be turned in.',
  },
  {
    code: 'VAL030-objectives-incidental',
    rule: 'VAL-30',
    severity: 'warning',
    variantOf: 'VAL030-not-in-log',
    params: ['objectives'],
    message: '{quest} is turned in, but no step finishes {objectiveText}; assumed completed along the way.',
    explanation: 'Objectives that no Complete step finishes are assumed done incidentally, at no time and no kill XP.',
  },
  {
    code: 'VAL030-finisher-mismatch',
    rule: 'VAL-30',
    severity: 'warning',
    variantOf: 'VAL030-not-in-log',
    params: ['viaKind', 'viaId'],
    message: '{quest} is turned in at {viaText}, which is not one of its finishers.',
    explanation: "The step names an NPC or object that the quest's data does not list as a finisher.",
  },
  {
    code: 'VAL032-not-in-log',
    rule: 'VAL-32',
    severity: 'error',
    variantOf: null,
    params: [],
    message: '{quest} is not in the quest log, so it cannot be abandoned.',
    explanation: 'Only a quest in the quest log can be abandoned.',
  },
  {
    code: 'VAL032-not-in-log-unverifiable',
    rule: 'VAL-32',
    severity: 'warning',
    variantOf: 'VAL032-not-in-log',
    params: [],
    message: '{quest} is abandoned but never accepted in the route; it is assumed to have been in the quest log before the route.',
    explanation: 'With an unknown history before the route, a quest the route never accepted is assumed to have been accepted before it.',
  },
  // Lint (SIMULATION §7.5)
  {
    code: 'LINT001-prequest-both',
    rule: 'LINT-1',
    severity: 'warning',
    variantOf: null,
    params: ['single', 'group'],
    message: '{quest} lists both single and group prerequisites in the data; the single list is used.',
    explanation: "A data warning. Questie's precedence applies: the single prerequisite list wins.",
  },
  {
    code: 'LINT002-link-mismatch',
    rule: 'LINT-2',
    severity: 'warning',
    variantOf: null,
    params: ['exclusiveNotReturned', 'parentChildMismatch', 'dangling'],
    message: '{quest} has inconsistent quest links in the data: {detailText}.',
    explanation: 'A data warning: an exclusive link that is not returned, a parent and child that disagree, or a link to a quest the data does not have.',
  },
  {
    code: 'LINT003-low-value',
    rule: 'LINT-3',
    severity: 'warning',
    variantOf: null,
    params: [...LEVEL, 'questLevel', 'difficulty', 'xp', 'xpBasis', 'eraFallback', 'assumed'],
    message: '{quest} is of low value at level {level}: {reasonText}.',
    explanation: 'A grey quest, or one that gives 0 XP, is legal but of little value. Unknown XP is not 0 and does not count.',
  },
  {
    code: 'LINT004-xp-reduced',
    rule: 'LINT-4',
    severity: 'warning',
    variantOf: null,
    params: [...LEVEL, 'questLevel', 'percent', 'xp', 'fullXp', 'xpLost', 'xpBasis', 'eraFallback', 'assumed'],
    message: '{quest} is turned in {difference} levels above its level {questLevel}: it gives {percent}% of its XP{lostText}.',
    explanation: 'Quest XP falls from 6 levels above the quest level: 80, 60, 40 and 20%, then 10%.',
  },
  // Data (ARCHITECTURE §5.5; SIMULATION §7.4)
  {
    code: 'DATA001-custom-shadowed',
    rule: 'ARCHITECTURE §5.5',
    severity: 'info',
    variantOf: null,
    params: [],
    message: 'The custom quest {quest} replaces the dataset quest with the same id.',
    explanation: 'A custom quest with a real id overrides the dataset record; delete the custom quest to use the dataset record again.',
  },
  {
    code: 'DATA002-unknown-quest',
    rule: 'SIMULATION §7.4',
    severity: 'warning',
    variantOf: null,
    params: [],
    message: "{quest} is not in the dataset or among the project's custom quests.",
    explanation: 'An unknown quest is checked as far as possible and never counted as an error.',
  },
  {
    code: 'DATA003-unknown-objective',
    rule: 'SIMULATION §7.4',
    severity: 'warning',
    variantOf: null,
    params: ['objective', 'objectives'],
    message: '{quest} has no objective {objectiveText}; its work in this step cannot be priced.',
    explanation: "The step names an objective the quest's data does not have, so that work has an unknown time.",
  },
  // Simulation (SIMULATION §7.7)
  {
    code: 'SIM001-unknown-xp',
    rule: 'SIM-1',
    severity: 'info',
    variantOf: null,
    params: ['reason'],
    message: '{quest} gives an unknown amount of XP; the levels after it are lower bounds.',
    explanation: 'Unknown XP is never counted as 0. Later level checks become uncertain until a grind to a level makes the level known again.',
  },
  {
    code: 'SIM002-grind-upper-bound',
    rule: 'SIM-2',
    severity: 'info',
    variantOf: null,
    params: [],
    message: 'This grind makes the level known again; its time is an upper bound.',
    explanation: 'The grind is priced from the lower-bound level, so the true time is at most this.',
  },
  {
    code: 'SIM003-unresolved-location',
    rule: 'SIM-3',
    severity: 'info',
    variantOf: null,
    params: [],
    message: 'A place in this step cannot be placed on the map; its travel time is unknown.',
    explanation: "The location, every spawn of the step's NPC or object, or a transport dock, has no world position.",
  },
  {
    code: 'SIM004-cross-world-no-transport',
    rule: 'SIM-4',
    severity: 'warning',
    variantOf: null,
    params: ['fromMapId', 'toMapId'],
    message: 'This step moves from world map {fromMapId} to world map {toMapId} without a transport, hearth or instance entrance; the travel time is unknown.',
    explanation: 'A move between world maps needs a transport step, a hearth or an instance entrance.',
  },
  {
    code: 'SIM005-hearth-cooldown',
    rule: 'SIM-5',
    severity: 'warning',
    variantOf: null,
    params: ['waitSeconds'],
    message: 'The hearthstone is on cooldown; the route waits {waitText} for it.',
    explanation: 'The hearthstone cooldown is counted as waiting time.',
  },
  {
    code: 'SIM005-hearth-cooldown-uncertain',
    rule: 'SIM-5',
    severity: 'warning',
    variantOf: 'SIM005-hearth-cooldown',
    params: ['waitSeconds'],
    message: 'The hearthstone may still be on cooldown: the route waits up to {waitText}. An earlier step has an unknown time, so the wait is unknown.',
    explanation: 'After a step with an unknown time the route clock is a lower bound, so the cooldown wait is only an upper bound.',
  },
  {
    code: 'SIM006-hearth-unbound',
    rule: 'SIM-6',
    severity: 'warning',
    variantOf: null,
    params: [],
    message: 'The hearthstone is used with no bind point that can be placed on the map; the destination is unknown.',
    explanation: 'Set a hearth location in the character profile, or add a bind step first; a bind location that does not resolve counts as none.',
  },
  {
    code: 'SIM007-flight-unknown-path',
    rule: 'SIM-7',
    severity: 'warning',
    variantOf: null,
    params: ['end', 'node'],
    message: "Not a known flight path: the flight's {endText} node, {nodeText}.",
    explanation: 'A flight needs both flight paths discovered, in the profile or by an earlier step.',
  },
  {
    code: 'SIM008-flight-unresolved',
    rule: 'SIM-8',
    severity: 'warning',
    variantOf: null,
    params: ['end', 'reason'],
    message: "The flight's {endText} cannot be resolved: {reasonText}.",
    explanation: 'The flight node named by the step matches no flight master, several, or one without a position.',
  },
  {
    code: 'SIM009-mount-untrained',
    rule: 'SIM-9',
    severity: 'warning',
    variantOf: null,
    params: [],
    message: 'This step travels mounted before riding is trained; it is priced on foot.',
    explanation: 'Riding comes from the profile or from a riding train step.',
  },
  {
    code: 'SIM010-riding-too-low',
    rule: 'SIM-10',
    severity: 'warning',
    variantOf: null,
    params: ['tier', 'requiredLevel', ...LEVEL],
    message: 'Riding tier {tier} needs level {requiredLevel}; the character is level {level}, so riding is unchanged.',
    explanation: 'Riding training is refused below its level.',
  },
  {
    code: 'SIM010-riding-too-low-uncertain',
    rule: 'SIM-10',
    severity: 'warning',
    variantOf: 'SIM010-riding-too-low',
    params: ['tier', 'requiredLevel', ...LEVEL],
    message: 'Riding tier {tier} needs level {requiredLevel}; the character is at least level {level}. The XP of an earlier quest is unknown, so the training is assumed to succeed.',
    explanation: 'After a turn-in with unknown XP the level is a lower bound, so the training may succeed.',
  },
  {
    code: 'SIM011-target-level-late',
    rule: 'SIM-11',
    severity: 'warning',
    variantOf: null,
    params: ['seconds', 'warnSeconds'],
    message: 'The grind to the target level takes about {durationText}, more than {warnText}.',
    explanation: 'The route reaches the target level too late and relies on a long grind.',
  },
  {
    code: 'SIM011-target-level-late-uncertain',
    rule: 'SIM-11',
    severity: 'warning',
    variantOf: 'SIM011-target-level-late',
    params: ['seconds', 'warnSeconds'],
    message: 'The grind to the target level takes at most about {durationText}, more than {warnText}; the XP of an earlier quest is unknown.',
    explanation: 'The grind is priced from the lower-bound level, so its time is an upper bound.',
  },
  {
    code: 'SIM012-objective-already-done',
    rule: 'SIM-12',
    severity: 'info',
    variantOf: null,
    params: ['objective'],
    message: '{quest}: {objectiveText} already done.',
    explanation: 'An earlier step already finished this objective; this step adds no work for it.',
  },
  {
    code: 'SIM013-condition-unknown',
    rule: 'SIM-13',
    severity: 'warning',
    variantOf: null,
    params: [],
    message: 'A condition of this step cannot be decided for this character; the step is kept.',
    explanation: 'A filter, variant or skip condition depends on something the project does not know. The step is never silently hidden.',
  },
  {
    code: 'SIM014-transport-faction',
    rule: 'SIM-14',
    severity: 'warning',
    variantOf: null,
    params: ['transportId'],
    message: "Transport {transportId} does not serve the character's faction.",
    explanation: "The transport's known factions exclude the character.",
  },
  {
    code: 'SIM015-time-unknown',
    rule: 'SIM-15',
    severity: 'info',
    variantOf: null,
    params: ['part', 'reason', 'objective'],
    message: 'The {part} time of this step cannot be estimated: {reasonText}.',
    explanation: "The step's duration is unknown, and later times are lower bounds.",
  },
  {
    code: 'SIM016-complete-not-in-log',
    rule: 'SIM-16',
    severity: 'warning',
    variantOf: null,
    params: [],
    message: '{quest} is not in the quest log while this step works on it.',
    explanation: 'Objective work counts only for a quest in the quest log.',
  },
  {
    code: 'SIM016-complete-not-in-log-unverifiable',
    rule: 'SIM-16',
    severity: 'warning',
    variantOf: 'SIM016-complete-not-in-log',
    params: [],
    message: '{quest} is worked on but never accepted in the route; it is assumed to have been in the quest log before the route.',
    explanation: 'With an unknown history before the route, a quest the route never accepted is assumed to have been accepted before it.',
  },
  {
    code: 'SIM017-no-walking-path',
    rule: 'SIM-17',
    severity: 'warning',
    variantOf: null,
    params: ['legs'],
    message: 'The navigation data has no walking path for {legsText} of this step, and no transport joins the places; a straight-line estimate is used.',
    explanation: 'The places are disconnected in the navigation data, probably by a missing connector.',
  },
  {
    code: 'SIM018-off-navmesh',
    rule: 'SIM-18',
    severity: 'warning',
    variantOf: null,
    params: ['legs', 'end'],
    message: 'Off the navigation mesh: the {endText} of {legsText} of this step; a straight-line estimate is used.',
    explanation: 'No walkable ground lies within 6 yards of the point.',
  },
  {
    code: 'SIM019-unverified-passage',
    rule: 'SIM-19',
    severity: 'warning',
    variantOf: null,
    params: ['legs', 'passages'],
    message: 'The path of this step goes through {passageText}, which nobody has walked in game yet.',
    explanation: 'The navigation data finds a passage that still needs an in-game check. The leg keeps its estimate.',
  },
  {
    code: 'SIM020-ambiguous-floor',
    rule: 'SIM-20',
    severity: 'warning',
    variantOf: null,
    params: ['legs'],
    message: 'An end of {legsText} of this step could be on more than one floor; the chosen floor is used.',
    explanation: 'The point lies over several floors of a multi-level place.',
  },
  {
    code: 'SIM021-long-swim',
    rule: 'SIM-21',
    severity: 'warning',
    variantOf: null,
    params: ['legs', 'longestSwimYd'],
    message: 'The path of this step includes a swim of {longestSwimYd} yards; whether fatigue applies is not verified.',
    explanation: 'Swims over 200 yards are flagged, because fatigue is not modelled.',
  },
  {
    code: 'SIM022-legs-pending',
    rule: 'SIM-22',
    severity: 'info',
    variantOf: null,
    params: ['legs', 'steps'],
    message: 'Travel legs still being computed: {legs} on {stepsText}; their times are straight-line estimates until then.',
    explanation: 'Travel estimates are pending: the navigation legs arrive in the background and replace the straight-line values.',
  },
  {
    code: 'SIM023-start-xp-beyond-level',
    rule: 'SIM-23',
    severity: 'warning',
    variantOf: null,
    params: ['startLevel', 'startXp', 'level', 'xp'],
    message: 'The start XP, {startXp}, is more than level {startLevel} holds; the route starts at level {level} with {xp} XP.',
    explanation: 'The start XP is the XP into the start level. More than the level holds is carried over as a level-up would be.',
  },
] as const satisfies readonly IssueCodeSpec[];

export type IssueCode = (typeof ISSUE_CODES)[number]['code'];

const SPECS: ReadonlyMap<string, IssueCodeSpec> = new Map(ISSUE_CODES.map((spec) => [spec.code, spec]));

/** Whether `code` is registered here (the VAL, LINT, SIM and DATA families). */
export function isRegisteredCode(code: string): code is IssueCode {
  return SPECS.has(code);
}

export function issueCodeSpec(code: IssueCode): IssueCodeSpec {
  const spec = SPECS.get(code);
  if (spec === undefined) throw new Error(`unregistered issue code ${code}`);
  return spec;
}

export interface ParsedIssueCode {
  readonly family: IssueFamily;
  readonly number: number;
  readonly slug: string;
}

/** A code split by the grammar, or null when it does not follow it. */
export function parseIssueCode(code: string): ParsedIssueCode | null {
  const match = ISSUE_CODE_PATTERN.exec(code);
  if (match === null) return null;
  const [, family, digits, slug] = match;
  if (family === undefined || digits === undefined || slug === undefined) return null;
  return { family: family as IssueFamily, number: Number(digits), slug };
}

const PLACEHOLDER = /\{([A-Za-z]+)\}/g;

/** The `{name}` placeholders of a template, in order of first use. */
export function templatePlaceholders(template: string): string[] {
  const names: string[] = [];
  for (const match of template.matchAll(PLACEHOLDER)) {
    const name = match[1];
    if (name !== undefined && !names.includes(name)) names.push(name);
  }
  return names;
}

/** A template split once into text (even indices) and placeholder names (odd indices). */
function compile(template: string): readonly string[] {
  const parts: string[] = [];
  let last = 0;
  for (const match of template.matchAll(PLACEHOLDER)) {
    parts.push(template.slice(last, match.index), match[1] ?? '');
    last = match.index + match[0].length;
  }
  parts.push(template.slice(last));
  return parts;
}

const TEMPLATES: ReadonlyMap<string, readonly string[]> = new Map(ISSUE_CODES.map((spec) => [spec.code, compile(spec.message)]));

/**
 * The message of `code` with its placeholders filled from `words` first, then `data`. A value
 * missing from both is an error in the rule that emits the code, so it throws.
 */
export function formatIssueMessage(code: IssueCode, data: IssueData | null, words: Readonly<Record<string, string | number>> | null): string {
  const parts = TEMPLATES.get(code);
  if (parts === undefined) throw new Error(`unregistered issue code ${code}`);
  let out = parts[0] ?? '';
  for (let i = 1; i < parts.length; i += 2) {
    const name = parts[i] ?? '';
    const word = words === null ? undefined : words[name];
    let text: string;
    if (word !== undefined) text = typeof word === 'string' ? word : String(word);
    else {
      const value = data === null ? undefined : data[name];
      if (value === undefined || value === null) throw new Error(`issue ${code}: no value for {${name}}`);
      text = String(value);
    }
    out += text + (parts[i + 1] ?? '');
  }
  return out;
}
