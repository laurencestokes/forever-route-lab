/**
 * Whether a modal dialog is open in the document. Every modal of the app is a native `<dialog>`
 * shown with `showModal()` (docs/UI.md §9 rule 7); the map's choice list is a `role="dialog"`
 * element, not a `<dialog>`, so it does not count. While one is open, the page outside it is
 * inert: the shell's global shortcuts and the map pick's Escape stay off (UI-F1, UI-F8).
 */
export function isModalDialogOpen(doc: Document | null = typeof document === 'undefined' ? null : document): boolean {
  return doc !== null && doc.querySelector('dialog[open]') !== null;
}
