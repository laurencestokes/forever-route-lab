import { describe, expect, it } from 'vitest';
import { isGitCheckout } from './git';
import { lockfileText, luaparseVersion, toolIdentity, toolLockfileEntries } from './tool-identity';
import { REPO_ROOT } from './upstream';

const lockfile = lockfileText();

describe('toolTreeHash.lockfile covers only what the tool runs with (data-F6)', () => {
  it('lists the importer, package and snapshot entries of luaparse, tsx and zod', () => {
    const entries = toolLockfileEntries(lockfile);
    expect(entries.startsWith("lockfileVersion: '9.0'\n")).toBe(true);
    expect(entries).toContain('importer luaparse 0.3.1 0.3.1\n');
    expect(entries).toMatch(/\nluaparse@0\.3\.1:\n {4}resolution: \{integrity: sha512-/);
    expect(entries).toMatch(/\nimporter tsx \S+ \S+\n/);
    expect(entries).toMatch(/\nimporter zod \S+ \S+\n/);
    expect(luaparseVersion(lockfile)).toBe('0.3.1');
  });

  it('does not change with an unrelated dependency change, and changes with a tool dependency', () => {
    const base = toolLockfileEntries(lockfile);
    expect(toolLockfileEntries(`${lockfile}\n`)).toBe(base);
    const reactBump = lockfile.replace(/(\n {6}react:\n {8}specifier: )([^\n]+)\n {8}version: ([^\n]+)/, '$1^99.0.0\n        version: 99.0.0');
    expect(reactBump).not.toBe(lockfile);
    expect(toolLockfileEntries(reactBump)).toBe(base);
    const luaparseIntegrity = lockfile.replace(/(\n {2}luaparse@0\.3\.1:\n {4}resolution: \{integrity: sha512-)[A-Za-z0-9]/, '$1Z');
    expect(luaparseIntegrity).not.toBe(lockfile);
    expect(toolLockfileEntries(luaparseIntegrity)).not.toBe(base);
  });

  it('fails closed when a tool package is not in the lockfile', () => {
    expect(() => toolLockfileEntries(lockfile.replace(/\n {6}luaparse:\n/, '\n      luaparse-renamed:\n'))).toThrow(/luaparse is not a direct dependency/);
  });
});

describe('the manifest runtime (data-F5)', () => {
  it('records the luaparse version only; the Node version goes to the report', () => {
    const identity = toolIdentity();
    expect(identity.runtime).toEqual({ luaparse: '0.3.1' });
    expect(identity.treeMethod).toBe(isGitCheckout(REPO_ROOT) ? 'git' : 'in-process');
    expect(identity.toolTreeHash.tree).toMatch(/^[0-9a-f]{40}$/);
  });
});
