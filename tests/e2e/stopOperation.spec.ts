import { test, expect, type Page, type Route } from '@playwright/test';
import { MINIMAL_ISC_YAML } from '../helpers/minimalConfig.js';

/** Save a config, start an operation, and return the operationId. */
async function seedOperation(request: Page['request'], configName: string) {
  const saveRes = await request.post('/api/config/save', { data: { config: MINIMAL_ISC_YAML, name: configName } });
  expect(saveRes.ok(), `Config save failed: ${await saveRes.text()}`).toBeTruthy();
  const startRes = await request.post('/api/operations/start', { data: { configFile: configName } });
  expect(startRes.ok()).toBeTruthy();
  return (await startRes.json()).operationId as string;
}

/** Stop an operation via API, assert the response, and poll until status is 'stopped'. */
async function stopAndAwaitTerminal(request: Page['request'], operationId: string) {
  const stopRes = await request.post(`/api/operations/${operationId}/stop`);
  expect(stopRes.ok(), `Stop request failed: ${stopRes.status()}`).toBeTruthy();
  await expect(async () => {
    const ops = await (await request.get('/api/operations')).json();
    expect(ops.find((o: { id: string }) => o.id === operationId)?.status).toBe('stopped');
  }).toPass({ timeout: 15_000 });
}

/** Navigate to /operations and return the row matching configName. */
async function findOperationRow(page: Page, configName: string) {
  await page.goto('/operations');
  const card = page.locator('#operation-history-card');
  await expect(card.locator('table')).toBeVisible({ timeout: 15_000 });
  const row = card.locator('tbody tr').filter({ hasText: configName }).first();
  await expect(row).toBeVisible({ timeout: 10_000 });
  return row;
}

// ── Live server tests ──────────────────────────────────────────────────────────

test.describe('Stop Operation – live server', () => {
  test.describe.configure({ mode: 'serial' });
  const configs: string[] = [];
  const ops: string[] = [];

  test.afterAll(async ({ request }) => {
    for (const id of ops) {
      await request.post(`/api/operations/${id}/stop`).catch(() => {});
      await request.delete(`/api/operations/${id}`).catch(() => {});
    }
    for (const n of configs) await request.delete(`/api/config/delete/${n}`).catch(() => {});
  });

  test('stop via kebab menu, confirm modal, verify status transition', async ({ page, request }) => {
    const cfg = `e2e-stop-live-${Date.now()}.yaml`;
    configs.push(cfg);
    const opId = await seedOperation(request, cfg);
    ops.push(opId);

    // Intercept GET /api/operations to freeze status as "running" while we
    // interact with the UI. The real stop API (POST) is NOT mocked.
    // Uses toPass()-style retry inside route.fetch() to handle brief server
    // unavailability (e.g. tsx watch restart in dev, or slow CI startup).
    await page.route('**/api/operations', async (route: Route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      try {
        const res = await route.fetch();
        const body = await res.json();
        const op = body.find((o: { id: string }) => o.id === opId);
        if (op) op.status = 'running';
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
      } catch {
        return route.abort();
      }
    });

    const row = await findOperationRow(page, cfg);
    const statusCell = row.locator('td').nth(3);
    await expect(statusCell.getByText('Running')).toBeVisible({ timeout: 15_000 });

    // Kebab → Stop → modal opens
    await row.locator('button[aria-label^="Actions for "]').click();
    await page.getByRole('menuitem', { name: 'Stop' }).click();

    const modal = page.locator('[aria-label="Stop confirmation"]');
    await expect(modal).toBeVisible({ timeout: 5_000 });
    await expect(modal.getByRole('heading', { name: 'Stop Operation' })).toBeVisible();
    await expect(modal.getByText(opId)).toBeVisible();
    await expect(modal.getByText('You can start a new operation with the same configuration.')).toBeVisible();

    // Confirm stop — hits the real POST /api/operations/:id/stop endpoint
    await modal.getByRole('button', { name: 'Stop Operation' }).click();
    await expect(modal).not.toBeVisible({ timeout: 5_000 });

    // Remove the intercept so the real terminal status shows through
    await page.unroute('**/api/operations');

    // The UI polls on an interval; after unrouting, the next real fetch may
    // take a few seconds. Require specifically "Stopped" — not success/failed
    // — to prove the stop request was the cause of the terminal state.
    await expect(statusCell.getByText('Stopped')).toBeVisible({ timeout: 30_000 });
  });

  test('stopped status persists after reload and stop menu item is hidden', async ({ page, request }) => {
    const cfg = `e2e-stop-persist-${Date.now()}.yaml`;
    configs.push(cfg);
    const opId = await seedOperation(request, cfg);
    ops.push(opId);
    await stopAndAwaitTerminal(request, opId);

    const row = await findOperationRow(page, cfg);
    await expect(row.locator('.pf-v6-c-label__text').filter({ hasText: 'Stopped' })).toBeVisible({ timeout: 5_000 });

    // "Stop" must not appear in the kebab for a non-running operation
    await row.locator('button[aria-label^="Actions for "]').click();
    await expect(page.getByRole('menuitem', { name: 'View Logs' })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'Stop' })).not.toBeVisible();
  });
});

