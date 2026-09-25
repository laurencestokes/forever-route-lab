/**
 * Display formatting. Output is locale-independent (grouping with commas, dot decimals) so
 * screenshots, tests and docs agree; nothing here rounds a value up past what it is.
 */

const INVALID = '?';

/** `12345.6` → `'12,345'` (truncates toward zero). Non-finite input gives `'?'`. */
export function formatInteger(n: number): string {
  if (!Number.isFinite(n)) return INVALID;
  const truncated = Math.trunc(n);
  const sign = truncated < 0 ? '-' : '';
  const digits = String(Math.abs(truncated));
  let out = '';
  for (let i = 0; i < digits.length; i += 1) {
    const fromEnd = digits.length - i;
    out += digits.charAt(i);
    if (fromEnd > 1 && fromEnd % 3 === 1) out += ',';
  }
  return sign + out;
}

/**
 * A fractional level such as `12.47` (level 12, 47% of the way to 13) shown to one decimal,
 * truncated: `'12.4'`. Truncation matters: 12.99 must not read as 13.0 before the ding.
 */
export function formatLevel(level: number): string {
  if (!Number.isFinite(level) || level < 0) return INVALID;
  const whole = Math.floor(level);
  const tenth = Math.min(9, Math.floor((level - whole) * 10 + 1e-9));
  return `${whole}.${tenth}`;
}

/** `0.456` → `'45%'` (truncated, clamped to 0-100). */
export function formatPercent(fraction: number): string {
  if (!Number.isFinite(fraction)) return INVALID;
  const clamped = Math.min(1, Math.max(0, fraction));
  return `${Math.floor(clamped * 100 + 1e-9)}%`;
}

/**
 * Seconds as a compact duration: `'45s'`, `'12m 05s'`, `'3h 07m'`. Hours drop the seconds; a
 * dense status bar never needs them.
 */
export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return INVALID;
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${formatInteger(h)}h ${String(m).padStart(2, '0')}m`;
  if (m > 0) return `${m}m ${String(s).padStart(2, '0')}s`;
  return `${s}s`;
}

/** Long form for accessible names: `'3 hours 7 minutes'`, `'45 seconds'`. */
export function formatDurationLong(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return 'unknown duration';
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const parts: string[] = [];
  if (h > 0) parts.push(plural(h, 'hour'));
  if (m > 0) parts.push(plural(m, 'minute'));
  if (h === 0 && (s > 0 || m === 0)) parts.push(plural(s, 'second'));
  return parts.join(' ');
}

/** `'1 warning'`, `'3 warnings'`. */
export function plural(n: number, singular: string, pluralForm = `${singular}s`): string {
  return `${formatInteger(n)} ${n === 1 ? singular : pluralForm}`;
}
