import { TRANSCRIBES as CORRECTIONS } from './corrections';
import { TRANSCRIBES as DERIVED } from './derived';
import { TRANSCRIBES as PLAN } from './plan';
import { TRANSCRIBES as POINTS } from './points';
import { TRANSCRIBES as PROJECT } from './project';
import { TRANSCRIBES as SANDBOX } from './sandbox';
import type { UpstreamInput } from './upstream';
import { TRANSCRIBES as ZONES } from './zones';

/**
 * Upstream behaviour this tool transcribes by hand into TypeScript (DATA_PROVENANCE §4.1.2;
 * review finding data-F2). Every transcribed file is a pinned input of upstream.json (role
 * `semantics` when the tool reads nothing else from it), and the module that transcribes it names
 * the LF blob SHA-256 it was written against. When a pin bump changes such a file, upstream.json
 * gets the new hash and the module's reference no longer matches: the extraction and `validate`
 * fail until someone reviews the transcription and updates the reference.
 */

export interface Transcription {
  /** Upstream path at the pin. */
  readonly path: string;
  /** LF blob SHA-256 of the file the transcription was written against. */
  readonly sha256: string;
  /** What is transcribed, for the failure message. */
  readonly what: string;
}

export const TRANSCRIPTIONS: readonly (Transcription & { readonly module: string })[] = [
  ...PLAN.map((t) => ({ ...t, module: 'lib/plan.ts' })),
  ...CORRECTIONS.map((t) => ({ ...t, module: 'lib/corrections.ts' })),
  ...DERIVED.map((t) => ({ ...t, module: 'lib/derived.ts' })),
  ...POINTS.map((t) => ({ ...t, module: 'lib/points.ts' })),
  ...PROJECT.map((t) => ({ ...t, module: 'lib/project.ts' })),
  ...SANDBOX.map((t) => ({ ...t, module: 'lib/sandbox.ts' })),
  ...ZONES.map((t) => ({ ...t, module: 'lib/zones.ts' })),
];

/** Every mismatch between the transcription references and the pinned inputs. */
export function transcriptionProblems(inputs: readonly UpstreamInput[], transcriptions = TRANSCRIPTIONS): readonly string[] {
  const byPath = new Map(inputs.map((input) => [input.path, input]));
  const problems: string[] = [];
  for (const t of transcriptions) {
    const input = byPath.get(t.path);
    if (input === undefined) problems.push(`${t.module} transcribes ${t.path} (${t.what}), which upstream.json does not pin`);
    else if (input.sha256 !== t.sha256) {
      problems.push(
        `${t.module} transcribes ${t.path} (${t.what}) as of sha256 ${t.sha256.slice(0, 12)}…, but upstream.json pins ${input.sha256.slice(0, 12)}…: ` +
          'review the upstream change against the transcription, then update the reference',
      );
    }
  }
  const referenced = new Set(transcriptions.map((t) => t.path));
  for (const input of inputs) {
    if (input.role === 'semantics' && !referenced.has(input.path)) problems.push(`${input.path} has role "semantics" but no module names it as transcribed`);
  }
  return problems;
}

export class TranscriptionError extends Error {
  constructor(readonly problems: readonly string[]) {
    super(`transcribed upstream behaviour is out of date:\n  ${problems.join('\n  ')}`);
    this.name = 'TranscriptionError';
  }
}

/** Fails closed when a transcribed upstream file changed (or lost its pin). */
export function assertTranscriptionsCurrent(inputs: readonly UpstreamInput[]): void {
  const problems = transcriptionProblems(inputs);
  if (problems.length > 0) throw new TranscriptionError(problems);
}
