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
};

async function createAuditFixture(snapshot: SnapshotFixture) {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), 'audit-fetch-catalogs-'));
  const catalogDataDir = path.join(rootDir, 'catalog-data');
  const outputDir = path.join(rootDir, 'audit-reports');
  const snapshotDir = path.join(catalogDataDir, 'redhat-operator-index', 'v4.16');

  await mkdir(snapshotDir, { recursive: true });
  await writeFile(path.join(catalogDataDir, 'dependencies.json'), '{}\n');
  await writeFile(path.join(snapshotDir, 'operators.json'), snapshot.operatorsJson);
  await writeFile(path.join(snapshotDir, 'dependencies.json'), snapshot.dependenciesJson ?? '{}\n');

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

describe('audit-fetch-catalogs', () => {
  it('counts generated operators as audited and reports no issues for valid data', async () => {
    const report = await runAuditFixture({
      operatorsJson: JSON.stringify([
        {
          name: 'example-operator',
          defaultChannel: 'stable',
          channels: ['stable'],
          availableVersions: ['1.0.0', '1.0.1', '1.0.2'],
          minVersion: '1.0.0',
          maxVersion: '1.0.2',
        },
        {
          name: 'another-operator',
          defaultChannel: 'alpha',
          channels: ['alpha'],
          availableVersions: ['2.0.0'],
          minVersion: '2.0.0',
          maxVersion: '2.0.0',
        },
      ]),
    });

    expect(report.summary.catalogSnapshots).toBe(1);
    expect(report.summary.operatorsAudited).toBe(2);
    expect(report.summary.operatorsWithIssues).toBe(0);
    expect(report.summary.totalIssues).toBe(0);
  });

  it('surfaces generated JSON parse errors', async () => {
    const report = await runAuditFixture({
      operatorsJson: '{"name": "broken"',
    });

    const catalog = report.catalogs[0];
    const catalogIssueCategories = catalog.catalogIssues.map((issue: { category: string }) => issue.category);

    expect(catalogIssueCategories).toContain('operators_file_parse_error');
    expect(report.summary.issueCounts.operators_file_parse_error).toBe(1);
    expect(catalog.operators).toEqual([]);
  });
});
