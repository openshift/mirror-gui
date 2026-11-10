import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  seedRuntimeCatalogData,
  refreshSeededCatalogData,
  markRedHatSynced,
  hasRedHatSyncData,
  builtinCatalogSyncedSince,
  readSeedMarker,
} from '../../server/catalogSeed.js';

const RH = 'redhat-operator-index';

describe('seeded runtime catalog data', () => {
  let root: string;
  let builtin: string;
  let runtime: string;

  const writeJson = (file: string, value: unknown) => fs.promises.writeFile(file, JSON.stringify(value));
  const readJson = async (file: string) => JSON.parse(await fs.promises.readFile(file, 'utf8'));

  async function writeBuiltin(version: string, operators: string[]): Promise<void> {
    await fs.promises.rm(builtin, { recursive: true, force: true });
    await fs.promises.mkdir(path.join(builtin, RH, version), { recursive: true });
    await writeJson(path.join(builtin, RH, version, 'operators.json'), operators.map((name) => ({ name })));
    await writeJson(path.join(builtin, 'catalog-index.json'), {
      ocp_versions: [version.replace('v', '')],
      catalog_types: [RH],
      catalogs: [{ catalog_type: RH, ocp_version: version, catalog_url: `r/${RH}:${version}`, source: 'builtin' }],
    });
  }

  async function addExternal(): Promise<void> {
    const dir = path.join(runtime, 'ext-catalog', 'latest');
    await fs.promises.mkdir(dir, { recursive: true });
    await writeJson(path.join(dir, 'operators.json'), [{ name: 'ext-op' }]);
    const index = await readJson(path.join(runtime, 'catalog-index.json'));
    index.catalogs.push({ catalog_type: 'ext-catalog', ocp_version: 'latest', catalog_url: 'x/ext-catalog:latest', source: 'external' });
    index.catalog_types.push('ext-catalog');
    await writeJson(path.join(runtime, 'catalog-index.json'), index);
  }

  beforeEach(async () => {
    root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'catalog-seed-'));
    builtin = path.join(root, 'builtin');
    runtime = path.join(root, 'runtime');
    await writeBuiltin('v4.21', ['old-op']);
  });

  afterEach(async () => {
    await fs.promises.rm(root, { recursive: true, force: true });
  });

  it('seeds the whole snapshot and records which snapshot it was', async () => {
    await seedRuntimeCatalogData(builtin, runtime);
    expect(fs.existsSync(path.join(runtime, RH, 'v4.21', 'operators.json'))).toBe(true);
    expect((await readSeedMarker(runtime))?.builtinHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('does nothing while the built-in snapshot is unchanged', async () => {
    await seedRuntimeCatalogData(builtin, runtime);
    expect(await refreshSeededCatalogData(builtin, runtime)).toBe('current');
  });

  it('replaces built-in catalogs with a newer snapshot but keeps external ones', async () => {
    await seedRuntimeCatalogData(builtin, runtime);
    await addExternal();
    await writeBuiltin('v4.22', ['new-op']);

    expect(await refreshSeededCatalogData(builtin, runtime)).toBe('refreshed');

    const index = await readJson(path.join(runtime, 'catalog-index.json'));
    const types = index.catalogs.map((c: { catalog_type: string; ocp_version: string }) => `${c.catalog_type}:${c.ocp_version}`).sort();
    expect(types).toEqual(['ext-catalog:latest', `${RH}:v4.22`]);
    expect(index.catalog_types).toEqual(expect.arrayContaining([RH, 'ext-catalog']));
    expect(await readJson(path.join(runtime, RH, 'v4.22', 'operators.json'))).toEqual([{ name: 'new-op' }]);
    expect(fs.existsSync(path.join(runtime, RH, 'v4.21'))).toBe(false);
    expect(await readJson(path.join(runtime, 'ext-catalog', 'latest', 'operators.json'))).toEqual([{ name: 'ext-op' }]);
    expect(await refreshSeededCatalogData(builtin, runtime)).toBe('current');
  });

  it('never overwrites Red Hat data from a full sync, even with a newer snapshot', async () => {
    await seedRuntimeCatalogData(builtin, runtime);
    await markRedHatSynced(runtime);
    await writeBuiltin('v4.22', ['new-op']);

    expect(await refreshSeededCatalogData(builtin, runtime)).toBe('skipped');
    expect(fs.existsSync(path.join(runtime, RH, 'v4.21'))).toBe(true);
    expect(fs.existsSync(path.join(runtime, RH, 'v4.22'))).toBe(false);
  });

  it('leaves a runtime directory without a marker alone, because its origin is unknown', async () => {
    await fs.promises.cp(builtin, runtime, { recursive: true });
    await writeBuiltin('v4.22', ['new-op']);
    expect(await refreshSeededCatalogData(builtin, runtime)).toBe('skipped');
  });

  it('reports Red Hat sync data only for synced or pre-marker directories, not for a plain seed', async () => {
    expect(await hasRedHatSyncData(runtime)).toBe(false);
    await seedRuntimeCatalogData(builtin, runtime);
    expect(await hasRedHatSyncData(runtime)).toBe(false);
    await markRedHatSynced(runtime);
    expect(await hasRedHatSyncData(runtime)).toBe(true);

    await fs.promises.rm(path.join(runtime, '.seed.json'));
    expect(await hasRedHatSyncData(runtime)).toBe(true);
  });

  it('counts a sync as Red Hat only when a built-in entry was synced since the start time', async () => {
    const start = '2026-11-09T12:00:00.000Z';
    const writeIndex = (catalogs: object[]) =>
      fs.promises.writeFile(path.join(runtime, 'catalog-index.json'), JSON.stringify({ catalogs }));
    await fs.promises.mkdir(runtime, { recursive: true });

    // Only an external catalog succeeded; the seeded Red Hat entry is older than the sync.
    await writeIndex([
      { catalog_type: RH, synced_at: '2026-11-01T00:00:00Z' },
      { catalog_type: 'ext', synced_at: '2026-11-09T12:05:00Z' },
    ]);
    expect(await builtinCatalogSyncedSince(runtime, start)).toBe(false);

    await writeIndex([{ catalog_type: RH, synced_at: '2026-11-09T12:05:00Z' }]);
    expect(await builtinCatalogSyncedSince(runtime, start)).toBe(true);

    await fs.promises.rm(path.join(runtime, 'catalog-index.json'));
    expect(await builtinCatalogSyncedSince(runtime, start)).toBe(false);
  });
});
