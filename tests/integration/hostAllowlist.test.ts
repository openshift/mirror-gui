import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { getTestApp } from './helpers/testApp.js';

describe('Host allow-list', () => {
  let request: Awaited<ReturnType<typeof getTestApp>>;
  const previousAllowedHosts = process.env.ALLOWED_HOSTS;

  beforeAll(async () => {
    request = await getTestApp();
  });

  afterEach(() => {
    if (previousAllowedHosts === undefined) {
      delete process.env.ALLOWED_HOSTS;
    } else {
      process.env.ALLOWED_HOSTS = previousAllowedHosts;
    }
  });

  it('rejects an attacker-controlled host on health and pull-secret content', async () => {
    for (const path of ['/api/health', '/api/pull-secret/content']) {
      const res = await request.get(path).set('Host', 'evil.example:3000');
      expect(res.status).toBe(403);
      expect(res.body).toEqual({ error: 'Host is not allowed' });
    }
  });

  it('accepts local host headers', async () => {
    for (const host of ['localhost:3000', '127.0.0.1:3001', '[::1]:31991']) {
      const res = await request.get('/api/health').set('Host', host);
      expect(res.status).toBe(200);
    }
  });

  it('accepts a hostname listed in ALLOWED_HOSTS', async () => {
    process.env.ALLOWED_HOSTS = '172.17.10.100, files.example';
    const res = await request.get('/api/pull-secret/content').set('Host', '172.17.10.100:3000');
    expect(res.status).toBe(200);
  });
});
