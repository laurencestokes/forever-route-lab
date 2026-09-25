// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DatasetLoadError, GeometryLoadError, type WorkspaceProgress } from '../app/workspace';
import { Boot } from './Boot';
import { formatMegabytes, loadingText } from './kit';

afterEach(cleanup);

/** A load the test resolves or rejects by hand, with its progress callback exposed. */
function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  let reject: (error: unknown) => void = () => undefined;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const progress = (stage: WorkspaceProgress['stage'], filesDone: number): WorkspaceProgress => ({
  stage,
  filesDone,
  filesTotal: 7,
  bytesDone: filesDone * 1_000_000,
  bytesTotal: 9_001_425,
});

describe('Boot', () => {
  it('shows the loading screen with progress, then the app', async () => {
    const run = deferred<string>();
    let report: (p: WorkspaceProgress) => void = () => undefined;
    const load = vi.fn((onProgress: (p: WorkspaceProgress) => void) => {
      report = onProgress;
      return run.promise;
    });
    render(<Boot load={load}>{(value) => <p>App ready: {value}</p>}</Boot>);
    expect(screen.getByRole('heading', { level: 1, name: 'Forever Route Lab' })).toBeTruthy();
    expect(screen.getByRole('status').textContent).toBe('Reading the data manifest…');
    act(() => {
      report(progress('fetching', 3));
    });
    expect(screen.getByRole('status').textContent).toBe('Fetching and verifying data files: 3 of 7 (3.0 MB of 9.0 MB)');
    const bar = screen.getByRole('progressbar', { name: 'Loading progress' });
    expect([bar.getAttribute('aria-valuenow'), bar.getAttribute('aria-valuemax')]).toEqual(['3', '7']);
    act(() => {
      report(progress('building', 7));
    });
    expect(screen.getByRole('status').textContent).toMatch(/^Placing quest givers/);
    expect(screen.getByRole('main').getAttribute('aria-busy')).toBe('true');
    await act(async () => {
      run.resolve('yes');
      await run.promise;
    });
    expect(screen.getByText('App ready: yes')).toBeTruthy();
    expect(screen.queryByRole('progressbar')).toBeNull();
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('shows what failed, with details, and loads again on "Try again"', async () => {
    const first = deferred<string>();
    const second = deferred<string>();
    const load = vi.fn<(onProgress: (p: WorkspaceProgress) => void) => Promise<string>>().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    render(<Boot load={load}>{(value) => <p>App ready: {value}</p>}</Boot>);
    await act(async () => {
      first.reject(new DatasetLoadError('integrity', 'quests.json', 'data/quests.json failed its integrity check.', ['sha256 mismatch']));
      await first.promise.catch(() => undefined);
    });
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('The data files failed their integrity check');
    expect(alert.textContent).toContain('data/quests.json failed its integrity check.');
    expect(alert.textContent).toContain('No data was shown, and nothing was filled in or guessed.');
    expect(screen.getByText('sha256 mismatch')).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole('heading', { level: 2 }));
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(screen.getByRole('status').textContent).toBe('Reading the data manifest…');
    await act(async () => {
      second.resolve('second');
      await second.promise;
    });
    expect(screen.getByText('App ready: second')).toBeTruthy();
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('offers no retry when trying again cannot help (a file of the wrong shape)', async () => {
    const run = deferred<string>();
    render(<Boot load={() => run.promise}>{() => <p>never</p>}</Boot>);
    await act(async () => {
      run.reject(new DatasetLoadError('format', 'zones.json', 'data/zones.json does not have the shape this version of the app reads.'));
      await run.promise.catch(() => undefined);
    });
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
    expect(screen.getByText('Trying again will not help: the deployed files need to be regenerated and redeployed.')).toBeTruthy();
  });

  it('tells a page without WebCrypto to open the site over https, not to redeploy (code-F3)', async () => {
    const run = deferred<string>();
    render(<Boot load={() => run.promise}>{() => <p>never</p>}</Boot>);
    await act(async () => {
      run.reject(new DatasetLoadError('unsupported', null, 'This browser cannot verify the data files. Open the site over https.'));
      await run.promise.catch(() => undefined);
    });
    expect(screen.getByRole('alert').textContent).toContain('This browser cannot verify the data');
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
    expect(screen.getByText(/^Trying again will not help here: open the site over https \(or on localhost\)/)).toBeTruthy();
    expect(screen.queryByText(/redeployed/)).toBeNull();
  });

  it('offers a retry for a geometry that could not be fetched, and none for a malformed one', async () => {
    const offline = deferred<string>();
    render(<Boot load={() => offline.promise}>{() => <p>never</p>}</Boot>);
    await act(async () => {
      offline.reject(new GeometryLoadError('network', 'maps/placeholder/geometry.placeholder.json could not be fetched (Failed to fetch).'));
      await offline.promise.catch(() => undefined);
    });
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
    cleanup();
    const malformed = deferred<string>();
    render(<Boot load={() => malformed.promise}>{() => <p>never</p>}</Boot>);
    await act(async () => {
      malformed.reject(new GeometryLoadError('integrity', 'maps/placeholder/geometry.placeholder.json failed its content check.'));
      await malformed.promise.catch(() => undefined);
    });
    expect(screen.getByRole('alert').textContent).toContain('The map geometry failed its integrity check');
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
  });

  it('loads once per attempt under StrictMode', async () => {
    const run = deferred<string>();
    const load = vi.fn(() => run.promise);
    render(
      <StrictMode>
        <Boot load={load}>{(value) => <p>App ready: {value}</p>}</Boot>
      </StrictMode>,
    );
    await act(async () => {
      run.resolve('strict');
      await run.promise;
    });
    expect(screen.getByText('App ready: strict')).toBeTruthy();
    expect(load).toHaveBeenCalledTimes(1);
  });
});

describe('loading texts', () => {
  it('formats sizes in decimal megabytes, truncated to one decimal', () => {
    expect(formatMegabytes(9_001_425)).toBe('9.0 MB');
    expect(formatMegabytes(4_916_369)).toBe('4.9 MB');
    expect(formatMegabytes(0)).toBe('0.0 MB');
    expect(formatMegabytes(Number.NaN)).toBe('? MB');
  });

  it('says what the load is doing', () => {
    expect(loadingText(null)).toBe('Reading the data manifest…');
    expect(loadingText(progress('fetching', 0))).toBe('Fetching and verifying data files: 0 of 7 (0.0 MB of 9.0 MB)');
  });
});
