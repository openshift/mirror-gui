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
});
