import fs from 'fs';
import path from 'path';
import { getCatalogNameFromUrl } from './utils.js';

export const SUPPORTED_OCP_VERSIONS: readonly string[] = [
  '4.16',
  '4.17',
  '4.18',
  '4.19',
  '4.20',
  '4.21',
  '4.22',
];

export const BUILTIN_CATALOG_TYPES: readonly string[] = [
  'redhat-operator-index',
  'certified-operator-index',
  'community-operator-index',
];

export interface ExternalCatalog {
  /** Full image URL, always including the tag. */
  url: string;
  /** Last path segment of the repository; used as the storage directory. */
  name: string;
  tag: string;
  displayName?: string;
}

export type CatalogUrlResult =
  | { ok: true; catalog: ExternalCatalog }
  | { ok: false; error: string };

const MAX_URL_LENGTH = 255;
const ALLOWED_URL_CHARS = /^[a-z0-9._/:-]+$/;
// The last path segment (the name) and the tag become directory names. Path segments must
// start with an alphanumeric character, which rules out "." and "..". Tags may also start
// with "_", never with "." or "-".
const PATH_SEGMENT = /^[a-z0-9][a-z0-9._-]*$/;
const TAG_PATTERN = /^[a-z0-9_][a-z0-9._-]{0,127}$/;
// The catalog name is a directory next to catalog-index.json in the runtime catalog
// directory, so names that look like files could clobber or delete index data.
const RESERVED_NAME_PATTERN = /\.(json|tmp)$/;
// Hosts that expose cloud metadata or are not real registries. Private and loopback
// registries stay allowed because air-gapped setups commonly use them.
const BLOCKED_HOSTS = new Set(['0.0.0.0', 'metadata', 'metadata.google.internal']);

/** Returns the registry hostname (no port, no trailing FQDN dot) of an image repository. */
function getRegistryHostname(repository: string): string {
  return repository.split('/')[0].replace(/:\d*$/, '').replace(/\.+$/, '');
}

