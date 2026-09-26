import { useId, useRef, useState, type FormEvent } from 'react';
import type { EditorStore } from '../../app';
import { CLASS_NAMES, RACE_NAMES } from '../../app/character-names';
import { classesOf, isPlayablePair, maxLevelOf, racesOf, type SettingsPatch, updateSettings } from '../../app/project-commands';
import { useEditor } from '../../app/react';
import type { ClassToken, Faction, RaceToken, Sex } from '../../domain/character';
import type { QuestId } from '../../domain/ids';
import type { CharacterProfile, RouteProfile } from '../../domain/project';
import { Button, Checkbox, Select, TextInput } from '../kit';
import { parseIdList, parseNumber, parseWhole, parseWordList } from './field-parse';
import { type FieldProblem, fieldProblemProps, FormProblems, useFocusProblems } from './FormProblems';
import type { Announce } from './LiveAnnouncer';
import { ModalDialog } from './ModalDialog';
import { selectAssumptions, selectCharacter, selectEditingLocked, selectRouteProfile } from './selectors';
import './Editing.css';

/**
 * The Settings dialog (ARCHITECTURE §8.2, §12.4; docs/UI.md §14): the character (faction, race,
 * class, sex, start level and XP, what happened before the route, riding) and the route profile
 * (RXP's load-time variables, RXP.md §8.2). The fields are a draft; "Save settings" applies them as
 * one command ("Edit settings", one undo entry), and Cancel or Escape drops them. Race and class
 * offer the Forever client's pairs (forever-game-rules.md §4). Read-only while editing is locked.
 *
 * A failed save lists its problems at the top, which take focus, and marks each field they name
 * (UI-F6). A press on the backdrop does not close the dialog: the draft is dropped only by Cancel,
 * Close or Escape (UI-F10). The actions sit in the dialog's footer, Cancel before Save.
 */

export interface SettingsDialogProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly store: EditorStore;
  readonly announce?: Announce | undefined;
}

/** The dialog's fields as typed. */
export interface SettingsDraft {
  readonly faction: Faction;
  readonly race: RaceToken;
  readonly class: ClassToken;
  readonly sex: Sex | '';
  readonly startLevel: string;
  readonly startXp: string;
  readonly priorHistory: CharacterProfile['priorHistory'];
  readonly priorCompleted: string;
  readonly priorLog: string;
  readonly riding: '0' | '1' | '2';
  readonly xpRate: string;
  readonly season: string;
  readonly phase: string;
  readonly hardcore: boolean;
  readonly ssf: boolean;
  readonly dungeons: string;
  readonly groupQuests: boolean;
  readonly xpStepSkipping: boolean;
  readonly locale: string;
}

const text = (n: number | null): string => (n === null ? '' : String(n));

/** A field of the dialog a problem can name. */
export type SettingsField = 'startLevel' | 'startXp' | 'priorCompleted' | 'priorLog' | 'xpRate' | 'season' | 'phase' | 'locale';

export type SettingsProblem = FieldProblem<SettingsField>;

/** The fields for a character and route profile. */
export function settingsDraftOf(character: CharacterProfile, profile: RouteProfile): SettingsDraft {
  return {
    faction: character.faction,
    race: character.race,
    class: character.class,
    sex: character.sex ?? '',
    startLevel: String(character.startLevel),
    startXp: String(character.startXp),
    priorHistory: character.priorHistory,
    priorCompleted: character.priorCompletedQuests.join(', '),
    priorLog: character.priorQuestLog.join(', '),
    riding: String(character.riding) as SettingsDraft['riding'],
    xpRate: String(profile.xpRate),
    season: text(profile.season),
    phase: text(profile.phase),
    hardcore: profile.hardcore,
    ssf: profile.ssf,
    dungeons: profile.dungeons.join(', '),
    groupQuests: profile.groupQuests,
    xpStepSkipping: profile.xpStepSkipping,
    locale: profile.locale,
  };
}

