import { describe, it, expect, beforeAll } from 'vitest';
import './helpers/setup.js';
import { __routeTestHooks } from '../../server/index.js';
import { getTestApp } from './helpers/testApp.js';

describe('Catalogs API', () => {
  let request: Awaited<ReturnType<typeof getTestApp>>;

  beforeAll(async () => {
    request = await getTestApp();
  });

  describe('GET /api/catalogs', () => {
    it('returns catalogs from prefetched data with operator counts', async () => {
      const res = await request.get('/api/catalogs');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThanOrEqual(3);

      const names = res.body.map((c: { name: string }) => c.name);
      expect(names).toContain('redhat-operator-index');
      expect(names).toContain('certified-operator-index');
      expect(names).toContain('community-operator-index');

      res.body.forEach(
        (catalog: {
          name: string;
          url: string;
          description: string;
          operatorCount: number;
          digest: string | null;
          syncedAt: string | null;
        }) => {
          expect(catalog).toHaveProperty('name');
          expect(catalog).toHaveProperty('url');
          expect(catalog).toHaveProperty('description');
          expect(typeof catalog.operatorCount).toBe('number');
          expect(catalog.operatorCount).toBeGreaterThanOrEqual(1);
          expect(catalog).toHaveProperty('digest');
          expect(catalog).toHaveProperty('syncedAt');
          const d = catalog.digest;
          const s = catalog.syncedAt;
          expect(d === null || typeof d === 'string').toBe(true);
          expect(s === null || typeof s === 'string').toBe(true);
        }
      );
    });

    it('returns 500 when the catalogs route handler fails', async () => {
      __routeTestHooks.failNextCatalogsGet = true;
      const res = await request.get('/api/catalogs');
      expect(res.status).toBe(500);
      expect(res.body).toHaveProperty('error');
      expect(String(res.body.error)).toMatch(/Failed to get catalogs/i);
    });
  });
});
