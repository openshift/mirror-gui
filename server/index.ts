import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { exec, spawn, ChildProcess } from 'child_process';
import { promisify } from 'util';
import YAML from 'yaml';
import { v4 as uuidv4 } from 'uuid';
import compression from 'compression';

import { fileURLToPath, pathToFileURL } from 'url';
import { getChannelObjectsFromGeneratedOperator } from './catalogChannels.js';
import { isPathAvailable } from './pathAvailability.js';
import {
  type ChannelObject,
  parseOcMirrorVersion,
  getCatalogNameFromUrl,
  getCatalogDescription,
  getQueryStringValue,
  getVersionsFromMetadata,
  normalizeChannels,
} from './utils.js';

const fsp = fs.promises;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const execAsync = promisify(exec);

interface OperationRecord {
  id: string;
  name: string;
  configFile: string;
  mirrorDestination?: string;
  status: 'running' | 'success' | 'failed' | 'stopped';
  startedAt: string;
  completedAt?: string;
  duration?: number;
  errorMessage?: string | null;
  logs: string[];
}

interface SystemInfo {
  ocMirrorVersion: string;
  systemArchitecture: string;
  availableDiskSpace: number;
  totalDiskSpace: number;
  hostDataDir: string;
  cacheDir: string;
  hostCacheDir: string;
  cacheSizeBytes: number;
}

interface CatalogEntry {
  name: string;
  url: string;
  description: string;
  ocpVersion?: string;
  operators?: OperatorEntry[];
  operatorCount?: number;
  digest?: string;
  syncedAt?: string;
}

interface OperatorEntry {
  name: string;
  defaultChannel?: string;
  channels?: (string | { name: string })[];
  allChannels?: string[];
  catalog?: string;
  ocpVersion?: string;
  catalogUrl?: string;
  availableVersions?: string[];
  channelVersions?: Record<string, string[]>;
  channelVersionRanges?: Record<string, { minVersion?: string | null; maxVersion?: string | null }>;
  minVersion?: string | null;
  maxVersion?: string | null;
}

interface OperatorDependency {
  packageName: string;
  versionRange?: string | null;
  displayName?: string;
  catalog?: string;
  catalogUrl?: string;
  defaultChannel?: string;
  isDependencyPackage?: boolean;
}

interface PreFetchedCatalogData {
  index: {
    catalogs: Array<{
      catalog_type: string;
      ocp_version: string;
      catalog_url: string;
      digest?: string;
      synced_at?: string;
    }>;
  };
  operators: Record<string, OperatorEntry[]>;
  channels: Record<string, (string | { name: string })[]>;
}

interface OperatorCache {
  catalogs: CatalogEntry[];
  operators: Record<string, OperatorEntry>;
  channels: Record<string, (string | { name: string })[]>;
  lastUpdate: number | null;
  cacheTimeout: number;
}

interface RunningProcess {
  pid: number | undefined;
  child: ChildProcess;
}

const app = express();
export { app };
const PORT = process.env.PORT || 3001;
const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const DIST_DIR = path.join(__dirname, '../dist');
const DEV_INDEX_HTML = path.join(__dirname, '../index.html');

app.use(compression());
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use((req: Request, res: Response, next: NextFunction) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
  next();
});

const STORAGE_DIR = process.env.STORAGE_DIR || './data';
const CONFIGS_DIR = path.join(STORAGE_DIR, 'configs');
const OPERATIONS_DIR = path.join(STORAGE_DIR, 'operations');
const LOGS_DIR = path.join(STORAGE_DIR, 'logs');
const CACHE_DIR = path.resolve(process.env.OC_MIRROR_CACHE_DIR || path.join(STORAGE_DIR, 'cache'));
const APP_ROOT_DIR = process.env.OC_MIRROR_WORKDIR || path.resolve(__dirname, '..');
const DEV_CACHE_DIR = path.join(APP_ROOT_DIR, '.local-run', 'vite');
const MIRROR_BASE_DIR = path.resolve(process.env.OC_MIRROR_BASE_MIRROR_DIR || path.join(STORAGE_DIR, 'mirrors'));
const DEFAULT_MIRROR_DIR = path.join(MIRROR_BASE_DIR, 'default');
const CUSTOM_MIRROR_DIR = path.join(MIRROR_BASE_DIR, 'custom');
const EPHEMERAL_MIRROR_DIR = path.resolve(process.env.OC_MIRROR_EPHEMERAL_DIR || path.join(APP_ROOT_DIR, 'mirror'));
const AUTHFILE_PATH = process.env.OC_MIRROR_AUTHFILE || '/app/pull-secret.json';

let pullSecretPath: string | null = null;
let pullSecretDetected = false;

async function detectPullSecret(): Promise<void> {
  try {
    await fsp.access(AUTHFILE_PATH, fs.constants.R_OK);
    const content = await fsp.readFile(AUTHFILE_PATH, 'utf8');
    if (content.trim().length > 2) {
      pullSecretPath = AUTHFILE_PATH;
      pullSecretDetected = true;
      console.log(`Pull secret detected at: ${AUTHFILE_PATH}`);
      return;
    }
  } catch { /* no pull secret file */ }

  pullSecretPath = null;
  pullSecretDetected = false;
  console.log('No pull secret detected');
}

const runningProcesses = new Map<string, RunningProcess>();
const stoppedOperations = new Set<string>();

async function ensureDirectories(): Promise<void> {
  const dirs = [
    STORAGE_DIR,
    CONFIGS_DIR,
    OPERATIONS_DIR,
    LOGS_DIR,
    CACHE_DIR,
    MIRROR_BASE_DIR,
    DEFAULT_MIRROR_DIR,
  ];
  for (const dir of dirs) {
    try {
      await fsp.mkdir(dir, { recursive: true });
    } catch (error: unknown) {
      console.error(`Error creating directory ${dir}:`, error);
    }
  }
}

// Note: With custom mirror destinations (default: DEFAULT_MIRROR_DIR),
// mirror files persist across restarts, so we keep operation history
async function clearOperationHistory(): Promise<void> {
  let hasPersistedMirrors = false;

  try {
    const files = await fsp.readdir(DEFAULT_MIRROR_DIR);
    hasPersistedMirrors = files.length > 0;
  } catch {
    hasPersistedMirrors = false;
  }

  if (!hasPersistedMirrors) {
    let clearedOps = 0;
    let clearedLogs = 0;

    try {
      const opFiles = await fsp.readdir(OPERATIONS_DIR);
      for (const file of opFiles) {
        if (file.endsWith('.json')) {
          try {
            await fsp.unlink(path.join(OPERATIONS_DIR, file));
            clearedOps++;
          } catch (error: unknown) {
            console.warn(`Failed to delete operation file ${file}:`, error);
          }
        }
      }
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.warn('Error reading operations directory:', error);
      }
    }

    try {
      const logFiles = await fsp.readdir(LOGS_DIR);
      for (const file of logFiles) {
        try {
          await fsp.unlink(path.join(LOGS_DIR, file));
          clearedLogs++;
        } catch (error: unknown) {
          console.warn(`Failed to delete log file ${file}:`, error);
        }
      }
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.warn('Error reading logs directory:', error);
      }
    }

    if (clearedOps > 0 || clearedLogs > 0) {
      console.log(`Cleared ${clearedOps} operation files and ${clearedLogs} log files on startup (fresh start detected)`);
    }
  } else {
    console.log('Persistent mirror files detected - keeping operation history');
  }
}

ensureDirectories().then(() => {
  if (process.env.VITEST !== 'true') {
    clearOperationHistory();
  }
});

async function getSystemInfo(): Promise<SystemInfo> {
  try {
    const [ocMirrorVersion, systemArch] = await Promise.all([
      execAsync('oc-mirror version').catch(() => ({ stdout: 'Not available', stderr: '' })),
      execAsync('uname -m').catch(() => ({ stdout: 'Not available', stderr: '' })),
    ]);

    const diskSpace = await execAsync(`df -k ${STORAGE_DIR}`).catch(() => ({ stdout: '', stderr: '' }));
    const lines = diskSpace.stdout.split('\n');
    const diskInfo = lines[1] ? lines[1].split(/\s+/) : [];
    const availableSpace = diskInfo[3] ? parseInt(diskInfo[3]) * 1024 : 0;
    const totalSpace = diskInfo[1] ? parseInt(diskInfo[1]) * 1024 : 0;

    let cacheSizeBytes = 0;
    try {
      const duOutput = await execAsync(`du -sb ${CACHE_DIR}`).catch(() => ({ stdout: '0', stderr: '' }));
      cacheSizeBytes = parseInt(duOutput.stdout.split('\t')[0]) || 0;
    } catch { /* du may fail */ }

    const hostDataDir = process.env.HOST_DATA_DIR || STORAGE_DIR;
    const containerDataDir = path.resolve(STORAGE_DIR);
    const hostCacheDir = (process.env.HOST_DATA_DIR && CACHE_DIR.startsWith(containerDataDir))
      ? CACHE_DIR.replace(containerDataDir, hostDataDir)
      : CACHE_DIR;

    return {
      ocMirrorVersion: parseOcMirrorVersion(ocMirrorVersion.stdout.trim()),
      systemArchitecture: systemArch.stdout.trim(),
      availableDiskSpace: availableSpace,
      totalDiskSpace: totalSpace,
      hostDataDir,
      cacheDir: CACHE_DIR,
      hostCacheDir,
      cacheSizeBytes,
    };
  } catch (error: unknown) {
    console.error('Error getting system info:', error);
    const hostDataDir = process.env.HOST_DATA_DIR || STORAGE_DIR;
    const containerDataDir = path.resolve(STORAGE_DIR);
    const hostCacheDir = (process.env.HOST_DATA_DIR && CACHE_DIR.startsWith(containerDataDir))
      ? CACHE_DIR.replace(containerDataDir, hostDataDir)
      : CACHE_DIR;

    return {
      ocMirrorVersion: 'Not available',
      systemArchitecture: 'Not available',
      availableDiskSpace: 0,
      totalDiskSpace: 0,
      hostDataDir,
      cacheDir: CACHE_DIR,
      hostCacheDir,
      cacheSizeBytes: 0,
    };
  }
}

