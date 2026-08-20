import { describe, it, expect, beforeAll } from 'vitest';
import { __routeTestHooks } from '../../server/index.js';
import { getTestApp } from './helpers/testApp.js';

describe('Operators API', () => {
  let request: Awaited<ReturnType<typeof getTestApp>>;

  beforeAll(async () => {
    request = await getTestApp();
  });

  describe('GET /api/operators', () => {
    it('returns operator names from prefetched data', async () => {
      const res = await request.get('/api/operators');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body).toContain('advanced-cluster-management');
      expect(res.body).toContain('openshift-pipelines-operator-rh');
    });

    it('returns operators for a specific catalog', async () => {
      const res = await request.get('/api/operators').query({
        catalog: 'registry.redhat.io/redhat/redhat-operator-index:v4.21',
      });
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body).toContain('advanced-cluster-management');
      expect(res.body).toContain('odf-operator');
    });

    it('returns detailed operators with channels', async () => {
      const res = await request.get('/api/operators').query({
        catalog: 'registry.redhat.io/redhat/redhat-operator-index:v4.21',
        detailed: 'true',
      });
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);

      const acm = res.body.find((op: { name: string }) => op.name === 'advanced-cluster-management');
      expect(acm).toBeDefined();
      expect(acm.defaultChannel).toBe('release-2.17');
      expect(acm.allChannels).toContain('release-2.15');
      expect(acm.allChannels).toContain('release-2.16');
    });

    it('returns 500 when the operators route handler fails (no catalog filter)', async () => {
      __routeTestHooks.failNextOperatorsGet = true;
      const res = await request.get('/api/operators');
      expect(res.status).toBe(500);
      expect(res.body).toHaveProperty('error');
      expect(String(res.body.error)).toMatch(/Failed to get operators/i);
    });
  });

  describe('POST /api/operators/refresh-cache', () => {
    it('returns success', async () => {
      const res = await request.post('/api/operators/refresh-cache');
      expect(res.status).toBe(200);
      expect(res.body.message).toContain('refreshed');
    });
  });

  describe('GET /api/operators/:operator/versions', () => {
    it('returns versions for a known operator', async () => {
      const res = await request.get('/api/operators/advanced-cluster-management/versions').query({
        catalog: 'registry.redhat.io/redhat/redhat-operator-index:v4.21',
      });
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('versions');
      expect(res.body.versions).toContain('2.16.0');
    });

    it('returns versions filtered by channel', async () => {
      const res = await request.get('/api/operators/advanced-cluster-management/versions').query({
        catalog: 'registry.redhat.io/redhat/redhat-operator-index:v4.21',
        channel: 'release-2.15',
      });
      expect(res.status).toBe(200);
      expect(res.body.versions).toContain('2.15.0');
      expect(res.body.versions).toContain('2.15.1');
    });

    it('returns 404 for nonexistent operator', async () => {
      const res = await request.get('/api/operators/nonexistent-operator-xyz/versions');
      expect(res.status).toBe(404);
      expect(res.body.error).toContain('not found');
    });
  });

  describe('GET /api/operator-channels/:operator', () => {
    it('returns channels for a known operator', async () => {
      const res = await request.get('/api/operator-channels/advanced-cluster-management');
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('channels');
      expect(res.body.channels.length).toBeGreaterThanOrEqual(1);
      expect(res.body).toHaveProperty('name', 'advanced-cluster-management');
      expect(res.body).toHaveProperty('defaultChannel');
      res.body.channels.forEach((ch: { name: string }) => {
        expect(typeof ch.name).toBe('string');
        expect(ch.name.length).toBeGreaterThan(0);
      });
    });

    it('returns 404 for nonexistent operator', async () => {
      const res = await request.get('/api/operator-channels/nonexistent-operator-xyz');
      expect(res.status).toBe(404);
    });
  });

  describe('GET /api/operators/channels', () => {
    it('returns 400 when catalogUrl and operatorName are missing', async () => {
      const res = await request.get('/api/operators/channels');
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('required');
    });

    it('returns 400 when only catalogUrl is provided', async () => {
      const res = await request.get('/api/operators/channels').query({
        catalogUrl: 'registry.redhat.io/redhat/redhat-operator-index:v4.21',
      });
      expect(res.status).toBe(400);
    });

    it('returns 400 when only operatorName is provided', async () => {
      const res = await request.get('/api/operators/channels').query({
        operatorName: 'some-operator',
      });
      expect(res.status).toBe(400);
    });
  });

  describe('GET /api/operators/:operator/dependencies', () => {
    it('returns dependencies for odf-operator from fixture', async () => {
      const res = await request.get('/api/operators/odf-operator/dependencies').query({
        catalogUrl: 'registry.redhat.io/redhat/redhat-operator-index:v4.21',
      });
      expect(res.status).toBe(200);
      expect(res.body.operator).toBe('odf-operator');
      expect(res.body.dependencies.length).toBeGreaterThanOrEqual(1);
      const depNames = res.body.dependencies.map((d: { packageName: string }) => d.packageName);
      expect(depNames).toContain('mcg-operator');
    });

    it('returns empty dependencies for unknown operator', async () => {
      const res = await request.get('/api/operators/nonexistent-operator-xyz/dependencies');
      expect(res.status).toBe(200);
      expect(res.body.dependencies).toEqual([]);
      expect(res.body.message).toContain('No dependencies');
    });
  });
});
