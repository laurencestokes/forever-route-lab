import { readFileSync } from 'node:fs';
import { CascError } from './errors';
import { configPath } from './paths';

/** A CASC config file: `key = value` lines; `#` comments and blank lines are ignored. */
export function parseConfig(text: string): ReadonlyMap<string, string> {
  const out = new Map<string, string>();
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith('#')) continue;
    const at = line.indexOf(' = ');
    if (at < 0) continue;
    out.set(line.slice(0, at).trim(), line.slice(at + 3).trim());
  }
  return out;
}

/** The two build-config entries the reader needs. */
export interface BuildConfig {
  /** Content key of the root manifest (looked up through the encoding table). */
  readonly rootCKey: string;
  /** Content key of the encoding table (checked against the MD5 of its decoded bytes). */
  readonly encodingCKey: string;
  /** Encoded key of the encoding table (looked up directly in the local indices). */
  readonly encodingEKey: string;
}

const KEY = /^[0-9a-f]{32}$/;

export function parseBuildConfig(text: string): BuildConfig {
  const config = parseConfig(text);
  const root = config.get('root') ?? '';
  const [encodingCKey = '', encodingEKey = ''] = (config.get('encoding') ?? '').split(' ');
  if (!KEY.test(root)) throw new CascError('format', 'build config has no valid "root" key');
  if (!KEY.test(encodingCKey) || !KEY.test(encodingEKey)) throw new CascError('format', 'build config "encoding" is not "<ckey> <ekey>"');
  return { rootCKey: root, encodingCKey, encodingEKey };
}

export function readBuildConfig(install: string, buildKey: string): BuildConfig {
  return parseBuildConfig(readFileSync(configPath(install, buildKey), 'utf8'));
}
