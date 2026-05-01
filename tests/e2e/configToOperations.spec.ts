import { test, expect } from '@playwright/test';

const CONFIG_NAME = 'e2e-workflow-config.yaml';
const MINIMAL_CONFIG = `kind: ImageSetConfiguration
apiVersion: mirror.openshift.io/v2alpha1
mirror:
  platform:
    channels:
      - name: stable-4.21
    graph: true
  operators: []
  additionalImages: []
  helm:
    repositories: []
`;

test.describe('Config to Operations workflow', () => {
  test('create config via API, verify it appears in Mirror Operations', async ({
    page,
    request,
  }) => {
    await page.goto('/');
    await expect(page.getByText(/Mirror-GUI|mirror/i).first()).toBeVisible({ timeout: 15000 });

    const saveRes = await request.post('/api/config/save', {
      data: { config: MINIMAL_CONFIG, name: CONFIG_NAME },
    });
    expect(saveRes.ok(), `Config save failed: ${await saveRes.text()}`).toBeTruthy();

    await page.goto('/operations');

    await expect(page.getByText(/mirror operations|operation/i).first()).toBeVisible({
      timeout: 15000,
    });

    const configToggle = page.getByLabel('Select configuration file');
    await expect(configToggle).toBeVisible({ timeout: 15000 });
    await configToggle.click();
    await page.getByRole('option', { name: new RegExp(CONFIG_NAME) }).click();
    await expect(configToggle).toContainText(CONFIG_NAME);
  });
});
