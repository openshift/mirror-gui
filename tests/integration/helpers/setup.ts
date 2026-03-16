import fs from 'fs';
import path from 'path';
import os from 'os';

const tempRoot = path.join(os.tmpdir(), `oc-mirror-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
const storageDir = path.join(tempRoot, 'data');

process.env.VITEST = 'true';
process.env.STORAGE_DIR = storageDir;

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
}

export async function cleanupTestDirs(): Promise<void> {
  try {
    await fs.promises.rm(tempRoot, { recursive: true, force: true });
  } catch {
    // ignore
  }
}
