import { type DragEvent, type ReactNode, type Ref, useEffect, useId, useRef, useState } from 'react';
import { type DownloadFile, MAX_IMPORT_BYTES, PROJECT_FILE_EXTENSION, type ProjectIssue, type ProjectSession } from '../../app/persistence';
import { cx } from '../lib/cx';
import { plural } from '../lib/format';
import { SeverityIcon } from '../markers/SeverityIcon';
import { Button } from '../primitives/Button';
import type { Announce } from './LiveAnnouncer';
import { ModalDialog } from './ProjectMenuDialog';
import { useProjectSessionState } from './ProjectMenuContext';
import './ProjectMenu.css';

/**
 * Native project files (ARCHITECTURE §8.2, §12.3): export the open project as a deterministic
 * `.frl.json` file, and import one as a new project. An import is checked before anything is stored
 * (version, migrations, validation) and never repaired: a file that does not pass is refused with
 * the path of every problem. The file is decoded as strict UTF-8. RXP custom guides plug in through
 * the `rxp` slots.
 */

/** Hands a file to the browser as a download (a Blob behind an object URL, released afterwards). */
export function downloadFile(file: DownloadFile): void {
  const blob = new Blob([file.text], { type: `${file.mimeType};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = file.fileName;
  link.rel = 'noopener';
  link.hidden = true;
  document.body.append(link);
  link.click();
  link.remove();
  // Some browsers read the URL after click() returns; release it once the download has started.
  window.setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 10_000);
}

/** Shown only where no RXP entry is given (component tests); the app always gives one. */
const RXP_UNAVAILABLE = 'RestedXP custom guides are not available here.';

/**
 * A file's text, decoded as UTF-8 strictly: an invalid byte sequence is refused, never replaced
 * with U+FFFD (M4 review CR-16; the data loader decodes the same way). A byte-order mark is skipped.
 */
export async function readUtf8File(file: Pick<Blob, 'arrayBuffer'>): Promise<{ readonly ok: true; readonly text: string } | { readonly ok: false }> {
  const bytes = await file.arrayBuffer();
  try {
    return { ok: true, text: new TextDecoder('utf-8', { fatal: true }).decode(bytes) };
  } catch {
    return { ok: false };
  }
}

function IssueSummary({ title, errors, focusRef }: { readonly title: string; readonly errors: readonly ProjectIssue[]; readonly focusRef: Ref<HTMLDivElement> }) {
  const limit = 50;
  return (
    <div ref={focusRef} tabIndex={-1} className="frl-projects__failure">
      <p className="frl-projects__failure-title">
        <SeverityIcon severity="error" labelled={false} size={14} />
        {title}
      </p>
      {errors.length > 0 && (
        <>
          <p className="frl-projects__hint">{plural(errors.length, 'problem', 'problems')}, by where they are in the file:</p>
          <ul className="frl-projects__issues">
            {errors.slice(0, limit).map((issue, i) => (
              <li key={`${issue.path}-${String(i)}`}>
                <code>{issue.path === '' ? '(the whole file)' : issue.path}</code>: {issue.message}
              </li>
            ))}
            {errors.length > limit && <li>… and {plural(errors.length - limit, 'more problem', 'more problems')}</li>}
          </ul>
        </>
      )}
    </div>
  );
}

export interface ImportDialogProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly session: ProjectSession;
  readonly announce?: Announce | undefined;
  /** Import unavailable (an edit lock is held), with the reason; null when available. */
  readonly unavailableReason?: string | null | undefined;
  /** The RXP custom-guide import; omitted: says it is not available here. */
  readonly rxp?: ReactNode;
}

interface ImportFailure {
  readonly title: string;
  readonly errors: readonly ProjectIssue[];
}

/** Import: pick or drop a `.frl.json` file; it opens as a new project. */
export function ImportDialog({ open, onClose, session, announce, unavailableReason = null, rxp }: ImportDialogProps) {
  const [failure, setFailure] = useState<ImportFailure | null>(null);
  const [reading, setReading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const inputId = useId();
  const descriptionId = useId();
  const failureRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const blocked = unavailableReason ?? (reading ? 'Reading the file' : null);

  useEffect(() => {
    if (failure !== null) failureRef.current?.focus();
  }, [failure]);

  const close = () => {
    setFailure(null);
    setDragging(false);
    onClose();
  };

  const importFile = async (file: File) => {
    if (blocked !== null) return;
    if (file.size > MAX_IMPORT_BYTES) {
      setFailure({ title: `“${file.name}” is larger than ${String(MAX_IMPORT_BYTES / (1024 * 1024))} MB, too large for a project file.`, errors: [] });
      return;
    }
    setReading(true);
    let decoded: Awaited<ReturnType<typeof readUtf8File>>;
    try {
      decoded = await readUtf8File(file);
    } catch (error: unknown) {
      setReading(false);
      setFailure({ title: `“${file.name}” could not be read: ${error instanceof Error ? error.message : String(error)}`, errors: [] });
      return;
    }
    if (!decoded.ok) {
      setReading(false);
      setFailure({ title: `“${file.name}” is not valid UTF-8 text, so it is not a project file this app can open. Nothing was changed.`, errors: [] });
      return;
    }
    const result = await session.importProjectText(decoded.text, file.name);
    setReading(false);
    announce?.(result.message);
    if (result.ok) {
      close();
      return;
    }
    setFailure({ title: result.message, errors: result.errors });
  };

  const onDrop = (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer.files[0];
    if (file !== undefined) void importFile(file);
  };

  return (
    <ModalDialog open={open} onClose={close} title="Import" className="frl-import">
      <section
        className={cx('frl-import__section', dragging && 'is-dragging')}
        aria-labelledby={`${inputId}-heading`}
        onDragOver={(event) => {
          if (!event.dataTransfer.types.includes('Files')) return;
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => {
          setDragging(false);
        }}
        onDrop={onDrop}
      >
        <h3 id={`${inputId}-heading`} className="frl-projects__heading">
          Project file ({PROJECT_FILE_EXTENSION})
        </h3>
        <p id={descriptionId} className="frl-projects__hint">
          Opens a project file exported from Forever Route Lab as a new project; nothing stored is replaced. The file is checked first and used
          as it is: a file with problems is refused, never repaired.
        </p>
        <div className="frl-import__pick">
          <label htmlFor={inputId} className="frl-import__label">
            Choose a project file
          </label>
          <input
            ref={inputRef}
            id={inputId}
            type="file"
            accept={`${PROJECT_FILE_EXTENSION},.json,application/json`}
            aria-describedby={descriptionId}
            aria-disabled={blocked === null ? undefined : true}
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              // The same file can be chosen again after fixing it.
              event.currentTarget.value = '';
              if (file !== undefined) void importFile(file);
            }}
          />
        </div>
        <p className="frl-import__drop" aria-hidden="true">
          or drop the file here
        </p>
        {blocked !== null && <p className="frl-projects__hint">{blocked}.</p>}
        {failure !== null && <IssueSummary title={failure.title} errors={failure.errors} focusRef={failureRef} />}
      </section>
      <section className="frl-import__section" aria-label="RXP custom guide">
        <h3 className="frl-projects__heading">RXP custom guide</h3>
        {rxp ?? <p className="frl-projects__hint">{RXP_UNAVAILABLE}</p>}
      </section>
    </ModalDialog>
  );
}

export interface ExportDialogProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly session: ProjectSession;
  readonly announce?: Announce | undefined;
  readonly download?: ((file: DownloadFile) => void) | undefined;
  /** The RXP custom-guide export; omitted: says it is not available here. */
  readonly rxp?: ReactNode;
}

/** Export: the open project as a `.frl.json` download. */
export function ExportDialog({ open, onClose, session, announce, download = downloadFile, rxp }: ExportDialogProps) {
  const name = useProjectSessionState(session)?.current.name ?? '';
  return (
    <ModalDialog open={open} onClose={onClose} title="Export" className="frl-import">
      <section className="frl-import__section" aria-label={`Project file (${PROJECT_FILE_EXTENSION})`}>
        <h3 className="frl-projects__heading">Project file ({PROJECT_FILE_EXTENSION})</h3>
        <p className="frl-projects__hint">
          Everything in the open project, “{name}”, as one JSON file that Forever Route Lab can import again. The same project always gives the
          same file.
        </p>
        <Button
          variant="primary"
          icon="export"
          onClick={() => {
            const file = session.exportCurrent();
            download(file);
            announce?.(`Exported “${file.fileName}”.`);
            onClose();
          }}
        >
          Download project file
        </Button>
      </section>
      <section className="frl-import__section" aria-label="RXP custom guide">
        <h3 className="frl-projects__heading">RXP custom guide</h3>
        {rxp ?? <p className="frl-projects__hint">{RXP_UNAVAILABLE}</p>}
      </section>
    </ModalDialog>
  );
}
