/**
 * The parts of the shell that load on first use (`lazy.tsx`), in one chunk: one dynamic import
 * for the five keeps the modules they share (the kit's buttons and icons, the modal dialog) in
 * the entry chunk, where the shell already has them, instead of in extra shared chunks. The
 * validation panel brings the issue-code registry (src/app/issue-codes.ts) with it.
 */
export { CustomQuestEditor } from './CustomQuestEditor';
export { RxpExportDialog } from './RxpExportDialog';
export { RxpImportDialog } from './RxpImportDialog';
export { SettingsDialog } from './SettingsDialog';
export { ValidationPanel } from './ValidationPanel';
