import { type DragEvent, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { EditorStore } from '../../app';
import type { DatasetSource } from '../../app/dataset-source';
import type { ProjectSession } from '../../app/persistence';
import {
  FRAME_CHANGED_UIMAPS,
  loadRxpTools,
  MAX_RXP_BYTES,
  NEW_PROJECT_CHARACTER_TEXT,
  RXP_FILE_ACCEPT,
  RXP_IMPORT_LABEL,
  type RxpFrame,
  type RxpImportTarget,
  type RxpTools,
  type RxpUnknownQuestPolicy,
} from '../../app/rxp-options';
import type { RxpContext } from '../../app/rxp-context';
import type { RxpGuideSummary, RxpImportPreview, RxpUnknownQuest } from '../../app/rxp-import';
import { useEditor } from '../../app/react';
import type { DatasetView } from '../../domain/dataset';
import type { QuestId } from '../../domain/ids';
import type { MapGeometry } from '../../geo/types';
import type { RxpDiagnostic } from '../../rxp';
import { cx } from '../lib/cx';
import { formatInteger, plural } from '../lib/format';
import { SeverityIcon } from '../markers/SeverityIcon';
import { Button } from '../primitives/Button';
import { Checkbox } from '../primitives/Checkbox';
import type { Announce } from './LiveAnnouncer';
import { ModalDialog } from './ModalDialog';
import { selectRoute } from './selectors';
import { diagnosticCountsText, RadioGroup, RxpDiagnosticList, type RxpSourceText, SourceExcerpt, sourceLines } from './RxpParts';
import './RxpDialogs.css';

/**
 * "Import RXP custom guide" (docs/UI.md §15; ARCHITECTURE §10; docs/RXP.md): paste guide text or
 * open a custom-guide `.lua` or `.txt` file, check it, and import it as a new project or at the end
 * of the open route (one undo entry). The check lists every diagnostic with its line and column;
 * choosing one shows the source line. A RestedXP protected import string is refused and explained,
 * never decoded or kept. Quests the data lacks become placeholder custom quests (their real ids)
 * or stay unknown, as the user chooses. The RXP code loads on first use (a lazy chunk).
 */

export interface RxpImportDialogProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly store: EditorStore;
  /** Project storage, for the new-project target; null: only appending to the open route is possible. */
  readonly session: ProjectSession | null;
  /** The open project's view of the data. */
  readonly dataset: DatasetView;
  /** The loaded dataset, for checking a new project's quests; null or omitted: the open project's view stands in. */
  readonly data?: DatasetSource | null | undefined;
  /** For `RXP035` (a world point outside its map); null or omitted: not checked. */
  readonly geometry?: MapGeometry | null | undefined;
  readonly announce?: Announce | undefined;
  /** Importing is unavailable (an edit lock is held), with the reason; null when available. */
  readonly unavailableReason?: string | null | undefined;
  /** Replaces the loader of the RXP code (tests). */
  readonly loadTools?: (() => Promise<RxpTools>) | undefined;
}

interface Inputs {
  readonly text: string;
  readonly fileName: string | null;
  readonly frame: RxpFrame;
  readonly target: RxpImportTarget;
}

interface Checked extends Inputs {
  readonly preview: RxpImportPreview;
  readonly ctx: RxpContext;
  readonly tools: RxpTools;
}

const NO_SESSION = 'No project storage is connected here, so a new project cannot be kept';
const UNDO = 'Undo with Ctrl+Z.';

const same = (a: Inputs, b: Inputs): boolean => a.text === b.text && a.fileName === b.fileName && a.frame === b.frame && a.target === b.target;

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function utf8Length(text: string): number {
  return new TextEncoder().encode(text).length;
}

/** "76156 and 900001", "3 quests (76156, 76157, …)". */
function questList(ids: readonly QuestId[]): string {
  const shown = ids.slice(0, 8).map((id) => String(id));
  const rest = ids.length > shown.length ? `, and ${formatInteger(ids.length - shown.length)} more` : '';
  if (shown.length <= 2 && rest === '') return shown.join(' and ');
  return `${shown.join(', ')}${rest}`;
}

