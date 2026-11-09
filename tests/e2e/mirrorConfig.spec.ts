import { test, expect } from '@playwright/test';

test.describe('Mirror Configuration', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/config');
  });

  test('platform channels section renders', async ({ page }) => {
    await expect(page.getByText('Platform Channels').first()).toBeVisible({ timeout: 15000 });
  });

  test('operators section renders', async ({ page }) => {
    await expect(page.getByText('Operators').first()).toBeVisible({ timeout: 15000 });
  });

  test('additional images section renders', async ({ page }) => {
    await expect(page.getByText('Additional Images').first()).toBeVisible({ timeout: 15000 });
  });

  test('Preview tab is present', async ({ page }) => {
    await expect(page.getByText('Preview').first()).toBeVisible({ timeout: 15000 });
  });

  test('Save and Download buttons are present', async ({ page }) => {
    await expect(page.getByText('Save Configuration').first()).toBeVisible({ timeout: 15000 });
    await expect(page.getByText('Download YAML').first()).toBeVisible({ timeout: 15000 });
  });

  test('saving empty config shows inline validation error', async ({ page }) => {
    await page.getByRole('button', { name: /save configuration/i }).click();
    await expect(page.getByText('At least one platform channel, operator, or additional image is required')).toBeVisible({ timeout: 5000 });
  });

  test('saving config with empty operator shows validation errors', async ({ page }) => {
    await page.getByRole('tab', { name: /operators/i }).click();
    await page.getByRole('button', { name: /add operator catalog/i }).click();
    await expect(page.getByText(/operator-index/i).first()).toBeVisible({ timeout: 10000 });
    await page.getByRole('button', { name: /save configuration/i }).click();
    await expect(page.getByText(/configuration has errors/i)).toBeVisible({ timeout: 5000 });
  });

  test('Preview tab has digest references toggle', async ({ page }) => {
    await page.getByRole('tab', { name: /preview/i }).click();
    const toggle = page.locator('#use-digest-ref-toggle');
    await expect(toggle).toBeVisible({ timeout: 10000 });
  });

  test('Load Configuration tab is present and has file upload', async ({ page }) => {
    await page.getByRole('tab', { name: /load configuration/i }).click();
    await expect(page.getByText(/load imagesetconfiguration yaml/i)).toBeVisible({ timeout: 10000 });
  });

  test('uploaded YAML summary counts operators, channels and catalogs separately', async ({ page }) => {
    // 3 operators, 4 channels, 2 catalogs: all distinct so a wrong count source fails the test.
    const yaml = `apiVersion: mirror.openshift.io/v2alpha1
kind: ImageSetConfiguration
mirror:
  platform:
    channels:
      - name: stable-4.20
  operators:
    - catalog: registry.redhat.io/redhat/redhat-operator-index:v4.20
      packages:
        - name: alpha
          channels:
            - name: stable
            - name: fast
        - name: beta
          channels:
            - name: stable
    - catalog: registry.redhat.io/redhat/certified-operator-index:v4.20
      packages:
        - name: gamma
          channels:
            - name: stable
  additionalImages:
    - name: quay.io/example/one:latest
    - name: quay.io/example/two:latest
`;
    await page.getByRole('tab', { name: /load configuration/i }).click();
    await page.locator('input[type="file"]').setInputFiles({
      name: 'summary.yaml',
      mimeType: 'text/yaml',
      buffer: Buffer.from(yaml),
    });

    const alert = page.locator('.pf-v6-c-alert', { hasText: 'Valid ImageSetConfiguration detected' });
    await expect(alert).toBeVisible({ timeout: 10000 });
    await expect(alert).toContainText('3 operators · 4 channels · 2 catalogs');
    await expect(alert).toContainText('redhat-operator-index:v4.20: 2 operators · 3 channels');
    await expect(alert).toContainText('certified-operator-index:v4.20: 1 operator · 1 channel');
    await expect(alert).toContainText('1 channel');
    await expect(alert).toContainText('2 images');
  });
});