// ── Mocked API tests ───────────────────────────────────────────────────────────

test.describe('Stop Operation – mocked API', () => {
  const RUNNING_OP = {
    id: 'op-stop-mock-1', name: 'mirror-stop-mock-1',
    configFile: 'stop-mock-config.yaml', status: 'running',
    startedAt: new Date(Date.now() - 60_000).toISOString(),
  };

  function mockOps(page: Page, ops: object[]) {
    return page.route('**/api/operations', (route: Route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(ops) });
    });
  }

  /** Open the stop modal for the running operation row. */
  async function openStopModal(page: Page) {
    await mockOps(page, [RUNNING_OP]);
    await page.goto('/operations');
    const row = page.locator('#operation-history-card tbody tr').filter({ hasText: RUNNING_OP.configFile }).first();
    await expect(row).toBeVisible({ timeout: 10_000 });
    await row.locator('button[aria-label^="Actions for "]').click();
    await page.getByRole('menuitem', { name: 'Stop' }).click();
    const modal = page.locator('[aria-label="Stop confirmation"]');
    await expect(modal).toBeVisible({ timeout: 5_000 });
    return { row, modal };
  }

  test('confirm stop: closes modal, fires API, verifies modal content', async ({ page }) => {
    let stopApiCalled = false;
    await page.route(`**/api/operations/${RUNNING_OP.id}/stop`, (route: Route) => {
      stopApiCalled = true;
      return route.fulfill({ status: 200, contentType: 'application/json', body: '{"message":"stopped"}' });
    });

    const { modal } = await openStopModal(page);

    // Modal content checks
    await expect(modal.getByRole('heading', { name: 'Stop Operation' })).toBeVisible();
    await expect(modal.getByText(RUNNING_OP.id)).toBeVisible();
    await expect(modal.getByText('You can start a new operation with the same configuration.')).toBeVisible();
    await expect(modal.getByRole('button', { name: 'Stop Operation' })).toBeVisible();
    await expect(modal.getByRole('button', { name: 'Cancel' })).toBeVisible();

    // Confirm
    await modal.getByRole('button', { name: 'Stop Operation' }).click();
    await expect(modal).not.toBeVisible({ timeout: 5_000 });
    expect(stopApiCalled).toBe(true);
  });

  for (const dismiss of ['Cancel', 'Close'] as const) {
    test(`${dismiss} button keeps operation running and does not call stop API`, async ({ page }) => {
      let stopApiCalled = false;
      await page.route(`**/api/operations/${RUNNING_OP.id}/stop`, (route: Route) => {
        stopApiCalled = true;
        return route.fulfill({ status: 200, contentType: 'application/json', body: '{"message":"stopped"}' });
      });

      const { row, modal } = await openStopModal(page);

      if (dismiss === 'Cancel') {
        await modal.getByRole('button', { name: 'Cancel' }).click();
      } else {
        await modal.locator('button[aria-label="Close"]').click();
      }

      await expect(modal).not.toBeVisible({ timeout: 5_000 });
      await expect(row.locator('.pf-v6-c-label__text').filter({ hasText: 'Running' })).toBeVisible();
      expect(stopApiCalled, `Stop API should not be called on ${dismiss}`).toBe(false);
    });
  }

  test('stop item only appears for running operations', async ({ page }) => {
    const stoppedOp = { ...RUNNING_OP, id: 'op-done', configFile: 'done.yaml', status: 'stopped', completedAt: new Date().toISOString() };
    await mockOps(page, [RUNNING_OP, stoppedOp]);
    await page.goto('/operations');

    const card = page.locator('#operation-history-card');
    await expect(card.locator('table')).toBeVisible({ timeout: 10_000 });

    // Running row → "Stop" visible
    await card.locator('tbody tr').filter({ hasText: RUNNING_OP.configFile }).first()
      .locator('button[aria-label^="Actions for "]').click();
    await expect(page.getByRole('menuitem', { name: 'Stop' })).toBeVisible();
    await page.keyboard.press('Escape');

    // Stopped row → "Stop" hidden
    await card.locator('tbody tr').filter({ hasText: stoppedOp.configFile }).first()
      .locator('button[aria-label^="Actions for "]').click();
    await expect(page.getByRole('menuitem', { name: 'View Logs' })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'Stop' })).not.toBeVisible();
  });

  test('stopped operations filterable under "Stopped" status', async ({ page }) => {
    const stopped = { ...RUNNING_OP, id: 'op-s', configFile: 's.yaml', status: 'stopped', completedAt: new Date().toISOString() };
    const success = { ...RUNNING_OP, id: 'op-ok', configFile: 'ok.yaml', status: 'success', completedAt: new Date().toISOString() };
    await mockOps(page, [stopped, success]);
    await page.goto('/operations');

    const card = page.locator('#operation-history-card');
    await expect(card.locator('table')).toBeVisible({ timeout: 10_000 });
    await card.getByLabel('Filter operations').click();
    await page.getByRole('option', { name: 'Stopped' }).click();

    const rows = card.locator('table tbody tr');
    await expect(rows).toHaveCount(1);
    await expect(rows.filter({ hasText: stopped.configFile })).toBeVisible();
  });
});