async function getOperations(): Promise<OperationRecord[]> {
  try {
    const files = await fsp.readdir(OPERATIONS_DIR);
    const operations: OperationRecord[] = [];

    for (const file of files) {
      if (file.endsWith('.json')) {
        const content = await fsp.readFile(path.join(OPERATIONS_DIR, file), 'utf8');
        operations.push(JSON.parse(content));
      }
    }

    return operations.sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());
  } catch (error: unknown) {
    console.error('Error reading operations:', error);
    return [];
  }
}

async function saveOperation(operation: OperationRecord): Promise<void> {
  const filename = `${operation.id}.json`;
  await fsp.writeFile(path.join(OPERATIONS_DIR, filename), JSON.stringify(operation, null, 2));
}

async function updateOperation(operationId: string, updates: Partial<OperationRecord>): Promise<OperationRecord | null> {
  const filename = `${operationId}.json`;
  const filepath = path.join(OPERATIONS_DIR, filename);

  try {
    const content = await fsp.readFile(filepath, 'utf8');
    const operation: OperationRecord = JSON.parse(content);
    const updatedOperation = { ...operation, ...updates };
    await fsp.writeFile(filepath, JSON.stringify(updatedOperation, null, 2));
    return updatedOperation;
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    console.error('Error updating operation:', error);
    throw error;
  }
}

async function getOperation(operationId: string): Promise<OperationRecord> {
  const filename = `${operationId}.json`;
  const filepath = path.join(OPERATIONS_DIR, filename);

  try {
    const content = await fsp.readFile(filepath, 'utf8');
    return JSON.parse(content);
  } catch (error: unknown) {
    console.error('Error reading operation:', error);
    throw error;
  }
}

async function getSystemHealth(): Promise<string> {
  let ocMirrorOk = false;
  try { await execAsync('oc-mirror version'); ocMirrorOk = true; } catch { /* not installed */ }

  let diskOk = false;
  try {
    const diskSpace = await execAsync(`df -k ${STORAGE_DIR}`);
    const lines = diskSpace.stdout.split('\n');
    const diskInfo = lines[1] ? lines[1].split(/\s+/) : [];
    const availableSpace = diskInfo[3] ? parseInt(diskInfo[3]) * 1024 : 0;
    diskOk = availableSpace > 30_000_000_000;
  } catch { /* df may fail */ }

  if (!ocMirrorOk) return 'error';
  if (!diskOk) return 'degraded';
  return 'healthy';
}

let preFetchedCatalogData: PreFetchedCatalogData | null = null;
const RUNTIME_CATALOG_DIR = path.join(STORAGE_DIR, 'catalog-data');
const BUILTIN_CATALOG_DIR = path.join(__dirname, '../catalog-data');

async function resolveCatalogDataDir(): Promise<string> {
  const runtimeIndex = path.join(RUNTIME_CATALOG_DIR, 'catalog-index.json');
  try {
    await fsp.access(runtimeIndex, fs.constants.R_OK);
    console.log(`Using runtime catalog data from ${RUNTIME_CATALOG_DIR}`);
    return RUNTIME_CATALOG_DIR;
  } catch {
    console.log(`Using built-in catalog data from ${BUILTIN_CATALOG_DIR}`);
    return BUILTIN_CATALOG_DIR;
  }
}

async function loadPreFetchedCatalogData(): Promise<PreFetchedCatalogData | null> {
  if (preFetchedCatalogData) {
    return preFetchedCatalogData;
  }

  try {
    const catalogDir = await resolveCatalogDataDir();
    const catalogIndexPath = path.join(catalogDir, 'catalog-index.json');
    const catalogIndex = JSON.parse(await fsp.readFile(catalogIndexPath, 'utf8'));

    preFetchedCatalogData = {
      index: catalogIndex,
      operators: {},
      channels: {},
    };

    let totalOperators = 0;

    for (const catalog of catalogIndex.catalogs) {
      const operatorsPath = path.join(catalogDir, `${catalog.catalog_type}/${catalog.ocp_version}/operators.json`);
      try {
        const operators: OperatorEntry[] = JSON.parse(await fsp.readFile(operatorsPath, 'utf8'));
        const key = `${catalog.catalog_type}:${catalog.ocp_version}`;
        preFetchedCatalogData.operators[key] = operators;
        totalOperators += operators.length;

        operators.forEach((operator: OperatorEntry) => {
          const channelKey = `${operator.name}:${catalog.catalog_type}:${catalog.ocp_version}`;
          preFetchedCatalogData!.channels[channelKey] = operator.channels || [];
        });

        console.log(`Loaded ${operators.length} operators for ${key}`);
      } catch (error: unknown) {
        console.warn(`Could not load operators for ${catalog.catalog_type}:${catalog.ocp_version}:`, (error as Error).message);
      }
    }

    console.log(`Pre-fetched catalog data loaded successfully with ${totalOperators} total operators`);
    return preFetchedCatalogData;
  } catch (error: unknown) {
    console.error('Error loading pre-fetched catalog data:', error);
    return null;
  }
}

async function queryOperatorCatalog(catalogUrl: string): Promise<{ name: string }[]> {
  try {
    const catalogData = await loadPreFetchedCatalogData();
    if (catalogData) {
      const catalogType = getCatalogNameFromUrl(catalogUrl);
      const catalogVersion = catalogUrl.includes(':') ? catalogUrl.split(':')[1] : 'v4.21';
      const key = `${catalogType}:${catalogVersion}`;

      if (catalogData.operators[key]) {
        console.log(`Using pre-fetched data for catalog: ${catalogUrl}`);
        return catalogData.operators[key].map(op => ({ name: op.name }));
      }
    }

    console.error(`[ERROR] Catalog data not found for ${catalogUrl}. Catalog data should be pre-fetched during build.`);
    return [];
  } catch (error: unknown) {
    console.error(`Error querying catalog ${catalogUrl}:`, error);
    return [];
  }
}

async function queryOperatorChannels(catalogUrl: string, operatorName: string): Promise<(string | { name: string })[]> {
  try {
    const catalogType = getCatalogNameFromUrl(catalogUrl);
    const catalogVersion = catalogUrl.includes(':') ? catalogUrl.split(':')[1] : 'v4.21';

    const actualChannels = await getActualChannelsFromCatalog(catalogType, catalogVersion, operatorName);
    if (actualChannels && actualChannels.length > 0) {
      console.log(`Using actual catalog data for ${operatorName} from ${catalogVersion} catalog`);
      return actualChannels;
    }

    const catalogData = await loadPreFetchedCatalogData();
    if (catalogData) {
      const key = `${operatorName}:${catalogType}:${catalogVersion}`;

      if (catalogData.channels[key]) {
        console.log(`Using pre-fetched channels for ${operatorName} from ${catalogVersion} catalog`);
        return catalogData.channels[key];
      }
    }

    console.error(`[ERROR] Channel data not found for ${operatorName} in ${catalogUrl}. Catalog data should be pre-fetched during build.`);
    return [];
  } catch (error: unknown) {
    console.error(`Error querying channels for ${operatorName} from ${catalogUrl}:`, error);
    return [];
  }
}

async function getActualChannelsFromCatalog(catalogType: string, catalogVersion: string, operatorName: string): Promise<ChannelObject[] | null> {
  try {
    const catalogData = await loadPreFetchedCatalogData();
    if (catalogData) {
      const key = `${catalogType}:${catalogVersion}`;
      const operators = catalogData.operators[key];

      if (operators) {
        const operator = operators.find(op => op.name === operatorName);
        const channels = getChannelObjectsFromGeneratedOperator(operator);
        if (channels) {
          console.log(`Found ${channels.length} channels for ${operatorName} in ${catalogType}:${catalogVersion} using generated metadata`);
          return channels;
        }
      }
    }

    return null;
  } catch (error: unknown) {
    console.error(`Error reading generated catalog data for ${operatorName} in ${catalogType}:${catalogVersion}:`, (error as Error).message);
    return null;
  }
}

let dependenciesDataCache: Record<string, Record<string, OperatorDependency[]>> | null = null;

async function loadDependenciesData(): Promise<Record<string, Record<string, OperatorDependency[]>> | null> {
  if (dependenciesDataCache) {
    return dependenciesDataCache;
  }

  try {
    const catalogDir = await resolveCatalogDataDir();
    const catalogIndexPath = path.join(catalogDir, 'catalog-index.json');
    const catalogIndex = JSON.parse(await fsp.readFile(catalogIndexPath, 'utf8'));
    const merged: Record<string, Record<string, OperatorDependency[]>> = {};

    for (const catalog of catalogIndex.catalogs) {
      const depsPath = path.join(catalogDir, `${catalog.catalog_type}/${catalog.ocp_version}/dependencies.json`);
      try {
        const deps = JSON.parse(await fsp.readFile(depsPath, 'utf8'));
        const key = `${catalog.catalog_type}:${catalog.ocp_version}`;
        merged[key] = deps;
      } catch {
        // Per-catalog dependencies file may not exist for all catalogs
      }
    }

    dependenciesDataCache = merged;
    console.log(`Loaded dependencies data from ${Object.keys(merged).length} per-catalog files`);
    return dependenciesDataCache;
  } catch {
    console.log('Could not load dependencies data, dependency detection may be limited');
    return null;
  }
}

