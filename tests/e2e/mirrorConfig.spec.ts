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
    await expect(alert.locator('.pf-v6-c-description-list__group', { hasText: 'Platform Channels' })).toContainText('1 channel');
    await expect(alert).toContainText('2 images');
  });

  test('uploaded YAML with a malformed operators section is rejected with an error', async ({ page }) => {
    const yaml = `apiVersion: mirror.openshift.io/v2alpha1
kind: ImageSetConfiguration
mirror:
  operators:
    - catalog: 0
      packages:
        - name: alpha
`;
    await page.getByRole('tab', { name: /load configuration/i }).click();
    await page.locator('input[type="file"]').setInputFiles({
      name: 'bad.yaml',
      mimeType: 'text/yaml',
      buffer: Buffer.from(yaml),
    });

    await expect(page.getByText('mirror.operators[0].catalog must be a non-empty string')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('Valid ImageSetConfiguration detected')).toHaveCount(0);
  });

  test('uploaded YAML with a single catalog shows singular counts and no breakdown', async ({ page }) => {
    const yaml = `apiVersion: mirror.openshift.io/v2alpha1
kind: ImageSetConfiguration
mirror:
  operators:
    - catalog: registry.redhat.io/redhat/redhat-operator-index:v4.20
      packages:
        - name: alpha
          channels:
            - name: stable
`;
    await page.getByRole('tab', { name: /load configuration/i }).click();
    await page.locator('input[type="file"]').setInputFiles({ name: 'single.yaml', mimeType: 'text/yaml', buffer: Buffer.from(yaml) });

    const alert = page.locator('.pf-v6-c-alert', { hasText: 'Valid ImageSetConfiguration detected' });
    await expect(alert).toContainText('1 operator · 1 channel · 1 catalog', { timeout: 10000 });
    await expect(alert).not.toContainText('redhat-operator-index:v4.20:');
  });

  test('uploaded YAML with a single full catalog is labeled as a full catalog', async ({ page }) => {
    const yaml = `apiVersion: mirror.openshift.io/v2alpha1
kind: ImageSetConfiguration
mirror:
  operators:
    - catalog: registry.redhat.io/redhat/redhat-operator-index:v4.20
`;
    await page.getByRole('tab', { name: /load configuration/i }).click();
    await page.locator('input[type="file"]').setInputFiles({ name: 'full.yaml', mimeType: 'text/yaml', buffer: Buffer.from(yaml) });

    const alert = page.locator('.pf-v6-c-alert', { hasText: 'Valid ImageSetConfiguration detected' });
    await expect(alert).toContainText('redhat-operator-index:v4.20: full catalog', { timeout: 10000 });
  });

  test('uploaded YAML with non-list channels is rejected', async ({ page }) => {
    const yaml = `apiVersion: mirror.openshift.io/v2alpha1
kind: ImageSetConfiguration
mirror:
  operators:
    - catalog: registry.redhat.io/redhat/redhat-operator-index:v4.20
      packages:
        - name: alpha
          channels: stable
`;
    await page.getByRole('tab', { name: /load configuration/i }).click();
    await page.locator('input[type="file"]').setInputFiles({ name: 'badch.yaml', mimeType: 'text/yaml', buffer: Buffer.from(yaml) });

    await expect(page.getByText('mirror.operators[0].packages[0].channels must be a list')).toBeVisible({ timeout: 10000 });
  });

  test('rejecting a second upload clears the summary from the first valid upload', async ({ page }) => {
    const valid = `apiVersion: mirror.openshift.io/v2alpha1
kind: ImageSetConfiguration
mirror:
  operators:
    - catalog: registry.redhat.io/redhat/redhat-operator-index:v4.20
      packages:
        - name: alpha
`;
    const invalid = valid.replace('catalog: registry.redhat.io/redhat/redhat-operator-index:v4.20', 'catalog: 0');
    await page.getByRole('tab', { name: /load configuration/i }).click();
    const input = page.locator('input[type="file"]');
    await input.setInputFiles({ name: 'ok.yaml', mimeType: 'text/yaml', buffer: Buffer.from(valid) });
    await expect(page.getByText('Valid ImageSetConfiguration detected')).toBeVisible({ timeout: 10000 });

    await input.setInputFiles({ name: 'bad.yaml', mimeType: 'text/yaml', buffer: Buffer.from(invalid) });
    await expect(page.getByText('mirror.operators[0].catalog must be a non-empty string')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('Valid ImageSetConfiguration detected')).toHaveCount(0);
  });
});
