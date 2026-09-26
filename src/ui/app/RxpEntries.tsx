import { useId } from 'react';
import { RXP_EXPORT_LABEL, RXP_IMPORT_LABEL } from '../../app/rxp-options';
import { Button } from '../primitives/Button';

/**
 * The RXP sections of the Import and Export dialogs (docs/UI.md §15): a sentence and the button
 * that opens the RXP dialog. They are in the entry chunk with those dialogs; the RXP dialogs
 * themselves load on first use (`lazy.tsx`).
 */

/** The Import dialog's RXP section: what it does, and the button that opens the RXP dialog. */
export function RxpImportEntry({ onOpen, unavailableReason = null }: { readonly onOpen: () => void; readonly unavailableReason?: string | null | undefined }) {
  const hintId = useId();
  return (
    <>
      <p id={hintId} className="frl-projects__hint">
        Paste a RestedXP custom guide, or open a custom-guide .lua or .txt file. It is checked line by line (nothing in it is run), then opened as a
        new project or added to the end of the route.
        {unavailableReason !== null && ` ${unavailableReason}.`}
      </p>
      <div>
        <Button
          icon="import"
          aria-describedby={hintId}
          aria-disabled={unavailableReason === null ? undefined : true}
          onClick={() => {
            if (unavailableReason === null) onOpen();
          }}
        >
          {RXP_IMPORT_LABEL}
        </Button>
      </div>
    </>
  );
}

/** The Export dialog's RXP section: what it does, and the button that opens the RXP dialog. */
export function RxpExportEntry({ onOpen }: { readonly onOpen: () => void }) {
  const hintId = useId();
  return (
    <>
      <p id={hintId} className="frl-projects__hint">
        The route as RestedXP custom-guide text or a custom-guide .lua file. An imported guide that was not edited comes back byte for byte.
      </p>
      <div>
        <Button icon="export" aria-describedby={hintId} onClick={onOpen}>
          {RXP_EXPORT_LABEL}
        </Button>
      </div>
    </>
  );
}
