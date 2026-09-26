import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { type EditorStore, openQuestsInDetails } from '../../app';
import type { MapController } from '../../app/map-exports';
import {
  buildCustomQuest,
  CUSTOM_SHADOWED_CODE,
  type CustomQuestField,
  customQuestProblems,
  type CustomQuestFields,
  deleteCustomQuest,
  nextInventedQuestId,
  questStepCount,
  saveCustomQuest,
  shadowedQuest,
} from '../../app/project-commands';
import { customQuestOf } from '../../app/quest-steps';
import type { DatasetView, QuestRecord } from '../../domain/dataset';
import type { QuestId } from '../../domain/ids';
import type { Location } from '../../domain/points';
import type { CustomQuest } from '../../domain/project';
import { Button, PanelSection, Select, SeverityIcon, TextInput, plural } from '../kit';
import { parseNumber, parseWhole } from './field-parse';
import { type FieldProblem, fieldProblemProps, FormProblems, useFocusProblems } from './FormProblems';
import type { Announce } from './LiveAnnouncer';
import { LocationEditor } from './StepEditors';
import './Editing.css';

/**
 * The custom quest editor (ARCHITECTURE §5.5; docs/UI.md §14), in the Details tab so the map stays
 * usable for "Pick on map": create an invented quest (negative id) or one with a real id (a Forever
 * quest from a guide, say), edit one, or replace a dataset quest with the user's values. Fields: id,
 * name, level, required level, XP (basis `user`, taken at the quest level), Forever status, starter
 * and finisher locations. A real id that the dataset has is said to replace that quest
 * (DATA001-custom-shadowed, info), with the way back: delete the custom quest.
 *
 * The id is the quest's identity, which its steps point at: it is read-only when editing (CR-10),
 * and Delete says how many steps use the quest. The form takes focus when it opens (its Name
 * field); a failed save moves focus to the list of problems and marks each field it names (UI-F5,
 * UI-F6). `onClose` says how it closed, so the caller can put focus back where it was.
 */

/** How the editor closed: `saved` (Details shows the quest), `cancelled` or `deleted`. */
export type CustomQuestEditorClose = 'saved' | 'cancelled' | 'deleted';

export type CustomQuestEdit =
  /** A new custom quest: an invented id, or `id` (a quest the dataset does not have, say). */
  | { readonly mode: 'new'; readonly id?: QuestId | undefined }
  /** Edit the project's custom quest `id`. */
  | { readonly mode: 'edit'; readonly id: QuestId }
  /** A new custom quest with the dataset quest `id`'s id and record, replacing it in this project. */
  | { readonly mode: 'replace'; readonly id: QuestId };

export interface CustomQuestEditorProps {
  readonly store: EditorStore;
  readonly edit: CustomQuestEdit;
  /** The project's view (custom quests included), for names and zones. */
  readonly dataset: DatasetView;
  /** The project's data without its custom quests: what a real id replaces. */
  readonly baseDataset: DatasetView;
  readonly editable: boolean;
  readonly mapController: MapController | null;
  readonly announce: Announce;
  readonly onClose: (how: CustomQuestEditorClose) => void;
}

interface Draft {
  readonly id: string;
  readonly name: string;
  readonly level: string;
  readonly minLevel: string;
  readonly xp: string;
  readonly foreverStatus: CustomQuest['provenance']['foreverStatus'];
  readonly starterLocation: Location | null;
  readonly finisherLocation: Location | null;
}

const text = (n: number | null): string => (n === null ? '' : String(n));

function initialDraft(edit: CustomQuestEdit, existing: CustomQuest | null, replaced: QuestRecord | null, nextId: QuestId): Draft {
  if (existing !== null) {
    return {
      id: String(existing.id),
      name: existing.name,
      level: text(existing.level),
      minLevel: text(existing.minLevel),
      xp: existing.xp?.basis === 'user' ? String(existing.xp.baseXp) : '',
      foreverStatus: existing.provenance.foreverStatus,
      starterLocation: existing.starterLocation,
      finisherLocation: existing.finisherLocation,
    };
  }
  if (edit.mode === 'replace' && replaced !== null) {
    return { id: String(replaced.id), name: replaced.name, level: text(replaced.level), minLevel: text(replaced.minLevel), xp: '', foreverStatus: 'unknown', starterLocation: null, finisherLocation: null };
  }
  const id = edit.mode === 'new' && edit.id !== undefined ? edit.id : nextId;
  return { id: String(id), name: '', level: '', minLevel: '', xp: '', foreverStatus: 'unknown', starterLocation: null, finisherLocation: null };
}

const FOREVER_STATUS_OPTIONS = [
  { value: 'unknown', label: 'Unknown' },
  { value: 'user-declared-new', label: 'New in Forever (declared by you)' },
  { value: 'user-declared-changed', label: 'Changed in Forever (declared by you)' },
] as const;

