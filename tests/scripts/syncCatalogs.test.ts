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
  if [ -n "$OC_STUB_EXPECT_REGISTRY_CONFIG" ]; then
    case " $* " in
      *" --registry-config=$OC_STUB_EXPECT_REGISTRY_CONFIG "*) ;;
      *) echo "stub: missing --registry-config=$OC_STUB_EXPECT_REGISTRY_CONFIG in: $*" >&2; exit 2 ;;
    esac
  fi
  # The catalog URL must be the last argument, after the --path option.
  case "$url" in *[!A-Za-z0-9./:_-]*|"") echo "stub: bad url arg: $url" >&2; exit 2 ;; esac
  if [ -z "$dest" ]; then echo "stub: missing --path /configs/:<dir>" >&2; exit 2; fi
  if [ -n "$OC_STUB_FAIL_URL" ] && [ "$url" = "$OC_STUB_FAIL_URL" ]; then
    exit 1
  fi
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
  if (!root) return;
  await rm(root, { recursive: true, force: true });
});

async function runSyncRaw(env: Record<string, string>, seed?: (dataDir: string) => Promise<void>) {
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
  }).then(
    (r) => ({ code: 0, stdout: r.stdout, stderr: r.stderr }),
    (error) => ({ code: error.code as number, stdout: error.stdout as string, stderr: error.stderr as string }),
  );

  const extracted = (await readFile(logFile, 'utf8')).split('\n').filter(Boolean).sort();
  let index: { catalogs: Record<string, string>[]; ocp_versions?: string[] } | undefined;
  try {
    index = JSON.parse(await readFile(path.join(dataDir, 'catalog-index.json'), 'utf8'));
  } catch {
    index = undefined;
  }
  return { dataDir, extracted, index, ...result };
}

async function runSync(env: Record<string, string>, seed?: (dataDir: string) => Promise<void>) {
  const result = await runSyncRaw(env, seed);
  if (result.code !== 0) {
    throw new Error(`sync-catalogs.sh failed: ${result.stderr}\n${result.stdout}`);
  }
  return result;
}

const seedIndex = (index: unknown) => async (dir: string) => {
  await writeFile(path.join(dir, 'catalog-index.json'), JSON.stringify(index));
};

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

