import { test, expect } from '@playwright/test';

test.describe('Mirror Operations', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/operations');
  });

  test('operations page loads', async ({ page }) => {
    await expect(page.getByText(/mirror operations|operation/i).first()).toBeVisible();
  });

  test('config file selector is present', async ({ page }) => {
    await expect(page.getByLabel('Select ImageSetConfiguration file')).toBeVisible();
  });

  test('operations table or content renders', async ({ page }) => {
    await expect(page.locator('table, [role="grid"], .pf-v6-c-table, main').first()).toBeVisible({ timeout: 10000 });
  });

  test('ImageSetConfiguration File label is present', async ({ page }) => {
    await expect(page.getByText('ImageSetConfiguration File', { exact: true })).toBeVisible({ timeout: 10000 });
  });

  test('Mirror Destination Folder label is present', async ({ page }) => {
    await expect(page.getByText('Mirror Destination Folder')).toBeVisible({ timeout: 10000 });
  });

  test('Advanced Options section is present and expandable', async ({ page }) => {
    const toggle = page.getByRole('button', { name: /Advanced Options/i });
    await expect(toggle).toBeVisible({ timeout: 10000 });
    await toggle.click();
    await expect(page.getByLabel('Enable remove signatures')).toBeVisible();
    await expect(page.getByLabel('Enable image timeout')).toBeVisible();
    await expect(page.getByLabel('Enable retry delay')).toBeVisible();
    await expect(page.getByLabel('Enable retry times')).toBeVisible();

    await page.locator('#flag-image-timeout').click({ force: true });
    await expect(page.locator('#flag-image-timeout-minutes')).toBeVisible();
    await expect(page.locator('#flag-image-timeout-seconds')).toBeVisible();

    await page.locator('#flag-retry-delay').click({ force: true });
    await expect(page.locator('#flag-retry-delay-seconds')).toBeVisible();
    await expect(page.locator('#flag-retry-delay-minutes')).toHaveCount(0);

    await page.getByLabel('More info about retry delay').click();
    await expect(page.getByText(/roughly doubles after each failed attempt/i)).toBeVisible();
  });

  test('Mirror Destination Folder shows default toggle text', async ({ page }) => {
    await expect(page.getByText('default', { exact: true })).toBeVisible({ timeout: 10000 });
  });

  test('Operations section title renders', async ({ page }) => {
    await expect(
      page.locator('#operation-history-card').getByRole('heading', { name: 'Operations', exact: true }),
    ).toBeVisible({ timeout: 10000 });
  });

  test('Start New Operation card title renders', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Start New Operation' })).toBeVisible({ timeout: 10000 });
  });

  test('operations table shows row actions or empty state', async ({ page }) => {
    await expect(page.locator('#operation-history-card')).toBeVisible({ timeout: 10000 });
    const emptyState = page.locator('#operation-history-card').getByText('No operations found.');
    const actionsToggle = page.locator('#operation-history-card button[aria-label^="Actions for "]').first();
    await expect(emptyState.or(actionsToggle)).toBeVisible({ timeout: 10000 });
  });

  test('operations filter dropdown is present', async ({ page }) => {
    const card = page.locator('#operation-history-card');
    await expect(card).toBeVisible({ timeout: 10000 });
    await expect(card.getByLabel('Filter operations')).toBeVisible();
  });

  test('operations filter dropdown shows all status options', async ({ page }) => {
    const card = page.locator('#operation-history-card');
    await expect(card).toBeVisible({ timeout: 10000 });
    await card.getByLabel('Filter operations').click();
    await expect(page.getByRole('option', { name: 'All Operations' })).toBeVisible();
    await expect(page.getByRole('option', { name: 'Running' })).toBeVisible();
    await expect(page.getByRole('option', { name: 'Successful' })).toBeVisible();
    await expect(page.getByRole('option', { name: 'Failed' })).toBeVisible();
    await expect(page.getByRole('option', { name: 'Stopped' })).toBeVisible();
  });

  test('select all checkbox is present when operations exist', async ({ page }) => {
    const card = page.locator('#operation-history-card');
    await expect(card).toBeVisible({ timeout: 10000 });
    const table = card.locator('table');
    const hasTable = await table.isVisible({ timeout: 5000 }).catch(() => false);
    if (hasTable) {
      await expect(table.locator('thead input[type="checkbox"]')).toBeVisible();
    }
  });

  test('Delete All button is present when operations exist', async ({ page }) => {
    const card = page.locator('#operation-history-card');
    await expect(card).toBeVisible({ timeout: 10000 });
    const table = card.locator('table');
    const hasTable = await table.isVisible({ timeout: 5000 }).catch(() => false);
    if (hasTable) {
      await expect(card.getByRole('button', { name: /delete all/i })).toBeVisible();
    }
  });
});
