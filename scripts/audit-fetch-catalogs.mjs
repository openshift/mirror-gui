#!/usr/bin/env node

import fs from 'fs/promises';
import path from 'path';
import process from 'process';
import { fileURLToPath } from 'url';
import YAML from 'yaml';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

/** Minimum OCP version supported by the app (e.g. 4.16). Catalogs below this are excluded from audit. */
const MIN_OCP_VERSION = '4.16';
const BEHAVIOR_REPORT_BASENAME = 'fetch-catalogs-audit';
const PACKAGE_FILES = new Set(['package.json', 'package.yaml', 'package.yml']);
const CATALOG_INLINE_FILES = new Set([
  'catalog.json',
  'index.json',
  'catalog.yaml',
  'catalog.yml',
  'index.yaml',
  'index.yml',
]);

function isOcpVersionSupported(versionStr) {
  if (!versionStr || typeof versionStr !== 'string') {
    return false;
  }
  const match = versionStr.replace(/^v/, '').match(/^(\d+)\.(\d+)/);
  if (!match) {
    return false;
  }
  const [minMajor, minMinor] = MIN_OCP_VERSION.split('.').map(Number);
  const major = Number.parseInt(match[1], 10);
  const minor = Number.parseInt(match[2], 10);
  return major > minMajor || (major === minMajor && minor >= minMinor);
}

