/**
 * The modal dialog of the project menu, the import and export dialogs and the drift report: the
 * app's one `ModalDialog` (./ModalDialog.tsx, docs/UI.md §9 rule 7), so these dialogs have what
 * the others have (global shortcuts off while open, focus kept inside when a control removes
 * itself, their own live region, plain header and footer; UI review F1, F2, F16).
 */
export { ModalDialog, type ModalDialogProps } from './ModalDialog';
