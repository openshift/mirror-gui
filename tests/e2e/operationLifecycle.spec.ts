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

// E2E tests for the mirror operation lifecycle: start, logs, stop, filter, delete.
// Each test uses a timestamped config name. Cleanup is handled by afterAll.
// Operations are stopped via API right after starting to avoid long oc-mirror runs.
// Serial mode runs tests one at a time and skips the rest if one fails (retried
// together as a group), which is why afterAll cleanup is essential for resources
// created by tests that ran before a failure.
test.describe('Operation Lifecycle', () => {
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

  test('start button is disabled when no config is selected', async ({ page }) => {
    await page.goto('/operations');
    await expect(page.getByRole('heading', { name: 'Start New Operation' })).toBeVisible({ timeout: 15000 });
    await expect(page.getByRole('button', { name: 'Start Operation' })).toBeDisabled();
  });

  test('full lifecycle: start, view logs, stop, filter, delete', async ({ page, request }) => {
    const configName = `e2e-lifecycle-full-${Date.now()}.yaml`;
    createdConfigs.push(configName);

    const saveRes = await request.post('/api/config/save', { data: { config: MINIMAL_ISC_YAML, name: configName } });
    expect(saveRes.ok(), `Config save failed: ${await saveRes.text()}`).toBeTruthy();

    await page.goto('/operations');
    await expect(page.getByRole('heading', { name: 'Start New Operation' })).toBeVisible({ timeout: 15000 });

    // Select config and start operation
    const configToggle = page.getByLabel('Select ImageSetConfiguration file');
    await configToggle.click();
    await page.getByRole('option', { name: new RegExp(configName) }).click();
    await expect(configToggle).toContainText(configName);

    await page.getByRole('button', { name: 'Start Operation' }).click();

    // Track the operation ID immediately so afterAll can clean it up if later assertions fail.
    await expect(async () => {
      const opsRes = await request.get('/api/operations');
      expect(opsRes.ok()).toBeTruthy();
      const ops = await opsRes.json();
      const op = ops.find(
        (o: { configFile: string }) => o.configFile === configName,
      );
      expect(op).toBeTruthy();
      if (op && !createdOperations.includes(op.id)) {
        createdOperations.push(op.id);
      }
    }).toPass({ timeout: 10000 });

    // Verify operation appears in table
    const historyCard = page.locator('#operation-history-card');
    const operationTable = historyCard.locator('table');
    await expect(operationTable).toBeVisible({ timeout: 15000 });

    const operationRow = operationTable.locator('tbody tr').filter({ hasText: configName }).first();
    await expect(operationRow).toBeVisible({ timeout: 15000 });

    const statusCell = operationRow.locator('td').nth(3);
    await expect(statusCell.getByText(/Running|Success|Failed|Stopped/)).toBeVisible({ timeout: 10000 });

    // Stop via API so oc-mirror doesn't run indefinitely.
    // Wrapped in toPass() because tsx watch may briefly restart the server
    // when operation data files are written to disk.
    await expect(async () => {
      const opsRes = await request.get('/api/operations');
      const ops = await opsRes.json();
      const op = ops.find(
        (o: { configFile: string }) => o.configFile === configName,
      );
      if (op?.status === 'running') {
        await request.post(`/api/operations/${op.id}/stop`, { headers: UI_REQUEST_HEADERS });
      }
    }).toPass({ timeout: 10000 });

    await expect(statusCell.getByText(/Success|Failed|Stopped/)).toBeVisible({ timeout: 30000 });

    // View logs via kebab menu
    const kebabButton = operationRow.locator('button[aria-label^="Actions for "]');
    await kebabButton.click();
    await page.getByRole('menuitem', { name: 'View Logs' }).click();

    const logsCard = page.locator('#operation-logs-card');
    await expect(logsCard).toBeVisible({ timeout: 10000 });
    await expect(logsCard.getByText('Operation Logs')).toBeVisible();

    // Filter: matching status keeps row visible
    const statusText = await statusCell.innerText();
    let filterOption: string;
    if (statusText.includes('Success')) {
      filterOption = 'Successful';
    } else if (statusText.includes('Failed')) {
      filterOption = 'Failed';
    } else {
      filterOption = 'Stopped';
    }

    const filterDropdown = historyCard.getByLabel('Filter operations');
    await filterDropdown.click();
    await page.getByRole('option', { name: filterOption }).click();
    await expect(operationRow).toBeVisible({ timeout: 5000 });

    // Filter: non-matching status hides row
    const nonMatchingFilter = filterOption === 'Stopped' ? 'Successful' : 'Stopped';
    await filterDropdown.click();
    await page.getByRole('option', { name: nonMatchingFilter }).click();
    await expect(operationRow).not.toBeVisible({ timeout: 5000 });

    // Reset filter
    await filterDropdown.click();
    await page.getByRole('option', { name: 'All Operations' }).click();
    await expect(operationRow).toBeVisible({ timeout: 5000 });

    // Delete via kebab menu
    await kebabButton.click();
    await page.getByRole('menuitem', { name: 'Delete' }).click();

    const deleteModal = page.locator('[aria-label="Delete confirmation"]');
    await expect(deleteModal).toBeVisible({ timeout: 5000 });
    await deleteModal.getByRole('button', { name: 'Delete' }).click();

    await expect(operationRow).not.toBeVisible({ timeout: 10000 });
  });

  // Seed an operation via API, stop it, then check it shows up on /history.
  test('operation appears on history page after completion', async ({ page, request }) => {
    const configName = `e2e-lifecycle-history-${Date.now()}.yaml`;
    createdConfigs.push(configName);

    const saveRes = await request.post('/api/config/save', { data: { config: MINIMAL_ISC_YAML, name: configName } });
    expect(saveRes.ok(), `Config save failed: ${await saveRes.text()}`).toBeTruthy();

    await seedOperation(request, configName, createdOperations);

    await page.goto('/history');
    await expect(page.getByText('Operation History').first()).toBeVisible({ timeout: 15000 });

    const historyTable = page.locator('table');
    await expect(historyTable).toBeVisible({ timeout: 10000 });
    await expect(historyTable.locator('tbody tr').filter({ hasText: configName }).first()).toBeVisible({ timeout: 10000 });
  });

  // Seed an operation via API, then use "Delete All" to wipe the table.
  test('bulk delete removes all operations', async ({ page, request }) => {
    const configName = `e2e-lifecycle-bulk-${Date.now()}.yaml`;
    createdConfigs.push(configName);

    const saveRes = await request.post('/api/config/save', { data: { config: MINIMAL_ISC_YAML, name: configName } });
    expect(saveRes.ok(), `Config save failed: ${await saveRes.text()}`).toBeTruthy();

    await seedOperation(request, configName, createdOperations);

    await page.goto('/operations');
    const historyCard = page.locator('#operation-history-card');
    const operationTable = historyCard.locator('table');
    await expect(operationTable).toBeVisible({ timeout: 15000 });

    const operationRow = operationTable.locator('tbody tr').filter({ hasText: configName }).first();
    await expect(operationRow).toBeVisible({ timeout: 5000 });

    const deleteAllButton = historyCard.getByRole('button', { name: /delete all/i });
    await expect(deleteAllButton).toBeVisible({ timeout: 5000 });
    await deleteAllButton.click();

    const bulkDeleteModal = page.locator('[aria-label="Confirm bulk deletion"]');
    await expect(bulkDeleteModal).toBeVisible({ timeout: 5000 });
    await bulkDeleteModal.getByRole('button', { name: 'Delete' }).click();

    await expect(operationRow).not.toBeVisible({ timeout: 15000 });
  });
});

