import { describe, it, expect } from 'vitest';
import { getChannelObjectsFromGeneratedOperator } from '../../server/catalogChannels.js';

describe('getChannelObjectsFromGeneratedOperator', () => {
  it('returns null for undefined input', () => {
    expect(getChannelObjectsFromGeneratedOperator(undefined)).toBeNull();
  });

  it('returns empty array for operator with no channels', () => {
    expect(getChannelObjectsFromGeneratedOperator({})).toEqual([]);
    expect(getChannelObjectsFromGeneratedOperator({ channels: [] })).toEqual([]);
  });

  it('normalizes string channels to { name } objects', () => {
    const result = getChannelObjectsFromGeneratedOperator({
      channels: ['stable', 'beta'],
    });
    expect(result).toEqual([{ name: 'stable' }, { name: 'beta' }]);
  });

  it('handles mixed string and object channels', () => {
    const result = getChannelObjectsFromGeneratedOperator({
      channels: ['stable', { name: 'release-2.16' }],
    });
    expect(result).toEqual([{ name: 'stable' }, { name: 'release-2.16' }]);
  });

  it('filters out empty or falsy channel names', () => {
    const result = getChannelObjectsFromGeneratedOperator({
      channels: ['valid', '', { name: '' }, { name: 'also-valid' }],
    });
    expect(result).toEqual([{ name: 'valid' }, { name: 'also-valid' }]);
  });

  it('handles object channels with missing name', () => {
    const result = getChannelObjectsFromGeneratedOperator({
      channels: [{ name: 'ok' }, {} as { name: string }],
    });
    expect(result).toEqual([{ name: 'ok' }]);
  });
});
