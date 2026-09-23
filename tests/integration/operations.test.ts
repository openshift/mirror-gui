import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import { getTestApp } from './helpers/testApp.js';

const opsDir = path.join(process.env.STORAGE_DIR!, 'operations');

function seedOp(id: string, data: Record<string, unknown>) {
  return fs.promises.writeFile(path.join(opsDir, `${id}.json`), JSON.stringify(data, null, 2));
}

describe('Operations API', () => {
  let request: Awaited<ReturnType<typeof getTestApp>>;

  beforeAll(async () => {
    request = await getTestApp();
  });

  describe('GET /api/operations', () => {
    it('returns array (empty initially)', async () => {
      const res = await request.get('/api/operations');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });
  });

  describe('GET /api/operations/recent', () => {
    it('returns array', async () => {
      const res = await request.get('/api/operations/recent');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });
  });

  describe('GET /api/stats', () => {
    it('returns zeroed stats initially', async () => {
      const res = await request.get('/api/stats');
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        totalOperations: expect.any(Number),
        successfulOperations: expect.any(Number),
        failedOperations: expect.any(Number),
        runningOperations: expect.any(Number),
      });
    });
  });

  describe('POST /api/operations/start', () => {
    it('returns 404 for non-existent config', async () => {
      const res = await request.post('/api/operations/start').send({
        configFile: 'nonexistent.yaml',
      });
      expect(res.status).toBe(404);
      expect(res.body.error).toContain('not found');
    });

    it('rejects path traversal in mirrorDestinationSubdir', async () => {
      await request.post('/api/config/save').send({
        config: 'kind: ImageSetConfiguration\napiVersion: mirror.openshift.io/v2alpha1\nmirror:\n  platform: {}\n  operators: []\n  additionalImages: []',
        name: 'ops-test-config.yaml',
      });
      const res = await request.post('/api/operations/start').send({
        configFile: 'ops-test-config.yaml',
        mirrorDestinationSubdir: '../evil',
      });
      expect(res.status).toBe(400);
      expect(res.body.error).toBeDefined();
    });

    it('rejects invalid characters in mirrorDestinationSubdir', async () => {
      const res = await request.post('/api/operations/start').send({
        configFile: 'ops-test-config.yaml',
        mirrorDestinationSubdir: 'bad@name!',
      });
      expect(res.status).toBe(400);
      expect(res.body.error).toBeDefined();
    });

    it('rejects unknown optionalFlags keys', async () => {
      const res = await request.post('/api/operations/start').send({
        configFile: 'ops-test-config.yaml',
        optionalFlags: { unknownFlag: true },
      });
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Unknown optional flag');
    });

    it('rejects invalid imageTimeout format', async () => {
      const res = await request.post('/api/operations/start').send({
        configFile: 'ops-test-config.yaml',
        optionalFlags: { imageTimeout: '10minutes' },
      });
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('imageTimeout');
    });

    it('rejects zero imageTimeout duration', async () => {
      const res = await request.post('/api/operations/start').send({
        configFile: 'ops-test-config.yaml',
        optionalFlags: { imageTimeout: '0s' },
      });
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('greater than 0');
    });

    it('rejects non-integer retryTimes', async () => {
      const res = await request.post('/api/operations/start').send({
        configFile: 'ops-test-config.yaml',
        optionalFlags: { retryTimes: 1.5 },
      });
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('retryTimes');
    });

    it('rejects retryTimes outside the safe integer range', async () => {
      const res = await request.post('/api/operations/start').send({
        configFile: 'ops-test-config.yaml',
        optionalFlags: { retryTimes: Number.MAX_SAFE_INTEGER + 1 },
      });
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('retryTimes');
    });

    it('rejects non-boolean dryRun', async () => {
      const res = await request.post('/api/operations/start').send({
        configFile: 'ops-test-config.yaml',
        optionalFlags: { dryRun: 'yes' },
      });
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('dryRun');
    });
  });

  describe('DELETE /api/operations/:id', () => {
    it('returns success for any id', async () => {
      const res = await request.delete(
        '/api/operations/00000000-0000-0000-0000-000000000000'
      );
      expect(res.status).toBe(200);
      expect(res.body.message).toContain('success');
    });
  });

  describe('operation file resilience', () => {
    const goodId = 'test-good-op';
    const corruptId = 'test-corrupt-op';
    const rtId = 'test-roundtrip-op';

    beforeAll(async () => {
      await seedOp(goodId, {
        id: goodId, name: 'Good Op', configFile: 'good.yaml',
        status: 'success', startedAt: new Date().toISOString(), logs: ['done'],
      });
      await fs.promises.writeFile(
        path.join(opsDir, `${corruptId}.json`), '{"id":"corrupt","name":"Trun',
      );
    });

    it('one corrupt file does not empty GET /api/operations', async () => {
      const res = await request.get('/api/operations');
      expect(res.status).toBe(200);
      const good = res.body.find((o: { id: string }) => o.id === goodId);
      expect(good).toBeTruthy();
      expect(good.configFile).toBe('good.yaml');
    });

    it('save and update round-trip preserves all fields', async () => {
      await seedOp(rtId, {
        id: rtId, name: 'RT Op', configFile: 'rt.yaml',
        status: 'running', startedAt: new Date().toISOString(), logs: [],
      });

      const saved = (await request.get('/api/operations')).body
        .find((o: { id: string }) => o.id === rtId);
      expect(saved).toMatchObject({ id: rtId, configFile: 'rt.yaml', status: 'running' });

      await request.post(`/api/operations/${rtId}/stop`);

      const updated = (await request.get('/api/operations')).body
        .find((o: { id: string }) => o.id === rtId);
      expect(updated).toMatchObject({ configFile: 'rt.yaml', status: 'stopped' });

      await request.delete(`/api/operations/${rtId}`);
    });
  });
});
