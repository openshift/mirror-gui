import { describe, it, expect } from 'vitest';
import {
  parseOcMirrorVersion,
  parseOcVersion,
  getCatalogNameFromUrl,
  getCatalogDescription,
  compareVersionStrings,
  sortVersions,
  getQueryStringValue,
  extractChannelNames,
  extractVersionInfo,
  normalizeChannels,
  getVersionsFromMetadata,
} from '../../server/utils.js';

describe('parseOcMirrorVersion', () => {
  it('extracts version from GitVersion format', () => {
    expect(
      parseOcMirrorVersion('oc-mirror version 1.2.3 GitVersion:"1.2.3"')
    ).toBe('1.2.3');
  });

  it('uses fallback regex when GitVersion not present', () => {
    expect(parseOcMirrorVersion('version 2.0.1')).toBe('2.0.1');
  });

  it('returns "Not available" when no version found', () => {
    expect(parseOcMirrorVersion('no version here')).toBe('Not available');
  });
});

describe('parseOcVersion', () => {
  it('extracts from Client Version line', () => {
    const output = `Client Version: 4.15.0
Server Version: 4.14.0`;
    expect(parseOcVersion(output)).toBe('4.15.0');
  });

  it('uses fallback regex when Client Version not present', () => {
    expect(parseOcVersion('4.21.0')).toBe('4.21.0');
  });

  it('returns "Not available" when no version found', () => {
    expect(parseOcVersion('oc version')).toBe('Not available');
  });
});

describe('getCatalogNameFromUrl', () => {
  it('maps redhat-operator-index URL', () => {
    expect(
      getCatalogNameFromUrl(
        'registry.redhat.io/redhat/redhat-operator-index:v4.21'
      )
    ).toBe('redhat-operator-index');
  });

  it('maps certified-operator-index URL', () => {
    expect(
      getCatalogNameFromUrl(
        'registry.redhat.io/redhat/certified-operator-index:v4.21'
      )
    ).toBe('certified-operator-index');
  });

  it('maps community-operator-index URL', () => {
    expect(
      getCatalogNameFromUrl(
        'registry.redhat.io/redhat/community-operator-index:v4.21'
      )
    ).toBe('community-operator-index');
  });

  it('returns redhat-operator-index as default for unknown', () => {
    expect(getCatalogNameFromUrl('unknown/catalog')).toBe(
      'redhat-operator-index'
    );
  });
});

describe('getCatalogDescription', () => {
  it('returns description for known catalog types', () => {
    expect(getCatalogDescription('redhat-operator-index')).toBe(
      'Red Hat certified operators'
    );
    expect(getCatalogDescription('certified-operator-index')).toBe(
      'Certified operators from partners'
    );
    expect(getCatalogDescription('community-operator-index')).toBe(
      'Community operators'
    );
  });

  it('returns "Unknown catalog type" for unknown', () => {
    expect(getCatalogDescription('unknown')).toBe('Unknown catalog type');
  });
});

describe('compareVersionStrings', () => {
  it('orders versions correctly', () => {
    expect(compareVersionStrings('1.0.0', '1.0.1')).toBeLessThan(0);
    expect(compareVersionStrings('1.0.1', '1.0.0')).toBeGreaterThan(0);
    expect(compareVersionStrings('1.0.0', '1.1.0')).toBeLessThan(0);
    expect(compareVersionStrings('1.1.0', '2.0.0')).toBeLessThan(0);
  });

  it('returns 0 for equal base versions', () => {
    expect(compareVersionStrings('1.0.0', '1.0.0')).toBe(0);
  });

  it('extracts base version from longer strings', () => {
    expect(compareVersionStrings('4.21.0-0', '4.21.1')).toBeLessThan(0);
  });
});

describe('sortVersions', () => {
  it('deduplicates and sorts versions', () => {
    expect(sortVersions(['1.0.1', '1.0.0', '1.0.1'])).toEqual([
      '1.0.0',
      '1.0.1',
    ]);
  });

  it('filters empty and whitespace', () => {
    expect(sortVersions(['1.0.0', '', '  ', '1.0.1'])).toEqual([
      '1.0.0',
      '1.0.1',
    ]);
  });
});

describe('getQueryStringValue', () => {
  it('returns string as-is', () => {
    expect(getQueryStringValue('foo')).toBe('foo');
  });

  it('returns first element of array if string', () => {
    expect(getQueryStringValue(['foo', 'bar'])).toBe('foo');
  });

  it('returns undefined for non-string array element', () => {
    expect(getQueryStringValue([123])).toBeUndefined();
  });

  it('returns undefined for undefined', () => {
    expect(getQueryStringValue(undefined)).toBeUndefined();
  });

  it('returns undefined for object', () => {
    expect(getQueryStringValue({ a: 1 })).toBeUndefined();
  });
});

