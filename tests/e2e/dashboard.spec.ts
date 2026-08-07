import { test, expect, Page, Route } from '@playwright/test';

/** Minimal valid pull secret payload used across pull-secret lifecycle tests. */
const PULL_SECRET_JSON = JSON.stringify({ auths: { 'registry.example.com': { auth: 'dGVzdDp0ZXN0' } } });

/**
 * Intercepts GET /api/system/status and responds with a controlled payload.
 * Defaults to a healthy system with oc-mirror 4.21.0 and pull secret present.
 * Pass `overrides` to simulate degraded states (e.g. missing binary, no pull secret).
 */
function mockSystemStatus(page: Page, overrides: Partial<{ ocMirrorVersion: string; systemHealth: string; pullSecretDetected: boolean }> = {}) {
  return page.route('**/api/system/status', (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ocMirrorVersion: '4.21.0',
        systemHealth: 'healthy',
        pullSecretDetected: true,
        ...overrides,
      }),
    }),
  );
}

/** Verifies the Environment card displays the oc-mirror version from the API. */
test.describe('Dashboard - OC Mirror Version', () => {
  /** Mocks a valid version response and asserts it renders without the fallback text. */
  test('displays version and does not show "Not available" when binary is present', async ({ page }) => {
    await mockSystemStatus(page, { ocMirrorVersion: '4.21.0' });
    await page.goto('/');
    await expect(page.getByText('OC Mirror Version')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('dd, [class*="DescriptionListDescription"]').filter({ hasText: '4.21.0' })).toBeVisible({ timeout: 10000 });
    const envCard = page.locator('section').filter({ hasText: 'Environment' }).first();
    await expect(envCard.getByText('Not available')).not.toBeVisible();
  });

  /** Mocks a missing binary and asserts the fallback "Not available" text appears. */
  test('shows "Not available" when oc-mirror binary is missing', async ({ page }) => {
    await mockSystemStatus(page, { ocMirrorVersion: 'Not available', systemHealth: 'degraded' });
    await page.goto('/');
    await expect(page.getByText('OC Mirror Version')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('Not available')).toBeVisible();
  });
});

/** Validates that the dashboard reflects pull secret state changes made via the API. */
test.describe('Dashboard - Pull Secret Real-Time Status', () => {
  test.describe.configure({ mode: 'serial' });

  test.afterEach(async ({ request }) => {
    await request.delete('/api/pull-secret');
  });

  /**
   * Polls GET /api/pull-secret/status until the server reports the expected detection state.
   * Guards against race conditions where the file write hasn't settled before a page reload.
   */
  async function awaitPullSecretState(request: import('@playwright/test').APIRequestContext, expected: boolean) {
    for (let i = 0; i < 10; i++) {
      const res = await request.get('/api/pull-secret/status');
      const body = await res.json();
      if (body.detected === expected) return;
      await new Promise((r) => setTimeout(r, 500));
    }
    throw new Error(`Pull secret status did not become ${expected} within 5s`);
  }

  /** Removes pull secret, verifies "Missing" + warning banner, then adds it and confirms "Present". */
  test('status and banner update to "Present" after adding via API', async ({ page, request }) => {
    await request.delete('/api/pull-secret');
    await awaitPullSecretState(request, false);
    await page.goto('/');
    await expect(page.getByText('Missing')).toBeVisible({ timeout: 15000 });
    await expect(page.getByText('No pull secret detected')).toBeVisible();

    const postRes = await request.post('/api/pull-secret', { data: { content: PULL_SECRET_JSON } });
    expect(postRes.ok(), `POST /api/pull-secret failed with HTTP ${postRes.status()}`).toBeTruthy();
    await awaitPullSecretState(request, true);
    await page.reload();
    await expect(page.getByText('Present')).toBeVisible({ timeout: 15000 });
    await expect(page.getByText('No pull secret detected')).not.toBeVisible();
  });

  /** Adds pull secret, verifies "Present" + no banner, then removes it and confirms "Missing". */
  test('status and banner update to "Missing" after removing via API', async ({ page, request }) => {
    const postRes = await request.post('/api/pull-secret', { data: { content: PULL_SECRET_JSON } });
    expect(postRes.ok(), `POST /api/pull-secret failed with HTTP ${postRes.status()}`).toBeTruthy();
    await awaitPullSecretState(request, true);
    await page.goto('/');
    await expect(page.getByText('Present')).toBeVisible({ timeout: 15000 });
    await expect(page.getByText('No pull secret detected')).not.toBeVisible();

    await request.delete('/api/pull-secret');
    await awaitPullSecretState(request, false);
    await page.reload();
    await expect(page.getByText('Missing')).toBeVisible({ timeout: 15000 });
    await expect(page.getByText('No pull secret detected')).toBeVisible();
  });
});