async function getOperatorDependencies(catalogType: string, catalogVersion: string, operatorName: string): Promise<OperatorDependency[]> {
  try {
    let dependencies: OperatorDependency[] = [];
    let dependencyPackageName: string | null = null;

    const dependenciesData = await loadDependenciesData();

    if (dependenciesData) {
      const catalogKey = `${catalogType}:${catalogVersion}`;
      const catalogDeps = dependenciesData[catalogKey];

      if (catalogDeps) {
        if (catalogDeps[operatorName]) {
          dependencies = [...catalogDeps[operatorName]];
        }

        const dependencyPackageNames: string[] = [];

        if (operatorName.endsWith('-operator')) {
          const baseName = operatorName.replace(/-operator$/, '');
          dependencyPackageNames.push(`${baseName}-dependencies`);
        }

        dependencyPackageNames.push(
          `${operatorName}-dependencies`,
          `${operatorName}-dependency`,
          `${operatorName}-deps`,
        );

        for (const depPackageName of dependencyPackageNames) {
          if (catalogDeps[depPackageName]) {
            const depDependencies = catalogDeps[depPackageName];
            dependencies = dependencies.concat(depDependencies);
            dependencyPackageName = depPackageName;
            console.log(`Found ${depDependencies.length} dependencies in ${depPackageName} for ${operatorName}`);
            break;
          }
      }
    }
  }

  if (dependencyPackageName) {
      const catalogData = await loadPreFetchedCatalogData();
      if (catalogData) {
        const key = `${catalogType}:${catalogVersion}`;
        const operators = catalogData.operators[key];

        if (operators) {
          const depPackageInfo = operators.find(op => op.name === dependencyPackageName);
          if (depPackageInfo) {
            const alreadyExists = dependencies.some(dep => dep.packageName === dependencyPackageName);
            if (!alreadyExists) {
              dependencies.push({
                packageName: dependencyPackageName!,
                versionRange: null,
                displayName: depPackageInfo.name,
                catalog: depPackageInfo.catalog,
                catalogUrl: depPackageInfo.catalogUrl,
                defaultChannel: depPackageInfo.defaultChannel,
                isDependencyPackage: true,
              });
            }
          }
      }
    }
  }

  const uniqueDependencies = dependencies.filter((dep, index, self) =>
      index === self.findIndex(d => d.packageName === dep.packageName),
  );

  const catalogData = await loadPreFetchedCatalogData();
    if (catalogData) {
      const key = `${catalogType}:${catalogVersion}`;
      const operators = catalogData.operators[key];

      if (operators) {
        uniqueDependencies.forEach(dep => {
          const operatorInfo = operators.find(op => op.name === dep.packageName);
          if (operatorInfo) {
            dep.displayName = dep.displayName || operatorInfo.name;
            dep.catalog = dep.catalog || operatorInfo.catalog;
            dep.catalogUrl = dep.catalogUrl || operatorInfo.catalogUrl;
            dep.defaultChannel = dep.defaultChannel || operatorInfo.defaultChannel;
          }
        });
      }
    }

    return uniqueDependencies;
  } catch (error: unknown) {
    console.error(`Error getting dependencies for ${operatorName} in ${catalogType}:${catalogVersion}:`, (error as Error).message);
    return [];
  }
}

const operatorCache: OperatorCache = {
  catalogs: [],
  operators: {},
  channels: {},
  lastUpdate: null,
  cacheTimeout: 3600000,
};

/**
 * Integration tests only: when `process.env.VITEST` is set, the next matching request
 * throws before normal handling so the route `catch` returns 500 (not fake fallback data).
 */
export const __routeTestHooks = {
  failNextCatalogsGet: false,
  failNextOperatorsGet: false,
};

function isCacheValid(): boolean {
  return operatorCache.lastUpdate !== null &&
         (Date.now() - operatorCache.lastUpdate) < operatorCache.cacheTimeout;
}

async function updateOperatorCache(): Promise<OperatorCache> {
  if (isCacheValid()) {
    return operatorCache;
  }

  console.log('Updating operator cache...');

  const catalogData = await loadPreFetchedCatalogData();

  if (catalogData && catalogData.index.catalogs.length > 0) {
    console.log('Using pre-fetched catalog data for cache update');

    const catalogs: CatalogEntry[] = catalogData.index.catalogs.map(catalog => ({
      name: catalog.catalog_type,
      url: catalog.catalog_url,
      description: getCatalogDescription(catalog.catalog_type),
      ocpVersion: catalog.ocp_version,
      digest: catalog.digest,
      syncedAt: catalog.synced_at,
    }));

    const catalogResults: CatalogEntry[] = catalogs.map(catalog => {
      const key = `${catalog.name}:${catalog.ocpVersion}`;
      const operators = catalogData.operators[key] || [];
      return {
        ...catalog,
        operators: operators.map(op => ({ name: op.name })),
      };
    });

    operatorCache.catalogs = catalogResults;
    operatorCache.operators = {};
    operatorCache.channels = {};
    operatorCache.lastUpdate = Date.now();

    catalogResults.forEach(catalog => {
      if (catalog.operators && Array.isArray(catalog.operators)) {
        catalog.operators.forEach(operator => {
          const uniqueKey = `${operator.name}:${catalog.url}`;
          operatorCache.operators[uniqueKey] = {
            ...operator,
            catalog: catalog.url,
            ocpVersion: catalog.ocpVersion,
          };
        });
      }
    });

    console.log(`Cache updated with ${Object.keys(operatorCache.operators).length} operators from pre-fetched data`);
    return operatorCache;
  }

  console.log('Using fallback static catalogs');

  const catalogs: CatalogEntry[] = [
    {
      name: 'redhat-operator-index',
      url: 'registry.redhat.io/redhat/redhat-operator-index',
      description: 'Red Hat certified operators',
    },
    {
      name: 'certified-operator-index',
      url: 'registry.redhat.io/redhat/certified-operator-index',
      description: 'Certified operators from partners',
    },
    {
      name: 'community-operator-index',
      url: 'registry.redhat.io/redhat/community-operator-index',
      description: 'Community operators',
    },
  ];

  const catalogPromises = catalogs.map(async (catalog) => {
    const operators = await queryOperatorCatalog(catalog.url);
    return {
      ...catalog,
      operators: operators || [],
    };
  });

  const catalogResults = await Promise.all(catalogPromises);

  operatorCache.catalogs = catalogResults;
  operatorCache.operators = {};
  operatorCache.channels = {};
  operatorCache.lastUpdate = Date.now();

  catalogResults.forEach(catalog => {
    if (catalog.operators && Array.isArray(catalog.operators)) {
      catalog.operators.forEach(operator => {
        operatorCache.operators[operator.name] = {
          ...operator,
          catalog: catalog.url,
        };
      });
    }
  });

  console.log(`Cache updated with ${Object.keys(operatorCache.operators).length} operators`);
  return operatorCache;
}

app.get('/api/stats', async (req: Request, res: Response) => {
  try {
    const operations = await getOperations();
    const stats = {
      totalOperations: operations.length,
      successfulOperations: operations.filter(op => op.status === 'success').length,
      failedOperations: operations.filter(op => op.status === 'failed').length,
      runningOperations: operations.filter(op => op.status === 'running').length,
    };
    res.json(stats);
  } catch {
    res.status(500).json({ error: 'Failed to get statistics' });
  }
});

app.get('/api/operations/recent', async (req: Request, res: Response) => {
  try {
    const operations = await getOperations();
    const recent = operations.slice(0, 10); // Get last 10 operations
    res.json(recent);
  } catch {
    res.status(500).json({ error: 'Failed to get recent operations' });
  }
});

app.get('/api/health', (req: Request, res: Response) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    service: 'mirror-gui',
  });
});

app.get('/api/system/status', async (req: Request, res: Response) => {
  try {
    const systemInfo = await getSystemInfo();
    const systemHealth = await getSystemHealth();
    res.json({
      ocMirrorVersion: systemInfo.ocMirrorVersion,
      systemHealth,
      pullSecretDetected,
    });
  } catch {
    res.status(500).json({ error: 'Failed to get system status' });
  }
});

app.get('/api/pull-secret/status', (_req: Request, res: Response) => {
  res.json({ detected: pullSecretDetected, path: pullSecretPath });
});

app.get('/api/pull-secret/content', async (_req: Request, res: Response) => {
  try {
    if (!pullSecretDetected || !pullSecretPath) {
      res.json({ content: '' });
      return;
    }
    const content = await fsp.readFile(pullSecretPath, 'utf8');
    res.json({ content });
  } catch {
    res.json({ content: '' });
  }
});

app.post('/api/pull-secret', async (req: Request, res: Response) => {
  try {
    const { content } = req.body;
    if (!content || typeof content !== 'string' || content.trim().length < 2) {
      res.status(400).json({ error: 'Invalid pull secret content' });
      return;
    }

    try {
      JSON.parse(content);
    } catch {
      res.status(400).json({ error: 'Pull secret must be valid JSON' });
      return;
    }

    await fsp.writeFile(AUTHFILE_PATH, content, 'utf8');
    pullSecretPath = AUTHFILE_PATH;
    pullSecretDetected = true;
    console.log(`Pull secret saved to: ${AUTHFILE_PATH}`);
    res.json({ message: 'Pull secret saved successfully' });
  } catch (error: unknown) {
    console.error('Error saving pull secret:', error);
    res.status(500).json({ error: 'Failed to save pull secret' });
  }
});

app.delete('/api/pull-secret', async (_req: Request, res: Response) => {
  try {
    if (pullSecretPath) {
      try {
        await fsp.rm(pullSecretPath, { force: true });
      } catch {
        await fsp.writeFile(pullSecretPath, '', 'utf8');
      }
    }
    pullSecretPath = null;
    pullSecretDetected = false;
    console.log('Pull secret removed');
    res.json({ message: 'Pull secret removed successfully' });
  } catch (error: unknown) {
    console.error('Error removing pull secret:', error);
    res.status(500).json({ error: 'Failed to remove pull secret' });
  }
});

