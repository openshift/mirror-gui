import { beforeAll, describe, expect, it } from 'vitest';
import { getTestApp } from './helpers/testApp.js';
import { UI_REQUEST_HEADER } from '../uiRequestHeader.js';

describe('UI request header on empty-body POSTs', () => {
  let request: Awaited<ReturnType<typeof getTestApp>>;

  beforeAll(async () => {
    request = await getTestApp();
  });

  it('rejects empty-body POSTs without the header', async () => {
    for (const path of [
      '/api/cache/cleanup',
      '/api/catalogs/sync',
      '/api/operators/refresh-cache',
      '/api/operations/abc/stop',
    ]) {
      const res = await request.post(path);
      expect(res.status).toBe(403);
      expect(res.body).toEqual({ error: 'Missing required request header' });
    }
  });

  it('rejects case and trailing-slash variants without the header', async () => {
    for (const path of [
      '/api/cache/cleanup/',
      '/API/cache/cleanup',
      '/api/catalogs/sync/',
      '/API/catalogs/sync',
      '/api/operators/refresh-cache/',
      '/API/operators/refresh-cache',
      '/api/operations/abc/stop/',
      '/api/operations/abc/STOP',
    ]) {
      const res = await request.post(path);
      expect(res.status, path).toBe(403);
      expect(res.body).toEqual({ error: 'Missing required request header' });
    }
  });

  it('accepts cache cleanup when the header is present', async () => {
    const res = await request.post('/api/cache/cleanup/').set(UI_REQUEST_HEADER, '1');
    expect(res.status).toBe(200);
  });
});
