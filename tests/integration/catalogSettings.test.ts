import fs from 'fs';
import path from 'path';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getTestApp } from './helpers/testApp.js';
import { __routeTestHooks } from '../../server/index.js';

const DATAPOWER_URL = 'icr.io/cpopen/datapower-operator-catalog:latest';
const ALL_VERSIONS = ['4.16', '4.17', '4.18', '4.19', '4.20', '4.21', '4.22'];

describe('Catalog settings API', () => {
  let request: Awaited<ReturnType<typeof getTestApp>>;
  const runtimeDir = () => path.join(process.env.STORAGE_DIR!, 'catalog-data');

  beforeAll(async () => {
    request = await getTestApp();
  });

  afterAll(async () => {
    __routeTestHooks.forceSyncRunning = false;
    await request
      .put('/api/catalogs/settings')
      .send({ enabledOcpVersions: ALL_VERSIONS, externalCatalogs: [] });
  });

  it('GET returns all supported versions enabled and no externals by default', async () => {
    const res = await request.get('/api/catalogs/settings');
    expect(res.status).toBe(200);
    expect(res.body.supportedOcpVersions).toEqual(ALL_VERSIONS);
    expect(res.body.enabledOcpVersions).toEqual(ALL_VERSIONS);
    expect(res.body.externalCatalogs).toEqual([]);
  });

  it('PUT persists versions and an external catalog, visible through GET', async () => {
    const put = await request.put('/api/catalogs/settings').send({
      enabledOcpVersions: ['4.20', '4.21'],
      externalCatalogs: [{ url: DATAPOWER_URL }],
    });
    expect(put.status).toBe(200);

    const get = await request.get('/api/catalogs/settings');
    expect(get.body.enabledOcpVersions).toEqual(['4.20', '4.21']);
    expect(get.body.externalCatalogs).toEqual([
      { url: DATAPOWER_URL, name: 'datapower-operator-catalog', tag: 'latest' },
    ]);
  });

  it('PUT with no enabled versions returns 400 and leaves the previous state', async () => {
    const before = (await request.get('/api/catalogs/settings')).body;
    const res = await request
      .put('/api/catalogs/settings')
      .send({ enabledOcpVersions: [], externalCatalogs: [] });
    expect(res.status).toBe(400);
    expect(res.body.error).toBeTruthy();
    const after = (await request.get('/api/catalogs/settings')).body;
    expect(after).toEqual(before);
  });

  it('PUT with an option-flag URL returns 400', async () => {
    const res = await request.put('/api/catalogs/settings').send({
      enabledOcpVersions: ['4.21'],
      externalCatalogs: [{ url: '--registry-config=x' }],
    });
    expect(res.status).toBe(400);
  });

  it('PUT returns 409 while a sync is running', async () => {
    __routeTestHooks.forceSyncRunning = true;
    try {
      const res = await request
        .put('/api/catalogs/settings')
        .send({ enabledOcpVersions: ALL_VERSIONS, externalCatalogs: [] });
      expect(res.status).toBe(409);
      expect(res.body.error).toMatch(/sync/i);
    } finally {
      __routeTestHooks.forceSyncRunning = false;
    }
  });

  describe('source removal and version disabling', () => {
    const dataDir = () => path.join(runtimeDir(), 'datapower-operator-catalog', 'latest');
    const redhatDir = () => path.join(runtimeDir(), 'redhat-operator-index', 'v4.16');

    async function seed() {
      await fs.promises.mkdir(dataDir(), { recursive: true });
      await fs.promises.mkdir(redhatDir(), { recursive: true });
      await fs.promises.writeFile(
        path.join(runtimeDir(), 'catalog-index.json'),
        JSON.stringify({
          catalogs: [
            { catalog_type: 'redhat-operator-index', ocp_version: 'v4.16', catalog_url: 'registry.redhat.io/redhat/redhat-operator-index:v4.16' },
            { catalog_type: 'datapower-operator-catalog', ocp_version: 'latest', catalog_url: DATAPOWER_URL, source: 'external' },
          ],
        }),
      );
    }

    afterAll(async () => {
      await request.delete('/api/catalogs/sync/data');
    });

    it('disabling a version keeps every directory; removing a source deletes only its data', async () => {
      await seed();
      const withSource = {
        enabledOcpVersions: ['4.21'],
        externalCatalogs: [{ url: DATAPOWER_URL }],
      };
      expect((await request.put('/api/catalogs/settings').send(withSource)).status).toBe(200);
      expect(fs.existsSync(dataDir())).toBe(true);
      expect(fs.existsSync(redhatDir())).toBe(true);

      const removed = await request
        .put('/api/catalogs/settings')
        .send({ enabledOcpVersions: ['4.21'], externalCatalogs: [] });
      expect(removed.status).toBe(200);
      expect(fs.existsSync(path.join(runtimeDir(), 'datapower-operator-catalog'))).toBe(false);
      expect(fs.existsSync(redhatDir())).toBe(true);

      const index = JSON.parse(await fs.promises.readFile(path.join(runtimeDir(), 'catalog-index.json'), 'utf8'));
      expect(index.catalogs.map((c: { catalog_type: string }) => c.catalog_type)).toEqual(['redhat-operator-index']);
    });
  });

  describe('catalog visibility', () => {
    const fixtureDir = path.resolve(import.meta.dirname, '../fixtures/catalog-data');
    const dpDir = () => path.join(runtimeDir(), 'datapower-operator-catalog', 'latest');
    const builtinUrls = ['redhat', 'certified', 'community'].map(
      (t) => `registry.redhat.io/redhat/${t}-operator-index:v4.21`,
    );

    beforeAll(async () => {
      await fs.promises.rm(runtimeDir(), { recursive: true, force: true });
      await fs.promises.cp(fixtureDir, runtimeDir(), { recursive: true });
      await fs.promises.mkdir(dpDir(), { recursive: true });
      await fs.promises.writeFile(
        path.join(dpDir(), 'operators.json'),
        JSON.stringify([
          {
            name: 'datapower-operator',
            defaultChannel: 'v1.18-sc2',
            channels: ['v1.18-sc2'],
            catalog: 'datapower-operator-catalog',
            ocpVersion: 'latest',
          },
        ]),
      );
      const indexPath = path.join(runtimeDir(), 'catalog-index.json');
      const index = JSON.parse(await fs.promises.readFile(indexPath, 'utf8'));
      index.catalogs.push({
        catalog_type: 'datapower-operator-catalog',
        ocp_version: 'latest',
        catalog_url: DATAPOWER_URL,
        operator_count: 1,
        source: 'external',
      });
      await fs.promises.writeFile(indexPath, JSON.stringify(index));
    });

    afterAll(async () => {
      await request.delete('/api/catalogs/sync/data');
    });

    const put = (enabledOcpVersions: string[], withDataPower: boolean) =>
      request.put('/api/catalogs/settings').send({
        enabledOcpVersions,
        externalCatalogs: withDataPower ? [{ url: DATAPOWER_URL }] : [],
      });

    it('hides an indexed external entry until it is configured', async () => {
      await put(ALL_VERSIONS, false);
      const res = await request.get('/api/catalogs');
      expect(res.body.map((c: { url: string }) => c.url)).not.toContain(DATAPOWER_URL);
    });

    it('lists and browses a configured external catalog', async () => {
      expect((await put(ALL_VERSIONS, true)).status).toBe(200);

      const catalogs = await request.get('/api/catalogs');
      const dp = catalogs.body.find((c: { url: string }) => c.url === DATAPOWER_URL);
      expect(dp).toMatchObject({ source: 'external', name: 'datapower-operator-catalog' });
      const redhat = catalogs.body.find((c: { url: string }) => c.url === builtinUrls[0]);
      expect(redhat.source).toBe('builtin');

      const ops = await request.get('/api/operators').query({ catalog: DATAPOWER_URL });
      expect(ops.status).toBe(200);
      expect(JSON.stringify(ops.body)).toContain('datapower-operator');

      const channels = await request
        .get('/api/operator-channels/datapower-operator')
        .query({ catalogUrl: DATAPOWER_URL });
      expect(channels.status).toBe(200);
      expect(JSON.stringify(channels.body)).toContain('v1.18-sc2');
    });

    it('uses the display name as the external description', async () => {
      await request.put('/api/catalogs/settings').send({
        enabledOcpVersions: ALL_VERSIONS,
        externalCatalogs: [{ url: DATAPOWER_URL, displayName: 'IBM DataPower' }],
      });
      const catalogs = await request.get('/api/catalogs');
      const dp = catalogs.body.find((c: { url: string }) => c.url === DATAPOWER_URL);
      expect(dp.description).toBe('IBM DataPower');
      expect(dp.displayName).toBe('IBM DataPower');
    });

    it('hides built-in catalogs and channels of disabled versions but keeps data on disk', async () => {
      expect((await put(['4.20'], true)).status).toBe(200);

      const catalogs = await request.get('/api/catalogs');
      const urls = catalogs.body.map((c: { url: string }) => c.url);
      builtinUrls.forEach((u) => expect(urls).not.toContain(u));
      expect(urls).toContain(DATAPOWER_URL);

      const channels = await request.get('/api/channels');
      expect(channels.body).toEqual(['stable-4.20']);

      expect(fs.existsSync(path.join(runtimeDir(), 'redhat-operator-index', 'v4.21'))).toBe(true);
    });

    it('drops the external item once the source is removed', async () => {
      expect((await put(ALL_VERSIONS, false)).status).toBe(200);
      const catalogs = await request.get('/api/catalogs');
      expect(catalogs.body.map((c: { url: string }) => c.url)).not.toContain(DATAPOWER_URL);
    });
  });
});

