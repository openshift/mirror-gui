import { describe, it, expect } from 'vitest';
import {
  parseExternalCatalogUrl,
  getTagFromCatalogUrl,
  resolveCatalogRef,
} from '../../server/catalogSettings.js';

describe('parseExternalCatalogUrl', () => {
  it('parses a URL with a tag', () => {
    const r = parseExternalCatalogUrl('icr.io/cpopen/datapower-operator-catalog:latest');
    expect(r).toEqual({
      ok: true,
      catalog: {
        url: 'icr.io/cpopen/datapower-operator-catalog:latest',
        name: 'datapower-operator-catalog',
        tag: 'latest',
      },
    });
  });

  it('defaults the tag to latest when absent', () => {
    const r = parseExternalCatalogUrl('icr.io/cpopen/datapower-operator-catalog');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.catalog.tag).toBe('latest');
      expect(r.catalog.url.endsWith(':latest')).toBe(true);
    }
  });

  it('does not treat a registry port as a tag', () => {
    const r = parseExternalCatalogUrl('localhost:5000/ns/cat');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.catalog.name).toBe('cat');
      expect(r.catalog.tag).toBe('latest');
      expect(r.catalog.url).toBe('localhost:5000/ns/cat:latest');
    }
  });

  it('keeps an explicit tag after a registry port', () => {
    const r = parseExternalCatalogUrl('localhost:5000/ns/cat:v2');
    expect(r.ok && r.catalog.tag).toBe('v2');
  });

  it('keeps the display name', () => {
    const r = parseExternalCatalogUrl('icr.io/a/b:1', 'My Catalog');
    expect(r.ok && r.catalog.displayName).toBe('My Catalog');
  });

  it.each([
    ['option flag', '--registry-config=x'],
    ['leading dash', '-icr.io/a/b'],
    ['whitespace', 'icr.io/a/b c'],
    ['semicolon', 'icr.io/a/b;rm'],
    ['backticks', 'icr.io/a/`id`'],
    ['command substitution', 'icr.io/a/$(id)'],
    ['uppercase', 'ICR.io/a/b'],
    ['digest', 'icr.io/a/b@sha256:' + 'a'.repeat(64)],
    ['empty', ''],
    ['too long', 'icr.io/a/' + 'b'.repeat(300)],
    ['no slash', 'icr.io'],
    ['built-in name collision', 'registry.example.com/x/redhat-operator-index:v1'],
  ])('rejects %s', (_label, url) => {
    const r = parseExternalCatalogUrl(url);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.length).toBeGreaterThan(0);
  });
});

describe('getTagFromCatalogUrl', () => {
  it('returns the tag', () => {
    expect(getTagFromCatalogUrl('registry.redhat.io/redhat/redhat-operator-index:v4.21')).toBe('v4.21');
  });

  it('returns null when only a registry port is present', () => {
    expect(getTagFromCatalogUrl('localhost:5000/ns/cat')).toBeNull();
  });
});

describe('resolveCatalogRef', () => {
  it('resolves built-in catalogs from the URL', () => {
    expect(
      resolveCatalogRef('registry.redhat.io/redhat/community-operator-index:v4.20', []),
    ).toEqual({ catalogType: 'community-operator-index', catalogVersion: 'v4.20' });
  });

  it('resolves configured externals by exact URL', () => {
    const external = {
      url: 'icr.io/cpopen/datapower-operator-catalog:latest',
      name: 'datapower-operator-catalog',
      tag: 'latest',
    };
    expect(resolveCatalogRef(external.url, [external])).toEqual({
      catalogType: 'datapower-operator-catalog',
      catalogVersion: 'latest',
    });
  });

  it('falls back to the existing default for unknown URLs', () => {
    expect(resolveCatalogRef('unknown/catalog', [])).toEqual({
      catalogType: 'redhat-operator-index',
      catalogVersion: 'v4.21',
    });
  });
});
