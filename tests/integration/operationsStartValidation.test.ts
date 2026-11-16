import { describe, it, expect, beforeAll } from 'vitest';
import { getTestApp } from './helpers/testApp.js';

// POST /api/operations/start must reject a missing or unsafe configFile with 400,
// instead of failing inside path.join() with a 500.
describe('POST /api/operations/start configFile validation', () => {
  let request: Awaited<ReturnType<typeof getTestApp>>;

  beforeAll(async () => {
    request = await getTestApp();
  });

  it('returns 400 when configFile is missing', async () => {
    const res = await request.post('/api/operations/start').send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('configFile is required');
  });

  it('returns 400 when only the old documented configId field is sent', async () => {
    const res = await request.post('/api/operations/start').send({
      name: 'Operation Name',
      configId: 'my-config.yaml',
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('configFile is required');
  });

  it('returns 400 when configFile is not a string', async () => {
    const res = await request.post('/api/operations/start').send({ configFile: 42 });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('configFile is required');
  });

  it('returns 400 when configFile contains a path', async () => {
    const res = await request.post('/api/operations/start').send({
      configFile: '../operations/some-op.yaml',
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('without path separators');
  });

  it('returns 400 when configFile is not a YAML file name', async () => {
    const res = await request.post('/api/operations/start').send({ configFile: 'notes.txt' });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('.yaml or .yml');
  });

  it('still returns 404 for a valid but unknown configFile', async () => {
    const res = await request.post('/api/operations/start').send({
      configFile: 'does-not-exist-7c1e.yaml',
    });
    expect(res.status).toBe(404);
  });
});
