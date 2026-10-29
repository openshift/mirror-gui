import { describe, it, expect, beforeAll } from 'vitest';
import { getTestApp } from './helpers/testApp.js';
import { UI_REQUEST_HEADER } from '../uiRequestHeader.js';

describe('Settings API', () => {
  let request: Awaited<ReturnType<typeof getTestApp>>;

  beforeAll(async () => {
    request = await getTestApp();
  });

  describe('GET /api/registries', () => {
    it('returns registries array', async () => {
      const res = await request.get('/api/registries');
      expect(res.status).toBe(200);
      expect(res.body.registries).toBeDefined();
      expect(Array.isArray(res.body.registries)).toBe(true);
    });
  });

  describe('POST /api/cache/cleanup', () => {
    it('returns success', async () => {
      const res = await request.post('/api/cache/cleanup').set(UI_REQUEST_HEADER, '1');
      expect(res.status).toBe(200);
      expect(res.body.message).toContain('success');
    });
  });

  describe('POST /api/registries/verify', () => {
    it('returns 400 when registry is missing', async () => {
      const res = await request.post('/api/registries/verify').send({});
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/registry is required/i);
    });

    it('returns failed status when registry has no credentials in pull secret', async () => {
      const dummy = JSON.stringify({
        auths: { 'registry.example.com': { auth: 'dXNlcjpwYXNz' } },
      });
      await request.post('/api/pull-secret').send({ content: dummy });

      const res = await request
        .post('/api/registries/verify')
        .send({ registry: 'no-such-registry.invalid.test' });

      expect(res.status).toBe(200);
      expect(res.body.registry).toBe('no-such-registry.invalid.test');
      expect(res.body.status).toBe('failed');
      expect(res.body.error).toMatch(/no credentials found/i);
    });
  });
});
