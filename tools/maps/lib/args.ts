/** Minimal strict command-line parsing: `--name value`, `--name=value` and bare flags; anything unknown fails. */

export interface ParsedArgs {
  readonly values: ReadonlyMap<string, string>;
  readonly flags: ReadonlySet<string>;
  readonly positional: readonly string[];
}

export interface ArgSpec {
  /** Options that take a value. */
  readonly values: readonly string[];
  /** Options without a value. */
  readonly flags: readonly string[];
  /** Options whose value is optional (`--local` or `--local <dir>`); a following `--` option is not taken as the value. */
  readonly optionalValues?: readonly string[];
}

export function parseArgs(argv: readonly string[], spec: ArgSpec): ParsedArgs {
  const values = new Map<string, string>();
  const flags = new Set<string>();
  const positional: string[] = [];
  const optional = spec.optionalValues ?? [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] ?? '';
    if (!arg.startsWith('--')) {
      positional.push(arg);
      continue;
    }
    const eq = arg.indexOf('=');
    const name = eq === -1 ? arg : arg.slice(0, eq);
    if (values.has(name) || flags.has(name)) throw new Error(`${name} given twice`);
    if (spec.flags.includes(name)) {
      if (eq !== -1) throw new Error(`${name} takes no value`);
      flags.add(name);
    } else if (spec.values.includes(name) || optional.includes(name)) {
      if (eq !== -1) values.set(name, arg.slice(eq + 1));
      else {
        const next = argv[i + 1];
        if (next !== undefined && !next.startsWith('--')) {
          values.set(name, next);
          i += 1;
        } else if (optional.includes(name)) flags.add(name);
        else throw new Error(`${name} needs a value`);
      }
    } else throw new Error(`unknown option ${name}`);
  }
  return { values, flags, positional };
}
