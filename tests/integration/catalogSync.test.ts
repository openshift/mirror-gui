import fs from 'fs';
import path from 'path';
import { describe, it, expect, beforeAll } from 'vitest';
import { getTestApp } from './helpers/testApp.js';
import { UI_REQUEST_HEADER } from '../uiRequestHeader.js';

const syncScriptPath = path.resolve(
  import.meta.dirname,
  '../../sync-catalogs.sh'
);
const syncScriptBackupPath = `${syncScriptPath}.vitest-moved`;

describe('Catalog sync API', () => {
  let request: Awaited<ReturnType<typeof getTestApp>>;

  beforeAll(async () => {
    request = await getTestApp();
  });

  it('GET /api/catalogs/sync/status returns idle-like state initially', async () => {
    const res = await request.get('/api/catalogs/sync/status');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('status');
    expect(['idle', 'running', 'completed', 'failed']).toContain(res.body.status);
    expect(res.body).toHaveProperty('logs');
    expect(Array.isArray(res.body.logs)).toBe(true);
    expect(res.body).toHaveProperty('hasRuntimeSyncData');
    expect(typeof res.body.hasRuntimeSyncData).toBe('boolean');
  });

  it('DELETE /api/catalogs/sync/data succeeds when no runtime sync data exists', async () => {
    const res = await request.delete('/api/catalogs/sync/data');
    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/no synced catalog data to clear/i);
  });

  it('POST /api/catalogs/sync returns 500 when sync script is missing', async () => {
    const dummy = JSON.stringify({
      auths: { 'registry.example.com': { auth: 'dXNlcjpwYXNz' } },
    });
    await request.post('/api/pull-secret').send({ content: dummy });

    let moved = false;
    try {
      await fs.promises.rename(syncScriptPath, syncScriptBackupPath);
      moved = true;

      const res = await request.post('/api/catalogs/sync').set(UI_REQUEST_HEADER, '1');
      expect(res.status).toBe(500);
      expect(res.body.error).toMatch(/sync script is missing/i);
    } finally {
      if (moved) {
        await fs.promises.rename(syncScriptBackupPath, syncScriptPath).catch(() => {
          /* restore best-effort */
        });
      }
    }
  });
});
