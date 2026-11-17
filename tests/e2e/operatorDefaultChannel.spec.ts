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
});