app.get('/api/system/paths', async (req: Request, res: Response) => {
  try {
    const commonPaths = [
      {
        path: DEFAULT_MIRROR_DIR,
        label: 'Default (Persistent)',
        description: 'Recommended - primary persistent mirror location',
        available: false,
      },
      {
        path: MIRROR_BASE_DIR,
        label: 'Data Mirrors Root',
        description: 'Persistent - create subdirectories as needed',
        available: false,
      },
      {
        path: CUSTOM_MIRROR_DIR,
        label: 'Custom Directory',
        description: 'Persistent - custom subdirectory for this operation',
        available: false,
      },
      {
        path: EPHEMERAL_MIRROR_DIR,
        label: 'App Mirror (Ephemeral)',
        description: 'Ephemeral mirror path under the app root',
        available: false,
      },
    ];

    const availablePaths = [];
    for (const pathInfo of commonPaths) {
      try {
        pathInfo.available = await isPathAvailable(pathInfo.path);
      } catch {
        pathInfo.available = false;
      }
      availablePaths.push(pathInfo);
    }

    res.json({ paths: availablePaths });
  } catch (error: unknown) {
    console.error('Error listing paths:', error);
    res.status(500).json({ error: 'Failed to list available paths' });
  }
});

app.get('/api/mirror-folders', async (_req: Request, res: Response) => {
  try {
    const entries = await fsp.readdir(MIRROR_BASE_DIR, { withFileTypes: true });
    const folders = entries
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort();
    res.json({ folders });
  } catch {
    res.json({ folders: [] });
  }
});

app.post('/api/mirror-folders', async (req: Request, res: Response) => {
  const { name } = req.body || {};
  if (!name || typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ error: 'Folder name is required' });
  }
  const trimmed = name.trim();
  if (trimmed.includes('/') || trimmed.includes('..') || trimmed.includes('\\')) {
    return res.status(400).json({ error: 'Folder name cannot contain path separators or traversal characters' });
  }
  if (!/^[a-zA-Z0-9_-]+$/.test(trimmed)) {
    return res.status(400).json({ error: 'Use only letters, numbers, dashes, and underscores' });
  }
  try {
    const folderPath = path.join(MIRROR_BASE_DIR, trimmed);
    await fsp.mkdir(folderPath, { recursive: true, mode: 0o775 });
    res.json({ created: trimmed, path: folderPath });
  } catch (error: unknown) {
    console.error('Error creating mirror folder:', error);
    res.status(500).json({ error: 'Failed to create folder', details: (error as Error).message });
  }
});

app.get('/api/config/list', async (req: Request, res: Response) => {
  try {
    const files = await fsp.readdir(CONFIGS_DIR);
    const configs = [];

    for (const file of files) {
      if (file.endsWith('.yaml') || file.endsWith('.yml')) {
        const stats = await fsp.stat(path.join(CONFIGS_DIR, file));
        configs.push({
          name: file,
          size: `${(stats.size / 1024).toFixed(2)} KB`,
          modified: stats.mtime,
        });
      }
    }

    res.json(configs);
  } catch {
    res.status(500).json({ error: 'Failed to list configurations' });
  }
});

app.get('/api/config/download/:filename', async (req: Request, res: Response) => {
  const basename = path.basename(req.params.filename || '');
  if (!basename || !/\.(ya?ml)$/i.test(basename)) {
    return res.status(400).json({ error: 'Invalid filename' });
  }
  const filepath = path.resolve(CONFIGS_DIR, basename);
  const configsDirResolved = path.resolve(CONFIGS_DIR);
  if (!filepath.startsWith(configsDirResolved + path.sep) && filepath !== configsDirResolved) {
    return res.status(400).json({ error: 'Invalid filename' });
  }
  try {
    await fsp.access(filepath);
    res.setHeader('Content-Disposition', `attachment; filename="${basename}"`);
    res.setHeader('Content-Type', 'application/x-yaml');
    res.sendFile(filepath);
  } catch {
    res.status(404).json({ error: 'Configuration file not found' });
  }
});

app.post('/api/config/save', async (req: Request, res: Response) => {
  try {
    const { config, name } = req.body;

    if (name !== undefined && name !== null && name !== '') {
      if (typeof name !== 'string') {
        return res.status(400).json({ error: 'name must be a string' });
      }
      if (name !== path.basename(name)) {
        return res.status(400).json({ error: 'Invalid filename' });
      }
    }

    if (config === undefined || config === null || config === '') {
      return res.status(400).json({ error: 'config is required' });
    }

    let yamlString: string;
    if (typeof config === 'string') {
      yamlString = config;
    } else if (typeof config === 'object' && !Array.isArray(config)) {
      yamlString = YAML.stringify(config);
    } else {
      return res.status(400).json({ error: 'config must be a YAML string or JSON object' });
    }

    try {
      const parsed = YAML.parse(yamlString);
      if (!parsed?.kind || parsed.kind !== 'ImageSetConfiguration') {
        return res.status(400).json({ error: 'Invalid configuration: Must be an ImageSetConfiguration' });
      }
      if (!parsed.apiVersion || !parsed.apiVersion.includes('mirror.openshift.io')) {
        return res.status(400).json({ error: 'Invalid configuration: Must have mirror.openshift.io API version' });
      }
      if (!parsed.mirror) {
        return res.status(400).json({ error: 'Invalid configuration: Missing mirror section' });
      }
    } catch (yamlError: unknown) {
      return res.status(400).json({ error: `Invalid YAML: ${(yamlError as Error).message}` });
    }

    const rawName = name || `imageset-config-${Date.now()}.yaml`;
    const filename = rawName.endsWith('.yaml') || rawName.endsWith('.yml')
      ? rawName
      : `${rawName}.yaml`;
    const filepath = path.join(CONFIGS_DIR, filename);
    await fsp.writeFile(filepath, yamlString);
    res.json({ message: 'Configuration saved successfully', filename });
  } catch (err) {
    console.error('Failed to save configuration:', err);
    res.status(500).json({ error: 'Failed to save configuration' });
  }
});

app.post('/api/config/upload', async (req: Request, res: Response) => {
  try {
    const { filename, content } = req.body;

    if (!filename || !content) {
      return res.status(400).json({ error: 'Filename and content are required' });
    }

    try {
      const parsed = YAML.parse(content);

      if (!parsed.kind || parsed.kind !== 'ImageSetConfiguration') {
        return res.status(400).json({ error: 'Invalid YAML: Must be an ImageSetConfiguration' });
      }

      if (!parsed.apiVersion || !parsed.apiVersion.includes('mirror.openshift.io')) {
        return res.status(400).json({ error: 'Invalid YAML: Must have mirror.openshift.io API version' });
      }

      if (!parsed.mirror) {
        return res.status(400).json({ error: 'Invalid YAML: Missing mirror section' });
      }
    } catch (yamlError: unknown) {
      return res.status(400).json({ error: `Invalid YAML: ${(yamlError as Error).message}` });
    }

    const finalFilename = filename.endsWith('.yaml') || filename.endsWith('.yml')
      ? filename
      : `${filename}.yaml`;

    const filepath = path.join(CONFIGS_DIR, finalFilename);

    try {
      await fsp.access(filepath);
      return res.status(409).json({ error: 'Configuration file already exists' });
    } catch { /* file does not exist, proceed */ }

    await fsp.writeFile(filepath, content);
    res.json({ message: 'Configuration uploaded successfully', filename: finalFilename });
  } catch (error: unknown) {
    console.error('Error uploading configuration:', error);
    res.status(500).json({ error: 'Failed to upload configuration' });
  }
});

app.delete('/api/config/delete/:filename', async (req: Request, res: Response) => {
  try {
    const { filename } = req.params;

    if (!filename) {
      return res.status(400).json({ error: 'Filename is required' });
    }

    if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
      return res.status(400).json({ error: 'Invalid filename' });
    }

    const filepath = path.join(CONFIGS_DIR, filename);

    try {
      await fsp.access(filepath);
    } catch {
      return res.status(404).json({ error: 'Configuration file not found' });
    }

    await fsp.unlink(filepath);
    res.json({ message: 'Configuration deleted successfully' });
  } catch (error: unknown) {
    console.error('Error deleting configuration:', error);
    res.status(500).json({ error: 'Failed to delete configuration' });
  }
});

app.get('/api/channels', async (req: Request, res: Response) => {
  try {
    const channels = [
      'stable-4.16', 'stable-4.17', 'stable-4.18', 'stable-4.19', 'stable-4.20', 'stable-4.21', 'stable-4.22',
    ];
    res.json(channels);
  } catch {
    res.status(500).json({ error: 'Failed to get channels' });
  }
});

app.get('/api/catalogs', async (req: Request, res: Response) => {
  try {
    if (process.env.VITEST === 'true' && __routeTestHooks.failNextCatalogsGet) {
      __routeTestHooks.failNextCatalogsGet = false;
      throw new Error('forced failure for catalogs route (test)');
    }
    const cache = await updateOperatorCache();
    const catalogs = cache.catalogs.map(catalog => ({
      name: catalog.name,
      url: catalog.url,
      description: catalog.description,
      operatorCount: catalog.operators ? catalog.operators.length : 0,
      digest: catalog.digest || null,
      syncedAt: catalog.syncedAt || null,
    }));
    res.json(catalogs);
  } catch (error: unknown) {
    console.error('Error fetching catalogs:', error);
    res.status(500).json({ error: 'Failed to get catalogs' });
  }
});

