import type { SpellId } from '../domain/ids';
import type { TrainStep } from '../domain/route';
import type { RidingSpell } from './ruleset';

/**
 * Riding recognition (docs/SIMULATION.md TIME-3, ARCHITECTURE §9.1). A `train` step is a riding
 * step when `skill === 'riding'` or its `spellId` is one of the ruleset's riding spells, so an
 * imported `.train 33388` enables mounted travel.
 */

/** The tier a riding spell grants, or null when `spellId` is not a riding spell of the ruleset. */
export function ridingSpellTier(spells: readonly RidingSpell[], id: SpellId | null): 1 | 2 | null {
  if (id === null) return null;
  return spells.find((spell) => spell.spellId === id)?.tier ?? null;
}

/** Whether a `train` step trains riding (by skill or by a riding spell id). */
export function isRidingTrainStep(step: Pick<TrainStep, 'skill' | 'spellId'>, spells: readonly RidingSpell[]): boolean {
  return step.skill === 'riding' || ridingSpellTier(spells, step.spellId) !== null;
}
