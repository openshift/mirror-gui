import { test, expect } from '@playwright/test';

test.describe('Navigation', () => {
  test('app loads at root URL', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/OC Mirror/);
  });

  test('sidebar renders with 5 navigation items', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText('Dashboard').first()).toBeVisible();
    await expect(page.getByText('Mirror Configuration').first()).toBeVisible();
    await expect(page.getByText('Mirror Operations').first()).toBeVisible();
    await expect(page.getByText('History').first()).toBeVisible();
    await expect(page.getByText('Settings').first()).toBeVisible();
  });

  test('clicking each nav item navigates to correct route', async ({ page }) => {
    await page.goto('/');
    await page.getByText('Mirror Configuration').first().click();
    await expect(page).toHaveURL(/\/config/);
    await page.getByText('Mirror Operations').first().click();
    await expect(page).toHaveURL(/\/operations/);
    await page.getByText('History').first().click();
    await expect(page).toHaveURL(/\/history/);
    await page.getByText('Settings').first().click();
    await expect(page).toHaveURL(/\/settings/);
    await page.getByText('Dashboard').first().click();
    await expect(page).toHaveURL(/\/(\?.*)?$/);
  });

  test('masthead shows OC Mirror v2 Web Application title', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText('OC Mirror v2 Web Application')).toBeVisible();
  });

  test('Red Hat logo is visible', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('img').first()).toBeVisible();
  });
});
