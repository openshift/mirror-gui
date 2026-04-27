import fs from 'fs';
import path from 'path';
import os from 'os';

const tempRoot = path.join(os.tmpdir(), `oc-mirror-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
const storageDir = path.join(tempRoot, 'data');

process.env.VITEST = 'true';
process.env.STORAGE_DIR = storageDir;
process.env.OC_MIRROR_AUTHFILE = path.join(storageDir, 'pull-secret.json');

const projectRoot = path.resolve(import.meta.dirname, '../../..');
const catalogDataDest = path.join(projectRoot, 'catalog-data');
const catalogDataFixture = path.join(projectRoot, 'tests/fixtures/catalog-data');

async function ensureCatalogFixture(): Promise<void> {
  try {
    await fs.promises.access(path.join(catalogDataDest, 'catalog-index.json'));
  } catch {
    await fs.promises.cp(catalogDataFixture, catalogDataDest, { recursive: true, force: true });
  }
}

export async function ensureTestDirs(): Promise<void> {
  const dirs = [
    storageDir,
    path.join(storageDir, 'configs'),
    path.join(storageDir, 'operations'),
    path.join(storageDir, 'logs'),
    path.join(storageDir, 'mirrors'),
    path.join(storageDir, 'mirrors', 'default'),
  ];
  for (const dir of dirs) {
    await fs.promises.mkdir(dir, { recursive: true });
  }
  await ensureCatalogFixture();
}

export async function cleanupTestDirs(): Promise<void> {
  try {
    await fs.promises.rm(tempRoot, { recursive: true, force: true });
  } catch {
    // ignore
  }
}
