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
    const catalog: string = entry?.catalog ?? '';
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
