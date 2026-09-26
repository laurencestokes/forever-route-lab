import { useMemo } from 'react';
import type { EditorState, EditorStore } from '../../app';
import { useEditor } from '../../app/react';
import type { QuestId } from '../../domain/ids';
import type { RouteStep } from '../../domain/route';
import { type ActiveRow, type ActiveTarget, resolveActiveTarget, routeQuestIds, type RouteView } from '../app-model';

/**
 * Store slices for the shell's panels (F13). Each panel subscribes to the slices it draws, so a
 * selection click does not re-render the top bar and a keystroke in a note does not re-render the
 * quest list. Selectors are module-level functions: useEditor recomputes a slice only when the
 * state changes, and a slice keeps its identity while it is equal (Object.is, or `isEqual` for
 * the ones that build arrays).
 */

export const selectRoute = (s: EditorState) => s.project.route;
export const selectRouteName = (s: EditorState) => s.project.route.name;
export const selectImports = (s: EditorState) => s.project.imports;
export const selectCharacter = (s: EditorState) => s.project.character;
export const selectStartLevel = (s: EditorState) => s.project.character.startLevel;
export const selectFaction = (s: EditorState) => s.project.character.faction;
export const selectCharacterClass = (s: EditorState) => s.project.character.class;
export const selectCustomQuests = (s: EditorState) => s.project.customQuests;
export const selectQuestOverrides = (s: EditorState) => s.project.questOverrides;
export const selectRulesetId = (s: EditorState) => s.project.rulesetId;
export const selectSelection = (s: EditorState) => s.selection;
export const selectFocus = (s: EditorState) => s.selection.focus;
export const selectSelectionCount = (s: EditorState) => s.selection.stepIds.size;
export const selectEditingLocked = (s: EditorState) => s.editingLocked;
export const selectHistory = (s: EditorState) => s.history;
export const selectRightTab = (s: EditorState) => s.view.rightTab;
export const selectClipboardCount = (s: EditorState) => s.clipboard.steps.length;
export const selectRouteProfile = (s: EditorState) => s.project.routeProfile;
export const selectAssumptions = (s: EditorState) => s.project.assumptions;
export const selectTheme = (s: EditorState) => s.view.theme;

/** routeQuestIds, cached on the step array: typing in a note keeps the array's content, not its identity. */
function lastByIdentity<A extends object, R>(compute: (arg: A) => R): (arg: A) => R {
  let last: { readonly arg: A; readonly result: R } | null = null;
  return (arg) => {
    if (last?.arg !== arg) last = { arg, result: compute(arg) };
    return last.result;
  };
}

const questIdsOfSteps = lastByIdentity((steps: readonly RouteStep[]) => routeQuestIds(steps));

/** The quests the route acts on; compare with `sameItems`. */
export const selectRouteQuestIds = (s: EditorState): readonly QuestId[] => questIdsOfSteps(s.project.route.steps);

/** The active row, step and step number for panels that follow the route list. */
export function useActiveTarget(store: EditorStore, view: RouteView, activeRow: ActiveRow | null): ActiveTarget {
  const focus = useEditor(store, selectFocus);
  return useMemo(() => resolveActiveTarget(view, activeRow, focus), [view, activeRow, focus]);
}
