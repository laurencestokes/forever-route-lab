import { useEffect, useId, useRef } from 'react';
import { Button } from '../primitives/Button';
import { IconButton } from '../primitives/IconButton';
import { PRODUCT_NAME } from './TopBar';
import './AboutDialog.css';

/**
 * The data-licence carve-out, used verbatim in NOTICE.md, THIRD_PARTY_NOTICES.md, the README and
 * here (DATA_PROVENANCE §3.2, LIC-10). Do not reword it in one place only.
 */
export const DATA_LICENCE_CARVE_OUT =
  "GPL-3.0-or-later applies to this project's contributions and, as a posture, to Questie-derived data; it grants no rights over Blizzard content (names, text, client-derived values) or other third-party material embedded in that data.";

export const NO_WARRANTY =
  'This program is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU General Public License for more details.';

export const NON_AFFILIATION =
  `${PRODUCT_NAME} is not affiliated with or endorsed by Blizzard Entertainment, the Questie project or RestedXP. World of Warcraft is a trademark of Blizzard Entertainment, Inc.`;

/**
 * The painted map art's notice (D-033 rules 1-3; public/maps/art/NOTICE.md has the full text):
 * Blizzard Entertainment owns the artwork, the project is not affiliated with or endorsed by it,
 * the site is non-commercial, and the art is removed on request. It states facts and the project's
 * rules; it draws no legal conclusion.
 */
export const MAP_ART_NOTICE =
  'The painted world-map art shown on the map is Blizzard Entertainment’s artwork (© Blizzard Entertainment, Inc.), extracted from the World of Warcraft: Forever client. It is not this project’s work, and this project’s licence grants no rights over it. This project is not affiliated with or endorsed by Blizzard Entertainment. The site is non-commercial: no ads, paid features or sales. The art will be removed promptly if Blizzard Entertainment asks.';

/** The terrain byproducts' line (D-032; public/maps/terrain/NOTICE.md). */
export const TERRAIN_DATA_NOTICE =
  'The shaded relief, coastlines and zone outlines are computed by this project from the client’s terrain data; they are not copies of game files or of the painted art.';

/** Keep in step with the README's copyright line. */
export const DEFAULT_COPYRIGHT = 'Copyright (C) 2026 Laurence Stokes';

export const REPOSITORY_URL = 'https://github.com/laurencestokes/forever-route-lab';

export interface AboutDialogProps {
  readonly open: boolean;
  readonly onClose: () => void;
  /** App version from package.json. */
  readonly version: string;
  /** Exact source commit, injected at build (ARCHITECTURE §12.4); null in dev or unknown builds. */
  readonly sourceCommit: string | null;
  /**
   * Pinned upstream QuestieDB commit of the loaded dataset. Null when the data shown is not derived
   * from QuestieDB (the placeholder set of Milestone 1, or nothing loaded): the dialog then says the
   * data is a placeholder and leaves out the data notice link, which ships with the data.
   */
  readonly dataUpstreamCommit: string | null;
  /** The loaded dataset's `dataRevision` and frame build, shown with the data notice; null or omitted when none. */
  readonly dataIdentity?: { readonly dataRevision: string; readonly frameBuild: string } | null | undefined;
  readonly copyright?: string | undefined;
  readonly repositoryUrl?: string | undefined;
  /** Links to the notices shipped next to the app (relative to the page). */
  readonly links?: {
    readonly licence: string;
    readonly thirdPartyNotices: string;
    readonly dataNotice: string;
    /** The deployed map art notice (default `maps/art/NOTICE.md`). */
    readonly mapArtNotice?: string | undefined;
    /** The deployed terrain data notice (default `maps/terrain/NOTICE.md`). */
    readonly terrainNotice?: string | undefined;
  } | undefined;
}

const DEFAULT_LINKS = {
  licence: 'LICENSE.txt',
  thirdPartyNotices: 'third-party-notices.txt',
  dataNotice: 'data/NOTICE.md',
  mapArtNotice: 'maps/art/NOTICE.md',
  terrainNotice: 'maps/terrain/NOTICE.md',
} as const;

/**
 * About and licences: the project licence and no-warranty line, the data notice (D-016, stated
 * neutrally), the map art notice (D-033) with the terrain data line (D-032), non-affiliation, and
 * the exact source commit. A native modal <dialog>: focus moves
 * into it, Escape closes it, and focus returns to the opener.
 */
