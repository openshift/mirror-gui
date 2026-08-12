import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import fs from 'fs';

const CONFIG_NAME = `e2e-full-workflow-${Date.now()}.yaml`;
const TEST_IMAGE = 'test.invalid/e2e/no-such-image:v0';
const EXPECTED_RESOURCES = ['stable-4.21', 'odf-operator', TEST_IMAGE];
const TEST_PULL_SECRET = JSON.stringify({
  auths: { 'test.invalid': { auth: 'dGVzdDp0ZXN0' } },
});

async function cleanupByConfigName(request: APIRequestContext, configName: string) {
  try {
    const res = await request.get('/api/operations');
    if (!res.ok()) return;
    const ops: { id: string; configFile: string }[] = await res.json();
    for (const op of ops.filter((o) => o.configFile === configName)) {
      await request.post(`/api/operations/${op.id}/stop`).catch(() => {});
      await request.delete(`/api/operations/${op.id}`).catch(() => {});
    }
  } catch { /* best-effort */ }
}

async function findOperationRow(page: Page) {
  const card = page.locator('#operation-history-card');
  await expect(card.locator('table')).toBeVisible({ timeout: 15_000 });
  const row = card.locator('tbody tr').filter({ hasText: CONFIG_NAME }).first();
  await expect(row).toBeVisible({ timeout: 10_000 });
  return row;
}

