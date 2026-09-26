import { describe, expect, it } from 'vitest';
import { COMMAND_NAMES, commandCaseMatch, commandSpec } from './commands';
import { RXP_CODES } from './diagnostics';

describe('command registry (docs/RXP.md §9)', () => {
  it('knows every command RXP’s Forever guides use (§9.0 prevalence list)', () => {
    const used = [
      'goto', 'target', 'accept', 'turnin', 'mob', 'complete', 'collect', 'train', 'itemStat', 'dungeon', 'itemcount', 'xp', 'use',
      'isOnQuest', 'zoneskip', 'money', 'vendor', 'isQuestComplete', 'skill', 'subzoneskip', 'trainer', 'isQuestTurnedIn', 'waypoint',
      'isQuestAvailable', 'fly', 'unitscan', 'zone', 'cast', 'subzone', 'disablecheckbox', 'skipgossipid', 'link', 'hs', 'fp', 'cooldown',
      'deathskip', 'abandon', 'usespell', 'line', 'bindlocation', 'aura', 'home', 'timer', 'equip', 'destroy', 'skipgossip',
      'isQuestNotComplete', 'macro', 'group', 'bankdeposit', 'maxlevel', 'bronzetube', 'engrave', 'isNotOnQuest', 'gossipoption',
      'bankwithdraw', 'solo', 'addquestitem', 'emote',
    ];
    expect(used).toHaveLength(59);
    expect(used.filter((name) => commandSpec(name) === null)).toEqual([]);
  });

  it('has unique names and the separators of §4 S6', () => {
    expect(new Set(COMMAND_NAMES).size).toBe(COMMAND_NAMES.length);
    for (const name of ['mob', 'target', 'unitscan']) expect(commandSpec(name)?.separator).toBe('semicolon');
    for (const name of ['link', 'clicknext', 'setquestdb']) expect(commandSpec(name)?.separator).toBe('rest');
    expect(commandSpec('goto')?.separator).toBe('comma');
  });

  it('marks commands whose text is required (§11 #24)', () => {
    for (const name of ['hs', 'zone', 'subzone', 'link', 'clicknext', 'macro']) expect(commandSpec(name)?.requiredText).toBe('always');
    expect(commandSpec('fly')?.requiredText).toBe('nameOrText');
  });

  it('is case-sensitive, recognises prefix families and suggests the right case', () => {
    expect(commandSpec('Accept')).toBeNull();
    expect(commandCaseMatch('Accept')).toBe('accept');
    expect(commandCaseMatch('isonquest')).toBe('isOnQuest');
    expect(commandSpec('multiboxfollow')?.lowering.kind).toBe('annotation');
    expect(commandSpec('achievementcomplete')?.lowering.kind).toBe('preserved');
    expect(commandSpec('collect,')).toBeNull();
    expect(commandCaseMatch('MultiboxFollow')).toBe('multiboxFollow');
  });

  it('recognises the bare prefix of a family as well (§9.7: RXP registers .achievement, .multibox and .singlebox)', () => {
    expect(commandSpec('multibox')?.lowering.kind).toBe('annotation');
    expect(commandSpec('singlebox')?.lowering.kind).toBe('annotation');
    expect(commandSpec('achievement')?.lowering.kind).toBe('preserved');
    expect(commandSpec('isWorldQuest')?.lowering.kind).toBe('preserved');
    expect(commandSpec('multibox')?.name).toBe('multibox');
  });

  it('marks which preserved commands are route-relevant (§9.7 "Route relevance", RXP034)', () => {
    const relevant = (name: string): boolean | null => {
      const lowering = commandSpec(name)?.lowering;
      return lowering?.kind === 'preserved' ? lowering.routeRelevant : null;
    };
    for (const name of ['setquestdb', 'addtoquestdb', 'requires', 'xpto60', 'xpcheck', 'destroy', 'stable', 'tame']) expect(relevant(name), name).toBe(true);
    for (const name of ['noop', 'beta', 'scenario', 'skyriding', 'mirrorquest', 'hastyhearth', 'achievement', 'achievementcomplete', 'isWorldQuestActive']) expect(relevant(name), name).toBe(false);
  });
});

describe('diagnostic registry (docs/RXP.md §11.1)', () => {
  it('uses the FAMILYnnn-slug grammar, unique numbers, and never RXP008, RXP023 or the retired RXP033', () => {
    const numbers = RXP_CODES.map((spec) => spec.code.slice(0, 6));
    expect(new Set(numbers).size).toBe(numbers.length);
    for (const spec of RXP_CODES) expect(spec.code).toMatch(/^RXP\d{3}-[a-z0-9]+(?:-[a-z0-9]+)*$/);
    expect(numbers).not.toContain('RXP008');
    expect(numbers).not.toContain('RXP023');
    expect(numbers).not.toContain('RXP033');
    expect(RXP_CODES).toHaveLength(40);
  });
});