function parseArgs(argv) {
  const options = {
    catalogDataDir: path.join(repoRoot, 'catalog-data'),
    outputDir: path.join(repoRoot, 'audit-reports'),
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if ((arg === '--catalog-data' || arg === '--catalog-data-dir') && argv[i + 1]) {
      options.catalogDataDir = path.resolve(argv[++i]);
    } else if (arg === '--output-dir' && argv[i + 1]) {
      options.outputDir = path.resolve(argv[++i]);
    } else if (arg === '--help' || arg === '-h') {
      console.log(`Usage: node scripts/audit-fetch-catalogs.mjs [options]

Options:
  --catalog-data-dir <path>   Catalog data root (default: ./catalog-data)
  --output-dir <path>         Report output directory (default: ./audit-reports)
`);
      process.exit(0);
    }
  }

  return options;
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function uniqueStrings(values) {
  return Array.from(new Set(values.filter(Boolean)));
}

function compareVersions(a, b) {
  const base = (value) => {
    const match = value.match(/^(\d+\.\d+\.\d+)/);
    return match ? match[1] : value;
  };

  const baseA = base(a);
  const baseB = base(b);
  const partsA = baseA.split('.').map((part) => Number.parseInt(part, 10) || 0);
  const partsB = baseB.split('.').map((part) => Number.parseInt(part, 10) || 0);
  const maxLength = Math.max(partsA.length, partsB.length);

  for (let index = 0; index < maxLength; index += 1) {
    const partA = partsA[index] || 0;
    const partB = partsB[index] || 0;
    if (partA !== partB) {
      return partA - partB;
    }
  }

  return a.localeCompare(b);
}

function sortVersions(values) {
  return uniqueStrings(values).sort(compareVersions);
}

function sortStrings(values) {
  return uniqueStrings(values).sort((left, right) => left.localeCompare(right));
}

function normalizeGeneratedChannels(channels) {
  if (!Array.isArray(channels)) {
    return [];
  }

  if (channels.length === 1 && typeof channels[0] === 'string') {
    if (channels[0].includes('\n')) {
      return sortStrings(
        channels[0]
          .split('\n')
          .map((channel) => channel.trim())
          .filter(Boolean),
      );
    }

    if (channels[0].includes(' ')) {
      return sortStrings(
        channels[0]
          .split(' ')
          .map((channel) => channel.trim())
          .filter(Boolean),
      );
    }
  }

  return sortStrings(
    channels
      .map((channel) => {
        if (typeof channel === 'string') {
          return channel.trim();
        }
        if (isObject(channel) && typeof channel.name === 'string') {
          return channel.name.trim();
        }
        return '';
      })
      .filter(Boolean),
  );
}

function extractGeneratedVersions(channelNames, operatorName) {
  const versions = new Set();

  for (const channel of channelNames) {
    if (!channel || !channel.trim()) {
      continue;
    }

    if (operatorName && channel.includes(`${operatorName}.`)) {
      const escapedOperatorName = operatorName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const versionWithV = channel.match(new RegExp(`${escapedOperatorName}\\.v(.+)`));
      if (versionWithV) {
        versions.add(versionWithV[1]);
        continue;
      }

      const versionWithoutV = channel.match(new RegExp(`${escapedOperatorName}\\.(.+)`));
      if (versionWithoutV) {
        versions.add(versionWithoutV[1]);
        continue;
      }
    }

    if (operatorName) {
      const operatorBase = operatorName.replace(/-certified$/, '').replace(/-community$/, '');
      if (operatorBase !== operatorName && channel.includes(`${operatorBase}.`)) {
        const escapedOperatorBase = operatorBase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const versionWithV = channel.match(new RegExp(`${escapedOperatorBase}\\.v(.+)`));
        if (versionWithV) {
          versions.add(versionWithV[1]);
          continue;
        }

        const versionWithoutV = channel.match(new RegExp(`${escapedOperatorBase}\\.(.+)`));
        if (versionWithoutV) {
          versions.add(versionWithoutV[1]);
          continue;
        }
      }
    }

    const genericVersionWithV = channel.match(/^[^.]+\.v(.+)/);
    if (genericVersionWithV) {
      versions.add(genericVersionWithV[1]);
      continue;
    }

    const genericVersionWithoutV = channel.match(/^[^.]+\.(\d+\.\d+\.\d+.*)/);
    if (genericVersionWithoutV) {
      versions.add(genericVersionWithoutV[1]);
      continue;
    }

    const versionMatch = channel.match(/^v?(\d+\.\d+\.\d+)/);
    if (versionMatch) {
      versions.add(versionMatch[1]);
    }
  }

  return Array.from(versions).sort(compareVersions);
}

function getUiFallbackVersions(channelName) {
  if (!channelName) {
    return [];
  }

  const versions = [];
  const match = channelName.match(/(\d+)\.(\d+)/);
  if (match) {
    const major = match[1];
    const minor = Number.parseInt(match[2], 10);
    for (let patch = 0; patch <= 10; patch += 1) {
      versions.push(`${major}.${minor}.${patch}`);
    }
    for (let patch = 0; patch <= 5; patch += 1) {
      versions.push(`${major}.${minor + 1}.${patch}`);
    }
    if (minor > 0) {
      for (let patch = 0; patch <= 5; patch += 1) {
        versions.push(`${major}.${minor - 1}.${patch}`);
      }
    }
    return sortVersions(versions);
  }

  return sortVersions([
    '1.0.0',
    '1.0.1',
    '1.0.2',
    '1.1.0',
    '1.1.1',
    '1.2.0',
    '1.2.1',
    '2.0.0',
    '2.0.1',
  ]);
}

function extractVersionFromName(value) {
  if (!value) {
    return null;
  }

  const patterns = [
    /\.v(\d+\.\d+\.\d+(?:[-+._a-zA-Z0-9]*)?)/,
    /\.(\d+\.\d+\.\d+(?:[-+._a-zA-Z0-9]*)?)/,
    /^v?(\d+\.\d+\.\d+(?:[-+._a-zA-Z0-9]*)?)$/,
  ];

  for (const pattern of patterns) {
    const match = value.match(pattern);
    if (match) {
      return match[1];
    }
  }

  return null;
}

function extractBundleVersion(bundleDoc) {
  const properties = Array.isArray(bundleDoc.properties) ? bundleDoc.properties : [];
  for (const property of properties) {
    if (property?.type === 'olm.package' && isObject(property.value) && typeof property.value.version === 'string') {
      return property.value.version;
    }
  }

  return extractVersionFromName(bundleDoc.name ?? '');
}

function normalizeDependencies(dependencies) {
  const unique = new Map();

  for (const dependency of Array.isArray(dependencies) ? dependencies : []) {
    if (!isObject(dependency) || typeof dependency.packageName !== 'string' || !dependency.packageName.trim()) {
      continue;
    }

    const normalizedDependency = {
      packageName: dependency.packageName.trim(),
      versionRange:
        dependency.versionRange === undefined || dependency.versionRange === null
          ? null
          : String(dependency.versionRange),
    };

    unique.set(
      `${normalizedDependency.packageName}\u0000${normalizedDependency.versionRange ?? ''}`,
      normalizedDependency,
    );
  }

  return Array.from(unique.values()).sort((left, right) => {
    const packageCompare = left.packageName.localeCompare(right.packageName);
    if (packageCompare !== 0) {
      return packageCompare;
    }
    return (left.versionRange ?? '').localeCompare(right.versionRange ?? '');
  });
}

function normalizeDependencyMap(value) {
  if (!isObject(value)) {
    return null;
  }

  const normalized = {};
  for (const operatorName of Object.keys(value).sort((left, right) => left.localeCompare(right))) {
    normalized[operatorName] = normalizeDependencies(value[operatorName]);
  }
  return normalized;
}

function getRange(versions) {
  if (!versions.length) {
    return { min: null, max: null };
  }
  return {
    min: versions[0],
    max: versions[versions.length - 1],
  };
}

function getVersionRangeRecord(versions) {
  const range = getRange(versions);
  return {
    minVersion: range.min,
    maxVersion: range.max,
  };
}

function flattenDocuments(documents) {
  const flattened = [];

  for (const document of documents) {
    if (Array.isArray(document)) {
      for (const entry of document) {
        if (isObject(entry)) {
          flattened.push(entry);
        }
      }
    } else if (isObject(document)) {
      flattened.push(document);
    }
  }

  return flattened;
}

function parseJsonDocuments(text) {
  const documents = [];
  let index = 0;

  while (index < text.length) {
    while (index < text.length && /\s/.test(text[index])) {
      index += 1;
    }

    if (index >= text.length) {
      break;
    }

    const startChar = text[index];
    if (startChar !== '{' && startChar !== '[') {
      throw new Error(`Unsupported JSON token "${startChar}" at offset ${index}`);
    }

    let depth = 0;
    let inString = false;
    let escaped = false;
    let endIndex = index;

    for (; endIndex < text.length; endIndex += 1) {
      const character = text[endIndex];
      if (inString) {
        if (escaped) {
          escaped = false;
          continue;
        }
        if (character === '\\') {
          escaped = true;
          continue;
        }
        if (character === '"') {
          inString = false;
        }
        continue;
      }

      if (character === '"') {
        inString = true;
        continue;
      }

      if (character === '{' || character === '[') {
        depth += 1;
        continue;
      }

      if (character === '}' || character === ']') {
        depth -= 1;
        if (depth === 0) {
          const slice = text.slice(index, endIndex + 1);
          documents.push(JSON.parse(slice));
          index = endIndex + 1;
          break;
        }
      }
    }

    if (depth !== 0) {
      throw new Error('Unterminated JSON document');
    }
  }

  return documents;
}

function parseYamlDocuments(text) {
  return YAML.parseAllDocuments(text)
    .map((document) => document.toJS())
    .filter((document) => document !== null && document !== undefined);
}

async function parseStructuredFile(filePath) {
  const text = await fs.readFile(filePath, 'utf8');
  const extension = path.extname(filePath).toLowerCase();

  if (extension === '.json') {
    return flattenDocuments(parseJsonDocuments(text));
  }

  if (extension === '.yaml' || extension === '.yml') {
    return flattenDocuments(parseYamlDocuments(text));
  }

  return [];
}

async function listStructuredFiles(operatorDir) {
  const files = [];
  const entries = await fs.readdir(operatorDir, { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name));

  for (const entry of entries) {
    const fullPath = path.join(operatorDir, entry.name);

    if (entry.isDirectory()) {
      if (entry.name === 'channels' || entry.name === 'bundles') {
        const nestedEntries = await fs.readdir(fullPath, { withFileTypes: true });
        nestedEntries.sort((left, right) => left.name.localeCompare(right.name));
        for (const nestedEntry of nestedEntries) {
          if (!nestedEntry.isFile()) {
            continue;
          }
          const extension = path.extname(nestedEntry.name).toLowerCase();
          if (extension === '.json' || extension === '.yaml' || extension === '.yml') {
            files.push(path.join(fullPath, nestedEntry.name));
          }
        }
      }
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    const extension = path.extname(entry.name).toLowerCase();
    if (extension === '.json' || extension === '.yaml' || extension === '.yml') {
      files.push(fullPath);
    }
  }

  return files;
}

function sourceCategory(filePath, operatorDir) {
  const relativePath = path.relative(operatorDir, filePath).replace(/\\/g, '/');
  const baseName = path.basename(filePath).toLowerCase();
  const parts = relativePath.split('/').map((part) => part.toLowerCase());

  if (PACKAGE_FILES.has(baseName)) {
    return 'package_explicit';
  }
  if (parts.includes('channels') || baseName.startsWith('channel') || baseName.startsWith('channels')) {
    return 'channel_explicit';
  }
  if (parts.includes('bundles') || baseName.startsWith('bundle') || baseName.startsWith('bundles')) {
    return 'bundle_explicit';
  }
  if (CATALOG_INLINE_FILES.has(baseName)) {
    return 'catalog_inline';
  }
  return 'other';
}

function chooseDocs(records, preferredCategory, kind) {
  const preferred = records.filter((record) => record.category === preferredCategory && record.kind === kind);
  if (preferred.length > 0) {
    return preferred;
  }
  return records.filter((record) => record.kind === kind);
}

function getGeneratedVersionsFromMetadata(generatedOperator) {
  if (!isObject(generatedOperator)) {
    return [];
  }

  const channelVersions = isObject(generatedOperator.channelVersions)
    ? Object.values(generatedOperator.channelVersions).flatMap((versions) =>
        Array.isArray(versions)
          ? versions
              .map((version) => (typeof version === 'string' ? version.trim() : ''))
              .filter(Boolean)
          : [],
      )
    : [];
  const availableVersions = Array.isArray(generatedOperator.availableVersions)
    ? generatedOperator.availableVersions
        .map((version) => (typeof version === 'string' ? version.trim() : ''))
        .filter(Boolean)
    : [];

  return sortVersions([...channelVersions, ...availableVersions]);
}

function normalizeGeneratedChannelVersions(channelVersions) {
  if (!isObject(channelVersions)) {
    return {};
  }

  const normalized = {};
  for (const channelName of Object.keys(channelVersions).sort((left, right) => left.localeCompare(right))) {
    const versions = channelVersions[channelName];
    normalized[channelName] = sortVersions(
      Array.isArray(versions)
        ? versions.map((version) => (typeof version === 'string' ? version.trim() : '')).filter(Boolean)
        : [],
    );
  }

  return normalized;
}

function normalizeGeneratedChannelRanges(channelVersionRanges) {
  if (!isObject(channelVersionRanges)) {
    return {};
  }

  const normalized = {};
  for (const channelName of Object.keys(channelVersionRanges).sort((left, right) => left.localeCompare(right))) {
    const value = channelVersionRanges[channelName];
    if (!isObject(value)) {
      continue;
    }
    normalized[channelName] = {
      minVersion: normalizeString(value.minVersion) || null,
      maxVersion: normalizeString(value.maxVersion) || null,
    };
  }

  return normalized;
}

function buildExpectedVersionMetadata(rawEntry) {
  const channelVersions = {};
  for (const channelName of Object.keys(rawEntry.realVersionsByChannel).sort((left, right) => left.localeCompare(right))) {
    channelVersions[channelName] = sortVersions(rawEntry.realVersionsByChannel[channelName] || []);
  }

  return {
    availableVersions: rawEntry.realVersions,
    minVersion: rawEntry.realVersions[0] ?? null,
    maxVersion: rawEntry.realVersions[rawEntry.realVersions.length - 1] ?? null,
    channelVersions,
    channelVersionRanges: Object.fromEntries(
      Object.entries(channelVersions).map(([channelName, versions]) => [channelName, getVersionRangeRecord(versions)]),
    ),
  };
}

function buildGeneratedVersionMetadata(generatedOperator) {
  if (!isObject(generatedOperator)) {
    return {
      availableVersions: [],
      minVersion: null,
      maxVersion: null,
      channelVersions: {},
      channelVersionRanges: {},
    };
  }

  const availableVersions = Array.isArray(generatedOperator.availableVersions)
    ? generatedOperator.availableVersions
        .map((version) => (typeof version === 'string' ? version.trim() : ''))
        .filter(Boolean)
    : [];

  return {
    availableVersions: sortVersions(availableVersions),
    minVersion: normalizeString(generatedOperator.minVersion) || null,
    maxVersion: normalizeString(generatedOperator.maxVersion) || null,
    channelVersions: normalizeGeneratedChannelVersions(generatedOperator.channelVersions),
    channelVersionRanges: normalizeGeneratedChannelRanges(generatedOperator.channelVersionRanges),
  };
}

function isPackageDoc(doc, filePath) {
  if (doc.schema === 'olm.package') {
    return true;
  }

  const baseName = path.basename(filePath);
  return baseName.startsWith('package.') && typeof doc.name === 'string';
}

function isChannelDoc(doc, filePath) {
  if (doc.schema === 'olm.channel') {
    return true;
  }

  const relativePath = filePath.replace(/\\/g, '/');
  const baseName = path.basename(filePath);
  return (
    (relativePath.includes('/channels/') || baseName === 'channel.json' || baseName === 'channels.json') &&
    typeof doc.name === 'string' &&
    Array.isArray(doc.entries)
  );
}

function isBundleDoc(doc, filePath) {
  if (doc.schema === 'olm.bundle') {
    return true;
  }

  const relativePath = filePath.replace(/\\/g, '/');
  const baseName = path.basename(filePath);
  return (
    (relativePath.includes('/bundles/') || baseName.startsWith('bundle-')) &&
    typeof doc.name === 'string' &&
    Array.isArray(doc.properties)
  );
}

async function loadRawOperatorTruth(operatorDir) {
  const structuredFiles = await listStructuredFiles(operatorDir);
  const parseWarnings = [];
  const records = [];

  for (const filePath of structuredFiles) {
    if (path.basename(filePath) === 'released-bundles.json') {
      continue;
    }

    try {
      const category = sourceCategory(filePath, operatorDir);
      const documents = await parseStructuredFile(filePath);
      for (const doc of documents) {
        if (!isObject(doc)) {
          continue;
        }

        if (isPackageDoc(doc, filePath)) {
          records.push({ kind: 'package', category, doc, filePath });
        }
        if (isChannelDoc(doc, filePath)) {
          records.push({ kind: 'channel', category, doc, filePath });
        }
        if (isBundleDoc(doc, filePath)) {
          records.push({ kind: 'bundle', category, doc, filePath });
        }
      }
    } catch (error) {
      parseWarnings.push({
        file: path.relative(repoRoot, filePath),
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const packageRecords = chooseDocs(records, 'package_explicit', 'package');
  const channelRecords = chooseDocs(records, 'channel_explicit', 'channel');
  const bundleRecords = chooseDocs(records, 'bundle_explicit', 'bundle');

  if (
    packageRecords.length === 0 &&
    channelRecords.length === 0 &&
    bundleRecords.length === 0 &&
    parseWarnings.length === 0
  ) {
    return null;
  }

  const dirName = path.basename(operatorDir);
  const packageDoc = packageRecords.find((entry) => typeof entry.doc.name === 'string')?.doc ?? {};
  const operatorName =
    normalizeString(packageDoc.name) ||
    channelRecords.map((entry) => normalizeString(entry.doc.package)).find(Boolean) ||
    bundleRecords.map((entry) => normalizeString(entry.doc.package)).find(Boolean) ||
    dirName;
  const defaultChannel = normalizeString(packageDoc.defaultChannel) || null;
  const rawChannels = sortStrings(
    channelRecords.map((entry) => normalizeString(entry.doc.name)).filter(Boolean),
  );

  const bundleVersionByName = new Map();
  const bundleVersions = [];
  const bundleMetadata = bundleRecords.map((entry) => {
    const version = extractBundleVersion(entry.doc);
    if (entry.doc.name && version) {
      bundleVersionByName.set(entry.doc.name, version);
    }
    if (version) {
      bundleVersions.push(version);
    }
    return {
      filePath: entry.filePath,
      doc: entry.doc,
      version,
    };
  });

  const realVersionsByChannel = {};
  for (const channelEntry of channelRecords) {
    const channelName = normalizeString(channelEntry.doc.name);
    const entries = Array.isArray(channelEntry.doc.entries) ? channelEntry.doc.entries : [];
    const versions = entries
      .map((entry) => {
        if (!isObject(entry) || typeof entry.name !== 'string') {
          return null;
        }
        return bundleVersionByName.get(entry.name) ?? extractVersionFromName(entry.name);
      })
      .filter(Boolean);

    if (versions.length > 0) {
      const existing = realVersionsByChannel[channelName] || [];
      realVersionsByChannel[channelName] = sortVersions([...existing, ...versions]);
    }
  }

  const realVersions =
    Object.keys(realVersionsByChannel).length > 0
      ? sortVersions(Object.values(realVersionsByChannel).flat())
      : sortVersions(bundleVersions);

  const perChannelRanges = {};
  for (const [channelName, versions] of Object.entries(realVersionsByChannel)) {
    perChannelRanges[channelName] = getRange(versions);
  }

  let selectedBundle = null;
  if (defaultChannel && realVersionsByChannel[defaultChannel]) {
    const defaultChannelEntries = channelRecords
      .filter((entry) => normalizeString(entry.doc.name) === defaultChannel)
      .flatMap((entry) => (Array.isArray(entry.doc.entries) ? entry.doc.entries : []));
    const candidates = defaultChannelEntries
      .filter((entry) => isObject(entry) && typeof entry.name === 'string')
      .map((entry) => {
        const bundleMeta = bundleMetadata.find((b) => b.doc.name === entry.name);
        return bundleMeta && bundleMeta.version ? bundleMeta : null;
      })
      .filter(Boolean);
    if (candidates.length > 0) {
      candidates.sort((left, right) => compareVersions(left.version, right.version));
      selectedBundle = candidates[candidates.length - 1];
    }
  }

  if (!selectedBundle) {
    const sortedBundleMetadata = [...bundleMetadata]
      .filter((b) => b.version)
      .sort((left, right) => compareVersions(left.version, right.version));
    if (sortedBundleMetadata.length > 0) {
      selectedBundle = sortedBundleMetadata[sortedBundleMetadata.length - 1];
    }
  }

  let expectedDependencies = [];
  if (selectedBundle && Array.isArray(selectedBundle.doc.properties)) {
    expectedDependencies = normalizeDependencies(
      selectedBundle.doc.properties
        .filter((property) => property?.type === 'olm.package.required' && isObject(property.value))
        .map((property) => ({
          packageName: property.value.packageName,
          versionRange: property.value.versionRange ?? null,
        })),
    );
  }

  return {
    dirName,
    operatorName,
    defaultChannel,
    channels: rawChannels,
    realVersionsByChannel,
    realVersions,
    perChannelRanges,
    bundleCount: bundleRecords.length,
    structuredFiles: structuredFiles.map((filePath) => path.relative(repoRoot, filePath)),
    parseWarnings,
    expectedDependencies,
  };
}

function addIssue(issues, category, details) {
  issues.push({ category, details });
}

function formatList(values, maxItems = 6) {
  if (!values || values.length === 0) {
    return '(none)';
  }
  if (values.length <= maxItems) {
    return values.join(', ');
  }
  return `${values.slice(0, maxItems).join(', ')} ... (+${values.length - maxItems} more)`;
}

function formatRange(min, max) {
  if (!min && !max) {
    return '(none)';
  }
  if (min && max) {
    return `${min} -> ${max}`;
  }
  return min || max || '(none)';
}

function countCategories(issueLists) {
  const counts = {};
  for (const issue of issueLists) {
    counts[issue.category] = (counts[issue.category] || 0) + 1;
  }
  return counts;
}

async function readJsonFile(filePath, fallback = null) {
  try {
    const text = await fs.readFile(filePath, 'utf8');
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

async function readJsonFileWithDiagnostics(filePath, fallback = null) {
  try {
    const text = await fs.readFile(filePath, 'utf8');
    return {
      value: JSON.parse(text),
      error: null,
    };
  } catch (error) {
    const kind =
      error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT'
        ? 'missing'
        : error instanceof SyntaxError
          ? 'parse_error'
          : 'read_error';

    return {
      value: fallback,
      error: {
        kind,
        path: path.relative(repoRoot, filePath),
        message: error instanceof Error ? error.message : String(error),
      },
    };
  }
}

function createCatalogJsonIssue(prefix, error) {
  if (!error) {
    return null;
  }

  const category =
    error.kind === 'missing'
      ? `${prefix}_file_missing`
      : error.kind === 'parse_error'
        ? `${prefix}_file_parse_error`
        : `${prefix}_file_read_error`;

  return {
    category,
    details: {
      path: error.path,
      message: error.message,
    },
  };
}

async function discoverCatalogSnapshots(catalogDataDir) {
  const snapshots = [];
  const entries = await fs.readdir(catalogDataDir, { withFileTypes: true });

  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (!entry.isDirectory()) {
      continue;
    }

    const catalogType = entry.name;
    const catalogTypeDir = path.join(catalogDataDir, catalogType);
    const versionEntries = await fs.readdir(catalogTypeDir, { withFileTypes: true });

    for (const versionEntry of versionEntries.sort((left, right) => left.name.localeCompare(right.name))) {
      if (!versionEntry.isDirectory()) {
        continue;
      }

      const version = versionEntry.name;
      if (!isOcpVersionSupported(version)) {
        continue;
      }
      const snapshotDir = path.join(catalogTypeDir, version);
      try {
        await fs.access(path.join(snapshotDir, 'operators.json'));
        snapshots.push({
          catalogType,
          version,
          key: `${catalogType}:${version}`,
          snapshotDir,
        });
      } catch {
        // Ignore directories without generated operator data.
      }
    }
  }

  return snapshots;
}

async function auditSnapshot(snapshot, masterDependencies) {
  const operatorsPath = path.join(snapshot.snapshotDir, 'operators.json');
  const dependenciesPath = path.join(snapshot.snapshotDir, 'dependencies.json');
  const configsDir = path.join(snapshot.snapshotDir, 'configs');

  const generatedOperatorsResult = await readJsonFileWithDiagnostics(operatorsPath, []);
  const dependenciesResult = await readJsonFileWithDiagnostics(dependenciesPath, null);
  const generatedOperators = Array.isArray(generatedOperatorsResult.value) ? generatedOperatorsResult.value : [];
  const perCatalogDependencies = dependenciesResult.error ? null : dependenciesResult.value;
  const masterCatalogDependencies = isObject(masterDependencies) ? masterDependencies[snapshot.key] ?? null : null;
  const hasGeneratedOperatorData = generatedOperatorsResult.error === null;
  const hasPerCatalogDependencyData = dependenciesResult.error === null;
  const catalogIssues = [];

  const operatorsCatalogIssue = createCatalogJsonIssue('operators', generatedOperatorsResult.error);
  if (operatorsCatalogIssue) {
    catalogIssues.push(operatorsCatalogIssue);
  }

  const dependenciesCatalogIssue = createCatalogJsonIssue('dependencies', dependenciesResult.error);
  if (dependenciesCatalogIssue) {
    catalogIssues.push(dependenciesCatalogIssue);
  }

  const rawOperatorEntries = [];
  try {
    const operatorDirEntries = await fs.readdir(configsDir, { withFileTypes: true });
    for (const operatorDirEntry of operatorDirEntries.sort((left, right) => left.name.localeCompare(right.name))) {
      if (operatorDirEntry.isDirectory()) {
        const rawEntry = await loadRawOperatorTruth(path.join(configsDir, operatorDirEntry.name));
        if (rawEntry) {
          rawOperatorEntries.push(rawEntry);
        }
      }
    }
  } catch {
    // Leave rawOperatorEntries empty; missing configs will be reported through generated-vs-raw mismatches.
  }

  const rawByName = new Map();
  const rawByDir = new Map();
  for (const rawEntry of rawOperatorEntries) {
    rawByName.set(rawEntry.operatorName, rawEntry);
    rawByDir.set(rawEntry.dirName, rawEntry);
  }

  const generatedByName = new Map();
  for (const generatedOperator of generatedOperators) {
    generatedByName.set(generatedOperator.name, generatedOperator);
  }

  const operatorFindings = [];
  const seenGenerated = new Set();

  for (const rawEntry of rawOperatorEntries) {
    const generatedOperator = hasGeneratedOperatorData
      ? generatedByName.get(rawEntry.operatorName) ??
        (rawEntry.dirName !== rawEntry.operatorName ? generatedByName.get(rawEntry.dirName) : null) ??
        null
      : null;

    const issues = [];
    const generatedChannels = normalizeGeneratedChannels(generatedOperator?.channels);
    const rawChannels = rawEntry.channels;
    const realVersions = rawEntry.realVersions;
    const generatedVersionSource = generatedOperator?.name ?? rawEntry.operatorName;
    const serverDerivedVersions = getGeneratedVersionsFromMetadata(generatedOperator);
    const derivedChannelVersions =
      serverDerivedVersions.length > 0
        ? []
        : extractGeneratedVersions(generatedChannels, generatedVersionSource);
    const serverVersions = serverDerivedVersions.length > 0 ? serverDerivedVersions : derivedChannelVersions;
    const fallbackChannelName =
      generatedOperator?.defaultChannel ||
      generatedChannels[0] ||
      rawEntry.defaultChannel ||
      rawChannels[0] ||
      '';
    const uiFallbackVersions = getUiFallbackVersions(fallbackChannelName);
    const realRange = getRange(realVersions);
    const serverRange = getRange(serverVersions);
    const fallbackRange = getRange(uiFallbackVersions);
    const expectedVersionMetadata = buildExpectedVersionMetadata(rawEntry);
    const generatedVersionMetadata = buildGeneratedVersionMetadata(generatedOperator);

    if (hasGeneratedOperatorData && !generatedOperator) {
      addIssue(issues, 'raw_operator_missing_from_generated', {
        operatorDir: rawEntry.dirName,
      });
    } else if (generatedOperator) {
      seenGenerated.add(generatedOperator.name);
    }

    if (rawEntry.parseWarnings.length > 0) {
      addIssue(issues, 'raw_parse_warning', {
        files: rawEntry.parseWarnings,
      });
    }

    if (generatedOperator && generatedOperator.name !== rawEntry.operatorName) {
      addIssue(issues, 'generated_name_mismatch', {
        generatedName: generatedOperator.name,
        rawName: rawEntry.operatorName,
      });
    }

    if (generatedOperator) {
      if ((generatedOperator.defaultChannel ?? null) !== rawEntry.defaultChannel) {
        addIssue(issues, 'default_channel_mismatch', {
          generatedDefaultChannel: generatedOperator.defaultChannel ?? null,
          rawDefaultChannel: rawEntry.defaultChannel,
        });
      }

      if (rawChannels.length > 0 && generatedChannels.length === 0) {
        addIssue(issues, 'empty_channel_list', {
          rawChannels,
        });
      }

      const missingChannels = rawChannels.filter((channel) => !generatedChannels.includes(channel));
      const unexpectedChannels = generatedChannels.filter((channel) => !rawChannels.includes(channel));

      if (missingChannels.length > 0) {
        addIssue(issues, 'missing_channels', {
          missingChannels,
        });
      }

      if (unexpectedChannels.length > 0) {
        addIssue(issues, 'unexpected_channels', {
          unexpectedChannels,
        });
      }
    }

    if (realVersions.length === 0 && (rawChannels.length > 0 || rawEntry.bundleCount > 0)) {
      addIssue(issues, 'no_real_versions_found', {
        rawChannels,
        bundleCount: rawEntry.bundleCount,
      });
    }

    if (hasGeneratedOperatorData && realVersions.length > 0 && serverVersions.length === 0) {
      addIssue(issues, 'ui_version_fallback_risk', {
        rawRange: realRange,
        fallbackRange,
        fallbackChannelName,
      });
    }

    if (generatedOperator) {
      if (JSON.stringify(generatedVersionMetadata.availableVersions) !== JSON.stringify(expectedVersionMetadata.availableVersions)) {
        addIssue(issues, 'available_versions_mismatch', {
          expected: expectedVersionMetadata.availableVersions,
          generated: generatedVersionMetadata.availableVersions,
        });
      }

      if (
        generatedVersionMetadata.minVersion !== expectedVersionMetadata.minVersion ||
        generatedVersionMetadata.maxVersion !== expectedVersionMetadata.maxVersion
      ) {
        addIssue(issues, 'min_max_mismatch', {
          expected: {
            minVersion: expectedVersionMetadata.minVersion,
            maxVersion: expectedVersionMetadata.maxVersion,
          },
          generated: {
            minVersion: generatedVersionMetadata.minVersion,
            maxVersion: generatedVersionMetadata.maxVersion,
          },
        });
      }

      if (JSON.stringify(generatedVersionMetadata.channelVersions) !== JSON.stringify(expectedVersionMetadata.channelVersions)) {
        addIssue(issues, 'channel_versions_mismatch', {
          expected: expectedVersionMetadata.channelVersions,
          generated: generatedVersionMetadata.channelVersions,
        });
      }

      if (
        JSON.stringify(generatedVersionMetadata.channelVersionRanges) !==
        JSON.stringify(expectedVersionMetadata.channelVersionRanges)
      ) {
        addIssue(issues, 'channel_ranges_mismatch', {
          expected: expectedVersionMetadata.channelVersionRanges,
          generated: generatedVersionMetadata.channelVersionRanges,
        });
      }
    }

    const expectedDependencies = rawEntry.expectedDependencies;
    const generatedDependencies = hasPerCatalogDependencyData
      ? normalizeDependencies(generatedOperator ? perCatalogDependencies?.[generatedOperator.name] : [])
      : [];
    const masterDependenciesForOperator =
      hasPerCatalogDependencyData && generatedOperator
        ? normalizeDependencies(masterCatalogDependencies?.[generatedOperator.name] ?? [])
        : [];

    if (hasPerCatalogDependencyData && generatedOperator) {
      if (expectedDependencies.length > 0 && generatedDependencies.length === 0) {
        addIssue(issues, 'dependencies_missing', {
          expectedDependencies,
        });
      } else if (JSON.stringify(expectedDependencies) !== JSON.stringify(generatedDependencies)) {
        addIssue(issues, 'dependencies_mismatch', {
          expectedDependencies,
          generatedDependencies,
        });
      }

      if (JSON.stringify(generatedDependencies) !== JSON.stringify(masterDependenciesForOperator)) {
        addIssue(issues, 'master_dependencies_operator_mismatch', {
          generatedDependencies,
          masterDependencies: masterDependenciesForOperator,
        });
      }
    }

    if (issues.length > 0) {
      operatorFindings.push({
        operator: generatedOperator?.name ?? rawEntry.operatorName,
        catalogKey: snapshot.key,
        operatorDir: path.relative(repoRoot, path.join(configsDir, rawEntry.dirName)),
        generated: generatedOperator
          ? {
              name: generatedOperator.name,
              defaultChannel: generatedOperator.defaultChannel ?? null,
              channels: generatedChannels,
            }
          : null,
        raw: {
          operatorName: rawEntry.operatorName,
          operatorDirName: rawEntry.dirName,
          defaultChannel: rawEntry.defaultChannel,
          channels: rawChannels,
          structuredFiles: rawEntry.structuredFiles,
        },
        versions: {
          rawVersions: realVersions,
          rawRange: realRange,
          perChannelRanges: rawEntry.perChannelRanges,
          expectedMetadata: expectedVersionMetadata,
          generatedMetadata: generatedVersionMetadata,
          serverDerivedVersions: serverVersions,
          serverRange,
          uiFallbackVersions,
          uiFallbackRange: fallbackRange,
          fallbackChannelName,
        },
        dependencies: {
          expected: expectedDependencies,
          generated: generatedDependencies,
          master: masterDependenciesForOperator,
        },
        issues,
      });
    }
  }

  if (hasGeneratedOperatorData) {
    for (const generatedOperator of generatedOperators) {
      if (seenGenerated.has(generatedOperator.name)) {
        continue;
      }

      const rawMatch =
        rawByName.get(generatedOperator.name) ??
        rawByDir.get(generatedOperator.name) ??
        null;

      if (rawMatch) {
        continue;
      }

      operatorFindings.push({
        operator: generatedOperator.name,
        catalogKey: snapshot.key,
        operatorDir: null,
        generated: {
          name: generatedOperator.name,
          defaultChannel: generatedOperator.defaultChannel ?? null,
          channels: normalizeGeneratedChannels(generatedOperator.channels),
        },
        raw: null,
        versions: null,
        dependencies: {
          expected: [],
          generated: hasPerCatalogDependencyData
            ? normalizeDependencies(perCatalogDependencies?.[generatedOperator.name])
            : [],
          master: hasPerCatalogDependencyData
            ? normalizeDependencies(masterCatalogDependencies?.[generatedOperator.name])
            : [],
        },
        issues: [
          {
            category: 'generated_operator_missing_from_raw',
            details: {},
          },
        ],
      });
    }
  }

  if (hasPerCatalogDependencyData && perCatalogDependencies === null) {
    catalogIssues.push({
      category: 'dependencies_file_missing',
      details: {
        path: path.relative(repoRoot, dependenciesPath),
      },
    });
  }

  if (hasPerCatalogDependencyData && masterCatalogDependencies === null && perCatalogDependencies !== null) {
    catalogIssues.push({
      category: 'master_dependencies_missing',
      details: {
        catalogKey: snapshot.key,
      },
    });
  } else if (
    hasPerCatalogDependencyData &&
    perCatalogDependencies !== null &&
    JSON.stringify(normalizeDependencyMap(perCatalogDependencies)) !==
      JSON.stringify(normalizeDependencyMap(masterCatalogDependencies))
  ) {
    catalogIssues.push({
      category: 'master_dependencies_mismatch',
      details: {
        catalogKey: snapshot.key,
      },
    });
  }

  return {
    catalogKey: snapshot.key,
    catalogType: snapshot.catalogType,
    version: snapshot.version,
    generatedOperatorCount: generatedOperators.length,
    rawOperatorCount: rawOperatorEntries.length,
    operators: operatorFindings,
    catalogIssues,
    categoryCounts: countCategories([
      ...operatorFindings.flatMap((finding) => finding.issues),
      ...catalogIssues,
    ]),
  };
}

function buildMarkdownReport(report) {
  const lines = [];

  lines.push('# Fetch Catalogs Audit Report');
  lines.push('');
  lines.push(`Generated: ${report.generatedAt}`);
  lines.push(`Catalog data: \`${path.relative(repoRoot, report.catalogDataDir)}\``);
  lines.push(`JSON report: \`${path.relative(repoRoot, report.jsonReportPath)}\``);
  lines.push('');
  lines.push('## Summary');
  lines.push('');
  lines.push(`- Catalog snapshots audited: ${report.summary.catalogSnapshots}`);
  lines.push(`- Operators audited: ${report.summary.operatorsAudited}`);
  lines.push(`- Operators with issues: ${report.summary.operatorsWithIssues}`);
  lines.push(`- Catalog snapshots with issues: ${report.summary.catalogSnapshotsWithIssues}`);
  lines.push(`- Total issues: ${report.summary.totalIssues}`);
  lines.push('');
  lines.push('## Issue Counts');
  lines.push('');

  for (const [category, count] of Object.entries(report.summary.issueCounts).sort((left, right) => right[1] - left[1])) {
    lines.push(`- \`${category}\`: ${count}`);
  }

  for (const catalog of report.catalogs) {
    if (catalog.operators.length === 0 && catalog.catalogIssues.length === 0) {
      continue;
    }

    lines.push('');
    lines.push(`## ${catalog.catalogKey}`);
    lines.push('');
    lines.push(`- Generated operators: ${catalog.generatedOperatorCount}`);
    lines.push(`- Raw operator directories: ${catalog.rawOperatorCount}`);
    lines.push(`- Operators with issues: ${catalog.operators.length}`);

    if (catalog.catalogIssues.length > 0) {
      lines.push(`- Catalog-level issues: ${catalog.catalogIssues.map((issue) => `\`${issue.category}\``).join(', ')}`);
    }

    for (const finding of catalog.operators) {
      const categories = finding.issues.map((issue) => `\`${issue.category}\``).join(', ');
      const generatedChannels = formatList(finding.generated?.channels ?? []);
      const rawChannels = formatList(finding.raw?.channels ?? []);
      const rawRange = finding.versions ? formatRange(finding.versions.rawRange.min, finding.versions.rawRange.max) : '(none)';
      const serverRange = finding.versions ? formatRange(finding.versions.serverRange.min, finding.versions.serverRange.max) : '(none)';
      const fallbackRange = finding.versions
        ? formatRange(finding.versions.uiFallbackRange.min, finding.versions.uiFallbackRange.max)
        : '(none)';
      const expectedDependencyCount = finding.dependencies?.expected?.length ?? 0;
      const generatedDependencyCount = finding.dependencies?.generated?.length ?? 0;

      lines.push(
        `- \`${finding.operator}\`: ${categories}; generated channels=${generatedChannels}; raw channels=${rawChannels}; raw range=${rawRange}; server range=${serverRange}; UI fallback=${fallbackRange}; dependencies expected/generated=${expectedDependencyCount}/${generatedDependencyCount}`,
      );
    }
  }

  lines.push('');
  return lines.join('\n');
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const catalogDataDir = options.catalogDataDir;
  const outputDir = options.outputDir;

  await fs.mkdir(outputDir, { recursive: true });

  const snapshots = await discoverCatalogSnapshots(catalogDataDir);
  const masterDependencies = await readJsonFile(path.join(catalogDataDir, 'dependencies.json'), {});
  const catalogs = [];

  for (const snapshot of snapshots) {
    catalogs.push(await auditSnapshot(snapshot, masterDependencies));
  }

  const operatorFindings = catalogs.flatMap((catalog) => catalog.operators);
  const catalogIssues = catalogs.flatMap((catalog) => catalog.catalogIssues);
  const allIssues = [
    ...operatorFindings.flatMap((finding) => finding.issues),
    ...catalogIssues,
  ];

  const jsonReportPath = path.join(outputDir, `${BEHAVIOR_REPORT_BASENAME}.json`);
  const markdownReportPath = path.join(outputDir, `${BEHAVIOR_REPORT_BASENAME}.md`);

  const report = {
    generatedAt: new Date().toISOString(),
    repoRoot,
    catalogDataDir,
    jsonReportPath,
    markdownReportPath,
    summary: {
      catalogSnapshots: catalogs.length,
      catalogSnapshotsWithIssues: catalogs.filter((catalog) => catalog.operators.length > 0 || catalog.catalogIssues.length > 0).length,
      operatorsAudited: catalogs.reduce((total, catalog) => total + catalog.rawOperatorCount, 0),
      operatorsWithIssues: operatorFindings.length,
      totalIssues: allIssues.length,
      issueCounts: countCategories(allIssues),
    },
    notableFindings: {},
    catalogs,
  };

  const markdownReport = buildMarkdownReport(report);

  await fs.writeFile(jsonReportPath, JSON.stringify(report, null, 2));
  await fs.writeFile(markdownReportPath, markdownReport);

  console.log(`Catalog snapshots audited: ${report.summary.catalogSnapshots}`);
  console.log(`Operators audited: ${report.summary.operatorsAudited}`);
  console.log(`Operators with issues: ${report.summary.operatorsWithIssues}`);
  console.log(`Total issues: ${report.summary.totalIssues}`);
  console.log(`JSON report: ${path.relative(repoRoot, jsonReportPath)}`);
  console.log(`Markdown report: ${path.relative(repoRoot, markdownReportPath)}`);
}

main().catch((error) => {
  console.error('Failed to audit catalog data:', error);
  process.exitCode = 1;
});
