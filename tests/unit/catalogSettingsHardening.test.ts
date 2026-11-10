import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  parseExternalCatalogUrl,
  getTagFromCatalogUrl,
  validateCatalogSettingsInput,
  readCatalogSettings,
  writeCatalogSettings,
  defaultCatalogSettings,
} from '../../server/catalogSettings.js';

function expectRejected(url: string, reason: RegExp): void {
  const result = parseExternalCatalogUrl(url);
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.error).toMatch(reason);
  }
}

describe('parseExternalCatalogUrl rejection reasons', () => {
  it.each([
    ['quay.io/x/catalog-index.json:latest', /\.json or \.tmp/],
    ['quay.io/x/catalog.json', /\.json or \.tmp/],
    ['quay.io/x/leftover.tmp:1', /\.json or \.tmp/],
  ])('rejects index-like name %s so removal can never delete index files', (url, reason) => {
    expectRejected(url, reason);
  });

  it.each([
    '169.254.169.254/latest/meta:1',
    '169.254.169.254:80/latest/meta:1',
    '2852039166/x/y:1',
    '0xa9fea9fe/x/y:1',
    '0.0.0.0:5000/x/y:1',
    'metadata.google.internal/x/y:1',
    'metadata/x/y:1',
    // FQDN trailing dot and alternate IP spellings resolve to the same hosts.
    'metadata./x/y:1',
    'metadata.google.internal./x/y:1',
    '2852039166./x/y:1',
    '169.254.169.254./x/y:1',
    '0251.0376.0251.0376/x/y:1',
    '169.16689662/x/y:1',
    '0251.254.169.254/x/y:1',
  ])('rejects metadata-style host in %s', (url) => {
    expectRejected(url, /host is not allowed/);
  });

  it.each([
    'localhost:5000/ns/cat:v2',
    '10.0.0.5:5000/ns/cat',
    '192.168.1.10/ns/cat:1',
    'registry.internal.example.com/team/cat:stable',
  ])('allows private and loopback registries such as %s (air-gapped setups need them)', (url) => {
    expect(parseExternalCatalogUrl(url).ok).toBe(true);
  });

  it('gives a specific reason for each structural failure', () => {
    expectRejected('icr.io/x/cat@sha256:abc', /Digest/);
    expectRejected('--registry-config=x', /must not start with "-"/);
    expectRejected('icr.io/x/redhat-operator-index:v4.21', /collides with a built-in/);
    expectRejected('icr.io/./cat:1', /invalid repository path/);
    expectRejected('icr.io//cat:1', /invalid repository path/);
    expectRejected('icr.io/x/Cat:1', /lowercase/);
    expectRejected('icr.io/x/cat:V1', /lowercase/);
    expectRejected('justaname', /host\/path/);
  });

  it('accepts nested repository paths and ports with tags', () => {
    expect(parseExternalCatalogUrl('registry.example.com:8443/a/b/c/cat:1.0-rc1')).toEqual({
      ok: true,
      catalog: { url: 'registry.example.com:8443/a/b/c/cat:1.0-rc1', name: 'cat', tag: '1.0-rc1' },
    });
  });

  it('treats a trailing colon as no tag', () => {
    expect(getTagFromCatalogUrl('icr.io/x/cat:')).toBeNull();
  });
});

