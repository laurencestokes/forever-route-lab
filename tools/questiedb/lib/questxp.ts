import { LuaTable, sequence, ShapeError } from './lua-value';
import { runFile, supportEnvironment } from './sandbox';

/**
 * support/Forever/QuestXP/xpDB-classic.lua: `QuestXP.db = { [questId] = {questLevel, baseXp} }`,
 * an Era seed (DATA_PROVENANCE §3.1 item 5). Shipped as `xp: { questLevel, baseXp, basis:
 * 'era-seed' }`; a quest without a row ships `xp: null` (unknown, never 0).
 */

export const QUEST_XP_FILE = 'support/Forever/QuestXP/xpDB-classic.lua';

export interface QuestXpRow {
  readonly questLevel: number;
  readonly baseXp: number;
}

export function readQuestXp(bytes: Uint8Array, rules: string): ReadonlyMap<number, QuestXpRow> {
  const env = supportEnvironment(rules);
  const { lints } = runFile(QUEST_XP_FILE, bytes, env.globals, { locations: true });
  if (lints.length > 0) throw new ShapeError(QUEST_XP_FILE, lints.map((lint) => lint.detail).join('; '));
  const db = env.module('QuestXP').get('db');
  if (!(db instanceof LuaTable)) throw new ShapeError(QUEST_XP_FILE, 'QuestXP.db is not a table');
  const out = new Map<number, QuestXpRow>();
  for (const [id, row] of db.entries()) {
    const where = `${QUEST_XP_FILE} [${String(id)}]`;
    if (typeof id !== 'number' || !Number.isInteger(id) || id <= 0) throw new ShapeError(where, 'key is not a quest id');
    if (!(row instanceof LuaTable) || row.size !== 2) throw new ShapeError(where, 'row must be {questLevel, baseXp}');
    const [questLevel, baseXp] = sequence(row, where);
    if (typeof questLevel !== 'number' || typeof baseXp !== 'number') throw new ShapeError(where, 'row must hold two numbers');
    out.set(id, { questLevel, baseXp });
  }
  return out;
}
