import fs from 'fs';
import path from 'path';

const projectRoot = path.resolve(import.meta.dirname, '../..');
const defaultCatalogDataDest = path.join(projectRoot, 'catalog-data');
const catalogDataFixture = path.join(projectRoot, 'tests/fixtures/catalog-data');

export async function ensureCatalogFixture(catalogDataDest: string = defaultCatalogDataDest): Promise<void> {
  try {
    await fs.promises.access(path.join(catalogDataDest, 'catalog-index.json'));
  } catch {
    await fs.promises.rm(catalogDataDest, { recursive: true, force: true });
    await fs.promises.mkdir(catalogDataDest, { recursive: true });
    const entries = await fs.promises.readdir(catalogDataFixture, { withFileTypes: true });
    for (const entry of entries) {
      const src = path.join(catalogDataFixture, entry.name);
      const dest = path.join(catalogDataDest, entry.name);
      await fs.promises.cp(src, dest, { recursive: true, force: true });
    }
  }
}
