import type { FilterAst } from '../domain/conditions';
import { type UiMapId, uiMapId } from '../domain/ids';
import type { SourcedPoint, WorldPoint } from '../domain/points';
import { resolvePoint } from '../geo/resolve';
import { isFullUiRectangle } from '../geo/transforms';
import type { MapGeometry } from '../geo/types';
import { rowContainsWorldPoint } from '../geo/zones';
import type { ArgumentSeparator } from './commands';
import { type RxpCst, type RxpCstLine, parseRxpCst } from './cst';
import { printFilter } from './filter';
import { formatFixed2, trimBlank, trimEndBlank } from './text';

/**
 * Canonical form (docs/RXP.md §13.4): UTF-8 without BOM, LF endings, one final LF, no trailing
 * whitespace, no tabs; header lines at column 0, one blank line before the first step, no blank
 * lines inside or between steps, `step` at column 0 and every body line indented four spaces.
 * Order is never changed. Content that cannot be written without changing its meaning is an
 * error, never silently altered (§13.4 rule 12).
 */

export class RxpUnrepresentable extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RxpUnrepresentable';
  }
}

export const BODY_INDENT = '    ';

const SEPARATOR_CHAR: Readonly<Record<ArgumentSeparator, string | null>> = { comma: ',', semicolon: ';', rest: null };

function assertLine(text: string): string {
  if (text.includes('\t')) throw new RxpUnrepresentable(`"${text.trim()}" contains a tab character, which canonical RXP output does not allow`);
  return text;
}

/** ` << FILTER` for an AST, or the raw filter text when the AST has no canonical form (CST lines only). */
function filterSuffix(ast: FilterAst | null, rawFallback: string | null): string {
  if (ast === null) return '';
  const printed = printFilter(ast);
  if (printed !== null) return ` << ${printed}`;
  if (rawFallback !== null) return ` << ${rawFallback}`;
  throw new RxpUnrepresentable('a filter has no RXP form (a word outside [A-Za-z0-9] that is not a merged word, nested groups, a double negation or a level that is not a whole number)');
}

/** Comments carry no RXP meaning, so a tab in one is written as a space instead of refused (§13.4 rule 11). */
const commentText = (comment: string): string => comment.replace(/\t/g, ' ');

/**
 * ` --comment`: a line's trailing comment as canonical output writes it, after every other part
 * (§13.4 rule 11); empty when the line has none. The serializer also appends it to rebuilt lines.
 */
export const trailingComment = (line: Pick<RxpCstLine, 'comment'>): string => (line.comment === null ? '' : ` --${trimEndBlank(commentText(line.comment))}`);

const commentSuffix = trailingComment;

/**
 * The canonical text of a line's content without its comment: the whitespace-independent form of
 * what RXP reads. Used for opaque predicates (`raw`) and preserved notes' display text, so they do
 * not change when a guide is re-indented or canonicalised. Falls back to the content itself when
 * the content has no canonical form (a tab inside it).
 */
export function canonicalCode(line: RxpCstLine): string {
  if (line.comment === null) {
    try {
      return canonicalCstContent(line) ?? line.content;
    } catch (error) {
      if (error instanceof RxpUnrepresentable) return line.content;
      throw error;
    }
  }
  return canonicalCode({ ...line, comment: null });
}

/** The canonical text of one CST line, without indentation; null for a blank line (dropped). */
export function canonicalCstContent(line: RxpCstLine): string | null {
  const filter = line.filter === null ? '' : filterSuffix(line.filter.parsed.ast, line.filter.text);
  const text = line.text === null ? '' : ` >> ${line.text}`;
  switch (line.kind) {
    case 'blank':
      return null;
    case 'comment': {
      const body = trimBlank(commentText(line.comment ?? ''));
      return assertLine(body === '' ? '--' : `-- ${body}`);
    }
    case 'step':
      return assertLine((line.stepSuffix === null ? `step${filter}` : line.content) + commentSuffix(line));
    case 'enabledFor':
      return assertLine(`${filter.slice(1)}${commentSuffix(line)}`);
    case 'tag': {
      const tag = line.tag;
      if (tag === null) return assertLine(line.content + commentSuffix(line));
      if (tag.assignment) return assertLine(line.content + commentSuffix(line)); // opaque (§13.4 rule 13)
      return assertLine(`#${tag.key}${tag.value === null ? '' : ` ${tag.value}`}${filter}${commentSuffix(line)}`);
    }
    case 'command': {
      const command = line.command;
      const spec = command?.spec ?? null;
      if (command === null || spec === null || spec.lowering.kind === 'preserved') return assertLine(line.content + commentSuffix(line));
      const separator = SEPARATOR_CHAR[spec.separator];
      const args = command.args.length === 0 ? '' : ` ${separator === null ? command.argsRaw : command.args.join(separator)}`;
      return assertLine(`.${command.name}${args}${text}${filter}${commentSuffix(line)}`);
    }
    case 'note':
      return assertLine(`${line.lead === null || line.lead === '' ? '' : `${line.lead} `}>> ${line.text ?? ''}${filter}${commentSuffix(line)}`);
    case 'objective':
    case 'star':
      return assertLine(`${line.lead ?? ''}${text}${filter}${commentSuffix(line)}`);
    case 'stray':
      return assertLine(line.content + commentSuffix(line));
  }
}

