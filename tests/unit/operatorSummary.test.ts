import { describe, it, expect } from 'vitest';
import { summarizeOperators, validateOperators } from '../../src/operatorSummary.js';

describe('summarizeOperators', () => {
  it('counts packages as operators, not catalogs or channels', () => {
    const result = summarizeOperators([
      {
        catalog: 'registry.redhat.io/redhat/redhat-operator-index:v4.20',
        packages: [
          { name: 'a', channels: [{ name: 'x' }, { name: 'y' }] },
          { name: 'b', channels: [{ name: 'z' }] },
          { name: 'c' },
        ],
      },
    ]);
    expect(result.operators).toBe(3);
    expect(result.channels).toBe(3);
    expect(result.catalogs).toHaveLength(1);
    expect(result.catalogs[0]).toMatchObject({
      label: 'redhat-operator-index:v4.20',
      operators: 3,
      channels: 3,
      isFullCatalog: false,
    });
  });

  it('sums across multiple catalogs', () => {
    const result = summarizeOperators([
      { catalog: 'r/one:v1', packages: [{ name: 'a', channels: [{ name: 'x' }] }] },
      { catalog: 'r/two:v1', packages: [{ name: 'b', channels: [{ name: 'x' }, { name: 'y' }] }] },
    ]);
    expect(result.operators).toBe(2);
    expect(result.channels).toBe(3);
    expect(result.catalogs.map(c => c.label)).toEqual(['one:v1', 'two:v1']);
  });

  it('flags a catalog without packages as full and counts 0 operators', () => {
    const result = summarizeOperators([{ catalog: 'r/full:v1', full: true }]);
    expect(result.operators).toBe(0);
    expect(result.catalogs[0].isFullCatalog).toBe(true);
  });

  it('returns zeros for non-array input', () => {
    expect(summarizeOperators(undefined)).toEqual({ operators: 0, channels: 0, catalogs: [] });
  });

  it('does not throw on a non-string catalog value from YAML', () => {
    const result = summarizeOperators([{ catalog: 0, packages: [{ name: 'a', channels: [{ name: 'x' }] }] }]);
    expect(result.catalogs[0]).toMatchObject({ catalog: '', label: '', operators: 1, channels: 1 });
  });
});

describe('validateOperators', () => {
  const catalog = 'registry.redhat.io/redhat/redhat-operator-index:v4.20';

  it('accepts absent operators and catalogs without packages (full catalog)', () => {
    expect(validateOperators(undefined)).toBeNull();
    expect(validateOperators(null)).toBeNull();
    expect(validateOperators([{ catalog, full: true }])).toBeNull();
  });

  it('accepts well-formed catalogs and packages', () => {
    expect(validateOperators([{ catalog, packages: [{ name: 'a', channels: [{ name: 'stable' }] }] }])).toBeNull();
  });

  it('rejects a non-list operators section', () => {
    expect(validateOperators({ catalog })).toMatch(/must be a list/);
  });

  it('rejects non-string or empty catalog values', () => {
    expect(validateOperators([{ catalog: 0 }])).toMatch(/operators\[0\]\.catalog/);
    expect(validateOperators([{ catalog: '' }])).toMatch(/operators\[0\]\.catalog/);
  });

  it('rejects a non-object catalog entry', () => {
    expect(validateOperators(['nope'])).toMatch(/must be a mapping/);
  });

  it('rejects non-list packages so invalid input is not shown as a full catalog', () => {
    expect(validateOperators([{ catalog, packages: 'a' }])).toMatch(/packages must be a list/);
  });

  it('rejects package entries without a string name so they are not counted as operators', () => {
    expect(validateOperators([{ catalog, packages: [{ name: 'ok' }, 'bad'] }])).toMatch(/packages\[1\]/);
    expect(validateOperators([{ catalog, packages: [{ channels: [] }] }])).toMatch(/packages\[0\]/);
  });
});
