import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { EditorStore } from '../../app';
import type { DownloadFile } from '../../app/persistence';
import { useEditor } from '../../app/react';
import type { RxpExportPreview, RxpExportVariant } from '../../app/rxp-export';
import { loadRxpTools, RXP_EXPORT_LABEL, type RxpExportFormat, type RxpTools } from '../../app/rxp-options';
import type { DatasetView } from '../../domain/dataset';
import type { ProjectV1, RxpImport } from '../../domain/project';
import type { MapGeometry } from '../../geo/types';
import type { RxpDiagnostic } from '../../rxp';
import { formatInteger, plural } from '../lib/format';
import { SeverityIcon } from '../markers/SeverityIcon';
import { Button } from '../primitives/Button';
import { Icon } from '../primitives/Icon';
import { downloadFile } from './ImportExport';
import type { Announce } from './LiveAnnouncer';
import { ModalDialog } from './ModalDialog';
import { RadioGroup, RxpDiagnosticList, type RxpSourceText, sourceLines } from './RxpParts';
import './RxpDialogs.css';

/**
 * "Export RXP custom guide" (docs/UI.md §15; docs/RXP.md §13): the open route as RXP guide text
 * (`.txt`) or a custom-guide addon file (`.lua`), previewed, copied or downloaded. It says whether
 * the text is byte-identical to the imported guide or rewritten in canonical form, and lists the
 * diagnostics of everything the export cannot keep (codes RXP040-RXP046); a step that cannot be
 * written at all is named, and nothing is exported then. The RXP code loads on first use.
 */

export interface RxpExportDialogProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly store: EditorStore;
  /** The open project's view of the data (the zone-key table). */
  readonly dataset: DatasetView;
  /** For points made in the app (their map frame); null or omitted: without it. */
  readonly geometry?: MapGeometry | null | undefined;
  /** Names the files when the route has no name. */
  readonly projectName: string;
  readonly announce?: Announce | undefined;
  /** Replaces the browser download (tests). */
  readonly download?: ((file: DownloadFile) => void) | undefined;
  /** Replaces the clipboard write (tests); default `navigator.clipboard.writeText`. */
  readonly copyText?: ((text: string) => Promise<void>) | undefined;
  /** Replaces the loader of the RXP code (tests). */
  readonly loadTools?: (() => Promise<RxpTools>) | undefined;
  /** How long "Copied" shows beside Copy; default `COPIED_STATUS_MS` (tests shorten it). */
  readonly copiedStatusMs?: number | undefined;
}

const NO_IMPORTS: readonly RxpImport[] = [];

/** What an export request needs; a new object whenever one of them changes. */
interface ExportRequest {
  readonly project: ProjectV1;
  readonly dataset: DatasetView;
  readonly geometry: MapGeometry | null;
  readonly projectName: string;
  readonly attempt: number;
}

type Loaded = { readonly kind: 'loading' } | { readonly kind: 'failed'; readonly message: string } | { readonly kind: 'ready'; readonly preview: RxpExportPreview };

/** A result, with the request it answers (an answer to an older request is not shown). */
type Answer = { readonly request: ExportRequest } & (
  | { readonly kind: 'failed'; readonly message: string }
  | { readonly kind: 'ready'; readonly preview: RxpExportPreview }
);

const LOADING: Loaded = { kind: 'loading' };

/** How long the visible "Copied" status stays beside Copy (the announcement says it once). */
export const COPIED_STATUS_MS = 4000;

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function clipboardWrite(text: string): Promise<void> {
  if (typeof navigator === 'undefined' || navigator.clipboard === undefined) return Promise.reject(new Error('this browser offers no clipboard here'));
  return navigator.clipboard.writeText(text);
}

export { RxpExportEntry } from './RxpEntries';

function statusText(preview: RxpExportPreview, variant: RxpExportVariant): string {
  if (variant.text === null) return 'This route cannot be exported as an RXP guide:';
  switch (preview.mode) {
    case 'identical': {
      const name = preview.identicalTo?.name ?? '';
      return variant.format === 'lua'
        ? `Byte-identical guide text: the route is the imported guide “${name}”, unedited, so the text inside the file is exactly the text that was imported. The file wraps it in RXPGuides.RegisterGuide(…).`
        : `Byte-identical to the imported guide “${name}”: the route is that guide, unedited, so this is exactly the text that was imported.`;
    }
    case 'rewritten':
      return `Not byte-identical to an imported guide: the route changed since ${preview.sources.length === 1 ? `“${preview.sources[0]?.name ?? ''}” was imported` : `its ${formatInteger(preview.sources.length)} guides were imported`}, or holds steps made here. RXP steps left unedited keep their original lines; edited, split and new steps are written in canonical form.`;
    case 'canonical':
      return 'Canonical form: nothing in this route came from an imported RXP guide, so all of it is written in the canonical RXP form.';
  }
}