const isForeverStatus = (value: string): value is Draft['foreverStatus'] => FOREVER_STATUS_OPTIONS.some((option) => option.value === value);

type Problem = FieldProblem<CustomQuestField>;

/** The draft as fields, or the reasons it cannot be read (a field that is not a number). */
function fieldsOf(draft: Draft): { readonly fields: CustomQuestFields | null; readonly problems: readonly Problem[] } {
  const problems: Problem[] = [];
  const id = parseWhole(draft.id);
  const level = parseWhole(draft.level);
  const minLevel = parseWhole(draft.minLevel);
  const xp = parseNumber(draft.xp);
  if (id.kind !== 'number') problems.push({ field: 'id', message: 'The quest id must be a whole number (negative for an invented quest).' });
  if (level.kind === 'invalid') problems.push({ field: 'level', message: 'The level must be a whole number, or left empty (unknown).' });
  if (minLevel.kind === 'invalid') problems.push({ field: 'minLevel', message: 'The required level must be a whole number, or left empty (unknown).' });
  if (xp.kind === 'invalid') problems.push({ field: 'xp', message: 'The XP must be a number, or left empty (unknown).' });
  if (problems.length > 0 || id.kind !== 'number') return { fields: null, problems };
  return {
    fields: {
      id: id.value as QuestId,
      name: draft.name.trim(),
      level: level.kind === 'number' ? level.value : null,
      minLevel: minLevel.kind === 'number' ? minLevel.value : null,
      baseXp: xp.kind === 'number' ? xp.value : null,
      foreverStatus: draft.foreverStatus,
      starterLocation: draft.starterLocation,
      finisherLocation: draft.finisherLocation,
    },
    problems: [],
  };
}

