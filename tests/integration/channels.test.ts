import { describe, it, expect, beforeAll } from 'vitest';
import { getTestApp } from './helpers/testApp.js';

describe('GET /api/channels', () => {
  let request: Awaited<ReturnType<typeof getTestApp>>;

  beforeAll(async () => {
    request = await getTestApp();
  });

  it('returns array of OCP channels from stable-4.16 to stable-4.21', async () => {
    const res = await request.get('/api/channels');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toContain('stable-4.16');
    expect(res.body).toContain('stable-4.17');
    expect(res.body).toContain('stable-4.18');
    expect(res.body).toContain('stable-4.19');
    expect(res.body).toContain('stable-4.20');
    expect(res.body).toContain('stable-4.21');
  });
});
