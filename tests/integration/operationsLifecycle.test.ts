import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { getTestApp } from './helpers/testApp.js';
import { ensureTestDirs } from './helpers/setup.js';

describe('Operations lifecycle API', () => {
  let request: Awaited<ReturnType<typeof getTestApp>>;
  const seededOpId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
  let fakeOcMirrorDir: string;
  let origPath: string;

  beforeAll(async () => {
    await ensureTestDirs();
    request = await getTestApp();

    const storageDir = process.env.STORAGE_DIR!;
    const operationsDir = path.join(storageDir, 'operations');
    const logsDir = path.join(storageDir, 'logs');

    const operationRecord = {
      id: seededOpId,
      name: `Mirror Operation ${seededOpId.slice(0, 8)}`,
      configFile: 'lifecycle-test-config.yaml',
      mirrorDestination: path.join(storageDir, 'mirrors', 'default'),
      status: 'success' as const,
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      duration: 5,
      errorMessage: null,
      logs: ['line 1', 'line 2', '📌 images to copy 10', '✓ 3 / 3 operator images mirrored successfully'],
    };
    await fs.promises.writeFile(
      path.join(operationsDir, `${seededOpId}.json`),
      JSON.stringify(operationRecord, null, 2)
    );
    await fs.promises.writeFile(
      path.join(logsDir, `${seededOpId}.log`),
      operationRecord.logs.join('\n')
    );

    fakeOcMirrorDir = path.join(os.tmpdir(), `oc-mirror-fake-${Date.now()}`);
    await fs.promises.mkdir(fakeOcMirrorDir, { recursive: true });
    const fakeScript = path.join(fakeOcMirrorDir, 'oc-mirror');
    // Capture argv so tests can assert optional flags reach the spawned command.
    await fs.promises.writeFile(
      fakeScript,
      [
        '#!/bin/sh',
        'args_file="${OC_MIRROR_ARGS_FILE:-/tmp/oc-mirror-last-args.txt}"',
        'printf "%s\\n" "$@" > "$args_file"',
        'exit 0',
        '',
      ].join('\n'),
    );
    await fs.promises.chmod(fakeScript, 0o755);
    origPath = process.env.PATH || '';
    process.env.PATH = `${fakeOcMirrorDir}:${origPath}`;
  });

  afterAll(async () => {
    process.env.PATH = origPath;
    await fs.promises.rm(fakeOcMirrorDir, { recursive: true, force: true });
  });

  describe('POST /api/operations/start success path', () => {
    it('starts operation and returns operationId', async () => {
      const configRes = await request.post('/api/config/save').send({
        config:
          'kind: ImageSetConfiguration\napiVersion: mirror.openshift.io/v2alpha1\nmirror:\n  platform: {}\n  operators: []\n  additionalImages: []',
        name: 'lifecycle-start-config.yaml',
      });
      expect(configRes.status).toBe(200);

      const res = await request.post('/api/operations/start').send({
        configFile: 'lifecycle-start-config.yaml',
      });

      expect(res.status).toBe(200);
      expect(res.body.message).toContain('success');
      expect(res.body.operationId).toBeDefined();
      expect(typeof res.body.operationId).toBe('string');
    });

    it('passes optionalFlags through to the oc-mirror command argv', async () => {
      const argsFile = path.join(os.tmpdir(), `oc-mirror-args-${Date.now()}.txt`);
      process.env.OC_MIRROR_ARGS_FILE = argsFile;
      try {
        await fs.promises.rm(argsFile, { force: true });

        const configRes = await request.post('/api/config/save').send({
          config:
            'kind: ImageSetConfiguration\napiVersion: mirror.openshift.io/v2alpha1\nmirror:\n  platform: {}\n  operators: []\n  additionalImages: []',
          name: 'lifecycle-flags-config.yaml',
        });
        expect(configRes.status).toBe(200);

        const res = await request.post('/api/operations/start').send({
          configFile: 'lifecycle-flags-config.yaml',
          optionalFlags: {
            removeSignatures: true,
            imageTimeout: '10m',
            retryDelay: '30s',
            retryTimes: 3,
          },
        });

        expect(res.status).toBe(200);
        expect(res.body.operationId).toBeDefined();

        // Wait briefly for the spawned fake oc-mirror to write argv.
        let argsContent = '';
        for (let attempt = 0; attempt < 20; attempt += 1) {
          try {
            argsContent = await fs.promises.readFile(argsFile, 'utf8');
            if (argsContent.includes('file:')) {
              break;
            }
          } catch {
            // file may not exist yet
          }
          await new Promise((resolve) => setTimeout(resolve, 50));
        }

        const args = argsContent
          .split('\n')
          .map((line) => line.trim())
          .filter(Boolean);

        expect(args).toContain('--remove-signatures');
        expect(args).toContain('--image-timeout');
        expect(args).toContain('10m');
        expect(args).toContain('--retry-delay');
        expect(args).toContain('30s');
        expect(args).toContain('--retry-times');
        expect(args).toContain('3');

        // Flags must appear before the final mirror URL positional arg.
        const mirrorUrlIndex = args.findIndex((arg) => arg.startsWith('file:'));
        expect(mirrorUrlIndex).toBeGreaterThan(-1);
        expect(args.indexOf('--remove-signatures')).toBeLessThan(mirrorUrlIndex);
        expect(args.indexOf('--image-timeout')).toBeLessThan(mirrorUrlIndex);
        expect(args.indexOf('--retry-delay')).toBeLessThan(mirrorUrlIndex);
        expect(args.indexOf('--retry-times')).toBeLessThan(mirrorUrlIndex);
      } finally {
        delete process.env.OC_MIRROR_ARGS_FILE;
        await fs.promises.rm(argsFile, { force: true });
      }
    });
  });

  describe('POST /api/operations/:id/stop', () => {
    it('returns success and updates operation to stopped', async () => {
      const res = await request.post(`/api/operations/${seededOpId}/stop`);
      expect(res.status).toBe(200);
      expect(res.body.message).toContain('stopped');
    });
  });

  describe('GET /api/operations/:id/logs', () => {
    it('returns logs from file or operation record', async () => {
      const res = await request.get(`/api/operations/${seededOpId}/logs`);
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('logs');
      expect(typeof res.body.logs).toBe('string');
    });
  });

  describe('GET /api/operations/:id/details', () => {
    it('returns operation details with parsed metrics', async () => {
      const res = await request.get(`/api/operations/${seededOpId}/details`);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        imagesMirrored: expect.any(Number),
        operatorsMirrored: expect.any(Number),
        totalSize: expect.any(Number),
        configFile: expect.any(String),
        manifestFiles: expect.any(Array),
      });
    });

    it('returns 404 for non-existent operation', async () => {
      const res = await request.get(
        '/api/operations/00000000-0000-0000-0000-000000000000/details'
      );
      expect(res.status).toBe(404);
    });
  });

  describe('GET /api/operations/:id/logstream', () => {
    it('returns SSE stream with correct headers', async () => {
      const res = await request
        .get(`/api/operations/${seededOpId}/logstream`)
        .buffer(true)
        .parse((res, cb) => {
          let data = '';
          res.on('data', (chunk: Buffer) => {
            data += chunk.toString();
          });
          res.on('end', () => cb(null, data));
        });

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('text/event-stream');
    });
  });
});
