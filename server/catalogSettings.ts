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
  if (!name) {
    return { ok: false, error: 'Catalog URL must end with a repository name' };
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
