/**
 * The RXP custom-guide code the dialogs load on demand (`loadRxpTools` in `rxp-options.ts`,
 * ARCHITECTURE §12.1): import and export over `src/rxp`, and the context they share. Nothing in the
 * entry chunk imports this file, so `src/rxp` arrives only when a dialog needs it.
 */
export { createRxpContext, questFactsOf, type RxpContext } from './rxp-context';
export { previewRxpExport, routeImports, rxpFileName, type RxpExportMode, type RxpExportPreview, type RxpExportProblem, type RxpExportVariant } from './rxp-export';
export {
  applyRxpImport,
  DEFAULT_GUIDE_NAME,
  guideNameFromFileName,
  newProjectViewInput,
  placeholderCustomQuest,
  placeholderQuestName,
  previewRxpImport,
  questIdsOfStep,
  rxpImportCommand,
  rxpImportContext,
  rxpImportProject,
  type RxpContextSources,
  type RxpGuideSummary,
  type RxpImportApplied,
  type RxpImportChoice,
  type RxpImportPreview,
  type RxpImportRequest,
  type RxpNewProject,
  type RxpUnknownQuest,
} from './rxp-import';
export { RXP_CODES, rxpCodeSpec, type RxpDiagnostic } from '../rxp';
