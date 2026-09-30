/**
 * The few words about quest state the shell needs in the entry chunk (docs/research/ui-refresh.md
 * §10.3): the model itself (src/app/quest-state.ts) is built in the lazy derived pipeline, and the
 * ui may import its types only.
 */

/** "an Orc Warrior", "a Human Warrior". */
export function withArticle(who: string): string {
  return `${/^[AEIOU]/.test(who) ? 'an' : 'a'} ${who}`;
}

/** "Quests open to an Orc Warrior (no route state yet)": the words for the map and the Available tab without route state (map-presentation.md §7.1). */
export const noStateText = (who: string): string => `Quests open to ${withArticle(who)} (no route state yet)`;