/** The canonical line with its indentation (0 in the header and for `step`, 4 in a step body). */
export function canonicalCstLine(line: RxpCstLine): string | null {
  const content = canonicalCstContent(line);
  if (content === null) return null;
  return line.section === 'header' || line.kind === 'step' ? content : BODY_INDENT + content;
}

export type CanonicalResult = { readonly ok: true; readonly text: string } | { readonly ok: false; readonly errors: readonly string[] };

/** `canon(x)` (§13.7): the canonical form of a whole guide text. */
export function canonicalizeRxpCst(cst: RxpCst): CanonicalResult {
  const out: string[] = [];
  const errors: string[] = [];
  let headerLines = 0;
  let blankBeforeStep = false;
  for (const line of cst.lines) {
    try {
      const text = canonicalCstLine(line);
      if (text === null) continue;
      if (line.kind === 'step' && !blankBeforeStep) {
        blankBeforeStep = true;
        if (headerLines > 0) out.push('');
      }
      if (line.section === 'header') headerLines += 1;
      out.push(text);
    } catch (error) {
      if (!(error instanceof RxpUnrepresentable)) throw error;
      errors.push(`line ${String(line.line)}: ${error.message}`);
    }
  }
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, text: out.length === 0 ? '' : `${out.join('\n')}\n` };
}

export function canonicalizeRxp(text: string): CanonicalResult {
  return canonicalizeRxpCst(parseRxpCst(text));
}

// ---------------------------------------------------------------------------------------------
// Building lines from the model

/** Refuses text that RXP would read differently (§13.4 rule 12): `--`, `<<`, line breaks, tabs. */
export function checkText(value: string, what: string): string {
  if (value.includes('--')) throw new RxpUnrepresentable(`${what} "${value}" contains "--", which RXP reads as a comment`);
  if (value.includes('<<')) throw new RxpUnrepresentable(`${what} "${value}" contains "<<", which RXP reads as a filter`);
  if (/[\r\n]/.test(value)) throw new RxpUnrepresentable(`${what} contains a line break`);
  if (value.includes('\t')) throw new RxpUnrepresentable(`${what} "${value}" contains a tab character`);
  if (value !== trimBlank(value)) throw new RxpUnrepresentable(`${what} "${value}" starts or ends with whitespace`);
  return value;
}

function checkArg(value: string, separator: ArgumentSeparator, command: string): string {
  if (value === '') throw new RxpUnrepresentable(`an argument of ".${command}" is empty`);
  checkText(value, `the argument of ".${command}"`);
  if (value.includes('>>')) throw new RxpUnrepresentable(`the argument "${value}" of ".${command}" contains ">>", which RXP reads as the start of the text`);
  const char = SEPARATOR_CHAR[separator];
  if (char !== null && value.includes(char)) throw new RxpUnrepresentable(`the argument "${value}" of ".${command}" contains its separator "${char}"`);
  return value;
}

/** A `.link` URL: each `-` of a `--` is written `\-` (§13.4 rule 12). */
export function escapeLinkUrl(url: string): string {
  return url.replace(/-{2,}/g, (run) => '\\-'.repeat(run.length));
}

export interface CommandLineParts {
  readonly command: string;
  readonly args: readonly string[];
  readonly separator: ArgumentSeparator;
  readonly text: string | null;
  readonly filter: FilterAst | null;
}

