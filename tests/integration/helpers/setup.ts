import fs from 'fs';
import path from 'path';
import os from 'os';
import { ensureCatalogFixture } from '../../helpers/catalogDataFixture.js';

const tempRoot = path.join(os.tmpdir(), `oc-mirror-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
const storageDir = path.join(tempRoot, 'data');
const builtinCatalogDataDir = path.join(tempRoot, 'builtin-catalog-data');

process.env.VITEST = 'true';
process.env.STORAGE_DIR = storageDir;
process.env.OC_MIRROR_AUTHFILE = path.join(storageDir, 'pull-secret.json');
process.env.OC_MIRROR_BUILTIN_CATALOG_DIR = builtinCatalogDataDir;

export async function ensureTestDirs(): Promise<void> {
  const dirs = [
    storageDir,
    path.join(storageDir, 'configs'),
    path.join(storageDir, 'operations'),
    path.join(storageDir, 'logs'),
    path.join(storageDir, 'cache'),
    path.join(storageDir, 'mirrors'),
    path.join(storageDir, 'mirrors', 'default'),
  ];
  for (const dir of dirs) {
    await fs.promises.mkdir(dir, { recursive: true });
  }
  await ensureCatalogFixture(builtinCatalogDataDir);
}

export async function cleanupTestDirs(): Promise<void> {
  try {
    await fs.promises.rm(tempRoot, { recursive: true, force: true });
  } catch {
    // ignore
  }
}
