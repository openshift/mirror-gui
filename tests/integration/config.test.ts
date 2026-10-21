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

const validConfigObject = {
  kind: 'ImageSetConfiguration',
  apiVersion: 'mirror.openshift.io/v2alpha1',
  mirror: {
    platform: {
      channels: [{ name: 'stable-4.16', minVersion: '4.16.0', maxVersion: '4.16.3' }],
    },
    operators: [],
    additionalImages: [],
  },
};

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

    it('saves config object payload (issue #42 scenario)', async () => {
      const res = await request
        .post('/api/config/save')
        .send({ config: validConfigObject, name: 'test-config' });
      expect(res.status).toBe(200);
      expect(res.body.message).toContain('successfully');
      expect(res.body.filename).toBe('test-config.yaml');
    });

    it('appends .yaml when name has no extension', async () => {
      const res = await request
        .post('/api/config/save')
        .send({ config: validConfigYaml, name: 'no-ext' });
      expect(res.status).toBe(200);
      expect(res.body.filename).toBe('no-ext.yaml');
    });

    it('returns 400 when config is missing', async () => {
      const res = await request
        .post('/api/config/save')
        .send({ name: 'missing-config.yaml' });
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('config is required');
    });

    it('returns 400 for invalid kind', async () => {
      const res = await request.post('/api/config/save').send({
        name: 'bad-kind.yaml',
        config: {
          kind: 'NotImageSetConfiguration',
          apiVersion: 'mirror.openshift.io/v2alpha1',
          mirror: {},
        },
      });
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('ImageSetConfiguration');
    });

    it('returns 400 for invalid YAML string', async () => {
      const res = await request.post('/api/config/save').send({
        name: 'bad-yaml.yaml',
        config: 'kind: ImageSetConfiguration\n  invalid: yaml: [',
      });
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Invalid YAML');
    });

    it('returns 400 when config is not a string or object', async () => {
      const res = await request.post('/api/config/save').send({
        name: 'bad-type.yaml',
        config: 123,
      });
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('YAML string or JSON object');
    });

    it('returns 400 when name is not a string', async () => {
      const res = await request.post('/api/config/save').send({
        name: 123,
        config: validConfigYaml,
      });
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('name must be a string');
    });

    it('returns 400 for path traversal in name', async () => {
      const res = await request.post('/api/config/save').send({
        name: '../../evil',
        config: validConfigYaml,
      });
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Invalid filename');
    });

    it('preserves a custom operator catalog URL in saved YAML', async () => {
      const customCatalog = 'registry.example.com/org/custom-operator-index:v4.21';
      const config = `kind: ImageSetConfiguration
apiVersion: mirror.openshift.io/v2alpha1
mirror:
  platform: {}
  operators:
  - catalog: ${customCatalog}
    packages:
    - name: example-operator
      channels:
      - name: stable
  additionalImages: []`;

      const saveRes = await request.post('/api/config/save').send({
        config,
        name: 'custom-catalog-roundtrip.yaml',
      });
      expect(saveRes.status).toBe(200);

      const downloadRes = await request.get('/api/config/download/custom-catalog-roundtrip.yaml');
      expect(downloadRes.status).toBe(200);
      expect(downloadRes.text).toContain(customCatalog);
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
