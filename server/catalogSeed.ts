import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { BUILTIN_CATALOG_TYPES } from './catalogSettings.js';

const fsp = fs.promises;
const INDEX_FILE = 'catalog-index.json';
const MARKER_FILE = '.seed.json';

/**
 * Records where the runtime catalog directory came from. `builtinHash` identifies the built-in
 * snapshot that was copied in; `redHatSyncedAt` is set once a full sync has replaced the
 * Red Hat catalogs, after which the built-in snapshot is never copied over them again.
 */
export interface SeedMarker {
  builtinHash: string;
  redHatSyncedAt?: string;
}

interface CatalogIndexFile {
  catalogs?: { catalog_type: string }[];
  ocp_versions?: string[];
  catalog_types?: string[];
  [key: string]: unknown;
}

export type RefreshResult = 'refreshed' | 'current' | 'skipped';

async function hashBuiltinSnapshot(builtinDir: string): Promise<string> {
  const content = await fsp.readFile(path.join(builtinDir, INDEX_FILE));
  return crypto.createHash('sha256').update(content).digest('hex');
}

/** Returns the marker, or null when it is missing or unreadable (a runtime dir from before markers existed). */
export async function readSeedMarker(runtimeDir: string): Promise<SeedMarker | null> {
  try {
    const marker = JSON.parse(await fsp.readFile(path.join(runtimeDir, MARKER_FILE), 'utf8'));
    return typeof marker?.builtinHash === 'string' ? (marker as SeedMarker) : null;
  } catch {
    return null;
  }
}

async function writeJsonAtomic(file: string, value: unknown): Promise<void> {
  const tempFile = `${file}.tmp`;
  await fsp.writeFile(tempFile, JSON.stringify(value, null, 2));
  await fsp.rename(tempFile, file);
}

/** Copies the whole built-in snapshot into an empty runtime directory and records its hash. */
export async function seedRuntimeCatalogData(builtinDir: string, runtimeDir: string): Promise<void> {
  const builtinHash = await hashBuiltinSnapshot(builtinDir);
  await fsp.cp(builtinDir, runtimeDir, { recursive: true });
  await writeJsonAtomic(path.join(runtimeDir, MARKER_FILE), { builtinHash } satisfies SeedMarker);
}

/**
 * Brings a seeded runtime directory up to date with a newer built-in snapshot (for example after
 * a container upgrade). Only the built-in catalog types are replaced; external catalogs and their
 * index entries stay. Does nothing when the directory has no marker (its origin is unknown) or a
 * full sync has already produced Red Hat data, because that data is newer than any snapshot.
 */
export async function refreshSeededCatalogData(builtinDir: string, runtimeDir: string): Promise<RefreshResult> {
  const marker = await readSeedMarker(runtimeDir);
  if (!marker || marker.redHatSyncedAt) {
    return 'skipped';
  }
  const builtinHash = await hashBuiltinSnapshot(builtinDir);
  if (builtinHash === marker.builtinHash) {
    return 'current';
  }

  const builtinIndex: CatalogIndexFile = JSON.parse(await fsp.readFile(path.join(builtinDir, INDEX_FILE), 'utf8'));
  const runtimeIndex: CatalogIndexFile = JSON.parse(await fsp.readFile(path.join(runtimeDir, INDEX_FILE), 'utf8'));

  for (const catalogType of BUILTIN_CATALOG_TYPES) {
    const source = path.join(builtinDir, catalogType);
    const target = path.join(runtimeDir, catalogType);
    await fsp.rm(target, { recursive: true, force: true });
    try {
      await fsp.cp(source, target, { recursive: true });
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    }
  }

  const isBuiltin = (entry: { catalog_type: string }) => BUILTIN_CATALOG_TYPES.includes(entry.catalog_type);
  const mergedIndex: CatalogIndexFile = {
    ...runtimeIndex,
    ocp_versions: builtinIndex.ocp_versions,
    catalog_types: [...new Set([...(builtinIndex.catalog_types ?? []), ...(runtimeIndex.catalog_types ?? [])])],
    catalogs: [
      ...(builtinIndex.catalogs ?? []),
      ...(runtimeIndex.catalogs ?? []).filter((entry) => !isBuiltin(entry)),
    ],
  };
  // The index goes last: readers only see the new built-in entries once their data is in place.
  await writeJsonAtomic(path.join(runtimeDir, INDEX_FILE), mergedIndex);
  await writeJsonAtomic(path.join(runtimeDir, MARKER_FILE), { builtinHash } satisfies SeedMarker);
  return 'refreshed';
}

/** Marks that a full sync produced Red Hat data, so the built-in snapshot must not replace it. */
export async function markRedHatSynced(runtimeDir: string): Promise<void> {
  const marker = await readSeedMarker(runtimeDir);
  if (!marker) {
    return;
  }
  await writeJsonAtomic(path.join(runtimeDir, MARKER_FILE), {
    ...marker,
    redHatSyncedAt: new Date().toISOString(),
  } satisfies SeedMarker);
}

/** True once Red Hat catalogs were synced, or when the directory predates markers (assume synced). */
export async function hasRedHatSyncData(runtimeDir: string): Promise<boolean> {
  try {
    await fsp.access(path.join(runtimeDir, INDEX_FILE), fs.constants.R_OK);
  } catch {
    return false;
  }
  const marker = await readSeedMarker(runtimeDir);
  return marker === null || marker.redHatSyncedAt !== undefined;
}
