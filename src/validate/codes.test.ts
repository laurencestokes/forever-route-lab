import { describe, expect, it } from 'vitest';
import { formatIssueMessage, ISSUE_CODE_PATTERN, ISSUE_CODES, issueCodeSpec, isRegisteredCode, parseIssueCode, templatePlaceholders } from './codes';

/**
 * The registry (docs/SIMULATION.md §7.7-§7.8, ARCHITECTURE §9.4): one grammar, the complete code
 * list with the severities of the spec, variants tied to their rule, and templates whose
 * placeholders the rules can fill.
 */

/**
 * SIMULATION §7.7 and §7.8, plus the ARCHITECTURE §9.4 variants and SIM-22 added in Milestone 6,
 * the Milestone 6 review's DATA003, SIM005-uncertain and SIM-23 (§1.5), and D-040's
 * VAL030-objectives-carried.
 */
const EXPECTED: Readonly<Record<string, 'info' | 'warning' | 'error'>> = {
  'VAL001-already-in-log': 'error',
  'VAL002-already-completed': 'error',
  'VAL004-min-level': 'error',
  'VAL004-min-level-uncertain': 'warning',
  'VAL005-max-level': 'error',
  'VAL005-max-level-uncertain': 'warning',
  'VAL006-race': 'error',
  'VAL007-class': 'error',
  'VAL008-prequest-single': 'error',
  'VAL008-prequest-single-unverifiable': 'warning',
  'VAL009-prequest-group': 'error',
  'VAL009-prequest-group-unverifiable': 'warning',
  'VAL010-parent-not-active': 'error',
  'VAL010-parent-not-active-unverifiable': 'warning',
  'VAL011-later-chain-step': 'error',
  'VAL012-exclusive': 'error',
  'VAL013-breadcrumb-target-taken': 'error',
  'VAL013-breadcrumb-target-unavailable': 'warning',
  'VAL014-breadcrumb-active': 'error',
  'VAL015-skill': 'error',
  'VAL015-skill-unverifiable': 'info',
  'VAL016-reputation': 'error',
  'VAL016-reputation-unverifiable': 'info',
  'VAL017-spell': 'error',
  'VAL017-spell-unverifiable': 'info',
  'VAL018-availability-window': 'error',
  'VAL018-availability-window-unverifiable': 'warning',
  'VAL019-specialization': 'error',
  'VAL019-specialization-unverifiable': 'info',
  'VAL020-quest-log-full': 'error',
  'VAL021-previous-chain-active': 'warning',
  'VAL022-needs-event': 'info',
  'VAL030-not-in-log': 'error',
  'VAL030-not-in-log-unverifiable': 'warning',
  'VAL030-failed': 'error',
  'VAL030-objectives-incidental': 'warning',
  'VAL030-objectives-carried': 'warning',
  'VAL030-finisher-mismatch': 'warning',
  'VAL032-not-in-log': 'error',
  'VAL032-not-in-log-unverifiable': 'warning',
  'LINT001-prequest-both': 'warning',
  'LINT002-link-mismatch': 'warning',
  'LINT003-low-value': 'warning',
  'LINT004-xp-reduced': 'warning',
  'DATA001-custom-shadowed': 'info',
  'DATA002-unknown-quest': 'warning',
  'DATA003-unknown-objective': 'warning',
  'SIM001-unknown-xp': 'info',
  'SIM002-grind-upper-bound': 'info',
  'SIM003-unresolved-location': 'info',
  'SIM004-cross-world-no-transport': 'warning',
  'SIM005-hearth-cooldown': 'warning',
  'SIM005-hearth-cooldown-uncertain': 'warning',
  'SIM006-hearth-unbound': 'warning',
  'SIM007-flight-unknown-path': 'warning',
  'SIM008-flight-unresolved': 'warning',
  'SIM009-mount-untrained': 'warning',
  'SIM010-riding-too-low': 'warning',
  'SIM010-riding-too-low-uncertain': 'warning',
  'SIM011-target-level-late': 'warning',
  'SIM011-target-level-late-uncertain': 'warning',
  'SIM012-objective-already-done': 'info',
  'SIM013-condition-unknown': 'warning',
  'SIM014-transport-faction': 'warning',
  'SIM015-time-unknown': 'info',
  'SIM016-complete-not-in-log': 'warning',
  'SIM016-complete-not-in-log-unverifiable': 'warning',
  'SIM017-no-walking-path': 'warning',
  'SIM018-off-navmesh': 'warning',
  'SIM019-unverified-passage': 'warning',
  'SIM020-ambiguous-floor': 'warning',
  'SIM021-long-swim': 'warning',
  'SIM022-legs-pending': 'info',
  'SIM023-start-xp-beyond-level': 'warning',
};

