/// <reference types="node" />

import { describe, expect, it } from 'vitest';
import { execFile, execFileSync } from 'child_process';
import { mkdtemp, readFile } from 'fs/promises';
import os from 'os';
import path from 'path';
import process from 'process';
import { promisify } from 'util';
import { writeMinimalFbc } from '../helpers/minimalFbc.js';

const execFileAsync = promisify(execFile);
const scriptPath = path.join(process.cwd(), 'scripts', 'catalog_metadata.py');

function assertPyYamlAvailable() {
  try {
    execFileSync('python3', ['-c', 'import yaml']);
  } catch {
    throw new Error(
      'PyYAML is required for python3. Run: uv run --no-project --with pyyaml npx vitest run tests/scripts/catalogMetadata.test.ts',
    );
  }
}

async function generate(extraArgs: string[], catalogType: string, ocpVersion: string) {
  assertPyYamlAvailable();
  const dir = await mkdtemp(path.join(os.tmpdir(), 'catalog-metadata-'));
  await writeMinimalFbc(path.join(dir, 'configs'));
  const operatorsFile = path.join(dir, 'operators.json');
  await execFileAsync('python3', [
    scriptPath,
    'generate',
    '--catalog-dir', dir,
    '--catalog-type', catalogType,
    '--ocp-version', ocpVersion,
    '--operators-file', operatorsFile,
    '--dependencies-file', path.join(dir, 'dependencies.json'),
    ...extraArgs,
  ]);
  return JSON.parse(await readFile(operatorsFile, 'utf8')) as Array<Record<string, unknown>>;
}

describe('catalog_metadata.py generate', () => {
  it('uses --catalog-url verbatim and keeps the tag as ocpVersion', async () => {
    const operators = await generate(
      ['--catalog-url', 'icr.io/cpopen/datapower-operator-catalog:latest'],
      'datapower-operator-catalog',
      'latest',
    );
    expect(operators).toHaveLength(1);
    expect(operators[0].name).toBe('datapower-operator');
    expect(operators[0].catalogUrl).toBe('icr.io/cpopen/datapower-operator-catalog:latest');
    expect(operators[0].ocpVersion).toBe('latest');
  });

  it('keeps the Red Hat URL format when --catalog-url is absent', async () => {
    const operators = await generate([], 'redhat-operator-index', 'v4.21');
    expect(operators[0].catalogUrl).toBe('registry.redhat.io/redhat/redhat-operator-index:v4.21');
  });
});
