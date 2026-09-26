import { type RefObject, useEffect } from 'react';
import { SeverityIcon } from '../markers/SeverityIcon';
import './Editing.css';

/**
 * The problems that stop a form's save (docs/UI.md §14): listed at the top of the form, which
 * takes focus after each failed save, with every offending field marked `aria-invalid` and
 * described by its problems (UI-F6).
 */

/** Why a form cannot be saved, in words, and the field it is about (null: the form as a whole). */
export interface FieldProblem<F extends string> {
  readonly field: F | null;
  readonly message: string;
}

/** The id of problem `index` in the list `listId`. */
export const problemItemId = (listId: string, index: number): string => `${listId}-${String(index)}`;

/** A field's `aria-invalid` and `aria-describedby` (after its own `describedBy`), from the form's problems. */
export function fieldProblemProps<F extends string>(
  problems: readonly FieldProblem<F>[],
  listId: string,
  field: F,
  describedBy?: string,
): { readonly invalid: boolean; readonly describedBy: string | undefined } {
  const ids = problems.flatMap((problem, index) => (problem.field === field ? [problemItemId(listId, index)] : []));
  const all = [...(describedBy === undefined ? [] : [describedBy]), ...ids];
  return { invalid: ids.length > 0, describedBy: all.length === 0 ? undefined : all.join(' ') };
}

/**
 * Moves focus to the list after every failed save. `problems` is a new array for each attempt, so
 * the same problems a second time take focus again. After the list has rendered: a ref read right
 * after `setProblems` is still empty the first time (UI-F6).
 */
export function useFocusProblems(ref: RefObject<HTMLElement | null>, problems: readonly unknown[]): void {
  useEffect(() => {
    if (problems.length > 0) ref.current?.focus();
  }, [ref, problems]);
}

export interface FormProblemsProps<F extends string> {
  readonly id: string;
  readonly problems: readonly FieldProblem<F>[];
  readonly listRef: RefObject<HTMLDivElement | null>;
}

/** The list, or nothing when there are no problems. */
export function FormProblems<F extends string>({ id, problems, listRef }: FormProblemsProps<F>) {
  if (problems.length === 0) return null;
  return (
    <div className="frl-app-problems" ref={listRef} tabIndex={-1} id={id}>
      <p className="frl-app-problems__title">
        <SeverityIcon severity="error" size={14} labelled={false} />
        Not saved:
      </p>
      <ul className="frl-app-list">
        {problems.map((problem, index) => (
          <li key={`${String(index)}:${problem.message}`} id={problemItemId(id, index)}>
            {problem.message}
          </li>
        ))}
      </ul>
    </div>
  );
}