/** The draft as a settings patch, or the problems that stop it, in words, each with the field it is about. */
export function settingsPatchOf(draft: SettingsDraft, maxLevel: number): { readonly patch: SettingsPatch | null; readonly problems: readonly SettingsProblem[] } {
  const problems: SettingsProblem[] = [];
  const add = (field: SettingsField, message: string) => {
    problems.push({ field, message });
  };
  const level = parseWhole(draft.startLevel);
  if (level.kind !== 'number' || level.value < 1 || level.value > maxLevel) add('startLevel', `The start level must be a whole number from 1 to ${String(maxLevel)}.`);
  const xp = parseWhole(draft.startXp);
  if (xp.kind !== 'number' || xp.value < 0) add('startXp', 'The start XP must be a whole number of at least 0 (the XP into the start level).');
  const completed = parseIdList(draft.priorCompleted);
  const log = parseIdList(draft.priorLog);
  if (completed === null) add('priorCompleted', 'Completed quests must be quest ids separated by commas or spaces.');
  if (log === null) add('priorLog', 'Quests in the log must be quest ids separated by commas or spaces.');
  const rate = parseNumber(draft.xpRate);
  if (rate.kind !== 'number' || rate.value <= 0) add('xpRate', 'The XP rate must be a number above 0 (1 is the normal rate).');
  const season = parseWhole(draft.season);
  if (season.kind === 'invalid') add('season', 'The season must be a whole number, or left empty (unknown).');
  const phase = parseWhole(draft.phase);
  if (phase.kind === 'invalid') add('phase', 'The phase must be a whole number, or left empty (unknown).');
  if (draft.locale.trim() === '') add('locale', 'The locale must not be empty (enUS, for example).');
  if (problems.length > 0 || level.kind !== 'number' || xp.kind !== 'number' || rate.kind !== 'number') return { patch: null, problems };
  const character: Partial<CharacterProfile> = {
    faction: draft.faction,
    race: draft.race,
    class: draft.class,
    sex: draft.sex === '' ? null : draft.sex,
    startLevel: level.value,
    startXp: xp.value,
    priorHistory: draft.priorHistory,
    // Kept for every history (SIMULATION §7.1): exactly what happened for `listed`, a partial record
    // for `unknown`, and used as given for `fresh`. Choosing `fresh` in the dialog empties the fields
    // (`historyPatch`), so the lists are dropped only where the user sees it happen.
    priorCompletedQuests: (completed ?? []) as readonly QuestId[],
    priorQuestLog: (log ?? []) as readonly QuestId[],
    riding: Number(draft.riding) as CharacterProfile['riding'],
  };
  const routeProfile: Partial<RouteProfile> = {
    xpRate: rate.value,
    season: season.kind === 'number' ? season.value : null,
    phase: phase.kind === 'number' ? phase.value : null,
    hardcore: draft.hardcore,
    ssf: draft.ssf,
    dungeons: parseWordList(draft.dungeons),
    groupQuests: draft.groupQuests,
    xpStepSkipping: draft.xpStepSkipping,
    locale: draft.locale.trim(),
  };
  return { patch: { character, routeProfile }, problems: [] };
}

const FACTION_OPTIONS = [
  { value: 'Horde', label: 'Horde' },
  { value: 'Alliance', label: 'Alliance' },
] as const;

const SEX_OPTIONS = [
  { value: '', label: 'Not set' },
  { value: 'female', label: 'Female' },
  { value: 'male', label: 'Male' },
] as const;

const HISTORY_OPTIONS = [
  { value: 'fresh', label: 'A new character: nothing before the route' },
  { value: 'listed', label: 'Exactly the quests listed below' },
  { value: 'unknown', label: 'Partly known: the quests listed below, and maybe others' },
] as const;

/**
 * The draft change for a new "Before the route" choice. A new character has done nothing, so
 * choosing `fresh` empties both lists in the open dialog (Cancel brings them back); the other two
 * keep them: `listed` as exactly what happened, `unknown` as a partial record (SIMULATION §7.1).
 */
export function historyPatch(history: CharacterProfile['priorHistory']): Partial<SettingsDraft> {
  return history === 'fresh' ? { priorHistory: history, priorCompleted: '', priorLog: '' } : { priorHistory: history };
}

/**
 * Whether the dialog shows the two lists: always for `listed` and `unknown`, and for `fresh` only
 * while they hold something (a project imported that way), so nothing is kept or dropped unseen.
 */
export function showsPriorLists(draft: Pick<SettingsDraft, 'priorHistory' | 'priorCompleted' | 'priorLog'>): boolean {
  return draft.priorHistory !== 'fresh' || draft.priorCompleted.trim() !== '' || draft.priorLog.trim() !== '';
}

/** The list fields' labels and hint, by history. */
function priorListWords(history: CharacterProfile['priorHistory']): { readonly completed: string; readonly log: string; readonly hint: string } {
  switch (history) {
    case 'listed':
      return {
        completed: 'Quests completed before the route (ids)',
        log: 'Quests in the log at the start (ids)',
        hint: 'Exactly what happened before the route: every rule is checked against these lists as written.',
      };
    case 'unknown':
      return {
        completed: 'Quests known to be completed before the route (ids, a partial record)',
        log: 'Quests known to be in the log at the start (ids, a partial record)',
        hint: 'A partial record: the listed quests count, and a prerequisite or turn-in that fails only because a quest is missing from these lists is a warning that it cannot be checked, not an error.',
      };
    case 'fresh':
      return {
        completed: 'Quests completed before the route (ids)',
        log: 'Quests in the log at the start (ids)',
        hint: 'A new character is expected to have none; these are used as given. Choose another answer above, or empty them.',
      };
  }
}