/** Decodes a file as UTF-8, keeping a byte-order mark (the export must give the same bytes back). */
async function readUtf8(file: File): Promise<string> {
  const bytes = await file.arrayBuffer();
  return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
}

export { RxpImportEntry } from './RxpEntries';

export function RxpImportDialog({ open, onClose, store, session, dataset, data = null, geometry = null, announce, unavailableReason = null, loadTools = loadRxpTools }: RxpImportDialogProps) {
  const [text, setText] = useState('');
  const [fileName, setFileName] = useState<string | null>(null);
  const [target, setTarget] = useState<RxpImportTarget>(session === null ? 'append' : 'new-project');
  const [frame, setFrame] = useState<RxpFrame>('forever');
  const [policy, setPolicy] = useState<RxpUnknownQuestPolicy>('placeholder');
  const [excluded, setExcluded] = useState<ReadonlySet<number>>(new Set());
  const [checked, setChecked] = useState<Checked | null>(null);
  const [busy, setBusy] = useState<'reading' | 'checking' | 'importing' | null>(null);
  // Each problem is a new object, so the same sentence a second time takes focus again (UI-F12).
  const [problemState, setProblemState] = useState<{ readonly text: string } | null>(null);
  const problem = problemState?.text ?? null;
  const setProblem = useCallback((text: string | null) => {
    setProblemState(text === null ? null : { text });
  }, []);
  const [dragging, setDragging] = useState(false);
  const [openQuest, setOpenQuest] = useState<QuestId | null>(null);
  const checkSeq = useRef(0);
  /** An explicit check (the button, an opened file) moves focus to its result; an option change does not. */
  const focusResult = useRef(false);
  const resultRef = useRef<HTMLElement>(null);
  const problemRef = useRef<HTMLParagraphElement>(null);
  const textId = useId();
  const textHintId = useId();
  const fileId = useId();

  // Read only while open, so edits made while it is closed do not re-render it.
  const route = useEditor(store, (s) => (open ? selectRoute(s) : null));
  const inputs: Inputs = { text, fileName, frame, target };
  const fresh = checked !== null && same(checked, inputs);
  const preview = fresh ? checked.preview : null;

  useEffect(() => {
    if (problemState !== null) problemRef.current?.focus();
  }, [problemState]);

  useEffect(() => {
    if (checked === null || !focusResult.current) return;
    focusResult.current = false;
    resultRef.current?.focus();
  }, [checked]);

  const reset = () => {
    // Nothing pasted outlives the dialog (a protected string is never kept, docs/RXP.md §3.3).
    checkSeq.current += 1;
    setText('');
    setFileName(null);
    setChecked(null);
    setExcluded(new Set());
    setProblem(null);
    setBusy(null);
    setDragging(false);
    setOpenQuest(null);
  };

  const close = () => {
    reset();
    onClose();
  };

  const runCheck = async (next: Inputs, focus: boolean) => {
    if (next.text.trim() === '') {
      setChecked(null);
      setProblem('Paste guide text or open a file first.');
      return;
    }
    if (utf8Length(next.text) > MAX_RXP_BYTES) {
      setChecked(null);
      setProblem(`The text is larger than ${String(MAX_RXP_BYTES / (1024 * 1024))} MB, too large for a guide.`);
      return;
    }
    const seq = (checkSeq.current += 1);
    setBusy('checking');
    setProblem(null);
    let tools: RxpTools;
    try {
      tools = await loadTools();
    } catch (error: unknown) {
      if (seq !== checkSeq.current) return;
      setBusy(null);
      setProblem(`The RXP code could not be loaded (${errorText(error)}). Check the connection and try again.`);
      return;
    }
    if (seq !== checkSeq.current) return;
    const ctx = tools.rxpImportContext(next.target, { dataset, data, geometry });
    const result = tools.previewRxpImport({ input: next.text, fileName: next.fileName, frame: next.frame }, ctx);
    // Another text may hold other guides: every guide of a new text starts chosen.
    if (checked === null || checked.text !== next.text) setExcluded(new Set());
    focusResult.current = focus;
    setChecked({ ...next, preview: result, ctx, tools });
    setBusy(null);
    setOpenQuest(null);
  };

  /** Options change the result: check again when the current text was checked. */
  const recheck = (patch: Partial<Inputs>) => {
    if (checked !== null && checked.text === text && checked.fileName === fileName) void runCheck({ ...inputs, ...patch }, false);
  };

  const openFile = async (file: File) => {
    if (busy !== null) return;
    if (file.size > MAX_RXP_BYTES) {
      setProblem(`“${file.name}” is larger than ${String(MAX_RXP_BYTES / (1024 * 1024))} MB, too large for a guide file.`);
      return;
    }
    setBusy('reading');
    let content: string;
    try {
      content = await readUtf8(file);
    } catch (error: unknown) {
      setBusy(null);
      setProblem(
        error instanceof TypeError
          ? `“${file.name}” is not UTF-8 text, so it cannot be imported unchanged.`
          : `“${file.name}” could not be read: ${errorText(error)}`,
      );
      return;
    }
    setBusy(null);
    setText(content);
    setFileName(file.name);
    await runCheck({ ...inputs, text: content, fileName: file.name }, true);
  };

  const onDrop = (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer.files[0];
    if (file !== undefined) void openFile(file);
  };

  const guides = preview?.status === 'ok' ? preview.guides : [];
  const chosen = guides.filter((guide) => !excluded.has(guide.index));
  const unknownChosen: readonly RxpUnknownQuest[] =
    preview?.status === 'ok' ? preview.unknownQuests.filter((quest) => quest.guides.some((index) => !excluded.has(index))) : [];
  // Diagnostics and quest lines are lines of the text that was checked.
  const checkedText = checked?.text ?? '';
  const checkedFile = checked?.fileName ?? null;
  const source: RxpSourceText = useMemo(
    () => ({ name: checkedFile === null ? 'the pasted text' : `“${checkedFile}”`, lines: sourceLines(checkedText) }),
    [checkedText, checkedFile],
  );
  const sourceOf = useCallback(() => source, [source]);
  const guideOf = useMemo(() => {
    const byImport = new Map<string, RxpGuideSummary>();
    if (checked?.preview.status === 'ok') for (const guide of checked.preview.guides) byImport.set(guide.importId, guide);
    return byImport;
  }, [checked]);
  const shownDiagnostics: readonly RxpDiagnostic[] = useMemo(() => {
    if (checked === null) return [];
    const { preview: result } = checked;
    const list =
      result.status === 'ok'
        ? [...result.diagnostics, ...result.guides.filter((guide) => !excluded.has(guide.index)).flatMap((guide) => guide.diagnostics)]
        : [...result.diagnostics];
    return list.sort((a, b) => a.line - b.line || a.column - b.column || (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));
  }, [checked, excluded]);
  const lua = checked?.preview.status === 'ok' && checked.preview.source === 'lua';
  const contextOf = useCallback(
    (diagnostic: RxpDiagnostic) => (lua && diagnostic.importId !== '' ? `in “${guideOf.get(diagnostic.importId)?.name ?? 'the guide'}”` : null),
    [lua, guideOf],
  );

  const blockedReason =
    unavailableReason ??
    (busy === 'reading'
      ? 'Reading the file'
      : busy === 'checking'
        ? 'Checking the guide'
        : busy === 'importing'
          ? 'Importing'
          : target === 'new-project' && session === null
            ? NO_SESSION
            : null);
  const importReason =
    blockedReason ??
    (checked === null
      ? 'Check the guide first'
      : !fresh
        ? 'The text or the options changed since the check: check it again'
        : preview?.status === 'refused'
          ? 'This input is refused'
          : guides.length === 0
            ? 'No guide could be read'
            : chosen.length === 0
              ? 'Choose at least one guide'
              : null);

  const runImport = async () => {
    if (importReason !== null || checked === null || preview?.status !== 'ok') return;
    const { tools, ctx } = checked;
    const request = { input: checked.text, fileName: checked.fileName, frame: checked.frame };
    const choice = { guides: chosen.map((guide) => guide.index), unknownQuests: policy };
    const guidesText = chosen.length === 1 ? `“${chosen[0]?.name ?? ''}”` : `${formatInteger(chosen.length)} guides`;
    const unknownIds = unknownChosen.map((quest) => quest.questId);
    const questsText =
      unknownIds.length === 0
        ? ''
        : policy === 'placeholder'
          ? ` ${plural(unknownIds.length, 'placeholder custom quest')} added (${questList(unknownIds)}).`
          : ` ${plural(unknownIds.length, 'quest')} not in the data ${unknownIds.length === 1 ? 'stays' : 'stay'} unknown (${questList(unknownIds)}).`;
    if (checked.target === 'append') {
      const before = store.getState();
      store.dispatch(tools.rxpImportCommand(request, choice, ctx));
      const after = store.getState();
      if (after.revision === before.revision) {
        setProblem(after.editingLocked ? 'Nothing was imported: editing is locked while the optimiser runs or a proposal is open.' : 'Nothing was imported: the guide has no steps.');
        return;
      }
      const added = after.project.route.steps.length - before.project.route.steps.length;
      const first = before.project.route.steps.length + 1;
      const where = added === 0 ? '' : added === 1 ? ` as step ${formatInteger(first)}` : ` as steps ${formatInteger(first)} to ${formatInteger(first + added - 1)}`;
      announce?.(`Imported ${guidesText}: ${plural(added, 'step')} added${where}.${questsText} ${UNDO}`);
      close();
      return;
    }
    if (session === null) return;
    const built = tools.rxpImportProject(request, choice, ctx, { identity: dataset.identity });
    if (built === null) {
      setProblem('Nothing was imported: no guide was chosen.');
      return;
    }
    setBusy('importing');
    const result = await session.importProject(built.project, built.name);
    setBusy(null);
    if (!result.ok) {
      announce?.(result.message);
      setProblem(result.message);
      return;
    }
    announce?.(`${result.message} It has ${plural(built.project.route.steps.length, 'step')}.${questsText}`);
    close();
  };

  const zoneNames = FRAME_CHANGED_UIMAPS.map((id) => dataset.zone(id)?.name ?? `UiMap ${String(id)}`);
  const zonesText = `${zoneNames.slice(0, -1).join(', ')} and ${zoneNames[zoneNames.length - 1] ?? ''}`;

  const footer = (
    <>
      {importReason !== null && (
        <span id={`${textId}-import-reason`} className="frl-rxp__footer-hint">
          {importReason}.
        </span>
      )}
      {blockedReason !== null && (
        <span id={`${textId}-check-reason`} className="frl-visually-hidden">
          {blockedReason}
        </span>
      )}
      <Button onClick={close}>Cancel</Button>
      <Button
        aria-disabled={blockedReason === null ? undefined : true}
        aria-describedby={blockedReason === null ? undefined : `${textId}-check-reason`}
        title={blockedReason ?? undefined}
        onClick={() => {
          if (blockedReason === null) void runCheck(inputs, true);
        }}
      >
        {busy === 'checking' ? 'Checking…' : 'Check guide'}
      </Button>
      <Button
        variant="primary"
        icon="import"
        aria-disabled={importReason === null ? undefined : true}
        aria-describedby={importReason === null ? undefined : `${textId}-import-reason`}
        title={importReason ?? undefined}
        onClick={() => {
          void runImport();
        }}
      >
        {busy === 'importing' ? 'Importing…' : 'Import'}
      </Button>
    </>
  );

  return (
    // A press on the backdrop keeps the pasted text and the check (UI-F10): Cancel, Close or Escape drop them.
    // A file dropped anywhere on the dialog opens as if dropped on its section (UI-F14).
    <ModalDialog
      open={open}
      onClose={close}
      title={RXP_IMPORT_LABEL}
      className="frl-rxp"
      footer={footer}
      dismissOnBackdrop={false}
      onFileDrop={(file) => {
        void openFile(file);
      }}
    >
      <section
        className={cx('frl-rxp__section', 'frl-rxp__drop', dragging && 'is-dragging')}
        aria-labelledby={`${textId}-heading`}
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
        <h3 id={`${textId}-heading`} className="frl-projects__heading">
          Guide
        </h3>
        <label htmlFor={textId} className="frl-rxp__label">
          Guide text or custom-guide .lua file
        </label>
        <p id={textHintId} className="frl-rxp__hint">
          Paste the text of a guide (the part between RegisterGuide’s brackets) or a whole .lua file. The file is read, never run. RestedXP’s
          protected import strings are not supported.
        </p>
        <textarea
          id={textId}
          className="frl-rxp__text"
          value={text}
          rows={9}
          spellCheck={false}
          autoComplete="off"
          wrap="off"
          aria-describedby={textHintId}
          readOnly={busy === 'reading'}
          onChange={(event) => {
            setText(event.currentTarget.value);
            if (fileName !== null) setFileName(null);
          }}
        />
        <div className="frl-rxp__file">
          <label htmlFor={fileId} className="frl-rxp__label">
            Or open a file
          </label>
          <input
            id={fileId}
            type="file"
            accept={RXP_FILE_ACCEPT}
            aria-disabled={busy === null ? undefined : true}
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              event.currentTarget.value = '';
              if (file !== undefined) void openFile(file);
            }}
          />
          <span className="frl-rxp__hint" aria-hidden="true">
            or drop it here
          </span>
        </div>
        {fileName !== null && <p className="frl-rxp__hint">Opened “{fileName}”.</p>}
      </section>

      <section className="frl-rxp__section" aria-label="Options">
        <RadioGroup<RxpImportTarget>
          legend="Import into"
          value={target}
          options={[
            {
              value: 'new-project',
              label: 'A new project',
              hint: `Named after the guide, with the default character (${NEW_PROJECT_CHARACTER_TEXT}; change it in Settings). The open project is kept as it is.`,
              unavailable: session === null ? NO_SESSION : null,
            },
            {
              value: 'append',
              label: 'The end of the current route',
              hint:
                route === null
                  ? undefined
                  : `${route.steps.length === 0 ? 'The route is empty' : `After step ${formatInteger(route.steps.length)}`} of “${route.name}”. One undo removes the whole import.`,
              unavailable: unavailableReason,
            },
          ]}
          onChange={(value) => {
            setTarget(value);
            recheck({ target: value });
          }}
        />
        <RadioGroup<RxpFrame>
          legend={`Percent coordinates in ${zonesText}`}
          value={frame}
          options={[
            { value: 'forever', label: 'Forever maps (default)', hint: 'For guides written for Forever: the numbers are read in the Forever frame of these zone maps.' },
            {
              value: 'era',
              label: 'Era maps',
              hint: 'For guides written against Classic Era: these four zone maps changed in Forever, and Era numbers read as Forever ones are about 100 yards off.',
            },
          ]}
          onChange={(value) => {
            setFrame(value);
            recheck({ frame: value });
          }}
        />
      </section>

      {problem !== null && (
        <p ref={problemRef} tabIndex={-1} className="frl-rxp__problem">
          <SeverityIcon severity="error" labelled={false} size={14} />
          {problem}
        </p>
      )}

      {checked !== null && (
        <section ref={resultRef} tabIndex={-1} className="frl-rxp__section frl-rxp__result" aria-labelledby={`${textId}-result`}>
          <h3 id={`${textId}-result`} className="frl-projects__heading">
            Check result
          </h3>
          {!fresh && <p className="frl-rxp__stale">The text or the options changed since this check. Check the guide again before importing.</p>}
          {checked.preview.status === 'refused' ? (
            <div className="frl-rxp__refused">
              <p className="frl-rxp__refused-title">
                <SeverityIcon severity="error" labelled={false} size={14} />
                Refused: this is not guide text.
              </p>
              <p>{checked.preview.message}</p>
              <p className="frl-rxp__hint">
                RestedXP sells guides as protected strings bound to the buyer’s Battle.net account. Forever Route Lab does not decode, decrypt or
                keep them: nothing of the pasted text was read further or stored. Custom guides written as text, or shipped in a custom-guide
                addon’s .lua file, can be imported.
              </p>
            </div>
          ) : checked.preview.guides.length === 0 ? (
            <>
              <p>
                No guide could be read from {source.name}: it has no RXPGuides.RegisterGuide call whose guide text is written out as a string.
              </p>
              <RxpDiagnosticList diagnostics={shownDiagnostics} sourceOf={sourceOf} emptyText="No diagnostics." />
            </>
          ) : (
            <>
              <p className="frl-rxp__summary">
                {checked.preview.source === 'lua'
                  ? `${plural(checked.preview.guides.length, 'guide')} in ${source.name}.`
                  : `One guide, “${checked.preview.guides[0]?.name ?? ''}”: ${plural(checked.preview.guides[0]?.rxpSteps ?? 0, 'RXP step')}, ${plural(checked.preview.guides[0]?.steps ?? 0, 'route step')}; ${diagnosticCountsText(checked.preview.guides[0]?.diagnostics ?? [])}.`}
              </p>
              {checked.preview.source === 'lua' && (
                <fieldset className="frl-rxp__group">
                  <legend>Guides to import</legend>
                  {checked.preview.guides.map((guide) => (
                    <Checkbox
                      key={guide.index}
                      label={`“${guide.name}”: ${plural(guide.rxpSteps, 'RXP step')}, ${plural(guide.steps, 'route step')}; ${diagnosticCountsText(guide.diagnostics)}`}
                      checked={!excluded.has(guide.index)}
                      onChange={(on) => {
                        setExcluded((current) => {
                          const next = new Set(current);
                          if (on) next.delete(guide.index);
                          else next.add(guide.index);
                          return next;
                        });
                      }}
                    />
                  ))}
                </fieldset>
              )}
              {unknownChosen.length > 0 && (
                <div className="frl-rxp__unknown">
                  <p>
                    <SeverityIcon severity="warning" labelled={false} size={14} />
                    {plural(unknownChosen.length, 'quest')} the guide uses {unknownChosen.length === 1 ? 'is' : 'are'} not in the data
                    {checked.target === 'append' ? ' or the project’s custom quests' : ''}:
                  </p>
                  <ul className="frl-rxp__quests">
                    {unknownChosen.map((quest) => {
                      const expanded = openQuest === quest.questId && quest.line > 0;
                      const excerptId = `${textId}-quest-${String(quest.questId)}`;
                      return (
                        <li key={quest.questId}>
                          <span>
                            Quest {String(quest.questId)}, used by {plural(quest.uses, 'step')}
                          </span>
                          {quest.line > 0 && (
                            <Button
                              size="sm"
                              variant="ghost"
                              aria-expanded={expanded}
                              aria-controls={expanded ? excerptId : undefined}
                              onClick={() => {
                                setOpenQuest(expanded ? null : quest.questId);
                              }}
                            >
                              {expanded ? 'Hide' : 'Show'} line {formatInteger(quest.line)}
                            </Button>
                          )}
                          {expanded && <SourceExcerpt id={excerptId} source={source} line={quest.line} column={0} />}
                        </li>
                      );
                    })}
                  </ul>
                  <RadioGroup<RxpUnknownQuestPolicy>
                    legend="Quests not in the data"
                    value={policy}
                    options={[
                      {
                        value: 'placeholder',
                        label: 'Add them as placeholder custom quests',
                        hint: 'Each keeps its real id. Its name, level, objectives, givers and XP stay unknown until you enter them in the custom quest editor.',
                      },
                      { value: 'warn', label: 'Leave them unknown', hint: 'The steps keep the ids; the validator warns about each quest.' },
                    ]}
                    onChange={setPolicy}
                  />
                </div>
              )}
              <h4 className="frl-rxp__subheading">Diagnostics</h4>
              <RxpDiagnosticList
                diagnostics={shownDiagnostics}
                sourceOf={sourceOf}
                contextOf={contextOf}
                emptyText="No diagnostics: every line reads as RXP reads it."
              />
            </>
          )}
        </section>
      )}
    </ModalDialog>
  );
}