describe('validateCatalogSettingsInput normalization and reasons', () => {
  const base = { enabledOcpVersions: ['4.21'] };

  it('deduplicates versions and orders them by supported order', () => {
    const result = validateCatalogSettingsInput({
      enabledOcpVersions: ['4.21', '4.16', '4.21'],
      externalCatalogs: [],
    });
    expect(result).toEqual({
      ok: true,
      settings: { enabledOcpVersions: ['4.16', '4.21'], externalCatalogs: [] },
    });
  });

  it('rejects non-string versions', () => {
    const result = validateCatalogSettingsInput({ enabledOcpVersions: [4.21], externalCatalogs: [] });
    expect(result).toEqual({ ok: false, error: 'enabledOcpVersions must be an array of strings' });
  });

  it('rejects a non-string displayName and an entry without url', () => {
    expect(
      validateCatalogSettingsInput({ ...base, externalCatalogs: [{ url: 'icr.io/x/cat:1', displayName: 5 }] }),
    ).toEqual({ ok: false, error: 'displayName must be a string' });
    expect(validateCatalogSettingsInput({ ...base, externalCatalogs: [{ displayName: 'x' }] })).toEqual({
      ok: false,
      error: 'Each external catalog needs a url string',
    });
  });

  it('drops a whitespace-only displayName and trims others', () => {
    const result = validateCatalogSettingsInput({
      ...base,
      externalCatalogs: [
        { url: 'icr.io/x/one:1', displayName: '   ' },
        { url: 'icr.io/x/two:1', displayName: '  Two  ' },
      ],
    });
    expect(result.ok && result.settings.externalCatalogs).toEqual([
      { url: 'icr.io/x/one:1', name: 'one', tag: '1' },
      { url: 'icr.io/x/two:1', name: 'two', tag: '1', displayName: 'Two' },
    ]);
  });

  it('reports duplicate URL and duplicate name as different problems', () => {
    expect(
      validateCatalogSettingsInput({
        ...base,
        externalCatalogs: [{ url: 'icr.io/x/cat:1' }, { url: 'icr.io/x/cat' + ':1' }],
      }),
    ).toEqual({ ok: false, error: 'Duplicate catalog URL: icr.io/x/cat:1' });
    expect(
      validateCatalogSettingsInput({
        ...base,
        externalCatalogs: [{ url: 'icr.io/x/cat:1' }, { url: 'icr.io/y/cat:2' }],
      }),
    ).toEqual({ ok: false, error: 'Duplicate catalog name: cat' });
  });

  it('ignores client-sent name and tag and recomputes them from the url', () => {
    const result = validateCatalogSettingsInput({
      ...base,
      externalCatalogs: [{ url: 'icr.io/x/cat:2', name: '../../etc', tag: 'evil' }],
    });
    expect(result.ok && result.settings.externalCatalogs).toEqual([
      { url: 'icr.io/x/cat:2', name: 'cat', tag: '2' },
    ]);
  });
});

describe('settings file persistence', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'catalog-settings-hardening-'));
  });

  afterEach(async () => {
    await fs.promises.rm(dir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('refuses to write invalid settings and leaves the previous file untouched', async () => {
    await writeCatalogSettings(dir, defaultCatalogSettings());
    const before = await fs.promises.readFile(path.join(dir, 'catalog-settings.json'), 'utf8');

    await expect(
      writeCatalogSettings(dir, { enabledOcpVersions: [], externalCatalogs: [] }),
    ).rejects.toThrow(/At least one OCP version/);

    expect(await fs.promises.readFile(path.join(dir, 'catalog-settings.json'), 'utf8')).toBe(before);
  });

  it('writes via a temp file and leaves no temp file behind', async () => {
    await writeCatalogSettings(dir, defaultCatalogSettings());
    expect(await fs.promises.readdir(dir)).toEqual(['catalog-settings.json']);
  });

  it('backs up a corrupt file and reports a warning instead of silently resetting', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const file = path.join(dir, 'catalog-settings.json');
    await fs.promises.writeFile(file, '{ truncated');
    const warnings: string[] = [];

    const settings = await readCatalogSettings(dir, (m) => warnings.push(m));

    expect(settings).toEqual(defaultCatalogSettings());
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('catalog-settings.json.bad');
    expect(await fs.promises.readFile(`${file}.bad`, 'utf8')).toBe('{ truncated');
  });

  it('does not warn when the file simply does not exist yet', async () => {
    const warnings: string[] = [];
    expect(await readCatalogSettings(dir, (m) => warnings.push(m))).toEqual(defaultCatalogSettings());
    expect(warnings).toEqual([]);
  });
});