export function AboutDialog({
  open,
  onClose,
  version,
  sourceCommit,
  dataUpstreamCommit,
  dataIdentity = null,
  copyright = DEFAULT_COPYRIGHT,
  repositoryUrl = REPOSITORY_URL,
  links = DEFAULT_LINKS,
}: AboutDialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  /** Whether the current press began on the backdrop (the dialog element itself). */
  const pressOnBackdrop = useRef(false);
  const titleId = useId();
  const placeholderData = dataUpstreamCommit === null;

  useEffect(() => {
    const dialog = ref.current;
    if (dialog === null) return;
    if (open && !dialog.open) {
      if (typeof dialog.showModal === 'function') dialog.showModal();
      else dialog.setAttribute('open', '');
    } else if (!open && dialog.open) {
      if (typeof dialog.close === 'function') dialog.close();
      else dialog.removeAttribute('open');
    }
  }, [open]);

  const commit = sourceCommit === null ? null : { sha: sourceCommit, url: `${repositoryUrl}/commit/${sourceCommit}` };

  return (
    <dialog
      ref={ref}
      className="frl-about"
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClose={() => {
        if (open) onClose();
      }}
      onPointerDown={(event) => {
        pressOnBackdrop.current = event.target === event.currentTarget;
      }}
      onClick={(event) => {
        // A click on the backdrop lands on the dialog element itself. So does a text selection
        // that starts inside and ends outside (the common ancestor), which must not close it:
        // only a press that also began on the backdrop does.
        const fromBackdrop = pressOnBackdrop.current;
        pressOnBackdrop.current = false;
        if (fromBackdrop && event.target === event.currentTarget) onClose();
      }}
    >
      {open && (
        <div className="frl-about__content">
          <header className="frl-about__header">
            <h2 id={titleId} className="frl-about__title">
              About {PRODUCT_NAME}
            </h2>
            <IconButton icon="close" label="Close" onClick={onClose} />
          </header>

          <div className="frl-about__body">
            <p>
              A route planner, simulator, validator, RestedXP-format guide editor and optimisation workbench for World of
              Warcraft: Forever. It runs entirely in your browser: no accounts, no server.
            </p>

            <dl className="frl-about__facts">
              <div>
                <dt>Version</dt>
                <dd className="frl-num">{version}</dd>
              </div>
              <div>
                <dt>Source commit</dt>
                <dd>
                  {commit === null ? (
                    <span className="frl-about__muted">Not recorded in this build (injected by release builds)</span>
                  ) : (
                    <a href={commit.url} target="_blank" rel="noreferrer">
                      <code>{commit.sha.slice(0, 12)}</code>
                    </a>
                  )}
                </dd>
              </div>
              <div>
                <dt>Source code</dt>
                <dd>
                  <a href={repositoryUrl} target="_blank" rel="noreferrer">
                    {repositoryUrl.replace(/^https:\/\//, '')}
                  </a>
                </dd>
              </div>
            </dl>

            <section className="frl-about__section" aria-labelledby={`${titleId}-licence`}>
              <h3 id={`${titleId}-licence`}>Licence</h3>
              <p>
                {copyright}. This program is free software: you can redistribute it and/or modify it under the terms of the
                GNU General Public License as published by the Free Software Foundation, either version 3 of the License, or
                (at your option) any later version (<strong>GPL-3.0-or-later</strong>).
              </p>
              <p>{NO_WARRANTY}</p>
              <p>
                <a href={links.licence}>Licence text</a> · <a href={links.thirdPartyNotices}>Third-party notices</a>
              </p>
            </section>

            <section className="frl-about__section" aria-labelledby={`${titleId}-data`}>
              <h3 id={`${titleId}-data`}>Data notice</h3>
              {placeholderData ? (
                <p>
                  This build runs on <strong>placeholder data</strong>: invented quests, NPCs and zones, labelled
                  &ldquo;Placeholder&rdquo;, with no game text, XP values or objective counts. From Milestone 2, quest,
                  NPC, object, item and zone data will be derived from the Questie project&apos;s QuestieDB. Neither
                  Questie nor QuestieDB has a root licence file (none covering Questie&apos;s own code or data; Questie
                  carries licence files only for bundled third-party material). A draft in Questie&apos;s repository
                  says that, when in doubt, Questie should be considered &ldquo;all rights reserved&rdquo;. The project
                  owner chose to publish the derived data with a notice and accepts the risk. This is not a legal
                  conclusion.
                </p>
              ) : (
                <p>
                  Quest, NPC, object, item and zone data are derived from the Questie project&apos;s QuestieDB (pinned
                  commit {dataUpstreamCommit.slice(0, 12)}). Neither Questie nor QuestieDB has a root licence file
                  (none covering Questie&apos;s own code or data; Questie carries licence files only for bundled
                  third-party material). A draft in Questie&apos;s repository says that, when in doubt, Questie
                  should be considered &ldquo;all rights reserved&rdquo;. The project owner chose to publish the
                  derived data with this notice and accepts the risk. This is not a legal conclusion.
                </p>
              )}
              {!placeholderData && dataIdentity !== null && (
                <p>
                  Data revision <code>{dataIdentity.dataRevision.slice(0, 12)}</code>, data frame build{' '}
                  <span className="frl-num">{dataIdentity.frameBuild}</span>. Every file was checked against its manifest hash when it
                  loaded.
                </p>
              )}
              <p className="frl-about__carve-out">{DATA_LICENCE_CARVE_OUT}</p>
              {placeholderData ? (
                <p>The full data notice ships with the data from Milestone 2.</p>
              ) : (
                <>
                  <p>
                    Forever-specific content is not verified: every dataset quest&apos;s Forever status is unknown, and
                    Forever XP values are assumptions unless you enter observed ones.
                  </p>
                  <p>
                    <a href={links.dataNotice}>Full data notice</a>
                  </p>
                </>
              )}
            </section>

            <section className="frl-about__section" aria-labelledby={`${titleId}-art`}>
              <h3 id={`${titleId}-art`}>Map art</h3>
              <p>{MAP_ART_NOTICE}</p>
              <p>{TERRAIN_DATA_NOTICE}</p>
              <p>
                <a href={links.mapArtNotice ?? DEFAULT_LINKS.mapArtNotice}>Map art notice</a> ·{' '}
                <a href={links.terrainNotice ?? DEFAULT_LINKS.terrainNotice}>Terrain data notice</a>
              </p>
            </section>

            <section className="frl-about__section" aria-labelledby={`${titleId}-affiliation`}>
              <h3 id={`${titleId}-affiliation`}>Affiliation</h3>
              <p>{NON_AFFILIATION}</p>
            </section>
          </div>

          <footer className="frl-about__footer">
            <Button variant="primary" onClick={onClose}>
              Close
            </Button>
          </footer>
        </div>
      )}
    </dialog>
  );
}
