/**
 * The parts of the shell that load on first use (`lazy.tsx`), in one chunk: one dynamic import
 * for the six keeps the modules they share (the kit's buttons and icons, the modal dialog) in
 * the entry chunk, where the shell already has them, instead of in extra shared chunks. The
 * validation panel brings the issue-code registry (src/app/issue-codes.ts) with it; the Details
 * panel brings the step and quest details, the step editors and the field parsers
 * (docs/research/ui-refresh.md §10.3, step UR.1a: Available is the tab shown at start, so Details
 * is not needed for the first paint). The Projects dialog and the drift report (the ledger's
 * reserve, taken in UR.4: the route name's menu and the project bar stay in the entry) and the Quest
 * log tab (UR.6) join them, with the parts opened only by a press that UR.3-UR.6 moved out of the
 * entry chunk to keep it under the stop line (§10.3): the About, Import and Export dialogs, the
 * Projects menu's content and View's content. The Map layers drawer, its key and the map search
 * (map-presentation.md §25.3.1, step MP.4b: a lazy part here, not a dynamic import of its own),
 * with the drawer's words and counts (`app/map-wording.ts`), which it installs in the map controller;
 * and the map popover (map-presentation.md §14.2, step MP.6) with its content (`app/map-popover.ts`).
 */
export { AboutDialog } from '../shell/AboutDialog';
export { CustomQuestEditor } from './CustomQuestEditor';
export { ExportDialog, ImportDialog } from './ImportExport';
export { DriftDialog, ProjectMenuDialog } from './ProjectDialogs';
export { MapLayersPanel } from './MapLayersPanel';
export { MapPopoverPanel } from './MapPopoverPanel';
export { ProjectsMenuPopup } from './ProjectMenuPopup';
export { QuestLogPanel } from './QuestLogPanel';
export { RowViewPanel } from './RouteView';
export { RxpExportDialog } from './RxpExportDialog';
export { RxpImportDialog } from './RxpImportDialog';
export { SettingsDialog } from './SettingsDialog';
export { DetailsPanel } from './StepDetails';
export { ValidationPanel } from './ValidationPanel';
