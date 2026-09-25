import { describe, expect, it } from 'vitest';
import { sequentialIdSource } from './ids';
import { DEFAULT_GAME_BUILD, DEFAULT_ROUTE_PROFILE, createEmptyProject, defaultCharacter } from './project-factory';

const NOW = '2026-09-25T12:00:00.000Z';

describe('createEmptyProject', () => {
  it('builds an empty forever-beta project with injected ids and time', () => {
    const project = createEmptyProject({ ids: sequentialIdSource(1), nowIso: NOW, name: 'Placeholder route' });
    expect(project).toEqual({
      schemaVersion: 1,
      game: 'wow-forever',
      gameBuild: '1.60.1.69893',
      dataRevision: 'none',
      rulesetId: 'forever-beta',
      id: 'project-1',
      createdAt: NOW,
      updatedAt: NOW,
      route: { id: 'route-2', name: 'Placeholder route', description: '', steps: [], groups: {} },
      character: {
        faction: 'Horde',
        race: 'Orc',
        class: 'WARRIOR',
        sex: null,
        startLevel: 1,
        startXp: 0,
        startLocation: null,
        hearthLocation: null,
        knownFlightPaths: [],
        priorHistory: 'fresh',
        priorCompletedQuests: [],
        priorQuestLog: [],
        riding: 0,
        professions: {},
        reputation: null,
      },
      routeProfile: {
        xpRate: 1,
        season: null,
        phase: 6,
        hardcore: false,
        ssf: false,
        dungeons: [],
        groupQuests: false,
        xpStepSkipping: true,
        locale: 'enUS',
      },
      assumptions: {},
      customQuests: [],
      questOverrides: {},
      imports: [],
      ext: {},
    });
    expect(DEFAULT_GAME_BUILD).toBe('1.60.1.69893');
  });

  it('is deterministic for the same inputs', () => {
    const make = () => createEmptyProject({ ids: sequentialIdSource(5), nowIso: NOW, name: 'Placeholder' });
    expect(make()).toEqual(make());
  });

  it('accepts a data revision, game build and character overrides', () => {
    const project = createEmptyProject({
      ids: sequentialIdSource(),
      nowIso: NOW,
      name: 'Placeholder',
      dataRevision: 'rev-placeholder',
      gameBuild: '1.60.1.70009',
      character: { class: 'MAGE', startLevel: 10, priorHistory: 'unknown' },
    });
    expect(project.dataRevision).toBe('rev-placeholder');
    expect(project.gameBuild).toBe('1.60.1.70009');
    expect(project.character).toMatchObject({ faction: 'Horde', race: 'Orc', class: 'MAGE', startLevel: 10, priorHistory: 'unknown' });
  });

  it('does not share the default route profile object', () => {
    const a = createEmptyProject({ ids: sequentialIdSource(), nowIso: NOW, name: 'a' });
    expect(a.routeProfile).toEqual(DEFAULT_ROUTE_PROFILE);
    expect(a.routeProfile).not.toBe(DEFAULT_ROUTE_PROFILE);
    expect(a.routeProfile.dungeons).not.toBe(DEFAULT_ROUTE_PROFILE.dungeons);
  });
});

describe('defaultCharacter', () => {
  it('derives the faction from a given race', () => {
    expect(defaultCharacter({ race: 'Gnome' })).toMatchObject({ faction: 'Alliance', race: 'Gnome' });
    expect(defaultCharacter({ race: 'HighOrderSkyborne' })).toMatchObject({ faction: 'Alliance' });
    expect(defaultCharacter({ race: 'WindshaperSkyborne' })).toMatchObject({ faction: 'Horde' });
  });

  it('derives a default race from a given faction', () => {
    expect(defaultCharacter({ faction: 'Alliance' })).toMatchObject({ faction: 'Alliance', race: 'Human' });
    expect(defaultCharacter({ faction: 'Horde' })).toMatchObject({ faction: 'Horde', race: 'Orc' });
  });

  it('keeps an explicit race and faction as given', () => {
    expect(defaultCharacter({ faction: 'Horde', race: 'Human' })).toMatchObject({ faction: 'Horde', race: 'Human' });
  });
});
