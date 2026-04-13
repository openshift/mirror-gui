/// <reference types="node" />

import { describe, expect, it } from 'vitest';
import { readFile, access } from 'fs/promises';
import path from 'path';
import process from 'process';

const catalogDataDir = path.join(process.cwd(), 'catalog-data');

const EXPECTED_OCP_VERSIONS = ['4.16', '4.17', '4.18', '4.19', '4.20', '4.21'];
const EXPECTED_CATALOG_TYPES = [
  'redhat-operator-index',
  'certified-operator-index',
  'community-operator-index',
];
const MIN_OPERATORS_PER_CATALOG = 50;

async function readJson(filePath: string): Promise<unknown> {
  const content = await readFile(filePath, 'utf8');
  return JSON.parse(content);
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

describe('committed catalog metadata integrity', () => {
  describe('catalog-index.json', () => {
    it('exists and is valid JSON', async () => {
      const indexPath = path.join(catalogDataDir, 'catalog-index.json');
      expect(await fileExists(indexPath)).toBe(true);
      const index = (await readJson(indexPath)) as {
        ocp_versions: string[];
        catalog_types: string[];
        catalogs: { catalog_type: string; ocp_version: string; operator_count: number }[];
      };
      expect(index).toBeDefined();
      expect(index.ocp_versions).toBeDefined();
      expect(index.catalog_types).toBeDefined();
      expect(index.catalogs).toBeDefined();
    });

    it('lists all expected OCP versions', async () => {
      const index = (await readJson(path.join(catalogDataDir, 'catalog-index.json'))) as {
        ocp_versions: string[];
      };
      for (const version of EXPECTED_OCP_VERSIONS) {
        expect(index.ocp_versions).toContain(version);
      }
    });

    it('lists all expected catalog types', async () => {
      const index = (await readJson(path.join(catalogDataDir, 'catalog-index.json'))) as {
        catalog_types: string[];
      };
      for (const catalogType of EXPECTED_CATALOG_TYPES) {
        expect(index.catalog_types).toContain(catalogType);
      }
    });

    it('has 18 catalog entries (3 types x 6 versions)', async () => {
      const index = (await readJson(path.join(catalogDataDir, 'catalog-index.json'))) as {
        catalogs: unknown[];
      };
      expect(index.catalogs.length).toBe(
        EXPECTED_OCP_VERSIONS.length * EXPECTED_CATALOG_TYPES.length
      );
    });
  });

  describe('top-level dependencies.json', () => {
    it('exists and is valid JSON', async () => {
      const depsPath = path.join(catalogDataDir, 'dependencies.json');
      expect(await fileExists(depsPath)).toBe(true);
      const deps = await readJson(depsPath);
      expect(deps).toBeDefined();
    });
  });

  for (const catalogType of EXPECTED_CATALOG_TYPES) {
    for (const version of EXPECTED_OCP_VERSIONS) {
      const versionTag = `v${version}`;
      const catalogDir = path.join(catalogDataDir, catalogType, versionTag);

      describe(`${catalogType}/${versionTag}`, () => {
        it('operators.json exists and contains operators', async () => {
          const opsPath = path.join(catalogDir, 'operators.json');
          expect(await fileExists(opsPath)).toBe(true);
          const operators = (await readJson(opsPath)) as { name: string }[];
          expect(Array.isArray(operators)).toBe(true);
          expect(operators.length).toBeGreaterThanOrEqual(MIN_OPERATORS_PER_CATALOG);
        });

        it('each operator has required fields', async () => {
          const operators = (await readJson(path.join(catalogDir, 'operators.json'))) as Record<
            string,
            unknown
          >[];
          for (const op of operators) {
            expect(op.name).toBeDefined();
            expect(typeof op.name).toBe('string');
            expect((op.name as string).length).toBeGreaterThan(0);
            expect(op.defaultChannel).toBeDefined();
            expect(op.channels).toBeDefined();
            expect(Array.isArray(op.channels)).toBe(true);
            expect((op.channels as string[]).length).toBeGreaterThan(0);
            expect(op.availableVersions).toBeDefined();
            expect(Array.isArray(op.availableVersions)).toBe(true);
            expect((op.availableVersions as string[]).length).toBeGreaterThan(0);
          }
        });

        it('dependencies.json exists and is valid JSON', async () => {
          const depsPath = path.join(catalogDir, 'dependencies.json');
          expect(await fileExists(depsPath)).toBe(true);
          const deps = await readJson(depsPath);
          expect(deps).toBeDefined();
        });

        it('catalog-info.json exists and has correct metadata', async () => {
          const infoPath = path.join(catalogDir, 'catalog-info.json');
          expect(await fileExists(infoPath)).toBe(true);
          const info = (await readJson(infoPath)) as {
            catalog_type: string;
            ocp_version: string;
          };
          expect(info.catalog_type).toBe(catalogType);
          expect(info.ocp_version).toBe(versionTag);
        });
      });
    }
  }
});
