import { test, expect } from '@playwright/test';

test.describe('Dashboard Pull Secret Warning', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('shows pull secret status on dashboard', async ({ page }) => {
    const missing = page.getByText('No pull secret detected');
    const present = page.getByText('Present');
    await expect(missing.or(present).first()).toBeVisible({ timeout: 15000 });
  });

  test('shows "Environment Status" label', async ({ page }) => {
    await expect(page.getByText('Environment Status')).toBeVisible({ timeout: 15000 });
  });

  test('shows Pull Secret status with Missing or Present label in Environment card', async ({ page }) => {
    await expect(page.getByText(/Missing|Present/).first()).toBeVisible({ timeout: 15000 });
  });

  test('info icon opens Environment Details popover', async ({ page }) => {
    const popoverTrigger = page.locator('button[aria-label="Environment details"]');
    await popoverTrigger.waitFor({ state: 'visible', timeout: 15000 });
    await popoverTrigger.click();
    await expect(page.getByText('Environment Details')).toBeVisible({ timeout: 5000 });
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
    await expect(page.getByRole('button', { name: /^Save$/i })).toBeVisible();
  });

  test('navigating to /settings?tab=pull-secret opens Pull Secret tab directly', async ({ page }) => {
    await page.goto('/settings?tab=pull-secret');
    await expect(page.locator('h3').filter({ hasText: 'Pull Secret' })).toBeVisible({ timeout: 15000 });
    await expect(page.getByRole('button', { name: /^Save$/i })).toBeVisible();
  });
});