// Row checkbox selection and "Delete Selected" on the Operations page.
// Separate describe block with its own seed data and cleanup.
test.describe('Operations - Row Selection & Bulk Delete Selected', () => {
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
      const configName = `e2e-rowsel-${Date.now()}-${i}.yaml`;
      createdConfigs.push(configName);

      const saveRes = await request.post('/api/config/save', {
        data: { config: MINIMAL_ISC_YAML, name: configName },
      });
      expect(saveRes.ok(), `Config save failed: ${await saveRes.text()}`).toBeTruthy();

      await seedOperation(request, configName, createdOperations);
    }
  });

  test('row checkbox toggles on click', async ({ page }) => {
    await page.goto('/operations');
    const table = page.locator('#operation-history-card table');
    await expect(table).toBeVisible({ timeout: 15000 });
    await assertRowCheckboxToggles(table, createdConfigs[0]);
  });

  test('checking multiple rows selects only those rows', async ({ page }) => {
    await page.goto('/operations');
    const table = page.locator('#operation-history-card table');
    await expect(table).toBeVisible({ timeout: 15000 });
    await assertMultiRowSelect(table, [createdConfigs[0], createdConfigs[2]], createdConfigs[1]);
  });

  test('select-all checkbox checks and unchecks every row', async ({ page }) => {
    await page.goto('/operations');
    const table = page.locator('#operation-history-card table');
    await expect(table).toBeVisible({ timeout: 15000 });
    await assertSelectAllToggles(table, createdConfigs);
  });

  test('"Delete Selected" button appears with correct count and hides after uncheck', async ({ page }) => {
    await page.goto('/operations');
    const card = page.locator('#operation-history-card');
    const table = card.locator('table');
    await expect(table).toBeVisible({ timeout: 15000 });
    await assertDeleteSelectedButtonVisibility(table, card, [createdConfigs[0], createdConfigs[1]]);
  });

  test('cancelling the bulk-delete modal keeps all rows intact', async ({ page }) => {
    await page.goto('/operations');
    const card = page.locator('#operation-history-card');
    const table = card.locator('table');
    await expect(table).toBeVisible({ timeout: 15000 });
    await assertCancelModalKeepsRows(page, table, card, createdConfigs, 'Confirm bulk deletion');
  });

  test('confirming "Delete Selected" removes only the checked row', async ({ page }) => {
    await page.goto('/operations');
    const card = page.locator('#operation-history-card');
    const table = card.locator('table');
    await expect(table).toBeVisible({ timeout: 15000 });
    await assertDeleteSelectedRemovesOnlyChecked(page, table, card, createdConfigs[0], createdConfigs.slice(1), 'Confirm bulk deletion');
  });

  test('select-all then "Delete Selected" removes all remaining rows', async ({ page }) => {
    await page.goto('/operations');
    const card = page.locator('#operation-history-card');
    const table = card.locator('table');
    await expect(table).toBeVisible({ timeout: 15000 });
    await assertSelectAllDeleteRemovesAll(page, table, card, createdConfigs.slice(1), 'Confirm bulk deletion', card);
  });
});
