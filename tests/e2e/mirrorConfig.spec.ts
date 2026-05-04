import { test, expect } from '@playwright/test';

test.describe('Mirror Configuration', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/config');
  });

  test('platform channels section renders', async ({ page }) => {
    await expect(page.getByText('Platform Channels').first()).toBeVisible({ timeout: 15000 });
  });

  test('operators section renders', async ({ page }) => {
    await expect(page.getByText('Operators').first()).toBeVisible({ timeout: 15000 });
  });

  test('additional images section renders', async ({ page }) => {
    await expect(page.getByText('Additional Images').first()).toBeVisible({ timeout: 15000 });
  });

  test('Preview tab is present', async ({ page }) => {
    await expect(page.getByText('Preview').first()).toBeVisible({ timeout: 15000 });
  });

  test('Save and Download buttons are present', async ({ page }) => {
    await expect(page.getByText('Save Configuration').first()).toBeVisible({ timeout: 15000 });
    await expect(page.getByText('Download YAML').first()).toBeVisible({ timeout: 15000 });
  });

  test('saving empty config shows inline validation error', async ({ page }) => {
    await page.getByRole('button', { name: /save configuration/i }).click();
    await expect(page.getByText('At least one platform channel, operator, or additional image is required')).toBeVisible({ timeout: 5000 });
  });

  test('saving config with empty operator shows validation errors', async ({ page }) => {
    await page.getByRole('tab', { name: /operators/i }).click();
    await page.getByRole('button', { name: /add operator catalog/i }).click();
    await page.waitForTimeout(1000);
    await page.getByRole('button', { name: /save configuration/i }).click();
    await expect(page.getByText(/configuration has errors/i)).toBeVisible({ timeout: 5000 });
  });
});
