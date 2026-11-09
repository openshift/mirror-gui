import { test, expect } from '@playwright/test';

const ALL_VERSIONS = ['4.16', '4.17', '4.18', '4.19', '4.20', '4.21', '4.22'];

test.describe('Catalog sources in the config builder', () => {
  test.afterEach(async ({ request }) => {
    await request.put('/api/catalogs/settings', {
      data: { enabledOcpVersions: ALL_VERSIONS, externalCatalogs: [] },
    });
  });

  test('platform channel dropdown only offers enabled OCP versions', async ({ page, request }) => {
    const res = await request.put('/api/catalogs/settings', {
      data: { enabledOcpVersions: ['4.21'], externalCatalogs: [] },
    });
    expect(res.ok()).toBeTruthy();

    await page.goto('/config');
    await page.getByRole('button', { name: /add platform channel/i }).click();
    await page.getByRole('button', { name: /^stable-4\.\d+$/ }).click();

    await expect(page.getByRole('option', { name: 'stable-4.21' })).toBeVisible({ timeout: 15000 });
    await expect(page.getByRole('option', { name: 'stable-4.16' })).toHaveCount(0);
  });
});
