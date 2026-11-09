/// <reference types="node" />

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFile, execFileSync } from 'child_process';
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';
import process from 'process';
import { promisify } from 'util';
import { writeMinimalFbc } from '../helpers/minimalFbc.js';

const execFileAsync = promisify(execFile);
const repoRoot = process.cwd();
const DATAPOWER_URL = 'icr.io/cpopen/datapower-operator-catalog:latest';
const DATAPOWER = {
  url: DATAPOWER_URL,
  name: 'datapower-operator-catalog',
  tag: 'latest',
};

let root: string;
let stubDir: string;
let fbcDir: string;

// Stub `oc`: `image info` prints a digest; `image extract` copies the minimal FBC
// into the requested directory. Every extracted URL is appended to $OC_STUB_LOG.
const OC_STUB = `#!/bin/bash
if [ "$1" = "image" ] && [ "$2" = "info" ]; then
  echo '{"digest":"sha256:test"}'
  exit 0
fi
if [ "$1" = "image" ] && [ "$2" = "extract" ]; then
  url="\${@: -1}"
  for arg in "$@"; do
    case "$arg" in /configs/:*) dest="\${arg#/configs/:}" ;; esac
  done
  echo "$url" >> "$OC_STUB_LOG"
  mkdir -p "$dest"
  cp -R "$OC_STUB_FBC/." "$dest/"
  exit 0
fi
exit 1
`;

beforeAll(async () => {
  try {
    execFileSync('python3', ['-c', 'import yaml']);
  } catch {
    throw new Error(
      'PyYAML is required for python3. Run: uv run --no-project --with pyyaml npx vitest run tests/scripts/syncCatalogs.test.ts',
    );
  }
  root = await mkdtemp(path.join(os.tmpdir(), 'sync-catalogs-'));
  stubDir = path.join(root, 'bin');
  fbcDir = path.join(root, 'fbc');
  await mkdir(stubDir, { recursive: true });
  await writeFile(path.join(stubDir, 'oc'), OC_STUB);
  await chmod(path.join(stubDir, 'oc'), 0o755);
  await writeMinimalFbc(fbcDir);
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

async function runSync(env: Record<string, string>, seed?: (dataDir: string) => Promise<void>) {
  const runDir = await mkdtemp(path.join(root, 'run-'));
  const dataDir = path.join(runDir, 'data');
  const logFile = path.join(runDir, 'extract.log');
  await mkdir(dataDir, { recursive: true });
  await writeFile(logFile, '');
  if (seed) await seed(dataDir);

  const result = await execFileAsync('bash', [path.join(repoRoot, 'sync-catalogs.sh')], {
    env: {
      ...process.env,
      PATH: `${stubDir}:${process.env.PATH}`,
      CATALOG_DATA_DIR: dataDir,
      SCRIPT_DIR: repoRoot,
      PULL_SECRET_PATH: path.join(runDir, 'missing-pull-secret.json'),
      REGISTRY_AUTH_FILE: '',
      MAX_PARALLEL_JOBS: '24',
      OC_STUB_LOG: logFile,
      OC_STUB_FBC: fbcDir,
      OCP_VERSIONS: '',
      EXTERNAL_CATALOGS: '',
      ONLY_CATALOG: '',
      ...env,
    },
  }).catch((error) => {
    throw new Error(`sync-catalogs.sh failed: ${error.stderr || error.message}\n${error.stdout}`);
  });

  const extracted = (await readFile(logFile, 'utf8')).split('\n').filter(Boolean).sort();
  const index = JSON.parse(await readFile(path.join(dataDir, 'catalog-index.json'), 'utf8'));
  return { dataDir, extracted, index, stdout: result.stdout };
}

const redhatUrls = (version: string) =>
  ['certified-operator-index', 'community-operator-index', 'redhat-operator-index'].map(
    (type) => `registry.redhat.io/redhat/${type}:v${version}`,
  );

describe('sync-catalogs.sh', () => {
  it('syncs only enabled OCP versions plus configured external catalogs', async () => {
    const { extracted, index, dataDir } = await runSync({
      OCP_VERSIONS: '4.21',
      EXTERNAL_CATALOGS: JSON.stringify([DATAPOWER]),
    });

    expect(extracted).toEqual([...redhatUrls('4.21'), DATAPOWER_URL].sort());
    expect(extracted.some((url) => url.includes('v4.20'))).toBe(false);
    expect(index.catalogs).toHaveLength(4);
    expect(index.ocp_versions).toEqual(['4.21']);

    const dp = index.catalogs.find((c: { catalog_type: string }) => c.catalog_type === 'datapower-operator-catalog');
    expect(dp).toMatchObject({
      ocp_version: 'latest',
      source: 'external',
      catalog_url: DATAPOWER_URL,
    });
    const rh = index.catalogs.find((c: { catalog_type: string }) => c.catalog_type === 'redhat-operator-index');
    expect(rh.source).toBe('builtin');

    const operators = JSON.parse(
      await readFile(path.join(dataDir, 'datapower-operator-catalog', 'latest', 'operators.json'), 'utf8'),
    );
    expect(operators[0].catalogUrl).toBe(DATAPOWER_URL);
  });

  it('runs only the ONLY_CATALOG job', async () => {
    const { extracted, index } = await runSync({
      EXTERNAL_CATALOGS: JSON.stringify([DATAPOWER]),
      ONLY_CATALOG: DATAPOWER_URL,
    });
    expect(extracted).toEqual([DATAPOWER_URL]);
    expect(index.catalogs).toHaveLength(1);
  });

  it('preserves previously synced data of versions that are not part of the run', async () => {
    const { dataDir, index } = await runSync(
      { EXTERNAL_CATALOGS: JSON.stringify([DATAPOWER]), ONLY_CATALOG: DATAPOWER_URL },
      async (dir) => {
        await mkdir(path.join(dir, 'redhat-operator-index', 'v4.16'), { recursive: true });
        await writeFile(path.join(dir, 'redhat-operator-index', 'v4.16', 'operators.json'), '[]');
        await writeFile(
          path.join(dir, 'catalog-index.json'),
          JSON.stringify({
            catalogs: [
              {
                catalog_type: 'redhat-operator-index',
                ocp_version: 'v4.16',
                catalog_url: 'registry.redhat.io/redhat/redhat-operator-index:v4.16',
              },
            ],
          }),
        );
      },
    );

    expect((await stat(path.join(dataDir, 'redhat-operator-index', 'v4.16', 'operators.json'))).isFile()).toBe(true);
    const types = index.catalogs.map((c: { catalog_type: string }) => c.catalog_type).sort();
    expect(types).toEqual(['datapower-operator-catalog', 'redhat-operator-index']);
  });

  it('keeps the default of 7 versions x 3 Red Hat catalogs when env vars are unset', async () => {
    const { extracted, index, stdout } = await runSync({});
    expect(extracted).toHaveLength(21);
    expect(extracted.every((url) => url.startsWith('registry.redhat.io/redhat/'))).toBe(true);
    expect(index.catalogs).toHaveLength(21);
    expect(stdout).toContain('Completed: 21/21 catalogs successful, 0 failed');
  }, 60_000);
});
