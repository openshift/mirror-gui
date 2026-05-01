import { describe, it, expect, beforeAll } from 'vitest';
import { getTestApp } from './helpers/testApp.js';

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
      const res = await request.post('/api/cache/cleanup');
      expect(res.status).toBe(200);
      expect(res.body.message).toContain('success');
    });
  });
});
