/// <reference types="node" />

import { describe, expect, it } from 'vitest';
import { execFile } from 'child_process';
import { mkdtemp, mkdir, readFile, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';
import process from 'process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);
const scriptPath = path.join(process.cwd(), 'scripts', 'audit-fetch-catalogs.mjs');

type SnapshotFixture = {
  operatorsJson: string;
  dependenciesJson?: string;
  rawDocs?: unknown[];
};

async function createAuditFixture(snapshot: SnapshotFixture) {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), 'audit-fetch-catalogs-'));
  const catalogDataDir = path.join(rootDir, 'catalog-data');
  const outputDir = path.join(rootDir, 'audit-reports');
  const snapshotDir = path.join(catalogDataDir, 'redhat-operator-index', 'v4.16');
  const operatorDir = path.join(snapshotDir, 'configs', 'example-operator');

  await mkdir(operatorDir, { recursive: true });
  await writeFile(path.join(catalogDataDir, 'dependencies.json'), '{}\n');
  await writeFile(path.join(snapshotDir, 'operators.json'), snapshot.operatorsJson);
  await writeFile(path.join(snapshotDir, 'dependencies.json'), snapshot.dependenciesJson ?? '{}\n');

  if (snapshot.rawDocs) {
    await writeFile(path.join(operatorDir, 'catalog.json'), JSON.stringify(snapshot.rawDocs, null, 2));
  }

  return { catalogDataDir, outputDir };
}

async function runAuditFixture(snapshot: SnapshotFixture) {
  const { catalogDataDir, outputDir } = await createAuditFixture(snapshot);

  await execFileAsync(process.execPath, [
    scriptPath,
    '--catalog-data-dir',
    catalogDataDir,
    '--output-dir',
    outputDir,
  ]);

  const reportPath = path.join(outputDir, 'fetch-catalogs-audit.json');
  return JSON.parse(await readFile(reportPath, 'utf8'));
}

function buildRawOperatorDocs(versions: string[]) {
  return [
    {
      schema: 'olm.package',
      name: 'example-operator',
      defaultChannel: 'stable',
    },
    {
      schema: 'olm.channel',
      name: 'stable',
      package: 'example-operator',
      entries: versions.map((version) => ({
        name: `example-operator.v${version}`,
      })),
    },
    ...versions.map((version) => ({
      schema: 'olm.bundle',
      name: `example-operator.v${version}`,
      package: 'example-operator',
      properties: [
        {
          type: 'olm.package',
          value: {
            packageName: 'example-operator',
            version,
          },
        },
      ],
    })),
  ];
}

describe('audit-fetch-catalogs', () => {
  it('flags exact version metadata mismatches even when min/max still match', async () => {
    const report = await runAuditFixture({
      operatorsJson: JSON.stringify([
        {
          name: 'example-operator',
          defaultChannel: 'stable',
          channels: ['stable'],
          availableVersions: ['1.0.0', '1.0.1', '1.0.2'],
          minVersion: '1.0.0',
          maxVersion: '1.0.2',
          channelVersions: {
            stable: ['1.0.0', '1.0.1', '1.0.2'],
          },
          channelVersionRanges: {
            stable: {
              minVersion: '1.0.0',
              maxVersion: '1.0.2',
            },
          },
        },
      ]),
      rawDocs: buildRawOperatorDocs(['1.0.0', '1.0.2']),
    });

    const finding = report.catalogs[0].operators[0];
    const issueCategories = finding.issues.map((issue: { category: string }) => issue.category);

    expect(issueCategories).toContain('available_versions_mismatch');
    expect(issueCategories).toContain('channel_versions_mismatch');
    expect(report.summary.issueCounts.available_versions_mismatch).toBe(1);
  });

  it('surfaces generated JSON parse errors without raw-vs-generated mismatch noise', async () => {
    const report = await runAuditFixture({
      operatorsJson: '{"name": "broken"',
      rawDocs: buildRawOperatorDocs(['1.0.0']),
    });

    const catalog = report.catalogs[0];
    const catalogIssueCategories = catalog.catalogIssues.map((issue: { category: string }) => issue.category);

    expect(catalogIssueCategories).toContain('operators_file_parse_error');
    expect(report.summary.issueCounts.operators_file_parse_error).toBe(1);
    expect(report.summary.issueCounts.raw_operator_missing_from_generated ?? 0).toBe(0);
    expect(catalog.operators).toEqual([]);
  });
});
