import fs from 'fs';
import path from 'path';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { getTestApp } from './helpers/testApp.js';

const ALL_VERSIONS = ['4.16', '4.17', '4.18', '4.19', '4.20', '4.21', '4.22'];
const URL_V1 = 'icr.io/cpopen/hardening-catalog:v1';
const URL_V2 = 'icr.io/cpopen/hardening-catalog:v2';
const OTHER_URL = 'icr.io/cpopen/other-catalog:latest';

describe('Catalog settings hardening', () => {
  let request: Awaited<ReturnType<typeof getTestApp>>;
  const runtimeDir = () => path.join(process.env.STORAGE_DIR!, 'catalog-data');
  const indexPath = () => path.join(runtimeDir(), 'catalog-index.json');
  const readIndex = async () => JSON.parse(await fs.promises.readFile(indexPath(), 'utf8'));
  const putSettings = (externalUrls: string[]) =>
    request.put('/api/catalogs/settings').send({
      enabledOcpVersions: ALL_VERSIONS,
      externalCatalogs: externalUrls.map((url) => ({ url })),
    });

  async function seedExternal(name: string, tag: string, url: string): Promise<void> {
    const dir = path.join(runtimeDir(), name, tag);
    await fs.promises.mkdir(dir, { recursive: true });
    await fs.promises.writeFile(path.join(dir, 'operators.json'), '[]');
    const index = await readIndex();
    index.catalogs.push({ catalog_type: name, ocp_version: tag, catalog_url: url, source: 'external' });
    await fs.promises.writeFile(indexPath(), JSON.stringify(index));
  }

  beforeAll(async () => {
    request = await getTestApp();
  });

  beforeEach(async () => {
    await putSettings([]);
    await fs.promises.rm(runtimeDir(), { recursive: true, force: true });
    await fs.promises.mkdir(runtimeDir(), { recursive: true });
    await fs.promises.writeFile(
      indexPath(),
      JSON.stringify({
        catalogs: [{ catalog_type: 'redhat-operator-index', ocp_version: 'v4.21', catalog_url: 'x', source: 'builtin' }],
      }),
    );
  });

  afterAll(async () => {
    await putSettings([]);
    await request.delete('/api/catalogs/sync/data');
  });

  it('rejects names that could clobber catalog-index.json, and keeps the index', async () => {
    const res = await putSettings(['quay.io/x/catalog-index.json:latest']);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/\.json or \.tmp/);
    expect(fs.existsSync(indexPath())).toBe(true);
  });

  it('rejects cloud metadata hosts', async () => {
    const res = await putSettings(['169.254.169.254/latest/meta:1']);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/host is not allowed/);
  });

  it('prunes the old tag directory and index entry when only the tag changes', async () => {
    expect((await putSettings([URL_V1])).status).toBe(200);
    await seedExternal('hardening-catalog', 'v1', URL_V1);

    const res = await putSettings([URL_V2]);

    expect(res.status).toBe(200);
    expect(res.body.warning).toBeNull();
    expect(fs.existsSync(path.join(runtimeDir(), 'hardening-catalog', 'v1'))).toBe(false);
    expect(fs.existsSync(path.join(runtimeDir(), 'hardening-catalog'))).toBe(false);
    const types = (await readIndex()).catalogs.map((c: { catalog_type: string }) => c.catalog_type);
    expect(types).toEqual(['redhat-operator-index']);
  });

  it('keeps data of catalogs that stay configured when another one is removed', async () => {
    expect((await putSettings([URL_V1, OTHER_URL])).status).toBe(200);
    await seedExternal('hardening-catalog', 'v1', URL_V1);
    await seedExternal('other-catalog', 'latest', OTHER_URL);

    expect((await putSettings([OTHER_URL])).status).toBe(200);

    expect(fs.existsSync(path.join(runtimeDir(), 'hardening-catalog'))).toBe(false);
    expect(fs.existsSync(path.join(runtimeDir(), 'other-catalog', 'latest', 'operators.json'))).toBe(true);
    const urls = (await readIndex()).catalogs.map((c: { catalog_url: string }) => c.catalog_url);
    expect(urls).toContain(OTHER_URL);
    expect(urls).not.toContain(URL_V1);
  });

  it('saves settings and warns (instead of failing) when the runtime index is corrupt', async () => {
    expect((await putSettings([URL_V1])).status).toBe(200);
    await seedExternal('hardening-catalog', 'v1', URL_V1);
    await fs.promises.writeFile(indexPath(), '{ not json');

    const res = await putSettings([]);

    expect(res.status).toBe(200);
    expect(res.body.externalCatalogs).toEqual([]);
    expect(res.body.warning).toMatch(/catalog-index\.json/);
    const get = await request.get('/api/catalogs/settings');
    expect(get.body.externalCatalogs).toEqual([]);
  });

  it('GET and PUT responses always include a warning field (null when healthy)', async () => {
    expect((await request.get('/api/catalogs/settings')).body.warning).toBeNull();
    expect((await putSettings([])).body.warning).toBeNull();
  });
});
