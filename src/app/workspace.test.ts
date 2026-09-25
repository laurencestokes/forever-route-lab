import { describe, expect, it } from 'vitest';
import { type FakeServer, fakeServer, fixtureSite, inFlight, jsonOf, nodeSha256 } from '../../tests/support/fake-fetch';
import { DatasetLoadError } from '../infra/data';
import { GeometryLoadError } from '../infra/maps';
import { datasetViewInputOf, staticDatasetSource } from './dataset-source';
import { createPlaceholderWorkspace } from './placeholder-project';
import { SAMPLE_PROJECT_NAME, SAMPLE_ROUTE_NAME, SAMPLE_ROUTE_NOTICE } from './sample-route';
import { describeLoadFailure, FrameMismatchError, loadWorkspace, pairingProblems, type WorkspaceProgress } from './workspace';

const NOW = '2026-09-25T12:00:00.000Z';
const SITE = fixtureSite();
const PLACEHOLDER = 'maps/placeholder/geometry.placeholder.json';

/** The fixture is the slice, which only tests may load (`allowSlice`). */
const start = (server = fakeServer(SITE), onProgress?: (p: WorkspaceProgress) => void, extra: Partial<Parameters<typeof loadWorkspace>[0]> = {}) =>
  loadWorkspace({ fetch: server.fetch, baseUrl: './', sha256: nodeSha256, nowIso: NOW, yieldToRender: () => Promise.resolve(), onProgress, allowSlice: true, ...extra });

interface GeometryJson {
  inputs: { 'questiedb-conversion': { commit: string; sha256: string } };
}
/** The placeholder as another deploy would have it: its conversion input edited (its hashes do not cover `inputs`). */
function otherGeometry(edit: (conversion: GeometryJson['inputs']['questiedb-conversion']) => void): string {
  const json = jsonOf(SITE, PLACEHOLDER) as GeometryJson;
  edit(json.inputs['questiedb-conversion']);
  return JSON.stringify(json);
}

const placeholderRequests = (server: FakeServer) => server.requests.filter((r) => r.url === `./${PLACEHOLDER}`).map((r) => r.cache);