describe('extractChannelNames', () => {
  it('returns empty array for undefined or non-array', () => {
    expect(extractChannelNames(undefined)).toEqual([]);
    expect(extractChannelNames(null as unknown as undefined)).toEqual([]);
  });

  it('splits single string by newlines', () => {
    expect(extractChannelNames(['stable\nbeta'])).toEqual(['stable', 'beta']);
  });

  it('splits single string by spaces', () => {
    expect(extractChannelNames(['stable beta'])).toEqual(['stable', 'beta']);
  });

  it('returns single string as single element when no delimiter', () => {
    expect(extractChannelNames(['stable'])).toEqual(['stable']);
  });

  it('extracts name from object channels', () => {
    expect(
      extractChannelNames([{ name: 'release-2.16' }, { name: 'stable' }])
    ).toEqual(['release-2.16', 'stable']);
  });

  it('handles mixed string and object channels', () => {
    expect(extractChannelNames(['stable', { name: 'beta' }])).toEqual([
      'stable',
      'beta',
    ]);
  });
});

describe('extractVersionInfo', () => {
  it('extracts versions from operator-prefixed channels', () => {
    const result = extractVersionInfo(
      ['acm.v2.16.0', 'acm.v2.15.0'],
      'acm'
    );
    expect(result.versions).toContain('2.16.0');
    expect(result.versions).toContain('2.15.0');
  });

  it('adds non-version channels to genericChannels', () => {
    const result = extractVersionInfo(['stable', 'beta'], null);
    expect(result.genericChannels).toEqual(['stable', 'beta']);
    expect(result.versions).toEqual([]);
  });

  it('extracts generic version with v prefix', () => {
    const result = extractVersionInfo(['pkg.v1.0.0'], null);
    expect(result.versions).toContain('1.0.0');
  });
});

describe('normalizeChannels', () => {
  it('returns empty array for empty or undefined channels', () => {
    expect(normalizeChannels(undefined)).toEqual([]);
    expect(normalizeChannels([])).toEqual([]);
  });

  it('uses channelVersions when available', () => {
    const result = normalizeChannels(undefined, null, {
      name: 'op',
      channelVersions: {
        stable: ['1.0.0', '1.0.1'],
        beta: ['1.1.0'],
      },
    });
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      name: 'stable',
      availableVersions: ['1.0.0', '1.0.1'],
    });
  });

  it('uses channelVersionRanges when available', () => {
    const result = normalizeChannels(undefined, null, {
      name: 'op',
      channelVersions: { stable: ['1.0.0'] },
      channelVersionRanges: {
        stable: { minVersion: '1.0.0', maxVersion: '1.0.1' },
      },
    });
    expect(result[0]).toMatchObject({
      name: 'stable',
      minVersion: '1.0.0',
      maxVersion: '1.0.1',
    });
  });

  it('maps generic channels with versions from extractVersionInfo', () => {
    const result = normalizeChannels(['stable', 'pkg.v1.0.0'], 'pkg');
    expect(result.length).toBeGreaterThanOrEqual(1);
    expect(result[0].name).toBe('stable');
  });
});

describe('getVersionsFromMetadata', () => {
  it('returns versions for specific channel', () => {
    const result = getVersionsFromMetadata(
      {
        name: 'op',
        channelVersions: { stable: ['1.0.0', '1.0.1'] },
      },
      'stable'
    );
    expect(result).toEqual(['1.0.0', '1.0.1']);
  });

  it('returns all channel versions when no channel specified', () => {
    const result = getVersionsFromMetadata({
      name: 'op',
      channelVersions: {
        stable: ['1.0.0'],
        beta: ['1.1.0'],
      },
    });
    expect(result).toContain('1.0.0');
    expect(result).toContain('1.1.0');
  });

  it('falls back to availableVersions', () => {
    const result = getVersionsFromMetadata({
      name: 'op',
      availableVersions: ['2.0.0', '2.0.1'],
    });
    expect(result).toEqual(['2.0.0', '2.0.1']);
  });

  it('extracts from channels when no metadata', () => {
    const result = getVersionsFromMetadata({
      name: 'acm',
      channels: ['acm.v2.16.0', 'acm.v2.15.0'],
    });
    expect(result).toContain('2.16.0');
    expect(result).toContain('2.15.0');
  });
});
