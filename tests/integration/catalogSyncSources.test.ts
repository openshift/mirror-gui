import fs from 'fs';
import path from 'path';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';

// The server reads OC_MIRROR_WORKDIR once at import time, so the fake sync script
// must exist before ./helpers/testApp.js loads the server.
const fake = await vi.hoisted(async () => {
  const fsMod = await import('node:fs');
  const osMod = await import('node:os');
  const pathMod = await import('node:path');
  const workdir = fsMod.mkdtempSync(pathMod.join(osMod.tmpdir(), 'fake-workdir-'));
  const envOut = pathMod.join(workdir, 'sync-env.txt');
  fsMod.writeFileSync(
    pathMod.join(workdir, 'sync-catalogs.sh'),
    [
      '#!/bin/bash',
      'mkdir -p "$CATALOG_DATA_DIR"',
      '{ echo "ONLY_CATALOG=$ONLY_CATALOG"; echo "OCP_VERSIONS=$OCP_VERSIONS"; echo "EXTERNAL_CATALOGS=$EXTERNAL_CATALOGS"; } > "' + envOut + '"',
      'echo "Extracting datapower-operator-catalog latest (attempt 1)..."',
      'sleep 1',
      'echo "Completed: 0/0 catalogs successful, 0 failed"',
      '',
    ].join('\n'),
    { mode: 0o755 },
  );
  process.env.OC_MIRROR_WORKDIR = workdir;
  return { workdir, envOut };
});

import { getTestApp } from './helpers/testApp.js';

const DATAPOWER_URL = 'icr.io/cpopen/datapower-operator-catalog:latest';
const ALL_VERSIONS = ['4.16', '4.17', '4.18', '4.19', '4.20', '4.21', '4.22'];

describe('Catalog sync endpoint with settings and single sources', () => {
  let request: Awaited<ReturnType<typeof getTestApp>>;
  const runtimeDir = () => path.join(process.env.STORAGE_DIR!, 'catalog-data');

  async function waitForSyncEnd() {
    for (let i = 0; i < 100; i++) {
      const res = await request.get('/api/catalogs/sync/status');
      if (res.body.status !== 'running') return res.body;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error('sync did not finish');
  }

  const configure = (versions: string[], withDataPower: boolean) =>
    request.put('/api/catalogs/settings').send({
      enabledOcpVersions: versions,
      externalCatalogs: withDataPower ? [{ url: DATAPOWER_URL }] : [],
    });

  beforeAll(async () => {
    request = await getTestApp();
  });

  afterAll(async () => {
    await waitForSyncEnd();
    await configure(ALL_VERSIONS, false);
    await request.delete('/api/catalogs/sync/data');
    fs.rmSync(fake.workdir, { recursive: true, force: true });
  });

  it('rejects an only value that is not a configured external catalog', async () => {
    const res = await request.post('/api/catalogs/sync').send({ only: 'icr.io/not/configured:latest' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/not a configured/i);
    expect(res.body.error).not.toMatch(/pull secret/i);
  });

  it('still requires a pull secret for a full sync', async () => {
    const res = await request.post('/api/catalogs/sync');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/pull secret not configured/i);
  });

  it('syncs one external source without a pull secret and passes ONLY_CATALOG', async () => {
    expect((await configure(['4.21'], true)).status).toBe(200);

    const res = await request.post('/api/catalogs/sync').send({ only: DATAPOWER_URL });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('running');

    const status = await request.get('/api/catalogs/sync/status');
    expect(status.body.totalCount).toBe(1);
    await waitForSyncEnd();

    const env = fs.readFileSync(fake.envOut, 'utf8');
    expect(env).toContain(`ONLY_CATALOG=${DATAPOWER_URL}`);
    expect(env).toContain('OCP_VERSIONS=4.21');
    expect(env).toContain(DATAPOWER_URL);
  });

  it('seeds the runtime directory from built-in data before a single-source sync', async () => {
    await fs.promises.rm(runtimeDir(), { recursive: true, force: true });

    const res = await request.post('/api/catalogs/sync').send({ only: DATAPOWER_URL });
    expect(res.status).toBe(200);
    await waitForSyncEnd();

    const index = JSON.parse(await fs.promises.readFile(path.join(runtimeDir(), 'catalog-index.json'), 'utf8'));
    const urls = index.catalogs.map((c: { catalog_url: string }) => c.catalog_url);
    expect(urls).toContain('registry.redhat.io/redhat/redhat-operator-index:v4.21');
  });

  it('counts enabled versions x 3 plus external sources for a full sync', async () => {
    await request.post('/api/pull-secret').send({
      content: JSON.stringify({ auths: { 'registry.example.com': { auth: 'dXNlcjpwYXNz' } } }),
    });
    expect((await configure(['4.20', '4.21'], true)).status).toBe(200);

    const res = await request.post('/api/catalogs/sync');
    expect(res.status).toBe(200);
    const status = await request.get('/api/catalogs/sync/status');
    expect(status.body.totalCount).toBe(7);
    await waitForSyncEnd();

    const env = fs.readFileSync(fake.envOut, 'utf8');
    expect(env).toContain('OCP_VERSIONS=4.20,4.21');
    expect(env).toContain('ONLY_CATALOG=\n');
  });

  it('reports non-version tags such as latest as the current catalog', async () => {
    await configure(['4.21'], true);
    await request.post('/api/catalogs/sync').send({ only: DATAPOWER_URL });
    let current: string | null = null;
    for (let i = 0; i < 20 && current === null; i++) {
      current = (await request.get('/api/catalogs/sync/status')).body.currentCatalog;
      if (current === null) await new Promise((resolve) => setTimeout(resolve, 50));
    }
    expect(current).toBe('datapower-operator-catalog latest');
    await waitForSyncEnd();
  });
});
