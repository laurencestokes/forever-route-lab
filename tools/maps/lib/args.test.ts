import { describe, expect, it } from 'vitest';
import { parseArgs } from './args';

const spec = { values: ['--commit', '--out'], flags: ['--check'], optionalValues: ['--local'] };

describe('parseArgs', () => {
  it('reads values in both spellings, flags, optional values and positionals', () => {
    const args = parseArgs(['--commit', 'abc', '--out=dir', '--check', '--local', 'extra'], spec);
    expect([...args.values]).toEqual([['--commit', 'abc'], ['--out', 'dir'], ['--local', 'extra']]);
    expect([...args.flags]).toEqual(['--check']);
    const bare = parseArgs(['--local', '--check'], spec);
    expect(bare.flags.has('--local')).toBe(true);
    expect(bare.values.has('--local')).toBe(false);
    expect(parseArgs(['x'], spec).positional).toEqual(['x']);
  });

  it('refuses unknown, repeated or malformed options', () => {
    expect(() => parseArgs(['--nope'], spec)).toThrow('unknown option --nope');
    expect(() => parseArgs(['--check', '--check'], spec)).toThrow('--check given twice');
    expect(() => parseArgs(['--commit'], spec)).toThrow('--commit needs a value');
    expect(() => parseArgs(['--check=1'], spec)).toThrow('--check takes no value');
  });
});
