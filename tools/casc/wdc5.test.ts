import { describe, expect, it } from 'vitest';
import { buildMatches, layoutFromDbd } from './dbd';
import { CascError } from './errors';
import { buildWdc5, synthLayout, type SynthSection, type SynthStorage } from './test-support';
import { parseWdc5, type Wdc5Layout } from './wdc5';

const code = (fn: () => unknown): string => {
  try {
    fn();
  } catch (error) {
    if (error instanceof CascError) return error.code;
    throw error;
  }
  return 'no error';
};

// An inline-ID table in the style of WMOAreaTable: name, inline ID, inline relation, and values in
// bitpacked-signed, common-data and pallet storage.
const INLINE: Wdc5Layout = synthLayout(
  [
    { name: 'Name_lang', type: 'locstring', bits: 32, array: 1 },
    { name: 'ID', type: 'int', bits: 32, array: 1 },
    { name: 'OwnerID', type: 'uint', bits: 16, array: 1 },
    { name: 'GroupID', type: 'int', bits: 32, array: 1 },
    { name: 'AreaID', type: 'uint', bits: 16, array: 1 },
    { name: 'Parent', type: 'int', bits: 16, array: 1 },
    { name: 'Kind', type: 'uint', bits: 8, array: 1 },
  ],
  { idInline: true, relation: 'OwnerID', relationInline: true },
);
const INLINE_STORAGE: readonly SynthStorage[] = [
  { kind: 'none' },
  { kind: 'bitpacked', bits: 19, signed: 'type5' },
  { kind: 'bitpacked', bits: 15 },
  { kind: 'bitpacked', bits: 18, signed: 'type5' },
  { kind: 'common', default: 0 },
  { kind: 'common', default: 65535 },
  { kind: 'pallet', bits: 2 },
];
const inlineRow = (id: number, name: string, owner: number, group: number, area: number, parent: number, kind: number) => ({
  id,
  values: { Name_lang: name, OwnerID: owner, GroupID: group, AreaID: area, Parent: parent, Kind: kind },
});

describe('WDC5: inline IDs, bitpacked, common data and pallet', () => {
  const sections: readonly SynthSection[] = [
    {
      idList: false,
      rows: [inlineRow(15008, '', 1150, -1, 1497, -1, 3), inlineRow(28743, 'Undercity', 1150, -1, 1497, 1, 3), inlineRow(200001, 'Deep', 1150, 87344, 0, -1, 7)],
      relations: [
        [1150, 0],
        [1150, 1],
      ],
    },
  ];

  it('keys common data by the inline record ID (the m3b fix), sign-extends and narrows integers', () => {
    const { bytes } = buildWdc5(INLINE, INLINE_STORAGE, sections);
    const t = parseWdc5(bytes, INLINE);
    expect(t.rows.map((r) => r.id)).toEqual([15008, 28743, 200001]);
    const root = t.byId.get(28743);
    expect(root?.str('Name_lang')).toBe('Undercity');
    expect(root?.num('AreaID')).toBe(1497); // common data, not its default 0
    expect(root?.num('GroupID')).toBe(-1); // 18-bit signed
    expect(root?.num('Parent')).toBe(1);
    expect(t.byId.get(15008)?.num('Parent')).toBe(-1); // the u32 default 65535 of an int<16>
    expect(t.byId.get(15008)?.str('Name_lang')).toBe('');
    expect(t.byId.get(200001)?.num('GroupID')).toBe(87344);
    expect(t.byId.get(200001)?.num('AreaID')).toBe(0);
    expect(t.byId.get(200001)?.num('Kind')).toBe(7);
    expect(root?.num('ID')).toBe(28743);
    // inline relation, also in the relationship map for two of the three rows
    expect(root?.relation).toBe(1150);
    expect(t.byId.get(200001)?.relation).toBeNull();
    expect(t.byId.get(200001)?.num('OwnerID')).toBe(1150);
  });

  it('fails closed when the header ID index is not the layout ID field', () => {
    const { bytes } = buildWdc5(INLINE, INLINE_STORAGE, sections, { idIndex: 2 });
    expect(code(() => parseWdc5(bytes, INLINE))).toBe('layout');
  });

  it('reads type-1 bitpacked fields as signed when their flag says so', () => {
    const layout = synthLayout([{ name: 'V', type: 'int', bits: 32, array: 1 }]);
    const { bytes } = buildWdc5(layout, [{ kind: 'bitpacked', bits: 7, signed: 'flag' }], [{ rows: [{ id: 1, values: { V: -3 } }, { id: 2, values: { V: 60 } }] }]);
    const t = parseWdc5(bytes, layout);
    expect(t.rows.map((r) => r.num('V'))).toEqual([-3, 60]);
  });
});

