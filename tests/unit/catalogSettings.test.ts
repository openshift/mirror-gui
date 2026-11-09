import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  parseExternalCatalogUrl,
  getTagFromCatalogUrl,
  resolveCatalogRef,
  defaultCatalogSettings,
  validateCatalogSettingsInput,
  readCatalogSettings,
  writeCatalogSettings,
  filterVisibleCatalogs,
  type CatalogSettings,
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
    ['dot-dot repository name', 'icr.io/a/..'],
    ['dot repository name', 'icr.io/a/.:latest'],
    ['dot-dot tag', 'icr.io/a/b:..'],
    ['name with leading dot', 'icr.io/a/.hidden'],
    ['empty path segment', 'icr.io//b'],
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

describe('validateCatalogSettingsInput', () => {
  const ok = { enabledOcpVersions: ['4.21'], externalCatalogs: [] };

  it('accepts the defaults', () => {
    const d = defaultCatalogSettings();
    const r = validateCatalogSettingsInput({ enabledOcpVersions: d.enabledOcpVersions, externalCatalogs: [] });
    expect(r.ok).toBe(true);
  });

  it('rejects an empty version list', () => {
    expect(validateCatalogSettingsInput({ ...ok, enabledOcpVersions: [] }).ok).toBe(false);
  });

  it('rejects an unsupported version', () => {
    expect(validateCatalogSettingsInput({ ...ok, enabledOcpVersions: ['4.99'] }).ok).toBe(false);
  });

  it('rejects two externals with the same last path segment', () => {
    const r = validateCatalogSettingsInput({
      ...ok,
      externalCatalogs: [{ url: 'a.io/x/cat:1' }, { url: 'b.io/y/cat:2' }],
    });
    expect(r.ok).toBe(false);
  });

  it('rejects two externals with the same URL', () => {
    const r = validateCatalogSettingsInput({
      ...ok,
      externalCatalogs: [{ url: 'a.io/x/cat:1' }, { url: 'a.io/x/cat:1' }],
    });
    expect(r.ok).toBe(false);
  });

  it('rejects non-object bodies and malformed fields', () => {
    expect(validateCatalogSettingsInput(null).ok).toBe(false);
    expect(validateCatalogSettingsInput({ enabledOcpVersions: 'x', externalCatalogs: [] }).ok).toBe(false);
    expect(validateCatalogSettingsInput({ ...ok, externalCatalogs: [{ url: '--x' }] }).ok).toBe(false);
  });

  it('normalizes: orders versions by the supported list and fills the tag', () => {
    const r = validateCatalogSettingsInput({
      enabledOcpVersions: ['4.21', '4.16'],
      externalCatalogs: [{ url: 'icr.io/cpopen/datapower-operator-catalog', displayName: 'DP' }],
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.settings.enabledOcpVersions).toEqual(['4.16', '4.21']);
      expect(r.settings.externalCatalogs[0]).toEqual({
        url: 'icr.io/cpopen/datapower-operator-catalog:latest',
        name: 'datapower-operator-catalog',
        tag: 'latest',
        displayName: 'DP',
      });
    }
  });
});

describe('readCatalogSettings', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'catset-'));
  });
  afterEach(async () => {
    await fs.promises.rm(dir, { recursive: true, force: true });
  });

  it('returns defaults when the file is missing', async () => {
    expect(await readCatalogSettings(dir)).toEqual(defaultCatalogSettings());
  });

  it('returns defaults for invalid JSON', async () => {
    await fs.promises.writeFile(path.join(dir, 'catalog-settings.json'), 'not json');
    expect(await readCatalogSettings(dir)).toEqual(defaultCatalogSettings());
  });

  it('warns when an existing settings file is rejected and defaults are used', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await fs.promises.writeFile(
      path.join(dir, 'catalog-settings.json'),
      JSON.stringify({ enabledOcpVersions: ['4.99'], externalCatalogs: [] }),
    );
    expect(await readCatalogSettings(dir)).toEqual(defaultCatalogSettings());
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('catalog-settings.json'));
    warn.mockRestore();
  });

  it('does not warn when the settings file simply does not exist', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await readCatalogSettings(dir);
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('returns defaults when validation fails', async () => {
    await fs.promises.writeFile(
      path.join(dir, 'catalog-settings.json'),
      JSON.stringify({ enabledOcpVersions: [], externalCatalogs: [] }),
    );
    expect(await readCatalogSettings(dir)).toEqual(defaultCatalogSettings());
  });

  it('round-trips written settings', async () => {
    const parsed = validateCatalogSettingsInput({
      enabledOcpVersions: ['4.20'],
      externalCatalogs: [{ url: 'icr.io/cpopen/datapower-operator-catalog:latest' }],
    });
    if (!parsed.ok) throw new Error(parsed.error);
    await writeCatalogSettings(dir, parsed.settings);
    expect(await readCatalogSettings(dir)).toEqual(parsed.settings);
  });
});

describe('filterVisibleCatalogs', () => {
  const DP = 'icr.io/cpopen/datapower-operator-catalog:latest';
  const entry = (catalog_type: string, ocp_version: string, catalog_url: string) => ({
    catalog_type,
    ocp_version,
    catalog_url,
  });
  const rh = (v: string) =>
    entry('redhat-operator-index', v, `registry.redhat.io/redhat/redhat-operator-index:${v}`);
  const dp = entry('datapower-operator-catalog', 'latest', DP);
  const settings = (over: Partial<CatalogSettings>): CatalogSettings => ({
    enabledOcpVersions: ['4.21'],
    externalCatalogs: [],
    ...over,
  });
  const external = { url: DP, name: 'datapower-operator-catalog', tag: 'latest' };

  it('drops built-in entries for disabled versions and keeps enabled ones', () => {
    const out = filterVisibleCatalogs([rh('v4.20'), rh('v4.21')], settings({}));
    expect(out.map((e) => e.ocp_version)).toEqual(['v4.21']);
  });

  it('keeps a configured external regardless of enabled versions', () => {
    const out = filterVisibleCatalogs([dp], settings({ externalCatalogs: [external] }));
    expect(out).toEqual([dp]);
  });

  it('hides an external entry that is no longer in settings', () => {
    expect(filterVisibleCatalogs([dp], settings({}))).toEqual([]);
  });

  it('hides an entry whose type matches an external but whose URL differs', () => {
    const stale = entry('datapower-operator-catalog', 'v2', 'icr.io/cpopen/datapower-operator-catalog:v2');
    const out = filterVisibleCatalogs([stale], settings({ externalCatalogs: [external] }));
    expect(out).toEqual([]);
  });

  it('drops unknown catalog types that are not configured', () => {
    const unknown = entry('mystery-catalog', 'v4.21', 'x.io/y/mystery-catalog:v4.21');
    expect(filterVisibleCatalogs([unknown], settings({}))).toEqual([]);
  });
});