const CANONICAL_IPV4 = /^(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/;

function isBlockedRegistryHost(hostname: string): boolean {
  if (BLOCKED_HOSTS.has(hostname)) {
    return true;
  }
  // Digit-and-dot or 0x hosts that are not a canonical dotted quad are alternate spellings of
  // an IP (decimal "2852039166", hex "0xa9fea9fe", octal "0251.0376...", shorthand "169.16689662").
  if (/^[0-9.]+$/.test(hostname) || hostname.startsWith('0x')) {
    return !CANONICAL_IPV4.test(hostname) || hostname.startsWith('169.254.');
  }
  return false;
}

/** Fallback version for built-in catalog URLs that carry no tag. */
const DEFAULT_BUILTIN_CATALOG_VERSION = 'v4.21';

/**
 * Returns the tag of an image URL, or null when there is none.
 * The tag is the part after the last ':' that follows the last '/', so a
 * registry port ("localhost:5000/ns/cat") is never mistaken for a tag.
 */
export function getTagFromCatalogUrl(url: string): string | null {
  const afterLastSlash = url.slice(url.lastIndexOf('/') + 1);
  const colon = afterLastSlash.lastIndexOf(':');
  if (colon === -1) {
    return null;
  }
  const tag = afterLastSlash.slice(colon + 1);
  return tag || null;
}

/**
 * Validates and normalizes an external catalog image URL. A missing tag becomes "latest",
 * and the result always has the form `<repository>:<tag>`. Rejects flag-like values,
 * digests, unsafe characters, names that collide with built-in catalogs or index files,
 * and registry hosts that expose cloud metadata.
 */
export function parseExternalCatalogUrl(url: string, displayName?: string): CatalogUrlResult {
  if (typeof url !== 'string' || url.length === 0) {
    return { ok: false, error: 'Catalog URL is required' };
  }
  if (url.length > MAX_URL_LENGTH) {
    return { ok: false, error: `Catalog URL must be at most ${MAX_URL_LENGTH} characters` };
  }
  if (url.startsWith('-')) {
    return { ok: false, error: 'Catalog URL must not start with "-"' };
  }
  if (url.includes('@')) {
    return { ok: false, error: 'Digest (@sha256:...) URLs are not supported; use a tag' };
  }
  if (!ALLOWED_URL_CHARS.test(url)) {
    return {
      ok: false,
      error: 'Catalog URL may only contain lowercase letters, digits, and "._/:-"',
    };
  }
  if (!url.includes('/')) {
    return { ok: false, error: 'Catalog URL must look like host/path[:tag]' };
  }

  const explicitTag = getTagFromCatalogUrl(url);
  const tag = explicitTag ?? 'latest';
  const repository = explicitTag === null ? url : url.slice(0, url.length - explicitTag.length - 1);
  const name = repository.slice(repository.lastIndexOf('/') + 1);
  const pathSegments = repository.split('/').slice(1);
  if (!name || !pathSegments.every((segment) => PATH_SEGMENT.test(segment))) {
    return { ok: false, error: 'Catalog URL has an invalid repository path' };
  }
  if (!TAG_PATTERN.test(tag)) {
    return { ok: false, error: 'Catalog URL has an invalid tag' };
  }
  if (BUILTIN_CATALOG_TYPES.includes(name)) {
    return { ok: false, error: `Catalog name "${name}" collides with a built-in catalog` };
  }
  if (RESERVED_NAME_PATTERN.test(name)) {
    return { ok: false, error: `Catalog name "${name}" must not end in .json or .tmp` };
  }
  if (isBlockedRegistryHost(getRegistryHostname(repository))) {
    return { ok: false, error: 'Catalog registry host is not allowed' };
  }

  const catalog: ExternalCatalog = { url: `${repository}:${tag}`, name, tag };
  if (displayName) {
    catalog.displayName = displayName;
  }
  return { ok: true, catalog };
}

/**
 * Maps a catalog URL from a request to the storage type and version directory of its data.
 * Configured externals use their stored name and tag; anything else is treated as built-in.
 */
export function resolveCatalogRef(
  catalogUrl: string,
  externals: ExternalCatalog[],
): { catalogType: string; catalogVersion: string } {
  const external = externals.find((e) => e.url === catalogUrl);
  if (external) {
    return { catalogType: external.name, catalogVersion: external.tag };
  }
  return {
    catalogType: getCatalogNameFromUrl(catalogUrl),
    catalogVersion: getTagFromCatalogUrl(catalogUrl) ?? DEFAULT_BUILTIN_CATALOG_VERSION,
  };
}

export interface CatalogSettings {
  enabledOcpVersions: string[];
  externalCatalogs: ExternalCatalog[];
}

export function defaultCatalogSettings(): CatalogSettings {
  return { enabledOcpVersions: [...SUPPORTED_OCP_VERSIONS], externalCatalogs: [] };
}

/**
 * Validates a settings request body. On success the returned settings are normalized:
 * versions deduplicated in supported order, URLs normalized, display names trimmed (empty
 * ones dropped), and name and tag recomputed from the URL (client-sent values are ignored).
 */
export function validateCatalogSettingsInput(
  body: unknown,
): { ok: true; settings: CatalogSettings } | { ok: false; error: string } {
  if (!body || typeof body !== 'object') {
    return { ok: false, error: 'Request body must be an object' };
  }
  const { enabledOcpVersions, externalCatalogs } = body as Record<string, unknown>;

  if (!Array.isArray(enabledOcpVersions) || !enabledOcpVersions.every((v) => typeof v === 'string')) {
    return { ok: false, error: 'enabledOcpVersions must be an array of strings' };
  }
  if (enabledOcpVersions.length === 0) {
    return { ok: false, error: 'At least one OCP version must be enabled' };
  }
  const unsupported = enabledOcpVersions.filter((v) => !SUPPORTED_OCP_VERSIONS.includes(v));
  if (unsupported.length > 0) {
    return { ok: false, error: `Unsupported OCP version: ${unsupported.join(', ')}` };
  }

  if (!Array.isArray(externalCatalogs)) {
    return { ok: false, error: 'externalCatalogs must be an array' };
  }
  const parsed: ExternalCatalog[] = [];
  for (const entry of externalCatalogs) {
    if (!entry || typeof entry !== 'object' || typeof (entry as { url?: unknown }).url !== 'string') {
      return { ok: false, error: 'Each external catalog needs a url string' };
    }
    const { url, displayName } = entry as { url: string; displayName?: unknown };
    if (displayName !== undefined && typeof displayName !== 'string') {
      return { ok: false, error: 'displayName must be a string' };
    }
    const result = parseExternalCatalogUrl(url, displayName?.trim() || undefined);
    if (!result.ok) {
      return { ok: false, error: `${url}: ${result.error}` };
    }
    if (parsed.some((c) => c.url === result.catalog.url)) {
      return { ok: false, error: `Duplicate catalog URL: ${result.catalog.url}` };
    }
    if (parsed.some((c) => c.name === result.catalog.name)) {
      return { ok: false, error: `Duplicate catalog name: ${result.catalog.name}` };
    }
    parsed.push(result.catalog);
  }

  return {
    ok: true,
    settings: {
      enabledOcpVersions: SUPPORTED_OCP_VERSIONS.filter((v) => enabledOcpVersions.includes(v)),
      externalCatalogs: parsed,
    },
  };
}

const SETTINGS_FILE = 'catalog-settings.json';

/**
 * Reads the settings file. Never throws: a missing file yields defaults silently; an
 * unreadable or invalid file yields defaults, is copied to `<file>.bad` (best effort) so the
 * next save does not destroy it, and is reported through `onWarning`.
 */
export async function readCatalogSettings(
  storageDir: string,
  onWarning?: (message: string) => void,
): Promise<CatalogSettings> {
  const settingsPath = path.join(storageDir, SETTINGS_FILE);
  const useDefaults = async (reason: string): Promise<CatalogSettings> => {
    const message = `Ignoring unusable ${SETTINGS_FILE}, using defaults: ${reason}`;
    console.warn(message);
    let backupNote = `The original file was kept as ${SETTINGS_FILE}.bad.`;
    try {
      await fs.promises.copyFile(settingsPath, `${settingsPath}.bad`);
    } catch (error: unknown) {
      console.error(`Could not back up ${SETTINGS_FILE}: ${(error as Error).message}`);
      backupNote = `Backing it up as ${SETTINGS_FILE}.bad failed, so the next save will overwrite it.`;
    }
    onWarning?.(`${message}. ${backupNote}`);
    return defaultCatalogSettings();
  };

  let raw: unknown;
  try {
    raw = JSON.parse(await fs.promises.readFile(settingsPath, 'utf8'));
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return defaultCatalogSettings();
    }
    return useDefaults((error as Error).message);
  }
  const result = validateCatalogSettingsInput(raw);
  if (!result.ok) {
    return useDefaults(result.error);
  }
  return result.settings;
}