const RIDING_OPTIONS = [
  { value: '0', label: 'None' },
  { value: '1', label: 'Apprentice' },
  { value: '2', label: 'Journeyman' },
] as const;

/** The race options of a faction, and the draft's race when it is not one of them (so the select shows the real value, UI-F15). */
export function raceOptionsOf(faction: Faction, race: RaceToken): readonly { readonly value: RaceToken; readonly label: string }[] {
  const races = racesOf(faction);
  return [
    ...races.map((r) => ({ value: r, label: RACE_NAMES[r] })),
    ...(races.includes(race) ? [] : [{ value: race, label: `${RACE_NAMES[race]} (not a race of the ${faction})` }]),
  ];
}

interface SettingsFormProps extends Omit<SettingsDialogProps, 'open'> {
  readonly formId: string;
}

function SettingsForm({ store, onClose, announce, formId }: SettingsFormProps) {
  const character = useEditor(store, selectCharacter);
  const profile = useEditor(store, selectRouteProfile);
  const assumptions = useEditor(store, selectAssumptions);
  const locked = useEditor(store, selectEditingLocked);
  const [draft, setDraft] = useState<SettingsDraft>(() => settingsDraftOf(character, profile));
  const [problems, setProblems] = useState<readonly SettingsProblem[]>([]);
  const problemsRef = useRef<HTMLDivElement>(null);
  const problemsId = useId();
  useFocusProblems(problemsRef, problems);
  const maxLevel = maxLevelOf({ assumptions });
  const patch = (next: Partial<SettingsDraft>) => {
    setDraft((current) => ({ ...current, ...next }));
  };
  const field = (name: SettingsField) => fieldProblemProps(problems, problemsId, name);

  const setFaction = (faction: Faction) => {
    const race = racesOf(faction).includes(draft.race) ? draft.race : (racesOf(faction)[0] ?? draft.race);
    patch({ faction, race, class: isPlayablePair(race, draft.class) ? draft.class : (classesOf(race)[0] ?? draft.class) });
  };
  const setRace = (race: RaceToken) => {
    patch({ race, class: isPlayablePair(race, draft.class) ? draft.class : (classesOf(race)[0] ?? draft.class) });
  };

  const priorWords = priorListWords(draft.priorHistory);
  const raceOptions = raceOptionsOf(draft.faction, draft.race);
  const playable = isPlayablePair(draft.race, draft.class);
  const classOptions = [
    ...classesOf(draft.race).map((cls) => ({ value: cls, label: CLASS_NAMES[cls] })),
    ...(playable ? [] : [{ value: draft.class, label: `${CLASS_NAMES[draft.class]} (not a playable pair in the Forever client)` }]),
  ];

  const save = (event?: FormEvent) => {
    event?.preventDefault();
    if (locked) return;
    const result = settingsPatchOf(draft, maxLevel);
    if (result.patch === null) {
      setProblems(result.problems);
      announce?.(`Not saved: ${result.problems.map((problem) => problem.message).join(' ')}`);
      return;
    }
    const { revision } = store.getState();
    store.dispatch(updateSettings(result.patch));
    announce?.(store.getState().revision === revision ? 'Settings unchanged.' : 'Settings saved. Undo with Ctrl+Z.');
    onClose();
  };

  return (
    <form id={formId} className="frl-app-form frl-settings" onSubmit={save} noValidate>
      {locked && <p className="frl-app-hint">Unavailable while the optimiser runs or a proposal is open: the settings are read-only.</p>}
      <FormProblems id={problemsId} problems={problems} listRef={problemsRef} />
      <fieldset className="frl-settings__group" disabled={locked}>
        <legend>Character</legend>
        <div className="frl-app-fields__row">
          <Select
            label="Faction"
            value={draft.faction}
            options={FACTION_OPTIONS}
            onChange={(value) => {
              if (value === 'Horde' || value === 'Alliance') setFaction(value);
            }}
          />
          <Select
            label="Race"
            value={draft.race}
            options={raceOptions}
            onChange={(value) => {
              const race = raceOptions.find((option) => option.value === value)?.value;
              if (race !== undefined) setRace(race);
            }}
          />
          <Select
            label="Class"
            value={draft.class}
            options={classOptions}
            onChange={(value) => {
              const cls = classOptions.find((option) => option.value === value)?.value;
              if (cls !== undefined) patch({ class: cls });
            }}
          />
          <Select
            label="Sex"
            value={draft.sex}
            options={SEX_OPTIONS}
            onChange={(value) => {
              if (value === '' || value === 'male' || value === 'female') patch({ sex: value });
            }}
          />
        </div>
        <p className="frl-app-hint">Race and class list the Forever client’s playable pairs (CharBaseInfo, build 1.60.1.69977).</p>
        <div className="frl-app-fields__row">
          <TextInput
            label={`Start level (1 to ${String(maxLevel)})`}
            value={draft.startLevel}
            onChange={(startLevel) => {
              patch({ startLevel });
            }}
            inputMode="numeric"
            {...field('startLevel')}
          />
          <TextInput
            label="Start XP (into the start level)"
            value={draft.startXp}
            onChange={(startXp) => {
              patch({ startXp });
            }}
            inputMode="numeric"
            {...field('startXp')}
          />
          <Select
            label="Riding trained before the route"
            value={draft.riding}
            options={RIDING_OPTIONS}
            onChange={(value) => {
              if (value === '0' || value === '1' || value === '2') patch({ riding: value });
            }}
          />
        </div>
        <Select
          label="Before the route"
          value={draft.priorHistory}
          options={HISTORY_OPTIONS}
          onChange={(value) => {
            if (value === 'fresh' || value === 'listed' || value === 'unknown') patch(historyPatch(value));
          }}
        />
        {showsPriorLists(draft) && (
          <>
            <div className="frl-app-fields__row">
              <TextInput
                label={priorWords.completed}
                value={draft.priorCompleted}
                onChange={(priorCompleted) => {
                  patch({ priorCompleted });
                }}
                {...field('priorCompleted')}
              />
              <TextInput
                label={priorWords.log}
                value={draft.priorLog}
                onChange={(priorLog) => {
                  patch({ priorLog });
                }}
                {...field('priorLog')}
              />
            </div>
            <p className="frl-app-hint">{priorWords.hint}</p>
          </>
        )}
      </fieldset>
      <fieldset className="frl-settings__group" disabled={locked}>
        <legend>Route profile</legend>
        <p className="frl-app-hint">The variables an RXP guide is loaded with (they pick its variants), and this app’s own variant filtering.</p>
        <div className="frl-app-fields__row">
          <TextInput
            label="XP rate (1 is normal)"
            value={draft.xpRate}
            onChange={(xpRate) => {
              patch({ xpRate });
            }}
            inputMode="decimal"
            {...field('xpRate')}
          />
          <TextInput
            label="Season (empty: unknown)"
            value={draft.season}
            onChange={(season) => {
              patch({ season });
            }}
            inputMode="numeric"
            {...field('season')}
          />
          <TextInput
            label="Phase (empty: unknown)"
            value={draft.phase}
            onChange={(phase) => {
              patch({ phase });
            }}
            inputMode="numeric"
            {...field('phase')}
          />
          <TextInput
            label="Locale"
            value={draft.locale}
            onChange={(locale) => {
              patch({ locale });
            }}
            {...field('locale')}
          />
        </div>
        <TextInput
          label="Dungeons the route runs (comma-separated)"
          value={draft.dungeons}
          onChange={(dungeons) => {
            patch({ dungeons });
          }}
        />
        <div className="frl-settings__checks">
          <Checkbox
            label="Hardcore"
            checked={draft.hardcore}
            onChange={(hardcore) => {
              patch({ hardcore });
            }}
          />
          <Checkbox
            label="Self-found (SSF)"
            checked={draft.ssf}
            onChange={(ssf) => {
              patch({ ssf });
            }}
          />
          <Checkbox
            label="Group quests"
            checked={draft.groupQuests}
            onChange={(groupQuests) => {
              patch({ groupQuests });
            }}
          />
          <Checkbox
            label="XP step skipping"
            checked={draft.xpStepSkipping}
            onChange={(xpStepSkipping) => {
              patch({ xpStepSkipping });
            }}
          />
        </div>
      </fieldset>
    </form>
  );
}

export function SettingsDialog({ open, onClose, store, announce }: SettingsDialogProps) {
  const formId = useId();
  const locked = useEditor(store, selectEditingLocked);
  // The actions are the dialog's footer, as in the other dialogs: Cancel first, the primary action last.
  const footer = (
    <>
      <Button onClick={onClose}>Cancel</Button>
      <Button type="submit" form={formId} variant="primary" aria-disabled={locked ? true : undefined} title={locked ? 'Unavailable while the optimiser runs or a proposal is open' : undefined}>
        Save settings
      </Button>
    </>
  );
  return (
    <ModalDialog open={open} onClose={onClose} title="Settings" className="frl-settings-dialog" footer={footer} dismissOnBackdrop={false}>
      {open && <SettingsForm store={store} onClose={onClose} announce={announce} formId={formId} />}
    </ModalDialog>
  );
}