app.get('/api/operators', async (req: Request, res: Response) => {
  try {
    if (process.env.VITEST === 'true' && __routeTestHooks.failNextOperatorsGet) {
      __routeTestHooks.failNextOperatorsGet = false;
      throw new Error('forced failure for operators route (test)');
    }
    const { catalog, detailed } = req.query;

    if (catalog) {
      const catalogData = await loadPreFetchedCatalogData();
      if (catalogData) {
        const catalogType = getCatalogNameFromUrl(catalog as string);
        const catalogVersion = (catalog as string).includes(':') ? (catalog as string).split(':')[1] : 'v4.21';
        const key = `${catalogType}:${catalogVersion}`;

        const operators = catalogData.operators[key];
        if (operators) {
          if (detailed === 'true') {
            const detailedOperators = operators.map(operator => {
              const normalizedChannels = normalizeChannels(operator.channels || [], operator.name, operator);
              return {
                name: operator.name,
                defaultChannel: operator.defaultChannel,
                channels: normalizedChannels,
                allChannels: normalizedChannels.map(ch => ch.name),
                catalog: operator.catalog,
                ocpVersion: operator.ocpVersion,
                catalogUrl: operator.catalogUrl,
              };
            });
            res.json(detailedOperators);
          } else {
            res.json(operators.map(operator => operator.name));
          }
          return;
        }
      }

      const cache = await updateOperatorCache();
      const allOperators = Object.values(cache.operators);
      const filteredOperators = allOperators
        .filter(operator => operator.catalog === catalog);

      if (detailed === 'true') {
        const detailedOperators = filteredOperators.map(operator => {
          const normalizedChannels = normalizeChannels(operator.channels || [], operator.name, operator);
          return {
            name: operator.name,
            defaultChannel: operator.defaultChannel,
            channels: normalizedChannels,
            allChannels: normalizedChannels.map(ch => ch.name),
            catalog: operator.catalog,
            ocpVersion: operator.ocpVersion,
            catalogUrl: operator.catalogUrl,
          };
        });
        res.json(detailedOperators);
      } else {
        res.json(filteredOperators.map(operator => operator.name));
      }
    } else {
      const cache = await updateOperatorCache();
      const uniqueOperators = [...new Set(Object.values(cache.operators).map(op => op.name))];
      res.json(uniqueOperators);
    }
  } catch (error: unknown) {
    console.error('Error fetching operators:', error);
    res.status(500).json({ error: 'Failed to get operators' });
  }
});

app.post('/api/operators/refresh-cache', async (req: Request, res: Response) => {
  try {
    operatorCache.lastUpdate = null;
    await updateOperatorCache();
    res.json({ message: 'Operator cache refreshed successfully' });
  } catch (error: unknown) {
    console.error('Error refreshing operator cache:', error);
    res.status(500).json({ error: 'Failed to refresh operator cache' });
  }
});

app.get('/api/operators/:operator/versions', async (req: Request, res: Response) => {
  try {
    const { operator } = req.params;
    const catalog = getQueryStringValue(req.query.catalog);
    const channel = getQueryStringValue(req.query.channel);

    const catalogData = await loadPreFetchedCatalogData();
    if (catalogData) {
      if (catalog) {
        const catalogType = getCatalogNameFromUrl(catalog);
        const catalogVersion = catalog.includes(':') ? catalog.split(':')[1] : 'v4.21';
        const key = `${catalogType}:${catalogVersion}`;

        const operators = catalogData.operators[key];
        if (operators) {
          const operatorData = operators.find(op => op.name === operator);
          if (operatorData) {
            return res.json({ versions: getVersionsFromMetadata(operatorData, channel) });
          }
        }
      } else {
        for (const operators of Object.values(catalogData.operators)) {
          const operatorData = operators.find(op => op.name === operator);
          if (operatorData) {
            return res.json({ versions: getVersionsFromMetadata(operatorData, channel) });
          }
        }
      }
    }

    res.status(404).json({ error: 'Operator not found' });

  } catch (error: unknown) {
    console.error(`Error getting versions for ${req.params.operator}:`, error);
    res.status(500).json({ error: 'Failed to get operator versions' });
  }
});

app.get('/api/operator-channels/:operator', async (req: Request, res: Response) => {
  try {
    const { operator } = req.params;
    const catalogUrl = getQueryStringValue(req.query.catalogUrl);

    const catalogData = await loadPreFetchedCatalogData();
    if (catalogData) {
      if (catalogUrl) {
        const catalogType = getCatalogNameFromUrl(catalogUrl);
        const catalogVersion = catalogUrl.includes(':') ? catalogUrl.split(':')[1] : 'v4.21';
        const key = `${catalogType}:${catalogVersion}`;

        const operators = catalogData.operators[key];
        if (operators) {
          const operatorData = operators.find(op => op.name === operator);
          if (operatorData) {
            const normalizedChannels = normalizeChannels(operatorData.channels || [], operatorData.name, operatorData);
            return res.json({
              name: operatorData.name,
              defaultChannel: operatorData.defaultChannel,
              channels: normalizedChannels,
              allChannels: normalizedChannels.map(ch => ch.name),
              catalog: operatorData.catalog,
              ocpVersion: operatorData.ocpVersion,
              catalogUrl: operatorData.catalogUrl,
            });
          }
        }
      } else {
        for (const operators of Object.values(catalogData.operators)) {
          const operatorData = operators.find(op => op.name === operator);
          if (operatorData) {
            const normalizedChannels = normalizeChannels(operatorData.channels || [], operatorData.name, operatorData);
            return res.json({
              name: operatorData.name,
              defaultChannel: operatorData.defaultChannel,
              channels: normalizedChannels,
              allChannels: normalizedChannels.map(ch => ch.name),
              catalog: operatorData.catalog,
              ocpVersion: operatorData.ocpVersion,
              catalogUrl: operatorData.catalogUrl,
            });
          }
        }
      }
    }

    if (catalogUrl) {
      const channels = await queryOperatorChannels(catalogUrl as string, operator);
      if (channels && Array.isArray(channels) && channels.length > 0) {
        const normalizedChannels = normalizeChannels(channels, operator);
        return res.json(normalizedChannels);
      }
    }

    if (operatorCache.channels[operator] && isCacheValid()) {
      const normalizedChannels = normalizeChannels(operatorCache.channels[operator], operator);
      return res.json(normalizedChannels);
    }

    const cache = await updateOperatorCache();
    const operatorInfo = Object.values(cache.operators).find(op => op.name === operator);

    if (!operatorInfo) {
      return res.status(404).json({ error: 'Operator not found' });
    }

    const channels = await queryOperatorChannels(operatorInfo.catalog!, operator);

    if (channels && Array.isArray(channels) && channels.length > 0) {
      operatorCache.channels[operator] = channels;
      const normalizedChannels = normalizeChannels(channels, operator);
      return res.json(normalizedChannels);
    }

    res.status(404).json({ error: 'No channels found for this operator' });
  } catch (error: unknown) {
    console.error(`Error fetching channels for ${req.params.operator}:`, error);
    res.status(500).json({ error: 'Failed to get operator channels' });
  }
});

app.get('/api/operators/channels', async (req: Request, res: Response) => {
  try {
    const { catalogUrl, operatorName } = req.query;

    if (!catalogUrl || !operatorName) {
      return res.status(400).json({ error: 'catalogUrl and operatorName query parameters are required' });
    }

    const channels = await queryOperatorChannels(catalogUrl as string, operatorName as string);
    if (channels && Array.isArray(channels) && channels.length > 0) {
      const normalizedChannels = normalizeChannels(channels, operatorName as string);
      return res.json(normalizedChannels);
    }

    res.status(404).json({ error: 'No channels found for this operator' });
  } catch (error: unknown) {
    console.error('Error fetching channels:', error);
    res.status(500).json({ error: 'Failed to get operator channels' });
  }
});

app.get('/api/operators/:operator/dependencies', async (req: Request, res: Response) => {
  try {
    const { operator } = req.params;
    const { catalogUrl } = req.query;

    let dependencies: OperatorDependency[] = [];
    let catalogType: string | null = null;
    let catalogVersion: string | null = null;

    if (catalogUrl) {
      catalogType = getCatalogNameFromUrl(catalogUrl as string);
      catalogVersion = (catalogUrl as string).includes(':') ? (catalogUrl as string).split(':')[1] : 'v4.21';

      dependencies = await getOperatorDependencies(catalogType, catalogVersion, operator);
    } else {
      const catalogData = await loadPreFetchedCatalogData();
      if (catalogData && catalogData.index && catalogData.index.catalogs) {
        for (const catalog of catalogData.index.catalogs) {
          const deps = await getOperatorDependencies(
            catalog.catalog_type,
            catalog.ocp_version,
            operator,
          );

          if (deps.length > 0) {
            dependencies = deps;
            catalogType = catalog.catalog_type;
            catalogVersion = catalog.ocp_version;
            break;
          }
        }
      }
    }

    if (dependencies.length === 0) {
      return res.json({
        operator,
        dependencies: [],
        message: 'No dependencies found for this operator',
      });
    }

    res.json({
      operator,
      catalogType,
      catalogVersion,
      dependencies,
      count: dependencies.length,
    });
  } catch (error: unknown) {
    console.error(`Error getting dependencies for ${req.params.operator}:`, error);
    res.status(500).json({ error: 'Failed to get operator dependencies' });
  }
});

app.get('/api/operations', async (req: Request, res: Response) => {
  try {
    const operations = await getOperations();
    res.json(operations);
  } catch {
    res.status(500).json({ error: 'Failed to get operations' });
  }
});

app.get('/api/operations/history', async (req: Request, res: Response) => {
  try {
    const operations = await getOperations();
    res.json(operations);
  } catch {
    res.status(500).json({ error: 'Failed to get operation history' });
  }
});

