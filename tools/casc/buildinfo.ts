import { readFileSync } from 'node:fs';
import { CascError } from './errors';
import { buildInfoPath } from './paths';

/**
 * `.build.info`: a `|`-separated table whose header names each column as `Name!TYPE:size`.
 *
 * Only four columns are kept: `Product`, `Version`, `Build Key` and `CDN Key`. The others (tags,
 * CDN hosts and paths, the install key, activation times) are dropped while parsing and never
 * leave this module. `Active` is read only to discard inactive rows.
 */
export interface BuildInfoRow {
  readonly product: string;
  readonly version: string;
  readonly buildKey: string;
  readonly cdnKey: string;
}

const KEY = /^[0-9a-f]{32}$/;
const KEPT = ['Product', 'Version', 'Build Key', 'CDN Key'] as const;

export function parseBuildInfo(text: string): BuildInfoRow[] {
  const lines = text.split(/\r?\n/).filter((line) => line.trim() !== '');
  const [headerLine, ...rows] = lines;
  if (headerLine === undefined) throw new CascError('format', '.build.info is empty');
  const header = headerLine.split('|').map((cell) => cell.split('!')[0] ?? '');
  const column = (name: string): number => {
    const index = header.indexOf(name);
    if (index < 0) throw new CascError('format', `.build.info has no "${name}" column`);
    return index;
  };
  const [product, version, buildKey, cdnKey] = KEPT.map(column);
  const active = header.indexOf('Active');
  const out: BuildInfoRow[] = [];
  for (const line of rows) {
    const cells = line.split('|');
    if (cells.length !== header.length) throw new CascError('format', `.build.info row has ${String(cells.length)} cells, header has ${String(header.length)}`);
    if (active >= 0 && cells[active] === '0') continue;
    const row: BuildInfoRow = {
      product: cells[product ?? 0] ?? '',
      version: cells[version ?? 0] ?? '',
      buildKey: cells[buildKey ?? 0] ?? '',
      cdnKey: cells[cdnKey ?? 0] ?? '',
    };
    if (row.product === '' || row.version === '') throw new CascError('format', '.build.info row without a product or version');
    if (!KEY.test(row.buildKey) || !KEY.test(row.cdnKey)) throw new CascError('format', `.build.info row for ${row.product}: build or CDN key is not 32 lowercase hex characters`);
    out.push(row);
  }
  return out;
}

/** The single active row of `product`; fails when there is none or more than one. */
export function selectProduct(rows: readonly BuildInfoRow[], product: string): BuildInfoRow {
  const matches = rows.filter((row) => row.product === product);
  const [row] = matches;
  if (row === undefined) throw new CascError('missing', `product "${product}" is not in .build.info (found: ${rows.map((r) => r.product).join(', ') || 'none'})`);
  if (matches.length > 1) throw new CascError('format', `product "${product}" has ${String(matches.length)} active rows in .build.info`);
  return row;
}

export function readBuildInfo(install: string): BuildInfoRow[] {
  return parseBuildInfo(readFileSync(buildInfoPath(install), 'utf8'));
}

/** A recorded build: the product's version and build key must both equal it. */
export interface BuildPin {
  readonly product: string;
  readonly version: string;
  readonly buildKey: string;
}

export function checkPin(row: BuildInfoRow, pin: BuildPin): void {
  if (row.product !== pin.product || row.version !== pin.version || row.buildKey !== pin.buildKey) {
    throw new CascError(
      'pin',
      `installed ${row.product} ${row.version} (build key ${row.buildKey}) is not the pinned ${pin.product} ${pin.version} (build key ${pin.buildKey})`,
    );
  }
}
