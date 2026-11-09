export interface CatalogSummary {
  catalog: string;
  /** Shortened image name, e.g. "redhat-operator-index:v4.20". */
  label: string;
  operators: number;
  channels: number;
  /** True when the catalog has no explicit packages (oc-mirror mirrors all of it). */
  isFullCatalog: boolean;
}

export interface OperatorSummary {
  operators: number;
  channels: number;
  catalogs: CatalogSummary[];
}

/**
 * Counts operators (packages) and channels in an uploaded ImageSetConfiguration.
 * `mirror.operators[]` holds catalogs, so its length is NOT the operator count.
 */
export function summarizeOperators(catalogEntries: unknown): OperatorSummary {
  const entries = Array.isArray(catalogEntries) ? catalogEntries : [];
  const catalogs = entries.map((entry): CatalogSummary => {
    // YAML can yield non-string values (e.g. `catalog: 0`); treat them as empty so rendering never throws.
    const catalog: string = typeof entry?.catalog === 'string' ? entry.catalog : '';
    const packages: { channels?: unknown[] }[] = Array.isArray(entry?.packages) ? entry.packages : [];
    return {
      catalog,
      label: catalog.split('/').pop() || catalog,
      operators: packages.length,
      channels: packages.reduce((sum, pkg) => sum + (Array.isArray(pkg?.channels) ? pkg.channels.length : 0), 0),
      isFullCatalog: packages.length === 0,
    };
  });
  return {
    operators: catalogs.reduce((sum, c) => sum + c.operators, 0),
    channels: catalogs.reduce((sum, c) => sum + c.channels, 0),
    catalogs,
  };
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Validates the shape of an uploaded `mirror.operators` section.
 * Returns an error message for the first problem found, or null when valid.
 * Absent (or null) `operators` and `packages` are valid: oc-mirror treats a catalog without packages as a full catalog.
 */
export function validateOperators(catalogEntries: unknown): string | null {
  if (catalogEntries == null) return null;
  if (!Array.isArray(catalogEntries)) return 'Invalid YAML: mirror.operators must be a list';
  for (const [i, entry] of catalogEntries.entries()) {
    const where = `mirror.operators[${i}]`;
    if (!isPlainObject(entry)) return `Invalid YAML: ${where} must be a mapping`;
    if (typeof entry.catalog !== 'string' || entry.catalog === '') {
      return `Invalid YAML: ${where}.catalog must be a non-empty string`;
    }
    if (entry.packages == null) continue;
    if (!Array.isArray(entry.packages)) return `Invalid YAML: ${where}.packages must be a list`;
    for (const [j, pkg] of entry.packages.entries()) {
      if (!isPlainObject(pkg) || typeof pkg.name !== 'string' || pkg.name === '') {
        return `Invalid YAML: ${where}.packages[${j}] must have a string name`;
      }
    }
  }
  return null;
}
