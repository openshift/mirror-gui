import { describe, it, expect } from 'vitest';
import { summarizeOperators } from '../../src/operatorSummary.js';

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
});
