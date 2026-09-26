// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AboutDialog, DATA_LICENCE_CARVE_OUT, MAP_ART_NOTICE, TERRAIN_DATA_NOTICE } from './AboutDialog';

afterEach(cleanup);

const COMMIT = 'b6f5b07b0acf1c820993cbb0ce2521c912bb4c92';

describe('AboutDialog data notice', () => {
  it('says the data is a placeholder when no QuestieDB commit is behind it, without the notice link (F-06)', () => {
    render(<AboutDialog open onClose={vi.fn()} version="0.1.0" sourceCommit={null} dataUpstreamCommit={null} />);
    const dialog = screen.getByRole('dialog', { name: 'About Forever Route Lab' });
    const text = dialog.textContent;
    expect(text).toContain('This build runs on placeholder data');
    expect(text).toContain('From Milestone 2, quest, NPC, object, item and zone data will be derived');
    expect(text).not.toContain('data are derived from');
    expect(text).not.toContain('pinned commit');
    // The licence finding and the carve-out are stated all the same.
    expect(text).toContain("Neither Questie nor QuestieDB has a root licence file (none covering Questie's own code or data");
    expect(text).toContain('licence files only for bundled third-party material');
    expect(text).toContain(DATA_LICENCE_CARVE_OUT);
    expect(within(dialog).queryByRole('link', { name: 'Full data notice' })).toBeNull();
    expect(text).toContain('The full data notice ships with the data from Milestone 2');
  });

  it('states the derivation and links the full notice once real data is loaded', () => {
    render(<AboutDialog open onClose={vi.fn()} version="0.1.0" sourceCommit={null} dataUpstreamCommit={COMMIT} />);
    const dialog = screen.getByRole('dialog', { name: 'About Forever Route Lab' });
    expect(dialog.textContent).toContain('derived from the Questie project');
    expect(dialog.textContent).toContain('pinned commit b6f5b07b0acf');
    // M2 review data-F9: the finding covers root licence files, not Questie's third-party ones.
    expect(dialog.textContent).toContain("Neither Questie nor QuestieDB has a root licence file (none covering Questie's own code or data");
    expect(dialog.textContent).not.toContain('has published a licence file');
    expect(dialog.textContent).not.toContain('placeholder data');
    expect(within(dialog).getByRole('link', { name: 'Full data notice' }).getAttribute('href')).toBe('data/NOTICE.md');
  });
});

describe('AboutDialog map art notice (D-033)', () => {
  it.each([
    ['placeholder data', null],
    ['real data', COMMIT],
  ])('names Blizzard Entertainment as the art’s owner and links the deployed notices with %s', (_, commit) => {
    render(<AboutDialog open onClose={vi.fn()} version="0.1.0" sourceCommit={null} dataUpstreamCommit={commit} />);
    const dialog = screen.getByRole('dialog', { name: 'About Forever Route Lab' });
    const text = dialog.textContent;
    expect(text).not.toContain('No map art is included');
    expect(text).toContain(MAP_ART_NOTICE);
    expect(text).toContain(TERRAIN_DATA_NOTICE);
    // D-033: owner, non-affiliation, non-commercial, removal on request.
    expect(MAP_ART_NOTICE).toContain('Blizzard Entertainment’s artwork (© Blizzard Entertainment, Inc.)');
    expect(MAP_ART_NOTICE).toContain('not affiliated with or endorsed by Blizzard Entertainment');
    expect(MAP_ART_NOTICE).toContain('non-commercial');
    expect(MAP_ART_NOTICE).toContain('removed promptly if Blizzard Entertainment asks');
    expect(within(dialog).getByRole('heading', { name: 'Map art' })).toBeTruthy();
    expect(within(dialog).getByRole('link', { name: 'Map art notice' }).getAttribute('href')).toBe('maps/art/NOTICE.md');
    expect(within(dialog).getByRole('link', { name: 'Terrain data notice' }).getAttribute('href')).toBe('maps/terrain/NOTICE.md');
  });
});

describe('AboutDialog backdrop (F-26)', () => {
  function setup() {
    const onClose = vi.fn();
    render(<AboutDialog open onClose={onClose} version="0.1.0" sourceCommit={null} dataUpstreamCommit={null} />);
    const dialog = screen.getByRole('dialog', { name: 'About Forever Route Lab' });
    const inside = within(dialog).getByText(DATA_LICENCE_CARVE_OUT);
    return { onClose, dialog, inside };
  }

  it('closes when a press both starts and ends on the backdrop', () => {
    const { onClose, dialog } = setup();
    fireEvent.pointerDown(dialog);
    fireEvent.click(dialog);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('stays open when a text selection starts inside and is released over the backdrop', () => {
    const { onClose, dialog, inside } = setup();
    fireEvent.pointerDown(inside);
    // The browser sends the click to the common ancestor: the dialog element.
    fireEvent.click(dialog);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('stays open for a press that starts on the backdrop and ends inside', () => {
    const { onClose, dialog, inside } = setup();
    fireEvent.pointerDown(dialog);
    fireEvent.click(inside);
    expect(onClose).not.toHaveBeenCalled();
    // The recorded press is used once: a later click alone does not close.
    fireEvent.click(dialog);
    expect(onClose).not.toHaveBeenCalled();
  });
});
