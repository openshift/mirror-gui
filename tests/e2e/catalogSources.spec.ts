import { test, expect } from '@playwright/test';

const ALL_VERSIONS = ['4.16', '4.17', '4.18', '4.19', '4.20', '4.21', '4.22'];

// The tests share one server-side settings file, so they must not run in parallel.
test.describe.configure({ mode: 'serial' });

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

test.describe('Catalog sources in Settings', () => {
  const DP_URL = 'icr.io/cpopen/datapower-operator-catalog:latest';

  test.afterEach(async ({ request }) => {
    await request.put('/api/catalogs/settings', {
      data: { enabledOcpVersions: ALL_VERSIONS, externalCatalogs: [] },
    });
  });

  test.beforeEach(async ({ page, request }) => {
    await request.put('/api/catalogs/settings', {
      data: { enabledOcpVersions: ALL_VERSIONS, externalCatalogs: [] },
    });
    await page.goto('/settings?tab=sync-catalogs');
  });

  test('unchecking an OCP version persists across reload', async ({ page }) => {
    const box = page.getByRole('checkbox', { name: '4.16' });
    await expect(box).toBeChecked({ timeout: 15000 });
    await box.uncheck();
    await page.getByRole('button', { name: /save versions/i }).click();
    await expect(page.getByText(/catalog settings saved/i)).toBeVisible({ timeout: 10000 });

    await page.reload();
    await expect(page.getByRole('checkbox', { name: '4.16' })).not.toBeChecked({ timeout: 15000 });
    await expect(page.getByRole('checkbox', { name: '4.17' })).toBeChecked();
  });

  test('saving is blocked when no OCP version is checked', async ({ page }) => {
    await expect(page.getByRole('checkbox', { name: '4.16' })).toBeChecked({ timeout: 15000 });
    for (const v of ALL_VERSIONS) {
      await page.getByRole('checkbox', { name: v }).uncheck();
    }
    await expect(page.getByRole('button', { name: /save versions/i })).toBeDisabled();
  });

  test('adds an external catalog, starts a targeted sync, then removes it', async ({ page }) => {
    await page.route('**/api/catalogs/sync', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'Catalog sync started', status: 'running' }),
      });
    });

    await page.getByLabel('Catalog image URL').fill(DP_URL);
    // Register before the click so the request cannot be missed.
    const syncRequest = page.waitForRequest(
      req => req.url().endsWith('/api/catalogs/sync') && req.method() === 'POST',
    );
    await page.getByRole('button', { name: /add catalog/i }).click();

    const row = page.getByRole('row', { name: /datapower-operator-catalog/ });
    await expect(row).toBeVisible({ timeout: 10000 });
    expect((await syncRequest).postDataJSON()).toEqual({ only: DP_URL });

    await row.getByRole('button', { name: /remove/i }).click();
    await page.getByRole('dialog').getByRole('button', { name: /^remove$/i }).click();
    await expect(page.getByRole('row', { name: /datapower-operator-catalog/ })).toHaveCount(0, { timeout: 10000 });
  });

  test('shows the server validation error for an invalid URL', async ({ page }) => {
    await page.getByLabel('Catalog image URL').fill('--registry-config=x');
    await page.getByRole('button', { name: /add catalog/i }).click();
    await expect(page.getByText(/must not start with "-"/)).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole('row', { name: /registry-config/ })).toHaveCount(0);
  });
});
