import type { QuestRecord } from '../domain/dataset';
import type { QuestId, StepId } from '../domain/ids';
import type { ValidationIssue } from '../domain/issues';
import { formatIssueMessage, type IssueCode, issueCodeSpec, type IssueData } from './codes';

/**
 * Building issues (docs/ARCHITECTURE.md §9.4): the fixed `ValidationIssue` shape with explicit
 * nulls, the words the message templates use, and the stable order of a step's issues.
 */

/** Words a rule supplies for a message template besides `data` (always `quest` for a quest issue). */
export type IssueWords = Readonly<Record<string, string | number>>;

export const NO_ISSUES: readonly ValidationIssue[] = [];

/**
 * An issue with its registry severity and formatted message. The key order is fixed (code,
 * severity, stepId, questId, message, data), so issues serialise and snapshot alike.
 */
export function createIssue(code: IssueCode, stepId: StepId | null, questId: QuestId | null, data: IssueData | null, words: IssueWords | null): ValidationIssue {
  return { code, severity: issueCodeSpec(code).severity, stepId, questId, message: formatIssueMessage(code, data, words), data };
}

/** What the validator needs to name a quest in a message. */
export interface QuestNames {
  quest(id: QuestId): Pick<QuestRecord, 'name'> | undefined;
}

/** Labels per dataset object: records never change behind one (a new view is a new object). */
const LABELS = new WeakMap<QuestNames, Map<QuestId, string>>();

/** A quest as messages name it: `Name (id)`, or `Quest id` when the data does not know it. */
export function questLabel(names: QuestNames, id: QuestId): string {
  let labels = LABELS.get(names);
  if (labels === undefined) {
    labels = new Map();
    LABELS.set(names, labels);
  }
  let label = labels.get(id);
  if (label === undefined) {
    const record = names.quest(id);
    label = record === undefined ? `Quest ${String(id)}` : `${record.name} (${String(id)})`;
    labels.set(id, label);
  }
  return label;
}

/** `a`, `a and b`, `a, b and c`. */
export function listText(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1] ?? ''}`;
}

/** Quest labels joined for a message. */
export function questListText(names: QuestNames, ids: readonly QuestId[]): string {
  return listText(ids.map((id) => questLabel(names, id)));
}

/** Ids as a machine-readable `data` value: ascending, comma-separated, no spaces. */
export function idList(ids: readonly number[]): string {
  return [...ids].sort((a, b) => a - b).join(',');
}

/** `1 leg`, `3 legs`. */
export function countText(count: number, singular: string, plural = `${singular}s`): string {
  return `${String(count)} ${count === 1 ? singular : plural}`;
}

/** Seconds as `12 s`, `4 min 5 s` or `1 h 2 min`, rounded to whole seconds. */
export function durationText(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  if (total < 60) return `${String(total)} s`;
  const minutes = Math.floor(total / 60);
  if (minutes < 60) {
    const rest = total - minutes * 60;
    return rest === 0 ? `${String(minutes)} min` : `${String(minutes)} min ${String(rest)} s`;
  }
  const hours = Math.floor(minutes / 60);
  const rest = minutes - hours * 60;
  return rest === 0 ? `${String(hours)} h` : `${String(hours)} h ${String(rest)} min`;
}

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** Stable order within one step: code, then quest id (null first), then message. */
export function compareIssues(a: ValidationIssue, b: ValidationIssue): number {
  if (a.code !== b.code) return cmp(a.code, b.code);
  if (a.questId !== b.questId) {
    if (a.questId === null) return -1;
    if (b.questId === null) return 1;
    return a.questId - b.questId;
  }
  return cmp(a.message, b.message);
}

function sameData(a: IssueData | null, b: IssueData | null): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  for (const key of keys) if (a[key] !== b[key]) return false;
  return true;
}

/** One step's issues without duplicates (same code, quest, message and data), in the stable order. */
export function orderStepIssues(issues: ValidationIssue[]): readonly ValidationIssue[] {
  if (issues.length <= 1) return issues;
  issues.sort(compareIssues);
  let kept = 1;
  for (let i = 1; i < issues.length; i += 1) {
    const issue = issues[i];
    const previous = issues[kept - 1];
    if (issue === undefined || previous === undefined) continue;
    if (compareIssues(issue, previous) === 0 && sameData(issue.data, previous.data)) continue;
    issues[kept] = issue;
    kept += 1;
  }
  issues.length = kept;
  return issues;
}