describe('loadWorkspace', () => {
  it('loads the dataset and the geometry, and opens the sample project on them', async () => {
    const workspace = await start();
    expect(workspace.projectName).toBe(SAMPLE_PROJECT_NAME);
    expect(workspace.routeNotice).toBe(SAMPLE_ROUTE_NOTICE);
    expect(workspace.project.route.name).toBe(SAMPLE_ROUTE_NAME);
    expect(workspace.project.dataRevision).toBe(workspace.data.identity.dataRevision);
    expect(workspace.geometrySummary).toBe('placeholder: 49 frames @ 1.60.1.69893, 12 rows @ 1.60.1.70009; local set: none');
    expect(workspace.dataNotice).toMatch(/QuestieDB/);
    expect(workspace.report.spawnStats.points).toBe(1349);
    expect(workspace.report.geometryReloaded).toBe(false);
    // The project's own view is memoised: the app gets the same object back.
    const input = datasetViewInputOf(workspace.project);
    expect(workspace.data.view(input)).toBe(workspace.data.view(input));
    const accept = workspace.project.route.steps.find((step) => step.kind === 'accept');
    expect(accept?.kind === 'accept' ? workspace.data.view(input).quest(accept.questId)?.name : null).toBe('Simple Parchment');
  });

  it('reports fetching, then building, then ready', async () => {
    const stages: WorkspaceProgress['stage'][] = [];
    await start(fakeServer(SITE), (p) => {
      if (stages.at(-1) !== p.stage) stages.push(p.stage);
    });
    expect(stages).toEqual(['fetching', 'building', 'ready']);
  });

  it('refuses the fixture slice unless asked to load one (code-F7)', async () => {
    const error = await start(fakeServer(SITE), undefined, { allowSlice: false }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DatasetLoadError);
    expect((error as DatasetLoadError).code).toBe('slice');
    expect(describeLoadFailure(error)).toMatchObject({ title: 'The deployed data is a test fixture, not the dataset', remedy: 'redeploy' });
  });

  it('refetches a stale geometry past the cache once, and starts when the fresh copy pairs (COORD-1)', async () => {
    const server = fakeServer(SITE);
    const stale = otherGeometry((conversion) => {
      conversion.commit = '0'.repeat(40);
    });
    // The HTTP cache still holds the previous deploy's geometry; only a reload reaches the server.
    server.route((path, init) => (path === PLACEHOLDER && init?.cache !== 'reload' ? new Response(stale) : undefined));
    const workspace = await start(server);
    expect(placeholderRequests(server)).toEqual(['no-cache', 'reload']);
    expect(workspace.report.geometryReloaded).toBe(true);
    expect(workspace.geometry.frameSource.commit).toBe('b6f5b07b0acf1c820993cbb0ce2521c912bb4c92');
  });

  it('refuses geometry and data from different QuestieDB pins, after the reload retry', async () => {
    const server = fakeServer(SITE);
    server.set(
      PLACEHOLDER,
      otherGeometry((conversion) => {
        conversion.commit = '0'.repeat(40);
      }),
    );
    const error = await start(server).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(FrameMismatchError);
    expect((error as Error).message).toMatch(/^The map geometry and the data come from different sources \(QuestieDB commit: geometry 000000000000, data b6f5b07b0acf\), also after fetching/);
    expect(placeholderRequests(server)).toEqual(['no-cache', 'reload']);
    expect(describeLoadFailure(error).remedy).toBe('redeploy');
  });

  it('refuses a geometry built from another conversion.json at the same commit (COORD-10)', async () => {
    const server = fakeServer(SITE);
    server.set(
      PLACEHOLDER,
      otherGeometry((conversion) => {
        conversion.sha256 = 'a'.repeat(64);
      }),
    );
    await expect(start(server)).rejects.toThrow(/conversion\.json SHA-256: geometry aaaaaaaaaaaa, data f4477d6c5755/);
  });

  it('fails as a whole when a data file fails its check', async () => {
    const server = fakeServer(SITE);
    server.set('data/overlays.json', null);
    await expect(start(server)).rejects.toThrow(DatasetLoadError);
  });

  it('cancels the data requests in flight when the geometry fails (code-F6)', async () => {
    const server = fakeServer(SITE);
    const pending: AbortSignal[] = [];
    let failGeometry: () => void = () => undefined;
    const geometryAnswer = new Promise<Response>((resolve) => {
      failGeometry = () => {
        resolve(new Response('Not found', { status: 404 }));
      };
    });
    server.route((path, init) => {
      if (path === PLACEHOLDER) return geometryAnswer;
      if (!path.startsWith('data/') || path === 'data/manifest.json' || init?.signal === undefined) return undefined;
      // The seven data files are downloading when the geometry's 404 arrives.
      pending.push(init.signal);
      if (pending.length === 7) failGeometry();
      return inFlight(init);
    });
    await expect(start(server)).rejects.toThrow(GeometryLoadError);
    expect(pending).toHaveLength(7);
    expect(pending.every((signal) => signal.aborted)).toBe(true);
  });

  it('cancels the geometry requests in flight when the data fails', async () => {
    const server = fakeServer(SITE);
    const pending: AbortSignal[] = [];
    server.route((path, init) => {
      if (path === 'data/manifest.json') return Promise.resolve().then(() => Promise.reject(new TypeError('Failed to fetch')));
      if (path === PLACEHOLDER && init?.signal !== undefined) {
        pending.push(init.signal);
        return inFlight(init);
      }
      return undefined;
    });
    await expect(start(server)).rejects.toThrow(DatasetLoadError);
    expect(pending).toHaveLength(1);
    expect(pending.every((signal) => signal.aborted)).toBe(true);
  });

  it('honours the caller’s signal, also when it is already aborted', async () => {
    const server = fakeServer(SITE);
    const controller = new AbortController();
    const reason = new Error('closed');
    controller.abort(reason);
    await expect(start(server, undefined, { signal: controller.signal })).rejects.toBe(reason);
    expect(server.requests).toEqual([]);
  });
});

