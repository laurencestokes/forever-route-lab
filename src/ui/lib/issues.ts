import type { IssueSeverity, ValidationIssue } from '../../domain/issues';
import { plural } from './format';

/** Issue totals per severity, as the route rows, tabs and status bar show them. */
export interface IssueCounts {
  readonly error: number;
  readonly warning: number;
  readonly info: number;
}

export const NO_ISSUES: IssueCounts = { error: 0, warning: 0, info: 0 };

/** Most severe first; the order used for icons, sorting and summaries. */
export const SEVERITY_ORDER: readonly IssueSeverity[] = ['error', 'warning', 'info'];

export const SEVERITY_LABELS: Readonly<Record<IssueSeverity, string>> = {
  error: 'Error',
  warning: 'Warning',
  info: 'Info',
};

export function countIssues(issues: readonly Pick<ValidationIssue, 'severity'>[]): IssueCounts {
  let error = 0;
  let warning = 0;
  let info = 0;
  for (const issue of issues) {
    switch (issue.severity) {
      case 'error':
        error += 1;
        break;
      case 'warning':
        warning += 1;
        break;
      case 'info':
        info += 1;
        break;
    }
  }
  return { error, warning, info };
}

export function totalIssues(counts: IssueCounts): number {
  return counts.error + counts.warning + counts.info;
}

/** The most severe level present, or null when there are no issues. */
export function worstSeverity(counts: IssueCounts): IssueSeverity | null {
  for (const severity of SEVERITY_ORDER) {
    if (counts[severity] > 0) return severity;
  }
  return null;
}

/** `'2 errors, 1 warning'`; `'No issues'` when empty. Info is listed last. */
export function describeIssueCounts(counts: IssueCounts): string {
  const parts: string[] = [];
  if (counts.error > 0) parts.push(plural(counts.error, 'error'));
  if (counts.warning > 0) parts.push(plural(counts.warning, 'warning'));
  if (counts.info > 0) parts.push(plural(counts.info, 'note'));
  return parts.length === 0 ? 'No issues' : parts.join(', ');
}