/** Confirms the dashboard polls APIs every ~30s and the UI reflects updated data. */
test.describe('Dashboard - Auto-Refresh (30s Interval)', () => {
  /** Tracks the first two /api/system/status poll cycles, asserts interval is ~30s. */
  test('updates displayed version at the 30s interval', async ({ page }) => {
    test.setTimeout(65000);

    const pollTimes: number[] = [];
    let resolveRefresh: () => void;
    const refreshPromise = new Promise<void>((r) => { resolveRefresh = r; });

    await page.route('**/api/system/status', (route) => {
      const now = Date.now();
      if (pollTimes.length === 0 || now - pollTimes[pollTimes.length - 1] > 5000) {
        pollTimes.push(now);
      }
      if (pollTimes.length === 2) resolveRefresh();
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ocMirrorVersion: pollTimes.length >= 2 ? '5.0.0-refreshed' : '4.21.0',
          systemHealth: 'healthy',
          pullSecretDetected: true,
        }),
      });
    });

    await page.goto('/');
    await expect(page.getByText('4.21.0')).toBeVisible({ timeout: 10000 });
    await refreshPromise;
    await expect(page.getByText('5.0.0-refreshed')).toBeVisible({ timeout: 5000 });

    const interval = pollTimes[1] - pollTimes[0];
    expect(interval).toBeGreaterThanOrEqual(29000);
    expect(interval).toBeLessThanOrEqual(33000);
  });

  /** Tracks the first two /api/stats poll cycles, asserts interval is ~30s. */
  test('stats cards reflect updated counts at the 30s interval', async ({ page }) => {
    test.setTimeout(65000);

    const pollTimes: number[] = [];
    let resolveRefresh: () => void;
    const refreshPromise = new Promise<void>((r) => { resolveRefresh = r; });

    await page.route('**/api/stats', (route) => {
      const now = Date.now();
      if (pollTimes.length === 0 || now - pollTimes[pollTimes.length - 1] > 5000) {
        pollTimes.push(now);
      }
      if (pollTimes.length === 2) resolveRefresh();
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          totalOperations: pollTimes.length >= 2 ? 99 : 5,
          successfulOperations: pollTimes.length >= 2 ? 80 : 3,
          failedOperations: pollTimes.length >= 2 ? 19 : 2,
          runningOperations: 0,
        }),
      });
    });

    await page.goto('/');
    await expect(page.getByRole('heading', { name: '5', level: 3 })).toBeVisible({ timeout: 10000 });
    await refreshPromise;
    await expect(page.getByRole('heading', { name: '99', level: 3 })).toBeVisible({ timeout: 5000 });

    const interval = pollTimes[1] - pollTimes[0];
    expect(interval).toBeGreaterThanOrEqual(29000);
    expect(interval).toBeLessThanOrEqual(33000);
  });
});

/** Tests that action buttons on the dashboard navigate to the correct routes. */
test.describe('Dashboard - Quick Action Buttons', () => {
  /** Mocks pull secret as missing, clicks the "Go to Settings" action link, asserts URL. */
  test('"Go to Settings" in pull-secret warning navigates to settings', async ({ page }) => {
    await mockSystemStatus(page, { pullSecretDetected: false });
    await page.goto('/');
    const goToSettings = page.getByRole('link', { name: 'Go to Settings' }).or(
      page.getByRole('button', { name: 'Go to Settings' }),
    );
    await expect(goToSettings).toBeVisible({ timeout: 15000 });
    await goToSettings.click();
    await expect(page).toHaveURL(/\/settings\?tab=pull-secret/);
  });

  const sidebarNavItems = [
    { label: 'Mirror Configuration', urlPattern: /\/config/ },
    { label: 'Mirror Operations', urlPattern: /\/operations/ },
    { label: 'History', urlPattern: /\/history/ },
  ] as const;

  /** Clicks each sidebar nav item from the dashboard and asserts the target URL. */
  for (const { label, urlPattern } of sidebarNavItems) {
    test(`sidebar "${label}" link navigates correctly`, async ({ page }) => {
      await page.goto('/');
      await expect(page.getByRole('heading', { name: 'Environment' })).toBeVisible({ timeout: 10000 });
      await page.getByText(label).first().click();
      await expect(page).toHaveURL(urlPattern);
    });
  }

  /** Navigates to settings, then clicks the Dashboard sidebar link and verifies return. */
  test('sidebar Dashboard link navigates back from settings', async ({ page }) => {
    await page.goto('/settings');
    await page.getByText('Dashboard').first().click();
    await expect(page).toHaveURL(/\/(\?.*)?$/);
    await expect(page.getByRole('heading', { name: 'Environment' })).toBeVisible({ timeout: 10000 });
  });
});

/** Smoke-tests that key dashboard sections render with expected labels and structure. */
test.describe('Dashboard - Rendering', () => {
  /** Asserts Operation Statistics labels and Recent Operations table/empty state are present. */
  test('stats cards and recent operations section render', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Operation Statistics' })).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('Total Operations')).toBeVisible();
    await expect(page.getByText('Successful', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Failed', { exact: true }).first()).toBeVisible();

    await expect(page.getByText('Recent Operations').first()).toBeVisible();
    const table = page.locator('table[aria-label="Recent operations"]');
    const emptyState = page.getByText('No recent operations found.');
    await expect(table.or(emptyState)).toBeVisible({ timeout: 10000 });
    if (await table.isVisible()) {
      await expect(table.getByRole('columnheader', { name: 'Config' })).toBeVisible();
    }
  });
});
