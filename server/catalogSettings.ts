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
// Path segments and tags become directory names, so they must start with an
// alphanumeric character (this rules out "." and "..").
const PATH_SEGMENT = /^[a-z0-9][a-z0-9._-]*$/;
const TAG_PATTERN = /^[a-z0-9_][a-z0-9._-]{0,127}$/;

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

  const tag = getTagFromCatalogUrl(url) ?? 'latest';
  const repository = getTagFromCatalogUrl(url) === null ? url : url.slice(0, url.length - tag.length - 1);
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

  const catalog: ExternalCatalog = { url: `${repository}:${tag}`, name, tag };
  if (displayName) {
    catalog.displayName = displayName;
  }
  return { ok: true, catalog };
}

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
    catalogVersion: getTagFromCatalogUrl(catalogUrl) ?? 'v4.21',
  };
}

export interface CatalogSettings {
  enabledOcpVersions: string[];
  externalCatalogs: ExternalCatalog[];
}

export function defaultCatalogSettings(): CatalogSettings {
  return { enabledOcpVersions: [...SUPPORTED_OCP_VERSIONS], externalCatalogs: [] };
}

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

export async function readCatalogSettings(storageDir: string): Promise<CatalogSettings> {
  try {
    const raw = JSON.parse(await fs.promises.readFile(path.join(storageDir, SETTINGS_FILE), 'utf8'));
    const result = validateCatalogSettingsInput(raw);
    return result.ok ? result.settings : defaultCatalogSettings();
  } catch {
    return defaultCatalogSettings();
  }
}

export async function writeCatalogSettings(storageDir: string, settings: CatalogSettings): Promise<void> {
  await fs.promises.mkdir(storageDir, { recursive: true });
  await fs.promises.writeFile(path.join(storageDir, SETTINGS_FILE), JSON.stringify(settings, null, 2));
}
