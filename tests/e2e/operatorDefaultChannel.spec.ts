import { test, expect } from '@playwright/test';

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
    await page.waitForTimeout(1500);

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
    await delay(6000);

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
    await delay(8000);

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
});