export function CustomQuestEditor({ store, edit, dataset, baseDataset, editable, mapController, announce, onClose }: CustomQuestEditorProps) {
  const formId = useId();
  const problemsId = useId();
  const idHintId = useId();
  const deleteHintId = useId();
  const problemsRef = useRef<HTMLDivElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const project = store.getState().project;
  const editingId = edit.mode === 'edit' ? edit.id : null;
  const existing = editingId === null ? null : customQuestOf(project, editingId);
  const replaced = edit.mode === 'replace' ? shadowedQuest(baseDataset, edit.id) : null;
  const [draft, setDraft] = useState<Draft>(() => initialDraft(edit, existing, replaced, nextInventedQuestId(project)));
  const [problems, setProblems] = useState<readonly Problem[]>([]);
  useFocusProblems(problemsRef, problems);
  const patch = (next: Partial<Draft>) => {
    setDraft((current) => ({ ...current, ...next }));
  };
  const field = (name: CustomQuestField, describedBy?: string) => fieldProblemProps(problems, problemsId, name, describedBy);

  // The form takes focus when it opens (it is keyed per opening): its Name field, or the form itself
  // while editing is locked (UI-F5).
  const editableAtOpen = useRef(editable);
  useEffect(() => {
    if (editableAtOpen.current) nameRef.current?.focus();
    else formRef.current?.focus();
  }, []);

  const typedId = parseWhole(draft.id);
  const shadows = typedId.kind === 'number' ? shadowedQuest(baseDataset, typedId.value as QuestId) : null;
  const title = edit.mode === 'edit' ? 'Edit custom quest' : edit.mode === 'replace' ? 'Replace with a custom quest' : 'New custom quest';
  const name = draft.name.trim() === '' ? 'this quest' : `“${draft.name.trim()}”`;
  // The id is fixed when editing (its steps use it) and when replacing (it is the dataset quest's).
  const idFixed = edit.mode !== 'new';
  const uses = editingId === null ? 0 : questStepCount(project, editingId);
  const usesText =
    uses === 0
      ? 'No step uses this quest.'
      : `${plural(uses, 'step')} ${uses === 1 ? 'uses' : 'use'} this quest and keep its id, which then means ${shadows === null ? 'a quest this project does not know' : `the dataset quest “${shadows.name}” again`}.`;

  const save = (event?: FormEvent) => {
    event?.preventDefault();
    if (!editable) return;
    const read = fieldsOf(draft);
    const found = read.fields === null ? read.problems : customQuestProblems(read.fields, store.getState().project, editingId);
    if (read.fields === null || found.length > 0) {
      setProblems(found);
      announce(`Not saved: ${found.map((problem) => problem.message).join(' ')}`);
      return;
    }
    setProblems([]);
    const fields = read.fields;
    const base = existing ?? shadowedQuest(baseDataset, fields.id);
    const quest = buildCustomQuest(fields, base);
    const { revision } = store.getState();
    store.dispatch(saveCustomQuest(quest, editingId));
    announce(store.getState().revision === revision ? `No changes to “${quest.name}”.` : `Custom quest “${quest.name}” saved.`);
    onClose('saved');
    openQuestsInDetails(store, [quest.id]);
  };

  const remove = () => {
    if (!editable || editingId === null) return;
    const { revision } = store.getState();
    store.dispatch(deleteCustomQuest(editingId));
    if (store.getState().revision === revision) return;
    const kept = uses === 0 ? '' : ` ${usesText}`;
    announce(`Custom quest ${existing === null ? String(editingId) : `“${existing.name}”`} deleted.${kept} Undo with Ctrl+Z.`);
    onClose('deleted');
  };

  const pick = (what: string) => (mapController === null ? null : { controller: mapController, what });
  return (
    <PanelSection title={title} aside={<code>{draft.id === '' ? '#?' : `#${draft.id}`}</code>}>
      <form id={formId} ref={formRef} className="frl-app-form" onSubmit={save} aria-label={title} noValidate tabIndex={-1}>
        <FormProblems id={problemsId} problems={problems} listRef={problemsRef} />
        <p className="frl-app-hint">
          A custom quest is yours: nothing in it comes from the dataset unless it replaces a dataset quest, whose record it then starts from. Fields left empty are unknown.
        </p>
        <div className="frl-app-fields">
          <TextInput
            label="Quest id (negative for an invented quest)"
            value={draft.id}
            onChange={(id) => {
              if (!idFixed) patch({ id });
            }}
            inputMode="numeric"
            disabled={!editable}
            readOnly={idFixed}
            {...field('id', idFixed ? idHintId : undefined)}
          />
          {idFixed && (
            <p className="frl-app-hint" id={idHintId}>
              {edit.mode === 'edit'
                ? 'The id stays as it is: the steps that use the quest point at it. For another id, create a new custom quest.'
                : 'The id is the dataset quest’s: the custom quest replaces it in this project.'}
            </p>
          )}
          {shadows !== null && (
            <p className="frl-app-info">
              <SeverityIcon severity="info" size={14} labelled={false} />
              <span>
                <code>{CUSTOM_SHADOWED_CODE}</code> (info): this id is the dataset quest “{shadows.name}”. Saving replaces it in this project with your values; delete the custom
                quest to use the dataset record again.
              </span>
            </p>
          )}
          <TextInput
            label="Name"
            value={draft.name}
            onChange={(value) => {
              patch({ name: value });
            }}
            disabled={!editable}
            inputRef={nameRef}
            {...field('name')}
          />
          <div className="frl-app-fields__row">
            <TextInput
              label="Level"
              value={draft.level}
              onChange={(level) => {
                patch({ level });
              }}
              inputMode="numeric"
              disabled={!editable}
              {...field('level')}
            />
            <TextInput
              label="Required level"
              value={draft.minLevel}
              onChange={(minLevel) => {
                patch({ minLevel });
              }}
              inputMode="numeric"
              disabled={!editable}
              {...field('minLevel')}
            />
          </div>
          <TextInput
            label="Base XP (yours, taken at the quest level)"
            value={draft.xp}
            onChange={(xp) => {
              patch({ xp });
            }}
            inputMode="decimal"
            disabled={!editable}
            {...field('xp')}
          />
          {edit.mode === 'replace' && <p className="frl-app-hint">The dataset’s XP (an Era value) is not copied: a custom quest’s XP is what you enter, or unknown.</p>}
          <Select
            label="Forever status"
            value={draft.foreverStatus}
            options={FOREVER_STATUS_OPTIONS}
            onChange={(value) => {
              if (isForeverStatus(value)) patch({ foreverStatus: value });
            }}
            disabled={!editable}
          />
          <LocationEditor
            label="Starter location"
            value={draft.starterLocation}
            dataset={dataset}
            disabled={!editable}
            onChange={(starterLocation) => {
              patch({ starterLocation });
            }}
            pick={pick(`the starter location of ${name}`)}
            announce={announce}
          />
          <LocationEditor
            label="Finisher location"
            value={draft.finisherLocation}
            dataset={dataset}
            disabled={!editable}
            onChange={(finisherLocation) => {
              patch({ finisherLocation });
            }}
            pick={pick(`the finisher location of ${name}`)}
            announce={announce}
          />
        </div>
        <div className="frl-app-actions">
          <Button type="submit" variant="primary" size="sm" aria-disabled={editable ? undefined : true}>
            Save custom quest
          </Button>
          <Button
            size="sm"
            onClick={() => {
              onClose('cancelled');
            }}
          >
            Cancel
          </Button>
          {edit.mode === 'edit' && (
            <Button size="sm" variant="ghost" icon="delete" aria-disabled={editable ? undefined : true} aria-describedby={deleteHintId} onClick={remove}>
              Delete custom quest
            </Button>
          )}
        </div>
        {edit.mode === 'edit' && (
          <p className="frl-app-hint" id={deleteHintId}>
            {`Deleting it: ${usesText}`}
          </p>
        )}
      </form>
    </PanelSection>
  );
}
