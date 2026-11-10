import fs from 'fs';
import path from 'path';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { vi } from 'vitest';

// The server reads OC_MIRROR_WORKDIR once at import time, so the fake sync script
// must exist before ./helpers/testApp.js loads the server. The script behavior is picked
// per test through the "mode" file next to it.
const fake = await vi.hoisted(async () => {
  const fsMod = await import('node:fs');
  const osMod = await import('node:os');
  const pathMod = await import('node:path');
  const workdir = fsMod.mkdtempSync(pathMod.join(osMod.tmpdir(), 'fake-outcomes-'));
  const modeFile = pathMod.join(workdir, 'mode');
  fsMod.writeFileSync(
    pathMod.join(workdir, 'sync-catalogs.sh'),
    [
      '#!/bin/bash',
      `mode=$(cat "${modeFile}")`,
      'mkdir -p "$CATALOG_DATA_DIR"',
      'case "$mode" in',
      '  fail)',
      '    echo "ERROR: registry unreachable"',
      '    exit 1 ;;',
      '  partial)',
      '    # One catalog finished and was written to the index before the run failed.',
      '    mkdir -p "$CATALOG_DATA_DIR/outcome-catalog/latest"',
      '    echo \'[{"name":"op-a","channels":[]}]\' > "$CATALOG_DATA_DIR/outcome-catalog/latest/operators.json"',
      '    echo \'{"catalogs":[{"catalog_type":"outcome-catalog","ocp_version":"latest","catalog_url":"icr.io/x/outcome-catalog:latest","source":"external"}]}\' > "$CATALOG_DATA_DIR/catalog-index.json"',
      '    echo "ERROR: other catalog failed"',
      '    echo "Completed: 1/2 catalogs successful, 1 failed"',
      '    exit 1 ;;',
      '  nosummary)',
      '    echo "all done, no summary line"',
      '    exit 0 ;;',
      '  ok)',
      '    echo "Completed: 2/2 catalogs successful, 0 failed"',
      '    exit 0 ;;',
      'esac',
      '',
    ].join('\n'),
    { mode: 0o755 },
  );
  process.env.OC_MIRROR_WORKDIR = workdir;
  return { workdir, modeFile };
});

import { getTestApp } from './helpers/testApp.js';
import { __routeTestHooks } from '../../server/index.js';

const ALL_VERSIONS = ['4.16', '4.17', '4.18', '4.19', '4.20', '4.21', '4.22'];
const EXTERNAL_URL = 'icr.io/x/outcome-catalog:latest';