app.post('/api/operations/start', async (req: Request, res: Response) => {
  try {
    const { configFile, mirrorDestinationSubdir } = req.body;
    const operationId = uuidv4();
    const configPath = path.join(CONFIGS_DIR, configFile);

    try {
      await fsp.access(configPath);
    } catch {
      return res.status(404).json({ error: 'Configuration file not found' });
    }

    const cacheDir = CACHE_DIR;
    const baseMirrorPath = MIRROR_BASE_DIR;
    let subdirName = 'default';

    if (mirrorDestinationSubdir && mirrorDestinationSubdir.trim()) {
      const subdirInput = mirrorDestinationSubdir.trim();

      if (subdirInput.includes('/') || subdirInput.includes('..') || subdirInput.includes('\\')) {
        return res.status(400).json({
          error: 'Subdirectory name cannot contain path separators or traversal characters',
          provided: subdirInput,
          help: 'Use a simple name like "odf" or "production" (no slashes or special characters)',
        });
      }

      if (!subdirInput || subdirInput.length === 0) {
        return res.status(400).json({ error: 'Subdirectory name cannot be empty' });
      }

      if (!/^[a-zA-Z0-9_-]+$/.test(subdirInput)) {
        return res.status(400).json({
          error: 'Subdirectory name contains invalid characters',
          provided: subdirInput,
          help: 'Use only letters, numbers, dashes (-), and underscores (_)',
        });
      }

      subdirName = subdirInput;
    }

    const mirrorPath = path.join(baseMirrorPath, subdirName);

    try {
      await fsp.mkdir(baseMirrorPath, { recursive: true, mode: 0o777 });
      const testFile = path.join(baseMirrorPath, '.test-write');
      try {
        await fsp.writeFile(testFile, 'test', { flag: 'w' });
        await fsp.unlink(testFile);
      } catch (writeError: unknown) {
        console.error(`Cannot write to base mirror directory ${baseMirrorPath}:`, writeError);
        return res.status(500).json({
          error: 'Base mirror directory is not writable',
          path: baseMirrorPath,
          details: (writeError as Error).message,
          code: (writeError as NodeJS.ErrnoException).code,
        });
      }
    } catch (error: unknown) {
      console.error(`Error accessing base mirror directory ${baseMirrorPath}:`, error);
      return res.status(500).json({
        error: 'Cannot access base mirror directory',
        path: baseMirrorPath,
        details: (error as Error).message,
        code: (error as NodeJS.ErrnoException).code,
      });
    }

    try {
      const dirExists = await fsp.access(mirrorPath).then(() => true).catch(() => false);

      if (!dirExists) {
        await fsp.mkdir(mirrorPath, { recursive: true, mode: 0o775 });
        console.log(`Created new mirror directory: ${mirrorPath}`);
      } else {
        console.log(`Using existing mirror directory: ${mirrorPath}`);
      }

      await fsp.access(mirrorPath, fs.constants.W_OK);

      const testFile = path.join(mirrorPath, '.test-write');
      try {
        await fsp.writeFile(testFile, 'test', { flag: 'w' });
        await fsp.unlink(testFile);
      } catch (writeError: unknown) {
        console.error(`Cannot write to mirror directory ${mirrorPath}:`, writeError);
        return res.status(500).json({
          error: 'Mirror destination directory exists but is not writable',
          path: mirrorPath,
          subdirectory: subdirName,
          details: (writeError as Error).message,
          code: (writeError as NodeJS.ErrnoException).code,
          help: 'The directory exists but the container cannot write to it. Check permissions on the host.',
        });
      }
    } catch (error: unknown) {
      console.error(`Error creating/accessing mirror directory ${mirrorPath}:`, error);
      return res.status(500).json({
        error: 'Cannot create or access mirror destination directory',
        path: mirrorPath,
        subdirectory: subdirName,
        details: (error as Error).message,
        code: (error as NodeJS.ErrnoException).code,
      });
    }

    const operation: OperationRecord = {
      id: operationId,
      name: `Mirror Operation ${operationId.slice(0, 8)}`,
      configFile,
      mirrorDestination: mirrorPath,
      status: 'running',
      startedAt: new Date().toISOString(),
      logs: [],
    };

    try {
      await saveOperation(operation);
    } catch (error: unknown) {
      console.error(`Error saving operation ${operationId}:`, error);
      return res.status(500).json({
        error: 'Failed to create operation record',
        details: (error as Error).message,
      });
    }

    const logFile = path.join(LOGS_DIR, `${operationId}.log`);
    const logStream = fs.createWriteStream(logFile);
    let logStreamFinalized = false;

    const finalizeLogStream = () => {
      if (logStreamFinalized) return;
      logStreamFinalized = true;
      if (!logStream.destroyed) logStream.end();
    };

    const mirrorUrl = pathToFileURL(mirrorPath).href;

  const child = spawn('oc-mirror', [
      '--v2',
      '--config', configPath,
      '--dest-tls-verify=false',
      '--src-tls-verify=false',
      '--cache-dir', cacheDir,
      '--authfile', AUTHFILE_PATH,
      mirrorUrl,
    ], {
      stdio: ['ignore', 'pipe', 'pipe'],
      cwd: APP_ROOT_DIR,
    });

    runningProcesses.set(operationId, {
      pid: child.pid,
      child: child,
    });

    let stdout = '';
    let stderr = '';

    child.stdout!.on('data', (data: Buffer) => {
      stdout += data.toString();
      if (!logStreamFinalized) logStream.write(data);
    });

    child.stderr!.on('data', (data: Buffer) => {
      stderr += data.toString();
      if (!logStreamFinalized) logStream.write(data);
    });

    child.on('close', async (code: number | null) => {
      runningProcesses.delete(operationId);
      finalizeLogStream();

      let logs = stdout + stderr;
      if (!logs) {
        try {
          logs = await fsp.readFile(logFile, 'utf8');
        } catch { /* log file may not exist yet */ }
      }

      let finalStatus: OperationRecord['status'] = 'success';
      if (stoppedOperations.has(operationId)) {
        finalStatus = 'stopped';
        stoppedOperations.delete(operationId);
      } else if (code !== 0 || logs.toLowerCase().includes('[error]') || logs.toLowerCase().includes('error:')) {
        finalStatus = 'failed';
      }

      const completedAt = new Date().toISOString();
      const duration = Math.floor((new Date(completedAt).getTime() - new Date(operation.startedAt).getTime()) / 1000);

      let errorMessage: string | null = null;
      if (finalStatus === 'failed') {
        const errorLine = logs.split('\n').find(
          (line) => /\[error\]/i.test(line) || /\berror:/i.test(line),
        );
        if (errorLine) {
          errorMessage = errorLine
            .replace(/^\d{4}\/\d{2}\/\d{2}\s+\d{2}:\d{2}:\d{2}\s*/, '')
            // eslint-disable-next-line no-control-regex
            .replace(/\x1b\[[0-9;]*m/g, '')
            .replace(/^\s*\[ERROR\]\s*/i, '')
            .replace(/^:\s*/, '')
            .trim();
        } else {
          errorMessage = `Process exited with code ${code}`;
        }
      }

      await updateOperation(operationId, {
        status: finalStatus,
        completedAt,
        duration,
        errorMessage,
        logs: logs.split('\n'),
      });
    });

    child.on('error', async (error: Error) => {
      runningProcesses.delete(operationId);
      finalizeLogStream();

      const completedAt = new Date().toISOString();
      const duration = Math.floor((new Date(completedAt).getTime() - new Date(operation.startedAt).getTime()) / 1000);

      await updateOperation(operationId, {
        status: 'failed',
        completedAt,
        duration,
        errorMessage: (error as Error).message,
        logs: [(error as Error).message],
      });
    });

    res.json({ message: 'Operation started successfully', operationId });
  } catch (error: unknown) {
    console.error('Error starting operation:', error);
    res.status(500).json({ error: 'Failed to start operation' });
  }
});

app.post('/api/operations/:id/stop', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    stoppedOperations.add(id);

    const processInfo = runningProcesses.get(id);
    if (processInfo) {
      try {
        processInfo.child.kill('SIGTERM');

        setTimeout(() => {
          if (processInfo.child.killed === false) {
            processInfo.child.kill('SIGKILL');
          }
        }, 5000);

        runningProcesses.delete(id);
      } catch (killError: unknown) {
        console.error('Error killing process:', killError);
      }
    } else {
      stoppedOperations.delete(id);
      await updateOperation(id, {
        status: 'stopped',
        completedAt: new Date().toISOString(),
        errorMessage: null,
      });
    }

    res.json({ message: 'Operation stopped successfully' });
  } catch (error: unknown) {
    console.error('Error stopping operation:', error);
    res.status(500).json({ error: 'Failed to stop operation' });
  }
});

app.delete('/api/operations/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const filename = `${id}.json`;
    const filepath = path.join(OPERATIONS_DIR, filename);

    try {
      await fsp.unlink(filepath);
    } catch { /* file may already be deleted */ }

    res.json({ message: 'Operation deleted successfully' });
  } catch {
    res.status(500).json({ error: 'Failed to delete operation' });
  }
});

app.get('/api/operations/:id/logs', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const operation = await getOperation(id);
    let logs = '';

    const logFile = path.join(LOGS_DIR, `${id}.log`);
    try {
      logs = await fsp.readFile(logFile, 'utf8');
    } catch {
      if (operation.logs && operation.logs.length > 0) {
        logs = operation.logs.join('\n');
      }
    }

    res.json({ logs });
  } catch {
    res.status(500).json({ error: 'Failed to get operation logs' });
  }
});

