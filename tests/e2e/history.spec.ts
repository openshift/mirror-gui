import { test, expect } from '@playwright/test';

test.describe('History', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/history');
  });

  test('history page loads', async ({ page }) => {
    await expect(page).toHaveURL(/\/history/);
    await expect(page.getByText('Operation History').first()).toBeVisible({ timeout: 15000 });
  });

  test('status column or table is present', async ({ page }) => {
    await expect(page.getByText('Status').first()).toBeVisible({ timeout: 15000 });
  });

  test('export button is present', async ({ page }) => {
    await expect(page.getByText('Export CSV').first()).toBeVisible({ timeout: 15000 });
  });
});
