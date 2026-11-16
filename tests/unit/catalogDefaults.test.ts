import { describe, it, expect } from 'vitest';
import { pickDefaultCatalogUrl, platformChannelVersion } from '../../src/catalogDefaults.js';

const versions = ['4.16', '4.17', '4.18', '4.19', '4.20', '4.21', '4.22'];
const catalogs = versions.flatMap(v => [
  { url: `registry.redhat.io/redhat/redhat-operator-index:v${v}` },
  { url: `registry.redhat.io/redhat/certified-operator-index:v${v}` },
  { url: `registry.redhat.io/redhat/community-operator-index:v${v}` },
]);

describe('platformChannelVersion', () => {
  it('extracts major.minor from channel names', () => {
    expect(platformChannelVersion('stable-4.21')).toBe('4.21');
    expect(platformChannelVersion('eus-5.0')).toBe('5.0');
    expect(platformChannelVersion('fast-4.18')).toBe('4.18');
  });

  it('returns null when there is no version', () => {
    expect(platformChannelVersion('')).toBeNull();
    expect(platformChannelVersion('stable')).toBeNull();
  });
});

describe('pickDefaultCatalogUrl', () => {
  it('matches the platform channel version instead of the first catalog (v4.16)', () => {
    expect(pickDefaultCatalogUrl(catalogs, ['stable-4.21'])).toBe(
      'registry.redhat.io/redhat/redhat-operator-index:v4.21',
    );
  });

  it('uses the highest platform channel when several are selected (upgrade path)', () => {
    expect(pickDefaultCatalogUrl(catalogs, ['stable-4.20', 'stable-4.22', 'stable-4.21'])).toBe(
      'registry.redhat.io/redhat/redhat-operator-index:v4.22',
    );
  });

  it('falls back to the newest Red Hat index when no platform channel is selected', () => {
    expect(pickDefaultCatalogUrl(catalogs, [])).toBe(
      'registry.redhat.io/redhat/redhat-operator-index:v4.22',
    );
  });

  it('falls back to the newest Red Hat index when the platform version has no catalog', () => {
    expect(pickDefaultCatalogUrl(catalogs, ['stable-5.0'])).toBe(
      'registry.redhat.io/redhat/redhat-operator-index:v4.22',
    );
  });

  it('falls back to the first catalog when there is no Red Hat index', () => {
    const others = [{ url: 'registry.example.com/my/catalog:latest' }];
    expect(pickDefaultCatalogUrl(others, ['stable-4.21'])).toBe('registry.example.com/my/catalog:latest');
  });

  it('returns undefined for an empty list', () => {
    expect(pickDefaultCatalogUrl([], ['stable-4.21'])).toBeUndefined();
  });
});