app.get('/api/operations/:id/details', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    let operation: OperationRecord;
    try {
      operation = await getOperation(id);
    } catch (e: unknown) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
        return res.status(404).json({ error: 'Operation not found' });
      }
      throw e;
    }

    const details = {
      imagesMirrored: 0,
      operatorsMirrored: 0,
      totalSize: 0,
      platformImages: 0,
      additionalImages: 0,
      helmCharts: 0,
      configFile: operation.configFile,
      manifestFiles: [
        'imageContentSourcePolicy.yaml',
        'catalogSource.yaml',
        'mapping.txt',
      ],
    };

    if (operation.logs && Array.isArray(operation.logs)) {
      const logs = operation.logs.join('\n');

      const imagesToCopyMatch = logs.match(/📌 images to copy (\d+)/);
      if (imagesToCopyMatch) {
        details.imagesMirrored = parseInt(imagesToCopyMatch[1]);
      }

      const operatorSuccessMatch = logs.match(/✓ (\d+) \/ (\d+) operator images mirrored successfully/);
      if (operatorSuccessMatch) {
        details.operatorsMirrored = parseInt(operatorSuccessMatch[1]);
      }

      const catalogMatches = logs.match(/Collected catalog ([^\n]+)/g);
      if (catalogMatches) {
        details.operatorsMirrored = catalogMatches.length;
      }

      if (details.imagesMirrored > 0) {
        details.totalSize = details.imagesMirrored * 50 * 1024 * 1024;
      }

      const releaseImagesMatch = logs.match(/🔍 collecting release images/);
      if (releaseImagesMatch) {
        const releaseImagesCollected = logs.match(/Success copying.*release.*➡️ cache/g);
        if (releaseImagesCollected) {
          details.platformImages = releaseImagesCollected.length;
        } else {
          details.platformImages = 0;
        }
      } else {
        details.platformImages = 0;
      }

      const additionalImagesMatch = logs.match(/🔍 collecting additional images/);
      if (additionalImagesMatch) {
        const additionalImagesCollected = logs.match(/Success copying.*additional.*➡️ cache/g);
        if (additionalImagesCollected) {
          details.additionalImages = additionalImagesCollected.length;
        } else {
          details.additionalImages = 0;
        }
      } else {
        details.additionalImages = 0;
      }

      const helmImagesMatch = logs.match(/🔍 collecting helm images/);
      if (helmImagesMatch) {
        const helmChartsCollected = logs.match(/Success copying.*helm.*➡️ cache/g);
        if (helmChartsCollected) {
          details.helmCharts = helmChartsCollected.length;
        } else {
          details.helmCharts = 0;
        }
      } else {
        details.helmCharts = 0;
      }
    }

    res.json(details);
  } catch (error: unknown) {
    console.error('Error getting operation details:', error);
    res.status(500).json({ error: 'Failed to get operation details' });
  }
});

app.get('/api/operations/:id/logstream', (req: Request, res: Response) => {
  const { id } = req.params;
  const logFile = path.join(LOGS_DIR, `${id}.log`);

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  let filePos = 0;
  let finished = false;
  let idleTicks = 0;

  const sendNewLines = async (): Promise<void> => {
    if (finished) return;
    try {
      const stats = await fsp.stat(logFile);
      if (stats.size > filePos) {
        const stream = fs.createReadStream(logFile, { start: filePos, end: stats.size });
        stream.on('data', (chunk: Buffer | string) => {
          res.write(`data: ${chunk.toString().replace(/\n/g, '\ndata: ')}\n\n`);
        });
        stream.on('end', () => {
          filePos = stats.size;
        });
        stream.on('error', (error: Error) => {
          console.error('Error reading log stream:', error);
        });
        idleTicks = 0;
      } else {
        idleTicks += 1;
      }

      const isRunning = runningProcesses.has(id);
      if (!isRunning && idleTicks >= 2) {
        let status = 'unknown';
        try {
          const operation = await getOperation(id);
          status = operation?.status || status;
        } catch { /* operation may not exist */ }

        res.write(`event: done\ndata: ${JSON.stringify({ id, status })}\n\n`);
        finished = true;
        clearInterval(interval);
        res.end();
      }
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.error('Error streaming logs:', error);
      }
    }
  };

  const interval = setInterval(sendNewLines, 1000);
  sendNewLines();

  req.on('close', () => {
    finished = true;
    clearInterval(interval);
  });
});


const registryVerificationCache: Record<string, { status: string; error?: string }> = {};

app.get('/api/registries', async (_req: Request, res: Response) => {
  try {
    if (!pullSecretDetected || !pullSecretPath) {
      res.json({ registries: [] });
      return;
    }
    const content = await fsp.readFile(pullSecretPath, 'utf8');
    const pullSecret = JSON.parse(content);
    const auths = pullSecret.auths || {};

    const nonRegistryHosts = ['cloud.openshift.com', 'sso.redhat.com'];

    const registries = Object.entries(auths)
      .filter(([registry]) => !nonRegistryHosts.includes(registry))
      .map(([registry, authData]: [string, Record<string, string>]) => {
      let username = '';
      if (authData.auth) {
        try {
          const decoded = Buffer.from(authData.auth, 'base64').toString('utf8');
          username = decoded.split(':')[0] || '';
        } catch { /* invalid base64 */ }
      }
      const cached = registryVerificationCache[registry];
      return {
        registry,
        username,
        hasAuth: !!authData.auth,
        status: cached?.status || 'not_verified',
        error: cached?.error,
      };
    });

    res.json({ registries });
  } catch (error: unknown) {
    console.error('Error reading registries from pull secret:', error);
    res.status(500).json({ error: 'Failed to read registries' });
  }
});

app.post('/api/registries/verify', async (req: Request, res: Response) => {
  try {
    const { registry } = req.body;
    if (!registry) {
      res.status(400).json({ error: 'Registry is required' });
      return;
    }
    if (!pullSecretDetected || !pullSecretPath) {
      res.json({ registry, status: 'failed', error: 'No pull secret configured' });
      return;
    }

    const content = await fsp.readFile(pullSecretPath, 'utf8');
    const pullSecret = JSON.parse(content);
    const authData = pullSecret.auths?.[registry];
    if (!authData?.auth) {
      res.json({ registry, status: 'failed', error: 'No credentials found for this registry' });
      return;
    }

    const url = `https://${registry}/v2/`;
    const response = await fetch(url, {
      headers: { 'Authorization': `Basic ${authData.auth}` },
      signal: AbortSignal.timeout(10000),
    });

    const sendResult = (result: { registry: string; status: string; error?: string }) => {
      registryVerificationCache[result.registry] = { status: result.status, error: result.error };
      res.json(result);
    };

    if (response.ok || response.status === 200) {
      sendResult({ registry, status: 'authenticated' });
      return;
    }

    if (response.status === 401) {
      const wwwAuth = response.headers.get('www-authenticate') || '';
      const realmMatch = wwwAuth.match(/realm="([^"]+)"/);
      const serviceMatch = wwwAuth.match(/service="([^"]+)"/);

      if (realmMatch) {
        const tokenUrl = new URL(realmMatch[1]);
        if (serviceMatch) tokenUrl.searchParams.set('service', serviceMatch[1]);
        const tokenRes = await fetch(tokenUrl.toString(), {
          headers: { 'Authorization': `Basic ${authData.auth}` },
          signal: AbortSignal.timeout(10000),
        });
        if (tokenRes.ok) {
          sendResult({ registry, status: 'authenticated' });
          return;
        }
        const body = await tokenRes.text().catch(() => '');
        sendResult({ registry, status: 'failed', error: `Authentication failed (${tokenRes.status}): ${body.slice(0, 200)}` });
        return;
      }
    }

    sendResult({ registry, status: 'failed', error: `HTTP ${response.status}` });
  } catch (error: unknown) {
    console.error(`Error verifying registry ${req.body?.registry}:`, error);
    const reg = req.body?.registry;
    const errMsg = (error as Error).message || 'Connection failed';
    if (reg) registryVerificationCache[reg] = { status: 'failed', error: errMsg };
    res.json({ registry: reg, status: 'failed', error: errMsg });
  }
});

app.post('/api/cache/cleanup', async (_req: Request, res: Response) => {
  try {
    const entries = await fsp.readdir(CACHE_DIR);
    for (const entry of entries) {
      const entryPath = path.join(CACHE_DIR, entry);
      await fsp.rm(entryPath, { recursive: true, force: true });
    }
    res.json({ message: 'Cache cleaned up successfully' });
  } catch (error: unknown) {
    console.error('Error cleaning up cache:', error);
    res.status(500).json({ error: 'Failed to cleanup cache' });
  }
});

function computeCatalogDiff(oldData: PreFetchedCatalogData, newData: PreFetchedCatalogData): CatalogSyncDiffEntry[] {
  const diff: CatalogSyncDiffEntry[] = [];

  const allKeys = new Set([...Object.keys(oldData.operators), ...Object.keys(newData.operators)]);

  for (const catalogKey of allKeys) {
    const oldOps = oldData.operators[catalogKey] || [];
    const newOps = newData.operators[catalogKey] || [];

    const oldByName = new Map(oldOps.map(op => [op.name, op]));
    const newByName = new Map(newOps.map(op => [op.name, op]));

    const newOperators = newOps.filter(op => !oldByName.has(op.name)).map(op => op.name);
    const removedOperators = oldOps.filter(op => !newByName.has(op.name)).map(op => op.name);

    const updatedOperators: { name: string; addedVersions: string[] }[] = [];
    for (const newOp of newOps) {
      const oldOp = oldByName.get(newOp.name);
      if (!oldOp) continue;

      const oldVersions = new Set(oldOp.availableVersions || []);
      const addedVersions = (newOp.availableVersions || []).filter(v => !oldVersions.has(v));
      if (addedVersions.length > 0) {
        updatedOperators.push({ name: newOp.name, addedVersions });
      }
    }

    if (newOperators.length > 0 || removedOperators.length > 0 || updatedOperators.length > 0) {
      diff.push({ catalog: catalogKey, newOperators, removedOperators, updatedOperators });
    }
  }

  return diff;
}

const CATALOG_SYNC_TOTAL = 21; // 7 OCP versions x 3 catalog types

interface CatalogSyncDiffEntry {
  catalog: string;
  newOperators: string[];
  removedOperators: string[];
  updatedOperators: { name: string; addedVersions: string[] }[];
}

interface CatalogSyncState {
  status: 'idle' | 'running' | 'completed' | 'failed';
  lastSyncTime: string | null;
  syncStartTime: string | null;
  successCount: number;
  failedCount: number;
  totalCount: number;
  completedCatalogs: number;
  currentCatalog: string | null;
  error: string | null;
  logs: string[];
  diff: CatalogSyncDiffEntry[];
}

let catalogSyncState: CatalogSyncState = {
  status: 'idle',
  lastSyncTime: null,
  syncStartTime: null,
  successCount: 0,
  failedCount: 0,
  totalCount: CATALOG_SYNC_TOTAL,
  completedCatalogs: 0,
  currentCatalog: null,
  error: null,
  logs: [],
  diff: [],
};
let catalogSyncProcess: ChildProcess | null = null;

