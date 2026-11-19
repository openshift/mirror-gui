import { test, expect, type Page, type Request } from '@playwright/test';

// Counts requests whose URL contains `pattern` once they finish or fail, so tests that check
// nothing changed can wait for the lookups to end instead of sleeping a fixed time.
const countFinished = (page: Page, pattern: string): (() => number) => {
  let count = 0;
  const onDone = (request: Request) => {
    if (request.url().includes(pattern)) count += 1;
  };
  page.on('requestfinished', onDone);
  page.on('requestfailed', onDone);
  return () => count;
};

const waitForFinished = async (page: Page, finished: () => number, expected: number) => {
  await expect.poll(finished, { timeout: 20_000 }).toBeGreaterThanOrEqual(expected);
  // Give the UI a moment to apply the last response.
  await page.waitForTimeout(500);
};

// Selecting an operator must give it its default channel. Previously the package was saved
// with `channels: []`, which makes oc-mirror mirror the head of every channel.
test.describe('Operator default channel', () => {
  test('a newly selected operator starts on its default channel', async ({ page }) => {
    await page.goto('/config');
    await page.getByRole('tab', { name: /Operators/ }).click();
    await page.getByRole('button', { name: 'Add operator catalog' }).click();
    await expect(page.getByRole('button', { name: /redhat-operator-index/ })).toBeVisible({ timeout: 10_000 });

    await page.getByRole('button', { name: 'Add operator', exact: true }).click();
    await page.getByPlaceholder('Type to search operators...').fill('advanced-cluster');
    await page.getByRole('option', { name: 'advanced-cluster-management' }).click();

    // The channel row appears with the default channel selected.
    await expect(page.getByRole('button', { name: /release-2\.16 \(default\)/ })).toBeVisible({ timeout: 10_000 });

    // The generated YAML carries the channel instead of an empty list.
    await page.getByRole('tab', { name: /Preview/ }).click();
    const yaml = (await page.locator('#yaml-preview').textContent()) || '';
    expect(yaml).toMatch(/- name: advanced-cluster-management\s+channels:\s+- name: release-2\.16/);
    expect(yaml).not.toMatch(/- name: advanced-cluster-management\s+channels: \[\]/);
  });

  test('switching operators drops the previous operator\'s channels even if the lookup fails', async ({ page }) => {
    // Make the second operator's default-channel lookup fail: no defaultChannel in the
    // catalog listing and an error from the channel endpoint.
    await page.route('**/api/operators?*detailed=true*', async route => {
      const response = await route.fetch();
      const operators = (await response.json()) as { name: string; defaultChannel?: string }[];
      const patched = operators.map(op =>
        op.name === 'openshift-pipelines-operator-rh' ? { ...op, defaultChannel: '' } : op,
      );
      await route.fulfill({ response, json: patched });
    });
    await page.route('**/api/operator-channels/openshift-pipelines-operator-rh*', route => route.abort());
    const pipelinesLookups = countFinished(page, '/api/operator-channels/openshift-pipelines-operator-rh');

    await page.goto('/config');
    await page.getByRole('tab', { name: /Operators/ }).click();
    await page.getByRole('button', { name: 'Add operator catalog' }).click();
    await expect(page.getByRole('button', { name: /redhat-operator-index/ })).toBeVisible({ timeout: 10_000 });

    await page.getByRole('button', { name: 'Add operator', exact: true }).click();
    const operatorInput = page.getByPlaceholder('Type to search operators...');
    await operatorInput.fill('advanced-cluster');
    await page.getByRole('option', { name: 'advanced-cluster-management' }).click();
    await expect(page.getByRole('button', { name: /release-2\.16 \(default\)/ })).toBeVisible({ timeout: 10_000 });

    // Change the same row to an operator whose default-channel lookup fails.
    await operatorInput.fill('openshift-pipelines');
    await page.getByRole('option', { name: 'openshift-pipelines-operator-rh' }).click();
    // Both lookups (channel list and default channel) fail.
    await waitForFinished(page, pipelinesLookups, 2);

    await page.getByRole('tab', { name: /Preview/ }).click();
    const yaml = (await page.locator('#yaml-preview').textContent()) || '';
    expect(yaml).toContain('openshift-pipelines-operator-rh');
    expect(yaml).not.toContain('release-2.16');
  });

  // Helpers for the race tests: hide an operator's default channel from the catalog listing so
  // the UI must ask the (delayed) channel endpoint for it.
  const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

  test('a channel added and removed while the default lookup is pending is not overridden', async ({ page }) => {
    await page.route('**/api/operators?*detailed=true*', async route => {
      const response = await route.fetch();
      const operators = (await response.json()) as { name: string; defaultChannel?: string }[];
      await route.fulfill({
        response,
        json: operators.map(op => (op.name === 'advanced-cluster-management' ? { ...op, defaultChannel: '' } : op)),
      });
    });
    await page.route('**/api/operator-channels/advanced-cluster-management*', async route => {
      await delay(2500);
      await route.continue();
    });
    const acmLookups = countFinished(page, '/api/operator-channels/advanced-cluster-management');

    await page.goto('/config');
    await page.getByRole('tab', { name: /Operators/ }).click();
    await page.getByRole('button', { name: 'Add operator catalog' }).click();
    await expect(page.getByRole('button', { name: /redhat-operator-index/ })).toBeVisible({ timeout: 10_000 });
    await page.getByRole('button', { name: 'Add operator', exact: true }).click();
    await page.getByPlaceholder('Type to search operators...').fill('advanced-cluster');
    await page.getByRole('option', { name: 'advanced-cluster-management' }).click();

    // While the lookup is pending: add a channel, then remove it again.
    await page.getByText('release-2.15', { exact: true }).first().click();
    await page.getByRole('button', { name: /Remove channel/i }).first().click();
    // Wait for both delayed lookups (channel list, then default channel) to finish.
    await waitForFinished(page, acmLookups, 2);

    await page.getByRole('tab', { name: /Preview/ }).click();
    const yaml = (await page.locator('#yaml-preview').textContent()) || '';
    expect(yaml).toContain('advanced-cluster-management');
    expect(yaml).not.toContain('release-2.16');
    expect(yaml).not.toContain('release-2.15');
  });

  test('a default lookup that finishes after a catalog change is discarded', async ({ page }) => {
    await page.route('**/api/operators?*detailed=true*', async route => {
      if (route.request().url().includes('certified-operator-index')) {
        await delay(6000);
        await route.continue();
        return;
      }
      const response = await route.fetch();
      const operators = (await response.json()) as { name: string; defaultChannel?: string }[];
      await route.fulfill({
        response,
        json: operators.map(op => (op.name === 'advanced-cluster-management' ? { ...op, defaultChannel: '' } : op)),
      });
    });
    await page.route('**/api/operator-channels/advanced-cluster-management*', async route => {
      await delay(1500);
      await route.continue();
    });
    const acmLookups = countFinished(page, '/api/operator-channels/advanced-cluster-management');
    const certifiedLoads = countFinished(page, 'certified-operator-index');

    await page.goto('/config');
    await page.getByRole('tab', { name: /Operators/ }).click();
    await page.getByRole('button', { name: 'Add operator catalog' }).click();
    const catalogToggle = page.getByRole('button', { name: /redhat-operator-index/ }).first();
    await expect(catalogToggle).toBeVisible({ timeout: 10_000 });
    await page.getByRole('button', { name: 'Add operator', exact: true }).click();
    await page.getByPlaceholder('Type to search operators...').fill('advanced-cluster');
    await page.getByRole('option', { name: 'advanced-cluster-management' }).click();

    // Switch the row to another catalog while the default lookup is still pending.
    await catalogToggle.click();
    await page.getByRole('option', { name: /certified-operator-index/ }).click();
    await waitForFinished(page, acmLookups, 2);
    await waitForFinished(page, certifiedLoads, 1);

    await page.getByRole('tab', { name: /Preview/ }).click();
    const yaml = (await page.locator('#yaml-preview').textContent()) || '';
    expect(yaml).toContain('certified-operator-index');
    expect(yaml).not.toContain('release-2.16');
  });

  test('changing an auto-added dependency makes it a normal package with its own default channel', async ({ page }) => {
    await page.goto('/config');
    await page.getByRole('tab', { name: /Operators/ }).click();
    await page.getByRole('button', { name: 'Add operator catalog' }).click();
    await expect(page.getByRole('button', { name: /redhat-operator-index/ })).toBeVisible({ timeout: 10_000 });
    await page.getByRole('button', { name: 'Add operator', exact: true }).click();
    await page.getByPlaceholder('Type to search operators...').fill('odf-operator');
    await page.getByRole('option', { name: 'odf-operator' }).click();
    await expect(page.getByText(/Auto-added for odf-operator/).first()).toBeVisible({ timeout: 10_000 });
    const autoAddedBefore = await page.getByText(/Auto-added for odf-operator/).count();

    // Change the first auto-added dependency row to a different operator.
    const dependencyInput = page.getByPlaceholder('Type to search operators...').nth(1);
    await dependencyInput.fill('advanced-cluster');
    await page.getByRole('option', { name: 'advanced-cluster-management' }).click();
    await expect(page.getByRole('button', { name: /release-2\.16 \(default\)/ })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/Auto-added for odf-operator/)).toHaveCount(autoAddedBefore - 1);

    await page.getByRole('tab', { name: /Preview/ }).click();
    const yaml = (await page.locator('#yaml-preview').textContent()) || '';
    expect(yaml).toMatch(/- name: advanced-cluster-management\s+channels:\s+- name: release-2\.16\s/);
  });

  test('changing the catalog drops old channels and offers no old-catalog operators while loading', async ({ page }) => {
    await page.route('**/api/operators?*detailed=true*', async route => {
      if (route.request().url().includes('certified-operator-index')) await delay(5000);
      await route.continue();
    });
    const certifiedLoads = countFinished(page, 'certified-operator-index');

    await page.goto('/config');
    await page.getByRole('tab', { name: /Operators/ }).click();
    await page.getByRole('button', { name: 'Add operator catalog' }).click();
    const catalogToggle = page.getByRole('button', { name: /redhat-operator-index/ }).first();
    await expect(catalogToggle).toBeVisible({ timeout: 10_000 });
    await page.getByRole('button', { name: 'Add operator', exact: true }).click();
    await page.getByPlaceholder('Type to search operators...').fill('advanced-cluster');
    await page.getByRole('option', { name: 'advanced-cluster-management' }).click();
    await expect(page.getByRole('button', { name: /release-2\.16 \(default\)/ })).toBeVisible({ timeout: 10_000 });

    // Switch catalogs; the new catalog's operators load slowly.
    await catalogToggle.click();
    await page.getByRole('option', { name: /certified-operator-index/ }).click();

    // While loading: the old channel is gone and no old-catalog operator can be picked.
    await page.getByRole('tab', { name: /Preview/ }).click();
    expect((await page.locator('#yaml-preview').textContent()) || '').not.toContain('release-2.16');
    await page.getByRole('tab', { name: /Operators/ }).click();
    await page.getByRole('button', { name: 'Add operator', exact: true }).click();
    await page.getByPlaceholder('Type to search operators...').last().fill('advanced');
    await expect(page.getByRole('option', { name: 'advanced-cluster-management' })).toHaveCount(0);

    // After loading, the old catalog's default has not come back.
    await waitForFinished(page, certifiedLoads, 1);
    await page.getByRole('tab', { name: /Preview/ }).click();
    const yaml = (await page.locator('#yaml-preview').textContent()) || '';
    expect(yaml).toContain('certified-operator-index');
    expect(yaml).not.toContain('release-2.16');
  });

  test('a pending default still lands after an earlier row is removed', async ({ page }) => {
    await page.route('**/api/operators?*detailed=true*', async route => {
      const response = await route.fetch();
      const operators = (await response.json()) as { name: string; defaultChannel?: string }[];
      await route.fulfill({
        response,
        json: operators.map(op => (op.name === 'advanced-cluster-management' ? { ...op, defaultChannel: '' } : op)),
      });
    });
    await page.route('**/api/operator-channels/advanced-cluster-management*', async route => {
      await delay(2500);
      await route.continue();
    });
    const acmLookups = countFinished(page, '/api/operator-channels/advanced-cluster-management');

    await page.goto('/config');
    await page.getByRole('tab', { name: /Operators/ }).click();
    await page.getByRole('button', { name: 'Add operator catalog' }).click();
    await expect(page.getByRole('button', { name: /redhat-operator-index/ })).toBeVisible({ timeout: 10_000 });

    await page.getByRole('button', { name: 'Add operator', exact: true }).click();
    await page.getByPlaceholder('Type to search operators...').first().fill('openshift-pipelines');
    await page.getByRole('option', { name: 'openshift-pipelines-operator-rh' }).click();
    await expect(page.getByRole('button', { name: /latest \(default\)/ })).toBeVisible({ timeout: 10_000 });

    await page.getByRole('button', { name: 'Add operator', exact: true }).click();
    await page.getByPlaceholder('Type to search operators...').last().fill('advanced-cluster');
    await page.getByRole('option', { name: 'advanced-cluster-management' }).click();

    // Remove the first row while the second row's default lookup is pending.
    await page.getByRole('button', { name: /Remove operator 1/i }).click();
    await waitForFinished(page, acmLookups, 2);

    await page.getByRole('tab', { name: /Preview/ }).click();
    const yaml = (await page.locator('#yaml-preview').textContent()) || '';
    expect(yaml).not.toContain('openshift-pipelines-operator-rh');
    expect(yaml).toMatch(/- name: advanced-cluster-management\s+channels:\s+- name: release-2\.16\s/);
  });

  test('a catalog change uses the freshly fetched catalog data for defaults', async ({ page }) => {
    let redHatFetches = 0;
    await page.route('**/api/operators?*detailed=true*', async route => {
      if (!route.request().url().includes('redhat-operator-index')) {
        await route.continue();
        return;
      }
      redHatFetches += 1;
      const response = await route.fetch();
      const operators = (await response.json()) as { name: string; defaultChannel?: string }[];
      // Later fetches report a different default, as a refreshed catalog could.
      const json = redHatFetches === 1
        ? operators
        : operators.map(op => (op.name === 'advanced-cluster-management' ? { ...op, defaultChannel: 'release-2.15' } : op));
      await route.fulfill({ response, json });
    });

    await page.goto('/config');
    await page.getByRole('tab', { name: /Operators/ }).click();
    await page.getByRole('button', { name: 'Add operator catalog' }).click();
    const catalogToggle = page.getByRole('button', { name: /redhat-operator-index/ }).first();
    await expect(catalogToggle).toBeVisible({ timeout: 10_000 });
    await page.getByRole('button', { name: 'Add operator', exact: true }).click();
    await page.getByPlaceholder('Type to search operators...').fill('advanced-cluster');
    await page.getByRole('option', { name: 'advanced-cluster-management' }).click();
    await expect(page.getByRole('button', { name: /release-2\.16 \(default\)/ })).toBeVisible({ timeout: 10_000 });

    // Switch away and back; the second Red Hat catalog fetch reports release-2.15.
    await catalogToggle.click();
    await page.getByRole('option', { name: /certified-operator-index/ }).click();
    await delay(1500);
    await page.getByRole('button', { name: /certified-operator-index/ }).first().click();
    await page.getByRole('option', { name: /redhat-operator-index/ }).click();
    await delay(2500);

    await page.getByRole('tab', { name: /Preview/ }).click();
    const yaml = (await page.locator('#yaml-preview').textContent()) || '';
    expect(yaml).toMatch(/- name: advanced-cluster-management\s+channels:\s+- name: release-2\.15\s/);
  });

  test('a catalog load still lands after an earlier row is removed and another row changes catalog', async ({ page }) => {
    await page.route('**/api/operators?*detailed=true*', async route => {
      if (route.request().url().includes('certified-operator-index')) await delay(4000);
      await route.continue();
    });
    const certifiedLoads = countFinished(page, 'certified-operator-index');

    await page.goto('/config');
    await page.getByRole('tab', { name: /Operators/ }).click();
    const addCatalog = page.getByRole('button', { name: 'Add operator catalog' });
    for (let i = 0; i < 3; i += 1) await addCatalog.click();
    const redHatToggles = page.getByRole('button', { name: /redhat-operator-index/ });
    await expect(redHatToggles).toHaveCount(3, { timeout: 10_000 });

    // Rows A, B, C. Start a slow catalog change in B, remove A, then change C's catalog,
    // which now sits at B's former position.
    await redHatToggles.nth(1).click();
    await page.getByRole('option', { name: /certified-operator-index/ }).click();
    await page.getByRole('button', { name: 'Remove catalog 1' }).click();
    await expect(redHatToggles).toHaveCount(1);
    await redHatToggles.first().click();
    await page.getByRole('option', { name: /community-operator-index/ }).click();
    await waitForFinished(page, certifiedLoads, 1);

    // B (now the first row) received its certified operators.
    await page.getByRole('button', { name: 'Add operator', exact: true }).first().click();
    await page.getByPlaceholder('Type to search operators...').first().fill('gpu-operator');
    await expect(page.getByRole('option', { name: 'gpu-operator-certified' })).toBeVisible({ timeout: 10_000 });
  });

  test('selecting the same catalog again retries a failed catalog load', async ({ page }) => {
    let certifiedRequests = 0;
    await page.route('**/api/operators?*detailed=true*', async route => {
      if (route.request().url().includes('certified-operator-index')) {
        certifiedRequests += 1;
        if (certifiedRequests === 1) {
          await route.abort();
          return;
        }
      }
      await route.continue();
    });
    const certifiedLoads = countFinished(page, 'certified-operator-index');

    await page.goto('/config');
    await page.getByRole('tab', { name: /Operators/ }).click();
    await page.getByRole('button', { name: 'Add operator catalog' }).click();
    const catalogToggle = page.getByRole('button', { name: /redhat-operator-index/ }).first();
    await expect(catalogToggle).toBeVisible({ timeout: 10_000 });

    // The first load of the certified catalog fails.
    await catalogToggle.click();
    await page.getByRole('option', { name: /certified-operator-index/ }).click();
    await waitForFinished(page, certifiedLoads, 1);

    // Selecting it again loads it.
    await page.getByRole('button', { name: /certified-operator-index/ }).first().click();
    await page.getByRole('option', { name: /certified-operator-index/ }).click();
    await waitForFinished(page, certifiedLoads, 2);
    await page.getByRole('button', { name: 'Add operator', exact: true }).click();
    await page.getByPlaceholder('Type to search operators...').fill('gpu-operator');
    await expect(page.getByRole('option', { name: 'gpu-operator-certified' })).toBeVisible({ timeout: 10_000 });
  });
});
