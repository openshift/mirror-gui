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
    await expect(page.getByText(/operator-index/i).first()).toBeVisible({ timeout: 10000 });
    await page.getByRole('button', { name: /save configuration/i }).click();
    await expect(page.getByText(/configuration has errors/i)).toBeVisible({ timeout: 5000 });
  });

  test('operator channel configuration provides searchable minimum and maximum version selectors', async ({ page }) => {
    await page.getByRole('tab', { name: /operators/i }).click();
    await page.getByRole('button', { name: /add operator catalog/i }).click();
    await page.getByRole('button', { name: /^add operator$/i }).click();

    const operatorSearch = page.getByPlaceholder('Type to search operators...');
    await operatorSearch.fill('advanced-cluster-management');
    await page.getByRole('option', { name: 'advanced-cluster-management' }).click();
    await page.getByText('release-2.16', { exact: true }).click();

    await expect(page.getByText('Min Version', { exact: true })).toBeVisible();
    await expect(page.getByText('Max Version', { exact: true })).toBeVisible();
    await expect(page.getByText('Version Range', { exact: true })).not.toBeVisible();
    await expect(page.getByRole('columnheader', { name: /Min Version.*Max Version/ })).toBeVisible();
    await expect(page.getByPlaceholder('Min version')).toBeVisible();
    await expect(page.getByPlaceholder('Max version')).toBeVisible();
  });

  test('operator catalogs use bold version group labels', async ({ page }) => {
    await page.getByRole('tab', { name: /operators/i }).click();
    await page.getByRole('button', { name: /add operator catalog/i }).click();
    await page.locator('#op-catalog-0 button').click();

    await expect(page.getByText('v4.21', { exact: true }).locator('..')).toHaveClass(/pf-v6-u-font-weight-bold/);
  });

  test('Preview tab has digest references toggle', async ({ page }) => {
    await page.getByRole('tab', { name: /preview/i }).click();
    const toggle = page.locator('#use-digest-ref-toggle');
    await expect(toggle).toBeVisible({ timeout: 10000 });
  });

  test('Load Configuration tab is present and has file upload', async ({ page }) => {
    await page.getByRole('tab', { name: /load configuration/i }).click();
    await expect(page.getByText(/load imagesetconfiguration yaml/i)).toBeVisible({ timeout: 10000 });
  });
});
