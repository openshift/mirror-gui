import { test, expect } from '@playwright/test';

test.describe('Navigation', () => {
  test('app loads at root URL', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/Mirror-GUI/);
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

  test('masthead shows Mirror-GUI Application title', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText('Mirror-GUI Application')).toBeVisible();
  });

  test('masthead shows current app version badge', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText('v1.0')).toBeVisible();
  });

  test('Red Hat logo is visible', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('img').first()).toBeVisible();
  });

  test('theme toggle is visible in masthead', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByLabel('Theme selection')).toBeVisible();
  });

  test('theme toggle dropdown shows System, Light, Dark options', async ({ page }) => {
    await page.goto('/');
    await page.getByLabel('Theme selection').click();
    await expect(page.getByRole('menuitem', { name: /System/ })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: /Light/ })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: /Dark/ })).toBeVisible();
  });

  test('selecting Dark theme applies dark class to html', async ({ page }) => {
    await page.goto('/');
    await page.getByLabel('Theme selection').click();
    await page.getByRole('menuitem', { name: /Dark/ }).click();
    await expect(page.locator('html')).toHaveClass(/pf-v6-theme-dark/);
  });

  test('selecting Light theme removes dark class from html', async ({ page }) => {
    await page.goto('/');
    await page.getByLabel('Theme selection').click();
    await page.getByRole('menuitem', { name: /Dark/ }).click();
    await expect(page.locator('html')).toHaveClass(/pf-v6-theme-dark/);
    await page.getByLabel('Theme selection').click();
    await page.getByRole('menuitem', { name: /Light/ }).click();
    await expect(page.locator('html')).not.toHaveClass(/pf-v6-theme-dark/);
  });

  test('theme preference persists across page reload', async ({ page }) => {
    await page.goto('/');
    await page.getByLabel('Theme selection').click();
    await page.getByRole('menuitem', { name: /Dark/ }).click();
    await expect(page.locator('html')).toHaveClass(/pf-v6-theme-dark/);
    await page.reload();
    await expect(page.locator('html')).toHaveClass(/pf-v6-theme-dark/);
    await page.getByLabel('Theme selection').click();
    await page.getByRole('menuitem', { name: /System/ }).click();
  });
});
