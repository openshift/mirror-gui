import { describe, it, expect, beforeAll } from 'vitest';
import { getTestApp } from './helpers/testApp.js';

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
});