export function RxpExportDialog({
  open,
  onClose,
  store,
  dataset,
  geometry = null,
  projectName,
  announce,
  download = downloadFile,
  copyText = clipboardWrite,
  loadTools = loadRxpTools,
  copiedStatusMs = COPIED_STATUS_MS,
}: RxpExportDialogProps) {
  // Read only while open, so edits made while it is closed do not re-render it.
  const project = useEditor(store, (s) => (open ? s.project : null));
  const [format, setFormat] = useState<RxpExportFormat>('txt');
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [copyNote, setCopyNote] = useState<string | null>(null);
  /** A visible, transient confirmation of a copy, beside the button (UI-F2); the key restarts its timer. */
  const [copied, setCopied] = useState<{ readonly text: string } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const previewRef = useRef<HTMLTextAreaElement>(null);
  const previewId = useId();
  const statusId = useId();

  const request = useMemo((): ExportRequest | null => (project === null ? null : { project, dataset, geometry, projectName, attempt }), [project, dataset, geometry, projectName, attempt]);
  // Until the answer to this request arrives, the dialog is preparing (never the last preview).
  const loaded: Loaded = request === null || answer === null || answer.request !== request ? LOADING : answer;

  useEffect(() => {
    if (request === null) return;
    let live = true;
    loadTools().then(
      (tools) => {
        if (!live) return;
        const ctx = tools.createRxpContext(request.dataset, request.geometry);
        setAnswer({ request, kind: 'ready', preview: tools.previewRxpExport(request.project, ctx, request.projectName) });
      },
      (error: unknown) => {
        if (live) setAnswer({ request, kind: 'failed', message: `The RXP code could not be loaded (${errorText(error)}). Check the connection and try again.` });
      },
    );
    return () => {
      live = false;
    };
  }, [request, loadTools]);

  useEffect(() => {
    if (copied === null) return undefined;
    const timer = setTimeout(() => {
      setCopied(null);
    }, copiedStatusMs);
    return () => {
      clearTimeout(timer);
    };
  }, [copied, copiedStatusMs]);

  const close = () => {
    setCopyNote(null);
    setCopied(null);
    onClose();
  };

  const preview = loaded.kind === 'ready' ? loaded.preview : null;
  const variant = preview === null ? null : format === 'lua' ? preview.lua : preview.txt;
  const imports = project?.imports ?? NO_IMPORTS;
  // The lines of the imports the diagnostics point into, split once per preview.
  const sources = useMemo(() => {
    const wanted = new Set((variant?.diagnostics ?? []).filter((diagnostic) => diagnostic.line > 0).map((diagnostic) => diagnostic.importId));
    return new Map(
      imports.filter((imp) => wanted.has(imp.id)).map((imp): [string, RxpSourceText] => [imp.id, { name: `the imported guide “${imp.name}”`, lines: sourceLines(imp.text) }]),
    );
  }, [imports, variant]);
  const sourceOf = useCallback((diagnostic: RxpDiagnostic): RxpSourceText | null => sources.get(diagnostic.importId) ?? null, [sources]);
  const importName = useMemo(() => new Map(imports.map((imp) => [imp.id, imp.name])), [imports]);
  const contextOf = useCallback(
    (diagnostic: RxpDiagnostic) => {
      if (diagnostic.importId === '' || imports.length < 2) return null;
      const name = importName.get(diagnostic.importId);
      return name === undefined ? null : `of “${name}”`;
    },
    [importName, imports.length],
  );

  const copy = async () => {
    const file = variant?.file ?? null;
    if (file === null) return;
    try {
      await copyText(file.text);
      setCopyNote(null);
      setCopied({ text: format === 'lua' ? 'Copied the .lua file' : 'Copied' });
      announce?.(`Copied the ${format === 'lua' ? '.lua file' : 'guide text'} to the clipboard.`);
    } catch {
      // The browser refused: select the preview, so Ctrl+C copies it. The browser's own error text
      // ("Failed to execute 'writeText' …") says nothing a user can act on, so it is not shown.
      setCopied(null);
      previewRef.current?.focus();
      previewRef.current?.select();
      const note = 'The browser did not allow copying. The preview is selected: press Ctrl+C to copy it.';
      setCopyNote(note);
      announce?.(note);
    }
  };

  const file = variant?.file ?? null;
  const unavailable = loaded.kind === 'loading' ? 'Preparing the export' : loaded.kind === 'failed' ? loaded.message : file === null ? 'This route cannot be exported' : null;

  const footer = (
    <>
      {unavailable !== null && (
        <span id={`${statusId}-reason`} className="frl-visually-hidden">
          {unavailable}
        </span>
      )}
      {copied !== null && (
        // Visible only: the announcement already says it (in the dialog's own region).
        <span className="frl-rxp__copied" aria-hidden="true">
          <Icon name="check" size={14} />
          {copied.text}
        </span>
      )}
      <Button onClick={close}>Close</Button>
      <Button
        icon="copy"
        aria-disabled={unavailable === null ? undefined : true}
        aria-describedby={unavailable === null ? undefined : `${statusId}-reason`}
        title={unavailable ?? undefined}
        onClick={() => {
          if (unavailable === null) void copy();
        }}
      >
        Copy
      </Button>
      <Button
        variant="primary"
        icon="export"
        aria-disabled={unavailable === null ? undefined : true}
        aria-describedby={unavailable === null ? undefined : `${statusId}-reason`}
        title={unavailable ?? undefined}
        onClick={() => {
          if (unavailable !== null || file === null) return;
          download(file);
          announce?.(`Exported “${file.fileName}”.`);
        }}
      >
        {file === null ? 'Download' : `Download ${file.fileName}`}
      </Button>
    </>
  );

  return (
    <ModalDialog open={open} onClose={close} title={RXP_EXPORT_LABEL} className="frl-rxp" footer={footer}>
      {loaded.kind === 'loading' && <p className="frl-rxp__hint">Preparing the export…</p>}
      {loaded.kind === 'failed' && (
        <div className="frl-rxp__problem">
          <SeverityIcon severity="error" labelled={false} size={14} />
          <span>{loaded.message}</span>
          <Button
            size="sm"
            onClick={() => {
              setAttempt((n) => n + 1);
            }}
          >
            Try again
          </Button>
        </div>
      )}
      {preview !== null && variant !== null && (
        <>
          <section className="frl-rxp__section" aria-labelledby={`${statusId}-heading`}>
            <h3 id={`${statusId}-heading`} className="frl-projects__heading">
              What is exported
            </h3>
            <p id={statusId} className={variant.text === null ? 'frl-rxp__refused-title' : 'frl-rxp__summary'}>
              {variant.text === null && <SeverityIcon severity="error" labelled={false} size={14} />}
              {statusText(preview, variant)}
            </p>
            {variant.problems.length > 0 && (
              <ul className="frl-rxp__problems">
                {variant.problems.map((problem, i) => (
                  <li key={`${String(i)}-${problem.message}`}>
                    {problem.stepNumber === null ? 'The route' : `Step ${formatInteger(problem.stepNumber)}`}: {problem.message}
                  </li>
                ))}
              </ul>
            )}
            <RadioGroup<RxpExportFormat>
              legend="Format"
              value={format}
              options={[
                { value: 'txt', label: 'Guide text (.txt)', hint: 'The text RXP’s custom-guide import takes, as it is written between RegisterGuide’s brackets.' },
                { value: 'lua', label: 'Custom-guide addon file (.lua)', hint: 'The text wrapped in RXPGuides.RegisterGuide(…), for the .lua file of a custom-guide addon.' },
              ]}
              onChange={(value) => {
                setFormat(value);
                setCopyNote(null);
                setCopied(null);
              }}
            />
          </section>
          {variant.text !== null && (
            <section className="frl-rxp__section" aria-label="Preview">
              <label htmlFor={previewId} className="frl-rxp__label">
                Preview of {file?.fileName ?? 'the export'} ({plural(sourceLines(variant.text).length, 'line')})
              </label>
              <textarea
                ref={previewRef}
                id={previewId}
                className="frl-rxp__text"
                value={variant.text}
                readOnly
                rows={12}
                spellCheck={false}
                wrap="off"
                aria-describedby={statusId}
              />
              {copyNote !== null && <p className="frl-rxp__hint">{copyNote}</p>}
            </section>
          )}
          <section className="frl-rxp__section" aria-labelledby={`${statusId}-notes`}>
            <h3 id={`${statusId}-notes`} className="frl-projects__heading">
              What the export cannot keep
            </h3>
            <RxpDiagnosticList
              diagnostics={variant.diagnostics}
              sourceOf={sourceOf}
              contextOf={contextOf}
              emptyText="Nothing: every step and field of the route has an RXP form."
            />
          </section>
        </>
      )}
    </ModalDialog>
  );
}