describe('sync-catalogs.sh validation and failure handling', () => {
  const SEED = {
    ocp_versions: ['4.16'],
    catalogs: [{ catalog_type: 'redhat-operator-index', ocp_version: 'v4.16', synced_at: 'old' }],
  };

  it('rejects invalid EXTERNAL_CATALOGS JSON and leaves the index untouched', async () => {
    const { code, stderr, extracted, index } = await runSyncRaw({ EXTERNAL_CATALOGS: '{not json' }, seedIndex(SEED));
    expect(code).toBe(1);
    expect(stderr).toContain('EXTERNAL_CATALOGS');
    expect(extracted).toEqual([]);
    expect(index).toEqual(SEED);
  });

  it.each([
    ['non-array', '{"name":"a","tag":"b","url":"c"}'],
    ['missing url', '[{"name":"a","tag":"b"}]'],
    ['empty url', '[{"name":"a","tag":"b","url":""}]'],
    ['non-string tag', '[{"name":"a","tag":1,"url":"x.io/a:b"}]'],
  ])('rejects EXTERNAL_CATALOGS with %s', async (_label, value) => {
    const { code, stderr, extracted, index } = await runSyncRaw({ EXTERNAL_CATALOGS: value }, seedIndex(SEED));
    expect(code).toBe(1);
    expect(stderr).toContain('ERROR');
    expect(extracted).toEqual([]);
    expect(index).toEqual(SEED);
  });

  it('refuses a catalog URL starting with a dash', async () => {
    const { code, stderr, extracted } = await runSyncRaw({
      EXTERNAL_CATALOGS: JSON.stringify([{ name: 'evil', tag: 'latest', url: '--insecure' }]),
    });
    expect(code).toBe(1);
    expect(stderr).toContain("starting with '-'");
    expect(extracted).toEqual([]);
  });

  it('fails when ONLY_CATALOG is not in EXTERNAL_CATALOGS', async () => {
    const { code, stderr, extracted } = await runSyncRaw({
      EXTERNAL_CATALOGS: JSON.stringify([DATAPOWER]),
      ONLY_CATALOG: 'icr.io/other/catalog:latest',
    });
    expect(code).toBe(1);
    expect(stderr).toContain('not listed in EXTERNAL_CATALOGS');
    expect(extracted).toEqual([]);
  });

  it.each(['4', '4.x', 'v4.20', '4.20,,4.21', '4.20,foo'])('rejects invalid OCP_VERSIONS entry %j', async (value) => {
    const { code, stderr, extracted } = await runSyncRaw({ OCP_VERSIONS: value });
    expect(code).toBe(1);
    expect(stderr).toContain('invalid OCP version');
    expect(extracted).toEqual([]);
  });

  it('counts a failing extraction, keeps other entries, and adds no broken entry', async () => {
    const failing = 'registry.redhat.io/redhat/community-operator-index:v4.21';
    const { code, stdout, index } = await runSyncRaw(
      { OCP_VERSIONS: '4.21', OC_STUB_FAIL_URL: failing },
      seedIndex(SEED),
    );
    expect(code).toBe(1);
    expect(stdout).toContain('Completed: 2/3 catalogs successful, 1 failed');
    const keys = index.catalogs.map((c: { catalog_type: string; ocp_version: string }) => `${c.catalog_type}:${c.ocp_version}`).sort();
    expect(keys).toEqual(['certified-operator-index:v4.21', 'redhat-operator-index:v4.16', 'redhat-operator-index:v4.21']);
    expect(index.catalogs.find((c: { synced_at: string }) => c.synced_at === 'old')).toBeDefined();
  }, 30_000);

  it('does not re-add a stale catalog-info.json for a failed job', async () => {
    const failing = 'registry.redhat.io/redhat/community-operator-index:v4.21';
    const { code, index } = await runSyncRaw({ OCP_VERSIONS: '4.21', OC_STUB_FAIL_URL: failing }, async (dir) => {
      await mkdir(path.join(dir, 'community-operator-index', 'v4.21'), { recursive: true });
      await writeFile(
        path.join(dir, 'community-operator-index', 'v4.21', 'catalog-info.json'),
        JSON.stringify({ catalog_type: 'community-operator-index', ocp_version: 'v4.21' }),
      );
    });
    expect(code).toBe(1);
    expect(index.catalogs.some((c: { catalog_type: string }) => c.catalog_type === 'community-operator-index')).toBe(false);
  }, 30_000);

  it('keeps exactly one fresh entry when the same catalog is synced twice', async () => {
    const env = { EXTERNAL_CATALOGS: JSON.stringify([DATAPOWER]), ONLY_CATALOG: DATAPOWER_URL };
    const first = await runSync(env);
    const firstEntry = first.index.catalogs[0];
    await new Promise((r) => setTimeout(r, 1100));
    // Second run reuses the first run's data dir via a seed copy of its index.
    const second = await runSync(env, seedIndex(first.index));
    const matches = second.index.catalogs.filter(
      (c: { catalog_type: string; ocp_version: string }) =>
        c.catalog_type === 'datapower-operator-catalog' && c.ocp_version === 'latest',
    );
    expect(matches).toHaveLength(1);
    expect(matches[0].synced_at >= firstEntry.synced_at).toBe(true);
  });

  it('replaces a seeded stale entry for the same (catalog_type, ocp_version)', async () => {
    const { index } = await runSync(
      { EXTERNAL_CATALOGS: JSON.stringify([DATAPOWER]), ONLY_CATALOG: DATAPOWER_URL },
      seedIndex({
        catalogs: [
          { catalog_type: 'datapower-operator-catalog', ocp_version: 'latest', synced_at: 'stale', digest: 'sha256:stale' },
        ],
      }),
    );
    expect(index.catalogs).toHaveLength(1);
    expect(index.catalogs[0].digest).toBe('sha256:test');
    expect(index.catalogs[0].synced_at).not.toBe('stale');
  });

  it('keeps the existing index.ocp_versions on an ONLY_CATALOG run', async () => {
    const { index } = await runSync(
      { EXTERNAL_CATALOGS: JSON.stringify([DATAPOWER]), ONLY_CATALOG: DATAPOWER_URL, OCP_VERSIONS: '4.22' },
      seedIndex({ ocp_versions: ['4.16', '4.17'], catalogs: [] }),
    );
    expect(index.ocp_versions).toEqual(['4.16', '4.17']);
  });

  it('resets a corrupt catalog-index.json with a loud warning', async () => {
    const { code, stderr, index } = await runSyncRaw(
      { EXTERNAL_CATALOGS: JSON.stringify([DATAPOWER]), ONLY_CATALOG: DATAPOWER_URL },
      async (dir) => {
        await writeFile(path.join(dir, 'catalog-index.json'), '{truncated');
      },
    );
    expect(code).toBe(0);
    expect(stderr).toContain('WARN: catalog-index.json was invalid, resetting');
    expect(index.catalogs).toHaveLength(1);
  });

  it('passes --registry-config and the catalog URL to oc', async () => {
    const pullSecret = path.join(root, 'pull-secret-for-test.json');
    await writeFile(pullSecret, '{}');
    const { code, extracted } = await runSyncRaw({
      PULL_SECRET_PATH: pullSecret,
      OC_STUB_EXPECT_REGISTRY_CONFIG: pullSecret,
      EXTERNAL_CATALOGS: JSON.stringify([DATAPOWER]),
      ONLY_CATALOG: DATAPOWER_URL,
    });
    expect(code).toBe(0);
    expect(extracted).toEqual([DATAPOWER_URL]);
  });

  it('fails the job when operators.json is unreadable', async () => {
    const realPython = execFileSync('python3', ['-c', 'import sys; print(sys.executable)'], { encoding: 'utf8' }).trim();
    const pyDir = path.join(root, 'bin-bad-operators');
    await mkdir(pyDir, { recursive: true });
    // Run the real generator, then corrupt its operators.json output.
    await writeFile(
      path.join(pyDir, 'python3'),
      `#!/bin/bash
"${realPython}" "$@" || exit $?
prev=""
for arg in "$@"; do
  if [ "$prev" = "--operators-file" ]; then echo 'not json' > "$arg"; fi
  prev="$arg"
done
`,
    );
    await chmod(path.join(pyDir, 'python3'), 0o755);
    const { code, stdout, stderr, index } = await runSyncRaw({
      PATH: `${pyDir}:${stubDir}:${process.env.PATH}`,
      EXTERNAL_CATALOGS: JSON.stringify([DATAPOWER]),
      ONLY_CATALOG: DATAPOWER_URL,
    });
    expect(code).toBe(1);
    expect(stderr).toContain('Cannot read operator count');
    expect(stdout).toContain('Completed: 0/1 catalogs successful, 1 failed');
    expect(index.catalogs).toEqual([]);
  });
});