/** `.name[ args][ >> text][ << filter]` (§13.4 rule 6). */
export function buildCommandLine(parts: CommandLineParts): string {
  if (parts.command === '' || /[ \t]/.test(parts.command)) throw new RxpUnrepresentable(`the command name "${parts.command}" is empty or contains whitespace`);
  let args = '';
  if (parts.args.length > 0) {
    if (parts.separator === 'rest') {
      const [first = ''] = parts.args;
      const value = parts.command === 'link' ? escapeLinkUrl(first) : first;
      args = ` ${checkArg(value, 'rest', parts.command)}`;
    } else {
      args = ` ${parts.args.map((arg) => checkArg(arg, parts.separator, parts.command)).join(SEPARATOR_CHAR[parts.separator] ?? ',')}`;
    }
  }
  const text = parts.text === null ? '' : ` >> ${checkText(parts.text, 'the text')}`;
  return `.${parts.command}${args}${text}${filterSuffix(parts.filter, null)}`;
}

/** `>> TEXT`, `+LABEL`, `*LABEL` with an optional filter (§13.4 rule 7). */
export function buildNoteLine(prefix: '>>' | '+' | '*', text: string, filter: FilterAst | null): string {
  if (text === '') throw new RxpUnrepresentable('a note with an empty text has no RXP form (RXP drops ">>" without text)');
  checkText(text, 'the note');
  if (prefix !== '>>' && text.includes('>>')) throw new RxpUnrepresentable(`the label "${text}" contains ">>"`);
  return `${prefix === '>>' ? '>> ' : prefix}${text}${filterSuffix(filter, null)}`;
}

/** `#key value`, `#key = value` (§13.4 rule 5). */
export function buildTagLine(key: string, value: string | null, assignment: boolean, filter: FilterAst | null): string {
  if (key === '' || /[ \t]/.test(key)) throw new RxpUnrepresentable(`the tag key "${key}" is empty or contains whitespace`);
  checkText(key, 'the tag key');
  if (value !== null) checkText(value, `the value of "#${key}"`);
  const body = assignment ? `#${key} =${value === null ? '' : ` ${value}`}` : `#${key}${value === null ? '' : ` ${value}`}`;
  return `${body}${filterSuffix(filter, null)}`;
}

/** `step` or `step << FILTER` (§13.4 rule 4). */
export const buildStepLine = (filter: FilterAst | null): string => `step${filterSuffix(filter, null)}`;

// ---------------------------------------------------------------------------------------------
// Points (§13.4 rule 8)

/** The smallest committed full-rectangle frame that contains a world point (ties: lowest UiMapID), or null. */
export function smallestContainingFrame(point: WorldPoint, geometry: MapGeometry | null): UiMapId | null {
  if (geometry === null) return null;
  let best: { readonly id: UiMapId; readonly area: number } | null = null;
  for (const map of geometry.maps.values()) {
    for (const row of map.assignments) {
      if (!isFullUiRectangle(row) || !rowContainsWorldPoint(row, point)) continue;
      const area = (row.xMax - row.xMin) * (row.yMax - row.yMin);
      if (best === null || area < best.area || (area === best.area && map.uiMapId < best.id)) best = { id: uiMapId(map.uiMapId), area };
    }
  }
  return best?.id ?? null;
}

const fixed = (value: number): string => {
  const text = formatFixed2(value);
  if (text === null) throw new RxpUnrepresentable('a coordinate is not a finite number');
  return text;
};

/**
 * The `zone,a,b` arguments that write a point (§13.4 rule 8). A point with lexemes keeps its space
 * and its number strings (`zoneToken` is the template's zone spelling when the point is the
 * template's own). A point without lexemes was made in the app and is written in world form with two
 * decimals, or in zone form when geometry cannot place it. Throws when a world point has no UiMap
 * and no committed frame contains it.
 */
export function pointArguments(point: SourcedPoint, geometry: MapGeometry | null, zoneToken: string | null = null): readonly [string, string, string] {
  if (point.lexemes !== null) {
    const [a, b] = point.lexemes;
    if (point.space === 'zone') return [zoneToken ?? String(point.uiMapId), a, b];
    const ui = point.uiMapId ?? smallestContainingFrame(point, geometry);
    if (ui === null) throw new RxpUnrepresentable('a world point without a UiMap lies in no committed frame');
    return [zoneToken ?? `${String(ui)}/${String(point.mapId)}`, a, b];
  }
  if (point.space === 'world') {
    const ui = point.uiMapId ?? smallestContainingFrame(point, geometry);
    if (ui === null) throw new RxpUnrepresentable('a world point without a UiMap lies in no committed frame');
    return [`${String(ui)}/${String(point.mapId)}`, fixed(point.y), fixed(point.x)];
  }
  const world = geometry === null ? null : resolvePoint(point, geometry);
  if (world === null) return [String(point.uiMapId), fixed(point.x), fixed(point.y)];
  return [`${String(point.uiMapId)}/${String(world.mapId)}`, fixed(world.y), fixed(world.x)];
}
