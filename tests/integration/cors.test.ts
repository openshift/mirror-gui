import { describe, it, expect, beforeAll } from 'vitest';
import { getTestApp } from './helpers/testApp.js';

describe('same-origin API', () => {
  let request: Awaited<ReturnType<typeof getTestApp>>;

  beforeAll(async () => {
    request = await getTestApp();
  });

  it('does not grant a non-local origin access to the API', async () => {
    const res = await request
      .get('/api/health')
      .set('Origin', 'https://evil.example');

    expect(res.status).toBe(200);
    expect(res.headers['access-control-allow-origin']).not.toBe('*');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });
});