/** Validates, then writes atomically (temp file and rename) so a crash cannot leave a truncated file. */
export async function writeCatalogSettings(storageDir: string, settings: CatalogSettings): Promise<void> {
  const validation = validateCatalogSettingsInput(settings);
  if (!validation.ok) {
    throw new Error(`Refusing to write invalid catalog settings: ${validation.error}`);
  }
  await fs.promises.mkdir(storageDir, { recursive: true });
  const settingsPath = path.join(storageDir, SETTINGS_FILE);
  const tempPath = `${settingsPath}.tmp`;
  await fs.promises.writeFile(tempPath, JSON.stringify(validation.settings, null, 2));
  await fs.promises.rename(tempPath, settingsPath);
}

/**
 * Keeps built-in entries whose OCP version is enabled and external entries that
 * are still configured (same type and URL). Everything else is hidden, but never
 * deleted from disk.
 */
export function filterVisibleCatalogs<
  T extends { catalog_type: string; ocp_version: string; catalog_url: string },
>(entries: T[], settings: CatalogSettings): T[] {
  return entries.filter((entry) => {
    if (BUILTIN_CATALOG_TYPES.includes(entry.catalog_type)) {
      return settings.enabledOcpVersions.includes(entry.ocp_version.replace(/^v/, ''));
    }
    return settings.externalCatalogs.some(
      (external) => external.name === entry.catalog_type && external.url === entry.catalog_url,
    );
  });
}
