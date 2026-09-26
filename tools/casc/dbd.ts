import { CascError } from './errors';
import type { Wdc5Column, Wdc5ColumnType, Wdc5Layout } from './wdc5';

/**
 * A minimal reader for WoWDBDefs `.dbd` definition files (https://github.com/wowdev/WoWDBDefs,
 * `definitions/`, CC BY-SA 4.0), used only to generate and check `layouts.ts`. It reads the
 * `COLUMNS` section (type per column) and one definition block: the block whose `BUILD` lines
 * name the requested build, exactly or inside a range.
 *
 * ```
 * COLUMNS
 * int ID
 * locstring AreaName_lang
 * int<AreaTable::ID> ParentAreaID
 *
 * LAYOUT 9995B797
 * BUILD 1.60.1.69876, 1.60.1.70009
 * $noninline,id$ID<32>
 * AreaName_lang
 * ParentAreaID<u16>
 * Flags<32>[2]
 * ```
 */

interface DbdColumn {
  readonly type: 'int' | 'float' | 'string' | 'locstring';
}

interface DbdDefinition {
  readonly annotations: readonly string[];
  readonly name: string;
  readonly size: { readonly bits: number; readonly unsigned: boolean } | null;
  readonly array: number;
}

interface DbdBlock {
  readonly layouts: readonly string[];
  readonly builds: readonly string[];
  readonly definitions: readonly DbdDefinition[];
}

const stripComment = (line: string): string => {
  const at = line.indexOf('//');
  return (at < 0 ? line : line.slice(0, at)).trim();
};

function parseVersion(text: string): readonly number[] {
  const parts = text.split('.').map((p) => Number.parseInt(p, 10));
  if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p))) throw new CascError('format', `DBD: bad build "${text}"`);
  return parts;
}

function compareVersions(a: readonly number[], b: readonly number[]): number {
  for (let i = 0; i < 4; i += 1) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/** True when a `BUILD` line entry (`a.b.c.d` or `a.b.c.d-e.f.g.h`) covers `build`. */
export function buildMatches(entry: string, build: string): boolean {
  const target = parseVersion(build);
  const [low, high] = entry.split('-');
  if (low === undefined) return false;
  if (high === undefined) return compareVersions(parseVersion(low), target) === 0;
  return compareVersions(parseVersion(low), target) <= 0 && compareVersions(target, parseVersion(high)) <= 0;
}

function parseDefinition(line: string): DbdDefinition {
  const match = /^(?:\$([a-z,]+)\$)?([A-Za-z_][A-Za-z0-9_]*)(?:<(u?)(\d+)>)?(?:\[(\d+)\])?$/.exec(line);
  if (match === null) throw new CascError('format', `DBD: cannot read definition "${line}"`);
  const [, annotations, name = '', unsigned, bits, array] = match;
  return {
    annotations: annotations === undefined ? [] : annotations.split(','),
    name,
    size: bits === undefined ? null : { bits: Number(bits), unsigned: unsigned === 'u' },
    array: array === undefined ? 1 : Number(array),
  };
}

function parseDbd(text: string): { readonly columns: ReadonlyMap<string, DbdColumn>; readonly blocks: readonly DbdBlock[] } {
  const chunks = text.replace(/\r\n/g, '\n').split(/\n\s*\n/);
  const columns = new Map<string, DbdColumn>();
  const blocks: DbdBlock[] = [];
  for (const chunk of chunks) {
    const lines = chunk.split('\n').map(stripComment).filter((line) => line !== '');
    if (lines.length === 0) continue;
    if (lines[0] === 'COLUMNS') {
      for (const line of lines.slice(1)) {
        const match = /^(int|float|string|locstring)(?:<[^>]*>)?\s+([A-Za-z_][A-Za-z0-9_]*)\??$/.exec(line);
        if (match === null) throw new CascError('format', `DBD: cannot read column "${line}"`);
        const [, type = 'int', name = ''] = match;
        columns.set(name, { type: type as DbdColumn['type'] });
      }
      continue;
    }
    const layouts: string[] = [];
    const builds: string[] = [];
    const definitions: DbdDefinition[] = [];
    for (const line of lines) {
      if (line.startsWith('LAYOUT ')) layouts.push(...line.slice(7).split(',').map((s) => s.trim()));
      else if (line.startsWith('BUILD ')) builds.push(...line.slice(6).split(',').map((s) => s.trim()));
      else if (line.startsWith('COMMENT')) continue;
      else definitions.push(parseDefinition(line));
    }
    blocks.push({ layouts, builds, definitions });
  }
  return { columns, blocks };
}

/** The WDC5 layout of `table` at `build`, from the text of its `.dbd` file. */
export function layoutFromDbd(table: string, text: string, build: string, source: string): Wdc5Layout {
  const { columns, blocks } = parseDbd(text);
  const block = blocks.find((b) => b.builds.some((entry) => buildMatches(entry, build)));
  if (block === undefined) throw new CascError('layout', `${table}.dbd has no definition block for build ${build}`);
  const [layoutHash, ...others] = block.layouts;
  if (layoutHash === undefined || others.length > 0) throw new CascError('layout', `${table}.dbd: the ${build} block has ${String(block.layouts.length)} LAYOUT hashes, expected one`);
  const fields: Wdc5Column[] = [];
  let id: string | null = null;
  let idInline = true;
  let relation: string | null = null;
  let relationInline = false;
  for (const d of block.definitions) {
    const column = columns.get(d.name);
    if (column === undefined) throw new CascError('layout', `${table}.dbd: "${d.name}" is not in COLUMNS`);
    const noninline = d.annotations.includes('noninline');
    if (d.annotations.includes('id')) {
      id = d.name;
      idInline = !noninline;
    }
    if (d.annotations.includes('relation')) {
      relation = d.name;
      relationInline = !noninline;
    }
    if (noninline) continue;
    let type: Wdc5ColumnType;
    let bits = 32;
    if (column.type === 'int') {
      if (d.size === null) throw new CascError('layout', `${table}.dbd: integer "${d.name}" has no size`);
      type = d.size.unsigned ? 'uint' : 'int';
      bits = d.size.bits;
    } else {
      type = column.type;
    }
    fields.push({ name: d.name, type, bits, array: d.array });
  }
  if (id === null) throw new CascError('layout', `${table}.dbd: the ${build} block has no $id$ column`);
  return { table, layoutHash, fields, id, idInline, relation, relationInline, source };
}