test.describe('Full Mirroring Workflow', () => {
  test.describe.configure({ mode: 'serial' });
  test.setTimeout(120_000);

  let operationId: string | undefined;
  let operationStatus: string | undefined;
  let originalPullSecret: string | null = null;
  let pullSecretCaptured = false;

  test.beforeAll(async ({ request }) => {
    try {
      const res = await request.get('/api/pull-secret/content');
      if (res.ok()) {
        const body = await res.json();
        originalPullSecret = body.content || null;
        pullSecretCaptured = true;
      }
    } catch { /* capture failed — afterAll must not delete */ }
  });

  test.afterAll(async ({ request }) => {
    if (operationId) {
      await request.post(`/api/operations/${operationId}/stop`).catch(() => {});
      await request.delete(`/api/operations/${operationId}`).catch(() => {});
    }
    await cleanupByConfigName(request, CONFIG_NAME);
    await request.delete(`/api/config/delete/${CONFIG_NAME}`).catch(() => {});

    if (!pullSecretCaptured) return;
    if (originalPullSecret) {
      await request.post('/api/pull-secret', { data: { content: originalPullSecret } }).catch(() => {});
    } else {
      await request.delete('/api/pull-secret').catch(() => {});
    }
  });

  test('1 — paste pull secret in Settings, verify on dashboard', async ({ page }) => {
    await page.goto('/settings?tab=pull-secret');
    await expect(page.getByRole('heading', { name: 'Pull Secret', level: 3 })).toBeVisible({ timeout: 15_000 });

    const fileUpload = page.locator('#pull-secret-upload');
    await fileUpload.fill(TEST_PULL_SECRET);
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('Pull secret saved successfully!')).toBeVisible({ timeout: 10_000 });

    await page.goto('/');
    const pullSecretGroup = page.locator('.pf-v6-c-description-list__group').filter({
      hasText: 'Pull Secret',
    });
    await expect(pullSecretGroup.getByText('Present')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('No pull secret detected')).not.toBeVisible();
  });

  test('2 — build config with channel + operator + image, preview YAML, save', async ({ page, request }) => {
    await request.delete(`/api/config/delete/${CONFIG_NAME}`).catch(() => {});
    await page.goto('/config');
    await expect(page.getByRole('heading', { name: 'Platform Channels' })).toBeVisible({ timeout: 15_000 });

    await page.getByRole('button', { name: 'Add platform channel' }).click();
    await page.getByRole('button', { name: /^stable-/ }).click();
    await page.getByRole('option', { name: 'stable-4.21' }).click();

    await page.getByRole('tab', { name: /Operators/ }).click();
    await page.getByRole('button', { name: 'Add operator catalog' }).click();
    await expect(page.getByRole('button', { name: /redhat-operator-index/ })).toBeVisible({ timeout: 10_000 });
    await page.getByRole('button', { name: 'Add operator', exact: true }).click();
    const operatorInput = page.getByPlaceholder('Type to search operators...');
    await expect(operatorInput).toBeVisible({ timeout: 10_000 });
    await operatorInput.fill('odf');
    await page.getByRole('option', { name: 'odf-operator' }).click();

    await page.getByRole('tab', { name: /Additional Images/ }).click();
    await page.getByRole('button', { name: 'Add image' }).click();
    await page.getByPlaceholder('registry.redhat.io/example/image:tag').fill(TEST_IMAGE);

    // Verify state persists across tab switches
    await page.getByRole('tab', { name: /Platform Channels/ }).click();
    await expect(page.getByRole('button', { name: 'stable-4.21' })).toBeVisible({ timeout: 5_000 });
    await page.getByRole('tab', { name: /Operators/ }).click();
    await expect(page.getByText('Default Channel')).toBeVisible({ timeout: 5_000 });

    await page.getByRole('tab', { name: /Preview/ }).click();
    await expect(page.getByText('ImageSetConfiguration Preview')).toBeVisible({ timeout: 10_000 });

    const yamlContent = await page.locator('#yaml-preview').textContent();
    expect(yamlContent).toBeTruthy();
    const yamlLines = yamlContent!.split('\n').map((l) => l.trim()).filter(Boolean);
    for (const [pattern, label] of [
      [/^kind:\s*ImageSetConfiguration$/, 'kind'],
      [/^apiVersion:\s*mirror\.openshift\.io\//, 'apiVersion'],
      [/^mirror:$/, 'mirror section'],
    ] as const) {
      expect(yamlLines.some((l) => pattern.test(l)), `YAML missing ${label}`).toBeTruthy();
    }
    for (const resource of EXPECTED_RESOURCES) expect(yamlContent).toContain(resource);

    await page.getByLabel('Edit filename').click();
    const filenameInput = page.getByLabel('Configuration filename');
    await filenameInput.clear();
    await filenameInput.fill(CONFIG_NAME.replace('.yaml', ''));
    await page.getByLabel('Confirm filename').click();
    await page.getByRole('button', { name: 'Save Configuration' }).click();
    await expect(page.getByText('Configuration saved successfully!')).toBeVisible({ timeout: 10_000 });

    const configs: { name: string }[] = await (await request.get('/api/config/list')).json();
    expect(configs.some((c) => c.name === CONFIG_NAME)).toBeTruthy();

    const savedYaml = await (await request.get(`/api/config/download/${CONFIG_NAME}`)).text();
    for (const resource of EXPECTED_RESOURCES) expect(savedYaml).toContain(resource);
  });

  test('3 — start mirror operation from saved config', async ({ page, request }) => {
    await cleanupByConfigName(request, CONFIG_NAME);
    await page.goto('/operations');
    await expect(page.getByRole('heading', { name: 'Start New Operation' })).toBeVisible({ timeout: 15_000 });

    const configToggle = page.getByLabel('Select ImageSetConfiguration file');
    await configToggle.click();
    await page.getByRole('option').filter({ hasText: CONFIG_NAME }).click();
    await expect(configToggle).toContainText(CONFIG_NAME);
    await page.getByRole('button', { name: 'Start Operation' }).click();

    const row = await findOperationRow(page);
    await expect(
      row.locator('.pf-v6-c-label__text').filter({ hasText: /Running|Success|Failed|Stopped/ }),
    ).toBeVisible({ timeout: 10_000 });

    await expect(async () => {
      const ops = await (await request.get('/api/operations')).json();
      const op = ops.find((o: { configFile: string }) => o.configFile === CONFIG_NAME);
      expect(op).toBeTruthy();
      operationId = op.id;
    }).toPass({ timeout: 15_000 });
  });

  test('4 — open log panel via kebab menu', async ({ page }) => {
    await page.goto('/operations');
    const logsCard = page.locator('#operation-logs-card');
    if (!(await logsCard.isVisible().catch(() => false))) {
      const row = await findOperationRow(page);
      await row.locator('button[aria-label^="Actions for "]').click();
      await page.getByRole('menuitem', { name: 'View Logs' }).click();
    }

    await expect(logsCard).toBeVisible({ timeout: 10_000 });
    await expect(logsCard.getByRole('heading', { name: 'Operation Logs' })).toBeVisible();
    await expect(logsCard.locator('#log-container .pf-v6-c-code-block__code')).toBeVisible({ timeout: 10_000 });
  });

  test('5 — verify operation reaches terminal state', async ({ page, request }) => {
    // Ensure the operation terminates; oc-mirror with test.invalid may hang on DNS
    await expect(async () => {
      const ops = await (await request.get('/api/operations')).json();
      const op = ops.find((o: { id: string }) => o.id === operationId);
      if (op?.status === 'running') {
        await request.post(`/api/operations/${op.id}/stop`);
      }
    }).toPass({ timeout: 10_000 });

    await page.goto('/operations');
    const row = await findOperationRow(page);

    const statusLabel = row.locator('.pf-v6-c-label__text').filter({ hasText: /Success|Failed|Stopped/ });
    await expect(statusLabel).toBeVisible({ timeout: 30_000 });
    operationStatus = (await statusLabel.textContent())?.trim();
  });

  test('6 — history page shows operation and CSV export is valid', async ({ page }) => {
    await page.goto('/history');
    const historyTable = page.locator('table[aria-label="Operations list"]');
    await expect(historyTable).toBeVisible({ timeout: 15_000 });

    const row = historyTable.locator('tbody tr').filter({ hasText: CONFIG_NAME }).first();
    await expect(row).toBeVisible({ timeout: 10_000 });

    const historyLabel = row.locator('.pf-v6-c-label__text').filter({ hasText: /Success|Failed|Stopped/ });
    await expect(historyLabel).toBeVisible();
    if (operationStatus) {
      expect((await historyLabel.textContent())?.trim()).toBe(operationStatus);
    }

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Export CSV' }).click(),
    ]);
    expect(await download.failure()).toBeNull();
    expect(download.suggestedFilename()).toMatch(/^mirror-history-.*\.csv$/);

    const downloadPath = await download.path();
    expect(downloadPath).toBeTruthy();
    const csv = fs.readFileSync(downloadPath!, 'utf-8');
    expect(csv).toBeTruthy();
    expect(csv).toContain('"Operation Name"');
    expect(csv).toContain('"Config File"');

    const dataRow = csv.split('\n').find((line: string) => line.includes(CONFIG_NAME));
    expect(dataRow).toBeTruthy();
    if (operationStatus) {
      const statusMap: Record<string, string> = { Success: 'success', Failed: 'failed', Stopped: 'stopped' };
      expect(dataRow).toContain(`"${statusMap[operationStatus] ?? operationStatus}`);
    }
  });
});
