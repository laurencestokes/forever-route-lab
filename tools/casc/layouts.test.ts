import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { layoutSourcesPresent, LAYOUT_TABLES, readLayoutSources, renderLayoutsModule } from './layout-source';
import { DB2 } from './layouts';
import { announceSkip } from './test-support';

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));

describe('generated DB2 layouts', () => {
  it('lists every table once with distinct column names and a WoWDBDefs source', () => {
    expect(Object.keys(DB2)).toEqual([...LAYOUT_TABLES]);
    for (const [name, table] of Object.entries(DB2)) {
      const { layout } = table;
      expect(layout.table).toBe(name);
      expect(layout.layoutHash).toMatch(/^[0-9A-F]{8}$/);
      expect(layout.source).toMatch(/^WoWDBDefs [0-9a-f]{40} definitions\/\w+\.dbd$/);
      const names: readonly string[] = layout.fields.map((f) => f.name);
      expect(new Set(names).size, name).toBe(names.length);
      if (layout.idInline) expect(names, name).toContain(layout.id);
      else expect(names, name).not.toContain(layout.id);
      if (layout.relation !== null) expect(names.includes(layout.relation), name).toBe(layout.relationInline);
      expect(table.fileDataId).toBeGreaterThan(0);
    }
  });

  const present = layoutSourcesPresent(REPO_ROOT);
  it('has the WoWDBDefs research copies, or says loudly why the generator check is skipped', () => {
    if (!present) announceSkip('tools/casc layouts.ts against the WoWDBDefs research copies', 'the .dbd copies and dbd-manifest.json are not in .cache/experiments (docs/MAPS.md §8.3)');
    expect(typeof present).toBe('boolean');
  });
  it.skipIf(!present)('equals the file make-layouts.ts generates from the WoWDBDefs research copies', () => {
    const committed = readFileSync(new URL('layouts.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
    expect(committed).toBe(renderLayoutsModule(readLayoutSources(REPO_ROOT)));
  });
});