describe('Catalog sync outcomes', () => {
  let request: Awaited<ReturnType<typeof getTestApp>>;
  const storageDir = () => process.env.STORAGE_DIR!;
  const runtimeDir = () => path.join(storageDir(), 'catalog-data');

  const putSettings = (withExternal: boolean) =>
    request.put('/api/catalogs/settings').send({
      enabledOcpVersions: ALL_VERSIONS,
      externalCatalogs: withExternal ? [{ url: EXTERNAL_URL }] : [],
    });

  async function runSync(mode: string) {
    await fs.promises.writeFile(fake.modeFile, mode);
    const started = await request.post('/api/catalogs/sync').send({ only: EXTERNAL_URL });
    expect(started.status).toBe(200);
    for (let i = 0; i < 100; i++) {
      const res = await request.get('/api/catalogs/sync/status');
      if (res.body.status !== 'running') return res.body;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error('sync did not finish');
  }

  beforeAll(async () => {
    request = await getTestApp();
  });

  beforeEach(async () => {
    expect((await putSettings(true)).status).toBe(200);
  });

  afterAll(async () => {
    await putSettings(false);
    await request.delete('/api/catalogs/sync/data');
    fs.rmSync(fake.workdir, { recursive: true, force: true });
  });

  it('reports a failed run with the last ERROR line from the script', async () => {
    const status = await runSync('fail');
    expect(status.status).toBe('failed');
    expect(status.error).toBe('Sync process exited with code 1: ERROR: registry unreachable');
  });

  it('still reloads catalog data after a partial failure and reports how much was updated', async () => {
    // Without a reload the catalog the script finished would stay invisible until restart.
    const status = await runSync('partial');
    expect(status.status).toBe('failed');
    expect(status.successCount).toBe(1);
    expect(status.failedCount).toBe(1);
    expect(status.totalCount).toBe(2);
    expect(status.error).toContain('ERROR: other catalog failed');
    expect(status.error).toContain('1 of 2 catalogs were updated');
    const catalogs = await request.get('/api/catalogs');
    const reloaded = catalogs.body.find((c: { name: string }) => c.name === 'outcome-catalog');
    expect(reloaded?.operatorCount).toBe(1);
  });

  it('completes without error when the script exits 0 and prints its summary', async () => {
    const status = await runSync('ok');
    expect(status.status).toBe('completed');
    expect(status.error).toBeFalsy();
    expect(status.successCount).toBe(2);
    expect(status.failedCount).toBe(0);
  });

  it('flags a successful exit that has no summary line, because the counts are unknown', async () => {
    const status = await runSync('nosummary');
    expect(status.status).toBe('completed');
    expect(status.error).toMatch(/result summary is missing/);
  });

  it('does not report Red Hat sync data after an external-only sync seeded the runtime directory', async () => {
    await request.delete('/api/catalogs/sync/data');
    const status = await runSync('ok');
    expect(status.hasRuntimeSyncData).toBe(true);
    expect(status.hasRedHatSyncData).toBe(false);
  });

  it('reports an unreadable runtime index instead of overwriting it with a fresh seed', async () => {
    // A file where the catalog-data directory should be makes access() fail with ENOTDIR, not ENOENT.
    await request.delete('/api/catalogs/sync/data');
    await fs.promises.rm(runtimeDir(), { recursive: true, force: true });
    await fs.promises.writeFile(runtimeDir(), 'not a directory');
    try {
      const res = await request.post('/api/catalogs/sync').send({ only: EXTERNAL_URL });
      expect(res.status).toBe(500);
      expect(res.body.error).toMatch(/Could not read existing catalog data/);
    } finally {
      await fs.promises.rm(runtimeDir(), { force: true });
    }
  });

  it.skipIf(process.getuid?.() === 0)(
    'answers 500 and leaves no partial runtime directory when seeding fails',
    async () => {
      await request.delete('/api/catalogs/sync/data');
      await fs.promises.rm(runtimeDir(), { recursive: true, force: true });
      await fs.promises.chmod(storageDir(), 0o500);
      try {
        const res = await request.post('/api/catalogs/sync').send({ only: EXTERNAL_URL });
        expect(res.status).toBe(500);
        expect(res.body.error).toMatch(/Could not prepare catalog data for sync/);
      } finally {
        await fs.promises.chmod(storageDir(), 0o755);
      }
      expect(fs.existsSync(runtimeDir())).toBe(false);
    },
  );

  // Holds the first settings PUT inside its critical section so the second request
  // always arrives while the lock is taken, regardless of how fast the PUT would finish.
  async function withHeldSettingsSave<T>(second: () => PromiseLike<T>) {
    let release!: () => void;
    let held!: () => void;
    __routeTestHooks.holdSettingsSave = new Promise<void>((resolve) => {
      release = resolve;
    });
    const firstIsHeld = new Promise<void>((resolve) => {
      held = resolve;
    });
    __routeTestHooks.onSettingsSaveHeld = held;
    try {
      const first = putSettings(false).then((res) => res);
      // The server signals once the first PUT owns the lock, so no request can race it.
      await firstIsHeld;
      const secondResult = await second();
      release();
      return { first: await first, second: secondResult };
    } finally {
      release();
      __routeTestHooks.holdSettingsSave = null;
      __routeTestHooks.onSettingsSaveHeld = null;
    }
  }

  it('answers 409 to a settings update while another one is in progress', async () => {
    const { first, second } = await withHeldSettingsSave(() => putSettings(true));
    expect(first.status).toBe(200);
    expect(second.status).toBe(409);
  });

  it('never lets a settings update and a sync start overlap', async () => {
    const { first, second } = await withHeldSettingsSave(() =>
      request.post('/api/catalogs/sync').send({ only: EXTERNAL_URL }),
    );
    expect(first.status).toBe(200);
    expect(second.status).toBe(409);
    for (let i = 0; i < 100; i++) {
      const res = await request.get('/api/catalogs/sync/status');
      if (res.body.status !== 'running') break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  });
});