/** Words the rules supply beside `data` (src/validate/*.ts). */
const WORDS: ReadonlySet<string> = new Set([
  'quest',
  'levelText',
  'questNames',
  'parentName',
  'nextName',
  'previousName',
  'targetName',
  'reasonText',
  'rangeText',
  'knowText',
  'windowText',
  'relatedName',
  'objectiveText',
  'viaText',
  'detailText',
  'difference',
  'lostText',
  'waitText',
  'endText',
  'durationText',
  'warnText',
  'legsText',
  'stepsText',
  'passageText',
  'nodeText',
  'workText',
]);

describe('issue-code registry', () => {
  it('is the complete list of SIMULATION §7.7-§7.8 with its severities, and nothing else', () => {
    expect(Object.fromEntries(ISSUE_CODES.map((spec) => [spec.code, spec.severity]))).toEqual(EXPECTED);
  });

  it('follows one grammar: family, three digits, slug; one family per code', () => {
    for (const spec of ISSUE_CODES) {
      expect(spec.code, spec.code).toMatch(ISSUE_CODE_PATTERN);
      const parsed = parseIssueCode(spec.code);
      expect(parsed?.family).not.toBe('RXP');
    }
    expect(parseIssueCode('VAL4-min-level')).toBeNull();
    expect(parseIssueCode('val004-min-level')).toBeNull();
    expect(parseIssueCode('VAL004-Min-Level')).toBeNull();
    expect(parseIssueCode('SIM019-unverified-passage')).toEqual({ family: 'SIM', number: 19, slug: 'unverified-passage' });
  });

  it('numbers each code after its SIMULATION rule', () => {
    for (const spec of ISSUE_CODES) {
      const parsed = parseIssueCode(spec.code);
      const rule = /^(VAL|LINT|SIM)-(\d+)$/.exec(spec.rule);
      if (rule === null) {
        expect(parsed?.family, spec.code).toBe('DATA');
        continue;
      }
      expect(parsed?.family, spec.code).toBe(rule[1]);
      expect(parsed?.number, spec.code).toBe(Number(rule[2]));
    }
  });

  it('ties every variant to its rule: same family and number, a registered base with no variant of its own', () => {
    for (const spec of ISSUE_CODES) {
      if (spec.variantOf === null) continue;
      expect(isRegisteredCode(spec.variantOf), spec.code).toBe(true);
      const base = ISSUE_CODES.find((other) => other.code === spec.variantOf);
      expect(base?.variantOf, spec.code).toBeNull();
      expect(parseIssueCode(spec.code)?.number, spec.code).toBe(parseIssueCode(spec.variantOf)?.number);
      expect(base?.rule).toBe(spec.rule);
    }
    for (const spec of ISSUE_CODES) {
      const suffix = /-(uncertain|unverifiable)$/.exec(spec.code);
      if (suffix !== null) expect(spec.variantOf, spec.code).toBe(spec.code.slice(0, -suffix[0].length));
    }
  });

  it('has templates whose placeholders are data keys or rule words, and an explanation', () => {
    for (const spec of ISSUE_CODES) {
      const params: readonly string[] = spec.params;
      expect(new Set(params).size, spec.code).toBe(params.length);
      for (const name of templatePlaceholders(spec.message)) expect(params.includes(name) || WORDS.has(name), `${spec.code} {${name}}`).toBe(true);
      expect(spec.explanation.length, spec.code).toBeGreaterThan(10);
      expect(spec.message.endsWith('.'), spec.code).toBe(true);
    }
  });

  it('writes messages and explanations as plain text: the UI shows them as they are, so no Markdown', () => {
    for (const spec of ISSUE_CODES) {
      for (const text of [spec.message, spec.explanation]) expect(text, spec.code).not.toMatch(/`|\*\*/);
    }
  });

  it('formats a message from words first, then data, and refuses a missing value', () => {
    expect(formatIssueMessage('VAL004-min-level', { requiredLevel: 12, level: 11, levelBasis: 'source', levelEraFallback: false }, { quest: 'Sarkoth (790)' })).toBe(
      'Sarkoth (790) needs level 12; the character is level 11.',
    );
    expect(formatIssueMessage('SIM004-cross-world-no-transport', { fromMapId: 1, toMapId: 0 }, null)).toBe(
      'This step moves from world map 1 to world map 0 without a transport, hearth or instance entrance; the travel time is unknown.',
    );
    expect(() => formatIssueMessage('VAL004-min-level', null, { quest: 'x' })).toThrow('no value for {requiredLevel}');
    expect(() => issueCodeSpec('VAL999-nothing' as never)).toThrow('unregistered');
  });
});
