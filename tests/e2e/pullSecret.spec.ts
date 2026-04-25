import { test, expect } from '@playwright/test';

test.describe('Dashboard Pull Secret Warning', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('shows "No pull secret detected" warning when pull secret is missing', async ({ page }) => {
    await expect(page.getByText('No pull secret detected')).toBeVisible({ timeout: 15000 });
  });

  test('shows "System Status" label (not "System Health")', async ({ page }) => {
    await expect(page.getByText('System Status')).toBeVisible({ timeout: 15000 });
  });

  test('info icon opens Disk Space popover', async ({ page }) => {
    const popoverTrigger = page.locator('button[aria-label="Disk space details"]');
    await popoverTrigger.waitFor({ state: 'visible', timeout: 15000 });
    await popoverTrigger.click();
    await expect(page.getByText('Disk Space')).toBeVisible({ timeout: 5000 });
  });
});

test.describe('Settings Pull Secret Tab', () => {
  test('Pull Secret tab exists and shows content', async ({ page }) => {
    await page.goto('/settings');
    const pullSecretTab = page.getByRole('tab', { name: /Pull Secret/i });
    await expect(pullSecretTab).toBeVisible({ timeout: 15000 });
    await pullSecretTab.click();
    await expect(page.locator('h3').filter({ hasText: 'Pull Secret' })).toBeVisible({ timeout: 5000 });
    await expect(page.locator('#pull-secret-upload')).toBeVisible();
    await expect(page.getByRole('button', { name: /Save Pull Secret/i })).toBeVisible();
  });

  test('navigating to /settings?tab=pull-secret opens Pull Secret tab directly', async ({ page }) => {
    await page.goto('/settings?tab=pull-secret');
    await expect(page.locator('h3').filter({ hasText: 'Pull Secret' })).toBeVisible({ timeout: 15000 });
    await expect(page.getByRole('button', { name: /Save Pull Secret/i })).toBeVisible();
  });
});
