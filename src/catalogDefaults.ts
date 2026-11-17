// Helpers for choosing sensible defaults in the Mirror Configuration builder.
// Kept free of React so they can be unit tested.

const RED_HAT_INDEX = '/redhat-operator-index:';

/**
 * Returns the OCP "major.minor" of a platform channel name such as "stable-4.21" or "eus-5.0".
 * The whole name must match "<name>-<major>.<minor>"; anything else (for example
 * "stable-4.21.3") returns null so it cannot outrank a valid channel.
 */
export function platformChannelVersion(channelName: string): string | null {
  const match = /^[a-z][a-z0-9]*-(\d+)\.(\d+)$/i.exec(channelName.trim());
  return match ? `${match[1]}.${match[2]}` : null;
}

function compareMajorMinor(a: string, b: string): number {
  const [aMajor, aMinor] = a.split('.').map(Number);
  const [bMajor, bMinor] = b.split('.').map(Number);
  return aMajor - bMajor || aMinor - bMinor;
}

function catalogVersion(url: string): string | null {
  const match = /:v(\d+\.\d+)$/.exec(url);
  return match ? match[1] : null;
}

/**
 * Picks the operator catalog to preselect when the user adds a catalog.
 *
 * Operators must come from the catalog that matches the cluster version, so prefer the
 * Red Hat operator index for the highest selected platform channel. Without a match, use
 * the newest Red Hat operator index, then the first catalog.
 */
export function pickDefaultCatalogUrl(
  catalogs: { url: string }[],
  platformChannelNames: string[],
): string | undefined {
  const redHatCatalogs = catalogs.filter(c => c.url.includes(RED_HAT_INDEX) && catalogVersion(c.url));

  const platformVersions = platformChannelNames
    .map(platformChannelVersion)
    .filter((v): v is string => v !== null)
    .sort(compareMajorMinor);
  const targetVersion = platformVersions[platformVersions.length - 1];

  if (targetVersion) {
    const match = redHatCatalogs.find(c => catalogVersion(c.url) === targetVersion);
    if (match) return match.url;
  }

  const newest = [...redHatCatalogs].sort((a, b) =>
    compareMajorMinor(catalogVersion(b.url)!, catalogVersion(a.url)!),
  )[0];
  return newest?.url ?? catalogs[0]?.url;
}
