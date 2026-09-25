import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { loadUpstream, type UpstreamPin } from '../../questiedb/lib/upstream';
import { CONVERSION_PATH } from './constants';
import { COMMIT_SHA } from './hash';

/**
 * Which QuestieDB commit the placeholder is built from, and the SHA-256 its `conversion.json` LF
 * blob must have.
 *
 * `tools/questiedb/upstream.json` is the single pin (DATA_PROVENANCE §2, §4), read with the data
 * pipeline's own parser (`parseUpstream`), so the two tools can never disagree about its layout:
 * its `commit`, its `repository`, its `cachePath` (the default checkout) and the SHA-256 of its
 * `data/Forever/conversion.json` input. The file is required; without it, or without that input,
 * nothing is built. A `--commit` other than the pinned one is refused, because upstream.json
 * records hashes only for its own commit and the tool never trusts an input it cannot check.
 * (DATA_PROVENANCE §2 and §4.1 record the same pin and hash; the tests use them as an oracle.)
 */

export interface QuestiedbPin {
  readonly commit: string;
  readonly conversionSha256: string;
  /** upstream.json `repository`, written into the placeholder's inputs and NOTICE. */
  readonly repository: string;
  /** upstream.json `cachePath`: the default checkout, repository-relative. */
  readonly cachePath: string;
  /** upstream.json `licenceCheck.date`: when the licence finding the NOTICE states was last checked (data-F9). */
  readonly licenceCheckDate: string;
  readonly commitSource: '--commit' | 'tools/questiedb/upstream.json';
}

export const UPSTREAM_PIN_FILE = 'tools/questiedb/upstream.json';

/** The placeholder's pin from a parsed upstream.json, and an optional `--commit` that must equal it. */
export function pinFromUpstream(upstream: UpstreamPin, requestedCommit: string | null): QuestiedbPin {
  if (requestedCommit !== null && !COMMIT_SHA.test(requestedCommit)) {
    throw new Error(`--commit must be a full 40-character lowercase SHA, got "${requestedCommit}"`);
  }
  if (requestedCommit !== null && requestedCommit !== upstream.commit) {
    throw new Error(
      `no recorded SHA-256 for ${CONVERSION_PATH} at ${requestedCommit}; ${UPSTREAM_PIN_FILE} pins ${upstream.commit}. Move the pin first (DATA_PROVENANCE §12), then build`,
    );
  }
  const conversion = upstream.inputs.find((input) => input.path === CONVERSION_PATH);
  if (conversion === undefined) throw new Error(`${UPSTREAM_PIN_FILE} lists no ${CONVERSION_PATH} input, so its hash cannot be checked`);
  return {
    commit: upstream.commit,
    conversionSha256: conversion.sha256,
    repository: upstream.repository,
    cachePath: upstream.cachePath,
    licenceCheckDate: upstream.licenceCheck.date,
    commitSource: requestedCommit === null ? 'tools/questiedb/upstream.json' : '--commit',
  };
}

/** Reads `<repoRoot>/tools/questiedb/upstream.json` (required) and resolves the pin. */
export function resolvePin(repoRoot: string, requestedCommit: string | null): QuestiedbPin {
  const path = join(repoRoot, UPSTREAM_PIN_FILE);
  if (!existsSync(path)) throw new Error(`${UPSTREAM_PIN_FILE} is missing; it is the single QuestieDB pin (DATA_PROVENANCE §2)`);
  return pinFromUpstream(loadUpstream(path), requestedCommit);
}
