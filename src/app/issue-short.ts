import type { DatasetView } from '../domain/dataset';
import type { QuestId } from '../domain/ids';
import type { ValidationIssue } from '../domain/issues';

/**
 * A route row's short form of an issue (docs/research/ui-refresh.md §6.1; review UI-01): line 2 of a
 * two-line row shows it, so it drops the step's own quest, which line 1 names. It lives with the
 * derived pipeline (a lazy chunk), which hands the rows `DerivedResults.shortIssue`, so none of it
 * is in the entry chunk (fix-ui: the entry's ledger, ui-refresh.md §10.3).
 */

/** Sentence case, the final full stop dropped: a row's line 2 is a phrase. */
function phrase(text: string): string {
  const trimmed = text.trim().replace(/\.$/, '');
  return trimmed === '' ? trimmed : `${trimmed.charAt(0).toUpperCase()}${trimmed.slice(1)}`;
}

/** Rewrites of the step's own quest's messages into line 2's short form (after its "Name (id)" is dropped). */
const SHORT_FORMS: readonly (readonly [RegExp, string])[] = [
  [/^is already in the quest log$/, 'Already in the quest log'],
  [/^has already been turned in, and it is not repeatable$/, 'Already turned in (not repeatable)'],
  [/^needs one of these quests turned in first: (.+?)(\. .*)?$/, 'Needs $1 turned in first'],
  [/^needs all of its prerequisite quests turned in first; missing: (.+)$/, 'Needs $1 turned in first'],
  [/^is turned in, but no step finishes (.+?); assumed completed along the way$/, 'No step finishes $1; assumed done on the way'],
  [/^is turned in, but no step finishes (.+?): .*$/, 'No step finishes $1'],
  [/^is not in the quest log, so it cannot be turned in$/, 'Not in the quest log: cannot be turned in'],
];

/**
 * A row's short form of an issue (review UI-01): the validator's messages start with the step's own
 * quest, "Name (id)", which line 1 already shows, so line 2 drops it, words the common ones as a
 * phrase ("Needs Cutting Teeth turned in first", "No step finishes objective 1") and drops the ids
 * of the quests it names. The full message stays in the tooltip and the row's name.
 */
export function shortIssueText(issue: Pick<ValidationIssue, 'message' | 'questId'>, dataset: Pick<DatasetView, 'quest'> | null, stepQuest: QuestId | null = null): string {
  let text = issue.message;
  // The issue's quest, else the step's own (an issue with no quest named is about the step's).
  const questId = issue.questId ?? stepQuest;
  if (questId !== null) {
    const name = dataset?.quest(questId)?.name;
    const labels = name === undefined ? [`Quest ${String(questId)}`] : [`${name} (${String(questId)})`, name];
    const label = labels.find((candidate) => text.startsWith(`${candidate} `));
    if (label !== undefined) {
      text = text.slice(label.length + 1).replace(/\.$/, '');
      const form = SHORT_FORMS.find(([pattern]) => pattern.test(text));
      if (form !== undefined) text = text.replace(form[0], form[1]);
    }
  }
  return phrase(text.replace(/ \(\d+\)/g, ''));
}

/**
 * The results' `shortIssue` for one dataset view: `shortIssueText` with the view's quest names,
 * remembered per issue object (a walk keeps the objects of issues that did not change).
 */
export function createIssueShortener(dataset: Pick<DatasetView, 'quest'>): (issue: ValidationIssue, stepQuest: QuestId | null) => string {
  const known = new WeakMap<ValidationIssue, string>();
  return (issue, stepQuest) => {
    const hit = known.get(issue);
    if (hit !== undefined) return hit;
    const text = shortIssueText(issue, dataset, stepQuest);
    known.set(issue, text);
    return text;
  };
}
