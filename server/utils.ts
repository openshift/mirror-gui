export interface ChannelObject {
  name: string;
  availableVersions?: string[];
  minVersion?: string | null;
  maxVersion?: string | null;
}

export interface OperatorEntryForUtils {
  name: string;
  channels?: (string | { name: string })[];
  channelVersions?: Record<string, string[]>;
  channelVersionRanges?: Record<string, { minVersion?: string | null; maxVersion?: string | null }>;
  availableVersions?: string[];
}

export function parseOcMirrorVersion(raw: string): string {
  const match = raw.match(/GitVersion:\"(\d+\.\d+\.\d+)/);
  if (match) {
    return match[1];
  }
  const fallback = raw.match(/(\d+\.\d+\.\d+)/);
  if (fallback) {
    return fallback[1];
  }
  return 'Not available';
}

export function parseOcVersion(raw: string): string {
  const lines = raw.split('\n');
  for (const line of lines) {
    if (line.includes('Client Version:')) {
      const match = line.match(/Client Version:\s*(\S+)/);
      if (match) {
        return match[1];
      }
    }
  }
  const fallback = raw.match(/(\d+\.\d+\.\d+)/);
  if (fallback) {
    return fallback[1];
  }
  return 'Not available';
}

export function getCatalogNameFromUrl(catalogUrl: string): string {
  if (catalogUrl.includes('redhat-operator-index')) {
    return 'redhat-operator-index';
  } else if (catalogUrl.includes('certified-operator-index')) {
    return 'certified-operator-index';
  } else if (catalogUrl.includes('community-operator-index')) {
    return 'community-operator-index';
  }
  return 'redhat-operator-index';
}

export function getCatalogDescription(catalogType: string): string {
  const descriptions: Record<string, string> = {
    'redhat-operator-index': 'Red Hat certified operators',
    'certified-operator-index': 'Certified operators from partners',
    'community-operator-index': 'Community operators',
  };
  return descriptions[catalogType] || 'Unknown catalog type';
}

export function compareVersionStrings(a: string, b: string): number {
  const getBaseVersion = (version: string): string => {
    const match = version.match(/^(\d+\.\d+\.\d+)/);
    return match ? match[1] : version;
  };

  const baseA = getBaseVersion(a);
  const baseB = getBaseVersion(b);

  const partsA = baseA.split('.').map(Number);
  const partsB = baseB.split('.').map(Number);

  for (let i = 0; i < Math.max(partsA.length, partsB.length); i++) {
    const partA = partsA[i] || 0;
    const partB = partsB[i] || 0;

    if (partA !== partB) {
      return partA - partB;
    }
  }

  return a.localeCompare(b);
}

export function sortVersions(versions: string[]): string[] {
  return Array.from(
    new Set(versions.filter((version) => version && version.trim()))
  ).sort(compareVersionStrings);
}

export function getQueryStringValue(value: unknown): string | undefined {
  if (typeof value === 'string') {
    return value;
  }

  if (Array.isArray(value)) {
    const first = value[0];
    return typeof first === 'string' ? first : undefined;
  }

  return undefined;
}

export function extractChannelNames(
  channels: (string | { name: string })[] | undefined
): string[] {
  if (!channels || !Array.isArray(channels)) {
    return [];
  }

  if (channels.length === 1 && typeof channels[0] === 'string') {
    if (channels[0].includes('\n')) {
      return channels[0]
        .split('\n')
        .filter((line) => line.trim())
        .map((channel) => channel.trim());
    }

    if (channels[0].includes(' ')) {
      return channels[0]
        .split(' ')
        .filter((channel) => channel.trim())
        .map((channel) => channel.trim());
    }

    return [channels[0]];
  }

  return channels
    .map((channel) => {
      if (typeof channel === 'string') {
        return channel;
      }

      if (channel && typeof channel === 'object' && channel.name) {
        return channel.name;
      }

      return String(channel);
    })
    .filter((channel) => channel.trim());
}

export function extractVersionInfo(
  channelNames: string[],
  operatorName: string | null
): { genericChannels: string[]; versions: string[] } {
  const versions = new Set<string>();
  const genericChannels: string[] = [];

  channelNames.forEach((channel) => {
    if (!channel || !channel.trim()) return;

    if (operatorName && channel.includes(`${operatorName}.`)) {
      const versionWithV = channel.match(
        new RegExp(
          `${operatorName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\.v(.+)`
        )
      );
      if (versionWithV) {
        versions.add(versionWithV[1]);
        return;
      }

      const versionWithoutV = channel.match(
        new RegExp(
          `${operatorName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\.(.+)`
        )
      );
      if (versionWithoutV) {
        versions.add(versionWithoutV[1]);
        return;
      }
    }

    if (operatorName) {
      const operatorBase = operatorName
        .replace(/-certified$/, '')
        .replace(/-community$/, '');
      if (operatorBase !== operatorName && channel.includes(`${operatorBase}.`)) {
        const versionWithV = channel.match(
          new RegExp(
            `${operatorBase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\.v(.+)`
          )
        );
        if (versionWithV) {
          versions.add(versionWithV[1]);
          return;
        }

        const versionWithoutV = channel.match(
          new RegExp(
            `${operatorBase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\.(.+)`
          )
        );
        if (versionWithoutV) {
          versions.add(versionWithoutV[1]);
          return;
        }
      }
    }

    const genericVersionWithV = channel.match(/^[^.]+\.v(.+)/);
    if (genericVersionWithV) {
      versions.add(genericVersionWithV[1]);
      return;
    }

    const genericVersionWithoutV = channel.match(
      /^[^.]+\.(\d+\.\d+\.\d+.*)/
    );
    if (genericVersionWithoutV) {
      versions.add(genericVersionWithoutV[1]);
      return;
    }

    const versionMatch = channel.match(/^v?(\d+\.\d+\.\d+)/);
    if (versionMatch) {
      versions.add(versionMatch[1]);
      return;
    }

    genericChannels.push(channel);
  });

  return {
    genericChannels,
    versions: sortVersions(Array.from(versions)),
  };
}

export function getVersionsFromMetadata(
  operatorData: OperatorEntryForUtils,
  channelName?: string
): string[] {
  if (
    channelName &&
    operatorData.channelVersions &&
    Object.prototype.hasOwnProperty.call(operatorData.channelVersions, channelName)
  ) {
    return sortVersions(operatorData.channelVersions[channelName] || []);
  }

  if (!channelName) {
    const allChannelVersions = Object.values(
      operatorData.channelVersions || {}
    ).flat();
    if (
      allChannelVersions.length > 0 ||
      Object.keys(operatorData.channelVersions || {}).length > 0
    ) {
      return sortVersions(allChannelVersions);
    }

    if (operatorData.availableVersions) {
      return sortVersions(operatorData.availableVersions);
    }
  }

  const channelNames = extractChannelNames(operatorData.channels);
  const { versions } = extractVersionInfo(channelNames, operatorData.name);
  return versions;
}

export function normalizeChannels(
  channels: (string | { name: string })[] | undefined,
  operatorName: string | null = null,
  operatorData?: OperatorEntryForUtils
): ChannelObject[] {
  let channelNames = extractChannelNames(channels);

  if (channelNames.length === 0 && operatorData?.channelVersions) {
    channelNames = Object.keys(operatorData.channelVersions);
  }

  if (channelNames.length === 0) {
    return [];
  }

  if (operatorData?.channelVersions || operatorData?.channelVersionRanges) {
    return channelNames.map((channel) => {
      const range = operatorData?.channelVersionRanges?.[channel];
      const availableVersions = operatorData
        ? getVersionsFromMetadata(operatorData, channel)
        : [];
      return {
        name: channel,
        availableVersions,
        minVersion: range?.minVersion ?? null,
        maxVersion: range?.maxVersion ?? null,
      };
    });
  }

  const { genericChannels, versions } = extractVersionInfo(
    channelNames,
    operatorName
  );
  const channelObjects: ChannelObject[] = genericChannels.map((channel) => ({
    name: channel,
  }));

  if (channelObjects.length > 0 && versions.length > 0) {
    channelObjects[0].availableVersions = versions;
  }

  return channelObjects;
}