// A non-inline-ID table in the style of LiquidType and UiMapArtTile: strings and string arrays,
// floats, pallet arrays, a non-inline relation and a copy table.
const LISTED: Wdc5Layout = synthLayout(
  [
    { name: 'Name', type: 'string', bits: 32, array: 1 },
    { name: 'Texture', type: 'string', bits: 32, array: 2 },
    { name: 'Scale', type: 'float', bits: 32, array: 1 },
    { name: 'Color', type: 'int', bits: 32, array: 3 },
    { name: 'Sound', type: 'uint', bits: 8, array: 1 },
    { name: 'Coeff', type: 'float', bits: 32, array: 2 },
  ],
  { relation: 'ArtID', relationInline: false },
);
const LISTED_STORAGE: readonly SynthStorage[] = [{ kind: 'none' }, { kind: 'none' }, { kind: 'none' }, { kind: 'palletArray', bits: 1 }, { kind: 'pallet', bits: 2 }, { kind: 'none' }];
const listedRow = (id: number, name: string, tex: readonly string[], scale: number, color: readonly number[], sound: number) => ({
  id,
  values: { Name: name, Texture: tex, Scale: scale, Color: color, Sound: sound, Coeff: [scale * 2, -scale] },
});

describe('WDC5: ID lists, strings across sections, pallet arrays, relations and copies', () => {
  const sections: readonly SynthSection[] = [
    {
      rows: [listedRow(1, 'Water', ['water.blp', ''], 1.5, [1, 2, 3], 0), listedRow(2, 'Ocean', ['ocean.blp', 'foam.blp'], 0.25, [1, 2, 3], 1)],
      relations: [
        [2169, 0],
        [2170, 1],
      ],
      copies: [[7, 1]],
    },
    { rows: [listedRow(3, 'Magma', ['magma.blp', 'water.blp'], -2, [-1, 0, 255], 2)], relations: [[2171, 0]], copies: [[8, 3]] },
  ];

  it('reads every value type and resolves strings through the virtual string layout', () => {
    const { bytes } = buildWdc5(LISTED, LISTED_STORAGE, sections);
    const t = parseWdc5(bytes, LISTED);
    expect(t.rows.map((r) => r.id)).toEqual([1, 2, 3, 7, 8]);
    const magma = t.byId.get(3);
    expect(magma?.str('Name')).toBe('Magma');
    expect(magma?.strs('Texture')).toEqual(['magma.blp', 'water.blp']);
    expect(t.byId.get(1)?.strs('Texture')).toEqual(['water.blp', '']);
    expect(magma?.num('Scale')).toBe(-2);
    expect(magma?.nums('Color')).toEqual([-1, 0, 255]);
    expect(magma?.num('Sound')).toBe(2);
    expect(magma?.nums('Coeff')).toEqual([-4, 2]);
    expect(t.byId.get(2)?.num('ArtID')).toBe(2170);
    expect(magma?.num('ArtID')).toBe(2171);
    expect(magma?.num('ID')).toBe(3);
    // copies keep the source's values under the new ID
    const copy = t.byId.get(8);
    expect(copy?.str('Name')).toBe('Magma');
    expect(copy?.num('ID')).toBe(8);
    expect(copy?.num('ArtID')).toBe(2171);
    expect(t.byId.get(7)?.num('Scale')).toBe(1.5);
  });

  it('refuses a wrong-type accessor or an unknown column', () => {
    const t = parseWdc5(buildWdc5(LISTED, LISTED_STORAGE, sections).bytes, LISTED);
    const row = t.byId.get(1);
    expect(code(() => row?.num('Name'))).toBe('layout');
    expect(code(() => row?.str('Scale'))).toBe('layout');
    expect(code(() => row?.nums('Scale'))).toBe('layout');
    expect(code(() => row?.num('Nope'))).toBe('layout');
  });
});

describe('WDC5: encrypted sections', () => {
  const layout = synthLayout([
    { name: 'Name', type: 'string', bits: 32, array: 1 },
    { name: 'Parent', type: 'uint', bits: 16, array: 1 },
  ]);
  const storage: readonly SynthStorage[] = [{ kind: 'none' }, { kind: 'none' }];
  const row = (id: number, name: string, parent: number) => ({ id, values: { Name: name, Parent: parent } });
  const sections: readonly SynthSection[] = [
    { rows: [row(1, 'Durotar', 0), row(2, 'Valley of Trials', 1)], copies: [[20, 2]] },
    { rows: [row(3, 'Secret', 1), row(4, 'Hidden', 3)], encrypted: true, copies: [[40, 3]] },
    { rows: [row(5, 'Orgrimmar', 0)] },
  ];

  it('skips a zero-filled section that declares a TACT key, with or without the BLTE ranges', () => {
    const { bytes, sectionSpans } = buildWdc5(layout, storage, sections);
    const span = sectionSpans[1] ?? { start: 0, end: 0 };
    for (const t of [parseWdc5(bytes, layout), parseWdc5(bytes, layout, { encryptedRanges: [span] })]) {
      expect(t.rows.map((r) => r.id)).toEqual([1, 2, 5, 20]);
      expect(t.skippedSections.map((s) => s.index)).toEqual([1]);
      // strings of the last section resolve past the skipped section's string table
      expect(t.byId.get(5)?.str('Name')).toBe('Orgrimmar');
      expect(t.byId.get(20)?.str('Name')).toBe('Valley of Trials');
    }
    expect(code(() => parseWdc5(bytes, layout, { encryptedRanges: [span], requireComplete: true }))).toBe('encrypted');
  });

  it('fails closed on partial coverage, an undeclared zero-filled section or an encrypted header', () => {
    const { bytes, sectionSpans } = buildWdc5(layout, storage, sections);
    const [s0, s1] = sectionSpans;
    if (s0 === undefined || s1 === undefined) throw new Error('spans');
    expect(code(() => parseWdc5(bytes, layout, { encryptedRanges: [{ start: s1.start, end: s1.end - 1 }] }))).toBe('encrypted');
    expect(code(() => parseWdc5(bytes, layout, { encryptedRanges: [s0, s1] }))).toBe('encrypted');
    expect(code(() => parseWdc5(bytes, layout, { encryptedRanges: [{ start: 10, end: 20 }] }))).toBe('encrypted');
  });
});

