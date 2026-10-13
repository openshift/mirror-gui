import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { getTestApp } from './helpers/testApp.js';

const opsDir = path.join(process.env.STORAGE_DIR!, 'operations');

function seedOp(id: string, data: Record<string, unknown>) {
  return fs.promises.writeFile(path.join(opsDir, `${id}.json`), JSON.stringify(data, null, 2));
}

describe('Operations API', () => {
  let request: Awaited<ReturnType<typeof getTestApp>>;

  beforeAll(async () => {
    request = await getTestApp();
  });

  describe('GET /api/operations', () => {
    it('returns array (empty initially)', async () => {
      const res = await request.get('/api/operations');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });
  });

  describe('GET /api/operations/recent', () => {
    it('returns array', async () => {
      const res = await request.get('/api/operations/recent');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });
  });

  describe('GET /api/stats', () => {
    it('returns zeroed stats initially', async () => {
      const res = await request.get('/api/stats');
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        totalOperations: expect.any(Number),
        successfulOperations: expect.any(Number),
        failedOperations: expect.any(Number),
        runningOperations: expect.any(Number),
      });
    });
  });

  describe('POST /api/operations/start', () => {
    it('returns 404 for non-existent config', async () => {
      const res = await request.post('/api/operations/start').send({
        configFile: 'nonexistent.yaml',
      });
      expect(res.status).toBe(404);
      expect(res.body.error).toContain('not found');
    });

    it('rejects path traversal in mirrorDestinationSubdir', async () => {
      await request.post('/api/config/save').send({
        config: 'kind: ImageSetConfiguration\napiVersion: mirror.openshift.io/v2alpha1\nmirror:\n  platform: {}\n  operators: []\n  additionalImages: []',
        name: 'ops-test-config.yaml',
      });
      const res = await request.post('/api/operations/start').send({
        configFile: 'ops-test-config.yaml',
        mirrorDestinationSubdir: '../evil',
      });
      expect(res.status).toBe(400);
      expect(res.body.error).toBeDefined();
    });

    it('rejects invalid characters in mirrorDestinationSubdir', async () => {
      const res = await request.post('/api/operations/start').send({
        configFile: 'ops-test-config.yaml',
        mirrorDestinationSubdir: 'bad@name!',
      });
      expect(res.status).toBe(400);
      expect(res.body.error).toBeDefined();
    });

    it('rejects unknown optionalFlags keys', async () => {
      const res = await request.post('/api/operations/start').send({
        configFile: 'ops-test-config.yaml',
        optionalFlags: { unknownFlag: true },
      });
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Unknown optional flag');
    });

    it('rejects invalid imageTimeout format', async () => {
      const res = await request.post('/api/operations/start').send({
        configFile: 'ops-test-config.yaml',
        optionalFlags: { imageTimeout: '10minutes' },
      });
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('imageTimeout');
    });

    it('rejects zero imageTimeout duration', async () => {
      const res = await request.post('/api/operations/start').send({
        configFile: 'ops-test-config.yaml',
        optionalFlags: { imageTimeout: '0s' },
      });
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('greater than 0');
    });

    it('rejects non-integer retryTimes', async () => {
      const res = await request.post('/api/operations/start').send({
        configFile: 'ops-test-config.yaml',
        optionalFlags: { retryTimes: 1.5 },
      });
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('retryTimes');
    });

    it('rejects retryTimes outside the safe integer range', async () => {
      const res = await request.post('/api/operations/start').send({
        configFile: 'ops-test-config.yaml',
        optionalFlags: { retryTimes: Number.MAX_SAFE_INTEGER + 1 },
      });
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('retryTimes');
    });
  });

  describe('DELETE /api/operations/:id', () => {
    it('returns success for any id', async () => {
      const res = await request.delete(
        '/api/operations/00000000-0000-0000-0000-000000000000'
      );
      expect(res.status).toBe(200);
      expect(res.body.message).toContain('success');
    });

    it('stops a running oc-mirror child when deleting the operation', async () => {
      const pidFile = path.join(os.tmpdir(), `oc-mirror-pid-${Date.now()}.txt`);
      await fs.promises.rm(pidFile, { force: true });

      const fakeDir = path.join(os.tmpdir(), `oc-mirror-delete-${Date.now()}`);
      await fs.promises.mkdir(fakeDir, { recursive: true });
      const fakeScript = path.join(fakeDir, 'oc-mirror');
      await fs.promises.writeFile(
        fakeScript,
        [
          '#!/bin/sh',
          `pid_file="${pidFile}"`,
          'echo $$ > "$pid_file"',
          'trap \'rm -f "$pid_file"; exit 143\' TERM',
          'trap \'rm -f "$pid_file"; exit 137\' INT',
          'while true; do sleep 1; done',
          '',
        ].join('\n'),
      );
      await fs.promises.chmod(fakeScript, 0o755);

      const prevPath = process.env.PATH || '';
      process.env.PATH = `${fakeDir}:${prevPath}`;

      try {
        const configRes = await request.post('/api/config/save').send({
          config:
            'kind: ImageSetConfiguration\napiVersion: mirror.openshift.io/v2alpha1\nmirror:\n  platform: {}\n  operators: []\n  additionalImages: []',
          name: 'delete-running-config.yaml',
        });
        expect(configRes.status).toBe(200);

        const startRes = await request.post('/api/operations/start').send({
          configFile: 'delete-running-config.yaml',
        });
        expect(startRes.status).toBe(200);
        const operationId = startRes.body.operationId as string;

        let pid = '';
        for (let attempt = 0; attempt < 30; attempt += 1) {
          try {
            pid = (await fs.promises.readFile(pidFile, 'utf8')).trim();
            if (pid) break;
          } catch {
            // child may not have started yet
          }
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
        expect(pid).not.toBe('');

        const deleteRes = await request.delete(`/api/operations/${operationId}`);
        expect(deleteRes.status).toBe(200);

        for (let attempt = 0; attempt < 40; attempt += 1) {
          try {
            process.kill(Number(pid), 0);
            await new Promise((resolve) => setTimeout(resolve, 50));
          } catch {
            return;
          }
        }

        expect.fail('oc-mirror child was still running after DELETE');
      } finally {
        process.env.PATH = prevPath;
        await fs.promises.rm(fakeDir, { recursive: true, force: true });
        await fs.promises.rm(pidFile, { force: true });
      }
    });
  });

  describe('operation file resilience', () => {
    const goodId = 'test-good-op';
    const corruptId = 'test-corrupt-op';
    const rtId = 'test-roundtrip-op';

    beforeAll(async () => {
      await seedOp(goodId, {
        id: goodId, name: 'Good Op', configFile: 'good.yaml',
        status: 'success', startedAt: new Date().toISOString(), logs: ['done'],
      });
      await fs.promises.writeFile(
        path.join(opsDir, `${corruptId}.json`), '{"id":"corrupt","name":"Trun',
      );
    });

    it('one corrupt file does not empty GET /api/operations', async () => {
      const res = await request.get('/api/operations');
      expect(res.status).toBe(200);
      const good = res.body.find((o: { id: string }) => o.id === goodId);
      expect(good).toBeTruthy();
      expect(good.configFile).toBe('good.yaml');
    });

    it('save and update round-trip preserves all fields', async () => {
      await seedOp(rtId, {
        id: rtId, name: 'RT Op', configFile: 'rt.yaml',
        status: 'running', startedAt: new Date().toISOString(), logs: [],
      });

      const saved = (await request.get('/api/operations')).body
        .find((o: { id: string }) => o.id === rtId);
      expect(saved).toMatchObject({ id: rtId, configFile: 'rt.yaml', status: 'running' });

      await request.post(`/api/operations/${rtId}/stop`);

      const updated = (await request.get('/api/operations')).body
        .find((o: { id: string }) => o.id === rtId);
      expect(updated).toMatchObject({ configFile: 'rt.yaml', status: 'stopped' });

      await request.delete(`/api/operations/${rtId}`);
    });
  });
});
