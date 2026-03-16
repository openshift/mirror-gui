import { test, expect } from '@playwright/test';

test.describe('Mirror Operations', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/operations');
  });

  test('operations page loads', async ({ page }) => {
    await expect(page.getByText(/mirror operations|operation/i).first()).toBeVisible();
  });

  test('config file selector is present', async ({ page }) => {
    await expect(page.getByText(/config|configuration|select/i)).toBeVisible();
  });

  test('start operation form is present', async ({ page }) => {
    await expect(page.getByText(/start|run|configuration/i).first()).toBeVisible();
  });

  test('operations table or content renders', async ({ page }) => {
    await expect(page.locator('table, [role="grid"], .pf-v5-c-table, main').first()).toBeVisible({ timeout: 10000 });
  });
});
