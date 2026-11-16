import { describe, it, expect } from 'vitest';
import { mergePreservedFields, describePreservedFields } from '../../src/preserveConfig.js';

// A loaded file using fields the form editor does not model.
const uploaded = {
  kind: 'ImageSetConfiguration',
  apiVersion: 'mirror.openshift.io/v2alpha1',
  archiveSize: 8,
  mirror: {
    platform: {
      architectures: ['amd64'],
      channels: [{ name: 'stable-4.21', minVersion: '4.21.0', maxVersion: '4.21.0' }],
      graph: true,
    },
    operators: [
      {
        catalog: 'registry.redhat.io/redhat/redhat-operator-index:v4.21',
        targetCatalog: 'my-org/redhat-operator-index',
        targetTag: 'v4.21-fips-test',
        packages: [
          {
            name: 'compliance-operator',
            defaultChannel: 'stable',
            channels: [{ name: 'stable', minVersion: '1.6.0', maxVersion: '1.7.0' }],
          },
        ],
      },
      {
        catalog: 'registry.redhat.io/redhat/certified-operator-index:v4.21',
        full: true,
        packages: [{ name: 'mongodb-enterprise' }],
      },
    ],
    additionalImages: [{ name: 'registry.redhat.io/ubi9/ubi-minimal:latest' }],
    blockedImages: [{ name: 'registry.redhat.io/ubi9/ubi-minimal:9.4' }],
    helm: {
      repositories: [
        {
          name: 'redhat-helm-charts',
          url: 'https://charts.openshift.io',
          charts: [{ name: 'redhat-developer-hub', version: '1.4.0' }],
        },
      ],
    },
  },
};

// What the form generated for the same file before this fix (fields above were dropped).
const formGenerated = {
  kind: 'ImageSetConfiguration',
  apiVersion: 'mirror.openshift.io/v2alpha1',
  archiveSize: 8,
  mirror: {
    platform: {
      channels: [{ name: 'stable-4.21', type: 'ocp', minVersion: '4.21.0', maxVersion: '4.21.0' }],
      graph: true,
    },
    operators: [
      {
        catalog: 'registry.redhat.io/redhat/redhat-operator-index:v4.21',
        packages: [{ name: 'compliance-operator', channels: [{ name: 'stable', minVersion: '1.6.0' }] }],
      },
      {
        catalog: 'registry.redhat.io/redhat/certified-operator-index:v4.21',
        packages: [{ name: 'mongodb-enterprise', channels: [] }],
      },
    ],
    additionalImages: [{ name: 'registry.redhat.io/ubi9/ubi-minimal:latest' }],
  },
};

describe('mergePreservedFields', () => {
  it('returns the form config unchanged when nothing was loaded', () => {
    expect(mergePreservedFields(formGenerated, null)).toEqual(formGenerated);
  });

  it('keeps every field the form does not model (round trip of a loaded file)', () => {
    const merged = mergePreservedFields(formGenerated, uploaded);
    const expected = structuredClone(uploaded) as typeof uploaded & { mirror: { platform: { channels: Record<string, unknown>[] } } };
    expected.mirror.platform.channels[0].type = 'ocp';
    expect(merged).toEqual(expected);
  });

  it('lets form values win for fields the form owns', () => {
    const edited = structuredClone(formGenerated);
    edited.mirror.operators[0].packages[0].channels[0].minVersion = '1.6.1';
    edited.archiveSize = 4;
    const merged = mergePreservedFields(edited, uploaded) as typeof uploaded;
    expect(merged.archiveSize).toBe(4);
    expect(merged.mirror.operators[0].packages[0].channels[0]).toEqual({
      name: 'stable',
      minVersion: '1.6.1',
      maxVersion: '1.7.0',
    });
  });

  it('does not bring back items removed in the form', () => {
    const edited = structuredClone(formGenerated);
    edited.mirror.operators = edited.mirror.operators.slice(0, 1);
    edited.mirror.additionalImages = [];
    const merged = mergePreservedFields(edited, uploaded) as typeof uploaded;
    expect(merged.mirror.operators).toHaveLength(1);
    expect(merged.mirror.additionalImages).toEqual([]);
    // Sections the form does not model are still kept.
    expect(merged.mirror.blockedImages).toEqual(uploaded.mirror.blockedImages);
    expect(merged.mirror.helm).toEqual(uploaded.mirror.helm);
  });

  it('drops a preserved defaultChannel that is no longer one of the selected channels', () => {
    const edited = structuredClone(formGenerated);
    edited.mirror.operators[0].packages[0].channels = [{ name: 'release-0.1', minVersion: '' }];
    const merged = mergePreservedFields(edited, uploaded) as typeof uploaded;
    expect(merged.mirror.operators[0].packages[0].defaultChannel).toBeUndefined();
  });

  it('keeps platform-only extras when the form has no platform channels', () => {
    const edited: { mirror: Partial<typeof formGenerated.mirror> } & Omit<typeof formGenerated, 'mirror'> =
      structuredClone(formGenerated);
    delete edited.mirror.platform;
    const merged = mergePreservedFields(edited, uploaded) as typeof uploaded;
    expect(merged.mirror.platform).toEqual({ architectures: ['amd64'] });
  });
});

describe('describePreservedFields', () => {
  it('lists the fields that will be kept', () => {
    expect(describePreservedFields(uploaded)).toEqual(
      expect.arrayContaining([
        'mirror.blockedImages',
        'mirror.helm',
        'mirror.platform.architectures',
        'registry.redhat.io/redhat/redhat-operator-index:v4.21.targetCatalog',
        'registry.redhat.io/redhat/redhat-operator-index:v4.21.targetTag',
        'compliance-operator channel stable.maxVersion',
        'registry.redhat.io/redhat/certified-operator-index:v4.21.full',
      ]),
    );
  });

  it('returns an empty list when nothing was loaded', () => {
    expect(describePreservedFields(null)).toEqual([]);
  });
});
