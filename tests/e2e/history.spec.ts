import { test, expect } from '@playwright/test';
import { MINIMAL_ISC_YAML } from '../helpers/minimalConfig.js';
import { seedOperation } from '../helpers/seedOperation.js';
import { UI_REQUEST_HEADERS } from '../uiRequestHeader.js';
import {
  assertRowCheckboxToggles,
  assertMultiRowSelect,
  assertSelectAllToggles,
  assertDeleteSelectedButtonVisibility,
  assertCancelModalKeepsRows,
  assertDeleteSelectedRemovesOnlyChecked,
  assertSelectAllDeleteRemovesAll,
} from '../helpers/selectionTestUtils.js';

test.describe('History', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/history');
  });

  test('history page loads', async ({ page }) => {
    await expect(page).toHaveURL(/\/history/);
    await expect(page.getByText('Operation History').first()).toBeVisible({ timeout: 15000 });
  });

  test('filter dropdown is present', async ({ page }) => {
    await expect(page.getByLabel('Filter operations')).toBeVisible({ timeout: 15000 });
  });

  test('export button is present', async ({ page }) => {
    await expect(page.getByText('Export CSV').first()).toBeVisible({ timeout: 15000 });
  });

  test('filter dropdown shows all status options', async ({ page }) => {
    const toggle = page.getByLabel('Filter operations');
    await expect(toggle).toBeVisible({ timeout: 15000 });
    await toggle.click();
    await expect(page.getByRole('option', { name: 'All Operations' })).toBeVisible();
    await expect(page.getByRole('option', { name: 'Successful' })).toBeVisible();
    await expect(page.getByRole('option', { name: 'Failed' })).toBeVisible();
    await expect(page.getByRole('option', { name: 'Stopped' })).toBeVisible();
  });

  test('select all checkbox is present when operations exist', async ({ page }) => {
    const table = page.locator('table');
    const emptyState = page.getByText('No operations found.');
    const hasTable = await table.isVisible({ timeout: 5000 }).catch(() => false);
    if (hasTable) {
      await expect(table.locator('thead input[type="checkbox"]')).toBeVisible();
    } else {
      await expect(emptyState).toBeVisible();
    }
  });

  test('Delete All button is present when operations exist', async ({ page }) => {
    const table = page.locator('table');
    const hasTable = await table.isVisible({ timeout: 5000 }).catch(() => false);
    if (hasTable) {
      await expect(page.getByRole('button', { name: /delete all/i })).toBeVisible();
    }
  });
});

// Row checkbox selection and "Delete Selected" on the History page.
test.describe('History - Row Selection & Bulk Delete Selected', () => {
  test.describe.configure({ mode: 'serial' });

  const createdConfigs: string[] = [];
  const createdOperations: string[] = [];

  test.afterAll(async ({ request }) => {
    for (const opId of createdOperations) {
      await request.post(`/api/operations/${opId}/stop`, { headers: UI_REQUEST_HEADERS }).catch(() => {});
      await request.delete(`/api/operations/${opId}`).catch(() => {});
    }
    for (const name of createdConfigs) {
      await request.delete(`/api/config/delete/${name}`).catch(() => {});
    }
  });

  test.beforeAll(async ({ request }) => {
    createdConfigs.length = 0;
    createdOperations.length = 0;

    for (let i = 1; i <= 3; i++) {
      const configName = `e2e-histsel-${Date.now()}-${i}.yaml`;
      createdConfigs.push(configName);

      const saveRes = await request.post('/api/config/save', {
        data: { config: MINIMAL_ISC_YAML, name: configName },
      });
      expect(saveRes.ok(), `Config save failed: ${await saveRes.text()}`).toBeTruthy();

      await seedOperation(request, configName, createdOperations);
    }
  });

  test('row checkbox toggles on click', async ({ page }) => {
    await page.goto('/history');
    const table = page.locator('table');
    await expect(table).toBeVisible({ timeout: 15000 });
    await assertRowCheckboxToggles(table, createdConfigs[0]);
  });

  test('checking multiple rows selects only those rows', async ({ page }) => {
    await page.goto('/history');
    const table = page.locator('table');
    await expect(table).toBeVisible({ timeout: 15000 });
    await assertMultiRowSelect(table, [createdConfigs[0], createdConfigs[2]], createdConfigs[1]);
  });

  test('select-all checkbox checks and unchecks every row', async ({ page }) => {
    await page.goto('/history');
    const table = page.locator('table');
    await expect(table).toBeVisible({ timeout: 15000 });
    await assertSelectAllToggles(table, createdConfigs);
  });

  test('"Delete Selected" button appears with correct count and hides after uncheck', async ({ page }) => {
    await page.goto('/history');
    const table = page.locator('table');
    await expect(table).toBeVisible({ timeout: 15000 });
    await assertDeleteSelectedButtonVisibility(table, page, [createdConfigs[0], createdConfigs[1]]);
  });

  test('cancelling the bulk-delete modal keeps all rows intact', async ({ page }) => {
    await page.goto('/history');
    const table = page.locator('table');
    await expect(table).toBeVisible({ timeout: 15000 });
    await assertCancelModalKeepsRows(page, table, page, createdConfigs, 'Confirm deletion');
  });

  test('confirming "Delete Selected" removes only the checked row', async ({ page }) => {
    await page.goto('/history');
    const table = page.locator('table');
    await expect(table).toBeVisible({ timeout: 15000 });
    await assertDeleteSelectedRemovesOnlyChecked(page, table, page, createdConfigs[0], createdConfigs.slice(1), 'Confirm deletion');
  });

  test('select-all then "Delete Selected" removes all remaining rows', async ({ page }) => {
    await page.goto('/history');
    const table = page.locator('table');
    await expect(table).toBeVisible({ timeout: 15000 });
    await assertSelectAllDeleteRemovesAll(page, table, page, createdConfigs.slice(1), 'Confirm deletion', page);
  });
});
