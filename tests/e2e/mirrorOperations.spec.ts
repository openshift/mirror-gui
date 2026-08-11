import { test, expect, Page, Route } from '@playwright/test';

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

/** Verifies operations table rows are filtered correctly when selecting each status option. */
test.describe('Operations - Status Filtering', () => {
  const mockOps = [
    {
      id: 'op-success-1',
      name: 'mirror-success-1',
      configFile: 'success-config-a.yaml',
      status: 'success',
      startedAt: new Date(Date.now() - 7200000).toISOString(),
      completedAt: new Date(Date.now() - 6600000).toISOString(),
      duration: 600,
    },
    {
      id: 'op-success-2',
      name: 'mirror-success-2',
      configFile: 'success-config-b.yaml',
      status: 'success',
      startedAt: new Date(Date.now() - 5400000).toISOString(),
      completedAt: new Date(Date.now() - 4800000).toISOString(),
      duration: 600,
    },
    {
      id: 'op-failed-1',
      name: 'mirror-failed-1',
      configFile: 'failed-config.yaml',
      status: 'failed',
      startedAt: new Date(Date.now() - 3600000).toISOString(),
      completedAt: new Date(Date.now() - 3200000).toISOString(),
      duration: 400,
      errorMessage: 'mirror failed: timeout',
    },
    {
      id: 'op-stopped-1',
      name: 'mirror-stopped-1',
      configFile: 'stopped-config.yaml',
      status: 'stopped',
      startedAt: new Date(Date.now() - 1800000).toISOString(),
      completedAt: new Date(Date.now() - 1500000).toISOString(),
      duration: 300,
    },
  ];

  /**
   * Intercepts GET /api/operations so every test gets a deterministic set of
   * operations spanning success, failed, and stopped statuses.
   */
  function mockOperationsApi(page: Page) {
    return page.route('**/api/operations', (route: Route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(mockOps),
      });
    });
  }

  test.beforeEach(async ({ page }) => {
    await mockOperationsApi(page);
    await page.goto('/operations');
    const card = page.locator('#operation-history-card');
    await expect(card.locator('table')).toBeVisible({ timeout: 10000 });
  });

  /** Asserts the default filter state renders every mocked operation row. */
  test('shows all operations when "All Operations" filter is active', async ({ page }) => {
    const rows = page.locator('#operation-history-card table tbody tr');
    await expect(rows).toHaveCount(mockOps.length);
  });

  test('filters to show only successful operations', async ({ page }) => {
    const card = page.locator('#operation-history-card');
    await card.getByLabel('Filter operations').click();
    await page.getByRole('option', { name: 'Successful' }).click();

    const rows = card.locator('table tbody tr');
    await expect(rows).toHaveCount(2);
    await expect(rows.filter({ hasText: 'success-config-a.yaml' })).toBeVisible();
    await expect(rows.filter({ hasText: 'success-config-b.yaml' })).toBeVisible();
  });

  test('filters to show only failed operations', async ({ page }) => {
    const card = page.locator('#operation-history-card');
    await card.getByLabel('Filter operations').click();
    await page.getByRole('option', { name: 'Failed' }).click();

    const rows = card.locator('table tbody tr');
    await expect(rows).toHaveCount(1);
    await expect(rows.filter({ hasText: 'failed-config.yaml' })).toBeVisible();
  });

  test('filters to show only stopped operations', async ({ page }) => {
    const card = page.locator('#operation-history-card');
    await card.getByLabel('Filter operations').click();
    await page.getByRole('option', { name: 'Stopped' }).click();

    const rows = card.locator('table tbody tr');
    await expect(rows).toHaveCount(1);
    await expect(rows.filter({ hasText: 'stopped-config.yaml' })).toBeVisible();
  });

  /** Selects "Running" (no running ops in mock data) and asserts the table is replaced by the empty state. */
  test('shows empty state when no operations match the filter', async ({ page }) => {
    const card = page.locator('#operation-history-card');
    await card.getByLabel('Filter operations').click();
    await page.getByRole('option', { name: 'Running' }).click();

    await expect(card.locator('table')).not.toBeVisible();
    await expect(card.getByText('No operations found.')).toBeVisible();
  });

  /** Applies the "Failed" filter, then resets to "All Operations" and asserts all rows reappear. */
  test('restores all rows after resetting filter to "All Operations"', async ({ page }) => {
    const card = page.locator('#operation-history-card');
    const filterToggle = card.getByLabel('Filter operations');

    await filterToggle.click();
    await page.getByRole('option', { name: 'Failed' }).click();
    await expect(card.locator('table tbody tr')).toHaveCount(1);

    await filterToggle.click();
    await page.getByRole('option', { name: 'All Operations' }).click();
    await expect(card.locator('table tbody tr')).toHaveCount(mockOps.length);
  });

  /** Verifies the dropdown toggle button text updates after each filter selection. */
  test('filter toggle shows the selected status label', async ({ page }) => {
    const card = page.locator('#operation-history-card');
    const filterToggle = card.getByLabel('Filter operations');

    await expect(filterToggle).toHaveText('All Operations');

    await filterToggle.click();
    await page.getByRole('option', { name: 'Successful' }).click();
    await expect(filterToggle).toHaveText('Successful');

    await filterToggle.click();
    await page.getByRole('option', { name: 'Failed' }).click();
    await expect(filterToggle).toHaveText('Failed');
  });

  /** Chains Successful → Stopped → Failed without resetting to "All Operations" in between. */
  test('switching between status filters updates the table', async ({ page }) => {
    const card = page.locator('#operation-history-card');
    const filterToggle = card.getByLabel('Filter operations');
    const rows = card.locator('table tbody tr');

    await filterToggle.click();
    await page.getByRole('option', { name: 'Successful' }).click();
    await expect(rows).toHaveCount(2);

    await filterToggle.click();
    await page.getByRole('option', { name: 'Stopped' }).click();
    await expect(rows).toHaveCount(1);
    await expect(rows.filter({ hasText: 'stopped-config.yaml' })).toBeVisible();

    await filterToggle.click();
    await page.getByRole('option', { name: 'Failed' }).click();
    await expect(rows).toHaveCount(1);
    await expect(rows.filter({ hasText: 'failed-config.yaml' })).toBeVisible();
  });

  /** Asserts the PatternFly Label text in each visible row matches the active filter. */
  test('filtered rows display the correct status label', async ({ page }) => {
    const card = page.locator('#operation-history-card');
    const rows = card.locator('table tbody tr');
    const statusLabel = (row: import('@playwright/test').Locator) =>
      row.locator('.pf-v6-c-label__text');

    await card.getByLabel('Filter operations').click();
    await page.getByRole('option', { name: 'Successful' }).click();
    for (const row of await rows.all()) {
      await expect(statusLabel(row)).toHaveText('Success');
    }

    await card.getByLabel('Filter operations').click();
    await page.getByRole('option', { name: 'Failed' }).click();
    await expect(statusLabel(rows.first())).toHaveText('Failed');

    await card.getByLabel('Filter operations').click();
    await page.getByRole('option', { name: 'Stopped' }).click();
    await expect(statusLabel(rows.first())).toHaveText('Stopped');
  });
});
