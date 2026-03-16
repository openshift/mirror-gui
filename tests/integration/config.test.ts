import { describe, it, expect, beforeAll } from 'vitest';
import { getTestApp } from './helpers/testApp.js';

const validConfigYaml = `kind: ImageSetConfiguration
apiVersion: mirror.openshift.io/v2alpha1
mirror:
  platform:
    channels:
      - name: stable-4.21
        minVersion: "4.21.0"
        maxVersion: "4.21.4"
    graph: true
  operators: []
  additionalImages: []
`;

describe('Config API', () => {
  let request: Awaited<ReturnType<typeof getTestApp>>;

  beforeAll(async () => {
    request = await getTestApp();
  });

  describe('GET /api/config/list', () => {
    it('returns array (empty initially)', async () => {
      const res = await request.get('/api/config/list');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });
  });

  describe('POST /api/config/save', () => {
    it('saves config and returns filename', async () => {
      const res = await request
        .post('/api/config/save')
        .send({ config: validConfigYaml, name: 'test-save.yaml' });
      expect(res.status).toBe(200);
      expect(res.body.message).toContain('successfully');
      expect(res.body.filename).toBe('test-save.yaml');
    });
  });

  describe('POST /api/config/upload', () => {
    it('rejects missing kind ImageSetConfiguration', async () => {
      const res = await request.post('/api/config/upload').send({
        filename: 'bad.yaml',
        content: 'apiVersion: mirror.openshift.io/v2alpha1\nmirror: {}',
      });
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('ImageSetConfiguration');
    });

    it('rejects missing apiVersion with mirror.openshift.io', async () => {
      const res = await request.post('/api/config/upload').send({
        filename: 'bad2.yaml',
        content: 'kind: ImageSetConfiguration\napiVersion: v1\nmirror: {}',
      });
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('mirror.openshift.io');
    });

    it('rejects missing mirror section', async () => {
      const res = await request.post('/api/config/upload').send({
        filename: 'bad3.yaml',
        content:
          'kind: ImageSetConfiguration\napiVersion: mirror.openshift.io/v2alpha1\n',
      });
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('mirror');
    });

    it('rejects malformed YAML', async () => {
      const res = await request.post('/api/config/upload').send({
        filename: 'bad4.yaml',
        content: 'kind: ImageSetConfiguration\n  invalid: yaml: [',
      });
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Invalid YAML');
    });

    it('accepts valid config', async () => {
      const res = await request.post('/api/config/upload').send({
        filename: 'valid-upload.yaml',
        content: validConfigYaml,
      });
      expect(res.status).toBe(200);
      expect(res.body.filename).toBe('valid-upload.yaml');
    });

    it('returns 409 for duplicate filename', async () => {
      await request.post('/api/config/upload').send({
        filename: 'dup.yaml',
        content: validConfigYaml,
      });
      const res = await request.post('/api/config/upload').send({
        filename: 'dup.yaml',
        content: validConfigYaml,
      });
      expect(res.status).toBe(409);
      expect(res.body.error).toContain('already exists');
    });
  });

  describe('DELETE /api/config/delete/:filename', () => {
    it('returns 404 for non-existent file', async () => {
      const res = await request.delete(
        '/api/config/delete/nonexistent-file.yaml'
      );
      expect(res.status).toBe(404);
    });

    it('returns 400 for path traversal attempts', async () => {
      const res = await request.delete(
        '/api/config/delete/evil%2E%2E%2F%2E%2E%2Fetc'
      );
      expect(res.status).toBe(400);
    });

    it('deletes existing config', async () => {
      await request.post('/api/config/save').send({
        config: validConfigYaml,
        name: 'to-delete.yaml',
      });
      const res = await request.delete('/api/config/delete/to-delete.yaml');
      expect(res.status).toBe(200);
    });
  });
});
