/**
 * Branded identifier types. A brand makes `QuestId` and `NpcId` incompatible at compile time even
 * though both are plain numbers at runtime, which prevents the AreaId / UiMapId / WorldMapId
 * mix-ups that silently misplace points (docs/research/coordinates.md §13.1).
 */
declare const brand: unique symbol;
export type Brand<T, B extends string> = T & { readonly [brand]: B };

export type QuestId = Brand<number, 'QuestId'>;
export type NpcId = Brand<number, 'NpcId'>;
export type ObjectId = Brand<number, 'ObjectId'>;
export type ItemId = Brand<number, 'ItemId'>;
export type SpellId = Brand<number, 'SpellId'>;
export type FactionId = Brand<number, 'FactionId'>;
export type SkillId = Brand<number, 'SkillId'>;
/** AreaTable.dbc row id. QuestieDB keys spawns by this. */
export type AreaId = Brand<number, 'AreaId'>;
/** UiMap row id: one displayable map frame. */
export type UiMapId = Brand<number, 'UiMapId'>;
/** Map.dbc row id: a world coordinate space (0 Eastern Kingdoms, 1 Kalimdor, 2991 Zephras Isle, ...). */
export type WorldMapId = Brand<number, 'WorldMapId'>;

export type StepId = Brand<string, 'StepId'>;
export type GroupId = Brand<string, 'GroupId'>;
export type RouteId = Brand<string, 'RouteId'>;
export type ProjectId = Brand<string, 'ProjectId'>;

export const questId = (n: number): QuestId => n as QuestId;
export const npcId = (n: number): NpcId => n as NpcId;
export const objectId = (n: number): ObjectId => n as ObjectId;
export const itemId = (n: number): ItemId => n as ItemId;
export const spellId = (n: number): SpellId => n as SpellId;
export const factionId = (n: number): FactionId => n as FactionId;
export const skillId = (n: number): SkillId => n as SkillId;
export const areaId = (n: number): AreaId => n as AreaId;
export const uiMapId = (n: number): UiMapId => n as UiMapId;
export const worldMapId = (n: number): WorldMapId => n as WorldMapId;
export const stepId = (s: string): StepId => s as StepId;
export const groupId = (s: string): GroupId => s as GroupId;
export const routeId = (s: string): RouteId => s as RouteId;
export const projectId = (s: string): ProjectId => s as ProjectId;

/**
 * Source of new string identifiers. Pure code never generates IDs itself (no clock, no
 * randomness); callers inject an implementation (docs/ARCHITECTURE.md §2, §8.1).
 */
export interface IdSource {
  next(prefix: 'step' | 'group' | 'route' | 'project' | 'import'): string;
}

/** Deterministic IdSource for tests and reproducible pipelines: `step-1`, `step-2`, ... */
export function sequentialIdSource(start = 1): IdSource {
  let counter = start;
  return {
    next(prefix) {
      const id = `${prefix}-${counter}`;
      counter += 1;
      return id;
    },
  };
}

/**
 * Custom quests invented by the user have negative IDs, which the dataset never uses
 * (docs/ARCHITECTURE.md §5.5). Real IDs (for example Forever quests seen in an RXP guide) stay
 * positive.
 */
export function isInventedQuestId(id: QuestId): boolean {
  return id < 0;
}