app.post('/api/catalogs/sync', async (_req: Request, res: Response) => {
  if (catalogSyncState.status === 'running') {
    res.status(409).json({ error: 'Catalog sync is already running' });
    return;
  }

  if (!pullSecretDetected || !pullSecretPath) {
    res.status(400).json({ error: 'Pull secret not configured. Please add a pull secret in the Pull Secret tab first.' });
    return;
  }

  const syncScriptPath = path.join(APP_ROOT_DIR, 'sync-catalogs.sh');
  try {
    await fsp.access(syncScriptPath, fs.constants.X_OK);
  } catch {
    res.status(500).json({ error: 'Catalog sync is not available. The sync script is missing from this installation.' });
    return;
  }

  const previousCatalogData = preFetchedCatalogData;

  catalogSyncState = {
    status: 'running',
    lastSyncTime: null,
    syncStartTime: new Date().toISOString(),
    successCount: 0,
    failedCount: 0,
    totalCount: CATALOG_SYNC_TOTAL,
    completedCatalogs: 0,
    currentCatalog: null,
    error: null,
    logs: [],
    diff: [],
  };

  const env = {
    ...process.env,
    CATALOG_DATA_DIR: RUNTIME_CATALOG_DIR,
    PULL_SECRET_PATH: AUTHFILE_PATH,
    SCRIPT_DIR: APP_ROOT_DIR,
    MAX_PARALLEL_JOBS: '3',
  };

  catalogSyncProcess = spawn('bash', [syncScriptPath], {
    env,
    cwd: APP_ROOT_DIR,
  });

  const handleSyncOutput = (data: Buffer, stream: 'stdout' | 'stderr') => {
    const lines = data.toString().split('\n').filter(Boolean);
    catalogSyncState.logs.push(...lines);
    for (const line of lines) {
      if (stream === 'stdout') {
        console.log(`[catalog-sync] ${line}`);
      } else {
        console.error(`[catalog-sync] ${line}`);
      }
      const extractMatch = line.match(/^Extracting (\S+) (v[\d.]+)/);
      if (extractMatch) {
        catalogSyncState.currentCatalog = `${extractMatch[1]} ${extractMatch[2]}`;
      }
      if (line.startsWith('Generated metadata for') || line.startsWith('ERROR: Failed to extract') || line.startsWith('ERROR: Failed to generate') || line.startsWith('ERROR: No configs directory')) {
        catalogSyncState.completedCatalogs = Math.min(catalogSyncState.completedCatalogs + 1, CATALOG_SYNC_TOTAL);
      }
    }
  };

  catalogSyncProcess.stdout?.on('data', (data: Buffer) => handleSyncOutput(data, 'stdout'));
  catalogSyncProcess.stderr?.on('data', (data: Buffer) => handleSyncOutput(data, 'stderr'));

  catalogSyncProcess.on('close', (code: number | null) => {
    catalogSyncProcess = null;
    catalogSyncState.lastSyncTime = new Date().toISOString();

    const completedLine = catalogSyncState.logs.find(l => l.startsWith('Completed:'));
    if (completedLine) {
      const match = completedLine.match(/(\d+)\/(\d+) catalogs successful, (\d+) failed/);
      if (match) {
        catalogSyncState.successCount = parseInt(match[1], 10);
        catalogSyncState.totalCount = parseInt(match[2], 10);
        catalogSyncState.failedCount = parseInt(match[3], 10);
      }
    }

    if (code === 0) {
      preFetchedCatalogData = null;
      dependenciesDataCache = null;
      operatorCache.catalogs = [];
      operatorCache.operators = {};
      operatorCache.channels = {};
      operatorCache.lastUpdate = null;

      loadPreFetchedCatalogData().then(newData => {
        if (newData && previousCatalogData) {
          catalogSyncState.diff = computeCatalogDiff(previousCatalogData, newData);
        }
        catalogSyncState.status = 'completed';
        console.log('Catalog sync completed successfully. Cache reloaded.');
      }).catch(() => {
        catalogSyncState.status = 'completed';
        console.log('Catalog sync completed but failed to compute diff.');
      });
    } else {
      catalogSyncState.status = 'failed';
      catalogSyncState.error = `Sync process exited with code ${code}`;
      console.error(`Catalog sync failed with exit code ${code}`);
    }
  });

  catalogSyncProcess.on('error', (err: Error) => {
    catalogSyncProcess = null;
    catalogSyncState.status = 'failed';
    catalogSyncState.error = err.message;
    catalogSyncState.lastSyncTime = new Date().toISOString();
    console.error('Catalog sync process error:', err);
  });

  res.json({ message: 'Catalog sync started', status: catalogSyncState.status });
});

app.get('/api/catalogs/sync/status', async (_req: Request, res: Response) => {
  const runtimeIndex = path.join(RUNTIME_CATALOG_DIR, 'catalog-index.json');
  let hasRuntimeSyncData = false;
  try {
    await fsp.access(runtimeIndex, fs.constants.R_OK);
    hasRuntimeSyncData = true;
  } catch {
    /* same check as DELETE /api/catalogs/sync/data */
  }

  res.json({
    status: catalogSyncState.status,
    lastSyncTime: catalogSyncState.lastSyncTime,
    syncStartTime: catalogSyncState.syncStartTime,
    successCount: catalogSyncState.successCount,
    failedCount: catalogSyncState.failedCount,
    totalCount: catalogSyncState.totalCount,
    completedCatalogs: catalogSyncState.completedCatalogs,
    currentCatalog: catalogSyncState.currentCatalog,
    error: catalogSyncState.error,
    logs: catalogSyncState.logs,
    diff: catalogSyncState.diff,
    hasRuntimeSyncData,
  });
});

app.delete('/api/catalogs/sync/data', async (_req: Request, res: Response) => {
  try {
    const runtimeIndex = path.join(RUNTIME_CATALOG_DIR, 'catalog-index.json');
    try {
      await fsp.access(runtimeIndex, fs.constants.R_OK);
    } catch {
      res.json({ message: 'No synced catalog data to clear' });
      return;
    }

    const entries = await fsp.readdir(RUNTIME_CATALOG_DIR);
    for (const entry of entries) {
      const entryPath = path.join(RUNTIME_CATALOG_DIR, entry);
      await fsp.rm(entryPath, { recursive: true, force: true });
    }

    preFetchedCatalogData = null;
    dependenciesDataCache = null;
    operatorCache.catalogs = [];
    operatorCache.operators = {};
    operatorCache.channels = {};
    operatorCache.lastUpdate = null;
    catalogSyncState.diff = [];
    catalogSyncState.logs = [];
    catalogSyncState.lastSyncTime = null;
    catalogSyncState.syncStartTime = null;
    catalogSyncState.completedCatalogs = 0;
    catalogSyncState.currentCatalog = null;
    catalogSyncState.successCount = 0;
    catalogSyncState.failedCount = 0;
    catalogSyncState.error = null;
    catalogSyncState.status = 'idle';

    console.log('Runtime catalog data cleared. Will fall back to built-in data on next load.');
    res.json({ message: 'Synced catalog data cleared. Falling back to built-in catalog data.' });
  } catch (error: unknown) {
    console.error('Error clearing synced catalog data:', error);
    res.status(500).json({ error: 'Failed to clear synced catalog data' });
  }
});

app.get('/api/system/info', async (req: Request, res: Response) => {
  try {
    const systemInfo = await getSystemInfo();
    res.json(systemInfo);
  } catch {
    res.status(500).json({ error: 'Failed to get system info' });
  }
});

function configureProductionFrontend(): void {
  app.use(express.static(DIST_DIR, {
    maxAge: '1d',
    etag: true,
  }));

  app.get('*', (req: Request, res: Response) => {
    res.sendFile(path.join(DIST_DIR, 'index.html'));
  });
}

async function configureDevelopmentFrontend(): Promise<void> {
  const { createServer } = await import('vite');
  const vite = await createServer({
    appType: 'custom',
    cacheDir: DEV_CACHE_DIR,
    server: {
      middlewareMode: true,
    },
  });

  app.use(vite.middlewares);

  app.get('*', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const template = await fsp.readFile(DEV_INDEX_HTML, 'utf8');
      const html = await vite.transformIndexHtml(req.originalUrl, template);
      res.status(200).set({ 'Content-Type': 'text/html' }).end(html);
    } catch (caughtError) {
      const error = caughtError as Error;
      vite.ssrFixStacktrace(error);
      next(error);
    }
  });
}

function logStartup(): void {
  console.log(`Mirror-GUI server running on port ${PORT}`);
  console.log(`Storage directory: ${STORAGE_DIR}`);
  console.log(`Configs directory: ${CONFIGS_DIR}`);
  console.log(`Operations directory: ${OPERATIONS_DIR}`);
  console.log(`Logs directory: ${LOGS_DIR}`);
  console.log(`Cache directory: ${CACHE_DIR}`);
  console.log(`App root directory: ${APP_ROOT_DIR}`);
  console.log(`Mirror base directory: ${MIRROR_BASE_DIR}`);
  console.log(`Authfile path: ${AUTHFILE_PATH}`);
  console.log(`Health check: http://localhost:${PORT}/api/health`);
  console.log(`API endpoints available at: http://localhost:${PORT}/api/*`);

  if (!IS_PRODUCTION) {
    console.log(`Development UI available at: http://localhost:${PORT}`);
  }
}

async function startServer(): Promise<void> {
  await detectPullSecret();

  if (IS_PRODUCTION) {
    configureProductionFrontend();
  } else {
    await configureDevelopmentFrontend();
  }


  app.use((error: Error, _req: Request, res: Response, _next: NextFunction) => {
    console.error('Server error:', error);
    res.status(500).json({ error: 'Internal server error' });
  });

  app.listen(PORT, () => {
    logStartup();
  });
}

if (process.env.VITEST !== 'true') {
  startServer().catch((error) => {
    console.error('Failed to start server:', error);
    process.exit(1);
  });
}