describe('pairingProblems', () => {
  const data = { upstreamCommit: 'b6f5b07b0acf1c820993cbb0ce2521c912bb4c92', frameBuild: '1.60.1.69893', conversionSha256: 'f4477d6c'.padEnd(64, '0') };

  it('is empty when commit, frame build and conversion file agree, and names each difference', () => {
    expect(pairingProblems(data, { commit: data.upstreamCommit, build: data.frameBuild, sha256: data.conversionSha256 })).toEqual([]);
    expect(pairingProblems(data, { commit: null, build: '1.60.1.70009', sha256: null })).toEqual([
      'QuestieDB commit: geometry none recorded, data b6f5b07b0acf',
      'frame build: geometry 1.60.1.70009, data 1.60.1.69893',
      'conversion.json SHA-256: geometry none recorded, data f4477d6c0000',
    ]);
  });
});

describe('describeLoadFailure', () => {
  it('words each kind of failure and says what can fix it (code-F3)', () => {
    const integrity = describeLoadFailure(new DatasetLoadError('integrity', 'quests.json', 'data/quests.json failed its integrity check'));
    expect(integrity).toEqual({ title: 'The data files failed their integrity check', message: 'data/quests.json failed its integrity check', details: [], remedy: 'reload' });
    const format = describeLoadFailure(new DatasetLoadError('format', 'zones.json', 'bad shape', ['zones.json.areas: missing']));
    expect([format.title, format.details, format.remedy]).toEqual(['The data files are not in the expected format', ['zones.json.areas: missing'], 'redeploy']);
    // No WebCrypto is the page's context, not the deploy: the remedy says to open it over https.
    expect(describeLoadFailure(new DatasetLoadError('unsupported', null, 'no WebCrypto'))).toMatchObject({ title: 'This browser cannot verify the data', remedy: 'open-over-https' });
    expect(describeLoadFailure(new DatasetLoadError('network', 'manifest.json', 'offline')).remedy).toBe('reload');
    expect(describeLoadFailure(new DatasetLoadError('http', 'items.json', 'HTTP 503')).remedy).toBe('reload');
    expect(describeLoadFailure(new FrameMismatchError('pins differ')).remedy).toBe('redeploy');
    expect(describeLoadFailure('boom')).toEqual({ title: 'Forever Route Lab could not start', message: 'boom', details: [], remedy: 'reload' });
  });

  it('retries a geometry that could not be fetched, but not one that is malformed or fails its hashes', () => {
    expect(describeLoadFailure(new GeometryLoadError('network', 'offline'))).toMatchObject({ title: 'The map geometry could not be loaded', remedy: 'reload' });
    expect(describeLoadFailure(new GeometryLoadError('http', 'HTTP 404')).remedy).toBe('reload');
    expect(describeLoadFailure(new GeometryLoadError('format', 'bad shape', ['schema: must be 1']))).toEqual({
      title: 'The map geometry is not in the expected format',
      message: 'bad shape',
      details: ['schema: must be 1'],
      remedy: 'redeploy',
    });
    expect(describeLoadFailure(new GeometryLoadError('integrity', 'content check'))).toMatchObject({ title: 'The map geometry failed its integrity check', remedy: 'redeploy' });
    expect(describeLoadFailure(new GeometryLoadError('unsupported', 'no WebCrypto')).remedy).toBe('open-over-https');
  });
});

describe('staticDatasetSource', () => {
  it('serves one view whatever the character (the placeholder test dataset has no overlays)', () => {
    const { project, dataset } = createPlaceholderWorkspace({ nowIso: NOW });
    const source = staticDatasetSource(dataset);
    expect(source.identity).toBe(dataset.identity);
    expect(source.view(datasetViewInputOf(project))).toBe(dataset);
    expect(source.view({ ...datasetViewInputOf(project), faction: 'Alliance' })).toBe(dataset);
  });
});
