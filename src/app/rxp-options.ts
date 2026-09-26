import { defaultCharacter } from '../domain/project-factory';
import type { UiMapId } from '../domain/ids';
import { ERA_CHANGED_UIMAP_IDS } from '../geo/era';
import { characterName } from './character-names';
import type * as RxpToolsModule from './rxp-tools';

/**
 * What the RXP custom-guide dialogs need before the RXP code is loaded (docs/UI.md §15): the
 * option types, the labels, a few constants and the loader. RXP import and export are a lazy
 * boundary (ARCHITECTURE §12.1): `src/rxp` and the app code over it (`rxp-tools.ts`) are fetched
 * with a dynamic `import()` the first time a dialog needs them, so they stay out of the entry chunk.
 */

/** Where an imported guide goes: a new project, or the end of the open route (one undo entry). */
export type RxpImportTarget = 'new-project' | 'append';

/**
 * Quests the guide uses that the data does not have (docs/RXP.md §15.4): add each as a placeholder
 * custom quest with its real id (ARCHITECTURE §5.5), or leave them unknown for the validator to
 * warn about (ARCHITECTURE §9.4).
 */
export type RxpUnknownQuestPolicy = 'placeholder' | 'warn';

/** The frame of percent points on the four zone maps that changed in Forever (docs/RXP.md §10.4). */
export type RxpFrame = 'forever' | 'era';

/** `txt`: the guide text; `lua`: the text wrapped in `RXPGuides.RegisterGuide(...)` (docs/RXP.md §13.4 rule 14). */
export type RxpExportFormat = 'txt' | 'lua';

export const RXP_IMPORT_LABEL = 'Import RXP custom guide';
export const RXP_EXPORT_LABEL = 'Export RXP custom guide';

/** The UiMaps whose percent frame differs between Era and Forever (1412, 1423, 1433, 1453). */
export const FRAME_CHANGED_UIMAPS: readonly UiMapId[] = ERA_CHANGED_UIMAP_IDS;

/** Larger files or pasted texts are refused before they are read: a guide file is far smaller. */
export const MAX_RXP_BYTES = 8 * 1024 * 1024;

/** The file picker's filter: custom-guide Lua files and plain guide text. */
export const RXP_FILE_ACCEPT = '.lua,.txt,text/plain';

/** The character a guide imported as a new project starts with, in words ("Horde Orc Warrior, level 1"). */
export const NEW_PROJECT_CHARACTER_TEXT: string = (() => {
  const character = defaultCharacter();
  return `${character.faction} ${characterName(character)}, level ${String(character.startLevel)}`;
})();

export type RxpTools = typeof RxpToolsModule;

let tools: Promise<RxpTools> | null = null;

/**
 * Loads the RXP code (`src/rxp` and `rxp-tools.ts`) once. A failed load is forgotten, so the next
 * call tries again (a dialog's "Try again").
 */
export function loadRxpTools(): Promise<RxpTools> {
  tools ??= import('./rxp-tools').catch((error: unknown) => {
    tools = null;
    throw error;
  });
  return tools;
}
