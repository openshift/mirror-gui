import { describe, it, expect, beforeAll } from 'vitest';
import { getTestApp } from './helpers/testApp.js';

describe('Settings API', () => {
  let request: Awaited<ReturnType<typeof getTestApp>>;

  beforeAll(async () => {
    request = await getTestApp();
  });

  describe('GET /api/settings', () => {
    it('returns default settings when no file exists', async () => {
      const res = await request.get('/api/settings');
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        maxConcurrentOperations: 1,
        logRetentionDays: 30,
        autoCleanup: true,
      });
      expect(res.body.registryCredentials).toBeDefined();
      expect(res.body.proxySettings).toBeDefined();
    });
  });

  describe('POST /api/settings', () => {
    it('saves settings and returns success', async () => {
      const res = await request.post('/api/settings').send({
        maxConcurrentOperations: 2,
        logRetentionDays: 60,
      });
      expect(res.status).toBe(200);
      expect(res.body.message).toContain('successfully');
    });
  });

  describe('POST /api/settings/test-registry', () => {
    it('returns success', async () => {
      const res = await request.post('/api/settings/test-registry').send({
        registry: 'registry.example.com',
        username: 'user',
        password: 'pass',
      });
      expect(res.status).toBe(200);
      expect(res.body.message).toContain('successful');
    });
  });

  describe('POST /api/cache/cleanup', () => {
    it('streams SSE progress events and completes', async () => {
      const res = await request.post('/api/cache/cleanup');
      expect(res.status).toBe(200);
      expect(res.text).toContain('"type":"done"');
    });
  });
});