describe('WDC5: header and layout checks', () => {
  const layout = synthLayout([{ name: 'V', type: 'uint', bits: 32, array: 1 }]);
  const storage: readonly SynthStorage[] = [{ kind: 'none' }];
  const sections: readonly SynthSection[] = [{ rows: [{ id: 1, values: { V: 9 } }] }];

  it('refuses another layout hash, another field count, sparse tables and non-WDC5 files', () => {
    expect(code(() => parseWdc5(buildWdc5(layout, storage, sections, { layoutHash: '11111111' }).bytes, layout))).toBe('layout');
    const wider = synthLayout([...layout.fields, { name: 'W', type: 'uint', bits: 32, array: 1 }]);
    expect(code(() => parseWdc5(buildWdc5(layout, storage, sections).bytes, wider))).toBe('layout');
    expect(code(() => parseWdc5(buildWdc5(layout, storage, sections, { flags: 1 }).bytes, layout))).toBe('format');
    expect(code(() => parseWdc5(Buffer.alloc(300), layout))).toBe('format');
    const narrow = synthLayout([{ name: 'V', type: 'uint', bits: 16, array: 1 }]);
    expect(code(() => parseWdc5(buildWdc5(layout, storage, sections).bytes, narrow))).toBe('layout');
  });
});

describe('WoWDBDefs definition reader', () => {
  const dbd = [
    'COLUMNS',
    'int ID',
    'locstring AreaName_lang',
    'int<AreaTable::ID> ParentAreaID',
    'float Ambient_multiplier // comment',
    'int Flags',
    'int<UiMapArt::ID> UiMapArtID',
    'string Field_1_2_3_4_005?',
    '',
    'LAYOUT 11111111',
    'BUILD 1.12.1.5875-1.13.0.1',
    '$id$ID<32>',
    'AreaName_lang',
    '',
    'LAYOUT 9995B797',
    'BUILD 1.60.1.69876, 1.60.1.70009',
    'COMMENT test',
    '$noninline,id$ID<32>',
    'AreaName_lang',
    'ParentAreaID<u16>',
    'Ambient_multiplier',
    'Flags<32>[2]',
    'Field_1_2_3_4_005',
    '$noninline,relation$UiMapArtID<32>',
    '',
  ].join('\n');

  it('reads the block of a build, with types, sizes, arrays and the non-inline ID and relation', () => {
    expect(layoutFromDbd('AreaTable', dbd, '1.60.1.70009', 'test')).toEqual({
      table: 'AreaTable',
      layoutHash: '9995B797',
      id: 'ID',
      idInline: false,
      relation: 'UiMapArtID',
      relationInline: false,
      source: 'test',
      fields: [
        { name: 'AreaName_lang', type: 'locstring', bits: 32, array: 1 },
        { name: 'ParentAreaID', type: 'uint', bits: 16, array: 1 },
        { name: 'Ambient_multiplier', type: 'float', bits: 32, array: 1 },
        { name: 'Flags', type: 'int', bits: 32, array: 2 },
        { name: 'Field_1_2_3_4_005', type: 'string', bits: 32, array: 1 },
      ],
    });
    expect(layoutFromDbd('AreaTable', dbd, '1.12.9.9', 'test').idInline).toBe(true);
    expect(code(() => layoutFromDbd('AreaTable', dbd, '2.0.0.1', 'test'))).toBe('layout');
  });

  it('matches exact builds and inclusive ranges', () => {
    expect(buildMatches('1.60.1.70009', '1.60.1.70009')).toBe(true);
    expect(buildMatches('1.60.1.69876', '1.60.1.70009')).toBe(false);
    expect(buildMatches('1.12.1.5875-1.13.0.1', '1.12.1.5875')).toBe(true);
    expect(buildMatches('1.12.1.5875-1.13.0.1', '1.13.0.1')).toBe(true);
    expect(buildMatches('1.12.1.5875-1.13.0.1', '1.13.0.2')).toBe(false);
  });
});
