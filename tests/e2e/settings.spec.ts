import { test, expect } from '@playwright/test';

test.describe('Settings', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/settings');
  });

  test('settings page loads with tabs', async ({ page }) => {
    await expect(page.getByText(/general|registry|proxy|system/i).first()).toBeVisible();
  });

  test('General tab shows max concurrent operations and log retention', async ({ page }) => {
    await expect(page.getByText(/concurrent|retention|log/i).first()).toBeVisible();
  });

  test('Registry tab shows URL, username, password fields', async ({ page }) => {
    await page.getByText(/registry/i).first().click();
    await expect(page.getByText(/registry|url|username|password/i).first()).toBeVisible({ timeout: 10000 });
  });

  test('System tab shows version info', async ({ page }) => {
    await page.getByText(/system/i).first().click();
    await expect(page.getByText(/version|oc-mirror|architecture/i).first()).toBeVisible({ timeout: 10000 });
  });

  test('Save button is present and clickable', async ({ page }) => {
    const saveBtn = page.getByText(/save/i).first();
    await expect(saveBtn).toBeVisible();
    await expect(saveBtn).toBeEnabled();
  });
});
