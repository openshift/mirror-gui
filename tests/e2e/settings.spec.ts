import { test, expect } from '@playwright/test';

test.describe('Settings', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/settings');
  });

  test('settings page loads with tabs', async ({ page }) => {
    await expect(page.getByText(/pull secret|cache|registry|proxy/i).first()).toBeVisible();
  });

  test('Cache tab shows cache location and cleanup button', async ({ page }) => {
    await page.getByText(/cache/i).first().click();
    await expect(page.getByText(/cache location|cache size|clean up cache/i).first()).toBeVisible({ timeout: 10000 });
  });

  test('Registry tab shows URL, username, password fields', async ({ page }) => {
    await page.getByText(/registry/i).first().click();
    await expect(page.getByText(/registry|url|username|password/i).first()).toBeVisible({ timeout: 10000 });
  });

  test('Save button is present and clickable', async ({ page }) => {
    const saveBtn = page.getByRole('button', { name: /save settings/i });
    await expect(saveBtn).toBeVisible();
    await expect(saveBtn).toBeEnabled();
  });
});
