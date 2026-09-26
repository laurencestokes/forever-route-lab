/**
 * Pure-module values the ui needs. ui may import values only from app (ARCHITECTURE §4), so they
 * are re-exported here rather than copied: the ui's difficulty labels and the token test's colours
 * then cannot drift from src/rules, and group lookups stay own-key safe (routeGroup).
 */
export { questOverride, routeGroup } from '../domain';
export { DIFFICULTIES, DIFFICULTY_COLORS, DIFFICULTY_LABELS, type Difficulty } from '../rules/difficulty';
