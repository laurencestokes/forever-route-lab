import { describe, expect, it } from 'vitest';
import { createPlaceholderWorkspace } from '../../app/placeholder-project';
import { raceOptionsOf, settingsDraftOf, settingsPatchOf } from './SettingsDialog';

// A level-1 character with the default route profile (ui tests take projects from app, ARCHITECTURE §4).
const { project } = createPlaceholderWorkspace({ nowIso: '2026-09-26T00:00:00.000Z' });
const draft = settingsDraftOf(project.character, project.routeProfile);

describe('settingsPatchOf', () => {
  it('reads the fields back into the project’s values, empty meaning unknown', () => {
    const { patch, problems } = settingsPatchOf({ ...draft, season: '', phase: '3', dungeons: 'RFC, WC', sex: 'female' }, 60);
    expect(problems).toEqual([]);
    expect(patch?.character).toMatchObject({ startLevel: 1, startXp: 0, sex: 'female', priorCompletedQuests: [], riding: 0 });
    expect(patch?.routeProfile).toMatchObject({ season: null, phase: 3, dungeons: ['RFC', 'WC'], locale: 'enUS', xpRate: 1 });
  });

  it('keeps prior quest lists only for a listed history', () => {
    expect(settingsPatchOf({ ...draft, priorHistory: 'unknown', priorCompleted: '1, 2' }, 60).patch?.character?.priorCompletedQuests).toEqual([]);
    expect(settingsPatchOf({ ...draft, priorHistory: 'listed', priorCompleted: '1, 2', priorLog: '3' }, 60).patch?.character).toMatchObject({
      priorCompletedQuests: [1, 2],
      priorQuestLog: [3],
    });
  });

  it('says every problem, in words', () => {
    const { patch, problems } = settingsPatchOf(
      { ...draft, startLevel: '26', startXp: '-1', priorHistory: 'listed', priorCompleted: 'x', priorLog: '1.5', xpRate: '0', season: '1.5', phase: 'p', locale: ' ' },
      25,
    );
    expect(patch).toBeNull();
    expect(problems.map((problem) => problem.field)).toEqual(['startLevel', 'startXp', 'priorCompleted', 'priorLog', 'xpRate', 'season', 'phase', 'locale']);
    expect(problems.map((problem) => problem.message)).toEqual([
      'The start level must be a whole number from 1 to 25.',
      'The start XP must be a whole number of at least 0 (the XP into the start level).',
      'Completed quests must be quest ids separated by commas or spaces.',
      'Quests in the log must be quest ids separated by commas or spaces.',
      'The XP rate must be a number above 0 (1 is the normal rate).',
      'The season must be a whole number, or left empty (unknown).',
      'The phase must be a whole number, or left empty (unknown).',
      'The locale must not be empty (enUS, for example).',
    ]);
  });
});

describe('raceOptionsOf', () => {
  it('lists the faction’s races, and the project’s race when it is not one of them (UI-F15)', () => {
    expect(raceOptionsOf('Horde', 'Orc').map((option) => option.value)).not.toContain('Human');
    expect(raceOptionsOf('Horde', 'Orc').some((option) => option.label.includes('not a'))).toBe(false);
    const mismatched = raceOptionsOf('Alliance', 'Orc');
    expect(mismatched.at(-1)).toEqual({ value: 'Orc', label: 'Orc (not a race of the Alliance)' });
  });
});
